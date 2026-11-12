import {
  looksCommercialName,
  siteSettingKind,
  serviceSettingKind,
  slotSettingKind,
  storedBaLooksResidential,
} from '../ops/lib/image-setting.mjs';
import { cameraViewpointLine, roomHint } from '../ops/lib/chatgpt-before-after.mjs';
import { buildFluxSlotPrompt, buildFluxBaPrompts } from '../ops/lib/flux-prompts.mjs';
import {
  applyBaOccupancyPrompts,
  applyOccupancyToPrompt,
  CUSTOMER_RULES,
  normalizeOccupancy,
  NO_PEOPLE_RULES,
  occupancyLine,
  PEOPLE_RULES,
} from '../ops/lib/image-occupancy.mjs';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(looksCommercialName('Commercial drywall repair', 'commercial-drywall-repair'), 'name+slug');
assert(looksCommercialName('Office and retail wall patching', ''), 'office/retail');
assert(!looksCommercialName('Drywall repair', 'drywall-repair'), 'residential name');

assert(
  serviceSettingKind({
    serviceName: 'Commercial popcorn ceiling removal',
    config: { services: ['Drywall repair'], commercialServices: ['Commercial popcorn ceiling removal'] },
  }) === 'commercial',
  'listed commercialServices',
);
assert(
  serviceSettingKind({
    serviceName: 'Drywall repair',
    config: { services: ['Drywall repair'], commercialServices: ['Commercial drywall repair'] },
  }) === 'residential',
  'listed residential',
);

assert(
  siteSettingKind({ services: ['Commercial drywall repair'], commercialServices: [] }) === 'commercial',
  'commercial-only via names',
);
assert(
  siteSettingKind({ services: ['Drywall repair'], commercialServices: ['Commercial drywall repair'] }) ===
    'residential',
  'mixed site home is residential',
);

assert(
  slotSettingKind({
    serviceName: 'Commercial texture matching',
    config: { services: ['Texture matching'], commercialServices: ['Commercial texture matching'] },
  }) === 'commercial',
  'slot with commercial service',
);
assert(
  slotSettingKind({
    config: { services: ['Drywall repair'], commercialServices: ['Commercial drywall repair'] },
  }) === 'residential',
  'home slot on mixed site',
);

assert(storedBaLooksResidential('living room with an unfinished drywall seam', 'living room'), 'stale home');
assert(
  !storedBaLooksResidential('office corridor with a drywall hole', 'office corridor'),
  'commercial stored',
);

const commercialRoom = roomHint('drywall', ['Commercial repair'], 'inside', 'commercial');
assert(!/living room|residential interior/i.test(commercialRoom), 'commercial roomHint not home');
assert(/office|retail|commercial/i.test(commercialRoom), 'commercial roomHint commercial interior');

const stills = buildFluxSlotPrompt({
  niche: 'drywall',
  city: 'Austin',
  state: 'TX',
  viewpoint: 'inside',
  setting: 'commercial',
  slot: { serviceName: 'Commercial drywall repair', key: 'svc-hero', kind: 'hero' },
  forChatGpt: true,
});
assert(!/ordinary residential setting|living room/i.test(stills), 'commercial stills not home');
assert(/commercial/i.test(stills), 'commercial stills mention commercial');

const ba = buildFluxBaPrompts({
  niche: 'drywall',
  city: 'Austin',
  state: 'TX',
  serviceName: 'Commercial drywall repair',
  viewpoint: 'inside',
  setting: 'commercial',
  forChatGpt: true,
});
assert(!/lived-in ordinary house|living room|residential architecture/i.test(`${ba.before} ${ba.after}`), 'commercial BA not home');
assert(/commercial architecture|commercial interior|commercial building/i.test(ba.before), 'commercial BA architecture');

const garageInsideRoom = roomHint('Custom Cabinets', ['Garage Storage Cabinets'], 'inside', 'residential');
assert(/residential garage interior/i.test(garageInsideRoom), 'garage inside room');
assert(!/kitchen/i.test(garageInsideRoom), 'garage inside is not a kitchen');

