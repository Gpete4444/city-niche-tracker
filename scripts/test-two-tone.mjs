/**
 * Two-tone H1 split: short geo titles and long `|` keyword tails.
 * Run: npx tsx scripts/test-two-tone.mjs
 */
import {
  joinTwoToneParts,
  preferAccentPhrase,
  splitTwoToneHeading,
} from '../src/lib/two-tone.ts';

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

const pearland = 'Drywall Repair in Pearland, TX';
const pearlandPrefer = preferAccentPhrase(pearland, [
  'in Pearland, TX',
  'in Pearland',
  'Pearland',
]);
assertEqual(pearlandPrefer.lead, 'Drywall Repair', 'pearland lead');
assertEqual(pearlandPrefer.accent, 'in Pearland, TX', 'pearland accent');
assertEqual((pearlandPrefer.rest || '').trim(), '', 'pearland has no rest');
assertEqual(joinTwoToneParts(pearlandPrefer), pearland, 'pearland join');

const pearlandSplit = splitTwoToneHeading(pearland);
assertEqual(pearlandSplit.lead, 'Drywall Repair', 'pearland split lead');
assertEqual(pearlandSplit.accent, 'in Pearland, TX', 'pearland split accent');
assertEqual(joinTwoToneParts(pearlandSplit), pearland, 'pearland split join');

const sugarLand =
  'Drywall Repair in Sugar Land, TX | Patch, Crack & Texture-Match Pros';
const sugarPrefer = preferAccentPhrase(sugarLand, [
  'in Sugar Land, TX',
  'in Sugar Land',
  'Sugar Land',
]);
assertEqual(sugarPrefer.lead, 'Drywall Repair', 'sugar land lead');
assertEqual(sugarPrefer.accent, 'in Sugar Land, TX', 'sugar land accent');
assert(
  String(sugarPrefer.rest || '').includes('| Patch, Crack & Texture-Match Pros'),
  'sugar land rest keeps pipe keywords',
);
assertEqual(joinTwoToneParts(sugarPrefer), sugarLand, 'sugar land join preserves full H1');

const sugarSplit = splitTwoToneHeading(sugarLand);
assertEqual(sugarSplit.lead, 'Drywall Repair', 'sugar land split lead');
assertEqual(sugarSplit.accent, 'in Sugar Land, TX', 'sugar land split accent');
assert(
  String(sugarSplit.rest || '').includes('| Patch, Crack & Texture-Match Pros'),
  'sugar land split rest keeps pipe keywords',
);
assertEqual(joinTwoToneParts(sugarSplit), sugarLand, 'sugar land split join preserves full H1');

const cityOnly = preferAccentPhrase(sugarLand, ['Sugar Land']);
assertEqual(cityOnly.accent, 'in Sugar Land, TX', 'city prefer still includes in + state');
assertEqual(joinTwoToneParts(cityOnly), sugarLand, 'city prefer join');

console.log('test-two-tone: ok');
