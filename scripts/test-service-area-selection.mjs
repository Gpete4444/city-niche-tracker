/**
 * Service area map click rules: reversible coverage toggle + radius seed intent.
 * Run: node scripts/test-service-area-selection.mjs
 */
import {
  addCoverage,
  removeCoverage,
  seedCoverageFromRadius,
  coverageClickHint,
  leftoverAlsoServingHint,
  leftoverAlsoServingAddedStatus,
  siblingAlsoServingAddedStatus,
  nearestLeftoverKeys,
  serviceRadiusMilesFromCoverage,
  ALSO_SERVING_CAP,
  AUTO_SEED_MAX_MILES,
  PREFER_MIN_PAGES,
  PREFER_MAX_PAGES,
  normalizeMapPlaceName,
  censusLikePlaceName,
  placeNameAliases,
  placeNameKeySet,
  placeNameSetHas,
  setPlaceNameAliases,
  getPlaceNameAlias,
} from '../ops/lib/service-area-selection.mjs';
import { mergeLocationPages } from '../ops/lib/geo-neighbors.mjs';
import {
  alsoServingHighlightColor,
  serviceAreaEmphasisOutline,
  ALSO_SERVING_AMBER,
  ALSO_SERVING_AMBER_FALLBACK,
  PLAN_OUTLINE,
  clusterColor,
} from '../ops/public/shotgun-clusters.js';

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

function keyOf(name) {
  return `${name.toLowerCase()}|TX`;
}

function row(name) {
  return { name, state: 'TX' };
}

/** Closer leftovers first; Anna is far (outside auto top-10). */
const MILES = {
  [keyOf('McKinney')]: 0,
  [keyOf('Fairview')]: 2,
  [keyOf('Lowry Crossing')]: 3,
  [keyOf('Westminster')]: 5,
  [keyOf('Lucas')]: 6,
  [keyOf('Parker')]: 7,
  [keyOf('Princeton')]: 8,
  [keyOf('Melissa')]: 9,
  [keyOf('Celina')]: 10,
  [keyOf('Prosper')]: 11,
  [keyOf('Seis Lagos')]: 12,
  [keyOf('New Hope')]: 13,
  [keyOf('Weston')]: 14,
  [keyOf('Anna')]: 22,
};

function leftoverDistance(name, key) {
  return MILES[key] ?? 99;
}

function radiusPoolOf(names) {
  const pool = new Map();
  for (const name of names) pool.set(keyOf(name), row(name));
  return pool;
}

const RADIUS_TOWNS = [
  'McKinney',
  'Fairview',
  'Lowry Crossing',
  'Westminster',
  'Lucas',
  'Parker',
  'Princeton',
  'Melissa',
  'Celina',
  'Prosper',
  'Seis Lagos',
  'New Hope',
  'Weston',
  'Anna',
];

function freshState() {
  const selected = new Map();
  const pageKeySet = new Set([keyOf('McKinney'), keyOf('Fairview'), keyOf('Westminster')]);
  const pageOffKeys = new Set();
  const deselectedKeys = new Set();
  const pinnedKeys = new Set();
  const radiusPool = radiusPoolOf(RADIUS_TOWNS);
  const inRadiusKeys = new Set(radiusPool.keys());
  return {
    selected,
    pageKeySet,
    pageOffKeys,
    deselectedKeys,
    pinnedKeys,
    radiusPool,
    inRadiusKeys,
    primaryKey: keyOf('McKinney'),
    primaryRow: row('McKinney'),
  };
}

function seed(state) {
  return seedCoverageFromRadius({
    ...state,
    leftoverDistance,
    alsoServingCap: ALSO_SERVING_CAP,
  });
}