const garageOutsideRoom = roomHint('Custom Cabinets', ['Garage Storage Cabinets'], 'outside', 'residential');
assert(/driveway in front of the garage door/i.test(garageOutsideRoom), 'garage outside driveway');
assert(!/kitchen window/i.test(garageOutsideRoom), 'garage outside is not a kitchen window');

const kitchenRoom = roomHint('Custom Cabinets', ['Custom Kitchen Cabinets'], 'inside', 'residential');
assert(/kitchen/i.test(kitchenRoom), 'kitchen cabinets stay in the kitchen');

const mixedRoom = roomHint(
  'Custom Cabinets',
  ['Custom Kitchen Cabinets', 'Garage Storage Cabinets'],
  'inside',
  'residential',
);
assert(/kitchen/i.test(mixedRoom), 'mixed services stay on the kitchen rule');
assert(!/garage interior/i.test(mixedRoom), 'one garage service does not flip the homepage');

assert(
  /residential garage interior/i.test(roomHint('Garage Door Repair', [], 'inside', 'residential')),
  'garage niche with no service is a garage interior',
);
assert(
  /commercial garage or service-bay interior/i.test(
    roomHint('Custom Cabinets', ['Garage Storage Cabinets'], 'inside', 'commercial'),
  ),
  'commercial garage interior',
);

const garageInsideLine = cameraViewpointLine({
  viewpoint: 'inside',
  room: garageInsideRoom,
  place: 'Brushy Creek, TX',
  focus: 'Garage Storage Cabinets',
});
assert(/standing inside the garage/i.test(garageInsideLine), 'inside camera stands in the garage');
assert(/not in the kitchen, hallway, or another room of the house looking in/i.test(garageInsideLine), 'inside camera is not the house looking in');
assert(!/from indoors/i.test(garageInsideLine), 'garage inside does not use the generic indoors line');

const garageOutsideLine = cameraViewpointLine({
  viewpoint: 'outside',
  room: garageOutsideRoom,
  place: 'Brushy Creek, TX',
  focus: 'Garage Storage Cabinets',
});
assert(/on the driveway/i.test(garageOutsideLine), 'outside camera is on the driveway');
assert(/not at a kitchen window/i.test(garageOutsideLine), 'outside camera is not a kitchen window');

const garageStill = buildFluxSlotPrompt({
  niche: 'Custom Cabinets',
  city: 'Brushy Creek',
  state: 'TX',
  viewpoint: 'inside',
  setting: 'residential',
  slot: {
    serviceName: 'Garage Storage Cabinets',
    materialTitle: 'Heavy-Duty Plywood',
    queryHint: 'heavy duty plywood garage cabinet build',
    key: 'svcMaterials-garage-storage-cabinets-1',
  },
  forChatGpt: true,
});
assert(/standing inside the garage/i.test(garageStill), 'garage stills stand inside the garage');
assert(!/interior shot of the kitchen/i.test(garageStill), 'garage stills are not a kitchen interior');

const garageStillOutside = buildFluxSlotPrompt({
  niche: 'Custom Cabinets',
  city: 'Brushy Creek',
  state: 'TX',
  viewpoint: 'outside',
  setting: 'residential',
  slot: { serviceName: 'Garage Storage Cabinets', key: 'svcHero-garage' },
  forChatGpt: true,
});
assert(/on the driveway/i.test(garageStillOutside), 'garage outside stills use the driveway');
assert(!/near kitchen window/i.test(garageStillOutside), 'garage outside stills are not a kitchen window');

const kitchenStill = buildFluxSlotPrompt({
  niche: 'Custom Cabinets',
  city: 'Brushy Creek',
  state: 'TX',
  viewpoint: 'inside',
  setting: 'residential',
  slot: { serviceName: 'Custom Kitchen Cabinets', key: 'svcHero-kitchen' },
  forChatGpt: true,
});
assert(/interior shot of the kitchen/i.test(kitchenStill), 'kitchen stills stay in the kitchen');

