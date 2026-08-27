/**
 * Eight-pass Content Soft path helpers: guardrails, field research, brief synthesis,
 * batched full-write, final check, GBP category checklist.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCandidateDetail,
  pathsFor,
  RESEARCH_DIR,
} from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { parseJsonLoose } from './claude.mjs';
import {
  buildCityContextPackage,
  cityContextPromptRules,
  compactCityContextForPrompt,
  getCachedCityContext,
} from './city-context.mjs';
import {
  buildFullWritePrompt,
  getContentOutlinePackage,
  getContentStructure,
} from './content-structure.mjs';
import { getContentBrief, saveContentBrief, confirmContentBrief } from './content-agents.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AGENTS = path.join(ROOT, 'prompts', 'agents');

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

/** Unwrap claude.parseJsonLoose `{ ok, value }` or pass through an already-parsed object. */
function parsePasteObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    // Accidental wrapper from a prior buggy path
    if (
      Object.prototype.hasOwnProperty.call(raw, 'ok') &&
      Object.prototype.hasOwnProperty.call(raw, 'value') &&
      raw.value &&
      typeof raw.value === 'object' &&
      !Array.isArray(raw.value)
    ) {
      return raw.value;
    }
    return raw;
  }
  const parsed = parseJsonLoose(String(raw || ''));
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    throw Object.assign(new Error('Could not parse JSON. Paste the full Claude object.'), {
      status: 400,
    });
  }
  return parsed.value;
}

function readAgentTemplate(name) {
  const filePath = path.join(AGENTS, name);
  const raw = readFileSync(filePath, 'utf8');
  const m = raw.match(/```text\n([\s\S]*?)```/);
  if (!m) {
    throw Object.assign(new Error(`Agent template missing text block: ${name}`), { status: 500 });
  }
  return m[1].trim();
}

function fillPlaceholders(template, vars = {}) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value == null ? '' : String(value));
  }
  return out;
}

export function fieldResearchPath(candidateId) {
  return path.join(RESEARCH_DIR, `${pathsFor(candidateId).id}-content-field-research.json`);
}

export function getContentFieldResearch(candidateId) {
  return readJson(fieldResearchPath(candidateId));
}

export function loadContentGuardrails(config = {}) {
  const stub = readAgentTemplate('content-guardrails.md');
  return fillPlaceholders(stub, {
    BUSINESS_NAME: config.businessName || 'Business',
    NICHE: config.niche || 'service',
    PRIMARY_CITY: config.primaryCity || 'City',
    STATE: config.state || 'ST',
  });
}

function businessJson(config = {}) {
  return JSON.stringify(
    {
      businessName: config.businessName,
      niche: config.niche,
      primaryCity: config.primaryCity,
      state: config.state,
      domain: config.domain,
      phone: config.phone,
      services: config.services,
      targetSuburbs: config.targetSuburbs,
      primaryCta: config.primaryCta,
    },
    null,
    2,
  );
}

function outlineSeoSeeds(outline = {}) {
  return {
    keywordTargets: outline.keywordTargets || [],
    faqSeeds: outline.faqSeeds || [],
    organicTitleHints: outline.organicTitleHints || [],
    keywords: outline.keywords || {},
  };
}

async function cityBlock(candidateId) {
  let cityContext = getCachedCityContext(candidateId);
  try {
    cityContext = await buildCityContextPackage(candidateId);
  } catch {
    // soft
  }
  const compact = compactCityContextForPrompt(cityContext);
  return {
    compact,
    block: `${cityContextPromptRules()}\n\n\`\`\`json\n${JSON.stringify(compact || { note: 'unavailable' }, null, 2)}\n\`\`\``,
  };
}

