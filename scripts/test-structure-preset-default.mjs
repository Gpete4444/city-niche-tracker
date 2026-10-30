/**
 * Unsaved Structure starts on preset C.
 * Run: node scripts/test-structure-preset-default.mjs
 */
import { getDefaultStructureSelection } from '../ops/lib/content-structure.mjs';

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

const selection = getDefaultStructureSelection();
assertEqual(selection.presetId, 'C', 'default preset');
assert(selection.pages.includes('services'), 'services page');
assert(selection.pages.includes('locations'), 'locations page');
assert(!selection.sections.includes('offerProcess'), 'deep offer process stays off');

console.log('test-structure-preset-default: ok');
