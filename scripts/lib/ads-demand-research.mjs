import {
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  adsLocationName,
  loadAdsLocations,
  resolveAdsLocation,
} from './dataforseo.mjs';
import {
  fetchRelatedKeywords,
  fetchSearchVolumes,
  normalizeAdsMode,
} from './ads-volume.mjs';
import { averageKeywordCpc } from './serp-signals.mjs';

export const ADS_DEMAND_ENGINE_VERSION = 1;
export const ADS_KEYWORD_CONTRACT_VERSION = 'v1-seeds-related-limit-1';
export const ADS_INTENT_CLASSIFIER_VERSION = 1;

export function parseAdsCity(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const city = String(value.city || '').trim();
    const state = String(value.state || '').trim().toUpperCase();
    return city && /^[A-Z]{2}$/.test(state) ? { city, state } : null;
  }
  const match = String(value || '').trim().match(/^(.+),\s*([A-Za-z]{2})$/);
  return match ? { city: match[1].trim(), state: match[2].toUpperCase() } : null;
}

export function adsCityKey(value) {
  const place = parseAdsCity(value);
  return place ? `${place.city.toLowerCase()}|${place.state}` : '';
}

export function normalizeAdsCities(primary, cluster = [], { sortRelated = true } = {}) {
  const target = parseAdsCity(primary);
  if (!target) throw new Error('Primary Ads city must look like "City,ST"');
  const seen = new Set([adsCityKey(target)]);
  const related = [];
  for (const raw of Array.isArray(cluster) ? cluster : []) {
    const place = parseAdsCity(raw);
    const key = adsCityKey(place);
    if (!place || !key || seen.has(key)) continue;
    seen.add(key);
    related.push(place);
  }
  if (sortRelated) related.sort((left, right) => left.city.localeCompare(right.city) || left.state.localeCompare(right.state));
  return [target, ...related];
}

export function buildAdsKeywordSeeds(niche, primary, configuredSeeds = []) {
  const target = parseAdsCity(primary);
  const cleanNiche = String(niche || '').trim();
  const supplied = (Array.isArray(configuredSeeds) ? configuredSeeds : [])
    .map((seed) => String(seed || '').trim())
    .filter(Boolean);
  return supplied.length
    ? supplied
    : [cleanNiche.toLowerCase(), `${cleanNiche.toLowerCase()} ${target.city.toLowerCase()}`];
}

function sameStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => String(value) === String(right[index]));
}

export function adsDemandRowKey({ niche, primary } = {}) {
  const target = parseAdsCity(primary);
  return target
    ? [niche, target.city, target.state].map((value) => String(value || '').trim().toLowerCase()).join('|')
    : '';
}

export function isCanonicalAdsVolumes(volumes) {
  return Boolean(volumes)
    && volumes.mode === 'per_city_sum'
    && Number.isFinite(volumes.primaryVolumeSum)
    && Number.isFinite(volumes.clusterVolumeSum)
    && Array.isArray(volumes.relatedIdeasFromPrimary)
    && Array.isArray(volumes.keywords)
    && Array.isArray(volumes.citiesMeasured)
    && Array.isArray(volumes.citiesWithoutAdsGeoTarget)
    && Array.isArray(volumes.byCity);
}