function ensureOutlineForSeeds(candidateId) {
  const outline = getContentOutlinePackage(candidateId);
  if (outline?.sections?.length) return outline;
  const structure = getContentStructure(candidateId);
  if (!structure?.sections?.length) {
    throw Object.assign(
      new Error('Compose Structure first (Continue from Structure) before Field research'),
      { status: 400 },
    );
  }
  return {
    sections: [],
    keywordTargets: structure.keywordTargets || [],
    faqSeeds: structure.faqSeeds || [],
    organicTitleHints: structure.organicTitleHints || [],
    keywords: structure.keywords || {},
  };
}

export async function buildFieldResearchPrompt(candidateId, { operatorNotes = '' } = {}) {
  const config = loadAcceptedSiteConfig(candidateId)?.config;
  if (!config) {
    throw Object.assign(new Error('Accept Site config before Field research'), { status: 400 });
  }
  const outline = ensureOutlineForSeeds(candidateId);
  const seeds = outlineSeoSeeds(outline);
  const { block } = await cityBlock(candidateId);
  const guardrails = loadContentGuardrails(config);
  const template = readAgentTemplate('content-field-research.md');
  const prompt = fillPlaceholders(template, {
    CONTENT_GUARDRAILS: guardrails,
    BUSINESS_JSON: businessJson(config),
    KEYWORD_TARGETS_JSON: JSON.stringify(seeds.keywordTargets, null, 2),
    FAQ_SEEDS_JSON: JSON.stringify(seeds.faqSeeds, null, 2),
    ORGANIC_TITLE_HINTS_JSON: JSON.stringify(seeds.organicTitleHints, null, 2),
    CITY_CONTEXT_BLOCK: block,
    OPERATOR_NOTES: String(operatorNotes || '').trim() || '(none)',
  });
  return { prompt, config };
}

export function saveContentFieldResearch(candidateId, raw, { operatorNotes = '' } = {}) {
  const parsed = parsePasteObject(raw);
  const questions = Array.isArray(parsed.homeownerQuestions) ? parsed.homeownerQuestions : [];
  if (questions.length < 3) {
    throw Object.assign(
      new Error(
        `Field research needs at least 3 homeownerQuestions (found ${questions.length}). Key must be "homeownerQuestions".`,
      ),
      { status: 400 },
    );
  }
  const record = {
    ...parsed,
    operatorNotes: String(operatorNotes || parsed.operatorNotes || '').trim() || '',
    status: 'loaded',
    loadedAt: new Date().toISOString(),
    _ops: { source: 'claude-field-research' },
  };
  writeJson(fieldResearchPath(candidateId), record);
  return { ok: true, fieldResearch: record, candidate: getCandidateDetail(candidateId) };
}

export async function buildSoftBriefPrompt(candidateId, { operatorNotes = '' } = {}) {
  const config = loadAcceptedSiteConfig(candidateId)?.config;
  if (!config) {
    throw Object.assign(new Error('Accept Site config before Brief'), { status: 400 });
  }
  const field = getContentFieldResearch(candidateId);
  if (!field || field.status !== 'loaded') {
    throw Object.assign(new Error('Load Field research before copying the Brief prompt'), {
      status: 400,
    });
  }
  const structure = getContentStructure(candidateId);
  if (!structure?.sections?.length && !getContentOutlinePackage(candidateId)?.sections?.length) {
    throw Object.assign(new Error('Compose Structure first'), { status: 400 });
  }
  const outline = getContentOutlinePackage(candidateId) || {};
  const seeds = outlineSeoSeeds(outline);
  const { block } = await cityBlock(candidateId);
  const guardrails = loadContentGuardrails(config);
  const notes = String(operatorNotes || field.operatorNotes || '').trim() || '(none)';
  const template = readAgentTemplate('content-brief.md');
  const archetype =
    Array.isArray(config.services) && config.services.length > 1 ? 'multi_service' : 'single_service';
  const prompt = fillPlaceholders(template, {
    CONTENT_GUARDRAILS: guardrails,
    BUSINESS_JSON: businessJson(config),
    STRUCTURE_JSON: JSON.stringify(
      {
        pages: structure?.pages || outline.pages || null,
        sections: (structure?.sections || outline.sections || []).map((s) =>
          typeof s === 'string' ? s : { id: s.id, heading: s.heading, pages: s.pages },
        ),
      },
      null,
      2,
    ),
    KEYWORD_TARGETS_JSON: JSON.stringify(seeds.keywordTargets, null, 2),
    FAQ_SEEDS_JSON: JSON.stringify(seeds.faqSeeds, null, 2),
    ORGANIC_TITLE_HINTS_JSON: JSON.stringify(seeds.organicTitleHints, null, 2),
    VOLUME_HINTS_JSON: JSON.stringify(seeds.keywords, null, 2),
    FIELD_RESEARCH_JSON: JSON.stringify(field, null, 2),
    OPERATOR_NOTES: notes,
    CITY_CONTEXT_BLOCK: block,
    SITE_ARCHETYPE: archetype,
  });
  return { prompt, fieldResearch: field, config };
}

