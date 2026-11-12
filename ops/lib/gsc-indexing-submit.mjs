/**
 * Indexing step: verify a Domain property with a Cloudflare DNS TXT record,
 * add sc-domain:{host} in Search Console, and submit sitemap.xml once.
 */
import { cfFetch, findZone, normalizeDomain } from './cloudflare-launch.mjs';
import {
  GSC_AUTH_REVOKED,
  GSC_SCOPE_INSUFFICIENT,
  getGscAuthStatus,
  gscFetch,
  gscFetchUrl,
  gscHasIndexingScopes,
  isGscInsufficientScope,
} from './gsc-oauth.mjs';

const VERIFY_ATTEMPTS = 6;
const VERIFY_WAIT_MS = 5000;

function indexingAuthError(auth) {
  if (!auth?.configured) {
    return Object.assign(
      new Error(
        'Set GOOGLE_GSC_CLIENT_ID and GOOGLE_GSC_CLIENT_SECRET in .env (Desktop OAuth client).',
      ),
      { status: 400 },
    );
  }
  if (!auth.connected) {
    return Object.assign(new Error('GSC not connected — use Connect Google on Launched Sites'), {
      status: 401,
      code: GSC_AUTH_REVOKED,
    });
  }
  if (!gscHasIndexingScopes(auth.scope)) {
    return Object.assign(
      new Error('Search Console needs verify and sitemap access. Connect GSC again to grant it.'),
      { status: 403, code: GSC_SCOPE_INSUFFICIENT },
    );
  }
  return null;
}

export function mapGscScopeError(error) {
  if (!isGscInsufficientScope(error)) return error;
  return Object.assign(
    new Error('Search Console needs verify and sitemap access. Connect GSC again to grant it.'),
    { status: 403, code: GSC_SCOPE_INSUFFICIENT },
  );
}

export function isAlreadyVerifiedMessage(error) {
  return /already (an )?owner|already verified/i.test(String(error?.message || ''));
}

/** DNS has not published the token yet, or Google asked us to retry. */
export function isRetryableVerificationError(error) {
  if (!error) return false;
  if (error.code === GSC_AUTH_REVOKED || error.code === GSC_SCOPE_INSUFFICIENT) return false;
  if (isAlreadyVerifiedMessage(error)) return false;
  const status = Number(error.status);
  if (status === 401 || status === 403) return false;
  return status === 400 || status === 404 || status === 409 || status === 500 || status === 503;
}

export function sitemapListIncludes(sitemapsJson, sitemapUrl) {
  const want = String(sitemapUrl || '')
    .trim()
    .replace(/\/$/, '')
    .toLowerCase();
  if (!want) return false;
  const list = Array.isArray(sitemapsJson?.sitemap) ? sitemapsJson.sitemap : [];
  return list.some((row) => {
    const path = String(row?.path || '')
      .trim()
      .replace(/\/$/, '')
      .toLowerCase();
    return path === want;
  });
}

function txtContentMatches(recordContent, token) {
  const normalize = (value) =>
    String(value || '')
      .trim()
      .replace(/^"|"$/g, '');
  return normalize(recordContent) === normalize(token);
}

/**
 * Apex TXT for Google site verification. Leaves other TXT rows (SPF, and older tokens) in place.
 */
export async function ensureDnsTxtRecord({ zoneId, name, content, cf = cfFetch } = {}) {
  const token = String(content || '').trim();
  const recordName = String(name || '').trim();
  const id = String(zoneId || '').trim();
  if (!id || !recordName || !token) {
    throw Object.assign(new Error('DNS TXT record needs a zone, name, and token.'), { status: 400 });
  }
  const listed = await cf(
    'GET',
    `/zones/${id}/dns_records?type=TXT&name=${encodeURIComponent(recordName)}&per_page=100`,
  );
  const records = Array.isArray(listed) ? listed : [];
  const match = records.find((row) => txtContentMatches(row?.content, token));
  if (match) return { created: false, id: match.id || null };
  const created = await cf('POST', `/zones/${id}/dns_records`, {
    type: 'TXT',
    name: recordName,
    content: token,
    ttl: 120,
  });
  return { created: true, id: created?.id || null };
}

