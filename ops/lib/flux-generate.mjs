/**
 * Flux generate + variant tray for candidate slots and before/after pairs.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { addLastCost, getCandidateDetail, pathsFor } from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import {
  applyImagesToContentFiles,
  listImageSlots,
  listImageSlotStatus,
  loadManifest,
  saveSlotIntoManifest,
  syncSiteImagesToPublic,
} from './fill-site-images.mjs';
import {
  FLUX_COST,
  generateFluxImage,
  fluxStatus,
  assertFluxCredits,
  invalidateFalBalanceCache,
  setFluxJobProgress,
  clearFluxJobProgress,
} from './image-providers/flux.mjs';
import { fluxSlotPromptForCandidate } from './flux-prompts.mjs';
import {
  archiveLiveBaPairToTray,
  baVariantKey,
  findLiveBaFiles,
  listBeforeAfterStatus,
  loadBaVariantsDoc,
  saveBaVariantsDoc,
  writeGeneratedBaPair,
  listConfiguredServiceTargets,
  resolveBaChatgptPrompts,
  saveLastBaPrompts,
} from './chatgpt-before-after.mjs';
import {
  OPENAI_IMAGE_COST,
  openaiImageKeySet,
  generateOpenaiImage,
  editOpenaiImage,
} from './image-providers/openai-image.mjs';

export const VARIANT_CAP = 8;

function fluxUnconfiguredError() {
  return Object.assign(
    new Error('No Flux key configured. Set FAL_KEY in .env (fal.ai), then restart Rover.'),
    { status: 400, code: 'flux-unconfigured' },
  );
}

function openaiUnconfiguredError() {
  return Object.assign(
    new Error('Set OPENAI_API_KEY in .env (same key as Phone), then restart Rover.'),
    { status: 400, code: 'openai-unconfigured' },
  );
}

function safeName(s) {
  return String(s || 'slot')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function unlinkQuiet(abs) {
  try {
    if (existsSync(abs)) unlinkSync(abs);
  } catch {
    /* ignore */
  }
}

function trimVariants(dir, variants, cap = VARIANT_CAP) {
  const kept = (variants || []).slice(0, cap);
  const dropped = (variants || []).slice(cap);
  for (const v of dropped) {
    if (v.filename) unlinkQuiet(path.join(dir, path.basename(String(v.filename))));
    if (v.beforeFilename) unlinkQuiet(path.join(dir, path.basename(String(v.beforeFilename))));
    if (v.afterFilename) unlinkQuiet(path.join(dir, path.basename(String(v.afterFilename))));
  }
  return kept;
}

function slotStatusPayload(candidateId, slotKey) {
  const all = listImageSlotStatus(candidateId);
  const slot = (all.slots || []).find((s) => s.key === slotKey) || null;
  return { ...all, slot, flux: fluxStatus() };
}

export async function generateImageSlot(candidateId, slotKey, { viewpoint } = {}) {
  if (!fluxStatus().configured) throw fluxUnconfiguredError();
  await assertFluxCredits('generate');
  const slots = listImageSlots(candidateId);
  const slot = slots.find((s) => s.key === slotKey);
  if (!slot) throw Object.assign(new Error(`Unknown image slot: ${slotKey}`), { status: 404 });
  if (slot.sectionId === 'beforeAfter' || slot.sectionId === 'svcBeforeAfter') {
    throw Object.assign(new Error('Use OpenAI pair for before/after'), { status: 400 });
  }
  const built = fluxSlotPromptForCandidate(candidateId, slotKey, { viewpoint, forChatGpt: false });
  try {
    const { buffer, provider } = await generateFluxImage({ prompt: built.prompt });
    return persistGeneratedSlot(candidateId, slot, {
      buffer,
      provider,
      source: 'flux',
      queryHint: built.queryHint,
      matchTip: 'AI-generated (Flux 2 Pro)',
      attribution: 'AI-generated (Flux 2 Pro)',
      photoPrefix: 'flux',
      fileStem: 'flux',
      costKey: 'flux',
      costDelta: FLUX_COST.generate,
      invalidateFal: true,
    });
  } finally {
    clearFluxJobProgress();
  }
}

