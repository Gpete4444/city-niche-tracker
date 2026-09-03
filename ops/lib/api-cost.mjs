/**
 * Header API Cost snapshot: live wallets + pay-as-you-go configured flags.
 */
import { fetchUserBalance } from '../../scripts/lib/dataforseo.mjs';
import { fetchApifyPlanUsage } from './address-screen.mjs';
import { getFalBalance } from './image-providers/flux.mjs';
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
    fal: envSet('FAL_KEY') || envSet('FAL_API_KEY'),
    falAdmin: envSet('FAL_ADMIN_KEY'),
    twilio: envSet('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'),
  };

  const [dfsR, falR, apifyR, twilioR, apifyLifeR] = await Promise.allSettled([
    fetchDfsBalance(),
    getFalBalance({ fresh }),
    fetchApifyPlanUsage(),
    fetchTwilioBalance(),
    fetchApifyLifetimeSpend(),
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
    fal: wrapSettled(falR, (reason) => ({
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
    payg: getRoverApiSpend(),
  };
}
