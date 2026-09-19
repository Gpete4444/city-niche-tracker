/**
 * Also serving: leftover coverage, distance sort, cap 10, site fallback.
 * Run: node scripts/test-also-serving.mjs
 */
import {
  ALSO_SERVING_CAP,
  alsoServingListsEqual,
  alsoServingNamesFromSite,
  coverageAreasForPlan,
  coverageNameKeys,
  deriveAlsoServingNames,
  leftoverCoverageNames,
  withDerivedAlsoServing,
} from '../ops/lib/also-serving.mjs';

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

function assertJson(got, want, label) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) {
    console.error(`${label}: got ${a}, want ${b}`);
    process.exit(1);
  }
}

const coverageAreas = [
  { name: 'Prosper', state: 'TX' },
  { name: 'Allen', state: 'TX' },
  { name: 'Celina', state: 'TX' },
  { name: 'Frisco', state: 'TX' },
  { name: 'Aubrey', state: 'TX' },
  { name: 'Denton', state: 'TX' },
  { name: 'Little Elm', state: 'TX' },
  { name: 'Hackberry', state: 'TX' },
  { name: 'Krugerville', state: 'TX' },
  { name: 'Oak Point', state: 'TX' },
  { name: 'McKinney', state: 'TX' },
  { name: 'Weston', state: 'TX' },
  { name: 'Cross Roads', state: 'TX' },
  { name: 'The Colony', state: 'TX' },
  { name: 'Plano', state: 'TX' },
  { name: 'Anna', state: 'OK' },
];

const pages = {
  primaryCity: 'Prosper',
  targetSuburbs: ['Aubrey', 'Paloma Creek'],
  state: 'TX',
  coverageAreas,
};

const leftovers = leftoverCoverageNames(pages);
assert(!leftovers.some((n) => /^(prosper|aubrey|paloma creek)$/i.test(n)), 'leftovers exclude pages');
assert(!leftovers.includes('Anna'), 'skips other-state coverage');
assert(leftovers.includes('Allen') && leftovers.includes('Celina'), 'keeps leftover TX towns');

const miles = {
  Celina: 1,
  Frisco: 2,
  'Little Elm': 3,
  Hackberry: 4,
  Krugerville: 5,
  'Oak Point': 6,
  McKinney: 7,
  Weston: 8,
  'Cross Roads': 9,
  'The Colony': 10,
  Plano: 11,
  Allen: 12,
  Denton: 13,
};

const nearest = deriveAlsoServingNames({
  ...pages,
  distanceMiles: (name) => miles[name] ?? 99,
});
assertEqual(nearest.length, ALSO_SERVING_CAP, 'cap 10');
assertJson(
  nearest,
  [
    'Celina',
    'Frisco',
    'Little Elm',
    'Hackberry',
    'Krugerville',
    'Oak Point',
    'McKinney',
    'Weston',
    'Cross Roads',
    'The Colony',
  ],
  'nearest leftovers',
);

const uncappedOrder = deriveAlsoServingNames({ ...pages, distanceMiles: null });
assertEqual(uncappedOrder[0], 'Allen', 'coverage order when no distance');
assertEqual(uncappedOrder.length, 10, 'still caps without distance');
assert(!uncappedOrder.includes('Plano'), '11th leftover dropped');

const patched = withDerivedAlsoServing(pages, { distanceMiles: (name) => miles[name] ?? 99 });
assert(patched.changed, 'writes alsoServing when missing');
assertJson(patched.alsoServing, nearest, 'withDerived list');
const again = withDerivedAlsoServing(patched.config, { distanceMiles: (name) => miles[name] ?? 99 });
assert(!again.changed, 'idempotent when already derived');
assert(alsoServingListsEqual(again.alsoServing, nearest), 'equal helper');

assertJson(
  alsoServingNamesFromSite({ ...pages, alsoServing: nearest }),
  nearest,
  'prefers persisted alsoServing',
);
assertJson(
  alsoServingNamesFromSite({
    ...pages,
    alsoServing: [...nearest, 'Aubrey', 'Prosper'],
  }),
  nearest,
  'drops page cities from persisted list',
);
assertJson(
  alsoServingNamesFromSite(pages),
  leftoverCoverageNames(pages).slice(0, 10),
  'fallback leftover cap when alsoServing absent',
);

const skipped = deriveAlsoServingNames({
  ...pages,
  distanceMiles: (name) => miles[name] ?? 99,
  skipName: (name) => name === 'Celina' || name === 'Frisco',
});
assertEqual(skipped[0], 'Little Elm', 'skipName drops claimed leftovers');
assert(!skipped.includes('Celina') && !skipped.includes('Frisco'), 'claimed leftovers excluded');
assertEqual(skipped.length, 10, 'skip still fills to cap from remaining');

const planned = coverageAreasForPlan({
  primaryCity: 'Prosper',
  state: 'TX',
  targetSuburbs: ['Aubrey'],
  alsoServing: ['Celina', 'Frisco'],
});
assert(
  planned.some((a) => a.name === 'Prosper') &&
    planned.some((a) => a.name === 'Aubrey') &&
    planned.some((a) => a.name === 'Celina') &&
    planned.length === 4,
  'plan coverage is primary + pages + also serving',
);
assert(
  coverageNameKeys(patched.config.coverageAreas) ===
    coverageNameKeys(
      coverageAreasForPlan({
        primaryCity: pages.primaryCity,
        state: pages.state,
        targetSuburbs: pages.targetSuburbs,
        alsoServing: nearest,
      }),
    ),
  'withDerived trims coverage to pages + also serving',
);

console.log('test-also-serving: ok');
