/**
 * Named niche photo groups: save filled Review images (stock, uploads, ChatGPT
 * before/after) and load them onto a later candidate. Match by role, not by
 * copying Structure. Ranked groups fill live slots first; leftover matching
 * photos go into that slot’s tray. Materials and process stills also fan out
 * by canonical title to every same-titled slot (home + services). If a slot is
 * still empty after that, the first tray still becomes live. Other unused
 * photos still go to the best matching tray (click Use). Service before/after pairs tray onto every similar service, not only one best name.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { RESEARCH_DIR, getCandidateDetail, pathsFor } from './candidates.mjs';
import {
  listConfiguredServiceTargets,
  rehydrateGalleryBaFrontmatter,
  archiveLiveBaPairToTray,
  baVariantKey,
  findLiveBaFiles,
  resolveBaVariantTarget,
  setBaTrayEntries,
  stampBaPairMeta,
  writeGeneratedBaPair,
} from './chatgpt-before-after.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { getContentStructure } from './content-structure.mjs';
import {
  applyImagesToContentFiles,
  imageSlotCardStatus,
  listImageSlots,
  promoteFirstTrayIntoEmptySlots,
  saveSlotIntoManifest,
  syncSiteImagesToPublic,
  pushImageSlotTrayEntry,
} from './fill-site-images.mjs';
import { baStatusPayload, useImageSlotVariant } from './openai-generate.mjs';
import { baSourceIsDuplicate, slotSourceIsDuplicate } from './image-tray.mjs';

const ROOT = process.cwd();
export const PHOTO_GROUPS_DIR = path.join(RESEARCH_DIR, '_photo-groups');
const INDEX_FILE = path.join(PHOTO_GROUPS_DIR, 'index.json');

const SKIP_SAVE_NAMES =
  /^(logo\.(svg|png)|coverage-map\.svg)$/i;
const HOME_BA_RE = /^gallery-ba-(\d+)-(before|after)\.(\w+)$/i;
const SVC_BA_RE = /^svc-ba-([a-z0-9-]+)-(\d+)-(before|after)\.(\w+)$/i;

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function nicheOf(candidateId) {
  const loaded = loadAcceptedSiteConfig(candidateId);
  return String(loaded?.config?.niche || '').trim();
}

export function nichesEqual(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function slugifyName(name) {
  return (
    String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'group'
  );
}

function normService(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function loadIndex() {
  const doc = readJson(INDEX_FILE, { version: 1, groups: [] });
  if (!Array.isArray(doc.groups)) doc.groups = [];
  return doc;
}

function saveIndex(doc) {
  writeJson(INDEX_FILE, { version: 1, groups: doc.groups || [] });
}

function groupDir(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw Object.assign(new Error('Invalid photo group id'), { status: 400 });
  return path.join(PHOTO_GROUPS_DIR, safe);
}

export function listPhotoGroups({ niche } = {}) {
  let groups = loadIndex().groups || [];
  if (niche) groups = groups.filter((g) => nichesEqual(g.niche, niche));
  return groups.slice().sort((a, b) => {
    const am = a.kind === 'master' ? 0 : 1;
    const bm = b.kind === 'master' ? 0 : 1;
    if (am !== bm) return am - bm;
    return String(b.savedAt || '').localeCompare(String(a.savedAt || ''));
  });
}

export function findNicheMaster(niche) {
  if (!String(niche || '').trim()) return null;
  return (loadIndex().groups || []).find((g) => g.kind === 'master' && nichesEqual(g.niche, niche)) || null;
}

export function masterIdForNiche(niche) {
  return `master-${slugifyName(niche)}`;
}

export function listPhotoGroupNiches() {
  const seen = new Set();
  const out = [];
  for (const g of loadIndex().groups || []) {
    const n = String(g.niche || '').trim();
    if (!n) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function rolesFromGroupSlots(slots, beforeAfter) {
  const roles = [];
  const seen = new Set();
  const add = (k) => {
    if (!k || seen.has(k)) return;
    seen.add(k);
    roles.push(k);
  };
  for (const s of slots || []) add(matchKeyForSlot(s));
  for (const p of beforeAfter?.home || []) add(`ba:home:${p.pairIndex || 1}`);
  for (const p of beforeAfter?.services || []) {
    add(`ba:svc:${normService(p.serviceName || p.serviceSlug)}`);
  }
  return roles;
}

export function getPhotoGroup(groupId) {
  const meta = (loadIndex().groups || []).find((g) => g.id === groupId);
  if (!meta) {
    throw Object.assign(new Error('Photo group not found'), { status: 404 });
  }
  const dir = groupDir(meta.id);
  const slots = readJson(path.join(dir, 'slots.json'), []) || [];
  const beforeAfter = readJson(path.join(dir, 'beforeAfter.json'), {
    home: [],
    services: [],
  });
  return { ...meta, dir, slots, beforeAfter };
}

export function persistPhotoGroupRecord(group) {
  const dir = group.dir || groupDir(group.id);
  mkdirSync(dir, { recursive: true });
  const slots = group.slots || [];
  const beforeAfter = group.beforeAfter || { home: [], services: [] };
  writeJson(path.join(dir, 'slots.json'), slots);
  writeJson(path.join(dir, 'beforeAfter.json'), beforeAfter);
  const prev = (loadIndex().groups || []).find((g) => g.id === group.id) || {};
  const meta = {
    id: group.id,
    name: group.name || prev.name,
    niche: group.niche || prev.niche,
    kind: group.kind || prev.kind || 'named',
    savedAt: new Date().toISOString(),
    slotCount: slots.length,
    baPairCount: (beforeAfter.home || []).length + (beforeAfter.services || []).length,
    sourceCandidateId: group.sourceCandidateId || prev.sourceCandidateId || null,
    roles: rolesFromGroupSlots(slots, beforeAfter),
  };
  const groups = (loadIndex().groups || []).filter((g) => g.id !== meta.id);
  if (meta.kind === 'master') groups.unshift(meta);
  else {
    const masters = groups.filter((g) => g.kind === 'master');
    const rest = groups.filter((g) => g.kind !== 'master');
    saveIndex({ groups: [...masters, meta, ...rest] });
    return { ...meta, dir, slots, beforeAfter };
  }
  saveIndex({ groups });
  return { ...meta, dir, slots, beforeAfter };
}

export function dropPhotoGroupFromIndex(groupId) {
  const index = loadIndex();
  saveIndex({ groups: (index.groups || []).filter((g) => g.id !== groupId) });
}

export function readPhotoGroupFile(groupId, filename) {
  const safe = path.basename(String(filename || ''));
  if (!safe || safe.includes('..')) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  const group = getPhotoGroup(groupId);
  const abs = path.join(group.dir, safe);
  if (!existsSync(abs)) {
    throw Object.assign(new Error('Image not found'), { status: 404 });
  }
  return { abs, filename: safe };
}

export function getAttachedPhotoGroup(candidateId) {
  const doc = readJson(pathsFor(candidateId).photoGroup);
  if (!doc || doc.skipped) return null;
  const groupIds = normalizePhotoGroupIds(doc);
  if (!groupIds.length) return null;
  return { ...doc, groupIds, groupId: groupIds[0] };
}

/** Last applied ranking from the images manifest, else Content attach sidecar. */
export function loadedPhotoGroupIds(candidateId) {
  const fromManifest = normalizePhotoGroupIds({
    groupIds: loadManifest(candidateId).photoGroupIds || [],
  });
  if (fromManifest.length) return fromManifest;
  return getAttachedPhotoGroup(candidateId)?.groupIds || [];
}

