/**
 * Page frontmatter heal (missing homepage description / h1).
 * Run: node scripts/test-content-page-heal.mjs
 */
import { healPageFrontmatter } from '../ops/lib/content-auto-fix.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

const config = {
  state: 'AZ',
  primaryCity: 'Chandler',
  niche: 'Artificial Turf',
};

const home = `---
title: "Artificial Turf Installation in Chandler, AZ"
sectionHeading: "Best Artificial Grass Installers in Chandler, AZ"
process:
  - title: "Site evaluation"
    description: "We walk the yard."
---

Chandler yards fail because the summer heat beats the lawn before it gets a fair shot. Most homeowners call after the grass is already gone.
`;

{
  const healed = healPageFrontmatter({ 'src/content/pages/index.md': home }, config);
  const md = healed.files['src/content/pages/index.md'];
  assert(/h1: "Artificial Turf Installation in Chandler, AZ"/.test(md), 'h1 uses the title');
  assert(
    /description: "Chandler yards fail because the summer heat beats the lawn before it gets a fair shot/.test(md),
    'description uses the first paragraph',
  );
  assert(md.includes('title: "Site evaluation"'), 'process title stays');
  assert(md.includes('description: "We walk the yard."'), 'process description stays');
  assert(healed.changed, 'missing homepage keys are a change');
}

{
  const kept = `---
title: "Artificial Turf Installation in Chandler, AZ"
description: "Custom homepage description."
h1: "Custom homepage heading"
process:
  - title: "Site evaluation"
    description: "We walk the yard."
---

This body should not replace the written heading.
`;
  const healed = healPageFrontmatter({ 'src/content/pages/index.md': kept }, config);
  const md = healed.files['src/content/pages/index.md'];
  assert(/h1: "Custom homepage heading"/.test(md), 'existing h1 stays');
  assert(/description: "Custom homepage description."/.test(md), 'existing description stays');
  assert(!healed.heals.length, 'complete page frontmatter is not rewritten');
}

{
  const linked = `---
title: "Artificial Turf Installation in Chandler, AZ"
process:
  - title: "Site evaluation"
    description: "We walk the yard."
---

<!-- rover-autofix-links -->
- [Contact](/contact)
- [About](/about)

Chandler lawns don't die from bad luck. Caliche soil and triple-digit summers wear grass down faster than most homeowners expect.
`;
  const healed = healPageFrontmatter({ 'src/content/pages/index.md': linked }, config);
  const md = healed.files['src/content/pages/index.md'];
  assert(
    /description: "Chandler lawns don't die from bad luck/.test(md),
    'description skips the link comment and the link list',
  );
  assert(!/description: "<!--/.test(md), 'description is not the html comment');
}

{
  const bare = `---
title: "Artificial Turf Installation in Chandler, AZ"
process:
  - title: "Site evaluation"
    description: "We walk the yard."
---
`;
  const healed = healPageFrontmatter({ 'src/content/pages/index.md': bare }, config);
  const md = healed.files['src/content/pages/index.md'];
  assert(
    /description: "Artificial Turf Installation in Chandler, AZ\. Request a free estimate\."/.test(md),
    'description falls back to the title when the body has no prose',
  );
}

{
  const long = `---
title: "Artificial Turf Installation in Chandler, AZ"
---

${'Chandler homeowners replace dead lawns with heat-rated turf after the summer burns the grass down to dirt. '.repeat(6)}
`;
  const healed = healPageFrontmatter({ 'src/content/pages/index.md': long }, config);
  const md = healed.files['src/content/pages/index.md'];
  const description = md.match(/description: "([^"]+)"/)?.[1] || '';
  assert(description.length <= 160, `description stays within 160 characters (${description.length})`);
  assert(!description.endsWith(' '), 'clipped description does not end mid-space');
  assert(description.startsWith('Chandler homeowners'), 'clipped description keeps the opening words');
}

console.log('test-content-page-heal: ok');
