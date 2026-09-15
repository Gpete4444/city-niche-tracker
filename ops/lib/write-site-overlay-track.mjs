/**
 * Write site overlay follows the job this tab started, not whichever table row
 * is selected. Clicking another candidate may paint that row’s in-flight write
 * for watching, but must not steal tracking or treat a missing snap as failure.
 */

function isActiveStatus(status) {
  return status === 'running' || status === 'queued';
}

function findActiveWriteSiteJob(jobs, candidateId) {
  const id = String(candidateId || '');
  if (!id) return null;
  return (jobs || []).find(
    (j) =>
      String(j.candidateId || '') === id &&
      String(j.phase || '') === 'write-site' &&
      isActiveStatus(j.status),
  );
}

/**
 * Keep the Website write lease for this candidate while this tab’s Write site
 * job is still tracked (user clicked another row).
 * @param {string} candidateId
 * @param {{ candidateId?: string, jobId?: string } | null | undefined} track
 */
export function writeSiteTrackHoldsLease(candidateId, track) {
  const id = String(candidateId || '').trim();
  const trackId = String(track?.candidateId || '').trim();
  return Boolean(id && track?.jobId && trackId === id);
}

export function findFinishedWriteSiteJob(jobs, candidateId) {
  const id = String(candidateId || '');
  if (!id) return null;
  if (findActiveWriteSiteJob(jobs, id)) return null;
  return (
    (jobs || []).find(
      (j) =>
        String(j.candidateId || '') === id &&
        String(j.phase || '') === 'write-site' &&
        (j.status === 'done' || j.status === 'error'),
    ) || null
  );
}

/**
 * Selected row’s Write site just finished, and this tab’s tracked job is a
 * different candidate (or none). Refresh that row; do not steal `_writeSiteTrack`.
 * @returns {object | null} finished job to reload, or null if the tracked handler owns it
 */
export function selectedWriteSiteNeedsRefresh({ jobs = [], selectedId = null, track = null } = {}) {
  const finished = findFinishedWriteSiteJob(jobs, selectedId);
  if (!finished) return null;
  if (track?.jobId && String(track.jobId) === String(finished.id)) return null;
  return finished;
}

/**
 * @param {{
 *   jobs?: object[],
 *   selectedId?: string | null,
 *   track?: { candidateId?: string, jobId?: string } | null,
 * }} [input]
 * @returns {{
 *   paintJob: object | null,
 *   outcome: null | 'wait' | 'done' | 'error' | 'stopped',
 *   finished: object | null,
 *   lookupTrackedJob: boolean,
 * }}
 */
export function resolveWriteSiteOverlay({ jobs = [], selectedId = null, track = null } = {}) {
  const list = Array.isArray(jobs) ? jobs : [];
  const paintJob = findActiveWriteSiteJob(list, selectedId) || null;
  const jobId = track?.jobId != null ? String(track.jobId) : '';
  if (!jobId) {
    return { paintJob, outcome: null, finished: null, lookupTrackedJob: false };
  }

  const tracked = list.find((j) => String(j.id) === jobId) || null;
  if (!tracked) {
    return { paintJob, outcome: 'wait', finished: null, lookupTrackedJob: true };
  }
  if (isActiveStatus(tracked.status)) {
    return { paintJob, outcome: 'wait', finished: null, lookupTrackedJob: false };
  }
  if (tracked.status === 'done') {
    return { paintJob, outcome: 'done', finished: tracked, lookupTrackedJob: false };
  }
  if (tracked.status === 'error') {
    const msg = String(tracked.error || '');
    const outcome = /stopped/i.test(msg) ? 'stopped' : 'error';
    return { paintJob, outcome, finished: tracked, lookupTrackedJob: false };
  }
  return { paintJob, outcome: 'wait', finished: null, lookupTrackedJob: false };
}
