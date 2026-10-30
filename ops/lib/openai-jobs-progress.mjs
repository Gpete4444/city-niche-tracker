/**
 * Review / Photo-library OpenAI generate progress from a light-job snapshot.
 * Counts only — no fake percent. OpenAI is opaque until the image returns.
 */

export function isOpenaiGenerateJob(job) {
  const phase = String(job?.phase || '');
  return phase === 'openai-photo' || phase === 'openai-ba';
}

export function openaiJobBelongsHere(job, { selectedId = null, photoGroupKey = '' } = {}) {
  const cid = String(job?.candidateId || '');
  if (!cid) return false;
  if (selectedId && cid === String(selectedId)) return true;
  if (photoGroupKey && cid === String(photoGroupKey)) return true;
  return false;
}

/**
 * @returns {{ running: number, queued: number, done: number, error: number, active: number, total: number }}
 */
export function openaiJobsProgressFromSnap(jobs, { selectedId = null, photoGroupKey = '' } = {}) {
  const list = (Array.isArray(jobs) ? jobs : []).filter(
    (j) => isOpenaiGenerateJob(j) && openaiJobBelongsHere(j, { selectedId, photoGroupKey }),
  );
  let running = 0;
  let queued = 0;
  let done = 0;
  let error = 0;
  for (const j of list) {
    if (j.status === 'running') running += 1;
    else if (j.status === 'queued') queued += 1;
    else if (j.status === 'done') done += 1;
    else if (j.status === 'error') error += 1;
  }
  const active = running + queued;
  return {
    running,
    queued,
    done,
    error,
    active,
    total: done + error + active,
  };
}

export function openaiSnapJobId(job) {
  return String(job?.id || job?.jobId || '').trim();
}

/** Watched / batch ids that the snapshot no longer lists (pruned-finished). */
export function openaiJobIdsMissingFromSnap(jobIds, snapJobs) {
  const seen = new Set(
    (Array.isArray(snapJobs) ? snapJobs : []).map(openaiSnapJobId).filter(Boolean),
  );
  const out = [];
  const used = new Set();
  for (const raw of jobIds || []) {
    const id = String(raw || '').trim();
    if (!id || used.has(id) || seen.has(id)) continue;
    used.add(id);
    out.push(id);
  }
  return out;
}

function handledIdSet(handled) {
  return handled instanceof Set ? handled : new Set([...(handled || [])].map((id) => String(id)));
}

/** Batch ids still in the snap and not yet handled (not pruned-missing). */
export function openaiBatchPendingInSnap(jobIds, { handled, snapJobs } = {}) {
  const handledSet = handledIdSet(handled);
  const seen = new Set(
    (Array.isArray(snapJobs) ? snapJobs : []).map(openaiSnapJobId).filter(Boolean),
  );
  return (jobIds || []).filter((raw) => {
    const id = String(raw || '').trim();
    return Boolean(id) && seen.has(id) && !handledSet.has(id);
  });
}

/** Batch ids not yet settled. An id missing from the snapshot stays open until handled. */
export function openaiBatchUnresolvedIds(jobIds, handled) {
  const handledSet = handledIdSet(handled);
  const out = [];
  const used = new Set();
  for (const raw of jobIds || []) {
    const id = String(raw || '').trim();
    if (!id || used.has(id) || handledSet.has(id)) continue;
    used.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Progress for one generate click. Ids not listed yet count as running.
 * Older done jobs in the snapshot are ignored.
 * @returns {{ running: number, queued: number, done: number, error: number, active: number, total: number }}
 */
export function openaiOpenBatchProgress(jobIds, snapJobs, handled) {
  const handledSet = handledIdSet(handled);
  const byId = new Map();
  for (const job of Array.isArray(snapJobs) ? snapJobs : []) {
    const id = openaiSnapJobId(job);
    if (id && !byId.has(id)) byId.set(id, job);
  }
  const ids = [];
  const used = new Set();
  for (const raw of jobIds || []) {
    const id = String(raw || '').trim();
    if (!id || used.has(id)) continue;
    used.add(id);
    ids.push(id);
  }
  let running = 0;
  let queued = 0;
  let done = 0;
  let error = 0;
  for (const id of ids) {
    const job = byId.get(id);
    if (!job) {
      if (handledSet.has(id)) done += 1;
      else running += 1;
      continue;
    }
    if (job.status === 'queued') queued += 1;
    else if (job.status === 'done') done += 1;
    else if (job.status === 'error') error += 1;
    else running += 1;
  }
  const active = running + queued;
  return { running, queued, done, error, active, total: ids.length };
}

/** Busy overlay keys with no running/queued OpenAI job in the snap. */
export function openaiBusyKeysStillActive(busyKeys, snapJobs, { selectedId = null, photoGroupKey = '' } = {}) {
  const active = new Set();
  for (const j of Array.isArray(snapJobs) ? snapJobs : []) {
    if (!isOpenaiGenerateJob(j)) continue;
    if (j.status !== 'running' && j.status !== 'queued') continue;
    if (!openaiJobBelongsHere(j, { selectedId, photoGroupKey })) continue;
    const key = String(j.slotKey || j.matchKey || '').trim();
    if (key) active.add(key);
  }
  return (busyKeys || []).filter((raw) => {
    const key = String(raw || '').trim();
    return Boolean(key) && !active.has(key);
  });
}

export function openaiJobsNeedingWatch(
  jobs,
  { selectedId = null, photoGroupKey = '', watchedIds = [] } = {},
) {
  const watched = new Set([...watchedIds].map((id) => String(id)));
  return (Array.isArray(jobs) ? jobs : []).filter((j) => {
    if (!isOpenaiGenerateJob(j)) return false;
    if (j.status !== 'running' && j.status !== 'queued') return false;
    if (!openaiJobBelongsHere(j, { selectedId, photoGroupKey })) return false;
    const id = String(j.id || j.jobId || '');
    return Boolean(id) && !watched.has(id);
  });
}

/**
 * @returns {{ label: string, elapsedMs: number }}
 */
export function openaiSlotOverlayCaption(job, now = Date.now()) {
  const detail = String(job?.detail || '');
  const waiting = /wait/i.test(detail);
  if (!job || job.status === 'queued') {
    return { label: waiting ? 'Waiting' : 'Queued', elapsedMs: 0 };
  }
  const started = job.startedAt ? Date.parse(job.startedAt) : NaN;
  const elapsedMs = Number.isFinite(started) ? Math.max(0, now - started) : 0;
  if (waiting) return { label: 'Waiting', elapsedMs };
  return { label: 'Generating', elapsedMs };
}
