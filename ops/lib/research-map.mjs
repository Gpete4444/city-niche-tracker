/**
 * Research map GeoJSON serving (operator Map tab).
 */

import { existsSync } from 'node:fs';
import { normalizePlaceName } from './census.mjs';
import { commonPlaceName } from './place-common-names.mjs';
import { layerGeojsonPath, loadMapLayer } from './census-map-layers.mjs';
import { featureBbox, findPlaceFeatureLocal } from './geo-neighbors.mjs';

function featureGeoid(f) {
  return String(f?.properties?.geoid || f?.properties?.GEOID || '').trim();
}

function loadLayer(layer) {
  return loadMapLayer(layer);
}

function parseBbox(raw) {
  if (raw == null || raw === '') return null;
  const parts = String(raw)
    .split(',')
    .map((n) => Number(String(n).trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts;
}

function parseStates(opts) {
  const fromList = String(opts.states || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length === 2);
  if (fromList.length) return fromList;
  const one = String(opts.state || '')
    .trim()
    .toUpperCase();
  return one.length === 2 ? [one] : [];
}

function bboxOverlaps(bb, box) {
  if (!box) return true;
  if (!bb) return false;
  return !(bb[2] < box[0] || bb[0] > box[2] || bb[3] < box[1] || bb[1] > box[3]);
}

/**
 * @param {{ layer?: string, minPop?: number, maxPop?: number, state?: string, states?: string, bbox?: string|number[] }} opts
 */
export function getMapGeojson(opts = {}) {
  const layer = opts.layer === 'counties' ? 'counties' : 'places';
  const loaded = loadLayer(layer);
  if (!loaded) {
    const err = new Error(
      `Map data missing for ${layer}. Run: npm run build-research-map`,
    );
    err.status = 404;
    err.code = 'map_data_missing';
    throw err;
  }

  const minPop = Number(opts.minPop);
  const maxPop = Number(opts.maxPop);
  const hasMin = Number.isFinite(minPop);
  const hasMax = Number.isFinite(maxPop);
  const stateList = parseStates(opts);
  const bbox = Array.isArray(opts.bbox) ? opts.bbox : parseBbox(opts.bbox);
  const dropBelowMin = Boolean(bbox) && hasMin;

  let source = loaded.features;
  if (stateList.length && loaded.byState) {
    source = [];
    const seen = new Set();
    for (const abbr of stateList) {
      for (const f of loaded.byState.get(abbr) || []) {
        const geoid = featureGeoid(f);
        const k = geoid || `i:${source.length}`;
        if (seen.has(k)) continue;
        seen.add(k);
        source.push(f);
      }
    }
  }

  let inRangeCount = 0;
  let outOfRangeCount = 0;

  const features = [];
  for (const f of source) {
    const p = f.properties || {};
    const pop = Number(p.population);
    if (!Number.isFinite(pop)) continue;
    if (bbox && !bboxOverlaps(featureBbox(f), bbox)) continue;
    if (dropBelowMin && pop < minPop) continue;

    let inRange = true;
    if (hasMin && pop < minPop) inRange = false;
    if (hasMax && pop > maxPop) inRange = false;
    if (inRange) inRangeCount += 1;
    else outOfRangeCount += 1;

    features.push({
      ...f,
      properties: {
        ...p,
        inRange,
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
    meta: {
      layer,
      total: loaded.features.length,
      filtered: features.length,
      inRangeCount,
      outOfRangeCount,
      minPop: hasMin ? minPop : null,
      maxPop: hasMax ? maxPop : null,
      state: stateList.length === 1 ? stateList[0] : null,
      states: stateList.length ? stateList : null,
      bbox,
    },
  };
}

export function getMapStatus() {
  const placesFile = layerGeojsonPath('places');
  const countiesFile = layerGeojsonPath('counties');
  const placesOk = existsSync(placesFile);
  const countiesOk = existsSync(countiesFile);
  let placesCount = 0;
  let countiesCount = 0;
  if (placesOk) {
    try {
      placesCount = loadLayer('places')?.features.length || 0;
    } catch {
      placesCount = 0;
    }
  }
  if (countiesOk) {
    try {
      countiesCount = loadLayer('counties')?.features.length || 0;
    } catch {
      countiesCount = 0;
    }
  }
  return {
    ok: placesOk && countiesOk,
    places: { ok: placesOk, path: placesFile, count: placesCount },
    counties: { ok: countiesOk, path: countiesFile, count: countiesCount },
    hint: placesOk && countiesOk ? null : 'Run npm run build-research-map',
  };
}

const PLACES_BATCH_MAX = 40;

/**
 * Batch Census place polygons for a small city list (Shotgun cluster map).
 * @param {Array<{ city?: string, name?: string, state?: string }>} places
 * @param {{ max?: number }} [opts]
 */
export function findPlaceFeatures(places, { max = PLACES_BATCH_MAX } = {}) {
  const cap = Math.max(1, Math.min(100, Number(max) || PLACES_BATCH_MAX));
  const list = Array.isArray(places) ? places.slice(0, cap) : [];
  const features = [];
  const missing = [];
  const seen = new Set();
  for (const p of list) {
    const city = String(p?.city || p?.name || '').trim();
    const state = String(p?.state || '').trim();
    if (!city || !state) continue;
    const key = `${normalizePlaceName(commonPlaceName(city, state))}|${state.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const feature = findPlaceFeature(city, state);
    if (feature) features.push(feature);
    else missing.push({ city, state });
  }
  return {
    type: 'FeatureCollection',
    features,
    missing,
  };
}

/** Find a place feature by city + state (for Show / Candidates zoom). Largest bbox wins on name ties. */
export function findPlaceFeature(city, state) {
  const loaded = loadLayer('places');
  if (!loaded) return null;
  return findPlaceFeatureLocal(city, state);
}
