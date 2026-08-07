/**
 * Assemble checklist + clone-per-site inject (Sprint E).
 *
 * Prefers local template copy (always works). When origin / TEMPLATE_GITHUB_REPO
 * exists, checklist marks the remote step done; optional gh template clone later.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getCandidateDetail, pathsFor, saveMeta } from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { getStagingSummary } from './site-staging.mjs';

const ROOT = process.cwd();

const COPY_SKIP_NAMES = new Set([
  'node_modules',
  'dist',
  '.astro',
  '.git',
  '.cache',
  'research',
  'ops',
  'data',
  'prompts',
  '.env',
  '.env.local',
  '.env.production',
  'assembled-sites',
]);

const COPY_SKIP_PREFIXES = ['.env.', 'site-config.backup-'];

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function runGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** @returns {{ url: string|null, nameWithOwner: string|null, source: string|null }} */
export function getTemplateRemoteInfo() {
  const fromEnv = String(process.env.TEMPLATE_GITHUB_REPO || '').trim();
  if (fromEnv) {
    const nameWithOwner = fromEnv.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
    return {
      url: fromEnv.startsWith('http') ? fromEnv : `https://github.com/${nameWithOwner}.git`,
      nameWithOwner,
      source: 'env',
    };
  }
  try {
    const url = runGit(['remote', 'get-url', 'origin'], ROOT);
    if (!url) return { url: null, nameWithOwner: null, source: null };
    const nameWithOwner = url
      .replace(/^git@github\.com:/i, '')
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .trim();
    return { url, nameWithOwner: nameWithOwner || null, source: 'git' };
  } catch {
    return { url: null, nameWithOwner: null, source: null };
  }
}

export function templateRemoteReady() {
  return Boolean(getTemplateRemoteInfo().url);
}

function slugifySiteName(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'site';
}