const garageBa = buildFluxBaPrompts({
  niche: 'Custom Cabinets',
  city: 'Brushy Creek',
  state: 'TX',
  serviceName: 'Garage Storage Cabinets',
  viewpoint: 'inside',
  setting: 'residential',
  forChatGpt: true,
});
assert(/standing inside the garage/i.test(`${garageBa.before} ${garageBa.after}`), 'garage BA stands inside the garage');
assert(!/interior shot of the kitchen/i.test(`${garageBa.before} ${garageBa.after}`), 'garage BA is not a kitchen');

assert(normalizeOccupancy(undefined) === 'none', 'occupancy default none');
assert(normalizeOccupancy('people') === 'workers', 'legacy people is workers');
assert(normalizeOccupancy('PEOPLE') === 'workers', 'legacy PEOPLE is workers');
assert(normalizeOccupancy('workers') === 'workers', 'occupancy workers');
assert(normalizeOccupancy('customers') === 'customers', 'occupancy customers');
assert(normalizeOccupancy('finished') === 'finished', 'occupancy finished');
assert(normalizeOccupancy('none') === 'none', 'occupancy none');

const emptyScene = buildFluxSlotPrompt({
  niche: 'drywall',
  city: 'Austin',
  state: 'TX',
  viewpoint: 'inside',
  setting: 'residential',
  slot: { serviceName: 'Drywall repair', key: 'hero-1', kind: 'hero' },
  forChatGpt: true,
});
assert(/No people, no faces/i.test(emptyScene), 'default occupancy no people');
assert(!/trade workers actively doing the described job/i.test(emptyScene), 'default occupancy no workers');
assert(/Show the problem this service will fix/i.test(emptyScene), 'default occupancy names the problem');
assert(!/Empty rooms, installs, tools, and materials only/i.test(emptyScene), 'default occupancy is not an empty room of tools');

const homepageProblem = buildFluxSlotPrompt({
  niche: 'Foundation Repair',
  city: 'Mapleton',
  state: 'UT',
  viewpoint: 'outside',
  setting: 'residential',
  slot: { serviceName: 'Foundation Repair', key: 'hero-1', sectionId: 'hero', kind: 'hero' },
  forChatGpt: true,
});
assert(/homepage hero — wide photo of the problem this service fixes/i.test(homepageProblem), 'homepage hero problem role');
assert(/Show the problem this service will fix/i.test(homepageProblem), 'homepage hero problem clause');
assert(!/finished product only/i.test(homepageProblem), 'homepage hero problem is not finished');

const homepageIntroProblem = buildFluxSlotPrompt({
  niche: 'Foundation Repair',
  city: 'Mapleton',
  state: 'UT',
  viewpoint: 'outside',
  setting: 'residential',
  occupancy: 'none',
  slot: { serviceName: 'Foundation Repair', key: 'intro-1', sectionId: 'intro', kind: 'intro' },
  forChatGpt: true,
});
assert(/intro — wide photo of the problem this service fixes/i.test(homepageIntroProblem), 'homepage intro problem role');
const staleIntro = homepageIntroProblem.replace(
  'Slot role: intro — wide photo of the problem this service fixes, still unfinished.',
  'Slot role: intro section — clean supporting photo of the trade in a residential setting.',
);
const refreshedIntro = applyOccupancyToPrompt(staleIntro, 'finished', {
  niche: 'Foundation Repair',
  serviceName: 'Foundation Repair',
  setting: 'residential',
});
assert(/intro — wide photo of the finished result/i.test(refreshedIntro), 'saved intro prompt follows Finished');
assert(!/clean supporting photo of the trade/i.test(refreshedIntro), 'saved intro prompt drops the old role');

