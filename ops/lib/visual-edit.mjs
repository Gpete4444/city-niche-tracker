/**
 * Operator-only visual editor: patch candidate source, then Stage / Assemble / ship.
 * Renters never see this. Live Worker HTML is not the source of truth.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { getCandidateDetail, pathsFor, RESEARCH_DIR, saveMeta } from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import {
  applyOutlineToSiteConfig,
  composeContentOutline,
  getContentStructure,
  loadSectionRegistry,
  pinHomeSectionEnds,
  saveContentStructure,
} from './content-structure.mjs';
import { applyPaletteToBrand, getPalette, listPalettes } from '../../scripts/lib/site-palettes.mjs';
import { applyFontThemeToBrand, getFontTheme, listFontThemes } from '../../scripts/lib/site-fonts.mjs';
import { lintContentSpeech } from './content-speech-lint.mjs';
import { lintContentSeo } from './content-seo-lint.mjs';
import { stageSiteContent } from './site-staging.mjs';
import { assembleSite, templateComponentsNewerThanAssembled } from './assemble-site.mjs';
import { buildAssembledSiteAsync, shipAssembledSite } from './ship-site.mjs';
import {
  contentNewerThanDist,
  ensureAssembledPreview,
  stopAssembledPreview,
  getAssembledPreviewBinding,
} from './assembled-preview.mjs';
import { isProcessHeading } from '../../src/lib/is-process-heading.mjs';
import { ghAuthStatus } from './github-site.mjs';
import { cloudflareConfigured } from './cloudflare-launch.mjs';

const ROOT = process.cwd();
const LIVE_CONFIG = path.join(ROOT, 'src', 'config', 'site-config.json');
const TEMPLATE_VE_BRIDGE = path.join(ROOT, 'public', 'rover-visual-bridge.js');

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

function yamlQuote(value) {
  return `"${String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')}"`;
}

function splitMarkdown(md) {
  const text = String(md || '').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: '', body: text, hasFm: false };
  return { fm: m[1], body: m[2], hasFm: true };
}

function joinMarkdown(fm, body) {
  const f = String(fm || '').trimEnd();
  const b = String(body || '').replace(/^\n+/, '');
  return `---\n${f}\n---\n${b.endsWith('\n') ? b : `${b}\n`}`;
}

function setScalarFm(fm, key, value) {
  const line = `${key}: ${yamlQuote(value)}`;
  const re = new RegExp(`^${key}:\\s*.*$`, 'm');
  if (re.test(fm)) return fm.replace(re, line);
  return `${fm.trimEnd()}\n${line}`;
}

function setImageFm(fm, key, src, alt) {
  const block = `${key}:\n  src: ${yamlQuote(src)}\n  alt: ${yamlQuote(alt)}`;
  const reObj = new RegExp(`^${key}:\\s*\\n(?:[ \\t]+[^\\n]*\\n)*`, 'm');
  const reScalar = new RegExp(`^${key}:\\s*[^\\n]*$`, 'm');
  if (reObj.test(fm)) return fm.replace(reObj, `${block}\n`);
  if (reScalar.test(fm)) return fm.replace(reScalar, block);
  return `${fm.trimEnd()}\n${block}`;
}

function listBlockRe(key) {
  return new RegExp(`^${key}:\\s*\\n((?:(?:[ \\t]+.*|-(?!-).*)\\n)*)`, 'm');
}

function splitYamlListItems(inner) {
  const starts = [...String(inner || '').matchAll(/^[ \t]*-(?!-)[ \t]*/gm)];
  if (!starts.length) return [];
  const items = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i].index;
    const end = i + 1 < starts.length ? starts[i + 1].index : inner.length;
    items.push(inner.slice(start, end));
  }
  return items;
}

