import { launchStampPatch } from '../ops/lib/candidates.mjs';

function assertDeep(got, want, label) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) {
    console.error(`${label}: got ${a}, want ${b}`);
    process.exit(1);
  }
}

const attempt = '2026-10-27T18:33:49.890Z';
const success = '2026-10-27T19:40:01.177Z';
const later = '2026-10-28T15:00:00.000Z';

assertDeep(
  launchStampPatch({ lastLaunchAttemptAt: attempt }, { ok: false, at: attempt }),
  { lastLaunchAttemptAt: attempt },
  'failure records the attempt and does not invent a launch date',
);

assertDeep(
  launchStampPatch(
    { lastLaunchAt: success, lastLaunchAttemptAt: attempt },
    { ok: false, at: later },
  ),
  { lastLaunchAttemptAt: later },
  'failure after a real launch date does not clear it',
);

assertDeep(
  launchStampPatch({ lastLaunchAttemptAt: attempt }, { ok: true, at: success }),
  { lastLaunchAt: success },
  'success after only an attempt writes the success time',
);

assertDeep(
  launchStampPatch({ lastLaunchAt: success }, { ok: true, at: later }),
  {},
  'a second success does not replace the first launch date',
);

console.log('test-launch-stamp: ok');
