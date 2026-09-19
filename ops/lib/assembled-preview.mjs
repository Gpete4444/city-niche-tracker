/**
 * Preview assembled sibling sites (astro preview on dist).
 *
 * Port pool (default base 4322): slot count comes from Concurrent Limit
 * (assembledPreviews, default 5, max 8). When the pool is full, the oldest
 * other binding is evicted. Idle bindings stop after ASSEMBLED_PREVIEW_IDLE_MS
 * (default 15 min).
 */

import { spawn, execFileSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createConnection, createServer } from 'node:net';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { buildAssembledSiteAsync } from './ship-site.mjs';
import { getConcurrency } from './rover-concurrency.mjs';

const PREVIEW_HOST = '127.0.0.1';
/** Truthy so Astro 7 `isRunByAgent()` does not auto `--background` and exit the child. */
export const ASTRO_PREVIEW_BACKGROUND_SENTINEL = 'rover';
const PORT_BASE = Math.max(
  1024,
  Number(process.env.ASSEMBLED_PREVIEW_PORT_BASE || 4322) || 4322,
);
const PREVIEW_SLOTS_HARD_MAX = 8;

export function assembledPreviewSlotCount() {
  const n = Number(getConcurrency().assembledPreviews);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(PREVIEW_SLOTS_HARD_MAX, Math.round(n)));
}
const IDLE_MS = Math.max(
  60_000,
  Number(process.env.ASSEMBLED_PREVIEW_IDLE_MS || 15 * 60 * 1000) || 15 * 60 * 1000,
);

/**
 * @typedef {{ port: number, siteRoot: string, child: import('node:child_process').ChildProcess | null, touchedAt: number }} PreviewSlot
 */

/** @type {Map<string, PreviewSlot>} siteRoot key → slot */
const bindings = new Map();
let idleTimer = null;

function ensureIdleEvict() {
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    const now = Date.now();
    for (const slot of [...bindings.values()]) {
      if (now - (slot.touchedAt || 0) > IDLE_MS) {
        stopAssembledPreview(slot.siteRoot).catch(() => {});
      }
    }
  }, 60_000);
  idleTimer.unref?.();
}

function normRoot(siteRoot) {
  return path.resolve(siteRoot).replace(/\\/g, '/').toLowerCase();
}

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

/**
 * HTTP GET on the reserved preview URL. Any HTTP response means the server is up
 * (2xx / 3xx / 404). TCP accept alone is not enough — Vite can hop ports.
 * @param {number} port
 * @param {string} [host]
 * @returns {Promise<boolean>}
 */
