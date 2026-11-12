/**
 * GSC URL Inspection of sitemap URLs — Launched “Check index”.
 * Not the Pages / Coverage report (those totals have no API).
 */
import { GSC_AUTH_REVOKED, gscInspectIndex, getGscAuthStatus } from './gsc-oauth.mjs';
import { loadSiteContentFiles } from './site-inventory.mjs';
import {
  hostFromSite,
  isGscPropertyUnverified,
  listGscProperties,
  matchGscPropertyEntry,
} from './gsc-sync.mjs';
import { ensureSiteMetrics, saveSiteMetrics } from './site-metrics.mjs';
import { getSite } from './sites.mjs';

export const INSPECT_PASS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SITEMAP_FETCH_TIMEOUT_MS = 15_000;

let indexCheckCancelGen = 0;

/** Stop in-flight Check index runs before their next sitemap URL. */
export function bumpIndexCheckCancel() {
  indexCheckCancelGen += 1;
  return indexCheckCancelGen;
}

export function indexCheckCancelToken() {
  return indexCheckCancelGen;
}

const CONTENT_REL_RE = /^src\/content\/(pages|services|locations)\/([^/]+)\.mdx?$/i;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function parseSitemapLocs(xml) {
  const text = String(xml || '');
  const locs = [];
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(text))) {
    const loc = decodeXml(String(m[1] || '').trim());
    if (loc) locs.push(loc);
  }
  const isIndex = /<sitemapindex[\s>]/i.test(text);
  return { locs, isIndex };
}

function decodeXml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/** Markdown collection file → site pathname (trailing slash, home is `/`). */
export function markdownRelToPathname(rel) {
  const n = String(rel || '').replace(/\\/g, '/');
  const m = n.match(CONTENT_REL_RE);
  if (!m) return null;
  const coll = m[1].toLowerCase();
  const slug = String(m[2] || '').replace(/\.(md|mdx)$/i, '');
  if (!slug) return null;
  if (coll === 'pages') {
    if (slug === 'index' || slug === 'home') return '/';
    return `/${slug}/`;
  }
  return `/${coll}/${slug}/`;
}

export function fallbackSitemapUrls(files, host) {
  const h = String(host || '')
    .toLowerCase()
    .replace(/^www\./, '');
  if (!h) return [];
  const urls = new Set();
  for (const rel of Object.keys(files || {})) {
    const pathname = markdownRelToPathname(rel);
    if (!pathname) continue;
    urls.add(`https://${h}${pathname}`);
  }
  urls.add(`https://${h}/privacy/`);
  return [...urls].sort();
}

function isHttpPageUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return false;
    if (/\.xml$/i.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

function urlMatchesHost(url, host) {
  try {
    const uh = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    return uh === String(host || '').toLowerCase();
  } catch {
    return false;
  }
}

export function filterSitemapPageUrls(locs, host) {
  const seen = new Set();
  const out = [];
  for (const loc of locs || []) {
    const url = String(loc || '').trim();
    if (!isHttpPageUrl(url) || !urlMatchesHost(url, host)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

async function fetchSitemapXml(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/xml,text/xml,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(SITEMAP_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Sitemap ${res.status} for ${url}`), { status: res.status });
  }
  return res.text();
}

export async function fetchSitemapPageUrls(host) {
  const h = String(host || '')
    .toLowerCase()
    .replace(/^www\./, '');
  if (!h) return [];
  const origin = `https://${h}`;
  const root = `${origin}/sitemap.xml`;
  const xml = await fetchSitemapXml(root);
  const parsed = parseSitemapLocs(xml);
  let locs = parsed.locs.map((loc) => {
    try {
      return new URL(loc, origin).href;
    } catch {
      return loc;
    }
  });
  if (parsed.isIndex) {
    const nested = [];
    for (const child of locs) {
      // eslint-disable-next-line no-await-in-loop
      const childXml = await fetchSitemapXml(child);
      nested.push(
        ...parseSitemapLocs(childXml).locs.map((loc) => {
          try {
            return new URL(loc, origin).href;
          } catch {
            return loc;
          }
        }),
      );
    }
    locs = nested;
  }
  return filterSitemapPageUrls(locs, h);
}

export function isInspectIndexed(inspectionJson) {
  const status = inspectionJson?.inspectionResult?.indexStatusResult || {};
  if (String(status.verdict || '').toUpperCase() === 'PASS') return true;
  const cov = String(status.coverageState || '').toLowerCase();
  if (!cov) return false;
  if (cov.includes('not indexed')) return false;
  return cov.includes('indexed') || cov.includes('url is on google');
}

export function shouldReuseCachedPass(entry, now = Date.now(), ttlMs = INSPECT_PASS_TTL_MS) {
  if (!entry?.indexed) return false;
  const at = Date.parse(entry.inspectedAt);
  if (!Number.isFinite(at)) return false;
  return now - at < ttlMs;
}

export function rollupInspectByUrl(inspectByUrl, sitemapUrls) {
  const urls = Array.isArray(sitemapUrls) ? sitemapUrls : [];
  let indexed = 0;
  for (const url of urls) {
    if (inspectByUrl?.[url]?.indexed) indexed += 1;
  }
  const submitted = urls.length;
  return {
    inspectIndexed: submitted ? indexed : 0,
    inspectSubmitted: submitted,
    inspectNotIndexed: Math.max(0, submitted - indexed),
  };
}

function retryDelayMs(error, attempt) {
  const raw = error?.retryAfter;
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum >= 0) return Math.min(asNum * 1000, 60_000);
  return Math.min(1000 * 2 ** attempt, 30_000);
}

/** 429, 5xx, and Google INTERNAL — retry; 400/403/404 are permanent. */
export function isRetryableInspectError(error) {
  if (!error || error.code === GSC_AUTH_REVOKED) return false;
  const status = Number(error.status);
  if (status === 429 || (status >= 500 && status <= 504)) return true;
  const gStatus = String(error.details?.error?.status || error.details?.error || '').toUpperCase();
  if (gStatus === 'INTERNAL' || gStatus === 'UNAVAILABLE' || gStatus === 'RESOURCE_EXHAUSTED') {
    return true;
  }
  return /\bINTERNAL\b|\bUNAVAILABLE\b/i.test(String(error.message || ''));
}

async function inspectUrlWithRetry(inspectionUrl, siteUrl, { maxAttempts = 5 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await gscInspectIndex({ inspectionUrl, siteUrl });
    } catch (error) {
      if (error?.code === GSC_AUTH_REVOKED) throw error;
      lastError = error;
      if (!isRetryableInspectError(error) || attempt === maxAttempts - 1) throw error;
      // eslint-disable-next-line no-await-in-loop
      await sleep(retryDelayMs(error, attempt));
    }
  }
  throw lastError || new Error(`URL Inspection failed for ${inspectionUrl}`);
}

function pruneInspectByUrl(prev, sitemapUrls) {
  const keep = new Set(sitemapUrls);
  const next = {};
  for (const [url, entry] of Object.entries(prev || {})) {
    if (keep.has(url)) next[url] = entry;
  }
  return next;
}

/**
 * Inspect sitemap URLs for one launched site. Skips recent PASS cache (7d).
 */
export async function inspectSiteIndex(siteId, { properties = null, now = Date.now() } = {}) {
  const status = getGscAuthStatus();
  if (!status.connected) {
    throw Object.assign(new Error('GSC not connected — use Connect GSC on Launched'), { status: 401 });
  }

  const site = getSite(siteId);
  const host = hostFromSite(site);
  if (!host) {
    throw Object.assign(new Error('Site has no domain'), { status: 400 });
  }

  const props = properties || (await listGscProperties());
  const entry = matchGscPropertyEntry(host, props);
  const propertyUrl = entry?.siteUrl || null;
  const metrics = ensureSiteMetrics(siteId, { domain: host });
  metrics.domain = host;

  const fail = (message) => {
    metrics.gsc.inspectError = message;
    metrics.gsc.inspectCheckedAt = new Date(now).toISOString();
    saveSiteMetrics(metrics);
    return { ok: false, siteId, error: message, metrics };
  };

  if (!propertyUrl) {
    return fail(`No GSC property matched for ${host}. Verify Domain property under the connected Google account.`);
  }
  if (isGscPropertyUnverified(entry)) {
    return fail(`GSC property for ${host} is not verified yet`);
  }

  metrics.gsc.propertyUrl = propertyUrl;

  let sitemapUrls = [];
  let sitemapError = null;
  try {
    sitemapUrls = await fetchSitemapPageUrls(host);
  } catch (error) {
    sitemapError = error.message || String(error);
  }
  if (!sitemapUrls.length) {
    const { files } = loadSiteContentFiles(site);
    sitemapUrls = fallbackSitemapUrls(files, host);
  }
  if (!sitemapUrls.length) {
    return fail(sitemapError || `No sitemap URLs found for ${host}`);
  }

  const prev = pruneInspectByUrl(metrics.gsc.inspectByUrl, sitemapUrls);
  const nextByUrl = { ...prev };
  let cached = 0;
  let fetched = 0;
  const errors = [];
  const cancelToken = indexCheckCancelToken();
  let stopped = false;

  for (const url of sitemapUrls) {
    if (indexCheckCancelToken() !== cancelToken) {
      stopped = true;
      break;
    }
    if (shouldReuseCachedPass(prev[url], now)) {
      nextByUrl[url] = prev[url];
      cached += 1;
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const json = await inspectUrlWithRetry(url, propertyUrl);
      fetched += 1;
      const indexed = isInspectIndexed(json);
      const statusResult = json?.inspectionResult?.indexStatusResult || {};
      nextByUrl[url] = {
        indexed,
        verdict: statusResult.verdict || null,
        coverageState: statusResult.coverageState || null,
        inspectedAt: new Date(now).toISOString(),
      };
    } catch (error) {
      if (error?.code === GSC_AUTH_REVOKED) throw error;
      errors.push(`${url}: ${error.message || error}`);
      nextByUrl[url] = {
        indexed: false,
        verdict: null,
        coverageState: null,
        inspectedAt: new Date(now).toISOString(),
        error: error.message || String(error),
      };
    }
  }

  const rollup = rollupInspectByUrl(nextByUrl, sitemapUrls);
  metrics.gsc.inspectByUrl = nextByUrl;
  metrics.gsc.inspectIndexed = rollup.inspectIndexed;
  metrics.gsc.inspectSubmitted = rollup.inspectSubmitted;
  metrics.gsc.inspectNotIndexed = rollup.inspectNotIndexed;
  metrics.gsc.inspectCheckedAt = new Date(now).toISOString();
  metrics.gsc.inspectError = errors.length ? errors[0] : null;
  saveSiteMetrics(metrics);

  return {
    ok: true,
    siteId,
    propertyUrl,
    inspectIndexed: rollup.inspectIndexed,
    inspectSubmitted: rollup.inspectSubmitted,
    inspectNotIndexed: rollup.inspectNotIndexed,
    inspectCached: cached,
    inspectFetched: fetched,
    sitemapSource: sitemapError ? 'fallback' : 'live',
    error: metrics.gsc.inspectError,
    stopped,
    metrics,
  };
}
