/**
 * US Census place population index.
 * Primary: incorporated places (SUB-IP-EST*.csv).
 * Gap-fill: ACS 5-year place totals (acs5-place-pop.csv) for CDPs / unmatched GEOIDs.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { commonPlaceName } from './place-common-names.mjs';

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

export function acsPlacePopCsvPath() {
  return (
    process.env.ACS_PLACE_POP_CSV ||
    path.join(ROOT, 'data', 'census', 'acs5-place-pop.csv')
  );
}

function stripCensusPlaceTypeSuffix(name) {
  return String(name || '')
    .replace(/\s+CDP$/i, '')
    .replace(/\s+urban county$/i, '')
    .replace(/\s+municipality$/i, '')
    // LSAD legal types are lowercase in NAMELSAD ("Park City city"); do not strip proper-name "City"
    .replace(/\s+(city|town|village|borough)$/, '')
    .trim();
}

function normalizePlaceName(name) {
  let s = stripCensusPlaceTypeSuffix(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Expand common abbreviations so St./Saint and Mt./Mount share one key
  s = s
    .replace(/\bst\b/g, 'saint')
    .replace(/\bmt\b/g, 'mount')
    .replace(/\bft\b/g, 'fort');
  return s;
}

function displayCityLabel(place) {
  return stripCensusPlaceTypeSuffix(place);
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

function addPlaceRow(byKey, byState, cityLabel, abbr, pop) {
  const city = commonPlaceName(displayCityLabel(cityLabel), abbr);
  const cityNorm = normalizePlaceName(city);
  if (!cityNorm || !abbr || pop == null) return false;
  const key = `${cityNorm}|${abbr}`;
  const prev = byKey.get(key);
  if (prev == null || pop > prev) byKey.set(key, pop);

  if (!byState.has(abbr)) byState.set(abbr, []);
  byState.get(abbr).push({
    city,
    state: abbr,
    population: pop,
  });
  return true;
}

/**
 * Load ACS GEOID → population (+ optional name/state for suggest gap-fill).
 * CSV header: geoid,population,name,state
 */
export function loadAcsPlacePopByGeoid(filePath = acsPlacePopCsvPath()) {
  /** @type {Map<string, { population: number, name?: string, state?: string }>} */
  const byGeoid = new Map();
  if (!existsSync(filePath)) return byGeoid;
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  let start = 0;
  if (/^geoid,/i.test(lines[0] || '')) start = 1;
  for (let i = start; i < lines.length; i += 1) {
    const cols = parseAcsCsvRow(lines[i]);
    if (!cols || cols.length < 2) continue;
    const geoid = String(cols[0] || '').trim();
    const pop = parsePop(cols[1]);
    if (!geoid || pop == null) continue;
    const name = cols[2] != null ? String(cols[2]).trim() : '';
    const state = cols[3] != null ? String(cols[3]).trim().toUpperCase() : '';
    byGeoid.set(geoid, {
      population: pop,
      ...(name ? { name } : {}),
      ...(state ? { state } : {}),
    });
  }
  return byGeoid;
}

