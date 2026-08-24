import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildPopulationContext,
  buildPopulationContexts,
  evaluatePopulationContext,
  V15_POPULATION_CONTEXT_PARAMETERS,
} from '../ops/lib/population-context.mjs';
import {
  buildFilterBrief,
  createDiscoveryPack,
  DISCOVERY_COLUMNS,
  DISCOVERY_RUNTIME_COLUMNS,
  getBatch,
  importDiscoveryCsv,
  processDiscoveryBatch,
  reopenDiscoveryRows,
  rowsToDiscoveryPackCsv,
  rowsToDiscoveryRuntimeCsv,
  updateBatchDecisions,
} from '../ops/lib/discovery.mjs';
import {
  isPopulationEligibleForSerp,
} from '../ops/lib/discovery-serp-probe.mjs';
import { evaluatePrimarySerpScreen } from '../ops/lib/v15-primary-serp-screen.mjs';
import { runPackage1Replay } from '../scripts/v15-package1-replay.mjs';

const basePopulation = {
  city: 'Alpine',
  state: 'UT',
  selectedBandMin: 70000,
  selectedBandMax: 200000,
  nearbyCityRadiusMiles: 40,
  nearbyCityMinPopulation: 5000,
};

const nearby = (name, population, state = 'UT') => ({ name, state, population });

test('city proper inside the selected band qualifies by city', () => {
  const context = evaluatePopulationContext({ ...basePopulation, cityPopulation: 85000 });
  assert.equal(context.eligible, true);
  assert.equal(context.qualifiesBy, 'city');
});

test('city below minimum qualifies when nearby population reaches the minimum', () => {
  const context = evaluatePopulationContext({
    ...basePopulation,
    cityPopulation: 12000,
    nearbyPlaces: [nearby('Lehi', 65000)],
  });
  assert.equal(context.nearbyPopulation, 77000);
  assert.equal(context.eligible, true);
  assert.equal(context.qualifiesBy, 'nearby_population');
});

test('city below minimum stays outside preference when nearby total is also below minimum', () => {
  const context = evaluatePopulationContext({
    ...basePopulation,
    cityPopulation: 12000,
    nearbyPlaces: [nearby('Cedar Hills', 15000)],
  });
  assert.equal(context.nearbyPopulation, 27000);
  assert.equal(context.eligible, false);
  assert.equal(context.qualifiesBy, 'outside_preference');
});

test('city inside band remains qualified when nearby population exceeds maximum', () => {
  const context = evaluatePopulationContext({
    ...basePopulation,
    cityPopulation: 85000,
    nearbyPlaces: [nearby('Neighbor', 180000)],
  });
  assert.equal(context.nearbyPopulation, 265000);
  assert.equal(context.eligible, true);
  assert.equal(context.qualifiesBy, 'both');
});

test('city below minimum remains eligible when nearby population clears minimum and maximum', () => {
  const context = evaluatePopulationContext({
    ...basePopulation,
    cityPopulation: 12000,
    nearbyPlaces: [nearby('Neighbor', 220000)],
  });
  assert.equal(context.nearbyPopulation, 232000);
  assert.equal(context.eligible, true);
  assert.equal(context.qualifiesBy, 'nearby_population');
});

test('city proper above maximum remains outside preference unless explicitly selected', () => {
  const outside = evaluatePopulationContext({ ...basePopulation, cityPopulation: 250000 });
  const selected = evaluatePopulationContext({
    ...basePopulation,
    cityPopulation: 250000,
    explicitlySelected: true,
  });
  assert.equal(outside.eligible, false);
  assert.equal(outside.qualifiesBy, 'outside_preference');
  assert.equal(selected.eligible, true);
  assert.equal(selected.qualifiesBy, 'outside_preference');
  assert.equal(selected.explicitlySelected, true);
});

test('population-ineligible row is excluded from automatic SERP spend', () => {
  assert.equal(
    isPopulationEligibleForSerp({
      populationContext: JSON.stringify({
        eligible: false,
        qualifiesBy: 'outside_preference',
        explicitlySelected: false,
      }),
    }),
    false,
  );
});

