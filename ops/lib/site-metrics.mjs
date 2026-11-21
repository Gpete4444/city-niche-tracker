/**
 * Per-site GSC traffic + keyword rank history.
 * Storage: research/site-metrics/{siteId}.json (research/ is gitignored).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RESEARCH_DIR } from './candidates.mjs';
import { siteContentInventory } from './site-inventory.mjs';
import { listLaunchedSites } from './sites.mjs';
import { windowTotalsFromDaily } from './site-series.mjs';

export const SITE_METRICS_DIR = path.join(RESEARCH_DIR, 'site-metrics');
export const MAX_RANK_KEYWORDS = 5;
export const GSC_DAILY_RETENTION_DAYS = 120;
export const RANK_HISTORY_RETENTION = 104; // ~2 years weekly

function ensureDir() {
  mkdirSync(SITE_METRICS_DIR, { recursive: true });
}

function metricsPath(siteId) {
  return path.join(SITE_METRICS_DIR, `${siteId}.json`);
}

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir();
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

export function emptyGscBlock() {
  return {
    propertyUrl: null,
    clicks28d: null,
    impressions28d: null,
    ctr28d: null,
    avgPosition28d: null,
    lastSyncAt: null,
    syncError: null,
    daily: [],
    topQueries: [],
    topPages: [],
    sitemapPath: null,
    sitemapSubmitted: null,
    sitemapIndexed: null,
    sitemapNotIndexed: null,
    inspectByUrl: {},
    inspectIndexed: null,
    inspectSubmitted: null,
    inspectNotIndexed: null,
    inspectCheckedAt: null,
    inspectError: null,
    inspectHistory: [],
  };
}

export function emptyRanksBlock() {
  return {
    primaryPosition: null,
    primaryPage: null,
    primaryCheckedAt: null,
    lastCheckAt: null,
    syncError: null,
    byKeyword: {},
  };
}

export function defaultMetrics(siteId, partial = {}) {
  const gsc = { ...emptyGscBlock(), ...(partial.gsc || {}) };
  if (!gsc.inspectByUrl || typeof gsc.inspectByUrl !== 'object' || Array.isArray(gsc.inspectByUrl)) {
    gsc.inspectByUrl = {};
  }
  if (!Array.isArray(gsc.inspectHistory)) gsc.inspectHistory = [];
  return {
    version: 1,
    siteId,
    domain: partial.domain || null,
    updatedAt: partial.updatedAt || null,
    gsc,
    rankKeywords: Array.isArray(partial.rankKeywords) ? partial.rankKeywords : [],
    ranks: {
      ...emptyRanksBlock(),
      ...(partial.ranks || {}),
      byKeyword: {
        ...(emptyRanksBlock().byKeyword),
        ...((partial.ranks && partial.ranks.byKeyword) || {}),
      },
    },
  };
}

export function loadSiteMetrics(siteId) {
  const raw = readJson(metricsPath(siteId), null);
  if (!raw || typeof raw !== 'object') return null;
  return defaultMetrics(siteId, raw);
}

export function saveSiteMetrics(metrics) {
  if (!metrics?.siteId) throw new Error('siteId required');
  const next = defaultMetrics(metrics.siteId, metrics);
  next.updatedAt = nowIso();
  writeJson(metricsPath(metrics.siteId), next);
  return next;
}

export function ensureSiteMetrics(siteId, { domain = null } = {}) {
  const existing = loadSiteMetrics(siteId);
  if (existing) {
    if (domain && !existing.domain) {
      existing.domain = domain;
      return saveSiteMetrics(existing);
    }
    return existing;
  }
  return saveSiteMetrics(defaultMetrics(siteId, { domain }));
}

/** Trim daily series to retention window (newest last). */
export function trimDailySeries(daily, maxDays = GSC_DAILY_RETENTION_DAYS) {
  const rows = Array.isArray(daily) ? [...daily] : [];
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (rows.length <= maxDays) return rows;
  return rows.slice(rows.length - maxDays);
}

export function trimRankHistory(history, max = RANK_HISTORY_RETENTION) {
  const rows = Array.isArray(history) ? [...history] : [];
  rows.sort((a, b) => String(a.checkedAt).localeCompare(String(b.checkedAt)));
  if (rows.length <= max) return rows;
  return rows.slice(rows.length - max);
}

export function pageFromPosition(position) {
  if (position == null || !Number.isFinite(Number(position)) || Number(position) < 1) {
    return null;
  }
  return Math.ceil(Number(position) / 10);
}

