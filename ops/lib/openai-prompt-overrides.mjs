/**
 * Operator OpenAI/ChatGPT prompt overrides. One text, two consumers (Copy + generate).
 * Kept off images-plan.json so Image-queries completeness stays stock-query-only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathsFor } from './candidates.mjs';

function emptyDoc() {
  return { slots: {}, ba: {} };
}

export function normalizePromptViewpoint(viewpoint) {
  return String(viewpoint || '').toLowerCase() === 'outside' ? 'outside' : 'inside';
}

export function normalizeBaPromptKey(key) {
  return String(key || '')
    .trim()
    .replace(/^ba:/, '');
}

export function loadOpenaiPromptsFile(filePath) {
  if (!filePath || !existsSync(filePath)) return emptyDoc();
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!raw || typeof raw !== 'object') return emptyDoc();
    return {
      slots: raw.slots && typeof raw.slots === 'object' ? raw.slots : {},
      ba: raw.ba && typeof raw.ba === 'object' ? raw.ba : {},
    };
  } catch {
    return emptyDoc();
  }
}

export function saveOpenaiPromptsFile(filePath, doc) {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const next = {
    slots: doc?.slots && typeof doc.slots === 'object' ? doc.slots : {},
    ba: doc?.ba && typeof doc.ba === 'object' ? doc.ba : {},
  };
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function loadCandidateOpenaiPrompts(candidateId) {
  return loadOpenaiPromptsFile(pathsFor(candidateId).openaiPrompts);
}

export function saveCandidateOpenaiPrompts(candidateId, doc) {
  return saveOpenaiPromptsFile(pathsFor(candidateId).openaiPrompts, doc);
}

export function openaiPromptsPathForGroupDir(groupDir) {
  return path.join(String(groupDir || ''), 'openaiPrompts.json');
}

export function getSlotPromptOverride(doc, slotKey, viewpoint) {
  const key = String(slotKey || '').trim();
  const vp = normalizePromptViewpoint(viewpoint);
  const text = doc?.slots?.[key]?.[vp];
  return String(text || '').trim();
}

export function getBaPromptOverride(doc, matchKey, viewpoint) {
  const key = normalizeBaPromptKey(matchKey);
  const vp = normalizePromptViewpoint(viewpoint);
  const side = doc?.ba?.[key]?.[vp];
  if (!side || typeof side !== 'object') return null;
  const before = String(side.before || '').trim();
  const after = String(side.after || '').trim();
  if (!before && !after) return null;
  return { before, after };
}

export function pickPromptText(original, sidecarOverride, bodyPrompt) {
  const body = String(bodyPrompt || '').trim();
  if (body) return body;
  const ov = String(sidecarOverride || '').trim();
  if (ov) return ov;
  return String(original || '').trim();
}

export function pickBaPromptPair(canonical, sidecarOverride, body = {}) {
  const bodyBefore = String(body.before || '').trim();
  const bodyAfter = String(body.after || '').trim();
  const ov = sidecarOverride && typeof sidecarOverride === 'object' ? sidecarOverride : null;
  return {
    before: bodyBefore || String(ov?.before || '').trim() || String(canonical?.before || '').trim(),
    after: bodyAfter || String(ov?.after || '').trim() || String(canonical?.after || '').trim(),
  };
}

function pruneEmpty(obj) {
  if (!obj || typeof obj !== 'object') return {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) {
      delete obj[k];
      continue;
    }
    if (typeof v === 'object' && !Array.isArray(v)) {
      pruneEmpty(v);
      if (!Object.keys(v).length) delete obj[k];
    } else if (typeof v === 'string' && !v.trim()) {
      delete obj[k];
    }
  }
  return obj;
}

export function setSlotPromptOverride(doc, slotKey, viewpoint, text) {
  const key = String(slotKey || '').trim();
  const vp = normalizePromptViewpoint(viewpoint);
  const next = {
    slots: { ...(doc?.slots || {}) },
    ba: { ...(doc?.ba || {}) },
  };
  if (!key) return next;
  const trimmed = String(text || '').trim();
  const slot = { ...(next.slots[key] || {}) };
  if (trimmed) slot[vp] = trimmed;
  else delete slot[vp];
  if (Object.keys(slot).length) next.slots[key] = slot;
  else delete next.slots[key];
  return next;
}

export function clearSlotPromptOverride(doc, slotKey, viewpoint) {
  return setSlotPromptOverride(doc, slotKey, viewpoint, '');
}

export function setBaPromptOverride(doc, matchKey, viewpoint, { before, after } = {}) {
  const key = normalizeBaPromptKey(matchKey);
  const vp = normalizePromptViewpoint(viewpoint);
  const next = {
    slots: { ...(doc?.slots || {}) },
    ba: { ...(doc?.ba || {}) },
  };
  if (!key) return next;
  const beforeText = String(before || '').trim();
  const afterText = String(after || '').trim();
  const entry = { ...(next.ba[key] || {}) };
  if (beforeText || afterText) {
    entry[vp] = { before: beforeText, after: afterText };
  } else {
    delete entry[vp];
  }
  if (Object.keys(entry).length) next.ba[key] = entry;
  else delete next.ba[key];
  pruneEmpty(next);
  return next;
}

export function clearBaPromptOverride(doc, matchKey, viewpoint) {
  return setBaPromptOverride(doc, matchKey, viewpoint, { before: '', after: '' });
}

export function overlayBaCardPrompts(sides, doc, matchKey) {
  const out = sides && typeof sides === 'object' ? { ...sides } : {};
  for (const vp of ['inside', 'outside']) {
    const side = out[vp] && typeof out[vp] === 'object' ? { ...out[vp] } : null;
    if (!side) continue;
    if (!side.originalBefore) side.originalBefore = side.before || '';
    if (!side.originalAfter) side.originalAfter = side.after || '';
    const ov = getBaPromptOverride(doc, matchKey, vp);
    if (ov) {
      side.before = ov.before || side.before;
      side.after = ov.after || side.after;
      side.source = 'override';
    }
    out[vp] = side;
  }
  return out;
}

export function persistSlotOverrideIfBody(filePath, slotKey, viewpoint, original, usedText) {
  const orig = String(original || '').trim();
  const used = String(usedText || '').trim();
  if (!used) return;
  const doc = loadOpenaiPromptsFile(filePath);
  const next =
    used === orig
      ? clearSlotPromptOverride(doc, slotKey, viewpoint)
      : setSlotPromptOverride(doc, slotKey, viewpoint, used);
  saveOpenaiPromptsFile(filePath, next);
}

export function persistBaOverrideIfBody(filePath, matchKey, viewpoint, canonical, used) {
  const origBefore = String(canonical?.before || '').trim();
  const origAfter = String(canonical?.after || '').trim();
  const usedBefore = String(used?.before || '').trim();
  const usedAfter = String(used?.after || '').trim();
  if (!usedBefore && !usedAfter) return;
  const doc = loadOpenaiPromptsFile(filePath);
  const same = usedBefore === origBefore && usedAfter === origAfter;
  const next = same
    ? clearBaPromptOverride(doc, matchKey, viewpoint)
    : setBaPromptOverride(doc, matchKey, viewpoint, { before: usedBefore, after: usedAfter });
  saveOpenaiPromptsFile(filePath, next);
}
