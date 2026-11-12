/**
 * ChatGPT browser before/after prompts + import into gallery slots.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  renameSync,
} from 'node:fs';
import path from 'node:path';
import { pathsFor, getCandidateDetail, getCandidateShell, saveMeta } from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { syncSiteImagesToPublic } from './fill-site-images.mjs';
import { baLogoCleanPath, forgetBaLogoMatching, readBaLogoState } from './ba-logo.mjs';
import {
  IMAGE_TRAY_CAP,
  baSourceIsDuplicate,
  baEntryFilesOnDisk,
  compactBaTray,
  pushBaTrayEntry,
  trimTrayVariants,
} from './image-tray.mjs';
import { slotSettingKind, storedBaLooksResidential } from './image-setting.mjs';
import {
  loadCandidateOpenaiPrompts,
  overlayBaCardPrompts,
  getBaPromptOverride,
  pickBaPromptPair,
  saveCandidateOpenaiPrompts,
  setBaPromptOverride,
  clearBaPromptOverride,
} from './openai-prompt-overrides.mjs';
import { applyBaOccupancyPrompts, normalizeOccupancy } from './image-occupancy.mjs';
import { defaultSlotDescription } from './slot-photo-brief.mjs';

const ROOT = process.cwd();

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Live pair files only: svc-ba-{slug}-{n}-before.jpg — not -pgN- or -var- copies. */
function isLiveSvcBaFilename(name, slug) {
  const n = String(name || '');
  const s = escapeRegExp(String(slug || '').trim());
  if (!s) return false;
  return new RegExp(`^svc-ba-${s}-\\d+-(before|after)\\.\\w+$`, 'i').test(n);
}

function isLiveHomeBaFilename(name, pairIndex) {
  const idx = Math.max(1, Number(pairIndex) || 1);
  return new RegExp(`^gallery-ba-${idx}-(before|after)\\.\\w+$`, 'i').test(String(name || ''));
}

const MONTHS = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function loadConfig(candidateId) {
  const detail = getCandidateDetail(candidateId);
  return (
    loadAcceptedSiteConfig(candidateId)?.config ||
    detail.siteConfig ||
    detail.siteConfigDraft ||
    {}
  );
}

function namedServiceList(services) {
  return (services || []).map((s) => String(s || '').trim()).filter(Boolean);
}

/** Every named service is a garage trade, or the niche is when no service is named. */
export function servicesAreGarage(niche, services) {
  const list = namedServiceList(services);
  if (list.length) return list.every((s) => /\bgarage\b/i.test(s));
  return /\bgarage\b/i.test(String(niche || ''));
}

function garageRoom(outside, commercial) {
  if (outside) {
    return commercial
      ? 'commercial garage or service-bay exterior'
      : 'driveway in front of the garage door';
  }
  return commercial ? 'commercial garage or service-bay interior' : 'residential garage interior';
}

/**
 * Shared Inside/Outside camera sentence for stills and before/after.
 * A garage room is shot from inside the garage, or from the driveway, never from the house.
 */
export function cameraViewpointLine({ viewpoint, room, place, focus } = {}) {
  const outside = String(viewpoint || '').trim().toLowerCase() === 'outside';
  const roomText = String(room || '').trim();
  const garage = /\bgarage\b/i.test(roomText);
  const placeBit = place ? ` in ${place}` : '';
  const subject = String(focus || 'service').trim() || 'service';
  if (garage && !outside) {
    return `Camera viewpoint: INSIDE — photoreal shot standing inside the garage${placeBit}, looking at the ${subject}. The camera is in the garage, not in the kitchen, hallway, or another room of the house looking in.`;
  }
  if (garage && outside) {
    return `Camera viewpoint: OUTSIDE — photoreal shot on the driveway${placeBit}, looking at the garage and the ${subject}. The camera is outside the garage, not at a kitchen window.`;
  }
  if (outside) {
    return `Camera viewpoint: OUTSIDE — photoreal exterior shot of the ${roomText}${placeBit}, looking at the ${subject} feature from outdoors.`;
  }
  return `Camera viewpoint: INSIDE — photoreal interior shot of the ${roomText}${placeBit}, looking at the ${subject} feature from indoors.`;
}

export function roomHint(niche, services, viewpoint = 'inside', setting = 'residential') {
  const hay = `${niche || ''} ${(services || []).join(' ')}`.toLowerCase();
  const outside = viewpoint === 'outside';
  const commercial = setting === 'commercial';
  if (servicesAreGarage(niche, services)) return garageRoom(outside, commercial);
  if (/egress|basement.?window|window.?well|foundation.?cut/.test(hay)) {
    return outside
      ? commercial
        ? 'commercial building foundation wall with a basement window well'
        : 'home exterior foundation wall with basement window well'
      : commercial
        ? 'commercial basement interior focused on a basement window'
        : 'basement interior focused on a basement window';
  }
  if (/bath|shower|tub/.test(hay)) {
    return outside
      ? commercial
        ? 'commercial building exterior near a restroom vent'
        : 'home exterior near bathroom window/vent'
      : commercial
        ? 'commercial restroom'
        : 'bathroom';
  }
  if (/kitchen|cabin|counter/.test(hay)) {
    return outside
      ? commercial
        ? 'commercial building exterior near a kitchen or break-room window'
        : 'home exterior near kitchen window'
      : commercial
        ? 'commercial kitchen or break room'
        : 'kitchen';
  }
  if (/roof/.test(hay)) return commercial ? 'commercial building roof' : 'home exterior roof';
  if (/\bhvac\b|air[\s-]?cond|mini[\s-]?split/.test(hay)) {
    return outside
      ? commercial
        ? 'rooftop HVAC equipment on a commercial building'
        : 'home exterior HVAC equipment pad'
      : 'utility / mechanical space';
  }
  if (commercial) {
    return outside
      ? 'commercial building exterior at the service feature'
      : 'office, retail, or commercial interior';
  }
  return outside ? 'home exterior at the service feature' : 'residential interior room';
}

export function normalizeBaViewpoint(raw) {
  return String(raw || '').trim().toLowerCase() === 'outside' ? 'outside' : 'inside';
}

function slugifyService(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Deduped residential + commercial services with slug + display name. */
export function listConfiguredServiceTargets(candidateId) {
  const config = loadConfig(candidateId);
  const out = [];
  const seen = new Set();
  for (const name of [
    ...(Array.isArray(config.services) ? config.services : []),
    ...(Array.isArray(config.commercialServices) ? config.commercialServices : []),
  ]) {
    const serviceName = String(name || '').trim();
    if (!serviceName) continue;
    const slug = slugifyService(serviceName);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, serviceName });
  }
  return out;
}

export function listBaPromptSlots(candidateId) {
  const p = pathsFor(candidateId);
  let structure = null;
  if (existsSync(p.contentStructure)) {
    try {
      structure = JSON.parse(readFileSync(p.contentStructure, 'utf8'));
    } catch {
      structure = null;
    }
  }
  const sections = Array.isArray(structure?.sections) ? structure.sections : [];
  const photos = structure?.photos && typeof structure.photos === 'object' ? structure.photos : {};
  const pages = Array.isArray(structure?.pages) ? structure.pages : [];
  const homeOn = sections.includes('beforeAfter') || Boolean(photos.beforeAfter?.enabled);
  const servicesPageOn = !pages.length || pages.includes('services');
  const svcOn =
    servicesPageOn && (sections.includes('svcBeforeAfter') || Boolean(photos.svcBeforeAfter?.enabled));
  const niche = String(loadConfig(candidateId).niche || '').trim();
  const out = [];
  if (homeOn) {
    out.push({
      key: 'home:1',
      kind: 'home',
      label: 'Homepage gallery before/after',
      serviceName: null,
      slug: null,
      description: defaultSlotDescription(
        { sectionId: 'beforeAfter', kind: 'gallery', key: 'home:1' },
        { niche },
      ),
    });
  }
  if (svcOn) {
    for (const t of listConfiguredServiceTargets(candidateId)) {
      out.push({
        key: `svc:${t.slug}`,
        kind: 'service',
        label: `Service page before/after — ${t.serviceName}`,
        serviceName: t.serviceName,
        slug: t.slug,
        description: defaultSlotDescription(
          {
            sectionId: 'svcBeforeAfter',
            kind: 'gallery',
            key: `svc:${t.slug}`,
            serviceName: t.serviceName,
          },
          { niche },
        ),
      });
    }
  }
  return out;
}

