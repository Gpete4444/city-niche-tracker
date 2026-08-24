import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  adsLocationName,
  isDirectoryDomain,
  requireCredentials,
} from '../../scripts/lib/dataforseo.mjs';
import {
  classifySerpItems,
  fetchOrganicSerp,
} from '../../scripts/lib/serp-classify.mjs';
import {
  isSerpCacheFresh,
  readSerpCache,
  serpCachePath,
  writeSerpCache,
} from '../../scripts/lib/serp-cache.mjs';
import { enrichClassifiedSerp } from '../../scripts/lib/serp-signals.mjs';

export const V15_SEO_CLUSTER_PARAMETERS = Object.freeze({
  maxNearbySerps: 5,
  seoClusterMinJaccard: 0.30,
  seoClusterMinSharedDomains: 2,
  mixedMinJaccard: 0.15,
  mixedMinSharedDomains: 1,
  mixedMinSharedTop5Domains: 1,
});

export const NEARBY_SERP_ESTIMATE_USD = 0.002;

const evidenceVersion = 1;
const nearbyJobs = new Map();

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerInRange(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

function numberInRange(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

export function normalizeSeoClusterParameters(filters = {}) {
  return {
    nearbyCityRadiusMiles: numberInRange(filters.nearbyCityRadiusMiles, 1, 120, 40),
    nearbyCityMinPopulation: Math.max(0, finiteNumber(filters.nearbyCityMinPopulation) ?? 5000),
    maxNearbySerps: integerInRange(
      filters.maxNearbySerps,
      0,
      5,
      V15_SEO_CLUSTER_PARAMETERS.maxNearbySerps,
    ),
    seoClusterMinJaccard: numberInRange(
      filters.seoClusterMinJaccard,
      0,
      1,
      V15_SEO_CLUSTER_PARAMETERS.seoClusterMinJaccard,
    ),
    seoClusterMinSharedDomains: integerInRange(
      filters.seoClusterMinSharedDomains,
      1,
      10,
      V15_SEO_CLUSTER_PARAMETERS.seoClusterMinSharedDomains,
    ),
    mixedMinJaccard: V15_SEO_CLUSTER_PARAMETERS.mixedMinJaccard,
    mixedMinSharedDomains: V15_SEO_CLUSTER_PARAMETERS.mixedMinSharedDomains,
    mixedMinSharedTop5Domains: V15_SEO_CLUSTER_PARAMETERS.mixedMinSharedTop5Domains,
  };
}

export function normalizeComparisonDomain(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    const hostname = raw.includes('://')
      ? new URL(raw).hostname
      : new URL(`https://${raw}`).hostname;
    return hostname.replace(/^www\./, '').replace(/\.$/, '').trim();
  } catch {
    return raw.split('/')[0].replace(/^www\./, '').replace(/\.$/, '').trim();
  }
}

export function normalizedOrganicDomains(classified = {}) {
  return [...new Set(
    (Array.isArray(classified?.uniqueOrganicDomains)
      ? classified.uniqueOrganicDomains
      : [])
      .map(normalizeComparisonDomain)
      .filter((domain) => domain && !isDirectoryDomain(domain)),
  )].sort((left, right) => left.localeCompare(right));
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function domainHash(classified = {}) {
  return sha256(normalizedOrganicDomains(classified).join('\n'));
}

export function calculateJaccard(targetDomains = [], nearbyDomains = []) {
  const target = new Set(targetDomains.map(normalizeComparisonDomain).filter(Boolean));
  const nearby = new Set(nearbyDomains.map(normalizeComparisonDomain).filter(Boolean));
  const sharedDomains = [...target]
    .filter((domain) => nearby.has(domain))
    .sort((left, right) => left.localeCompare(right));
  const union = new Set([...target, ...nearby]);
  return {
    targetDomainCount: target.size,
    nearbyDomainCount: nearby.size,
    sharedDomainCount: sharedDomains.length,
    sharedDomains,
    jaccard: union.size === 0 ? 0 : sharedDomains.length / union.size,
  };
}

export function extractTop5OrganicDomains(cache = {}) {
  if (!Array.isArray(cache?.items)) {
    return { domains: [], available: false, diagnostic: 'raw_items_unavailable' };
  }
  const organic = cache.items.filter((item) => String(item?.type || '').toLowerCase() === 'organic');
  if (!organic.length) {
    return { domains: [], available: false, diagnostic: 'organic_rank_evidence_unavailable' };
  }
  const domains = [];
  let organicPosition = 0;
  for (const item of organic) {
    organicPosition += 1;
    const explicitRank = finiteNumber(item?.rank_group);
    const rank = explicitRank != null && explicitRank > 0 ? explicitRank : organicPosition;
    if (rank > 5) continue;
    const domain = normalizeComparisonDomain(item?.domain || item?.url);
    if (!domain || isDirectoryDomain(domain)) continue;
    domains.push(domain);
  }
  return {
    domains: [...new Set(domains)].sort((left, right) => left.localeCompare(right)),
    available: true,
    diagnostic: organic.some((item) => finiteNumber(item?.rank_group) != null)
      ? 'rank_group'
      : 'organic_item_order',
  };
}

export function classifySeoRelationship({
  sharedDomainCount,
  jaccard,
  sharedTop5DomainCount,
} = {}, parameters = V15_SEO_CLUSTER_PARAMETERS) {
  const config = normalizeSeoClusterParameters(parameters);
  const related =
    Number(sharedDomainCount) >= config.seoClusterMinSharedDomains
    && Number(jaccard) >= config.seoClusterMinJaccard;
  const mixed =
    (
      Number(sharedDomainCount) >= config.mixedMinSharedDomains
      && Number(jaccard) >= config.mixedMinJaccard
    )
    || Number(sharedTop5DomainCount) >= config.mixedMinSharedTop5Domains;
  if (related) return 'RELATED';
  if (mixed) return 'MIXED';
  return 'SEPARATE';
}

export function compareSeoSerps(targetCache, nearbyCache, parameters = {}) {
  const targetDomains = normalizedOrganicDomains(targetCache?.classified);
  const nearbyDomains = normalizedOrganicDomains(nearbyCache?.classified);
  const overlap = calculateJaccard(targetDomains, nearbyDomains);
  const targetTop5 = extractTop5OrganicDomains(targetCache);
  const nearbyTop5 = extractTop5OrganicDomains(nearbyCache);
  const sharedTop5Domains = targetTop5.available && nearbyTop5.available
    ? targetTop5.domains.filter((domain) => nearbyTop5.domains.includes(domain))
    : [];
  const result = {
    ...overlap,
    sharedTop5DomainCount: sharedTop5Domains.length,
    sharedTop5Domains,
    sharedTop5Availability: {
      available: targetTop5.available && nearbyTop5.available,
      target: targetTop5.diagnostic,
      nearby: nearbyTop5.diagnostic,
    },
  };
  return {
    ...result,
    relationship: classifySeoRelationship(result, parameters),
  };
}

function parseObject(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function cityStateKey(city, state) {
  return `${String(city || '').trim().toLowerCase()}|${String(state || '').trim().toUpperCase()}`;
}

export function selectNearbyCities(row, parameters = {}) {
  const config = normalizeSeoClusterParameters(parameters);
  if (config.maxNearbySerps === 0) return [];
  const context = parseObject(row?.populationContext);
  if (!context || context.nearbyStatus !== 'available' || !Array.isArray(context.nearbyPlaces)) return [];
  const targetState = String(row?.State || '').trim().toUpperCase();
  const targetKey = cityStateKey(row?.City, targetState);
  const seen = new Set([targetKey]);
  const candidates = [];
  for (const place of context.nearbyPlaces) {
    const rawCity = place?.name ?? place?.city;
    if (typeof rawCity !== 'string') continue;
    const city = rawCity.trim();
    const rawState = place?.state == null || place.state === '' ? targetState : place.state;
    if (typeof rawState !== 'string') continue;
    const state = rawState.trim().toUpperCase();
    const population = finiteNumber(place?.population);
    const key = cityStateKey(city, state);
    if (!city || state.length !== 2 || population == null || population < config.nearbyCityMinPopulation) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ city, state, population });
  }
  candidates.sort((left, right) =>
    right.population - left.population
    || left.city.localeCompare(right.city)
    || left.state.localeCompare(right.state));
  return candidates.slice(0, Math.min(5, config.maxNearbySerps));
}

function inspectCache(batchDir, key) {
  const cachePath = serpCachePath(batchDir, key);
  const cache = readSerpCache(cachePath);
  if (!cache) return { state: 'missing', cache: null, cachePath, cacheAt: null, domainHash: null };
  if (!Array.isArray(cache?.classified?.uniqueOrganicDomains)) {
    return { state: 'invalid', cache: null, cachePath, cacheAt: cache.at || null, domainHash: null };
  }
  if (!isSerpCacheFresh(cache)) {
    return {
      state: 'stale',
      cache: null,
      cachePath,
      cacheAt: cache.at || null,
      domainHash: domainHash(cache.classified),
    };
  }
  return {
    state: 'fresh',
    cache,
    cachePath,
    cacheAt: cache.at,
    domainHash: domainHash(cache.classified),
  };
}

function statusHistogram(rowPlans) {
  const counts = {};
  for (const rowPlan of rowPlans) counts[rowPlan.status] = (counts[rowPlan.status] || 0) + 1;
  return counts;
}

function tokenPayload(plan) {
  return {
    batchId: plan.batchId,
    parameters: plan.parameters,
    rows: plan.rowPlans.map((rowPlan) => ({
      rowKey: rowPlan.rowKey,
      status: rowPlan.status,
      targetCache: rowPlan.targetCache
        ? {
            state: rowPlan.targetCache.state,
            cacheAt: rowPlan.targetCache.cacheAt,
            domainHash: rowPlan.targetCache.domainHash,
          }
        : null,
      comparisons: rowPlan.comparisons.map((comparison) => ({
        serpKey: comparison.serpKey,
        cacheState: comparison.cacheState,
        cacheAt: comparison.cacheAt,
        domainHash: comparison.domainHash,
        disposition: comparison.disposition,
      })),
    })),
    distinctCacheHitKeys: plan.distinctCacheHitKeys,
    distinctLiveKeys: plan.distinctLiveKeys,
  };
}

export function buildNearbySerpPlan({ batch, rows, dir, rowKeyFn, adsLocationNameFn = adsLocationName } = {}) {
  if (!batch?.id || !Array.isArray(rows) || !dir || typeof rowKeyFn !== 'function') {
    throw new Error('Package-3 plan requires batch, rows, dir, and Rover rowKey');
  }
  const parameters = normalizeSeoClusterParameters(batch.filters || {});
  const cacheHitKeys = new Set();
  const liveKeys = new Set();
  const rowPlans = rows.map((row, index) => {
    const targetKey = rowKeyFn(row);
    const base = { index, rowKey: targetKey, status: 'ready', targetCache: null, comparisons: [] };
    if (String(row?.screenDecision || '').trim() !== 'SURVIVE') {
      return { ...base, status: 'skipped_not_survive' };
    }
    const populationContext = parseObject(row?.populationContext);
    if (populationContext?.eligible === false) {
      return { ...base, status: 'skipped_population_ineligible' };
    }
    if (parameters.maxNearbySerps === 0) return { ...base, status: 'max_nearby_zero' };
    if (
      !populationContext
      || populationContext.nearbyStatus !== 'available'
      || !Array.isArray(populationContext.nearbyPlaces)
    ) {
      return { ...base, status: 'nearby_unavailable' };
    }
    const targetCache = inspectCache(dir, targetKey);
    if (targetCache.state !== 'fresh') {
      return {
        ...base,
        status: 'skipped_no_target_cache',
        targetCache: { ...targetCache, cache: undefined },
        _targetCache: null,
      };
    }
    const nearbyCities = selectNearbyCities(row, parameters);
    if (!nearbyCities.length) {
      return {
        ...base,
        status: 'no_nearby_candidates',
        targetCache: { ...targetCache, cache: undefined },
        _targetCache: targetCache.cache,
      };
    }
    const comparisons = nearbyCities.map((nearby) => {
      const serpKey = rowKeyFn({ Niche: row.Niche, City: nearby.city, State: nearby.state });
      const cacheInspection = inspectCache(dir, serpKey);
      if (cacheInspection.state === 'fresh') cacheHitKeys.add(serpKey);
      let disposition = cacheInspection.state === 'fresh' ? 'cache_hit' : 'live_fetch';
      let locationName = null;
      if (cacheInspection.state !== 'fresh') {
        try {
          locationName = adsLocationNameFn(nearby.city, nearby.state);
          liveKeys.add(serpKey);
        } catch {
          disposition = 'invalid_location';
        }
      }
      return {
        ...nearby,
        serpKey,
        cacheState: cacheInspection.state,
        cacheAt: cacheInspection.cacheAt,
        domainHash: cacheInspection.domainHash,
        disposition,
        locationName,
        _cache: cacheInspection.cache,
      };
    });
    return {
      ...base,
      targetCache: { ...targetCache, cache: undefined },
      comparisons,
      _targetCache: targetCache.cache,
    };
  });
  const comparisonCount = rowPlans.reduce((sum, rowPlan) => sum + rowPlan.comparisons.length, 0);
  const cacheHitComparisons = rowPlans.reduce(
    (sum, rowPlan) => sum + rowPlan.comparisons.filter((edge) => edge.disposition === 'cache_hit').length,
    0,
  );
  const plan = {
    batchId: batch.id,
    rowCount: rows.length,
    parameters,
    rowPlans,
    survivorTargetRows: rowPlans.filter((rowPlan) => rowPlan.status === 'ready').length,
    skippedTargetRows: rowPlans.filter((rowPlan) => rowPlan.status !== 'ready').length,
    comparisonCount,
    cacheHitComparisons,
    distinctCacheHitKeys: [...cacheHitKeys].sort(),
    distinctLiveKeys: [...liveKeys].sort(),
    liveCalls: liveKeys.size,
    statusCounts: statusHistogram(rowPlans),
  };
  plan.planToken = sha256(JSON.stringify(tokenPayload(plan)));
  return plan;
}

export function previewNearbySerpValidation(batchData, dependencies = {}) {
  const plan = buildNearbySerpPlan({ ...batchData, ...dependencies });
  const n = plan.liveCalls;
  return {
    batchId: plan.batchId,
    rowCount: plan.rowCount,
    survivorTargetRows: plan.survivorTargetRows,
    skippedTargetRows: plan.skippedTargetRows,
    comparisonCount: plan.comparisonCount,
    cacheHitComparisons: plan.cacheHitComparisons,
    distinctCacheHitKeys: plan.distinctCacheHitKeys.length,
    distinctLiveKeys: plan.distinctLiveKeys.length,
    liveCalls: n,
    estimateUsdLow: Number((n * NEARBY_SERP_ESTIMATE_USD).toFixed(4)),
    estimateUsdHigh: Number((n * NEARBY_SERP_ESTIMATE_USD * 1.5).toFixed(4)),
    hasDataForSeo: Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
    planToken: plan.planToken,
    statusCounts: plan.statusCounts,
    setupMessages: plan.statusCounts.nearby_unavailable
      ? ['Nearby population context unavailable. Run: npm run build-research-map']
      : [],
    parameters: plan.parameters,
  };
}

function skippedEvidence(row, rowPlan, parameters, runId, computedAt) {
  return {
    version: evidenceVersion,
    status: rowPlan.status,
    computedAt,
    runId,
    target: {
      rowKey: rowPlan.rowKey,
      city: String(row?.City || '').trim(),
      state: String(row?.State || '').trim().toUpperCase(),
    },
    parameters,
    targetSerp: rowPlan.targetCache
      ? {
          cacheKey: rowPlan.rowKey,
          cacheAt: rowPlan.targetCache.cacheAt,
          domainHash: rowPlan.targetCache.domainHash,
        }
      : null,
    comparisons: [],
    summary: { relatedCount: 0, mixedCount: 0, separateCount: 0 },
  };
}

function validateExpectedToken(plan, expectedPlanToken) {
  if (!String(expectedPlanToken || '').trim()) {
    const error = new Error('expectedPlanToken is required');
    error.status = 400;
    throw error;
  }
  if (expectedPlanToken !== plan.planToken) {
    const error = new Error('Nearby SERP plan changed. Preview again.');
    error.status = 409;
    error.code = 'nearby_serp_plan_changed';
    throw error;
  }
}

function assertCredentialsForPlan(plan, fetchOrganicSerpFn, requireCredentialsFn) {
  if (plan.liveCalls > 0 && fetchOrganicSerpFn === fetchOrganicSerp) requireCredentialsFn();
}

export async function executeNearbySerpValidation(
  batchData,
  {
    expectedPlanToken,
    concurrency = 1,
    rowKeyFn,
    rowsToDiscoveryRuntimeCsvFn,
    adsLocationNameFn = adsLocationName,
    fetchOrganicSerpFn = fetchOrganicSerp,
    requireCredentialsFn = requireCredentials,
    preparedPlan = null,
    onProgress = null,
  } = {},
) {
  const plan = preparedPlan || buildNearbySerpPlan({ ...batchData, rowKeyFn, adsLocationNameFn });
  validateExpectedToken(plan, expectedPlanToken);
  assertCredentialsForPlan(plan, fetchOrganicSerpFn, requireCredentialsFn);
  if (typeof rowsToDiscoveryRuntimeCsvFn !== 'function') {
    throw new Error('Package-3 execution requires Rover runtime CSV writer');
  }

  const { batch, rows, dir } = batchData;
  const runId = randomUUID();
  const computedAt = new Date().toISOString();
  const fetched = new Map();
  const fetches = [];
  const liveEntries = plan.distinctLiveKeys.map((key) => {
    for (const rowPlan of plan.rowPlans) {
      const edge = rowPlan.comparisons.find((comparison) => comparison.serpKey === key);
      if (edge) return { key, edge, rowPlan };
    }
    return null;
  }).filter(Boolean);
  let cursor = 0;
  let actualProviderCalls = 0;
  let actualCostUsd = 0;

  async function worker() {
    while (cursor < liveEntries.length) {
      const entry = liveEntries[cursor];
      cursor += 1;
      const targetRow = rows[entry.rowPlan.index];
      const keyword = `${targetRow.Niche} ${entry.edge.city} ${entry.edge.state}`;
      actualProviderCalls += 1;
      try {
        const raw = await fetchOrganicSerpFn(keyword, entry.edge.locationName);
        const classified = enrichClassifiedSerp(classifySerpItems(raw.items), {
          niche: targetRow.Niche,
          itemTypes: raw.itemTypes,
          items: raw.items,
        });
        const cache = {
          at: new Date().toISOString(),
          batchId: batch.id,
          rowIndex: null,
          rowKey: entry.key,
          keyword,
          locationName: entry.edge.locationName,
          cost: Number(raw.cost) || 0,
          checkUrl: raw.checkUrl,
          endpoint: raw.endpoint,
          itemTypes: raw.itemTypes,
          items: raw.items,
          classified,
        };
        writeSerpCache(dir, entry.key, cache);
        fetched.set(entry.key, { ok: true, cache });
        actualCostUsd = Number((actualCostUsd + cache.cost).toFixed(4));
        fetches.push({
          serpKey: entry.key,
          status: 'ok',
          costUsd: cache.cost,
          cacheAt: cache.at,
          domainHash: domainHash(classified),
        });
      } catch (error) {
        fetched.set(entry.key, { ok: false, error: error.message });
        fetches.push({ serpKey: entry.key, status: 'error', costUsd: 0, error: error.message });
      }
      onProgress?.({ phase: 'fetch', done: cursor, total: liveEntries.length, key: entry.key });
    }
  }

  const conc = Math.min(2, Math.max(1, Number(concurrency) || 1));
  await Promise.all(Array.from({ length: conc }, () => worker()));

  const nextRows = rows.map((row) => ({ ...row }));
  const rowSummaries = [];
  const reuseSeen = new Set();
  let relatedCount = 0;
  let mixedCount = 0;
  let separateCount = 0;
  let completedComparisons = 0;

  for (const rowPlan of plan.rowPlans) {
    const row = rows[rowPlan.index];
    if (rowPlan.status !== 'ready') {
      const evidence = skippedEvidence(row, rowPlan, plan.parameters, runId, computedAt);
      nextRows[rowPlan.index].seoClusterCities = '[]';
      nextRows[rowPlan.index].seoClusterEvidence = JSON.stringify(evidence);
      rowSummaries.push({ rowKey: rowPlan.rowKey, status: rowPlan.status, summary: evidence.summary });
      continue;
    }

    const comparisons = [];
    const targetDomainCount = normalizedOrganicDomains(rowPlan._targetCache?.classified).length;
    let unresolved = 0;
    for (const edge of rowPlan.comparisons) {
      let nearbyCache = edge._cache;
      let cacheDisposition = edge.disposition;
      if (edge.disposition === 'live_fetch') {
        const result = fetched.get(edge.serpKey);
        if (!result?.ok) {
          unresolved += 1;
          comparisons.push({
            city: edge.city,
            state: edge.state,
            population: edge.population,
            serpKey: edge.serpKey,
            relationship: null,
            unresolved: true,
            error: result?.error || 'fetch failed',
            targetDomainCount,
            nearbyDomainCount: null,
            sharedDomainCount: null,
            sharedDomains: [],
            jaccard: null,
            sharedTop5DomainCount: 0,
            sharedTop5Domains: [],
            sharedTop5Availability: {
              available: false,
              diagnostic: 'nearby_fetch_failed',
            },
            cacheDisposition: 'fetch_error',
            cacheAt: null,
            domainHash: null,
          });
          completedComparisons += 1;
          onProgress?.({ phase: 'compare', done: completedComparisons, total: plan.comparisonCount });
          continue;
        }
        nearbyCache = result.cache;
        cacheDisposition = reuseSeen.has(edge.serpKey) ? 'same_run_reuse' : 'live_fetch';
        reuseSeen.add(edge.serpKey);
      } else if (edge.disposition === 'invalid_location') {
        unresolved += 1;
        comparisons.push({
          city: edge.city,
          state: edge.state,
          population: edge.population,
          serpKey: edge.serpKey,
          relationship: null,
          unresolved: true,
          error: 'invalid provider location',
          targetDomainCount,
          nearbyDomainCount: null,
          sharedDomainCount: null,
          sharedDomains: [],
          jaccard: null,
          sharedTop5DomainCount: 0,
          sharedTop5Domains: [],
          sharedTop5Availability: {
            available: false,
            diagnostic: 'invalid_location',
          },
          cacheDisposition: 'invalid_location',
          cacheAt: null,
          domainHash: null,
        });
        completedComparisons += 1;
        onProgress?.({ phase: 'compare', done: completedComparisons, total: plan.comparisonCount });
        continue;
      }
      const measurement = compareSeoSerps(rowPlan._targetCache, nearbyCache, plan.parameters);
      const comparison = {
        city: edge.city,
        state: edge.state,
        population: edge.population,
        serpKey: edge.serpKey,
        relationship: measurement.relationship,
        targetDomainCount: measurement.targetDomainCount,
        nearbyDomainCount: measurement.nearbyDomainCount,
        sharedDomainCount: measurement.sharedDomainCount,
        sharedDomains: measurement.sharedDomains,
        jaccard: measurement.jaccard,
        sharedTop5DomainCount: measurement.sharedTop5DomainCount,
        sharedTop5Domains: measurement.sharedTop5Domains,
        sharedTop5Availability: measurement.sharedTop5Availability,
        cacheDisposition,
        cacheAt: nearbyCache.at || null,
        domainHash: domainHash(nearbyCache.classified),
      };
      comparisons.push(comparison);
      if (comparison.relationship === 'RELATED') relatedCount += 1;
      else if (comparison.relationship === 'MIXED') mixedCount += 1;
      else if (comparison.relationship === 'SEPARATE') separateCount += 1;
      completedComparisons += 1;
      onProgress?.({ phase: 'compare', done: completedComparisons, total: plan.comparisonCount });
    }

    const summary = {
      relatedCount: comparisons.filter((item) => item.relationship === 'RELATED').length,
      mixedCount: comparisons.filter((item) => item.relationship === 'MIXED').length,
      separateCount: comparisons.filter((item) => item.relationship === 'SEPARATE').length,
    };
    const status = unresolved ? 'partial' : 'complete';
    const evidence = {
      version: evidenceVersion,
      status,
      computedAt,
      runId,
      target: {
        rowKey: rowPlan.rowKey,
        city: String(row.City || '').trim(),
        state: String(row.State || '').trim().toUpperCase(),
      },
      parameters: plan.parameters,
      targetSerp: {
        cacheKey: rowPlan.rowKey,
        cacheAt: rowPlan.targetCache.cacheAt,
        domainHash: rowPlan.targetCache.domainHash,
      },
      comparisons,
      summary,
    };
    const relatedCities = comparisons
      .filter((comparison) => comparison.relationship === 'RELATED')
      .map((comparison) => `${comparison.city},${comparison.state}`)
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort((left, right) => left.localeCompare(right));
    nextRows[rowPlan.index].seoClusterCities = JSON.stringify(relatedCities);
    nextRows[rowPlan.index].seoClusterEvidence = JSON.stringify(evidence);
    rowSummaries.push({ rowKey: rowPlan.rowKey, status, summary });
  }

  const artifact = {
    version: evidenceVersion,
    runId,
    createdAt: computedAt,
    planToken: plan.planToken,
    parameters: plan.parameters,
    summary: {
      rowCount: rows.length,
      survivorTargetRows: plan.survivorTargetRows,
      skippedTargetRows: plan.skippedTargetRows,
      comparisonCount: plan.comparisonCount,
      relatedCount,
      mixedCount,
      separateCount,
      cacheHitComparisons: plan.cacheHitComparisons,
      distinctCacheHitKeys: plan.distinctCacheHitKeys.length,
      plannedDistinctLiveCalls: plan.liveCalls,
      distinctLiveCalls: plan.liveCalls,
      actualProviderCalls,
      actualCostUsd,
      fetchErrors: fetches.filter((entry) => entry.status === 'error').length,
    },
    fetches,
    rows: rowSummaries,
  };
  const stamp = computedAt.replace(/[:.]/g, '-');
  const artifactName = `discovery-seo-cluster-${stamp}-${runId}.json`;
  writeFileSync(path.join(dir, 'candidates.csv'), rowsToDiscoveryRuntimeCsvFn(nextRows), 'utf8');
  writeFileSync(path.join(dir, artifactName), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  const metaPath = path.join(dir, 'meta.json');
  const currentMeta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const nextMeta = {
    ...currentMeta,
    updatedAt: new Date().toISOString(),
    lastNearbySerpValidation: {
      at: computedAt,
      runId,
      artifact: artifactName,
      planToken: plan.planToken,
      ...artifact.summary,
    },
    files: { ...(currentMeta.files || {}), lastNearbySerpValidation: artifactName },
  };
  writeFileSync(metaPath, `${JSON.stringify(nextMeta, null, 2)}\n`, 'utf8');
  return { batch: nextMeta, rows: nextRows, artifact, plan };
}

export function startNearbySerpValidation(batchData, options = {}) {
  const plan = buildNearbySerpPlan({
    ...batchData,
    rowKeyFn: options.rowKeyFn,
    adsLocationNameFn: options.adsLocationNameFn,
  });
  validateExpectedToken(plan, options.expectedPlanToken);
  assertCredentialsForPlan(
    plan,
    options.fetchOrganicSerpFn || fetchOrganicSerp,
    options.requireCredentialsFn || requireCredentials,
  );
  const job = {
    id: randomUUID(),
    batchId: batchData.batch.id,
    status: 'running',
    total: plan.comparisonCount,
    done: 0,
    phase: plan.liveCalls ? 'fetch' : 'compare',
    currentKey: null,
    cacheHitComparisons: plan.cacheHitComparisons,
    liveCalls: plan.liveCalls,
    actualProviderCalls: 0,
    actualCostUsd: 0,
    error: null,
    result: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  nearbyJobs.set(job.id, job);
  Promise.resolve().then(async () => {
    try {
      const result = await executeNearbySerpValidation(batchData, {
        ...options,
        preparedPlan: plan,
        onProgress: (progress) => {
          job.phase = progress.phase;
          job.currentKey = progress.key || null;
          if (progress.phase === 'compare') job.done = progress.done;
        },
      });
      job.result = result;
      job.actualProviderCalls = result.artifact.summary.actualProviderCalls;
      job.actualCostUsd = result.artifact.summary.actualCostUsd;
      job.done = plan.comparisonCount;
      job.status = result.artifact.summary.fetchErrors
        || result.artifact.rows.some((row) => row.status === 'partial')
        ? 'partial'
        : 'ok';
    } catch (error) {
      job.status = 'error';
      job.error = error.message;
    } finally {
      job.finishedAt = new Date().toISOString();
      job.currentKey = null;
    }
  });
  return job;
}

export function getNearbySerpJob(jobId) {
  return nearbyJobs.get(jobId) || null;
}

export async function runNearbySerpValidation(batchData, options = {}) {
  const job = startNearbySerpValidation(batchData, options);
  while (job.status === 'running') await new Promise((resolve) => setTimeout(resolve, 10));
  if (job.status === 'error') {
    const error = new Error(job.error || 'Nearby SERP validation failed');
    error.status = 500;
    throw error;
  }
  return job.result;
}

export function invalidateSeoClusterEvidenceForSerpKeys(
  rows,
  changedSerpKeys,
  { invalidatedAt = new Date().toISOString() } = {},
) {
  const changed = new Set((changedSerpKeys || []).map((key) => String(key || '').toLowerCase()));
  if (!changed.size) return rows;
  return (rows || []).map((row) => {
    const evidence = parseObject(row?.seoClusterEvidence);
    if (!evidence) return row;
    const usedKeys = [
      evidence.targetSerp?.cacheKey,
      ...(Array.isArray(evidence.comparisons)
        ? evidence.comparisons.map((comparison) => comparison?.serpKey)
        : []),
    ].map((key) => String(key || '').toLowerCase());
    if (!usedKeys.some((key) => changed.has(key))) return row;
    return {
      ...row,
      seoClusterCities: '[]',
      seoClusterEvidence: JSON.stringify({
        version: evidenceVersion,
        status: 'stale_serp_changed',
        invalidatedAt,
        reason: 'A cached SERP used by Package-3 evidence was refreshed',
        target: evidence.target || null,
        parameters: evidence.parameters || null,
        targetSerp: evidence.targetSerp || null,
        comparisons: evidence.comparisons || [],
        summary: evidence.summary || { relatedCount: 0, mixedCount: 0, separateCount: 0 },
      }),
    };
  });
}
