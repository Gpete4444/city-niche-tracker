/**
 * Persist / reuse Discovery organic SERP so Stage 1 can skip a duplicate fetch.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const SERP_REUSE_MAX_AGE_DAYS = Number(process.env.OPS_SERP_REUSE_MAX_AGE_DAYS) || 14;

export function safeSerpCacheKey(rowKey) {
  return String(rowKey || 'row')
    .toLowerCase()
    .replace(/[^a-z0-9|_-]+/g, '-')
    .replace(/\|/g, '__')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'row';
}

export function serpCacheDir(batchDir) {
  return path.join(batchDir, 'serp-cache');
}

export function serpCachePath(batchDir, rowKey) {
  return path.join(serpCacheDir(batchDir), `${safeSerpCacheKey(rowKey)}.json`);
}

export function writeSerpCache(batchDir, rowKey, payload) {
  const dir = serpCacheDir(batchDir);
  mkdirSync(dir, { recursive: true });
  const filePath = serpCachePath(batchDir, rowKey);
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
}

export function readSerpCache(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function isSerpCacheFresh(cache, maxAgeDays = SERP_REUSE_MAX_AGE_DAYS) {
  if (!cache?.classified || !cache?.at) return false;
  const at = Date.parse(cache.at);
  if (!Number.isFinite(at)) return false;
  const maxMs = Math.max(1, Number(maxAgeDays) || SERP_REUSE_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;
  return Date.now() - at <= maxMs;
}

/**
 * Shape matching research.serp from classifySerpItems (+ serp-signals enrich).
 */
export function classifiedToResearchSerp(classified, { itemTypes = [], reusedFrom = null } = {}) {
  const home = classified.organicHomePages || {};
  const sub = classified.organicSubPages || {};
  return {
    mapPackPresent: classified.mapPackPresent,
    mapPackConfidence: 'high',
    localPack: classified.localPack || [],
    mapPackSlotCount: classified.mapPackSlotCount ?? (classified.localPack || []).length,
    mapPackWebsiteCount:
      classified.mapPackWebsiteCount ??
      (classified.localPack || []).filter((b) => b.hasWebsite ?? Boolean(b.url)).length,
    mapPackNoWebsiteCount:
      classified.mapPackNoWebsiteCount ??
      (classified.localPack || []).filter((b) => !(b.hasWebsite ?? Boolean(b.url))).length,
    mapPackReviews: classified.mapPackReviews || null,
    features: classified.features || null,
    directories: {
      count: classified.directories?.count ?? 0,
      links: classified.directories?.links ?? [],
    },
    organicHomePages: {
      count: home.count ?? 0,
      nicheRelevantCount: home.nicheRelevantCount ?? null,
      links: home.links ?? [],
    },
    organicSubPages: {
      count: sub.count ?? 0,
      nicheRelevantCount: sub.nicheRelevantCount ?? null,
      links: sub.links ?? [],
    },
    uniqueOrganicDomains: classified.uniqueOrganicDomains || [],
    uniqueNicheOrganicDomains: classified.uniqueNicheOrganicDomains || null,
    itemTypes: itemTypes.length ? itemTypes : classified.features?.itemTypes || [],
    paidAds: classified.paidAds || { count: 0, links: [] },
    peopleAlsoAskQuestions: classified.peopleAlsoAskQuestions || [],
    organicTitles: classified.organicTitles || [],
    ...(reusedFrom
      ? {
          reusedFromDiscovery: true,
          discoverySerpAt: reusedFrom.at || null,
          discoverySerpCache: reusedFrom.cachePath || null,
        }
      : {}),
  };
}
