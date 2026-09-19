/**
 * Shared radius + click multi-select map.
 * - Service area (Website Track): page icons + Accept
 * - Discovery pack: sync city names into pack Cities field
 *
 * Map host = table panel slot; controls host = form / step body.
 */

import {
  explodeAndSortPlaceFeatures,
  isLargestPart,
  isSliverPart,
} from './map-polygons.js?v=20260917saHit';
import {
  clusterColor,
  parseClusterKey,
  alsoServingHighlightColor,
  serviceAreaEmphasisOutline,
} from './shotgun-clusters.js?v=20260917saRing';
import {
  ALSO_SERVING_CAP,
  AUTO_SEED_MAX_MILES,
  PREFER_MIN_PAGES,
  PREFER_MAX_PAGES,
  PREFER_MAX_SUBURBS,
  addCoverage as applyAddCoverage,
  removeCoverage as applyRemoveCoverage,
  nearestLeftoverKeys,
  seedCoverageFromRadius as applySeedCoverage,
  coverageClickHint,
  leftoverAlsoServingHint,
  leftoverAlsoServingAddedStatus,
  siblingAlsoServingAddedStatus,
  serviceRadiusMilesFromCoverage,
  withinMaxMiles,
  normalizeMapPlaceName,
  placeNameKeySet,
  placeNameSetHas,
  setPlaceNameAliases,
  getPlaceNameAlias,
} from './service-area-selection.mjs?v=20260919saMin';

let Lref = null;

async function ensureLeaflet() {
  if (Lref) return Lref;
  if (!document.getElementById('leaflet-css')) {
    const link = document.createElement('link');
    link.id = 'leaflet-css';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }
  if (!window.L) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load Leaflet'));
      document.head.appendChild(s);
    });
  }
  Lref = window.L;
  return Lref;
}

function fmtPop(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return String(Math.round(v));
}

function placeKey(name, state) {
  return `${String(name || '')
    .trim()
    .toLowerCase()}|${String(state || '')
    .trim()
    .toUpperCase()}`;
}

function normalizePlaceName(name) {
  return normalizeMapPlaceName(name);
}

const SLIDER_MIN = 5;
const SLIDER_MAX = 100;
const DEFAULT_RADIUS = 15;
/** Labels/boundaries load this far from the candidate — not the whole state. */
const LABEL_LOAD_RADIUS = 100;

/** Flat 2D document glyph — easier to see than emoji on map labels. */
const PAGE_ICON =
  '<span class="sa-page-icon" title="Gets a location page" aria-label="Gets a location page">' +
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path fill="#2563eb" stroke="#1e3a8a" stroke-width="1" stroke-linejoin="round" ' +
  'd="M3.5 1.5h6.2L13 4.8V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"/>' +
  '<path fill="#93c5fd" stroke="#1e3a8a" stroke-width="1" stroke-linejoin="round" d="M9.5 1.5V5h3.5"/>' +
  '<path fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" d="M5.2 8h5.5M5.2 10.5h4"/>' +
  '</svg></span>';

function milesLngLat(lng1, lat1, lng2, lat2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function geometryLngLat(geometry) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const walk = (coords) => {
    if (!coords) return;
    if (typeof coords[0] === 'number') {
      sx += coords[0];
      sy += coords[1];
      n += 1;
      return;
    }
    for (const c of coords) walk(c);
  };
  walk(geometry?.coordinates);
  if (!n) return null;
  return [sx / n, sy / n];
}

/**
 * Claude-first page pick (mirrors ops/lib/geo-neighbors mergeLocationPages).
 * @returns {Set<string>} placeKeys including primary
 */
function computePageKeys({
  selected,
  claudeOrder,
  primaryCity,
  state,
  max = 8,
  minPages = 0,
  popByKey,
  blocked = new Set(),
  skipFarther = null,
  keepNames = [],
  ignoreClaudeOrder = false,
  sortBy = 'population',
  distanceFn = null,
  maxMiles = AUTO_SEED_MAX_MILES,
} = {}) {
  const st = String(state || '').trim().toUpperCase();
  const primaryNorm = normalizePlaceName(primaryCity);
  const keep = new Set((keepNames || []).map((n) => normalizePlaceName(n)));
  const keys = new Set();
  if (primaryCity) keys.add(placeKey(primaryCity, st));

  const cov = [...selected.values()].filter(
    (r) => normalizePlaceName(r.name) !== primaryNorm,
  );
  const used = new Set();
  const out = [];

  const shouldSkip = (name, key, { ignoreMiles = false } = {}) => {
    if (placeNameSetHas(blocked, name, key)) return true;
    if (keep.has(normalizePlaceName(name))) return false;
    if (typeof skipFarther === 'function' && skipFarther(name, key)) return true;
    if (
      !ignoreMiles &&
      typeof distanceFn === 'function' &&
      !withinMaxMiles(distanceFn(name, key), maxMiles)
    ) {
      return true;
    }
    return false;
  };

  const push = (label) => {
    const n = String(label || '').trim();
    if (!n || normalizePlaceName(n) === primaryNorm) return;
    const hit = cov.find((r) => normalizePlaceName(r.name) === normalizePlaceName(n));
    if (!hit) return;
    const k = placeKey(hit.name, hit.state || st);
    if (shouldSkip(hit.name, k)) return;
    if (used.has(k)) return;
    used.add(k);
    out.push(k);
  };

  if (!ignoreClaudeOrder) {
    for (const c of claudeOrder || []) {
      if (out.length >= max) break;
      push(c);
    }
  }

  const rest = cov
    .filter((r) => !used.has(placeKey(r.name, r.state || st)))
    .map((r) => ({
      name: r.name,
      key: placeKey(r.name, r.state || st),
      pop: popByKey.get(placeKey(r.name, r.state || st)) || 0,
      miles: typeof distanceFn === 'function' ? distanceFn(r.name, placeKey(r.name, r.state || st)) : Infinity,
    }))
    .sort((a, b) => {
      if (sortBy === 'distance') {
        const da = Number.isFinite(a.miles) ? a.miles : Infinity;
        const db = Number.isFinite(b.miles) ? b.miles : Infinity;
        if (da !== db) return da - db;
      }
      return b.pop - a.pop;
    });

  for (const r of rest) {
    if (out.length >= max) break;
    if (shouldSkip(r.name, r.key)) continue;
    used.add(r.key);
    out.push(r.key);
  }

  const wantPages = Number(minPages);
  if (Number.isFinite(wantPages) && wantPages > 0 && 1 + out.length < wantPages) {
    for (const r of rest) {
      if (out.length >= max) break;
      if (shouldSkip(r.name, r.key, { ignoreMiles: true })) continue;
      if (used.has(r.key)) continue;
      used.add(r.key);
      out.push(r.key);
    }
  }

  for (const k of out) keys.add(k);
  return keys;
}

function labelHtml(esc, name, pop, { hasPage = false, star = false } = {}) {
  const icon = hasPage ? `${PAGE_ICON} ` : '';
  const starBit = star ? '★ ' : '';
  return `${icon}${starBit}<span class="sa-label-name">${esc(name)}</span> <span class="sa-label-pop">${esc(fmtPop(pop))}</span>`;
}

