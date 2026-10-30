/**
 * Census place adjacency + radius coverage helpers for service-area selection.
 * Requires data/census/map/places.geojson (npm run build-research-map).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizePlaceName } from './census.mjs';
import { loadPlacesLayer, placesGeojsonPath as sharedPlacesGeojsonPath } from './census-map-layers.mjs';
import {
  commonPlaceName,
  equivalentPlaceNames,
  PLACE_COMMON_NAMES,
} from './place-common-names.mjs';

const ROOT = process.cwd();
const MAP_DIR = path.join(ROOT, 'data', 'census', 'map');
const NEIGHBORS_PATH = path.join(MAP_DIR, 'place-neighbors.json');

const EARTH_MI = 3958.7613;

/** Service-area radius previews stay at 100. Cluster/zone maps use MAX_CLUSTER_MILES. */
export const MAX_SERVICE_RADIUS_MILES = 100;
export const MAX_CLUSTER_MILES = 200;
const TOUCH_EPS_DEG = 0.00035; // ~40m — shared-border / float gap

/** @type {Record<string, Array<{ name: string, state: string, population: number }>> | null} */
let neighborsCache = null;

function loadPlaces() {
  return loadPlacesLayer();
}

export function placeNeighborsPath() {
  return NEIGHBORS_PATH;
}

export function placesGeojsonPath() {
  return sharedPlacesGeojsonPath();
}

export function neighborKey(city, state) {
  const abbr = String(state || '').trim().toUpperCase();
  return `${normalizePlaceName(commonPlaceName(city, abbr))}|${abbr}`;
}

function featureGeoid(f) {
  return String(f?.properties?.geoid || f?.properties?.GEOID || '').trim();
}

/** Flatten GeoJSON rings to [lng,lat][]. */
export function iterCoords(geometry, fn) {
  if (!geometry) return;
  const { type, coordinates } = geometry;
  if (type === 'Polygon') {
    for (const ring of coordinates || []) for (const c of ring) fn(c[0], c[1]);
  } else if (type === 'MultiPolygon') {
    for (const poly of coordinates || []) {
      for (const ring of poly) for (const c of ring) fn(c[0], c[1]);
    }
  }
}

export function featureBbox(feature) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  iterCoords(feature.geometry, (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  });
  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

export function featureCentroid(feature) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  iterCoords(feature.geometry, (x, y) => {
    sx += x;
    sy += y;
    n += 1;
  });
  if (!n) return null;
  return [sx / n, sy / n];
}

export function haversineMiles(lng1, lat1, lng2, lat2) {
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLng = (lng2 - lng1) * toR;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lng, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates || [];
    if (!rings.length || !pointInRing(lng, lat, rings[0])) return false;
    for (let i = 1; i < rings.length; i++) {
      if (pointInRing(lng, lat, rings[i])) return false;
    }
    return true;
  }
  if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates || []) {
      if (pointInGeometry(lng, lat, { type: 'Polygon', coordinates: poly })) return true;
    }
  }
  return false;
}

/** Miles of longitude at a given latitude. */
function milesToDegLng(miles, lat) {
  const cos = Math.cos((lat * Math.PI) / 180);
  return miles / (69.172 * Math.max(0.2, Math.abs(cos)));
}

function milesToDegLat(miles) {
  return miles / 69.172;
}

/**
 * True if place polygon intersects a geographic disk (center lng/lat, radius miles).
 */
export function geometryIntersectsDisk(geometry, lng, lat, radiusMi) {
  if (!geometry || !Number.isFinite(radiusMi) || radiusMi <= 0) return false;
  if (pointInGeometry(lng, lat, geometry)) return true;

  let hit = false;
  iterCoords(geometry, (x, y) => {
    if (hit) return;
    if (haversineMiles(lng, lat, x, y) <= radiusMi) hit = true;
  });
  if (hit) return true;

  // Edge sampling: if disk covers interior without hitting vertices (small polys)
  const step = Math.max(4, Math.min(24, Math.ceil(radiusMi)));
  for (let i = 0; i < step; i++) {
    const ang = (2 * Math.PI * i) / step;
    const dLat = milesToDegLat(radiusMi * Math.sin(ang));
    const dLng = milesToDegLng(radiusMi * Math.cos(ang), lat);
    if (pointInGeometry(lng + dLng, lat + dLat, geometry)) return true;
  }
  return false;
}

