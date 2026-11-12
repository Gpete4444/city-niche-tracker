/**
 * Zone planning guide.
 * Source is the paste. Distill writes a proposed brief. Prompts read only the accepted brief.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { registerNarrativeZoneGuide } from './candidates.mjs';
import {
  clusterForCandidate,
  loadShotgunDraft,
  saveShotgunDraft,
  setZonePlanningGuideUpdatedAt,
} from './shotgun.mjs';

const ROOT = process.cwd();
const RESEARCH_DIR = path.join(ROOT, 'research');

let guidesDirOverride = null;

export function setZoneGuidesDirForTests(dir) {
  guidesDirOverride = dir ? path.resolve(dir) : null;
}

function guidesDir() {
  return guidesDirOverride || path.join(RESEARCH_DIR, 'zone-guides');
}

function safeId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function assertScope(kind, id) {
  const scope = String(kind || '').trim();
  const key = safeId(id);
  if (scope !== 'batch' && scope !== 'zone') {
    throw Object.assign(new Error('Guide scope must be batch or zone'), { status: 400 });
  }
  if (!key) throw Object.assign(new Error('Guide id is required'), { status: 400 });
  return { kind: scope, id: key };
}

function guidePaths(kind, id) {
  const scope = assertScope(kind, id);
  const base = path.join(guidesDir(), `${scope.kind}__${scope.id}`);
  return {
    ...scope,
    source: `${base}.md`,
    proposed: `${base}.proposed.md`,
    brief: `${base}.brief.md`,
    meta: `${base}.meta.json`,
  };
}

function readText(file) {
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8');
}

function readMeta(paths) {
  if (!existsSync(paths.meta)) {
    return { sourceUpdatedAt: null, proposedAt: null, acceptedAt: null };
  }
  try {
    const parsed = JSON.parse(readFileSync(paths.meta, 'utf8'));
    return {
      sourceUpdatedAt: parsed.sourceUpdatedAt || null,
      proposedAt: parsed.proposedAt || null,
      acceptedAt: parsed.acceptedAt || null,
    };
  } catch {
    return { sourceUpdatedAt: null, proposedAt: null, acceptedAt: null };
  }
}

function writeMeta(paths, meta) {
  mkdirSync(guidesDir(), { recursive: true });
  writeFileSync(paths.meta, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

function batchDir(batchId) {
  return path.join(RESEARCH_DIR, 'batches', safeId(batchId));
}

function stampBatchDraft(batchId, iso) {
  const dir = batchDir(batchId);
  const draft = loadShotgunDraft(dir);
  if (!draft) return null;
  return saveShotgunDraft(dir, { ...draft, planningGuideUpdatedAt: iso });
}

function guideStamp(meta) {
  return meta.acceptedAt || meta.proposedAt || meta.sourceUpdatedAt || '';
}

export function readZoneGuide(kind, id) {
  const paths = guidePaths(kind, id);
  const meta = readMeta(paths);
  const source = readText(paths.source);
  const proposed = readText(paths.proposed);
  const accepted = readText(paths.brief);
  const pending = Boolean(proposed.trim()) && (!meta.acceptedAt || (meta.proposedAt && meta.proposedAt > meta.acceptedAt));
  return {
    kind: paths.kind,
    id: paths.id,
    source,
    proposed,
    accepted,
    brief: pending ? proposed : accepted,
    briefState: pending ? 'proposed' : accepted.trim() ? 'accepted' : 'empty',
    sourceUpdatedAt: meta.sourceUpdatedAt,
    proposedAt: meta.proposedAt,
    acceptedAt: meta.acceptedAt,
  };
}

function assertLength(text, max, label) {
  if (String(text || '').length > max) {
    throw Object.assign(new Error(`${label} is too long (${max} characters max)`), { status: 400 });
  }
}

export function saveZoneGuideSource(kind, id, text) {
  const body = String(text ?? '');
  assertLength(body, 100000, 'Source');
  const paths = guidePaths(kind, id);
  mkdirSync(guidesDir(), { recursive: true });
  writeFileSync(paths.source, body, 'utf8');
  const meta = readMeta(paths);
  meta.sourceUpdatedAt = new Date().toISOString();
  writeMeta(paths, meta);
  if (paths.kind === 'batch') syncBatchGuideToZone(paths.id);
  return readZoneGuide(kind, id);
}

export function saveZoneGuideProposed(kind, id, text) {
  const body = String(text ?? '').trim();
  if (!body) throw Object.assign(new Error('Proposed brief is empty'), { status: 400 });
  assertLength(body, 20000, 'Proposed brief');
  const paths = guidePaths(kind, id);
  mkdirSync(guidesDir(), { recursive: true });
  writeFileSync(paths.proposed, `${body}\n`, 'utf8');
  const meta = readMeta(paths);
  meta.proposedAt = new Date().toISOString();
  writeMeta(paths, meta);
  if (paths.kind === 'batch') syncBatchGuideToZone(paths.id);
  return readZoneGuide(kind, id);
}

export function acceptZoneGuide(kind, id, text) {
  const body = String(text ?? '').trim();
  if (!body) throw Object.assign(new Error('Brief is empty'), { status: 400 });
  assertLength(body, 20000, 'Brief');
  const paths = guidePaths(kind, id);
  mkdirSync(guidesDir(), { recursive: true });
  writeFileSync(paths.brief, `${body}\n`, 'utf8');
  const meta = readMeta(paths);
  meta.acceptedAt = new Date().toISOString();
  writeMeta(paths, meta);
  if (paths.kind === 'zone') setZonePlanningGuideUpdatedAt(paths.id, meta.acceptedAt);
  if (paths.kind === 'batch') {
    stampBatchDraft(paths.id, meta.acceptedAt);
    syncBatchGuideToZone(paths.id);
  }
  return readZoneGuide(kind, id);
}

function syncBatchGuideToZone(batchId) {
  const draft = loadShotgunDraft(batchDir(batchId));
  const zoneId = String(draft?.clusterId || '').trim();
  if (!zoneId) return { copied: false };
  return copyZoneGuideFromBatch(batchId, zoneId);
}

/**
 * Copy a discovery-batch guide onto its zone.
 * Leaves the zone files alone when the zone copy is newer.
 */
