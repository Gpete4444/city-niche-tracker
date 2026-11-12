/**
 * Weekly keyword rank checks via DataForSEO Google Organic SERP (Standard queue).
 */
import {
  dataForSeoGet,
  dataForSeoRequest,
  loadEnvFile,
  loadSerpLocations,
  registrableDomain,
  requireCredentials,
  resolveSerpTaskLocation,
  serpLocationPayload,
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
const TASK_POST_CHUNK = 100;
const TASK_GET_LIMIT = 8;
const READY_MISS_BEFORE_DIRECT = 3;
const IN_PROGRESS_TASK_CODES = new Set([40601, 40602, 40101, 40102, 40103]);

let rankBatchProgress = null;
let rankCheckCancelGen = 0;

/** Stop in-flight Check ranks runs before the next keyword post or poll wait. */
export function bumpRankCheckCancel() {
  rankCheckCancelGen += 1;
  return rankCheckCancelGen;
}

export function rankCheckCancelToken() {
  return rankCheckCancelGen;
}

function rankChecksCancelled(token) {
  return rankCheckCancelGen !== token;
}

export function getRankBatchProgress() {
  if (!rankBatchProgress) return { running: false };
  return { ...rankBatchProgress };
}

function patchRankBatchProgress(patch) {
  if (!rankBatchProgress) return;
  Object.assign(rankBatchProgress, patch);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function organicTaskPostFailure(task, label) {
  if (!task?.id) return `${label}: task_post returned no task id`;
  const code = Number(task.status_code);
  if (code === 20100 || code === 20000) return null;
  return `${label} task_post failed ${code}: ${task.status_message || 'unknown'}`;
}

/** One task_post for every keyword. Each task is created, or recorded as that keyword's error. */
async function postOrganicTasks(bodies, label) {
  const postJson = await dataForSeoRequest(`${SERP_BASE}/task_post`, bodies, {
    label: `${label}_post`,
  });
  const tasks = Array.isArray(postJson.tasks) ? postJson.tasks : [];
  return bodies.map((body, index) => {
    const tag = String(body?.tag ?? index);
    const task =
      tasks.find((row) => String(row?.data?.tag ?? row?.tag ?? '') === tag) || tasks[index];
    const error = organicTaskPostFailure(task, label);
    if (error) return { index, tag, error };
    return {
      index,
      tag,
      taskId: task.id,
      postCost: Number(task.cost) || 0,
      lastStatus: task.status_code,
    };
  });
}

function chunkList(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function mapPool(items, limit, fn) {
  if (!items.length) return [];
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function listReadyOrganicTaskIds() {
  const json = await dataForSeoGet(`${SERP_BASE}/tasks_ready`);
  const ids = [];
  for (const task of json.tasks || []) {
    for (const row of task.result || []) {
      if (row?.id) ids.push(String(row.id));
    }
  }
  return ids;
}

async function fetchOrganicJobs(jobs, label) {
  const rows = await mapPool(jobs, TASK_GET_LIMIT, async (job) => {
    try {
      return { job, outcome: await readOrganicTask(job, label) };
    } catch (error) {
      return { job, outcome: { error: error.message || String(error) } };
    }
  });
  const terminal = [];
  for (const row of rows) {
    if (row.outcome.pending) {
      row.job.lastStatus = row.outcome.lastStatus;
      continue;
    }
    terminal.push(row);
  }
  return terminal;
}

async function readOrganicTask(job, label) {
  const getJson = await dataForSeoGet(`${SERP_BASE}/task_get/advanced/${job.taskId}`);
  const task = getJson.tasks?.[0];
  if (!task) {
    return { error: `${label}: empty task_get for ${job.taskId}` };
  }
  const code = Number(task.status_code);
  if (code === 20000) {
    return {
      result: task.result ?? [],
      cost: job.postCost || Number(task.cost) || 0,
    };
  }
  if (code >= 40000 && code < 50000 && !IN_PROGRESS_TASK_CODES.has(code)) {
    return { error: `${label} task_get failed ${code}: ${task.status_message || ''}`.trim() };
  }
  if (code >= 50000) {
    return { error: `${label} task_get failed ${code}: ${task.status_message || ''}`.trim() };
  }
  return { pending: true, lastStatus: code };
}

/** Poll every posted task id on one shared timer until each is ready or the queue cap hits. */
async function pollOrganicTasks(jobs, label, { isCancelled } = {}) {
  const pending = jobs.map((job) => ({ ...job }));
  const finished = new Map();
  const started = Date.now();
  let wait = POLL_START_MS;
  while (pending.length && Date.now() - started < MAX_QUEUE_WAIT_MS) {
    if (isCancelled?.()) break;
    await sleep(wait);
    if (isCancelled?.()) break;
    const wave = await Promise.all(
      pending.map(async (job) => {
        try {
          return { job, outcome: await readOrganicTask(job, label) };
        } catch (error) {
          return { job, outcome: { error: error.message || String(error) } };
        }
      }),
    );
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const row = wave[i];
      if (row.outcome.pending) {
        pending[i].lastStatus = row.outcome.lastStatus;
        continue;
      }
      finished.set(row.job.index, row.outcome);
      pending.splice(i, 1);
    }
    wait = Math.min(POLL_MAX_MS, Math.round(wait * 1.25));
  }
  if (isCancelled?.()) return finished;
  const minutes = Math.round(MAX_QUEUE_WAIT_MS / 60000);
  for (const job of pending) {
    finished.set(job.index, {
      error: `${label}: standard queue timed out after ${minutes}m (last status ${job.lastStatus ?? 'n/a'})`,
    });
  }
  return finished;
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

async function locationSpecForSite(site, locations = null) {
  const city = String(site.city || '').trim();
  const state = String(site.state || '').trim().toUpperCase();
  if (!city || !state) {
    throw Object.assign(
      new Error('Site needs city + state for SERP location'),
      { status: 400 },
    );
  }
  const list = locations || (await loadSerpLocations());
  const spec = resolveSerpTaskLocation(city, state, { locations: list });
  if (!spec) {
    throw Object.assign(
      new Error(`No SERP location for ${city}, ${state}`),
      { status: 400 },
    );
  }
  return spec;
}

/**
 * Check all tracked keywords for one site (Standard queue, depth 20).
 * Keywords are posted together and polled on one timer.
 */
export async function checkSiteRanks(siteId, { depth = DEFAULT_DEPTH } = {}) {
  const cancelToken = rankCheckCancelToken();
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

  const locationSpec = await locationSpecForSite(site);
  const locationName = locationSpec.label;
  const checkedAt = new Date().toISOString();
  const label = `rank_${siteId}`;
  const locationPayload = serpLocationPayload(locationSpec);
  const bodies = keywords.map((entry, index) => ({
    keyword: entry.keyword,
    ...locationPayload,
    language_code: 'en',
    device: 'desktop',
    depth,
    tag: String(index),
  }));

  const finished = new Map();
  const cancelled = () => rankChecksCancelled(cancelToken);
  let stopped = cancelled();
  if (!stopped) {
    try {
      const posted = await postOrganicTasks(bodies, label);
      const queued = [];
      for (const job of posted) {
        if (job.error) finished.set(job.index, { error: job.error });
        else queued.push(job);
      }
      const polled = await pollOrganicTasks(queued, label, { isCancelled: cancelled });
      for (const [index, outcome] of polled) finished.set(index, outcome);
      stopped = cancelled();
    } catch (error) {
      const message = error.message || String(error);
      keywords.forEach((_, index) => finished.set(index, { error: message }));
    }
  }

  if (stopped && finished.size === 0) {
    return {
      ok: true,
      stopped: true,
      siteId,
      domain: host,
      costUsd: 0,
      keywords: [],
      metrics,
    };
  }

  return {
    ...commitRankCheck({
      metrics,
      host,
      keywords,
      locationName,
      checkedAt,
      finished,
      label,
      partial: stopped,
    }),
    stopped,
  };
}

function commitRankCheck({
  metrics,
  host,
  keywords,
  locationName,
  checkedAt,
  finished,
  label,
  partial = false,
}) {
  const keywordResults = [];
  let totalCost = 0;
  let lastError = null;
  for (let index = 0; index < keywords.length; index += 1) {
    const entry = keywords[index];
    const keyword = entry.keyword;
    if (partial && !finished.has(index)) continue;
    const outcome = finished.get(index) || { error: `${label}: missing task result` };
    if (outcome.error) {
      lastError = outcome.error;
      keywordResults.push({
        keyword,
        isPrimary: Boolean(entry.isPrimary),
        error: lastError,
      });
      continue;
    }
    const cost = Number(outcome.cost) || 0;
    totalCost += cost;
    const page = outcome.result?.[0] || {};
    const { position, urlMatched } = findDomainOrganicPosition(page.items || [], host);
    const pageNum = pageFromPosition(position);
    const point = {
      checkedAt,
      position,
      page: pageNum,
      urlMatched,
      serpLocation: locationName,
      costUsd: cost,
    };

    if (!metrics.ranks.byKeyword[keyword]) {
      metrics.ranks.byKeyword[keyword] = { history: [] };
    }
    metrics.ranks.byKeyword[keyword].history = trimRankHistory([
      ...(metrics.ranks.byKeyword[keyword].history || []),
      point,
    ]);

    if (entry.isPrimary) {
      metrics.ranks.primaryPosition = position;
      metrics.ranks.primaryPage = pageNum;
      metrics.ranks.primaryCheckedAt = checkedAt;
    }

    keywordResults.push({ keyword, isPrimary: Boolean(entry.isPrimary), ...point });
  }

  metrics.domain = host;
  metrics.ranks.lastCheckAt = checkedAt;
  metrics.ranks.syncError = lastError;
  const saved = saveSiteMetrics(metrics);
  return {
    ok: keywordResults.every((row) => !row.error),
    siteId: metrics.siteId,
    domain: host,
    costUsd: totalCost,
    keywords: keywordResults,
    metrics: saved,
    error: lastError,
    primaryPosition: saved.ranks?.primaryPosition ?? null,
    primaryPage: saved.ranks?.primaryPage ?? null,
  };
}

function rankResultRow(site, committed, error) {
  if (!committed) {
    return {
      siteId: site.id,
      domain: hostFromSite(site),
      ok: false,
      error: error || 'Rank check failed',
    };
  }
  return {
    siteId: site.id,
    domain: committed.domain,
    ok: Boolean(committed.ok),
    primaryPosition: committed.primaryPosition ?? null,
    primaryPage: committed.primaryPage ?? null,
    costUsd: committed.costUsd,
    error: committed.error || null,
  };
}

/**
 * Post every selected site's keywords, then collect them on one Standard-queue wait.
 */
export async function checkAllSiteRanks({ siteIds = null, depth = DEFAULT_DEPTH } = {}) {
  if (!Array.isArray(siteIds) || siteIds.length === 0) {
    return { ok: true, checked: 0, failed: 0, costUsd: 0, results: [] };
  }
  requireCredentials();
  if (rankBatchProgress?.running) {
    throw Object.assign(new Error('A rank check is already running'), { status: 409 });
  }

  const cancelToken = rankCheckCancelToken();
  const cancelled = () => rankChecksCancelled(cancelToken);
  const want = new Set(siteIds);
  const sites = metricsEligibleSites().filter((s) => hostFromSite(s) && want.has(s.id));

  const checkedAt = new Date().toISOString();
  rankBatchProgress = {
    running: true,
    keywordsTotal: 0,
    keywordsPosted: 0,
    keywordsReady: 0,
    sitesTotal: sites.length,
    sitesDone: 0,
  };

  try {
    const locations = await loadSerpLocations();
    const bundles = [];
    const results = [];
    const jobs = [];
    let tagSerial = 0;

    for (const site of sites) {
      const host = hostFromSite(site);
      let metrics = ensureSiteMetrics(site.id, { domain: host });
      const ensured = ensurePrimaryKeyword(metrics, site);
      metrics = ensured.metrics;
      if (ensured.changed) metrics = saveSiteMetrics(metrics);
      const keywords = metrics.rankKeywords || [];
      if (!keywords.length) {
        results.push(
          rankResultRow(site, null, 'No rank keywords — set niche+city or edit keywords on the site'),
        );
        patchRankBatchProgress({ sitesDone: rankBatchProgress.sitesDone + 1 });
        continue;
      }
      let locationSpec;
      try {
        locationSpec = await locationSpecForSite(site, locations);
      } catch (error) {
        results.push(rankResultRow(site, null, error.message || String(error)));
        patchRankBatchProgress({ sitesDone: rankBatchProgress.sitesDone + 1 });
        continue;
      }
      const bundle = {
        site,
        host,
        metrics,
        keywords,
        locationName: locationSpec.label,
        locationPayload: serpLocationPayload(locationSpec),
        finished: new Map(),
        label: `rank_${site.id}`,
      };
      bundles.push(bundle);
      keywords.forEach((entry, index) => {
        const tag = `k${tagSerial}`;
        tagSerial += 1;
        jobs.push({
          tag,
          siteId: site.id,
          keywordIndex: index,
          body: {
            keyword: entry.keyword,
            ...bundle.locationPayload,
            language_code: 'en',
            device: 'desktop',
            depth,
            tag,
          },
        });
      });
    }

    const bundleById = new Map(bundles.map((bundle) => [bundle.site.id, bundle]));
    patchRankBatchProgress({ keywordsTotal: jobs.length });

    const pending = [];
    const noteReady = (job, outcome) => {
      const bundle = bundleById.get(job.siteId);
      if (!bundle || bundle.finished.has(job.keywordIndex)) return;
      bundle.finished.set(job.keywordIndex, outcome);
      patchRankBatchProgress({ keywordsReady: rankBatchProgress.keywordsReady + 1 });
      if (bundle.finished.size < bundle.keywords.length) return;
      const committed = commitRankCheck({
        metrics: bundle.metrics,
        host: bundle.host,
        keywords: bundle.keywords,
        locationName: bundle.locationName,
        checkedAt,
        finished: bundle.finished,
        label: bundle.label,
      });
      results.push(rankResultRow(bundle.site, committed));
      bundle.saved = true;
      patchRankBatchProgress({ sitesDone: rankBatchProgress.sitesDone + 1 });
    };

    for (const chunk of chunkList(jobs, TASK_POST_CHUNK)) {
      if (cancelled()) break;
      try {
        const posted = await postOrganicTasks(
          chunk.map((job) => job.body),
          'rank_batch',
        );
        let accepted = 0;
        posted.forEach((row, index) => {
          const job = chunk[index];
          if (row.error || !row.taskId) {
            noteReady(job, { error: row.error || 'rank_batch: task_post returned no task id' });
            return;
          }
          accepted += 1;
          pending.push({
            ...job,
            taskId: row.taskId,
            postCost: row.postCost,
            lastStatus: row.lastStatus,
          });
        });
        patchRankBatchProgress({
          keywordsPosted: rankBatchProgress.keywordsPosted + accepted,
        });
      } catch (error) {
        const message = error.message || String(error);
        for (const job of chunk) noteReady(job, { error: message });
      }
    }

    const pendingById = new Map(pending.map((job) => [String(job.taskId), job]));
    const started = Date.now();
    let wait = POLL_START_MS;
    let readyMisses = 0;
    while (pendingById.size && Date.now() - started < MAX_QUEUE_WAIT_MS) {
      if (cancelled()) break;
      await sleep(wait);
      if (cancelled()) break;
      let ours = [];
      try {
        const readyIds = await listReadyOrganicTaskIds();
        const readySet = new Set(readyIds);
        ours = [...pendingById.values()].filter((job) => readySet.has(String(job.taskId)));
      } catch {
        ours = [];
      }
      if (ours.length) readyMisses = 0;
      else readyMisses += 1;
      const toFetch = ours.length
        ? ours
        : readyMisses >= READY_MISS_BEFORE_DIRECT
          ? [...pendingById.values()].slice(0, TASK_GET_LIMIT)
          : [];
      const terminal = await fetchOrganicJobs(toFetch, 'rank_batch');
      for (const row of terminal) {
        pendingById.delete(String(row.job.taskId));
        noteReady(row.job, row.outcome);
      }
      wait = Math.min(POLL_MAX_MS, Math.round(wait * 1.25));
    }

    const stopped = cancelled();
    if (!stopped) {
      const minutes = Math.round(MAX_QUEUE_WAIT_MS / 60000);
      for (const job of pendingById.values()) {
        noteReady(job, {
          error: `rank_batch: standard queue timed out after ${minutes}m (last status ${job.lastStatus ?? 'n/a'})`,
        });
      }
    }
    for (const bundle of bundles) {
      if (bundle.saved) continue;
      if (stopped && bundle.finished.size === 0) continue;
      const committed = commitRankCheck({
        metrics: bundle.metrics,
        host: bundle.host,
        keywords: bundle.keywords,
        locationName: bundle.locationName,
        checkedAt,
        finished: bundle.finished,
        label: bundle.label,
        partial: stopped,
      });
      results.push(rankResultRow(bundle.site, committed));
      patchRankBatchProgress({ sitesDone: rankBatchProgress.sitesDone + 1 });
    }

    const costUsd = results.reduce((sum, row) => sum + (Number(row.costUsd) || 0), 0);
    return {
      ok: true,
      stopped: cancelled(),
      checked: results.filter((row) => row.ok).length,
      failed: results.filter((row) => !row.ok).length,
      costUsd,
      results,
    };
  } finally {
    rankBatchProgress = null;
  }
}