/**
 * Auto primary keyword: `{niche} {city}` (city title-cased as stored).
 */
export function buildPrimaryKeyword(site) {
  const niche = String(site?.niche || '').trim();
  const city = String(site?.city || '').trim();
  if (!niche || !city) return null;
  return `${niche} ${city}`.replace(/\s+/g, ' ').trim();
}

/**
 * Ensure rankKeywords has a primary; fill from site niche+city when empty.
 * @returns {{ metrics, changed: boolean }}
 */
export function ensurePrimaryKeyword(metrics, site) {
  const next = defaultMetrics(metrics.siteId, metrics);
  let keywords = Array.isArray(next.rankKeywords) ? [...next.rankKeywords] : [];
  const primary = keywords.find((k) => k && k.isPrimary);
  const auto = buildPrimaryKeyword(site);
  let changed = false;

  if (!primary && auto) {
    keywords = [
      { keyword: auto, isPrimary: true, source: 'auto' },
      ...keywords.filter((k) => String(k.keyword || '').toLowerCase() !== auto.toLowerCase()),
    ];
    changed = true;
  } else if (primary && primary.source === 'auto' && auto && primary.keyword !== auto) {
    keywords = keywords.map((k) =>
      k.isPrimary ? { ...k, keyword: auto, source: 'auto' } : k,
    );
    changed = true;
  }

  // Cap + exactly one primary
  keywords = keywords.slice(0, MAX_RANK_KEYWORDS);
  const primaries = keywords.filter((k) => k.isPrimary);
  if (primaries.length > 1) {
    let seen = false;
    keywords = keywords.map((k) => {
      if (!k.isPrimary) return k;
      if (!seen) {
        seen = true;
        return k;
      }
      return { ...k, isPrimary: false };
    });
    changed = true;
  }

  next.rankKeywords = keywords;
  return { metrics: next, changed };
}

/**
 * Replace keyword list (≤5). Exactly one primary required after normalize.
 */
export function setRankKeywords(siteId, keywordsInput, site) {
  const metrics = ensureSiteMetrics(siteId, { domain: site?.domain || null });
  const cleaned = [];
  const seen = new Set();
  for (const raw of Array.isArray(keywordsInput) ? keywordsInput : []) {
    const keyword = String(raw?.keyword || raw || '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({
      keyword,
      isPrimary: Boolean(raw?.isPrimary),
      source: raw?.source === 'auto' ? 'auto' : 'manual',
    });
    if (cleaned.length >= MAX_RANK_KEYWORDS) break;
  }

  if (!cleaned.some((k) => k.isPrimary)) {
    const auto = buildPrimaryKeyword(site);
    if (auto && !cleaned.some((k) => k.keyword.toLowerCase() === auto.toLowerCase())) {
      cleaned.unshift({ keyword: auto, isPrimary: true, source: 'auto' });
    } else if (cleaned.length) {
      cleaned[0] = { ...cleaned[0], isPrimary: true };
    }
  } else {
    let seenPrimary = false;
    for (let i = 0; i < cleaned.length; i += 1) {
      if (!cleaned[i].isPrimary) continue;
      if (!seenPrimary) {
        seenPrimary = true;
      } else {
        cleaned[i] = { ...cleaned[i], isPrimary: false };
      }
    }
  }

  metrics.rankKeywords = cleaned.slice(0, MAX_RANK_KEYWORDS);
  return saveSiteMetrics(metrics);
}

