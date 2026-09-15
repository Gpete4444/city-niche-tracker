/**
 * Split a heading into lead + emphasized accent for two-tone titles.
 * Only high-confidence splits return an accent; otherwise the title stays plain.
 * Extra keywords after `|` / dash stay in `rest` (same color as lead).
 */

export interface TwoToneParts {
  lead: string;
  accent: string | null;
  /** Unaccented tail after the accent (e.g. ` | Patch & Texture-Match Pros`). */
  rest?: string;
}

const MAX_ACCENT_WORDS = 4;
const MAX_ACCENT_CHARS = 40;
const MAX_IN_CLAUSE_WORDS = 6;

const CUT_BEFORE = new Set([
  'for',
  'with',
  'to',
  'a',
  'an',
  'the',
  'our',
  'your',
  'and',
]);

function normalize(text: string): string {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

function accentFits(accent: string, { maxWords = MAX_ACCENT_WORDS } = {}): boolean {
  const words = wordCount(accent);
  return words >= 1 && words <= maxWords && accent.length <= MAX_ACCENT_CHARS;
}

function emptyParts(lead = ''): TwoToneParts {
  return { lead, accent: null, rest: '' };
}

/**
 * Reassemble split parts to the original heading (normalized whitespace).
 */
export function joinTwoToneParts(parts: TwoToneParts): string {
  const lead = String(parts?.lead || '');
  const accent = String(parts?.accent || '');
  const rest = String(parts?.rest || '');
  let s = lead;
  if (accent) s = s ? `${s} ${accent}` : accent;
  if (rest) s += /^\s/.test(rest) ? rest : ` ${rest}`;
  return normalize(s);
}

/**
 * Accent from `start` through at least `minEnd`, plus optional `, ST`,
 * but never through a `|` / dash tail. Remainder is `rest`.
 */
function clipLocalityAccent(raw: string, start: number, minEnd: number): TwoToneParts | null {
  const lead = raw.slice(0, start).trim();
  if (wordCount(lead) < 2) return null;

  let end = Math.max(start, minEnd);
  const afterPhrase = raw.slice(end);
  const stateExt = afterPhrase.match(/^(,\s*[A-Za-z]{2}\.?)/);
  if (stateExt) end += stateExt[0].length;

  const cutRel = raw.slice(start, end).search(/\s*[|—–]/);
  if (cutRel >= 0) end = start + cutRel;

  const accent = raw.slice(start, end).trim();
  if (!accent || !accentFits(accent, { maxWords: MAX_IN_CLAUSE_WORDS })) return null;

  return { lead, accent, rest: raw.slice(end) };
}

/**
 * Prefer an explicit phrase (city, niche payoff) when it appears in the title.
 * Tries candidates in order; falls back to {@link splitTwoToneHeading}.
 */
export function preferAccentPhrase(text: string, candidates: Array<string | null | undefined>): TwoToneParts {
  const raw = normalize(text);
  if (!raw) return emptyParts();

  for (const candidate of candidates) {
    const phrase = normalize(String(candidate || ''));
    if (!phrase || phrase.length < 2) continue;

    const lower = raw.toLowerCase();
    const needle = phrase.toLowerCase();
    const idx = lower.lastIndexOf(needle);
    if (idx <= 0) continue;

    let start = idx;
    const before = raw.slice(0, idx);
    const inPrefix = before.match(/^(.*)(\s+in\s+)$/i);
    if (inPrefix && wordCount(inPrefix[1]) >= 2) {
      start = inPrefix[1].length;
    } else if (wordCount(before) < 2) {
      continue;
    }

    const clipped = clipLocalityAccent(raw, start, idx + phrase.length);
    if (clipped) return clipped;
  }

  return splitTwoToneHeading(raw);
}

function looksLikeLocalityAccent(accent: string): boolean {
  const rest = accent.replace(/^\s*in\s+/i, '').trim();
  if (!rest) return false;
  // "Spanish Fork, UT" / "Denver, CO"
  if (/,\s*[A-Za-z]{2}\.?$/.test(rest)) return true;
  // Short place names only — reject long niche tails ("Kitchen & Bathroom Remodeling")
  if (/&/.test(rest)) return false;
  return wordCount(rest) <= 3;
}

/**
 * Prefer emphasizing a local clause (" in City…"), dash clause, or a short
 * natural payoff. Never use a blunt mid-title percentage cut.
 */
export function splitTwoToneHeading(text: string): TwoToneParts {
  const raw = normalize(text);
  if (!raw) return emptyParts();

  const inMatch = raw.match(/^(.+?)(\s+in\s+.+?)(\s*[|—–].*)?$/i);
  if (inMatch && wordCount(inMatch[1]) >= 2) {
    const accent = inMatch[2].trim();
    const rest = inMatch[3] || '';
    if (
      looksLikeLocalityAccent(accent) &&
      accentFits(accent, { maxWords: MAX_IN_CLAUSE_WORDS })
    ) {
      return { lead: inMatch[1].trim(), accent, rest };
    }
  }

  const emDash = raw.match(/^(.+?)(\s+[—–]\s+.+)$/);
  if (emDash && wordCount(emDash[1]) >= 2) {
    const accent = emDash[2].trim();
    if (accentFits(accent, { maxWords: MAX_IN_CLAUSE_WORDS })) {
      return { lead: emDash[1].trim(), accent, rest: '' };
    }
  }

  // Trailing 2–4 word payoff only after a natural boundary word
  const words = raw.split(/\s+/);
  if (words.length >= 4) {
    for (let accentLen = Math.min(MAX_ACCENT_WORDS, words.length - 2); accentLen >= 2; accentLen -= 1) {
      const cutAt = words.length - accentLen;
      const boundary = words[cutAt - 1]?.toLowerCase().replace(/[^\w]/g, '');
      if (!boundary || !CUT_BEFORE.has(boundary)) continue;
      const lead = words.slice(0, cutAt).join(' ');
      const accent = words.slice(cutAt).join(' ');
      if (accentFits(accent)) {
        return { lead, accent, rest: '' };
      }
    }
  }

  return emptyParts(raw);
}
