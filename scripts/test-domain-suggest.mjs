/**
 * Local Exact Match domain suggestions (city-first, no Claude).
 * Run: node scripts/test-domain-suggest.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  domainToken,
  expandNicheDomainPattern,
  mergeNicheDomainSuggestions,
  nicheHeadToken,
  normalizeNicheDomainPattern,
  suggestExactMatchDomains,
} from '../ops/public/domain-suggest.mjs';
import {
  addNicheDomainPattern,
  listNicheDomainPatterns,
  removeNicheDomainPattern,
} from '../ops/lib/niche-domain-patterns.mjs';

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

const savedPattern = normalizeNicheDomainPattern('[City]SewerPros.com');
assert(savedPattern.ok, 'pattern ok');
assertEqual(savedPattern.pattern, '[City]SewerPros.com', 'pattern keeps typed name');
assertEqual(expandNicheDomainPattern('[City]SewerPros.com', 'Dayton'), 'daytonsewerpros.com', 'Dayton expand');
assertEqual(
  expandNicheDomainPattern('[city]SewerPros', 'Sierra Vista'),
  'sierravistasewerpros.com',
  'two-word city and missing .com',
);
assert(!normalizeNicheDomainPattern('sewerpros.com').ok, 'pattern requires [City]');
assert(!normalizeNicheDomainPattern('[City]SewerPros.net').ok, 'only .com');
assert(!normalizeNicheDomainPattern('[City].com').ok, 'name required');

const merged = mergeNicheDomainSuggestions(
  [
    { domain: 'daytontrechnlesssewerrepair.com', available: null, note: 'exact niche+primary city' },
    { domain: 'daytonsewerpros.com', available: true, note: 'old row' },
  ],
  ['[City]SewerPros.com'],
  'Dayton',
);
assertEqual(merged[0].domain, 'daytonsewerpros.com', 'saved host first');
assertEqual(merged[0].note, 'saved for this niche', 'saved note');
assertEqual(merged[0].available, true, 'keeps availability');
assertEqual(merged[1].domain, 'daytontrechnlesssewerrepair.com', 'exact host remains');
assertEqual(merged.length, 2, 'no duplicate saved host');
assertEqual(
  mergeNicheDomainSuggestions(merged, [], 'Dayton').map((row) => row.domain).join('|'),
  'daytontrechnlesssewerrepair.com',
  'removing the pattern drops the saved host',
);

const dir = mkdtempSync(path.join(os.tmpdir(), 'niche-pat-'));
const file = path.join(dir, 'niche-domain-patterns.json');
try {
  const added = addNicheDomainPattern('Trenchless Sewer Repair', '[City]SewerPros.com', file);
  assertEqual(added.niche, 'trenchless sewer repair', 'niche key');
  assertEqual(added.pattern, '[City]SewerPros.com', 'stored pattern');
  assert(added.added, 'first add');
  const again = addNicheDomainPattern('trenchless sewer repair', '[city]sewerpros.com', file);
  assertEqual(again.patterns.length, 1, 'pattern deduped');
  assert(!again.added, 'second add');
  assertEqual(
    listNicheDomainPatterns('TRENCHLESS  SEWER   REPAIR', file)[0],
    '[City]SewerPros.com',
    'list by niche',
  );
  const removed = removeNicheDomainPattern('trenchless sewer repair', '[City]SewerPros.com', file);
  assertEqual(removed.patterns.length, 0, 'pattern removed');
  assertEqual(listNicheDomainPatterns('trenchless sewer repair', file).length, 0, 'list empty');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('test-domain-suggest: ok');
