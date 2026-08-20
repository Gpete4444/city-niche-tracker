/**
 * Preview an assembled sibling site (astro preview on dist), not the live template.
 *
 * Binds :4322 to the requested siteRoot. If another site (or an unknown process)
 * already owns the port, stop it and restart for this folder — never silently
 * reuse a previous candidate’s preview.
 */

import { spawn, execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { buildAssembledSite } from './ship-site.mjs';

const PREVIEW_HOST = '127.0.0.1';
/** Dedicated port so template live buffer (4321) stays separate. */
const ASSEMBLED_PREVIEW_PORT = 4322;

/** @type {import('node:child_process').ChildProcess | null} */
let previewChild = null;
/** Absolute path of the site currently intended for :4322 */
let boundSiteRoot = null;

function portOpen(port, host = PREVIEW_HOST) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(800, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sameSiteRoot(a, b) {
  if (!a || !b) return false;
  const na = path.resolve(a).replace(/\\/g, '/').toLowerCase();
  const nb = path.resolve(b).replace(/\\/g, '/').toLowerCase();
  return na === nb;
}

function pidsListeningOnPort(port) {
  const pids = new Set();
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
      const needle = `:${port}`;
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes(needle) || !/LISTENING/i.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (/^\d+$/.test(pid) && pid !== '0') pids.add(Number(pid));
      }
    } catch {
      /* ignore */
    }
    return [...pids];
  }
  try {
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' });
    for (const part of out.split(/\s+/)) {
      if (/^\d+$/.test(part)) pids.add(Number(part));
    }
  } catch {
    /* ignore */
  }
  return [...pids];
}

function killPidTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        process.kill(pid, 'SIGTERM');
      }
    }
  } catch {
    /* already gone */
  }
}

/** Stop whatever owns assembled preview (tracked child and/or port listeners). */
export function stopAssembledPreviewSync({ waitMs = 2000 } = {}) {
  const child = previewChild;
  previewChild = null;
  if (child?.pid) killPidTree(child.pid);
  for (const pid of pidsListeningOnPort(ASSEMBLED_PREVIEW_PORT)) {
    killPidTree(pid);
  }
  boundSiteRoot = null;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    // Busy-wait with short sleep so Windows releases directory handles
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    try {
      const still = pidsListeningOnPort(ASSEMBLED_PREVIEW_PORT);
      if (!still.length) return true;
      for (const pid of still) killPidTree(pid);
    } catch {
      return true;
    }
  }
  return pidsListeningOnPort(ASSEMBLED_PREVIEW_PORT).length === 0;
}

/** Async wrapper — prefer this from API routes. */
export async function stopAssembledPreview() {
  const child = previewChild;
  previewChild = null;
  if (child?.pid) killPidTree(child.pid);
  for (const pid of pidsListeningOnPort(ASSEMBLED_PREVIEW_PORT)) {
    killPidTree(pid);
  }
  boundSiteRoot = null;
  for (let i = 0; i < 40; i += 1) {
    if (!(await portOpen(ASSEMBLED_PREVIEW_PORT))) return true;
    await sleep(100);
  }
  return !(await portOpen(ASSEMBLED_PREVIEW_PORT));
}

export function contentNewerThanDist(siteRoot, { ignoreAssembleMeta = false } = {}) {
  const distIndex = path.join(siteRoot, 'dist', 'index.html');
  if (!existsSync(distIndex)) return true;
  const distMtime = statSync(distIndex).mtimeMs;
  const metaFiles = ignoreAssembleMeta
    ? ['src/config/site-config.json', 'src/components/Header.astro']
    : ['_assemble.json', 'src/config/site-config.json', 'src/components/Header.astro'];
  for (const rel of metaFiles) {
    const abs = path.join(siteRoot, ...rel.split('/'));
    if (existsSync(abs) && statSync(abs).mtimeMs > distMtime) return true;
  }
  const contentRoot = path.join(siteRoot, 'src', 'content');
  if (!existsSync(contentRoot)) return false;
  let newest = 0;
  const walk = (d) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, name.name);
      if (name.isDirectory()) walk(abs);
      else {
        const m = statSync(abs).mtimeMs;
        if (m > newest) newest = m;
      }
    }
  };
  walk(contentRoot);
  return newest > distMtime;
}