function fallbackBaScene({
  serviceSlug = '',
  serviceName = '',
  pairIndex = 1,
  viewpoint = 'inside',
  setting = 'residential',
} = {}) {
  const slug = String(serviceSlug || '').toLowerCase();
  const name = String(serviceName || '').toLowerCase();
  const hay = `${slug} ${name}`;
  const outside = viewpoint === 'outside';
  const commercial = setting === 'commercial';
  if (/\bgarage\b/.test(hay)) {
    const label = String(serviceName || '').trim() || 'garage storage';
    return {
      room: garageRoom(outside, commercial),
      defect: `an incomplete ${label} run inside the garage`,
      result: `the finished ${label} result inside the garage`,
    };
  }
  if (/egress|window.?well|basement.?window/.test(hay)) {
    return {
      room: outside
        ? commercial
          ? 'commercial building foundation wall with window well'
          : 'home exterior foundation wall with window well'
        : commercial
          ? 'commercial basement interior at a basement window'
          : 'basement interior at a basement window',
      defect: 'undersized or unfinished basement window and well',
      result: 'finished code-sized egress window and well',
    };
  }
  if (/texture/.test(hay)) {
    return {
      room: outside
        ? commercial
          ? 'commercial stucco or masonry wall'
          : 'home exterior stucco wall'
        : commercial
          ? 'office corridor with orange-peel drywall'
          : 'dining room with orange-peel drywall',
      defect: 'a mismatched drywall texture patch that does not blend',
      result: 'even knockdown or orange-peel texture matching the surrounding wall',
    };
  }
  if (/patch/.test(hay)) {
    return {
      room: outside
        ? commercial
          ? 'commercial building exterior near a patched wall'
          : 'home exterior siding near a patched wall'
        : commercial
          ? 'retail back-of-house with a ceiling drywall patch'
          : 'bedroom with a ceiling drywall patch',
      defect: 'an unfinished drywall patch with visible tape and mud',
      result: 'a smooth blended patch ready for paint',
    };
  }
  if (/repair/.test(hay)) {
    return {
      room: outside
        ? commercial
          ? 'commercial building exterior near a damaged wall corner'
          : 'home exterior near a damaged wall corner'
        : commercial
          ? 'office hallway with a jagged hole in drywall'
          : 'hallway with a jagged hole in drywall',
      defect: 'a punched or water-damaged hole in the drywall',
      result: 'a repaired, taped, and sanded drywall surface',
    };
  }
  if (!slug) {
    return {
      room: outside
        ? commercial
          ? 'commercial building exterior at the storefront window wall'
          : 'home exterior at the main living-room window wall'
        : commercial
          ? 'office lobby with an unfinished drywall seam'
          : 'living room with an unfinished drywall seam',
      defect:
        Number(pairIndex) > 1
          ? 'an unmudded drywall joint on a long wall'
          : 'an unfinished drywall seam on a featured wall',
      result: 'smooth finished drywall ready for paint',
    };
  }
  return {
    room: outside
      ? commercial
        ? 'commercial building exterior at the service feature'
        : 'home exterior at the service feature'
      : commercial
        ? 'a distinct office or retail interior for this service'
        : 'a distinct residential room for this service',
    defect: `an incomplete ${serviceName || 'service'} element`,
    result: `the finished ${serviceName || 'service'} result`,
  };
}

const BA_BEFORE_LEAD =
  'DOCUMENTARY CONTRACTOR PHOTO, not CGI, not a real-estate listing, not a catalog product shot. Phone or job-site camera, straight-on or slight angle, available indoor light — no golden-hour glow, no cinematic bokeh, no blown-out windows. Ordinary lived-in American house; furniture may be present but not showroom-staged; no gibberish book spines, no fake laptop slabs. If the defect is a hole in gypsum drywall: thin paper-faced board, irregular torn paper facing, visible wood studs and a real wall cavity (not a circular crater, not thick masonry or clay, not concrete rubble). Damage is modest (doorknob or fist scale), with light scattered dust — not a neat rubble pile and not centered hero-damage. No people, no faces, no hands, no crew. No text, logos, or watermarks.';

const BA_AFTER_LEAD =
  'EDIT THIS EXACT PHOTO. Same crop, camera height, lens, white balance, furniture, floor, doors, and window exposure. Do not relight. Do not recompose. Do not change anything except the service defect. Replace that defect with a finished, believable repair of the SAME surface (joint compound, sand, paint match for drywall; equivalent finished result for other trades) — not a white blob, not a new wall, not a remodel. No people. No text, logos, or watermarks.';

export function baDocumentaryLeadIn({ stage } = {}) {
  return stage === 'after' ? BA_AFTER_LEAD : BA_BEFORE_LEAD;
}

function readImagesPlanDoc(candidateId) {
  const file = pathsFor(candidateId).imagesPlan;
  if (!existsSync(file)) return null;
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    return doc && typeof doc === 'object' ? doc : null;
  } catch {
    return null;
  }
}

function lookupBaPlanPrompts(candidateId, { serviceSlug = '', pairIndex = 1, viewpoint } = {}) {
  const vp = normalizeBaViewpoint(viewpoint);
  const slug = serviceSlug ? slugifyService(serviceSlug) : '';
  const key = slug ? `svc:${slug}` : `home:${Math.max(1, Number(pairIndex) || 1)}`;
  const config = loadConfig(candidateId);
  const setting = slotSettingKind({
    serviceName: slug
      ? listConfiguredServiceTargets(candidateId).find((t) => t.slug === slug)?.serviceName || slug
      : '',
    serviceSlug: slug,
    config,
  });
  const plan = readImagesPlanDoc(candidateId);
  const entry = plan?.beforeAfter && typeof plan.beforeAfter === 'object' ? plan.beforeAfter[key] : null;
  const side = entry?.[vp] || null;
  const claudeBefore = String(side?.before || '').trim();
  const claudeAfter = String(side?.after || '').trim();
  const staleHome =
    setting === 'commercial' &&
    storedBaLooksResidential(`${claudeBefore} ${claudeAfter}`, entry?.room);
  if (claudeBefore && claudeAfter && !staleHome) {
    return {
      key,
      viewpoint: vp,
      source: 'claude',
      room: String(entry?.room || '').trim() || null,
      before: claudeBefore,
      after: claudeAfter,
      afterRaw: claudeAfter,
      setting,
    };
  }
  const built = buildBeforeAfterPrompts(candidateId, { serviceSlug: slug, viewpoint: vp });
  return {
    key,
    viewpoint: vp,
    source: 'template',
    room: built.room,
    before: built.before,
    after: built.after,
    afterRaw: built.after,
    setting,
  };
}

/**
 * Unwrapped Claude Image-queries (or ChatGPT template). Same text ChatGPT-in-the-browser used.
 */
export function resolveBaChatgptPrompts(candidateId, opts = {}) {
  return lookupBaPlanPrompts(candidateId, opts);
}

export function baPromptsForCard(candidateId, { serviceSlug = '', pairIndex = 1 } = {}) {
  const sides = {};
  for (const viewpoint of ['inside', 'outside']) {
    const r = resolveBaChatgptPrompts(candidateId, { serviceSlug, pairIndex, viewpoint });
    sides[viewpoint] = {
      before: r.before,
      after: r.after,
      originalBefore: r.before,
      originalAfter: r.after,
      source: r.source,
      room: r.room,
      setting: r.setting || null,
    };
  }
  return sides;
}

function baOccupancyContext(candidateId, { serviceSlug = '', setting } = {}) {
  const config = loadConfig(candidateId);
  const slug = serviceSlug ? slugifyService(serviceSlug) : '';
  const target = slug
    ? listConfiguredServiceTargets(candidateId).find((t) => t.slug === slug)
    : null;
  return {
    niche: String(config.niche || '').trim(),
    serviceName: target?.serviceName || '',
    setting: setting || '',
  };
}

export function resolveBaPromptsWithOverride(candidateId, opts = {}) {
  const occupancy = normalizeOccupancy(opts.occupancy);
  const resolved = resolveBaChatgptPrompts(candidateId, opts);
  const occCtx = baOccupancyContext(candidateId, {
    serviceSlug: opts.serviceSlug,
    setting: resolved.setting,
  });
  const ov = getBaPromptOverride(
    loadCandidateOpenaiPrompts(candidateId),
    resolved.key,
    resolved.viewpoint,
  );
  const used = pickBaPromptPair(resolved, ov, {
    before: opts.before,
    after: opts.after,
  });
  const fromBodyBefore = Boolean(String(opts.before || '').trim());
  const fromBodyAfter = Boolean(String(opts.after || '').trim());
  const sided = applyBaOccupancyPrompts(used.before, used.after, occupancy, occCtx);
  const before = fromBodyBefore ? used.before : sided.before;
  const after = fromBodyAfter ? used.after : sided.after;
  const canon = applyBaOccupancyPrompts(resolved.before, resolved.after, occupancy, occCtx);
  const canonBefore = canon.before;
  const canonAfter = canon.after;
  return {
    ...resolved,
    niche: occCtx.niche,
    serviceName: occCtx.serviceName || resolved.serviceName || '',
    occupancy,
    originalBefore: resolved.before,
    originalAfter: resolved.after,
    before,
    after,
    overridden: before !== canonBefore || after !== canonAfter,
    chatgptUrl: 'https://chatgpt.com/',
  };
}

export function saveBaOpenaiPrompt(
  candidateId,
  { serviceSlug = '', pairIndex = 1, viewpoint, occupancy, before, after, restore } = {},
) {
  const occ = normalizeOccupancy(occupancy);
  const resolved = resolveBaChatgptPrompts(candidateId, { serviceSlug, pairIndex, viewpoint });
  const occCtx = baOccupancyContext(candidateId, { serviceSlug, setting: resolved.setting });
  let doc = loadCandidateOpenaiPrompts(candidateId);
  const beforeText = String(before || '').trim();
  const afterText = String(after || '').trim();
  const canon = applyBaOccupancyPrompts(resolved.before, resolved.after, occ, occCtx);
  const canonBefore = canon.before;
  const canonAfter = canon.after;
  const same = beforeText === canonBefore && afterText === canonAfter;
  if (restore || same) {
    doc = clearBaPromptOverride(doc, resolved.key, resolved.viewpoint);
  } else if (beforeText || afterText) {
    doc = setBaPromptOverride(doc, resolved.key, resolved.viewpoint, {
      before: beforeText,
      after: afterText,
    });
  }
  saveCandidateOpenaiPrompts(candidateId, doc);
  return resolveBaPromptsWithOverride(candidateId, {
    serviceSlug,
    pairIndex,
    viewpoint: resolved.viewpoint,
    occupancy: occ,
  });
}

