/**
 * Primary-only sites: empty targetSuburbs must parse; empty-string items must not.
 * Run: npx tsx scripts/test-site-config-schema.mjs
 */
import { siteConfigSchema } from '../src/config/site.ts';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

const base = {
  businessName: 'Test Lift',
  tagline: 'We lift slabs',
  domain: 'example.com',
  niche: 'Concrete Lifting',
  primaryCity: 'The Colony',
  state: 'TX',
  phone: '+15555550100',
  email: 'leads@example.com',
  web3FormsAccessKey: 'REPLACE_WEB3FORMS_KEY',
  primaryCta: 'Get a Free Estimate',
  services: ['Concrete lifting'],
  brand: { primary: '#1C2B3A', accent: '#E8A317', ink: '#0F1720' },
};

const empty = siteConfigSchema.parse({ ...base, targetSuburbs: [] });
assert(Array.isArray(empty.targetSuburbs) && empty.targetSuburbs.length === 0, 'empty targetSuburbs parses');

const missing = siteConfigSchema.parse({ ...base });
assert(Array.isArray(missing.targetSuburbs) && missing.targetSuburbs.length === 0, 'missing targetSuburbs defaults to []');

const withTown = siteConfigSchema.parse({ ...base, targetSuburbs: ['Little Elm'] });
assert(withTown.targetSuburbs[0] === 'Little Elm', 'non-empty targetSuburbs still parse');

let rejected = false;
try {
  siteConfigSchema.parse({ ...base, targetSuburbs: [''] });
} catch {
  rejected = true;
}
assert(rejected, 'empty-string suburb item is rejected');

console.log('test-site-config-schema: ok');