// --- Remove a Page city → stays out; re-add works ---
{
  const state = freshState();
  seed(state);
  assert(state.selected.has(keyOf('Westminster')), 'seed includes Westminster page');
  assert(state.pageKeySet.has(keyOf('Westminster')), 'Westminster starts as a page');

  const removed = removeCoverage({ ...state, key: keyOf('Westminster') });
  assert(removed.hadPage, 'remove reports the dropped page');
  assert(!state.selected.has(keyOf('Westminster')), 'removed city leaves selected');
  assert(!state.pageKeySet.has(keyOf('Westminster')), 'page is cleared on remove');
  assert(state.deselectedKeys.has(keyOf('Westminster')), 'remove is remembered');

  seed(state);
  assert(!state.selected.has(keyOf('Westminster')), 'seed does not snap a removed page city back');
  assert(!state.pageKeySet.has(keyOf('Westminster')), 'seed does not restore the dropped page');

  addCoverage({ ...state, key: keyOf('Westminster'), row: row('Westminster') });
  assert(state.selected.has(keyOf('Westminster')), 're-add puts the city back');
  assert(!state.pageKeySet.has(keyOf('Westminster')), 're-add does not restore Page');
  assert(!state.deselectedKeys.has(keyOf('Westminster')), 're-add clears the exclusion');

  seed(state);
  assert(state.selected.has(keyOf('Westminster')), 'pinned re-add survives a radius re-seed');
  assert(!state.pageKeySet.has(keyOf('Westminster')), 're-seed does not auto-reassign Page');
}

// --- Add a city outside the auto top-10 → stays selected ---
{
  const state = freshState();
  seed(state);
  assert(!state.selected.has(keyOf('Anna')), 'Anna is outside the auto leftover cap');

  addCoverage({ ...state, key: keyOf('Anna'), row: row('Anna') });
  assert(state.selected.has(keyOf('Anna')), 'click-add keeps Anna');
  assert(state.pinnedKeys.has(keyOf('Anna')), 'click-add pins Anna');

  seed(state);
  assert(state.selected.has(keyOf('Anna')), 'radius re-seed keeps a pinned far city');
}

// --- Radius re-seed honors deselectedKeys and pinnedKeys ---
{
  const state = freshState();
  seed(state);
  const autoServing = nearestLeftoverKeys({
    pool: state.radiusPool,
    pageKeys: state.pageKeySet,
    primaryKey: state.primaryKey,
    leftoverDistance,
    cap: ALSO_SERVING_CAP,
  });
  assert(autoServing.includes(keyOf('Lowry Crossing')), 'Lowry Crossing is an auto leftover');

  removeCoverage({ ...state, key: keyOf('Lowry Crossing') });
  addCoverage({ ...state, key: keyOf('Anna'), row: row('Anna') });
  seed(state);

  assert(!state.selected.has(keyOf('Lowry Crossing')), 'deselected leftover stays out after seed');
  assert(state.selected.has(keyOf('Anna')), 'pinned city stays in after seed');
  assert(state.selected.has(keyOf('McKinney')), 'primary always stays');
  assert(state.selected.has(keyOf('Fairview')), 'remaining page stays');
}

// --- Hover copy ---
{
  assertEqual(
    coverageClickHint({ name: 'Westminster', isPrimary: false, isSelected: true, hasPage: true }),
    'Click to remove Westminster (drops its location page)',
    'page-city hover',
  );
  assertEqual(
    coverageClickHint({ name: 'Anna', isPrimary: false, isSelected: false, hasPage: false }),
    'Click to add Anna',
    'unselected hover',
  );
  assertEqual(
    coverageClickHint({ name: 'McKinney', isPrimary: true, isSelected: true, hasPage: true }),
    'McKinney is the primary center',
    'primary hover',
  );
  const leftoverHover = leftoverAlsoServingHint({ name: 'Westminster', ownerCity: 'Anna' });
  const leftoverAdded = leftoverAlsoServingAddedStatus({ name: 'Weston', ownerCity: 'Anna' });
  assertEqual(
    leftoverHover,
    'Click to add Westminster as Also serving (Anna has the location page)',
    'leftover-page city is still Also serving',
  );
  assertEqual(
    leftoverAdded,
    'Added Weston as Also serving (Anna has the location page).',
    'leftover-page coverage add is Also serving',
  );
  for (const copy of [leftoverHover, leftoverAdded]) {
    assert(!/cannot add/i.test(copy), `leftover-page coverage copy must not block: ${copy}`);
    assert(/also serving/i.test(copy), `leftover-page coverage copy names Also serving: ${copy}`);
  }
}