test('population-qualified and explicitly retained rows remain SERP eligible', () => {
  assert.equal(
    isPopulationEligibleForSerp({
      populationContext: JSON.stringify({
        eligible: true,
        qualifiesBy: 'nearby_population',
        explicitlySelected: false,
      }),
    }),
    true,
  );

  assert.equal(
    isPopulationEligibleForSerp({
      populationContext: JSON.stringify({
        eligible: true,
        qualifiesBy: 'outside_preference',
        explicitlySelected: true,
      }),
    }),
    true,
  );
});

test('legacy rows without population context remain SERP eligible', () => {
  assert.equal(
    isPopulationEligibleForSerp({
      Niche: 'Legacy fixture',
      City: 'Legacy City',
      State: 'UT',
    }),
    true,
  );

  assert.equal(
    isPopulationEligibleForSerp({
      populationContext: '{malformed',
    }),
    true,
  );
});

test('target city and duplicate nearby places are counted only once', () => {
  const context = evaluatePopulationContext({
    ...basePopulation,
    cityPopulation: 12000,
    nearbyPlaces: [
      nearby('Alpine', 12000),
      nearby('Lehi', 65000),
      nearby('Lehi', 65000),
    ],
  });
  assert.equal(context.nearbyPopulation, 77000);
  assert.deepEqual(context.nearbyPlaces, [nearby('Lehi', 65000)]);
});

test('nearby-place minimum is configurable without code changes', () => {
  const lowMinimum = evaluatePopulationContext({
    ...basePopulation,
    cityPopulation: 55000,
    nearbyCityMinPopulation: 10000,
    nearbyPlaces: [nearby('Cedar Hills', 20000)],
  });
  const highMinimum = evaluatePopulationContext({
    ...basePopulation,
    cityPopulation: 55000,
    nearbyCityMinPopulation: 30000,
    nearbyPlaces: [nearby('Cedar Hills', 20000)],
  });
  assert.equal(lowMinimum.eligible, true);
  assert.equal(highMinimum.eligible, false);
});

test('nearby radius is configurable without code changes', () => {
  const dependencies = {
    lookupPopulationFn: () => 40000,
    placesIntersectingRadiusFn: (_city, _state, radiusMiles) => ({
      primary: { population: 40000 },
      places: radiusMiles >= 20 ? [nearby('Lehi', 40000)] : [],
    }),
  };
  const narrow = buildPopulationContext({ ...basePopulation, nearbyCityRadiusMiles: 10 }, dependencies);
  const wide = buildPopulationContext({ ...basePopulation, nearbyCityRadiusMiles: 25 }, dependencies);
  assert.equal(narrow.eligible, false);
  assert.equal(wide.eligible, true);
  assert.equal(wide.nearbyPopulation, 80000);
});

test('multiple named cities remain separate population-qualified targets', () => {
  const populations = {
    Alpine: 12000,
    'Cedar Hills': 10000,
    'American Fork': 40000,
    Lehi: 85000,
  };
  const candidates = Object.keys(populations).map((city) => ({ city, state: 'UT' }));
  const contexts = buildPopulationContexts(
    candidates,
    basePopulation,
    {
      lookupPopulationFn: (city) => populations[city],
      placesIntersectingRadiusFn: (city) => ({
        primary: { population: populations[city] },
        places: candidates.map(({ city: name }) => nearby(name, populations[name])),
      }),
    },
  );
  assert.deepEqual(contexts.map((context) => context.city), Object.keys(populations));
  assert.equal(contexts.length, 4);
  assert.equal(contexts.every((context) => context.eligible), true);
});

test('missing map data preserves city proper behavior and exposes setup status', () => {
  const error = Object.assign(new Error('missing'), { code: 'map_data_missing' });
  const context = buildPopulationContext(
    { ...basePopulation, cityPopulation: undefined },
    {
      lookupPopulationFn: () => 85000,
      placesIntersectingRadiusFn: () => { throw error; },
    },
  );
  assert.equal(context.cityPopulation, 85000);
  assert.equal(context.nearbyPopulation, null);
  assert.equal(context.nearbyStatus, 'unavailable');
  assert.equal(context.qualifiesBy, 'city');
  assert.match(context.setupMessage, /npm run build-research-map/);
});

