import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { featureCentroid, findPlaceFeatureLocal } from '../../ops/lib/geo-neighbors.mjs';
import { commonPlaceName, foldPlaceLabel } from '../../ops/lib/place-common-names.mjs';
import { requestJson } from './http-json.mjs';

export const DATAFORSEO_API_ACCESS_URL = 'https://app.dataforseo.com/api-access';
export const DATAFORSEO_PAYMENT_ERROR = 'DataForSEO payment required';
const API_BASE = 'https://api.dataforseo.com/v3';

export const US_STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

export const DIRECTORY_HOST_HINTS = [
  'yelp.com',
  'angi.com',
  'homeadvisor.com',
  'thumbtack.com',
  'bbb.org',
  'facebook.com',
  'expertise.com',
  'yellowpages.com',
  'superpages.com',
  'mapquest.com',
  'nextdoor.com',
];

/** Load `.env` from project root without adding a dependency. */
export function loadEnvFile(root = process.cwd()) {
  const envPath = path.join(root, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function requireCredentials() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error(
      'Missing DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD. Copy .env.example to .env and add your DataForSEO API credentials.',
    );
  }
  return { login, password };
}

/** Assembled "City,State,United States" string. Valid only if it exists on the Ads/SERP list. */
export function adsLocationName(city, stateCode) {
  const state = US_STATE_NAMES[stateCode.toUpperCase()];
  if (!state) throw new Error(`Unknown state code: ${stateCode}`);
  return `${city},${state},United States`;
}

export function stateLocationName(stateCode) {
  const state = US_STATE_NAMES[String(stateCode || '').toUpperCase()];
  return state ? `${state},United States` : null;
}

/** DataForSEO location_coordinate radius (mm). Min 199, max 199999. */
export const SERP_COORDINATE_RADIUS_MM = 200;

export const RATE_LIMIT_DFS_CODE = 40202;
export const TRANSIENT_DFS_CODES = [40101, 40103, 50000, 50401, 50402];

const RETRYABLE_DFS_CODES = new Set([...TRANSIENT_DFS_CODES, RATE_LIMIT_DFS_CODE]);

export function isRetryableDataForSeoCode(code) {
  return RETRYABLE_DFS_CODES.has(Number(code));
}

/** 40202 waits ~65–80s; other transients stay 1.5s * attempt. */
export function dataForSeoRetryWaitMs(code, attempt, random = Math.random) {
  if (Number(code) === RATE_LIMIT_DFS_CODE) {
    return 65_000 + Math.round(Number(random()) * 15_000);
  }
  return 1500 * Math.max(1, Number(attempt) || 1);
}

let requestJsonImpl = requestJson;
let sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function setDataForSeoTransportForTests({ requestJson: req, sleep } = {}) {
  if (req) requestJsonImpl = req;
  if (sleep) sleepImpl = sleep;
}

export function resetDataForSeoTransportForTests() {
  requestJsonImpl = requestJson;
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
}

export function registrableDomain(urlOrHost) {
  try {
    const host = urlOrHost.includes('://')
      ? new URL(urlOrHost).hostname
      : String(urlOrHost).split('/')[0];
    return host.replace(/^www\./i, '').toLowerCase();
  } catch {
    return String(urlOrHost).toLowerCase();
  }
}

export function isDirectoryDomain(domain) {
  return DIRECTORY_HOST_HINTS.some(
    (hint) => domain === hint || domain.endsWith(`.${hint}`),
  );
}

export function isHomepageUrl(url) {
  try {
    const { pathname } = new URL(url);
    return pathname === '/' || pathname === '';
  } catch {
    return false;
  }
}