const homepageFinished = buildFluxSlotPrompt({
  niche: 'Foundation Repair',
  city: 'Mapleton',
  state: 'UT',
  viewpoint: 'outside',
  occupancy: 'finished',
  setting: 'residential',
  slot: { serviceName: 'Foundation Repair', key: 'hero-1', sectionId: 'hero', kind: 'hero' },
  forChatGpt: true,
});
assert(/problem is solved and the result is complete, with no people/i.test(homepageFinished), 'homepage hero finished role');
assert(/finished product only, with the problem solved/i.test(homepageFinished), 'homepage hero finished clause');
assert(!/trade workers actively doing the described job/i.test(homepageFinished), 'finished occupancy not workers');
assert(!/Show people using the finished/i.test(homepageFinished), 'finished occupancy not customers');
assert(!/Show the problem this service will fix/i.test(homepageFinished), 'finished occupancy is not the problem');
const servedFinished = applyOccupancyToPrompt(homepageFinished, 'finished', {
  niche: 'Foundation Repair',
  serviceName: 'Foundation Repair',
  setting: 'residential',
});
assert(
  /problem is solved and the result is complete, with no people/i.test(servedFinished),
  'finished role keeps no people when the occupancy line is swapped',
);

const serviceCardProblem = buildFluxSlotPrompt({
  niche: 'Foundation Repair',
  city: 'Mapleton',
  state: 'UT',
  viewpoint: 'outside',
  setting: 'residential',
  slot: { serviceName: 'Piering And Underpinning', key: 'svcHero-1', sectionId: 'svcHero', kind: 'hero' },
  forChatGpt: true,
});
assert(/hero \/ service card/i.test(serviceCardProblem), 'service card keeps its role line');
assert(!/homepage hero — wide photo of the problem/i.test(serviceCardProblem), 'service card is not the homepage hero role');
assert(/Show the problem this service will fix/i.test(serviceCardProblem), 'service card still gets the problem sentence');

const peopleScene = buildFluxSlotPrompt({
  niche: 'drywall',
  city: 'Austin',
  state: 'TX',
  viewpoint: 'inside',
  occupancy: 'people',
  setting: 'residential',
  slot: { serviceName: 'Drywall repair', key: 'hero-1', kind: 'hero' },
  forChatGpt: true,
});
assert(/trade workers actively doing the described job/i.test(peopleScene), 'people occupancy workers');
assert(!/Empty rooms, installs, tools, and materials only/i.test(peopleScene), 'people occupancy not empty-room');

const peopleBa = buildFluxBaPrompts({
  niche: 'drywall',
  city: 'Austin',
  state: 'TX',
  serviceName: 'Drywall repair',
  viewpoint: 'inside',
  occupancy: 'people',
  setting: 'residential',
  forChatGpt: true,
});
assert(/trade workers/i.test(peopleBa.before), 'people BA before workers');
assert(/trade workers/i.test(peopleBa.after), 'people BA after workers');

const customerScene = buildFluxSlotPrompt({
  niche: 'artificial turf',
  city: 'El Mirage',
  state: 'AZ',
  viewpoint: 'outside',
  occupancy: 'customers',
  setting: 'commercial',
  slot: {
    serviceName: 'Commercial putting greens',
    key: 'svc-hero',
    kind: 'hero',
    processTitle: 'Compaction',
  },
  forChatGpt: true,
});
assert(/Commercial putting greens/i.test(customerScene), 'turf people names that service');
assert(/artificial turf/i.test(customerScene), 'turf people names the niche');
assert(/staff and visitors/i.test(customerScene), 'commercial people use the space');
assert(/already complete and in use/i.test(customerScene), 'customers process slot is finished');
assert(!/mid-work result/i.test(customerScene), 'customers process slot drops mid-work');
assert(!/trade workers actively doing the described job/i.test(customerScene), 'customers occupancy not workers');
assert(!/off-niche lifestyle scenes/i.test(customerScene), 'customers occupancy allows use');
assert(!/golfers/i.test(customerScene), 'turf people drops the golfer template');
assert(!/play turf/i.test(customerScene), 'turf people drops the play-turf template');

