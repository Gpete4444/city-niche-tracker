/**
 * LoopNet primary vs backup decision, and the backup actor input.
 * Run: node scripts/test-loopnet-fallback.mjs
 */
import {
  buildApifyAbotapiLoopnetInput,
  loopnetPrimaryDecision,
  solidcodeLoopnetBuildIsCurrent,
} from '../ops/lib/address-screen.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

const stale = {
  taggedBuilds: {
    latest: {
      buildId: 'abcAjK9e1Md7jxBNI',
      buildNumber: '1.0.2',
      finishedAt: '2026-07-31T18:56:12.708Z',
    },
  },
};

const newer = {
  taggedBuilds: {
    latest: {
      buildId: 'newBuild123',
      buildNumber: '1.0.3',
      finishedAt: '2026-11-01T00:00:00.000Z',
    },
  },
};

assert(!solidcodeLoopnetBuildIsCurrent(stale), 'July 31 1.0.2 is not current');
assert(solidcodeLoopnetBuildIsCurrent(newer), 'a later build number is current');

const staleDecision = loopnetPrimaryDecision('solidcode~loopnet-com-scraper', stale, new Set());
assert(staleDecision.usePrimary === false, 'July 31 build skips Solidcode');
assert(staleDecision.reason === 'stale-build', 'stale reason');

const currentDecision = loopnetPrimaryDecision('solidcode~loopnet-com-scraper', newer, new Set());
assert(currentDecision.usePrimary === true, 'newer build runs Solidcode');
assert(currentDecision.reason === 'current', 'current reason');

const remembered = loopnetPrimaryDecision(
  'solidcode~loopnet-com-scraper',
  newer,
  new Set(['newBuild123']),
);
assert(remembered.usePrimary === false, 'a newer build that returned no streets is skipped');
assert(remembered.reason === 'remembered-fail', 'remembered reason');

const lookupFailed = loopnetPrimaryDecision('solidcode~loopnet-com-scraper', null, new Set());
assert(lookupFailed.usePrimary === true, 'a failed actor lookup still tries Solidcode');
assert(lookupFailed.reason === 'lookup-failed', 'lookup reason');

const custom = loopnetPrimaryDecision('someone~other-loopnet', stale, new Set());
assert(custom.usePrimary === true, 'a non-Solidcode actor stays the only scraper');
assert(custom.reason === 'custom-actor', 'custom reason');

const built = buildApifyAbotapiLoopnetInput({
  city: 'Meridian',
  state: 'ID',
  max: 20,
  actorId: 'abotapi~loopnet-scraper',
});
assert(built.input.mode === 'url', 'backup mode is url');
assert(built.input.fetchDetails === true, 'backup fetches listing pages for streets');
assert(built.input.maxListings === 40, 'backup cap is the per-URL max times two');
assert(built.input.urls.length === 2, 'backup sends office and retail');
assert(
  built.input.urls[0].includes('/office-space/') && built.input.urls[0].endsWith('/for-lease/'),
  'office lease url',
);
assert(
  built.input.urls[1].includes('/retail-space/') && built.input.urls[1].endsWith('/for-lease/'),
  'retail lease url',
);
assert(built.query.usedFallback === true, 'backup query is marked');
assert(built.query.searchUrls.length === 2, 'backup query keeps the search urls');

console.log('loopnet fallback ok');
