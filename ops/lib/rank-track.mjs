/**
 * Weekly keyword rank checks via DataForSEO Google Organic SERP (Standard queue).
 */
import {
  adsLocationName,
  dataForSeoGet,
  dataForSeoRequest,
  loadEnvFile,
  registrableDomain,
  requireCredentials,
} from '../../scripts/lib/dataforseo.mjs';
import {
  ensurePrimaryKeyword,
  ensureSiteMetrics,
  metricsEligibleSites,
  pageFromPosition,
  saveSiteMetrics,
  trimRankHistory,
} from './site-metrics.mjs';
import { getSite } from './sites.mjs';

loadEnvFile();

const SERP_BASE = '/serp/google/organic';
const MAX_QUEUE_WAIT_MS = 2 * 60 * 60 * 1000;
const POLL_START_MS = 5000;
const POLL_MAX_MS = 20000;
const DEFAULT_DEPTH = 20;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOrganicViaQueue(body, label = 'organic_serp') {
  const postJson = await dataForSeoRequest(`${SERP_BASE}/task_post`, body, {
    label: `${label}_post`,
  });
  const postTask = postJson.tasks?.[0];
  if (!postTask?.id) {
    throw new Error(`${label}: task_post returned no task id`);
  }
  const postCost = Number(postTask.cost) || 0;
  if (postTask.status_code !== 20100 && postTask.status_code !== 20000) {
    throw new Error(
      `${label} task_post failed ${postTask.status_code}: ${postTask.status_message}`,
    );
  }

  const taskId = postTask.id;
  const started = Date.now();
  let wait = POLL_START_MS;
  let lastStatus = postTask.status_code;

  while (Date.now() - started < MAX_QUEUE_WAIT_MS) {
    await sleep(wait);
    const getJson = await dataForSeoGet(`${SERP_BASE}/task_get/advanced/${taskId}`);
    const task = getJson.tasks?.[0];
    if (!task) {
      throw new Error(`${label}: empty task_get for ${taskId}`);
    }
    lastStatus = task.status_code;
    if (task.status_code === 20000) {
      return {
        result: task.result ?? [],
        cost: postCost || Number(task.cost) || 0,
      };
    }
    if (task.status_code >= 40000 && task.status_code < 50000) {
      const inProgress = [40601, 40602, 40101, 40102, 40103].includes(task.status_code);
      if (!inProgress) {
        throw new Error(`${label} task_get failed ${task.status_code}: ${task.status_message}`);
      }
    }
    if (task.status_code >= 50000) {
      throw new Error(`${label} task_get failed ${task.status_code}: ${task.status_message}`);
    }
    wait = Math.min(POLL_MAX_MS, Math.round(wait * 1.25));
  }

  throw new Error(
    `${label}: standard queue timed out after ${Math.round(MAX_QUEUE_WAIT_MS / 60000)}m (last status ${lastStatus})`,
  );
}

function hostFromSite(site) {
  const raw = site?.domain || site?.liveUrl || '';
  if (!raw) return null;
  return registrableDomain(raw.includes('://') ? raw : `https://${raw}`);
}

/**
 * Find 1-based organic position of our domain in SERP items.
 */
export function findDomainOrganicPosition(items, targetHost) {
  const target = String(targetHost || '')
    .toLowerCase()
    .replace(/^www\./, '');
  if (!target) return { position: null, urlMatched: null };

  let organicIndex = 0;
  for (const item of items || []) {
    if (item?.type !== 'organic') continue;
    organicIndex += 1;
    const domain = registrableDomain(item.domain || item.url || '');
    if (!domain) continue;
    if (domain === target || domain.endsWith(`.${target}`) || target.endsWith(`.${domain}`)) {
      const position =
        Number(item.rank_group) > 0
          ? Number(item.rank_group)
          : Number(item.rank_absolute) > 0
            ? Number(item.rank_absolute)
            : organicIndex;
      return {
        position,
        urlMatched: item.url || null,
      };
    }
  }
  return { position: null, urlMatched: null };
}

function locationNameForSite(site) {
  const city = String(site.city || '').trim();
  const state = String(site.state || '').trim().toUpperCase();
  if (!city || !state) {
    throw Object.assign(
      new Error('Site needs city + state for SERP location'),
      { status: 400 },
    );
  }
  return adsLocationName(city, state);
}

