function norm(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

/**
 * Footer line: primary city, then location-page suburbs, then Also serving.
 * Blanks and repeats are dropped. Also serving is already capped at 10 by the caller.
 */
export function footerServingText({
  primaryCity = '',
  state = '',
  targetSuburbs = [],
  alsoServing = [],
} = {}) {
  const seen = new Set();
  const nearby = [];
  const primaryKey = norm(primaryCity);
  if (primaryKey) seen.add(primaryKey);
  for (const raw of [...targetSuburbs, ...alsoServing]) {
    const name = String(raw || '').trim();
    const key = norm(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    nearby.push(name);
  }
  const head = `Serving ${String(primaryCity || '').trim()}, ${String(state || '').trim()}`;
  if (!nearby.length) return head;
  return `${head} and nearby: ${nearby.join(', ')}`;
}