export async function generateImageSlotOpenai(candidateId, slotKey, { viewpoint } = {}) {
  if (!openaiImageKeySet()) throw openaiUnconfiguredError();
  const slots = listImageSlots(candidateId);
  const slot = slots.find((s) => s.key === slotKey);
  if (!slot) throw Object.assign(new Error(`Unknown image slot: ${slotKey}`), { status: 404 });
  if (slot.sectionId === 'beforeAfter' || slot.sectionId === 'svcBeforeAfter') {
    throw Object.assign(new Error('Use OpenAI pair for before/after'), { status: 400 });
  }
  const built = fluxSlotPromptForCandidate(candidateId, slotKey, { viewpoint, forChatGpt: true });
  try {
    setFluxJobProgress({ step: 'generate', status: 'SUBMITTING', model: 'openai' });
    const { buffer, provider } = await generateOpenaiImage({ prompt: built.prompt });
    return persistGeneratedSlot(candidateId, slot, {
      buffer,
      provider,
      source: 'openai',
      queryHint: built.queryHint,
      matchTip: 'AI-generated (GPT Image 2 (OpenAI))',
      attribution: 'GPT Image 2 (OpenAI)',
      photoPrefix: 'openai',
      fileStem: 'openai',
      costKey: 'openai',
      costDelta: OPENAI_IMAGE_COST.generate,
      invalidateFal: false,
    });
  } finally {
    clearFluxJobProgress();
  }
}

function persistGeneratedSlot(
  candidateId,
  slot,
  {
    buffer,
    provider,
    source,
    queryHint,
    matchTip,
    attribution,
    photoPrefix,
    fileStem,
    costKey,
    costDelta,
    invalidateFal,
  },
) {
  const p = pathsFor(candidateId);
  mkdirSync(p.siteImages, { recursive: true });
  const manifest = loadManifest(candidateId);
  const prior = manifest.slots?.[slot.key] || null;
  const variants = [...(prior?.variants || [])];
  if (prior?.filename && existsSync(path.join(p.siteImages, prior.filename))) {
    variants.unshift({
      id: `var-${Date.now().toString(36)}`,
      filename: prior.filename,
      source: prior.source || 'stock',
      provider: prior.provider || null,
      photoId: prior.photoId || null,
      attribution: prior.attribution || null,
      matchGrade: prior.matchGrade || null,
      generatedAt: new Date().toISOString(),
    });
  }
  const filename = `${safeName(slot.key)}-${fileStem}-${Date.now().toString(36)}.jpg`;
  writeFileSync(path.join(p.siteImages, filename), buffer);
  const detail = getCandidateDetail(candidateId);
  const config =
    loadAcceptedSiteConfig(candidateId)?.config ||
    detail.siteConfig ||
    detail.siteConfigDraft ||
    {};
  const niche = String(config.niche || detail.config?.niche || 'home service').trim();
  const entry = {
    key: slot.key,
    sectionId: slot.sectionId,
    index: slot.index,
    filename,
    src: `/images/${filename}`,
    alt: `${slot.label || slot.sectionId} photo`,
    provider,
    source,
    photoId: `${photoPrefix}:${slot.key}:${Date.now()}`,
    photographer: null,
    pageUrl: null,
    query: queryHint || slot.queryHint || slot.label,
    score: null,
    matchGrade: 'ok',
    matchTip,
    attribution,
    serviceName: slot.serviceName || slot.label || null,
    serviceSlug: slot.serviceSlug || null,
    materialTitle: slot.materialTitle || null,
    processTitle: slot.processTitle || null,
    label: slot.label || null,
    variants: trimVariants(p.siteImages, variants),
  };
  const nextManifest = saveSlotIntoManifest(candidateId, entry);
  const synced = syncSiteImagesToPublic(candidateId);
  const contentUpdate = applyImagesToContentFiles(candidateId, [
    ...Object.values(nextManifest.slots || {}).filter((s) => s?.filename),
  ]);
  addLastCost(candidateId, costKey, costDelta);
  if (invalidateFal) invalidateFalBalanceCache();
  return {
    ok: true,
    slot: entry,
    synced,
    contentUpdate,
    manifest: nextManifest,
    status: slotStatusPayload(candidateId, slot.key),
    human: [`Generated ${source === 'openai' ? 'OpenAI' : 'Flux'} photo for ${slot.key} (${niche}).`],
    candidate: getCandidateDetail(candidateId),
  };
}

