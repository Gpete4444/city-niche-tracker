/**
 * Homepage / content body helpers for Astro pages.
 */

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

const SECTION_START_RE =
  /^(#{1,3}\s+|(?:why |our |how |what |when |ready |frequently |common |materials|cost|timeline|faq|process|services)\b)/i;

/**
 * When structured homepage sections exist, only keep intro paragraphs from the writer body
 * (avoid dumping services/process/FAQ prose that duplicates designed sections).
 */
export function extractHomepageIntro(
  rawBody: string,
  opts: { h1?: string; title?: string; sectionHeading?: string; maxParagraphs?: number } = {},
): string[] {
  const maxParagraphs = opts.maxParagraphs ?? 3;
  let text = stripLeadingTitleEcho(rawBody, opts.h1, opts.title, opts.sectionHeading);
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const intro: string[] = [];
  for (const block of blocks) {
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
  if (/\bcost\b|pricing|what does .+ cost|how much|estimate range/.test(t)) return 'cost';
  if (/^materials\b|materials and|methods we|\bmethods\b/.test(t)) return 'materials';
  if (/^how long\b|\btimeline\b|duration|schedule/.test(t)) return 'timeline';
  if (/\bdiy\b|hiring a pro|hire a pro/.test(t)) return 'diyVsPro';
  if (/when to call|when to book|warning signs/.test(t)) return 'whenToCall';
  if (/\bpermit|\bcodes?\b|compliance/.test(t)) return 'codes';
  return null;
}

/**
 * Pull Structure prose sections (cost/materials/timeline/…) out of homepage body
 * so they can render as designed bands instead of being dropped by intro-only extract.
 * Only markdown `#` / `##` / `###` lines are section boundaries (never body paragraphs).
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
    const md = raw.match(/^#{1,3}\s+(.+)$/);
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
    if (!id || !enabled.has(id) || found.has(id)) continue;
    found.set(id, { id, heading: chunk.heading, body: chunk.body });
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

/** Light markdown → HTML for homepage prose bands. */
export function simpleProseToHtml(src: string): string {
  const text = String(src || '').trim();
  if (!text) return '';
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
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
