import { autoFixContentDraft } from '../ops/lib/content-auto-fix.mjs';
import { lintContentSpeech } from '../ops/lib/content-speech-lint.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

const files = {
  'src/content/services/office-wall-patching.md': `---
title: Office Wall Patching
---
Most office patch jobs are quick — nail holes from old shelving, dents from chairs.

- **Inspect** — find the hole
- **Patch** — mud and sand
`,
  'src/content/services/commercial-popcorn-ceiling-removal.md': `---
title: Commercial Popcorn
---
## Commercial Popcorn Ceiling Removal FAQs

That's your choice — many businesses go with a smooth finish.

Typical jobs run $300—$1,200 or 24—48 hours.

Wait — The crew shows up next.
`,
};

const before = lintContentSpeech(files);
assert(
  before.findings.some((f) => f.rule === 'em_dash' && /office-wall/.test(f.file)),
  'office prose em dash should be flagged',
);
assert(
  before.findings.some((f) => f.rule === 'em_dash' && /popcorn/.test(f.file)),
  'FAQ prose em dash should be flagged',
);

const fixed = autoFixContentDraft(files);
const office = fixed.files['src/content/services/office-wall-patching.md'];
const popcorn = fixed.files['src/content/services/commercial-popcorn-ceiling-removal.md'];
const leftovers = lintContentSpeech(fixed.files).findings.filter((f) => f.rule === 'em_dash');

assert(office.includes('quick, nail holes'), 'lowercase follow-on becomes comma');
assert(office.includes('- **Inspect** — find the hole'), 'structured Inspect bullet kept');
assert(office.includes('- **Patch** — mud and sand'), 'structured Patch bullet kept');
assert(popcorn.includes('choice, many businesses'), 'FAQ lowercase follow-on becomes comma');
assert(popcorn.includes('$300–$1,200'), 'money range becomes en dash');
assert(popcorn.includes('24–48'), 'hour range becomes en dash');
assert(popcorn.includes('Wait. The crew'), 'capitalized follow-on becomes period');
assert(!/[—\u2014]/.test(popcorn.replace(/^---[\s\S]*?---/, '')), 'popcorn body has no leftover em dash');
assert(
  leftovers.length === 0,
  `em_dash leftovers after auto-fix: ${JSON.stringify(leftovers)}`,
);

console.log('test-em-dash-autofix: ok');