/** True if See More / Use may copy from this library group (applied or attached). */
export function groupIdIsLoaded(candidateId, groupId) {
  const id = String(groupId || '').trim();
  if (!id) return false;
  const fromManifest = normalizePhotoGroupIds({
    groupIds: loadManifest(candidateId).photoGroupIds || [],
  });
  if (fromManifest.includes(id)) return true;
  return (getAttachedPhotoGroup(candidateId)?.groupIds || []).includes(id);
}

function namesForGroupIds(groupIds) {
  const names = [];
  for (const gid of groupIds || []) {
    try {
      names.push(getPhotoGroup(gid).name);
    } catch {
      /* missing library row */
    }
  }
  return names;
}

/** Persist `{id}-photo-group.json` so Accept, rank dropdowns, and See More share one ranking. */
export function persistAttachedPhotoGroups(candidateId, groups, extra = {}) {
  const list = Array.isArray(groups) ? groups.filter((g) => g && g.id) : [];
  if (!list.length) {
    throw Object.assign(new Error('Pick at least one photo group'), { status: 400 });
  }
  const first = list[0];
  const ids = list.map((g) => g.id);
  const names = list.map((g) => g.name);
  const attachedAt = extra.attachedAt || new Date().toISOString();
  const doc = {
    ...extra,
    groupId: first.id,
    groupIds: ids,
    name: first.name,
    names,
    niche: first.niche || extra.niche || '',
    attachedAt,
  };
  delete doc.skipped;
  writeJson(pathsFor(candidateId).photoGroup, doc);
  return {
    groupId: first.id,
    groupIds: ids,
    name: first.name,
    names,
    attachedAt,
  };
}

export function listAttachedGroupStills(candidateId) {
  const groupIds = loadedPhotoGroupIds(candidateId);
  if (!groupIds.length) return { photos: [], groupIds: [], names: [] };
  const photos = [];
  const seen = new Set();
  for (const gid of groupIds) {
    let group;
    try {
      group = getPhotoGroup(gid);
    } catch {
      continue;
    }
    for (const saved of group.slots || []) {
      for (const row of slotFileRows(saved)) {
        const id = `${group.id}\0${row.filename}`;
        if (!row.filename || seen.has(id)) continue;
        seen.add(id);
        photos.push({
          groupId: group.id,
          groupName: group.name,
          filename: row.filename,
          previewUrl: `/api/photo-groups/${encodeURIComponent(group.id)}/file/${encodeURIComponent(row.filename)}?v=${encodeURIComponent(row.filename)}`,
          label: saved.materialTitle || saved.processTitle || saved.label || row.filename,
        });
      }
    }
  }
  return {
    photos,
    groupIds,
    names: namesForGroupIds(groupIds),
  };
}

function groupFilePreviewUrl(groupId, filename) {
  return `/api/photo-groups/${encodeURIComponent(groupId)}/file/${encodeURIComponent(filename)}?v=${encodeURIComponent(filename)}`;
}

function groupHasFile(group, filename) {
  const name = path.basename(String(filename || ''));
  return Boolean(name && existsSync(path.join(group.dir, name)));
}

export function listAttachedGroupBaPairs(candidateId) {
  const groupIds = loadedPhotoGroupIds(candidateId);
  if (!groupIds.length) return { pairs: [], groupIds: [], names: [] };
  const pairs = [];
  const seen = new Set();
  const push = (group, beforeFilename, afterFilename, roleLabel) => {
    const before = path.basename(String(beforeFilename || ''));
    const after = path.basename(String(afterFilename || ''));
    if (!groupHasFile(group, before) || !groupHasFile(group, after)) return;
    const id = `${group.id}\0${before}\0${after}`;
    if (seen.has(id)) return;
    seen.add(id);
    const label = group.name ? `${roleLabel} · ${group.name}` : roleLabel;
    pairs.push({
      groupId: group.id,
      groupName: group.name,
      beforeFilename: before,
      afterFilename: after,
      beforeUrl: groupFilePreviewUrl(group.id, before),
      afterUrl: groupFilePreviewUrl(group.id, after),
      label,
    });
  };
  for (const gid of groupIds) {
    let group;
    try {
      group = getPhotoGroup(gid);
    } catch {
      continue;
    }
    for (const p of group.beforeAfter?.home || []) {
      const role = `Home ${p.pairIndex || 1}`;
      push(group, p.before?.filename, p.after?.filename, role);
      for (const v of p.variants || []) {
        push(group, v.beforeFilename, v.afterFilename, role);
      }
    }
    for (const p of group.beforeAfter?.services || []) {
      const role = p.serviceName || p.serviceSlug || 'Service';
      push(group, p.before?.filename, p.after?.filename, role);
      for (const v of p.variants || []) {
        push(group, v.beforeFilename, v.afterFilename, role);
      }
    }
  }
  return {
    pairs,
    groupIds,
    names: namesForGroupIds(groupIds),
  };
}

export function useGroupBaPairOnSlot(
  candidateId,
  matchKey,
  { groupId, beforeFilename, afterFilename } = {},
) {
  const gid = String(groupId || '').trim();
  const wantBefore = path.basename(String(beforeFilename || ''));
  const wantAfter = path.basename(String(afterFilename || ''));
  if (!gid || !wantBefore || !wantAfter) {
    throw Object.assign(new Error('groupId, beforeFilename, and afterFilename required'), {
      status: 400,
    });
  }
  if (!groupIdIsLoaded(candidateId, gid)) {
    throw Object.assign(new Error('Pair is not in a loaded photo group'), { status: 400 });
  }
  let key = String(matchKey || '').trim();
  if (key.startsWith('ba:')) key = key.slice(3);
  const parsed = resolveBaVariantTarget({ matchKey: key });
  const group = getPhotoGroup(gid);
  const beforeAbs = path.join(group.dir, wantBefore);
  const afterAbs = path.join(group.dir, wantAfter);
  if (!existsSync(beforeAbs) || !existsSync(afterAbs)) {
    throw Object.assign(new Error('Pair not found in photo group'), { status: 404 });
  }
  archiveLiveBaPairToTray(candidateId, {
    serviceSlug: parsed.serviceSlug,
    pairIndex: parsed.pairIndex,
  });
  writeGeneratedBaPair(candidateId, {
    serviceSlug: parsed.serviceSlug,
    pairIndex: parsed.pairIndex,
    beforeBuffer: readFileSync(beforeAbs),
    afterBuffer: readFileSync(afterAbs),
    sourceLabel: 'photo group',
  });
  stampBaPairMeta(candidateId, parsed.key, {
    source: 'photo-group',
    matchGrade: 'ok',
    matchTip: 'Loaded from photo group',
    matchGradeManual: false,
  });
  return {
    ok: true,
    status: baStatusPayload(candidateId, {
      serviceSlug: parsed.serviceSlug,
      pairIndex: parsed.pairIndex,
    }),
  };
}

