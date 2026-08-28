/**
 * Soft-delete / permanent-delete protection for Website + Launched candidates,
 * plus Research Evaluation order prerequisites.
 */
import { existsSync } from 'node:fs';
import { deriveStage, loadMeta, pathsFor } from './candidates.mjs';
import { isCandidateLaunched } from './launched-edit-guard.mjs';

/** Highest completed Research Evaluation (0 = none … 4 = Prospects). */
export function researchHighestEvalStep(id) {
  const f = deriveStage(id);
  if (f.hasProspects) return 4;
  if (f.hasNarrative) return 3;
  if (f.hasEnrichment) return 2;
  if (f.hasResearch) return 1;
  return 0;
}

function hasWebsiteTrackArtifact(id) {
  const p = pathsFor(id);
  return Boolean(
    existsSync(p.siteConfig) ||
      existsSync(p.siteConfigDraft) ||
      existsSync(p.content) ||
      existsSync(p.contentDraft) ||
      existsSync(p.contentBrief) ||
      existsSync(p.contentResearch) ||
      existsSync(p.contentOutline) ||
      existsSync(p.contentOutlinePackage) ||
      existsSync(p.contentStructure) ||
      existsSync(p.contentFieldResearch) ||
      existsSync(p.buildPackage),
  );
}

/**
 * Website Candidate (pursue and/or Website Track artifacts) or Launched Candidate.
 * These must never be permanently deleted from Rover records.
 */
export function isUndeletableCandidate(id) {
  if (!id) return false;
  const meta = loadMeta(id);
  if (meta?.decision === 'pursue') return true;
  if (isCandidateLaunched(id)) return true;
  if (hasWebsiteTrackArtifact(id)) return true;
  return false;
}

/**
 * @param {string[]} ids
 * @returns {{ allowed: string[], blocked: string[] }}
 */
export function partitionDeletableIds(ids = []) {
  const allowed = [];
  const blocked = [];
  const seen = new Set();
  for (const raw of ids) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (isUndeletableCandidate(id)) blocked.push(id);
    else allowed.push(id);
  }
  return { allowed, blocked };
}

/**
 * Throw 409 if any id is undeletable (no partial wipe).
 * @param {string[]} ids
 */
export function assertDeletableIds(ids = []) {
  const { allowed, blocked } = partitionDeletableIds(ids);
  if (blocked.length) {
    const err = new Error(
      `Cannot permanently delete Website or Launched Candidate(s): ${blocked.join(', ')}`,
    );
    err.status = 409;
    err.code = 'UNDELETABLE_CANDIDATE';
    err.details = { blocked, allowed };
    throw err;
  }
  return allowed;
}

/**
 * Research Evaluation order: enrich needs 1, narrative needs 2, prospects needs 3.
 * @param {string} id
 * @param {'enrich'|'narrative'|'prospects'} act
 */
export function assertEvalPrerequisite(id, act) {
  const f = deriveStage(id);
  if (act === 'enrich') {
    if (!f.hasResearch) {
      const err = new Error('Complete Evaluation 1 (SERP / Volume) before Enrich');
      err.status = 400;
      err.code = 'EVAL_ORDER';
      throw err;
    }
    return;
  }
  if (act === 'narrative') {
    if (!f.hasEnrichment) {
      const err = new Error('Complete Evaluation 2 (Enrich) before Narrative');
      err.status = 400;
      err.code = 'EVAL_ORDER';
      throw err;
    }
    return;
  }
  if (act === 'prospects') {
    if (!f.hasNarrative) {
      const err = new Error('Complete Evaluation 3 (Narrative) before Prospects');
      err.status = 400;
      err.code = 'EVAL_ORDER';
      throw err;
    }
  }
}
