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
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { getCandidateDetail, pathsFor, saveMeta } from './candidates.mjs';
import { loadAcceptedSiteConfig, sanitizeMarkdownImageFrontmatter } from './content-markdown.mjs';
import {
  ensureRoverSocialProofSeed,
  ensureSocialProofOnSiteConfigFile,
} from './content-social-proof.mjs';
import { getStagingSummary } from './site-staging.mjs';
import { stopAssembledPreviewSync } from './assembled-preview.mjs';

const ROOT = process.cwd();

/** Written under node_modules so buildAssembledSite can skip redundant npm install. */
export const ROVER_DEPS_HASH_FILE = '.rover-deps-hash';

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Stable identity of package.json + package-lock.json for install reuse.
 * @param {string} siteRoot
 */
export function hashPackageDeps(siteRoot) {
  const h = createHash('sha256');
  for (const name of ['package.json', 'package-lock.json']) {
    const p = path.join(siteRoot, name);
    h.update(name);
    h.update('\0');
    if (existsSync(p)) h.update(readFileSync(p));
    else h.update('missing');
    h.update('\0');
  }
  return h.digest('hex');
}

/**
 * @param {string} siteRoot
 * @param {string} hash
 */
export function writeDepsHashMarker(siteRoot, hash) {
  const nm = path.join(siteRoot, 'node_modules');
  if (!existsSync(nm)) return;
  writeFileSync(path.join(nm, ROVER_DEPS_HASH_FILE), `${hash}\n`, 'utf8');
}

/**
 * @param {string} siteRoot
 * @returns {boolean}
 */
export function depsHashMarkerMatches(siteRoot) {
  const marker = path.join(siteRoot, 'node_modules', ROVER_DEPS_HASH_FILE);
  if (!existsSync(marker)) return false;
  const expected = hashPackageDeps(siteRoot);
  const actual = readFileSync(marker, 'utf8').trim();
  return Boolean(expected) && actual === expected;
}

/**
 * Move node_modules aside before force-wipe so cold npm install is not required
 * when package.json / lockfile are unchanged after template copy.
 * @param {string} siteRoot
 * @returns {{ stashDir: string, depsHash: string } | null}
 */
function stashNodeModules(siteRoot) {
  const nm = path.join(siteRoot, 'node_modules');
  if (!existsSync(nm) || !statSync(nm).isDirectory()) return null;
  const depsHash = hashPackageDeps(siteRoot);
  const stashDir = path.join(
    path.dirname(siteRoot),
    `.nm-stash-${path.basename(siteRoot)}-${process.pid}-${Date.now()}`,
  );
  if (existsSync(stashDir)) {
    rmSync(stashDir, { recursive: true, force: true });
  }
  try {
    renameSync(nm, stashDir);
    return { stashDir, depsHash };
  } catch {
    try {
      cpSync(nm, stashDir, { recursive: true });
      rmSync(nm, { recursive: true, force: true });
      return { stashDir, depsHash };
    } catch {
      return null;
    }
  }
}

/**
 * Restore stashed node_modules only when dep files match the pre-wipe tree.
 * @param {string} siteRoot
 * @param {{ stashDir: string, depsHash: string } | null} stash
 * @returns {{ restored: boolean }}
 */