function bboxesNear(a, b, pad) {
  return !(
    a[2] + pad < b[0] ||
    b[2] + pad < a[0] ||
    a[3] + pad < b[1] ||
    b[3] + pad < a[1]
  );
}

function ringsTouch(coordsA, coordsB, eps) {
  // Vertex proximity (shared border / float gap)
  for (const [x1, y1] of coordsA) {
    for (const [x2, y2] of coordsB) {
      if (Math.abs(x1 - x2) <= eps && Math.abs(y1 - y2) <= eps) return true;
    }
  }
  return false;
}

function collectRingPoints(geometry) {
  const out = [];
  iterCoords(geometry, (x, y) => out.push([x, y]));
  return out;
}

export function featuresTouch(a, b) {
  const ba = featureBbox(a);
  const bb = featureBbox(b);
  if (!ba || !bb || !bboxesNear(ba, bb, TOUCH_EPS_DEG * 2)) return false;
  const pa = collectRingPoints(a.geometry);
  const pb = collectRingPoints(b.geometry);
  if (ringsTouch(pa, pb, TOUCH_EPS_DEG)) return true;
  // One centroid inside the other (enclave / overlap)
  const ca = featureCentroid(a);
  const cb = featureCentroid(b);
  if (ca && pointInGeometry(ca[0], ca[1], b.geometry)) return true;
  if (cb && pointInGeometry(cb[0], cb[1], a.geometry)) return true;
  return false;
}

/**
 * Build place-neighbors.json from an in-memory FeatureCollection (build script).
 * @param {{ type: string, features: object[] }} placesFc
 */
export function buildPlaceNeighborsIndex(placesFc) {
  const features = placesFc?.features || [];
  const byState = new Map();
  for (const f of features) {
    const st = String(f.properties?.state || '').toUpperCase();
    if (!st) continue;
    if (!byState.has(st)) byState.set(st, []);
    byState.get(st).push(f);
  }

  /** @type {Record<string, Array<{ name: string, state: string, population: number }>>} */
  const graph = {};

  const addEdge = (fa, fb) => {
    const ka = neighborKey(fa.properties.name, fa.properties.state);
    const kb = neighborKey(fb.properties.name, fb.properties.state);
    if (ka === kb) return;
    if (!graph[ka]) graph[ka] = [];
    if (!graph[kb]) graph[kb] = [];
    const pa = {
      name: fa.properties.name,
      state: String(fa.properties.state).toUpperCase(),
      population: Number(fa.properties.population) || 0,
    };
    const pb = {
      name: fb.properties.name,
      state: String(fb.properties.state).toUpperCase(),
      population: Number(fb.properties.population) || 0,
    };
    if (!graph[ka].some((x) => neighborKey(x.name, x.state) === kb)) graph[ka].push(pb);
    if (!graph[kb].some((x) => neighborKey(x.name, x.state) === ka)) graph[kb].push(pa);
  };

  for (const [, list] of byState) {
    // Name-keyed graph: only the largest-bbox place per name|state contributes edges
    // (do not merge Sunnyvale with a distant same-name CDP's neighbors).
    const winnerByName = new Map();
    for (const f of list) {
      const k = neighborKey(f.properties?.name, f.properties?.state);
      if (k === '|') continue;
      const prev = winnerByName.get(k);
      if (!prev || placeBboxArea(f) > placeBboxArea(prev)) winnerByName.set(k, f);
    }
    const withBbox = [...winnerByName.values()]
      .map((f) => ({ f, bbox: featureBbox(f) }))
      .filter((x) => x.bbox);
    for (let i = 0; i < withBbox.length; i++) {
      for (let j = i + 1; j < withBbox.length; j++) {
        if (!bboxesNear(withBbox[i].bbox, withBbox[j].bbox, TOUCH_EPS_DEG * 2)) continue;
        if (featuresTouch(withBbox[i].f, withBbox[j].f)) {
          addEdge(withBbox[i].f, withBbox[j].f);
        }
      }
    }
  }

  for (const k of Object.keys(graph)) {
    graph[k].sort((a, b) => b.population - a.population);
  }
  return graph;
}