export function useGroupFileOnSlot(candidateId, slotKey, { groupId, filename } = {}) {
  const want = path.basename(String(filename || ''));
  const gid = String(groupId || '').trim();
  if (!want || !gid) {
    throw Object.assign(new Error('groupId and filename required'), { status: 400 });
  }
  if (!groupIdIsLoaded(candidateId, gid)) {
    throw Object.assign(new Error('Photo is not in a loaded photo group'), { status: 400 });
  }
  const target = listImageSlots(candidateId).find((s) => s.key === slotKey);
  if (!target) {
    throw Object.assign(new Error(`Unknown image slot: ${slotKey}`), { status: 404 });
  }
  const group = getPhotoGroup(gid);
  const p = pathsFor(candidateId);
  const destName = copyGroupFile(group.dir, want, p.siteImages, `see-${want}`, { unique: true });
  if (!destName) {
    throw Object.assign(new Error('Image not found in photo group'), { status: 404 });
  }
  const destAbs = path.join(p.siteImages, destName);
  const manifest = loadManifest(candidateId);
  const dest = manifest.slots?.[slotKey] || stubSlotEntry(target);
  const incoming = { abs: destAbs, filename: destName, photoId: null };
  const dropCopy = () => {
    try {
      if (existsSync(destAbs)) unlinkSync(destAbs);
    } catch {
      // ignore
    }
  };

  if (
    dest.filename &&
    slotSourceIsDuplicate(p.siteImages, incoming, {
      liveFilename: dest.filename,
      livePhotoId: dest.photoId,
      variants: [],
    })
  ) {
    dropCopy();
    return {
      ok: true,
      slot: dest,
      status: { slot: imageSlotCardStatus(candidateId, slotKey) },
    };
  }

  const trayHit = (dest.variants || []).find((v) =>
    slotSourceIsDuplicate(p.siteImages, incoming, {
      liveFilename: '',
      livePhotoId: null,
      variants: [v],
    }),
  );
  if (trayHit?.filename) {
    dropCopy();
    return useImageSlotVariant(candidateId, slotKey, { filename: trayHit.filename });
  }

  dest.variants = pushImageSlotTrayEntry(
    p.siteImages,
    dest.variants,
    {
      filename: destName,
      source: 'photo-group',
      matchGrade: 'ok',
    },
    { liveFilename: dest.filename, livePhotoId: dest.photoId },
  );
  saveSlotIntoManifest(candidateId, dest);
  const stillOnTray = (dest.variants || []).some(
    (v) => path.basename(String(v.filename || '')) === destName,
  );
  if (!stillOnTray) {
    dropCopy();
    throw Object.assign(new Error('Could not add photo to this slot'), { status: 400 });
  }
  return useImageSlotVariant(candidateId, slotKey, { filename: destName });
}

/** Unique group ids from `{ groupIds }` or legacy `{ groupId }`, ranked in order. */
export function normalizePhotoGroupIds(input) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const raw = Array.isArray(body.groupIds)
    ? body.groupIds
    : Array.isArray(input)
      ? input
      : [];
  const alias = body.groupId ? [body.groupId] : typeof input === 'string' ? [input] : [];
  const list = (raw.length ? raw : alias).map((id) => String(id || '').trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const id of list) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function clearAttachedPhotoGroup(candidateId) {
  const file = pathsFor(candidateId).photoGroup;
  if (existsSync(file)) {
    try {
      unlinkSync(file);
    } catch {
      // ignore
    }
  }
  return { ok: true, candidate: getCandidateDetail(candidateId) };
}

function loadManifest(candidateId) {
  const p = pathsFor(candidateId);
  return (
    readJson(p.imagesManifest) || {
      version: 1,
      candidateId: p.id,
      usedIds: [],
      files: [],
      slots: {},
      sources: {},
      pulledAt: null,
    }
  );
}

export function collectBaFromDisk(siteImagesDir) {
  const homeByIndex = new Map();
  const servicesBySlug = new Map();
  if (!existsSync(siteImagesDir)) {
    return { home: [], services: [] };
  }
  for (const name of readdirSync(siteImagesDir)) {
    const home = name.match(HOME_BA_RE);
    if (home) {
      const idx = Number(home[1]);
      const role = home[2].toLowerCase();
      const rec = homeByIndex.get(idx) || { pairIndex: idx };
      rec[role] = { filename: name, ext: home[3] };
      homeByIndex.set(idx, rec);
      continue;
    }
    const svc = name.match(SVC_BA_RE);
    if (svc) {
      const slug = svc[1];
      const role = svc[3].toLowerCase();
      const rec = servicesBySlug.get(slug) || { serviceSlug: slug };
      rec[role] = { filename: name, ext: svc[4] };
      servicesBySlug.set(slug, rec);
    }
  }
  const home = [...homeByIndex.values()]
    .filter((p) => p.before && p.after)
    .sort((a, b) => a.pairIndex - b.pairIndex);
  const services = [...servicesBySlug.values()].filter((p) => p.before && p.after);
  return { home, services };
}

function homeBaEnabled(candidateId) {
  const s = getContentStructure(candidateId);
  if (!s) return false;
  if (s.photos?.beforeAfter?.enabled) return true;
  return (s.sections || []).includes('beforeAfter');
}

function svcBaEnabled(candidateId) {
  const s = getContentStructure(candidateId);
  if (!s) return false;
  const pages = s.pages || [];
  const servicesPageOn = !pages.length || pages.includes('services');
  if (!servicesPageOn) return false;
  if (s.photos?.svcBeforeAfter?.enabled) return true;
  return (s.sections || []).includes('svcBeforeAfter');
}

/** Trailing number on keys like process-8 or materials-3. */
export function indexFromSlotKey(key) {
  const m = String(key || '').match(/-(\d+)$/);
  return m ? Number(m[1]) : null;
}

const KEYISH_LABEL =
  /^(svcHero|process|offerProcess|materials|services|intro|hero|svcProcess|svcMaterials|aboutStory|leftover)(-\d+)?$/i;

export function looksLikeSlotKey(value, key) {
  const v = String(value || '').trim();
  if (!v) return true;
  if (key && v === key) return true;
  return KEYISH_LABEL.test(v);
}

/** Fill index / Structure titles so match-key and Review-images labels stay unique. */
export function mergeStructureOntoSlot(slot, struct = {}) {
  const index =
    Number(slot.index) ||
    Number(struct.index) ||
    indexFromSlotKey(slot.key) ||
    indexFromSlotKey(slot.filename) ||
    1;
  const labelFromSlot = looksLikeSlotKey(slot.label, slot.key) ? null : slot.label;
  return {
    ...slot,
    index,
    serviceName: slot.serviceName || struct.serviceName || null,
    processTitle: slot.processTitle || struct.processTitle || null,
    materialTitle: slot.materialTitle || struct.materialTitle || null,
    serviceSlug: slot.serviceSlug || struct.serviceSlug || null,
    label: labelFromSlot || struct.label || slot.label || null,
    sectionId: slot.sectionId || struct.sectionId || slot.sectionId,
    key: slot.key || struct.key || slot.key,
  };
}