function assembledSitesRoot() {
  const fromEnv = String(process.env.ASSEMBLED_SITES_DIR || '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(ROOT, '..', 'rank-and-rent-sites');
}

function shouldSkipCopy(name) {
  if (COPY_SKIP_NAMES.has(name)) return true;
  if (COPY_SKIP_PREFIXES.some((p) => name.startsWith(p))) return true;
  return false;
}

/** Recursive copy of template → site dir (Astro site only; skips ops/research). */
export function copyTemplateTree(destRoot) {
  mkdirSync(destRoot, { recursive: true });
  const walk = (rel = '') => {
    const abs = rel ? path.join(ROOT, rel) : ROOT;
    for (const name of readdirSync(abs)) {
      if (!rel && shouldSkipCopy(name)) continue;
      if (rel && shouldSkipCopy(name)) continue;
      const from = path.join(abs, name);
      const toRel = rel ? path.join(rel, name) : name;
      const to = path.join(destRoot, toRel);
      const st = statSync(from);
      if (st.isDirectory()) {
        mkdirSync(to, { recursive: true });
        walk(toRel);
      } else if (st.isFile()) {
        mkdirSync(path.dirname(to), { recursive: true });
        cpSync(from, to);
      }
    }
  };
  walk('');
}

/** Overlay staging site-config + content onto assembled site. */
export function injectStagingIntoSite(siteRoot, stagingRoot) {
  const injected = [];
  const stagingSrc = path.join(stagingRoot, 'src');
  if (!existsSync(stagingSrc)) {
    const err = new Error('Staging has no src/ tree — Stage content first');
    err.status = 400;
    throw err;
  }
  const overlay = (relDir = 'src') => {
    const fromDir = path.join(stagingRoot, relDir);
    if (!existsSync(fromDir)) return;
    for (const name of readdirSync(fromDir)) {
      const from = path.join(fromDir, name);
      const toRel = path.join(relDir, name);
      const to = path.join(siteRoot, toRel);
      const st = statSync(from);
      if (st.isDirectory()) {
        mkdirSync(to, { recursive: true });
        overlay(toRel);
      } else {
        mkdirSync(path.dirname(to), { recursive: true });
        cpSync(from, to);
        injected.push(toRel.replace(/\\/g, '/'));
      }
    }
  };
  overlay('src');
  return injected;
}

/**
 * Also pull live services/locations stubs into the site when staging is homepage-only.
 * Filters by site-config (service names + location state) so demo leftovers stay out.
 */
function syncLiveContentCollections(siteRoot, config) {
  const synced = [];
  const allowedServices = new Set(
    [...(config?.services || []), ...(config?.commercialServices || [])]
      .map((s) => String(s || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const wantState = String(config?.state || '')
    .trim()
    .toLowerCase();

  const readFm = (abs, key) => {
    try {
      const raw = readFileSync(abs, 'utf8');
      const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!m) return null;
      const line = m[1].split(/\r?\n/).find((l) => l.trimStart().startsWith(`${key}:`));
      if (!line) return null;
      return line
        .trim()
        .slice(key.length + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
    } catch {
      return null;
    }
  };

  const liveServices = path.join(ROOT, 'src', 'content', 'services');
  const destServices = path.join(siteRoot, 'src', 'content', 'services');
  if (existsSync(liveServices)) {
    mkdirSync(destServices, { recursive: true });
    // Clear copied demo services from template tree first
    for (const name of readdirSync(destServices)) {
      if (!name.endsWith('.md')) continue;
      rmSync(path.join(destServices, name), { force: true });
    }
    for (const name of readdirSync(liveServices)) {
      if (!name.endsWith('.md') || name.startsWith('_')) continue;
      const from = path.join(liveServices, name);
      if (allowedServices.size) {
        const serviceName = readFm(from, 'serviceName');
        if (!serviceName || !allowedServices.has(serviceName.toLowerCase())) continue;
      }
      const to = path.join(destServices, name);
      cpSync(from, to);
      synced.push(`src/content/services/${name}`);
    }
  }

  const liveLocs = path.join(ROOT, 'src', 'content', 'locations');
  const destLocs = path.join(siteRoot, 'src', 'content', 'locations');
  if (existsSync(liveLocs)) {
    mkdirSync(destLocs, { recursive: true });
    for (const name of readdirSync(destLocs)) {
      if (!name.endsWith('.md')) continue;
      rmSync(path.join(destLocs, name), { force: true });
    }
    for (const name of readdirSync(liveLocs)) {
      if (!name.endsWith('.md') || name.startsWith('_')) continue;
      const from = path.join(liveLocs, name);
      if (wantState) {
        const state = readFm(from, 'state');
        if (!state || state.toLowerCase() !== wantState) continue;
      }
      const to = path.join(destLocs, name);
      cpSync(from, to);
      synced.push(`src/content/locations/${name}`);
    }
  }
  return synced;
}

function initGitRepo(siteRoot, { commitMessage }) {
  if (!existsSync(path.join(siteRoot, '.git'))) {
    runGit(['init'], siteRoot);
    runGit(['branch', '-M', 'main'], siteRoot);
  }
  runGit(['add', '-A'], siteRoot);
  try {
    runGit(['-c', 'user.email=ops@local', '-c', 'user.name=Rank Rent Ops', 'commit', '-m', commitMessage], siteRoot);
  } catch (err) {
    const msg = String(err?.stderr || err?.message || err);
    if (!/nothing to commit/i.test(msg)) throw err;
  }
}

/** Launch checklist for Sprint E (no secrets). */
export function getAssembleChecklist(candidateId) {
  const detail = getCandidateDetail(candidateId);
  const config = loadAcceptedSiteConfig(candidateId)?.config || {};
  const remote = getTemplateRemoteInfo();
  const staging = getStagingSummary(candidateId);
  const assembledPath = detail.meta?.assembledSitePath
    ? path.resolve(ROOT, detail.meta.assembledSitePath)
    : null;
  const assembledExists = Boolean(assembledPath && existsSync(assembledPath));
  const hasBuild =
    assembledExists && existsSync(path.join(assembledPath, 'dist', 'index.html'));

  return {
    candidateId,
    domain: config.domain || null,
    siteArchetype: config.siteArchetype || detail.meta?.siteArchetype || null,
    templateRemote: remote,
    assembledSitePath: detail.meta?.assembledSitePath || null,
    docs: 'docs/ASSEMBLE-AND-LAUNCH.md',
    steps: [
      {
        id: 'template_remote',
        label: 'Push rank-and-rent-template to GitHub (Template repo)',
        done: Boolean(remote.url),
        detail: remote.url
          ? `Detected ${remote.nameWithOwner || remote.url} (${remote.source})`
          : 'No origin / TEMPLATE_GITHUB_REPO — see docs/ASSEMBLE-AND-LAUNCH.md',
      },
      {
        id: 'staging',
        label: 'Stage content for candidate',
        done: Boolean(staging),
      },
      {
        id: 'assemble',
        label: 'Clone template → inject staging → new site repo',
        done: assembledExists,
        detail: assembledExists ? detail.meta.assembledSitePath : null,
      },
      {
        id: 'build',
        label: 'npm run build in site repo',
        done: hasBuild,
      },
      {
        id: 'pages',
        label: 'Create Cloudflare Pages project (build: npm run build, output: dist)',
        done: Boolean(detail.meta?.cloudflarePagesDone),
      },
      {
        id: 'dns',
        label: 'Point domain DNS to Pages',
        done: Boolean(detail.meta?.dnsDone),
      },
      {
        id: 'forms',
        label: 'Set real web3FormsAccessKey (+ optional Turnstile)',
        done: Boolean(detail.meta?.formsDone),
      },
      {
        id: 'email',
        label: 'Cloudflare Email Routing for leads@',
        done: Boolean(detail.meta?.emailRoutingDone),
      },
    ],
  };
}

/**
 * Assemble a sibling site directory from this template + candidate staging.
 * @param {string} candidateId
 * @param {{ force?: boolean, skipGit?: boolean, siteSlug?: string }} [opts]
 */
export function assembleSite(candidateId, { force = false, skipGit = false, siteSlug } = {}) {
  const staging = getStagingSummary(candidateId);
  if (!staging) {
    const err = new Error('Stage content first (research/{id}/site-staging missing)');
    err.status = 400;
    err.checklist = getAssembleChecklist(candidateId);
    throw err;
  }

  const loaded = loadAcceptedSiteConfig(candidateId);
  const config = loaded?.config || {};
  const detail = getCandidateDetail(candidateId);
  const slug =
    siteSlug ||
    (config.domain && !/^example\.com$/i.test(config.domain)
      ? slugifySiteName(config.domain)
      : null) ||
    slugifySiteName(
      [config.primaryCity, config.niche].filter(Boolean).join('-'),
    ) ||
    slugifySiteName(candidateId);

  const sitesRoot = assembledSitesRoot();
  const siteRoot = path.join(sitesRoot, slug);

  if (existsSync(siteRoot) && !force) {
    const err = new Error(
      `Assembled site already exists at ${siteRoot}. Pass force=true to replace.`,
    );
    err.status = 409;
    err.siteRoot = siteRoot;
    err.checklist = getAssembleChecklist(candidateId);
    throw err;
  }

  if (existsSync(siteRoot)) {
    rmSync(siteRoot, { recursive: true, force: true });
  }
  mkdirSync(sitesRoot, { recursive: true });

  copyTemplateTree(siteRoot);
  const stagingRoot = pathsFor(candidateId).siteStaging;
  const injected = injectStagingIntoSite(siteRoot, stagingRoot);
  const synced = syncLiveContentCollections(siteRoot, config);

  writeJson(path.join(siteRoot, 'wrangler.json'), {
    name: slug,
    compatibility_date: '2025-08-01',
    assets: {
      directory: './dist',
    },
  });

  writeJson(path.join(siteRoot, '_assemble.json'), {
    candidateId,
    assembledAt: new Date().toISOString(),
    templateRoot: ROOT,
    templateRemote: getTemplateRemoteInfo(),
    stagingPath: path.relative(ROOT, stagingRoot).replace(/\\/g, '/'),
    injected,
    syncedContent: synced,
    nextSteps: [
      `cd ${siteRoot}`,
      'npm install',
      'npm run build',
      'Cloudflare Workers Builds: npm run build + npx wrangler deploy (see docs/ASSEMBLE-AND-LAUNCH.md)',
    ],
  });

  if (!skipGit) {
    initGitRepo(siteRoot, {
      commitMessage: `Assemble ${slug} from staging (${candidateId})`,
    });
  }

  const relPath = path.relative(ROOT, siteRoot).replace(/\\/g, '/');
  saveMeta(candidateId, {
    lastAssembleAt: new Date().toISOString(),
    assembledSitePath: relPath,
    assembledSiteSlug: slug,
  });

  return {
    ok: true,
    siteRoot: relPath,
    absoluteSiteRoot: siteRoot,
    slug,
    injected,
    syncedContent: synced,
    checklist: getAssembleChecklist(candidateId),
    candidate: getCandidateDetail(candidateId),
    nextSteps: [
      `cd "${siteRoot}"`,
      'npm install && npm run build',
      'Follow docs/ASSEMBLE-AND-LAUNCH.md for Cloudflare Pages + DNS + forms',
    ],
  };
}

/** @deprecated use assembleSite */
export function assembleSiteStub(candidateId) {
  return assembleSite(candidateId);
}
