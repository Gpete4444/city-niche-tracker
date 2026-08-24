import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreCompetition } from './lib/scoring.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(
  root,
  'research',
  'batches',
  'nc-sewer-line-replacement-trenchless-art-2026-08-21T23-07-18',
  'serp-cache',
);

if (!existsSync(cacheDir)) {
  console.log(`SKIP test-openness-cache-replay: local ignored cache directory absent (${cacheDir})`);
  process.exit(0);
}

const golden = {
  'artificial-turf-installation__apex__nc.json': 7.7,
  'artificial-turf-installation__asheville__nc.json': 6.2,
  'artificial-turf-installation__cary__nc.json': 7.2,
  'artificial-turf-installation__concord__nc.json': 7.8,
  'artificial-turf-installation__gastonia__nc.json': 7.7,
  'artificial-turf-installation__greenville__nc.json': 7.4,
  'artificial-turf-installation__high-point__nc.json': 7.8,
  'artificial-turf-installation__jacksonville__nc.json': 8.1,
  'artificial-turf-installation__wilmington__nc.json': 6.9,
  'commercial-epoxy-flooring__apex__nc.json': 6.3,
  'commercial-epoxy-flooring__asheville__nc.json': 5.9,
  'commercial-epoxy-flooring__cary__nc.json': 6.4,
  'commercial-epoxy-flooring__concord__nc.json': 7.6,
  'commercial-epoxy-flooring__gastonia__nc.json': 7.7,
  'commercial-epoxy-flooring__greenville__nc.json': 6.0,
  'commercial-epoxy-flooring__high-point__nc.json': 6.3,
  'commercial-epoxy-flooring__jacksonville__nc.json': 6.8,
  'commercial-epoxy-flooring__wilmington__nc.json': 4.2,
  'sewer-line-replacement-trenchless-__apex__nc.json': 7.5,
  'sewer-line-replacement-trenchless-__asheville__nc.json': 8.0,
  'sewer-line-replacement-trenchless-__cary__nc.json': 7.6,
  'sewer-line-replacement-trenchless-__concord__nc.json': 7.6,
  'sewer-line-replacement-trenchless-__gastonia__nc.json': 7.5,
  'sewer-line-replacement-trenchless-__greenville__nc.json': 7.5,
  'sewer-line-replacement-trenchless-__high-point__nc.json': 7.4,
  'sewer-line-replacement-trenchless-__jacksonville__nc.json': 7.6,
  'sewer-line-replacement-trenchless-__wilmington__nc.json': 7.9,
};

const files = readdirSync(cacheDir).filter((file) => file.endsWith('.json')).sort();
assert.equal(files.length, 27, `expected 27 local cache JSONs, found ${files.length}`);
assert.deepEqual(files, Object.keys(golden).sort(), 'local cache filenames match frozen panel');

let matches = 0;
for (const file of files) {
  const cache = JSON.parse(readFileSync(path.join(cacheDir, file), 'utf8'));
  const actual = scoreCompetition({ classifiedSerp: cache.classified }).score;
  assert.equal(actual, golden[file], `${file}: expected ${golden[file]}, got ${actual}`);
  matches += 1;
}

console.log(`PASS test-openness-cache-replay: ${matches} / 27 exact matches`);
