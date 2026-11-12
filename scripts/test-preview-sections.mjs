/**
 * Equal grids (no empty last-row cells), process sentence case, timeline unpack.
 * Run: npx tsx scripts/test-preview-sections.mjs
 */
import { autoFixContentDraft } from '../ops/lib/content-auto-fix.mjs';
import { sentenceCaseLine } from '../src/lib/content-body.ts';
import { fewCommercialGridClass, fitEqualGrid } from '../src/lib/equal-grid.ts';
import { parseTimelineStages } from '../src/lib/section-parse.ts';

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

const six = fitEqualGrid([1, 2, 3, 4, 5, 6]);
assertEqual(six.cols, 3, '6 process steps → 3 cols');
assertEqual(six.items.length, 6, '6 process steps kept');
assert(six.className.includes('lg:grid-cols-3'), '3-col class from lg');

const two = fitEqualGrid(['a', 'b'], { maxCols: 3 });
assertEqual(two.cols, 2, '2 materials cards → 2 cols');
assertEqual(two.trimmed, 0, '2 materials cards not trimmed');
assert(!two.className.includes('lg:grid-cols-3'), '2 materials cards have no empty third cell');

const three = fitEqualGrid(['a', 'b', 'c'], { maxCols: 3 });
assertEqual(three.cols, 3, '3 materials cards → 3 cols');

const five = fitEqualGrid([1, 2, 3, 4, 5], { maxCols: 3 });
assertEqual(five.cols, 2, '5 materials → 2 cols');
assertEqual(five.items.length, 4, '5 materials trim to 4 (complete rows)');

const fourWide = fitEqualGrid([1, 2, 3, 4]);
const residential4 = { count: fourWide.items.length, className: fourWide.className };
assert(fewCommercialGridClass(1, residential4).includes('lg:grid-cols-4'), '1 commercial beside 4-col residential');
assert(fewCommercialGridClass(2, residential4).includes('lg:grid-cols-4'), '2 commercial beside 4-col residential');

const sixWide = fitEqualGrid([1, 2, 3, 4, 5, 6]);
const residential3 = { count: sixWide.items.length, className: sixWide.className };
assert(fewCommercialGridClass(1, residential3).includes('lg:grid-cols-3'), '1 commercial beside 3-col residential');
assert(fewCommercialGridClass(2, residential3).includes('lg:grid-cols-3'), '2 commercial beside 3-col residential');

assert(
  fewCommercialGridClass(1, { count: 0, className: '' }).includes('lg:grid-cols-4'),
  '1 commercial with no residential uses the 4-col track',
);
assert(
  fewCommercialGridClass(2, { count: 1, className: 'grid-cols-1' }).includes('lg:grid-cols-4'),
  '2 commercial beside one residential card uses the 4-col track',
);
assertEqual(fewCommercialGridClass(3, residential4), null, '3 commercial cards keep fitEqualGrid');

assertEqual(
  sentenceCaseLine('check ceiling condition and texture age'),
  'Check ceiling condition and texture age.',
  'process sentence case + period',
);
assertEqual(sentenceCaseLine('Already a sentence.'), 'Already a sentence.', 'leave finished sentence');
assertEqual(sentenceCaseLine('OK'), 'OK', 'short fragment no extra period');

const packed = parseTimelineStages(`Intro.

- **Small hole patch** — 1 day, room usable that evening **Doorknob-size hole** — including full cure **Crack fill only** — , dry within hours
`);
assert(packed.length >= 2, `packed timeline splits into stages, got ${packed.length}`);
assert(
  packed.every((s) => !/\*\*/.test(`${s.title} ${s.detail}`)),
  'no leftover ** in timeline stages',
);
assert(
  packed.some((s) => /small hole/i.test(s.title)),
  'first packed label becomes a stage title',
);
assert(
  packed.some((s) => /doorknob/i.test(s.title)),
  'second packed label becomes a stage title',
);
assert(
  packed.every((s) => !(/—\s*,/.test(s.detail) || /^,/.test(s.detail))),
  'dash-comma leftovers cleaned',
);

const healed = autoFixContentDraft({
  'src/content/pages/index.md': `---
title: Test
process:
  - title: Assessment visit
    description: check ceiling condition and texture age
---

## Process

- **Wet and scrape** — soften texture, scrape to bare board
`,
});
assert(
  /description: Check ceiling condition and texture age\./.test(healed.files['src/content/pages/index.md']),
  'YAML process description sentence-cased',
);
assert(
  /\*\*Wet and scrape\*\* — Soften texture, scrape to bare board\./.test(
    healed.files['src/content/pages/index.md'],
  ),
  'list process description sentence-cased',
);

console.log('test-preview-sections: ok');
