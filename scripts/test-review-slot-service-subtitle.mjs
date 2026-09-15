import { displayLabelForSlot } from '../ops/lib/fill-site-images.mjs';
import { reviewSlotServiceSubtitle } from '../ops/lib/review-slot-service-subtitle.mjs';

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

const processSlot = {
  sectionId: 'svcProcess',
  index: 2,
  processTitle: 'Contain the room',
  label: 'Contain the room',
  serviceName: 'Sheetrock Repair',
};
const processCard = { ...processSlot, label: displayLabelForSlot(processSlot) };
assertEqual(processCard.label, 'Step 2: Contain the room', 'step title stays');
assertEqual(
  reviewSlotServiceSubtitle(processCard),
  'Sheetrock Repair',
  'process slot shows service subtitle',
);

const heroSlot = {
  sectionId: 'svcHero',
  label: 'Water Damage Drywall Repair',
  serviceName: 'Water Damage Drywall Repair',
};
assertEqual(reviewSlotServiceSubtitle(heroSlot), '', 'hero titled as service has no subtitle');

const homeProcess = {
  sectionId: 'process',
  index: 1,
  label: 'Step 1: Inspect',
};
assertEqual(reviewSlotServiceSubtitle(homeProcess), '', 'homepage process has no service');

const materials = {
  sectionId: 'svcMaterials',
  label: 'Joint compound',
  serviceName: 'Popcorn Ceiling Removal & Re-Texture',
};
assertEqual(
  reviewSlotServiceSubtitle(materials),
  'Popcorn Ceiling Removal & Re-Texture',
  'materials slot shows service',
);

console.log('test-review-slot-service-subtitle: ok');
