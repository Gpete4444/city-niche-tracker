/**
 * Discovery DFS SERP probe — one organic live SERP per row (~$0.002).
 * Overwrites Map Pack + organic/directory counts; re-runs Recommend.
 * Supports async jobs with pollable progress.
 */

import { randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { adsLocationName, loadEnvFile, requireCredentials } from '../../scripts/lib/dataforseo.mjs';
import {
  classifySerpItems,
  fetchOrganicSerp,
  linkListToCell,
} from '../../scripts/lib/serp-classify.mjs';
import { writeSerpCache } from '../../scripts/lib/serp-cache.mjs';
import { enrichClassifiedSerp } from '../../scripts/lib/serp-signals.mjs';
import { applyRecommendations } from './discovery-recommend.mjs';
import { invalidateSeoClusterEvidenceForSerpKeys } from './discovery-seo-cluster.mjs';
import { evaluatePrimarySerpScreen } from './v15-primary-serp-screen.mjs';
import {
  getBatch,
  rowKey,
  rowsToDiscoveryRuntimeCsv,
} from './discovery.mjs';

loadEnvFile();

export const SERP_PROBE_ESTIMATE_USD = 0.002;

const probeJobs = new Map();

function writeBatchCsv(dir, _batch, rows) {
  writeFileSync(
    path.join(dir, 'candidates.csv'),
    rowsToDiscoveryRuntimeCsv(rows),
    'utf8',
  );
}

/**
 * Cost preview for probing N rows.
 */
export function previewSerpProbe(batchId, { indices = null } = {}) {
  const { batch, rows } = getBatch(batchId);
  if (!rows.length) {
    const err = new Error('Batch has no rows — import Claude CSV first');
    err.status = 400;
    throw err;
  }
  const requestedCount =
    Array.isArray(indices) && indices.length
      ? [...new Set(indices.map((value) => Number(value)).filter(Number.isFinite))]
          .filter((index) => index >= 0 && index < rows.length)
          .length
      : rows.length;

  const targets = resolveTargets(rows, indices);
  const populationSkippedCount = Math.max(0, requestedCount - targets.length);
  const n = targets.length;
  const hasCreds = Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
  return {
    batchId: batch.id,
    rowCount: rows.length,
    probeCount: n,
    populationSkippedCount,
    estimateUsdLow: Number((n * SERP_PROBE_ESTIMATE_USD).toFixed(4)),
    estimateUsdHigh: Number((n * SERP_PROBE_ESTIMATE_USD * 1.5).toFixed(4)),
    estimateLabel: `~$${(n * SERP_PROBE_ESTIMATE_USD).toFixed(3)}–$${(
      n *
      SERP_PROBE_ESTIMATE_USD *
      1.5
    ).toFixed(3)} for ${n} organic SERPs`,
    estimateDetail:
      `One DataForSEO Google organic live SERP per population-qualified row. ${
        populationSkippedCount
          ? `${populationSkippedCount} row(s) outside the population preference will be skipped. `
          : ''
      }Map Pack + organic/directory counts only. Volumes come from Stage 1.`,
    hasDataForSeo: hasCreds,
    confirmLabel: hasCreds ? `Probe ${n} rows` : 'Cannot run — add DataForSEO credentials',
  };
}

export function applySerpToRow(row, classified, checkUrl, { items = [] } = {}) {
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
  const screen = evaluatePrimarySerpScreen({ classified, rawItems: items });
  next.screenDecision = screen.screenDecision;
  next.screenRule = screen.screenRule;
  next.screenReason = screen.screenReason;
  next.screenUniqueOrganicDomainCount = screen.evidence.uniqueOrganicDomainCount;
  next.screenUniqueNicheOrganicDomainCount = screen.evidence.uniqueNicheOrganicDomainCount ?? '';
  next.screenMapPackPresent = screen.evidence.mapPackPresent;
  next.screenPaidPresent = screen.evidence.paidPresent;
  next.screenPaidCount = screen.evidence.paidCount;
  next.screenLsaPresent = screen.evidence.lsaPresent;
  next.screenOrganicHomePageCount = screen.evidence.organicHomePageCount;
  next.screenOrganicSubPageCount = screen.evidence.organicSubPageCount;
  next.screenDirectoryCount = screen.evidence.directoryCount;
  next.screenParameters = JSON.stringify(screen.parameters);
  return next;
}

function readPopulationContextForSerp(row) {
  const raw = String(row?.populationContext || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function isPopulationEligibleForSerp(row) {
  const context = readPopulationContextForSerp(row);

  // Backward compatibility: old batches without Package-2 context
  // remain probeable.
  if (!context) return true;

  return context.eligible !== false;
}

function resolveTargets(rows, indices) {
  let targets = rows.map((_, index) => index);

  if (Array.isArray(indices) && indices.length) {
    targets = [
      ...new Set(
        indices
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value)),
      ),
    ].filter((index) => index >= 0 && index < rows.length);
  }

  return targets.filter((index) => isPopulationEligibleForSerp(rows[index]));
}

export function getSerpProbeJob(jobId) {
  return probeJobs.get(jobId) || null;
}

/**
 * Start async probe; returns job immediately. Poll getSerpProbeJob / GET endpoint.
 */
export function startDiscoverySerpProbe(batchId, { indices = null, concurrency = 1 } = {}) {
  requireCredentials();
  const { batch, rows, dir } = getBatch(batchId);
  if (!rows.length) {
    const err = new Error('Batch has no rows — import Claude CSV first');
    err.status = 400;
    throw err;
  }
  const targets = resolveTargets(rows, indices);
  if (!targets.length) {
    const err = new Error('No rows to probe');
    err.status = 400;
    throw err;
  }

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

  const conc = Math.min(2, Math.max(1, Number(concurrency) || 1));
  let nextRows = [...rows];
  const changedSerpKeys = new Set();
  let cursor = 0;

  (async () => {
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
        let locationName;
        try {
          locationName = adsLocationName(city, state);
        } catch (error) {
          job.results.push({ index: i, ok: false, error: error.message, label });
          job.errors += 1;
          job.done += 1;
          continue;
        }
        try {
          const raw = await fetchOrganicSerp(keyword, locationName);
          job.costUsd = Number((job.costUsd + (Number(raw.cost) || 0)).toFixed(4));
          const classified = enrichClassifiedSerp(classifySerpItems(raw.items), {
            niche,
            itemTypes: raw.itemTypes,
            items: raw.items,
          });
          nextRows[i] = applySerpToRow(row, classified, raw.checkUrl, { items: raw.items });
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
            changedSerpKeys.add(key);
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
      nextRows = invalidateSeoClusterEvidenceForSerpKeys(nextRows, changedSerpKeys);
      nextRows = applyRecommendations(nextRows);
      writeBatchCsv(dir, batch, nextRows);

      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const probeFile = `discovery-serp-probe-${stamp}.csv`;
      writeFileSync(
        path.join(dir, probeFile),
        rowsToDiscoveryRuntimeCsv(nextRows),
        'utf8',
      );

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
