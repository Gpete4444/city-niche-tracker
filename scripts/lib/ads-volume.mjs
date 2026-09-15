/**
 * Shared DataForSEO Google Ads keyword volume helpers (Stage 1).
 * Supports Live (fast) and Standard queue (cheaper, slower) modes.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { dataForSeoGet, dataForSeoRequest, taskResult } from './dataforseo.mjs';

/** Live search_volume / keywords_for_keywords estimate per task. */
export const ADS_SEARCH_VOLUME_LIVE_USD = 0.075;
/** Standard queue estimate per task. */
export const ADS_SEARCH_VOLUME_STANDARD_USD = 0.055;

/** @deprecated use ADS_SEARCH_VOLUME_LIVE_USD */
export const ADS_SEARCH_VOLUME_ESTIMATE_USD = ADS_SEARCH_VOLUME_LIVE_USD;

/** Stay under DataForSEO's 12 Live Google Ads requests/minute. */
export const ADS_LIVE_RPM_MAX = 10;
const ADS_LIVE_WINDOW_MS = 60_000;
const ADS_LIVE_LOCK_STALE_MS = 8_000;

const MAX_QUEUE_WAIT_MS = 2 * 60 * 60 * 1000; // 2h overnight batches
const POLL_START_MS = 5000;
const POLL_MAX_MS = 15000;

export function normalizeAdsMode(raw) {
  const m = String(raw || 'live')
    .trim()
    .toLowerCase();
  return m === 'standard' || m === 'queue' ? 'standard' : 'live';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireFileLock(lockPath, { sleepFn, nowFn, staleMs = ADS_LIVE_LOCK_STALE_MS }) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  for (;;) {
    try {
      return openSync(lockPath, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const st = statSync(lockPath);
        if (nowFn() - st.mtimeMs > staleMs) unlinkSync(lockPath);
      } catch {
        // lock disappeared
      }
      await sleepFn(40 + Math.random() * 80);
    }
  }
}

/**
 * Cross-process Live Ads slot (kfk + search_volume share 12 RPM).
 * Holds ~10 timestamps in a 60s window so parallel research children do not stampede.
 */
export async function acquireAdsLiveSlot({
  maxPerWindow = ADS_LIVE_RPM_MAX,
  windowMs = ADS_LIVE_WINDOW_MS,
  cacheDir = path.join(process.cwd(), '.cache'),
  now = Date.now,
  sleep: sleepFn = sleep,
} = {}) {
  const cachePath = path.join(cacheDir, 'dataforseo-ads-live-rpm.json');
  const lockPath = path.join(cacheDir, 'dataforseo-ads-live-rpm.lock');
  mkdirSync(cacheDir, { recursive: true });

  for (;;) {
    let fd = null;
    let released = false;
    const release = () => {
      if (fd == null) return;
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
      fd = null;
      try {
        unlinkSync(lockPath);
      } catch {
        /* ignore */
      }
      released = true;
    };
    try {
      fd = await acquireFileLock(lockPath, { sleepFn, nowFn: now });
      const nowMs = now();
      let stamps = [];
      if (existsSync(cachePath)) {
        try {
          const raw = JSON.parse(readFileSync(cachePath, 'utf8'));
          stamps = Array.isArray(raw?.at) ? raw.at.map(Number).filter(Number.isFinite) : [];
        } catch {
          stamps = [];
        }
      }
      stamps = stamps.filter((t) => nowMs - t < windowMs).sort((a, b) => a - b);
      if (stamps.length >= maxPerWindow) {
        const waitMs = Math.max(50, windowMs - (nowMs - stamps[0]) + 25);
        release();
        await sleepFn(waitMs);
        continue;
      }
      stamps.push(nowMs);
      writeFileSync(cachePath, JSON.stringify({ at: stamps }), 'utf8');
      return { count: stamps.length, windowMs };
    } finally {
      if (!released) {
        try {
          if (fd != null) closeSync(fd);
        } catch {
          /* ignore */
        }
        try {
          unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/**
 * POST task_post, then poll task_get until ready.
 * @param {string} basePath e.g. /keywords_data/google_ads/search_volume
 */
async function fetchAdsViaQueue(basePath, body, label) {
  const postJson = await dataForSeoRequest(`${basePath}/task_post`, body, { label: `${label}_post` });
  const postTask = postJson.tasks?.[0];
  if (!postTask?.id) {
    throw new Error(`${label}: task_post returned no task id`);
  }
  const postCost = Number(postTask.cost) || 0;
  // 20100 = Task Created — expected
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
    const getJson = await dataForSeoGet(`${basePath}/task_get/${taskId}`);
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
    // Still processing (e.g. 40601 Task Handed / 40602)
    if (task.status_code >= 40000 && task.status_code < 50000) {
      // 4xxxx that aren't "in progress" — fail
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

async function fetchAdsEndpoint(basePath, body, { mode = 'live', label = basePath } = {}) {
  const adsMode = normalizeAdsMode(mode);
  if (adsMode === 'standard') {
    return fetchAdsViaQueue(basePath, body, label);
  }
  await acquireAdsLiveSlot();
  const json = await dataForSeoRequest(`${basePath}/live`, body, { label, retries: 4 });
  const { result, cost } = taskResult(json, label);
  return { result: result ?? [], cost };
}

/**
 * Related keyword ideas for seeds at a Google Ads location.
 * @param {'live'|'standard'} [opts.mode]
 */
export async function fetchRelatedKeywords(seeds, locationCode, limit, { mode = 'live' } = {}) {
  const { result, cost } = await fetchAdsEndpoint(
    '/keywords_data/google_ads/keywords_for_keywords',
    {
      keywords: seeds.slice(0, 20),
      location_code: locationCode,
      language_code: 'en',
      sort_by: 'search_volume',
    },
    { mode, label: 'keywords_for_keywords' },
  );
  const rows = (result ?? [])
    .filter((row) => row?.keyword)
    .sort((a, b) => (b.search_volume ?? 0) - (a.search_volume ?? 0));

  return {
    cost,
    mode: normalizeAdsMode(mode),
    ideas: rows.slice(0, limit).map((row) => ({
      keyword: row.keyword,
      searchVolume: row.search_volume ?? null,
      competition: row.competition ?? null,
      competitionIndex: row.competition_index ?? null,
      cpc: row.cpc ?? null,
    })),
  };
}

/**
 * Search volumes for keywords at one Google Ads location_code.
 * Billed per task; Live ~$0.075–0.09, Standard ~$0.05–0.06.
 * @param {'live'|'standard'} [opts.mode]
 */
export async function fetchSearchVolumes(keywords, locationCode, { mode = 'live' } = {}) {
  const list = [...new Set((keywords || []).map((k) => String(k || '').trim()).filter(Boolean))];
  if (!list.length) {
    return { cost: 0, byKeyword: {}, mode: normalizeAdsMode(mode) };
  }
  const { result, cost } = await fetchAdsEndpoint(
    '/keywords_data/google_ads/search_volume',
    {
      keywords: list.slice(0, 1000),
      location_code: locationCode,
      language_code: 'en',
    },
    { mode, label: 'search_volume' },
  );
  const byKeyword = {};
  for (const row of result ?? []) {
    if (!row?.keyword) continue;
    byKeyword[row.keyword.toLowerCase()] = {
      keyword: row.keyword,
      searchVolume: row.search_volume ?? null,
      competition: row.competition ?? null,
      competitionIndex: row.competition_index ?? null,
      cpc: row.cpc ?? null,
      monthlySearches: row.monthly_searches ?? null,
    };
  }
  return { cost, byKeyword, mode: normalizeAdsMode(mode) };
}
