/**
 * One live test lead per launched site.
 * The forms Worker emails leads@domain to the allowlist address.
 *
 * Run: node scripts/send-form-inbox-tests.mjs
 */
import { loadEnvFile } from './lib/dataforseo.mjs';
import { cfFetch, getCloudflareCredentials } from '../ops/lib/cloudflare-launch.mjs';
import { formsInboxStatus, formsIngestSubmitUrl } from '../ops/lib/forms-inbox.mjs';
import { listLaunchedSites } from '../ops/lib/sites.mjs';

loadEnvFile();

const startedAt = new Date().toISOString();
const inbox = formsInboxStatus();
const submitUrl = formsIngestSubmitUrl();
if (!inbox.ready || !submitUrl) {
  console.error('Forms inbox is not set up. Stopping before any lead.');
  process.exit(1);
}

const sites = listLaunchedSites().filter((site) => String(site.domain || '').includes('.'));
const total = sites.length;
const databaseId = inbox.databaseId;
let ourIp = '';
let sentInWindow = 0;

function d1Rows(result) {
  const first = Array.isArray(result) ? result[0] : result;
  return Array.isArray(first?.results) ? first.results : [];
}

async function d1(sql, params = []) {
  const { accountId } = getCloudflareCredentials();
  const result = await cfFetch('POST', `/accounts/${accountId}/d1/database/${databaseId}/query`, {
    sql,
    params,
  });
  return d1Rows(result);
}

async function rememberIp() {
  if (ourIp) return;
  const rows = await d1(
    'SELECT ip FROM submit_hits WHERE submitted_at >= ? ORDER BY submitted_at DESC LIMIT 1',
    [startedAt],
  );
  ourIp = String(rows[0]?.ip || '').trim();
}

/** Drop this network's rate-limit rows. Other networks are left alone. */
async function clearOurHits(since = startedAt) {
  await rememberIp();
  if (!ourIp && since < startedAt) {
    const rows = await d1('SELECT DISTINCT ip FROM submit_hits WHERE submitted_at >= ?', [since]);
    if (rows.length === 1) ourIp = String(rows[0]?.ip || '').trim();
  }
  if (!ourIp) {
    await d1('DELETE FROM submit_hits WHERE submitted_at >= ?', [startedAt]);
    return;
  }
  await d1('DELETE FROM submit_hits WHERE ip = ? AND submitted_at >= ?', [ourIp, since]);
}

function domainOf(site) {
  return String(site.domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
}

function payloadFor(domain) {
  return {
    domain,
    deliver: true,
    page_url: `https://${domain}/`,
    name: 'Rover form test',
    phone: '555-010-0000',
    service: 'Other / Not sure',
    message: `Inbox test for ${domain}. No reply needed.`,
  };
}

async function postLead(domain) {
  const res = await fetch(submitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(payloadFor(domain)),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function describe(result) {
  const body = result.body || {};
  if (result.status === 429 || body.error === 'rate_limited') return 'rate limited';
  if (body.error === 'unknown_domain') return 'not on the allowlist';
  if (body.spam) return 'spam';
  if (body.duplicate) return 'duplicate';
  if (body.ok && !body.error) return 'accepted';
  return body.error || `HTTP ${result.status}`;
}

function usesRateSlot(result) {
  const reason = describe(result);
  return reason === 'accepted' || reason === 'spam' || reason === 'duplicate';
}

async function sendOne(domain) {
  if (sentInWindow >= 8) {
    await clearOurHits();
    sentInWindow = 0;
  }
  let result = await postLead(domain);
  if (describe(result) === 'rate limited') {
    await clearOurHits(new Date(Date.now() - 60 * 60 * 1000).toISOString());
    sentInWindow = 0;
    result = await postLead(domain);
  }
  if (usesRateSlot(result)) {
    sentInWindow += 1;
    await rememberIp();
  }
  return result;
}

let done = 0;
let accepted = 0;
for (const site of sites) {
  const domain = domainOf(site);
  let reason = 'no domain';
  if (domain) {
    try {
      reason = describe(await sendOne(domain));
    } catch (error) {
      reason = error.message || 'request failed';
    }
  }
  done += 1;
  if (reason === 'accepted') accepted += 1;
  console.log(`${done} of ${total} — ${domain || site.candidateId} ${reason}`);
}

console.log(`Finished ${done} of ${total}. Accepted ${accepted}.`);
process.exit(accepted === total ? 0 : 1);