/** Primary + research suggestedSuburbs only. */
function suggestedLocationPagesBlockHtml(esc, {
  primaryCity,
  researchSuggested,
  hostId = '',
  milesOk = null,
} = {}) {
  const pages = [];
  const seen = new Set();
  const push = (raw, isPrimary = false) => {
    const name = String(raw || '').trim();
    if (!name) return;
    const key = normalizePlaceName(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    pages.push({ name, isPrimary });
  };
  push(primaryCity, true);
  const research = (researchSuggested || [])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .filter((name) => (typeof milesOk === 'function' ? milesOk(name) : true));
  for (const c of research) push(c, false);

  const emptySeedNote =
    research.length === 0
      ? `<p class="muted small sa-suggested-pages-seed">No research suburb seed</p>`
      : '';

  const items = pages
    .map(
      (p) =>
        `<li>${esc(p.name)}${p.isPrimary ? ' <span class="muted">(primary)</span>' : ''}</li>`,
    )
    .join('');

  if (!pages.length && !emptySeedNote) return '';

  return `<div class="sa-suggested-pages"${hostId ? ` id="${esc(hostId)}"` : ''}>
    <h4 class="sa-list-title">Suggested location pages <span class="muted">(research seed)</span></h4>
    ${pages.length ? `<ul class="sa-suggested-pages-list">${items}</ul>` : ''}
    ${emptySeedNote}
  </div>`;
}

function zoneColumnsPlaceholderHtml(uid) {
  return `<div class="sa-zone-columns" id="${uid}-zone-cols">
    <div class="sa-zone-col">
      <h4 class="sa-list-title">Suggested location pages</h4>
      <ul class="sa-zone-col-list" id="${uid}-pages-col"></ul>
    </div>
    <div class="sa-zone-col">
      <h4 class="sa-list-title">Also serving</h4>
      <ul class="sa-zone-col-list" id="${uid}-serving-col"></ul>
    </div>
  </div>`;
}

/**
 * @param {{
 *   variant?: 'service-area' | 'discovery',
 *   mapHost: HTMLElement,
 *   controlsHost: HTMLElement,
 *   api: (path: string, opts?: object) => Promise<any>,
 *   esc: (s: string) => string,
 *   primaryCity?: string,
 *   state: string,
 *   radiusMiles?: number,
 *   minPop?: number,
 *   maxPop?: number | null,
 *   initialSelected?: Array<{name:string,state:string}|string>,
 *   claudeOrder?: string[],
 *   researchSuggestedSuburbs?: string[],
 *   zoneAware?: boolean,
 *   zonePagesLocked?: boolean,
 *   clusterKey?: number | null,
 *   zoneMembers?: Array<{city:string,state?:string,clusterKey?:number,role?:string}>,
 *   onAccept?: (payload: object) => Promise<void>,
 *   onSelectionChange?: (payload: { radiusMiles: number, selectedCities: Array<{name:string,state:string}>, primaryCity: string }) => void,
 * }} opts
 */
async function mountGeoSelectMap(opts) {
  const {
    variant = 'service-area',
    mapHost,
    controlsHost,
    api,
    esc,
    primaryCity: initialPrimary = '',
    state,
    radiusMiles: initialRadius = 15,
    minPop: initialMinPop,
    maxPop: initialMaxPop,
    initialSelected = [],
    claudeOrder = [],
    researchSuggestedSuburbs = [],
    blockedPlaceKeys = [],
    claimedPlaceKeys = [],
    claimedBy = {},
    claimedKinds = {},
    zonePrimaries = [],
    zoneMembers = [],
    zoneAware = false,
    zonePagesLocked = false,
    clusterKey: initialClusterKey = null,
    keepPageNames = [],
    confirmPageOverride = null,
    onAccept,
    onSelectionChange,
  } = opts;

  if (!mapHost || !controlsHost) return { destroy() {} };

  const currentClusterKey = parseClusterKey(initialClusterKey);

  const isDiscovery = variant === 'discovery';
  const showPages = !isDiscovery;
  const uid = `gs-${Math.random().toString(36).slice(2, 9)}`;

  let minPopFilter = Number.isFinite(Number(initialMinPop))
    ? Number(initialMinPop)
    : isDiscovery
      ? 70000
      : zoneAware
        ? 0
        : 5000;
  let maxPopFilter =
    initialMaxPop != null && Number.isFinite(Number(initialMaxPop))
      ? Number(initialMaxPop)
      : isDiscovery
        ? 200000
        : null;

  const blocked = placeNameKeySet(blockedPlaceKeys);
  const claimed = placeNameKeySet(claimedPlaceKeys);
  const claimedOwner = new Map();
  const claimedKind = new Map();
  for (const [k, v] of Object.entries(claimedKinds || {})) {
    setPlaceNameAliases(claimedKind, k, String(v || 'page'));
  }
  for (const [k, v] of Object.entries(claimedBy || {})) {
    setPlaceNameAliases(claimedOwner, k, String(v || ''));
  }
  const zonePrimaryCenters = (zonePrimaries || [])
    .map((p) => ({
      city: p.city,
      state: p.state,
      lng: Number(p.lng),
      lat: Number(p.lat),
    }))
    .filter((p) => p.city && Number.isFinite(p.lng) && Number.isFinite(p.lat));
  /** @type {Map<string, [number, number]>} */
  const centerByKey = new Map();
  for (const p of zonePrimaryCenters) {
    if (p.state) centerByKey.set(placeKey(p.city, p.state), [p.lng, p.lat]);
  }

  const siblingFillByName = new Map();
  const siblingClusterByName = new Map();
  for (const m of [...(zoneMembers || []), ...(zonePrimaries || [])]) {
    if (!m?.city) continue;
    const ck = parseClusterKey(m.clusterKey);
    if (ck) setPlaceNameAliases(siblingClusterByName, m.city, ck);
    const fill = clusterColor(ck) || (m.role === 'hub' ? '#3b82f6' : '');
    if (fill) setPlaceNameAliases(siblingFillByName, m.city, fill);
  }

  function siblingFill(name) {
    return getPlaceNameAlias(siblingFillByName, name) || '';
  }

  function isCurrentClusterSibling(name) {
    const ck = getPlaceNameAlias(siblingClusterByName, name) || 0;
    return Boolean(currentClusterKey && ck && ck === currentClusterKey);
  }

  const pageBlockSet = new Set([...blocked, ...claimed]);
  /** Operator turned these leftovers off — do not auto-add back on radius change. */
  const pageOffKeys = new Set();
  /** Operator explicitly removed these cities — seed must not put them back. */
  const deselectedKeys = new Set();
  /** Operator explicitly added these cities — seed keeps them even outside the auto top-10. */
  const pinnedKeys = new Set();
  /** After a coverage click, do not auto-fill empty page slots onto another leftover. */
  let operatorEditedCoverage = false;

  function isSiblingPlace(name, key) {
    return placeNameSetHas(blocked, name, key);
  }

  function isClaimedPlace(name, key) {
    return placeNameSetHas(claimed, name, key);
  }

  function needsPageOverride(name, key) {
    return isSiblingPlace(name, key) || isClaimedPlace(name, key);
  }

  function claimedOwnerCity(name) {
    return getPlaceNameAlias(claimedOwner, name) || '';
  }

  function isLeftoverClaim(name, key) {
    return isClaimedPlace(name, key) && !isSiblingPlace(name, key);
  }

  function leftoverPageClaimHint(name) {
    return leftoverAlsoServingHint({
      name,
      ownerCity: claimedOwnerCity(name),
    });
  }

  function rememberFeatureCenter(feature) {
    const p = feature?.properties || {};
    if (!p.name) return;
    const c = geometryLngLat(feature.geometry);
    if (!c) return;
    centerByKey.set(placeKey(p.name, p.state), c);
  }

  function isFartherLeftover(name, key) {
    if (!zonePrimaryCenters.length) return false;
    if (isSiblingPlace(name, key)) return false;
    const here = centerByKey.get(key);
    const self = zonePrimaryCenters.find(
      (p) => normalizePlaceName(p.city) === normalizePlaceName(primaryCity),
    );
    if (!here || !self) return false;
    const selfDist = milesLngLat(here[0], here[1], self.lng, self.lat);
    for (const other of zonePrimaryCenters) {
      if (normalizePlaceName(other.city) === normalizePlaceName(primaryCity)) continue;
      const d = milesLngLat(here[0], here[1], other.lng, other.lat);
      if (d < selfDist) return true;
    }
    return false;
  }

  let primaryCity = String(initialPrimary || '').trim();
  const selected = new Map();
  for (const s of initialSelected) {
    if (typeof s === 'string') {
      selected.set(placeKey(s, state), { name: s, state: String(state).toUpperCase() });
    } else if (s?.name) {
      selected.set(placeKey(s.name, s.state || state), {
        name: s.name,
        state: String(s.state || state).toUpperCase(),
      });
    }
  }
  if (primaryCity) {
    selected.set(placeKey(primaryCity, state), {
      name: primaryCity,
      state: String(state).toUpperCase(),
    });
  }

  let radius = Math.max(
    SLIDER_MIN,
    Math.min(SLIDER_MAX, Number(initialRadius) || DEFAULT_RADIUS),
  );
  /** @type {Set<string>} */
  let inRadiusKeys = new Set();
  /** @type {Map<string, number>} */
  let popByKey = new Map();
  let primaryCenter = null;
  let map = null;
  let placesLayer = null;
  let circleLayer = null;
  let debounceTimer = null;
  let destroyed = false;
  let seededFromRadius = false;
  /** In-radius places for ranking Also serving after selected is trimmed. */
  const radiusPool = new Map();
  let didFit = false;
  /** @type {ResizeObserver | null} */
  let resizeObserver = null;
  /** @type {(() => void) | null} */
  let onWindowResize = null;
  /** @type {{ key: 'name' | 'population', dir: 'asc' | 'desc' }} */
  let listSort = { key: 'name', dir: 'asc' };

  const helpText = isDiscovery
    ? 'Click an in-range city (Min–Max pop) as center. Radius adds/drops in-range cities.'
    : zoneAware
      ? 'Click a city to add or remove coverage. Page (table) turns a location page on or off. Seed is location pages plus Also serving leftovers within 5 miles — your clicks stick. Zone sibling cities stay Also serving only. No radius ring — the Zone is the geography.'
      : 'Click a city to add or remove coverage. Blue Page = location page (prefer 4–6 including primary). Seed is pages plus Also serving leftovers within 5 miles — your clicks stick.';

  const acceptBlock = isDiscovery
    ? ''
    : `<div class="narrative-actions" style="margin-top:0.75rem">
        <button type="button" class="btn primary" id="${uid}-accept">Accept selected cities</button>
      </div>
      <div id="${uid}-page-picker" class="sa-page-picker hidden" hidden></div>
      <div id="${uid}-save-progress" class="job-progress hidden" aria-live="polite" style="margin-top:0.65rem">
        <div class="job-progress-track"><div class="job-progress-bar" id="${uid}-save-progress-bar"></div></div>
        <p class="job-progress-label" id="${uid}-save-progress-label">Saving…</p>
        <p class="job-progress-detail" id="${uid}-save-progress-detail">Starting…</p>
      </div>
      <p class="muted small" id="${uid}-accept-status"></p>`;

  const suggestedPagesBlock = showPages
    ? zoneAware
      ? zoneColumnsPlaceholderHtml(uid)
      : suggestedLocationPagesBlockHtml(esc, {
          primaryCity,
          researchSuggested: researchSuggestedSuburbs,
          hostId: `${uid}-suggested-pages`,
        })
    : '';

  const helpPara = isDiscovery
    ? `<p class="muted small">${esc(helpText)}</p>`
    : '';

  const popFields = showPages
    ? `<label class="sa-pop-field">Min pop <input id="${uid}-min-pop" type="number" min="0" step="1000" value="${esc(
        String(minPopFilter),
      )}" /></label>
      <label class="sa-pop-field">Max pop <input id="${uid}-max-pop" type="number" min="0" step="1000" value="${
        maxPopFilter != null ? esc(String(maxPopFilter)) : ''
      }" placeholder="none" /></label>`
    : '';

  const radiusField =
    !isDiscovery && zoneAware
      ? ''
      : `<label class="sa-radius-field">
          Radius <strong id="${uid}-radius-val">${esc(String(radius))}</strong> mi
          <input id="${uid}-radius" type="range" min="${SLIDER_MIN}" max="${SLIDER_MAX}" step="1" value="${esc(String(radius))}" />
        </label>`;

  mapHost.innerHTML = `<div id="${uid}-map" class="sa-map-canvas" role="application" aria-label="${
    isDiscovery ? 'Discovery cities map' : 'Service area map'
  }"></div>`;
  controlsHost.innerHTML = `
    <div class="sa-controls">
      <div class="sa-radius-label">
        ${radiusField}
        ${popFields}
      </div>
      <span class="muted small" id="${uid}-status">Loading map…</span>
      ${suggestedPagesBlock}
      <h4 class="sa-list-title">Selected cities <span id="${uid}-count" class="muted"></span></h4>
      <p class="muted small sa-pop-total" id="${uid}-pop-total"></p>
      ${helpPara}
      <div id="${uid}-list" class="sa-table-wrap"></div>
      ${acceptBlock}
    </div>
  `;

  const statusEl = controlsHost.querySelector(`#${uid}-status`);
  const listEl = controlsHost.querySelector(`#${uid}-list`);
  const countEl = controlsHost.querySelector(`#${uid}-count`);
  const popTotalEl = controlsHost.querySelector(`#${uid}-pop-total`);
  const acceptStatus = controlsHost.querySelector(`#${uid}-accept-status`);
  const pagePickerEl = controlsHost.querySelector(`#${uid}-page-picker`);
  const saveProgressEl = controlsHost.querySelector(`#${uid}-save-progress`);
  const saveProgressBar = controlsHost.querySelector(`#${uid}-save-progress-bar`);
  const saveProgressLabel = controlsHost.querySelector(`#${uid}-save-progress-label`);
  const saveProgressDetail = controlsHost.querySelector(`#${uid}-save-progress-detail`);
  const slider = controlsHost.querySelector(`#${uid}-radius`);
  const radiusVal = controlsHost.querySelector(`#${uid}-radius-val`);
  const minPopEl = controlsHost.querySelector(`#${uid}-min-pop`);
  const maxPopEl = controlsHost.querySelector(`#${uid}-max-pop`);
  const acceptBtn = controlsHost.querySelector(`#${uid}-accept`);
  const pagesColEl = controlsHost.querySelector(`#${uid}-pages-col`);
  const servingColEl = controlsHost.querySelector(`#${uid}-serving-col`);
  const mapEl = mapHost.querySelector(`#${uid}-map`);
  if (mapEl && zoneAware) {
    mapEl.style.setProperty('--sa-serving-color', alsoServingHighlightColor(currentClusterKey));
  }

  function setSaveProgress(visible, { label, detail, current, total } = {}) {
    if (saveProgressEl) {
      saveProgressEl.classList.toggle('hidden', !visible);
      if (saveProgressLabel && label) saveProgressLabel.textContent = label;
      if (saveProgressDetail && detail) saveProgressDetail.textContent = detail;
      if (saveProgressBar) {
        const known = Number(total) > 0 && Number(current) >= 0;
        saveProgressBar.classList.toggle('is-determinate', known);
        if (known) {
          const pct = Math.max(4, Math.min(100, Math.round((Number(current) / Number(total)) * 100)));
          saveProgressBar.style.width = `${pct}%`;
        } else {
          saveProgressBar.style.width = '';
        }
      }
    }
    const known = Number(total) > 0 && Number(current) >= 0;
    window.dispatchEvent(
      new CustomEvent('rover-progress', {
        detail: {
          visible: Boolean(visible),
          label,
          detail,
          done: known ? Number(current) : undefined,
          total: known ? Number(total) : undefined,
        },
      }),
    );
  }

  /** Operator-controlled SEO page keys (includes primary). */
  let pageKeySet = new Set();
  let pagesSeeded = false;

  function emitSelection() {
    onSelectionChange?.({
      radiusMiles: zoneAware && !isDiscovery ? derivedServiceRadiusMiles() : radius,
      selectedCities: [...selected.values()],
      primaryCity,
    });
  }

  function setStatus(text, kind = '') {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = `muted small${kind ? ` ${kind}` : ''}`;
  }

  function statusLine() {
    const pagesBit = showPages ? ` · ${pageKeys().size} pages` : '';
    if (!primaryCity) {
      return isDiscovery
        ? 'Click an in-range city (Min–Max pop) to set the radius center'
        : 'Click a city to set the radius center';
    }
    if (centerOutsidePopRange()) {
      return zoneAware && !isDiscovery
        ? `Center outside Min–Max pop — raise Max or pick another center · ${selected.size} selected${pagesBit}`
        : `Center outside Min–Max pop — raise Max or pick another center · ${inRadiusKeys.size} in radius · ${selected.size} selected${pagesBit}`;
    }
    return zoneAware && !isDiscovery
      ? `${selected.size} selected${pagesBit}`
      : `${inRadiusKeys.size} in radius · ${selected.size} selected${pagesBit}`;
  }

  function notifyMapToast(message, tone = 'warn') {
    setStatus(message, 'err');
    window.dispatchEvent(new CustomEvent('rover-toast', { detail: { message, tone } }));
  }

  function derivedServiceRadiusMiles() {
    const pk = primaryKey();
    const distances = [];
    for (const [key, row] of selected) {
      if (pk && key === pk) continue;
      const d = leftoverDistance(row.name, key);
      if (Number.isFinite(d) && d < 1e6) distances.push(d);
    }
    return serviceRadiusMilesFromCoverage({ distances, fallback: DEFAULT_RADIUS });
  }

  function leftoverDistance(name, key) {
    const here = centerByKey.get(key);
    const self =
      zonePrimaryCenters.find(
        (p) => normalizePlaceName(p.city) === normalizePlaceName(primaryCity),
      ) ||
      (primaryCenter
        ? { lng: Number(primaryCenter[0]), lat: Number(primaryCenter[1]) }
        : null);
    if (!here || !self || !Number.isFinite(self.lng) || !Number.isFinite(self.lat)) {
      return Number.POSITIVE_INFINITY;
    }
    return milesLngLat(here[0], here[1], self.lng, self.lat);
  }

  function researchSeedMilesOk(name) {
    const key = placeKey(name, state);
    return withinMaxMiles(leftoverDistance(name, key), AUTO_SEED_MAX_MILES);
  }

  function refreshResearchSuggestedBlock() {
    if (zoneAware || isDiscovery) return;
    const host = controlsHost.querySelector(`#${uid}-suggested-pages`);
    if (!host) return;
    const next = suggestedLocationPagesBlockHtml(esc, {
      primaryCity,
      researchSuggested: researchSuggestedSuburbs,
      hostId: `${uid}-suggested-pages`,
      milesOk: researchSeedMilesOk,
    });
    host.outerHTML = next;
  }

  function ensurePagesSeeded() {
    if (!showPages || pagesSeeded || !primaryCity) return;
    if (zoneAware && zonePagesLocked) {
      pageKeySet = new Set();
      const pk = primaryKey();
      if (pk) pageKeySet.add(pk);
      const keepHits = [];
      for (const name of keepPageNames || []) {
        const hit = [...selected.values()].find(
          (r) => normalizePlaceName(r.name) === normalizePlaceName(name),
        );
        if (!hit) continue;
        const key = placeKey(hit.name, hit.state || state);
        if (isSiblingPlace(hit.name, key)) continue;
        keepHits.push(key);
        pageKeySet.add(key);
      }
      const honorSaved =
        (keepPageNames || []).length === 0 || keepHits.length > 0;
      if (honorSaved) {
        pagesSeeded = true;
        return;
      }
      /* Stale research-seed names are not on the map — fall through to leftover fill. */
    }
    if (
      zonePrimaryCenters.length &&
      [...selected.values()].some((r) => !centerByKey.has(placeKey(r.name, r.state || state)))
    ) {
      return;
    }
    pageKeySet = computePageKeys({
      selected,
      claudeOrder: zoneAware ? [] : claudeOrder,
      primaryCity,
      state,
      max: PREFER_MAX_SUBURBS,
      minPages: zoneAware ? PREFER_MIN_PAGES : 0,
      popByKey,
      blocked: pageBlockSet,
      skipFarther: zoneAware ? null : isFartherLeftover,
      keepNames: keepPageNames,
      ignoreClaudeOrder: zoneAware,
      sortBy: zoneAware ? 'distance' : 'population',
      distanceFn: leftoverDistance,
      maxMiles: AUTO_SEED_MAX_MILES,
    });
    pagesSeeded = true;
  }

  function syncPageKeysToSelection() {
    if (!showPages) return;
    ensurePagesSeeded();
    const pk = primaryKey();
    if (pk) pageKeySet.add(pk);
    for (const key of [...pageKeySet]) {
      if (pk && key === pk) continue;
      if (!selected.has(key)) pageKeySet.delete(key);
    }
  }

  function fillZonePages() {
    if (!showPages || !zoneAware) return;
    ensurePagesSeeded();
    const pk = primaryKey();
    if (pk) pageKeySet.add(pk);
    for (const key of [...pageKeySet]) {
      if (pk && key === pk) continue;
      if (!selected.has(key)) {
        pageKeySet.delete(key);
        pageOffKeys.delete(key);
      }
    }
    const leftovers = [...selected.entries()]
      .filter(([key, row]) => {
        if (pk && key === pk) return false;
        if (pageKeySet.has(key) || pageOffKeys.has(key)) return false;
        if (isSiblingPlace(row.name, key)) return false;
        if (isClaimedPlace(row.name, key)) return false;
        if (!withinMaxMiles(leftoverDistance(row.name, key), AUTO_SEED_MAX_MILES)) return false;
        return true;
      })
      .map(([key, row]) => ({ key, name: row.name, miles: leftoverDistance(row.name, key) }))
      .sort((a, b) => a.miles - b.miles);
    if (zonePagesLocked || operatorEditedCoverage) return;
    for (const row of leftovers) {
      if (pageKeySet.size >= PREFER_MAX_PAGES) break;
      pageKeySet.add(row.key);
    }
    if (pageKeySet.size >= PREFER_MIN_PAGES) return;
    const farLeftovers = [...selected.entries()]
      .filter(([key, row]) => {
        if (pk && key === pk) return false;
        if (pageKeySet.has(key) || pageOffKeys.has(key)) return false;
        if (isSiblingPlace(row.name, key)) return false;
        if (isClaimedPlace(row.name, key)) return false;
        return true;
      })
      .map(([key, row]) => ({ key, name: row.name, miles: leftoverDistance(row.name, key) }))
      .sort((a, b) => a.miles - b.miles);
    for (const row of farLeftovers) {
      if (pageKeySet.size >= PREFER_MAX_PAGES) break;
      pageKeySet.add(row.key);
    }
  }

  function pageKeys() {
    if (!showPages) return new Set();
    if (zoneAware) fillZonePages();
    else syncPageKeysToSelection();
    return new Set(pageKeySet);
  }

  function locationPageCitiesPayload() {
    const pages = pageKeys();
    const pk = primaryKey();
    const names = [];
    for (const [key, row] of selected) {
      if (!pages.has(key)) continue;
      if (pk && key === pk) continue;
      names.push(row.name);
    }
    return names;
  }

  function primaryKey() {
    return primaryCity ? placeKey(primaryCity, state) : '';
  }

  async function togglePageKey(key) {
    if (!showPages || !key) return;
    const pk = primaryKey();
    if (pk && key === pk) {
      setStatus('Primary city always gets a location page');
      return;
    }
    if (!selected.has(key)) return;
    if (pageKeySet.has(key)) {
      pageKeySet.delete(key);
      if (zoneAware) pageOffKeys.add(key);
    } else {
      if (pageKeySet.size >= PREFER_MAX_PAGES) {
        setStatus(
          `Already ${PREFER_MAX_PAGES} location pages — turn off Page on another city first (prefer 4–6)`,
          'err',
        );
        return;
      }
      const row = selected.get(key);
      const sibling = isSiblingPlace(row?.name, key);
      const alreadyClaimed = isClaimedPlace(row?.name, key);
      if (zoneAware && sibling) {
        notifyMapToast('Zone sibling cities cannot be location pages', 'warn');
        return;
      }
      if (needsPageOverride(row?.name, key)) {
        const ownerCity = claimedOwnerCity(row?.name);
        const ok = confirmPageOverride
          ? await confirmPageOverride({
              name: row?.name || key,
              reason: sibling ? 'sibling' : 'claimed',
              ownerCity,
            })
          : window.confirm(
              sibling
                ? `This city has its own Cluster site. Make a location page on this site anyway?`
                : `${ownerCity || 'Another Zone site'} already has a ${row?.name || 'this'} location page. Make one on this site anyway? That removes the page from ${ownerCity || 'the other site'}.`,
            );
        if (!ok) return;
      }
      pageKeySet.add(key);
      pageOffKeys.delete(key);
      setStatus(
        sibling
          ? `${row?.name || 'City'} location page overridden — this city has its own Cluster site`
          : alreadyClaimed
            ? `${row?.name || 'City'} location page stolen from ${claimedOwnerCity(row?.name) || 'the other Zone site'}`
            : statusLine(),
      );
    }
    const btn = listEl?.querySelector(`.sa-page-toggle[data-page-key="${CSS.escape(key)}"]`);
    if (btn) {
      btn.classList.add('is-busy');
      btn.setAttribute('aria-busy', 'true');
    }
    requestAnimationFrame(() => {
      refreshLabelForKey(key);
      renderList();
      setStatus(statusLine());
    });
  }

  /** Service area: primary always allowed. Discovery: Min/Max apply to center too. */
  function popInSelectRange(pop, { isPrimary = false } = {}) {
    if (isPrimary && !isDiscovery) return true;
    const v = Number(pop);
    if (!Number.isFinite(v)) return false;
    if (v < minPopFilter) return false;
    if (maxPopFilter != null && v > maxPopFilter) return false;
    return true;
  }

  function centerOutsidePopRange() {
    if (!isDiscovery || !primaryCity || !popByKey.size) return false;
    const pk = primaryKey();
    if (!popByKey.has(pk)) return true;
    return !popInSelectRange(popByKey.get(pk));
  }

  function pruneSelectedByPopRange() {
    const pk = primaryKey();
    // Keep center even when outside Min–Max (warn via statusLine); prune other OOR cities.
    for (const [key] of [...selected.entries()]) {
      if (pk && key === pk) continue;
      const pop = popByKey.get(key);
      if (!popInSelectRange(pop)) selected.delete(key);
    }
  }

  function scheduleInvalidateSize() {
    return new Promise((resolve) => {
      if (!map) {
        resolve();
        return;
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          map?.invalidateSize();
          setTimeout(() => {
            map?.invalidateSize();
            resolve();
          }, 120);
        });
      });
    });
  }

  function mapElHasSize() {
    return Boolean(mapEl && mapEl.clientWidth > 0 && mapEl.clientHeight > 0);
  }

  function waitForMapElSize(timeoutMs = 2000) {
    if (destroyed || mapElHasSize()) return Promise.resolve();
    return new Promise((resolve) => {
      const start = Date.now();
      let ro = null;
      function done() {
        if (ro) {
          try {
            ro.disconnect();
          } catch {
            /* ignore */
          }
          ro = null;
        }
        resolve();
      }
      function tick() {
        if (destroyed || mapElHasSize() || Date.now() - start >= timeoutMs) {
          done();
          return;
        }
        requestAnimationFrame(tick);
      }
      if (typeof ResizeObserver !== 'undefined' && mapEl) {
        ro = new ResizeObserver(() => {
          if (mapElHasSize()) done();
        });
        ro.observe(mapEl);
        if (mapHost && mapHost !== mapEl) ro.observe(mapHost);
      }
      requestAnimationFrame(tick);
    });
  }

  function sortIndicator(key) {
    if (listSort.key !== key) return '';
    return listSort.dir === 'asc' ? ' ↑' : ' ↓';
  }

  function compareSelectedRows(a, b, pk) {
    const aKey = placeKey(a.name, a.state);
    const bKey = placeKey(b.name, b.state);
    const ap = Boolean(pk) && aKey === pk;
    const bp = Boolean(pk) && bKey === pk;
    if (ap !== bp) return ap ? -1 : 1;

    const dir = listSort.dir === 'desc' ? -1 : 1;
    if (listSort.key === 'population') {
      const aPop = popByKey.has(aKey) ? Number(popByKey.get(aKey)) : null;
      const bPop = popByKey.has(bKey) ? Number(popByKey.get(bKey)) : null;
      const aOk = aPop != null && Number.isFinite(aPop);
      const bOk = bPop != null && Number.isFinite(bPop);
      // Missing pop: last when desc (high→low), first when asc (low→high)
      if (aOk !== bOk) {
        if (listSort.dir === 'desc') return aOk ? -1 : 1;
        return aOk ? 1 : -1;
      }
      if (aOk && bOk && aPop !== bPop) return (aPop - bPop) * dir;
      return a.name.localeCompare(b.name);
    }
    const byName = a.name.localeCompare(b.name);
    if (byName) return byName * dir;
    return String(a.state || '').localeCompare(String(b.state || '')) * dir;
  }

  function renderList() {
    const pages = pageKeys();
    const pk = primaryKey();
    const rows = [...selected.values()].sort((a, b) => compareSelectedRows(a, b, pk));
    if (countEl) countEl.textContent = `(${rows.length})`;
    let popSum = 0;
    for (const r of rows) {
      const n = Number(popByKey.get(placeKey(r.name, r.state)));
      if (Number.isFinite(n)) popSum += n;
    }
    if (popTotalEl) {
      popTotalEl.textContent = rows.length ? `Population ${Math.round(popSum).toLocaleString()}` : '';
    }
    if (!listEl) return;

    const pageN = pages.size;
    const pageLabel = `${pageN}/${PREFER_MAX_PAGES}`;
    const pageHead = showPages
      ? `<th class="sa-th-page" scope="col"><span class="sa-page-count" title="${esc(
          `${pageN} of ${PREFER_MAX_PAGES} location pages`,
        )}" aria-label="${esc(`${pageN} of ${PREFER_MAX_PAGES} location pages`)}">${esc(pageLabel)}</span></th>`
      : '';
    const body = rows
      .map((r) => {
        const key = placeKey(r.name, r.state);
        const isPrimary = Boolean(pk) && key === pk;
        const hasPage = showPages && pages.has(key);
        const pop = popByKey.get(key);
        const sibling = isSiblingPlace(r.name, key);
        const alreadyClaimed = isClaimedPlace(r.name, key);
        const ownerCity = claimedOwnerCity(r.name);
        const claimNote = `page on ${ownerCity || 'another site'}`;
        const rowNote = sibling
          ? ' · cluster site'
          : alreadyClaimed
            ? ` · ${claimNote}`
            : '';
        const rowTitle = isPrimary
          ? 'Primary center'
          : sibling
            ? zoneAware
              ? 'Zone sibling — coverage only, never a location page'
              : 'Cluster sibling — coverage OK, location page needs override'
            : alreadyClaimed
              ? `${ownerCity || 'Another Zone site'} already has a location page — Also serving only`
              : 'Remove from coverage';
        const pageDisabled = isPrimary || (zoneAware && sibling && !hasPage);
        const pageTitle = isPrimary
          ? 'Primary always has a page'
          : pageDisabled
            ? 'Zone sibling — coverage only, never a location page'
            : 'Toggle location page';
        const pageCell = showPages
          ? `<td class="sa-td-page"><button type="button" class="sa-page-toggle${hasPage ? ' is-on' : ''}" data-page-key="${esc(
              key,
            )}" ${pageDisabled ? `disabled title="${esc(pageTitle)}"` : `title="${esc(pageTitle)}"`}>${
              hasPage ? PAGE_ICON : 'Page'
            }</button></td>`
          : '';
        return `<tr class="sa-list-item${isPrimary ? ' is-primary' : ''}${hasPage ? ' has-page' : ''}${sibling ? ' sa-cluster-sibling' : ''}${alreadyClaimed ? ' sa-cluster-claimed' : ''}" data-key="${esc(key)}">
          ${pageCell}
          <td class="sa-td-city">
            <button type="button" class="sa-list-btn" ${isPrimary ? 'disabled' : ''} title="${esc(rowTitle)}">
              <span class="sa-list-name">${esc(r.name)}, ${esc(r.state)}${esc(rowNote)}</span>
              <span class="muted">${isPrimary ? 'center' : 'remove'}</span>
            </button>
          </td>
          <td class="sa-td-pop muted">${pop != null ? esc(fmtPop(pop)) : '—'}</td>
        </tr>`;
      })
      .join('');

    listEl.innerHTML = `
      <table class="sa-table">
        <thead>
          <tr>
            ${pageHead}
            <th scope="col">
              <button type="button" class="sa-sort-btn${listSort.key === 'name' ? ' is-active' : ''}" data-sort="name">City${sortIndicator(
                'name',
              )}</button>
            </th>
            <th scope="col" class="sa-th-pop">
              <button type="button" class="sa-sort-btn${listSort.key === 'population' ? ' is-active' : ''}" data-sort="population">Pop${sortIndicator(
                'population',
              )}</button>
            </th>
          </tr>
        </thead>
        <tbody>${body || `<tr><td colspan="${showPages ? 3 : 2}" class="muted" style="padding:0.5rem 0.6rem">None selected</td></tr>`}</tbody>
      </table>`;

    listEl.querySelectorAll('.sa-sort-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-sort') === 'population' ? 'population' : 'name';
        if (listSort.key === key) {
          listSort = { key, dir: listSort.dir === 'asc' ? 'desc' : 'asc' };
        } else {
          listSort = { key, dir: key === 'population' ? 'desc' : 'asc' };
        }
        renderList();
      });
    });
    listEl.querySelectorAll('.sa-page-toggle:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void togglePageKey(btn.getAttribute('data-page-key'));
      });
    });
    listEl.querySelectorAll('.sa-list-btn:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.closest('[data-key]')?.getAttribute('data-key');
        if (!key || key === primaryKey()) return;
        const name = selected.get(key)?.name || key;
        const hadPage = dropCoverage(key);
        renderList();
        refreshLabelForKey(key);
        styleLayers();
        setStatus(
          hadPage
            ? `Removed ${name} from coverage (location page dropped).`
            : `Removed ${name} from coverage.`,
        );
        emitSelection();
      });
    });
    renderZoneColumns(pages, pk);
  }

  function alsoServingKeys(pages) {
    const pageSet = pages || pageKeys();
    return new Set(
      nearestLeftoverKeys({
        pool: selected,
        pageKeys: pageSet,
        primaryKey: primaryKey(),
        leftoverDistance,
        cap: ALSO_SERVING_CAP,
        maxMiles: AUTO_SEED_MAX_MILES,
      }),
    );
  }

  function seedCoverageFromRadius() {
    if (isDiscovery || !showPages) return;
    pageKeys();
    applySeedCoverage({
      selected,
      radiusPool,
      pageKeySet,
      deselectedKeys,
      pinnedKeys,
      primaryKey: primaryKey(),
      primaryRow: primaryCity
        ? { name: primaryCity, state: String(state).toUpperCase() }
        : null,
      inRadiusKeys: zoneAware ? new Set() : inRadiusKeys,
      leftoverDistance,
      isLeftoverClaim,
      alsoServingCap: ALSO_SERVING_CAP,
      ignoreRadiusCircle: Boolean(zoneAware),
      maxMiles: AUTO_SEED_MAX_MILES,
    });
  }

  function fillZoneRadiusPool(places) {
    radiusPool.clear();
    for (const p of places || []) {
      const name = p?.name;
      if (!name) continue;
      const key = placeKey(name, p.state);
      if (isSiblingPlace(name, key)) continue;
      radiusPool.set(key, { name, state: p.state });
    }
  }

  function keepCoverage(name, st) {
    applyAddCoverage({
      selected,
      deselectedKeys,
      pinnedKeys,
      key: placeKey(name, st),
      row: { name, state: String(st || state).toUpperCase() },
    });
    operatorEditedCoverage = true;
  }

  function dropCoverage(key) {
    const { hadPage } = applyRemoveCoverage({
      selected,
      pageKeySet,
      pageOffKeys,
      deselectedKeys,
      pinnedKeys,
      key,
    });
    operatorEditedCoverage = true;
    return hadPage;
  }

  function renderZoneColumns(pages, pk) {
    if (!zoneAware || !pagesColEl || !servingColEl) return;
    const pageItems = [];
    const servingRows = [];
    const rows = [...selected.values()].sort((a, b) => compareSelectedRows(a, b, pk));
    for (const r of rows) {
      const key = placeKey(r.name, r.state);
      const isPrimary = Boolean(pk) && key === pk;
      const sibling = isSiblingPlace(r.name, key);
      const note = isPrimary
        ? ' <span class="muted">(primary)</span>'
        : sibling
          ? ' <span class="muted">cluster site</span>'
          : '';
      const item = `<li>${esc(r.name)}${note}</li>`;
      if (pages.has(key)) pageItems.push(item);
      else servingRows.push({ item, miles: leftoverDistance(r.name, key) });
    }
    servingRows.sort((a, b) => a.miles - b.miles);
    const shown = servingRows.slice(0, ALSO_SERVING_CAP).map((r) => r.item);
    pagesColEl.innerHTML = pageItems.join('') || '<li class="muted">Primary only</li>';
    servingColEl.innerHTML = shown.join('') || '<li class="muted">None</li>';
  }

  function hidePagePicker() {
    if (!pagePickerEl) return;
    pagePickerEl.hidden = true;
    pagePickerEl.classList.add('hidden');
    pagePickerEl.innerHTML = '';
  }

  function showPagePicker() {
    if (!pagePickerEl) return;
    const pk = primaryKey();
    const rows = [...selected.values()].sort((a, b) => a.name.localeCompare(b.name));
    const draft = new Set(pageKeys());
    pagePickerEl.hidden = false;
    pagePickerEl.classList.remove('hidden');
    pagePickerEl.innerHTML = `
      <div class="callout warn" style="margin-top:0.75rem">
        <p><strong>Pick up to ${PREFER_MAX_PAGES} location pages</strong> (prefer 4–6). Others stay on the map as coverage only.</p>
        <ul class="sa-page-picker-list" style="margin:0.5rem 0;max-height:12rem;overflow:auto">
          ${rows
            .map((r) => {
              const key = placeKey(r.name, r.state);
              const isPrimary = Boolean(pk) && key === pk;
              const checked = draft.has(key) ? 'checked' : '';
              return `<li><label style="display:flex;gap:0.4rem;align-items:center">
                <input type="checkbox" data-pick-key="${esc(key)}" ${checked} ${isPrimary ? 'disabled' : ''}/>
                <span>${esc(r.name)}, ${esc(r.state)}${isPrimary ? ' (primary)' : ''}</span>
              </label></li>`;
            })
            .join('')}
        </ul>
        <div class="narrative-actions">
          <button type="button" class="btn primary" id="${uid}-page-picker-confirm">Save with these pages</button>
          <button type="button" class="btn" id="${uid}-page-picker-cancel">Cancel</button>
        </div>
      </div>`;
    pagePickerEl.querySelector(`#${uid}-page-picker-cancel`)?.addEventListener('click', () => {
      hidePagePicker();
    });
    pagePickerEl.querySelector(`#${uid}-page-picker-confirm`)?.addEventListener('click', async () => {
      const next = new Set();
      if (pk) next.add(pk);
      pagePickerEl.querySelectorAll('input[data-pick-key]').forEach((input) => {
        if (input.checked) next.add(input.getAttribute('data-pick-key'));
      });
      if (next.size > PREFER_MAX_PAGES) {
        if (acceptStatus) {
          acceptStatus.textContent = `Select at most ${PREFER_MAX_PAGES} pages (including primary).`;
        }
        return;
      }
      if (next.size < 1) {
        if (acceptStatus) acceptStatus.textContent = 'Keep at least the primary city page.';
        return;
      }
      pageKeySet = next;
      pagesSeeded = true;
      hidePagePicker();
      renderList();
      refreshLabels();
      await doAccept();
    });
  }

  async function doAccept() {
    if (!onAccept) return;
    if (acceptBtn) acceptBtn.disabled = true;
    if (acceptStatus) acceptStatus.textContent = '';
    setSaveProgress(true, {
      label: 'Saving…',
      detail: 'Saving coverage + location pages…',
      current: 0,
      total: 0,
    });
    try {
      await onAccept(
        {
          radiusMiles: zoneAware ? derivedServiceRadiusMiles() : radius,
          selectedCities: [...selected.values()],
          primaryCity,
          locationPageCities: locationPageCitiesPayload(),
          clusterLocationPageOverrides: [...selected.values()]
            .filter((row) => {
              const key = placeKey(row.name, row.state);
              return pageKeys().has(key) && needsPageOverride(row.name, key);
            })
            .map((row) => row.name),
        },
        {
          onProgress: (p) => {
            setSaveProgress(true, {
              label: p.label || 'Saving…',
              detail: p.detail || p.label || 'Working…',
              current: p.current,
              total: p.total,
            });
          },
        },
      );
      setSaveProgress(false);
      if (acceptStatus) acceptStatus.textContent = 'Saved coverage + location pages.';
    } catch (e) {
      setSaveProgress(true, {
        label: 'Save failed',
        detail: e.message || String(e),
        current: 0,
        total: 0,
      });
      if (acceptStatus) acceptStatus.textContent = e.message || String(e);
    } finally {
      if (acceptBtn) acceptBtn.disabled = false;
    }
  }

  function bindPlaceLabel(layer, pages) {
    const p = layer.feature?.properties || {};
    if (layer.getTooltip()) layer.unbindTooltip();
    if (!isLargestPart(layer.feature) || isSliverPart(layer.feature)) return;

    const key = placeKey(p.name, p.state);
    const primary = Boolean(primaryKey()) && key === primaryKey();
    const selectable = popInSelectRange(p.population, { isPrimary: primary });
    const html = labelHtml(esc, p.name, p.population, {
      hasPage: showPages && pages.has(key),
      star: primary,
    });
    const hasPage = showPages && pages.has(key);
    const on = selected.has(key);
    const sibling = zoneAware && isSiblingPlace(p.name, key);
    const leftoverClaim = zoneAware && isLeftoverClaim(p.name, key) && !on;
    const leftoverServing =
      (zoneAware && !sibling && !leftoverClaim && alsoServingKeys(pages).has(key)) ||
      (zoneAware && on && !sibling && !primary);
    const dim = isDiscovery && !selectable;
    const zoneMute =
      leftoverClaim || (zoneAware && !on && !hasPage && !leftoverServing && !primary && !sibling);
    const className = leftoverClaim
      ? 'sa-place-label sa-place-label-dim sa-place-label-claimed'
      : dim || zoneMute
        ? 'sa-place-label sa-place-label-dim'
        : zoneAware && hasPage && !sibling
          ? 'sa-place-label sa-place-label-page'
          : zoneAware && leftoverServing
            ? 'sa-place-label sa-place-label-serving'
            : 'sa-place-label';
    layer.bindTooltip(html, {
      permanent: true,
      direction: 'center',
      className,
      opacity: dim || zoneMute ? 0.85 : 0.95,
    });
  }

  function refreshLabels() {
    if (!placesLayer) return;
    const pages = pageKeys();
    placesLayer.eachLayer((layer) => bindPlaceLabel(layer, pages));
  }

  function refreshLabelForKey(targetKey) {
    if (!placesLayer || !targetKey) return;
    const pages = pageKeys();
    placesLayer.eachLayer((layer) => {
      const p = layer.feature?.properties || {};
      if (placeKey(p.name, p.state) !== targetKey) return;
      bindPlaceLabel(layer, pages);
    });
  }

  function setRadiusBusy(on, message) {
    mapEl?.classList.toggle('is-busy', Boolean(on));
    if (on && message) setStatus(message);
  }

  function styleForProps(p, pages) {
    if (isSliverPart({ properties: p })) {
      return {
        color: '#94a3b8',
        weight: 1,
        dashArray: '4 3',
        fillColor: '#cbd5e1',
        fillOpacity: 0,
        fillRule: 'nonzero',
        interactive: false,
      };
    }
    const key = placeKey(p.name, p.state);
    const primary = Boolean(primaryKey()) && key === primaryKey();
    const on = selected.has(key);
    const inR = inRadiusKeys.has(key);
    const selectable = popInSelectRange(p.population, { isPrimary: primary });
    const hasPage = Boolean(pages?.has(key));
    const sibling = zoneAware && isSiblingPlace(p.name, key);
    const leftoverClaim = zoneAware && isLeftoverClaim(p.name, key) && !on;
    const leftoverServing =
      (zoneAware && !sibling && !leftoverClaim && alsoServingKeys(pages).has(key)) ||
      (zoneAware && on && !sibling && !primary);
    let style;
    if (primary) {
      const fill = clusterColor(currentClusterKey) || '#14b8a6';
      style = { color: fill, weight: 2.5, fillColor: fill, fillOpacity: 0.55, fillRule: 'nonzero' };
    } else if (sibling) {
      const fill = siblingFill(p.name) || '#7c3aed';
      style = {
        color: fill,
        weight: on ? 2 : 1.4,
        fillColor: fill,
        fillOpacity: on ? 0.45 : 0.28,
        fillRule: 'nonzero',
      };
    } else if (leftoverClaim) {
      style = {
        color: '#94a3b8',
        weight: 1.4,
        dashArray: '5 4',
        fillColor: '#cbd5e1',
        fillOpacity: 0.12,
        fillRule: 'nonzero',
        className: 'sa-place-leftover-page',
      };
    } else if (zoneAware && on) {
      style = { color: '#64748b', weight: 1.3, fillColor: '#94a3b8', fillOpacity: 0.16, fillRule: 'nonzero' };
    } else if (!selectable) {
      style = { color: '#94a3b8', weight: 1.2, fillColor: '#cbd5e1', fillOpacity: 0.18, fillRule: 'nonzero' };
    } else if (on) {
      style = { color: '#1d4ed8', weight: 2.25, fillColor: '#3b82f6', fillOpacity: 0.48, fillRule: 'nonzero' };
    } else if (inR) {
      style = { color: '#475569', weight: 1.6, fillColor: '#94a3b8', fillOpacity: 0.32, fillRule: 'nonzero' };
    } else {
      style = { color: '#2563eb', weight: 1.6, fillColor: '#93c5fd', fillOpacity: 0.28, fillRule: 'nonzero' };
    }
    const emphasis = leftoverClaim
      ? null
      : serviceAreaEmphasisOutline({
          isSibling: sibling,
          isCurrentClusterSibling: isCurrentClusterSibling(p.name),
          isPrimary: primary,
          hasPage: showPages && hasPage,
          leftoverServing,
          siblingAlsoServing: sibling && on,
          isSelected: on,
        });
    if (emphasis) style = { ...style, color: emphasis.color, weight: emphasis.weight };
    return style;
  }

  function styleLayers() {
    if (!placesLayer) return;
    const pages = pageKeys();
    placesLayer.eachLayer((layer) => {
      const p = layer.feature?.properties || {};
      layer.setStyle(styleForProps(p, pages));
    });
  }

  function existingPlaceKeys() {
    const keys = new Set();
    if (!placesLayer) return keys;
    placesLayer.eachLayer((layer) => {
      const p = layer.feature?.properties || {};
      if (p.name) keys.add(placeKey(p.name, p.state));
    });
    return keys;
  }

  function onPlaceClick(feature) {
    const p = feature?.properties || {};
    togglePlace(p.name, p.state).catch((e) => setStatus(e.message || String(e), 'err'));
  }

  function hoverPlaceHint(feature) {
    if (isDiscovery || mapEl?.classList.contains('is-busy')) return;
    const p = feature?.properties || {};
    const key = placeKey(p.name, p.state);
    const primary = Boolean(primaryKey()) && key === primaryKey();
    if (isLeftoverClaim(p.name, key) && !selected.has(key)) {
      setStatus(leftoverPageClaimHint(p.name));
      return;
    }
    if (!primary && !popInSelectRange(p.population, { isPrimary: primary })) {
      setStatus('Outside Min–Max pop — not selectable', 'err');
      return;
    }
    if (
      !zoneAware &&
      !primary &&
      primaryCity &&
      inRadiusKeys.size &&
      !inRadiusKeys.has(key) &&
      !selected.has(key)
    ) {
      setStatus('Outside the radius — increase Radius to include this city', 'err');
      return;
    }
    setStatus(
      coverageClickHint({
        name: p.name,
        isPrimary: primary,
        isSelected: selected.has(key),
        hasPage: showPages && pageKeySet.has(key),
      }),
    );
  }

  function bindPlaceInteractions(feature, layer) {
    if (isSliverPart(feature)) {
      layer.options.interactive = false;
      return;
    }
    layer.on('click', () => onPlaceClick(feature));
    if (isDiscovery) return;
    layer.on('mouseover', () => hoverPlaceHint(feature));
    layer.on('mouseout', () => {
      if (mapEl?.classList.contains('is-busy')) return;
      setStatus(statusLine());
    });
  }

  /** Add in-radius places from other states (coverage-preview already includes them). */
  function mergeInRadiusFeatures(features) {
    if (!placesLayer || !Array.isArray(features) || !features.length) return;
    const have = existingPlaceKeys();
    const toAdd = [];
    for (const f of features) {
      const p = f?.properties || {};
      const key = placeKey(p.name, p.state);
      if (!p.name || have.has(key)) continue;
      have.add(key);
      popByKey.set(key, Number(p.population) || 0);
      rememberFeatureCenter(f);
      toAdd.push(f);
    }
    if (!toAdd.length) return;
    const exploded = explodeAndSortPlaceFeatures({ type: 'FeatureCollection', features: toAdd });
    placesLayer.addData(exploded);
  }

  /**
   * Sync selection to the circle: add all in-radius, drop outside (keep center).
   */
  function syncSelectionToRadius(places) {
    const pk = primaryKey();
    radiusPool.clear();
    for (const p of places || []) {
      const key = placeKey(p.name, p.state);
      const row = { name: p.name, state: p.state };
      radiusPool.set(key, row);
      selected.set(key, row);
    }
    for (const key of [...selected.keys()]) {
      if (pk && key === pk) continue;
      if (!inRadiusKeys.has(key)) selected.delete(key);
    }
    if (primaryCity) {
      selected.set(pk, {
        name: primaryCity,
        state: String(state).toUpperCase(),
      });
    }
    seededFromRadius = true;
  }

  async function togglePlace(name, st) {
    const key = placeKey(name, st);
    const pop = popByKey.get(key);

    // Discovery / unset center: first click sets radius center when none yet.
    if (!primaryCity) {
      if (!popInSelectRange(pop)) {
        setStatus('Outside Min–Max pop — pick an in-range city as center', 'err');
        return;
      }
      primaryCity = String(name || '').trim();
      selected.set(placeKey(primaryCity, state), {
        name: primaryCity,
        state: String(state).toUpperCase(),
      });
      seededFromRadius = false;
      try {
        setRadiusBusy(true, 'Updating cities…');
        await refreshRadiusMembership({ fit: true });
      } catch (e) {
        setStatus(e.message || String(e), 'err');
      } finally {
        setRadiusBusy(false);
      }
      emitSelection();
      return;
    }

    if (key === primaryKey()) {
      setStatus(`${name} is the primary center`);
      return;
    }
    if (selected.has(key)) {
      if (isDiscovery) {
        selected.delete(key);
        setStatus(`Removed ${name}`);
      } else {
        const hadPage = dropCoverage(key);
        setStatus(
          hadPage
            ? `Removed ${name} from coverage (location page dropped).`
            : `Removed ${name} from coverage.`,
        );
      }
    } else {
      if (!popInSelectRange(pop)) {
        setStatus('Outside Min–Max pop — not selectable', 'err');
        return;
      }
      if (!isDiscovery && !zoneAware && inRadiusKeys.size && !inRadiusKeys.has(key)) {
        setStatus('Outside the radius — increase Radius to include this city', 'err');
        return;
      }
      if (isDiscovery) {
        selected.set(key, { name, state: String(st || state).toUpperCase() });
        setStatus(`Added ${name}`);
      } else {
        keepCoverage(name, st);
        setStatus(
          isSiblingPlace(name, key)
            ? siblingAlsoServingAddedStatus({ name })
            : isLeftoverClaim(name, key)
              ? leftoverAlsoServingAddedStatus({
                  name,
                  ownerCity: claimedOwnerCity(name),
                })
              : `Added ${name} to coverage. Use Page to give it a location page.`,
        );
      }
    }
    renderList();
    styleLayers();
    refreshLabelForKey(key);
    emitSelection();
  }

  async function refreshRadiusMembership({ fit = false } = {}) {
    if (destroyed) return;
    if (!primaryCity) {
      inRadiusKeys = new Set();
      if (circleLayer && map) {
        map.removeLayer(circleLayer);
        circleLayer = null;
      }
      styleLayers();
      renderList();
      refreshLabels();
      setStatus(statusLine());
      return;
    }

    setRadiusBusy(true, 'Updating cities…');
    try {
      const previewMiles = zoneAware && !isDiscovery ? LABEL_LOAD_RADIUS : radius;
      const qs = new URLSearchParams({
        city: primaryCity,
        state,
        radiusMiles: String(previewMiles),
        minPop: String(minPopFilter),
      });
      if (maxPopFilter != null) qs.set('maxPop', String(maxPopFilter));
      const data = await api(`/api/map/coverage-preview?${qs.toString()}`);
      if (destroyed) return;
      inRadiusKeys = new Set((data.places || []).map((p) => placeKey(p.name, p.state)));
      primaryCenter = data.primary?.center || null;
      mergeInRadiusFeatures(data.features || []);

      if (zoneAware && !isDiscovery) {
        fillZoneRadiusPool(data.places || []);
        if (zonePagesLocked) {
          const pk = primaryKey();
          for (const key of selected.keys()) {
            if (pk && key === pk) continue;
            pinnedKeys.add(key);
          }
        }
      } else {
        // Forever: add in-circle + drop outside (center sticky) on every refresh.
        syncSelectionToRadius(data.places || []);
      }
      pruneSelectedByPopRange();
      seedCoverageFromRadius();
      refreshResearchSuggestedBlock();
      if (!primaryCity) {
        styleLayers();
        renderList();
        refreshLabels();
        setStatus(
          isDiscovery
            ? 'Click an in-range city (Min–Max pop) to set the radius center'
            : 'Click a city to set the radius center',
          isDiscovery ? 'err' : '',
        );
        emitSelection();
        return;
      }

      const L = await ensureLeaflet();
      if (map && primaryCenter && Array.isArray(primaryCenter) && primaryCenter.length === 2) {
        const [lng, lat] = primaryCenter;
        if (circleLayer) {
          map.removeLayer(circleLayer);
          circleLayer = null;
        }
        if (!(zoneAware && !isDiscovery)) {
          circleLayer = L.circle([lat, lng], {
            radius: radius * 1609.34,
            color: '#0f766e',
            weight: 2,
            fillColor: '#14b8a6',
            fillOpacity: 0.07,
            interactive: false,
          }).addTo(map);
        }
        if ((fit || !didFit) && map) {
          if (circleLayer) {
            map.fitBounds(circleLayer.getBounds().pad(0.2));
          } else {
            const pts = [];
            for (const [key] of selected) {
              const c = centerByKey.get(key);
              if (c) pts.push([c[1], c[0]]);
            }
            if (pts.length >= 2) map.fitBounds(L.latLngBounds(pts).pad(0.25));
            else map.setView([lat, lng], 10);
          }
          didFit = true;
          await scheduleInvalidateSize();
        }
      }

      styleLayers();
      renderList();
      refreshLabels();
      setStatus(statusLine(), centerOutsidePopRange() ? 'err' : '');
      emitSelection();
    } finally {
      if (!destroyed) setRadiusBusy(false);
    }
  }

  async function ensureMap(L, centerLatLng) {
    if (map) return;
    await waitForMapElSize();
    if (destroyed || !mapEl) return;
    const center = centerLatLng || [39.83, -98.58];
    map = L.map(mapEl, { scrollWheelZoom: true }).setView(center, 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 18,
    }).addTo(map);
    map.on('zoomend', () => {
      void scheduleInvalidateSize();
    });
    onWindowResize = () => {
      void scheduleInvalidateSize();
    };
    window.addEventListener('resize', onWindowResize);
    if (typeof ResizeObserver !== 'undefined' && mapEl) {
      resizeObserver = new ResizeObserver(() => {
        void scheduleInvalidateSize();
      });
      resizeObserver.observe(mapEl);
      if (mapHost && mapHost !== mapEl) resizeObserver.observe(mapHost);
    }
    await scheduleInvalidateSize();
  }

  function applyPlacesGeo(L, geo) {
    popByKey = new Map();
    for (const f of geo.features || []) {
      const p = f.properties || {};
      popByKey.set(placeKey(p.name, p.state), Number(p.population) || 0);
      rememberFeatureCenter(f);
    }
    if (isDiscovery) {
      const pk = primaryCity ? placeKey(primaryCity, state) : '';
      for (const [key] of [...selected.entries()]) {
        if (pk && key === pk) continue;
        if (!popInSelectRange(popByKey.get(key))) selected.delete(key);
      }
    }
    if (!map) return;
    if (placesLayer) {
      map.removeLayer(placesLayer);
      placesLayer = null;
    }
    placesLayer = L.geoJSON(explodeAndSortPlaceFeatures(geo), {
      style: (feature) => styleForProps(feature?.properties || {}, pageKeys()),
      onEachFeature: (feature, layer) => {
        bindPlaceInteractions(feature, layer);
      },
    }).addTo(map);
  }

  async function loadNearbyMap() {
    if (destroyed) return;
    setStatus('Loading places…');
    const L = await ensureLeaflet();

    if (!primaryCity) {
      await ensureMap(L);
      renderList();
      setStatus(
        isDiscovery
          ? 'Type a city first, then reopen the map.'
          : 'Click a city to set the radius center',
      );
      await scheduleInvalidateSize();
      return;
    }

    const qs = new URLSearchParams({
      city: primaryCity,
      state,
      radiusMiles: String(LABEL_LOAD_RADIUS),
      minPop: '0',
    });
    const data = await api(`/api/map/coverage-preview?${qs.toString()}`);
    if (destroyed) return;
    const geo = { type: 'FeatureCollection', features: data.features || [] };
    if (data.primary?.center && Array.isArray(data.primary.center) && data.primary.center.length === 2) {
      primaryCenter = data.primary.center;
    }
    const centerLatLng = primaryCenter
      ? [primaryCenter[1], primaryCenter[0]]
      : null;
    await ensureMap(L, centerLatLng);
    applyPlacesGeo(L, geo);
    await refreshRadiusMembership({ fit: true });
    await scheduleInvalidateSize();
  }

  function applyPopRange({ minPop, maxPop } = {}) {
    if (Number.isFinite(Number(minPop))) minPopFilter = Number(minPop);
    if (maxPop === null) maxPopFilter = null;
    else if (Number.isFinite(Number(maxPop))) maxPopFilter = Number(maxPop);
    pruneSelectedByPopRange();
    if (!primaryCity) {
      styleLayers();
      renderList();
      refreshLabels();
      setStatus(
        isDiscovery
          ? 'Click an in-range city (Min–Max pop) to set the radius center'
          : 'Click a city to set the radius center',
        isDiscovery ? 'err' : '',
      );
      emitSelection();
      return Promise.resolve();
    }
    return refreshRadiusMembership({ fit: false });
  }

  function readPopInputs() {
    const minRaw = String(minPopEl?.value ?? '').trim();
    const maxRaw = String(maxPopEl?.value ?? '').trim();
    const minPop = minRaw === '' ? 0 : Number(minRaw);
    const maxPop = maxRaw === '' ? null : Number(maxRaw);
    return {
      minPop: Number.isFinite(minPop) ? minPop : 0,
      maxPop: maxPop != null && Number.isFinite(maxPop) ? maxPop : null,
    };
  }

  slider?.addEventListener('input', () => {
    radius = Number(slider.value) || DEFAULT_RADIUS;
    if (radiusVal) radiusVal.textContent = String(radius);
    if (!primaryCity) {
      setStatus('Click a city to set the radius center');
      return;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      refreshRadiusMembership({ fit: false }).catch((e) => setStatus(e.message || String(e), 'err'));
    }, 280);
  });

  function onPopInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      applyPopRange(readPopInputs()).catch((e) => setStatus(e.message || String(e), 'err'));
    }, 280);
  }
  minPopEl?.addEventListener('input', onPopInput);
  maxPopEl?.addEventListener('input', onPopInput);

  acceptBtn?.addEventListener('click', async () => {
    if (!onAccept) return;
    syncPageKeysToSelection();
    if (showPages && pageKeys().size > PREFER_MAX_PAGES) {
      if (acceptStatus) {
        acceptStatus.textContent = `Too many location pages (${pageKeys().size}). Pick up to ${PREFER_MAX_PAGES} below.`;
      }
      showPagePicker();
      return;
    }
    hidePagePicker();
    await doAccept();
  });

  try {
    await ensureLeaflet();
    await loadNearbyMap();
  } catch (e) {
    setStatus(e.message || String(e), 'err');
  }

  return {
    destroy() {
      destroyed = true;
      clearTimeout(debounceTimer);
      if (resizeObserver) {
        try {
          resizeObserver.disconnect();
        } catch {
          /* ignore */
        }
        resizeObserver = null;
      }
      if (onWindowResize) {
        window.removeEventListener('resize', onWindowResize);
        onWindowResize = null;
      }
      if (map) {
        map.remove();
        map = null;
      }
      mapHost.innerHTML = '';
      controlsHost.innerHTML = '';
    },
    invalidateSize() {
      return scheduleInvalidateSize();
    },
    /** Live-update Min/Max pop while map is open. */
    setPopRange(opts) {
      return applyPopRange(opts);
    },
    /** Patch Zone leftover claims without remounting (other Rover tab Accept). */
    applyClaims({ claimedPlaceKeys = [], claimedBy = {}, claimedKinds = {} } = {}) {
      claimed.clear();
      for (const alias of placeNameKeySet(claimedPlaceKeys)) claimed.add(alias);
      claimedOwner.clear();
      claimedKind.clear();
      for (const [k, v] of Object.entries(claimedKinds || {})) {
        setPlaceNameAliases(claimedKind, k, String(v || 'page'));
      }
      for (const [k, v] of Object.entries(claimedBy || {})) {
        setPlaceNameAliases(claimedOwner, k, String(v || ''));
      }
      pageBlockSet.clear();
      for (const key of blocked) pageBlockSet.add(key);
      for (const key of claimed) pageBlockSet.add(key);
      seedCoverageFromRadius();
      styleLayers();
      refreshLabels();
      renderList();
      renderZoneColumns(pageKeys(), primaryKey());
      emitSelection();
    },
  };
}

