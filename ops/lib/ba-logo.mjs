/**
 * Stamp a candidate's own logo onto its before/after photos.
 * Photo-group files stay clean. Automatic stamps skip launched sites.
 * Add logo and a photo-group load stamp the current site, including when it is launched.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { RESEARCH_DIR, pathsFor } from './candidates.mjs';
import { isCandidateLaunched } from './launched-edit-guard.mjs';
import { loadManifest, syncSiteImagesToPublic } from './fill-site-images.mjs';

const LIVE_BA_RE =
  /^(?:gallery-ba-\d+|svc-ba-[a-z0-9_-]+-\d+)-(?:before|after)\.(?:jpe?g|png|webp)$/i;

/** Bump when the plate changes so existing stamps rebuild from their clean copies. */
export const BA_LOGO_PLATE = 3;

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function isLiveBaFilename(name) {
  return LIVE_BA_RE.test(path.basename(String(name || '')));
}

export function baLogoCleanDir(candidateId) {
  return path.join(pathsFor(candidateId).siteImages, 'ba-clean');
}

export function baLogoCleanPath(candidateId, filename) {
  const name = path.basename(String(filename || ''));
  if (!isLiveBaFilename(name)) return '';
  return path.join(baLogoCleanDir(candidateId), name);
}

function logoPathFor(candidateId) {
  const dir = pathsFor(candidateId).siteImages;
  if (existsSync(path.join(dir, 'logo.png'))) return path.join(dir, 'logo.png');
  if (existsSync(path.join(dir, 'logo.svg'))) return path.join(dir, 'logo.svg');
  return '';
}

function listLiveBaFilenames(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => isLiveBaFilename(name));
}

function patchImagesManifest(candidateId, patch) {
  const p = pathsFor(candidateId);
  const prev = loadManifest(candidateId);
  const next = { ...prev, ...patch, version: prev.version || 1, candidateId: p.id };
  writeJson(p.imagesManifest, next);
  return next;
}

function readJsonFile(file) {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function readBaLogoState(candidateId) {
  const launched = isCandidateLaunched(candidateId);
  const hasLogo = Boolean(logoPathFor(candidateId));
  const manifest = loadManifest(candidateId);
  const flagOn = manifest.baLogo !== false;
  return {
    enabled: flagOn,
    launched,
    hasLogo,
  };
}

/** Drop clean copies for live names that are about to be replaced. */
export function forgetBaLogoFiles(candidateId, names, { allowLaunched = false } = {}) {
  if (isCandidateLaunched(candidateId) && !allowLaunched) return;
  const drop = new Set(
    (names || []).map((name) => path.basename(String(name || ''))).filter((name) => isLiveBaFilename(name)),
  );
  if (!drop.size) return;
  const dir = baLogoCleanDir(candidateId);
  let removed = 0;
  for (const name of drop) {
    const file = path.join(dir, name);
    if (!existsSync(file)) continue;
    try {
      unlinkSync(file);
      removed += 1;
    } catch {
      /* ignore */
    }
  }
  const prev = loadManifest(candidateId);
  const stamped = Array.isArray(prev.baLogoStamped) ? prev.baLogoStamped : [];
  const nextStamped = stamped.filter((name) => !drop.has(name));
  if (!removed && nextStamped.length === stamped.length) return;
  patchImagesManifest(candidateId, { baLogoStamped: nextStamped });
}

export function forgetBaLogoMatching(candidateId, pattern, { allowLaunched = false } = {}) {
  if ((isCandidateLaunched(candidateId) && !allowLaunched) || !pattern) return;
  const dirs = [pathsFor(candidateId).siteImages, baLogoCleanDir(candidateId)];
  const names = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (pattern.test(name) && isLiveBaFilename(name)) names.push(name);
    }
  }
  forgetBaLogoFiles(candidateId, names, { allowLaunched });
}

