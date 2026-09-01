/**
 * Light-job registry for Accept / logo / coverage map / pull photos / SERP.
 * No K queue and no one-job-per-candidate lock. Source of truth for Light Jobs.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

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
    seoLint: job.seoLint || null,
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

/**
 * Register a running light job (no queue). Used by script jobs that own their own process.
 * @param {{ candidateId: string, phase: string, label?: string, progressTotal?: number }} opts
 * @returns {{ jobId: string }}
 */
export function openLightJob(opts) {
  const candidateId = String(opts.candidateId || '').trim();
  if (!candidateId) {
    throw Object.assign(new Error('candidateId required'), { status: 400 });
  }
  const id = randomUUID();
  const total =
    opts.progressTotal != null && Number.isFinite(Number(opts.progressTotal))
      ? Number(opts.progressTotal)
      : null;
  /** @type {RoverLightJob & { check?: unknown, seoLint?: unknown, contract?: unknown, _httpStatus?: number }} */
  const job = {
    id,
    candidateId,
    phase: String(opts.phase || 'job'),
    label: opts.label || opts.phase || 'job',
    status: 'running',
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    detail: null,
    progressDone: total != null ? 0 : null,
    progressTotal: total,
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
    if (err?.contract) job.contract = err.contract;
    if (err?.status) job._httpStatus = err.status;
  } else {
    job.status = 'done';
    job.result = result ?? null;
    if (job.progressTotal != null) job.progressDone = job.progressTotal;
  }
  job.finishedAt = new Date().toISOString();
  pruneFinished();
  emitChange();
}

/**
 * Start light work immediately (no K pool).
 * @param {{
 *   candidateId: string,
 *   phase: string,
 *   label?: string,
 *   progressTotal?: number,
 *   run: (ctx: { jobId: string }) => Promise<unknown>,
 * }} opts
 * @returns {{ jobId: string }}
 */
export function startLightJob(opts) {
  const { jobId } = openLightJob(opts);
  Promise.resolve()
    .then(() => new Promise((r) => setImmediate(r)))
    .then(() => opts.run({ jobId }))
    .then((result) => finishLightJob(jobId, { result }))
    .catch((err) => finishLightJob(jobId, { error: err }));
  return { jobId };
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
