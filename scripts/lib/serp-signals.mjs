/**
 * Post-classify SERP signals: niche relevance, Map Pack reviews, SERP features.
 */

import { textHasNiche, tokenizeNiche } from './page-heuristics.mjs';

/**
 * Exact-match-domain heuristic: niche tokens appear as contiguous substrings in the
 * registrable domain with hyphens/dots stripped (display flag only — not a score input).
 */
export function domainLooksEmd(domain, nicheTokens) {
  if (!domain || !nicheTokens?.length) return false;
  const hay = String(domain)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!hay) return false;
  const hits = nicheTokens.filter((t) => hay.includes(String(t).toLowerCase()));
  return hits.length >= Math.min(2, nicheTokens.length);
}

function annotateLink(entry, nicheTokens, { emd = false } = {}) {
  if (!entry || typeof entry !== 'object') return entry;
  const title = entry.title || '';
  const url = entry.url || '';
  const nicheRelevant = textHasNiche(`${title} ${url}`, nicheTokens);
  const next = { ...entry, nicheRelevant };
  if (emd) {
    next.looksEmd = domainLooksEmd(entry.domain || url, nicheTokens);
  }
  return next;
}

function annotateBucket(bucket, nicheTokens, { emd = false } = {}) {
  const links = (bucket?.links || []).map((l) => annotateLink(l, nicheTokens, { emd }));
  const nicheRelevantCount = links.filter((l) => l.nicheRelevant).length;
  return {
    ...(bucket || {}),
    count: bucket?.count ?? links.length,
    links,
    nicheRelevantCount,
  };
}

/**
 * Flag organic home/sub links as niche-relevant from title+URL tokens (SERP-time; no HTML fetch).
 * Both homepage and subpage links get looksEmd (Yes/No display flag).
 */
export function annotateSerpNicheRelevance(classified, niche) {
  if (!classified) return classified;
  const nicheTokens = tokenizeNiche(niche);
  const organicHomePages = annotateBucket(classified.organicHomePages, nicheTokens, { emd: true });
  const organicSubPages = annotateBucket(classified.organicSubPages, nicheTokens, { emd: true });
  const nicheDomains = new Set([
    ...organicHomePages.links.filter((l) => l.nicheRelevant).map((l) => l.domain),
    ...organicSubPages.links.filter((l) => l.nicheRelevant).map((l) => l.domain),
  ]);
  return {
    ...classified,
    organicHomePages,
    organicSubPages,
    uniqueNicheOrganicDomains: [...nicheDomains],
    nicheTokens,
  };
}

function annotateMapPackWebsites(localPack = []) {
  return (localPack || []).map((b) => {
    const url = b?.url ?? null;
    const hasWebsite = b?.hasWebsite != null ? Boolean(b.hasWebsite) : Boolean(url);
    return { ...b, url, hasWebsite };
  });
}

export function summarizeMapPackReviews(localPack = []) {
  const slots = localPack || [];
  const reviewsBySlot = slots.map((b) => {
    const n = Number(b.reviewsCount);
    return Number.isFinite(n) && n >= 0 ? n : null;
  });
  const reviews = reviewsBySlot.filter((n) => n != null);
  if (!reviews.length) {
    return {
      slotCount: slots.length,
      reviewSampleSize: 0,
      avgReviews: null,
      maxReviews: null,
      minReviews: null,
      reviewsBySlot,
      reviewsLabel: null,
    };
  }
  const sum = reviews.reduce((a, b) => a + b, 0);
  return {
    slotCount: slots.length,
    reviewSampleSize: reviews.length,
    avgReviews: Number((sum / reviews.length).toFixed(1)),
    maxReviews: Math.max(...reviews),
    minReviews: Math.min(...reviews),
    reviewsBySlot,
    reviewsLabel: reviewsBySlot.map((n) => (n == null ? '—' : String(n))).join('/'),
  };
}

/**
 * Detect SERP features from item_types and/or item.type values.
 */
