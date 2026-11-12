/**
 * Niche image prompts reuse stock phrases and before/after copy by service.
 * Run: node scripts/test-niche-image-prompts.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  baEntryMentionsCity,
  baPromptComplete,
  getNicheImagePrompts,
  imagePromptFill,
  mergeNicheImagePrompts,
  promptMentionsCity,
  promptsFromImagesPlan,
  saveNicheImagePromptRecord,
} from '../ops/lib/niche-image-prompts.mjs';
import { matchKeyForSlot } from '../ops/lib/photo-groups.mjs';

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

const fullBa = {
  room: 'pool deck',
  inside: { before: 'dirt before', after: 'turf after' },
  outside: { before: 'wide dirt', after: 'wide turf' },
};

assert(promptMentionsCity('turf in Casa Grande yard', 'Casa Grande'), 'city name is detected');
assert(!promptMentionsCity('wide artificial turf backyard', 'Casa Grande'), 'generic phrase has no city');
assert(baPromptComplete(fullBa), 'four before/after lines are complete');
assert(!baPromptComplete({ inside: { before: 'only' } }), 'a short before/after entry is incomplete');
assert(
  baEntryMentionsCity(
    {
      ...fullBa,
      outside: { before: 'yard in Florence', after: 'turf after' },
    },
    'Florence',
  ),
  'a city inside one before/after line is detected',
);

assertEqual(
  matchKeyForSlot({ sectionId: 'svcHero', index: 9, serviceName: 'Pool Surround Turf' }),
  'svcHero:pool surround turf',
  'service hero matches the service name',
);

const stored = promptsFromImagesPlan({
  city: 'Casa Grande',
  imageSlots: [
    { key: 'hero-1', sectionId: 'hero', index: 1 },
    { key: 'svcHero-3', sectionId: 'svcHero', index: 3, serviceName: 'Pool Surround Turf' },
  ],
  baSlots: [{ key: 'svc:pool-surround-turf' }, { key: 'home:1' }],
  plan: {
    slots: {
      'hero-1': { query: 'turf install in Casa Grande' },
      'svcHero-3': { query: 'pool surround artificial turf' },
    },
    beforeAfter: {
      'svc:pool-surround-turf': fullBa,
      'home:1': {
        ...fullBa,
        inside: { before: 'Casa Grande dirt', after: 'turf after' },
      },
    },
  },
});
assert(!stored.slots['home:hero:1'], 'a stock phrase that names the city is not stored');
assertEqual(stored.slots['svcHero:pool surround turf'], 'pool surround artificial turf', 'service query stored by name');
assert(stored.beforeAfter['svc:pool-surround-turf'], 'service before/after stored by slug');
assert(!stored.beforeAfter['home:1'], 'homepage before/after that names the city is not stored');

const merged = mergeNicheImagePrompts(
  { slots: { 'svcHero:pool surround turf': 'pool surround artificial turf' }, beforeAfter: {} },
  {
    slots: { 'svcHero:pool surround turf': 'replacement phrase', 'home:hero:1': 'finished turf lawn' },
    beforeAfter: { 'svc:pool-surround-turf': fullBa },
  },
);
assertEqual(merged.slots['svcHero:pool surround turf'], 'pool surround artificial turf', 'existing phrase stays');
assertEqual(merged.slots['home:hero:1'], 'finished turf lawn', 'empty key is added');
assert(merged.beforeAfter['svc:pool-surround-turf'], 'empty before/after key is added');
assertEqual(merged.added, 2, 'only new keys count as added');

const fill = imagePromptFill({
  library: {
    slots: { 'svcHero:pool surround turf': 'pool surround artificial turf' },
    beforeAfter: { 'svc:pool-surround-turf': fullBa },
  },
  imageSlots: [
    { key: 'svcHero-9', sectionId: 'svcHero', index: 9, serviceName: 'Pool Surround Turf' },
    { key: 'svcHero-1', sectionId: 'svcHero', index: 1, serviceName: 'Pet Turf Installation' },
  ],
  baSlots: [{ key: 'svc:pool-surround-turf' }, { key: 'svc:pet-turf-installation' }],
  planSlots: {},
  planBeforeAfter: {},
});
assertEqual(fill.slots['svcHero-9'].query, 'pool surround artificial turf', 'later city copies the service hero phrase');
assert(!fill.slots['svcHero-1'], 'a service with no saved phrase is left for Claude');
assert(fill.beforeAfter['svc:pool-surround-turf'], 'later city copies the service before/after prompt');
assert(!fill.beforeAfter['svc:pet-turf-installation'], 'a new service before/after is left for Claude');

const dir = mkdtempSync(path.join(tmpdir(), 'niche-prompts-'));
const file = path.join(dir, 'prompts.json');
const remembered = mergeNicheImagePrompts(null, stored);
assert(remembered.added >= 1, 'merge of a fresh library adds prompts');
saveNicheImagePromptRecord(
  'Artificial Turf',
  { slots: remembered.slots, beforeAfter: remembered.beforeAfter },
  file,
);
const loaded = getNicheImagePrompts('artificial turf', file);
assertEqual(
  loaded.slots['svcHero:pool surround turf'],
  'pool surround artificial turf',
  'library round-trips the service phrase',
);
rmSync(dir, { recursive: true, force: true });

console.log('test-niche-image-prompts: ok');
