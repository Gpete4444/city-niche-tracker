import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ADS_DEMAND_ENGINE_VERSION,
  ADS_INTENT_CLASSIFIER_VERSION,
  ADS_KEYWORD_CONTRACT_VERSION,
  adsCityKey,
  adsDemandAuthorityMatches,
  adsDemandRowKey,
  buildAdsKeywordSeeds,
  collectAdsDemand,
  normalizeAdsCities,
  safePreHumanAdsPath,
  selectCanonicalKeywords,
} from '../scripts/lib/ads-demand-research.mjs';
import {
  PRE_HUMAN_ADS_HARD_LIMITS,
  V15_PRE_HUMAN_ADS_PARAMETERS,
  buildAdsDemandSignature,
  buildSelectiveAdsPlan,
  classifyAdsKeywordIntent,
  currentAdsDemandDisplay,
  currentAdsDemandHandoff,
  currentSeoClusterAuthority,
  executeSelectiveAdsDemand,
  normalizePreHumanAdsParameters,
  previewSelectiveAdsDemand,
  startSelectiveAdsDemand,
  summarizeAdsIntent,
} from '../ops/lib/discovery-ads-demand.mjs';
import {
  DISCOVERY_ADS_DEMAND_COLUMNS,
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
import { createCandidate, pathsFor } from '../ops/lib/candidates.mjs';
import { researchCandidate } from '../scripts/research-candidate.mjs';
import { discoveryAdsEvidenceIsCurrent } from '../ops/public/discovery-ads-authority.js';

const location = (city, code, state = 'Utah') => ({
  locationName: `${city},${state},United States`,
  locationCode: code,
});
const locations = [location('Alpine', 1), location('Lehi', 2), location('Orem', 3), location('Draper', 4)];

function p3Evidence(status = 'complete') {
  return JSON.stringify({ version: 1, status, comparisons: [], summary: {} });
}

function row(overrides = {}) {
  return {
    Niche: 'Epoxy Flooring',
    City: 'Alpine',
    State: 'UT',
    screenDecision: 'SURVIVE',
    screenRule: 'NONE',
    screenReason: 'frozen',
    screenUniqueOrganicDomainCount: '4',
    recommended_decision: 'review',
    recommended_reason: 'frozen recommendation',
    human_decision: '',
    decision_notes: 'human-owned',
    candidateId: '',
    process_status: '',
    populationContext: JSON.stringify({ eligible: true, nearbyStatus: 'available', nearbyPlaces: [] }),
    seoClusterCities: '["Lehi,UT","Orem,UT"]',
    seoClusterEvidence: p3Evidence(),
    ...overrides,
  };
}

function keywordRows(keywords, base = 10) {
  return Object.fromEntries(keywords.map((keyword, index) => [keyword.toLowerCase(), {
    keyword,
    searchVolume: base + index,
    competition: 'LOW',
    competitionIndex: 20,
    cpc: 4,
    monthlySearches: [{ year: 2026, month: 1, search_volume: base + index }],
  }]));
}

function fakeDependencies({ failCodes = new Set(), calls = null } = {}) {
  const count = calls || { loader: 0, related: 0, volume: [] };
  return {
    calls: count,
    deps: {
      loadAdsLocationsFn: async () => { count.loader += 1; return locations; },
      resolveAdsLocationFn: (_all, city) => locations.find((item) => item.locationName.startsWith(`${city},`)) || null,
      fetchRelatedKeywordsFn: async () => {
        count.related += 1;
        return {
          cost: 0.05,
          ideas: [
            { keyword: 'epoxy flooring cost', competition: 'LOW', cpc: 5 },
            { keyword: 'epoxy flooring jobs', competition: 'LOW', cpc: 2 },
          ],
        };
      },
      fetchSearchVolumesFn: async (keywords, code) => {
        count.volume.push(code);
        if (failCodes.has(code)) throw new Error(`fixture failure ${code}`);
        return { cost: 0.075, byKeyword: keywordRows(keywords, code * 10) };
      },
    },
  };
}

async function tempBatch(rows, filters = {}, { withLocationCache = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rover-v15-p4-'));
  const id = 'fixture-batch';
  const dir = path.join(root, 'research', 'batches', id);
  await fs.mkdir(dir, { recursive: true });
  if (withLocationCache) {
    await fs.mkdir(path.join(root, '.cache'), { recursive: true });
    await fs.writeFile(path.join(root, '.cache', 'google-ads-locations-us.json'), JSON.stringify(locations));
  }
  const batch = {
    id,
    stage: 'discovery_serp_probed',
    filters: { maxPreHumanAdsRows: 5, maxPreHumanAdsVolumeCalls: 30, ...filters },
    files: { candidates: 'candidates.csv' },
  };
  await fs.writeFile(path.join(dir, 'meta.json'), `${JSON.stringify(batch, null, 2)}\n`);
  await fs.writeFile(path.join(dir, 'candidates.csv'), rowsToDiscoveryRuntimeCsv(rows));
  return { root, dir, batch, rows };
}

async function removeCandidateArtifacts(candidateId) {
  if (!candidateId) return;
  const candidatePaths = pathsFor(candidateId);
  for (const value of Object.values(candidatePaths)) {
    if (typeof value === 'string' && path.isAbsolute(value)) await fs.rm(value, { recursive: true, force: true });
  }
}

function stampSidecar(state, {
  signature,
  niche = 'x',
  primary = 'Alpine,UT',
  clusterAuthorityStatus = 'complete',
} = {}) {
  return {
    ...state,
    version: ADS_DEMAND_ENGINE_VERSION,
    keywordContractVersion: ADS_KEYWORD_CONTRACT_VERSION,
    intentClassifierVersion: ADS_INTENT_CLASSIFIER_VERSION,
    niche,
    rowKey: adsDemandRowKey({ niche, primary }),
    signature,
    clusterAuthorityStatus,
    collectedAt: new Date().toISOString(),
    intentSummary: summarizeAdsIntent(state.volumes),
  };
}

function stage1Args(root, {
  niche = 'x',
  primary = 'Alpine,UT',
  adsCluster = ['Lehi,UT'],
  ref = '',
  signature = '',
  out = path.join(root, 'research', 'candidate.json'),
} = {}) {
  return {
    niche, primary, cluster: ['Draper,UT'], adsCluster, seeds: [], related: 10, out,
    skipVolumes: false, enrich: false, adsMode: 'live', serpCache: '', forceSerp: false,
    volumesOnly: false, preHumanAdsRef: ref, adsDemandSignature: signature,
  };
}

const fakeSerp = async () => ({ cost: 0, checkUrl: null, itemTypes: [], items: [] });

test('Package-4 controls and absolute ceilings are exact', () => {
  assert.deepEqual(V15_PRE_HUMAN_ADS_PARAMETERS, { maxPreHumanAdsRows: 5, maxPreHumanAdsVolumeCalls: 30 });
  assert.deepEqual(PRE_HUMAN_ADS_HARD_LIMITS, {
    rows: 10, relatedKeywordCalls: 10, searchVolumeCalls: 60, rowConcurrency: 2, adsLocationLoaderInvocations: 1,
  });
  assert.deepEqual(normalizePreHumanAdsParameters({}), V15_PRE_HUMAN_ADS_PARAMETERS);
  assert.equal(normalizePreHumanAdsParameters({ maxPreHumanAdsRows: 99 }).maxPreHumanAdsRows, 5);
  assert.equal(normalizePreHumanAdsParameters({ maxPreHumanAdsVolumeCalls: 61 }).maxPreHumanAdsVolumeCalls, 30);
  assert.deepEqual(discoveryPresets().preHumanAdsDefaults, V15_PRE_HUMAN_ADS_PARAMETERS);
});

test('Ads geography is target first plus unique sorted RELATED cities only', () => {
  assert.deepEqual(normalizeAdsCities('Alpine,UT', ['Orem,UT', 'Alpine,UT', 'Lehi,UT', 'Lehi,UT']), [
    { city: 'Alpine', state: 'UT' }, { city: 'Lehi', state: 'UT' }, { city: 'Orem', state: 'UT' },
  ]);
  const authority = currentSeoClusterAuthority(row({
    suggested_suburbs: 'Draper; Sandy',
    populationContext: JSON.stringify({ eligible: true, nearbyPlaces: [{ name: 'Provo', state: 'UT', population: 100000 }] }),
  }));
  assert.deepEqual(authority.adsCluster, ['Lehi,UT', 'Orem,UT']);
});

test('Package-3 authority permits current target-only statuses and rejects stale/malformed authority', () => {
  for (const status of ['no_nearby_candidates', 'nearby_unavailable', 'max_nearby_zero']) {
    assert.deepEqual(currentSeoClusterAuthority(row({ seoClusterEvidence: p3Evidence(status), seoClusterCities: '{bad' })), {
      usable: true, status, adsCluster: [],
    });
  }
  assert.equal(currentSeoClusterAuthority(row({ seoClusterEvidence: p3Evidence('stale_serp_changed') })).usable, false);
  assert.equal(currentSeoClusterAuthority(row({ seoClusterEvidence: '{bad' })).usable, false);
});

test('signature is deterministic and changes only with authoritative Ads inputs', () => {
  const base = row();
  const a = buildAdsDemandSignature({ row: base, adsCluster: ['Lehi,UT'], clusterAuthorityStatus: 'complete', relatedLimit: 10 });
  const b = buildAdsDemandSignature({ row: { ...base, human_decision: 'pursue' }, adsCluster: ['Lehi,UT'], clusterAuthorityStatus: 'complete', relatedLimit: 10 });
  assert.equal(a, b);
  assert.equal(a, buildAdsDemandSignature({ row: base, adsCluster: ['Lehi,UT'], clusterAuthorityStatus: 'partial', relatedLimit: 10 }));
  assert.notEqual(a, buildAdsDemandSignature({ row: base, adsCluster: ['Orem,UT'], clusterAuthorityStatus: 'complete', relatedLimit: 10 }));
  assert.notEqual(a, buildAdsDemandSignature({ row: { ...base, Niche: 'Roofing' }, adsCluster: ['Lehi,UT'], clusterAuthorityStatus: 'complete', relatedLimit: 10 }));
  assert.equal(ADS_KEYWORD_CONTRACT_VERSION, 'v1-seeds-related-limit-1');
});

test('V1 seed, related limit, merge, normalization, and dedupe semantics are preserved', () => {
  assert.deepEqual(buildAdsKeywordSeeds('Epoxy Flooring', 'Alpine,UT', []), ['epoxy flooring', 'epoxy flooring alpine']);
  assert.deepEqual(buildAdsKeywordSeeds('x', 'Alpine,UT', ['Configured Seed']), ['Configured Seed']);
  const selected = selectCanonicalKeywords(['alpha'], [{ keyword: 'ALPHA' }, { keyword: 'beta' }, { keyword: 'gamma' }], 2);
  assert.deepEqual(selected.map((item) => item.keyword), ['alpha', 'beta']);
});

test('shared engine preserves canonical Stage-1 shape and monthly evidence', async () => {
  const fake = fakeDependencies();
  const result = await collectAdsDemand({
    niche: 'Epoxy Flooring', primary: 'Alpine,UT', adsCluster: ['Lehi,UT'], relatedLimit: 3,
    locations, dependencies: fake.deps,
  });
  assert.equal(result.status, 'complete');
  assert.equal(fake.calls.related, 1);
  assert.deepEqual(fake.calls.volume, [1, 2]);
  assert.deepEqual(Object.keys(result.volumes), [
    'mode', 'adsMode', 'primaryLocation', 'primaryVolumeSum', 'clusterVolumeSum', 'averageCpc',
    'relatedIdeasFromPrimary', 'keywords', 'citiesMeasured', 'citiesWithoutAdsGeoTarget', 'byCity',
  ]);
  assert.equal(result.volumes.mode, 'per_city_sum');
  assert.equal(result.volumes.keywords[0].primaryVolume, 10);
  assert.equal(result.volumes.keywords[0].clusterSum, 30);
  assert.deepEqual(Object.keys(result.volumes.byCity[0]), [
    'city', 'state', 'locationName', 'locationCode', 'keywordVolumes',
  ]);
  assert.ok(Array.isArray(result.geoStates['alpine|UT'].keywords['epoxy flooring'].monthlySearches));
  assert.deepEqual(result.volumes, {
    mode: 'per_city_sum',
    adsMode: 'live',
    primaryLocation: 'Alpine,Utah,United States',
    primaryVolumeSum: 33,
    clusterVolumeSum: 96,
    averageCpc: 5,
    relatedIdeasFromPrimary: [
      { keyword: 'epoxy flooring cost', competition: 'LOW', cpc: 5 },
      { keyword: 'epoxy flooring jobs', competition: 'LOW', cpc: 2 },
    ],
    keywords: [
      { keyword: 'epoxy flooring', primaryVolume: 10, clusterSum: 30, perCity: { 'Alpine, UT': 10, 'Lehi, UT': 20 }, competition: null, cpc: null },
      { keyword: 'epoxy flooring alpine', primaryVolume: 11, clusterSum: 32, perCity: { 'Alpine, UT': 11, 'Lehi, UT': 21 }, competition: null, cpc: null },
      { keyword: 'epoxy flooring cost', primaryVolume: 12, clusterSum: 34, perCity: { 'Alpine, UT': 12, 'Lehi, UT': 22 }, competition: 'LOW', cpc: 5 },
    ],
    citiesMeasured: ['Alpine, UT', 'Lehi, UT'],
    citiesWithoutAdsGeoTarget: [],
    byCity: [
      { city: 'Alpine', state: 'UT', locationName: 'Alpine,Utah,United States', locationCode: 1, keywordVolumes: { 'epoxy flooring': 10, 'epoxy flooring alpine': 11, 'epoxy flooring cost': 12 } },
      { city: 'Lehi', state: 'UT', locationName: 'Lehi,Utah,United States', locationCode: 2, keywordVolumes: { 'epoxy flooring': 20, 'epoxy flooring alpine': 21, 'epoxy flooring cost': 22 } },
    ],
  });
});

test('unsupported primary returns structured status with zero paid keyword and volume calls', async () => {
  const fake = fakeDependencies();
  const result = await collectAdsDemand({
    niche: 'x', primary: 'Nowhere,UT', adsCluster: ['Lehi,UT'], locations, dependencies: fake.deps,
  });
  assert.equal(result.status, 'unsupported_primary_ads_geo');
  assert.equal(fake.calls.related, 0);
  assert.deepEqual(fake.calls.volume, []);
});

test('unsupported Related geo is distinct, gets no request, and row can complete', async () => {
  const fake = fakeDependencies();
  const result = await collectAdsDemand({
    niche: 'x', primary: 'Alpine,UT', adsCluster: ['Missing,UT', 'Lehi,UT'], locations, dependencies: fake.deps,
  });
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.unsupportedCities, ['Missing, UT']);
  assert.deepEqual(fake.calls.volume, [1, 2]);
  assert.equal(result.volumes.citiesMeasured.includes('Missing, UT'), false);
});

test('resolved geo provider failure is retryable partial, never unsupported or fake zero', async () => {
  const fake = fakeDependencies({ failCodes: new Set([3]) });
  const result = await collectAdsDemand({
    niche: 'x', primary: 'Alpine,UT', adsCluster: ['Lehi,UT', 'Orem,UT'], locations, dependencies: fake.deps,
  });
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.unsupportedCities, []);
  assert.equal(result.failedGeos.length, 1);
  assert.equal(result.failedGeos[0].locationCode, 3);
  assert.equal(result.geoStates['orem|UT'].status, 'failed');
  assert.equal(result.volumes.byCity.some((city) => city.city === 'Orem'), false);
});

