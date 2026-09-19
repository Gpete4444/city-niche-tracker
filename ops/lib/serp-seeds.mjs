/**
 * Cheap SERP seeds for the required Research path (no Ads volumes).
 * Prefers a fresh Discovery Light SERP cache; otherwise the caller starts
 * research-candidate --skip-volumes (~$0.002).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  classifiedToResearchSerp,
  isSerpCacheFresh,
  readSerpCache,
} from '../../scripts/lib/serp-cache.mjs';
import {
  buildResearchScoring,
  stageOneSoftnessInputs,
} from '../../scripts/lib/scoring.mjs';
import { enrichClassifiedSerp } from '../../scripts/lib/serp-signals.mjs';
import { normalizeCityStateCluster, parseCityStateToken } from './city-state.mjs';
import { pathsFor } from './candidates.mjs';
import { resolveEstimatedVolumeForSeed } from '../../scripts/lib/estimated-volume.mjs';

const ROOT = process.cwd();

function writeJson(filePath, data) {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function googleSearchLink(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function parsePrimary(config) {
  const parsed = parseCityStateToken(config?.primary);
  if (!parsed) return null;
  return { city: parsed.city, state: parsed.state };
}

export function researchHasSerpSeeds(research) {
  const serp = research?.serp;
  if (!serp || typeof serp !== 'object') return false;
  return (
    serp.mapPackPresent != null ||
    serp.organicHomePages != null ||
    serp.organicSubPages != null ||
    (Array.isArray(serp.organicTitles) && serp.organicTitles.length > 0) ||
    (Array.isArray(serp.peopleAlsoAskQuestions) && serp.peopleAlsoAskQuestions.length > 0)
  );
}

function resolveCachePath(config) {
  const rel = String(config?.serpCache || '').trim();
  if (!rel) return '';
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  return existsSync(abs) ? abs : '';
}

function loadDiscoverySeed(candidateId) {
  const seedPath = pathsFor(candidateId).discoverySeed;
  if (!existsSync(seedPath)) return null;
  try {
    const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
    return seed && typeof seed === 'object' ? seed : null;
  } catch {
    return null;
  }
}

function buildHydratedReport({ config, cache, cachePath, estimatedVolume = null }) {
  const primary = parsePrimary(config);
  if (!primary) {
    throw Object.assign(new Error('Config primary must look like "City,ST"'), { status: 400 });
  }
  const niche = String(config.niche || '').trim();
  if (!niche) {
    throw Object.assign(new Error('Config niche is required'), { status: 400 });
  }
  const clusterLabels = normalizeCityStateCluster(config.cluster, primary.state);
  const allCities = [
    `${primary.city}, ${primary.state}`,
    ...clusterLabels.filter((label) => {
      const p = parseCityStateToken(label);
      return p && !(p.city === primary.city && p.state === primary.state);
    }),
  ];
  const query = `${niche} ${primary.city} ${primary.state}`;
  let classified = enrichClassifiedSerp(cache.classified, {
    niche,
    itemTypes: cache.itemTypes || [],
    items: cache.items || [],
  });
  const softness = stageOneSoftnessInputs(classified);
  const estimate =
    estimatedVolume?.value != null && Number.isFinite(Number(estimatedVolume.value))
      ? Number(estimatedVolume.value)
      : null;
  const scoring = buildResearchScoring({
    clusterVolumeSum: null,
    primaryVolumeSum: null,
    volumesSkipped: true,
    estimatedDemandVolume: estimate,
    mapPackPresent: classified.mapPackPresent,
    classifiedSerp: classified,
    softnessUniqueOrganicDomainCount: softness.uniqueOrganicDomainCount,
    softnessOrganicHomePageCount: softness.organicHomePageCount,
  });
  const cacheRel = path.relative(ROOT, cachePath).replace(/\\/g, '/');
  return {
    generatedAt: new Date().toISOString(),
    source: 'discovery_cache',
    serpHydratedFrom: 'discovery_cache',
    niche,
    primaryCity: primary.city,
    state: primary.state,
    cityCluster: allCities,
    googleSearchQuery: query,
    googleSearchLink: googleSearchLink(query),
    dataForSeoCheckUrl: cache.checkUrl || null,
    serpLocation: null,
    serpLocationFallback: null,
    serp: classifiedToResearchSerp(classified, {
      itemTypes: cache.itemTypes || [],
      reusedFrom: { at: cache.at, cachePath: cacheRel },
    }),
    volumes: {
      mode: 'per_city_sum',
      adsMode: null,
      volumesSkipped: true,
      volumesSkippedReason: 'operator',
      primaryLocation: `${primary.city}, ${primary.state}`,
      requestedPrimaryLocation: `${primary.city}, ${primary.state}`,
      adsLocationFallback: null,
      primaryVolumeSum: null,
      clusterVolumeSum: null,
      demandVolumeSum: null,
      estimatedMonthlySearchVolume: estimate,
      estimatedMonthlySearchVolumeRaw: estimatedVolume?.raw ?? null,
      estimatedVolumeSource: estimate != null ? estimatedVolume?.source || 'discovery_claude' : null,
      suburbOverlapFactor: null,
      averageCpc: null,
      relatedIdeasFromPrimary: [],
      keywords: [],
      citiesMeasured: [],
      citiesWithoutAdsGeoTarget: [],
      byCity: [],
    },
    scoring,
    scoreInputs: scoring.scoreInputs,
    proposedScore: scoring.proposedScore ?? null,
    decision: scoring.decision ?? null,
    estimatedApiCostUsd: 0,
  };
}

/**
 * Sync hydrate from Discovery cache when possible.
 * @returns {{ ready: boolean, source?: string, reason?: string, research?: object }}
 */
export function ensureResearchSerpSeeds(candidateId) {
  const p = pathsFor(candidateId);
  const existing = existsSync(p.research) ? JSON.parse(readFileSync(p.research, 'utf8')) : null;
  if (researchHasSerpSeeds(existing)) {
    return { ready: true, source: 'existing', research: existing };
  }
  const config = existsSync(p.config) ? JSON.parse(readFileSync(p.config, 'utf8')) : null;
  if (!config) {
    return { ready: false, reason: 'no_config' };
  }
  const cachePath = resolveCachePath(config);
  if (!cachePath) {
    return { ready: false, reason: 'no_cache' };
  }
  const cache = readSerpCache(cachePath);
  if (!isSerpCacheFresh(cache)) {
    return { ready: false, reason: cache ? 'cache_stale' : 'cache_unreadable' };
  }
  if (!cache.classified) {
    return { ready: false, reason: 'cache_incomplete' };
  }
  const estimatedVolume = resolveEstimatedVolumeForSeed(loadDiscoverySeed(candidateId));
  const report = buildHydratedReport({ config, cache, cachePath, estimatedVolume });
  if (existing && typeof existing === 'object') {
    report.enrichment = existing.enrichment;
  }
  writeJson(p.research, report);
  return { ready: true, source: 'discovery_cache', research: report };
}
