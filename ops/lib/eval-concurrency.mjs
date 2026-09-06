/**
 * Research Evaluations Concurrent Limit (compat wrapper).
 * Stored with the other Concurrent Limit keys in rover-concurrency.mjs.
 */
import {
  clampConcurrencyKey,
  CONCURRENCY_DEFAULTS,
  CONCURRENCY_MAX,
  CONCURRENCY_MIN,
  getConcurrency,
  setConcurrencySettings,
} from './rover-concurrency.mjs';

export const EVAL_CONCURRENCY_DEFAULT = CONCURRENCY_DEFAULTS.evaluations;
export const EVAL_CONCURRENCY_MIN = CONCURRENCY_MIN;
export const EVAL_CONCURRENCY_MAX = CONCURRENCY_MAX.evaluations;

export function clampEvalConcurrency(n) {
  return clampConcurrencyKey('evaluations', n);
}

export function getEvalConcurrency() {
  return getConcurrency().evaluations;
}

export function setEvalConcurrency(n) {
  return setConcurrencySettings({ evaluations: n }).evaluations;
}
