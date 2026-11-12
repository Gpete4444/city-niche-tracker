/**
 * Content markdown handoff from accepted site-config.
 */

import { parse as parseYaml } from 'yaml';
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
  getCandidateShell,
  pathsFor,
  readPromptFile,
  saveMeta,
  RESEARCH_DIR,
} from './candidates.mjs';
import {
  assertLaunchContentComplete,
  expectedLaunchContentPaths,
  listLaunchContentGaps,
  outlineRequiresFullContent,
  resolveStructurePageIds,
} from './preview-fidelity.mjs';
import { isMaterialsHeading } from '../../src/lib/is-materials-heading.mjs';
import { applyStoredNichePhotoBlocks } from './niche-photo-blocks.mjs';
import { buildRequiredLinksByFile, lintContentSeo } from './content-seo-lint.mjs';
import { zoneLintContext } from './zone-site-diff.mjs';
import {
  extractSocialProofSidecar,
  ensureRoverSocialProofSeed,
} from './content-social-proof.mjs';
import {
  homepageDesignedSectionWarning,
  applyHomepageDesignedSectionLiftToFiles,
  healLocationFrontmatter,
  healPageFrontmatter,
  healServiceFrontmatter,
  locationPageHeadings,
  stampHomepageLiftOnDraftOps,
} from './content-auto-fix.mjs';
import { locationCountMatchesSite } from './template-contract.mjs';

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

function serviceFileSlug(rel) {
  return String(rel || '')
    .split('/')
    .pop()
    .replace(/\.md$/i, '');
}

/**
 * Slugs for services + commercialServices. Null when the config has no names yet,
 * so an empty list does not wipe service pages.
 * @param {object|null|undefined} config
 * @returns {Set<string>|null}
 */