function restoreOrDiscardNodeModules(siteRoot, stash) {
  if (!stash?.stashDir || !existsSync(stash.stashDir)) return { restored: false };
  const newHash = hashPackageDeps(siteRoot);
  const dest = path.join(siteRoot, 'node_modules');
  if (newHash && newHash === stash.depsHash) {
    try {
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      renameSync(stash.stashDir, dest);
      writeDepsHashMarker(siteRoot, newHash);
      return { restored: true };
    } catch {
      try {
        cpSync(stash.stashDir, dest, { recursive: true });
        rmSync(stash.stashDir, { recursive: true, force: true });
        writeDepsHashMarker(siteRoot, newHash);
        return { restored: true };
      } catch {
        /* fall through to discard */
      }
    }
  }
  try {
    rmSync(stash.stashDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  return { restored: false };
}

/** Remove assembled site folder; stop :4322 first and retry on Windows locks. */
function removeAssembledSiteRoot(siteRoot) {
  if (!existsSync(siteRoot)) return;
  stopAssembledPreviewSync({ waitMs: 2500 });
  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      rmSync(siteRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      lastErr = error;
      const code = error?.code || '';
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY') throw error;
      stopAssembledPreviewSync({ waitMs: 500 });
      sleepSync(200 * attempt);
    }
  }
  const err = new Error(
    `Could not replace assembled site (folder locked): ${siteRoot}. Close Explorer windows and site preview (:4322), then retry. ${lastErr?.message || ''}`.trim(),
  );
  err.status = 423;
  err.siteRoot = siteRoot;
  err.cause = lastErr;
  throw err;
}

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
  return path.join(ROOT, '..', 'rover-sites');
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

/**
 * True when assembled package.json + lock match the Rover template (safe to refresh in place).
 * @param {string} siteRoot
 */
export function assembledPackageDepsMatchTemplate(siteRoot) {
  if (!existsSync(siteRoot)) return false;
  const templateHash = hashPackageDeps(ROOT);
  const siteHash = hashPackageDeps(siteRoot);
  return Boolean(templateHash) && templateHash === siteHash && Boolean(siteHash);
}

const TEMPLATE_LAYOUT_WATCH = [
  'src/components',
  'src/layouts',
  'src/pages',
  'src/lib',
  'src/styles',
];

function newestMtimeUnder(absDir) {
  let max = 0;
  if (!existsSync(absDir)) return 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = path.join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) max = Math.max(max, st.mtimeMs);
    }
  };
  walk(absDir);
  return max;
}

/**
 * True when Rover template layout/code under src/ is newer than the assembled copy.
 * Refresh injects content only — stale components need a full assemble.
 * @param {string} siteRoot
 */
export function templateComponentsNewerThanAssembled(siteRoot) {
  if (!existsSync(siteRoot)) return true;
  let templateMax = 0;
  let assembledMax = 0;
  for (const rel of TEMPLATE_LAYOUT_WATCH) {
    templateMax = Math.max(templateMax, newestMtimeUnder(path.join(ROOT, rel)));
    assembledMax = Math.max(assembledMax, newestMtimeUnder(path.join(siteRoot, rel)));
  }
  if (!assembledMax) return true;
  // 2s skew avoids false positives from near-simultaneous copies
  return templateMax > assembledMax + 2000;
}

/**
 * Overlay staging site-config + content onto assembled site.
 * Skips rewriting files whose bytes are unchanged (keeps mtimes for skip-build).
 */
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
        let nextBuf;
        if (name.endsWith('.md')) {
          const raw = readFileSync(from, 'utf8');
          const cleaned = sanitizeMarkdownImageFrontmatter(raw);
          const text = cleaned.endsWith('\n') ? cleaned : `${cleaned}\n`;
          nextBuf = Buffer.from(text, 'utf8');
        } else {
          nextBuf = readFileSync(from);
        }
        if (existsSync(to)) {
          try {
            const prev = readFileSync(to);
            if (prev.equals(nextBuf)) {
              injected.push(toRel.replace(/\\/g, '/'));
              continue;
            }
          } catch {
            /* rewrite */
          }
        }
        writeFileSync(to, nextBuf);
        injected.push(toRel.replace(/\\/g, '/'));
      }
    }
  };
  overlay('src');
  overlay('public');
  return injected;
}

/**
 * When staging supplied services/locations, drop leftover template demo MD that
 * copyTemplateTree left behind (not in the injected set).
 */
function pruneUnstagedContentCollections(siteRoot, injectedRels = []) {
  const pruned = [];
  const injected = new Set(
    (injectedRels || []).map((r) => String(r || '').replace(/\\/g, '/')),
  );
  const stagingHasServices = [...injected].some((r) => /^src\/content\/services\/.+\.md$/i.test(r));
  const stagingHasLocations = [...injected].some((r) => /^src\/content\/locations\/.+\.md$/i.test(r));

  const pruneDir = (bucket, enabled) => {
    if (!enabled) return;
    const dir = path.join(siteRoot, 'src', 'content', bucket);
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md') || name.startsWith('_')) continue;
      const rel = `src/content/${bucket}/${name}`;
      if (injected.has(rel)) continue;
      rmSync(path.join(dir, name), { force: true });
      pruned.push(rel);
    }
  };

  pruneDir('services', stagingHasServices);
  pruneDir('locations', stagingHasLocations);
  return pruned;
}

