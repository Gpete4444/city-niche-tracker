/**
 * Allowlist notify overwrite and relaunch prep helpers.
 * Run: node scripts/test-relaunch-launched-prep.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ALLOWLIST_NOTIFY_ON_CONFLICT } from '../ops/lib/forms-inbox.mjs';
import {
  assertRelaunchNotifyEmail,
  configWithoutWeb3Key,
  relaunchProgressLine,
  relaunchSiteLabel,
  stripWeb3KeyInFile,
} from '../ops/lib/relaunch-launched.mjs';

assert.equal(ALLOWLIST_NOTIFY_ON_CONFLICT, 'notify_email = excluded.notify_email');
assert.equal(ALLOWLIST_NOTIFY_ON_CONFLICT.includes('COALESCE'), false);

const stripped = configWithoutWeb3Key({
  domain: 'example.com',
  web3FormsAccessKey: 'secret-key',
  formsIngestUrl: 'https://forms.example/submit',
});
assert.equal(stripped.domain, 'example.com');
assert.equal(stripped.formsIngestUrl, 'https://forms.example/submit');
assert.equal(Object.prototype.hasOwnProperty.call(stripped, 'web3FormsAccessKey'), false);

const dir = mkdtempSync(path.join(tmpdir(), 'relaunch-prep-'));
const filePath = path.join(dir, 'site-config.json');
writeFileSync(
  filePath,
  `${JSON.stringify({ domain: 'example.com', web3FormsAccessKey: 'secret-key', phone: '555' }, null, 2)}\n`,
);
const fileResult = stripWeb3KeyInFile(filePath);
assert.equal(fileResult.stripped, true);
const onDisk = JSON.parse(readFileSync(filePath, 'utf8'));
assert.equal(onDisk.domain, 'example.com');
assert.equal(onDisk.phone, '555');
assert.equal(Object.prototype.hasOwnProperty.call(onDisk, 'web3FormsAccessKey'), false);
assert.equal(stripWeb3KeyInFile(filePath).reason, 'absent');

assert.equal(
  relaunchProgressLine(12, 68, 'Caldwell Drywall Repair', { ok: true }),
  '12 of 68 — Caldwell Drywall Repair shipped',
);
assert.equal(
  relaunchProgressLine(3, 68, 'Eagle Drywall Repair', { ok: true, logo: 'no-logo' }),
  '3 of 68 — Eagle Drywall Repair shipped, no logo',
);
assert.equal(
  relaunchProgressLine(4, 68, 'Glendale Turf', { ok: false, error: 'zone missing' }),
  '4 of 68 — Glendale Turf failed: zone missing',
);
assert.equal(
  relaunchSiteLabel({ businessName: 'Drywall Repair', city: 'Eagle' }),
  'Drywall Repair · Eagle',
);
assert.equal(assertRelaunchNotifyEmail('PaulJThiriot@gmail.com'), 'pauljthiriot@gmail.com');
assert.throws(() => assertRelaunchNotifyEmail('other@gmail.com'));

console.log('test-relaunch-launched-prep: ok');
