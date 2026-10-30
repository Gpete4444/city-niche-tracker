/**
 * Zone (product): one niche × one metro. Hub + cities inside the outer radius.
 * Cluster: rental package / build schedule 1–20 inside a Zone (clusterKey).
 * Batch draft: research/batches/{id}/shotgun.json
 * Pipeline registry: research/shotgun-clusters.json (Zone records).
 * Stored packType: cluster | single (aliases: shotgun, scout).
 * Stored roles: hub | member | unassigned. Legacy waveN / city migrate to Cluster.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadCensusIndex, normalizePlaceName, ABBR_TO_NAME, lookupPopulation } from './census.mjs';
import {
  shotgunRingPools,
  findPlaceFeatureLocal,
  featureCentroid,
  placeInZoneRadius,
  toCoverageAreas,
  MAX_CLUSTER_MILES,
} from './geo-neighbors.mjs';
import {
  RESEARCH_DIR,
  createCandidate,
  deleteCandidates,
  pathsFor,
  setArchived,
  titleCaseNiche,
} from './candidates.mjs';
import { candidateGeoKey, findCandidateByGeo, indexCandidatesByGeo } from './known-candidates.mjs';
import {
  createGroup,
  renameGroup,
  GROUP_SCOPE_CANDIDATES,
  loadGroupsRegistry,
  updateGroupMembers,
} from './candidate-groups.mjs';
import { isCandidateLaunched } from './launched-edit-guard.mjs';
import { isUndeletableCandidate } from './candidate-protection.mjs';

export const SHOTGUN_ROLES = ['hub', 'member', 'unassigned'];
export const CLUSTER_MAX = 20;
/** Cluster 1–20 fills. */
export const CLUSTER_COLORS = [
  '#059669',
  '#d97706',
  '#7c3aed',
  '#0284c7',
  '#e11d48',
  '#0d9488',
  '#c026d3',
  '#65a30d',
  '#ea580c',
  '#4f46e5',
  '#0ea5e9',
  '#a21caf',
  '#ca8a04',
  '#be185d',
  '#047857',
  '#4338ca',
  '#c2410c',
  '#0f766e',
  '#5b21b6',
  '#b45309',
];

/** Read-only: old drafts used wave1…wave10 roles. Not a product cap. */
function legacyWaveIndex(roleOrMember) {
  if (roleOrMember && typeof roleOrMember === 'object') {
    const n = Math.round(Number(roleOrMember.wave));
    if (Number.isFinite(n) && n >= 1 && n <= 10) return n;
    roleOrMember = roleOrMember.role;
  }
  const r = String(roleOrMember || '').trim().toLowerCase();
  if (r === 'city') return 1;
  const m = /^wave([1-9]|10)$/.exec(r);
  return m ? Number(m[1]) : 0;
}

export function parseClusterKey(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 1 || n > CLUSTER_MAX) return 0;
  return n;
}

export function clusterColor(n) {
  const i = parseClusterKey(n);
  if (!i) return '';
  return CLUSTER_COLORS[i - 1] || CLUSTER_COLORS[0];
}

export function memberClusterKey(m) {
  return parseClusterKey(m?.clusterKey);
}

export function normalizeMember(m) {
  if (!m || typeof m !== 'object') return m;
  const roleNorm = normalizeClusterRole(m.role);
  const isHub = roleNorm === 'hub';
  const wave = legacyWaveIndex(m);
  let clusterKey = memberClusterKey(m);
  if (!isHub && !clusterKey && wave >= 1) clusterKey = wave;
  const keepMember =
    !isHub &&
    (clusterKey >= 1 ||
      String(m.source || '') === 'claude' ||
      ((roleNorm === 'member' || roleNorm === 'city' || wave >= 1) &&
        String(m.source || '') !== 'manual'));
  const role = isHub ? 'hub' : keepMember || clusterKey >= 1 ? 'member' : 'unassigned';
  const next = {
    ...m,
    role,
    clusterKey: clusterKey || null,
  };
  delete next.wave;
  return next;
}

export function isPackMember(m) {
  const n = normalizeMember(m);
  if (!n) return false;
  return n.role === 'hub' || n.role === 'member' || Boolean(n.clusterKey);
}

/** Next slot after painting: same slot toggles off; 0 / empty always clears. */
export function nextPaintSlot(current, slot) {
  const want = parseClusterKey(slot);
  if (!want) return 0;
  return current === want ? 0 : want;
}

export function applyMemberPaint(
  members,
  hub,
  { city, state, tool = 'cluster', slot = 0, population, miles, name, featState, mode = 'toggle' } = {},
) {
  const k = placeKey(city, state);
  if (!k) return (members || []).map(normalizeMember);
  const hubKey = hub?.city ? placeKey(hub.city, hub.state) : '';
  const isHub = Boolean(hubKey && k === hubKey);
  const displayCity = String(name || city || '').trim();
  const displayState = String(featState || state || '').trim().toUpperCase();
  let list = (members || []).map(normalizeMember);
  let idx = list.findIndex((m) => placeKey(m.city, m.state) === k);
  if (idx < 0 && isHub && hub) {
    list.unshift(
      normalizeMember({
        city: hub.city,
        state: hub.state,
        role: 'hub',
        miles: 0,
        population: hub.population ?? null,
      }),
    );
    idx = 0;
  }
  let row =
    idx >= 0
      ? { ...list[idx] }
      : normalizeMember({
          city: displayCity || city,
          state: displayState || state,
          role: isHub ? 'hub' : 'unassigned',
          population: population ?? null,
          miles: miles ?? null,
          pinned: true,
          source: 'manual',
        });
  if (isHub) row.role = 'hub';
  row.clusterKey =
    mode === 'set'
      ? parseClusterKey(slot) || null
      : nextPaintSlot(memberClusterKey(row), slot) || null;
  if (!isHub && !row.clusterKey && mode === 'set' && String(row.source || '') !== 'claude') {
    return idx >= 0 ? list.filter((_, i) => i !== idx).map(normalizeMember) : list.map(normalizeMember);
  }
  row = normalizeMember(row);
  if (population != null && row.population == null) row.population = population;
  if (miles != null && row.miles == null) row.miles = miles;
  if (row.pinned == null && !isHub) {
    row.pinned = true;
    row.source = row.source || 'manual';
  }
  if (!isHub && !row.clusterKey && row.role !== 'member') {
    return list.filter((_, i) => i !== idx).map(normalizeMember);
  }
  if (idx >= 0) list[idx] = row;
  else list.push(row);
  return list.map(normalizeMember);
}

export function applyMemberPaintMany(members, hub, { cities = [], slot = 0, mode = 'set' } = {}) {
  let list = members || [];
  for (const c of cities) {
    if (!c?.city || !c?.state) continue;
    list = applyMemberPaint(list, hub, {
      city: c.city,
      state: c.state,
      tool: 'cluster',
      slot,
      mode,
      population: c.population,
      miles: c.miles,
      name: c.name || c.city,
      featState: c.featState || c.state,
    });
  }
  return list;
}

function memberPaintSignature(members) {
  return (members || [])
    .map((m) => `${placeKey(m?.city, m?.state)}:${memberClusterKey(m) || 0}`)
    .sort()
    .join('|');
}

/** Same slack as the Zone map ring (`_sgMiles` vs outerMiles + 0.5). */
export const ZONE_RADIUS_SLACK = 0.5;

/** Centroid miles vs the circle — not polygon intersection. */
export function centroidInsideZone(zone, miles) {
  const cap = clampClusterMiles(miles);
  const dist = Number(zone?.miles);
  if (Number.isFinite(dist)) return dist <= cap + ZONE_RADIUS_SLACK;
  return Boolean(zone?.inZone);
}

/** Drop Cluster paints that fall outside the Zone radius. Hub stays. Unknown geos stay. */
export function pruneMembersOutsideZone(hub, members, miles) {
  const cap = clampClusterMiles(miles);
  if (!hub?.city || !hub?.state) return (members || []).map(normalizeMember);
  const hubKey = placeKey(hub.city, hub.state);
  let next = (members || []).map(normalizeMember);
  for (const m of [...next]) {
    if (!m) continue;
    if (m.role === 'hub' || placeKey(m.city, m.state) === hubKey) continue;
    if (!memberClusterKey(m)) continue;
    const zone = placeInZoneRadius(m.city, m.state, hub.city, hub.state, cap);
    if (centroidInsideZone(zone, cap)) continue;
    if (!zone.hubFeat || (!zone.feat && zone.miles == null)) continue;
    next = applyMemberPaint(next, hub, {
      city: m.city,
      state: m.state,
      tool: 'cluster',
      slot: 0,
      population: m.population,
      miles: zone.miles,
      name: m.city,
      featState: m.state,
    });
  }
  return next;
}

/** Move Hub to another city; keep Cluster paints. Clicking the current hub is a no-op. */
export function setZoneHub(
  members,
  { fromCity, fromState, toCity, toState, population, miles } = {},
) {
  const fromKey = placeKey(fromCity, fromState);
  const toKey = placeKey(toCity, toState);
  let list = (members || []).map(normalizeMember);
  if (!toKey || (fromKey && fromKey === toKey)) return list;
  if (fromKey) {
    const fromIdx = list.findIndex((m) => placeKey(m.city, m.state) === fromKey);
    if (fromIdx >= 0) {
      const prev = list[fromIdx];
      list[fromIdx] = normalizeMember({ ...prev, role: 'unassigned' });
    } else {
      list.push(
        normalizeMember({
          city: fromCity,
          state: fromState,
          role: 'unassigned',
        }),
      );
    }
  }
  const idx = list.findIndex((m) => placeKey(m.city, m.state) === toKey);
  const incoming = {
    city: toCity,
    state: toState,
    role: 'hub',
    miles: miles ?? 0,
    population: population ?? null,
  };
  if (idx >= 0) {
    list[idx] = normalizeMember({
      ...list[idx],
      ...incoming,
      population: population ?? list[idx].population ?? null,
      miles: 0,
      role: 'hub',
    });
  } else {
    list.unshift(normalizeMember(incoming));
  }
  return list.map(normalizeMember);
}

export function isPinnedMember(m) {
  return Boolean(m?.pinned) || String(m?.source || '') === 'manual';
}

export const SHOTGUN_ROLE_LABELS = {
  hub: 'Hub',
  main: 'Hub',
  member: 'Member',
  city: 'Member',
  unassigned: 'Unassigned',
};

/** Persist hub | member | unassigned. Legacy waveN / city → member. */
export function normalizeClusterRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'hub' || r === 'main') return 'hub';
  if (r === 'unassigned') return 'unassigned';
  if (r === 'member' || r === 'city' || legacyWaveIndex(r) >= 1) return 'member';
  return '';
}

export function isClusterMemberRole(role, member) {
  if (member) return isPackMember({ ...member, role: role || member.role });
  const r = normalizeClusterRole(role);
  return r === 'hub' || r === 'member';
}

export function formatShotgunSg(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1) return '';
  return String(Math.trunc(v)).padStart(3, '0');
}

export function shotgunRoleLabel(role, member) {
  const r = normalizeClusterRole(role || member?.role);
  if (r === 'hub') return 'Hub';
  const ck = member ? memberClusterKey(member) : 0;
  if (ck >= 1) return `Cluster ${ck}`;
  if (r === 'member') return 'Member';
  return SHOTGUN_ROLE_LABELS[String(role || '').trim().toLowerCase()] || '';
}

