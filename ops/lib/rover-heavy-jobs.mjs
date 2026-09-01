/**
 * Global heavy-job registry + concurrency queue for assemble / preview / ship / launch.
 * Source of truth for the top-bar Jobs popover (all Rover tabs).
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const MAX_CONCURRENCY = 6;
export const MIN_CONCURRENCY = 1;

const ROOT = process.cwd();
const RUNTIME_SETTINGS_PATH = path.join(ROOT, 'research', '_rover', 'runtime-settings.json');

function clampConcurrency(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return null;
  return Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, v));
}

function envConcurrencyFallback() {
  return (
    clampConcurrency(process.env.ROVER_SHIP_CONCURRENCY) ??
    clampConcurrency(2) ??
    2
  );
}

/** @type {number | null} */
let concurrencyOverride = null;

function loadRuntimeSettings() {
  try {
    if (!existsSync(RUNTIME_SETTINGS_PATH)) return;
    const raw = JSON.parse(readFileSync(RUNTIME_SETTINGS_PATH, 'utf8'));
    const n = clampConcurrency(raw?.concurrency);
    if (n != null) concurrencyOverride = n;
  } catch {
    /* ignore corrupt file */
  }
}

function saveRuntimeSettings() {
  mkdirSync(path.dirname(RUNTIME_SETTINGS_PATH), { recursive: true });
  const payload = {
    concurrency: concurrencyLimit(),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(RUNTIME_SETTINGS_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

loadRuntimeSettings();

const DEFAULT_CONCURRENCY = envConcurrencyFallback();

/** @typedef {'queued'|'running'|'done'|'error'} JobStatus */
/** @typedef {'assemble'|'preview'|'ship'|'launch'|'prepare'} JobPhase */

/**
 * @typedef {{
 *   id: string,
 *   candidateId: string,
 *   phase: JobPhase,
 *   label: string,
 *   status: JobStatus,
 *   error: string | null,
 *   createdAt: string,
 *   startedAt: string | null,
 *   finishedAt: string | null,
 *   detail: string | null,
 *   result: unknown,
 * }} RoverJob
 */

const jobs = new Map();
/** @type {string[]} */
const queue = [];
let runningCount = 0;
let snapshotSeq = 0;
const bus = new EventEmitter();
bus.setMaxListeners(50);

const RECENT_KEEP = 40;

function emitChange() {
  bus.emit('change', listJobsSnapshot());
}

/**
 * @param {RoverJob & { check?: unknown, contract?: unknown }} job
 * @param {{ includeResult?: boolean }} [opts]
 */
function serializeHeavyJob(job, { includeResult = true } = {}) {
  if (!job) return null;
  const out = {
    id: job.id,
    candidateId: job.candidateId,
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
    check: job.check || null,
    contract: job.contract || null,
  };
  if (includeResult) out.result = job.result;
  return out;
}

export function concurrencyLimit() {
  if (concurrencyOverride != null) return concurrencyOverride;
  return (
    clampConcurrency(process.env.ROVER_SHIP_CONCURRENCY) ??
    DEFAULT_CONCURRENCY
  );
}

/**
 * Set Jobs K (1..6). Persists to research/_rover/runtime-settings.json.
 * @param {number} n
 */
export function setConcurrency(n) {
  const next = clampConcurrency(n);
  if (next == null) {
    const err = new Error(`concurrency must be ${MIN_CONCURRENCY}–${MAX_CONCURRENCY}`);
    err.status = 400;
    throw err;
  }
  concurrencyOverride = next;
  try {
    saveRuntimeSettings();
  } catch (error) {
    console.warn('[rover-jobs] could not persist concurrency:', error?.message || error);
  }
  emitChange();
  pump();
  return concurrencyLimit();
}

/**
 * Active lock: queued or running job for this candidate (any heavy phase).
 * @param {string} candidateId
 */
export function getActiveJobForCandidate(candidateId) {
  const id = String(candidateId || '').trim();
  for (const job of jobs.values()) {
    if (job.candidateId === id && (job.status === 'queued' || job.status === 'running')) {
      return job;
    }
  }
  return null;
}

export function listJobsSnapshot() {
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
    concurrency: concurrencyLimit(),
    maxConcurrency: MAX_CONCURRENCY,
    minConcurrency: MIN_CONCURRENCY,
    concurrencySource: concurrencyOverride != null ? 'runtime' : 'env',
    running: runningCount,
    queued: queue.length,
    activeCount: active.length,
    // Slim rows for SSE/list — full result only via GET /api/heavy-jobs/:id
    jobs: all.slice(0, RECENT_KEEP).map((j) => serializeHeavyJob(j, { includeResult: false })),
    generatedAt: new Date().toISOString(),
    seq: snapshotSeq,
  };
}

export function onJobsChange(listener) {
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

function pump() {
  const limit = concurrencyLimit();
  while (runningCount < limit && queue.length) {
    const jobId = queue.shift();
    const job = jobs.get(jobId);
    if (!job || job.status !== 'queued') continue;
    runningCount += 1;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    emitChange();

    Promise.resolve()
      .then(() => new Promise((r) => setImmediate(r)))
      .then(() => job._run({ jobId }))
      .then((result) => {
        job.result = result ?? null;
        job.status = 'done';
        job.finishedAt = new Date().toISOString();
        // Keep last detail (e.g. Building…) so Recent rows stay informative.
      })
      .catch((err) => {
        job.status = 'error';
        job.error = err?.message || String(err);
        if (err?.check) job.check = err.check;
        if (err?.contract) job.contract = err.contract;
        job.finishedAt = new Date().toISOString();
      })
      .finally(() => {
        runningCount = Math.max(0, runningCount - 1);
        delete job._run;
        pruneFinished();
        emitChange();
        pump();
      });
    // Progress emits come from updateJobDetail — no no-op heartbeat SSE.
  }
}

/**
 * Start heavy work and return immediately with jobId + done promise.
 * @param {{
 *   candidateId: string,
 *   phase: JobPhase,
 *   label?: string,
 *   run: (ctx: { jobId: string }) => Promise<unknown>,
 * }} opts
 * @returns {{ jobId: string }}
 */
export function startHeavyJob(opts) {
  const candidateId = String(opts.candidateId || '').trim();
  if (!candidateId) {
    throw Object.assign(new Error('candidateId required'), { status: 400 });
  }
  const existing = getActiveJobForCandidate(candidateId);
  if (existing) {
    throw Object.assign(
      new Error(
        `Candidate already has a ${existing.phase} job (${existing.status}). Wait or use another candidate.`,
      ),
      { status: 409, job: serializeHeavyJob(existing, { includeResult: false }) },
    );
  }

  const id = randomUUID();
  /** @type {RoverJob & { _run?: (ctx: { jobId: string }) => Promise<unknown>, check?: unknown, contract?: unknown }} */
  const job = {
    id,
    candidateId,
    phase: opts.phase,
    label: opts.label || opts.phase,
    status: 'queued',
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    detail: null,
    progressDone: null,
    progressTotal: null,
    result: null,
    _run: opts.run,
  };
  jobs.set(id, job);
  queue.push(id);
  emitChange();
  pump();

  // Return jobId only — do not create a floating waitForHeavyJob promise here.
  // Prepare 202 callers poll GET /api/heavy-jobs/:id; enqueueHeavyJob awaits wait separately.
  return { jobId: id };
}

/**
 * @param {string} jobId
 * @returns {Promise<unknown>}
 */
export function waitForHeavyJob(jobId) {
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
            status: 500,
            job: serializeHeavyJob(j),
            check: j.check || null,
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

export function getHeavyJob(jobId) {
  return serializeHeavyJob(jobs.get(String(jobId || '').trim()), { includeResult: true });
}

/**
 * Enqueue heavy work and wait until it finishes (legacy callers).
 * @param {{
 *   candidateId: string,
 *   phase: JobPhase,
 *   label?: string,
 *   run: (ctx: { jobId: string }) => Promise<unknown>,
 * }} opts
 * @returns {Promise<unknown>}
 */
export function enqueueHeavyJob(opts) {
  try {
    const { jobId } = startHeavyJob(opts);
    return waitForHeavyJob(jobId);
  } catch (error) {
    return Promise.reject(error);
  }
}

export function updateJobDetail(jobId, detail) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.detail = detail ? String(detail) : null;
  console.log('[rover-job]', job.candidateId, job.phase, job.detail || '');
  emitChange();
}

export function updateJobProgress(jobId, { detail, done, total } = {}) {
  const job = jobs.get(jobId);
  if (!job) return;
  if (detail != null) job.detail = String(detail);
  if (done != null && Number.isFinite(Number(done))) job.progressDone = Number(done);
  if (total != null && Number.isFinite(Number(total))) job.progressTotal = Number(total);
  const frac =
    job.progressTotal != null ? ` ${job.progressDone ?? 0}/${job.progressTotal}` : '';
  console.log('[rover-job]', job.candidateId, job.phase, `${job.detail || ''}${frac}`);
  emitChange();
}
