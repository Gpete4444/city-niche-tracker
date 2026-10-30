/**
 * Shared niche process/materials blocks.
 * Run: node scripts/test-niche-photo-blocks.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  NICHE_PHOTO_BLOCK_COUNT,
  applyPhotoBlocksToFiles,
  ensureNichePhotoBlocks,
  formatNichePhotoBlockPrompt,
  shouldReplaceNicheMasterPhotoBlocks,
} from '../ops/lib/niche-photo-blocks.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

function rows(prefix) {
  return Array.from({ length: NICHE_PHOTO_BLOCK_COUNT }, (_, i) => ({
    title: `${prefix} ${i + 1}`,
    detail: `${prefix} sentence number ${i + 1} for the work.`,
  }));
}

const structure = {
  sections: ['process', 'materials', 'svcProcess', 'svcMaterials', 'svcFaqs'],
  photos: {
    process: { enabled: true, count: 8 },
    materials: { enabled: true, count: 6 },
    svcProcess: { enabled: true, count: 8 },
    svcMaterials: { enabled: true, count: 6 },
  },
};

const catalog = {
  niche: 'Artificial Turf',
  version: 2,
  homepage: { process: rows('Home step'), materials: rows('Home material') },
  services: {
    'Putting green installation': {
      process: rows('Green step'),
      materials: rows('Green material'),
    },
  },
};
catalog.homepage.process[0] = {
  title: 'Site check',
  detail: 'Catalog homepage sentence that loses when the page already used this title.',
};
catalog.services['Putting green installation'].process[1] = {
  title: 'Site check',
  detail: 'Catalog sentence that loses when the page already used this title.',
};

const serviceMd = `---
title: Putting green
serviceName: Putting green installation
---

Intro paragraph about the city.

## Our process

Walk the yard first.

- **Old step** — This step is not on the shared list.
- **Site check** — Keep this city sentence.

## FAQs

How long does it take?

A few days.
`;

const homeMd = `---
title: Home
h1: Turf
process:
  - title: Site check
    description: Keep home sentence.
  - title: Old
    description: Gone.
faqs:
  - question: Why?
    answer: Because.
---

## Materials and methods we use

- **Old mat**: gone

## Cost

- **Basic** — $1
`;

const applied = applyPhotoBlocksToFiles(
  {
    'src/content/services/putting-green-installation.md': serviceMd,
    'src/content/pages/index.md': homeMd,
    'src/content/locations/el-mirage.md': '---\ntitle: El Mirage\n---\n\nLeave this page.\n',
  },
  catalog,
  structure,
);

const serviceOut = applied.files['src/content/services/putting-green-installation.md'];
assert(applied.count === 2, 'homepage and service page updated');
assert(serviceOut.includes('Intro paragraph about the city.'), 'service intro stays');
assert(serviceOut.includes('## FAQs'), 'faq heading stays');
assert(serviceOut.includes('How long does it take?'), 'faq question stays');
assert(serviceOut.includes('**Site check** — Keep this city sentence.'), 'matching process title keeps its sentence');
assert(!serviceOut.includes('Old step'), 'extra process step is removed');
assert((serviceOut.match(/^- \*\*Green step/gm) || []).length === 5, 'five catalog process steps plus the kept title');
assert((serviceOut.match(/^- \*\*Green material/gm) || []).length === 6, 'six materials bullets');
assert(serviceOut.includes('## Materials and methods we use'), 'materials section added');

const homeOut = applied.files['src/content/pages/index.md'];
assert(homeOut.includes('description: "Keep home sentence."'), 'matching homepage step keeps its sentence');
assert(!homeOut.includes('title: "Old"'), 'old homepage step is removed');
assert((homeOut.match(/title: "Home step/g) || []).length === 5, 'five catalog homepage steps');
assert(homeOut.includes('question: Why?'), 'homepage faqs stay');
assert(homeOut.includes('## Cost'), 'cost section stays');
assert((homeOut.match(/^- \*\*Home material/gm) || []).length === 6, 'six homepage materials');
assert(
  applied.files['src/content/locations/el-mirage.md'].includes('Leave this page.'),
  'location page stays',
);

const again = applyPhotoBlocksToFiles(applied.files, catalog, structure);
assert(again.count === 0, 'second splice does not rewrite aligned pages');

const empty = applyPhotoBlocksToFiles(applied.files, null, structure);
assert(empty.changed === false && empty.files['src/content/pages/index.md'] === homeOut, 'empty catalog does not rewrite pages');

const materialsOff = {
  sections: ['process', 'svcProcess', 'svcFaqs'],
  photos: { process: { enabled: true }, svcProcess: { enabled: true }, svcMaterials: { enabled: false } },
};
const keptMaterials = applyPhotoBlocksToFiles(
  { 'src/content/services/putting-green-installation.md': serviceMd },
  catalog,
  materialsOff,
);
assert(
  !keptMaterials.files['src/content/services/putting-green-installation.md'].includes('Green material'),
  'materials stay untouched when Structure has that section off',
);
assert(
  keptMaterials.files['src/content/services/putting-green-installation.md'].includes('**Site check**'),
  'process still splices when that section is on',
);

assert(
  shouldReplaceNicheMasterPhotoBlocks({ masterVersion: 0, siteVersion: 2, catalogVersion: 2 }),
  'first catalog prepare replaces old master slots',
);
assert(
  !shouldReplaceNicheMasterPhotoBlocks({ masterVersion: 2, siteVersion: 2, catalogVersion: 2 }),
  'same catalog version keeps the reviewed master',
);
assert(
  !shouldReplaceNicheMasterPhotoBlocks({ masterVersion: 0, siteVersion: 0, catalogVersion: 2 }),
  'a site that was not spliced does not replace the master',
);

const prompt = formatNichePhotoBlockPrompt(catalog);
assert(prompt.includes('Putting green installation'), 'prompt names the service');
assert(prompt.includes('Site check'), 'prompt includes the shared title');
assert(prompt.includes('Rewrite the sentence for this city'), 'prompt rewrites the sentence per city');
assert(!prompt.includes('stays generic'), 'prompt does not keep a generic sentence');
assert(formatNichePhotoBlockPrompt(null) === '', 'missing catalog adds no prompt');

const dir = mkdtempSync(path.join(os.tmpdir(), 'niche-photo-blocks-'));
const store = path.join(dir, 'blocks.json');
let calls = 0;
const authored = {
  homepage: { process: rows('Authored home'), materials: rows('Authored home material') },
  services: {
    'Pet turf installation': {
      process: rows('Pet step'),
      materials: rows('Pet material'),
    },
    'Pool surround turf': {
      process: rows('Pool step'),
      materials: rows('Pool material'),
    },
  },
};
try {
  const first = await ensureNichePhotoBlocks({
    niche: 'Artificial Turf',
    serviceNames: ['Pet turf installation', 'Pool surround turf'],
    filePath: store,
    callClaude: async () => {
      calls += 1;
      return { text: JSON.stringify(authored), parsed: { ok: true, value: authored }, truncated: false };
    },
  });
  assert(calls === 1, 'missing catalog makes one authoring call');
  assert(first.authored === true, 'authoring flag set');
  assert(first.record.version === 1, 'catalog version starts at 1');
  assert(first.record.services['Pet turf installation'].process.length === 6, 'saved service has 6 steps');

  const second = await ensureNichePhotoBlocks({
    niche: 'artificial turf',
    serviceNames: ['Pet turf installation', 'Pool surround turf'],
    filePath: store,
    callClaude: async () => {
      calls += 1;
      return { text: '{}', parsed: { ok: true, value: {} }, truncated: false };
    },
  });
  assert(calls === 1, 'complete catalog is reused');
  assert(second.authored === false, 'reuse does not author');

  const dropped = await ensureNichePhotoBlocks({
    niche: 'Artificial Turf',
    serviceNames: ['Pet turf installation'],
    filePath: store,
    callClaude: async () => {
      calls += 1;
      throw new Error('should not author when only dropping');
    },
  });
  assert(calls === 1, 'dropping a service does not call Claude');
  assert(!dropped.record.services['Pool surround turf'], 'removed service block is dropped');
  assert(dropped.record.services['Pet turf installation'], 'remaining service block stays');
  assert(dropped.record.version === 2, 'drop bumps the catalog version');

  const untouched = await ensureNichePhotoBlocks({
    niche: 'Artificial Turf',
    serviceNames: [],
    filePath: store,
    callClaude: async () => {
      calls += 1;
      throw new Error('empty list must not author');
    },
  });
  assert(untouched == null, 'empty service list does not touch the catalog');
  assert(calls === 1, 'empty service list does not call Claude');

  let failed = false;
  try {
    await ensureNichePhotoBlocks({
      niche: 'Concrete Lifting',
      serviceNames: ['Slab leveling'],
      filePath: store,
      callClaude: async () => ({
        text: '{"homepage":{"process":[],"materials":[]},"services":{}}',
        parsed: { ok: true, value: { homepage: { process: [], materials: [] }, services: {} } },
        truncated: false,
      }),
    });
  } catch (error) {
    failed = /still missing/i.test(error.message || '');
  }
  assert(failed, 'short authoring result does not count as a finished catalog');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('niche photo blocks ok');
