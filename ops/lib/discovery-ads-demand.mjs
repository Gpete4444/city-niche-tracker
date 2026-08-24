import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { loadAdsLocations, requireCredentials, resolveAdsLocation } from '../../scripts/lib/dataforseo.mjs';
import {
  ADS_DEMAND_ENGINE_VERSION,
  ADS_INTENT_CLASSIFIER_VERSION,
  ADS_KEYWORD_CONTRACT_VERSION,
  adsCityKey,
  adsDemandAuthorityMatches,
  collectAdsDemand,
  classifyAdsKeywordIntent,
  normalizeAdsCities,
  parseAdsCity,
  readPreHumanAdsSidecar,
  safePreHumanAdsPath,
  summarizeAdsIntent,
} from '../../scripts/lib/ads-demand-research.mjs';

export const V15_PRE_HUMAN_ADS_PARAMETERS = Object.freeze({
  maxPreHumanAdsRows: 5,
  maxPreHumanAdsVolumeCalls: 30,
});
export const PRE_HUMAN_ADS_HARD_LIMITS = Object.freeze({
  rows: 10,
  relatedKeywordCalls: 10,
  searchVolumeCalls: 60,
  rowConcurrency: 2,
  adsLocationLoaderInvocations: 1,
});
export const ADS_DEMAND_SIGNATURE_VERSION = 1;
export const INTENT_CLASSIFIER_VERSION = ADS_INTENT_CLASSIFIER_VERSION;

export { classifyAdsKeywordIntent, summarizeAdsIntent };

const jobs = new Map();

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function parseObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseArray(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw || ''));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function integerInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

export function normalizePreHumanAdsParameters(filters = {}) {
  return {
    maxPreHumanAdsRows: integerInRange(
      filters.maxPreHumanAdsRows,
      1,
      PRE_HUMAN_ADS_HARD_LIMITS.rows,
      V15_PRE_HUMAN_ADS_PARAMETERS.maxPreHumanAdsRows,
    ),
    maxPreHumanAdsVolumeCalls: integerInRange(
      filters.maxPreHumanAdsVolumeCalls,
      1,
      PRE_HUMAN_ADS_HARD_LIMITS.searchVolumeCalls,
      V15_PRE_HUMAN_ADS_PARAMETERS.maxPreHumanAdsVolumeCalls,
    ),
  };
}

export function currentSeoClusterAuthority(row) {
  const evidence = parseObject(row?.seoClusterEvidence);
  if (!evidence) return { usable: false, status: 'malformed', adsCluster: [] };
  const status = String(evidence.status || '');
  if (['complete', 'partial'].includes(status)) {
    const stored = parseArray(row?.seoClusterCities);
    if (!stored) return { usable: false, status: 'malformed', adsCluster: [] };
    try {
      const primary = { city: row.City, state: row.State };
      return {
        usable: true,
        status,
        adsCluster: normalizeAdsCities(primary, stored)
          .slice(1)
          .map((place) => `${place.city},${place.state}`),
      };
    } catch {
      return { usable: false, status: 'malformed', adsCluster: [] };
    }
  }
  if (['no_nearby_candidates', 'nearby_unavailable', 'max_nearby_zero'].includes(status)) {
    return { usable: true, status, adsCluster: [] };
  }
  return { usable: false, status: status || 'missing', adsCluster: [] };
}

export function buildAdsDemandSignature({ row, adsCluster, relatedLimit = 10 } = {}) {
  const primary = parseAdsCity({ city: row?.City, state: row?.State });
  const cluster = primary
    ? normalizeAdsCities(primary, adsCluster || []).slice(1).map((place) => `${place.city},${place.state}`)
    : [];
  return sha256(JSON.stringify({
    schemaVersion: ADS_DEMAND_SIGNATURE_VERSION,
    rowKey: [row?.Niche, row?.City, row?.State].map((value) => String(value || '').trim().toLowerCase()).join('|'),
    niche: String(row?.Niche || '').trim(),
    target: primary ? `${primary.city},${primary.state}` : '',
    adsCluster: cluster,
    relatedLimit: Number(relatedLimit) || 10,
    keywordSeedContractVersion: ADS_KEYWORD_CONTRACT_VERSION,
    intentClassifierVersion: INTENT_CLASSIFIER_VERSION,
  }));
}

