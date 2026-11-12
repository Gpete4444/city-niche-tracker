/**
 * Ship assembled site: npm build, GitHub push (gh), Wrangler deploy.
 * Optional Workers Builds GitHub connection (best-effort; needs CF GitHub App + Builds API access).
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { getCandidateDetail, getCandidateShell, launchStampPatch, saveMeta } from './candidates.mjs';
import {
  depsHashMarkerMatches,
  getAssembleChecklist,
  hashPackageDeps,
  syncAcceptedWeb3KeyToAssembled,
  templateStaleLaunchError,
  writeDepsHashMarker,
} from './assemble-site.mjs';
import {
  countFilesRecursive,
  distExceedsWorkersFreeLimit,
  pruneUnreferencedPublicImages,
  WORKERS_FREE_STATIC_FILE_LIMIT,
} from './prune-public-images.mjs';
import {
  cloudflareConfigured,
  cfFetch,
  ensureWorkerCustomDomains,
  getCloudflareCredentials,
} from './cloudflare-launch.mjs';
import { formsInboxStatus, syncFormsAllowlist } from './forms-inbox.mjs';
import {
  pushAssembledSiteToGithubAsync,
  ghAvailable,
  ghAuthStatus,
  resolveGithubOwner,
  diffAssembledAgainstRemote,
} from './github-site.mjs';
import {
  isWorkersFreeCapMessage,
  WORKERS_FREE_CAP_CODE,
  WORKERS_FREE_CAP_NOTE,
} from '../public/workers-free-cap.mjs';

const ROOT = process.cwd();

/**
 * Skip npm install only when the lockfile matches, the Astro command exists,
 * and a package file Astro loads at build time is present.
 * A copied node_modules can match the lockfile and still be missing pieces.
 */
export function shouldSkipNpmInstall(siteRoot) {
  const abs = path.resolve(siteRoot);
  const nmDir = path.join(abs, 'node_modules');
  if (!existsSync(nmDir) || !depsHashMarkerMatches(abs)) return false;
  const shim = path.join(nmDir, '.bin', process.platform === 'win32' ? 'astro.cmd' : 'astro');
  const sentinel = path.join(nmDir, 'shiki', 'dist', 'index.mjs');
  return existsSync(shim) && existsSync(sentinel);
}

/** Delete a copied node_modules that is missing the Astro command or a package it loads. */
export function discardPartialNodeModules(siteRoot) {
  const abs = path.resolve(siteRoot);
  const nmDir = path.join(abs, 'node_modules');
  if (!existsSync(nmDir) || shouldSkipNpmInstall(abs)) return false;
  const shim = path.join(nmDir, '.bin', process.platform === 'win32' ? 'astro.cmd' : 'astro');
  const sentinel = path.join(nmDir, 'shiki', 'dist', 'index.mjs');
  if (existsSync(shim) && existsSync(sentinel)) return false;
  rmSync(nmDir, { recursive: true, force: true });
  return true;
}

function resolveAssembledRoot(detail) {
  const rel = detail.meta?.assembledSitePath;
  if (!rel) return null;
  const abs = path.isAbsolute(rel) ? rel : path.resolve(ROOT, rel);
  return existsSync(abs) ? abs : null;
}

function runNpm(args, cwd, timeoutMs = 600_000, envExtra = {}) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const res = spawnSync(npmCmd, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, ...envExtra },
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  const stdout = String(res.stdout || '');
  const stderr = String(res.stderr || '');
  if (res.status !== 0) {
    const err = new Error(
      `npm ${args.join(' ')} failed (exit ${res.status}): ${(stderr || stdout).slice(-2000)}`,
    );
    err.status = 500;
    err.stdout = stdout;
    err.stderr = stderr;
    throw err;
  }
  return { ok: true, stdout, stderr };
}

/**
 * Non-blocking child process — keeps Express free to serve other Rover tabs.
 */
function runCommandAsync(cmd, args, {
  cwd,
  timeoutMs = 600_000,
  envExtra = {},
  shell = false,
  label,
  failPrefix,
} = {}) {
  const pretty = label || `${cmd} ${args.join(' ')}`;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      shell,
      env: { ...process.env, ...envExtra },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const maxBuf = 20 * 1024 * 1024;
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > maxBuf) stdout = stdout.slice(-maxBuf);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > maxBuf) stderr = stderr.slice(-maxBuf);
    });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      reject(
        Object.assign(new Error(`${pretty} timed out after ${timeoutMs}ms`), {
          status: 500,
          stdout,
          stderr,
        }),
      );
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const err = new Error(
          `${failPrefix || `${pretty} failed`} (exit ${code}): ${(stderr || stdout).slice(-2000)}`,
        );
        err.status = 500;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ ok: true, stdout, stderr });
    });
  });
}

