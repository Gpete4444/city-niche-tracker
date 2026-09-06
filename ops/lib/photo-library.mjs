/**
 * Photo satellite: browse/edit saved groups and the per-niche master.
 * Master upserts from Prepare preview. Accept applies master unless Skip or a named attach.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { addLastCost, pathsFor, RESEARCH_DIR } from './candidates.mjs';
import { recordRoverApiSpend } from './rover-api-spend.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { loadSectionRegistry } from './content-structure.mjs';
import { configuredImageProviders } from './image-providers/registry.mjs';
import {
  OPENAI_IMAGE_COST,
  openaiImageKeySet,
  generateOpenaiImage,
  editOpenaiImage,
} from './image-providers/openai-image.mjs';
import { fluxSlotPromptForCandidate, fluxSlotPromptFromMeta, buildFluxBaPrompts } from './flux-prompts.mjs';
import { slotSettingKind } from './image-setting.mjs';
import {
  loadOpenaiPromptsFile,
  openaiPromptsPathForGroupDir,
  getSlotPromptOverride,
  getBaPromptOverride,
  pickPromptText,
  pickBaPromptPair,
  overlayBaCardPrompts,
  persistSlotOverrideIfBody,
  persistBaOverrideIfBody,
  setSlotPromptOverride,
  clearSlotPromptOverride,
  setBaPromptOverride,
  clearBaPromptOverride,
  saveOpenaiPromptsFile,
} from './openai-prompt-overrides.mjs';
import {
  displayLabelForSlot,
  IMAGE_SECTION_DEFAULT_ORDER,
  listImageSlots,
  searchStockForSlot,
  sectionGroupKey,
  sectionLabelForGroup,
  wiredFmForSlot,
} from './fill-site-images.mjs';
import {
  listConfiguredServiceTargets,
  resolveBaChatgptPrompts,
  saveLastBaPrompts,
  baPromptsForCard,
  normalizeBaViewpoint,
  baPairGradeFields,
} from './chatgpt-before-after.mjs';
import {
  collectBaFromDisk,
  dropPhotoGroupFromIndex,
  findNicheMaster,
  getPhotoGroup,
  listPhotoGroupNiches,
  listPhotoGroups,
  indexFromSlotKey,
  looksLikeSlotKey,
  matchKeyForSlot,
  masterIdForNiche,
  mergeStructureOntoSlot,
  persistPhotoGroupRecord,
  PHOTO_GROUPS_DIR,
  nichesEqual,
} from './photo-groups.mjs';
import {
  IMAGE_TRAY_CAP,
  baSourceIsDuplicate,
  compactBaTray,
  compactSlotTray,
  pushBaTrayEntry,
  pushSlotTrayEntry,
  trimTrayVariants,
} from './image-tray.mjs';

const SKIP_SAVE_NAMES = /^(logo\.(svg|png)|coverage-map\.svg)$/i;
const ALT_CAP = IMAGE_TRAY_CAP;

function gradeRank(g) {
  const v = String(g || '').toLowerCase();
  if (v === 'good') return 4;
  if (v === 'ok' || v === 'upload') return 3;
  if (v === 'poor') return 2;
  return 1;
}

function uniqueDest(dir, preferred) {
  const base = path.basename(String(preferred || 'photo.jpg')).replace(/[^\w.-]+/g, '-');
  if (!existsSync(path.join(dir, base))) return base;
  const ext = path.extname(base) || '.jpg';
  const stem = base.slice(0, -ext.length);
  return `${stem}-${Date.now().toString(36)}${ext}`;
}

function candidateIdForGroup(group) {
  return (
    group?.sourceCandidateId ||
    (group?.slots || []).find((s) => s.sourceCandidateId)?.sourceCandidateId ||
    null
  );
}

function structureIndexForCandidate(candidateId) {
  const byKey = new Map();
  const svcHeroByIndex = new Map();
  const servicesByIndex = new Map();
  let hasSvcMaterials = false;
  let hasSvcProcess = false;
  if (candidateId) {
    try {
      for (const s of listImageSlots(candidateId)) {
        byKey.set(s.key, s);
        const n = Number(s.index) || 0;
        if (s.sectionId === 'svcHero') svcHeroByIndex.set(n, s);
        if (s.sectionId === 'services') servicesByIndex.set(n, s);
        if (s.sectionId === 'svcMaterials') hasSvcMaterials = true;
        if (s.sectionId === 'svcProcess') hasSvcProcess = true;
      }
    } catch {
      /* Structure optional */
    }
  }
  return {
    byKey,
    svcHeroByIndex,
    servicesByIndex,
    preferSvcHero: svcHeroByIndex.size > 0,
    hasSvcMaterials,
    hasSvcProcess,
  };
}

function structureIndexForGroup(group) {
  return structureIndexForCandidate(candidateIdForGroup(group));
}

function structForSavedSlot(slot, idx) {
  const fromKey = idx.byKey.get(slot.key) || {};
  const n =
    Number(slot.index) ||
    Number(fromKey.index) ||
    indexFromSlotKey(slot.key) ||
    indexFromSlotKey(slot.filename) ||
    1;
  const id = slot.sectionId || fromKey.sectionId;
  let fromIndex = {};
  if (id === 'svcHero') {
    fromIndex = idx.svcHeroByIndex.get(n) || {};
  } else if (id === 'services') {
    fromIndex = idx.servicesByIndex.get(n) || idx.svcHeroByIndex.get(n) || {};
  }
  return {
    ...fromIndex,
    ...fromKey,
    index: fromKey.index || fromIndex.index || n,
    sectionId: fromKey.sectionId || fromIndex.sectionId || id,
    serviceName: fromKey.serviceName || fromIndex.serviceName || null,
    label: fromKey.label || fromIndex.label || null,
    serviceSlug: fromKey.serviceSlug || fromIndex.serviceSlug || null,
  };
}

function hydrateGroupSlots(group, idx = structureIndexForGroup(group)) {
  return (group.slots || []).map((s) => mergeStructureOntoSlot(s, structForSavedSlot(s, idx)));
}

function serviceRoleName(matchKey) {
  const m = String(matchKey || '').match(/^(?:services|svcHero):(.+)$/i);
  return m ? m[1] : '';
}

const SERVICE_PAGE_SECTIONS = new Set(['svcHero', 'svcMaterials', 'svcProcess']);

function structureHasServicePageSection(idx, sectionId) {
  if (sectionId === 'svcHero') return idx.preferSvcHero;
  if (sectionId === 'svcMaterials') return idx.hasSvcMaterials;
  if (sectionId === 'svcProcess') return idx.hasSvcProcess;
  return false;
}

function isUnnamedServicePageSlot(slot) {
  const id = slot.sectionId;
  if (!SERVICE_PAGE_SECTIONS.has(id)) return false;
  if (id === 'svcHero') {
    const name = String(slot.serviceName || slot.label || '').trim();
    if (!name) return true;
    if (looksLikeSlotKey(name, slot.key)) return true;
    return name.toLowerCase() === 'svchero';
  }
  if (id === 'svcMaterials') {
    const title = String(slot.materialTitle || slot.serviceName || slot.label || '').trim();
    if (!title) return true;
    if (looksLikeSlotKey(title, slot.key)) return true;
    return title.toLowerCase() === 'svcmaterials';
  }
  const title = String(slot.processTitle || slot.serviceName || slot.label || '').trim();
  if (!title) return true;
  if (looksLikeSlotKey(title, slot.key)) return true;
  return title.toLowerCase() === 'svcprocess';
}

function isOrphanServicePageSlot(slot, idx) {
  if (!SERVICE_PAGE_SECTIONS.has(slot.sectionId)) return false;
  if (!structureHasServicePageSection(idx, slot.sectionId)) return true;
  return isUnnamedServicePageSlot(mergeStructureOntoSlot(slot, structForSavedSlot(slot, idx)));
}

function pruneOrphanServicePageSlots(group, idx = structureIndexForGroup(group)) {
  let removed = 0;
  const kept = [];
  for (const s of group.slots || []) {
    if (!isOrphanServicePageSlot(s, idx)) {
      kept.push(s);
      continue;
    }
    if (s.filename) {
      const abs = path.join(group.dir, s.filename);
      try {
        if (existsSync(abs)) unlinkSync(abs);
      } catch {
        /* ignore missing file */
      }
    }
    removed += 1;
  }
  if (removed) group.slots = kept;
  return removed;
}

function collapseServiceRoles(slots, preferSvcHero) {
  const rest = [];
  const byName = new Map();
  for (const s of slots) {
    if (s.sectionId !== 'svcHero' && s.sectionId !== 'services') {
      rest.push(s);
      continue;
    }
    const name = serviceRoleName(matchKeyForSlot(s));
    if (!name || name === 'svchero') {
      if (s.sectionId === 'svcHero') continue;
      rest.push(s);
      continue;
    }
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(s);
  }
  const picked = [];
  for (const list of byName.values()) {
    const preferredRole = preferSvcHero ? 'svcHero' : 'services';
    const otherRole = preferSvcHero ? 'services' : 'svcHero';
    const preferred = list.filter((s) => s.sectionId === preferredRole);
    const other = list.filter((s) => s.sectionId === otherRole);
    picked.push(...(preferred.length ? preferred : other.length ? other : list));
  }
  return [...picked, ...rest];
}

