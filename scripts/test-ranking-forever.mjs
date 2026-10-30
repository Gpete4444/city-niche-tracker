/**
 * Ranking-first: service-band rotation + sourced location angles + coverage lint.
 * Run: node scripts/test-ranking-forever.mjs
 */
import { assignServiceBands, coverageMinimum } from '../ops/lib/service-band-assign.mjs';
import { buildLocationAngles, normalizeLocalConditions } from '../ops/lib/location-angles.mjs';
import { lintContentSeo } from '../ops/lib/content-seo-lint.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

const PRESET_C_SVC = [
  'svcHero',
  'svcIntro',
  'svcWhatsIncluded',
  'svcProcess',
  'svcCost',
  'svcMaterials',
  'svcTimeline',
  'svcCodes',
  'svcFaqs',
  'svcDiyVsPro',
  'svcWhenToCall',
  'svcBeforeAfter',
  'svcCta',
];

const drywallServices = [
  'Drywall Hole and Crack Patching',
  'Sheetrock Repair',
  'Drywall Patch Repair',
  'Texture Matching',
  'Popcorn Ceiling Removal',
  'Water Damage Drywall Repair',
  'Nail Pop Repair',
  'Drywall Seam Repair',
  'Ceiling Crack Repair',
  'Wall Texture Repair',
];

const ten = assignServiceBands({
  services: drywallServices,
  enabledSectionIds: PRESET_C_SVC,
  faqSeeds: [
    'How much does drywall repair cost?',
    'Do I need a permit for water damage drywall?',
    'Is DIY drywall patching a good idea?',
  ],
  volumeHints: [{ keyword: 'popcorn ceiling removal cost', volume: 720 }],
});

assert(Object.keys(ten).length === 10, '10 service slugs assigned');
const costSlugs = Object.entries(ten)
  .filter(([, bands]) => bands.includes('svcCost'))
  .map(([slug]) => slug);
assert(costSlugs.length >= 2 && costSlugs.length < 10, `cost rotated, not cloned (${costSlugs.length})`);
assert(
  Object.values(ten).every((bands) => bands.includes('svcProcess') && bands.includes('svcFaqs')),
  'every service keeps process + FAQs',
);
assert(
  Object.values(ten).every((bands) => bands.includes('svcMaterials')),
  'every service keeps materials',
);
assert(ten['popcorn-ceiling-removal']?.includes('svcCost') || ten['popcorn-ceiling-removal']?.includes('svcTimeline'), 'popcorn gets cost or timeline from tokens/volume');
assert(ten['water-damage-drywall-repair']?.includes('svcCodes'), 'water damage prefers permits');

const one = assignServiceBands({
  services: ['Emergency Lockout'],
  enabledSectionIds: PRESET_C_SVC,
});
assert(one['emergency-lockout']?.includes('svcCost'), 'single service keeps cost');
assert(one['emergency-lockout']?.includes('svcDiyVsPro'), 'single service keeps DIY');
assert(one['emergency-lockout']?.includes('svcCodes'), 'single service keeps permits');

const pair = assignServiceBands({
  services: ['Drain Cleaning', 'Water Heater Replacement'],
  enabledSectionIds: PRESET_C_SVC,
});
assert(pair['drain-cleaning']?.includes('svcCost'), '2-service coverage: first has cost');
assert(pair['water-heater-replacement']?.includes('svcCost'), '2-service coverage: second has cost');

const noDiy = assignServiceBands({
  services: drywallServices,
  enabledSectionIds: PRESET_C_SVC.filter((id) => id !== 'svcDiyVsPro'),
});
assert(
  Object.values(noDiy).every((bands) => !bands.includes('svcDiyVsPro')),
  'DIY off in Structure stays off',
);

assert(coverageMinimum(0) === 0, 'coverage 0');
assert(coverageMinimum(1) === 1, 'coverage 1');
assert(coverageMinimum(10) === 2, 'coverage 2');

const empty = assignServiceBands({ services: [], enabledSectionIds: PRESET_C_SVC });
assert(Object.keys(empty).length === 0, 'no services → no assignments');

const conditions = normalizeLocalConditions([
  'Generic climate note',
  {
    text: 'Expansive soils under newer homes',
    place: 'Spanish Springs',
    sourceUrl: 'https://en.wikipedia.org/wiki/Spanish_Springs,_Nevada',
  },
]);
assert(conditions[0].text === 'Generic climate note', 'string conditions normalize');
assert(conditions[1].sourceUrl.includes('wikipedia'), 'object conditions keep source');

const angles = buildLocationAngles({
  suburbs: ['Spanish Springs', 'Sun Valley'],
  cityContext: {
    places: [
      {
        name: 'Spanish Springs',
        population: 17512,
        wiki: {
          ok: true,
          url: 'https://en.wikipedia.org/wiki/Spanish_Springs,_Nevada',
          climateHints: [],
          housingHints: ['census-designated place in Washoe County'],
          neighborhoodHints: [],
          description: 'Census-designated place in Nevada',
        },
      },
      {
        name: 'Sun Valley',
        wiki: { ok: true, url: 'https://en.wikipedia.org/wiki/Sun_Valley,_Nevada', housingHints: [] },
      },
    ],
  },
  fieldResearch: {
    localConditions: [
      {
        text: 'Older manufactured housing and leak stains',
        place: 'Sun Valley',
        sourceUrl: 'https://en.wikipedia.org/wiki/Sun_Valley,_Nevada',
      },
    ],
  },
});
assert(angles['spanish-springs']?.length >= 1, 'spanish springs has sourced angle');
assert(
  angles['sun-valley']?.some((c) => /manufactured/i.test(c.text)),
  'sun valley uses placed field-research cue',
);
assert(
  !angles['spanish-springs']?.some((c) => /manufactured/i.test(c.text)),
  'spanish springs does not steal sun valley cue',
);

