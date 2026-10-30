/**
 * Outline-first content structure: section checklist → outline → Claude prompts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCandidateDetail,
  getCandidateShell,
  pathsFor,
  RESEARCH_DIR,
  saveMeta,
} from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { persistCoercedAcceptedSiteConfig } from './site-config.mjs';
import { shotgunDoNotLinkBlock } from './shotgun.mjs';
import { formatZoneSiblingDigestForCandidate } from './zone-site-diff.mjs';
import { parseJsonLoose } from './claude.mjs';
import {
  buildCityContextPackage,
  cityContextPromptRules,
  compactCityContextForPrompt,
  getCachedCityContext,
} from './city-context.mjs';
import { listLaunchContentGaps, resolveStructurePageIds } from './preview-fidelity.mjs';
import {
  assignServiceBands,
  formatServiceBandRulesMarkdown,
} from './service-band-assign.mjs';
import { formatNichePhotoBlockPrompt, getNichePhotoBlocks } from './niche-photo-blocks.mjs';
import { buildLocationAngles, formatLocationAnglesMarkdown } from './location-angles.mjs';
import {
  assignBookendPolicy,
  assignLocationSectionPolicy,
  formatBookendPolicyMarkdown,
  formatLocationSectionPolicyMarkdown,
} from './bookend-policy.mjs';

// Mirror content-markdown slugifyContentName (avoid circular import)
function slugifyContentName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REGISTRY_PATH = path.join(ROOT, 'prompts', 'sections', 'registry.json');

function ensureResearchDir() {
  mkdirSync(RESEARCH_DIR, { recursive: true });
}

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureResearchDir();
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

function fillTemplate(str, vars = {}) {
  return String(str || '').replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : `{${key}}`,
  );
}

export function loadSectionRegistry() {
  const raw = readJson(REGISTRY_PATH);
  if (!raw?.sections?.length) {
    throw Object.assign(new Error('Section registry missing at prompts/sections/registry.json'), {
      status: 500,
    });
  }
  return raw;
}

function structurePath(candidateId) {
  return path.join(RESEARCH_DIR, `${pathsFor(candidateId).id}-content-structure.json`);
}

function outlinePath(candidateId) {
  return path.join(RESEARCH_DIR, `${pathsFor(candidateId).id}-content-outline-package.json`);
}

function siteVars(config = {}) {
  const businessName = config.businessName || 'Business';
  const niche = config.niche || 'service';
  return {
    businessName,
    niche,
    city: config.primaryCity || 'City',
    state: config.state || 'ST',
    // Left as placeholders for Claude to fill per FILE
    serviceName: '{serviceName}',
    suburb: '{suburb}',
    brandEqualsNiche: namesRoughlyEqual(businessName, niche),
  };
}

function namesRoughlyEqual(a, b) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/\b(pros|llc|inc|co|company|services|service)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return Boolean(norm(a) && norm(a) === norm(b));
}

/** svcIntro (and any section with level none/body) is unmarked prose, not an H2. */
function isUnmarkedBodyIntro(s) {
  if (!s) return false;
  if (s.id === 'svcIntro') return true;
  const level = String(s.level || '').toLowerCase();
  return level === 'none' || level === 'body' || level === 'unmarked';
}

function headingForSection(def, vars) {
  let tpl = def.defaultHeading || def.label || def.id;
  // Avoid "Niche: Niche in City" when businessName matches niche
  if (def.id === 'hero' && vars.brandEqualsNiche) {
    tpl = '{niche} in {city}, {state}';
  } else if (
    vars.brandEqualsNiche &&
    /\{businessName\}:\s*\{niche\}/i.test(String(tpl))
  ) {
    tpl = String(tpl).replace(/\{businessName\}:\s*\{niche\}/i, '{niche}');
  }
  return fillTemplate(tpl, vars);
}

function configuredServiceNames(config = {}) {
  const names = [];
  for (const list of [config.services, config.commercialServices]) {
    if (!Array.isArray(list)) continue;
    for (const name of list) {
      const n = String(name || '').trim();
      if (n && !names.includes(n)) names.push(n);
    }
  }
  return names;
}

function readFieldResearchRecord(candidateId) {
  return readJson(pathsFor(candidateId).contentFieldResearch);
}

/**
 * Deterministic service-band rotation + per-suburb local angles on the outline.
 */
export function attachRankingOutlineExtras(outline, config = {}, extras = {}) {
  if (!outline || typeof outline !== 'object') return outline;
  const enabledSectionIds = Array.isArray(outline.sectionIds)
    ? outline.sectionIds
    : (outline.sections || []).map((s) => (typeof s === 'string' ? s : s?.id)).filter(Boolean);
  const services = configuredServiceNames(config);
  const suburbs = configuredSuburbNames(config);
  const fieldResearch = extras.fieldResearch || null;
  const cityContext = extras.cityContext || null;
  outline.serviceBandAssignments = assignServiceBands({
    services,
    enabledSectionIds,
    keywordTargets: outline.keywordTargets || [],
    faqSeeds: outline.faqSeeds || [],
    volumeHints: outline.keywords?.volumeHints || [],
  });
  outline.locationAngles = buildLocationAngles({
    suburbs,
    cityContext,
    fieldResearch,
  });
  const fileRules = buildRequiredFileRules(outline, config);
  outline.bookendPolicy = assignBookendPolicy({
    candidateId: extras.candidateId || outline.candidateId || '',
    filePaths: fileRules.paths,
    enabledSectionIds,
  });
  outline.locationSectionPolicy = assignLocationSectionPolicy({
    suburbs,
    enabledSectionIds,
  });
  return outline;
}

/** Rebuild service-band assignments from the current service list and save the outline. */
export function refreshServiceBandAssignments(candidateId) {
  const outline = getContentOutlinePackage(candidateId);
  if (!outline || typeof outline !== 'object') return null;
  const config = loadAcceptedSiteConfig(candidateId)?.config || {};
  attachRankingOutlineExtras(outline, config, {
    candidateId,
    cityContext: getCachedCityContext(candidateId),
    fieldResearch: readFieldResearchRecord(candidateId),
  });
  writeJson(outlinePath(candidateId), outline);
  return outline.serviceBandAssignments || null;
}

function configuredSuburbNames(config = {}) {
  const names = [];
  const primary = String(config.primaryCity || '').trim();
  if (primary) names.push(primary);
  for (const name of config.targetSuburbs || []) {
    const n = String(name || '').trim();
    if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
  }
  return names;
}

function buildRequiredFileRules(outline, config = {}) {
  const pageIds = new Set(outline.pageIds || (outline.pages || []).map((p) => p.id));
  const lines = [];
  const pageMeta = new Map((outline.pages || []).map((p) => [p.id, p]));
  const paths = [];

  for (const id of ['home', 'about', 'contact']) {
    if (!pageIds.has(id)) continue;
    const p = pageMeta.get(id);
    const route =
      p?.route || `src/content/pages/${id === 'home' ? 'index' : id}.md`;
    paths.push(route);
    lines.push(`- ${p?.label || id}: \`### FILE: ${route}\``);
  }

  if (pageIds.has('services')) {
    const services = configuredServiceNames(config);
    lines.push(
      '- Service pages: use the shared **svc*** outline template for EACH of these files (replace {serviceName} in headings):',
    );
    if (services.length) {
      for (const name of services) {
        const slug = slugifyContentName(name);
        if (!slug) continue;
        const route = `src/content/services/${slug}.md`;
        paths.push(route);
        lines.push(`  - ${name}: \`### FILE: ${route}\``);
      }
    } else {
      lines.push(
        '  - (No services listed in site-config — add services or skip service FILEs)',
      );
    }
  }

  if (pageIds.has('locations')) {
    const suburbs = configuredSuburbNames(config);
    lines.push(
      '- Location pages: use the shared **loc*** outline template for EACH of these files (replace {suburb}):',
    );
    if (suburbs.length) {
      for (const name of suburbs) {
        const slug = slugifyContentName(name);
        if (!slug) continue;
        const route = `src/content/locations/${slug}.md`;
        paths.push(route);
        lines.push(`  - ${name}: \`### FILE: ${route}\``);
      }
    } else {
      lines.push(
        '  - (No targetSuburbs in site-config — add suburbs or skip location FILEs)',
      );
    }
  }

  return { markdown: lines.join('\n'), paths, count: paths.length };
}

