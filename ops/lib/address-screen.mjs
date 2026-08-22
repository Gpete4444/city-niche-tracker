/**
 * Business address finder: home paste / skip / commercial LoopNet+Places screen.
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

const ROOT = process.cwd();
const CITY_CACHE_DIR = path.join(RESEARCH_DIR, 'address-city-cache');
const DEFAULT_MAX_LISTINGS = 50;
const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const APIFY_BASE = 'https://api.apify.com/v2';
/** Places API (New) Text Search Pro list price ≈ $32 / 1k — estimate only, not a Google invoice. */
const PLACES_TEXT_SEARCH_USD = 0.032;
/** Starter-plan solidcode listing event (from Apify billing: $0.00145 / result). */
const SOLIDCODE_LISTING_USD = 0.00145;
/** Max accumulated clean recommendations kept across Find runs. */
const SHORTLIST_CAP = 25;
/** Reuse LoopNet cache without re-billing Apify. */
const LISTING_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLEAN_PER_RUN = 10;

function env(name) {
  return String(process.env[name] || '').trim();
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
  return readJson(businessAddressPath(candidateId), null);
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

function emptyCityCache(city, state, fingerprint = '') {
  return {
    version: 1,
    city: city || '',
    state: state || '',
    fingerprint: fingerprint || '',
    fetchedAt: null,
    listings: [],
    query: null,
    screenedKeys: {},
    usedAddresses: {},
    updatedAt: nowIso(),
  };
}

export function getCityAddressCache(city, state) {
  return readJson(cityCachePath(city, state), null);
}

function saveCityAddressCache(city, state, data) {
  const next = {
    ...emptyCityCache(city, state),
    ...data,
    city,
    state,
    screenedKeys: data?.screenedKeys || {},
    usedAddresses: data?.usedAddresses || {},
    updatedAt: nowIso(),
  };
  writeJson(cityCachePath(city, state), next);
  return next;
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

function maxListings() {
  const n = Number(env('ADDRESS_SEARCH_MAX_LISTINGS') || DEFAULT_MAX_LISTINGS);
  if (!Number.isFinite(n) || n < 5) return DEFAULT_MAX_LISTINGS;
  return Math.min(200, Math.floor(n));
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

/** Reject numeric street ranges like 390-400 E Walnut. */
export function hasAddressRange(street) {
  return /\b\d+\s*[-–—]\s*\d+\b/.test(String(street || ''));
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

function mapsUrl(addr) {
  const q = encodeURIComponent(
    [addr.street, addr.suite, addr.city, addr.state, addr.zip].filter(Boolean).join(', '),
  );
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function streetViewUrl(addr) {
  const q = encodeURIComponent(
    [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(', '),
  );
  return `https://www.google.com/maps/@?api=1&map_action=pano&query=${q}`;
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
    /Missing APIFY_|Missing GOOGLE_MAPS_API_KEY|APIFY_TOKEN|APIFY_LOOPNET_ACTOR_ID/i.test(msg)
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
      mapsUrl: mapsUrl({ street: streetBase, suite, city: c, state: st, zip }),
      streetViewUrl: streetViewUrl({ street: streetBase, city: c, state: st, zip }),
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

export function skipBusinessAddress(candidateId) {
  return selectBusinessAddress(candidateId, null, { skipped: true });
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
    raw.propertyType || raw.type || raw.assetType || raw.category || raw.propertyCategory || '';
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

function normalizeListing(raw) {
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
  let zip = String(raw.zip || raw.postalCode || raw.addressZip || '').replace(/\D/g, '').slice(0, 5);

  if (!street || !zip) {
    const parsed = parseAddressFromName(raw.name || raw.headline || raw.addressLine);
    if (parsed) {
      street = street || parsed.street;
      city = city || parsed.city;
      state = state || parsed.state;
      zip = zip || parsed.zip;
    }
  }

  const propertyType = propertyTypeFromRaw(raw);
  const id = String(raw.listingId || raw.id || raw.url || `${street}-${zip}`).slice(0, 120);
  return {
    id,
    street: String(street).trim(),
    city: String(city).trim(),
    state,
    zip,
    propertyType: String(propertyType).trim(),
    url: raw.url || raw.listingUrl || '',
  };
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
      // searchUrls alone encode office/retail + for-lease; omit location/transactionType/propertyType
      // so Apify does not validate invalid enums like "office-space".
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
    },
  };
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

function buildShortlistChecks({ listing, typeCheck, suite, rank }) {
  const typeLabel = listing.propertyType
    ? `property type allowed (${listing.propertyType})`
    : 'property type allowed (unknown — caution)';
  return [
    { id: 'street_single', pass: true, label: 'Single street number (not a numeric range)' },
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
      label: 'Places — no OPERATIONAL business at this street number',
    },
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
 * @param {{ apifyMeta?: object, listingsIn?: number, placesCalls?: number, cacheHit?: boolean }} opts
 */
function buildLastSearchCost({ apifyMeta, listingsIn, placesCalls, cacheHit = false }) {
  const invoiceRaw = apifyMeta?.usageTotalUsd;
  const invoice =
    invoiceRaw != null && Number.isFinite(Number(invoiceRaw)) && Number(invoiceRaw) > 0
      ? roundUsd(invoiceRaw)
      : null;
  let apifyEstUsd = null;
  let apifyUsd = invoice;
  if (cacheHit || !listingsIn) {
    apifyUsd = invoice; // usually null
    apifyEstUsd = 0;
  } else if (invoice == null) {
    apifyEstUsd = estimateApifyPayPerResultUsd(listingsIn);
  }
  const placesEstUsd = roundUsd((placesCalls || 0) * PLACES_TEXT_SEARCH_USD) || 0;
  const apifyForTotal =
    apifyUsd != null && apifyUsd > 0 ? apifyUsd : apifyEstUsd != null ? apifyEstUsd : 0;
  const totalEstUsd = roundUsd(apifyForTotal + placesEstUsd);
  const noteParts = [];
  if (cacheHit) {
    noteParts.push('Apify $0 this run (LoopNet cache hit — no new actor run).');
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
    apifyRunId: apifyMeta?.runId || null,
    chargedEventCounts: apifyMeta?.chargedEventCounts || null,
    listingsForApifyEst: !cacheHit && invoice == null && listingsIn > 0 ? listingsIn : null,
    apifyRatePerListing: SOLIDCODE_LISTING_USD,
    cacheHit: Boolean(cacheHit),
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
    if (key.startsWith('existing Maps business')) key = 'existing Maps business';
    else if (key.startsWith('property type rejected')) key = 'property type rejected';
    else if (key.startsWith('Places error')) key = 'Places error';
    tallies[key] = (tallies[key] || 0) + 1;
  }
  return tallies;
}

/**
 * @returns {{ listings: object[], query: object, apify: { usageTotalUsd: number|null, runId: string|null, status: string|null, actorId: string } }}
 */
async function runApifyLoopnet({ city, state, max }) {
  const token = env('APIFY_TOKEN');
  const actorId = env('APIFY_LOOPNET_ACTOR_ID');
  if (!token || !actorId) {
    throw Object.assign(
      new Error(
        'Missing APIFY_TOKEN or APIFY_LOOPNET_ACTOR_ID — add them to .env for Find addresses (home paste / skip still work).',
      ),
      { status: 400 },
    );
  }
  const { input, query } = buildApifyLoopnetInput({ city, state, max, actorId });
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
        `Apify run failed (${startRes.status}): ${
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
        `Apify run ${runStatus}${run.statusMessage ? `: ${run.statusMessage}` : ''}${hint}`,
      ),
      { status: 502, query, apify: { ...usage, actorId } },
    );
  }
  const datasetId = run.defaultDatasetId;
  if (!datasetId) {
    throw Object.assign(new Error('Apify run returned no dataset id'), {
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
      new Error(`Apify dataset fetch failed (${itemsRes.status})`),
      { status: 502, query },
    );
  }
  const apify = { ...(await fetchApifyRunUsageUsd(token, run)), actorId };
  const listings = items.map(normalizeListing).filter((l) => l.street);
  return { listings, query, apify };
}

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
  const streetNum = String(addr.street).match(/\d+/)?.[0] || '';
  const hits = places.filter((p) => {
    const fa = String(p.formattedAddress || '');
    if (streetNum && !fa.includes(streetNum)) return false;
    const status = String(p.businessStatus || 'OPERATIONAL').toUpperCase();
    return status === 'OPERATIONAL' || status === 'CLOSED_TEMPORARILY' || !p.businessStatus;
  });
  return {
    dirty: hits.length > 0,
    hitCount: hits.length,
    sampleName: hits[0]?.displayName?.text || hits[0]?.displayName || null,
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
 * Newest Find uniques first, then prior list (deduped). Cap at SHORTLIST_CAP (drops oldest).
 * Keeps existing suite/foundAt on prior rows; duplicates prefer the prior row.
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
      foundAt: row.foundAt || foundAt || nowIso(),
    });
  }
  for (const row of priorList) {
    const k = shortlistDedupeKey(row);
    if (!row?.street || seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }

  const limit = Math.max(1, Number(cap) || SHORTLIST_CAP);
  return out.slice(0, limit).map((row, i) => {
    const suite = row.suite || suggestSuite(i);
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
    return {
      ...row,
      suite,
      checks,
      score: 100 - i,
      mapsUrl: row.mapsUrl || mapsUrl(addr),
      streetViewUrl: row.streetViewUrl || streetViewUrl(addr),
    };
  });
}

function cacheFingerprint(city, state, searchUrls) {
  const urls = Array.isArray(searchUrls) ? searchUrls.join('|') : '';
  return `${String(city).toLowerCase()}|${String(state).toUpperCase()}|${urls}`;
}

function isListingCacheFresh(cache, fingerprint) {
  if (!cache?.fetchedAt || !Array.isArray(cache.listings) || !cache.listings.length) return false;
  if (cache.fingerprint && fingerprint && cache.fingerprint !== fingerprint) return false;
  const age = Date.now() - Date.parse(cache.fetchedAt);
  return Number.isFinite(age) && age >= 0 && age < LISTING_CACHE_TTL_MS;
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
 * Commercial finder: city-shared Apify/cache → local rules → Places → shortlist.
 * @param {string} candidateId
 * @param {{ refreshLoopnet?: boolean }} [opts]
 */
export async function searchBusinessAddresses(candidateId, { refreshLoopnet = false } = {}) {
  const { city, state } = cityStateFromCandidate(candidateId);
  if (!city || !state) {
    throw Object.assign(
      new Error('Candidate needs primaryCity and state (from approved package) before Find addresses'),
      { status: 400 },
    );
  }
  const max = maxListings();
  const id = pathsFor(candidateId).id;
  const prev = getBusinessAddressPackage(candidateId) || emptyPackage(candidateId, city, state);
  const searchedAt = nowIso();
  const actorId = env('APIFY_LOOPNET_ACTOR_ID') || null;
  const { query: builtQuery } = buildApifyLoopnetInput({
    city,
    state,
    max,
    actorId: actorId || 'solidcode~loopnet-com-scraper',
  });
  const fingerprint = cacheFingerprint(city, state, builtQuery.searchUrls);
  const citySlug = cityCacheSlug(city, state);

  let cityCache = ensureCityCacheSeeded(city, state, fingerprint);

  let query = {
    ...builtQuery,
    city,
    state,
    location: `${city}, ${state}`,
    locationSlug: loopnetLocationSlug(city, state),
    actorId,
    max,
  };
  let apifyMeta = { usageTotalUsd: null, runId: null, status: null, actorId };
  let listings = [];
  let cacheHit = false;
  let apifyReturned = 0;

  const cityListingCache = {
    fetchedAt: cityCache.fetchedAt,
    fingerprint: cityCache.fingerprint,
    listings: cityCache.listings || [],
    query: cityCache.query,
  };
  const canUseCache = !refreshLoopnet && isListingCacheFresh(cityListingCache, fingerprint);

  if (canUseCache) {
    listings = cityListingCache.listings;
    cacheHit = true;
    query = cityListingCache.query || query;
    apifyReturned = 0;
  } else {
    try {
      const apifyResult = await runApifyLoopnet({ city, state, max });
      listings = apifyResult.listings;
      query = apifyResult.query || query;
      apifyMeta = apifyResult.apify || apifyMeta;
      apifyReturned = listings.length;
      const priorListings = Array.isArray(cityCache.listings) ? cityCache.listings : [];
      if (refreshLoopnet && priorListings.length) {
        const byKey = new Map();
        for (const row of [...listings, ...priorListings]) {
          const k = shortlistDedupeKey(row);
          if (k && row.street && !byKey.has(k)) byKey.set(k, row);
        }
        listings = [...byKey.values()];
      }
    } catch (error) {
      if (error.query) query = error.query;
      if (error.apify) apifyMeta = { ...apifyMeta, ...error.apify };
      const kind = classifyAddressSearchError(error) || 'apify_run';
      const failCost = buildLastSearchCost({
        apifyMeta,
        listingsIn: 0,
        placesCalls: 0,
        cacheHit: false,
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
        lastSearchError: error.message || String(error),
        lastSearchErrorKind: kind,
        lastSearchQuery: query,
        lastSearchStats: {
          apifyReturned: 0,
          cacheHit: false,
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
          max,
          rejectTallies: {},
          unscreenedRemaining: 0,
          usedAddressesInCity: Object.keys(cityCache.usedAddresses || {}).length,
        },
        lastSearchCost: failCost,
        apifyPlanUsage,
        rejectedSample: [],
        shortlist: Array.isArray(prev.shortlist) ? prev.shortlist : [],
      });
      throw error;
    }
  }

  const screenedKeys = { ...(cityCache.screenedKeys || {}) };
  const usedAddresses = { ...(cityCache.usedAddresses || {}) };

  // Backfill cleans from this candidate's shortlist into city screenedKeys.
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

  const isUsedByOther = (key) => {
    const u = usedAddresses[key];
    return Boolean(u?.candidateId && u.candidateId !== id);
  };

  for (const listing of listings) {
    const key = shortlistDedupeKey(listing);
    if (!listing.street || !key.split('|')[1]) continue;

    if (isUsedByOther(key)) {
      skippedAlreadyUsed += 1;
      continue;
    }

    if (screenedKeys[key]) {
      skippedAlreadyScreened += 1;
      continue;
    }

    considered += 1;

    if (hasAddressRange(listing.street)) {
      rejected.push({ ...listing, fail: 'address range' });
      screenedKeys[key] = { fail: 'address range', at: searchedAt };
      localRejects += 1;
      continue;
    }
    const typeCheck = propertyTypePass(listing.propertyType);
    if (!typeCheck.ok) {
      rejected.push({ ...listing, fail: typeCheck.reason });
      screenedKeys[key] = { fail: typeCheck.reason, at: searchedAt };
      localRejects += 1;
      continue;
    }
    const addr = {
      street: listing.street,
      city: listing.city || city,
      state: listing.state || state,
      zip: listing.zip,
    };
    if (!addr.zip) {
      rejected.push({ ...listing, fail: 'missing zip' });
      screenedKeys[key] = { fail: 'missing zip', at: searchedAt };
      localRejects += 1;
      continue;
    }

    let places;
    try {
      places = await placesHasBusinessAtAddress(addr);
      placesCalls += 1;
    } catch (error) {
      const fail = `Places error: ${error.message}`;
      rejected.push({ ...listing, fail });
      screenedKeys[key] = { fail, at: searchedAt };
      continue;
    }
    if (places.dirty) {
      const fail = `existing Maps business${places.sampleName ? `: ${places.sampleName}` : ''}`;
      rejected.push({ ...listing, fail });
      screenedKeys[key] = { fail, at: searchedAt };
      continue;
    }

    const suite = suggestSuite(runClean.length);
    const rank = runClean.length + 1;
    const checks = buildShortlistChecks({ listing, typeCheck, suite, rank });
    const row = {
      id: listing.id,
      street: addr.street,
      suite,
      city: addr.city,
      state: addr.state,
      zip: addr.zip,
      propertyType: listing.propertyType || '',
      listingUrl: listing.url || '',
      reasons: [typeCheck.reason, 'no OPERATIONAL Places hit at street number'],
      checks,
      foundAt: searchedAt,
      mapsUrl: mapsUrl({ ...addr, suite }),
      streetViewUrl: streetViewUrl(addr),
      score: 100 - runClean.length,
    };
    runClean.push(row);
    screenedKeys[key] = { fail: null, at: searchedAt, clean: true };

    if (runClean.length >= CLEAN_PER_RUN) break;
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
    fetchedAt: cacheHit ? cityCache.fetchedAt || searchedAt : searchedAt,
    fingerprint,
    listings,
    query,
  };

  cityCache = saveCityAddressCache(city, state, {
    ...cityCache,
    fingerprint,
    fetchedAt: listingCache.fetchedAt,
    listings,
    query,
    screenedKeys,
    usedAddresses,
  });

  const unscreenedRemaining = listings.filter((l) => {
    const k = shortlistDedupeKey(l);
    return l.street && k.split('|')[1] && !screenedKeys[k] && !isUsedByOther(k);
  }).length;

  const rejectTallies = tallyRejectReasons(rejected);
  const lastSearchCost = buildLastSearchCost({
    apifyMeta,
    listingsIn: cacheHit ? 0 : apifyReturned,
    placesCalls,
    cacheHit,
  });

  const emptyRun = runClean.length === 0;
  let status;
  if (prev.selection) status = 'selected';
  else if (shortlist.length > 0) status = 'searched';
  else if (emptyRun) status = 'empty_search';
  else status = 'searched';

  let lastSearchError = null;
  let lastSearchErrorKind = null;
  if (emptyRun) {
    if (!listings.length) {
      lastSearchError =
        'LoopNet returned no listings for this search — check actor input / city slug, or use home paste / Skip.';
      lastSearchErrorKind = 'empty_listings';
    } else if (unscreenedRemaining === 0 && (skippedAlreadyScreened > 0 || skippedAlreadyUsed > 0)) {
      lastSearchError =
        skippedAlreadyUsed > 0 && unscreenedRemaining === 0 && skippedAlreadyScreened === 0
          ? 'Remaining LoopNet candidates are already used by other candidates. Use Refresh LoopNet, home paste, or Skip.'
          : 'No more unscreened LoopNet candidates in city cache. Use Refresh LoopNet to pull new listings (costs Apify).';
      lastSearchErrorKind = 'cache_exhausted';
    } else {
      lastSearchError =
        'No clean commercial addresses after screening — try Refresh LoopNet, home paste, or Skip.';
      lastSearchErrorKind = 'empty_screened';
    }
  }

  let apifyPlanUsage = null;
  try {
    apifyPlanUsage = await fetchApifyPlanUsage();
  } catch {
    /* ignore */
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
    usedAddressesSummary: Object.keys(usedAddresses).length,
    rejectedSample: rejected.slice(0, 15),
    lastSearchAt: searchedAt,
    lastSearchError,
    lastSearchErrorKind,
    lastSearchQuery: query,
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
      max,
      rejectTallies,
      unscreenedRemaining,
      usedAddressesInCity: Object.keys(usedAddresses).length,
      refreshLoopnet: Boolean(refreshLoopnet),
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
    cityCache: {
      key: citySlug,
      usedAddresses,
      listingCount: listings.length,
      fetchedAt: listingCache.fetchedAt,
    },
  };
}

/** Site-config prompt helper: operator-approved address or omit. */
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
