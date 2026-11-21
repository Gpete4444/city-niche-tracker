/**
 * City to area codes, including overlays.
 * Rebuild with: node scripts/build-city-area-codes.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePlaceName } from './census.mjs';
import { equivalentPlaceNames } from './place-common-names.mjs';

const FILE = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  'data',
  'phone',
  'city-area-codes.json',
);

/** @type {Record<string, string[]> | null} */
let cache = null;

function loadCityAreaCodes() {
  if (!cache) cache = JSON.parse(readFileSync(FILE, 'utf8'));
  return cache;
}

export function cityAreaCodeKey(city, state) {
  const abbr = String(state || '').trim().toUpperCase();
  return `${normalizePlaceName(city)}|${abbr}`;
}

/** Area codes that serve this city, legacy and overlay. Empty when the city is not in the map. */
export function cityAreaCodes(city, state) {
  const abbr = String(state || '').trim().toUpperCase();
  const data = loadCityAreaCodes();
  const codes = new Set();
  for (const name of equivalentPlaceNames(city, abbr)) {
    const list = data[cityAreaCodeKey(name, abbr)];
    if (!list) continue;
    for (const code of list) codes.add(String(code));
  }
  return [...codes].sort();
}
