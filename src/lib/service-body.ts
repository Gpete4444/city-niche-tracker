/**
 * Parse service-page markdown into structured sections for designed UI.
 * Accepts real ## headings or plain-line section titles (common in older writes).
 */

import { normTitle, simpleProseToHtml, stripLeadingTitleEcho } from './content-body';
import { fixSmallWords } from './small-words.mjs';
import { isCostHeading } from './is-cost-heading.mjs';
import { isProcessHeading } from './is-process-heading.mjs';
import { isMaterialsHeading } from './is-materials-heading.mjs';

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
  | 'beforeAfter'
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
  if (isProcessHeading(t)) return 'process';
  if (isCostHeading(heading)) return 'cost';
  if (isMaterialsHeading(t)) return 'materials';
  if (/how long|timeline|duration/.test(t)) return 'timeline';
  // "schedule" alone is too broad (matches process step lines); require timeline-ish phrasing
  if (/\bschedule\b/.test(t) && /how long|timeline|duration|take\?/.test(t)) return 'timeline';
  // Lone column titles belong inside a diyVsPro H2 — do not open a second DIY band
  if (/^(diy|hire a pro|hiring a pro|do it yourself)$/i.test(t.trim())) return 'other';
  if (/diy\s+vs|vs\s+hiring|hiring a pro|hire a pro|\bdiy\b/.test(t)) return 'diy';
  if (/when to call|when to book|warning signs/.test(t)) return 'whenToCall';
  if (/permit|code|codes/.test(t)) return 'codes';
  if (/before\s*(&|and)\s*after|before.after/.test(t)) return 'beforeAfter';
  if (/get a .+ estimate|ready for|request .+ estimate|contact us/.test(t)) return 'cta';
  if (/^professional |^about /.test(t) || /\bintro\b/.test(t)) return 'intro';
  return 'other';
}

/** True if a non-heading line looks like a section title (plain-text writers). */
function looksLikePlainHeading(line: string): boolean {
  const t = line.trim().replace(/^\*\*|\*\*$/g, '');
  if (!t || t.length > 110) return false;
  if (/^#{1,2}\s/.test(t)) return true;
  // ### stays inside a section (DIY / codes columns)
  if (/^#{3}\s/.test(t)) return false;
  if (/^[-*•]\s+/.test(t) || /^\d+[.)]\s+/.test(t)) return false;
  if (/\s[—–]\s/.test(t) || /\s-\s/.test(t)) return false;
  // Never promote FAQ questions or bold subheads into new sections
  if (/\?\s*$/.test(t)) return false;
  if (/^typically included\b/i.test(t)) return false;
  if (/[.!]$/.test(t) && t.split(/\s+/).length > 12) return false;
  const kind = classifyHeading(t);
  if (kind === 'other' || kind === 'intro') return false;
  if (kind === 'cost' && !/^(?:what (?:does|it)|costs?|prices?|priced|pricing)\b/i.test(t)) return false;
  if (kind === 'timeline' && !/^(how long|timeline)\b/i.test(t)) return false;
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
    // ## boundaries only — ### DIY / ### Hire a pro stay in body
    const md = raw.match(/^#{1,2}\s+(.+)$/);
    if (md) {
      flush();
      heading = md[1].trim();
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed && looksLikePlainHeading(trimmed) && (buf.length > 0 || !heading)) {
      const kind = classifyHeading(trimmed);
      if (kind !== 'other' && kind !== 'intro') {
        flush();
        heading = trimmed.replace(/^\*\*|\*\*$/g, '');
        continue;
      }
    }
    buf.push(raw);
  }
  flush();
  return chunks;
}

function stripBold(s: string): string {
  return String(s || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\*\*|\*\*$/g, '')
    .replace(/\*\*/g, '')
    .trim();
}

function parseProcessSteps(body: string): ServiceProcessStep[] {
  const steps: ServiceProcessStep[] = [];
  const lines = body
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const cleaned = stripBold(line.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, ''));
    const em = cleaned.match(/^(.+?)\s+[—–-]\s+(.+)$/);
    if (em) {
      steps.push({ title: fixSmallWords(em[1].trim()), description: em[2].trim() });
      continue;
    }
    const colon = cleaned.match(/^(.+?):\s+(.+)$/);
    if (colon && colon[1].split(/\s+/).length <= 8) {
      steps.push({ title: fixSmallWords(colon[1].trim()), description: colon[2].trim() });
      continue;
    }
  }
  return steps;
}

function looksLikeQuestion(line: string): boolean {
  const q = String(line || '').trim();
  if (!q) return false;
  return (
    /\?$/.test(q) ||
    /^(how|what|when|why|do |does |can |is |are |should |will )/i.test(q)
  );
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
    let qLine = stripBold((lines[0] || '').replace(/^#{1,3}\s+/, ''));
    let answer = stripBold(lines.slice(1).join(' ').trim());

    if (!answer && i + 1 < blocks.length) {
      const next = blocks[i + 1];
      const nextFirst = stripBold((next.split(/\n/)[0] || '').trim());
      if (!looksLikeQuestion(nextFirst)) {
        answer = stripBold(next.replace(/\n+/g, ' ').trim());
        i += 1;
      }
    }

    // Heal inverted pairs: first line is answer-ish, second block/line is the question
    if (qLine && answer && !looksLikeQuestion(qLine) && looksLikeQuestion(answer)) {
      const swappedQ = answer;
      const swappedA = qLine;
      qLine = swappedQ;
      answer = swappedA;
    }

    if (looksLikeQuestion(qLine) && qLine && answer) {
      faqs.push({ question: fixSmallWords(qLine), answer });
    }
    i += 1;
  }
  return faqs;
}

/** Escape + light markdown (paragraphs, lists, bold/italic, links) → HTML. */
export function simpleMarkdownToHtml(src: string): string {
  return simpleProseToHtml(src);
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
  const seenKinds = new Set<ServiceSectionKind>();
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

    // One band per kind (cost/timeline/scope/…) — extra FAQ-shaped headings stay out
    if (seenKinds.has(kind) && kind !== 'other' && kind !== 'faq') {
      continue;
    }
    seenKinds.add(kind);

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