test('Discovery schemas keep population context internal to runtime persistence', () => {
  assert.equal(DISCOVERY_COLUMNS.includes('populationContext'), false);
  assert.equal(DISCOVERY_RUNTIME_COLUMNS.includes('populationContext'), true);
});

test('Discovery and Claude copy describe approximate qualification without city deduplication', () => {
  const brief = buildFilterBrief({
    state: 'UT',
    minPopulation: 70000,
    maxPopulation: 200000,
    nearbyCityRadiusMiles: 25,
    nearbyCityMinPopulation: 10000,
  });
  assert.match(brief, /approximate local-market screening preference/i);
  assert.match(brief, /25 mile radius/i);
  assert.match(brief, /10,000\+ population/i);
  assert.match(brief, /do not merge or eliminate cities/i);
});

test('Rule C is context-only while its evidence remains visible', () => {
  const result = evaluatePrimarySerpScreen({
    classified: {
      uniqueOrganicDomains: Array.from({ length: 6 }, (_, index) => `domain-${index}.example`),
      paidAds: { count: 1 },
      features: { paid: true, localServicesAds: false },
    },
    rawItems: [],
  });
  assert.equal(result.screenDecision, 'SURVIVE');
  assert.equal(result.screenRule, 'NONE');
  assert.match(result.screenReason, /paid\/LSA pressure is context only/i);
});

test('Rule A still hard-stops a genuine wrong-intent majority', () => {
  const rawItems = Array.from({ length: 5 }, (_, index) => ({
    type: 'organic',
    title: index < 3 ? `Installer jobs and careers ${index}` : `Local installer ${index}`,
    url: `https://example-${index}.com`,
  }));
  const result = evaluatePrimarySerpScreen({
    classified: { uniqueOrganicDomains: ['one.example'] },
    rawItems,
  });
  assert.equal(result.screenDecision, 'SCREEN_OUT');
  assert.equal(result.screenRule, 'A');
});

test('Rule A does not hard-stop isolated commercial-page pattern matches', () => {
  const isolatedResults = [
    { title: 'Our installer careers', url: 'https://contractor.example/careers' },
    { title: 'Artificial turf products', url: 'https://supplier.example/products/turf' },
    { title: 'What is included in installation', url: 'https://installer.example/services' },
    { title: 'See our YouTube project gallery', url: 'https://installer.example/gallery' },
    { title: 'Supplier and professional installer', url: 'https://hybrid.example/install' },
  ];
  for (const isolated of isolatedResults) {
    const rawItems = [
      { type: 'organic', ...isolated },
      ...Array.from({ length: 4 }, (_, index) => ({
        type: 'organic',
        title: `Local commercial installer ${index}`,
        url: `https://local-${index}.example`,
      })),
    ];
    const result = evaluatePrimarySerpScreen({
      classified: { uniqueOrganicDomains: ['one.example'] },
      rawItems,
    });
    assert.equal(result.screenDecision, 'SURVIVE', isolated.title);
    assert.equal(result.screenRule, 'NONE', isolated.title);
  }
});

test('Package-1 tracked replay remains conservative and costs zero', async () => {
  const report = await runPackage1Replay();
  assert.equal(report.totalRows, 27);
  assert.equal(report.screenOutCount, 0);
  assert.equal(report.surviveCount, 27);
  assert.equal(report.providerCalls, 0);
  assert.equal(report.fixtureReusePercent, 100);
});

