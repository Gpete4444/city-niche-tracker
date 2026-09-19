import { displayLabelForSlot, sectionGroupKey, sectionLabelForGroup } from '../ops/lib/fill-site-images.mjs';
import { reviewSlotServiceSubtitle } from '../ops/lib/review-slot-service-subtitle.mjs';
import { loadSectionRegistry } from '../ops/lib/content-structure.mjs';

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
  '',
  'process slot has no subtitle once the heading is the service',
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
  '',
  'materials slot has no subtitle once the heading is the service',
);

const registry = loadSectionRegistry();
assertEqual(
  sectionLabelForGroup('materials', registry),
  'Homepage · Materials & methods',
  'homepage materials heading',
);
assertEqual(
  sectionLabelForGroup('svcMaterials', registry),
  'Services · Materials & methods',
  'service materials heading',
);
assertEqual(
  sectionLabelForGroup('services', registry),
  'What we do (services grid)',
  'mixed services group stays unprefixed',
);
assertEqual(
  sectionLabelForGroup('process', registry),
  'Homepage · Process / how we work',
  'homepage process heading',
);
assertEqual(sectionGroupKey('svcProcess'), 'svcProcess', 'process group without slug stays combined');
assertEqual(
  sectionGroupKey('svcProcess', { serviceSlug: 'commercial-concrete-leveling' }),
  'svcProcess:commercial-concrete-leveling',
  'process group key includes service slug',
);
assertEqual(sectionGroupKey('svcMaterials'), 'svcMaterials', 'materials group without slug stays combined');
assertEqual(
  sectionGroupKey('svcMaterials', { serviceSlug: 'commercial-concrete-leveling' }),
  'svcMaterials:commercial-concrete-leveling',
  'materials group key includes service slug',
);
assertEqual(
  sectionLabelForGroup('svcProcess', registry),
  'Services · Service process',
  'bare service process heading',
);
assertEqual(
  sectionLabelForGroup('svcProcess', registry, { serviceName: 'Commercial Concrete Leveling' }),
  'Services · Commercial Concrete Leveling',
  'process heading uses service name',
);
assertEqual(
  sectionLabelForGroup('svcProcess:commercial-concrete-leveling', registry, {
    serviceName: 'Commercial Concrete Leveling',
  }),
  'Services · Commercial Concrete Leveling',
  'per-service process group heading',
);
assertEqual(
  sectionLabelForGroup('svcMaterials', registry, { serviceName: 'Commercial Concrete Leveling' }),
  'Services · Materials & methods · Commercial Concrete Leveling',
  'materials heading uses service name',
);
assertEqual(
  sectionLabelForGroup('svcMaterials:commercial-concrete-leveling', registry, {
    serviceName: 'Commercial Concrete Leveling',
  }),
  'Services · Materials & methods · Commercial Concrete Leveling',
  'per-service materials group heading',
);

console.log('test-review-slot-service-subtitle: ok');
