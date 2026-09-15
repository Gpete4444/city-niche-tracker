/**
 * Shared radius + click multi-select map.
 * - Service area (Website Track): page icons + Accept
 * - Discovery pack: sync city names into pack Cities field
 *
 * Map host = table panel slot; controls host = form / step body.
 */

import { explodePlaceFeatures, isLargestPart } from './map-polygons.js?v=20260902mapFill';

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
  return String(name || '')
    .toLowerCase()
    .replace(/\s+(city|town|village|borough|municipality|cdp|urban county)\s*$/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Prefer ≤6 location pages total (primary + suburbs). Hard suburb fill max still 8 elsewhere. */
const PREFER_MAX_PAGES = 6;
const PREFER_MAX_SUBURBS = PREFER_MAX_PAGES - 1;
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

/**
 * Claude-first page pick (mirrors ops/lib/geo-neighbors mergeLocationPages).
 * @returns {Set<string>} placeKeys including primary
 */
function computePageKeys({ selected, claudeOrder, primaryCity, state, max = 8, popByKey, blocked = new Set() }) {
  const st = String(state || '').trim().toUpperCase();
  const primaryNorm = normalizePlaceName(primaryCity);
  const keys = new Set();
  if (primaryCity) keys.add(placeKey(primaryCity, st));

  const cov = [...selected.values()].filter(
    (r) => normalizePlaceName(r.name) !== primaryNorm,
  );
  const used = new Set();
  const out = [];

  const push = (label) => {
    const n = String(label || '').trim();
    if (!n || normalizePlaceName(n) === primaryNorm) return;
    const hit = cov.find((r) => normalizePlaceName(r.name) === normalizePlaceName(n));
    if (!hit) return;
    const k = placeKey(hit.name, hit.state || st);
    if (blocked.has(k) || blocked.has(normalizePlaceName(hit.name))) return;
    if (used.has(k)) return;
    used.add(k);
    out.push(k);
  };

  for (const c of claudeOrder || []) {
    if (out.length >= max) break;
    push(c);
  }

  const rest = cov
    .filter((r) => !used.has(placeKey(r.name, r.state || st)))
    .map((r) => ({
      key: placeKey(r.name, r.state || st),
      pop: popByKey.get(placeKey(r.name, r.state || st)) || 0,
    }))
    .sort((a, b) => b.pop - a.pop);

  for (const r of rest) {
    if (out.length >= max) break;
    if (blocked.has(r.key)) continue;
    used.add(r.key);
    out.push(r.key);
  }

  for (const k of out) keys.add(k);
  return keys;
}

function labelHtml(esc, name, pop, { hasPage = false } = {}) {
  const icon = hasPage ? `${PAGE_ICON} ` : '';
  return `${icon}<span class="sa-label-name">${esc(name)}</span> <span class="sa-label-pop">${esc(fmtPop(pop))}</span>`;
}

/** Primary + research suggestedSuburbs only. */
function suggestedLocationPagesBlockHtml(esc, { primaryCity, researchSuggested }) {
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
    .filter(Boolean);
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

  return `<div class="sa-suggested-pages">
    <h4 class="sa-list-title">Suggested location pages <span class="muted">(research seed)</span></h4>
    ${pages.length ? `<ul class="sa-suggested-pages-list">${items}</ul>` : ''}
    ${emptySeedNote}
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
    confirmPageOverride = null,
    onAccept,
    onSelectionChange,
  } = opts;

  if (!mapHost || !controlsHost) return { destroy() {} };

  const isDiscovery = variant === 'discovery';
  const showPages = !isDiscovery;
  const uid = `gs-${Math.random().toString(36).slice(2, 9)}`;

  let minPopFilter = Number.isFinite(Number(initialMinPop))
    ? Number(initialMinPop)
    : isDiscovery
      ? 70000
      : 5000;
  let maxPopFilter =
    initialMaxPop != null && Number.isFinite(Number(initialMaxPop))
      ? Number(initialMaxPop)
      : isDiscovery
        ? 200000
        : null;

  const blocked = new Set(
    (blockedPlaceKeys || []).map((k) => String(k || '').toLowerCase()),
  );

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
  let didFit = false;
  /** @type {ResizeObserver | null} */
  let resizeObserver = null;
  /** @type {(() => void) | null} */
  let onWindowResize = null;
  /** @type {{ key: 'name' | 'population', dir: 'asc' | 'desc' }} */
  let listSort = { key: 'name', dir: 'asc' };

  const helpText = isDiscovery
    ? 'Click an in-range city (Min–Max pop) as center. Radius adds/drops in-range cities.'
    : 'Coverage = map selection. Blue page icon = SEO location page (prefer 4–6 including primary). Use Page to toggle pages without removing coverage.';

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
    ? suggestedLocationPagesBlockHtml(esc, {
        primaryCity,
        researchSuggested: researchSuggestedSuburbs,
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

  mapHost.innerHTML = `<div id="${uid}-map" class="sa-map-canvas" role="application" aria-label="${
    isDiscovery ? 'Discovery cities map' : 'Service area map'
  }"></div>`;
  controlsHost.innerHTML = `
    <div class="sa-controls">
      <div class="sa-radius-label">
        <label class="sa-radius-field">
          Radius <strong id="${uid}-radius-val">${esc(String(radius))}</strong> mi
          <input id="${uid}-radius" type="range" min="${SLIDER_MIN}" max="${SLIDER_MAX}" step="1" value="${esc(String(radius))}" />
        </label>
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
  const mapEl = mapHost.querySelector(`#${uid}-map`);

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
      radiusMiles: radius,
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
      return `Center outside Min–Max pop — raise Max or pick another center · ${inRadiusKeys.size} in radius · ${selected.size} selected${pagesBit}`;
    }
    return `${inRadiusKeys.size} in radius · ${selected.size} selected${pagesBit}`;
  }

  function ensurePagesSeeded() {
    if (!showPages || pagesSeeded || !primaryCity) return;
    pageKeySet = computePageKeys({
      selected,
      claudeOrder,
      primaryCity,
      state,
      max: PREFER_MAX_SUBURBS,
      popByKey,
      blocked,
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

  function pageKeys() {
    if (!showPages) return new Set();
    syncPageKeysToSelection();
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
    } else {
      if (pageKeySet.size >= PREFER_MAX_PAGES) {
        setStatus(
          `Already ${PREFER_MAX_PAGES} location pages — turn off Page on another city first (prefer 4–6)`,
          'err',
        );
        return;
      }
      const row = selected.get(key);
      const sibling = blocked.has(key) || blocked.has(normalizePlaceName(row?.name));
      if (sibling) {
        const ok = confirmPageOverride
          ? await confirmPageOverride(row?.name || key)
          : window.confirm(
              `This city has its own Cluster site. Make a location page on this site anyway?`,
            );
        if (!ok) return;
      }
      pageKeySet.add(key);
      setStatus(
        sibling
          ? `${row?.name || 'City'} location page overridden — this city has its own Cluster site`
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
        const sibling = blocked.has(key) || blocked.has(normalizePlaceName(r.name));
        const pageCell = showPages
          ? `<td class="sa-td-page"><button type="button" class="sa-page-toggle${hasPage ? ' is-on' : ''}" data-page-key="${esc(
              key,
            )}" ${isPrimary ? 'disabled title="Primary always has a page"' : 'title="Toggle location page"'}>${
              hasPage ? PAGE_ICON : 'Page'
            }</button></td>`
          : '';
        return `<tr class="sa-list-item${isPrimary ? ' is-primary' : ''}${hasPage ? ' has-page' : ''}${sibling ? ' sa-cluster-sibling' : ''}" data-key="${esc(key)}">
          ${pageCell}
          <td class="sa-td-city">
            <button type="button" class="sa-list-btn" ${isPrimary ? 'disabled' : ''} title="${
              isPrimary ? 'Primary center' : sibling ? 'Cluster sibling — coverage OK, location page needs override' : 'Remove from coverage'
            }">
              <span class="sa-list-name">${esc(r.name)}, ${esc(r.state)}${sibling ? ' · cluster site' : ''}</span>
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
        selected.delete(key);
        pageKeySet.delete(key);
        renderList();
        refreshLabelForKey(key);
        styleLayers();
        setStatus(statusLine());
        emitSelection();
      });
    });
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
          radiusMiles: radius,
          selectedCities: [...selected.values()],
          primaryCity,
          locationPageCities: locationPageCitiesPayload(),
          clusterLocationPageOverrides: [...selected.values()]
            .filter((row) => {
              const key = placeKey(row.name, row.state);
              return (
                pageKeys().has(key) &&
                (blocked.has(key) || blocked.has(normalizePlaceName(row.name)))
              );
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
    if (!isLargestPart(layer.feature)) return;

    const key = placeKey(p.name, p.state);
    const primary = Boolean(primaryKey()) && key === primaryKey();
    const selectable = popInSelectRange(p.population, { isPrimary: primary });
    const html = labelHtml(esc, p.name, p.population, {
      hasPage: showPages && pages.has(key),
    });
    const dim = isDiscovery && !selectable;
    layer.bindTooltip(html, {
      permanent: true,
      direction: 'center',
      className: dim ? 'sa-place-label sa-place-label-dim' : 'sa-place-label',
      opacity: dim ? 0.85 : 0.95,
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

  function styleForProps(p) {
    const key = placeKey(p.name, p.state);
    const primary = Boolean(primaryKey()) && key === primaryKey();
    const on = selected.has(key);
    const inR = inRadiusKeys.has(key);
    const selectable = popInSelectRange(p.population, { isPrimary: primary });
    if (primary) {
      return { color: '#0f766e', weight: 2.5, fillColor: '#14b8a6', fillOpacity: 0.55, fillRule: 'nonzero' };
    }
    if (!selectable) {
      // Visible for planning, weaker than in-range blue
      return { color: '#94a3b8', weight: 1.2, fillColor: '#cbd5e1', fillOpacity: 0.18, fillRule: 'nonzero' };
    }
    if (on) {
      return { color: '#1d4ed8', weight: 2.25, fillColor: '#3b82f6', fillOpacity: 0.48, fillRule: 'nonzero' };
    }
    if (inR) {
      return { color: '#475569', weight: 1.6, fillColor: '#94a3b8', fillOpacity: 0.32, fillRule: 'nonzero' };
    }
    // In-range, not yet selected — clearly visible on open
    return { color: '#2563eb', weight: 1.6, fillColor: '#93c5fd', fillOpacity: 0.28, fillRule: 'nonzero' };
  }

  function styleLayers() {
    if (!placesLayer) return;
    placesLayer.eachLayer((layer) => {
      const p = layer.feature?.properties || {};
      layer.setStyle(styleForProps(p));
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
      toAdd.push(f);
    }
    if (!toAdd.length) return;
    const exploded = explodePlaceFeatures({ type: 'FeatureCollection', features: toAdd });
    placesLayer.addData(exploded);
  }

  /**
   * Sync selection to the circle: add all in-radius, drop outside (keep center).
   */
  function syncSelectionToRadius(places) {
    const pk = primaryKey();
    for (const p of places || []) {
      selected.set(placeKey(p.name, p.state), { name: p.name, state: p.state });
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

    if (key === primaryKey()) return;
    if (blocked.has(key) || blocked.has(normalizePlaceName(name))) {
      /* Cluster sibling: coverage is allowed; location pages need an override. */
    }
    if (selected.has(key)) {
      selected.delete(key);
    } else {
      if (!popInSelectRange(pop)) {
        setStatus('Outside Min–Max pop — not selectable', 'err');
        return;
      }
      selected.set(key, { name, state: String(st || state).toUpperCase() });
    }
    renderList();
    styleLayers();
    setStatus(statusLine());
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
      const qs = new URLSearchParams({
        city: primaryCity,
        state,
        radiusMiles: String(radius),
        minPop: String(minPopFilter),
      });
      if (maxPopFilter != null) qs.set('maxPop', String(maxPopFilter));
      const data = await api(`/api/map/coverage-preview?${qs.toString()}`);
      if (destroyed) return;
      inRadiusKeys = new Set((data.places || []).map((p) => placeKey(p.name, p.state)));
      primaryCenter = data.primary?.center || null;
      mergeInRadiusFeatures(data.features || []);

      // Forever: add in-circle + drop outside (center sticky) on every refresh.
      syncSelectionToRadius(data.places || []);
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
        return;
      }

      const L = await ensureLeaflet();
      if (map && primaryCenter && Array.isArray(primaryCenter) && primaryCenter.length === 2) {
        const [lng, lat] = primaryCenter;
        if (circleLayer) map.removeLayer(circleLayer);
        circleLayer = L.circle([lat, lng], {
          radius: radius * 1609.34,
          color: '#0f766e',
          weight: 2,
          fillColor: '#14b8a6',
          fillOpacity: 0.07,
          interactive: false,
        }).addTo(map);
        if ((fit || !didFit) && map) {
          map.fitBounds(circleLayer.getBounds().pad(0.2));
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
    placesLayer = L.geoJSON(explodePlaceFeatures(geo), {
      style: (feature) => styleForProps(feature?.properties || {}),
      onEachFeature: (feature, layer) => {
        layer.on('click', () => onPlaceClick(feature));
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
