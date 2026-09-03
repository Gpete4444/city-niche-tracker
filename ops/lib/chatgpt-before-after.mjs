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
  unlinkSync,
  renameSync,
} from 'node:fs';
import path from 'node:path';
import { pathsFor, getCandidateDetail, saveMeta } from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { syncSiteImagesToPublic } from './fill-site-images.mjs';

const ROOT = process.cwd();

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

export function roomHint(niche, services, viewpoint = 'inside') {
  const hay = `${niche || ''} ${(services || []).join(' ')}`.toLowerCase();
  const outside = viewpoint === 'outside';
  if (/egress|basement.?window|window.?well|foundation.?cut/.test(hay)) {
    return outside
      ? 'home exterior foundation wall with basement window well'
      : 'basement interior focused on a basement window';
  }
  if (/bath|shower|tub/.test(hay)) {
    return outside ? 'home exterior near bathroom window/vent' : 'bathroom';
  }
  if (/kitchen|cabin|counter/.test(hay)) {
    return outside ? 'home exterior near kitchen window' : 'kitchen';
  }
  if (/roof/.test(hay)) return 'home exterior roof';
  if (/hvac|air/.test(hay)) {
    return outside ? 'home exterior HVAC equipment pad' : 'utility / mechanical space';
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
  const out = [];
  if (homeOn) {
    out.push({
      key: 'home:1',
      kind: 'home',
      label: 'Homepage gallery before/after',
      serviceName: null,
      slug: null,
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
      });
    }
  }
  return out;
}

