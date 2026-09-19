/**
 * Write site Outline: continue truncated JSON, then merge home/svc/loc slices.
 * Run: node scripts/test-write-site-outline-continue.mjs
 */
import { parseJsonLoose, resolveClaudeMessages } from '../ops/lib/claude.mjs';
import {
  JSON_CONTINUE_FOLLOWS,
  claudeJsonWithContinue,
  concatClaudeJsonText,
} from '../ops/lib/claude-json-continue.mjs';
import {
  mergeOutlineSectionChunks,
  outlineRefineGroups,
  outlineSectionKind,
} from '../ops/lib/content-structure.mjs';
import {
  OUTLINE_REFINE_MAX_TOKENS,
  refineOutlineFromClaude,
} from '../ops/lib/content-write-site.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

assert(OUTLINE_REFINE_MAX_TOKENS === 32768, 'outline refine uses 32768 tokens');
assert(JSON_CONTINUE_FOLLOWS === 2, 'two continue follows');

const turns = resolveClaudeMessages({
  messages: [
    { role: 'user', content: 'start' },
    { role: 'assistant', content: '{"a":' },
    { role: 'user', content: 'continue' },
  ],
});
assert(turns.length === 3 && turns[1].role === 'assistant', 'multi-turn messages resolve');
assert(
  resolveClaudeMessages({ user: 'hello' })[0].content === 'hello',
  'single user still works',
);

const left = '{"sections":[{"id":"intro","heading":"';
const right = 'Hello"}]}';
const glued = parseJsonLoose(concatClaudeJsonText([left, right]));
assert(glued.ok === true, 'concatenated JSON parses');
assert(glued.value.sections[0].heading === 'Hello', 'concatenated heading survives');

assert(outlineSectionKind('intro') === 'home', 'intro is home');
assert(outlineSectionKind('svcLift') === 'services', 'svc* is services');
assert(outlineSectionKind('locAubrey') === 'locations', 'loc* is locations');

const base = {
  pages: [{ id: 'home' }],
  pageIds: ['home', 'services', 'locations'],
  sections: [
    { id: 'intro', heading: 'Old home' },
    { id: 'svcLift', heading: 'Old svc' },
    { id: 'locAubrey', heading: 'Old loc' },
  ],
};
const groups = outlineRefineGroups(base);
assert(groups.map((g) => g.label).join(',') === 'home,services,locations', 'three refine groups');
assert(groups[0].sectionIds[0] === 'intro', 'home group has intro');

const merged = mergeOutlineSectionChunks(base, [
  { sections: [{ id: 'intro', heading: 'New home' }], keywordTargets: [{ keyword: 'lift' }] },
  { sections: [{ id: 'svcLift', heading: 'New svc' }] },
]);
assert(merged.pages[0].id === 'home', 'pages stay from composed outline');
assert(merged.sections[0].heading === 'New home', 'home section replaced');
assert(merged.sections[1].heading === 'New svc', 'service section replaced');
assert(merged.sections[2].heading === 'Old loc', 'untouched location kept');
assert(merged.keywordTargets[0].keyword === 'lift', 'SEO maps merge from slice');

const complete = {
  sections: [{ id: 'intro', heading: 'Hi' }],
  keywordTargets: [{ keyword: 'x' }],
};
const fullText = JSON.stringify(complete);
const mid = Math.floor(fullText.length / 2);
let continueCalls = 0;
const continued = await claudeJsonWithContinue({
  user: 'full-outline',
  claudeMessagesFn: async () => {
    continueCalls += 1;
    if (continueCalls === 1) {
      return { text: fullText.slice(0, mid), truncated: true };
    }
    return { text: fullText.slice(mid), truncated: false };
  },
});
assert(continueCalls === 2, 'truncated first call continues once');
assert(continued.followsUsed === 1, 'one follow recorded');
assert(continued.parsed.ok === true, 'continued JSON parses');
assert(continued.parsed.value.sections[0].id === 'intro', 'continued sections present');
assert(continued.truncated === false, 'complete after continue is not truncated');

const ticks = [];
const sliceCalls = [];
let fullAttempts = 0;
const chunked = await refineOutlineFromClaude({
  prompt: 'FULL',
  outline: base,
  tick: (d) => ticks.push(d),
  buildSlicePrompt: async (ids) => `SLICE:${ids.join(',')}`,
  callClaudeFn: async ({ user }) => {
    const u = String(user || '');
    if (u.startsWith('SLICE:')) {
      sliceCalls.push(u);
      const sections = u
        .slice(6)
        .split(',')
        .filter(Boolean)
        .map((id) => ({ id, heading: `New ${id}` }));
      return {
        text: JSON.stringify({ sections }),
        parsed: { ok: true, value: { sections } },
        truncated: false,
      };
    }
    fullAttempts += 1;
    return { text: '{"sections":[', parsed: { ok: false, value: null }, truncated: true };
  },
});
assert(fullAttempts === 1 + JSON_CONTINUE_FOLLOWS, 'full refine continues twice then chunks');
assert(chunked.mode === 'chunks', 'falls back to home/svc/loc chunks');
assert(sliceCalls.length === 3, 'three slice calls');
assert(chunked.parsed.ok === true, 'chunk merge parses');
assert(chunked.parsed.value.sections[0].heading === 'New intro', 'home slice applied');
assert(chunked.parsed.value.sections[1].heading === 'New svcLift', 'services slice applied');
assert(chunked.parsed.value.sections[2].heading === 'New locAubrey', 'locations slice applied');
assert(chunked.parsed.value.pages[0].id === 'home', 'chunk merge keeps composed pages');
assert(
  ticks.some((t) => t.includes('home')) && ticks.some((t) => t.includes('locations')),
  'progress ticks name outline slices',
);

console.log('test-write-site-outline-continue: ok');