function normalizeSelection(input = {}, registry = loadSectionRegistry()) {
  const pageIds = new Set((registry.pages || []).map((p) => p.id));
  const sectionById = new Map((registry.sections || []).map((s) => [s.id, s]));

  let pages = Array.isArray(input.pages)
    ? input.pages.map(String).filter((id) => pageIds.has(id))
    : registry.pages.filter((p) => p.defaultOn).map((p) => p.id);

  for (const p of registry.pages) {
    if (p.required && !pages.includes(p.id)) pages.push(p.id);
  }

  let sections = Array.isArray(input.sections)
    ? input.sections.map(String).filter((id) => sectionById.has(id))
    : registry.sections.filter((s) => s.defaultOn).map((s) => s.id);

  const rank = homepageSectionRank(registry);
  for (const s of registry.sections) {
    if (!s.required || sections.includes(s.id)) continue;
    const target = rank.has(s.id) ? rank.get(s.id) : Number.POSITIVE_INFINITY;
    let insertAt = sections.length;
    for (let i = 0; i < sections.length; i += 1) {
      const r = rank.has(sections[i]) ? rank.get(sections[i]) : Number.POSITIVE_INFINITY;
      if (r > target) {
        insertAt = i;
        break;
      }
    }
    sections.splice(insertAt, 0, s.id);
  }

  // Drop sections whose pages aren't selected
  sections = sections.filter((id) => {
    const def = sectionById.get(id);
    return (def?.pages || []).some((pid) => pages.includes(pid));
  });

  // Mutual exclusion: Services pages (multi-service) use `process`; single-offer uses `offerProcess`
  const hasServicesPage = pages.includes('services');
  if (hasServicesPage) {
    sections = sections.filter((id) => id !== 'offerProcess');
  } else if (sections.includes('process') && sections.includes('offerProcess')) {
    sections = sections.filter((id) => id !== 'process');
  }

  const photos = {};
  const photoIn = input.photos && typeof input.photos === 'object' ? input.photos : {};
  for (const id of sections) {
    const def = sectionById.get(id);
    if (!def?.photoCapable) continue;
    const raw = photoIn[id];
    if (raw === true) {
      photos[id] = { enabled: true, count: def.maxImages || 1 };
    } else if (raw && typeof raw === 'object' && raw.enabled) {
      const max = def.maxImages || 1;
      const count = Math.min(max, Math.max(1, Number(raw.count) || max));
      photos[id] = { enabled: true, count };
    }
  }

  return {
    pages,
    sections: pinHomeSectionEnds(sections),
    photos,
    presetId: input.presetId || null,
  };
}

export function applyPreset(presetId) {
  const registry = loadSectionRegistry();
  const preset = (registry.presets || []).find((p) => p.id === presetId);
  if (!preset) {
    throw Object.assign(new Error(`Unknown preset: ${presetId}`), { status: 400 });
  }
  const sectionById = new Map((registry.sections || []).map((s) => [s.id, s]));
  const photos = {};
  for (const [sid, on] of Object.entries(preset.photos || {})) {
    if (!on) continue;
    const def = sectionById.get(sid);
    photos[sid] = { enabled: true, count: def?.maxImages || 1 };
  }
  return normalizeSelection(
    {
      pages: preset.pages,
      sections: preset.sections,
      photos,
      presetId: preset.id,
    },
    registry,
  );
}

export function getDefaultStructureSelection() {
  return applyPreset('C');
}

export function getContentStructure(candidateId) {
  persistCoercedAcceptedSiteConfig(candidateId);
  return readJson(structurePath(candidateId));
}

export function getContentOutlinePackage(candidateId) {
  return readJson(outlinePath(candidateId));
}

/**
 * Save operator checklist selection (draft structure).
 */
export function saveContentStructure(candidateId, selection = {}) {
  persistCoercedAcceptedSiteConfig(candidateId);
  const detail = getCandidateDetail(candidateId);
  if (!detail.siteConfig && !loadAcceptedSiteConfig(candidateId)?.config) {
    throw Object.assign(new Error('Accept site-config first'), { status: 400 });
  }
  const registry = loadSectionRegistry();
  const normalized = normalizeSelection(selection, registry);
  const doc = {
    version: 1,
    candidateId: pathsFor(candidateId).id,
    status: 'draft',
    ...normalized,
    updatedAt: nowIso(),
    createdAt: getContentStructure(candidateId)?.createdAt || nowIso(),
  };
  writeJson(structurePath(candidateId), doc);
  saveMeta(candidateId, { lastContentStructureAt: doc.updatedAt });
  return { structure: doc, candidate: getCandidateShell(candidateId) };
}

function composeSections(selection, registry, vars) {
  const sectionById = new Map(registry.sections.map((s) => [s.id, s]));
  const out = [];
  for (const id of selection.sections) {
    const def = sectionById.get(id);
    if (!def) continue;
    const photo = selection.photos?.[id];
    // Paths come from Pull / ChatGPT BA / operator upload — never invent placeholder files
    const images = [];
    if (photo?.enabled) {
      const n = photo.count || 1;
      for (let i = 1; i <= n; i += 1) {
        images.push({
          path: null,
          alt: '',
          caption: '',
          slot: `${def.id}-${i}`,
        });
      }
    }
    out.push({
      id: def.id,
      level: def.level,
      heading: headingForSection(def, vars),
      kind: def.kind,
      pages: def.pages,
      astroKey: def.astroKey,
      instructions: def.writeInstructions,
      photoCapable: Boolean(def.photoCapable),
      photoCount: photo?.enabled ? photo.count || 1 : 0,
      images,
    });
  }
  return out;
}

function outlineToBriefSections(outlineSections) {
  return outlineSections.map((s) => ({
    id: s.id,
    level: isUnmarkedBodyIntro(s) ? 'none' : s.level || 'H2',
    heading: s.heading,
    instructions: s.instructions,
    kind: s.kind,
    ...(s.photoCapable ? { photoCapable: true, photoCount: s.photoCount || s.images?.length || 0 } : {}),
  }));
}

/** Human-readable outline for download / Claude context (JSON remains source of truth). */
export function outlineToMarkdown(outline) {
  if (!outline || typeof outline !== 'object') return '';
  const lines = [
    `# Content outline — ${outline.candidateId || 'site'}`,
    '',
    `Status: ${outline.status || 'draft'}`,
    `Preset: ${outline.presetId || 'custom'}`,
    '',
    '## Pages',
  ];
  for (const p of outline.pages || []) {
    lines.push(`- **${p.label || p.id}** (\`${p.route || p.id}\`)`);
  }
  lines.push('', '## Sections');
  for (const s of outline.sections || []) {
    if (isUnmarkedBodyIntro(s)) {
      lines.push('', `### unmarked intro (no heading): ${s.heading || s.id}`);
    } else {
      lines.push('', `### ${s.level || 'H2'}: ${s.heading || s.id}`);
    }
    lines.push(`- id: \`${s.id}\``);
    if (s.astroKey) lines.push(`- astroKey: \`${s.astroKey}\``);
    if (s.instructions) lines.push(`- instructions: ${s.instructions}`);
    if (s.photoCapable || s.images?.length) {
      const n = s.photoCount || s.images?.length || 0;
      if (n) {
        lines.push(`- photos: ${n} slot(s) — filled by Rover Pull / BA import / Upload (do not invent paths)`);
      }
    }
  }
  if (outline.seoNotes?.length) {
    lines.push('', '## SEO notes');
    for (const note of outline.seoNotes) lines.push(`- ${note}`);
  }
  if (outline.homepageSections?.length) {
    lines.push('', '## Homepage Astro keys');
    lines.push(outline.homepageSections.map((k) => `\`${k}\``).join(', '));
  }
  lines.push('');
  return lines.join('\n');
}

/** Stamp homepageSections (+ soft archetype) from outline onto research site-config. */
export function applyOutlineToSiteConfig(candidateId, outline = getContentOutlinePackage(candidateId)) {
  if (!outline?.homepageSections?.length) return null;
  const scPath = pathsFor(candidateId).siteConfig;
  const sc = readJson(scPath);
  if (!sc || typeof sc !== 'object') return null;
  const siteArchetype =
    outline.siteArchetype ||
    (outline.sectionIds?.includes('services') && !outline.sectionIds?.includes('offerProcess')
      ? 'multi_service'
      : outline.sectionIds?.includes('offerProcess')
        ? 'single_service'
        : sc.siteArchetype || 'multi_service');
  const next = {
    ...sc,
    homepageSections: outline.homepageSections,
    siteArchetype,
  };
  writeJson(scPath, next);
  return next;
}

