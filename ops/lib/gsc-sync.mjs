/**
 * Sync Google Search Console traffic metrics onto site-metrics files.
 */
import { registrableDomain } from '../../scripts/lib/dataforseo.mjs';
import { GSC_AUTH_REVOKED, gscFetch, getGscAuthStatus } from './gsc-oauth.mjs';
import {
  ensureSiteMetrics,
  metricsEligibleSites,
  saveSiteMetrics,
  trimDailySeries,
} from './site-metrics.mjs';
import { getSite } from './sites.mjs';

function isoDateUTC(d) {
  return d.toISOString().slice(0, 10);
}

function trailingWindow(days) {
  const end = new Date();
  // GSC data lags 1–3 days; end yesterday UTC
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { startDate: isoDateUTC(start), endDate: isoDateUTC(end) };
}

export function hostFromSite(site) {
  const raw = site?.domain || site?.liveUrl || '';
  if (!raw) return null;
  try {
    return registrableDomain(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return String(raw)
      .replace(/^www\./i, '')
      .toLowerCase();
  }
}

function normalizeHost(host) {
  return String(host || '')
    .toLowerCase()
    .replace(/^www\./, '');
}

/**
 * Exact Domain or URL-prefix property for a host (no substring fallback).
 */
export function matchGscPropertyEntry(host, siteEntryList) {
  if (!host) return null;
  const h = normalizeHost(host);
  const entries = siteEntryList || [];

  const domainProp = entries.find(
    (e) => String(e.siteUrl || '').toLowerCase() === `sc-domain:${h}`,
  );
  if (domainProp) return domainProp;

  return (
    entries.find((e) => {
      const u = String(e.siteUrl || '').toLowerCase();
      return u === `https://www.${h}/` || u === `https://${h}/`;
    }) || null
  );
}

/**
 * Pick best GSC property URL for a host from listSites response.
 */
export function matchGscProperty(host, siteEntryList) {
  return matchGscPropertyEntry(host, siteEntryList)?.siteUrl || null;
}

export function isGscPropertyUnverified(entry) {
  return String(entry?.permissionLevel || '') === 'siteUnverifiedUser';
}

export const GSC_QUERY_ROW_LIMIT = 100;
export const GSC_PAGE_ROW_LIMIT = 50;

/** Search Analytics POST body — omit empty dimensions (totals query). */
export function buildSearchAnalyticsQueryBody({ startDate, endDate, dimensions = [], rowLimit } = {}) {
  const body = { startDate, endDate };
  if (Array.isArray(dimensions) && dimensions.length) {
    body.dimensions = dimensions;
    if (rowLimit != null) body.rowLimit = rowLimit;
    else if (dimensions.includes('date')) body.rowLimit = 500;
    else if (dimensions.includes('query')) body.rowLimit = GSC_QUERY_ROW_LIMIT;
    else if (dimensions.includes('page')) body.rowLimit = GSC_PAGE_ROW_LIMIT;
    else body.rowLimit = 25;
  } else {
    body.rowLimit = rowLimit ?? 25;
  }
  return body;
}

const GSC_PROPERTIES_CACHE_MS = 60_000;
let gscPropertiesCache = null;
let gscPropertiesInFlight = null;

/** Property list shared by parallel Check index calls. Fresh for 60s; in-flight callers share one fetch. */
export async function listGscProperties() {
  const now = Date.now();
  if (gscPropertiesCache && now - gscPropertiesCache.at < GSC_PROPERTIES_CACHE_MS) {
    return gscPropertiesCache.entries;
  }
  if (!gscPropertiesInFlight) {
    gscPropertiesInFlight = gscFetch('/sites')
      .then((json) => {
        const entries = Array.isArray(json?.siteEntry) ? json.siteEntry : [];
        gscPropertiesCache = { at: Date.now(), entries };
        return entries;
      })
      .finally(() => {
        gscPropertiesInFlight = null;
      });
  }
  return gscPropertiesInFlight;
}

async function querySearchAnalytics(propertyUrl, { startDate, endDate, dimensions = [] }) {
  const encoded = encodeURIComponent(propertyUrl);
  return gscFetch(`/sites/${encoded}/searchAnalytics/query`, {
    method: 'POST',
    body: buildSearchAnalyticsQueryBody({ startDate, endDate, dimensions }),
  });
}

function sumRows(rows) {
  let clicks = 0;
  let impressions = 0;
  let posWeighted = 0;
  for (const row of rows || []) {
    const c = Number(row.clicks) || 0;
    const i = Number(row.impressions) || 0;
    clicks += c;
    impressions += i;
    posWeighted += (Number(row.position) || 0) * i;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    avgPosition: impressions > 0 ? posWeighted / impressions : null,
  };
}

/**
 * Map Search Analytics rows (one dimension) into stored query/page rows.
 * @param {Array<{ keys?: string[], clicks?: number, impressions?: number, ctr?: number, position?: number }>} rows
 * @param {'query' | 'page'} keyName
 */
export function mapAnalyticsDimensionRows(rows, keyName) {
  const out = [];
  for (const row of rows || []) {
    const key = String(row.keys?.[0] || '').trim();
    if (!key) continue;
    const clicks = Number(row.clicks) || 0;
    const impressions = Number(row.impressions) || 0;
    const position = Number(row.position);
    out.push({
      [keyName]: key,
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : Number(row.ctr) || 0,
      position: Number.isFinite(position) ? Math.round(position * 10) / 10 : null,
    });
  }
  return out;
}

/**
 * Sum GSC Sitemaps API `contents[].submitted` / `indexed` (web type).
 * `indexed` is deprecated and always 0 — stored for sync history, not shown as Indexed.
 */
export function summarizeSitemapIndex(sitemapsJson) {
  const list = Array.isArray(sitemapsJson?.sitemap) ? sitemapsJson.sitemap : [];
  let submitted = 0;
  let indexed = 0;
  let sitemapPath = null;
  for (const sm of list) {
    if (!sitemapPath && sm?.path) sitemapPath = String(sm.path);
    const contents = Array.isArray(sm?.contents) ? sm.contents : [];
    for (const c of contents) {
      const type = String(c?.type || 'web').toLowerCase();
      if (type !== 'web') continue;
      submitted += Number(c.submitted) || 0;
      indexed += Number(c.indexed) || 0;
    }
  }
  if (!list.length) {
    return {
      sitemapPath: null,
      sitemapSubmitted: null,
      sitemapIndexed: null,
      sitemapNotIndexed: null,
    };
  }
  return {
    sitemapPath,
    sitemapSubmitted: submitted,
    sitemapIndexed: indexed,
    sitemapNotIndexed: Math.max(0, submitted - indexed),
  };
}

async function listGscSitemaps(propertyUrl) {
  const encoded = encodeURIComponent(propertyUrl);
  return gscFetch(`/sites/${encoded}/sitemaps`);
}

/**
 * Sync one site. Returns metrics summary fields.
 */
export async function syncSiteGsc(siteId, { properties = null } = {}) {
  const site = getSite(siteId);
  const host = hostFromSite(site);
  if (!host) {
    throw Object.assign(new Error('Site has no domain'), { status: 400 });
  }

  const props = properties || (await listGscProperties());
  const entry = matchGscPropertyEntry(host, props);
  const propertyUrl = entry?.siteUrl || null;
  const metrics = ensureSiteMetrics(siteId, { domain: host });

  if (!propertyUrl) {
    metrics.gsc.syncError = `No GSC property matched for ${host}. Verify Domain property under the connected Google account.`;
    metrics.gsc.lastSyncAt = new Date().toISOString();
    saveSiteMetrics(metrics);
    return { ok: false, siteId, error: metrics.gsc.syncError, metrics };
  }

  if (isGscPropertyUnverified(entry)) {
    metrics.gsc.syncError = `GSC property for ${host} is not verified yet`;
    metrics.gsc.lastSyncAt = new Date().toISOString();
    saveSiteMetrics(metrics);
    return { ok: false, siteId, error: metrics.gsc.syncError, metrics };
  }

  try {
    const win28 = trailingWindow(28);
    const win90 = trailingWindow(90);

    const [agg28, byDate, byQuery, byPage, sitemaps] = await Promise.all([
      querySearchAnalytics(propertyUrl, { ...win28, dimensions: [] }),
      querySearchAnalytics(propertyUrl, { ...win90, dimensions: ['date'] }),
      querySearchAnalytics(propertyUrl, { ...win28, dimensions: ['query'] }),
      querySearchAnalytics(propertyUrl, { ...win28, dimensions: ['page'] }),
      listGscSitemaps(propertyUrl).catch(() => null),
    ]);

    const totals = sumRows(agg28?.rows);
    const daily = (byDate?.rows || []).map((row) => ({
      date: String(row.keys?.[0] || '').slice(0, 10),
      clicks: Number(row.clicks) || 0,
      impressions: Number(row.impressions) || 0,
    }));
    const sitemap = sitemaps ? summarizeSitemapIndex(sitemaps) : null;

    metrics.domain = host;
    metrics.gsc.propertyUrl = propertyUrl;
    metrics.gsc.clicks28d = totals.clicks;
    metrics.gsc.impressions28d = totals.impressions;
    metrics.gsc.ctr28d = totals.ctr;
    metrics.gsc.avgPosition28d =
      totals.avgPosition == null ? null : Math.round(totals.avgPosition * 10) / 10;
    metrics.gsc.daily = trimDailySeries(daily);
    metrics.gsc.topQueries = mapAnalyticsDimensionRows(byQuery?.rows, 'query');
    metrics.gsc.topPages = mapAnalyticsDimensionRows(byPage?.rows, 'page');
    if (sitemap) {
      metrics.gsc.sitemapPath = sitemap.sitemapPath;
      metrics.gsc.sitemapSubmitted = sitemap.sitemapSubmitted;
      metrics.gsc.sitemapIndexed = sitemap.sitemapIndexed;
      metrics.gsc.sitemapNotIndexed = sitemap.sitemapNotIndexed;
    }
    metrics.gsc.lastSyncAt = new Date().toISOString();
    metrics.gsc.syncError = null;
    saveSiteMetrics(metrics);
    return { ok: true, siteId, propertyUrl, metrics };
  } catch (error) {
    if (error?.code === GSC_AUTH_REVOKED) throw error;
    metrics.gsc.syncError = error.message || String(error);
    metrics.gsc.lastSyncAt = new Date().toISOString();
    saveSiteMetrics(metrics);
    return { ok: false, siteId, error: metrics.gsc.syncError, metrics };
  }
}

/**
 * Sync all eligible sites (live/listed/rented/building with domain).
 */
export async function syncAllSitesGsc({ siteIds = null } = {}) {
  const status = getGscAuthStatus();
  if (!status.connected) {
    throw Object.assign(new Error('GSC not connected'), { status: 401 });
  }

  let sites = metricsEligibleSites().filter((s) => hostFromSite(s));
  if (Array.isArray(siteIds) && siteIds.length) {
    const want = new Set(siteIds);
    sites = sites.filter((s) => want.has(s.id));
  }

  const properties = await listGscProperties();
  const results = [];
  for (const site of sites) {
    // Sequential to stay gentle on quota
    // eslint-disable-next-line no-await-in-loop
    const result = await syncSiteGsc(site.id, { properties });
    results.push({
      siteId: site.id,
      domain: hostFromSite(site),
      ok: result.ok,
      error: result.error || null,
      clicks28d: result.metrics?.gsc?.clicks28d ?? null,
      impressions28d: result.metrics?.gsc?.impressions28d ?? null,
    });
  }

  return {
    ok: true,
    synced: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    properties: properties.map((p) => p.siteUrl),
    results,
  };
}
