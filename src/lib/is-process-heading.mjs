/**
 * Process H2 matcher shared by the site (How it works cards) and Rover
 * (Review svcProcess slots / visual-edit). Keep these in lockstep.
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
 * True for “Our {service} Process”, “Our … Approach”, “How we …”,
 * and the older “how the process works” shapes.
 * @param {string} heading
 * @returns {boolean}
 */
export function isProcessHeading(heading) {
  const t = normTitle(heading);
  if (!t) return false;
  return (
    /process works|how (our |the )?.+process|how we (work|do)/.test(t) ||
    /\bour .{0,80}\b(process|approach)\b/.test(t) ||
    /^how we /.test(t)
  );
}
