/**
 * Bookend + location section mix + CTA heading exemption.
 * Run: node scripts/test-bookend-policy.mjs
 */
import {
  assignBookendPolicy,
  assignLocationSectionPolicy,
} from '../ops/lib/bookend-policy.mjs';
import { lintContentSeo } from '../ops/lib/content-seo-lint.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

const files = [
  'src/content/pages/index.md',
  'src/content/pages/about.md',
  'src/content/pages/contact.md',
  'src/content/services/hole-patch.md',
  'src/content/services/water-damage.md',
  'src/content/locations/spanish-springs.md',
  'src/content/locations/sun-valley.md',
];

const a = assignBookendPolicy({
  candidateId: 'demo',
  filePaths: files,
  enabledSectionIds: ['cta', 'svcCta', 'locCta'],
});
const b = assignBookendPolicy({
  candidateId: 'demo',
  filePaths: files,
  enabledSectionIds: ['cta', 'svcCta', 'locCta'],
});

assert(JSON.stringify(a) === JSON.stringify(b), 'same candidate is stable');
assert(a['src/content/pages/about.md']?.opener === 'minimal', 'about opener is minimal');
assert(a['src/content/pages/about.md']?.closer === 'skip', 'about closer is skip');
assert(a['src/content/pages/contact.md']?.closer === 'skip', 'contact closer is skip');
assert(a['src/content/pages/index.md']?.closer === 'skip', 'home closer skips when cta is on');
assert(a['src/content/services/hole-patch.md']?.closer === 'skip', 'service closer skips when svcCta is on');
assert(
  a['src/content/locations/spanish-springs.md']?.closer === 'skip',
  'location closer skips when locCta is on',
);

const openers = new Set(Object.values(a).map((row) => row.opener));
assert(openers.size >= 2, 'openers vary across files');

const noCta = assignBookendPolicy({
  candidateId: 'demo',
  filePaths: ['src/content/services/hole-patch.md'],
  enabledSectionIds: [],
});
assert(
  noCta['src/content/services/hole-patch.md']?.closer !== 'skip',
  'service closer is not skip without svcCta',
);

const loc = assignLocationSectionPolicy({
  suburbs: ['Sparks', 'Spanish Springs', 'Sun Valley'],
  enabledSectionIds: ['locIntro', 'locLocalNotes', 'locProof', 'locFaqs', 'locCta'],
});
const shapes = new Set(Object.values(loc).map((row) => row.shape));
assert(shapes.size >= 2, 'location shapes rotate');
assert(
  Object.values(loc).some((row) => row.emit.includes('locFaqs')),
  'at least one suburb keeps FAQs',
);
assert(
  Object.values(loc).some((row) => !row.emit.includes('locFaqs')),
  'at least one suburb skips FAQs',
);
assert(
  Object.values(loc).every((row) => row.emit.includes('locCta')),
  'every suburb keeps locCta',
);

const headingOnly = lintContentSeo({
  'src/content/pages/index.md': `---
title: Drywall Repair Sparks
h1: Drywall Repair Sparks
---
## Get a free estimate
Use the form. We reply the same day.
`,
  'src/content/services/hole-patch.md': `---
title: Hole Patch
h1: Hole Patch
---
## Request a quote
Tell us the hole size.
`,
});
assert(
  !headingOnly.findings.some((f) => f.rule === 'missing_closing_cta'),
  'registry CTA H2 satisfies missing_closing_cta',
);

console.log('test-bookend-policy: ok');
