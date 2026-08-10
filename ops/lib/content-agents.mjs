/**
 * Agentic content stages: Brief → One-shot (default) + Researcher → Outline → Writer → Editor (legacy).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import {
  extractPromptTemplate,
  getApprovedPackage,
  getCandidateDetail,
  pathsFor,
  readPromptFile,
  saveMeta,
} from './candidates.mjs';
import {
  assertContentHandoffReady,
  loadAcceptedSiteConfig,
  loadHomepageContentFromDisk,
  parseContentFileBlocks,
  validateContentBundle,
} from './content-markdown.mjs';
import { runTemplateContract } from './template-contract.mjs';
import {
  applyArchetypeDefaults,
  getArchetype,
  normalizeArchetype,
  suggestArchetype,
} from '../../scripts/lib/site-archetypes.mjs';

const ROOT = process.cwd();

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

function fillPlaceholders(text, vars) {
  let out = String(text || '');
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(value == null ? '' : String(value));
  }
  return out;
}

function slugifyId(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function uniqueServices(config, pack) {
  const fromConfig = Array.isArray(config.services) ? config.services : [];
  const fromPack = Array.isArray(pack?.suggestedServices) ? pack.suggestedServices : [];
  const seen = new Set();
  const out = [];
  for (const raw of [...fromConfig, ...fromPack]) {
    const name = String(raw || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function uniqueSuburbs(config, pack) {
  const fromConfig = Array.isArray(config.targetSuburbs) ? config.targetSuburbs : [];
  const fromPack = Array.isArray(pack?.suggestedSuburbs) ? pack.suggestedSuburbs : [];
  const seen = new Set();
  const out = [];
  for (const raw of [...fromConfig, ...fromPack]) {
    const name = String(raw || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function splitServicesForMulti(services) {
  if (!services.length) {
    return { residential: ['Primary residential offer'], commercial: [], specialty: [] };
  }
  if (services.length === 1) {
    return { residential: services, commercial: [], specialty: [] };
  }
  if (services.length === 2) {
    return { residential: [services[0]], commercial: [services[1]], specialty: [] };
  }
  const third = Math.ceil(services.length / 3);
  return {
    residential: services.slice(0, third),
    commercial: services.slice(third, third * 2),
    specialty: services.slice(third * 2),
  };
}

function loadBriefTemplate(archetypeId) {
  const id = normalizeArchetype(archetypeId);
  const full = path.join(ROOT, 'prompts', 'briefs', `${id}.json`);
  if (!existsSync(full)) {
    const err = new Error(`Brief template missing: prompts/briefs/${id}.json`);
    err.status = 400;
    throw err;
  }
  return JSON.parse(readFileSync(full, 'utf8'));
}

function serviceInstruction(archetypeId) {
  if (normalizeArchetype(archetypeId) === 'single_service') {
    return 'Format: Paragraph (100–120 words). Detail this offer with unique local entities where known. No fabricated statistics.';
  }
  return 'One paragraph description with unique entities and statistics only when supported by research/site-config — otherwise stay qualitative.';
}

function expandBriefSections(template, vars, { services, suburbs, archetypeId }) {
  const sections = [];
  const groups = splitServicesForMulti(services);
  const serviceBuckets = {
    residential: groups.residential,
    commercial: groups.commercial,
    specialty: groups.specialty,
    all: services.length ? services : [vars.primaryService],
  };

  for (const row of template.sections || []) {
    const heading = fillPlaceholders(row.heading, vars);
    const instructions = fillPlaceholders(row.instructions, vars);
    const section = {
      id: row.id || slugifyId(heading),
      level: row.level,
      heading,
      instructions,
      kind: row.kind || null,
    };
    if (row.subHeadline) {
      section.subHeadline = fillPlaceholders(row.subHeadline, vars);
    }
    sections.push(section);

    if (row.serviceSource) {
      const bucket = serviceBuckets[row.serviceSource] || [];
      for (const name of bucket) {
        sections.push({
          id: `${section.id}-${slugifyId(name)}`,
          level: 'H3',
          heading: name,
          instructions: serviceInstruction(archetypeId),
          kind: 'service',
        });
      }
    }

    if (row.expandProcess && Array.isArray(template.defaultProcess)) {
      template.defaultProcess.forEach((step, idx) => {
        sections.push({
          id: `process-${idx + 1}`,
          level: 'H3',
          heading: fillPlaceholders(step.heading, vars),
          instructions: fillPlaceholders(step.instructions, vars),
          kind: 'process',
        });
      });
    }

    if (row.expandSuburbs && suburbs.length) {
      const chunkSize = Math.max(2, Math.ceil(suburbs.length / 3));
      for (let i = 0; i < suburbs.length; i += chunkSize) {
        const chunk = suburbs.slice(i, i + chunkSize);
        const chunkIdx = Math.floor(i / chunkSize) + 1;
        sections.push({
          id: `areas-${chunkIdx}`,
          level: 'H3',
          heading: `${vars.city} area: ${chunk.join(', ')}`,
          instructions: `Brief paragraph listing these communities with local relevance: ${chunk.join(', ')}.`,
          kind: 'areas',
        });
      }
    }

    if (row.expandFaqs && Array.isArray(template.defaultFaqs)) {
      template.defaultFaqs.forEach((faq, idx) => {
        sections.push({
          id: `faq-${idx + 1}`,
          level: 'H3',
          heading: fillPlaceholders(faq.heading, vars),
          instructions: fillPlaceholders(faq.instructions, vars),
          kind: 'faq',
        });
      });
    }
  }

  return sections.filter((s) => {
    // Drop empty commercial/specialty group headers with no children already emitted
    if (s.kind === 'services_group') {
      const hasChild = sections.some(
        (other) => other.kind === 'service' && other.id.startsWith(`${s.id}-`),
      );
      return hasChild;
    }
    return true;
  });
}

function parseJsonLoose(raw) {
  if (raw && typeof raw === 'object') return raw;
  const cleaned = String(raw || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) {
      const err = new Error('Could not parse JSON');
      err.status = 400;
      throw err;
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

export function resolveSiteConfigWithArchetype(candidateId, overrideArchetype = null) {
  const { config } = assertContentHandoffReady(candidateId);
  let next = { ...config };
  if (overrideArchetype) next.siteArchetype = normalizeArchetype(overrideArchetype);
  if (!next.siteArchetype) {
    next.siteArchetype = suggestArchetype({
      services: next.services,
      niche: next.niche,
    });
  }
  next = applyArchetypeDefaults(next);
  return next;
}

function loadOutlineTemplate(archetypeId) {
  const id = normalizeArchetype(archetypeId);
  const full = path.join(ROOT, 'prompts', 'outlines', id, 'homepage.json');
  if (!existsSync(full)) {
    const err = new Error(`Outline template missing: prompts/outlines/${id}/homepage.json`);
    err.status = 400;
    throw err;
  }
  return JSON.parse(readFileSync(full, 'utf8'));
}

function fillAgentPrompt(relativePrompt, vars) {
  const md = readPromptFile(relativePrompt);
  let template = extractPromptTemplate(md);
  for (const [key, value] of Object.entries(vars)) {
    template = template.split(`{{${key}}}`).join(value == null ? '' : String(value));
  }
  return template;
}

function normalizeBriefSections(rawSections) {
  if (!Array.isArray(rawSections)) {
    const err = new Error('Brief sections must be an array');
    err.status = 400;
    throw err;
  }
  return rawSections.map((row, idx) => {
    const level = String(row.level || '').toUpperCase();
    if (!['H1', 'H2', 'H3'].includes(level)) {
      const err = new Error(`Invalid section level at index ${idx}: ${row.level}`);
      err.status = 400;
      throw err;
    }
    const heading = String(row.heading || '').trim();
    if (!heading) {
      const err = new Error(`Section heading required at index ${idx}`);
      err.status = 400;
      throw err;
    }
    return {
      id: String(row.id || `section-${idx + 1}`),
      level,
      heading,
      instructions: String(row.instructions || '').trim(),
      kind: row.kind || null,
      ...(row.subHeadline ? { subHeadline: String(row.subHeadline) } : {}),
    };
  });
}

export function getContentBrief(candidateId) {
  return readJson(pathsFor(candidateId).contentBrief);
}

export function buildContentBriefDraft(candidateId, { siteArchetype } = {}) {
  const config = resolveSiteConfigWithArchetype(candidateId, siteArchetype);
  const pack = getApprovedPackage(candidateId) || {};
  const arch = getArchetype(config.siteArchetype);
  const template = loadBriefTemplate(config.siteArchetype);
  const services = uniqueServices(config, pack);
  const suburbs = uniqueSuburbs(config, pack);
  const primaryService = services[0] || config.niche || 'Primary service';
  const vars = {
    businessName: config.businessName || 'Your Company',
    niche: config.niche || pack.niche || 'Local service',
    city: config.primaryCity || pack.city || 'Your City',
    state: config.state || pack.state || '',
    primaryService,
  };
  const sections = expandBriefSections(template, vars, {
    services,
    suburbs,
    archetypeId: config.siteArchetype,
  });
  const now = new Date().toISOString();
  const brief = {
    status: 'draft',
    confirmedAt: null,
    siteArchetype: config.siteArchetype,
    mode: 'homepage_first',
    meta: {
      pageType: template.pageType || 'Homepage / Primary Service Landing Page',
      geography: [vars.city, vars.state].filter(Boolean).join(', '),
      niche: vars.niche,
      businessName: vars.businessName,
      primaryService,
    },
    sections,
    source: {
      template: template.template || (config.siteArchetype === 'single_service' ? 'specialty' : 'multi_service'),
      fromApproved: Boolean(pack && Object.keys(pack).length),
      fromSiteConfig: true,
    },
    _ops: { savedAt: now, confirmedAt: null, source: 'draft' },
  };
  writeJson(pathsFor(candidateId).contentBrief, brief);
  saveMeta(candidateId, {
    lastContentBriefAt: now,
    siteArchetype: config.siteArchetype,
  });
  return {
    ok: true,
    brief,
    config,
    archetype: arch,
    candidate: getCandidateDetail(candidateId),
  };
}

export function saveContentBrief(candidateId, body = {}) {
  assertContentHandoffReady(candidateId);
  const p = pathsFor(candidateId);
  const existing = readJson(p.contentBrief) || {};
  const config = resolveSiteConfigWithArchetype(
    candidateId,
    body.siteArchetype || existing.siteArchetype,
  );
  const sections = normalizeBriefSections(body.sections ?? existing.sections ?? []);
  const now = new Date().toISOString();
  const wasConfirmed = existing.status === 'confirmed';
  const brief = {
    status: 'draft',
    confirmedAt: null,
    siteArchetype: config.siteArchetype,
    mode: body.mode || existing.mode || 'homepage_first',
    meta: {
      pageType:
        body.meta?.pageType ||
        existing.meta?.pageType ||
        'Homepage / Primary Service Landing Page',
      geography:
        body.meta?.geography ||
        existing.meta?.geography ||
        [config.primaryCity, config.state].filter(Boolean).join(', '),
      niche: body.meta?.niche || existing.meta?.niche || config.niche || '',
      businessName:
        body.meta?.businessName || existing.meta?.businessName || config.businessName || '',
      primaryService: body.meta?.primaryService || existing.meta?.primaryService || '',
    },
    sections,
    source: existing.source || {
      template: config.siteArchetype === 'single_service' ? 'specialty' : 'multi_service',
      fromApproved: true,
      fromSiteConfig: true,
    },
    _ops: {
      savedAt: now,
      confirmedAt: null,
      source: wasConfirmed ? 'edited_after_confirm' : existing._ops?.source || 'save',
    },
  };
  writeJson(p.contentBrief, brief);
  saveMeta(candidateId, {
    lastContentBriefAt: now,
    siteArchetype: config.siteArchetype,
  });
  return { ok: true, brief, candidate: getCandidateDetail(candidateId) };
}

export function confirmContentBrief(candidateId, body = {}) {
  assertContentHandoffReady(candidateId);
  const p = pathsFor(candidateId);
  let brief = readJson(p.contentBrief);
  if (!brief && body.sections) {
    saveContentBrief(candidateId, body);
    brief = readJson(p.contentBrief);
  }
  if (!brief?.sections?.length) {
    const err = new Error('Generate or save a content brief before confirming');
    err.status = 400;
    throw err;
  }
  if (body.sections) {
    const saved = saveContentBrief(candidateId, body);
    brief = saved.brief;
  }
  const now = new Date().toISOString();
  brief = {
    ...brief,
    status: 'confirmed',
    confirmedAt: now,
    _ops: {
      ...(brief._ops || {}),
      savedAt: now,
      confirmedAt: now,
      source: 'confirm',
    },
  };
  writeJson(p.contentBrief, brief);
  saveMeta(candidateId, {
    lastContentBriefAt: now,
    lastContentBriefConfirmedAt: now,
  });
  return { ok: true, brief, candidate: getCandidateDetail(candidateId) };
}

export function buildOnesHotPrompt(candidateId, { siteArchetype, mode = 'homepage_first' } = {}) {
  const config = resolveSiteConfigWithArchetype(candidateId, siteArchetype);
  const arch = getArchetype(config.siteArchetype);
  const brief = readJson(pathsFor(candidateId).contentBrief);
  if (!brief?.sections?.length) {
    const err = new Error('Generate a content brief before one-shot write');
    err.status = 400;
    throw err;
  }
  if (brief.status !== 'confirmed') {
    const err = new Error('Confirm the content brief before copying the one-shot prompt');
    err.status = 400;
    throw err;
  }
  const { _ops, ...cleanBrief } = brief;
  const prompt = fillAgentPrompt('prompts/agents/content-oneshot.md', {
    SITE_CONFIG_JSON: JSON.stringify(config, null, 2),
    CONTENT_BRIEF_JSON: JSON.stringify(cleanBrief, null, 2),
    SITE_ARCHETYPE: config.siteArchetype,
    ARCHETYPE_LABEL: `${arch.typeLabel} — ${arch.label}`,
    HOMEPAGE_SECTIONS: (config.homepageSections || arch.homepageSections).join(', '),
  });
  return { prompt, config, mode, brief: cleanBrief, archetype: arch };
}

export function buildResearcherPrompt(candidateId, { siteArchetype } = {}) {
  const detail = getCandidateDetail(candidateId);
  const config = resolveSiteConfigWithArchetype(candidateId, siteArchetype);
  const arch = getArchetype(config.siteArchetype);
  const prompt = fillAgentPrompt('prompts/agents/content-researcher.md', {
    SITE_CONFIG_JSON: JSON.stringify(config, null, 2),
    RESEARCH_JSON: JSON.stringify(detail.research || {}, null, 2),
    SITE_ARCHETYPE: config.siteArchetype,
    ARCHETYPE_LABEL: `${arch.typeLabel} — ${arch.label}`,
  });
  return { prompt, config, archetype: arch };
}

export function pasteContentResearch(candidateId, raw) {
  assertContentHandoffReady(candidateId);
  const value = parseJsonLoose(raw);
  const p = pathsFor(candidateId);
  writeJson(p.contentResearch, {
    ...value,
    _ops: { savedAt: new Date().toISOString(), source: 'paste' },
  });
  saveMeta(candidateId, { lastContentResearchAt: new Date().toISOString() });
  return { ok: true, research: readJson(p.contentResearch), candidate: getCandidateDetail(candidateId) };
}

export function buildOutlinePrompt(candidateId, { siteArchetype } = {}) {
  const config = resolveSiteConfigWithArchetype(candidateId, siteArchetype);
  const arch = getArchetype(config.siteArchetype);
  const outlineTemplate = loadOutlineTemplate(config.siteArchetype);
  const research = readJson(pathsFor(candidateId).contentResearch) || {
    note: 'No researcher pack yet — outline from site-config + default template only',
  };
  const { _ops, ...cleanResearch } = research;
  const prompt = fillAgentPrompt('prompts/agents/content-outline.md', {
    SITE_CONFIG_JSON: JSON.stringify(config, null, 2),
    CONTENT_RESEARCH_JSON: JSON.stringify(cleanResearch, null, 2),
    OUTLINE_TEMPLATE_JSON: JSON.stringify(outlineTemplate, null, 2),
    SITE_ARCHETYPE: config.siteArchetype,
    ARCHETYPE_LABEL: `${arch.typeLabel} — ${arch.label}`,
  });
  return { prompt, config, outlineTemplate, archetype: arch };
}

export function pasteContentOutline(candidateId, raw) {
  assertContentHandoffReady(candidateId);
  const value = parseJsonLoose(raw);
  const p = pathsFor(candidateId);
  const config = resolveSiteConfigWithArchetype(candidateId, value.archetype);
  writeJson(p.contentOutline, {
    ...value,
    archetype: config.siteArchetype,
    _ops: { savedAt: new Date().toISOString(), source: 'paste' },
  });
  saveMeta(candidateId, {
    lastContentOutlineAt: new Date().toISOString(),
    siteArchetype: config.siteArchetype,
  });
  return { ok: true, outline: readJson(p.contentOutline), candidate: getCandidateDetail(candidateId) };
}

export function seedDefaultOutline(candidateId, { siteArchetype } = {}) {
  const config = resolveSiteConfigWithArchetype(candidateId, siteArchetype);
  const template = loadOutlineTemplate(config.siteArchetype);
  const outline = {
    archetype: config.siteArchetype,
    page: 'homepage',
    mode: 'homepage_first',
    h1: `${config.niche} in ${config.primaryCity}, ${config.state}`,
    sectionHeading: config.tagline || config.niche,
    sections: template.sections || [],
    faqSeeds: [],
    processStepTitles: [],
    whyChooseTitles: [],
    notes: 'Seeded from default outline template — edit before Writer',
    _ops: { savedAt: new Date().toISOString(), source: 'seed' },
  };
  writeJson(pathsFor(candidateId).contentOutline, outline);
  saveMeta(candidateId, {
    lastContentOutlineAt: new Date().toISOString(),
    siteArchetype: config.siteArchetype,
  });
  return { ok: true, outline, candidate: getCandidateDetail(candidateId) };
}

export function buildWriterPrompt(candidateId, { siteArchetype, mode = 'homepage_first' } = {}) {
  const config = resolveSiteConfigWithArchetype(candidateId, siteArchetype);
  const arch = getArchetype(config.siteArchetype);
  const p = pathsFor(candidateId);
  const outline = readJson(p.contentOutline);
  if (!outline) {
    const err = new Error('Paste or seed an outline before Writer');
    err.status = 400;
    throw err;
  }
  const research = readJson(p.contentResearch) || {};
  const { _ops: _o1, ...cleanOutline } = outline;
  const { _ops: _o2, ...cleanResearch } = research;
  const prompt = fillAgentPrompt('prompts/agents/content-writer.md', {
    SITE_CONFIG_JSON: JSON.stringify(config, null, 2),
    CONTENT_OUTLINE_JSON: JSON.stringify(cleanOutline, null, 2),
    CONTENT_RESEARCH_JSON: JSON.stringify(cleanResearch, null, 2),
    SITE_ARCHETYPE: config.siteArchetype,
    ARCHETYPE_LABEL: `${arch.typeLabel} — ${arch.label}`,
    HOMEPAGE_SECTIONS: (config.homepageSections || arch.homepageSections).join(', '),
  });
  return { prompt, config, mode, archetype: arch };
}

export function buildEditorPrompt(candidateId) {
  const detail = getCandidateDetail(candidateId);
  const draft = detail.contentDraft;
  if (!draft?.files) {
    const err = new Error('No content draft to edit — run Writer paste first');
    err.status = 400;
    throw err;
  }
  const config = resolveSiteConfigWithArchetype(candidateId);
  const arch = getArchetype(config.siteArchetype);
  const blocks = Object.entries(draft.files)
    .map(([rel, body]) => `### FILE: ${rel}\n${body.trim()}\n`)
    .join('\n');
  const prompt = fillAgentPrompt('prompts/agents/content-editor.md', {
    SITE_ARCHETYPE: config.siteArchetype,
    CONTENT_DRAFT_TEXT: blocks,
  });
  return { prompt, config, archetype: arch };
}

/**
 * Paste Writer or Editor FILE blocks into content draft (homepage_first aware).
 */
