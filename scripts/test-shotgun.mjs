/**
 * Shotgun pack helpers (JSON parse, caps, role cycle, filters).
 * Run: node scripts/test-shotgun.mjs
 */
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addClusterCity,
  formatShotgunSg,
  nextShotgunSgNumber,
  ensureShotgunSgNumbers,
  membersFromAssign,
  normalizeClusterRole,
  shotgunRoleLabel,
  applyHubScanToDraft,
  applyCityCaps,
  compactHubScore,
  cycleShotgunRole,
  DEFAULT_SHOTGUN_BANDS,
  clampClusterMiles,
  emptyShotgunDraft,
  CLUSTER_MAX,
  gateProposedHubs,
  hubPopAllowed,
  isStateNamedPlace,
  listViableHubs,
  mergeClaudeHub,
  mergePickerHubs,
  ensureLockedHubOnDraft,
  shotgunDraftHubCount,
  normalizePackType,
  parseAssignCitiesJson,
  parseFindHubsJson,
  placeKey,
  removeClusterCity,
  seedMembersFromPreferred,
  seedMembersFromRings,
  setShotgunClustersFileForTests,
  applyMemberPaint,
  applyMemberPaintMany,
  pruneMembersOutsideZone,
  setZoneHub,
  paintZoneMember,
  setZoneMiles,
  clusterName,
  memberClusterKey,
  normalizeMember,
  parseClusterKey,
  nextPaintSlot,
  isPackMember,
  scrubShotgunRecord,
} from '../ops/lib/shotgun.mjs';
import { cityMapLabel, zoneCitiesAwaitingCandidate } from '../ops/public/shotgun-clusters.js';
import { autoLabel, buildFilterBrief, emptyDiscoveryRowsHint, normalizeFilters } from '../ops/lib/discovery.mjs';
import { censusCsvPath, normalizePlaceName } from '../ops/lib/census.mjs';
import { placesGeojsonPath, placeInZoneRadius } from '../ops/lib/geo-neighbors.mjs';
import { findPlaceFeatures, getMapGeojson } from '../ops/lib/research-map.mjs';

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

assertEqual(normalizePackType('shotgun'), 'cluster', 'pack type shotgun alias');
assertEqual(normalizePackType('cluster'), 'cluster', 'pack type cluster');
assertEqual(normalizePackType('scout'), 'single', 'pack type scout alias');
assertEqual(normalizePackType('single'), 'single', 'pack type single');
assertEqual(
  emptyDiscoveryRowsHint({ filters: { packType: 'shotgun' } }),
  'Batch has no rows — generate the cluster pack from the selected hub first',
  'cluster empty rows hint via shotgun alias',
);
assertEqual(
  emptyDiscoveryRowsHint({ filters: { packType: 'cluster' } }),
  'Batch has no rows — generate the cluster pack from the selected hub first',
  'cluster empty rows hint',
);
assertEqual(
  emptyDiscoveryRowsHint({ filters: { packType: 'scout' } }),
  'Batch has no rows — import Claude CSV first',
  'single empty rows hint via scout alias',
);
assertEqual(cycleShotgunRole(''), 'member', 'cycle empty');
assertEqual(cycleShotgunRole('city'), 'unassigned', 'cycle city');
assertEqual(cycleShotgunRole('wave1'), 'unassigned', 'cycle wave1');
assertEqual(cycleShotgunRole('member'), 'unassigned', 'cycle member');
assertEqual(cycleShotgunRole('unassigned'), 'member', 'cycle unassigned');