export function copyZoneGuideFromBatch(batchId, zoneId) {
  const from = guidePaths('batch', batchId);
  const has =
    existsSync(from.source) || existsSync(from.proposed) || existsSync(from.brief) || existsSync(from.meta);
  if (!has) return { copied: false };
  const to = guidePaths('zone', zoneId);
  const fromMeta = readMeta(from);
  const toMeta = readMeta(to);
  if (guideStamp(toMeta) && guideStamp(fromMeta) && guideStamp(toMeta) > guideStamp(fromMeta)) {
    return { copied: false, reason: 'zone-newer' };
  }
  mkdirSync(guidesDir(), { recursive: true });
  for (const key of ['source', 'proposed', 'brief', 'meta']) {
    if (!existsSync(from[key])) continue;
    copyFileSync(from[key], to[key]);
  }
  if (fromMeta.acceptedAt) setZonePlanningGuideUpdatedAt(to.id, fromMeta.acceptedAt);
  return { copied: true, zoneId: to.id };
}

export function acceptedZoneGuideText(kind, id) {
  try {
    return readZoneGuide(kind, id).accepted.trim();
  } catch {
    return '';
  }
}

export function acceptedZoneGuideForCandidate(candidateId) {
  const cluster = clusterForCandidate(candidateId);
  if (!cluster?.id) return '';
  return acceptedZoneGuideText('zone', cluster.id);
}

const SECTION_LABELS = {
  market: 'Market',
  cities: 'Cities',
  homepage: 'Homepage',
  services: 'Services',
  terminology: 'Terminology',
  local: 'Local angles',
  symptoms: 'Symptom themes',
  donot: 'Do not',
};

const SECTION_ALIASES = {
  market: ['market'],
  cities: ['cities'],
  homepage: ['homepage', 'domain and homepage', 'domain'],
  services: ['services'],
  terminology: ['terminology'],
  local: ['local angles', 'local proof', 'angles'],
  symptoms: ['symptom themes', 'symptoms'],
  donot: ['do not', "don't", 'dont'],
};

export function zoneGuideSections(markdown) {
  const text = String(markdown || '').replace(/\r\n/g, '\n');
  const parts = text.split(/^##\s+/m);
  const sections = {};
  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n');
    const title = (nl === -1 ? part : part.slice(0, nl)).trim().toLowerCase();
    const body = (nl === -1 ? '' : part.slice(nl + 1)).trim();
    if (!body) continue;
    for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
      if (aliases.some((alias) => title === alias || title.startsWith(`${alias} `))) {
        sections[key] = body;
      }
    }
  }
  return sections;
}

function sectionBlock(markdown, keys) {
  const sections = zoneGuideSections(markdown);
  const parts = [];
  for (const key of keys) {
    if (!sections[key]) continue;
    parts.push(`## ${SECTION_LABELS[key]}\n${sections[key]}`);
  }
  return parts.join('\n\n').trim();
}

function capText(text, max) {
  const s = String(text || '').trim();
  if (!s || s.length <= max) return s;
  return `${s.slice(0, max).trimEnd()}\n\n[Zone brief truncated]`;
}

function avoidLines(markdown, hasDoNotSection) {
  if (hasDoNotSection) return '';
  const lines = String(markdown || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => /^\s*(avoid|do not)\b/i.test(line));
  if (!lines.length) return '';
  return `## Do not\n${lines.join('\n')}`;
}

