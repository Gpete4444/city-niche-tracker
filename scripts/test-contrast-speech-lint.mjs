/**
 * Contrast-family cap: one closer is legal; two+ flag.
 * Run: node scripts/test-contrast-speech-lint.mjs
 */
import { countContrastHits, lintContentSpeech } from '../ops/lib/content-speech-lint.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

const none = `---
title: About
---
We re-secure the fastener, then fill and texture-match the paint.
`;

const one = `---
title: About
---
This isn't a paint-over, it's a real repair. Then we texture match and prime.
`;

const two = `---
title: About
---
This isn't a paint-over, it's a real repair.

Most jobs are tape, mud, and a clean sand.

We do not just hide the bump but open the cavity and reset the fastener.
`;

assert(countContrastHits(none) === 0, 'plain mechanism is 0 hits');
assert(countContrastHits(one) === 1, 'single Omaha-style closer is 1 hit');
assert(countContrastHits(two) >= 2, 'two distant closers count as 2+');

const noneLint = lintContentSpeech({ 'src/content/pages/about.md': none });
const oneLint = lintContentSpeech({ 'src/content/pages/about.md': one });
const twoLint = lintContentSpeech({ 'src/content/pages/about.md': two });

assert(
  !noneLint.findings.some((f) => f.rule === 'contrast_closer'),
  'no contrast finding on mechanism-only copy',
);
assert(
  !oneLint.findings.some((f) => f.rule === 'contrast_closer'),
  'single closer does not fail',
);
assert(
  twoLint.findings.some((f) => f.rule === 'contrast_closer'),
  'two closers flag contrast_closer',
);

console.log('test-contrast-speech-lint: ok');