const homeWithBands = `---
title: "Drywall Repair in Sparks, NV"
h1: "Drywall Repair in Sparks, NV"
---

## What does Drywall Repair cost in Sparks?
Ballparks.

## DIY vs hiring a pro
### DIY
- Small holes

### Hire a pro
- Texture match

## Permits for Drywall Repair
### Usually needs a permit
- Structural cuts
`;

const patch = `---
title: "Patch"
h1: "Patch"
---

## What Does a Patch Cost in Sparks?
- **Small** — $75–$150 — fill.

## DIY vs hiring a pro for Patch
### DIY
- Nail holes

### Hire a pro
- Recurring cracks

## Permits and codes for Patch
### Usually no permit
- Cosmetic holes

## What's Included
- Tape
`;

const water = `---
title: "Water"
h1: "Water"
---

## What Does Water Damage Drywall Repair Cost in Sparks?
- **Stain** — $200–$450 — cut and replace.

## Permits and codes for Water Damage
### Usually needs a permit
- Fire-rated walls

## DIY vs hiring a pro for Water Damage
### DIY
- Paint over a dry stain

### Hire a pro
- Soft or moldy board

## What's Included
- Cut-out
`;

const other = `---
title: "Texture"
h1: "Texture"
---

## What's Included
- Hopper gun
`;

const cover = lintContentSeo(
  {
    'src/content/pages/index.md': homeWithBands,
    'src/content/services/drywall-hole-and-crack-patching.md': patch,
    'src/content/services/water-damage-drywall-repair.md': water,
    'src/content/services/texture-matching.md': other,
  },
  {
    sectionIds: ['cost', 'diyVsPro', 'codes', 'svcCost', 'svcDiyVsPro', 'svcCodes'],
    homepageSections: ['cost', 'diyVsPro', 'codes'],
    services: [
      'Drywall Hole and Crack Patching',
      'Water Damage Drywall Repair',
      'Texture Matching',
    ],
    serviceBandAssignments: {
      'drywall-hole-and-crack-patching': ['svcCost', 'svcDiyVsPro'],
      'water-damage-drywall-repair': ['svcCodes', 'svcCost'],
      'texture-matching': ['svcMaterials'],
    },
  },
);
assert(
  !(cover.findings || []).some((f) => f.rule === 'homepage_educational_missing'),
  'homepage encyclopedia passes',
);
assert(
  !(cover.findings || []).some((f) => f.rule === 'service_educational_coverage' && /cost/i.test(f.excerpt)),
  'rotated cost coverage passes',
);

const missingHome = lintContentSeo(
  { 'src/content/pages/index.md': '---\ntitle: Home\nh1: Home\n---\n\nHello.\n' },
  { sectionIds: ['cost'], homepageSections: ['cost'] },
);
assert(
  (missingHome.findings || []).some((f) => f.rule === 'homepage_educational_missing'),
  'homepage missing cost is critical',
);

const locA = `---
title: "A"
h1: "A"
---

Spanish Springs newer homes sit on expansive soils. Doorway cracks come back after DIY spackle. Homeowners notice the same header line opening every season after a freeze and thaw cycle on the newer pads. We see this pattern along the same corridor more than in older Sparks ranch stock.

## Drywall Repair FAQs for Spanish Springs
What causes cracks over doorways in Spanish Springs homes?
Expansive soil under newer foundations shifts and the crack returns if you only fill the paint line.
`;
const locB = `---
title: "B"
h1: "B"
---

Spanish Springs newer homes sit on expansive soils. Doorway cracks come back after DIY spackle. Homeowners notice the same header line opening every season after a freeze and thaw cycle on the newer pads. We see this pattern along the same corridor more than in older Sparks ranch stock.

## Drywall Repair FAQs for Cold Springs
What causes cracks over doorways in Cold Springs homes?
Expansive soil under newer foundations shifts and the crack returns if you only fill the paint line.
`;
const locC = `---
title: "C"
h1: "C"
---

Sun Valley stains usually mean a roof or plumbing leak, not cosmetic paint. Older manufactured and site-built houses here show brown rings after flashing or plumbing wear. The drywall fix waits until the leak source is stopped and the cavity is dry.

## Drywall Repair FAQs for Sun Valley
Is a ceiling stain just cosmetic?
Rarely. Moisture sat in the board and the stain is the last thing you see.
`;

const locs = lintContentSeo(
  {
    'src/content/locations/spanish-springs.md': locA,
    'src/content/locations/cold-springs.md': locB,
    'src/content/locations/sun-valley.md': locC,
  },
  { locationMinWords: 20, strictLocationDepth: true },
);
assert(
  (locs.findings || []).some((f) => f.rule === 'location_bodies_near_duplicate'),
  'cloned location openings/FAQs flag',
);

console.log('test-ranking-forever: ok');