export function imagesPlanMeetsBaRequirements(candidateId, plan = null) {
  const needed = listBaPromptSlots(candidateId);
  if (!needed.length) return true;
  const doc = plan || readImagesPlanDoc(candidateId);
  const ba = doc?.beforeAfter && typeof doc.beforeAfter === 'object' ? doc.beforeAfter : {};
  return needed.every((slot) => {
    const e = ba[slot.key];
    return Boolean(
      String(e?.inside?.before || '').trim() &&
        String(e?.inside?.after || '').trim() &&
        String(e?.outside?.before || '').trim() &&
        String(e?.outside?.after || '').trim(),
    );
  });
}

export function saveLastBaPrompts(
  candidateId,
  { serviceSlug = '', pairIndex = 1, viewpoint, before, after, source } = {},
) {
  const key = baVariantKey({ serviceSlug, pairIndex });
  const doc = loadBaVariantsDoc(candidateId);
  doc._lastSent = { ...(doc._lastSent && typeof doc._lastSent === 'object' ? doc._lastSent : {}) };
  doc._lastSent[key] = {
    before: String(before || ''),
    after: String(after || ''),
    viewpoint: normalizeBaViewpoint(viewpoint),
    source: source || 'claude',
    at: new Date().toISOString(),
  };
  saveBaVariantsDoc(candidateId, doc);
}

function resolveServiceTarget(candidateId, serviceSlug) {
  const slug = slugifyService(serviceSlug);
  if (!slug) {
    throw Object.assign(new Error('serviceSlug required'), { status: 400 });
  }
  const hit = listConfiguredServiceTargets(candidateId).find((s) => s.slug === slug);
  if (!hit) {
    throw Object.assign(new Error(`Unknown service slug: ${slug}`), { status: 400 });
  }
  return hit;
}

/**
 * Build paste-ready ChatGPT image prompts for a candidate.
 * Pass `{ serviceSlug, viewpoint: 'inside'|'outside' }` (default inside).
 */
export function buildBeforeAfterPrompts(candidateId, opts = {}) {
  const config = loadConfig(candidateId);
  const niche = String(config.niche || 'home service').trim();
  const city = String(config.primaryCity || 'the local area').trim();
  const state = String(config.state || '').trim();
  const place = state ? `${city}, ${state}` : city;
  const serviceSlug = opts.serviceSlug ? slugifyService(opts.serviceSlug) : '';
  const serviceTarget = serviceSlug ? resolveServiceTarget(candidateId, serviceSlug) : null;
  const focusName = serviceTarget?.serviceName || niche;
  const services = serviceTarget
    ? [serviceTarget.serviceName]
    : Array.isArray(config.services)
      ? config.services.slice(0, 3)
      : [];
  const viewpoint = normalizeBaViewpoint(opts.viewpoint);
  const setting = slotSettingKind({
    serviceName: serviceTarget?.serviceName || '',
    serviceSlug: serviceTarget?.slug || serviceSlug,
    config,
  });
  const scene = fallbackBaScene({
    serviceSlug: serviceTarget?.slug || '',
    serviceName: focusName,
    pairIndex: Number(opts.pairIndex) || 1,
    viewpoint,
    setting,
  });
  const room = scene.room || roomHint(niche, services, viewpoint, setting);
  const serviceLine = serviceTarget
    ? `Focus specifically on ${serviceTarget.serviceName} (not other services).`
    : services.length
      ? `Focus on ${services.slice(0, 2).join(' and ')}.`
      : `Focus on typical ${niche.toLowerCase()} work.`;

  const cameraLine = cameraViewpointLine({
    viewpoint,
    room,
    place,
    focus: focusName,
  });

  const surgicalRules = [
    `SINGLE SUBJECT: only the ${focusName} change is the story.`,
    setting === 'commercial'
      ? 'Do NOT remodel the whole room/building. Do NOT change flooring, wall paint, ceiling, furniture, clutter layout, or unrelated finishes between before and after.'
      : 'Do NOT remodel the whole room/house. Do NOT change flooring, wall paint, ceiling, furniture, clutter layout, or unrelated finishes between before and after.',
    setting === 'commercial'
      ? 'Do NOT stage a demolished space. The interior may look tidy and ordinary for an office, retail, or commercial building — the problem is specifically the service element.'
      : 'Do NOT stage a trashy or demolished room. The space may look tidy, lived-in, or even attractive — the problem is specifically the service element.',
  ].join(' ');

  const before = [
    `Create a single documentary BEFORE photo for a local ${niche} business website.`,
    cameraLine,
    serviceLine,
    `Show a clear need for ${focusName} only (${scene.defect}) while the rest of the scene stays ordinary and believable.`,
    'If the defect is broken gypsum drywall, show thin paper-faced board, an irregular tear (not a circular crater), and a real wall cavity with wood studs — not masonry, clay, or a neat rubble pile.',
    surgicalRules,
    setting === 'commercial'
      ? 'Straight-on documentary photo, available indoor light — not golden hour, not cinematic bokeh, not a blown-out window. No people, no faces, no hands, no crew, no customers, no silhouettes. Ordinary occupied commercial interior, not a catalog set. No text, no logos, no watermarks, no UI.'
      : 'Straight-on documentary photo, available indoor light — not golden hour, not cinematic bokeh, not a blown-out window. No people, no faces, no hands, no crew, no customers, no silhouettes. Lived-in ordinary house, not a catalog set. No text, no logos, no watermarks, no UI.',
    setting === 'commercial'
      ? 'Aspect ratio 4:3. Realistic commercial architecture — not a showroom, not CGI-looking.'
      : 'Aspect ratio 4:3. Realistic residential architecture — not a showroom, not CGI-looking.',
  ].join(' ');

  const after = [
    cameraLine,
    serviceLine,
    `Change ONLY the ${focusName} result (${scene.result}). Everything else — walls, floor, ceiling, trim elsewhere, furniture, lighting mood of the room — must stay the same.`,
    surgicalRules,
    'Forbidden: white blob where the defect was, a new wall, full remodel, new carpet/paint package, furniture restyle, or decluttering makeover.',
    'Photoreal, available indoor light. No people, no faces, no hands, no crew, no customers. No text, no logos, no watermarks.',
    'Aspect ratio 4:3. Looks like a real completed job photo for a contractor website.',
  ].join(' ');

  const pair = [
    'I need a matched BEFORE and AFTER pair for a contractor website (two separate images).',
    `Niche: ${niche}. Service focus: ${focusName}. Location vibe: ${place}. Setting: ${room}. Viewpoint: ${viewpoint}.`,
    serviceLine,
    cameraLine,
    `1) BEFORE: problem is only the ${focusName} element; room may be tidy or finished.`,
    `2) AFTER: same camera and room; only the ${focusName} work changes — no full remodel.`,
    surgicalRules,
    'Photoreal, 4:3. No people, no faces, no hands, no crew. No text/logos/watermarks. Generate the BEFORE first, then the AFTER matching that angle.',
  ].join(' ');

  return {
    niche,
    city,
    state,
    room,
    viewpoint,
    setting,
    serviceSlug: serviceTarget?.slug || null,
    serviceName: serviceTarget?.serviceName || null,
    before,
    after,
    pair,
    chatgptUrl: 'https://chatgpt.com/',
  };
}

/** Parse ChatGPT download names like "ChatGPT Image Aug 11, 2026, 08_03_22 PM.png". */
export function scoreOriginalFileTime(name, lastModified = 0) {
  const raw = String(name || '');
  const m = raw.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4}),?\s+(\d{1,2})[_:](\d{2})[_:](\d{2})\s*(AM|PM)\b/i,
  );
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    let hour = Number(m[4]);
    const min = Number(m[5]);
    const sec = Number(m[6]);
    const ap = m[7].toUpperCase();
    if (ap === 'PM' && hour < 12) hour += 12;
    if (ap === 'AM' && hour === 12) hour = 0;
    const t = Date.UTC(Number(m[3]), month, Number(m[2]), hour, min, sec);
    if (!Number.isNaN(t)) return t;
  }
  const n = Number(lastModified);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function nextPairIndex(siteImagesDir) {
  let max = 0;
  if (!existsSync(siteImagesDir)) return 1;
  for (const name of readdirSync(siteImagesDir)) {
    const m = name.match(/^gallery-ba-(\d+)-(before|after)\./i);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return max + 1;
}

function decodeDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) {
    throw Object.assign(new Error('Expected data URL (data:image/...;base64,...)'), {
      status: 400,
    });
  }
  const mime = m[1].toLowerCase();
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  return { buffer: Buffer.from(m[2], 'base64'), ext, mime };
}

function patchGalleryOnMarkdown(md, entries) {
  if (!entries.length) {
    const galleryRe = /^gallery:\s*\n(?:(?:[ \t]+.*|-(?!-).*)\n)*/m;
    if (galleryRe.test(md)) return md.replace(galleryRe, '');
    return md;
  }
  const lines = entries.map(
    (e) =>
      `  - src: ${JSON.stringify(e.src)}\n    alt: ${JSON.stringify(e.alt)}`,
  );
  const block = `gallery:\n${lines.join('\n')}`;
  const galleryRe = /^gallery:\s*\n(?:(?:[ \t]+.*|-(?!-).*)\n)*/m;
  if (galleryRe.test(md)) return md.replace(galleryRe, `${block}\n`);
  return md.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (full, fm) => {
    if (/^gallery:/m.test(fm)) return full;
    return `---\n${fm.trimEnd()}\n${block}\n---`;
  });
}

function readExistingGallery(md) {
  const m = String(md || '').match(/^gallery:\s*\n((?:(?:[ \t]+.*|-(?!-).*)\n)*)/m);
  if (!m) return [];
  const entries = [];
  const chunks = m[1].split(/^[ \t]*-(?!-)[ \t]*/m).filter(Boolean);
  for (const chunk of chunks) {
    const src = chunk.match(/src:\s*["']?([^"'\n]+)["']?/);
    const alt = chunk.match(/alt:\s*["']([^"']*)["']/) || chunk.match(/alt:\s*(.+)/);
    if (src?.[1]) {
      entries.push({
        src: src[1].trim(),
        alt: (alt?.[1] || '').trim() || 'Project photo',
        filename: path.basename(src[1].trim()),
      });
    }
  }
  return entries;
}

