/**
 * Coverage map SVG from site-config coverage areas / suburbs.
 * Census TIGER place polygons first (same as the Service area picker); Nominatim fallback.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { pathsFor, getCandidateDetail, getCandidateShell, loadMeta, saveMeta } from './candidates.mjs';
import { syncSiteImagesToPublic } from './fill-site-images.mjs';
import { findPlaceFeatureLocal } from './geo-neighbors.mjs';
import { ensureAlsoServingOnSiteConfig } from './also-serving.mjs';

const ROOT = process.cwd();
const MAP_VARIANT_CAP = 2;

function unlinkQuiet(abs) {
  try {
    if (existsSync(abs)) unlinkSync(abs);
  } catch {
    /* ignore */
  }
}

function mapVariantStamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function isMapVariantFilename(name) {
  return /^coverage-map-var-[a-z0-9]+\.svg$/i.test(String(name || ''));
}

function trimMapVariants(dir, variants, cap = MAP_VARIANT_CAP) {
  const kept = (variants || []).slice(0, cap);
  const dropped = (variants || []).slice(cap);
  for (const v of dropped) {
    const name = path.basename(String(v?.filename || ''));
    if (name) unlinkQuiet(path.join(dir, name));
  }
  return kept;
}

function archiveLiveCoverageMapToTray(candidateId) {
  const p = pathsFor(candidateId);
  const live = path.join(p.siteImages, 'coverage-map.svg');
  if (!existsSync(live)) {
    const meta = loadMeta(candidateId);
    return Array.isArray(meta.coverageMapVariants) ? meta.coverageMapVariants : [];
  }
  mkdirSync(p.siteImages, { recursive: true });
  const destName = `coverage-map-var-${mapVariantStamp()}.svg`;
  copyFileSync(live, path.join(p.siteImages, destName));
  const meta = loadMeta(candidateId);
  const next = trimMapVariants(p.siteImages, [
    {
      filename: destName,
      at: new Date().toISOString(),
      labelPlacement: meta.coverageMapLabelPlacement || null,
    },
    ...(Array.isArray(meta.coverageMapVariants) ? meta.coverageMapVariants : []),
  ]);
  saveMeta(candidateId, { coverageMapVariants: next });
  return next;
}

/** In-memory per-candidate progress for Website poll + Accept SSE. */
const coverageMapProgressById = new Map();

export function setCoverageMapProgress(candidateId, patch = {}) {
  const id = String(candidateId || '');
  if (!id) return;
  const prev = coverageMapProgressById.get(id) || {};
  coverageMapProgressById.set(id, {
    ...prev,
    ...patch,
    updatedAt: Date.now(),
  });
}

export function getCoverageMapProgress(candidateId) {
  const snap = coverageMapProgressById.get(String(candidateId || ''));
  if (!snap) return { ok: true, active: false };
  return {
    ok: true,
    active: snap.status === 'running',
    ...snap,
  };
}

export function clearCoverageMapProgress(candidateId) {
  coverageMapProgressById.delete(String(candidateId || ''));
}

function coverageAreasFromConfig(config) {
  return (
    config?.coverageAreas?.length
      ? config.coverageAreas
      : [
          { name: config?.primaryCity, state: config?.state },
          ...(config?.targetSuburbs || []).map((name) => ({
            name: typeof name === 'string' ? name : name?.name || name?.city,
            state: config?.state,
          })),
        ]
  ).filter((a) => a?.name && a?.state);
}

/** Lowercased names of SEO location pages (primary + targetSuburbs). */
export function pageCityNamesFromConfig(config) {
  return [config?.primaryCity, ...(config?.targetSuburbs || [])]
    .map((n) =>
      String(typeof n === 'string' ? n : n?.name || n?.city || '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const escapeXml = (value) =>
  String(value).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c],
  );

/** Match content-markdown slugifyContentName (avoid circular import). */
function slugifyAreaName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function polygonsFromGeometry(geometry) {
  if (!geometry) return [];
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

function uniqueCoordSet(values, digits = 5) {
  const set = new Set();
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) set.add(n.toFixed(digits));
  }
  return set;
}

/** Nominatim often returns a 4-corner bounding box instead of a municipal outline. */
function isAxisAlignedBBox(geometry) {
  const ring = polygonsFromGeometry(geometry)?.[0]?.[0];
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const pts = ring.filter((p) => Array.isArray(p) && p.length >= 2);
  const lngs = uniqueCoordSet(pts.map((p) => p[0]));
  const lats = uniqueCoordSet(pts.map((p) => p[1]));
  return lngs.size === 2 && lats.size === 2 && pts.length <= 6;
}

function usablePolygonGeometry(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return false;
  if (isAxisAlignedBBox(geometry)) return false;
  return polygonsFromGeometry(geometry).some((poly) => Array.isArray(poly?.[0]) && poly[0].length >= 4);
}

const NOMINATIM_SKIP_TYPES = new Set([
  'park',
  'nature_reserve',
  'protected_area',
  'national_park',
  'county',
  'state',
  'country',
  'continent',
]);
const NOMINATIM_PREFER_TYPES = new Set([
  'city',
  'town',
  'village',
  'suburb',
  'hamlet',
  'municipality',
  'administrative',
  'locality',
  'neighbourhood',
  'cdp',
]);

