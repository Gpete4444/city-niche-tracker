import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  V15_SEO_CLUSTER_PARAMETERS,
  buildNearbySerpPlan,
  calculateJaccard,
  classifySeoRelationship,
  compareSeoSerps,
  domainHash,
  executeNearbySerpValidation,
  extractTop5OrganicDomains,
  getNearbySerpJob,
  invalidateSeoClusterEvidenceForSerpKeys,
  normalizeComparisonDomain,
  normalizeSeoClusterParameters,
  normalizedOrganicDomains,
  previewNearbySerpValidation,
  selectNearbyCities,
  startNearbySerpValidation,
} from '../ops/lib/discovery-seo-cluster.mjs';
import {
  DISCOVERY_COLUMNS,
  DISCOVERY_RUNTIME_COLUMNS,
  createDiscoveryPack,
  discoveryNarrativeSeedFromRow,
  discoveryPresets,
  getBatch,
  importDiscoveryCsv,
  processDiscoveryBatch,
  reopenDiscoveryRows,
  rowKey,
  rowsToDiscoveryPackCsv,
  rowsToDiscoveryRuntimeCsv,
  updateBatchDecisions,
} from '../ops/lib/discovery.mjs';
import { writeSerpCache } from '../scripts/lib/serp-cache.mjs';
import { pathsFor } from '../ops/lib/candidates.mjs';

const freshAt = () => new Date().toISOString();
const nearby = (name, population, state = 'UT') => ({ name, state, population });

function organicItems(domains) {
  return domains.map((domain, index) => ({
    type: 'organic',
    title: `Result ${index + 1}`,
    url: `https://${domain}/${index ? 'service' : ''}`,
    domain,
    rank_group: index + 1,
  }));
}

function cache(domains, { at = freshAt(), items = organicItems(domains), uniqueNiche = [] } = {}) {
  return {
    at,
    items,
    itemTypes: ['organic'],
    classified: {
      uniqueOrganicDomains: domains,
      uniqueNicheOrganicDomains: uniqueNiche,
    },
  };
}

function context(places = [nearby('Lehi', 85000), nearby('Orem', 95000)]) {
  return JSON.stringify({
    eligible: true,
    nearbyStatus: 'available',
    nearbyPlaces: places,
  });
}

function targetRow(overrides = {}) {
  return {
    Niche: 'Epoxy Flooring',
    City: 'Alpine',
    State: 'UT',
    screenDecision: 'SURVIVE',
    screenRule: 'NONE',
    screenReason: 'existing screen reason',
    screenUniqueOrganicDomainCount: '7',
    screenUniqueNicheOrganicDomainCount: '3',
    screenMapPackPresent: 'false',
    screenPaidPresent: 'false',
    screenPaidCount: '0',
    screenLsaPresent: 'false',
    screenOrganicHomePageCount: '4',
    screenOrganicSubPageCount: '3',
    screenDirectoryCount: '1',
    screenParameters: '{"fixture":true}',
    recommended_decision: 'maybe',
    recommended_reason: 'existing recommendation',
    human_decision: 'deprioritize',
    decision_notes: 'keep me',
    candidateId: 'existing-candidate-id',
    process_status: 'promoted',
    populationContext: context(),
    ...overrides,
  };
}

async function fixtureBatch(rows, filters = {}, stage = 'claude_imported') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rover-v15-p3-'));
  const batch = {
    id: path.basename(dir),
    stage,
    filters: {
      nearbyCityRadiusMiles: 40,
      nearbyCityMinPopulation: 5000,
      maxNearbySerps: 5,
      seoClusterMinJaccard: 0.30,
      seoClusterMinSharedDomains: 2,
      ...filters,
    },
    files: { candidates: 'candidates.csv' },
  };
  await fs.writeFile(path.join(dir, 'meta.json'), `${JSON.stringify(batch, null, 2)}\n`);
  await fs.writeFile(path.join(dir, 'candidates.csv'), rowsToDiscoveryRuntimeCsv(rows));
  return { batch, rows, dir };
}

test('Package-3 parameters have exact defaults and validation ranges', () => {
  assert.deepEqual(V15_SEO_CLUSTER_PARAMETERS, {
    maxNearbySerps: 5,
    seoClusterMinJaccard: 0.30,
    seoClusterMinSharedDomains: 2,
    mixedMinJaccard: 0.15,
    mixedMinSharedDomains: 1,
    mixedMinSharedTop5Domains: 1,
  });
  assert.deepEqual(normalizeSeoClusterParameters({}), {
    nearbyCityRadiusMiles: 40,
    nearbyCityMinPopulation: 5000,
    ...V15_SEO_CLUSTER_PARAMETERS,
  });
  assert.equal(normalizeSeoClusterParameters({ maxNearbySerps: 6 }).maxNearbySerps, 5);
  assert.equal(normalizeSeoClusterParameters({ maxNearbySerps: 0 }).maxNearbySerps, 0);
  assert.equal(normalizeSeoClusterParameters({ seoClusterMinJaccard: 1.1 }).seoClusterMinJaccard, 0.30);
  assert.equal(normalizeSeoClusterParameters({ seoClusterMinSharedDomains: 0 }).seoClusterMinSharedDomains, 2);
});

