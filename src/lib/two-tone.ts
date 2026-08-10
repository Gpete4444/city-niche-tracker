/**
 * Split a heading into lead + emphasized accent for two-tone titles.
 * Only high-confidence splits return an accent; otherwise the title stays plain.
 */

export interface TwoToneParts {
  lead: string;
  accent: string | null;
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

/**
 * Prefer an explicit phrase (city, niche payoff) when it appears in the title.
 * Tries candidates in order; falls back to {@link splitTwoToneHeading}.
 */
export function preferAccentPhrase(text: string, candidates: Array<string | null | undefined>): TwoToneParts {
  const raw = normalize(text);
  if (!raw) return { lead: '', accent: null };

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

    const lead = raw.slice(0, start).trim();
    // Accent runs through end of title (allows ", UT" after city)
    const accent = raw.slice(start).trim();
    if (wordCount(lead) >= 2 && accentFits(accent, { maxWords: MAX_IN_CLAUSE_WORDS })) {
      return { lead, accent };
    }
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
  if (!raw) return { lead: '', accent: null };

  const inMatch = raw.match(/^(.+?)(\s+in\s+.+)$/i);
  if (inMatch && wordCount(inMatch[1]) >= 2) {
    const accent = inMatch[2].trim();
    if (
      looksLikeLocalityAccent(accent) &&
      accentFits(accent, { maxWords: MAX_IN_CLAUSE_WORDS })
    ) {
      return { lead: inMatch[1].trim(), accent };
    }
  }

  const emDash = raw.match(/^(.+?)(\s+[—–]\s+.+)$/);
  if (emDash && wordCount(emDash[1]) >= 2) {
    const accent = emDash[2].trim();
    if (accentFits(accent, { maxWords: MAX_IN_CLAUSE_WORDS })) {
      return { lead: emDash[1].trim(), accent };
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
        return { lead, accent };
      }
    }
  }

  return { lead: raw, accent: null };
}
