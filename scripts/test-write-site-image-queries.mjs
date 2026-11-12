/**
 * Write site Image queries: continue a cut-off stock reply, and split a
 * before/after pair that stays cut off into one key at a time.
 * Run: node scripts/test-write-site-image-queries.mjs
 */
import { parseJsonLoose } from '../ops/lib/claude.mjs';
import {
  IMAGE_QUERY_BA_CHUNK,
  IMAGE_QUERY_JSON_RETRIES,
  IMAGE_QUERY_SLOT_CHUNK,
  fetchImageQueryGroup,
  runImageQueryGroups,
} from '../ops/lib/content-write-site.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

assert(IMAGE_QUERY_SLOT_CHUNK === 16, 'stock slots are groups of 16');
assert(IMAGE_QUERY_BA_CHUNK === 2, 'before/after stays pairs');
assert(IMAGE_QUERY_JSON_RETRIES === 2, 'a non-JSON image-query group is retried twice');

const stock = {
  slots: {
    'hero-1': { query: 'drywall repair wall' },
    'hero-2': { query: 'drywall texture match' },
  },
};
const stockText = JSON.stringify(stock);
const stockMid = Math.floor(stockText.length / 2);
let stockCalls = 0;
const stockSaved = [];
await runImageQueryGroups({
  keys: ['hero-1', 'hero-2'],
  chunkSize: IMAGE_QUERY_SLOT_CHUNK,
  kind: 'stock',
  buildPrompt: async (chunk) => `slots:${chunk.join(',')}`,
  callClaudeFn: async () => {
    stockCalls += 1;
    if (stockCalls === 1) return { text: stockText.slice(0, stockMid), truncated: true };
    return { text: stockText.slice(stockMid), truncated: false };
  },
  save: (value) => stockSaved.push(value),
  stillMissing: () => (stockSaved.length ? [] : ['hero-1', 'hero-2']),
});
assert(stockCalls === 2, 'cut-off stock JSON continues once');
assert(stockSaved.length === 1, 'continued stock JSON is saved once');
assert(stockSaved[0].slots['hero-1'].query === 'drywall repair wall', 'hero-1 query kept');
assert(stockSaved[0].slots['hero-2'].query === 'drywall texture match', 'hero-2 query kept');
const glued = parseJsonLoose(`${stockText.slice(0, stockMid)}${stockText.slice(stockMid)}`);
assert(glued.ok === true, 'stock halves parse when joined');

const baKeys = ['home:1', 'svc:hole'];
const baPrompts = [];
const baSaved = new Set();
await runImageQueryGroups({
  keys: baKeys,
  chunkSize: IMAGE_QUERY_BA_CHUNK,
  kind: 'beforeAfter',
  buildPrompt: async (chunk) => chunk.join(','),
  callClaudeFn: async ({ user, messages }) => {
    if (messages) return { text: '', truncated: true };
    baPrompts.push(String(user));
    const keys = String(user).split(',');
    if (keys.length > 1) return { text: '{"beforeAfter":', truncated: true };
    const key = keys[0];
    return {
      text: JSON.stringify({ beforeAfter: { [key]: { room: key } } }),
      truncated: false,
    };
  },
  save: (value) => {
    for (const key of Object.keys(value.beforeAfter || {})) baSaved.add(key);
  },
  stillMissing: () => baKeys.filter((key) => !baSaved.has(key)),
});
assert(baPrompts[0] === 'home:1,svc:hole', 'pair is asked first');
assert(baPrompts.includes('home:1') && baPrompts.includes('svc:hole'), 'pair splits into one key at a time');
assert(baSaved.has('home:1') && baSaved.has('svc:hole'), 'both before/after keys saved');

let singleFailed = false;
try {
  await fetchImageQueryGroup({
    prompt: 'only',
    callClaudeFn: async () => ({ text: '{"beforeAfter":', truncated: true }),
  });
  await runImageQueryGroups({
    keys: ['only'],
    chunkSize: IMAGE_QUERY_BA_CHUNK,
    kind: 'beforeAfter',
    buildPrompt: async () => 'only',
    callClaudeFn: async () => ({ text: '{"beforeAfter":', truncated: true }),
    save: () => {},
    stillMissing: () => ['only'],
  });
} catch (error) {
  singleFailed = /output limit before finishing JSON/.test(error.message);
}
assert(singleFailed, 'one key that stays cut off keeps the output-limit error');

