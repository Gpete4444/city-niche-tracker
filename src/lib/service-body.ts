/**
 * Parse service-page markdown into structured sections for designed UI.
 * Accepts real ## headings or plain-line section titles (common in older writes).
 */

import { normTitle, stripLeadingTitleEcho } from './content-body';

export type ServiceSectionKind =
  | 'intro'
  | 'scope'
  | 'process'
  | 'cost'
  | 'materials'
  | 'timeline'
  | 'faq'
  | 'diy'
  | 'whenToCall'
  | 'codes'
  | 'cta'
  | 'other';

export interface ServiceProcessStep {
  title: string;
  description: string;
}

export interface ServiceFaqItem {
  question: string;
  answer: string;
}

export interface ServiceBodySection {
  kind: ServiceSectionKind;
  heading: string;
  /** Raw markdown/plain body for prose kinds */
  body: string;
  steps?: ServiceProcessStep[];
  faqs?: ServiceFaqItem[];
}

export interface ParsedServiceBody {
  intro: string;
  sections: ServiceBodySection[];
}

function classifyHeading(heading: string): ServiceSectionKind {
  const t = normTitle(heading);
  if (/\bfaqs?\b|frequently asked|common questions/.test(t)) return 'faq';
  if (/what'?s included|what is included|\bscope\b|typically included/.test(t)) return 'scope';
  if (/process works|how (our |the )?.+process|how we (work|do)/.test(t)) return 'process';
  if (/\bcost\b|pricing|what does .+ cost|how much/.test(t)) return 'cost';
  if (/materials|methods/.test(t)) return 'materials';
  if (/how long|timeline|duration/.test(t)) return 'timeline';
  // "schedule" alone is too broad (matches process step lines); require timeline-ish phrasing
  if (/\bschedule\b/.test(t) && /how long|timeline|duration|take\?/.test(t)) return 'timeline';
  if (/diy|hiring a pro|hire a pro/.test(t)) return 'diy';
  if (/when to call|when to book|warning signs/.test(t)) return 'whenToCall';
  if (/permit|code|codes/.test(t)) return 'codes';
  if (/get a .+ estimate|ready for|request .+ estimate|contact us/.test(t)) return 'cta';
  if (/^professional |^about /.test(t) || /\bintro\b/.test(t)) return 'intro';
  return 'other';
}

/** True if a non-heading line looks like a section title (plain-text writers). */
function looksLikePlainHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 110) return false;
  if (/^#{1,3}\s/.test(t)) return true;
  if (/^[-*•]\s/.test(t) || /^\d+[.)]\s/.test(t)) return false;
  // Process steps: "Consult & Measure — We assess..."
  if (/\s[—–]\s/.test(t) || /\s-\s/.test(t)) return false;
  // Question lines are usually FAQ items; allow only known question-form section titles
  if (/\?\s*$/.test(t)) {
    return /^(what does|how long does|how much (does|is|are))\b/i.test(t);
  }
  if (/[.!]$/.test(t) && t.split(/\s+/).length > 12) return false;
  const kind = classifyHeading(t);
  if (kind === 'other') return false;
  // Avoid treating short body sentences as headings
  if (kind === 'intro') return /^(professional |about )/i.test(t);
  return true;
}

function splitIntoRawSections(text: string): Array<{ heading: string; body: string }> {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const chunks: Array<{ heading: string; body: string }> = [];
  let heading = '';
  let buf: string[] = [];

  const flush = () => {
    const body = buf.join('\n').trim();
    if (!heading && !body) return;
    chunks.push({ heading, body });
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
    const trimmed = raw.trim();
    if (trimmed && looksLikePlainHeading(trimmed) && buf.length > 0) {
      // Only treat as a new section heading when we already have content
      // OR when classify is strong (not 'other')
      const kind = classifyHeading(trimmed);
      if (kind !== 'other' && kind !== 'intro') {
        flush();
        heading = trimmed;
        continue;
      }
    }
    if (!heading && trimmed && looksLikePlainHeading(trimmed)) {
      const kind = classifyHeading(trimmed);
      if (kind !== 'other') {
        flush();
        heading = trimmed;
        continue;
      }
    }
    buf.push(raw);
  }
  flush();
  return chunks;
}

