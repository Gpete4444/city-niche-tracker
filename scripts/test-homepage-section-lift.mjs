import {
  autoFixContentDraft,
  homepageDesignedSectionWarning,
  liftHomepageDesignedSections,
  stampHomepageLiftOnDraftOps,
} from '../ops/lib/content-auto-fix.mjs';
import { validateContentBundle } from '../ops/lib/content-markdown.mjs';
import { runTemplateContract } from '../ops/lib/template-contract.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

const greenvilleShaped = `---
title: "Concrete Lifting in Greenville, TX"
description: "Concrete slab lifting and mudjacking in Greenville, TX. Driveways, sidewalks, garage floors, foundation void filling. Free estimates."
h1: "Concrete Lifting in Greenville, TX"
---
Is your driveway or patio sinking on one side while the rest of the slab stays put? That uneven settling is almost always a clay soil problem.

## Materials and Methods We Use for Concrete Lifting

- **Closed-cell polyurethane foam**: Lightweight and fast-curing.

## Why Choose Greenville Concrete Lifting

- **Local clay knowledge**: Greenville Concrete Lifting works Hunt County clay every week.
- **Two methods, not one**: We pick foam or mudjacking based on the slab and void.
- **Written estimates before drilling**: You see the scope and price before any holes go in.

## How Our Concrete Lifting Process Works

- **Site inspection and void check** — We walk the slab and probe for void depth.
- **Method selection** — Foam or slurry is chosen from slab thickness and void size.
- **Drilling access holes** — Small holes are drilled at marked injection points.

## What does a Concrete Lifting cost in Greenville?

- **Sidewalk panel lift** — $300–$800, single panel foam injection.

## Concrete Lifting FAQs in Greenville, TX

How much does Concrete Lifting cost in Greenville?

Most jobs run $300 to $5,000 depending on slab type and void depth.

How long does Concrete Lifting take?

Most jobs are done in a single visit.

<!-- rover-autofix-links -->
- [Contact](/contact)
`;

const outline = {
  sections: [{ id: 'intro', heading: 'Concrete Lifting and Leveling for Greenville Homes and Businesses' }],
};
const config = { niche: 'Concrete Lifting', primaryCity: 'Greenville' };

