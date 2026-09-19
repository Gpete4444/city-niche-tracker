/**
 * Tray identity: keep one copy of a photo / BA pair (photoId or file SHA-256).
 * Unique filenames of the same bytes are skipped and unlinked.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export const IMAGE_TRAY_CAP = 8;

export function unlinkQuiet(abs) {
  try {
    if (abs && existsSync(abs)) unlinkSync(abs);
  } catch {
    /* ignore */
  }
}

export function fileFingerprint(abs) {
  if (!abs || !existsSync(abs)) return null;
  try {
    return createHash('sha256').update(readFileSync(abs)).digest('hex');
  } catch {
    return null;
  }
}

function baseName(name) {
  const n = String(name || '').trim();
  return n ? path.basename(n) : '';
}

function fileAbs(dir, name) {
  const n = baseName(name);
  return n && dir ? path.join(dir, n) : null;
}

function newTrayId() {
  return `var-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function slotEntryFingerprint(dir, entry) {
  if (entry?.fingerprint) return String(entry.fingerprint);
  return fileFingerprint(fileAbs(dir, entry?.filename));
}

export function baEntryFingerprint(dir, entry) {
  if (entry?.fingerprint) return String(entry.fingerprint);
  const b = fileFingerprint(fileAbs(dir, entry?.beforeFilename));
  const a = fileFingerprint(fileAbs(dir, entry?.afterFilename));
  if (!b && !a) return null;
  return `${b || ''}|${a || ''}`;
}

/** True when both BA filenames are set and both files exist in dir. */
export function baEntryFilesOnDisk(dir, entry) {
  const b = baseName(entry?.beforeFilename);
  const a = baseName(entry?.afterFilename);
  if (!b || !a || !dir) return false;
  return existsSync(path.join(dir, b)) && existsSync(path.join(dir, a));
}

function slotIdentities(dir, entry) {
  const ids = new Set();
  if (entry?.photoId) ids.add(`id:${entry.photoId}`);
  const fp = slotEntryFingerprint(dir, entry);
  if (fp) ids.add(`fp:${fp}`);
  const fn = baseName(entry?.filename);
  if (fn) ids.add(`fn:${fn}`);
  return ids;
}

function baIdentities(dir, entry) {
  const ids = new Set();
  const fp = baEntryFingerprint(dir, entry);
  if (fp) ids.add(`fp:${fp}`);
  const b = baseName(entry?.beforeFilename);
  const a = baseName(entry?.afterFilename);
  if (b || a) ids.add(`fn:${b}|${a}`);
  return ids;
}

function identitiesOverlap(a, b) {
  if (!a?.size || !b?.size) return false;
  for (const x of a) {
    if (b.has(x)) return true;
  }
  return false;
}

function protectSet(names) {
  return new Set((names || []).map(baseName).filter(Boolean));
}

function unlinkTrayFiles(dir, entry, protect) {
  for (const key of ['filename', 'beforeFilename', 'afterFilename']) {
    const n = baseName(entry?.[key]);
    if (!n || protect.has(n)) continue;
    unlinkQuiet(path.join(dir, n));
  }
}

export function trimTrayVariants(dir, variants, cap = IMAGE_TRAY_CAP, protectNames = []) {
  const protect = protectSet(protectNames);
  const list = Array.isArray(variants) ? variants : [];
  const kept = list.slice(0, cap);
  for (const v of list.slice(cap)) unlinkTrayFiles(dir, v, protect);
  return kept;
}

function annotateSlot(dir, entry) {
  const fp = slotEntryFingerprint(dir, entry);
  if (fp && entry?.fingerprint !== fp) return { ...entry, fingerprint: fp };
  return entry;
}

function annotateBa(dir, entry) {
  const fp = baEntryFingerprint(dir, entry);
  if (fp && entry?.fingerprint !== fp) return { ...entry, fingerprint: fp };
  return entry;
}

export function compactSlotTray(
  dir,
  variants,
  { liveFilename = '', livePhotoId = null, cap = IMAGE_TRAY_CAP } = {},
) {
  const live = {
    filename: baseName(liveFilename),
    photoId: livePhotoId || null,
  };
  const liveIds = live.filename || live.photoId ? slotIdentities(dir, live) : new Set();
  const protect = protectSet([live.filename]);
  const seen = new Set();
  const kept = [];
  for (const v of variants || []) {
    const ids = slotIdentities(dir, v);
    if (liveIds.size && identitiesOverlap(ids, liveIds)) {
      unlinkTrayFiles(dir, v, protect);
      continue;
    }
    const keys = [...ids];
    if (keys.length && keys.some((k) => seen.has(k))) {
      unlinkTrayFiles(dir, v, protect);
      continue;
    }
    for (const k of keys) seen.add(k);
    kept.push(annotateSlot(dir, v));
  }
  return trimTrayVariants(dir, kept, cap, [live.filename]);
}

export function compactBaTray(
  dir,
  variants,
  { liveBefore = '', liveAfter = '', cap = IMAGE_TRAY_CAP } = {},
) {
  const live = {
    beforeFilename: baseName(liveBefore),
    afterFilename: baseName(liveAfter),
  };
  const liveIds = live.beforeFilename || live.afterFilename ? baIdentities(dir, live) : new Set();
  const protect = protectSet([live.beforeFilename, live.afterFilename]);
  const seen = new Set();
  const kept = [];
  for (const v of variants || []) {
    if (!baEntryFilesOnDisk(dir, v)) {
      unlinkTrayFiles(dir, v, protect);
      continue;
    }
    const ids = baIdentities(dir, v);
    if (liveIds.size && identitiesOverlap(ids, liveIds)) {
      unlinkTrayFiles(dir, v, protect);
      continue;
    }
    const keys = [...ids];
    if (keys.length && keys.some((k) => seen.has(k))) {
      unlinkTrayFiles(dir, v, protect);
      continue;
    }
    for (const k of keys) seen.add(k);
    kept.push(annotateBa(dir, v));
  }
  return trimTrayVariants(dir, kept, cap, [live.beforeFilename, live.afterFilename]);
}

export function slotSourceIsDuplicate(
  dir,
  { abs = '', filename = '', photoId = null, fingerprint = null } = {},
  { liveFilename = '', livePhotoId = null, variants = [] } = {},
) {
  const incoming = {
    filename: baseName(filename),
    photoId: photoId || null,
    fingerprint: fingerprint || (abs ? fileFingerprint(abs) : null),
  };
  const ids = slotIdentities(dir, incoming);
  if (!ids.size) return false;
  const liveIds = slotIdentities(dir, {
    filename: baseName(liveFilename),
    photoId: livePhotoId || null,
  });
  if (identitiesOverlap(ids, liveIds)) return true;
  return (variants || []).some((v) => identitiesOverlap(ids, slotIdentities(dir, v)));
}

export function baSourceIsDuplicate(
  dir,
  { beforeAbs = '', afterAbs = '', beforeFilename = '', afterFilename = '', fingerprint = null } = {},
  { liveBefore = '', liveAfter = '', variants = [] } = {},
) {
  const incoming = {
    beforeFilename: baseName(beforeFilename),
    afterFilename: baseName(afterFilename),
    fingerprint:
      fingerprint ||
      (() => {
        const b = fileFingerprint(beforeAbs);
        const a = fileFingerprint(afterAbs);
        if (!b && !a) return null;
        return `${b || ''}|${a || ''}`;
      })(),
  };
  const ids = baIdentities(dir, incoming);
  if (!ids.size) return false;
  const liveIds = baIdentities(dir, {
    beforeFilename: baseName(liveBefore),
    afterFilename: baseName(liveAfter),
  });
  if (identitiesOverlap(ids, liveIds)) return true;
  return (variants || []).some((v) => identitiesOverlap(ids, baIdentities(dir, v)));
}

export function pushSlotTrayEntry(
  dir,
  variants,
  entry,
  { liveFilename = '', livePhotoId = null, cap = IMAGE_TRAY_CAP } = {},
) {
  const filename = baseName(entry?.filename);
  const list = Array.isArray(variants) ? [...variants] : [];
  if (!filename) return compactSlotTray(dir, list, { liveFilename, livePhotoId, cap });
  const incoming = {
    ...entry,
    filename,
    photoId: entry.photoId || null,
  };
  const ids = slotIdentities(dir, incoming);
  const liveIds = slotIdentities(dir, {
    filename: baseName(liveFilename),
    photoId: livePhotoId || null,
  });
  const protect = protectSet([liveFilename, filename === baseName(liveFilename) ? filename : '']);
  const isLiveFile = filename === baseName(liveFilename);
  if (liveIds.size && identitiesOverlap(ids, liveIds) && !isLiveFile) {
    unlinkTrayFiles(dir, incoming, protectSet([liveFilename]));
    return compactSlotTray(dir, list, { liveFilename, livePhotoId, cap });
  }
  if (list.some((v) => identitiesOverlap(ids, slotIdentities(dir, v)))) {
    if (!isLiveFile && !list.some((v) => baseName(v.filename) === filename)) {
      unlinkTrayFiles(dir, incoming, protectSet([liveFilename]));
    }
    return compactSlotTray(dir, list, { liveFilename, livePhotoId, cap });
  }
  list.unshift({
    id: incoming.id || newTrayId(),
    filename,
    source: incoming.source || 'photo-group',
    provider: incoming.provider || null,
    photoId: incoming.photoId,
    attribution: incoming.attribution || null,
    matchGrade: incoming.matchGrade || null,
    generatedAt: incoming.generatedAt || new Date().toISOString(),
    fingerprint: slotEntryFingerprint(dir, incoming),
  });
  return compactSlotTray(dir, list, { liveFilename, livePhotoId, cap });
}

export function pushBaTrayEntry(
  dir,
  variants,
  entry,
  { liveBefore = '', liveAfter = '', cap = IMAGE_TRAY_CAP } = {},
) {
  const beforeFilename = baseName(entry?.beforeFilename) || null;
  const afterFilename = baseName(entry?.afterFilename) || null;
  const list = Array.isArray(variants) ? [...variants] : [];
  if (!beforeFilename && !afterFilename) {
    return compactBaTray(dir, list, { liveBefore, liveAfter, cap });
  }
  const incoming = { ...entry, beforeFilename, afterFilename };
  const ids = baIdentities(dir, incoming);
  const liveIds = baIdentities(dir, {
    beforeFilename: baseName(liveBefore),
    afterFilename: baseName(liveAfter),
  });
  const isLivePair =
    beforeFilename === baseName(liveBefore) && afterFilename === baseName(liveAfter);
  if (liveIds.size && identitiesOverlap(ids, liveIds) && !isLivePair) {
    unlinkTrayFiles(dir, incoming, protectSet([liveBefore, liveAfter]));
    return compactBaTray(dir, list, { liveBefore, liveAfter, cap });
  }
  if (list.some((v) => identitiesOverlap(ids, baIdentities(dir, v)))) {
    if (!isLivePair) unlinkTrayFiles(dir, incoming, protectSet([liveBefore, liveAfter]));
    return compactBaTray(dir, list, { liveBefore, liveAfter, cap });
  }
  list.unshift({
    id: incoming.id || newTrayId(),
    beforeFilename,
    afterFilename,
    source: incoming.source || 'photo-group',
    serviceSlug: incoming.serviceSlug || '',
    pairIndex: incoming.pairIndex || 1,
    generatedAt: incoming.generatedAt || new Date().toISOString(),
    fingerprint: baEntryFingerprint(dir, incoming),
  });
  return compactBaTray(dir, list, { liveBefore, liveAfter, cap });
}

export function trayListsEqual(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}
