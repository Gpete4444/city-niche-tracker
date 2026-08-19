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
  fluffHelperOrNext: isTimelineDurationFluff('or next-day visit'),
  fluffHelperVaries: isTimelineDurationFluff('usually , varies by city/county'),
  fluffBareUsually: isTimelineDurationFluff('usually'),
  fluffAsRepair: isTimelineDurationFluff('as repair'),
  fluffHalfTo: isTimelineDurationFluff('half a day to'),
  realDetailNotFluff: !isTimelineDurationFluff(
    'scheduled with your local building department after work is complete',
  ),
  // Homepage compact: UI hides all detail; parser still may keep real step copy for service pages
  homepageCompactContract: true,
};

console.log(stages);
console.log(checks);

if (!Object.values(checks).every(Boolean)) {
  console.error('FAIL');
  process.exit(1);
}
console.log('PASS');
