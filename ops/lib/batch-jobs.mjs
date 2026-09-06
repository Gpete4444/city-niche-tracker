/**
 * Batch job runner: the same act across many candidate IDs.
 * Parallel slots = stored Evaluations Concurrent Limit (Settings).
 * UI batches (`requireWithinLimit`) refuse more rows than the box.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  runResearch,
  runEnrich,
  runProspects,
  runNarrativeJob,
  getJob,
} from './run-script.mjs';
import {
  ensureConfigFromResearch,
  pathsFor,
  getCandidateDetail,
  RESEARCH_DIR,
} from './candidates.mjs';
import { assertEvalPrerequisite } from './candidate-protection.mjs';
import { getEvalConcurrency } from './eval-concurrency.mjs';

const batchJobs = new Map();
const JOBS_DIR = path.join(RESEARCH_DIR, '_jobs');

const STARTERS = {
  research: runResearchPrepared,
  enrich: runEnrichPrepared,
  prospects: runProspectsPrepared,
  narrative: runNarrativePrepared,
};

function runResearchPrepared(candidateId, opts = {}) {
  ensureConfigFromResearch(candidateId);
  const p = pathsFor(candidateId);
  if (!existsSync(p.config)) {
    throw new Error('No config — create candidate or add research/{id}.config.json');
  }
  return runResearch(candidateId, {
    adsMode: opts.adsMode,
    forceSerp: Boolean(opts.forceSerp),
    volumesOnly: Boolean(opts.volumesOnly),
  });
}

function runEnrichPrepared(candidateId) {
  assertEvalPrerequisite(candidateId, 'enrich');
  return runEnrich(candidateId);
}

function runProspectsPrepared(candidateId) {
  assertEvalPrerequisite(candidateId, 'prospects');
  return runProspects(candidateId);
}

function runNarrativePrepared(candidateId) {
  assertEvalPrerequisite(candidateId, 'narrative');
  return runNarrativeJob(candidateId);
}

function persistBatch(batch) {
  try {
    mkdirSync(JOBS_DIR, { recursive: true });
    const slim = {
      id: batch.id,
      act: batch.act,
      status: batch.status,
      concurrency: batch.concurrency,
      startedAt: batch.startedAt,
      finishedAt: batch.finishedAt,
      error: batch.error,
      done: batch.done,
      failed: batch.failed,
      running: batch.running,
      pending: batch.pending,
      children: batch.children.map((c) => ({
        candidateId: c.candidateId,
        jobId: c.jobId,
        status: c.status,
        error: c.error,
        costUsd: c.costUsd,
      })),
    };
    writeFileSync(path.join(JOBS_DIR, `${batch.id}.json`), `${JSON.stringify(slim, null, 2)}\n`, 'utf8');
  } catch {
    /* ignore persist errors */
  }
}

