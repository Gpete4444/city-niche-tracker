/**
 * A bad Claude reply is asked again, and Write site continues once.
 * Stop and setup errors still stop. Accept rewrites a thin draft once more.
 * Run: node scripts/test-write-site-resume.mjs
 */
import {
  EMPTY_REPLY_RETRIES,
  acceptAfterGapRewrite,
  callUntilFileBlocks,
  callUntilJson,
  continueWriteSiteOnce,
  isAcceptGapError,
  isResumeableWriteError,
  rewriteLaunchContentGaps,
} from '../ops/lib/content-write-site.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

assert(EMPTY_REPLY_RETRIES === 2, 'an empty reply gets two more tries');

const fileError = new Error('Full write (services): Claude did not return FILE blocks');
const jsonError = new Error('Site research: Claude did not return JSON');
const retryError = new Error('Write batches still incomplete after continue — retry Write site');
const dropped = new Error("Anthropic's connection dropped. Try this step again.");
const stop = Object.assign(new Error('Stopped'), { status: 499, cancelled: true });
const setup = Object.assign(new Error('Accept Site config first'), { status: 400 });
const structure = Object.assign(new Error('Finish Structure (Continue) before Write site with Claude'), {
  status: 400,
});
assert(isResumeableWriteError(fileError), 'a missing FILE block can continue');
assert(isResumeableWriteError(jsonError), 'missing JSON can continue');
assert(isResumeableWriteError(retryError), 'a retry-write-site error can continue');
assert(isResumeableWriteError(dropped), 'a dropped Anthropic connection can continue');
assert(!isResumeableWriteError(stop), 'Stop does not continue');
assert(!isResumeableWriteError(setup), 'a missing site config does not continue');
assert(!isResumeableWriteError(structure), 'unfinished Structure does not continue');

const ticks = [];
let fileCalls = 0;
const fileReply = await callUntilFileBlocks({
  tick: (detail) => ticks.push(detail),
  failMessage: 'Full write (services): Claude did not return FILE blocks',
  call: async () => {
    fileCalls += 1;
    if (fileCalls === 1) return { text: 'not a file block' };
    return { text: '### FILE: src/content/services/pool-surround-turf.md\n---\ntitle: Pool\n---\n\nBody.\n' };
  },
});
assert(fileCalls === 2, 'a missing FILE block is asked again');
assert(ticks.includes('Continuing…'), 'the retry says Continuing');
assert(fileReply.text.includes('### FILE:'), 'the second FILE reply is kept');

let fileFails = 0;
let fileThrew = '';
try {
  await callUntilFileBlocks({
    failMessage: 'Continue write: Claude did not return FILE blocks',
    call: async () => {
      fileFails += 1;
      return { text: 'still no file' };
    },
  });
} catch (error) {
  fileThrew = error.message;
}
assert(fileFails === 1 + EMPTY_REPLY_RETRIES, 'FILE retries stop after two extra tries');
assert(fileThrew.includes('did not return FILE blocks'), 'the FILE error remains after the retries');

let jsonCalls = 0;
const jsonTicks = [];
const jsonReply = await callUntilJson({
  phase: 'Site research',
  tick: (detail) => jsonTicks.push(detail),
  call: async () => {
    jsonCalls += 1;
    if (jsonCalls === 1) return { parsed: { ok: false }, truncated: false, text: 'nope' };
    return { parsed: { ok: true, value: { ok: true } }, truncated: false, text: '{"ok":true}' };
  },
});
assert(jsonCalls === 2, 'missing JSON is asked again');
assert(jsonTicks.includes('Continuing…'), 'the JSON retry says Continuing');
assert(jsonReply.parsed.ok, 'the second JSON reply is kept');

let cutOffCalls = 0;
let cutOffMessage = '';
try {
  await callUntilJson({
    phase: 'Outline',
    missing: 'Outline: Claude did not return sections[] JSON',
    call: async () => {
      cutOffCalls += 1;
      return { parsed: { ok: false }, truncated: true, text: '{' };
    },
  });
} catch (error) {
  cutOffMessage = error.message;
}
assert(cutOffCalls === 1, 'a cut-off JSON reply is not asked again inside the call');
assert(/output limit/i.test(cutOffMessage), 'a cut-off JSON reply keeps the output-limit error');

