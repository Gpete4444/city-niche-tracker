import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runAsync } from '../ops/lib/github-site.mjs';
import { deployAssembledWithWranglerAsync } from '../ops/lib/ship-site.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

assert(typeof runAsync === 'function', 'runAsync export');
assert(runAsync.constructor.name === 'Function', 'runAsync returns a Promise');
assert(typeof deployAssembledWithWranglerAsync === 'function', 'deployAssembledWithWranglerAsync export');
assert(
  deployAssembledWithWranglerAsync.constructor.name === 'AsyncFunction',
  'wrangler helper is async',
);
assert(
  !deployAssembledWithWranglerAsync.toString().includes('spawnSync'),
  'async wrangler helper does not call spawnSync',
);

const shipSrc = readFileSync(path.resolve('ops/lib/ship-site.mjs'), 'utf8');
assert(
  shipSrc.includes('await deployAssembledWithWranglerAsync'),
  'shipAssembledSite awaits async Wrangler',
);
assert(
  shipSrc.includes('await pushAssembledSiteToGithubAsync'),
  'shipAssembledSite awaits async GitHub push',
);
assert(
  !/steps\.deploy = deployAssembledWithWrangler\(/.test(shipSrc),
  'ship path does not call sync Wrangler',
);

const ghSrc = readFileSync(path.resolve('ops/lib/github-site.mjs'), 'utf8');
assert(/export function runAsync/.test(ghSrc), 'runAsync is exported');
assert(ghSrc.includes('spawn(') && !/function runAsync[\s\S]*execFileSync/.test(ghSrc), 'runAsync uses spawn');

const pending = runAsync(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], process.cwd());
assert(typeof pending.then === 'function', 'runAsync is Promise-based');

let ticks = 0;
const iv = setInterval(() => {
  ticks += 1;
}, 25);
await pending;
clearInterval(iv);
assert(ticks >= 4, `event loop should stay free during runAsync (got ${ticks} ticks)`);

console.log('test-ship-async-spawn: ok');
