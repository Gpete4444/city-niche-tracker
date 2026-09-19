/**
 * Generate-time people / no-people occupancy for image prompts.
 * Claude Image-queries stay no-people; this rewrites occupancy at serve/generate.
 */

export function normalizeOccupancy(raw) {
  return String(raw || '').trim().toLowerCase() === 'people' ? 'people' : 'none';
}

/** ChatGPT Copy prompt — explicit negatives are fine for the operator. */
export const NO_PEOPLE_RULES =
  'No people, no faces, no hands, no crew, no customers, no silhouettes. Empty rooms, installs, tools, and materials only. No text, no logos, no watermarks, no UI, no phone screens.';

/** Flux API — positive empty-scene language (Flux 2 has no negative prompts; fal flags “no people/faces/hands”). */
export const FLUX_UNOCCUPIED_SCENE =
  'Unoccupied interior/exterior: empty room, tools, materials, and the service feature only. Photoreal documentary still of the trade.';

export const PEOPLE_RULES =
  'Show 1–2 trade workers actively doing the described job — natural documentary pose, not a smiling stock crew. Faces and hands may be visible. No customers, no lifestyle extras. No text, no logos, no watermarks, no UI, no phone screens.';

export const FLUX_OCCUPIED_SCENE =
  'One or two trade workers actively doing the described job in a photoreal documentary still. Natural pose, not a smiling stock crew.';

export function occupancyLine(forChatGpt, occupancy) {
  const people = normalizeOccupancy(occupancy) === 'people';
  if (people) return forChatGpt ? PEOPLE_RULES : FLUX_OCCUPIED_SCENE;
  return forChatGpt ? NO_PEOPLE_RULES : FLUX_UNOCCUPIED_SCENE;
}

const NO_PEOPLE_PATTERNS = [
  /No people, no faces, no hands, no crew, no customers, no silhouettes\.\s*Empty rooms, installs, tools, and materials only\.\s*No text, no logos, no watermarks, no UI, no phone screens\./gi,
  /No people, no faces, no hands, no crew, no customers, no silhouettes\./gi,
  /No people, no faces, no hands, no crew, no customers\./gi,
  /No people, no faces, no hands, no crew\./gi,
  /\bNo people\./gi,
  /Unoccupied interior\/exterior:[^.]*\./gi,
];

const PEOPLE_PATTERNS = [
  /Show 1[-–]2 trade workers actively doing the described job[^.]*\./gi,
  /One or two trade workers actively doing the described job[^.]*\./gi,
];

function replaceAllPatterns(text, patterns, replacement) {
  let next = text;
  for (const re of patterns) {
    next = next.replace(re, replacement);
  }
  return next;
}

/**
 * Swap no-people / people clauses on Claude plan text and saved overrides.
 * If People is on and no clause matches, append PEOPLE_RULES.
 */
export function applyOccupancyToPrompt(text, occupancy) {
  const src = String(text || '').trim();
  if (!src) return src;
  const people = normalizeOccupancy(occupancy) === 'people';
  if (people) {
    let next = replaceAllPatterns(src, NO_PEOPLE_PATTERNS, PEOPLE_RULES);
    if (next === src && !/trade workers/i.test(src)) {
      next = `${src} ${PEOPLE_RULES}`;
    }
    return next;
  }
  return replaceAllPatterns(src, PEOPLE_PATTERNS, NO_PEOPLE_RULES);
}
