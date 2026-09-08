import {
  clampConcurrencyKey,
  CONCURRENCY_DEFAULTS,
  CONCURRENCY_MAX,
  getConcurrency,
  setConcurrencySettings,
} from '../ops/lib/rover-concurrency.mjs';
import { startBatchJobs } from '../ops/lib/batch-jobs.mjs';
import {
  assertAcceptStartAllowed,
  assertGeneratePackStartAllowed,
  assertWriteSiteStartAllowed,
  countActiveLightJobs,
  countQueuedLightJobs,
  countRunningLightJobs,
  enqueueLightJob,
  openLightJob,
  resetLightJobsForTests,
} from '../ops/lib/rover-light-jobs.mjs';
import {
  forceRunningCountForTests,
  resetHeavyJobsForTests,
  startHeavyJob,
} from '../ops/lib/rover-heavy-jobs.mjs';
import {
  assertLightSerpStartAllowed,
  putRunningSerpProbeForTests,
  resetSerpProbesForTests,
} from '../ops/lib/discovery-serp-probe.mjs';

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

function assertThrows(fn, code, label) {
  try {
    fn();
    console.error(`${label}: expected throw ${code}`);
    process.exit(1);
  } catch (error) {
    if (error.code !== code) {
      console.error(`${label}: got code ${error.code}, want ${code} (${error.message})`);
      process.exit(1);
    }
  }
}

assertEqual(clampConcurrencyKey('openaiPhotos', 80), CONCURRENCY_MAX.openaiPhotos, 'photos 80→50');
assertEqual(clampConcurrencyKey('openaiBeforeAfter', 80), CONCURRENCY_MAX.openaiBeforeAfter, 'BA 80→20');
assertEqual(clampConcurrencyKey('heavy', 80), CONCURRENCY_MAX.heavy, 'heavy 80→12');
assertEqual(clampConcurrencyKey('evaluations', 80), CONCURRENCY_MAX.evaluations, 'eval 80→50');
assertEqual(clampConcurrencyKey('lightSerp', 0), 1, 'light serp 0→1');
assertEqual(clampConcurrencyKey('writeSite', 'nope'), CONCURRENCY_DEFAULTS.writeSite, 'write site junk');
assertEqual(clampConcurrencyKey('generatePack', 80), CONCURRENCY_MAX.generatePack, 'pack 80→10');
assertEqual(clampConcurrencyKey('assembledPreviews', 80), CONCURRENCY_MAX.assembledPreviews, 'previews 80→8');
assertEqual(CONCURRENCY_DEFAULTS.lightSerp, 5, 'default light serp 5');
assertEqual(CONCURRENCY_DEFAULTS.generatePack, 5, 'default generate pack 5');
assertEqual(CONCURRENCY_DEFAULTS.heavy, 5, 'default heavy 5');
assertEqual(CONCURRENCY_DEFAULTS.assembledPreviews, 5, 'default previews 5');

const prev = getConcurrency();

try {
  setConcurrencySettings({
    lightSerp: 2,
    evaluations: 6,
    writeSite: 2,
    openaiPhotos: 5,
    openaiBeforeAfter: 2,
    heavy: 2,
  });

  try {
    startBatchJobs({
      act: 'research',
      candidateIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      requireWithinLimit: true,
    });
    console.error('expected EVAL_CONCURRENCY for 7 ids');
    process.exit(1);
  } catch (error) {
    assertEqual(error.code, 'EVAL_CONCURRENCY', '7 vs 6 code');
    assertEqual(error.limit, 6, '7 vs 6 limit');
    assertEqual(error.selected, 7, '7 vs 6 selected');
  }

  resetLightJobsForTests();
  openLightJob({
    candidateId: 'ws-a',
    phase: 'write-site',
    label: 'Write site',
  });
  openLightJob({
    candidateId: 'ws-b',
    phase: 'write-site',
    label: 'Write site',
  });
  assertEqual(countActiveLightJobs('write-site'), 2, 'write site at 2');
  assertThrows(() => assertWriteSiteStartAllowed('ws-c'), 'WRITE_SITE_CAP', 'write site extra start');
  resetLightJobsForTests();

  openLightJob({
    candidateId: 'accept-a',
    phase: 'accept',
    label: 'Accept',
  });
  assertAcceptStartAllowed('accept-b');
  assertThrows(() => assertAcceptStartAllowed('accept-a'), 'ACCEPT_RUNNING', 'accept same candidate');
  resetLightJobsForTests();

  const hold = () => new Promise(() => {});
  enqueueLightJob({
    candidateId: 'oa-1',
    phase: 'openai-photo',
    label: 'OpenAI',
    slotKey: 'a',
    matchKey: 'a',
    run: hold,
  });
  enqueueLightJob({
    candidateId: 'oa-2',
    phase: 'openai-photo',
    label: 'OpenAI',
    slotKey: 'b',
    matchKey: 'b',
    run: hold,
  });
  enqueueLightJob({
    candidateId: 'oa-3',
    phase: 'openai-photo',
    label: 'OpenAI',
    slotKey: 'c',
    matchKey: 'c',
    run: hold,
  });
  enqueueLightJob({
    candidateId: 'oa-4',
    phase: 'openai-photo',
    label: 'OpenAI',
    slotKey: 'd',
    matchKey: 'd',
    run: hold,
  });
  enqueueLightJob({
    candidateId: 'oa-5',
    phase: 'openai-photo',
    label: 'OpenAI',
    slotKey: 'e',
    matchKey: 'e',
    run: hold,
  });
  enqueueLightJob({
    candidateId: 'oa-6',
    phase: 'openai-photo',
    label: 'OpenAI',
    slotKey: 'f',
    matchKey: 'f',
    run: hold,
  });
  assertEqual(countRunningLightJobs('openai-photo'), 5, 'openai photos running cap');
  assertEqual(countQueuedLightJobs('openai-photo'), 1, 'openai photos queued extra');
  resetLightJobsForTests();
  setConcurrencySettings({ generatePack: 1 });
  openLightJob({
    candidateId: 'discovery:batch-a',
    batchId: 'batch-a',
    phase: 'generate-pack',
    label: 'Generate pack',
  });
  assertThrows(() => assertGeneratePackStartAllowed('batch-b'), 'GENERATE_PACK_BUSY', 'pack extra start');
  assertThrows(() => assertGeneratePackStartAllowed('batch-a'), 'GENERATE_PACK_RUNNING', 'pack same batch');
  resetLightJobsForTests();
  forceRunningCountForTests(2);
  assertThrows(
    () =>
      startHeavyJob({
        candidateId: 'hv-c',
        phase: 'prepare',
        label: 'Prepare preview',
        run: async () => ({}),
      }),
    'HEAVY_CONCURRENCY',
    'heavy extra start',
  );
  resetHeavyJobsForTests();

  resetSerpProbesForTests();
  putRunningSerpProbeForTests();
  putRunningSerpProbeForTests();
  assertThrows(() => assertLightSerpStartAllowed(), 'LIGHT_SERP_CONCURRENCY', 'light serp extra run');
  resetSerpProbesForTests();
} finally {
  resetLightJobsForTests();
  resetHeavyJobsForTests();
  resetSerpProbesForTests();
  setConcurrencySettings(prev);
}

console.log('test-concurrency-settings: ok');
