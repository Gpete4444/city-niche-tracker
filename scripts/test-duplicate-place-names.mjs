/**
 * Same-state duplicate Census places all paint (GEOID identity).
 * Run: node scripts/test-duplicate-place-names.mjs
 */
import { existsSync } from 'node:fs';
import { normalizePlaceName } from '../ops/lib/census.mjs';
import { loadPlacesLayer, placesGeojsonPath } from '../ops/lib/census-map-layers.mjs';
import {
  buildPlaceNeighborsIndex,
  featureBbox,
  findPlaceFeatureLocal,
  neighborKey,
  placesIntersectingRadius,
} from '../ops/lib/geo-neighbors.mjs';
import { findPlaceFeature, getMapGeojson } from '../ops/lib/research-map.mjs';
import {
  featureLayerKey,
  featuresToMergeByGeoid,
  placeFeatureMeta,
  preferPlaceMeta,
} from '../ops/lib/service-area-selection.mjs';

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

function bboxesNear(a, b, pad = 0.05) {
  if (!a || !b) return false;
  return !(a[2] + pad < b[0] || b[2] + pad < a[0] || a[3] + pad < b[1] || b[3] + pad < a[1]);
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

function poly(name, state, geoid, population, x0, y0, x1, y1) {
  return {
    type: 'Feature',
    properties: { name, state, geoid, population },
    geometry: { type: 'Polygon', coordinates: [ring(x0, y0, x1, y1)] },
  };
}

{
  const sunnyvale = poly('Sunnyvale', 'TX', 's1', 9000, 0, 0, 1, 1);
  const dallasMesq = poly('Mesquite', 'TX', '4847892', 150000, 1, 0, 2, 1);
  const tinyMesq = poly('Mesquite', 'TX', '4847898', 219, 100, 100, 101, 101);
  const valleyTown = poly('El Cenizo', 'TX', 'e1', 380, 101, 100, 102, 101);
  const graph = buildPlaceNeighborsIndex({
    type: 'FeatureCollection',
    features: [sunnyvale, dallasMesq, tinyMesq, valleyTown],
  });
  const mesqN = graph[neighborKey('Mesquite', 'TX')] || [];
  assert(
    mesqN.some((x) => normalizePlaceName(x.name) === 'sunnyvale'),
    'winner Mesquite neighbors include Sunnyvale',
  );
  assert(
    !mesqN.some((x) => normalizePlaceName(x.name) === 'el cenizo'),
    'winner Mesquite does not inherit Valley-town neighbors',
  );
}

{
  const tiny = poly('Mesquite', 'TX', '4847898', 219, 100, 100, 101, 101);
  const dallas = poly('Mesquite', 'TX', '4847892', 150000, 1, 0, 2, 1);
  dallas.properties.isPrimary = true;
  const have = new Set([featureLayerKey(tiny)]);
  const { toAdd } = featuresToMergeByGeoid([tiny, dallas], have);
  assertEqual(toAdd.length, 1, 'merge adds the second same-name GEOID');
  assertEqual(String(toAdd[0].properties.geoid), '4847892', 'Dallas Mesquite still adds after tiny is present');
  assert(
    preferPlaceMeta(placeFeatureMeta(tiny), placeFeatureMeta(dallas)),
    'primary/larger Mesquite wins name|state pop and center',
  );
}

if (!existsSync(placesGeojsonPath())) {
  console.log('test-duplicate-place-names: skip (Census map missing)');
  process.exit(0);
}

const loaded = loadPlacesLayer();
const txRaw = loaded.byState.get('TX') || [];
const rawByName = new Map();
for (const f of txRaw) {
  const name = normalizePlaceName(f.properties?.name);
  if (!name) continue;
  if (!rawByName.has(name)) rawByName.set(name, []);
  rawByName.get(name).push(f);
}
const collisions = [...rawByName.entries()].filter(([, rows]) => {
  const geoids = new Set(rows.map((f) => String(f.properties?.geoid || '')));
  return geoids.size > 1;
});
assert(collisions.length >= 1, 'TX map layer has at least one same-name GEOID pair');
assert(
  collisions.some(([name]) => name === 'mesquite'),
  'Mesquite, TX is a committed duplicate-name fixture',
);

const painted = getMapGeojson({ layer: 'places', state: 'TX', minPop: 0 });
assert(painted.features.length > 0, 'TX-scoped geojson returns places');

for (const [name, rows] of collisions) {
  const want = new Set(rows.map((f) => String(f.properties?.geoid || '')).filter(Boolean));
  const got = new Set(
    painted.features
      .filter((f) => normalizePlaceName(f.properties?.name) === name)
      .map((f) => String(f.properties?.geoid || '')),
  );
  for (const geoid of want) {
    assert(got.has(geoid), `state-scoped geojson keeps ${name} GEOID ${geoid}`);
  }
}

const mesquites = painted.features.filter(
  (f) =>
    normalizePlaceName(f.properties?.name) === 'mesquite' &&
    String(f.properties?.state || '').toUpperCase() === 'TX',
);
assert(mesquites.length >= 2, 'both Mesquite, TX GEOIDs paint');

const dallas = mesquites.find((f) => String(f.properties?.geoid) === '4847892');
const tiny = mesquites.find((f) => String(f.properties?.geoid) === '4847898');
assert(dallas, 'Dallas Mesquite GEOID 4847892 is in TX geojson');
assert(tiny, 'South Texas Mesquite GEOID 4847898 is in TX geojson');
assert(Number(dallas.properties.population) > 100000, 'Dallas Mesquite keeps city-scale pop');
assert(Number(tiny.properties.population) < 1000, 'tiny Mesquite keeps its own pop');
assert(
  Number(dallas.properties.population) !== Number(tiny.properties.population),
  'duplicate Mesquites do not share one population',
);

const sunnyvale = painted.features.find(
  (f) =>
    normalizePlaceName(f.properties?.name) === 'sunnyvale' &&
    String(f.properties?.state || '').toUpperCase() === 'TX',
);
assert(sunnyvale, 'Sunnyvale, TX is in TX geojson');
assert(
  bboxesNear(featureBbox(dallas), featureBbox(sunnyvale), 0.08),
  'Dallas Mesquite bbox sits next to Sunnyvale',
);
assert(
  !bboxesNear(featureBbox(tiny), featureBbox(sunnyvale), 2),
  'tiny Mesquite is not the Dallas-area polygon',
);

const shown = findPlaceFeature('Mesquite', 'TX');
assertEqual(String(shown?.properties?.geoid || ''), '4847892', 'Show/zoom resolves largest Mesquite');
assertEqual(
  String(findPlaceFeatureLocal('Mesquite', 'TX')?.properties?.geoid || ''),
  '4847892',
  'findPlaceFeatureLocal matches findPlaceFeature',
);

const cover = placesIntersectingRadius('Mesquite', 'TX', 20, { minPop: 5000 });
assert(
  cover.features.some((f) => String(f.properties?.geoid) === '4847892' && f.properties?.isPrimary),
  'coverage primary is Dallas Mesquite GEOID',
);
assert(
  !cover.features.some((f) => String(f.properties?.geoid) === '4847898'),
  'Valley Mesquite is not in Dallas coverage radius',
);

console.log('test-duplicate-place-names: ok');
