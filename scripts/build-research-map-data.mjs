/**
 * Build research-map GeoJSON from Census cartographic boundaries + population CSVs.
 *
 *   npm run build-research-map
 *
 * Sources (env overrides optional):
 *   PLACE_SHP_ZIP   — default ~/Downloads/cb_2025_us_place_500k.zip
 *   COUNTY_SHP_DIR  — default ~/Downloads/cb_2025_us_county_500k
 *   ACS_YEAR / ACS_B01003_URL — ACS 5-year B01003 summary file (default 2023 FTP)
 *   FORCE_ACS_REFRESH — set to 1 to re-download acs5-place-pop.csv
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import shp from 'shpjs';
import {
  loadCensusIndex,
  normalizePlaceName,
  loadAcsPlacePopByGeoid,
  acsPlacePopCsvPath,
} from '../ops/lib/census.mjs';
import { writePlaceNeighborsIndex } from '../ops/lib/geo-neighbors.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOUNDARIES = path.join(ROOT, 'data', 'census', 'boundaries');
const OUT_DIR = path.join(ROOT, 'data', 'census', 'map');
const PLACE_POP = path.join(ROOT, 'data', 'census', 'SUB-IP-EST2025-POP.csv');
const COUNTY_POP = path.join(ROOT, 'data', 'census', 'co-est2025-alldata.csv');
const ACS_CSV = acsPlacePopCsvPath();
const ACS_YEAR = process.env.ACS_YEAR || '2023';
const ACS_B01003_URL =
  process.env.ACS_B01003_URL ||
  `https://www2.census.gov/programs-surveys/acs/summary_file/${ACS_YEAR}/table-based-SF/data/5YRData/acsdt5y${ACS_YEAR}-b01003.dat`;

const FIPS_TO_ABBR = {
  '01': 'AL',
  '02': 'AK',
  '04': 'AZ',
  '05': 'AR',
  '06': 'CA',
  '08': 'CO',
  '09': 'CT',
  '10': 'DE',
  '11': 'DC',
  '12': 'FL',
  '13': 'GA',
  '15': 'HI',
  '16': 'ID',
  '17': 'IL',
  '18': 'IN',
  '19': 'IA',
  '20': 'KS',
  '21': 'KY',
  '22': 'LA',
  '23': 'ME',
  '24': 'MD',
  '25': 'MA',
  '26': 'MI',
  '27': 'MN',
  '28': 'MS',
  '29': 'MO',
  '30': 'MT',
  '31': 'NE',
  '32': 'NV',
  '33': 'NH',
  '34': 'NJ',
  '35': 'NM',
  '36': 'NY',
  '37': 'NC',
  '38': 'ND',
  '39': 'OH',
  '40': 'OK',
  '41': 'OR',
  '42': 'PA',
  '44': 'RI',
  '45': 'SC',
  '46': 'SD',
  '47': 'TN',
  '48': 'TX',
  '49': 'UT',
  '50': 'VT',
  '51': 'VA',
  '53': 'WA',
  '54': 'WV',
  '55': 'WI',
  '56': 'WY',
  '72': 'PR',
};

function downloadsDir() {
  return path.join(os.homedir(), 'Downloads');
}

function roundCoord(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

function simplifyGeometry(geometry) {
  if (!geometry) return geometry;
  const walk = (coords) => {
    if (!Array.isArray(coords)) return coords;
    if (typeof coords[0] === 'number') {
      return [roundCoord(coords[0]), roundCoord(coords[1])];
    }
    return coords.map(walk);
  };
  return { ...geometry, coordinates: walk(geometry.coordinates) };
}

function displayPlaceName(raw) {
  return String(raw || '')
    .replace(/\s+CDP$/i, '')
    .replace(/\s+urban county$/i, '')
    .replace(/\s+municipality$/i, '')
    // LSAD legal types are lowercase in NAMELSAD ("Park City city"); do not strip proper-name "City"
    .replace(/\s+(city|town|village|borough)$/, '')
    .trim();
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build ACS place pop CSV from Census summary-file B01003 (no API key).
 * Joins place GEOIDs to names/state from the cartographic place shapefile.
 * Writes geoid,population,name,state (committed for offline rebuilds / suggest gap-fill).
 */
