/**
 * Launch-fidelity helpers: expected paths, missing FILE checks, assemble freshness, preview sitemap.
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathsFor } from './candidates.mjs';

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
  if (Array.isArray(outline?.pageIds) && outline.pageIds.length) return outline.pageIds.map(String);
  const structure = loadStructureDoc(candidateId);
  if (Array.isArray(structure?.pages) && structure.pages.length) return structure.pages.map(String);
  if (Array.isArray(detail?.contentOutlinePackage?.pageIds) && detail.contentOutlinePackage.pageIds.length) {
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

/**
 * Missing required paths + present stub/thin service/location files (Accept gate).
 * @returns {{ expected: string[], missing: string[], stubs: string[], ok: boolean }}
 */
export function listLaunchContentGaps(files = {}, config = {}, pageIds = []) {
  const expected = expectedLaunchContentPaths(config, pageIds);
  const missing = expected.filter((rel) => !files[rel]);
  const stubs = [];
  for (const rel of expected) {
    if (!files[rel]) continue;
    if (!rel.includes('/services/') && !rel.includes('/locations/')) continue;
    if (bodyLooksLikeStub(rel, files[rel])) stubs.push(rel);
  }
  return {
    expected,
    missing,
    stubs,
    ok: !missing.length && !stubs.length,
  };
}

/**
 * Throw 400 with check payload when Structure-selected pages lack FILEs (or only stubs).
 */
export function assertLaunchContentComplete(files, config, pageIds, { label = 'Content' } = {}) {
  const { missing, stubs, expected, ok } = listLaunchContentGaps(files, config, pageIds);
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
  const err = new Error(
    `${label} incomplete for launch preview — ${parts.join(' · ')}. Paste full-write ### FILE blocks for every service/location, then Accept.`,
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