function nominatimType(feature) {
  const props = feature?.properties || {};
  return String(props.type || props.addresstype || props.place_rank || '').toLowerCase();
}

function nominatimClass(feature) {
  return String(feature?.properties?.class || feature?.properties?.category || '').toLowerCase();
}

function isSkippedNominatimFeature(feature) {
  const t = nominatimType(feature);
  const c = nominatimClass(feature);
  if (NOMINATIM_SKIP_TYPES.has(t)) return true;
  if (c === 'leisure' || c === 'natural' || c === 'landuse') return true;
  return false;
}

function isPreferredNominatimFeature(feature) {
  if (isSkippedNominatimFeature(feature)) return false;
  const t = nominatimType(feature);
  const c = nominatimClass(feature);
  if (NOMINATIM_PREFER_TYPES.has(t)) return true;
  if (c === 'place' || c === 'boundary') return true;
  return false;
}

function pickNominatimFeature(features = []) {
  const usable = features.filter(
    (f) => usablePolygonGeometry(f?.geometry) && !isSkippedNominatimFeature(f),
  );
  return usable.find(isPreferredNominatimFeature) || usable[0] || null;
}

function censusBoundary(area) {
  try {
    const feature = findPlaceFeatureLocal(area.name, area.state);
    if (!usablePolygonGeometry(feature?.geometry)) return null;
    return { ...area, geometry: feature.geometry, source: 'census' };
  } catch {
    return null;
  }
}

async function fetchNominatimBoundary(area, userAgent) {
  const name = String(area.name || '').trim();
  const state = String(area.state || '').trim();
  const aliases = [name];
  if (/^west valley$/i.test(name)) aliases.push('West Valley City');
  if (/^salt lake$/i.test(name)) aliases.push('Salt Lake City');
  if (/^white$/i.test(name)) aliases.push('White City');

  let lastErr = null;
  for (const qName of aliases) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({
      q: `${qName}, ${state}, USA`,
      format: 'geojson',
      polygon_geojson: '1',
      addressdetails: '1',
      countrycodes: 'us',
      limit: '5',
    });
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          'Accept-Language': 'en-US,en',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        lastErr = new Error(`Boundary lookup failed for ${qName}: ${response.status}`);
        continue;
      }
      const data = await response.json();
      const feature = pickNominatimFeature(data.features || []);
      if (!feature?.geometry) {
        lastErr = new Error(`No municipal boundary found for ${qName}, ${state}`);
        continue;
      }
      return {
        ...area,
        name: qName === name ? name : qName,
        geometry: feature.geometry,
        source: 'nominatim',
      };
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        lastErr = new Error(`Boundary lookup timed out for ${qName}, ${state}`);
      } else {
        lastErr = e;
      }
    } finally {
      await sleep(1100);
    }
  }
  throw lastErr || new Error(`No municipal boundary found for ${name}, ${state}`);
}

async function fetchBoundary(area, userAgent) {
  const fromCensus = censusBoundary(area);
  if (fromCensus) return fromCensus;
  return fetchNominatimBoundary(area, userAgent);
}

function geographicArea(geometry) {
  return geometryProjectedArea(geometry, ([lng, lat]) => [lng, lat]);
}

/**
 * Drop mistaken giant polygons (county/state vs a village median).
 * Never drop SEO location-page cities — they are allowed to be larger than
 * the also-served towns that set the median.
 */
export function dropAreaOutliers(boundaries, { keepNames } = {}) {
  if (!Array.isArray(boundaries) || boundaries.length < 2) return boundaries;
  const keep = new Set(
    (keepNames || []).map((n) => String(n || '').trim().toLowerCase()).filter(Boolean),
  );
  const areas = boundaries.map((b) => geographicArea(b.geometry));
  const sorted = areas.filter((a) => a > 0).sort((a, b) => a - b);
  if (!sorted.length) return boundaries;
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) return boundaries;
  const kept = [];
  for (let i = 0; i < boundaries.length; i += 1) {
    const nameKey = String(boundaries[i].name || '').trim().toLowerCase();
    if (areas[i] > 12 * median && !keep.has(nameKey)) {
      console.warn(
        `[coverage-map] dropped outlier ${boundaries[i].name}, ${boundaries[i].state} (${(areas[i] / median).toFixed(1)}× median area)`,
      );
      continue;
    }
    kept.push(boundaries[i]);
  }
  return kept.length ? kept : boundaries;
}

const LABEL_PAD = 8;
const LEADER_THRESHOLD = 18;
const CHIP_H = 32;
const MAX_CHIP_W = 200;
const CALLOUT_STROKE = 4;
/** Chip-center ring sits this far outside the polygon union (callout). */
const CALLOUT_OUT_X = MAX_CHIP_W / 2 + LABEL_PAD + CALLOUT_STROKE;
const CALLOUT_OUT_Y = CHIP_H / 2 + LABEL_PAD + CALLOUT_STROKE;
/** Extra geo inset so chips in the gutter never sit on city strokes. */
const CALLOUT_GEO_INSET_X = CALLOUT_OUT_X + 8;
const CALLOUT_GEO_INSET_Y = CHIP_H + LABEL_PAD + CALLOUT_STROKE;

