/**
 * Content markdown handoff from accepted site-config.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  extractPromptTemplate,
  getCandidateDetail,
  pathsFor,
  readPromptFile,
  saveMeta,
  RESEARCH_DIR,
} from './candidates.mjs';

const ROOT = process.cwd();
const CONTENT_ROOT = path.join(ROOT, 'src', 'content');
const COLLECTIONS = ['pages', 'services', 'locations'];
const ALLOWED_PATH_RE = /^src\/content\/(pages|services|locations)\/[a-z0-9][a-z0-9-]*\.md$/i;

/** Homepage-first required paths (Writer / Import from disk). */
export const HOMEPAGE_FIRST_PATHS = [
  'src/content/pages/index.md',
  'src/content/pages/about.md',
  'src/content/pages/contact.md',
];

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function slugifyContentName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function stripOps(config) {
  if (!config || typeof config !== 'object') return null;
  const { _ops, ...clean } = config;
  return clean;
}

export function loadAcceptedSiteConfig(candidateId) {
  const p = pathsFor(candidateId);
  const fromCandidate = stripOps(readJson(p.siteConfig));
  if (fromCandidate) return { config: fromCandidate, source: 'candidate' };
  const meta = readJson(p.meta) || {};
  if (meta.siteConfigPath === 'src/config/site-config.json') {
    const live = stripOps(readJson(path.join(ROOT, 'src', 'config', 'site-config.json')));
    if (live) return { config: live, source: 'live' };
  }
  return null;
}

export function assertContentHandoffReady(candidateId) {
  const detail = getCandidateDetail(candidateId);
  const flags = detail.stageFlags || {};
  if (!flags.hasSiteConfig && !loadAcceptedSiteConfig(candidateId)) {
    const err = new Error('Accept site-config first (writes research/{id}-site-config.json)');
    err.status = 400;
    throw err;
  }
  const loaded = loadAcceptedSiteConfig(candidateId);
  if (!loaded?.config) {
    const err = new Error('No accepted site-config JSON found for this candidate');
    err.status = 400;
    throw err;
  }
  return { detail, config: loaded.config, source: loaded.source };
}

