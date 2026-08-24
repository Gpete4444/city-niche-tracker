/**
 * Guard mutating edits on candidates that are already launched / shipped.
 */
import { loadMeta } from './candidates.mjs';

export function isCandidateLaunched(candidateId) {
  const meta = loadMeta(candidateId);
  return Boolean(meta?.lastLaunchAt || meta?.lastShipAt);
}

/**
 * Require body.confirmLaunchedEdit === true when the candidate is live.
 * @param {string} candidateId
 * @param {unknown} body
 */
export function assertLaunchedEditAllowed(candidateId, body) {
  if (!isCandidateLaunched(candidateId)) return;
  if (body && typeof body === 'object' && body.confirmLaunchedEdit === true) return;
  const err = new Error(
    `${candidateId}: This site is already launched. Confirm the change (Rover working copy only — live stays until Push updates).`,
  );
  err.status = 409;
  err.code = 'LAUNCHED_EDIT_CONFIRM_REQUIRED';
  throw err;
}