let passes = 0;
const continued = [];
const resumed = await continueWriteSiteOnce(
  async () => {
    passes += 1;
    if (passes === 1) throw fileError;
    return { ok: true };
  },
  { onContinue: () => continued.push('Continuing…') },
);
assert(passes === 2, 'a resumeable failure runs the pipeline once more');
assert(continued.includes('Continuing…'), 'the pipeline resume says Continuing');
assert(resumed.ok, 'the second pipeline pass can finish');

let stopPasses = 0;
let stopMessage = '';
try {
  await continueWriteSiteOnce(async () => {
    stopPasses += 1;
    throw stop;
  });
} catch (error) {
  stopMessage = error.message;
}
assert(stopPasses === 1, 'Stop does not start another pass');
assert(stopMessage === 'Stopped', 'Stop is the error the user sees');

let setupPasses = 0;
let setupMessage = '';
try {
  await continueWriteSiteOnce(async () => {
    setupPasses += 1;
    throw setup;
  });
} catch (error) {
  setupMessage = error.message;
}
assert(setupPasses === 1, 'a missing site config does not start another pass');
assert(setupMessage === 'Accept Site config first', 'the setup error remains');

let stillFailing = 0;
let secondMessage = '';
try {
  await continueWriteSiteOnce(async () => {
    stillFailing += 1;
    throw fileError;
  });
} catch (error) {
  secondMessage = error.message;
}
assert(stillFailing === 2, 'the pipeline is tried only once more');
assert(secondMessage === fileError.message, 'the second failure is the error that remains');

const gap = Object.assign(
  new Error('catalina: Accept incomplete for launch preview — missing 1: src/content/services/pool-surround-turf.md'),
  { status: 400, check: { missing: ['src/content/services/pool-surround-turf.md'], stubs: [] } },
);
const warnings = new Error('Content warnings: homepage is thin. Pass ignoreWarnings to proceed.');
assert(isAcceptGapError(gap), 'a thin or missing page is an Accept gap');
assert(!isAcceptGapError(warnings), 'content warnings are not an Accept gap');
assert(
  !isAcceptGapError(new Error('Set State on Site-config, then Accept.')),
  'a missing State is not an Accept gap',
);

let gaps = ['src/content/services/pool-surround-turf.md'];
let rewriteCalls = 0;
const rewriteTicks = [];
const rewritten = await rewriteLaunchContentGaps('test-candidate', {
  hasKey: true,
  loadGaps: async () => ({ paths: [...gaps] }),
  buildPrompt: async () => ({ prompt: 'rewrite' }),
  callClaudeFn: async () => {
    rewriteCalls += 1;
    if (rewriteCalls === 1) return { text: 'no file yet' };
    return { text: '### FILE: src/content/services/pool-surround-turf.md\n---\ntitle: Pool\n---\n\nBody.\n' };
  },
  pasteFn: async () => {
    gaps = [];
  },
  syncFn: async () => {},
  tick: (detail) => rewriteTicks.push(detail),
});
assert(rewriteCalls === 2, 'an Accept rewrite without FILE blocks is asked again');
assert(rewriteTicks.includes('Continuing…'), 'the Accept rewrite says Continuing');
assert(rewritten.reason === 'clear', 'the retried Accept rewrite clears the gap');

let rewrites = 0;
let accepts = 0;
const published = await acceptAfterGapRewrite({
  onContinue: () => {},
  rewrite: async () => {
    rewrites += 1;
  },
  accept: async () => {
    accepts += 1;
    if (accepts === 1) throw gap;
    return { ok: true };
  },
});
assert(rewrites === 2, 'a still-incomplete draft is rewritten once more');
assert(accepts === 2, 'Accept tries the publish again after that rewrite');
assert(published.ok, 'the second publish can succeed');

let warningRewrites = 0;
let warningMessage = '';
try {
  await acceptAfterGapRewrite({
    rewrite: async () => {
      warningRewrites += 1;
    },
    accept: async () => {
      throw warnings;
    },
  });
} catch (error) {
  warningMessage = error.message;
}
assert(warningRewrites === 1, 'content warnings do not start another rewrite');
assert(/Content warnings/.test(warningMessage), 'the warning stays for the user');

let stuckRewrites = 0;
let stuckMessage = '';
try {
  await acceptAfterGapRewrite({
    rewrite: async () => {
      stuckRewrites += 1;
    },
    accept: async () => {
      throw gap;
    },
  });
} catch (error) {
  stuckMessage = error.message;
}
assert(stuckRewrites === 2, 'one extra rewrite is the limit');
assert(/incomplete for launch/.test(stuckMessage), 'the incomplete error remains after the extra rewrite');

console.log('test-write-site-resume: ok');