const epoxyScene = buildFluxSlotPrompt({
  niche: 'Epoxy Flooring',
  city: 'Phoenix',
  state: 'AZ',
  viewpoint: 'inside',
  occupancy: 'customers',
  setting: 'residential',
  slot: {
    serviceName: 'Garage epoxy floors',
    key: 'svc-hero',
    kind: 'hero',
  },
  forChatGpt: true,
});
assert(/Garage epoxy floors/i.test(epoxyScene), 'epoxy people names the service');
assert(/Epoxy Flooring/i.test(epoxyScene), 'epoxy people names the niche');
assert(/household/i.test(epoxyScene), 'home epoxy people are the household');
assert(!/turf/i.test(epoxyScene), 'epoxy people does not mention turf');
assert(!/golf/i.test(epoxyScene), 'epoxy people does not mention golf');
const epoxyAgain = applyOccupancyToPrompt(epoxyScene, 'customers', {
  niche: 'Epoxy Flooring',
  serviceName: 'Garage epoxy floors',
  setting: 'residential',
});
assert(!/turf|golf/i.test(epoxyAgain), 'second pass does not put turf back');
assert((epoxyAgain.match(/Show people using the finished/gi) || []).length === 1, 'epoxy people line once');

const epoxyFlux = occupancyLine(false, 'customers', {
  niche: 'Epoxy Flooring',
  serviceName: 'Garage epoxy floors',
  setting: 'residential',
});
assert(/Garage epoxy floors/i.test(epoxyFlux), 'flux epoxy line names the service');
assert(/Epoxy Flooring/i.test(epoxyFlux), 'flux epoxy line names the niche');
assert(!/turf|golf/i.test(epoxyFlux), 'flux epoxy line has no turf or golf');

const customerBa = buildFluxBaPrompts({
  niche: 'artificial turf',
  city: 'El Mirage',
  state: 'AZ',
  serviceName: 'Sports and play-area turf',
  viewpoint: 'outside',
  occupancy: 'customers',
  setting: 'residential',
  forChatGpt: true,
});
assert(/No people, no faces/i.test(customerBa.before), 'customers BA before stays empty');
assert(!/people using the finished/i.test(customerBa.before), 'customers BA before has no people');
assert(/people using the finished Sports and play-area turf/i.test(customerBa.after), 'customers BA after names the turf service');
assert(/artificial turf/i.test(customerBa.after), 'customers BA after names the turf niche');
assert(/Keep the same crop, camera, and room/i.test(customerBa.after), 'customers BA after keeps crop');
assert(!/golfers/i.test(`${customerBa.before} ${customerBa.after}`), 'customers BA has no golfer template');
assert(!/trade workers actively doing the described job/i.test(`${customerBa.before} ${customerBa.after}`), 'customers BA not workers');

const epoxyBa = buildFluxBaPrompts({
  niche: 'Epoxy Flooring',
  city: 'Phoenix',
  state: 'AZ',
  serviceName: 'Garage epoxy floors',
  viewpoint: 'inside',
  occupancy: 'customers',
  setting: 'residential',
  forChatGpt: true,
});
assert(/No people, no faces/i.test(epoxyBa.before), 'epoxy BA before stays empty');
assert(!/people using the finished/i.test(epoxyBa.before), 'epoxy BA before has no people');
assert(/Garage epoxy floors/i.test(epoxyBa.after), 'epoxy BA after names the service');
assert(/Epoxy Flooring/i.test(epoxyBa.after), 'epoxy BA after names the niche');
assert(!/turf|golf/i.test(`${epoxyBa.before} ${epoxyBa.after}`), 'epoxy BA has no turf or golf');

const claude = 'Documentary contractor photo. No people, no faces, no hands, no crew, no customers, no silhouettes. No text, logos, or watermarks.';
const withPeople = applyOccupancyToPrompt(claude, 'people');
assert(withPeople.includes(PEOPLE_RULES), 'apply occupancy people replaces no-people');
assert(!/No people, no faces/i.test(withPeople), 'apply occupancy people removes no-people');
const back = applyOccupancyToPrompt(withPeople, 'none');
assert(back.includes(NO_PEOPLE_RULES), 'apply occupancy none restores no-people');
assert(!/trade workers actively doing the described job/i.test(back), 'apply occupancy none removes workers');