export function useImageSlotVariant(candidateId, slotKey, { filename } = {}) {
  const want = path.basename(String(filename || ''));
  if (!want) throw Object.assign(new Error('filename required'), { status: 400 });
  const p = pathsFor(candidateId);
  const manifest = loadManifest(candidateId);
  const prior = manifest.slots?.[slotKey];
  if (!prior?.filename) throw Object.assign(new Error('Slot has no live photo'), { status: 404 });
  const variants = [...(prior.variants || [])];
  const idx = variants.findIndex((v) => path.basename(String(v.filename || '')) === want);
  if (idx < 0) throw Object.assign(new Error('Variant not found'), { status: 404 });
  const picked = variants[idx];
  if (!existsSync(path.join(p.siteImages, picked.filename))) {
    throw Object.assign(new Error('Variant file missing on disk'), { status: 404 });
  }
  const liveAsVar = {
    id: picked.id || `var-${Date.now().toString(36)}`,
    filename: prior.filename,
    source: prior.source || null,
    provider: prior.provider || null,
    photoId: prior.photoId || null,
    attribution: prior.attribution || null,
    matchGrade: prior.matchGrade || null,
    generatedAt: new Date().toISOString(),
  };
  variants.splice(idx, 1);
  variants.unshift(liveAsVar);
  const entry = {
    ...prior,
    filename: picked.filename,
    src: `/images/${picked.filename}`,
    source: picked.source || prior.source,
    provider: picked.provider || null,
    photoId: picked.photoId || prior.photoId,
    attribution: picked.attribution || prior.attribution,
    matchGrade: picked.matchGrade || prior.matchGrade,
    variants: trimVariants(p.siteImages, variants),
  };
  const nextManifest = saveSlotIntoManifest(candidateId, entry);
  const synced = syncSiteImagesToPublic(candidateId);
  const contentUpdate = applyImagesToContentFiles(candidateId, [
    ...Object.values(nextManifest.slots || {}).filter((s) => s?.filename),
  ]);
  return {
    ok: true,
    slot: entry,
    synced,
    contentUpdate,
    status: slotStatusPayload(candidateId, slotKey),
    candidate: getCandidateDetail(candidateId),
  };
}