export function adsDemandAuthorityMatches(authority, {
  signature,
  niche,
  primary,
  adsCluster = [],
  seeds = [],
  relatedLimit = 10,
  allowedStatuses = ['complete', 'partial'],
  requireEvidenceState = false,
} = {}) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) return false;
  const target = parseAdsCity(primary);
  if (!target || authority.signature !== signature) return false;
  if (Number(authority.version ?? authority.schemaVersion) !== ADS_DEMAND_ENGINE_VERSION) return false;
  if (authority.keywordContractVersion !== ADS_KEYWORD_CONTRACT_VERSION) return false;
  if (Number(authority.intentClassifierVersion) !== ADS_INTENT_CLASSIFIER_VERSION) return false;
  if (!allowedStatuses.includes(String(authority.status || ''))) return false;
  if (authority.status === 'complete' && 'volumes' in authority && !isCanonicalAdsVolumes(authority.volumes)) return false;
  if (authority.status === 'complete' && authority.relatedKeywords && authority.relatedKeywords.status !== 'complete') return false;
  if (requireEvidenceState) {
    if (!authority.relatedKeywords || typeof authority.relatedKeywords !== 'object') return false;
    if (!authority.geoStates || typeof authority.geoStates !== 'object' || Array.isArray(authority.geoStates)) return false;
    if (!Array.isArray(authority.unsupportedCities) || !Array.isArray(authority.failedGeos)) return false;
    if (authority.volumes != null && !isCanonicalAdsVolumes(authority.volumes)) return false;
    if (authority.status === 'complete' && authority.relatedKeywords.status !== 'complete') return false;
  }
  if (String(authority.niche || '').trim() !== String(niche || '').trim()) return false;
  if (String(authority.rowKey || '') !== adsDemandRowKey({ niche, primary: target })) return false;
  if (adsCityKey(authority.target) !== adsCityKey(target)) return false;
  let storedCluster;
  let expectedCluster;
  try {
    storedCluster = normalizeAdsCities(target, authority.adsCluster || []).slice(1).map((city) => `${city.city},${city.state}`);
    expectedCluster = normalizeAdsCities(target, adsCluster).slice(1).map((city) => `${city.city},${city.state}`);
  } catch {
    return false;
  }
  const expectedSeeds = buildAdsKeywordSeeds(niche, target, seeds);
  return sameStrings(storedCluster, expectedCluster)
    && sameStrings(authority.keywordConfiguration?.seeds, expectedSeeds)
    && Number(authority.keywordConfiguration?.relatedLimit) === Number(relatedLimit);
}

export function classifyAdsKeywordIntent(keyword) {
  const value = String(keyword || '').trim().toLowerCase();
  if (/\b(job|jobs|career|careers|salary|salaries|wage|wages|employment|vacancy|vacancies|hiring|apply)\b/.test(value)) {
    return 'EMPLOYMENT_IRRELEVANT';
  }
  if (/\b(near me|contractor|company|installer|service|quote|estimate|emergency|hire)\b/.test(value)) {
    return 'READY_TO_HIRE';
  }
  if (/\b(cost|price|pricing|reviews?|best|compare|comparison|financing|options?)\b/.test(value)) {
    return 'COMMERCIAL_RESEARCH';
  }
  if (/\b(how to|diy|do it yourself|guide|tutorial|what is|instructions|can i)\b/.test(value)) {
    return 'INFORMATIONAL';
  }
  return 'OTHER_NON_JOB';
}

function intentTotalsForVolume(volumes, field) {
  const totals = {
    rawVolume: 0,
    employmentIrrelevantVolume: 0,
    nonJobVolume: 0,
    readyToHireVolume: 0,
    commercialResearchVolume: 0,
    informationalVolume: 0,
    otherNonJobVolume: 0,
    diyHowToVolume: 0,
  };
  for (const keyword of volumes?.keywords || []) {
    const volume = Math.max(0, Number(keyword?.[field]) || 0);
    const intent = classifyAdsKeywordIntent(keyword.keyword);
    totals.rawVolume += volume;
    if (intent === 'EMPLOYMENT_IRRELEVANT') totals.employmentIrrelevantVolume += volume;
    else {
      totals.nonJobVolume += volume;
      if (intent === 'READY_TO_HIRE') totals.readyToHireVolume += volume;
      else if (intent === 'COMMERCIAL_RESEARCH') totals.commercialResearchVolume += volume;
      else if (intent === 'INFORMATIONAL') {
        totals.informationalVolume += volume;
        if (/\b(how to|diy|do it yourself)\b/i.test(keyword.keyword)) totals.diyHowToVolume += volume;
      } else totals.otherNonJobVolume += volume;
    }
  }
  const nonJob = totals.nonJobVolume;
  const raw = totals.rawVolume;
  totals.shares = {
    denominator: 'nonJobVolume',
    readyToHire: nonJob ? totals.readyToHireVolume / nonJob : 0,
    commercialResearch: nonJob ? totals.commercialResearchVolume / nonJob : 0,
    informational: nonJob ? totals.informationalVolume / nonJob : 0,
    otherNonJob: nonJob ? totals.otherNonJobVolume / nonJob : 0,
    employmentIrrelevantOfRaw: raw ? totals.employmentIrrelevantVolume / raw : 0,
  };
  return totals;
}

