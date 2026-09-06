import {
  looksCommercialName,
  siteSettingKind,
  serviceSettingKind,
  slotSettingKind,
  storedBaLooksResidential,
} from '../ops/lib/image-setting.mjs';
import { roomHint } from '../ops/lib/chatgpt-before-after.mjs';
import { buildFluxSlotPrompt, buildFluxBaPrompts } from '../ops/lib/flux-prompts.mjs';

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

console.log('test-image-setting: ok');