function homepageSectionRank(registry) {
  const order = registry.homepageSectionOrder || [];
  return new Map(order.map((id, i) => [id, i]));
}

/** Keep Hero first and Closing CTA last when present (VE reorder pins). */
export function pinHomeSectionEnds(sectionIds) {
  const list = (sectionIds || []).map(String).filter(Boolean);
  const mid = list.filter((id) => id !== 'hero' && id !== 'cta');
  const out = [];
  if (list.includes('hero')) out.push('hero');
  out.push(...mid);
  if (list.includes('cta')) out.push('cta');
  return out;
}

function sortSectionsForCatalog(sections, registry) {
  const rank = homepageSectionRank(registry);
  const pageRank = new Map((registry.pages || []).map((p, i) => [p.id, i]));
  return [...(sections || [])].sort((a, b) => {
    const pa = pageRank.get((a.pages || [])[0]) ?? 50;
    const pb = pageRank.get((b.pages || [])[0]) ?? 50;
    if (pa !== pb) return pa - pb;
    const ra = rank.has(a.id) ? rank.get(a.id) : 500 + String(a.id).localeCompare(String(b.id));
    const rb = rank.has(b.id) ? rank.get(b.id) : 500;
    if (ra !== rb) return ra - rb;
    return String(a.id).localeCompare(String(b.id));
  });
}

/** Astro homepage keys in selection order (no registry re-rank — VE reorder must stick). */
function homepageAstroKeys(selection, registry) {
  const sectionById = new Map(registry.sections.map((s) => [s.id, s]));
  const keys = [];
  for (const id of pinHomeSectionEnds(selection.sections || [])) {
    const def = sectionById.get(id);
    if (!def?.astroKey) continue;
    if (!(def.pages || []).includes('home')) continue;
    if (!keys.includes(def.astroKey)) keys.push(def.astroKey);
  }
  return keys;
}

/**
 * Continue: compose outline package from structure selection.
 */
export function composeContentOutline(candidateId, selectionPatch = null) {
  persistCoercedAcceptedSiteConfig(candidateId);
  const registry = loadSectionRegistry();
  const config = loadAcceptedSiteConfig(candidateId)?.config;
  if (!config) {
    throw Object.assign(new Error('Accept site-config first'), { status: 400 });
  }
  const prior = getContentStructure(candidateId) || {};
  const inputSelection = selectionPatch
    ? { ...prior, ...selectionPatch, photos: selectionPatch.photos || prior.photos }
    : prior;
  const inputPages = Array.isArray(inputSelection.pages) ? inputSelection.pages : [];
  const inputSections = Array.isArray(inputSelection.sections) ? inputSelection.sections : [];
  const droppedOfferForServices =
    inputPages.includes('services') && inputSections.includes('offerProcess');
  const selection = normalizeSelection(inputSelection, registry);
  const vars = siteVars(config);
  const sections = composeSections(selection, registry, vars);
  const pages = (registry.pages || []).filter((p) => selection.pages.includes(p.id));

  const outline = {
    version: 1,
    candidateId: pathsFor(candidateId).id,
    status: 'composed',
    composedAt: nowIso(),
    presetId: selection.presetId,
    pages: pages.map((p) => ({ id: p.id, label: p.label, route: p.route })),
    pageIds: selection.pages,
    sectionIds: selection.sections,
    photos: selection.photos,
    homepageSections: homepageAstroKeys(selection, registry),
    sections,
    seoNotes: [
      'Map primary + supporting keywords from research into H1/H2s (see keywordTargets).',
      'FAQ questions must follow faqSeeds (SERP PAA when available).',
      'Use organicTitleHints for H1/H2 phrasing cues — do not copy competitor brand names.',
      'Prefer helpful depth: methods, cost drivers, timelines, when to call, DIY vs pro.',
      'Internal links: Home ↔ Services ↔ Locations ↔ Contact.',
      'Use site-config socialProof for trust/reviews — do not invent testimonials. Rover seeds placeholders when empty; operator replaces before launch.',
      'Use City context briefs (Wikipedia + local seed) for climate/neighborhood flavor — paraphrase only; keep each location FILE distinct; name concrete materials/methods.',
      'Service educational bands rotate per FILE (cost/DIY/permits stay on the homepage plus a subset of services). Location pages use sourced locationAngles — no Facebook groups.',
      'Service card bodies must not repeat “in {city}, {ST}” — city once in the homepage intro.',
      'Brand/domain verb must match niche and homepage H1/title (Repair Pros ≠ Installation identity).',
    ],
    keywords: {
      primary: config.niche || null,
      supporting: [],
      city: `${config.primaryCity || ''}, ${config.state || ''}`.trim(),
      niche: config.niche || null,
      volumeHints: [],
      fromApproved: null,
    },
    keywordTargets: [],
    faqSeeds: [],
    organicTitleHints: [],
  };

  applyResearchSeoSeeds(outline, getCandidateDetail(candidateId), selection);
  attachRankingOutlineExtras(outline, config, {
    candidateId,
    cityContext: getCachedCityContext(candidateId),
  });

  // Warm city-context cache for Outline refine / Full write (non-blocking)
  void buildCityContextPackage(candidateId).catch(() => {});

  writeJson(outlinePath(candidateId), outline);
  writeJson(structurePath(candidateId), {
    ...selection,
    version: 1,
    candidateId: pathsFor(candidateId).id,
    status: 'composed',
    updatedAt: nowIso(),
    createdAt: prior.createdAt || nowIso(),
  });

  // Keep legacy brief in sync unless Soft eight-pass brief already confirmed
  const existingBrief = readJson(pathsFor(candidateId).contentBrief);
  if (!(existingBrief?.mode === 'eight_pass' && existingBrief?.status === 'confirmed')) {
    const brief = {
      status: 'draft',
      siteArchetype:
        selection.sections.includes('services') && !selection.sections.includes('offerProcess')
          ? 'multi_service'
          : selection.sections.includes('offerProcess')
            ? 'single_service'
            : config.siteArchetype || 'multi_service',
      meta: {
        pageType: 'Site outline (structure checklist)',
        geography: `${config.primaryCity}, ${config.state}`,
        niche: config.niche,
        source: 'content-structure',
      },
      sections: outlineToBriefSections(sections),
      homepageSections: outline.homepageSections,
      pageIds: selection.pages,
      _ops: { savedAt: nowIso(), source: 'structure-compose' },
    };
    writeJson(pathsFor(candidateId).contentBrief, brief);
  }

  const briefForArchetype = readJson(pathsFor(candidateId).contentBrief) || {};
  applyOutlineToSiteConfig(candidateId, {
    ...outline,
    siteArchetype: briefForArchetype.siteArchetype || config.siteArchetype,
  });

  saveMeta(candidateId, {
    lastContentStructureAt: nowIso(),
    lastContentOutlineAt: nowIso(),
    lastContentBriefAt: nowIso(),
  });

  const photoSectionCount = Object.keys(selection.photos || {}).length;
  const warnings = [];
  if (selection.sections.length >= 28 || photoSectionCount >= 8) {
    warnings.push(
      'Large outline — Full write must include every page FILE (about, contact, each service, each location) or Accept will fail. Prefer Preset C unless you need every section.',
    );
  }
  if (droppedOfferForServices) {
    warnings.push(
      'Removed Deep offer process — Services pages use How we work (process) instead.',
    );
  }

  return {
    outline,
    structure: getContentStructure(candidateId),
    brief: readJson(pathsFor(candidateId).contentBrief),
    markdown: outlineToMarkdown(outline),
    warnings,
    candidate: getCandidateShell(candidateId),
  };
}

/** home | services | locations — used to split a too-large Outline refine. */
export function outlineSectionKind(id) {
  const s = String(id || '');
  if (/^svc/i.test(s)) return 'services';
  if (/^loc/i.test(s)) return 'locations';
  return 'home';
}

/** Non-empty home / services / locations groups, in that order. */
export function outlineRefineGroups(outline) {
  const sections = Array.isArray(outline?.sections) ? outline.sections : [];
  const buckets = { home: [], services: [], locations: [] };
  for (const sec of sections) {
    buckets[outlineSectionKind(sec?.id)].push(sec);
  }
  return ['home', 'services', 'locations']
    .filter((key) => buckets[key].length)
    .map((key) => ({
      key,
      label: key,
      sections: buckets[key],
      sectionIds: buckets[key].map((s) => s.id).filter(Boolean),
    }));
}