assertEqual(formatShotgunSg(1), '01', 'sg 1');
assertEqual(formatShotgunSg(12), '12', 'sg 12');
assertEqual(formatShotgunSg(0), '', 'sg 0 empty');
assertEqual(formatShotgunSg(null), '', 'sg null');
assertEqual(shotgunRoleLabel('main'), 'Hub', 'role main alias');
assertEqual(shotgunRoleLabel('hub'), 'Hub', 'role hub');
assertEqual(shotgunRoleLabel('wave1'), 'Member', 'legacy wave1 is member');
assertEqual(shotgunRoleLabel('wave2'), 'Member', 'legacy wave2 is member');
assertEqual(shotgunRoleLabel('city'), 'Member', 'legacy city is member');
assertEqual(shotgunRoleLabel('member', { clusterKey: 1 }), 'Cluster 1', 'cluster prefix label');
assertEqual(cityMapLabel('Mesquite', 1), '1 Mesquite', 'cluster prefix on map label');
assertEqual(cityMapLabel('Dallas', 0, { hub: true }), '★ Dallas', 'hub star on map label');
assertEqual(clusterName('Roofing', 'Frisco', 'TX'), 'Zone · Roofing · Frisco TX', 'zone name');
assertEqual(parseClusterKey(3), 3, 'cluster key 3');
assertEqual(parseClusterKey(11), 11, 'cluster key 11');
assertEqual(parseClusterKey(20), 20, 'cluster key 20');
assertEqual(parseClusterKey(21), 0, 'cluster key 21 rejected');
assertEqual(nextPaintSlot(3, 3), 0, 'paint toggle off');
assertEqual(nextPaintSlot(2, 3), 3, 'paint move cluster');
assertEqual(nextPaintSlot(2, 0), 0, 'paint none clears');
{
  const painted = applyMemberPaint(
    [{ city: 'Plano', state: 'TX', role: 'wave1' }],
    { city: 'Frisco', state: 'TX' },
    { city: 'Plano', state: 'TX', tool: 'cluster', slot: 4 },
  );
  const row = painted.find((m) => m.city === 'Plano');
  assertEqual(memberClusterKey(row), 4, 'paint cluster 4');
  assertEqual(row.role, 'member', 'painted city is member');
  assertEqual(row.wave, undefined, 'wave dropped after paint');
  const toggled = applyMemberPaint(painted, { city: 'Frisco', state: 'TX' }, {
    city: 'Plano',
    state: 'TX',
    tool: 'cluster',
    slot: 4,
  });
  const after = toggled.find((m) => m.city === 'Plano');
  assertEqual(after, undefined, 'paint toggle-off removes map-painted city');
  const setAgain = applyMemberPaint(painted, { city: 'Frisco', state: 'TX' }, {
    city: 'Plano',
    state: 'TX',
    tool: 'cluster',
    slot: 4,
    mode: 'set',
  });
  assertEqual(memberClusterKey(setAgain.find((m) => m.city === 'Plano')), 4, 'set mode does not toggle');
}
{
  const hub = { city: 'Dallas', state: 'TX' };
  const batch = applyMemberPaintMany(
    [
      { city: 'Dallas', state: 'TX', role: 'hub' },
      { city: 'Irving', state: 'TX', role: 'unassigned' },
      { city: 'Mesquite', state: 'TX', role: 'unassigned' },
      { city: 'Garland', state: 'TX', role: 'unassigned' },
    ],
    hub,
    {
      cities: [
        { city: 'Irving', state: 'TX' },
        { city: 'Mesquite', state: 'TX' },
        { city: 'Garland', state: 'TX' },
      ],
      slot: 2,
      mode: 'set',
    },
  );
  assertEqual(memberClusterKey(batch.find((m) => m.city === 'Irving')), 2, 'batch Irving Cluster 2');
  assertEqual(memberClusterKey(batch.find((m) => m.city === 'Mesquite')), 2, 'batch Mesquite Cluster 2');
  assertEqual(memberClusterKey(batch.find((m) => m.city === 'Garland')), 2, 'batch Garland Cluster 2');
  const mixed = applyMemberPaintMany(
    [
      { city: 'Dallas', state: 'TX', role: 'hub' },
      { city: 'Irving', state: 'TX', role: 'member', clusterKey: 1 },
      { city: 'Mesquite', state: 'TX', role: 'member', clusterKey: 5 },
    ],
    hub,
    {
      cities: [
        { city: 'Irving', state: 'TX' },
        { city: 'Mesquite', state: 'TX' },
      ],
      slot: 0,
      mode: 'set',
    },
  );
  assertEqual(mixed.find((m) => m.city === 'Irving'), undefined, 'clear removes Cluster 1 city');
  assertEqual(mixed.find((m) => m.city === 'Mesquite'), undefined, 'clear removes Cluster 5 city');
  assertEqual(mixed.find((m) => m.city === 'Dallas')?.role, 'hub', 'clear keeps hub');
}
{
  const kept = pruneMembersOutsideZone(
    { city: 'Dallas', state: 'TX' },
    [
      { city: 'Dallas', state: 'TX', role: 'hub' },
      { city: 'NotARealCityXYZ', state: 'TX', role: 'member', clusterKey: 2, source: 'manual' },
    ],
    30,
  );
  const mystery = kept.find((m) => m.city === 'NotARealCityXYZ');
  assertEqual(memberClusterKey(mystery), 2, 'unknown geo keeps cluster when radius shrinks');
}
{
  const claude = normalizeMember({
    city: 'Allen',
    state: 'TX',
    role: 'member',
    source: 'claude',
  });
  assertEqual(claude.clusterKey, null, 'claude city can have no cluster');
  assert(isPackMember(claude), 'claude city is pack member without cluster');
}
{
  const next = setZoneHub(
    [
      { city: 'Frisco', state: 'TX', role: 'hub', clusterKey: 2, wave: 1 },
      { city: 'Plano', state: 'TX', role: 'wave1', clusterKey: 4, wave: 1 },
    ],
    { fromCity: 'Frisco', fromState: 'TX', toCity: 'Plano', toState: 'TX', population: 285494 },
  );
  const frisco = next.find((m) => m.city === 'Frisco');
  const plano = next.find((m) => m.city === 'Plano');
  assertEqual(plano.role, 'hub', 'new hub role');
  assertEqual(memberClusterKey(plano), 4, 'new hub keeps cluster');
  assertEqual(plano.wave, undefined, 'hub has no wave field');
  assertEqual(frisco.role, 'member', 'old hub stays member');
  assertEqual(memberClusterKey(frisco), 2, 'old hub keeps cluster');
  assertEqual(frisco.wave, undefined, 'wave dropped on hub move');
  const same = setZoneHub(next, {
    fromCity: 'Plano',
    fromState: 'TX',
    toCity: 'Plano',
    toState: 'TX',
  });
  assertEqual(same.find((m) => m.role === 'hub')?.city, 'Plano', 'click current hub is no-op');
}
{
  const n = normalizeMember({ city: 'Allen', state: 'TX', role: 'wave2' });
  assertEqual(n.wave, undefined, 'wave field dropped');
  assertEqual(n.clusterKey, 2, 'scrub copies wave to clusterKey');
  assertEqual(n.role, 'member', 'legacy wave role is member');
  const hub = normalizeMember({ city: 'Dallas', state: 'TX', role: 'hub', wave: 3 });
  assertEqual(hub.role, 'hub', 'hub stays hub');
  assertEqual(hub.clusterKey, null, 'hub is never given a Cluster from Wave');
}
{
  const { record, dirty } = scrubShotgunRecord({
    waveCount: 3,
    waveMiles: [20, 30, 40],
    bands: { hub: { min: 60000, max: 200000 }, wave1: { min: 2000, max: 60000 }, wave2: { min: 2000, max: 8000 } },
    hubs: [{
      city: 'Dallas',
      state: 'TX',
      wave1: [{ city: 'Irving', state: 'TX' }],
      wave2: [{ city: 'Grand Prairie', state: 'TX' }],
      wave1Preferred: [{ city: 'Plano', state: 'TX' }],
    }],
    members: [{ city: 'Allen', state: 'TX', role: 'wave1' }],
  });
  assert(dirty, 'scrub marks dirty');
  assertEqual(record.waveCount, undefined, 'scrub drops waveCount');
  assertEqual(record.waveMiles, undefined, 'scrub drops waveMiles');
  assertEqual(record.clusterMiles, 40, 'scrub copies last waveMiles to clusterMiles');
  assertEqual(record.bands.cities.min, 2000, 'scrub copies wave bands into cities');
  assertEqual(record.bands.wave1, undefined, 'scrub drops bands.wave1');
  assertEqual(record.hubs[0].innerCities[0].city, 'Irving', 'scrub copies wave1 to innerCities');
  assertEqual(record.hubs[0].outerCities[0].city, 'Grand Prairie', 'scrub copies wave2 to outerCities');
  assertEqual(record.hubs[0].citiesPreferred[0].city, 'Plano', 'scrub copies preferred to citiesPreferred');
  assertEqual(record.hubs[0].wave1, undefined, 'scrub drops hub wave1');
  assertEqual(record.members[0].clusterKey, 1, 'scrub copies wave1 role to clusterKey');
  assertEqual(record.members[0].role, 'member', 'scrub wave1 member is member');
  assert(isPackMember(record.members[0]), 'scrubbed city is pack member');
}
assertEqual(normalizeClusterRole('city'), 'member', 'legacy city is member');
assertEqual(normalizeClusterRole('wave2'), 'member', 'wave2 is member');
assertEqual(normalizeClusterRole('wave10'), 'member', 'wave10 is member');
assertEqual(normalizeClusterRole('wave11'), '', 'wave11 rejected');
assertEqual(CLUSTER_MAX, 20, 'max clusters');
assertEqual(emptyShotgunDraft().waveCount, undefined, 'draft has no waveCount');
assertEqual(nextShotgunSgNumber([{ sgNumber: 1 }, { sgNumber: 3 }]), 4, 'next after max');
assertEqual(clampClusterMiles(30), 30, 'clamp default miles');
assertEqual(clampClusterMiles(1), 1, 'clamp min miles');
assertEqual(clampClusterMiles(100), 100, 'clamp 100 miles');
assertEqual(clampClusterMiles(200), 200, 'clamp max miles');
assertEqual(clampClusterMiles(0), 1, 'clamp below min miles');
assertEqual(clampClusterMiles(250), 200, 'clamp above max miles');
assertEqual(emptyShotgunDraft({ clusterMiles: 250 }).clusterMiles, 200, 'draft miles clamped');
assertEqual(emptyShotgunDraft({ clusterMiles: 12 }).innerMiles, 12, 'draft inner follows cluster');
assertEqual(emptyShotgunDraft().waveMiles, undefined, 'draft has no waveMiles');