function setListItemField(fm, listKey, index, field, value) {
  const re = listBlockRe(listKey);
  const m = fm.match(re);
  if (!m) return fm;
  const items = splitYamlListItems(m[1]);
  if (!items[index]) return fm;
  let item = items[index];
  const fieldRe = new RegExp(`^([ \\t]+)${field}:\\s*.*$`, 'm');
  if (fieldRe.test(item)) {
    item = item.replace(fieldRe, `$1${field}: ${yamlQuote(value)}`);
  } else {
    item = item.replace(/\n?$/, `\n    ${field}: ${yamlQuote(value)}\n`);
  }
  items[index] = item.endsWith('\n') ? item : `${item}\n`;
  const rebuilt = `${listKey}:\n${items.join('')}`;
  return fm.replace(re, rebuilt);
}

function setListItemSrcAlt(fm, listKey, index, src, alt) {
  let next = setListItemField(fm, listKey, index, 'src', src);
  return setListItemField(next, listKey, index, 'alt', alt);
}

function setNestedImage(fm, listKey, index, src, alt) {
  const re = listBlockRe(listKey);
  const m = fm.match(re);
  if (!m) return fm;
  const items = splitYamlListItems(m[1]);
  if (!items[index]) return fm;
  let item = items[index];
  const imgBlock = `    image:\n      src: ${yamlQuote(src)}\n      alt: ${yamlQuote(alt)}\n`;
  if (/^[ \t]+image:/m.test(item)) {
    item = item.replace(/^[ \t]+image:\s*\n(?:[ \t]+.*\n)*/m, imgBlock);
  } else {
    item = item.replace(/\n?$/, `\n${imgBlock}`);
  }
  items[index] = item.endsWith('\n') ? item : `${item}\n`;
  return fm.replace(re, `${listKey}:\n${items.join('')}`);
}

function mutateYamlList(fm, listKey, mutator) {
  const re = listBlockRe(listKey);
  const m = fm.match(re);
  if (!m) return fm;
  let items = splitYamlListItems(m[1]);
  items = mutator(items) || items;
  if (!items.length) {
    return fm.replace(re, `${listKey}: []\n`);
  }
  const next = items.map((it) => (it.endsWith('\n') ? it : `${it}\n`));
  return fm.replace(re, `${listKey}:\n${next.join('')}`);
}

function workingFiles(candidateId) {
  const p = pathsFor(candidateId);
  const accepted = readJson(p.content);
  const draft = readJson(p.contentDraft);
  const files = {
    ...(accepted?.files || {}),
    ...(draft?.files || {}),
  };
  if (Object.keys(files).length) return files;
  const live = {};
  for (const coll of ['pages', 'services', 'locations']) {
    const dir = path.join(ROOT, 'src', 'content', coll);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const rel = `src/content/${coll}/${name}`;
      live[rel] = readFileSync(path.join(dir, name), 'utf8');
    }
  }
  return live;
}

