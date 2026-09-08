/**
 * OpenAI generate jobs: 202 enqueue, server-side caps, cross-candidate queue.
 */
import {
  getConcurrency,
  setConcurrencySettings,
} from '../ops/lib/rover-concurrency.mjs';
import {
  countQueuedLightJobs,
  countRunningLightJobs,
  findActiveOpenaiJob,
  getLightJob,
  listLightJobsSnapshot,
  resetLightJobsForTests,
} from '../ops/lib/rover-light-jobs.mjs';
import { setCpuPoolRunnerForTests } from '../ops/lib/rover-cpu-pool.mjs';
import { enqueueCandidateOpenaiJobs } from '../ops/lib/openai-generate-jobs.mjs';
import { listCandidates } from '../ops/lib/candidates.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

async function flush(n = 12) {
  for (let i = 0; i < n; i += 1) {
    await new Promise((r) => setImmediate(r));
  }
}

const prev = getConcurrency();
const releases = [];

function holdUntilReleased(_payload, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const release = () => resolve({ ok: true, status: { slot: { key: _payload.slotKey || 'x' } } });
    releases.push(release);
    signal?.addEventListener(
      'abort',
      () => {
        reject(Object.assign(new Error('Stopped'), { status: 499, code: 'STOPPED' }));
      },
      { once: true },
    );
  });
}

try {
  setConcurrencySettings({ openaiPhotos: 5, openaiBeforeAfter: 2 });
  setCpuPoolRunnerForTests(holdUntilReleased);
  resetLightJobsForTests();

  const started = Date.now();
  const first = enqueueCandidateOpenaiJobs('cand-a', {
    slotKeys: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'],
  });
  const enqueueMs = Date.now() - started;
  assert(first.accepted, 'bulk accepted');
  assertEqual(first.jobs.length, 8, '8 jobs');
  assert(enqueueMs < 250, `enqueue returned quickly (${enqueueMs}ms)`);

  await flush();
  assertEqual(countRunningLightJobs('openai-photo'), 5, 'cap 5 running');
  assertEqual(countQueuedLightJobs('openai-photo'), 3, '3 queued');

  const second = enqueueCandidateOpenaiJobs('cand-b', {
    slotKeys: ['t1', 't2', 't3'],
  });
  assertEqual(second.jobs.length, 3, 'second candidate 3 jobs');
  await flush();
  assertEqual(countRunningLightJobs('openai-photo'), 5, 'still 5 running across candidates');
  assertEqual(countQueuedLightJobs('openai-photo'), 6, '6 queued after B');

  const t0 = Date.now();
  listLightJobsSnapshot();
  const snapMs = Date.now() - t0;
  assert(snapMs < 200, `light snapshot during generate (${snapMs}ms)`);
  const t1 = Date.now();
  listCandidates();
  const listMs = Date.now() - t1;
  assert(listMs < 4000, `listCandidates during generate (${listMs}ms)`);

  const reused = enqueueCandidateOpenaiJobs('cand-a', { slotKeys: ['s1'] });
  assertEqual(reused.jobs[0].reused, true, 'same slot reused');
  assertEqual(reused.jobs[0].jobId, first.jobs[0].jobId, 'same jobId');

  try {
    enqueueCandidateOpenaiJobs('cand-a', { slotKeys: ['s2'], onConflict: 'throw' });
    console.error('expected OPENAI_SLOT_RUNNING');
    process.exit(1);
  } catch (error) {
    assertEqual(error.code, 'OPENAI_SLOT_RUNNING', 'throw conflict code');
    assert(Boolean(error.jobId), 'conflict jobId');
  }

  resetLightJobsForTests();
  releases.length = 0;
  const ba = enqueueCandidateOpenaiJobs('cand-ba', {
    baItems: [
      { matchKey: 'ba:1', pairIndex: 1 },
      { matchKey: 'ba:2', pairIndex: 2 },
      { matchKey: 'ba:3', pairIndex: 3 },
    ],
  });
  assertEqual(ba.jobs.length, 3, '3 BA jobs');
  await flush();
  assertEqual(countRunningLightJobs('openai-ba'), 2, 'BA cap 2 running');
  assertEqual(countQueuedLightJobs('openai-ba'), 1, '1 BA queued');

  const snap = listLightJobsSnapshot();
  assert(
    snap.jobs.some((j) => j.phase === 'openai-ba' && j.status === 'queued'),
    'snapshot includes queued BA',
  );
  assert(
    snap.jobs.some((j) => j.slotKey || j.matchKey),
    'snapshot includes slotKey',
  );

  const runningId = ba.jobs[0].jobId;
  const live = getLightJob(runningId);
  assertEqual(live.status, 'running', 'first BA running');
  assert(findActiveOpenaiJob({ candidateId: 'cand-ba', phase: 'openai-ba', slotKey: 'ba:1' }), 'find active BA');

  for (const release of releases) release();
  await flush(20);
} finally {
  setCpuPoolRunnerForTests(null);
  resetLightJobsForTests();
  setConcurrencySettings(prev);
}

console.log('test-openai-generate-jobs: ok');