// --- Plan outlines: black ring on current cluster / Page / leftover serving ---
{
  const cluster2 = clusterColor(2);
  assertEqual(cluster2, ALSO_SERVING_AMBER, 'Cluster 2 fill is the default serving amber');
  assertEqual(alsoServingHighlightColor(2), ALSO_SERVING_AMBER_FALLBACK, 'Cluster 2 leftover serving uses fallback');
  assertEqual(alsoServingHighlightColor(1), ALSO_SERVING_AMBER, 'Cluster 1 leftover serving may use amber');
  assert(cluster2 !== PLAN_OUTLINE, 'Cluster 2 fill is not the black plan outline');

  const otherSib = serviceAreaEmphasisOutline({
    isSibling: true,
    isCurrentClusterSibling: false,
    leftoverServing: true,
    currentClusterKey: 2,
  });
  assert(otherSib == null, 'Unselected other-cluster sibling never gets a black ring');

  const otherSibServing = serviceAreaEmphasisOutline({
    isSibling: true,
    isCurrentClusterSibling: false,
    siblingAlsoServing: true,
    currentClusterKey: 2,
  });
  assertEqual(otherSibServing?.color, PLAN_OUTLINE, 'Other-cluster Also serving sibling gets black outline');
  assertEqual(otherSibServing?.weight, 3, 'Other-cluster Also serving outline is bold');

  const otherSibPage = serviceAreaEmphasisOutline({
    isSibling: true,
    isCurrentClusterSibling: false,
    hasPage: true,
    currentClusterKey: 1,
  });
  assert(otherSibPage == null, 'Other-cluster sibling keeps cluster stroke even if marked Page');

  const currentSib = serviceAreaEmphasisOutline({
    isSibling: true,
    isCurrentClusterSibling: true,
    currentClusterKey: 2,
  });
  assertEqual(currentSib?.color, PLAN_OUTLINE, 'Current-cluster sibling gets black outline');
  assertEqual(currentSib?.weight, 3, 'Current-cluster outline is bold');

  const page = serviceAreaEmphasisOutline({ hasPage: true, currentClusterKey: 2 });
  assertEqual(page?.color, PLAN_OUTLINE, 'Page outline is black');
  assertEqual(page?.weight, 3, 'Page outline is bold');

  const primary = serviceAreaEmphasisOutline({ isPrimary: true, hasPage: true, currentClusterKey: 2 });
  assertEqual(primary?.color, PLAN_OUTLINE, 'Primary outline is black');
  assertEqual(clusterColor(2), cluster2, 'Primary fill helper is still Cluster 2 color');

  const leftoverOn2 = serviceAreaEmphasisOutline({ leftoverServing: true, currentClusterKey: 2 });
  assertEqual(leftoverOn2?.color, PLAN_OUTLINE, 'Leftover Also serving gets black outline');
  assertEqual(leftoverOn2?.weight, 3, 'Leftover serving outline is bold');

  const selectedExtra = serviceAreaEmphasisOutline({ isSelected: true, currentClusterKey: 4 });
  assertEqual(selectedExtra?.color, PLAN_OUTLINE, 'Operator-selected leftover gets black outline');
  assertEqual(selectedExtra?.weight, 3, 'Operator-selected leftover outline is bold');

  const unselectedExtra = serviceAreaEmphasisOutline({ isSelected: false, leftoverServing: false });
  assert(unselectedExtra == null, 'Unselected leftover has no black ring');

  const otherSibSelectedOnly = serviceAreaEmphasisOutline({
    isSibling: true,
    isCurrentClusterSibling: false,
    isSelected: true,
    siblingAlsoServing: false,
  });
  assert(otherSibSelectedOnly == null, 'Unselected-style other-cluster sibling stays cluster stroke');
}