const OUTLINE_SLICE_SEO_KEYS = ['keywordTargets', 'faqSeeds', 'organicTitleHints', 'keywords'];

/** Replace matching section ids; keep pages / ranking extras from the composed base. */
export function mergeOutlineSectionChunks(base, chunks) {
  const root = base && typeof base === 'object' ? base : {};
  const next = {
    ...root,
    sections: Array.isArray(root.sections) ? [...root.sections] : [],
  };
  const byId = new Map(next.sections.map((s, i) => [s?.id, i]));
  for (const chunk of chunks || []) {
    if (!chunk || typeof chunk !== 'object') continue;
    for (const key of OUTLINE_SLICE_SEO_KEYS) {
      if (chunk[key] == null) continue;
      if (Array.isArray(chunk[key]) && !chunk[key].length) continue;
      next[key] = chunk[key];
    }
    for (const sec of chunk.sections || []) {
      if (!sec?.id) continue;
      if (byId.has(sec.id)) next.sections[byId.get(sec.id)] = sec;
      else {
        byId.set(sec.id, next.sections.length);
        next.sections.push(sec);
      }
    }
  }
  return next;
}

export async function buildStructurePrompt(candidateId, opts = {}) {
  const outline = getContentOutlinePackage(candidateId);
  if (!outline?.sections?.length) {
    throw Object.assign(new Error('Compose an outline first (Continue from Structure)'), {
      status: 400,
    });
  }
  const briefEarly = readJson(pathsFor(candidateId).contentBrief);
  if (briefEarly?.status !== 'confirmed') {
    throw Object.assign(
      new Error('Confirm Content brief (Pass 1) before copying the Outline structure prompt'),
      { status: 400 },
    );
  }
  persistCoercedAcceptedSiteConfig(candidateId);
  const config = loadAcceptedSiteConfig(candidateId)?.config || {};
  let cityContext = getCachedCityContext(candidateId);
  try {
    cityContext = await buildCityContextPackage(candidateId);
  } catch {
    // keep cached / null
  }
  const cityCompact = compactCityContextForPrompt(cityContext);
  let eightPrefix = '';
  try {
    const { injectEightPassContext } = await import('./content-eight-pass.mjs');
    eightPrefix = `${injectEightPassContext(candidateId).prefix}\n\n`;
  } catch {
    // soft
  }
  const wantIds = Array.isArray(opts.sectionIds) && opts.sectionIds.length
    ? new Set(opts.sectionIds.map(String))
    : null;
  const sliceSections = wantIds
    ? (outline.sections || []).filter((s) => wantIds.has(String(s.id)))
    : outline.sections;
  const outlineForPrompt = wantIds
    ? { ...outline, sections: sliceSections, sectionIds: sliceSections.map((s) => s.id) }
    : outline;
  const sliceNote = wantIds
    ? `This call is a SLICE. Return a JSON object with \`sections\` covering only these ids: ${[...wantIds].join(', ')}. Include keywordTargets and faqSeeds when refining home/shared sections. Do not return other sections.\n\n`
    : '';
  const returnRule = wantIds
    ? '9. Return ONLY a JSON object with a `sections` array for the listed ids (plus keywordTargets / faqSeeds on the home slice). No markdown fences unless needed.'
    : '9. Return ONLY the full updated outline JSON object (same shape) in one response. No markdown fences unless needed.';
  const returnLine = wantIds
    ? 'Return the slice JSON (`sections` only, plus SEO maps when asked).'
    : 'Return the complete JSON outline.';
  const prompt = `${eightPrefix}You are an SEO content strategist for a local rank-and-rent website.

## Goal
Refine the site OUTLINE only (headings, instructions, keyword map, image alts). Do NOT write full page body copy yet.
Pass 2: for every section, set a clear H2 angle and job-to-be-done in \`instructions\` (what the section must accomplish and how it connects to the next).
${sliceNote}
## Business
${JSON.stringify(
  {
    businessName: config.businessName,
    niche: config.niche,
    primaryCity: config.primaryCity,
    state: config.state,
    domain: config.domain,
    services: config.services,
    commercialServices: config.commercialServices,
    targetSuburbs: config.targetSuburbs,
  },
  null,
  2,
)}

## Keyword / research hints
${JSON.stringify(outline.keywords || {}, null, 2)}

## Keyword targets (must map into H1/H2)
${JSON.stringify(outline.keywordTargets || [], null, 2)}

## FAQ seeds (from SERP PAA when available — lock FAQ topics to these)
${JSON.stringify(outline.faqSeeds || [], null, 2)}

## Organic SERP title hints (phrasing cues only — do not copy brands)
${JSON.stringify(outline.organicTitleHints || [], null, 2)}

${cityContextPromptRules()}

## City context JSON
\`\`\`json
${JSON.stringify(cityCompact || { note: 'unavailable — use site-config suburbs only' }, null, 2)}
\`\`\`

## Current outline JSON
\`\`\`json
${JSON.stringify(outlineForPrompt, null, 2)}
\`\`\`

## Instructions
1. Improve H1/H2 headings for search intent and clarity (keep section ids stable). Place each keywordTargets[].keyword into the named headingHint / section.
2. Keep or refine keywordTargets (primary + at least 2 supporting) and faqSeeds (6–10 PAA-style). Prefer SERP faqSeeds wording.
3. Strengthen each section's \`instructions\` for value SEO: methods, costs/ranges, timelines, materials, DIY vs pro, when to call — where relevant to that section. For loc* / materials / intro / areas / aboutStory, require local climate + housing/neighborhood cues from City context (when present) and concrete method/product names. Each instruction must state the section angle + reader job-to-be-done.
4. Keep \`images\` slots; improve alt/caption TODOs if photos are enabled.
5. Preserve pages and section ids unless a heading is clearly wrong. Do not add \`offerProcess\` when Services pages are selected (use \`process\` only).
6. Use organicTitleHints to sound competitive in titles/H2s without copying brand names.
7. Keep every section \`id\`, page list, and image path — refine headings, instructions, alts, and keyword/FAQ maps only.
8. Honor the Confirmed content brief questions, local details, and competitor angles.
${returnRule}

${returnLine}`;

  return { prompt, outline, cityContext: cityCompact, sectionIds: wantIds ? [...wantIds] : null };
}

export function pasteContentOutlinePackage(candidateId, raw) {
  let value = raw;
  if (typeof raw === 'string') {
    const parsed = parseJsonLoose(raw);
    if (!parsed.ok) {
      throw Object.assign(new Error('Could not parse outline JSON'), { status: 400 });
    }
    value = parsed.value;
  }
  if (!value || typeof value !== 'object' || !Array.isArray(value.sections)) {
    throw Object.assign(new Error('Outline must be a JSON object with sections[]'), {
      status: 400,
    });
  }
  const next = {
    ...value,
    candidateId: pathsFor(candidateId).id,
    status: 'uploaded',
    uploadedAt: nowIso(),
  };
  const gate = outlineSeoGateErrors(next);
  if (gate.length) {
    throw Object.assign(new Error(`Outline SEO incomplete: ${gate.join('; ')}`), {
      status: 400,
      outlineErrors: gate,
    });
  }
  writeJson(outlinePath(candidateId), next);

  const existingBrief = readJson(pathsFor(candidateId).contentBrief);
  if (!(existingBrief?.mode === 'eight_pass' && existingBrief?.status === 'confirmed')) {
    const brief = {
      status: 'draft',
      siteArchetype: value.siteArchetype || 'multi_service',
      meta: {
        pageType: 'Site outline (uploaded)',
        source: 'outline-paste',
      },
      sections: outlineToBriefSections(value.sections),
      homepageSections: value.homepageSections || [],
      pageIds: value.pageIds || [],
      _ops: { savedAt: nowIso(), source: 'outline-paste' },
    };
    writeJson(pathsFor(candidateId).contentBrief, brief);
  }
  applyOutlineToSiteConfig(candidateId, next);
  saveMeta(candidateId, { lastContentOutlineAt: nowIso(), lastContentBriefAt: nowIso() });
  return {
    outline: next,
    brief: readJson(pathsFor(candidateId).contentBrief),
    markdown: outlineToMarkdown(next),
    candidate: getCandidateShell(candidateId),
  };
}

