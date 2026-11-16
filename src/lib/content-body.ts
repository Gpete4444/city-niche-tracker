/**
 * Homepage / content body helpers for Astro pages.
 */
import siteConfig from '../config/site-config.json' with { type: 'json' };
import { sitePath } from './site-path';
import { isCostHeading } from './is-cost-heading.mjs';
import { isMaterialsHeading } from './is-materials-heading.mjs';
import { unwrapBusinessSelfLinks } from './unwrap-business-self-link.mjs';
import { fixSmallWords } from './small-words.mjs';
import { polishServiceArticleHeading } from './service-article-heading.mjs';
import { linkifyProsePhones } from './linkify-prose-phone.mjs';

export { fixSmallWords };

export { unwrapBusinessSelfLinks };

/** Normalize for title comparison. */
export function normTitle(s: string): string {
  return String(s || '')
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/^["']|["']$/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Drop a leading body line that duplicates frontmatter h1/title.
 */
export function stripLeadingTitleEcho(body: string, ...titles: Array<string | undefined>): string {
  const lines = String(body || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const echoes = new Set(titles.map((t) => normTitle(t || '')).filter(Boolean));
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  if (i < lines.length && echoes.has(normTitle(lines[i]))) {
    i += 1;
    while (i < lines.length && !lines[i].trim()) i += 1;
  }
  return lines.slice(i).join('\n').trimStart();
}

/** Uppercase a leading lowercase letter. A niche mid-sentence stays as written. */
export function leadCapital(s: string): string {
  return String(s || '').replace(/^(\s*)([a-z])/, (_full, space, ch) => space + ch.toUpperCase());
}

const NICHE_ACRONYMS = new Set(['hvac', 'ac', 'llc', 'inc', 'seo', 'led', 'pvc']);

function titleCaseNichePiece(piece: string): string {
  if (!piece) return piece;
  const lower = piece.toLowerCase();
  if (NICHE_ACRONYMS.has(lower)) return piece.toUpperCase();
  if (/^[A-Z]{2,}$/.test(piece)) return piece;
  if (/[A-Z]/.test(piece)) return piece;
  return piece.replace(/[a-z]/, (ch) => ch.toUpperCase());
}

/** Title-case each word of a niche, including hyphen parts. Existing capitals and short acronyms stay. */
function titleCaseNicheWords(raw: string): string {
  const s = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  return fixSmallWords(
    s
      .split(' ')
      .map((word) => word.split('-').map(titleCaseNichePiece).join('-'))
      .join(' '),
  );
}

/**
 * When a line starts with the niche, title-case that niche. Otherwise capitalize one leading letter.
 * A niche later in the line stays as written.
 */
export function leadNiche(text: string, niche?: string | null): string {
  const source = String(text ?? '');
  const label = String(niche ?? '').trim();
  if (label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`^(\\s*)(?:${escaped})(?=$|[^A-Za-z0-9])`, 'i'));
    if (match) {
      return match[1] + titleCaseNicheWords(label) + source.slice(match[0].length);
    }
  }
  return leadCapital(source);
}

/** Title-case every whole niche phrase in a heading. A longer word that only starts with the niche stays. */
function replaceNichePhrase(text: string, niche: string): string {
  const label = titleCaseNicheWords(niche);
  if (!label) return text;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'gi'), label);
}

/**
 * Hero titles title-case every niche phrase. Other headings do that only when they contain the
 * business name. Every other heading still title-cases a niche only when the line starts with it.
 */
export function headingNicheCase(
  text: string,
  niche?: string | null,
  businessName?: string | null,
  opts?: { hero?: boolean },
): string {
  const source = String(text ?? '');
  const rawNiche = String(niche ?? '').trim();
  const cased = !rawNiche
    ? fixSmallWords(leadCapital(source))
    : opts?.hero ||
        (String(businessName ?? '').trim().length > 0 &&
          source.toLowerCase().includes(String(businessName ?? '').trim().toLowerCase()))
      ? fixSmallWords(leadCapital(replaceNichePhrase(source, rawNiche)))
      : fixSmallWords(leadNiche(source, rawNiche));
  return polishServiceArticleHeading(cased);
}

/** Capitalize a process blurb and add a period when it reads as a sentence. */
export function sentenceCaseLine(s: string): string {
  let t = String(s || '').trim();
  if (!t) return '';
  t = t.replace(/^[a-z]/, (c) => c.toUpperCase());
  if (!/[.!?…]$/.test(t) && t.split(/\s+/).filter(Boolean).length >= 3) t += '.';
  return t;
}

const SECTION_START_RE =
  /^(#{1,3}\s+|(?:why |our |how |what |when |ready |frequently |common |materials|cost|timeline|faq|process|services)\b)/i;

/** Link-injector comment and the nav list under it are not homepage intro copy. */
function isHomepageIntroJunk(block: string): boolean {
  const t = String(block || '').trim();
  if (!t) return true;
  if (/^<!--[\s\S]*-->$/.test(t)) return true;
  if (/rover-autofix-links/i.test(t)) return true;
  const lines = t.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^[-*]\s+\[[^\]]+\]\([^)]+\)/.test(line));
}

