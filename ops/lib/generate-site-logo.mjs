/**
 * Programmatic flat SVG monogram logo for Rover sites, plus OpenAI 2D mark / mark+text PNGs.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { addLastCost, pathsFor, getCandidateDetail, saveMeta } from './candidates.mjs';
import { syncSiteImagesToPublic } from './fill-site-images.mjs';
import {
  OPENAI_IMAGE_COST,
  openaiImageKeySet,
  generateOpenaiImage,
} from './image-providers/openai-image.mjs';

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

function buildOpenaiLogoPrompt({ mode, businessName, niche, primary, accent }) {
  const colors = `Use brand colors ${primary} (primary) and ${accent} (accent).`;
  const base =
    `Flat 2D vector-style logo for a ${niche} company. ${colors} ` +
    `Centered square composition. Transparent background. Clean, simple, professional. ` +
    `Not photorealistic, not 3D, not a mockup, no drop shadows on a surface, no watermarks, no UI.`;
  if (mode === 'mark') {
    return `${base} Icon/mark only. No text, no letters, no wordmark. Suggest the trade visually for “${businessName}”.`;
  }
  return `${base} Simple icon plus the exact business name “${businessName}” in clean sans-serif lettering. No slogan, no extra words.`;
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
  for (const other of ['logo.svg', 'logo.png']) {
    if (other !== filename) unlinkQuiet(path.join(p.siteImages, other));
  }
  const publicDir = path.join(ROOT, 'public', 'images');
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(abs, path.join(publicDir, filename));
  for (const other of ['logo.svg', 'logo.png']) {
    if (other !== filename) unlinkQuiet(path.join(publicDir, other));
  }
  syncSiteImagesToPublic(candidateId);
  return abs;
}

/**
 * Generate header logo into site-images + public/images and stamp site-config.logo.
 * mode: monogram (SVG, default) | mark | markText (OpenAI PNG).
 */
export async function generateSiteLogo(candidateId, { mode } = {}) {
  const resolved = normalizeLogoGenerateMode(mode);
  const p = pathsFor(candidateId);
  const config = loadCandidateConfig(candidateId);
  const brand = config.brand || {};
  const businessName = config.businessName || 'Business';
  const primary = brand.primary || '#1C2B3A';
  const accent = brand.accent || '#E8A317';
  const niche = String(config.niche || 'home service').trim() || 'home service';

  let abs;
  let filename;
  if (resolved === 'monogram') {
    filename = 'logo.svg';
    abs = writeLiveLogoFile(
      candidateId,
      filename,
      buildLogoSvg({ businessName, primary, accent }),
      { encoding: 'utf8' },
    );
  } else {
    if (!openaiImageKeySet()) {
      throw Object.assign(
        new Error('Set OPENAI_API_KEY in .env (same key as Phone), then restart Rover.'),
        { status: 400, code: 'openai-unconfigured' },
      );
    }
    const { buffer } = await generateOpenaiImage({
      prompt: buildOpenaiLogoPrompt({
        mode: resolved,
        businessName,
        niche,
        primary,
        accent,
      }),
      size: '1024x1024',
      background: 'transparent',
      outputFormat: 'png',
      compress: false,
    });
    filename = 'logo.png';
    abs = writeLiveLogoFile(candidateId, filename, buffer);
    addLastCost(candidateId, 'openai', OPENAI_IMAGE_COST.generate);
  }

  const logo = {
    src: `/images/${filename}`,
    alt: `${businessName} logo`,
  };
  stampLogoConfig(p, logo);
  saveMeta(candidateId, {
    lastLogoAt: new Date().toISOString(),
    logoGenerateMode: resolved,
  });

  return {
    ok: true,
    logo,
    mode: resolved,
    path: path.relative(ROOT, abs).replace(/\\/g, '/'),
    candidate: getCandidateDetail(candidateId),
  };
}
