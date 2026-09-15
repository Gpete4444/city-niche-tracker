/**
 * Discovery DFS SERP probe — one organic live SERP per row (~$0.002).
 * Overwrites Map Pack + organic/directory counts; re-runs Recommend.
 * Supports async jobs with pollable progress.
 */

import { randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  loadEnvFile,
  loadSerpLocations,
  requireCredentials,
  resolveSerpTaskLocation,
} from '../../scripts/lib/dataforseo.mjs';
import {
  classifySerpItems,
  fetchOrganicSerp,
  linkListToCell,
} from '../../scripts/lib/serp-classify.mjs';
import { writeSerpCache } from '../../scripts/lib/serp-cache.mjs';
import { enrichClassifiedSerp } from '../../scripts/lib/serp-signals.mjs';
import { applyRecommendations } from './discovery-recommend.mjs';
import { emptyDiscoveryRowsHint, getBatch, rowKey, rowsToCsv } from './discovery.mjs';
import { getConcurrency } from './rover-concurrency.mjs';

loadEnvFile();

export const SERP_PROBE_ESTIMATE_USD = 0.002;

const probeJobs = new Map();

function writeBatchCsv(dir, _batch, rows) {
  writeFileSync(path.join(dir, 'candidates.csv'), rowsToCsv(rows), 'utf8');
}

/**
 * Cost preview for probing N rows.
 */
export function previewSerpProbe(batchId, { indices = null } = {}) {
  const { batch, rows } = getBatch(batchId);
  if (!rows.length) {
    const err = new Error(emptyDiscoveryRowsHint(batch));
    err.status = 400;
    throw err;
  }
  let targets = rows.map((_, i) => i);
  if (Array.isArray(indices) && indices.length) {
    targets = indices
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n >= 0 && n < rows.length);
  }
  const n = targets.length;
  const hasCreds = Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
  return {
    batchId: batch.id,
    rowCount: rows.length,
    probeCount: n,
    estimateUsdLow: Number((n * SERP_PROBE_ESTIMATE_USD).toFixed(4)),
    estimateUsdHigh: Number((n * SERP_PROBE_ESTIMATE_USD * 1.5).toFixed(4)),
    estimateLabel: `~$${(n * SERP_PROBE_ESTIMATE_USD).toFixed(3)}–$${(
      n *
      SERP_PROBE_ESTIMATE_USD *
      1.5
    ).toFixed(3)} for ${n} organic SERPs`,
    estimateDetail:
      'One DataForSEO Google organic live SERP per row (Map Pack + organic/directory counts). Volumes come from Stage 1.',
    hasDataForSeo: hasCreds,
    confirmLabel: hasCreds ? `Probe ${n} rows` : 'Cannot run — add DataForSEO credentials',
  };
}

function applySerpToRow(row, classified, checkUrl) {
  const next = { ...row };
  next['Map Pack'] = classified.mapPackPresent ? 'Yes' : 'No';
  next['Organic Home Page'] = String(classified.organicHomePages.count);
  next['Organic Sub Page'] = String(classified.organicSubPages.count);
  next.Directories = String(classified.directories.count);
  next['Organic Home Page (Links)'] = linkListToCell(classified.organicHomePages.links);
  next['Organic Sub Page (Links)'] = linkListToCell(classified.organicSubPages.links);
  next['Directories (Links)'] = linkListToCell(classified.directories.links);
  next.confidence_serp = 'high';
  next.serp_source = 'dataforseo';
  next.source_mode = row.source_mode || 'dfs_probe';
  if (classified.organicHomePages?.nicheRelevantCount != null) {
    next.organic_home_niche = String(classified.organicHomePages.nicheRelevantCount);
  }
  if (classified.organicSubPages?.nicheRelevantCount != null) {
    next.organic_sub_niche = String(classified.organicSubPages.nicheRelevantCount);
  }
  if (classified.mapPackReviews?.reviewsLabel) {
    next.map_pack_reviews = classified.mapPackReviews.reviewsLabel;
  } else if (classified.mapPackReviews?.avgReviews != null) {
    next.map_pack_avg_reviews = String(classified.mapPackReviews.avgReviews);
  }
  if (classified.features?.localServicesAds) {
    next.lsa_present = 'Yes';
  } else if (classified.features) {
    next.lsa_present = 'No';
  }
  if ((!next['Google Search Link'] || !String(next['Google Search Link']).trim()) && checkUrl) {
    next['Google Search Link'] = checkUrl;
  }
  if (!next['GBP Serves Location'] || !String(next['GBP Serves Location']).trim()) {
    next['GBP Serves Location'] = classified.mapPackPresent
      ? String(classified.localPack.length)
      : 'N/A';
  }
  return next;
}