const backfill = {
  clusters: [
    { id: 'b', createdAt: '2026-09-10T02:00:00Z' },
    { id: 'a', createdAt: '2026-09-10T01:00:00Z' },
  ],
};
assert(ensureShotgunSgNumbers(backfill), 'backfill dirty');
assertEqual(backfill.clusters.find((c) => c.id === 'a').sgNumber, 1, 'earlier created is 001');
assertEqual(backfill.clusters.find((c) => c.id === 'b').sgNumber, 2, 'later is 002');
assertEqual(ensureShotgunSgNumbers(backfill), false, 'backfill idempotent');

const mixed = {
  clusters: [
    { id: 'keep', sgNumber: 5, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'new', createdAt: '2026-01-02T00:00:00Z' },
  ],
};
assert(ensureShotgunSgNumbers(mixed), 'mixed dirty');
assertEqual(mixed.clusters.find((c) => c.id === 'keep').sgNumber, 5, 'keep existing');
assertEqual(mixed.clusters.find((c) => c.id === 'new').sgNumber, 1, 'fill unused 1');

assertEqual(placeKey('St. Louis', 'MO'), placeKey('Saint Louis', 'MO'), 'St/Saint placeKey');
assertEqual(normalizePlaceName('St. Louis'), normalizePlaceName('Saint Louis'), 'St/Saint census');

const find = parseFindHubsJson(`\`\`\`json
{ "hubs": [{ "city": "Bend", "state": "or", "why": "enough inner cities" }] }
\`\`\``);
assertEqual(find.hubs.length, 1, 'find hubs count');
assertEqual(find.hubs[0].city, 'Bend', 'find hubs city');
assertEqual(find.hubs[0].state, 'OR', 'find hubs state');

