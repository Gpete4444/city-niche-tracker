/**
 * Leaflet 1.9 draws a MultiPolygon as one evenodd path, so overlapping
 * islands cancel fill (Fuquay-Varina-style annexations look like outlines).
 * Split each MultiPolygon into Polygon features so each island fills.
 */

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

  return parts.map((coords, i) => ({
    type: 'Feature',
    properties: {
      ...props,
      _largestPart: i === best,
      _partIndex: i,
      _partCount: parts.length,
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
