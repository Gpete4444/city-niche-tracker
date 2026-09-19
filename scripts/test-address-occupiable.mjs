/**
 * Unbuilt / not-yet-available listing screen.
 * Run: node scripts/test-address-occupiable.mjs
 */
import {
  listingOccupiablePass,
  listingTextFromRaw,
  listingNeedsOccupiableDetails,
  listingHasOccupiableFacts,
  screenedNeedsOccupiableRecheck,
} from '../ops/lib/address-screen.mjs';

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

function assertRejects(listing, label) {
  const r = listingOccupiablePass(listing);
  assert(!r.ok, `${label}: expected reject, got ${r.reason}`);
  assert(/^unbuilt \/ not available/i.test(r.reason), `${label}: reason ${r.reason}`);
}

function assertAllows(listing, label) {
  const r = listingOccupiablePass(listing);
  assert(r.ok, `${label}: expected allow, got ${r.reason}`);
}

assertRejects({ listingText: 'Retail To Be Built on Preston' }, 'To Be Built');
assertRejects({ summary: 'Office under construction — pre-lease' }, 'Under Construction');
assertRejects(
  { propertyFacts: [{ name: 'Building Status', value: ['Proposed'] }] },
  'Building Status Proposed',
);
assertRejects({ buildingStatus: 'Proposed' }, 'buildingStatus Proposed');
assertRejects({ yearBuilt: 2028 }, 'yearBuilt 2028');
assertRejects(
  { propertyFacts: [{ name: 'Year Built', value: ['2028'] }] },
  'Year Built fact 2028',
);

const later = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
assertRejects({ availableDate: later.toISOString() }, 'availableDate 90 days out');
assertRejects(
  {
    propertyFacts: [{ name: 'Date Available', value: [later.toISOString().slice(0, 10)] }],
  },
  'Date Available fact 90 days out',
);
assertRejects({ headline: 'Coming soon — pre-leasing now' }, 'coming soon / pre-leasing');
assertRejects({ fullDescription: 'Ground-up office, future delivery 2028' }, 'ground-up / future delivery');

const thisYear = new Date().getFullYear();
assertAllows(
  { name: 'New Construction Retail', yearBuilt: thisYear },
  'New Construction + current year',
);
assertAllows(
  { name: 'New Construction Retail', yearBuilt: thisYear - 1 },
  'New Construction + last year',
);
assertAllows({ listingText: 'Shell Space, Available Now' }, 'Shell Space / Available Now');
assertAllows({}, 'empty listing');
assertAllows({ listingText: '' }, 'empty text');
assertAllows(
  { fullDescription: 'We lease several suites on the second floor' },
  'marketing several suites is not a status hit',
);
assertAllows({ availableDate: 'Available Now' }, 'Available Now date');

const text = listingTextFromRaw({
  headline: '120 S Preston',
  propertyFacts: [{ name: 'Building Status', value: ['Existing'] }],
});
assert(text.includes('120 S Preston'), 'listingText includes headline');
assert(text.includes('Building Status: Existing'), 'listingText includes fact');

assertEqual(listingOccupiablePass({ yearBuilt: thisYear }).ok, true, 'current year built ok');
assertAllows({ yearBuilt: thisYear }, 'yearBuilt current year with no UC text');
assertRejects({ yearBuilt: thisYear + 1 }, 'yearBuilt next year');

const oneApiUc = {
  Title: 'Alma & Exchange Retail | 12477 Alma Dr',
  Description: '2,845 SF of Retail Space Available',
  'Building Info': 'Year Built: 2026 Construction Status: Under Construction',
};
const oneApiText = listingTextFromRaw(oneApiUc);
assert(oneApiText.includes('Building Info') || oneApiText.includes('Under Construction'), 'one-api Building Info mapped');
assert(oneApiText.includes('Under Construction'), 'one-api Construction Status in listing text');
assertRejects(oneApiUc, 'one-api Under Construction + year built this year');

assertRejects(
  { 'Construction Status': 'Coming Soon' },
  'Construction Status Coming Soon',
);

assert(
  !listingHasOccupiableFacts({
    street: '1247 Alma Dr',
    url: 'https://www.loopnet.com/Listing/1247-Alma-Dr-Allen-TX/38096192/',
    listingText: '',
    suitesFetchedAt: '2026-09-17T21:15:39.227Z',
  }),
  'empty listingText is not occupiable facts',
);
assert(
  listingNeedsOccupiableDetails({
    street: '1247 Alma Dr',
    url: 'https://www.loopnet.com/Listing/1247-Alma-Dr-Allen-TX/38096192/',
    listingText: '',
    suitesFetchedAt: '2026-09-17T21:15:39.227Z',
  }),
  'needs occupiable details after suite fetch with empty text',
);
assert(
  !listingNeedsOccupiableDetails({
    street: '1247 Alma Dr',
    url: 'https://www.loopnet.com/Listing/1247-Alma-Dr-Allen-TX/38096192/',
    listingText: '',
    occupiableFetchedAt: '2026-09-17T21:15:39.227Z',
  }),
  'does not refetch occupiable forever',
);
assert(
  screenedNeedsOccupiableRecheck(
    { clean: true, fail: null },
    {
      street: '1247 Alma Dr',
      zip: '75013',
      url: 'https://www.loopnet.com/Listing/1247-Alma-Dr-Allen-TX/38096192/',
      listingText: '',
    },
  ),
  'requeue clean key without listing facts',
);
assert(
  !screenedNeedsOccupiableRecheck(
    { clean: true, fail: null },
    { listingText: 'Year Built: 2005 Construction Status: Existing' },
  ),
  'do not requeue when facts exist',
);

console.log('test-address-occupiable: ok');