function persistFiles(candidateId, files) {
  const p = pathsFor(candidateId);
  const accepted = readJson(p.content) || { files: {}, _ops: {} };
  writeJson(p.content, {
    ...accepted,
    files,
    _ops: {
      ...(accepted._ops || {}),
      visualEditAt: new Date().toISOString(),
      fromVisualEdit: true,
    },
  });
  const draft = readJson(p.contentDraft);
  if (draft?.files) {
    writeJson(p.contentDraft, {
      ...draft,
      files: { ...draft.files, ...files },
      _ops: { ...(draft._ops || {}), visualEditAt: new Date().toISOString() },
    });
  }
  for (const [rel, body] of Object.entries(files)) {
    if (!rel.startsWith('src/content/')) continue;
    const abs = path.join(ROOT, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    const out = body.endsWith('\n') ? body : `${body}\n`;
    writeFileSync(abs, out, 'utf8');
  }
  saveMeta(candidateId, { lastVisualEditAt: new Date().toISOString() });
}

function stripOps(config) {
  if (!config || typeof config !== 'object') return {};
  const { _ops, ...clean } = config;
  return clean;
}

function persistConfig(candidateId, clean) {
  const p = pathsFor(candidateId);
  const prev = readJson(p.siteConfig) || {};
  writeJson(p.siteConfig, {
    ...clean,
    _ops: { ...(prev._ops || {}), visualEditAt: new Date().toISOString(), fromVisualEdit: true },
  });
  writeJson(LIVE_CONFIG, clean);
  const draft = readJson(p.siteConfigDraft);
  if (draft) {
    writeJson(p.siteConfigDraft, { ...draft, ...clean });
  }
}

function replaceProcessBodyLine(body, index, title, description) {
  const lines = String(body || '').split('\n');
  let inProcess = false;
  let step = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (/^#{1,2}\s/.test(t)) {
      const heading = t.replace(/^#+\s+/, '');
      inProcess = isProcessHeading(heading);
      continue;
    }
    if (!inProcess || !t || /^#{3}\s/.test(t)) continue;
    if (/[—–]/.test(t) || /^[^:]{1,80}:\s+/.test(t)) {
      step += 1;
      if (step === Number(index)) {
        const prev = (() => {
          const line = lines[i];
          const em = line.match(/^(.+?)\s*[—–]\s*(.+)$/);
          if (em) return { title: em[1].trim(), description: em[2].trim() };
          const colon = line.match(/^([^:]{1,80}):\s+(.+)$/);
          if (colon) return { title: colon[1].trim(), description: colon[2].trim() };
          return { title: line.trim(), description: '' };
        })();
        const nextTitle = title != null && String(title).trim() !== '' ? String(title).trim() : prev.title;
        const nextDesc = description != null && String(description).length ? String(description) : prev.description;
        lines[i] = `${nextTitle} — ${nextDesc}`.trim();
        break;
      }
    }
  }
  return lines.join('\n');
}

function undoPath(candidateId) {
  return path.join(RESEARCH_DIR, `${pathsFor(candidateId).id}-visual-edit-undo.json`);
}

export function beginVisualEditSession(candidateId) {
  const loaded = loadAcceptedSiteConfig(candidateId);
  writeJson(undoPath(candidateId), {
    files: workingFiles(candidateId),
    config: stripOps(loaded?.config),
    structure: getContentStructure(candidateId),
    at: new Date().toISOString(),
  });
}

export function restoreVisualEditUndo(candidateId) {
  const snap = readJson(undoPath(candidateId));
  if (!snap?.files) {
    throw Object.assign(new Error('No visual-edit undo snapshot'), { status: 400 });
  }
  persistFiles(candidateId, snap.files);
  if (snap.config && Object.keys(snap.config).length) persistConfig(candidateId, snap.config);
  if (snap.structure) {
    saveContentStructure(candidateId, snap.structure);
    composeContentOutline(candidateId);
    applyOutlineToSiteConfig(candidateId);
  }
  return { ok: true, snapshot: getVisualEditSnapshot(candidateId) };
}

function pageHref(rel) {
  const n = path.basename(rel, '.md');
  if (/pages\/index\.md$/i.test(rel)) return '/';
  if (/pages\/about\.md$/i.test(rel)) return '/about';
  if (/pages\/contact\.md$/i.test(rel)) return '/contact';
  if (/content\/services\//i.test(rel)) return `/services/${n}`;
  if (/content\/locations\//i.test(rel)) return `/locations/${n}`;
  return '/';
}

export function getVisualEditSnapshot(candidateId) {
  const detail = getCandidateDetail(candidateId);
  const loaded = loadAcceptedSiteConfig(candidateId);
  if (!loaded?.config) {
    throw Object.assign(new Error('Accept site-config first'), { status: 400 });
  }
  const config = stripOps(loaded.config);
  const files = workingFiles(candidateId);
  const structure = getContentStructure(candidateId);
  const registry = loadSectionRegistry();
  const pages = Object.keys(files)
    .filter((k) => /src\/content\/(pages|services)\//i.test(k))
    .sort((a, b) => {
      if (/pages\/index/.test(a)) return -1;
      if (/pages\/index/.test(b)) return 1;
      return a.localeCompare(b);
    })
    .map((file) => ({
      file,
      href: pageHref(file),
      label: path.basename(file, '.md').replace(/-/g, ' '),
    }));
  const rel = detail.meta?.assembledSitePath || null;
  return {
    candidateId: pathsFor(candidateId).id,
    pages,
    palettes: listPalettes(),
    fontThemes: listFontThemes(),
    config: {
      businessName: config.businessName || '',
      phone: config.phone || '',
      email: config.email || '',
      primaryCta: config.primaryCta || '',
      tagline: config.tagline || '',
      paletteId: config.brand?.paletteId || '',
      fontTheme: config.brand?.fontTheme || 'archivo-source',
      brand: {
        primary: config.brand?.primary || '',
        accent: config.brand?.accent || '',
        ink: config.brand?.ink || '',
        paletteId: config.brand?.paletteId || '',
        fontTheme: config.brand?.fontTheme || 'archivo-source',
      },
    },
    structure: {
      sections: structure?.sections || [],
      pages: structure?.pages || [],
    },
    catalogSections: (registry.sections || [])
      .filter((s) => (s.pages || []).includes('home'))
      .map((s) => ({
        id: s.id,
        label: s.label,
        astroKey: s.astroKey,
        required: Boolean(s.required),
      })),
    homepageSectionOrder: registry.homepageSectionOrder || [],
    assembled: Boolean(rel),
    assembledSitePath: rel,
    previewUrl: getAssembledPreviewBinding()?.url || 'http://127.0.0.1:4322/',
    hasUndo: existsSync(undoPath(candidateId)),
    businessName: config.businessName || detail.meta?.niche || candidateId,
  };
}

function applyOnePatch(candidateId, files, config, patch) {
  const type = String(patch?.type || '');
  if (type === 'config') {
    const key = String(patch.key || '');
    const allowed = ['businessName', 'phone', 'email', 'primaryCta', 'tagline'];
    if (!allowed.includes(key)) {
      throw Object.assign(new Error(`Cannot edit config.${key}`), { status: 400 });
    }
    config[key] = String(patch.value ?? '');
    return;
  }
  if (type === 'palette') {
    const palette = getPalette(patch.paletteId);
    if (!palette) throw Object.assign(new Error('Unknown palette'), { status: 400 });
    config.brand = applyPaletteToBrand(config.brand || {}, palette.id);
    return;
  }
  if (type === 'fontTheme') {
    const theme = getFontTheme(patch.fontTheme);
    if (!theme) throw Object.assign(new Error('Unknown font theme'), { status: 400 });
    config.brand = applyFontThemeToBrand(config.brand || {}, theme.id);
    return;
  }
  if (type === 'structure') {
    const structure = getContentStructure(candidateId) || {};
    let sections = [...(structure.sections || [])];
    const action = String(patch.action || '');
    const registry = loadSectionRegistry();
    const sectionById = new Map((registry.sections || []).map((s) => [s.id, s]));
    if (action === 'hide') {
      const def = sectionById.get(String(patch.sectionId || ''));
      if (def?.required) {
        throw Object.assign(
          new Error(`“${def.label || patch.sectionId}” is required and cannot be hidden`),
          { status: 400 },
        );
      }
      sections = sections.filter((id) => id !== patch.sectionId);
    } else if (action === 'show' && patch.sectionId && !sections.includes(patch.sectionId)) {
      sections.push(patch.sectionId);
    } else if (action === 'reorder' && Array.isArray(patch.sections)) {
      sections = patch.sections.filter(Boolean);
    }
    sections = pinHomeSectionEnds(sections);
    saveContentStructure(candidateId, { ...structure, sections });
    composeContentOutline(candidateId);
    applyOutlineToSiteConfig(candidateId);
    const stamped = loadAcceptedSiteConfig(candidateId)?.config;
    if (stamped) Object.assign(config, stripOps(stamped));
    return;
  }
  if (type === 'fm' || type === 'image' || type === 'list' || type === 'bodyStep') {
    const file = String(patch.file || '');
    if (!files[file]) {
      throw Object.assign(new Error(`Unknown file ${file}`), { status: 400 });
    }
    const parts = splitMarkdown(files[file]);
    if (type === 'fm') {
      parts.fm = setScalarFm(parts.fm, patch.key, patch.value);
    } else if (type === 'image') {
      const src = String(patch.src || '');
      const alt = String(patch.alt || 'Photo');
      if (patch.listKey != null && patch.index != null) {
        parts.fm = patch.nested
          ? setNestedImage(parts.fm, patch.listKey, Number(patch.index), src, alt)
          : setListItemSrcAlt(parts.fm, patch.listKey, Number(patch.index), src, alt);
      } else {
        parts.fm = setImageFm(parts.fm, patch.key || 'heroImage', src, alt);
      }
    } else if (type === 'list') {
      const listKey = String(patch.listKey);
      const field = String(patch.field || 'title');
      const index = Number(patch.index);
      const action = String(patch.action || 'set');
      if (action === 'set') {
        parts.fm = setListItemField(parts.fm, listKey, index, field, patch.value);
      } else if (action === 'remove') {
        parts.fm = mutateYamlList(parts.fm, listKey, (items) => items.filter((_, i) => i !== index));
      } else if (action === 'add') {
        parts.fm = mutateYamlList(parts.fm, listKey, (items) => {
          const blank =
            listKey === 'faqs'
              ? `  - question: "New question?"\n    answer: ""\n`
              : `  - title: "New item"\n    description: ""\n`;
          return [...items, blank];
        });
      } else if (action === 'move') {
        const dir = Number(patch.dir) || 0;
        parts.fm = mutateYamlList(parts.fm, listKey, (items) => {
          const j = index + dir;
          if (j < 0 || j >= items.length) return items;
          const copy = [...items];
          const [row] = copy.splice(index, 1);
          copy.splice(j, 0, row);
          return copy;
        });
      }
    } else if (type === 'bodyStep') {
      parts.body = replaceProcessBodyLine(
        parts.body,
        Number(patch.index),
        patch.title,
        patch.description,
      );
    }
    files[file] = joinMarkdown(parts.fm, parts.body);
    return;
  }
  throw Object.assign(new Error(`Unknown patch type ${type}`), { status: 400 });
}

export function applyVisualEditPatches(candidateId, patches = []) {
  const loaded = loadAcceptedSiteConfig(candidateId);
  if (!loaded?.config) {
    throw Object.assign(new Error('Accept site-config first'), { status: 400 });
  }
  const files = workingFiles(candidateId);
  const config = stripOps(loaded.config);
  const list = Array.isArray(patches) ? patches : [];
  if (!list.length) {
    throw Object.assign(new Error('No patches'), { status: 400 });
  }
  for (const patch of list) applyOnePatch(candidateId, files, config, patch);
  persistFiles(candidateId, files);
  persistConfig(candidateId, config);
  return {
    ok: true,
    snapshot: getVisualEditSnapshot(candidateId),
  };
}

function decodeDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) {
    throw Object.assign(new Error('Provide dataUrl (data:image/...;base64,...)'), { status: 400 });
  }
  const mime = m[1].toLowerCase();
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  return { ext, buffer: Buffer.from(m[2], 'base64') };
}

export function uploadVisualEditImage(candidateId, body = {}) {
  const decoded = decodeDataUrl(body.dataUrl);
  const p = pathsFor(candidateId);
  mkdirSync(p.siteImages, { recursive: true });
  const filename = `visual-${Date.now()}.${decoded.ext}`;
  writeFileSync(path.join(p.siteImages, filename), decoded.buffer);
  const publicDir = path.join(ROOT, 'public', 'images');
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(path.join(publicDir, filename), decoded.buffer);
  const src = `/images/${filename}`;
  const alt = String(body.alt || '').trim() || 'Photo';
  const patch = {
    type: 'image',
    file: body.file,
    key: body.key,
    listKey: body.listKey,
    index: body.index,
    nested: Boolean(body.nested),
    src,
    alt,
  };
  applyVisualEditPatches(candidateId, [patch]);
  return { ok: true, src, alt, filename, snapshot: getVisualEditSnapshot(candidateId) };
}

export async function refreshVisualEditPreview(candidateId, { rebuild = true } = {}) {
  stageSiteContent(candidateId, { mode: 'full', refreshPackage: false });
  await stopAssembledPreview();
  const assembled = assembleSite(candidateId, { force: true, skipGit: true });
  let build = null;
  if (assembled.absoluteSiteRoot && rebuild) {
    try {
      build = await buildAssembledSiteAsync(assembled.absoluteSiteRoot, { visualEdit: true });
    } catch (e) {
      build = { ok: false, error: e.message };
    }
  }
  let preview = null;
  if (assembled.absoluteSiteRoot && build?.ok !== false) {
    // Avoid a second npm install/build when we already built above.
    // ensureAssembledPreview still rebuilds if dist is older than content.
    preview = await ensureAssembledPreview(assembled.absoluteSiteRoot, {
      rebuild: false,
      forceRebind: true,
    });
  }
  return { ok: true, assembled, build, preview, snapshot: getVisualEditSnapshot(candidateId) };
}

function resolveAssembledSiteRoot(candidateId) {
  const detail = getCandidateDetail(candidateId);
  const rel = detail.meta?.assembledSitePath;
  if (!rel) return null;
  const abs = path.resolve(ROOT, rel);
  return existsSync(abs) ? abs : null;
}

/** True when assembled VE bridge is missing live-reorder support or older than template. */
function visualBridgeStale(siteRoot) {
  if (!siteRoot || !existsSync(TEMPLATE_VE_BRIDGE)) return false;
  const assembledBridge = path.join(siteRoot, 'public', 'rover-visual-bridge.js');
  if (!existsSync(assembledBridge)) return true;
  try {
    const body = readFileSync(assembledBridge, 'utf8');
    if (!body.includes('reorderSections')) return true;
    const templateMtime = statSync(TEMPLATE_VE_BRIDGE).mtimeMs;
    const assembledMtime = statSync(assembledBridge).mtimeMs;
    if (templateMtime > assembledMtime + 2000) return true;
  } catch {
    return true;
  }
  return false;
}

/** True when built homepage HTML lacks data-section markers or the VE bridge script tag. */
function visualPreviewMarkersStale(siteRoot) {
  if (!siteRoot) return true;
  const distIndex = path.join(siteRoot, 'dist', 'index.html');
  if (!existsSync(distIndex)) return true;
  try {
    const html = readFileSync(distIndex, 'utf8');
    if (!html.includes('data-section=')) return true;
    if (!html.includes('rover-visual-bridge.js')) return true;
  } catch {
    return true;
  }
  return false;
}

/**
 * Open-path ensure: reassemble/rebuild only when template, bridge, or content is stale.
 * Warm opens skip force assemble when already current.
 */
export async function ensureVisualEditPreviewReady(candidateId) {
  stageSiteContent(candidateId, { mode: 'full', refreshPackage: false });

  let siteRoot = resolveAssembledSiteRoot(candidateId);
  const needsAssemble =
    !siteRoot || templateComponentsNewerThanAssembled(siteRoot) || visualBridgeStale(siteRoot);
  const markersStale = Boolean(siteRoot && visualPreviewMarkersStale(siteRoot));
  const needsContentBuild = Boolean(
    siteRoot && (contentNewerThanDist(siteRoot) || markersStale),
  );

  if (!needsAssemble && !needsContentBuild) {
    const preview = await ensureAssembledPreview(siteRoot, {
      rebuild: false,
      forceRebind: false,
    });
    return {
      ok: true,
      smart: true,
      refreshed: false,
      assembled: { absoluteSiteRoot: siteRoot, assembledSitePath: path.relative(ROOT, siteRoot) },
      build: null,
      preview,
      snapshot: getVisualEditSnapshot(candidateId),
    };
  }

  await stopAssembledPreview();
  let assembled;
  if (needsAssemble || markersStale) {
    // Markers missing from dist often means assembled src is also behind — force template sync.
    assembled = assembleSite(candidateId, { force: true, skipGit: true });
    siteRoot = assembled.absoluteSiteRoot || siteRoot;
  } else {
    assembled = {
      absoluteSiteRoot: siteRoot,
      assembledSitePath: path.relative(ROOT, siteRoot).replace(/\\/g, '/'),
    };
  }

  let build = null;
  if (siteRoot) {
    try {
      build = await buildAssembledSiteAsync(siteRoot, { visualEdit: true });
    } catch (e) {
      build = { ok: false, error: e.message };
    }
  }

  let preview = null;
  if (siteRoot && build?.ok !== false) {
    preview = await ensureAssembledPreview(siteRoot, {
      rebuild: false,
      forceRebind: true,
    });
  }

  return {
    ok: true,
    smart: true,
    refreshed: true,
    assembled,
    build,
    preview,
    snapshot: getVisualEditSnapshot(candidateId),
  };
}

export async function publishVisualEdit(candidateId, { ignoreSeoWarnings = false, ship = true } = {}) {
  const loaded = loadAcceptedSiteConfig(candidateId);
  const files = workingFiles(candidateId);
  const config = loaded?.config || {};
  const speechLint = lintContentSpeech(files, {
    primaryCity: config.primaryCity,
    niche: config.niche,
    businessName: config.businessName,
  });
  const outline = readJson(pathsFor(candidateId).contentOutlinePackage);
  const seoLint = lintContentSeo(files, {
    primaryKeyword: outline?.keywords?.primary || config.niche,
    faqsEnabled: (config.homepageSections || []).includes('faqs'),
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
    sectionIds: outline?.sectionIds || (outline?.sections || []).map((s) => s.id).filter(Boolean),
    homepageSections: outline?.homepageSections || config.homepageSections || [],
    serviceBandAssignments: outline?.serviceBandAssignments || {},
  });
  const criticalSeo = (seoLint?.findings || []).filter((f) => f.severity === 'critical');
  if (criticalSeo.length && !ignoreSeoWarnings) {
    const err = new Error(
      `SEO critical: ${criticalSeo
        .slice(0, 3)
        .map((f) => f.excerpt || f.rule)
        .join('; ')}`,
    );
    err.status = 400;
    err.speechLint = speechLint;
    err.seoLint = seoLint;
    throw err;
  }
  const refreshed = await refreshVisualEditPreview(candidateId, { rebuild: true });
  let shipResult = null;
  const canShip = Boolean(ghAuthStatus()) && cloudflareConfigured();
  if (ship && canShip) {
    if (refreshed.build?.ok === false) {
      const err = new Error(
        `Publish rebuild failed before ship: ${refreshed.build?.error || 'unknown build error'}`,
      );
      err.status = 500;
      err.speechLint = speechLint;
      err.seoLint = seoLint;
      throw err;
    }
    // Always production-build inside ship (never skipBuild after a VE preview build).
    try {
      shipResult = await shipAssembledSite(candidateId, { skipBuild: false });
    } catch (e) {
      shipResult = { ok: false, error: e.message, ship: e.ship };
    }
  } else if (ship && !canShip) {
    shipResult = {
      skipped: true,
      reason: 'Set gh auth + CLOUDFLARE_* to ship after publish',
    };
  }
  return {
    ok: Boolean(shipResult?.ok || shipResult?.skipped || !ship),
    speechLint,
    seoLint,
    ...refreshed,
    ship: shipResult,
  };
}
