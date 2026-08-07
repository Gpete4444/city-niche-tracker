/**
 * US Census place population index (incorporated places file).
 * Expected CSV rows like: "Louisville city, Kentucky","633,045"
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const STATE_NAME_TO_ABBR = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
};

const ABBR_TO_NAME = Object.fromEntries(
  Object.entries(STATE_NAME_TO_ABBR).map(([name, abbr]) => [abbr, name]),
);

let cache = null;

export function censusCsvPath() {
  return (
    process.env.CENSUS_POP_CSV ||
    path.join(ROOT, 'data', 'census', 'SUB-IP-EST2025-POP.csv')
  );
}

function normalizePlaceName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+(city|town|village|borough|municipality|cdp|urban county)\s*$/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePop(raw) {
  const n = Number(String(raw || '').replace(/[",]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseCsvLine(line) {
  const m = line.match(/^"(.*)",\s*"?(.*?)"?\s*$/);
  if (m) return [m[1].replace(/""/g, '"'), m[2]];
  const parts = line.split(',');
  if (parts.length < 2) return null;
  const pop = parts.pop();
  return [parts.join(',').replace(/^"|"$/g, ''), pop];
}

/**
 * @returns {{ byKey: Map<string, number>, byState: Map<string, Array<{city:string,state:string,population:number}>>, path: string, ok: boolean, error?: string }}
 */
export function loadCensusIndex() {
  if (cache) return cache;
  const filePath = censusCsvPath();
  if (!existsSync(filePath)) {
    cache = {
      byKey: new Map(),
      byState: new Map(),
      path: filePath,
      ok: false,
      error: `Census file not found: ${filePath}. Set CENSUS_POP_CSV.`,
    };
    return cache;
  }

  const byKey = new Map();
  const byState = new Map();
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    if (!line.includes(',') || /Geographic Area|Annual Estimates|table with/i.test(line)) {
      continue;
    }
    const parsed = parseCsvLine(line);
    if (!parsed) continue;
    const [geo, popRaw] = parsed;
    const pop = parsePop(popRaw);
    if (pop == null) continue;

    const comma = geo.lastIndexOf(',');
    if (comma < 0) continue;
    let place = geo.slice(0, comma).trim();
    let stateName = geo.slice(comma + 1).trim().toLowerCase();
    const abbr = STATE_NAME_TO_ABBR[stateName];
    if (!abbr) continue;

    const cityNorm = normalizePlaceName(place);
    if (!cityNorm) continue;

    const key = `${cityNorm}|${abbr}`;
    const prev = byKey.get(key);
    if (prev == null || pop > prev) byKey.set(key, pop);

    if (!byState.has(abbr)) byState.set(abbr, []);
    byState.get(abbr).push({
      city: place.replace(/\s+(city|town|village|borough|cdp)$/i, '').trim(),
      state: abbr,
      population: pop,
    });
  }

  for (const [abbr, rows] of byState) {
    rows.sort((a, b) => b.population - a.population);
    byState.set(abbr, rows);
  }

  cache = { byKey, byState, path: filePath, ok: true };
  return cache;
}

export function lookupPopulation(city, state) {
  const idx = loadCensusIndex();
  if (!idx.ok) return null;
  const abbr = String(state || '')
    .trim()
    .toUpperCase();
  const cityNorm = normalizePlaceName(city);
  if (!cityNorm) return null;

  const exact = idx.byKey.get(`${cityNorm}|${abbr}`);
  if (exact != null) return exact;

  // Consolidated / metro names: "Louisville/Jefferson County metro government (balance)"
  const rows = idx.byState.get(abbr) || [];
  let best = null;
  for (const row of rows) {
    const n = normalizePlaceName(row.city);
    if (n === cityNorm || n.startsWith(`${cityNorm} `) || n.startsWith(`${cityNorm}/`)) {
      if (!best || row.population > best) best = row.population;
    }
  }
  return best;
}

export function topPlacesInState(state, { minPopulation = 0, limit = 20 } = {}) {
  const idx = loadCensusIndex();
  if (!idx.ok) return [];
  const abbr = String(state || '')
    .trim()
    .toUpperCase();
  const rows = idx.byState.get(abbr) || [];
  return rows.filter((r) => r.population >= minPopulation).slice(0, limit);
}

export function censusStatus() {
  const idx = loadCensusIndex();
  return {
    ok: idx.ok,
    path: idx.path,
    placeCount: idx.byKey?.size ?? 0,
    error: idx.error ?? null,
  };
}

export { normalizePlaceName, ABBR_TO_NAME };
