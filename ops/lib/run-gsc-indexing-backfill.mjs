/**
 * Backfill GSC URL policy on launched sites: assemble, ship, Cloudflare HTTPS/www.
 *
 * Usage:
 *   node ops/lib/run-gsc-indexing-backfill.mjs
 *   node ops/lib/run-gsc-indexing-backfill.mjs --https-only
 *   node ops/lib/run-gsc-indexing-backfill.mjs --domains=everettdrywallrepairpros.com
 */
import { assembleSite } from './assemble-site.mjs';
import { shipAssembledSite } from './ship-site.mjs';
import { listLaunchedSites } from './sites.mjs';
import { getCandidateDetail } from './candidates.mjs';
import { runCloudflareLaunch, cloudflareConfigured } from './cloudflare-launch.mjs';
import { loadEnvFile } from '../../scripts/lib/dataforseo.mjs';

loadEnvFile();

const DEFAULT_DOMAINS = [
  'brokenarrowdrywallrepairpros.com',
  'carydrywallrepairpros.com',
  'cedarrapidsdrywallrepairpros.com',
  'everettdrywallrepairpros.com',
  'hooverdrywallrepairpros.com',
  'meridiandrywallrepairpros.com',
  'newbraunfelsdrywallrepairpros.com',
  'omahaegresswindowpros.com',
  'roundrockdrywallrepairpros.com',
  'springfielddrywallrepairpros.com',
];

const args = process.argv.slice(2);
const httpsOnly = args.includes('--https-only');
const skipShip = args.includes('--skip-ship') || httpsOnly;
const skipAssemble = args.includes('--skip-assemble') || httpsOnly;
const skipGithub = args.includes('--skip-github');
const domainArg = args.find((a) => a.startsWith('--domains='));
const want = new Set(
  (domainArg ? domainArg.slice('--domains='.length).split(',') : DEFAULT_DOMAINS)
    .map((d) => d.trim().toLowerCase().replace(/^www\./, ''))
    .filter(Boolean),
);

function hostOf(site) {
  const raw = String(site?.domain || site?.liveUrl || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
  return raw;
}

const launched = listLaunchedSites();
const matches = launched.filter((s) => want.has(hostOf(s)));
const missing = [...want].filter((d) => !matches.some((s) => hostOf(s) === d));

if (!matches.length) {
  console.error('No launched sites matched the domain list.');
  if (missing.length) console.error('Missing:', missing.join(', '));
  process.exit(1);
}

console.log(
  `Backfill ${matches.length} site(s)` +
    (missing.length ? ` (not in registry: ${missing.join(', ')})` : ''),
);

const results = [];
for (const site of matches) {
  const domain = hostOf(site);
  const candidateId = site.candidateId;
  const row = { domain, candidateId, assemble: null, ship: null, cf: null, ok: false, error: null };
  console.log(`\n=== ${domain} (${candidateId}) ===`);
  try {
    if (!skipAssemble) {
      console.log('Assemble…');
      assembleSite(candidateId, { force: true });
      row.assemble = { ok: true };
    }
    if (!skipShip) {
      console.log('Ship…');
      const ship = await shipAssembledSite(candidateId, {
        skipGithub,
      });
      row.ship = { ok: ship.ok, error: ship.ok ? null : ship.human?.join('; ') };
      if (!ship.ok) throw new Error(ship.human?.join('; ') || 'ship failed');
    }
    if (cloudflareConfigured()) {
      console.log('Cloudflare HTTPS / www…');
      const detail = getCandidateDetail(candidateId);
      const workerName =
        detail.meta?.assembledSiteSlug || site.cfProject || site.workerName || null;
      const cf = await runCloudflareLaunch({
        domain,
        leadsEmail: `leads@${domain}`,
        destinationEmail: '',
        workerName,
        createTurnstile: false,
        attachDomain: true,
        setupEmail: false,
      });
      row.cf = {
        ok: cf.ok,
        https: cf.steps?.https || null,
        www: cf.steps?.workerDomainWww || null,
        human: cf.human || [],
      };
      if (cf.human?.length) console.log(cf.human.join('\n'));
    } else {
      row.cf = { skipped: true, reason: 'cloudflare not configured' };
      console.log('Skip Cloudflare (missing credentials)');
    }
    row.ok = true;
  } catch (error) {
    row.error = error.message || String(error);
    console.error('FAILED:', row.error);
  }
  results.push(row);
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\nDone. ok=${results.filter((r) => r.ok).length} failed=${failed.length}`,
);
console.log(JSON.stringify(results, null, 2));
if (failed.length) process.exitCode = 1;
