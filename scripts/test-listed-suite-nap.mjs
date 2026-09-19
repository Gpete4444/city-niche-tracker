/**
 * Listed LoopNet/Crexi suites for NAP — never invent STE-*.
 * Run: node scripts/test-listed-suite-nap.mjs
 */
import {
  composeNapStreet,
  extractListedSuites,
  listingNeedsSuiteDetails,
  mergeAccumulatedShortlist,
  parseHomeAddressLine,
  sanitizeListedSuite,
  screenedNeedsListedSuiteRepick,
  splitNapStreet,
  splitSuiteFromCity,
  stripInventedSuite,
} from '../ops/lib/address-screen.mjs';
import { normalizeSiteAddress } from '../ops/lib/site-config.mjs';

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

assertEqual(sanitizeListedSuite('STE-100'), '', 'drop invented STE-100');
assertEqual(sanitizeListedSuite('STE-150'), '', 'drop invented STE-150');
assertEqual(sanitizeListedSuite('Ste 1'), 'Ste 1', 'keep Ste 1');
assertEqual(sanitizeListedSuite('Suite 1100'), 'Ste 1100', 'Suite → Ste');
assertEqual(sanitizeListedSuite('Unit 4'), 'Ste 4', 'Unit → Ste');
assertEqual(sanitizeListedSuite('1st Floor'), '', 'floor-only is not a suite');
assertEqual(sanitizeListedSuite('suites'), '', 'do not parse suites as Ste s');
assertEqual(extractListedSuites('a suite of services').join('|'), '', 'suite of services');
assertEqual(
  extractListedSuites({ fullDescription: 'We lease several suites on the second floor' }).join('|'),
  '',
  'do not walk marketing copy',
);

assertEqual(
  extractListedSuites({
    Raw: JSON.stringify({
      availableSpaces: [{ space: '1st Floor, Ste 1' }, { space: '1st Floor, Ste 2' }],
    }),
  }).join('|'),
  'Ste 1|Ste 2',
  'parse one-api Raw JSON string',
);

const plaza = extractListedSuites({
  spaces: [
    '1st Floor, Ste 1',
    '1st Floor, Ste 2',
    '1st Floor, Ste 7',
  ],
});
assertEqual(plaza.join('|'), 'Ste 1|Ste 2|Ste 7', 'University Plaza spaces');

const floorOnly = extractListedSuites({ spaces: ['1st Floor', 'Retail', 'Shell Space'] });
assertEqual(floorOnly.join('|'), '', 'La Cima floor-only');

const preston = extractListedSuites({
  spaces: ['Ground, Ste 1100', 'Ground, Ste 1200'],
});
assertEqual(preston.join('|'), 'Ste 1100|Ste 1200', 'Preston suites');

assertEqual(composeNapStreet('1221 E University Dr', 'Ste 3'), '1221 E University Dr, Ste 3', 'compose');
assertEqual(composeNapStreet('1221 E University Dr, STE-100', 'Ste 1'), '1221 E University Dr, Ste 1', 'compose strips stub');
assertEqual(composeNapStreet('1501 E University Dr', ''), '1501 E University Dr', 'no suite');
assertEqual(splitNapStreet('1221 E University Dr, Ste 3').street, '1221 E University Dr', 'split street');
assertEqual(splitNapStreet('1221 E University Dr, Ste 3').suite, 'Ste 3', 'split suite');
assertEqual(stripInventedSuite('123 Main St Ste 200'), '123 Main St Ste 200', 'keep listing suite on street');

const merged = mergeAccumulatedShortlist(
  [
    {
      street: '1221 E University Dr',
      zip: '75078',
      city: 'Prosper',
      state: 'TX',
      foundAt: '2026-01-01T00:00:00.000Z',
      suite: 'Ste 3',
    },
  ],
  [],
);
assertEqual(merged[0]?.suite, 'Ste 3', 'merge keeps listed suite');
assertEqual(merged[0]?.street, '1221 E University Dr', 'merge street stays base');

const stubbed = mergeAccumulatedShortlist(
  [
    {
      street: '100 Old St, STE-100',
      zip: '68102',
      city: 'Omaha',
      state: 'NE',
      foundAt: '2026-01-01T00:00:00.000Z',
      suite: 'STE-100',
    },
  ],
  [],
);
assertEqual(stubbed[0]?.street, '100 Old St', 'merge strips invented street stub');
assertEqual(stubbed[0]?.suite || '', '', 'merge drops invented suite');