// --- Zone seed: no circle; pinned extra (Anna) stays ---
{
  const state = freshState();
  state.inRadiusKeys = new Set([keyOf('McKinney'), keyOf('Fairview')]);
  seedCoverageFromRadius({
    ...state,
    leftoverDistance,
    alsoServingCap: ALSO_SERVING_CAP,
    ignoreRadiusCircle: true,
  });
  const leftover = nearestLeftoverKeys({
    pool: state.radiusPool,
    pageKeys: state.pageKeySet,
    primaryKey: state.primaryKey,
    leftoverDistance,
    cap: ALSO_SERVING_CAP,
    maxMiles: AUTO_SEED_MAX_MILES,
  });
  assertEqual(leftover.length, 1, 'Zone AUTO leftovers stay within 5 miles (do not pad to 10)');
  assert(leftover.includes(keyOf('Lowry Crossing')), 'nearest leftover is included without a circle');
  assert(!leftover.includes(keyOf('Lucas')), 'Lucas at 6 miles is outside AUTO 5 miles');
  assert(!leftover.includes(keyOf('Anna')), 'Anna is outside the auto leftover cap');

  addCoverage({ ...state, key: keyOf('Anna'), row: row('Anna') });
  seedCoverageFromRadius({
    ...state,
    leftoverDistance,
    alsoServingCap: ALSO_SERVING_CAP,
    ignoreRadiusCircle: true,
  });
  assert(state.selected.has(keyOf('Anna')), 'Zone re-seed keeps a pinned sibling extra');
}

// --- AUTO seed max miles: inclusive 5, exclude 6+ ---
{
  const state = freshState();
  const leftover = nearestLeftoverKeys({
    pool: state.radiusPool,
    pageKeys: state.pageKeySet,
    primaryKey: state.primaryKey,
    leftoverDistance,
    cap: ALSO_SERVING_CAP,
    maxMiles: AUTO_SEED_MAX_MILES,
  });
  assert(leftover.includes(keyOf('Lowry Crossing')), '3-mile leftover is AUTO Also serving');
  assert(!leftover.includes(keyOf('Westminster')), 'page city is not Also serving');
  assert(!leftover.includes(keyOf('Lucas')), '6-mile leftover is not AUTO Also serving');
  assert(!leftover.includes(keyOf('Anna')), '22-mile leftover is not AUTO Also serving');

  seedCoverageFromRadius({
    ...state,
    leftoverDistance,
    alsoServingCap: ALSO_SERVING_CAP,
    ignoreRadiusCircle: true,
    maxMiles: AUTO_SEED_MAX_MILES,
  });
  assert(state.selected.has(keyOf('Lowry Crossing')), 'seed keeps a leftover within 5 miles');
  assert(state.selected.has(keyOf('Westminster')), 'seed keeps a page at exactly 5 miles');
  assert(!state.selected.has(keyOf('Lucas')), 'seed does not pad with a 6-mile leftover');
  assert(!state.selected.has(keyOf('Anna')), 'seed does not include a far leftover');

  addCoverage({ ...state, key: keyOf('Lucas'), row: row('Lucas') });
  seedCoverageFromRadius({
    ...state,
    leftoverDistance,
    alsoServingCap: ALSO_SERVING_CAP,
    ignoreRadiusCircle: true,
    maxMiles: AUTO_SEED_MAX_MILES,
  });
  assert(state.selected.has(keyOf('Lucas')), 'pinned city beyond 5 miles survives re-seed');
}

// --- Derived coverage miles from farthest selected city ---
{
  assertEqual(serviceRadiusMilesFromCoverage({ distances: [0, 22.1, 9.4] }), 23, 'ceil max miles');
  assertEqual(serviceRadiusMilesFromCoverage({ distances: [] }), 15, 'empty uses fallback 15');
  assertEqual(serviceRadiusMilesFromCoverage({ distances: [0.2] }), 1, 'sub-mile ceils to 1');
  assertEqual(serviceRadiusMilesFromCoverage({ distances: [140] }), 100, 'cap 100');
}