test('comparison domains are URL-safe normalized deduped sorted and use uniqueOrganicDomains only', () => {
  const classified = {
    uniqueOrganicDomains: ['WWW.Beta.test/path', 'https://alpha.test/a', 'beta.test', 'yelp.com'],
    uniqueNicheOrganicDomains: ['forbidden-niche-only.test'],
  };
  assert.equal(normalizeComparisonDomain('HTTPS://WWW.Example.COM/path'), 'example.com');
  assert.deepEqual(normalizedOrganicDomains(classified), ['alpha.test', 'beta.test']);
  assert.equal(domainHash(classified), domainHash({ uniqueOrganicDomains: ['beta.test', 'alpha.test'] }));
  assert.equal(normalizedOrganicDomains(classified).includes('forbidden-niche-only.test'), false);
});

test('Map Pack, paid, LSA, directories, and uniqueNicheOrganicDomains cannot affect membership', () => {
  const target = cache(['a.test', 'b.test'], { uniqueNiche: ['invented-shared.test'] });
  target.classified.localPack = [{ domain: 'map-shared.test' }];
  target.classified.paidAds = { links: [{ domain: 'paid-shared.test' }] };
  target.classified.features = { localServicesAds: true };
  const comparison = cache(['c.test', 'd.test'], { uniqueNiche: ['invented-shared.test'] });
  comparison.classified.localPack = [{ domain: 'map-shared.test' }];
  comparison.classified.paidAds = { links: [{ domain: 'paid-shared.test' }] };
  comparison.classified.features = { localServicesAds: true };
  const measured = compareSeoSerps(target, comparison);
  assert.equal(measured.sharedDomainCount, 0);
  assert.equal(measured.relationship, 'SEPARATE');
});

test('Jaccard and exact RELATED MIXED SEPARATE boundaries are deterministic', () => {
  assert.deepEqual(calculateJaccard(['a.test', 'b.test'], ['b.test', 'c.test']), {
    targetDomainCount: 2,
    nearbyDomainCount: 2,
    sharedDomainCount: 1,
    sharedDomains: ['b.test'],
    jaccard: 1 / 3,
  });
  assert.equal(classifySeoRelationship({ sharedDomainCount: 2, jaccard: 0.30, sharedTop5DomainCount: 0 }), 'RELATED');
  assert.equal(classifySeoRelationship({ sharedDomainCount: 2, jaccard: 0.29, sharedTop5DomainCount: 0 }), 'MIXED');
  assert.equal(classifySeoRelationship({ sharedDomainCount: 1, jaccard: 0.50, sharedTop5DomainCount: 0 }), 'MIXED');
  assert.equal(classifySeoRelationship({ sharedDomainCount: 1, jaccard: 0.15, sharedTop5DomainCount: 0 }), 'MIXED');
  assert.equal(classifySeoRelationship({ sharedDomainCount: 0, jaccard: 0, sharedTop5DomainCount: 1 }), 'MIXED');
  assert.equal(classifySeoRelationship({ sharedDomainCount: 0, jaccard: 0, sharedTop5DomainCount: 0 }), 'SEPARATE');
});

test('shared-top-5 uses organic position, excludes directories, and diagnoses missing raw evidence', () => {
  const ranked = cache(['local.test'], {
    items: [
      { type: 'organic', domain: 'yelp.com', url: 'https://yelp.com/x', rank_group: 1 },
      { type: 'organic', domain: 'local.test', url: 'https://local.test', rank_group: 2 },
      { type: 'organic', domain: 'late.test', url: 'https://late.test', rank_group: 6 },
    ],
  });
  assert.deepEqual(extractTop5OrganicDomains(ranked).domains, ['local.test']);
  assert.equal(extractTop5OrganicDomains({ classified: {} }).available, false);
  const measurement = compareSeoSerps(ranked, cache(['local.test']));
  assert.equal(measurement.sharedTop5DomainCount, 1);
  assert.equal(measurement.relationship, 'MIXED');
  const missingOneSide = compareSeoSerps(ranked, { classified: { uniqueOrganicDomains: ['local.test'] } });
  assert.equal(missingOneSide.sharedTop5Availability.available, false);
  assert.equal(missingOneSide.sharedTop5DomainCount, 0);
});

test('nearby ordering applies city then state tie-breaks and missing state falls back to target', () => {
  const selected = selectNearbyCities(targetRow({
    populationContext: context([
      nearby('Zulu', 10000, 'WY'),
      nearby('Alpha', 10000, 'WY'),
      nearby('Alpha', 10000, 'UT'),
      { name: 'Beta', population: 10000 },
      { name: '', state: 'UT', population: 99999 },
      { name: 'Bad Pop', state: 'UT', population: 'not-a-number' },
    ]),
  }));
  assert.deepEqual(selected.map((item) => `${item.city}|${item.state}`), [
    'Alpha|UT', 'Alpha|WY', 'Beta|UT', 'Zulu|WY',
  ]);
  assert.ok(selected.length <= 5);
});

