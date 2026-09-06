/**
 * Research map GeoJSON serving (operator Map tab).
 */

import { existsSync } from 'node:fs';
import { normalizePlaceName } from './census.mjs';
import { layerGeojsonPath, loadMapLayer } from './census-map-layers.mjs';

function loadLayer(layer) {
  return loadMapLayer(layer);
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

/** Find a place feature by city + state (for Show / Candidates zoom). */
export function findPlaceFeature(city, state) {
  const loaded = loadLayer('places');
  if (!loaded) return null;
  const abbr = String(state || '')
    .trim()
    .toUpperCase();
  const needle = normalizePlaceName(city);
  if (!needle || !abbr) return null;
  const inState = loaded.features.filter(
    (f) => String(f.properties?.state || '').toUpperCase() === abbr,
  );
  const exact = inState.find((f) => normalizePlaceName(f.properties?.name) === needle);
  if (exact) return exact;
  // Multi-word prefix only (e.g. "Salt Lake" → "Salt Lake City"); never bare "Park" → "Park City"
  if (!needle.includes(' ')) return null;
  const prefixes = inState.filter((f) =>
    normalizePlaceName(f.properties?.name).startsWith(`${needle} `),
  );
  return prefixes.length === 1 ? prefixes[0] : null;
}