test('partial resume buys only the failed City-B volume operation', async () => {
  const firstFake = fakeDependencies({ failCodes: new Set([3]) });
  const first = await collectAdsDemand({
    niche: 'x', primary: 'Alpine,UT', adsCluster: ['Lehi,UT', 'Orem,UT'], locations, dependencies: firstFake.deps,
  });
  assert.equal(firstFake.calls.related, 1);
  assert.deepEqual(firstFake.calls.volume, [1, 2, 3]);
  const resumedFake = fakeDependencies();
  const resumed = await collectAdsDemand({
    niche: 'x', primary: 'Alpine,UT', adsCluster: ['Lehi,UT', 'Orem,UT'], locations,
    priorState: first, dependencies: resumedFake.deps,
  });
  assert.equal(resumedFake.calls.related, 0);
  assert.deepEqual(resumedFake.calls.volume, [3]);
  assert.equal(resumed.status, 'complete');
});

test('complete compatible evidence reuses with no credentials, loader, related, or volume calls', async () => {
  const first = await collectAdsDemand({
    niche: 'x', primary: 'Alpine,UT', adsCluster: ['Lehi,UT'], locations, dependencies: fakeDependencies().deps,
  });
  const reused = await collectAdsDemand({
    niche: 'x', primary: 'Alpine,UT', adsCluster: ['Lehi,UT'], priorState: first,
    reuseCompleteWithoutLocationLoad: true,
    dependencies: {
      loadAdsLocationsFn: async () => { throw new Error('no loader'); },
      fetchRelatedKeywordsFn: async () => { throw new Error('no related'); },
      fetchSearchVolumesFn: async () => { throw new Error('no volume'); },
    },
  });
  assert.equal(reused.reusedComplete, true);
  assert.equal(reused.provider.newProviderCostUsd, 0);
});