export function nextShotgunSgNumber(clusters = []) {
  let max = 0;
  for (const c of clusters) {
    const n = Number(c.sgNumber);
    if (Number.isFinite(n) && n > max) max = Math.trunc(n);
  }
  return max + 1;
}

/** Assign missing sgNumber values in place. Returns true if any cluster changed. */
export function ensureShotgunSgNumbers(registry) {
  const clusters = registry?.clusters || [];
  const used = new Set();
  for (const c of clusters) {
    const n = Number(c.sgNumber);
    if (Number.isFinite(n) && n >= 1) used.add(Math.trunc(n));
  }
  const missing = clusters.filter((c) => {
    const n = Number(c.sgNumber);
    return !Number.isFinite(n) || n < 1;
  });
  missing.sort(
    (a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
      String(a.id || '').localeCompare(String(b.id || '')),
  );
  let next = 1;
  let dirty = false;
  for (const c of missing) {
    while (used.has(next)) next += 1;
    c.sgNumber = next;
    used.add(next);
    next += 1;
    dirty = true;
  }
  return dirty;
}

/** Thin/viable mins only. Cluster city maximums are not enforced. */
export const CLUSTER_CITY_CAP = { min: 3, max: 99 };

export const DEFAULT_SHOTGUN_BANDS = {
  hub: { min: 60000, max: 200000 },
  cities: { min: 2000, max: 60000 },
};

export const HUB_MAX_SLACK = 0.1;

export const DEFAULT_CLUSTER_MILES = 30;
export const DEFAULT_SHOTGUN_MILES = { inner: 30, outer: 30 };

export function clampClusterMiles(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_CLUSTER_MILES;
  return Math.max(1, Math.min(MAX_CLUSTER_MILES, n));
}

export const CLUSTERS_FILE = path.join(RESEARCH_DIR, 'shotgun-clusters.json');
export const CLAIMED_FILE = path.join(RESEARCH_DIR, 'shotgun-claimed.json');

let clustersFileOverride = null;

export function setShotgunClustersFileForTests(filePath) {
  clustersFileOverride = filePath || null;
}

function clustersFile() {
  return clustersFileOverride || CLUSTERS_FILE;
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function newClusterId() {
  return `sg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizePackType(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'shotgun' || v === 'cluster') return 'cluster';
  return 'single';
}

export function isClusterPack(raw) {
  return normalizePackType(raw) === 'cluster';
}

export function normalizeBand(raw, fallback) {
  const min = Number(raw?.min);
  const max = raw?.max;
  return {
    min: Number.isFinite(min) ? min : fallback.min,
    max: max == null || max === '' ? fallback.max : Number(max),
  };
}

function mergeLegacyCityBand(rawBands) {
  if (rawBands?.cities) return normalizeBand(rawBands.cities, DEFAULT_SHOTGUN_BANDS.cities);
  const w1 = rawBands?.wave1;
  const w2 = rawBands?.wave2;
  if (w1 || w2) {
    const min = Math.min(
      Number(w2?.min) || DEFAULT_SHOTGUN_BANDS.cities.min,
      Number(w1?.min) || DEFAULT_SHOTGUN_BANDS.cities.min,
    );
    const max = Math.max(
      Number(w1?.max) || DEFAULT_SHOTGUN_BANDS.cities.max,
      Number(w2?.max) || DEFAULT_SHOTGUN_BANDS.cities.max,
    );
    return { min, max };
  }
  return { ...DEFAULT_SHOTGUN_BANDS.cities };
}

export function normalizeShotgunSettings(raw = {}) {
  const miles = clampClusterMiles(raw.clusterMiles ?? raw.outerMiles ?? raw.innerMiles);
  const cities = raw.bands?.cities
    ? normalizeBand(raw.bands.cities, DEFAULT_SHOTGUN_BANDS.cities)
    : mergeLegacyCityBand(raw.bands);
  return {
    clusterMiles: miles,
    innerMiles: miles,
    outerMiles: miles,
    bands: {
      hub: normalizeBand(raw.bands?.hub, DEFAULT_SHOTGUN_BANDS.hub),
      cities,
    },
  };
}

export function inPopBand(pop, band) {
  const n = Number(pop) || 0;
  const min = Number(band?.min);
  const max = band?.max;
  if (Number.isFinite(min) && n < min) return false;
  if (max != null && max !== '' && Number.isFinite(Number(max)) && n > Number(max)) return false;
  return true;
}

/** Hub band plus ~10% over max (Overland Park at 203k with a 200k cap). */
export function hubPopAllowed(pop, band) {
  const n = Number(pop) || 0;
  const min = Number(band?.min);
  const max = Number(band?.max);
  if (Number.isFinite(min) && n < min) return false;
  if (!Number.isFinite(max)) return true;
  if (n <= max) return true;
  return n <= max * (1 + HUB_MAX_SLACK);
}

export function isStateNamedPlace(city, state) {
  const abbr = String(state || '').trim().toUpperCase();
  const n = normalizePlaceName(city);
  if (!n || abbr.length !== 2) return false;
  if (n === abbr.toLowerCase()) return true;
  const full = ABBR_TO_NAME[abbr];
  return Boolean(full && n === normalizePlaceName(full));
}

export function placeKey(city, state) {
  return `${normalizePlaceName(city)}|${String(state || '').trim().toUpperCase()}`;
}

export function shotgunGeoKey({ niche, city, state }) {
  return candidateGeoKey({ niche, city, state });
}

export function cycleShotgunRole(role) {
  const r = normalizeClusterRole(role);
  return r === 'member' || r === 'hub' ? 'unassigned' : 'member';
}

export const MIN_NAP_MILES = 0.5;

export function emptyShotgunDraft(filters = {}) {
  const s = normalizeShotgunSettings({
    clusterMiles: filters.clusterMiles ?? filters.outerMiles ?? filters.innerMiles,
    innerMiles: filters.innerMiles,
    outerMiles: filters.outerMiles,
    bands: filters.bands || filters.shotgunBands,
  });
  return {
    strategy: 'cluster',
    step: 'hub',
    niche: titleCaseNiche(filters.shotgunNiche || filters.requiredNiches?.[0] || ''),
    hub: null,
    clusterMiles: s.clusterMiles,
    innerMiles: s.innerMiles,
    outerMiles: s.outerMiles,
    bands: s.bands,
    hubs: [],
    viableHubs: [],
    rejectedHubs: [],
    hubScan: null,
    members: [],
    clusterId: null,
    groupId: null,
    source: 'discovery',
    updatedAt: nowIso(),
  };
}

export function shotgunPathForBatch(batchDir) {
  return path.join(batchDir, 'shotgun.json');
}

function cityListOf(rows) {
  return Array.isArray(rows) ? rows.filter(Boolean) : [];
}

export function hubInnerCities(h) {
  const next = cityListOf(h?.innerCities);
  if (next.length) return next;
  return cityListOf(h?.wave1);
}

export function hubOuterCities(h) {
  const next = cityListOf(h?.outerCities);
  if (next.length) return next;
  return cityListOf(h?.wave2);
}

export function hubCitiesPreferred(h) {
  const next = cityListOf(h?.citiesPreferred);
  if (next.length) return next;
  return [...cityListOf(h?.wave1Preferred), ...cityListOf(h?.wave2Preferred)];
}

function scrubHubRow(h) {
  if (!h || typeof h !== 'object') return { hub: h, dirty: false };
  const hub = { ...h };
  let dirty = false;
  if (!Array.isArray(hub.innerCities) && Array.isArray(hub.wave1)) {
    hub.innerCities = hub.wave1;
    dirty = true;
  }
  if (!Array.isArray(hub.outerCities) && Array.isArray(hub.wave2)) {
    hub.outerCities = hub.wave2;
    dirty = true;
  }
  if (!Array.isArray(hub.citiesPreferred)) {
    const pref = [...cityListOf(hub.wave1Preferred), ...cityListOf(hub.wave2Preferred)];
    if (pref.length) {
      hub.citiesPreferred = pref;
      dirty = true;
    }
  }
  for (const key of ['wave1', 'wave2', 'wave1Preferred', 'wave2Preferred']) {
    if (key in hub) {
      delete hub[key];
      dirty = true;
    }
  }
  return { hub, dirty };
}

function scrubHubList(list) {
  if (!Array.isArray(list)) return { list, dirty: false };
  let dirty = false;
  const next = list.map((h) => {
    const { hub, dirty: rowDirty } = scrubHubRow(h);
    if (rowDirty) dirty = true;
    return hub;
  });
  return { list: next, dirty };
}

function scrubBands(bands) {
  if (!bands || typeof bands !== 'object') return { bands, dirty: false };
  const next = { ...bands };
  let dirty = false;
  if (!next.cities && (next.wave1 || next.wave2)) {
    next.cities = mergeLegacyCityBand(bands);
    dirty = true;
  }
  if ('wave1' in next) {
    delete next.wave1;
    dirty = true;
  }
  if ('wave2' in next) {
    delete next.wave2;
    dirty = true;
  }
  return { bands: next, dirty };
}

/** Copy legacy Wave roles/lists → Cluster / Zone fields, then drop Wave keys. */
export function scrubShotgunRecord(raw) {
  if (!raw || typeof raw !== 'object') return { record: raw, dirty: false };
  const record = { ...raw };
  let dirty = false;
  if (Array.isArray(record.waveMiles) && record.waveMiles.length) {
    const last = Number(record.waveMiles[record.waveMiles.length - 1]);
    if (Number.isFinite(last) && (record.clusterMiles == null || record.clusterMiles === '')) {
      record.clusterMiles = clampClusterMiles(last);
      dirty = true;
    }
  }
  if ('waveCount' in record) {
    delete record.waveCount;
    dirty = true;
  }
  if ('waveMiles' in record) {
    delete record.waveMiles;
    dirty = true;
  }
  const bands = scrubBands(record.bands);
  if (bands.dirty) {
    record.bands = bands.bands;
    dirty = true;
  }
  for (const key of ['hubs', 'viableHubs', 'rejectedHubs']) {
    const { list, dirty: listDirty } = scrubHubList(record[key]);
    if (listDirty) {
      record[key] = list;
      dirty = true;
    }
  }
  if (record.hub && typeof record.hub === 'object') {
    const { hub, dirty: hubDirty } = scrubHubRow(record.hub);
    if (hubDirty) {
      record.hub = hub;
      dirty = true;
    }
  }
  if (Array.isArray(record.members)) {
    record.members = record.members.map((m) => {
      const next = normalizeMember(m);
      if (
        next.role !== m.role ||
        next.clusterKey !== (m.clusterKey ?? null) ||
        Object.prototype.hasOwnProperty.call(m, 'wave')
      ) {
        dirty = true;
      }
      return next;
    });
  }
  return { record, dirty };
}

export function loadShotgunDraft(batchDir) {
  const raw = readJson(shotgunPathForBatch(batchDir), null);
  if (!raw) return null;
  const { record, dirty } = scrubShotgunRecord(raw);
  if (dirty) writeJson(shotgunPathForBatch(batchDir), { ...record, updatedAt: nowIso() });
  return record;
}

export function saveShotgunDraft(batchDir, draft) {
  const { record } = scrubShotgunRecord({ ...draft, updatedAt: nowIso() });
  writeJson(shotgunPathForBatch(batchDir), record);
  return record;
}

function migrateClusterRecord(cluster) {
  let dirty = false;
  if (cluster.name && String(cluster.name).startsWith('Shotgun ·')) {
    cluster.name = String(cluster.name).replace(/^Shotgun ·/, 'Zone ·');
    dirty = true;
  }
  if (cluster.name && String(cluster.name).startsWith('Cluster ·')) {
    cluster.name = String(cluster.name).replace(/^Cluster ·/, 'Zone ·');
    dirty = true;
  }
  if (dirty && cluster.groupId && String(cluster.name || '').startsWith('Zone ·')) {
    try {
      renameGroup(cluster.groupId, cluster.name);
    } catch {
      /* name collision or missing group */
    }
  }
  const settings = normalizeShotgunSettings(cluster);
  if (cluster.clusterMiles !== settings.clusterMiles) {
    cluster.clusterMiles = settings.clusterMiles;
    dirty = true;
  }
  if (!cluster.bands?.cities) {
    cluster.bands = {
      ...(cluster.bands || {}),
      hub: settings.bands.hub,
      cities: settings.bands.cities,
    };
    dirty = true;
  }
  if (cluster.bands && ('wave1' in cluster.bands || 'wave2' in cluster.bands)) {
    delete cluster.bands.wave1;
    delete cluster.bands.wave2;
    dirty = true;
  }
  if ('waveCount' in cluster) {
    delete cluster.waveCount;
    dirty = true;
  }
  if ('waveMiles' in cluster) {
    const last = Array.isArray(cluster.waveMiles) ? Number(cluster.waveMiles[cluster.waveMiles.length - 1]) : NaN;
    if (Number.isFinite(last) && (cluster.clusterMiles == null || cluster.clusterMiles === '')) {
      cluster.clusterMiles = clampClusterMiles(last);
    }
    delete cluster.waveMiles;
    dirty = true;
  }
  for (const m of cluster.members || []) {
    const next = normalizeMember(m);
    if (
      next.role !== m.role ||
      next.clusterKey !== (m.clusterKey ?? null) ||
      Object.prototype.hasOwnProperty.call(m, 'wave')
    ) {
      Object.assign(m, next);
      delete m.wave;
      dirty = true;
    }
  }
  return dirty;
}

let shotgunDraftsScrubbed = false;

export function scrubAllShotgunDrafts() {
  if (shotgunDraftsScrubbed) return;
  shotgunDraftsScrubbed = true;
  const batchesDir = path.join(RESEARCH_DIR, 'batches');
  if (!existsSync(batchesDir)) return;
  let names = [];
  try {
    names = readdirSync(batchesDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of names) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(batchesDir, ent.name);
    if (!existsSync(shotgunPathForBatch(dir))) continue;
    loadShotgunDraft(dir);
  }
}

export function loadShotgunClusters() {
  const raw = readJson(clustersFile(), { clusters: [] });
  const clusters = Array.isArray(raw?.clusters) ? raw.clusters : [];
  const registry = {
    clusters: clusters.filter((c) => c && typeof c === 'object' && c.id),
  };
  let dirty = ensureShotgunSgNumbers(registry);
  for (const c of registry.clusters) {
    if (migrateClusterRecord(c)) dirty = true;
  }
  if (dirty) {
    writeJson(clustersFile(), { clusters: registry.clusters });
  }
  scrubAllShotgunDrafts();
  return registry;
}

function saveShotgunClusters(registry) {
  writeJson(clustersFile(), { clusters: registry.clusters || [] });
  writeClaimedGeos(registry.clusters || []);
  return loadShotgunClusters();
}

function retitleZoneLabel(label, oldNiche, nextNiche, hubCity, hubState) {
  const text = String(label || '');
  const oldAuto = clusterName(oldNiche, hubCity, hubState);
  const newAuto = clusterName(nextNiche, hubCity, hubState);
  if (!oldAuto || oldAuto === newAuto) return text;
  if (text === oldAuto) return newAuto;
  if (text.startsWith(`${oldAuto} ·`)) return newAuto + text.slice(oldAuto.length);
  const oldPrefix = `Zone · ${oldNiche} ·`;
  if (text.startsWith(oldPrefix)) return `Zone · ${nextNiche} ·${text.slice(oldPrefix.length)}`;
  return text;
}

function syncLinkedZoneGroup(cluster) {
  const desired = String(cluster?.name || '').trim();
  if (!desired || !cluster?.groupId) return 0;
  const registry = loadGroupsRegistry();
  const group = (registry.groups || []).find((g) => g.id === cluster.groupId);
  if (!group || group.name === desired) return 0;
  try {
    renameGroup(group.id, desired);
    return 1;
  } catch {
    return 0;
  }
}

function renameGroupsWithPrefix(oldNiche, nextNiche, oldAuto, newAuto) {
  const oldPrefix = `Zone · ${oldNiche} ·`;
  const newPrefix = `Zone · ${nextNiche} ·`;
  if (oldPrefix === newPrefix) return 0;
  const registry = loadGroupsRegistry();
  let renamed = 0;
  for (const group of registry.groups || []) {
    const name = String(group.name || '');
    let next = name;
    if (oldAuto && newAuto && (name === oldAuto || name.startsWith(`${oldAuto} ·`))) {
      next = name === oldAuto ? newAuto : newAuto + name.slice(oldAuto.length);
    } else if (name.startsWith(oldPrefix)) {
      next = newPrefix + name.slice(oldPrefix.length);
    }
    if (next === name) continue;
    try {
      renameGroup(group.id, next);
      renamed += 1;
    } catch {
      /* missing group or name already taken */
    }
  }
  return renamed;
}

/** Title-case zone niche, auto zone names, and batch shotgun.json niche fields. */
export function backfillShotgunNicheTitleCase() {
  const registry = loadShotgunClusters();
  let clusters = 0;
  let groups = 0;
  for (const cluster of registry.clusters) {
    const oldNiche = String(cluster.niche || '');
    const nextNiche = titleCaseNiche(oldNiche);
    if (!nextNiche || nextNiche === oldNiche) continue;
    const hubCity = cluster.hub?.city || cluster.hub?.name || '';
    const hubState = cluster.hub?.state || '';
    const oldAuto = clusterName(oldNiche, hubCity, hubState);
    const newAuto = clusterName(nextNiche, hubCity, hubState);
    cluster.niche = nextNiche;
    cluster.name = retitleZoneLabel(cluster.name, oldNiche, nextNiche, hubCity, hubState);
    groups += renameGroupsWithPrefix(oldNiche, nextNiche, oldAuto, newAuto);
    clusters += 1;
  }
  for (const cluster of registry.clusters) {
    groups += syncLinkedZoneGroup(cluster);
  }
  if (clusters) saveShotgunClusters(registry);

  let drafts = 0;
  const batchesDir = path.join(RESEARCH_DIR, 'batches');
  if (existsSync(batchesDir)) {
    for (const ent of readdirSync(batchesDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const file = shotgunPathForBatch(path.join(batchesDir, ent.name));
      if (!existsSync(file)) continue;
      const draft = readJson(file, null);
      if (!draft || typeof draft !== 'object') continue;
      let dirty = false;
      if (typeof draft.niche === 'string') {
        const next = titleCaseNiche(draft.niche);
        if (next !== draft.niche) {
          draft.niche = next;
          dirty = true;
        }
      }
      if (Array.isArray(draft.requiredNiches)) {
        const next = draft.requiredNiches.map((item) => titleCaseNiche(item));
        if (next.some((item, i) => item !== draft.requiredNiches[i])) {
          draft.requiredNiches = next;
          dirty = true;
        }
      }
      if (!dirty) continue;
      writeJson(file, draft);
      drafts += 1;
    }
  }
  return { clusters, groups, drafts };
}

function writeClaimedGeos(clusters) {
  if (clustersFileOverride) return;
  const rows = [];
  const seen = new Set();
  for (const c of clusters) {
    const niche = c.niche || '';
    for (const m of c.members || []) {
      const key = shotgunGeoKey({ niche, city: m.city, state: m.state });
      if (!key || seen.has(key) || m.status === 'skipped') continue;
      seen.add(key);
      rows.push({
        niche,
        city: m.city,
        state: String(m.state || '').toUpperCase(),
        clusterId: c.id,
        role: m.role || '',
      });
    }
  }
  writeJson(CLAIMED_FILE, { geos: rows, updatedAt: nowIso() });
}

export function listShotgunClaimedGeos() {
  const raw = readJson(CLAIMED_FILE, { geos: [] });
  return Array.isArray(raw?.geos) ? raw.geos : [];
}

export function findShotgunClusterByHub(niche, city, state) {
  const key = placeKey(city, state);
  const n = String(niche || '').trim().toLowerCase();
  for (const c of loadShotgunClusters().clusters) {
    if (String(c.niche || '').trim().toLowerCase() !== n) continue;
    const hub = c.hub || {};
    if (placeKey(hub.city || hub.name, hub.state) === key) return c;
    const main = (c.members || []).find((m) => normalizeClusterRole(m.role) === 'hub');
    if (main && placeKey(main.city, main.state) === key) return c;
  }
  return null;
}

export function findShotgunMember(niche, city, state) {
  const key = placeKey(city, state);
  const n = String(niche || '').trim().toLowerCase();
  for (const c of loadShotgunClusters().clusters) {
    if (String(c.niche || '').trim().toLowerCase() !== n) continue;
    for (const m of c.members || []) {
      if (placeKey(m.city, m.state) === key) return { cluster: c, member: m };
    }
  }
  return null;
}

/** Painted cities only: hub, plus members that already have a cluster number. */
export function membersForZoneReuse(source) {
  const hub = source?.hub && typeof source.hub === 'object' ? source.hub : null;
  const out = [];
  const seen = new Set();
  const add = (raw, asHub) => {
    const m = normalizeMember(raw);
    if (!m?.city || !m?.state) return;
    const key = placeKey(m.city, m.state);
    if (!key || seen.has(key)) return;
    const clusterKey = memberClusterKey(m);
    if (!asHub && clusterKey < 1) return;
    seen.add(key);
    out.push({
      city: String(m.city).trim(),
      state: String(m.state).trim().toUpperCase(),
      role: asHub ? 'hub' : 'member',
      clusterKey: clusterKey >= 1 ? clusterKey : null,
      population: m.population ?? (asHub ? hub?.population ?? null : null),
      miles: asHub ? 0 : (m.miles ?? null),
      pinned: !asHub,
      source: 'zone-reuse',
    });
  };
  if (hub?.city && hub?.state) {
    const hubMember = (source.members || []).find(
      (m) => placeKey(m?.city, m?.state) === placeKey(hub.city, hub.state),
    );
    add(
      {
        city: hub.city,
        state: hub.state,
        role: 'hub',
        clusterKey: hubMember?.clusterKey ?? null,
        population: hubMember?.population ?? hub.population ?? null,
        miles: 0,
      },
      true,
    );
  }
  for (const raw of source?.members || []) {
    const role = normalizeClusterRole(normalizeMember(raw)?.role);
    add(raw, role === 'hub');
  }
  return out;
}

/**
 * Plan a new zone from a painted one. Same hub and cluster keys, next zone number.
 * Opens the existing zone when this niche already uses that hub.
 * Throws when a painted city is already in a different zone for this niche.
 */
export function buildZoneReuseDraft(source, niche) {
  const label = titleCaseNiche(niche);
  if (!label) {
    throw Object.assign(new Error('Cluster niche is required'), { status: 400 });
  }
  const hub = source?.hub;
  if (!hub?.city || !hub?.state) {
    throw Object.assign(new Error('That zone has no hub'), { status: 400 });
  }
  const existing = findShotgunClusterByHub(label, hub.city, hub.state);
  if (existing) return { existing: true, cluster: existing };
  const members = membersForZoneReuse(source);
  if (!members.some((m) => m.role === 'hub')) {
    throw Object.assign(new Error('That zone has no hub'), { status: 400 });
  }
  const hits = [];
  for (const m of members) {
    const hit = findShotgunMember(label, m.city, m.state);
    if (!hit) continue;
    hits.push(`${m.city}, ${m.state} is already in ${hit.cluster?.name || 'another zone'}`);
  }
  if (hits.length) {
    throw Object.assign(new Error(hits.slice(0, 3).join('; ')), { status: 400 });
  }
  const settings = normalizeShotgunSettings({
    clusterMiles: source.clusterMiles ?? source.outerMiles ?? source.innerMiles,
    bands: source.bands,
  });
  const registry = loadShotgunClusters();
  return {
    existing: false,
    niche: label,
    name: clusterName(label, hub.city, hub.state),
    sgNumber: nextShotgunSgNumber(registry.clusters),
    hub: {
      city: String(hub.city).trim(),
      state: String(hub.state).trim().toUpperCase(),
      population: hub.population ?? null,
      why: '',
    },
    clusterMiles: settings.clusterMiles,
    bands: settings.bands,
    members,
    reusedFromZoneId: source.id || null,
  };
}

export function clusterName(niche, hubCity, state) {
  const n = String(niche || 'Niche').trim();
  const city = String(hubCity || 'Hub').trim();
  const st = String(state || '').trim().toUpperCase();
  return `Zone · ${n} · ${city}${st ? ` ${st}` : ''}`.slice(0, 80);
}

export function scoreHubCity(city, state, settings = {}) {
  const s = normalizeShotgunSettings(settings);
  const rings = shotgunRingPools(city, state, {
    innerMiles: s.clusterMiles,
    outerMiles: s.clusterMiles,
    citiesBand: s.bands.cities,
  });
  const hubPop = Number(rings.primary?.population) || 0;
  const hubInBand = hubPopAllowed(hubPop, s.bands.hub);
  const cityCount = rings.innerPool.length + rings.outerPool.length;
  return {
    city: rings.primary?.name || city,
    state: rings.primary?.state || String(state || '').toUpperCase(),
    population: hubPop,
    innerCount: cityCount,
    outerCount: 0,
    innerSample: rings.innerPool.slice(0, 6).map((p) => p.name),
    outerSample: [],
    innerPool: [...rings.innerPool, ...rings.outerPool],
    outerPool: [],
    hubInBand,
    viable: Boolean(hubInBand && cityCount >= CLUSTER_CITY_CAP.min),
    rejectReason: !hubInBand
      ? 'hub population outside Hub band'
      : cityCount < CLUSTER_CITY_CAP.min
        ? `Cluster Cities pool ${cityCount} (need ≥ ${CLUSTER_CITY_CAP.min})`
        : null,
  };
}

function compactCity(p) {
  if (!p) return null;
  const city = String(p.city || p.name || '').trim();
  const state = String(p.state || '').trim().toUpperCase();
  if (!city || !state) return null;
  return {
    city,
    state,
    population: Number(p.population) || null,
    miles: p.miles == null || p.miles === '' ? null : Number(p.miles),
  };
}

function compactCityList(rows) {
  return (rows || []).map(compactCity).filter(Boolean);
}

export function compactHubScore(scored) {
  if (!scored) return null;
  const innerCities = compactCityList(scored.innerCities || scored.wave1 || scored.innerPool);
  const outerCities = compactCityList(scored.outerCities || scored.wave2 || scored.outerPool);
  const citiesPreferred = compactCityList(
    scored.citiesPreferred?.length
      ? scored.citiesPreferred
      : [...(scored.wave1Preferred || []), ...(scored.wave2Preferred || [])],
  );
  const hubPop = Number(scored.population) || 0;
  const clusterPop =
    hubPop + citiesPreferred.reduce((sum, c) => sum + (Number(c.population) || 0), 0);
  return {
    city: scored.city,
    state: scored.state,
    population: scored.population ?? null,
    innerCount: innerCities.length || scored.innerCount || 0,
    outerCount: outerCities.length || scored.outerCount || 0,
    innerSample: scored.innerSample || innerCities.slice(0, 6).map((c) => c.city),
    outerSample: scored.outerSample || outerCities.slice(0, 6).map((c) => c.city),
    innerCities,
    outerCities,
    clusterPop,
    hubInBand: scored.hubInBand,
    viable: Boolean(scored.viable),
    rejectReason: scored.rejectReason || null,
    why: scored.why || '',
    source: scored.source || '',
    citiesPreferred,
    unmatched: scored.unmatched || [],
    thinWarning: scored.thinWarning || '',
  };
}

/** All in-range Census cities, nearest first. */
export function seedMembersFromRings(scored) {
  const byMiles = (a, b) => (Number(a.miles) || 0) - (Number(b.miles) || 0);
  const innerSrc = scored.innerPool?.length ? scored.innerPool : scored.wave1 || [];
  const outerSrc = scored.outerPool?.length ? scored.outerPool : scored.wave2 || [];
  const inner = [...innerSrc].sort(byMiles);
  const outer = [...outerSrc].sort(byMiles);
  const rings = {
    primary: {
      name: scored.city,
      state: scored.state,
      population: scored.population,
    },
    innerPool: inner.map((p) => ({
      name: p.name || p.city,
      state: p.state,
      population: p.population,
      miles: p.miles,
    })),
    outerPool: outer.map((p) => ({
      name: p.name || p.city,
      state: p.state,
      population: p.population,
      miles: p.miles,
    })),
  };
  const all = [...inner, ...outer].map((p) => ({
    city: p.name || p.city,
    state: p.state,
    role: 'member',
    population: p.population,
    miles: p.miles,
  }));
  return membersFromAssign(
    {
      main: { city: scored.city, state: scored.state },
      cities: all,
    },
    rings,
  );
}

export function seedMembersFromPreferred(hubRow, scored) {
  const preferred = compactCityList(hubCitiesPreferred(hubRow));
  if (!preferred.length) return seedMembersFromRings(scored);
  const rings = {
    primary: {
      name: scored.city || hubRow.city,
      state: scored.state || hubRow.state,
      population: scored.population ?? hubRow.population,
    },
    innerPool: (scored.innerPool || []).map((p) => ({
      name: p.name || p.city,
      state: p.state,
      population: p.population,
      miles: p.miles,
    })),
    outerPool: (scored.outerPool || []).map((p) => ({
      name: p.name || p.city,
      state: p.state,
      population: p.population,
      miles: p.miles,
    })),
  };
  const extra = preferred.map((c) => ({
    name: c.city,
    state: c.state,
    population: c.population,
    miles: c.miles,
  }));
  for (const row of extra) {
    const k = placeKey(row.name, row.state);
    if (!rings.innerPool.some((p) => placeKey(p.name, p.state) === k) &&
        !rings.outerPool.some((p) => placeKey(p.name, p.state) === k)) {
      rings.outerPool.push(row);
    }
  }
  const capped = applyCityCaps({
    main: { city: scored.city || hubRow.city, state: scored.state || hubRow.state },
    cities: preferred.map((c) => ({ ...c, role: 'member' })),
  });
  return membersFromAssign(capped, rings);
}

function milesOfPlace(name, state, wideInner, wideOuter) {
  const k = placeKey(name, state);
  const hit =
    wideInner.find((p) => placeKey(p.name, p.state) === k) ||
    wideOuter.find((p) => placeKey(p.name, p.state) === k);
  return hit || null;
}

/**
 * Claude names the cluster; Census matches places and miles. Claude picks preferred.
 * Drop only when the hub place cannot be matched or hub pop is far outside the band.
 */
export function mergeClaudeHub(proposal, settings = {}) {
  const s = normalizeShotgunSettings(settings);
  const city = proposal.city || proposal.name;
  const state = proposal.state;
  if (!city || !state) {
    return { ok: false, rejectReason: 'missing city/state', unmatched: [] };
  }
  let scored;
  try {
    scored = scoreHubCity(city, state, s);
  } catch (error) {
    return {
      ok: false,
      rejectReason: error.message || 'No Census place match',
      unmatched: [],
    };
  }
  if (!hubPopAllowed(scored.population, s.bands.hub)) {
    return {
      ok: false,
      rejectReason: 'hub population outside Hub band',
      scored: compactHubScore(scored),
    };
  }
  let wide;
  try {
    wide = shotgunRingPools(scored.city, scored.state, {
      innerMiles: s.innerMiles,
      outerMiles: s.outerMiles,
      citiesBand: { min: 0, max: 5e7 },
    });
  } catch {
    wide = {
      innerPool: scored.innerPool || [],
      outerPool: scored.outerPool || [],
    };
  }
  const unmatched = [];
  const citiesPreferred = [];
  const seen = new Set([placeKey(scored.city, scored.state)]);
  const assignPreferred = (raw) => {
    const c = compactCity(raw);
    if (!c) return;
    const k = placeKey(c.city, c.state);
    if (seen.has(k)) return;
    const hit = milesOfPlace(c.city, c.state, wide.innerPool || [], wide.outerPool || []);
    if (!hit) {
      unmatched.push({ city: c.city, state: c.state, reason: 'Census unmatched' });
      return;
    }
    const miles = Number(hit.miles);
    if (Number.isFinite(miles) && miles > s.outerMiles + 0.15) {
      unmatched.push({ city: hit.name, state: hit.state, reason: `outside outer ${s.outerMiles} mi` });
      return;
    }
    seen.add(k);
    const row = {
      city: hit.name,
      state: hit.state,
      population: hit.population,
      miles: hit.miles,
    };
    if (hubPopAllowed(hit.population, s.bands.hub)) {
      unmatched.push({ city: row.city, state: row.state, reason: 'rival hub' });
      return;
    }
    citiesPreferred.push(row);
  };
  for (const row of proposal.cities || proposal.clusterCities || []) assignPreferred(row);
  for (const row of proposal.wave1 || []) assignPreferred(row);
  for (const row of proposal.wave2 || []) assignPreferred(row);
  const capped = applyCityCaps({
    main: { city: scored.city, state: scored.state },
    cities: citiesPreferred,
  });
  const preferred = capped.cities;
  const compact = compactHubScore({
    ...scored,
    why: proposal.why || '',
    source: 'claude',
    citiesPreferred: preferred,
    unmatched,
    thinWarning:
      scored.viable
        ? ''
        : scored.rejectReason || `Census pool thin (inner ${scored.innerCount}, outer ${scored.outerCount})`,
  });
  compact.citiesPreferred = preferred;
  compact.unmatched = unmatched;
  compact.source = 'claude';
  compact.why = String(proposal.why || '').trim();
  compact.viable = true;
  return { ok: true, hub: compact };
}

/** Claude clusters first; locked hub next; Census-only hubs that Claude skipped. */
export function mergePickerHubs(viable, claudeHubs, rejected = []) {
  const claude = (claudeHubs || []).map((h) => compactHubScore(h) || h);
  const keys = new Set(claude.map((h) => placeKey(h.city, h.state)));
  const lockedRows = [...(viable || []), ...(rejected || [])].filter((h) => h?.source === 'locked');
  for (const row of lockedRows) {
    const compact = compactHubScore(row) || row;
    if (!compact?.city || isStateNamedPlace(compact.city, compact.state)) continue;
    const k = placeKey(compact.city, compact.state);
    if (keys.has(k)) continue;
    keys.add(k);
    claude.push({ ...compact, source: 'locked' });
  }
  const extras = [];
  const seen = new Set(keys);
  for (const row of [...(viable || []), ...(rejected || []).filter((h) => h.hubInBand || h.source === 'locked')]) {
    const compact = compactHubScore(row) || row;
    if (!compact?.city || isStateNamedPlace(compact.city, compact.state)) continue;
    const k = placeKey(compact.city, compact.state);
    if (seen.has(k)) continue;
    seen.add(k);
    extras.push({ ...compact, source: compact.source || 'census' });
  }
  return { claude, censusExtras: extras };
}

function hubHasCityLists(h) {
  return Array.isArray(h?.innerCities) || Array.isArray(h?.wave1);
}

/**
 * Persist an explicitly locked hub (Create pack with a hub city) even when it
 * is outside the Hub band. Statewide listViableHubs stays skipped.
 */
export function ensureLockedHubOnDraft(draft) {
  const city = draft?.hub?.city;
  const state = draft?.hub?.state;
  if (!city || !state) return draft;
  const k = placeKey(city, state);
  const inHubs = (draft.hubs || []).find((h) => placeKey(h.city, h.state) === k);
  const inViable = (draft.viableHubs || []).find((h) => placeKey(h.city, h.state) === k);
  if ((inHubs && hubHasCityLists(inHubs)) || (inViable && hubHasCityLists(inViable))) {
    return draft;
  }
  let compact;
  try {
    compact = compactHubScore(scoreHubCity(city, state, draft));
  } catch (error) {
    compact = {
      city: String(city).trim(),
      state: String(state).trim().toUpperCase(),
      population: null,
      innerCount: 0,
      outerCount: 0,
      innerCities: [],
      outerCities: [],
      viable: false,
      hubInBand: false,
      rejectReason: error.message || 'No Census place match',
    };
  }
  compact = { ...compact, source: 'locked' };
  const viableHubs = [...(draft.viableHubs || [])];
  const idx = viableHubs.findIndex((h) => placeKey(h.city, h.state) === k);
  if (idx >= 0) viableHubs[idx] = { ...viableHubs[idx], ...compact, source: 'locked' };
  else viableHubs.unshift(compact);
  return { ...draft, viableHubs };
}

/** Claude clusters + Census extras (same set as the Discovery cluster table). */
export function shotgunDraftHubCount(draft) {
  const picked = mergePickerHubs(draft?.viableHubs, draft?.hubs, draft?.rejectedHubs);
  return picked.claude.length + picked.censusExtras.length;
}

/**
 * Census-scan Hub-band places in the given states (empty = nationwide).
 * Rings may still cross state lines. Does not write shotgun-claimed.json.
 */
export function listViableHubs(states, settings = {}) {
  const s = normalizeShotgunSettings(settings);
  const idx = loadCensusIndex();
  const abbrs = [
    ...new Set(
      (states || [])
        .map((st) => String(st || '').trim().toUpperCase())
        .filter((a) => a.length === 2),
    ),
  ];
  const pool = [];
  const seen = new Set();
  const addRows = (rows) => {
    for (const row of rows || []) {
      if (isStateNamedPlace(row.city, row.state)) continue;
      if (!hubPopAllowed(row.population, s.bands.hub)) continue;
      const k = placeKey(row.city, row.state);
      if (seen.has(k)) continue;
      seen.add(k);
      pool.push(row);
    }
  };
  if (!idx.ok) {
    return {
      scanned: 0,
      viable: [],
      rejected: [],
      settings: s,
      states: abbrs,
      error: idx.error || 'Census index unavailable',
    };
  }
  if (abbrs.length) {
    for (const abbr of abbrs) addRows(idx.byState.get(abbr) || []);
  } else {
    for (const rows of idx.byState.values()) addRows(rows);
  }
  const viable = [];
  const rejected = [];
  for (const row of pool) {
    try {
      const scored = compactHubScore(scoreHubCity(row.city, row.state, s));
      if (scored.viable) viable.push(scored);
      else rejected.push(scored);
    } catch (error) {
      rejected.push({
        city: row.city,
        state: row.state,
        population: row.population,
        viable: false,
        rejectReason: error.message || 'No Census place match',
      });
    }
  }
  viable.sort((a, b) => (Number(b.population) || 0) - (Number(a.population) || 0));
  return {
    scanned: pool.length,
    viable,
    rejected,
    settings: s,
    states: abbrs,
  };
}

export function formatHubHintTable(viable, rejected) {
  const rows = [...(viable || []), ...(rejected || [])].filter(
    (h) => h?.city && !isStateNamedPlace(h.city, h.state),
  );
  if (!rows.length) return '(no Hub-band Census places in these states)';
  return rows
    .map((h) => {
      const note = h.viable ? 'ok' : h.rejectReason || 'thin';
      return `${h.city}, ${h.state} · pop ${h.population || '?'} · inner ${h.innerCount ?? '?'} · outer ${h.outerCount ?? '?'} · ${note}`;
    })
    .join('\n');
}

export function formatViableHubsTable(viable) {
  const rows = viable || [];
  if (!rows.length) {
    return '(none — no Census-viable hubs in the Hub band with at least 3 Cluster Cities in range)';
  }
  return rows
    .map(
      (h) =>
        `${h.city}, ${h.state} · pop ${h.population || '?'} · inner ${h.innerCount ?? '?'} · outer ${h.outerCount ?? '?'}`,
    )
    .join('\n');
}

export function hubScanSummary(scan, settings = {}) {
  const s = normalizeShotgunSettings(scan?.settings || settings);
  const states = (scan?.states || []).filter(Boolean);
  return {
    scanned: Number(scan?.scanned) || 0,
    viableCount: (scan?.viable || []).length,
    rejectedCount: (scan?.rejected || []).length,
    states,
    hubMin: s.bands.hub.min,
    hubMax: s.bands.hub.max,
    innerMiles: s.innerMiles,
    outerMiles: s.outerMiles,
    citiesMin: s.bands.cities.min,
  };
}

/** Persist Census scan on this batch's shotgun.json only — never shotgun-claimed.json. */
export function applyHubScanToDraft(draft, scan) {
  const s = scan?.settings || normalizeShotgunSettings(draft || {});
  const summary = hubScanSummary(scan, s);
  return {
    ...draft,
    viableHubs: (scan?.viable || []).map((h) => compactHubScore(h) || h),
    rejectedHubs: (scan?.rejected || []).map((h) => compactHubScore(h) || h),
    hubScan: {
      scanned: summary.scanned,
      states: summary.states,
      hubMin: summary.hubMin,
      hubMax: summary.hubMax,
      innerMiles: summary.innerMiles,
      outerMiles: summary.outerMiles,
      citiesMin: summary.citiesMin,
      error: scan?.error || null,
    },
  };
}

export function gateProposedHubs(hubs, settings = {}, { viableKeys = null } = {}) {
  const survivors = [];
  const rejected = [];
  const allowed = viableKeys instanceof Set ? viableKeys : null;
  for (const h of hubs || []) {
    const city = h.city || h.name;
    const state = h.state;
    if (!city || !state) {
      rejected.push({ ...h, rejectReason: 'missing city/state' });
      continue;
    }
    const why = String(h.why || h.reason || '').trim();
    if (allowed && !allowed.has(placeKey(city, state))) {
      rejected.push({
        city,
        state,
        why,
        rejectReason: 'not in Census viable table',
      });
      continue;
    }
    try {
      const scored = compactHubScore(scoreHubCity(city, state, settings));
      if (scored.viable) {
        survivors.push({ ...scored, why });
      } else {
        rejected.push({ ...scored, why, rejectReason: scored.rejectReason });
      }
    } catch (error) {
      rejected.push({
        city,
        state,
        why,
        rejectReason: error.message || 'No Census place match',
      });
    }
  }
  return { survivors, rejected };
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw Object.assign(new Error('No JSON object in Claude result'), { status: 400 });
  }
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw Object.assign(new Error('Invalid JSON in Claude result'), { status: 400 });
  }
}

function asCityList(value) {
  if (Array.isArray(value)) return value;
  return [];
}

function normalizeHubEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const city = String(raw.city || raw.name || '').trim();
  const state = String(raw.state || '').trim().toUpperCase();
  if (!city || state.length !== 2) return null;
  return {
    city,
    state,
    why: String(raw.why || raw.reason || '').trim(),
    population: Number(raw.population) || null,
    cities: asCityList(raw.cities || raw.clusterCities || raw.wave1)
      .concat(asCityList(raw.wave2))
      .map((r) => normalizeAssignCity(r, 'city'))
      .filter(Boolean),
  };
}

export function parseFindHubsJson(text) {
  const data = extractJsonObject(text);
  const list = asCityList(data.hubs || data.metros || data.cities);
  const hubs = list.map(normalizeHubEntry).filter(Boolean);
  if (!hubs.length) {
    throw Object.assign(new Error('Find hubs JSON has no hubs'), { status: 400 });
  }
  return { hubs, raw: data };
}

function normalizeAssignCity(raw, role) {
  if (typeof raw === 'string') {
    const m = raw.match(/^(.+),\s*([A-Za-z]{2})$/);
    if (!m) return null;
    return { city: m[1].trim(), state: m[2].toUpperCase(), role };
  }
  const city = String(raw?.city || raw?.name || '').trim();
  const state = String(raw?.state || '').trim().toUpperCase();
  if (!city || state.length !== 2) return null;
  return {
    city,
    state,
    role,
    alreadySite: Boolean(raw.alreadySite),
    rivalHub: Boolean(raw.rivalHub),
  };
}

export function parseAssignCitiesJson(text) {
  const data = extractJsonObject(text);
  const hub = normalizeAssignCity(data.main || data.hub, 'hub');
  const fromCities = asCityList(data.cities || data.clusterCities || [])
    .map((r) => normalizeAssignCity(r, 'city'))
    .filter(Boolean);
  const legacy = [
    ...asCityList(data.wave1).map((r) => normalizeAssignCity(r, 'city')).filter(Boolean),
    ...asCityList(data.wave2).map((r) => normalizeAssignCity(r, 'city')).filter(Boolean),
  ];
  const cities = fromCities.length ? fromCities : legacy;
  const skipped = asCityList(data.skipped).map((r) => ({
    city: String(r.city || r.name || '').trim(),
    state: String(r.state || '').trim().toUpperCase(),
    reason: String(r.reason || r.why || '').trim(),
  }));
  if (!hub) {
    throw Object.assign(new Error('Assign cluster JSON missing hub'), { status: 400 });
  }
  return { main: hub, hub, cities, skipped, raw: data };
}

export function applyCityCaps({ main, hub, wave1, wave2, cities }) {
  const h = main || hub;
  const cityList = Array.isArray(cities) && cities.length
    ? cities
    : [...(wave1 || []), ...(wave2 || [])];
  return { main: h, hub: h, cities: cityList };
}

export function membersFromAssign({ main, hub, wave1, wave2, cities }, rings = null) {
  const head = main || hub;
  const cityList = Array.isArray(cities) && cities.length
    ? cities
    : [...(wave1 || []), ...(wave2 || [])];
  const milesOf = (city, state) => {
    const k = placeKey(city, state);
    const hit =
      rings?.innerPool?.find((p) => placeKey(p.name, p.state) === k) ||
      rings?.outerPool?.find((p) => placeKey(p.name, p.state) === k);
    return hit?.miles ?? null;
  };
  const popOf = (city, state) => {
    const k = placeKey(city, state);
    const hit =
      rings?.innerPool?.find((p) => placeKey(p.name, p.state) === k) ||
      rings?.outerPool?.find((p) => placeKey(p.name, p.state) === k);
    if (hit) return hit.population;
    if (rings?.primary && placeKey(rings.primary.name, rings.primary.state) === keyOfMain()) {
      return rings.primary.population;
    }
    return null;
  };
  const keyOfMain = () => placeKey(head.city, head.state);
  const rows = [
    {
      city: head.city,
      state: head.state,
      role: 'hub',
      population: popOf(head.city, head.state) ?? rings?.primary?.population ?? null,
      miles: 0,
    },
    ...cityList.map((c) =>
      normalizeMember({
        city: c.city,
        state: c.state,
        role: 'member',
        clusterKey: parseClusterKey(c.clusterKey) || null,
        population: c.population ?? popOf(c.city, c.state),
        miles: c.miles ?? milesOf(c.city, c.state),
        pinned: Boolean(c.pinned) || c.source === 'manual',
        source: c.source || (c.pinned ? 'manual' : 'claude'),
      }),
    ),
  ];
  return rows;
}

function lookupPipelineCity(niche, city, state) {
  const exact = findCandidateByGeo({ niche, city, state });
  if (exact) return annotatePipeline(exact);
  const n = String(niche || '').trim().toLowerCase();
  const want = placeKey(city, state);
  for (const row of indexCandidatesByGeo({ includeArchived: true }).values()) {
    if (String(row.niche || '').trim().toLowerCase() !== n) continue;
    if (placeKey(row.city, row.state) === want) return annotatePipeline(row);
  }
  return null;
}

function annotatePipeline(row) {
  let stage = 'Research';
  try {
    if (isCandidateLaunched(row.id)) stage = 'Launched';
  } catch {
    stage = 'Research';
  }
  if (row.archived) stage = 'archived';
  return { ...row, pipelineStage: stage };
}

export function annotateMembersWithPipeline(niche, members, ownClusterId = null) {
  const own = ownClusterId || null;
  return (members || []).map((m) => {
    const row = normalizeMember(m);
    const existing = lookupPipelineCity(niche, row.city, row.state);
    const other = findShotgunMember(niche, row.city, row.state);
    const ownId = m.clusterId || own || null;
    return {
      ...row,
      candidateId: existing?.id || row.candidateId || null,
      pipelineStage: existing?.pipelineStage || null,
      archived: Boolean(existing?.archived),
      passed: String(existing?.decision || '').toLowerCase() === 'pass',
      otherClusterId: other && other.cluster.id !== ownId ? other.cluster.id : null,
    };
  });
}

export function ensureShotgunGroup(cluster) {
  const name = cluster.name || clusterName(cluster.niche, cluster.hub?.city, cluster.hub?.state);
  const registry = loadGroupsRegistry();
  let group = registry.groups.find((g) => g.id === cluster.groupId);
  if (!group) {
    group = registry.groups.find(
      (g) => g.scope === GROUP_SCOPE_CANDIDATES && g.name.toLowerCase() === name.toLowerCase(),
    );
  }
  if (!group) {
    group = createGroup(name, { scope: GROUP_SCOPE_CANDIDATES });
  }
  const ids = (cluster.members || []).map((m) => m.candidateId).filter(Boolean);
  if (ids.length) {
    try {
      updateGroupMembers(group.id, ids, 'add');
    } catch {
      /* launched-only groups reject; shotgun uses candidates scope */
    }
  }
  return group;
}

export function packClusterGroupId(cluster, clusterKey) {
  const n = parseClusterKey(clusterKey);
  if (!n) return null;
  return cluster?.packClusterGroups?.[String(n)] || null;
}

export function ensurePackClusterGroups(cluster) {
  const groups = { ...(cluster.packClusterGroups || {}) };
  const byKey = new Map();
  for (let n = 1; n <= CLUSTER_MAX; n += 1) byKey.set(n, []);
  for (const m of cluster.members || []) {
    const n = memberClusterKey(m);
    if (!n || !m.candidateId) continue;
    byKey.get(n).push(m.candidateId);
  }
  for (let n = 1; n <= CLUSTER_MAX; n += 1) {
    const ids = byKey.get(n) || [];
    const key = String(n);
    const zoneName = cluster.name || clusterName(cluster.niche, cluster.hub?.city, cluster.hub?.state);
    const name = `${zoneName} · Cluster ${n}`.slice(0, 80);
    let groupId = groups[key];
    if (!ids.length) continue;
    let group = null;
    const registry = loadGroupsRegistry();
    if (groupId) group = registry.groups.find((g) => g.id === groupId) || null;
    if (!group) {
      group = registry.groups.find(
        (g) => g.scope === GROUP_SCOPE_CANDIDATES && g.name.toLowerCase() === name.toLowerCase(),
      );
    }
    if (!group) {
      try {
        group = createGroup(name, { scope: GROUP_SCOPE_CANDIDATES });
      } catch {
        continue;
      }
    }
    groups[key] = group.id;
    const have = new Set(group.ids || []);
    const want = new Set(ids);
    const add = ids.filter((id) => !have.has(id));
    const remove = [...have].filter((id) => !want.has(id));
    try {
      if (add.length) updateGroupMembers(group.id, add, 'add');
      if (remove.length) updateGroupMembers(group.id, remove, 'remove');
    } catch {
      /* ignore */
    }
  }
  cluster.packClusterGroups = groups;
  return cluster;
}

export function upsertShotgunCluster(patch) {
  const registry = loadShotgunClusters();
  const id = patch.id || newClusterId();
  const idx = registry.clusters.findIndex((c) => c.id === id);
  const prev = idx >= 0 ? registry.clusters[idx] : {};
  const cluster = {
    ...prev,
    ...patch,
    id,
    strategy: 'cluster',
    updatedAt: nowIso(),
    createdAt: prev.createdAt || nowIso(),
  };
  if (!cluster.name) {
    cluster.name = clusterName(cluster.niche, cluster.hub?.city || cluster.hub?.name, cluster.hub?.state);
  }
  const assigned = Number(cluster.sgNumber);
  if (!Number.isFinite(assigned) || assigned < 1) {
    cluster.sgNumber = nextShotgunSgNumber(registry.clusters);
  } else {
    cluster.sgNumber = Math.trunc(assigned);
  }
  const group = ensureShotgunGroup(cluster);
  cluster.groupId = group.id;
  ensurePackClusterGroups(cluster);
  if (idx >= 0) registry.clusters[idx] = cluster;
  else registry.clusters.push(cluster);
  saveShotgunClusters(registry);
  return cluster;
}

export function shotgunMembershipByCandidateId() {
  const map = new Map();
  for (const c of loadShotgunClusters().clusters) {
    for (const m of c.members || []) {
      if (!m.candidateId) continue;
      const row = normalizeMember(m);
      const packGroupId = packClusterGroupId(c, memberClusterKey(row));
      map.set(m.candidateId, {
        clusterId: c.id,
        groupId: c.groupId,
        packGroupId,
        role: row.role === 'hub' ? 'hub' : 'member',
        clusterKey: memberClusterKey(row) || null,
        clusterName: c.name,
        sgNumber: c.sgNumber,
        shotgunSg: formatShotgunSg(c.sgNumber),
      });
    }
  }
  return map;
}

export function attachShotgunToCandidates(candidates = []) {
  const byId = shotgunMembershipByCandidateId();
  return candidates.map((c) => {
    const hit = byId.get(c.id);
    if (!hit) return c;
    return {
      ...c,
      shotgunClusterId: hit.clusterId,
      shotgunZoneId: hit.clusterId,
      shotgunRole: hit.role,
      shotgunClusterKey: hit.clusterKey,
      shotgunClusterName: hit.clusterName,
      shotgunSg: hit.shotgunSg,
      sgNumber: hit.sgNumber,
      groupIds: [...new Set([...(c.groupIds || []), hit.groupId, hit.packGroupId].filter(Boolean))],
    };
  });
}

export function censusTableForPrompt(rings) {
  const rows = [];
  const p = rings?.primary;
  if (p) {
    rows.push({
      city: p.name,
      state: p.state,
      population: p.population,
      miles: 0,
      ring: 'hub',
    });
  }
  for (const r of rings?.innerPool || []) {
    rows.push({ ...r, city: r.name, ring: 'inner' });
  }
  for (const r of rings?.outerPool || []) {
    rows.push({ ...r, city: r.name, ring: 'outer' });
  }
  return rows
    .map(
      (r) =>
        `${r.city}, ${r.state} · pop ${r.population || '?'} · ${r.miles ?? '?'} mi · ${r.ring}`,
    )
    .join('\n');
}

export function clusterForCandidate(candidateId) {
  const id = String(candidateId || '').trim();
  if (!id) return null;
  for (const c of loadShotgunClusters().clusters) {
    if ((c.members || []).some((m) => m.candidateId === id)) return c;
  }
  return null;
}

export function shotgunSiblingMembers(candidateId) {
  const cluster = clusterForCandidate(candidateId);
  if (!cluster) return [];
  return (cluster.members || []).filter(
    (m) => m.candidateId && m.candidateId !== candidateId && isPackMember(m),
  );
}

export function shotgunBlockedLocationNames(candidateId) {
  return new Set(
    shotgunSiblingMembers(candidateId).map((m) =>
      normalizePlaceName(m.city),
    ),
  );
}

function memberSiteConfig(candidateId) {
  if (!candidateId) return null;
  const cfg = readJson(pathsFor(candidateId).siteConfig, null);
  return cfg && typeof cfg === 'object' ? cfg : null;
}

function zoneMemberPrimaries(cluster) {
  return new Set(
    (cluster?.members || []).map((m) => normalizePlaceName(m.city)).filter(Boolean),
  );
}

/** Leftover towns another Zone member already has a location page for. Also serving may overlap. */
export function shotgunClaimedSuburbEntries(candidateId) {
  const cluster = clusterForCandidate(candidateId);
  if (!cluster) return [];
  const primaries = zoneMemberPrimaries(cluster);
  const out = [];
  const seen = new Set();
  for (const m of shotgunSiblingMembers(candidateId)) {
    const cfg = memberSiteConfig(m.candidateId);
    if (!cfg) continue;
    for (const raw of cfg.targetSuburbs || []) {
      const name = nameOf(raw);
      const key = normalizePlaceName(name);
      if (!key || primaries.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({
        name,
        ownerCity: m.city,
        ownerCandidateId: m.candidateId,
        kind: 'page',
      });
    }
  }
  return out;
}

export function shotgunClaimedSuburbNames(candidateId) {
  return new Set(shotgunClaimedSuburbEntries(candidateId).map((e) => normalizePlaceName(e.name)));
}

export function shotgunZonePrimaryGeos(candidateId) {
  const cluster = clusterForCandidate(candidateId);
  if (!cluster) return [];
  const out = [];
  for (const m of cluster.members || []) {
    if (!m.candidateId || !isPackMember(m)) continue;
    const feat = findPlaceFeatureLocal(m.city, m.state);
    const c = feat && featureCentroid(feat);
    if (!c) continue;
    out.push({
      candidateId: m.candidateId,
      city: m.city,
      state: m.state,
      lng: c[0],
      lat: c[1],
      clusterKey: m.clusterKey ?? null,
      role: m.role || null,
    });
  }
  return out;
}

function milesPlaceToPrimary(placeName, placeState, member) {
  const placeFeat = findPlaceFeatureLocal(placeName, placeState);
  const memberFeat = findPlaceFeatureLocal(member.city, member.state);
  const pc = placeFeat && featureCentroid(placeFeat);
  const mc = memberFeat && featureCentroid(memberFeat);
  if (!pc || !mc) return Number.POSITIVE_INFINITY;
  return haversineMi(pc[0], pc[1], mc[0], mc[1]);
}

/** Miles from this leftover town to the candidate's Zone primary. */
export function leftoverMilesFromPrimary(name, state, candidateId) {
  const geos = shotgunZonePrimaryGeos(candidateId);
  const self = geos.find((g) => g.candidateId === candidateId);
  if (!self) return Number.POSITIVE_INFINITY;
  const feat = findPlaceFeatureLocal(name, state);
  const c = feat && featureCentroid(feat);
  if (!c) return Number.POSITIVE_INFINITY;
  return haversineMi(c[0], c[1], self.lng, self.lat);
}

/** True when another Zone primary is strictly closer to this leftover town. */
export function leftoverNearerToOtherPrimary(name, state, candidateId) {
  const key = normalizePlaceName(name);
  if (!key || !candidateId) return false;
  const geos = shotgunZonePrimaryGeos(candidateId);
  const self = geos.find((g) => g.candidateId === candidateId);
  if (!self) return false;
  if (geos.some((g) => normalizePlaceName(g.city) === key)) return false;
  const feat = findPlaceFeatureLocal(name, state);
  const c = feat && featureCentroid(feat);
  if (!c) return false;
  const selfDist = haversineMi(c[0], c[1], self.lng, self.lat);
  for (const g of geos) {
    if (g.candidateId === candidateId) continue;
    const d = haversineMi(c[0], c[1], g.lng, g.lat);
    if (d < selfDist) return true;
  }
  return false;
}

export function shotgunDoNotLinkBlock(candidateId) {
  const cluster = clusterForCandidate(candidateId);
  if (!cluster) return '';
  const self = (cluster.members || []).find((m) => m.candidateId === candidateId);
  const siblings = shotgunSiblingMembers(candidateId);
  if (!siblings.length) return '';
  const lines = siblings.map((m) => `- ${m.city}, ${m.state} (${shotgunRoleLabel(m.role)})`);
  return `## Zone isolation
This site is **${shotgunRoleLabel(self?.role, self) || 'a member'}** of ${cluster.name || 'a Zone'}. Sibling cities are **separate sites**. Do not link to them, name their URLs, claim them as suburbs/location pages, or write a webring / "our other offices" list — unless the operator overrode a location page for that sibling on this site.

Sibling primaries (do not claim or link unless overridden as a location page):
${lines.join('\n')}
`;
}

function haversineMi(lng1, lat1, lng2, lat2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function shotgunNapTooClose(candidateId, lat, lng, { minMiles = MIN_NAP_MILES } = {}) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  for (const m of shotgunSiblingMembers(candidateId)) {
    const pkg = readJson(path.join(RESEARCH_DIR, `${m.candidateId}-business-address.json`), null);
    const sel = pkg?.selection;
    const slat = Number(sel?.lat);
    const slng = Number(sel?.lng);
    if (!Number.isFinite(slat) || !Number.isFinite(slng)) continue;
    const miles = haversineMi(ln, la, slng, slat);
    if (miles < minMiles) {
      return {
        city: m.city,
        state: m.state,
        miles: Math.round(miles * 100) / 100,
        minMiles,
      };
    }
  }
  return null;
}

export function dissolveShotgunCluster(clusterId) {
  const id = String(clusterId || '').trim();
  const registry = loadShotgunClusters();
  const next = (registry.clusters || []).filter((c) => c.id !== id);
  if (next.length === registry.clusters.length) {
    throw Object.assign(new Error('Cluster not found'), { status: 404 });
  }
  saveShotgunClusters({ clusters: next });
  return { ok: true, dissolved: id };
}

export function packMembersFromDraft(draft, rings = null) {
  const hub =
    (draft.members || []).find((m) => normalizeClusterRole(m.role) === 'hub') ||
    (draft.hub ? { city: draft.hub.city, state: draft.hub.state, role: 'hub' } : null);
  const cities = (draft.members || []).filter((m) => isPackMember(m) && normalizeClusterRole(m.role) !== 'hub');
  if (!hub) return [];
  return membersFromAssign({ hub, cities }, rings);
}

function syncClusterDraft(cluster) {
  const batchId = cluster?.batchId;
  if (!batchId) return;
  const dir = path.join(RESEARCH_DIR, 'batches', batchId);
  const draft = loadShotgunDraft(dir);
  if (!draft) return;
  saveShotgunDraft(dir, {
    ...draft,
    members: annotateMembersWithPipeline(cluster.niche, cluster.members || []),
    clusterId: cluster.id,
    groupId: cluster.groupId,
    hub: cluster.hub || draft.hub,
  });
}

function overrideSet(config) {
  return new Set(
    (config?.clusterLocationPageOverrides || []).map((n) => normalizePlaceName(nameOf(n))),
  );
}

function nameOf(n) {
  return typeof n === 'string' ? n : n?.name || '';
}

function leftoverPlaceState(cfg, name) {
  const key = normalizePlaceName(name);
  for (const a of cfg?.coverageAreas || []) {
    if (normalizePlaceName(nameOf(a)) === key && a?.state) {
      return String(a.state).trim().toUpperCase();
    }
  }
  return String(cfg?.state || '').trim().toUpperCase();
}

function pickLeftoverPageOwner(owners, name) {
  const overrode = owners.filter((o) => o.row.overrides.has(name));
  const pool = overrode.length === 1 ? overrode : overrode.length > 1 ? overrode : owners;
  let best = pool[0];
  let bestMiles = milesPlaceToPrimary(name, best.state, best.row.member);
  for (const o of pool.slice(1)) {
    const miles = milesPlaceToPrimary(name, o.state, o.row.member);
    if (miles < bestMiles) {
      best = o;
      bestMiles = miles;
    }
  }
  return best;
}

export function resyncClusterSiteConfigs(cluster) {
  const members = cluster?.members || [];
  const siblingNames = new Set(
    members.map((m) => normalizePlaceName(m.city)).filter(Boolean),
  );
  const loaded = [];
  for (const m of members) {
    if (!m.candidateId) continue;
    const p = pathsFor(m.candidateId);
    const cfg = readJson(p.siteConfig, null);
    if (!cfg || typeof cfg !== 'object') continue;
    const self = normalizePlaceName(m.city);
    const overrides = overrideSet(cfg);
    const blocked = new Set(
      [...siblingNames].filter((n) => n && n !== self && !overrides.has(n)),
    );
    let dirty = false;
    const suburbs = Array.isArray(cfg.targetSuburbs) ? cfg.targetSuburbs : [];
    const nextSuburbs = suburbs.filter((name) => !blocked.has(normalizePlaceName(nameOf(name))));
    if (nextSuburbs.length !== suburbs.length) {
      cfg.targetSuburbs = nextSuburbs;
      dirty = true;
    }
    loaded.push({ member: m, path: p, cfg, overrides, dirty });
  }

  const ownersByName = new Map();
  for (const row of loaded) {
    for (const raw of row.cfg.targetSuburbs || []) {
      const name = nameOf(raw);
      const key = normalizePlaceName(name);
      if (!key || siblingNames.has(key)) continue;
      const list = ownersByName.get(key) || [];
      list.push({
        row,
        display: name,
        state: leftoverPlaceState(row.cfg, name),
      });
      ownersByName.set(key, list);
    }
  }
  for (const [key, owners] of ownersByName) {
    if (owners.length < 2) continue;
    const keep = pickLeftoverPageOwner(owners, key);
    for (const o of owners) {
      if (o.row.member.candidateId === keep.row.member.candidateId) continue;
      const suburbs = Array.isArray(o.row.cfg.targetSuburbs) ? o.row.cfg.targetSuburbs : [];
      const next = suburbs.filter((n) => normalizePlaceName(nameOf(n)) !== key);
      if (next.length !== suburbs.length) {
        o.row.cfg.targetSuburbs = next;
        o.row.dirty = true;
      }
    }
  }

  for (const row of loaded) {
    const planned = toCoverageAreas(
      [...(row.cfg.targetSuburbs || []), ...(row.cfg.alsoServing || [])].map((n) => ({
        name: nameOf(n),
        state: leftoverPlaceState(row.cfg, nameOf(n)),
      })),
      row.cfg.primaryCity,
      row.cfg.state,
    );
    const before = (row.cfg.coverageAreas || [])
      .map((a) => normalizePlaceName(nameOf(a)))
      .filter(Boolean)
      .sort()
      .join('|');
    const after = planned
      .map((a) => normalizePlaceName(a.name))
      .filter(Boolean)
      .sort()
      .join('|');
    if (before !== after) {
      row.cfg.coverageAreas = planned;
      row.dirty = true;
    }
  }

  for (const row of loaded) {
    if (row.dirty) writeJson(row.path.siteConfig, row.cfg);
  }
}

export function addClusterCity(clusterId, { city, state, confirmOutside = false } = {}) {
  const registry = loadShotgunClusters();
  const cluster = registry.clusters.find((c) => c.id === clusterId);
  if (!cluster) {
    throw Object.assign(new Error('Cluster not found'), { status: 404 });
  }
  const feat = findPlaceFeatureLocal(city, state);
  const name = feat?.properties?.name || String(city || '').trim();
  const st = String(feat?.properties?.state || state || '').trim().toUpperCase();
  if (!name || st.length !== 2) {
    throw Object.assign(new Error('No Census place match for that city'), { status: 400 });
  }
  const other = findShotgunMember(cluster.niche, name, st);
  if (other && other.cluster.id !== cluster.id) {
    throw Object.assign(
      new Error(`${name}, ${st} is already in another cluster for this niche`),
      { status: 400 },
    );
  }
  const already = (cluster.members || []).find((m) => placeKey(m.city, m.state) === placeKey(name, st));
  if (already) {
    return { cluster, member: already, created: false };
  }
  const settings = normalizeShotgunSettings(cluster);
  let miles = null;
  let pop = Number(feat?.properties?.population) || lookupPopulation(name, st) || null;
  try {
    const rings = shotgunRingPools(cluster.hub?.city, cluster.hub?.state, {
      innerMiles: settings.clusterMiles,
      outerMiles: settings.clusterMiles,
      citiesBand: settings.bands.cities,
    });
    const hit =
      rings.innerPool.find((p) => placeKey(p.name, p.state) === placeKey(name, st)) ||
      rings.outerPool.find((p) => placeKey(p.name, p.state) === placeKey(name, st));
    if (hit) {
      miles = hit.miles;
      pop = hit.population ?? pop;
    }
    if (!hit && !confirmOutside) {
      throw Object.assign(
        new Error(
          `${name} is outside the typical cluster radius or pop band. Confirm to add anyway.`,
        ),
        { status: 400, code: 'OUTSIDE_CLUSTER_BAND' },
      );
    }
  } catch (error) {
    if (error?.code === 'OUTSIDE_CLUSTER_BAND') throw error;
    /* Census rings optional */
  }
  const existing = lookupPipelineCity(cluster.niche, name, st);
  let candidateId = existing?.id || null;
  let created = false;
  if (!candidateId) {
    const made = createCandidate({
      niche: cluster.niche,
      primary: `${name},${st}`,
      source: { kind: 'cluster', clusterId: cluster.id },
      decision: 'pursue',
      decisionNotes: 'Added to cluster',
    });
    candidateId = made.id;
    created = true;
  }
  const member = {
    city: name,
    state: st,
    role: 'unassigned',
    clusterKey: null,
    population: pop,
    miles,
    candidateId,
  };
  const members = annotateMembersWithPipeline(cluster.niche, [...(cluster.members || []), member]);
  const next = upsertShotgunCluster({
    ...cluster,
    members,
  });
  if (next.groupId && candidateId) {
    try {
      updateGroupMembers(next.groupId, [candidateId], 'add');
    } catch {
      /* ignore */
    }
  }
  syncClusterDraft(next);
  resyncClusterSiteConfigs(next);
  const nap = candidateId ? shotgunNapTooClose(candidateId, null, null) : null;
  return { cluster: next, member, created, napWarn: Boolean(nap) };
}

export async function removeClusterCity(clusterId, { city, state, disposition = 'standalone' } = {}) {
  const registry = loadShotgunClusters();
  const cluster = registry.clusters.find((c) => c.id === clusterId);
  if (!cluster) {
    throw Object.assign(new Error('Cluster not found'), { status: 404 });
  }
  const k = placeKey(city, state);
  const member = (cluster.members || []).find((m) => placeKey(m.city, m.state) === k);
  if (!member) {
    throw Object.assign(new Error('City is not in this cluster'), { status: 404 });
  }
  if (normalizeClusterRole(member.role) === 'hub') {
    throw Object.assign(
      new Error('Cannot remove the Hub while Cluster Cities remain'),
      { status: 400 },
    );
  }
  const wantDelete = disposition === 'delete';
  if (wantDelete && member.candidateId && isUndeletableCandidate(member.candidateId)) {
    throw Object.assign(
      new Error(
        `Cannot permanently delete Launched Candidate(s): ${member.candidateId}`,
      ),
      {
        status: 409,
        code: 'UNDELETABLE_CANDIDATE',
        details: { blocked: [member.candidateId], allowed: [] },
      },
    );
  }
  const members = (cluster.members || []).filter((m) => placeKey(m.city, m.state) !== k);
  const next = upsertShotgunCluster({ ...cluster, members });
  if (next.groupId && member.candidateId) {
    try {
      updateGroupMembers(next.groupId, [member.candidateId], 'remove');
    } catch {
      /* ignore */
    }
  }
  if (member.candidateId && disposition === 'archive') {
    setArchived([member.candidateId], true);
  }
  let deleted = null;
  if (wantDelete && member.candidateId) {
    deleted = await deleteCandidates([member.candidateId]);
  }
  syncClusterDraft(next);
  resyncClusterSiteConfigs(next);
  return { cluster: next, removed: member, disposition: wantDelete ? 'delete' : disposition, deleted };
}

export function getZoneWorkspace(clusterId) {
  const cluster = loadShotgunClusters().clusters.find((c) => c.id === clusterId);
  if (!cluster) {
    throw Object.assign(new Error('Zone not found'), { status: 404 });
  }
  const s = normalizeShotgunSettings(cluster);
  const miles = s.clusterMiles;
  let rings = null;
  if (cluster.hub?.city && cluster.hub?.state) {
    try {
      rings = shotgunRingPools(cluster.hub.city, cluster.hub.state, {
        innerMiles: miles,
        outerMiles: miles,
        citiesBand: s.bands.cities,
      });
    } catch (error) {
      rings = { error: error.message };
    }
  }
  const members = annotateMembersWithPipeline(cluster.niche, cluster.members || []);
  return {
    draft: {
      ...cluster,
      members,
      hub: cluster.hub,
      clusterMiles: miles,
      innerMiles: miles,
      outerMiles: miles,
    },
    rings,
    settings: s,
    niche: cluster.niche,
    clusterId: cluster.id,
    source: 'registry',
  };
}

export function paintZoneMember(clusterId, { city, state, tool, slot, minPop, maxPop, radiusMiles } = {}) {
  const registry = loadShotgunClusters();
  const cluster = registry.clusters.find((c) => c.id === clusterId);
  if (!cluster) {
    throw Object.assign(new Error('Zone not found'), { status: 404 });
  }
  if (!cluster.hub?.city) {
    throw Object.assign(new Error('Zone has no hub'), { status: 400 });
  }
  const s = normalizeShotgunSettings(cluster);
  const liveRaw = Number(radiusMiles);
  const milesCap = Number.isFinite(liveRaw) ? clampClusterMiles(liveRaw) : s.clusterMiles;
  if (String(tool || '').toLowerCase() === 'hub') {
    const fromKey = placeKey(cluster.hub.city, cluster.hub.state);
    const k = placeKey(city, state);
    if (k && fromKey && k === fromKey) {
      return { cluster, workspace: getZoneWorkspace(cluster.id) };
    }
    const feat = findPlaceFeatureLocal(city, state);
    const already = (cluster.members || []).find((m) => placeKey(m.city, m.state) === k);
    if (!feat && !already) {
      throw Object.assign(new Error('No Census place match for that city'), { status: 400 });
    }
    const name = feat?.properties?.name || already?.city || city;
    const st = feat?.properties?.state || already?.state || String(state || '').toUpperCase();
    const pop = Number(feat?.properties?.population ?? already?.population) || cluster.hub.population || null;
    const members = annotateMembersWithPipeline(
      cluster.niche,
      setZoneHub(cluster.members || [], {
        fromCity: cluster.hub.city,
        fromState: cluster.hub.state,
        toCity: name,
        toState: st,
        population: pop,
      }),
    );
    const next = upsertShotgunCluster({
      ...cluster,
      hub: { city: name, state: st, population: pop },
      members,
      name: clusterName(cluster.niche, name, st),
      clusterMiles: milesCap,
      innerMiles: milesCap,
      outerMiles: milesCap,
    });
    syncClusterDraft(next);
    resyncClusterSiteConfigs(next);
    return { cluster: next, workspace: getZoneWorkspace(next.id) };
  }
  const k = placeKey(city, state);
  const zone = placeInZoneRadius(city, state, cluster.hub.city, cluster.hub.state, milesCap);
  const feat = zone.feat;
  const already = (cluster.members || []).find((m) => placeKey(m.city, m.state) === k);
  const isHub = k === placeKey(cluster.hub.city, cluster.hub.state);
  if (!already && !isHub) {
    if (!feat) {
      throw Object.assign(new Error('No Census place match for that city'), { status: 400 });
    }
    if (!centroidInsideZone(zone, milesCap)) {
      throw Object.assign(new Error('City is outside the Zone radius'), { status: 400 });
    }
  }
  const name = feat?.properties?.name || already?.city || city;
  const st = feat?.properties?.state || already?.state || String(state || '').toUpperCase();
  const pop = Number(feat?.properties?.population ?? already?.population) || null;
  const miles = isHub ? 0 : zone.miles;
  const members = annotateMembersWithPipeline(
    cluster.niche,
    applyMemberPaint(cluster.members || [], cluster.hub, {
      city: name,
      state: st,
      tool,
      slot,
      population: pop,
      miles,
      name,
      featState: st,
    }),
  );
  const next = upsertShotgunCluster({
    ...cluster,
    members,
    clusterMiles: milesCap,
    innerMiles: milesCap,
    outerMiles: milesCap,
  });
  syncClusterDraft(next);
  resyncClusterSiteConfigs(next);
  return { cluster: next, workspace: getZoneWorkspace(next.id) };
}

export function paintZoneMembers(clusterId, { cities = [], slot, radiusMiles } = {}) {
  const registry = loadShotgunClusters();
  const cluster = registry.clusters.find((c) => c.id === clusterId);
  if (!cluster) {
    throw Object.assign(new Error('Zone not found'), { status: 404 });
  }
  if (!cluster.hub?.city) {
    throw Object.assign(new Error('Zone has no hub'), { status: 400 });
  }
  const s = normalizeShotgunSettings(cluster);
  const liveRaw = Number(radiusMiles);
  const milesCap = Number.isFinite(liveRaw) ? clampClusterMiles(liveRaw) : s.clusterMiles;
  const hubKey = placeKey(cluster.hub.city, cluster.hub.state);
  const clearing = !Number(slot);
  const resolved = [];
  for (const raw of cities) {
    const city = raw?.city;
    const state = raw?.state;
    const k = placeKey(city, state);
    if (!k || k === hubKey) continue;
    const zone = placeInZoneRadius(city, state, cluster.hub.city, cluster.hub.state, milesCap);
    const feat = zone.feat;
    const already = (cluster.members || []).find((m) => placeKey(m.city, m.state) === k);
    if (!already && !clearing) {
      if (!feat) continue;
      if (!centroidInsideZone(zone, milesCap)) continue;
    }
    if (!already && !feat) continue;
    resolved.push({
      city: feat?.properties?.name || already?.city || city,
      state: feat?.properties?.state || already?.state || String(state || '').toUpperCase(),
      population: Number(feat?.properties?.population ?? already?.population) || null,
      miles: zone.miles,
      name: feat?.properties?.name || already?.city || city,
      featState: feat?.properties?.state || already?.state || String(state || '').toUpperCase(),
    });
  }
  const members = annotateMembersWithPipeline(
    cluster.niche,
    applyMemberPaintMany(cluster.members || [], cluster.hub, {
      cities: resolved,
      slot,
      mode: 'set',
    }),
  );
  const next = upsertShotgunCluster({
    ...cluster,
    members,
    clusterMiles: milesCap,
    innerMiles: milesCap,
    outerMiles: milesCap,
  });
  syncClusterDraft(next);
  resyncClusterSiteConfigs(next);
  return { cluster: next, workspace: getZoneWorkspace(next.id) };
}

export function setZoneMiles(clusterId, miles) {
  const registry = loadShotgunClusters();
  const cluster = registry.clusters.find((c) => c.id === clusterId);
  if (!cluster) {
    throw Object.assign(new Error('Zone not found'), { status: 404 });
  }
  const s = normalizeShotgunSettings({ ...cluster, clusterMiles: miles });
  const members = annotateMembersWithPipeline(
    cluster.niche,
    pruneMembersOutsideZone(cluster.hub, cluster.members || [], s.clusterMiles),
  );
  const membersChanged = memberPaintSignature(cluster.members) !== memberPaintSignature(members);
  const next = upsertShotgunCluster({
    ...cluster,
    members,
    clusterMiles: s.clusterMiles,
    innerMiles: s.clusterMiles,
    outerMiles: s.clusterMiles,
  });
  syncClusterDraft(next);
  if (membersChanged) resyncClusterSiteConfigs(next);
  return { cluster: next, workspace: getZoneWorkspace(next.id) };
}
