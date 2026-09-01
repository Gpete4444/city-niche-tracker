/**
 * Named niche photo groups: save filled Review images (stock, uploads, ChatGPT
 * before/after) and load them onto a later candidate. Match by role, not by
 * copying Structure. Unused saved files stay in the group only.
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
} from './chatgpt-before-after.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { getContentStructure } from './content-structure.mjs';
import {
  applyImagesToContentFiles,
  listImageSlots,
  syncSiteImagesToPublic,
} from './fill-site-images.mjs';

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
  if (!doc?.groupId) return null;
  return doc;
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

function planMatches(candidateId, group) {
  const targetSlots = listImageSlots(candidateId);
  const byKey = new Map();
  for (const slot of targetSlots) {
    const k = matchKeyForSlot(slot);
    if (k && !byKey.has(k)) byKey.set(k, slot);
  }

  const applied = [];
  const unused = [];
  for (const saved of group.slots || []) {
    const k = matchKeyForSlot(saved);
    const target = k ? byKey.get(k) : null;
    if (target) {
      applied.push({ saved, target });
      byKey.delete(k);
    } else {
      unused.push({
        key: saved.key,
        sectionId: saved.sectionId,
        serviceName: saved.serviceName || saved.label || null,
        label: saved.materialTitle || saved.processTitle || saved.label || saved.key,
      });
    }
  }
  const targetEmpty = [...byKey.values()].map((s) => ({
    key: s.key,
    sectionId: s.sectionId,
    label: s.materialTitle || s.processTitle || s.serviceName || s.label || s.key,
  }));

  const baApplied = [];
  const baUnused = [];
  const wantHomeBa = homeBaEnabled(candidateId);
  const homePairs = [...(group.beforeAfter?.home || [])].sort(
    (a, b) => (a.pairIndex || 0) - (b.pairIndex || 0),
  );
  if (wantHomeBa) {
    homePairs.forEach((pair, i) => {
      baApplied.push({ kind: 'home', pairIndex: i + 1, savedIndex: pair.pairIndex, pair });
    });
  } else {
    for (const pair of homePairs) {
      baUnused.push({ kind: 'home', pairIndex: pair.pairIndex });
    }
  }

  const wantSvcBa = svcBaEnabled(candidateId);
  const bTargets = listConfiguredServiceTargets(candidateId);
  for (const pair of group.beforeAfter?.services || []) {
    const name = normService(pair.serviceName || pair.serviceSlug);
    const hit = wantSvcBa
      ? bTargets.find(
          (t) => t.slug === pair.serviceSlug || normService(t.serviceName) === name,
        )
      : null;
    if (hit) baApplied.push({ kind: 'service', serviceSlug: hit.slug, serviceName: hit.serviceName, pair });
    else baUnused.push({
      kind: 'service',
      serviceName: pair.serviceName || pair.serviceSlug,
    });
  }

  return { targetSlots, applied, unused, targetEmpty, baApplied, baUnused };
}

export function previewPhotoGroup(candidateId, groupId) {
  const group = getPhotoGroup(groupId);
  if (!nichesEqual(group.niche, nicheOf(candidateId))) {
    throw Object.assign(
      new Error(`This group is for “${group.niche}”, not this candidate’s niche.`),
      { status: 400 },
    );
  }
  const plan = planMatches(candidateId, group);
  return {
    ok: true,
    group: {
      id: group.id,
      name: group.name,
      niche: group.niche,
      slotCount: group.slotCount,
      baPairCount: group.baPairCount,
    },
    applied: plan.applied.length,
    unused: plan.unused.length,
    targetEmpty: plan.targetEmpty.length,
    baApplied: plan.baApplied.length,
    baUnused: plan.baUnused.length,
    unusedSamples: plan.unused.slice(0, 8),
    emptySamples: plan.targetEmpty.slice(0, 8),
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

function copyGroupFile(groupDir, filename, destDir, destName) {
  const from = path.join(groupDir, filename);
  if (!existsSync(from)) return null;
  mkdirSync(destDir, { recursive: true });
  const toName = destName || filename;
  copyFileSync(from, path.join(destDir, toName));
  return toName;
}

export function applyPhotoGroup(candidateId, groupId) {
  const group = getPhotoGroup(groupId);
  if (!nichesEqual(group.niche, nicheOf(candidateId))) {
    throw Object.assign(
      new Error(`This group is for “${group.niche}”, not this candidate’s niche.`),
      { status: 400 },
    );
  }
  const plan = planMatches(candidateId, group);
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

  for (const { saved, target } of plan.applied) {
    const destName = copyGroupFile(group.dir, saved.filename, p.siteImages, saved.filename);
    if (!destName) continue;
    const entry = {
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
      matchTip: saved.matchGrade === 'good' ? 'From saved photo group' : 'Loaded from saved photo group',
      attribution: saved.attribution || null,
      serviceName: target.serviceName || saved.serviceName || null,
      serviceSlug: target.serviceSlug || saved.serviceSlug || null,
      materialTitle: target.materialTitle || saved.materialTitle || null,
      processTitle: target.processTitle || saved.processTitle || null,
      label: target.label || saved.label || null,
    };
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

  const publicImages = path.join(ROOT, 'public', 'images');
  const stagingImages = existsSync(p.siteStaging)
    ? path.join(p.siteStaging, 'public', 'images')
    : null;

  if (homeBaEnabled(candidateId) && plan.baApplied.some((x) => x.kind === 'home')) {
    for (const dir of [p.siteImages, publicImages, stagingImages]) {
      deleteMatching(dir, HOME_BA_RE);
    }
    const homePairs = plan.baApplied.filter((x) => x.kind === 'home');
    homePairs.forEach((row, i) => {
      const n = i + 1;
      const beforeName = `gallery-ba-${n}-before.${row.pair.before.ext || 'jpg'}`;
      const afterName = `gallery-ba-${n}-after.${row.pair.after.ext || 'jpg'}`;
      copyGroupFile(group.dir, row.pair.before.filename, p.siteImages, beforeName);
      copyGroupFile(group.dir, row.pair.after.filename, p.siteImages, afterName);
    });
  }

  if (svcBaEnabled(candidateId)) {
    for (const row of plan.baApplied.filter((x) => x.kind === 'service')) {
      const re = new RegExp(`^svc-ba-${row.serviceSlug}-\\d+-(before|after)\\.`, 'i');
      for (const dir of [p.siteImages, publicImages, stagingImages]) {
        deleteMatching(dir, re);
      }
      const beforeName = `svc-ba-${row.serviceSlug}-1-before.${row.pair.before.ext || 'jpg'}`;
      const afterName = `svc-ba-${row.serviceSlug}-1-after.${row.pair.after.ext || 'jpg'}`;
      copyGroupFile(group.dir, row.pair.before.filename, p.siteImages, beforeName);
      copyGroupFile(group.dir, row.pair.after.filename, p.siteImages, afterName);
    }
  }

  const nextManifest = {
    ...manifest,
    version: 1,
    candidateId: p.id,
    usedIds: [...usedIds],
    files: [...filesMap.values()],
    slots,
    pulledAt: new Date().toISOString(),
    photoGroupId: group.id,
    photoGroupName: group.name,
  };
  writeJson(p.imagesManifest, nextManifest);

  const synced = syncSiteImagesToPublic(candidateId);
  const contentUpdate = applyImagesToContentFiles(candidateId, Object.values(slots));
  let ba = null;
  try {
    ba = rehydrateGalleryBaFrontmatter(candidateId);
  } catch {
    ba = { ok: false };
  }

  return {
    ok: true,
    applied: plan.applied.length,
    unusedCount: plan.unused.length,
    targetEmpty: plan.targetEmpty.length,
    baApplied: plan.baApplied.length,
    baUnused: plan.baUnused.length,
    unused: plan.unused,
    synced,
    contentUpdate,
    ba,
    manifest: nextManifest,
    group: { id: group.id, name: group.name, niche: group.niche },
    candidate: getCandidateDetail(candidateId),
    human: [
      `Photo group “${group.name}”: ${plan.applied.length} stock slots loaded` +
        (plan.baApplied.length ? `, ${plan.baApplied.length} before/after pairs` : '') +
        (plan.unused.length ? `, ${plan.unused.length} unused (section not on this site)` : '') +
        '.',
    ],
  };
}

export function attachPhotoGroup(candidateId, groupId) {
  const group = getPhotoGroup(groupId);
  if (!nichesEqual(group.niche, nicheOf(candidateId))) {
    throw Object.assign(
      new Error(`This group is for “${group.niche}”, not this candidate’s niche.`),
      { status: 400 },
    );
  }
  const preview = previewPhotoGroup(candidateId, groupId);
  const attachedAt = new Date().toISOString();
  writeJson(pathsFor(candidateId).photoGroup, {
    groupId: group.id,
    name: group.name,
    niche: group.niche,
    attachedAt,
    preview,
  });
  return {
    ok: true,
    attached: { groupId: group.id, name: group.name, attachedAt },
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
