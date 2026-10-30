/**
 * Zone copy digest and soft near-duplicate / sibling-link warnings.
 * Run: node scripts/test-zone-site-diff.mjs
 */
import { lintContentSeo } from '../ops/lib/content-seo-lint.mjs';
import { formatZoneSiblingDigest } from '../ops/lib/zone-site-diff.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

const paragraph = Array.from({ length: 12 }, () =>
  'Crews repair cracked slabs, grind the surface, and roll epoxy so the floor can take foot traffic the next day.',
).join(' ');

const sameHome = `---
title: Concrete coating
process:
  - title: Site check
    description: Walk the slab and mark every crack before grinding starts.
  - title: Grind
    description: Grind the surface so the coating can bond to the concrete.
  - title: Coat
    description: Roll the epoxy in two coats and keep foot traffic off overnight.
---

${paragraph}

## Cost

A garage floor coating in this town runs from the prep through the final coat.
`;

const distinctHome = `---
title: Concrete coating
process:
  - title: Site check
    description: Expansive clay in this subdivision lifts patio slabs after monsoon rains.
  - title: Grind
    description: Older block homes here hide moisture under indoor tile that needs a meter check.
  - title: Coat
    description: Desert sun on south driveways fades a thin coat, so this city gets a UV top layer.
---

Goodyear garages sit on caliche. The first visit maps heave cracks at the garage lip and the patio joint.

## Cost

Goodyear coatings price the extra grind when caliche dust keeps the primer from sticking.
`;

const sibling = {
  city: 'Avondale',
  state: 'AZ',
  domain: 'avondaleconcretepros.com',
  files: { 'src/content/pages/index.md': sameHome },
};

const copied = lintContentSeo(
  { 'src/content/pages/index.md': sameHome },
  { zoneSiblings: [sibling], strictLocationDepth: false },
);
assert(
  copied.findings.some((f) => f.rule === 'zone_homepage_near_duplicate' && f.severity === 'soft'),
  'copied homepage warns',
);
assert(copied.ok, 'zone copy warning does not block Accept');

const fresh = lintContentSeo(
  { 'src/content/pages/index.md': distinctHome },
  { zoneSiblings: [sibling], strictLocationDepth: false },
);
assert(
  !fresh.findings.some((f) => f.rule === 'zone_homepage_near_duplicate'),
  'a local homepage does not warn',
);

const service = `---
title: Epoxy coating
---

${paragraph}

## What's included

Prep, prime, and two coats.
`;
const serviceLint = lintContentSeo(
  { 'src/content/services/epoxy.md': service },
  {
    zoneSiblings: [{ ...sibling, files: { 'src/content/services/epoxy.md': service } }],
    strictLocationDepth: false,
  },
);
assert(
  serviceLint.findings.some((f) => f.rule === 'zone_service_intro_near_duplicate'),
  'copied service intro warns',
);

const linkFiles = {
  'src/content/pages/index.md':
    'We also serve Avondale homeowners who need crack repair. See our other offices for more towns. Visit https://avondaleconcretepros.com for the other crew.',
  'src/content/locations/avondale.md': `---
city: Avondale
state: AZ
---

Avondale is part of the route.
`,
};
const links = lintContentSeo(
  { ...linkFiles },
  { zoneSiblings: [sibling], strictLocationDepth: false },
);
assert(links.findings.some((f) => f.rule === 'zone_sibling_link'), 'other-offices phrase warns');
assert(links.findings.some((f) => f.rule === 'zone_sibling_domain'), 'neighbor domain warns');
assert(
  links.findings.some((f) => f.rule === 'zone_sibling_location_page' && f.file.includes('avondale')),
  'sibling location page warns',
);
assert(links.ok, 'sibling link warnings do not block Accept');

const allowed = lintContentSeo(
  {
    'src/content/pages/index.md': 'We also serve Avondale homeowners who need crack repair.',
    'src/content/locations/avondale.md': linkFiles['src/content/locations/avondale.md'],
  },
  {
    zoneSiblings: [sibling],
    zoneLocationOverrides: ['Avondale'],
    strictLocationDepth: false,
  },
);
assert(
  !allowed.findings.some((f) => f.rule === 'zone_sibling_location_page'),
  'an override keeps the location page',
);
assert(
  !allowed.findings.some((f) => f.rule === 'zone_sibling_link' || f.rule === 'zone_sibling_domain'),
  'also-serving a neighbor town is allowed',
);

const digest = formatZoneSiblingDigest([sibling]);
assert(digest.includes('Avondale, AZ'), 'digest names the neighbor');
assert(digest.includes('Walk the slab'), 'digest includes a sentence already used');
assert(digest.includes('do not copy'), 'digest tells the writer not to copy');
assert(formatZoneSiblingDigest([{ city: 'Empty', state: 'AZ', files: {} }]) === '', 'empty neighbor adds no digest');

console.log('zone site diff ok');
