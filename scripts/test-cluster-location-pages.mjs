/**
 * Zone leftover location pages: claim lock, nearest-primary auto-pick, steal/resync.
 * Run: node scripts/test-cluster-location-pages.mjs
 */
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import os from 'os';
import path from 'path';
import { RESEARCH_DIR, pathsFor } from '../ops/lib/candidates.mjs';
import { mergeLocationPages, placesGeojsonPath } from '../ops/lib/geo-neighbors.mjs';
import { normalizePlaceName } from '../ops/lib/census.mjs';
import { acceptServiceArea, refreshServiceAreaClaims } from '../ops/lib/site-config.mjs';
import { AUTO_SEED_MAX_MILES } from '../ops/lib/service-area-selection.mjs';
import {
  leftoverMilesFromPrimary,
  leftoverNearerToOtherPrimary,
  resyncClusterSiteConfigs,
  setShotgunClustersFileForTests,
  shotgunClaimedSuburbEntries,
  shotgunClaimedSuburbNames,
  shotgunZonePrimaryGeos,
} from '../ops/lib/shotgun.mjs';
import {
  remoteRefreshTouchesZone,
  zoneServiceAreaBroadcastIds,
} from '../ops/public/zone-service-area-sync.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

function writeJson(filePath, data) {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function suburbSet(cfg) {
  return new Set((cfg.targetSuburbs || []).map((n) => normalizePlaceName(n)));
}

if (!existsSync(placesGeojsonPath())) {
  console.log('test-cluster-location-pages: skip (Census map missing)');
  process.exit(0);
}

const gooId = 'zz_test_clp_goodyear';
const avoId = 'zz_test_clp_avondale';
const SITE_CONFIG_PATH = path.join(process.cwd(), 'src', 'config', 'site-config.json');
const siteConfigBackup = existsSync(SITE_CONFIG_PATH) ? readFileSync(SITE_CONFIG_PATH, 'utf8') : null;
const dir = mkdtempSync(path.join(os.tmpdir(), 'rover-clp-'));
const file = path.join(dir, 'shotgun-clusters.json');

const cluster = {
  id: 'sg_clp_test',
  niche: 'Test Plumbing',
  name: 'Zone · Test Plumbing · Goodyear AZ',
  hub: { city: 'Goodyear', state: 'AZ' },
  clusterMiles: 30,
  members: [
    { city: 'Goodyear', state: 'AZ', role: 'hub', clusterKey: 1, candidateId: gooId },
    { city: 'Avondale', state: 'AZ', role: 'member', clusterKey: 1, candidateId: avoId },
  ],
};

function writeCluster() {
  writeJson(file, { clusters: [cluster] });
}

function writeSite(id, { primaryCity, state = 'AZ', targetSuburbs = [], coverageAreas = [], alsoServing = [], overrides = [] }) {
  writeJson(pathsFor(id).siteConfig, {
    businessName: `${primaryCity} Test`,
    niche: 'Test Plumbing',
    primaryCity,
    state,
    targetSuburbs,
    coverageAreas,
    alsoServing,
    clusterLocationPageOverrides: overrides,
  });
}

function cleanup() {
  setShotgunClustersFileForTests(null);
  for (const id of [gooId, avoId]) {
    const p = pathsFor(id);
    for (const f of [p.siteConfig, p.meta]) {
      if (existsSync(f)) unlinkSync(f);
    }
  }
  if (siteConfigBackup != null) writeFileSync(SITE_CONFIG_PATH, siteConfigBackup, 'utf8');
  rmSync(dir, { recursive: true, force: true });
}

try {
  writeCluster();
  setShotgunClustersFileForTests(file);

  writeSite(gooId, {
    primaryCity: 'Goodyear',
    targetSuburbs: ['Tolleson', 'Buckeye'],
    coverageAreas: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
      { name: 'Buckeye', state: 'AZ' },
    ],
  });
  writeSite(avoId, {
    primaryCity: 'Avondale',
    targetSuburbs: [],
    coverageAreas: [
      { name: 'Avondale', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
    ],
  });

  const claimed = shotgunClaimedSuburbNames(avoId);
  assert(claimed.has(normalizePlaceName('Tolleson')), 'Avondale sees Tolleson claimed by Goodyear');
  assert(claimed.has(normalizePlaceName('Buckeye')), 'Avondale sees Buckeye claimed');
  assert(!claimed.has(normalizePlaceName('Goodyear')), 'sibling primary is not a claimed leftover');

  const geos = shotgunZonePrimaryGeos(gooId);
  assert(geos.length === 2, 'both Zone primaries have Census centroids');
  assert(
    geos.some((g) => g.candidateId === gooId && g.city === 'Goodyear'),
    'self geo included',
  );

  assert(leftoverNearerToOtherPrimary('Tolleson', 'AZ', gooId), 'Tolleson is closer to Avondale than Goodyear');
  assert(leftoverNearerToOtherPrimary('Buckeye', 'AZ', avoId), 'Buckeye is closer to Goodyear than Avondale');

  const autoGoo = mergeLocationPages({
    coverage: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
      { name: 'Buckeye', state: 'AZ' },
    ],
    claudeOrder: ['Tolleson', 'Buckeye'],
    primaryCity: 'Goodyear',
    state: 'AZ',
    max: 5,
    skipName: (name, st) => leftoverNearerToOtherPrimary(name, st, gooId),
  });
  assert(
    !autoGoo.some((n) => normalizePlaceName(n) === normalizePlaceName('Tolleson')),
    'auto-pick skips leftover closer to Avondale',
  );
  assert(
    autoGoo.some((n) => normalizePlaceName(n) === normalizePlaceName('Buckeye')),
    'auto-pick keeps leftover closer to Goodyear',
  );

  const manualFar = mergeLocationPages({
    coverage: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
    ],
    claudeOrder: ['Tolleson'],
    primaryCity: 'Goodyear',
    state: 'AZ',
    max: 5,
  });
  assert(
    manualFar.some((n) => normalizePlaceName(n) === normalizePlaceName('Tolleson')),
    'explicit order without skipName still includes farther leftover',
  );

  writeSite(gooId, {
    primaryCity: 'Goodyear',
    targetSuburbs: ['Tolleson'],
    coverageAreas: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
    ],
  });
  writeSite(avoId, {
    primaryCity: 'Avondale',
    targetSuburbs: ['Tolleson'],
    coverageAreas: [
      { name: 'Avondale', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
    ],
  });
  resyncClusterSiteConfigs(cluster);
  const afterNear = suburbSet(readJson(pathsFor(avoId).siteConfig));
  const afterGoo = suburbSet(readJson(pathsFor(gooId).siteConfig));
  assert(afterNear.has(normalizePlaceName('Tolleson')), 'resync keeps Tolleson on nearer Avondale');
  assert(!afterGoo.has(normalizePlaceName('Tolleson')), 'resync strips Tolleson from farther Goodyear');

  writeSite(gooId, {
    primaryCity: 'Goodyear',
    targetSuburbs: ['Tolleson'],
    coverageAreas: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
    ],
    overrides: ['Tolleson'],
  });
  writeSite(avoId, {
    primaryCity: 'Avondale',
    targetSuburbs: ['Tolleson'],
    coverageAreas: [
      { name: 'Avondale', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
    ],
  });
  resyncClusterSiteConfigs(cluster);
  assert(
    suburbSet(readJson(pathsFor(gooId).siteConfig)).has(normalizePlaceName('Tolleson')),
    'override keeps Tolleson on farther Goodyear',
  );
  assert(
    !suburbSet(readJson(pathsFor(avoId).siteConfig)).has(normalizePlaceName('Tolleson')),
    'override steal strips Tolleson from Avondale',
  );

  writeSite(gooId, {
    primaryCity: 'Goodyear',
    targetSuburbs: [],
    coverageAreas: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
      { name: 'Buckeye', state: 'AZ' },
    ],
  });
  writeSite(avoId, {
    primaryCity: 'Avondale',
    targetSuburbs: ['Tolleson'],
    coverageAreas: [
      { name: 'Avondale', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
    ],
  });

  const blockedAccept = acceptServiceArea(gooId, {
    radiusMiles: 15,
    selectedCities: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
      { name: 'Buckeye', state: 'AZ' },
    ],
    locationPageCities: ['Buckeye'],
  });
  assert(
    !blockedAccept.targetSuburbs.some((n) => normalizePlaceName(n) === normalizePlaceName('Tolleson')),
    'Accept without override drops claimed Tolleson',
  );
  assert(
    blockedAccept.targetSuburbs.some((n) => normalizePlaceName(n) === normalizePlaceName('Buckeye')),
    'Accept keeps unclaimed Buckeye',
  );
  assert(
    suburbSet(readJson(pathsFor(avoId).siteConfig)).has(normalizePlaceName('Tolleson')),
    'Avondale still owns Tolleson after blocked Accept',
  );

  const stealAccept = acceptServiceArea(gooId, {
    radiusMiles: 15,
    selectedCities: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
      { name: 'Buckeye', state: 'AZ' },
    ],
    locationPageCities: ['Tolleson', 'Buckeye'],
    clusterLocationPageOverrides: ['Tolleson'],
  });
  assert(
    stealAccept.targetSuburbs.some((n) => normalizePlaceName(n) === normalizePlaceName('Tolleson')),
    'override Accept keeps Tolleson on Goodyear',
  );
  assert(
    !suburbSet(readJson(pathsFor(avoId).siteConfig)).has(normalizePlaceName('Tolleson')),
    'override Accept steals Tolleson from Avondale',
  );
  assert(
    !(readJson(pathsFor(avoId).siteConfig).coverageAreas || []).some(
      (a) => normalizePlaceName(a.name) === normalizePlaceName('Tolleson'),
    ),
    'steal drops Tolleson from Avondale coverage',
  );

  const buckeyeMiles = leftoverMilesFromPrimary('Buckeye', 'AZ', gooId);
  assert(
    Number.isFinite(buckeyeMiles) && buckeyeMiles > AUTO_SEED_MAX_MILES,
    'Buckeye is farther than AUTO seed miles from Goodyear',
  );

  const implicit = acceptServiceArea(gooId, {
    radiusMiles: 15,
    selectedCities: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
      { name: 'Buckeye', state: 'AZ' },
    ],
    claudeOrder: ['Tolleson', 'Buckeye'],
  });
  assert(
    implicit.targetSuburbs.some((n) => normalizePlaceName(n) === normalizePlaceName('Buckeye')),
    'Zone Accept underfills to 4–6 from leftover coverage beyond 5 miles',
  );

  const zoneFill = mergeLocationPages({
    coverage: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
      { name: 'Buckeye', state: 'AZ' },
      { name: 'Avondale', state: 'AZ' },
    ],
    claudeOrder: ['Tolleson', 'Wheatley Place', 'Avondale'],
    ignoreClaudeOrder: true,
    sortBy: 'distance',
    distanceMiles: (name, st) => leftoverMilesFromPrimary(name, st, gooId),
    primaryCity: 'Goodyear',
    state: 'AZ',
    max: 5,
    skipName: (name, st) =>
      leftoverNearerToOtherPrimary(name, st, gooId) ||
      normalizePlaceName(name) === normalizePlaceName('Avondale'),
  });
  assert(
    !zoneFill.some((n) => normalizePlaceName(n) === normalizePlaceName('Tolleson')),
    'Zone fill ignores Claude Tolleson seed',
  );
  assert(
    !zoneFill.some((n) => /wheatley/i.test(n)),
    'research seed never becomes a Zone location page',
  );
  assert(
    !zoneFill.some((n) => normalizePlaceName(n) === normalizePlaceName('Avondale')),
    'sibling city never auto-paged',
  );
  assert(
    zoneFill.some((n) => normalizePlaceName(n) === normalizePlaceName('Buckeye')),
    'Zone fill assigns nearest leftover Buckeye',
  );
  assert(
    Number.isFinite(leftoverMilesFromPrimary('Buckeye', 'AZ', gooId)),
    'Buckeye has a Census distance to Goodyear',
  );
  const keptFar = mergeLocationPages({
    coverage: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Buckeye', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
    ],
    claudeOrder: ['Buckeye'],
    ignoreClaudeOrder: false,
    sortBy: 'distance',
    distanceMiles: (name, st) => leftoverMilesFromPrimary(name, st, gooId),
    maxMiles: AUTO_SEED_MAX_MILES,
    primaryCity: 'Goodyear',
    state: 'AZ',
    max: 5,
  });
  assert(
    keptFar.some((n) => normalizePlaceName(n) === normalizePlaceName('Buckeye')),
    'kept/claude far page survives AUTO maxMiles',
  );
  assertEqual(keptFar.length, 1, 'AUTO rest-fill does not pad kept far page with other far leftovers');

  const milesByName = (table) => (name) => table[normalizePlaceName(name)] ?? 99;
  const underfill = mergeLocationPages({
    coverage: [
      { name: 'Rockwall', state: 'TX' },
      { name: 'Mobile City', state: 'TX' },
      { name: 'Heath', state: 'TX' },
      { name: 'Fate', state: 'TX' },
      { name: 'McLendon-Chisholm', state: 'TX' },
      { name: 'Rowlett', state: 'TX' },
      { name: 'Royse City', state: 'TX' },
    ],
    ignoreClaudeOrder: true,
    sortBy: 'distance',
    distanceMiles: milesByName({
      'mobile city': 2,
      heath: 4,
      fate: 8,
      'mclendon chisholm': 9,
      rowlett: 10,
      'royse city': 11,
    }),
    maxMiles: AUTO_SEED_MAX_MILES,
    minPages: 4,
    primaryCity: 'Rockwall',
    state: 'TX',
    max: 5,
    skipName: (name) => normalizePlaceName(name) === normalizePlaceName('Fate'),
  });
  const underKeys = new Set(underfill.map((n) => normalizePlaceName(n)));
  assert(underKeys.has(normalizePlaceName('Mobile City')), '5-mile seed keeps Mobile City');
  assert(underKeys.has(normalizePlaceName('Heath')), '5-mile seed keeps Heath');
  assert(underKeys.has(normalizePlaceName('McLendon-Chisholm')), 'underfill promotes leftover beyond 5 miles');
  assert(!underKeys.has(normalizePlaceName('Fate')), 'sibling leftover is never paged');
  assert(underfill.length >= 3, 'underfill reaches at least 4 pages including primary');
  assert(underfill.length <= 5, 'underfill stays at prefer-max suburbs');

  const alreadyFour = mergeLocationPages({
    coverage: [
      { name: 'Rockwall', state: 'TX' },
      { name: 'Mobile City', state: 'TX' },
      { name: 'Heath', state: 'TX' },
      { name: 'McLendon-Chisholm', state: 'TX' },
      { name: 'Rowlett', state: 'TX' },
    ],
    ignoreClaudeOrder: true,
    sortBy: 'distance',
    distanceMiles: milesByName({
      'mobile city': 2,
      heath: 3,
      'mclendon chisholm': 4,
      rowlett: 10,
    }),
    maxMiles: AUTO_SEED_MAX_MILES,
    minPages: 4,
    primaryCity: 'Rockwall',
    state: 'TX',
    max: 5,
  });
  assertEqual(
    alreadyFour.filter((n) => normalizePlaceName(n) === normalizePlaceName('Rowlett')).length,
    0,
    'underfill does not add far leftovers once 4 pages exist',
  );
  assertEqual(alreadyFour.length, 3, 'three close leftovers plus primary is enough');

  writeSite(gooId, {
    primaryCity: 'Goodyear',
    targetSuburbs: [],
    coverageAreas: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Avondale', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
      { name: 'Buckeye', state: 'AZ' },
    ],
  });
  writeSite(avoId, {
    primaryCity: 'Avondale',
    targetSuburbs: ['Tolleson'],
    coverageAreas: [
      { name: 'Avondale', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
    ],
  });

  const siblingHardBlock = acceptServiceArea(gooId, {
    radiusMiles: 15,
    selectedCities: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Avondale', state: 'AZ' },
      { name: 'Buckeye', state: 'AZ' },
    ],
    locationPageCities: ['Avondale', 'Buckeye'],
    clusterLocationPageOverrides: ['Avondale'],
    claudeOrder: ['Wheatley Place', 'Avondale'],
  });
  assert(
    !siblingHardBlock.targetSuburbs.some((n) => normalizePlaceName(n) === normalizePlaceName('Avondale')),
    'Accept hard-blocks sibling Avondale even with override',
  );
  assert(
    siblingHardBlock.targetSuburbs.some((n) => normalizePlaceName(n) === normalizePlaceName('Buckeye')),
    'Accept keeps leftover Buckeye page',
  );
  assert(
    !(siblingHardBlock.config.clusterLocationPageOverrides || []).some(
      (n) => normalizePlaceName(n) === normalizePlaceName('Avondale'),
    ),
    'sibling override is dropped',
  );

  const seedNeverPaged = acceptServiceArea(gooId, {
    radiusMiles: 15,
    selectedCities: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
      { name: 'Buckeye', state: 'AZ' },
    ],
    claudeOrder: ['Wheatley Place', 'Tolleson'],
  });
  assert(
    !seedNeverPaged.targetSuburbs.some((n) => /wheatley/i.test(n)),
    'implicit Zone Accept does not page research seed',
  );
  assert(
    !seedNeverPaged.targetSuburbs.some((n) => normalizePlaceName(n) === normalizePlaceName('Tolleson')),
    'implicit Zone Accept skips leftover already claimed by Avondale',
  );
  assert(
    seedNeverPaged.targetSuburbs.some((n) => normalizePlaceName(n) === normalizePlaceName('Buckeye')),
    'implicit Zone Accept underfills from leftover coverage beyond 5 miles',
  );

  const primaryOnly = acceptServiceArea(gooId, {
    radiusMiles: 15,
    selectedCities: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Buckeye', state: 'AZ' },
    ],
    locationPageCities: [],
    claudeOrder: ['Buckeye', 'Wheatley Place'],
  });
  assertEqual(primaryOnly.targetSuburbs.length, 0, 'empty explicit Zone pages stay primary-only');

  writeSite(gooId, {
    primaryCity: 'Goodyear',
    targetSuburbs: ['Buckeye'],
    alsoServing: ['Litchfield Park'],
    coverageAreas: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Buckeye', state: 'AZ' },
      { name: 'Litchfield Park', state: 'AZ' },
      { name: 'Avondale', state: 'AZ' },
    ],
  });
  writeSite(avoId, {
    primaryCity: 'Avondale',
    targetSuburbs: [],
    alsoServing: [],
    coverageAreas: [
      { name: 'Avondale', state: 'AZ' },
      { name: 'Litchfield Park', state: 'AZ' },
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
    ],
  });
  const claimedAlso = shotgunClaimedSuburbNames(avoId);
  assert(!claimedAlso.has(normalizePlaceName('Litchfield Park')), 'Avondale does not claim leftover Also serving');
  assert(claimedAlso.has(normalizePlaceName('Buckeye')), 'Avondale sees leftover page claimed');
  assert(!claimedAlso.has(normalizePlaceName('Goodyear')), 'sibling primary is not a leftover claim');
  const claimedEntries = shotgunClaimedSuburbEntries(avoId);
  assert(
    claimedEntries.some((e) => normalizePlaceName(e.name) === normalizePlaceName('Buckeye')),
    'Avondale claim list includes Goodyear leftover without Refresh',
  );
  const zoneIds = zoneServiceAreaBroadcastIds({
    id: gooId,
    shotgunClusterId: cluster.id,
    shotgunMembers: cluster.members,
  });
  assert(zoneIds.includes(gooId) && zoneIds.includes(avoId), 'broadcast includes both Zone members');
  assert(
    remoteRefreshTouchesZone({ ids: zoneIds, clusterId: cluster.id }, {
      selectedId: avoId,
      clusterId: cluster.id,
      memberIds: cluster.members.map((m) => m.candidateId),
    }),
    'Avondale tab treats Goodyear Accept as a live Zone claim refresh',
  );

  const avoAccept = acceptServiceArea(avoId, {
    radiusMiles: 15,
    selectedCities: [
      { name: 'Avondale', state: 'AZ' },
      { name: 'Litchfield Park', state: 'AZ' },
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
    ],
    locationPageCities: [],
  });
  assert(
    (avoAccept.alsoServing || []).some((n) => normalizePlaceName(n) === normalizePlaceName('Litchfield Park')),
    'Accept keeps leftover already Also-served by Goodyear',
  );
  assert(
    (avoAccept.coverageAreas || []).some((a) => normalizePlaceName(a.name) === normalizePlaceName('Litchfield Park')),
    'Accept shades leftover Also-served by sibling',
  );
  assert(
    (avoAccept.alsoServing || []).some((n) => normalizePlaceName(n) === normalizePlaceName('Goodyear')) ||
      (avoAccept.coverageAreas || []).some((a) => normalizePlaceName(a.name) === normalizePlaceName('Goodyear')),
    'sibling primary can still be Also serving / coverage',
  );
  const avoCovN = (avoAccept.coverageAreas || []).length;
  const avoPlanN = 1 + (avoAccept.targetSuburbs || []).length + (avoAccept.alsoServing || []).length;
  assertEqual(avoCovN, avoPlanN, 'Accept coverage equals pages + Also serving');

  writeSite(gooId, {
    primaryCity: 'Goodyear',
    targetSuburbs: ['Tolleson'],
    alsoServing: ['Buckeye'],
    coverageAreas: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
      { name: 'Buckeye', state: 'AZ' },
    ],
  });
  writeSite(avoId, {
    primaryCity: 'Avondale',
    targetSuburbs: ['Tolleson'],
    coverageAreas: [
      { name: 'Avondale', state: 'AZ' },
      { name: 'Tolleson', state: 'AZ' },
    ],
  });
  const refreshed = refreshServiceAreaClaims(gooId);
  assert(
    !refreshed.targetSuburbs.some((n) => normalizePlaceName(n) === normalizePlaceName('Tolleson')),
    'Refresh drops Tolleson from farther Goodyear',
  );
  assert(
    refreshed.targetSuburbs.some((n) => normalizePlaceName(n) === normalizePlaceName('Buckeye')),
    'Refresh underfills vacated pages from leftover coverage beyond 5 miles',
  );
  assert(
    suburbSet(readJson(pathsFor(avoId).siteConfig)).has(normalizePlaceName('Tolleson')),
    'Refresh does not steal Tolleson from nearer Avondale',
  );
  assert(
    refreshed.dropped.some((d) => normalizePlaceName(d.name) === normalizePlaceName('Tolleson')),
    'Refresh reports dropped Tolleson',
  );
  assert(
    refreshed.added.some((a) => normalizePlaceName(a.name) === normalizePlaceName('Buckeye')),
    'Refresh reports adding leftover Buckeye to reach 4–6 pages',
  );
  assert(/Refreshed/.test(refreshed.status), 'Refresh status mentions Refreshed');

  writeSite(gooId, {
    primaryCity: 'Goodyear',
    targetSuburbs: [],
    alsoServing: ['Litchfield Park'],
    coverageAreas: [
      { name: 'Goodyear', state: 'AZ' },
      { name: 'Litchfield Park', state: 'AZ' },
      { name: 'Avondale', state: 'AZ' },
    ],
  });
  writeSite(avoId, {
    primaryCity: 'Avondale',
    targetSuburbs: [],
    alsoServing: ['Litchfield Park'],
    coverageAreas: [
      { name: 'Avondale', state: 'AZ' },
      { name: 'Litchfield Park', state: 'AZ' },
      { name: 'Goodyear', state: 'AZ' },
    ],
  });
  resyncClusterSiteConfigs(cluster);
  const gooAlso = new Set(
    (readJson(pathsFor(gooId).siteConfig).alsoServing || []).map((n) => normalizePlaceName(n)),
  );
  const avoAlso = new Set(
    (readJson(pathsFor(avoId).siteConfig).alsoServing || []).map((n) => normalizePlaceName(n)),
  );
  assert(gooAlso.has(normalizePlaceName('Litchfield Park')), 'resync keeps overlapping leftover Also serving on Goodyear');
  assert(avoAlso.has(normalizePlaceName('Litchfield Park')), 'resync keeps overlapping leftover Also serving on Avondale');

  console.log('test-cluster-location-pages: ok');
} finally {
  cleanup();
}