export async function generateCandidateBaPairOpenai(
  candidateId,
  { viewpoint, serviceSlug = '', pairIndex = 1 } = {},
) {
  if (!openaiImageKeySet()) {
    throw Object.assign(
      new Error('Set OPENAI_API_KEY in .env (same key as Phone), then restart Rover.'),
      { status: 400, code: 'openai-unconfigured' },
    );
  }
  const slug = String(serviceSlug || '').trim();
  let serviceName = '';
  if (slug) {
    const hit = listConfiguredServiceTargets(candidateId).find((s) => s.slug === slug);
    serviceName = hit?.serviceName || slug;
  }
  const resolved = resolveBaChatgptPrompts(candidateId, {
    serviceSlug: slug,
    pairIndex,
    viewpoint,
  });
  const beforePrompt = resolved.before;
  const afterPrompt = resolved.after;
  try {
    setFluxJobProgress({ step: 'before', status: 'SUBMITTING', model: 'openai' });
    const before = await generateOpenaiImage({ prompt: beforePrompt });
    setFluxJobProgress({ step: 'after', status: 'SUBMITTING', model: 'openai' });
    const after = await editOpenaiImage({ prompt: afterPrompt, imageBuffer: before.buffer });
    archiveLiveBaPairToTray(candidateId, { serviceSlug: slug, pairIndex });
    const written = writeGeneratedBaPair(candidateId, {
      serviceSlug: slug,
      pairIndex,
      beforeBuffer: before.buffer,
      afterBuffer: after.buffer,
      sourceLabel: 'GPT Image 2 (OpenAI)',
    });
    saveLastBaPrompts(candidateId, {
      serviceSlug: slug,
      pairIndex,
      viewpoint: resolved.viewpoint,
      before: beforePrompt,
      after: afterPrompt,
      source: 'openai',
    });
    addLastCost(candidateId, 'openai', OPENAI_IMAGE_COST.pair);
    const status = listBeforeAfterStatus(candidateId);
    status.flux = fluxStatus();
    return {
      ok: true,
      ...written,
      status,
      candidate: getCandidateDetail(candidateId),
      human: [`Generated OpenAI before/after pair${serviceName ? ` for ${serviceName}` : ''}.`],
    };
  } finally {
    clearFluxJobProgress();
  }
}

export function useCandidateBaVariant(candidateId, { pairId, serviceSlug = '', pairIndex = 1 } = {}) {
  const key = baVariantKey({ serviceSlug, pairIndex });
  const p = pathsFor(candidateId);
  const doc = loadBaVariantsDoc(candidateId);
  const list = [...(doc[key] || [])];
  const idx = list.findIndex((v) => v.id === pairId);
  if (idx < 0) throw Object.assign(new Error('Pair variant not found'), { status: 404 });
  const picked = list[idx];
  const live = findLiveBaFiles(candidateId, { serviceSlug, pairIndex });
  const stamp = Date.now().toString(36);
  const prefix = serviceSlug
    ? `svc-ba-${serviceSlug}`
    : `gallery-ba-${Math.max(1, Number(pairIndex) || 1)}`;
  const liveBeforeDest = live.before ? `${prefix}-var-${stamp}-before${path.extname(live.before) || '.jpg'}` : null;
  const liveAfterDest = live.after ? `${prefix}-var-${stamp}-after${path.extname(live.after) || '.jpg'}` : null;
  if (liveBeforeDest) {
    copyFileSync(path.join(p.siteImages, live.before), path.join(p.siteImages, liveBeforeDest));
  }
  if (liveAfterDest) {
    copyFileSync(path.join(p.siteImages, live.after), path.join(p.siteImages, liveAfterDest));
  }
  const beforeBuf = picked.beforeFilename
    ? readFileSync(path.join(p.siteImages, picked.beforeFilename))
    : null;
  const afterBuf = picked.afterFilename
    ? readFileSync(path.join(p.siteImages, picked.afterFilename))
    : null;
  if (!beforeBuf || !afterBuf) {
    throw Object.assign(new Error('Variant pair files missing'), { status: 404 });
  }
  writeGeneratedBaPair(candidateId, {
    serviceSlug,
    pairIndex,
    beforeBuffer: beforeBuf,
    afterBuffer: afterBuf,
    sourceLabel: 'Flux 2 Pro',
  });
  list.splice(idx, 1);
  if (liveBeforeDest || liveAfterDest) {
    list.unshift({
      id: `var-${stamp}`,
      beforeFilename: liveBeforeDest,
      afterFilename: liveAfterDest,
      source: 'prior',
      generatedAt: new Date().toISOString(),
    });
  }
  doc[key] = trimVariants(p.siteImages, list);
  saveBaVariantsDoc(candidateId, doc);
  const status = listBeforeAfterStatus(candidateId);
  status.flux = fluxStatus();
  return { ok: true, status, candidate: getCandidateDetail(candidateId) };
}