function shoelaceProjected(ring, project) {
  const n = ring?.length || 0;
  if (n < 3) return 0;
  let a = 0;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = project(ring[i]);
    const [x2, y2] = project(ring[(i + 1) % n]);
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function geometryProjectedArea(geometry, project) {
  let area = 0;
  for (const polygon of polygonsFromGeometry(geometry)) {
    if (polygon[0]) area += shoelaceProjected(polygon[0], project);
  }
  return area;
}

function estimateChip(name, state) {
  const st = String(state || '')
    .trim()
    .toUpperCase();
  const city = String(name || '').trim();
  const text = st ? `${city}, ${st}` : city;
  const w = Math.min(200, Math.max(68, Math.round(text.length * 8.2 + 18)));
  return { w, h: CHIP_H, text };
}

function labelRectAt(cx, cy, w, h) {
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function rectsOverlap(a, b, pad = LABEL_PAD) {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  );
}

function clampChipCenter(cx, cy, w, h, bounds) {
  return [
    Math.min(bounds.maxX - w / 2, Math.max(bounds.minX + w / 2, cx)),
    Math.min(bounds.maxY - h / 2, Math.max(bounds.minY + h / 2, cy)),
  ];
}

/** Nearest point on chip rect edge to the anchor (for leader endpoints). */
function nearestPointOnChip(anchorX, anchorY, labelX, labelY, w, h) {
  const left = labelX - w / 2;
  const right = labelX + w / 2;
  const top = labelY - h / 2;
  const bottom = labelY + h / 2;
  const x = Math.min(right, Math.max(left, anchorX));
  const y = Math.min(bottom, Math.max(top, anchorY));
  if (x === anchorX && y === anchorY) {
    const toL = anchorX - left;
    const toR = right - anchorX;
    const toT = anchorY - top;
    const toB = bottom - anchorY;
    const m = Math.min(toL, toR, toT, toB);
    if (m === toL) return [left, anchorY];
    if (m === toR) return [right, anchorY];
    if (m === toT) return [anchorX, top];
    return [anchorX, bottom];
  }
  return [x, y];
}

function perimeterLength(bounds) {
  const W = bounds.maxX - bounds.minX;
  const H = bounds.maxY - bounds.minY;
  return 2 * (W + H);
}

function pointOnPerimeter(bounds, t) {
  const W = bounds.maxX - bounds.minX;
  const H = bounds.maxY - bounds.minY;
  const P = 2 * (W + H);
  let u = ((t % P) + P) % P;
  if (u <= W) return [bounds.minX + u, bounds.minY];
  u -= W;
  if (u <= H) return [bounds.maxX, bounds.minY + u];
  u -= H;
  if (u <= W) return [bounds.maxX - u, bounds.maxY];
  u -= H;
  return [bounds.minX, bounds.maxY - u];
}

function perimeterT(bounds, x, y) {
  const W = bounds.maxX - bounds.minX;
  const H = bounds.maxY - bounds.minY;
  const dl = Math.abs(x - bounds.minX);
  const dr = Math.abs(x - bounds.maxX);
  const dt = Math.abs(y - bounds.minY);
  const db = Math.abs(y - bounds.maxY);
  const m = Math.min(dl, dr, dt, db);
  if (m === dt) return Math.min(W, Math.max(0, x - bounds.minX));
  if (m === dr) return W + Math.min(H, Math.max(0, y - bounds.minY));
  if (m === db) return W + H + Math.min(W, Math.max(0, bounds.maxX - x));
  return W + H + W + Math.min(H, Math.max(0, bounds.maxY - y));
}

function sideOfPoint(bounds, x, y) {
  const dl = Math.abs(x - bounds.minX);
  const dr = Math.abs(x - bounds.maxX);
  const dt = Math.abs(y - bounds.minY);
  const db = Math.abs(y - bounds.maxY);
  const m = Math.min(dl, dr, dt, db);
  if (m === dt) return 'top';
  if (m === db) return 'bottom';
  if (m === dl) return 'left';
  return 'right';
}

/** Ray from origin through target, hit map content rectangle edge. */
function rayHitEdge(bounds, ox, oy, tx, ty) {
  let dx = tx - ox;
  let dy = ty - oy;
  let len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    dx = tx - (bounds.minX + bounds.maxX) / 2;
    dy = ty - (bounds.minY + bounds.maxY) / 2;
    len = Math.hypot(dx, dy) || 1;
  }
  dx /= len;
  dy /= len;

  let bestT = Infinity;
  let best = [tx, ty];
  const tryEdge = (t, x, y) => {
    if (t <= 0 || t >= bestT) return;
    bestT = t;
    best = [x, y];
  };
  if (Math.abs(dx) > 1e-9) {
    const tL = (bounds.minX - ox) / dx;
    const yL = oy + tL * dy;
    if (yL >= bounds.minY - 0.5 && yL <= bounds.maxY + 0.5) tryEdge(tL, bounds.minX, yL);
    const tR = (bounds.maxX - ox) / dx;
    const yR = oy + tR * dy;
    if (yR >= bounds.minY - 0.5 && yR <= bounds.maxY + 0.5) tryEdge(tR, bounds.maxX, yR);
  }
  if (Math.abs(dy) > 1e-9) {
    const tT = (bounds.minY - oy) / dy;
    const xT = ox + tT * dx;
    if (xT >= bounds.minX - 0.5 && xT <= bounds.maxX + 0.5) tryEdge(tT, xT, bounds.minY);
    const tB = (bounds.maxY - oy) / dy;
    const xB = ox + tB * dx;
    if (xB >= bounds.minX - 0.5 && xB <= bounds.maxX + 0.5) tryEdge(tB, xB, bounds.maxY);
  }
  return best;
}

