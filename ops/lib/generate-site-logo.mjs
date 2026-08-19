/**
 * Programmatic flat SVG monogram logo for Rover sites.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { pathsFor, getCandidateDetail, saveMeta } from './candidates.mjs';
import { syncSiteImagesToPublic } from './fill-site-images.mjs';

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

/**
 * Generate logo.svg into site-images + public/images and stamp site-config.logo.
 */
export function generateSiteLogo(candidateId) {
  const p = pathsFor(candidateId);
  const config = loadCandidateConfig(candidateId);
  const brand = config.brand || {};
  const svg = buildLogoSvg({
    businessName: config.businessName || 'Business',
    primary: brand.primary || '#1C2B3A',
    accent: brand.accent || '#E8A317',
  });

  mkdirSync(p.siteImages, { recursive: true });
  const abs = path.join(p.siteImages, 'logo.svg');
  writeFileSync(abs, svg, 'utf8');

  const publicDir = path.join(ROOT, 'public', 'images');
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(abs, path.join(publicDir, 'logo.svg'));
  syncSiteImagesToPublic(candidateId);

  const logo = {
    src: '/images/logo.svg',
    alt: `${config.businessName || 'Business'} logo`,
  };

  // Persist on accepted and/or draft site-config
  for (const key of ['siteConfig', 'siteConfigDraft']) {
    const file = p[key];
    const existing = readJson(file);
    if (!existing) continue;
    writeJson(file, { ...existing, logo });
  }

  // Also update live template config so Header works before Stage
  const livePath = path.join(ROOT, 'src', 'config', 'site-config.json');
  const live = readJson(livePath);
  if (live) {
    writeJson(livePath, { ...live, logo });
  }

  saveMeta(candidateId, { lastLogoAt: new Date().toISOString() });

  return {
    ok: true,
    logo,
    path: path.relative(ROOT, abs).replace(/\\/g, '/'),
    candidate: getCandidateDetail(candidateId),
  };
}