export async function confirmContentOutline(candidateId) {
  const outline = getContentOutlinePackage(candidateId);
  if (!outline?.sections?.length) {
    throw Object.assign(new Error('No outline to confirm — Compose or paste first'), {
      status: 400,
    });
  }
  const gate = outlineSeoGateErrors(outline);
  if (gate.length) {
    throw Object.assign(new Error(`Cannot confirm outline: ${gate.join('; ')}`), {
      status: 400,
      outlineErrors: gate,
    });
  }
  // Ensure city briefs are ready before Full write
  try {
    await buildCityContextPackage(candidateId);
  } catch {
    // non-fatal — Full write still runs with soft rules
  }
  persistCoercedAcceptedSiteConfig(candidateId);
  const config = loadAcceptedSiteConfig(candidateId)?.config || {};
  const confirmed = {
    ...outline,
    status: 'confirmed',
    confirmedAt: nowIso(),
  };
  attachRankingOutlineExtras(confirmed, config, {
    candidateId,
    cityContext: getCachedCityContext(candidateId),
    fieldResearch: readFieldResearchRecord(candidateId),
  });
  writeJson(outlinePath(candidateId), confirmed);

  const briefPath = pathsFor(candidateId).contentBrief;
  const brief = readJson(briefPath) || {};
  if (brief.mode === 'eight_pass') {
    // Preserve Soft Pass-1 brief pages[]; only stamp outline linkage
    writeJson(briefPath, {
      ...brief,
      status: 'confirmed',
      confirmedAt: brief.confirmedAt || nowIso(),
      outlineSectionIds: (confirmed.sections || []).map((s) => s.id),
      homepageSections: confirmed.homepageSections || brief.homepageSections || [],
      _ops: {
        ...(brief._ops || {}),
        confirmedAt: brief._ops?.confirmedAt || nowIso(),
        outlineLinkedAt: nowIso(),
        source: brief._ops?.source || 'soft-brief-paste',
      },
    });
  } else {
    writeJson(briefPath, {
      ...brief,
      status: 'confirmed',
      confirmedAt: nowIso(),
      sections: outlineToBriefSections(confirmed.sections),
      homepageSections: confirmed.homepageSections || brief.homepageSections || [],
      _ops: { ...(brief._ops || {}), confirmedAt: nowIso(), source: 'outline-confirm' },
    });
  }
  applyOutlineToSiteConfig(candidateId, confirmed);
  saveMeta(candidateId, {
    lastContentOutlineConfirmedAt: nowIso(),
    lastContentBriefConfirmedAt: nowIso(),
  });
  return {
    outline: confirmed,
    brief: readJson(briefPath),
    markdown: outlineToMarkdown(confirmed),
    candidate: getCandidateShell(candidateId),
  };
}

