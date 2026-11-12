/**
 * Relaunch every launched site once: before/after logo, Rover form, notify address.
 *
 * Dry run (no writes, no ship):
 *   node scripts/relaunch-launched-sites.mjs --dry
 */
import { loadEnvFile } from './lib/dataforseo.mjs';
import { assembleSite } from '../ops/lib/assemble-site.mjs';
import { cloudflareConfigured } from '../ops/lib/cloudflare-launch.mjs';
import { formsInboxStatus } from '../ops/lib/forms-inbox.mjs';
import { launchSite } from '../ops/lib/launch-site.mjs';
import { getConcurrency } from '../ops/lib/rover-concurrency.mjs';
import {
  assertRelaunchNotifyEmail,
  clearAcceptedWeb3Key,
  relaunchProgressLine,
  relaunchSiteLabel,
  setLaunchedNotifyEmail,
  stampLaunchedBaLogo,
} from '../ops/lib/relaunch-launched.mjs';
import { loadAcceptedSiteConfig } from '../ops/lib/content-markdown.mjs';
import { listLaunchedSites } from '../ops/lib/sites.mjs';

loadEnvFile();

const dry = process.argv.includes('--dry');
const onlyIds = process.argv.filter((arg) => arg.startsWith('--id=')).map((arg) => arg.slice('--id='.length));

let notifyEmail;
try {
  notifyEmail = assertRelaunchNotifyEmail(process.env.LEAD_NOTIFY_EMAIL);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

let sites = listLaunchedSites().filter((site) => site.candidateId);
if (onlyIds.length) {
  const want = new Set(onlyIds);
  sites = sites.filter((site) => want.has(site.candidateId));
}
const slots = Math.max(1, Number(getConcurrency().heavy) || 1);
const total = sites.length;

console.log(`Notify: ${notifyEmail}`);
console.log(`Heavy slots: ${slots}`);
console.log(`Sites: ${total}`);
for (const site of sites) {
  console.log(`- ${relaunchSiteLabel(site)} — ${site.domain || 'no domain'}`);
}

if (dry) {
  console.log('Dry run. No logos, configs, assembles, or launches.');
  process.exit(0);
}

if (!formsInboxStatus().ready) {
  console.error('Forms inbox is not set up. Stopping before any launch.');
  process.exit(1);
}
if (!cloudflareConfigured()) {
  console.error('Cloudflare is not configured. Stopping before any launch.');
  process.exit(1);
}

let done = 0;
let failed = 0;
function report(site, outcome) {
  done += 1;
  if (!outcome.ok) failed += 1;
  console.log(relaunchProgressLine(done, total, relaunchSiteLabel(site), outcome));
}

const ready = [];
for (const site of sites) {
  try {
    clearAcceptedWeb3Key(site.candidateId);
    setLaunchedNotifyEmail(site.candidateId, notifyEmail);
    ready.push(site);
  } catch (error) {
    report(site, { ok: false, error: error.message });
  }
}

const sample = ready[0];
if (!sample) {
  console.error('No site was prepared. Stopping before any launch.');
  process.exit(1);
}

const prepared = listLaunchedSites().find((site) => site.candidateId === sample.candidateId);
const preparedConfig = loadAcceptedSiteConfig(sample.candidateId)?.config || {};
if (prepared?.notifyEmail !== notifyEmail || preparedConfig.web3FormsAccessKey) {
  console.error(
    `Allowlist payload for ${sample.domain || sample.candidateId} did not match ${notifyEmail} with the Web3Forms key removed. Stopping before any launch.`,
  );
  process.exit(1);
}
console.log(
  `Allowlist payload ${prepared.domain} notify ${prepared.notifyEmail}; web3 key removed`,
);

async function relaunchOne(site) {
  try {
    const logo = await stampLaunchedBaLogo(site.candidateId);
    console.log(`… ${relaunchSiteLabel(site)} assemble`);
    assembleSite(site.candidateId, { force: true });
    console.log(`… ${relaunchSiteLabel(site)} launch`);
    const launch = await launchSite(site.candidateId, {
      destinationEmail: notifyEmail,
      ship: true,
    });
    if (!launch?.ok) {
      const parts = [
        ...(launch?.blockers || []).map((item) => item.label || item.id),
        ...(launch?.human || []),
      ].filter(Boolean);
      report(site, { ok: false, error: parts.join('; ') || 'launch failed', logo: logo?.skipped });
      return;
    }
    report(site, { ok: true, logo: logo?.skipped });
  } catch (error) {
    report(site, { ok: false, error: error.message });
  }
}

async function runPool(items, limit) {
  let cursor = 0;
  async function loop() {
    while (cursor < items.length) {
      const site = items[cursor];
      cursor += 1;
      await relaunchOne(site);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => loop()));
}

await runPool(ready, slots);

console.log(`Finished ${done} of ${total}. Failed ${failed}.`);
process.exit(failed ? 1 : 0);