function sectionOrderIndex(sectionId) {
  const i = IMAGE_SECTION_DEFAULT_ORDER.indexOf(String(sectionId || ''));
  return i >= 0 ? i : 900;
}

function inferSlotSource(slot, onDisk) {
  if (slot.source) return slot.source;
  if (slot.provider) return 'stock';
  const name = String(slot.filename || '');
  if (onDisk && /gallery-ba-/i.test(name)) return 'chatgpt';
  if (onDisk && /upload/i.test(name)) return 'upload';
  if (onDisk) return 'stock';
  return null;
}

function previewUrl(groupId, filename) {
  if (!filename) return null;
  return `/api/photo-groups/${encodeURIComponent(groupId)}/file/${encodeURIComponent(filename)}?v=${encodeURIComponent(filename)}`;
}

function groupFileAbs(group, filename) {
  if (!filename) return null;
  return path.join(group.dir, path.basename(String(filename)));
}

function groupFileExists(group, filename) {
  const abs = groupFileAbs(group, filename);
  return Boolean(abs && existsSync(abs));
}

function slotVariantsOnDisk(group, variants) {
  return (Array.isArray(variants) ? variants : []).filter((v) => groupFileExists(group, v.filename));
}

function baVariantsOnDisk(group, variants) {
  return (Array.isArray(variants) ? variants : []).filter(
    (v) => groupFileExists(group, v.beforeFilename) && groupFileExists(group, v.afterFilename),
  );
}

/** Drop tray records whose files were never copied into the group folder. */
function pruneMissingGroupVariants(group) {
  let dropped = 0;
  for (const s of group.slots || []) {
    const list = Array.isArray(s.variants) ? s.variants : [];
    const onDisk = slotVariantsOnDisk(group, list);
    const compacted = compactSlotTray(group.dir, onDisk, {
      liveFilename: s.filename,
      livePhotoId: s.photoId,
    });
    dropped += list.length - compacted.length;
    s.variants = compacted;
  }
  const pruneBa = (pairs) => {
    for (const p of pairs || []) {
      const list = Array.isArray(p.variants) ? p.variants : [];
      const onDisk = baVariantsOnDisk(group, list);
      const compacted = compactBaTray(group.dir, onDisk, {
        liveBefore: p.before?.filename,
        liveAfter: p.after?.filename,
      });
      dropped += list.length - compacted.length;
      p.variants = compacted;
    }
  };
  pruneBa(group.beforeAfter?.home);
  pruneBa(group.beforeAfter?.services);
  return dropped;
}

function copyOnDiskVariants(srcDir, destDir, variants, { ba = false } = {}) {
  const out = [];
  for (const v of variants || []) {
    if (ba) {
      const next = { ...v };
      let kept = false;
      if (v.beforeFilename) {
        const from = path.join(srcDir, path.basename(String(v.beforeFilename)));
        if (existsSync(from)) {
          const destName = uniqueDest(destDir, v.beforeFilename);
          copyFileSync(from, path.join(destDir, destName));
          next.beforeFilename = destName;
          kept = true;
        } else {
          delete next.beforeFilename;
        }
      }
      if (v.afterFilename) {
        const from = path.join(srcDir, path.basename(String(v.afterFilename)));
        if (existsSync(from)) {
          const destName = uniqueDest(destDir, v.afterFilename);
          copyFileSync(from, path.join(destDir, destName));
          next.afterFilename = destName;
          kept = true;
        } else {
          delete next.afterFilename;
        }
      }
      if (kept) out.push(next);
    } else if (v.filename) {
      const from = path.join(srcDir, path.basename(String(v.filename)));
      if (!existsSync(from)) continue;
      const destName = uniqueDest(destDir, v.filename);
      copyFileSync(from, path.join(destDir, destName));
      out.push({ ...v, filename: destName });
    }
  }
  return out;
}

function groupSiteConfig(group) {
  const cid = candidateIdForGroup(group);
  if (!cid) return {};
  try {
    return loadAcceptedSiteConfig(cid)?.config || {};
  } catch {
    return {};
  }
}

function groupSlotSetting(group, slot = {}) {
  return slotSettingKind({
    serviceName: slot.serviceName,
    serviceSlug: slot.serviceSlug,
    config: groupSiteConfig(group),
  });
}

function groupOpenaiDoc(group) {
  return loadOpenaiPromptsFile(openaiPromptsPathForGroupDir(group.dir));
}

function saveGroupOpenaiDoc(group, doc) {
  return saveOpenaiPromptsFile(openaiPromptsPathForGroupDir(group.dir), doc);
}

function canonicalGroupSlotPrompt(group, existing, { viewpoint, forChatGpt = true } = {}) {
  const cid = candidateIdForGroup(group);
  const setting = groupSlotSetting(group, existing);
  if (cid && existing.key) {
    try {
      return fluxSlotPromptForCandidate(cid, existing.key, { viewpoint, forChatGpt });
    } catch {
      /* fall through */
    }
  }
  return fluxSlotPromptFromMeta({
    niche: group.niche,
    slot: existing,
    viewpoint,
    setting,
    config: groupSiteConfig(group),
    forChatGpt,
  });
}

function decorateBaPair(group, pair, extras = {}) {
  const row = { ...pair, ...extras };
  const cid = candidateIdForGroup(group);
  const config = groupSiteConfig(group);
  const setting = slotSettingKind({
    serviceName: extras.serviceName || pair.serviceName || '',
    serviceSlug: extras.serviceSlug || pair.serviceSlug || '',
    config,
  });
  let promptsForGenerate = null;
  if (cid) {
    try {
      promptsForGenerate = baPromptsForCard(cid, {
        serviceSlug: extras.serviceSlug || pair.serviceSlug || '',
        pairIndex: extras.pairIndex || pair.pairIndex || 1,
      });
    } catch {
      promptsForGenerate = null;
    }
  }
  if (!promptsForGenerate) {
    const one = (vp) => {
      const built = buildFluxBaPrompts({
        niche: group.niche,
        serviceName: extras.serviceName || pair.serviceName || group.niche,
        viewpoint: vp,
        setting,
        config,
        forChatGpt: true,
      });
      return {
        before: built.before,
        after: built.after,
        originalBefore: built.before,
        originalAfter: built.after,
        source: 'template',
        room: built.room || null,
        setting: built.setting || setting,
      };
    };
    promptsForGenerate = { inside: one('inside'), outside: one('outside') };
  }
  promptsForGenerate = overlayBaCardPrompts(
    promptsForGenerate,
    groupOpenaiDoc(group),
    extras.matchKey || pair.matchKey || '',
  );
  return {
    ...row,
    beforeUrl: row.before?.filename ? previewUrl(group.id, row.before.filename) : null,
    afterUrl: row.after?.filename ? previewUrl(group.id, row.after.filename) : null,
    lastPrompts: row.lastPrompts || null,
    promptsForGenerate,
    ...baPairGradeFields({
      complete: Boolean(row.before?.filename && row.after?.filename),
      alts: [row.before?.alt, row.after?.alt, row.source].filter(Boolean).join(' '),
      meta: {
        source: row.source || null,
        matchGrade: row.matchGrade || null,
        matchTip: row.matchTip || null,
      },
    }),
    variants: baVariantsOnDisk(group, row.variants).map((v) => ({
      ...v,
      beforeUrl: groupFileExists(group, v.beforeFilename)
        ? previewUrl(group.id, v.beforeFilename)
        : null,
      afterUrl: groupFileExists(group, v.afterFilename)
        ? previewUrl(group.id, v.afterFilename)
        : null,
    })),
  };
}

