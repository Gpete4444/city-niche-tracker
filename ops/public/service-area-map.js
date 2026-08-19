/**
 * Shared radius + click multi-select map.
 * - Service area (Website Builder): page icons + Accept
 * - Discovery pack: sync city names into pack Cities field
 *
 * Map host = table panel slot; controls host = form / step body.
 */

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
function computePageKeys({ selected, claudeOrder, primaryCity, state, max = 8, popByKey }) {
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
    radiusMiles: initialRadius = 40,
    minPop: initialMinPop,
    maxPop: initialMaxPop,
    initialSelected = [],
    claudeOrder = [],
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

  let radius = Math.max(5, Math.min(60, Number(initialRadius) || 40));
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

  const helpText = isDiscovery
    ? 'Click an in-range city (Min–Max pop) as center. Radius adds/drops in-range cities.'
    : 'All cities on the map. Blue page icon = SEO location page (primary + up to 8 suburbs). Click to toggle.';

  const acceptBlock = isDiscovery
    ? ''
    : `<div class="narrative-actions" style="margin-top:0.75rem">
        <button type="button" class="btn primary" id="${uid}-accept">Accept selected cities</button>
      </div>
      <p class="muted small" id="${uid}-accept-status"></p>`;

  mapHost.innerHTML = `<div id="${uid}-map" class="sa-map-canvas" role="application" aria-label="${
    isDiscovery ? 'Discovery cities map' : 'Service area map'
  }"></div>`;
  controlsHost.innerHTML = `
    <div class="sa-controls">
      <label class="sa-radius-label">
        Radius <strong id="${uid}-radius-val">${esc(String(radius))}</strong> mi
        <input id="${uid}-radius" type="range" min="5" max="60" step="1" value="${esc(String(radius))}" />
      </label>
      <span class="muted small" id="${uid}-status">Loading map…</span>
      <h4 class="sa-list-title">Selected cities <span id="${uid}-count" class="muted"></span></h4>
      <p class="muted small">${esc(helpText)}</p>
      <ul id="${uid}-list" class="sa-list"></ul>
      ${acceptBlock}
    </div>
  `;

  const statusEl = controlsHost.querySelector(`#${uid}-status`);
  const listEl = controlsHost.querySelector(`#${uid}-list`);
  const countEl = controlsHost.querySelector(`#${uid}-count`);
  const acceptStatus = controlsHost.querySelector(`#${uid}-accept-status`);
  const slider = controlsHost.querySelector(`#${uid}-radius`);
  const radiusVal = controlsHost.querySelector(`#${uid}-radius-val`);
  const acceptBtn = controlsHost.querySelector(`#${uid}-accept`);
  const mapEl = mapHost.querySelector(`#${uid}-map`);

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

  function pageKeys() {
    if (!showPages) return new Set();
    return computePageKeys({
      selected,
      claudeOrder,
      primaryCity,
      state,
      max: 8,
      popByKey,
    });
  }

  function primaryKey() {
    return primaryCity ? placeKey(primaryCity, state) : '';
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
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        map?.invalidateSize();
        setTimeout(() => map?.invalidateSize(), 120);
      });
    });
  }

  function renderList() {
    const pages = pageKeys();
    const pk = primaryKey();
    const rows = [...selected.values()].sort((a, b) => {
      const ap = placeKey(a.name, a.state) === pk;
      const bp = placeKey(b.name, b.state) === pk;
      if (ap !== bp) return ap ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    if (countEl) countEl.textContent = `(${rows.length})`;
    if (!listEl) return;
    listEl.innerHTML = rows
      .map((r) => {
        const key = placeKey(r.name, r.state);
        const isPrimary = Boolean(pk) && key === pk;
        const hasPage = showPages && pages.has(key);
        const pop = popByKey.get(key);
        return `<li class="sa-list-item${isPrimary ? ' is-primary' : ''}${hasPage ? ' has-page' : ''}" data-key="${esc(key)}">
          <button type="button" class="sa-list-btn" ${isPrimary ? 'disabled' : ''}>
            <span class="sa-list-name">${hasPage ? `${PAGE_ICON} ` : ''}${esc(r.name)}, ${esc(r.state)}</span>
            <span class="muted">${pop != null ? esc(fmtPop(pop)) : ''}${isPrimary ? ' · center' : ' · remove'}</span>
          </button>
        </li>`;
      })
      .join('');
    listEl.querySelectorAll('.sa-list-btn:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.closest('[data-key]')?.getAttribute('data-key');
        if (!key || key === primaryKey()) return;
        selected.delete(key);
        renderList();
        refreshLabels();
        styleLayers();
        setStatus(statusLine());
        emitSelection();
      });
    });
  }

  function refreshLabels() {
    if (!placesLayer) return;
    const pages = pageKeys();
    placesLayer.eachLayer((layer) => {
      const p = layer.feature?.properties || {};
      const key = placeKey(p.name, p.state);
      const primary = Boolean(primaryKey()) && key === primaryKey();
      const selectable = popInSelectRange(p.population, { isPrimary: primary });
      const html = labelHtml(esc, p.name, p.population, {
        hasPage: showPages && pages.has(key),
      });

      if (layer.getTooltip()) layer.unbindTooltip();

      // All places get permanent labels; Discovery out-of-range uses quieter class.
      const dim = isDiscovery && !selectable;
      layer.bindTooltip(html, {
        permanent: true,
        direction: 'center',
        className: dim ? 'sa-place-label sa-place-label-dim' : 'sa-place-label',
        opacity: dim ? 0.85 : 0.95,
      });
    });
  }

  function styleForProps(p) {
    const key = placeKey(p.name, p.state);
    const primary = Boolean(primaryKey()) && key === primaryKey();
    const on = selected.has(key);
    const inR = inRadiusKeys.has(key);
    const selectable = popInSelectRange(p.population, { isPrimary: primary });
    if (primary) {
      return { color: '#0f766e', weight: 2.5, fillColor: '#14b8a6', fillOpacity: 0.55 };
    }
    if (!selectable) {
      // Visible for planning, weaker than in-range blue
      return { color: '#94a3b8', weight: 1.2, fillColor: '#cbd5e1', fillOpacity: 0.18 };
    }
    if (on) {
      return { color: '#1d4ed8', weight: 2.25, fillColor: '#3b82f6', fillOpacity: 0.48 };
    }
    if (inR) {
      return { color: '#475569', weight: 1.6, fillColor: '#94a3b8', fillOpacity: 0.32 };
    }
    // In-range, not yet selected — clearly visible on open
    return { color: '#2563eb', weight: 1.6, fillColor: '#93c5fd', fillOpacity: 0.28 };
  }

  function styleLayers() {
    if (!placesLayer) return;
    placesLayer.eachLayer((layer) => {
      const p = layer.feature?.properties || {};
      layer.setStyle(styleForProps(p));
    });
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
        await refreshRadiusMembership({ fit: true });
      } catch (e) {
        setStatus(e.message || String(e), 'err');
      }
      emitSelection();
      return;
    }

    if (key === primaryKey()) return;
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
    refreshLabels();
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

    const qs = new URLSearchParams({
      city: primaryCity,
      state,
      radiusMiles: String(radius),
      minPop: String(minPopFilter),
    });
    if (maxPopFilter != null) qs.set('maxPop', String(maxPopFilter));
    const data = await api(`/api/map/coverage-preview?${qs.toString()}`);
    inRadiusKeys = new Set((data.places || []).map((p) => placeKey(p.name, p.state)));
    primaryCenter = data.primary?.center || null;

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
      if (fit || !didFit) {
        map.fitBounds(circleLayer.getBounds().pad(0.2));
        didFit = true;
        scheduleInvalidateSize();
      }
    }

    styleLayers();
    renderList();
    refreshLabels();
    setStatus(statusLine(), centerOutsidePopRange() ? 'err' : '');
    emitSelection();
  }

  async function loadFullStateMap() {
    if (destroyed) return;
    setStatus('Loading places…');
    const L = await ensureLeaflet();
    const geo = await api(
      `/api/map/geojson?layer=places&state=${encodeURIComponent(String(state).toUpperCase())}`,
    );

    popByKey = new Map();
    for (const f of geo.features || []) {
      const p = f.properties || {};
      popByKey.set(placeKey(p.name, p.state), Number(p.population) || 0);
    }

    // Discovery: keep seeded center even if outside Min–Max (warn via status); prune other OOR picks.
    if (isDiscovery) {
      const pk = primaryCity ? placeKey(primaryCity, state) : '';
      for (const [key] of [...selected.entries()]) {
        if (pk && key === pk) continue;
        if (!popInSelectRange(popByKey.get(key))) selected.delete(key);
      }
    }

    if (!map) {
      map = L.map(mapEl, { scrollWheelZoom: true }).setView([40, -111], 8);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 18,
      }).addTo(map);
    }

    if (placesLayer) {
      map.removeLayer(placesLayer);
      placesLayer = null;
    }

    placesLayer = L.geoJSON(geo, {
      style: (feature) => styleForProps(feature?.properties || {}),
      onEachFeature: (feature, layer) => {
        const p = feature.properties || {};
        layer.on('click', () => {
          togglePlace(p.name, p.state).catch((e) => setStatus(e.message || String(e), 'err'));
        });
      },
    }).addTo(map);

    refreshLabels();

    if (primaryCity) {
      await refreshRadiusMembership({ fit: true });
    } else {
      try {
        const b = placesLayer.getBounds();
        if (b?.isValid()) map.fitBounds(b.pad(0.08));
        didFit = true;
      } catch {
        /* ignore */
      }
      renderList();
      refreshLabels();
      setStatus(
        isDiscovery
          ? 'Click an in-range city (Min–Max pop) to set the radius center'
          : statusLine(),
      );
    }
    scheduleInvalidateSize();
  }

  slider?.addEventListener('input', () => {
    radius = Number(slider.value) || 40;
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

  acceptBtn?.addEventListener('click', async () => {
    if (!onAccept) return;
    acceptBtn.disabled = true;
    if (acceptStatus) acceptStatus.textContent = 'Saving…';
    try {
      await onAccept({
        radiusMiles: radius,
        selectedCities: [...selected.values()],
        primaryCity,
      });
      if (acceptStatus) acceptStatus.textContent = 'Saved coverage + location pages.';
    } catch (e) {
      if (acceptStatus) acceptStatus.textContent = e.message || String(e);
    } finally {
      acceptBtn.disabled = false;
    }
  });

  try {
    await ensureLeaflet();
    await loadFullStateMap();
  } catch (e) {
    setStatus(e.message || String(e), 'err');
  }

  return {
    destroy() {
      destroyed = true;
      clearTimeout(debounceTimer);
      if (map) {
        map.remove();
        map = null;
      }
      mapHost.innerHTML = '';
      controlsHost.innerHTML = '';
    },
    invalidateSize() {
      scheduleInvalidateSize();
    },
    /** Live-update Discovery pack Min/Max pop while map is open. */
    setPopRange({ minPop, maxPop } = {}) {
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
    },
  };
}

/** Website Builder — Service area step. */
export async function mountServiceAreaMap(opts) {
  return mountGeoSelectMap({ ...opts, variant: 'service-area' });
}

/** Discovery Pack — city multi-select into Cities field. */
export async function mountDiscoveryCitiesMap(opts) {
  return mountGeoSelectMap({ ...opts, variant: 'discovery' });
}

/** Show/hide candidate table vs service-area map canvas. */
export function setServiceAreaTableMode(on) {
  const panel = document.querySelector('.candidates-table-panel');
  const wrap = document.querySelector('.candidates-table-wrap');
  const canvas = document.getElementById('sa-map-canvas');
  const filters = document.querySelector('.candidate-filters');
  const legend = document.getElementById('candidate-source-legend');
  const stageRail = document.getElementById('stage-rail');
  if (panel) panel.classList.toggle('sa-table-mode', Boolean(on));
  if (wrap) wrap.classList.toggle('hidden', Boolean(on));
  if (canvas) canvas.classList.toggle('hidden', !on);
  if (filters) filters.classList.toggle('hidden', Boolean(on));
  if (legend) legend.classList.toggle('hidden', Boolean(on));
  if (stageRail && on) stageRail.classList.add('hidden');
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
  if (panel) panel.classList.toggle('disc-map-mode', Boolean(on));
  if (wrap) wrap.classList.toggle('hidden', Boolean(on));
  if (canvas) canvas.classList.toggle('hidden', !on);
  if (filters) filters.classList.toggle('hidden', Boolean(on));
  if (legend) legend.classList.toggle('hidden', Boolean(on));
  if (steps) steps.classList.toggle('hidden', Boolean(on));
  if (head) head.classList.toggle('hidden', Boolean(on));
}