test('intent classifier is deterministic, employment-first, local-only, and does not mutate volumes', () => {
  assert.equal(classifyAdsKeywordIntent('plumber jobs'), 'EMPLOYMENT_IRRELEVANT');
  assert.equal(classifyAdsKeywordIntent('contractor jobs'), 'EMPLOYMENT_IRRELEVANT');
  assert.equal(classifyAdsKeywordIntent('emergency plumber near me'), 'READY_TO_HIRE');
  assert.equal(classifyAdsKeywordIntent('plumber cost'), 'COMMERCIAL_RESEARCH');
  assert.equal(classifyAdsKeywordIntent('how to repair pipe'), 'INFORMATIONAL');
  assert.equal(classifyAdsKeywordIntent('plumber'), 'OTHER_NON_JOB');
  const volumes = { keywords: [
    { keyword: 'plumber jobs', primaryVolume: 20, clusterSum: 30 },
    { keyword: 'emergency plumber', primaryVolume: 80, clusterSum: 100 },
  ] };
  const before = JSON.stringify(volumes);
  const summary = summarizeAdsIntent(volumes);
  assert.equal(summary.target.nonJobVolume, 80);
  assert.equal(summary.cluster.rawVolume, 130);
  assert.equal(summary.cluster.shares.readyToHire, 1);
  assert.equal(JSON.stringify(volumes), before);
});