export function pasteAndConfirmSoftBrief(candidateId, raw) {
  const parsed = parsePasteObject(raw);
  if (!Array.isArray(parsed.pages) || parsed.pages.length < 1) {
    throw Object.assign(new Error('Brief must include pages[]'), { status: 400 });
  }
  const config = loadAcceptedSiteConfig(candidateId)?.config || {};
  const archetype =
    Array.isArray(config.services) && config.services.length > 1 ? 'multi_service' : 'single_service';
  saveContentBrief(candidateId, {
    ...parsed,
    status: 'draft',
    siteArchetype: parsed.siteArchetype || archetype,
    meta: {
      niche: config.niche,
      primaryCity: config.primaryCity,
      state: config.state,
      businessName: config.businessName,
      ...(parsed.meta || {}),
    },
    mode: parsed.mode || 'eight_pass',
    source: { kind: 'soft-brief-paste' },
  });
  const confirmed = confirmContentBrief(candidateId, {});
  const brief = confirmed.brief || getContentBrief(candidateId);
  if (!Array.isArray(brief?.pages) || brief.pages.length < 1) {
    throw Object.assign(
      new Error('Soft brief confirm failed to persist pages[] — re-paste Pass 1 JSON'),
      { status: 500 },
    );
  }
  return confirmed;
}

export function formatBriefForPrompt(candidateId) {
  const brief = getContentBrief(candidateId);
  if (!brief) return '(no brief)';
  const clean = { ...brief };
  delete clean._ops;
  return JSON.stringify(clean, null, 2);
}

export function formatFieldResearchForPrompt(candidateId) {
  const field = getContentFieldResearch(candidateId);
  if (!field) return '(no field research)';
  const clean = { ...field };
  delete clean._ops;
  return JSON.stringify(clean, null, 2);
}

export function injectEightPassContext(candidateId) {
  const config = loadAcceptedSiteConfig(candidateId)?.config || {};
  const guardrails = loadContentGuardrails(config);
  const brief = getContentBrief(candidateId);
  const field = getContentFieldResearch(candidateId);
  const briefBlock =
    brief?.status === 'confirmed'
      ? `## Confirmed content brief (Pass 1)\n\`\`\`json\n${formatBriefForPrompt(candidateId)}\n\`\`\`\n`
      : '';
  const fieldBlock = field
    ? `## Field research\n\`\`\`json\n${formatFieldResearchForPrompt(candidateId)}\n\`\`\`\n`
    : '';
  return {
    guardrails,
    prefix: `${guardrails}\n\n${fieldBlock}${briefBlock}`.trim(),
    brief,
    field,
  };
}

