/**
 * Push an assembled site folder to GitHub via `gh` (no manual git/gh for the user).
 * Requires `gh` CLI authenticated (`gh auth login`).
 */

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

function run(cmd, args, cwd, { allowFail = false } = {}) {
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: process.env,
    });
    return { ok: true, stdout: String(out || '').trim(), stderr: '' };
  } catch (error) {
    const stdout = String(error?.stdout || '').trim();
    const stderr = String(error?.stderr || '').trim();
    const detail = stderr || stdout || String(error?.message || error);
    if (allowFail) return { ok: false, stdout, stderr: detail };
    const err = new Error(detail || `${cmd} ${args.join(' ')} failed`);
    err.status = 500;
    err.stdout = stdout;
    err.stderr = detail;
    throw err;
  }
}

function runGit(args, cwd, opts) {
  return run('git', args, cwd, opts);
}

export function ghAvailable() {
  const r = run('gh', ['--version'], process.cwd(), { allowFail: true });
  return r.ok;
}

export function ghAuthStatus() {
  const r = run('gh', ['auth', 'status'], process.cwd(), { allowFail: true });
  return r.ok;
}

/**
 * Resolve GitHub owner (user or org) for new site repos.
 */
export function resolveGithubOwner() {
  const fromEnv = String(process.env.GITHUB_OWNER || '').trim();
  if (fromEnv) return fromEnv;

  const template = String(process.env.TEMPLATE_GITHUB_REPO || '').trim();
  if (template.includes('/')) return template.split('/')[0];

  const r = run('gh', ['api', 'user', '-q', '.login'], process.cwd(), { allowFail: true });
  if (r.ok && r.stdout) return r.stdout.trim();

  return null;
}

function remoteUrl(cwd) {
  const r = runGit(['remote', 'get-url', 'origin'], cwd, { allowFail: true });
  return r.ok ? r.stdout : null;
}

function ensureCommit(siteRoot, message) {
  runGit(['add', '-A'], siteRoot);
  const commit = runGit(
    ['-c', 'user.email=rover@local', '-c', 'user.name=Rover', 'commit', '-m', message],
    siteRoot,
    { allowFail: true },
  );
  const combined = `${commit.stdout || ''}\n${commit.stderr || ''}`;
  if (!commit.ok && !/nothing to commit/i.test(combined)) {
    throw new Error(commit.stderr || commit.stdout || 'git commit failed');
  }
  return { committed: commit.ok };
}

function isNonFastForward(detail = '') {
  return /non-fast-forward|fetch first|\[rejected\].*main|updates were rejected/i.test(detail);
}

/**
 * Push main; if remote diverged, fetch + force-with-lease (assembled site is source of truth).
 */
function pushMainWithLease(abs, human) {
  const push = runGit(['push', '-u', 'origin', 'main'], abs, { allowFail: true });
  if (push.ok) return push;

  const detail = `${push.stderr || ''}\n${push.stdout || ''}`;
  if (!isNonFastForward(detail)) {
    const push2 = runGit(['push', '--set-upstream', 'origin', 'main'], abs, { allowFail: true });
    if (push2.ok) return push2;
    const err = new Error(push2.stderr || push.stderr || 'git push failed');
    err.status = 500;
    throw err;
  }

  runGit(['fetch', 'origin'], abs, { allowFail: true });
  const forced = runGit(['push', '--force-with-lease', 'origin', 'main'], abs, { allowFail: true });
  if (!forced.ok) {
    const err = new Error(
      forced.stderr ||
        push.stderr ||
        'git push --force-with-lease failed (remote may have new commits; retry Assemble/Ship)',
    );
    err.status = 500;
    throw err;
  }
  human.push('Pushed with --force-with-lease (remote main diverged; local assemble wins).');
  return forced;
}

/**
 * Create GitHub repo if needed and push main.
 * @param {string} siteRoot absolute path
 * @param {{ repoName: string, owner?: string, private?: boolean, commitMessage?: string }} opts
 */
export function pushAssembledSiteToGithub(siteRoot, opts = {}) {
  const abs = path.resolve(siteRoot);
  if (!existsSync(abs)) {
    const err = new Error(`Assembled site not found: ${abs}`);
    err.status = 400;
    throw err;
  }
  if (!ghAvailable()) {
    const err = new Error('GitHub CLI `gh` not found. Install from https://cli.github.com and run gh auth login once.');
    err.status = 400;
    throw err;
  }
  if (!ghAuthStatus()) {
    const err = new Error('GitHub CLI not authenticated. Run `gh auth login` once on this machine.');
    err.status = 400;
    throw err;
  }

  const repoName = String(opts.repoName || path.basename(abs)).trim();
  const owner = String(opts.owner || resolveGithubOwner() || '').trim();
  if (!owner) {
    const err = new Error('Could not resolve GitHub owner. Set GITHUB_OWNER=your-org-or-user in .env');
    err.status = 400;
    throw err;
  }

  const fullName = `${owner}/${repoName}`;
  const isPrivate = opts.private !== false;
  const human = [];
  const commitMessage = opts.commitMessage || `Launch update for ${repoName}`;

  if (!existsSync(path.join(abs, '.git'))) {
    runGit(['init'], abs);
    runGit(['branch', '-M', 'main'], abs);
  } else {
    runGit(['branch', '-M', 'main'], abs, { allowFail: true });
  }

  ensureCommit(abs, commitMessage);

  let existing = remoteUrl(abs);
  let created = false;

  if (!existing) {
    const createArgs = [
      'repo',
      'create',
      fullName,
      isPrivate ? '--private' : '--public',
      '--source=.',
      '--remote=origin',
      '--push',
    ];
    const createdRes = run('gh', createArgs, abs, { allowFail: true });
    if (!createdRes.ok) {
      // Repo may already exist remotely — add remote and push
      if (/already exists|Name already exists/i.test(createdRes.stderr || '')) {
        runGit(['remote', 'add', 'origin', `https://github.com/${fullName}.git`], abs, {
          allowFail: true,
        });
        pushMainWithLease(abs, human);
        human.push(`Used existing GitHub repo ${fullName} and pushed main.`);
      } else {
        const err = new Error(createdRes.stderr || `gh repo create ${fullName} failed`);
        err.status = 500;
        throw err;
      }
    } else {
      created = true;
      human.push(`Created and pushed GitHub repo ${fullName}.`);
    }
    existing = remoteUrl(abs) || `https://github.com/${fullName}.git`;
  } else {
    pushMainWithLease(abs, human);
    human.push(`Pushed to existing remote ${existing}.`);
  }

  // Resolve numeric repo id for CF Builds (best-effort)
  let repoId = null;
  const repoApi = run('gh', ['api', `repos/${fullName}`, '-q', '.id'], abs, { allowFail: true });
  if (repoApi.ok) repoId = String(repoApi.stdout || '').trim() || null;

  let ownerId = null;
  const ownerApi = run('gh', ['api', `users/${owner}`, '-q', '.id'], abs, { allowFail: true });
  if (ownerApi.ok) ownerId = String(ownerApi.stdout || '').trim() || null;

  return {
    ok: true,
    owner,
    repoName,
    fullName,
    repoUrl: `https://github.com/${fullName}`,
    remoteUrl: existing,
    repoId,
    ownerId,
    created,
    human,
  };
}