function isGalleryBaEntry(e) {
  return /gallery-ba-\d+-(before|after)\./i.test(e.filename || e.src || '');
}

function isStockBeforeAfterFile(name) {
  return /^(beforeAfter|svcBeforeAfter)-/i.test(name);
}

/** Keep only gallery-ba-* entries; sort each pair before then after. */
function galleryBaOnlyEntries(entries) {
  const ba = (entries || []).filter(isGalleryBaEntry);
  const byPair = new Map();
  for (const e of ba) {
    const m = (e.filename || e.src || '').match(/gallery-ba-(\d+)-(before|after)\./i);
    if (!m) continue;
    const idx = Number(m[1]);
    const role = m[2].toLowerCase();
    if (!byPair.has(idx)) byPair.set(idx, {});
    byPair.get(idx)[role] = e;
  }
  const out = [];
  for (const idx of [...byPair.keys()].sort((a, b) => a - b)) {
    const pair = byPair.get(idx);
    if (pair.before) out.push(pair.before);
    if (pair.after) out.push(pair.after);
  }
  return out;
}

function deleteStockBeforeAfterFiles(dirs) {
  let deleted = 0;
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!isStockBeforeAfterFile(name)) continue;
      try {
        unlinkSync(path.join(dir, name));
        deleted += 1;
      } catch {
        // ignore
      }
    }
  }
  return deleted;
}

/**
 * If gallery-ba-N before/after alts encode ChatGPT times inverted vs role, swap file bytes.
 */
function healInvertedGalleryBaPairs(siteImagesDir, entries) {
  const byPair = new Map();
  for (const e of entries) {
    const m = (e.filename || '').match(/^(gallery-ba-(\d+))-(before|after)\.(\w+)$/i);
    if (!m) continue;
    const idx = Number(m[2]);
    if (!byPair.has(idx)) byPair.set(idx, {});
    byPair.get(idx)[m[3].toLowerCase()] = e;
  }
  let swapped = 0;
  for (const [, pair] of byPair) {
    if (!pair.before || !pair.after) continue;
    const beforeScore = scoreOriginalFileTime(pair.before.alt, 0);
    const afterScore = scoreOriginalFileTime(pair.after.alt, 0);
    if (!beforeScore || !afterScore || beforeScore <= afterScore) continue;
    const beforePath = path.join(siteImagesDir, pair.before.filename);
    const afterPath = path.join(siteImagesDir, pair.after.filename);
    if (!existsSync(beforePath) || !existsSync(afterPath)) continue;
    const tmp = `${beforePath}.swap-tmp`;
    renameSync(beforePath, tmp);
    renameSync(afterPath, beforePath);
    renameSync(tmp, afterPath);
    const altBefore = pair.before.alt;
    pair.before.alt = pair.after.alt.replace(/^After\b/i, 'Before');
    pair.after.alt = altBefore.replace(/^Before\b/i, 'After');
    swapped += 1;
  }
  return swapped;
}

function writeGalleryBaOnly(md, baEntries) {
  return patchGalleryOnMarkdown(md, galleryBaOnlyEntries(baEntries));
}

function patchBeforeAfterImagesOnMarkdown(md, entries) {
  if (!entries.length) {
    const re = /^beforeAfterImages:\s*\n(?:(?:[ \t]+.*|-(?!-).*)\n)*/m;
    if (re.test(md)) return md.replace(re, '');
    return md;
  }
  const lines = entries.map(
    (e) =>
      `  - src: ${JSON.stringify(e.src)}\n    alt: ${JSON.stringify(e.alt)}`,
  );
  const block = `beforeAfterImages:\n${lines.join('\n')}`;
  const re = /^beforeAfterImages:\s*\n(?:(?:[ \t]+.*|-(?!-).*)\n)*/m;
  if (re.test(md)) return md.replace(re, `${block}\n`);
  return md.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (full, fm) => {
    if (/^beforeAfterImages:/m.test(fm)) return full;
    return `---\n${fm.trimEnd()}\n${block}\n---`;
  });
}

function readExistingBeforeAfterImages(md) {
  const m = String(md || '').match(
    /^beforeAfterImages:\s*\n((?:(?:[ \t]+.*|-(?!-).*)\n)*)/m,
  );
  if (!m) return [];
  const entries = [];
  const chunks = m[1].split(/^[ \t]*-(?!-)[ \t]*/m).filter(Boolean);
  for (const chunk of chunks) {
    const src = chunk.match(/src:\s*["']?([^"'\n]+)["']?/);
    const alt = chunk.match(/alt:\s*["']([^"']*)["']/) || chunk.match(/alt:\s*(.+)/);
    if (src?.[1]) {
      entries.push({
        src: src[1].trim(),
        alt: (alt?.[1] || '').trim() || 'Project photo',
        filename: path.basename(src[1].trim()),
      });
    }
  }
  return entries;
}

function isSvcBaEntry(e, slug) {
  const re = new RegExp(`^svc-ba-${slug}-\\d+-(before|after)\\.`, 'i');
  return re.test(e.filename || path.basename(e.src || ''));
}

function svcBaPairFromDisk(siteImagesDir, slug, niche, serviceName) {
  if (!existsSync(siteImagesDir)) return [];
  const byRole = {};
  for (const name of readdirSync(siteImagesDir)) {
    if (!isLiveSvcBaFilename(name, slug)) continue;
    const role = /-before\./i.test(name) ? 'before' : /-after\./i.test(name) ? 'after' : '';
    if (!role) continue;
    byRole[role] = {
      filename: name,
      src: `/images/${name}`,
      alt: `${role === 'before' ? 'Before' : 'After'} — ${serviceName || niche}`,
    };
  }
  const out = [];
  if (byRole.before) out.push(byRole.before);
  if (byRole.after) out.push(byRole.after);
  return out;
}

function findServiceFileKey(files, slug) {
  return Object.keys(files || {}).find((k) => {
    const norm = k.replace(/\\/g, '/');
    return new RegExp(`content/services/${slug}\\.md$`, 'i').test(norm);
  });
}

function deleteSvcBaFilesForSlug(dirs, slug) {
  let deleted = 0;
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!isLiveSvcBaFilename(name, slug)) continue;
      try {
        unlinkSync(path.join(dir, name));
        deleted += 1;
      } catch {
        // ignore
      }
    }
  }
  return deleted;
}

/** Collect gallery-ba-* entries from site-images, preserving alts from existing FM when present. */
function collectGalleryBaFromDisk(candidateId) {
  const p = pathsFor(candidateId);
  if (!existsSync(p.siteImages)) return [];

  const config = loadConfig(candidateId);
  const niche = String(config.niche || 'remodel').trim();

  const priorByName = new Map();
  for (const key of ['content', 'contentDraft']) {
    const file = p[key];
    if (!existsSync(file)) continue;
    try {
      const doc = JSON.parse(readFileSync(file, 'utf8'));
      const indexKey = Object.keys(doc.files || {}).find((k) => /pages\/index\.md$/i.test(k));
      if (!indexKey) continue;
      for (const e of readExistingGallery(doc.files[indexKey]).filter(isGalleryBaEntry)) {
        if (e.filename) priorByName.set(e.filename, e.alt);
      }
    } catch {
      // ignore
    }
  }
  const liveIndex = path.join(ROOT, 'src', 'content', 'pages', 'index.md');
  if (existsSync(liveIndex)) {
    try {
      for (const e of readExistingGallery(readFileSync(liveIndex, 'utf8')).filter(isGalleryBaEntry)) {
        if (e.filename && !priorByName.has(e.filename)) priorByName.set(e.filename, e.alt);
      }
    } catch {
      // ignore
    }
  }

  const allBa = [];
  for (const name of readdirSync(p.siteImages)) {
    const m = name.match(/^gallery-ba-(\d+)-(before|after)\.(\w+)$/i);
    if (!m) continue;
    const role = m[2].toLowerCase();
    allBa.push({
      filename: name,
      src: `/images/${name}`,
      alt: priorByName.get(name) || `${role === 'before' ? 'Before' : 'After'} — ${niche}`,
    });
  }
  return galleryBaOnlyEntries(allBa);
}

/**
 * Restore homepage gallery: and service beforeAfterImages from site-images.
 */
