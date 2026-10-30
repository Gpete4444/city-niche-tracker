/**
 * Materials H2 matcher shared by the site and Rover Review slots.
 * Keep in lockstep with process: SEO-prefixed titles still count.
 */

import { isProcessHeading } from './is-process-heading.mjs';

function normTitle(s) {
  return String(s || '')
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/^["']|["']$/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * True when the heading names materials or methods, including SEO titles
 * with the word in the middle (“Turf and base materials built for Arizona sun”,
 * “… Lifting Methods in {city}”).
 * Cost, timeline, and permit headings stay out so “What do materials cost?”
 * remains a cost section. Same rule as homepage classifyProseHeading.
 * @param {string} heading
 * @returns {boolean}
 */
export function isMaterialsHeading(heading) {
  const t = normTitle(heading);
  if (!t) return false;
  if (isProcessHeading(t)) return false;
  if (/\bcost\b|pricing|how much/.test(t)) return false;
  if (/^how long\b|\btimeline\b/.test(t)) return false;
  if (/\bpermits?\b/.test(t)) return false;
  if (/\bmaterials\b/.test(t)) return true;
  if (/\bmethods\b/.test(t)) return true;
  return false;
}