const lifted = liftHomepageDesignedSections(greenvilleShaped, { outline, config });
assert(lifted.changed, 'Greenville-shaped homepage should lift');
assert(/^sectionHeading:\s+"/m.test(lifted.body), 'sectionHeading written');
assert(/^whyChooseUs:/m.test(lifted.body), 'whyChooseUs written');
assert(/^process:/m.test(lifted.body), 'process written');
assert(/^faqs:/m.test(lifted.body), 'faqs written');
assert(/Local clay knowledge/.test(lifted.body), 'why title preserved');
assert(/Site inspection and void check/.test(lifted.body), 'process title preserved');
assert(/How much does Concrete Lifting cost/.test(lifted.body), 'faq question preserved');
assert(!/## Why Choose/.test(lifted.body), 'why heading removed from body');
assert(!/## How Our Concrete Lifting Process Works/.test(lifted.body), 'process heading removed');
assert(!/## Concrete Lifting FAQs/.test(lifted.body), 'faq heading removed');
assert(/## Materials and Methods/.test(lifted.body), 'educational materials heading kept');
assert(/## What does a Concrete Lifting cost/.test(lifted.body), 'cost heading kept');
assert(/rover-autofix-links/.test(lifted.body), 'autofix links kept after faq lift');

const files = { 'src/content/pages/index.md': lifted.body };
const check = validateContentBundle(files, config, { mode: 'homepage_first' });
assert(
  !check.warnings.some((w) => /Homepage template fields are empty/.test(w)),
  'lifted homepage should not warn about designed sections',
);
const contract = runTemplateContract(files, config, { mode: 'homepage_first' });
assert(
  !contract.warnings.some((w) => /Homepage template fields are empty|intro heading is missing/.test(w)),
  'lifted homepage should pass template recommended keys',
);

const valid = `---
title: "Concrete Lifting in Sachse, TX"
description: "Concrete slab lifting and mudjacking in Sachse, TX."
h1: "Concrete Lifting in Sachse, TX"
sectionHeading: "Concrete Lifting Sachse homeowners trust"
whyChooseUs:
  - title: "Injection, not tear-out"
    description: "We raise the slab you already have."
  - title: "Written estimate"
    description: "You see the plan before any hole goes in."
process:
  - title: "Site visit"
    description: "We check the slab and confirm the settling pattern."
  - title: "Injection"
    description: "Material pumps under the slab and fills the void."
faqs:
  - question: "How much does slab jacking cost?"
    answer: "Most residential jobs in Sachse run $400 to $1,800."
  - question: "How long does it take?"
    answer: "Most single-slab jobs finish in a few hours."
---
Intro paragraph stays.

## What does a Concrete Lifting cost in Sachse?

- **Small lift** — $400–$900, one panel.
`;

const again = liftHomepageDesignedSections(valid, { outline, config });
assert(!again.changed, 'already-valid homepage should stay unchanged');
assert(again.body === valid, 'valid homepage bytes unchanged');

const unparseable = `---
title: "Concrete Lifting in Test, TX"
description: "Concrete slab lifting in Test, TX. Free estimates."
h1: "Concrete Lifting in Test, TX"
---
Intro only.

## Why Choose Test Concrete Lifting

We are local and we show up.

## How Our Concrete Lifting Process Works

We inspect then lift.

## Concrete Lifting FAQs

Call us.
`;

const failed = liftHomepageDesignedSections(unparseable, { outline, config });
assert(failed.changed, 'sectionHeading can still be seeded');
assert(/^sectionHeading:/m.test(failed.body), 'unparseable page still gets intro heading');
assert(!/^whyChooseUs:/m.test(failed.body), 'unparseable why stays out of frontmatter');
assert(!/^process:/m.test(failed.body), 'unparseable process stays out of frontmatter');
assert(!/^faqs:/m.test(failed.body), 'unparseable faqs stay out of frontmatter');

const failedCheck = validateContentBundle(
  { 'src/content/pages/index.md': failed.body },
  config,
  { mode: 'homepage_first' },
);
const allMissingWarning = homepageDesignedSectionWarning(['whyChooseUs', 'process', 'faqs']);
assert(
  failedCheck.warnings.includes(allMissingWarning),
  'leftover warning names every empty template field',
);
assert(
  failedCheck.warnings.filter((w) => w === allMissingWarning).length === 1,
  'one designed-section warning only',
);
assert(
  !failedCheck.warnings.some((w) => /homepage usually needs/.test(w)),
  'old key-dump warning is gone',
);

const auto = autoFixContentDraft(
  { 'src/content/pages/index.md': greenvilleShaped },
  { config, outline },
);
assert(
  auto.changes.some((c) => c.rule === 'homepage_designed_sections'),
  'autoFix records the homepage lift',
);
assert(/^whyChooseUs:/m.test(auto.files['src/content/pages/index.md']), 'autoFix writes whyChooseUs');

const rockwallWhy = `---
title: "Concrete Lifting in Rockwall, TX"
description: "Sunken driveway, patio, or pool deck in Rockwall? Foam or mudjacking. Free estimates."
h1: "Concrete Lifting in Rockwall, TX"
sectionHeading: "Rockwall Concrete Lifting for homes and businesses"
process:
  - title: "Site visit and slab assessment"
    description: "We inspect the sunken area and check how far it's dropped."
  - title: "Method selection"
    description: "Foam or mudjacking gets chosen based on soil, slab size, and use."
faqs:
  - question: "How much does Concrete Lifting cost in Rockwall?"
    answer: "Costs range from around $300 for a single sidewalk panel to several thousand dollars."
  - question: "How long does Concrete Lifting take?"
    answer: "Most residential jobs are done in a single visit."
---
Is your driveway dipping near the garage? Rockwall's clay soil moves with the seasons.

## Why choose Rockwall Concrete Lifting

- We offer both foam and mudjacking and recommend the one that fits your slab, not the one that's easiest for us to sell.
- Every job starts with an on-site look at the soil and void size before we name a method or a price.
- Drilling is small-diameter and patched the same visit, so the disruption to your driveway or patio is minimal.
- Rockwall Concrete Lifting gives written estimates before work begins, so there's no surprise invoice at the end.
- We're familiar with the expansive clay conditions around Lake Ray Hubbard and how they behave differently than inland soil.

## Polyurethane Concrete Lifting Cost Guide

- **Foam lifting** — $6–$12 per square foot, faster cure.
`;

const rockwallConfig = { niche: 'Concrete Lifting', primaryCity: 'Rockwall' };
const rockwallLifted = liftHomepageDesignedSections(rockwallWhy, {
  outline: {
    sections: [{ id: 'intro', heading: 'Rockwall Concrete Lifting for homes and businesses' }],
  },
  config: rockwallConfig,
});
assert(rockwallLifted.changed, 'Rockwall-shaped Why bullets should lift');
assert(/^whyChooseUs:/m.test(rockwallLifted.body), 'plain Why bullets write whyChooseUs');
assert(/We offer both foam and mudjacking/.test(rockwallLifted.body), 'Why description preserved');
assert(/Written estimates/i.test(rockwallLifted.body) || /Rockwall Concrete Lifting Gives/.test(rockwallLifted.body), 'Why title derived from bullet');
assert(!/## Why choose/.test(rockwallLifted.body), 'Why heading removed after plain-bullet lift');
assert(/## Polyurethane Concrete Lifting Cost Guide/.test(rockwallLifted.body), 'cost heading kept after Why lift');
assert(/^process:/m.test(rockwallLifted.body), 'existing process frontmatter kept');
assert(/^faqs:/m.test(rockwallLifted.body), 'existing faqs frontmatter kept');

const rockwallCheck = validateContentBundle(
  { 'src/content/pages/index.md': rockwallLifted.body },
  rockwallConfig,
  { mode: 'homepage_first' },
);
assert(
  !rockwallCheck.warnings.some((w) => /Why \/ Process \/ FAQs/.test(w)),
  'plain-bullet Why lift should clear designed-section warning',
);
const rockwallContract = runTemplateContract(
  { 'src/content/pages/index.md': rockwallLifted.body },
  rockwallConfig,
  { mode: 'homepage_first' },
);
assert(
  !rockwallContract.warnings.some((w) => /Why \/ Process \/ FAQs/.test(w)),
  'plain-bullet Why lift should pass template recommended keys',
);

const tightFaqs = `---
title: "Artificial Turf Installation in El Mirage, AZ"
description: "Artificial turf installation in El Mirage, AZ for small yards. Free estimates."
h1: "Artificial Turf Installation in El Mirage, AZ"
sectionHeading: "artificial turf contractor near me for El Mirage homes and businesses"
process:
  - title: "Site evaluation"
    description: "A technician inspects the area and discusses goals before any work begins."
  - title: "Base compaction"
    description: "A layered aggregate base is compacted to create a stable foundation."
whyChooseUs:
  - title: "Written estimates"
    description: "Written estimates spell out base depth and turf product before work starts."
  - title: "Same crew"
    description: "The crew installs what it recommends, so the person on site did the estimate."
---
Intro stays on the page.

## artificial grass installation El Mirage FAQs

How much does it cost to install 1000 square feet of artificial turf?
Expect roughly $7,000 to $11,000 for a standard 1,000 sqft install.

How long does artificial turf take?
Most backyard installs take 1 to 3 days from base prep through final brushing.

## Get a free estimate in El Mirage

Call for a written number.
`;

const tightConfig = { niche: 'artificial turf', primaryCity: 'El Mirage' };
const tightLifted = liftHomepageDesignedSections(tightFaqs, { outline, config: tightConfig });
assert(tightLifted.changed, 'tight question-then-answer FAQs should lift');
assert(/^faqs:/m.test(tightLifted.body), 'tight FAQs write faqs frontmatter');
assert(/How much does it cost to install 1000 square feet/.test(tightLifted.body), 'tight FAQ question preserved');
assert(/Expect roughly \$7,000 to \$11,000/.test(tightLifted.body), 'tight FAQ answer preserved');
assert(/How long does artificial turf take/.test(tightLifted.body), 'second tight FAQ question preserved');
assert(!/## artificial grass installation El Mirage FAQs/.test(tightLifted.body), 'tight FAQ heading removed');
assert(/## Get a free estimate in El Mirage/.test(tightLifted.body), 'following section kept after tight FAQ lift');
assert(/^process:/m.test(tightLifted.body), 'existing process kept during tight FAQ lift');
assert(/^whyChooseUs:/m.test(tightLifted.body), 'existing whyChooseUs kept during tight FAQ lift');
const tightCheck = validateContentBundle(
  { 'src/content/pages/index.md': tightLifted.body },
  tightConfig,
  { mode: 'full' },
);
assert(
  !tightCheck.warnings.some((w) => /Homepage template fields are empty/.test(w)),
  'tight FAQ lift should clear the designed-section warning',
);
const tightContract = runTemplateContract(
  { 'src/content/pages/index.md': tightLifted.body },
  tightConfig,
  { mode: 'full' },
);
assert(
  !tightContract.warnings.some((w) => /Homepage template fields are empty/.test(w)),
  'tight FAQ lift should pass template recommended keys',
);

const processOnly = `---
title: "Drywall Repair in Boise, ID"
description: "Drywall repair in Boise, ID. Free estimates."
h1: "Drywall Repair in Boise, ID"
sectionHeading: "Drywall repair for Boise homes"
process:
  - title: "Initial Inspection"
    description: "A technician examines the damaged area."
  - title: "Area Protection"
    description: "Furniture and flooring are covered."
---
Intro.

## Why Boise homeowners choose us over a handyman

We sample the texture first.
`;
const partialWarning = homepageDesignedSectionWarning(['whyChooseUs', 'faqs']);
const partialCheck = validateContentBundle(
  { 'src/content/pages/index.md': processOnly },
  { niche: 'Drywall Repair', primaryCity: 'Boise' },
  { mode: 'full' },
);
assert(partialCheck.warnings.includes(partialWarning), 'partial homepage names Why and FAQs only');
assert(
  !partialCheck.warnings.some((w) => /empty: .*Process/.test(w)),
  'partial homepage does not call Process empty',
);
const partialContract = runTemplateContract(
  { 'src/content/pages/index.md': processOnly },
  { niche: 'Drywall Repair', primaryCity: 'Boise', siteArchetype: 'multi_service' },
  { mode: 'full' },
);
assert(partialContract.warnings.includes(partialWarning), 'template contract names Why and FAQs only');
const stamped = stampHomepageLiftOnDraftOps(
  {
    check: {
      warnings: [
        'Homepage is missing Why, Process, or FAQs. Click Write anyway to accept the pages as they are. Write site does not rewrite a homepage that is already saved.',
      ],
    },
    contract: { warnings: [] },
  },
  { files: { 'src/content/pages/index.md': processOnly } },
);
assert(stamped.check.warnings.includes(partialWarning), 'stamp replaces the old sentence with the empty fields');
assert(
  !stamped.check.warnings.some((w) => /Write anyway/.test(w)),
  'old Write anyway sentence is removed',
);

const oneTight = `---
title: "Artificial Turf Installation in El Mirage, AZ"
description: "Artificial turf installation in El Mirage, AZ for small yards. Free estimates."
h1: "Artificial Turf Installation in El Mirage, AZ"
sectionHeading: "Turf in El Mirage"
process:
  - title: "Site evaluation"
    description: "A technician inspects the area and discusses goals before any work begins."
  - title: "Base compaction"
    description: "A layered aggregate base is compacted to create a stable foundation."
whyChooseUs:
  - title: "Written estimates"
    description: "Written estimates spell out base depth and turf product before work starts."
  - title: "Same crew"
    description: "The crew installs what it recommends, so the person on site did the estimate."
---
Intro stays.

## Turf FAQs

How long does artificial turf take?
Most backyard installs take 1 to 3 days.
`;
const oneLifted = liftHomepageDesignedSections(oneTight, { outline, config: tightConfig });
assert(!/^faqs:/m.test(oneLifted.body), 'a single tight FAQ pair stays out of frontmatter');

const whyParagraphs = `---
title: "Drywall Repair in Boise, ID"
description: "Drywall repair in Boise, ID. Free estimates."
h1: "Drywall Repair in Boise, ID"
sectionHeading: "Drywall repair for Boise homes"
---
Intro stays on the page.

## Why Boise homeowners choose us over a handyman

Boise Drywall Repair Pros samples the existing texture pattern before spraying anything new. Seams get properly embedded tape and multiple thin coats.

Every job gets a written estimate by size and scope before work starts. We tell you up front how many visits a job needs.

## What we fix

Patching and texture matching.
`;
const whyParaLifted = liftHomepageDesignedSections(whyParagraphs, {
  outline,
  config: { niche: 'Drywall Repair', primaryCity: 'Boise' },
});
assert(whyParaLifted.changed, 'Why paragraphs should lift');
assert(/^whyChooseUs:/m.test(whyParaLifted.body), 'Why paragraphs write whyChooseUs');
assert(
  (whyParaLifted.body.match(/- title:/g) || []).length >= 2,
  'Why paragraphs become two items',
);
assert(/samples the existing texture pattern/.test(whyParaLifted.body), 'first Why paragraph kept');
assert(/written estimate by size and scope/.test(whyParaLifted.body), 'second Why paragraph kept');
assert(!/## Why Boise homeowners/.test(whyParaLifted.body), 'Why heading leaves the body');
assert(/## What we fix/.test(whyParaLifted.body), 'following section kept after Why paragraph lift');

const questionFaqs = `---
title: "Drywall Repair in Boise, ID"
description: "Drywall repair in Boise, ID. Free estimates."
h1: "Drywall Repair in Boise, ID"
sectionHeading: "Drywall repair for Boise homes"
---
Intro stays.

## Drywall contractor Boise questions

How much does Drywall Repair cost in Boise?
Most patch jobs run $125–$900 depending on size and whether it's a wall or ceiling.

How long does Drywall Repair take?
A small patch can be done the same day. Larger jobs usually run 2–4 days.

## Get a free estimate

Call for a written number.
`;
const questionLifted = liftHomepageDesignedSections(questionFaqs, {
  outline,
  config: { niche: 'Drywall Repair', primaryCity: 'Boise' },
});
assert(questionLifted.changed, 'questions heading with pairs should lift');
assert(/^faqs:/m.test(questionLifted.body), 'questions heading writes faqs');
assert(/How much does Drywall Repair cost in Boise/.test(questionLifted.body), 'first question preserved');
assert(/How long does Drywall Repair take/.test(questionLifted.body), 'second question preserved');
assert(!/## Drywall contractor Boise questions/.test(questionLifted.body), 'questions heading leaves the body');
assert(/## Get a free estimate/.test(questionLifted.body), 'following section kept after questions lift');

const questionProse = `---
title: "Drywall Repair in Boise, ID"
description: "Drywall repair in Boise, ID. Free estimates."
h1: "Drywall Repair in Boise, ID"
sectionHeading: "Drywall repair for Boise homes"
---
Intro stays.

## Questions to ask before hiring

Ask about texture matching, drying time, and whether the crew will cover the floor. A written estimate should name the patch size before work starts.

## Get a free estimate

Call for a written number.
`;
const questionProseLifted = liftHomepageDesignedSections(questionProse, {
  outline,
  config: { niche: 'Drywall Repair', primaryCity: 'Boise' },
});
assert(!/^faqs:/m.test(questionProseLifted.body), 'prose questions heading stays out of faqs');
assert(
  /## Questions to ask before hiring/.test(questionProseLifted.body),
  'prose questions heading stays in the body',
);

console.log('test-homepage-section-lift: ok');