export function matchKeyForSlot(slot) {
  const id = slot.sectionId;
  if (id === 'svcHero' || id === 'svcProcess' || id === 'svcMaterials') {
    const name = normService(slot.serviceName || slot.label || '');
    if (!name) return null;
    if (id === 'svcHero') return `svcHero:${name}`;
    return `${id}:${name}:${Number(slot.index) || 1}`;
  }
  if (id === 'services') {
    const name = normService(slot.serviceName || slot.label || '');
    if (name) return `services:${name}`;
    return `home:services:${Number(slot.index) || 1}`;
  }
  if (
    id === 'hero' ||
    id === 'intro' ||
    id === 'process' ||
    id === 'offerProcess' ||
    id === 'materials'
  ) {
    return `home:${id}:${Number(slot.index) || 1}`;
  }
  return `home:${id}:${Number(slot.index) || 1}`;
}

const TITLE_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'for',
  'to',
  'in',
  'on',
  'at',
  'with',
  'photo',
  'image',
  'step',
  'our',
  'your',
  'this',
  'that',
  'from',
  'into',
]);

function stemTitleToken(token) {
  let s = String(token || '');
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ions')) s = s.slice(0, -4);
  else if (s.length > 4 && s.endsWith('ion')) s = s.slice(0, -3);
  else if (s.length > 3 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('es') && !s.endsWith('ss')) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
}

function titleTokens(text) {
  const norm = normService(text);
  if (!norm) return [];
  const out = [];
  const seen = new Set();
  for (const raw of norm.split(/\s+/)) {
    if (raw.length < 2 || TITLE_STOPWORDS.has(raw)) continue;
    const stem = stemTitleToken(raw);
    if (!stem || TITLE_STOPWORDS.has(stem) || seen.has(stem)) continue;
    seen.add(stem);
    out.push(stem);
  }
  return out;
}

/** Distinctive titles only — not the stock query (niche words would match every slot). */
function distinctiveSlotText(slot) {
  const parts = [];
  const add = (value) => {
    const s = String(value || '').trim();
    if (!s || looksLikeSlotKey(s, slot?.key)) return;
    parts.push(s);
  };
  add(slot?.processTitle);
  add(slot?.materialTitle);
  add(slot?.serviceName);
  add(slot?.label);
  return parts.join(' ');
}

export function titleMatchScore(a, b) {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (!ta.length || !tb.length) return { score: 0, shared: 0, contained: 0 };
  const setB = new Set(tb);
  let shared = 0;
  for (const t of ta) if (setB.has(t)) shared += 1;
  if (!shared) return { score: 0, shared: 0, contained: 0 };
  const shorter = Math.min(ta.length, tb.length);
  const union = new Set([...ta, ...tb]).size;
  const jaccard = shared / union;
  const contained = shared / shorter;
  return { score: Math.max(jaccard, contained), shared, contained };
}

export function isMediumTitleMatch(result) {
  if (!result || result.shared < 1) return false;
  if (result.shared >= 2) return true;
  return result.contained >= 0.6;
}

/** Materials/process title only — not service name (that blocked same-title fan-out). */
export function canonicalSlotTitle(slot) {
  const fam = sectionFamily(slot?.sectionId);
  let raw = '';
  if (fam === 'materials') raw = slot?.materialTitle || slot?.label || '';
  else if (fam === 'process') raw = slot?.processTitle || slot?.label || '';
  else return '';
  if (!raw || looksLikeSlotKey(raw, slot?.key)) return '';
  return titleTokens(raw).join(' ');
}

/**
 * Exact canonical title, or one token-set contains the other with the same
 * two-word head (moisture resistant board ⊂ moisture resistant drywall board).
 * Primer-sealer does not match board.
 */
export function titlesStronglyMatch(a, b) {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join(' ') === tb.join(' ')) return true;
  const setA = new Set(ta);
  const setB = new Set(tb);
  const aInB = ta.every((t) => setB.has(t));
  const bInA = tb.every((t) => setA.has(t));
  if (!aInB && !bInA) return false;
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer = ta.length <= tb.length ? tb : ta;
  if (shorter.length < 2) return false;
  return shorter[0] === longer[0] && shorter[1] === longer[1];
}

export function slotsMatchingCanonicalTitle(saved, targets = []) {
  const fam = sectionFamily(saved?.sectionId);
  if (fam !== 'materials' && fam !== 'process') return [];
  const savedTitle = canonicalSlotTitle(saved);
  if (!savedTitle) return [];
  return targets.filter((target) => {
    if (sectionFamily(target.sectionId) !== fam) return false;
    const other = canonicalSlotTitle(target);
    return Boolean(other) && titlesStronglyMatch(savedTitle, other);
  });
}

function sectionFamily(sectionId) {
  const id = String(sectionId || '');
  if (id === 'process' || id === 'offerProcess' || id === 'svcProcess') return 'process';
  if (id === 'materials' || id === 'svcMaterials') return 'materials';
  if (id === 'services' || id === 'svcHero') return 'services';
  return id || null;
}

function svcStepServiceCompatible(saved, target) {
  const svcIds = new Set(['svcProcess', 'svcMaterials']);
  if (!svcIds.has(saved?.sectionId) || !svcIds.has(target?.sectionId)) return true;
  return isMediumTitleMatch(
    titleMatchScore(saved.serviceName || saved.label || '', target.serviceName || target.label || ''),
  );
}

function bestSimilarStockTarget(saved, targets, filledKeys) {
  const fam = sectionFamily(saved?.sectionId);
  if (!fam) return null;
  const savedText = distinctiveSlotText(saved);
  if (!savedText) return null;
  let best = null;
  for (const target of targets) {
    if (sectionFamily(target.sectionId) !== fam) continue;
    if (!svcStepServiceCompatible(saved, target)) continue;
    const targetText = distinctiveSlotText(target);
    if (!targetText) continue;
    const result = titleMatchScore(savedText, targetText);
    if (!isMediumTitleMatch(result)) continue;
    const filled = Boolean(matchKeyForSlot(target) && filledKeys.has(matchKeyForSlot(target)));
    if (
      !best ||
      result.score > best.result.score + 1e-9 ||
      (Math.abs(result.score - best.result.score) < 1e-9 && filled && !best.filled)
    ) {
      best = { target, result, filled };
    }
  }
  return best;
}

function similarServiceTargets(name, targets, { excludeSlug } = {}) {
  const savedText = String(name || '').trim();
  if (!savedText) return [];
  const skip = String(excludeSlug || '').trim().toLowerCase();
  const hits = [];
  for (const target of targets) {
    if (skip && String(target.slug || '').toLowerCase() === skip) continue;
    const result = titleMatchScore(savedText, target.serviceName || target.slug || '');
    if (!isMediumTitleMatch(result)) continue;
    hits.push({ target, result });
  }
  hits.sort((a, b) => {
    if (b.result.shared !== a.result.shared) return b.result.shared - a.result.shared;
    return b.result.score - a.result.score;
  });
  return hits;
}

