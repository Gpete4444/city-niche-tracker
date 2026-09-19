/**
 * OpenAI generate + variant tray for candidate slots and before/after pairs.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { addLastCost, pathsFor } from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import {
  applyImagesToContentFiles,
  imageSlotCardStatus,
  listImageSlots,
  loadManifest,
  saveSlotIntoManifest,
  syncSiteImagesToPublic,
  syncSiteImagesToPublicAsync,
} from './fill-site-images.mjs';
import { IMAGE_TRAY_CAP, pushBaTrayEntry, pushSlotTrayEntry, trimTrayVariants } from './image-tray.mjs';
import { buildSlotImagePrompt } from './chatgpt-slot-image.mjs';
import { persistSlotOverrideIfBody, persistBaOverrideIfBody } from './openai-prompt-overrides.mjs';
import { applyOccupancyToPrompt } from './image-occupancy.mjs';
import {
  archiveLiveBaPairToTray,
  findLiveBaFiles,
  listBeforeAfterStatus,
  loadBaVariantsDoc,
  pickBaStatusPair,
  resolveBaVariantTarget,
  saveBaVariantsDoc,
  writeGeneratedBaPair,
  listConfiguredServiceTargets,
  resolveBaPromptsWithOverride,
  saveLastBaPrompts,
} from './chatgpt-before-after.mjs';
import {
  OPENAI_IMAGE_COST,
  openaiImageKeySet,
  openaiImageStatus,
  generateOpenaiImage,
  editOpenaiImage,
} from './image-providers/openai-image.mjs';

export const VARIANT_CAP = IMAGE_TRAY_CAP;

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

function trimVariants(dir, variants, cap = VARIANT_CAP) {
  return trimTrayVariants(dir, variants, cap);
}

function slotStatusPayload(candidateId, slotKey) {
  return { slot: imageSlotCardStatus(candidateId, slotKey), openai: openaiImageStatus() };
}

export function baStatusPayload(candidateId, { serviceSlug = '', pairIndex = 1 } = {}) {
  const status = listBeforeAfterStatus(candidateId);
  status.openai = openaiImageStatus();
  const pair = pickBaStatusPair(status, { serviceSlug, pairIndex });
  return { openai: status.openai, pair, matchKey: pair?.matchKey || null };
}

export async function generateImageSlotOpenai(candidateId, slotKey, { viewpoint, occupancy, prompt } = {}) {
  if (!openaiImageKeySet()) throw openaiUnconfiguredError();
  const slots = listImageSlots(candidateId);
  const slot = slots.find((s) => s.key === slotKey);
  if (!slot) throw Object.assign(new Error(`Unknown image slot: ${slotKey}`), { status: 404 });
  if (slot.sectionId === 'beforeAfter' || slot.sectionId === 'svcBeforeAfter') {
    throw Object.assign(new Error('Use OpenAI pair for before/after'), { status: 400 });
  }
  const built = buildSlotImagePrompt(candidateId, slotKey, { viewpoint, occupancy, prompt });
  if (String(prompt || '').trim()) {
    persistSlotOverrideIfBody(
      pathsFor(candidateId).openaiPrompts,
      slotKey,
      built.viewpoint,
      built.original,
      built.prompt,
    );
  }
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
  });
}

async function persistGeneratedSlot(
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
  },
) {
  const p = pathsFor(candidateId);
  mkdirSync(p.siteImages, { recursive: true });
  const manifest = loadManifest(candidateId);
  const prior = manifest.slots?.[slot.key] || null;
  let variants = [...(prior?.variants || [])];
  if (prior?.filename && existsSync(path.join(p.siteImages, prior.filename))) {
    variants = pushSlotTrayEntry(p.siteImages, variants, {
      filename: prior.filename,
      source: prior.source || 'stock',
      provider: prior.provider || null,
      photoId: prior.photoId || null,
      attribution: prior.attribution || null,
      matchGrade: prior.matchGrade || null,
    });
  }
  const filename = `${safeName(slot.key)}-${fileStem}-${Date.now().toString(36)}.jpg`;
  writeFileSync(path.join(p.siteImages, filename), buffer);
  const config = loadAcceptedSiteConfig(candidateId)?.config || {};
  const niche = String(config.niche || 'home service').trim();
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
    variants,
  };
  const nextManifest = saveSlotIntoManifest(candidateId, entry);
  const synced = await syncSiteImagesToPublicAsync(candidateId);
  const contentUpdate = applyImagesToContentFiles(candidateId, [
    ...Object.values(nextManifest.slots || {}).filter((s) => s?.filename),
  ]);
  addLastCost(candidateId, costKey, costDelta);
  return {
    ok: true,
    slot: entry,
    synced,
    contentUpdate,
    manifest: nextManifest,
    status: slotStatusPayload(candidateId, slot.key),
    human: [`Generated OpenAI photo for ${slot.key} (${niche}).`],
  };
}

export function useImageSlotVariant(candidateId, slotKey, { filename } = {}) {
  const want = path.basename(String(filename || ''));
  if (!want) throw Object.assign(new Error('filename required'), { status: 400 });
  const p = pathsFor(candidateId);
  const destKey = String(slotKey || '');
  const manifest = loadManifest(candidateId);
  const slots = manifest.slots || {};
  let dest = slots[destKey] || { key: destKey, variants: [] };
  let destVariants = [...(dest.variants || [])];
  let idx = destVariants.findIndex((v) => path.basename(String(v.filename || '')) === want);
  let picked = idx >= 0 ? destVariants[idx] : null;
  if (idx >= 0) destVariants.splice(idx, 1);

  if (!picked) {
    for (const [key, slot] of Object.entries(slots)) {
      if (key === destKey) continue;
      const list = [...(slot?.variants || [])];
      const i = list.findIndex((v) => path.basename(String(v.filename || '')) === want);
      if (i < 0) continue;
      picked = list[i];
      list.splice(i, 1);
      saveSlotIntoManifest(candidateId, { ...slot, key, variants: list });
      dest = loadManifest(candidateId).slots?.[destKey] || dest;
      destVariants = [...(dest.variants || [])];
      break;
    }
  }

  if (!picked) throw Object.assign(new Error('Variant not found'), { status: 404 });
  if (!existsSync(path.join(p.siteImages, picked.filename))) {
    throw Object.assign(new Error('Variant file missing on disk'), { status: 404 });
  }
  const priorLive = dest?.filename ? path.basename(String(dest.filename)) : '';
  let nextVariants = destVariants;
  if (priorLive && priorLive !== picked.filename) {
    const liveAsVar = {
      id: picked.id || `var-${Date.now().toString(36)}`,
      filename: dest.filename,
      source: dest.source || null,
      provider: dest.provider || null,
      photoId: dest.photoId || null,
      attribution: dest.attribution || null,
      matchGrade: dest.matchGrade || null,
      generatedAt: new Date().toISOString(),
    };
    nextVariants = pushSlotTrayEntry(p.siteImages, destVariants, liveAsVar, {
      liveFilename: picked.filename,
      livePhotoId: picked.photoId || dest.photoId,
    });
  }
  const entry = {
    ...dest,
    key: dest.key || destKey,
    filename: picked.filename,
    src: `/images/${picked.filename}`,
    source: picked.source || dest.source || 'photo-group',
    provider: picked.provider || dest.provider || null,
    photoId: picked.photoId || dest.photoId || null,
    attribution: picked.attribution || dest.attribution || null,
    matchGrade: picked.matchGrade || dest.matchGrade || 'ok',
    matchTip: dest.filename ? dest.matchTip : 'Loaded from similar photo-group title',
    variants: nextVariants,
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
    status: slotStatusPayload(candidateId, destKey),
  };
}

export async function generateCandidateBaPairOpenai(
  candidateId,
  { viewpoint, occupancy, serviceSlug = '', pairIndex = 1, before, after } = {},
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
  const resolved = resolveBaPromptsWithOverride(candidateId, {
    serviceSlug: slug,
    pairIndex,
    viewpoint,
    occupancy,
    before,
    after,
  });
  if (String(before || '').trim() || String(after || '').trim()) {
    persistBaOverrideIfBody(
      pathsFor(candidateId).openaiPrompts,
      resolved.key,
      resolved.viewpoint,
      {
        before: applyOccupancyToPrompt(resolved.originalBefore, occupancy),
        after: applyOccupancyToPrompt(resolved.originalAfter, occupancy),
      },
      { before: resolved.before, after: resolved.after },
    );
  }
  const beforePrompt = resolved.before;
  const afterPrompt = resolved.after;
  const beforeImg = await generateOpenaiImage({ prompt: beforePrompt });
  const afterImg = await editOpenaiImage({ prompt: afterPrompt, imageBuffer: beforeImg.buffer });
  archiveLiveBaPairToTray(candidateId, { serviceSlug: slug, pairIndex });
  const written = writeGeneratedBaPair(candidateId, {
    serviceSlug: slug,
    pairIndex,
    beforeBuffer: beforeImg.buffer,
    afterBuffer: afterImg.buffer,
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
  return {
    ok: true,
    scope: written.scope,
    files: written.files,
    status: baStatusPayload(candidateId, { serviceSlug: slug, pairIndex }),
    human: [`Generated OpenAI before/after pair${serviceName ? ` for ${serviceName}` : ''}.`],
  };
}

export function useCandidateBaVariant(
  candidateId,
  { pairId, matchKey = '', serviceSlug = '', pairIndex = 1, beforeFilename = '' } = {},
) {
  const parsed = resolveBaVariantTarget({ matchKey, serviceSlug, pairIndex });
  const key = parsed.key;
  const slug = parsed.serviceSlug;
  const idxN = parsed.pairIndex;
  const p = pathsFor(candidateId);
  const doc = loadBaVariantsDoc(candidateId);
  const wantId = String(pairId || '').trim();
  const wantBefore = path.basename(String(beforeFilename || ''));

  const findInList = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    let i = wantId ? list.findIndex((v) => v.id === wantId) : -1;
    if (i < 0 && wantBefore) {
      i = list.findIndex((v) => path.basename(String(v.beforeFilename || '')) === wantBefore);
    }
    return i;
  };

  let listKey = key;
  let list = [...(doc[key] || [])];
  let idx = findInList(list);
  if (idx < 0) {
    for (const [k, rows] of Object.entries(doc)) {
      if (k.startsWith('_') || !Array.isArray(rows)) continue;
      const i = findInList(rows);
      if (i < 0) continue;
      listKey = k;
      list = [...rows];
      idx = i;
      break;
    }
  }
  if (idx < 0) throw Object.assign(new Error('Pair variant not found'), { status: 404 });
  const picked = list[idx];
  const live = findLiveBaFiles(candidateId, { serviceSlug: slug, pairIndex: idxN });
  const stamp = Date.now().toString(36);
  const prefix = slug ? `svc-ba-${slug}` : `gallery-ba-${idxN}`;
  const liveBeforeDest = live.before ? `${prefix}-var-${stamp}-before${path.extname(live.before) || '.jpg'}` : null;
  const liveAfterDest = live.after ? `${prefix}-var-${stamp}-after${path.extname(live.after) || '.jpg'}` : null;
  if (liveBeforeDest) {
    copyFileSync(path.join(p.siteImages, live.before), path.join(p.siteImages, liveBeforeDest));
  }
  if (liveAfterDest) {
    copyFileSync(path.join(p.siteImages, live.after), path.join(p.siteImages, liveAfterDest));
  }
  const beforeBuf = picked.beforeFilename
    ? readFileSync(path.join(p.siteImages, path.basename(String(picked.beforeFilename))))
    : null;
  const afterBuf = picked.afterFilename
    ? readFileSync(path.join(p.siteImages, path.basename(String(picked.afterFilename))))
    : null;
  if (!beforeBuf || !afterBuf) {
    throw Object.assign(new Error('Variant pair files missing'), { status: 404 });
  }
  const src = String(picked.source || '').toLowerCase();
  const sourceLabel =
    src === 'openai' ? 'GPT Image 2 (OpenAI)' : src === 'chatgpt' ? 'ChatGPT' : 'prior';
  writeGeneratedBaPair(candidateId, {
    serviceSlug: slug,
    pairIndex: idxN,
    beforeBuffer: beforeBuf,
    afterBuffer: afterBuf,
    sourceLabel,
  });
  list.splice(idx, 1);
  if (listKey !== key) doc[listKey] = trimVariants(p.siteImages, list);
  if (liveBeforeDest || liveAfterDest) {
    const destList = listKey === key ? list : [...(doc[key] || [])];
    doc[key] = pushBaTrayEntry(p.siteImages, destList, {
      id: `var-${stamp}`,
      beforeFilename: liveBeforeDest,
      afterFilename: liveAfterDest,
      source: 'prior',
      generatedAt: new Date().toISOString(),
    });
  } else if (listKey === key) {
    doc[key] = trimVariants(p.siteImages, list);
  }
  saveBaVariantsDoc(candidateId, doc);
  return { ok: true, status: baStatusPayload(candidateId, { serviceSlug: slug, pairIndex: idxN }) };
}