function resolveTargets(rows, indices) {
  let targets = rows.map((_, i) => i);
  if (Array.isArray(indices) && indices.length) {
    targets = [...new Set(indices.map((n) => Number(n)).filter((n) => Number.isFinite(n)))].filter(
      (n) => n >= 0 && n < rows.length,
    );
  }
  return targets;
}

export function getSerpProbeJob(jobId) {
  return probeJobs.get(jobId) || null;
}

export function countRunningSerpProbes() {
  let n = 0;
  for (const job of probeJobs.values()) {
    if (job.status === 'running') n += 1;
  }
  return n;
}

export function assertLightSerpStartAllowed() {
  const limit = getConcurrency().lightSerp;
  const running = countRunningSerpProbes();
  if (running >= limit) {
    throw Object.assign(
      new Error(
        `Already ${running} Light SERP jobs running. Concurrent Limit for Light SERP is ${limit} — a soft limit so you do not spend too much money at once.`,
      ),
      {
        status: 409,
        code: 'LIGHT_SERP_CONCURRENCY',
        limit,
        running,
      },
    );
  }
}

/** Test-only: insert a dummy running probe so the extra-Run gate can be exercised. */
export function putRunningSerpProbeForTests() {
  const id = randomUUID();
  probeJobs.set(id, { id, status: 'running', batchId: '__test__' });
  return id;
}

/** Test-only. */
export function resetSerpProbesForTests() {
  probeJobs.clear();
}

/**
 * Start async probe; returns job immediately. Poll getSerpProbeJob / GET endpoint.
 */