function parseProcessSteps(body: string): ServiceProcessStep[] {
  const steps: ServiceProcessStep[] = [];
  const lines = body
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const cleaned = line.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '');
    const em = cleaned.match(/^(.+?)\s+[—–-]\s+(.+)$/);
    if (em) {
      steps.push({ title: em[1].trim(), description: em[2].trim() });
      continue;
    }
    const colon = cleaned.match(/^(.+?):\s+(.+)$/);
    if (colon && colon[1].split(/\s+/).length <= 8) {
      steps.push({ title: colon[1].trim(), description: colon[2].trim() });
      continue;
    }
  }
  return steps;
}

function parseFaqs(body: string): ServiceFaqItem[] {
  const faqs: ServiceFaqItem[] = [];
  const blocks = body
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const qLine = lines[0] || '';
    const isQuestion =
      /\?$/.test(qLine) ||
      /^(how|what|when|why|do |does |can |is |are |should |will )/i.test(qLine);

    if (isQuestion) {
      const question = qLine.replace(/^#{1,3}\s+/, '').replace(/^\*\*|\*\*$/g, '').trim();
      let answer = lines.slice(1).join(' ').trim();
      if (!answer && i + 1 < blocks.length) {
        const next = blocks[i + 1];
        const nextFirst = (next.split(/\n/)[0] || '').trim();
        const nextIsQ =
          /\?$/.test(nextFirst) ||
          /^(how|what|when|why|do |does |can |is |are |should |will )/i.test(nextFirst);
        if (!nextIsQ) {
          answer = next.replace(/\n+/g, ' ').trim();
          i += 1;
        }
      }
      if (question && answer) faqs.push({ question, answer });
    }
    i += 1;
  }
  return faqs;
}

/** Escape + light markdown (paragraphs, lists, bold/italic) → HTML. */
export function simpleMarkdownToHtml(src: string): string {
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

export function parseServiceBody(
  rawBody: string,
  opts: { h1?: string; title?: string; serviceName?: string } = {},
): ParsedServiceBody {
  let text = stripLeadingTitleEcho(rawBody, opts.h1, opts.title, opts.serviceName);
  // Also drop a leading bare H1-style echo without ##
  const firstLine = text.split(/\n/).find((l) => l.trim()) || '';
  if (opts.h1 && normTitle(firstLine) === normTitle(opts.h1)) {
    text = text.replace(firstLine, '').trimStart();
  }

  const raw = splitIntoRawSections(text);
  const sections: ServiceBodySection[] = [];
  let intro = '';

  for (const chunk of raw) {
    const kind = chunk.heading ? classifyHeading(chunk.heading) : 'intro';

    if (!chunk.heading || kind === 'intro') {
      const piece = [chunk.heading && kind === 'intro' ? '' : '', chunk.body]
        .filter(Boolean)
        .join('\n\n')
        .trim();
      if (!intro) intro = piece || chunk.body;
      else if (piece) intro = `${intro}\n\n${piece}`;
      continue;
    }

    if (kind === 'cta') continue;

    if (kind === 'process') {
      const steps = parseProcessSteps(chunk.body);
      sections.push({
        kind,
        heading: chunk.heading,
        body: chunk.body,
        steps: steps.length ? steps : undefined,
      });
      continue;
    }

    if (kind === 'faq') {
      const faqs = parseFaqs(chunk.body);
      sections.push({
        kind,
        heading: chunk.heading,
        body: chunk.body,
        faqs: faqs.length ? faqs : undefined,
      });
      continue;
    }

    sections.push({ kind, heading: chunk.heading, body: chunk.body });
  }

  // If nothing classified and no intro, use whole body as intro (fallback)
  if (!intro && !sections.length && text.trim()) {
    intro = text.trim();
  }

  return { intro, sections };
}
