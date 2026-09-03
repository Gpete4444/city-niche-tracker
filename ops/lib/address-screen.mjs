/**
 * Business address finder: home paste / skip / commercial LoopNet+Crexi+Places screen.
 * Persists research/{id}-business-address.json for Site-Config step 2.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  getApprovedPackage,
  getCandidateDetail,
  pathsFor,
  saveMeta,
  RESEARCH_DIR,
} from './candidates.mjs';
import { normalizeStateAbbr } from './census.mjs';
import { placesIntersectingRadius } from './geo-neighbors.mjs';
import { recordRoverApiSpend } from './rover-api-spend.mjs';

const ROOT = process.cwd();
/** Default metro radius for address locality (same as site-config service area). */
const METRO_RADIUS_MILES = 40;
/** Memoized metro city name sets: `${normalizedCity}|ST|miles` → Set<normalizedName>. */
const metroCitySetCache = new Map();
const CITY_CACHE_DIR = path.join(RESEARCH_DIR, 'address-city-cache');
/** Solidcode LoopNet uses office + retail URLs — total listing budget ≈ maxItems × this. */
const DEFAULT_LOOPNET_URL_COUNT = 2;
/** Crexi Solidcode: one structured lease search (Office+Retail) → urlCount 1. */
const DEFAULT_CREXI_URL_COUNT = 1;
/**
 * Listings pulled + Places-checked per Find / Fetch deeper click (total across URLs).
 * LoopNet: maxItems = 20/URL × office+retail ≈ 40. Crexi: maxItems = 40 on one URL.
 */
const LISTINGS_PER_RUN = 40;
/** Default Apify maxItems per search URL — LoopNet (2 URLs). */
const DEFAULT_MAX_LISTINGS_LOOPNET = Math.ceil(LISTINGS_PER_RUN / DEFAULT_LOOPNET_URL_COUNT);
/** Default Apify maxItems — Crexi (1 URL). */
const DEFAULT_MAX_LISTINGS_CREXI = LISTINGS_PER_RUN;
/** @deprecated use source-aware defaults; kept for env fallback */
const DEFAULT_MAX_LISTINGS = DEFAULT_MAX_LISTINGS_LOOPNET;
/** Initial per-source pull ceiling (maxItems per URL). Doubles on confirm up to absolute. */
const LISTING_PULL_HARD_MAX = 500;
/** Hard stop — pullHardMax cannot double past this (per URL). */
const LISTING_PULL_ABSOLUTE_MAX = 2000;
/** Fetch deeper: +20 maxItems/URL on LoopNet (= +40 listings). */
const LISTING_PULL_DEPTH_STEP_LOOPNET = DEFAULT_MAX_LISTINGS_LOOPNET;
/** Fetch deeper: +40 maxItems on Crexi (= +40 listings). */
const LISTING_PULL_DEPTH_STEP_CREXI = DEFAULT_MAX_LISTINGS_CREXI;
/** Alias for LoopNet step (call sites / pullBudgetFields default). */
const LISTING_PULL_DEPTH_STEP = LISTING_PULL_DEPTH_STEP_LOOPNET;
const SOURCE_LOOPNET = 'loopnet';
const SOURCE_CREXI = 'crexi';
const ALL_SOURCES = [SOURCE_LOOPNET, SOURCE_CREXI];
const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const APIFY_BASE = 'https://api.apify.com/v2';
/** Places API (New) Text Search Pro list price ≈ $32 / 1k — estimate only, not a Google invoice. */
const PLACES_TEXT_SEARCH_USD = 0.032;
/** Starter-plan solidcode listing event (from Apify billing: $0.00145 / result). */
const SOLIDCODE_LISTING_USD = 0.00145;
/** Max accumulated clean recommendations kept across Find runs. */
const SHORTLIST_CAP = 25;
/** Reuse city listing cache without re-billing Apify (per source). */
const LISTING_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLEAN_PER_RUN = 10;
/** Max Places Text Search calls per Find/Screen run (= LISTINGS_PER_RUN; override with PLACES_BUDGET_PER_RUN). */
const DEFAULT_PLACES_BUDGET_PER_RUN = LISTINGS_PER_RUN;
/** Max Places checks spawned from one range listing (start + end only by default). */
const RANGE_EXPAND_MAX = 2;
/** When > 0 and end − start ≤ this, also try in-between numbers (same parity). Off by default to cut Places cost. */
const RANGE_FILL_MAX_SPAN = 0;
/** Operator pull-size clamp (total listings across URLs). */
const LISTINGS_PER_RUN_MIN = 10;
const LISTINGS_PER_RUN_MAX = 200;

function env(name) {
  return String(process.env[name] || '').trim();
}

/** Clamp Find clean-stop (1…SHORTLIST_CAP). */
export function clampCleanPerRun(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return CLEAN_PER_RUN;
  return Math.min(SHORTLIST_CAP, Math.max(1, Math.floor(n)));
}

/** Clamp operator pull size (10…200). */
export function clampListingsPerRun(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return LISTINGS_PER_RUN;
  return Math.min(LISTINGS_PER_RUN_MAX, Math.max(LISTINGS_PER_RUN_MIN, Math.floor(n)));
}

/** Places Text Search budget for one Find/Screen remaining run. */
export function placesBudgetPerRun() {
  const raw = Number(env('PLACES_BUDGET_PER_RUN'));
  if (Number.isFinite(raw) && raw >= 1) return Math.floor(raw);
  return DEFAULT_PLACES_BUDGET_PER_RUN;
}

/**
 * Lower score = screen sooner. Prefer same-state + city match so Places budget
 * is spent on streets most likely to become Recommended cleans.
 */
export function listingScreenPriority(listing, targetCity, targetState) {
  const listingState = String(listing?.state || '').trim();
  const sameState =
    !listingState || statesMatch(listingState, targetState) ? 0 : 2;
  const cityOk = citiesMatch(listing?.city, targetCity) ? 0 : 1;
  return sameState * 10 + cityOk;
}

export function sortListingsForScreening(listings, targetCity, targetState) {
  return [...(Array.isArray(listings) ? listings : [])].sort((a, b) => {
    const d =
      listingScreenPriority(a, targetCity, targetState) -
      listingScreenPriority(b, targetCity, targetState);
    if (d !== 0) return d;
    return String(a?.street || '').localeCompare(String(b?.street || ''));
  });
}

function nowIso() {
  return new Date().toISOString();
}

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function businessAddressPath(candidateId) {
  const p = pathsFor(candidateId);
  return path.join(RESEARCH_DIR, `${p.id}-business-address.json`);
}

export function getBusinessAddressPackage(candidateId) {
  const pkg = readJson(businessAddressPath(candidateId), null);
  if (!pkg || typeof pkg !== 'object') return pkg;
  // Drop wrong-state noise from older Find runs so Last search / samples stay useful.
  if (Array.isArray(pkg.rejectedSample)) {
    pkg.rejectedSample = rejectedSampleForUi(pkg.rejectedSample, 15);
  }
  if (pkg.lastSearchStats?.rejectTallies && typeof pkg.lastSearchStats.rejectTallies === 'object') {
    const tallies = { ...pkg.lastSearchStats.rejectTallies };
    let wrong = 0;
    let outside = 0;
    let active = 0;
    for (const [k, n] of Object.entries(tallies)) {
      if (/^wrong state/i.test(k) || /^Maps state /i.test(k)) {
        wrong += Number(n) || 0;
        delete tallies[k];
      } else if (/^outside metro/i.test(k)) {
        outside += Number(n) || 0;
        delete tallies[k];
      } else if (/^existing Maps business/i.test(k) || /^active Maps listing/i.test(k)) {
        active += Number(n) || 0;
        delete tallies[k];
      }
    }
    if (wrong > 0) {
      tallies['wrong state (not target)'] =
        (Number(tallies['wrong state (not target)']) || 0) + wrong;
    }
    if (outside > 0) {
      tallies['outside metro'] = (Number(tallies['outside metro']) || 0) + outside;
    }
    if (active > 0) {
      tallies['active Maps listing'] =
        (Number(tallies['active Maps listing']) || 0) + active;
    }
    pkg.lastSearchStats = { ...pkg.lastSearchStats, rejectTallies: tallies };
  }
  if (!Array.isArray(pkg.shortlist) || !pkg.shortlist.length) return pkg;
  return {
    ...pkg,
    shortlist: pkg.shortlist.map((row) => {
      const addr = {
        street: row.street,
        city: row.city,
        state: row.state,
        zip: row.zip,
      };
      const coords = { lat: row.lat, lng: row.lng };
      return {
        ...row,
        mapsUrl: mapsUrl(addr, coords),
        streetViewUrl: streetViewUrl(addr, coords),
      };
    }),
  };
}