function copyIntoGroup(fromAbs, dir, filename) {
  const dest = path.join(dir, filename);
  copyFileSync(fromAbs, dest);
  return filename;
}

export function savePhotoGroup(candidateId, name, { replaceExisting = false } = {}) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    throw Object.assign(new Error('Name the photo group'), { status: 400 });
  }
  const niche = nicheOf(candidateId);
  if (!niche) {
    throw Object.assign(new Error('Accept Site config first (need a niche)'), { status: 400 });
  }
  const p = pathsFor(candidateId);
  const manifest = loadManifest(candidateId);
  const index = loadIndex();
  const existing = (index.groups || []).find(
    (g) => nichesEqual(g.niche, niche) && String(g.name || '').toLowerCase() === trimmed.toLowerCase(),
  );
  if (existing && !replaceExisting) {
    const err = new Error(`A photo group named “${trimmed}” already exists for ${niche}.`);
    err.status = 409;
    err.existingId = existing.id;
    throw err;
  }

  const id = existing?.id || `${slugifyName(trimmed)}-${Date.now().toString(36)}`;
  const copies = [];
  const slotsOut = [];
  const usedNames = new Set();
  const structByKey = new Map();
  try {
    for (const s of listImageSlots(candidateId)) structByKey.set(s.key, s);
  } catch {
    /* Structure optional — index still comes from the slot key */
  }
  for (const slot of Object.values(manifest.slots || {})) {
    const filename = slot?.filename;
    if (!filename || SKIP_SAVE_NAMES.test(filename)) continue;
    if (HOME_BA_RE.test(filename) || SVC_BA_RE.test(filename)) continue;
    const abs = path.join(p.siteImages, filename);
    if (!existsSync(abs)) continue;
    let destName = filename;
    if (usedNames.has(destName)) destName = `${slot.key || 'slot'}-${filename}`;
    usedNames.add(destName);
    copies.push({ from: abs, destName });
    const merged = mergeStructureOntoSlot(
      {
        key: slot.key,
        sectionId: slot.sectionId,
        index: slot.index,
        serviceName: slot.serviceName || null,
        serviceSlug: slot.serviceSlug || null,
        materialTitle: slot.materialTitle || null,
        processTitle: slot.processTitle || null,
        label: slot.label || null,
        filename: destName,
        alt: slot.alt || null,
        provider: slot.provider || null,
        source: slot.source || 'stock',
        photoId: slot.photoId || null,
        photographer: slot.photographer || null,
        pageUrl: slot.pageUrl || null,
        attribution: slot.attribution || null,
        query: slot.query || null,
        score: slot.score ?? null,
        matchGrade: slot.matchGrade || null,
      },
      structByKey.get(slot.key) || {},
    );
    slotsOut.push(merged);
  }

  const diskBa = collectBaFromDisk(p.siteImages);
  const targets = listConfiguredServiceTargets(candidateId);
  const beforeAfter = { home: [], services: [] };
  for (const pair of diskBa.home) {
    copies.push({
      from: path.join(p.siteImages, pair.before.filename),
      destName: pair.before.filename,
    });
    copies.push({
      from: path.join(p.siteImages, pair.after.filename),
      destName: pair.after.filename,
    });
    beforeAfter.home.push({
      pairIndex: pair.pairIndex,
      before: { filename: pair.before.filename, ext: pair.before.ext },
      after: { filename: pair.after.filename, ext: pair.after.ext },
    });
  }
  for (const pair of diskBa.services) {
    const hit = targets.find((t) => t.slug === pair.serviceSlug);
    copies.push({
      from: path.join(p.siteImages, pair.before.filename),
      destName: pair.before.filename,
    });
    copies.push({
      from: path.join(p.siteImages, pair.after.filename),
      destName: pair.after.filename,
    });
    beforeAfter.services.push({
      serviceSlug: pair.serviceSlug,
      serviceName: hit?.serviceName || pair.serviceSlug,
      before: { filename: pair.before.filename, ext: pair.before.ext },
      after: { filename: pair.after.filename, ext: pair.after.ext },
    });
  }

  if (!slotsOut.length && !beforeAfter.home.length && !beforeAfter.services.length) {
    throw Object.assign(new Error('No photos to save — pull or import images first.'), {
      status: 400,
    });
  }

  const dir = groupDir(id);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const c of copies) copyIntoGroup(c.from, dir, c.destName);
  writeJson(path.join(dir, 'slots.json'), slotsOut);
  writeJson(path.join(dir, 'beforeAfter.json'), beforeAfter);

  const meta = {
    id,
    name: trimmed,
    niche,
    kind: 'named',
    savedAt: new Date().toISOString(),
    slotCount: slotsOut.length,
    baPairCount: beforeAfter.home.length + beforeAfter.services.length,
    sourceCandidateId: p.id,
    roles: rolesFromGroupSlots(slotsOut, beforeAfter),
  };
  const groups = (index.groups || []).filter((g) => g.id !== id);
  groups.unshift(meta);
  saveIndex({ groups });

  return {
    ok: true,
    group: meta,
    candidate: getCandidateDetail(candidateId),
  };
}

function unusedSlotMeta(saved, group) {
  return {
    key: saved.key,
    sectionId: saved.sectionId,
    serviceName: saved.serviceName || saved.label || null,
    label: saved.materialTitle || saved.processTitle || saved.label || saved.key,
    groupId: group?.id || null,
    groupName: group?.name || null,
  };
}

function slotFileRows(saved) {
  const rows = [];
  if (saved?.filename) rows.push({ ...saved, fromVariant: false });
  for (const v of saved?.variants || []) {
    if (!v?.filename) continue;
    rows.push({
      ...saved,
      filename: v.filename,
      photoId: v.photoId || null,
      source: v.source || saved.source,
      provider: v.provider || saved.provider,
      attribution: v.attribution || saved.attribution,
      matchGrade: v.matchGrade || saved.matchGrade,
      fromVariant: true,
    });
  }
  return rows;
}

/**
 * If a slot has tray stills but no live apply, the first tray row becomes live.
 * Remaining tray rows stay. Mutates `plan.applied` / `plan.tray`.
 */
export function promoteFirstTrayIntoEmptyPlan(plan) {
  const applied = plan?.applied;
  const tray = plan?.tray;
  if (!Array.isArray(applied) || !Array.isArray(tray)) return plan;
  const filled = new Set(applied.map((a) => a.matchKey).filter(Boolean));
  const keepTray = [];
  for (const row of tray) {
    const k = row.matchKey;
    if (k && !filled.has(k) && row.saved?.filename && row.target) {
      applied.push({
        saved: row.saved,
        target: row.target,
        group: row.group,
        rank: row.rank,
        matchKey: k,
        fromTray: true,
      });
      filled.add(k);
      continue;
    }
    keepTray.push(row);
  }
  tray.length = 0;
  tray.push(...keepTray);
  return plan;
}