export function detectSerpFeatures(itemTypes = [], items = []) {
  const types = new Set(
    [...(itemTypes || []), ...(items || []).map((i) => i?.type).filter(Boolean)].map((t) =>
      String(t).toLowerCase(),
    ),
  );
  const has = (...names) => names.some((n) => types.has(n));
  return {
    localServicesAds: has('local_services_ad', 'local_services_ads', 'google_local_services'),
    peopleAlsoAsk: has('people_also_ask'),
    googleReviews: has('google_reviews', 'perspectives'),
    paid: has('paid', 'paid_list'),
    itemTypes: [...types],
  };
}

/**
 * Extract People Also Ask question strings from DataForSEO organic items.
 * @param {any[]} items
 * @param {number} [limit=10]
 * @returns {string[]}
 */
export function extractPeopleAlsoAskQuestions(items = [], limit = 10) {
  const out = [];
  const seen = new Set();
  const push = (q) => {
    const t = String(q || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t || t.length < 8) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  const walk = (node, inPaa = false) => {
    if (!node || out.length >= limit) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, inPaa);
      return;
    }
    if (typeof node !== 'object') return;
    const type = String(node.type || '').toLowerCase();
    const paa =
      inPaa ||
      type === 'people_also_ask' ||
      type === 'people_also_ask_element' ||
      type.includes('people_also_ask');
    if (paa) {
      if (node.title) push(node.title);
      if (node.question) push(node.question);
      if (node.expanded_element?.title) push(node.expanded_element.title);
    }
    if (node.items) walk(node.items, paa);
    if (node.element) walk(node.element, paa);
    if (Array.isArray(node.elements)) walk(node.elements, paa);
  };

  walk(items, false);
  return out.slice(0, limit);
}

/**
 * Top organic result titles for outline phrasing cues.
 * Prefers classified home/sub links; falls back to raw organic items.
 * @param {{ organicHomePages?: any, organicSubPages?: any }} [classified]
 * @param {any[]} [items]
 * @param {number} [limit=10]
 * @returns {string[]}
 */
export function extractOrganicTitles(classified = {}, items = [], limit = 10) {
  const out = [];
  const seen = new Set();
  const push = (title) => {
    const t = String(title || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t || t.length < 6) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  for (const link of classified?.organicHomePages?.links || []) push(link.title);
  for (const link of classified?.organicSubPages?.links || []) {
    if (out.length >= limit) break;
    push(link.title);
  }
  if (out.length < limit) {
    for (const item of items || []) {
      if (out.length >= limit) break;
      if (String(item?.type || '').toLowerCase() !== 'organic') continue;
      push(item.title);
    }
  }
  return out.slice(0, limit);
}

export function averageKeywordCpc(keywords = []) {
  const vals = (keywords || [])
    .map((k) => Number(k.cpc))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!vals.length) return null;
  return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
}

/**
 * Apply niche + features + map-pack review summary onto a classified SERP object.
 */
export function enrichClassifiedSerp(classified, { niche = null, itemTypes = [], items = [] } = {}) {
  const withNiche = niche ? annotateSerpNicheRelevance(classified, niche) : classified;
  const localPack = annotateMapPackWebsites(withNiche?.localPack);
  const mapPackSlotCount = localPack.length;
  const mapPackWebsiteCount = localPack.filter((b) => b.hasWebsite).length;
  const mapPackReviews = summarizeMapPackReviews(localPack);
  const features = detectSerpFeatures(itemTypes, items);
  const peopleAlsoAskQuestions = extractPeopleAlsoAskQuestions(items);
  const organicTitles = extractOrganicTitles(withNiche, items);
  return {
    ...withNiche,
    localPack,
    mapPackSlotCount,
    mapPackWebsiteCount,
    mapPackNoWebsiteCount: mapPackSlotCount - mapPackWebsiteCount,
    mapPackReviews,
    features,
    peopleAlsoAskQuestions:
      peopleAlsoAskQuestions.length > 0
        ? peopleAlsoAskQuestions
        : classified?.peopleAlsoAskQuestions || [],
    organicTitles:
      organicTitles.length > 0 ? organicTitles : classified?.organicTitles || [],
  };
}
