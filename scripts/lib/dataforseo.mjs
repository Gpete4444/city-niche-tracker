import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

/** SERP endpoints accept plain location names; Google Ads endpoints do not. */
export function adsLocationName(city, stateCode) {
  const state = US_STATE_NAMES[stateCode.toUpperCase()];
  if (!state) throw new Error(`Unknown state code: ${stateCode}`);
  return `${city},${state},United States`;
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
  const transient = new Set([40101, 40103, 50000, 50401, 50402]);

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const response = await fetch(`${API_BASE}${pathname}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: payload,
    });

    const json = await response.json();
    const task = json.tasks?.[0];
    const taskCode = task?.status_code;
    // 40200 = Payment Required / product not funded — do not retry
    if (json.status_code === 40200 || taskCode === 40200 || response.status === 402) {
      throw new Error(
        `${label} payment required (402): enable/fund this DataForSEO API product in your account. ${json.status_message || task?.status_message || ''}`,
      );
    }

    if (!response.ok) {
      lastError = new Error(
        `DataForSEO HTTP ${response.status}: ${JSON.stringify(json).slice(0, 500)}`,
      );
    } else if (json.status_code !== 20000) {
      lastError = new Error(`DataForSEO error ${json.status_code}: ${json.status_message}`);
    } else {
      if (task && taskCode !== 20000 && transient.has(taskCode) && attempt < retries) {
        const waitMs = 1500 * attempt;
        console.error(
          `${label}: transient ${taskCode} (${task.status_message}). Retry ${attempt}/${retries} in ${waitMs}ms…`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      return json;
    }

    const codeMatch = String(lastError.message).match(/\b(40101|40103|50000|50401|50402)\b/);
    if (codeMatch && attempt < retries) {
      const waitMs = 1500 * attempt;
      console.error(`${label}: ${lastError.message}. Retry ${attempt}/${retries} in ${waitMs}ms…`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    throw lastError;
  }

  throw lastError;
}

export async function dataForSeoGet(pathname) {
  const { login, password } = requireCredentials();
  const auth = Buffer.from(`${login}:${password}`).toString('base64');
  const response = await fetch(`${API_BASE}${pathname}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const json = await response.json();
  if (!response.ok || json.status_code !== 20000) {
    throw new Error(
      `DataForSEO GET ${pathname} failed: ${json.status_code ?? response.status} ${json.status_message ?? ''}`,
    );
  }
  return json;
}

/** Account balance from GET /v3/appendix/user_data (rate limit ~6/min). */
export async function fetchUserBalance() {
  const json = await dataForSeoGet('/appendix/user_data');
  const money = json.tasks?.[0]?.result?.[0]?.money ?? null;
  return {
    balance: money?.balance != null ? Number(money.balance) : null,
    total: money?.total != null ? Number(money.total) : null,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Google Ads only accepts its own geo-target list, so city names must be resolved
 * against it rather than assembled from "City,State,United States" strings.
 */
export async function loadAdsLocations(root = process.cwd()) {
  const cachePath = path.join(root, '.cache', 'google-ads-locations-us.json');
  if (existsSync(cachePath)) {
    try {
      return JSON.parse(readFileSync(cachePath, 'utf8'));
    } catch {
      // fall through and refetch
    }
  }

  let json;
  try {
    json = await dataForSeoGet('/keywords_data/google_ads/locations/us');
  } catch {
    json = await dataForSeoGet('/keywords_data/google_ads/locations');
  }

  const rows = (json.tasks?.[0]?.result ?? [])
    .filter((row) => row?.location_name && row?.location_code)
    .map((row) => ({
      locationName: row.location_name,
      locationCode: row.location_code,
      locationType: row.location_type ?? null,
      countryIsoCode: row.country_iso_code ?? null,
    }));

  mkdirSync(path.dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(rows), 'utf8');
  return rows;
}

export function resolveAdsLocation(locations, city, stateCode) {
  const state = US_STATE_NAMES[stateCode.toUpperCase()];
  if (!state) return null;

  const wanted = `${city},${state},United States`.toLowerCase();
  const exact = locations.find((row) => row.locationName.toLowerCase() === wanted);
  if (exact) return exact;

  const normalizedCity = city.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  const suffix = `,${state},United States`.toLowerCase();
  return (
    locations.find((row) => {
      const name = row.locationName.toLowerCase();
      if (!name.endsWith(suffix)) return false;
      const namedCity = name.slice(0, name.length - suffix.length);
      return namedCity.replace(/\./g, '').replace(/\s+/g, ' ').trim() === normalizedCity;
    }) ?? null
  );
}

export function taskResult(json, label = 'task') {
  const task = json.tasks?.[0];
  if (!task) throw new Error(`No tasks in DataForSEO response (${label})`);
  if (task.status_code !== 20000) {
    throw new Error(`${label} failed ${task.status_code}: ${task.status_message}`);
  }
  return { task, result: task.result ?? [], cost: task.cost ?? 0 };
}