export async function buildFullWritePrompt(candidateId) {
  const outline = getContentOutlinePackage(candidateId);
  if (!outline?.sections?.length) {
    throw Object.assign(new Error('Compose/confirm an outline before full write'), {
      status: 400,
    });
  }
  if (outline.status !== 'confirmed') {
    throw Object.assign(new Error('Confirm the outline before copying the full-write prompt'), {
      status: 400,
    });
  }
  const briefGate = readJson(pathsFor(candidateId).contentBrief);
  if (briefGate?.status !== 'confirmed') {
    throw Object.assign(new Error('Confirm Content brief before Full write'), { status: 400 });
  }
  persistCoercedAcceptedSiteConfig(candidateId);
  const config = loadAcceptedSiteConfig(candidateId)?.config || {};
  attachRankingOutlineExtras(outline, config, {
    candidateId,
    cityContext: getCachedCityContext(candidateId),
    fieldResearch: readFieldResearchRecord(candidateId),
  });
  writeJson(outlinePath(candidateId), outline);
  const fileRules = buildRequiredFileRules(outline, config);
  const requiredCount = fileRules.count || 0;
  const servicesLimit = Number(config.homepageServicesLimit) || 6;
  const svcSections = (outline.sections || []).filter((s) =>
    (s.pages || []).includes('services'),
  );
  const locSections = (outline.sections || []).filter((s) =>
    (s.pages || []).includes('locations'),
  );

  // Copy path: cache only — do not live-fetch Wikipedia (outline compose warms cache).
  const cityContext = getCachedCityContext(candidateId);
  const cityCompact = compactCityContextForPrompt(cityContext);

  let eightPrefix = '';
  try {
    const { injectEightPassContext } = await import('./content-eight-pass.mjs');
    eightPrefix = `${injectEightPassContext(candidateId).prefix}\n\n`;
  } catch {
    // soft
  }

  const prompt = `${eightPrefix}You are an expert local SEO copywriter for a rank-and-rent service website.

## Goal
Write FULL page content that follows the confirmed OUTLINE. Prioritize helpful, specific value Google rewards: methods, cost drivers and ranges (not fake quotes), timelines, materials, DIY vs pro, when to call a pro, and local proof from site-config socialProof.
Pass 3: vary sentence length across sections; prefer commas over em dashes; honor the Confirmed content brief.
**Burstiness:** mix short punchy lines with longer ones — location and service pages must not share one uniform long-sentence cadence.
**Paragraphs:** 1–3 short sentences each (about, locations, and service bodies too). Rover flags blocks over ~80 words.
**Bookends:** honor outline.bookendPolicy per FILE (mixed openers). Do not punch-open and free-estimate-close every page. When closer=skip, do not add a second estimate nudge — the CTA section is enough.
**NAP:** use site-config phone, email, and businessName literally. Never invent numbers or leave placeholders like +1XXXXXXXXXX / leads@example.com.

${shotgunDoNotLinkBlock(candidateId)}
${formatZoneSiblingDigestForCandidate(candidateId)}
## Site config
\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

## Confirmed outline
\`\`\`json
${JSON.stringify(outline, null, 2)}
\`\`\`

${cityContextPromptRules()}

## City context JSON
\`\`\`json
${JSON.stringify(cityCompact || { note: 'unavailable — use site-config suburbs + honest general local conditions' }, null, 2)}
\`\`\`

## Output format
Emit markdown files using blocks:

### FILE: <path>
---
<frontmatter yaml>
---
<body markdown>

**Emit all ${requiredCount} ### FILE blocks listed below in one reply.** If length-limited, continue in the next message with only the remaining FILE paths — same format, no recap.
Homepage may show only ${servicesLimit} service cards (\`homepageServicesLimit\`); still write **every** service FILE listed.
Reviews/trust come from site-config socialProof (Rover seeds placeholders when empty; replace with real reviews before launch) — do not invent testimonials in copy.

Required files for this job (${requiredCount}):
${fileRules.markdown || '- Home: `### FILE: src/content/pages/index.md`\n- About: `### FILE: src/content/pages/about.md`\n- Contact: `### FILE: src/content/pages/contact.md`'}

## Shared templates
${
  svcSections.length
    ? `${formatServiceBandRulesMarkdown(outline.serviceBandAssignments || {}, configuredServiceNames(config))}
- Substitute the real service name for \`{serviceName}\` in headings and body. **svcIntro is unmarked** — 2 paragraphs before the first \`##\`; do **not** emit \`##\` for svcIntro.
- Homepage still carries the full educational encyclopedia (cost, DIY, permits, and other enabled home bands) even when a service FILE omits that band.`
    : '- No service-page sections enabled.'
}
${
  locSections.length
    ? `${formatLocationAnglesMarkdown(outline.locationAngles || {}, configuredSuburbNames(config))}
${formatLocationSectionPolicyMarkdown(outline.locationSectionPolicy || {}, configuredSuburbNames(config))}
- Apply loc* outline sections that are enabled, but skip Why-choose / FAQ clones when this suburb’s angle already lives in the intro or locationSectionPolicy omits them. Substitute the suburb name for \`{suburb}\`.`
    : '- No location-page sections enabled.'
}
${formatBookendPolicyMarkdown(outline.bookendPolicy || {})}

## Dual-source contract (home vs service)
- **Homepage:** \`whyChooseUs[]\`, \`process[]\`, \`faqs[]\`, and \`gallery\` live in **frontmatter only**. Do NOT dump process steps, FAQ Q&As, or why-reasons into the homepage body.
- **Homepage body:** intro (~2 paras) + \`##\` sections for enabled **educational** bands only (cost, materials, timeline, codes, diyVsPro, whenToCall).
- **Service pages:** there are **no** \`process\` / \`faqs\` / \`whyChooseUs\` frontmatter arrays. After a short unmarked intro (no \`##\` for svcIntro), emit a body \`##\` only for bands listed on that FILE in serviceBandAssignments (not every enabled svc* section).
- Do **not** invent service-page \`process:\` or \`faqs:\` YAML arrays.

## Frontmatter expectations (homepage index.md)
- title, description, h1
- sectionHeading (intro H2)
- whyChooseUs: [{ title, description }] when whyChooseUs section enabled
- process: [{ title, description, image? }] when process/offerProcess enabled — **exactly 6** steps when a niche photo block list is present (those titles); otherwise prefer **4, 6, or 8** steps so the last grid row is full; each \`description\` = one **sentence** (~8–14 words, capital letter, period), not a lowercase caption or paragraph. When the title comes from the niche photo block list, keep that product and rewrite the description with this city's housing or climate
- faqs: [{ question, answer }] when faqs enabled
- gallery: [{ src, alt }] when beforeAfter/gallery photos enabled
- materialsImages: [{ src, alt }] is Pull-owned when materials photos are on — omit or preserve existing; do not invent image paths. Ranking builds pull materials thumbs for compact media rows.
- **Homepage body:**
  1. Start with intro prose only (max ~2 short salesperson paragraphs). Do NOT repeat whyChooseUs, process, FAQs, or the services list in the body — those belong in frontmatter / dedicated sections only.
  2. After the intro, add a \`##\` Markdown section for **each enabled educational homepage section** (cost, materials, timeline, codes, diyVsPro, whenToCall, and similar) using that section’s outline heading + writeInstructions. Do **not** re-dump process/why/FAQs as body prose.
- Do **not** repeat the h1 as the first body line.
- **Images:** omit \`heroImage\` / \`featureImage\` / \`cardImage\` / \`gallery\` / \`process[].image\` / \`materialsImages\` unless a real file already exists (Rover Pull, ChatGPT BA import, or operator upload). Never invent paths. Never write \`heroImage: ""\`. When present use object form only:
\`\`\`yaml
heroImage:
  src: /images/example.jpg
  alt: "Descriptive alt text"
\`\`\`
- Outline photo slots list counts only (paths are null until Pull) — do not invent \`public/images/...\` placeholders.
- **Never** put markdown body images (\`![alt](/images/...)\`) in page bodies. Materials / process / before-after / gallery rely on frontmatter + Rover Pull or ChatGPT BA import only. Service before/after photos use \`beforeAfterImages\` from Website ChatGPT import (never invent paths).

## Frontmatter expectations (each services/*.md)
- title, description, h1, serviceName
- \`description\` = ONE meta-length sentence (~140–160 chars): serviceName + 2–3 offer terms + free estimates (hero supporting under H1). Do **not** stuff “in ${config.primaryCity || '{city}'}${config.state ? `, ${config.state}` : ''}” into every service card — city belongs once in the homepage intro. Card body = what it is, when needed, outcome.
- heroImage / cardImage only as \`{ src, alt }\` objects when files already exist; otherwise omit
- \`materialsImages: [{ src, alt }]\` is Pull-owned when svcMaterials photos are on — omit or preserve existing; do not invent image paths. Ranking builds pull materials thumbs for compact media rows.
- \`processImages: [{ src, alt }]\` is Pull-owned when svcProcess photos are on — omit or preserve existing; do not invent image paths
- **No** \`process:\` / \`faqs:\` / \`whyChooseUs:\` / \`gallery:\` frontmatter on service pages
- Body:
  1. Unmarked intro: max ~2 concise paragraphs (service-first; one natural city mention OK). **Do not emit \`##\` for svcIntro.**
  2. A \`##\` heading only for bands assigned to this FILE in serviceBandAssignments (except svcIntro). Do **not** emit cost / DIY / permits / timeline / materials / when-to-call unless that FILE was assigned that band.
- Process (when enabled): exactly **6** steps when a niche photo block list is present (use those titles); otherwise prefer **4, 6, or 8** steps. Each step its own markdown list line \`- **Title** — short description\` (description ~8–14 words; timing cue OK). Never concatenate multiple steps into one paragraph. No body images — thumbs come from Pull \`processImages\` frontmatter (one per step, same compact cards as homepage)
- What’s included / Scope (when enabled): **at least 3 real scope bullets specific to this serviceName** (methods, materials, verification — e.g. CIPP = candidacy camera + liner cure + post-CCTV; camera inspection = full pass + findings write-up). Do **not** use the same generic “labor/materials/cleanup” trio on every service. Optional add-ons and Customer prep may follow as extra bullets — never leave the section with only Optional / Customer prep lines
- FAQs (when enabled): question line ending with \`?\`, then answer paragraph(s) before the next question
- Cost (when enabled): 3–5 bullets \`**Tier** — $low–$high, what’s included\` (one em dash, then a comma; ballparks, not a fixed quote)
- Codes (when enabled): \`### Usually needs a permit\` then \`### Usually no permit\`, one bullet per item
- DIY vs pro (when enabled): \`### DIY\` first, then \`### Hire a pro\`, each with balanced bullets
- Timeline (when enabled): stage bullets \`**Stage title**: duration\` where duration is a complete phrase (\`same day\`, \`1–2 days\`, \`3–7 days\`). Keep en-dashes in ranges. Never write hedges like \"or next day\" / \"usually\" / \"in most cases\" / \"varies by city\" that can drop mid-phrase
- Before/after (when enabled): short problem → solution text lines only; photos live on the **homepage** gallery — do not invent image paths; optionally link to \`/\` for photo examples
- Materials (when enabled): short intro + **exactly 6** option bullets when a niche photo block list is present (use those titles); otherwise **exactly 3 or 6** (choose **6** when research/entities support six distinct products/methods; otherwise **3**; never 4, 5, 7, or 8). Each bullet \`**Product/system name**:\` then **1–2 sentences**. Concrete product/system/method titles (not “professional grade” alone). Keep a locked title, and put this city's housing or climate in the sentence under it. No body images — Pull supplies \`materialsImages\` thumbs for compact text+photo rows

## Frontmatter expectations (about.md)
- title, description, h1
- **h1 MUST be** \`About ${config.businessName || 'Business'}\` (full business name — never niche alone)
- title should include the business name; keep the keyword lead short so SERP title stays ≤~60 chars after any \`| brand\` suffix

## Frontmatter expectations (contact.md)
- title, description, h1
- **h1 MUST be** \`Contact ${config.businessName || 'Business'}\` (full business name — never niche alone)
- title should include the business name; keep SERP title ≤~60 chars

## Frontmatter expectations (each locations/*.md)
- Filename slug = city kebab only (e.g. \`riverton.md\` → \`/locations/riverton\`); never append state (\`riverton-ut\` is wrong)
- title, description, h1, city, state
- **Target ~600+ words** of useful local copy (intro + local notes + proof + FAQs + CTA when those sections are enabled) — not a thin stub. Accept rejects bodies under ~450 words and near-duplicate location pages.
- Use City context **and locationAngles** for **this** city: climate/housing/neighborhood hints when present; paraphrase into niche work — never invent neighborhoods not listed. Prefer cues that have a sourceUrl.
- **Every location FILE must differ** in local notes and examples (do not swap only the city name, and do not stitch two other suburb pages together).
- **Primary city** (\`${config.primaryCity || 'primary'}\`): do **not** reuse the homepage head pattern (“${config.niche || 'niche'} in ${config.primaryCity || 'city'}, ST”). Prefer “${config.niche || 'Niche'} for ${config.primaryCity || 'City'}, ${config.state || 'ST'} homeowners” (or “${config.businessName || 'Business'} serving ${config.primaryCity || 'City'}”). Always include the **niche** and **city**; never geo-only (“{City} Service Areas & Neighborhoods”) and avoid awkward “{niche} in {city} neighborhoods” as the sole H1. Emphasize local conditions in the body; link up to \`/\` plus out to suburb / service pages.
- **Suburb cities:** keep “${config.niche || 'niche'} in {suburb}, ${config.state || 'ST'}”
- heroImage only as \`{ src, alt }\` or omit
- Do not echo h1 as the first body line
- Do **not** add off-niche partner cross-sells or country/trivia digressions

## Rules
1. Honor every enabled outline section for the matching page type; skip disabled ones. svcIntro / level none = unmarked body, not an H2.
2. Use outline headings (you may lightly polish wording; replace placeholders). Exception: do **not** emit svcIntro’s outline heading as \`##\`.
3. Never invent image \`src\` paths. Omit image frontmatter until Pull / BA import / operator upload supplies files. Preserve existing Pull-owned image fields when present. Do **not** emit body \`![](...)\` placeholders.
4. For cost/timeline headings with \`{serviceName}\`, prefer “What does **a** {serviceName} cost…” / “How long does **a** {serviceName} take…” (article “a” + singular-ish name).
5. Use site-config socialProof for reviews/licenses/ratings — do not invent testimonials, license ID numbers, or founding years not in site-config.
6. Write for ${config.primaryCity || 'the city'}, ${config.state || ''} and listed suburbs.
7. **Keywords:** Put each keywordTargets[].keyword into the mapped H1/H2. Primary must appear in homepage title + h1.
8. **FAQs:** When FAQs enabled, questions must follow faqSeeds (SERP PAA) closely — paraphrase OK, topic lock required.
9. **Organic title hints:** Use for competitive phrasing; do not copy competitor brand names.
10. **Company subject:** Always use the full business name (“${config.businessName || 'Business'}”) when the company acts (provides, manages, files, handles, offers). Niche labels (“${config.niche || 'the niche'}”) are for H1s, section titles, and service-type nouns — do **not** shorten “${config.businessName || 'Business'}” to the niche alone in body prose.
11. **Titles:** Prefer a keyword-led \`title\` ≤~50 characters, or include the business name in \`title\` so the layout does not need a long \`| brand\` suffix. Aim for final browser title ≤~60 characters.
12. **Required internal links** (include as markdown \`[Label](/path)\`):
13. **Service cards:** do not repeat “in ${config.primaryCity || '{city}'}${config.state ? `, ${config.state}` : ''}” on every service description. Name the work, when it is needed, and the outcome.
${buildLinkChecklistMarkdown(outline, config)}

${formatNichePhotoBlockPrompt(getNichePhotoBlocks(config.niche))}

Return ONLY the ### FILE blocks.`;

  return { prompt, outline, config, requiredFileCount: requiredCount, cityContext: cityCompact };
}

