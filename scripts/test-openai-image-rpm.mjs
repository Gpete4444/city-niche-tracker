/**
 * OpenAI image RPM gate, retry-after parse, and light-job rate-limit re-queue.
 * Run: node scripts/test-openai-image-rpm.mjs
 */
import {
  acquireOpenaiImageToken,
  openaiImageRpmUsed,
  parseOpenaiRetryAfterMs,
  resetOpenaiImageRpmForTests,
  OPENAI_IMAGE_RPM_LIMIT,
} from '../ops/lib/openai-image-rpm.mjs';
import {
  enqueueLightJob,
  finishLightJob,
  getLightJob,
  resetLightJobsForTests,
  shouldRequeueOpenaiRateLimit,
  waitForLightJob,
} from '../ops/lib/rover-light-jobs.mjs';

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

resetOpenaiImageRpmForTests();
assertEqual(parseOpenaiRetryAfterMs(null, 'Please try again in 3s.'), 3_000, 'body 3s');
assertEqual(parseOpenaiRetryAfterMs('2', 'Please try again in 9s.'), 2_000, 'header wins');
assertEqual(parseOpenaiRetryAfterMs(null, 'no hint', 0), 15_000, 'fallback first');

for (let i = 0; i < OPENAI_IMAGE_RPM_LIMIT; i += 1) {
  await acquireOpenaiImageToken();
}
assertEqual(openaiImageRpmUsed(), OPENAI_IMAGE_RPM_LIMIT, 'window full');

const started = Date.now();
const pending = acquireOpenaiImageToken();
await new Promise((r) => setTimeout(r, 40));
assertEqual(openaiImageRpmUsed(), OPENAI_IMAGE_RPM_LIMIT, 'acquire waits when full');
resetOpenaiImageRpmForTests();
await pending;
assert(Date.now() - started < 2_000, 'reset unblocks waiter');

assertEqual(
  shouldRequeueOpenaiRateLimit({ run: () => {}, rateLimitRequeues: 0 }, { code: 'openai-rate-limit' }),
  true,
  'requeue first 429',
);
assertEqual(
  shouldRequeueOpenaiRateLimit({ run: () => {}, rateLimitRequeues: 8 }, { code: 'openai-rate-limit' }),
  false,
  'requeue cap',
);
assertEqual(shouldRequeueOpenaiRateLimit({ run: () => {} }, { code: 'openai-image' }), false, 'other error');

resetLightJobsForTests();
let runs = 0;
const { jobId } = enqueueLightJob({
  candidateId: 'rpm-test',
  phase: 'openai-photo',
  label: 'rpm',
  slotKey: 'hero-1',
  matchKey: 'hero-1',
  kind: 'photo',
  run: async () => {
    runs += 1;
    if (runs === 1) {
      throw Object.assign(new Error('Rate limit reached'), { code: 'openai-rate-limit', status: 429 });
    }
    return { ok: true };
  },
});

await new Promise((r) => setImmediate(r));
await new Promise((r) => setImmediate(r));
const mid = getLightJob(jobId);
if (mid?.status === 'error') {
  console.error('first 429 should re-queue, got error', mid.error);
  process.exit(1);
}

await waitForLightJob(jobId);
const done = getLightJob(jobId);
assertEqual(done?.status, 'done', 'requeued job finishes');
assert(runs >= 2, `runner retried (runs=${runs})`);

resetLightJobsForTests();
const { jobId: failId } = enqueueLightJob({
  candidateId: 'rpm-test',
  phase: 'openai-photo',
  label: 'rpm-fail',
  slotKey: 'hero-2',
  matchKey: 'hero-2',
  kind: 'photo',
  run: () => new Promise(() => {}),
});
await new Promise((r) => setImmediate(r));
await new Promise((r) => setImmediate(r));
finishLightJob(failId, {
  error: Object.assign(new Error('Rate limit reached'), {
    code: 'openai-rate-limit',
    status: 429,
  }),
});
const afterFirst = getLightJob(failId);
assert(
  afterFirst?.status === 'queued' || afterFirst?.status === 'running',
  `live 429 re-queues (status=${afterFirst?.status})`,
);
assertEqual(afterFirst?.error, null, 're-queued job has no error');
assert(/wait/i.test(String(afterFirst?.detail || '')), 're-queue waiting detail');

console.log('test-openai-image-rpm: ok');
