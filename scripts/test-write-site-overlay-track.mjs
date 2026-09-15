import {
  findFinishedWriteSiteJob,
  resolveWriteSiteOverlay,
  selectedWriteSiteNeedsRefresh,
  writeSiteTrackHoldsLease,
} from '../ops/lib/write-site-overlay-track.mjs';

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

function job(partial) {
  return {
    phase: 'write-site',
    ...partial,
  };
}

const trackA = { candidateId: 'pearland', jobId: 'job-a' };
const runningA = job({
  id: 'job-a',
  candidateId: 'pearland',
  status: 'running',
});
const doneA = job({
  id: 'job-a',
  candidateId: 'pearland',
  status: 'done',
});
const errorB = job({
  id: 'job-b',
  candidateId: 'sugarland',
  status: 'error',
  error: 'Polish leftover speech findings (3).',
});
const runningB = job({
  id: 'job-b',
  candidateId: 'sugarland',
  status: 'running',
});

assertEqual(writeSiteTrackHoldsLease('pearland', trackA), true, 'hold lease for tracked row');
assertEqual(writeSiteTrackHoldsLease('sugarland', trackA), false, 'do not hold other row');
assertEqual(writeSiteTrackHoldsLease('pearland', null), false, 'no track');

const clickAwayDone = resolveWriteSiteOverlay({
  jobs: [doneA, runningB],
  selectedId: 'sugarland',
  track: trackA,
});
assertEqual(clickAwayDone.paintJob?.id, 'job-b', 'paint selected row write, do not steal track');
assertEqual(clickAwayDone.outcome, 'done', 'start A, select B, A done is success');
assertEqual(clickAwayDone.finished?.id, 'job-a', 'finished is tracked A');
assertEqual(clickAwayDone.lookupTrackedJob, false, 'A present in snap');

const otherRowError = resolveWriteSiteOverlay({
  jobs: [runningA, errorB],
  selectedId: 'sugarland',
  track: trackA,
});
assertEqual(otherRowError.paintJob, null, 'B error is not an active overlay');
assertEqual(otherRowError.outcome, 'wait', 'B error does not fail tracked A');
assertEqual(otherRowError.finished, null, 'no complete-handle while A runs');

const missingSnap = resolveWriteSiteOverlay({
  jobs: [errorB],
  selectedId: 'sugarland',
  track: trackA,
});
assertEqual(missingSnap.outcome, 'wait', 'missing snap is still waiting');
assertEqual(missingSnap.lookupTrackedJob, true, 'lookup tracked job by id');
assertEqual(missingSnap.finished, null, 'missing is not failure');

const noTrackWatch = resolveWriteSiteOverlay({
  jobs: [runningB],
  selectedId: 'sugarland',
  track: null,
});
assertEqual(noTrackWatch.paintJob?.id, 'job-b', 'watch selected write without a track');
assertEqual(noTrackWatch.outcome, null, 'no complete-handle without a started job');

const stopped = resolveWriteSiteOverlay({
  jobs: [job({ id: 'job-a', candidateId: 'pearland', status: 'error', error: 'Stopped by operator' })],
  selectedId: 'pearland',
  track: trackA,
});
assertEqual(stopped.outcome, 'stopped', 'stopped error is not a fail modal');

const realFail = resolveWriteSiteOverlay({
  jobs: [errorB],
  selectedId: 'sugarland',
  track: { candidateId: 'sugarland', jobId: 'job-b' },
});
assertEqual(realFail.outcome, 'error', 'tracked job error is failure');
assertEqual(realFail.finished?.id, 'job-b', 'finished is B');

assertEqual(findFinishedWriteSiteJob([runningB], 'sugarland'), null, 'active selected is not finished');
assertEqual(findFinishedWriteSiteJob([doneA], 'sugarland'), null, 'other candidate done is ignored');
assertEqual(findFinishedWriteSiteJob([doneA], 'pearland')?.id, 'job-a', 'selected done is finished');

const watchB = selectedWriteSiteNeedsRefresh({
  jobs: [runningA, job({ id: 'job-b', candidateId: 'sugarland', status: 'done' })],
  selectedId: 'sugarland',
  track: trackA,
});
assertEqual(watchB?.id, 'job-b', 'watch selected B done without stealing track A');
assertEqual(
  resolveWriteSiteOverlay({
    jobs: [runningA, job({ id: 'job-b', candidateId: 'sugarland', status: 'done' })],
    selectedId: 'sugarland',
    track: trackA,
  }).outcome,
  'wait',
  'tracked A still running after B done',
);

const ownRow = selectedWriteSiteNeedsRefresh({
  jobs: [doneA],
  selectedId: 'pearland',
  track: trackA,
});
assertEqual(ownRow, null, 'tracked handler owns selected A done');

const noTrackWatchDone = selectedWriteSiteNeedsRefresh({
  jobs: [job({ id: 'job-b', candidateId: 'sugarland', status: 'done' })],
  selectedId: 'sugarland',
  track: null,
});
assertEqual(noTrackWatchDone?.id, 'job-b', 'no track still refreshes selected done');

assertEqual(
  selectedWriteSiteNeedsRefresh({
    jobs: [runningB],
    selectedId: 'sugarland',
    track: null,
  }),
  null,
  'selected still running does not refresh',
);

console.log('test-write-site-overlay-track: ok');
