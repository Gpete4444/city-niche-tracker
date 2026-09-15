/**
 * Local Exact Match domain suggestions (city-first, no Claude).
 * Run: node scripts/test-domain-suggest.mjs
 */
import {
  domainToken,
  nicheHeadToken,
  suggestExactMatchDomains,
} from '../ops/public/domain-suggest.mjs';

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

assertEqual(domainToken('Everett'), 'everett', 'city token');
assertEqual(domainToken('Drywall Repair'), 'drywallrepair', 'niche token');
assertEqual(nicheHeadToken('Drywall Repair'), 'drywall', 'head strips repair');
assertEqual(nicheHeadToken('Egress Window Installation'), 'egresswindow', 'head strips installation');

const drywall = suggestExactMatchDomains({ city: 'Everett', niche: 'Drywall Repair' });
assertEqual(
  drywall.map((r) => r.domain).join('|'),
  [
    'everettdrywallrepair.com',
    'everettdrywallrepairs.com',
    'everettdrywallrepairservice.com',
    'everettdrywallpatch.com',
    'everettdrywallinstallation.com',
    'everettdrywallcontractor.com',
    'everettdrywallfix.com',
    'everettdrywallrepairpros.com',
    'everettdrywallexperts.com',
    'everettdrywallsolutions.com',
  ].join('|'),
  'Everett drywall screenshot hosts',
);
assertEqual(drywall[0].note, 'exact niche+primary city', 'exact note');
assertEqual(drywall[7].note, 'city-first + pros suffix', 'pros note');
assert(
  drywall.every((r) => r.domain.startsWith('everett') && r.domain.endsWith('.com')),
  'city-first .com',
);
assert(
  drywall.every((r) => r.available === null),
  'no WHOIS',
);

const omaha = suggestExactMatchDomains({
  city: 'Omaha',
  niche: 'Egress Window Installation',
});
const omahaHosts = omaha.map((r) => r.domain);
assert(omahaHosts.includes('omahaegresswindowinstallation.com'), 'omaha exact');
assert(omahaHosts.includes('omahaegresswindowinstallationpros.com'), 'omaha +pros');
assertEqual(new Set(omahaHosts).size, omahaHosts.length, 'omaha unique');
assert(
  omahaHosts.every((h) => h.startsWith('omaha') && h.endsWith('.com')),
  'omaha city-first',
);
assert(
  omahaHosts.filter((h) => h === 'omahaegresswindowinstallation.com').length === 1,
  'installation niche does not duplicate exact as head+installation',
);

assertEqual(suggestExactMatchDomains({ city: '', niche: 'Drywall Repair' }).length, 0, 'no city');
assertEqual(suggestExactMatchDomains({ city: 'Everett', niche: '' }).length, 0, 'no niche');

console.log('test-domain-suggest: ok');
