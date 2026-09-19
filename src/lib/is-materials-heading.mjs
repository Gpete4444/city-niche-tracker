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
 * True for “Materials and methods…”, “Materials we use”, “Materials for {service}”,
 * SEO prefixes such as “{niche} Near Me: Materials and Methods We Use”,
 * and homepage titles that only say Methods (“… Lifting Methods in {city}”).
 * Same rule as homepage classifyProseHeading — keep them in lockstep.
 * @param {string} heading
 * @returns {boolean}
 */
export function isMaterialsHeading(heading) {
  const t = normTitle(heading);
  if (!t) return false;
  if (isProcessHeading(t)) return false;
  if (/^(materials|methods)\b/.test(t)) return true;
  if (/:\s*(materials|methods)\b/.test(t)) return true;
  if (/\bmaterials\s+(&|and)\s+methods\b/.test(t)) return true;
  if (/\bmaterials\s+(we\s+use|for)\b/.test(t)) return true;
  if (/\bmethods\s+we\s+use\b/.test(t)) return true;
  if (/\bmaterials and\b/.test(t)) return true;
  if (/\bmethods\b/.test(t)) return true;
  return false;
}
