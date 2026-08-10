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
import { loadAcceptedSiteConfig, sanitizeMarkdownImageFrontmatter } from './content-markdown.mjs';
import { buildBuildPackage } from './build-package.mjs';
import { runTemplateContract } from './template-contract.mjs';
import { applyArchetypeDefaults } from '../../scripts/lib/site-archetypes.mjs';
import {
  assertLaunchContentComplete,
  expectedLaunchContentPaths,
  resolveStructurePageIds,
} from './preview-fidelity.mjs';
import { syncSiteImagesToPublic } from './fill-site-images.mjs';

const ROOT = process.cwd();

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
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

  let config = applyArchetypeDefaults({ ...loaded.config });
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

  // Heal frontmatter (e.g. missing closing ---) before contract + write
  for (const [rel, body] of Object.entries(files)) {
    if (rel.endsWith('.md')) {
      files[rel] = sanitizeMarkdownImageFrontmatter(body);
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

  // Copy stock images before writing MD (omitMissing checks disk under public/)
  const imageSync = syncSiteImagesToPublic(candidateId);

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
    contract,
    imageSync,
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
