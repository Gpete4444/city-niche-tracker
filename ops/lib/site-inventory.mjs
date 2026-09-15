/**
 * Local page + word counts for launched Rover sites.
 * Prefers assembled markdown, then staging, then accepted content.json.
 * Words = markdown body plus visible YAML copy (h1, FAQs, process, why-choose).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { pathsFor } from './candidates.mjs';

const ROOT = process.cwd();
const COLLECTIONS = ['pages', 'services', 'locations'];
const CONTENT_REL_RE = /^src\/content\/(pages|services|locations)\/[^/]+\.mdx?$/i;

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function emptyInventory() {
  return { pageCount: null, wordCount: null, source: null };
}

/** Strip YAML frontmatter so word counts are body copy only. */
export function stripFrontmatter(md) {
  const s = String(md || '');
  const m = s.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? s.slice(m[0].length) : s;
}

/**
 * Split markdown into YAML object + body. Invalid YAML still returns the body.
 * @returns {{ fm: Record<string, unknown>, body: string }}
 */
export function parseMarkdownFrontmatter(md) {
  const s = String(md || '');
  const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, body: s };
  let fm = {};
  try {
    const parsed = parseYaml(m[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) fm = parsed;
  } catch {
    /* keep empty fm */
  }
  return { fm, body: s.slice(m[0].length) };
}

function pushStr(parts, value) {
  const s = String(value || '').trim();
  if (s) parts.push(s);
}

/**
 * Live-page YAML strings: h1, description, whyChooseUs, process, faqs.
 * Ignores browser `title` and image paths.
 */
export function yamlCopyFromFrontmatter(fm) {
  const parts = [];
  if (!fm || typeof fm !== 'object') return '';
  pushStr(parts, fm.h1);
  pushStr(parts, fm.description);
  for (const item of fm.whyChooseUs || []) {
    if (!item || typeof item !== 'object') continue;
    pushStr(parts, item.title);
    pushStr(parts, item.description);
  }
  for (const item of fm.process || []) {
    if (!item || typeof item !== 'object') continue;
    pushStr(parts, item.title);
    pushStr(parts, item.description);
  }
  for (const item of fm.faqs || []) {
    if (!item || typeof item !== 'object') continue;
    pushStr(parts, item.question);
    pushStr(parts, item.answer);
  }
  return parts.join(' ');
}

/** Body words plus visible YAML copy for one markdown file. */
export function countMarkdownWords(md) {
  const { fm, body } = parseMarkdownFrontmatter(md);
  return countBodyWords(body) + countBodyWords(yamlCopyFromFrontmatter(fm));
}

/** Same split as content-seo-lint countWords (markdown punctuation stripped). */
export function countBodyWords(text) {
  return String(text || '')
    .replace(/[#>*_`[\]()|-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

function isContentMarkdownRel(rel) {
  return CONTENT_REL_RE.test(String(rel || '').replace(/\\/g, '/'));
}

/**
 * @param {Record<string, string>} files
 * @param {string | null} source
 */
export function inventoryFromFiles(files, source = 'files') {
  const rels = Object.keys(files || {}).filter(isContentMarkdownRel);
  let wordCount = 0;
  for (const rel of rels) {
    wordCount += countMarkdownWords(files[rel]);
  }
  return {
    pageCount: rels.length,
    wordCount,
    source: rels.length ? source : null,
  };
}

/** Read src/content/{pages,services,locations}/*.md from a content root. */
export function scanContentTree(contentRoot) {
  const files = {};
  if (!contentRoot || !existsSync(contentRoot)) return files;
  for (const coll of COLLECTIONS) {
    const dir = path.join(contentRoot, coll);
    if (!existsSync(dir)) continue;
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/\.mdx?$/i.test(name)) continue;
      const abs = path.join(dir, name);
      const rel = `src/content/${coll}/${name}`.replace(/\\/g, '/');
      try {
        files[rel] = readFileSync(abs, 'utf8');
      } catch {
        /* skip unreadable */
      }
    }
  }
  return files;
}

function absFromRepoRel(rel) {
  if (!rel) return null;
  return path.isAbsolute(rel) ? rel : path.resolve(ROOT, rel);
}

/**
 * Same lookup order as siteContentInventory, but returns the markdown map.
 * @param {{ candidateId?: string }} site
 * @returns {{ files: Record<string, string>, source: string | null }}
 */
export function loadSiteContentFiles(site) {
  const candidateId = String(site?.candidateId || '').trim();
  if (!candidateId) return { files: {}, source: null };

  try {
    const p = pathsFor(candidateId);
    const meta = readJson(p.meta) || {};
    const assembledAbs = absFromRepoRel(meta.assembledSitePath);
    if (assembledAbs) {
      const files = scanContentTree(path.join(assembledAbs, 'src', 'content'));
      if (Object.keys(files).length) return { files, source: 'assembled' };
    }

    const stagingFiles = scanContentTree(path.join(p.siteStaging, 'src', 'content'));
    if (Object.keys(stagingFiles).length) return { files: stagingFiles, source: 'staging' };

    const accepted = readJson(p.content);
    if (accepted?.files && Object.keys(accepted.files).length) {
      return { files: accepted.files, source: 'content-json' };
    }
    const draft = readJson(p.contentDraft);
    if (draft?.files && Object.keys(draft.files).length) {
      return { files: draft.files, source: 'content-draft' };
    }
  } catch {
    /* missing candidate or bad id */
  }

  return { files: {}, source: null };
}

/**
 * Count pages/words for a launched portfolio row (candidateId required).
 * @param {{ candidateId?: string }} site
 */
export function siteContentInventory(site) {
  const { files, source } = loadSiteContentFiles(site);
  if (!Object.keys(files).length) return emptyInventory();
  const inv = inventoryFromFiles(files, source);
  return inv.pageCount ? inv : emptyInventory();
}
