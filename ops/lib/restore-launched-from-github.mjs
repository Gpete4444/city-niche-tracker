/**
 * Restore Rover research working copy from the candidate's GitHub launched site (origin/main).
 * Does not Push or redeploy Cloudflare.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getCandidateDetail, loadMeta, pathsFor, saveMeta } from './candidates.mjs';
import {
  composeContentOutline,
  confirmContentOutline,
  getContentOutlinePackage,
  saveContentStructure,
} from './content-structure.mjs';
import { isCandidateLaunched } from './launched-edit-guard.mjs';
import { loadEnvFile } from '../../scripts/lib/dataforseo.mjs';

loadEnvFile();

const ROOT = process.cwd();
const CONTENT_REL_RE =
  /^src\/content\/(pages|services|locations)\/[a-z0-9][a-z0-9-]*\.md$/i;

/** Known section id prefixes (longest first for camelCase matches). */
const SECTION_PREFIXES = [
  'offerProcess',
  'beforeAfter',
  'whyChooseUs',
  'whenToCall',
  'diyVsPro',
  'svcBeforeAfter',
  'svcWhatsIncluded',
  'svcMaterials',
  'svcProcess',
  'svcTimeline',
  'svcWhenToCall',
  'svcDiyVsPro',
  'svcHero',
  'svcIntro',
  'svcCost',
  'svcCodes',
  'svcFaqs',
  'svcCta',
  'aboutStory',
  'contactInfo',
  'materials',
  'services',
  'process',
  'coverage-map',
  'coverageMap',
  'hero',
  'intro',
  'trust',
  'areas',
  'reviews',
  'faqs',
  'cost',
  'codes',
  'timeline',
  'cta',
  'logo',
];

function nowIso() {
  return new Date().toISOString();
}

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function run(cmd, args, cwd, { allowFail = false } = {}) {
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: process.env,
    });
    return { ok: true, stdout: String(out || '').trim(), stderr: '' };
  } catch (error) {
    const stdout = String(error?.stdout || '').trim();
    const stderr = String(error?.stderr || '').trim();
    const detail = stderr || stdout || String(error?.message || error);
    if (allowFail) return { ok: false, stdout, stderr: detail };
    const err = new Error(detail || `${cmd} ${args.join(' ')} failed`);
    err.status = 500;
    throw err;
  }
}

function assembledSitesRoot() {
  const fromEnv = String(process.env.ASSEMBLED_SITES_DIR || '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(ROOT, '..', 'rover-sites');
}

function walkMarkdownFiles(absRoot, relBase = '') {
  const out = [];
  if (!existsSync(absRoot)) return out;
  for (const name of readdirSync(absRoot)) {
    if (name.startsWith('.')) continue;
    const abs = path.join(absRoot, name);
    const rel = relBase ? `${relBase}/${name}` : name;
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...walkMarkdownFiles(abs, rel));
    else if (st.isFile() && name.endsWith('.md')) out.push({ abs, rel: rel.replace(/\\/g, '/') });
  }
  return out;
}

function collectContentFiles(siteRoot) {
  const contentRoot = path.join(siteRoot, 'src', 'content');
  const files = {};
  for (const { abs, rel } of walkMarkdownFiles(contentRoot, 'src/content')) {
    const key = rel.replace(/\\/g, '/');
    if (!CONTENT_REL_RE.test(key)) continue;
    files[key] = readFileSync(abs, 'utf8');
  }
  return files;
}

function stripOps(config) {
  if (!config || typeof config !== 'object') return {};
  const { _ops, ...rest } = config;
  return rest;
}

/**
 * Parse `offerProcess-2-upload-xxx.png` → { sectionId, index, uploadPreferred }.
 */
