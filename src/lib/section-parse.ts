/**
 * Helpers to turn prose markdown bodies into typed section payloads.
 * Falls back gracefully when structure is missing.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { simpleProseToHtml } from './content-body';

export type SectionImage = { src: string; alt: string };

export function extractBulletLines(body: string): string[] {
  const lines = String(body || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets = lines
    .filter((l) => /^[-*•]\s+/.test(l) || /^\d+[.)]\s+/.test(l))
    .map((l) => l.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter(Boolean);
  return bullets;
}

function publicImageOnDisk(src: string): boolean {
  const s = String(src || '').trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  const rel = s.replace(/^\//, '').replace(/^public\//, '');
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length) return false;
  return (
    existsSync(join(process.cwd(), 'public', ...parts)) ||
    existsSync(join(process.cwd(), ...parts))
  );
}

/** Pull first markdown image; return body without that image. Prefer strip when file missing. */
export function extractMarkdownImage(body: string): {
  image: SectionImage | null;
  bodyWithoutImage: string;
} {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const re = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let bodyWithoutImage = text;
  let image: SectionImage | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const src = m[2].trim();
    const alt = m[1].trim() || 'Section image';
    bodyWithoutImage = bodyWithoutImage.replace(m[0], '');
    if (!image && publicImageOnDisk(src)) {
      image = { alt, src };
    }
  }
  bodyWithoutImage = bodyWithoutImage.replace(/\n{3,}/g, '\n\n').trim();
  return { image, bodyWithoutImage };
}

function isDiyColumnTitle(title: string): boolean {
  const t = String(title || '').toLowerCase();
  if (/\bhire\b|\bpro\b|professional|contractor/.test(t) && !/\bdiy\b/.test(t)) return false;
  return /\bdiy\b|do[\s-]?it[\s-]?yourself|yourself/.test(t);
}

function isProColumnTitle(title: string): boolean {
  const t = String(title || '').toLowerCase();
  return /\bhire\b|\bpro\b|professional|contractor/.test(t);
}