function realDomainHost(domain) {
  const host = normalizeDomain(domain);
  if (!host || host === 'example.com' || host.endsWith('.example.com') || /^tbd\b/i.test(host)) {
    return '';
  }
  return host;
}

/**
 * @param {string} domain
 * @param {object} [deps] test hooks
 */
export async function submitDomainToSearchConsole(domain, deps = {}) {
  const host = realDomainHost(domain);
  if (!host) {
    throw Object.assign(new Error('Set a real domain first.'), { status: 400 });
  }
  const authError = indexingAuthError(deps.authStatus || getGscAuthStatus());
  if (authError) throw authError;

  const gscUrl = deps.gscFetchUrl || gscFetchUrl;
  const gscPath = deps.gscFetch || gscFetch;
  const find = deps.findZone || findZone;
  const ensureTxt = deps.ensureDnsTxtRecord || ensureDnsTxtRecord;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const attempts = deps.verifyAttempts || VERIFY_ATTEMPTS;
  const waitMs = deps.verifyWaitMs ?? VERIFY_WAIT_MS;

  let tokenJson;
  try {
    tokenJson = await gscUrl('https://www.googleapis.com/siteVerification/v1/token', {
      method: 'POST',
      body: {
        verificationMethod: 'DNS_TXT',
        site: { type: 'INET_DOMAIN', identifier: host },
      },
    });
  } catch (error) {
    throw mapGscScopeError(error);
  }
  const token = String(tokenJson?.token || '').trim();
  if (!token) {
    throw Object.assign(new Error('Google did not return a DNS verification token.'), { status: 502 });
  }

  const zone = await find(host);
  if (!zone?.id) {
    throw Object.assign(
      new Error(`No Cloudflare zone for ${host}. Launch the domain before submitting to Search Console.`),
      { status: 400 },
    );
  }
  const dns = await ensureTxt({ zoneId: zone.id, name: host, content: token });

  let verified = false;
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await gscUrl(
        'https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=DNS_TXT',
        {
          method: 'POST',
          body: { site: { type: 'INET_DOMAIN', identifier: host } },
        },
      );
      verified = true;
      lastError = null;
      break;
    } catch (error) {
      const mapped = mapGscScopeError(error);
      if (isAlreadyVerifiedMessage(mapped)) {
        verified = true;
        lastError = null;
        break;
      }
      lastError = mapped;
      if (i < attempts - 1 && isRetryableVerificationError(mapped)) {
        await sleep(waitMs);
        continue;
      }
      break;
    }
  }
  if (!verified) {
    if (lastError?.code === GSC_SCOPE_INSUFFICIENT || lastError?.code === GSC_AUTH_REVOKED) {
      throw lastError;
    }
    const pending = /token/i.test(String(lastError?.message || ''));
    throw Object.assign(
      new Error(
        pending
          ? `Could not verify ${host} yet. DNS can take a few minutes — try Submit again.`
          : lastError?.message || `Could not verify ${host}.`,
      ),
      { status: lastError?.status || 502, code: lastError?.code },
    );
  }

  const siteUrl = `sc-domain:${host}`;
  const sitemapUrl = `https://${host}/sitemap.xml`;
  try {
    await gscPath(`/sites/${encodeURIComponent(siteUrl)}`, { method: 'PUT' });
  } catch (error) {
    throw mapGscScopeError(error);
  }

  let already = false;
  try {
    const listed = await gscPath(`/sites/${encodeURIComponent(siteUrl)}/sitemaps`);
    already = sitemapListIncludes(listed, sitemapUrl);
  } catch (error) {
    const mapped = mapGscScopeError(error);
    if (mapped.status !== 404) throw mapped;
  }
  if (!already) {
    try {
      await gscPath(`/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`, {
        method: 'PUT',
      });
    } catch (error) {
      throw mapGscScopeError(error);
    }
  }

  return {
    host,
    siteUrl,
    sitemapUrl,
    dnsCreated: Boolean(dns?.created),
    sitemapAlreadySubmitted: already,
    verified: true,
  };
}
