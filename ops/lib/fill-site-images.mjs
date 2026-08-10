/**
 * Pull unique free stock images into research/{id}/site-images/ with clear filenames.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  getCandidateDetail,
  pathsFor,
  saveMeta,
} from './candidates.mjs';
import { ensureYamlFrontmatter, loadAcceptedSiteConfig } from './content-markdown.mjs';
import {
  getContentOutlinePackage,
  getContentStructure,
  loadSectionRegistry,
} from './content-structure.mjs';
import {
  configuredImageProviders,
  imageProvidersStatus,
} from './image-providers/registry.mjs';

const ROOT = process.cwd();

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function slugify(text, max = 40) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max)
    .replace(/-$/g, '') || 'photo';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Structure has at least one photo slot enabled. */
export function structureHasPhotosEnabled(candidateId) {
  const structure = getContentStructure(candidateId);
  const photos = structure?.photos || {};
  return Object.values(photos).some((p) => p && p.enabled);
}

/**
 * Build fill slots from structure photos + outline images (+ service page heroes).
 */
export function listImageSlots(candidateId) {
  const structure = getContentStructure(candidateId);
  const outline = getContentOutlinePackage(candidateId);
  const registry = loadSectionRegistry();
  const sectionById = new Map((registry.sections || []).map((s) => [s.id, s]));
  const detail = getCandidateDetail(candidateId);
  const config =
    loadAcceptedSiteConfig(candidateId)?.config || detail.siteConfig || detail.siteConfigDraft || {};
  const niche = String(config.niche || detail.config?.niche || 'home service').trim();
  const city = String(config.primaryCity || '').trim();
  const services = Array.isArray(config.services) ? config.services : [];

  const slots = [];
  const photos = structure?.photos || {};

  for (const [sectionId, photo] of Object.entries(photos)) {
    if (!photo?.enabled) continue;
    const def = sectionById.get(sectionId);
    const count = Math.min(Math.max(Number(photo.count) || 1, 1), def?.maxImages || 6);
    const outlineSec = (outline?.sections || []).find((s) => s.id === sectionId);
    for (let n = 1; n <= count; n += 1) {
      const outlineImg = outlineSec?.images?.[n - 1];
      slots.push({
        key: `${sectionId}-${n}`,
        sectionId,
        index: n,
        label: def?.label || sectionId,
        kind: def?.kind || 'other',
        pages: def?.pages || ['home'],
        queryHint: buildQuery({ niche, city, sectionId, label: def?.label, kind: def?.kind, services, index: n }),
        preferredPath: outlineImg?.path || null,
      });
    }
  }

  // One unique photo per service for cards/heroes when svcHero or services photos enabled
  const wantPerService =
    (structure?.pages || []).includes('services') &&
    services.length > 0 &&
    Boolean(photos.svcHero?.enabled || photos.services?.enabled);

  if (wantPerService) {
    const without = slots.filter((s) => s.sectionId !== 'svcHero');
    const max = Math.min(services.length, 12);
    for (let i = 0; i < max; i += 1) {
      const name = services[i];
      without.push({
        key: `svcHero-${i + 1}`,
        sectionId: 'svcHero',
        index: i + 1,
        label: name,
        kind: 'hero',
        pages: ['services'],
        serviceName: name,
        queryHint: buildQuery({
          niche,
          city,
          sectionId: 'svcHero',
          label: name,
          kind: 'hero',
          services,
          index: i + 1,
          serviceName: name,
        }),
        preferredPath: null,
      });
    }
    return without;
  }

  return slots;
}

