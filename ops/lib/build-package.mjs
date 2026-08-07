/**
 * Build package handoff artifact for Website Builder.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  getCandidateDetail,
  pathsFor,
  saveMeta,
} from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { runTemplateContract } from './template-contract.mjs';
import {
  applyArchetypeDefaults,
  normalizeArchetype,
  suggestArchetype,
} from '../../scripts/lib/site-archetypes.mjs';

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function checksum(text) {
  return createHash('sha256').update(String(text || ''), 'utf8').digest('hex').slice(0, 16);
}

function stripOps(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const { _ops, ...rest } = obj;
  return rest;
}

export function buildBuildPackage(candidateId, { siteArchetype } = {}) {
  const detail = getCandidateDetail(candidateId);
  const loaded = loadAcceptedSiteConfig(candidateId);
  if (!loaded?.config) {
    const err = new Error('Accept site-config first');
    err.status = 400;
    throw err;
  }
  let config = { ...loaded.config };
  if (siteArchetype) config.siteArchetype = normalizeArchetype(siteArchetype);
  if (!config.siteArchetype) {
    config.siteArchetype = suggestArchetype({
      services: config.services,
      niche: config.niche,
      suggestedServices: detail.approved?.suggestedServices,
    });
  }
  config = applyArchetypeDefaults(config);

  const content = detail.content || detail.contentDraft;
  const files = content?.files || {};
  const mode = content?._ops?.mode || (Object.keys(files).every((p) => p.startsWith('src/content/pages/'))
    ? 'homepage_first'
    : 'full');
  const contract = Object.keys(files).length
    ? runTemplateContract(files, config, { mode })
    : { ok: false, errors: ['No content files yet'], warnings: [], summary: {} };

  const manifest = {};
  for (const [rel, body] of Object.entries(files)) {
    manifest[rel] = { sha256_16: checksum(body), bytes: Buffer.byteLength(body, 'utf8') };
  }

  const pageRoles = {
    home: files['src/content/pages/index.md'] ? 'src/content/pages/index.md' : null,
    about: files['src/content/pages/about.md'] ? 'src/content/pages/about.md' : null,
    contact: files['src/content/pages/contact.md'] ? 'src/content/pages/contact.md' : null,
    services: Object.keys(files).filter((p) => p.startsWith('src/content/services/')),
    locations: Object.keys(files).filter((p) => p.startsWith('src/content/locations/')),
  };

  const pack = {
    generatedAt: new Date().toISOString(),
    candidateId,
    siteArchetype: config.siteArchetype,
    templateContractVersion: contract.contractVersion || 'astro-rr-1',
    mode,
    siteConfig: stripOps(config),
    contentManifest: manifest,
    pages: pageRoles,
    outlineRef: detail.contentOutline
      ? path.relative(process.cwd(), pathsFor(candidateId).contentOutline).replace(/\\/g, '/')
      : null,
    researchRef: detail.contentResearch
      ? path.relative(process.cwd(), pathsFor(candidateId).contentResearch).replace(/\\/g, '/')
      : null,
    contract,
    deploy: {
      repoName: null,
      domain: config.domain || null,
      cfProject: null,
    },
  };

  writeJson(pathsFor(candidateId).buildPackage, pack);
  saveMeta(candidateId, {
    lastBuildPackageAt: new Date().toISOString(),
    siteArchetype: config.siteArchetype,
  });
  return { package: pack, candidate: getCandidateDetail(candidateId) };
}

export function getBuildPackage(candidateId) {
  return readJson(pathsFor(candidateId).buildPackage);
}