export async function dataForSeoRequest(pathname, body, { retries = 3, label = pathname } = {}) {
  const { login, password } = requireCredentials();
  const auth = Buffer.from(`${login}:${password}`).toString('base64');
  const payload = JSON.stringify(Array.isArray(body) ? body : [body]);

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const response = await requestJsonImpl(`${API_BASE}${pathname}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: payload,
    });

    const json = response.json;
    const task = json.tasks?.[0];
    const taskCode = task?.status_code;
    // 40200 = Payment Required / product not funded — do not retry
    if (json.status_code === 40200 || taskCode === 40200 || response.status === 402) {
      const detail = json.status_message || task?.status_message || '';
      console.error(
        `${label}: DataForSEO payment required (402/40200). ${detail}`.trim(),
      );
      const err = new Error(DATAFORSEO_PAYMENT_ERROR);
      err.code = 'DATAFORSEO_PAYMENT_REQUIRED';
      throw err;
    }

    if (!response.ok) {
      lastError = new Error(
        `DataForSEO HTTP ${response.status}: ${JSON.stringify(json).slice(0, 500)}`,
      );
    } else if (json.status_code !== 20000) {
      lastError = new Error(`DataForSEO error ${json.status_code}: ${json.status_message}`);
    } else {
      if (
        task &&
        taskCode !== 20000 &&
        isRetryableDataForSeoCode(taskCode) &&
        attempt < retries
      ) {
        const waitMs = dataForSeoRetryWaitMs(taskCode, attempt);
        console.error(
          `${label}: transient ${taskCode} (${task.status_message}). Retry ${attempt}/${retries} in ${waitMs}ms…`,
        );
        await sleepImpl(waitMs);
        continue;
      }
      return json;
    }

    const codeMatch = String(lastError.message).match(/\b(40101|40103|40202|50000|50401|50402)\b/);
    if (codeMatch && attempt < retries) {
      const waitMs = dataForSeoRetryWaitMs(Number(codeMatch[1]), attempt);
      console.error(`${label}: ${lastError.message}. Retry ${attempt}/${retries} in ${waitMs}ms…`);
      await sleepImpl(waitMs);
      continue;
    }
    throw lastError;
  }

  throw lastError;
}

export async function dataForSeoGet(pathname) {
  const { login, password } = requireCredentials();
  const auth = Buffer.from(`${login}:${password}`).toString('base64');
  const response = await requestJsonImpl(`${API_BASE}${pathname}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const json = response.json;
  if (!response.ok || json.status_code !== 20000) {
    throw new Error(
      `DataForSEO GET ${pathname} failed: ${json.status_code ?? response.status} ${json.status_message ?? ''}`,
    );
  }
  return json;
}

function finiteMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Account balance from GET /v3/appendix/user_data (rate limit ~6/min). */
export async function fetchUserBalance() {
  const json = await dataForSeoGet('/appendix/user_data');
  const money = json.tasks?.[0]?.result?.[0]?.money ?? null;
  const balance = finiteMoney(money?.balance);
  const total = finiteMoney(money?.total);
  const spentRaw = balance != null && total != null ? total - balance : null;
  return {
    balance,
    total,
    spentAllTime: spentRaw != null ? Math.max(0, Number(spentRaw.toFixed(6))) : null,
    fetchedAt: new Date().toISOString(),
  };
}

function mapLocationRows(json) {
  return (json.tasks?.[0]?.result ?? [])
    .filter((row) => row?.location_name && row?.location_code)
    .map((row) => ({
      locationName: row.location_name,
      locationCode: row.location_code,
      locationType: row.location_type ?? null,
      countryIsoCode: row.country_iso_code ?? null,
    }));
}

async function loadCachedLocationList(cacheFile, fetchJson, root = process.cwd()) {
  const cachePath = path.join(root, '.cache', cacheFile);
  if (existsSync(cachePath)) {
    try {
      return JSON.parse(readFileSync(cachePath, 'utf8'));
    } catch {
      // fall through and refetch
    }
  }
  const json = await fetchJson();
  const rows = mapLocationRows(json);
  mkdirSync(path.dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(rows), 'utf8');
  return rows;
}

/**
 * Google Ads only accepts its own geo-target list, so city names must be resolved
 * against it rather than assembled from "City,State,United States" strings.
 */
export async function loadAdsLocations(root = process.cwd()) {
  return loadCachedLocationList(
    'google-ads-locations-us.json',
    async () => {
      try {
        return await dataForSeoGet('/keywords_data/google_ads/locations/us');
      } catch {
        return dataForSeoGet('/keywords_data/google_ads/locations');
      }
    },
    root,
  );
}

/** SERP Google locations (distinct from Ads geo targets). */
export async function loadSerpLocations(root = process.cwd()) {
  return loadCachedLocationList(
    'google-serp-locations-us.json',
    async () => {
      try {
        return await dataForSeoGet('/serp/google/locations/us');
      } catch {
        return dataForSeoGet('/serp/google/locations');
      }
    },
    root,
  );
}

function lookupNamedLocation(locations, city, stateCode) {
  const state = US_STATE_NAMES[String(stateCode || '').toUpperCase()];
  if (!state || !city) return null;
  const list = Array.isArray(locations) ? locations : [];

  const wanted = `${city},${state},United States`.toLowerCase();
  const exact = list.find((row) => String(row.locationName || '').toLowerCase() === wanted);
  if (exact) return exact;

  const normalizedCity = String(city)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const suffix = `,${state},United States`.toLowerCase();
  return (
    list.find((row) => {
      const name = String(row.locationName || '').toLowerCase();
      if (!name.endsWith(suffix)) return false;
      const namedCity = name.slice(0, name.length - suffix.length);
      return namedCity.replace(/\./g, '').replace(/\s+/g, ' ').trim() === normalizedCity;
    }) ?? null
  );
}

export function resolveNamedLocation(locations, city, stateCode) {
  const exact = lookupNamedLocation(locations, city, stateCode);
  if (exact) return exact;
  const common = commonPlaceName(city, stateCode);
  if (!common || foldPlaceLabel(common) === foldPlaceLabel(city)) return null;
  return lookupNamedLocation(locations, common, stateCode);
}

export function resolveAdsLocation(locations, city, stateCode) {
  return resolveNamedLocation(locations, city, stateCode);
}

export function resolveAdsStateLocation(locations, stateCode) {
  const wanted = stateLocationName(stateCode);
  if (!wanted) return null;
  const needle = wanted.toLowerCase();
  return (
    (Array.isArray(locations) ? locations : []).find(
      (row) => String(row.locationName || '').toLowerCase() === needle,
    ) ?? null
  );
}

/**
 * Primary Ads geo: exact city, then largest neighbor on the Ads list.
 * Never uses state-level Ads (statewide volume is not the town).
 * @returns {{ location: object, fallback: null|'neighbor', fallbackFrom: string|null, requested: string } | null}
 */
export function resolveAdsLocationWithFallback(locations, city, stateCode, { neighbors = [] } = {}) {
  const requested = `${city}, ${String(stateCode || '').toUpperCase()}`;
  const exact = resolveAdsLocation(locations, city, stateCode);
  if (exact) {
    return { location: exact, fallback: null, fallbackFrom: null, requested };
  }

  const sorted = [...(neighbors || [])].sort(
    (a, b) => (Number(b.population) || 0) - (Number(a.population) || 0),
  );
  for (const n of sorted) {
    const name = n.name || n.city;
    const st = n.state || stateCode;
    const hit = resolveAdsLocation(locations, name, st);
    if (hit) {
      return {
        location: hit,
        fallback: 'neighbor',
        fallbackFrom: `${name}, ${String(st).toUpperCase()}`,
        requested,
      };
    }
  }

  return null;
}

export function formatSerpCoordinate(lat, lng, radiusMm = SERP_COORDINATE_RADIUS_MM) {
  return `${lat},${lng},${radiusMm}`;
}

export function defaultLookupCentroid(city, stateCode) {
  try {
    const feat = findPlaceFeatureLocal(city, stateCode);
    if (!feat) return null;
    const pair = featureCentroid(feat);
    if (!pair) return null;
    const [lng, lat] = pair;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
  } catch {
    return null;
  }
}

/**
 * SERP task geo: listed name/code, else census centroid pin, else state.
 * @returns {{
 *   kind: 'named'|'coordinate'|'state',
 *   fallback: null|'coordinate'|'state',
 *   label: string,
 *   location_name?: string,
 *   location_code?: number,
 *   location_coordinate?: string,
 * } | null}
 */
export function resolveSerpTaskLocation(city, stateCode, {
  locations = [],
  lookupCentroid = defaultLookupCentroid,
} = {}) {
  const named = resolveNamedLocation(locations, city, stateCode);
  if (named) {
    return {
      kind: 'named',
      fallback: null,
      label: named.locationName,
      location_name: named.locationName,
      location_code: named.locationCode,
    };
  }

  const coord = lookupCentroid?.(city, stateCode) || null;
  if (coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lng)) {
    const location_coordinate = formatSerpCoordinate(coord.lat, coord.lng);
    return {
      kind: 'coordinate',
      fallback: 'coordinate',
      label: location_coordinate,
      location_coordinate,
    };
  }

  const stateName = stateLocationName(stateCode);
  if (stateName) {
    return {
      kind: 'state',
      fallback: 'state',
      label: stateName,
      location_name: stateName,
    };
  }
  return null;
}

/** One of location_name / location_code / location_coordinate for a SERP POST body. */
export function serpLocationPayload(spec) {
  if (spec == null) return {};
  if (typeof spec === 'string') {
    const trimmed = spec.trim();
    return trimmed ? { location_name: trimmed } : {};
  }
  if (spec.location_coordinate) return { location_coordinate: spec.location_coordinate };
  if (spec.location_name) return { location_name: spec.location_name };
  if (spec.location_code != null) return { location_code: spec.location_code };
  return {};
}

export function taskResult(json, label = 'task') {
  const task = json.tasks?.[0];
  if (!task) throw new Error(`No tasks in DataForSEO response (${label})`);
  if (task.status_code !== 20000) {
    throw new Error(`${label} failed ${task.status_code}: ${task.status_message}`);
  }
  return { task, result: task.result ?? [], cost: task.cost ?? 0 };
}