function structureBaServices(group) {
  const cid = candidateIdForGroup(group);
  if (cid) {
    try {
      const targets = listConfiguredServiceTargets(cid);
      if (targets.length) return targets;
    } catch {
      /* fall through */
    }
  }
  const bySlug = new Map();
  for (const s of group.slots || []) {
    const name = String(s.serviceName || '').trim();
    if (!name) continue;
    const slug = String(s.serviceSlug || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (!slug || bySlug.has(slug)) continue;
    bySlug.set(slug, { slug, serviceName: name });
  }
  return [...bySlug.values()];
}

function photoGroupBaView(group) {
  const savedHome = [...(group.beforeAfter?.home || [])];
  const savedSvc = [...(group.beforeAfter?.services || [])];
  const homeByIndex = new Map(savedHome.map((p) => [p.pairIndex || 1, p]));
  const home = [];
  const home1 = homeByIndex.get(1) || { pairIndex: 1, before: null, after: null, variants: [] };
  home.push(decorateBaPair(group, home1, { matchKey: 'ba:home:1', pairIndex: 1 }));
  for (const p of savedHome) {
    const idx = p.pairIndex || 1;
    if (idx === 1) continue;
    home.push(decorateBaPair(group, p, { matchKey: `ba:home:${idx}` }));
  }

  const targets = structureBaServices(group);
  const used = new Set();
  const services = [];
  for (const t of targets) {
    const mk = `ba:svc:${String(t.serviceName || t.slug || '').toLowerCase()}`;
    const hit = savedSvc.find((p) => {
      const k = `ba:svc:${String(p.serviceName || p.serviceSlug || '').toLowerCase()}`;
      return k === mk || p.serviceSlug === t.slug;
    });
    if (hit) used.add(hit);
    services.push(
      decorateBaPair(
        group,
        hit || {
          serviceSlug: t.slug,
          serviceName: t.serviceName,
          before: null,
          after: null,
          variants: [],
        },
        { matchKey: mk, serviceSlug: t.slug, serviceName: t.serviceName },
      ),
    );
  }
  for (const p of savedSvc) {
    if (used.has(p)) continue;
    services.push(
      decorateBaPair(group, p, {
        matchKey: `ba:svc:${String(p.serviceName || p.serviceSlug || '').toLowerCase()}`,
      }),
    );
  }
  return { home, services };
}

function slotCard(group, slot, registry) {
  const onDisk = Boolean(slot.filename && existsSync(path.join(group.dir, slot.filename)));
  const matchKey = matchKeyForSlot(slot);
  const groupKey = sectionGroupKey(slot.sectionId);
  const source = inferSlotSource(slot, onDisk);
  return {
    ...slot,
    matchKey,
    label: displayLabelForSlot(slot),
    wiredFm: wiredFmForSlot(slot) || slot.key,
    sectionGroup: groupKey,
    sectionLabel: sectionLabelForGroup(
      groupKey === 'services' ? 'services' : slot.sectionId,
      registry,
    ),
    missing: !onDisk,
    previewUrl: onDisk ? previewUrl(group.id, slot.filename) : null,
    source,
    variants: slotVariantsOnDisk(group, slot.variants).map((v) => ({
      ...v,
      previewUrl: previewUrl(group.id, v.filename),
    })),
  };
}

function sortSlotsBestFirst(slots) {
  const buckets = new Map();
  for (const s of slots) {
    const k = matchKeyForSlot(s) || s.key;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(s);
  }
  const out = [];
  for (const list of buckets.values()) {
    list.sort((a, b) => {
      const g = gradeRank(b.matchGrade) - gradeRank(a.matchGrade);
      if (g) return g;
      return String(b.savedAt || '').localeCompare(String(a.savedAt || ''));
    });
    out.push(...list.slice(0, ALT_CAP));
  }
  return out;
}

export function listPhotoLibrary({ niche } = {}) {
  const niches = listPhotoGroupNiches();
  const groups = listPhotoGroups({ niche: niche || undefined });
  return { ok: true, niches, groups, niche: niche || '' };
}

export function getPhotoGroupView(groupId) {
  const group = getPhotoGroup(groupId);
  const registry = loadSectionRegistry();
  const idx = structureIndexForGroup(group);
  const prunedOrphans = pruneOrphanServicePageSlots(group, idx);
  const prunedVars = pruneMissingGroupVariants(group);
  if (prunedOrphans || prunedVars) persistPhotoGroupRecord(group);
  const hydrated = collapseServiceRoles(
    hydrateGroupSlots(group, idx).filter((s) => !isUnnamedServicePageSlot(s)),
    idx.preferSvcHero,
  );
  const primaries = [];
  const seen = new Set();
  for (const s of sortSlotsBestFirst(hydrated)) {
    const k = matchKeyForSlot(s);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    primaries.push(slotCard(group, s, registry));
  }
  const sectionsMap = new Map();
  for (const s of primaries) {
    const gKey = s.sectionGroup || s.sectionId || 'leftover';
    if (!sectionsMap.has(gKey)) {
      sectionsMap.set(gKey, {
        sectionId: gKey,
        label: s.sectionLabel || sectionLabelForGroup(gKey, registry),
        slots: [],
        _order: sectionOrderIndex(s.sectionId),
      });
    }
    const sec = sectionsMap.get(gKey);
    sec._order = Math.min(sec._order, sectionOrderIndex(s.sectionId));
    sec.slots.push(s);
  }
  for (const sec of sectionsMap.values()) {
    sec.slots.sort(
      (a, b) =>
        (Number(a.index) || 0) - (Number(b.index) || 0) || String(a.key || '').localeCompare(String(b.key || '')),
    );
  }
  const sections = [...sectionsMap.values()].sort((a, b) => a._order - b._order);
  for (const sec of sections) delete sec._order;
  const beforeAfter = photoGroupBaView(group);
  return {
    ok: true,
    group: {
      id: group.id,
      name: group.name,
      niche: group.niche,
      kind: group.kind || 'named',
      slotCount: group.slotCount,
      baPairCount: (beforeAfter.home || []).length + (beforeAfter.services || []).length,
      savedAt: group.savedAt,
      sourceCandidateId: group.sourceCandidateId || null,
    },
    sections,
    beforeAfter,
  };
}

export function listRolePhotos({ niche, matchKey, excludeGroupId, excludeFilename } = {}) {
  const key = String(matchKey || '').trim();
  if (!key) return { ok: true, photos: [] };
  const skipFile = String(excludeFilename || '').trim();
  const photos = [];
  for (const meta of listPhotoGroups({ niche })) {
    if (excludeGroupId && meta.id === excludeGroupId && !skipFile) continue;
    let group;
    try {
      group = getPhotoGroup(meta.id);
    } catch {
      continue;
    }
    if (key.startsWith('ba:home:')) {
      const idx = Number(key.split(':')[2]) || 1;
      for (const p of group.beforeAfter?.home || []) {
        if ((p.pairIndex || 1) !== idx) continue;
        if (
          excludeGroupId &&
          group.id === excludeGroupId &&
          skipFile &&
          (p.before?.filename === skipFile || p.after?.filename === skipFile)
        ) {
          continue;
        }
        photos.push({
          groupId: group.id,
          groupName: group.name,
          kind: group.kind,
          matchKey: key,
          ba: true,
          before: p.before,
          after: p.after,
          beforeUrl: p.before?.filename ? previewUrl(group.id, p.before.filename) : null,
          afterUrl: p.after?.filename ? previewUrl(group.id, p.after.filename) : null,
        });
      }
      continue;
    }
    if (key.startsWith('ba:svc:')) {
      for (const p of group.beforeAfter?.services || []) {
        const mk = `ba:svc:${String(p.serviceName || p.serviceSlug || '').toLowerCase()}`;
        if (mk !== key) continue;
        if (
          excludeGroupId &&
          group.id === excludeGroupId &&
          skipFile &&
          (p.before?.filename === skipFile || p.after?.filename === skipFile)
        ) {
          continue;
        }
        photos.push({
          groupId: group.id,
          groupName: group.name,
          kind: group.kind,
          matchKey: key,
          ba: true,
          before: p.before,
          after: p.after,
          beforeUrl: p.before?.filename ? previewUrl(group.id, p.before.filename) : null,
          afterUrl: p.after?.filename ? previewUrl(group.id, p.after.filename) : null,
        });
      }
      continue;
    }
    const idx = structureIndexForGroup(group);
    for (const s of group.slots || []) {
      const hyd = mergeStructureOntoSlot(s, structForSavedSlot(s, idx));
      if (isUnnamedServicePageSlot(hyd)) continue;
      const mk = matchKeyForSlot(hyd);
      const sameService =
        Boolean(serviceRoleName(key)) && serviceRoleName(mk) === serviceRoleName(key);
      if (mk !== key && !sameService) continue;
      if (excludeGroupId && group.id === excludeGroupId && skipFile && s.filename === skipFile) {
        continue;
      }
      const onDisk = Boolean(s.filename && existsSync(path.join(group.dir, s.filename)));
      photos.push({
        groupId: group.id,
        groupName: group.name,
        kind: group.kind,
        matchKey: key,
        filename: s.filename,
        matchGrade: s.matchGrade,
        source: s.source,
        query: s.query,
        previewUrl: onDisk ? previewUrl(group.id, s.filename) : null,
      });
    }
  }
  return { ok: true, photos: photos.slice(0, 48), truncated: photos.length > 48 };
}

function decodeDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/[\w+.-]+);base64,(.+)$/i);
  if (!m) {
    throw Object.assign(new Error('Provide a data:image…;base64 upload'), { status: 400 });
  }
  const mime = m[1].toLowerCase();
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';
  return { ext, buffer: Buffer.from(m[2], 'base64') };
}

function putSlotOnGroup(dest, matchKey, incoming) {
  let slots = dest.slots || [];
  if (dest.kind === 'master') {
    slots = slots.filter((s) => {
      if (s.filename && s.filename === incoming.filename) return false;
      if (incoming.photoId && s.photoId && s.photoId === incoming.photoId) return false;
      return true;
    });
    slots.unshift(incoming);
  } else {
    slots = slots.filter((s) => matchKeyForSlot(s) !== matchKey);
    slots.unshift(incoming);
  }
  dest.slots = sortSlotsBestFirst(slots);
}