test('hunt settings and screen plus population context survive write reload decision Process state and reopen', async () => {
  const uniqueNiche = `Package 2 Persistence ${Date.now()}`;
  const pack = createDiscoveryPack({
    state: 'UT',
    cities: ['Alpine'],
    requiredNiches: [uniqueNiche],
    minPopulation: 70000,
    maxPopulation: 200000,
    nearbyCityRadiusMiles: 25,
    nearbyCityMinPopulation: 10000,
    maxRows: 1,
  });
  try {
    assert.equal(pack.batch.filters.nearbyCityRadiusMiles, 25);
    assert.equal(pack.batch.filters.nearbyCityMinPopulation, 10000);

    const csv = rowsToDiscoveryPackCsv([{
      Niche: uniqueNiche,
      City: 'Alpine',
      State: 'UT',
      Population: 'ESTIMATE 999999',
      source_mode: 'estimate',
    }]);
    const imported = importDiscoveryCsv(pack.batch.id, csv, { createIfMissing: false });
    const firstContext = JSON.parse(imported.rows[0].populationContext);
    assert.equal(firstContext.city, 'Alpine');
    assert.equal(imported.rows[0].Population, String(firstContext.cityPopulation));
    assert.notEqual(imported.rows[0].Population, '999999');
    assert.equal(firstContext.nearbyCityRadiusMiles, 25);
    assert.equal(firstContext.nearbyCityMinPopulation, 10000);

    imported.rows[0].screenDecision = 'SURVIVE';
    imported.rows[0].screenRule = 'NONE';
    imported.rows[0].screenReason = 'Package 2 persistence fixture';
    await fs.writeFile(
      path.join(pack.batchDir, 'candidates.csv'),
      rowsToDiscoveryRuntimeCsv(imported.rows),
      'utf8',
    );

    let reloaded = getBatch(pack.batch.id);
    assert.equal(reloaded.rows[0].screenDecision, 'SURVIVE');
    assert.deepEqual(JSON.parse(reloaded.rows[0].populationContext), firstContext);

    updateBatchDecisions(pack.batch.id, [
      { index: 0, human_decision: 'deprioritize' },
    ]);

    reloaded = getBatch(pack.batch.id);
    assert.equal(reloaded.rows[0].human_decision, 'deprioritize');
    assert.equal(
      reloaded.rows[0].screenReason,
      'Package 2 persistence fixture',
    );
    assert.deepEqual(
      JSON.parse(reloaded.rows[0].populationContext),
      firstContext,
    );

    const processed = processDiscoveryBatch(pack.batch.id, {
      runStage1ForPursue: false,
    });

    assert.equal(processed.rows[0].process_status, 'tracked');
    assert.equal(processed.rows[0].candidateId, '');
    assert.equal(processed.rows[0].screenDecision, 'SURVIVE');
    assert.equal(processed.rows[0].screenRule, 'NONE');
    assert.equal(
      processed.rows[0].screenReason,
      'Package 2 persistence fixture',
    );
    assert.deepEqual(
      JSON.parse(processed.rows[0].populationContext),
      firstContext,
    );

    const processedReload = getBatch(pack.batch.id);
    assert.equal(processedReload.rows[0].process_status, 'tracked');
    assert.equal(processedReload.rows[0].screenDecision, 'SURVIVE');
    assert.deepEqual(
      JSON.parse(processedReload.rows[0].populationContext),
      firstContext,
    );

    const reopened = reopenDiscoveryRows(pack.batch.id, [0]);

    assert.equal(reopened.rows[0].process_status, '');
    assert.equal(reopened.rows[0].candidateId, '');
    assert.equal(reopened.rows[0].human_decision, 'deprioritize');
    assert.equal(reopened.rows[0].screenDecision, 'SURVIVE');
    assert.equal(reopened.rows[0].screenRule, 'NONE');
    assert.equal(
      reopened.rows[0].screenReason,
      'Package 2 persistence fixture',
    );
    assert.deepEqual(
      JSON.parse(reopened.rows[0].populationContext),
      firstContext,
    );
  } finally {
    await fs.rm(pack.batchDir, { recursive: true, force: true });
  }
});

test('population qualification has no provider or network call path', async () => {
  const source = await fs.readFile(
    new URL('../ops/lib/population-context.mjs', import.meta.url),
    'utf8',
  );
  for (const forbidden of [
    'fetch(',
    'DataForSEO',
    'dataForSeoRequest',
    'Anthropic',
    'OpenStreetMap',
    'http://',
    'https://',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(V15_POPULATION_CONTEXT_PARAMETERS, {
    nearbyCityRadiusMiles: 40,
    nearbyCityMinPopulation: 5000,
  });
});
