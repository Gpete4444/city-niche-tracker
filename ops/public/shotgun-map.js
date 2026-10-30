/**
 * Zone metro map: Cluster paint palette, Cluster prefix on labels, one Zone radius, 20 mi rings.
 */
import { explodePlaceFeatures, isLargestPart, labelAnchorLngLat } from './map-polygons.js?v=20261022label';
import {
  CLUSTER_MAX,
  MAX_CLUSTER_MILES,
  cityMapLabel,
  clampClusterMiles,
  clusterColor,
  memberClusterKey,
  parseClusterKey,
} from './shotgun-clusters.js?v=20261022miles';

const LEAFLET_LOAD_MS = 8000;
let lastPaintTool = 'cluster';
const LABEL_ZOOM = 9;
const LABEL_CAP = 40;
const LABEL_PX_MIN = 8;
const LABEL_PX_MAX = 18;
const LABEL_PX_DEFAULT = 12;
const LABEL_PX_KEY = 'ops.sgLabelPx';
const MAP_POP_KEY = 'ops.sgMapPop';

/** Paint undo survives hub remounts. Keyed by discovery batch or zone id. */
const undoSessions = new Map();

function undoSession(scope) {
  const key = String(scope || 'shotgun');
  let session = undoSessions.get(key);
  if (!session) {
    session = { stack: [], sync: null };
    undoSessions.set(key, session);
  }
  return session;
}

function clampLabelPx(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return LABEL_PX_DEFAULT;
  return Math.max(LABEL_PX_MIN, Math.min(LABEL_PX_MAX, n));
}

function readLabelPx() {
  try {
    const raw = localStorage.getItem(LABEL_PX_KEY);
    if (raw == null || String(raw).trim() === '') return LABEL_PX_DEFAULT;
    return clampLabelPx(raw);
  } catch {
    return LABEL_PX_DEFAULT;
  }
}

function writeLabelPx(px) {
  try {
    localStorage.setItem(LABEL_PX_KEY, String(px));
  } catch {
    /* ignore */
  }
}

function readSavedMapPop() {
  try {
    const raw = localStorage.getItem(MAP_POP_KEY);
    if (raw == null || String(raw).trim() === '') return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      min: parsed.min == null ? '' : String(parsed.min),
      max: parsed.max == null ? '' : String(parsed.max),
    };
  } catch {
    return null;
  }
}

function writeSavedMapPop(min, max) {
  try {
    localStorage.setItem(
      MAP_POP_KEY,
      JSON.stringify({ min: String(min ?? ''), max: String(max ?? '') }),
    );
  } catch {
    /* ignore */
  }
}

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
      const existing = document.querySelector('script[src*="leaflet@1.9.4/dist/leaflet.js"]');
      const s = existing || document.createElement('script');
      if (!existing) {
        s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        document.head.appendChild(s);
      }
      const timer = setTimeout(() => reject(new Error('Leaflet timed out')), LEAFLET_LOAD_MS);
      const ok = () => {
        clearTimeout(timer);
        resolve();
      };
      const fail = () => {
        clearTimeout(timer);
        reject(new Error('Failed to load Leaflet'));
      };
      if (window.L) {
        ok();
        return;
      }
      s.addEventListener('load', ok, { once: true });
      s.addEventListener('error', fail, { once: true });
    });
  }
  Lref = window.L;
  if (!Lref) throw new Error('Failed to load Leaflet');
  return Lref;
}

function placeKey(name, state) {
  return `${String(name || '')
    .trim()
    .toLowerCase()}|${String(state || '')
    .trim()
    .toUpperCase()}`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtPop(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return String(Math.round(v));
}

function labelHtml(name, pop, inBand, { clusterKey = 0, hub = false } = {}) {
  const oor = inBand ? '' : ' rm-label-oor';
  const label = cityMapLabel(name, clusterKey, { hub });
  return `<span class="rm-label-name${oor}">${esc(label)}</span> <span class="rm-label-pop${oor}">${esc(fmtPop(pop))}</span>`;
}

function destLatLng(lng, lat, miles, bearingDeg) {
  const R = 3958.7613;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const ang = miles / R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [lat2 * (180 / Math.PI), lng2 * (180 / Math.PI)];
}

function addMileRings(L, map, center) {
  const lng = Number(center?.[0]);
  const lat = Number(center?.[1]);
  const layers = [];
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return layers;
  for (let miles = 20; miles <= MAX_CLUSTER_MILES; miles += 20) {
    layers.push(
      L.circle([lat, lng], {
        radius: miles * 1609.34,
        color: '#64748b',
        weight: 2,
        opacity: 0.75,
        dashArray: '6 8',
        fill: false,
        interactive: false,
      }).addTo(map),
    );
    for (let deg = 0; deg < 360; deg += 45) {
      const [la, ln] = destLatLng(lng, lat, miles, deg);
      layers.push(
        L.marker([la, ln], {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: 'sg-mile-label',
            html: `${miles} mi`,
            iconSize: [44, 16],
            iconAnchor: [22, 8],
          }),
        }).addTo(map),
      );
    }
  }
  return layers;
}

