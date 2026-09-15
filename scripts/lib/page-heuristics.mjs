/**
 * Lightweight HTML heuristics for competitor page thinness.
 * Not a guarantee of ranking outcomes — displaceability signal only.
 */

import { requestText } from './http-json.mjs';

const LOCATION_PATH_HINTS = [
  /\/locations?\//i,
  /\/service-areas?\//i,
  /\/areas?-we-serve\//i,
  /\/cities\//i,
  /\/near-me\//i,
];

const MULTI_CITY_HINTS = [
  /locations across/i,
  /serving \d+ (cities|locations)/i,
  /nationwide/i,
  /all \d+ states/i,
];

function stripTags(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(html, re) {
  const m = html.match(re);
  return m ? stripTags(m[1] || m[0]).trim() : null;
}

function extractJsonLdTypes(html) {
  const types = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1]);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const t = node?.['@type'];
        if (!t) continue;
        if (Array.isArray(t)) types.push(...t.map(String));
        else types.push(String(t));
        if (Array.isArray(node?.['@graph'])) {
          for (const g of node['@graph']) {
            if (g?.['@type']) {
              if (Array.isArray(g['@type'])) types.push(...g['@type'].map(String));
              else types.push(String(g['@type']));
            }
          }
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }
  return [...new Set(types)];
}

function tokenizeNiche(niche = '') {
  return String(niche)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !['the', 'and', 'for', 'near'].includes(t));
}

function textHasNiche(text, nicheTokens) {
  if (!text || nicheTokens.length === 0) return false;
  const hay = text.toLowerCase();
  const hits = nicheTokens.filter((t) => hay.includes(t));
  return hits.length >= Math.min(2, nicheTokens.length);
}

export { tokenizeNiche, textHasNiche };

export function urlLooksLikeLocationStub(url) {
  try {
    const { pathname } = new URL(url);
    if (LOCATION_PATH_HINTS.some((re) => re.test(pathname))) return true;
    // /louisville-ky/... or /louisville/...
    if (/\/[a-z-]+-(ky|oh|in|tn|tx|fl|ca|ny|wa|or|nc|sc|ga|al|ms|mo|il|mi|pa|va|md|co|az|nv)\b/i.test(pathname)) {
      return true;
    }
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length >= 2 && /louisville|jeffersontown|shively|matthews|suburb|city/i.test(pathname)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Fetch a URL and extract on-page signals. Failures return partial signals with error.
 * Retries once with short backoff on timeout / network errors.
 */
export async function fetchPageSignals(url, { niche = '', timeoutMs = 12000, retries = 1 } = {}) {
  const nicheTokens = tokenizeNiche(niche);
  const base = {
    url,
    fetched: false,
    fetchFailed: false,
    error: null,
    title: null,
    h1: null,
    wordCount: null,
    schemaTypes: [],
    internalLinkCount: null,
    urlLooksLikeLocationStub: urlLooksLikeLocationStub(url),
    titleHasNiche: false,
    h1HasNiche: false,
    looksMultiLocation: false,
  };

  let lastError = null;
  const attempts = Math.max(1, Number(retries) + 1);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
    try {
      const response = await requestText(url, {
        timeoutMs,
        headers: {
          'User-Agent': 'RankAndRentResearchBot/1.0 (+local research; contact via project owner)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const html = response.text;
      const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
      const h1 = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const bodyText = stripTags(html);
      const words = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
      let host;
      try {
        host = new URL(url).hostname.replace(/^www\./i, '');
      } catch {
        host = '';
      }
      const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
      const internalLinkCount = hrefs.filter((href) => {
        if (href.startsWith('/') && !href.startsWith('//')) return true;
        try {
          return new URL(href, url).hostname.replace(/^www\./i, '') === host;
        } catch {
          return false;
        }
      }).length;

      const schemaTypes = extractJsonLdTypes(html);
      const looksMultiLocation =
        MULTI_CITY_HINTS.some((re) => re.test(bodyText)) ||
        (hrefs.filter((h) => /location|service-area|cities/i.test(h)).length >= 8);

      return {
        ...base,
        fetched: true,
        fetchFailed: false,
        title,
        h1,
        wordCount: words,
        schemaTypes,
        internalLinkCount,
        titleHasNiche: textHasNiche(title, nicheTokens),
        h1HasNiche: textHasNiche(h1, nicheTokens),
        looksMultiLocation,
      };
    } catch (error) {
      lastError =
        error.name === 'TimeoutError' || /timeout/i.test(String(error.message || ''))
          ? 'timeout'
          : String(error.message || error);
    }
  }

  return {
    ...base,
    fetchFailed: true,
    error: lastError || 'fetch_failed',
  };
}

/**
 * thinnessScore 1–10 (higher = thinner / easier to displace).
 * strengthLabel: thin_stub | moderate | strong_niche_page
 */
export function classifyPageStrength(signals, { domainRank = null, pageRank = null } = {}) {
  if (signals.fetchFailed || (signals.fetched === false && signals.error)) {
    return {
      thinnessScore: null,
      strengthLabel: 'fetch_failed',
      notes: `fetch failed: ${signals.error || 'unknown'}`,
      fetchFailed: true,
    };
  }

  let thin = 5;

  if (signals.urlLooksLikeLocationStub) thin += 2;
  if (signals.wordCount != null) {
    if (signals.wordCount < 400) thin += 3;
    else if (signals.wordCount < 800) thin += 2;
    else if (signals.wordCount < 1200) thin += 1;
    else if (signals.wordCount > 2000) thin -= 2;
  }
  if (!signals.titleHasNiche) thin += 1;
  if (!signals.h1HasNiche) thin += 1;
  if (signals.looksMultiLocation) thin += 1;

  const schema = (signals.schemaTypes || []).map((t) => t.toLowerCase());
  if (schema.some((t) => t.includes('service') || t.includes('faqpage'))) thin -= 1;
  if (schema.some((t) => t === 'localbusiness' || t.includes('localbusiness')) && schema.length === 1) {
    thin += 0;
  }

  if (pageRank != null) {
    if (pageRank >= 40) thin -= 3;
    else if (pageRank >= 25) thin -= 2;
    else if (pageRank >= 15) thin -= 1;
  } else if (domainRank != null) {
    if (domainRank >= 50) thin -= 2;
    else if (domainRank >= 35) thin -= 1;
  }

  const thinnessScore = Math.max(1, Math.min(10, thin));
  let strengthLabel = 'moderate';
  if (thinnessScore >= 7) strengthLabel = 'thin_stub';
  else if (thinnessScore <= 3) strengthLabel = 'strong_niche_page';

  const notes = [];
  if (signals.urlLooksLikeLocationStub) notes.push('URL looks like a location/service-area stub');
  if (signals.wordCount != null) notes.push(`${signals.wordCount} words`);
  if (!signals.h1HasNiche) notes.push('H1 weak niche match');
  if (signals.looksMultiLocation) notes.push('multi-location template signals');
  if (domainRank != null) notes.push(`domainRank ${domainRank}`);
  if (pageRank != null) notes.push(`pageRank ${pageRank}`);
  if (signals.error) notes.push(`fetch: ${signals.error}`);

  return {
    thinnessScore,
    strengthLabel,
    notes: notes.join('; ') || 'scored',
  };
}
