import { launchedCountStats } from '../ops/public/launch-celebrate.js';

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

function assertDeep(got, want, label) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) {
    console.error(`${label}: got ${a}, want ${b}`);
    process.exit(1);
  }
}

const prior = Array.from({ length: 10 }, (_, i) => ({
  candidateId: `site-${i + 1}`,
  lastLaunchAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
}));

assertDeep(
  launchedCountStats(prior, 'brand-new', { lastLaunchAt: '2026-09-18T00:00:00.000Z' }),
  { ordinal: 11, total: 11 },
  'missing current id increments total and is newest',
);

const already = launchedCountStats(prior, 'site-4');
assertDeep(already, { ordinal: 4, total: 10 }, 'listed current id keeps total and ordinal');

const relaunch = launchedCountStats(prior, 'site-4', {
  lastLaunchAt: '2026-09-18T12:00:00.000Z',
});
assertDeep(relaunch, { ordinal: 4, total: 10 }, 're-launch of an existing row does not increment total');

const empty = launchedCountStats([], 'first-site', { lastLaunchAt: '2026-09-18T00:00:00.000Z' });
assertDeep(empty, { ordinal: 1, total: 1 }, 'first launch with empty portfolio is site #1');

assertEqual(
  launchedCountStats(
    [
      { candidateId: 'old-twilio', createdAt: '2025-01-01T00:00:00.000Z', lastLaunchAt: '2026-09-18T00:00:00.000Z' },
      { candidateId: 'earlier-live', createdAt: '2026-06-01T00:00:00.000Z', lastLaunchAt: '2026-06-01T00:00:00.000Z' },
    ],
    'old-twilio',
  ).ordinal,
  2,
  'ordinal sorts by lastLaunchAt, not portfolio createdAt',
);

console.log('test-launch-celebrate-count: ok');