async function ensureAcsPlacePopCsv(placeZipPath) {
  const force = process.env.FORCE_ACS_REFRESH === '1';
  if (existsSync(ACS_CSV) && !force) {
    console.log(`Using cached ACS place pop → ${ACS_CSV}`);
    return loadAcsPlacePopByGeoid(ACS_CSV);
  }

  console.log(`Downloading ACS ${ACS_YEAR} B01003 summary file…`);
  const res = await fetch(ACS_B01003_URL, {
    headers: { 'User-Agent': 'RoverMapBuild/1.0', Accept: 'text/plain,*/*' },
  });
  if (!res.ok) {
    throw new Error(`ACS B01003 download failed: HTTP ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  /** @type {Map<string, number>} */
  const popByGeoid = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('1600000US')) continue;
    const [geo, popRaw] = line.split('|');
    const geoid = String(geo || '').slice('1600000US'.length);
    const pop = Number(String(popRaw || '').replace(/,/g, ''));
    if (!geoid || !Number.isFinite(pop) || pop < 0) continue;
    popByGeoid.set(geoid, pop);
  }
  console.log(`ACS place populations: ${popByGeoid.size}`);

  console.log('Joining ACS pops to place shapefile names…');
  const geo = await parseShapefileZip(placeZipPath);
  const collection = Array.isArray(geo) ? geo[0] : geo;
  const featuresIn = collection?.features || [];

  const out = ['geoid,population,name,state'];
  let kept = 0;
  for (const f of featuresIn) {
    const props = f.properties || {};
    const state = placeStateAbbr(props);
    if (!state || state === 'PR') continue;
    const geoid = String(props.GEOID || props.geoid || '');
    const pop = popByGeoid.get(geoid);
    if (pop == null) continue;
    const display = displayPlaceName(props.NAME || props.NAMELSAD || '');
    if (!display) continue;
    out.push([geoid, String(pop), csvEscape(display), state].join(','));
    kept += 1;
  }

  mkdirSync(path.dirname(ACS_CSV), { recursive: true });
  writeFileSync(ACS_CSV, `${out.join('\n')}\n`);
  console.log(`Wrote ${kept} ACS place rows → ${ACS_CSV}`);
  return loadAcsPlacePopByGeoid(ACS_CSV);
}

function loadCountyPopByGeoid() {
  const text = readFileSync(COUNTY_POP, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  const iSumlev = header.indexOf('SUMLEV');
  const iState = header.indexOf('STATE');
  const iCounty = header.indexOf('COUNTY');
  const iName = header.indexOf('CTYNAME');
  const iSt = header.indexOf('STNAME');
  const iPop = header.indexOf('POPESTIMATE2025');
  const map = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',');
    if (cols[iSumlev] !== '050') continue;
    const state = String(cols[iState] || '').padStart(2, '0');
    const county = String(cols[iCounty] || '').padStart(3, '0');
    const geoid = `${state}${county}`;
    const pop = Number(cols[iPop]);
    if (!Number.isFinite(pop)) continue;
    map.set(geoid, {
      population: pop,
      name: String(cols[iName] || '').trim(),
      stateName: String(cols[iSt] || '').trim(),
    });
  }
  return map;
}

async function parseShapefileZip(zipPath) {
  const buf = readFileSync(zipPath);
  return shp(buf);
}

async function parseShapefileDir(dir) {
  const files = readdirSync(dir);
  const base = files.find((f) => f.endsWith('.shp'))?.replace(/\.shp$/i, '');
  if (!base) throw new Error(`No .shp in ${dir}`);
  const input = {
    shp: readFileSync(path.join(dir, `${base}.shp`)),
    dbf: readFileSync(path.join(dir, `${base}.dbf`)),
  };
  const prjPath = path.join(dir, `${base}.prj`);
  const cpgPath = path.join(dir, `${base}.cpg`);
  if (existsSync(prjPath)) input.prj = readFileSync(prjPath, 'utf8');
  if (existsSync(cpgPath)) input.cpg = readFileSync(cpgPath, 'utf8');
  return shp(input);
}

function ensureBoundariesCopied() {
  mkdirSync(BOUNDARIES, { recursive: true });
  const placeZip =
    process.env.PLACE_SHP_ZIP || path.join(downloadsDir(), 'cb_2025_us_place_500k.zip');
  const countyDir =
    process.env.COUNTY_SHP_DIR || path.join(downloadsDir(), 'cb_2025_us_county_500k');
  const placeDest = path.join(BOUNDARIES, 'cb_2025_us_place_500k.zip');
  const countyDest = path.join(BOUNDARIES, 'cb_2025_us_county_500k');

  if (!existsSync(placeZip) && !existsSync(placeDest)) {
    throw new Error(`Place shapefile zip not found: ${placeZip}`);
  }
  if (!existsSync(countyDir) && !existsSync(countyDest)) {
    throw new Error(`County shapefile dir not found: ${countyDir}`);
  }
  if (existsSync(placeZip)) {
    cpSync(placeZip, placeDest);
    console.log(`Copied place zip → ${placeDest}`);
  }
  if (existsSync(countyDir)) {
    mkdirSync(countyDest, { recursive: true });
    for (const name of readdirSync(countyDir)) {
      cpSync(path.join(countyDir, name), path.join(countyDest, name));
    }
    console.log(`Copied county shapefile → ${countyDest}`);
  }
  return { placeDest, countyDest };
}

function placeStateAbbr(props) {
  const stusps = String(props.STUSPS || props.stusps || '').trim().toUpperCase();
  if (stusps.length === 2) return stusps;
  const statefp = String(props.STATEFP || props.statefp || '').padStart(2, '0');
  return FIPS_TO_ABBR[statefp] || null;
}

async function buildPlaces(placeZipPath, acsByGeoid) {
  console.log('Parsing places shapefile…');
  const geo = await parseShapefileZip(placeZipPath);
  const collection = Array.isArray(geo) ? geo[0] : geo;
  const featuresIn = collection?.features || [];
  const idx = loadCensusIndex();
  if (!idx.ok) throw new Error(idx.error || 'Place population CSV missing');

  let matched = 0;
  let unmatched = 0;
  const features = [];
  for (const f of featuresIn) {
    const props = f.properties || {};
    const rawName = props.NAME || props.NAMELSAD || '';
    const state = placeStateAbbr(props);
    if (!state || state === 'PR') continue;
    const geoid = String(props.GEOID || props.geoid || '');
    const cityNorm = normalizePlaceName(rawName);
    let population = idx.byKey.get(`${cityNorm}|${state}`);
    if (population == null) {
      const alt = normalizePlaceName(props.NAMELSAD || '');
      population = idx.byKey.get(`${alt}|${state}`);
    }
    if (population == null && geoid) {
      const acs = acsByGeoid.get(geoid);
      if (acs?.population != null) population = acs.population;
    }
    if (population == null) {
      unmatched += 1;
      continue;
    }
    matched += 1;
    features.push({
      type: 'Feature',
      properties: {
        name: displayPlaceName(rawName),
        state,
        population,
        geoid,
      },
      geometry: simplifyGeometry(f.geometry),
    });
  }
  console.log(`Places: ${matched} matched, ${unmatched} unmatched (dropped)`);
  return { type: 'FeatureCollection', features };
}

async function buildCounties(countyDir) {
  console.log('Parsing counties shapefile…');
  const geo = await parseShapefileDir(countyDir);
  const collection = Array.isArray(geo) ? geo[0] : geo;
  const featuresIn = collection?.features || [];
  const popByGeoid = loadCountyPopByGeoid();

  let matched = 0;
  let unmatched = 0;
  const features = [];
  for (const f of featuresIn) {
    const props = f.properties || {};
    const geoid = String(props.GEOID || props.geoid || '').padStart(5, '0');
    const statefp = geoid.slice(0, 2);
    const state = FIPS_TO_ABBR[statefp];
    if (!state || state === 'PR') continue;
    const hit = popByGeoid.get(geoid);
    if (!hit) {
      unmatched += 1;
      continue;
    }
    matched += 1;
    const name = String(props.NAME || hit.name || '')
      .replace(/\s+County$/i, '')
      .trim();
    features.push({
      type: 'Feature',
      properties: {
        name: name || hit.name,
        state,
        population: hit.population,
        geoid,
      },
      geometry: simplifyGeometry(f.geometry),
    });
  }
  console.log(`Counties: ${matched} matched, ${unmatched} unmatched (dropped)`);
  return { type: 'FeatureCollection', features };
}

async function main() {
  if (!existsSync(PLACE_POP)) throw new Error(`Missing ${PLACE_POP}`);
  if (!existsSync(COUNTY_POP)) throw new Error(`Missing ${COUNTY_POP}`);

  const { placeDest, countyDest } = ensureBoundariesCopied();
  const acsByGeoid = await ensureAcsPlacePopCsv(placeDest);
  mkdirSync(OUT_DIR, { recursive: true });

  const places = await buildPlaces(placeDest, acsByGeoid);
  const placesPath = path.join(OUT_DIR, 'places.geojson');
  writeFileSync(placesPath, JSON.stringify(places));
  console.log(`Wrote ${places.features.length} places → ${placesPath}`);

  console.log('Building place-neighbors index (touching polygons)…');
  const nb = writePlaceNeighborsIndex(places);
  console.log(`Wrote ${nb.keys} place keys → ${nb.path}`);

  const counties = await buildCounties(countyDest);
  const countiesPath = path.join(OUT_DIR, 'counties.geojson');
  writeFileSync(countiesPath, JSON.stringify(counties));
  console.log(`Wrote ${counties.features.length} counties → ${countiesPath}`);

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