export function summarizeAdsIntent(volumes) {
  return {
    target: intentTotalsForVolume(volumes, 'primaryVolume'),
    cluster: intentTotalsForVolume(volumes, 'clusterSum'),
  };
}

export function selectCanonicalKeywords(seeds, relatedIdeas, relatedLimit) {
  const seedExtras = seeds.map((keyword) => ({
    keyword,
    searchVolume: null,
    competition: null,
    competitionIndex: null,
    cpc: null,
  }));
  const selected = [];
  const seen = new Set();
  for (const idea of [...seedExtras, ...(Array.isArray(relatedIdeas) ? relatedIdeas : [])]) {
    const keyword = String(idea?.keyword || '').trim();
    const key = keyword.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push({ ...idea, keyword });
  }
  return selected.slice(0, Math.max(0, Number(relatedLimit) || 0));
}

export function buildCanonicalVolumes({
  adsMode,
  primary,
  relatedIdeas,
  selectedKeywords,
  geoStates,
  unsupportedCities,
} = {}) {
  const target = parseAdsCity(primary);
  const completeGeos = Object.values(geoStates || {}).filter((geo) => geo.status === 'complete');
  const keywords = (selectedKeywords || []).map((idea) => {
    const perCity = {};
    let clusterSum = 0;
    let primaryVolume = null;
    for (const geo of completeGeos) {
      const result = geo.keywords?.[String(idea.keyword).toLowerCase()];
      const volume = result?.searchVolume ?? 0;
      perCity[`${geo.city}, ${geo.state}`] = volume;
      clusterSum += volume;
      if (adsCityKey(geo) === adsCityKey(target)) primaryVolume = volume;
    }
    return {
      keyword: idea.keyword,
      primaryVolume,
      clusterSum,
      perCity,
      competition: idea.competition ?? null,
      cpc: idea.cpc ?? null,
    };
  });
  const primaryVolumeSum = keywords.reduce((sum, keyword) => sum + (keyword.primaryVolume ?? 0), 0);
  const clusterVolumeSum = keywords.reduce((sum, keyword) => sum + (keyword.clusterSum ?? 0), 0);
  return {
    mode: 'per_city_sum',
    adsMode: normalizeAdsMode(adsMode),
    primaryLocation: adsLocationName(target.city, target.state),
    primaryVolumeSum,
    clusterVolumeSum,
    averageCpc: averageKeywordCpc(keywords),
    relatedIdeasFromPrimary: relatedIdeas || [],
    keywords,
    citiesMeasured: completeGeos.map((geo) => `${geo.city}, ${geo.state}`),
    citiesWithoutAdsGeoTarget: [...(unsupportedCities || [])],
    byCity: completeGeos.map((geo) => ({
      city: geo.city,
      state: geo.state,
      locationName: geo.locationName,
      locationCode: geo.locationCode,
      keywordVolumes: Object.fromEntries(
        Object.entries(geo.keywords || {}).map(([keyword, value]) => [keyword, value.searchVolume]),
      ),
    })),
  };
}

