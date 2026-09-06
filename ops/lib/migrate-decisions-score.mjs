/**
 * Idempotent migration: rewrite leftover legacy decision labels only.
 * Never overwrite operator pursue / maybe / pass / hold / review / ignore.
 */

import { listCandidates, setDecision } from './candidates.mjs';
import { recommendCandidate } from './discovery-recommend.mjs';
import {
  loadTrackedDecisions,
  upsertTrackedDecision,
} from './known-candidates.mjs';

const LEGACY = new Set(['deprioritize', 'pass_unless_gbp_angle']);
const OPERATOR_KEEP = new Set(['pursue', 'maybe', 'pass', 'hold', 'review', 'ignore']);

/** True when boot migrate may replace this saved decision (legacy, empty, or invalid). */
export function shouldRewriteOperatorDecision(decision) {
  const d = String(decision || '').trim();
  if (OPERATOR_KEEP.has(d)) return false;
  return true;
}

/**
 * Next decision to write, or null if the operator value must stay.
 * @param {object} c
 * @returns {{ decision: string, notes: string } | null}
 */
export function migrateCandidateDecision(c = {}) {
  if (!shouldRewriteOperatorDecision(c.decision)) return null;
  const rec = recommendCandidate(c);
  return { decision: rec.recommended_decision, notes: rec.recommended_reason };
}

/**
 * @returns {{ candidates: number, discoveryBatches: number, tracked: number }}
 */
export function migrateDecisionsToScoreModel() {
  let candidates = 0;
  const discoveryBatches = 0;
  let tracked = 0;

  for (const c of listCandidates()) {
    const next = migrateCandidateDecision(c);
    if (!next) continue;
    setDecision(c.id, next.decision, next.notes);
    candidates += 1;
  }

  for (const r of loadTrackedDecisions()) {
    if (!LEGACY.has(String(r.decision || '').trim())) continue;
    upsertTrackedDecision({
      niche: r.niche,
      city: r.city,
      state: r.state,
      decision: 'pass',
      batchId: r.batchId || '',
      updatedAt: new Date().toISOString(),
    });
    tracked += 1;
  }

  return { candidates, discoveryBatches, tracked };
}
