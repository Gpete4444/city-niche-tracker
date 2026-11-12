/**
 * LoopNet primary vs backup decision, and the backup actor input.
 * Run: node scripts/test-loopnet-fallback.mjs
 */
import {
  buildApifyAbotapiLoopnetInput,
  buildApifyLoopnetFallbackInput,
  buildApifyOneApiLoopnetInput,
  listingNeedsDetails,
  loopnetPrimaryDecision,
  mergeLoopnetDetailItems,
  normalizeListing,
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

const abotapi = buildApifyAbotapiLoopnetInput({
  city: 'Meridian',
  state: 'ID',
  max: 20,
  actorId: 'abotapi~loopnet-scraper',
});
assert(abotapi.input.mode === 'url', 'abotapi mode is url');
assert(abotapi.input.fetchDetails === true, 'abotapi fetches listing pages for streets');
assert(abotapi.input.maxListings === 40, 'abotapi cap is the per-URL max times two');
assert(abotapi.input.urls.length === 2, 'abotapi sends office and retail');
assert(
  abotapi.input.urls[0].includes('/office-space/') && abotapi.input.urls[0].endsWith('/for-lease/'),
  'office lease url',
);
assert(
  abotapi.input.urls[1].includes('/retail-space/') && abotapi.input.urls[1].endsWith('/for-lease/'),
  'retail lease url',
);
assert(abotapi.query.usedFallback === true, 'abotapi query is marked');
assert(abotapi.query.searchUrls.length === 2, 'abotapi query keeps the search urls');

const oneApi = buildApifyOneApiLoopnetInput({
  city: 'Meridian',
  state: 'ID',
  max: 20,
  actorId: 'one-api~loopnet-scraper',
});
assert(Array.isArray(oneApi.input.search_inputs), 'one-api search uses search_inputs');
assert(oneApi.input.search_inputs.length === 2, 'one-api sends office and retail');
assert(oneApi.input.pages === 1, 'a 20-listing pull is one page');
assert(oneApi.input.resultCount === 20, 'one-api resultCount is the per-URL max');
assert(oneApi.input.fetchDetails == null, 'one-api search does not open listing pages');
assert(
  oneApi.input.search_inputs[0].includes('/office-space/') &&
    oneApi.input.search_inputs[0].endsWith('/for-lease/'),
  'one-api office lease url',
);
assert(oneApi.query.actorId === 'one-api~loopnet-scraper', 'one-api actor id');
assert(oneApi.query.usedFallback === true, 'one-api query is marked');

const deep = buildApifyOneApiLoopnetInput({
  city: 'Meridian',
  state: 'ID',
  max: 250,
  actorId: 'one-api~loopnet-scraper',
});
assert(deep.input.resultCount === 100, 'one-api resultCount stays within the actor max');
assert(deep.input.pages === 3, 'deeper pulls add pages');

const explicitAbotapi = buildApifyLoopnetFallbackInput({
  city: 'Meridian',
  state: 'ID',
  max: 20,
  actorId: 'abotapi~loopnet-scraper',
});
assert(explicitAbotapi.input.fetchDetails === true, 'an explicit abotapi id keeps the listing-page input');

if (!process.env.APIFY_LOOPNET_FALLBACK_ACTOR_ID) {
  const fallback = buildApifyLoopnetFallbackInput({
    city: 'Meridian',
    state: 'ID',
    max: 20,
  });
  assert(fallback.input.search_inputs.length === 2, 'the default fallback is a one-api search');
  assert(fallback.query.actorId === 'one-api~loopnet-scraper', 'the default fallback actor is one-api');
}

const searchRow = normalizeListing({
  Title: '1221 E University Dr',
  City: 'Prosper',
  State: 'TX',
  ZIP: '75078',
  'Property Type': 'Office',
  'Listing URL': 'https://www.loopnet.com/Listing/1221-E-University-Dr-Prosper-TX/41208028/',
});
assert(searchRow.street === '1221 E University Dr', 'one-api Title is the street');
assert(searchRow.city === 'Prosper', 'one-api City');
assert(searchRow.state === 'TX', 'one-api State');
assert(searchRow.zip === '75078', 'one-api ZIP');
assert(searchRow.propertyType === 'Office', 'one-api Property Type');
assert(
  searchRow.url === 'https://www.loopnet.com/Listing/1221-E-University-Dr-Prosper-TX/41208028/',
  'one-api Listing URL',
);
assert(listingNeedsDetails(searchRow), 'a search row with no suite still needs details');

const titled = normalizeListing({
  Title: '1221 E University Dr, Prosper, TX 75078',
  'Listing URL': 'https://www.loopnet.com/Listing/1221-E-University-Dr-Prosper-TX/41208028',
});
assert(titled.street === '1221 E University Dr', 'a full Title keeps the street');
assert(titled.zip === '75078', 'a full Title keeps the ZIP');

const withSuite = normalizeListing({
  Title: '10 Main St',
  City: 'Boise',
  State: 'ID',
  ZIP: '83702',
  Spaces: 'Suite 200 — 1,200 SF',
  Description: 'Existing office.',
  'Listing URL': 'https://www.loopnet.com/Listing/10-Main-St-Boise-ID/1/',
});
assert(withSuite.listedSuites[0] === 'Ste 200', 'search Spaces become a suite label');
assert(!listingNeedsDetails(withSuite), 'a complete search row skips the details run');

const merged = mergeLoopnetDetailItems([searchRow], [
  {
    'Input Given': 'https://www.loopnet.com/Listing/1221-E-University-Dr-Prosper-TX/41208028/',
    'Listing URL': 'https://www.loopnet.com/Listing/1221-E-University-Dr-Prosper-TX/41208028',
    Spaces: 'Suite 3',
    Description: 'Second-floor office.',
    'Building Info': 'Year Built: 1998',
  },
]);
assert(merged[0].listedSuites[0] === 'Ste 3', 'one details row fills the suite');
assert(merged[0].yearBuilt === 1998, 'one details row fills the year');
assert(!listingNeedsDetails(merged[0]), 'a merged row does not need another details run');

console.log('loopnet fallback ok');
