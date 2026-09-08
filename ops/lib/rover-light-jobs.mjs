/**
 * Light-job registry for Accept / logo / coverage map / pull photos / SERP / OpenAI generate.
 * Write site allows up to the Settings Write site Concurrent Limit
 * (same candidate still exclusive via assertWriteSiteStartAllowed).
 * Accept is exclusive per candidate (assertAcceptStartAllowed).
 * OpenAI photo / before-after extras queue at the Settings boxes (cross-candidate).
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { getConcurrency } from './rover-concurrency.mjs';

/** @typedef {'queued'|'running'|'done'|'error'} JobStatus */

/**
 * @typedef {{
 *   id: string,
 *   candidateId: string,
 *   phase: string,
 *   label: string,
 *   status: JobStatus,
 *   error: string | null,
 *   createdAt: string,
 *   startedAt: string | null,
 *   finishedAt: string | null,
 *   detail: string | null,
 *   result: unknown,
 * }} RoverLightJob
 */

const jobs = new Map();
let snapshotSeq = 0;
const bus = new EventEmitter();
bus.setMaxListeners(50);

const RECENT_KEEP = 40;

/** Default / compat: Settings Write site box default. Hard max is CONCURRENCY_MAX.writeSite. */
export const WRITE_SITE_MAX_CONCURRENT = 6;

export function writeSiteConcurrencyLimit() {
  return getConcurrency().writeSite;
}

function emitChange() {
  bus.emit('change', listLightJobsSnapshot());
}

/**
 * @param {RoverLightJob & { check?: unknown, seoLint?: unknown, contract?: unknown }} job
 * @param {{ includeResult?: boolean }} [opts]
 */
function serializeLightJob(job, { includeResult = true } = {}) {
  if (!job) return null;
  const out = {
    id: job.id,
    candidateId: job.candidateId,
    batchId: job.batchId || null,
    phase: job.phase,
    label: job.label,
    status: job.status,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    detail: job.detail,
    progressDone: job.progressDone ?? null,
    progressTotal: job.progressTotal ?? null,
    slotKey: job.slotKey || null,
    matchKey: job.matchKey || null,
    kind: job.kind || null,
    check: job.check || null,
    seoLint: job.seoLint || null,
    speechLint: job.speechLint || null,
    contract: job.contract || null,
  };
  if (includeResult) out.result = job.result;
  return out;
}