export function startDiscoverySerpProbe(batchId, { indices = null } = {}) {
  requireCredentials();
  const { batch, rows, dir } = getBatch(batchId);
  if (!rows.length) {
    const err = new Error(emptyDiscoveryRowsHint(batch));
    err.status = 400;
    throw err;
  }
  const targets = resolveTargets(rows, indices);
  if (!targets.length) {
    const err = new Error('No rows to probe');
    err.status = 400;
    throw err;
  }
  assertLightSerpStartAllowed();

  const jobId = randomUUID();
  const job = {
    id: jobId,
    batchId,
    status: 'running',
    total: targets.length,
    done: 0,
    ok: 0,
    errors: 0,
    mapPackYes: 0,
    mapPackNo: 0,
    flipsToYes: 0,
    flipsToNo: 0,
    costUsd: 0,
    currentLabel: '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    results: [],
    batch: null,
    rows: null,
    probe: null,
  };
  probeJobs.set(jobId, job);

  const conc = getConcurrency().lightSerp;
  let nextRows = [...rows];
  let cursor = 0;

  (async () => {
    let serpLocations = [];
    try {
      serpLocations = await loadSerpLocations();
    } catch (error) {
      job.status = 'error';
      job.error = error.message || String(error);
      job.finishedAt = new Date().toISOString();
      return;
    }

    async function worker() {
      while (cursor < targets.length) {
        const i = targets[cursor];
        cursor += 1;
        const row = nextRows[i];
        const niche = String(row.Niche || '').trim();
        const city = String(row.City || '').trim();
        const state = String(row.State || '').trim().toUpperCase();
        const label = `${city}, ${state} · ${niche}`;
        job.currentLabel = label;

        if (!niche || !city || !state) {
          job.results.push({ index: i, ok: false, error: 'missing Niche/City/State', label });
          job.errors += 1;
          job.done += 1;
          continue;
        }
        const priorPack = String(row['Map Pack'] || '').trim().toLowerCase();
        const keyword = `${niche} ${city} ${state}`;
        const spec = resolveSerpTaskLocation(city, state, { locations: serpLocations });
        if (!spec) {
          job.results.push({ index: i, ok: false, error: `no SERP location for ${city}, ${state}`, label });
          job.errors += 1;
          job.done += 1;
          continue;
        }
        const locationName = spec.label;
        try {
          const raw = await fetchOrganicSerp(keyword, spec);
          job.costUsd = Number((job.costUsd + (Number(raw.cost) || 0)).toFixed(4));
          const classified = enrichClassifiedSerp(classifySerpItems(raw.items), {
            niche,
            itemTypes: raw.itemTypes,
            items: raw.items,
          });
          nextRows[i] = applySerpToRow(row, classified, raw.checkUrl);
          const key = rowKey(row);
          try {
            writeSerpCache(dir, key, {
              at: new Date().toISOString(),
              batchId,
              rowIndex: i,
              rowKey: key,
              keyword,
              locationName,
              cost: raw.cost,
              checkUrl: raw.checkUrl,
              endpoint: raw.endpoint,
              itemTypes: raw.itemTypes,
              items: raw.items,
              classified,
            });
          } catch (cacheErr) {
            console.error(`SERP cache write failed for ${label}: ${cacheErr.message}`);
          }
          if (classified.mapPackPresent) job.mapPackYes += 1;
          else job.mapPackNo += 1;
          if (priorPack === 'no' && classified.mapPackPresent) job.flipsToYes += 1;
          if (priorPack === 'yes' && !classified.mapPackPresent) job.flipsToNo += 1;
          job.results.push({
            index: i,
            ok: true,
            label,
            mapPack: classified.mapPackPresent ? 'Yes' : 'No',
            organicHome: classified.organicHomePages.count,
            costUsd: raw.cost,
          });
          job.ok += 1;
        } catch (error) {
          job.results.push({ index: i, ok: false, error: error.message, label });
          job.errors += 1;
        }
        job.done += 1;
      }
    }

    try {
      await Promise.all(Array.from({ length: conc }, () => worker()));
      nextRows = applyRecommendations(nextRows);
      writeBatchCsv(dir, batch, nextRows);

      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const probeFile = `discovery-serp-probe-${stamp}.csv`;
      writeFileSync(path.join(dir, probeFile), rowsToCsv(nextRows), 'utf8');

      const probeLog = {
        at: new Date().toISOString(),
        probed: targets.length,
        ok: job.ok,
        errors: job.errors,
        mapPackYes: job.mapPackYes,
        mapPackNo: job.mapPackNo,
        flipsToYes: job.flipsToYes,
        flipsToNo: job.flipsToNo,
        costUsd: job.costUsd,
        results: job.results,
      };

      const metaPath = path.join(dir, 'meta.json');
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      const nextMeta = {
        ...meta,
        updatedAt: new Date().toISOString(),
        stage: 'discovery_serp_probed',
        lastSerpProbe: probeLog,
        files: {
          ...(meta.files || {}),
          candidates: 'candidates.csv',
          lastSerpProbe: probeFile,
        },
      };
      writeFileSync(metaPath, `${JSON.stringify(nextMeta, null, 2)}\n`, 'utf8');

      job.batch = nextMeta;
      job.rows = nextRows;
      job.probe = probeLog;
      job.status = job.errors && !job.ok ? 'error' : job.errors ? 'partial' : 'ok';
      job.finishedAt = new Date().toISOString();
      job.currentLabel = '';
    } catch (error) {
      job.status = 'error';
      job.error = error.message;
      job.finishedAt = new Date().toISOString();
    }
  })();

  return job;
}

/** Blocking run (tests / legacy). */
export async function runDiscoverySerpProbe(batchId, opts = {}) {
  const job = startDiscoverySerpProbe(batchId, opts);
  while (job.status === 'running') {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (job.status === 'error' && !job.probe) {
    const err = new Error(job.error || 'SERP probe failed');
    err.status = 500;
    throw err;
  }
  return { batch: job.batch, rows: job.rows, probe: job.probe };
}

/** Derive sidebar step completion for a batch + rows. */
export function discoveryStepStatus(batch, rows = []) {
  const hasRows = (rows?.length || 0) > 0;
  const hasClaude =
    hasRows || Boolean(batch?.files?.lastImport) || Boolean(batch?.files?.claudeCsv && batch?.rowCount);
  const probed =
    Boolean(batch?.lastSerpProbe) ||
    (hasRows && rows.some((r) => String(r.serp_source || '').includes('dataforseo')));
  const hasDecisions =
    hasRows && rows.some((r) => String(r.human_decision || '').trim() !== '');
  const processed =
    batch?.stage === 'discovery_processed' || Boolean(batch?.lastProcess);

  return {
    pack: Boolean(batch?.id),
    claude: hasClaude,
    enrich: probed,
    serpProbe: probed,
    decisions: hasDecisions,
    processed,
  };
}