function startAstroPreview(siteRoot, { timeoutMs = 90000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      [
        'astro',
        'preview',
        '--host',
        PREVIEW_HOST,
        '--port',
        String(ASSEMBLED_PREVIEW_PORT),
      ],
      {
        cwd: siteRoot,
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      },
    );
    previewChild = child;
    if (process.platform !== 'win32') {
      try {
        child.unref();
      } catch {
        /* ignore */
      }
    }

    let settled = false;
    let out = '';
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, error, output: out.slice(-800), pid: child.pid || null });
    };

    const timer = setTimeout(() => {
      finish(false, `Timed out starting assembled preview (${timeoutMs}ms)`);
    }, timeoutMs);

    const onChunk = (d) => {
      out += String(d);
      if (/localhost|127\.0\.0\.1|preview|local/i.test(out) && /http/i.test(out)) {
        finish(true);
      }
    };
    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
    child.on('error', (err) => finish(false, err.message || String(err)));
    child.on('close', async () => {
      if (previewChild === child) previewChild = null;
      if (settled) return;
      for (let i = 0; i < 30; i += 1) {
        if (await portOpen(ASSEMBLED_PREVIEW_PORT)) {
          finish(true);
          return;
        }
        await sleep(250);
      }
      finish(
        false,
        `astro preview exited before port ${ASSEMBLED_PREVIEW_PORT} opened: ${out.slice(-400)}`,
      );
    });
  });
}

/**
 * Ensure assembled site dist exists and preview server is up for THIS siteRoot.
 * @param {string} siteRoot absolute assembled folder
 */
export async function ensureAssembledPreview(
  siteRoot,
  { rebuild = false, forceRebind = false, timeoutMs = 120000 } = {},
) {
  const abs = path.resolve(siteRoot);
  const url = `http://${PREVIEW_HOST}:${ASSEMBLED_PREVIEW_PORT}/`;
  if (!existsSync(abs)) {
    return {
      ok: false,
      url,
      started: false,
      rebound: false,
      error: `Assembled site not found: ${abs}`,
      assembledSitePath: abs,
    };
  }

  const portBusy = await portOpen(ASSEMBLED_PREVIEW_PORT);
  const alreadyBound = sameSiteRoot(boundSiteRoot, abs);
  // Unknown binding + busy port ⇒ treat as wrong site (classic stale preview bug)
  const needsRebind = forceRebind || !portBusy || !alreadyBound;

  let build = null;
  const shouldRebuild = rebuild || contentNewerThanDist(abs);
  if (shouldRebuild) {
    try {
      build = buildAssembledSite(abs, { visualEdit: true });
    } catch (error) {
      return {
        ok: false,
        url,
        started: false,
        rebound: false,
        build: { ok: false, error: error.message },
        error: error.message,
        assembledSitePath: abs,
      };
    }
  }

  if (!needsRebind && portBusy) {
    return {
      ok: true,
      url,
      started: false,
      rebound: false,
      build,
      port: ASSEMBLED_PREVIEW_PORT,
      boundSiteRoot: abs,
      assembledSitePath: abs,
    };
  }

  if (portBusy || previewChild) {
    await stopAssembledPreview();
  }

  const start = await startAstroPreview(abs, { timeoutMs: Math.min(timeoutMs, 90000) });
  if (!start.ok && !(await portOpen(ASSEMBLED_PREVIEW_PORT))) {
    boundSiteRoot = null;
    return {
      ok: false,
      url,
      started: false,
      rebound: true,
      build,
      error: start.error || 'Failed to start assembled Astro preview',
      assembledSitePath: abs,
    };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(ASSEMBLED_PREVIEW_PORT)) {
      boundSiteRoot = abs;
      return {
        ok: true,
        url,
        started: true,
        rebound: true,
        build,
        port: ASSEMBLED_PREVIEW_PORT,
        boundSiteRoot: abs,
        assembledSitePath: abs,
      };
    }
    await sleep(400);
  }

  return {
    ok: false,
    url,
    started: Boolean(start.ok),
    rebound: true,
    build,
    error: `Assembled preview did not become ready on ${url}`,
    assembledSitePath: abs,
  };
}

export function getAssembledPreviewBinding() {
  return {
    port: ASSEMBLED_PREVIEW_PORT,
    boundSiteRoot,
    url: `http://${PREVIEW_HOST}:${ASSEMBLED_PREVIEW_PORT}/`,
  };
}

export const ASSEMBLED_PREVIEW_URL = `http://${PREVIEW_HOST}:${ASSEMBLED_PREVIEW_PORT}/`;