const assign = parseAssignCitiesJson(`{
  "main": { "city": "Bend", "state": "OR" },
  "wave1": [{ "city": "Redmond", "state": "OR" }, { "city": "Prineville", "state": "OR" }, { "city": "Madras", "state": "OR" }],
  "wave2": [{ "city": "Sisters", "state": "OR" }, { "city": "La Pine", "state": "OR" }, { "city": "Culver", "state": "OR" }, { "city": "Terrebonne", "state": "OR" }]
}`);
assertEqual(assign.main.city, 'Bend', 'assign main alias');
assertEqual(assign.hub.city, 'Bend', 'assign hub');
assertEqual(assign.cities.length, 7, 'legacy wave1/wave2 keys still parse as cities');
assertEqual(assign.wave1, undefined, 'assign result has no wave1 key');
const assignMembers = membersFromAssign(assign);
assertEqual(assignMembers[0].role, 'hub', 'assign member hub role');
assert(
  assignMembers.slice(1).every((m) => m.role === 'member'),
  'assign member roles',
);
const mixedWaves = membersFromAssign({
  hub: { city: 'Bend', state: 'OR' },
  cities: [
    { city: 'Redmond', state: 'OR', role: 'wave1' },
    { city: 'Sisters', state: 'OR', role: 'wave2' },
  ],
});
assertEqual(mixedWaves[1].role, 'member', 'membersFromAssign stamps member not waveN');
assertEqual(mixedWaves[2].role, 'member', 'membersFromAssign stamps member not waveN');
assertEqual(mixedWaves[1].source, 'claude', 'assign source is claude');

const assignNew = parseAssignCitiesJson(`{
  "hub": { "city": "Bend", "state": "OR" },
  "cities": [{ "city": "Redmond", "state": "OR" }, { "city": "Sisters", "state": "OR" }]
}`);
assertEqual(assignNew.hub.city, 'Bend', 'assign hub key');
assertEqual(assignNew.cities.length, 2, 'assign cities key');

const tooMany = applyCityCaps({
  main: { city: 'Bend', state: 'OR' },
  cities: ['a', 'b', 'c', 'd', 'e', 'f']
    .map((x) => ({ city: x, state: 'OR' }))
    .concat(Array.from({ length: 12 }, (_, i) => ({ city: `w${i}`, state: 'OR' }))),
});
assertEqual(tooMany.cities.length, 18, 'cities not truncated');
assertEqual(tooMany.wave1, undefined, 'applyCityCaps does not write wave1');

const shotgunFilters = normalizeFilters({
  packType: 'shotgun',
  shotgunNiche: 'Trenchless Sewer Pipe Lining',
  requiredNiches: ['Trenchless Sewer Pipe Lining'],
  state: 'OR',
  cities: ['Bend'],
  innerMiles: 15,
  outerMiles: 30,
  shotgunBands: {
    hub: { min: 70000, max: 200000 },
    wave1: { min: 15000, max: 150000 },
    wave2: { min: 8000, max: 80000 },
  },
});
assertEqual(shotgunFilters.packType, 'cluster', 'filters packType');
assertEqual(shotgunFilters.shotgunNiche, 'Trenchless Sewer Pipe Lining', 'filters niche');
assert(autoLabel(shotgunFilters).startsWith('cluster-'), 'autoLabel cluster prefix');

const shotgunBrief = buildFilterBrief({
  packType: 'shotgun',
  shotgunNiche: 'Foundation Repair',
  requiredNiches: ['Foundation Repair'],
  regions: [
    { state: 'KS', cities: [] },
    { state: 'MO', cities: [] },
  ],
});
assert(
  !shotgunBrief.includes('OPEN within KS — choose the best cities'),
  'shotgun brief is not Scout OPEN cities',
);
assert(shotgunBrief.includes('Hubs in KS, MO'), 'shotgun brief lists hub states');
assert(shotgunBrief.includes('hint list'), 'shotgun brief treats Census table as hints');

const emptyScanDraft = applyHubScanToDraft(emptyShotgunDraft({}), {
  scanned: 3,
  viable: [],
  rejected: [
    {
      city: 'Topeka',
      state: 'KS',
      rejectReason: 'inner Wave 1 pool 1 (need ≥ 3)',
      viable: false,
    },
    {
      city: 'Wichita',
      state: 'KS',
      rejectReason: 'hub population outside Hub band',
      viable: false,
    },
  ],
  states: ['KS', 'MO'],
  settings: {
    innerMiles: 15,
    outerMiles: 30,
    bands: {
      hub: { min: 70000, max: 200000 },
      wave1: { min: 15000, max: 150000 },
      wave2: { min: 8000, max: 80000 },
    },
  },
});
assertEqual(emptyScanDraft.viableHubs.length, 0, 'empty scan has no viable hubs');
assertEqual(emptyScanDraft.rejectedHubs.length, 2, 'empty scan serializes rejectedHubs');
assertEqual(emptyScanDraft.hubScan.scanned, 3, 'empty scan stores count');
const serialized = JSON.parse(JSON.stringify(emptyScanDraft));
assertEqual(serialized.rejectedHubs[0].city, 'Topeka', 'rejectedHubs survive JSON');
assert(
  serialized.rejectedHubs[1].rejectReason.includes('Hub band'),
  'rejected reason survives JSON',
);

const gatedEmpty = gateProposedHubs(
  [{ city: 'Wichita', state: 'KS', why: 'famous core' }],
  {},
  { viableKeys: new Set() },
);
assertEqual(gatedEmpty.survivors.length, 0, 'Claude guesses outside table are not survivors');
assertEqual(
  gatedEmpty.rejected[0].rejectReason,
  'not in Census viable table',
  'Claude guess reject reason',
);