test('maxNearbySerps zero and blank screen produce explicit target statuses', async () => {
  const rows = [targetRow(), targetRow({ City: 'Blank', screenDecision: '' })];
  const fixture = await fixtureBatch(rows, { maxNearbySerps: 0 });
  try {
    for (const row of rows) writeSerpCache(fixture.dir, rowKey(row), cache(['a.test']));
    const plan = buildNearbySerpPlan({ ...fixture, rowKeyFn: rowKey });
    assert.deepEqual(plan.rowPlans.map((item) => item.status), ['max_nearby_zero', 'skipped_not_survive']);
    assert.equal(plan.comparisonCount, 0);
    assert.equal(plan.liveCalls, 0);
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('missing, stale, and invalid target caches remain skipped and never call fetch', async () => {
  const rows = [targetRow(), targetRow({ City: 'Stale' }), targetRow({ City: 'Invalid' })];
  const fixture = await fixtureBatch(rows, { maxNearbySerps: 1 });
  try {
    writeSerpCache(fixture.dir, rowKey(rows[1]), cache(['a.test'], { at: '2020-01-01T00:00:00.000Z' }));
    writeSerpCache(fixture.dir, rowKey(rows[2]), { at: freshAt(), classified: {} });
    const preview = previewNearbySerpValidation(fixture, { rowKeyFn: rowKey });
    let calls = 0;
    const result = await executeNearbySerpValidation(fixture, {
      expectedPlanToken: preview.planToken,
      rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
      fetchOrganicSerpFn: async () => { calls += 1; throw new Error('not expected'); },
    });
    assert.equal(calls, 0);
    assert.deepEqual(result.rows.map((row) => JSON.parse(row.seoClusterEvidence).status), [
      'skipped_no_target_cache', 'skipped_no_target_cache', 'skipped_no_target_cache',
    ]);
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('plan token is stable without state changes and skipped targets never dynamically enter execution', async () => {
  const row = targetRow({ populationContext: context([nearby('Lehi', 85000)]) });
  const fixture = await fixtureBatch([row], { maxNearbySerps: 1 });
  try {
    const first = buildNearbySerpPlan({ ...fixture, rowKeyFn: rowKey });
    const second = buildNearbySerpPlan({ ...fixture, rowKeyFn: rowKey });
    assert.equal(first.planToken, second.planToken);
    writeSerpCache(fixture.dir, rowKey(row), cache(['a.test']));
    const result = await executeNearbySerpValidation(fixture, {
      expectedPlanToken: first.planToken,
      preparedPlan: first,
      rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
    });
    assert.equal(JSON.parse(result.rows[0].seoClusterEvidence).status, 'skipped_no_target_cache');
    assert.equal(result.artifact.summary.actualProviderCalls, 0);
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('nearby selection is persisted-context-only, population filtered, deduped, deterministic, and capped', () => {
  const row = targetRow({
    populationContext: context([
      nearby('Alpine', 999999),
      nearby('Orem', 95000),
      nearby('Lehi', 85000),
      nearby('Lehi', 84000),
      nearby('Tiny', 4999),
      nearby('Provo', 120000),
      nearby('Draper', 60000),
      nearby('Sandy', 100000),
      nearby('Murray', 51000),
    ]),
  });
  assert.deepEqual(selectNearbyCities(row, { maxNearbySerps: 3 }).map((item) => item.city), [
    'Provo', 'Sandy', 'Orem',
  ]);
  assert.deepEqual(selectNearbyCities(row, { maxNearbySerps: 0 }), []);
  assert.deepEqual(selectNearbyCities({ ...row, populationContext: '{bad' }), []);
});

test('plan enforces survivor/population/nearby/target-cache precedence and never plans target purchase', async () => {
  const rows = [
    targetRow(),
    targetRow({ City: 'No Screen', screenDecision: 'SCREEN_OUT' }),
    targetRow({ City: 'Ineligible', populationContext: JSON.stringify({ eligible: false, nearbyStatus: 'available', nearbyPlaces: [] }) }),
    targetRow({ City: 'Unavailable', populationContext: JSON.stringify({ eligible: true, nearbyStatus: 'unavailable' }) }),
    targetRow({ City: 'Missing Target' }),
  ];
  const fixture = await fixtureBatch(rows);
  try {
    writeSerpCache(fixture.dir, rowKey(rows[0]), cache(['a.test', 'b.test']));
    const plan = buildNearbySerpPlan({ ...fixture, rowKeyFn: rowKey });
    assert.deepEqual(plan.rowPlans.map((item) => item.status), [
      'ready', 'skipped_not_survive', 'skipped_population_ineligible', 'nearby_unavailable', 'skipped_no_target_cache',
    ]);
    assert.equal(plan.distinctLiveKeys.includes(rowKey(rows[0])), false);
    assert.equal(plan.survivorTargetRows, 1);
    assert.equal(plan.skippedTargetRows, 4);
    assert.equal(plan.liveCalls, 2);
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('plan batch-dedupes nearby SERP keys and token changes with cache provenance', async () => {
  const rows = [
    targetRow({ populationContext: context([nearby('Lehi', 85000)]) }),
    targetRow({ City: 'Draper', populationContext: context([nearby('Lehi', 85000)]) }),
  ];
  const fixture = await fixtureBatch(rows, { maxNearbySerps: 1 });
  try {
    writeSerpCache(fixture.dir, rowKey(rows[0]), cache(['a.test']));
    writeSerpCache(fixture.dir, rowKey(rows[1]), cache(['b.test']));
    const before = buildNearbySerpPlan({ ...fixture, rowKeyFn: rowKey });
    assert.equal(before.comparisonCount, 2);
    assert.equal(before.liveCalls, 1);
    writeSerpCache(fixture.dir, rowKey({ Niche: rows[0].Niche, City: 'Lehi', State: 'UT' }), cache(['a.test']));
    const after = buildNearbySerpPlan({ ...fixture, rowKeyFn: rowKey });
    assert.equal(after.liveCalls, 0);
    assert.equal(after.cacheHitComparisons, 2);
    assert.notEqual(after.planToken, before.planToken);
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('preview reports distinct live-call cost honestly and cache-only needs no credentials', async () => {
  const rows = [targetRow({ populationContext: context([nearby('Lehi', 85000)]) })];
  const fixture = await fixtureBatch(rows, { maxNearbySerps: 1 });
  try {
    writeSerpCache(fixture.dir, rowKey(rows[0]), cache(['a.test', 'b.test']));
    const live = previewNearbySerpValidation(fixture, { rowKeyFn: rowKey });
    assert.equal(live.liveCalls, 1);
    assert.equal(live.estimateUsdLow, 0.002);
    assert.equal(live.estimateUsdHigh, 0.003);
    writeSerpCache(fixture.dir, rowKey({ Niche: rows[0].Niche, City: 'Lehi', State: 'UT' }), cache(['a.test', 'b.test']));
    const cached = previewNearbySerpValidation(fixture, { rowKeyFn: rowKey });
    let credentialChecks = 0;
    const result = await executeNearbySerpValidation(fixture, {
      expectedPlanToken: cached.planToken,
      rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
      requireCredentialsFn: () => { credentialChecks += 1; throw new Error('must not check'); },
    });
    assert.equal(credentialChecks, 0);
    assert.equal(result.artifact.summary.actualProviderCalls, 0);
    assert.equal(result.artifact.summary.actualCostUsd, 0);
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('execution compares atomically, preserves non-P3 fields and stage, and writes one artifact', async () => {
  const original = targetRow({ populationContext: context([nearby('Lehi', 85000), nearby('Orem', 95000)]) });
  const fixture = await fixtureBatch([original], { maxNearbySerps: 2 }, 'claude_imported');
  try {
    const targetPath = writeSerpCache(fixture.dir, rowKey(original), cache(['a.test', 'b.test', 'c.test']));
    const targetBefore = await fs.readFile(targetPath, 'utf8');
    writeSerpCache(fixture.dir, rowKey({ Niche: original.Niche, City: 'Lehi', State: 'UT' }), cache(['a.test', 'b.test', 'x.test']));
    writeSerpCache(fixture.dir, rowKey({ Niche: original.Niche, City: 'Orem', State: 'UT' }), cache(['z.test']));
    const preview = previewNearbySerpValidation(fixture, { rowKeyFn: rowKey });
    const result = await executeNearbySerpValidation(fixture, {
      expectedPlanToken: preview.planToken,
      rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
    });
    const evidence = JSON.parse(result.rows[0].seoClusterEvidence);
    assert.equal(evidence.version, 1);
    assert.equal(evidence.status, 'complete');
    assert.deepEqual(evidence.summary, { relatedCount: 1, mixedCount: 0, separateCount: 1 });
    assert.deepEqual(JSON.parse(result.rows[0].seoClusterCities), ['Lehi,UT']);
    for (const field of [
      'screenUniqueOrganicDomainCount', 'screenUniqueNicheOrganicDomainCount',
      'screenDecision', 'screenRule', 'screenReason', 'screenMapPackPresent',
      'screenPaidPresent', 'screenPaidCount', 'screenLsaPresent',
      'screenOrganicHomePageCount', 'screenOrganicSubPageCount',
      'screenDirectoryCount', 'screenParameters', 'recommended_decision',
      'recommended_reason', 'human_decision', 'decision_notes', 'candidateId', 'process_status',
      'Niche', 'City', 'State',
    ]) {
      assert.equal(result.rows[0][field], original[field], field);
    }
    assert.equal(result.batch.stage, 'claude_imported');
    assert.ok(result.batch.lastNearbySerpValidation.artifact);
    assert.equal(await fs.readFile(targetPath, 'utf8'), targetBefore);
    const artifacts = (await fs.readdir(fixture.dir)).filter((name) => name.startsWith('discovery-seo-cluster-'));
    assert.equal(artifacts.length, 1);
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('stale plan token returns 409 before provider or persistence', async () => {
  const row = targetRow({ populationContext: context([nearby('Lehi', 85000)]) });
  const fixture = await fixtureBatch([row], { maxNearbySerps: 1 });
  try {
    writeSerpCache(fixture.dir, rowKey(row), cache(['a.test']));
    const preview = previewNearbySerpValidation(fixture, { rowKeyFn: rowKey });
    const candidatesBefore = await fs.readFile(path.join(fixture.dir, 'candidates.csv'), 'utf8');
    const metaBefore = await fs.readFile(path.join(fixture.dir, 'meta.json'), 'utf8');
    let calls = 0;
    await assert.rejects(
      executeNearbySerpValidation(fixture, {
        expectedPlanToken: `${preview.planToken}-stale`,
        rowKeyFn: rowKey,
        rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
        fetchOrganicSerpFn: async () => { calls += 1; return { items: [], cost: 0 }; },
      }),
      (error) => error.status === 409 && error.code === 'nearby_serp_plan_changed',
    );
    assert.equal(calls, 0);
    assert.equal(await fs.readFile(path.join(fixture.dir, 'candidates.csv'), 'utf8'), candidatesBefore);
    assert.equal(await fs.readFile(path.join(fixture.dir, 'meta.json'), 'utf8'), metaBefore);
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('live execution caps concurrency at two, fetches each key once, and charges exact returned cost', async () => {
  const rows = [
    targetRow({ City: 'Alpine', populationContext: context([nearby('Lehi', 85000), nearby('Orem', 95000)]) }),
    targetRow({ City: 'Draper', populationContext: context([nearby('Lehi', 85000)]) }),
  ];
  const fixture = await fixtureBatch(rows, { maxNearbySerps: 2 });
  try {
    for (const row of rows) writeSerpCache(fixture.dir, rowKey(row), cache(['a.test', 'b.test']));
    const preview = previewNearbySerpValidation(fixture, { rowKeyFn: rowKey });
    assert.equal(preview.liveCalls, 2);
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const result = await executeNearbySerpValidation(fixture, {
      expectedPlanToken: preview.planToken,
      concurrency: 99,
      rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
      fetchOrganicSerpFn: async () => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return { items: organicItems(['a.test', 'b.test']), itemTypes: ['organic'], cost: 0.004 };
      },
    });
    assert.equal(calls, 2);
    assert.equal(maxActive, 2);
    assert.equal(result.artifact.summary.actualProviderCalls, 2);
    assert.equal(result.artifact.summary.actualCostUsd, 0.008);
    assert.equal(result.artifact.fetches.length, 2);
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('successful live fetch writes existing cache and the second run is cache-only', async () => {
  const row = targetRow({ populationContext: context([nearby('Lehi', 85000)]) });
  const fixture = await fixtureBatch([row], { maxNearbySerps: 1 });
  try {
    writeSerpCache(fixture.dir, rowKey(row), cache(['a.test', 'b.test']));
    const firstPreview = previewNearbySerpValidation(fixture, { rowKeyFn: rowKey });
    let calls = 0;
    const first = await executeNearbySerpValidation(fixture, {
      expectedPlanToken: firstPreview.planToken,
      rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
      fetchOrganicSerpFn: async () => {
        calls += 1;
        return { items: organicItems(['a.test', 'b.test']), itemTypes: ['organic'], cost: 0.002 };
      },
    });
    assert.equal(calls, 1);
    const nextData = { batch: first.batch, rows: first.rows, dir: fixture.dir };
    const secondPreview = previewNearbySerpValidation(nextData, { rowKeyFn: rowKey });
    assert.equal(secondPreview.liveCalls, 0);
    const second = await executeNearbySerpValidation(nextData, {
      expectedPlanToken: secondPreview.planToken,
      rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
    });
    assert.equal(second.artifact.summary.actualProviderCalls, 0);
    assert.equal(JSON.parse(second.rows[0].seoClusterEvidence).comparisons[0].cacheDisposition, 'cache_hit');
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('a live default path verifies credentials before creating a job or persisting', async () => {
  const row = targetRow({ populationContext: context([nearby('Lehi', 85000)]) });
  const fixture = await fixtureBatch([row], { maxNearbySerps: 1 });
  try {
    writeSerpCache(fixture.dir, rowKey(row), cache(['a.test']));
    const preview = previewNearbySerpValidation(fixture, { rowKeyFn: rowKey });
    const before = await fs.readFile(path.join(fixture.dir, 'candidates.csv'), 'utf8');
    let credentialChecks = 0;
    await assert.rejects(executeNearbySerpValidation(fixture, {
      expectedPlanToken: preview.planToken,
      rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
      requireCredentialsFn: () => { credentialChecks += 1; throw new Error('fixture missing credentials'); },
    }), /fixture missing credentials/);
    assert.equal(credentialChecks, 1);
    assert.equal(await fs.readFile(path.join(fixture.dir, 'candidates.csv'), 'utf8'), before);
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('partial rows retain successful relationships while failed edges stay unresolved', async () => {
  const row = targetRow({ populationContext: context([nearby('Lehi', 85000), nearby('Orem', 95000)]) });
  const fixture = await fixtureBatch([row], { maxNearbySerps: 2 });
  try {
    writeSerpCache(fixture.dir, rowKey(row), cache(['a.test', 'b.test']));
    const preview = previewNearbySerpValidation(fixture, { rowKeyFn: rowKey });
    const result = await executeNearbySerpValidation(fixture, {
      expectedPlanToken: preview.planToken,
      rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
      fetchOrganicSerpFn: async (keyword) => {
        if (keyword.includes('Orem')) throw new Error('Orem fixture failure');
        return { items: organicItems(['a.test', 'b.test']), itemTypes: ['organic'], cost: 0.002 };
      },
    });
    const evidence = JSON.parse(result.rows[0].seoClusterEvidence);
    assert.equal(evidence.status, 'partial');
    assert.equal(evidence.summary.relatedCount, 1);
    assert.equal(evidence.comparisons.filter((item) => item.unresolved).length, 1);
    assert.deepEqual(JSON.parse(result.rows[0].seoClusterCities), ['Lehi,UT']);
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('one failed shared fetch is recorded once and all dependent edges become partial', async () => {
  const rows = [
    targetRow({ City: 'Alpine', populationContext: context([nearby('Lehi', 85000)]) }),
    targetRow({ City: 'Draper', populationContext: context([nearby('Lehi', 85000)]) }),
  ];
  const fixture = await fixtureBatch(rows, { maxNearbySerps: 1 });
  try {
    for (const row of rows) writeSerpCache(fixture.dir, rowKey(row), cache(['a.test']));
    const preview = previewNearbySerpValidation(fixture, { rowKeyFn: rowKey });
    let calls = 0;
    const result = await executeNearbySerpValidation(fixture, {
      expectedPlanToken: preview.planToken,
      rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
      fetchOrganicSerpFn: async () => { calls += 1; throw new Error('fixture failure'); },
    });
    assert.equal(calls, 1);
    assert.equal(result.artifact.summary.fetchErrors, 1);
    assert.deepEqual(result.rows.map((row) => JSON.parse(row.seoClusterEvidence).status), ['partial', 'partial']);
    assert.equal(result.artifact.rows.length, 2);
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('invalid comparison location is unresolved without a live call', async () => {
  const row = targetRow({ populationContext: context([nearby('Nowhere', 85000, 'ZZ')]) });
  const fixture = await fixtureBatch([row], { maxNearbySerps: 1 });
  try {
    writeSerpCache(fixture.dir, rowKey(row), cache(['a.test']));
    const preview = previewNearbySerpValidation(fixture, { rowKeyFn: rowKey });
    assert.equal(preview.liveCalls, 0);
    const result = await executeNearbySerpValidation(fixture, {
      expectedPlanToken: preview.planToken,
      rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
    });
    const evidence = JSON.parse(result.rows[0].seoClusterEvidence);
    assert.equal(evidence.status, 'partial');
    assert.equal(evidence.comparisons[0].cacheDisposition, 'invalid_location');
    assert.equal(result.artifact.summary.actualProviderCalls, 0);
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('async job state completes with persisted result and reports partial unresolved work', async () => {
  const row = targetRow({ populationContext: context([nearby('Nowhere', 85000, 'ZZ')]) });
  const fixture = await fixtureBatch([row], { maxNearbySerps: 1 });
  try {
    writeSerpCache(fixture.dir, rowKey(row), cache(['a.test']));
    const preview = previewNearbySerpValidation(fixture, { rowKeyFn: rowKey });
    const started = startNearbySerpValidation(fixture, {
      expectedPlanToken: preview.planToken,
      rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
    });
    assert.equal(started.status, 'running');
    while (started.status === 'running') await new Promise((resolve) => setTimeout(resolve, 5));
    const job = getNearbySerpJob(started.id);
    assert.equal(job.status, 'partial');
    assert.equal(job.result.artifact.summary.actualProviderCalls, 0);
    assert.equal(JSON.parse(job.result.rows[0].seoClusterEvidence).status, 'partial');
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('primary SERP cache refresh invalidates every dependent Package-3 row and only P3 fields', () => {
  const evidence = JSON.stringify({
    version: 1,
    status: 'complete',
    target: { rowKey: 'niche|target|ut' },
    targetSerp: { cacheKey: 'niche|target|ut' },
    comparisons: [{ serpKey: 'niche|shared|ut' }],
    summary: { relatedCount: 1, mixedCount: 0, separateCount: 0 },
  });
  const rows = [
    targetRow({ seoClusterCities: '["Shared,UT"]', seoClusterEvidence: evidence }),
    targetRow({ City: 'Second', seoClusterCities: '["Shared,UT"]', seoClusterEvidence: evidence }),
    targetRow({ City: 'Unaffected', seoClusterCities: '[]', seoClusterEvidence: '' }),
  ];
  const changed = invalidateSeoClusterEvidenceForSerpKeys(rows, ['NICHE|SHARED|UT']);
  assert.deepEqual(changed.slice(0, 2).map((row) => JSON.parse(row.seoClusterEvidence).status), [
    'stale_serp_changed', 'stale_serp_changed',
  ]);
  assert.deepEqual(changed.slice(0, 2).map((row) => row.seoClusterCities), ['[]', '[]']);
  assert.equal(changed[0].human_decision, rows[0].human_decision);
  assert.equal(changed[2], rows[2]);
});

test('an invalidated row recomputes from refreshed cache with zero provider calls', async () => {
  const row = targetRow({ populationContext: context([nearby('Lehi', 85000)]) });
  const fixture = await fixtureBatch([row], { maxNearbySerps: 1 });
  try {
    const targetKey = rowKey(row);
    const nearbyKey = rowKey({ Niche: row.Niche, City: 'Lehi', State: 'UT' });
    writeSerpCache(fixture.dir, targetKey, cache(['a.test', 'b.test']));
    writeSerpCache(fixture.dir, nearbyKey, cache(['a.test', 'b.test']));
    const firstPreview = previewNearbySerpValidation(fixture, { rowKeyFn: rowKey });
    const first = await executeNearbySerpValidation(fixture, {
      expectedPlanToken: firstPreview.planToken,
      rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
    });
    const invalidated = invalidateSeoClusterEvidenceForSerpKeys(first.rows, [nearbyKey]);
    writeSerpCache(fixture.dir, nearbyKey, cache(['a.test', 'b.test', 'c.test']));
    const rerunData = { batch: first.batch, rows: invalidated, dir: fixture.dir };
    const rerunPreview = previewNearbySerpValidation(rerunData, { rowKeyFn: rowKey });
    assert.equal(rerunPreview.liveCalls, 0);
    const rerun = await executeNearbySerpValidation(rerunData, {
      expectedPlanToken: rerunPreview.planToken,
      rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
    });
    assert.equal(JSON.parse(rerun.rows[0].seoClusterEvidence).status, 'complete');
    assert.equal(rerun.artifact.summary.actualProviderCalls, 0);
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('Package-3 fields are runtime-only and narrative seed parses them safely', () => {
  assert.equal(DISCOVERY_RUNTIME_COLUMNS.includes('seoClusterCities'), true);
  assert.equal(DISCOVERY_RUNTIME_COLUMNS.includes('seoClusterEvidence'), true);
  assert.equal(DISCOVERY_COLUMNS.includes('seoClusterCities'), false);
  const packCsv = rowsToDiscoveryPackCsv([{
    Niche: 'x',
    seoClusterCities: 'SEO_CLUSTER_CITIES_SENTINEL',
    seoClusterEvidence: 'SEO_CLUSTER_EVIDENCE_SENTINEL',
  }]);
  assert.equal(packCsv.includes('seoClusterCities'), false);
  assert.equal(packCsv.includes('seoClusterEvidence'), false);
  assert.equal(packCsv.includes('SEO_CLUSTER_CITIES_SENTINEL'), false);
  assert.equal(packCsv.includes('SEO_CLUSTER_EVIDENCE_SENTINEL'), false);
  const valid = discoveryNarrativeSeedFromRow({
    Niche: 'x', City: 'y', State: 'UT',
    seoClusterCities: '["Lehi,UT"]',
    seoClusterEvidence: '{"status":"complete"}',
  });
  assert.deepEqual(valid.seoClusterCities, ['Lehi,UT']);
  assert.equal(valid.seoClusterEvidence.status, 'complete');
  const malformed = discoveryNarrativeSeedFromRow({ seoClusterCities: '{bad', seoClusterEvidence: '[]' });
  assert.deepEqual(malformed.seoClusterCities, []);
  assert.equal(malformed.seoClusterEvidence, null);
});

test('candidate handoff keeps Release-1.0 suggested_suburbs cluster independent from Package-3 cities', async () => {
  const uniqueNiche = `Package 3 Cluster Isolation ${Date.now()}`;
  const pack = createDiscoveryPack({ state: 'UT', cities: ['Alpine'], requiredNiches: [uniqueNiche], maxRows: 1 });
  let candidatePaths = null;
  try {
    const imported = importDiscoveryCsv(pack.batch.id, rowsToDiscoveryPackCsv([{
      Niche: uniqueNiche,
      City: 'Alpine',
      State: 'UT',
      Population: '12000',
      suggested_suburbs: 'Lehi; Cedar Hills',
    }]), { createIfMissing: false });
    imported.rows[0].seoClusterCities = '["Orem,UT"]';
    imported.rows[0].seoClusterEvidence = '{"version":1,"status":"complete"}';
    imported.rows[0].human_decision = 'maybe';
    await fs.writeFile(path.join(pack.batchDir, 'candidates.csv'), rowsToDiscoveryRuntimeCsv(imported.rows));
    const processed = processDiscoveryBatch(pack.batch.id, { runStage1ForPursue: false });
    assert.equal(processed.promoted.length, 1);
    candidatePaths = pathsFor(processed.promoted[0].candidateId);
    const config = JSON.parse(await fs.readFile(candidatePaths.config, 'utf8'));
    const seed = JSON.parse(await fs.readFile(candidatePaths.discoverySeed, 'utf8'));
    assert.deepEqual(config.cluster, ['Lehi,UT', 'Cedar Hills,UT']);
    assert.equal(config.cluster.includes('Orem,UT'), false);
    assert.deepEqual(seed.seoClusterCities, ['Orem,UT']);
  } finally {
    if (candidatePaths) {
      for (const value of Object.values(candidatePaths)) {
        if (typeof value === 'string' && path.isAbsolute(value)) await fs.rm(value, { recursive: true, force: true });
      }
    }
    await fs.rm(pack.batchDir, { recursive: true, force: true });
  }
});

test('settings and Package-3 evidence survive reload, real deprioritize Process, and reopen', async () => {
  const uniqueNiche = `Package 3 Persistence ${Date.now()}`;
  const pack = createDiscoveryPack({
    state: 'UT', cities: ['Alpine'], requiredNiches: [uniqueNiche], maxRows: 1,
    nearbyCityRadiusMiles: 25, nearbyCityMinPopulation: 10000,
    maxNearbySerps: 3, seoClusterMinJaccard: 0.42, seoClusterMinSharedDomains: 4,
  });
  try {
    assert.equal(pack.batch.filters.nearbyCityRadiusMiles, 25);
    assert.equal(pack.batch.filters.nearbyCityMinPopulation, 10000);
    assert.equal(pack.batch.filters.maxNearbySerps, 3);
    assert.equal(pack.batch.filters.seoClusterMinJaccard, 0.42);
    assert.equal(pack.batch.filters.seoClusterMinSharedDomains, 4);
    const imported = importDiscoveryCsv(pack.batch.id, rowsToDiscoveryPackCsv([{
      Niche: uniqueNiche, City: 'Alpine', State: 'UT', Population: '12000',
    }]), { createIfMissing: false });
    const evidence = JSON.stringify({ version: 1, status: 'complete', comparisons: [], summary: { relatedCount: 0, mixedCount: 0, separateCount: 1 } });
    imported.rows[0].seoClusterCities = '["Lehi,UT"]';
    imported.rows[0].seoClusterEvidence = evidence;
    imported.rows[0].screenDecision = 'SURVIVE';
    await fs.writeFile(path.join(pack.batchDir, 'candidates.csv'), rowsToDiscoveryRuntimeCsv(imported.rows));
    updateBatchDecisions(pack.batch.id, [{ index: 0, human_decision: 'deprioritize' }]);
    let reloaded = getBatch(pack.batch.id);
    assert.equal(reloaded.rows[0].seoClusterEvidence, evidence);
    const processed = processDiscoveryBatch(pack.batch.id, { runStage1ForPursue: false });
    assert.equal(processed.rows[0].process_status, 'tracked');
    assert.equal(processed.rows[0].candidateId, '');
    assert.equal(processed.rows[0].seoClusterCities, '["Lehi,UT"]');
    const reopened = reopenDiscoveryRows(pack.batch.id, [0]);
    assert.equal(reopened.rows[0].process_status, '');
    assert.equal(reopened.rows[0].seoClusterEvidence, evidence);
  } finally {
    await fs.rm(pack.batchDir, { recursive: true, force: true });
  }
});

test('source wiring exposes preview/token/job/UI and Package-3 never applies recommendations', async () => {
  const [core, server, app, html, prompt] = await Promise.all([
    fs.readFile(new URL('../ops/lib/discovery-seo-cluster.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../ops/server.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../ops/public/app.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../ops/public/index.html', import.meta.url), 'utf8'),
    fs.readFile(new URL('../prompts/discovery-claude.md', import.meta.url), 'utf8'),
  ]);
  assert.equal(core.includes('applyRecommendations'), false);
  assert.match(server, /nearby-serp\/preview/);
  assert.match(server, /expectedPlanToken/);
  assert.match(server, /nearby-serp-jobs/);
  assert.match(app, /Nearby SERP plan changed|nearby SERP plan changed/);
  assert.match(app, /SEO market/);
  assert.match(html, /name="maxNearbySerps"/);
  assert.match(html, /name="seoClusterMinJaccard"/);
  assert.match(html, /name="seoClusterMinSharedDomains"/);
  assert.deepEqual(discoveryPresets().seoClusterDefaults, V15_SEO_CLUSTER_PARAMETERS);
  for (const forbidden of ['related keywords', 'Maps SERP', 'backlinks', 'Anthropic', 'OpenStreetMap', 'targetSuburbs', 'coverageAreas']) {
    assert.equal(core.includes(forbidden), false, forbidden);
  }
  assert.ok(prompt.length > 0);
});