test('planner uses only explicitly selected original row indices and skips ineligible selections', async () => {
  const rows = [
    row(),
    row({ City: 'Draper' }),
    row({ City: 'Screened', screenDecision: 'SCREEN_OUT' }),
    row({ City: 'Pop', populationContext: JSON.stringify({ eligible: false }) }),
    row({ City: 'Tracked', process_status: 'tracked' }),
    row({ City: 'Stale', seoClusterEvidence: p3Evidence('stale_serp_changed') }),
  ];
  const fixture = await tempBatch(rows);
  try {
    const plan = buildSelectiveAdsPlan({ ...fixture, indices: [5, 3, 1, 4, 2], root: fixture.root, rowKeyFn: rowKey });
    assert.deepEqual(plan.rowPlans.map((item) => item.index), [1, 2, 3, 4, 5]);
    assert.equal(plan.eligibleRows, 1);
    assert.equal(plan.rowPlans[0].rowKey, rowKey(rows[1]));
    assert.equal(plan.rowPlans.some((item) => item.index === 0), false);
    assert.deepEqual(plan.rowPlans.slice(1).map((item) => item.status), [
      'skipped_not_survive', 'skipped_population_ineligible', 'skipped_processed', 'skipped_no_current_seo_cluster',
    ]);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('row and volume caps reject without truncation', async () => {
  const many = Array.from({ length: 6 }, (_, index) => row({ Niche: `Niche ${index}`, seoClusterCities: '[]' }));
  const fixture = await tempBatch(many, { maxPreHumanAdsRows: 5, maxPreHumanAdsVolumeCalls: 3 });
  try {
    const rowCap = buildSelectiveAdsPlan({ ...fixture, indices: [0, 1, 2, 3, 4, 5], root: fixture.root, rowKeyFn: rowKey });
    assert.equal(rowCap.capExceeded, true);
    assert.match(rowCap.capReason, /6.*5/);
    const volumeCap = buildSelectiveAdsPlan({ ...fixture, indices: [0, 1, 2, 3], root: fixture.root, rowKeyFn: rowKey });
    assert.equal(volumeCap.capExceeded, true);
    assert.match(volumeCap.capReason, /4.*3/);
    let calls = 0;
    await assert.rejects(executeSelectiveAdsDemand(fixture, {
      indices: [0, 1, 2, 3], expectedPlanToken: volumeCap.planToken, root: fixture.root, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
      dependencies: { fetchRelatedKeywordsFn: async () => { calls += 1; } },
    }), (error) => error.code === 'ads_demand_cap_exceeded');
    assert.equal(calls, 0);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('provider-required execution checks credentials before loader, calls, or persistence', async () => {
  const fixture = await tempBatch([row()]);
  try {
    const preview = previewSelectiveAdsDemand(fixture, { indices: [0], root: fixture.root, rowKeyFn: rowKey });
    const before = await fs.readFile(path.join(fixture.dir, 'candidates.csv'), 'utf8');
    let credentialChecks = 0;
    await assert.rejects(executeSelectiveAdsDemand(fixture, {
      indices: [0], expectedPlanToken: preview.planToken, root: fixture.root, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
      dependencies: { requireCredentialsFn: () => { credentialChecks += 1; throw new Error('fixture credentials missing'); } },
    }), /fixture credentials missing/);
    assert.equal(credentialChecks, 1);
    assert.equal(await fs.readFile(path.join(fixture.dir, 'candidates.csv'), 'utf8'), before);

    let partiallyInjectedCalls = 0;
    await assert.rejects(executeSelectiveAdsDemand(fixture, {
      indices: [0], expectedPlanToken: preview.planToken, root: fixture.root, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
      dependencies: {
        fetchRelatedKeywordsFn: async () => { partiallyInjectedCalls += 1; },
        requireCredentialsFn: () => { credentialChecks += 1; throw new Error('partial injection still needs credentials'); },
      },
    }), /partial injection still needs credentials/);
    assert.equal(credentialChecks, 2);
    assert.equal(partiallyInjectedCalls, 0);
    assert.equal(await fs.readFile(path.join(fixture.dir, 'candidates.csv'), 'utf8'), before);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('cache-miss preview is read-only and conservatively reports loader fallback upper bound', async () => {
  const fixture = await tempBatch([row()], {}, { withLocationCache: false });
  try {
    const before = await fs.readdir(fixture.dir);
    const preview = previewSelectiveAdsDemand(fixture, { indices: [0], root: fixture.root, rowKeyFn: rowKey });
    assert.equal(preview.adsLocationCacheAvailable, false);
    assert.equal(preview.adsLocationLoaderRequired, true);
    assert.equal(preview.adsLocationLoaderInvocationsMax, 1);
    assert.equal(preview.adsLocationProviderRequestsMax, 2);
    assert.equal(preview.searchVolumeCallsMax, 3);
    assert.deepEqual(await fs.readdir(fixture.dir), before);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('plan token is stable and stale token rejects before provider or persistence', async () => {
  const fixture = await tempBatch([row()]);
  try {
    const a = buildSelectiveAdsPlan({ ...fixture, indices: [0], root: fixture.root, rowKeyFn: rowKey });
    const b = buildSelectiveAdsPlan({ ...fixture, indices: [0], root: fixture.root, rowKeyFn: rowKey });
    assert.equal(a.planToken, b.planToken);
    const csvBefore = await fs.readFile(path.join(fixture.dir, 'candidates.csv'), 'utf8');
    const filesBefore = await fs.readdir(fixture.dir);
    let calls = 0;
    await assert.rejects(executeSelectiveAdsDemand(fixture, {
      indices: [0], expectedPlanToken: `${a.planToken}x`, root: fixture.root, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
      dependencies: { fetchRelatedKeywordsFn: async () => { calls += 1; } },
    }), (error) => error.status === 409 && error.code === 'ads_demand_plan_changed');
    assert.equal(calls, 0);
    assert.equal(await fs.readFile(path.join(fixture.dir, 'candidates.csv'), 'utf8'), csvBefore);
    assert.deepEqual(await fs.readdir(fixture.dir), filesBefore);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('execution writes compact runtime evidence, safe full sidecar, one artifact, and preserves upstream fields', async () => {
  const original = row();
  const fixture = await tempBatch([original], {}, { withLocationCache: false });
  try {
    const preview = previewSelectiveAdsDemand(fixture, { indices: [0], root: fixture.root, rowKeyFn: rowKey });
    const fake = fakeDependencies();
    const result = await executeSelectiveAdsDemand(fixture, {
      indices: [0], expectedPlanToken: preview.planToken, root: fixture.root, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv, dependencies: fake.deps, concurrency: 99,
    });
    assert.equal(result.rows[0].adsDemandStatus, 'complete');
    const compact = JSON.parse(result.rows[0].adsDemandEvidence);
    assert.equal(compact.targetVolume < compact.clusterVolume, true);
    assert.equal('geoStates' in compact, false);
    assert.ok(safePreHumanAdsPath(result.rows[0].adsResearchRef, fixture.root));
    const sidecar = JSON.parse(await fs.readFile(safePreHumanAdsPath(result.rows[0].adsResearchRef, fixture.root), 'utf8'));
    assert.equal(sidecar.relatedKeywords.status, 'complete');
    assert.equal(sidecar.geoStates['alpine|UT'].status, 'complete');
    for (const field of ['screenDecision', 'screenRule', 'screenReason', 'recommended_decision', 'recommended_reason', 'human_decision', 'decision_notes', 'candidateId', 'process_status', 'populationContext', 'seoClusterCities', 'seoClusterEvidence', 'Niche', 'City', 'State']) {
      assert.equal(result.rows[0][field], original[field], field);
    }
    assert.equal(result.batch.stage, 'discovery_serp_probed');
    assert.equal((await fs.readdir(fixture.dir)).filter((name) => name.startsWith('discovery-ads-demand-')).length, 1);
    assert.equal(fake.calls.loader, 1);
    assert.equal(result.artifact.summary.adsLocationLoaderInvocations, 1);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('Package-4 rerun reuses complete sidecar with zero provider work and no credentials', async () => {
  const fixture = await tempBatch([row()], {}, { withLocationCache: false });
  try {
    const firstPreview = previewSelectiveAdsDemand(fixture, { indices: [0], root: fixture.root, rowKeyFn: rowKey });
    const first = await executeSelectiveAdsDemand(fixture, {
      indices: [0], expectedPlanToken: firstPreview.planToken, root: fixture.root, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv, dependencies: fakeDependencies().deps,
    });
    const next = { root: fixture.root, dir: fixture.dir, batch: first.batch, rows: first.rows };
    const preview = previewSelectiveAdsDemand(next, { indices: [0], root: fixture.root, rowKeyFn: rowKey });
    assert.equal(preview.reusableRows, 1);
    assert.equal(preview.remoteOperationsMax, 0);
    const reused = await executeSelectiveAdsDemand(next, {
      indices: [0], expectedPlanToken: preview.planToken, root: fixture.root, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
      dependencies: { requireCredentialsFn: () => { throw new Error('no credentials expected'); } },
    });
    assert.equal(reused.artifact.summary.relatedKeywordCalls, 0);
    assert.equal(reused.artifact.summary.searchVolumeCalls, 0);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('async jobs cap row concurrency at two and retain another row when one is partial', async () => {
  const fixture = await tempBatch([row(), row({ City: 'Draper', seoClusterCities: '[]' })], {}, { withLocationCache: false });
  try {
    const preview = previewSelectiveAdsDemand(fixture, { indices: [0, 1], root: fixture.root, rowKeyFn: rowKey });
    const fake = fakeDependencies({ failCodes: new Set([3]) });
    const job = startSelectiveAdsDemand(fixture, {
      indices: [0, 1], expectedPlanToken: preview.planToken, root: fixture.root, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv, dependencies: fake.deps, concurrency: 99,
    });
    while (job.status === 'running') await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(job.status, 'partial');
    assert.equal(job.result.rows.some((item) => item.adsDemandStatus === 'complete'), true);
    assert.equal(job.result.rows.some((item) => item.adsDemandStatus === 'partial'), true);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('row concurrency never exceeds two even when a larger value is requested', async () => {
  const fixture = await tempBatch([
    row({ Niche: 'Niche A', seoClusterCities: '[]' }),
    row({ Niche: 'Niche B', seoClusterCities: '[]' }),
    row({ Niche: 'Niche C', seoClusterCities: '[]' }),
  ], {}, { withLocationCache: false });
  try {
    const preview = previewSelectiveAdsDemand(fixture, { indices: [0, 1, 2], root: fixture.root, rowKeyFn: rowKey });
    let active = 0;
    let maxActive = 0;
    const fake = fakeDependencies();
    fake.deps.fetchRelatedKeywordsFn = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      fake.calls.related += 1;
      return { cost: 0, ideas: [] };
    };
    await executeSelectiveAdsDemand(fixture, {
      indices: [0, 1, 2], expectedPlanToken: preview.planToken, root: fixture.root, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv, dependencies: fake.deps, concurrency: 99,
    });
    assert.equal(maxActive, 2);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('unsupported primary does not crash the batch and another selected row completes', async () => {
  const fixture = await tempBatch([
    row({ City: 'Nowhere', seoClusterCities: '[]' }),
    row({ Niche: 'Second Niche', seoClusterCities: '[]' }),
  ]);
  try {
    const preview = previewSelectiveAdsDemand(fixture, { indices: [0, 1], root: fixture.root, rowKeyFn: rowKey });
    const result = await executeSelectiveAdsDemand(fixture, {
      indices: [0, 1], expectedPlanToken: preview.planToken, root: fixture.root, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv, dependencies: fakeDependencies().deps,
    });
    assert.deepEqual(result.rows.map((item) => item.adsDemandStatus), ['unsupported_primary_ads_geo', 'complete']);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('unsafe, missing, malformed, stale, and changed-signature sidecars cannot authorize reuse', async () => {
  assert.equal(safePreHumanAdsPath('../secret.json', process.cwd()), null);
  assert.equal(safePreHumanAdsPath('C:\\secret.json', process.cwd()), null);
  const base = row();
  assert.equal(currentAdsDemandHandoff({ ...base, adsResearchRef: '../bad', adsDemandEvidence: '{}' }), null);
  assert.equal(currentAdsDemandDisplay({ ...base, adsDemandEvidence: JSON.stringify({ signature: 'old', target: { city: 'Alpine', state: 'UT' } }) }).status, 'stale');
  assert.equal(currentAdsDemandDisplay({ ...base, seoClusterEvidence: p3Evidence('stale_serp_changed'), adsDemandEvidence: '{}' }).status, 'stale');
});

test('Package-4 fields are runtime-only, round-trip, and never leak to Pack', () => {
  assert.deepEqual(DISCOVERY_ADS_DEMAND_COLUMNS, ['adsDemandStatus', 'adsDemandEvidence', 'adsResearchRef']);
  for (const field of DISCOVERY_ADS_DEMAND_COLUMNS) {
    assert.equal(DISCOVERY_RUNTIME_COLUMNS.includes(field), true);
    assert.equal(DISCOVERY_COLUMNS.includes(field), false);
  }
  const original = row({
    adsDemandStatus: 'P4_STATUS_SENTINEL',
    adsDemandEvidence: 'P4_EVIDENCE_SENTINEL',
    adsResearchRef: 'P4_REF_SENTINEL',
  });
  const pack = rowsToDiscoveryPackCsv([original]);
  for (const sentinel of [...DISCOVERY_ADS_DEMAND_COLUMNS, 'P4_STATUS_SENTINEL', 'P4_EVIDENCE_SENTINEL', 'P4_REF_SENTINEL']) assert.equal(pack.includes(sentinel), false);
  const runtime = rowsToDiscoveryRuntimeCsv([original]);
  for (const sentinel of ['P4_STATUS_SENTINEL', 'P4_EVIDENCE_SENTINEL', 'P4_REF_SENTINEL']) assert.equal(runtime.includes(sentinel), true);
});

test('real Package-4 -> Process -> Stage 1 queues normally and reuses Ads with zero repurchase', async () => {
  const uniqueNiche = `Package 4 E2E ${Date.now()}`;
  const pack = createDiscoveryPack({ state: 'UT', cities: ['Alpine'], requiredNiches: [uniqueNiche], maxRows: 1 });
  let candidateId = null;
  try {
    const imported = importDiscoveryCsv(pack.batch.id, rowsToDiscoveryPackCsv([{
      Niche: uniqueNiche, City: 'Alpine', State: 'UT', Population: '12000', suggested_suburbs: 'Draper',
    }]), { createIfMissing: false });
    Object.assign(imported.rows[0], {
      screenDecision: 'SURVIVE', seoClusterCities: '["Lehi,UT"]', seoClusterEvidence: p3Evidence(),
      populationContext: JSON.stringify({ eligible: true }),
    });
    await fs.writeFile(path.join(pack.batchDir, 'candidates.csv'), rowsToDiscoveryRuntimeCsv(imported.rows));
    const batchData = getBatch(pack.batch.id);
    const preview = previewSelectiveAdsDemand(batchData, { indices: [0], rowKeyFn: rowKey });
    const researched = await executeSelectiveAdsDemand(batchData, {
      indices: [0], expectedPlanToken: preview.planToken, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv, dependencies: fakeDependencies().deps,
    });
    updateBatchDecisions(pack.batch.id, [{ index: 0, human_decision: 'pursue' }]);
    let queued = null;
    const processed = processDiscoveryBatch(pack.batch.id, {
      runStage1ForPursue: true,
      startBatchJobsFn: (request) => { queued = request; return { id: 'fixture-job' }; },
    });
    candidateId = processed.promoted[0].candidateId;
    assert.deepEqual(queued.candidateIds, [candidateId]);
    const candidatePaths = pathsFor(candidateId);
    assert.equal(await fs.stat(candidatePaths.research).then(() => true, () => false), false);
    const config = JSON.parse(await fs.readFile(candidatePaths.config, 'utf8'));
    assert.deepEqual(config.cluster, ['Draper,UT']);
    assert.deepEqual(config.adsCluster, ['Lehi,UT']);
    assert.ok(config.preHumanAdsRef);
    assert.ok(config.adsDemandSignature);
    let relatedCalls = 0;
    let volumeCalls = 0;
    const report = await researchCandidate({
      ...config,
      out: candidatePaths.research,
      skipVolumes: false,
      enrich: false,
      adsMode: 'live',
      serpCache: '',
      forceSerp: false,
      volumesOnly: false,
    }, {
      fetchOrganicSerpFn: async () => ({ cost: 0, checkUrl: null, itemTypes: ['organic'], items: [
        { type: 'organic', title: uniqueNiche, url: 'https://fixture-local.test', domain: 'fixture-local.test' },
      ] }),
      adsDependencies: {
        loadAdsLocationsFn: async () => { throw new Error('no loader expected'); },
        fetchRelatedKeywordsFn: async () => { relatedCalls += 1; throw new Error('no related expected'); },
        fetchSearchVolumesFn: async () => { volumeCalls += 1; throw new Error('no volume expected'); },
      },
    });
    assert.equal(relatedCalls, 0);
    assert.equal(volumeCalls, 0);
    assert.equal(report.adsDemandMeta.source, 'pre_human_ads');
    assert.equal(report.adsDemandMeta.newProviderCostUsd, 0);
    assert.ok(report.adsDemandMeta.historicalEvidenceCostUsd > 0);
    assert.equal(report.estimatedApiCostUsd, 0);
    assert.ok(report.scoring);
    assert.equal(await fs.stat(candidatePaths.research).then(() => true, () => false), true);
    assert.deepEqual(report.volumes, researched.artifact.rows.length ? JSON.parse(await fs.readFile(safePreHumanAdsPath(config.preHumanAdsRef), 'utf8')).volumes : null);
  } finally {
    await removeCandidateArtifacts(candidateId);
    await fs.rm(pack.batchDir, { recursive: true, force: true });
  }
});

test('Stage-1 continuation from partial sidecar retries only missing City B', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rover-v15-stage1-p4-'));
  try {
    const firstFake = fakeDependencies({ failCodes: new Set([3]) });
    const partial = stampSidecar(await collectAdsDemand({
      niche: 'x', primary: 'Alpine,UT', adsCluster: ['Lehi,UT', 'Orem,UT'], locations, dependencies: firstFake.deps,
    }), { signature: 'fixture-signature' });
    const ref = 'research/batches/b/pre-human-ads/partial.json';
    const sidecarPath = path.join(root, ref);
    await fs.mkdir(path.dirname(sidecarPath), { recursive: true });
    await fs.writeFile(sidecarPath, JSON.stringify(partial));
    const resumedFake = fakeDependencies();
    const out = path.join(root, 'research', 'candidate.json');
    const report = await researchCandidate({
      niche: 'x', primary: 'Alpine,UT', cluster: ['Draper,UT'], adsCluster: ['Lehi,UT', 'Orem,UT'],
      seeds: [], related: 10, out, skipVolumes: false, enrich: false, adsMode: 'live', serpCache: '',
      forceSerp: false, volumesOnly: false, preHumanAdsRef: ref, adsDemandSignature: 'fixture-signature',
    }, {
      root,
      fetchOrganicSerpFn: async () => ({ cost: 0, checkUrl: null, itemTypes: [], items: [] }),
      adsDependencies: resumedFake.deps,
    });
    assert.equal(resumedFake.calls.related, 0);
    assert.deepEqual(resumedFake.calls.volume, [3]);
    assert.equal(report.adsDemandMeta.source, 'stage1_resume');
    assert.equal(report.adsDemandMeta.status, 'complete');
    assert.equal(JSON.parse(await fs.readFile(sidecarPath, 'utf8')).status, 'complete');
    assert.equal(await fs.stat(out).then(() => true, () => false), true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Stage 1 rejects a signature-bearing sidecar whose Ads config no longer matches', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rover-v15-stage1-stale-p4-'));
  try {
    const oldFake = fakeDependencies();
    const oldState = await collectAdsDemand({
      niche: 'x', primary: 'Alpine,UT', adsCluster: ['Lehi,UT'], locations, dependencies: oldFake.deps,
    });
    oldState.signature = 'stored-signature';
    const ref = 'research/batches/b/pre-human-ads/stale.json';
    const sidecarPath = path.join(root, ref);
    await fs.mkdir(path.dirname(sidecarPath), { recursive: true });
    await fs.writeFile(sidecarPath, JSON.stringify(oldState));
    const freshFake = fakeDependencies();
    const report = await researchCandidate({
      niche: 'x', primary: 'Alpine,UT', cluster: [], adsCluster: ['Orem,UT'],
      seeds: [], related: 10, out: path.join(root, 'research', 'candidate.json'), skipVolumes: false,
      enrich: false, adsMode: 'live', serpCache: '', forceSerp: false, volumesOnly: false,
      preHumanAdsRef: ref, adsDemandSignature: 'stored-signature',
    }, {
      root,
      fetchOrganicSerpFn: async () => ({ cost: 0, checkUrl: null, itemTypes: [], items: [] }),
      adsDependencies: freshFake.deps,
    });
    assert.equal(freshFake.calls.related, 1);
    assert.deepEqual(freshFake.calls.volume, [1, 3]);
    assert.equal(report.adsDemandMeta.source, 'stage1_live');
    assert.deepEqual(report.adsDemandMeta.adsCluster, ['Orem,UT']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Package-4-managed Stage 1 never turns unsupported primary Ads authority into zero demand', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rover-v15-stage1-unsupported-'));
  try {
    const signature = 'unsupported-signature';
    const state = stampSidecar(await collectAdsDemand({
      niche: 'x', primary: 'Nowhere,UT', adsCluster: ['Lehi,UT'], locations, dependencies: fakeDependencies().deps,
    }), { signature, primary: 'Nowhere,UT' });
    const ref = 'research/batches/b/pre-human-ads/unsupported.json';
    const sidecarPath = path.join(root, ref);
    await fs.mkdir(path.dirname(sidecarPath), { recursive: true });
    await fs.writeFile(sidecarPath, JSON.stringify(state));
    const fake = fakeDependencies();
    const out = path.join(root, 'research', 'unsupported-candidate.json');
    await assert.rejects(researchCandidate(stage1Args(root, {
      primary: 'Nowhere,UT', adsCluster: ['Lehi,UT'], ref, signature, out,
    }), { root, fetchOrganicSerpFn: fakeSerp, adsDependencies: fake.deps }), (error) => (
      error.code === 'ads_demand_incomplete' && error.adsDemandStatus === 'unsupported_primary_ads_geo'
    ));
    assert.equal(fake.calls.related, 0);
    assert.deepEqual(fake.calls.volume, []);
    assert.equal(await fs.stat(out).then(() => true, () => false), false);
    assert.equal(JSON.parse(await fs.readFile(sidecarPath, 'utf8')).status, 'unsupported_primary_ads_geo');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('partial unsupported or malformed-complete priorResearch volumes cannot enter complete prior reuse', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rover-v15-prior-authority-'));
  try {
    const signature = 'prior-signature';
    const out = path.join(root, 'research', 'candidate.json');
    const initial = await researchCandidate({
      ...stage1Args(root, { signature: '', out }), adsCluster: null, skipVolumes: true,
    }, { root, fetchOrganicSerpFn: fakeSerp });
    const validVolumes = (await collectAdsDemand({
      niche: 'x', primary: 'Alpine,UT', adsCluster: ['Lehi,UT'], locations, dependencies: fakeDependencies().deps,
    })).volumes;
    const authority = {
      schemaVersion: ADS_DEMAND_ENGINE_VERSION,
      keywordContractVersion: ADS_KEYWORD_CONTRACT_VERSION,
      intentClassifierVersion: ADS_INTENT_CLASSIFIER_VERSION,
      signature,
      niche: 'x',
      rowKey: adsDemandRowKey({ niche: 'x', primary: 'Alpine,UT' }),
      target: { city: 'Alpine', state: 'UT' },
      adsCluster: ['Lehi,UT'],
      keywordConfiguration: { seeds: ['x', 'x alpine'], relatedLimit: 10 },
    };
    for (const [status, volumes] of [
      ['partial', validVolumes],
      ['unsupported_primary_ads_geo', { ...validVolumes, primaryVolumeSum: 0, clusterVolumeSum: 0 }],
      ['complete', {}],
    ]) {
      await fs.writeFile(out, JSON.stringify({ ...initial, volumes, adsDemandMeta: { ...authority, status } }));
      const fake = fakeDependencies();
      const report = await researchCandidate(stage1Args(root, { signature, out }), {
        root, fetchOrganicSerpFn: fakeSerp, adsDependencies: fake.deps,
      });
      assert.equal(fake.calls.related, 1, status);
      assert.equal(report.adsDemandMeta.source, 'stage1_live', status);
      assert.equal(report.adsDemandMeta.status, 'complete', status);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('still-partial Stage 1 writes successful retries before stopping and next retry buys only the remaining geo', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rover-v15-partial-writeback-'));
  try {
    const signature = 'partial-writeback-signature';
    const firstFake = fakeDependencies({ failCodes: new Set([3, 4]) });
    const partial = stampSidecar(await collectAdsDemand({
      niche: 'x', primary: 'Alpine,UT', adsCluster: ['Lehi,UT', 'Orem,UT', 'Draper,UT'],
      locations, dependencies: firstFake.deps,
    }), { signature });
    const ref = 'research/batches/b/pre-human-ads/partial-writeback.json';
    const sidecarPath = path.join(root, ref);
    await fs.mkdir(path.dirname(sidecarPath), { recursive: true });
    await fs.writeFile(sidecarPath, JSON.stringify(partial));
    const out = path.join(root, 'research', 'candidate.json');
    const retry = fakeDependencies({ failCodes: new Set([4]) });
    await assert.rejects(researchCandidate(stage1Args(root, {
      adsCluster: ['Lehi,UT', 'Orem,UT', 'Draper,UT'], ref, signature, out,
    }), { root, fetchOrganicSerpFn: fakeSerp, adsDependencies: retry.deps }), (error) => error.code === 'ads_demand_incomplete');
    assert.equal(retry.calls.related, 0);
    assert.deepEqual(retry.calls.volume, [4, 3]);
    const afterRetry = JSON.parse(await fs.readFile(sidecarPath, 'utf8'));
    assert.equal(afterRetry.status, 'partial');
    assert.equal(afterRetry.geoStates['orem|UT'].status, 'complete');
    assert.equal(afterRetry.geoStates['draper|UT'].status, 'failed');
    assert.equal(await fs.stat(out).then(() => true, () => false), false);
    const finalFake = fakeDependencies();
    const report = await researchCandidate(stage1Args(root, {
      adsCluster: ['Lehi,UT', 'Orem,UT', 'Draper,UT'], ref, signature, out,
    }), { root, fetchOrganicSerpFn: fakeSerp, adsDependencies: finalFake.deps });
    assert.equal(finalFake.calls.related, 0);
    assert.deepEqual(finalFake.calls.volume, [4]);
    assert.equal(report.adsDemandMeta.status, 'complete');
    assert.equal(JSON.parse(await fs.readFile(sidecarPath, 'utf8')).status, 'complete');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('selected skipped rows retain prior Package-4 evidence byte-identically', async () => {
  const sentinels = {
    adsDemandStatus: 'complete',
    adsDemandEvidence: '{"paid":"sentinel"}',
    adsResearchRef: 'research/batches/old/pre-human-ads/sentinel.json',
  };
  const rows = [
    row({ ...sentinels, process_status: 'promoted', candidateId: 'existing-id' }),
    row({ ...sentinels, Niche: 'Stale row', seoClusterEvidence: p3Evidence('stale_serp_changed') }),
    row({ Niche: 'Valid row' }),
  ];
  const fixture = await tempBatch(rows);
  try {
    const preview = previewSelectiveAdsDemand(fixture, { indices: [0, 1, 2], root: fixture.root, rowKeyFn: rowKey });
    const fake = fakeDependencies();
    const result = await executeSelectiveAdsDemand(fixture, {
      indices: [0, 1, 2], expectedPlanToken: preview.planToken, root: fixture.root, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv, dependencies: fake.deps,
    });
    for (const index of [0, 1]) {
      for (const [field, value] of Object.entries(sentinels)) assert.equal(result.rows[index][field], value, `${index}:${field}`);
    }
    assert.deepEqual(result.artifact.rows.slice(0, 2).map((item) => item.status), ['skipped_processed', 'skipped_no_current_seo_cluster']);
    assert.equal(fake.calls.related, 1);
    assert.deepEqual(fake.calls.volume, [1, 2, 3]);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('planner display handoff and browser authority agree on material P3 transitions', async () => {
  const original = row({ seoClusterEvidence: p3Evidence('partial'), seoClusterCities: '["Lehi,UT"]' });
  const fixture = await tempBatch([original]);
  try {
    const firstPreview = previewSelectiveAdsDemand(fixture, { indices: [0], root: fixture.root, rowKeyFn: rowKey });
    const first = await executeSelectiveAdsDemand(fixture, {
      indices: [0], expectedPlanToken: firstPreview.planToken, root: fixture.root, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv, dependencies: fakeDependencies().deps,
    });
    const acquired = first.rows[0];
    const originalSignature = JSON.parse(acquired.adsDemandEvidence).signature;
    assert.equal(currentAdsDemandDisplay(acquired).current, true);
    assert.equal(discoveryAdsEvidenceIsCurrent(
      acquired,
      JSON.parse(acquired.adsDemandEvidence),
      JSON.parse(acquired.seoClusterEvidence),
      JSON.parse(acquired.seoClusterCities),
    ), true);
    const sameMaterial = { ...acquired, seoClusterEvidence: p3Evidence('complete') };
    const sameData = { ...fixture, batch: first.batch, rows: [sameMaterial] };
    const samePreview = previewSelectiveAdsDemand(sameData, { indices: [0], root: fixture.root, rowKeyFn: rowKey });
    assert.equal(buildAdsDemandSignature({ row: sameMaterial, adsCluster: ['Lehi,UT'], relatedLimit: 10 }), originalSignature);
    assert.equal(samePreview.reusableRows, 1);
    assert.equal(samePreview.remoteOperationsMax, 0);
    assert.equal(currentAdsDemandDisplay(sameMaterial).current, true);
    assert.ok(currentAdsDemandHandoff(sameMaterial, fixture.root));
    assert.equal(discoveryAdsEvidenceIsCurrent(
      sameMaterial,
      JSON.parse(sameMaterial.adsDemandEvidence),
      JSON.parse(sameMaterial.seoClusterEvidence),
      JSON.parse(sameMaterial.seoClusterCities),
    ), true);

    const changedCluster = { ...sameMaterial, seoClusterCities: '["Lehi,UT","Orem,UT"]' };
    const changedSignature = buildAdsDemandSignature({ row: changedCluster, adsCluster: ['Lehi,UT', 'Orem,UT'], relatedLimit: 10 });
    assert.notEqual(changedSignature, originalSignature);
    const changedPlan = previewSelectiveAdsDemand(
      { ...fixture, batch: first.batch, rows: [changedCluster] },
      { indices: [0], root: fixture.root, rowKeyFn: rowKey },
    );
    assert.equal(changedPlan.reusableRows, 0);
    assert.equal(changedPlan.remoteOperationsMax > 0, true);
    assert.equal(currentAdsDemandDisplay(changedCluster).current, false);
    assert.equal(currentAdsDemandHandoff(changedCluster, fixture.root), null);
    assert.equal(discoveryAdsEvidenceIsCurrent(
      changedCluster,
      JSON.parse(changedCluster.adsDemandEvidence),
      JSON.parse(changedCluster.seoClusterEvidence),
      JSON.parse(changedCluster.seoClusterCities),
    ), false);
    const staleP3 = { ...sameMaterial, seoClusterEvidence: p3Evidence('stale_serp_changed') };
    const stalePlan = previewSelectiveAdsDemand(
      { ...fixture, batch: first.batch, rows: [staleP3] },
      { indices: [0], root: fixture.root, rowKeyFn: rowKey },
    );
    assert.equal(stalePlan.statusCounts.skipped_no_current_seo_cluster, 1);
    assert.equal(currentAdsDemandDisplay(staleP3).current, false);
    assert.equal(currentAdsDemandHandoff(staleP3, fixture.root), null);
    assert.equal(discoveryAdsEvidenceIsCurrent(
      staleP3, JSON.parse(staleP3.adsDemandEvidence), JSON.parse(staleP3.seoClusterEvidence), ['Lehi,UT'],
    ), false);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('target-only usable P3 status transitions preserve the paid signature and reuse', async () => {
  const original = row({ seoClusterEvidence: p3Evidence('nearby_unavailable'), seoClusterCities: '[]' });
  const fixture = await tempBatch([original]);
  try {
    const preview = previewSelectiveAdsDemand(fixture, { indices: [0], root: fixture.root, rowKeyFn: rowKey });
    const first = await executeSelectiveAdsDemand(fixture, {
      indices: [0], expectedPlanToken: preview.planToken, root: fixture.root, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv, dependencies: fakeDependencies().deps,
    });
    const transitioned = { ...first.rows[0], seoClusterEvidence: p3Evidence('no_nearby_candidates') };
    const next = { ...fixture, batch: first.batch, rows: [transitioned] };
    const reuse = previewSelectiveAdsDemand(next, { indices: [0], root: fixture.root, rowKeyFn: rowKey });
    assert.equal(reuse.reusableRows, 1);
    assert.equal(reuse.remoteOperationsMax, 0);
    assert.equal(currentAdsDemandDisplay(transitioned).current, true);
    assert.ok(currentAdsDemandHandoff(transitioned, fixture.root));
    assert.equal(discoveryAdsEvidenceIsCurrent(
      transitioned,
      JSON.parse(transitioned.adsDemandEvidence),
      JSON.parse(transitioned.seoClusterEvidence),
      [],
    ), true);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('Discovery narrative seed includes only current material Ads authority', async () => {
  const original = row({ seoClusterEvidence: p3Evidence('partial'), seoClusterCities: '["Lehi,UT"]' });
  const fixture = await tempBatch([original]);
  try {
    const preview = previewSelectiveAdsDemand(fixture, { indices: [0], root: fixture.root, rowKeyFn: rowKey });
    const first = await executeSelectiveAdsDemand(fixture, {
      indices: [0], expectedPlanToken: preview.planToken, root: fixture.root, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv, dependencies: fakeDependencies().deps,
    });
    const current = discoveryNarrativeSeedFromRow(first.rows[0]);
    assert.equal(current.adsDemandStatus, 'complete');
    assert.equal(typeof current.adsDemandEvidence.clusterVolume, 'number');
    const harmlessTransition = discoveryNarrativeSeedFromRow({ ...first.rows[0], seoClusterEvidence: p3Evidence('complete') });
    assert.equal(harmlessTransition.adsDemandStatus, 'complete');
    assert.ok(harmlessTransition.adsDemandEvidence);
    for (const staleRow of [
      { ...first.rows[0], seoClusterEvidence: p3Evidence('complete'), seoClusterCities: '["Lehi,UT","Orem,UT"]' },
      { ...first.rows[0], seoClusterEvidence: p3Evidence('stale_serp_changed') },
      { ...first.rows[0], adsDemandEvidence: '{bad' },
    ]) {
      const seed = discoveryNarrativeSeedFromRow(staleRow);
      assert.equal(seed.adsDemandEvidence, null);
      assert.equal(seed.adsDemandStatus, 'stale');
      assert.equal(JSON.stringify(seed).includes('clusterVolume'), false);
    }
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('shared full-authority validator rejects sidecar field mutations for handoff and Stage 1', async () => {
  const fixture = await tempBatch([row({ seoClusterCities: '["Lehi,UT"]' })]);
  try {
    const preview = previewSelectiveAdsDemand(fixture, { indices: [0], root: fixture.root, rowKeyFn: rowKey });
    const first = await executeSelectiveAdsDemand(fixture, {
      indices: [0], expectedPlanToken: preview.planToken, root: fixture.root, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv, dependencies: fakeDependencies().deps,
    });
    const currentRow = first.rows[0];
    const ref = currentRow.adsResearchRef;
    const sidecarPath = safePreHumanAdsPath(ref, fixture.root);
    const pristine = JSON.parse(await fs.readFile(sidecarPath, 'utf8'));
    const signature = pristine.signature;
    const mutations = {
      target: (value) => { value.target = { city: 'Orem', state: 'UT' }; },
      adsCluster: (value) => { value.adsCluster = ['Orem,UT']; },
      seeds: (value) => { value.keywordConfiguration.seeds = ['changed seed']; },
      relatedLimit: (value) => { value.keywordConfiguration.relatedLimit = 9; },
      niche: (value) => { value.niche = 'Changed niche'; },
      schema: (value) => { value.version = 999; },
      contract: (value) => { value.keywordContractVersion = 'wrong-contract'; },
      evidenceState: (value) => { delete value.geoStates; },
    };
    for (const [name, mutate] of Object.entries(mutations)) {
      const changed = structuredClone(pristine);
      mutate(changed);
      await fs.writeFile(sidecarPath, JSON.stringify(changed));
      assert.equal(adsDemandAuthorityMatches(changed, {
        signature, niche: currentRow.Niche, primary: 'Alpine,UT', adsCluster: ['Lehi,UT'], seeds: [], relatedLimit: 10,
        requireEvidenceState: true,
      }), false, name);
      assert.equal(currentAdsDemandHandoff(currentRow, fixture.root), null, name);
      const fake = fakeDependencies();
      const report = await researchCandidate(stage1Args(fixture.root, {
        niche: currentRow.Niche, adsCluster: ['Lehi,UT'], ref, signature,
        out: path.join(fixture.root, 'research', `mutation-${name}.json`),
      }), { root: fixture.root, fetchOrganicSerpFn: fakeSerp, adsDependencies: fake.deps });
      assert.equal(fake.calls.related, 1, name);
      assert.equal(report.adsDemandMeta.source, 'stage1_live', name);
    }
    await fs.writeFile(sidecarPath, '{bad');
    assert.equal(currentAdsDemandHandoff(currentRow, fixture.root), null);
    const malformedFake = fakeDependencies();
    const malformedReport = await researchCandidate(stage1Args(fixture.root, {
      niche: currentRow.Niche, adsCluster: ['Lehi,UT'], ref, signature,
      out: path.join(fixture.root, 'research', 'mutation-malformed.json'),
    }), { root: fixture.root, fetchOrganicSerpFn: fakeSerp, adsDependencies: malformedFake.deps });
    assert.equal(malformedFake.calls.related, 1);
    assert.equal(malformedReport.adsDemandMeta.source, 'stage1_live');
    await fs.writeFile(sidecarPath, JSON.stringify(pristine));
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('linked existing candidate receives the same stale narrative-seed protection', async () => {
  const uniqueNiche = `Package 4 Stale Seed ${Date.now()}`;
  const existing = createCandidate({ niche: uniqueNiche, primary: 'Alpine,UT', cluster: ['Draper,UT'] });
  const candidatePaths = pathsFor(existing.id);
  await fs.writeFile(candidatePaths.research, '{"existing":true}\n');
  const pack = createDiscoveryPack({ state: 'UT', cities: ['Alpine'], requiredNiches: [uniqueNiche], maxRows: 1 });
  try {
    const imported = importDiscoveryCsv(pack.batch.id, rowsToDiscoveryPackCsv([{
      Niche: uniqueNiche, City: 'Alpine', State: 'UT', suggested_suburbs: 'Draper',
    }]), { createIfMissing: false });
    Object.assign(imported.rows[0], {
      screenDecision: 'SURVIVE',
      populationContext: JSON.stringify({ eligible: true }),
      seoClusterCities: '["Lehi,UT"]',
      seoClusterEvidence: p3Evidence('stale_serp_changed'),
      adsDemandStatus: 'complete',
      adsDemandEvidence: JSON.stringify({ status: 'complete', clusterVolume: 999999, targetVolume: 888888 }),
      adsResearchRef: 'research/batches/old/pre-human-ads/old.json',
    });
    await fs.writeFile(path.join(pack.batchDir, 'candidates.csv'), rowsToDiscoveryRuntimeCsv(imported.rows));
    updateBatchDecisions(pack.batch.id, [{ index: 0, human_decision: 'pursue' }]);
    const processed = processDiscoveryBatch(pack.batch.id, { runStage1ForPursue: false });
    assert.equal(processed.promoted[0].linkedExisting, true);
    const seed = JSON.parse(await fs.readFile(candidatePaths.discoverySeed, 'utf8'));
    assert.equal(seed.adsDemandStatus, 'stale');
    assert.equal(seed.adsDemandEvidence, null);
    assert.equal(JSON.stringify(seed).includes('999999'), false);
  } finally {
    await fs.rm(pack.batchDir, { recursive: true, force: true });
    await removeCandidateArtifacts(existing.id);
  }
});

test('P4 partial through Process and Stage 1 write-back makes Reopen reuse-only with zero second purchase', async () => {
  const uniqueNiche = `Package 4 Lifecycle ${Date.now()}`;
  const pack = createDiscoveryPack({ state: 'UT', cities: ['Alpine'], requiredNiches: [uniqueNiche], maxRows: 1 });
  let candidateId = null;
  try {
    const imported = importDiscoveryCsv(pack.batch.id, rowsToDiscoveryPackCsv([{
      Niche: uniqueNiche, City: 'Alpine', State: 'UT', suggested_suburbs: 'Draper',
    }]), { createIfMissing: false });
    Object.assign(imported.rows[0], {
      screenDecision: 'SURVIVE', populationContext: JSON.stringify({ eligible: true }),
      seoClusterCities: '["Lehi,UT"]', seoClusterEvidence: p3Evidence('complete'),
    });
    await fs.writeFile(path.join(pack.batchDir, 'candidates.csv'), rowsToDiscoveryRuntimeCsv(imported.rows));
    const batchData = getBatch(pack.batch.id);
    const preview = previewSelectiveAdsDemand(batchData, { indices: [0], rowKeyFn: rowKey });
    const initialFake = fakeDependencies({ failCodes: new Set([2]) });
    const partial = await executeSelectiveAdsDemand(batchData, {
      indices: [0], expectedPlanToken: preview.planToken, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv, dependencies: initialFake.deps,
    });
    assert.equal(partial.rows[0].adsDemandStatus, 'partial');
    updateBatchDecisions(pack.batch.id, [{ index: 0, human_decision: 'pursue' }]);
    let queued = null;
    const processed = processDiscoveryBatch(pack.batch.id, {
      startBatchJobsFn: (request) => { queued = request; return { id: 'fixture-job' }; },
    });
    candidateId = processed.promoted[0].candidateId;
    assert.deepEqual(queued.candidateIds, [candidateId]);
    const candidatePaths = pathsFor(candidateId);
    const config = JSON.parse(await fs.readFile(candidatePaths.config, 'utf8'));
    const resumeFake = fakeDependencies();
    const report = await researchCandidate({
      ...config, out: candidatePaths.research, skipVolumes: false, enrich: false, adsMode: 'live',
      serpCache: '', forceSerp: false, volumesOnly: false,
    }, { fetchOrganicSerpFn: fakeSerp, adsDependencies: resumeFake.deps });
    assert.equal(resumeFake.calls.related, 0);
    assert.deepEqual(resumeFake.calls.volume, [2]);
    assert.equal(report.adsDemandMeta.status, 'complete');
    const sidecar = JSON.parse(await fs.readFile(safePreHumanAdsPath(config.preHumanAdsRef), 'utf8'));
    assert.equal(sidecar.status, 'complete');
    assert.equal(sidecar.geoStates['lehi|UT'].status, 'complete');
    const reopened = reopenDiscoveryRows(pack.batch.id, [0]);
    const reopenedData = { ...getBatch(pack.batch.id), rows: reopened.rows };
    const reusePreview = previewSelectiveAdsDemand(reopenedData, { indices: [0], rowKeyFn: rowKey });
    assert.equal(reusePreview.reusableRows, 1);
    assert.equal(reusePreview.relatedKeywordCallsMax, 0);
    assert.equal(reusePreview.searchVolumeCallsMax, 0);
    assert.equal(reusePreview.remoteOperationsMax, 0);
    const noCalls = { loader: 0, related: 0, volume: [] };
    const reused = await executeSelectiveAdsDemand(reopenedData, {
      indices: [0], expectedPlanToken: reusePreview.planToken, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv,
      dependencies: {
        requireCredentialsFn: () => { throw new Error('credentials must not be required'); },
        loadAdsLocationsFn: async () => { noCalls.loader += 1; throw new Error('no loader'); },
        fetchRelatedKeywordsFn: async () => { noCalls.related += 1; throw new Error('no related'); },
        fetchSearchVolumesFn: async () => { noCalls.volume.push('unexpected'); throw new Error('no volume'); },
      },
    });
    assert.deepEqual(noCalls, { loader: 0, related: 0, volume: [] });
    assert.equal(reused.artifact.summary.relatedKeywordCalls, 0);
    assert.equal(reused.artifact.summary.searchVolumeCalls, 0);
  } finally {
    await removeCandidateArtifacts(candidateId);
    await fs.rm(pack.batchDir, { recursive: true, force: true });
  }
});

test('existing linked candidate with research stays unqueued and preserves canonical files/config', async () => {
  const uniqueNiche = `Package 4 Linked ${Date.now()}`;
  const existing = createCandidate({ niche: uniqueNiche, primary: 'Alpine,UT', cluster: ['Draper,UT'] });
  const candidatePaths = pathsFor(existing.id);
  const originalResearch = '{"existing":true}\n';
  await fs.writeFile(candidatePaths.research, originalResearch);
  const pack = createDiscoveryPack({ state: 'UT', cities: ['Alpine'], requiredNiches: [uniqueNiche], maxRows: 1 });
  try {
    const imported = importDiscoveryCsv(pack.batch.id, rowsToDiscoveryPackCsv([{ Niche: uniqueNiche, City: 'Alpine', State: 'UT' }]), { createIfMissing: false });
    Object.assign(imported.rows[0], {
      screenDecision: 'SURVIVE', seoClusterCities: '["Lehi,UT"]', seoClusterEvidence: p3Evidence(),
      populationContext: JSON.stringify({ eligible: true }),
    });
    await fs.writeFile(path.join(pack.batchDir, 'candidates.csv'), rowsToDiscoveryRuntimeCsv(imported.rows));
    const batchData = getBatch(pack.batch.id);
    const preview = previewSelectiveAdsDemand(batchData, { indices: [0], rowKeyFn: rowKey });
    await executeSelectiveAdsDemand(batchData, {
      indices: [0], expectedPlanToken: preview.planToken, rowKeyFn: rowKey,
      rowsToDiscoveryRuntimeCsvFn: rowsToDiscoveryRuntimeCsv, dependencies: fakeDependencies().deps,
    });
    updateBatchDecisions(pack.batch.id, [{ index: 0, human_decision: 'pursue' }]);
    let batchStarts = 0;
    const processed = processDiscoveryBatch(pack.batch.id, {
      startBatchJobsFn: () => { batchStarts += 1; return { id: 'unexpected' }; },
    });
    assert.equal(processed.promoted[0].linkedExisting, true);
    assert.equal(batchStarts, 0);
    assert.equal(await fs.readFile(candidatePaths.research, 'utf8'), originalResearch);
    const config = JSON.parse(await fs.readFile(candidatePaths.config, 'utf8'));
    assert.deepEqual(config.cluster, ['Draper,UT']);
    assert.deepEqual(config.adsCluster, ['Lehi,UT']);
  } finally {
    await fs.rm(pack.batchDir, { recursive: true, force: true });
    await removeCandidateArtifacts(existing.id);
  }
});

test('real update Process reload and reopen preserve Package-4 runtime evidence', async () => {
  const uniqueNiche = `Package 4 Persistence ${Date.now()}`;
  const pack = createDiscoveryPack({
    state: 'UT', cities: ['Alpine'], requiredNiches: [uniqueNiche], maxRows: 1,
    maxPreHumanAdsRows: 4, maxPreHumanAdsVolumeCalls: 20,
  });
  try {
    assert.equal(pack.batch.filters.maxPreHumanAdsRows, 4);
    assert.equal(pack.batch.filters.maxPreHumanAdsVolumeCalls, 20);
    const imported = importDiscoveryCsv(pack.batch.id, rowsToDiscoveryPackCsv([{ Niche: uniqueNiche, City: 'Alpine', State: 'UT' }]), { createIfMissing: false });
    Object.assign(imported.rows[0], {
      adsDemandStatus: 'complete', adsDemandEvidence: '{"fixture":true}', adsResearchRef: 'research/batches/fixture/ref.json',
    });
    await fs.writeFile(path.join(pack.batchDir, 'candidates.csv'), rowsToDiscoveryRuntimeCsv(imported.rows));
    updateBatchDecisions(pack.batch.id, [{ index: 0, human_decision: 'deprioritize' }]);
    const processed = processDiscoveryBatch(pack.batch.id, { runStage1ForPursue: false });
    assert.equal(processed.rows[0].process_status, 'tracked');
    assert.equal(processed.rows[0].adsDemandEvidence, '{"fixture":true}');
    assert.equal(getBatch(pack.batch.id).rows[0].adsResearchRef, 'research/batches/fixture/ref.json');
    const reopened = reopenDiscoveryRows(pack.batch.id, [0]);
    assert.equal(reopened.rows[0].process_status, '');
    assert.equal(reopened.rows[0].adsDemandStatus, 'complete');
  } finally { await fs.rm(pack.batchDir, { recursive: true, force: true }); }
});

test('source wiring uses Discovery selected indices and excludes Package 5/6/V2/decision mutations', async () => {
  const [core, shared, discovery, stage1, app, html, server] = await Promise.all([
    fs.readFile(new URL('../ops/lib/discovery-ads-demand.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../scripts/lib/ads-demand-research.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../ops/lib/discovery.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../scripts/research-candidate.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../ops/public/app.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../ops/public/index.html', import.meta.url), 'utf8'),
    fs.readFile(new URL('../ops/server.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /const indices = \[\.\.\.state\.discoverySelected\]/);
  assert.match(app, /body: JSON\.stringify\(\{ indices/);
  assert.match(server, /ads-demand\/preview/);
  assert.match(server, /expectedPlanToken/);
  assert.match(html, /name="maxPreHumanAdsRows"/);
  assert.match(html, /name="maxPreHumanAdsVolumeCalls"/);
  assert.match(stage1, /collectAdsDemand/);
  assert.match(core, /collectAdsDemand/);
  assert.equal(core.includes('applyRecommendations'), false);
  assert.equal(core.includes('setDecision'), false);
  for (const forbidden of ['targetSuburbs', 'coverageAreas', 'Maps SERP', 'backlinks', 'Anthropic', 'OpenStreetMap', 'V2Score']) {
    assert.equal(`${core}\n${shared}`.includes(forbidden), false, forbidden);
  }
  assert.match(discovery, /adsCluster: adsHandoff/);
});
