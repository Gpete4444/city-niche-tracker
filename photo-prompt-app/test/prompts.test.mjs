import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCandidateAllowed,
  buildBaPrompts,
  buildSlotPrompt,
  GILBERT_CANDIDATE_ID,
  parseObjectList,
} from '../lib/prompts.mjs';
import { planPrompts } from '../write-prompts.mjs';

const objects = parseObjectList('keypad deadbolt\nlarge flat-screen TV\n# comment\n');

test('object list skips blanks and comments', () => {
  assert.deepEqual(objects, ['keypad deadbolt', 'large flat-screen TV']);
});

test('a pairing step asks for trade workers and does not paste the caption', () => {
  const prompt = buildSlotPrompt(
    {
      sectionId: 'svcProcess',
      index: 4,
      processTitle: 'Pairing the hub',
      label: 'Pairing the hub',
      slotDescription: 'This caption talks about heat-rated camera housing and should never be pasted.',
    },
    objects,
  );
  assert.match(prompt, /trade workers/);
  assert.doesNotMatch(prompt, /heat-rated/);
  assert.doesNotMatch(prompt, /No people, no faces/);
});

test('a materials photo stays unoccupied and names the object', () => {
  const prompt = buildSlotPrompt(
    {
      sectionId: 'svcMaterials',
      index: 1,
      materialTitle: 'Keypad deadbolt',
      label: 'Keypad deadbolt',
      slotDescription: 'Marketing caption that must stay off the prompt.',
    },
    objects,
  );
  assert.match(prompt, /Unoccupied/);
  assert.match(prompt, /Keypad deadbolt/);
  assert.doesNotMatch(prompt, /trade workers/);
  assert.doesNotMatch(prompt, /Marketing caption/);
});

test('a touchscreen prompt keeps the screen on without the stock no-UI sentence', () => {
  const prompt = buildSlotPrompt(
    {
      sectionId: 'svcHero',
      index: 1,
      serviceName: 'Control panel',
      label: 'Wall touchscreen',
    },
    ['wall touchscreen control panel'],
  );
  assert.match(prompt, /screen is on/);
  assert.doesNotMatch(prompt, /No people, no faces/);
  assert.doesNotMatch(prompt, /no UI/);
});

test('before/after after-prompt is an edit of the before', () => {
  const pair = buildBaPrompts('Security cameras', ['bullet security camera'], 1);
  assert.match(pair.before, /Before installation/);
  assert.match(pair.after, /^Edit this photo/);
  assert.match(pair.after, /same camera/);
});

test('Gilbert is refused unless allowed', () => {
  assert.throws(() => assertCandidateAllowed(GILBERT_CANDIDATE_ID), /Gilbert/);
  assert.doesNotThrow(() => assertCandidateAllowed(GILBERT_CANDIDATE_ID, { allowGilbert: true }));
});

test('plan includes homepage before/after only when that section is on', () => {
  const off = planPrompts({
    slots: [{ key: 'hero-1', sectionId: 'hero', index: 1, label: 'Hero' }],
    ba: { homePairs: [{ pairIndex: 1 }], svcBeforeAfterEnabled: false, services: [] },
    structure: { sections: ['hero'], photos: {} },
    objects,
    viewpoint: 'inside',
  });
  assert.equal(off.pairs.length, 0);
  assert.equal(off.stills.length, 1);

  const on = planPrompts({
    slots: [],
    ba: {
      homePairs: [{ pairIndex: 1 }],
      svcBeforeAfterEnabled: true,
      services: [{ slug: 'cameras', serviceName: 'Security cameras' }],
    },
    structure: { sections: ['beforeAfter'], photos: {} },
    objects: ['bullet security camera'],
    viewpoint: 'inside',
  });
  assert.equal(on.pairs.length, 2);
  assert.equal(on.pairs[0].key, 'home:1');
  assert.equal(on.pairs[1].serviceSlug, 'cameras');
});
