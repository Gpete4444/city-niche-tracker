/**
 * Programmatic flat SVG monogram logo for Rover sites, plus OpenAI 2D mark / mark+text PNGs.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { addLastCost, pathsFor, getCandidateDetail, getCandidateShell, saveMeta, loadMeta } from './candidates.mjs';
import { syncSiteImagesToPublic } from './fill-site-images.mjs';
import {
  OPENAI_IMAGE_COST,
  openaiImageKeySet,
  generateOpenaiImage,
} from './image-providers/openai-image.mjs';
import { buildOpenaiLogoPrompt } from './logo-prompt.mjs';

export { buildOpenaiLogoPrompt };

const ROOT = process.cwd();
const LOGO_VARIANT_CAP = 4;
const LIVE_LOGO_NAMES = ['logo.svg', 'logo.png'];

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

/** 1–3 letter monogram from business name. */
export function monogramFromName(name) {
  const words = String(name || '')
    .replace(/[^a-zA-Z0-9\s&]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !/^(and|&|the|of|for|in)$/i.test(w));
  if (!words.length) return 'R';
  if (words.length === 1) {
    const w = words[0];
    return w.slice(0, Math.min(3, w.length)).toUpperCase();
  }
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function buildLogoSvg({
  businessName = 'Business',
  primary = '#1C2B3A',
  accent = '#E8A317',
} = {}) {
  const letters = monogramFromName(businessName);
  const fontSize = letters.length >= 3 ? 42 : letters.length === 2 ? 52 : 64;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="${escapeXml(businessName)} logo">
  <rect width="128" height="128" rx="28" fill="${escapeXml(primary)}"/>
  <rect x="6" y="6" width="116" height="116" rx="24" fill="none" stroke="${escapeXml(accent)}" stroke-width="4"/>
  <text x="64" y="72" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${fontSize}" font-weight="700" fill="#FFFFFF">${escapeXml(letters)}</text>
</svg>
`;
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c],
  );
}

function loadCandidateConfig(candidateId) {
  const p = pathsFor(candidateId);
  return readJson(p.siteConfig) || readJson(p.siteConfigDraft) || {};
}

export function normalizeLogoGenerateMode(mode) {
  const m = String(mode || 'monogram')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (m === 'mark' || m === 'icon') return 'mark';
  if (m === 'marktext' || m === 'wordmark' || m === 'markplus') return 'markText';
  return 'monogram';
}

function unlinkQuiet(abs) {
  try {
    if (existsSync(abs)) unlinkSync(abs);
  } catch {
    /* ignore */
  }
}

function liveLogoFilename(dir) {
  if (existsSync(path.join(dir, 'logo.png'))) return 'logo.png';
  if (existsSync(path.join(dir, 'logo.svg'))) return 'logo.svg';
  return null;
}

function trimLogoVariants(dir, variants, cap = LOGO_VARIANT_CAP) {
  const kept = (variants || []).slice(0, cap);
  const dropped = (variants || []).slice(cap);
  for (const v of dropped) {
    const name = path.basename(String(v?.filename || ''));
    if (name) unlinkQuiet(path.join(dir, name));
  }
  return kept;
}

function variantStamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function isLogoVariantFilename(name) {
  return /^logo-var-[a-z0-9]+\.(svg|png)$/i.test(String(name || ''));
}

/**
 * Copy the live logo into the tray (max 4). Returns the updated variants list.
 */
function archiveLiveLogoToTray(candidateId) {
  const p = pathsFor(candidateId);
  const live = liveLogoFilename(p.siteImages);
  if (!live) {
    const meta = loadMeta(candidateId);
    return Array.isArray(meta.logoVariants) ? meta.logoVariants : [];
  }
  mkdirSync(p.siteImages, { recursive: true });
  const destName = `logo-var-${variantStamp()}${path.extname(live)}`;
  copyFileSync(path.join(p.siteImages, live), path.join(p.siteImages, destName));
  const meta = loadMeta(candidateId);
  const next = trimLogoVariants(p.siteImages, [
    {
      filename: destName,
      mode: meta.logoGenerateMode || null,
      at: new Date().toISOString(),
    },
    ...(Array.isArray(meta.logoVariants) ? meta.logoVariants : []),
  ]);
  saveMeta(candidateId, { logoVariants: next });
  return next;
}

function stampLogoConfig(p, logo) {
  for (const key of ['siteConfig', 'siteConfigDraft']) {
    const file = p[key];
    const existing = readJson(file);
    if (!existing) continue;
    writeJson(file, { ...existing, logo });
  }
  const livePath = path.join(ROOT, 'src', 'config', 'site-config.json');
  const live = readJson(livePath);
  if (live) writeJson(livePath, { ...live, logo });
}

function writeLiveLogoFile(candidateId, filename, contents, { encoding } = {}) {
  const p = pathsFor(candidateId);
  mkdirSync(p.siteImages, { recursive: true });
  const abs = path.join(p.siteImages, filename);
  if (encoding) writeFileSync(abs, contents, encoding);
  else writeFileSync(abs, contents);
  for (const other of LIVE_LOGO_NAMES) {
    if (other !== filename) unlinkQuiet(path.join(p.siteImages, other));
  }
  const publicDir = path.join(ROOT, 'public', 'images');
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(abs, path.join(publicDir, filename));
  for (const other of LIVE_LOGO_NAMES) {
    if (other !== filename) unlinkQuiet(path.join(publicDir, other));
  }
  syncSiteImagesToPublic(candidateId);
  return abs;
}

/**
 * Generate header logo into site-images + public/images and stamp site-config.logo.
 * mode: monogram (SVG) | mark | markText (OpenAI PNG).
 * prompt: optional GPT Image prompt for mark / markText.
 */
export async function generateSiteLogo(candidateId, { mode, prompt } = {}) {
  const resolved = normalizeLogoGenerateMode(mode);
  const p = pathsFor(candidateId);
  const config = loadCandidateConfig(candidateId);
  const brand = config.brand || {};
  const businessName = config.businessName || 'Business';
  const primary = brand.primary || '#1C2B3A';
  const accent = brand.accent || '#E8A317';
  const niche = String(config.niche || 'home service').trim() || 'home service';
  const customPrompt = String(prompt || '').trim();
  const usedPrompt =
    customPrompt ||
    buildOpenaiLogoPrompt({
      mode: resolved,
      businessName,
      niche,
      primary,
      accent,
    });

  if (resolved !== 'monogram' && !openaiImageKeySet()) {
    throw Object.assign(
      new Error('Set OPENAI_API_KEY in .env (same key as Phone), then restart Rover.'),
      { status: 400, code: 'openai-unconfigured' },
    );
  }

  let abs;
  let filename;
  if (resolved === 'monogram') {
    archiveLiveLogoToTray(candidateId);
    filename = 'logo.svg';
    abs = writeLiveLogoFile(
      candidateId,
      filename,
      buildLogoSvg({ businessName, primary, accent }),
      { encoding: 'utf8' },
    );
  } else {
    const { buffer } = await generateOpenaiImage({
      prompt: usedPrompt,
      size: '1024x1024',
      background: 'transparent',
      outputFormat: 'png',
      compress: false,
    });
    archiveLiveLogoToTray(candidateId);
    filename = 'logo.png';
    abs = writeLiveLogoFile(candidateId, filename, buffer);
    addLastCost(candidateId, 'openai', OPENAI_IMAGE_COST.generate);
  }

  const logo = {
    src: `/images/${filename}`,
    alt: `${businessName} logo`,
  };
  stampLogoConfig(p, logo);
  const metaPatch = {
    lastLogoAt: new Date().toISOString(),
    logoGenerateMode: resolved,
  };
  if (resolved !== 'monogram') metaPatch.logoPrompt = usedPrompt;
  saveMeta(candidateId, metaPatch);

  return {
    ok: true,
    logo,
    mode: resolved,
    path: path.relative(ROOT, abs).replace(/\\/g, '/'),
    candidate: getCandidateShell(candidateId),
  };
}

/**
 * Promote a tray logo to live. Archives the current live file first.
 */
export function useLogoVariant(candidateId, filename) {
  const want = path.basename(String(filename || ''));
  if (!isLogoVariantFilename(want)) {
    throw Object.assign(new Error('filename required'), { status: 400 });
  }
  const p = pathsFor(candidateId);
  const meta = loadMeta(candidateId);
  const variants = [...(Array.isArray(meta.logoVariants) ? meta.logoVariants : [])];
  const idx = variants.findIndex((v) => path.basename(String(v.filename || '')) === want);
  if (idx < 0) throw Object.assign(new Error('Logo variant not found'), { status: 404 });
  const picked = variants[idx];
  const pickedAbs = path.join(p.siteImages, want);
  if (!existsSync(pickedAbs)) {
    throw Object.assign(new Error('Logo variant file missing on disk'), { status: 404 });
  }

  const liveName = liveLogoFilename(p.siteImages);
  let nextVariants = variants.filter((_, i) => i !== idx);
  if (liveName) {
    const destName = `logo-var-${variantStamp()}${path.extname(liveName)}`;
    copyFileSync(path.join(p.siteImages, liveName), path.join(p.siteImages, destName));
    nextVariants.unshift({
      filename: destName,
      mode: meta.logoGenerateMode || null,
      at: new Date().toISOString(),
    });
  }

  const liveDest = path.extname(want).toLowerCase() === '.svg' ? 'logo.svg' : 'logo.png';
  copyFileSync(pickedAbs, path.join(p.siteImages, liveDest));
  unlinkQuiet(pickedAbs);
  for (const other of LIVE_LOGO_NAMES) {
    if (other !== liveDest) unlinkQuiet(path.join(p.siteImages, other));
  }
  const publicDir = path.join(ROOT, 'public', 'images');
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(path.join(p.siteImages, liveDest), path.join(publicDir, liveDest));
  for (const other of LIVE_LOGO_NAMES) {
    if (other !== liveDest) unlinkQuiet(path.join(publicDir, other));
  }
  syncSiteImagesToPublic(candidateId);

  const config = loadCandidateConfig(candidateId);
  const businessName = config.businessName || 'Business';
  stampLogoConfig(p, {
    src: `/images/${liveDest}`,
    alt: `${businessName} logo`,
  });
  nextVariants = trimLogoVariants(p.siteImages, nextVariants);
  saveMeta(candidateId, {
    lastLogoAt: new Date().toISOString(),
    logoGenerateMode: picked.mode || meta.logoGenerateMode || null,
    logoVariants: nextVariants,
  });
  return {
    ok: true,
    logo: { src: `/images/${liveDest}`, alt: `${businessName} logo` },
    candidate: getCandidateShell(candidateId),
  };
}
