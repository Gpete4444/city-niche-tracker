/**
 * Leaflet 1.9 draws a MultiPolygon as one evenodd path, so overlapping
 * islands cancel fill (Fuquay-Varina-style annexations look like outlines).
 * Split each MultiPolygon into Polygon features so each island fills.
 * Service area paints largest first so smaller cities stay clickable.
 */

/** Non-largest MultiPolygon parts below this share of the main body are slivers. */
export const SLIVER_AREA_FRACTION = 0.02;

function ringArea(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) continue;
    area += Number(a[0]) * Number(b[1]) - Number(b[0]) * Number(a[1]);
  }
  return Math.abs(area / 2);
}

function polygonArea(coords) {
  return ringArea(coords?.[0]);
}

function validPolygonCoords(coords) {
  const outer = coords?.[0];
  return Array.isArray(outer) && outer.length >= 4;
}

function explodeOne(feature) {
  const geom = feature?.geometry;
  const props = feature?.properties || {};
  if (!geom || geom.type === 'Polygon') {
    if (geom?.type === 'Polygon' && !validPolygonCoords(geom.coordinates)) return [];
    return [
      {
        type: 'Feature',
        properties: {
          ...props,
          _largestPart: true,
          _partIndex: 0,
          _partCount: 1,
        },
        geometry: geom,
      },
    ];
  }
  if (geom.type !== 'MultiPolygon') return [feature];

  const parts = (geom.coordinates || []).filter(validPolygonCoords);
  if (!parts.length) return [];

  let best = 0;
  let bestArea = -1;
  for (let i = 0; i < parts.length; i += 1) {
    const area = polygonArea(parts[i]);
    if (area > bestArea) {
      bestArea = area;
      best = i;
    }
  }

  const mainArea = polygonArea(parts[best]);
  return parts.map((coords, i) => ({
    type: 'Feature',
    properties: {
      ...props,
      _largestPart: i === best,
      _partIndex: i,
      _partCount: parts.length,
      _partArea: polygonArea(coords),
      _mainPartArea: mainArea,
    },
    geometry: { type: 'Polygon', coordinates: coords },
  }));
}

/**
 * @param {object} input FeatureCollection, Feature, or { features }
 * @returns {object} FeatureCollection (preserves extra fields like `meta`)
 */
export function explodePlaceFeatures(input) {
  if (input?.type === 'Feature') {
    return { type: 'FeatureCollection', features: explodeOne(input) };
  }
  const list = Array.isArray(input?.features) ? input.features : [];
  const features = [];
  for (const f of list) {
    for (const part of explodeOne(f)) features.push(part);
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return { ...input, features };
  }
  return { type: 'FeatureCollection', features };
}

/** True for the main body (or an unexploded feature). Satellites are false. */
export function isLargestPart(feature) {
  return feature?.properties?._largestPart !== false;
}

export function featurePolygonArea(feature) {
  const tagged = Number(feature?.properties?._partArea);
  if (Number.isFinite(tagged) && tagged > 0) return tagged;
  const geom = feature?.geometry;
  if (geom?.type === 'Polygon') return polygonArea(geom.coordinates);
  if (geom?.type === 'MultiPolygon') {
    return (geom.coordinates || []).reduce((sum, coords) => sum + polygonArea(coords), 0);
  }
  return 0;
}

/** Largest area first — Leaflet last-added sits on top, so add this order. */
export function sortPlaceFeaturesLargestFirst(features) {
  return [...(features || [])].sort((a, b) => featurePolygonArea(b) - featurePolygonArea(a));
}

/** Tiny annexation leftovers: not the main body and under SLIVER_AREA_FRACTION of it. */
export function isSliverPart(feature) {
  const p = feature?.properties || {};
  if (p._largestPart !== false) return false;
  const part = Number(p._partArea);
  const main = Number(p._mainPartArea);
  if (!Number.isFinite(part) || !Number.isFinite(main) || main <= 0) return false;
  return part / main < SLIVER_AREA_FRACTION;
}

