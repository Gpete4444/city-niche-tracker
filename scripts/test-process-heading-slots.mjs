/**
 * Process H2s that the site treats as How it works must yield Review step titles.
 * Run: npx tsx scripts/test-process-heading-slots.mjs
 */
import { isProcessHeading } from '../src/lib/is-process-heading.mjs';
import { parseServiceBody } from '../src/lib/service-body.ts';
import { listProcessStepTitlesFromBody } from '../ops/lib/fill-site-images.mjs';

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

assert(isProcessHeading('Our Repair Process'), 'Our Repair Process');
assert(isProcessHeading('Our Sheetrock Repair Process'), 'Our {service} Process');
assert(isProcessHeading('Our Patch & Repair Process'), 'Our Patch & Repair Process');
assert(isProcessHeading('Our Process for Builders'), 'Our Process for Builders');
assert(isProcessHeading('Our Drywall Approach'), 'Our … Approach');
assert(isProcessHeading('How Our Drywall Repair Process Works'), 'How Our … Process Works');
assert(isProcessHeading('How the process works'), 'how the process works');
assert(isProcessHeading('How we work'), 'How we work');
assert(!isProcessHeading("What's Included"), 'scope is not process');
assert(!isProcessHeading('Materials and Methods'), 'materials is not process');
assert(!isProcessHeading('What does a repair cost?'), 'cost is not process');

const steps = `- **Assess the hole** — size, location, and wall condition around it
- **Add backing if needed** — for holes too large for a simple mesh patch
- **Apply patch material** — mesh, plug, or cutout section set into place
`;

const ourRepair = `---
title: Test
---
Intro.

## Our Repair Process

${steps}
`;

const howWorks = `---
title: Test
---
Intro.

## How Our Drywall Hole Repair Process Works

${steps}
`;

const ourTitles = listProcessStepTitlesFromBody(ourRepair);
const howTitles = listProcessStepTitlesFromBody(howWorks);
assertEqual(ourTitles, howTitles, 'Our Repair Process titles match How Our … Process Works');
assertEqual(
  ourTitles,
  ['Assess the hole', 'Add backing if needed', 'Apply patch material'],
  'step titles from Our Repair Process body',
);

const parsed = parseServiceBody(ourRepair.replace(/^---[\s\S]*?---\n?/, ''));
const processSec = parsed.sections.find((s) => s.kind === 'process');
assert(processSec, 'template classifies Our Repair Process as process');
assertEqual(
  (processSec.steps || []).map((s) => s.title),
  ourTitles,
  'template steps match Review slot titles',
);

console.log('test-process-heading-slots: ok');