/**
 * Non-blocking npm — allows K>1 heavy jobs to overlap builds.
 */
function runNpmAsync(args, cwd, timeoutMs = 600_000, envExtra = {}) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return runCommandAsync(npmCmd, args, {
    cwd,
    timeoutMs,
    envExtra,
    shell: process.platform === 'win32',
    label: `npm ${args.join(' ')}`,
  });
}

/**
 * npm install (skipped when the lockfile matches and the Astro command is present) + npm run build.
 * Sync — blocks the event loop. Prefer buildAssembledSiteAsync in heavy-job paths.
 * @param {string} siteRoot
 * @param {{ visualEdit?: boolean }} [opts] — set visualEdit for local preview builds only (loads rover-visual-bridge.js)
 */
export function buildAssembledSite(siteRoot, { visualEdit = false } = {}) {
  const t0 = Date.now();
  const abs = path.resolve(siteRoot);
  if (!existsSync(abs)) {
    const err = new Error(`Assembled site not found: ${abs}`);
    err.status = 400;
    throw err;
  }
  const envExtra = visualEdit ? { PUBLIC_ROVER_VE: '1' } : { PUBLIC_ROVER_VE: '' };
  discardPartialNodeModules(abs);
  const skipInstall = shouldSkipNpmInstall(abs);
  if (!skipInstall) {
    runNpm(['install'], abs, 600_000, envExtra);
    writeDepsHashMarker(abs, hashPackageDeps(abs));
  }
  runNpm(['run', 'build'], abs, 600_000, envExtra);
  const hasDist = existsSync(path.join(abs, 'dist', 'index.html'));
  return {
    ok: true,
    built: hasDist,
    siteRoot: abs,
    visualEdit: Boolean(visualEdit),
    npmInstallSkipped: skipInstall,
    buildSkipped: false,
    ms: Date.now() - t0,
  };
}

/**
 * Async npm install + build — does not block other heavy jobs.
 * @param {string} siteRoot
 * @param {{ visualEdit?: boolean }} [opts]
 */
export async function buildAssembledSiteAsync(siteRoot, { visualEdit = false } = {}) {
  const t0 = Date.now();
  const abs = path.resolve(siteRoot);
  if (!existsSync(abs)) {
    const err = new Error(`Assembled site not found: ${abs}`);
    err.status = 400;
    throw err;
  }
  const envExtra = visualEdit ? { PUBLIC_ROVER_VE: '1' } : { PUBLIC_ROVER_VE: '' };
  discardPartialNodeModules(abs);
  const skipInstall = shouldSkipNpmInstall(abs);
  if (!skipInstall) {
    await runNpmAsync(['install'], abs, 600_000, envExtra);
    writeDepsHashMarker(abs, hashPackageDeps(abs));
  }
  await runNpmAsync(['run', 'build'], abs, 600_000, envExtra);
  const hasDist = existsSync(path.join(abs, 'dist', 'index.html'));
  return {
    ok: true,
    built: hasDist,
    siteRoot: abs,
    visualEdit: Boolean(visualEdit),
    npmInstallSkipped: skipInstall,
    buildSkipped: false,
    ms: Date.now() - t0,
  };
}

/**
 * Deploy static Worker via Wrangler (async — does not freeze Rover).
 */
export async function deployAssembledWithWranglerAsync(siteRoot) {
  if (!cloudflareConfigured()) {
    const err = new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN for Wrangler deploy');
    err.status = 400;
    throw err;
  }
  const abs = path.resolve(siteRoot);
  const { accountId, apiToken } = getCloudflareCredentials();
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const { stdout, stderr } = await runCommandAsync(npx, ['wrangler', 'deploy'], {
    cwd: abs,
    timeoutMs: 600_000,
    envExtra: {
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_API_TOKEN: apiToken,
    },
    shell: process.platform === 'win32',
    label: 'wrangler deploy',
    failPrefix: 'wrangler deploy failed',
  });
  return { ok: true, stdout: String(stdout || '').slice(-1500), stderr };
}

/**
 * One implementation: async spawn. Callers must await.
 */
export function deployAssembledWithWrangler(siteRoot) {
  return deployAssembledWithWranglerAsync(siteRoot);
}

/**
 * Best-effort: connect GitHub repo to Workers Builds and create production trigger.
 * Requires Cloudflare GitHub App installed once, and token with Workers Builds / CI write.
 */
