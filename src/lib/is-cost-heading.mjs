/**
 * Cost H2 matcher shared by the site and Rover SEO lint.
 * “what it costs”, “Typical costs”, and “Pricing” count. The token “pric” alone does not.
 */

function normTitle(s) {
  return String(s || '')
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/^["']|["']$/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Whole-word cost cues, plus the existing “estimate range” heading.
 * `costs?` matches cost and costs. `prices?` matches price and prices.
 */
export const COST_BAND_RE = /\b(?:costs?|prices?|priced|pricing|how much)\b|estimate range/i;

/** @param {string} heading */
export function isCostHeading(heading) {
  const t = normTitle(heading);
  if (!t) return false;
  return COST_BAND_RE.test(t);
}