/**
 * Check all tracked keywords for one site (Standard queue, depth 20).
 */
export async function checkSiteRanks(siteId, { depth = DEFAULT_DEPTH } = {}) {
  requireCredentials();
  const site = getSite(siteId);
  const host = hostFromSite(site);
  if (!host) {
    throw Object.assign(new Error('Site has no domain'), { status: 400 });
  }

  let metrics = ensureSiteMetrics(siteId, { domain: host });
  const ensured = ensurePrimaryKeyword(metrics, site);
  metrics = ensured.metrics;
  if (ensured.changed) metrics = saveSiteMetrics(metrics);

  const keywords = metrics.rankKeywords || [];
  if (!keywords.length) {
    throw Object.assign(
      new Error('No rank keywords — set niche+city or edit keywords on the site'),
      { status: 400 },
    );
  }

  const locationName = locationNameForSite(site);
  const checkedAt = new Date().toISOString();
  const keywordResults = [];
  let totalCost = 0;
  let lastError = null;

  for (const entry of keywords) {
    const keyword = entry.keyword;
    try {
      // eslint-disable-next-line no-await-in-loop
      const { result, cost } = await fetchOrganicViaQueue(
        {
          keyword,
          location_name: locationName,
          language_code: 'en',
          device: 'desktop',
          depth,
        },
        `rank_${siteId}`,
      );
      totalCost += Number(cost) || 0;
      const page = result?.[0] || {};
      const { position, urlMatched } = findDomainOrganicPosition(page.items || [], host);
      const pageNum = pageFromPosition(position);
      const point = {
        checkedAt,
        position,
        page: pageNum,
        urlMatched,
        serpLocation: locationName,
        costUsd: Number(cost) || 0,
      };

      if (!metrics.ranks.byKeyword[keyword]) {
        metrics.ranks.byKeyword[keyword] = { history: [] };
      }
      const hist = trimRankHistory([
        ...(metrics.ranks.byKeyword[keyword].history || []),
        point,
      ]);
      metrics.ranks.byKeyword[keyword].history = hist;

      if (entry.isPrimary) {
        metrics.ranks.primaryPosition = position;
        metrics.ranks.primaryPage = pageNum;
        metrics.ranks.primaryCheckedAt = checkedAt;
      }

      keywordResults.push({ keyword, isPrimary: Boolean(entry.isPrimary), ...point });
    } catch (error) {
      lastError = error.message || String(error);
      keywordResults.push({
        keyword,
        isPrimary: Boolean(entry.isPrimary),
        error: lastError,
      });
    }
  }

  metrics.domain = host;
  metrics.ranks.lastCheckAt = checkedAt;
  metrics.ranks.syncError = lastError;
  saveSiteMetrics(metrics);

  return {
    ok: keywordResults.every((r) => !r.error),
    siteId,
    domain: host,
    costUsd: totalCost,
    keywords: keywordResults,
    metrics,
    error: lastError,
  };
}

/**
 * Rank-check all eligible sites with domains + niche/city (or existing keywords).
 */
export async function checkAllSiteRanks({ siteIds = null, depth = DEFAULT_DEPTH } = {}) {
  requireCredentials();
  let sites = metricsEligibleSites().filter((s) => hostFromSite(s));
  if (Array.isArray(siteIds) && siteIds.length) {
    const want = new Set(siteIds);
    sites = sites.filter((s) => want.has(s.id));
  }

  const results = [];
  let costUsd = 0;
  for (const site of sites) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await checkSiteRanks(site.id, { depth });
      costUsd += Number(result.costUsd) || 0;
      results.push({
        siteId: site.id,
        domain: result.domain,
        ok: Boolean(result.ok),
        primaryPosition: result.metrics?.ranks?.primaryPosition ?? null,
        primaryPage: result.metrics?.ranks?.primaryPage ?? null,
        costUsd: result.costUsd,
        error: result.error || null,
      });
    } catch (error) {
      results.push({
        siteId: site.id,
        domain: hostFromSite(site),
        ok: false,
        error: error.message || String(error),
      });
    }
  }

  return {
    ok: true,
    checked: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    costUsd,
    results,
  };
}