export function previewHttpReady(port, host = PREVIEW_HOST) {
  return new Promise((resolve) => {
    const req = httpRequest(
      {
        host,
        port,
        path: '/',
        method: 'GET',
        timeout: 1500,
      },
      (res) => {
        res.resume();
        const code = Number(res.statusCode || 0);
        resolve(Number.isFinite(code) && code > 0);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/**
 * True when this process can bind the reserved preview port (not just connect).
 * Windows TIME_WAIT can fail bind after portOpen looks free.
 * @param {number} port
 * @param {string} [host]
 * @returns {Promise<boolean>}
 */
export function portBindable(port, host = PREVIEW_HOST) {
  return new Promise((resolve) => {
    const server = createServer();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try {
        server.close(() => resolve(ok));
      } catch {
        resolve(ok);
      }
    };
    server.once('error', () => finish(false));
    server.listen({ host, port, exclusive: true }, () => finish(true));
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Local column from `netstat -ano` (`127.0.0.1:4322` or `[::1]:4322`). */
export function parseLocalAddressPort(localAddr) {
  const m = String(localAddr || '').trim().match(/:(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Vite hopped off the reserved port (`trying another one` / Local URL).
 * @param {string} output
 * @param {number} reservedPort
 * @returns {number | null}
 */
export function parsePreviewHopPort(output, reservedPort) {
  const text = String(output || '');
  const local = text.match(/https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/i);
  const hopped = Number(local?.[1]);
  const mentioned = /trying another one/i.test(text);
  if (Number.isFinite(hopped) && hopped > 0 && hopped !== reservedPort) return hopped;
  if (mentioned) return Number.isFinite(hopped) && hopped > 0 ? hopped : null;
  return null;
}

function astroBin(siteRoot) {
  return path.join(siteRoot, 'node_modules', 'astro', 'bin', 'astro.mjs');
}

function previewLockPath(siteRoot) {
  return path.join(siteRoot, '.astro', 'preview.json');
}

function previewEnv() {
  return { ...process.env, ASTRO_PREVIEW_BACKGROUND: ASTRO_PREVIEW_BACKGROUND_SENTINEL };
}

function readPreviewLock(siteRoot) {
  const lock = previewLockPath(siteRoot);
  if (!existsSync(lock)) return null;
  try {
    const data = JSON.parse(readFileSync(lock, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function readPreviewLockPid(siteRoot) {
  const pid = Number(readPreviewLock(siteRoot)?.pid);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function previewHtmlSnippet(port) {
  return new Promise((resolve) => {
    const req = httpRequest(
      { host: PREVIEW_HOST, port, path: '/', method: 'GET', timeout: 1500 },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 8000) {
            res.destroy();
            resolve(body);
          }
        });
        res.on('end', () => resolve(body));
      },
    );
    req.on('error', () => resolve(''));
    req.on('timeout', () => {
      req.destroy();
      resolve('');
    });
    req.end();
  });
}

async function previewServesThisSite(port, siteRoot) {
  if (!(await previewHttpReady(port))) return false;
  const lockPort = Number(readPreviewLock(siteRoot)?.port);
  if (lockPort === port) return true;
  try {
    const cfgPath = path.join(siteRoot, 'src', 'config', 'site-config.json');
    if (!existsSync(cfgPath)) return false;
    const domain = String(JSON.parse(readFileSync(cfgPath, 'utf8'))?.domain || '').trim();
    if (!domain) return false;
    const html = await previewHtmlSnippet(port);
    return html.toLowerCase().includes(domain.toLowerCase());
  } catch {
    return false;
  }
}

function clearPreviewLock(siteRoot) {
  try {
    const lock = previewLockPath(siteRoot);
    if (existsSync(lock)) unlinkSync(lock);
  } catch {
    /* ignore */
  }
}

/** Best-effort `astro preview stop` + lock PID kill + delete `.astro/preview.json`. */
function stopAstroPreviewCli(siteRoot) {
  if (!siteRoot) return;
  const abs = path.resolve(siteRoot);
  const bin = astroBin(abs);
  if (existsSync(bin)) {
    try {
      execFileSync(process.execPath, [bin, 'preview', 'stop'], {
        cwd: abs,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 8000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: previewEnv(),
      });
    } catch {
      /* ignore */
    }
  }
  const pid = readPreviewLockPid(abs);
  if (pid) killPidTree(pid);
  clearPreviewLock(abs);
}

async function waitUntilPortFree(port, { timeoutMs = 8000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const pid of pidsListeningOnPort(port)) killPidTree(pid);
    if (await portBindable(port)) return true;
    await sleep(200);
  }
  return portBindable(port);
}

function formatPreviewOutput(out) {
  const tail = String(out || '').trim().slice(-400);
  return tail ? `: ${tail}` : '';
}

function sameSiteRoot(a, b) {
  if (!a || !b) return false;
  return normRoot(a) === normRoot(b);
}

function pidsListeningOnPort(port) {
  const pids = new Set();
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;
        const localPort = parseLocalAddressPort(parts[1]);
        if (localPort !== port) continue;
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
  const self = process.pid;
  const parent = typeof process.ppid === 'number' ? process.ppid : 0;
  if (pid === self || (parent && pid === parent)) return;
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

/**
 * Kill processes whose CommandLine mentions this site folder (orphaned astro/npm).
 * Never kills Rover itself. Main-thread only.
 * @param {string} siteRoot
 * @returns {number} kill attempts
 */
export function killProcessesHoldingSitePath(siteRoot) {
  const abs = path.resolve(siteRoot);
  if (!abs) return 0;
  const needle = abs.replace(/\//g, '\\').toLowerCase();
  const needleAlt = abs.replace(/\\/g, '/').toLowerCase();
  const self = process.pid;
  const parent = typeof process.ppid === 'number' ? process.ppid : 0;
  const protectedPids = new Set([self, parent, 0].filter(Boolean));
  let killed = 0;

  if (process.platform === 'win32') {
    try {
      const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$needles = @(${JSON.stringify(needle)}, ${JSON.stringify(needleAlt)})
Get-CimInstance Win32_Process | ForEach-Object {
  $cl = [string]$_.CommandLine
  if (-not $cl) { return }
  $low = $cl.ToLowerInvariant()
  $hit = $false
  foreach ($n in $needles) { if ($n -and $low.Contains($n)) { $hit = $true; break } }
  if (-not $hit) { return }
  $procId = [int]$_.ProcessId
  if (${self} -eq $procId) { return }
  if (${parent} -gt 0 -and $procId -eq ${parent}) { return }
  Write-Output $procId
}
`;
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', ps],
        { encoding: 'utf8', windowsHide: true, timeout: 15000 },
      );
      for (const line of String(out || '').split(/\r?\n/)) {
        const pid = Number(String(line).trim());
        if (!Number.isFinite(pid) || protectedPids.has(pid)) continue;
        killPidTree(pid);
        killed += 1;
      }
    } catch {
      /* ignore */
    }
    return killed;
  }

  try {
    const out = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
    for (const line of out.split(/\n/)) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      const args = m[2].toLowerCase();
      if (!Number.isFinite(pid) || protectedPids.has(pid)) continue;
      if (!args.includes(needleAlt) && !args.includes(path.basename(abs).toLowerCase())) continue;
      if (!args.includes('node') && !args.includes('astro') && !args.includes('npm')) continue;
      killPidTree(pid);
      killed += 1;
    }
  } catch {
    /* ignore */
  }
  return killed;
}

function usedPorts() {
  return new Set([...bindings.values()].map((s) => s.port));
}

function bindingForPort(port) {
  for (const slot of bindings.values()) {
    if (slot.port === port) return slot;
  }
  return null;
}

function claimPort(siteRoot, port, extra = {}) {
  const abs = path.resolve(siteRoot);
  bindings.set(normRoot(abs), {
    port,
    siteRoot: abs,
    child: extra.child ?? null,
    touchedAt: Date.now(),
    reserved: true,
    ...extra,
  });
  return port;
}

/**
 * Reserve a pool port we can actually bind. Orphans (listening, not in bindings)
 * are killed. Sibling bindings are skipped.
 * @param {string} siteRoot
 * @returns {Promise<number | null>}
 */
async function reserveBindablePort(siteRoot) {
  const abs = path.resolve(siteRoot);
  const key = normRoot(abs);
  const existing = bindings.get(key);
  if (existing?.port != null) return existing.port;

  const freeMs = process.platform === 'win32' ? 8000 : 3000;
  for (const p of poolPorts()) {
    const owner = bindingForPort(p);
    if (owner && !sameSiteRoot(owner.siteRoot, abs)) continue;
    if (await portBindable(p)) return claimPort(abs, p);
    if (!owner) {
      for (const pid of pidsListeningOnPort(p)) killPidTree(pid);
      if (await waitUntilPortFree(p, { timeoutMs: freeMs })) return claimPort(abs, p);
    }
  }
  return null;
}

/**
 * Reserve a free pool port for siteRoot immediately (before async start),
 * so concurrent Prepare cannot both claim the same port.
 * @param {string} siteRoot
 * @returns {number | null}
 */
function reservePort(siteRoot) {
  const abs = path.resolve(siteRoot);
  const key = normRoot(abs);
  const existing = bindings.get(key);
  if (existing?.port != null) return existing.port;

  const used = usedPorts();
  for (const p of poolPorts()) {
    if (used.has(p)) continue;
    return claimPort(abs, p);
  }
  return null;
}

function allocatePort() {
  const used = usedPorts();
  for (let i = 0; i < assembledPreviewSlotCount(); i += 1) {
    const p = PORT_BASE + i;
    if (!used.has(p)) return p;
  }
  return null;
}

function poolPorts() {
  const ports = [];
  for (let i = 0; i < assembledPreviewSlotCount(); i += 1) ports.push(PORT_BASE + i);
  return ports;
}

/**
 * Stop preview for one siteRoot, or all if omitted.
 * When siteRoot is set but not in bindings, do **not** clear the whole port pool
 * unless `forcePoolClear` (Windows EPERM recovery only) — otherwise parallel
 * Prepare jobs kill sibling previews.
 * @param {string} [siteRoot]
 * @param {{ waitMs?: number, forcePoolClear?: boolean }} [opts]
 */
export function stopAssembledPreviewSync(siteRoot, { waitMs, forcePoolClear = false } = {}) {
  const targets = siteRoot
    ? [...bindings.entries()].filter(([, s]) => sameSiteRoot(s.siteRoot, siteRoot))
    : [...bindings.entries()];

  const ports = [];
  if (siteRoot) stopAstroPreviewCli(siteRoot);
  for (const [key, slot] of targets) {
    stopAstroPreviewCli(slot.siteRoot);
    if (slot.child?.pid) killPidTree(slot.child.pid);
    ports.push(slot.port);
    bindings.delete(key);
  }

  const clearAll = !siteRoot;
  const fallBackPool = Boolean(siteRoot) && targets.length === 0 && forcePoolClear;
  if (clearAll || fallBackPool) {
    for (const p of poolPorts()) ports.push(p);
    if (fallBackPool || clearAll) {
      for (const [key, slot] of [...bindings.entries()]) {
        if (slot.child?.pid) killPidTree(slot.child.pid);
        bindings.delete(key);
      }
    }
  }

  const wait =
    waitMs != null
      ? waitMs
      : process.platform === 'win32' && fallBackPool
        ? 4000
        : process.platform === 'win32'
          ? 3000
          : 2000;

  for (const port of [...new Set(ports)]) {
    for (const pid of pidsListeningOnPort(port)) killPidTree(pid);
  }

  if (!ports.length) return true;

  const deadline = Date.now() + wait;
  while (Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    let busy = false;
    for (const port of [...new Set(ports)]) {
      if (pidsListeningOnPort(port).length) {
        busy = true;
        for (const pid of pidsListeningOnPort(port)) killPidTree(pid);
      }
    }
    if (!busy) return true;
  }
  return true;
}

/**
 * Async stop — one siteRoot or all.
 * @param {string} [siteRoot]
 * @param {{ forcePoolClear?: boolean }} [opts]
 */
export async function stopAssembledPreview(siteRoot, { forcePoolClear = false } = {}) {
  const targets = siteRoot
    ? [...bindings.entries()].filter(([, s]) => sameSiteRoot(s.siteRoot, siteRoot))
    : [...bindings.entries()];

  const ports = [];
  if (siteRoot) stopAstroPreviewCli(siteRoot);
  for (const [key, slot] of targets) {
    stopAstroPreviewCli(slot.siteRoot);
    if (slot.child?.pid) killPidTree(slot.child.pid);
    ports.push(slot.port);
    bindings.delete(key);
  }

  const clearAll = !siteRoot;
  const fallBackPool = Boolean(siteRoot) && targets.length === 0 && forcePoolClear;
  if (clearAll || fallBackPool) {
    for (const p of poolPorts()) ports.push(p);
    if (fallBackPool || clearAll) {
      for (const [key, slot] of [...bindings.entries()]) {
        if (slot.child?.pid) killPidTree(slot.child.pid);
        bindings.delete(key);
      }
    }
  }

  for (const port of [...new Set(ports)]) {
    for (const pid of pidsListeningOnPort(port)) killPidTree(pid);
  }

  if (!ports.length) return true;

  const loops = process.platform === 'win32' && fallBackPool ? 50 : 40;
  for (let i = 0; i < loops; i += 1) {
    let any = false;
    for (const port of [...new Set(ports)]) {
      if (await portOpen(port)) any = true;
    }
    if (!any) return true;
    await sleep(100);
  }
  return true;
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

function startAstroPreview(siteRoot, port, { timeoutMs = 90000 } = {}) {
  return new Promise((resolve) => {
    const abs = path.resolve(siteRoot);
    const bin = astroBin(abs);
    if (!existsSync(bin)) {
      resolve({
        ok: false,
        error: `Assembled site is missing astro (${path.relative(abs, bin) || 'node_modules/astro/bin/astro.mjs'})`,
        output: '',
        pid: null,
        port,
      });
      return;
    }

    stopAstroPreviewCli(abs);

    const child = spawn(
      process.execPath,
      [bin, 'preview', '--host', PREVIEW_HOST, '--port', String(port)],
      {
        cwd: abs,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: previewEnv(),
      },
    );
    const key = normRoot(abs);
    bindings.set(key, {
      port,
      siteRoot: abs,
      child,
      touchedAt: Date.now(),
    });

    let settled = false;
    let out = '';
    const finish = (ok, error, extra = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      resolve({
        ok,
        error,
        output: out.slice(-800),
        pid: child.pid || null,
        port,
        hopped: Boolean(extra.hopped),
        hoppedPort: extra.hoppedPort ?? null,
      });
    };

    const timer = setTimeout(() => {
      finish(
        false,
        `Timed out starting assembled preview (${timeoutMs}ms)${formatPreviewOutput(out)}`,
      );
    }, timeoutMs);

    const poll = setInterval(() => {
      previewHttpReady(port).then((ready) => {
        if (ready) finish(true);
      });
    }, 400);

    const onChunk = (d) => {
      out += String(d);
      const hopped = parsePreviewHopPort(out, port);
      if (hopped) {
        if (child.pid) killPidTree(child.pid);
        finish(false, `astro preview hopped from :${port} to :${hopped}${formatPreviewOutput(out)}`, {
          hopped: true,
          hoppedPort: hopped,
        });
      }
    };
    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
    child.on('error', (err) => finish(false, err.message || String(err)));
    child.on('close', async () => {
      const cur = bindings.get(key);
      if (cur?.child === child) {
        bindings.set(key, { ...cur, child: null });
      }
      if (settled) return;
      for (let i = 0; i < 8; i += 1) {
        if (await previewHttpReady(port)) {
          finish(true);
          return;
        }
        await sleep(250);
      }
      finish(
        false,
        `astro preview exited before http://${PREVIEW_HOST}:${port}/ became ready${formatPreviewOutput(out)}`,
      );
    });
  });
}

async function evictOldestOther(exceptRoot) {
  let oldest = null;
  for (const [key, slot] of bindings) {
    if (sameSiteRoot(slot.siteRoot, exceptRoot)) continue;
    if (!oldest || slot.touchedAt < oldest.touchedAt) oldest = { key, slot };
  }
  if (!oldest) return null;
  await stopAssembledPreview(oldest.slot.siteRoot);
  return oldest.slot.port;
}

/**
 * Ensure assembled site dist exists and preview server is up for THIS siteRoot.
 * @param {string} siteRoot absolute assembled folder
 */
export async function ensureAssembledPreview(
  siteRoot,
  { rebuild = false, forceRebind = false, timeoutMs = 120000 } = {},
) {
  ensureIdleEvict();
  const abs = path.resolve(siteRoot);
  const key = normRoot(abs);

  if (!existsSync(abs)) {
    return {
      ok: false,
      url: `http://${PREVIEW_HOST}:${PORT_BASE}/`,
      started: false,
      rebound: false,
      error: `Assembled site not found: ${abs}`,
      assembledSitePath: abs,
      port: PORT_BASE,
    };
  }

  let existing = bindings.get(key);
  if (existing) {
    existing.touchedAt = Date.now();
    const portBusy = await previewHttpReady(existing.port);
    if (portBusy && !forceRebind) {
      const shouldRebuild = rebuild || contentNewerThanDist(abs);
      let build = null;
      if (shouldRebuild) {
        try {
          build = await buildAssembledSiteAsync(abs, { visualEdit: true });
        } catch (error) {
          return {
            ok: false,
            url: `http://${PREVIEW_HOST}:${existing.port}/`,
            started: false,
            rebound: false,
            build: { ok: false, error: error.message },
            error: error.message,
            assembledSitePath: abs,
            port: existing.port,
          };
        }
      }
      return {
        ok: true,
        url: `http://${PREVIEW_HOST}:${existing.port}/`,
        started: false,
        rebound: false,
        build,
        port: existing.port,
        boundSiteRoot: abs,
        assembledSitePath: abs,
      };
    }
    await stopAssembledPreview(abs);
    existing = null;
  }

  if (!forceRebind) {
    for (const p of poolPorts()) {
      const owner = bindingForPort(p);
      if (owner && !sameSiteRoot(owner.siteRoot, abs)) continue;
      if (await previewServesThisSite(p, abs)) {
        claimPort(abs, p, { child: owner?.child ?? null, reused: true });
        return {
          ok: true,
          url: `http://${PREVIEW_HOST}:${p}/`,
          started: false,
          rebound: false,
          build: null,
          port: p,
          boundSiteRoot: abs,
          assembledSitePath: abs,
        };
      }
    }
  }

  let build = null;
  const shouldRebuild = rebuild || contentNewerThanDist(abs);
  const freeMs = process.platform === 'win32' ? 8000 : 3000;

  // Reserve a bindable pool port before long build so concurrent prepares cannot both claim :4322.
  let port = await reserveBindablePort(abs);
  if (port == null) {
    port = await evictOldestOther(abs);
    if (port != null) {
      const freed = await waitUntilPortFree(port, { timeoutMs: freeMs });
      if (freed) claimPort(abs, port);
      else port = null;
    }
    if (port == null) port = await reserveBindablePort(abs);
  }
  if (port == null) {
    const busy = poolPorts().map((p) => `${p}[${pidsListeningOnPort(p).join(',') || '?'}]`);
    return {
      ok: false,
      url: null,
      started: false,
      rebound: false,
      build: null,
      error: `Preview port pool full (${assembledPreviewSlotCount()} slots from ${PORT_BASE}; busy ${busy.join(', ')})`,
      assembledSitePath: abs,
      port: null,
    };
  }

  if (shouldRebuild) {
    try {
      build = await buildAssembledSiteAsync(abs, { visualEdit: true });
    } catch (error) {
      bindings.delete(key);
      return {
        ok: false,
        url: null,
        started: false,
        rebound: false,
        build: { ok: false, error: error.message },
        error: error.message,
        assembledSitePath: abs,
        port: null,
      };
    }
  }

  const freed = await waitUntilPortFree(port, { timeoutMs: freeMs });
  if (!freed) {
    const pids = pidsListeningOnPort(port);
    bindings.delete(key);
    return {
      ok: false,
      url: `http://${PREVIEW_HOST}:${port}/`,
      started: false,
      rebound: true,
      build,
      error: `Preview port ${port} still in use (pids ${pids.join(', ') || 'unknown'})`,
      assembledSitePath: abs,
      port,
    };
  }

  const startTimeout = Math.min(timeoutMs, 90000);
  let start = await startAstroPreview(abs, port, { timeoutMs: startTimeout });
  if (start.hopped) {
    if (start.pid) killPidTree(start.pid);
    if (start.hoppedPort) {
      for (const pid of pidsListeningOnPort(start.hoppedPort)) killPidTree(pid);
    }
    stopAstroPreviewCli(abs);
    clearPreviewLock(abs);
    const reclaimed = await waitUntilPortFree(port, { timeoutMs: freeMs });
    if (!reclaimed) {
      const pids = pidsListeningOnPort(port);
      bindings.delete(key);
      return {
        ok: false,
        url: `http://${PREVIEW_HOST}:${port}/`,
        started: false,
        rebound: true,
        build,
        error: `Preview port ${port} still in use after hop to :${start.hoppedPort} (pids ${pids.join(', ') || 'unknown'})${formatPreviewOutput(start.output)}`,
        assembledSitePath: abs,
        port,
      };
    }
    start = await startAstroPreview(abs, port, { timeoutMs: startTimeout });
    if (start.hopped) {
      if (start.pid) killPidTree(start.pid);
      if (start.hoppedPort) {
        for (const pid of pidsListeningOnPort(start.hoppedPort)) killPidTree(pid);
      }
      stopAstroPreviewCli(abs);
      bindings.delete(key);
      return {
        ok: false,
        url: `http://${PREVIEW_HOST}:${port}/`,
        started: false,
        rebound: true,
        build,
        error: start.error || `astro preview hopped off :${port}${formatPreviewOutput(start.output)}`,
        assembledSitePath: abs,
        port,
      };
    }
  }

  const boundPort = bindings.get(key)?.port ?? port;
  const url = `http://${PREVIEW_HOST}:${boundPort}/`;
  const startTail = formatPreviewOutput(start.output);

  if (!start.ok && !(await previewHttpReady(boundPort))) {
    bindings.delete(key);
    return {
      ok: false,
      url,
      started: false,
      rebound: true,
      build,
      error: start.error || `Failed to start assembled Astro preview${startTail}`,
      assembledSitePath: abs,
      port: boundPort,
    };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await previewHttpReady(boundPort)) {
      const slot = bindings.get(key);
      if (slot) slot.touchedAt = Date.now();
      const livePort = slot?.port ?? boundPort;
      const liveUrl = `http://${PREVIEW_HOST}:${livePort}/`;
      return {
        ok: true,
        url: liveUrl,
        started: true,
        rebound: true,
        build,
        port: livePort,
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
    error: `Assembled preview did not become ready on ${url}${startTail}`,
    assembledSitePath: abs,
    port: boundPort,
  };
}

export function getAssembledPreviewBinding(siteRoot) {
  if (siteRoot) {
    const slot = bindings.get(normRoot(siteRoot));
    if (slot) {
      return {
        port: slot.port,
        boundSiteRoot: slot.siteRoot,
        url: `http://${PREVIEW_HOST}:${slot.port}/`,
        pool: { base: PORT_BASE, slots: assembledPreviewSlotCount(), active: bindings.size },
      };
    }
    // Do not invent PORT_BASE for a specific siteRoot — that caused duplicate :4322 URLs.
    return {
      port: null,
      boundSiteRoot: null,
      url: null,
      pool: { base: PORT_BASE, slots: assembledPreviewSlotCount(), active: bindings.size },
    };
  }
  // Prefer first active binding for legacy callers
  const first = [...bindings.values()][0];
  if (first) {
    return {
      port: first.port,
      boundSiteRoot: first.siteRoot,
      url: `http://${PREVIEW_HOST}:${first.port}/`,
      pool: { base: PORT_BASE, slots: assembledPreviewSlotCount(), active: bindings.size },
    };
  }
  return {
    port: PORT_BASE,
    boundSiteRoot: null,
    url: `http://${PREVIEW_HOST}:${PORT_BASE}/`,
    pool: { base: PORT_BASE, slots: assembledPreviewSlotCount(), active: 0 },
  };
}

export function listAssembledPreviewBindings() {
  return [...bindings.values()].map((s) => ({
    port: s.port,
    siteRoot: s.siteRoot,
    url: `http://${PREVIEW_HOST}:${s.port}/`,
    touchedAt: s.touchedAt,
  }));
}

/**
 * Drop previews whose ports sit outside the current Settings slot range.
 */
export async function syncAssembledPreviewPoolSize() {
  const slots = assembledPreviewSlotCount();
  const allowed = new Set();
  for (let i = 0; i < slots; i += 1) allowed.add(PORT_BASE + i);
  for (const slot of [...bindings.values()]) {
    if (!allowed.has(slot.port)) {
      await stopAssembledPreview(slot.siteRoot);
    }
  }
}

export const ASSEMBLED_PREVIEW_PORT = PORT_BASE;
export const ASSEMBLED_PREVIEW_URL = `http://${PREVIEW_HOST}:${PORT_BASE}/`;
export const ASSEMBLED_PREVIEW_SLOTS = assembledPreviewSlotCount;