export function writePlaceNeighborsIndex(placesFc, outPath = NEIGHBORS_PATH) {
  const graph = buildPlaceNeighborsIndex(placesFc);
  writeFileSync(outPath, JSON.stringify(graph));
  neighborsCache = graph;
  return { path: outPath, keys: Object.keys(graph).length };
}

export function loadPlaceNeighbors() {
  if (neighborsCache) return neighborsCache;
  if (!existsSync(NEIGHBORS_PATH)) {
    const err = new Error(
      'place-neighbors.json missing. Run: npm run build-research-map',
    );
    err.status = 404;
    err.code = 'map_neighbors_missing';
    throw err;
  }
  neighborsCache = applyNeighborCommonNames(JSON.parse(readFileSync(NEIGHBORS_PATH, 'utf8')));
  return neighborsCache;
}

function placeNameNeedles(city, state) {
  const needles = new Set();
  for (const label of equivalentPlaceNames(city, state)) {
    const needle = normalizePlaceName(label);
    if (needle) needles.add(needle);
  }
  return needles;
}

/** Old neighbor files key the Census name. Point the common name at that list and relabel entries. */
function applyNeighborCommonNames(graph) {
  if (!graph || typeof graph !== 'object') return graph;
  for (const rows of Object.values(graph)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const next = commonPlaceName(row.name, row.state);
      if (next && next !== row.name) row.name = next;
    }
  }
  for (const alias of PLACE_COMMON_NAMES) {
    const from = `${normalizePlaceName(alias.censusName)}|${alias.state}`;
    const to = `${normalizePlaceName(alias.commonName)}|${alias.state}`;
    if (graph[from] && !graph[to]) graph[to] = graph[from];
  }
  return graph;
}

export function findPlaceFeatureLocal(city, state) {
  const { byState } = loadPlaces();
  const abbr = String(state || '').trim().toUpperCase();
  const needles = placeNameNeedles(city, abbr);
  const needle = normalizePlaceName(city);
  if (!needles.size || !abbr) return null;
  const list = byState.get(abbr) || [];
  const exact = list.filter((f) => needles.has(normalizePlaceName(f.properties?.name)));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    return exact.reduce((best, f) => (placeBboxArea(f) > placeBboxArea(best) ? f : best));
  }
  // Multi-word prefix only (e.g. "Salt Lake" → "Salt Lake City"); never bare "Park" → "Park City"
  if (!needle.includes(' ')) return null;
  const prefixes = list.filter((f) =>
    normalizePlaceName(f.properties?.name).startsWith(`${needle} `),
  );
  if (prefixes.length === 1) return prefixes[0];
  if (prefixes.length > 1) {
    return prefixes.reduce((best, f) => (placeBboxArea(f) > placeBboxArea(best) ? f : best));
  }
  return null;
}

function placeBboxArea(feature) {
  const bb = featureBbox(feature);
  if (!bb) return 0;
  return Math.max(0, bb[2] - bb[0]) * Math.max(0, bb[3] - bb[1]);
}

function placeFeaturesNamed(city, state) {
  const { byState } = loadPlaces();
  const abbr = String(state || '').trim().toUpperCase();
  const needles = placeNameNeedles(city, abbr);
  if (!needles.size || !abbr) return [];
  const list = byState.get(abbr) || [];
  const exact = list.filter((f) => needles.has(normalizePlaceName(f.properties?.name)));
  if (exact.length) return exact;
  const one = findPlaceFeatureLocal(city, state);
  return one ? [one] : [];
}

/**
 * @returns {Array<{ name: string, state: string, population: number }>}
 */
export function adjacentPlaces(primaryCity, state, { minPop = 5000 } = {}) {
  const graph = loadPlaceNeighbors();
  const key = neighborKey(primaryCity, state);
  const rows = graph[key] || [];
  return rows.filter((r) => (Number(r.population) || 0) >= minPop);
}

/**
 * Places whose polygons intersect a radius disk around the primary city.
 * @returns {{
 *   primary: { name: string, state: string, population: number, center: [number, number] },
 *   places: Array<{ name: string, state: string, population: number, inRadius: boolean, selectedHint?: boolean }>,
 *   features: object[],
 *   radiusMiles: number
 * }}
 */