const appended = applyOccupancyToPrompt('Photoreal documentary still of a finished drywall patch.', 'people');
assert(appended.includes(PEOPLE_RULES), 'apply occupancy people appends when no clause');

const withCustomers = applyOccupancyToPrompt(withPeople, 'customers');
assert(withCustomers.includes(CUSTOMER_RULES), 'apply occupancy customers replaces workers');
assert(!/trade workers actively doing the described job/i.test(withCustomers), 'customers swap removes workers');
assert(!/turf|golf/i.test(withCustomers), 'default people line has no turf or golf');
const customersBack = applyOccupancyToPrompt(withCustomers, 'none');
assert(customersBack.includes(NO_PEOPLE_RULES), 'customers swap back to empty');
assert(!/people using the finished/i.test(customersBack), 'empty swap removes people');

const finishedSwap = applyOccupancyToPrompt(back, 'finished');
assert(/finished product only, with the problem solved/i.test(finishedSwap), 'finished occupancy replaces problem');
assert(!/Show the problem this service will fix/i.test(finishedSwap), 'finished occupancy removes problem clause');
const problemAgain = applyOccupancyToPrompt(finishedSwap, 'none');
assert(problemAgain.includes(NO_PEOPLE_RULES), 'problem occupancy restores the problem line');
assert(!/finished product only/i.test(problemAgain), 'problem occupancy removes finished');

const pairProblem = buildFluxBaPrompts({
  niche: 'Foundation Repair',
  city: 'Mapleton',
  state: 'UT',
  serviceName: 'Foundation Repair',
  viewpoint: 'outside',
  occupancy: 'none',
  setting: 'residential',
  forChatGpt: true,
});
assert(/Show the problem this service will fix/i.test(pairProblem.before), 'pair problem before is the problem');
assert(/finished product only, with the problem solved/i.test(pairProblem.after), 'pair problem after is finished');
assert(!/Show the problem this service will fix/i.test(pairProblem.after), 'pair problem after is not the problem');
const pairFinished = buildFluxBaPrompts({
  niche: 'Foundation Repair',
  city: 'Mapleton',
  state: 'UT',
  serviceName: 'Foundation Repair',
  viewpoint: 'outside',
  occupancy: 'finished',
  setting: 'residential',
  forChatGpt: true,
});
assert(/Show the problem this service will fix/i.test(pairFinished.before), 'pair finished before stays the problem');
assert(/finished product only, with the problem solved/i.test(pairFinished.after), 'pair finished after is finished');

const oldTurf =
  'Photo of the work. Show the intended customers using the finished product the way this service is meant to be used. Match who they are to the subject: a household using a home feature, a family or children playing on sports or play turf, golfers on a putting green, or the natural users of a commercial space. The work is already complete. No install crew, no tools in use, no job-site mess. Natural candid use, not a posed stock smile. No text, no logos, no watermarks, no UI, no phone screens.';
const strippedTurf = applyOccupancyToPrompt(oldTurf, 'customers', {
  niche: 'Epoxy Flooring',
  serviceName: 'Garage epoxy floors',
  setting: 'residential',
});
assert(/Garage epoxy floors/i.test(strippedTurf), 'old turf sentence is replaced with the epoxy service');
assert(!/golfers|play turf/i.test(strippedTurf), 'old turf sentence is stripped');

const baCustomers = applyBaOccupancyPrompts(
  'BEFORE scene. No people. Do not change anything except the service defect.',
  'AFTER scene. Do not change anything except the service defect. No people.',
  'customers',
);
assert(/No people, no faces/i.test(baCustomers.before), 'ba customers before empty');
assert(!/people using the finished/i.test(baCustomers.before), 'ba customers before not users');
assert(/people using the finished/i.test(baCustomers.after), 'ba customers after users');
assert(/Keep the same crop, camera, and room/i.test(baCustomers.after), 'ba customers after keeps crop');
assert(!/Do not change anything except the service defect/i.test(baCustomers.after), 'ba customers after may add users');

console.log('test-image-setting: ok');
