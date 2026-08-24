/**
 * Worker-thread entry for sync stageSiteContent — keeps the Rover main event loop free
 * so K>1 Prepare jobs and Jobs SSE can run in parallel.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { stageSiteContent } from './site-staging.mjs';

try {
  const candidateId = String(workerData?.candidateId || '').trim();
  const opts = workerData?.opts && typeof workerData.opts === 'object' ? workerData.opts : {};
  if (!candidateId) {
    throw Object.assign(new Error('candidateId required'), { status: 400 });
  }
  const result = stageSiteContent(candidateId, opts);
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error?.message || String(error),
    status: error?.status || 500,
    check: error?.check || null,
    contract: error?.contract || null,
  });
}
