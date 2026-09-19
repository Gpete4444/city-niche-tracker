/**
 * Audit/fix Cloudflare Email Routing: leads@{domain} → WEB3FORMS_DEFAULT_NOTIFY_EMAIL.
 * Does not attach domains or ship sites.
 *
 * Run: node scripts/backfill-leads-email-routing.mjs
 * Dry run: node scripts/backfill-leads-email-routing.mjs --dry
 */
import { loadEnvFile } from './lib/dataforseo.mjs';
import { listLaunchedSites } from '../ops/lib/sites.mjs';
import { publicLeadsEmail } from '../ops/lib/site-config.mjs';
import {
  cfFetch,
  cloudflareConfigured,
  ensureEmailDestination,
  ensureEmailRoutingEnabled,
  ensureLeadsForwardRule,
  findZone,
} from '../ops/lib/cloudflare-launch.mjs';

loadEnvFile();

const dry = process.argv.includes('--dry');
const dest = String(process.env.WEB3FORMS_DEFAULT_NOTIFY_EMAIL || '')
  .trim()
  .toLowerCase();

if (!dest || !dest.includes('@')) {
  console.error('Set WEB3FORMS_DEFAULT_NOTIFY_EMAIL in .env');
  process.exit(1);
}
if (!cloudflareConfigured()) {
  console.error('Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN');
  process.exit(1);
}

const sites = listLaunchedSites().filter((s) => s.domain);
console.log(`${dry ? 'Dry run — ' : ''}Email Routing destination: ${dest}`);
console.log(`Launched sites with domain: ${sites.length}\n`);

const rows = [];
for (const site of sites) {
  const domain = String(site.domain || '').trim().toLowerCase();
  const leads = publicLeadsEmail(site.email, domain) || `leads@${domain}`;
  const name = site.businessName || site.candidateId || domain;
  const row = { name, domain, leads, status: '', forwards: '' };
  try {
    const zone = await findZone(domain);
    if (!zone) {
      row.status = 'no-zone';
      rows.push(row);
      console.log(`○ ${name}  ${leads}  no Cloudflare zone`);
      continue;
    }
    const rules = await cfFetch('GET', `/zones/${zone.id}/email/routing/rules`);
    const list = Array.isArray(rules) ? rules : [];
    const match = list.find((r) =>
      (r.matchers || []).some(
        (m) =>
          m.type === 'literal' &&
          m.field === 'to' &&
          String(m.value || '').toLowerCase() === leads,
      ),
    );
    const forwards = (match?.actions || [])
      .filter((a) => a.type === 'forward')
      .flatMap((a) => a.value || [])
      .map((v) => String(v).toLowerCase());
    row.forwards = forwards.join(', ') || '(none)';
    const already = forwards.includes(dest) && match?.enabled !== false;
    if (dry) {
      row.status = already ? 'ok' : match ? 'needs-update' : 'missing-rule';
      rows.push(row);
      console.log(`${already ? '✓' : '○'} ${name}  ${leads}  → ${row.forwards}  (${row.status})`);
      continue;
    }
    await ensureEmailDestination(zone.id, dest);
    await ensureEmailRoutingEnabled(zone.id);
    const result = await ensureLeadsForwardRule(zone.id, leads, dest);
    row.status = result?.updated ? 'updated' : result?.created ? 'created' : 'ok';
    row.forwards = dest;
    rows.push(row);
    console.log(`${row.status === 'ok' ? '✓' : '→'} ${name}  ${leads}  → ${dest}  (${row.status})`);
  } catch (error) {
    row.status = `error: ${error.message}`;
    rows.push(row);
    console.log(`✗ ${name}  ${leads}  ${error.message}`);
  }
}

const bad = rows.filter((r) => r.status.startsWith('error') || r.status === 'no-zone');
console.log(`\nDone. ${rows.length - bad.length} ok, ${bad.length} need attention.`);
if (bad.length) process.exitCode = 1;
