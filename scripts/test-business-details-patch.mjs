/**
 * Business details Apply patch: keep a real phone, and keep suite explicit.
 * Run: node scripts/test-business-details-patch.mjs
 */
import { businessDetailsWritePatch, restoreSiteCityConfig } from '../ops/lib/site-config.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

const kept = businessDetailsWritePatch(
  {
    businessName: 'Mapleton Foundation Pros',
    domain: 'mapletonfoundationpros.com',
    phone: '+1XXXXXXXXXX',
    email: 'leads@mapletonfoundationpros.com',
    street: '768 S 1600 W',
    suite: 'Ste A',
    city: 'Mapleton',
    state: 'ut',
    zip: '84664',
    tagline: 'Foundation repair',
    primaryCta: 'Get a Free Estimate',
    niche: 'Foundation Repair',
    radiusMiles: '15',
    targetSuburbs: 'Springville; Spanish Fork',
  },
  { phone: '+14352955986' },
);
assert(kept.phone === '+14352955986', 'placeholder phone keeps the provisioned number');
assert(kept.address.street === '768 S 1600 W', 'street is written');
assert(kept.address.suite === 'Ste A', 'suite is written');
assert(kept.address.city === 'Mapleton' && kept.address.state === 'UT', 'city and state');
assert(
  kept.primaryCity === 'Mapleton' && kept.state === 'UT',
  'a first write seeds the site city from the form when none is stored',
);
const locked = businessDetailsWritePatch(
  {
    street: '10718 S Beckstead Ln',
    city: 'South Jordan',
    state: 'UT',
    zip: '84095',
  },
  { primaryCity: 'Herriman', state: 'UT', address: { city: 'Herriman', state: 'UT' } },
  { siteCity: 'Herriman' },
);
assert(locked.primaryCity === 'Herriman', 'a neighboring street city does not replace the site city');
assert(locked.address.city === 'South Jordan', 'the street city stays on the address');
assert(locked.address.street === '10718 S Beckstead Ln', 'the street is written');
const keptStored = businessDetailsWritePatch(
  { street: '1 Main', city: 'Draper', state: 'UT', zip: '84020' },
  { primaryCity: 'Bluffdale', state: 'UT' },
);
assert(keptStored.primaryCity === 'Bluffdale', 'stored site city stays when the form only has an address city');
assert(keptStored.address.city === 'Draper', 'address city is still the form city');
assert(kept.targetSuburbs === 'Springville; Spanish Fork', 'suburbs stay a field for the draft writer');

const cleared = businessDetailsWritePatch(
  {
    phone: '(435) 295-5986',
    street: '768 S 1600 W',
    suite: '',
    city: 'Mapleton',
    state: 'UT',
    zip: '84664',
  },
  { phone: '+14352955986' },
);
assert(cleared.phone === '+14352955986', 'the same number keeps the accepted phone');
const changed = businessDetailsWritePatch(
  { phone: '+18015551212', street: '1 Main St', city: 'Orem', state: 'UT', zip: '84057' },
  { phone: '+14352955986' },
);
assert(changed.phone === '+18015551212', 'a different real phone replaces the accepted number');
assert(cleared.address.suite === '', 'blank address line 2 is explicit so a stored suite clears');
assert(!cleared.address.street || cleared.address.street === '768 S 1600 W', 'street remains');

const blank = businessDetailsWritePatch(
  { phone: '', street: '1 Main St', suite: 'Ste 3', city: 'Orem', state: 'UT', zip: '84057' },
  { phone: '+14352955986' },
);
assert(blank.phone === '+14352955986', 'blank phone keeps the provisioned number');
assert(blank.address.suite === 'Ste 3', 'suite survives a blank phone');

const same = businessDetailsWritePatch(
  { phone: '+14352955986', street: '768 S 1600 W', suite: 'Ste A', city: 'Mapleton', state: 'UT', zip: '84664' },
  { phone: '+1 (435) 295-5986' },
);
assert(same.phone === '+1 (435) 295-5986', 'the same number keeps the accepted phone string');

const healed = restoreSiteCityConfig(
  {
    primaryCity: 'South Jordan',
    address: { street: '10718 S Beckstead Ln', city: 'South Jordan', state: 'UT', zip: '84095' },
    targetSuburbs: ['Herriman', 'Riverton'],
  },
  'Herriman',
);
assert(healed.changed, 'a drifted site city is restored');
assert(healed.config.primaryCity === 'Herriman', 'restored primary is the candidate city');
assert(
  healed.config.targetSuburbs.length === 1 && healed.config.targetSuburbs[0] === 'Riverton',
  'the site city is dropped from suburb pages',
);
assert(healed.config.address.city === 'South Jordan', 'restore leaves the street address');
const suburbOnly = restoreSiteCityConfig(
  { primaryCity: 'Herriman', targetSuburbs: ['Herriman', 'Riverton'] },
  'Herriman',
);
assert(suburbOnly.changed && suburbOnly.config.targetSuburbs.join() === 'Riverton', 'site city is not also a suburb page');
const untouched = restoreSiteCityConfig(
  { primaryCity: 'Eagle Mountain', targetSuburbs: ['Cedar Fort'], address: { city: 'Eagle Mountain' } },
  'Eagle Mountain',
);
assert(
  !untouched.changed && untouched.config.primaryCity === 'Eagle Mountain',
  'a matching site city is left alone',
);
const foreign = restoreSiteCityConfig(
  { primaryCity: 'Omaha', state: 'NE', targetSuburbs: ['Bellevue'] },
  'Gilbert',
  { siteState: 'AZ' },
);
assert(!foreign.changed && foreign.config.primaryCity === 'Omaha', 'a different-state config is not rewritten');

console.log('test-business-details-patch: ok');