/** Website — Service area step. */
export async function mountServiceAreaMap(opts) {
  return mountGeoSelectMap({ ...opts, variant: 'service-area' });
}

/** Discovery Pack — city multi-select into Cities field. */
export async function mountDiscoveryCitiesMap(opts) {
  return mountGeoSelectMap({ ...opts, variant: 'discovery' });
}

/** Show/hide candidate table vs service-area map canvas. */
export function setServiceAreaTableMode(on) {
  const layout = document.getElementById('view-candidates');
  const panel = document.querySelector('.candidates-table-panel');
  const wrap = document.querySelector('.candidates-table-wrap');
  const canvas = document.getElementById('sa-map-canvas');
  const filters = document.querySelector('.candidate-filters');
  const legend = document.getElementById('candidate-source-legend');
  const stageRail = document.getElementById('stage-rail');
  if (layout) layout.classList.toggle('sa-map-open', Boolean(on));
  if (panel) panel.classList.toggle('sa-table-mode', Boolean(on));
  if (wrap) wrap.classList.toggle('hidden', Boolean(on));
  if (canvas) canvas.classList.toggle('hidden', !on);
  if (filters) filters.classList.toggle('hidden', Boolean(on));
  if (legend) legend.classList.toggle('hidden', Boolean(on));
  if (stageRail) stageRail.classList.toggle('hidden', Boolean(on));
}

