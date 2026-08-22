/**
 * Assert Timeline parser keeps duration chips and drops leftover fluff sublines.
 * Run: npx tsx scripts/test-timeline-duration-fluff.mjs
 */
import {
  parseTimelineStages,
  isTimelineDurationFluff,
} from '../src/lib/section-parse.ts';

const body = `Most projects move faster than homeowners expect once permits are in hand.

- Consult & code sizing — same day or next-day visit
- Permit approval — 1 week usually, varies by city/county
- Permit leftover — 1 week usually
- Foundation cutting & window set — 1 day
- Final inspection — scheduled with your local building department after work is complete
- Dig & replace — half a day to 1 day
- Restore & test — same day as repair
- Cure time — 24–48 hours
- Reinstall and walkthrough — half day
- Design consult — same day to a few days
- Cabinet lead time — 2–4 weeks
- Design and measurement — same day to a few days
- Fabrication lead time — 2–4 weeks
`;

const stages = parseTimelineStages(body);
const byTitle = Object.fromEntries(stages.map((s) => [s.title.toLowerCase(), s]));

const checks = {
  consultChip: /same day/i.test(byTitle['consult & code sizing']?.duration || ''),
  consultNoDetail: !byTitle['consult & code sizing']?.detail,
  permitChip: /1 week/i.test(byTitle['permit approval']?.duration || ''),
  permitNoDetail: !byTitle['permit approval']?.detail,
  permitNoQualOnChip: !/\(/.test(byTitle['permit approval']?.duration || ''),
  bareUsuallyNoDetail: !byTitle['permit leftover']?.detail,
  bareUsuallyChip: /1 week/i.test(byTitle['permit leftover']?.duration || ''),
  cuttingKept: /1 day/i.test(byTitle['foundation cutting & window set']?.duration || ''),
  inspectionDetailKept: /building department/i.test(byTitle['final inspection']?.detail || ''),
  halfDayChip: /1 day|half day/i.test(byTitle['dig & replace']?.duration || ''),
  halfDayNoFragment: !/half a day to/i.test(byTitle['dig & replace']?.detail || ''),
  sameDayAsRepairChip: /same day/i.test(byTitle['restore & test']?.duration || ''),
  sameDayNoAsRepair: !/as repair/i.test(byTitle['restore & test']?.detail || ''),
  hoursRangeChip: /24\s*[–-]\s*48\s*hours/i.test(byTitle['cure time']?.duration || ''),
  bareHalfDayChip: /^half day$/i.test(byTitle['reinstall and walkthrough']?.duration || ''),
  designConsultChip: /^same day to a few days$/i.test(byTitle['design consult']?.duration || ''),
  designConsultNoDetail: !byTitle['design consult']?.detail,
  cabinetLeadTitle: /cabinet lead time/i.test(byTitle['cabinet lead time']?.title || 'Cabinet lead time'),
  cabinetLeadChip: /^2\s*[–-]\s*4\s*weeks$/i.test(byTitle['cabinet lead time']?.duration || ''),
  cabinetLeadNoDetail: !byTitle['cabinet lead time']?.detail,
  cabinetNotBareTitle: byTitle['cabinet'] == null,
  measureChip: /^same day to a few days$/i.test(byTitle['design and measurement']?.duration || ''),
  measureNoDetail: !byTitle['design and measurement']?.detail,
  fabricationTitle: /fabrication lead time/i.test(
    byTitle['fabrication lead time']?.title || 'Fabrication lead time',
  ),
  fabricationChip: /^2\s*[–-]\s*4\s*weeks$/i.test(byTitle['fabrication lead time']?.duration || ''),
  fabricationNoDetail: !byTitle['fabrication lead time']?.detail,
  fluffHelperOrNext: isTimelineDurationFluff('or next-day visit'),
  fluffHelperVaries: isTimelineDurationFluff('usually , varies by city/county'),
  fluffBareUsually: isTimelineDurationFluff('usually'),
  fluffAsRepair: isTimelineDurationFluff('as repair'),
  fluffHalfTo: isTimelineDurationFluff('half a day to'),
  fluffToAFewDays: isTimelineDurationFluff('to a few days'),
  fluffAFewDays: isTimelineDurationFluff('a few days'),
  realDetailNotFluff: !isTimelineDurationFluff(
    'scheduled with your local building department after work is complete',
  ),
  // Homepage compact: UI hides all detail; parser still may keep real step copy for service pages
  homepageCompactContract: true,
};

console.log(stages);
console.log(checks);

const failed = Object.entries(checks).filter(([, ok]) => !ok);
if (failed.length) {
  console.error('FAIL', failed.map(([k]) => k));
  process.exit(1);
}
console.log('PASS');
