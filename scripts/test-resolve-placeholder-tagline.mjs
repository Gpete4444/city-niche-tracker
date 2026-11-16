/**
 * Placeholder tagline resolves from the homepage description, and the default
 * social-proof seed still supplies the 15+ / 500+ / Licensed row.
 * Run: npx tsx scripts/test-resolve-placeholder-tagline.mjs
 */
import {
  assertTaglineReady,
  homepageDescriptionFromMarkdown,
  isPlaceholderTagline,
  resolvePlaceholderTagline,
  SITE_CONFIG_PLACEHOLDERS,
} from '../ops/lib/site-config.mjs';
import {
  publicTagline,
  socialProofIsDefaultSeed,
  trustStripLicenses,
  trustStripStatistics,
} from '../src/config/site.ts';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

const description =
  'Foundation repair in Midvale, UT: crack injection, piering, wall stabilization, and basement waterproofing. Free estimates from a local crew.';
const markdown = `---
title: "Foundation Repair in Midvale, UT"
description: "${description}"
h1: "Foundation Repair in Midvale, UT"
---

Body.
`;

assert(homepageDescriptionFromMarkdown(markdown) === description, 'homepage description is read from frontmatter');
assert(isPlaceholderTagline(SITE_CONFIG_PLACEHOLDERS.tagline), 'TBD token is a placeholder tagline');
assert(isPlaceholderTagline(''), 'blank tagline is a placeholder');
assert(!isPlaceholderTagline(description), 'a real sentence is not a placeholder');

const files = { 'src/content/pages/index.md': markdown };
const resolved = resolvePlaceholderTagline({ tagline: SITE_CONFIG_PLACEHOLDERS.tagline, businessName: 'Midvale Foundation Pros' }, files);
assert(resolved.resolved, 'TBD tagline resolves');
assert(resolved.tagline === description, 'resolved tagline is the homepage description');
assert(resolved.config.businessName === 'Midvale Foundation Pros', 'resolver keeps the rest of the config');

const kept = resolvePlaceholderTagline({ tagline: 'Local crews. Clear estimates.' }, files);
assert(!kept.resolved, 'a written tagline is left alone');
assert(kept.tagline === 'Local crews. Clear estimates.', 'written tagline is unchanged');

const blocked = resolvePlaceholderTagline(
  { tagline: SITE_CONFIG_PLACEHOLDERS.tagline },
  { 'src/content/pages/index.md': `---\ndescription: "${SITE_CONFIG_PLACEHOLDERS.tagline}"\n---\n` },
);
assert(!blocked.resolved, 'a placeholder description does not become the tagline');

let threw = false;
try {
  assertTaglineReady({ tagline: SITE_CONFIG_PLACEHOLDERS.tagline }, 'Assemble test');
} catch (error) {
  threw = true;
  assert(String(error.message).includes(SITE_CONFIG_PLACEHOLDERS.tagline), 'block names the token');
  assert(error.placeholders.includes('tagline'), 'scan still flags tagline');
}
assert(threw, 'assemble/ship gate throws while the token remains');
assertTaglineReady({ tagline: description, businessName: 'Midvale Foundation Pros' }, 'Assemble test');

assert(publicTagline(SITE_CONFIG_PLACEHOLDERS.tagline) === '', 'template omits the token');
assert(publicTagline(description) === description, 'template prints a real tagline');

const seedProof = {
  rating: { value: 4.9, reviewCount: 47, source: 'Google', url: '' },
  licenses: [{ name: 'Licensed & Insured', jurisdiction: 'UT' }],
  statistics: [
    { value: '15+', label: 'Years local experience' },
    { value: '500+', label: 'Projects completed' },
    { value: '4.9★', label: 'Average customer rating' },
  ],
  reviews: [
    {
      quote: 'Honestly did not expect such a professional team. They showed up on time.',
      author: 'David C.',
    },
  ],
};
assert(socialProofIsDefaultSeed(seedProof), 'seed quote is recognized');
assert(trustStripStatistics(seedProof).length === 2, 'seed statistics stay, rating duplicate drops');
assert(trustStripStatistics(seedProof)[0].value === '15+', 'years stat stays');
assert(trustStripStatistics(seedProof)[1].value === '500+', 'projects stat stays');
assert(trustStripLicenses(seedProof).length === 1, 'seed Licensed & Insured line stays');
assert(trustStripLicenses(seedProof)[0].name === 'Licensed & Insured', 'license name stays');

const realProof = {
  rating: { value: 4.8, reviewCount: 12, source: 'Google', url: 'https://example.com/reviews' },
  licenses: [{ name: 'Utah contractor license' }],
  statistics: [
    { value: '22', label: 'Years local experience' },
    { value: '4.8★', label: 'Average customer rating' },
  ],
  reviews: [{ quote: 'They fixed the wall and left the yard clean.', author: 'Pat Example' }],
};
assert(!socialProofIsDefaultSeed(realProof), 'a real review is not the seed');
assert(trustStripStatistics(realProof).length === 1, 'real statistics stay, rating duplicate drops');
assert(trustStripStatistics(realProof)[0].value === '22', 'years stat stays');
assert(trustStripLicenses(realProof).length === 1, 'a real license stays');
assert(trustStripLicenses(realProof)[0].name === 'Utah contractor license', 'license name stays');

console.log('test-resolve-placeholder-tagline: ok');