function spreadSlotsOnSides(slots, bounds) {
  const groups = { top: [], right: [], bottom: [], left: [] };
  for (const s of slots) {
    groups[sideOfPoint(bounds, s.x, s.y)].push(s);
  }
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const g = groups[side];
    if (g.length < 2) continue;
    const horizontal = side === 'top' || side === 'bottom';
    g.sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
    const min = horizontal ? bounds.minX : bounds.minY;
    const max = horizontal ? bounds.maxX : bounds.maxY;
    const span = max - min;
    const step = span / (g.length + 1);
    g.forEach((s, i) => {
      const pos = min + step * (i + 1);
      if (side === 'top') {
        s.x = pos;
        s.y = bounds.minY;
      } else if (side === 'bottom') {
        s.x = pos;
        s.y = bounds.maxY;
      } else if (side === 'left') {
        s.x = bounds.minX;
        s.y = pos;
      } else {
        s.x = bounds.maxX;
        s.y = pos;
      }
      const [cx, cy] = clampChipCenter(s.x, s.y, s.node.chip.w, s.node.chip.h, bounds);
      s.x = cx;
      s.y = cy;
      s.t = perimeterT(bounds, s.x, s.y);
    });
  }
}

/** @param {unknown} value */
export function normalizeCoverageMapLabelPlacement(value) {
  return String(value || '').trim().toLowerCase() === 'center' ? 'center' : 'callout';
}

/**
 * Place SEO city chips: centered on the pin, or margin callouts with leader lines.
 * @param {Array<{ area: object, anchor: [number, number] }>} items
 * @param {{ minX: number, maxX: number, minY: number, maxY: number }} bounds
 * @param {'center' | 'callout'} [placement]
 * @returns {Map<string, { anchor: [number, number], label: [number, number], useLeader: boolean, chipW: number, chipH: number, chipText: string }>}
 */
function placeSeoLabels(items, bounds, placement = 'callout') {
  const nodes = items.map((item) => {
    const name = String(item.area.name || '').trim();
    const state = String(item.area.state || '').trim();
    const chip = estimateChip(name, state);
    return {
      area: item.area,
      anchor: item.anchor,
      key: `${item.area.name}|${item.area.state}`,
      chip,
    };
  });

  const placedRects = [];
  const result = new Map();
  const peri = perimeterLength(bounds);

  const collides = (rect) => placedRects.some((p) => rectsOverlap(rect, p, LABEL_PAD));

  const commitSlot = (node, x, y, useLeader) => {
    const [cx, cy] = clampChipCenter(x, y, node.chip.w, node.chip.h, bounds);
    placedRects.push(labelRectAt(cx, cy, node.chip.w, node.chip.h));
    result.set(node.key, {
      anchor: [...node.anchor],
      label: [cx, cy],
      useLeader: Boolean(useLeader),
      chipW: node.chip.w,
      chipH: node.chip.h,
      chipText: node.chip.text,
    });
  };

  const placeMarginFan = (group) => {
    if (!group.length) return;
    const cx = group.reduce((s, n) => s + n.anchor[0], 0) / group.length;
    const cy = group.reduce((s, n) => s + n.anchor[1], 0) / group.length;

    const ordered = [...group].sort((a, b) => {
      const aa = Math.atan2(a.anchor[1] - cy, a.anchor[0] - cx);
      const bb = Math.atan2(b.anchor[1] - cy, b.anchor[0] - cx);
      return aa - bb;
    });

    const slots = ordered.map((n) => {
      const edge = rayHitEdge(bounds, cx, cy, n.anchor[0], n.anchor[1]);
      const [x, y] = clampChipCenter(edge[0], edge[1], n.chip.w, n.chip.h, bounds);
      return { node: n, x, y, t: perimeterT(bounds, x, y) };
    });

    spreadSlotsOnSides(slots, bounds);

    for (let iter = 0; iter < 100; iter += 1) {
      let moved = false;
      for (const s of slots) {
        const [px, py] = pointOnPerimeter(bounds, s.t);
        const [x, y] = clampChipCenter(px, py, s.node.chip.w, s.node.chip.h, bounds);
        s.x = x;
        s.y = y;
      }
      for (let i = 0; i < slots.length; i += 1) {
        for (let j = i + 1; j < slots.length; j += 1) {
          const a = slots[i];
          const b = slots[j];
          const ra = labelRectAt(a.x, a.y, a.node.chip.w, a.node.chip.h);
          const rb = labelRectAt(b.x, b.y, b.node.chip.w, b.node.chip.h);
          if (!rectsOverlap(ra, rb, LABEL_PAD)) continue;
          const sep = (a.node.chip.w + b.node.chip.w) / 4 + LABEL_PAD;
          const forward = ((b.t - a.t + peri) % peri) <= peri / 2;
          if (forward) {
            a.t = (a.t - sep + peri) % peri;
            b.t = (b.t + sep) % peri;
          } else {
            a.t = (a.t + sep) % peri;
            b.t = (b.t - sep + peri) % peri;
          }
          moved = true;
        }
      }
      for (const s of slots) {
        const rect = labelRectAt(s.x, s.y, s.node.chip.w, s.node.chip.h);
        if (!collides(rect)) continue;
        s.t = (s.t + s.node.chip.w / 2 + LABEL_PAD) % peri;
        moved = true;
      }
      if (!moved) break;
    }

    for (const s of slots) {
      const [px, py] = pointOnPerimeter(bounds, s.t);
      const [x, y] = clampChipCenter(px, py, s.node.chip.w, s.node.chip.h, bounds);
      commitSlot(s.node, x, y, true);
    }
  };

  if (placement === 'center') {
    for (const n of nodes) {
      const [ax, ay] = n.anchor;
      commitSlot(n, ax, ay, false);
    }
    return result;
  }

  placeMarginFan(nodes);
  return result;
}

