/**
 * Agentic content stages: Researcher → Outline → Writer → Editor prompts + paste.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import {
  extractPromptTemplate,
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