export function getBatchJob(batchJobId) {
  let batch = batchJobs.get(batchJobId);
  if (!batch) {
    const file = path.join(JOBS_DIR, `${batchJobId}.json`);
    if (existsSync(file)) {
      try {
        batch = JSON.parse(readFileSync(file, 'utf8'));
        batchJobs.set(batchJobId, batch);
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }
  refreshBatchJob(batch);
  return batch;
}

function refreshBatchJob(batch) {
  let done = 0;
  let failed = 0;
  let running = 0;
  for (const child of batch.children) {
    if (!child.jobId) {
      if (child.status === 'error') failed += 1;
      continue;
    }
    const job = getJob(child.jobId);
    if (!job) {
      // Persisted batch after restart — keep last known child status
      if (child.status === 'ok') done += 1;
      else if (child.status === 'error') failed += 1;
      else if (child.status === 'running') running += 1;
      continue;
    }
    child.status = job.status;
    child.error = job.error;
    child.costUsd = job.costUsd;
    if (job.status === 'ok') done += 1;
    else if (job.status === 'error') failed += 1;
    else if (job.status === 'running') running += 1;
  }
  batch.done = done;
  batch.failed = failed;
  batch.running = running;
  batch.pending = batch.children.filter((c) => c.status === 'queued').length;
  if (batch.status === 'running' && batch.pending === 0 && running === 0) {
    batch.status = failed && !done ? 'error' : failed ? 'partial' : 'ok';
    batch.finishedAt = new Date().toISOString();
  }
  persistBatch(batch);
  return batch;
}

function pump(batch) {
  refreshBatchJob(batch);
  if (batch.status !== 'running') return;
  const start = STARTERS[batch.act];
  if (!start) {
    batch.status = 'error';
    batch.error = `Unknown act: ${batch.act}`;
    persistBatch(batch);
    return;
  }
  const running = batch.children.filter((c) => c.status === 'running').length;
  const slots = Math.max(0, batch.concurrency - running);
  const queued = batch.children.filter((c) => c.status === 'queued');
  for (let i = 0; i < slots && i < queued.length; i += 1) {
    const child = queued[i];
    try {
      const job = start(child.candidateId, {
        adsMode: batch.adsMode,
        forceSerp: batch.forceSerp,
        volumesOnly: batch.volumesOnly,
      });
      child.jobId = job.id;
      child.status = 'running';
      const watch = setInterval(() => {
        const j = getJob(child.jobId);
        if (!j || j.status === 'running') return;
        clearInterval(watch);
        child.status = j.status;
        child.error = j.error;
        child.costUsd = j.costUsd;
        pump(batch);
      }, 400);
    } catch (error) {
      child.status = 'error';
      child.error = error.message;
    }
  }
  refreshBatchJob(batch);
}

/**
 * @param {{
 *   act: 'research'|'enrich'|'prospects'|'narrative',
 *   candidateIds: string[],
 *   adsMode?: 'live'|'standard',
 *   forceSerp?: boolean,
 *   volumesOnly?: boolean,
 *   requireWithinLimit?: boolean,
 * }} opts
 */
export function startBatchJobs({
  act,
  candidateIds = [],
  adsMode = 'live',
  forceSerp = false,
  volumesOnly = false,
  requireWithinLimit = false,
} = {}) {
  const ids = [...new Set(candidateIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) {
    const err = new Error('No candidate ids');
    err.status = 400;
    throw err;
  }
  if (!STARTERS[act]) {
    const err = new Error(`Unsupported batch act: ${act}`);
    err.status = 400;
    throw err;
  }
  const conc = getEvalConcurrency();
  if (requireWithinLimit && ids.length > conc) {
    throw Object.assign(
      new Error(
        `You selected ${ids.length} candidates. Concurrent Limit for Evaluations is ${conc} — a soft limit so you do not spend too much money at once.`,
      ),
      {
        status: 400,
        code: 'EVAL_CONCURRENCY',
        limit: conc,
        selected: ids.length,
      },
    );
  }
  const mode = String(adsMode || 'live').toLowerCase() === 'standard' ? 'standard' : 'live';
  const volOnly = Boolean(volumesOnly);
  const force = Boolean(forceSerp) && !volOnly;

  const batchJobId = randomUUID();
  const batch = {
    id: batchJobId,
    act,
    adsMode: act === 'research' ? mode : undefined,
    forceSerp: act === 'research' ? force : undefined,
    volumesOnly: act === 'research' ? volOnly : undefined,
    status: 'running',
    concurrency: conc,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    children: ids.map((candidateId) => ({
      candidateId,
      jobId: null,
      status: 'queued',
      error: null,
      costUsd: null,
    })),
    done: 0,
    failed: 0,
    running: 0,
    pending: ids.length,
  };
  batchJobs.set(batchJobId, batch);
  persistBatch(batch);
  pump(batch);
  return batch;
}

/** Aggregate stage flags for a set of candidate ids (for UI checkmarks). */
export function aggregateStageFlags(candidateIds = []) {
  const totals = {
    count: 0,
    hasResearch: 0,
    hasEnrichment: 0,
    hasNarrativeDraft: 0,
    hasNarrative: 0,
    hasProspects: 0,
  };
  for (const id of candidateIds) {
    try {
      const d = getCandidateDetail(id);
      const f = d.stageFlags || {};
      totals.count += 1;
      if (f.hasResearch) totals.hasResearch += 1;
      if (f.hasEnrichment) totals.hasEnrichment += 1;
      if (f.hasNarrativeDraft) totals.hasNarrativeDraft += 1;
      if (f.hasNarrative) totals.hasNarrative += 1;
      if (f.hasProspects) totals.hasProspects += 1;
    } catch {
      /* skip missing */
    }
  }
  return totals;
}