/**
 * Gap-fill services/locations from the template live tree when staging did not
 * provide them (homepage-first). Never wipe or replace files already injected
 * from staging — that undoes sanitized candidate content.
 */
function syncLiveContentCollections(siteRoot, config, injectedRels = []) {
  const synced = [];
  const injected = new Set(
    (injectedRels || []).map((r) => String(r || '').replace(/\\/g, '/')),
  );
  const stagingHasServices = [...injected].some((r) => /^src\/content\/services\/.+\.md$/i.test(r));
  const stagingHasLocations = [...injected].some((r) => /^src\/content\/locations\/.+\.md$/i.test(r));

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

  const writeSanitized = (from, to, rel) => {
    const raw = readFileSync(from, 'utf8');
    const cleaned = sanitizeMarkdownImageFrontmatter(raw);
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, cleaned.endsWith('\n') ? cleaned : `${cleaned}\n`, 'utf8');
    synced.push(rel);
  };

  const liveServices = path.join(ROOT, 'src', 'content', 'services');
  const destServices = path.join(siteRoot, 'src', 'content', 'services');
  if (existsSync(liveServices) && !stagingHasServices) {
    mkdirSync(destServices, { recursive: true });
    // Homepage-only: drop template demo services, then gap-fill allowed stubs
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
      const rel = `src/content/services/${name}`;
      writeSanitized(from, path.join(destServices, name), rel);
    }
  } else if (existsSync(liveServices) && stagingHasServices) {
    // Full stage already injected services — do not pull template demos/stubs
  }

  const liveLocs = path.join(ROOT, 'src', 'content', 'locations');
  const destLocs = path.join(siteRoot, 'src', 'content', 'locations');
  if (existsSync(liveLocs) && !stagingHasLocations) {
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
      const rel = `src/content/locations/${name}`;
      writeSanitized(from, path.join(destLocs, name), rel);
    }
  } else if (existsSync(liveLocs) && stagingHasLocations) {
    // Full stage already injected locations — do not pull template demos/stubs
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
    runGit(['-c', 'user.email=rover@local', '-c', 'user.name=Rover', 'commit', '-m', commitMessage], siteRoot);
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
        label: 'Push Rover template to GitHub (Template repo)',
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
        label: 'Create Cloudflare Workers project (build + npx wrangler deploy)',
        done: Boolean(detail.meta?.cloudflarePagesDone),
        detail: detail.meta?.cfProject || null,
      },
      {
        id: 'dns',
        label: 'Attach custom domain (ops Launch / CF API)',
        done: Boolean(detail.meta?.dnsDone),
      },
      {
        id: 'forms',
        label: 'Paste real web3FormsAccessKey (+ optional Turnstile)',
        done: Boolean(detail.meta?.formsDone),
      },
      {
        id: 'email',
        label: 'Cloudflare Email Routing for leads@ (ops Launch)',
        done: Boolean(detail.meta?.emailRoutingDone),
      },
    ],
  };
}

/**
 * Assemble a sibling site directory from this template + candidate staging.
 * @param {string} candidateId
 * @param {{ force?: boolean, refresh?: boolean, skipGit?: boolean, siteSlug?: string }} [opts]
 *   - force: wipe + full template copy
 *   - refresh: inject staging into existing site when package deps still match template;
 *     falls back to full assemble if site missing or deps drifted
 */
