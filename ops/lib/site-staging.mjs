/**
 * Per-candidate site staging (does not overwrite master template by default).
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { getCandidateDetail, pathsFor, saveMeta } from './candidates.mjs';
import { loadAcceptedSiteConfig, sanitizeMarkdownImageFrontmatter, ensureLocationFilesInMap, pruneLocationFilesToConfigured } from './content-markdown.mjs';
import { buildBuildPackage } from './build-package.mjs';
import { runTemplateContract } from './template-contract.mjs';
import { applyArchetypeDefaults } from '../../scripts/lib/site-archetypes.mjs';
import {
  assertLaunchContentComplete,
  expectedLaunchContentPaths,
  resolveStructurePageIds,
} from './preview-fidelity.mjs';
import { syncSiteImagesToPublic } from './fill-site-images.mjs';
import { setCoverageMapOnMarkdown } from './generate-coverage-map.mjs';
import { defaultPlaceholderSocialProof } from './site-config.mjs';
import { rehydrateGalleryBaFrontmatter } from './chatgpt-before-after.mjs';

const ROOT = process.cwd();

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** Ensure Google rating + 4.9★ comparison stat both exist on socialProof. */
export function ensureTrustRatingStat(config) {
  const next = { ...config };
  const proof = { ...(next.socialProof || {}) };
  const seed = defaultPlaceholderSocialProof(next.primaryCity, next.state, {
    businessName: next.businessName,
    niche: next.niche,
    services: next.services,
    primaryCity: next.primaryCity,
    targetSuburbs: next.targetSuburbs,
    coverageAreas: next.coverageAreas,
    seedKey: next.domain || next.businessName || `${next.primaryCity}|${next.state}`,
  });
  if (!proof.rating && seed.rating) proof.rating = { ...seed.rating };
  const stats = Array.isArray(proof.statistics) ? [...proof.statistics] : [];
  const hasStarStat = stats.some((s) => {
    const v = String(s?.value || '');
    const label = String(s?.label || '').toLowerCase();
    return (/★|⭐/.test(v) || /4\.9/.test(v)) && /rating|review/.test(label);
  });
  if (proof.rating && !hasStarStat) {
    stats.push({ value: '4.9★', label: 'Average customer rating' });
  }
  if (!stats.length && seed.statistics?.length) {
    proof.statistics = seed.statistics;
  } else {
    proof.statistics = stats;
  }
  if (!proof.licenses?.length && seed.licenses?.length) proof.licenses = seed.licenses;
  if (!proof.reviews?.length && seed.reviews?.length) proof.reviews = seed.reviews;
  next.socialProof = proof;
  return next;
}

/**
 * Stage full (default) or homepage_first content + site-config under research/{id}/site-staging/
 */
