/**
 * Zone neighbors are separate sites. This module feeds Full write a short copy
 * digest so those sites do not repeat each other's sentences.
 * Accept warnings live in content-seo-lint; they do not block Accept.
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathsFor } from './candidates.mjs';
import { shotgunSiblingMembers } from './shotgun.mjs';

const MAX_DIGEST_SITES = 8;

function readJson(file) {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function normalizeZoneDomain(domain) {
  return String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .replace(/\.$/, '');
}

function homeMarkdown(files) {
  const key = Object.keys(files || {}).find((p) => /(^|\/)pages\/index\.md$/i.test(p));
  return key ? String(files[key] || '') : '';
}

function stripFrontmatter(src) {
  const t = String(src || '').replace(/^\uFEFF/, '');
  if (!t.startsWith('---')) return t;
  const end = t.indexOf('\n---', 3);
  if (end < 0) return t;
  return t.slice(end + 4).replace(/^\r?\n/, '');
}

function unquote(s) {
  return String(s || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trim()}…`;
}

function leadParagraphs(raw) {
  const paras = stripFrontmatter(raw)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('#'));
  return paras.slice(0, 2).join(' ');
}

function sectionChunk(raw, headingRe) {
  const body = stripFrontmatter(raw);
  const parts = body.split(/^##\s+/m);
  for (const chunk of parts) {
    const nl = chunk.indexOf('\n');
    const heading = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
    if (headingRe.test(heading)) return nl < 0 ? '' : chunk.slice(nl + 1).trim();
  }
  return '';
}

function faqQuestions(raw) {
  const questions = [];
  for (const m of String(raw || '').matchAll(/^\s*-\s*question:\s*(.+)$/gim)) {
    questions.push(unquote(m[1]));
  }
  for (const m of stripFrontmatter(raw).matchAll(/^#{2,3}\s+(.+\?)\s*$/gm)) {
    questions.push(m[1].trim());
  }
  return [...new Set(questions)].slice(0, 4);
}

/** Title + sentence pairs from process frontmatter and materials bullets. */
export function photoBlockSentences(raw) {
  const t = String(raw || '');
  const fmEnd = t.startsWith('---') ? t.indexOf('\n---', 3) : -1;
  const fm = fmEnd > 0 ? t.slice(0, fmEnd) : '';
  const out = [];
  let title = '';
  for (const line of fm.split('\n')) {
    const tm = line.match(/^\s*-?\s*title:\s*(.+)$/);
    const dm = line.match(/^\s*-?\s*description:\s*(.+)$/);
    if (tm) title = unquote(tm[1]);
    else if (dm && title) {
      const sentence = unquote(dm[1]);
      if (sentence) out.push(`${title}: ${sentence}`);
      title = '';
    }
  }
  for (const m of stripFrontmatter(t).matchAll(/\*\*([^*]+)\*\*\s*[:—–-]\s*([^\n]+)/g)) {
    const sentence = m[2].trim();
    if (sentence) out.push(`${m[1].trim()}: ${sentence}`);
  }
  return out;
}

function digestForSite(sibling) {
  const files = sibling?.files || {};
  const home = homeMarkdown(files);
  const serviceBits = [];
  for (const [rel, raw] of Object.entries(files)) {
    if (!/services\/[^/]+\.md$/i.test(rel)) continue;
    serviceBits.push(...photoBlockSentences(raw).slice(0, 2));
  }
  const sentences = [...photoBlockSentences(home), ...serviceBits].slice(0, 4);
  const intro = clip(leadParagraphs(home), 240);
  const cost = clip(sectionChunk(home, /\bcost\b|\bpric/i), 180);
  const faqs = faqQuestions(home);
  if (!intro && !cost && !faqs.length && !sentences.length) return '';
  const lines = [`### ${sibling.city || 'Neighbor'}${sibling.state ? `, ${sibling.state}` : ''}`];
  if (intro) lines.push(`- Intro: ${intro}`);
  if (cost) lines.push(`- Cost: ${cost}`);
  if (faqs.length) lines.push(`- FAQs: ${faqs.join(' | ')}`);
  if (sentences.length) lines.push(`- Sentences already used: ${sentences.map((s) => clip(s, 140)).join(' · ')}`);
  return lines.join('\n');
}

/**
 * @param {Array<{ city?: string, state?: string, files?: Record<string, string> }>} siblings
 */
export function formatZoneSiblingDigest(siblings) {
  const blocks = [];
  for (const sibling of siblings || []) {
    if (blocks.length >= MAX_DIGEST_SITES) break;
    const block = digestForSite(sibling);
    if (block) blocks.push(block);
  }
  if (!blocks.length) return '';
  return `## Zone neighbors (do not copy)
These cities are separate sites. Keep the shared step and material titles. Rewrite the sentence under each title for this city (housing, soil, climate, or housing age). Do not reuse a neighbor's intro, cost angle, FAQ answers, or those sentences.

${blocks.join('\n\n')}
`;
}

/** Sibling roster with site-config domain and content-draft files (may be empty). */
export function loadZoneSiblingRoster(candidateId) {
  const out = [];
  for (const member of shotgunSiblingMembers(candidateId)) {
    if (!member?.candidateId) continue;
    const paths = pathsFor(member.candidateId);
    const cfg = readJson(paths.siteConfig) || {};
    const draft = readJson(paths.contentDraft);
    const files = draft?.files && typeof draft.files === 'object' ? draft.files : {};
    out.push({
      candidateId: member.candidateId,
      city: member.city || '',
      state: member.state || '',
      domain: normalizeZoneDomain(cfg.domain),
      files,
    });
  }
  return out;
}

export function formatZoneSiblingDigestForCandidate(candidateId) {
  try {
    return formatZoneSiblingDigest(loadZoneSiblingRoster(candidateId));
  } catch {
    return '';
  }
}

/** Opts spread into lintContentSeo. Soft warnings only. */
export function zoneLintContext(candidateId) {
  let zoneSiblings = [];
  let zoneLocationOverrides = [];
  try {
    zoneSiblings = loadZoneSiblingRoster(candidateId);
  } catch {
    zoneSiblings = [];
  }
  try {
    const cfg = readJson(pathsFor(candidateId).siteConfig) || {};
    zoneLocationOverrides = (cfg.clusterLocationPageOverrides || [])
      .map((n) => (typeof n === 'string' ? n : n?.name || ''))
      .map((n) => String(n || '').trim())
      .filter(Boolean);
  } catch {
    zoneLocationOverrides = [];
  }
  return { zoneSiblings, zoneLocationOverrides };
}