export function placesIntersectingRadius(
  primaryCity,
  state,
  radiusMiles,
  { minPop = 5000, maxPop = null, maxMiles = MAX_SERVICE_RADIUS_MILES } = {},
) {
  const primary = findPlaceFeatureLocal(primaryCity, state);
  if (!primary) {
    const err = new Error(`No Census place match for ${primaryCity}, ${state}`);
    err.status = 404;
    throw err;
  }
  const center = featureCentroid(primary);
  if (!center) {
    const err = new Error(`No geometry for ${primaryCity}, ${state}`);
    err.status = 500;
    throw err;
  }
  const [lng, lat] = center;
  const mileCap = Math.max(1, Number(maxMiles) || MAX_SERVICE_RADIUS_MILES);
  const miles = Math.max(1, Math.min(mileCap, Number(radiusMiles) || 15));
  const padLng = milesToDegLng(miles + 2, lat);
  const padLat = milesToDegLat(miles + 2);
  const bbox = [lng - padLng, lat - padLat, lng + padLng, lat + padLat];
  const minP = Number.isFinite(Number(minPop)) ? Number(minPop) : 5000;
  const maxP = maxPop != null && Number.isFinite(Number(maxPop)) ? Number(maxPop) : null;

  const abbr = String(state || '').trim().toUpperCase();
  const { byState, features: all } = loadPlaces();
  // Same state + any place whose bbox overlaps search window (cross-border OK)
  const candidates = [];
  const seen = new Set();
  const consider = (f) => {
    const geoid = featureGeoid(f);
    const k = geoid || `i:${candidates.length}`;
    if (seen.has(k)) return;
    seen.add(k);
    candidates.push(f);
  };
  for (const f of byState.get(abbr) || []) consider(f);
  for (const f of all) {
    const bb = featureBbox(f);
    if (!bb) continue;
    if (bb[2] < bbox[0] || bb[0] > bbox[2] || bb[3] < bbox[1] || bb[1] > bbox[3]) continue;
    consider(f);
  }

  const places = [];
  const outFeatures = [];
  const primaryGeoid = featureGeoid(primary);
  const primaryKey = neighborKey(primary.properties.name, primary.properties.state);

  for (const f of candidates) {
    const pop = Number(f.properties?.population) || 0;
    const name = f.properties?.name;
    const st = String(f.properties?.state || '').toUpperCase();
    const geoid = featureGeoid(f);
    const isPrimary = primaryGeoid
      ? geoid === primaryGeoid
      : neighborKey(name, st) === primaryKey;
    const inRadius =
      isPrimary || geometryIntersectsDisk(f.geometry, lng, lat, miles);
    if (!inRadius) continue;
    if (!isPrimary && pop < minP) continue;
    if (!isPrimary && maxP != null && pop > maxP) continue;
    places.push({
      name,
      state: st,
      population: pop,
      inRadius: true,
      isPrimary,
    });
    outFeatures.push({
      type: 'Feature',
      properties: {
        ...f.properties,
        inRadius: true,
        isPrimary,
      },
      geometry: f.geometry,
    });
  }

  places.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return b.population - a.population;
  });

  return {
    primary: {
      name: primary.properties.name,
      state: String(primary.properties.state).toUpperCase(),
      population: Number(primary.properties.population) || 0,
      center,
    },
    places,
    features: outFeatures,
    radiusMiles: miles,
  };
}

function inPopBand(pop, band = {}) {
  const n = Number(pop) || 0;
  const min = Number(band.min);
  const max = band.max;
  if (Number.isFinite(min) && n < min) return false;
  if (max != null && max !== '' && Number.isFinite(Number(max)) && n > Number(max)) return false;
  return true;
}

/**
 * Zone membership around the current hub: polygon intersects the disk, or centroid is within miles + slack.
 * Independent of Cluster Cities pop bands (those are a separate paint check).
 */