/**
 * Focused continue prompt for missing and/or stub/thin FILE paths after a partial Full write.
 * Operator pastes Claude's ### FILE blocks into the same Load merge path.
 */
export async function buildContinueWritePrompt(candidateId) {
  const outline = getContentOutlinePackage(candidateId);
  if (!outline?.sections?.length) {
    throw Object.assign(new Error('Compose/confirm an outline before continue write'), {
      status: 400,
    });
  }
  if (outline.status !== 'confirmed') {
    throw Object.assign(new Error('Confirm the outline before copying the continue prompt'), {
      status: 400,
    });
  }

  persistCoercedAcceptedSiteConfig(candidateId);
  const config = loadAcceptedSiteConfig(candidateId)?.config || {};
  refreshServiceBandAssignments(candidateId);
  const pageIds = resolveStructurePageIds(candidateId);
  const detail = getCandidateDetail(candidateId);
  const files = detail?.contentDraft?.files || {};
  const { missing, stubs, expected, ok } = listLaunchContentGaps(files, config, pageIds);

  if (ok) {
    throw Object.assign(
      new Error('Nothing to continue — draft has all required non-stub files'),
      { status: 400 },
    );
  }

  const gapPaths = [...missing, ...stubs.filter((p) => !missing.includes(p))];
  const gapCount = gapPaths.length;
  const svcNeeded = gapPaths.some((p) => p.includes('/services/'));
  const locNeeded = gapPaths.some((p) => p.includes('/locations/'));
  const pageNeeded = gapPaths.some((p) => p.includes('/pages/'));
  const svcSections = (outline.sections || []).filter((s) =>
    (s.pages || []).includes('services'),
  );
  const locSections = (outline.sections || []).filter((s) =>
    (s.pages || []).includes('locations'),
  );

  let cityContext = getCachedCityContext(candidateId);
  try {
    cityContext = await buildCityContextPackage(candidateId);
  } catch {
    // soft fail
  }
  const cityCompact = compactCityContextForPrompt(cityContext);

  const pathLines = gapPaths
    .map((rel) => {
      const kind = stubs.includes(rel) && !missing.includes(rel) ? 'rewrite stub/thin' : 'missing';
      return `- \`### FILE: ${rel}\` (${kind})`;
    })
    .join('\n');

  const stubNote = stubs.length
    ? `\n## Stub / thin rewrites\nThese paths exist in the draft but are seed stubs or too thin for Accept. **Replace the entire FILE** (frontmatter + body) with full launch-ready copy — do not append to the stub.\n${stubs.map((p) => `- \`${p}\``).join('\n')}\n`
    : '';

  const outlineSlice = {
    pageIds: outline.pageIds || [],
    sections: (outline.sections || []).filter((s) => {
      const pages = s.pages || [];
      if (svcNeeded && pages.includes('services')) return true;
      if (locNeeded && pages.includes('locations')) return true;
      if (pageNeeded && (pages.includes('home') || pages.includes('about') || pages.includes('contact'))) {
        return true;
      }
      return false;
    }),
    keywords: outline.keywords || null,
    keywordTargets: outline.keywordTargets || null,
    faqSeeds: outline.faqSeeds || null,
  };

  const prompt = `You are an expert local SEO copywriter for a rank-and-rent service website.

## Goal
Finish an incomplete Full write. Emit **only** the FILE paths listed below. Rover **merges** them into the existing draft — do not recap files already loaded, and do not invent extra paths.

${shotgunDoNotLinkBlock(candidateId)}
${formatZoneSiblingDigestForCandidate(candidateId)}
## Site config
\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

## Outline sections for these pages
\`\`\`json
${JSON.stringify(outlineSlice, null, 2)}
\`\`\`

${cityContextPromptRules()}

## City context JSON
\`\`\`json
${JSON.stringify(cityCompact || { note: 'unavailable — use site-config suburbs + honest general local conditions' }, null, 2)}
\`\`\`

## Output format
Emit markdown using blocks:

### FILE: <path>
---
<frontmatter yaml>
---
<body markdown>

**Emit all ${gapCount} ### FILE blocks listed below in one reply.** If length-limited, continue in the next message with only the remaining paths from this list — same format, no recap.
${stubNote}
## Required files for this continue job (${gapCount})
${pathLines}

## Shared templates
${
  svcNeeded && svcSections.length
    ? `- **Service pages:** Apply the svc* outline sections (${svcSections.map((s) => s.id).join(', ')}) to EVERY service FILE in this list. Substitute the real service name for \`{serviceName}\`. **svcIntro is unmarked** (no \`##\`); other svc* bands are body \`##\`.`
    : svcNeeded
      ? '- **Service pages:** Use service frontmatter + body ## bands from the outline when present.'
      : '- No service FILEs in this continue job.'
}
${
  locNeeded && locSections.length
    ? `- **Location pages:** Apply the loc* outline sections (${locSections.map((s) => s.id).join(', ')}) to EVERY location FILE in this list. Substitute the suburb name for \`{suburb}\`.`
    : locNeeded
      ? '- **Location pages:** Use location frontmatter + loc* body sections when present.'
      : '- No location FILEs in this continue job.'
}