function planMatchesMulti(candidateId, groups) {
  const targetSlots = listImageSlots(candidateId);
  const slotByKey = new Map();
  for (const slot of targetSlots) {
    const k = matchKeyForSlot(slot);
    if (k && !slotByKey.has(k)) slotByKey.set(k, slot);
  }

  const filledKeys = new Set();
  const applied = [];
  const tray = [];
  const unusedPending = [];

  groups.forEach((group, gi) => {
    const rank = gi + 1;
    for (const saved of group.slots || []) {
      const k = matchKeyForSlot(saved);
      const target = k ? slotByKey.get(k) : null;
      const rows = slotFileRows(saved);
      if (!target) {
        unusedPending.push({ saved, group, rank, rows });
        continue;
      }
      for (const row of rows) {
        if (!filledKeys.has(k) && !row.fromVariant) {
          filledKeys.add(k);
          applied.push({ saved: row, target, group, rank, matchKey: k });
        } else {
          tray.push({ saved: row, target, group, rank, matchKey: k });
        }
      }
    }
  });

  const traySeen = new Set(
    tray.map((row) => `${row.matchKey}\0${row.group?.id || ''}\0${row.saved?.filename || ''}`),
  );
  const pushTrayRow = (row, target, group, rank, similar) => {
    const mk = matchKeyForSlot(target);
    if (!mk || !row?.filename) return;
    const id = `${mk}\0${group?.id || ''}\0${row.filename}`;
    if (traySeen.has(id)) return;
    const live = applied.some(
      (a) =>
        a.matchKey === mk &&
        a.group?.id === group?.id &&
        a.saved?.filename === row.filename,
    );
    if (live) return;
    traySeen.add(id);
    tray.push({
      saved: row,
      target,
      group,
      rank,
      matchKey: mk,
      similar: Boolean(similar),
    });
  };

  groups.forEach((group, gi) => {
    const rank = gi + 1;
    for (const saved of group.slots || []) {
      const fans = slotsMatchingCanonicalTitle(saved, targetSlots);
      if (!fans.length) continue;
      for (const target of fans) {
        for (const row of slotFileRows(saved)) {
          pushTrayRow(row, target, group, rank, true);
        }
      }
    }
  });

  const unused = [];
  for (const pending of unusedPending) {
    const fans = slotsMatchingCanonicalTitle(pending.saved, targetSlots);
    if (fans.length) continue;
    const hit = bestSimilarStockTarget(pending.saved, targetSlots, filledKeys);
    if (!hit) {
      unused.push(unusedSlotMeta(pending.saved, pending.group));
      continue;
    }
    const rows = pending.rows.length ? pending.rows : slotFileRows(pending.saved);
    for (const row of rows) {
      pushTrayRow(row, hit.target, pending.group, pending.rank, true);
    }
  }

  promoteFirstTrayIntoEmptyPlan({ applied, tray });
  filledKeys.clear();
  for (const row of applied) {
    if (row.matchKey) filledKeys.add(row.matchKey);
  }

  const targetEmpty = [...slotByKey.entries()]
    .filter(([k]) => !filledKeys.has(k))
    .map(([, s]) => ({
      key: s.key,
      sectionId: s.sectionId,
      label: s.materialTitle || s.processTitle || s.serviceName || s.label || s.key,
    }));

  const baApplied = [];
  const baTray = [];
  const baUnused = [];
  const wantHomeBa = homeBaEnabled(candidateId);
  const wantSvcBa = svcBaEnabled(candidateId);
  const homeFilled = new Set();
  const svcFilled = new Set();
  const bTargets = listConfiguredServiceTargets(candidateId);

  groups.forEach((group, gi) => {
    const rank = gi + 1;
    const homePairs = [...(group.beforeAfter?.home || [])].sort(
      (a, b) => (a.pairIndex || 0) - (b.pairIndex || 0),
    );
    if (!wantHomeBa) {
      for (const pair of homePairs) {
        baUnused.push({ kind: 'home', pairIndex: pair.pairIndex, groupId: group.id });
      }
    } else {
      for (const pair of homePairs) {
        const preferred = Math.max(1, Number(pair.pairIndex) || 0);
        if (preferred && homeFilled.has(preferred)) {
          baTray.push({ kind: 'home', pairIndex: preferred, pair, group, rank });
        } else if (preferred) {
          homeFilled.add(preferred);
          baApplied.push({
            kind: 'home',
            pairIndex: preferred,
            savedIndex: pair.pairIndex,
            pair,
            group,
            rank,
          });
        } else {
          let idx = 1;
          while (homeFilled.has(idx)) idx += 1;
          homeFilled.add(idx);
          baApplied.push({
            kind: 'home',
            pairIndex: idx,
            savedIndex: pair.pairIndex,
            pair,
            group,
            rank,
          });
        }
      }
    }

    for (const pair of group.beforeAfter?.services || []) {
      const name = normService(pair.serviceName || pair.serviceSlug);
      const hit = wantSvcBa
        ? bTargets.find(
            (t) => t.slug === pair.serviceSlug || normService(t.serviceName) === name,
          )
        : null;
      if (hit) {
        if (svcFilled.has(hit.slug)) {
          baTray.push({
            kind: 'service',
            serviceSlug: hit.slug,
            serviceName: hit.serviceName,
            pair,
            group,
            rank,
          });
        } else {
          svcFilled.add(hit.slug);
          baApplied.push({
            kind: 'service',
            serviceSlug: hit.slug,
            serviceName: hit.serviceName,
            pair,
            group,
            rank,
          });
        }
      }
      const similarHits = wantSvcBa
        ? similarServiceTargets(pair.serviceName || pair.serviceSlug, bTargets, {
            excludeSlug: hit?.slug,
          })
        : [];
      for (const similar of similarHits) {
        baTray.push({
          kind: 'service',
          serviceSlug: similar.target.slug,
          serviceName: similar.target.serviceName,
          pair,
          group,
          rank,
          similar: true,
        });
      }
      if (!hit && !similarHits.length) {
        baUnused.push({
          kind: 'service',
          serviceName: pair.serviceName || pair.serviceSlug,
          groupId: group.id,
        });
      }
    }
  });

  return {
    targetSlots,
    applied,
    tray,
    unused,
    targetEmpty,
    baApplied,
    baTray,
    baUnused,
    similarTray:
      tray.filter((row) => row.similar).length + baTray.filter((row) => row.similar).length,
    groups: groups.map((g, i) => ({
      id: g.id,
      name: g.name,
      niche: g.niche,
      rank: i + 1,
      slotCount: g.slotCount,
      baPairCount: g.baPairCount,
    })),
  };
}

function loadGroupsOrThrow(groupIds) {
  const ids = normalizePhotoGroupIds({ groupIds });
  if (!ids.length) {
    throw Object.assign(new Error('Pick at least one photo group'), { status: 400 });
  }
  return ids.map((id) => getPhotoGroup(id));
}