export function placeInZoneRadius(city, state, hubCity, hubState, miles, { slack = 0.5 } = {}) {
  const cap = Number(miles);
  const hubFeat = findPlaceFeatureLocal(hubCity, hubState);
  const feats = placeFeaturesNamed(city, state);
  const feat = feats.reduce((best, f) => (placeBboxArea(f) > placeBboxArea(best) ? f : best), feats[0] || null);
  if (!hubFeat || !feats.length || !Number.isFinite(cap) || cap <= 0) {
    return { inZone: false, miles: null, feat, hubFeat };
  }
  if (neighborKey(city, state) === neighborKey(hubCity, hubState)) {
    return { inZone: true, miles: 0, feat: hubFeat, hubFeat };
  }
  const center = featureCentroid(hubFeat);
  if (!center) return { inZone: false, miles: null, feat, hubFeat };
  const [lng, lat] = center;
  let inZone = false;
  let bestDist = null;
  for (const f of feats) {
    const c = featureCentroid(f);
    const dist = c ? haversineMiles(lng, lat, c[0], c[1]) : null;
    if (geometryIntersectsDisk(f.geometry, lng, lat, cap + slack)) inZone = true;
    if (Number.isFinite(dist) && dist <= cap + slack) inZone = true;
    if (Number.isFinite(dist) && (bestDist == null || dist < bestDist)) bestDist = dist;
  }
  return {
    inZone,
    miles: bestDist == null ? null : Math.round(bestDist * 10) / 10,
    feat,
    hubFeat,
  };
}

/**
 * Inner / outer shotgun site pools around a hub (Census places, with miles).
 * Inner / outer pools use the Cluster Cities pop band.
 */
export function shotgunRingPools(
  primaryCity,
  state,
  {
    innerMiles = 15,
    outerMiles = 30,
    citiesBand,
    wave1,
    wave2,
  } = {},
) {
  const band = citiesBand || wave1 || { min: 8000, max: 60000 };
  const outerBand = citiesBand || wave2 || band;
  const inner = Math.max(1, Math.min(MAX_CLUSTER_MILES, Number(innerMiles) || 15));
  const outer = Math.max(inner, Math.min(MAX_CLUSTER_MILES, Number(outerMiles) || 30));
  const minScan = Math.min(Number(band.min) || 0, Number(outerBand.min) || 0);
  const scan = placesIntersectingRadius(primaryCity, state, outer, {
    minPop: minScan,
    maxMiles: MAX_CLUSTER_MILES,
  });
  const [lng, lat] = scan.primary.center || [];
  const innerPool = [];
  const outerPool = [];
  for (const p of scan.places) {
    if (p.isPrimary) continue;
    const feat = findPlaceFeatureLocal(p.name, p.state);
    const c = feat ? featureCentroid(feat) : null;
    const miles =
      c && Number.isFinite(lng) && Number.isFinite(lat)
        ? Math.round(haversineMiles(lng, lat, c[0], c[1]) * 10) / 10
        : outer;
    const row = {
      name: p.name,
      state: p.state,
      population: p.population,
      miles,
    };
    if (miles <= inner + 0.15 && inPopBand(p.population, band)) {
      innerPool.push(row);
      continue;
    }
    if (miles <= outer + 0.15 && inPopBand(p.population, outerBand)) {
      outerPool.push(row);
    }
  }
  innerPool.sort((a, b) => b.population - a.population);
  outerPool.sort((a, b) => b.population - a.population);
  return {
    primary: scan.primary,
    innerMiles: inner,
    outerMiles: outer,
    innerPool,
    outerPool,
    cityPool: [...innerPool, ...outerPool],
    viable: innerPool.length + outerPool.length >= 3,
  };
}

function coverageName(entry) {
  if (typeof entry === 'string') return entry.trim();
  return String(entry?.name || entry?.city || '').trim();
}

function coverageState(entry, fallback) {
  if (typeof entry === 'object' && entry?.state) {
    return String(entry.state).trim().toUpperCase();
  }
  return String(fallback || '').trim().toUpperCase();
}

/**
 * Location page pick from Accept'd coverage.
 * Default: Claude-first, then highest population.
 * Zone: ignoreClaudeOrder + sortBy distance (nearest leftover).
 * `maxMiles` limits AUTO rest-fill only; `claudeOrder` / kept pages still win.
 * When `minPages` (including primary) is still short after the mile cap, promote
 * already-covered leftovers nearest-first up to `max` (skipName still applies).
 * @returns {string[]} suburb names (excludes primary)
 */