export async function connectWorkersBuilds(opts) {
  const { accountId } = getCloudflareCredentials();
  const workerName = String(opts.workerName || '').trim();
  const repoName = String(opts.repoName || '').trim();
  const owner = String(opts.owner || '').trim();
  const repoId = opts.repoId ? String(opts.repoId) : null;
  const ownerId = opts.ownerId ? String(opts.ownerId) : null;
  const human = [];

  if (!workerName || !repoName || !owner || !repoId || !ownerId) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing_ids',
      human: ['Workers Builds connect skipped (need GitHub owner/repo ids).'],
    };
  }

  let connection;
  try {
    connection = await cfFetch('PUT', `/accounts/${accountId}/builds/repos/connections`, {
      provider_type: 'github',
      provider_account_id: String(ownerId),
      provider_account_name: owner,
      repo_id: String(repoId),
      repo_name: repoName,
    });
  } catch (error) {
    return {
      ok: false,
      skipped: true,
      reason: 'connection_failed',
      error: error.message,
      human: [
        `Workers Builds GitHub connection skipped: ${error.message}. Worker was still deployed via Wrangler. Token needs Workers Builds Configuration Edit (you already want Workers Scripts Edit — there is usually no separate "Workers CI" row in the token UI). Then click Connect once in CF → Worker → Settings → Builds to authorize the GitHub App; after that, Launch can auto-link new sites.`,
      ],
    };
  }

  const repoConnectionUuid = connection?.repo_connection_uuid || connection?.uuid;
  human.push('Connected GitHub repo to Cloudflare Workers Builds.');

  // Get worker tag for triggers
  let workerTag = null;
  try {
    const scripts = await cfFetch('GET', `/accounts/${accountId}/workers/scripts`);
    const list = Array.isArray(scripts) ? scripts : [];
    const hit = list.find((s) => s.id === workerName || s.name === workerName);
    workerTag = hit?.tag || null;
  } catch {
    workerTag = null;
  }

  if (!workerTag || !repoConnectionUuid) {
    human.push('Workers Builds connected; create production trigger in dashboard if missing.');
    return { ok: true, connection, human };
  }

  try {
    const tokens = await cfFetch('GET', `/accounts/${accountId}/builds/tokens`);
    const tokenList = Array.isArray(tokens) ? tokens : tokens?.result || [];
    const buildTokenUuid = tokenList[0]?.build_token_uuid || tokenList[0]?.uuid || null;
    if (!buildTokenUuid) {
      human.push('No Builds API token listed — set trigger in CF dashboard if needed.');
      return { ok: true, connection, human };
    }

    await cfFetch('POST', `/accounts/${accountId}/builds/triggers`, {
      trigger_name: `Deploy ${workerName}`,
      build_token_uuid: buildTokenUuid,
      build_command: 'npm run build',
      deploy_command: 'npx wrangler deploy',
      root_directory: '/',
      branch_includes: ['main'],
      branch_excludes: [],
      path_includes: ['*'],
      path_excludes: [],
      build_caching_enabled: true,
      external_script_id: workerTag,
      repo_connection_uuid: repoConnectionUuid,
    });
    human.push('Created Workers Builds production trigger (npm run build + wrangler deploy).');
  } catch (error) {
    human.push(
      `Workers Builds trigger not created automatically (${error.message}). Worker is live via Wrangler; configure Builds in dashboard for push-to-deploy.`,
    );
  }

  return { ok: true, connection, human };
}

/**
 * Labels for ship steps that will actually run given skip flags.
 */
export function listShipProgressSteps(opts = {}) {
  const steps = [];
  if (!opts.skipGithub) steps.push('GitHub create + push…');
  if (!opts.skipBuild) steps.push('npm install + build…');
  if (!opts.skipDeploy) steps.push('Wrangler deploy…');
  if (!opts.skipBuildsConnect && !opts.skipGithub && cloudflareConfigured()) {
    steps.push('Workers Builds…');
  }
  return steps;
}

/**
 * Full ship: commit+push GitHub, build, wrangler deploy, optional Builds connect.
 * @param {string} candidateId
 * @param {{
 *   skipGithub?: boolean,
 *   skipBuild?: boolean,
 *   skipDeploy?: boolean,
 *   skipBuildsConnect?: boolean,
 *   onProgress?: (p: { done: number, total: number, detail: string }) => void,
 * }} [opts]
 */