/** Lightweight fields for Sites table / list API. */
export function metricsSummary(metrics) {
  if (!metrics) {
    return {
      clicks28d: null,
      impressions28d: null,
      ctr28d: null,
      avgPosition28d: null,
      gscLastSyncAt: null,
      gscSyncError: null,
      gscPropertyUrl: null,
      primaryPosition: null,
      primaryPage: null,
      primaryCheckedAt: null,
      lastRankCheckAt: null,
      rankSyncError: null,
      rankKeywords: [],
      sitemapIndexed: null,
      sitemapSubmitted: null,
      sitemapNotIndexed: null,
      inspectIndexed: null,
      inspectSubmitted: null,
      inspectNotIndexed: null,
      inspectCheckedAt: null,
      inspectError: null,
      clicks7d: null,
      impressions7d: null,
    };
  }
  const synced = Boolean(metrics.gsc?.lastSyncAt) && !metrics.gsc?.syncError;
  const week = synced ? windowTotalsFromDaily(metrics.gsc?.daily, 7) : { clicks: null, impressions: null };
  return {
    clicks28d: metrics.gsc?.clicks28d ?? null,
    impressions28d: metrics.gsc?.impressions28d ?? null,
    clicks7d: synced ? week.clicks : null,
    impressions7d: synced ? week.impressions : null,
    ctr28d: metrics.gsc?.ctr28d ?? null,
    avgPosition28d: metrics.gsc?.avgPosition28d ?? null,
    gscLastSyncAt: metrics.gsc?.lastSyncAt ?? null,
    gscSyncError: metrics.gsc?.syncError ?? null,
    gscPropertyUrl: metrics.gsc?.propertyUrl ?? null,
    primaryPosition: metrics.ranks?.primaryPosition ?? null,
    primaryPage: metrics.ranks?.primaryPage ?? null,
    primaryCheckedAt: metrics.ranks?.primaryCheckedAt ?? null,
    lastRankCheckAt: metrics.ranks?.lastCheckAt ?? null,
    rankSyncError: metrics.ranks?.syncError ?? null,
    rankKeywords: metrics.rankKeywords || [],
    sitemapIndexed: metrics.gsc?.sitemapIndexed ?? null,
    sitemapSubmitted: metrics.gsc?.sitemapSubmitted ?? null,
    sitemapNotIndexed: metrics.gsc?.sitemapNotIndexed ?? null,
    inspectIndexed: metrics.gsc?.inspectIndexed ?? null,
    inspectSubmitted: metrics.gsc?.inspectSubmitted ?? null,
    inspectNotIndexed: metrics.gsc?.inspectNotIndexed ?? null,
    inspectCheckedAt: metrics.gsc?.inspectCheckedAt ?? null,
    inspectError: metrics.gsc?.inspectError ?? null,
  };
}

export function attachMetricsToSites(sites) {
  return (sites || []).map((site) => {
    const metrics = loadSiteMetrics(site.id);
    const summary = metricsSummary(metrics);
    const inventory = siteContentInventory(site);
    return {
      ...site,
      ...summary,
      pageCount: inventory.pageCount,
      wordCount: inventory.wordCount,
      inventorySource: inventory.source,
      metrics: metrics || null,
    };
  });
}

export function portfolioTrafficSeries(sites) {
  const byDate = new Map();
  for (const site of sites || []) {
    const metrics = site.metrics || loadSiteMetrics(site.id);
    const daily = metrics?.gsc?.daily || [];
    for (const row of daily) {
      const date = String(row.date || '').slice(0, 10);
      if (!date) continue;
      const cur = byDate.get(date) || { date, clicks: 0, impressions: 0 };
      cur.clicks += Number(row.clicks) || 0;
      cur.impressions += Number(row.impressions) || 0;
      byDate.set(date, cur);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Portfolio primary-rank snapshot history: for each check date across sites,
 * % of sites with primary on page 1 (among sites that have a check that day or latest ≤ date).
 * Simpler MVP: latest primaryPage distribution + time series of page1 share from history points.
 */
export function portfolioRankSeries(sites) {
  const byDate = new Map(); // date -> { onPage1, ranked, totalChecks }
  for (const site of sites || []) {
    const metrics = site.metrics || loadSiteMetrics(site.id);
    const primary = (metrics?.rankKeywords || []).find((k) => k.isPrimary);
    if (!primary) continue;
    const hist = metrics?.ranks?.byKeyword?.[primary.keyword]?.history || [];
    for (const point of hist) {
      const date = String(point.checkedAt || '').slice(0, 10);
      if (!date) continue;
      const cur = byDate.get(date) || { date, onPage1: 0, checked: 0 };
      cur.checked += 1;
      if (point.page === 1) cur.onPage1 += 1;
      byDate.set(date, cur);
    }
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({
      date: row.date,
      page1Share: row.checked ? row.onPage1 / row.checked : null,
      onPage1: row.onPage1,
      checked: row.checked,
    }));
}

export function listAllMetricsFiles() {
  if (!existsSync(SITE_METRICS_DIR)) return [];
  return readdirSync(SITE_METRICS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

/** Launched portfolio rows that should sync GSC / rank metrics. */
export function metricsEligibleSites() {
  return listLaunchedSites().filter((s) =>
    ['live', 'listed', 'rented', 'building'].includes(String(s.status || '')),
  );
}
