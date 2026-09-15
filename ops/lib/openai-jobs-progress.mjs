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
  if (!job || job.status === 'queued') {
    return { label: 'Queued', elapsedMs: 0 };
  }
  const started = job.startedAt ? Date.parse(job.startedAt) : NaN;
  const elapsedMs = Number.isFinite(started) ? Math.max(0, now - started) : 0;
  return { label: 'Generating', elapsedMs };
}
