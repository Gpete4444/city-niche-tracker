/**
 * Operator research Map tab (Leaflet).
 */

import { explodePlaceFeatures, isLargestPart } from './map-polygons.js?v=20260902mapFill';

const US_BOUNDS = [
  [24.5, -125],
  [49.5, -66],
];

const LABEL_ZOOM = 9;
const LABEL_CAP = 40;
const DEFAULT_MIN_POP = 5000;
const DEFAULT_MAX_POP = 500000;

let Lref = null;
let map = null;
let placesLayer = null;
let countiesLayer = null;
let highlightLayer = null;
let canvasRenderer = null;
let wired = false;
/** Shared init so setView('map') + openResearchMap do not race. */
let readyPromise = null;
/** Serializes layer loads; callers always await (never silent skip). */
let reloadChain = Promise.resolve();
let deps = { api: null, esc: null, showModal: null };
let presetsCache = null;
/** When set, geojson fetches are limited to this state abbr. */
let layerStateScope = '';
let labelsPermanent = false;
let labelTimer = null;
const permanentLabelLayers = new Set();
/** Status line to restore after a background reload. */
let selectionLabel = null;

const ui = {
  citiesOn: true,
  countiesOn: false,
  minPop: DEFAULT_MIN_POP,
  maxPop: DEFAULT_MAX_POP,
};

function el(id) {
  return document.getElementById(id);
}

function fmtPop(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return String(Math.round(v));
}

function labelHtml(name, pop, inRange = true) {
  const oor = inRange ? '' : ' rm-label-oor';
  return `<span class="rm-label-name${oor}">${deps.esc(name)}</span> <span class="rm-label-pop${oor}">${deps.esc(fmtPop(pop))}</span>`;
}

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

function setStatus(text, kind = '') {
  const n = el('rm-status');
  if (!n) return;
  n.textContent = text || '';
  n.dataset.kind = kind;
}

function setSelectionLabel(text) {
  selectionLabel = text || null;
  const n = el('rm-selection');
  if (!n) return;
  n.textContent = selectionLabel || '';
}

function popInRange(pop) {
  const v = Number(pop);
  if (!Number.isFinite(v)) return false;
  return v >= ui.minPop && v <= ui.maxPop;
}

function featureStyle(kind, { selected = false, inRange = true } = {}) {
  if (!inRange) {
    return {
      color: selected ? '#991b1b' : '#dc2626',
      weight: selected ? 2.5 : 1.4,
      fillColor: selected ? '#f87171' : '#fecaca',
      fillOpacity: selected ? 0.45 : 0.22,
      fillRule: 'nonzero',
    };
  }
  if (kind === 'counties') {
    return {
      color: selected ? '#9d174d' : '#db2777',
      weight: selected ? 2.5 : 1.2,
      fillColor: selected ? '#f472b6' : '#fbcfe8',
      fillOpacity: selected ? 0.4 : 0.2,
      fillRule: 'nonzero',
    };
  }
  return {
    color: selected ? '#1e3a8a' : '#2563eb',
    weight: selected ? 2.5 : 1.4,
    fillColor: selected ? '#60a5fa' : '#93c5fd',
    fillOpacity: selected ? 0.5 : 0.32,
    fillRule: 'nonzero',
  };
}

function getCanvasRenderer() {
  if (!canvasRenderer && Lref) {
    canvasRenderer = Lref.canvas({ padding: 0.5 });
  }
  return canvasRenderer;
}

function bindHoverTooltip(layer, feature) {
  const p = feature.properties || {};
  const inRange = p.inRange !== false;
  layer.bindTooltip(labelHtml(p.name, p.population, inRange), {
    permanent: false,
    direction: 'center',
    className: inRange ? 'rm-tooltip' : 'rm-tooltip rm-tooltip-oor',
    sticky: true,
  });
}

function bindFeature(layer, kind, feature) {
  const p = feature.properties || {};
  layer._rmKind = kind;
  if (isLargestPart(feature)) bindHoverTooltip(layer, feature);
  layer.on('click', () => {
    const stateInput = el('rm-state');
    const cityInput = el('rm-city');
    if (stateInput) stateInput.value = p.state || '';
    if (cityInput) cityInput.value = kind === 'places' ? p.name || '' : '';
    highlightFeature(feature, kind);
    setSelectionLabel(`${p.name || ''}, ${p.state || ''} · ${fmtPop(p.population)}`);
  });
}

