/**
 * Cluster Generate pack chunking (no live Claude).
 * Run: node scripts/test-cluster-generate-pack-chunks.mjs
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  chunkPinnedRows,
  fillGeneratePackRowChunks,
  formatGeneratePackSiblings,
  GENERATE_PACK_CHUNK,
  generatePackChunkCount,
  mergeGeneratePackRows,
  parseGeneratePackCsv,
} from '../ops/lib/discovery-generate-pack-chunks.mjs';
import {
  buildGeneratePackPrompt,
  getShotgunCostPreview,
  pinnedRows,
} from '../ops/lib/discovery-shotgun.mjs';
import { DISCOVERY_CLAUDE_COLUMNS, rowsToCsv } from '../ops/lib/discovery.mjs';
import { emptyShotgunDraft, saveShotgunDraft } from '../ops/lib/shotgun.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

function fakePinned(n) {
  const rows = [];
  for (let i = 1; i <= n; i += 1) {
    const row = {};
    for (const col of DISCOVERY_CLAUDE_COLUMNS) row[col] = '';
    row.Niche = 'Concrete';
    row.City = `City${i}`;
    row.State = 'TX';
    rows.push(row);
  }
  return rows;
}

function csvFor(rows) {
  return rowsToCsv(
    rows.map((r) => ({
      ...r,
      pain_points: 'p',
      suggested_services: 's',
      suggested_suburbs: 'sub',
      confidence_narrative: 'c',
    })),
    DISCOVERY_CLAUDE_COLUMNS,
  );
}

const seventyThree = fakePinned(73);
const chunks = chunkPinnedRows(seventyThree);
assertEqual(chunks.length, 4, '73 cities → 4 chunks');
assertEqual(chunks[0].length, 20, 'first chunk is 20');
assertEqual(chunks[3].length, 13, 'last chunk is 13');
assertEqual(generatePackChunkCount(73), 4, 'chunk count 73');
assertEqual(generatePackChunkCount(0), 1, 'empty still one call slot');
assertEqual(GENERATE_PACK_CHUNK, 20, 'chunk size constant');

const merged = mergeGeneratePackRows([
  seventyThree.slice(0, 20),
  seventyThree.slice(10, 30),
  seventyThree.slice(20),
]);
assertEqual(merged.length, 73, 'merge keeps all cities');
assertEqual(new Set(merged.map((r) => `${r.City}|${r.State}`)).size, 73, 'merge has no dupes');

const parsed = parseGeneratePackCsv(`Here you go:\n\n${csvFor(seventyThree.slice(0, 3))}\n`);
assertEqual(parsed.length, 3, 'parseGeneratePackCsv reads fenced-or-pasted CSV');

const pipeHeader = DISCOVERY_CLAUDE_COLUMNS.map((col) => ` ${col} `).join('|');
const pipeRow = DISCOVERY_CLAUDE_COLUMNS.map((col, idx) => {
  if (idx === 0) return ' Concrete ';
  if (idx === 1) return ' City1 ';
  if (idx === 2) return ' TX ';
  return ' x ';
}).join('|');
const pipeTable = `|${pipeHeader}|\n|${DISCOVERY_CLAUDE_COLUMNS.map(() => ' --- ').join('|')}|\n|${pipeRow}|`;
const pipeParsed = parseGeneratePackCsv(`Notes first.\n\n${pipeTable}\n`);
assertEqual(pipeParsed.length, 1, 'pipe table parses to data rows');
assertEqual(pipeParsed[0].City, 'City1', 'pipe table city');
assertEqual(pipeParsed[0].Niche, 'Concrete', 'pipe table niche');

const headerless = csvFor(seventyThree.slice(0, 2)).split(/\r?\n/).slice(1).join('\n');
const headerlessParsed = parseGeneratePackCsv(headerless);
assertEqual(headerlessParsed.length, 2, 'headerless pinned rows parse');
assertEqual(headerlessParsed[0].Niche, 'Concrete', 'headerless niche comes from the pinned columns');
assertEqual(headerlessParsed[1].City, 'City2', 'headerless second city');

let proseFailed = false;
try {
  parseGeneratePackCsv('I cannot produce a table. Here is a summary of the cities instead.');
} catch (error) {
  proseFailed =
    /No CSV header found/.test(error.message) && /summary of the cities/.test(error.message);
}
assert(proseFailed, 'prose reply throws and includes an excerpt');

const members = seventyThree.map((r, i) => ({
  city: r.City,
  state: r.State,
  role: i === 0 ? 'hub' : 'member',
  clusterKey: i === 0 ? null : 1,
}));
const siblingText = formatGeneratePackSiblings(members);
assertEqual(siblingText.split('\n').length, 73, 'sibling list includes every member');

const calls = [];
const filled = await fillGeneratePackRowChunks({
  pinnedRows: fakePinned(20),
  buildPrompt: (chunkRows) => `PROMPT ${chunkRows.length} ${chunkRows[0].City}`,
  claudeMessagesFn: async ({ user, maxTokens }) => {
    calls.push({ user, maxTokens, n: Number(/PROMPT (\d+)/.exec(user)?.[1]) });
    if (calls.length <= 2) return { text: '', truncated: true, costUsd: 0.01 };
    const start = calls.length === 3 ? 1 : 11;
    return { text: csvFor(fakePinned(20).slice(start - 1, start - 1 + 10)), truncated: false, costUsd: 0.02 };
  },
});
assertEqual(calls.length, 4, 'truncate retries once then splits 20 → 10+10');
assertEqual(calls[0].n, 20, 'first call is 20 cities');
assertEqual(calls[1].n, 20, 'retry is still 20 cities');
assertEqual(calls[2].n, 10, 'split first half is 10');
assertEqual(calls[3].n, 10, 'split second half is 10');
assertEqual(filled.rows.length, 20, 'split merge returns all 20 cities');
assert(filled.costUsd > 0, 'chunk costs sum');

let oneCityFails = false;
try {
  await fillGeneratePackRowChunks({
    pinnedRows: fakePinned(1),
    buildPrompt: () => 'x',
    claudeMessagesFn: async () => ({ text: '', truncated: true }),
  });
} catch (e) {
  oneCityFails = /token cap/.test(e.message);
}
assert(oneCityFails, '1-city truncate still fails the job');

const formatCalls = [];
const formatFilled = await fillGeneratePackRowChunks({
  pinnedRows: fakePinned(1),
  buildPrompt: () => 'PACK',
  claudeMessagesFn: async ({ user }) => {
    formatCalls.push(user);
    if (formatCalls.length === 1) return { text: 'Just a summary of the city.', truncated: false };
    return { text: csvFor(fakePinned(1)), truncated: false };
  },
});
assertEqual(formatCalls.length, 2, 'missing header retries once');
assert(/first line must start with Niche/.test(formatCalls[1]), 'retry suffix asks for a Niche header');
assertEqual(formatFilled.rows.length, 1, 'format retry imports the second reply');

let formatFails = false;
try {
  await fillGeneratePackRowChunks({
    pinnedRows: fakePinned(1),
    buildPrompt: () => 'PACK',
    claudeMessagesFn: async () => ({ text: 'Still prose, no table here.', truncated: false }),
  });
} catch (error) {
  formatFails = /No CSV header found/.test(error.message) && /Still prose/.test(error.message);
}
assert(formatFails, 'second missing header fails with an excerpt');

const batchId = 'zz_test_genpack_chunks';
const dir = path.join(process.cwd(), 'research', 'batches', batchId);
try {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'meta.json'),
    `${JSON.stringify(
      {
        id: batchId,
        filters: { packType: 'cluster', shotgunNiche: 'Concrete', states: ['TX'] },
        outputBasename: 'zz-test-genpack',
      },
      null,
      2,
    )}\n`,
  );
  saveShotgunDraft(dir, {
    ...emptyShotgunDraft({ shotgunNiche: 'Concrete' }),
    niche: 'Concrete',
    hub: { city: 'City1', state: 'TX' },
    members,
  });
  const pinned = pinnedRows('Concrete', members);
  assertEqual(pinned.length, 73, 'all members without candidateId are pinned');
  const prompt = buildGeneratePackPrompt(batchId, {
    api: true,
    pinnedRows: pinned.slice(0, 20),
  });
  const pinnedBlock = prompt.split('Pinned template:')[1] || '';
  const siblingBlock = prompt.split('Siblings (do not list as suburbs):')[1] || '';
  assertEqual((pinnedBlock.match(/,City\d+,TX,/g) || []).length, 20, 'PINNED_CSV has 20 cities');
  assert(!pinnedBlock.includes(',City21,TX,'), 'PINNED_CSV does not include city 21');
  assertEqual((siblingBlock.match(/City\d+, TX/g) || []).length, 73, 'SIBLING_CITIES lists all 73 members');
  assert(/exactly one/i.test(prompt) && /```csv/.test(prompt), 'API prompt requires one csv fence');
  assert(!/Max rows/i.test(prompt), 'API prompt does not mention Max rows');
  assert(!/fill remaining rows/i.test(prompt), 'API prompt does not ask for catalog rows');
  assert(/Seasonality:/.test(prompt) && /Ticket tiers:/.test(prompt), 'API prompt has seasonality and tiers');
  const preview = getShotgunCostPreview(batchId, 'shotgun-generate-pack');
  assert(/4 Claude calls/.test(preview.estimateLabel || ''), 'cost preview mentions 4 Claude calls');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('test-cluster-generate-pack-chunks: ok');
