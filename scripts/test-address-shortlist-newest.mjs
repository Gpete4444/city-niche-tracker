/**
 * Accumulated address shortlist: newest foundAt first within tier; cap drops oldest.
 * Run: node scripts/test-address-shortlist-newest.mjs
 */
import { mergeAccumulatedShortlist } from '../ops/lib/address-screen.mjs';

function assert(cond, label) {
  if (!cond) {
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

function row(street, zip, extra = {}) {
  return {
    street,
    zip,
    city: 'Omaha',
    state: 'NE',
    ...extra,
  };
}

const merged = mergeAccumulatedShortlist(
  [
    row('100 Old St', '68102', { foundAt: '2026-01-01T00:00:00.000Z', score: 99, suite: 'STE-100' }),
    row('200 Mid St', '68102', { foundAt: '2026-06-01T00:00:00.000Z', score: 80, suite: 'STE-200' }),
  ],
  [row('300 New St', '68102', { foundAt: '2026-09-01T00:00:00.000Z', score: 10 })],
);

assertEqual(merged.map((r) => r.street).join('|'), '300 New St|200 Mid St|100 Old St', 'newest primary first');

const withSecondary = mergeAccumulatedShortlist(
  [
    row('10 Primary Old', '68102', {
      foundAt: '2026-01-01T00:00:00.000Z',
      tier: 'primary',
      suite: 'STE-10',
    }),
    row('20 Secondary New', '68103', {
      foundAt: '2026-09-01T00:00:00.000Z',
      tier: 'secondary',
      suite: 'STE-20',
    }),
  ],
  [
    row('30 Primary New', '68104', {
      foundAt: '2026-08-01T00:00:00.000Z',
      tier: 'primary',
    }),
  ],
);
assertEqual(
  withSecondary.map((r) => r.street).join('|'),
  '30 Primary New|10 Primary Old|20 Secondary New',
  'primary before secondary even if secondary is newer',
);
assertEqual(withSecondary[2].tier, 'secondary', 'secondary last');

const capped = mergeAccumulatedShortlist(
  [
    row('A Oldest', '68102', { foundAt: '2026-01-01T00:00:00.000Z', suite: 'STE-A' }),
    row('B Mid', '68103', { foundAt: '2026-02-01T00:00:00.000Z', suite: 'STE-B' }),
  ],
  [row('C Newest', '68104', { foundAt: '2026-03-01T00:00:00.000Z' })],
  { cap: 2 },
);
assertEqual(capped.length, 2, 'cap 2');
assertEqual(capped.map((r) => r.street).join('|'), 'C Newest|B Mid', 'cap drops oldest');
assert(
  !capped.some((r) => r.street === 'A Oldest'),
  'oldest not kept',
);

console.log('test-address-shortlist-newest: ok');
