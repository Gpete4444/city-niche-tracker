/**
 * Structured em-dash budget + one-dash cost autofix.
 * Run: node scripts/test-em-dash-budget.mjs
 */
import { autoFixContentDraft } from '../ops/lib/content-auto-fix.mjs';
import { lintContentSpeech } from '../ops/lib/content-speech-lint.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

const prose = `---
title: Office
---
Most office patch jobs are quick — nail holes from old shelving.
`;

const oneCost = `---
title: Cost
---
## Typical costs
- **Small patch** — $150–$400, one hole
`;

const overBudget = `---
title: Home
h1: Drywall Repair
---
Intro copy about holes and cracks.

## Typical costs
- **Small patch** — $150–$400, one hole
- **Room** — $800–$1,800, several walls

## Materials
- **Setting compound** — hardens fast in heat
- **Paper tape** — stronger joints than mesh
- **Primer** — seals the patch

## Timeline
- **Same day** — small patches
- **Two days** — texture match
`;

const proseLint = lintContentSpeech({ 'src/content/pages/index.md': prose });
assert(
  proseLint.findings.some((f) => f.rule === 'em_dash'),
  'prose em dash still flags',
);

const costLint = lintContentSpeech({ 'src/content/pages/index.md': oneCost });
assert(
  !costLint.findings.some((f) => f.rule === 'em_dash_density'),
  'one structured cost row stays inside budget',
);
assert(
  !costLint.findings.some((f) => f.rule === 'em_dash'),
  'structured cost row is not prose em_dash',
);

const heavyLint = lintContentSpeech({ 'src/content/pages/index.md': overBudget });
assert(
  heavyLint.findings.some((f) => f.rule === 'em_dash_density'),
  'Preset-C-shaped extra lists exceed budget',
);

const doubleCost = {
  'src/content/pages/index.md': `---
title: Cost
---
## Typical costs
- **Small patch** — $150–$400 — one hole
`,
};
const fixed = autoFixContentDraft(doubleCost);
assert(
  fixed.files['src/content/pages/index.md'].includes('— $150–$400, one hole'),
  'second cost dash becomes a comma',
);

console.log('test-em-dash-budget: ok');