/** Stable label position: bounds center, else average of largest exterior ring. */
function labelAnchorLatLng(layer, feature) {
  try {
    const b = typeof layer.getBounds === 'function' ? layer.getBounds() : null;
    if (b && b.isValid()) return b.getCenter();
  } catch {
    /* fall through */
  }
  const geom = feature?.geometry;
  if (!geom || !Lref) return null;
  let rings = [];
  if (geom.type === 'Polygon') rings = [geom.coordinates?.[0]].filter(Boolean);
  else if (geom.type === 'MultiPolygon') {
    rings = (geom.coordinates || []).map((poly) => poly?.[0]).filter(Boolean);
  }
  let best = null;
  let bestLen = -1;
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    if (ring.length > bestLen) {
      bestLen = ring.length;
      best = ring;
    }
  }
  if (!best) return null;
  let lat = 0;
  let lng = 0;
  let n = 0;
  for (const pt of best) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    lng += Number(pt[0]);
    lat += Number(pt[1]);
    n += 1;
  }
  if (!n) return null;
  return Lref.latLng(lat / n, lng / n);
}

function setPermanentTooltip(layer, feature, on) {
  if (layer.getTooltip()) layer.unbindTooltip();
  if (on) {
    if (!isLargestPart(feature)) return;
    const p = feature.properties || {};
    const inRange = p.inRange !== false;
    layer.bindTooltip(labelHtml(p.name, p.population, inRange), {
      permanent: true,
      direction: 'center',
      className: inRange
        ? 'rm-tooltip rm-tooltip-permanent'
        : 'rm-tooltip rm-tooltip-permanent rm-tooltip-oor',
      opacity: 0.95,
    });
    const tip = layer.getTooltip();
    const anchor = labelAnchorLatLng(layer, feature);
    if (tip && anchor) tip.setLatLng(anchor);
    permanentLabelLayers.add(layer);
  } else {
    if (isLargestPart(feature)) bindHoverTooltip(layer, feature);
    permanentLabelLayers.delete(layer);
  }
}

function clearAllPermanentLabels() {
  for (const layer of [...permanentLabelLayers]) {
    const f = layer.feature;
    if (f) setPermanentTooltip(layer, f, false);
    else permanentLabelLayers.delete(layer);
  }
}

function collectPathLayers(geoLayer) {
  const out = [];
  if (!geoLayer) return out;
  geoLayer.eachLayer((layer) => out.push(layer));
  return out;
}

/** Viewport-capped permanent labels; hover tooltips stay bound otherwise. */
function updatePermanentLabels() {
  if (!map) return;
  const want = map.getZoom() >= LABEL_ZOOM;
  if (!want) {
    if (labelsPermanent || permanentLabelLayers.size) {
      clearAllPermanentLabels();
      labelsPermanent = false;
    }
    return;
  }
  labelsPermanent = true;
  const bounds = map.getBounds();
  const candidates = [];
  for (const geo of [placesLayer, countiesLayer]) {
    for (const layer of collectPathLayers(geo)) {
      const f = layer.feature;
      if (!f || !isLargestPart(f)) continue;
      try {
        const b = typeof layer.getBounds === 'function' ? layer.getBounds() : null;
        if (b && b.isValid() && !bounds.intersects(b)) continue;
      } catch {
        continue;
      }
      candidates.push({
        layer,
        feature: f,
        pop: Number(f.properties?.population) || 0,
      });
    }
  }
  candidates.sort((a, b) => {
    const aIn = a.feature.properties?.inRange !== false ? 1 : 0;
    const bIn = b.feature.properties?.inRange !== false ? 1 : 0;
    if (aIn !== bIn) return bIn - aIn;
    return b.pop - a.pop;
  });
  const keep = new Set(candidates.slice(0, LABEL_CAP).map((c) => c.layer));
  for (const layer of [...permanentLabelLayers]) {
    if (!keep.has(layer)) {
      const f = layer.feature;
      if (f) setPermanentTooltip(layer, f, false);
      else permanentLabelLayers.delete(layer);
    }
  }
  for (const { layer, feature } of candidates.slice(0, LABEL_CAP)) {
    if (!permanentLabelLayers.has(layer)) {
      setPermanentTooltip(layer, feature, true);
    }
  }
}