function bboxFromCenter(center, miles) {
  const lng = Number(center?.[0]);
  const lat = Number(center?.[1]);
  const pad = Math.max(1, Number(miles) || 30) + 5;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const dLat = pad / 69.172;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLng = pad / (69.172 * Math.max(0.2, Math.abs(cos)));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

function shotgunMapInner(mapHost) {
  let inner =
    mapHost.querySelector('.shotgun-map-inner') ||
    mapHost.querySelector('#discovery-shotgun-map-inner');
  if (!inner) {
    inner = document.createElement('div');
    inner.className = 'shotgun-map-inner';
    if (mapHost.id === 'discovery-map-canvas') inner.id = 'discovery-shotgun-map-inner';
    mapHost.appendChild(inner);
  }
  return inner;
}

function shotgunMapStatus(mapHost, text) {
  let el = mapHost.querySelector('.shotgun-map-placeholder');
  if (!el) {
    el = document.createElement('p');
    el.className = 'muted disc-tool-blurb shotgun-map-placeholder';
    mapHost.appendChild(el);
  }
  const msg = String(text || '').trim();
  if (!msg) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

function haversineMi(lng1, lat1, lng2, lat2) {
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLng = (lng2 - lng1) * toR;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.7613 * Math.asin(Math.min(1, Math.sqrt(a)));
}

const METERS_PER_MI = 1609.34;

function localXyMeters(lat, lng, originLat, originLng) {
  const x = (lng - originLng) * Math.cos((originLat * Math.PI) / 180) * 111320;
  const y = (lat - originLat) * 110540;
  return { x, y };
}

function distPointToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i]?.[0]);
    const yi = Number(ring[i]?.[1]);
    const xj = Number(ring[j]?.[0]);
    const yj = Number(ring[j]?.[1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lng, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates || [];
    if (!rings.length || !pointInRing(lng, lat, rings[0])) return false;
    for (let i = 1; i < rings.length; i += 1) {
      if (pointInRing(lng, lat, rings[i])) return false;
    }
    return true;
  }
  if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates || []) {
      if (pointInGeometry(lng, lat, { type: 'Polygon', coordinates: poly })) return true;
    }
  }
  return false;
}

function iterOuterRings(geometry, fn) {
  if (!geometry) return;
  if (geometry.type === 'Polygon') {
    fn(geometry.coordinates?.[0] || []);
    return;
  }
  if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates || []) fn(poly?.[0] || []);
  }
}

/** True if a GeoJSON polygon intersects a geographic disk (origin lat/lng, radius meters). */
function polygonTouchesDisk(origin, radiusM, geometry) {
  if (!origin || !geometry || !Number.isFinite(radiusM) || radiusM <= 0) return false;
  const oLat = Number(origin.lat);
  const oLng = Number(origin.lng);
  if (!Number.isFinite(oLat) || !Number.isFinite(oLng)) return false;
  if (pointInGeometry(oLng, oLat, geometry)) return true;
  let hit = false;
  iterOuterRings(geometry, (ring) => {
    if (hit || !Array.isArray(ring) || ring.length < 2) return;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (!Array.isArray(a) || a.length < 2) continue;
      const lng = Number(a[0]);
      const lat = Number(a[1]);
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        if (haversineMi(oLng, oLat, lng, lat) * METERS_PER_MI <= radiusM) {
          hit = true;
          return;
        }
      }
      if (!Array.isArray(b) || b.length < 2) continue;
      const axy = localXyMeters(lat, lng, oLat, oLng);
      const bxy = localXyMeters(Number(b[1]), Number(b[0]), oLat, oLng);
      if (distPointToSeg(0, 0, axy.x, axy.y, bxy.x, bxy.y) <= radiusM) {
        hit = true;
      }
    }
  });
  return hit;
}

function featureMiles(feature, center) {
  if (!center) return null;
  const geom = feature?.geometry;
  if (!geom || !Array.isArray(center)) return null;
  let lng = 0;
  let lat = 0;
  let n = 0;
  const add = (pt) => {
    if (!Array.isArray(pt) || pt.length < 2) return;
    lng += Number(pt[0]);
    lat += Number(pt[1]);
    n += 1;
  };
  if (geom.type === 'Polygon') (geom.coordinates?.[0] || []).forEach(add);
  else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates || []) (poly?.[0] || []).forEach(add);
  }
  if (!n) return null;
  return haversineMi(center[0], center[1], lng / n, lat / n);
}

function vertexAverageLatLng(feature) {
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

function labelAnchorLatLng(layer, feature) {
  let preferred = null;
  try {
    const b = typeof layer.getBounds === 'function' ? layer.getBounds() : null;
    if (b && b.isValid()) preferred = b.getCenter();
  } catch {
    /* fall through */
  }
  if (!preferred) preferred = vertexAverageLatLng(feature);
  const geom = feature?.geometry;
  if (!preferred || !geom) return preferred;
  const lng = Number(preferred.lng);
  const lat = Number(preferred.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return preferred;
  const anchored = labelAnchorLngLat(geom, lng, lat);
  if (!anchored || !Lref) return preferred;
  return Lref.latLng(anchored[1], anchored[0]);
}

function membersMapFromWorkspace(workspace) {
  const members = new Map();
  const hub = workspace?.draft?.hub;
  for (const m of workspace?.draft?.members || []) {
    members.set(placeKey(m.city, m.state), {
      role: mapRole(m.role),
      clusterKey: memberClusterKey(m),
    });
  }
  if (hub?.city) {
    const k = placeKey(hub.city, hub.state);
    const prev = members.get(k) || { role: 'hub', clusterKey: 0 };
    members.set(k, { ...prev, role: 'hub' });
  }
  return members;
}

function mapRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'hub' || r === 'main') return 'hub';
  if (r === 'member' || r === 'city' || /^wave([1-9]|10)$/.test(r)) return 'member';
  return r || 'unassigned';
}

function memberAssigned(info) {
  if (!info) return false;
  return info.role === 'hub' || info.role === 'member' || parseClusterKey(info.clusterKey) >= 1;
}

function zoneBands(workspace) {
  const cities = workspace?.settings?.bands?.cities || { min: 2000, max: 60000 };
  return { cities };
}

function combinedPopDefaults(workspace) {
  const bands = zoneBands(workspace);
  const min = Number(bands.cities.min);
  const max = Number(bands.cities.max);
  return {
    min: Number.isFinite(min) ? min : 2000,
    max: Number.isFinite(max) ? max : 60000,
  };
}

/**
 * @param {{
 *   mapHost: HTMLElement,
 *   api: Function,
 *   workspace: object,
 *   slot?: HTMLElement,
 *   onPaint?: (city: string, state: string, payload: object) => Promise<void> | void,
 *   onPaintMany?: (cities: {city:string,state:string}[], payload: object) => Promise<void> | void,
 *   onZoneMilesChange?: (miles: number, range?: object) => Promise<void> | void,
 *   onHandle?: (handle: object) => void,
 *   undoScope?: string,
 * }} opts
 */