export async function buildBatchedFullWritePrompt(candidateId, batch = 'all') {
  const base = await buildFullWritePrompt(candidateId);
  const normalized = String(batch || 'all').toLowerCase();
  if (!['home', 'services', 'locations', 'all'].includes(normalized)) {
    throw Object.assign(new Error('batch must be home|services|locations|all'), { status: 400 });
  }

  const tone = `
## Batch / tone variance (Pass 3)
- This is the **${normalized}** batch. Write ONLY the FILE paths for this batch (listed below if filtered).
- Write each H2 section with a slightly fresh voice — do not match the cadence of a previous batch.
- Vary sentence length (long, short, fragment). Prefer commas over em dashes.
- Bookends on every FILE: first two + last two body sentences conversational; closing nudge to call / free estimate where natural.
`;

  const pagePack =
    normalized === 'home'
      ? `
## Page-type pack — HOME (and about/contact in this batch)
- Home = primary niche + city entity. H1 owns the head term; supporting keywords land in distinct H2s.
- Conversion: clear call / free-estimate CTA near the close; use site-config phone when mentioning a number.
- Educational sections: specific methods, cost drivers, timelines — not generic filler.
- About/contact: trust + NAP honesty from site-config only — never +1XXXXXXXXXX or @example.com placeholders.
- Burstiness: open with a short punch (problem or question), then longer specifics.
`
      : normalized === 'services'
        ? `
## Page-type pack — SERVICES
- Each service FILE = one offer entity. Service is the central entity; city is secondary (one natural mention OK).
- Dual-source: process/FAQs/cost live in body ## sections (not homepage FM arrays).
- Conversion: closing CTA per service page; link back to home and related locations.
- Bookends: do not open with a flat “{Service} covers…” template — lead with a homeowner-visible problem or decision.
- Burstiness: mix short steps/punch lines with longer method paragraphs; avoid identical cadence across every service FILE.
- Do not invent services beyond site-config.
`
        : normalized === 'locations'
          ? `
## Page-type pack — LOCATIONS
- Geo proof only for real primary + suburb cities from site-config. No landmark page factories.
- Primary city page must not cannibalize homepage H1/title (neighborhoods angle, niche still present).
- Local conditions from city-context; weave landmarks only as flavor inside existing pages.
- Link to home + relevant services; avoid thin duplicate suburb bodies.
- Burstiness: break long location essays — short local cues + longer climate/housing notes; do not copy-paste one paragraph rhythm for every suburb.
- Bookends: first lines feel place-specific; last lines CTA without repeating the same stock closer on every location FILE.
`
          : `
## Page-type pack — ALL
- Apply home / service / location rules per FILE path. Keep entity matching: home = niche+city, services = offers, locations = geo proof.
- Burstiness + bookends on every FILE; NAP only from site-config.
`;

  let prompt = `${tone}\n${pagePack}\n\n${base.prompt}`;

  if (normalized !== 'all') {
    const outline = base.outline || {};
    const config = base.config || {};
    const keep = filterFileRulesForBatch(outline, config, normalized);
    prompt += `\n\n## BATCH FILTER (${normalized})\nEmit ONLY these FILE paths this turn:\n${keep.markdown}\nDo not emit other site FILEs in this reply.\n`;
    return {
      ...base,
      prompt,
      batch: normalized,
      requiredFileCount: keep.count,
      batchFiles: keep.paths,
    };
  }

  return { ...base, prompt, batch: 'all' };
}

function filterFileRulesForBatch(outline, config, batch) {
  const pages = outline.pages || {};
  const paths = [];
  const lines = [];
  const add = (label, rel) => {
    paths.push(rel);
    lines.push(`- ${label}: \`### FILE: ${rel}\``);
  };

  if (batch === 'home') {
    if (pages.home !== false) add('Home', 'src/content/pages/index.md');
    if (pages.about) add('About', 'src/content/pages/about.md');
    if (pages.contact) add('Contact', 'src/content/pages/contact.md');
  } else if (batch === 'services') {
    for (const svc of config.services || []) {
      const name = typeof svc === 'string' ? svc : svc?.name;
      if (!name) continue;
      const slug = String(name)
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      add(name, `src/content/services/${slug}.md`);
    }
  } else if (batch === 'locations') {
    const primary = config.primaryCity;
    const suburbs = config.targetSuburbs || [];
    const cities = [primary, ...suburbs].filter(Boolean);
    const seen = new Set();
    for (const city of cities) {
      const slug = String(city)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      if (seen.has(slug)) continue;
      seen.add(slug);
      add(city, `src/content/locations/${slug}.md`);
    }
  }

  if (!paths.length) {
    throw Object.assign(
      new Error(`No files for batch "${batch}" — enable those pages in Structure / site-config`),
      { status: 400 },
    );
  }
  return { paths, count: paths.length, markdown: lines.join('\n') };
}