const emptyTicks = [];
let emptyCalls = 0;
const emptySaved = [];
await runImageQueryGroups({
  keys: ['hero-1'],
  chunkSize: IMAGE_QUERY_SLOT_CHUNK,
  kind: 'stock',
  tick: (detail) => emptyTicks.push(detail),
  buildPrompt: async () => 'hero',
  callClaudeFn: async () => {
    emptyCalls += 1;
    if (emptyCalls === 1) return { text: '', truncated: false };
    return {
      text: JSON.stringify({ slots: { 'hero-1': { query: 'turf lawn' } } }),
      truncated: false,
    };
  },
  save: (value) => emptySaved.push(value),
  stillMissing: () => (emptySaved.length ? [] : ['hero-1']),
});
assert(emptyCalls === 2, 'empty image-query reply is retried');
assert(emptyTicks.includes('Image queries — retry'), 'retry progress shown');
assert(emptySaved.length === 1, 'retried image-query JSON is saved');
assert(emptySaved[0].slots['hero-1'].query === 'turf lawn', 'retried query kept');

let badCalls = 0;
let badFailed = false;
try {
  await runImageQueryGroups({
    keys: ['hero-1'],
    chunkSize: IMAGE_QUERY_SLOT_CHUNK,
    kind: 'stock',
    buildPrompt: async () => 'hero',
    callClaudeFn: async () => {
      badCalls += 1;
      return { text: 'not json', truncated: false };
    },
    save: () => {
      throw new Error('non-JSON reply must not be saved');
    },
    stillMissing: () => ['hero-1'],
  });
} catch (error) {
  badFailed = error.message === 'Image queries: Claude did not return JSON';
}
assert(badFailed, 'non-JSON image queries still fail after the retries');
assert(badCalls === 1 + IMAGE_QUERY_JSON_RETRIES, 'non-JSON group gets two extra tries');

const fullBa = {
  room: 'pool deck',
  inside: { before: 'dirt before', after: 'turf after' },
  outside: { before: 'wide dirt', after: 'wide turf' },
};
function baSave(saved, value) {
  const entries = value?.beforeAfter || {};
  const missing = Object.entries(entries)
    .filter(([, entry]) => {
      const side = (name) => entry?.[name]?.before && entry?.[name]?.after;
      return !(side('inside') && side('outside'));
    })
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(
      `Image queries JSON needs beforeAfter prompts for: ${missing.join(', ')} (inside and outside, before and after).`,
    );
  }
  for (const key of Object.keys(entries)) saved.add(key);
}

const retrySaved = new Set();
const retryTicks = [];
let retryCalls = 0;
await runImageQueryGroups({
  keys: ['svc:pool-surround-turf'],
  chunkSize: IMAGE_QUERY_BA_CHUNK,
  kind: 'beforeAfter',
  tick: (detail) => retryTicks.push(detail),
  buildPrompt: async (chunk) => chunk.join(','),
  callClaudeFn: async () => {
    retryCalls += 1;
    const entry = retryCalls === 1 ? { inside: { before: 'only one line' } } : fullBa;
    return {
      text: JSON.stringify({ beforeAfter: { 'svc:pool-surround-turf': entry } }),
      truncated: false,
    };
  },
  save: (value) => baSave(retrySaved, value),
  stillMissing: () => (retrySaved.has('svc:pool-surround-turf') ? [] : ['svc:pool-surround-turf']),
});
assert(retryCalls === 2, 'incomplete before/after group is asked again');
assert(retryTicks.includes('Image queries — retry'), 'incomplete before/after shows retry');
assert(retrySaved.has('svc:pool-surround-turf'), 'retried before/after prompt is saved');

const splitSaved = new Set();
let splitCalls = 0;
await runImageQueryGroups({
  keys: ['svc:good', 'svc:pool-surround-turf'],
  chunkSize: IMAGE_QUERY_BA_CHUNK,
  kind: 'beforeAfter',
  buildPrompt: async (chunk) => chunk.join(','),
  callClaudeFn: async ({ user }) => {
    splitCalls += 1;
    const keys = String(user).split(',');
    const beforeAfter = {};
    for (const key of keys) {
      beforeAfter[key] =
        key === 'svc:pool-surround-turf' && keys.length > 1
          ? { inside: { before: 'missing the other sides' } }
          : fullBa;
    }
    return { text: JSON.stringify({ beforeAfter }), truncated: false };
  },
  save: (value) => baSave(splitSaved, value),
  stillMissing: () => ['svc:good', 'svc:pool-surround-turf'].filter((key) => !splitSaved.has(key)),
});
assert(splitSaved.has('svc:good'), 'finished service in the pair is kept');
assert(splitSaved.has('svc:pool-surround-turf'), 'incomplete service is saved after the split');
assert(splitCalls === 1 + IMAGE_QUERY_JSON_RETRIES + 1, 'pair retries twice, then the leftover service is asked alone');

console.log('test-write-site-image-queries: ok');
