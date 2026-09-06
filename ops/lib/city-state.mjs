/**
 * Parse and normalize City,ST tokens for Discovery suburbs and Stage 1 cluster.
 *
 * Claude often writes suggested_suburbs as a comma list of city names with no
 * state ("Goodyear, Litchfield Park, Tolleson"). Stage 1 requires City,ST.
 */

const CITY_ST_RE = /^(.+),\s*([A-Za-z]{2})$/;

export function parseCityStateToken(value) {
  const match = String(value || '').trim().match(CITY_ST_RE);
  if (!match) return null;
  const city = match[1].trim();
  const state = match[2].trim().toUpperCase();
  if (!city || !state) return null;
  return { city, state };
}

export function formatCityState({ city, state }) {
  return `${String(city || '').trim()},${String(state || '').trim().toUpperCase()}`;
}

function splitCommaAware(chunk) {
  const trimmed = String(chunk || '').trim();
  if (!trimmed) return [];
  if (parseCityStateToken(trimmed)) return [trimmed];

  const bits = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (bits.length <= 1) return bits;

  const out = [];
  for (let i = 0; i < bits.length; i += 1) {
    const cur = bits[i];
    const next = bits[i + 1];
    if (next && /^[A-Za-z]{2}$/.test(next)) {
      out.push(`${cur},${next.toUpperCase()}`);
      i += 1;
    } else {
      out.push(cur);
    }
  }
  return out;
}

function flattenClusterValues(values) {
  const raw = Array.isArray(values) ? values : [values];
  const tokens = [];
  for (const item of raw) {
    if (item == null) continue;
    const s = String(item).trim();
    if (!s) continue;
    for (const part of s.split(/[|;]/).map((t) => t.trim()).filter(Boolean)) {
      tokens.push(...splitCommaAware(part));
    }
  }
  return tokens;
}

/**
 * Turn a suburb list (string or array) into unique `City,ST` labels.
 * Tokens that already match City,ST keep their state; others get defaultState.
 */
export function normalizeCityStateCluster(values, defaultState) {
  const st = String(defaultState || '').trim().toUpperCase();
  const out = [];
  const seen = new Set();
  for (const part of flattenClusterValues(values)) {
    const parsed = parseCityStateToken(part);
    const city = parsed ? parsed.city : part.trim();
    const state = parsed ? parsed.state : st;
    if (!city || !state) continue;
    const token = formatCityState({ city, state });
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}
