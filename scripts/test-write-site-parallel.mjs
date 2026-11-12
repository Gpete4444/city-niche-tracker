import {
  WRITE_SITE_MAX_CONCURRENT,
  assertWriteSiteStartAllowed,
  countActiveLightJobs,
  resetLightJobsForTests,
  startLightJob,
} from '../ops/lib/rover-light-jobs.mjs';
import { getConcurrency, setConcurrencySettings } from '../ops/lib/rover-concurrency.mjs';
import {
  anthropicRetryDelayMs,
  claudeMessages,
  isAnthropicRetryableStatus,
  isTransientFetchError,
} from '../ops/lib/claude.mjs';

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

function hangUntilAbort({ signal }) {
  return new Promise((_resolve, reject) => {
    const fail = () =>
      reject(Object.assign(new Error('Stopped'), { status: 499, cancelled: true }));
    if (signal?.aborted) {
      fail();
      return;
    }
    signal?.addEventListener('abort', fail, { once: true });
  });
}

function startHang(candidateId) {
  return startLightJob({
    candidateId,
    phase: 'write-site',
    label: 'Write site',
    progressTotal: 4,
    run: hangUntilAbort,
  });
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

resetLightJobsForTests();

const prevWriteSite = getConcurrency().writeSite;
setConcurrencySettings({ writeSite: WRITE_SITE_MAX_CONCURRENT });

assertWriteSiteStartAllowed('cand-a');
startHang('cand-a');
assertEqual(countActiveLightJobs('write-site'), 1, 'one running');

assertWriteSiteStartAllowed('cand-b');
startHang('cand-b');
assertEqual(countActiveLightJobs('write-site'), 2, 'two different candidates');

assertThrows(
  () => assertWriteSiteStartAllowed('cand-a'),
  'WRITE_SITE_RUNNING',
  'same candidate blocked',
);

for (let i = 3; i <= WRITE_SITE_MAX_CONCURRENT; i += 1) {
  const id = `cand-${i}`;
  assertWriteSiteStartAllowed(id);
  startHang(id);
}
assertEqual(countActiveLightJobs('write-site'), WRITE_SITE_MAX_CONCURRENT, 'cap full');
assertThrows(
  () => assertWriteSiteStartAllowed('cand-overflow'),
  'WRITE_SITE_CAP',
  'seventh blocked',
);

resetLightJobsForTests();
assertEqual(countActiveLightJobs('write-site'), 0, 'reset clears');
assertWriteSiteStartAllowed('cand-a');

assertEqual(isAnthropicRetryableStatus(429), true, '429 retryable');
assertEqual(isAnthropicRetryableStatus(529), true, '529 retryable');
for (const status of [500, 502, 503, 504, 520]) {
  assertEqual(isAnthropicRetryableStatus(status), true, `${status} retryable`);
}
assertEqual(isAnthropicRetryableStatus(400), false, '400 not retryable');
assertEqual(anthropicRetryDelayMs(0, null), 2000, 'backoff 0');
assertEqual(anthropicRetryDelayMs(1, null), 4000, 'backoff 1');
assertEqual(anthropicRetryDelayMs(0, '5'), 5000, 'Retry-After seconds');
assertEqual(anthropicRetryDelayMs(0, '120'), 60_000, 'Retry-After cap');

const prevKey = process.env.ANTHROPIC_API_KEY;
process.env.ANTHROPIC_API_KEY = 'test-key-not-live';
let fetches = 0;
const result = await claudeMessages({
  user: '{"ping":true}',
  fetch: async () => {
    fetches += 1;
    if (fetches < 3) {
      return {
        ok: false,
        status: 429,
        headers: { get: () => '0' },
        json: async () => ({ error: { message: 'rate limited' } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    };
  },
  retrySleep: async () => {},
});
assertEqual(fetches, 3, 'retried 429 twice then succeeded');
assertEqual(result.parsed?.ok, true, 'parsed after retry');

let drops = 0;
const after520 = await claudeMessages({
  user: '{"ping":true}',
  fetch: async () => {
    drops += 1;
    if (drops === 1) {
      return {
        ok: false,
        status: 520,
        headers: { get: () => null },
        json: async () => ({}),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    };
  },
  retrySleep: async () => {},
});
assertEqual(drops, 2, '520 succeeds on the next response');
assertEqual(after520.parsed?.ok, true, 'parsed after a 520');

let empty520 = 0;
let empty520Message = '';
try {
  await claudeMessages({
    user: '{"ping":true}',
    fetch: async () => {
      empty520 += 1;
      return {
        ok: false,
        status: 520,
        headers: { get: () => null },
        json: async () => ({}),
      };
    },
    retrySleep: async () => {},
  });
} catch (error) {
  empty520Message = error.message;
}
assertEqual(empty520, 6, 'empty 520 uses the six attempts');
assertEqual(
  empty520Message,
  "Anthropic's connection dropped. Try this step again.",
  'empty 520 says the connection dropped',
);

assertEqual(isTransientFetchError(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })), true, 'fetch failed is transient');
assertEqual(isTransientFetchError(Object.assign(new Error('Stopped'), { cancelled: true })), false, 'Stop is not a fetch retry');
let fetchDrops = 0;
const afterDrop = await claudeMessages({
  user: '{"ping":true}',
  fetch: async () => {
    fetchDrops += 1;
    if (fetchDrops < 3) throw new TypeError('fetch failed');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    };
  },
  retrySleep: async () => {},
});
assertEqual(fetchDrops, 3, 'retried a dropped connection twice then succeeded');
assertEqual(afterDrop.parsed?.ok, true, 'parsed after a dropped connection');

if (prevKey == null) delete process.env.ANTHROPIC_API_KEY;
else process.env.ANTHROPIC_API_KEY = prevKey;

resetLightJobsForTests();
setConcurrencySettings({ writeSite: prevWriteSite });

console.log('test-write-site-parallel: ok');
