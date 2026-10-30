/**
 * Service frontmatter heal (missing h1/serviceName from the site list).
 * Run: node scripts/test-content-service-heal.mjs
 */
import { healServiceFrontmatter } from '../ops/lib/content-auto-fix.mjs';
import { validateContentBundle } from '../ops/lib/content-markdown.mjs';

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

const config = {
  state: 'AZ',
  primaryCity: 'El Mirage',
  niche: 'Artificial Turf',
  siteArchetype: 'multi_service',
  services: ['Turf repair and re-seaming'],
  commercialServices: [],
};

const missingHeadings = `---
title: "Artificial Turf Repair and Re-Seaming in El Mirage, AZ"
description: "Artificial turf repair and re-seaming in El Mirage, AZ for lifted seams, matted infill, and sun-faded sections."
---

Repair body.
`;

function bundle(serviceMd, rel = 'src/content/services/turf-repair-and-re-seaming.md') {
  return {
    'src/content/pages/index.md': page('Home'),
    'src/content/pages/about.md': page('About'),
    'src/content/pages/contact.md': page('Contact'),
    [rel]: serviceMd,
  };
}

{
  const healed = healServiceFrontmatter(bundle(missingHeadings), config);
  const md = healed.files['src/content/services/turf-repair-and-re-seaming.md'];
  assert(
    /title: "Artificial Turf Repair and Re-Seaming in El Mirage, AZ"/.test(md),
    'existing title stays',
  );
  assert(/description: "Artificial turf repair and re-seaming in El Mirage, AZ/.test(md), 'existing description stays');
  assert(/serviceName: "Turf repair and re-seaming"/.test(md), 'fills serviceName from the site list');
  assert(/h1: "Turf repair and re-seaming"/.test(md), 'fills h1 with the service name');
  const check = validateContentBundle(healed.files, config, { mode: 'full' });
  assert(check.ok, `validate passes after service heal: ${check.errors.join('; ')}`);
}

{
  const kept = `---
title: "Custom repair title"
description: "Custom repair description."
h1: "Custom repair heading"
serviceName: "Custom repair name"
---

Repair body.
`;
  const healed = healServiceFrontmatter(bundle(kept), config);
  const md = healed.files['src/content/services/turf-repair-and-re-seaming.md'];
  assert(/serviceName: "Custom repair name"/.test(md), 'existing serviceName stays');
  assert(/h1: "Custom repair heading"/.test(md), 'existing h1 stays');
  assert(
    !healed.heals.some((h) => h.file.endsWith('turf-repair-and-re-seaming.md')),
    'complete service frontmatter is not rewritten',
  );
}

{
  const unknown = `---
title: "Something else"
description: "Not on the list."
---

Other body.
`;
  const rel = 'src/content/services/not-on-the-list.md';
  const healed = healServiceFrontmatter(bundle(unknown, rel), config);
  assert(!healed.heals.some((h) => h.file === rel), 'unknown slug is not given a made-up name');
  assert(!/serviceName:/.test(healed.files[rel]), 'unknown slug has no serviceName');
}

console.log('test-content-service-heal: ok');