export function safePreHumanAdsPath(ref, root = process.cwd()) {
  const raw = String(ref || '').trim();
  if (!raw || path.isAbsolute(raw)) return null;
  const absolute = path.resolve(root, raw);
  const allowed = path.resolve(root, 'research', 'batches');
  const relative = path.relative(allowed, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (existsSync(absolute) && existsSync(allowed)) {
    try {
      const resolvedAllowed = realpathSync(allowed);
      const resolvedAbsolute = realpathSync(absolute);
      const resolvedRelative = path.relative(resolvedAllowed, resolvedAbsolute);
      if (!resolvedRelative || resolvedRelative.startsWith('..') || path.isAbsolute(resolvedRelative)) return null;
    } catch {
      return null;
    }
  }
  return absolute;
}

export function readPreHumanAdsSidecar(ref, root = process.cwd()) {
  const filePath = safePreHumanAdsPath(ref, root);
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writePreHumanAdsSidecar(ref, sidecar, root = process.cwd()) {
  const filePath = safePreHumanAdsPath(ref, root);
  if (!filePath || !existsSync(filePath)) throw new Error('Unsafe or missing pre-Human Ads sidecar reference');
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');
    renameSync(tempPath, filePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
  return filePath;
}

/**
 * The single V1 Ads-demand collector used by Discovery Package 4 and Stage 1.
 * A compatible priorState may be partial; successful logical operations are reused.
 */
export async function collectAdsDemand({
  niche,
  primary,
  adsCluster = [],
  seeds = [],
  relatedLimit = 10,
  adsMode = 'live',
  locations = null,
  priorState = null,
  reuseCompleteWithoutLocationLoad = false,
  preserveClusterOrder = false,
  dependencies = {},
  beforeOperation = null,
  onOperation = null,
} = {}) {
  const loadAdsLocationsFn = dependencies.loadAdsLocationsFn || loadAdsLocations;
  const resolveAdsLocationFn = dependencies.resolveAdsLocationFn || resolveAdsLocation;
  const fetchRelatedKeywordsFn = dependencies.fetchRelatedKeywordsFn || fetchRelatedKeywords;
  const fetchSearchVolumesFn = dependencies.fetchSearchVolumesFn || fetchSearchVolumes;
  const allCities = normalizeAdsCities(primary, adsCluster, { sortRelated: !preserveClusterOrder });
  const target = allCities[0];
  const normalizedMode = normalizeAdsMode(adsMode);
  const keywordSeeds = buildAdsKeywordSeeds(niche, target, seeds);
  const authorityFields = {
    version: ADS_DEMAND_ENGINE_VERSION,
    keywordContractVersion: ADS_KEYWORD_CONTRACT_VERSION,
    intentClassifierVersion: ADS_INTENT_CLASSIFIER_VERSION,
    niche: String(niche || '').trim(),
    target,
    adsCluster: allCities.slice(1).map((city) => `${city.city},${city.state}`),
    keywordConfiguration: { seeds: keywordSeeds, relatedLimit, adsMode: normalizedMode },
  };
  const telemetry = {
    adsLocationLoaderInvocations: 0,
    adsLocationProviderRequestsMax: 0,
    relatedKeywordCalls: 0,
    searchVolumeCalls: 0,
    newProviderCostUsd: 0,
    historicalEvidenceCostUsd: Number(priorState?.provider?.totalEvidenceAcquisitionCostUsd) || 0,
  };
  if (
    reuseCompleteWithoutLocationLoad
    && priorState?.status === 'complete'
    && priorState?.relatedKeywords?.status === 'complete'
    && priorState?.volumes
  ) {
    return {
      ...priorState,
      provider: {
        ...telemetry,
        historicalEvidenceCostUsd: Number(priorState.provider?.totalEvidenceAcquisitionCostUsd) || 0,
        newProviderCostUsd: 0,
        totalEvidenceAcquisitionCostUsd: Number(priorState.provider?.totalEvidenceAcquisitionCostUsd) || 0,
      },
      reusedComplete: true,
    };
  }
  let adsLocations = locations;
  if (!Array.isArray(adsLocations)) {
    beforeOperation?.('ads_location_loader');
    telemetry.adsLocationLoaderInvocations += 1;
    telemetry.adsLocationProviderRequestsMax += 2;
    adsLocations = await loadAdsLocationsFn();
    onOperation?.('ads_location_loader');
  }

  const resolvedPrimary = resolveAdsLocationFn(adsLocations, target.city, target.state);
  if (!resolvedPrimary) {
    return {
      ...authorityFields,
      status: 'unsupported_primary_ads_geo',
      relatedKeywords: { status: 'pending', ideas: [], selectedKeywords: [] },
      geoStates: {
        [adsCityKey(target)]: { ...target, status: 'unsupported_ads_geo', locationName: null, locationCode: null },
      },
      unsupportedCities: [`${target.city}, ${target.state}`],
      failedGeos: [],
      volumes: null,
      provider: finalizeTelemetry(telemetry, priorState),
      errors: [],
    };
  }

  let relatedKeywords = priorState?.relatedKeywords?.status === 'complete'
    ? priorState.relatedKeywords
    : null;
  const errors = [];
  if (!relatedKeywords) {
    beforeOperation?.('related_keyword');
    telemetry.relatedKeywordCalls += 1;
    try {
      const response = await fetchRelatedKeywordsFn(
        keywordSeeds,
        resolvedPrimary.locationCode,
        Math.max(Number(relatedLimit) || 10, 5),
        { mode: normalizedMode },
      );
      telemetry.newProviderCostUsd += Number(response.cost) || 0;
      relatedKeywords = {
        status: 'complete',
        costUsd: Number(response.cost) || 0,
        ideas: response.ideas || [],
        selectedKeywords: selectCanonicalKeywords(keywordSeeds, response.ideas, relatedLimit),
      };
      onOperation?.('related_keyword');
    } catch (error) {
      relatedKeywords = { status: 'failed', ideas: [], selectedKeywords: [], error: error.message };
      errors.push({ operation: 'related_keywords', error: error.message });
    }
  }

  if (relatedKeywords.status !== 'complete') {
    return {
      ...authorityFields,
      status: 'partial',
      relatedKeywords,
      geoStates: priorState?.geoStates || {},
      unsupportedCities: priorState?.unsupportedCities || [],
      failedGeos: priorState?.failedGeos || [],
      volumes: priorState?.volumes || null,
      provider: finalizeTelemetry(telemetry, priorState),
      errors,
    };
  }

  const selectedKeywords = relatedKeywords.selectedKeywords;
  const geoStates = {};
  const unsupportedCities = [];
  const failedGeos = [];
  for (const place of allCities) {
    const key = adsCityKey(place);
    const resolved = resolveAdsLocationFn(adsLocations, place.city, place.state);
    if (!resolved) {
      geoStates[key] = { ...place, status: 'unsupported_ads_geo', locationName: null, locationCode: null };
      unsupportedCities.push(`${place.city}, ${place.state}`);
      continue;
    }
    const priorGeo = priorState?.geoStates?.[key];
    if (
      priorGeo?.status === 'complete'
      && String(priorGeo.locationCode) === String(resolved.locationCode)
      && priorGeo.keywords
    ) {
      geoStates[key] = priorGeo;
      continue;
    }
    beforeOperation?.('search_volume', { place, resolved });
    telemetry.searchVolumeCalls += 1;
    try {
      const response = await fetchSearchVolumesFn(
        selectedKeywords.map((keyword) => keyword.keyword),
        resolved.locationCode,
        { mode: normalizedMode },
      );
      telemetry.newProviderCostUsd += Number(response.cost) || 0;
      geoStates[key] = {
        ...place,
        status: 'complete',
        locationName: resolved.locationName,
        locationCode: resolved.locationCode,
        costUsd: Number(response.cost) || 0,
        keywords: response.byKeyword || {},
      };
      onOperation?.('search_volume', { place, resolved });
    } catch (error) {
      geoStates[key] = {
        ...place,
        status: 'failed',
        locationName: resolved.locationName,
        locationCode: resolved.locationCode,
        error: error.message,
      };
      failedGeos.push({
        city: place.city,
        state: place.state,
        locationName: resolved.locationName,
        locationCode: resolved.locationCode,
        error: error.message,
        retryable: true,
      });
      errors.push({ operation: 'search_volume', city: place.city, state: place.state, error: error.message });
    }
  }

  const volumes = buildCanonicalVolumes({
    adsMode: normalizedMode,
    primary: target,
    relatedIdeas: relatedKeywords.ideas,
    selectedKeywords,
    geoStates,
    unsupportedCities,
  });
  const status = failedGeos.length ? 'partial' : 'complete';
  return {
    ...authorityFields,
    status,
    relatedKeywords,
    geoStates,
    unsupportedCities,
    failedGeos,
    volumes,
    provider: finalizeTelemetry(telemetry, priorState),
    errors,
  };
}

function finalizeTelemetry(telemetry, priorState) {
  const historical = Number(priorState?.provider?.totalEvidenceAcquisitionCostUsd)
    || Number(priorState?.provider?.newProviderCostUsd)
    || 0;
  return {
    ...telemetry,
    historicalEvidenceCostUsd: historical,
    newProviderCostUsd: Number(telemetry.newProviderCostUsd.toFixed(6)),
    totalEvidenceAcquisitionCostUsd: Number((historical + telemetry.newProviderCostUsd).toFixed(6)),
  };
}
