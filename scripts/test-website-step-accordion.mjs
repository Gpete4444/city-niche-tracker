/**
 * Website accordion: only one step open; Prepare aliases map to prepare.
 * Run: node scripts/test-website-step-accordion.mjs
 */
import {
  WEBSITE_ACCORDION_STEP_IDS,
  contentStepIsOpen,
  contentStepShowsFreeze,
  exclusiveOpenStepIds,
  nextAccordionOpenId,
  normalizeWebsiteOpenId,
} from '../ops/public/website-step-accordion.mjs';

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

assertEqual(normalizeWebsiteOpenId('stage'), 'prepare', 'stage aliases to prepare');
assertEqual(normalizeWebsiteOpenId('assemble'), 'prepare', 'assemble aliases to prepare');
assert(contentStepIsOpen('prepare', 'stage'), 'prepare is open for stage');
assert(contentStepIsOpen('prepare', 'assemble'), 'prepare is open for assemble');
assert(!contentStepIsOpen('images', 'prepare'), 'images closed when prepare is open');
assert(!contentStepIsOpen('images', 'stage'), 'images closed when stage is open');

const whenPrepare = exclusiveOpenStepIds(WEBSITE_ACCORDION_STEP_IDS, 'prepare');
assertEqual(whenPrepare, ['prepare'], 'only prepare open');
assert(!whenPrepare.includes('images'), 'prepare open => images not open');

const whenImages = exclusiveOpenStepIds(WEBSITE_ACCORDION_STEP_IDS, 'images');
assertEqual(whenImages, ['images'], 'only images open');
assert(!whenImages.includes('prepare'), 'images open => prepare not open');

assert(contentStepShowsFreeze('images', 'images'), 'freeze chrome while images open');
assert(!contentStepShowsFreeze('images', 'prepare'), 'no freeze chrome when prepare is open');
assert(!contentStepShowsFreeze('prepare', 'prepare'), 'prepare has no freeze chrome');

assertEqual(nextAccordionOpenId('images', 'prepare'), 'prepare', 'click prepare closes images');
assertEqual(nextAccordionOpenId('prepare', 'images'), 'images', 'click images closes prepare');
assertEqual(nextAccordionOpenId('images', 'images'), null, 'click same step collapses');
assertEqual(nextAccordionOpenId('stage', 'prepare'), null, 'click prepare while stage collapses');

const afterPrepareClick = exclusiveOpenStepIds(
  WEBSITE_ACCORDION_STEP_IDS,
  nextAccordionOpenId('images', 'prepare'),
);
assertEqual(afterPrepareClick, ['prepare'], 'after clicking prepare, only prepare is open');

console.log('test-website-step-accordion: ok');
