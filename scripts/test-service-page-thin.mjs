/**
 * Thin service pages: cut-off intros and short prose stay on the Accept
 * stub list; a full page drops a stale stub warning.
 * Run: node scripts/test-service-page-thin.mjs
 */
import { lintContentSeo } from '../ops/lib/content-seo-lint.mjs';
import {
  SERVICE_OWNED_MIN_WORDS,
  listLaunchContentGaps,
  serviceOpeningCutOff,
  servicePageNeedsExpand,
  syncLaunchGapsOnOps,
} from '../ops/lib/preview-fidelity.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

const rel = 'src/content/services/open-cell.md';
const config = { services: ['Open cell'], commercialServices: [] };
const pageIds = ['services'];

function page(body) {
  return `---
title: "Open cell"
description: "Open cell spray foam."
h1: "Open cell"
serviceName: "Open cell"
---

${body}
`;
}

const prose = 'Crews fill the open wall cavity and leave a quiet finished room. ';
const cutOff = page(`A finished room that's always too loud, or an

${prose.repeat(80)}

## Our process

- **Prep** — Cover the room before spraying.
`);
const short = page(`Open cell foam fills the wall cavity and quiets the room.

## Our process

- **Prep** — Cover the room before spraying.
- **Spray** — Fill the cavity in one pass.
`);
const full = page(`${prose.repeat(80)}

## Our process

- **Prep** — Cover the room before spraying.
`);
const stub = page(
  `${'Open-cell spray foam is part of our insulation offering in Nampa. Call or use the estimate form. '}${prose.repeat(80)}`,
);

assert(SERVICE_OWNED_MIN_WORDS === 450, 'service prose floor is 450 words');
assert(serviceOpeningCutOff(cutOff) === true, 'cut-off opening is detected');
assert(servicePageNeedsExpand(rel, cutOff) === true, 'cut-off page still expands when the rest is long');
assert(servicePageNeedsExpand(rel, short) === true, 'short service prose expands');
assert(servicePageNeedsExpand(rel, full) === false, 'full service prose does not expand');
assert(serviceOpeningCutOff(full) === false, 'a finished opening is not cut off');
assert(servicePageNeedsExpand(rel, stub) === true, 'seed stub fingerprint still expands');

const gaps = listLaunchContentGaps({ [rel]: cutOff }, config, pageIds);
assert(gaps.stubs.includes(rel), 'cut-off service stays on the launch stub list');
const clear = listLaunchContentGaps({ [rel]: full }, config, pageIds);
assert(clear.stubs.length === 0 && clear.ok === true, 'full service clears launch stubs');

const stale = syncLaunchGapsOnOps(
  {
    check: {
      warnings: [`Stub/thin content (not launch-ready): ${rel}`, 'Keep this warning'],
      launch: { stubs: [rel], missing: [], expected: [] },
    },
    contract: {
      warnings: [`Stub/thin content (not launch-ready): ${rel}`, 'Contract note'],
    },
  },
  { [rel]: full },
  config,
  pageIds,
);
assert(stale.changed === true, 'stale stub check is rewritten');
assert(
  !stale.ops.check.warnings.some((w) => w.includes(rel)),
  'cleared page drops the stub warning',
);
assert(stale.ops.check.warnings.includes('Keep this warning'), 'other warnings stay');
assert(stale.ops.check.launch.stubs.length === 0, 'launch stubs follow the file');
assert(
  !stale.ops.contract.warnings.some((w) => /Stub\/thin/.test(w)),
  'stale contract stub line is dropped',
);
assert(stale.ops.contract.warnings.includes('Contract note'), 'other contract warnings stay');

const still = syncLaunchGapsOnOps(
  {
    check: {
      warnings: [],
      launch: { stubs: [], missing: [], expected: [] },
    },
  },
  { [rel]: short },
  config,
  pageIds,
);
assert(still.changed === true, 'a short page writes a fresh stub warning');
assert(
  still.ops.check.warnings.some((w) => w === `Stub/thin content (not launch-ready): ${rel}`),
  'short page warning is the Accept stub line',
);

const seo = lintContentSeo({ [rel]: cutOff });
assert(
  seo.findings.some((f) => f.rule === 'service_body_thin' && f.severity === 'critical' && f.file === rel),
  'cut-off service is a critical SEO finding',
);
const seoFull = lintContentSeo({ [rel]: full });
assert(
  !seoFull.findings.some((f) => f.rule === 'service_body_thin'),
  'full service is not service_body_thin',
);

console.log('test-service-page-thin: ok');