function parseImageSlotFilename(filename) {
  const base = String(filename || '');
  const lower = base.toLowerCase();
  if (lower === 'logo.svg' || lower.startsWith('logo.')) {
    return { sectionId: 'logo', index: 1, uploadPreferred: false };
  }
  if (lower === 'coverage-map.svg' || lower.startsWith('coverage-map.')) {
    return { sectionId: 'coverageMap', index: 1, uploadPreferred: false };
  }
  for (const prefix of SECTION_PREFIXES) {
    const re = new RegExp(`^${prefix}-(\\d+)(?:-|\\.|$)`, 'i');
    const m = base.match(re);
    if (m) {
      const sectionId =
        prefix === 'coverage-map' ? 'coverageMap' : prefix === 'before-after' ? 'beforeAfter' : prefix;
      return {
        sectionId,
        index: Math.max(1, Number(m[1]) || 1),
        uploadPreferred: /upload/i.test(base),
      };
    }
  }
  return null;
}

/** Collect /images/… paths referenced in restored markdown FM. */
function collectFrontmatterImagePaths(files = {}) {
  const preferred = new Set();
  const re = /(?:src):\s*["'](\/images\/[^"']+)["']/gi;
  const reBare = /\/images\/[a-zA-Z0-9._-]+/g;
  for (const md of Object.values(files)) {
    const text = String(md || '');
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) preferred.add(m[1].replace(/^\/images\//, ''));
    // Also catch list items under materialsImages / servicesImages
    reBare.lastIndex = 0;
    while ((m = reBare.exec(text))) {
      const name = m[0].replace(/^\/images\//, '');
      if (name) preferred.add(name);
    }
  }
  return preferred;
}

function copyImagesToSiteImages(siteRoot, siteImagesDir) {
  const fromDir = path.join(siteRoot, 'public', 'images');
  if (existsSync(siteImagesDir)) {
    rmSync(siteImagesDir, { recursive: true, force: true });
  }
  mkdirSync(siteImagesDir, { recursive: true });
  if (!existsSync(fromDir)) return { copied: 0, files: [] };
  const files = [];
  for (const name of readdirSync(fromDir)) {
    if (name.startsWith('.')) continue;
    const from = path.join(fromDir, name);
    try {
      if (!statSync(from).isFile()) continue;
    } catch {
      continue;
    }
    cpSync(from, path.join(siteImagesDir, name));
    files.push(name);
  }
  return { copied: files.length, files };
}

function slotEntry(filename, sectionId, photoId) {
  return {
    key: null,
    filename,
    src: `/images/${filename}`,
    sectionId,
    provider: null,
    photoId,
  };
}

/**
 * Build manifest with full slot map: prefer FM-cited files, then *-upload-*, else first match.
 */
function buildImagesManifest(candidateId, filenames, contentFiles = {}) {
  const fmPreferred = collectFrontmatterImagePaths(contentFiles);
  const files = [];
  const usedIds = [];
  /** @type {Map<string, { filename: string, score: number }>} */
  const bestBySlot = new Map();

  for (const filename of filenames) {
    const parsed = parseImageSlotFilename(filename);
    const sectionId = parsed?.sectionId || null;
    const src = `/images/${filename}`;
    const photoId = `revert:${filename}`;
    const entry = {
      filename,
      src,
      sectionId,
      provider: null,
      photoId,
      photographer: null,
      pageUrl: null,
      attribution: 'Restored from launched GitHub site',
      source: 'revert-launched',
    };
    files.push(entry);
    usedIds.push(photoId);

    if (!parsed || sectionId === 'logo' || sectionId === 'coverageMap') continue;
    const slotKey = `${sectionId}-${parsed.index}`;
    let score = 1;
    if (fmPreferred.has(filename)) score += 100;
    if (parsed.uploadPreferred) score += 50;
    if (/\.svg$/i.test(filename)) score -= 5;
    const prior = bestBySlot.get(slotKey);
    if (!prior || score > prior.score) {
      bestBySlot.set(slotKey, { filename, score, sectionId, photoId });
    }
  }

  /** @type {Record<string, object>} */
  const slots = {};
  for (const [slotKey, best] of bestBySlot) {
    const e = slotEntry(best.filename, best.sectionId, best.photoId);
    e.key = slotKey;
    slots[slotKey] = e;
  }

  // Ensure logo slot metadata when present
  if (filenames.includes('logo.svg')) {
    slots['logo-1'] = {
      key: 'logo-1',
      filename: 'logo.svg',
      src: '/images/logo.svg',
      sectionId: 'logo',
      provider: null,
      photoId: 'revert:logo.svg',
    };
  }

  return {
    version: 1,
    candidateId,
    usedIds,
    files,
    slots,
    sources: {},
    pulledAt: nowIso(),
    restoredFromLaunch: true,
  };
}

function photoCountsFromSlots(slots, sectionIds) {
  const photos = {};
  for (const id of sectionIds) {
    let max = 0;
    for (const key of Object.keys(slots)) {
      if (!key.startsWith(`${id}-`)) continue;
      const n = Number(key.slice(id.length + 1));
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
    if (max > 0) photos[id] = { enabled: true, count: max };
  }
  return photos;
}

function structureSelectionFromRestored({ files, config, imageSlots = {} }) {
  const pages = ['home', 'about', 'contact'];
  const keys = Object.keys(files);
  const hasServices = keys.some((f) => f.includes('/services/'));
  const hasLocations = keys.some((f) => f.includes('/locations/'));
  if (hasServices) pages.push('services');
  if (hasLocations) pages.push('locations');

  const homepageKeys = Array.isArray(config?.homepageSections)
    ? config.homepageSections.map(String)
    : [];
  /** @type {string[]} */
  let sections = [];
  const keyToId = {
    hero: 'hero',
    trustBar: 'trust',
    trust: 'trust',
    intro: 'intro',
    services: 'services',
    process: 'process',
    offerProcess: 'offerProcess',
    materials: 'materials',
    cost: 'cost',
    timeline: 'timeline',
    codes: 'codes',
    diyVsPro: 'diyVsPro',
    whenToCall: 'whenToCall',
    whyChooseUs: 'whyChooseUs',
    areas: 'areas',
    beforeAfter: 'beforeAfter',
    reviews: 'reviews',
    faqs: 'faqs',
    cta: 'cta',
  };
  for (const key of homepageKeys) {
    const id = keyToId[key] || key;
    if (!sections.includes(id)) sections.push(id);
  }
  if (!sections.includes('hero')) sections.unshift('hero');
  if (pages.includes('about') && !sections.includes('aboutStory')) sections.push('aboutStory');
  if (pages.includes('contact') && !sections.includes('contactInfo')) sections.push('contactInfo');
  if (hasServices) {
    for (const id of [
      'svcHero',
      'svcIntro',
      'svcWhatsIncluded',
      'svcProcess',
      'svcCost',
      'svcMaterials',
      'svcTimeline',
      'svcCodes',
      'svcFaqs',
      'svcDiyVsPro',
      'svcWhenToCall',
      'svcBeforeAfter',
      'svcCta',
    ]) {
      if (!sections.includes(id)) sections.push(id);
    }
  }
  if (!sections.includes('cta')) sections.push('cta');

  if (homepageKeys.includes('offerProcess') && !homepageKeys.includes('process')) {
    sections = sections.filter((id) => id !== 'process');
    if (!sections.includes('offerProcess')) sections.push('offerProcess');
  }

  const photoCapable = [
    'hero',
    'intro',
    'services',
    'process',
    'offerProcess',
    'materials',
    'beforeAfter',
    'svcHero',
    'svcProcess',
    'svcMaterials',
    'svcBeforeAfter',
  ];
  let photos = photoCountsFromSlots(imageSlots, photoCapable);
  for (const id of photoCapable) {
    if (!sections.includes(id)) continue;
    if (!photos[id]) {
      photos[id] = {
        enabled: true,
        count: id === 'hero' || id === 'intro' || id === 'svcHero' ? 1 : 6,
      };
    }
  }

  return { pages, sections, photos, presetId: null };
}

function faqsFromIndexMarkdown(files = {}) {
  const index = files['src/content/pages/index.md'] || '';
  const out = [];
  const block = index.match(/^faqs:\s*\n((?:  - .*\n(?:    .*\n)*)+)/m);
  if (!block) return out;
  const qRe = /question:\s*["']([^"']+)["']/g;
  let m;
  while ((m = qRe.exec(block[1]))) out.push(m[1]);
  return out;
}

/**
 * Compose + confirm outline so Content Outline is checked and pageIds match restored pages.
 */
async function composeAndConfirmRestoredOutline(candidateId, selection, config, contentFiles) {
  composeContentOutline(candidateId, selection);
  let outline = getContentOutlinePackage(candidateId);
  if (!outline) {
    throw Object.assign(new Error('Compose outline failed during revert'), { status: 500 });
  }

  const targets = Array.isArray(outline.keywordTargets) ? outline.keywordTargets : [];
  if (targets.length < 3) {
    const niche = String(config?.niche || 'local service').trim();
    const city = String(config?.primaryCity || '').trim();
    outline = {
      ...outline,
      keywordTargets: [
        { role: 'primary', phrase: niche },
        { role: 'supporting', phrase: city ? `${niche} ${city}` : `${niche} near me` },
        { role: 'supporting', phrase: city ? `${city} ${niche}` : 'free estimate' },
      ],
    };
  }

  const faqsOn =
    (outline.sectionIds || []).includes('faqs') ||
    (outline.sections || []).some((s) => s.id === 'faqs');
  const seeds = Array.isArray(outline.faqSeeds) ? outline.faqSeeds : [];
  if (faqsOn && seeds.length < 6) {
    const fromMd = faqsFromIndexMarkdown(contentFiles);
    const padded = [...fromMd];
    while (padded.length < 6) {
      padded.push(`When should I call a pro for ${config?.niche || 'this service'}? (${padded.length + 1})`);
    }
    outline = { ...outline, faqSeeds: padded.slice(0, Math.max(6, fromMd.length)) };
  }

  writeJson(pathsFor(candidateId).contentOutlinePackage, outline);
  await confirmContentOutline(candidateId);
  return getContentOutlinePackage(candidateId);
}

function cloneOrUpdateRepo(fullName, siteRoot) {
  mkdirSync(path.dirname(siteRoot), { recursive: true });
  if (existsSync(path.join(siteRoot, '.git'))) {
    run('git', ['fetch', 'origin'], siteRoot);
    run('git', ['checkout', 'main'], siteRoot, { allowFail: true });
    run('git', ['reset', '--hard', 'origin/main'], siteRoot);
    return { mode: 'reset', siteRoot };
  }
  if (existsSync(siteRoot)) {
    rmSync(siteRoot, { recursive: true, force: true });
  }
  const gh = run('gh', ['--version'], ROOT, { allowFail: true });
  if (gh.ok) {
    run('gh', ['repo', 'clone', fullName, siteRoot, '--', '--depth', '1'], ROOT);
  } else {
    run(
      'git',
      ['clone', '--depth', '1', `https://github.com/${fullName}.git`, siteRoot],
      ROOT,
    );
  }
  return { mode: 'clone', siteRoot };
}

/**
 * @param {string} candidateId
 * @param {{ confirmRevert?: boolean }} [opts]
 */
export async function restoreLaunchedFromGithub(candidateId, opts = {}) {
  const id = String(candidateId || '').trim();
  if (!id) {
    throw Object.assign(new Error('candidateId required'), { status: 400 });
  }
  if (!opts.confirmRevert) {
    throw Object.assign(
      new Error('confirmRevert required — this overwrites Rover content, structure, site-config, and images'),
      { status: 400 },
    );
  }
  if (!isCandidateLaunched(id)) {
    throw Object.assign(new Error(`${id}: Revert is only available after Launch / Ship`), {
      status: 400,
    });
  }

  const meta = loadMeta(id);
  const fullName = String(meta.githubRepo || '').trim();
  if (!fullName || !fullName.includes('/')) {
    throw Object.assign(
      new Error(`${id}: No githubRepo on meta — cannot revert from launched site`),
      { status: 400 },
    );
  }

  const slug =
    String(meta.assembledSiteSlug || '').trim() ||
    String(meta.cfProject || '').trim() ||
    fullName.split('/')[1];
  const sitesRoot = assembledSitesRoot();
  const siteRoot = path.join(sitesRoot, `${slug}.__revert-launched`);

  console.log('[revert-launched]', id, '←', fullName, '→', siteRoot);
  const clone = cloneOrUpdateRepo(fullName, siteRoot);

  const head = run('git', ['rev-parse', 'HEAD'], siteRoot, { allowFail: true });
  const headSha = head.ok ? head.stdout.slice(0, 12) : null;

  const configPath = path.join(siteRoot, 'src', 'config', 'site-config.json');
  const rawConfig = readJson(configPath);
  if (!rawConfig) {
    throw Object.assign(new Error(`${id}: Launched site missing src/config/site-config.json`), {
      status: 500,
    });
  }
  const config = stripOps(rawConfig);
  const p = pathsFor(id);
  writeJson(p.siteConfig, {
    ...config,
    _ops: {
      acceptedAt: nowIso(),
      writtenTo: 'research-only (revert-launched)',
      restoredFromGithub: fullName,
      restoredAt: nowIso(),
      restoredSha: headSha,
    },
  });
  if (existsSync(p.siteConfigDraft)) {
    try {
      rmSync(p.siteConfigDraft);
    } catch {
      /* ignore */
    }
  }

  const files = collectContentFiles(siteRoot);
  if (!Object.keys(files).length) {
    throw Object.assign(new Error(`${id}: No src/content markdown found in launched repo`), {
      status: 500,
    });
  }
  writeJson(p.content, {
    files,
    _ops: {
      acceptedAt: nowIso(),
      writtenTo: 'research-only (revert-launched)',
      written: Object.keys(files),
      pruned: [],
      seeded: [],
      check: { ok: true, errors: [], warnings: [], mode: 'full' },
      mode: 'full',
      fromDraft: false,
      restoredFromGithub: fullName,
      restoredAt: nowIso(),
      restoredSha: headSha,
      nextStep: 'Prepare preview (optional)',
    },
  });
  if (existsSync(p.contentDraft)) {
    try {
      rmSync(p.contentDraft);
    } catch {
      /* ignore */
    }
  }

  const { copied: imagesCopied, files: imageFiles } = copyImagesToSiteImages(siteRoot, p.siteImages);
  const manifest = buildImagesManifest(id, imageFiles, files);
  writeJson(p.imagesManifest, manifest);

  // Structure after site-config; photo counts from restored slots
  const selection = structureSelectionFromRestored({
    files,
    config,
    imageSlots: manifest.slots || {},
  });
  const structureResult = saveContentStructure(id, selection);
  const outline = await composeAndConfirmRestoredOutline(id, selection, config, files);

  const warnings = [];
  const serviceNames = Array.isArray(config.services) ? config.services.filter(Boolean) : [];
  if (serviceNames.length && !selection.pages.includes('services')) {
    warnings.push(
      `Launched site lists ${serviceNames.length} service name(s) in site-config but has no src/content/services/*.md — Prepare will not require service pages until Structure adds services with content.`,
    );
  }

  const relAssembled = path.relative(ROOT, siteRoot).replace(/\\/g, '/');
  saveMeta(id, {
    lastSiteConfigAt: nowIso(),
    lastContentAt: nowIso(),
    lastContentStructureAt: nowIso(),
    lastContentOutlineAt: nowIso(),
    lastContentOutlineConfirmedAt: nowIso(),
    lastContentBriefAt: nowIso(),
    lastContentBriefConfirmedAt: nowIso(),
    lastImagesPullAt: nowIso(),
    imagesCount: imagesCopied,
    lastAssembleAt: nowIso(),
    assembledSitePath: relAssembled,
    assembledSiteSlug: slug,
    lastRevertLaunchedAt: nowIso(),
    lastRevertLaunchedSha: headSha,
    lastRevertLaunchedRepo: fullName,
  });

  return {
    ok: true,
    candidateId: id,
    githubRepo: fullName,
    sha: headSha,
    mode: clone.mode,
    siteRoot: relAssembled,
    contentFiles: Object.keys(files).length,
    imagesCopied,
    imageSlots: Object.keys(manifest.slots || {}).length,
    structure: structureResult.structure,
    outlineStatus: outline?.status || null,
    pageIds: outline?.pageIds || selection.pages,
    warnings,
    candidate: getCandidateDetail(id),
  };
}