export async function generateCoverageMapSvg(
  config,
  outputPath,
  { onProgress, labelPlacement } = {},
) {
  const placement = normalizeCoverageMapLabelPlacement(labelPlacement);
  const areas = coverageAreasFromConfig(config);

  if (!areas.length) {
    throw Object.assign(new Error('No coverage areas / suburbs configured'), { status: 400 });
  }

  const report = (payload) => {
    try {
      onProgress?.(payload);
    } catch {
      /* ignore UI callback errors */
    }
  };

  const userAgent = `${config.domain || 'rover.local'} coverage-map generator`;
  let boundaries = [];
  const missingBoundaries = [];
  const total = areas.length;
  console.log(`[coverage-map] looking up ${total} area(s) (Census, Nominatim fallback)…`);
  for (let i = 0; i < areas.length; i++) {
    const area = areas[i];
    const label = `${String(area.name || '').trim()}, ${String(area.state || '').trim()}`;
    const current = i + 1;
    report({
      phase: 'coverage-map',
      current,
      total,
      label: label || String(area.name || 'unknown'),
      detail: `Coverage map ${current}/${total} · ${label || area.name || 'unknown'}`,
    });
    console.log(`[coverage-map] ${current}/${total} ${label || area.name || 'unknown'}…`);
    try {
      const bound = await fetchBoundary(area, userAgent);
      boundaries.push(bound);
    } catch (e) {
      missingBoundaries.push(label.replace(/,\s*$/, '') || String(area.name || 'unknown'));
      console.warn(
        `[coverage-map] ${current}/${total} skipped: ${e?.message || e}`,
      );
    }
  }
  const pageCityNames = pageCityNamesFromConfig(config);
  boundaries = dropAreaOutliers(boundaries, { keepNames: pageCityNames });
  console.log(
    `[coverage-map] done — ${boundaries.length}/${total} outlined` +
      (missingBoundaries.length ? `; missing: ${missingBoundaries.join('; ')}` : ''),
  );

  if (!boundaries.length) {
    const missNote = missingBoundaries.length
      ? ` Missing: ${missingBoundaries.join('; ')}.`
      : '';
    throw Object.assign(
      new Error(`No municipal boundaries found for any coverage area.${missNote}`),
      { status: 400, missingBoundaries },
    );
  }

  const width = 1000;
  const height = 680;
  const padding = 58;
  const titleSpace = 74;
  const attributionSpace = 30;
  const callout = placement === 'callout';
  const insetX = callout ? CALLOUT_GEO_INSET_X : padding;
  const insetY = callout ? CALLOUT_GEO_INSET_Y : 0;
  const points = boundaries.flatMap(({ geometry }) =>
    polygonsFromGeometry(geometry).flatMap((polygon) => polygon.flat()),
  );
  const averageLatitude = points.reduce((sum, [, latitude]) => sum + latitude, 0) / points.length;
  const longitudeScale = Math.cos((averageLatitude * Math.PI) / 180);
  const projected = points.map(([longitude, latitude]) => [longitude * longitudeScale, latitude]);
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const drawingWidth = width - insetX * 2;
  const drawingHeight = callout
    ? height - titleSpace - attributionSpace - insetY * 2
    : height - titleSpace - attributionSpace - padding;
  const scale = Math.min(drawingWidth / (maxX - minX), drawingHeight / (maxY - minY));
  const usedWidth = (maxX - minX) * scale;
  const usedHeight = (maxY - minY) * scale;
  const offsetX = (width - usedWidth) / 2;
  const offsetY = callout
    ? titleSpace + insetY + (drawingHeight - usedHeight) / 2
    : titleSpace + (drawingHeight - usedHeight) / 2;

  function project([longitude, latitude]) {
    return [
      offsetX + (longitude * longitudeScale - minX) * scale,
      offsetY + (maxY - latitude) * scale,
    ];
  }

  function areaPath(geometry) {
    return polygonsFromGeometry(geometry)
      .flatMap((polygon) =>
        polygon.map(
          (ring) =>
            ring
              .map((point, index) => {
                const [x, y] = project(point);
                return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(' ') + ' Z',
        ),
      )
      .join(' ');
  }

  function areaCenter(geometry) {
    const areaPoints = polygonsFromGeometry(geometry).flatMap((polygon) => polygon[0]);
    const projectedPoints = areaPoints.map(project);
    const areaXs = projectedPoints.map(([x]) => x);
    const areaYs = projectedPoints.map(([, y]) => y);
    return [
      (Math.min(...areaXs) + Math.max(...areaXs)) / 2,
      (Math.min(...areaYs) + Math.max(...areaYs)) / 2,
    ];
  }

  const fills = ['#e8a317', '#f2b83c', '#dc8f08', '#f6c65f', '#d9a11e', '#edb83d'];

  // Label only SEO location pages (primary + targetSuburbs); still shade all coverage polygons.
  const labelNames = new Set(pageCityNames);

  const geoPts = points.map(project);
  const geoBounds = {
    minX: Math.min(...geoPts.map(([x]) => x)),
    maxX: Math.max(...geoPts.map(([x]) => x)),
    minY: Math.min(...geoPts.map(([, y]) => y)),
    maxY: Math.max(...geoPts.map(([, y]) => y)),
  };
  const canvasBounds = {
    minX: 8,
    maxX: width - 8,
    minY: titleSpace + 6,
    maxY: height - attributionSpace - 8,
  };
  const labelBounds = callout
    ? {
        minX: Math.max(canvasBounds.minX, geoBounds.minX - CALLOUT_OUT_X),
        maxX: Math.min(canvasBounds.maxX, geoBounds.maxX + CALLOUT_OUT_X),
        minY: Math.max(canvasBounds.minY, geoBounds.minY - CALLOUT_OUT_Y),
        maxY: Math.min(canvasBounds.maxY, geoBounds.maxY + CALLOUT_OUT_Y),
      }
    : {
        minX: padding * 0.55,
        maxX: width - padding * 0.55,
        minY: titleSpace + 6,
        maxY: height - attributionSpace - 8,
      };

  const labeledItems = [];
  for (const area of boundaries) {
    if (!labelNames.has(String(area.name || '').trim().toLowerCase())) continue;
    labeledItems.push({ area, anchor: areaCenter(area.geometry) });
  }
  const labelLayout = placeSeoLabels(labeledItems, labelBounds, placement);

  const paintOrder = [...boundaries].sort(
    (a, b) => geometryProjectedArea(b.geometry, project) - geometryProjectedArea(a.geometry, project),
  );

  const areaShapes = paintOrder
    .map((area, index) => {
      const slug = slugifyAreaName(area.name);
      const isLabeled = labelNames.has(String(area.name || '').trim().toLowerCase());
      const layout = labelLayout.get(`${area.name}|${area.state}`);
      const pathEl = `<path d="${areaPath(area.geometry)}" fill="${fills[index % fills.length]}" fill-opacity="${
        isLabeled ? '0.52' : '0.28'
      }" stroke="#17293a" stroke-width="${isLabeled ? '2.2' : '1.4'}" stroke-linejoin="round" fill-rule="evenodd"/>`;
      if (!isLabeled) {
        return `
      <g class="cov-area cov-area-nolabel">
        ${pathEl}
      </g>`;
      }
      const [ax, ay] = layout?.anchor || areaCenter(area.geometry);
      const [labelX, labelY] = layout?.label || [ax, ay];
      const chipW = layout?.chipW || estimateChip(area.name, area.state).w;
      const chipH = layout?.chipH || CHIP_H;
      const chipText = escapeXml(
        layout?.chipText || estimateChip(area.name, area.state).text,
      );
      const useLeader =
        layout?.useLeader ??
        Math.hypot(labelX - ax, labelY - ay) >= LEADER_THRESHOLD;
      const [lx2, ly2] = nearestPointOnChip(ax, ay, labelX, labelY, chipW, chipH);
      const pinEl = `<circle class="cov-pin" cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="3.5"/>`;
      const leaderEl = useLeader
        ? `<line class="cov-leader" x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${lx2.toFixed(1)}" y2="${ly2.toFixed(1)}"/>`
        : '';
      const href = slug ? `/locations/${slug}` : '/';
      const halfW = chipW / 2;
      const halfH = chipH / 2;
      return `
      <a href="${escapeXml(href)}" target="_top" rel="noopener">
        <g class="cov-area">
          ${pathEl}
          ${leaderEl}
          ${pinEl}
          <g transform="translate(${labelX.toFixed(1)} ${labelY.toFixed(1)})">
            <rect class="cov-chip" x="${(-halfW).toFixed(1)}" y="${(-halfH).toFixed(1)}" width="${chipW}" height="${chipH}" rx="7"/>
            <text text-anchor="middle" dominant-baseline="central" y="0.5" class="cov-chip-text">${chipText}</text>
          </g>
        </g>
      </a>`;
    })
    .join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"
  aria-label="${escapeXml(config.businessName || 'Service')} service coverage map">
  <style>
    a { text-decoration: none; }
    .heading { font: 700 24px Arial, sans-serif; fill: #0f1720; }
    .subheading { font: 400 12px Arial, sans-serif; fill: #5a6570; }
    .attribution { font: 400 10px Arial, sans-serif; fill: #65717d; }
    .state { font: 600 11px Arial, sans-serif; fill: #5a6570; }
    .cov-area { cursor: pointer; transition: opacity 0.15s ease; }
    .cov-area-nolabel { cursor: default; pointer-events: none; }
    .cov-area path { transition: fill-opacity 0.15s ease, stroke-width 0.15s ease; }
    .cov-chip {
      fill: #ffffff;
      fill-opacity: 0.92;
      stroke: #17293a;
      stroke-width: 1;
      transition: fill-opacity 0.15s ease;
    }
    .cov-chip-text { font: 600 14px Arial, sans-serif; fill: #0f1720; }
    .cov-leader { stroke: #17293a; stroke-width: 1.2; fill: none; }
    .cov-pin { fill: #17293a; stroke: #ffffff; stroke-width: 1.25; }
    a:hover .cov-area path, .cov-area:hover path { fill-opacity: 0.78; stroke-width: 3.2; }
    a:hover .cov-chip, .cov-area:hover .cov-chip { fill-opacity: 1; }
  </style>
  <rect width="100%" height="100%" rx="14" fill="#f7f9fb"/>
  <path d="M0 110 H1000 M0 220 H1000 M0 330 H1000 M0 440 H1000 M0 550 H1000
    M150 74 V650 M300 74 V650 M450 74 V650 M600 74 V650 M750 74 V650 M900 74 V650"
    stroke="#dce2e7" stroke-width="1"/>
  <text x="40" y="38" class="heading">Service coverage</text>
  <text x="40" y="58" class="subheading">Named cities have local pages · shaded areas are also served</text>
  ${areaShapes}
  <g transform="translate(940 42)">
    <path d="M0 16 L8 -8 L16 16 L8 11 Z" fill="#17293a"/>
    <text x="8" y="29" text-anchor="middle" class="state">N</text>
  </g>
  <text x="40" y="662" class="attribution">Boundary data © OpenStreetMap contributors · ODbL</text>
</svg>`;

  report({
    phase: 'coverage-map-write',
    current: total,
    total,
    label: 'Writing SVG',
    detail: `Writing coverage map (${boundaries.length}/${total} outlined)…`,
  });
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, svg, 'utf8');
  const warning = missingBoundaries.length
    ? `No map outline for ${missingBoundaries.join('; ')} (still listed as Also serving).`
    : undefined;
  return {
    areas: boundaries.length,
    requested: areas.length,
    missingBoundaries,
    warning,
    outputPath,
    primaryCity: config.primaryCity || '',
    labelPlacement: placement,
  };
}

function setCoverageMapOnMarkdown(md, src, alt) {
  const block = `coverageMap:\n  src: ${JSON.stringify(src)}\n  alt: ${JSON.stringify(alt)}`;
  const re = /^coverageMap:\s*\n(?:[ \t]+.*\n)*/m;
  if (re.test(md)) return md.replace(re, `${block}\n`);
  return md.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (m, fm) => {
    if (/^coverageMap:/m.test(fm)) return m;
    return `---\n${fm.trimEnd()}\n${block}\n---`;
  });
}

/** Exported for Stage heal when SVG exists but homepage FM omitted coverageMap. */
export { setCoverageMapOnMarkdown };

function patchIndexCoverageMap(candidateId, src, alt) {
  const p = pathsFor(candidateId);
  let patched = 0;
  for (const key of ['content', 'contentDraft']) {
    const file = p[key];
    const doc = readJson(file);
    if (!doc?.files) continue;
    const indexKey = Object.keys(doc.files).find((k) => /pages\/index\.md$/i.test(k));
    if (!indexKey) continue;
    doc.files[indexKey] = setCoverageMapOnMarkdown(doc.files[indexKey], src, alt);
    writeJson(file, doc);
    patched += 1;
  }
  const liveIndex = path.join(ROOT, 'src', 'content', 'pages', 'index.md');
  if (existsSync(liveIndex)) {
    const body = readFileSync(liveIndex, 'utf8');
    writeFileSync(liveIndex, setCoverageMapOnMarkdown(body, src, alt), 'utf8');
    patched += 1;
  }
  return patched;
}

/**
 * Generate coverage map for a candidate into site-images + public + content FM.
 * @param {string} candidateId
 * @param {{ onProgress?: (p: object) => void, labelPlacement?: string }} [opts]
 */
export async function generateCoverageMapForCandidate(
  candidateId,
  { onProgress, labelPlacement } = {},
) {
  const p = pathsFor(candidateId);
  ensureAlsoServingOnSiteConfig(candidateId);
  const config =
    readJson(p.siteConfig) ||
    readJson(p.siteConfigDraft) ||
    readJson(path.join(ROOT, 'src', 'config', 'site-config.json'));
  if (!config) {
    throw Object.assign(new Error('No site-config for coverage map'), { status: 400 });
  }

  const meta = loadMeta(candidateId);
  const placement = normalizeCoverageMapLabelPlacement(
    labelPlacement ?? meta.coverageMapLabelPlacement,
  );
  const areaCount = coverageAreasFromConfig(config).length;
  const emit = (p = {}) => {
    setCoverageMapProgress(candidateId, {
      status: 'running',
      current: Number(p.current) || 0,
      total: Number(p.total) || areaCount,
      label: p.label || '',
      detail: p.detail || '',
      phase: p.phase || '',
    });
    onProgress?.(p);
  };

  setCoverageMapProgress(candidateId, {
    status: 'running',
    current: 0,
    total: areaCount,
    label: 'Starting…',
    detail: areaCount ? `Looking up 0/${areaCount} cities…` : 'Building coverage map…',
    phase: 'coverage-map',
  });

  mkdirSync(p.siteImages, { recursive: true });
  const abs = path.join(p.siteImages, 'coverage-map.svg');
  try {
    archiveLiveCoverageMapToTray(candidateId);
    const result = await generateCoverageMapSvg(config, abs, {
      onProgress: emit,
      labelPlacement: placement,
    });
    emit({
      phase: 'coverage-map-finalize',
      current: result.requested || result.areas || areaCount,
      total: result.requested || result.areas || areaCount,
      label: 'Finalizing',
      detail: 'Copying coverage map into site…',
    });
    copyFileSync(abs, path.join(ROOT, 'public', 'images', 'coverage-map.svg'));
    syncSiteImagesToPublic(candidateId);

    const src = '/images/coverage-map.svg';
    const alt = `Coverage map for ${config.primaryCity || 'service'} area`;
    const patched = patchIndexCoverageMap(candidateId, src, alt);

    saveMeta(candidateId, {
      lastCoverageMapAt: new Date().toISOString(),
      coverageMapLabelPlacement: placement,
    });
    setCoverageMapProgress(candidateId, { status: 'done' });
    return {
      ok: true,
      ...result,
      src,
      patched,
      path: path.relative(ROOT, abs).replace(/\\/g, '/'),
      candidate: getCandidateShell(candidateId),
    };
  } catch (error) {
    setCoverageMapProgress(candidateId, {
      status: 'error',
      label: error?.message || 'Coverage map failed',
      detail: error?.message || 'Coverage map failed',
    });
    throw error;
  }
}

/**
 * Promote a tray coverage map to live. Archives the current live file first.
 */
export function useCoverageMapVariant(candidateId, filename) {
  const want = path.basename(String(filename || ''));
  if (!isMapVariantFilename(want)) {
    throw Object.assign(new Error('filename required'), { status: 400 });
  }
  const p = pathsFor(candidateId);
  const config =
    readJson(p.siteConfig) ||
    readJson(p.siteConfigDraft) ||
    readJson(path.join(ROOT, 'src', 'config', 'site-config.json'));
  if (!config) {
    throw Object.assign(new Error('No site-config for coverage map'), { status: 400 });
  }
  const meta = loadMeta(candidateId);
  const variants = [...(Array.isArray(meta.coverageMapVariants) ? meta.coverageMapVariants : [])];
  const idx = variants.findIndex((v) => path.basename(String(v.filename || '')) === want);
  if (idx < 0) throw Object.assign(new Error('Coverage map variant not found'), { status: 404 });
  const picked = variants[idx];
  const pickedAbs = path.join(p.siteImages, want);
  if (!existsSync(pickedAbs)) {
    throw Object.assign(new Error('Coverage map variant file missing on disk'), { status: 404 });
  }

  const live = path.join(p.siteImages, 'coverage-map.svg');
  let nextVariants = variants.filter((_, i) => i !== idx);
  if (existsSync(live)) {
    const destName = `coverage-map-var-${mapVariantStamp()}.svg`;
    copyFileSync(live, path.join(p.siteImages, destName));
    nextVariants.unshift({
      filename: destName,
      at: new Date().toISOString(),
      labelPlacement: meta.coverageMapLabelPlacement || null,
    });
  }

  mkdirSync(p.siteImages, { recursive: true });
  copyFileSync(pickedAbs, live);
  unlinkQuiet(pickedAbs);
  const publicDir = path.join(ROOT, 'public', 'images');
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(live, path.join(publicDir, 'coverage-map.svg'));
  syncSiteImagesToPublic(candidateId);

  const src = '/images/coverage-map.svg';
  const alt = `Coverage map for ${config.primaryCity || 'service'} area`;
  const patched = patchIndexCoverageMap(candidateId, src, alt);
  nextVariants = trimMapVariants(p.siteImages, nextVariants);
  saveMeta(candidateId, {
    lastCoverageMapAt: new Date().toISOString(),
    coverageMapLabelPlacement: picked.labelPlacement || meta.coverageMapLabelPlacement || null,
    coverageMapVariants: nextVariants,
  });
  return {
    ok: true,
    src,
    patched,
    path: path.relative(ROOT, live).replace(/\\/g, '/'),
    candidate: getCandidateShell(candidateId),
  };
}