function loadedGroupIds(candidateId) {
  const doc = readJsonFile(pathsFor(candidateId).photoGroup);
  if (!doc || doc.skipped) return [];
  const ids = Array.isArray(doc.groupIds) ? doc.groupIds : doc.groupId ? [doc.groupId] : [];
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
}

/** Clean original on the photo group's source site, when this site has no clean copy yet. */
export function sourceSiteCleanBaFile(candidateId, filename) {
  const name = path.basename(String(filename || ''));
  if (!isLiveBaFilename(name)) return '';
  const index = readJsonFile(path.join(RESEARCH_DIR, '_photo-groups', 'index.json'));
  const groups = Array.isArray(index?.groups) ? index.groups : [];
  for (const gid of loadedGroupIds(candidateId)) {
    const meta = groups.find((group) => group.id === gid);
    const sourceId = String(meta?.sourceCandidateId || '').trim();
    if (!sourceId || sourceId === String(candidateId)) continue;
    const clean = baLogoCleanPath(sourceId, name);
    if (clean && existsSync(clean)) return clean;
  }
  return '';
}

export async function compositeBaLogo(photoBuf, logoBuf, { filename = 'photo.jpg' } = {}) {
  const base = sharp(photoBuf, { failOn: 'none' }).rotate();
  const meta = await base.metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) {
    throw Object.assign(new Error('Before/after photo has no size'), { status: 400 });
  }
  const margin = Math.max(4, Math.round(width * 0.03));
  let logoW = Math.max(12, Math.round(width * 0.18));
  const maxLogo = Math.max(12, width - margin * 2);
  if (logoW > maxLogo) logoW = maxLogo;
  let logoSource = logoBuf;
  try {
    const trimmed = await sharp(logoBuf, { failOn: 'none', density: 300 }).trim().png().toBuffer();
    const trimmedMeta = await sharp(trimmed).metadata();
    if (trimmedMeta.width && trimmedMeta.height) logoSource = trimmed;
  } catch {
    logoSource = logoBuf;
  }
  const logoPng = await sharp(logoSource, { failOn: 'none' })
    .resize({
      width: logoW,
      height: Math.max(12, Math.round(height * 0.22)),
      fit: 'inside',
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();
  const logoMeta = await sharp(logoPng).metadata();
  const lw = logoMeta.width || logoW;
  const lh = logoMeta.height || logoW;
  const pad = Math.max(3, Math.round(lw * 0.03));
  const plateW = lw + pad * 2;
  const plateH = lh + pad * 2;
  const radius = Math.max(2, Math.round(pad * 1.2));
  const plate = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${plateW}" height="${plateH}"><rect x="0.5" y="0.5" width="${plateW - 1}" height="${plateH - 1}" rx="${radius}" ry="${radius}" fill="#ffffff" fill-opacity="0.94" stroke="#e4e4e4" stroke-width="1"/></svg>`,
  );
  let left = width - margin - plateW;
  let top = height - margin - plateH;
  if (left < 0) left = 0;
  if (top < 0) top = 0;
  const pipeline = sharp(photoBuf, { failOn: 'none' })
    .rotate()
    .removeAlpha()
    .composite([
      { input: plate, left, top },
      { input: logoPng, left: left + pad, top: top + pad },
    ]);
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  if (ext === '.webp') return pipeline.webp({ quality: 82 }).toBuffer();
  return pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}

async function loadLogoBuffer(candidateId, { throwOnLogoError = false } = {}) {
  const logoPath = logoPathFor(candidateId);
  if (!logoPath) return { logoPath: '', logoBuf: null, error: null };
  try {
    const logoBuf = readFileSync(logoPath);
    await sharp(logoBuf, { failOn: 'none', density: 300 }).metadata();
    return { logoPath, logoBuf, error: null };
  } catch (error) {
    if (throwOnLogoError) {
      throw Object.assign(new Error('Could not read the site logo for before/after photos.'), {
        status: 400,
      });
    }
    return { logoPath, logoBuf: null, error };
  }
}