export function rehydrateGalleryBaFrontmatter(candidateId, { files } = {}) {
  const p = pathsFor(candidateId);
  const homeEntries = collectGalleryBaFromDisk(candidateId);
  let patched = 0;
  const services = [];

  if (homeEntries.length) {
    if (files && typeof files === 'object') {
      const indexKey = Object.keys(files).find((k) => /pages\/index\.md$/i.test(k));
      if (indexKey && typeof files[indexKey] === 'string') {
        const next = writeGalleryBaOnly(files[indexKey], homeEntries);
        files[indexKey] = next.endsWith('\n') ? next : `${next}\n`;
        patched += 1;
      }
    }
    for (const key of ['content', 'contentDraft']) {
      const file = p[key];
      if (!existsSync(file)) continue;
      try {
        const doc = JSON.parse(readFileSync(file, 'utf8'));
        if (!doc?.files) continue;
        const indexKey = Object.keys(doc.files).find((k) => /pages\/index\.md$/i.test(k));
        if (!indexKey) continue;
        const next = writeGalleryBaOnly(doc.files[indexKey], homeEntries);
        doc.files[indexKey] = next.endsWith('\n') ? next : `${next}\n`;
        writeJson(file, doc);
        patched += 1;
      } catch {
        // ignore
      }
    }
    const liveIndex = path.join(ROOT, 'src', 'content', 'pages', 'index.md');
    if (existsSync(liveIndex)) {
      try {
        const md = readFileSync(liveIndex, 'utf8');
        const next = writeGalleryBaOnly(md, homeEntries);
        writeFileSync(liveIndex, next.endsWith('\n') ? next : `${next}\n`, 'utf8');
        patched += 1;
      } catch {
        // ignore
      }
    }
  }

  const niche = String(loadConfig(candidateId).niche || 'remodel').trim();
  for (const target of listConfiguredServiceTargets(candidateId)) {
    const entries = svcBaPairFromDisk(p.siteImages, target.slug, niche, target.serviceName);
    if (!entries.length) continue;
    services.push({ slug: target.slug, serviceName: target.serviceName, entries });
    const withAlts = entries.map((e) => ({ ...e }));
    const applyAltsFromMd = (md) => {
      for (const prior of readExistingBeforeAfterImages(md).filter((x) =>
        isSvcBaEntry(x, target.slug),
      )) {
        const hit = withAlts.find((x) => x.filename === prior.filename);
        if (hit && prior.alt) hit.alt = prior.alt;
      }
    };
    if (files && typeof files === 'object') {
      const svcKey = findServiceFileKey(files, target.slug);
      if (svcKey && typeof files[svcKey] === 'string') {
        applyAltsFromMd(files[svcKey]);
        const next = patchBeforeAfterImagesOnMarkdown(files[svcKey], withAlts);
        files[svcKey] = next.endsWith('\n') ? next : `${next}\n`;
        patched += 1;
      }
    }
    for (const key of ['content', 'contentDraft']) {
      const file = p[key];
      if (!existsSync(file)) continue;
      try {
        const doc = JSON.parse(readFileSync(file, 'utf8'));
        if (!doc?.files) continue;
        const svcKey = findServiceFileKey(doc.files, target.slug);
        if (!svcKey) continue;
        applyAltsFromMd(doc.files[svcKey]);
        const next = patchBeforeAfterImagesOnMarkdown(doc.files[svcKey], withAlts);
        doc.files[svcKey] = next.endsWith('\n') ? next : `${next}\n`;
        writeJson(file, doc);
        patched += 1;
      } catch {
        // ignore
      }
    }
    const liveSvc = path.join(ROOT, 'src', 'content', 'services', `${target.slug}.md`);
    if (existsSync(liveSvc)) {
      try {
        const md = readFileSync(liveSvc, 'utf8');
        applyAltsFromMd(md);
        const next = patchBeforeAfterImagesOnMarkdown(md, withAlts);
        writeFileSync(liveSvc, next.endsWith('\n') ? next : `${next}\n`, 'utf8');
        patched += 1;
      } catch {
        // ignore
      }
    }
  }

  return { ok: true, count: homeEntries.length, patched, entries: homeEntries, services };
}

function decodeImportPair(body) {
  const files = Array.isArray(body.files) ? body.files.filter((f) => f?.dataUrl) : [];
  if (files.length >= 2) {
    const scored = files.slice(0, 2).map((f, i) => ({
      ...f,
      score: scoreOriginalFileTime(f.name, f.lastModified),
      i,
    }));
    scored.sort((a, b) => a.score - b.score || a.i - b.i);
    return {
      beforeDecoded: decodeDataUrl(scored[0].dataUrl),
      afterDecoded: decodeDataUrl(scored[1].dataUrl),
      beforeOrigName: String(scored[0].name || ''),
      afterOrigName: String(scored[1].name || ''),
    };
  }
  if (body.beforeDataUrl && body.afterDataUrl) {
    const a = {
      dataUrl: body.beforeDataUrl,
      name: body.beforeName || body.beforeAlt || '',
      lastModified: body.beforeLastModified || 0,
    };
    const b = {
      dataUrl: body.afterDataUrl,
      name: body.afterName || body.afterAlt || '',
      lastModified: body.afterLastModified || 0,
    };
    const scored = [a, b]
      .map((f, i) => ({ ...f, score: scoreOriginalFileTime(f.name, f.lastModified), i }))
      .sort((x, y) => x.score - y.score || x.i - y.i);
    return {
      beforeDecoded: decodeDataUrl(scored[0].dataUrl),
      afterDecoded: decodeDataUrl(scored[1].dataUrl),
      beforeOrigName: String(scored[0].name || ''),
      afterOrigName: String(scored[1].name || ''),
    };
  }
  throw Object.assign(
    new Error('Provide files[2] with dataUrl (or beforeDataUrl + afterDataUrl)'),
    { status: 400 },
  );
}

function importServiceBeforeAfterPair(candidateId, body = {}) {
  const p = pathsFor(candidateId);
  const config = loadConfig(candidateId);
  const city = String(config.primaryCity || '').trim();
  const target = resolveServiceTarget(candidateId, body.serviceSlug);
  const { beforeDecoded, afterDecoded, beforeOrigName, afterOrigName } = decodeImportPair(body);
  mkdirSync(p.siteImages, { recursive: true });
  archiveLiveBaPairToTray(candidateId, { serviceSlug: target.slug, pairIndex: 1 });
  forgetBaLogoMatching(
    candidateId,
    new RegExp(`^svc-ba-${escapeRegExp(target.slug)}-\\d+-(before|after)\\.`, 'i'),
  );
  deleteSvcBaFilesForSlug(
    [
      p.siteImages,
      path.join(ROOT, 'public', 'images'),
      existsSync(p.siteStaging) ? path.join(p.siteStaging, 'public', 'images') : null,
    ],
    target.slug,
  );
  const beforeName = `svc-ba-${target.slug}-1-before.${beforeDecoded.ext}`;
  const afterName = `svc-ba-${target.slug}-1-after.${afterDecoded.ext}`;
  writeFileSync(path.join(p.siteImages, beforeName), beforeDecoded.buffer);
  writeFileSync(path.join(p.siteImages, afterName), afterDecoded.buffer);
  const label = `${target.serviceName}${city ? ` in ${city}` : ''}`;
  const newEntries = [
    {
      filename: beforeName,
      src: `/images/${beforeName}`,
      alt: `Before — ${beforeOrigName || `${label} (ChatGPT)`}`.slice(0, 160),
    },
    {
      filename: afterName,
      src: `/images/${afterName}`,
      alt: `After — ${afterOrigName || `${label} (ChatGPT)`}`.slice(0, 160),
    },
  ];
  let patched = 0;
  for (const key of ['content', 'contentDraft']) {
    const file = p[key];
    if (!existsSync(file)) continue;
    try {
      const doc = JSON.parse(readFileSync(file, 'utf8'));
      if (!doc?.files) continue;
      const svcKey = findServiceFileKey(doc.files, target.slug);
      if (!svcKey) continue;
      doc.files[svcKey] = patchBeforeAfterImagesOnMarkdown(doc.files[svcKey], newEntries);
      writeJson(file, doc);
      patched += 1;
    } catch {
      // ignore
    }
  }
  const liveSvc = path.join(ROOT, 'src', 'content', 'services', `${target.slug}.md`);
  if (existsSync(liveSvc)) {
    const md = readFileSync(liveSvc, 'utf8');
    writeFileSync(liveSvc, patchBeforeAfterImagesOnMarkdown(md, newEntries), 'utf8');
    patched += 1;
  }
  syncSiteImagesToPublic(candidateId);
  saveMeta(candidateId, { lastServiceBeforeAfterImportAt: new Date().toISOString() });
  stampBaPairMeta(candidateId, baVariantKey({ serviceSlug: target.slug }), {
    source: 'upload',
    matchGrade: null,
    matchTip: 'Operator upload',
    matchGradeManual: false,
  });
  return {
    ok: true,
    scope: 'service',
    serviceSlug: target.slug,
    serviceName: target.serviceName,
    pairIndex: 1,
    files: newEntries,
    orderedByTime: true,
    patched,
    candidate: getCandidateShell(candidateId),
  };
}

/**
 * Import a before+after pair. Pass serviceSlug for service-page pairs.
 */
