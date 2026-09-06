/**
 * Preview assembled sibling sites (astro preview on dist).
 *
 * Port pool (default base 4322, 2 slots): each siteRoot can keep its own preview
 * without killing others. When the pool is full, the oldest other binding is evicted.
 * Idle bindings are stopped after ASSEMBLED_PREVIEW_IDLE_MS (default 15 min).
 */

import { spawn, execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { buildAssembledSiteAsync } from './ship-site.mjs';

const PREVIEW_HOST = '127.0.0.1';
const PORT_BASE = Math.max(
  1024,
  Number(process.env.ASSEMBLED_PREVIEW_PORT_BASE || 4322) || 4322,
);
const PORT_SLOTS = Math.max(
  1,
  Math.min(8, Number(process.env.ASSEMBLED_PREVIEW_SLOTS || 2) || 2),
);
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  for (let i = 0; i < PORT_SLOTS; i += 1) {
    const p = PORT_BASE + i;
    if (used.has(p)) continue;
    bindings.set(key, {
      port: p,
      siteRoot: abs,
      child: null,
      touchedAt: Date.now(),
      reserved: true,
    });
    return p;
  }
  return null;
}

function allocatePort() {
  const used = usedPorts();
  for (let i = 0; i < PORT_SLOTS; i += 1) {
    const p = PORT_BASE + i;
    if (!used.has(p)) return p;
  }
  return null;
}

function poolPorts() {
  const ports = [];
  for (let i = 0; i < PORT_SLOTS; i += 1) ports.push(PORT_BASE + i);
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
  for (const [key, slot] of targets) {
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
  for (const [key, slot] of targets) {
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
    const child = spawn(
      'npx',
      ['astro', 'preview', '--host', PREVIEW_HOST, '--port', String(port)],
      {
        cwd: siteRoot,
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      },
    );
    const key = normRoot(siteRoot);
    bindings.set(key, {
      port,
      siteRoot: path.resolve(siteRoot),
      child,
      touchedAt: Date.now(),
    });

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
      resolve({ ok, error, output: out.slice(-800), pid: child.pid || null, port });
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
      const cur = bindings.get(key);
      if (cur?.child === child) {
        bindings.set(key, { ...cur, child: null });
      }
      if (settled) return;
      for (let i = 0; i < 30; i += 1) {
        if (await portOpen(port)) {
          finish(true);
          return;
        }
        await sleep(250);
      }
      finish(false, `astro preview exited before port ${port} opened: ${out.slice(-400)}`);
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
    const portBusy = await portOpen(existing.port);
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

  let build = null;
  const shouldRebuild = rebuild || contentNewerThanDist(abs);

  // Reserve port before long build so concurrent prepares cannot both claim :4322.
  let port = reservePort(abs);
  if (port == null) {
    port = await evictOldestOther(abs);
    if (port != null) {
      bindings.set(key, {
        port,
        siteRoot: abs,
        child: null,
        touchedAt: Date.now(),
        reserved: true,
      });
    } else {
      port = reservePort(abs);
    }
  }
  if (port == null) {
    return {
      ok: false,
      url: null,
      started: false,
      rebound: false,
      build: null,
      error: `Preview port pool full (${PORT_SLOTS} slots from ${PORT_BASE})`,
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

  if (await portOpen(port)) {
    for (const pid of pidsListeningOnPort(port)) killPidTree(pid);
    await sleep(200);
  }

  const start = await startAstroPreview(abs, port, { timeoutMs: Math.min(timeoutMs, 90000) });
  const boundPort = bindings.get(key)?.port ?? port;
  const url = `http://${PREVIEW_HOST}:${boundPort}/`;

  if (!start.ok && !(await portOpen(boundPort))) {
    bindings.delete(key);
    return {
      ok: false,
      url,
      started: false,
      rebound: true,
      build,
      error: start.error || 'Failed to start assembled Astro preview',
      assembledSitePath: abs,
      port: boundPort,
    };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(boundPort)) {
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
    error: `Assembled preview did not become ready on ${url}`,
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
        pool: { base: PORT_BASE, slots: PORT_SLOTS, active: bindings.size },
      };
    }
    // Do not invent PORT_BASE for a specific siteRoot — that caused duplicate :4322 URLs.
    return {
      port: null,
      boundSiteRoot: null,
      url: null,
      pool: { base: PORT_BASE, slots: PORT_SLOTS, active: bindings.size },
    };
  }
  // Prefer first active binding for legacy callers
  const first = [...bindings.values()][0];
  if (first) {
    return {
      port: first.port,
      boundSiteRoot: first.siteRoot,
      url: `http://${PREVIEW_HOST}:${first.port}/`,
      pool: { base: PORT_BASE, slots: PORT_SLOTS, active: bindings.size },
    };
  }
  return {
    port: PORT_BASE,
    boundSiteRoot: null,
    url: `http://${PREVIEW_HOST}:${PORT_BASE}/`,
    pool: { base: PORT_BASE, slots: PORT_SLOTS, active: 0 },
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

export const ASSEMBLED_PREVIEW_PORT = PORT_BASE;
export const ASSEMBLED_PREVIEW_URL = `http://${PREVIEW_HOST}:${PORT_BASE}/`;
export const ASSEMBLED_PREVIEW_SLOTS = PORT_SLOTS;