/** Show/hide discovery batch table vs pack cities map canvas. */
export function setDiscoveryTableMapMode(on) {
  const panel = document.querySelector('.discovery-table-panel');
  const wrap = document.querySelector('.discovery-table-wrap');
  const canvas = document.getElementById('discovery-map-canvas');
  const filters = document.getElementById('discovery-table-filters');
  const legend = document.getElementById('discovery-source-legend');
  const steps = document.getElementById('discovery-steps');
  const head = panel?.querySelector('.panel-head');
  const shotgunOn =
    Boolean(panel?.classList.contains('shotgun-hub-on')) ||
    Boolean(canvas?.closest('#discovery-shotgun-map-slot'));
  if (panel) panel.classList.toggle('disc-map-mode', Boolean(on));
  if (wrap) wrap.classList.toggle('hidden', Boolean(on));
  if (canvas && !(shotgunOn && !on)) {
    canvas.classList.toggle('hidden', !on);
    if (on) canvas.classList.remove('shotgun-map-off');
  }
  if (filters) filters.classList.toggle('hidden', Boolean(on));
  if (legend) legend.classList.toggle('hidden', Boolean(on));
  if (steps) steps.classList.toggle('hidden', Boolean(on));
  if (head) head.classList.toggle('hidden', Boolean(on));
}
