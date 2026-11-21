/**
 * Build data/phone/city-area-codes.json.
 *
 * City prefixes come from libphonenumber's US geocoding file. Newer overlays
 * such as 385 and 447 are only labeled with the state there, so NANPA overlay
 * complexes add those codes onto cities that already have a code in the same
 * complex (385 joins every city that has 801).
 *
 * Raw downloads are not saved. Run: node scripts/build-city-area-codes.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ABBR_TO_NAME, normalizePlaceName } from '../ops/lib/census.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'phone', 'city-area-codes.json');
const GEO_URL =
  'https://raw.githubusercontent.com/google/libphonenumber/master/resources/geocoding/en/1.txt';
const NANPA_URL = 'https://reports.nanpa.com/public/npa_report.csv';

const US_STATES = new Set(Object.keys(ABBR_TO_NAME));

async function download(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'Rover city-area-code build' },
  });
  if (!response.ok) {
    throw new Error(`Download failed ${response.status} for ${url}`);
  }
  return response.text();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function cityState(description) {
  if (description === 'Washington D.C.') return { city: 'Washington', state: 'DC' };
  const match = description.match(/^(.*),\s*([A-Z]{2})$/);
  if (!match) return null;
  const state = match[2];
  if (!US_STATES.has(state)) return null;
  const pieces = match[1].split(',');
  const city = pieces[pieces.length - 1].trim();
  if (!city) return null;
  return { city, state };
}

function overlayComplexes(csvText) {
  const rows = parseCsv(csvText);
  const headerIndex = rows.findIndex((row) => row[0] === 'NPA_ID');
  if (headerIndex < 0) throw new Error('NANPA report is missing the NPA_ID header');
  const header = rows[headerIndex];
  const column = Object.fromEntries(header.map((name, index) => [name, index]));
  /** @type {Map<string, Set<string>>} */
  const byNpa = new Map();
  for (const row of rows.slice(headerIndex + 1)) {
    if (row[column.COUNTRY] !== 'US') continue;
    if (row[column.OVERLAY] !== 'Yes') continue;
    const members = String(row[column.OVERLAY_COMPLEX] || '')
      .split('/')
      .map((part) => part.trim())
      .filter((part) => /^\d{3}$/.test(part));
    if (members.length < 2) continue;
    const group = new Set(members);
    for (const npa of group) byNpa.set(npa, group);
  }
  return byNpa;
}

function cityCodes(geoText) {
  /** @type {Map<string, Set<string>>} */
  const cities = new Map();
  for (const line of geoText.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const splitAt = line.indexOf('|');
    if (splitAt < 0) continue;
    const prefix = line.slice(0, splitAt);
    if (!/^1[2-9]\d{2,}$/.test(prefix)) continue;
    const place = cityState(line.slice(splitAt + 1).trim());
    if (!place) continue;
    const key = `${normalizePlaceName(place.city)}|${place.state}`;
    if (!cities.has(key)) cities.set(key, new Set());
    cities.get(key).add(prefix.slice(1, 4));
  }
  return cities;
}

function applyOverlays(cities, complexes) {
  for (const codes of cities.values()) {
    const extra = [];
    for (const npa of codes) {
      const group = complexes.get(npa);
      if (!group) continue;
      for (const other of group) extra.push(other);
    }
    for (const npa of extra) codes.add(npa);
  }
}

function sortedRecord(cities) {
  const record = {};
  for (const key of [...cities.keys()].sort()) {
    record[key] = [...cities.get(key)].sort();
  }
  return record;
}

const [geoText, nanpaText] = await Promise.all([download(GEO_URL), download(NANPA_URL)]);
const cities = cityCodes(geoText);
applyOverlays(cities, overlayComplexes(nanpaText));
const record = sortedRecord(cities);
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`);

const sample = (key) => `${key} ${ (record[key] || []).join(',') || '(missing)' }`;
console.log(`Wrote ${Object.keys(record).length} cities to ${path.relative(ROOT, OUT)}`);
console.log(sample('salt lake city|UT'));
console.log(sample('phoenix|AZ'));
console.log(sample('springfield|IL'));
console.log(sample('saint george|UT'));
console.log(sample('flagstaff|AZ'));