export function pasteAgentContentDraft(candidateId, raw, { mode = 'homepage_first' } = {}) {
  const config = resolveSiteConfigWithArchetype(candidateId);
  const files = parseContentFileBlocks(raw);
  const check = validateContentBundle(files, config, { mode });
  const contract = runTemplateContract(files, config, { mode });
  const p = pathsFor(candidateId);
  writeJson(p.contentDraft, {
    files,
    _ops: {
      savedAt: new Date().toISOString(),
      source: 'agent_paste',
      mode,
      siteArchetype: config.siteArchetype,
      check,
      contract,
      fileList: Object.keys(files).sort(),
    },
  });
  saveMeta(candidateId, { lastContentDraftAt: new Date().toISOString() });
  return {
    ok: true,
    draft: readJson(p.contentDraft),
    check,
    contract,
    candidate: getCandidateDetail(candidateId),
  };
}

/**
 * Import live src/content markdown into research/{id}-content.draft.json
 * (Claude Code wrote disk; ops rehydrates the candidate draft — does not Accept).
 */
export function importContentDraftFromDisk(candidateId, { mode = 'homepage_first' } = {}) {
  const config = resolveSiteConfigWithArchetype(candidateId);
  const files = loadHomepageContentFromDisk(mode);
  const check = validateContentBundle(files, config, { mode });
  const contract = runTemplateContract(files, config, { mode });
  const p = pathsFor(candidateId);
  writeJson(p.contentDraft, {
    files,
    _ops: {
      savedAt: new Date().toISOString(),
      source: 'import_disk',
      mode,
      siteArchetype: config.siteArchetype,
      check,
      contract,
      fileList: Object.keys(files).sort(),
      note: 'Imported from live src/content into candidate draft — not yet Accepted',
    },
  });
  saveMeta(candidateId, { lastContentDraftAt: new Date().toISOString() });
  return {
    ok: true,
    draft: readJson(p.contentDraft),
    check,
    contract,
    candidate: getCandidateDetail(candidateId),
  };
}
