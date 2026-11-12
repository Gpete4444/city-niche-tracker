/**
 * One stock-query and before/after prompt library per niche.
 * Keys match photo groups: home:hero:1, svcHero:{service}, svc:{slug}.
 * A later city copies those prompts. Empty keys are filled once and never replaced.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RESEARCH_DIR, pathsFor, titleCaseNiche } from './candidates.mjs';
import { listBaPromptSlots } from './chatgpt-before-after.mjs';
import { listImageSlots } from './fill-site-images.mjs';
import { matchKeyForSlot } from './photo-groups.mjs';

export const NICHE_IMAGE_PROMPT_FILE = path.join(RESEARCH_DIR, '_niche-image-prompts.json');

const harvested = new Set();

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

function readStore(filePath = NICHE_IMAGE_PROMPT_FILE) {
  const data = readJson(filePath);
  if (!data || typeof data.lists !== 'object' || !data.lists) return { lists: {} };
  return { lists: data.lists };
}

function writeStore(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function nicheKey(niche) {
  return titleCaseNiche(niche).toLowerCase();
}

export function promptMentionsCity(text, city) {
  const name = String(city || '').trim();
  if (name.length < 3) return false;
  return String(text || '').toLowerCase().includes(name.toLowerCase());
}

export function baPromptComplete(entry) {
  const side = (name) =>
    Boolean(String(entry?.[name]?.before || '').trim() && String(entry?.[name]?.after || '').trim());
  return side('inside') && side('outside');
}

function cloneBaEntry(entry) {
  return {
    room: String(entry?.room || '').trim() || null,
    inside: {
      before: String(entry.inside.before).trim(),
      after: String(entry.inside.after).trim(),
    },
    outside: {
      before: String(entry.outside.before).trim(),
      after: String(entry.outside.after).trim(),
    },
  };
}

export function baEntryMentionsCity(entry, city) {
  const parts = [
    entry?.room,
    entry?.inside?.before,
    entry?.inside?.after,
    entry?.outside?.before,
    entry?.outside?.after,
  ];
  return parts.some((part) => promptMentionsCity(part, city));
}

/** Keys listed in the incomplete before/after save error. */
export function incompleteBeforeAfterKeys(error) {
  const msg = String(error?.message || '');
  const match = msg.match(/needs beforeAfter prompts for:\s*([^(]+)/i);
  if (!match) return null;
  return match[1]
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

export function promptsFromImagesPlan({ imageSlots, baSlots, plan, city } = {}) {
  const slots = {};
  const beforeAfter = {};
  const planSlots = plan?.slots && typeof plan.slots === 'object' ? plan.slots : {};
  const planBa = plan?.beforeAfter && typeof plan.beforeAfter === 'object' ? plan.beforeAfter : {};
  for (const slot of imageSlots || []) {
    const match = matchKeyForSlot(slot);
    const query = String(planSlots[slot.key]?.query || '').trim();
    if (!match || !query || promptMentionsCity(query, city)) continue;
    slots[match] = query;
  }
  for (const ba of baSlots || []) {
    const entry = planBa[ba.key];
    if (!ba.key || !baPromptComplete(entry) || baEntryMentionsCity(entry, city)) continue;
    beforeAfter[ba.key] = cloneBaEntry(entry);
  }
  return { slots, beforeAfter };
}

/** Fill only keys the library does not have yet. */
export function mergeNicheImagePrompts(existing, incoming) {
  const slots = { ...(existing?.slots && typeof existing.slots === 'object' ? existing.slots : {}) };
  const beforeAfter = {
    ...(existing?.beforeAfter && typeof existing.beforeAfter === 'object' ? existing.beforeAfter : {}),
  };
  let added = 0;
  for (const [key, query] of Object.entries(incoming?.slots || {})) {
    const text = String(query || '').trim();
    if (!key || slots[key] || !text) continue;
    slots[key] = text;
    added += 1;
  }
  for (const [key, entry] of Object.entries(incoming?.beforeAfter || {})) {
    if (!key || beforeAfter[key] || !baPromptComplete(entry)) continue;
    beforeAfter[key] = cloneBaEntry(entry);
    added += 1;
  }
  return { slots, beforeAfter, added };
}

/**
 * Copy library phrases onto this site's slot keys. Service heroes match by
 * service name, not by svcHero-7.
 */
export function imagePromptFill({ library, imageSlots, baSlots, planSlots, planBeforeAfter } = {}) {
  const slots = {};
  const beforeAfter = {};
  const savedSlots = planSlots && typeof planSlots === 'object' ? planSlots : {};
  const savedBa = planBeforeAfter && typeof planBeforeAfter === 'object' ? planBeforeAfter : {};
  const libSlots = library?.slots && typeof library.slots === 'object' ? library.slots : {};
  const libBa = library?.beforeAfter && typeof library.beforeAfter === 'object' ? library.beforeAfter : {};
  for (const slot of imageSlots || []) {
    if (!slot?.key || String(savedSlots[slot.key]?.query || '').trim()) continue;
    const query = String(libSlots[matchKeyForSlot(slot)] || '').trim();
    if (!query) continue;
    slots[slot.key] = { query };
  }
  for (const ba of baSlots || []) {
    if (!ba?.key || baPromptComplete(savedBa[ba.key])) continue;
    const entry = libBa[ba.key];
    if (!baPromptComplete(entry)) continue;
    beforeAfter[ba.key] = cloneBaEntry(entry);
  }
  return { slots, beforeAfter };
}

export function getNicheImagePrompts(niche, filePath = NICHE_IMAGE_PROMPT_FILE) {
  const key = nicheKey(niche);
  if (!key) return null;
  const record = readStore(filePath).lists[key];
  if (!record) return null;
  return {
    niche: record.niche || titleCaseNiche(niche),
    slots: record.slots && typeof record.slots === 'object' ? record.slots : {},
    beforeAfter: record.beforeAfter && typeof record.beforeAfter === 'object' ? record.beforeAfter : {},
    updatedAt: record.updatedAt || null,
  };
}

function siteNicheAndCity(candidateId) {
  const config = readJson(pathsFor(candidateId).siteConfig) || {};
  return {
    niche: titleCaseNiche(config.niche),
    city: String(config.primaryCity || '').trim(),
  };
}

export function saveNicheImagePromptRecord(niche, record, filePath = NICHE_IMAGE_PROMPT_FILE) {
  return mergeIntoStore(niche, record, filePath);
}

function mergeIntoStore(niche, incoming, filePath) {
  const label = titleCaseNiche(niche);
  const key = nicheKey(label);
  if (!key) return { added: 0 };
  const store = readStore(filePath);
  const existing = store.lists[key] || { niche: label, slots: {}, beforeAfter: {} };
  const merged = mergeNicheImagePrompts(existing, incoming);
  if (!merged.added) return { added: 0, niche: label };
  store.lists[key] = {
    niche: label,
    slots: merged.slots,
    beforeAfter: merged.beforeAfter,
    updatedAt: new Date().toISOString(),
  };
  writeStore(filePath, store);
  return { added: merged.added, niche: label };
}

function candidateHasOwnContent(candidateId) {
  const paths = pathsFor(candidateId);
  for (const key of ['content', 'contentDraft']) {
    const doc = readJson(paths[key]);
    if (doc?.files && Object.keys(doc.files).length) return true;
  }
  return false;
}

function baSlotsForPlan(candidateId, plan) {
  try {
    const listed = listBaPromptSlots(candidateId);
    if (listed.length) return listed;
  } catch {
    /* use the keys already stored on the plan */
  }
  return Object.keys(plan?.beforeAfter || {})
    .filter((key) => key === 'home:1' || key.startsWith('svc:'))
    .map((key) => ({ key }));
}

function promptsFromCandidatePlan(candidateId, plan, city) {
  let imageSlots = [];
  if (candidateHasOwnContent(candidateId)) {
    try {
      imageSlots = listImageSlots(candidateId);
    } catch {
      imageSlots = [];
    }
  }
  return promptsFromImagesPlan({
    imageSlots,
    baSlots: baSlotsForPlan(candidateId, plan),
    plan,
    city,
  });
}

/** Add prompts from every completed images plan in this niche. Existing keys stay. */
export function absorbNicheImagePromptPlans(niche, filePath = NICHE_IMAGE_PROMPT_FILE) {
  const label = titleCaseNiche(niche);
  const key = nicheKey(label);
  if (!key) return { added: 0 };
  const cacheKey = `${filePath}::${key}`;
  if (harvested.has(cacheKey)) return { added: 0, cached: true };
  let added = 0;
  let names = [];
  try {
    names = readdirSync(path.dirname(filePath));
  } catch {
    names = [];
  }
  for (const name of names) {
    if (!name.endsWith('-images-plan.json')) continue;
    const plan = readJson(path.join(path.dirname(filePath), name));
    if (!plan?.loadedAt || !plan.candidateId) continue;
    if (titleCaseNiche(plan.niche).toLowerCase() !== key) continue;
    const { city } = siteNicheAndCity(plan.candidateId);
    try {
      const incoming = promptsFromCandidatePlan(plan.candidateId, plan, city);
      added += mergeIntoStore(label, incoming, filePath).added;
    } catch {
      /* a plan that cannot be mapped stays out of the library */
    }
  }
  harvested.add(cacheKey);
  return { added };
}

export function rememberNicheImagePrompts(candidateId, filePath = NICHE_IMAGE_PROMPT_FILE) {
  const plan = readJson(pathsFor(candidateId).imagesPlan);
  if (!plan?.loadedAt) return { added: 0 };
  const fromConfig = siteNicheAndCity(candidateId);
  const niche = fromConfig.niche || titleCaseNiche(plan.niche);
  if (!niche) return { added: 0 };
  const incoming = promptsFromCandidatePlan(candidateId, plan, fromConfig.city);
  return mergeIntoStore(niche, incoming, filePath);
}

/** Library phrases for slots and before/after keys this site does not have yet. */
export function applyStoredNicheImagePrompts(candidateId, filePath = NICHE_IMAGE_PROMPT_FILE) {
  const { niche } = siteNicheAndCity(candidateId);
  const planNiche = titleCaseNiche(readJson(pathsFor(candidateId).imagesPlan)?.niche);
  const label = niche || planNiche;
  if (!label) return { slots: {}, beforeAfter: {} };
  absorbNicheImagePromptPlans(label, filePath);
  const library = getNicheImagePrompts(label, filePath);
  const plan = readJson(pathsFor(candidateId).imagesPlan) || {};
  return imagePromptFill({
    library,
    imageSlots: listImageSlots(candidateId),
    baSlots: listBaPromptSlots(candidateId),
    planSlots: plan.slots,
    planBeforeAfter: plan.beforeAfter,
  });
}
