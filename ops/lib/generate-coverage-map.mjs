/**
 * Coverage map SVG from site-config coverage areas / suburbs (Nominatim boundaries).
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { pathsFor, getCandidateDetail, saveMeta } from './candidates.mjs';
import { syncSiteImagesToPublic } from './fill-site-images.mjs';

const ROOT = process.cwd();

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

async function fetchBoundary(area, userAgent) {
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
      limit: '1',
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
      const feature = data.features?.[0];
      if (!feature?.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) {
        lastErr = new Error(`No municipal boundary found for ${qName}, ${state}`);
        continue;
      }
      return { ...area, name: qName === name ? name : qName, geometry: feature.geometry };
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        lastErr = new Error(`Boundary lookup timed out for ${qName}, ${state}`);
      } else {
        lastErr = e;
      }
    }
  }
  throw lastErr || new Error(`No municipal boundary found for ${name}, ${state}`);
}

function polygonsFromGeometry(geometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

const CLUSTER_PX = 110;
const LABEL_PAD = 8;
const LEADER_THRESHOLD = 18;
const CHIP_H = 32;

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

/**
 * Dense-cluster margin callouts + compact chips; sparse cities may sit on pin.
 * @param {Array<{ area: object, anchor: [number, number] }>} items
 * @param {{ minX: number, maxX: number, minY: number, maxY: number }} bounds
 * @returns {Map<string, { anchor: [number, number], label: [number, number], useLeader: boolean, chipW: number, chipH: number, chipText: string }>}
 */
function placeSeoLabels(items, bounds) {
  const nodes = items.map((item) => {
    const name = String(item.area.name || '').trim();
    const state = String(item.area.state || '').trim();
    const chip = estimateChip(name, state);
    return {
      area: item.area,
      anchor: item.anchor,
      key: `${item.area.name}|${item.area.state}`,
      chip,
      dense: false,
    };
  });

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const d = Math.hypot(
        nodes[i].anchor[0] - nodes[j].anchor[0],
        nodes[i].anchor[1] - nodes[j].anchor[1],
      );
      if (d < CLUSTER_PX) {
        nodes[i].dense = true;
        nodes[j].dense = true;
      }
    }
  }

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
      useLeader:
        useLeader || Math.hypot(cx - node.anchor[0], cy - node.anchor[1]) >= LEADER_THRESHOLD,
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

  placeMarginFan(nodes.filter((n) => n.dense));

  for (const n of nodes.filter((n) => !n.dense)) {
    const [ax, ay] = n.anchor;
    const atPin = labelRectAt(ax, ay, n.chip.w, n.chip.h);
    if (!collides(atPin)) {
      commitSlot(n, ax, ay, false);
    } else {
      placeMarginFan([n]);
    }
  }

  return result;
}

export async function generateCoverageMapSvg(config, outputPath) {
  const areas = config.coverageAreas?.length
    ? config.coverageAreas
    : [
        { name: config.primaryCity, state: config.state },
        ...(config.targetSuburbs || []).map((name) => ({
          name: typeof name === 'string' ? name : name?.name || name?.city,
          state: config.state,
        })),
      ].filter((a) => a?.name && a?.state);

  if (!areas.length) {
    throw Object.assign(new Error('No coverage areas / suburbs configured'), { status: 400 });
  }

  const userAgent = `${config.domain || 'rover.local'} coverage-map generator`;
  const boundaries = [];
  const missingBoundaries = [];
  const total = areas.length;
  console.log(`[coverage-map] looking up ${total} area(s) via Nominatim…`);
  for (let i = 0; i < areas.length; i++) {
    const area = areas[i];
    const label = `${String(area.name || '').trim()}, ${String(area.state || '').trim()}`;
    console.log(`[coverage-map] ${i + 1}/${total} ${label || area.name || 'unknown'}…`);
    try {
      boundaries.push(await fetchBoundary(area, userAgent));
    } catch (e) {
      missingBoundaries.push(label.replace(/,\s*$/, '') || String(area.name || 'unknown'));
      console.warn(
        `[coverage-map] ${i + 1}/${total} skipped: ${e?.message || e}`,
      );
    }
    await sleep(1100);
  }
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
  const drawingWidth = width - padding * 2;
  const drawingHeight = height - titleSpace - attributionSpace - padding;
  const scale = Math.min(drawingWidth / (maxX - minX), drawingHeight / (maxY - minY));
  const usedWidth = (maxX - minX) * scale;
  const usedHeight = (maxY - minY) * scale;
  const offsetX = (width - usedWidth) / 2;
  const offsetY = titleSpace + (drawingHeight - usedHeight) / 2;

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
  const labelNames = new Set(
    [config.primaryCity, ...(config.targetSuburbs || [])]
      .map((n) =>
        String(typeof n === 'string' ? n : n?.name || n?.city || '')
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );

  const labelBounds = {
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
  const labelLayout = placeSeoLabels(labeledItems, labelBounds);

  const areaShapes = boundaries
    .map((area, index) => {
      const name = escapeXml(area.name);
      const state = escapeXml(area.state);
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
    .cov-area-nolabel { cursor: default; }
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
 */
export async function generateCoverageMapForCandidate(candidateId) {
  const p = pathsFor(candidateId);
  const config =
    readJson(p.siteConfig) ||
    readJson(p.siteConfigDraft) ||
    readJson(path.join(ROOT, 'src', 'config', 'site-config.json'));
  if (!config) {
    throw Object.assign(new Error('No site-config for coverage map'), { status: 400 });
  }

  mkdirSync(p.siteImages, { recursive: true });
  const abs = path.join(p.siteImages, 'coverage-map.svg');
  const result = await generateCoverageMapSvg(config, abs);
  copyFileSync(abs, path.join(ROOT, 'public', 'images', 'coverage-map.svg'));
  syncSiteImagesToPublic(candidateId);

  const src = '/images/coverage-map.svg';
  const alt = `Coverage map for ${config.primaryCity || 'service'} area`;
  const patched = patchIndexCoverageMap(candidateId, src, alt);

  saveMeta(candidateId, { lastCoverageMapAt: new Date().toISOString() });
  return {
    ok: true,
    ...result,
    src,
    patched,
    path: path.relative(ROOT, abs).replace(/\\/g, '/'),
    candidate: getCandidateDetail(candidateId),
  };
}