assertEqual(DEFAULT_SHOTGUN_BANDS.hub.min, 60000, 'default hub min');
assertEqual(DEFAULT_SHOTGUN_BANDS.cities.min, 2000, 'default cities min');
assertEqual(DEFAULT_SHOTGUN_BANDS.cities.max, 60000, 'default cities max');
assertEqual(DEFAULT_SHOTGUN_BANDS.wave1, undefined, 'default bands have no wave1');
assertEqual(DEFAULT_SHOTGUN_BANDS.wave2, undefined, 'default bands have no wave2');
assert(hubPopAllowed(203677, { min: 60000, max: 200000 }), 'Overland Park within 10% slack');
assert(!hubPopAllowed(400987, { min: 60000, max: 200000 }), 'Wichita outside hub slack');
assert(isStateNamedPlace('Kansas', 'KS'), 'Kansas KS is bogus state-named place');
assert(!isStateNamedPlace('Kansas City', 'KS'), 'Kansas City KS is a real place');

const nested = parseFindHubsJson(`{
  "hubs": [{
    "city": "Olathe",
    "state": "KS",
    "why": "contractor radius",
    "wave1": [{ "city": "Lenexa", "state": "KS" }],
    "wave2": [{ "city": "Gardner", "state": "KS" }, { "city": "Paola", "state": "KS" }]
  }]
}`);
assertEqual(nested.hubs[0].cities.length, 3, 'parse nested wave1/wave2 as cities');
assertEqual(nested.hubs[0].cities[0].city, 'Lenexa', 'parse nested first city');
assertEqual(nested.hubs[0].wave1, undefined, 'parseFindHubs does not keep wave1');

const compact = compactHubScore({
  city: 'Olathe',
  state: 'KS',
  population: 150000,
  innerPool: [
    { name: 'Merriam', state: 'KS', population: 11000, miles: 4 },
    { name: 'Lenexa', state: 'KS', population: 57000, miles: 6 },
    { name: 'Shawnee', state: 'KS', population: 67000, miles: 8 },
    { name: 'Gardner', state: 'KS', population: 25000, miles: 12 },
    { name: 'De Soto', state: 'KS', population: 16000, miles: 14 },
    { name: 'Extra', state: 'KS', population: 20000, miles: 15 },
  ],
  outerPool: Array.from({ length: 12 }, (_, i) => ({
    name: `Outer${i}`,
    state: 'KS',
    population: 9000,
    miles: 16 + i,
  })),
  viable: true,
});
assertEqual(compact.innerCities.length, 6, 'compact persists inner cities');
assertEqual(compact.outerCities.length, 12, 'compact persists leftover-outer cities');
assertEqual(compact.clusterPop, compact.population, 'clusterPop is hub only without preferred cities');
assert(!JSON.stringify(compact).includes('innerPool'), 'compact drops full innerPool');
assertEqual(compact.wave1, undefined, 'compact does not write wave1');

const compactPref = compactHubScore({
  city: 'Olathe',
  state: 'KS',
  population: 150000,
  citiesPreferred: compact.innerCities.slice(0, 2),
  viable: true,
});
assertEqual(
  compactPref.clusterPop,
  150000 + 11000 + 57000,
  'clusterPop is hub plus preferred Cluster Cities',
);

const springfield = compactHubScore({
  city: 'Springfield',
  state: 'MO',
  population: 169000,
  innerCities: compact.innerCities,
  outerCities: compact.outerCities,
  viable: true,
});
const picked = mergePickerHubs(
  [compact],
  [{ ...springfield, source: 'claude', why: 'bigger cluster' }],
);
assertEqual(picked.claude.length, 1, 'claude list');
assertEqual(picked.claude[0].city, 'Springfield', 'claude hub first');
assertEqual(picked.censusExtras[0].city, 'Olathe', 'Census extra kept');
assertEqual(
  shotgunDraftHubCount({ hubs: picked.claude, viableHubs: [compact] }),
  2,
  'hub count is Claude + Census extras',
);

const extrasFromRejected = mergePickerHubs(
  [],
  [],
  [
    {
      city: 'Topeka',
      state: 'KS',
      population: 125000,
      hubInBand: true,
      viable: false,
      rejectReason: 'outer Wave 2 pool 1 (need ≥ 4)',
    },
  ],
);
assertEqual(extrasFromRejected.censusExtras[0].city, 'Topeka', 'thin Census hub still listed as extra');

const lockedOutOfBand = mergePickerHubs(
  [
    {
      city: 'Frisco',
      state: 'TX',
      population: 237000,
      hubInBand: false,
      viable: false,
      source: 'locked',
      innerCities: [{ city: 'Celina', state: 'TX', population: 64000, miles: 10 }],
      outerCities: [],
    },
  ],
  [],
  [
    {
      city: 'Frisco',
      state: 'TX',
      population: 237000,
      hubInBand: false,
      viable: false,
      source: 'locked',
    },
  ],
);
assertEqual(lockedOutOfBand.claude[0].city, 'Frisco', 'locked hub listed even outside Hub band');
assertEqual(lockedOutOfBand.claude[0].source, 'locked', 'locked source kept');
assert(
  !lockedOutOfBand.censusExtras.some((h) => h.city === 'Frisco'),
  'locked hub is not duplicated as Census extra',
);

const skippedBandRejected = mergePickerHubs(
  [],
  [],
  [
    {
      city: 'Dallas',
      state: 'TX',
      population: 1300000,
      hubInBand: false,
      viable: false,
      rejectReason: 'hub population outside Hub band',
    },
  ],
);
assertEqual(skippedBandRejected.censusExtras.length, 0, 'non-locked out-of-band reject is not an extra');

{
  const already = {
    hub: { city: 'Frisco', state: 'TX' },
    hubs: [],
    viableHubs: [
      {
        city: 'Frisco',
        state: 'TX',
        source: 'locked',
        innerCities: [{ city: 'Celina', state: 'TX' }],
        outerCities: [],
      },
    ],
  };
  const same = ensureLockedHubOnDraft(already);
  assert(same === already, 'locked hub with city lists is not rescored');
}

