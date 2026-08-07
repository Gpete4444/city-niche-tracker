/**
 * Per-candidate site staging (does not overwrite master template by default).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { getCandidateDetail, pathsFor, saveMeta } from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { buildBuildPackage } from './build-package.mjs';
import { runTemplateContract } from './template-contract.mjs';
import { applyArchetypeDefaults } from '../../scripts/lib/site-archetypes.mjs';

const ROOT = process.cwd();

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/**
 * Stage homepage (or full) content + site-config under research/{id}/site-staging/
 */
export function stageSiteContent(candidateId, { mode = 'homepage_first', refreshPackage = true } = {}) {
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
  if (mode === 'homepage_first') {
    for (const key of Object.keys(files)) {
      if (!key.startsWith('src/content/pages/')) delete files[key];
    }
  }

  const contract = runTemplateContract(files, config, { mode });
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

  const written = [];
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(stagingRoot, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
    written.push(rel);
  }

  writeJson(path.join(stagingRoot, '_staging.json'), {
    candidateId,
    stagedAt: new Date().toISOString(),
    mode,
    siteArchetype: config.siteArchetype,
    written,
    contract,
    nextSteps: [
      'Review research/{id}/site-staging/src/content/pages/index.md',
      'When ready: assemble clones template and inject this staging tree',
      'npm run build against assembled repo (Sprint E)',
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
    contract,
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
