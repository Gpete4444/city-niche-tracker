/**
 * Worker-thread entry for sync assembleSite — keeps the Rover main event loop free
 * so K>1 Prepare jobs and Jobs SSE can run in parallel.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { assembleSite } from './assemble-site.mjs';

try {
  const candidateId = String(workerData?.candidateId || '').trim();
  const opts = workerData?.opts && typeof workerData.opts === 'object' ? workerData.opts : {};
  if (!candidateId) {
    throw Object.assign(new Error('candidateId required'), { status: 400 });
  }
  const result = assembleSite(candidateId, opts);
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error?.message || String(error),
    status: error?.status || 500,
    siteRoot: error?.siteRoot || null,
  });
}