export function previewPhotoGroup(candidateId, groupIdOrBody) {
  const ids = normalizePhotoGroupIds(
    typeof groupIdOrBody === 'string' ? { groupId: groupIdOrBody } : groupIdOrBody || {},
  );
  const groups = loadGroupsOrThrow(ids);
  const plan = planMatchesMulti(candidateId, groups);
  const first = groups[0];
  return {
    ok: true,
    groups: plan.groups,
    group: {
      id: first.id,
      name: first.name,
      niche: first.niche,
      slotCount: first.slotCount,
      baPairCount: first.baPairCount,
    },
    applied: plan.applied.length,
    unused: plan.unused.length,
    targetEmpty: plan.targetEmpty.length,
    baApplied: plan.baApplied.length,
    baUnused: plan.baUnused.length,
    tray: plan.tray.length,
    baTray: plan.baTray.length,
    similarTray: plan.similarTray || 0,
    unusedSamples: plan.unused.slice(0, 8),
    emptySamples: plan.targetEmpty.slice(0, 8),
    traySamples: plan.tray.slice(0, 8).map((row) => ({
      key: row.target?.key,
      label: row.target?.label || row.saved?.label,
      groupName: row.group?.name,
    })),
  };
}

function deleteMatching(dir, re) {
  if (!dir || !existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!re.test(name)) continue;
    try {
      unlinkSync(path.join(dir, name));
    } catch {
      // ignore
    }
  }
}

function copyGroupFile(groupDir, filename, destDir, destName, { unique = false } = {}) {
  const from = path.join(groupDir, filename);
  if (!existsSync(from)) return null;
  mkdirSync(destDir, { recursive: true });
  let toName = destName || filename;
  if (unique) {
    const ext = path.extname(toName);
    const stem = path.basename(toName, ext);
    let n = 0;
    while (existsSync(path.join(destDir, toName))) {
      n += 1;
      toName = `${stem}-${n}${ext}`;
    }
  }
  copyFileSync(from, path.join(destDir, toName));
  return toName;
}

function liveSlotEntry(target, saved, destName, { fromTray = false } = {}) {
  return {
    key: target.key,
    sectionId: target.sectionId,
    index: target.index,
    filename: destName,
    src: `/images/${destName}`,
    alt: saved.alt || target.label || 'Service photo',
    provider: saved.provider || null,
    source: saved.source || 'stock',
    photoId: saved.photoId || null,
    photographer: saved.photographer || null,
    pageUrl: saved.pageUrl || null,
    query: saved.query || null,
    score: saved.score ?? null,
    matchGrade: saved.matchGrade || 'ok',
    matchTip: fromTray
      ? 'Loaded from similar photo-group title'
      : saved.matchGrade === 'good'
        ? 'From saved photo group'
        : 'Loaded from saved photo group',
    attribution: saved.attribution || null,
    serviceName: target.serviceName || saved.serviceName || null,
    serviceSlug: target.serviceSlug || saved.serviceSlug || null,
    materialTitle: target.materialTitle || saved.materialTitle || null,
    processTitle: target.processTitle || saved.processTitle || null,
    label: target.label || saved.label || null,
    variants: [],
  };
}

function stubSlotEntry(target) {
  return {
    key: target.key,
    sectionId: target.sectionId,
    index: target.index,
    filename: null,
    src: null,
    alt: target.label || 'Service photo',
    provider: null,
    source: null,
    photoId: null,
    photographer: null,
    pageUrl: null,
    query: null,
    score: null,
    matchGrade: null,
    matchTip: null,
    attribution: null,
    serviceName: target.serviceName || null,
    serviceSlug: target.serviceSlug || null,
    materialTitle: target.materialTitle || null,
    processTitle: target.processTitle || null,
    label: target.label || null,
    variants: [],
  };
}