export async function mountShotgunMap({
  mapHost,
  api,
  workspace,
  slot,
  onPaint,
  onPaintMany,
  onZoneMilesChange,
  onHandle,
  undoScope,
}) {
  if (!mapHost) return { destroy() {}, invalidateSize() {}, setMembers() {} };
  let hub = workspace?.draft?.hub;
  let rings = workspace?.rings || {};
  mapHost.classList.remove('hidden');
  mapHost.classList.remove('shotgun-map-off');
  mapHost.parentElement?.classList.remove('shotgun-map-off');
  const inner = shotgunMapInner(mapHost);
  const labelHost = slot || document.getElementById('discovery-shotgun-map-slot') || mapHost.parentElement || mapHost;
  const q = (sel) => labelHost.querySelector(sel) || document.querySelector(sel);
  const pickEl = q('.shotgun-map-pick') || document.getElementById('discovery-shotgun-map-pick');
  const pickLabel = q('[data-sg="pick-label"]') || document.getElementById('discovery-shotgun-map-pick-label');
  const minPopEl = q('[data-sg="min-pop"]') || document.getElementById('sg-map-min-pop');
  const maxPopEl = q('[data-sg="max-pop"]') || document.getElementById('sg-map-max-pop');
  const hideOorEl = q('[data-sg="hide-oor"]') || document.getElementById('sg-map-hide-oor');
  const labelSizeEl = q('[data-sg="label-size"]') || document.getElementById('sg-map-label-size');
  const labelIncEl = q('[data-sg="label-inc"]');
  const labelDecEl = q('[data-sg="label-dec"]');
  const paletteEl = q('[data-sg="palette"]') || document.getElementById('sg-map-palette');
  const undoEl = q('[data-sg="undo"]');
  const clearSlotEl = () => q('[data-sg="clear-slot"]');
  const undoScopeKey = String(undoScope || mapHost.id || 'shotgun');
  let undoBusy = false;
  const toolEls = () => [...(labelHost.querySelectorAll('[data-sg-tool]') || [])];
  const zoneMilesEl = q('[data-sg="zone-miles"]') || document.getElementById('sg-map-zone-miles');
  const zoneMiEl = q('[data-sg="zone-mi"]') || document.getElementById('sg-map-zone-mi');

  function applyLabelPx(raw, { persist = false } = {}) {
    const px = clampLabelPx(raw);
    if (labelSizeEl) labelSizeEl.value = String(px);
    if (labelHost?.style) labelHost.style.setProperty('--sg-label-size', `${px}px`);
    if (mapHost?.style && mapHost !== labelHost) {
      mapHost.style.setProperty('--sg-label-size', `${px}px`);
    }
    if (persist) writeLabelPx(px);
    return px;
  }
  applyLabelPx(readLabelPx());

  if (!hub?.city || !hub?.state) {
    shotgunMapStatus(mapHost, 'Pick a hub to load the cluster map.');
    return { destroy() {}, invalidateSize() {}, setMembers() {} };
  }

  shotgunMapStatus(mapHost, 'Loading map…');

  let destroyed = false;
  let map = null;
  let placesLayer = null;
  let canvasRenderer = null;
  let zoneRingLayers = [];
  let members = membersMapFromWorkspace(workspace);
  let settingsWs = workspace;
  let zoneMiles = clampClusterMiles(
    workspace?.draft?.clusterMiles ?? workspace?.settings?.clusterMiles ?? 30,
  );
  let paintTool = lastPaintTool === 'hub' ? 'hub' : 'cluster';
  let paintSlot = 1;
  let selectedKey = '';
  let labelsPermanent = false;
  let labelTimer = null;
  let popTimer = null;
  let radiusTimer = null;
  let loadedMiles = 0;
  let placesFetchGen = 0;
  const SELECT_PX_MIN = 8;
  let selectDrag = null;
  const permanentLabelLayers = new Set();
  const layerByKey = new Map();

  const bump = () => {
    try {
      map?.invalidateSize?.();
    } catch {
      /* ignore */
    }
  };

  function fillPopFields() {
    const saved = readSavedMapPop();
    if (saved) {
      if (minPopEl && String(minPopEl.value).trim() === '') minPopEl.value = saved.min;
      if (maxPopEl && String(maxPopEl.value).trim() === '') maxPopEl.value = saved.max;
      return;
    }
    const d = combinedPopDefaults(settingsWs);
    if (minPopEl && String(minPopEl.value).trim() === '') minPopEl.value = String(d.min);
    if (maxPopEl && String(maxPopEl.value).trim() === '') maxPopEl.value = String(d.max);
  }

  function readZoneMilesFromDraft(ws = settingsWs) {
    return clampClusterMiles(ws?.draft?.clusterMiles ?? ws?.settings?.clusterMiles ?? zoneMiles);
  }

  function outerMiles() {
    return zoneMiles || 30;
  }

  function applyZoneRing() {
    const center = hubCenter();
    if (!map || !Lref || !center) return;
    const lat = center[1];
    const lng = center[0];
    const radius = outerMiles() * 1609.34;
    if (zoneRingLayers[0]) {
      try {
        zoneRingLayers[0].setLatLng([lat, lng]);
        zoneRingLayers[0].setRadius(radius);
        zoneRingLayers[0].setStyle({ color: '#334155', opacity: 0.9, weight: 3 });
      } catch {
        /* ignore */
      }
    } else {
      zoneRingLayers[0] = Lref.circle([lat, lng], {
        radius,
        color: '#334155',
        weight: 3,
        opacity: 0.9,
        fill: false,
        interactive: false,
      }).addTo(map);
    }
    while (zoneRingLayers.length > 1) {
      try {
        map.removeLayer(zoneRingLayers.pop());
      } catch {
        zoneRingLayers.pop();
      }
    }
  }

  function syncZoneSliderDom() {
    if (zoneMilesEl) zoneMilesEl.value = String(zoneMiles);
    if (zoneMiEl) zoneMiEl.textContent = `${zoneMiles} mi`;
  }

  fillPopFields();

  function readMapPopRange() {
    const minRaw = String(minPopEl?.value ?? '').trim();
    const maxRaw = String(maxPopEl?.value ?? '').trim();
    const min = minRaw === '' ? 0 : Number(minRaw);
    const max = maxRaw === '' ? Infinity : Number(maxRaw);
    return {
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : Infinity,
    };
  }

  function hubCenter() {
    return rings.primary?.center;
  }

  function popInMapRange(pop) {
    const n = Number(pop) || 0;
    const { min, max } = readMapPopRange();
    if (n < min) return false;
    if (Number.isFinite(max) && n > max) return false;
    return true;
  }

  function placeHidden(feature) {
    if (!hideOorEl?.checked) return false;
    const p = feature?.properties || {};
    const key = placeKey(p.name || p.city, p.state || hub.state);
    const info = members.get(key);
    if (memberAssigned(info)) return false;
    return !popInMapRange(p.population);
  }

  function inBandFor(pop) {
    return popInMapRange(pop);
  }

  function assignable(pop, miles) {
    if (!Number.isFinite(Number(miles)) || Number(miles) > outerMiles() + 0.5) return false;
    return popInMapRange(pop);
  }

  function featureMilesForKey(key) {
    const layers = layerByKey.get(key) || [];
    for (const lyr of layers) {
      const miles = Number(lyr?.feature?.properties?._sgMiles);
      if (Number.isFinite(miles)) return miles;
    }
    return NaN;
  }

  function pruneLocalMembersOutsideRadius() {
    const cap = outerMiles() + 0.5;
    const hubKey = placeKey(hub?.city, hub?.state);
    for (const key of [...members.keys()]) {
      if (hubKey && key === hubKey) continue;
      const info = members.get(key);
      if (!info || parseClusterKey(info.clusterKey) < 1) continue;
      const miles = featureMilesForKey(key);
      if (!Number.isFinite(miles)) continue;
      if (miles > cap) members.delete(key);
    }
  }

  function styleFor(feature, { selected = false } = {}) {
    const p = feature?.properties || {};
    const key = placeKey(p.name || p.city, p.state || hub.state);
    const info = members.get(key) || {};
    const pop = Number(p.population);
    const miles = Number(p._sgMiles);
    const inZone = inBandFor(pop) && Number.isFinite(miles) && miles <= outerMiles() + 0.5;
    const isHub = info.role === 'hub';
    const ck = parseClusterKey(info.clusterKey);
    if (isHub) {
      const fill = clusterColor(ck) || '#3b82f6';
      return {
        color: selected ? '#1e3a8a' : '#1d4ed8',
        weight: selected ? 4 : 3,
        fillColor: fill,
        fillOpacity: 0.55,
        fillRule: 'nonzero',
      };
    }
    if (ck >= 1) {
      const fill = clusterColor(ck);
      return {
        color: selected ? fill : fill,
        weight: selected ? 3 : 2,
        fillColor: fill,
        fillOpacity: 0.45,
        fillRule: 'nonzero',
      };
    }
    if (!inZone) {
      return {
        color: selected ? '#991b1b' : '#dc2626',
        weight: selected ? 2.5 : 2,
        fillColor: selected ? '#f87171' : '#fecaca',
        fillOpacity: selected ? 0.4 : 0.12,
        fillRule: 'nonzero',
      };
    }
    return {
      color: selected ? '#334155' : '#475569',
      weight: selected ? 2.5 : 2,
      fillColor: '#cbd5e1',
      fillOpacity: 0.12,
      fillRule: 'nonzero',
    };
  }

  function tooltipBits(feature) {
    const p = feature?.properties || {};
    const key = placeKey(p.name, p.state);
    const info = members.get(key) || {};
    const inRange =
      memberAssigned(info) || assignable(p.population, p._sgMiles);
    return { p, key, info, inRange };
  }

  function bindHoverTooltip(layer, feature) {
    const { p, info, inRange } = tooltipBits(feature);
    if (layer.getTooltip()) layer.unbindTooltip();
    if (placeHidden(feature) || !isLargestPart(feature)) return;
    layer.bindTooltip(
      labelHtml(p.name, p.population, inRange, {
        clusterKey: info.clusterKey,
        hub: info.role === 'hub',
      }),
      {
        permanent: false,
        direction: 'center',
        className: inRange ? 'rm-tooltip' : 'rm-tooltip rm-tooltip-oor',
        sticky: true,
      },
    );
  }

  function setPermanentTooltip(layer, feature, on) {
    if (layer.getTooltip()) layer.unbindTooltip();
    if (on) {
      if (placeHidden(feature) || !isLargestPart(feature)) return;
      const { p, info, inRange } = tooltipBits(feature);
      layer.bindTooltip(
        labelHtml(p.name, p.population, inRange, {
          clusterKey: info.clusterKey,
          hub: info.role === 'hub',
        }),
        {
          permanent: true,
          direction: 'center',
          className: inRange ? 'rm-tooltip rm-tooltip-permanent' : 'rm-tooltip rm-tooltip-permanent rm-tooltip-oor',
          opacity: 0.95,
        },
      );
      const tip = layer.getTooltip();
      const anchor = labelAnchorLatLng(layer, feature);
      if (tip && anchor) tip.setLatLng(anchor);
      permanentLabelLayers.add(layer);
    } else {
      if (isLargestPart(feature)) bindHoverTooltip(layer, feature);
      permanentLabelLayers.delete(layer);
    }
  }

  function updatePermanentLabels() {
    if (!map || !placesLayer) return;
    const want = map.getZoom() >= LABEL_ZOOM;
    if (!want) {
      for (const layer of [...permanentLabelLayers]) {
        setPermanentTooltip(layer, layer.feature, false);
      }
      labelsPermanent = false;
      return;
    }
    labelsPermanent = true;
    const bounds = map.getBounds();
    const candidates = [];
    placesLayer.eachLayer((layer) => {
      const f = layer.feature;
      if (!f || !isLargestPart(f) || placeHidden(f)) return;
      try {
        const b = layer.getBounds?.();
        if (b && b.isValid() && !bounds.intersects(b)) return;
      } catch {
        return;
      }
      candidates.push({ layer, feature: f, pop: Number(f.properties?.population) || 0 });
    });
    candidates.sort((a, b) => b.pop - a.pop);
    const keep = new Set(candidates.slice(0, LABEL_CAP).map((c) => c.layer));
    for (const layer of [...permanentLabelLayers]) {
      if (!keep.has(layer)) setPermanentTooltip(layer, layer.feature, false);
    }
    for (const { layer, feature } of candidates.slice(0, LABEL_CAP)) {
      setPermanentTooltip(layer, feature, true);
    }
  }

  function restyleAll() {
    if (!placesLayer) return;
    if (selectedKey) {
      const sel = layerByKey.get(selectedKey)?.[0]?.feature;
      if (sel && placeHidden(sel)) selectedKey = '';
    }
    placesLayer.eachLayer((layer) => {
      const f = layer.feature;
      if (!f) return;
      const key = placeKey(f.properties?.name, f.properties?.state);
      const hidden = placeHidden(f);
      try {
        layer.setStyle(
          hidden
            ? { opacity: 0, fillOpacity: 0, weight: 0, fillRule: 'nonzero' }
            : styleFor(f, { selected: key === selectedKey }),
        );
        if (layer.options) layer.options.interactive = !hidden;
      } catch {
        /* ignore */
      }
      if (hidden) {
        if (layer.getTooltip()) layer.unbindTooltip();
        permanentLabelLayers.delete(layer);
        return;
      }
      if (!permanentLabelLayers.has(layer) && isLargestPart(f)) bindHoverTooltip(layer, f);
    });
    updatePermanentLabels();
    syncPickBar();
  }

  function scheduleLabelUpdate() {
    clearTimeout(labelTimer);
    labelTimer = setTimeout(() => updatePermanentLabels(), 100);
  }

  function selectedProps() {
    if (!selectedKey) return null;
    const layers = layerByKey.get(selectedKey) || [];
    const f = layers[0]?.feature;
    return f?.properties || null;
  }

  function renderPalette() {
    if (!paletteEl) return;
    paletteEl.innerHTML = '';
    const hubIdle = paintTool === 'hub';
    paletteEl.classList.toggle('sg-map-palette-idle', hubIdle);
    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'btn btn-sm sg-map-slot sg-map-slot-none';
    none.dataset.slot = '0';
    none.textContent = '×';
    const clearTip = 'Clear cluster';
    none.setAttribute('aria-label', clearTip);
    none.setAttribute('data-tip', clearTip);
    none.classList.toggle('active', paintSlot === 0 && !hubIdle);
    none.addEventListener('click', () => {
      setPaintTool('cluster');
      setPaintSlot(0);
    });
    const clearSlot = clearSlotEl();
    if (clearSlot) {
      clearSlot.innerHTML = '';
      clearSlot.classList.toggle('sg-map-palette-idle', hubIdle);
      clearSlot.appendChild(none);
    } else {
      paletteEl.appendChild(none);
    }
    const grid = document.createElement('div');
    grid.className = 'sg-map-palette-grid';
    for (let n = 1; n <= CLUSTER_MAX; n += 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm sg-map-slot';
      btn.dataset.slot = String(n);
      btn.textContent = String(n);
      if (paintTool === 'cluster') {
        const fill = clusterColor(n);
        btn.style.background = fill;
        btn.style.borderColor = fill;
        btn.style.color = '#fff';
      }
      btn.classList.toggle('active', paintSlot === n);
      btn.addEventListener('click', () => {
        setPaintTool('cluster');
        setPaintSlot(n);
      });
      grid.appendChild(btn);
    }
    paletteEl.appendChild(grid);
    toolEls().forEach((b) => {
      b.classList.toggle('active', b.dataset.sgTool === paintTool);
    });
    syncPickBar();
  }

  function setPaintTool(tool) {
    const t = String(tool || '').toLowerCase();
    paintTool = t === 'hub' ? 'hub' : 'cluster';
    lastPaintTool = paintTool;
    renderPalette();
  }

  function setPaintSlot(n) {
    const v = Math.round(Number(n));
    paintSlot = Number.isFinite(v) && v >= 0 && v <= CLUSTER_MAX ? v : 0;
    renderPalette();
  }

  function syncPickBar() {
    if (!pickEl) return;
    pickEl.classList.remove('hidden');
    const p = selectedProps();
    if (!p) {
      if (pickLabel) {
        pickLabel.textContent = '';
        pickLabel.classList.add('hidden');
        pickLabel.hidden = true;
      }
      return;
    }
    const key = placeKey(p.name, p.state);
    const info = members.get(key) || {};
    const bits = [];
    if (info.role === 'hub') bits.push('Hub');
    if (parseClusterKey(info.clusterKey)) bits.push(`Cluster ${info.clusterKey}`);
    if (pickLabel) {
      pickLabel.textContent = `${p.name}, ${p.state} · ${fmtPop(p.population)}${bits.length ? ` · ${bits.join(' · ')}` : ''}`;
      pickLabel.classList.remove('hidden');
      pickLabel.hidden = false;
    }
  }

  function selectKey(key) {
    selectedKey = key || '';
    restyleAll();
  }

  function boundsForKey(key) {
    const layers = layerByKey.get(key) || [];
    let bounds = null;
    for (const lyr of layers) {
      try {
        const b = lyr.getBounds?.();
        if (!b?.isValid()) continue;
        bounds = bounds ? bounds.extend(b) : b.pad(0);
      } catch {
        /* ignore */
      }
    }
    return bounds;
  }

  function fitCityBounds(key) {
    if (!map) return;
    const b = boundsForKey(key);
    if (!b?.isValid()) return;
    map.invalidateSize();
    map.fitBounds(b.pad(0.35));
  }

  function focusCity(city, state) {
    const key = placeKey(city, state);
    if (!layerByKey.has(key)) return;
    selectKey(key);
    fitCityBounds(key);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => fitCityBounds(key));
    });
  }

  async function loadPlaces({ force = false } = {}) {
    if (!map || !Lref) return;
    const miles = outerMiles();
    if (
      !force &&
      Number.isFinite(loadedMiles) &&
      miles <= loadedMiles &&
      placesLayer
    ) {
      restyleAll();
      return;
    }
    const gen = ++placesFetchGen;
    const center = hubCenter();
    const bbox = bboxFromCenter(center, miles);
    const qs = new URLSearchParams({
      layer: 'places',
      minPop: '0',
    });
    if (bbox) qs.set('bbox', bbox.map((n) => n.toFixed(5)).join(','));

    if (!placesLayer) shotgunMapStatus(mapHost, 'Loading map…');
    let geoError = '';
    let data = null;
    try {
      data = await api(`/api/map/geojson?${qs.toString()}`);
    } catch (error) {
      geoError = error?.message || 'Map places failed';
    }
    if (destroyed || gen !== placesFetchGen) return;
    if (geoError && !data) {
      shotgunMapStatus(mapHost, geoError);
      return;
    }

    const features = (data?.features || []).map((f) => {
      const miles = featureMiles(f, center);
      return {
        ...f,
        properties: { ...f.properties, _sgMiles: miles },
      };
    });

    if (placesLayer) {
      try {
        map.removeLayer(placesLayer);
      } catch {
        /* ignore */
      }
      placesLayer = null;
    }
    permanentLabelLayers.clear();
    layerByKey.clear();

    loadedMiles = Math.max(Number.isFinite(loadedMiles) ? loadedMiles : miles, miles);

    if (features.length) {
      placesLayer = Lref.geoJSON(explodePlaceFeatures({ type: 'FeatureCollection', features }), {
        renderer: canvasRenderer,
        style: (feature) => styleFor(feature, { selected: false }),
        onEachFeature: (feature, lyr) => {
          const name = feature?.properties?.name || feature?.properties?.city;
          const st = feature?.properties?.state || hub.state;
          const key = placeKey(name, st);
          if (!layerByKey.has(key)) layerByKey.set(key, []);
          layerByKey.get(key).push(lyr);
          if (isLargestPart(feature)) bindHoverTooltip(lyr, feature);
          lyr.on('click', () => {
            if (placeHidden(feature)) return;
            selectKey(key);
            void applyPaint(name, st);
          });
        },
      }).addTo(map);
    }
    if (placesLayer) restyleAll();
    else syncPickBar();
    scheduleLabelUpdate();
    shotgunMapStatus(mapHost, geoError || rings.error || '');
  }

  function previousClusterSlot(city, state) {
    const info = members.get(placeKey(city, state));
    return parseClusterKey(info?.clusterKey) || 0;
  }

  function captureClusterPaint(city, state) {
    const prev = previousClusterSlot(city, state);
    const want = parseClusterKey(paintSlot) || 0;
    const next = !want || prev === want ? 0 : want;
    if (next === prev) return null;
    return { type: 'paint', city, state, slot: prev };
  }

  function capturePaintMany(cities) {
    const want = parseClusterKey(paintSlot) || 0;
    const changed = [];
    for (const c of cities || []) {
      if (!c?.city || !c?.state) continue;
      const prev = previousClusterSlot(c.city, c.state);
      if (prev === want) continue;
      changed.push({ city: c.city, state: c.state, slot: prev });
    }
    if (!changed.length) return null;
    if (changed.length === 1) return { type: 'paint', ...changed[0] };
    return { type: 'paints', cities: changed };
  }

  function captureHubPaint(city, state) {
    const key = placeKey(city, state);
    const hubKey = placeKey(hub?.city, hub?.state);
    if (!key || !hubKey || key === hubKey) return null;
    return { type: 'hub', city: hub.city, state: hub.state };
  }

  function syncUndoButton() {
    if (!undoEl) return;
    const session = undoSession(undoScopeKey);
    undoEl.disabled = undoBusy || session.stack.length === 0;
  }

  function pushUndo(entry) {
    if (!entry) return;
    undoSession(undoScopeKey).stack.push(entry);
    syncUndoButton();
  }

  function dropUndo(entry) {
    if (!entry) return;
    const session = undoSession(undoScopeKey);
    const idx = session.stack.lastIndexOf(entry);
    if (idx >= 0) session.stack.splice(idx, 1);
    (session.sync || syncUndoButton)();
  }

  async function replayUndo(entry) {
    if (entry?.type === 'hub') {
      if (!onPaint) return { error: new Error('Undo is unavailable'), restore: entry };
      try {
        await onPaint(entry.city, entry.state, { tool: 'hub', radiusMiles: outerMiles() });
        return null;
      } catch (error) {
        return { error, restore: entry };
      }
    }
    const cities =
      entry?.type === 'paints'
        ? entry.cities
        : [{ city: entry?.city, state: entry?.state, slot: entry?.slot }];
    for (let i = 0; i < cities.length; i += 1) {
      const c = cities[i];
      try {
        if (!onPaint) throw new Error('Undo is unavailable');
        await onPaint(c.city, c.state, {
          tool: 'cluster',
          slot: c.slot,
          radiusMiles: outerMiles(),
        });
      } catch (error) {
        const rest = cities.slice(i);
        const restore =
          rest.length === 1 ? { type: 'paint', ...rest[0] } : { type: 'paints', cities: rest };
        return { error, restore };
      }
    }
    return null;
  }

  async function onUndoClick() {
    if (undoBusy) return;
    const session = undoSession(undoScopeKey);
    const entry = session.stack[session.stack.length - 1];
    if (!entry) return;
    session.stack.pop();
    undoBusy = true;
    syncUndoButton();
    let failed = null;
    try {
      failed = await replayUndo(entry);
    } catch (error) {
      failed = { error, restore: entry };
    }
    undoBusy = false;
    if (failed?.restore) {
      undoSession(undoScopeKey).stack.push(failed.restore);
      shotgunMapStatus(mapHost, failed.error?.message || 'Could not undo');
    } else {
      shotgunMapStatus(mapHost, '');
    }
    (undoSession(undoScopeKey).sync || syncUndoButton)();
  }

  undoSession(undoScopeKey).sync = syncUndoButton;
  syncUndoButton();
  undoEl?.addEventListener('click', onUndoClick);

  async function applyPaint(city, st) {
    const entry = paintTool === 'hub' ? captureHubPaint(city, st) : captureClusterPaint(city, st);
    if (entry) pushUndo(entry);
    const payload = {
      tool: paintTool,
      slot: paintSlot,
      radiusMiles: outerMiles(),
    };
    try {
      if (!onPaint) {
        dropUndo(entry);
        return;
      }
      await onPaint(city, st, { ...payload, tool: paintTool === 'hub' ? 'hub' : 'cluster' });
      shotgunMapStatus(mapHost, '');
    } catch (error) {
      dropUndo(entry);
      shotgunMapStatus(mapHost, error?.message || 'Could not update city');
    }
  }

  function selectCircleColor() {
    if (paintSlot >= 1) return clusterColor(paintSlot) || '#334155';
    return '#64748b';
  }

  function citiesInSelectCircle(origin, radiusM) {
    if (!origin || !Number.isFinite(radiusM) || radiusM <= 0) return [];
    const hubKey = placeKey(hub?.city, hub?.state);
    const cap = outerMiles() + 0.5;
    const seen = new Set();
    const out = [];
    for (const [key, layers] of layerByKey) {
      if (!key || key === hubKey || seen.has(key)) continue;
      let touched = false;
      let picked = null;
      for (const lyr of layers || []) {
        const feature = lyr?.feature;
        if (!feature) continue;
        const p = feature.properties || {};
        if (!popInMapRange(p.population)) continue;
        const miles = Number(p._sgMiles);
        if (Number.isFinite(miles) && miles > cap) continue;
        if (polygonTouchesDisk(origin, radiusM, feature.geometry)) {
          touched = true;
          picked = p;
          break;
        }
      }
      if (!touched || !picked) continue;
      seen.add(key);
      out.push({
        city: picked.name || picked.city,
        state: picked.state || hub.state,
      });
    }
    return out.filter((c) => c.city && c.state);
  }

  function clearSelectCircle() {
    if (selectDrag?.layer && map) {
      try {
        map.removeLayer(selectDrag.layer);
      } catch {
        /* ignore */
      }
    }
    selectDrag = null;
  }

  async function applyPaintMany(cities) {
    if (!cities.length) return;
    const entry = capturePaintMany(cities);
    if (entry) pushUndo(entry);
    const payload = {
      tool: 'cluster',
      slot: paintSlot,
      radiusMiles: outerMiles(),
    };
    try {
      if (onPaintMany) {
        await onPaintMany(cities, payload);
      } else if (onPaint) {
        for (const c of cities) {
          await onPaint(c.city, c.state, payload);
        }
      } else {
        dropUndo(entry);
        return;
      }
      shotgunMapStatus(mapHost, '');
    } catch (error) {
      dropUndo(entry);
      shotgunMapStatus(mapHost, error?.message || 'Could not update cities');
    }
  }

  function onMapContextMenu(e) {
    e.preventDefault();
  }

  function onSelectMouseDown(e) {
    if (e.originalEvent?.button !== 2 || !map || !Lref) return;
    e.originalEvent.preventDefault();
    clearSelectCircle();
    const origin = e.latlng;
    const layer = Lref.circle(origin, {
      radius: 1,
      color: selectCircleColor(),
      weight: 2,
      opacity: 0.95,
      fillColor: selectCircleColor(),
      fillOpacity: 0.12,
      interactive: false,
    }).addTo(map);
    selectDrag = {
      origin,
      layer,
      startX: e.originalEvent.clientX,
      startY: e.originalEvent.clientY,
    };
  }

  function onSelectMouseMove(e) {
    if (!selectDrag?.layer || !e.latlng) return;
    const radius = selectDrag.origin.distanceTo(e.latlng);
    try {
      selectDrag.layer.setRadius(Math.max(1, radius));
      selectDrag.layer.setStyle({ color: selectCircleColor(), fillColor: selectCircleColor() });
    } catch {
      /* ignore */
    }
  }

  function onSelectMouseUp(e) {
    if (!selectDrag) return;
    const startX = selectDrag.startX;
    const startY = selectDrag.startY;
    const origin = selectDrag.origin;
    const layer = selectDrag.layer;
    const ev = e?.originalEvent || e;
    const dx = (ev?.clientX ?? startX) - startX;
    const dy = (ev?.clientY ?? startY) - startY;
    const px = Math.hypot(dx, dy);
    let radiusM = 0;
    try {
      radiusM = Number(layer?.getRadius?.()) || 0;
    } catch {
      radiusM = 0;
    }
    clearSelectCircle();
    if (px < SELECT_PX_MIN || radiusM < 50) return;
    const cities = citiesInSelectCircle(origin, radiusM);
    if (!cities.length) return;
    void applyPaintMany(cities);
  }

  const popRangeForCommit = () => {
    const range = readMapPopRange();
    return {
      minPop: range.min,
      maxPop: Number.isFinite(range.max) ? range.max : 50_000_000,
    };
  };
  const commitZoneMiles = () => {
    clearTimeout(radiusTimer);
    radiusTimer = setTimeout(() => {
      if (outerMiles() > loadedMiles) void loadPlaces();
      void onZoneMilesChange?.(zoneMiles, popRangeForCommit());
    }, 300);
  };
  const onZoneSliderInput = () => {
    zoneMiles = clampClusterMiles(zoneMilesEl?.value);
    syncZoneSliderDom();
    applyZoneRing();
    pruneLocalMembersOutsideRadius();
    restyleAll();
    commitZoneMiles();
  };
  const onPopInput = () => {
    writeSavedMapPop(minPopEl?.value ?? '', maxPopEl?.value ?? '');
    clearTimeout(popTimer);
    popTimer = setTimeout(() => {
      restyleAll();
      void onZoneMilesChange?.(zoneMiles, popRangeForCommit());
    }, 300);
  };
  const onToolClick = (e) => {
    const t = e.currentTarget?.dataset?.sgTool;
    if (t) setPaintTool(t);
  };
  const onKeyPaint = (e) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === 'h' || e.key === 'H') {
      setPaintTool('hub');
      return;
    }
    if (e.key === '0') {
      setPaintTool('cluster');
      setPaintSlot(10);
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Escape' || e.key === 'x' || e.key === 'X') {
      setPaintTool('cluster');
      setPaintSlot(0);
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      setPaintTool('cluster');
      setPaintSlot(Number(e.key));
    }
  };
  toolEls().forEach((b) => b.addEventListener('click', onToolClick));
  document.addEventListener('keydown', onKeyPaint);
  fillPopFields();
  syncZoneSliderDom();
  renderPalette();
  syncPickBar();
  const onHideOorChange = () => restyleAll();
  minPopEl?.addEventListener('input', onPopInput);
  maxPopEl?.addEventListener('input', onPopInput);
  hideOorEl?.addEventListener('change', onHideOorChange);
  const onLabelSizeInput = () => {
    const n = Number(labelSizeEl?.value);
    if (!Number.isFinite(n)) return;
    if (n < LABEL_PX_MIN || n > LABEL_PX_MAX) return;
    applyLabelPx(n, { persist: true });
  };
  const onLabelSizeCommit = () => applyLabelPx(labelSizeEl?.value, { persist: true });
  const onLabelInc = () => applyLabelPx(clampLabelPx(labelSizeEl?.value) + 1, { persist: true });
  const onLabelDec = () => applyLabelPx(clampLabelPx(labelSizeEl?.value) - 1, { persist: true });
  labelSizeEl?.addEventListener('input', onLabelSizeInput);
  labelSizeEl?.addEventListener('change', onLabelSizeCommit);
  labelSizeEl?.addEventListener('blur', onLabelSizeCommit);
  labelIncEl?.addEventListener('click', onLabelInc);
  labelDecEl?.addEventListener('click', onLabelDec);
  zoneMilesEl?.addEventListener('input', onZoneSliderInput);

  const handle = {
    destroy() {
      destroyed = true;
      clearTimeout(labelTimer);
      clearTimeout(popTimer);
      clearTimeout(radiusTimer);
      undoEl?.removeEventListener('click', onUndoClick);
      if (undoSession(undoScopeKey).sync === syncUndoButton) {
        undoSession(undoScopeKey).sync = null;
      }
      toolEls().forEach((b) => b.removeEventListener('click', onToolClick));
      document.removeEventListener('keydown', onKeyPaint);
      minPopEl?.removeEventListener('input', onPopInput);
      maxPopEl?.removeEventListener('input', onPopInput);
      hideOorEl?.removeEventListener('change', onHideOorChange);
      labelSizeEl?.removeEventListener('input', onLabelSizeInput);
      labelSizeEl?.removeEventListener('change', onLabelSizeCommit);
      labelSizeEl?.removeEventListener('blur', onLabelSizeCommit);
      labelIncEl?.removeEventListener('click', onLabelInc);
      labelDecEl?.removeEventListener('click', onLabelDec);
      zoneMilesEl?.removeEventListener('input', onZoneSliderInput);
      try {
        map?.getContainer()?.removeEventListener('contextmenu', onMapContextMenu);
        map?.off('mousedown', onSelectMouseDown);
        map?.off('mousemove', onSelectMouseMove);
      } catch {
        /* ignore */
      }
      window.removeEventListener('mouseup', onSelectMouseUp);
      clearSelectCircle();
      try {
        map?.remove();
      } catch {
        /* ignore */
      }
      map = null;
      placesLayer = null;
      zoneRingLayers = [];
    },
    invalidateSize() {
      bump();
      scheduleLabelUpdate();
    },
    setMembers(nextWorkspace) {
      if (!nextWorkspace) return;
      const prevHubKey = placeKey(hub?.city, hub?.state);
      settingsWs = nextWorkspace;
      rings = nextWorkspace.rings || rings;
      hub = nextWorkspace?.draft?.hub || hub;
      members = membersMapFromWorkspace(nextWorkspace);
      zoneMiles = readZoneMilesFromDraft(nextWorkspace);
      pruneLocalMembersOutsideRadius();
      syncZoneSliderDom();
      applyZoneRing();
      restyleAll();
      const nextHubKey = placeKey(hub?.city, hub?.state);
      if (outerMiles() > loadedMiles || prevHubKey !== nextHubKey) void loadPlaces({ force: true });
    },
    focusCity,
  };
  onHandle?.(handle);

  try {
    const L = await ensureLeaflet();
    if (destroyed) return handle;
    inner.innerHTML = '';
    if (inner._leaflet_id) {
      try {
        delete inner._leaflet_id;
      } catch {
        /* ignore */
      }
    }
    map = L.map(inner, { scrollWheelZoom: true });
    canvasRenderer = L.canvas({ padding: 0.5 });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 18,
    }).addTo(map);

    const center = rings.primary?.center;
    if (center) map.setView([center[1], center[0]], 10);
    else map.setView([39, -98], 5);

    if (center) {
      applyZoneRing();
      addMileRings(L, map, center);
    }

    shotgunMapStatus(mapHost, rings.error || '');
    requestAnimationFrame(bump);
    setTimeout(bump, 80);

    map.on('zoomend moveend', scheduleLabelUpdate);
    map.getContainer()?.addEventListener('contextmenu', onMapContextMenu);
    map.on('mousedown', onSelectMouseDown);
    map.on('mousemove', onSelectMouseMove);
    window.addEventListener('mouseup', onSelectMouseUp);
    await loadPlaces({ force: true });
    if (destroyed) return handle;

    requestAnimationFrame(bump);
    setTimeout(bump, 200);
    setTimeout(() => {
      bump();
      scheduleLabelUpdate();
    }, 400);
  } catch (error) {
    shotgunMapStatus(mapHost, error?.message || 'Zone map failed');
  }

  return handle;
}