export function allowedServiceSlugSet(config) {
  const names = [];
  const seen = new Set();
  for (const raw of [...(config?.services || []), ...(config?.commercialServices || [])]) {
    const name = String(raw || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  if (!names.length) return null;
  const slugs = new Set(names.map((name) => slugifyContentName(name)).filter(Boolean));
  return slugs.size ? slugs : null;
}

function stripRemovedServiceLinks(markdown, removedSlugs) {
  if (!removedSlugs?.size) return String(markdown || '');
  return String(markdown || '')
    .split('\n')
    .flatMap((line) => {
      const next = line.replace(
        /\[([^\]]*)\]\((?:\/)?services\/([a-z0-9-]+)\/?\)/g,
        (full, _text, slug) => (removedSlugs.has(slug) ? '' : full),
      );
      if (/^\s*[-*]\s*$/.test(next)) return [];
      return [next];
    })
    .join('\n');
}

/**
 * Drop service MD that Structure / Type B / the current service list does not want.
 * - Structure without `services` page → remove all `services/*.md`
 * - Site-config with at least one service name → remove services/*.md whose slug is not on that list
 * - Type B (`single_service`) with Services page → keep ≤1 (prefer primary site-config service slug)
 *
 * @param {Record<string, string>} files
 * @param {{ pageIds?: string[]|null, siteConfig?: object|null, siteArchetype?: string|null }} opts
 */
export function pruneFilesToStructure(
  files,
  { pageIds = null, siteConfig = null, siteArchetype = null } = {},
) {
  const out = { ...(files && typeof files === 'object' ? files : {}) };
  const pages = Array.isArray(pageIds) && pageIds.length ? pageIds : null;
  const wantsServices = !pages || pages.includes('services');
  const archetype = String(siteArchetype || siteConfig?.siteArchetype || 'multi_service');
  const isSingle = archetype === 'single_service';
  let serviceKeys = Object.keys(out).filter((p) => p.startsWith('src/content/services/'));
  if (!serviceKeys.length) return out;

  if (!wantsServices) {
    for (const key of serviceKeys) delete out[key];
    return out;
  }

  const allowed = allowedServiceSlugSet(siteConfig);
  if (allowed) {
    for (const key of serviceKeys) {
      if (!allowed.has(serviceFileSlug(key))) delete out[key];
    }
    serviceKeys = Object.keys(out).filter((p) => p.startsWith('src/content/services/'));
  }

  if (isSingle && serviceKeys.length > 1) {
    const primarySlug = slugifyContentName(
      (Array.isArray(siteConfig?.services) && siteConfig.services[0]) || '',
    );
    const preferred = primarySlug ? `src/content/services/${primarySlug}.md` : '';
    const keep = preferred && out[preferred] ? preferred : [...serviceKeys].sort()[0];
    for (const key of serviceKeys) {
      if (key !== keep) delete out[key];
    }
  }
  return out;
}

/**
 * Drop service pages that are not on the accepted site-config list.
 * Writes the draft and accepted content when a page is removed, and strips links to those slugs.
 * Does nothing when the config has no service names. Does not clear the services write-batch stamp.
 * @param {string} candidateId
 * @returns {{ removed: string[] }}
 */
export function purgeUnusedServicePages(candidateId) {
  const loaded = loadAcceptedSiteConfig(candidateId);
  const config = loaded?.config;
  if (!allowedServiceSlugSet(config)) return { removed: [] };
  const pageIds = resolveStructurePageIds(candidateId);
  const p = pathsFor(candidateId);
  const removed = [];
  for (const key of ['contentDraft', 'content']) {
    const doc = readJson(p[key]);
    if (!doc?.files || typeof doc.files !== 'object') continue;
    const before = Object.keys(doc.files);
    const nextFiles = pruneFilesToStructure(doc.files, {
      pageIds,
      siteConfig: config,
      siteArchetype: config.siteArchetype,
    });
    const removedRels = before.filter(
      (rel) => rel.startsWith('src/content/services/') && !Object.prototype.hasOwnProperty.call(nextFiles, rel),
    );
    if (!removedRels.length) continue;
    const removedSlugs = new Set(removedRels.map(serviceFileSlug));
    for (const rel of Object.keys(nextFiles)) {
      nextFiles[rel] = stripRemovedServiceLinks(nextFiles[rel], removedSlugs);
    }
    doc.files = nextFiles;
    if (Array.isArray(doc._ops?.fileList)) {
      const live = new Set(Object.keys(nextFiles));
      doc._ops.fileList = doc._ops.fileList.filter((rel) => live.has(rel));
    }
    writeJson(p[key], doc);
    removed.push(...removedRels);
  }
  return { removed };
}

/** Delete every services/*.md on disk (Structure excluded Services pages). */
export function pruneAllServiceMarkdownFromDisk() {
  const pruned = [];
  const svcDir = path.join(CONTENT_ROOT, 'services');
  if (!existsSync(svcDir)) return pruned;
  for (const name of readdirSync(svcDir)) {
    if (!name.endsWith('.md') || name.startsWith('_')) continue;
    unlinkSync(path.join(svcDir, name));
    pruned.push(`src/content/services/${name}`);
  }
  return pruned;
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

function stripPathDecorations(rel) {
  return String(rel || '')
    .trim()
    .replace(/^[`"']+|[`"']+$/g, '');
}

/**
 * A FILE line wrapped after a short prefix. The next line is the rest of the name.
 * `src/content/services/pool` + `-surround-turf.md`.
 */
function stitchWrappedContentPath(text, marker) {
  const path = marker.path;
  if (/\.md$/i.test(path)) return { path, consumed: 0 };
  const rest = text.slice(marker.index + marker.length);
  const match = rest.match(/^\r?\n(-[a-z0-9]+(?:-[a-z0-9]+)*\.md)[ \t]*(?:\r?\n|$)/i);
  if (!match) return { path, consumed: 0 };
  return { path: `${path}${match[1]}`, consumed: match[0].length };
}

/**
 * Map a cut-off FILE path onto a real page.
 * A wrapped or exact slug wins over a shortened prefix. Two prefixes are left unmapped.
 * @param {string} rel
 * @param {string[]} [expectedPaths]
 * @returns {string|null}
 */
export function resolveContentFilePath(rel, expectedPaths = []) {
  const expected = (expectedPaths || []).map((item) => normalizeContentRelPath(item)).filter(Boolean);
  const next = normalizeContentRelPath(stripPathDecorations(rel));
  if (!next) return null;
  if (isAllowedContentPath(next)) {
    return expected.find((item) => item.toLowerCase() === next.toLowerCase()) || next;
  }
  const exact = /\.md$/i.test(next) ? next : `${next}.md`;
  if (isAllowedContentPath(exact)) {
    const found = expected.find((item) => item.toLowerCase() === exact.toLowerCase());
    if (found) return found;
    if (!expected.length) return exact;
  }
  const base = next.replace(/\.md$/i, '').toLowerCase();
  const prefs = expected.filter((item) => {
    const lower = item.toLowerCase();
    if (!lower.startsWith(base)) return false;
    const tail = lower.slice(base.length);
    return tail.startsWith('-') && lower.endsWith('.md');
  });
  return prefs.length === 1 ? prefs[0] : null;
}

function contentPathHeaderIsFull(pathAfterStitch, expectedPaths = []) {
  const norm = normalizeContentRelPath(stripPathDecorations(pathAfterStitch));
  if (isAllowedContentPath(norm)) return true;
  const exact = /\.md$/i.test(norm) ? norm : `${norm}.md`;
  if (!isAllowedContentPath(exact)) return false;
  if (!expectedPaths.length) return true;
  return expectedPaths.some((item) => item.toLowerCase() === exact.toLowerCase());
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
export function parseContentFileBlocks(raw, { allowDiskFallback = true, expectedPaths = [] } = {}) {
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

  const expected = (expectedPaths || []).map((item) => normalizeContentRelPath(item)).filter(Boolean);
  const files = {};
  const fullHeader = {};
  const unmapped = [];
  for (let i = 0; i < matches.length; i += 1) {
    const stitched = stitchWrappedContentPath(text, matches[i]);
    const start = matches[i].index + matches[i].length + stitched.consumed;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const rel = resolveContentFilePath(stitched.path, expected);
    if (!rel) {
      unmapped.push(normalizeContentRelPath(stitched.path));
      continue;
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
    const markdown = sanitizeMarkdownImageFrontmatter(ensureYamlFrontmatter(body));
    const wasFull = contentPathHeaderIsFull(stitched.path, expected);
    if (files[rel]) {
      if (wasFull && !fullHeader[rel]) {
        files[rel] = markdown;
        fullHeader[rel] = true;
      }
      continue;
    }
    files[rel] = markdown;
    fullHeader[rel] = wasFull;
  }

  if (!Object.keys(files).length) {
    const rel = unmapped[0] || normalizeContentRelPath(matches[0].path);
    const err = new Error(
      `Invalid content path "${rel}" — must be src/content/{pages|services|locations}/kebab-name.md`,
    );
    err.status = 400;
    throw err;
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

function rebuildMarkdownFromParts(fm, body) {
  const bodyOut = String(body || '').startsWith('\n') ? body : `\n${body || ''}`;
  const out = `---\n${String(fm).trimEnd()}\n---${bodyOut}`;
  return out.endsWith('\n') ? out : `${out}\n`;
}

function tryParseYamlMapping(fm) {
  try {
    const data = parseYaml(String(fm || ''));
    if (data == null || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: 'frontmatter must be a YAML mapping' };
    }
    return { ok: true, data };
  } catch (e) {
    const msg = String(e?.message || e)
      .split('\n')[0]
      .replace(/\s+/g, ' ')
      .trim();
    return { ok: false, error: msg || 'YAML parse error' };
  }
}

function stripDanglingYamlScalar(raw) {
  let value = String(raw ?? '');
  const doubleOpen = value.startsWith('"');
  const singleOpen = value.startsWith("'");
  const doubleClosed = doubleOpen && /(?:^"|[^\\])"$/.test(value);
  const singleClosed = singleOpen && value.length >= 2 && value.endsWith("'");
  if (doubleOpen && !doubleClosed) {
    value = value.slice(1);
  } else if (singleOpen && !singleClosed) {
    value = value.slice(1);
  } else if (doubleOpen && doubleClosed) {
    value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  } else if (singleOpen && singleClosed) {
    value = value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/**
 * Re-quote scalars Claude left unclosed or with inner quotes.
 * Includes indented list fields (`  - title`, `    description`) and top-level keys.
 */
export function healYamlScalarQuotes(fm) {
  if (tryParseYamlMapping(fm).ok) return String(fm || '');
  const lines = String(fm || '').split('\n');
  const out = [];
  let changed = false;
  for (const line of lines) {
    const m = line.match(/^([ \t]*(?:-[ \t]+)?)([A-Za-z_][\w]*)[ \t]*:[ \t]*(.*)$/);
    if (!m) {
      out.push(line);
      continue;
    }
    const indent = m[1];
    const key = m[2];
    const rest = m[3];
    if (!rest || rest === '|' || rest === '>' || rest.startsWith('{') || rest.startsWith('[')) {
      out.push(line);
      continue;
    }
    if (tryParseYamlMapping(`${key}: ${rest}`).ok) {
      out.push(line);
      continue;
    }
    out.push(`${indent}${key}: ${yamlDoubleQuote(stripDanglingYamlScalar(rest))}`);
    changed = true;
  }
  return changed ? out.join('\n') : String(fm || '');
}

/**
 * Tabs → 2 spaces, then indent process/whyChooseUs/faqs (and similar) list items
 * that Claude left at column 0, and pull over-indented image/src/alt back to the
 * dash’s sibling column. Re-quotes broken title/description scalars. Returns
 * healed markdown even if parse still fails.
 */
export function healYamlFrontmatter(markdown) {
  const split = splitFrontmatter(markdown);
  if (!split.ok) return { markdown, healed: false, parseOk: false, error: split.error };
  const original = split.frontmatter;
  let fm = String(original).replace(/\t/g, '  ');
  fm = healYamlListIndent(fm);
  if (!tryParseYamlMapping(fm).ok) fm = healYamlScalarQuotes(fm);
  const parsed = tryParseYamlMapping(fm);
  return {
    markdown: fm === original ? markdown : rebuildMarkdownFromParts(fm, split.body),
    healed: fm !== original,
    parseOk: parsed.ok,
    error: parsed.ok ? null : parsed.error,
  };
}

export function yamlFrontmatterErrorRels(check) {
  const out = [];
  for (const raw of check?.errors || []) {
    const m = String(raw).match(/^([^:]+):\s*invalid YAML frontmatter/i);
    if (m) out.push(m[1].replace(/\\/g, '/'));
  }
  return out;
}

/**
 * After heal, drop leftover invalid YAML FILEs from this paste (keep prior draft).
 * Throw-or-skip is decided by the caller when every pasted FILE is still invalid.
 */
export function revertInvalidYamlPasteFiles(files, priorFiles, pastedRels, check) {
  const pasted = new Set((pastedRels || []).map((rel) => String(rel).replace(/\\/g, '/')));
  const bad = yamlFrontmatterErrorRels(check).filter((rel) => !pasted.size || pasted.has(rel));
  const next = { ...(files && typeof files === 'object' ? files : {}) };
  const skipped = [];
  for (const rel of bad) {
    const key = String(rel || '').replace(/\\/g, '/');
    if (!key) continue;
    if (priorFiles && priorFiles[key] != null) next[key] = priorFiles[key];
    else delete next[key];
    skipped.push(key);
  }
  return { files: next, skipped };
}

/**
 * Keep a complete 3-wide materials row (cap 6). 4→3, 5→3, 7→6, 8→6; 1–2 stay.
 * Shared with Review slot counts — do not use a 2–4 col fitter (4 would become 2×2).
 */
export function keepMaterialsRowCount(n) {
  const count = Math.max(0, Math.floor(Number(n) || 0));
  if (count < 3) return count;
  return Math.min(6, Math.floor(count / 3) * 3);
}

function isMaterialsMethodsHeading(line) {
  const m = String(line || '').match(/^#{1,2}\s+(.+)$/);
  if (!m) return false;
  return isMaterialsHeading(m[1]);
}

function isMaterialsOptionBullet(line) {
  const t = String(line || '').trim();
  return /^[-*•]\s+/.test(t) || /^\d+[.)]\s+/.test(t);
}

function trimMaterialsSectionBullets(body) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  let changed = false;
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!isMaterialsMethodsHeading(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    out.push(lines[i]);
    i += 1;
    const sectionLines = [];
    while (i < lines.length && !/^#{1,2}\s+/.test(lines[i])) {
      sectionLines.push(lines[i]);
      i += 1;
    }
    const bulletIdx = [];
    for (let j = 0; j < sectionLines.length; j += 1) {
      if (isMaterialsOptionBullet(sectionLines[j])) bulletIdx.push(j);
    }
    const keep = keepMaterialsRowCount(bulletIdx.length);
    if (keep < bulletIdx.length) {
      const drop = new Set(bulletIdx.slice(keep));
      out.push(...sectionLines.filter((_, j) => !drop.has(j)));
      changed = true;
    } else {
      out.push(...sectionLines);
    }
  }
  return { body: out.join('\n'), changed };
}

function countMaterialsOptionBullets(body) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  let count = 0;
  let inSection = false;
  for (const line of lines) {
    if (isMaterialsMethodsHeading(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{1,2}\s+/.test(line)) break;
    if (inSection && isMaterialsOptionBullet(line)) count += 1;
  }
  return count;
}

function sliceFmListToCount(fm, key, keep) {
  const lines = String(fm || '').split('\n');
  const start = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  if (start < 0) return { fm, changed: false };
  let end = start + 1;
  while (end < lines.length) {
    if (/^[A-Za-z_][\w]*\s*:/.test(lines[end]) && !/^[ \t]/.test(lines[end])) break;
    end += 1;
  }
  const head = lines[start];
  const block = lines.slice(start + 1, end);
  const itemStarts = [];
  for (let i = 0; i < block.length; i += 1) {
    if (/^[ \t]*-(?!-)[ \t]/.test(block[i])) itemStarts.push(i);
  }
  if (itemStarts.length <= keep) return { fm, changed: false };
  if (keep <= 0) {
    return { fm: [...lines.slice(0, start), ...lines.slice(end)].join('\n'), changed: true };
  }
  const cut = itemStarts[keep];
  let keptBlock = block.slice(0, cut);
  while (keptBlock.length && !keptBlock[keptBlock.length - 1].trim()) keptBlock.pop();
  return {
    fm: [...lines.slice(0, start), head, ...keptBlock, ...lines.slice(end)].join('\n'),
    changed: true,
  };
}

/**
 * Drop leftover materials/methods option bullets so the 3-wide grid is full rows,
 * and slice `materialsImages:` to the same length. Homepage and service pages.
 */
export function healMaterialsCompleteRows(markdown) {
  const split = splitFrontmatter(markdown);
  if (!split.ok) {
    const trimmed = trimMaterialsSectionBullets(markdown);
    return { markdown: trimmed.changed ? trimmed.body : markdown, healed: trimmed.changed };
  }
  const bullets = trimMaterialsSectionBullets(split.body);
  const n = countMaterialsOptionBullets(bullets.body);
  const sliced =
    n > 0
      ? sliceFmListToCount(split.frontmatter, 'materialsImages', n)
      : { fm: split.frontmatter, changed: false };
  if (!bullets.changed && !sliced.changed) return { markdown, healed: false };
  return { markdown: rebuildMarkdownFromParts(sliced.fm, bullets.body), healed: true };
}

/** YAML indent heal, then materials 3-or-6 row trim, then empty image-list keys. Load / Stage / Assemble. */
export function healStagedMarkdown(markdown) {
  const yaml = healYamlFrontmatter(markdown);
  const rows = healMaterialsCompleteRows(yaml.markdown);
  let md = rows.markdown;
  let emptyKeys = false;
  const split = splitFrontmatter(md);
  if (split.ok) {
    const stripped = stripEmptyImageListKeys(split.frontmatter);
    if (stripped !== split.frontmatter) {
      md = rebuildMarkdownFromParts(stripped, split.body);
      emptyKeys = true;
    }
  }
  return {
    markdown: md,
    healed: yaml.healed || rows.healed || emptyKeys,
    parseOk: yaml.parseOk,
    error: yaml.error,
  };
}

function dashSiblingIndent(dashLine) {
  const prefix = String(dashLine || '').match(/^([ \t]*-[ \t]+)/);
  if (prefix) return ' '.repeat(prefix[1].length);
  const lead = String(dashLine || '').match(/^[ \t]*/)?.[0] || '';
  return `${lead}  `;
}

function healYamlListIndent(fm) {
  const lines = String(fm || '').split('\n');
  const out = [];
  let i = 0;
  const listKeyRe =
    /^(process|whyChooseUs|faqs|gallery|materialsImages|processImages|beforeAfterImages|serviceCardImages)\s*:\s*$/;
  const mappingListKeys = new Set(['process', 'whyChooseUs', 'faqs']);

  const consumeItemChildren = (keyIndent, nestedSrcAlt) => {
    const nestedIndent = `${keyIndent}  `;
    while (i < lines.length) {
      const c = lines[i];
      if (!c.trim()) {
        out.push(c);
        i += 1;
        continue;
      }
      if (/^[ \t]*- /.test(c)) break;
      if (/^[A-Za-z][\w]*\s*:/.test(c) && !/^[ \t]/.test(c)) break;
      const trimmed = c.trim();
      if (/^(title|description|question|answer|image)\s*:/.test(trimmed)) {
        out.push(keyIndent + trimmed);
        i += 1;
        continue;
      }
      if (/^(src|alt)\s*:/.test(trimmed)) {
        out.push((nestedSrcAlt ? nestedIndent : keyIndent) + trimmed);
        i += 1;
        continue;
      }
      out.push(c);
      i += 1;
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!listKeyRe.test(line)) {
      out.push(line);
      i += 1;
      continue;
    }
    const keyName = line.match(/^([A-Za-z]\w*)/)[1];
    const nestedSrcAlt = mappingListKeys.has(keyName);
    out.push(line);
    i += 1;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        out.push(l);
        i += 1;
        continue;
      }
      if (/^[A-Za-z][\w]*\s*:/.test(l) && !/^[ \t]/.test(l) && !/^- /.test(l)) break;
      if (/^- /.test(l)) {
        const rewritten = `  ${l}`;
        out.push(rewritten);
        i += 1;
        consumeItemChildren(dashSiblingIndent(rewritten), nestedSrcAlt);
        continue;
      }
      if (/^[ \t]+- /.test(l)) {
        out.push(l);
        i += 1;
        consumeItemChildren(dashSiblingIndent(l), nestedSrcAlt);
        continue;
      }
      out.push(l);
      i += 1;
    }
  }
  return out.join('\n');
}

/** Load/Accept: do not stamp a draft whose frontmatter cannot parse. */
export function assertValidYamlFrontmatter(check) {
  const yamlErrs = (check?.errors || []).filter((e) => /invalid YAML frontmatter/i.test(String(e)));
  if (!yamlErrs.length) return;
  throw Object.assign(new Error(yamlErrs.join('\n')), { status: 400, check });
}

const IMAGE_FM_KEYS = ['heroImage', 'featureImage', 'cardImage', 'coverageMap'];
const IMAGE_LIST_FM_KEYS = [
  'gallery',
  'materialsImages',
  'processImages',
  'beforeAfterImages',
  'serviceCardImages',
];

/** True when the next non-blank lines are list items belonging to this key (stop at the next FM key). */
function imageListKeyHasItems(after) {
  for (const line of String(after || '').split(/\n/)) {
    if (!String(line).trim()) continue;
    if (!/^[ \t]/.test(line) && /^[A-Za-z_][\w]*[ \t]*:/.test(line)) return false;
    if (/^[ \t]*-[ \t]/.test(line)) return true;
    return false;
  }
  return false;
}

/**
 * Drop empty image-list keys so Astro never sees null/{}.
 * `beforeAfterImages:\nprocessImages:` is empty — do not treat the next key's items as ours.
 */
export function stripEmptyImageListKeys(fm) {
  let out = String(fm || '');
  for (const key of IMAGE_LIST_FM_KEYS) {
    const re = new RegExp(
      `^(${key})[ \\t]*:[ \\t]*(?:\\[\\s*\\]|\\{\\s*\\}|null|~|""|'')?[ \\t]*(?:\\n(?:[ \\t]*\\n)*)?`,
      'gim',
    );
    out = out.replace(re, (match, _k, offset, full) => {
      const after = String(full).slice(offset + match.length);
      if (imageListKeyHasItems(after)) return `${key}:\n`;
      return '';
    });
  }
  return out.replace(/\n{3,}/g, '\n\n');
}

/** Top-level keys allowed in pages/services/locations frontmatter (Astro content.config). */
const KNOWN_CONTENT_FM_KEYS = new Set([
  'title',
  'description',
  'h1',
  'draft',
  'sectionHeading',
  'heroImage',
  'featureImage',
  'cardImage',
  'coverageMap',
  'gallery',
  'materialsImages',
  'processImages',
  'beforeAfterImages',
  'serviceCardImages',
  'whyChooseUs',
  'process',
  'faqs',
  'serviceName',
  'order',
  'city',
  'state',
  'parentCity',
]);

/**
 * Move top-level FM lines whose key is not a known content field into the body.
 * Recovers orphans like `Optional: …` / `Customer prep: …` left inside YAML after
 * an unscoped processImages replace ate the closing fence.
 * Scope orphans are placed under What’s included (not dumped above the first H2).
 */
function healUnknownFrontmatterProse(fm, body) {
  const lines = String(fm || '').split(/\r?\n/);
  const keep = [];
  const moved = [];
  for (const L of lines) {
    // Top-level only (no indent). Allow multi-word bogus keys like "Customer prep".
    const top = L.match(/^([A-Za-z][^:\n]*?)\s*:/);
    if (top && !KNOWN_CONTENT_FM_KEYS.has(top[1].trim())) {
      moved.push(L);
      continue;
    }
    keep.push(L);
  }
  let nextBody = String(body || '');
  if (moved.length) {
    nextBody = placeScopeOrphanLines(nextBody, moved);
  }
  // Also relocate bare Optional/Customer prep lines already sitting above the first H2
  nextBody = relocateLeadingScopeOrphans(nextBody);
  const serviceName = fmScalar(keep.join('\n'), 'serviceName');
  nextBody = healHollowWhatsIncluded(nextBody, { serviceName });
  nextBody = healTimelineDurationPhrases(nextBody);
  nextBody = healFaqLeadingGlitches(nextBody);
  return {
    fm: keep.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd(),
    body: nextBody,
  };
}

const SCOPE_ORPHAN_LINE_RE = /^(Optional|Customer prep)\s*:\s*(.+)$/i;
const INCLUDED_H2_RE = /^##\s+.*(what'?s included|what is included|\bscope\b)/im;

function scopeOrphanToBullets(line) {
  const t = String(line || '').trim();
  if (!t) return [];
  const both = t.match(
    /^Optional\s*:\s*(.+?)\s*[.]\s*Customer prep\s*:\s*(.+)$/i,
  ) || t.match(/^Optional\s*:\s*(.+?)\s+Customer prep\s*:\s*(.+)$/i);
  if (both) {
    return [
      `- **Optional:** ${both[1].trim().replace(/[.]\s*$/, '')}`,
      `- **Customer prep:** ${both[2].trim()}`,
    ];
  }
  const m = t.match(SCOPE_ORPHAN_LINE_RE);
  if (!m) return [];
  const label = /^optional$/i.test(m[1]) ? 'Optional' : 'Customer prep';
  return [`- **${label}:** ${m[2].trim()}`];
}

/**
 * Insert scope orphan lines under What’s included / Scope, or create that H2.
 */
function placeScopeOrphanLines(body, orphanLines) {
  const bullets = (orphanLines || []).flatMap(scopeOrphanToBullets);
  const other = (orphanLines || []).filter((L) => !SCOPE_ORPHAN_LINE_RE.test(String(L || '').trim()));
  let text = String(body || '').replace(/^\r?\n/, '');
  if (bullets.length) {
    if (INCLUDED_H2_RE.test(text)) {
      text = text.replace(INCLUDED_H2_RE, (heading) => `${heading}\n\n${bullets.join('\n')}`);
    } else {
      const block = `## What's Included\n\n${bullets.join('\n')}\n`;
      const firstH2 = text.search(/^##\s+/m);
      if (firstH2 >= 0) {
        text = `${text.slice(0, firstH2).replace(/\s+$/, '')}\n\n${block}\n${text.slice(firstH2)}`;
      } else {
        text = `${block}\n${text}`;
      }
    }
  }
  if (other.length) {
    text = `${other.join('\n')}\n${text}`;
  }
  return text.startsWith('\n') ? text : `\n${text}`;
}

/** Move leading bare Optional/Customer prep lines into What’s included. */
function relocateLeadingScopeOrphans(body) {
  const raw = String(body || '').replace(/^\r?\n/, '');
  const lines = raw.split(/\r?\n/);
  const orphans = [];
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      i += 1;
      continue;
    }
    if (SCOPE_ORPHAN_LINE_RE.test(t) && !t.startsWith('-') && !t.startsWith('#')) {
      orphans.push(t);
      i += 1;
      continue;
    }
    break;
  }
  if (!orphans.length) return body.startsWith('\n') || !body ? body : `\n${body}`;
  const rest = lines.slice(i).join('\n');
  return placeScopeOrphanLines(rest, orphans);
}

const SCOPE_META_BULLET_RE =
  /^\s*[-*•]\s+(?:\*\*)?(?:Optional|Customer prep)(?:\*\*)?\s*[:—–-]/i;

function isScopeMetaBullet(line) {
  return SCOPE_META_BULLET_RE.test(String(line || '').trim());
}

function isScopeContentBullet(line) {
  const t = String(line || '').trim();
  if (!/^[-*•]\s+/.test(t) && !/^\d+[.)]\s+/.test(t)) return false;
  return !isScopeMetaBullet(t);
}

const GENERIC_SCOPE_SEED_RE =
  /camera-verified diagnosis before work begins|written estimate with clear scope and pricing|labor, materials, and cleanup for the agreed scope/i;

const THIN_TEMPLATE_SCOPE_RE =
  /camera-verified diagnosis for .+|spot or sectional repair matched to the damage found|scope and materials for .+ as quoted|written estimate before work begins$/i;

function isGenericScopeOnly(contentBullets) {
  if (!contentBullets.length) return false;
  return contentBullets.every(
    (l) => GENERIC_SCOPE_SEED_RE.test(String(l || '')) || THIN_TEMPLATE_SCOPE_RE.test(String(l || '')),
  );
}

/**
 * Service-aware What’s included seeds (heal last resort when Optional/prep-only
 * or only the prior generic scaffold remains).
 */
function scopeSeedsForService(serviceName = '') {
  const s = String(serviceName || '').toLowerCase();
  const name = String(serviceName || '').trim() || 'this service';

  if (/\bcipp\b|cured-?in-?place|pipe lining|liner/.test(s)) {
    return [
      '- Camera inspection to confirm the pipe is a lining candidate',
      '- Resin-saturated CIPP liner installed and cured in place',
      '- Post-install camera pass to verify a sealed, clear line',
    ];
  }
  if (/camera inspection|sewer camera|pipe camera|cctv/.test(s)) {
    return [
      '- Full camera pass of the accessible main line',
      '- On-screen diagnosis of cracks, roots, offsets, and blockages',
      '- Written findings summary with repair options',
    ];
  }
  if (/pipe bursting|bursting/.test(s)) {
    return [
      '- Camera-verified layout before bursting begins',
      '- Pipe bursting pull with new HDPE pipe in place',
      '- Tie-in to home plumbing and final camera verification',
    ];
  }
  if (/trenchless/.test(s) && /replace/.test(s)) {
    return [
      '- Camera diagnosis to choose bursting vs CIPP vs open trench',
      '- Trenchless replacement through limited access points',
      '- Backfill, cleanup, and closing camera verification',
    ];
  }
  if (/hydro|jet|cleaning|clean(ing)?$/.test(s) && !/repair|replace/.test(s)) {
    return [
      '- Pre-clean camera check to locate the restriction',
      '- Hydro-jet or mechanical clearing of the main line',
      '- Post-clean camera confirmation the line is open',
    ];
  }
  if (/root/.test(s)) {
    return [
      '- Camera location of root intrusion points',
      '- Root cutting and line clearing',
      '- Repair recommendation (spot fix, lining, or replacement)',
    ];
  }
  if (/emergency|backup/.test(s)) {
    return [
      '- Priority response for active backups or overflows',
      '- Camera diagnosis of the failure point',
      '- Temporary relief plus a written repair plan',
    ];
  }
  if (/backflow/.test(s)) {
    return [
      '- Functional test of the backflow prevention device',
      '- Compliance documentation for your records',
      '- Repair or replacement options when the device fails',
    ];
  }
  if (/grease/.test(s)) {
    return [
      '- Inspection of the grease trap and connected lines',
      '- Cleaning of grease buildup that restricts flow',
      '- Recommendations to reduce repeat grease blockages',
    ];
  }
  if (/repair/.test(s)) {
    return [
      '- Camera inspection to locate the break, offset, or root intrusion',
      '- Spot repair, sectional replacement, or trenchless option matched to the damage',
      '- Written estimate before work; cleanup of the access area when finished',
    ];
  }
  return [
    `- Camera-verified diagnosis before quoting ${name}`,
    `- Labor and materials for the agreed ${name} scope`,
    '- Written estimate and job-site cleanup when the work is done',
  ];
}

/**
 * When What’s included only has Optional/Customer prep (or only the old generic
 * scaffold), seed service-aware scope bullets ahead of the meta lines.
 */
function healHollowWhatsIncluded(body, { serviceName = '' } = {}) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  if (!INCLUDED_H2_RE.test(text)) return String(body || '');
  const seeds = scopeSeedsForService(serviceName);
  const parts = text.split(/(?=^##\s+)/m);
  let changed = false;
  const next = parts.map((part) => {
    const nl = part.indexOf('\n');
    const headingLine = (nl < 0 ? part : part.slice(0, nl)).trim();
    if (!/what'?s included|what is included|\bscope\b/i.test(headingLine)) return part;
    const sectionBody = nl < 0 ? '' : part.slice(nl + 1);
    const lines = sectionBody.split('\n');
    const bullets = lines.filter((l) => /^[-*•]\s+/.test(l.trim()) || /^\d+[.)]\s+/.test(l.trim()));
    if (!bullets.length) return part;
    const content = bullets.filter(isScopeContentBullet);
    const meta = bullets.filter(isScopeMetaBullet);
    const needsSeed =
      (content.length === 0 && meta.length > 0) ||
      (meta.length > 0 && isGenericScopeOnly(content)) ||
      (content.length > 0 && content.length < 3 && isGenericScopeOnly(content));
    if (!needsSeed) return part;
    changed = true;
    const seeded = [...seeds, ...meta.map((l) => l.trim())];
    return `${headingLine}\n\n${seeded.join('\n')}\n`;
  });
  return changed ? next.join('') : String(body || '').replace(/\r\n/g, '\n');
}

/** Fix mangled timeline duration phrases left in markdown bodies. */
function healTimelineDurationPhrases(body) {
  return String(body || '')
    .replace(
      /\bsame\s+day\s+to\s+(?:next\s+day\s+)?in\s+most\s+cases\b/gi,
      'same day to next day',
    )
    .replace(/\bsame\s+day\s+to\s+in\s+most\s+cases\b/gi, 'same day')
    .replace(/\bto\s+in\s+most\s+cases\b/gi, '')
    .replace(/\bin\s+most\s+cases\b/gi, '')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n');
}

/** Strip orphaned FAQ answer prefixes like `, yes — a permit…` and capitalize. */
function healFaqLeadingGlitches(body) {
  let text = String(body || '');
  // `, yes — foo` / `yes, foo` / `yes — foo` at line start → capitalize remainder
  text = text.replace(
    /(^|\n)([ \t]*)(?:,\s*)?(?:yes|no)\s*[—–,]\s*([A-Za-z])/gi,
    (_, br, sp, ch) => `${br}${sp}${ch.toUpperCase()}`,
  );
  // Bare leading comma before answer text
  text = text.replace(
    /(^|\n)([ \t]*),\s+([A-Za-z])/g,
    (_, br, sp, ch) => `${br}${sp}${ch.toUpperCase()}`,
  );
  // Answer line still lowercase right after a question (prior heal orphan)
  text = text.replace(/(\?\s*\n)([ \t]*)([a-z])/g, (_, q, sp, ch) => `${q}${sp}${ch.toUpperCase()}`);
  return text;
}

function collectUnknownFrontmatterKeys(fm) {
  const unknown = [];
  for (const L of String(fm || '').split(/\r?\n/)) {
    const top = L.match(/^([A-Za-z][^:\n]*?)\s*:/);
    if (top && !KNOWN_CONTENT_FM_KEYS.has(top[1].trim())) unknown.push(top[1].trim());
  }
  return [...new Set(unknown)];
}

function normalizePublicImageSrc(raw) {
  let s = String(raw || '')
    .trim()
    .replace(/\\/g, '/');
  if (!s) return '';
  if (s.startsWith('public/')) s = `/${s.slice('public/'.length)}`;
  if (!s.startsWith('/') && !/^https?:\/\//i.test(s)) {
    s = `/${s.replace(/^\/+/, '')}`;
  }
  return s;
}

function altFromImageSrc(src) {
  const base = String(src || '')
    .split('/')
    .pop()
    ?.replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return base ? `${base} photo` : 'Project photo';
}

const STOCK_SCRAPE_ALT_RE =
  /\b(brazil|nigeria|mexico|acapulco|warri|tacoma|bratislava|sarajevo|california|elk grove|ribeir|new bern|what i like|this pictures|free photo|overhead view|detailed view|taking a walk|one of those|discover just|perches|seagull|beach|farm field|plowing|industrial wall art|graffiti backdrop|check my bio|follow me|drone shot|coastal construction|laying on the ground|t\u00fcrkiye|turkiye|ukraine|esp[i\u00ed]ritu|beijing|ad[i\u0131]yaman|lviv|nyc|radiator|jackhammer|cinematic|creative projects|geometric pattern|factory setting|urban decay|monochrome|clear skies|clear blue sky)\b/i;

const STOCK_EDITORIAL_OPENER_RE =
  /^(close-?up|aerial|top view|high angle|dramatic|artistic|perspective|exterior view|team of|adult male|two construction|construction workers?|mini excavator|yellow mini|drone aerial|angle grinder|bright red pipes|aged metal|composite pipe|red pipes|two coiled|two large rusty|sprinker|triangular caution|road construction|pipes|large industrial|stacked industrial|the wall with|rusty outdoor|multiple water|colorful industrial|industrial building|industrial construction)\b/i;

const STOCK_MARKETING_FLUFF_RE =
  /\b(showcasing|evoking|capturing|featuring|cinematic feel|creative projects|geometric patterns?|industrial design|planning essence|hard work|teamwork)\b/i;

/** True when alt looks like Unsplash/Pexels scrapy or filename garbage (not niche slot text). */
export function looksLikeStockScrapeAlt(alt) {
  const a = String(alt || '').trim();
  if (!a) return true;
  if (/^(materials|process|project) photo$/i.test(a)) return false;
  if (/\b(materials|process|project) photo$/i.test(a) && !STOCK_SCRAPE_ALT_RE.test(a) && !STOCK_MARKETING_FLUFF_RE.test(a)) {
    return false;
  }
  // Niche-prefixed filename stems: "… — black and gray metal pipes" (any dash variant)
  if (/[—–―−]/.test(a)) return true;
  if (/\s+-\s+[a-z0-9]/i.test(a) && !/\b(materials|process|project) photo$/i.test(a)) return true;
  if (a.length > 100) return true;
  if (a.length < 8 && !/\b(map|logo)\b/i.test(a)) return true;
  if (STOCK_SCRAPE_ALT_RE.test(a)) return true;
  if (STOCK_EDITORIAL_OPENER_RE.test(a)) return true;
  if (STOCK_MARKETING_FLUFF_RE.test(a)) return true;
  if (/\bin\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s*,?\s*[A-Z]{2}\.?$/.test(a)) return true;
  if (/\bin\s+[A-Z][a-zà-ü]+(?:\s+[A-Z][a-zà-ü]+)?\s*\.?$/i.test(a)) return true;
  // Filename-stem garbage: "… — 4 a out of a tr", "… — 5 a cat high"
  if (/—\s*\d+\s+[a-z](\s+[a-z]+){0,6}$/i.test(a)) return true;
  if (/\b\d+\s+a\s+(out|cat|man|pipe)\b/i.test(a)) return true;
  // Service-prefixed filename stem: "Sewer Line Repair — sewer line 2 root"
  if (/—\s*(sewer|cipp|pipe|materials?|process)\b/i.test(a) && /\d/.test(a)) return true;
  if (/—\s*(view of|close[-\s]?up|photo of)\b/i.test(a)) return true;
  if (/—\s*[a-z0-9].*\b\d+\b/.test(a) && a.split(/—/).pop().trim().split(/\s+/).length <= 8) {
    return true;
  }
  // Truncated after em-dash (cutoff mid-phrase)
  if (/—/.test(a)) {
    const after = a.split(/—/).pop()?.trim() || '';
    if (
      /\b(site with an|two city|this close|white and black|a and at|pipes at a|at a cons|water fluid|top view of)\b/i.test(
        after,
      ) ||
      /\s(an|a|the|of|in|roa|roun|coa|cons|ri|metal)$/i.test(after) ||
      (after.length > 0 && after.length < 16) ||
      /^\d+\s/.test(after) ||
      /^(top view|close[-\s]?up|two large|two coiled)\b/i.test(after)
    ) {
      return true;
    }
  }
  // Ultra-short all-lowercase captions (e.g. "excavator beside large pipes")
  if (
    a.length < 40 &&
    a === a.toLowerCase() &&
    !/[.!?']/.test(a) &&
    a.split(/\s+/).length <= 6
  ) {
    return true;
  }
  // Truncated scrape leftovers
  if (/\b(at a cons|at a site in|pipes at a cons)\b/i.test(a)) return true;
  if (/—\s*\w+(\s+\w+){0,3}\s+(at|in|of)\s*$/i.test(a)) return true;
  // Generic Unsplash-style openers unrelated to niche work
  if (/^(a|an)\s+.+\b(water|sunset|coastal|drone|machinery|welding|sparks)\b/i.test(a) && a.length > 40) {
    return true;
  }
  // Long prose stock captions (sentence-like, no slot shape)
  if (
    a.length > 70 &&
    !/\b(materials|process|project) photo\b/i.test(a) &&
    /[,.]/.test(a)
  ) {
    return true;
  }
  const afterEm = a.split(/—/).pop()?.trim() || '';
  if (afterEm && afterEm.length < 22 && /\d/.test(afterEm) && afterEm.split(/\s+/).length <= 6) {
    return true;
  }
  if (afterEm && /^(pipes at a|at a cons|a\s|an\s)/i.test(afterEm)) return true;
  if (afterEm && /\b(in the water|at a coa|on the in the)\b/i.test(afterEm)) return true;
  return false;
}

function slotAltFromSrc(src, serviceName = '') {
  const svc = String(serviceName || '').trim();
  if (!svc) return altFromImageSrc(src);
  if (/svcHero|\/hero/i.test(src) || /\/(?:hero)[-.]/i.test(src)) {
    return `${svc} project photo`.slice(0, 120);
  }
  if (/materials/i.test(src)) return `${svc} materials photo`.slice(0, 120);
  if (/process/i.test(src)) return `${svc} process photo`.slice(0, 120);
  return `${svc} photo`.slice(0, 120);
}

/** Rewrite Unsplash/Pexels scrapy captions to service-shaped alts. */
function healStockScrapeAlts(fm) {
  const serviceName = fmScalar(fm, 'serviceName') || fmScalar(fm, 'h1') || '';
  const lines = String(fm || '').replace(/\r\n/g, '\n').split('\n');
  let lastSrc = '';
  for (let i = 0; i < lines.length; i += 1) {
    const srcM = lines[i].match(/^[ \t]*(?:-[ \t]+)?src[ \t]*:[ \t]*("([^"]+)"|'([^']+)'|(\S+))\s*$/i);
    if (srcM) {
      lastSrc = srcM[2] || srcM[3] || srcM[4] || '';
      continue;
    }
    const altM = lines[i].match(/^([ \t]*(?:-[ \t]+)?alt[ \t]*:[ \t]*)("([^"]*)"|'([^']*)'|(\S.*))\s*$/i);
    if (!altM) continue;
    const alt = String(altM[3] || altM[4] || altM[5] || '').trim();
    if (!looksLikeStockScrapeAlt(alt)) continue;
    const next = slotAltFromSrc(lastSrc, serviceName);
    lines[i] = `${altM[1]}${JSON.stringify(next)}`;
  }
  return lines.join('\n');
}

function formatImageYaml(indent, key, src) {
  const alt = altFromImageSrc(src);
  return `${indent}${key}:\n${indent}  src: ${JSON.stringify(src)}\n${indent}  alt: ${JSON.stringify(alt)}`;
}

/**
 * Normalize image frontmatter so Astro content schema accepts it:
 * - omit empty string / null image fields
 * - convert bare path strings → { src, alt }
 * - repair Claude list blocks (whyChooseUs/process/faqs/gallery) missing `-` markers
 */
export function sanitizeMarkdownImageFrontmatter(markdown, opts = {}) {
  const ensured = ensureYamlFrontmatter(markdown);
  const split = splitFrontmatter(ensured);
  if (!split.ok) return ensured;

  let fm = split.frontmatter;
  const keyAlt = IMAGE_FM_KEYS.join('|');

  // Drop explicit empty / null / whitespace-only scalar image keys.
  // Do NOT drop bare `key:` (no characters after ':') — that starts a multiline `{ src, alt }` object.
  fm = fm.replace(
    new RegExp(`^([ \\t]*)(${keyAlt})[ \\t]*:[ \\t]*([^\\n]*)$`, 'gim'),
    (match, indent, key, rawVal) => {
      const v = String(rawVal || '').trim();
      if (v === '' && String(rawVal || '').length > 0) return ''; // whitespace-only value
      if (v === '""' || v === "''" || v === 'null' || v === '~') return '';
      return match;
    },
  );

  // Bare path → object (same-line scalars only; [ \\t] so we never cross lines)
  fm = fm.replace(
    new RegExp(
      `^([ \\t]*)(${keyAlt})[ \\t]*:[ \\t]*(?:"([^"]+)"|'([^']+)'|([^\\s{\\[#][^\\n]*?))[ \\t]*$`,
      'gim',
    ),
    (match, indent, key, d1, d2, bare) => {
      const raw = String(d1 || d2 || bare || '').trim();
      if (!raw || raw === 'null' || raw === '~') return '';
      if (raw.startsWith('{')) return match;
      const src = normalizePublicImageSrc(raw);
      if (!src) return '';
      return formatImageYaml(indent, key, src);
    },
  );

  // Nested process[].image (and similar) — drop explicit empties; keep bare `image:` for multiline objects
  fm = fm.replace(/^[ \t]*image[ \t]*:[ \t]*([^\n]*)$/gim, (match, rawVal) => {
    const v = String(rawVal || '').trim();
    if (v === '' && String(rawVal || '').length > 0) return '';
    if (v === '""' || v === "''" || v === 'null' || v === '~') return '';
    return match;
  });
  fm = fm.replace(
    /^([ \t]*)image[ \t]*:[ \t]*(?:"([^"]+)"|'([^']+)'|([^\s{\\[#][^\n]*?))[ \t]*$/gim,
    (match, indent, d1, d2, bare) => {
      const raw = String(d1 || d2 || bare || '').trim();
      if (!raw || raw === 'null' || raw === '~') return '';
      if (raw.startsWith('{')) return match;
      const src = normalizePublicImageSrc(raw);
      if (!src) return '';
      return formatImageYaml(indent, 'image', src);
    },
  );

  // Gallery list items that are bare strings: - "public/images/x.jpg"
  fm = fm.replace(
    /^([ \t]*)-\s+(?:"([^"]+\.(?:jpg|jpeg|png|webp|gif|svg))"|'([^']+\.(?:jpg|jpeg|png|webp|gif|svg))'|(\S+\.(?:jpg|jpeg|png|webp|gif|svg)))\s*$/gim,
    (match, indent, d1, d2, bare) => {
      const raw = String(d1 || d2 || bare || '').trim();
      const src = normalizePublicImageSrc(raw);
      if (!src) return match;
      const alt = altFromImageSrc(src);
      return `${indent}- src: ${JSON.stringify(src)}\n${indent}  alt: ${JSON.stringify(alt)}`;
    },
  );

  fm = repairFrontmatterListBlocks(fm);
  // Re-parent serviceCardImages list items nested under coverageMap BEFORE omit-missing
  // drops those `- src` lines as if they were orphan gallery items with missing files.
  let bodyEarly = split.body || '';
  ({ fm, body: bodyEarly } = healMisnestedServiceCardImages(fm, bodyEarly));
  fm = omitMissingImageFrontmatter(fm, opts);
  fm = healStockScrapeAlts(fm);

  fm = fm.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trimEnd();
  let body = stripDuplicateLeadingTitle(bodyEarly, fm);
  // Body images are banned — strip leftover `![]()` so preview never shows raw markdown
  body = String(body || '').replace(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '').replace(/\n{3,}/g, '\n\n');
  ({ fm, body } = healUnknownFrontmatterProse(fm, body));
  // Again after unknown-key move (recovers if key was stripped this pass before allowlist shipped)
  ({ fm, body } = healMisnestedServiceCardImages(fm, body));
  const bodyOut = body.startsWith('\n') ? body : `\n${body}`;
  const out = `---\n${fm}\n---${bodyOut}`;
  return out.endsWith('\n') ? out : `${out}\n`;
}

function fmScalar(fm, key) {
  const m = String(fm || '').match(new RegExp(`^${key}[ \\t]*:[ \\t]*(.+)$`, 'im'));
  if (!m) return '';
  return m[1].trim().replace(/^["']|["']$/g, '');
}

function stripDuplicateLeadingTitle(body, fm) {
  const h1 = fmScalar(fm, 'h1');
  const title = fmScalar(fm, 'title');
  const sectionHeading = fmScalar(fm, 'sectionHeading');
  const lines = String(body || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const echoes = new Set(
    [h1, title, sectionHeading]
      .map((t) =>
        String(t || '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' '),
      )
      .filter(Boolean),
  );
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  if (i >= lines.length) return body;
  const first = lines[i].trim().replace(/^#+\s*/, '').toLowerCase().replace(/\s+/g, ' ');
  if (echoes.has(first)) {
    i += 1;
    while (i < lines.length && !lines[i].trim()) i += 1;
    return `\n${lines.slice(i).join('\n')}`;
  }
  return body;
}

function publicImageExists(src, opts = {}) {
  const s = normalizePublicImageSrc(src);
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  const rel = s.replace(/^\//, '').replace(/^public\//, '');
  const parts = rel.split('/');
  if (existsSync(path.join(ROOT, 'public', ...parts))) return true;
  // Candidate site-images roots: files live as basename under research/{id}/site-images/
  const base = parts[parts.length - 1];
  for (const root of opts.extraRoots || []) {
    if (!root) continue;
    if (existsSync(path.join(root, ...parts))) return true;
    if (base && existsSync(path.join(root, base))) return true;
    // Also accept root/images/...
    if (existsSync(path.join(root, 'images', ...parts.filter((p) => p !== 'images')))) return true;
  }
  return false;
}

/** Drop image objects whose src file is missing from public/ (and optional extraRoots). */
function omitMissingImageFrontmatter(fm, opts = {}) {
  let out = String(fm || '');
  const keyAlt = IMAGE_FM_KEYS.join('|');
  const exists = (raw) => publicImageExists(raw, opts);

  // Multiline objects:
  // key:
  //   src: "..."
  //   alt: "..."
  out = out.replace(
    new RegExp(
      `^([ \\t]*)(${keyAlt})[ \\t]*:[ \\t]*\\n(?:[ \\t]+(?:src|alt)[ \\t]*:[ \\t]*[^\\n]*\\n?){1,4}`,
      'gim',
    ),
    (block, indent, key) => {
      const srcM = block.match(/^[ \t]*src[ \t]*:[ \t]*("([^"]+)"|'([^']+)'|(\S+))/m);
      const raw = srcM ? srcM[2] || srcM[3] || srcM[4] || '' : '';
      if (!raw || exists(raw)) return block;
      return '';
    },
  );

  // Same-line flow objects are rare; drop if src missing
  out = out.replace(
    new RegExp(`^([ \\t]*)(${keyAlt})[ \\t]*:[ \\t]*\\{[^\\n]*src[^\\n]*\\}[ \\t]*$`, 'gim'),
    (block) => {
      const srcM = block.match(/src[ \\t]*:[ \\t]*["']?([^"',}\\s]+)/);
      const raw = srcM?.[1] || '';
      if (!raw || exists(raw)) return block;
      return '';
    },
  );

  // Nested process[].image (and similar list-item image objects)
  //   image:
  //     src: "..."
  //     alt: "..."
  out = out.replace(
    /^([ \t]*)image[ \t]*:[ \t]*\n(?:[ \t]+(?:src|alt)[ \t]*:[ \t]*[^\n]*\n?){1,4}/gim,
    (block) => {
      const srcM = block.match(/^[ \t]*src[ \t]*:[ \t]*("([^"]+)"|'([^']+)'|(\S+))/m);
      const raw = srcM ? srcM[2] || srcM[3] || srcM[4] || '' : '';
      if (!raw || exists(raw)) return block;
      return '';
    },
  );
  out = out.replace(
    /^([ \t]*)image[ \t]*:[ \t]*\{[^\n]*src[^\n]*\}[ \t]*$/gim,
    (block) => {
      const srcM = block.match(/src[ \t]*:[ \t]*["']?([^"',}\\s]+)/);
      const raw = srcM?.[1] || '';
      if (!raw || exists(raw)) return block;
      return '';
    },
  );

  // Gallery / materials list items with missing src
  // Heal misnested materialsImages→gallery BEFORE dropping missing list items
  out = healMisnestedMaterialsImages(out);

  out = out.replace(
    /^([ \t]*)-[ \t]+src[ \t]*:[ \t]*("([^"]+)"|'([^']+)'|(\S+))[ \t]*\n[ \t]+alt[ \t]*:[ \t]*[^\n]*$/gim,
    (block, indent, _q, d1, d2, bare) => {
      const raw = d1 || d2 || bare || '';
      if (!raw || exists(raw)) return block;
      return '';
    },
  );

  // Heal orphan image list items that lost their parent key
  out = healOrphanImageListFrontmatter(out);
  // Heal orphan indented src/alt object children (missing heroImage/cardImage parent)
  out = healOrphanImageObjectFrontmatter(out);

  // Drop empty `gallery:` / `beforeAfterImages:` etc. Stop at the next FM key
  // so `beforeAfterImages:\nprocessImages:` is not kept because the next list has items.
  out = stripEmptyImageListKeys(out);

  return out;
}

/**
 * Fix coverageMap object that absorbed serviceCardImages list items after the key
 * was stripped as "unknown" FM:
 *
 * coverageMap:
 *   src: ...
 *   alt: ...
 *   - src: "/images/services-1-..."
 *
 * → peel list into serviceCardImages: and drop a bare serviceCardImages: line from body.
 */
function healMisnestedServiceCardImages(fm, body) {
  const lines = String(fm || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const covIdx = lines.findIndex((l) => /^coverageMap[ \t]*:/i.test(l));
  if (covIdx < 0) {
    return { fm: String(fm || ''), body: String(body || '') };
  }

  let i = covIdx + 1;
  while (i < lines.length) {
    const L = lines[i];
    if (!String(L).trim()) {
      i += 1;
      continue;
    }
    if (/^[ \t]+src[ \t]*:/i.test(L) || /^[ \t]+alt[ \t]*:/i.test(L)) {
      i += 1;
      continue;
    }
    break;
  }

  const listStart = i;
  while (i < lines.length) {
    const L = lines[i];
    if (!String(L).trim()) {
      let j = i + 1;
      while (j < lines.length && !String(lines[j]).trim()) j += 1;
      if (j < lines.length && /^[ \t]+-[ \t]+src[ \t]*:/i.test(lines[j])) {
        i += 1;
        continue;
      }
      break;
    }
    if (/^[ \t]+-[ \t]+src[ \t]*:/i.test(L)) {
      i += 1;
      continue;
    }
    if (/^[ \t]+alt[ \t]*:/i.test(L) && i > listStart) {
      i += 1;
      continue;
    }
    break;
  }

  if (listStart >= i) {
    return { fm: lines.join('\n'), body: String(body || '') };
  }
  const listItems = lines.slice(listStart, i);
  if (!listItems.some((l) => /^[ \t]+-[ \t]+src[ \t]*:/i.test(l))) {
    return { fm: lines.join('\n'), body: String(body || '') };
  }

  const hasKey = lines.some((l) => /^serviceCardImages[ \t]*:/i.test(l));
  let nextLines = [...lines.slice(0, listStart), ...lines.slice(i)];
  if (!hasKey) {
    nextLines = [
      ...nextLines.slice(0, listStart),
      'serviceCardImages:',
      ...listItems,
      ...nextLines.slice(listStart),
    ];
  }

  let nextBody = String(body || '');
  nextBody = nextBody.replace(/^\r?\n?serviceCardImages:\s*\r?\n?/, '\n');

  return {
    fm: nextLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd(),
    body: nextBody,
  };
}

/**
 * Fix:
 * materialsImages:
 * gallery:
 *   - src: "/images/materials-1-..."
 * → move materials-* items under materialsImages; keep gallery only for gallery-* items.
 */
function healMisnestedMaterialsImages(fm) {
  let text = String(fm || '');
  if (!/^materialsImages[ \t]*:/m.test(text) || !/^gallery[ \t]*:/m.test(text)) return text;

  const lines = text.split(/\n/);
  const matIdx = lines.findIndex((l) => /^materialsImages[ \t]*:/i.test(l));
  const galIdx = lines.findIndex((l) => /^gallery[ \t]*:/i.test(l));
  if (matIdx < 0 || galIdx < 0 || galIdx <= matIdx) return text;
  const between = lines.slice(matIdx + 1, galIdx);
  if (galIdx !== matIdx + 1 && !between.every((l) => !String(l).trim())) return text;

  // Collect gallery list items after gallery:
  const gStart = galIdx;
  let i = gStart + 1;
  while (i < lines.length && !String(lines[i]).trim()) i += 1;
  const itemStart = i;
  let itemEnd = itemStart - 1;
  for (; i < lines.length; i += 1) {
    if (/^[ \t]+-[ \t]+src[ \t]*:/i.test(lines[i])) {
      itemEnd = i;
      if (i + 1 < lines.length && /^[ \t]+alt[ \t]*:/i.test(lines[i + 1])) {
        itemEnd = i + 1;
        i += 1;
      }
    } else if (itemEnd >= itemStart && /^[ \t]+alt[ \t]*:/i.test(lines[i])) {
      itemEnd = i;
    } else if (/^\S/.test(lines[i])) {
      break;
    } else if (itemEnd >= itemStart) {
      // blank inside list — keep scanning until next key
      continue;
    } else {
      break;
    }
  }
  if (itemEnd < itemStart) return text;

  const items = [];
  let cur = null;
  for (let j = itemStart; j <= itemEnd; j += 1) {
    const line = lines[j];
    if (/^[ \t]+-[ \t]+src[ \t]*:/i.test(line)) {
      if (cur) items.push(cur);
      cur = [line];
    } else if (cur) {
      cur.push(line);
    }
  }
  if (cur) items.push(cur);
  if (!items.length) return text;

  const materialsItems = [];
  const galleryItems = [];
  for (const item of items) {
    const blob = item.join('\n');
    if (/\/images\/materials-/i.test(blob) || /materials-\d+/i.test(blob)) {
      materialsItems.push(...item);
    } else {
      galleryItems.push(...item);
    }
  }
  if (!materialsItems.length) return text;

  const mKeyIdx = lines.findIndex((l) => /^materialsImages[ \t]*:/i.test(l));
  const before = lines.slice(0, mKeyIdx);
  const after = lines.slice(itemEnd + 1);
  const out = [
    ...before,
    'materialsImages:',
    ...materialsItems,
  ];
  if (galleryItems.length) {
    out.push('gallery:', ...galleryItems);
  }
  out.push(...after);
  return out.join('\n');
}

/**
 * Restore parent key when `- src:` list items lost theirs.
 * Never steal a list already under processImages / materialsImages / etc.
 */
function healOrphanImageListFrontmatter(fm) {
  let text = String(fm || '');
  const lines = text.split(/\n/);

  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^[ \t]+-[ \t]+src[ \t]*:/i.test(lines[i])) {
      if (start < 0) start = i;
      end = i;
      if (i + 1 < lines.length && /^[ \t]+alt[ \t]*:/i.test(lines[i + 1])) {
        end = i + 1;
        i += 1;
      }
    } else if (start >= 0 && /^[ \t]+alt[ \t]*:/i.test(lines[i])) {
      end = i;
    } else if (start >= 0 && /^\S/.test(lines[i])) {
      break;
    }
  }
  if (start < 0) return text;

  // Previous non-blank line is the owner key
  let prev = start - 1;
  while (prev >= 0 && !String(lines[prev]).trim()) prev -= 1;
  const prevLine = prev >= 0 ? lines[prev] : '';
  if (
    /^(processImages|beforeAfterImages|materialsImages|serviceCardImages|gallery|process|whyChooseUs|faqs|heroImage|featureImage|cardImage|coverageMap)[ \t]*:/i.test(
      prevLine,
    )
  ) {
    return text;
  }

  const blockLines = lines.slice(start, end + 1);
  const blockText = blockLines.join('\n');
  if (!/\/images\//i.test(blockText)) return text;

  let parentKey = 'gallery';
  if (/\/images\/materials-|materials-\d+/i.test(blockText) && !/gallery-ba-|\/images\/gallery-/i.test(blockText)) {
    parentKey = 'materialsImages';
  } else if (!/gallery-ba-|\/images\/gallery-/i.test(blockText) && /\/images\/materials-/i.test(blockText)) {
    parentKey = 'materialsImages';
  } else if (!/gallery-ba-|\/images\/gallery-/i.test(blockText)) {
    // Non-gallery orphans under /images/ — only heal as gallery when explicitly gallery-like
    return text;
  }

  // Don't duplicate an existing parent key
  if (new RegExp(`^${parentKey}[ \\t]*:`, 'im').test(text)) return text;

  return [...lines.slice(0, start), `${parentKey}:`, ...blockLines, ...lines.slice(end + 1)].join('\n');
}

const IMAGE_OBJECT_PARENT_RE =
  /^(heroImage|cardImage|featureImage|coverageMap|image)[ \t]*:/i;
const ORPHAN_SRC_RE = /^[ \t]+src[ \t]*:[ \t]*/i;
const ORPHAN_ALT_RE = /^[ \t]+alt[ \t]*:[ \t]*/i;
const LIST_SRC_RE = /^[ \t]+-[ \t]+src[ \t]*:/i;

/**
 * Drop or re-parent bare indented `src`/`alt` blocks that lost their parent key:
 *
 * serviceName: "…"
 *
 *   src: "/images/…"
 *   alt: "…"
 *
 * heroImage:
 *   src: …
 *
 * When heroImage/cardImage already exist, orphans are removed. Otherwise the first
 * orphan becomes heroImage and the second cardImage.
 */
function healOrphanImageObjectFrontmatter(fm) {
  const text = String(fm || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const orphans = []; // { start, end, srcLine, altLine? }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (LIST_SRC_RE.test(line)) {
      i += 1;
      continue;
    }
    if (!ORPHAN_SRC_RE.test(line)) {
      i += 1;
      continue;
    }

    // Previous non-blank owner?
    let prev = i - 1;
    while (prev >= 0 && !String(lines[prev]).trim()) prev -= 1;
    const prevLine = prev >= 0 ? lines[prev] : '';
    if (IMAGE_OBJECT_PARENT_RE.test(prevLine)) {
      i += 1;
      continue;
    }
    // Nested under a list item image: already handled / legal under `-` blocks
    if (/^[ \t]+image[ \t]*:/i.test(prevLine)) {
      i += 1;
      continue;
    }

    const start = i;
    let end = i;
    if (i + 1 < lines.length && ORPHAN_ALT_RE.test(lines[i + 1]) && !LIST_SRC_RE.test(lines[i + 1])) {
      end = i + 1;
    }
    orphans.push({ start, end, srcLine: lines[start], altLine: end > start ? lines[end] : null });
    i = end + 1;
  }

  if (!orphans.length) return String(fm || '');

  const drop = new Set();
  for (const o of orphans) {
    for (let j = o.start; j <= o.end; j += 1) drop.add(j);
  }

  let next = lines.filter((_, idx) => !drop.has(idx));

  // After drop: promote orphans only when parent keys are still missing
  const stillNoHero = !/^heroImage[ \t]*:/m.test(next.join('\n'));
  const stillNoCard = !/^cardImage[ \t]*:/m.test(next.join('\n'));
  const promote = [];
  if (stillNoHero && orphans[0]) {
    promote.push(
      'heroImage:',
      orphans[0].srcLine.replace(/^[ \t]+/, '  '),
      ...(orphans[0].altLine ? [orphans[0].altLine.replace(/^[ \t]+/, '  ')] : []),
    );
  }
  const cardSrc = stillNoHero ? orphans[1] || orphans[0] : orphans[0];
  if (stillNoCard && cardSrc) {
    // Prefer second orphan for card; else duplicate first when only one orphan exists
    promote.push(
      'cardImage:',
      cardSrc.srcLine.replace(/^[ \t]+/, '  '),
      ...(cardSrc.altLine ? [cardSrc.altLine.replace(/^[ \t]+/, '  ')] : []),
    );
  }

  if (promote.length) {
    let insertAt = next.findIndex((l) =>
      /^(materialsImages|processImages|beforeAfterImages|serviceCardImages|gallery|heroImage|cardImage|featureImage|coverageMap)[ \t]*:/i.test(
        l,
      ),
    );
    if (insertAt < 0) insertAt = next.length;
    next = [...next.slice(0, insertAt), ...promote, ...next.slice(insertAt)];
  }

  return next.join('\n').replace(/\n{3,}/g, '\n\n');
}

const LIST_BLOCK_SPECS = {
  whyChooseUs: { fields: ['title', 'description'], startKeys: ['title'] },
  process: { fields: ['title', 'description', 'image'], startKeys: ['title'] },
  faqs: { fields: ['question', 'answer'], startKeys: ['question'] },
  gallery: { fields: ['src', 'alt'], startKeys: ['src'] },
  materialsImages: { fields: ['src', 'alt'], startKeys: ['src'] },
  processImages: { fields: ['src', 'alt'], startKeys: ['src'] },
  beforeAfterImages: { fields: ['src', 'alt'], startKeys: ['src'] },
  serviceCardImages: { fields: ['src', 'alt'], startKeys: ['src'] },
};

/**
 * Claude sometimes emits list sections without `-` item markers, which YAML
 * collapses into duplicated mapping keys. Rewrite those blocks into proper lists.
 */
function repairFrontmatterListBlocks(fm) {
  let out = String(fm || '');
  for (const [key, spec] of Object.entries(LIST_BLOCK_SPECS)) {
    out = repairOneListBlock(out, key, spec);
  }
  return out;
}

function repairOneListBlock(fm, key, spec) {
  const lines = String(fm || '').split(/\n/);
  const startRe = new RegExp(`^${key}[ \\t]*:[ \\t]*(.*)$`);
  let start = -1;
  let inline = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(startRe);
    if (m) {
      start = i;
      inline = (m[1] || '').trim();
      break;
    }
  }
  if (start < 0) return fm;

  // Already a JSON/flow array or non-empty inline value — leave alone
  if (inline && inline !== '|' && inline !== '>') return fm;

  const fieldSet = new Set(spec.fields);

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const L = lines[i];
    if (!L.trim()) continue;
    // Next top-level key that is NOT an item field for this list
    const top = L.match(/^([A-Za-z_][A-Za-z0-9_]*)[ \t]*:/);
    if (top && !fieldSet.has(top[1])) {
      end = i;
      break;
    }
  }

  const blockLines = lines.slice(start + 1, end);
  const blockText = blockLines.join('\n');
  // Already a proper YAML list
  if (/^[ \t]*-\s+/m.test(blockText)) return fm;

  const entries = [];
  let current = null;

  const kvRe = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*(.*?)\s*$/;
  for (const L of blockLines) {
    if (!L.trim()) continue;
    const m = L.match(kvRe);
    if (!m) continue;
    const [, field, rawVal] = m;
    if (!fieldSet.has(field)) continue;
    if (spec.startKeys.includes(field)) {
      if (current) entries.push(current);
      current = {};
    }
    if (!current) current = {};
    let val = rawVal;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (field === 'src' || field === 'image') {
      // image may be multiline object already; only normalize scalar paths here
      if (val && !val.startsWith('{')) val = normalizePublicImageSrc(val);
    }
    if (field === 'image' && val) {
      current.image = { src: val, alt: altFromImageSrc(val) };
    } else {
      current[field] = val;
    }
  }
  if (current) entries.push(current);
  if (!entries.length) return fm;

  const rebuilt = [`${key}:`];
  for (const entry of entries) {
    let first = true;
    for (const field of spec.fields) {
      if (entry[field] == null || entry[field] === '') continue;
      if (field === 'image' && typeof entry.image === 'object') {
        const prefix = first ? '- ' : '  ';
        rebuilt.push(`${prefix}image:`);
        rebuilt.push(`    src: ${JSON.stringify(entry.image.src)}`);
        rebuilt.push(`    alt: ${JSON.stringify(entry.image.alt)}`);
        first = false;
        continue;
      }
      const prefix = first ? '- ' : '  ';
      rebuilt.push(`${prefix}${field}: ${JSON.stringify(entry[field])}`);
      first = false;
    }
  }

  return [...lines.slice(0, start), ...rebuilt, ...lines.slice(end)].join('\n');
}

function imageFieldLooksLikeBadScalar(fm, key) {
  // Same-line only: do not use \s after ':' (it matches newlines and false-positives multiline objects)
  const re = new RegExp(`^${key}[ \\t]*:[ \\t]*([^\\n]*)$`, 'im');
  const m = String(fm || '').match(re);
  if (!m) return false;
  const rest = m[1].trim();
  if (!rest) return false; // multiline object (`key:` then indented src/alt)
  if (rest.startsWith('{')) return false;
  // Quoted or bare path scalar on the same line
  if (/^["']/.test(rest)) return true;
  if (!/^[\{\[]/.test(rest) && !/^>/.test(rest) && !/^\|/.test(rest)) {
    if (/\.(jpg|jpeg|png|webp|gif|svg)\b/i.test(rest) || rest.includes('/')) return true;
  }
  return false;
}

/**
 * Find index where YAML frontmatter body ends (first non-YAML prose line).
 * @param {string[]} lines
 * @param {number} [start]
 */
function findFrontmatterEnd(lines, start = 0) {
  let fmEnd = -1;
  for (let i = start; i < lines.length; i++) {
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
        /^[a-zA-Z0-9_]+\s*:/.test(next) ||
        /^\s+- /.test(next) ||
        /^-(?!-)\s/.test(next) ||
        /^\s{2,}\S/.test(next);
      if (!nextYaml) {
        fmEnd = i;
        break;
      }
      continue;
    }
    // Closing fence already present mid-stream — treat as end
    if (/^---\s*$/.test(L)) {
      fmEnd = i;
      break;
    }
    const looksYaml =
      /^[a-zA-Z0-9_]+\s*:/.test(L) ||
      /^\s+- /.test(L) ||
      /^-(?!-)\s/.test(L) ||
      /^\s{2,}\S/.test(L);
    if (looksYaml) continue;
    fmEnd = i;
    break;
  }
  return fmEnd;
}

/**
 * Recover markdown when Claude omits opening/closing `---` around YAML frontmatter.
 * Also heals files that open with `---` but lost the closing fence (e.g. gallery rewrite bug).
 */
export function ensureYamlFrontmatter(markdown) {
  let s = String(markdown || '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!s) return s;

  const hasClosing =
    /^---\r?\n[\s\S]*?\r?\n---\r?\n/.test(s) || /^---\r?\n[\s\S]*?\r?\n---\s*$/.test(s);

  if (/^---\r?\n/.test(s)) {
    if (hasClosing) {
      return s.endsWith('\n') ? s : `${s}\n`;
    }
    // Opening fence without closing — insert close at FM/body boundary
    const lines = s.split(/\n/);
    const fmEnd = findFrontmatterEnd(lines, 1);
    if (fmEnd < 0) {
      return `---\n${lines.slice(1).join('\n').trimEnd()}\n---\n`;
    }
    if (/^---\s*$/.test(lines[fmEnd])) {
      return s.endsWith('\n') ? s : `${s}\n`;
    }
    const fm = lines.slice(1, fmEnd).join('\n').trimEnd();
    const body = lines.slice(fmEnd).join('\n').replace(/^\n+/, '');
    const out = body.trim()
      ? `---\n${fm}\n---\n\n${body.trimEnd()}\n`
      : `---\n${fm}\n---\n`;
    return out;
  }

  const head = s.split(/\n/).slice(0, 8).join('\n');
  if (!/^(title|description|h1)\s*:/m.test(head)) {
    return s.endsWith('\n') ? s : `${s}\n`;
  }

  const lines = s.split(/\n/);
  const fmEnd = findFrontmatterEnd(lines, 0);

  if (fmEnd < 0) {
    return `---\n${s}\n---\n`;
  }

  const fm = lines.slice(0, fmEnd).join('\n').trimEnd();
  const body = lines.slice(fmEnd).join('\n').replace(/^\n+/, '');
  const out = body.trim() ? `---\n${fm}\n---\n\n${body.trimEnd()}\n` : `---\n${fm}\n---\n`;
  return out;
}

export function normalizeContentFilesMap(files, siteConfig = null) {
  const niche = String(siteConfig?.niche || '').trim();
  const primaryCity = String(siteConfig?.primaryCity || '').trim();
  const primarySlug = slugifyContentName(primaryCity);
  const out = {};
  for (const [rel, markdown] of Object.entries(files || {})) {
    let     md = sanitizeMarkdownImageFrontmatter(ensureYamlFrontmatter(markdown));
    md = healStagedMarkdown(md).markdown;
    if (niche && /locations\/.+\.md$/i.test(rel)) {
      const slug = String(rel).replace(/^.*\//, '').replace(/\.md$/i, '');
      md = healLocationNicheHeadings(md, {
        niche,
        city: slug === primarySlug ? primaryCity : slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        state: String(siteConfig?.state || '').trim(),
        isPrimary: Boolean(primarySlug && slug === primarySlug),
      });
    }
    out[rel] = md;
  }
  return out;
}

/**
 * Geo-only or awkward primary “neighborhoods” title/h1 → niche + city (homeowners).
 */
function healLocationNicheHeadings(markdown, { niche, city, state, isPrimary }) {
  const split = splitFrontmatter(markdown);
  if (!split.ok || !niche || !city) return markdown;
  let fm = split.frontmatter;
  const h1 = fmScalar(fm, 'h1');
  const title = fmScalar(fm, 'title');
  const head = `${title} ${h1}`;
  const nicheN = niche.toLowerCase();
  const st = state ? `, ${state}` : '';
  const awkwardPrimary =
    isPrimary &&
    /\bneighborhoods?\b/i.test(head) &&
    !/\bhomeowners?\b|\bserving\b/i.test(head);
  const geoOnly =
    !head.toLowerCase().includes(nicheN) &&
    (/\bservice areas?\b|\bneighborhoods?\b/i.test(head) || !head.trim());
  const primaryTitleAwkward =
    isPrimary &&
    /\|\s*.+\s+homeowners\b/i.test(title || '') &&
    !new RegExp(`\\bin\\s+${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(title || '');
  if (!awkwardPrimary && !geoOnly) {
    if (primaryTitleAwkward && fmHasKey(fm, 'title')) {
      const nextTitle = `${niche} in ${city}${st}`.replace(/,\s*,/g, ',');
      fm = fm.replace(/^title\s*:.*$/im, `title: ${yamlDoubleQuote(nextTitle)}`);
      const body = split.body || '';
      const bodyOut = body.startsWith('\n') ? body : `\n${body}`;
      const out = `---\n${fm.trim()}\n---${bodyOut}`;
      return out.endsWith('\n') ? out : `${out}\n`;
    }
    return markdown;
  }
  const nextH1 = isPrimary
    ? `${niche} for ${city}${st} homeowners`.replace(/,\s*,/g, ',')
    : `${niche} in ${city}${st}`;
  const nextTitle = isPrimary
    ? `${niche} in ${city}${st}`.replace(/,\s*,/g, ',')
    : `${niche} | ${city}${st ? st.replace(/^,\s*/, ', ') : ''}`;
  if (fmHasKey(fm, 'h1')) {
    fm = fm.replace(/^h1\s*:.*$/im, `h1: ${yamlDoubleQuote(nextH1)}`);
  } else {
    fm = `${fm.trimEnd()}\nh1: ${yamlDoubleQuote(nextH1)}`;
  }
  if (fmHasKey(fm, 'title')) {
    fm = fm.replace(/^title\s*:.*$/im, `title: ${yamlDoubleQuote(nextTitle)}`);
  }
  const body = split.body || '';
  const bodyOut = body.startsWith('\n') ? body : `\n${body}`;
  const out = `---\n${fm.trim()}\n---${bodyOut}`;
  return out.endsWith('\n') ? out : `${out}\n`;
}

function fmHasKey(fm, key) {
  return new RegExp(`^${key}\\s*:`, 'm').test(fm);
}

/**
 * Lightweight frontmatter + required-file checks against site-config.
 * @param {{ mode?: 'homepage_first'|'full', pageIds?: string[] }} opts
 */
export function validateContentBundle(files, siteConfig, { mode = 'full', pageIds = null } = {}) {
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

  const serviceNames = [
    ...(Array.isArray(siteConfig?.services) ? siteConfig.services : []),
    ...(Array.isArray(siteConfig?.commercialServices) ? siteConfig.commercialServices : []),
  ];
  const expectedServiceSlugs = [...new Set(serviceNames.map(slugifyContentName).filter(Boolean))];
  const serviceFiles = paths.filter((p) => p.startsWith('src/content/services/'));
  const locationFiles = paths.filter((p) => p.startsWith('src/content/locations/'));

  const resolvedPageIds = Array.isArray(pageIds) && pageIds.length ? pageIds : null;
  const wantsServices = !resolvedPageIds || resolvedPageIds.includes('services');
  let launchExpected = [];
  let launchMissing = [];
  let launchStubs = [];
  if (!homepageFirst && resolvedPageIds) {
    const gaps = listLaunchContentGaps(files, siteConfig, resolvedPageIds);
    launchExpected = gaps.expected;
    launchMissing = gaps.missing;
    launchStubs = gaps.stubs;
    for (const rel of launchMissing) {
      if (requiredPages.includes(rel)) continue;
      warnings.push(`Missing required file: ${rel}`);
    }
    for (const rel of launchStubs) {
      warnings.push(`Stub/thin content (not launch-ready): ${rel}`);
    }
  }

  if (!homepageFirst) {
    if (!wantsServices) {
      // Structure excluded Services — expected service page count is 0 (orphans pruned elsewhere)
    } else if (isSingle) {
      if (serviceFiles.length > 1) {
        warnings.push(`Type B: prefer ≤1 service page; got ${serviceFiles.length}`);
      }
    } else {
      if (!serviceFiles.length) {
        errors.push('No services/*.md files (Type A requires service pages)');
      } else if (expectedServiceSlugs.length && serviceFiles.length < expectedServiceSlugs.length) {
        warnings.push(
          `Expected ~${expectedServiceSlugs.length} service file(s); got ${serviceFiles.length}`,
        );
      }
    }
    if (wantsServices) {
      for (const slug of expectedServiceSlugs) {
        const expected = `src/content/services/${slug}.md`;
        if (!files[expected] && !isSingle) {
          warnings.push(`No exact match for service slug "${slug}"`);
        }
      }
    }
    const suburbNames = Array.isArray(siteConfig?.targetSuburbs) ? siteConfig.targetSuburbs : [];
    if (resolvedPageIds?.includes('locations') && suburbNames.length) {
      for (const name of suburbNames) {
        const slug = slugifyContentName(name);
        if (!slug) continue;
        const expected = `src/content/locations/${slug}.md`;
        if (!files[expected]) warnings.push(`Missing required file: ${expected}`);
      }
    } else if (
      !resolvedPageIds &&
      !locationCountMatchesSite(locationFiles.length, siteConfig) &&
      (locationFiles.length < 4 || locationFiles.length > 6)
    ) {
      warnings.push(`Location pages: got ${locationFiles.length}, prefer 4–6`);
    }
  } else if (wantsServices && isSingle && serviceFiles.length > 1) {
    warnings.push('homepage_first Type B: unexpected multiple service files');
  }

  for (const [rel, markdown] of Object.entries(files || {})) {
    const split = splitFrontmatter(markdown);
    if (!split.ok) {
      errors.push(`${rel}: ${split.error}`);
      continue;
    }
    const { frontmatter: fm, body } = split;
    const yaml = tryParseYamlMapping(fm);
    if (!yaml.ok) {
      errors.push(`${rel}: invalid YAML frontmatter (${yaml.error})`);
      continue;
    }
    for (const key of ['title', 'description', 'h1']) {
      if (!fmHasKey(fm, key)) errors.push(`${rel}: missing frontmatter key "${key}"`);
    }

    const unknownFm = collectUnknownFrontmatterKeys(fm);
    if (unknownFm.length) {
      errors.push(
        `${rel}: invalid frontmatter key(s) ${unknownFm.map((k) => `"${k}"`).join(', ')} (body prose leaked into YAML — re-Load or re-Stage after sanitize)`,
      );
    }

    for (const key of IMAGE_FM_KEYS) {
      if (imageFieldLooksLikeBadScalar(fm, key)) {
        errors.push(
          `${rel}: ${key} must be { src, alt } or omitted (not a string). Omit the field when there is no image.`,
        );
      }
    }
    if (/^[ \t]*image\s*:\s*["']/m.test(fm) || /^[ \t]*image\s*:\s*[^|\s{\n][^\n]*$/m.test(fm)) {
      const imgLines = fm.split(/\n/).filter((l) => /^\s*image\s*:/.test(l));
      for (const line of imgLines) {
        const rest = line.replace(/^\s*image\s*:\s*/, '').trim();
        if (rest && !rest.startsWith('{') && (rest.startsWith('"') || rest.startsWith("'") || rest.includes('/'))) {
          errors.push(
            `${rel}: process/image fields must be { src, alt } or omitted (not a string)`,
          );
          break;
        }
      }
    }

    if (rel.includes('/pages/')) {
      if (rel.endsWith('/index.md')) {
        const missingDesigned = ['whyChooseUs', 'process', 'faqs'].filter((key) => !fmHasKey(fm, key));
        if (missingDesigned.length) warnings.push(homepageDesignedSectionWarning(missingDesigned));
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
    launch: {
      expected: launchExpected,
      missing: [...new Set(launchMissing)],
      stubs: [...new Set(launchStubs)],
      have: paths.length,
      expectedCount: launchExpected.length,
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

/** Start a draft from accepted content so a later paste merges instead of replacing the site. */
export function ensureContentDraftFromAccepted(candidateId) {
  const p = pathsFor(candidateId);
  const existing = readJson(p.contentDraft);
  if (existing?.files && typeof existing.files === 'object' && Object.keys(existing.files).length) {
    return existing;
  }
  const accepted = readJson(p.content);
  if (!accepted?.files || typeof accepted.files !== 'object' || !Object.keys(accepted.files).length) {
    return null;
  }
  const draft = {
    files: accepted.files,
    _ops: {
      ...(accepted._ops && typeof accepted._ops === 'object' ? accepted._ops : {}),
      savedAt: new Date().toISOString(),
      source: 'accepted_clone',
      fromAccepted: true,
    },
  };
  writeJson(p.contentDraft, draft);
  saveMeta(candidateId, { lastContentDraftAt: new Date().toISOString() });
  return draft;
}

export function pasteContentDraft(candidateId, raw) {
  const { config } = assertContentHandoffReady(candidateId);
  const pageIds = resolveStructurePageIds(candidateId);
  const extracted = extractSocialProofSidecar(raw);
  const parsed = parseContentFileBlocks(extracted.textWithoutSidecar, {
    expectedPaths: expectedLaunchContentPaths(config, pageIds),
  });
  const files = pruneFilesToStructure(normalizeContentFilesMap(parsed, config), {
    pageIds,
    siteConfig: config,
    siteArchetype: config.siteArchetype,
  });
  const onlyPages = Object.keys(files).every((p) => p.startsWith('src/content/pages/'));
  const resolvedMode = onlyPages ? 'homepage_first' : 'full';
  const check = validateContentBundle(files, config, { mode: resolvedMode, pageIds });
  assertValidYamlFrontmatter(check);
  const socialProofMerge = ensureRoverSocialProofSeed(candidateId, config);
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
      socialProofMerge,
    },
  });
  saveMeta(candidateId, { lastContentDraftAt: new Date().toISOString() });
  return {
    ok: true,
    draft: readJson(p.contentDraft),
    check,
    socialProofMerge,
    candidate: getCandidateShell(candidateId),
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

function buildLocationStubMarkdown({ city, state, niche, primaryCity, businessName }) {
  const stateUp = String(state || '').trim().toUpperCase();
  const primary = String(primaryCity || city).trim() || city;
  const brand = String(businessName || '').trim();
  const headings = locationPageHeadings({
    city,
    state: stateUp,
    niche,
    primaryCity: primary,
  });
  const { title, h1, description } = headings;
  const isPrimary =
    String(city || '')
      .trim()
      .toLowerCase() === String(primary).trim().toLowerCase();
  let body;
  if (isPrimary) {
    // Differentiated from homepage head term "{niche} in {city}, {ST}"
    body = [
      `${city} neighborhoods are part of how ${brand || 'our team'} plans ${niche} work around ${primary}. From older streets to newer subdivisions, access, soil, and permit rules shape the right repair or trenchless option.`,
      `This page is for homeowners and property managers who want local context for ${city}, ${stateUp} — not a second copy of the main ${niche} homepage. Browse services for the work you need, then use the estimate form or call to schedule a camera-backed visit.`,
      `We will walk through options, timeline, and next steps before any work begins. Link back to the homepage for the full service menu, or jump to a nearby suburb page if you are just outside city limits.`,
    ].join('\n\n');
  } else {
    // Stock fingerprint detected by preview-fidelity bodyLooksLikeStub
    body = [
      `${city} is part of our ${primary} service area for ${niche}. We help homeowners and property managers with clear estimates, careful workmanship, and scheduling that fits busy households.`,
      `Whether you need a straightforward repair or a larger project, local knowledge of ${city}, ${stateUp} conditions matters — soil, access, permits, and typical home styles in the area all affect the plan.`,
      `Browse our services for the work you need, then call or use the estimate form to schedule a visit. We will walk through options, timeline, and next steps before any work begins.`,
    ].join('\n\n');
  }
  return `---
title: ${yamlDoubleQuote(title)}
description: ${yamlDoubleQuote(description)}
h1: ${yamlDoubleQuote(h1)}
city: ${yamlDoubleQuote(city)}
state: ${yamlDoubleQuote(stateUp)}
draft: false
---

${body}
`;
}

/**
 * Cities that should have a locations/*.md page (primary + suburbs, de-duped).
 */
function configuredLocationCities(config = {}) {
  const cities = [];
  const primaryCity = String(config?.primaryCity || '').trim();
  if (primaryCity) cities.push(primaryCity);
  for (const suburb of config?.targetSuburbs || []) {
    const city = String(suburb || '').trim();
    if (!city) continue;
    if (cities.some((c) => c.toLowerCase() === city.toLowerCase())) continue;
    cities.push(city);
  }
  return cities;
}

/**
 * Add missing primary/suburb location markdown into a content files map (in-memory).
 * Does not write the template disk — Stage/Accept persist as needed.
 * @returns {{ files: Record<string,string>, seeded: string[] }}
 */
export function ensureLocationFilesInMap(files = {}, config = {}) {
  const next = { ...(files || {}) };
  const seeded = [];
  const niche = String(config?.niche || 'Local services').trim() || 'Local services';
  const state = String(config?.state || '').trim().toUpperCase();
  const primaryCity = String(config?.primaryCity || '').trim();
  const businessName = String(config?.businessName || '').trim();

  for (const city of configuredLocationCities(config)) {
    const slug = slugifyContentName(city);
    if (!slug) continue;
    const rel = `src/content/locations/${slug}.md`;
    if (next[rel]) continue;
    const markdown = buildLocationStubMarkdown({
      city,
      state,
      niche,
      primaryCity,
      businessName,
    });
    const body = markdown.endsWith('\n') ? markdown : `${markdown}\n`;
    next[rel] = body;
    seeded.push(rel);
  }
  return { files: next, seeded };
}

/**
 * Drop location MD that is not primary + targetSuburbs (orphans from older suburb sets).
 * @returns {{ files: Record<string,string>, pruned: string[] }}
 */
export function pruneLocationFilesToConfigured(files = {}, config = {}) {
  const next = { ...(files || {}) };
  const pruned = [];
  const allowedSlugs = new Set(
    configuredLocationCities(config)
      .map((city) => slugifyContentName(city))
      .filter(Boolean),
  );
  // If config has no SEO cities yet, do not wipe the map
  if (!allowedSlugs.size) return { files: next, pruned };

  for (const rel of Object.keys(next)) {
    const m = String(rel || '')
      .replace(/\\/g, '/')
      .match(/^src\/content\/locations\/([^/]+)\.md$/i);
    if (!m) continue;
    const slug = m[1];
    if (slug.startsWith('_')) continue;
    if (allowedSlugs.has(slug)) continue;
    delete next[rel];
    pruned.push(rel.replace(/\\/g, '/'));
  }
  return { files: next, pruned };
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
 * Seed location stubs for primaryCity + targetSuburbs onto template disk (only if missing).
 * @returns {{ written: string[], seeded: string[], files: Record<string,string> }}
 */
export function seedTargetSuburbLocationStubs(config) {
  const written = [];
  const seeded = [];
  const files = {};
  const niche = String(config?.niche || 'Local services').trim() || 'Local services';
  const state = String(config?.state || '').trim().toUpperCase();
  const primaryCity = String(config?.primaryCity || '').trim();
  const businessName = String(config?.businessName || '').trim();
  const locDir = path.join(CONTENT_ROOT, 'locations');
  mkdirSync(locDir, { recursive: true });

  for (const city of configuredLocationCities(config)) {
    const slug = slugifyContentName(city);
    if (!slug) continue;
    const rel = `src/content/locations/${slug}.md`;
    const abs = path.join(ROOT, ...rel.split('/'));
    if (existsSync(abs)) continue;
    const markdown = buildLocationStubMarkdown({
      city,
      state,
      niche,
      primaryCity,
      businessName,
    });
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

/**
 * Remove service pages whose serviceName is not in the allowed list.
 * "&" and "and" are the same name, matching the content slug.
 * @param {string[]} siteServices
 * @param {string} [svcDir]
 */
export function pruneUnmatchedServices(siteServices, svcDir = path.join(CONTENT_ROOT, 'services')) {
  const pruned = [];
  if (!svcDir || !existsSync(svcDir)) return pruned;
  const allowed = new Set((siteServices || []).map((s) => slugifyContentName(s)).filter(Boolean));
  if (!allowed.size) return pruned;
  for (const name of readdirSync(svcDir)) {
    if (!name.endsWith('.md') || name.startsWith('_')) continue;
    const abs = path.join(svcDir, name);
    const serviceName = readMdFrontmatterField(abs, 'serviceName');
    if (!serviceName) continue;
    if (!allowed.has(slugifyContentName(serviceName))) {
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
 * Move homepage Why / Process / FAQs that are already on a saved homepage into template fields.
 * Leaves writeBatches stamped so a Write site re-run does not rewrite About or Contact.
 */
export function liftSavedHomepageDraft(candidateId) {
  const p = pathsFor(candidateId);
  const draft = readJson(p.contentDraft);
  if (!draft?.files) return { changed: false };
  const config = loadAcceptedSiteConfig(candidateId)?.config || {};
  const outline = readJson(path.join(RESEARCH_DIR, `${p.id}-content-outline-package.json`)) || {};
  const lifted = applyHomepageDesignedSectionLiftToFiles(draft.files, { config, outline });
  if (!lifted.changed) return { changed: false };
  draft.files = lifted.files;
  draft._ops = stampHomepageLiftOnDraftOps(draft._ops, lifted);
  writeJson(p.contentDraft, draft);
  return { changed: true, detail: lifted.changes?.[0]?.detail || '' };
}

/**
 * Write draft Markdown into src/content/, prune leftovers not in the bundle.
 */
export async function acceptContent(
  candidateId,
  { ignoreWarnings = false, ignoreSeoWarnings = false } = {},
) {
  const { config } = assertContentHandoffReady(candidateId);
  const p = pathsFor(candidateId);
  let draft = readJson(p.contentDraft);
  if (!draft?.files || typeof draft.files !== 'object') {
    const err = new Error('No content draft — paste Claude FILE blocks first');
    err.status = 400;
    throw err;
  }

  if (!draft._ops?.lastSpeechCheckAt) {
    const err = new Error(
      'Run Speech/SEO Refinement before Accept — human-speech pass is required.',
    );
    err.status = 400;
    throw err;
  }
  const fieldPath = path.join(RESEARCH_DIR, `${p.id}-content-field-research.json`);
  const fieldResearch = readJson(fieldPath);
  if (!fieldResearch || fieldResearch.status !== 'loaded') {
    const err = new Error('Load Field research before Accept (eight-pass Soft path).');
    err.status = 400;
    throw err;
  }
  const softBrief = readJson(path.join(RESEARCH_DIR, `${p.id}-content-brief.json`));
  if (softBrief?.status !== 'confirmed') {
    const err = new Error('Confirm Content brief before Accept.');
    err.status = 400;
    throw err;
  }
  if (!draft._ops?.lastFinalCheckAt) {
    const err = new Error('Run Final check (Pass 8) before Accept.');
    err.status = 400;
    throw err;
  }
  const structureDoc = readJson(p.contentStructure);
  const photosOn = Object.values(structureDoc?.photos || {}).some((ph) => ph && ph.enabled);
  if (photosOn) {
    const imagesPlan = readJson(p.imagesPlan);
    if (!imagesPlan?.loadedAt && !draft._ops?.lastImagesPlanAt) {
      const err = new Error(
        'Load Image queries (Step 8) before Accept. A photo group or niche master does not skip Image queries.',
      );
      err.status = 400;
      throw err;
    }
    const { imagesPlanMeetsBaRequirements } = await import('./chatgpt-before-after.mjs');
    if (!imagesPlanMeetsBaRequirements(candidateId, imagesPlan)) {
      const err = new Error(
        'Image queries JSON is missing before/after prompts. Copy the Image queries prompt, have Claude return beforeAfter for every BA key (inside and outside), then Load again.',
      );
      err.status = 400;
      throw err;
    }
  }

  await applyStoredNichePhotoBlocks(candidateId);
  const freshDraft = readJson(p.contentDraft);
  if (freshDraft?.files) draft = freshDraft;

  const outlineForLift = readJson(path.join(RESEARCH_DIR, `${p.id}-content-outline-package.json`));
  const lifted = applyHomepageDesignedSectionLiftToFiles(draft.files, {
    config,
    outline: outlineForLift || {},
  });
  if (lifted.changed) {
    draft.files = lifted.files;
    draft._ops = stampHomepageLiftOnDraftOps(draft._ops, lifted);
    writeJson(p.contentDraft, draft);
    await applyStoredNichePhotoBlocks(candidateId);
    const relifted = readJson(p.contentDraft);
    if (relifted?.files) draft = relifted;
  }

  const files = pruneFilesToStructure(normalizeContentFilesMap(draft.files, config), {
    pageIds: resolveStructurePageIds(candidateId),
    siteConfig: config,
    siteArchetype: config.siteArchetype,
  });
  const pageIds = resolveStructurePageIds(candidateId);
  const wantsServices = pageIds.includes('services');
  const onlyPages = Object.keys(files).every((rel) => rel.startsWith('src/content/pages/'));
  const requireFull = outlineRequiresFullContent(candidateId);
  const mode = requireFull
    ? 'full'
    : draft._ops?.mode === 'homepage_first' || draft._ops?.mode === 'full'
      ? draft._ops.mode
      : onlyPages
        ? 'homepage_first'
        : 'full';

  // Primary + suburbs must exist before launch completeness assert (seed in-memory first).
  const ensured = ensureLocationFilesInMap(files, config);
  Object.assign(files, ensured.files);
  const preAssertLocationSeeded = ensured.seeded;

  const locHeal = healLocationFrontmatter(files, config);
  Object.assign(files, locHeal.files);
  const locationHeals = locHeal.heals || [];
  const svcHeal = healServiceFrontmatter(files, config);
  Object.assign(files, svcHeal.files);
  const serviceHeals = svcHeal.heals || [];
  const pageHeal = healPageFrontmatter(files, config);
  Object.assign(files, pageHeal.files);
  const pageHeals = pageHeal.heals || [];
  if (locHeal.changed || svcHeal.changed || pageHeal.changed) {
    draft.files = { ...(draft.files || {}), ...files };
    draft._ops = {
      ...(draft._ops || {}),
      ...(locationHeals.length ? { locationHeals } : {}),
      ...(serviceHeals.length ? { serviceHeals } : {}),
      ...(pageHeals.length ? { pageHeals } : {}),
    };
    writeJson(p.contentDraft, draft);
  }

  if (requireFull) {
    assertLaunchContentComplete(files, config, pageIds, {
      label: 'Accept',
      candidateId,
    });
  }

  const check = validateContentBundle(files, config, { mode, pageIds });
  if (!check.ok) {
    const missingState = (check.errors || []).some((e) => /missing state/i.test(String(e)));
    const noConfigState = !String(config.state || '').trim();
    const err = new Error(
      missingState && noConfigState
        ? `Set State on Site-config, then Accept. ${check.errors.slice(0, 3).join('; ')}`
        : `Content validation failed: ${check.errors.slice(0, 3).join('; ')}`,
    );
    err.status = 400;
    err.check = check;
    err.locationHeals = locationHeals;
    err.serviceHeals = serviceHeals;
    err.pageHeals = pageHeals;
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

  // SEO hard gate (critical findings)
  const outline = readJson(path.join(RESEARCH_DIR, `${p.id}-content-outline-package.json`));
  const sectionIds = outline?.sectionIds || (outline?.sections || []).map((s) => s?.id).filter(Boolean);
  const materialsEnabled =
    sectionIds.includes('materials') ||
    sectionIds.includes('svcMaterials') ||
    (config.homepageSections || []).includes('materials');
  const seoLint = lintContentSeo(files, {
    primaryKeyword:
      outline?.keywords?.primary || outline?.keywordTargets?.[0]?.keyword || config.niche,
    supportingKeywords:
      outline?.keywords?.supporting ||
      (outline?.keywordTargets || []).slice(1).map((t) => t.keyword),
    faqSeeds: outline?.faqSeeds || [],
    faqsEnabled:
      sectionIds.includes('faqs') ||
      (outline?.sections || []).some((s) => s.id === 'faqs') ||
      (config.homepageSections || []).includes('faqs'),
    requiredLinksByFile: buildRequiredLinksByFile(files, config, outline || {}),
    businessName: config.businessName,
    niche: config.niche,
    primaryCity: config.primaryCity,
    state: config.state,
    domain: config.domain,
    tagline: config.tagline,
    services: [
      ...(Array.isArray(config.services) ? config.services : []),
      ...(Array.isArray(config.commercialServices) ? config.commercialServices : []),
    ],
    locationMinWords: 450,
    strictLocationDepth: true,
    materialsEnabled,
    sectionIds,
    homepageSections: outline?.homepageSections || config.homepageSections || [],
    serviceBandAssignments: outline?.serviceBandAssignments || {},
    ...zoneLintContext(candidateId),
  });
  const criticalSeo = (seoLint?.findings || []).filter((f) => f.severity === 'critical');
  if (criticalSeo.length && !ignoreSeoWarnings) {
    const err = new Error(
      `SEO critical: ${criticalSeo
        .slice(0, 3)
        .map((f) => f.excerpt || f.rule)
        .join('; ')}. Fix via Editor or pass ignoreSeoWarnings (Accept with SEO warnings).`,
    );
    err.status = 400;
    err.seoLint = seoLint;
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
    // Exception: when Structure excludes Services, always drop leftover services/*.md
    if (
      mode === 'homepage_first' &&
      !file.rel.startsWith('src/content/pages/') &&
      !( !wantsServices && file.rel.startsWith('src/content/services/') )
    ) {
      continue;
    }
    unlinkSync(file.abs);
    pruned.push(file.rel);
  }

  let seeded = [...preAssertLocationSeeded];
  if (mode === 'homepage_first') {
    pruned.push(...pruneWrongStateLocations(config.state));
    const locationStubs = seedTargetSuburbLocationStubs(config);
    written.push(...locationStubs.written);
    seeded.push(...locationStubs.seeded);
    Object.assign(acceptedFiles, locationStubs.files);
    if (wantsServices) {
      pruned.push(...pruneUnmatchedServices(configuredServiceNames(config)));
      const serviceStubs = seedServiceStubs(config);
      written.push(...serviceStubs.written);
      seeded.push(...serviceStubs.seeded);
      Object.assign(acceptedFiles, serviceStubs.files);
    } else {
      pruned.push(...pruneAllServiceMarkdownFromDisk());
      for (const rel of Object.keys(acceptedFiles)) {
        if (rel.startsWith('src/content/services/')) delete acceptedFiles[rel];
      }
    }
  } else if (wantsServices) {
    // Full accept: drop service MD not in site-config (orphans / invents)
    pruned.push(...pruneUnmatchedServices(configuredServiceNames(config)));
    const locationStubs = seedTargetSuburbLocationStubs(config);
    written.push(...locationStubs.written);
    seeded.push(...locationStubs.seeded);
    Object.assign(acceptedFiles, locationStubs.files);
  } else {
    pruned.push(...pruneAllServiceMarkdownFromDisk());
    for (const rel of Object.keys(acceptedFiles)) {
      if (rel.startsWith('src/content/services/')) delete acceptedFiles[rel];
    }
    const locationStubs = seedTargetSuburbLocationStubs(config);
    written.push(...locationStubs.written);
    seeded.push(...locationStubs.seeded);
    Object.assign(acceptedFiles, locationStubs.files);
  }

  const draftOps = draft._ops || {};
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
      // Soft-path audit stamps (required before Accept — keep after draft delete)
      ...(draftOps.lastSpeechCheckAt
        ? { lastSpeechCheckAt: draftOps.lastSpeechCheckAt }
        : {}),
      ...(draftOps.lastEditorPromptAt
        ? { lastEditorPromptAt: draftOps.lastEditorPromptAt }
        : {}),
      ...(draftOps.lastFinalCheckAt
        ? {
            lastFinalCheckAt: draftOps.lastFinalCheckAt,
            lastFinalCheckOk: draftOps.lastFinalCheckOk,
            lastFinalCheckSummary: draftOps.lastFinalCheckSummary,
          }
        : {}),
      ...(draftOps.writeBatches ? { writeBatches: draftOps.writeBatches } : {}),
      ...(draftOps.speechLint ? { speechLint: draftOps.speechLint } : {}),
      ...(seoLint ? { seoLint } : draftOps.seoLint ? { seoLint: draftOps.seoLint } : {}),
      ...(draftOps.autoFix ? { autoFix: draftOps.autoFix } : {}),
      ...(locationHeals.length ? { locationHeals } : {}),
      ...(serviceHeals.length ? { serviceHeals } : {}),
      ...(pageHeals.length ? { pageHeals } : {}),
    },
  };
  writeJson(p.content, accepted);
  if (existsSync(p.contentDraft)) unlinkSync(p.contentDraft);

  // Keep Astro section gates aligned with confirmed Structure outline (avoid circular import)
  try {
    const outlinePkg = existsSync(p.contentOutlinePackage)
      ? JSON.parse(readFileSync(p.contentOutlinePackage, 'utf8'))
      : null;
    ensureRoverSocialProofSeed(candidateId, config, { alsoLive: true });
    if (existsSync(p.siteConfig)) {
      const scFresh = JSON.parse(readFileSync(p.siteConfig, 'utf8'));
      writeFileSync(
        p.siteConfig,
        `${JSON.stringify(
          {
            ...scFresh,
            ...(outlinePkg?.homepageSections?.length
              ? { homepageSections: outlinePkg.homepageSections }
              : {}),
            ...(outlinePkg?.siteArchetype ? { siteArchetype: outlinePkg.siteArchetype } : {}),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      const livePath = path.join(ROOT, 'src', 'config', 'site-config.json');
      if (existsSync(livePath) && outlinePkg?.homepageSections?.length) {
        const live = JSON.parse(readFileSync(livePath, 'utf8'));
        writeFileSync(
          livePath,
          `${JSON.stringify(
            {
              ...live,
              homepageSections: outlinePkg.homepageSections,
              ...(outlinePkg.siteArchetype ? { siteArchetype: outlinePkg.siteArchetype } : {}),
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
      }
    }
  } catch {
    // non-fatal — content files already written
  }

  // Restore ChatGPT before/after gallery FM when PNGs exist (Claude drafts omit gallery)
  let galleryBa = null;
  try {
    const { rehydrateGalleryBaFrontmatter } = await import('./chatgpt-before-after.mjs');
    galleryBa = rehydrateGalleryBaFrontmatter(candidateId);
  } catch {
    // non-fatal
  }

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
    galleryBa,
    locationHeals,
    serviceHeals,
    pageHeals,
    seoLint,
    nextStep: accepted._ops.nextStep,
    candidate: getCandidateShell(candidateId),
  };
}
