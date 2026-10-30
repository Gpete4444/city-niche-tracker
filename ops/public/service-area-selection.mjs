/**
 * Pure Service area coverage toggle / seed rules.
 * Map and table clicks add or remove coverage; radius seed honors operator pins and removals.
 */

export const ALSO_SERVING_CAP = 10;
/** AUTO Suggested pages / Also serving stay this close to the primary centroid. */
export const AUTO_SEED_MAX_MILES = 5;
/** Location pages including primary. Zone 5-mile seed underfills from leftover coverage up to max. */
export const PREFER_MIN_PAGES = 4;
export const PREFER_MAX_PAGES = 6;
export const PREFER_MIN_SUBURBS = PREFER_MIN_PAGES - 1;
export const PREFER_MAX_SUBURBS = PREFER_MAX_PAGES - 1;

/**
 * Map-side place key: strip a trailing legal type (City/Town/…).
 * Census keys keep proper-name "City" ("Royse City" → "royse city").
 */
export function normalizeMapPlaceName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+(city|town|village|borough|municipality|cdp|urban county)\s*$/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lowercased display form without stripping City — matches Census blocked keys. */
export function censusLikePlaceName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** All keys that should match a place across Census vs map helpers. */
export function placeNameAliases(name) {
  const aliases = new Set();
  const raw = censusLikePlaceName(name);
  const stripped = normalizeMapPlaceName(name);
  if (raw) aliases.add(raw);
  if (stripped) aliases.add(stripped);
  return [...aliases];
}

export function placeNameKeySet(names) {
  const out = new Set();
  for (const name of names || []) {
    for (const alias of placeNameAliases(name)) out.add(alias);
  }
  return out;
}

export function placeNameSetHas(set, name, extraKey = '') {
  if (!set) return false;
  if (extraKey && set.has(extraKey)) return true;
  for (const alias of placeNameAliases(name)) {
    if (set.has(alias)) return true;
  }
  return false;
}

export function setPlaceNameAliases(map, name, value) {
  if (!map) return;
  for (const alias of placeNameAliases(name)) {
    map.set(alias, value);
  }
}

export function getPlaceNameAlias(map, name) {
  if (!map) return undefined;
  for (const alias of placeNameAliases(name)) {
    if (map.has(alias)) return map.get(alias);
  }
  return undefined;
}

