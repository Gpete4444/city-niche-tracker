/**
 * Materials H2s that the site treats as Materials & methods must yield Review titles.
 * Run: npx tsx scripts/test-materials-heading.mjs
 */
import { isMaterialsHeading } from '../src/lib/is-materials-heading.mjs';
import { isProcessHeading } from '../src/lib/is-process-heading.mjs';
import { parseServiceBody } from '../src/lib/service-body.ts';
import { extractHomepageProseSections } from '../src/lib/content-body.ts';
import { listMaterialOptions } from '../ops/lib/fill-site-images.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

function assertEqual(got, want, label) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) {
    console.error(`${label}: got ${a}, want ${b}`);
    process.exit(1);
  }
}

assert(isMaterialsHeading('Materials and methods we use'), 'default heading');
assert(isMaterialsHeading('Materials & methods'), 'ampersand');
assert(isMaterialsHeading('Materials for Driveway Leveling'), 'materials for service');
assert(
  isMaterialsHeading('Foam Concrete Lifting Near Me: Materials and Methods We Use'),
  'SEO-prefixed homepage heading',
);
assert(isMaterialsHeading('Methods we use'), 'methods we use');
assert(!isMaterialsHeading('Our Repair Process'), 'process is not materials');
assert(!isProcessHeading('Materials and Methods'), 'materials is not process');
assert(!isMaterialsHeading('What does a repair cost?'), 'cost is not materials');
assert(!isMaterialsHeading('How long does Concrete Lifting take?'), 'timeline is not materials');
assert(
  isMaterialsHeading('Mudjacking and Foam Concrete Lifting Methods in Wylie, TX'),
  'SEO Methods-in-city homepage heading',
);
assert(isMaterialsHeading('Materials and equipment we bring'), 'materials and without methods');

const bullets = `- **Two-part polyurethane foam**: Expands within seconds of injection, adding almost no weight.
- **Cementitious slurry mix**: A cement, soil, and sand blend pumped in larger volumes.
`;

const seoPage = `---
title: Test
---
Intro.

## Foam Concrete Lifting Near Me: Materials and Methods We Use

Foam and slurry aren't interchangeable.

${bullets}
`;

const options = listMaterialOptions(seoPage);
assertEqual(
  options.map((o) => o.title),
  ['Two-part polyurethane foam', 'Cementitious slurry mix'],
  'SEO-prefixed H2 yields material titles',
);
assert(
  /Expands within seconds/i.test(options[0].detail),
  'material bullet detail is kept',
);

const parsed = parseServiceBody(seoPage.replace(/^---[\s\S]*?---\n?/, ''));
const materialsSec = parsed.sections.find((s) => s.kind === 'materials');
assert(materialsSec, 'template classifies SEO-prefixed heading as materials');

const wylieBullets = `- **Cement-based slurry**: The core of mudjacking, mixed to a pumpable consistency.
- **Two-part expanding polyurethane foam**: Lightweight and fast-curing.
- **Injection port hardware**: Small-diameter ports that control where material goes.
- **Flexible polyurethane crack sealant**: Seals cracks that open and close with temperature.
- **Hydraulic pump equipment**: Delivers slurry at controlled pressure.
- **Concrete patch compound**: Closes drill holes flush with the surrounding surface.
`;

const wyliePage = `---
title: Test
---
Intro.

## Mudjacking and Foam Concrete Lifting Methods in Wylie, TX

North Texas clay swells and shrinks with the seasons.

${wylieBullets}
`;

const wylieOptions = listMaterialOptions(wyliePage);
assertEqual(
  wylieOptions.map((o) => o.title),
  [
    'Cement-based slurry',
    'Two-part expanding polyurethane foam',
    'Injection port hardware',
    'Flexible polyurethane crack sealant',
    'Hydraulic pump equipment',
    'Concrete patch compound',
  ],
  'Methods-in-city H2 yields six material titles',
);
assert(/core of mudjacking/i.test(wylieOptions[0].detail), 'first material detail kept');

const homeProse = extractHomepageProseSections(wyliePage.replace(/^---[\s\S]*?---\n?/, ''));
assert(
  homeProse.some((s) => s.id === 'materials' && /Methods in Wylie/i.test(s.heading)),
  'homepage classify treats Methods-in-city H2 as materials',
);

console.log('test-materials-heading: ok');