function scheduleLabelUpdate() {
  clearTimeout(labelTimer);
  labelTimer = setTimeout(() => updatePermanentLabels(), 100);
}

function fitHighlightBounds() {
  if (!map || !highlightLayer) return;
  const b = highlightLayer.getBounds();
  if (!b.isValid()) return;
  map.invalidateSize();
  map.fitBounds(b.pad(0.35));
}

function collectPlaceParts(feature, kind) {
  const p = feature?.properties || {};
  const src = kind === 'counties' ? countiesLayer : placesLayer;
  const parts = [];
  if (src) {
    src.eachLayer((layer) => {
      const fp = layer.feature?.properties || {};
      const same = p.geoid
        ? String(fp.geoid || '') === String(p.geoid)
        : fp.name === p.name && fp.state === p.state;
      if (same && layer.feature) parts.push(layer.feature);
    });
  }
  if (parts.length > 1) {
    return { type: 'FeatureCollection', features: parts };
  }
  return explodePlaceFeatures(feature);
}

function highlightFeature(feature, kind = 'places') {
  if (!map || !Lref || !feature) return;
  if (highlightLayer) {
    try {
      map.removeLayer(highlightLayer);
    } catch {
      /* ignore */
    }
  }
  const inRange = popInRange(feature.properties?.population);
  if (feature.properties) feature.properties.inRange = inRange;
  // Exploded parts on SVG — Leaflet MultiPolygon evenodd cancels island fill.
  highlightLayer = Lref.geoJSON(collectPlaceParts(feature, kind), {
    style: () => featureStyle(kind, { selected: true, inRange }),
    onEachFeature: (_f, layer) => {
      layer._rmKind = kind;
    },
  }).addTo(map);
  fitHighlightBounds();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => fitHighlightBounds());
  });
}

async function fetchLayer(layer) {
  const params = new URLSearchParams({
    layer,
    minPop: String(ui.minPop),
    maxPop: String(ui.maxPop),
  });
  if (layerStateScope) params.set('state', layerStateScope);
  return deps.api(`/api/map/geojson?${params.toString()}`);
}

function countInOut(geoLayer) {
  let inn = 0;
  let out = 0;
  if (!geoLayer) return { inn, out };
  geoLayer.eachLayer((layer) => {
    const f = layer.feature;
    if (!f) return;
    if (!isLargestPart(f)) return;
    if (f.properties?.inRange !== false) inn += 1;
    else out += 1;
  });
  return { inn, out };
}

function statusFromLayers() {
  const scope = layerStateScope ? ` · ${layerStateScope}` : '';
  const parts = [];
  if (placesLayer) {
    const { inn, out } = countInOut(placesLayer);
    parts.push(`Cities ${inn} in / ${out} out`);
  }
  if (countiesLayer) {
    const { inn, out } = countInOut(countiesLayer);
    parts.push(`Counties ${inn} in / ${out} out`);
  }
  if (!parts.length) return 'Both layers off';
  return `${parts.join(' · ')}${scope}`;
}

/** Restyle in-place after min/max change (no GeoJSON reload). */
function restyleLoadedLayers() {
  const restyleGeo = (geo, kind) => {
    if (!geo) return;
    geo.eachLayer((layer) => {
      const f = layer.feature;
      if (!f) return;
      const inRange = popInRange(f.properties?.population);
      f.properties = { ...(f.properties || {}), inRange };
      layer.setStyle(featureStyle(kind, { inRange }));
      const wasPermanent = permanentLabelLayers.has(layer);
      if (layer.getTooltip()) layer.unbindTooltip();
      if (wasPermanent) setPermanentTooltip(layer, f, true);
      else if (isLargestPart(f)) bindHoverTooltip(layer, f);
    });
  };
  restyleGeo(placesLayer, 'places');
  restyleGeo(countiesLayer, 'counties');
  if (highlightLayer) {
    highlightLayer.eachLayer((layer) => {
      const f = layer.feature;
      if (!f) return;
      const inRange = popInRange(f.properties?.population);
      f.properties = { ...(f.properties || {}), inRange };
      const kind = layer._rmKind || 'places';
      layer.setStyle(featureStyle(kind, { selected: true, inRange }));
    });
  }
  setStatus(statusFromLayers(), 'ok');
  scheduleLabelUpdate();
}