function finiteMiles(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

export function withinMaxMiles(miles, maxMiles = AUTO_SEED_MAX_MILES) {
  if (maxMiles == null || maxMiles === '') return true;
  const cap = Number(maxMiles);
  if (!Number.isFinite(cap) || cap < 0) return true;
  return finiteMiles(miles) <= cap;
}

/**
 * Add a city to coverage. Does not assign a location page.
 * @param {{
 *   selected: Map<string, {name: string, state: string}>,
 *   deselectedKeys: Set<string>,
 *   pinnedKeys: Set<string>,
 *   key: string,
 *   row: {name: string, state: string},
 * }} args
 */
export function addCoverage({ selected, deselectedKeys, pinnedKeys, key, row }) {
  selected.set(key, row);
  deselectedKeys.delete(key);
  pinnedKeys.add(key);
  return { selected, deselectedKeys, pinnedKeys };
}

/**
 * Remove a city from coverage and drop its location page.
 * @param {{
 *   selected: Map<string, {name: string, state: string}>,
 *   pageKeySet: Set<string>,
 *   pageOffKeys: Set<string>,
 *   deselectedKeys: Set<string>,
 *   pinnedKeys: Set<string>,
 *   key: string,
 * }} args
 */
export function removeCoverage({
  selected,
  pageKeySet,
  pageOffKeys,
  deselectedKeys,
  pinnedKeys,
  key,
}) {
  const hadPage = pageKeySet.has(key);
  selected.delete(key);
  pageKeySet.delete(key);
  pageOffKeys.add(key);
  deselectedKeys.add(key);
  pinnedKeys.delete(key);
  return { hadPage, selected, pageKeySet, pageOffKeys, deselectedKeys, pinnedKeys };
}

/**
 * Nearest leftover keys from a place pool, excluding pages / primary / operator removals.
 * @param {{
 *   pool: Map<string, {name: string, state?: string}>,
 *   pageKeys?: Set<string> | string[],
 *   primaryKey?: string,
 *   deselectedKeys?: Set<string> | string[],
 *   leftoverDistance: (name: string, key: string) => number,
 *   isLeftoverClaim?: (name: string, key: string) => boolean,
 *   cap?: number,
 *   maxMiles?: number | null,
 * }} args
 * @returns {string[]}
 */
export function nearestLeftoverKeys({
  pool,
  pageKeys,
  primaryKey = '',
  deselectedKeys,
  leftoverDistance,
  isLeftoverClaim,
  cap = ALSO_SERVING_CAP,
  maxMiles = AUTO_SEED_MAX_MILES,
}) {
  const pageSet = pageKeys instanceof Set ? pageKeys : new Set(pageKeys || []);
  const off = deselectedKeys instanceof Set ? deselectedKeys : new Set(deselectedKeys || []);
  return [...pool.entries()]
    .map(([key, row]) => ({
      key,
      name: row.name,
      miles: leftoverDistance(row.name, key),
    }))
    .filter((r) => {
      if (primaryKey && r.key === primaryKey) return false;
      if (pageSet.has(r.key)) return false;
      if (off.has(r.key)) return false;
      if (isLeftoverClaim?.(r.name, r.key)) return false;
      if (!withinMaxMiles(r.miles, maxMiles)) return false;
      return true;
    })
    .sort((a, b) => a.miles - b.miles)
    .slice(0, Math.max(0, cap))
    .map((r) => r.key);
}

/**
 * Rebuild selected after a radius load or slider move.
 * Keep primary + pages + the nearest leftovers, minus operator removals, plus in-radius pins.
 * Drops page keys that are deselected or now outside the circle.
 * @param {{
 *   selected: Map<string, {name: string, state: string}>,
 *   radiusPool: Map<string, {name: string, state: string}>,
 *   pageKeySet: Set<string>,
 *   deselectedKeys: Set<string>,
 *   pinnedKeys: Set<string>,
 *   primaryKey?: string,
 *   primaryRow?: {name: string, state: string} | null,
 *   inRadiusKeys?: Set<string> | string[],
 *   leftoverDistance: (name: string, key: string) => number,
 *   isLeftoverClaim?: (name: string, key: string) => boolean,
 *   alsoServingCap?: number,
 *   ignoreRadiusCircle?: boolean,
 *   maxMiles?: number | null,
 * }} args
 */
export function seedCoverageFromRadius({
  selected,
  radiusPool,
  pageKeySet,
  deselectedKeys,
  pinnedKeys,
  primaryKey = '',
  primaryRow = null,
  inRadiusKeys,
  leftoverDistance,
  isLeftoverClaim,
  alsoServingCap = ALSO_SERVING_CAP,
  ignoreRadiusCircle = false,
  maxMiles = AUTO_SEED_MAX_MILES,
}) {
  const inR = inRadiusKeys instanceof Set ? inRadiusKeys : new Set(inRadiusKeys || []);
  const inCircle = (key) =>
    ignoreRadiusCircle || !inR.size || inR.has(key) || (primaryKey && key === primaryKey);

  for (const key of [...pageKeySet]) {
    if (primaryKey && key === primaryKey) continue;
    if (deselectedKeys.has(key) || !inCircle(key)) pageKeySet.delete(key);
  }

  const next = new Map();
  if (primaryKey && primaryRow) next.set(primaryKey, primaryRow);

  for (const key of pageKeySet) {
    if (primaryKey && key === primaryKey) continue;
    if (deselectedKeys.has(key) || !inCircle(key)) continue;
    const row = selected.get(key) || radiusPool.get(key);
    if (row) next.set(key, row);
  }

  const serving = nearestLeftoverKeys({
    pool: radiusPool,
    pageKeys: pageKeySet,
    primaryKey,
    deselectedKeys,
    leftoverDistance,
    isLeftoverClaim,
    cap: alsoServingCap,
    maxMiles,
  });
  for (const key of serving) {
    if (!inCircle(key)) continue;
    const row = selected.get(key) || radiusPool.get(key);
    if (row) next.set(key, row);
  }

  for (const key of pinnedKeys) {
    if (deselectedKeys.has(key)) continue;
    if (primaryKey && key === primaryKey) continue;
    if (!inCircle(key)) continue;
    const row = selected.get(key) || radiusPool.get(key);
    if (row) next.set(key, row);
  }

  selected.clear();
  for (const [key, row] of next) selected.set(key, row);
  return selected;
}

/**
 * Status / hover copy for a city-boundary click.
 * @param {{ name?: string, isPrimary?: boolean, isSelected?: boolean, hasPage?: boolean }} args
 */
export function coverageClickHint({ name, isPrimary, isSelected, hasPage }) {
  const city = String(name || '').trim() || 'City';
  if (isPrimary) return `${city} is the primary center`;
  if (isSelected) {
    return hasPage
      ? `Click to remove ${city} (drops its location page)`
      : `Click to remove ${city}`;
  }
  return `Click to add ${city}`;
}

/**
 * Hover/status when another Zone site already has this leftover’s location page.
 * Coverage / Also serving is still allowed. Never "Cannot add".
 */
export function leftoverAlsoServingHint({ name, ownerCity } = {}) {
  const city = String(name || '').trim() || 'City';
  const owner = String(ownerCity || '').trim() || 'another Zone site';
  return `Click to add ${city} as Also serving (${owner} has the location page)`;
}

/**
 * Status after a coverage click adds a leftover that another Zone site already pages.
 * Coverage / Also serving is still allowed. Never "Cannot add".
 */
export function leftoverAlsoServingAddedStatus({ name, ownerCity } = {}) {
  const city = String(name || '').trim() || 'City';
  const owner = String(ownerCity || '').trim() || 'another Zone site';
  return `Added ${city} as Also serving (${owner} has the location page).`;
}

/**
 * Status after a coverage click adds a Zone sibling. Also serving is allowed; Page is never offered.
 */
export function siblingAlsoServingAddedStatus({ name } = {}) {
  const city = String(name || '').trim() || 'City';
  return `Added ${city} as Also serving. Cluster site — coverage only, never a location page.`;
}

/** Layer identity: Census GEOID, else name|state. */
export function featureGeoid(feature) {
  return String(feature?.properties?.geoid || feature?.properties?.GEOID || '').trim();
}

export function featureLayerKey(feature) {
  const geoid = featureGeoid(feature);
  if (geoid) return `g:${geoid}`;
  const p = feature?.properties || {};
  const name = String(p.name || '').trim();
  if (!name) return '';
  return `n:${name.toLowerCase()}|${String(p.state || '').trim().toUpperCase()}`;
}

export function featureBboxArea(feature) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const walk = (coords) => {
    if (!coords) return;
    if (typeof coords[0] === 'number') {
      const x = Number(coords[0]);
      const y = Number(coords[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    for (const c of coords) walk(c);
  };
  walk(feature?.geometry?.coordinates);
  if (!Number.isFinite(minX)) return 0;
  return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
}

/** True when next should replace prev for name|state pop/center (primary, else larger, else higher pop). */
export function preferPlaceMeta(prev, next) {
  if (!prev) return true;
  if (next.isPrimary && !prev.isPrimary) return true;
  if (prev.isPrimary && !next.isPrimary) return false;
  if (next.area > prev.area) return true;
  if (next.area < prev.area) return false;
  return next.pop > prev.pop;
}

export function placeFeatureMeta(feature) {
  const p = feature?.properties || {};
  return {
    isPrimary: Boolean(p.isPrimary),
    area: featureBboxArea(feature),
    pop: Number(p.population) || 0,
  };
}

/**
 * Keep every GEOID when merging coverage-preview layers.
 * `have` is a Set of featureLayerKey values (not name|state).
 */
export function featuresToMergeByGeoid(features, have) {
  const nextHave = new Set(have);
  const toAdd = [];
  for (const f of features || []) {
    const key = featureLayerKey(f);
    if (!key || nextHave.has(key)) continue;
    nextHave.add(key);
    toAdd.push(f);
  }
  return { toAdd, have: nextHave };
}

/**
 * Coverage SVG / site-config miles from selected-city distances to the primary.
 * @param {{ distances?: number[], fallback?: number }} args
 */
export function serviceRadiusMilesFromCoverage({ distances = [], fallback = 15 } = {}) {
  let max = 0;
  for (const raw of distances) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const miles = Math.ceil(max);
  if (!Number.isFinite(miles) || miles < 1) {
    const fb = Number(fallback);
    return Number.isFinite(fb) && fb > 0 ? Math.min(100, Math.max(1, fb)) : 15;
  }
  return Math.min(100, Math.max(1, miles));
}
