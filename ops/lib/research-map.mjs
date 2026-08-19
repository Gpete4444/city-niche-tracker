/**
 * Research map GeoJSON serving (operator Map tab).
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MAP_DIR = path.join(ROOT, 'data', 'census', 'map');

/** @type {Map<string, { features: object[], loadedAt: number, bytes: number }>} */
const cache = new Map();

function layerPath(layer) {
  const key = layer === 'counties' ? 'counties' : 'places';
  return path.join(MAP_DIR, `${key}.geojson`);
}

function loadLayer(layer) {
  const key = layer === 'counties' ? 'counties' : 'places';
  const file = layerPath(key);
  if (!existsSync(file)) return null;
  const st = statSync(file);
  const prev = cache.get(key);
  if (prev && prev.bytes === st.size) return prev;
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const features = Array.isArray(raw?.features) ? raw.features : [];
  const entry = { features, loadedAt: Date.now(), bytes: st.size };
  cache.set(key, entry);
  return entry;
}

/**
 * @param {{ layer?: string, minPop?: number, maxPop?: number, state?: string }} opts
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
  const state = String(opts.state || '')
    .trim()
    .toUpperCase();

  let inRangeCount = 0;
  let outOfRangeCount = 0;

  const features = [];
  for (const f of loaded.features) {
    const p = f.properties || {};
    const pop = Number(p.population);
    if (!Number.isFinite(pop)) continue;
    if (state && String(p.state || '').toUpperCase() !== state) continue;

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
      state: state || null,
    },
  };
}

export function getMapStatus() {
  const placesFile = layerPath('places');
  const countiesFile = layerPath('counties');
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

/** Find a place feature by city + state (for Show / Candidates zoom). */
export function findPlaceFeature(city, state) {
  const loaded = loadLayer('places');
  if (!loaded) return null;
  const abbr = String(state || '')
    .trim()
    .toUpperCase();
  const needle = String(city || '')
    .trim()
    .toLowerCase();
  if (!needle || !abbr) return null;
  const exact = loaded.features.find((f) => {
    const p = f.properties || {};
    return (
      String(p.state || '').toUpperCase() === abbr &&
      String(p.name || '').toLowerCase() === needle
    );
  });
  if (exact) return exact;
  return (
    loaded.features.find((f) => {
      const p = f.properties || {};
      return (
        String(p.state || '').toUpperCase() === abbr &&
        String(p.name || '')
          .toLowerCase()
          .startsWith(needle)
      );
    }) || null
  );
}
