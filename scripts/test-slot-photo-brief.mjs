/**
 * Slot photo briefs on cards and in generate / Image-queries prompts.
 * Run: npx tsx scripts/test-slot-photo-brief.mjs
 */
import { slotRoleLine, buildFluxSlotPrompt, buildFluxBaPrompts } from '../ops/lib/flux-prompts.mjs';
import {
  defaultSlotDescription,
  slotPhotoBrief,
  withSlotDescriptions,
} from '../ops/lib/slot-photo-brief.mjs';
import {
  listProcessStepsFromFrontmatter,
  listProcessStepsFromBody,
  listMaterialOptions,
  displayLabelForSlot,
} from '../ops/lib/fill-site-images.mjs';

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

const fm = `---
process:
  - title: "Site visit and inspection"
    description: "We walk the slab, check for leaks, and measure the height difference."
  - title: "Injection drilling"
    description: "We drill small holes at marked points along the low edge."
---
Body
`;
const homeSteps = listProcessStepsFromFrontmatter(fm);
assertEqual(homeSteps[0].title, 'Site visit and inspection', 'process FM title');
assert(
  /walk the slab/i.test(homeSteps[0].detail),
  'process FM description attaches',
);

const svcMd = `---
title: Test
---
Intro.

## Our Repair Process

- **Assess the hole** — size, location, and wall condition around it
- **Add backing if needed** — for holes too large for a simple mesh patch
`;
const bodySteps = listProcessStepsFromBody(svcMd);
assertEqual(bodySteps[0].title, 'Assess the hole', 'svcProcess title');
assert(/wall condition/i.test(bodySteps[0].detail), 'svcProcess detail');

const matMd = `## Materials and methods we use

- **Two-part polyurethane foam**: Expands within seconds of injection.
`;
assertEqual(listMaterialOptions(matMd)[0].title, 'Two-part polyurethane foam', 'plain materials H2');

const hero = { sectionId: 'hero', kind: 'hero', label: 'Hero', key: 'hero-1' };
const heroBrief = defaultSlotDescription(hero, { niche: 'Concrete Lifting', city: 'Princeton' });
assert(/Concrete Lifting/i.test(heroBrief), 'hero brief names niche');
assert(/homepage hero/i.test(heroBrief), 'hero brief says homepage hero');

const materialSlot = {
  sectionId: 'materials',
  kind: 'materials',
  materialTitle: 'Two-part polyurethane foam',
  label: 'Two-part polyurethane foam',
  slotDescription: 'Expands within seconds of injection, adding almost no weight.',
};
const role = slotRoleLine(materialSlot);
assert(/Two-part polyurethane foam/.test(role), 'role includes material title');
assert(/What to show:/.test(role), 'role includes What to show');
assert(/Expands within seconds/.test(role), 'role includes slot description');

const generated = buildFluxSlotPrompt({
  niche: 'Concrete Lifting',
  city: 'Princeton',
  state: 'TX',
  viewpoint: 'inside',
  setting: 'residential',
  slot: materialSlot,
  forChatGpt: true,
});
assert(/What to show:/.test(generated), 'flux prompt includes What to show');
assert(/Expands within seconds/.test(generated), 'flux prompt includes material brief');

const ba = buildFluxBaPrompts({
  niche: 'Concrete Lifting',
  city: 'Princeton',
  state: 'TX',
  serviceName: 'Driveway Leveling',
  viewpoint: 'inside',
  setting: 'residential',
  forChatGpt: true,
});
assert(/What to show:/.test(`${ba.before} ${ba.after} ${ba.pair}`), 'BA prompts include brief');
assert(/Driveway Leveling/.test(ba.before), 'BA brief names service');

const attached = withSlotDescriptions(
  [{ sectionId: 'intro', kind: 'intro', label: 'Intro', key: 'intro-1' }],
  { niche: 'Concrete Lifting' },
);
assert(attached[0].slotDescription, 'withSlotDescriptions fills default');
assertEqual(
  slotPhotoBrief(materialSlot).description,
  materialSlot.slotDescription,
  'content description wins over default',
);

const queryPayload = {
  key: materialSlot.key || 'materials-1',
  description: materialSlot.slotDescription,
};
assert(queryPayload.description, 'Image queries payload can carry description');

const wylieHome = `## Mudjacking and Foam Concrete Lifting Methods in Wylie, TX

- **Cement-based slurry**: The core of mudjacking, mixed to a pumpable consistency that fills voids.
- **Two-part expanding polyurethane foam**: Lightweight and fast-curing.
`;
const wylieMats = listMaterialOptions(wylieHome);
const homeMaterialSlot = {
  sectionId: 'materials',
  kind: 'materials',
  key: 'materials-1',
  label: 'Materials & methods',
  materialTitle: wylieMats[0].title,
  slotDescription: wylieMats[0].detail,
};
assertEqual(
  displayLabelForSlot(homeMaterialSlot),
  'Cement-based slurry',
  'homepage materials card title is the material, not the section',
);
assertEqual(
  slotPhotoBrief(homeMaterialSlot, { niche: 'Concrete Lifting', city: 'Wylie' }).description,
  wylieMats[0].detail,
  'homepage materials card uses the bullet, not the generic website-photo line',
);
assert(
  !/website photo for/i.test(slotPhotoBrief(homeMaterialSlot, { niche: 'Concrete Lifting', city: 'Wylie' }).description),
  'homepage materials brief is not the generic fallback',
);

console.log('test-slot-photo-brief: ok');