export function swapPhotoGroupSlot(groupId, { matchKey, fromGroupId, filename, ba } = {}) {
  const dest = getPhotoGroup(groupId);
  const src = getPhotoGroup(fromGroupId);
  if (!nichesEqual(dest.niche, src.niche)) {
    throw Object.assign(new Error('Can only swap photos within the same niche'), { status: 400 });
  }
  if (ba || String(matchKey || '').startsWith('ba:')) {
    return swapBaPair(dest, src, matchKey);
  }
  const saved = (src.slots || []).find(
    (s) => s.filename === filename || matchKeyForSlot(s) === matchKey,
  );
  if (!saved?.filename) {
    throw Object.assign(new Error('Source photo not found'), { status: 404 });
  }
  const fromAbs = path.join(src.dir, saved.filename);
  if (!existsSync(fromAbs)) {
    throw Object.assign(new Error('Source file missing'), { status: 404 });
  }
  const destName = uniqueDest(dest.dir, saved.filename);
  copyFileSync(fromAbs, path.join(dest.dir, destName));
  const incoming = { ...saved, filename: destName, savedAt: new Date().toISOString() };
  putSlotOnGroup(dest, matchKeyForSlot(incoming), incoming);
  return { ok: true, group: persistPhotoGroupRecord(dest) };
}

function swapBaPair(dest, src, matchKey) {
  let pair = null;
  if (String(matchKey).startsWith('ba:home:')) {
    const idx = Number(String(matchKey).split(':')[2]) || 1;
    pair = (src.beforeAfter?.home || []).find((p) => (p.pairIndex || 1) === idx);
    if (!pair?.before?.filename || !pair?.after?.filename) {
      throw Object.assign(new Error('Source pair incomplete'), { status: 400 });
    }
    const beforeName = uniqueDest(dest.dir, pair.before.filename);
    const afterName = uniqueDest(dest.dir, pair.after.filename);
    copyFileSync(path.join(src.dir, pair.before.filename), path.join(dest.dir, beforeName));
    copyFileSync(path.join(src.dir, pair.after.filename), path.join(dest.dir, afterName));
    const home = [...(dest.beforeAfter?.home || [])].filter((p) => (p.pairIndex || 1) !== idx);
    home.push({
      pairIndex: idx,
      before: { filename: beforeName, ext: path.extname(beforeName).slice(1) },
      after: { filename: afterName, ext: path.extname(afterName).slice(1) },
    });
    dest.beforeAfter = { ...(dest.beforeAfter || {}), home, services: dest.beforeAfter?.services || [] };
  } else {
    pair = (src.beforeAfter?.services || []).find((p) => {
      const mk = `ba:svc:${String(p.serviceName || p.serviceSlug || '').toLowerCase()}`;
      return mk === matchKey;
    });
    if (!pair?.before?.filename || !pair?.after?.filename) {
      throw Object.assign(new Error('Source pair incomplete'), { status: 400 });
    }
    const beforeName = uniqueDest(dest.dir, pair.before.filename);
    const afterName = uniqueDest(dest.dir, pair.after.filename);
    copyFileSync(path.join(src.dir, pair.before.filename), path.join(dest.dir, beforeName));
    copyFileSync(path.join(src.dir, pair.after.filename), path.join(dest.dir, afterName));
    const services = [...(dest.beforeAfter?.services || [])].filter((p) => {
      const mk = `ba:svc:${String(p.serviceName || p.serviceSlug || '').toLowerCase()}`;
      return mk !== matchKey;
    });
    services.push({
      ...pair,
      before: { filename: beforeName, ext: path.extname(beforeName).slice(1) },
      after: { filename: afterName, ext: path.extname(afterName).slice(1) },
    });
    dest.beforeAfter = { home: dest.beforeAfter?.home || [], services };
  }
  return { ok: true, group: persistPhotoGroupRecord(dest) };
}

export function uploadPhotoGroupSlot(groupId, { matchKey, dataUrl, alt } = {}) {
  const dest = getPhotoGroup(groupId);
  const decoded = decodeDataUrl(dataUrl);
  const existing = (dest.slots || []).find((s) => matchKeyForSlot(s) === matchKey);
  if (!existing) {
    throw Object.assign(new Error('Unknown slot — pick a slot in this group first'), { status: 400 });
  }
  const filename = uniqueDest(dest.dir, `${existing.key || 'slot'}-upload.${decoded.ext}`);
  writeFileSync(path.join(dest.dir, filename), decoded.buffer);
  const incoming = {
    ...existing,
    filename,
    source: 'upload',
    provider: null,
    photoId: `upload:${groupId}:${Date.now()}`,
    attribution: 'Operator upload',
    alt: String(alt || existing.alt || existing.label || 'Photo').slice(0, 180),
    matchGrade: 'ok',
    savedAt: new Date().toISOString(),
  };
  putSlotOnGroup(dest, matchKey, incoming);
  return { ok: true, group: persistPhotoGroupRecord(dest) };
}