// --- Census vs map keys for "* City" Zone siblings (Royse City) ---
{
  assertEqual(censusLikePlaceName('Royse City'), 'royse city', 'Census-like keeps proper-name City');
  assertEqual(normalizeMapPlaceName('Royse City'), 'royse', 'map strips trailing City');
  const aliases = new Set(placeNameAliases('Royse City'));
  assert(aliases.has('royse city'), 'alias includes Census key');
  assert(aliases.has('royse'), 'alias includes stripped map key');

  const blocked = placeNameKeySet(['royse city']);
  assert(placeNameSetHas(blocked, 'Royse City', 'royse city|TX'), 'feature Royse City matches Census blocked key');
  assert(placeNameSetHas(blocked, 'Royse City', 'royse|TX'), 'stripped extra key still matches');
  assert(!placeNameSetHas(blocked, 'Fate', 'fate|TX'), 'unrelated city is not a sibling');

  const fillByName = new Map();
  setPlaceNameAliases(fillByName, 'Royse City', clusterColor(5));
  assertEqual(getPlaceNameAlias(fillByName, 'Royse City'), '#e11d48', 'Royse City looks up Cluster 5 fill');
  assertEqual(getPlaceNameAlias(fillByName, 'royse city'), '#e11d48', 'Census key looks up Cluster 5 fill');
  assertEqual(getPlaceNameAlias(fillByName, 'royse'), '#e11d48', 'stripped key looks up Cluster 5 fill');

  const sibling = placeNameSetHas(blocked, 'Royse City', 'royse city|TX');
  const leftoverGray = !sibling;
  assert(sibling && !leftoverGray, 'selected Also-serving sibling uses sibling style, not gray leftover');
  assertEqual(
    siblingAlsoServingAddedStatus({ name: 'Royse City' }),
    'Added Royse City as Also serving. Cluster site — coverage only, never a location page.',
    'sibling add status never offers Page',
  );
}

// --- Zone page underfill: leftovers beyond 5 miles promote; siblings stay unpaged ---
{
  const np = (name) =>
    String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const milesByName = (table) => (name) => table[np(name)] ?? 99;
  const underfill = mergeLocationPages({
    coverage: [
      { name: 'Rockwall', state: 'TX' },
      { name: 'Mobile City', state: 'TX' },
      { name: 'Heath', state: 'TX' },
      { name: 'Fate', state: 'TX' },
      { name: 'McLendon-Chisholm', state: 'TX' },
      { name: 'Rowlett', state: 'TX' },
      { name: 'Royse City', state: 'TX' },
    ],
    ignoreClaudeOrder: true,
    sortBy: 'distance',
    distanceMiles: milesByName({
      'mobile city': 2,
      heath: 4,
      fate: 8,
      'mclendon chisholm': 9,
      rowlett: 10,
      'royse city': 11,
    }),
    maxMiles: AUTO_SEED_MAX_MILES,
    minPages: PREFER_MIN_PAGES,
    primaryCity: 'Rockwall',
    state: 'TX',
    max: PREFER_MAX_PAGES - 1,
    skipName: (name) => np(name) === np('Fate'),
  });
  const keys = new Set(underfill.map((n) => np(n)));
  assert(keys.has(np('Mobile City')), '5-mile seed keeps Mobile City');
  assert(keys.has(np('Heath')), '5-mile seed keeps Heath');
  assert(keys.has(np('McLendon-Chisholm')), 'underfill promotes leftover beyond 5 miles');
  assert(keys.has(np('Rowlett')), 'underfill can continue toward prefer 6');
  assert(!keys.has(np('Fate')), 'sibling leftover is never paged');
  assert(underfill.length >= 3, 'underfill reaches at least 4 pages including primary');
  assert(underfill.length <= PREFER_MAX_PAGES - 1, 'underfill stays at prefer-max suburbs');
}

console.log('test-service-area-selection: ok');