const seededPref = seedMembersFromPreferred(
  {
    city: 'Olathe',
    state: 'KS',
    citiesPreferred: compact.innerCities.slice(0, 3).concat(compact.outerCities.slice(0, 4)),
  },
  {
    city: 'Olathe',
    state: 'KS',
    population: 150000,
    innerPool: compact.innerCities.map((c) => ({ name: c.city, ...c })),
    outerPool: compact.outerCities.map((c) => ({ name: c.city, ...c })),
  },
);
assertEqual(
  seededPref.filter((m) => m.role === 'member')[0].city,
  compact.innerCities[0].city,
  'Use hub seeds Claude preferred as members',
);

const seeded = seedMembersFromRings({
  city: 'Olathe',
  state: 'KS',
  population: 150000,
  innerPool: compact.innerCities.map((c) => ({ name: c.city, ...c })),
  outerPool: compact.outerCities.map((c) => ({ name: c.city, ...c })),
});
const seedCities = seeded.filter((m) => m.role === 'member');
assertEqual(seedCities.length, compact.innerCities.length + compact.outerCities.length, 'seed cities not truncated');
assertEqual(seedCities[0].city, 'Merriam', 'seed nearest city first');
assert(!seeded.some((m) => String(m.role).startsWith('wave')), 'seed does not stamp waveN roles');
assert(seeded.some((m) => m.role === 'hub' && m.city === 'Olathe'), 'seed includes Hub');

const mapPath = placesGeojsonPath();
const censusPath = censusCsvPath();
if (existsSync(mapPath) && existsSync(censusPath)) {
  const ksmo = listViableHubs(['KS', 'MO']);
  const names = [...(ksmo.viable || []), ...(ksmo.rejected || [])]
    .map((h) => `${h.city} ${h.state}`.toLowerCase())
    .join('|');
  assert(
    /overland park/.test(names) || /springfield/.test(names) || /olathe/.test(names),
    `KS/MO scan should include Overland Park, Springfield, or Olathe; got: ${names || '(none)'}`,
  );
  assert(
    !(ksmo.rejected || []).some((h) => isStateNamedPlace(h.city, h.state)),
    'Kansas KS not listed as a hub',
  );
  const mergedHub = mergeClaudeHub({
    city: 'Olathe',
    state: 'KS',
    why: 'fixture',
    wave1: [{ city: 'Lenexa', state: 'KS' }],
    wave2: [{ city: 'Gardner', state: 'KS' }],
  });
  assert(mergedHub.ok, 'merge Claude Olathe cluster');
  assert(mergedHub.hub.viable, 'Claude hub shows in picker without Census 3/4 gate');
  assert(
    (mergedHub.hub.citiesPreferred || []).some((c) => /lenexa/i.test(c.city)) ||
      (mergedHub.hub.unmatched || []).some((c) => /lenexa/i.test(c.city)),
    'Claude city kept as preferred or unmatched',
  );
  assert(
    (mergedHub.hub.citiesPreferred || []).length > 0 || (mergedHub.hub.unmatched || []).length > 0,
    'Claude cities matched or recorded unmatched',
  );
  const lockedDraft = ensureLockedHubOnDraft({
    ...emptyShotgunDraft({}),
    hub: { city: 'Frisco', state: 'TX' },
  });
  assertEqual(lockedDraft.viableHubs[0]?.source, 'locked', 'locked Frisco persisted');
  assert(
    /frisco/i.test(lockedDraft.viableHubs[0]?.city || ''),
    'locked hub city is Frisco',
  );
  assert(Array.isArray(lockedDraft.viableHubs[0]?.innerCities), 'locked hub has leftover city lists');
  assert(shotgunDraftHubCount(lockedDraft) >= 1, 'locked hub counts in picker');
  const { record: rb } = scrubShotgunRecord({
    ...emptyShotgunDraft({}),
    hub: { city: 'Frisco', state: 'TX' },
    waveMiles: [15, 30, 30],
    members: [
      { city: 'Frisco', state: 'TX', role: 'hub' },
      { city: 'Celina', state: 'TX', role: 'wave1', wave: 1, clusterKey: 2, miles: 10 },
    ],
  });
  const celina = (rb.members || []).find((m) => m.city === 'Celina');
  assertEqual(celina?.wave, undefined, 'scrub drops wave');
  assertEqual(celina?.clusterKey, 2, 'scrub keeps clusterKey');
  assertEqual(celina?.role, 'member', 'scrub member role');
} else {
  console.log('test-shotgun: skip listViableHubs (Census map or CSV missing)');
}

{
  const empty = findPlaceFeatures([]);
  assert(Array.isArray(empty.features) && empty.features.length === 0, 'empty places batch');
  const over = Array.from({ length: 45 }, (_, i) => ({ city: `Nope${i}`, state: 'KS' }));
  const capped = findPlaceFeatures(over, { max: 40 });
  assertEqual(capped.missing.length, 40, 'places batch cap 40');
}

