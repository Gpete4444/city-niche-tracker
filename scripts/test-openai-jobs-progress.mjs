import {
  openaiBatchPendingInSnap,
  openaiBusyKeysStillActive,
  openaiJobBelongsHere,
  openaiJobIdsMissingFromSnap,
  openaiJobsNeedingWatch,
  openaiJobsProgressFromSnap,
  openaiSlotOverlayCaption,
} from '../ops/lib/openai-jobs-progress.mjs';

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

const jobs = [
  { id: 'a1', phase: 'openai-photo', candidateId: 'pearland', status: 'running', slotKey: 's1' },
  { id: 'a2', phase: 'openai-photo', candidateId: 'pearland', status: 'queued', slotKey: 's2' },
  { id: 'a3', phase: 'openai-photo', candidateId: 'pearland', status: 'done', slotKey: 's3' },
  { id: 'b1', phase: 'openai-photo', candidateId: 'sugarland', status: 'running', slotKey: 't1' },
  { id: 'p1', phase: 'pull', candidateId: 'pearland', status: 'running' },
];

assertEqual(openaiJobBelongsHere(jobs[0], { selectedId: 'pearland' }), true, 'belongs selected');
assertEqual(openaiJobBelongsHere(jobs[3], { selectedId: 'pearland' }), false, 'other candidate');
assertEqual(
  openaiJobBelongsHere(
    { candidateId: 'photo-group:g1', phase: 'openai-photo' },
    { photoGroupKey: 'photo-group:g1' },
  ),
  true,
  'belongs photo group',
);

const progress = openaiJobsProgressFromSnap(jobs, { selectedId: 'pearland' });
assertEqual(progress.running, 1, 'running');
assertEqual(progress.queued, 1, 'queued');
assertEqual(progress.done, 1, 'done');
assertEqual(progress.active, 2, 'active');
assertEqual(progress.total, 3, 'total ignores other candidate and pull');

const other = openaiJobsProgressFromSnap(jobs, { selectedId: 'sugarland' });
assertEqual(other.running, 1, 'sugarland running');
assertEqual(other.queued, 0, 'sugarland queued');
assertEqual(other.total, 1, 'sugarland total');

const need = openaiJobsNeedingWatch(jobs, {
  selectedId: 'pearland',
  watchedIds: ['a1'],
});
assertEqual(need.length, 1, 'one unwached active');
assertEqual(need[0].id, 'a2', 'queued not yet watched');

assertEqual(openaiSlotOverlayCaption({ status: 'queued' }).label, 'Queued', 'queued caption');
assertEqual(
  openaiSlotOverlayCaption({ status: 'queued', detail: 'Waiting for rate limit…' }).label,
  'Waiting',
  'queued waiting caption',
);
assertEqual(openaiSlotOverlayCaption({ status: 'running' }).label, 'Generating', 'running caption');
assertEqual(
  openaiSlotOverlayCaption({ status: 'running', detail: 'Waiting…' }).label,
  'Waiting',
  'running waiting caption',
);
assertEqual(
  openaiSlotOverlayCaption(
    { status: 'running', startedAt: new Date(100_000).toISOString() },
    112_000,
  ).elapsedMs,
  12_000,
  'elapsed from startedAt',
);

const batchIds = Array.from({ length: 41 }, (_, i) => `j${i + 1}`);
const snap40 = batchIds.slice(0, 40).map((id) => ({
  id,
  phase: 'openai-photo',
  candidateId: 'pearland',
  status: 'done',
  slotKey: id,
}));
const missing = openaiJobIdsMissingFromSnap(batchIds, snap40);
assertEqual(missing.length, 1, 'one id missing from 40-job snap');
assertEqual(missing[0], 'j41', 'missing is the 41st');
const handled = new Set(batchIds.slice(0, 40));
const pending = openaiBatchPendingInSnap(batchIds, { handled, snapJobs: snap40 });
assertEqual(pending.length, 0, 'missing id is not pending-in-snap');
assertEqual(
  openaiBusyKeysStillActive(['s1', 'gone'], jobs, { selectedId: 'pearland' }).join(','),
  'gone',
  'busy key without active job is leftover',
);
assertEqual(
  openaiBusyKeysStillActive(['s1'], jobs, { selectedId: 'pearland' }).length,
  0,
  'running slot stays busy',
);

console.log('test-openai-jobs-progress: ok');