/** Minimal CSV row parser (supports quoted fields). */
function parseAcsCsvRow(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQ = true;
      continue;
    }
    if (ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * @returns {{ byKey: Map<string, number>, byState: Map<string, Array<{city:string,state:string,population:number}>>, byGeoid: Map<string, number>, path: string, ok: boolean, error?: string }}
 */
export function loadCensusIndex() {
  if (cache) return cache;
  const filePath = censusCsvPath();
  if (!existsSync(filePath)) {
    cache = {
      byKey: new Map(),
      byState: new Map(),
      byGeoid: new Map(),
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

    addPlaceRow(byKey, byState, place, abbr, pop);
  }

  // ACS gap-fill: CDPs and other places missing from SUB-IP (SUB-IP wins on name|state).
  const acsByGeoid = loadAcsPlacePopByGeoid();
  /** @type {Map<string, number>} */
  const byGeoid = new Map();
  for (const [geoid, row] of acsByGeoid) {
    byGeoid.set(geoid, row.population);
    if (!row.name || !row.state) continue;
    const key = `${normalizePlaceName(commonPlaceName(row.name, row.state))}|${row.state}`;
    if (byKey.has(key)) continue;
    addPlaceRow(byKey, byState, row.name, row.state, row.population);
  }

  for (const [abbr, rows] of byState) {
    // Dedupe identical city labels within a state (keep highest pop).
    const best = new Map();
    for (const row of rows) {
      const k = normalizePlaceName(row.city);
      const prev = best.get(k);
      if (!prev || row.population > prev.population) best.set(k, row);
    }
    const deduped = [...best.values()].sort((a, b) => b.population - a.population);
    byState.set(abbr, deduped);
  }

  cache = { byKey, byState, byGeoid, path: filePath, ok: true };
  return cache;
}

export function lookupPopulation(city, state) {
  const idx = loadCensusIndex();
  if (!idx.ok) return null;
  const abbr = String(state || '')
    .trim()
    .toUpperCase();
  const cityNorm = normalizePlaceName(commonPlaceName(city, abbr));
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

/** Resolve typed state (abbr or full name) to 2-letter abbr, or null. */
export function normalizeStateAbbr(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.length === 2) {
    const abbr = s.toUpperCase();
    return ABBR_TO_NAME[abbr] ? abbr : null;
  }
  const fromName = STATE_NAME_TO_ABBR[s.toLowerCase()];
  return fromName || null;
}

/** In-state empty browse lists that state's places A–Z. Typed menus stay short. */
const SUGGEST_BROWSE_CAP = 2000;
const SUGGEST_QUERY_CAP = 75;

function placeLabelCompare(a, b) {
  return (
    String(a.city || '').localeCompare(String(b.city || ''), undefined, { sensitivity: 'base' }) ||
    String(a.state || '').localeCompare(String(b.state || ''), undefined, { sensitivity: 'base' })
  );
}

/** 0 exact, 1 prefix, 2 weaker substring. Empty query is one tier. */
function placeMatchRank(city, needle) {
  if (!needle) return 0;
  const n = normalizePlaceName(city);
  if (n === needle) return 0;
  if (n.startsWith(needle) || n.includes(` ${needle}`)) return 1;
  return 2;
}

/** Static US states for State datalist (abbr + title-case name), A–Z by abbreviation. */
export function listUsStates() {
  return Object.entries(ABBR_TO_NAME)
    .map(([abbr, name]) => ({
      abbr,
      name: name.replace(/\b\w/g, (c) => c.toUpperCase()),
    }))
    .sort((a, b) => a.abbr.localeCompare(b.abbr) || a.name.localeCompare(b.name));
}

/**
 * Census place autocomplete. Optional state filter (abbr or name).
 * Typed queries prefer exact → prefix → substring, then A–Z by city.
 * Empty in-state browse is that state's places A–Z (cap 2000).
 * Empty nationwide browse stays the largest cities.
 * @returns {{ ok: boolean, places: Array<{city:string,state:string,population:number}>, error?: string }}
 */
export function suggestPlaces({ q = '', state = '', limit = 20 } = {}) {
  const idx = loadCensusIndex();
  if (!idx.ok) {
    return { ok: false, places: [], error: idx.error || 'Census missing' };
  }
  const abbr = normalizeStateAbbr(state);
  const needle = normalizePlaceName(abbr ? commonPlaceName(q, abbr) : q);
  const inStateBrowse = Boolean(abbr) && !needle;
  const nationwideBrowse = !abbr && !needle;
  const cap = inStateBrowse ? SUGGEST_BROWSE_CAP : SUGGEST_QUERY_CAP;
  const max = Math.min(Math.max(Number(limit) || 20, 1), cap);

  /** @type {Array<{city:string,state:string,population:number}>} */
  let pool = [];
  if (abbr) {
    pool = idx.byState.get(abbr) || [];
  } else {
    for (const rows of idx.byState.values()) {
      for (const row of rows) pool.push(row);
    }
  }

  const scored = [];
  for (const row of pool) {
    const n = normalizePlaceName(row.city);
    if (!n) continue;
    if (needle) {
      const prefixOk = n.startsWith(needle) || n.includes(` ${needle}`);
      const substrOk = needle.length >= 3 && n.includes(needle);
      if (!prefixOk && !substrOk) continue;
    }
    scored.push(row);
  }
  // Highest population first so dedupe keeps the larger place and the short metro label.
  scored.sort((a, b) => {
    const rank = placeMatchRank(a.city, needle) - placeMatchRank(b.city, needle);
    if (rank) return rank;
    const popDiff = (Number(b.population) || 0) - (Number(a.population) || 0);
    if (popDiff) return popDiff;
    return placeLabelCompare(a, b);
  });

  const seen = new Set();
  const places = [];
  for (const row of scored) {
    const short = String(row.city || '').includes('/')
      ? String(row.city).split('/')[0].trim()
      : row.city;
    const key = `${normalizePlaceName(short)}|${row.state}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({ ...row, city: short });
  }
  places.sort((a, b) => {
    const rank = placeMatchRank(a.city, needle) - placeMatchRank(b.city, needle);
    if (rank) return rank;
    if (nationwideBrowse) {
      const popDiff = (Number(b.population) || 0) - (Number(a.population) || 0);
      if (popDiff) return popDiff;
    }
    return placeLabelCompare(a, b);
  });
  return { ok: true, places: places.slice(0, max) };
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

export { normalizePlaceName, ABBR_TO_NAME, STATE_NAME_TO_ABBR };