export function applyPhotoGroups(candidateId, groupIds) {
  const groups = loadGroupsOrThrow(groupIds);
  const plan = planMatchesMulti(candidateId, groups);
  const p = pathsFor(candidateId);
  mkdirSync(p.siteImages, { recursive: true });

  const manifest = loadManifest(candidateId);
  const slots = {};
  const filesMap = new Map();
  const usedIds = new Set();

  const keepOtherFiles = (manifest.files || []).filter((f) => {
    const n = f?.filename || '';
    if (!n) return false;
    if (SKIP_SAVE_NAMES.test(n)) return true;
    return false;
  });
  for (const f of keepOtherFiles) filesMap.set(f.filename, f);

  for (const { saved, target, group, fromTray, rank } of plan.applied) {
    const destName = copyGroupFile(
      group.dir,
      saved.filename,
      p.siteImages,
      fromTray ? `pg${rank || 1}-${path.basename(String(saved.filename))}` : saved.filename,
      fromTray ? { unique: true } : {},
    );
    if (!destName) continue;
    const entry = liveSlotEntry(target, saved, destName, { fromTray: Boolean(fromTray) });
    slots[target.key] = entry;
    if (entry.photoId) usedIds.add(entry.photoId);
    filesMap.set(destName, {
      filename: destName,
      src: entry.src,
      sectionId: entry.sectionId,
      provider: entry.provider,
      photoId: entry.photoId,
      photographer: entry.photographer,
      pageUrl: entry.pageUrl,
      attribution: entry.attribution,
      serviceName: entry.serviceName,
      source: entry.source,
    });
  }

  for (const { saved, target, group, rank } of plan.tray) {
    let live = slots[target.key];
    if (!live) {
      live = stubSlotEntry(target);
      slots[target.key] = live;
    }
    const sourceAbs = path.join(group.dir, path.basename(String(saved.filename || '')));
    if (
      slotSourceIsDuplicate(
        p.siteImages,
        { abs: sourceAbs, filename: saved.filename, photoId: saved.photoId },
        {
          liveFilename: live.filename,
          livePhotoId: live.photoId,
          variants: live.variants,
        },
      )
    ) {
      continue;
    }
    const destName = copyGroupFile(
      group.dir,
      saved.filename,
      p.siteImages,
      `pg${rank}-${path.basename(String(saved.filename))}`,
      { unique: true },
    );
    if (!destName) continue;
    live.variants = pushImageSlotTrayEntry(
      p.siteImages,
      live.variants,
      {
        filename: destName,
        source: saved.source || 'photo-group',
        provider: saved.provider || null,
        photoId: saved.photoId || null,
        attribution: saved.attribution || null,
        matchGrade: saved.matchGrade || null,
      },
      { liveFilename: live.filename, livePhotoId: live.photoId },
    );
  }

  const publicImages = path.join(ROOT, 'public', 'images');
  const stagingImages = existsSync(p.siteStaging)
    ? path.join(p.siteStaging, 'public', 'images')
    : null;

  const baTrayByKey = new Map();
  const noteBaTray = (key, entry) => {
    const list = baTrayByKey.get(key) || [];
    list.push(entry);
    baTrayByKey.set(key, list);
  };

  if (homeBaEnabled(candidateId) && plan.baApplied.some((x) => x.kind === 'home')) {
    for (const dir of [p.siteImages, publicImages, stagingImages]) {
      deleteMatching(dir, /^gallery-ba-/i);
    }
    for (const row of plan.baApplied.filter((x) => x.kind === 'home')) {
      const n = row.pairIndex;
      const beforeName = `gallery-ba-${n}-before.${row.pair.before.ext || 'jpg'}`;
      const afterName = `gallery-ba-${n}-after.${row.pair.after.ext || 'jpg'}`;
      copyGroupFile(row.group.dir, row.pair.before.filename, p.siteImages, beforeName);
      copyGroupFile(row.group.dir, row.pair.after.filename, p.siteImages, afterName);
      stampBaPairMeta(candidateId, baVariantKey({ pairIndex: n }), {
        source: 'photo-group',
        matchGrade: 'ok',
        matchTip: 'Loaded from photo group',
        matchGradeManual: false,
      });
    }
  }

  if (svcBaEnabled(candidateId)) {
    for (const row of plan.baApplied.filter((x) => x.kind === 'service')) {
      const re = new RegExp(`^svc-ba-${row.serviceSlug}-`, 'i');
      for (const dir of [p.siteImages, publicImages, stagingImages]) {
        deleteMatching(dir, re);
      }
      const beforeName = `svc-ba-${row.serviceSlug}-1-before.${row.pair.before.ext || 'jpg'}`;
      const afterName = `svc-ba-${row.serviceSlug}-1-after.${row.pair.after.ext || 'jpg'}`;
      copyGroupFile(row.group.dir, row.pair.before.filename, p.siteImages, beforeName);
      copyGroupFile(row.group.dir, row.pair.after.filename, p.siteImages, afterName);
      stampBaPairMeta(candidateId, baVariantKey({ serviceSlug: row.serviceSlug }), {
        source: 'photo-group',
        matchGrade: 'ok',
        matchTip: 'Loaded from photo group',
        matchGradeManual: false,
      });
    }
  }

  for (const row of plan.baTray) {
    const prefix =
      row.kind === 'service'
        ? `svc-ba-${row.serviceSlug}`
        : `gallery-ba-${row.pairIndex}`;
    const key =
      row.kind === 'service'
        ? baVariantKey({ serviceSlug: row.serviceSlug })
        : baVariantKey({ pairIndex: row.pairIndex });
    const live = findLiveBaFiles(candidateId, {
      serviceSlug: row.kind === 'service' ? row.serviceSlug : '',
      pairIndex: row.pairIndex || 1,
    });
    const existing = baTrayByKey.get(key) || [];
    const beforeAbs = path.join(row.group.dir, path.basename(String(row.pair.before.filename || '')));
    const afterAbs = path.join(row.group.dir, path.basename(String(row.pair.after.filename || '')));
    if (
      baSourceIsDuplicate(
        p.siteImages,
        {
          beforeAbs,
          afterAbs,
          beforeFilename: row.pair.before.filename,
          afterFilename: row.pair.after.filename,
        },
        {
          liveBefore: live.before,
          liveAfter: live.after,
          variants: existing,
        },
      )
    ) {
      continue;
    }
    const beforeName = copyGroupFile(
      row.group.dir,
      row.pair.before.filename,
      p.siteImages,
      `${prefix}-pg${row.rank}-before.${row.pair.before.ext || 'jpg'}`,
      { unique: true },
    );
    const afterName = copyGroupFile(
      row.group.dir,
      row.pair.after.filename,
      p.siteImages,
      `${prefix}-pg${row.rank}-after.${row.pair.after.ext || 'jpg'}`,
      { unique: true },
    );
    noteBaTray(key, {
      beforeFilename: beforeName,
      afterFilename: afterName,
      source: 'photo-group',
      serviceSlug: row.kind === 'service' ? row.serviceSlug : '',
      pairIndex: row.pairIndex || 1,
    });
  }

  const baKeysWritten = new Set();
  for (const [key, entries] of baTrayByKey) {
    const sample = entries[0] || {};
    setBaTrayEntries(candidateId, {
      serviceSlug: sample.serviceSlug || '',
      pairIndex: sample.pairIndex || 1,
      entries,
    });
    baKeysWritten.add(key);
  }
  for (const row of plan.baApplied) {
    const key =
      row.kind === 'service'
        ? baVariantKey({ serviceSlug: row.serviceSlug })
        : baVariantKey({ pairIndex: row.pairIndex });
    if (!baKeysWritten.has(key)) {
      setBaTrayEntries(candidateId, {
        serviceSlug: row.kind === 'service' ? row.serviceSlug : '',
        pairIndex: row.pairIndex || 1,
        entries: [],
      });
    }
  }

  const first = groups[0];
  const nextManifest = {
    ...manifest,
    version: 1,
    candidateId: p.id,
    usedIds: [...usedIds],
    files: [...filesMap.values()],
    slots,
    pulledAt: new Date().toISOString(),
    photoGroupId: first.id,
    photoGroupIds: groups.map((g) => g.id),
    photoGroupName: groups.map((g) => g.name).join(' → '),
  };
  writeJson(p.imagesManifest, nextManifest);
  promoteFirstTrayIntoEmptySlots(candidateId, { sync: false });
  const afterPromote = loadManifest(candidateId);
  persistAttachedPhotoGroups(candidateId, groups, { groups: plan.groups });

  const synced = syncSiteImagesToPublic(candidateId);
  const contentUpdate = applyImagesToContentFiles(
    candidateId,
    Object.values(afterPromote.slots || {}),
  );
  let ba = null;
  try {
    ba = rehydrateGalleryBaFrontmatter(candidateId);
  } catch {
    ba = { ok: false };
  }

  const names = groups.map((g) => g.name).join(' → ');
  return {
    ok: true,
    applied: plan.applied.length,
    unusedCount: plan.unused.length,
    targetEmpty: plan.targetEmpty.length,
    baApplied: plan.baApplied.length,
    baUnused: plan.baUnused.length,
    tray: plan.tray.length,
    baTray: plan.baTray.length,
    similarTray: plan.similarTray || 0,
    unused: plan.unused,
    synced,
    contentUpdate,
    ba,
    manifest: afterPromote,
    group: { id: first.id, name: first.name, niche: first.niche },
    groups: plan.groups,
    candidate: getCandidateDetail(candidateId),
    human: [
      `Photo groups ${names}: ${plan.applied.length} stock slots loaded` +
        (plan.baApplied.length ? `, ${plan.baApplied.length} before/after pairs` : '') +
        (plan.tray.length + plan.baTray.length
          ? `, ${plan.tray.length + plan.baTray.length} added to trays`
          : '') +
        (plan.similarTray
          ? ` (${plan.similarTray} similar titles)`
          : '') +
        (plan.unused.length ? `, ${plan.unused.length} unused (no matching or similar slot)` : '') +
        '.',
    ],
  };
}

export function applyPhotoGroup(candidateId, groupId) {
  return applyPhotoGroups(candidateId, [groupId]);
}

export function attachPhotoGroup(candidateId, groupIdOrBody) {
  const ids = normalizePhotoGroupIds(
    typeof groupIdOrBody === 'string' ? { groupId: groupIdOrBody } : groupIdOrBody || {},
  );
  const groups = loadGroupsOrThrow(ids);
  const preview = previewPhotoGroup(candidateId, { groupIds: ids });
  const attached = persistAttachedPhotoGroups(candidateId, groups, {
    groups: preview.groups,
    preview,
  });
  return {
    ok: true,
    attached,
    preview,
    candidate: getCandidateDetail(candidateId),
  };
}

export function skipPhotoGroup(candidateId) {
  const file = pathsFor(candidateId).photoGroup;
  const skippedAt = new Date().toISOString();
  writeJson(file, { skipped: true, skippedAt });
  return {
    ok: true,
    skipped: true,
    skippedAt,
    candidate: getCandidateDetail(candidateId),
  };
}
