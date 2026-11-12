/**
 * A cut-off service FILE path is joined or mapped, and the other pages are kept.
 * Run: node scripts/test-content-file-paths.mjs
 */
import { parseContentFileBlocks } from '../ops/lib/content-markdown.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

function page(title, sentence) {
  return `---\ntitle: "${title}"\n---\n\n${sentence}\n`;
}

const poolPage = page('Pool Surround Turf', 'Pool surround body stays with the service.');
const contactPage = page('Contact', 'Contact body stays in the reply.');
const expected = [
  'src/content/services/pool-surround-turf.md',
  'src/content/services/pool-deck-turf.md',
  'src/content/pages/contact.md',
];

const wrapped = parseContentFileBlocks(
  `### FILE: src/content/services/pool\n-surround-turf.md\n${poolPage}`,
);
assert(
  wrapped['src/content/services/pool-surround-turf.md'],
  'a wrapped pool line becomes pool-surround-turf.md',
);
assert(
  !wrapped['src/content/services/pool-surround-turf.md'].includes('-surround-turf.md'),
  'the wrapped name is not left in the page body',
);
assert(
  wrapped['src/content/services/pool-surround-turf.md'].includes('Pool surround body stays with the service.'),
  'the wrapped page keeps its body',
);

const prefixed = parseContentFileBlocks(
  `### FILE: src/content/services/pool\n${poolPage}`,
  { expectedPaths: ['src/content/services/pool-surround-turf.md'] },
);
assert(
  prefixed['src/content/services/pool-surround-turf.md']?.includes('Pool surround body stays with the service.'),
  'a unique pool prefix maps to pool-surround-turf.md',
);
assert(!prefixed['src/content/services/pool.md'], 'a unique prefix is not saved as pool.md');

const forgotten = parseContentFileBlocks(
  `### FILE: src/content/services/pool-surround-turf\n${poolPage}`,
  { expectedPaths: expected },
);
assert(
  forgotten['src/content/services/pool-surround-turf.md'],
  'a full slug missing .md is saved as the service file',
);

const kept = parseContentFileBlocks(
  `### FILE: src/content/pages/contact.md\n${contactPage}\n### FILE: src/content/services/pool\n${poolPage}`,
  { expectedPaths: expected },
);
assert(kept['src/content/pages/contact.md']?.includes('Contact body stays in the reply.'), 'the other page is saved');
assert(!kept['src/content/services/pool.md'], 'an ambiguous pool path is not saved as pool.md');
assert(
  !kept['src/content/services/pool-surround-turf.md'] && !kept['src/content/services/pool-deck-turf.md'],
  'an ambiguous pool prefix is not guessed',
);

let threw = '';
try {
  parseContentFileBlocks(`### FILE: src/content/services/pool\n${poolPage}`, { expectedPaths: expected });
} catch (error) {
  threw = error.message;
}
assert(
  threw ===
    'Invalid content path "src/content/services/pool" — must be src/content/{pages|services|locations}/kebab-name.md',
  'a reply with no usable page still reports the invalid path',
);

const fullFirst = parseContentFileBlocks(
  `### FILE: src/content/services/pool-surround-turf.md\n${page('Full', 'Full header wins.')}\n### FILE: src/content/services/pool\n${page('Short', 'Short header loses.')}`,
  { expectedPaths: ['src/content/services/pool-surround-turf.md'] },
);
assert(
  fullFirst['src/content/services/pool-surround-turf.md'].includes('Full header wins.'),
  'a full filename is kept when a shortened path maps to the same file',
);

console.log('test-content-file-paths: ok');
