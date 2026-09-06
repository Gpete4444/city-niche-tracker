/**
 * Header API Cost snapshot: live wallets + pay-as-you-go configured flags.
 */
import { fetchUserBalance } from '../../scripts/lib/dataforseo.mjs';
import { fetchApifyPlanUsage } from './address-screen.mjs';
import { fetchTwilioBalance } from './phone-tracking-twilio.mjs';
import { getRoverApiSpend } from './rover-api-spend.mjs';

const APIFY_BASE = 'https://api.apify.com/v2';
const APIFY_LIFETIME_MONTH_CAP = 36;

function envSet(...keys) {
  return keys.every((k) => Boolean(String(process.env[k] || '').trim()));
}

function apifyMonthDate(monthsAgo) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
}

async function fetchApifyMonthSpend(token, date) {
  const res = await fetch(
    `${APIFY_BASE}/users/me/usage/monthly?date=${encodeURIComponent(date)}`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const data = json.data || json;
  const n = Number(
    data?.totalUsageCreditsUsdAfterVolumeDiscount ??
      data?.totalUsageCreditsUsdBeforeVolumeDiscount,
  );
  return Number.isFinite(n) ? n : 0;
}

/** Sum monthly Apify usage walking back. Not used by Address Find. */
let apifyLifetimeCache = { ready: false, value: null };

async function fetchApifyLifetimeSpend() {
  const token = String(process.env.APIFY_TOKEN || '').trim();
  if (!token) return null;
  let total = 0;
  let consecutiveEmpty = 0;
  for (let i = 0; i < APIFY_LIFETIME_MONTH_CAP; i += 1) {
    const spent = await fetchApifyMonthSpend(token, apifyMonthDate(i));
    if (spent == null || spent <= 0) {
      consecutiveEmpty += 1;
      if (consecutiveEmpty >= 2) break;
      continue;
    }
    consecutiveEmpty = 0;
    total += spent;
  }
  return Number(total.toFixed(6));
}

async function resolveApifyLifetimeSpend(fresh = false) {
  if (!fresh) return apifyLifetimeCache.ready ? apifyLifetimeCache.value : null;
  const value = await fetchApifyLifetimeSpend();
  apifyLifetimeCache = { ready: true, value };
  return value;
}

async function fetchDfsBalance() {
  const fetchedAt = new Date().toISOString();
  if (!envSet('DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD')) {
    return {
      ok: false,
      balance: null,
      spentAllTime: null,
      error: 'DataForSEO credentials missing',
      fetchedAt,
    };
  }
  try {
    const data = await fetchUserBalance();
    return { ok: true, ...data, error: null };
  } catch (error) {
    return {
      ok: false,
      balance: null,
      spentAllTime: null,
      error: error.message || String(error),
      fetchedAt,
    };
  }
}

const ANTHROPIC_API = 'https://api.anthropic.com/v1/organizations';

function anthropicAdminHeaders(adminKey) {
  return { 'x-api-key': adminKey, 'anthropic-version': '2023-06-01' };
}

/**
 * Try GET /v1/organizations/me — returns { current_spend, customer_limit } on
 * prepaid Console orgs. Not in official docs but returned by the Admin API.
 * Returns null when the endpoint 404s or the fields are missing.
 */
async function fetchAnthropicOrgBilling(adminKey) {
  try {
    const res = await fetch(`${ANTHROPIC_API}/me`, {
      headers: anthropicAdminHeaders(adminKey),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!json) return null;
    const spend = Number(json.current_spend);
    const limit = Number(json.customer_limit);
    if (Number.isFinite(spend) && Number.isFinite(limit) && limit > 0) {
      return { spend, limit };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fallback: sum month-to-date spend from the official Cost Report API.
 * Returns spend in USD or null on failure.
 */
async function fetchAnthropicCostReport(adminKey) {
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endingAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const params = new URLSearchParams({
    starting_at: startOfMonth.toISOString(),
    ending_at: endingAt.toISOString(),
    bucket_width: '1d',
    limit: '31',
  });
  const res = await fetch(`${ANTHROPIC_API}/cost_report?${params}`, {
    headers: anthropicAdminHeaders(adminKey),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic Admin API ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  let totalCents = 0;
  for (const bucket of json.data || []) {
    for (const result of bucket.results || []) {
      const amt = Number(result.amount);
      if (Number.isFinite(amt)) totalCents += amt;
    }
  }
  return Number((totalCents / 100).toFixed(6));
}

/**
 * Fetch Anthropic remaining credits and month-to-date spend.
 * Requires ANTHROPIC_ADMIN_KEY (sk-ant-admin01-…).
 *
 * 1. Try /v1/organizations/me → customer_limit − current_spend (automatic).
 * 2. Fall back to Cost Report + optional ANTHROPIC_CREDIT_BALANCE override.
 * 3. If neither yields a credit cap, balance is null (UI shows "—").
 */
async function fetchAnthropicBalance() {
  const fetchedAt = new Date().toISOString();
  const adminKey = String(process.env.ANTHROPIC_ADMIN_KEY || '').trim();
  if (!adminKey) {
    return { ok: false, balance: null, spentAllTime: null, error: 'ANTHROPIC_ADMIN_KEY not set', fetchedAt };
  }

  try {
    // Primary: billing endpoint with customer_limit / current_spend
    const billing = await fetchAnthropicOrgBilling(adminKey);
    if (billing) {
      return {
        ok: true,
        balance: Number((billing.limit - billing.spend).toFixed(2)),
        spentAllTime: Number(billing.spend.toFixed(6)),
        error: null,
        fetchedAt,
      };
    }

    // Fallback: Cost Report (official) + optional manual credit cap
    const spentUsd = await fetchAnthropicCostReport(adminKey);
    const creditEnv = String(process.env.ANTHROPIC_CREDIT_BALANCE || '').trim();
    const creditBalance = Number(creditEnv);
    const hasCredit = creditEnv && Number.isFinite(creditBalance) && creditBalance > 0;

    return {
      ok: true,
      balance: hasCredit ? Number((creditBalance - spentUsd).toFixed(2)) : null,
      spentAllTime: spentUsd,
      error: null,
      fetchedAt,
    };
  } catch (error) {
    return { ok: false, balance: null, spentAllTime: null, error: error.message || String(error), fetchedAt };
  }
}

function wrapSettled(result, fallback) {
  if (result.status === 'fulfilled') return result.value;
  return fallback(result.reason);
}

/**
 * @param {{ fresh?: boolean }} [opts]
 */
export async function getApiCostSnapshot({ fresh = false } = {}) {
  const fetchedAt = new Date().toISOString();
  const configured = {
    dataforseo: envSet('DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'),
    anthropic: envSet('ANTHROPIC_API_KEY'),
    openai: envSet('OPENAI_API_KEY'),
    googleMaps: envSet('GOOGLE_MAPS_API_KEY'),
    apify: envSet('APIFY_TOKEN'),
    twilio: envSet('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'),
    anthropicAdmin: envSet('ANTHROPIC_ADMIN_KEY'),
  };

  const [dfsR, apifyR, twilioR, apifyLifeR, anthropicR] = await Promise.allSettled([
    fetchDfsBalance(),
    fetchApifyPlanUsage(),
    fetchTwilioBalance(),
    resolveApifyLifetimeSpend(fresh),
    fetchAnthropicBalance(),
  ]);

  const apify = wrapSettled(apifyR, (reason) => ({
    ok: false,
    error: reason?.message || String(reason),
  }));
  const apifyLife = apifyLifeR.status === 'fulfilled' ? apifyLifeR.value : null;
  if (apify && typeof apify === 'object') {
    apify.spentAllTime = Number.isFinite(Number(apifyLife)) ? Number(apifyLife) : null;
  }

  return {
    ok: true,
    fetchedAt,
    configured,
    dfs: wrapSettled(dfsR, (reason) => ({
      ok: false,
      balance: null,
      spentAllTime: null,
      error: reason?.message || String(reason),
      fetchedAt,
    })),
    apify,
    twilio: wrapSettled(twilioR, (reason) => ({
      ok: false,
      configured: configured.twilio,
      balance: null,
      spentAllTime: null,
      currency: null,
      error: reason?.message || String(reason),
      fetchedAt,
    })),
    anthropic: wrapSettled(anthropicR, (reason) => ({
      ok: false,
      balance: null,
      spentAllTime: null,
      error: reason?.message || String(reason),
      fetchedAt,
    })),
    payg: getRoverApiSpend(),
  };
}