export function splitCompareColumns(body: string): {
  left: string[];
  right: string[];
  leftTitle: string;
  rightTitle: string;
  leftoverHtml: string;
} {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const parts = text.split(/^#{3}\s+/m);
  if (parts.length >= 3) {
    const cols: Array<{ title: string; bullets: string[] }> = [];
    for (let i = 1; i < parts.length; i += 1) {
      const chunk = parts[i];
      const nl = chunk.indexOf('\n');
      const title = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
      const rest = nl < 0 ? '' : chunk.slice(nl + 1);
      cols.push({ title, bullets: extractBulletLines(rest) });
    }
    if (cols.length >= 2) {
      const diy = cols.find((c) => isDiyColumnTitle(c.title));
      const pro = cols.find((c) => isProColumnTitle(c.title) && c !== diy);
      const leftCol = diy || cols[0];
      const rightCol = pro || cols.find((c) => c !== leftCol) || cols[1];
      return {
        left: leftCol.bullets.length ? leftCol.bullets : [],
        right: rightCol.bullets.length ? rightCol.bullets : [],
        leftTitle: leftCol.title || 'DIY',
        rightTitle: rightCol.title || 'Hire a pro',
        leftoverHtml: simpleProseToHtml(parts[0] || ''),
      };
    }
  }
  // No ### columns — leave empty so TypedProseSection can inferDiyProFromProse
  // (avoid naive half-split that swaps DIY/pro buckets).
  const bullets = extractBulletLines(text);
  if (bullets.length) {
    return {
      left: [],
      right: [],
      leftTitle: 'DIY',
      rightTitle: 'Hire a pro',
      leftoverHtml: '',
    };
  }
  return {
    left: [],
    right: [],
    leftTitle: 'DIY',
    rightTitle: 'Hire a pro',
    leftoverHtml: simpleProseToHtml(text),
  };
}

export function proseIntroAndBullets(body: string): { introHtml: string; bullets: string[] } {
  const text = String(body || '').replace(/\r\n/g, '\n').trim();
  const bullets = extractBulletLines(text);
  if (!bullets.length) {
    return { introHtml: simpleProseToHtml(text), bullets: [] };
  }
  const nonBullet = text
    .split(/\n/)
    .filter((l) => {
      const t = l.trim();
      return (
        t &&
        !/^[-*•]\s+/.test(t) &&
        !/^\d+[.)]\s+/.test(t) &&
        !/^#{1,3}\s/.test(t) &&
        !/^!\[/.test(t)
      );
    })
    .join('\n');
  return { introHtml: simpleProseToHtml(nonBullet), bullets };
}

/** Parse "Title — description" or "Title: description" option rows. */
export function parseOptionRows(bullets: string[]): Array<{ title: string; detail: string }> {
  return bullets.map((b) => {
    const cleaned = stripBold(b);
    const em = cleaned.match(/^(.+?)\s+[—–-]\s+(.+)$/);
    if (em) return { title: em[1].trim(), detail: em[2].trim() };
    const colon = cleaned.match(/^(.+?):\s+(.+)$/);
    if (colon && colon[1].split(/\s+/).length <= 8) {
      return { title: colon[1].trim(), detail: colon[2].trim() };
    }
    const bold = b.match(/^\*\*(.+?)\*\*\s*[—–:-]?\s*(.*)$/);
    if (bold) return { title: bold[1].trim(), detail: bold[2].trim() };
    return { title: cleaned, detail: '' };
  });
}

/** Strip markdown bold markers from titles / bullets (prompts often emit `**Label**`). */
export function stripBold(s: string): string {
  return String(s || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\*\*|\*\*$/g, '')
    .trim();
}

const MONEY_RANGE_RE =
  /\$[\d,]+(?:\.\d+)?(?:\s*[–—-]\s*\$?[\d,]+(?:\.\d+)?)?\+?(?:\s*[kK])?/;

export type CostRow = { title: string; range: string; detail: string };

/**
 * Parse cost bullets into table rows when a $ range is present.
 * Shapes: `Title — $X–$Y — detail` | `Title — $X–$Y` | `Title ($X–$Y) detail`
 */
export function parseCostRows(bullets: string[]): CostRow[] {
  const rows: CostRow[] = [];
  for (const raw of bullets) {
    const text = stripBold(raw);
    const money = text.match(MONEY_RANGE_RE);
    if (!money) continue;
    const range = money[0].replace(/\s+/g, ' ').trim();
    const withoutMoney = `${text.slice(0, money.index)}${text.slice((money.index || 0) + money[0].length)}`
      .replace(/\(\s*\)/g, '')
      .replace(/^\+?\s*[—–-]\s*/, ' — ')
      .replace(/\s+/g, ' ')
      .trim();

    // Split on em/en dashes into title + optional detail
    const parts = withoutMoney
      .split(/\s+[—–]\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
    let title = '';
    let detail = '';
    if (parts.length >= 2) {
      title = parts[0].replace(/[:\-–—]+$/, '').trim();
      detail = parts
        .slice(1)
        .join(' — ')
        .replace(/^\+?\s*[—–:-]?\s*/, '')
        .trim();
    } else if (parts.length === 1) {
      // "Title ($range) rest" already stripped money; may leave "Title  rest"
      const colon = parts[0].match(/^(.+?):\s*(.*)$/);
      if (colon) {
        title = colon[1].trim();
        detail = colon[2].trim();
      } else {
        title = parts[0].replace(/\(\s*$/, '').trim();
      }
    }
    title = title.replace(/\(\s*$/, '').replace(/\s+/g, ' ').trim();
    detail = detail.replace(/^\+?\s*[—–-]\s*/, '').trim();
    if (!title) continue;
    rows.push({ title, range, detail });
  }
  return rows;
}

export type TimelineStage = { title: string; detail: string; duration?: string };

const DURATION_RE =
  /\b(half\s+an?\s+day(?:\s+to\s+(?:a\s+)?(?:half\s+an?\s+day|\d+\s*days?))?|same[-\s]?day(?:\s+to\s+next[-\s]?day)?|next[-\s]?day|\d+\s*[–-]\s*\d+\s*(?:days?|weeks?|months?)|\d+\+?\s*(?:days?|weeks?|months?)|few weeks|lead time|1–2 visits)\b/i;

/** Alternate timing / hedge phrases left after the chip absorbs the main duration. */
const DURATION_FLUFF_RE =
  /(?:^|\s)(?:or\s+)?(?:next[-\s]?day|same[-\s]?day)(?:\s+visit)?s?\b|(?:usually|typically|often)[,:]?\s*varies(?:\s+by(?:\s+[\w/-]+)*)?|\bin\s+most\s+cases\b|\bvaries\s+by(?:\s+[\w/-]+)*|\bdepends\s+on(?:\s+[\w/-]+)*|\([^)]*(?:varies|depend|usually|city\/county|weather|season|scope)[^)]*\)|^by\s+(?:city|county)\b|^(?:usually|typically|often)[,.]?\s*$|^(?:as\s+\w+)\.?$|^(?:half\s+an?\s+day\s+to)\.?$|^(?:to\s+(?:a\s+)?(?:\d+\s*)?days?)\.?$|^to\s+in\s+most\s+cases\.?$/gim;

/** Keep full ranges on chips: "3–7 days" stays "3–7 days" (not lower-bound only). */
export function shortenDurationChip(raw: string): string {
  const t = String(raw || '').trim();
  const half = t.match(/^half\s+an?\s+day(?:\s+to\s+(?:a\s+)?(?:(\d+)\s*)?days?)?$/i);
  if (half) {
    if (half[1]) {
      const n = half[1];
      return n === '1' ? '1 day' : `${n} days`;
    }
    return 'half day';
  }
  const sameToNext = t.match(/^same[-\s]?day\s+to\s+next[-\s]?day$/i);
  if (sameToNext) return 'same day to next day';
  const range = t.match(/^(\d+)\s*[–-]\s*(\d+)\s*(days?|weeks?|months?)$/i);
  if (range) {
    const a = range[1];
    const b = range[2];
    let unit = range[3].toLowerCase();
    if (a === '1' && b === '1') unit = unit.replace(/s$/, '');
    return `${a}–${b} ${unit}`;
  }
  return t.replace(/same\s+day/i, 'same day').replace(/next\s+day/i, 'next day');
}

/** True when detail is only schedule hedging / leftover duration, not real step copy. */
export function isTimelineDurationFluff(detail: string): boolean {
  const d = String(detail || '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!d) return true;
  if (/^\([^)]+\)$/.test(d)) return true;
  if (/^(or\s+)?(next[-\s]?day|same[-\s]?day)(\s+visit)?s?\.?$/i.test(d)) return true;
  if (/^(usually|typically|often)[,.]?$/i.test(d)) return true;
  if (/^(usually|typically|often)[,:]?\s*/i.test(d) && /varies|depend|city|county/i.test(d)) {
    return true;
  }
  if (/^varies\s+by\b/i.test(d) || /^depends\s+on\b/i.test(d)) return true;
  if (/^by\s+(city|county)\b/i.test(d)) return true;
  // Leftovers when chip matched only part of a duration phrase ("as repair", "half a day to")
  if (/^as\s+\w+\.?$/i.test(d)) return true;
  if (/^half\s+an?\s+day\s+to\.?$/i.test(d)) return true;
  if (/^to\s+(?:a\s+)?(?:\d+\s*)?days?\.?$/i.test(d)) return true;
  if (/^to\s+in\s+most\s+cases\.?$/i.test(d)) return true;
  if (/^in\s+most\s+cases\.?$/i.test(d)) return true;
  // Short leftover that collapses to empty after fluff strip
  const stripped = d.replace(DURATION_FLUFF_RE, '').replace(/^[,\s;:—–-]+|[,\s;:—–-]+$/g, '').trim();
  if (!stripped && d.length < 80) return true;
  return false;
}

function stripDurationFluff(text: string): string {
  return String(text || '')
    .replace(DURATION_FLUFF_RE, ' ')
    .replace(/\s*[—–-]\s*$/g, '')
    .replace(/^\s*[—–-]\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,\s;:]+|[,\s;:]+$/g, '')
    .trim();
}

export function parseTimelineStages(body: string): TimelineStage[] {
  const { bullets } = proseIntroAndBullets(body);
  const source =
    bullets.length > 0
      ? bullets
      : String(body || '')
          .replace(/\r\n/g, '\n')
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 20)
          .slice(0, 4);

  return source.map((raw, i) => {
    const rows = parseOptionRows([raw])[0];
    const hay = `${rows.title} ${rows.detail}`;
    const dur = hay.match(DURATION_RE);
    let title = rows.title;
    let detail = rows.detail;
    if (!detail && !bullets.length) {
      title = `Stage ${i + 1}`;
      detail = raw;
    }
    let duration: string | undefined;
    if (dur) {
      duration = shortenDurationChip(dur[0]);
      const strip = (s: string) =>
        s
          .replace(dur[0], '')
          .replace(/\s*[—–-]\s*$/g, '')
          .replace(/^\s*[—–-]\s*/g, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
      title = strip(title);
      detail = strip(detail);
      // Drop parenthetical / alternate-timing leftovers — chip stays the clean duration only
      detail = stripDurationFluff(detail);
      title = stripDurationFluff(title);
      if (isTimelineDurationFluff(detail)) detail = '';
    } else {
      // No chip match but detail is pure hedge — still hide it
      if (isTimelineDurationFluff(detail) && detail.length < 80) detail = '';
    }
    return {
      title: title.replace(/\.$/, '') || `Stage ${i + 1}`,
      detail,
      duration,
    };
  });
}

/** Strip “Usually needs a permit:” style labels and expand comma lists into rows. */
function expandCodesItems(items: string[]): string[] {
  const out: string[] = [];
  for (const raw of items) {
    let s = String(raw || '')
      .replace(/\*\*/g, '')
      .replace(
        /^(usually\s+)?(needs|doesn't need|does not need|doesnt need)\s+a\s+permit\s*:\s*/i,
        '',
      )
      .replace(/^(typically\s+needs|often\s+no)\s+(a\s+)?permit\s*:\s*/i, '')
      .trim();
    if (!s) continue;
    if (/,/.test(s) && !/^[^,]{0,40}:/.test(s.split(',')[0] || '')) {
      const parts = s
        .split(/,\s*(?:and\s+)?/)
        .map((p) => p.replace(/\.$/, '').trim())
        .filter(Boolean);
      if (parts.length > 1) {
        out.push(...parts);
        continue;
      }
    }
    out.push(s.replace(/\.$/, '').trim());
  }
  return out;
}

/** Needs permit vs usually no permit columns (### headings or keyword buckets). */
export function parseCodesColumns(body: string): {
  left: string[];
  right: string[];
  leftTitle: string;
  rightTitle: string;
  leftoverHtml: string;
} | null {
  const split = splitCompareColumns(body);
  if (split.left.length || split.right.length) {
    const leftIsNeed = /need|require|permit|yes/i.test(split.leftTitle);
    const rightIsNeed = /need|require|permit|yes/i.test(split.rightTitle);
    const leftIsSkip = /no permit|usually no|not required|doesn't|does not|skip/i.test(
      split.leftTitle,
    );
    if (leftIsSkip && rightIsNeed) {
      return {
        left: expandCodesItems(split.right),
        right: expandCodesItems(split.left),
        leftTitle: 'Typically needs a permit',
        rightTitle: 'Often no permit',
        leftoverHtml: split.leftoverHtml,
      };
    }
    return {
      left: expandCodesItems(leftIsNeed || !rightIsNeed ? split.left : split.right),
      right: expandCodesItems(leftIsNeed || !rightIsNeed ? split.right : split.left),
      leftTitle: 'Typically needs a permit',
      rightTitle: 'Often no permit',
      leftoverHtml: split.leftoverHtml,
    };
  }

  const bullets = extractBulletLines(body);
  if (bullets.length < 2) return null;
  const left: string[] = [];
  const right: string[] = [];
  for (const b of bullets) {
    if (/no permit|usually no|not required|doesn't need|does not need|cosmetic|like-for-like/i.test(b))
      right.push(b);
    else if (/permit|inspect|structural|electrical|plumbing|code/i.test(b)) left.push(b);
    else left.push(b);
  }
  if (!left.length && !right.length) return null;
  return {
    left: expandCodesItems(left),
    right: expandCodesItems(right),
    leftTitle: 'Typically needs a permit',
    rightTitle: 'Often no permit',
    leftoverHtml: '',
  };
}

/** Split plain DIY-vs-pro prose into two buckets when no ### headings. */
export function inferDiyProFromProse(body: string): { left: string[]; right: string[]; leftoverHtml: string } {
  const text = String(body || '').replace(/\r\n/g, '\n').trim();
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const left: string[] = [];
  const right: string[] = [];
  for (const s of sentences) {
    if (/\bdiy\b|yourself|tackle yourself|reasonable to/i.test(s)) left.push(s);
    else if (/\bpro\b|contractor|licensed|professional|hiring/i.test(s)) right.push(s);
  }
  if (left.length || right.length) {
    return { left, right, leftoverHtml: '' };
  }
  return { left: [], right: [], leftoverHtml: simpleProseToHtml(text) };
}