/** LoopNet / solidcode slug: "Omaha" + "NE" → "omaha-ne". */
export function loopnetLocationSlug(city, state) {
  const c = String(city || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const s = String(state || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 2);
  if (!c || !s) return c || s || '';
  return `${c}-${s}`;
}

export function cityCacheSlug(city, state) {
  return loopnetLocationSlug(city, state) || 'unknown';
}

export function cityCachePath(city, state) {
  return path.join(CITY_CACHE_DIR, `${cityCacheSlug(city, state)}.json`);
}

function emptySourcePullState() {
  return {
    fetchedAt: null,
    fingerprint: '',
    query: null,
    lastPullMax: null,
    pullHardMax: LISTING_PULL_HARD_MAX,
  };
}

function emptyCityCache(city, state, fingerprint = '') {
  return {
    version: 2,
    city: city || '',
    state: state || '',
    fingerprint: fingerprint || '',
    fetchedAt: null,
    listings: [],
    query: null,
    screenedKeys: {},
    usedAddresses: {},
    lastPullMax: null,
    pullHardMax: LISTING_PULL_HARD_MAX,
    sources: {
      [SOURCE_LOOPNET]: emptySourcePullState(),
      [SOURCE_CREXI]: emptySourcePullState(),
    },
    updatedAt: nowIso(),
  };
}

/** Migrate v1 city cache (LoopNet-only flat fields) → v2 per-source shape. */
export function migrateCityCache(raw, city, state) {
  if (!raw || typeof raw !== 'object') return emptyCityCache(city, state);
  if (Number(raw.version) >= 2 && raw.sources?.[SOURCE_LOOPNET] && raw.sources?.[SOURCE_CREXI]) {
    return {
      ...emptyCityCache(city || raw.city, state || raw.state),
      ...raw,
      version: 2,
      city: city || raw.city || '',
      state: state || raw.state || '',
      listings: Array.isArray(raw.listings)
        ? raw.listings.map((row) => normalizeCachedListing(row))
        : [],
      sources: {
        [SOURCE_LOOPNET]: {
          ...emptySourcePullState(),
          ...(raw.sources[SOURCE_LOOPNET] || {}),
        },
        [SOURCE_CREXI]: {
          ...emptySourcePullState(),
          ...(raw.sources[SOURCE_CREXI] || {}),
        },
      },
    };
  }
  const listings = Array.isArray(raw.listings)
    ? raw.listings.map((row) => normalizeCachedListing({ ...row, source: row.source || SOURCE_LOOPNET }))
    : [];
  return {
    ...emptyCityCache(city || raw.city, state || raw.state),
    ...raw,
    version: 2,
    city: city || raw.city || '',
    state: state || raw.state || '',
    listings,
    sources: {
      [SOURCE_LOOPNET]: {
        ...emptySourcePullState(),
        fetchedAt: raw.fetchedAt || null,
        fingerprint: raw.fingerprint || '',
        query: raw.query || null,
        lastPullMax: raw.lastPullMax ?? null,
        pullHardMax: raw.pullHardMax ?? LISTING_PULL_HARD_MAX,
      },
      [SOURCE_CREXI]: emptySourcePullState(),
    },
  };
}

/**
 * Canonical Crexi property page: https://www.crexi.com/properties/{id}
 * Actor often returns /lease/properties/{slug}/{id} which does not resolve publicly.
 */
export function canonicalCrexiPropertyUrl(url, idHint = '') {
  const raw = String(url || '').trim();
  const hint = String(idHint || '').trim();
  const pickId = (s) => {
    const str = String(s || '');
    const trail = str.match(/\/(\d{4,})(?:\/?(?:\?|#|$))/);
    if (trail) return trail[1];
    const digits = str.match(/\b(\d{5,})\b/);
    return digits ? digits[1] : '';
  };
  const id = pickId(raw) || pickId(hint);
  if (id) return `https://www.crexi.com/properties/${id}`;
  if (/^https?:\/\//i.test(raw) && /crexi\.com/i.test(raw)) return raw;
  return '';
}

function normalizeCachedListing(row) {
  if (!row || typeof row !== 'object') return row;
  const source = row.source === SOURCE_CREXI ? SOURCE_CREXI : SOURCE_LOOPNET;
  const urls = {
    ...(row.urls && typeof row.urls === 'object' ? row.urls : {}),
  };
  if (row.url) {
    if (source === SOURCE_CREXI && !urls.crexi) urls.crexi = row.url;
    if (source === SOURCE_LOOPNET && !urls.loopnet) urls.loopnet = row.url;
  }
  if (urls.crexi) {
    const fixed = canonicalCrexiPropertyUrl(urls.crexi, row.id || row.propertyId || '');
    if (fixed) urls.crexi = fixed;
  }
  const sources = Array.isArray(row.sources)
    ? [...new Set(row.sources.filter((s) => s === SOURCE_LOOPNET || s === SOURCE_CREXI))]
    : [source];
  if (!sources.length) sources.push(source);
  let url = row.url || urls.loopnet || urls.crexi || '';
  if (source === SOURCE_CREXI || /crexi\.com/i.test(String(url))) {
    url = canonicalCrexiPropertyUrl(url, row.id || row.propertyId || '') || url;
  }
  return {
    ...row,
    source: sources[0] || source,
    sources,
    urls,
    url,
  };
}

export function getCityAddressCache(city, state) {
  const raw = readJson(cityCachePath(city, state), null);
  if (!raw) return null;
  return migrateCityCache(raw, city, state);
}

function saveCityAddressCache(city, state, data) {
  const migrated = migrateCityCache(
    {
      ...emptyCityCache(city, state),
      ...data,
    },
    city,
    state,
  );
  const next = {
    ...migrated,
    city,
    state,
    version: 2,
    screenedKeys: data?.screenedKeys || migrated.screenedKeys || {},
    usedAddresses: data?.usedAddresses || migrated.usedAddresses || {},
    listings: Array.isArray(data?.listings)
      ? data.listings.map((row) => normalizeCachedListing(row))
      : migrated.listings,
    updatedAt: nowIso(),
  };
  writeJson(cityCachePath(city, state), next);
  return next;
}

/** Which commercial Apify sources are ready (token + actor). */
export function getAddressSourceReadiness() {
  const token = Boolean(env('APIFY_TOKEN'));
  return {
    token,
    loopnet: token && Boolean(env('APIFY_LOOPNET_ACTOR_ID')),
    crexi: token && Boolean(env('APIFY_CREXI_ACTOR_ID')),
  };
}

export function sourcePullState(cityCache, source) {
  const key = source === SOURCE_CREXI ? SOURCE_CREXI : SOURCE_LOOPNET;
  const migrated = migrateCityCache(cityCache || {}, cityCache?.city, cityCache?.state);
  return {
    ...emptySourcePullState(),
    ...(migrated.sources?.[key] || {}),
  };
}

/** Dedupe key for a selection row (prefer streetBase without suite). */
function selectionDedupeKey(sel) {
  if (!sel) return '|';
  return shortlistDedupeKey({
    street: sel.streetBase || sel.street,
    zip: sel.zip,
  });
}

function releaseUsedClaimsForCandidate(usedAddresses, candidateId) {
  const id = pathsFor(candidateId).id;
  const used = { ...(usedAddresses || {}) };
  for (const [k, v] of Object.entries(used)) {
    if (v?.candidateId === id) delete used[k];
  }
  return used;
}

/**
 * Claim street|zip for this candidate on the city registry.
 * Releases any previous claim by the same candidate.
 */
function claimUsedAddress(cityCache, candidateId, sel) {
  const id = pathsFor(candidateId).id;
  const key = selectionDedupeKey(sel);
  if (!key || !key.split('|')[1]) {
    throw Object.assign(new Error('Cannot claim address without street and ZIP'), { status: 400 });
  }
  const used = releaseUsedClaimsForCandidate(cityCache.usedAddresses, id);
  const existing = used[key];
  if (existing?.candidateId && existing.candidateId !== id) {
    throw Object.assign(
      new Error(
        `Address already used by candidate “${existing.candidateId}”. Pick a different street.`,
      ),
      { status: 409, usedBy: existing },
    );
  }
  used[key] = {
    candidateId: id,
    street: sel.streetBase || sel.street,
    suite: sel.suite || '',
    city: sel.city,
    state: sel.state,
    zip: sel.zip,
    selectedAt: nowIso(),
  };
  return { ...cityCache, usedAddresses: used };
}

/**
 * Merge per-candidate packages into the city cache (once per Find/select).
 * Seeds listings, screenedKeys, and usedAddresses from same city/state.
 */
function ensureCityCacheSeeded(city, state, fingerprint = '') {
  let cityCache = getCityAddressCache(city, state) || emptyCityCache(city, state, fingerprint);
  const cityLower = String(city).toLowerCase();
  const stateUpper = String(state).toUpperCase();
  let files = [];
  try {
    files = readdirSync(RESEARCH_DIR).filter((f) => f.endsWith('-business-address.json'));
  } catch {
    return saveCityAddressCache(city, state, cityCache);
  }

  const screenedKeys = { ...(cityCache.screenedKeys || {}) };
  const usedAddresses = { ...(cityCache.usedAddresses || {}) };
  let listings = Array.isArray(cityCache.listings) ? [...cityCache.listings] : [];
  let fetchedAt = cityCache.fetchedAt || null;
  let fp = cityCache.fingerprint || fingerprint || '';
  let query = cityCache.query || null;

  for (const f of files) {
    const pkg = readJson(path.join(RESEARCH_DIR, f), null);
    if (!pkg) continue;
    if (String(pkg.city || '').toLowerCase() !== cityLower) continue;
    if (String(pkg.state || '').toUpperCase() !== stateUpper) continue;

    for (const [k, v] of Object.entries(pkg.screenedKeys || {})) {
      if (!screenedKeys[k]) screenedKeys[k] = v;
    }

    const lc = pkg.listingCache;
    if (Array.isArray(lc?.listings) && lc.listings.length) {
      const byKey = new Map();
      for (const row of [...listings, ...lc.listings]) {
        const k = shortlistDedupeKey(row);
        if (k && row.street && !byKey.has(k)) byKey.set(k, row);
      }
      listings = [...byKey.values()];
      const pkgAge = lc.fetchedAt ? Date.parse(lc.fetchedAt) : 0;
      const curAge = fetchedAt ? Date.parse(fetchedAt) : 0;
      if (!fetchedAt || pkgAge >= curAge) {
        fetchedAt = lc.fetchedAt || fetchedAt;
        fp = lc.fingerprint || fp || fingerprint;
        query = lc.query || query;
      }
    }

    if (pkg.selection && !pkg.skipped) {
      const key = selectionDedupeKey(pkg.selection);
      if (key && key.split('|')[1]) {
        const id = pkg.candidateId || f.replace(/-business-address\.json$/i, '');
        const existing = usedAddresses[key];
        if (!existing || existing.candidateId === id) {
          usedAddresses[key] = {
            candidateId: id,
            street: pkg.selection.streetBase || pkg.selection.street,
            suite: pkg.selection.suite || '',
            city: pkg.selection.city,
            state: pkg.selection.state,
            zip: pkg.selection.zip,
            selectedAt: pkg.selection.screenedAt || pkg.updatedAt || nowIso(),
          };
        }
      }
    }
  }

  return saveCityAddressCache(city, state, {
    ...cityCache,
    fingerprint: fp,
    fetchedAt,
    listings,
    query,
    screenedKeys,
    usedAddresses,
  });
}

/**
 * Apify maxItems for one source.
 * @param {string} [source]
 * @param {number|null} [listingsPerRun] total pull-size override (LoopNet ÷ URL count; Crexi = total)
 */
function maxListingsForSource(source = SOURCE_LOOPNET, listingsPerRun = null) {
  const total = Number(listingsPerRun);
  if (Number.isFinite(total) && total >= LISTINGS_PER_RUN_MIN) {
    const capped = Math.min(LISTING_PULL_ABSOLUTE_MAX, Math.floor(total));
    if (source === SOURCE_CREXI) return capped;
    return Math.min(
      LISTING_PULL_ABSOLUTE_MAX,
      Math.max(5, Math.ceil(capped / DEFAULT_LOOPNET_URL_COUNT)),
    );
  }
  const fallback =
    source === SOURCE_CREXI ? DEFAULT_MAX_LISTINGS_CREXI : DEFAULT_MAX_LISTINGS_LOOPNET;
  const n = Number(env('ADDRESS_SEARCH_MAX_LISTINGS') || fallback);
  if (!Number.isFinite(n) || n < 5) return fallback;
  return Math.min(LISTING_PULL_ABSOLUTE_MAX, Math.floor(n));
}

/** @deprecated prefer maxListingsForSource */
function maxListings() {
  return maxListingsForSource(SOURCE_LOOPNET);
}

function depthStepForSource(source = SOURCE_LOOPNET) {
  return source === SOURCE_CREXI ? LISTING_PULL_DEPTH_STEP_CREXI : LISTING_PULL_DEPTH_STEP_LOOPNET;
}

/** Per-source moving ceiling (defaults to initial 500, never above absolute 2000). */
export function cityPullHardMax(cityCacheOrSource) {
  const raw = Number(cityCacheOrSource?.pullHardMax);
  if (Number.isFinite(raw) && raw >= 5) {
    return Math.min(
      LISTING_PULL_ABSOLUTE_MAX,
      Math.max(LISTING_PULL_HARD_MAX, Math.floor(raw)),
    );
  }
  return LISTING_PULL_HARD_MAX;
}

/**
 * Resolve Apify maxItems for one source.
 * Exhausted Fetch deeper: lastPullMax + STEP when under pullHardMax.
 * When next would exceed ceiling, needsMaxRaise — confirm doubles pullHardMax then deepen.
 * @param {string} [source] loopnet | crexi — sets default maxItems and deepen step
 */
export function resolveLoopnetPullMax(
  cityCacheOrSource,
  {
    refreshLoopnet = false,
    deepen = false,
    raisePullMax = false,
    refresh = null,
    listingsPerRun = null,
  } = {},
  source = SOURCE_LOOPNET,
) {
  const src = source === SOURCE_CREXI ? SOURCE_CREXI : SOURCE_LOOPNET;
  const step = depthStepForSource(src);
  const doRefresh = refresh != null ? Boolean(refresh) : Boolean(refreshLoopnet);
  const envMax = maxListingsForSource(src, listingsPerRun);
  const rawLast = Number(cityCacheOrSource?.lastPullMax);
  const lastPullMax = Number.isFinite(rawLast) && rawLast >= 5 ? Math.floor(rawLast) : envMax;
  const priorHardMax = cityPullHardMax(cityCacheOrSource);
  const canRaiseMax = priorHardMax < LISTING_PULL_ABSOLUTE_MAX;
  const proposedHardMax = canRaiseMax
    ? Math.min(LISTING_PULL_ABSOLUTE_MAX, priorHardMax * 2)
    : priorHardMax;
  let hardMax = priorHardMax;
  let raisedMax = false;
  if (raisePullMax && canRaiseMax) {
    hardMax = proposedHardMax;
    raisedMax = hardMax > priorHardMax;
  }

  const base = {
    lastPullMax,
    step,
    hardMax,
    priorHardMax,
    raisedMax,
    canRaiseMax: hardMax < LISTING_PULL_ABSOLUTE_MAX,
    proposedHardMax: hardMax < LISTING_PULL_ABSOLUTE_MAX
      ? Math.min(LISTING_PULL_ABSOLUTE_MAX, hardMax * 2)
      : hardMax,
    absoluteMax: LISTING_PULL_ABSOLUTE_MAX,
    needsMaxRaise: false,
  };

  if (doRefresh && deepen) {
    const desiredNext = lastPullMax + step;
    if (desiredNext <= hardMax) {
      return {
        ...base,
        max: desiredNext,
        deepened: desiredNext > lastPullMax,
        atCap: desiredNext >= hardMax && hardMax >= LISTING_PULL_ABSOLUTE_MAX,
      };
    }
    if (!raisedMax && priorHardMax < LISTING_PULL_ABSOLUTE_MAX) {
      return {
        ...base,
        max: lastPullMax,
        deepened: false,
        atCap: true,
        needsMaxRaise: true,
        hardMax: priorHardMax,
        canRaiseMax: true,
        proposedHardMax,
      };
    }
    return {
      ...base,
      max: Math.min(hardMax, lastPullMax),
      deepened: false,
      atCap: true,
      needsMaxRaise: false,
      canRaiseMax: false,
      proposedHardMax: hardMax,
    };
  }
  if (doRefresh) {
    const max = Math.min(hardMax, Math.max(envMax, lastPullMax));
    return {
      ...base,
      max,
      deepened: false,
      atCap: max >= hardMax && hardMax >= LISTING_PULL_ABSOLUTE_MAX,
    };
  }
  const firstMax = Math.min(hardMax, envMax);
  return {
    ...base,
    max: firstMax,
    deepened: false,
    atCap: false,
  };
}

/** How many search URLs a query uses (LoopNet office+retail = 2; Crexi structured = 1). */
export function pullUrlCountFromQuery(query, cityCache = null, source = SOURCE_LOOPNET) {
  const fromQueryUrls = Array.isArray(query?.searchUrls) ? query.searchUrls.length : 0;
  const fromQueryStart = Array.isArray(query?.startUrls) ? query.startUrls.length : 0;
  if (fromQueryUrls > 0) return fromQueryUrls;
  if (fromQueryStart > 0) return fromQueryStart;
  const src = source === SOURCE_CREXI ? SOURCE_CREXI : SOURCE_LOOPNET;
  const srcQuery = cityCache?.sources?.[src]?.query || cityCache?.query;
  const fromCacheUrls = Array.isArray(srcQuery?.searchUrls) ? srcQuery.searchUrls.length : 0;
  const fromCacheStart = Array.isArray(srcQuery?.startUrls) ? srcQuery.startUrls.length : 0;
  if (fromCacheUrls > 0) return fromCacheUrls;
  if (fromCacheStart > 0) return fromCacheStart;
  return src === SOURCE_CREXI ? DEFAULT_CREXI_URL_COUNT : DEFAULT_LOOPNET_URL_COUNT;
}

/** Operator-facing totals: maxItems × URL count (not office/retail wording). */
export function pullBudgetFields({
  lastPullMax = null,
  nextPullMax = null,
  hardMax = LISTING_PULL_HARD_MAX,
  urlCount = DEFAULT_LOOPNET_URL_COUNT,
  step = LISTING_PULL_DEPTH_STEP,
  proposedHardMax = null,
  canRaiseMax = null,
  absoluteMax = LISTING_PULL_ABSOLUTE_MAX,
  needsMaxRaise = false,
} = {}) {
  const urls = Math.max(1, Number(urlCount) || DEFAULT_LOOPNET_URL_COUNT);
  const last = Number(lastPullMax);
  const next = Number(nextPullMax);
  const hard = Number(hardMax);
  const proposed = Number(proposedHardMax);
  const absolute = Number(absoluteMax);
  const lastOk = Number.isFinite(last) && last > 0;
  const nextOk = Number.isFinite(next) && next > 0;
  const hardOk = Number.isFinite(hard) && hard > 0;
  const proposedOk = Number.isFinite(proposed) && proposed > 0;
  const absoluteOk = Number.isFinite(absolute) && absolute > 0;
  return {
    pullUrlCount: urls,
    lastPullBudget: lastOk ? last * urls : null,
    nextPullBudget: nextOk ? next * urls : null,
    pullHardMaxBudget: hardOk ? hard * urls : null,
    proposedHardMaxBudget: proposedOk ? proposed * urls : null,
    absolutePullMaxBudget: absoluteOk ? absolute * urls : null,
    pullDepthStep: step,
    pullHardMax: hardOk ? hard : LISTING_PULL_HARD_MAX,
    proposedHardMax: proposedOk ? proposed : null,
    absolutePullMax: absoluteOk ? absolute : LISTING_PULL_ABSOLUTE_MAX,
    canRaiseMax: Boolean(canRaiseMax),
    needsMaxRaise: Boolean(needsMaxRaise),
  };
}

function cityStateFromCandidate(candidateId) {
  const detail = getCandidateDetail(candidateId);
  const pack = getApprovedPackage(candidateId) || detail?.approved;
  const sc = detail?.siteConfig || detail?.siteConfigDraft || {};
  const city = String(
    sc.primaryCity || pack?.primaryCity || pack?.city || '',
  ).trim();
  const state = String(sc.state || pack?.state || '')
    .trim()
    .toUpperCase();
  return { city, state, pack };
}

/** True when street contains a numeric range like 6778-6780 S 1300 E. */
export function hasAddressRange(street) {
  return /\b\d+\s*[-–—]\s*\d+\b/.test(String(street || ''));
}

/**
 * Expand a ranged street into discrete single-number streets for Places.
 * Always includes start + end. Intermediate fill only when RANGE_FILL_MAX_SPAN > 0.
 * Caps at RANGE_EXPAND_MAX (default 2 = start/end only — cuts Places cost).
 * @returns {string[]}
 */
export function expandAddressRangeStreets(street) {
  const s = String(street || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/\b(\d+)\s*[-–—]\s*(\d+)\b/);
  if (!m) return [];
  let a = Number.parseInt(m[1], 10);
  let b = Number.parseInt(m[2], 10);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return [];
  if (a > b) [a, b] = [b, a];
  const before = s.slice(0, m.index);
  const after = s.slice(m.index + m[0].length);

  const numbers = new Set([a, b]);
  const span = b - a;
  if (span > 0 && span <= RANGE_FILL_MAX_SPAN && a % 2 === b % 2) {
    for (let n = a + 1; n < b; n += 1) {
      if (n % 2 !== a % 2) continue;
      numbers.add(n);
    }
  }

  let sorted = [...numbers].sort((x, y) => x - y);
  if (sorted.length > RANGE_EXPAND_MAX) {
    const keep = new Set([a, b]);
    const mids = sorted.filter((n) => n !== a && n !== b);
    const slots = RANGE_EXPAND_MAX - 2;
    for (let i = 0; i < slots && mids.length; i += 1) {
      const idx = Math.floor(((i + 1) * mids.length) / (slots + 1));
      keep.add(mids[Math.min(Math.max(idx, 0), mids.length - 1)]);
    }
    sorted = [...keep].sort((x, y) => x - y).slice(0, RANGE_EXPAND_MAX);
  }

  return sorted.map((n) => `${before}${n}${after}`.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Drop legacy forever-rejects so range listings can be expanded once. */
export function requeueAddressRangeScreenKeys(screenedKeys) {
  const next = { ...(screenedKeys || {}) };
  let requeued = 0;
  for (const [k, v] of Object.entries(next)) {
    if (v?.fail === 'address range') {
      delete next[k];
      requeued += 1;
    }
  }
  return { screenedKeys: next, requeued };
}

const BAD_PROPERTY_RE =
  /\b(co-?working|cowork|medical|hospital|clinic|apartment|multifamily|residential|hotel|industrial|warehouse|land)\b/i;
const GOOD_PROPERTY_RE = /\b(office|retail|flex|mixed[\s-]?use|commercial)\b/i;

export function propertyTypePass(rawType) {
  const t = String(rawType || '').trim();
  if (!t) return { ok: true, reason: 'type unknown — allow with caution' };
  if (BAD_PROPERTY_RE.test(t)) return { ok: false, reason: `property type rejected: ${t}` };
  if (GOOD_PROPERTY_RE.test(t)) return { ok: true, reason: `property type ok: ${t}` };
  return { ok: true, reason: `property type allowed: ${t}` };
}

/**
 * Parse a single-line home address into street/city/state/zip.
 * Accepts "123 Main St, Omaha, NE 68102" or street + zip with city/state from candidate.
 */
export function parseHomeAddressLine(raw, { city = '', state = '' } = {}) {
  const line = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!line) {
    throw Object.assign(new Error('Address is required'), { status: 400 });
  }
  if (hasAddressRange(line)) {
    throw Object.assign(
      new Error('Use a single street number — not a range (e.g. 390-400).'),
      { status: 400 },
    );
  }

  const zipMatch = line.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch ? zipMatch[1] : '';
  let rest = zipMatch ? line.slice(0, zipMatch.index).trim().replace(/[,\s]+$/, '') : line;

  const stateMatch = rest.match(/,?\s*([A-Za-z]{2})\s*$/);
  let st = state;
  if (stateMatch) {
    st = stateMatch[1].toUpperCase();
    rest = rest.slice(0, stateMatch.index).trim().replace(/[,\s]+$/, '');
  }
  st = String(st || state || '')
    .trim()
    .toUpperCase();

  const parts = rest.split(',').map((p) => p.trim()).filter(Boolean);
  let street = '';
  let c = city;
  if (parts.length >= 2) {
    street = parts[0];
    c = parts[parts.length - 1] || city;
  } else {
    street = rest;
  }
  street = street.trim();
  c = String(c || city || '').trim();

  if (!street) {
    throw Object.assign(new Error('Could not parse street'), { status: 400 });
  }
  if (!zip) {
    throw Object.assign(new Error('ZIP code required (5 digits)'), { status: 400 });
  }
  if (!c || !st) {
    throw Object.assign(
      new Error('City and state required (include in the line or set from candidate)'),
      { status: 400 },
    );
  }

  return {
    street,
    city: c,
    state: st,
    zip,
    suite: '',
    source: 'home',
    screenedAt: nowIso(),
  };
}

function addressQueryWithoutSuite(addr = {}) {
  return [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(', ');
}

function mapsUrl(addr, { lat = null, lng = null } = {}) {
  const hasCoords =
    lat != null &&
    lng != null &&
    lat !== '' &&
    lng !== '' &&
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng));
  // Prefer coords pin. Never include suite — STE-* stubs make Google match unrelated businesses.
  if (hasCoords) {
    return `https://www.google.com/maps/?q=${Number(lat)},${Number(lng)}`;
  }
  const q = encodeURIComponent(addressQueryWithoutSuite(addr));
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function streetViewUrl(addr, { lat = null, lng = null } = {}) {
  const hasCoords =
    lat != null &&
    lng != null &&
    lat !== '' &&
    lng !== '' &&
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng));
  // Official pano URL — layer=c only shows coverage overlay, not Street View.
  if (hasCoords) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${Number(lat)},${Number(lng)}`;
  }
  const q = encodeURIComponent(addressQueryWithoutSuite(addr));
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function emptyPackage(candidateId, city, state) {
  return {
    version: 1,
    candidateId: pathsFor(candidateId).id,
    city: city || '',
    state: state || '',
    status: 'empty',
    updatedAt: nowIso(),
    selection: null,
    skipped: false,
    shortlist: [],
    lastSearchAt: null,
    lastSearchError: null,
    lastSearchErrorKind: null,
  };
}

/**
 * Classify Find failures so UI does not treat billing/config as "0 LoopNet listings".
 * @returns {'apify_billing'|'apify_config'|'apify_run'|'empty_listings'|'empty_screened'|null}
 */
export function classifyAddressSearchError(errorOrMessage, { httpStatus } = {}) {
  const msg = String(
    typeof errorOrMessage === 'string'
      ? errorOrMessage
      : errorOrMessage?.message || errorOrMessage || '',
  );
  const status =
    httpStatus ??
    errorOrMessage?.apifyHttpStatus ??
    errorOrMessage?.status ??
    errorOrMessage?.httpStatus ??
    (/\b(402)\b/.test(msg) ? 402 : null);

  if (
    status === 402 ||
    /remaining usage|paid plan|billing\/subscription|exceed your remaining/i.test(msg)
  ) {
    return 'apify_billing';
  }
  if (
    /Missing APIFY_|Missing GOOGLE_MAPS_API_KEY|APIFY_TOKEN|APIFY_LOOPNET_ACTOR_ID|APIFY_CREXI_ACTOR_ID/i.test(msg)
  ) {
    return 'apify_config';
  }
  if (/Apify run|Apify dataset|Places API HTTP|Candidate needs primaryCity/i.test(msg)) {
    return 'apify_run';
  }
  return null;
}

function savePackage(candidateId, pkg) {
  const next = { ...pkg, updatedAt: nowIso(), candidateId: pathsFor(candidateId).id };
  writeJson(businessAddressPath(candidateId), next);
  return next;
}

/**
 * @param {object} selection
 * @param {{ skipped?: boolean }} opts
 */
export function selectBusinessAddress(candidateId, selection, { skipped = false } = {}) {
  const { city, state } = cityStateFromCandidate(candidateId);
  const prev = getBusinessAddressPackage(candidateId) || emptyPackage(candidateId, city, state);
  const id = pathsFor(candidateId).id;
  const cityKey = city || prev.city;
  const stateKey = state || prev.state;

  let sel = null;
  if (!skipped && selection) {
    const street = String(selection.street || '').trim();
    const zip = String(selection.zip || '').trim();
    const c = String(selection.city || cityKey || '').trim();
    const st = String(selection.state || stateKey || '')
      .trim()
      .toUpperCase();
    if (!street || !zip || !c || !st) {
      throw Object.assign(new Error('street, city, state, and zip are required'), { status: 400 });
    }
    if (hasAddressRange(street)) {
      throw Object.assign(new Error('Street must not be a numeric range'), { status: 400 });
    }
    const suite = String(selection.suite || '').trim();
    const streetBase = street;
    const streetOut =
      suite && !new RegExp(`\\b${suite.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(street)
        ? `${street}, ${suite}`
        : street;
    sel = {
      street: streetOut,
      streetBase,
      suite,
      city: c,
      state: st,
      zip,
      source: selection.source || 'manual',
      screenedAt: selection.screenedAt || nowIso(),
      mapsUrl: mapsUrl(
        { street: streetBase, city: c, state: st, zip },
        { lat: selection.lat, lng: selection.lng },
      ),
      streetViewUrl: streetViewUrl(
        { street: streetBase, city: c, state: st, zip },
        { lat: selection.lat, lng: selection.lng },
      ),
    };
  }

  let cityCache = null;
  if (cityKey && stateKey) {
    cityCache = ensureCityCacheSeeded(cityKey, stateKey);
    if (skipped || !sel) {
      cityCache = saveCityAddressCache(cityKey, stateKey, {
        ...cityCache,
        usedAddresses: releaseUsedClaimsForCandidate(cityCache.usedAddresses, id),
      });
    } else {
      cityCache = saveCityAddressCache(
        cityKey,
        stateKey,
        claimUsedAddress(cityCache, id, sel),
      );
    }
  }

  const next = savePackage(candidateId, {
    ...prev,
    city: cityKey || prev.city,
    state: stateKey || prev.state,
    status: skipped ? 'skipped' : sel ? 'selected' : prev.status,
    skipped: Boolean(skipped),
    selection: skipped ? null : sel,
    cityCacheKey: cityKey && stateKey ? cityCacheSlug(cityKey, stateKey) : prev.cityCacheKey || null,
    usedAddressesSummary: cityCache?.usedAddresses
      ? Object.keys(cityCache.usedAddresses).length
      : prev.usedAddressesSummary ?? 0,
  });
  saveMeta(candidateId, {
    lastBusinessAddressAt: nowIso(),
    businessAddressStatus: next.status,
  });
  return { package: next, candidate: getCandidateDetail(candidateId) };
}

export function saveHomeBusinessAddress(candidateId, rawLine) {
  const { city, state } = cityStateFromCandidate(candidateId);
  const parsed = parseHomeAddressLine(rawLine, { city, state });
  return selectBusinessAddress(candidateId, parsed, { skipped: false });
}

/** Paste a commercial street (same parse as home) and claim with source manual. */
export function saveManualBusinessAddress(candidateId, rawLine) {
  const { city, state } = cityStateFromCandidate(candidateId);
  const parsed = parseHomeAddressLine(rawLine, { city, state });
  return selectBusinessAddress(
    candidateId,
    { ...parsed, source: 'manual' },
    { skipped: false },
  );
}

export function skipBusinessAddress(candidateId) {
  return selectBusinessAddress(candidateId, null, { skipped: true });
}

function titleCaseStreet(raw) {
  return String(raw || '')
    .split(' ')
    .filter(Boolean)
    .map((w) => {
      if (/^(ne|nw|se|sw|n|s|e|w)$/i.test(w)) return w.toUpperCase();
      if (/^\d/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Unclaimed clean streets + Maps-dirty rejects from the city registry (no Apify).
 * Use for exhausted Find recovery / Use anyway.
 */
export function listRecoverableAddresses(candidateId) {
  const { city, state } = cityStateFromCandidate(candidateId);
  if (!city || !state) {
    return {
      cleans: [],
      overrides: [],
      cityCacheKey: null,
      usedAddressesInCity: 0,
      inventoryTotal: 0,
      inventoryReviewed: 0,
      unscreenedRemaining: 0,
      lastPullMax: null,
      nextPullMax: null,
      canDeepen: false,
      deepenAtCap: false,
      sourceInventory: {
        loopnet: {
          total: 0,
          reviewed: 0,
          left: 0,
          exhausted: false,
          pulled: false,
        },
        crexi: {
          total: 0,
          reviewed: 0,
          left: 0,
          exhausted: false,
          pulled: false,
        },
      },
      sourceBudgets: {},
      readiness: getAddressSourceReadiness(),
      ...pullBudgetFields({
        lastPullMax: null,
        nextPullMax: null,
        hardMax: LISTING_PULL_HARD_MAX,
        urlCount: DEFAULT_LOOPNET_URL_COUNT,
        step: LISTING_PULL_DEPTH_STEP,
        proposedHardMax: Math.min(LISTING_PULL_ABSOLUTE_MAX, LISTING_PULL_HARD_MAX * 2),
        canRaiseMax: true,
        absoluteMax: LISTING_PULL_ABSOLUTE_MAX,
      }),
    };
  }
  const id = pathsFor(candidateId).id;
  const cityCache = ensureCityCacheSeeded(city, state);
  const screenedKeys = cityCache.screenedKeys || {};
  const usedAddresses = cityCache.usedAddresses || {};
  const listings = Array.isArray(cityCache.listings) ? cityCache.listings : [];
  const listingByKey = new Map();
  for (const row of listings) {
    const k = shortlistDedupeKey(row);
    if (k && row.street && !listingByKey.has(k)) listingByKey.set(k, row);
  }

  const cleans = [];
  const overrides = [];
  const metroSet = buildMetroCitySet(city, state);

  for (const [key, meta] of Object.entries(screenedKeys)) {
    if (!meta || meta.expanded) continue;
    const [streetPart, zipPart] = String(key).split('|');
    if (!streetPart || !zipPart) continue;
    if (hasAddressRange(streetPart)) continue;

    const used = usedAddresses[key];
    if (used?.candidateId && used.candidateId !== id) continue;

    const listing = listingByKey.get(key);
    const street = listing?.street || titleCaseStreet(streetPart);
    const zip = listing?.zip || zipPart;
    const listingStateRaw = String(listing?.state || '').trim();
    // Prefer listing state; do not hide wrong-state by falling back to candidate state.
    const st = listingStateRaw || state;
    if (listingStateRaw && !statesMatch(listingStateRaw, state)) continue;
    const c = listing?.city || city;
    if (
      !addressIsLocalMetro(
        { listingCity: c, mapsLocality: meta.mapsLocality || '' },
        city,
        metroSet,
      )
    ) {
      continue;
    }
    const addr = { street, city: c, state: st, zip };
    const row = {
      street,
      suite: used?.suite || suggestSuite(cleans.length + overrides.length),
      city: c,
      state: st,
      zip,
      propertyType: listing?.propertyType || '',
      listingUrl: listing?.url || '',
      listingUrls: listing?.urls || undefined,
      source: listing?.source || undefined,
      sources: listing?.sources || undefined,
      fail: meta.fail || null,
      clean: Boolean(meta.clean && !meta.fail),
      screenedAt: meta.at || null,
      lat: meta.lat ?? undefined,
      lng: meta.lng ?? undefined,
      mapsUrl: mapsUrl(addr, { lat: meta.lat, lng: meta.lng }),
      streetViewUrl: streetViewUrl(addr, { lat: meta.lat, lng: meta.lng }),
      dedupeKey: key,
    };

    if (meta.clean && !meta.fail) {
      cleans.push({
        ...row,
        tier: meta.tier === 'secondary' ? 'secondary' : 'primary',
        mapsLocality: meta.mapsLocality || undefined,
      });
    } else if (
      meta.fail &&
      (/^existing Maps business/i.test(String(meta.fail)) ||
        /^active Maps listing/i.test(String(meta.fail)))
    ) {
      overrides.push(row);
    }
  }

  cleans.sort((a, b) => String(a.street).localeCompare(String(b.street)));
  overrides.sort((a, b) => String(a.street).localeCompare(String(b.street)));

  const inventory = computeCityInventoryProgress(listings, screenedKeys, usedAddresses, id);
  const sourceInventory = buildSourceInventoryMap(listings, screenedKeys, usedAddresses, id);
  const lnState = sourcePullState(cityCache, SOURCE_LOOPNET);
  const lnExhausted = Boolean(sourceInventory[SOURCE_LOOPNET]?.exhausted);
  const pullPreview = resolveLoopnetPullMax(
    lnState,
    {
      refresh: true,
      deepen: lnExhausted,
    },
    SOURCE_LOOPNET,
  );
  const storedLast = Number(lnState.lastPullMax ?? cityCache.lastPullMax);
  const lastPullMax =
    Number.isFinite(storedLast) && storedLast >= 5 ? Math.floor(storedLast) : pullPreview.lastPullMax;
  const urlCount = pullUrlCountFromQuery(lnState.query || cityCache.query, cityCache, SOURCE_LOOPNET);
  const nextForDisplay = pullPreview.needsMaxRaise
    ? lastPullMax + (pullPreview.step || LISTING_PULL_DEPTH_STEP)
    : pullPreview.max;
  const budgets = pullBudgetFields({
    lastPullMax,
    nextPullMax: nextForDisplay,
    hardMax: pullPreview.hardMax,
    urlCount,
    step: pullPreview.step,
    proposedHardMax: pullPreview.proposedHardMax,
    canRaiseMax: pullPreview.canRaiseMax,
    absoluteMax: pullPreview.absoluteMax,
    needsMaxRaise: pullPreview.needsMaxRaise,
  });

  const sourceBudgets = {};
  for (const src of ALL_SOURCES) {
    const st = sourcePullState(cityCache, src);
    const srcExhausted = Boolean(sourceInventory[src]?.exhausted);
    const pull = resolveLoopnetPullMax(st, { refresh: true, deepen: srcExhausted }, src);
    const last = Number(st.lastPullMax);
    const lastOk = Number.isFinite(last) && last >= 5 ? Math.floor(last) : pull.lastPullMax;
    sourceBudgets[src] = {
      ...pullBudgetFields({
        lastPullMax: lastOk,
        nextPullMax: pull.needsMaxRaise ? lastOk + depthStepForSource(src) : pull.max,
        hardMax: pull.hardMax,
        urlCount: pullUrlCountFromQuery(st.query, cityCache, src),
        step: pull.step,
        proposedHardMax: pull.proposedHardMax,
        canRaiseMax: pull.canRaiseMax,
        absoluteMax: pull.absoluteMax,
        needsMaxRaise: pull.needsMaxRaise,
      }),
      lastPullMax: lastOk,
      canDeepen: srcExhausted && (Boolean(pull.deepened) || Boolean(pull.canRaiseMax)),
      deepenAtCap: srcExhausted && Boolean(pull.atCap || pull.needsMaxRaise),
      fetchedAt: st.fetchedAt,
      exhausted: srcExhausted,
      pulled: Boolean(sourceInventory[src]?.pulled),
      inventoryTotal: sourceInventory[src]?.total ?? 0,
      inventoryReviewed: sourceInventory[src]?.reviewed ?? 0,
      unscreenedRemaining: sourceInventory[src]?.left ?? 0,
    };
  }

  return {
    cleans,
    overrides,
    cityCacheKey: cityCacheSlug(city, state),
    usedAddressesInCity: inventory.usedAddressesInCity,
    inventoryTotal: inventory.inventoryTotal,
    inventoryReviewed: inventory.inventoryReviewed,
    unscreenedRemaining: inventory.unscreenedRemaining,
    lastPullMax,
    nextPullMax: nextForDisplay,
    canDeepen: lnExhausted && (Boolean(pullPreview.deepened) || Boolean(pullPreview.canRaiseMax)),
    deepenAtCap: lnExhausted && Boolean(pullPreview.atCap || pullPreview.needsMaxRaise),
    sourceBudgets,
    sourceInventory,
    readiness: getAddressSourceReadiness(),
    ...budgets,
  };
}

function isSolidcodeLoopnetActor(actorId) {
  return /solidcode/i.test(String(actorId || '')) && /loopnet/i.test(String(actorId || ''));
}

/**
 * Parse "123 Main St, Omaha, NE 68102" (solidcode search `name` without enrichDetails).
 */
function parseAddressFromName(name) {
  const line = String(name || '').replace(/\s+/g, ' ').trim();
  if (!line) return null;
  const zipMatch = line.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch ? zipMatch[1] : '';
  let rest = zipMatch ? line.slice(0, zipMatch.index).trim().replace(/[,\s]+$/, '') : line;
  const stateMatch = rest.match(/,?\s*([A-Za-z]{2})\s*$/);
  let state = '';
  if (stateMatch) {
    state = stateMatch[1].toUpperCase();
    rest = rest.slice(0, stateMatch.index).trim().replace(/[,\s]+$/, '');
  }
  const parts = rest.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      street: parts[0],
      city: parts[parts.length - 1],
      state,
      zip,
    };
  }
  if (parts.length === 1 && (zip || state)) {
    return { street: parts[0], city: '', state, zip };
  }
  return null;
}

function propertyTypeFromRaw(raw) {
  const direct =
    raw.propertyType ||
    raw.propertySubType ||
    raw.type ||
    raw.assetType ||
    raw.category ||
    raw.propertyCategory ||
    '';
  if (direct) return String(direct).trim();
  const facts = Array.isArray(raw.propertyFacts) ? raw.propertyFacts : [];
  for (const f of facts) {
    if (String(f?.name || '').toLowerCase() === 'property type') {
      const v = Array.isArray(f.value) ? f.value[0] : f.value;
      if (v) return String(v).trim();
    }
  }
  const summary = String(raw.summary || raw.name || '');
  const m = summary.match(
    /\b(office|retail|flex|industrial|warehouse|multifamily|medical|land|coworking)\b/i,
  );
  return m ? m[1] : '';
}

function normalizeListing(raw, source = SOURCE_LOOPNET) {
  let street =
    raw.streetAddress ||
    raw.street ||
    raw.address ||
    raw.fullAddress ||
    raw.propertyAddress ||
    '';
  let city = raw.city || raw.addressCity || '';
  let state = String(raw.state || raw.addressState || '')
    .trim()
    .toUpperCase();
  let zip = String(raw.zip || raw.postalCode || raw.zipCode || raw.addressZip || '')
    .replace(/\D/g, '')
    .slice(0, 5);

  if (!street || !zip) {
    const parsed = parseAddressFromName(
      raw.name || raw.headline || raw.addressLine || raw.location || '',
    );
    if (parsed) {
      street = street || parsed.street;
      city = city || parsed.city;
      state = state || parsed.state;
      zip = zip || parsed.zip;
    }
  }

  // Crexi sometimes nests address pieces
  if ((!street || !zip) && raw.address && typeof raw.address === 'object') {
    street = street || raw.address.street || raw.address.line1 || '';
    city = city || raw.address.city || '';
    state = state || String(raw.address.state || '').trim().toUpperCase();
    zip = zip || String(raw.address.zip || raw.address.postalCode || '').replace(/\D/g, '').slice(0, 5);
  }

  const propertyType = propertyTypeFromRaw(raw);
  const src = source === SOURCE_CREXI ? SOURCE_CREXI : SOURCE_LOOPNET;
  let url = String(
    raw.url || raw.listingUrl || raw.propertyUrl || raw.crexiUrl || raw.link || '',
  ).trim();
  const id = String(raw.listingId || raw.id || raw.propertyId || raw.url || `${street}-${zip}`).slice(
    0,
    120,
  );
  if (src === SOURCE_CREXI) {
    url = canonicalCrexiPropertyUrl(url, raw.listingId || raw.id || raw.propertyId || '') || '';
  } else if (url && !/^https?:\/\//i.test(url)) {
    url = '';
  }
  const urls = {};
  if (url) urls[src] = url;
  return {
    id,
    street: String(street).trim(),
    city: String(city).trim(),
    state,
    zip,
    propertyType: String(propertyType).trim(),
    url,
    source: src,
    sources: [src],
    urls,
  };
}

/** Merge listing rows by street|zip; keep both portal URLs when present. */
export function mergeListingsByStreet(rows) {
  const byKey = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizeCachedListing(row);
    const k = shortlistDedupeKey(normalized);
    if (!k || !normalized?.street || !k.split('|')[1]) continue;
    const existing = byKey.get(k);
    if (!existing) {
      byKey.set(k, normalized);
      continue;
    }
    const urls = { ...(existing.urls || {}), ...(normalized.urls || {}) };
    if (normalized.url && normalized.source) urls[normalized.source] = normalized.url;
    if (existing.url && existing.source) urls[existing.source] = existing.url || urls[existing.source];
    const sources = [
      ...new Set([...(existing.sources || []), ...(normalized.sources || []), existing.source, normalized.source].filter(Boolean)),
    ];
    byKey.set(k, {
      ...existing,
      propertyType: existing.propertyType || normalized.propertyType,
      url: existing.url || normalized.url || urls.loopnet || urls.crexi || '',
      urls,
      sources,
      source: existing.source || normalized.source,
    });
  }
  return [...byKey.values()];
}

function buildApifyLoopnetInput({ city, state, max, actorId }) {
  const locationHuman = state ? `${city}, ${state}` : city;
  const slug = loopnetLocationSlug(city, state);
  if (isSolidcodeLoopnetActor(actorId)) {
    const searchUrls = [
      `https://www.loopnet.com/search/office-space/${slug}/for-lease/`,
      `https://www.loopnet.com/search/retail-space/${slug}/for-lease/`,
    ];
    return {
      input: {
        searchUrls,
        maxItems: max,
        enrichDetails: false,
      },
      query: {
        city,
        state,
        location: locationHuman,
        locationSlug: slug,
        actorId,
        max,
        searchUrls,
        transactionType: 'for-lease',
        propertyTypes: ['office', 'retail'],
        source: SOURCE_LOOPNET,
      },
    };
  }
  return {
    input: {
      mode: 'search',
      locationMode: 'bylocation',
      location: locationHuman,
      city,
      state,
      searchType: 'For_Lease',
      propertyType: 'office',
      propertyTypes: ['office', 'retail'],
      maxItems: max,
      maxResults: max,
      limit: max,
    },
    query: {
      city,
      state,
      location: locationHuman,
      locationSlug: slug,
      actorId,
      max,
      transactionType: 'for-lease',
      propertyTypes: ['office', 'retail'],
      source: SOURCE_LOOPNET,
    },
  };
}

/**
 * Solidcode Crexi: For Lease + Office + Retail for the city.
 * Actor propertyTypes are top-level only (no Traditional Office enum) — Places/type
 * reject still drops coworking/medical labels when present on the row.
 */
function buildApifyCrexiInput({ city, state, max, actorId }) {
  const locationHuman = state ? `${city}, ${state}` : city;
  const slug = loopnetLocationSlug(city, state);
  // Prefer startUrls so Crexi UI filters (lease + Traditional Office + Retail) apply when
  // the portal encodes them; city/state still passed for fingerprint identity.
  const startUrls = [
    `https://www.crexi.com/lease/properties?query=${encodeURIComponent(locationHuman)}&types%5B%5D=Traditional%20Office`,
    `https://www.crexi.com/lease/properties?query=${encodeURIComponent(locationHuman)}&types%5B%5D=Retail`,
  ];
  return {
    input: {
      startUrls,
      maxResults: max,
    },
    query: {
      city,
      state,
      location: locationHuman,
      locationSlug: slug,
      actorId,
      max,
      startUrls,
      dealType: 'For Lease',
      propertyTypes: ['Traditional Office', 'Retail'],
      source: SOURCE_CREXI,
      // Fallback identity if startUrls fail in the wild — operators can switch actor input
      filterFallback: {
        dealType: 'For Lease',
        city: locationHuman,
        state,
        propertyTypes: ['Office', 'Retail'],
        maxResults: max,
      },
    },
  };
}

function isSolidcodeCrexiActor(actorId) {
  return /solidcode/i.test(String(actorId || '')) && /crexi/i.test(String(actorId || ''));
}

async function fetchApifyRunUsageUsd(token, run) {
  let data = run;
  let usage = run?.usageTotalUsd;
  if ((usage == null || Number(usage) === 0) && run?.id) {
    try {
      const res = await fetch(`${APIFY_BASE}/actor-runs/${encodeURIComponent(run.id)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      data = json.data || json;
      if (data?.usageTotalUsd != null) usage = data.usageTotalUsd;
    } catch {
      /* keep partial */
    }
  }
  return {
    usageTotalUsd: usage != null ? Number(usage) : null,
    runId: data?.id || run?.id || null,
    status: data?.status || run?.status || null,
    chargedEventCounts: data?.chargedEventCounts || run?.chargedEventCounts || null,
  };
}

function estimateApifyPayPerResultUsd(listingsIn) {
  const n = Number(listingsIn) || 0;
  if (n <= 0) return null;
  return roundUsd(n * SOLIDCODE_LISTING_USD);
}

function localityTierReason({
  tier = 'primary',
  mapsLocality = '',
  targetCity = '',
  localityUnknown = false,
  listingCity = '',
  listingCityMismatch = false,
}) {
  if (tier === 'secondary') {
    if (listingCityMismatch) {
      return `Listing city is ${listingCity || 'outside target'} (not ${targetCity || 'target city'}) — Secondary`;
    }
    return `Maps locality is ${mapsLocality || 'outside target'} (not ${targetCity || 'target city'}) — Secondary`;
  }
  if (localityUnknown) return 'Maps locality unknown — Recommended with caution';
  if (mapsLocality) return `Maps locality matches target (${mapsLocality})`;
  return null;
}

function buildShortlistChecks({
  listing,
  typeCheck,
  suite,
  rank,
  expandedFrom = '',
  tier = 'primary',
  mapsLocality = '',
  targetCity = '',
  localityUnknown = false,
  listingCity = '',
  listingCityMismatch = false,
}) {
  const typeLabel = listing.propertyType
    ? `property type allowed (${listing.propertyType})`
    : 'property type allowed (unknown — caution)';
  const streetCheck = expandedFrom
    ? {
        id: 'street_single',
        pass: true,
        label: `Expanded from range ${expandedFrom} → single street number`,
      }
    : { id: 'street_single', pass: true, label: 'Single street number (not a numeric range)' };
  const localityLabel = localityTierReason({
    tier,
    mapsLocality,
    targetCity,
    localityUnknown,
    listingCity,
    listingCityMismatch,
  });
  const localityCheck = localityUnknown && tier !== 'secondary'
    ? {
        id: 'maps_locality',
        pass: null,
        label: 'Maps locality unknown — kept as Recommended with caution',
      }
    : tier === 'secondary'
      ? {
          id: 'maps_locality',
          pass: false,
          label: localityLabel || `Outside target (${targetCity || 'city'}) — Secondary`,
        }
      : {
          id: 'maps_locality',
          pass: true,
          label: mapsLocality
            ? `Maps locality matches target (${mapsLocality})`
            : `Maps locality matches target (${targetCity || 'city'})`,
        };
  return [
    streetCheck,
    {
      id: 'property_type',
      pass: true,
      label: typeCheck?.reason?.startsWith('property type')
        ? typeCheck.reason.replace(/^property type ok:\s*/i, 'Property type allowed: ')
        : typeLabel,
    },
    { id: 'zip', pass: true, label: `ZIP present (${listing.zip})` },
    {
      id: 'places_clean',
      pass: true,
      label: 'Places — no active OPERATIONAL Maps listing at this street+ZIP',
    },
    localityCheck,
    {
      id: 'suite',
      pass: null,
      label: `Suggested suite ${suite} (NAP-friendly stub)`,
    },
    {
      id: 'rank',
      pass: null,
      label: `Shortlist rank #${rank} of up to ${SHORTLIST_CAP} (accumulated recommendations)`,
    },
  ];
}

/**
 * @param {{ apifyMeta?: object, listingsIn?: number, placesCalls?: number, cacheHit?: boolean, sourceHits?: object }} opts
 */
function buildLastSearchCost({
  apifyMeta,
  listingsIn,
  placesCalls,
  cacheHit = false,
  sourceHits = null,
} = {}) {
  const metas = Array.isArray(apifyMeta) ? apifyMeta : apifyMeta ? [apifyMeta] : [];
  let invoiceSum = 0;
  let hasInvoice = false;
  const runIds = [];
  for (const m of metas) {
    const invoiceRaw = m?.usageTotalUsd;
    if (invoiceRaw != null && Number.isFinite(Number(invoiceRaw)) && Number(invoiceRaw) > 0) {
      invoiceSum += Number(invoiceRaw);
      hasInvoice = true;
    }
    if (m?.runId) runIds.push(m.runId);
  }
  const invoice = hasInvoice ? roundUsd(invoiceSum) : null;
  let apifyEstUsd = null;
  let apifyUsd = invoice;
  const allCacheHit =
    cacheHit ||
    (sourceHits &&
      Object.values(sourceHits).length > 0 &&
      Object.values(sourceHits).every((h) => h?.cacheHit));
  if (allCacheHit || !listingsIn) {
    apifyUsd = invoice;
    apifyEstUsd = 0;
  } else if (invoice == null) {
    apifyEstUsd = estimateApifyPayPerResultUsd(listingsIn);
  }
  const placesEstUsd = roundUsd((placesCalls || 0) * PLACES_TEXT_SEARCH_USD) || 0;
  const apifyForTotal =
    apifyUsd != null && apifyUsd > 0 ? apifyUsd : apifyEstUsd != null ? apifyEstUsd : 0;
  const totalEstUsd = roundUsd(apifyForTotal + placesEstUsd);
  const noteParts = [];
  if (allCacheHit) {
    noteParts.push('Apify $0 this run (city cache hit — no new actor run).');
  } else if (apifyUsd != null && apifyUsd > 0) {
    noteParts.push('Apify = run usageTotalUsd (invoice).');
  } else if (listingsIn > 0) {
    noteParts.push(
      `Apify est. = ${listingsIn} results × $${SOLIDCODE_LISTING_USD}/listing (your plan event rate).`,
    );
  }
  noteParts.push(
    'Places est. = Text Search Pro list ($0.032/call); free monthly allowance not subtracted.',
  );
  return {
    apifyUsd: apifyUsd != null && apifyUsd > 0 ? apifyUsd : null,
    apifyEstUsd,
    placesEstUsd,
    totalEstUsd,
    apifyRunId: runIds[0] || null,
    apifyRunIds: runIds,
    chargedEventCounts: metas[0]?.chargedEventCounts || null,
    listingsForApifyEst: !allCacheHit && invoice == null && listingsIn > 0 ? listingsIn : null,
    apifyRatePerListing: SOLIDCODE_LISTING_USD,
    cacheHit: Boolean(allCacheHit),
    note: noteParts.join(' '),
  };
}

function roundUsd(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Number(Number(n).toFixed(4));
}

function tallyRejectReasons(rejected) {
  const tallies = {};
  for (const row of rejected) {
    let key = String(row.fail || 'unknown').trim();
    if (key.startsWith('existing Maps business') || key.startsWith('active Maps listing')) {
      key = 'active Maps listing';
    } else if (key.startsWith('property type rejected')) key = 'property type rejected';
    else if (key.startsWith('Places error')) key = 'Places error';
    else if (/^wrong state:/i.test(key) || /^Maps state /i.test(key)) key = 'wrong state (not target)';
    else if (/^outside metro/i.test(key)) key = 'outside metro';
    tallies[key] = (tallies[key] || 0) + 1;
  }
  return tallies;
}

function isWrongStateFail(fail) {
  const f = String(fail || '');
  return /^wrong state:/i.test(f) || /^Maps state /i.test(f);
}

function isOutsideMetroFail(fail) {
  return /^outside metro/i.test(String(fail || ''));
}

/** Operator-facing reject sample — omit wrong-state / outside-metro noise. */
function rejectedSampleForUi(rejected, limit = 15) {
  return (Array.isArray(rejected) ? rejected : [])
    .filter((row) => !isWrongStateFail(row?.fail) && !isOutsideMetroFail(row?.fail))
    .slice(0, limit);
}

/**
 * @returns {{ listings: object[], query: object, apify: { usageTotalUsd: number|null, runId: string|null, status: string|null, actorId: string } }}
 */
async function runApifyActorPull({
  city,
  state,
  max,
  source,
  actorEnvKey,
  buildInput,
  label,
}) {
  const token = env('APIFY_TOKEN');
  const actorId = env(actorEnvKey);
  if (!token || !actorId) {
    throw Object.assign(
      new Error(
        `Missing APIFY_TOKEN or ${actorEnvKey} — add them to .env for ${label} Find (home paste / skip still work).`,
      ),
      { status: 400 },
    );
  }
  const { input, query } = buildInput({ city, state, max, actorId });
  const startRes = await fetch(
    `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs?waitForFinish=120`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    },
  );
  const startJson = await startRes.json().catch(() => ({}));
  if (!startRes.ok) {
    throw Object.assign(
      new Error(
        `${label} Apify run failed (${startRes.status}): ${
          startJson?.error?.message || JSON.stringify(startJson).slice(0, 240)
        }`,
      ),
      { status: startRes.status === 402 ? 402 : 502, apifyHttpStatus: startRes.status, query },
    );
  }
  let run = startJson.data || startJson;
  const runStatus = String(run.status || '').toUpperCase();
  if (runStatus && runStatus !== 'SUCCEEDED') {
    const usage = await fetchApifyRunUsageUsd(token, run);
    const hint =
      runStatus === 'RUNNING'
        ? ' (wait timed out — try again or lower ADDRESS_SEARCH_MAX_LISTINGS)'
        : '';
    throw Object.assign(
      new Error(
        `${label} Apify run ${runStatus}${run.statusMessage ? `: ${run.statusMessage}` : ''}${hint}`,
      ),
      { status: 502, query, apify: { ...usage, actorId } },
    );
  }
  const datasetId = run.defaultDatasetId;
  if (!datasetId) {
    throw Object.assign(new Error(`${label} Apify run returned no dataset id`), {
      status: 502,
      query,
    });
  }
  const itemsRes = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?format=json&limit=${Math.max(max * 2, max)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const items = await itemsRes.json().catch(() => []);
  if (!itemsRes.ok || !Array.isArray(items)) {
    throw Object.assign(
      new Error(`${label} Apify dataset fetch failed (${itemsRes.status})`),
      { status: 502, query },
    );
  }
  const apify = { ...(await fetchApifyRunUsageUsd(token, run)), actorId, source };
  const listings = items.map((raw) => normalizeListing(raw, source)).filter((l) => l.street);

  // If Crexi startUrls returned nothing, retry once with structured Office+Retail lease filters.
  if (
    source === SOURCE_CREXI &&
    !listings.length &&
    query?.filterFallback &&
    isSolidcodeCrexiActor(actorId)
  ) {
    const fallbackInput = query.filterFallback;
    const retryRes = await fetch(
      `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs?waitForFinish=120`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(fallbackInput),
      },
    );
    const retryJson = await retryRes.json().catch(() => ({}));
    if (retryRes.ok) {
      let retryRun = retryJson.data || retryJson;
      const retryStatus = String(retryRun.status || '').toUpperCase();
      if (retryStatus === 'SUCCEEDED' && retryRun.defaultDatasetId) {
        const retryItemsRes = await fetch(
          `${APIFY_BASE}/datasets/${retryRun.defaultDatasetId}/items?format=json&limit=${Math.max(max * 2, max)}`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        const retryItems = await retryItemsRes.json().catch(() => []);
        if (retryItemsRes.ok && Array.isArray(retryItems) && retryItems.length) {
          const retryApify = {
            ...(await fetchApifyRunUsageUsd(token, retryRun)),
            actorId,
            source,
          };
          return {
            listings: retryItems
              .map((raw) => normalizeListing(raw, source))
              .filter((l) => l.street),
            query: {
              ...query,
              usedFallback: true,
              startUrls: undefined,
              dealType: fallbackInput.dealType,
              propertyTypes: fallbackInput.propertyTypes,
            },
            apify: retryApify,
          };
        }
      }
    }
  }

  return { listings, query, apify };
}

async function runApifyLoopnet({ city, state, max }) {
  return runApifyActorPull({
    city,
    state,
    max,
    source: SOURCE_LOOPNET,
    actorEnvKey: 'APIFY_LOOPNET_ACTOR_ID',
    buildInput: buildApifyLoopnetInput,
    label: 'LoopNet',
  });
}

async function runApifyCrexi({ city, state, max }) {
  return runApifyActorPull({
    city,
    state,
    max,
    source: SOURCE_CREXI,
    actorEnvKey: 'APIFY_CREXI_ACTOR_ID',
    buildInput: buildApifyCrexiInput,
    label: 'Crexi',
  });
}

/**
 * Street number from an address line (first contiguous digits).
 */
function streetNumberToken(raw) {
  return String(raw || '').match(/\d+/)?.[0] || '';
}

/** 5-digit ZIP from free text or ZIP field. */
function zip5Token(raw) {
  const m = String(raw || '').match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : '';
}

/**
 * Normalize street line for token overlap (drop leading number + unit noise).
 */
function streetNameTokens(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[#].*$/, ' ')
    .replace(/\b(suite|ste|unit|apt|apartment|floor|fl|bldg|building)\b\.?\s*[a-z0-9-]+/gi, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/^\d+\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 1);
}

/**
 * True when Place formattedAddress locks to listing street number + ZIP + street tokens.
 */
function placeAddressLocksToListing(formattedAddress, addr) {
  const fa = String(formattedAddress || '');
  if (!fa.trim()) return false;
  const wantNum = streetNumberToken(addr?.street);
  const gotNum = streetNumberToken(fa);
  if (wantNum && gotNum && wantNum !== gotNum) return false;
  if (wantNum && !fa.includes(wantNum)) return false;

  const wantZip = zip5Token(addr?.zip);
  const gotZip = zip5Token(fa);
  if (wantZip && gotZip && wantZip !== gotZip) return false;

  const wantTokens = streetNameTokens(addr?.street);
  if (wantTokens.length) {
    const faNorm = fa.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const hits = wantTokens.filter((t) => faNorm.includes(t));
    if (hits.length === 0) return false;
  }
  return true;
}

/**
 * Places Text Search: dirty only when an OPERATIONAL Maps listing locks to this street+ZIP.
 * CLOSED_* / missing status do not dirty (not "active").
 */
async function placesHasBusinessAtAddress(addr) {
  const key = env('GOOGLE_MAPS_API_KEY');
  if (!key) {
    throw Object.assign(
      new Error(
        'Missing GOOGLE_MAPS_API_KEY — enable Places API (New) and add the key to .env.',
      ),
      { status: 400 },
    );
  }
  const textQuery = [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(', ');
  const res = await fetch(PLACES_SEARCH_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask':
        'places.displayName,places.formattedAddress,places.businessStatus,places.id',
    },
    body: JSON.stringify({ textQuery, languageCode: 'en' }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Places API HTTP ${res.status}: ${json?.error?.message || JSON.stringify(json).slice(0, 200)}`,
    );
  }
  const places = Array.isArray(json.places) ? json.places : [];
  const hits = places.filter((p) => {
    if (!placeAddressLocksToListing(p.formattedAddress, addr)) return false;
    const status = String(p.businessStatus || '').toUpperCase();
    return status === 'OPERATIONAL';
  });
  const top = hits[0];
  return {
    dirty: hits.length > 0,
    hitCount: hits.length,
    sampleName: top?.displayName?.text || top?.displayName || null,
    placeId: top?.id || null,
  };
}

/** Legacy Maps-dirty fails that should be re-checked under OPERATIONAL-only gate. */
function isLegacyMapsDirtyFail(fail) {
  return /^existing Maps business/i.test(String(fail || ''));
}

/** Normalize city/locality for comparison (lowercase, strip punctuation, collapse spaces). */
export function normalizeCityName(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/\bst\b/g, 'saint')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when normalized city names match (strict). Salt Lake City ≠ Kearns. */
export function citiesMatch(a, b) {
  const na = normalizeCityName(a);
  const nb = normalizeCityName(b);
  if (!na || !nb) return false;
  return na === nb;
}

/** Normalize to 2-letter US state abbr, or '' if unknown. */
export function normalizeAddressStateAbbr(raw) {
  return normalizeStateAbbr(raw) || '';
}

/** True when both sides normalize to the same 2-letter state. */
export function statesMatch(a, b) {
  const na = normalizeAddressStateAbbr(a);
  const nb = normalizeAddressStateAbbr(b);
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * Normalized city names within metro radius of primary (Census places).
 * On Census miss, returns target-city-only — never throws.
 */
export function buildMetroCitySet(city, state, radiusMiles = METRO_RADIUS_MILES) {
  const c = String(city || '').trim();
  const st = normalizeAddressStateAbbr(state) || String(state || '').trim().toUpperCase();
  const miles = Math.max(1, Math.min(120, Number(radiusMiles) || METRO_RADIUS_MILES));
  const cacheKey = `${normalizeCityName(c)}|${st}|${miles}`;
  if (metroCitySetCache.has(cacheKey)) return metroCitySetCache.get(cacheKey);

  const set = new Set();
  const primaryNorm = normalizeCityName(c);
  if (primaryNorm) set.add(primaryNorm);
  if (c && st) {
    try {
      const { places, primary } = placesIntersectingRadius(c, st, miles, { minPop: 0 });
      if (primary?.name) set.add(normalizeCityName(primary.name));
      for (const p of places || []) {
        const n = normalizeCityName(p?.name);
        if (n) set.add(n);
      }
    } catch {
      // Census / geometry miss — keep primary-only fallback
    }
  }
  metroCitySetCache.set(cacheKey, set);
  return set;
}

/** True when cityName matches target or any name in the metro set. */
export function isLocalMetroCity(cityName, metroSet, targetCity) {
  if (citiesMatch(cityName, targetCity)) return true;
  const n = normalizeCityName(cityName);
  if (!n) return false;
  return metroSet instanceof Set ? metroSet.has(n) : false;
}

/**
 * Local when listing city or Maps locality is in metro.
 * Both empty/unknown → allow (do not hard-reject missing locality data).
 */
export function addressIsLocalMetro({ listingCity, mapsLocality } = {}, targetCity, metroSet) {
  const listing = String(listingCity || '').trim();
  const maps = String(mapsLocality || '').trim();
  if (!listing && !maps) return true;
  if (listing && isLocalMetroCity(listing, metroSet, targetCity)) return true;
  if (maps && isLocalMetroCity(maps, metroSet, targetCity)) return true;
  return false;
}

function outsideMetroFail(label) {
  const where = String(label || '').trim() || 'unknown';
  return `outside metro: ${where}`;
}

function localityFromGeocodeComponents(components) {
  const list = Array.isArray(components) ? components : [];
  const byType = (type, field = 'long_name') =>
    list.find((c) => Array.isArray(c.types) && c.types.includes(type))?.[field] || '';
  return (
    byType('locality') ||
    byType('postal_town') ||
    byType('sublocality') ||
    byType('sublocality_level_1') ||
    byType('administrative_area_level_3') ||
    ''
  );
}

function stateFromGeocodeComponents(components) {
  const list = Array.isArray(components) ? components : [];
  const short =
    list.find((c) => Array.isArray(c.types) && c.types.includes('administrative_area_level_1'))
      ?.short_name || '';
  const long =
    list.find((c) => Array.isArray(c.types) && c.types.includes('administrative_area_level_1'))
      ?.long_name || '';
  return normalizeAddressStateAbbr(short) || normalizeAddressStateAbbr(long) || null;
}

/**
 * Resolve Google Maps locality for a street (Geocoding).
 * @returns {{ locality: string|null, state: string|null, formattedAddress: string|null, unknown: boolean, lat: number|null, lng: number|null }}
 */
export async function resolveMapsLocality(addr) {
  const empty = {
    locality: null,
    state: null,
    formattedAddress: null,
    unknown: true,
    lat: null,
    lng: null,
  };
  const key = env('GOOGLE_MAPS_API_KEY');
  if (!key) {
    return { ...empty };
  }
  const address = [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(', ');
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Geocoding HTTP ${res.status}: ${json?.error_message || JSON.stringify(json).slice(0, 200)}`,
    );
  }
  if (json.status && json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
    // REQUEST_DENIED (API not enabled) and similar → soft unknown, not a hard fail
    if (json.status === 'REQUEST_DENIED' || json.status === 'OVER_QUERY_LIMIT') {
      return { ...empty };
    }
    throw new Error(`Geocoding ${json.status}: ${json.error_message || ''}`.trim());
  }
  const result = Array.isArray(json.results) ? json.results[0] : null;
  if (!result) {
    return { ...empty };
  }
  const locality = localityFromGeocodeComponents(result.address_components);
  const mapsState = stateFromGeocodeComponents(result.address_components);
  const lat = Number(result.geometry?.location?.lat);
  const lng = Number(result.geometry?.location?.lng);
  return {
    locality: locality || null,
    state: mapsState,
    formattedAddress: result.formatted_address || null,
    unknown: !locality,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

/**
 * Classify clean address vs target city.
 * Recommended requires Maps locality match (when known) AND listing city match when listing city is present.
 * @returns {{ tier: 'primary'|'secondary', mapsLocality: string, localityUnknown: boolean, listingCityMismatch: boolean }}
 */
export function classifyLocalityTier(mapsLocality, targetCity, listingCity = '') {
  const listingCityMismatch = Boolean(
    String(listingCity || '').trim() && !citiesMatch(listingCity, targetCity),
  );
  if (!mapsLocality) {
    if (listingCityMismatch) {
      return {
        tier: 'secondary',
        mapsLocality: '',
        localityUnknown: true,
        listingCityMismatch: true,
      };
    }
    return {
      tier: 'primary',
      mapsLocality: '',
      localityUnknown: true,
      listingCityMismatch: false,
    };
  }
  if (citiesMatch(mapsLocality, targetCity)) {
    if (listingCityMismatch) {
      return {
        tier: 'secondary',
        mapsLocality,
        localityUnknown: false,
        listingCityMismatch: true,
      };
    }
    return {
      tier: 'primary',
      mapsLocality,
      localityUnknown: false,
      listingCityMismatch: false,
    };
  }
  return {
    tier: 'secondary',
    mapsLocality,
    localityUnknown: false,
    listingCityMismatch,
  };
}

function normalizeShortlistListingUrls(row) {
  const listingUrls = {
    ...(row?.listingUrls && typeof row.listingUrls === 'object' ? row.listingUrls : {}),
  };
  if (listingUrls.crexi) {
    const fixed = canonicalCrexiPropertyUrl(listingUrls.crexi, row?.id || '');
    if (fixed) listingUrls.crexi = fixed;
  }
  let listingUrl = String(row?.listingUrl || '').trim();
  if (listingUrl && /crexi\.com/i.test(listingUrl)) {
    listingUrl = canonicalCrexiPropertyUrl(listingUrl, row?.id || '') || listingUrl;
  } else if (!listingUrl) {
    listingUrl = listingUrls.loopnet || listingUrls.crexi || '';
  }
  if (listingUrls.crexi && (!listingUrl || /crexi\.com/i.test(listingUrl))) {
    // keep listingUrl as primary portal link when it was Crexi
    if (row?.source === SOURCE_CREXI || /crexi\.com/i.test(String(row?.listingUrl || ''))) {
      listingUrl = listingUrls.crexi;
    }
  }
  return { listingUrl, listingUrls };
}

/**
 * Re-run Maps locality on an existing shortlist (no Apify / Places).
 * Updates tiers, Street View URLs, and city-cache screenedKeys.
 */
export async function retierShortlistLocalities(candidateId) {
  const { city, state } = cityStateFromCandidate(candidateId);
  if (!city || !state) {
    throw Object.assign(
      new Error('Candidate needs primaryCity and state before re-tiering localities'),
      { status: 400 },
    );
  }
  const id = pathsFor(candidateId).id;
  const prev = getBusinessAddressPackage(candidateId) || emptyPackage(candidateId, city, state);
  const prior = Array.isArray(prev.shortlist) ? prev.shortlist : [];
  if (!prior.length) {
    throw Object.assign(new Error('No shortlist addresses to re-tier'), { status: 400 });
  }

  const now = nowIso();
  const nextRows = [];
  const droppedWrongState = [];
  let primaryN = 0;
  let secondaryN = 0;
  const metroSet = buildMetroCitySet(city, state);

  for (const row of prior) {
    const listingCity = String(row.city || '').trim();
    const listingStateRaw = String(row.state || '').trim();
    if (listingStateRaw && !statesMatch(listingStateRaw, state)) {
      const got = normalizeAddressStateAbbr(listingStateRaw) || listingStateRaw.toUpperCase();
      droppedWrongState.push({
        street: row.street,
        zip: row.zip,
        fail: `wrong state: ${got} ≠ ${String(state).toUpperCase()}`,
        key: shortlistDedupeKey(row),
      });
      continue;
    }
    if (
      listingCity &&
      !addressIsLocalMetro({ listingCity, mapsLocality: '' }, city, metroSet)
    ) {
      droppedWrongState.push({
        street: row.street,
        zip: row.zip,
        fail: outsideMetroFail(listingCity),
        key: shortlistDedupeKey(row),
      });
      continue;
    }

    const addr = {
      street: row.street,
      city: listingCity || city,
      state: listingStateRaw || state,
      zip: row.zip,
    };
    let mapsLocality = '';
    let mapsState = null;
    let localityUnknown = false;
    let listingCityMismatch = false;
    let tier = 'primary';
    let lat = row.lat ?? null;
    let lng = row.lng ?? null;

    try {
      const loc = await resolveMapsLocality(addr);
      mapsLocality = loc.locality || '';
      mapsState = loc.state || null;
      if (loc.lat != null) lat = loc.lat;
      if (loc.lng != null) lng = loc.lng;
      if (mapsState && !statesMatch(mapsState, state)) {
        droppedWrongState.push({
          street: row.street,
          zip: row.zip,
          fail: `Maps state ${mapsState} ≠ ${String(state).toUpperCase()}`,
          key: shortlistDedupeKey(row),
          mapsLocality: mapsLocality || null,
          mapsState,
        });
        continue;
      }
      const classified = classifyLocalityTier(mapsLocality, city, listingCity);
      tier = classified.tier;
      localityUnknown = classified.localityUnknown;
      listingCityMismatch = classified.listingCityMismatch;
      if (classified.mapsLocality) mapsLocality = classified.mapsLocality;
    } catch {
      localityUnknown = true;
      const classified = classifyLocalityTier('', city, listingCity);
      tier = classified.tier;
      listingCityMismatch = classified.listingCityMismatch;
    }

    if (!addressIsLocalMetro({ listingCity, mapsLocality }, city, metroSet)) {
      droppedWrongState.push({
        street: row.street,
        zip: row.zip,
        fail: outsideMetroFail(mapsLocality || listingCity),
        key: shortlistDedupeKey(row),
        mapsLocality: mapsLocality || null,
        mapsState,
      });
      continue;
    }

    const score = tier === 'secondary' ? 40 - secondaryN : 100 - primaryN;
    if (tier === 'secondary') secondaryN += 1;
    else primaryN += 1;

    const suite = row.suite || suggestSuite(nextRows.length);
    const typeCheck = propertyTypePass(row.propertyType);
    const checks = buildShortlistChecks({
      listing: { ...row, zip: addr.zip },
      typeCheck,
      suite,
      rank: nextRows.length + 1,
      expandedFrom: row.expandedFrom || '',
      tier,
      mapsLocality,
      targetCity: city,
      localityUnknown,
      listingCity,
      listingCityMismatch,
    });

    const reason = localityTierReason({
      tier,
      mapsLocality,
      targetCity: city,
      localityUnknown,
      listingCity,
      listingCityMismatch,
    });
    const reasons = [
      typeCheck.reason,
      row.expandedFrom ? `expanded from ${row.expandedFrom}` : null,
      'no active OPERATIONAL Maps listing at street+ZIP',
      reason,
    ].filter(Boolean);

    const { listingUrl, listingUrls } = normalizeShortlistListingUrls(row);

    nextRows.push({
      ...row,
      suite,
      city: addr.city,
      state: addr.state,
      tier,
      mapsLocality: mapsLocality || undefined,
      mapsState: mapsState || undefined,
      localityUnknown: localityUnknown || undefined,
      lat: lat ?? undefined,
      lng: lng ?? undefined,
      reasons,
      checks,
      score,
      listingUrl,
      listingUrls,
      mapsUrl: mapsUrl(addr, { lat, lng }),
      streetViewUrl: streetViewUrl(addr, { lat, lng }),
      retieredAt: now,
    });
  }

  const shortlist = mergeAccumulatedShortlist([], nextRows, {
    foundAt: now,
    cap: SHORTLIST_CAP,
  });

  let cityCache = ensureCityCacheSeeded(city, state);
  const screenedKeys = { ...(cityCache.screenedKeys || {}) };
  for (const drop of droppedWrongState) {
    const k = drop.key;
    if (!k || !k.split('|')[1]) continue;
    screenedKeys[k] = {
      ...(screenedKeys[k] || {}),
      fail: drop.fail,
      at: now,
      clean: false,
      mapsLocality: drop.mapsLocality || null,
      mapsState: drop.mapsState || null,
    };
  }
  for (const row of shortlist) {
    const k = shortlistDedupeKey(row);
    if (!k.split('|')[1]) continue;
    const prevKey = screenedKeys[k] || {};
    screenedKeys[k] = {
      ...prevKey,
      fail: null,
      at: now,
      clean: true,
      tier: row.tier === 'secondary' ? 'secondary' : 'primary',
      mapsLocality: row.mapsLocality || null,
      mapsState: row.mapsState || null,
      lat: row.lat ?? null,
      lng: row.lng ?? null,
    };
  }
  cityCache = saveCityAddressCache(city, state, {
    ...cityCache,
    screenedKeys,
  });

  const primaryCount = shortlist.filter((r) => r.tier !== 'secondary').length;
  const secondaryCount = shortlist.filter((r) => r.tier === 'secondary').length;

  const next = savePackage(candidateId, {
    ...prev,
    city,
    state,
    status: prev.selection ? 'selected' : shortlist.length ? 'searched' : prev.status,
    shortlist,
    screenedKeys,
    cityCacheKey: cityCacheSlug(city, state),
    usedAddressesSummary: Object.keys(cityCache.usedAddresses || {}).length,
    lastSearchStats: {
      ...(prev.lastSearchStats || {}),
      primaryCount,
      secondaryCount,
      shortlistTotal: shortlist.length,
      droppedWrongStateCount: droppedWrongState.length,
      retieredLocalityAt: now,
    },
  });

  return {
    package: next,
    candidate: getCandidateDetail(candidateId),
    primaryCount,
    secondaryCount,
    droppedWrongStateCount: droppedWrongState.length,
    rows: shortlist.map((r) => ({
      street: r.street,
      zip: r.zip,
      tier: r.tier,
      mapsLocality: r.mapsLocality || null,
      mapsState: r.mapsState || null,
      localityUnknown: Boolean(r.localityUnknown),
    })),
  };
}

function suggestSuite(index) {
  const n = 100 + (index % 20) * 50;
  return `STE-${n}`;
}

/** Dedupe key: normalized street + ZIP. */
export function shortlistDedupeKey(row) {
  const street = String(row?.street || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const zip = String(row?.zip || '')
    .replace(/\D/g, '')
    .slice(0, 5);
  return `${street}|${zip}`;
}

/**
 * Progress against city-cache inventory (listings Rover has pulled — not live portal totals).
 * @param {object[]} listings
 * @param {Record<string, object>} screenedKeys
 * @param {Record<string, object>} [usedAddresses]
 * @param {string} [candidateId] — when set, "left" excludes streets claimed by other candidates
 */
export function computeCityInventoryProgress(
  listings,
  screenedKeys,
  usedAddresses = {},
  candidateId = '',
) {
  const id = candidateId ? pathsFor(candidateId).id : '';
  const keys = screenedKeys || {};
  const used = usedAddresses || {};
  let inventoryTotal = 0;
  let inventoryReviewed = 0;
  let unscreenedRemaining = 0;

  for (const row of Array.isArray(listings) ? listings : []) {
    const k = shortlistDedupeKey(row);
    if (!row?.street || !k.split('|')[1]) continue;
    inventoryTotal += 1;
    if (keys[k]) {
      inventoryReviewed += 1;
      continue;
    }
    const u = used[k];
    if (id && u?.candidateId && u.candidateId !== id) continue;
    unscreenedRemaining += 1;
  }

  return {
    inventoryTotal,
    inventoryReviewed,
    unscreenedRemaining,
    usedAddressesInCity: Object.keys(used).length,
  };
}

/** True when a cache listing is attributed to LoopNet or Crexi. */
export function listingBelongsToSource(row, source) {
  const src = source === SOURCE_CREXI ? SOURCE_CREXI : SOURCE_LOOPNET;
  if (!row || typeof row !== 'object') return false;
  if (Array.isArray(row.sources) && row.sources.includes(src)) return true;
  if (row.source === src) return true;
  if (row.urls && typeof row.urls === 'object' && row.urls[src]) return true;
  // Legacy untagged rows count as LoopNet only
  if (src === SOURCE_LOOPNET && !row.source && !(Array.isArray(row.sources) && row.sources.length)) {
    return true;
  }
  return false;
}

/**
 * Inventory for one portal within the shared city cache.
 * Never-pulled source → total 0, left 0, exhausted false.
 */
export function computeSourceInventoryProgress(
  listings,
  screenedKeys,
  usedAddresses = {},
  candidateId = '',
  source = SOURCE_LOOPNET,
) {
  const filtered = (Array.isArray(listings) ? listings : []).filter((row) =>
    listingBelongsToSource(row, source),
  );
  const base = computeCityInventoryProgress(filtered, screenedKeys, usedAddresses, candidateId);
  const exhausted = base.inventoryTotal > 0 && base.unscreenedRemaining === 0;
  return {
    total: base.inventoryTotal,
    reviewed: base.inventoryReviewed,
    left: base.unscreenedRemaining,
    inventoryTotal: base.inventoryTotal,
    inventoryReviewed: base.inventoryReviewed,
    unscreenedRemaining: base.unscreenedRemaining,
    exhausted,
    pulled: base.inventoryTotal > 0,
  };
}

export function buildSourceInventoryMap(
  listings,
  screenedKeys,
  usedAddresses = {},
  candidateId = '',
) {
  return {
    [SOURCE_LOOPNET]: computeSourceInventoryProgress(
      listings,
      screenedKeys,
      usedAddresses,
      candidateId,
      SOURCE_LOOPNET,
    ),
    [SOURCE_CREXI]: computeSourceInventoryProgress(
      listings,
      screenedKeys,
      usedAddresses,
      candidateId,
      SOURCE_CREXI,
    ),
  };
}

/**
 * Newest Find uniques first, then prior list (deduped). Cap at SHORTLIST_CAP (drops oldest).
 * Primary tier before Secondary; keeps existing suite/foundAt on prior rows.
 */
export function mergeAccumulatedShortlist(prior, fresh, { foundAt, cap = SHORTLIST_CAP } = {}) {
  const priorList = Array.isArray(prior) ? prior : [];
  const freshList = Array.isArray(fresh) ? fresh : [];
  const priorKeys = new Set(
    priorList.map((row) => shortlistDedupeKey(row)).filter((k) => k && !k.endsWith('|') && !k.startsWith('|')),
  );
  const seen = new Set();
  const out = [];

  // New uniques only (skip anything already in the accumulated list)
  for (const row of freshList) {
    const k = shortlistDedupeKey(row);
    if (!row?.street || !k.split('|')[1] || seen.has(k) || priorKeys.has(k)) continue;
    seen.add(k);
    out.push({
      ...row,
      tier: row.tier === 'secondary' ? 'secondary' : 'primary',
      foundAt: row.foundAt || foundAt || nowIso(),
    });
  }
  for (const row of priorList) {
    const k = shortlistDedupeKey(row);
    if (!row?.street || seen.has(k)) continue;
    seen.add(k);
    out.push({
      ...row,
      tier: row.tier === 'secondary' ? 'secondary' : 'primary',
    });
  }

  out.sort((a, b) => {
    const ta = a.tier === 'secondary' ? 1 : 0;
    const tb = b.tier === 'secondary' ? 1 : 0;
    if (ta !== tb) return ta - tb;
    const sa = Number(a.score);
    const sb = Number(b.score);
    if (Number.isFinite(sa) && Number.isFinite(sb) && sb !== sa) return sb - sa;
    return 0;
  });

  const limit = Math.max(1, Number(cap) || SHORTLIST_CAP);
  return out.slice(0, limit).map((row, i) => {
    const suite = row.suite || suggestSuite(i);
    const tier = row.tier === 'secondary' ? 'secondary' : 'primary';
    const addr = {
      street: row.street,
      suite,
      city: row.city,
      state: row.state,
      zip: row.zip,
    };
    const checks = Array.isArray(row.checks)
      ? row.checks.map((c) =>
          c.id === 'rank'
            ? {
                ...c,
                label: `Shortlist rank #${i + 1} of up to ${SHORTLIST_CAP} (accumulated recommendations)`,
              }
            : c.id === 'suite'
              ? { ...c, label: `Suggested suite ${suite} (NAP-friendly stub)` }
              : c,
        )
      : row.checks;
    const baseScore =
      tier === 'secondary'
        ? Number.isFinite(Number(row.score))
          ? Number(row.score)
          : 40 - i
        : Number.isFinite(Number(row.score))
          ? Number(row.score)
          : 100 - i;
    return {
      ...row,
      tier,
      suite,
      checks,
      score: baseScore,
      mapsUrl: mapsUrl(addr, { lat: row.lat, lng: row.lng }),
      // Always rebuild — old suite-in-query / pano links were wrong.
      streetViewUrl: streetViewUrl(addr, { lat: row.lat, lng: row.lng }),
    };
  });
}

function cacheFingerprint(city, state, searchUrls) {
  const urls = (Array.isArray(searchUrls) ? searchUrls : []).join('|');
  return `${String(city).toLowerCase()}|${String(state).toUpperCase()}|${urls}`;
}

function sourceCacheFingerprint(source, city, state, query) {
  if (source === SOURCE_CREXI) {
    const urls = (query?.startUrls || []).join('|');
    const types = (query?.propertyTypes || []).join(',');
    const deal = query?.dealType || 'For Lease';
    return `crexi|${String(city).toLowerCase()}|${String(state).toUpperCase()}|${urls || types}|${deal}`;
  }
  return `loopnet|${cacheFingerprint(city, state, query?.searchUrls)}`;
}

function isListingCacheFresh(cacheOrSource, fingerprint) {
  const fetchedAt = cacheOrSource?.fetchedAt;
  if (!fetchedAt) return false;
  if (cacheOrSource.fingerprint && fingerprint && cacheOrSource.fingerprint !== fingerprint) {
    return false;
  }
  const age = Date.now() - Date.parse(fetchedAt);
  return Number.isFinite(age) && age >= 0 && age < LISTING_CACHE_TTL_MS;
}

function normalizeSearchOpts(opts = {}) {
  const readiness = getAddressSourceReadiness();
  const rawSources = opts.sources || {};
  let loopnet =
    rawSources.loopnet != null ? Boolean(rawSources.loopnet) : readiness.loopnet;
  let crexi = rawSources.crexi != null ? Boolean(rawSources.crexi) : readiness.crexi;
  // Backward compat: no sources object → LoopNet only if configured (legacy behavior).
  if (opts.sources == null) {
    loopnet = readiness.loopnet;
    crexi = false;
  }
  if (loopnet && !readiness.loopnet) loopnet = false;
  if (crexi && !readiness.crexi) crexi = false;
  if (!loopnet && !crexi) {
    if (readiness.loopnet) loopnet = true;
    else if (readiness.crexi) crexi = true;
  }

  const refreshIn = opts.refresh || {};
  const deepenIn = typeof opts.deepen === 'object' && opts.deepen ? opts.deepen : {};
  const raiseIn = typeof opts.raisePullMax === 'object' && opts.raisePullMax ? opts.raisePullMax : {};
  const legacyRefresh = Boolean(opts.refreshLoopnet);
  const legacyDeepen = opts.deepen === true || opts.deepen === false ? opts.deepen : null;
  const legacyRaise = opts.raisePullMax === true;

  return {
    sources: { loopnet, crexi },
    refresh: {
      loopnet: refreshIn.loopnet != null ? Boolean(refreshIn.loopnet) : legacyRefresh && loopnet,
      crexi:
        refreshIn.crexi != null
          ? Boolean(refreshIn.crexi)
          : legacyRefresh && crexi && opts.sources != null,
    },
    deepen: {
      loopnet:
        deepenIn.loopnet != null
          ? Boolean(deepenIn.loopnet)
          : legacyDeepen != null
            ? Boolean(legacyDeepen) && loopnet
            : null,
      crexi:
        deepenIn.crexi != null
          ? Boolean(deepenIn.crexi)
          : legacyDeepen != null
            ? Boolean(legacyDeepen) && crexi && opts.sources != null
            : null,
    },
    raisePullMax: {
      loopnet: raiseIn.loopnet != null ? Boolean(raiseIn.loopnet) : legacyRaise && loopnet,
      crexi:
        raiseIn.crexi != null
          ? Boolean(raiseIn.crexi)
          : legacyRaise && crexi && opts.sources != null,
    },
    readiness,
  };
}

/** Apify prepaid usage for the current billing cycle. */
export async function fetchApifyPlanUsage() {
  const token = env('APIFY_TOKEN');
  if (!token) {
    return { ok: false, error: 'Missing APIFY_TOKEN' };
  }
  try {
    const res = await fetch(`${APIFY_BASE}/users/me/limits`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: json?.error?.message || `Apify limits HTTP ${res.status}`,
      };
    }
    const data = json.data || json;
    const used = Number(data?.current?.monthlyUsageUsd);
    const max = Number(data?.limits?.maxMonthlyUsageUsd);
    const cycle = data?.monthlyUsageCycle || {};
    const remaining =
      Number.isFinite(used) && Number.isFinite(max) ? roundUsd(Math.max(0, max - used)) : null;
    return {
      ok: true,
      monthlyUsageUsd: Number.isFinite(used) ? roundUsd(used) : null,
      maxMonthlyUsageUsd: Number.isFinite(max) ? roundUsd(max) : null,
      remainingUsd: remaining,
      cycleStart: cycle.startAt || null,
      cycleEnd: cycle.endAt || null,
      fetchedAt: nowIso(),
    };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

/**
 * Commercial finder: city-shared Apify/cache (LoopNet and/or Crexi) → Places → shortlist.
 * @param {string} candidateId
 * @param {{ sources?: object, refresh?: object, deepen?: object|boolean, raisePullMax?: object|boolean, refreshLoopnet?: boolean, cleanPerRun?: number, listingsPerRun?: number }} [opts]
 */
export async function searchBusinessAddresses(candidateId, opts = {}) {
  const { city, state } = cityStateFromCandidate(candidateId);
  if (!city || !state) {
    throw Object.assign(
      new Error('Candidate needs primaryCity and state (from approved package) before Find addresses'),
      { status: 400 },
    );
  }
  const id = pathsFor(candidateId).id;
  const prev = getBusinessAddressPackage(candidateId) || emptyPackage(candidateId, city, state);
  const searchedAt = nowIso();
  const cleanPerRun = clampCleanPerRun(opts.cleanPerRun);
  const listingsPerRun = clampListingsPerRun(opts.listingsPerRun);
  const {
    sources: enabled,
    refresh,
    deepen: deepenFlags,
    raisePullMax: raiseFlags,
    readiness,
  } = normalizeSearchOpts(opts);

  if (!enabled.loopnet && !enabled.crexi) {
    throw Object.assign(
      new Error(
        'No commercial listing source enabled. Set APIFY_TOKEN plus APIFY_LOOPNET_ACTOR_ID and/or APIFY_CREXI_ACTOR_ID, and toggle at least one source.',
      ),
      { status: 400 },
    );
  }

  const citySlug = cityCacheSlug(city, state);
  let cityCache = ensureCityCacheSeeded(city, state);
  cityCache = migrateCityCache(cityCache, city, state);

  const preSourceInventory = buildSourceInventoryMap(
    cityCache.listings || [],
    cityCache.screenedKeys || {},
    cityCache.usedAddresses || {},
    id,
  );

  const activeSources = ALL_SOURCES.filter((s) => enabled[s]);
  const sourcePull = {};
  for (const src of activeSources) {
    const srcState = sourcePullState(cityCache, src);
    const wantRefresh = Boolean(refresh[src]);
    const srcExhausted = Boolean(preSourceInventory[src]?.exhausted);
    const deepen =
      wantRefresh &&
      (deepenFlags[src] == null ? srcExhausted : Boolean(deepenFlags[src]));
    const pull = resolveLoopnetPullMax(
      srcState,
      {
        refresh: wantRefresh,
        deepen,
        raisePullMax: Boolean(raiseFlags[src]),
        listingsPerRun,
      },
      src,
    );
    if (deepen && pull.needsMaxRaise && !raiseFlags[src]) {
      throw Object.assign(
        new Error(
          `Pull ceiling reached for ${src}. Confirm to double the ceiling, then Fetch deeper again.`,
        ),
        {
          status: 400,
          code: 'needs_max_raise',
          details: {
            source: src,
            pullHardMax: pull.hardMax,
            proposedHardMax: pull.proposedHardMax,
            lastPullMax: pull.lastPullMax,
            absoluteMax: pull.absoluteMax,
          },
        },
      );
    }
    sourcePull[src] = { ...pull, deepen, refresh: wantRefresh, exhausted: srcExhausted };
    if (pull.raisedMax) {
      cityCache = saveCityAddressCache(city, state, {
        ...cityCache,
        sources: {
          ...cityCache.sources,
          [src]: { ...sourcePullState(cityCache, src), pullHardMax: pull.hardMax },
        },
        pullHardMax:
          src === SOURCE_LOOPNET ? pull.hardMax : cityCache.pullHardMax ?? LISTING_PULL_HARD_MAX,
      });
    }
  }

  let listings = Array.isArray(cityCache.listings)
    ? cityCache.listings.map((r) => normalizeCachedListing(r))
    : [];
  const sourceHits = {};
  const apifyMetas = [];
  const queries = {};
  let apifyReturned = 0;
  let anyPulled = false;
  const errors = [];

  for (const src of activeSources) {
    const actorId =
      src === SOURCE_CREXI
        ? env('APIFY_CREXI_ACTOR_ID') || 'solidcode~crexi-scraper'
        : env('APIFY_LOOPNET_ACTOR_ID') || 'solidcode~loopnet-com-scraper';
    const buildInput = src === SOURCE_CREXI ? buildApifyCrexiInput : buildApifyLoopnetInput;
    const { query: builtQuery } = buildInput({
      city,
      state,
      max: sourcePull[src].max,
      actorId,
    });
    const fingerprint = sourceCacheFingerprint(src, city, state, builtQuery);
    const srcState = sourcePullState(cityCache, src);
    const canUseCache =
      !sourcePull[src].refresh && isListingCacheFresh(srcState, fingerprint);
    queries[src] = builtQuery;
    if (canUseCache) {
      sourceHits[src] = {
        cacheHit: true,
        apifyReturned: 0,
        max: sourcePull[src].max,
        deepened: false,
      };
      continue;
    }
    try {
      const runner = src === SOURCE_CREXI ? runApifyCrexi : runApifyLoopnet;
      const apifyResult = await runner({ city, state, max: sourcePull[src].max });
      const fresh = (apifyResult.listings || []).map((l) =>
        normalizeCachedListing({ ...l, source: src }),
      );
      apifyReturned += fresh.length;
      anyPulled = true;
      listings = mergeListingsByStreet([...fresh, ...listings]);
      if (apifyResult.apify) apifyMetas.push(apifyResult.apify);
      queries[src] = apifyResult.query || builtQuery;
      const nextSrcState = {
        ...srcState,
        fetchedAt: searchedAt,
        fingerprint,
        query: queries[src],
        lastPullMax: sourcePull[src].max,
        pullHardMax: sourcePull[src].hardMax,
      };
      cityCache = saveCityAddressCache(city, state, {
        ...cityCache,
        listings,
        sources: { ...cityCache.sources, [src]: nextSrcState },
        fetchedAt: searchedAt,
        fingerprint: src === SOURCE_LOOPNET ? fingerprint : cityCache.fingerprint,
        query: src === SOURCE_LOOPNET ? queries[src] : cityCache.query,
        lastPullMax: src === SOURCE_LOOPNET ? sourcePull[src].max : cityCache.lastPullMax,
        pullHardMax: src === SOURCE_LOOPNET ? sourcePull[src].hardMax : cityCache.pullHardMax,
      });
      sourceHits[src] = {
        cacheHit: false,
        apifyReturned: fresh.length,
        max: sourcePull[src].max,
        deepened: Boolean(sourcePull[src].deepened),
        actorId: apifyResult.apify?.actorId || actorId,
      };
    } catch (error) {
      errors.push({ source: src, error });
      sourceHits[src] = {
        cacheHit: false,
        apifyReturned: 0,
        error: error.message || String(error),
        max: sourcePull[src].max,
      };
    }
  }

  if (errors.length && errors.length === activeSources.length) {
    const error = errors[0].error;
    const kind = classifyAddressSearchError(error) || 'apify_run';
    const failCost = buildLastSearchCost({
      apifyMeta: apifyMetas,
      listingsIn: 0,
      placesCalls: 0,
      cacheHit: false,
      sourceHits,
    });
    let apifyPlanUsage = null;
    try {
      apifyPlanUsage = await fetchApifyPlanUsage();
    } catch {
      /* ignore */
    }
    savePackage(candidateId, {
      ...prev,
      city,
      state,
      cityCacheKey: citySlug,
      status: prev.selection ? 'selected' : prev.skipped ? 'skipped' : 'error',
      lastSearchAt: searchedAt,
      lastSearchError: errors.map((e) => `${e.source}: ${e.error.message || e.error}`).join(' · '),
      lastSearchErrorKind: kind,
      lastSearchQuery: queries,
      lastSearchStats: {
        apifyReturned: 0,
        cacheHit: false,
        sources: sourceHits,
        enabledSources: enabled,
        cacheSize: Array.isArray(cityCache.listings) ? cityCache.listings.length : 0,
        considered: 0,
        skippedAlreadyScreened: 0,
        skippedAlreadyUsed: 0,
        localRejects: 0,
        listingsIn: 0,
        shortlist: 0,
        shortlistTotal: Array.isArray(prev.shortlist) ? prev.shortlist.length : 0,
        added: 0,
        rejected: 0,
        placesCalls: 0,
        rejectTallies: {},
        unscreenedRemaining: 0,
        usedAddressesInCity: Object.keys(cityCache.usedAddresses || {}).length,
      },
      lastSearchCost: failCost,
      apifyPlanUsage,
      rejectedSample: [],
      shortlist: Array.isArray(prev.shortlist) ? prev.shortlist : [],
    });
    throw Object.assign(
      new Error(errors.map((e) => `${e.source}: ${e.error.message || e.error}`).join(' · ')),
      { status: error.status || 502, apifyHttpStatus: error.apifyHttpStatus },
    );
  }

  const cacheHit = activeSources.every((s) => sourceHits[s]?.cacheHit);
  const screenedKeysRaw = { ...(cityCache.screenedKeys || {}) };
  const { screenedKeys, requeued: rangesRequeued } = requeueAddressRangeScreenKeys(screenedKeysRaw);
  const usedAddresses = { ...(cityCache.usedAddresses || {}) };

  for (const row of Array.isArray(prev.shortlist) ? prev.shortlist : []) {
    const k = shortlistDedupeKey(row);
    if (k && row.street && !screenedKeys[k]) {
      screenedKeys[k] = { fail: null, at: row.foundAt || searchedAt, clean: true };
    }
  }

  const runClean = [];
  const rejected = [];
  let placesCalls = 0;
  let localRejects = 0;
  let skippedAlreadyScreened = 0;
  let skippedAlreadyUsed = 0;
  let considered = 0;
  let rangesExpanded = 0;
  let rangeEndpointsScreened = 0;

  const isUsedByOther = (key) => {
    const u = usedAddresses[key];
    return Boolean(u?.candidateId && u.candidateId !== id);
  };

  const placesBudget = placesBudgetPerRun();
  let placesBudgetReached = false;
  listings = sortListingsForScreening(listings, city, state);
  const metroSet = buildMetroCitySet(city, state);

  for (const listing of listings) {
    if (runClean.length >= cleanPerRun) break;
    if (placesBudgetReached) break;

    const key = shortlistDedupeKey(listing);
    if (!listing.street || !key.split('|')[1]) continue;

    if (isUsedByOther(key)) {
      skippedAlreadyUsed += 1;
      continue;
    }

    if (screenedKeys[key]) {
      if (isLegacyMapsDirtyFail(screenedKeys[key]?.fail)) {
        // Re-check under OPERATIONAL-only + street/ZIP lock (old temp-closed / loose matches).
        delete screenedKeys[key];
      } else {
        skippedAlreadyScreened += 1;
        continue;
      }
    }

    considered += 1;

    const typeCheck = propertyTypePass(listing.propertyType);
    if (!typeCheck.ok) {
      rejected.push({ ...listing, fail: typeCheck.reason });
      screenedKeys[key] = { fail: typeCheck.reason, at: searchedAt };
      localRejects += 1;
      continue;
    }

    if (!listing.zip) {
      rejected.push({ ...listing, fail: 'missing zip' });
      screenedKeys[key] = { fail: 'missing zip', at: searchedAt };
      localRejects += 1;
      continue;
    }

    const listingStateRaw = String(listing.state || '').trim();
    if (listingStateRaw && !statesMatch(listingStateRaw, state)) {
      const got = normalizeAddressStateAbbr(listingStateRaw) || listingStateRaw.toUpperCase();
      const fail = `wrong state: ${got} ≠ ${String(state).toUpperCase()}`;
      rejected.push({ ...listing, fail });
      screenedKeys[key] = { fail, at: searchedAt };
      localRejects += 1;
      continue;
    }

    const listingCityEarly = String(listing.city || '').trim();
    if (
      listingCityEarly &&
      !addressIsLocalMetro({ listingCity: listingCityEarly, mapsLocality: '' }, city, metroSet)
    ) {
      const fail = outsideMetroFail(listingCityEarly);
      rejected.push({ ...listing, fail });
      screenedKeys[key] = { fail, at: searchedAt };
      localRejects += 1;
      continue;
    }

    const isRange = hasAddressRange(listing.street);
    let streetsToScreen = [listing.street];
    let expandedFrom = '';
    if (isRange) {
      streetsToScreen = expandAddressRangeStreets(listing.street);
      if (!streetsToScreen.length) {
        rejected.push({ ...listing, fail: 'address range (unexpandable)' });
        screenedKeys[key] = { fail: 'address range (unexpandable)', at: searchedAt };
        localRejects += 1;
        continue;
      }
      expandedFrom = listing.street;
      rangesExpanded += 1;
    }

    for (const street of streetsToScreen) {
      if (runClean.length >= cleanPerRun) break;
      if (placesCalls >= placesBudget) {
        placesBudgetReached = true;
        break;
      }

      const expandedListing = { ...listing, street };
      const ekey = shortlistDedupeKey(expandedListing);
      if (!street || !ekey.split('|')[1]) continue;

      if (isUsedByOther(ekey)) {
        skippedAlreadyUsed += 1;
        continue;
      }
      if (screenedKeys[ekey]) {
        if (isLegacyMapsDirtyFail(screenedKeys[ekey]?.fail)) {
          delete screenedKeys[ekey];
        } else {
          skippedAlreadyScreened += 1;
          continue;
        }
      }

      if (isRange) rangeEndpointsScreened += 1;

      const addr = {
        street,
        city: listing.city || city,
        state: listing.state || state,
        zip: listing.zip,
      };

      let places;
      try {
        places = await placesHasBusinessAtAddress(addr);
        placesCalls += 1;
      } catch (error) {
        const fail = `Places error: ${error.message}`;
        rejected.push({ ...expandedListing, fail, expandedFrom: expandedFrom || undefined });
        screenedKeys[ekey] = { fail, at: searchedAt };
        continue;
      }
      if (places.dirty) {
        const fail = `active Maps listing${places.sampleName ? `: ${places.sampleName}` : ''}`;
        rejected.push({ ...expandedListing, fail, expandedFrom: expandedFrom || undefined });
        screenedKeys[ekey] = { fail, at: searchedAt };
        continue;
      }

      let mapsLocality = '';
      let mapsState = null;
      let localityUnknown = false;
      let listingCityMismatch = false;
      let tier = 'primary';
      let lat = null;
      let lng = null;
      const listingCity = String(listing.city || addr.city || '').trim();
      try {
        const loc = await resolveMapsLocality(addr);
        mapsLocality = loc.locality || '';
        mapsState = loc.state || null;
        lat = loc.lat;
        lng = loc.lng;
        if (mapsState && !statesMatch(mapsState, state)) {
          const fail = `Maps state ${mapsState} ≠ ${String(state).toUpperCase()}`;
          rejected.push({
            ...expandedListing,
            fail,
            expandedFrom: expandedFrom || undefined,
            mapsLocality: mapsLocality || undefined,
            mapsState,
          });
          screenedKeys[ekey] = { fail, at: searchedAt, mapsLocality: mapsLocality || null, mapsState };
          localRejects += 1;
          continue;
        }
        const classified = classifyLocalityTier(mapsLocality, city, listingCity);
        tier = classified.tier;
        localityUnknown = classified.localityUnknown;
        listingCityMismatch = classified.listingCityMismatch;
        if (classified.mapsLocality) mapsLocality = classified.mapsLocality;
      } catch {
        localityUnknown = true;
        const classified = classifyLocalityTier('', city, listingCity);
        tier = classified.tier;
        listingCityMismatch = classified.listingCityMismatch;
      }

      if (!addressIsLocalMetro({ listingCity, mapsLocality }, city, metroSet)) {
        const fail = outsideMetroFail(mapsLocality || listingCity);
        rejected.push({
          ...expandedListing,
          fail,
          expandedFrom: expandedFrom || undefined,
          mapsLocality: mapsLocality || undefined,
          mapsState: mapsState || undefined,
        });
        screenedKeys[ekey] = {
          fail,
          at: searchedAt,
          mapsLocality: mapsLocality || null,
          mapsState: mapsState || null,
        };
        localRejects += 1;
        continue;
      }

      const primaryCount = runClean.filter((r) => r.tier !== 'secondary').length;
      const secondaryCountRun = runClean.filter((r) => r.tier === 'secondary').length;
      const suite = suggestSuite(runClean.length);
      const rank = runClean.length + 1;
      const checks = buildShortlistChecks({
        listing: { ...expandedListing, zip: addr.zip },
        typeCheck,
        suite,
        rank,
        expandedFrom,
        tier,
        mapsLocality,
        targetCity: city,
        localityUnknown,
        listingCity,
        listingCityMismatch,
      });
      const score = tier === 'secondary' ? 40 - secondaryCountRun : 100 - primaryCount;
      const listingUrlsRaw = listing.urls || {};
      const crexiUrl = listingUrlsRaw.crexi
        ? canonicalCrexiPropertyUrl(listingUrlsRaw.crexi, listing.id) || listingUrlsRaw.crexi
        : '';
      const listingUrls = {
        ...(listingUrlsRaw.loopnet ? { loopnet: listingUrlsRaw.loopnet } : {}),
        ...(crexiUrl ? { crexi: crexiUrl } : {}),
      };
      let listingUrl = listing.url || listingUrls.loopnet || listingUrls.crexi || '';
      if (listingUrl && /crexi\.com/i.test(listingUrl)) {
        listingUrl = canonicalCrexiPropertyUrl(listingUrl, listing.id) || listingUrl;
      }
      const localityReason = localityTierReason({
        tier,
        mapsLocality,
        targetCity: city,
        localityUnknown,
        listingCity,
        listingCityMismatch,
      });
      const row = {
        id: listing.id,
        street: addr.street,
        suite,
        city: addr.city,
        state: addr.state,
        zip: addr.zip,
        propertyType: listing.propertyType || '',
        listingUrl,
        listingUrls,
        source: listing.source || SOURCE_LOOPNET,
        sources: listing.sources || [listing.source || SOURCE_LOOPNET],
        expandedFrom: expandedFrom || undefined,
        tier,
        mapsLocality: mapsLocality || undefined,
        mapsState: mapsState || undefined,
        localityUnknown: localityUnknown || undefined,
        lat: lat ?? undefined,
        lng: lng ?? undefined,
        reasons: [
          typeCheck.reason,
          expandedFrom ? `expanded from ${expandedFrom}` : null,
          'no active OPERATIONAL Maps listing at street+ZIP',
          localityReason,
        ].filter(Boolean),
        checks,
        foundAt: searchedAt,
        mapsUrl: mapsUrl(addr, { lat, lng }),
        streetViewUrl: streetViewUrl(addr, { lat, lng }),
        score,
      };
      runClean.push(row);
      screenedKeys[ekey] = {
        fail: null,
        at: searchedAt,
        clean: true,
        tier,
        mapsLocality: mapsLocality || null,
        mapsState: mapsState || null,
        lat: lat ?? null,
        lng: lng ?? null,
      };
    }

    if (isRange) {
      const pending = streetsToScreen.some((street) => {
        const ekey = shortlistDedupeKey({ ...listing, street });
        return ekey.split('|')[1] && !screenedKeys[ekey] && !isUsedByOther(ekey);
      });
      if (!pending) {
        screenedKeys[key] = { fail: null, at: searchedAt, expanded: true };
      }
    }
  }

  const priorList = (Array.isArray(prev.shortlist) ? prev.shortlist : []).filter((r) => {
    const k = shortlistDedupeKey(r);
    return !isUsedByOther(k);
  });
  const priorKeys = new Set(priorList.map((r) => shortlistDedupeKey(r)));
  const added = runClean.filter((r) => !priorKeys.has(shortlistDedupeKey(r))).length;
  let shortlist = mergeAccumulatedShortlist(priorList, runClean, {
    foundAt: searchedAt,
    cap: SHORTLIST_CAP,
  });
  shortlist = shortlist.filter((r) => !isUsedByOther(shortlistDedupeKey(r)));

  const listingCache = {
    fetchedAt: anyPulled || !cityCache.fetchedAt ? searchedAt : cityCache.fetchedAt,
    fingerprint: Object.values(queries)
      .map((q) => sourceCacheFingerprint(q?.source || SOURCE_LOOPNET, city, state, q))
      .join('||'),
    listings,
    query: queries,
  };

  cityCache = saveCityAddressCache(city, state, {
    ...cityCache,
    fingerprint: listingCache.fingerprint,
    fetchedAt: listingCache.fetchedAt,
    listings,
    query: queries.loopnet || cityCache.query,
    screenedKeys,
    usedAddresses,
  });

  const inventory = computeCityInventoryProgress(listings, screenedKeys, usedAddresses, id);
  const sourceInventory = buildSourceInventoryMap(listings, screenedKeys, usedAddresses, id);
  const unscreenedRemaining = inventory.unscreenedRemaining;
  const enabledSourceExhausted =
    activeSources.length > 0 &&
    activeSources.every((s) => Boolean(sourceInventory[s]?.exhausted));

  const rejectTallies = tallyRejectReasons(rejected);
  const lastSearchCost = buildLastSearchCost({
    apifyMeta: apifyMetas,
    listingsIn: cacheHit ? 0 : apifyReturned,
    placesCalls,
    cacheHit,
    sourceHits,
  });
  recordRoverApiSpend('googleMaps', lastSearchCost.placesEstUsd);

  const emptyRun = runClean.length === 0;
  let status;
  if (prev.selection) status = 'selected';
  else if (shortlist.length > 0) status = 'searched';
  else if (emptyRun) status = 'empty_search';
  else status = 'searched';

  const sourceLabel = activeSources
    .map((s) => (s === SOURCE_CREXI ? 'Crexi' : 'LoopNet'))
    .join(' + ');
  const primaryPull = sourcePull[activeSources[0]] || {};
  const urlCountPrimary = pullUrlCountFromQuery(
    queries[activeSources[0]],
    cityCache,
    activeSources[0],
  );

  let lastSearchError = null;
  let lastSearchErrorKind = null;
  if (placesBudgetReached) {
    lastSearchError = `Places budget reached (${placesCalls}/${placesBudget} lookups this run · ~$${(
      placesCalls * 0.032
    ).toFixed(2)} est.). Shortlist has ${shortlist.length} address(es). Run Find again to screen more remaining streets, or use Manual / recover / home / Skip.`;
    lastSearchErrorKind = 'places_budget';
  } else if (emptyRun) {
    if (!listings.length) {
      lastSearchError = `${sourceLabel} returned no listings for this search — check actor input / city, or use Manual commercial / home paste / Skip.`;
      lastSearchErrorKind = 'empty_listings';
    } else if (
      enabledSourceExhausted &&
      (skippedAlreadyScreened > 0 || skippedAlreadyUsed > 0)
    ) {
      lastSearchError =
        skippedAlreadyUsed > 0 &&
        activeSources.every((s) => (sourceInventory[s]?.left ?? 0) === 0) &&
        skippedAlreadyScreened === 0
          ? 'Remaining candidates are already used by other candidates. Use Manual commercial, recover a prior clean, Use anyway, Fetch deeper, home paste, or Skip.'
          : `No more unscreened ${sourceLabel} candidates in city cache. Use Fetch deeper to pull more listings (costs Apify), or Manual commercial / recover / Use anyway / home / Skip.`;
      lastSearchErrorKind = 'cache_exhausted';
    } else if (unscreenedRemaining === 0 && (skippedAlreadyScreened > 0 || skippedAlreadyUsed > 0)) {
      // Other sources may still have inventory; checked sources are not all exhausted.
      lastSearchError =
        'No new cleans this run from checked sources. Toggle sources or Fetch deeper on an exhausted source, or use Manual / recover / home / Skip.';
      lastSearchErrorKind = 'empty_screened';
    } else {
      lastSearchError =
        'No clean commercial addresses after screening — try Manual commercial, recover / Use anyway, Fetch deeper, home paste, or Skip.';
      lastSearchErrorKind = 'empty_screened';
    }
  }

  let apifyPlanUsage = null;
  try {
    apifyPlanUsage = await fetchApifyPlanUsage();
  } catch {
    /* ignore */
  }

  const sourceBudgetStats = {};
  for (const src of ALL_SOURCES) {
    const st = sourcePullState(cityCache, src);
    const inv = sourceInventory[src] || {};
    const srcExhausted = Boolean(inv.exhausted);
    const pull =
      sourcePull[src] ||
      resolveLoopnetPullMax(st, { refresh: true, deepen: srcExhausted, listingsPerRun }, src);
    const last = Number(st.lastPullMax);
    const lastOk = Number.isFinite(last) && last >= 5 ? Math.floor(last) : pull.lastPullMax;
    const step = depthStepForSource(src);
    sourceBudgetStats[src] = {
      ...pullBudgetFields({
        lastPullMax: lastOk,
        nextPullMax: pull.needsMaxRaise
          ? lastOk + step
          : Math.min(
              pull.hardMax || LISTING_PULL_HARD_MAX,
              (lastOk || maxListingsForSource(src, listingsPerRun)) + step,
            ),
        hardMax: st.pullHardMax || pull.hardMax,
        urlCount: pullUrlCountFromQuery(st.query || queries[src], cityCache, src),
        step,
        proposedHardMax: pull.proposedHardMax,
        canRaiseMax: pull.canRaiseMax,
        absoluteMax: LISTING_PULL_ABSOLUTE_MAX,
        needsMaxRaise: pull.needsMaxRaise,
      }),
      lastPullMax: st.lastPullMax ?? lastOk,
      fetchedAt: st.fetchedAt,
      exhausted: srcExhausted,
      pulled: Boolean(inv.pulled),
      inventoryTotal: inv.total ?? 0,
      inventoryReviewed: inv.reviewed ?? 0,
      unscreenedRemaining: inv.left ?? 0,
      canDeepen: srcExhausted && (Boolean(pull.deepened) || Boolean(pull.canRaiseMax)),
      deepenAtCap: srcExhausted && Boolean(pull.atCap || pull.needsMaxRaise),
    };
  }

  const next = savePackage(candidateId, {
    ...prev,
    city,
    state,
    status,
    shortlist,
    cityCacheKey: citySlug,
    listingCache,
    screenedKeys,
    usedAddressesSummary: inventory.usedAddressesInCity,
    rejectedSample: rejectedSampleForUi(rejected, 15),
    lastSearchAt: searchedAt,
    lastSearchError,
    lastSearchErrorKind,
    lastSearchQuery: queries,
    lastSearchStats: {
      apifyReturned: cacheHit ? 0 : apifyReturned,
      cacheHit,
      cacheShared: true,
      cacheSize: listingCache.listings?.length || 0,
      considered,
      skippedAlreadyScreened,
      skippedAlreadyUsed,
      localRejects,
      listingsIn: cacheHit ? listingCache.listings?.length || 0 : apifyReturned,
      shortlist: runClean.length,
      shortlistTotal: shortlist.length,
      added,
      rejected: rejected.length,
      placesCalls,
      placesBudget,
      placesBudgetReached,
      cleanPerRun,
      listingsPerRun,
      max: primaryPull.max,
      rejectTallies,
      unscreenedRemaining,
      usedAddressesInCity: inventory.usedAddressesInCity,
      inventoryTotal: inventory.inventoryTotal,
      inventoryReviewed: inventory.inventoryReviewed,
      sourceInventory,
      refreshLoopnet: Boolean(refresh.loopnet),
      deepened: activeSources.some((s) => sourcePull[s]?.deepened),
      lastPullMax: primaryPull.lastPullMax,
      pullMax: primaryPull.max,
      deepenAtCap: activeSources.some((s) => sourcePull[s]?.atCap && !sourcePull[s]?.deepened),
      raisedPullMax: activeSources.some((s) => sourcePull[s]?.raisedMax),
      enabledSources: enabled,
      sources: sourceHits,
      sourceBudgets: sourceBudgetStats,
      readiness,
      ...pullBudgetFields({
        lastPullMax: primaryPull.max,
        nextPullMax: Math.min(
          primaryPull.hardMax || LISTING_PULL_HARD_MAX,
          (primaryPull.max || maxListingsForSource(activeSources[0], listingsPerRun)) +
            depthStepForSource(activeSources[0]),
        ),
        hardMax: primaryPull.hardMax || LISTING_PULL_HARD_MAX,
        urlCount: urlCountPrimary,
        step: depthStepForSource(activeSources[0]),
        proposedHardMax: primaryPull.proposedHardMax,
        canRaiseMax: primaryPull.canRaiseMax,
        absoluteMax: LISTING_PULL_ABSOLUTE_MAX,
        needsMaxRaise: false,
      }),
      secondaryCount: shortlist.filter((r) => r.tier === 'secondary').length,
      primaryCount: shortlist.filter((r) => r.tier !== 'secondary').length,
      rangesRequeued,
      rangesExpanded,
      rangeEndpointsScreened,
      partialSourceErrors: errors.map((e) => ({
        source: e.source,
        message: e.error.message || String(e.error),
      })),
    },
    lastSearchCost,
    apifyPlanUsage,
  });

  saveMeta(candidateId, {
    lastBusinessAddressAt: searchedAt,
    businessAddressStatus: next.status,
    lastCosts: {
      addressSearch: lastSearchCost.totalEstUsd,
    },
  });

  return {
    package: next,
    candidate: getCandidateDetail(candidateId),
    apifyPlanUsage,
    recover: listRecoverableAddresses(candidateId),
    sources: readiness,
    cityCache: {
      key: citySlug,
      usedAddresses,
      listingCount: listings.length,
      fetchedAt: listingCache.fetchedAt,
      inventoryTotal: inventory.inventoryTotal,
      inventoryReviewed: inventory.inventoryReviewed,
      unscreenedRemaining,
    },
  };
}
export function addressNapForPrompt(candidateId) {
  const pkg = getBusinessAddressPackage(candidateId);
  if (!pkg?.selection || pkg.skipped) return null;
  const s = pkg.selection;
  return {
    street: s.street,
    city: s.city,
    state: s.state,
    zip: s.zip,
  };
}