/** Explode MultiPolygons, then largest-first for paint / click order. */
export function explodeAndSortPlaceFeatures(input) {
  const exploded = explodePlaceFeatures(input);
  return {
    ...exploded,
    features: sortPlaceFeaturesLargestFirst(exploded.features || []),
  };
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

function pointInPolygonCoords(lng, lat, coords) {
  const rings = coords || [];
  if (!rings.length || !pointInRing(lng, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i += 1) {
    if (pointInRing(lng, lat, rings[i])) return false;
  }
  return true;
}

function pointInGeometry(lng, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInPolygonCoords(lng, lat, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates || []) {
      if (pointInPolygonCoords(lng, lat, poly)) return true;
    }
  }
  return false;
}

function polygonParts(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates || [];
  return [];
}

function ringBbox(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of ring || []) {
    const x = Number(pt?.[0]);
    const y = Number(pt?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
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

function clearanceToRings(lng, lat, rings) {
  let best = Infinity;
  for (const ring of rings || []) {
    if (!Array.isArray(ring) || ring.length < 2) continue;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) continue;
      const d = distPointToSeg(lng, lat, Number(a[0]), Number(a[1]), Number(b[0]), Number(b[1]));
      if (d < best) best = d;
    }
  }
  return best;
}

/** Interior point of one polygon (outer ring + holes) nearest `lng0,lat0`. */
function bestInteriorLngLat(coords, lng0, lat0) {
  const bbox = ringBbox(coords?.[0]);
  if (!bbox) return null;
  let minX = bbox[0];
  let minY = bbox[1];
  let maxX = bbox[2];
  let maxY = bbox[3];
  const steps = 16;
  let chosen = null;
  for (let pass = 0; pass < 3; pass += 1) {
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    if (!(spanX > 0) && !(spanY > 0)) break;
    const dx = spanX / steps || 0;
    const dy = spanY / steps || 0;
    const cell = Math.hypot(dx, dy) || 0;
    const hits = [];
    for (let ix = 0; ix <= steps; ix += 1) {
      for (let iy = 0; iy <= steps; iy += 1) {
        const lng = minX + dx * ix;
        const lat = minY + dy * iy;
        if (!pointInPolygonCoords(lng, lat, coords)) continue;
        hits.push({ lng, lat, dist: Math.hypot(lng - lng0, lat - lat0) });
      }
    }
    if (!hits.length) return chosen;
    hits.sort((a, b) => a.dist - b.dist);
    const limit = hits[0].dist + cell;
    let pick = hits[0];
    let pickClear = clearanceToRings(pick.lng, pick.lat, coords);
    for (let i = 1; i < hits.length; i += 1) {
      const hit = hits[i];
      if (hit.dist > limit) break;
      const clear = clearanceToRings(hit.lng, hit.lat, coords);
      if (clear > pickClear) {
        pick = hit;
        pickClear = clear;
      }
    }
    chosen = pick;
    const padX = dx || spanX || 1e-6;
    const padY = dy || spanY || 1e-6;
    minX = pick.lng - padX;
    maxX = pick.lng + padX;
    minY = pick.lat - padY;
    maxY = pick.lat + padY;
  }
  return chosen;
}

/**
 * City-label anchor. Keeps the preferred center when it lies on the polygon.
 * When that center falls outside (an L, a hole, a gap), returns a point on the
 * city as close to the center as possible, inset slightly from the edge.
 * @returns {[number, number] | null} GeoJSON [lng, lat]
 */
export function labelAnchorLngLat(geometry, preferredLng, preferredLat) {
  const lng0 = Number(preferredLng);
  const lat0 = Number(preferredLat);
  if (!geometry || !Number.isFinite(lng0) || !Number.isFinite(lat0)) return null;
  if (pointInGeometry(lng0, lat0, geometry)) return [lng0, lat0];
  let best = null;
  for (const coords of polygonParts(geometry)) {
    const hit = bestInteriorLngLat(coords, lng0, lat0);
    if (!hit) continue;
    if (!best || hit.dist < best.dist) best = hit;
  }
  return best ? [best.lng, best.lat] : null;
}