/** Normalize pasted/disk path to src/content/{pages|services|locations}/name.md */
export function normalizeContentRelPath(rel) {
  let next = String(rel || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  if (next.startsWith('/')) next = next.slice(1);
  // Absolute Windows/Unix paths → strip down to src/content/...
  const absIdx = next.toLowerCase().indexOf('src/content/');
  if (absIdx >= 0) next = next.slice(absIdx);
  if (/^(pages|services|locations)\//i.test(next)) {
    next = `src/content/${next}`;
  }
  return next;
}

function isAllowedContentPath(rel) {
  return ALLOWED_PATH_RE.test(rel);
}

/** Body is empty or Claude Code “Written to…” commentary without markdown. */
export function isEmptyOrWrittenToBody(body) {
  const s = String(body || '').trim();
  if (!s) return true;
  if (s.startsWith('---')) return false;
  if (/^```/.test(s)) return false;
  if (/^written to\b/i.test(s)) return true;
  if (s.length < 280 && /written to\b|short stub|full homepage/i.test(s) && !/^#/m.test(s)) {
    return true;
  }
  return false;
}

/**
 * Read markdown files from the live src/content tree into a files map.
 * @param {string[]} rels
 * @returns {{ files: Record<string,string>, missing: string[] }}
 */
export function readContentFilesFromDisk(rels) {
  const files = {};
  const missing = [];
  for (const raw of rels || []) {
    const rel = normalizeContentRelPath(raw);
    if (!isAllowedContentPath(rel)) {
      missing.push(rel);
      continue;
    }
    const abs = path.join(ROOT, ...rel.split('/'));
    if (!existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    let body = readFileSync(abs, 'utf8');
    if (!body.endsWith('\n')) body = `${body}\n`;
    files[rel] = body;
  }
  return { files, missing };
}

/**
 * Collect FILE markers from paste (### FILE: or FILE:) and Claude Code path lines.
 * @returns {{ path: string, index: number, length: number }[]}
 */
function findContentFileMarkers(text) {
  const markers = [];
  const seenAt = new Set();
  const add = (rel, index, length) => {
    const norm = normalizeContentRelPath(rel);
    if (!norm || seenAt.has(index)) return;
    seenAt.add(index);
    markers.push({ path: norm, index, length });
  };

  const fileLine = /^(?:#{1,3}\s*)?FILE:\s*(.+?)\s*$/gim;
  let m;
  while ((m = fileLine.exec(text)) !== null) {
    add(m[1], m.index, m[0].length);
  }

  // Claude Code style: Written to src/content/... or Written to `src/content/...`
  const written = /Written to\s+`?([^\s`]+\.md)`?/gi;
  while ((m = written.exec(text)) !== null) {
    const rel = normalizeContentRelPath(m[1]);
    if (isAllowedContentPath(rel) || /src\/content\//i.test(rel) || /[\\/](pages|services|locations)[\\/]/i.test(m[1])) {
      add(m[1], m.index, m[0].length);
    }
  }

  // Write c:\...\src\content\pages\index.md (tool log)
  const writeAbs = /Write\s+([^\s]+[\\/]src[\\/]content[\\/][^\s]+\.md)/gi;
  while ((m = writeAbs.exec(text)) !== null) {
    add(m[1], m.index, m[0].length);
  }

  markers.sort((a, b) => a.index - b.index);
  // Dedupe by path keeping first occurrence
  const byPath = new Map();
  for (const mk of markers) {
    if (!byPath.has(mk.path)) byPath.set(mk.path, mk);
  }
  return [...byPath.values()].sort((a, b) => a.index - b.index);
}

/**
 * Parse Claude / Claude Code output into { "src/content/...": "full markdown" }.
 * Accepts ### FILE: / FILE: blocks; empty or “Written to” bodies fall back to disk.
 */
export function parseContentFileBlocks(raw, { allowDiskFallback = true } = {}) {
  const text = String(raw || '').trim();
  if (!text) {
    const err = new Error('Paste is empty');
    err.status = 400;
    throw err;
  }

  const matches = findContentFileMarkers(text);
  if (!matches.length) {
    const err = new Error(
      'No FILE blocks found — paste ### FILE: src/content/pages/index.md blocks, or use Import from src/content after Claude Code writes the files',
    );
    err.status = 400;
    throw err;
  }

  const files = {};
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index + matches[i].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    let rel = normalizeContentRelPath(matches[i].path);
    if (!isAllowedContentPath(rel)) {
      const err = new Error(
        `Invalid content path "${rel}" — must be src/content/{pages|services|locations}/kebab-name.md`,
      );
      err.status = 400;
      throw err;
    }
    let body = text.slice(start, end).trim();
    body = body.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '').trim();

    if (isEmptyOrWrittenToBody(body) && allowDiskFallback) {
      const disk = readContentFilesFromDisk([rel]);
      if (disk.files[rel]) {
        body = disk.files[rel].trim();
      }
    }

    if (isEmptyOrWrittenToBody(body) || !body) {
      const err = new Error(
        `Empty content for ${rel} — include markdown under ### FILE:, or write the file then use Import from src/content`,
      );
      err.status = 400;
      throw err;
    }
    if (files[rel]) {
      const err = new Error(`Duplicate FILE block for ${rel}`);
      err.status = 400;
      throw err;
    }
    files[rel] = ensureYamlFrontmatter(body);
  }

  return files;
}

/**
 * Load homepage_first (or listed) paths from disk into a files map.
 */
export function loadHomepageContentFromDisk(mode = 'homepage_first') {
  const rels =
    mode === 'homepage_first'
      ? [...HOMEPAGE_FIRST_PATHS]
      : listContentMarkdownFiles().map((f) => f.rel);
  const { files, missing } = readContentFilesFromDisk(rels);
  if (mode === 'homepage_first' && missing.length) {
    const err = new Error(
      `Missing on disk: ${missing.join(', ')}. Have Claude Code write those paths, then Import again.`,
    );
    err.status = 400;
    err.missing = missing;
    throw err;
  }
  if (!Object.keys(files).length) {
    const err = new Error('No markdown files found under src/content/');
    err.status = 400;
    throw err;
  }
  return files;
}

function splitFrontmatter(markdown) {
  const m = String(markdown || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { ok: false, error: 'Missing YAML frontmatter (--- ... ---)' };
  return { ok: true, frontmatter: m[1], body: m[2] || '' };
}

/**
 * Recover markdown when Claude omits opening/closing `---` around YAML frontmatter.
 * Leaves already-delimited files unchanged.
 */
export function ensureYamlFrontmatter(markdown) {
  let s = String(markdown || '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!s) return s;

  if (/^---\r?\n/.test(s)) {
    return s.endsWith('\n') ? s : `${s}\n`;
  }

  const head = s.split(/\n/).slice(0, 8).join('\n');
  if (!/^(title|description|h1)\s*:/m.test(head)) {
    return s.endsWith('\n') ? s : `${s}\n`;
  }

  const lines = s.split(/\n/);
  let fmEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (!L.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j += 1;
      if (j >= lines.length) {
        fmEnd = i;
        break;
      }
      const next = lines[j];
      const nextYaml =
        /^[a-zA-Z0-9_]+\s*:/.test(next) || /^\s+- /.test(next) || /^\s{2,}\S/.test(next);
      if (!nextYaml) {
        fmEnd = i;
        break;
      }
      continue;
    }
    const looksYaml =
      /^[a-zA-Z0-9_]+\s*:/.test(L) || /^\s+- /.test(L) || /^\s{2,}\S/.test(L);
    if (looksYaml) continue;
    fmEnd = i;
    break;
  }

  if (fmEnd < 0) {
    return `---\n${s}\n---\n`;
  }

  const fm = lines.slice(0, fmEnd).join('\n').trimEnd();
  const body = lines.slice(fmEnd).join('\n').replace(/^\n+/, '');
  const out = body.trim() ? `---\n${fm}\n---\n\n${body.trimEnd()}\n` : `---\n${fm}\n---\n`;
  return out;
}

function normalizeContentFilesMap(files) {
  const out = {};
  for (const [rel, markdown] of Object.entries(files || {})) {
    out[rel] = ensureYamlFrontmatter(markdown);
  }
  return out;
}

function fmHasKey(fm, key) {
  return new RegExp(`^${key}\\s*:`, 'm').test(fm);
}

/**
 * Lightweight frontmatter + required-file checks against site-config.
 * @param {{ mode?: 'homepage_first'|'full' }} opts
 */
export function validateContentBundle(files, siteConfig, { mode = 'full' } = {}) {
  const errors = [];
  const warnings = [];
  const paths = Object.keys(files || {});
  const archetype = String(siteConfig?.siteArchetype || 'multi_service');
  const isSingle = archetype === 'single_service';
  const homepageFirst = mode === 'homepage_first';

  const requiredPages = [
    'src/content/pages/index.md',
    'src/content/pages/about.md',
    'src/content/pages/contact.md',
  ];
  for (const req of requiredPages) {
    if (!files[req]) errors.push(`Missing required file: ${req}`);
  }

  const serviceNames = Array.isArray(siteConfig?.services) ? siteConfig.services : [];
  const expectedServiceSlugs = serviceNames.map(slugifyContentName).filter(Boolean);
  const serviceFiles = paths.filter((p) => p.startsWith('src/content/services/'));
  const locationFiles = paths.filter((p) => p.startsWith('src/content/locations/'));

  if (!homepageFirst) {
    if (isSingle) {
      if (serviceFiles.length > 1) {
        warnings.push(`Type B: prefer ≤1 service page; got ${serviceFiles.length}`);
      }
    } else if (!serviceFiles.length) {
      errors.push('No services/*.md files (Type A requires service pages)');
    } else if (expectedServiceSlugs.length && serviceFiles.length < expectedServiceSlugs.length) {
      warnings.push(
        `Expected ~${expectedServiceSlugs.length} service file(s); got ${serviceFiles.length}`,
      );
    }
    for (const slug of expectedServiceSlugs) {
      const expected = `src/content/services/${slug}.md`;
      if (!files[expected] && !isSingle) {
        warnings.push(`No exact match for service slug "${slug}"`);
      }
    }
    if (locationFiles.length < 4 || locationFiles.length > 6) {
      warnings.push(`Location pages: got ${locationFiles.length}, prefer 4–6`);
    }
  } else if (serviceFiles.length > 1 && isSingle) {
    warnings.push('homepage_first Type B: unexpected multiple service files');
  }

  for (const [rel, markdown] of Object.entries(files || {})) {
    const split = splitFrontmatter(markdown);
    if (!split.ok) {
      errors.push(`${rel}: ${split.error}`);
      continue;
    }
    const { frontmatter: fm, body } = split;
    for (const key of ['title', 'description', 'h1']) {
      if (!fmHasKey(fm, key)) errors.push(`${rel}: missing frontmatter key "${key}"`);
    }

    if (rel.includes('/pages/')) {
      if (rel.endsWith('/index.md')) {
        for (const key of ['whyChooseUs', 'process', 'faqs']) {
          if (!fmHasKey(fm, key)) warnings.push(`${rel}: homepage usually needs "${key}"`);
        }
      }
    } else if (rel.includes('/services/')) {
      if (!fmHasKey(fm, 'serviceName')) errors.push(`${rel}: missing serviceName`);
    } else if (rel.includes('/locations/')) {
      if (!fmHasKey(fm, 'city')) errors.push(`${rel}: missing city`);
      if (!fmHasKey(fm, 'state')) errors.push(`${rel}: missing state`);
    }

    const bodyText = String(body || '').trim();
    if (!bodyText) warnings.push(`${rel}: empty body`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    mode,
    archetype,
    summary: {
      total: paths.length,
      pages: paths.filter((p) => p.startsWith('src/content/pages/')).length,
      services: serviceFiles.length,
      locations: locationFiles.length,
    },
  };
}

export function buildContentPrompt(candidateId) {
  const { config } = assertContentHandoffReady(candidateId);
  const md = readPromptFile('prompts/claude-markdown.md');
  const template = extractPromptTemplate(md);
  const configJson = JSON.stringify(config, null, 2);
  // Main ```text fence + SITE CONFIG paste block
  const prompt = `${template}\n\nSITE CONFIG:\n${configJson}`;
  return { prompt, config };
}

export function pasteContentDraft(candidateId, raw) {
  const { config } = assertContentHandoffReady(candidateId);
  const files = parseContentFileBlocks(raw);
  const onlyPages = Object.keys(files).every((p) => p.startsWith('src/content/pages/'));
  const resolvedMode = onlyPages ? 'homepage_first' : 'full';
  const check = validateContentBundle(files, config, { mode: resolvedMode });
  const p = pathsFor(candidateId);
  writeJson(p.contentDraft, {
    files,
    _ops: {
      savedAt: new Date().toISOString(),
      source: 'paste',
      mode: resolvedMode,
      siteArchetype: config.siteArchetype || null,
      check,
      fileList: Object.keys(files).sort(),
    },
  });
  saveMeta(candidateId, { lastContentDraftAt: new Date().toISOString() });
  return {
    ok: true,
    draft: readJson(p.contentDraft),
    check,
    candidate: getCandidateDetail(candidateId),
  };
}

export function getContentDraft(candidateId) {
  return readJson(pathsFor(candidateId).contentDraft);
}

function listContentMarkdownFiles() {
  const out = [];
  for (const coll of COLLECTIONS) {
    const dir = path.join(CONTENT_ROOT, coll);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md') && !name.endsWith('.mdx')) continue;
      out.push({
        rel: `src/content/${coll}/${name}`.replace(/\\/g, '/'),
        abs: path.join(dir, name),
      });
    }
  }
  return out;
}

function backupContentTree(stamp) {
  const backupRoot = path.join(RESEARCH_DIR, '_content-backups', stamp);
  mkdirSync(backupRoot, { recursive: true });
  const copied = [];
  for (const file of listContentMarkdownFiles()) {
    const dest = path.join(backupRoot, file.rel.replace(/^src\/content\//, ''));
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(file.abs, dest);
    copied.push(file.rel);
  }
  return { backupRoot: path.relative(ROOT, backupRoot).replace(/\\/g, '/'), copied };
}

function yamlDoubleQuote(value) {
  return `"${String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')}"`;
}

function readMdFrontmatterField(absPath, key) {
  if (!existsSync(absPath)) return null;
  const raw = readFileSync(absPath, 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const prefix = `${key}:`;
  const line = m[1].split(/\r?\n/).find((l) => l.trimStart().startsWith(prefix));
  if (!line) return null;
  return line
    .trim()
    .slice(prefix.length)
    .trim()
    .replace(/^["']|["']$/g, '');
}

function buildLocationStubMarkdown({ city, state, niche, primaryCity }) {
  const stateUp = String(state || '').trim().toUpperCase();
  const title = `${niche} in ${city}, ${stateUp}`;
  const h1 = `${niche} in ${city}`;
  const description = `${niche} for ${city} homeowners and property owners near ${primaryCity}. Request a free estimate.`;
  const body = `${city} is part of our ${primaryCity} service area for ${niche}. Call or use the estimate form to schedule a visit.\n`;
  return `---
title: ${yamlDoubleQuote(title)}
description: ${yamlDoubleQuote(description)}
h1: ${yamlDoubleQuote(h1)}
city: ${yamlDoubleQuote(city)}
state: ${yamlDoubleQuote(stateUp)}
draft: false
---

${body}`;
}

/** Remove location pages whose frontmatter state does not match site-config. */
export function pruneWrongStateLocations(siteState) {
  const pruned = [];
  const locDir = path.join(CONTENT_ROOT, 'locations');
  if (!existsSync(locDir)) return pruned;
  const want = String(siteState || '')
    .trim()
    .toLowerCase();
  if (!want) return pruned;
  for (const name of readdirSync(locDir)) {
    if (!name.endsWith('.md') || name.startsWith('_')) continue;
    const abs = path.join(locDir, name);
    const state = readMdFrontmatterField(abs, 'state');
    if (!state) continue;
    if (String(state).trim().toLowerCase() !== want) {
      unlinkSync(abs);
      pruned.push(`src/content/locations/${name}`);
    }
  }
  return pruned;
}

/**
 * Seed short location stubs for targetSuburbs (skips primary city; only if missing).
 * @returns {{ written: string[], seeded: string[], files: Record<string,string> }}
 */
export function seedTargetSuburbLocationStubs(config) {
  const written = [];
  const seeded = [];
  const files = {};
  const niche = String(config?.niche || 'Local services').trim() || 'Local services';
  const state = String(config?.state || '').trim().toUpperCase();
  const primaryCity = String(config?.primaryCity || '').trim();
  const primaryKey = primaryCity.toLowerCase();
  const locDir = path.join(CONTENT_ROOT, 'locations');
  mkdirSync(locDir, { recursive: true });

  for (const suburb of config?.targetSuburbs || []) {
    const city = String(suburb || '').trim();
    if (!city) continue;
    if (city.toLowerCase() === primaryKey) continue;
    const slug = slugifyContentName(city);
    if (!slug) continue;
    const rel = `src/content/locations/${slug}.md`;
    const abs = path.join(ROOT, ...rel.split('/'));
    if (existsSync(abs)) continue;
    const markdown = buildLocationStubMarkdown({ city, state, niche, primaryCity });
    const body = markdown.endsWith('\n') ? markdown : `${markdown}\n`;
    writeFileSync(abs, body, 'utf8');
    written.push(rel);
    seeded.push(rel);
    files[rel] = body;
  }
  return { written, seeded, files };
}

function buildServiceStubMarkdown({ serviceName, niche, primaryCity, order }) {
  const title = `${serviceName} in ${primaryCity}`;
  const h1 = serviceName;
  const description = `${serviceName} for homeowners in ${primaryCity} and nearby cities. Request a free estimate.`;
  const body = `${serviceName} is part of our ${niche} offering in ${primaryCity}. Call or use the estimate form to schedule a visit.\n`;
  return `---
title: ${yamlDoubleQuote(title)}
description: ${yamlDoubleQuote(description)}
h1: ${yamlDoubleQuote(h1)}
serviceName: ${yamlDoubleQuote(serviceName)}
order: ${Number.isFinite(order) ? order : 99}
draft: false
---

${body}`;
}

/** Remove service pages whose serviceName is not in the allowed list. */
export function pruneUnmatchedServices(siteServices) {
  const pruned = [];
  const svcDir = path.join(CONTENT_ROOT, 'services');
  if (!existsSync(svcDir)) return pruned;
  const allowed = new Set(
    (siteServices || []).map((s) => String(s || '').trim().toLowerCase()).filter(Boolean),
  );
  if (!allowed.size) return pruned;
  for (const name of readdirSync(svcDir)) {
    if (!name.endsWith('.md') || name.startsWith('_')) continue;
    const abs = path.join(svcDir, name);
    const serviceName = readMdFrontmatterField(abs, 'serviceName');
    if (!serviceName) continue;
    if (!allowed.has(String(serviceName).trim().toLowerCase())) {
      unlinkSync(abs);
      pruned.push(`src/content/services/${name}`);
    }
  }
  return pruned;
}

function configuredServiceNames(config) {
  const seen = new Set();
  const out = [];
  for (const raw of [...(config?.services || []), ...(config?.commercialServices || [])]) {
    const name = String(raw || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Seed short service stubs for site.services + commercialServices (only if missing).
 * @returns {{ written: string[], seeded: string[], files: Record<string,string> }}
 */
export function seedServiceStubs(config) {
  const written = [];
  const seeded = [];
  const files = {};
  const niche = String(config?.niche || 'Local services').trim() || 'Local services';
  const primaryCity = String(config?.primaryCity || '').trim() || 'your area';
  const svcDir = path.join(CONTENT_ROOT, 'services');
  mkdirSync(svcDir, { recursive: true });

  configuredServiceNames(config).forEach((serviceName, index) => {
    const slug = slugifyContentName(serviceName);
    if (!slug) return;
    const rel = `src/content/services/${slug}.md`;
    const abs = path.join(ROOT, ...rel.split('/'));
    if (existsSync(abs)) return;
    const markdown = buildServiceStubMarkdown({
      serviceName,
      niche,
      primaryCity,
      order: index + 1,
    });
    const body = markdown.endsWith('\n') ? markdown : `${markdown}\n`;
    writeFileSync(abs, body, 'utf8');
    written.push(rel);
    seeded.push(rel);
    files[rel] = body;
  });
  return { written, seeded, files };
}

/**
 * Write draft Markdown into src/content/, prune leftovers not in the bundle.
 */
export function acceptContent(candidateId, { ignoreWarnings = false } = {}) {
  const { config } = assertContentHandoffReady(candidateId);
  const p = pathsFor(candidateId);
  const draft = readJson(p.contentDraft);
  if (!draft?.files || typeof draft.files !== 'object') {
    const err = new Error('No content draft — paste Claude FILE blocks first');
    err.status = 400;
    throw err;
  }

  const files = normalizeContentFilesMap(draft.files);
  const onlyPages = Object.keys(files).every((rel) => rel.startsWith('src/content/pages/'));
  const mode =
    draft._ops?.mode === 'homepage_first' || draft._ops?.mode === 'full'
      ? draft._ops.mode
      : onlyPages
        ? 'homepage_first'
        : 'full';
  const check = validateContentBundle(files, config, { mode });
  if (!check.ok) {
    const err = new Error(`Content validation failed: ${check.errors.slice(0, 3).join('; ')}`);
    err.status = 400;
    err.check = check;
    throw err;
  }
  if (check.warnings.length && !ignoreWarnings) {
    const err = new Error(
      `Content warnings: ${check.warnings.slice(0, 3).join('; ')}. Pass ignoreWarnings to proceed.`,
    );
    err.status = 400;
    err.check = check;
    throw err;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = backupContentTree(stamp);

  const written = [];
  const acceptedFiles = {};
  for (const [rel, markdown] of Object.entries(files)) {
    if (!ALLOWED_PATH_RE.test(rel)) continue;
    const abs = path.join(ROOT, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    const body = markdown.endsWith('\n') ? markdown : `${markdown}\n`;
    writeFileSync(abs, body, 'utf8');
    written.push(rel);
    acceptedFiles[rel] = body;
  }

  const keep = new Set(written);
  const pruned = [];
  for (const file of listContentMarkdownFiles()) {
    if (keep.has(file.rel)) continue;
    // homepage_first: only prune orphan pages/*.md here — services/locations handled below
    if (mode === 'homepage_first' && !file.rel.startsWith('src/content/pages/')) continue;
    unlinkSync(file.abs);
    pruned.push(file.rel);
  }

  let seeded = [];
  if (mode === 'homepage_first') {
    pruned.push(...pruneWrongStateLocations(config.state));
    pruned.push(...pruneUnmatchedServices(configuredServiceNames(config)));
    const locationStubs = seedTargetSuburbLocationStubs(config);
    const serviceStubs = seedServiceStubs(config);
    written.push(...locationStubs.written, ...serviceStubs.written);
    seeded = [...locationStubs.seeded, ...serviceStubs.seeded];
    Object.assign(acceptedFiles, locationStubs.files, serviceStubs.files);
  }

  const accepted = {
    files: acceptedFiles,
    _ops: {
      acceptedAt: new Date().toISOString(),
      writtenTo: 'src/content/',
      backup: backup.backupRoot,
      written,
      pruned,
      seeded,
      check,
      mode,
      fromDraft: true,
      nextStep:
        mode === 'homepage_first'
          ? 'optional full Writer pass for services/locations, or npm run build'
          : 'npm run build',
    },
  };
  writeJson(p.content, accepted);
  if (existsSync(p.contentDraft)) unlinkSync(p.contentDraft);
  saveMeta(candidateId, {
    lastContentAt: new Date().toISOString(),
    contentBackup: backup.backupRoot,
    contentMode: mode,
  });

  return {
    ok: true,
    written,
    pruned,
    seeded,
    backup: backup.backupRoot,
    check,
    mode,
    nextStep: accepted._ops.nextStep,
    candidate: getCandidateDetail(candidateId),
  };
}
