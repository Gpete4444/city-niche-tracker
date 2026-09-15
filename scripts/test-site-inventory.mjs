/**
 * Local page/word inventory from markdown (body + visible YAML copy).
 * Run: node scripts/test-site-inventory.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  countBodyWords,
  countMarkdownWords,
  inventoryFromFiles,
  scanContentTree,
  stripFrontmatter,
  yamlCopyFromFrontmatter,
} from '../ops/lib/site-inventory.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

const stripped = stripFrontmatter(`---
title: Hello World
description: meta only
---

# Plumber in Denver

Call us today for drain cleaning.
`);
assert(!stripped.includes('title:'), 'frontmatter stripped');
assert(stripped.includes('Plumber in Denver'), 'body kept');

const words = countBodyWords(stripped);
assert(words >= 8, `body words counted (${words})`);
assertEqual(countBodyWords('one two three'), 3, 'plain words');

const files = {
  'src/content/pages/index.md': `---
title: Home
---

Welcome to the shop in Denver Colorado.
`,
  'src/content/services/drain-cleaning.md': `---
title: Drain Cleaning
---

We clear drains fast.
`,
  'src/content/pages/notes.txt': 'ignore me',
};
const inv = inventoryFromFiles(files, 'assembled');
assertEqual(inv.pageCount, 2, 'two markdown pages');
assertEqual(inv.source, 'assembled', 'source');
assert(inv.wordCount > 5, 'word total');

const dir = mkdtempSync(path.join(tmpdir(), 'rover-inv-'));
try {
  mkdirSync(path.join(dir, 'pages'), { recursive: true });
  mkdirSync(path.join(dir, 'services'), { recursive: true });
  writeFileSync(
    path.join(dir, 'pages', 'about.md'),
    `---
title: About
---

About our team here.
`,
    'utf8',
  );
  writeFileSync(
    path.join(dir, 'services', 'repair.md'),
    `---
title: Repair
---

Repair copy with extra words for counting purposes.
`,
    'utf8',
  );
  writeFileSync(path.join(dir, 'pages', 'skip.json'), '{"no":true}\n', 'utf8');
  const scanned = scanContentTree(dir);
  assertEqual(Object.keys(scanned).sort().join(','), 'src/content/pages/about.md,src/content/services/repair.md', 'scan rels');
  const fromDisk = inventoryFromFiles(scanned, 'assembled');
  assertEqual(fromDisk.pageCount, 2, 'scanned page count');
  assert(fromDisk.wordCount >= 10, 'scanned words');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const homeWithYaml = `---
title: Browser Title Words Should Not Count
h1: Visible Headline For Counting
description: Meta description words on the live page.
whyChooseUs:
  - title: Why one
    description: Why one body
process:
  - title: Step one
    description: Step one body
faqs:
  - question: How much does it cost
    answer: We send a written estimate
---

Short body copy here.
`;
const yamlWords = countBodyWords(
  yamlCopyFromFrontmatter({
    h1: 'Visible Headline For Counting',
    description: 'Meta description words on the live page.',
    whyChooseUs: [{ title: 'Why one', description: 'Why one body' }],
    process: [{ title: 'Step one', description: 'Step one body' }],
    faqs: [{ question: 'How much does it cost', answer: 'We send a written estimate' }],
  }),
);
assert(yamlWords >= 20, `yaml copy words (${yamlWords})`);
const mdWords = countMarkdownWords(homeWithYaml);
const bodyOnly = countBodyWords(stripFrontmatter(homeWithYaml));
assert(mdWords > bodyOnly, 'YAML copy added to word count');
const titleOnly = countMarkdownWords(`---
title: Browser Title Words Should Not Count
---

Alpha beta.
`);
assertEqual(titleOnly, 2, 'browser title ignored');

const yamlInv = inventoryFromFiles(
  {
    'src/content/pages/index.md': homeWithYaml,
    'src/content/services/install.md': `---
h1: Service Headline
description: Service blurb words here.
---

Service body one two.
`,
  },
  'assembled',
);
assertEqual(yamlInv.pageCount, 2, 'pages still file count');
assert(yamlInv.wordCount > 30, `yaml inventory words (${yamlInv.wordCount})`);

console.log('test-site-inventory: ok');
