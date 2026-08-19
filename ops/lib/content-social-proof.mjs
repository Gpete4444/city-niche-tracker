/**
 * Rover-seeded socialProof placeholders + optional strip of legacy ### SOCIAL_PROOF sidecars.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathsFor } from './candidates.mjs';
import { defaultPlaceholderSocialProof } from './site-config.mjs';
import {
  applyGoogleStyleSocialProofIfNeeded,
  socialProofNeedsSeed,
} from '../../scripts/lib/review-seed.mjs';

const ROOT = process.cwd();

export { socialProofNeedsSeed };

const SOCIAL_PROOF_RE =
  /(?:^|\n)\s*#{1,3}\s*SOCIAL_PROOF\s*\n+```(?:json)?\s*([\s\S]*?)```/i;
const SOCIAL_PROOF_BARE_RE =
  /(?:^|\n)\s*#{1,3}\s*SOCIAL_PROOF\s*\n+(\{[\s\S]*?\n\})/;

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

/** @deprecated use socialProofNeedsSeed */
export const socialProofNeedsInvent = socialProofNeedsSeed;

/**
 * Strip legacy ### SOCIAL_PROOF blocks from paste (ignored — Rover seeds instead).
 */
export function extractSocialProofSidecar(raw) {
  const text = String(raw || '');
  let match = text.match(SOCIAL_PROOF_RE);
  let fullMatch = match?.[0];
  if (!fullMatch) {
    match = text.match(SOCIAL_PROOF_BARE_RE);
    fullMatch = match?.[0];
  }
  if (!fullMatch) {
    return { socialProof: null, textWithoutSidecar: text, reviewCount: 0 };
  }
  return {
    socialProof: null,
    textWithoutSidecar: text.replace(fullMatch, '\n').trim(),
    reviewCount: 0,
  };
}

/**
 * Merge socialProof into candidate research site-config (and optional live path).
 */
export function mergeSocialProofIntoSiteConfig(
  candidateId,
  socialProof,
  { alsoLive = false, source = 'rover_placeholder_seed' } = {},
) {
  if (!socialProof?.reviews?.length) {
    return { merged: false, reviewCount: 0 };
  }
  const p = pathsFor(candidateId);
  const targets = [p.siteConfig];
  if (alsoLive) targets.push(path.join(ROOT, 'src', 'config', 'site-config.json'));

  const reviewCount = socialProof.reviews.length;
  for (const filePath of targets) {
    if (!existsSync(filePath) && filePath !== p.siteConfig) continue;
    const existing = readJson(filePath) || {};
    const next = {
      ...existing,
      socialProof,
      _ops: {
        ...(existing._ops && typeof existing._ops === 'object' ? existing._ops : {}),
        roverSeededSocialProof: true,
        roverSeededSocialProofAt: new Date().toISOString(),
        roverSeededReviewCount: reviewCount,
        roverSeededSocialProofSource: source,
      },
    };
    writeJson(filePath, next);
  }
  return { merged: true, reviewCount, source };
}

/**
 * If candidate site-config socialProof is empty/placeholder, write defaultPlaceholderSocialProof.
 */
export function ensureRoverSocialProofSeed(candidateId, config = {}, { alsoLive = false } = {}) {
  const p = pathsFor(candidateId);
  const fromDisk = readJson(p.siteConfig) || {};
  const mergedConfig = {
    ...config,
    ...fromDisk,
    socialProof: fromDisk.socialProof || config.socialProof,
  };
  if (!socialProofNeedsSeed(mergedConfig)) {
    return { merged: false, reviewCount: mergedConfig.socialProof?.reviews?.length || 0 };
  }
  const city = mergedConfig.primaryCity || config.primaryCity || 'Local';
  const state = mergedConfig.state || config.state || '';
  const socialProof = defaultPlaceholderSocialProof(city, state, {
    businessName: mergedConfig.businessName || config.businessName,
    niche: mergedConfig.niche || config.niche,
    services: mergedConfig.services || config.services,
    primaryCity: city,
    targetSuburbs: mergedConfig.targetSuburbs || config.targetSuburbs,
    coverageAreas: mergedConfig.coverageAreas || config.coverageAreas,
    seedKey:
      mergedConfig.domain ||
      mergedConfig.businessName ||
      config.domain ||
      `${city}|${state}`,
  });
  return mergeSocialProofIntoSiteConfig(candidateId, socialProof, {
    alsoLive,
    source: 'defaultPlaceholderSocialProof',
  });
}

/**
 * Seed Google-style socialProof on an on-disk site-config.json (assembled/staging).
 * @returns {{ seeded: boolean, reviewCount: number }}
 */
export function ensureSocialProofOnSiteConfigFile(configPath, hints = {}) {
  if (!configPath || !existsSync(configPath)) {
    return { seeded: false, reviewCount: 0 };
  }
  const existing = readJson(configPath) || {};
  const merged = {
    ...existing,
    primaryCity: existing.primaryCity || hints.primaryCity,
    state: existing.state || hints.state,
    businessName: existing.businessName || hints.businessName,
    niche: existing.niche || hints.niche,
    services: existing.services || hints.services,
    domain: existing.domain || hints.domain,
    targetSuburbs: existing.targetSuburbs || hints.targetSuburbs,
    coverageAreas: existing.coverageAreas || hints.coverageAreas,
  };
  const { config, seeded, reviewCount } = applyGoogleStyleSocialProofIfNeeded(merged);
  if (!seeded) return { seeded: false, reviewCount: reviewCount || 0 };
  const next = {
    ...existing,
    ...config,
    socialProof: config.socialProof,
    _ops: {
      ...(existing._ops && typeof existing._ops === 'object' ? existing._ops : {}),
      roverSeededSocialProof: true,
      roverSeededSocialProofAt: new Date().toISOString(),
      roverSeededReviewCount: reviewCount,
      roverSeededSocialProofSource: 'assemble_or_file_reseed',
    },
  };
  writeJson(configPath, next);
  return { seeded: true, reviewCount };
}