if (existsSync(placesGeojsonPath())) {
  const boxed = getMapGeojson({
    layer: 'places',
    minPop: 3000,
    states: 'KS,MO',
    bbox: '-95.1,38.6,-94.3,39.4',
  });
  assert(boxed.features.length > 0, 'bbox geojson returns nearby places');
  assert(boxed.features.length < 800, 'bbox geojson is not the whole nation');
  assert(boxed.features.every((f) => Number(f.properties.population) >= 3000), 'bbox respects minPop');

  const wide = getMapGeojson({
    layer: 'places',
    minPop: 0,
    states: 'KS,MO',
    bbox: '-95.1,38.6,-94.3,39.4',
  });
  const tight = getMapGeojson({
    layer: 'places',
    minPop: 20000,
    states: 'KS,MO',
    bbox: '-95.1,38.6,-94.3,39.4',
  });
  assert(
    wide.features.some((f) => Number(f.properties.population) < 20000),
    'bbox minPop 0 includes places below 20k',
  );
  assert(
    tight.features.every((f) => Number(f.properties.population) >= 20000),
    'bbox minPop 20000 drops places below 20k',
  );

  const mesq = placeInZoneRadius('Mesquite', 'TX', 'Dallas', 'TX', 52);
  assert(mesq.inZone, 'Mesquite is inside 52 mi of Dallas');
  const tyler = placeInZoneRadius('Tyler', 'TX', 'Dallas', 'TX', 52);
  assert(!tyler.inZone, 'Tyler is outside 52 mi of Dallas');
  const burleson52 = placeInZoneRadius('Burleson', 'TX', 'Dallas', 'TX', 52);
  const burleson30 = placeInZoneRadius('Burleson', 'TX', 'Dallas', 'TX', 30);
  assert(burleson52.inZone, 'Burleson is inside 52 mi of Dallas');
  assert(!burleson30.inZone, 'Burleson is outside 30 mi of Dallas');
  const denton52 = placeInZoneRadius('Denton', 'TX', 'Dallas', 'TX', 52);
  const denton30 = placeInZoneRadius('Denton', 'TX', 'Dallas', 'TX', 30);
  assert(denton52.inZone, 'Denton is inside 52 mi of Dallas');
  assert(denton30.inZone, 'Denton polygon still intersects 30 mi disk');
  assert(Number(denton30.miles) > 30.5, 'Denton centroid is outside 30 mi ring');
} else {
  console.log('test-shotgun: skip geojson bbox (Census map missing)');
}