export function importBeforeAfterPair(candidateId, body = {}) {
  if (body.serviceSlug) return importServiceBeforeAfterPair(candidateId, body);

  const p = pathsFor(candidateId);
  const config = loadConfig(candidateId);
  const niche = String(config.niche || 'remodel').trim();
  const city = String(config.primaryCity || '').trim();
  const { beforeDecoded, afterDecoded, beforeOrigName, afterOrigName } = decodeImportPair(body);

  mkdirSync(p.siteImages, { recursive: true });

  const deletedStock = deleteStockBeforeAfterFiles([
    p.siteImages,
    path.join(ROOT, 'public', 'images'),
    existsSync(p.siteStaging) ? path.join(p.siteStaging, 'public', 'images') : null,
  ]);

  const existingBa = [];
  if (existsSync(p.siteImages)) {
    for (const name of readdirSync(p.siteImages)) {
      if (/^gallery-ba-\d+-(before|after)\./i.test(name)) {
        existingBa.push({ filename: name, src: `/images/${name}`, alt: name });
      }
    }
  }
  for (const key of ['content', 'contentDraft']) {
    const file = p[key];
    if (!existsSync(file)) continue;
    try {
      const doc = JSON.parse(readFileSync(file, 'utf8'));
      const indexKey = Object.keys(doc.files || {}).find((k) => /pages\/index\.md$/i.test(k));
      if (!indexKey) continue;
      for (const e of readExistingGallery(doc.files[indexKey]).filter(isGalleryBaEntry)) {
        const hit = existingBa.find((x) => x.filename === e.filename);
        if (hit) hit.alt = e.alt;
      }
    } catch {
      // ignore
    }
  }
  healInvertedGalleryBaPairs(p.siteImages, existingBa);

  const requested = Number(body.pairIndex);
  const pairIndex =
    Number.isFinite(requested) && requested > 0 ? requested : nextPairIndex(p.siteImages);
  if (Number.isFinite(requested) && requested > 0) {
    archiveLiveBaPairToTray(candidateId, { pairIndex: requested });
    unlinkMatching(p.siteImages, new RegExp(`^gallery-ba-${requested}-(before|after)\\.`, 'i'));
  }
  forgetBaLogoMatching(
    candidateId,
    new RegExp(`^gallery-ba-${pairIndex}-(before|after)\\.`, 'i'),
  );
  const beforeName = `gallery-ba-${pairIndex}-before.${beforeDecoded.ext}`;
  const afterName = `gallery-ba-${pairIndex}-after.${afterDecoded.ext}`;
  writeFileSync(path.join(p.siteImages, beforeName), beforeDecoded.buffer);
  writeFileSync(path.join(p.siteImages, afterName), afterDecoded.buffer);

  const beforeAlt =
    `Before — ${beforeOrigName || `${niche}${city ? ` in ${city}` : ''} (ChatGPT)`}`.slice(0, 160);
  const afterAlt =
    `After — ${afterOrigName || `${niche}${city ? ` in ${city}` : ''} (ChatGPT)`}`.slice(0, 160);

  const newEntries = [
    { filename: beforeName, src: `/images/${beforeName}`, alt: beforeAlt },
    { filename: afterName, src: `/images/${afterName}`, alt: afterAlt },
  ];

  const allBa = [];
  for (const name of readdirSync(p.siteImages)) {
    const m = name.match(/^gallery-ba-(\d+)-(before|after)\.(\w+)$/i);
    if (!m) continue;
    const role = m[2].toLowerCase();
    const preset = newEntries.find((e) => e.filename === name);
    allBa.push({
      filename: name,
      src: `/images/${name}`,
      alt:
        preset?.alt ||
        existingBa.find((e) => e.filename === name)?.alt ||
        `${role === 'before' ? 'Before' : 'After'} — ${niche}`,
    });
  }

  let patched = 0;
  for (const key of ['content', 'contentDraft']) {
    const file = p[key];
    if (!existsSync(file)) continue;
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    if (!doc?.files) continue;
    const indexKey = Object.keys(doc.files).find((k) => /pages\/index\.md$/i.test(k));
    if (!indexKey) continue;
    const prior = readExistingGallery(doc.files[indexKey]).filter(isGalleryBaEntry);
    const merged = allBa.map((e) => {
      const old = prior.find((p0) => p0.filename === e.filename);
      const neu = newEntries.find((n) => n.filename === e.filename);
      return { ...e, alt: neu?.alt || old?.alt || e.alt };
    });
    doc.files[indexKey] = writeGalleryBaOnly(doc.files[indexKey], merged);
    writeJson(file, doc);
    patched += 1;
  }

  const liveIndex = path.join(ROOT, 'src', 'content', 'pages', 'index.md');
  if (existsSync(liveIndex)) {
    const md = readFileSync(liveIndex, 'utf8');
    const prior = readExistingGallery(md).filter(isGalleryBaEntry);
    const merged = allBa.map((e) => {
      const old = prior.find((p0) => p0.filename === e.filename);
      const neu = newEntries.find((n) => n.filename === e.filename);
      return { ...e, alt: neu?.alt || old?.alt || e.alt };
    });
    writeFileSync(liveIndex, writeGalleryBaOnly(md, merged), 'utf8');
    patched += 1;
  }

  syncSiteImagesToPublic(candidateId);
  deleteStockBeforeAfterFiles([path.join(ROOT, 'public', 'images')]);
  saveMeta(candidateId, { lastBeforeAfterImportAt: new Date().toISOString() });
  stampBaPairMeta(candidateId, baVariantKey({ pairIndex }), {
    source: 'upload',
    matchGrade: null,
    matchTip: 'Operator upload',
    matchGradeManual: false,
  });

  return {
    ok: true,
    scope: 'home',
    pairIndex,
    files: newEntries,
    orderedByTime: true,
    deletedStock,
    patched,
    candidate: getCandidateShell(candidateId),
  };
}

