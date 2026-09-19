import {
  clampEvalConcurrency,
  EVAL_CONCURRENCY_DEFAULT,
  EVAL_CONCURRENCY_MAX,
  getEvalConcurrency,
  setEvalConcurrency,
} from '../ops/lib/eval-concurrency.mjs';
import { startBatchJobs } from '../ops/lib/batch-jobs.mjs';
import { startJob } from '../ops/lib/run-script.mjs';

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

assertEqual(clampEvalConcurrency(0), 1, 'clamp 0');
assertEqual(clampEvalConcurrency(-3), 1, 'clamp negative');
assertEqual(clampEvalConcurrency(150), EVAL_CONCURRENCY_MAX, 'clamp 150');
assertEqual(clampEvalConcurrency('6'), 6, 'clamp 6');
assertEqual(clampEvalConcurrency('nope'), EVAL_CONCURRENCY_DEFAULT, 'clamp junk');
assertEqual(clampEvalConcurrency(null), EVAL_CONCURRENCY_DEFAULT, 'clamp null');

const prev = getEvalConcurrency();
setEvalConcurrency(6);
assertEqual(getEvalConcurrency(), 6, 'stored 6');

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

let hangJob = null;
try {
  hangJob = startJob({
    candidateId: '__eval-conc-test__',
    label: 'research',
    script: 'scripts/test-eval-hang.mjs',
  });
  try {
    startJob({
      candidateId: '__eval-conc-test__',
      label: 'research',
      script: 'scripts/test-eval-hang.mjs',
    });
    console.error('expected EVAL_JOB_RUNNING');
    process.exit(1);
  } catch (error) {
    assertEqual(error.code, 'EVAL_JOB_RUNNING', 'same candidate lock');
  }
} finally {
  if (hangJob?.pid) {
    try {
      process.kill(hangJob.pid);
    } catch {
      /* already gone */
    }
  }
  setEvalConcurrency(prev);
}

console.log('test-eval-concurrency: ok');
