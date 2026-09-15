/**
 * SEO grade forever: Repair/Install identity, review City, ST, service-card city, Web3 copy.
 * Run: node scripts/test-seo-grade-forever.mjs
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  brandVerbIdentity,
  coerceNicheToBrandVerb,
  normalizeReviewLocation,
  sanitizeSiteConfigIdentity,
} from '../ops/lib/site-config.mjs';
import { formatCityStateLabel, topReviewLocations } from '../scripts/lib/review-seed.mjs';
import { lintContentSeo } from '../ops/lib/content-seo-lint.mjs';
import {
  applyAcceptedWeb3KeyToSiteConfigFile,
  isAcceptedWeb3Key,
} from '../ops/lib/assemble-site.mjs';

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

assertEqual(
  brandVerbIdentity('Springfield Drywall Repair Pros', 'springfielddrywallrepairpros.com'),
  'repair',
  'repair brand+domain',
);
assertEqual(
  brandVerbIdentity('Omaha Egress Window Pros', 'omahaegresswindowpros.com'),
  null,
  'omaha egress — no coerce',
);
assertEqual(
  brandVerbIdentity('Topeka Drywall Installation Pros', 'topekadrywallinstallation.com'),
  'install',
  'install-only brand',
);
assertEqual(
  brandVerbIdentity('Repair & Install Pros', 'springfieldrepairinstall.com'),
  null,
  'mixed verbs stay put',
);

const coerced = coerceNicheToBrandVerb({
  businessName: 'Springfield Drywall Repair Pros',
  domain: 'springfielddrywallrepairpros.com',
  niche: 'Drywall Installation',
  commercialServices: ['Office Drywall Repair', 'Tenant Buildouts'],
  services: ['Water Damage Repair', 'New Drywall Installation'],
});
assertEqual(coerced.niche, 'Drywall Repair', 'Repair Pros + Installation niche → Drywall Repair');
assert(
  Array.isArray(coerced.commercialServices) && coerced.commercialServices.length === 2,
  'Both Accept keeps commercialServices',
);
assertEqual(coerced.services[1], 'New Drywall Installation', 'residential install card stays');

const both = sanitizeSiteConfigIdentity({
  businessName: 'Hoover Drywall Repair Pros',
  domain: 'hooverdrywallrepairpros.com',
  niche: 'Drywall Repair',
  commercialServices: ['Commercial Drywall Repair'],
  socialProof: {
    reviews: [{ location: 'Hoover, AL, AL' }, { location: 'Birmingham, AL' }],
  },
  state: 'AL',
});
assertEqual(both.niche, 'Drywall Repair', 'already-repair niche unchanged');
assertEqual(both.commercialServices[0], 'Commercial Drywall Repair', 'sanitize does not strip commercial');
assertEqual(both.socialProof.reviews[0].location, 'Hoover, AL', 'collapse City, ST, ST');
assertEqual(both.socialProof.reviews[1].location, 'Birmingham, AL', 'already-correct location');

const installBrand = coerceNicheToBrandVerb({
  businessName: 'Peoria Drywall Installation Pros',
  domain: 'peoriadrywallinstallation.com',
  niche: 'Drywall Repair',
});
assertEqual(installBrand.niche, 'Drywall Installation', 'install brand coerces repair niche');

const omaha = coerceNicheToBrandVerb({
  businessName: 'Omaha Egress Window Pros',
  domain: 'omahaegresswindowpros.com',
  niche: 'Egress Window Installation',
});
assertEqual(omaha.niche, 'Egress Window Installation', 'Omaha egress niche stays Installation');

assertEqual(formatCityStateLabel('Boise, ID', 'ID'), 'Boise, ID', 'do not append state twice');
assertEqual(formatCityStateLabel('Boise', 'ID'), 'Boise, ID', 'append when missing');
assertEqual(formatCityStateLabel('Boise, ID, ID', 'ID'), 'Boise, ID', 'collapse doubled state');
assertEqual(normalizeReviewLocation('Boise, ID, ID', 'ID'), 'Boise, ID', 'sanitize doubled location');

const locs = topReviewLocations({
  primaryCity: 'Meridian',
  state: 'ID',
  targetSuburbs: ['Boise, ID', 'Nampa'],
});
assertEqual(locs[0], 'Meridian, ID', 'primary city + state');
assertEqual(locs[1], 'Boise, ID', 'suburb already has state');
assertEqual(locs[2], 'Nampa, ID', 'suburb gets state once');

const mismatch = lintContentSeo(
  {
    'src/content/pages/index.md': `---
title: "Drywall Installation in Springfield, IL"
h1: "Drywall Installation in Springfield, IL"
---

Intro about installation.
`,
  },
  {
    businessName: 'Springfield Drywall Repair Pros',
    domain: 'springfielddrywallrepairpros.com',
    niche: 'Drywall Repair',
    primaryCity: 'Springfield',
    tagline: 'Drywall installation in Springfield, IL — patches, texture, free estimates.',
  },
);
const verbHit = (mismatch.findings || []).find((f) => f.rule === 'niche_brand_verb_mismatch');
assert(verbHit && verbHit.severity === 'critical', 'critical niche_brand_verb_mismatch');

const matchOk = lintContentSeo(
  {
    'src/content/pages/index.md': `---
title: "Drywall Repair in Springfield, IL"
h1: "Drywall Repair in Springfield, IL"
---

Intro about repair.
`,
  },
  {
    businessName: 'Springfield Drywall Repair Pros',
    domain: 'springfielddrywallrepairpros.com',
    niche: 'Drywall Repair',
    tagline: 'Drywall repair in Springfield, IL — patches, texture, free estimates.',
  },
);
assert(
  !(matchOk.findings || []).some((f) => f.rule === 'niche_brand_verb_mismatch'),
  'matching Repair identity does not lint',
);

const stuffedFiles = {
  'src/content/pages/index.md': `---
title: "Drywall Repair in Nampa, ID"
h1: "Drywall Repair in Nampa, ID"
---
`,
  'src/content/services/water-damage.md': `---
title: "Water Damage"
description: "Water damage drywall repair in Nampa, ID for soaked walls."
---
`,
  'src/content/services/texture.md': `---
title: "Texture"
description: "Texture matching in Nampa, ID after a patch."
---
`,
  'src/content/services/holes.md': `---
title: "Holes"
description: "Hole patching in Nampa, ID the same day."
---
`,
};
const stuffed = lintContentSeo(stuffedFiles, {
  businessName: 'Nampa Drywall Repair Pros',
  domain: 'nampadrywallrepairpros.com',
  primaryCity: 'Nampa',
  state: 'ID',
});
assert(
  (stuffed.findings || []).some((f) => f.rule === 'service_card_city_stuffing' && f.severity === 'soft'),
  'soft service_card_city_stuffing',
);

const cleanCards = lintContentSeo(
  {
    'src/content/pages/index.md': `---
title: "Drywall Repair in Nampa, ID"
h1: "Drywall Repair in Nampa, ID"
---
`,
    'src/content/services/water-damage.md': `---
title: "Water Damage"
description: "Water-damaged board cut out, dried, and finished paint-ready."
---
`,
    'src/content/services/texture.md': `---
title: "Texture"
description: "Knockdown and orange peel blended so the patch disappears."
---
`,
    'src/content/services/holes.md': `---
title: "Holes"
description: "Backing, tape, and mud for fist-size holes before texture."
---
`,
  },
  {
    businessName: 'Nampa Drywall Repair Pros',
    domain: 'nampadrywallrepairpros.com',
    primaryCity: 'Nampa',
    state: 'ID',
  },
);
assert(
  !(cleanCards.findings || []).some((f) => f.rule === 'service_card_city_stuffing'),
  'entity-rich cards do not stuff city',
);

assert(!isAcceptedWeb3Key('YOUR_WEB3FORMS_ACCESS_KEY'), 'placeholder not accepted');
assert(!isAcceptedWeb3Key(''), 'empty not accepted');
assert(isAcceptedWeb3Key('40143640-cdb7-4aaa-bbbb-cccccccccccc'), 'uuid key accepted');

const dir = mkdtempSync(path.join(tmpdir(), 'rover-web3-'));
try {
  const cfgPath = path.join(dir, 'site-config.json');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    cfgPath,
    `${JSON.stringify({ web3FormsAccessKey: 'YOUR_WEB3FORMS_ACCESS_KEY', niche: 'Drywall Repair' }, null, 2)}\n`,
    'utf8',
  );
  const copied = applyAcceptedWeb3KeyToSiteConfigFile(cfgPath, {
    web3FormsAccessKey: '40143640-cdb7-4aaa-bbbb-cccccccccccc',
  });
  assert(copied.copied, 'assemble copies accepted web3 key');
  const after = JSON.parse(readFileSync(cfgPath, 'utf8'));
  assertEqual(after.web3FormsAccessKey, '40143640-cdb7-4aaa-bbbb-cccccccccccc', 'assembled key replaced');
  const again = applyAcceptedWeb3KeyToSiteConfigFile(cfgPath, {
    web3FormsAccessKey: '40143640-cdb7-4aaa-bbbb-cccccccccccc',
  });
  assertEqual(again.reason, 'already', 'idempotent when already copied');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('test-seo-grade-forever: ok');