function unlinkMatching(dir, re) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!re.test(name)) continue;
    try {
      unlinkSync(path.join(dir, name));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Write a generated JPEG before/after pair onto canonical live filenames.
 * Callers must copy any existing live pair into the variant tray first.
 */
export function writeGeneratedBaPair(
  candidateId,
  { serviceSlug = '', pairIndex = 1, beforeBuffer, afterBuffer, sourceLabel = 'GPT Image 2 (OpenAI)' } = {},
) {
  if (!beforeBuffer?.length || !afterBuffer?.length) {
    throw Object.assign(new Error('beforeBuffer and afterBuffer required'), { status: 400 });
  }
  const p = pathsFor(candidateId);
  mkdirSync(p.siteImages, { recursive: true });
  const config = loadConfig(candidateId);
  const niche = String(config.niche || 'remodel').trim();
  const city = String(config.primaryCity || '').trim();
  const labelBit = sourceLabel || 'GPT Image 2 (OpenAI)';

  if (serviceSlug) {
    const target = resolveServiceTarget(candidateId, serviceSlug);
    forgetBaLogoMatching(
      candidateId,
      new RegExp(`^svc-ba-${escapeRegExp(target.slug)}-\\d+-(before|after)\\.`, 'i'),
    );
    unlinkMatching(
      p.siteImages,
      new RegExp(`^svc-ba-${escapeRegExp(target.slug)}-\\d+-(before|after)\\.`, 'i'),
    );
    const beforeName = `svc-ba-${target.slug}-1-before.jpg`;
    const afterName = `svc-ba-${target.slug}-1-after.jpg`;
    writeFileSync(path.join(p.siteImages, beforeName), beforeBuffer);
    writeFileSync(path.join(p.siteImages, afterName), afterBuffer);
    const label = `${target.serviceName}${city ? ` in ${city}` : ''}`;
    const newEntries = [
      {
        filename: beforeName,
        src: `/images/${beforeName}`,
        alt: `Before — ${label} (${labelBit})`.slice(0, 160),
      },
      {
        filename: afterName,
        src: `/images/${afterName}`,
        alt: `After — ${label} (${labelBit})`.slice(0, 160),
      },
    ];
    let patched = 0;
    for (const key of ['content', 'contentDraft']) {
      const file = p[key];
      if (!existsSync(file)) continue;
      try {
        const doc = JSON.parse(readFileSync(file, 'utf8'));
        if (!doc?.files) continue;
        const svcKey = findServiceFileKey(doc.files, target.slug);
        if (!svcKey) continue;
        doc.files[svcKey] = patchBeforeAfterImagesOnMarkdown(doc.files[svcKey], newEntries);
        writeJson(file, doc);
        patched += 1;
      } catch {
        /* ignore */
      }
    }
    const liveSvc = path.join(ROOT, 'src', 'content', 'services', `${target.slug}.md`);
    if (existsSync(liveSvc)) {
      const md = readFileSync(liveSvc, 'utf8');
      writeFileSync(liveSvc, patchBeforeAfterImagesOnMarkdown(md, newEntries), 'utf8');
      patched += 1;
    }
    syncSiteImagesToPublic(candidateId);
    saveMeta(candidateId, { lastServiceBeforeAfterImportAt: new Date().toISOString() });
    stampBaPairMeta(candidateId, baVariantKey({ serviceSlug: target.slug }), {
      source: baSourceFromLabel(labelBit),
      matchGrade: 'ok',
      matchTip: `AI-generated (${labelBit})`,
      matchGradeManual: false,
    });
    return {
      ok: true,
      scope: 'service',
      serviceSlug: target.slug,
      serviceName: target.serviceName,
      pairIndex: 1,
      files: newEntries,
      patched,
      candidate: getCandidateShell(candidateId),
    };
  }

  const idx = Math.max(1, Number(pairIndex) || 1);
  forgetBaLogoMatching(candidateId, new RegExp(`^gallery-ba-${idx}-(before|after)\\.`, 'i'));
  unlinkMatching(p.siteImages, new RegExp(`^gallery-ba-${idx}-(before|after)\\.`, 'i'));
  const beforeName = `gallery-ba-${idx}-before.jpg`;
  const afterName = `gallery-ba-${idx}-after.jpg`;
  writeFileSync(path.join(p.siteImages, beforeName), beforeBuffer);
  writeFileSync(path.join(p.siteImages, afterName), afterBuffer);
  const place = `${niche}${city ? ` in ${city}` : ''}`;
  const newEntries = [
    {
      filename: beforeName,
      src: `/images/${beforeName}`,
      alt: `Before — ${place} (${labelBit})`.slice(0, 160),
    },
    {
      filename: afterName,
      src: `/images/${afterName}`,
      alt: `After — ${place} (${labelBit})`.slice(0, 160),
    },
  ];
  const allBa = [];
  for (const name of readdirSync(p.siteImages)) {
    const m = name.match(/^gallery-ba-(\d+)-(before|after)\.(\w+)$/i);
    if (!m) continue;
    const role = m[2].toLowerCase();
    const preset = newEntries.find((e) => e.filename === name);
    allBa.push({
      filename: name,
      src: `/images/${name}`,
      alt: preset?.alt || `${role === 'before' ? 'Before' : 'After'} — ${niche}`,
    });
  }
  let patched = 0;
  for (const key of ['content', 'contentDraft']) {
    const file = p[key];
    if (!existsSync(file)) continue;
    try {
      const doc = JSON.parse(readFileSync(file, 'utf8'));
      if (!doc?.files) continue;
      const indexKey = Object.keys(doc.files).find((k) => /pages\/index\.md$/i.test(k));
      if (!indexKey) continue;
      doc.files[indexKey] = writeGalleryBaOnly(doc.files[indexKey], galleryBaOnlyEntries(allBa));
      writeJson(file, doc);
      patched += 1;
    } catch {
      /* ignore */
    }
  }
  const liveIndex = path.join(ROOT, 'src', 'content', 'pages', 'index.md');
  if (existsSync(liveIndex)) {
    const md = readFileSync(liveIndex, 'utf8');
    writeFileSync(liveIndex, writeGalleryBaOnly(md, galleryBaOnlyEntries(allBa)), 'utf8');
    patched += 1;
  }
  syncSiteImagesToPublic(candidateId);
  saveMeta(candidateId, { lastBeforeAfterImportAt: new Date().toISOString() });
  stampBaPairMeta(candidateId, baVariantKey({ pairIndex: idx }), {
    source: baSourceFromLabel(labelBit),
    matchGrade: 'ok',
    matchTip: `AI-generated (${labelBit})`,
    matchGradeManual: false,
  });
  return {
    ok: true,
    scope: 'home',
    pairIndex: idx,
    files: newEntries,
    patched,
    candidate: getCandidateShell(candidateId),
  };
}

function homePairsFromDisk(candidateId) {
  const byIndex = new Map();
  for (const e of collectGalleryBaFromDisk(candidateId)) {
    const m = String(e.filename || '').match(/^gallery-ba-(\d+)-(before|after)\./i);
    if (!m) continue;
    const idx = Number(m[1]) || 1;
    const role = m[2].toLowerCase();
    const row = byIndex.get(idx) || { pairIndex: idx, before: null, after: null };
    row[role] = e;
    byIndex.set(idx, row);
  }
  return [...byIndex.values()].sort((a, b) => a.pairIndex - b.pairIndex);
}

/**
 * Preview status for Website Review Images (home + per-service pairs on disk).
 */
export function listBeforeAfterStatus(candidateId) {
  const p = pathsFor(candidateId);
  const niche = String(loadConfig(candidateId).niche || 'remodel').trim();
  let structure = null;
  const structurePath = path.join(path.dirname(p.meta), `${p.id}-content-structure.json`);
  if (existsSync(structurePath)) {
    try {
      structure = JSON.parse(readFileSync(structurePath, 'utf8'));
    } catch {
      // ignore
    }
  }
  const svcBaEnabled = Boolean(structure?.sections?.includes('svcBeforeAfter'));
  const pages = structure?.pages || [];
  const servicesPageOn = !pages.length || pages.includes('services');
  const homePairs = homePairsFromDisk(candidateId);
  const homePrimary = homePairs[0] || { pairIndex: 1, before: null, after: null };
  const variantsDoc = readBaVariantsDoc(candidateId);
  const stampPreview = (filename) => {
    const name = path.basename(String(filename || ''));
    if (!name || name === '.' || name === '..') return null;
    let stamp = name;
    try {
      stamp = `${name}-${Math.round(statSync(path.join(p.siteImages, name)).mtimeMs)}`;
    } catch {
      stamp = name;
    }
    return `/api/candidates/${encodeURIComponent(p.id)}/images/file/${encodeURIComponent(name)}?v=${encodeURIComponent(stamp)}`;
  };
  const plan = readImagesPlanDoc(candidateId);
  const attachVariants = (key, row) => {
    const variants = (variantsDoc[key] || [])
      .filter((v) => {
        const b = v?.beforeFilename
          ? path.join(p.siteImages, path.basename(String(v.beforeFilename)))
          : '';
        const a = v?.afterFilename
          ? path.join(p.siteImages, path.basename(String(v.afterFilename)))
          : '';
        return Boolean(v?.id && b && a && existsSync(b) && existsSync(a));
      })
      .map((v) => ({
        ...v,
        beforeUrl: stampPreview(v.beforeFilename),
        afterUrl: stampPreview(v.afterFilename),
      }));
    const slug = row.slug || '';
    const pairIndex = row.pairIndex || 1;
    const complete = Boolean(row.before?.filename && row.after?.filename);
    const lastSource = variantsDoc._lastSent?.[key]?.source || '';
    const graded = baPairGradeFields({
      complete,
      alts: [row.before?.alt, row.after?.alt].filter(Boolean).join(' '),
      meta: variantsDoc._meta?.[key] || {},
      lastSource,
    });
    return {
      ...row,
      matchKey: key,
      slotDescription: defaultSlotDescription(
        {
          sectionId: row.serviceName || row.slug ? 'svcBeforeAfter' : 'beforeAfter',
          kind: 'gallery',
          key,
          serviceName: row.serviceName || '',
        },
        { niche },
      ),
      beforeUrl: stampPreview(row.before?.filename),
      afterUrl: stampPreview(row.after?.filename),
      complete: graded.complete,
      missing: graded.missing,
      source: graded.source,
      matchGrade: graded.matchGrade,
      matchTip: graded.matchTip,
      variants,
      lastPrompts: variantsDoc._lastSent?.[key] || null,
      promptPlan: plan?.beforeAfter?.[key] || null,
      promptsForGenerate: overlayBaCardPrompts(
        baPromptsForCard(candidateId, { serviceSlug: slug, pairIndex }),
        loadCandidateOpenaiPrompts(candidateId),
        key,
      ),
    };
  };
  const services = listConfiguredServiceTargets(candidateId).map((t) => {
    const entries = svcBaPairFromDisk(p.siteImages, t.slug, niche, t.serviceName);
    const before = entries.find((e) => /before\./i.test(e.filename)) || null;
    const after = entries.find((e) => /after\./i.test(e.filename)) || null;
    return attachVariants(`svc:${t.slug}`, {
      slug: t.slug,
      serviceName: t.serviceName,
      pairIndex: 1,
      before,
      after,
    });
  });
  const homeCards = homePairs.length
    ? homePairs.map((row) => attachVariants(`home:${row.pairIndex}`, row))
    : [attachVariants('home:1', homePrimary)];
  return {
    ok: true,
    home: {
      before: homePrimary.before || null,
      after: homePrimary.after || null,
      complete: Boolean(homePrimary.before && homePrimary.after),
      pairs: homePrimary.before || homePrimary.after ? collectGalleryBaFromDisk(candidateId) : [],
    },
    homePairs: homeCards,
    svcBeforeAfterEnabled: svcBaEnabled && servicesPageOn,
    services,
    flux: null,
    baLogo: readBaLogoState(candidateId),
  };
}

export function pickBaStatusPair(status, { serviceSlug = '', pairIndex = 1 } = {}) {
  const slug = String(serviceSlug || '').trim();
  if (slug) {
    return (status?.services || []).find((s) => s.slug === slug) || null;
  }
  const n = Math.max(1, Number(pairIndex) || 1);
  return (status?.homePairs || []).find((p) => (p.pairIndex || 1) === n) || status?.homePairs?.[0] || null;
}

function readBaVariantsDoc(candidateId) {
  const file = pathsFor(candidateId).baVariants;
  if (!existsSync(file)) return {};
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    return doc && typeof doc === 'object' ? doc : {};
  } catch {
    return {};
  }
}

export function loadBaVariantsDoc(candidateId) {
  return readBaVariantsDoc(candidateId);
}

