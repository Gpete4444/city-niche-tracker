/**
 * Launch-fidelity helpers: expected paths, missing FILE checks, assemble freshness, preview sitemap.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isMaterialsHeading } from '../../src/lib/is-materials-heading.mjs';
import { isProcessHeading } from '../../src/lib/is-process-heading.mjs';
import { getCandidateDetail, pathsFor } from './candidates.mjs';

/** Prose before photo-block process/materials sections. Accept rejects service pages under this. */
export const SERVICE_OWNED_MIN_WORDS = 450;

const STUB_WARNING_RE = /^Stub\/thin content \(not launch-ready\):\s*/;

function slugifyContentName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function configuredServiceNames(config = {}) {
  const seen = new Set();
  const out = [];
  for (const raw of [...(config.services || []), ...(config.commercialServices || [])]) {
    const name = String(raw || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function configuredSuburbNames(config = {}) {
  const out = [];
  const seen = new Set();
  const primary = String(config.primaryCity || '').trim();
  if (primary) {
    seen.add(primary.toLowerCase());
    out.push(primary);
  }
  for (const raw of config.targetSuburbs || []) {
    const name = String(raw || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Configured location pages whose accepted/draft file is missing or still a stub. */
export function locationPagesNeedingWrite(config = {}, files = {}) {
  const pages = [];
  for (const name of configuredSuburbNames(config)) {
    const slug = slugifyContentName(name);
    if (!slug) continue;
    const rel = `src/content/locations/${slug}.md`;
    const body = files?.[rel];
    if (!body || bodyLooksLikeStub(rel, body)) pages.push({ name, path: rel });
  }
  return pages;
}

function acceptedContentFiles(detail) {
  let files = detail?.content?.files;
  if (!files || typeof files !== 'object') {
    const id = String(detail?.id || '').trim();
    const raw = id ? readJson(pathsFor(id).content) : null;
    files = raw?.files && typeof raw.files === 'object' ? raw.files : {};
  }
  return files;
}

function titleFromLocationSlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Names for the Site-Config header. Reads accepted content when the detail slice omitted it. */
export function pendingLocationPageNames(detail) {
  const config = detail?.siteConfig || detail?.siteConfigDraft || {};
  return locationPagesNeedingWrite(config, acceptedContentFiles(detail)).map((page) => page.name);
}

/** Accepted location pages that are not the primary city or a target suburb. */
export function extraLocationPageNames(detail) {
  const config = detail?.siteConfig || detail?.siteConfigDraft || {};
  const allowed = new Set(
    configuredSuburbNames(config)
      .map((name) => slugifyContentName(name))
      .filter(Boolean),
  );
  const names = [];
  for (const rel of Object.keys(acceptedContentFiles(detail))) {
    const match = String(rel)
      .replace(/\\/g, '/')
      .match(/^src\/content\/locations\/([^/]+)\.md$/i);
    if (!match) continue;
    const slug = match[1].toLowerCase();
    if (allowed.has(slug)) continue;
    names.push(titleFromLocationSlug(slug));
  }
  return names;
}

function loadOutlinePackage(candidateId) {
  return readJson(pathsFor(candidateId).contentOutlinePackage);
}

function loadStructureDoc(candidateId) {
  return readJson(pathsFor(candidateId).contentStructure);
}

/**
 * Page ids from confirmed outline, else structure checklist, else defaults.
 */
export function resolveStructurePageIds(candidateId, detail = null) {
  const outline = loadOutlinePackage(candidateId);
  if (
    outline?.status === 'confirmed' &&
    Array.isArray(outline?.pageIds) &&
    outline.pageIds.length
  ) {
    return outline.pageIds.map(String);
  }
  const structure = loadStructureDoc(candidateId);
  if (Array.isArray(structure?.pages) && structure.pages.length) return structure.pages.map(String);
  if (
    detail?.contentOutlinePackage?.status === 'confirmed' &&
    Array.isArray(detail?.contentOutlinePackage?.pageIds) &&
    detail.contentOutlinePackage.pageIds.length
  ) {
    return detail.contentOutlinePackage.pageIds.map(String);
  }
  if (Array.isArray(detail?.contentStructure?.pages) && detail.contentStructure.pages.length) {
    return detail.contentStructure.pages.map(String);
  }
  return ['home', 'about', 'contact'];
}

export function outlineRequiresFullContent(candidateId) {
  const outline = loadOutlinePackage(candidateId);
  if (outline?.status !== 'confirmed') return false;
  const pages = new Set(outline.pageIds || []);
  return pages.has('services') || pages.has('locations');
}

/**
 * Expected markdown paths for launch based on Structure page selection + site-config.
 */
export function expectedLaunchContentPaths(config = {}, pageIds = []) {
  const pages = new Set(pageIds.length ? pageIds : ['home', 'about', 'contact']);
  const paths = [];
  if (pages.has('home')) paths.push('src/content/pages/index.md');
  if (pages.has('about')) paths.push('src/content/pages/about.md');
  if (pages.has('contact')) paths.push('src/content/pages/contact.md');
  if (pages.has('services')) {
    for (const name of configuredServiceNames(config)) {
      const slug = slugifyContentName(name);
      if (slug) paths.push(`src/content/services/${slug}.md`);
    }
  }
  if (pages.has('locations')) {
    for (const name of configuredSuburbNames(config)) {
      const slug = slugifyContentName(name);
      if (slug) paths.push(`src/content/locations/${slug}.md`);
    }
  }
  return paths;
}

export function missingLaunchContentPaths(files = {}, config = {}, pageIds = []) {
  const expected = expectedLaunchContentPaths(config, pageIds);
  return expected.filter((rel) => !files[rel]);
}

/** True when a service/location body is seed stub or too thin for Accept. */
export function bodyLooksLikeStub(rel, markdown) {
  const raw = String(markdown || '');
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  const body = (m ? m[1] : raw).trim();
  if (body.length < 320) return true;
  if (
    rel.includes('/services/') &&
    /is part of our .+ offering in .+\. Call or use the estimate form/i.test(body)
  ) {
    return true;
  }
  if (rel.includes('/locations/')) {
    // Suburb seed stub fingerprint
    if (
      /is part of our .+ service area for .+\. We help homeowners and property managers with clear estimates/i.test(
        body,
      )
    ) {
      return true;
    }
    // Primary-city differentiated seed stub fingerprint
    if (
      /neighborhoods are part of how .+ plans .+\. From older streets to newer subdivisions/i.test(body)
    ) {
      return true;
    }
    // Generic geo boilerplate that swaps only the city name
    if (
      /we also serve nearby .+\./i.test(body) &&
      /housing stock tends to include|residential neighborhoods include a (mix|range)|established neighborhoods often include/i.test(
        body,
      ) &&
      body.length < 900
    ) {
      return true;
    }
  }
  return false;
}

function markdownBody(markdown) {
  const raw = String(markdown || '');
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return (m ? m[1] : raw).replace(/\r\n/g, '\n').trim();
}

function countWords(text) {
  return String(text || '')
    .replace(/[#>*_`[\]()|-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Body with photo-block process and materials sections removed. */
export function serviceOwnedProse(markdown) {
  const lines = markdownBody(markdown).split('\n');
  const kept = [];
  let skip = false;
  for (const line of lines) {
    const heading = line.match(/^#{1,2}\s+(.+)$/);
    if (heading) {
      const title = heading[1];
      skip = isProcessHeading(title) || isMaterialsHeading(title);
    }
    if (!skip) kept.push(line);
  }
  return kept.join('\n').trim();
}

export function serviceOwnedWordCount(markdown) {
  return countWords(serviceOwnedProse(markdown));
}

/** Opening paragraph stops mid-sentence (the Nampa “or an” case). */
export function serviceOpeningCutOff(markdown) {
  const paras = serviceOwnedProse(markdown)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('#') && !/^[-*•]/.test(p) && !/^More:/i.test(p) && !/^<!--/.test(p));
  const lead = paras[0] || '';
  const words = countWords(lead);
  if (!words || words > 80) return false;
  return !/[.!?…]["']?\s*$/.test(lead);
}

/**
 * Service page still needs a rewrite: seed stub, short prose outside the
 * photo-block lists, or a cut-off opening sentence.
 * @returns {{ stub: boolean, words: number, cutOff: boolean, short: boolean } | null}
 */
export function serviceThinReason(rel, markdown) {
  if (!String(rel || '').includes('/services/')) return null;
  const stub = bodyLooksLikeStub(rel, markdown);
  const words = serviceOwnedWordCount(markdown);
  const cutOff = serviceOpeningCutOff(markdown);
  const short = words < SERVICE_OWNED_MIN_WORDS;
  if (!stub && !short && !cutOff) return null;
  return { stub, words, cutOff, short };
}

export function servicePageNeedsExpand(rel, markdown) {
  return Boolean(serviceThinReason(rel, markdown));
}

/**
 * Missing required paths + present stub/thin service/location files.
 * `serviceDepth: 'expand'` (Accept) also flags a service under 450 owned words.
 * `serviceDepth: 'stub'` (Prepare preview and staging) only flags a seed stub.
 * @returns {{ expected: string[], missing: string[], stubs: string[], ok: boolean }}
 */
export function listLaunchContentGaps(files = {}, config = {}, pageIds = [], { serviceDepth = 'expand' } = {}) {
  const expected = expectedLaunchContentPaths(config, pageIds);
  const missing = expected.filter((rel) => !files[rel]);
  const stubs = [];
  const serviceBlocks =
    serviceDepth === 'stub' ? bodyLooksLikeStub : servicePageNeedsExpand;
  for (const rel of expected) {
    if (!files[rel]) continue;
    if (rel.includes('/services/')) {
      if (serviceBlocks(rel, files[rel])) stubs.push(rel);
      continue;
    }
    if (rel.includes('/locations/') && bodyLooksLikeStub(rel, files[rel])) stubs.push(rel);
  }
  return {
    expected,
    missing,
    stubs,
    ok: !missing.length && !stubs.length,
  };
}

/**
 * Rewrite stored launch stubs and stub warnings so they match the files.
 * Photo-block splice used to leave the pre-splice stub list in place.
 * @returns {{ ops: object, changed: boolean }}
 */
export function syncLaunchGapsOnOps(ops, files, config, pageIds) {
  if (!ops || typeof ops !== 'object' || !ops.check || typeof ops.check !== 'object') {
    return { ops, changed: false };
  }
  const gaps = listLaunchContentGaps(files || {}, config || {}, pageIds || []);
  const stubWarnings = gaps.stubs.map((rel) => `Stub/thin content (not launch-ready): ${rel}`);
  const warnings = [
    ...(ops.check.warnings || []).filter((w) => !STUB_WARNING_RE.test(String(w))),
    ...stubWarnings,
  ];
  const launch = {
    ...(ops.check.launch || {}),
    expected: gaps.expected,
    missing: [...new Set(gaps.missing)],
    stubs: [...new Set(gaps.stubs)],
    have: Object.keys(files || {}).length,
    expectedCount: gaps.expected.length,
  };
  const next = {
    ...ops,
    check: {
      ...ops.check,
      warnings,
      launch,
    },
  };
  let changed =
    JSON.stringify(ops.check.warnings || []) !== JSON.stringify(warnings) ||
    JSON.stringify(ops.check.launch?.stubs || []) !== JSON.stringify(launch.stubs) ||
    JSON.stringify(ops.check.launch?.missing || []) !== JSON.stringify(launch.missing);
  if (next.contract && Array.isArray(next.contract.warnings)) {
    const contractWarnings = next.contract.warnings.filter((w) => !STUB_WARNING_RE.test(String(w)));
    if (contractWarnings.length !== next.contract.warnings.length) {
      next.contract = { ...next.contract, warnings: contractWarnings };
      changed = true;
    }
  }
  return { ops: changed ? next : ops, changed };
}

/**
 * Accept when the draft, or the accepted copy when the draft is empty, already
 * has a non-stub page for every gap. Otherwise write.
 */
export function launchGapNextStep(gapPaths = [], draftFiles = {}, acceptedFiles = {}) {
  const paths = (gapPaths || []).map(String).filter((rel) => rel.startsWith('src/'));
  if (!paths.length) return 'write';
  const ready = paths.every((rel) => {
    const body = draftFiles?.[rel] || acceptedFiles?.[rel];
    return body && !bodyLooksLikeStub(rel, body);
  });
  return ready ? 'accept' : 'write';
}

/**
 * Launch-readiness gaps for a candidate's accepted/draft content (Prepare preflight).
 * @param {string} candidateId
 */
export function getLaunchContentGapsForCandidate(candidateId) {
  const id = String(candidateId || '').trim();
  const detail = getCandidateDetail(id);
  const p = pathsFor(id);
  const diskConfig = readJson(p.siteConfig) || readJson(p.siteConfigDraft);
  const config = diskConfig || detail?.siteConfig || detail?.siteConfigDraft || null;
  const content = detail?.content || detail?.contentDraft;
  const files = content?.files && typeof content.files === 'object' ? content.files : {};
  const pageIds = resolveStructurePageIds(id, detail);
  const draftFiles =
    detail?.contentDraft?.files && typeof detail.contentDraft.files === 'object'
      ? detail.contentDraft.files
      : {};
  const acceptedFiles =
    detail?.content?.files && typeof detail.content.files === 'object' ? detail.content.files : {};
  if (!config) {
    return {
      ok: false,
      candidateId: id,
      expected: [],
      missing: ['(accept site-config first)'],
      stubs: [],
      nextStep: 'write',
      error: `${id}: Accept site-config before Prepare preview`,
    };
  }
  if (!Object.keys(files).length) {
    return {
      ok: false,
      candidateId: id,
      expected: expectedLaunchContentPaths(config, pageIds),
      missing: ['(no content files)'],
      stubs: [],
      nextStep: 'write',
      error: `${id}: No content draft/accepted files to Prepare`,
    };
  }
  const gaps = listLaunchContentGaps(files, config, pageIds, { serviceDepth: 'stub' });
  const parts = [];
  if (gaps.missing.length) {
    parts.push(
      `missing ${gaps.missing.length}: ${gaps.missing.slice(0, 4).join('; ')}${
        gaps.missing.length > 4 ? '…' : ''
      }`,
    );
  }
  if (gaps.stubs.length) {
    parts.push(
      `stub/thin ${gaps.stubs.length}: ${gaps.stubs.slice(0, 4).join('; ')}${
        gaps.stubs.length > 4 ? '…' : ''
      }`,
    );
  }
  const gapPaths = [...gaps.missing, ...gaps.stubs];
  return {
    ...gaps,
    candidateId: id,
    nextStep: gaps.ok ? null : launchGapNextStep(gapPaths, draftFiles, acceptedFiles),
    error: gaps.ok
      ? null
      : `${id}: Content not launch-ready — ${parts.join(' · ')}. Continue-write / Accept full location & service pages before Prepare (or Prepare anyway).`,
  };
}

/**
 * Throw 400 with check payload when Structure-selected pages lack FILEs (or only stubs).
 */
export function assertLaunchContentComplete(
  files,
  config,
  pageIds,
  { label = 'Content', candidateId = '', serviceDepth = 'expand' } = {},
) {
  const { missing, stubs, expected, ok } = listLaunchContentGaps(files, config, pageIds, {
    serviceDepth,
  });
  if (ok) {
    return { ok: true, missing: [], stubs: [], expected };
  }
  const parts = [];
  if (missing.length) {
    parts.push(
      `missing ${missing.length}: ${missing.slice(0, 4).join('; ')}${missing.length > 4 ? '…' : ''}`,
    );
  }
  if (stubs.length) {
    parts.push(
      `stub/thin ${stubs.length}: ${stubs.slice(0, 4).join('; ')}${stubs.length > 4 ? '…' : ''}`,
    );
  }
  const who = String(candidateId || '').trim();
  const prefix = who ? `${who}: ` : '';
  const err = new Error(
    `${prefix}${label} incomplete for launch preview — ${parts.join(' · ')}. Paste full-write ### FILE blocks for every service/location, then Accept.`,
  );
  err.status = 400;
  err.check = {
    ok: false,
    errors: [
      ...missing.map((p) => `Missing required file: ${p}`),
      ...stubs.map((p) => `Stub/thin content (not launch-ready): ${p}`),
    ],
    warnings: [],
    missing,
    stubs,
    expected,
    mode: 'full',
  };
  throw err;
}

export function isAssembleStale(meta = {}) {
  const staged = meta.lastSiteStagingAt;
  if (!staged) return false;
  const assembled = meta.lastAssembleAt;
  if (!assembled) return true;
  const s = Date.parse(staged);
  const a = Date.parse(assembled);
  if (!Number.isFinite(s)) return false;
  if (!Number.isFinite(a)) return true;
  return s > a;
}

/**
 * Absolute preview URLs for every page that will ship.
 */
export function buildPreviewSitemap(config = {}, pageIds = [], baseUrl = 'http://127.0.0.1:4322') {
  const base = String(baseUrl || 'http://127.0.0.1:4322').replace(/\/$/, '');
  const pages = new Set(pageIds.length ? pageIds : ['home', 'about', 'contact']);
  const entries = [];

  const push = (label, path) => {
    const p = path.startsWith('/') ? path : `/${path}`;
    entries.push({ label, path: p, url: `${base}${p === '/' ? '/' : p}` });
  };

  if (pages.has('home')) push('Home', '/');
  if (pages.has('about')) push('About', '/about');
  if (pages.has('contact')) push('Contact', '/contact');
  if (pages.has('services')) {
    for (const name of configuredServiceNames(config)) {
      const slug = slugifyContentName(name);
      if (slug) push(name, `/services/${slug}`);
    }
  }
  if (pages.has('locations')) {
    for (const name of configuredSuburbNames(config)) {
      const slug = slugifyContentName(name);
      if (slug) push(`${name} (location)`, `/locations/${slug}`);
    }
  }
  return entries;
}

export function launchFidelitySummary(candidateId, detail, config) {
  const pageIds = resolveStructurePageIds(candidateId, detail);
  const files = detail?.content?.files || detail?.contentDraft?.files || {};
  const expected = expectedLaunchContentPaths(config, pageIds);
  const missing = missingLaunchContentPaths(files, config, pageIds);
  const stale = isAssembleStale(detail?.meta || {});
  const sitemap = buildPreviewSitemap(config, pageIds);
  const outline = loadOutlinePackage(candidateId);
  return {
    pageIds,
    expectedCount: expected.length,
    missing,
    missingCount: missing.length,
    assembleStale: stale,
    sitemap,
    requiresFull: pageIds.includes('services') || pageIds.includes('locations'),
    outlineConfirmed: outline?.status === 'confirmed',
  };
}