export function stageSiteContent(candidateId, { mode = 'full', refreshPackage = true } = {}) {
  const detail = getCandidateDetail(candidateId);
  const loaded = loadAcceptedSiteConfig(candidateId);
  if (!loaded?.config) {
    const err = new Error('Accept site-config first');
    err.status = 400;
    throw err;
  }
  const content = detail.content || detail.contentDraft;
  if (!content?.files) {
    const err = new Error('No content draft/accepted files to stage');
    err.status = 400;
    throw err;
  }

  let config = ensureTrustRatingStat(applyArchetypeDefaults({ ...loaded.config }));
  // Persist patched socialProof onto accepted site-config so Assemble/Stage stay in sync
  const p = pathsFor(candidateId);
  if (existsSync(p.siteConfig)) {
    const accepted = readJson(p.siteConfig);
    if (accepted && typeof accepted === 'object') {
      writeJson(p.siteConfig, { ...accepted, socialProof: config.socialProof });
    }
  }
  const files = { ...content.files };
  const pageIds = resolveStructurePageIds(candidateId, detail);
  const resolvedMode =
    mode === 'homepage_first'
      ? 'homepage_first'
      : pageIds.includes('services') || pageIds.includes('locations')
        ? 'full'
        : mode || 'full';

  if (resolvedMode === 'homepage_first') {
    for (const key of Object.keys(files)) {
      if (!key.startsWith('src/content/pages/')) delete files[key];
    }
  }

  // Sync site-images → public/ before omit-missing so Pull assets are on disk
  const imageSync = syncSiteImagesToPublic(candidateId);
  const siteImagesRoot = pathsFor(candidateId).siteImages;
  const sanitizeOpts = { extraRoots: [siteImagesRoot] };

  // Restore gallery-ba FM before sanitize/write (Accept may have dropped it)
  const galleryBa = rehydrateGalleryBaFrontmatter(candidateId, { files });

  // Inject coverageMap FM when SVG exists but homepage omitted it (Accept/sanitize race)
  const coverageSvgExists =
    existsSync(path.join(siteImagesRoot, 'coverage-map.svg')) ||
    existsSync(path.join(ROOT, 'public', 'images', 'coverage-map.svg'));
  if (coverageSvgExists) {
    const alt = `Coverage map for ${String(config.primaryCity || 'service').trim()} area`;
    for (const [rel, body] of Object.entries(files)) {
      if (!/pages\/index\.md$/i.test(rel)) continue;
      const md = String(body || '');
      if (/^coverageMap:/m.test(md)) continue;
      files[rel] = setCoverageMapOnMarkdown(md, '/images/coverage-map.svg', alt);
    }
  }

  // Heal frontmatter (e.g. missing closing ---) before contract + write
  for (const [rel, body] of Object.entries(files)) {
    if (rel.endsWith('.md')) {
      files[rel] = sanitizeMarkdownImageFrontmatter(body, sanitizeOpts);
    }
  }

  // Missing primary/suburb location pages (e.g. Accept before primary was required)
  const ensuredLocs = ensureLocationFilesInMap(files, config);
  Object.assign(files, ensuredLocs.files);
  // Drop orphans left after targetSuburbs shrink (pre–4–6 serve/rank split)
  const prunedLocs = pruneLocationFilesToConfigured(files, config);
  Object.keys(files).forEach((k) => delete files[k]);
  Object.assign(files, prunedLocs.files);

  if ((ensuredLocs.seeded.length || prunedLocs.pruned.length) && existsSync(p.content)) {
    const acceptedContent = readJson(p.content);
    if (acceptedContent && typeof acceptedContent === 'object') {
      let mergedFiles = { ...(acceptedContent.files || {}) };
      for (const rel of ensuredLocs.seeded) {
        if (files[rel]) mergedFiles[rel] = files[rel];
      }
      for (const rel of prunedLocs.pruned) {
        delete mergedFiles[rel];
      }
      // Also drop any accepted location orphans not in current files map
      for (const rel of Object.keys(mergedFiles)) {
        if (!/^src\/content\/locations\/.+\.md$/i.test(rel.replace(/\\/g, '/'))) continue;
        if (!files[rel]) delete mergedFiles[rel];
      }
      writeJson(p.content, {
        ...acceptedContent,
        files: mergedFiles,
        _ops: {
          ...(acceptedContent._ops || {}),
          ...(ensuredLocs.seeded.length
            ? {
                locationSeededAt: new Date().toISOString(),
                locationSeeded: [
                  ...new Set([
                    ...(acceptedContent._ops?.locationSeeded || []),
                    ...ensuredLocs.seeded,
                  ]),
                ],
              }
            : {}),
          ...(prunedLocs.pruned.length
            ? {
                locationPrunedAt: new Date().toISOString(),
                locationPruned: prunedLocs.pruned,
              }
            : {}),
        },
      });
    }
  }

  if (resolvedMode !== 'homepage_first') {
    assertLaunchContentComplete(files, config, pageIds, { label: 'Staging' });
  }

  const contract = runTemplateContract(files, config, { mode: resolvedMode });
  if (!contract.ok) {
    const err = new Error(`Staging blocked: ${contract.errors.slice(0, 3).join('; ')}`);
    err.status = 400;
    err.contract = contract;
    throw err;
  }

  const stagingRoot = pathsFor(candidateId).siteStaging;
  if (existsSync(stagingRoot)) {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
  mkdirSync(stagingRoot, { recursive: true });

  writeJson(path.join(stagingRoot, 'src', 'config', 'site-config.json'), config);

  // Re-sync after staging wipe so public/images (incl. coverage-map.svg) land in staging
  syncSiteImagesToPublic(candidateId);

  const written = [];
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(stagingRoot, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    const out = String(body || '');
    writeFileSync(abs, out.endsWith('\n') ? out : `${out}\n`, 'utf8');
    written.push(rel);
  }

  const imagesDir = path.join(stagingRoot, 'public', 'images');
  if (existsSync(imagesDir)) {
    for (const name of readdirSync(imagesDir)) {
      if (!name.startsWith('.')) written.push(`public/images/${name}`);
    }
  }

  const expected = expectedLaunchContentPaths(config, pageIds);
  const serviceCount = written.filter((p) => p.startsWith('src/content/services/')).length;
  const locationCount = written.filter((p) => p.startsWith('src/content/locations/')).length;

  writeJson(path.join(stagingRoot, '_staging.json'), {
    candidateId,
    stagedAt: new Date().toISOString(),
    mode: resolvedMode,
    siteArchetype: config.siteArchetype,
    pageIds,
    written,
    expectedCount: expected.length,
    serviceCount,
    locationCount,
    locationPruned: prunedLocs.pruned,
    contract,
    nextSteps: [
      'Review research/{id}/site-staging/src/content/',
      'Assemble (injects staging into sibling site + build)',
      'Open site preview and click every sitemap URL before Launch',
    ],
  });

  if (refreshPackage) {
    buildBuildPackage(candidateId, { siteArchetype: config.siteArchetype });
  }

  saveMeta(candidateId, {
    lastSiteStagingAt: new Date().toISOString(),
    siteStagingPath: path.relative(ROOT, stagingRoot).replace(/\\/g, '/'),
  });

  return {
    ok: true,
    stagingPath: path.relative(ROOT, stagingRoot).replace(/\\/g, '/'),
    written,
    mode: resolvedMode,
    pageIds,
    serviceCount,
    locationCount,
    locationPruned: prunedLocs.pruned,
    contract,
    imageSync,
    galleryBa,
    candidate: getCandidateDetail(candidateId),
  };
}

export function getStagingSummary(candidateId) {
  const metaPath = path.join(pathsFor(candidateId).siteStaging, '_staging.json');
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch {
    return null;
  }
}
