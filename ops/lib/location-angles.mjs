/**
 * Per-suburb local angles for Outline / Full write — public sources only.
 */

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeLocalConditions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const text = item.trim();
      if (text) out.push({ text, place: '', sourceUrl: '' });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const text = String(item.text || item.cue || item.condition || '').trim();
    if (!text) continue;
    out.push({
      text,
      place: String(item.place || item.city || '').trim(),
      sourceUrl: String(item.sourceUrl || item.url || item.source || '').trim(),
    });
  }
  return out;
}

function placeMentions(text, placeName) {
  const t = String(text || '').toLowerCase();
  const p = String(placeName || '').toLowerCase();
  if (!t || !p) return false;
  return t.includes(p);
}

function pushUnique(list, cue) {
  const text = String(cue?.text || '').trim();
  if (!text) return;
  const key = text.toLowerCase();
  if (list.some((x) => String(x.text || '').toLowerCase() === key)) return;
  list.push({
    text,
    sourceUrl: String(cue.sourceUrl || '').trim(),
  });
}

/**
 * @param {{
 *   suburbs?: string[],
 *   cityContext?: object,
 *   fieldResearch?: object,
 * }} opts
 * @returns {Record<string, Array<{ text: string, sourceUrl?: string }>>}
 */
export function buildLocationAngles(opts = {}) {
  const suburbs = (opts.suburbs || []).map((n) => String(n || '').trim()).filter(Boolean);
  const places = Array.isArray(opts.cityContext?.places) ? opts.cityContext.places : [];
  const conditions = normalizeLocalConditions(opts.fieldResearch?.localConditions);
  const angles = {};

  for (const name of suburbs) {
    const slug = slugify(name);
    if (!slug) continue;
    const cues = [];
    const place = places.find((p) => slugify(p.name) === slug || String(p.name || '').toLowerCase() === name.toLowerCase());
    const wiki = place?.wiki && place.wiki.ok !== false ? place.wiki : null;
    const sourceUrl = wiki?.url || '';

    for (const hint of wiki?.climateHints || []) {
      pushUnique(cues, { text: String(hint), sourceUrl });
    }
    for (const hint of wiki?.housingHints || []) {
      pushUnique(cues, { text: String(hint), sourceUrl });
    }
    for (const hint of wiki?.neighborhoodHints || []) {
      pushUnique(cues, { text: `Named area: ${hint}`, sourceUrl });
    }
    if (place?.population) {
      pushUnique(cues, {
        text: `Census population about ${Number(place.population).toLocaleString('en-US')}`,
        sourceUrl: sourceUrl || 'census',
      });
    }
    if (wiki?.description) {
      pushUnique(cues, { text: String(wiki.description), sourceUrl });
    }

    for (const cond of conditions) {
      const matchesPlace = cond.place
        ? slugify(cond.place) === slug || cond.place.toLowerCase() === name.toLowerCase()
        : placeMentions(cond.text, name);
      if (!matchesPlace) continue;
      pushUnique(cues, cond);
    }

    angles[slug] = cues.slice(0, 4);
  }

  return angles;
}

export function formatLocationAnglesMarkdown(angles = {}, suburbs = []) {
  const lines = [
    '- **Location pages:** use only the angle bullets for that suburb. Do not reuse another city’s housing/climate/job cues. If a suburb has no bullets, write shorter honest copy from site-config neighbors — do not invent neighborhoods or stitch two other location pages together.',
  ];
  for (const name of suburbs) {
    const slug = slugify(name);
    const cues = angles[slug] || [];
    if (!cues.length) {
      lines.push(`  - ${name}: (no sourced angle — keep distinct, do not invent)`);
      continue;
    }
    const bits = cues.map((c) => (c.sourceUrl ? `${c.text} [${c.sourceUrl}]` : c.text));
    lines.push(`  - ${name}: ${bits.join('; ')}`);
  }
  return lines.join('\n');
}