/**
 * When structured homepage sections exist, only keep intro paragraphs from the writer body
 * (avoid dumping services/process/FAQ prose that duplicates designed sections).
 */
export function extractHomepageIntro(
  rawBody: string,
  opts: { h1?: string; title?: string; sectionHeading?: string; maxParagraphs?: number } = {},
): string[] {
  const maxParagraphs = opts.maxParagraphs ?? 2;
  let text = stripLeadingTitleEcho(rawBody, opts.h1, opts.title, opts.sectionHeading);
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const intro: string[] = [];
  for (const block of blocks) {
    if (isHomepageIntroJunk(block)) continue;
    const firstLine = block.split(/\n/)[0] || '';
    if (intro.length > 0 && SECTION_START_RE.test(firstLine.trim())) break;
    // Skip lone heading-like lines without paragraph body
    if (/^#{1,3}\s/.test(firstLine) && block.split(/\n/).length === 1) continue;
    // Flatten soft line breaks inside a paragraph block
    const para = block
      .replace(/^#{1,3}\s+.*$/m, '')
      .replace(/\n+/g, ' ')
      .trim();
    if (!para) continue;
    if (opts.sectionHeading && normTitle(para) === normTitle(opts.sectionHeading)) continue;
    intro.push(para);
    if (intro.length >= maxParagraphs) break;
  }
  return intro;
}

/** True when homepage uses designed section components that replace long body dumps. */
export function homepageUsesStructuredSections(sectionList: string[] | null | undefined): boolean {
  if (!sectionList || !sectionList.length) return true; // default template uses structured sections
  return ['services', 'whyChooseUs', 'process', 'faqs', 'offerProcess'].some((k) =>
    sectionList.includes(k),
  );
}

export type HomepageProseSectionId =
  | 'cost'
  | 'materials'
  | 'timeline'
  | 'codes'
  | 'diyVsPro'
  | 'whenToCall';

export interface HomepageProseSection {
  id: HomepageProseSectionId;
  heading: string;
  body: string;
}

function classifyProseHeading(heading: string): HomepageProseSectionId | null {
  const t = normTitle(heading);
  // Lone column titles belong inside a diyVsPro H2 — do not open a band
  if (/^(diy|hire a pro|hiring a pro)$/i.test(t.trim())) return null;
  // DIY / yourself-vs before cost so hybrid “Cost … Yourself vs …” does not steal cost
  if (
    /\bdiy\b|hiring a pro|hire a pro|do[\s-]?it[\s-]?yourself|yourself\s+vs|vs\.?\s+(hire|a\s+pro|pro|professional|contractor)/.test(
      t,
    )
  ) {
    return 'diyVsPro';
  }
  if (isCostHeading(heading)) return 'cost';
  if (isMaterialsHeading(heading)) return 'materials';
  if (/^how long\b|\btimeline\b|duration|schedule/.test(t)) return 'timeline';
  if (/when to call|when to book|warning signs/.test(t)) return 'whenToCall';
  if (/\bpermit|\bcodes?\b|compliance/.test(t)) return 'codes';
  return null;
}

/** Same money shape as parseCostRows — avoid importing section-parse (circular). */
const COST_MONEY_RE =
  /\$[\d,]+(?:\.\d+)?(?:\s*[–—-]\s*\$?[\d,]+(?:\.\d+)?)?\+?(?:\s*[kK])?/;

/** True when body bullets would yield at least one parseCostRows table row. */
function bodyHasCostTableRows(body: string): boolean {
  const bullets = String(body || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+/.test(l) || /^\d+[.)]\s+/.test(l))
    .map((l) =>
      l
        .replace(/^[-*•]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .trim(),
    );
  for (const raw of bullets) {
    const money = raw.match(COST_MONEY_RE);
    if (!money) continue;
    const withoutMoney = `${raw.slice(0, money.index)}${raw.slice((money.index || 0) + money[0].length)}`
      .replace(/\(\s*\)/g, '')
      .replace(/^\+?\s*[—–-]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    const parts = withoutMoney
      .split(/\s+[—–]\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
    let title = '';
    if (parts.length >= 1) {
      title = parts[0].replace(/[:\-–—]+$/, '').replace(/\(\s*$/, '').trim();
      if (!title && parts[0]) {
        const colon = parts[0].match(/^(.+?):\s*(.*)$/);
        title = (colon ? colon[1] : parts[0]).replace(/\(\s*$/, '').trim();
      }
    }
    if (title) return true;
  }
  return false;
}

/**
 * Pull Structure prose sections (cost/materials/timeline/…) out of homepage body
 * so they can render as designed bands instead of being dropped by intro-only extract.
 * Only markdown `#` / `##` lines are section boundaries (`###` stays inside a section body).
 */
export function extractHomepageProseSections(
  rawBody: string,
  opts: { h1?: string; title?: string; sectionHeading?: string; enabledIds?: string[] | null } = {},
): HomepageProseSection[] {
  const enabled = opts.enabledIds?.length
    ? new Set(opts.enabledIds)
    : new Set<string>(['cost', 'materials', 'timeline', 'codes', 'diyVsPro', 'whenToCall']);

  let text = stripLeadingTitleEcho(rawBody, opts.h1, opts.title, opts.sectionHeading);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const chunks: Array<{ heading: string; body: string }> = [];
  let heading = '';
  let buf: string[] = [];

  const flush = () => {
    const body = buf.join('\n').trim();
    if (heading || body) chunks.push({ heading, body });
    heading = '';
    buf = [];
  };

  for (const raw of lines) {
    const md = raw.match(/^#{1,2}\s+(.+)$/);
    if (md) {
      flush();
      heading = md[1].trim();
      continue;
    }
    buf.push(raw);
  }
  flush();

  const found = new Map<HomepageProseSectionId, HomepageProseSection>();
  for (const chunk of chunks) {
    if (!chunk.heading || !chunk.body) continue;
    const id = classifyProseHeading(chunk.heading);
    if (!id || !enabled.has(id)) continue;
    const next: HomepageProseSection = { id, heading: chunk.heading, body: chunk.body };
    const prev = found.get(id);
    if (!prev) {
      found.set(id, next);
      continue;
    }
    // Prefer the cost chunk whose bullets parse as a cost table (teaser vs $ rows)
    if (id === 'cost' && !bodyHasCostTableRows(prev.body) && bodyHasCostTableRows(next.body)) {
      found.set(id, next);
    }
  }

  // Stable Structure-ish order
  const order: HomepageProseSectionId[] = [
    'cost',
    'materials',
    'timeline',
    'codes',
    'diyVsPro',
    'whenToCall',
  ];
  return order.map((id) => found.get(id)).filter(Boolean) as HomepageProseSection[];
}

const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escAttr = (s: string) =>
  escHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Inline light markdown: links, bold, italic. Strips image markdown
 * (images belong in frontmatter / designed slots — never leave raw `![]()`).
 */
export function inlineLightMarkdown(src: string): string {
  let s = linkifyProsePhones(String(src || ''), {
    businessName: String(siteConfig.businessName || ''),
    phone: String(siteConfig.phone || ''),
  });
  s = unwrapBusinessSelfLinks(s, String(siteConfig.businessName || ''));
  // Drop body images entirely (broken paths otherwise leak as literal text)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '');
  const links: string[] = [];
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    const i = links.length;
    const safeHref = String(href || '').trim();
    if (!safeHref || /^javascript:/i.test(safeHref)) {
      links.push(escHtml(String(label || '')));
    } else {
      links.push(
        `<a href="${escAttr(sitePath(safeHref))}">${escHtml(String(label || ''))}</a>`,
      );
    }
    return `\u0000L${i}\u0000`;
  });
  return escHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\u0000L(\d+)\u0000/g, (_m, i) => links[Number(i)] || '');
}

/** Light markdown → HTML for homepage prose bands. */
export function simpleProseToHtml(src: string): string {
  const text = String(src || '').trim();
  if (!text) return '';
  const inline = inlineLightMarkdown;
  const blocks = text.split(/\n{2,}/);
  const html: string[] = [];
  for (const block of blocks) {
    const lines = block.split(/\n/).map((l) => l.trimEnd());
    const isUl = lines.every((l) => !l.trim() || /^[-*•]\s+/.test(l.trim()));
    const isOl = lines.every((l) => !l.trim() || /^\d+[.)]\s+/.test(l.trim()));
    if (isUl && lines.some((l) => l.trim())) {
      html.push(
        `<ul>${lines
          .filter((l) => l.trim())
          .map((l) => `<li>${inline(l.trim().replace(/^[-*•]\s+/, ''))}</li>`)
          .join('')}</ul>`,
      );
      continue;
    }
    if (isOl && lines.some((l) => l.trim())) {
      html.push(
        `<ol>${lines
          .filter((l) => l.trim())
          .map((l) => `<li>${inline(l.trim().replace(/^\d+[.)]\s+/, ''))}</li>`)
          .join('')}</ol>`,
      );
      continue;
    }
    const para = lines.map((l) => l.trim()).filter(Boolean).join(' ');
    if (para) html.push(`<p>${inline(para)}</p>`);
  }
  return html.join('\n');
}

export function proseSectionEyebrow(id: HomepageProseSectionId): string {
  switch (id) {
    case 'cost':
      return 'Cost';
    case 'materials':
      return 'Materials';
    case 'timeline':
      return 'Timeline';
    case 'codes':
      return 'Codes & permits';
    case 'diyVsPro':
      return 'DIY vs pro';
    case 'whenToCall':
      return 'When to call';
    default:
      return 'Details';
  }
}
