/**
 * Fork OpenAI image generate + sharp + persist off the Express thread.
 * Light-job queue caps how many children run; abort kills that child.
 */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const WORKER = fileURLToPath(new URL('./openai-generate-worker.mjs', import.meta.url));

/** @type {Map<string, import('node:child_process').ChildProcess>} */
const live = new Map();

/** @type {null | ((payload: object, ctx: { signal?: AbortSignal }) => Promise<unknown>)} */
let testRunner = null;

export function setCpuPoolRunnerForTests(fn) {
  testRunner = typeof fn === 'function' ? fn : null;
}

export function cpuPoolIsStubbed() {
  return typeof testRunner === 'function';
}

function stoppedError() {
  return Object.assign(new Error('Stopped'), { status: 499, code: 'STOPPED' });
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
        process.kill(pid, 'SIGTERM');
      } catch {
        /* gone */
      }
    }
  } catch {
    /* already gone */
  }
}

function serializeErr(err) {
  return Object.assign(new Error(err?.message ? String(err.message) : String(err || 'Worker failed')), {
    status: err?.status || 500,
    code: err?.code || 'openai-worker',
  });
}

/**
 * @param {object} payload
 * @param {{ signal?: AbortSignal }} [opts]
 */
export function runCpuTask(payload, { signal } = {}) {
  if (typeof testRunner === 'function') {
    return testRunner(payload, { signal });
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(stoppedError());
      return;
    }
    const child = fork(WORKER, [], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const pid = String(child.pid || `${Date.now()}-${Math.random()}`);
    live.set(pid, child);
    let settled = false;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      live.delete(pid);
      try {
        signal?.removeEventListener('abort', onAbort);
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(result);
    };

    const onAbort = () => {
      killPidTree(child.pid);
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      finish(stoppedError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.ok) finish(null, msg.result);
      else finish(serializeErr(msg.error));
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    });
    child.on('error', (err) => finish(serializeErr(err)));
    child.on('exit', (code, sig) => {
      if (settled) return;
      if (signal?.aborted) {
        finish(stoppedError());
        return;
      }
      finish(
        Object.assign(new Error(`Image worker exited (${code ?? sig ?? 'unknown'})`), {
          status: 500,
          code: 'openai-worker',
        }),
      );
    });
    child.send({ payload });
  });
}

export function stopCpuPool() {
  for (const child of live.values()) {
    killPidTree(child.pid);
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  live.clear();
}
