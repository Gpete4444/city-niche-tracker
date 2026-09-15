import {
  openaiJobBelongsHere,
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
assertEqual(openaiSlotOverlayCaption({ status: 'running' }).label, 'Generating', 'running caption');
assertEqual(
  openaiSlotOverlayCaption(
    { status: 'running', startedAt: new Date(100_000).toISOString() },
    112_000,
  ).elapsedMs,
  12_000,
  'elapsed from startedAt',
);

console.log('test-openai-jobs-progress: ok');