export async function shipAssembledSite(candidateId, opts = {}) {
  const detail = getCandidateDetail(candidateId);
  const assembledRoot = resolveAssembledRoot(detail);
  if (!assembledRoot) {
    const err = new Error('Assemble the site first (no assembledSitePath)');
    err.status = 400;
    err.checklist = getAssembleChecklist(candidateId);
    throw err;
  }

  const stale = templateStaleLaunchError(assembledRoot);
  if (stale) throw stale;

  const slug = detail.meta?.assembledSiteSlug || path.basename(assembledRoot);
  const web3Sync = syncAcceptedWeb3KeyToAssembled(candidateId, assembledRoot);
  const human = [];
  if (web3Sync.copied) human.push('Copied accepted Web3Forms key onto assembled site-config.');
  const imagePrune = pruneUnreferencedPublicImages(assembledRoot, {
    templateImagesDir: path.join(ROOT, 'public', 'images'),
  });
  human.push(
    `Pruned ${imagePrune.removed} unused public image${imagePrune.removed === 1 ? '' : 's'} (kept ${imagePrune.kept}).`,
  );
  if (imagePrune.locked) {
    human.push(
      `${imagePrune.locked} public image${imagePrune.locked === 1 ? '' : 's'} could not be removed (file locked).`,
    );
  }
  const steps = { images: imagePrune };
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const planned = listShipProgressSteps(opts);
  const total = planned.length;
  let done = 0;
  const tick = (detail) => {
    done += 1;
    onProgress?.({ done, total, detail });
  };

  // 1) GitHub
  if (opts.skipGithub) {
    steps.github = { skipped: true };
    human.push('Skipped GitHub push.');
  } else {
    tick('GitHub create + push…');
    try {
      steps.github = await pushAssembledSiteToGithubAsync(assembledRoot, {
        repoName: slug,
        commitMessage: `Ship ${slug} (${candidateId})`,
      });
      human.push(...(steps.github.human || []));
    } catch (error) {
      steps.github = { ok: false, error: error.message };
      human.push(`GitHub push failed: ${error.message}`);
      const err = new Error(error.message);
      err.status = error.status || 500;
      err.ship = { steps, human };
      throw err;
    }
  }

  // 2) Build
  if (opts.skipBuild) {
    steps.build = { skipped: true };
  } else {
    tick('npm install + build…');
    try {
      steps.build = await buildAssembledSiteAsync(assembledRoot);
      human.push('Built assembled site (npm install && npm run build).');
    } catch (error) {
      steps.build = { ok: false, error: error.message };
      human.push(`Build failed: ${error.message}`);
      const err = new Error(error.message);
      err.status = 500;
      err.ship = { steps, human };
      throw err;
    }
  }

  // 3) Wrangler deploy
  if (opts.skipDeploy) {
    steps.deploy = { skipped: true };
    human.push('Skipped Wrangler deploy.');
  } else {
    tick('Wrangler deploy…');
    const distFiles = countFilesRecursive(path.join(assembledRoot, 'dist'));
    if (distExceedsWorkersFreeLimit(distFiles)) {
      const message = `Deploy skipped: dist has ${distFiles} static files, over the Workers Free limit of ${WORKERS_FREE_STATIC_FILE_LIMIT}.`;
      steps.deploy = { ok: false, error: message, distFiles };
      human.push(message);
    } else {
      try {
        steps.deploy = await deployAssembledWithWranglerAsync(assembledRoot);
        human.push(`Deployed Worker "${slug}" with Wrangler.`);
      } catch (error) {
        const freeCap = isWorkersFreeCapMessage(error.message);
        steps.deploy = {
          ok: false,
          error: error.message,
          ...(freeCap ? { code: WORKERS_FREE_CAP_CODE } : {}),
        };
        human.push(freeCap ? WORKERS_FREE_CAP_NOTE : `Wrangler deploy failed: ${error.message}`);
        // Continue — GitHub may still be useful
      }
    }
  }

  // 4) Builds connect (best-effort)
  if (!opts.skipBuildsConnect && steps.github?.ok && cloudflareConfigured()) {
    tick('Workers Builds…');
    steps.builds = await connectWorkersBuilds({
      workerName: slug,
      repoName: steps.github.repoName,
      owner: steps.github.owner,
      repoId: steps.github.repoId,
      ownerId: steps.github.ownerId,
    });
    human.push(...(steps.builds.human || []));
  }

  const shippedAt = new Date().toISOString();
  const shipOk = Boolean(steps.github?.ok) && (opts.skipDeploy || Boolean(steps.deploy?.ok));
  const metaPatch = {
    lastShipAt: shippedAt,
    githubRepo: steps.github?.fullName || detail.meta?.githubRepo || null,
    githubRepoUrl: steps.github?.repoUrl || detail.meta?.githubRepoUrl || null,
    ...(shipOk
      ? {
          ...launchStampPatch(detail.meta, { ok: true, at: shippedAt }),
          lastLaunchBlocker: null,
          lastLaunchRepoName: null,
        }
      : {}),
  };
  if (steps.deploy?.ok) {
    metaPatch.cloudflarePagesDone = true;
    metaPatch.cfProject = slug;
    if (cloudflareConfigured()) {
      const launchDomain = detail.meta?.launchDomain || detail.siteConfig?.domain || '';
      try {
        steps.domain = await ensureWorkerCustomDomains({
          domain: launchDomain,
          workerName: slug,
        });
        human.push(...(steps.domain.human || []));
        if (steps.domain?.dnsDone) metaPatch.dnsDone = true;
      } catch (error) {
        steps.domain = { ok: false, error: error.message };
        human.push(`Custom domain attach failed: ${error.message}`);
      }
    }
  }
  saveMeta(candidateId, metaPatch);

  if (shipOk && formsInboxStatus().ready) {
    try {
      await syncFormsAllowlist();
    } catch (error) {
      human.push(`Forms allowlist not updated: ${error.message}`);
    }
  }

  return {
    ok: shipOk,
    candidateId,
    slug,
    assembledSitePath: assembledRoot,
    steps,
    human,
    checklist: getAssembleChecklist(candidateId),
    candidate: getCandidateShell(candidateId),
    ghReady: ghAvailable() && ghAuthStatus(),
    githubOwner: resolveGithubOwner(),
  };
}