export function markWriteBatchComplete(candidateId, batch) {
  const draftPath = pathsFor(candidateId).contentDraft;
  const draft = readJson(draftPath);
  if (!draft) {
    throw Object.assign(new Error('Load FILE blocks as draft before marking a batch complete'), {
      status: 400,
    });
  }
  const key = String(batch || '').toLowerCase();
  if (!['home', 'services', 'locations', 'all'].includes(key)) {
    throw Object.assign(new Error('Invalid batch'), { status: 400 });
  }
  const batches = { ...(draft._ops?.writeBatches || {}) };
  batches[key] = new Date().toISOString();
  if (key === 'all') {
    batches.home = batches.home || batches.all;
    batches.services = batches.services || batches.all;
    batches.locations = batches.locations || batches.all;
  }
  draft._ops = { ...(draft._ops || {}), writeBatches: batches };
  writeJson(draftPath, draft);
  return { ok: true, writeBatches: batches, candidate: getCandidateDetail(candidateId) };
}

/** Infer completed write batches from files present on the draft. */
export function syncWriteBatchesFromDraft(candidateId) {
  const draftPath = pathsFor(candidateId).contentDraft;
  const draft = readJson(draftPath);
  if (!draft?.files) return { ok: false, writeBatches: {} };
  const files = Object.keys(draft.files);
  const batches = { ...(draft._ops?.writeBatches || {}) };
  const now = new Date().toISOString();
  if (files.some((f) => /pages\/(index|about|contact)\.md$/i.test(f))) {
    batches.home = batches.home || now;
  }
  if (files.some((f) => /\/services\//i.test(f))) {
    batches.services = batches.services || now;
  }
  if (files.some((f) => /\/locations\//i.test(f))) {
    batches.locations = batches.locations || now;
  }
  draft._ops = { ...(draft._ops || {}), writeBatches: batches };
  writeJson(draftPath, draft);
  return { ok: true, writeBatches: batches, candidate: getCandidateDetail(candidateId) };
}

export function getWriteBatchStatus(candidateId, detail = null) {
  const d = detail || getCandidateDetail(candidateId);
  const draft = d?.contentDraft || d?.content;
  const batches = draft?._ops?.writeBatches || {};
  const outline = d?.contentOutlinePackage;
  const config = d?.siteConfig || {};
  const pages = outline?.pages || {};
  const needHome = pages.home !== false;
  const needServices = Boolean(pages.services) && (config.services || []).length > 0;
  const needLocations =
    Boolean(pages.locations) &&
    [config.primaryCity, ...(config.targetSuburbs || [])].filter(Boolean).length > 0;
  const complete = {
    home: needHome ? Boolean(batches.home || batches.all) : true,
    services: needServices ? Boolean(batches.services || batches.all) : true,
    locations: needLocations ? Boolean(batches.locations || batches.all) : true,
  };
  return {
    needHome,
    needServices,
    needLocations,
    batches,
    complete,
    allComplete: complete.home && complete.services && complete.locations,
  };
}

export async function buildFinalCheckPrompt(candidateId) {
  const config = loadAcceptedSiteConfig(candidateId)?.config;
  if (!config) throw Object.assign(new Error('Accept Site config first'), { status: 400 });
  const brief = getContentBrief(candidateId);
  if (brief?.status !== 'confirmed') {
    throw Object.assign(new Error('Confirm Content brief before Final check'), { status: 400 });
  }
  const outline = getContentOutlinePackage(candidateId);
  if (outline?.status !== 'confirmed') {
    throw Object.assign(new Error('Confirm Outline before Final check'), { status: 400 });
  }
  const draft = readJson(pathsFor(candidateId).contentDraft);
  if (!draft?.files) {
    throw Object.assign(new Error('Load a content draft before Final check'), { status: 400 });
  }
  const fileText = Object.entries(draft.files)
    .map(([rel, body]) => `### FILE: ${rel}\n${body}`)
    .join('\n\n');
  const guardrails = loadContentGuardrails(config);
  const template = readAgentTemplate('content-final-check.md');
  const prompt = fillPlaceholders(template, {
    CONTENT_GUARDRAILS: guardrails,
    BRIEF_JSON: formatBriefForPrompt(candidateId),
    OUTLINE_JSON: JSON.stringify(outline, null, 2),
    CONTENT_DRAFT_TEXT: fileText,
  });
  return { prompt, brief, outline };
}

export function stampFinalCheck(candidateId, { ok = true, summary = '' } = {}) {
  const draftPath = pathsFor(candidateId).contentDraft;
  const draft = readJson(draftPath);
  if (!draft) {
    throw Object.assign(new Error('No content draft to stamp Final check'), { status: 400 });
  }
  draft._ops = {
    ...(draft._ops || {}),
    lastFinalCheckAt: new Date().toISOString(),
    lastFinalCheckOk: Boolean(ok),
    lastFinalCheckSummary: String(summary || ''),
  };
  writeJson(draftPath, draft);
  return { ok: true, candidate: getCandidateDetail(candidateId) };
}

export async function buildBookendsOnlyPrompt(candidateId) {
  const config = loadAcceptedSiteConfig(candidateId)?.config || {};
  const draft = readJson(pathsFor(candidateId).contentDraft);
  if (!draft?.files) {
    throw Object.assign(new Error('No draft for bookends pass'), { status: 400 });
  }
  const guardrails = loadContentGuardrails(config);
  const prefer = Object.keys(draft.files).filter(
    (f) => f.includes('/pages/index.md') || f.includes('/services/'),
  );
  const pick = prefer.length ? prefer.slice(0, 4) : Object.keys(draft.files).slice(0, 3);
  const text = pick.map((rel) => `### FILE: ${rel}\n${draft.files[rel]}`).join('\n\n');
  const prompt = `${guardrails}

You are doing the HUMAN BOOKENDS pass only (Pass 6).

Rewrite the **first two sentences** and the **last two sentences** of each FILE body (after frontmatter) with conversational, opinionated contractor voice. Keep the middle intact unless a bookend forces a tiny bridge edit.

Phone / CTA language is welcome in the closing bookend when natural.

FILES:
${text}

Return ### FILE blocks for files you changed only.`;
  return { prompt };
}

export function buildGbpCategoryPrompt(candidateId) {
  const config = loadAcceptedSiteConfig(candidateId)?.config;
  if (!config) {
    throw Object.assign(new Error('Accept Site config first'), { status: 400 });
  }
  const template = readAgentTemplate('gbp-category-checklist.md');
  const prompt = fillPlaceholders(template, {
    NICHE: config.niche || '',
    PRIMARY_CITY: config.primaryCity || '',
    STATE: config.state || '',
    SERVICES_JSON: JSON.stringify(config.services || [], null, 2),
    BUSINESS_NAME: config.businessName || '',
  });
  return { prompt, config };
}

export function saveGbpCategoryChecklist(candidateId, raw) {
  const parsed = parsePasteObject(raw);
  if (!parsed?.primaryCategory) {
    throw Object.assign(new Error('GBP checklist needs primaryCategory'), { status: 400 });
  }
  const filePath = path.join(RESEARCH_DIR, `${pathsFor(candidateId).id}-gbp-categories.json`);
  const record = { ...parsed, savedAt: new Date().toISOString() };
  writeJson(filePath, record);
  return { ok: true, gbpCategories: record, candidate: getCandidateDetail(candidateId) };
}
