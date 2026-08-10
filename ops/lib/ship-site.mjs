/**
 * Ship assembled site: npm build, GitHub push (gh), Wrangler deploy.
 * Optional Workers Builds GitHub connection (best-effort; needs CF GitHub App + Builds API access).
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { getCandidateDetail, saveMeta } from './candidates.mjs';
import { getAssembleChecklist } from './assemble-site.mjs';
import { cloudflareConfigured, cfFetch, getCloudflareCredentials } from './cloudflare-launch.mjs';
import { pushAssembledSiteToGithub, ghAvailable, ghAuthStatus, resolveGithubOwner } from './github-site.mjs';

const ROOT = process.cwd();

function resolveAssembledRoot(detail) {
  const rel = detail.meta?.assembledSitePath;
  if (!rel) return null;
  const abs = path.isAbsolute(rel) ? rel : path.resolve(ROOT, rel);
  return existsSync(abs) ? abs : null;
}

function runNpm(args, cwd, timeoutMs = 600_000) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const res = spawnSync(npmCmd, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: process.env,
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
 * npm install + npm run build in assembled folder.
 */
export function buildAssembledSite(siteRoot) {
  const abs = path.resolve(siteRoot);
  if (!existsSync(abs)) {
    const err = new Error(`Assembled site not found: ${abs}`);
    err.status = 400;
    throw err;
  }
  runNpm(['install'], abs);
  runNpm(['run', 'build'], abs);
  const hasDist = existsSync(path.join(abs, 'dist', 'index.html'));
  return { ok: true, built: hasDist, siteRoot: abs };
}

/**
 * Deploy static Worker via Wrangler (creates Worker if missing).
 */
export function deployAssembledWithWrangler(siteRoot) {
  if (!cloudflareConfigured()) {
    const err = new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN for Wrangler deploy');
    err.status = 400;
    throw err;
  }
  const abs = path.resolve(siteRoot);
  const { accountId, apiToken } = getCloudflareCredentials();
  const env = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_API_TOKEN: apiToken,
  };
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const res = spawnSync(npx, ['wrangler', 'deploy'], {
    cwd: abs,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env,
    timeout: 600_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  const stdout = String(res.stdout || '');
  const stderr = String(res.stderr || '');
  if (res.status !== 0) {
    const err = new Error(
      `wrangler deploy failed (exit ${res.status}): ${(stderr || stdout).slice(-2000)}`,
    );
    err.status = 500;
    err.stdout = stdout;
    err.stderr = stderr;
    throw err;
  }
  return { ok: true, stdout: stdout.slice(-1500), stderr };
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
 * Full ship: commit+push GitHub, build, wrangler deploy, optional Builds connect.
 * @param {string} candidateId
 * @param {{ skipGithub?: boolean, skipBuild?: boolean, skipDeploy?: boolean, skipBuildsConnect?: boolean }} [opts]
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

  const slug = detail.meta?.assembledSiteSlug || path.basename(assembledRoot);
  const human = [];
  const steps = {};

  // 1) GitHub
  if (opts.skipGithub) {
    steps.github = { skipped: true };
    human.push('Skipped GitHub push.');
  } else {
    try {
      steps.github = pushAssembledSiteToGithub(assembledRoot, {
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
    try {
      steps.build = buildAssembledSite(assembledRoot);
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
    try {
      steps.deploy = deployAssembledWithWrangler(assembledRoot);
      human.push(`Deployed Worker "${slug}" with Wrangler.`);
    } catch (error) {
      steps.deploy = { ok: false, error: error.message };
      human.push(`Wrangler deploy failed: ${error.message}`);
      // Continue — GitHub may still be useful
    }
  }

  // 4) Builds connect (best-effort)
  if (!opts.skipBuildsConnect && steps.github?.ok && cloudflareConfigured()) {
    steps.builds = await connectWorkersBuilds({
      workerName: slug,
      repoName: steps.github.repoName,
      owner: steps.github.owner,
      repoId: steps.github.repoId,
      ownerId: steps.github.ownerId,
    });
    human.push(...(steps.builds.human || []));
  }

  const metaPatch = {
    lastShipAt: new Date().toISOString(),
    githubRepo: steps.github?.fullName || detail.meta?.githubRepo || null,
    githubRepoUrl: steps.github?.repoUrl || detail.meta?.githubRepoUrl || null,
  };
  if (steps.deploy?.ok) {
    metaPatch.cloudflarePagesDone = true;
    metaPatch.cfProject = slug;
  }
  saveMeta(candidateId, metaPatch);

  return {
    ok: Boolean(steps.github?.ok) && (opts.skipDeploy || Boolean(steps.deploy?.ok)),
    candidateId,
    slug,
    assembledSitePath: assembledRoot,
    steps,
    human,
    checklist: getAssembleChecklist(candidateId),
    candidate: getCandidateDetail(candidateId),
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
