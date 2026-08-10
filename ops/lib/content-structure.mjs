/**
 * Outline-first content structure: section checklist → outline → Claude prompts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCandidateDetail,
  pathsFor,
  RESEARCH_DIR,
  saveMeta,
} from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { parseJsonLoose } from './claude.mjs';

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
  return {
    businessName: config.businessName || 'Business',
    niche: config.niche || 'service',
    city: config.primaryCity || 'City',
    state: config.state || 'ST',
    // Left as placeholders for Claude to fill per FILE
    serviceName: '{serviceName}',
    suburb: '{suburb}',
  };
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

function configuredSuburbNames(config = {}) {
  const names = [];
  for (const name of config.targetSuburbs || []) {
    const n = String(name || '').trim();
    if (n && !names.includes(n)) names.push(n);
  }
  return names;
}

function buildRequiredFileRules(outline, config = {}) {
  const pageIds = new Set(outline.pageIds || (outline.pages || []).map((p) => p.id));
  const lines = [];
  const pageMeta = new Map((outline.pages || []).map((p) => [p.id, p]));

  for (const id of ['home', 'about', 'contact']) {
    if (!pageIds.has(id)) continue;
    const p = pageMeta.get(id);
    lines.push(`- ${p?.label || id}: \`### FILE: ${p?.route || `src/content/pages/${id === 'home' ? 'index' : id}.md`}\``);
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
        lines.push(`  - ${name}: \`### FILE: src/content/services/${slug}.md\``);
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
        lines.push(`  - ${name}: \`### FILE: src/content/locations/${slug}.md\``);
      }
    } else {
      lines.push(
        '  - (No targetSuburbs in site-config — add suburbs or skip location FILEs)',
      );
    }
  }

  return lines.join('\n');
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

  for (const s of registry.sections) {
    if (s.required && !sections.includes(s.id)) sections.push(s.id);
  }

  // Drop sections whose pages aren't selected
  sections = sections.filter((id) => {
    const def = sectionById.get(id);
    return (def?.pages || []).some((pid) => pages.includes(pid));
  });

  const photos = {};
  const photoIn = input.photos && typeof input.photos === 'object' ? input.photos : {};
  for (const id of sections) {
    const def = sectionById.get(id);
    if (!def?.photoCapable) continue;
    const raw = photoIn[id];
    if (raw === true) photos[id] = { enabled: true, count: Math.min(def.maxImages || 1, 3) };
    else if (raw && typeof raw === 'object' && raw.enabled) {
      const max = def.maxImages || 1;
      const count = Math.min(max, Math.max(1, Number(raw.count) || 1));
      photos[id] = { enabled: true, count };
    }
  }

  return {
    pages,
    sections,
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
  const photos = {};
  for (const [sid, on] of Object.entries(preset.photos || {})) {
    if (on) photos[sid] = { enabled: true, count: 3 };
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
  return normalizeSelection({});
}

export function getContentStructure(candidateId) {
  return readJson(structurePath(candidateId));
}

export function getContentOutlinePackage(candidateId) {
  return readJson(outlinePath(candidateId));
}

/**
 * Save operator checklist selection (draft structure).
 */
export function saveContentStructure(candidateId, selection = {}) {
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
  return { structure: doc, candidate: getCandidateDetail(candidateId) };
}

function composeSections(selection, registry, vars) {
  const sectionById = new Map(registry.sections.map((s) => [s.id, s]));
  const out = [];
  for (const id of selection.sections) {
    const def = sectionById.get(id);
    if (!def) continue;
    const photo = selection.photos?.[id];
    const images = [];
    if (photo?.enabled) {
      const n = photo.count || 1;
      const hint = String(def.id || 'photo')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      for (let i = 1; i <= n; i += 1) {
        images.push({
          path: `public/images/${def.id}-${i}-${hint}.jpg`,
          alt: `TODO alt for ${def.label} image ${i}`,
          caption: '',
        });
      }
    }
    out.push({
      id: def.id,
      level: def.level,
      heading: fillTemplate(def.defaultHeading, vars),
      kind: def.kind,
      pages: def.pages,
      astroKey: def.astroKey,
      instructions: def.writeInstructions,
      photoCapable: Boolean(def.photoCapable),
      images,
    });
  }
  return out;
}