export async function repullPhotoGroupSlot(groupId, { matchKey } = {}) {
  const dest = getPhotoGroup(groupId);
  const existing = (dest.slots || []).find((s) => matchKeyForSlot(s) === matchKey);
  if (!existing) {
    throw Object.assign(new Error('Unknown slot'), { status: 400 });
  }
  if (!existing.query && !dest.niche) {
    throw Object.assign(new Error('No search query on this slot — Upload or Swap instead'), { status: 400 });
  }
  const providers = configuredImageProviders();
  if (!providers.length) {
    throw Object.assign(new Error('No image API keys configured'), { status: 400 });
  }
  const usedIds = new Set((dest.slots || []).map((s) => s.photoId).filter(Boolean));
  const queries = [existing.query, dest.niche, existing.serviceName].filter(Boolean);
  const tokens = new Set(
    String(dest.niche || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
  const searched = await searchStockForSlot({
    providers,
    queries: [...new Set(queries)].slice(0, 3),
    usedIds,
    tokens,
    rankOpts: {},
    perPage: 30,
    pages: [1],
    priorPhotoId: existing.photoId || null,
    sleepMs: 150,
    allowSoftFill: true,
    skipProviders: new Set(),
  });
  if (!searched.chosen || !searched.download?.buffer?.length) {
    throw Object.assign(new Error('Re-pull found no unused stock'), { status: 400 });
  }
  const filename = uniqueDest(dest.dir, `${existing.key || 'slot'}-stock.jpg`);
  let variants = [...(existing.variants || [])];
  if (existing.filename && existsSync(path.join(dest.dir, existing.filename))) {
    variants = pushSlotTrayEntry(dest.dir, variants, {
      filename: existing.filename,
      source: existing.source || 'stock',
      provider: existing.provider || null,
      photoId: existing.photoId || null,
      matchGrade: existing.matchGrade || null,
    });
  }
  writeFileSync(path.join(dest.dir, filename), searched.download.buffer);
  const incoming = {
    ...existing,
    filename,
    source: 'stock',
    provider: searched.providerUsed,
    photoId: searched.download.id || searched.chosen.id,
    query: searched.chosenQuery || existing.query,
    score: searched.relevanceScore ?? existing.score,
    matchGrade: searched.softFill ? 'poor' : existing.matchGrade || 'ok',
    attribution: searched.download.attribution,
    photographer: searched.download.photographer,
    pageUrl: searched.download.pageUrl,
    savedAt: new Date().toISOString(),
    variants,
  };
  putSlotOnGroup(dest, matchKey, incoming);
  return { ok: true, group: persistPhotoGroupRecord(dest) };
}

export function chatgptPromptForGroupSlot(groupId, matchKey, { viewpoint, prompt: bodyPrompt } = {}) {
  const dest = getPhotoGroup(groupId);
  const existing = (dest.slots || []).find((s) => matchKeyForSlot(s) === matchKey);
  if (!existing) {
    throw Object.assign(new Error('Unknown slot'), { status: 404 });
  }
  const built = canonicalGroupSlotPrompt(dest, existing, { viewpoint, forChatGpt: true });
  const override = getSlotPromptOverride(groupOpenaiDoc(dest), matchKey, built.viewpoint);
  const prompt = pickPromptText(built.prompt, override, bodyPrompt);
  return {
    ...built,
    original: built.prompt,
    prompt,
    overridden: prompt !== built.prompt,
  };
}

export function savePhotoGroupSlotOpenaiPrompt(groupId, matchKey, { viewpoint, prompt, restore } = {}) {
  const dest = getPhotoGroup(groupId);
  const existing = (dest.slots || []).find((s) => matchKeyForSlot(s) === matchKey);
  if (!existing) {
    throw Object.assign(new Error('Unknown slot'), { status: 404 });
  }
  const built = canonicalGroupSlotPrompt(dest, existing, { viewpoint, forChatGpt: true });
  let doc = groupOpenaiDoc(dest);
  const text = String(prompt || '').trim();
  if (restore || text === built.prompt) {
    doc = clearSlotPromptOverride(doc, matchKey, built.viewpoint);
  } else if (text) {
    doc = setSlotPromptOverride(doc, matchKey, built.viewpoint, text);
  }
  saveGroupOpenaiDoc(dest, doc);
  return chatgptPromptForGroupSlot(groupId, matchKey, { viewpoint: built.viewpoint });
}

export function importPhotoGroupBa(groupId, body = {}) {
  const dest = getPhotoGroup(groupId);
  const before = decodeDataUrl(body.beforeDataUrl || body.before?.dataUrl);
  const after = decodeDataUrl(body.afterDataUrl || body.after?.dataUrl);
  const kind = body.kind === 'service' ? 'service' : 'home';
  dest.beforeAfter = dest.beforeAfter || { home: [], services: [] };
  if (kind === 'home') {
    const idx = Number(body.pairIndex) || (dest.beforeAfter.home.length + 1);
    let pair = (dest.beforeAfter.home || []).find((p) => (p.pairIndex || 1) === idx);
    if (!pair) {
      pair = { pairIndex: idx, before: null, after: null, variants: [] };
      dest.beforeAfter.home.push(pair);
    }
    const variants = archiveGroupBaPair(dest, pair);
    const beforeName = `gallery-ba-${idx}-before.${before.ext}`;
    const afterName = `gallery-ba-${idx}-after.${after.ext}`;
    if (pair.before?.filename && pair.before.filename !== beforeName) {
      unlinkQuiet(path.join(dest.dir, pair.before.filename));
    }
    if (pair.after?.filename && pair.after.filename !== afterName) {
      unlinkQuiet(path.join(dest.dir, pair.after.filename));
    }
    writeFileSync(path.join(dest.dir, beforeName), before.buffer);
    writeFileSync(path.join(dest.dir, afterName), after.buffer);
    pair.before = { filename: beforeName, ext: before.ext };
    pair.after = { filename: afterName, ext: after.ext };
    pair.variants = trimGroupVariants(dest.dir, variants);
  } else {
    const slug = String(body.serviceSlug || body.serviceName || 'service')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const matchKey = `ba:svc:${String(body.serviceName || slug).toLowerCase()}`;
    let pair = (dest.beforeAfter.services || []).find((p) => {
      const mk = `ba:svc:${String(p.serviceName || p.serviceSlug || '').toLowerCase()}`;
      return mk === matchKey;
    });
    if (!pair) {
      pair = {
        serviceSlug: slug,
        serviceName: body.serviceName || slug,
        before: null,
        after: null,
        variants: [],
      };
      dest.beforeAfter.services.push(pair);
    }
    const variants = archiveGroupBaPair(dest, pair);
    const beforeName = `svc-ba-${slug}-1-before.${before.ext}`;
    const afterName = `svc-ba-${slug}-1-after.${after.ext}`;
    if (pair.before?.filename && pair.before.filename !== beforeName) {
      unlinkQuiet(path.join(dest.dir, pair.before.filename));
    }
    if (pair.after?.filename && pair.after.filename !== afterName) {
      unlinkQuiet(path.join(dest.dir, pair.after.filename));
    }
    writeFileSync(path.join(dest.dir, beforeName), before.buffer);
    writeFileSync(path.join(dest.dir, afterName), after.buffer);
    pair.serviceSlug = slug;
    pair.serviceName = body.serviceName || pair.serviceName || slug;
    pair.before = { filename: beforeName, ext: before.ext };
    pair.after = { filename: afterName, ext: after.ext };
    pair.variants = trimGroupVariants(dest.dir, variants);
  }
  return { ok: true, group: persistPhotoGroupRecord(dest), view: getPhotoGroupView(groupId) };
}

export function removePhotoGroupSlot(groupId, { matchKey } = {}) {
  const dest = getPhotoGroup(groupId);
  dest.slots = (dest.slots || []).filter((s) => matchKeyForSlot(s) !== matchKey);
  return { ok: true, group: persistPhotoGroupRecord(dest) };
}

export function renamePhotoGroup(groupId, name) {
  const dest = getPhotoGroup(groupId);
  if (dest.kind === 'master') {
    throw Object.assign(new Error('The niche master cannot be renamed'), { status: 400 });
  }
  const trimmed = String(name || '').trim();
  if (!trimmed) throw Object.assign(new Error('Name required'), { status: 400 });
  dest.name = trimmed;
  return { ok: true, group: persistPhotoGroupRecord(dest) };
}

export function duplicatePhotoGroup(groupId, name) {
  const src = getPhotoGroup(groupId);
  const trimmed = String(name || `${src.name} copy`).trim();
  const id = `${String(trimmed)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)}-${Date.now().toString(36)}`;
  const destDir = path.join(PHOTO_GROUPS_DIR, id);
  mkdirSync(destDir, { recursive: true });
  const slots = [];
  for (const s of src.slots || []) {
    if (!s.filename) continue;
    const from = path.join(src.dir, s.filename);
    if (!existsSync(from)) continue;
    const destName = uniqueDest(destDir, s.filename);
    copyFileSync(from, path.join(destDir, destName));
    slots.push({
      ...s,
      filename: destName,
      variants: copyOnDiskVariants(src.dir, destDir, s.variants),
    });
  }
  const beforeAfter = { home: [], services: [] };
  for (const p of src.beforeAfter?.home || []) {
    const b = uniqueDest(destDir, p.before.filename);
    const a = uniqueDest(destDir, p.after.filename);
    copyFileSync(path.join(src.dir, p.before.filename), path.join(destDir, b));
    copyFileSync(path.join(src.dir, p.after.filename), path.join(destDir, a));
    beforeAfter.home.push({
      pairIndex: p.pairIndex,
      before: { filename: b, ext: p.before.ext },
      after: { filename: a, ext: p.after.ext },
      variants: copyOnDiskVariants(src.dir, destDir, p.variants, { ba: true }),
    });
  }
  for (const p of src.beforeAfter?.services || []) {
    const b = uniqueDest(destDir, p.before.filename);
    const a = uniqueDest(destDir, p.after.filename);
    copyFileSync(path.join(src.dir, p.before.filename), path.join(destDir, b));
    copyFileSync(path.join(src.dir, p.after.filename), path.join(destDir, a));
    beforeAfter.services.push({
      ...p,
      before: { filename: b, ext: p.before.ext },
      after: { filename: a, ext: p.after.ext },
      variants: copyOnDiskVariants(src.dir, destDir, p.variants, { ba: true }),
    });
  }
  return {
    ok: true,
    group: persistPhotoGroupRecord({
      id,
      dir: destDir,
      name: trimmed,
      niche: src.niche,
      kind: 'named',
      sourceCandidateId: src.sourceCandidateId,
      slots,
      beforeAfter,
    }),
  };
}

export function deletePhotoGroup(groupId) {
  const dest = getPhotoGroup(groupId);
  if (dest.kind === 'master') {
    throw Object.assign(new Error('The niche master cannot be deleted'), { status: 400 });
  }
  rmSync(dest.dir, { recursive: true, force: true });
  dropPhotoGroupFromIndex(groupId);
  const cleared = [];
  for (const name of readdirSync(RESEARCH_DIR)) {
    if (!name.endsWith('-photo-group.json')) continue;
    const file = path.join(RESEARCH_DIR, name);
    try {
      const doc = JSON.parse(readFileSync(file, 'utf8'));
      if (doc?.groupId === groupId) {
        unlinkSync(file);
        cleared.push(name.replace(/-photo-group\.json$/, ''));
      }
    } catch {
      // ignore
    }
  }
  return { ok: true, deletedId: groupId, clearedAttach: cleared, niche: dest.niche };
}

function readJsonSafe(file) {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function ensureMaster(niche) {
  const existing = findNicheMaster(niche);
  if (existing) return getPhotoGroup(existing.id);
  const id = masterIdForNiche(niche);
  const dir = path.join(PHOTO_GROUPS_DIR, id);
  mkdirSync(dir, { recursive: true });
  return persistPhotoGroupRecord({
    id,
    dir,
    name: `${niche} master`,
    niche,
    kind: 'master',
    slots: [],
    beforeAfter: { home: [], services: [] },
  });
}

function mergeSlotMeta(existing, incoming) {
  return mergeStructureOntoSlot(
    {
      ...existing,
      index: incoming.index ?? existing.index,
      serviceName: incoming.serviceName || existing.serviceName,
      processTitle: incoming.processTitle || existing.processTitle,
      materialTitle: incoming.materialTitle || existing.materialTitle,
      label: incoming.label || existing.label,
      query: incoming.query || existing.query,
      key: existing.key || incoming.key,
      sectionId: existing.sectionId || incoming.sectionId,
      source: existing.source || incoming.source,
      serviceSlug: incoming.serviceSlug || existing.serviceSlug,
      alt: incoming.alt || existing.alt,
      sourceCandidateId: existing.sourceCandidateId || incoming.sourceCandidateId,
    },
    {},
  );
}

export function upsertNicheMaster(candidateId) {
  const niche = String(loadAcceptedSiteConfig(candidateId)?.config?.niche || '').trim();
  if (!niche) return { ok: true, skipped: true, reason: 'no niche' };
  const p = pathsFor(candidateId);
  const manifest = readJsonSafe(p.imagesManifest);
  const diskBa = collectBaFromDisk(p.siteImages);
  const slotEntries = Object.values(manifest?.slots || {}).filter(
    (s) => s?.filename && !SKIP_SAVE_NAMES.test(s.filename),
  );
  if (!slotEntries.length && !diskBa.home.length && !diskBa.services.length) {
    return { ok: true, skipped: true, reason: 'no photos' };
  }
  const idx = structureIndexForCandidate(candidateId);
  const master = ensureMaster(niche);
  if (!master.sourceCandidateId) master.sourceCandidateId = candidateId;
  const knownIds = new Set((master.slots || []).map((s) => s.photoId).filter(Boolean));
  let added = 0;
  let updated = 0;
  for (const slot of slotEntries) {
    const abs = path.join(p.siteImages, slot.filename);
    if (!existsSync(abs)) continue;
    if (
      SERVICE_PAGE_SECTIONS.has(slot.sectionId) &&
      !structureHasServicePageSection(idx, slot.sectionId)
    ) {
      continue;
    }
    const incoming = mergeStructureOntoSlot(
      { ...slot, sourceCandidateId: candidateId },
      structForSavedSlot(slot, idx),
    );
    if (isUnnamedServicePageSlot(incoming)) continue;
    if (slot.photoId && knownIds.has(slot.photoId)) {
      const existing = (master.slots || []).find((s) => s.photoId === slot.photoId);
      if (existing) {
        Object.assign(existing, mergeSlotMeta(existing, incoming));
        updated += 1;
      }
      continue;
    }
    const destName = uniqueDest(master.dir, slot.filename);
    copyFileSync(abs, path.join(master.dir, destName));
    master.slots = master.slots || [];
    master.slots.push({
      ...incoming,
      filename: destName,
      variants: [],
      savedAt: new Date().toISOString(),
      sourceCandidateId: candidateId,
    });
    if (slot.photoId) knownIds.add(slot.photoId);
    added += 1;
  }
  pruneOrphanServicePageSlots(master, idx);
  master.slots = sortSlotsBestFirst(
    (master.slots || []).map((s) => mergeStructureOntoSlot(s, structForSavedSlot(s, idx))),
  );
  master.beforeAfter = master.beforeAfter || { home: [], services: [] };
  for (const pair of diskBa.home) {
    const dup = (master.beforeAfter.home || []).some(
      (p) => p.before?.filename === pair.before.filename && p.after?.filename === pair.after.filename,
    );
    if (dup) continue;
    if ((master.beforeAfter.home || []).length >= ALT_CAP) break;
    const b = uniqueDest(master.dir, pair.before.filename);
    const a = uniqueDest(master.dir, pair.after.filename);
    copyFileSync(path.join(p.siteImages, pair.before.filename), path.join(master.dir, b));
    copyFileSync(path.join(p.siteImages, pair.after.filename), path.join(master.dir, a));
    master.beforeAfter.home.push({
      pairIndex: (master.beforeAfter.home.length || 0) + 1,
      before: { filename: b, ext: pair.before.ext },
      after: { filename: a, ext: pair.after.ext },
    });
    added += 1;
  }
  for (const pair of diskBa.services) {
    const mk = `ba:svc:${String(pair.serviceName || pair.serviceSlug || '').toLowerCase()}`;
    const count = (master.beforeAfter.services || []).filter((p) => {
      const k = `ba:svc:${String(p.serviceName || p.serviceSlug || '').toLowerCase()}`;
      return k === mk;
    }).length;
    if (count >= ALT_CAP) continue;
    const b = uniqueDest(master.dir, pair.before.filename);
    const a = uniqueDest(master.dir, pair.after.filename);
    copyFileSync(path.join(p.siteImages, pair.before.filename), path.join(master.dir, b));
    copyFileSync(path.join(p.siteImages, pair.after.filename), path.join(master.dir, a));
    master.beforeAfter.services.push({
      serviceSlug: pair.serviceSlug,
      serviceName: pair.serviceName || pair.serviceSlug,
      before: { filename: b, ext: pair.before.ext },
      after: { filename: a, ext: pair.after.ext },
    });
    added += 1;
  }
  const saved = persistPhotoGroupRecord(master);
  return {
    ok: true,
    skipped: false,
    added,
    updated,
    group: { id: saved.id, slotCount: saved.slotCount },
  };
}

function unlinkQuiet(abs) {
  try {
    if (existsSync(abs)) unlinkSync(abs);
  } catch {
    /* ignore */
  }
}

function archiveGroupBaPair(dest, pair) {
  let variants = [...(pair.variants || [])];
  if (
    pair.before?.filename &&
    pair.after?.filename &&
    existsSync(path.join(dest.dir, pair.before.filename)) &&
    existsSync(path.join(dest.dir, pair.after.filename))
  ) {
    if (
      baSourceIsDuplicate(
        dest.dir,
        {
          beforeAbs: path.join(dest.dir, pair.before.filename),
          afterAbs: path.join(dest.dir, pair.after.filename),
          beforeFilename: pair.before.filename,
          afterFilename: pair.after.filename,
        },
        { variants },
      )
    ) {
      return variants;
    }
    const stamp = Date.now().toString(36);
    const bVar = uniqueDest(dest.dir, `${path.parse(pair.before.filename).name}-var-${stamp}.jpg`);
    const aVar = uniqueDest(dest.dir, `${path.parse(pair.after.filename).name}-var-${stamp}.jpg`);
    copyFileSync(path.join(dest.dir, pair.before.filename), path.join(dest.dir, bVar));
    copyFileSync(path.join(dest.dir, pair.after.filename), path.join(dest.dir, aVar));
    variants = pushBaTrayEntry(dest.dir, variants, {
      id: `var-${stamp}`,
      beforeFilename: bVar,
      afterFilename: aVar,
      source: 'prior',
      generatedAt: new Date().toISOString(),
    });
  }
  return variants;
}

function trimGroupVariants(dir, variants) {
  return trimTrayVariants(dir, variants, ALT_CAP);
}

export async function generatePhotoGroupSlotOpenai(groupId, { matchKey, viewpoint, prompt } = {}) {
  if (!openaiImageKeySet()) {
    throw Object.assign(
      new Error('Set OPENAI_API_KEY in .env (same key as Phone), then restart Rover.'),
      { status: 400, code: 'openai-unconfigured' },
    );
  }
  const dest = getPhotoGroup(groupId);
  const existing = (dest.slots || []).find((s) => matchKeyForSlot(s) === matchKey);
  if (!existing) throw Object.assign(new Error('Unknown slot'), { status: 400 });
  const cid = candidateIdForGroup(dest);
  const built = chatgptPromptForGroupSlot(groupId, matchKey, { viewpoint, prompt });
  if (String(prompt || '').trim()) {
    persistSlotOverrideIfBody(
      openaiPromptsPathForGroupDir(dest.dir),
      matchKey,
      built.viewpoint,
      built.original,
      built.prompt,
    );
  }
  const { buffer, provider } = await generateOpenaiImage({ prompt: built.prompt });
  let variants = [...(existing.variants || [])];
  if (existing.filename && existsSync(path.join(dest.dir, existing.filename))) {
    variants = pushSlotTrayEntry(dest.dir, variants, {
      filename: existing.filename,
      source: existing.source || 'stock',
      provider: existing.provider || null,
      photoId: existing.photoId || null,
    });
  }
  const filename = uniqueDest(dest.dir, `${existing.key || 'slot'}-openai.jpg`);
  writeFileSync(path.join(dest.dir, filename), buffer);
  const incoming = {
    ...existing,
    filename,
    source: 'openai',
    provider,
    photoId: `openai:${groupId}:${Date.now()}`,
    attribution: 'GPT Image 2 (OpenAI)',
    matchGrade: 'ok',
    matchTip: 'AI-generated (GPT Image 2 (OpenAI))',
    savedAt: new Date().toISOString(),
    variants,
  };
  putSlotOnGroup(dest, matchKey, incoming);
  persistPhotoGroupRecord(dest);
  if (cid) addLastCost(cid, 'openai', OPENAI_IMAGE_COST.generate);
  else recordRoverApiSpend('openai', OPENAI_IMAGE_COST.generate);
  return { ok: true, view: getPhotoGroupView(groupId) };
}

/** Copy a still onto this group slot. Current live goes to the tray. */
export function useFileOnPhotoGroupSlot(groupId, { matchKey, fromGroupId, filename } = {}) {
  const dest = getPhotoGroup(groupId);
  const src = getPhotoGroup(String(fromGroupId || groupId).trim() || groupId);
  if (!nichesEqual(dest.niche, src.niche)) {
    throw Object.assign(new Error('Can only use photos within the same niche'), { status: 400 });
  }
  const want = path.basename(String(filename || ''));
  const key = String(matchKey || '').trim();
  if (!want || !key) {
    throw Object.assign(new Error('matchKey and filename required'), { status: 400 });
  }
  const fromAbs = path.join(src.dir, want);
  if (!existsSync(fromAbs)) {
    throw Object.assign(new Error('Image not found'), { status: 404 });
  }
  const existing = (dest.slots || []).find((s) => matchKeyForSlot(s) === key);
  if (!existing) {
    throw Object.assign(new Error('Unknown slot'), { status: 400 });
  }
  if (dest.id === src.id && existing.filename && path.basename(String(existing.filename)) === want) {
    return { ok: true, view: getPhotoGroupView(groupId) };
  }
  const trayHit = (existing.variants || []).find(
    (v) => dest.id === src.id && path.basename(String(v.filename || '')) === want,
  );
  if (trayHit?.filename) {
    return usePhotoGroupSlotVariant(groupId, { matchKey: key, filename: trayHit.filename });
  }
  const destName = uniqueDest(dest.dir, `see-${want}`);
  copyFileSync(fromAbs, path.join(dest.dir, destName));
  let variants = [...(existing.variants || [])];
  if (existing.filename && existsSync(path.join(dest.dir, existing.filename))) {
    variants = pushSlotTrayEntry(
      dest.dir,
      variants,
      {
        filename: existing.filename,
        source: existing.source || 'stock',
        provider: existing.provider || null,
        photoId: existing.photoId || null,
      },
      { liveFilename: destName, livePhotoId: existing.photoId },
    );
  }
  const incoming = {
    ...existing,
    filename: destName,
    source: 'photo-group',
    savedAt: new Date().toISOString(),
    variants,
  };
  putSlotOnGroup(dest, key, incoming);
  persistPhotoGroupRecord(dest);
  return { ok: true, view: getPhotoGroupView(groupId) };
}

/** Copy a before/after pair onto this group BA slot. Current live pair goes to the tray. */
export function useBaPairOnPhotoGroupSlot(
  groupId,
  { matchKey, fromGroupId, beforeFilename, afterFilename } = {},
) {
  const dest = getPhotoGroup(groupId);
  const src = getPhotoGroup(String(fromGroupId || groupId).trim() || groupId);
  if (!nichesEqual(dest.niche, src.niche)) {
    throw Object.assign(new Error('Can only use photos within the same niche'), { status: 400 });
  }
  const wantBefore = path.basename(String(beforeFilename || ''));
  const wantAfter = path.basename(String(afterFilename || ''));
  const key = String(matchKey || '').trim();
  if (!wantBefore || !wantAfter || !key) {
    throw Object.assign(new Error('matchKey, beforeFilename, and afterFilename required'), {
      status: 400,
    });
  }
  const fromBefore = path.join(src.dir, wantBefore);
  const fromAfter = path.join(src.dir, wantAfter);
  if (!existsSync(fromBefore) || !existsSync(fromAfter)) {
    throw Object.assign(new Error('Pair not found'), { status: 404 });
  }
  const found = findGroupBaPair(dest, key);
  const pair = found.pair;
  const liveBefore = path.basename(String(pair.before?.filename || ''));
  const liveAfter = path.basename(String(pair.after?.filename || ''));
  if (dest.id === src.id && liveBefore === wantBefore && liveAfter === wantAfter) {
    return { ok: true, view: getPhotoGroupView(groupId) };
  }
  const trayHit = (pair.variants || []).find(
    (v) =>
      dest.id === src.id &&
      path.basename(String(v.beforeFilename || '')) === wantBefore &&
      path.basename(String(v.afterFilename || '')) === wantAfter,
  );
  if (trayHit?.beforeFilename) {
    return usePhotoGroupBaVariant(groupId, {
      matchKey: key,
      pairId: trayHit.id,
      beforeFilename: trayHit.beforeFilename,
    });
  }
  const ctx = groupBaPairContext(groupId, { matchKey: key });
  return persistGeneratedGroupBaPair(groupId, ctx, {
    beforeBuffer: readFileSync(fromBefore),
    afterBuffer: readFileSync(fromAfter),
    beforePrompt: ctx.pair.lastPrompts?.before || '',
    afterPrompt: ctx.pair.lastPrompts?.after || '',
    source: 'photo-group',
  });
}

export function usePhotoGroupSlotVariant(groupId, { matchKey, filename } = {}) {
  const dest = getPhotoGroup(groupId);
  const existing = (dest.slots || []).find((s) => matchKeyForSlot(s) === matchKey);
  if (!existing) throw Object.assign(new Error('Unknown slot'), { status: 400 });
  const want = path.basename(String(filename || ''));
  const variants = [...(existing.variants || [])];
  let idx = variants.findIndex((v) => path.basename(String(v.filename || '')) === want);
  if (idx < 0) {
    for (const slot of dest.slots || []) {
      if (matchKeyForSlot(slot) === matchKey) continue;
      const list = [...(slot.variants || [])];
      const i = list.findIndex((v) => path.basename(String(v.filename || '')) === want);
      if (i < 0) continue;
      variants.push(list[i]);
      idx = variants.length - 1;
      list.splice(i, 1);
      slot.variants = list;
      break;
    }
  }
  if (idx < 0) throw Object.assign(new Error('Variant not found'), { status: 404 });
  const picked = variants[idx];
  if (!existsSync(path.join(dest.dir, picked.filename))) {
    throw Object.assign(new Error('Variant file missing'), { status: 404 });
  }
  variants.splice(idx, 1);
  let nextVariants = variants;
  if (existing.filename) {
    nextVariants = pushSlotTrayEntry(dest.dir, variants, {
      filename: existing.filename,
      source: existing.source || null,
      provider: existing.provider || null,
      photoId: existing.photoId || null,
    }, { liveFilename: picked.filename, livePhotoId: picked.photoId || existing.photoId });
  }
  const incoming = {
    ...existing,
    filename: picked.filename,
    source: picked.source || existing.source,
    provider: picked.provider || existing.provider,
    variants: nextVariants,
    savedAt: new Date().toISOString(),
  };
  putSlotOnGroup(dest, matchKey, incoming);
  persistPhotoGroupRecord(dest);
  return { ok: true, view: getPhotoGroupView(groupId) };
}

function findGroupBaPair(dest, matchKey) {
  const key = String(matchKey || '');
  dest.beforeAfter = dest.beforeAfter || { home: [], services: [] };
  if (key.startsWith('ba:home:')) {
    const idx = Number(key.split(':')[2]) || 1;
    let pair = (dest.beforeAfter.home || []).find((p) => (p.pairIndex || 1) === idx);
    if (!pair) {
      pair = { pairIndex: idx, before: null, after: null, variants: [] };
      dest.beforeAfter.home.push(pair);
    }
    return { kind: 'home', pair, pairIndex: idx };
  }
  if (key.startsWith('ba:svc:')) {
    let pair = (dest.beforeAfter.services || []).find((p) => {
      const mk = `ba:svc:${String(p.serviceName || p.serviceSlug || '').toLowerCase()}`;
      return mk === key;
    });
    if (!pair) {
      const name = key.slice('ba:svc:'.length);
      pair = { serviceSlug: name.replace(/[^a-z0-9]+/g, '-'), serviceName: name, before: null, after: null, variants: [] };
      dest.beforeAfter.services.push(pair);
    }
    return { kind: 'service', pair };
  }
  throw Object.assign(new Error('Unknown before/after pair'), { status: 400 });
}

function groupBaPairContext(groupId, { matchKey, viewpoint, kind, pairIndex, serviceSlug, serviceName } = {}) {
  const dest = getPhotoGroup(groupId);
  const key =
    matchKey ||
    (kind === 'service'
      ? `ba:svc:${String(serviceName || serviceSlug || '').toLowerCase()}`
      : `ba:home:${Number(pairIndex) || 1}`);
  const found = findGroupBaPair(dest, key);
  const pair = found.pair;
  const cid = candidateIdForGroup(dest);
  const slug = pair.serviceSlug || serviceSlug || '';
  const idx = found.pairIndex || pair.pairIndex || Number(pairIndex) || 1;
  const vp = normalizeBaViewpoint(viewpoint);
  return { dest, key, found, pair, cid, slug, idx, vp };
}

function persistGeneratedGroupBaPair(groupId, ctx, { beforeBuffer, afterBuffer, beforePrompt, afterPrompt, source }) {
  const { dest, found, pair, cid, slug, idx, vp } = ctx;
  const variants = archiveGroupBaPair(dest, pair);
  const beforeName =
    found.kind === 'home'
      ? `gallery-ba-${found.pairIndex || 1}-before.jpg`
      : `svc-ba-${pair.serviceSlug || 'svc'}-1-before.jpg`;
  const afterName =
    found.kind === 'home'
      ? `gallery-ba-${found.pairIndex || 1}-after.jpg`
      : `svc-ba-${pair.serviceSlug || 'svc'}-1-after.jpg`;
  if (pair.before?.filename && pair.before.filename !== beforeName) {
    unlinkQuiet(path.join(dest.dir, pair.before.filename));
  }
  if (pair.after?.filename && pair.after.filename !== afterName) {
    unlinkQuiet(path.join(dest.dir, pair.after.filename));
  }
  writeFileSync(path.join(dest.dir, beforeName), beforeBuffer);
  writeFileSync(path.join(dest.dir, afterName), afterBuffer);
  pair.before = { filename: beforeName, ext: 'jpg' };
  pair.after = { filename: afterName, ext: 'jpg' };
  pair.variants = trimGroupVariants(dest.dir, variants);
  pair.lastPrompts = {
    before: beforePrompt,
    after: afterPrompt,
    viewpoint: vp,
    source,
    at: new Date().toISOString(),
  };
  persistPhotoGroupRecord(dest);
  if (cid) {
    saveLastBaPrompts(cid, {
      serviceSlug: slug,
      pairIndex: idx,
      viewpoint: vp,
      before: beforePrompt,
      after: afterPrompt,
      source,
    });
  }
  return { ok: true, view: getPhotoGroupView(groupId) };
}

export async function generatePhotoGroupBaPairOpenai(groupId, { matchKey, viewpoint, kind, pairIndex, serviceSlug, serviceName, before, after } = {}) {
  if (!openaiImageKeySet()) {
    throw Object.assign(
      new Error('Set OPENAI_API_KEY in .env (same key as Phone), then restart Rover.'),
      { status: 400, code: 'openai-unconfigured' },
    );
  }
  const ctx = groupBaPairContext(groupId, { matchKey, viewpoint, kind, pairIndex, serviceSlug, serviceName });
  const { dest, cid, slug, idx, vp, key } = ctx;
  const resolved = getPhotoGroupBaPrompts(groupId, {
    matchKey: key,
    viewpoint: vp,
    pairIndex: idx,
    serviceSlug: slug,
    before,
    after,
  });
  if (String(before || '').trim() || String(after || '').trim()) {
    persistBaOverrideIfBody(
      openaiPromptsPathForGroupDir(dest.dir),
      key,
      resolved.viewpoint,
      { before: resolved.originalBefore, after: resolved.originalAfter },
      { before: resolved.before, after: resolved.after },
    );
  }
  const beforePrompt = resolved.before;
  const afterPrompt = resolved.after;
  const beforeImg = await generateOpenaiImage({ prompt: beforePrompt });
  const afterImg = await editOpenaiImage({ prompt: afterPrompt, imageBuffer: beforeImg.buffer });
  const result = persistGeneratedGroupBaPair(groupId, ctx, {
    beforeBuffer: beforeImg.buffer,
    afterBuffer: afterImg.buffer,
    beforePrompt,
    afterPrompt,
    source: 'openai',
  });
  if (cid) addLastCost(cid, 'openai', OPENAI_IMAGE_COST.pair);
  else recordRoverApiSpend('openai', OPENAI_IMAGE_COST.pair);
  return result;
}

export function getPhotoGroupBaPrompts(
  groupId,
  { matchKey, viewpoint, pairIndex, serviceSlug, before, after } = {},
) {
  const dest = getPhotoGroup(groupId);
  const key =
    matchKey ||
    (serviceSlug
      ? `ba:svc:${String(serviceSlug).toLowerCase()}`
      : `ba:home:${Number(pairIndex) || 1}`);
  const found = findGroupBaPair(dest, key);
  const pair = found.pair;
  const cid = candidateIdForGroup(dest);
  const slug = pair.serviceSlug || serviceSlug || '';
  const idx = found.pairIndex || pair.pairIndex || Number(pairIndex) || 1;
  const vp = normalizeBaViewpoint(viewpoint);
  const config = groupSiteConfig(dest);
  const setting = slotSettingKind({
    serviceName: pair.serviceName || '',
    serviceSlug: slug,
    config,
  });
  let canonical;
  if (cid) {
    canonical = resolveBaChatgptPrompts(cid, { serviceSlug: slug, pairIndex: idx, viewpoint: vp });
  } else {
    const built = buildFluxBaPrompts({
      niche: dest.niche,
      serviceName: pair.serviceName || dest.niche,
      viewpoint: vp,
      setting,
      config,
      forChatGpt: true,
    });
    canonical = {
      key,
      viewpoint: vp,
      source: 'template',
      room: built.room,
      before: built.before,
      after: built.after,
      setting: built.setting || setting,
    };
  }
  const ov = getBaPromptOverride(groupOpenaiDoc(dest), key, vp);
  const used = pickBaPromptPair(canonical, ov, { before, after });
  return {
    ...canonical,
    key,
    viewpoint: vp,
    originalBefore: canonical.before,
    originalAfter: canonical.after,
    before: used.before,
    after: used.after,
    overridden: used.before !== canonical.before || used.after !== canonical.after,
    setting: canonical.setting || setting,
    chatgptUrl: 'https://chatgpt.com/',
  };
}

export function savePhotoGroupBaOpenaiPrompt(
  groupId,
  { matchKey, viewpoint, pairIndex, serviceSlug, before, after, restore } = {},
) {
  const dest = getPhotoGroup(groupId);
  const current = getPhotoGroupBaPrompts(groupId, {
    matchKey,
    viewpoint,
    pairIndex,
    serviceSlug,
  });
  const key = current.key || matchKey;
  const vp = current.viewpoint;
  const originalBefore = current.originalBefore;
  const originalAfter = current.originalAfter;
  let doc = groupOpenaiDoc(dest);
  const beforeText = String(before || '').trim();
  const afterText = String(after || '').trim();
  const same =
    beforeText === String(originalBefore || '').trim() &&
    afterText === String(originalAfter || '').trim();
  if (restore || same) {
    doc = clearBaPromptOverride(doc, key, vp);
  } else if (beforeText || afterText) {
    doc = setBaPromptOverride(doc, key, vp, { before: beforeText, after: afterText });
  }
  saveGroupOpenaiDoc(dest, doc);
  return getPhotoGroupBaPrompts(groupId, { matchKey: key, viewpoint: vp, pairIndex, serviceSlug });
}

export function usePhotoGroupBaVariant(groupId, { matchKey, pairId, beforeFilename = '' } = {}) {
  const dest = getPhotoGroup(groupId);
  const found = findGroupBaPair(dest, matchKey);
  const pair = found.pair;
  let variants = [...(pair.variants || [])];
  const wantId = String(pairId || '').trim();
  const wantBefore = path.basename(String(beforeFilename || ''));
  let idx = wantId ? variants.findIndex((v) => v.id === wantId) : -1;
  if (idx < 0 && wantBefore) {
    idx = variants.findIndex((v) => path.basename(String(v.beforeFilename || '')) === wantBefore);
  }
  if (idx < 0) throw Object.assign(new Error('Pair variant not found'), { status: 404 });
  const picked = variants[idx];
  if (
    !picked.beforeFilename ||
    !picked.afterFilename ||
    !existsSync(path.join(dest.dir, picked.beforeFilename)) ||
    !existsSync(path.join(dest.dir, picked.afterFilename))
  ) {
    throw Object.assign(new Error('Variant pair files missing'), { status: 404 });
  }
  const stamp = Date.now().toString(36);
  if (pair.before?.filename && pair.after?.filename) {
    if (
      baSourceIsDuplicate(
        dest.dir,
        {
          beforeAbs: path.join(dest.dir, pair.before.filename),
          afterAbs: path.join(dest.dir, pair.after.filename),
          beforeFilename: pair.before.filename,
          afterFilename: pair.after.filename,
        },
        { variants: variants.filter((_, i) => i !== idx) },
      )
    ) {
      variants.splice(idx, 1);
    } else {
      const bVar = uniqueDest(dest.dir, `${path.parse(pair.before.filename).name}-swap-${stamp}.jpg`);
      const aVar = uniqueDest(dest.dir, `${path.parse(pair.after.filename).name}-swap-${stamp}.jpg`);
      copyFileSync(path.join(dest.dir, pair.before.filename), path.join(dest.dir, bVar));
      copyFileSync(path.join(dest.dir, pair.after.filename), path.join(dest.dir, aVar));
      variants.splice(idx, 1);
      variants = pushBaTrayEntry(dest.dir, variants, {
        id: `var-${stamp}`,
        beforeFilename: bVar,
        afterFilename: aVar,
        source: 'prior',
        generatedAt: new Date().toISOString(),
      });
    }
  } else {
    variants.splice(idx, 1);
  }
  const liveBefore = pair.before?.filename || uniqueDest(dest.dir, `gallery-ba-1-before.jpg`);
  const liveAfter = pair.after?.filename || uniqueDest(dest.dir, `gallery-ba-1-after.jpg`);
  copyFileSync(path.join(dest.dir, picked.beforeFilename), path.join(dest.dir, liveBefore));
  copyFileSync(path.join(dest.dir, picked.afterFilename), path.join(dest.dir, liveAfter));
  pair.before = { filename: liveBefore, ext: path.extname(liveBefore).slice(1) || 'jpg' };
  pair.after = { filename: liveAfter, ext: path.extname(liveAfter).slice(1) || 'jpg' };
  pair.variants = compactBaTray(dest.dir, variants, {
    liveBefore,
    liveAfter,
  });
  persistPhotoGroupRecord(dest);
  return { ok: true, view: getPhotoGroupView(groupId) };
}