## Dual-source contract (when writing service pages)
- Service pages: **no** \`process\` / \`faqs\` / \`whyChooseUs\` frontmatter arrays. Short unmarked intro (**no \`##\` for svcIntro**), then every **other** enabled service band as body \`##\`.
- Do **not** invent service-page \`process:\` or \`faqs:\` YAML.

## Frontmatter / body expectations (services/*.md when listed)
- title, description, h1, serviceName; \`description\` = ONE meta-length sentence (~140–160 chars)
- Omit inventing image paths; preserve existing Pull-owned fields if you somehow see them (you will not — write full new FILEs)
- Body: unmarked intro (no svcIntro H2) + \`##\` for each other enabled svc* section; Materials compact media rows (1–2 sentences per option bullet when enabled)
- Codes (when enabled): \`### Usually needs a permit\` then \`### Usually no permit\`

## Frontmatter / body expectations (locations/*.md when listed)
- Filename slug = city kebab only; title, description, h1, city, state
- **Target ~600+ words** across loc* sections — Accept rejects bodies under ~450 words and near-duplicates
- **Every location FILE must differ** (do not swap only the city name)
- Primary city (\`${config.primaryCity || 'primary'}\`): do **not** reuse homepage “${config.niche || 'niche'} in ${config.primaryCity || 'city'}, ST” — prefer niche + city for homeowners / business serving city
- Suburb cities: “${config.niche || 'niche'} in {suburb}, ${config.state || 'ST'}”
- No seed stub phrasing (“is part of our … service area…”, “neighborhoods are part of how … plans…”)

${formatNichePhotoBlockPrompt(getNichePhotoBlocks(config.niche))}

## Rules
1. Honor enabled outline sections for each page type in this list; skip disabled ones.
2. Never invent image \`src\` paths or body \`![](...)\` images.
3. Use site-config socialProof only — do not invent testimonials or license IDs.
4. Unique, honest local copy for ${config.primaryCity || 'the city'}, ${config.state || ''}.
5. Service card \`description\`: do not repeat “in ${config.primaryCity || '{city}'}${config.state ? `, ${config.state}` : ''}” on every card — city once in the homepage intro.
6. Return ONLY the ### FILE blocks for the paths listed above.

Draft progress: ${Object.keys(files).length} of ${expected.length} required paths already loaded; finish the ${gapCount} gap(s).`;

  return {
    prompt,
    outline,
    config,
    missing,
    stubs,
    count: gapCount,
    expectedCount: expected.length,
    cityContext: cityCompact,
  };
}

function buildLinkChecklistMarkdown(outline, config) {
  const pageIds = new Set(outline.pageIds || []);
  const lines = [
    '- Homepage (`src/content/pages/index.md`): `[Contact](/contact)`, `[About](/about)`',
  ];
  const services = Array.isArray(config.services) ? config.services : [];
  for (const svc of services.slice(0, 6)) {
    const name = typeof svc === 'string' ? svc : svc?.name;
    const slug = slugifyContentName(name);
    if (slug) lines.push(`- Homepage: \`[${name}](/services/${slug})\``);
  }
  if (pageIds.has('locations')) {
    const primary = String(config.primaryCity || '').trim();
    if (primary) {
      const pslug = slugifyContentName(primary);
      if (pslug) lines.push(`- Homepage: \`[${primary} (primary area)](/locations/${pslug})\``);
    }
    for (const sub of (config.targetSuburbs || []).slice(0, 8)) {
      const label = typeof sub === 'string' ? sub : sub?.name || sub?.city;
      const slug = slugifyContentName(label);
      if (slug) lines.push(`- Homepage: \`[${label}](/locations/${slug})\``);
    }
  }
  lines.push('- Each service page: `[Home](/)` and `[Contact](/contact)` (+ one sibling service link when ≥2 services)');
  return lines.join('\n');
}

/**
 * Seed keywords / faqSeeds / organic titles from research + optional content-research pack.
 */
export function applyResearchSeoSeeds(outline, detail, selection) {
  const research = detail?.research || {};
  const approved = detail?.approved || {};
  const serp = research.serp || {};
  const volumeRows = Array.isArray(research.volumes?.keywords) ? research.volumes.keywords : [];
  let volumeHints = volumeRows
    .map((row) => ({
      keyword: row.keyword || row.Keyword || '',
      volume: row.searchVolume ?? row.search_volume ?? row.volume ?? null,
    }))
    .filter((r) => r.keyword)
    .slice(0, 12);
  if (!volumeHints.length) {
    const suggested = [
      ...(Array.isArray(approved?.suggestedKeywords) ? approved.suggestedKeywords : []),
      ...(Array.isArray(research.suggestedKeywords) ? research.suggestedKeywords : []),
      ...(Array.isArray(detail?.narrative?.suggestedKeywords)
        ? detail.narrative.suggestedKeywords
        : []),
    ];
    volumeHints = suggested
      .map((row) => ({
        keyword: typeof row === 'string' ? row : row?.keyword || row?.phrase || '',
        volume: null,
      }))
      .filter((r) => r.keyword)
      .slice(0, 12);
  }

  const supporting = volumeHints
    .map((r) => r.keyword)
    .filter((k) => normalizeLoose(k) !== normalizeLoose(outline.keywords.primary))
    .slice(0, 5);

  outline.keywords.supporting = supporting;
  outline.keywords.volumeHints = volumeHints;
  if (approved?.topTargetKeywordsAndVolumesText || research.spreadsheetFields?.topTargetKeywordsAndVolumesText) {
    outline.keywords.fromApproved =
      approved.topTargetKeywordsAndVolumesText ||
      research.spreadsheetFields.topTargetKeywordsAndVolumesText;
  } else if (Array.isArray(approved?.keywords)) {
    outline.keywords.fromApproved = approved.keywords;
  }

  const city = String(outline.keywords.city || '').split(',')[0].trim();
  const primary = outline.keywords.primary || 'service';
  outline.keywordTargets = [
    {
      keyword: primary,
      headingHint: `${primary} in ${city}`,
      sectionId: 'hero',
    },
    ...supporting.slice(0, 3).map((keyword, i) => ({
      keyword,
      headingHint: keyword,
      sectionId: i === 0 ? 'cost' : i === 1 ? 'faqs' : 'intro',
    })),
  ];

  const contentResearch = detail?.contentResearch || readJson(pathsFor(detail?.id || outline.candidateId).contentResearch);
  const paaFromSerp = Array.isArray(serp.peopleAlsoAskQuestions) ? serp.peopleAlsoAskQuestions : [];
  const paaFromPack = Array.isArray(contentResearch?.paaStyleQuestions)
    ? contentResearch.paaStyleQuestions
    : [];
  let faqSeeds = [...paaFromSerp];
  if (faqSeeds.length < 6) faqSeeds = [...faqSeeds, ...paaFromPack];
  const faqPad = [
    `How much does ${primary} cost in ${city}?`,
    `How long does ${primary} take?`,
    `Do I need a permit for ${primary}?`,
    `Is DIY ${primary} a good idea?`,
    `When should I call a ${primary} pro?`,
    `What affects ${primary} pricing?`,
    `What is typically included in ${primary}?`,
    `How do I prepare my home for ${primary}?`,
  ];
  for (const q of faqPad) {
    if (faqSeeds.length >= 8) break;
    const key = normalizeLoose(q);
    if (faqSeeds.some((existing) => normalizeLoose(existing) === key)) continue;
    faqSeeds.push(q);
  }
  outline.faqSeeds = [...new Set(faqSeeds.map((q) => String(q).trim()).filter(Boolean))].slice(0, 10);

  let organicTitles = Array.isArray(serp.organicTitles) ? serp.organicTitles : [];
  if (!organicTitles.length) {
    organicTitles = [
      ...(serp.organicHomePages?.links || []).map((l) => l.title),
      ...(serp.organicSubPages?.links || []).map((l) => l.title),
    ].filter(Boolean);
  }
  outline.organicTitleHints = [...new Set(organicTitles.map((t) => String(t).trim()).filter(Boolean))].slice(
    0,
    10,
  );

  // Ensure faqs section gets seed note in instructions when enabled
  if (selection.sections?.includes('faqs')) {
    const faqs = outline.sections.find((s) => s.id === 'faqs');
    if (faqs) {
      faqs.instructions = `${faqs.instructions || ''}\nFAQ questions must cover these seeds:\n- ${outline.faqSeeds.join('\n- ')}`.trim();
    }
  }
}

function outlineSeoGateErrors(outline) {
  const errors = [];
  const targets = Array.isArray(outline.keywordTargets) ? outline.keywordTargets : [];
  if (targets.length < 3) {
    errors.push('keywordTargets needs primary + at least 2 supporting entries');
  }
  const faqsOn = (outline.sectionIds || []).includes('faqs') ||
    (outline.sections || []).some((s) => s.id === 'faqs');
  const seeds = Array.isArray(outline.faqSeeds) ? outline.faqSeeds : [];
  if (faqsOn && seeds.length < 6) {
    errors.push('faqSeeds needs at least 6 PAA-style questions when FAQs are enabled');
  }
  return errors;
}

function normalizeLoose(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function listStructureCatalog() {
  const registry = loadSectionRegistry();
  return {
    pages: registry.pages,
    sections: sortSectionsForCatalog(registry.sections, registry),
    homepageSectionOrder: registry.homepageSectionOrder || [],
    presets: registry.presets,
    defaults: getDefaultStructureSelection(),
  };
}