function outlineToBriefSections(outlineSections) {
  return outlineSections.map((s) => ({
    id: s.id,
    level: s.level || 'H2',
    heading: s.heading,
    instructions: s.instructions,
    kind: s.kind,
    ...(s.images?.length ? { images: s.images } : {}),
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
    lines.push('', `### ${s.level || 'H2'}: ${s.heading || s.id}`);
    lines.push(`- id: \`${s.id}\``);
    if (s.astroKey) lines.push(`- astroKey: \`${s.astroKey}\``);
    if (s.instructions) lines.push(`- instructions: ${s.instructions}`);
    if (s.images?.length) {
      lines.push('- images:');
      for (const img of s.images) {
        lines.push(`  - \`${img.path}\` — alt: ${img.alt || 'TODO'}; caption: ${img.caption || ''}`);
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

function homepageAstroKeys(selection, registry) {
  const sectionById = new Map(registry.sections.map((s) => [s.id, s]));
  const rank = homepageSectionRank(registry);
  const keyed = [];
  for (const id of selection.sections) {
    const def = sectionById.get(id);
    if (!def?.astroKey) continue;
    if (!(def.pages || []).includes('home')) continue;
    keyed.push({ id, astroKey: def.astroKey, rank: rank.has(id) ? rank.get(id) : 900 });
  }
  keyed.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const keys = [];
  for (const row of keyed) {
    if (!keys.includes(row.astroKey)) keys.push(row.astroKey);
  }
  return keys;
}

/**
 * Continue: compose outline package from structure selection.
 */
export function composeContentOutline(candidateId, selectionPatch = null) {
  const registry = loadSectionRegistry();
  const config = loadAcceptedSiteConfig(candidateId)?.config;
  if (!config) {
    throw Object.assign(new Error('Accept site-config first'), { status: 400 });
  }
  const prior = getContentStructure(candidateId) || {};
  const selection = normalizeSelection(
    selectionPatch
      ? { ...prior, ...selectionPatch, photos: selectionPatch.photos || prior.photos }
      : prior,
    registry,
  );
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
      'Map primary + supporting keywords from research into H1/H2s.',
      'Prefer helpful depth: methods, cost drivers, timelines, when to call, DIY vs pro.',
      'Internal links: Home ↔ Services ↔ Locations ↔ Contact.',
      'Do not invent licenses, years in business, or review counts.',
    ],
    keywords: {
      primary: config.niche || null,
      city: `${config.primaryCity || ''}, ${config.state || ''}`.trim(),
      fromApproved: null,
    },
  };

  const approved = getCandidateDetail(candidateId).approved;
  if (approved?.topTargetKeywordsAndVolumesText) {
    outline.keywords.fromApproved = approved.topTargetKeywordsAndVolumesText;
  } else if (Array.isArray(approved?.keywords)) {
    outline.keywords.fromApproved = approved.keywords;
  }

  writeJson(outlinePath(candidateId), outline);
  writeJson(structurePath(candidateId), {
    ...selection,
    version: 1,
    candidateId: pathsFor(candidateId).id,
    status: 'composed',
    updatedAt: nowIso(),
    createdAt: prior.createdAt || nowIso(),
  });

  // Keep brief in sync for Accept/oneshot compatibility
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

  applyOutlineToSiteConfig(candidateId, { ...outline, siteArchetype: brief.siteArchetype });

  saveMeta(candidateId, {
    lastContentStructureAt: nowIso(),
    lastContentOutlineAt: nowIso(),
    lastContentBriefAt: nowIso(),
  });

  return {
    outline,
    structure: getContentStructure(candidateId),
    brief,
    markdown: outlineToMarkdown(outline),
    candidate: getCandidateDetail(candidateId),
  };
}

export function buildStructurePrompt(candidateId) {
  const outline = getContentOutlinePackage(candidateId);
  if (!outline?.sections?.length) {
    throw Object.assign(new Error('Compose an outline first (Continue from Structure)'), {
      status: 400,
    });
  }
  const config = loadAcceptedSiteConfig(candidateId)?.config || {};
  const prompt = `You are an SEO content strategist for a local rank-and-rent website.

## Goal
Refine the site OUTLINE only (headings, instructions, keyword map, image alts). Do NOT write full page body copy yet.

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

## Current outline JSON
\`\`\`json
${JSON.stringify(outline, null, 2)}
\`\`\`

## Instructions
1. Improve H1/H2 headings for search intent and clarity (keep section ids stable).
2. Strengthen each section's \`instructions\` for value SEO: methods, costs/ranges, timelines, materials, DIY vs pro, when to call — where relevant to that section.
3. Keep \`images\` slots; improve alt/caption TODOs if photos are enabled.
4. Preserve pages and section ids unless a heading is clearly wrong.
5. Return ONLY the full updated outline JSON object (same shape). No markdown fences unless needed.

Return the complete JSON outline.`;

  return { prompt, outline };
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
  writeJson(outlinePath(candidateId), next);

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
  applyOutlineToSiteConfig(candidateId, next);
  saveMeta(candidateId, { lastContentOutlineAt: nowIso(), lastContentBriefAt: nowIso() });
  return {
    outline: next,
    brief,
    markdown: outlineToMarkdown(next),
    candidate: getCandidateDetail(candidateId),
  };
}

export function confirmContentOutline(candidateId) {
  const outline = getContentOutlinePackage(candidateId);
  if (!outline?.sections?.length) {
    throw Object.assign(new Error('No outline to confirm — Compose or paste first'), {
      status: 400,
    });
  }
  const confirmed = {
    ...outline,
    status: 'confirmed',
    confirmedAt: nowIso(),
  };
  writeJson(outlinePath(candidateId), confirmed);

  const briefPath = pathsFor(candidateId).contentBrief;
  const brief = readJson(briefPath) || {};
  writeJson(briefPath, {
    ...brief,
    status: 'confirmed',
    confirmedAt: nowIso(),
    sections: outlineToBriefSections(confirmed.sections),
    homepageSections: confirmed.homepageSections || brief.homepageSections || [],
    _ops: { ...(brief._ops || {}), confirmedAt: nowIso(), source: 'outline-confirm' },
  });
  applyOutlineToSiteConfig(candidateId, confirmed);
  saveMeta(candidateId, {
    lastContentOutlineConfirmedAt: nowIso(),
    lastContentBriefConfirmedAt: nowIso(),
  });
  return {
    outline: confirmed,
    brief: readJson(briefPath),
    markdown: outlineToMarkdown(confirmed),
    candidate: getCandidateDetail(candidateId),
  };
}

export function buildFullWritePrompt(candidateId) {
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
  const config = loadAcceptedSiteConfig(candidateId)?.config || {};
  const fileRules = buildRequiredFileRules(outline, config);
  const svcSections = (outline.sections || []).filter((s) =>
    (s.pages || []).includes('services'),
  );
  const locSections = (outline.sections || []).filter((s) =>
    (s.pages || []).includes('locations'),
  );

  const prompt = `You are an expert local SEO copywriter for a rank-and-rent service website.

## Goal
Write FULL page content that follows the confirmed OUTLINE. Prioritize helpful, specific value Google rewards: methods, cost drivers and ranges (not fake quotes), timelines, materials, DIY vs pro, when to call a pro, local proof without invented stats.

## Site config
\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

## Confirmed outline
\`\`\`json
${JSON.stringify(outline, null, 2)}
\`\`\`

## Output format
Emit markdown files using blocks:

### FILE: <path>
---
<frontmatter yaml>
---
<body markdown>

Required files for this job:
${fileRules || '- Home: `### FILE: src/content/pages/index.md`\n- About: `### FILE: src/content/pages/about.md`\n- Contact: `### FILE: src/content/pages/contact.md`'}

## Shared templates
${
  svcSections.length
    ? `- **Service pages:** Apply the svc* outline sections (${svcSections.map((s) => s.id).join(', ')}) to EVERY service FILE. Substitute the real service name for \`{serviceName}\` in headings and body.`
    : '- No service-page sections enabled.'
}
${
  locSections.length
    ? `- **Location pages:** Apply the loc* outline sections (${locSections.map((s) => s.id).join(', ')}) to EVERY location FILE. Substitute the suburb name for \`{suburb}\`.`
    : '- No location-page sections enabled.'
}

## Frontmatter expectations (homepage index.md)
- title, description, h1
- sectionHeading (intro H2)
- whyChooseUs: [{ title, description }] when whyChooseUs section enabled
- process: [{ title, description, image? }] when process/offerProcess enabled
- faqs: [{ question, answer }] when faqs enabled
- gallery: [{ src, alt }] when beforeAfter/gallery photos enabled
- **Homepage body:** write **intro prose only** (1–3 short paragraphs). Do NOT repeat whyChooseUs, process, FAQs, or the services list in the body — those belong in frontmatter / dedicated sections only.
- Do **not** repeat the h1 as the first body line.
- **Images:** omit \`heroImage\` / \`featureImage\` / \`cardImage\` when there is no real file under public/images. Never write \`heroImage: ""\`. When present use object form only:
\`\`\`yaml
heroImage:
  src: /images/example.jpg
  alt: "Descriptive alt text"
\`\`\`
- Map \`public/images/...\` outline paths to \`/images/...\` in frontmatter src.

## Frontmatter expectations (each services/*.md)
- title, description, h1, serviceName
- heroImage / cardImage only as \`{ src, alt }\` objects when photos enabled; otherwise omit
- Body: use real Markdown headings (\`##\`) for each enabled service section (What's included, process, cost, FAQs, etc.); do not echo h1 as the first body line
- Process steps: one line each as \`Step title — description\`
- FAQs: question line ending with \`?\`, then answer paragraph(s) before the next question

## Frontmatter expectations (each locations/*.md)
- title, description, h1, city, state
- heroImage only as \`{ src, alt }\` or omit
- Do not echo h1 as the first body line

## Rules
1. Honor every enabled outline section for the matching page type; skip disabled ones.
2. Use outline headings (you may lightly polish wording; replace placeholders).
3. Fill image alt/captions from outline slots; keep src paths as \`/images/...\` objects — never empty strings. Omit image fields when the file does not exist.
4. Never invent licenses, years, ratings, or review counts not in site-config.
5. Write for ${config.primaryCity || 'the city'}, ${config.state || ''} and listed suburbs.
6. Internal links between Home, About, Contact, and service/location pages when those pages are in the outline.

Return ONLY the ### FILE blocks.`;

  return { prompt, outline, config };
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
