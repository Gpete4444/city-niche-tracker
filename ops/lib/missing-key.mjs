/**
 * When a step needs a key, the API returns code missing_key and the Account
 * setup field id. The dashboard opens that row.
 */
import { accountField } from './account-setup-catalog.mjs';

export function missingKeyError(fieldId) {
  const field = accountField(fieldId);
  const label = field?.label || 'A required value';
  const error = new Error(`${label} is not set. Open Account setup to add it.`);
  error.status = 400;
  error.code = 'missing_key';
  error.field = fieldId;
  return error;
}

function envSet(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function anySet(names) {
  return names.some((name) => envSet(name));
}

/**
 * @returns {string|null} Account setup field id, or null when this request
 * does not need a key check.
 */
export function missingFieldForRequest(method, requestPath) {
  const verb = String(method || 'GET').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return null;
  const path = String(requestPath || '');
  if (!path.startsWith('/api/')) return null;
  if (
    path.startsWith('/api/account-setup') ||
    path.startsWith('/api/account') ||
    path.startsWith('/api/health') ||
    path.startsWith('/api/concurrency') ||
    path.startsWith('/api/user-guide')
  ) {
    return null;
  }

  if (/\/images\/pull|\/images\/slots\/[^/]+\/repull|\/slots\/repull/.test(path)) {
    if (!anySet(['UNSPLASH_ACCESS_KEY', 'PEXELS_API_KEY', 'PIXABAY_API_KEY'])) return 'UNSPLASH_ACCESS_KEY';
    return null;
  }
  if (/generate-openai|before-after-generate-openai|\/openai-prompt/.test(path)) {
    if (!envSet('OPENAI_API_KEY')) return 'OPENAI_API_KEY';
    return null;
  }
  if (/address\/search/.test(path)) {
    if (!envSet('GOOGLE_MAPS_API_KEY')) return 'GOOGLE_MAPS_API_KEY';
    if (!envSet('APIFY_TOKEN')) return 'APIFY_TOKEN';
    return null;
  }
  if (
    /serp-probe|generate-pack|\/research$|\/enrich$|backfill-light-serp|\/rank|\/api\/discovery\/pack\b|\/process$/.test(
      path,
    )
  ) {
    if (!envSet('DATAFORSEO_LOGIN') || !envSet('DATAFORSEO_PASSWORD')) return 'DATAFORSEO_LOGIN';
    return null;
  }
  if (/\/api\/gsc|search-console|\/metrics/.test(path)) {
    if (!envSet('GOOGLE_GSC_CLIENT_ID')) return 'GOOGLE_GSC_CLIENT_ID';
    if (!envSet('GOOGLE_GSC_CLIENT_SECRET')) return 'GOOGLE_GSC_CLIENT_SECRET';
    return null;
  }
  if (/\/api\/phone|\/twilio/.test(path)) {
    if (!envSet('TWILIO_ACCOUNT_SID')) return 'TWILIO_ACCOUNT_SID';
    if (!envSet('TWILIO_AUTH_TOKEN')) return 'TWILIO_AUTH_TOKEN';
    if (!envSet('TWILIO_FORWARD_TO')) return 'TWILIO_FORWARD_TO';
    return null;
  }
  if (/\/launch\b|\/ship\b|\/assemble\b/.test(path)) {
    if (!envSet('CLOUDFLARE_ACCOUNT_ID')) return 'cloudflareAccountId';
    if (!envSet('CLOUDFLARE_API_TOKEN')) return 'CLOUDFLARE_API_TOKEN';
    if (!envSet('GITHUB_OWNER')) return 'githubOwner';
    if (!envSet('LEAD_NOTIFY_EMAIL') && !envSet('WEB3FORMS_DEFAULT_NOTIFY_EMAIL')) return 'leadNotifyEmail';
    return null;
  }
  if (/site-config\/generate|suggest-domains|\/narrative$|content\/write/.test(path)) {
    if (!envSet('ANTHROPIC_API_KEY')) return 'ANTHROPIC_API_KEY';
    return null;
  }
  return null;
}
