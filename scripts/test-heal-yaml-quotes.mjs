/**
 * Heal unclosed YAML quotes on Write site paste; skip leftover bad FILEs.
 * Run: node scripts/test-heal-yaml-quotes.mjs
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { pasteAgentContentDraft } from '../ops/lib/content-agents.mjs';
import { pathsFor } from '../ops/lib/candidates.mjs';
import {
  healYamlFrontmatter,
  revertInvalidYamlPasteFiles,
  yamlFrontmatterErrorRels,
} from '../ops/lib/content-markdown.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

function writeJsonFile(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

const unclosed = `---
title: Concrete lifting in Lake Dallas
description: "Concrete lifting in Lake Dallas, TX for homeowners
h1: Concrete lifting in Lake Dallas
city: Lake Dallas
state: TX
---

Lake Dallas homeowners call when driveways drop. We lift the slab and keep the visit local.
`;

const healedUnclosed = healYamlFrontmatter(unclosed);
assert(healedUnclosed.healed, 'unclosed description is healed');
assert(healedUnclosed.parseOk, `unclosed description parses: ${healedUnclosed.error}`);
const fmUnclosed = healedUnclosed.markdown.split(/^---$/m)[1];
assert(
  parseYaml(fmUnclosed).description.includes('Lake Dallas'),
  'healed description keeps city text',
);

const inner = `---
title: Lake Dallas
description: "Concrete lifting for "sunken" slabs in Lake Dallas, TX"
h1: Lake Dallas
city: Lake Dallas
state: TX
---

Body copy for Lake Dallas concrete lifting stays local and specific.
`;
const healedInner = healYamlFrontmatter(inner);
assert(healedInner.parseOk, `inner quotes parse: ${healedInner.error}`);
const desc = parseYaml(healedInner.markdown.split(/^---$/m)[1]).description;
assert(/sunken/.test(desc), 'inner quote text kept');

const skip = revertInvalidYamlPasteFiles(
  {
    'src/content/locations/plano.md': '---\ntitle: Plano\n---\n',
    'src/content/locations/lake-dallas.md': '---\nprocess: {\n---\n',
  },
  { 'src/content/locations/plano.md': '---\ntitle: Plano prior\n---\n' },
  ['src/content/locations/plano.md', 'src/content/locations/lake-dallas.md'],
  {
    errors: [
      'src/content/locations/lake-dallas.md: invalid YAML frontmatter (Missing closing quote)',
    ],
  },
);
assert(skip.skipped.includes('src/content/locations/lake-dallas.md'), 'skip lists bad FILE');
assert(!skip.files['src/content/locations/lake-dallas.md'], 'new bad FILE omitted');
assert(
  /Plano/.test(skip.files['src/content/locations/plano.md']),
  'good sibling stays',
);
assert(
  yamlFrontmatterErrorRels({
    errors: ['src/content/locations/lake-dallas.md: invalid YAML frontmatter (x)'],
  })[0] === 'src/content/locations/lake-dallas.md',
  'yaml error rel parsed',
);

const id = 'zz_test_yaml_quotes';
const p = pathsFor(id);
const created = [p.meta, p.siteConfig, p.contentDraft];
try {
  writeJsonFile(p.meta, { id, niche: 'Concrete Lifting', updatedAt: new Date().toISOString() });
  writeJsonFile(p.siteConfig, {
    businessName: 'Frisco Test Lift',
    niche: 'Concrete Lifting',
    primaryCity: 'Frisco',
    state: 'TX',
    siteArchetype: 'multi_service',
    targetSuburbs: ['Plano', 'Lake Dallas'],
    services: ['Concrete lifting'],
  });
  writeJsonFile(p.contentDraft, {
    files: {
      'src/content/pages/index.md': `---
title: Frisco Concrete Lifting
description: Concrete lifting in Frisco, TX.
h1: Concrete lifting in Frisco
---

Homepage body.
`,
      'src/content/locations/plano.md': `---
title: Concrete lifting in Plano
description: Concrete lifting in Plano, TX for homeowners.
h1: Concrete lifting in Plano
city: Plano
state: TX
---

Plano slabs we already wrote stay in the draft.
`,
    },
    _ops: { mode: 'homepage_first' },
  });

  const pasted = pasteAgentContentDraft(
    id,
    `### FILE: src/content/locations/plano.md
---
title: Concrete lifting in Plano
description: "Concrete lifting in Plano, TX for homeowners
h1: Concrete lifting in Plano
city: Plano
state: TX
---

Plano update after heal still unique to this suburb.

### FILE: src/content/locations/lake-dallas.md
---
title: Lake Dallas
description: ok
h1: Lake Dallas
city: Lake Dallas
state: TX
process: {
---

Broken leftover YAML should not abort Plano.
`,
    { mode: 'homepage_first' },
  );
  assert(pasted.ok, 'paste does not throw');
  assert(
    pasted.draft?.files?.['src/content/locations/plano.md'],
    'good Plano FILE kept',
  );
  assert(
    /homeowners/.test(pasted.draft.files['src/content/locations/plano.md']),
    'healed Plano description saved',
  );
  assert(
    pasted.skippedYaml?.includes('src/content/locations/lake-dallas.md'),
    'Lake Dallas skipped',
  );
  assert(
    !pasted.draft.files['src/content/locations/lake-dallas.md'],
    'unhealable Lake Dallas not written',
  );
} finally {
  for (const file of created) {
    try {
      if (existsSync(file)) unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

console.log('test-heal-yaml-quotes: ok');