export function mergeLocationPages({
  coverage = [],
  claudeOrder = [],
  primaryCity = '',
  state = '',
  max = 8,
  minPages = 0,
  skipName = null,
  ignoreClaudeOrder = false,
  sortBy = 'population',
  distanceMiles = null,
  maxMiles = null,
} = {}) {
  const primaryNorm = normalizePlaceName(primaryCity);
  const st = String(state || '').trim().toUpperCase();
  const covKeys = new Map();
  for (const c of coverage) {
    const name = coverageName(c);
    if (!name) continue;
    const key = neighborKey(name, coverageState(c, st));
    if (normalizePlaceName(name) === primaryNorm) continue;
    covKeys.set(key, name);
  }

  const out = [];
  const used = new Set();

  const pushName = (name, { preferLabel } = {}) => {
    const n = String(name || '').trim();
    if (!n) return;
    if (normalizePlaceName(n) === primaryNorm) return;
    if (typeof skipName === 'function' && skipName(n, st)) return;
    let display = preferLabel || n;
    let matchedKey = null;
    for (const [ck, cn] of covKeys) {
      if (normalizePlaceName(cn) === normalizePlaceName(n)) {
        matchedKey = ck;
        // Prefer Claude/operator label when it is a longer/more specific form
        if (preferLabel) display = preferLabel;
        else display = cn;
        break;
      }
    }
    if (!matchedKey) return;
    if (used.has(matchedKey)) return;
    used.add(matchedKey);
    out.push(display);
  };

  if (!ignoreClaudeOrder) {
    for (const c of claudeOrder || []) {
      if (out.length >= max) break;
      pushName(c, { preferLabel: String(c || '').trim() });
    }
  }

  const rest = [...covKeys.entries()]
    .filter(([k]) => !used.has(k))
    .map(([, name]) => {
      const f = findPlaceFeatureLocal(name, st);
      const miles = typeof distanceMiles === 'function' ? Number(distanceMiles(name, st)) : NaN;
      return {
        name,
        population: Number(f?.properties?.population) || 0,
        miles: Number.isFinite(miles) ? miles : Number.POSITIVE_INFINITY,
      };
    })
    .sort((a, b) => {
      if (sortBy === 'distance') {
        if (a.miles !== b.miles) return a.miles - b.miles;
      }
      return b.population - a.population;
    });

  const autoCap = Number(maxMiles);
  const applyAutoMiles =
    maxMiles != null && maxMiles !== '' && Number.isFinite(autoCap) && autoCap >= 0;

  for (const r of rest) {
    if (out.length >= max) break;
    if (applyAutoMiles && !(Number.isFinite(r.miles) && r.miles <= autoCap)) continue;
    pushName(r.name);
  }

  const wantPages = Number(minPages);
  if (Number.isFinite(wantPages) && wantPages > 0 && 1 + out.length < wantPages) {
    for (const r of rest) {
      if (out.length >= max) break;
      pushName(r.name);
    }
  }

  return out.slice(0, max);
}

/**
 * Build coverageAreas objects from selected place list.
 */
export function toCoverageAreas(selected, primaryCity, state) {
  const st = String(state || '').trim().toUpperCase();
  const primaryNorm = normalizePlaceName(primaryCity);
  const areas = [];
  const seen = new Set();

  const displayName = (name) => {
    const n = String(name || '').trim();
    if (/^west valley$/i.test(n)) return 'West Valley City';
    if (/^salt lake$/i.test(n)) return 'Salt Lake City';
    if (/^white$/i.test(n)) return 'White City';
    return n;
  };

  const add = (name, stAbbr) => {
    const n = displayName(name);
    if (!n) return;
    const key = neighborKey(n, stAbbr);
    if (seen.has(key)) return;
    seen.add(key);
    areas.push({ name: n, state: stAbbr });
  };

  add(primaryCity, st);
  for (const s of selected || []) {
    if (typeof s === 'string') add(s, st);
    else add(s.name || s.city, coverageState(s, st));
  }
  // ensure primary first
  areas.sort((a, b) => {
    const ap = normalizePlaceName(a.name) === primaryNorm;
    const bp = normalizePlaceName(b.name) === primaryNorm;
    if (ap !== bp) return ap ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return areas;
}