function fallbackBaScene({ serviceSlug = '', serviceName = '', pairIndex = 1, viewpoint = 'inside' } = {}) {
  const slug = String(serviceSlug || '').toLowerCase();
  const name = String(serviceName || '').toLowerCase();
  const hay = `${slug} ${name}`;
  const outside = viewpoint === 'outside';
  if (/egress|window.?well|basement.?window/.test(hay)) {
    return {
      room: outside ? 'home exterior foundation wall with window well' : 'basement interior at a basement window',
      defect: 'undersized or unfinished basement window and well',
      result: 'finished code-sized egress window and well',
    };
  }
  if (/texture/.test(hay)) {
    return {
      room: outside ? 'home exterior stucco wall' : 'dining room with orange-peel drywall',
      defect: 'a mismatched drywall texture patch that does not blend',
      result: 'even knockdown or orange-peel texture matching the surrounding wall',
    };
  }
  if (/patch/.test(hay)) {
    return {
      room: outside ? 'home exterior siding near a patched wall' : 'bedroom with a ceiling drywall patch',
      defect: 'an unfinished drywall patch with visible tape and mud',
      result: 'a smooth blended patch ready for paint',
    };
  }
  if (/repair/.test(hay)) {
    return {
      room: outside ? 'home exterior near a damaged wall corner' : 'hallway with a jagged hole in drywall',
      defect: 'a punched or water-damaged hole in the drywall',
      result: 'a repaired, taped, and sanded drywall surface',
    };
  }
  if (!slug) {
    return {
      room: outside ? 'home exterior at the main living-room window wall' : 'living room with an unfinished drywall seam',
      defect:
        Number(pairIndex) > 1
          ? 'an unmudded drywall joint on a long wall'
          : 'an unfinished drywall seam on a featured wall',
      result: 'smooth finished drywall ready for paint',
    };
  }
  return {
    room: outside ? 'home exterior at the service feature' : 'a distinct residential room for this service',
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
  const plan = readImagesPlanDoc(candidateId);
  const entry = plan?.beforeAfter && typeof plan.beforeAfter === 'object' ? plan.beforeAfter[key] : null;
  const side = entry?.[vp] || null;
  const claudeBefore = String(side?.before || '').trim();
  const claudeAfter = String(side?.after || '').trim();
  if (claudeBefore && claudeAfter) {
    return {
      key,
      viewpoint: vp,
      source: 'claude',
      room: String(entry?.room || '').trim() || null,
      before: claudeBefore,
      after: claudeAfter,
      afterRaw: claudeAfter,
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
      source: r.source,
      room: r.room,
    };
  }
  return sides;
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
  const scene = fallbackBaScene({
    serviceSlug: serviceTarget?.slug || '',
    serviceName: focusName,
    pairIndex: Number(opts.pairIndex) || 1,
    viewpoint,
  });
  const room = scene.room || roomHint(niche, services, viewpoint);
  const serviceLine = serviceTarget
    ? `Focus specifically on ${serviceTarget.serviceName} (not other services).`
    : services.length
      ? `Focus on ${services.slice(0, 2).join(' and ')}.`
      : `Focus on typical ${niche.toLowerCase()} work.`;

  const cameraLine =
    viewpoint === 'outside'
      ? `Camera viewpoint: OUTSIDE — photoreal exterior shot of the ${room} in ${place}, looking at the ${focusName} feature from outdoors.`
      : `Camera viewpoint: INSIDE — photoreal interior shot of the ${room} in ${place}, looking at the ${focusName} feature from indoors.`;

  const surgicalRules = [
    `SINGLE SUBJECT: only the ${focusName} change is the story.`,
    'Do NOT remodel the whole room/house. Do NOT change flooring, wall paint, ceiling, furniture, clutter layout, or unrelated finishes between before and after.',
    'Do NOT stage a trashy or demolished room. The space may look tidy, lived-in, or even attractive — the problem is specifically the service element.',
  ].join(' ');

  const before = [
    `Create a single documentary BEFORE photo for a local ${niche} business website.`,
    cameraLine,
    serviceLine,
    `Show a clear need for ${focusName} only (${scene.defect}) while the rest of the scene stays ordinary and believable.`,
    'If the defect is broken gypsum drywall, show thin paper-faced board, an irregular tear (not a circular crater), and a real wall cavity with wood studs — not masonry, clay, or a neat rubble pile.',
    surgicalRules,
    'Straight-on documentary photo, available indoor light — not golden hour, not cinematic bokeh, not a blown-out window. No people, no faces, no hands, no crew, no customers, no silhouettes. Lived-in ordinary house, not a catalog set. No text, no logos, no watermarks, no UI.',
    'Aspect ratio 4:3. Realistic residential architecture — not a showroom, not CGI-looking.',
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
    const m = name.match(new RegExp(`^svc-ba-${slug}-(\\d+)-(before|after)\\.(\\w+)$`, 'i'));
    if (!m) continue;
    const role = m[2].toLowerCase();
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
  const re = new RegExp(`^svc-ba-${slug}-\\d+-(before|after)\\.`, 'i');
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!re.test(name)) continue;
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
  return {
    ok: true,
    scope: 'service',
    serviceSlug: target.slug,
    serviceName: target.serviceName,
    pairIndex: 1,
    files: newEntries,
    orderedByTime: true,
    patched,
    candidate: getCandidateDetail(candidateId),
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

  return {
    ok: true,
    scope: 'home',
    pairIndex,
    files: newEntries,
    orderedByTime: true,
    deletedStock,
    patched,
    candidate: getCandidateDetail(candidateId),
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
  { serviceSlug = '', pairIndex = 1, beforeBuffer, afterBuffer, sourceLabel = 'Flux 2 Pro' } = {},
) {
  if (!beforeBuffer?.length || !afterBuffer?.length) {
    throw Object.assign(new Error('beforeBuffer and afterBuffer required'), { status: 400 });
  }
  const p = pathsFor(candidateId);
  mkdirSync(p.siteImages, { recursive: true });
  const config = loadConfig(candidateId);
  const niche = String(config.niche || 'remodel').trim();
  const city = String(config.primaryCity || '').trim();
  const labelBit = sourceLabel || 'Flux 2 Pro';

  if (serviceSlug) {
    const target = resolveServiceTarget(candidateId, serviceSlug);
    unlinkMatching(p.siteImages, new RegExp(`^svc-ba-${target.slug}-\\d+-(before|after)\\.`, 'i'));
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
    return {
      ok: true,
      scope: 'service',
      serviceSlug: target.slug,
      serviceName: target.serviceName,
      pairIndex: 1,
      files: newEntries,
      patched,
      candidate: getCandidateDetail(candidateId),
    };
  }

  const idx = Math.max(1, Number(pairIndex) || 1);
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
  return {
    ok: true,
    scope: 'home',
    pairIndex: idx,
    files: newEntries,
    patched,
    candidate: getCandidateDetail(candidateId),
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
  const stampPreview = (filename) =>
    filename
      ? `/api/candidates/${encodeURIComponent(p.id)}/images/file/${encodeURIComponent(filename)}?v=${encodeURIComponent(filename)}-${Date.now()}`
      : null;
  const plan = readImagesPlanDoc(candidateId);
  const attachVariants = (key, row) => {
    const variants = (variantsDoc[key] || []).map((v) => ({
      ...v,
      beforeUrl: stampPreview(v.beforeFilename),
      afterUrl: stampPreview(v.afterFilename),
    }));
    const slug = row.slug || '';
    const pairIndex = row.pairIndex || 1;
    return {
      ...row,
      matchKey: key,
      beforeUrl: stampPreview(row.before?.filename),
      afterUrl: stampPreview(row.after?.filename),
      complete: Boolean(row.before?.filename && row.after?.filename),
      variants,
      lastPrompts: variantsDoc._lastSent?.[key] || null,
      promptPlan: plan?.beforeAfter?.[key] || null,
      promptsForGenerate: baPromptsForCard(candidateId, { serviceSlug: slug, pairIndex }),
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
  };
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

export const BA_VARIANT_CAP = 8;

function unlinkQuietBa(abs) {
  try {
    if (existsSync(abs)) unlinkSync(abs);
  } catch {
    /* ignore */
  }
}

export function trimBaVariantList(dir, variants, cap = BA_VARIANT_CAP) {
  const kept = (variants || []).slice(0, cap);
  for (const v of (variants || []).slice(cap)) {
    if (v.filename) unlinkQuietBa(path.join(dir, path.basename(String(v.filename))));
    if (v.beforeFilename) unlinkQuietBa(path.join(dir, path.basename(String(v.beforeFilename))));
    if (v.afterFilename) unlinkQuietBa(path.join(dir, path.basename(String(v.afterFilename))));
  }
  return kept;
}

export function baVariantKey({ serviceSlug, pairIndex } = {}) {
  if (serviceSlug) return `svc:${serviceSlug}`;
  return `home:${Math.max(1, Number(pairIndex) || 1)}`;
}

export function findLiveBaFiles(candidateId, { serviceSlug, pairIndex } = {}) {
  const p = pathsFor(candidateId);
  if (!existsSync(p.siteImages)) return { before: null, after: null };
  const names = readdirSync(p.siteImages);
  if (serviceSlug) {
    const reB = new RegExp(`^svc-ba-${serviceSlug}-\\d+-before\\.`, 'i');
    const reA = new RegExp(`^svc-ba-${serviceSlug}-\\d+-after\\.`, 'i');
    return {
      before: names.find((n) => reB.test(n)) || null,
      after: names.find((n) => reA.test(n)) || null,
    };
  }
  const idx = Math.max(1, Number(pairIndex) || 1);
  return {
    before: names.find((n) => new RegExp(`^gallery-ba-${idx}-before\\.`, 'i').test(n)) || null,
    after: names.find((n) => new RegExp(`^gallery-ba-${idx}-after\\.`, 'i').test(n)) || null,
  };
}

/** Copy the live pair into the variant tray. Call before overwriting live files. */
export function archiveLiveBaPairToTray(candidateId, { serviceSlug = '', pairIndex = 1 } = {}) {
  const p = pathsFor(candidateId);
  const live = findLiveBaFiles(candidateId, { serviceSlug, pairIndex });
  if (!live.before && !live.after) return;
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
    copyFileSync(path.join(p.siteImages, live.before), path.join(p.siteImages, beforeDest));
  }
  if (afterDest) {
    copyFileSync(path.join(p.siteImages, live.after), path.join(p.siteImages, afterDest));
  }
  const key = baVariantKey({ serviceSlug, pairIndex });
  const doc = loadBaVariantsDoc(candidateId);
  const list = [...(doc[key] || [])];
  list.unshift({
    id: `var-${stamp}`,
    beforeFilename: beforeDest,
    afterFilename: afterDest,
    source: 'prior',
    generatedAt: new Date().toISOString(),
  });
  doc[key] = trimBaVariantList(p.siteImages, list);
  saveBaVariantsDoc(candidateId, doc);
}

/** Replace one BA tray key with already-copied files (does not change live). */
export function setBaTrayEntries(candidateId, { serviceSlug = '', pairIndex = 1, entries = [] } = {}) {
  const p = pathsFor(candidateId);
  const key = baVariantKey({ serviceSlug, pairIndex });
  const doc = loadBaVariantsDoc(candidateId);
  const list = [];
  const seen = new Set();
  for (const e of entries || []) {
    const b = e?.beforeFilename ? path.basename(String(e.beforeFilename)) : '';
    const a = e?.afterFilename ? path.basename(String(e.afterFilename)) : '';
    const sig = `${b}|${a}`;
    if (!b && !a) continue;
    if (seen.has(sig)) continue;
    seen.add(sig);
    list.push({
      id: e.id || `var-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      beforeFilename: b || null,
      afterFilename: a || null,
      source: e.source || 'photo-group',
      generatedAt: e.generatedAt || new Date().toISOString(),
    });
  }
  doc[key] = trimBaVariantList(p.siteImages, list);
  saveBaVariantsDoc(candidateId, doc);
  return doc[key];
}