export function getShipStatus(candidateId) {
  const detail = getCandidateDetail(candidateId);
  const assembledRoot = resolveAssembledRoot(detail);
  return {
    candidateId,
    assembled: Boolean(assembledRoot),
    assembledSitePath: detail.meta?.assembledSitePath || null,
    assembledSiteSlug: detail.meta?.assembledSiteSlug || null,
    githubRepo: detail.meta?.githubRepo || null,
    githubRepoUrl: detail.meta?.githubRepoUrl || null,
    lastShipAt: detail.meta?.lastShipAt || null,
    cloudflarePagesDone: Boolean(detail.meta?.cloudflarePagesDone),
    ghAvailable: ghAvailable(),
    ghAuthenticated: ghAuthStatus(),
    githubOwner: resolveGithubOwner(),
    cloudflareConfigured: cloudflareConfigured(),
  };
}

/**
 * Whether assembled site is ahead of GitHub (and timestamp hint vs lastShipAt).
 * Fetches origin — may be slow; use dedicated GET /ship-diff.
 */
export function getAssembledShipDiff(candidateId) {
  const detail = getCandidateDetail(candidateId);
  const assembledRoot = resolveAssembledRoot(detail);
  const lastAssembleAt = detail.meta?.lastAssembleAt || null;
  const lastShipAt = detail.meta?.lastShipAt || null;
  const assembleNewerThanShip = Boolean(
    lastAssembleAt && (!lastShipAt || new Date(lastAssembleAt) > new Date(lastShipAt)),
  );
  const timestampHint = {
    assembleNewerThanShip,
    lastAssembleAt,
    lastShipAt,
  };

  if (!assembledRoot) {
    return {
      candidateId,
      status: 'no_assembled',
      fetchOk: false,
      dirty: [],
      files: [],
      stat: '',
      summary: 'Assemble the site first.',
      timestampHint,
      githubRepo: detail.meta?.githubRepo || null,
      needsPush: assembleNewerThanShip,
    };
  }

  const githubFullName =
    detail.meta?.githubRepo ||
    (detail.meta?.assembledSiteSlug
      ? `${resolveGithubOwner() || ''}/${detail.meta.assembledSiteSlug}`.replace(/^\//, '')
      : '');

  const diff = diffAssembledAgainstRemote(assembledRoot, { githubFullName });
  const needsPush =
    diff.status === 'behind' ||
    diff.status === 'no_remote' ||
    (diff.status !== 'current' && assembleNewerThanShip);

  let summary = diff.summary;
  if (diff.status === 'current' && assembleNewerThanShip && !(diff.noise || []).length) {
    summary = 'Assembled matches GitHub; Assemble timestamp is newer than last ship (usually already pushed).';
  } else if (diff.status === 'no_remote') {
    summary = assembleNewerThanShip
      ? 'No GitHub remote yet — Push updates will create the repo and publish.'
      : diff.summary;
  }

  return {
    candidateId,
    assembledSitePath: detail.meta?.assembledSitePath || null,
    githubRepo: detail.meta?.githubRepo || null,
    githubRepoUrl: detail.meta?.githubRepoUrl || null,
    ...diff,
    summary,
    timestampHint,
    needsPush: Boolean(needsPush),
  };
}
