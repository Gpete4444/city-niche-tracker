/**
 * Place polygon explode / paint order / sliver flag.
 * Run: node scripts/test-map-polygons.mjs
 */
import {
  explodePlaceFeatures,
  explodeAndSortPlaceFeatures,
  sortPlaceFeaturesLargestFirst,
  isSliverPart,
  isLargestPart,
  featurePolygonArea,
  labelAnchorLngLat,
  SLIVER_AREA_FRACTION,
} from '../ops/public/map-polygons.js';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

function ring(x0, y0, x1, y1) {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
}

/** 10x10 main, 3x3 island (~9%), 1x1 sliver (1%). */
const multi = {
  type: 'Feature',
  properties: { name: 'Annex City', state: 'TX' },
  geometry: {
    type: 'MultiPolygon',
    coordinates: [[ring(0, 0, 10, 10)], [ring(20, 20, 23, 23)], [ring(40, 40, 41, 41)]],
  },
};

const exploded = explodePlaceFeatures(multi);
assertEqual(exploded.features.length, 3, 'explode yields three parts');
const largest = exploded.features.find((f) => isLargestPart(f));
const island = exploded.features.find((f) => {
  const a = featurePolygonArea(f);
  return !isLargestPart(f) && a > 5;
});
const sliver = exploded.features.find((f) => isSliverPart(f));
assert(largest, 'main body tagged largest');
assert(island, 'medium island is not a sliver');
assert(sliver, 'tiny leftover is a sliver');
assert(!isSliverPart(largest), 'main body is not a sliver');
assert(!isSliverPart(island), 'island above 2% is not a sliver');
assert(featurePolygonArea(sliver) / featurePolygonArea(largest) < SLIVER_AREA_FRACTION, 'sliver under fraction');

const smallCity = {
  type: 'Feature',
  properties: { name: 'Anna', state: 'TX' },
  geometry: { type: 'Polygon', coordinates: [ring(0, 0, 2, 2)] },
};
const bigCity = {
  type: 'Feature',
  properties: { name: 'Melissa', state: 'TX' },
  geometry: { type: 'Polygon', coordinates: [ring(0, 0, 20, 20)] },
};
const sorted = sortPlaceFeaturesLargestFirst([smallCity, bigCity]);
assertEqual(sorted[0].properties.name, 'Melissa', 'largest first');
assertEqual(sorted[1].properties.name, 'Anna', 'smallest last (paints on top)');

const painted = explodeAndSortPlaceFeatures({
  type: 'FeatureCollection',
  features: [smallCity, multi, bigCity],
});
assert(
  featurePolygonArea(painted.features[0]) >= featurePolygonArea(painted.features[painted.features.length - 1]),
  'explodeAndSort is largest-first',
);
const paintedNames = painted.features.map((f) => f.properties.name);
assert(paintedNames.indexOf('Melissa') < paintedNames.indexOf('Anna'), 'Melissa paints before Anna');

const rect = { type: 'Polygon', coordinates: [ring(0, 0, 4, 2)] };
const rectAnchor = labelAnchorLngLat(rect, 2, 1);
assertEqual(rectAnchor[0], 2, 'rectangle label stays on center lng');
assertEqual(rectAnchor[1], 1, 'rectangle label stays on center lat');

/** L: base y=0..1 across x=0..3, stem x=0..1 up to y=3. Bbox center (1.5, 1.5) is outside. */
const ell = {
  type: 'Polygon',
  coordinates: [[[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3], [0, 0]]],
};
const ellAnchor = labelAnchorLngLat(ell, 1.5, 1.5);
assert(ellAnchor, 'L label has an anchor');
const onEll =
  (ellAnchor[0] >= 0 && ellAnchor[0] <= 3 && ellAnchor[1] >= 0 && ellAnchor[1] <= 1) ||
  (ellAnchor[0] >= 0 && ellAnchor[0] <= 1 && ellAnchor[1] >= 0 && ellAnchor[1] <= 3);
assert(onEll, 'L label sits on the city');
const ellDist = Math.hypot(ellAnchor[0] - 1.5, ellAnchor[1] - 1.5);
assert(ellDist < 1.2, 'L label stays near the bbox center');
assert(ellDist < Math.hypot(0.2 - 1.5, 2.8 - 1.5), 'L label is closer than the far tip');

const holed = {
  type: 'Polygon',
  coordinates: [ring(0, 0, 10, 10), ring(4, 4, 6, 6)],
};
const holeAnchor = labelAnchorLngLat(holed, 5, 5);
assert(holeAnchor, 'hole label has an anchor');
const inHole = holeAnchor[0] > 4 && holeAnchor[0] < 6 && holeAnchor[1] > 4 && holeAnchor[1] < 6;
assert(!inHole, 'label moves out of the hole onto the city');
assert(Math.hypot(holeAnchor[0] - 5, holeAnchor[1] - 5) < 2, 'hole label stays near the center');

console.log('test-map-polygons: ok');