if (existsSync(placesGeojsonPath())) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rover-zone-paint-'));
  const file = path.join(dir, 'shotgun-clusters.json');
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        clusters: [
          {
            id: 'sg_dallas',
            niche: 'Concrete',
            name: 'Zone · Concrete · Dallas TX',
            hub: { city: 'Dallas', state: 'TX', population: 1304379 },
            clusterMiles: 52,
            members: [{ city: 'Dallas', state: 'TX', role: 'hub' }],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  setShotgunClustersFileForTests(file);
  try {
    const painted = paintZoneMember('sg_dallas', {
      city: 'Mesquite',
      state: 'TX',
      tool: 'cluster',
      slot: 1,
      radiusMiles: 52,
      minPop: 20000,
      maxPop: 200000,
    });
    const mesq = (painted.cluster.members || []).find((m) => m.city === 'Mesquite');
    assertEqual(Number(mesq?.clusterKey), 1, 'Mesquite Cluster 1 inside 52 mi');
    const irvingPaint = paintZoneMember('sg_dallas', {
      city: 'Irving',
      state: 'TX',
      tool: 'cluster',
      slot: 3,
      radiusMiles: 52,
      minPop: 20000,
      maxPop: 200000,
    });
    const irving = (irvingPaint.cluster.members || []).find((m) => m.city === 'Irving');
    assertEqual(Number(irving?.clusterKey), 3, 'Irving Cluster 3 even though pop is above map max');
    const rendonPaint = paintZoneMember('sg_dallas', {
      city: 'Rendon',
      state: 'TX',
      tool: 'cluster',
      slot: 5,
      radiusMiles: 69,
      minPop: 20000,
      maxPop: 200000,
    });
    const rendon = (rendonPaint.cluster.members || []).find((m) => m.city === 'Rendon');
    assertEqual(Number(rendon?.clusterKey), 5, 'Rendon Cluster 5 even though pop is below map min');
    const burlesonPaint = paintZoneMember('sg_dallas', {
      city: 'Burleson',
      state: 'TX',
      tool: 'cluster',
      slot: 2,
      radiusMiles: 52,
      minPop: 20000,
      maxPop: 200000,
    });
    const burleson = (burlesonPaint.cluster.members || []).find((m) => m.city === 'Burleson');
    assertEqual(Number(burleson?.clusterKey), 2, 'Burleson Cluster 2 inside 52 mi');
    const dentonPaint = paintZoneMember('sg_dallas', {
      city: 'Denton',
      state: 'TX',
      tool: 'cluster',
      slot: 4,
      radiusMiles: 52,
      minPop: 20000,
      maxPop: 200000,
    });
    const denton = (dentonPaint.cluster.members || []).find((m) => m.city === 'Denton');
    assertEqual(Number(denton?.clusterKey), 4, 'Denton Cluster 4 inside 52 mi');
    let farErr = '';
    try {
      paintZoneMember('sg_dallas', {
        city: 'Tyler',
        state: 'TX',
        tool: 'cluster',
        slot: 1,
        radiusMiles: 52,
        minPop: 20000,
        maxPop: 200000,
      });
    } catch (error) {
      farErr = error.message || '';
    }
    assert(/outside the Zone radius/i.test(farErr), 'Tyler rejected as outside zone');
    const shrunk = setZoneMiles('sg_dallas', 30);
    const burlesonAfter = (shrunk.cluster.members || []).find((m) => m.city === 'Burleson');
    assert(!burlesonAfter || !memberClusterKey(burlesonAfter), 'Burleson dropped when radius shrinks past it');
    const dentonAfter = (shrunk.cluster.members || []).find((m) => m.city === 'Denton');
    assert(!dentonAfter || !memberClusterKey(dentonAfter), 'Denton dropped: centroid outside 30 mi even if polygon intersects');
    let denton30Err = '';
    try {
      paintZoneMember('sg_dallas', {
        city: 'Denton',
        state: 'TX',
        tool: 'cluster',
        slot: 4,
        radiusMiles: 30,
      });
    } catch (error) {
      denton30Err = error.message || '';
    }
    assert(/outside the Zone radius/i.test(denton30Err), 'Denton rejected at 30 mi by centroid');
    const mesqAfter = (shrunk.cluster.members || []).find((m) => m.city === 'Mesquite');
    assertEqual(Number(mesqAfter?.clusterKey), 1, 'Mesquite stays inside 30 mi');
    const dallas = (shrunk.cluster.members || []).find((m) => m.city === 'Dallas');
    assert(dallas?.role === 'hub', 'Dallas hub stays after radius shrink');
    assertEqual(Number(shrunk.cluster.clusterMiles), 30, 'Zone miles saved as 30');
  } finally {
    setShotgunClustersFileForTests(null);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

{
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rover-cluster-'));
  const file = path.join(dir, 'shotgun-clusters.json');
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        clusters: [
          {
            id: 'sg_test',
            niche: 'Test Niche',
            name: 'Cluster · Test',
            hub: { city: 'Olathe', state: 'KS' },
            members: [
              { city: 'Olathe', state: 'KS', role: 'hub', candidateId: 'c_hub' },
              { city: 'Lenexa', state: 'KS', role: 'city', candidateId: 'c_city' },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  setShotgunClustersFileForTests(file);
  try {
    let hubErr = '';
    try {
      await removeClusterCity('sg_test', { city: 'Olathe', state: 'KS' });
    } catch (error) {
      hubErr = error.message || '';
    }
    assert(/Hub/.test(hubErr), 'cannot remove hub while cluster cities remain');
    const added = addClusterCity('sg_test', { city: 'Lenexa', state: 'KS' });
    assertEqual(added.created, false, 'add existing city is idempotent');
    const removed = await removeClusterCity('sg_test', {
      city: 'Lenexa',
      state: 'KS',
      disposition: 'standalone',
    });
    assertEqual(removed.removed.city, 'Lenexa', 'removed cluster city');
    assertEqual(
      (removed.cluster.members || []).filter((m) => isPackMember(m) && m.role !== 'hub').length,
      0,
      'city gone after remove',
    );
    let missing = '';
    try {
      addClusterCity('sg_nope', { city: 'Lenexa', state: 'KS' });
    } catch (error) {
      missing = error.message || '';
    }
    assert(/not found/i.test(missing), 'add to missing cluster');
  } finally {
    setShotgunClustersFileForTests(null);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

{
  const before = [
    { city: 'Georgetown', state: 'TX', role: 'hub', clusterKey: 1, candidateId: 'georgetown-custom-cabinets' },
    { city: 'Leander', state: 'TX', role: 'member', clusterKey: 1, candidateId: 'leander-custom-cabinets' },
    { city: 'Liberty Hill', state: 'TX', role: 'member', clusterKey: 1, candidateId: null },
    { city: 'Taylor', state: 'TX', role: 'unassigned' },
  ];
  const after = [
    ...before.filter((m) => m.city !== 'Taylor'),
    { city: 'Taylor', state: 'TX', role: 'member', clusterKey: 2 },
    { city: 'Hutto', state: 'TX', role: 'member', clusterKey: 3 },
  ];
  const listed = zoneCitiesAwaitingCandidate(before, after);
  assertEqual(listed.map((c) => c.city).join(','), 'Liberty Hill,Taylor,Hutto', 'close lists stranded and new cities');
  const liberty = listed.find((c) => c.city === 'Liberty Hill');
  assertEqual(liberty.clusterKey, 1, 'liberty hill cluster');
  assertEqual(liberty.paintedThisOpen, false, 'stranded city was already on the zone');
  assertEqual(liberty.previousClusterKey, 1, 'stranded previous cluster');
  const taylor = listed.find((c) => c.city === 'Taylor');
  assertEqual(taylor.paintedThisOpen, true, 'unassigned paint counts as this open');
  assertEqual(taylor.previousClusterKey, 0, 'taylor had no cluster');
  assertEqual(taylor.clusterKey, 2, 'taylor cluster 2');
  const hutto = listed.find((c) => c.city === 'Hutto');
  assertEqual(hutto.paintedThisOpen, true, 'new city painted this open');
  assertEqual(hutto.previousClusterKey, null, 'new city has no previous cluster');
  const cleared = zoneCitiesAwaitingCandidate(before, before.filter((m) => m.city !== 'Liberty Hill'));
  assertEqual(cleared.length, 0, 'clearing a city before close drops it');
  const moved = zoneCitiesAwaitingCandidate(before, [
    { city: 'Liberty Hill', state: 'TX', role: 'member', clusterKey: 4 },
  ]);
  assertEqual(moved[0].paintedThisOpen, true, 'cluster change counts as this open');
  assertEqual(moved[0].previousClusterKey, 1, 'cluster change remembers the old slot');
  assertEqual(moved[0].clusterKey, 4, 'cluster change shows the new slot');
  const hasCandidate = zoneCitiesAwaitingCandidate(before, [
    { city: 'Leander', state: 'TX', role: 'member', clusterKey: 5, candidateId: 'leander-custom-cabinets' },
  ]);
  assertEqual(hasCandidate.length, 0, 'cities that already have a candidate are not listed');
}

console.log('test-shotgun: ok');