export function listLightJobsSnapshot() {
  snapshotSeq += 1;
  const all = [...jobs.values()].sort((a, b) => {
    const rank = { running: 0, queued: 1, error: 2, done: 3 };
    const ra = rank[a.status] ?? 9;
    const rb = rank[b.status] ?? 9;
    if (ra !== rb) return ra - rb;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
  const active = all.filter((j) => j.status === 'queued' || j.status === 'running');
  return {
    running: active.filter((j) => j.status === 'running').length,
    queued: active.filter((j) => j.status === 'queued').length,
    activeCount: active.length,
    jobs: all.slice(0, RECENT_KEEP).map((j) => serializeLightJob(j, { includeResult: false })),
    generatedAt: new Date().toISOString(),
    seq: snapshotSeq,
  };
}

export function onLightJobsChange(listener) {
  bus.on('change', listener);
  return () => bus.off('change', listener);
}

function pruneFinished() {
  const finished = [...jobs.values()]
    .filter((j) => j.status === 'done' || j.status === 'error')
    .sort((a, b) => String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')));
  for (const job of finished.slice(RECENT_KEEP)) {
    jobs.delete(job.id);
  }
}

export function discoveryPackJobCandidateId(batchId) {
  return `discovery:${String(batchId || '').trim()}`;
}

/**
 * Register a running light job (no queue). Used by script jobs that own their own process.
 * @param {{ candidateId?: string, batchId?: string, phase: string, label?: string, progressTotal?: number }} opts
 * @returns {{ jobId: string }}
 */
export function openLightJob(opts) {
  const batchId = String(opts.batchId || '').trim();
  let candidateId = String(opts.candidateId || '').trim();
  if (!candidateId && batchId) candidateId = discoveryPackJobCandidateId(batchId);
  if (!candidateId) {
    throw Object.assign(new Error('candidateId or batchId required'), { status: 400 });
  }
  const id = randomUUID();
  const total =
    opts.progressTotal != null && Number.isFinite(Number(opts.progressTotal))
      ? Number(opts.progressTotal)
      : null;
  const queued = Boolean(opts.queued);
  /** @type {RoverLightJob & { check?: unknown, seoLint?: unknown, contract?: unknown, _httpStatus?: number, batchId?: string }} */
  const job = {
    id,
    candidateId,
    batchId: batchId || null,
    phase: String(opts.phase || 'job'),
    label: opts.label || opts.phase || 'job',
    status: queued ? 'queued' : 'running',
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: queued ? null : new Date().toISOString(),
    finishedAt: null,
    detail: queued ? 'Queued…' : null,
    progressDone: total != null ? 0 : null,
    progressTotal: total,
    slotKey: opts.slotKey ? String(opts.slotKey) : null,
    matchKey: opts.matchKey ? String(opts.matchKey) : null,
    kind: opts.kind ? String(opts.kind) : null,
    result: null,
  };
  jobs.set(id, job);
  emitChange();
  return { jobId: id };
}

/**
 * @param {string} jobId
 * @param {{ error?: unknown, result?: unknown }} [opts]
 */
export function finishLightJob(jobId, { error, result } = {}) {
  const job = jobs.get(String(jobId || '').trim());
  if (!job || job.status === 'done' || job.status === 'error') return;
  if (error) {
    job.status = 'error';
    const err = error;
    job.error = err?.message ? String(err.message) : String(err);
    if (err?.check) job.check = err.check;
    if (err?.seoLint) job.seoLint = err.seoLint;
    if (err?.speechLint) job.speechLint = err.speechLint;
    if (err?.contract) job.contract = err.contract;
    if (err?.status) job._httpStatus = err.status;
  } else {
    job.status = 'done';
    job.result = result ?? null;
    if (job.progressTotal != null) job.progressDone = job.progressTotal;
    setTimeout(() => {
      if (jobs.get(job.id) === job) job.result = null;
    }, 60_000).unref?.();
  }
  job.finishedAt = new Date().toISOString();
  pruneFinished();
  emitChange();
  pumpQueuedLightJobs();
}

function bindAndRunLightJob(jobId, run) {
  const ac = new AbortController();
  const job = jobs.get(jobId);
  if (job) job.abort = ac;
  Promise.resolve()
    .then(() => new Promise((r) => setImmediate(r)))
    .then(() => {
      const j = jobs.get(jobId);
      if (!j || j.status === 'error' || j.status === 'done') return { __roverSkip: true };
      return run({ jobId, signal: ac.signal });
    })
    .then((result) => {
      if (result && result.__roverSkip) return;
      const j = jobs.get(jobId);
      if (!j || j.status === 'done' || j.status === 'error') return;
      finishLightJob(jobId, { result });
    })
    .catch((err) => finishLightJob(jobId, { error: err }));
}

/** Start light work immediately (Write site, Accept, logo). OpenAI uses enqueueLightJob. */
export function startLightJob(opts) {
  const { jobId } = openLightJob(opts);
  bindAndRunLightJob(jobId, opts.run);
  return { jobId };
}

const PHASE_QUEUE_CAPS = {
  'openai-photo': () => getConcurrency().openaiPhotos,
  'openai-ba': () => getConcurrency().openaiBeforeAfter,
};

export function countRunningLightJobs(phase) {
  const want = String(phase || '');
  let n = 0;
  for (const j of jobs.values()) {
    if (String(j.phase || '') !== want) continue;
    if (j.status === 'running') n += 1;
  }
  return n;
}

export function countQueuedLightJobs(phase) {
  const want = String(phase || '');
  let n = 0;
  for (const j of jobs.values()) {
    if (String(j.phase || '') !== want) continue;
    if (j.status === 'queued') n += 1;
  }
  return n;
}

function startQueuedLightJob(job) {
  if (!job || job.status !== 'queued' || typeof job.run !== 'function') return;
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.detail = job.detail === 'Queued…' ? 'Starting…' : job.detail;
  emitChange();
  bindAndRunLightJob(job.id, job.run);
}

export function pumpQueuedLightJobs() {
  for (const [phase, capFn] of Object.entries(PHASE_QUEUE_CAPS)) {
    const limit = Math.max(1, Number(capFn()) || 1);
    let running = countRunningLightJobs(phase);
    const queued = [...jobs.values()]
      .filter((j) => String(j.phase || '') === phase && j.status === 'queued')
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    for (const job of queued) {
      if (running >= limit) break;
      startQueuedLightJob(job);
      running += 1;
    }
  }
}

/**
 * Queue OpenAI photo/BA at the Settings cap; other phases start immediately.
 * @param {{
 *   candidateId?: string,
 *   batchId?: string,
 *   phase: string,
 *   label?: string,
 *   progressTotal?: number,
 *   slotKey?: string,
 *   matchKey?: string,
 *   kind?: string,
 *   run: (ctx: { jobId: string, signal?: AbortSignal }) => Promise<unknown>,
 * }} opts
 * @returns {{ jobId: string }}
 */
export function enqueueLightJob(opts) {
  const phase = String(opts.phase || 'job');
  if (!PHASE_QUEUE_CAPS[phase]) {
    return startLightJob(opts);
  }
  const { jobId } = openLightJob({ ...opts, queued: true });
  const job = jobs.get(jobId);
  if (job) job.run = opts.run;
  pumpQueuedLightJobs();
  return { jobId };
}

/** Active openai-photo / openai-ba job for this slot (any candidate). */
export function findActiveOpenaiJob({ candidateId, phase, slotKey, matchKey } = {}) {
  const cid = candidateId != null ? String(candidateId) : null;
  const wantPhase = phase != null ? String(phase) : null;
  const slot = slotKey != null && String(slotKey).trim() ? String(slotKey) : null;
  const match = matchKey != null && String(matchKey).trim() ? String(matchKey) : null;
  return [...jobs.values()].find((j) => {
    if (j.status !== 'running' && j.status !== 'queued') return false;
    if (cid && String(j.candidateId || '') !== cid) return false;
    if (wantPhase && String(j.phase || '') !== wantPhase) return false;
    if (slot && String(j.slotKey || '') !== slot) return false;
    if (match && String(j.matchKey || '') !== match) return false;
    return Boolean(slot || match);
  });
}

/**
 * Abort a running light job. The run() catch finishes it as error "Stopped".
 * @param {string} jobId
 */
export function cancelLightJob(jobId) {
  const id = String(jobId || '').trim();
  const job = jobs.get(id);
  if (!job) {
    throw Object.assign(new Error('Job not found'), { status: 404 });
  }
  if (job.status !== 'running' && job.status !== 'queued') {
    throw Object.assign(new Error('Job is not running'), { status: 409 });
  }
  if (job.status === 'queued') {
    finishLightJob(id, {
      error: Object.assign(new Error('Stopped'), { status: 499, code: 'STOPPED' }),
    });
    return serializeLightJob(jobs.get(id) || job, { includeResult: false });
  }
  job.detail = 'Stopping…';
  emitChange();
  try {
    job.abort?.abort();
  } catch {
    /* ignore */
  }
  return serializeLightJob(job, { includeResult: false });
}

/** First running/queued job matching phase (optionally candidate). */
export function findActiveLightJob(phase, candidateId = null) {
  const want = String(phase || '');
  const cid = candidateId != null ? String(candidateId) : null;
  return [...jobs.values()].find((j) => {
    if (String(j.phase || '') !== want) return false;
    if (j.status !== 'running' && j.status !== 'queued') return false;
    if (cid && String(j.candidateId || '') !== cid) return false;
    return true;
  });
}

/** Running + queued jobs for a phase. */
export function countActiveLightJobs(phase) {
  const want = String(phase || '');
  let n = 0;
  for (const j of jobs.values()) {
    if (String(j.phase || '') !== want) continue;
    if (j.status !== 'running' && j.status !== 'queued') continue;
    n += 1;
  }
  return n;
}

/**
 * Same candidate cannot run two Write site jobs. Up to the Write site Concurrent Limit
 * jobs may run on different candidates.
 * @param {string} candidateId
 */
export function assertWriteSiteStartAllowed(candidateId) {
  const cid = String(candidateId || '').trim();
  const same = findActiveLightJob('write-site', cid);
  if (same) {
    throw Object.assign(new Error('Write site is already running for this candidate'), {
      status: 409,
      code: 'WRITE_SITE_RUNNING',
      jobId: same.id,
      candidateId: cid,
    });
  }
  const running = countActiveLightJobs('write-site');
  const limit = writeSiteConcurrencyLimit();
  if (running >= limit) {
    throw Object.assign(
      new Error(
        `Already ${running} Write site jobs running. Concurrent Limit for Write site is ${limit} — a soft limit so you do not spend too much money at once.`,
      ),
      {
        status: 409,
        code: 'WRITE_SITE_CAP',
        candidateId: cid,
        running,
        limit,
      },
    );
  }
}

/**
 * Same batch cannot run two Generate packs. Up to the Generate pack Concurrent Limit
 * packs may run on different batches.
 * @param {string} batchId
 */
export function assertGeneratePackStartAllowed(batchId) {
  const bid = String(batchId || '').trim();
  const key = discoveryPackJobCandidateId(bid);
  const same = findActiveLightJob('generate-pack', key);
  if (same) {
    throw Object.assign(new Error('Generate pack is already running for this batch'), {
      status: 409,
      code: 'GENERATE_PACK_RUNNING',
      jobId: same.id,
      batchId: bid,
    });
  }
  const running = countActiveLightJobs('generate-pack');
  const limit = Math.max(1, Number(getConcurrency().generatePack) || 5);
  if (running >= limit) {
    const other = findActiveLightJob('generate-pack');
    throw Object.assign(
      new Error(
        `Already ${running} Generate pack jobs running. Concurrent Limit for Generate pack is ${limit} — a soft limit so you do not spend too much money at once.`,
      ),
      {
        status: 409,
        code: 'GENERATE_PACK_BUSY',
        jobId: other?.id || null,
        batchId: other?.batchId || other?.candidateId || null,
        candidateId: other?.candidateId || null,
        running,
        limit,
      },
    );
  }
}

/** Same candidate cannot run two Accept jobs. Other candidates may Accept in parallel. */
export function assertAcceptStartAllowed(candidateId) {
  const cid = String(candidateId || '').trim();
  const same = findActiveLightJob('accept', cid);
  if (same) {
    throw Object.assign(new Error('Accept is already running for this candidate'), {
      status: 409,
      code: 'ACCEPT_RUNNING',
      jobId: same.id,
      candidateId: cid,
    });
  }
}

/** Test-only: abort and drop every light job in this process. */
export function resetLightJobsForTests() {
  for (const job of jobs.values()) {
    try {
      job.abort?.abort();
    } catch {
      /* ignore */
    }
  }
  jobs.clear();
}

/**
 * @param {string} jobId
 * @returns {Promise<unknown>}
 */
export function waitForLightJob(jobId) {
  const id = String(jobId || '').trim();
  return new Promise((resolve, reject) => {
    const check = () => {
      const j = jobs.get(id);
      if (!j) {
        reject(new Error('Job disappeared'));
        return;
      }
      if (j.status === 'done') {
        resolve(j.result);
        return;
      }
      if (j.status === 'error') {
        reject(
          Object.assign(new Error(j.error || 'Job failed'), {
            status: j._httpStatus || 500,
            job: serializeLightJob(j),
            check: j.check || null,
            seoLint: j.seoLint || null,
            contract: j.contract || null,
          }),
        );
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}

export function getLightJob(jobId) {
  return serializeLightJob(jobs.get(String(jobId || '').trim()), { includeResult: true });
}

export function updateLightJobDetail(jobId, detail) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.detail = detail ? String(detail) : null;
  console.log('[rover-light]', job.candidateId, job.phase, job.detail || '');
  emitChange();
}

export function updateLightJobProgress(jobId, { detail, done, total } = {}) {
  const job = jobs.get(jobId);
  if (!job) return;
  if (detail != null) job.detail = String(detail);
  if (done != null && Number.isFinite(Number(done))) job.progressDone = Number(done);
  if (total != null && Number.isFinite(Number(total))) job.progressTotal = Number(total);
  const frac =
    job.progressTotal != null ? ` ${job.progressDone ?? 0}/${job.progressTotal}` : '';
  console.log('[rover-light]', job.candidateId, job.phase, `${job.detail || ''}${frac}`);
  emitChange();
}
