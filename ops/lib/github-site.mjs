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

const DIFF_FILE_CAP = 80;
const DIFF_DIRTY_CAP = 40;
const DIFF_STAT_CAP = 4000;

/** Assemble receipt — rewritten on Prepare preview refresh; not a site publish signal. */
const SHIP_DIFF_NOISE_PATHS = new Set(['_assemble.json']);

function normalizeShipDiffPath(p) {
  return String(p || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

function isShipDiffNoisePath(p) {
  return SHIP_DIFF_NOISE_PATHS.has(normalizeShipDiffPath(p));
}

/** Porcelain line → path (handles ` M file`, `?? file`, `R  a -> b`).
 * `run()` trims stdout, so the first line may lose a leading blank status column. */
function porcelainPath(line) {
  const s = String(line || '');
  if (!s.trim()) return '';
  const fromPath = (pathPart) => {
    const arrow = pathPart.lastIndexOf(' -> ');
    const p = arrow >= 0 ? pathPart.slice(arrow + 4) : pathPart;
    return p.trim().replace(/^"+|"+$/g, '');
  };
  // Standard: two status cols + space + path
  const std = s.match(/^(.{2}) (.*)$/);
  if (std) return fromPath(std[2]);
  // After stdout trim ate a leading space: `M _assemble.json`
  const trimmed = s.match(/^([MADRCU?!]) (.*)$/);
  if (trimmed) return fromPath(trimmed[2]);
  return s.trim().replace(/^"+|"+$/g, '');
}

function partitionShipDiffDirty(lines) {
  const meaningful = [];
  const noise = [];
  for (const line of lines) {
    const p = porcelainPath(line);
    if (isShipDiffNoisePath(p)) noise.push(normalizeShipDiffPath(p));
    else meaningful.push(line);
  }
  return { meaningful, noise };
}

function partitionShipDiffFiles(files) {
  const meaningful = [];
  const noise = [];
  for (const f of files || []) {
    if (isShipDiffNoisePath(f?.path)) noise.push(f);
    else meaningful.push(f);
  }
  return { meaningful, noise };
}

/**
 * Ensure origin points at the known GitHub repo (force Assemble wipes remotes).
 * Does not create the repo — only attaches remote for fetch/diff.
 */
function ensureOriginRemote(siteRoot, githubFullName) {
  const abs = path.resolve(siteRoot);
  const existing = remoteUrl(abs);
  if (existing) return { ok: true, remoteUrl: existing, added: false };

  const full = String(githubFullName || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
  if (!full || !full.includes('/')) {
    return { ok: false, remoteUrl: null, added: false };
  }
  const url = `https://github.com/${full}.git`;
  const add = runGit(['remote', 'add', 'origin', url], abs, { allowFail: true });
  if (!add.ok) {
    // Remote name exists but URL missing/broken — try set-url
    runGit(['remote', 'set-url', 'origin', url], abs, { allowFail: true });
  }
  const after = remoteUrl(abs);
  return { ok: Boolean(after), remoteUrl: after, added: true };
}

/**
 * Compare assembled site working tree / HEAD to origin/main after fetch.
 * Tree diff (not ancestry) — force Assemble rewrites history.
 *
 * @param {string} siteRoot
 * @param {{ githubFullName?: string }} [opts]
 */
export function diffAssembledAgainstRemote(siteRoot, opts = {}) {
  const abs = path.resolve(siteRoot);
  if (!existsSync(abs)) {
    return {
      status: 'no_assembled',
      fetchOk: false,
      dirty: [],
      files: [],
      stat: '',
      summary: 'Assembled site folder not found.',
      remoteUrl: null,
    };
  }
  if (!existsSync(path.join(abs, '.git'))) {
    return {
      status: 'unknown',
      fetchOk: false,
      dirty: [],
      files: [],
      stat: '',
      summary: 'Assembled site has no git repo yet.',
      remoteUrl: null,
    };
  }

  const ensured = ensureOriginRemote(abs, opts.githubFullName);
  let origin = remoteUrl(abs);
  if (!origin) {
    return {
      status: 'no_remote',
      fetchOk: false,
      dirty: [],
      files: [],
      stat: '',
      summary: 'No GitHub remote yet — first Push / Launch will create it.',
      remoteUrl: null,
      remoteAttached: ensured.added,
    };
  }

  const fetch = runGit(['fetch', 'origin'], abs, { allowFail: true });
  const fetchOk = fetch.ok;

  const porcelain = runGit(['status', '--porcelain'], abs, { allowFail: true });
  const dirtyAll = String(porcelain.stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);

  const hasRemoteMain = runGit(['rev-parse', '--verify', 'origin/main'], abs, { allowFail: true });
  if (!hasRemoteMain.ok) {
    const { meaningful: dirty, noise: dirtyNoise } = partitionShipDiffDirty(dirtyAll);
    return {
      status: 'behind',
      fetchOk,
      dirty: dirty.slice(0, DIFF_DIRTY_CAP),
      files: [],
      noise: dirtyNoise.slice(0, DIFF_DIRTY_CAP),
      stat: '',
      summary: fetchOk
        ? 'Remote has no main branch yet — Push updates to publish.'
        : `Could not fetch origin (${(fetch.stderr || 'network/auth').slice(0, 120)}). Local changes may still need Push.`,
      remoteUrl: origin,
      remoteAttached: ensured.added,
    };
  }

  const nameStatus = runGit(['diff', '--name-status', 'origin/main'], abs, { allowFail: true });
  const filesAll = String(nameStatus.stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      if (tab < 0) return { status: '?', path: line };
      return { status: line.slice(0, tab).trim(), path: line.slice(tab + 1).trim() };
    });

  const { meaningful: files, noise: fileNoise } = partitionShipDiffFiles(filesAll);
  const { meaningful: dirty, noise: dirtyNoise } = partitionShipDiffDirty(dirtyAll);
  const noise = [...new Set([...dirtyNoise, ...fileNoise.map((f) => f.path)].filter(Boolean))].slice(
    0,
    DIFF_DIRTY_CAP,
  );

  const meaningfulFiles = files.slice(0, DIFF_FILE_CAP);
  const meaningfulDirty = dirty.slice(0, DIFF_DIRTY_CAP);

  let stat = '';
  if (meaningfulFiles.length) {
    const statRes = runGit(['diff', '--stat', 'origin/main', '--', ...meaningfulFiles.map((f) => f.path)], abs, {
      allowFail: true,
    });
    stat = String(statRes.stdout || '').trim();
    if (stat.length > DIFF_STAT_CAP) stat = `${stat.slice(0, DIFF_STAT_CAP)}\n…`;
  }

  const behind = meaningfulDirty.length > 0 || meaningfulFiles.length > 0;
  let summary;
  if (behind) {
    summary =
      meaningfulDirty.length && !meaningfulFiles.length
        ? 'Assembled has uncommitted local changes — Push updates will commit and publish.'
        : `Assembled differs from GitHub (${meaningfulFiles.length || meaningfulDirty.length} path${
            (meaningfulFiles.length || meaningfulDirty.length) === 1 ? '' : 's'
          }) — Push updates.`;
  } else if (noise.length) {
    summary =
      'Assembled matches GitHub (local assemble receipt only — no publish needed).';
  } else {
    summary = 'Assembled matches GitHub origin/main.';
  }

  return {
    status: behind ? 'behind' : 'current',
    fetchOk,
    dirty: meaningfulDirty,
    files: meaningfulFiles,
    noise,
    stat,
    summary,
    remoteUrl: origin,
    remoteAttached: ensured.added,
    truncated: {
      dirty: dirty.length >= DIFF_DIRTY_CAP,
      files: files.length >= DIFF_FILE_CAP,
    },
  };
}