export function assembleSite(
  candidateId,
  { force = false, refresh = false, skipGit = false, siteSlug } = {},
) {
  const t0 = Date.now();
  const staging = getStagingSummary(candidateId);
  if (!staging) {
    const err = new Error('Stage content first (research/{id}/site-staging missing)');
    err.status = 400;
    err.checklist = getAssembleChecklist(candidateId);
    throw err;
  }

  const loaded = loadAcceptedSiteConfig(candidateId);
  const config = loaded?.config || {};
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
  const siteExists = existsSync(siteRoot);

  if (siteExists && !force && !refresh) {
    const err = new Error(
      `Assembled site already exists at ${siteRoot}. Pass force=true to replace or refresh=true to inject staging.`,
    );
    err.status = 409;
    err.siteRoot = siteRoot;
    err.checklist = getAssembleChecklist(candidateId);
    throw err;
  }

  const canRefresh =
    refresh &&
    !force &&
    siteExists &&
    assembledPackageDepsMatchTemplate(siteRoot) &&
    !templateComponentsNewerThanAssembled(siteRoot);
  /** @type {'refresh'|'full'} */
  const mode = canRefresh ? 'refresh' : 'full';
  let nodeModulesRestored = false;
  const fullReason =
    mode === 'full' && refresh && !force
      ? !siteExists
        ? 'missing'
        : !assembledPackageDepsMatchTemplate(siteRoot)
          ? 'deps'
          : templateComponentsNewerThanAssembled(siteRoot)
            ? 'template'
            : 'fallback'
      : force
        ? 'force'
        : mode === 'full'
          ? 'full'
          : null;

  if (mode === 'full') {
    /** @type {{ stashDir: string, depsHash: string } | null} */
    let nmStash = null;
    if (existsSync(siteRoot)) {
      nmStash = stashNodeModules(siteRoot);
      removeAssembledSiteRoot(siteRoot);
    }
    mkdirSync(sitesRoot, { recursive: true });
    copyTemplateTree(siteRoot);
    nodeModulesRestored = restoreOrDiscardNodeModules(siteRoot, nmStash).restored;
  }

  const stagingRoot = pathsFor(candidateId).siteStaging;
  const injected = injectStagingIntoSite(siteRoot, stagingRoot);
  const pruned = pruneUnstagedContentCollections(siteRoot, injected);
  const synced = syncLiveContentCollections(siteRoot, config, injected);

  // Replace Local homeowner trio (and empty socialProof) with Google-style reviews
  const researchSeed = ensureRoverSocialProofSeed(candidateId, config);
  const stagingCfg = path.join(stagingRoot, 'src', 'config', 'site-config.json');
  const assembledCfg = path.join(siteRoot, 'src', 'config', 'site-config.json');
  const stagingSeed = ensureSocialProofOnSiteConfigFile(stagingCfg, config);
  const assembledSeed = ensureSocialProofOnSiteConfigFile(assembledCfg, config);
  // Template already copies public/images/review-avatars/; ensure dir exists after overlay
  const avatarsDir = path.join(siteRoot, 'public', 'images', 'review-avatars');
  const templateAvatars = path.join(ROOT, 'public', 'images', 'review-avatars');
  if (existsSync(templateAvatars) && !existsSync(avatarsDir)) {
    mkdirSync(path.dirname(avatarsDir), { recursive: true });
    cpSync(templateAvatars, avatarsDir, { recursive: true });
  } else if (existsSync(templateAvatars)) {
    // Gap-fill any missing avatar files
    for (const name of readdirSync(templateAvatars)) {
      const from = path.join(templateAvatars, name);
      const to = path.join(avatarsDir, name);
      if (!existsSync(to) && statSync(from).isFile()) {
        mkdirSync(avatarsDir, { recursive: true });
        cpSync(from, to);
      }
    }
  }

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
    assembleMode: mode,
    templateRoot: ROOT,
    templateRemote: getTemplateRemoteInfo(),
    stagingPath: path.relative(ROOT, stagingRoot).replace(/\\/g, '/'),
    injected,
    prunedDemos: pruned,
    syncedContent: synced,
    socialProofSeed: {
      research: researchSeed,
      staging: stagingSeed,
      assembled: assembledSeed,
    },
    nextSteps: [
      `cd ${siteRoot}`,
      'npm install',
      'npm run build',
      'Cloudflare Workers Builds: npm run build + npx wrangler deploy (see docs/ASSEMBLE-AND-LAUNCH.md)',
    ],
  });

  if (!skipGit && mode === 'full') {
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
    mode,
    fullReason,
    ms: Date.now() - t0,
    siteRoot: relPath,
    absoluteSiteRoot: siteRoot,
    slug,
    injected,
    prunedDemos: pruned,
    syncedContent: synced,
    nodeModulesRestored,
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