function buildQuery({ niche, sectionId, label, kind, services, index, serviceName }) {
  const parts = [];
  if (serviceName) parts.push(serviceName);
  else if (label && !/^hero|intro|process|gallery/i.test(label)) parts.push(label);
  parts.push(niche);
  if (kind === 'gallery' || sectionId === 'beforeAfter' || sectionId === 'svcBeforeAfter') {
    parts.push('before after renovation interior');
  } else if (kind === 'process' || sectionId === 'process' || sectionId === 'svcProcess') {
    parts.push('contractor work in progress tools');
  } else if (kind === 'hero' || sectionId === 'hero' || sectionId === 'svcHero') {
    parts.push('professional interior finished project');
  } else if (sectionId === 'materials' || sectionId === 'svcMaterials') {
    parts.push('building materials close up');
  } else {
    parts.push('residential interior');
  }
  // Vary query slightly by index so searches differ
  if (index > 1) parts.push(index === 2 ? 'detail' : 'home');
  // Prefer first service keyword as extra signal
  if (!serviceName && services[0] && index === 1) parts.push(String(services[0]));
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
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

function copyDirFiles(fromDir, toDir) {
  if (!existsSync(fromDir)) return 0;
  mkdirSync(toDir, { recursive: true });
  let n = 0;
  for (const name of readdirSync(fromDir)) {
    if (name.startsWith('.')) continue;
    const from = path.join(fromDir, name);
    const to = path.join(toDir, name);
    try {
      copyFileSync(from, to);
      n += 1;
    } catch {
      // skip
    }
  }
  return n;
}

/** Copy durable site-images into template public/images and optional staging. */
export function syncSiteImagesToPublic(candidateId) {
  const p = pathsFor(candidateId);
  const copied = {
    template: copyDirFiles(p.siteImages, path.join(ROOT, 'public', 'images')),
    staging: 0,
  };
  if (existsSync(p.siteStaging)) {
    copied.staging = copyDirFiles(p.siteImages, path.join(p.siteStaging, 'public', 'images'));
  }
  return copied;
}

function altFromSrc(src) {
  const base = path.basename(String(src || ''), path.extname(src || ''));
  return base.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Project photo';
}

/**
 * Rewrite accepted/draft content files so image srcs point at pulled filenames.
 */
function applyImagesToContentFiles(candidateId, filledSlots) {
  const p = pathsFor(candidateId);
  const contentPath = existsSync(p.content) ? p.content : p.contentDraft;
  if (!contentPath || !existsSync(contentPath)) return { updated: 0 };

  const doc = readJson(contentPath);
  if (!doc?.files) return { updated: 0 };

  const bySection = {};
  for (const slot of filledSlots) {
    if (!slot.filename) continue;
    if (!bySection[slot.sectionId]) bySection[slot.sectionId] = [];
    bySection[slot.sectionId].push(slot);
  }

  let updated = 0;
  const files = { ...doc.files };

  const setImageObject = (md, key, src, alt) => {
    const block = `${key}:\n  src: ${JSON.stringify(src)}\n  alt: ${JSON.stringify(alt)}`;
    const reObj = new RegExp(`^${key}:\\s*\\n(?:[ \\t]+[^\\n]*\\n)*`, 'm');
    const reScalar = new RegExp(`^${key}:\\s*[^\\n]*$`, 'm');
    if (reObj.test(md)) return md.replace(reObj, `${block}\n`);
    if (reScalar.test(md)) return md.replace(reScalar, block);
    // Insert after h1 or at end of frontmatter
    return md.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (m, fm) => {
      if (new RegExp(`^${key}:`, 'm').test(fm)) return m;
      return `---\n${fm.trimEnd()}\n${block}\n---`;
    });
  };

  const setGallery = (md, slots) => {
    const lines = slots.map(
      (s) =>
        `  - src: ${JSON.stringify(`/images/${s.filename}`)}\n    alt: ${JSON.stringify(s.alt || altFromSrc(s.filename))}`,
    );
    const block = `gallery:\n${lines.join('\n')}`;
    // Match list items with `-(?!-)` so closing fence `---` is never consumed
    const galleryRe = /^gallery:\s*\n(?:(?:[ \t]+.*|-(?!-).*)\n)*/m;
    if (galleryRe.test(md)) {
      return md.replace(galleryRe, `${block}\n`);
    }
    return md.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (m, fm) => {
      if (/^gallery:/m.test(fm)) return m;
      return `---\n${fm.trimEnd()}\n${block}\n---`;
    });
  };

  // Homepage index.md
  const indexKey = Object.keys(files).find((k) => /pages\/index\.md$/i.test(k));
  if (indexKey) {
    let md = files[indexKey];
    const hero = bySection.hero?.[0];
    if (hero) {
      md = setImageObject(md, 'heroImage', `/images/${hero.filename}`, hero.alt);
      updated += 1;
    }
    const intro = bySection.intro?.[0];
    if (intro) {
      md = setImageObject(md, 'featureImage', `/images/${intro.filename}`, intro.alt);
      updated += 1;
    }
    const gallerySlots = [...(bySection.beforeAfter || []), ...(bySection.gallery || [])];
    if (gallerySlots.length) {
      md = setGallery(md, gallerySlots);
      updated += 1;
    }
    // process step images
    const processSlots = bySection.process || bySection.offerProcess || [];
    if (processSlots.length && /process:/m.test(md)) {
      // Best-effort: leave process images if complex YAML; gallery/hero are enough for v1
    }
    md = ensureYamlFrontmatter(md);
    files[indexKey] = md.endsWith('\n') ? md : `${md}\n`;
  }

  // Service pages — one unique image each (never fall back to photo #1)
  const svcHeroes = bySection.svcHero || [];
  const serviceFiles = Object.keys(files)
    .filter((k) => /content\/services\/[^/]+\.md$/i.test(k))
    .sort();

  const slugFromRel = (rel) =>
    path
      .basename(rel, '.md')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');

  const matchSlotForService = (rel, index) => {
    const slug = slugFromRel(rel);
    const byName = svcHeroes.find((s) => {
      const sn = String(s.serviceName || s.label || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');
      return sn && (slug.includes(sn) || sn.includes(slug));
    });
    if (byName) return byName;
    return svcHeroes[index] || null;
  };

  const removeImageKey = (md, key) => {
    let out = md.replace(new RegExp(`^${key}:\\s*\\n(?:[ \\t]+[^\\n]*\\n)*`, 'm'), '');
    out = out.replace(new RegExp(`^${key}:\\s*[^\\n]*\\n?`, 'm'), '');
    return out;
  };

  serviceFiles.forEach((rel, i) => {
    const slot = matchSlotForService(rel, i);
    let md = files[rel];
    if (!slot?.filename) {
      md = removeImageKey(md, 'heroImage');
      md = removeImageKey(md, 'cardImage');
      files[rel] = md.endsWith('\n') ? md : `${md}\n`;
      return;
    }
    md = setImageObject(md, 'heroImage', `/images/${slot.filename}`, slot.alt);
    md = setImageObject(md, 'cardImage', `/images/${slot.filename}`, slot.alt);
    files[rel] = md.endsWith('\n') ? md : `${md}\n`;
    updated += 1;
  });

  writeJson(contentPath, { ...doc, files });

  // Mirror onto template src/content when accepted paths exist on disk
  for (const [rel, body] of Object.entries(files)) {
    if (!rel.startsWith('src/content/')) continue;
    const abs = path.join(ROOT, ...rel.split('/'));
    if (!existsSync(path.dirname(abs))) continue;
    try {
      writeFileSync(abs, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
    } catch {
      // non-fatal
    }
  }

  return { updated };
}

function writePullStatus(candidateId, status) {
  const p = pathsFor(candidateId);
  writeJson(p.imagesPullStatus, {
    ...status,
    updatedAt: new Date().toISOString(),
  });
}

function clearPullStatus(candidateId) {
  const p = pathsFor(candidateId);
  if (existsSync(p.imagesPullStatus)) {
    try {
      writeJson(p.imagesPullStatus, {
        status: 'idle',
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // ignore
    }
  }
}

/**
 * @param {string} candidateId
 * @param {{ replace?: boolean }} [opts]
 */
export async function fillSiteImages(candidateId, { replace = false } = {}) {
  const p = pathsFor(candidateId);
  const providers = configuredImageProviders();
  const providerStatus = imageProvidersStatus();

  if (!structureHasPhotosEnabled(candidateId)) {
    clearPullStatus(candidateId);
    return {
      ok: true,
      skipped: true,
      reason: 'No Structure photo slots enabled',
      providerStatus,
      filled: 0,
      total: 0,
      files: [],
      human: ['No photo slots enabled in Structure — skipped image pull.'],
    };
  }

  if (!providers.length) {
    const err = new Error(
      'Photos enabled but no image API keys configured. Set UNSPLASH_ACCESS_KEY and/or PEXELS_API_KEY in .env',
    );
    err.status = 400;
    err.providerStatus = providerStatus;
    throw err;
  }

  const slots = listImageSlots(candidateId);
  const manifest = loadManifest(candidateId);
  const usedIds = new Set(manifest.usedIds || []);
  const human = [];
  const filledSlots = [];
  const sourceCounts = {};

  mkdirSync(p.siteImages, { recursive: true });
  writePullStatus(candidateId, {
    status: 'running',
    current: 0,
    total: slots.length,
    label: 'Starting image pull…',
    replace: Boolean(replace),
  });

  try {
  for (let si = 0; si < slots.length; si += 1) {
    const slot = slots[si];
    writePullStatus(candidateId, {
      status: 'running',
      current: si + 1,
      total: slots.length,
      label: `Pulling ${slot.key} (${si + 1}/${slots.length})…`,
      slotKey: slot.key,
      replace: Boolean(replace),
    });

    const existing = manifest.slots?.[slot.key];
    const existingFile = existing?.filename
      ? path.join(p.siteImages, existing.filename)
      : null;
    if (!replace && existingFile && existsSync(existingFile)) {
      filledSlots.push({
        ...slot,
        ...existing,
        skipped: true,
        serviceName: slot.serviceName || existing.serviceName || null,
        label: slot.label || existing.label || null,
      });
      continue;
    }

    let chosen = null;
    let providerUsed = null;
    let download = null;
    const errors = [];

    for (const provider of providers) {
      try {
        const results = await provider.search(slot.queryHint, { perPage: 15 });
        const pick = results.find((r) => r.id && !usedIds.has(r.id));
        if (!pick) {
          errors.push(`${provider.id}: no unused results`);
          continue;
        }
        download = await provider.download(pick);
        chosen = pick;
        providerUsed = provider.id;
        break;
      } catch (e) {
        errors.push(`${provider.id}: ${e.message || e}`);
      }
      await sleep(200);
    }

    if (!chosen || !download?.buffer?.length) {
      human.push(`Slot ${slot.key}: failed (${errors.join('; ') || 'no photo'})`);
      filledSlots.push({ ...slot, error: errors.join('; ') || 'no photo' });
      continue;
    }

    const slug = slugify(
      chosen.tags?.[0] || chosen.description || slot.serviceName || slot.label || slot.sectionId,
    );
    const filename = `${slot.sectionId}-${slot.index}-${slug}.jpg`;
    const abs = path.join(p.siteImages, filename);
    writeFileSync(abs, download.buffer);

    usedIds.add(download.id || chosen.id);
    sourceCounts[providerUsed] = (sourceCounts[providerUsed] || 0) + 1;

    const entry = {
      key: slot.key,
      sectionId: slot.sectionId,
      index: slot.index,
      filename,
      src: `/images/${filename}`,
      alt: [chosen.description || `${slot.label} photo`, download.attribution]
        .filter(Boolean)
        .join(' — ')
        .slice(0, 180),
      provider: providerUsed,
      photoId: download.id || chosen.id,
      photographer: download.photographer,
      pageUrl: download.pageUrl,
      query: slot.queryHint,
      attribution: download.attribution,
      serviceName: slot.serviceName || slot.label || null,
      label: slot.label || null,
    };
    filledSlots.push(entry);
    await sleep(250);
  }

  const okFiles = filledSlots.filter((s) => s.filename);
  const nextManifest = {
    version: 1,
    candidateId: p.id,
    usedIds: [...usedIds],
    files: okFiles.map((s) => ({
      filename: s.filename,
      src: s.src,
      sectionId: s.sectionId,
      provider: s.provider,
      photoId: s.photoId,
      photographer: s.photographer,
      pageUrl: s.pageUrl,
      attribution: s.attribution,
      serviceName: s.serviceName || null,
    })),
    slots: Object.fromEntries(okFiles.map((s) => [s.key, s])),
    sources: sourceCounts,
    pulledAt: new Date().toISOString(),
    replace,
  };
  writeJson(p.imagesManifest, nextManifest);

  const synced = syncSiteImagesToPublic(candidateId);
  const contentUpdate = applyImagesToContentFiles(candidateId, okFiles);

  const filled = okFiles.filter((s) => !s.skipped).length;
  const skipped = okFiles.filter((s) => s.skipped).length;
  const failed = filledSlots.filter((s) => s.error).length;

  human.unshift(
    `Images: ${filled} pulled, ${skipped} kept, ${failed} failed (${okFiles.length}/${slots.length} on disk).`,
  );
  if (Object.keys(sourceCounts).length) {
    human.push(
      `Sources: ${Object.entries(sourceCounts)
        .map(([k, v]) => `${k}×${v}`)
        .join(' · ')}`,
    );
  }

  saveMeta(candidateId, {
    lastImagesPullAt: nextManifest.pulledAt,
    imagesCount: okFiles.length,
  });

  writePullStatus(candidateId, {
    status: 'done',
    current: slots.length,
    total: slots.length,
    label: human[0] || 'Done',
    filled,
    skipped,
    failed,
  });

  return {
    ok: failed === 0 || okFiles.length > 0,
    filled,
    skipped,
    failed,
    total: slots.length,
    files: nextManifest.files,
    sources: sourceCounts,
    synced,
    contentUpdate,
    providerStatus,
    manifest: nextManifest,
    human,
    candidate: getCandidateDetail(candidateId),
  };
  } catch (error) {
    writePullStatus(candidateId, {
      status: 'error',
      label: error?.message || 'Image pull failed',
      current: 0,
      total: slots.length,
    });
    throw error;
  }
}

export function getImagesManifest(candidateId) {
  const manifest = loadManifest(candidateId);
  const pull = readJson(pathsFor(candidateId).imagesPullStatus);
  return {
    ...manifest,
    pullStatus: pull,
    providerStatus: imageProvidersStatus(),
    photosEnabled: structureHasPhotosEnabled(candidateId),
    siteImagesPath: path.relative(ROOT, pathsFor(candidateId).siteImages).replace(/\\/g, '/'),
  };
}