/**
 * Stamp every live before/after file that is still clean.
 * Missing `baLogo` means on. An off flag and a missing logo are no-ops.
 * Launched sites are skipped unless allowLaunched is set (Add logo, or a photo-group load).
 */
export async function ensureBaLogo(candidateId, { sync = true, throwOnLogoError = false, allowLaunched = false } = {}) {
  const view = readBaLogoState(candidateId);
  if (view.launched && !allowLaunched) return { ok: true, skipped: 'launched', changed: 0, ...view };
  if (!view.enabled) return { ok: true, skipped: 'off', changed: 0, ...view };
  if (!view.hasLogo) return { ok: true, skipped: 'no-logo', changed: 0, ...view };
  const loaded = await loadLogoBuffer(candidateId, { throwOnLogoError });
  if (!loaded.logoBuf) {
    return { ok: true, skipped: 'logo-unreadable', changed: 0, ...view };
  }

  const imageDir = pathsFor(candidateId).siteImages;
  const names = listLiveBaFilenames(imageDir);
  if (!names.length) return { ok: true, skipped: 'no-pairs', changed: 0, ...view, enabled: true };

  const manifest = loadManifest(candidateId);
  const already = new Set(Array.isArray(manifest.baLogoStamped) ? manifest.baLogoStamped : []);
  const plateCurrent = Number(manifest.baLogoPlate) === BA_LOGO_PLATE;
  const cleanDir = baLogoCleanDir(candidateId);
  mkdirSync(cleanDir, { recursive: true });
  const stamped = [];
  let changed = 0;
  for (const name of names) {
    const livePath = path.join(imageDir, name);
    const cleanPath = path.join(cleanDir, name);
    if (already.has(name) && plateCurrent) {
      stamped.push(name);
      continue;
    }
    if (!existsSync(cleanPath)) {
      if (already.has(name)) {
        stamped.push(name);
        continue;
      }
      const fromSource = sourceSiteCleanBaFile(candidateId, name);
      copyFileSync(fromSource || livePath, cleanPath);
    }
    const out = await compositeBaLogo(readFileSync(cleanPath), loaded.logoBuf, { filename: name });
    const live = readFileSync(livePath);
    if (!live.equals(out)) {
      writeFileSync(livePath, out);
      changed += 1;
    }
    stamped.push(name);
  }
  patchImagesManifest(candidateId, {
    baLogo: true,
    baLogoStamped: stamped,
    baLogoPlate: BA_LOGO_PLATE,
  });
  if (sync && changed) syncSiteImagesToPublic(candidateId);
  return { ok: true, changed, ...readBaLogoState(candidateId), enabled: true };
}

async function restoreCleanBaFiles(candidateId) {
  const imageDir = pathsFor(candidateId).siteImages;
  const cleanDir = baLogoCleanDir(candidateId);
  let changed = 0;
  for (const name of listLiveBaFilenames(imageDir)) {
    const cleanPath = path.join(cleanDir, name);
    if (!existsSync(cleanPath)) continue;
    const clean = readFileSync(cleanPath);
    const livePath = path.join(imageDir, name);
    if (readFileSync(livePath).equals(clean)) continue;
    writeFileSync(livePath, clean);
    changed += 1;
  }
  return changed;
}

export async function setBaLogo(candidateId, enabled, { sync = true } = {}) {
  const view = readBaLogoState(candidateId);
  if (!view.hasLogo) {
    throw Object.assign(new Error('Generate a logo first.'), { status: 400 });
  }
  if (enabled) {
    patchImagesManifest(candidateId, { baLogo: true });
    return ensureBaLogo(candidateId, { sync, throwOnLogoError: true, allowLaunched: true });
  }
  const changed = await restoreCleanBaFiles(candidateId);
  patchImagesManifest(candidateId, { baLogo: false, baLogoStamped: [] });
  if (sync && changed) syncSiteImagesToPublic(candidateId);
  return { ok: true, changed, ...readBaLogoState(candidateId), enabled: false };
}
