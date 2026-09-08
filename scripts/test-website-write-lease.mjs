import {
  assertWebsiteWriteAllowed,
  claimWebsiteWriteLease,
  heartbeatWebsiteWriteLease,
  peekWebsiteWriteLease,
  releaseWebsiteWriteLease,
  resetWebsiteWriteLeasesForTests,
  websiteWriteLockApplies,
} from '../ops/lib/website-write-lease.mjs';

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

function assertThrows(fn, code, label) {
  try {
    fn();
    console.error(`${label}: expected throw ${code}`);
    process.exit(1);
  } catch (error) {
    if (error.code !== code) {
      console.error(`${label}: got code ${error.code}, want ${code} (${error.message})`);
      process.exit(1);
    }
  }
}

resetWebsiteWriteLeasesForTests();
const first = claimWebsiteWriteLease('dan', 'tab-1');
assertEqual(first.ok, true, 'first claim ok');
assertEqual(first.mine, true, 'first claim mine');

const second = claimWebsiteWriteLease('dan', 'tab-2');
assertEqual(second.ok, false, 'second claim blocked');
assertEqual(second.mine, false, 'second claim not mine');
assertEqual(second.holderTabId, 'tab-1', 'second sees holder');

assertWebsiteWriteAllowed('dan', 'tab-1');
assertThrows(() => assertWebsiteWriteAllowed('dan', 'tab-2'), 'WEBSITE_WRITE_LOCKED', 'tab-2 save');

heartbeatWebsiteWriteLease('dan', 'tab-1');
assertThrows(() => heartbeatWebsiteWriteLease('dan', 'tab-2'), 'WEBSITE_WRITE_LOCKED', 'tab-2 heartbeat');

const stolen = claimWebsiteWriteLease('dan', 'tab-2', { takeover: true });
assertEqual(stolen.ok, true, 'takeover ok');
assertEqual(stolen.mine, true, 'takeover mine');
assertWebsiteWriteAllowed('dan', 'tab-2');
assertThrows(() => assertWebsiteWriteAllowed('dan', 'tab-1'), 'WEBSITE_WRITE_LOCKED', 'tab-1 after steal');

releaseWebsiteWriteLease('dan', 'tab-2');
assertEqual(peekWebsiteWriteLease('dan'), null, 'released');
assertWebsiteWriteAllowed('dan', 'tab-1');
assertEqual(peekWebsiteWriteLease('dan')?.holderTabId, 'tab-1', 'auto-claim on write');

resetWebsiteWriteLeasesForTests();
const ann = claimWebsiteWriteLease('ann', 'tab-1');
const dan = claimWebsiteWriteLease('dan', 'tab-2');
assertEqual(ann.ok && ann.mine, true, 'tab-1 holds Ann');
assertEqual(dan.ok && dan.mine, true, 'tab-2 holds Dan');
assertWebsiteWriteAllowed('ann', 'tab-1');
assertWebsiteWriteAllowed('dan', 'tab-2');
assertEqual(
  websiteWriteLockApplies({ selectedId: 'dan', leaseCandidateId: 'ann', mine: false }),
  false,
  'stale Ann lock does not apply on Dan',
);
assertEqual(
  websiteWriteLockApplies({ selectedId: 'dan', leaseCandidateId: 'dan', mine: false }),
  true,
  'same-row lock applies',
);

resetWebsiteWriteLeasesForTests();
console.log('test-website-write-lease: ok');
