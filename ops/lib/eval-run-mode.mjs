/**
 * Run all vs Run all required (cheapest Research path).
 * Omit / unknown → required.
 */

import { deriveStage } from './candidates.mjs';

export const EVAL_RUN_MODE_REQUIRED = 'required';
export const EVAL_RUN_MODE_ALL = 'all';

export const EVAL_ALL_STEPS_ALL = ['research', 'enrich', 'narrative', 'prospects'];
export const EVAL_ALL_STEPS_REQUIRED = ['research', 'narrative'];

export const EVAL_ALL_STEP_LABELS = {
  research: 'SERP / Volume',
  'serp-seeds': 'SERP seeds',
  enrich: 'Enrich',
  narrative: 'Narrative',
  prospects: 'Prospects',
};

export function normalizeEvalRunMode(raw) {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (v === 'all' || v === 'full' || v === 'evaluate-all') return EVAL_RUN_MODE_ALL;
  return EVAL_RUN_MODE_REQUIRED;
}

/**
 * @param {string} candidateId
 * @param {string} [mode]
 * @returns {string[]}
 */
export function missingEvalAllSteps(candidateId, mode = EVAL_RUN_MODE_REQUIRED) {
  const f = deriveStage(candidateId);
  const resolved = normalizeEvalRunMode(mode);
  const missing = [];
  if (resolved === EVAL_RUN_MODE_ALL) {
    if (!f.hasVolumes) missing.push('research');
    if (!f.hasEnrichment) missing.push('enrich');
    if (!f.hasNarrative) missing.push('narrative');
    if (!f.hasProspects) missing.push('prospects');
    return missing;
  }
  if (!f.hasResearch) missing.push('research');
  if (!f.hasNarrative) missing.push('narrative');
  return missing;
}

export function nextEvalAllStep(candidateId, mode = EVAL_RUN_MODE_REQUIRED) {
  return missingEvalAllSteps(candidateId, mode)[0] || null;
}

export function missingEvalAllStepsFromFlags(flags = {}, mode = EVAL_RUN_MODE_REQUIRED) {
  const f = flags || {};
  const resolved = normalizeEvalRunMode(mode);
  const missing = [];
  if (resolved === EVAL_RUN_MODE_ALL) {
    if (!f.hasVolumes) missing.push('research');
    if (!f.hasEnrichment) missing.push('enrich');
    if (!f.hasNarrative) missing.push('narrative');
    if (!f.hasProspects) missing.push('prospects');
    return missing;
  }
  if (!f.hasResearch) missing.push('research');
  if (!f.hasNarrative) missing.push('narrative');
  return missing;
}