const replaced = mergeAccumulatedShortlist(
  [
    {
      street: '1221 E University Dr',
      zip: '75078',
      city: 'Prosper',
      state: 'TX',
      foundAt: '2026-01-01T00:00:00.000Z',
      suite: 'STE-100',
    },
  ],
  [
    {
      street: '1221 E University Dr',
      zip: '75078',
      city: 'Prosper',
      state: 'TX',
      foundAt: '2026-09-16T00:00:00.000Z',
      suite: 'Ste 1',
      listedSuites: ['Ste 1', 'Ste 2'],
    },
  ],
);
assertEqual(replaced[0]?.suite, 'Ste 1', 're-screen replaces STE-100 with listed Ste 1');
assertEqual(
  replaced[0]?.listedSuites?.join('|'),
  'Ste 1|Ste 2',
  're-screen keeps listedSuites',
);

assert(
  listingNeedsSuiteDetails({
    url: 'https://www.loopnet.com/Listing/1221-E-University-Dr-Prosper-TX/41208028/',
  }),
  'empty listing with URL needs details',
);
assert(
  !listingNeedsSuiteDetails({
    url: 'https://www.loopnet.com/Listing/1221-E-University-Dr-Prosper-TX/41208028/',
    listedSuites: ['Ste 1'],
  }),
  'already-listed suites skip details',
);
assert(
  !listingNeedsSuiteDetails({
    url: 'https://www.loopnet.com/Listing/1501-E-University-Dr-Prosper-TX/41919064/',
    suitesFetchedAt: '2026-09-16T00:00:00.000Z',
  }),
  'fetched-empty (floor-only) skips details',
);
assert(
  screenedNeedsListedSuiteRepick(
    { clean: true, fail: null },
    { url: 'https://www.loopnet.com/Listing/1221-E-University-Dr-Prosper-TX/41208028/' },
  ),
  'old clean street-only screen is requeued',
);
assert(
  !screenedNeedsListedSuiteRepick(
    { clean: true, fail: null, suitesFetched: true, suite: 'Ste 1' },
    {
      url: 'https://www.loopnet.com/Listing/1221-E-University-Dr-Prosper-TX/41208028/',
      listedSuites: ['Ste 1'],
    },
  ),
  'already suite-picked screen is not requeued',
);

assertEqual(splitSuiteFromCity('Ste 3 Prosper').suite, 'Ste 3', 'peel suite from city');
assertEqual(splitSuiteFromCity('Ste 3 Prosper').city, 'Prosper', 'peel city remainder');
assertEqual(splitSuiteFromCity('Prosper').city, 'Prosper', 'plain city');

const commaLine = parseHomeAddressLine('1221 E University Dr, Ste 3, Prosper, TX 75078');
assertEqual(commaLine.street, '1221 E University Dr', 'parse Line 1');
assertEqual(commaLine.suite, 'Ste 3', 'parse Line 2 from middle part');
assertEqual(commaLine.city, 'Prosper', 'parse city after suite');

const glued = parseHomeAddressLine('1221 E University Dr, Ste 3 Prosper, TX 75078');
assertEqual(glued.street, '1221 E University Dr', 'glued Line 1');
assertEqual(glued.suite, 'Ste 3', 'glued Line 2');
assertEqual(glued.city, 'Prosper', 'glued city is not Ste 3 Prosper');

const fiveDigit = parseHomeAddressLine(
  '13755 Lyndon B Johnson Freeway, Ste 3 Garland, TX 75041',
);
assertEqual(fiveDigit.street, '13755 Lyndon B Johnson Freeway', '5-digit house number stays street');
assertEqual(fiveDigit.suite, 'Ste 3', '5-digit line keeps glued suite');
assertEqual(fiveDigit.city, 'Garland', '5-digit line city');
assertEqual(fiveDigit.state, 'TX', '5-digit line state');
assertEqual(fiveDigit.zip, '75041', '5-digit line uses trailing ZIP not house number');

const fiveDigitPlain = parseHomeAddressLine('11016 S First St, Garland, TX 75040');
assertEqual(fiveDigitPlain.street, '11016 S First St', '5-digit shortlist street');
assertEqual(fiveDigitPlain.zip, '75040', '5-digit shortlist ZIP');

let fiveDigitNoZipErr = '';
try {
  parseHomeAddressLine('13755 Lyndon B Johnson Freeway, Garland, TX');
} catch (error) {
  fiveDigitNoZipErr = error.message;
}
assertEqual(fiveDigitNoZipErr, 'ZIP code required (5 digits)', '5-digit house number is not a ZIP');

const norm = normalizeSiteAddress({
  street: '1221 E University Dr, Ste 3',
  city: 'Ste 3 Prosper',
  state: 'TX',
  zip: '75078',
});
assertEqual(norm.street, '1221 E University Dr', 'normalize Line 1');
assertEqual(norm.suite, 'Ste 3', 'normalize Line 2');
assertEqual(norm.city, 'Prosper', 'normalize city');

console.log('test-listed-suite-nap: ok');