function adsLocationCacheSnapshot(root) {
  const cachePath = path.join(root, '.cache', 'google-ads-locations-us.json');
  if (!existsSync(cachePath)) return { available: false, cachePath, fingerprint: 'missing', locations: null };
  try {
    const raw = readFileSync(cachePath, 'utf8');
    const locations = JSON.parse(raw);
    if (!Array.isArray(locations)) throw new Error('invalid cache');
    return { available: true, cachePath, fingerprint: sha256(raw), locations };
  } catch {
    return { available: false, cachePath, fingerprint: 'invalid', locations: null };
  }
}

function rowProcessed(row) {
  const status = String(row?.process_status || '').trim().toLowerCase();
  return status === 'promoted' || status === 'tracked' || Boolean(String(row?.candidateId || '').trim());
}

function sidecarFingerprint(sidecar) {
  if (!sidecar) return 'missing';
  return sha256(JSON.stringify({
    version: sidecar.version,
    signature: sidecar.signature,
    status: sidecar.status,
    relatedStatus: sidecar.relatedKeywords?.status,
    geos: Object.fromEntries(Object.entries(sidecar.geoStates || {}).map(([key, geo]) => [key, {
      status: geo.status,
      locationCode: geo.locationCode || null,
    }])),
  }));
}

function sidecarMatchesRow(sidecar, row, authority, signature, allowedStatuses = ['complete', 'partial']) {
  return adsDemandAuthorityMatches(sidecar, {
    signature,
    niche: row?.Niche,
    primary: { city: row?.City, state: row?.State },
    adsCluster: authority.adsCluster,
    seeds: [],
    relatedLimit: 10,
    allowedStatuses,
    requireEvidenceState: true,
  });
}

function compactEvidenceMatchesRow(evidence, row, authority, signature) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;
  let storedCluster;
  try {
    storedCluster = normalizeAdsCities(
      { city: row?.City, state: row?.State },
      evidence.adsCluster || [],
    ).slice(1).map((city) => `${city.city},${city.state}`);
  } catch {
    return false;
  }
  return evidence.signature === signature
    && evidence.rowKey === [row?.Niche, row?.City, row?.State].map((value) => String(value || '').trim().toLowerCase()).join('|')
    && evidence.signatureVersion === ADS_DEMAND_SIGNATURE_VERSION
    && evidence.keywordContractVersion === ADS_KEYWORD_CONTRACT_VERSION
    && evidence.intentClassifierVersion === INTENT_CLASSIFIER_VERSION
    && adsCityKey(evidence.target) === adsCityKey({ city: row?.City, state: row?.State })
    && JSON.stringify(storedCluster) === JSON.stringify(authority.adsCluster);
}