async function reloadLayers({ fit = false } = {}) {
  if (!map) return;
  const run = async () => {
    setStatus('Loading…');
    try {
      permanentLabelLayers.clear();
      labelsPermanent = false;
      if (placesLayer) {
        map.removeLayer(placesLayer);
        placesLayer = null;
      }
      if (countiesLayer) {
        map.removeLayer(countiesLayer);
        countiesLayer = null;
      }

      const renderer = getCanvasRenderer();
      let placesMeta = null;
      let countiesMeta = null;

      if (ui.countiesOn) {
        const counties = explodePlaceFeatures(await fetchLayer('counties'));
        countiesMeta = counties.meta;
        countiesLayer = Lref.geoJSON(counties, {
          style: (feature) =>
            featureStyle('counties', { inRange: feature.properties?.inRange !== false }),
          renderer,
          onEachFeature: (feature, layer) => bindFeature(layer, 'counties', feature),
        }).addTo(map);
      }

      if (ui.citiesOn) {
        const places = explodePlaceFeatures(await fetchLayer('places'));
        placesMeta = places.meta;
        placesLayer = Lref.geoJSON(places, {
          style: (feature) =>
            featureStyle('places', { inRange: feature.properties?.inRange !== false }),
          renderer,
          onEachFeature: (feature, layer) => bindFeature(layer, 'places', feature),
        }).addTo(map);
      }

      if (fit) {
        map.fitBounds(US_BOUNDS);
      }

      if (!ui.citiesOn && !ui.countiesOn) setStatus('Both layers off');
      else {
        const scope = layerStateScope ? ` · ${layerStateScope}` : '';
        const parts = [];
        if (placesMeta) {
          parts.push(
            `Cities ${placesMeta.inRangeCount ?? 0} in / ${placesMeta.outOfRangeCount ?? 0} out`,
          );
        }
        if (countiesMeta) {
          parts.push(
            `Counties ${countiesMeta.inRangeCount ?? 0} in / ${countiesMeta.outOfRangeCount ?? 0} out`,
          );
        }
        setStatus(`${parts.join(' · ')}${scope}`, 'ok');
      }
      scheduleLabelUpdate();
    } catch (error) {
      setStatus(error.message || 'Load failed', 'err');
    }
  };
  const next = reloadChain.then(run, run);
  reloadChain = next.catch(() => {});
  await next;
}

async function initMap() {
  const L = await ensureLeaflet();
  Lref = L;
  const host = el('research-map');
  if (!host) return;
  if (map) {
    map.invalidateSize();
    return;
  }
  map = L.map(host, {
    zoomControl: true,
    minZoom: 3,
    maxZoom: 16,
  }).fitBounds(US_BOUNDS);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 18,
  }).addTo(map);

  getCanvasRenderer();
  map.on('zoomend', scheduleLabelUpdate);
  map.on('moveend', scheduleLabelUpdate);

  await reloadLayers({ fit: true });
}

function readFilterInputs() {
  const min = Number(el('rm-min-pop')?.value);
  const max = Number(el('rm-max-pop')?.value);
  ui.minPop = Number.isFinite(min) ? min : DEFAULT_MIN_POP;
  ui.maxPop = Number.isFinite(max) ? max : DEFAULT_MAX_POP;
  ui.citiesOn = Boolean(el('rm-cities')?.checked);
  ui.countiesOn = Boolean(el('rm-counties')?.checked);
}

function applyPopRange(minPop, maxPop) {
  ui.minPop = minPop;
  ui.maxPop = maxPop;
  if (el('rm-min-pop')) el('rm-min-pop').value = String(minPop);
  if (el('rm-max-pop')) el('rm-max-pop').value = String(maxPop);
}

