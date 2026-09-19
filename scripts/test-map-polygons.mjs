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

console.log('test-map-polygons: ok');