export function buildSelectiveAdsPlan({
  batch,
  rows,
  dir,
  indices = [],
  root = process.cwd(),
  rowKeyFn,
} = {}) {
  if (!batch?.id || !Array.isArray(rows) || !dir || typeof rowKeyFn !== 'function') {
    throw new Error('Package-4 plan requires batch, rows, dir, and Rover rowKey');
  }
  const parameters = normalizePreHumanAdsParameters(batch.filters || {});
  const selectedIndices = [...new Set((indices || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const locationSnapshot = adsLocationCacheSnapshot(root);
  const rowPlans = [];
  let potentialAdsGeos = 0;
  let knownSupportedAdsGeos = 0;
  let knownUnsupportedAdsGeos = 0;
  let rowsNeedingRelatedKeywords = 0;
  let searchVolumeCallsMax = 0;

  for (const index of selectedIndices) {
    const row = rows[index];
    const base = { index, rowKey: row ? rowKeyFn(row) : '', status: 'ready', adsCluster: [], geos: [], signature: null };
    if (!row) {
      rowPlans.push({ ...base, status: 'skipped_missing_row' });
      continue;
    }
    if (String(row.screenDecision || '') !== 'SURVIVE') {
      rowPlans.push({ ...base, status: 'skipped_not_survive' });
      continue;
    }
    const population = parseObject(row.populationContext);
    if (population?.eligible === false) {
      rowPlans.push({ ...base, status: 'skipped_population_ineligible' });
      continue;
    }
    if (rowProcessed(row)) {
      rowPlans.push({ ...base, status: 'skipped_processed' });
      continue;
    }
    const authority = currentSeoClusterAuthority(row);
    if (!authority.usable) {
      rowPlans.push({ ...base, status: 'skipped_no_current_seo_cluster', clusterAuthorityStatus: authority.status });
      continue;
    }
    const geos = normalizeAdsCities({ city: row.City, state: row.State }, authority.adsCluster);
    const signature = buildAdsDemandSignature({
      row,
      adsCluster: authority.adsCluster,
      relatedLimit: 10,
    });
    const ref = String(row.adsResearchRef || '').trim();
    const sidecar = ref ? readPreHumanAdsSidecar(ref, root) : null;
    const currentSidecar = sidecarMatchesRow(sidecar, row, authority, signature) ? sidecar : null;
    const disposition = currentSidecar?.status === 'complete'
      ? 'reused'
      : currentSidecar
        ? 'partial_resume'
        : 'new';
    let relatedNeeded = disposition !== 'reused' && currentSidecar?.relatedKeywords?.status !== 'complete';
    let rowVolumeCalls = 0;
    const knownPrimary = locationSnapshot.available
      ? resolveAdsLocation(locationSnapshot.locations, geos[0].city, geos[0].state)
      : undefined;
    for (const place of geos) {
      potentialAdsGeos += 1;
      const key = adsCityKey(place);
      const priorGeo = currentSidecar?.geoStates?.[key];
      if (priorGeo?.status === 'complete') continue;
      if (locationSnapshot.available) {
        const resolved = resolveAdsLocation(locationSnapshot.locations, place.city, place.state);
        if (resolved) {
          knownSupportedAdsGeos += 1;
          rowVolumeCalls += 1;
        } else knownUnsupportedAdsGeos += 1;
      } else rowVolumeCalls += 1;
    }
    if (disposition === 'reused') {
      relatedNeeded = false;
      rowVolumeCalls = 0;
    } else if (locationSnapshot.available && !knownPrimary) {
      relatedNeeded = false;
      rowVolumeCalls = 0;
    }
    if (relatedNeeded) rowsNeedingRelatedKeywords += 1;
    searchVolumeCallsMax += rowVolumeCalls;
    rowPlans.push({
      ...base,
      status: 'ready',
      clusterAuthorityStatus: authority.status,
      adsCluster: authority.adsCluster,
      geos,
      signature,
      disposition,
      relatedNeeded,
      searchVolumeCallsMax: rowVolumeCalls,
      knownUnsupportedPrimary: locationSnapshot.available && !knownPrimary,
      sidecarRef: currentSidecar ? ref : null,
      sidecarFingerprint: sidecarFingerprint(currentSidecar),
      _sidecar: currentSidecar,
    });
  }

  const eligibleRows = rowPlans.filter((row) => row.status === 'ready').length;
  const skippedRows = rowPlans.length - eligibleRows;
  const reusableRows = rowPlans.filter((row) => row.disposition === 'reused').length;
  const providerWork = rowsNeedingRelatedKeywords + searchVolumeCallsMax;
  const adsLocationLoaderRequired = providerWork > 0 && !locationSnapshot.available;
  const adsLocationLoaderInvocationsMax = adsLocationLoaderRequired ? 1 : 0;
  const adsLocationProviderRequestsMax = adsLocationLoaderRequired ? 2 : 0;
  const relatedKeywordCallsMax = rowsNeedingRelatedKeywords;
  let capReason = null;
  if (eligibleRows > parameters.maxPreHumanAdsRows) {
    capReason = `Selected eligible rows ${eligibleRows} exceed configured cap ${parameters.maxPreHumanAdsRows}.`;
  } else if (eligibleRows > PRE_HUMAN_ADS_HARD_LIMITS.rows) {
    capReason = `Selected eligible rows exceed absolute hard maximum ${PRE_HUMAN_ADS_HARD_LIMITS.rows}.`;
  } else if (searchVolumeCallsMax > parameters.maxPreHumanAdsVolumeCalls) {
    capReason = `Potential search-volume calls ${searchVolumeCallsMax} exceed configured cap ${parameters.maxPreHumanAdsVolumeCalls}.`;
  } else if (searchVolumeCallsMax > PRE_HUMAN_ADS_HARD_LIMITS.searchVolumeCalls) {
    capReason = `Potential search-volume calls exceed absolute hard maximum ${PRE_HUMAN_ADS_HARD_LIMITS.searchVolumeCalls}.`;
  } else if (relatedKeywordCallsMax > PRE_HUMAN_ADS_HARD_LIMITS.relatedKeywordCalls) {
    capReason = `Related-keyword calls exceed absolute hard maximum ${PRE_HUMAN_ADS_HARD_LIMITS.relatedKeywordCalls}.`;
  }
  const plan = {
    batchId: batch.id,
    selectedRows: selectedIndices.length,
    eligibleRows,
    skippedRows,
    reusableRows,
    rowsNeedingProviderWork: rowPlans.filter((row) => row.status === 'ready' && row.disposition !== 'reused').length,
    rowsNeedingRelatedKeywords,
    potentialAdsGeos,
    knownSupportedAdsGeos,
    knownUnsupportedAdsGeos,
    adsLocationCacheAvailable: locationSnapshot.available,
    adsLocationsCacheAvailable: locationSnapshot.available,
    adsLocationLoaderRequired,
    adsLocationLoadRequired: adsLocationLoaderRequired,
    adsLocationLoaderInvocationsMax,
    adsLocationProviderRequestsMax,
    relatedKeywordCallsMax,
    searchVolumeCallsMax,
    remoteOperationsMax: relatedKeywordCallsMax + searchVolumeCallsMax + adsLocationProviderRequestsMax,
    estimateUsd: null,
    estimateUnavailable: true,
    parameters,
    capExceeded: Boolean(capReason),
    capReason,
    rowPlans,
    locationCacheFingerprint: locationSnapshot.fingerprint,
    _locations: locationSnapshot.locations,
  };
  plan.planToken = sha256(JSON.stringify({
    batchId: plan.batchId,
    parameters,
    selectedIndices,
    rows: rowPlans.map((row) => ({
      index: row.index,
      rowKey: row.rowKey,
      status: row.status,
      signature: row.signature,
      geos: row.geos.map((geo) => adsCityKey(geo)),
      disposition: row.disposition,
      sidecarFingerprint: row.sidecarFingerprint,
      relatedNeeded: row.relatedNeeded,
      searchVolumeCallsMax: row.searchVolumeCallsMax,
    })),
    locationCacheFingerprint: plan.locationCacheFingerprint,
    relatedKeywordCallsMax,
    searchVolumeCallsMax,
    adsLocationLoaderInvocationsMax,
  }));
  return plan;
}

export function previewSelectiveAdsDemand(batchData, options = {}) {
  const plan = buildSelectiveAdsPlan({ ...batchData, ...options });
  const { rowPlans, _locations, locationCacheFingerprint, ...preview } = plan;
  return {
    ...preview,
    statusCounts: rowPlans.reduce((counts, row) => {
      const key = row.status === 'ready' ? row.disposition : row.status;
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    selectedIndices: rowPlans.map((row) => row.index),
    hasDataForSeo: Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
  };
}

function validateToken(plan, expectedPlanToken) {
  if (!String(expectedPlanToken || '').trim()) {
    const error = new Error('expectedPlanToken is required');
    error.status = 400;
    throw error;
  }
  if (expectedPlanToken !== plan.planToken) {
    const error = new Error('Ads demand plan changed. Preview again.');
    error.status = 409;
    error.code = 'ads_demand_plan_changed';
    throw error;
  }
  if (plan.capExceeded) {
    const error = new Error(plan.capReason);
    error.status = 400;
    error.code = 'ads_demand_cap_exceeded';
    throw error;
  }
}

function planUsesDefaultProvider(plan, dependencies = {}) {
  return (plan.adsLocationLoaderRequired && typeof dependencies.loadAdsLocationsFn !== 'function')
    || (plan.relatedKeywordCallsMax > 0 && typeof dependencies.fetchRelatedKeywordsFn !== 'function')
    || (plan.searchVolumeCallsMax > 0 && typeof dependencies.fetchSearchVolumesFn !== 'function');
}

function compactEvidence(sidecar, ref, runId) {
  const intent = sidecar.intentSummary || summarizeAdsIntent(sidecar.volumes);
  return {
    version: ADS_DEMAND_ENGINE_VERSION,
    signatureVersion: ADS_DEMAND_SIGNATURE_VERSION,
    keywordContractVersion: ADS_KEYWORD_CONTRACT_VERSION,
    intentClassifierVersion: INTENT_CLASSIFIER_VERSION,
    rowKey: sidecar.rowKey,
    status: sidecar.status,
    signature: sidecar.signature,
    collectedAt: sidecar.collectedAt,
    runId,
    target: sidecar.target,
    adsCluster: sidecar.adsCluster,
    clusterAuthorityStatus: sidecar.clusterAuthorityStatus,
    relatedKeywordCount: sidecar.relatedKeywords?.selectedKeywords?.length || 0,
    supportedCities: Object.values(sidecar.geoStates || {}).filter((geo) => geo.status === 'complete').map((geo) => `${geo.city},${geo.state}`),
    unsupportedCities: sidecar.unsupportedCities || [],
    failedGeos: sidecar.failedGeos || [],
    targetVolume: sidecar.volumes?.primaryVolumeSum ?? null,
    clusterVolume: sidecar.volumes?.clusterVolumeSum ?? null,
    targetNonJobVolume: intent.target.nonJobVolume,
    clusterNonJobVolume: intent.cluster.nonJobVolume,
    intentShares: { target: intent.target.shares, cluster: intent.cluster.shares },
    provider: {
      relatedKeywordCalls: sidecar.provider?.relatedKeywordCalls || 0,
      searchVolumeCalls: sidecar.provider?.searchVolumeCalls || 0,
      newProviderCostUsd: sidecar.provider?.newProviderCostUsd || 0,
      historicalEvidenceCostUsd: sidecar.provider?.historicalEvidenceCostUsd || 0,
    },
    researchRef: ref,
  };
}

export async function executeSelectiveAdsDemand(batchData, {
  indices = [],
  expectedPlanToken,
  concurrency = 1,
  root = process.cwd(),
  rowKeyFn,
  rowsToDiscoveryRuntimeCsvFn,
  dependencies = {},
  preparedPlan = null,
  onProgress = null,
} = {}) {
  const plan = preparedPlan || buildSelectiveAdsPlan({ ...batchData, indices, root, rowKeyFn });
  validateToken(plan, expectedPlanToken);
  if (typeof rowsToDiscoveryRuntimeCsvFn !== 'function') throw new Error('Package-4 execution requires Rover runtime CSV writer');
  if (planUsesDefaultProvider(plan, dependencies)) (dependencies.requireCredentialsFn || requireCredentials)();

  const counters = { adsLocationLoaderInvocations: 0, relatedKeywordCalls: 0, searchVolumeCalls: 0 };
  let locations = plan._locations;
  if (plan.adsLocationLoaderRequired) {
    if (counters.adsLocationLoaderInvocations >= PRE_HUMAN_ADS_HARD_LIMITS.adsLocationLoaderInvocations) throw new Error('Ads location loader hard cap exceeded');
    counters.adsLocationLoaderInvocations += 1;
    locations = await (dependencies.loadAdsLocationsFn || loadAdsLocations)();
  }
  const beforeOperation = (type) => {
    if (type === 'ads_location_loader') throw new Error('Shared row engine may not invoke a second Ads location loader');
    if (type === 'related_keyword') {
      if (counters.relatedKeywordCalls >= plan.relatedKeywordCallsMax || counters.relatedKeywordCalls >= PRE_HUMAN_ADS_HARD_LIMITS.relatedKeywordCalls) {
        throw new Error('Related-keyword call ceiling exceeded');
      }
      counters.relatedKeywordCalls += 1;
    }
    if (type === 'search_volume') {
      if (counters.searchVolumeCalls >= plan.searchVolumeCallsMax || counters.searchVolumeCalls >= PRE_HUMAN_ADS_HARD_LIMITS.searchVolumeCalls) {
        throw new Error('Search-volume call ceiling exceeded');
      }
      counters.searchVolumeCalls += 1;
    }
  };

  const { batch, rows, dir } = batchData;
  const runId = randomUUID();
  const createdAt = new Date().toISOString();
  const nextRows = rows.map((row) => ({ ...row }));
  const summaries = [];
  const sidecarDir = path.join(dir, 'pre-human-ads');
  mkdirSync(sidecarDir, { recursive: true });
  let cursor = 0;
  const ready = plan.rowPlans.filter((row) => row.status === 'ready');
  let newProviderCostUsd = 0;
  let historicalEvidenceCostUsd = 0;
  let providerErrors = 0;

  for (const skipped of plan.rowPlans.filter((row) => row.status !== 'ready')) {
    summaries.push({ index: skipped.index, rowKey: skipped.rowKey, status: skipped.status, researchRef: null });
  }

  async function worker() {
    while (cursor < ready.length) {
      const rowPlan = ready[cursor++];
      const row = rows[rowPlan.index];
      let collected;
      try {
        collected = await collectAdsDemand({
          niche: row.Niche,
          primary: { city: row.City, state: row.State },
          adsCluster: rowPlan.adsCluster,
          relatedLimit: 10,
          adsMode: 'live',
          locations,
          priorState: rowPlan._sidecar,
          reuseCompleteWithoutLocationLoad: true,
          dependencies,
          beforeOperation,
        });
      } catch (error) {
        collected = {
          version: ADS_DEMAND_ENGINE_VERSION,
          status: 'error',
          target: { city: row.City, state: String(row.State).toUpperCase() },
          adsCluster: rowPlan.adsCluster,
          relatedKeywords: rowPlan._sidecar?.relatedKeywords || { status: 'pending', ideas: [], selectedKeywords: [] },
          geoStates: rowPlan._sidecar?.geoStates || {},
          unsupportedCities: rowPlan._sidecar?.unsupportedCities || [],
          failedGeos: rowPlan._sidecar?.failedGeos || [],
          volumes: rowPlan._sidecar?.volumes || null,
          provider: { relatedKeywordCalls: 0, searchVolumeCalls: 0, newProviderCostUsd: 0, historicalEvidenceCostUsd: 0 },
          errors: [{ operation: 'row', error: error.message }],
        };
      }
      const collectedAt = new Date().toISOString();
      const intentSummary = summarizeAdsIntent(collected.volumes);
      const sidecar = {
        ...collected,
        version: ADS_DEMAND_ENGINE_VERSION,
        keywordContractVersion: ADS_KEYWORD_CONTRACT_VERSION,
        intentClassifierVersion: INTENT_CLASSIFIER_VERSION,
        niche: String(row.Niche || '').trim(),
        rowKey: rowPlan.rowKey,
        signature: rowPlan.signature,
        collectedAt,
        clusterAuthorityStatus: rowPlan.clusterAuthorityStatus,
        intentSummary,
      };
      const fileName = `${sha256(`${rowPlan.rowKey}|${rowPlan.signature}`).slice(0, 32)}.json`;
      const filePath = path.join(sidecarDir, fileName);
      writeFileSync(filePath, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');
      const ref = path.relative(root, filePath).replace(/\\/g, '/');
      const compact = compactEvidence(sidecar, ref, runId);
      nextRows[rowPlan.index].adsDemandStatus = sidecar.status;
      nextRows[rowPlan.index].adsDemandEvidence = JSON.stringify(compact);
      nextRows[rowPlan.index].adsResearchRef = ref;
      newProviderCostUsd += Number(sidecar.provider?.newProviderCostUsd) || 0;
      historicalEvidenceCostUsd += Number(sidecar.provider?.historicalEvidenceCostUsd) || 0;
      if (sidecar.status === 'partial' || sidecar.status === 'error') providerErrors += sidecar.errors?.length || 0;
      summaries.push({ index: rowPlan.index, rowKey: rowPlan.rowKey, status: sidecar.status, researchRef: ref, signature: rowPlan.signature });
      onProgress?.({ done: summaries.length, total: plan.rowPlans.length, index: rowPlan.index, rowKey: rowPlan.rowKey, counters: { ...counters } });
    }
  }

  const workerCount = Math.min(PRE_HUMAN_ADS_HARD_LIMITS.rowConcurrency, Math.max(1, Number(concurrency) || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  summaries.sort((left, right) => left.index - right.index);
  const summary = {
    selectedRows: plan.selectedRows,
    eligibleRows: plan.eligibleRows,
    reusedRows: plan.reusableRows,
    completeRows: summaries.filter((row) => row.status === 'complete').length,
    partialRows: summaries.filter((row) => row.status === 'partial').length,
    skippedRows: plan.skippedRows,
    relatedKeywordCalls: counters.relatedKeywordCalls,
    searchVolumeCalls: counters.searchVolumeCalls,
    adsLocationLoaderInvocations: counters.adsLocationLoaderInvocations,
    knownProviderCostUsd: Number(newProviderCostUsd.toFixed(6)),
    newProviderCostUsd: Number(newProviderCostUsd.toFixed(6)),
    historicalEvidenceCostUsd: Number(historicalEvidenceCostUsd.toFixed(6)),
    providerErrors,
  };
  const artifact = {
    version: ADS_DEMAND_ENGINE_VERSION,
    runId,
    createdAt,
    planToken: plan.planToken,
    selectedRowKeys: plan.rowPlans.map((row) => row.rowKey),
    parameters: plan.parameters,
    summary,
    rows: summaries,
  };
  const artifactName = `discovery-ads-demand-${createdAt.replace(/[:.]/g, '-')}-${runId}.json`;
  writeFileSync(path.join(dir, 'candidates.csv'), rowsToDiscoveryRuntimeCsvFn(nextRows), 'utf8');
  writeFileSync(path.join(dir, artifactName), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  const metaPath = path.join(dir, 'meta.json');
  const currentMeta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const nextMeta = {
    ...currentMeta,
    updatedAt: new Date().toISOString(),
    lastPreHumanAdsDemand: { at: createdAt, runId, artifact: artifactName, planToken: plan.planToken, ...summary },
    files: { ...(currentMeta.files || {}), lastPreHumanAdsDemand: artifactName },
  };
  writeFileSync(metaPath, `${JSON.stringify(nextMeta, null, 2)}\n`, 'utf8');
  return { batch: nextMeta, rows: nextRows, artifact, plan };
}

export function startSelectiveAdsDemand(batchData, options = {}) {
  const plan = buildSelectiveAdsPlan({ ...batchData, indices: options.indices, root: options.root, rowKeyFn: options.rowKeyFn });
  validateToken(plan, options.expectedPlanToken);
  if (planUsesDefaultProvider(plan, options.dependencies || {})) {
    ((options.dependencies || {}).requireCredentialsFn || requireCredentials)();
  }
  const job = {
    id: randomUUID(), batchId: batchData.batch.id, status: 'running', total: plan.rowPlans.length,
    done: 0, currentRowKey: null, relatedKeywordCalls: 0, searchVolumeCalls: 0,
    adsLocationLoaderInvocations: 0, result: null, error: null,
    startedAt: new Date().toISOString(), finishedAt: null,
  };
  jobs.set(job.id, job);
  Promise.resolve().then(async () => {
    try {
      job.result = await executeSelectiveAdsDemand(batchData, {
        ...options,
        preparedPlan: plan,
        onProgress: (progress) => {
          job.done = progress.done;
          job.currentRowKey = progress.rowKey;
          Object.assign(job, progress.counters);
        },
      });
      const summary = job.result.artifact.summary;
      Object.assign(job, {
        done: job.total,
        relatedKeywordCalls: summary.relatedKeywordCalls,
        searchVolumeCalls: summary.searchVolumeCalls,
        adsLocationLoaderInvocations: summary.adsLocationLoaderInvocations,
        status: summary.partialRows || summary.providerErrors ? 'partial' : 'ok',
      });
    } catch (error) {
      job.status = 'error';
      job.error = error.message;
    } finally {
      job.currentRowKey = null;
      job.finishedAt = new Date().toISOString();
    }
  });
  return job;
}

export function getSelectiveAdsDemandJob(id) {
  return jobs.get(id) || null;
}

export function currentAdsDemandHandoff(row, root = process.cwd()) {
  const authority = currentSeoClusterAuthority(row);
  if (!authority.usable) return null;
  const signature = buildAdsDemandSignature({ row, adsCluster: authority.adsCluster, relatedLimit: 10 });
  const evidence = parseObject(row.adsDemandEvidence);
  if (!compactEvidenceMatchesRow(evidence, row, authority, signature) || !['complete', 'partial'].includes(evidence.status)) return null;
  const ref = String(row.adsResearchRef || evidence.researchRef || '').trim();
  const filePath = safePreHumanAdsPath(ref, root);
  const sidecar = readPreHumanAdsSidecar(ref, root);
  if (!filePath || !sidecarMatchesRow(sidecar, row, authority, signature)) return null;
  return { adsCluster: authority.adsCluster, preHumanAdsRef: ref, adsDemandSignature: signature, sidecar };
}

export function currentAdsDemandDisplay(row) {
  const authority = currentSeoClusterAuthority(row);
  const evidence = parseObject(row?.adsDemandEvidence);
  if (!evidence) return { status: 'not_researched', current: false, evidence: null };
  if (!authority.usable) return { status: 'stale', current: false, evidence };
  const signature = buildAdsDemandSignature({ row, adsCluster: authority.adsCluster, relatedLimit: 10 });
  return compactEvidenceMatchesRow(evidence, row, authority, signature)
    ? { status: evidence.status, current: true, evidence }
    : { status: 'stale', current: false, evidence };
}
