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
  deriveStage,
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

export const EVAL_ALL_ACT = 'evaluate-all';
export const EVAL_ALL_STEPS = ['research', 'enrich', 'narrative', 'prospects'];

export function missingEvalAllSteps(candidateId) {
  const f = deriveStage(candidateId);
  const missing = [];
  if (!f.hasResearch) missing.push('research');
  if (!f.hasEnrichment) missing.push('enrich');
  if (!f.hasNarrative) missing.push('narrative');
  if (!f.hasProspects) missing.push('prospects');
  return missing;
}

export function nextEvalAllStep(candidateId) {
  return missingEvalAllSteps(candidateId)[0] || null;
}

function addCost(a, b) {
  const x = Number(a);
  const y = Number(b);
  const sum = (Number.isFinite(x) ? x : 0) + (Number.isFinite(y) ? y : 0);
  return sum > 0 ? Number(sum.toFixed(6)) : null;
}

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
        step: c.step || null,
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

function refreshEvalAllBatch(batch) {
  for (const child of batch.children) {
    if (child.status !== 'running' || !child.jobId) continue;
    const job = getJob(child.jobId);
    if (!job) continue;
    if (job.status === 'error') {
      child.status = 'error';
      child.error = job.error;
      child.costUsd = addCost(child.costUsd, job.costUsd);
    }
  }
  batch.done = batch.children.filter((c) => c.status === 'ok').length;
  batch.failed = batch.children.filter((c) => c.status === 'error').length;
  batch.running = batch.children.filter((c) => c.status === 'running').length;
  batch.pending = batch.children.filter((c) => c.status === 'queued').length;
  if (batch.status === 'running' && batch.pending === 0 && batch.running === 0) {
    batch.status = batch.failed && !batch.done ? 'error' : batch.failed ? 'partial' : 'ok';
    batch.finishedAt = new Date().toISOString();
  }
  persistBatch(batch);
  return batch;
}

function advanceEvalAllChild(batch, child, job) {
  child.costUsd = addCost(child.costUsd, job?.costUsd);
  const lastStep = child.step;
  child.jobId = null;
  if (job?.status === 'error') {
    child.status = 'error';
    child.error = job.error || child.error || `${lastStep || 'step'} failed`;
    return;
  }
  const next = nextEvalAllStep(child.candidateId);
  if (next && next === lastStep) {
    child.status = 'error';
    child.error =
      lastStep === 'narrative'
        ? 'Narrative draft needs review — Accept before Prospects'
        : `${lastStep} finished but the stage is still incomplete`;
    return;
  }
  if (!next) {
    child.status = 'ok';
    child.step = null;
    return;
  }
  child.status = 'queued';
  child.step = null;
}

function pumpEvalAll(batch) {
  refreshEvalAllBatch(batch);
  if (batch.status !== 'running') return;

  for (const child of batch.children.filter((c) => c.status === 'queued')) {
    if (nextEvalAllStep(child.candidateId)) continue;
    child.status = 'ok';
    child.step = null;
    child.jobId = null;
  }
  refreshEvalAllBatch(batch);
  if (batch.status !== 'running') return;

  const running = batch.children.filter((c) => c.status === 'running').length;
  const slots = Math.max(0, batch.concurrency - running);
  const queued = batch.children.filter((c) => c.status === 'queued');
  for (let i = 0; i < slots && i < queued.length; i += 1) {
    const child = queued[i];
    try {
      const step = nextEvalAllStep(child.candidateId);
      if (!step) {
        child.status = 'ok';
        child.step = null;
        child.jobId = null;
        continue;
      }
      const start = STARTERS[step];
      if (!start) {
        child.status = 'error';
        child.error = `Unknown step: ${step}`;
        continue;
      }
      const job = start(child.candidateId, {
        adsMode: 'live',
        forceSerp: false,
        volumesOnly: false,
      });
      child.step = step;
      child.jobId = job.id;
      child.status = 'running';
      const watch = setInterval(() => {
        const j = getJob(child.jobId);
        if (!j || j.status === 'running') return;
        clearInterval(watch);
        advanceEvalAllChild(batch, child, j);
        pumpEvalAll(batch);
      }, 400);
    } catch (error) {
      child.status = 'error';
      child.error = error.message;
    }
  }
  refreshEvalAllBatch(batch);
}

function refreshBatchJob(batch) {
  if (batch.act === EVAL_ALL_ACT) return refreshEvalAllBatch(batch);
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
  if (batch.act === EVAL_ALL_ACT) {
    pumpEvalAll(batch);
    return;
  }
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
 *   act: 'research'|'enrich'|'prospects'|'narrative'|'evaluate-all',
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
  const evalAll = act === EVAL_ALL_ACT || act === 'evaluateAll';
  const resolvedAct = evalAll ? EVAL_ALL_ACT : act;
  if (!evalAll && !STARTERS[resolvedAct]) {
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
  const mode = evalAll
    ? 'live'
    : String(adsMode || 'live').toLowerCase() === 'standard'
      ? 'standard'
      : 'live';
  const volOnly = evalAll ? false : Boolean(volumesOnly);
  const force = evalAll ? false : Boolean(forceSerp) && !volOnly;

  const batchJobId = randomUUID();
  const batch = {
    id: batchJobId,
    act: resolvedAct,
    adsMode: evalAll || resolvedAct === 'research' ? mode : undefined,
    forceSerp: evalAll || resolvedAct === 'research' ? force : undefined,
    volumesOnly: evalAll || resolvedAct === 'research' ? volOnly : undefined,
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
      step: null,
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