export function saveBaVariantsDoc(candidateId, doc) {
  const file = pathsFor(candidateId).baVariants;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

const BA_MANUAL_GRADE_TIPS = {
  poor: 'Poor match (set by you)',
  ok: 'OK match (set by you)',
  good: 'Good match (set by you)',
};

export function normalizeBaMatchKey(matchKey) {
  let key = String(matchKey || '').trim();
  if (key.startsWith('ba:')) key = key.slice(3);
  return key;
}

export function inferBaSourceFromText(text) {
  const t = String(text || '');
  if (/gpt image|\bopenai\b/i.test(t)) return 'openai';
  if (/\bflux\b/i.test(t)) return 'flux';
  if (/chatgpt/i.test(t)) return 'chatgpt';
  return '';
}

export function baPairGradeFields({ complete = false, alts = '', meta = {}, lastSource = '' } = {}) {
  const missing = !complete;
  const known = new Set(['openai', 'flux', 'upload', 'photo-group', 'chatgpt', 'stock']);
  const inferred =
    inferBaSourceFromText(alts) ||
    (known.has(String(lastSource || '').toLowerCase()) ? String(lastSource).toLowerCase() : '') ||
    (known.has(String(meta.source || '').toLowerCase()) ? String(meta.source).toLowerCase() : '');
  const source = missing ? null : meta.source && known.has(meta.source) ? meta.source : inferred || 'photo-group';
  if (missing) {
    return {
      missing: true,
      complete: false,
      source: null,
      matchGrade: null,
      matchTip: 'No photo in this slot',
    };
  }
  if (source === 'upload') {
    return {
      missing: false,
      complete: true,
      source: 'upload',
      matchGrade: null,
      matchTip: 'Operator upload',
    };
  }
  const g =
    meta.matchGrade === 'poor' || meta.matchGrade === 'ok' || meta.matchGrade === 'good'
      ? meta.matchGrade
      : 'ok';
  const tip =
    meta.matchTip ||
    (g === 'good' ? 'Good match' : g === 'poor' ? 'Poor match' : 'OK match');
  return { missing: false, complete: true, source, matchGrade: g, matchTip: tip };
}

export function stampBaPairMeta(candidateId, matchKey, patch = {}) {
  const key = normalizeBaMatchKey(matchKey);
  if (!key) return null;
  const doc = loadBaVariantsDoc(candidateId);
  const all = { ...(doc._meta && typeof doc._meta === 'object' ? doc._meta : {}) };
  const next = { ...(all[key] || {}) };
  if (patch.source != null && patch.source !== '') next.source = patch.source;
  if ('matchGrade' in patch) next.matchGrade = patch.matchGrade;
  if ('matchTip' in patch) next.matchTip = patch.matchTip;
  if ('matchGradeManual' in patch) next.matchGradeManual = patch.matchGradeManual;
  all[key] = next;
  doc._meta = all;
  saveBaVariantsDoc(candidateId, doc);
  return next;
}

function baSourceFromLabel(label) {
  const t = String(label || '');
  if (/\bflux\b/i.test(t)) return 'flux';
  if (/openai|gpt image/i.test(t)) return 'openai';
  return 'openai';
}

export function setBaPairMatchGrade(candidateId, matchKey, matchGrade) {
  const grade = String(matchGrade || '').toLowerCase();
  if (grade !== 'poor' && grade !== 'ok' && grade !== 'good') {
    throw Object.assign(new Error('matchGrade must be poor, ok, or good'), { status: 400 });
  }
  const key = normalizeBaMatchKey(matchKey);
  const parsed = resolveBaVariantTarget({ matchKey: key });
  const live = findLiveBaFiles(candidateId, {
    serviceSlug: parsed.serviceSlug,
    pairIndex: parsed.pairIndex,
  });
  if (!live.before || !live.after) {
    throw Object.assign(new Error('No before/after pair in this slot to grade'), { status: 400 });
  }
  const prior = loadBaVariantsDoc(candidateId)._meta?.[parsed.key] || {};
  if (prior.source === 'upload') {
    throw Object.assign(
      new Error('Upload slots keep the upload marker; they are not Poor / OK / Good'),
      { status: 400 },
    );
  }
  stampBaPairMeta(candidateId, parsed.key, {
    matchGrade: grade,
    matchTip: BA_MANUAL_GRADE_TIPS[grade],
    matchGradeManual: true,
  });
  return {
    ok: true,
    status: listBeforeAfterStatus(candidateId),
    matchKey: parsed.key,
    matchGrade: grade,
  };
}

/**
 * Operator override for many before/after pairs. One variants-doc write.
 * Incomplete pairs and uploads are skipped.
 * @returns {{ applied: string[], skipped: { key: string, reason: string }[], status: object | null }}
 */
export function setBaPairsMatchGrade(candidateId, matchKeys, matchGrade) {
  const grade = String(matchGrade || '').toLowerCase();
  if (grade !== 'poor' && grade !== 'ok' && grade !== 'good') {
    throw Object.assign(new Error('matchGrade must be poor, ok, or good'), { status: 400 });
  }
  const wanted = [];
  const seen = new Set();
  for (const raw of Array.isArray(matchKeys) ? matchKeys : []) {
    const key = normalizeBaMatchKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    wanted.push(key);
  }
  const doc = loadBaVariantsDoc(candidateId);
  const all = { ...(doc._meta && typeof doc._meta === 'object' ? doc._meta : {}) };
  const skipped = [];
  const applied = [];
  for (const key of wanted) {
    if (!key.startsWith('svc:') && !key.startsWith('home:')) {
      skipped.push({ key, reason: 'Unknown before/after pair' });
      continue;
    }
    const parsed = resolveBaVariantTarget({ matchKey: key });
    const live = findLiveBaFiles(candidateId, {
      serviceSlug: parsed.serviceSlug,
      pairIndex: parsed.pairIndex,
    });
    if (!live.before || !live.after) {
      skipped.push({ key, reason: 'No before/after pair in this slot' });
      continue;
    }
    const prior = all[parsed.key] || {};
    if (prior.source === 'upload') {
      skipped.push({ key: parsed.key, reason: 'Upload slots keep the upload marker' });
      continue;
    }
    all[parsed.key] = {
      ...prior,
      matchGrade: grade,
      matchTip: BA_MANUAL_GRADE_TIPS[grade],
      matchGradeManual: true,
    };
    applied.push(parsed.key);
  }
  if (applied.length) {
    doc._meta = all;
    saveBaVariantsDoc(candidateId, doc);
  }
  return {
    applied,
    skipped,
    status: applied.length ? listBeforeAfterStatus(candidateId) : null,
  };
}

export const BA_VARIANT_CAP = IMAGE_TRAY_CAP;

export function trimBaVariantList(dir, variants, cap = BA_VARIANT_CAP) {
  return trimTrayVariants(dir, variants, cap);
}

export function baVariantKey({ serviceSlug, pairIndex } = {}) {
  if (serviceSlug) return `svc:${serviceSlug}`;
  return `home:${Math.max(1, Number(pairIndex) || 1)}`;
}

export function resolveBaVariantTarget({ matchKey = '', serviceSlug = '', pairIndex = 1 } = {}) {
  const key = String(matchKey || '').trim();
  if (key.startsWith('svc:')) {
    const slug = key.slice(4).trim();
    return { serviceSlug: slug, pairIndex: 1, key: baVariantKey({ serviceSlug: slug }) };
  }
  if (key.startsWith('home:')) {
    const n = Math.max(1, Number(key.split(':')[1]) || 1);
    return { serviceSlug: '', pairIndex: n, key: baVariantKey({ pairIndex: n }) };
  }
  const slug = String(serviceSlug || '').trim();
  const n = Math.max(1, Number(pairIndex) || 1);
  return { serviceSlug: slug, pairIndex: n, key: baVariantKey({ serviceSlug: slug, pairIndex: n }) };
}

export function findLiveBaFiles(candidateId, { serviceSlug, pairIndex } = {}) {
  const p = pathsFor(candidateId);
  if (!existsSync(p.siteImages)) return { before: null, after: null };
  const names = readdirSync(p.siteImages);
  if (serviceSlug) {
    return {
      before: names.find((n) => isLiveSvcBaFilename(n, serviceSlug) && /-before\./i.test(n)) || null,
      after: names.find((n) => isLiveSvcBaFilename(n, serviceSlug) && /-after\./i.test(n)) || null,
    };
  }
  const idx = Math.max(1, Number(pairIndex) || 1);
  return {
    before: names.find((n) => isLiveHomeBaFilename(n, idx) && /-before\./i.test(n)) || null,
    after: names.find((n) => isLiveHomeBaFilename(n, idx) && /-after\./i.test(n)) || null,
  };
}

function baArchiveSource(candidateId, filename) {
  const clean = baLogoCleanPath(candidateId, filename);
  if (clean && existsSync(clean)) return clean;
  return path.join(pathsFor(candidateId).siteImages, filename);
}

/** Copy the live pair into the variant tray. Call before overwriting live files. */
export function archiveLiveBaPairToTray(candidateId, { serviceSlug = '', pairIndex = 1 } = {}) {
  const p = pathsFor(candidateId);
  const live = findLiveBaFiles(candidateId, { serviceSlug, pairIndex });
  if (!live.before && !live.after) return;
  const key = baVariantKey({ serviceSlug, pairIndex });
  const doc = loadBaVariantsDoc(candidateId);
  const list = [...(doc[key] || [])];
  const beforeAbs = live.before ? baArchiveSource(candidateId, live.before) : '';
  const afterAbs = live.after ? baArchiveSource(candidateId, live.after) : '';
  if (
    baSourceIsDuplicate(
      p.siteImages,
      {
        beforeAbs,
        afterAbs,
        beforeFilename: live.before,
        afterFilename: live.after,
      },
      { variants: list },
    )
  ) {
    return;
  }
  const stamp = Date.now().toString(36);
  const prefix = serviceSlug
    ? `svc-ba-${serviceSlug}`
    : `gallery-ba-${Math.max(1, Number(pairIndex) || 1)}`;
  const beforeDest = live.before
    ? `${prefix}-var-${stamp}-before${path.extname(live.before) || '.jpg'}`
    : null;
  const afterDest = live.after
    ? `${prefix}-var-${stamp}-after${path.extname(live.after) || '.jpg'}`
    : null;
  if (beforeDest) {
    copyFileSync(beforeAbs, path.join(p.siteImages, beforeDest));
  }
  if (afterDest) {
    copyFileSync(afterAbs, path.join(p.siteImages, afterDest));
  }
  doc[key] = pushBaTrayEntry(p.siteImages, list, {
    id: `var-${stamp}`,
    beforeFilename: beforeDest,
    afterFilename: afterDest,
    source: 'prior',
    generatedAt: new Date().toISOString(),
  });
  saveBaVariantsDoc(candidateId, doc);
}

/** Replace one BA tray key with already-copied files (does not change live). */
export function setBaTrayEntries(candidateId, { serviceSlug = '', pairIndex = 1, entries = [] } = {}) {
  const p = pathsFor(candidateId);
  const key = baVariantKey({ serviceSlug, pairIndex });
  const live = findLiveBaFiles(candidateId, { serviceSlug, pairIndex });
  const doc = loadBaVariantsDoc(candidateId);
  const list = [];
  for (const e of entries || []) {
    const b = e?.beforeFilename ? path.basename(String(e.beforeFilename)) : '';
    const a = e?.afterFilename ? path.basename(String(e.afterFilename)) : '';
    if (!b || !a) continue;
    if (!baEntryFilesOnDisk(p.siteImages, { beforeFilename: b, afterFilename: a })) continue;
    list.push({
      id: e.id || `var-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      beforeFilename: b || null,
      afterFilename: a || null,
      source: e.source || 'photo-group',
      generatedAt: e.generatedAt || new Date().toISOString(),
    });
  }
  doc[key] = compactBaTray(p.siteImages, list, {
    liveBefore: live.before,
    liveAfter: live.after,
  });
  saveBaVariantsDoc(candidateId, doc);
  return doc[key];
}

