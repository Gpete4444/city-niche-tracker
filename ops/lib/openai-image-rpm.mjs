/**
 * Org-wide GPT Image 2 pacing across forked workers and in-process callers (logo).
 * 50 matches Settings max / OpenAI Tier 3 IPM; lower tiers still 429 and retry.
 */

export const OPENAI_IMAGE_RPM_LIMIT = 50;
export const OPENAI_IMAGE_RPM_WINDOW_MS = 60_000;

/** @type {number[]} */
const stamps = [];

function prune(now = Date.now()) {
  const cutoff = now - OPENAI_IMAGE_RPM_WINDOW_MS;
  while (stamps.length && stamps[0] <= cutoff) stamps.shift();
}

export function resetOpenaiImageRpmForTests() {
  stamps.length = 0;
}

export function openaiImageRpmUsed(now = Date.now()) {
  prune(now);
  return stamps.length;
}

export function parseOpenaiRetryAfterMs(headerValue, bodyText, attempt = 0) {
  const rawHeader = headerValue == null ? '' : String(headerValue).trim();
  if (rawHeader) {
    const headerSec = Number(rawHeader);
    if (Number.isFinite(headerSec) && headerSec >= 0) {
      return Math.min(120_000, Math.max(1_000, headerSec * 1000));
    }
  }
  const src = String(bodyText || '');
  const m = /try again in (\d+(?:\.\d+)?)\s*s/i.exec(src);
  if (m) return Math.min(120_000, Math.max(1_000, Number(m[1]) * 1000));
  const fallbacks = [15_000, 30_000, 60_000, 60_000, 60_000];
  return fallbacks[Math.min(Math.max(0, attempt), fallbacks.length - 1)];
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Block until `weight` tokens fit in the rolling 60s window, then consume them.
 * @param {{ weight?: number }} [opts]
 */
export async function acquireOpenaiImageToken({ weight = 1 } = {}) {
  const w = Math.max(1, Math.floor(Number(weight) || 1));
  for (;;) {
    const now = Date.now();
    prune(now);
    if (stamps.length + w <= OPENAI_IMAGE_RPM_LIMIT) {
      for (let i = 0; i < w; i += 1) stamps.push(now);
      return;
    }
    const wait = OPENAI_IMAGE_RPM_WINDOW_MS - (now - stamps[0]) + 25;
    await waitMs(Math.min(250, Math.max(50, wait)));
  }
}
