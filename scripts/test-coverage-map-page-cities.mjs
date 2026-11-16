/**
 * Page-city polygons survive the 12× median outlier drop; also-served giants do not.
 * Run: npx tsx scripts/test-coverage-map-page-cities.mjs
 */
import {
  coverageCityGroupSvg,
  coverageMapMissingCityNames,
  dropAreaOutliers,
  pageCityNamesFromConfig,
} from '../ops/lib/generate-coverage-map.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

function assertEqual(got, want, label) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) {
    console.error(`${label}: got ${a}, want ${b}`);
    process.exit(1);
  }
}

function box(name, size) {
  return {
    name,
    state: 'IA',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [size, 0],
          [size, size],
          [0, size],
          [0, 0],
        ],
      ],
    },
  };
}

const names = pageCityNamesFromConfig({
  primaryCity: 'Cedar Rapids',
  targetSuburbs: ['Marion', { name: 'Iowa City' }, 'Hiawatha'],
});
assertEqual(
  names,
  ['cedar rapids', 'marion', 'iowa city', 'hiawatha'],
  'page city names from config',
);

const small = Array.from({ length: 9 }, (_, i) => box(`Town ${i + 1}`, 1));
const pageCity = box('Cedar Rapids', Math.sqrt(20));
const alsoServedGiant = box('Wrong County', Math.sqrt(20));
const kept = dropAreaOutliers([...small, pageCity, alsoServedGiant], {
  keepNames: names,
});
const keptNames = kept.map((b) => b.name).sort();
assert(
  keptNames.includes('Cedar Rapids'),
  '20× page city is kept',
);
assert(
  !keptNames.includes('Wrong County'),
  '20× also-served town is dropped',
);
assertEqual(
  small.every((t) => keptNames.includes(t.name)),
  true,
  'small towns stay',
);

const droppedWithoutKeep = dropAreaOutliers([...small, pageCity, alsoServedGiant]);
assert(
  !droppedWithoutKeep.some((b) => b.name === 'Cedar Rapids'),
  'without keepNames, 20× page city still drops (legacy rule)',
);

const pageCitySvg = coverageCityGroupSvg({
  name: 'Midvale',
  state: 'UT',
  isPage: true,
  anchor: [10, 10],
  label: [80, 40],
});
assert(pageCitySvg.includes('href="/locations/midvale/"'), 'page city is a location link');
assert(pageCitySvg.includes('>Midvale, UT<'), 'page city chip names the city');
assert(!pageCitySvg.includes('cov-area-static'), 'page city is not static');

const servedSvg = coverageCityGroupSvg({
  name: 'Sandy',
  state: 'UT',
  isPage: false,
  anchor: [10, 10],
  label: [90, 40],
});
assert(!/href=/.test(servedSvg), 'selected city without a page has no link');
assert(servedSvg.includes('cov-area-static'), 'unlinked city is static');
assert(servedSvg.includes('>Sandy, UT<'), 'unlinked city is named');

const missing = coverageMapMissingCityNames(
  `${pageCitySvg}${servedSvg}`,
  {
    primaryCity: 'Midvale',
    state: 'UT',
    coverageAreas: [
      { name: 'Midvale', state: 'UT' },
      { name: 'Sandy', state: 'UT' },
      { name: 'Murray', state: 'UT' },
    ],
  },
);
assertEqual(missing, ['Murray'], 'missing chip is the city not yet named');
assertEqual(
  coverageMapMissingCityNames(`${pageCitySvg}${servedSvg}<text class="cov-chip-text">Murray, UT</text>`, {
    coverageAreas: [
      { name: 'Midvale', state: 'UT' },
      { name: 'Sandy', state: 'UT' },
      { name: 'Murray', state: 'UT' },
    ],
  }),
  [],
  'complete map is not redrawn',
);

console.log('test-coverage-map-page-cities: ok');