function zoomToFeature(feature, kind = 'places') {
  if (!feature || !map) return;
  highlightFeature(feature, kind);
  const p = feature.properties || {};
  setSelectionLabel(`${p.name || ''}, ${p.state || ''} · ${fmtPop(p.population)}`);
}

async function onShow() {
  setStatus('Looking up…');
  readFilterInputs();
  const stateAbbr = normalizeStateInput(String(el('rm-state')?.value || '').trim());
  if (el('rm-state') && stateAbbr) el('rm-state').value = stateAbbr;
  const city = String(el('rm-city')?.value || '').trim();

  if (city && stateAbbr) {
    if (!ui.citiesOn) {
      ui.citiesOn = true;
      const cb = el('rm-cities');
      if (cb) cb.checked = true;
    }

    let feature = null;
    try {
      const data = await deps.api(
        `/api/map/place?city=${encodeURIComponent(city)}&state=${encodeURIComponent(stateAbbr)}`,
      );
      feature = data.feature;
    } catch {
      feature = null;
    }

    if (!feature) {
      if (deps.showModal) {
        await deps.showModal({
          title: 'City not on map',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>No map boundary matched <strong>${deps.esc(city)}, ${deps.esc(
            stateAbbr,
          )}</strong>. Try another spelling from the city dropdown, or pick a state-only Show.</p>`,
        });
      }
      setStatus(`No map match for ${city}, ${stateAbbr}`, 'err');
      setSelectionLabel(null);
      return;
    }

    // Widen pop filter when the matched place is outside the current range.
    const pop = Number(feature.properties?.population);
    let widened = false;
    if (Number.isFinite(pop) && !popInRange(pop)) {
      const nextMin = Math.min(ui.minPop, pop);
      const nextMax = Math.max(ui.maxPop, pop);
      applyPopRange(nextMin, nextMax);
      widened = true;
    }
    if (feature.properties) {
      feature.properties.inRange = popInRange(feature.properties.population);
    }

    setStatus(
      widened
        ? `Widened pop filter to include ${city} (${fmtPop(pop)})…`
        : 'Zooming…',
    );
    layerStateScope = stateAbbr;
    zoomToFeature(feature, 'places');
    if (widened) {
      setSelectionLabel(
        `${feature.properties?.name || city}, ${stateAbbr} · ${fmtPop(pop)} (filter widened)`,
      );
    }
    await reloadLayers();
    return;
  }

  if (stateAbbr) {
    setStatus(`Zooming to ${stateAbbr}…`);
    layerStateScope = stateAbbr;
    await reloadLayers();
    try {
      const params = new URLSearchParams({
        layer: 'counties',
        minPop: String(ui.minPop),
        maxPop: String(ui.maxPop),
        state: stateAbbr,
      });
      const data = await deps.api(`/api/map/geojson?${params}`);
      if (data.features?.length && map) {
        const layer = Lref.geoJSON(data);
        const b = layer.getBounds();
        if (b.isValid()) map.fitBounds(b.pad(0.08));
        setSelectionLabel(null);
        setStatus(`Zoomed to ${stateAbbr}`, 'ok');
      } else {
        setStatus(`No counties for ${stateAbbr}`, 'err');
      }
    } catch (error) {
      setStatus(error.message || 'State zoom failed', 'err');
    }
    return;
  }

  setStatus('Enter a state (and optional city) to Show');
  await reloadLayers();
}

async function loadPresets() {
  if (presetsCache) return presetsCache;
  presetsCache = await deps.api('/api/discovery/presets');
  return presetsCache;
}

function normalizeStateInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const states = presetsCache?.states || [];
  const hit = states.find(
    (st) =>
      String(st.name || '').toLowerCase() === s.toLowerCase() ||
      String(st.abbr || '').toLowerCase() === s.toLowerCase(),
  );
  return hit ? hit.abbr : s.toUpperCase().slice(0, 2);
}

function hideSuggestList(listEl) {
  if (!listEl) return;
  listEl.innerHTML = '';
  listEl.classList.add('hidden');
  listEl.hidden = true;
}

function showSuggestList(listEl, items) {
  if (!listEl) return;
  if (!items.length) {
    hideSuggestList(listEl);
    return;
  }
  listEl.innerHTML = items
    .map(
      (it, i) =>
        `<li role="option" data-value="${deps.esc(it.value)}" aria-selected="${
          i === 0 ? 'true' : 'false'
        }">${deps.esc(it.label)}</li>`,
    )
    .join('');
  listEl.classList.remove('hidden');
  listEl.hidden = false;
}

function moveSuggestSelection(listEl, delta) {
  const opts = [...(listEl?.querySelectorAll('li[role="option"]') || [])];
  if (!opts.length) return;
  let idx = opts.findIndex((node) => node.getAttribute('aria-selected') === 'true');
  if (idx < 0) idx = 0;
  opts[idx].setAttribute('aria-selected', 'false');
  idx = (idx + delta + opts.length) % opts.length;
  opts[idx].setAttribute('aria-selected', 'true');
  opts[idx].scrollIntoView({ block: 'nearest' });
}

function selectedSuggestValue(listEl) {
  const node = listEl?.querySelector('li[aria-selected="true"]');
  return node ? node.getAttribute('data-value') || '' : '';
}

/** Stop Chrome history/autofill chips from covering custom geo suggest lists. */
function disableBrowserGeoAutofill(input) {
  if (!input || input.dataset.geoAutofillBound === '1') return;
  input.dataset.geoAutofillBound = '1';
  input.setAttribute('autocomplete', 'new-password');
  input.setAttribute('readonly', 'readonly');
  input.addEventListener('focus', () => {
    setTimeout(() => {
      input.removeAttribute('readonly');
    }, 0);
  });
  input.addEventListener('blur', () => {
    input.setAttribute('readonly', 'readonly');
  });
}

async function fillStateSelect() {
  const stateSelect = el('rm-state');
  if (!stateSelect || stateSelect.tagName !== 'SELECT') return;
  try {
    await loadPresets();
  } catch {
    /* ignore */
  }
  const states = presetsCache?.states || [];
  const current = String(stateSelect.value || '').toUpperCase();
  const opts = ['<option value="">State…</option>'].concat(
    states.map(
      (st) =>
        `<option value="${deps.esc(st.abbr)}">${deps.esc(st.abbr)} — ${deps.esc(st.name)}</option>`,
    ),
  );
  stateSelect.innerHTML = opts.join('');
  if (current && [...stateSelect.options].some((o) => o.value === current)) {
    stateSelect.value = current;
  }
}

function wireSuggest() {
  const stateSelect = el('rm-state');
  const cityInput = el('rm-city');
  const citySuggest = el('rm-city-suggest');
  if (!cityInput || !citySuggest) return;

  disableBrowserGeoAutofill(cityInput);
  fillStateSelect().catch(() => {});

  let cityTimer = null;
  let cityReq = 0;

  const refreshCitySuggestions = async () => {
    const q = String(cityInput.value || '').trim();
    const st = normalizeStateInput(stateSelect?.value || '');
    const reqId = ++cityReq;
    try {
      const qs = new URLSearchParams({ q, limit: !q && st ? '2000' : '50' });
      if (st) qs.set('state', st);
      const data = await deps.api(`/api/discovery/places?${qs.toString()}`);
      if (reqId !== cityReq) return;
      const places = data?.places || [];
      citySuggest._items = places;
      showSuggestList(
        citySuggest,
        places.map((p) => ({
          value: p.city,
          label:
            p.population != null
              ? `${p.city}, ${p.state} · ${fmtPop(p.population)}`
              : `${p.city}, ${p.state}`,
        })),
      );
    } catch {
      if (reqId !== cityReq) return;
      hideSuggestList(citySuggest);
    }
  };

  const pickCity = (cityName) => {
    if (!cityName) return;
    cityInput.value = cityName;
    const match = (citySuggest._items || []).find((p) => p.city === cityName);
    if (match?.state && stateSelect) stateSelect.value = match.state;
    hideSuggestList(citySuggest);
    cityInput.focus();
  };

  cityInput.addEventListener('focus', () => {
    refreshCitySuggestions().catch(() => {});
  });
  cityInput.addEventListener('input', () => {
    clearTimeout(cityTimer);
    cityTimer = setTimeout(() => {
      refreshCitySuggestions().catch(() => {});
    }, 200);
  });
  cityInput.addEventListener('keydown', (event) => {
    if (citySuggest.hidden) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSuggestSelection(citySuggest, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSuggestSelection(citySuggest, -1);
    } else if (event.key === 'Enter') {
      const v = selectedSuggestValue(citySuggest);
      if (v) {
        event.preventDefault();
        pickCity(v);
      }
    } else if (event.key === 'Escape') {
      hideSuggestList(citySuggest);
    }
  });
  citySuggest.addEventListener('mousedown', (event) => {
    const li = event.target?.closest?.('li[data-value]');
    if (!li) return;
    event.preventDefault();
    pickCity(li.getAttribute('data-value'));
  });
  cityInput.addEventListener('blur', () => {
    setTimeout(() => hideSuggestList(citySuggest), 120);
  });
}

function wireControls() {
  if (wired) return;
  wired = true;
  wireSuggest();
  el('rm-apply')?.addEventListener('click', () => {
    setSelectionLabel(null);
    readFilterInputs();
    if (placesLayer || countiesLayer) restyleLoadedLayers();
    else reloadLayers().catch((error) => setStatus(error?.message || 'Load failed', 'err'));
  });
  el('rm-show')?.addEventListener('click', () => {
    onShow().catch((error) => {
      setStatus(error?.message || 'Show failed', 'err');
    });
  });
  el('rm-cities')?.addEventListener('change', async () => {
    readFilterInputs();
    await reloadLayers();
  });
  el('rm-counties')?.addEventListener('change', async () => {
    readFilterInputs();
    await reloadLayers();
  });
  el('rm-reset')?.addEventListener('click', async () => {
    layerStateScope = '';
    setSelectionLabel(null);
    if (highlightLayer && map) {
      try {
        map.removeLayer(highlightLayer);
      } catch {
        /* ignore */
      }
      highlightLayer = null;
    }
    applyPopRange(DEFAULT_MIN_POP, DEFAULT_MAX_POP);
    if (el('rm-state')) el('rm-state').value = '';
    if (el('rm-city')) el('rm-city').value = '';
    if (el('rm-cities')) el('rm-cities').checked = true;
    if (el('rm-counties')) el('rm-counties').checked = false;
    readFilterInputs();
    await reloadLayers({ fit: true });
  });
}

async function doEnsureResearchMapReady() {
  try {
    await loadPresets();
    await fillStateSelect();
  } catch {
    /* optional until first focus */
  }
  const status = await deps.api('/api/map/status');
  if (!status.ok) {
    setStatus(status.hint || 'Map data missing — run npm run build-research-map', 'err');
    readyPromise = null;
    return false;
  }
  await initMap();
  return true;
}

export async function ensureResearchMapReady({ api, esc, showModal }) {
  deps = { api, esc, showModal: showModal || deps.showModal };
  wireControls();
  if (map) {
    map.invalidateSize();
    return true;
  }
  if (!readyPromise) {
    readyPromise = doEnsureResearchMapReady().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

function waitForMapLayout() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (map) map.invalidateSize();
        resolve();
      });
    });
  });
}

/**
 * Open Map tab focused on a city (from Candidates).
 * Caller should setView('map') first.
 */
export async function openResearchMap({ city, state } = {}, { api, esc, showModal } = {}) {
  if (api) deps.api = api;
  if (esc) deps.esc = esc;
  if (showModal) deps.showModal = showModal;
  // Await shared ready so init's fitBounds(US) finishes before city zoom.
  await ensureResearchMapReady({
    api: deps.api,
    esc: deps.esc,
    showModal: deps.showModal,
  });
  if (el('rm-state') && state) el('rm-state').value = String(state).toUpperCase();
  if (el('rm-city') && city) el('rm-city').value = String(city);
  if (el('rm-cities')) el('rm-cities').checked = true;
  ui.citiesOn = true;
  await waitForMapLayout();
  await onShow();
  await waitForMapLayout();
  if (highlightLayer) fitHighlightBounds();
}

export function invalidateResearchMapSize() {
  if (!map) return;
  map.invalidateSize();
  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 50);
}
