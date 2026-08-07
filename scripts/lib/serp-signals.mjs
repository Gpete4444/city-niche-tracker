/**
 * Post-classify SERP signals: niche relevance, Map Pack reviews, SERP features.
 */

import { textHasNiche, tokenizeNiche } from './page-heuristics.mjs';

function annotateLink(entry, nicheTokens) {
  if (!entry || typeof entry !== 'object') return entry;
  const title = entry.title || '';
  const url = entry.url || '';
  const nicheRelevant = textHasNiche(`${title} ${url}`, nicheTokens);
  return { ...entry, nicheRelevant };
}

function annotateBucket(bucket, nicheTokens) {
  const links = (bucket?.links || []).map((l) => annotateLink(l, nicheTokens));
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
 */
export function annotateSerpNicheRelevance(classified, niche) {
  if (!classified) return classified;
  const nicheTokens = tokenizeNiche(niche);
  const organicHomePages = annotateBucket(classified.organicHomePages, nicheTokens);
  const organicSubPages = annotateBucket(classified.organicSubPages, nicheTokens);
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
  const mapPackReviews = summarizeMapPackReviews(withNiche?.localPack);
  const features = detectSerpFeatures(itemTypes, items);
  return {
    ...withNiche,
    mapPackReviews,
    features,
  };
}
