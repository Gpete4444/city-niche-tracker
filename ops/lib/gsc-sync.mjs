/**
 * Sync Google Search Console traffic metrics onto site-metrics files.
 */
import { registrableDomain } from '../../scripts/lib/dataforseo.mjs';
import { gscFetch, getGscAuthStatus } from './gsc-oauth.mjs';
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

function hostFromSite(site) {
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

/**
 * Pick best GSC property for a host from listSites response.
 */
export function matchGscProperty(host, siteEntryList) {
  if (!host) return null;
  const h = host.toLowerCase().replace(/^www\./, '');
  const entries = siteEntryList || [];

  const domainProp = entries.find(
    (e) => String(e.siteUrl || '').toLowerCase() === `sc-domain:${h}`,
  );
  if (domainProp) return domainProp.siteUrl;

  const httpsWww = entries.find((e) => {
    const u = String(e.siteUrl || '').toLowerCase();
    return u === `https://www.${h}/` || u === `https://${h}/`;
  });
  if (httpsWww) return httpsWww.siteUrl;

  const any = entries.find((e) => {
    const u = String(e.siteUrl || '').toLowerCase();
    return u.includes(h);
  });
  return any?.siteUrl || null;
}

export async function listGscProperties() {
  const json = await gscFetch('/sites');
  return Array.isArray(json?.siteEntry) ? json.siteEntry : [];
}

async function querySearchAnalytics(propertyUrl, { startDate, endDate, dimensions = [] }) {
  const encoded = encodeURIComponent(propertyUrl);
  return gscFetch(`/sites/${encoded}/searchAnalytics/query`, {
    method: 'POST',
    body: {
      startDate,
      endDate,
      dimensions,
      rowLimit: dimensions.includes('date') ? 500 : 25,
    },
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
 * Sync one site. Returns metrics summary fields.
 */
export async function syncSiteGsc(siteId, { properties = null } = {}) {
  const site = getSite(siteId);
  const host = hostFromSite(site);
  if (!host) {
    throw Object.assign(new Error('Site has no domain'), { status: 400 });
  }

  const props = properties || (await listGscProperties());
  const propertyUrl = matchGscProperty(host, props);
  const metrics = ensureSiteMetrics(siteId, { domain: host });

  if (!propertyUrl) {
    metrics.gsc.syncError = `No GSC property matched for ${host}. Verify Domain property under the connected Google account.`;
    metrics.gsc.lastSyncAt = new Date().toISOString();
    saveSiteMetrics(metrics);
    return { ok: false, siteId, error: metrics.gsc.syncError, metrics };
  }

  try {
    const win28 = trailingWindow(28);
    const win90 = trailingWindow(90);

    const [agg28, byDate] = await Promise.all([
      querySearchAnalytics(propertyUrl, { ...win28, dimensions: [] }),
      querySearchAnalytics(propertyUrl, { ...win90, dimensions: ['date'] }),
    ]);

    const totals = sumRows(agg28?.rows);
    const daily = (byDate?.rows || []).map((row) => ({
      date: String(row.keys?.[0] || '').slice(0, 10),
      clicks: Number(row.clicks) || 0,
      impressions: Number(row.impressions) || 0,
    }));

    metrics.domain = host;
    metrics.gsc.propertyUrl = propertyUrl;
    metrics.gsc.clicks28d = totals.clicks;
    metrics.gsc.impressions28d = totals.impressions;
    metrics.gsc.ctr28d = totals.ctr;
    metrics.gsc.avgPosition28d =
      totals.avgPosition == null ? null : Math.round(totals.avgPosition * 10) / 10;
    metrics.gsc.daily = trimDailySeries(daily);
    metrics.gsc.lastSyncAt = new Date().toISOString();
    metrics.gsc.syncError = null;
    saveSiteMetrics(metrics);
    return { ok: true, siteId, propertyUrl, metrics };
  } catch (error) {
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
