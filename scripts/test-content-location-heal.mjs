/**
 * Location frontmatter heal (missing state/city from site-config).
 * Run: node scripts/test-content-location-heal.mjs
 */
import { healLocationFrontmatter } from '../ops/lib/content-auto-fix.mjs';
import { validateContentBundle } from '../ops/lib/content-markdown.mjs';
import { runTemplateContract } from '../ops/lib/template-contract.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

function page(name) {
  return `---
title: "${name}"
description: "${name} page"
h1: "${name}"
draft: false
---

${name} body.
`;
}

function bundle(locationMd) {
  return {
    'src/content/pages/index.md': page('Home'),
    'src/content/pages/about.md': page('About'),
    'src/content/pages/contact.md': page('Contact'),
    'src/content/locations/elmo.md': locationMd,
  };
}

const missingState = `---
title: "Concrete in Elmo"
description: "Local notes"
h1: "Concrete in Elmo"
city: "Elmo"
draft: false
---

Elmo body.
`;

const missingCity = `---
title: "Concrete in Elmo"
description: "Local notes"
h1: "Concrete in Elmo"
state: "TX"
draft: false
---

Elmo body.
`;

const config = {
  state: 'TX',
  primaryCity: 'Mesquite',
  targetSuburbs: ['Elmo'],
  niche: 'Concrete lifting',
  siteArchetype: 'multi_service',
};

{
  const healed = healLocationFrontmatter(bundle(missingState), config);
  const hit = healed.heals.find((h) => h.field === 'state');
  assert(hit && hit.value === 'TX', 'fills missing state from site-config');
  assert(/src\/content\/locations\/elmo\.md/.test(hit.file), 'heal names elmo.md');
  const check = validateContentBundle(healed.files, config, { mode: 'homepage_first' });
  assert(check.ok, `validate passes after state heal: ${check.errors.join('; ')}`);
}

{
  const healed = healLocationFrontmatter(bundle(missingCity), config);
  const hit = healed.heals.find((h) => h.field === 'city');
  assert(hit && hit.value === 'Elmo', 'fills missing city from suburb slug');
  const check = validateContentBundle(healed.files, config, { mode: 'homepage_first' });
  assert(check.ok, `validate passes after city heal: ${check.errors.join('; ')}`);
}

{
  const healed = healLocationFrontmatter(bundle(missingState), {
    ...config,
    state: '',
  });
  assert(
    !healed.heals.some((h) => h.field === 'state'),
    'does not invent a state when site-config has none',
  );
  const check = validateContentBundle(healed.files, { ...config, state: '' }, { mode: 'homepage_first' });
  assert(!check.ok, 'validation still reports missing state');
  assert(
    check.errors.some((e) => /elmo\.md: missing state/.test(e)),
    `missing state error present: ${check.errors.join('; ')}`,
  );
}

const missingHeadings = `---
title: "Artificial Turf Installation Near Grand"
city: "Grand Avenue area"
state: "AZ"
---

Grand Avenue body.
`;

const turfConfig = {
  state: 'AZ',
  primaryCity: 'El Mirage',
  targetSuburbs: ['Grand Avenue area'],
  niche: 'Artificial Turf',
  siteArchetype: 'multi_service',
};

{
  const files = {
    ...bundle(page('Elmo')),
    'src/content/locations/grand-avenue-area.md': missingHeadings,
  };
  const healed = healLocationFrontmatter(files, turfConfig);
  const md = healed.files['src/content/locations/grand-avenue-area.md'];
  assert(/title: "Artificial Turf Installation Near Grand"/.test(md), 'existing title stays');
  assert(/h1: "Artificial Turf in Grand Avenue area"/.test(md), 'fills suburb h1');
  assert(
    /description: "Artificial Turf for Grand Avenue area homeowners and property owners near El Mirage\. Request a free estimate\."/.test(
      md,
    ),
    'fills suburb description',
  );
  const check = validateContentBundle(healed.files, turfConfig, { mode: 'homepage_first' });
  assert(check.ok, `validate passes after heading heal: ${check.errors.join('; ')}`);
}

{
  const kept = `---
title: "Artificial Turf in Grand Avenue area, AZ"
description: "Custom Grand Avenue description."
h1: "Custom Grand Avenue heading"
city: "Grand Avenue area"
state: "AZ"
---

Grand Avenue body.
`;
  const files = {
    ...bundle(page('Elmo')),
    'src/content/locations/grand-avenue-area.md': kept,
  };
  const healed = healLocationFrontmatter(files, turfConfig);
  const md = healed.files['src/content/locations/grand-avenue-area.md'];
  assert(/description: "Custom Grand Avenue description\."/.test(md), 'existing description stays');
  assert(/h1: "Custom Grand Avenue heading"/.test(md), 'existing h1 stays');
  assert(
    !healed.heals.some((h) => h.file.endsWith('grand-avenue-area.md')),
    'complete location frontmatter is not rewritten',
  );
}

function locationBundle(cities) {
  const files = {
    'src/content/pages/index.md': page('Home'),
    'src/content/pages/about.md': page('About'),
    'src/content/pages/contact.md': page('Contact'),
  };
  for (const city of cities) {
    const slug = city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    files[`src/content/locations/${slug}.md`] = `---
title: "${city}"
description: "${city} page"
h1: "${city}"
city: "${city}"
state: "AZ"
---

${city} body.
`;
  }
  return files;
}

{
  const oneCity = {
    primaryCity: 'El Mirage',
    targetSuburbs: [],
    state: 'AZ',
    niche: 'Artificial Turf',
    siteArchetype: 'multi_service',
  };
  const files = locationBundle(['El Mirage']);
  const contract = runTemplateContract(files, oneCity, { mode: 'full' });
  const check = validateContentBundle(files, oneCity, { mode: 'full' });
  assert(
    !contract.warnings.some((w) => /prefer 4/.test(w)),
    'one configured city and one location file skips the contract prefer-4-6 warning',
  );
  assert(
    !check.warnings.some((w) => /prefer 4/.test(w)),
    'one configured city and one location file skips the bundle prefer-4-6 warning',
  );
}

{
  const fourCities = {
    primaryCity: 'El Mirage',
    targetSuburbs: ['Glendale', 'Peoria', 'Surprise'],
    state: 'AZ',
    niche: 'Artificial Turf',
    siteArchetype: 'multi_service',
  };
  const files = locationBundle(['El Mirage']);
  const contract = runTemplateContract(files, fourCities, { mode: 'full' });
  const check = validateContentBundle(files, fourCities, { mode: 'full' });
  assert(
    contract.warnings.some((w) => /Locations: got 1, prefer 4/.test(w)),
    'four configured cities and one file still warn on the contract',
  );
  assert(
    check.warnings.some((w) => /Location pages: got 1, prefer 4/.test(w)),
    'four configured cities and one file still warn on the bundle',
  );
}

console.log('test-content-location-heal: ok');