export function zoneGuidePromptBlock({ markdown, kind }) {
  const text = String(markdown || '').trim();
  if (!text) return '';
  if (kind === 'cities') {
    const body = sectionBlock(text, ['market', 'cities']);
    if (!body) return '';
    return capText(
      `## Zone brief (accepted)\nBias only. Census radius and population bands still decide which places are legal. Do not invent a city.\n\n${body}`,
      4000,
    );
  }
  if (kind === 'site-config') {
    const body = sectionBlock(text, ['services', 'homepage', 'terminology']);
    if (!body) return '';
    return capText(
      `## Zone brief (accepted)\nSecondary names in Services become residential service labels, after the primary list, still max 12. homepageServicesLimit stays on the primary offers. The homepage tagline stays on the primary niche. Do not invent services that are not in this brief or the niche.\n\n${body}`,
      4000,
    );
  }
  if (kind === 'domain') {
    const body = sectionBlock(text, ['homepage']);
    if (!body) return '';
    return capText(
      `## Zone brief (accepted)\nThe domain carries the primary niche named here. Do not use a generic home-repair name.\n\n${body}`,
      2000,
    );
  }
  if (kind === 'rules') {
    const sections = zoneGuideSections(text);
    const body = sectionBlock(text, ['homepage', 'terminology', 'donot']);
    const extra = avoidLines(text, Boolean(sections.donot));
    const combined = [body, extra].filter(Boolean).join('\n\n');
    if (!combined) return '';
    return capText(
      `## Zone rules (accepted brief)\nHomepage and domain stay on the primary niche. Follow terminology. Symptom themes are not new pages.\n\n${combined}`,
      2200,
    );
  }
  return capText(
    `## Zone brief (accepted)\nOperator research for this zone. Use it for local angles, terminology, and which offers matter. Symptom themes are FAQ and section angles, not new URLs. Do not print unsourced statistics as local facts.\n\n${text}`,
    8000,
  );
}

export function zoneGuideBlockForCandidate(candidateId, kind) {
  return zoneGuidePromptBlock({ markdown: acceptedZoneGuideForCandidate(candidateId), kind });
}

export function zoneGuideBlockForBatch(batchId, kind) {
  return zoneGuidePromptBlock({ markdown: acceptedZoneGuideText('batch', batchId), kind });
}

/** Light-job identity for Distill. A zone is not a candidate and not a discovery batch. */
export function zoneGuideDistillJobFields(kind, id) {
  const key = String(id || '').trim();
  if (String(kind || '').trim() === 'batch') return { batchId: key };
  return { candidateId: `zone-guide:${key}` };
}

export function buildZoneGuideDistillPrompt(source) {
  const full = path.join(ROOT, 'prompts/zone-guide-distill.md');
  if (!existsSync(full)) throw new Error('Prompt not found: prompts/zone-guide-distill.md');
  return readFileSync(full, 'utf8').split('{{SOURCE}}').join(String(source || ''));
}

export function extractZoneBriefMarkdown(text) {
  let raw = String(text || '').trim();
  const fence = raw.match(/```(?:markdown|md)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  const start = raw.search(/^#\s+Zone brief\b/m);
  if (start >= 0) raw = raw.slice(start).trim();
  return raw;
}

export async function runZoneGuideDistill(kind, id, { jobId, signal } = {}) {
  const guide = readZoneGuide(kind, id);
  if (!guide.source.trim()) {
    throw Object.assign(new Error('Save a source before Distill'), { status: 400 });
  }
  const { claudeMessages } = await import('./claude.mjs');
  const { updateLightJobProgress } = await import('./rover-light-jobs.mjs');
  const { recordRoverApiSpend } = await import('./rover-api-spend.mjs');
  updateLightJobProgress(jobId, { detail: 'Distilling zone guide', done: 1, total: 2 });
  if (signal?.aborted) {
    throw Object.assign(new Error('Stopped'), { status: 499, cancelled: true });
  }
  const { text, costUsd, truncated } = await claudeMessages({
    user: buildZoneGuideDistillPrompt(guide.source),
    maxTokens: 4096,
    effort: 'low',
    signal,
  });
  if (truncated) {
    throw Object.assign(new Error('Claude hit the token cap. Shorten the source and distill again.'), {
      status: 502,
    });
  }
  if (costUsd != null) recordRoverApiSpend('anthropic', costUsd);
  const proposed = extractZoneBriefMarkdown(text);
  if (!/^##\s+/m.test(proposed)) {
    throw Object.assign(
      new Error('Distill did not return a headed brief. Copy the prompt and paste a brief instead.'),
      { status: 502 },
    );
  }
  const saved = saveZoneGuideProposed(kind, id, proposed);
  updateLightJobProgress(jobId, { detail: 'Proposed brief ready', done: 2, total: 2 });
  return { ok: true, guide: saved, costUsd: costUsd ?? null };
}

registerNarrativeZoneGuide((id) => zoneGuideBlockForCandidate(id, 'full'));
