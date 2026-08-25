/**
 * Idempotent migration: rewrite candidate + discovery + tracked decisions
 * to the score-based recommend model.
 */

import { listCandidates, setDecision } from './candidates.mjs';
import { listBatches, recommendBatch } from './discovery.mjs';
import { recommendCandidate } from './discovery-recommend.mjs';
import {
  loadTrackedDecisions,
  upsertTrackedDecision,
} from './known-candidates.mjs';

const LEGACY = new Set(['deprioritize', 'pass_unless_gbp_angle']);

/**
 * @returns {{ candidates: number, discoveryBatches: number, tracked: number }}
 */
export function migrateDecisionsToScoreModel() {
  let candidates = 0;
  let discoveryBatches = 0;
  let tracked = 0;

  for (const c of listCandidates()) {
    const rec = recommendCandidate(c);
    const nextDecision = rec.recommended_decision;
    const nextNotes = rec.recommended_reason;
    if (c.decision === nextDecision && String(c.decisionNotes || '') === nextNotes) {
      continue;
    }
    setDecision(c.id, nextDecision, nextNotes);
    candidates += 1;
  }

  for (const meta of listBatches()) {
    const id = meta.id || meta.batchId;
    if (!id) continue;
    try {
      recommendBatch(id);
      discoveryBatches += 1;
    } catch (err) {
      console.warn(`[migrate-decisions] batch ${id}:`, err.message || err);
    }
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
