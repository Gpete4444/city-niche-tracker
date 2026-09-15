/**
 * Exclusive Website-step accordion: only one step looks open.
 * Prepare aliases (stage / assemble) map to the same Prepare preview card.
 */

const PREPARE_OPEN_IDS = new Set(['prepare', 'stage', 'assemble']);

export const WEBSITE_ACCORDION_STEP_IDS = ['logoMap', 'images', 'prepare', 'launch', 'indexing'];

export function normalizeWebsiteOpenId(openId) {
  const id = String(openId || '').trim();
  if (!id) return null;
  if (PREPARE_OPEN_IDS.has(id)) return 'prepare';
  return id;
}

/** Whether this step’s `.open` class should be on. */
export function contentStepIsOpen(stepId, openId) {
  const open = normalizeWebsiteOpenId(openId);
  const step = String(stepId || '').trim();
  if (!open || !step) return false;
  return step === open;
}

/** Header click: same step closes; otherwise that step is the only open one. */
export function nextAccordionOpenId(currentOpenId, clickedStepId) {
  const clicked = String(clickedStepId || '').trim();
  if (!clicked) return normalizeWebsiteOpenId(currentOpenId);
  const current = normalizeWebsiteOpenId(currentOpenId);
  const next = normalizeWebsiteOpenId(clicked);
  if (current && next && current === next) return null;
  return next;
}

/** Step ids that should have `.open` for this openId (at most one). */
export function exclusiveOpenStepIds(stepIds, openId) {
  const ids = Array.isArray(stepIds) ? stepIds : [];
  return ids.filter((id) => contentStepIsOpen(id, openId));
}

/** Sticky Review images chrome is a sibling of the body; only while that step is open. */
export function contentStepShowsFreeze(stepId, openId) {
  return String(stepId || '') === 'images' && contentStepIsOpen('images', openId);
}
