/**
 * Workers Free script cap: Wrangler’s 100-worker error is a plan limit,
 * and the launch dialog tells the operator to upgrade, then Run launch.
 * Run: node scripts/test-workers-free-cap.mjs
 */
import { readFileSync } from 'node:fs';
import {
  isWorkersFreeCapMessage,
  isWorkersFreeCapResult,
  WORKERS_FREE_CAP_CODE,
  WORKERS_FREE_CAP_NOTE,
} from '../ops/public/workers-free-cap.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

const wrangler = `npm warn Unknown env config "devdir". This will stop working in the next major version of npm.
\u001b[31mERROR\u001b[0m A request to the Cloudflare API (/accounts/abc/workers/scripts/example-com/assets-upload-session) failed.
This account has reached the Workers Free limit of 100 Workers per account. Upgrade to Workers Paid to increase this limit to 500.
[code: 10037]`;

assert(isWorkersFreeCapMessage(wrangler), 'wrangler free-cap error is the script cap');
assert(isWorkersFreeCapMessage('Workers Free limit of 100'), 'limit of 100 is the script cap');
assert(
  !isWorkersFreeCapMessage(
    'Deploy skipped: dist has 341 static files, over the Workers Free limit of 20000.',
  ),
  'static file cap is not the script cap',
);
assert(!isWorkersFreeCapMessage('wrangler deploy failed: exit 1'), 'a generic deploy failure is not the cap');
assert(!isWorkersFreeCapMessage('code: 10037'), 'error code alone is not the cap');

const ship = {
  ok: false,
  steps: {
    github: { ok: true },
    build: { ok: true },
    deploy: { ok: false, error: wrangler, code: WORKERS_FREE_CAP_CODE },
  },
  human: [WORKERS_FREE_CAP_NOTE],
  candidate: { meta: { emailRoutingDone: true } },
};
assert(isWorkersFreeCapResult(ship), 'ship result with the code is the cap');
assert(!isWorkersFreeCapResult({ ...ship, ok: true }), 'a successful ship is not the cap dialog');

const legacy = {
  ok: false,
  ship: { steps: { deploy: { ok: false, error: wrangler } } },
  human: [`Wrangler deploy failed: ${wrangler}`],
};
assert(isWorkersFreeCapResult(legacy), 'an older result still matches the wrangler text');

const staticFile = {
  ok: false,
  steps: {
    deploy: {
      ok: false,
      error: 'Deploy skipped: dist has 341 static files, over the Workers Free limit of 20000.',
    },
  },
  human: ['Deploy skipped: dist has 341 static files, over the Workers Free limit of 20000.'],
};
assert(!isWorkersFreeCapResult(staticFile), 'static file cap result stays on the normal dialog');

const shipSource = readFileSync(new URL('../ops/lib/ship-site.mjs', import.meta.url), 'utf8');
assert(shipSource.includes('isWorkersFreeCapMessage'), 'ship checks the wrangler error');
assert(shipSource.includes('WORKERS_FREE_CAP_CODE'), 'ship stores the cap code');
assert(shipSource.includes('WORKERS_FREE_CAP_NOTE'), 'ship stores the one-line note');
assert(
  shipSource.includes('distExceedsWorkersFreeLimit'),
  'static file cap path is unchanged',
);

const app = readFileSync(new URL('../ops/public/app.js', import.meta.url), 'utf8');
assert(app.includes('Cloudflare Workers plan is full'), 'dialog title is plain');
assert(app.includes('allows <strong>100 Workers</strong>'), 'dialog states the free cap');
assert(app.includes('allows <strong>500 Workers</strong>'), 'dialog states the paid cap');
assert(app.includes('$5 per month'), 'dialog states the paid price');
assert(app.includes('Workers &amp; Pages → Plans'), 'dialog names the Cloudflare page');
assert(app.includes('click <strong>Run launch</strong>'), 'dialog names Run launch');
assert(app.includes('Leave <strong>Auto ship</strong> on.'), 'dialog leaves Auto ship on');
assert(
  app.includes('Leave <strong>Run Cloudflare domain / email API</strong> off.'),
  'dialog leaves the email checkbox off when routing already succeeded',
);
assert(app.includes('launchResultIsWorkersFreeCap(result)'), 'launch and push use the detector');
assert(app.includes('workersFreeCapHelpHtml(result)'), 'push updates uses the same body');
assert(!app.includes('wrangler-2026'), 'dialog does not embed a log path');

console.log('workers free cap ok');
