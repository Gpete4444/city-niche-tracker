/**
 * Ensure Astro local preview (astro dev --background) for post-Stage website preview.
 */

import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

const ROOT = process.cwd();
const PREVIEW_HOST = '127.0.0.1';
const PREVIEW_PORT = 4321;
export const ASTRO_PREVIEW_URL = `http://${PREVIEW_HOST}:${PREVIEW_PORT}/`;

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

/**
 * Start `astro dev --background` and wait until the CLI reports running or the port opens.
 */
function startAstroDevBackground({ timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      ['astro', 'dev', '--background', '--host', PREVIEW_HOST, '--port', String(PREVIEW_PORT)],
      {
        cwd: ROOT,
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let settled = false;
    let out = '';
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, error, output: out.slice(-800) });
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(false, `Timed out starting Astro preview (${timeoutMs}ms)`);
    }, timeoutMs);

    const onChunk = (d) => {
      out += String(d);
      if (/dev server running|running at http/i.test(out)) {
        finish(true);
      }
    };
    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
    child.on('error', (err) => finish(false, err.message || String(err)));
    child.on('close', async (code) => {
      if (settled) return;
      // --background exits after daemonizing; success if port is up shortly
      for (let i = 0; i < 20; i += 1) {
        if (await portOpen(PREVIEW_PORT)) {
          finish(true);
          return;
        }
        await sleep(250);
      }
      if (code === 0 || /dev server running|running at http/i.test(out)) {
        finish(true);
        return;
      }
      finish(false, `astro dev --background exited ${code}: ${out.slice(-400)}`);
    });
  });
}

/**
 * Ensure Astro preview is reachable; start background dev if needed.
 * @returns {{ ok: boolean, url: string, started: boolean, error?: string }}
 */
export async function ensureAstroPreview({ timeoutMs = 60000 } = {}) {
  const url = ASTRO_PREVIEW_URL;
  if (await portOpen(PREVIEW_PORT)) {
    return { ok: true, url, started: false };
  }

  let started = false;
  const start = await startAstroDevBackground({ timeoutMs: Math.min(timeoutMs, 60000) });
  started = Boolean(start.ok);
  if (!start.ok && !(await portOpen(PREVIEW_PORT))) {
    return {
      ok: false,
      url,
      started: false,
      error: start.error || 'Failed to start Astro preview',
    };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(PREVIEW_PORT)) {
      return { ok: true, url, started: started || true };
    }
    await sleep(400);
  }

  return {
    ok: false,
    url,
    started,
    error: `Astro preview did not become ready on ${url} within ${timeoutMs}ms`,
  };
}
