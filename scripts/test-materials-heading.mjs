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
assert(!isMaterialsHeading('What do materials cost?'), 'cost heading that mentions materials stays out');
assert(
  !isMaterialsHeading('Trenchless sewer repair Mason OH: what it costs'),
  'what it costs is not materials',
);
assert(!isMaterialsHeading('Materials costs'), 'materials costs stays out of materials');
assert(!isMaterialsHeading('How long does Concrete Lifting take?'), 'timeline is not materials');
assert(!isMaterialsHeading('Permits for turf materials'), 'permit heading stays out');
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

assert(
  isMaterialsHeading('Turf and base materials built for Arizona sun'),
  'mid-title materials heading',
);

const elMirageBullets = `- **Polyurethane-backed turf**: Backing resists the heat-driven breakdown that cheaper latex backing suffers after a couple Arizona summers.
- **UV-stabilized yarn**: Fiber keeps its green color instead of fading to straw-yellow under months of direct sun.
- **Angular drainage rock**: Base rock that locks together under compaction, unlike rounded gravel that shifts and settles.
- **Zeolite infill**: Absorbs odor-causing ammonia, which matters more here since heat accelerates pet odor breakdown.
- **Perforated turf backing**: Lets water and urine drain straight through instead of pooling on the surface.
- **Heat-reflective infill**: Lowers surface temperature on play areas and walkways compared to standard silica sand infill.
`;

const elMiragePage = `---
title: Test
---
Intro.

## Turf and base materials built for Arizona sun

The material choices below hold up under direct desert exposure.

${elMirageBullets}
`;

const elMirageOptions = listMaterialOptions(elMiragePage);
assertEqual(
  elMirageOptions.map((o) => o.title),
  [
    'Polyurethane-backed turf',
    'UV-stabilized yarn',
    'Angular drainage rock',
    'Zeolite infill',
    'Perforated turf backing',
    'Heat-reflective infill',
  ],
  'mid-title materials H2 yields six product titles',
);
assert(
  /heat-driven breakdown/i.test(elMirageOptions[0].detail),
  'first product detail is kept',
);

const elMirageProse = extractHomepageProseSections(elMiragePage.replace(/^---[\s\S]*?---\n?/, ''));
assert(
  elMirageProse.some((s) => s.id === 'materials' && /base materials built/i.test(s.heading)),
  'homepage classify treats mid-title materials H2 as materials',
);

const introStealBullets = `- **Resin liner**: Forms a new wall inside the old pipe.
- **Joint-free pipe**: Leaves nothing for roots to grab.
- **Bursting head**: Fractures the old pipe while the new one follows.
- **Push camera**: Shows the inside of the line before any work starts.
- **Cutting bit**: Clears roots without opening the yard.
- **Joint sealant**: Closes small cracks that do not need a full liner.
`;

const introStealPage = `---
title: Test
---
Older materials crack at the joints, and the repair methods have to match what the camera shows.

## Field materials and methods we bring

The list below is what the crew actually brings.

${introStealBullets}
`;

const introStealOptions = listMaterialOptions(introStealPage);
assertEqual(
  introStealOptions.map((o) => o.title),
  [
    'Resin liner',
    'Joint-free pipe',
    'Bursting head',
    'Push camera',
    'Cutting bit',
    'Joint sealant',
  ],
  'intro that says materials and methods does not steal the materials H2',
);
assert(/new wall inside/i.test(introStealOptions[0].detail), 'first stolen-intro detail is kept');

const costBand = `Intro.

## Trenchless sewer repair Mason OH: what it costs

Pricing isn't one flat number.

- **CIPP lining, single lateral** — $3,800–$8,500, resin liner cured in place, no trench.
`;
const costProse = extractHomepageProseSections(costBand);
assert(
  costProse.some((s) => s.id === 'cost' && /what it costs/i.test(s.heading)),
  'homepage classify treats what it costs as cost',
);
const pricingProse = extractHomepageProseSections('## Pricing\n\nBallparks.\n');
assert(
  pricingProse.some((s) => s.id === 'cost'),
  'Pricing heading is a cost band',
);
const svcCost = parseServiceBody('Intro.\n\nWhat it costs\n\n- **Lining** — $3,800–$8,500, resin liner.\n');
assert(
  svcCost.sections.some((s) => s.kind === 'cost' && /what it costs/i.test(s.heading)),
  'plain what it costs opens a service cost section',
);

console.log('test-materials-heading: ok');
