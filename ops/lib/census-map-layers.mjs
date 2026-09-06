/**
 * Shared Census map GeoJSON loader (places + counties).
 * One parsed FeatureCollection per layer for the process — Map tab and
 * service-area helpers must not each JSON.parse places.geojson.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MAP_DIR = path.join(ROOT, 'data', 'census', 'map');

/**
 * @typedef {{
 *   features: object[],
 *   byState: Map<string, object[]>,
 *   loadedAt: number,
 *   bytes: number,
 *   mtimeMs: number,
 *   path: string,
 * }} MapLayerCache
 */

/** @type {Map<string, MapLayerCache>} */
const cache = new Map();

export function censusMapDir() {
  return MAP_DIR;
}

export function layerGeojsonPath(layer) {
  const key = layer === 'counties' ? 'counties' : 'places';
  return path.join(MAP_DIR, `${key}.geojson`);
}

export function placesGeojsonPath() {
  return layerGeojsonPath('places');
}

export function countiesGeojsonPath() {
  return layerGeojsonPath('counties');
}

function mapMissingError(layer) {
  const label = layer === 'counties' ? 'counties' : 'places';
  const err = new Error(
    `Map data missing for ${label}. Run: npm run build-research-map`,
  );
  err.status = 404;
  err.code = 'map_data_missing';
  return err;
}

/**
 * @param {'places'|'counties'|string} layer
 * @param {{ required?: boolean }} [opts]
 * @returns {MapLayerCache | null}
 */
export function loadMapLayer(layer, { required = false } = {}) {
  const key = layer === 'counties' ? 'counties' : 'places';
  const file = layerGeojsonPath(key);
  if (!existsSync(file)) {
    if (required) throw mapMissingError(key);
    return null;
  }
  const st = statSync(file);
  const prev = cache.get(key);
  if (prev && prev.bytes === st.size && prev.mtimeMs === st.mtimeMs) return prev;
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const features = Array.isArray(raw?.features) ? raw.features : [];
  /** @type {Map<string, object[]>} */
  const byState = new Map();
  for (const f of features) {
    const abbr = String(f.properties?.state || '').toUpperCase();
    if (!abbr) continue;
    if (!byState.has(abbr)) byState.set(abbr, []);
    byState.get(abbr).push(f);
  }
  const entry = {
    features,
    byState,
    loadedAt: Date.now(),
    bytes: st.size,
    mtimeMs: st.mtimeMs,
    path: file,
  };
  cache.set(key, entry);
  return entry;
}

/** Places layer or 404 — used by service-area / coverage helpers. */
export function loadPlacesLayer() {
  return loadMapLayer('places', { required: true });
}
