export const V15_PACKAGE1_SCREEN_PARAMETERS = Object.freeze({
  minDistinctOrganicDomainsForB: 7,
  minDistinctOrganicDomainsForC: 6,
});

export const V15_SCREEN_DECISIONS = Object.freeze({
  SCREEN_OUT: 'SCREEN_OUT',
  SURVIVE: 'SURVIVE',
});

const NON_LEAD_PATTERNS = Object.freeze({
  employment: /\b(job|jobs|career|careers|salary|salaries|employment|hiring|vacanc(?:y|ies))\b/i,
  reference: /\b(wikipedia|britannica|dictionary|definition|encyclopedia|what\s+is|meaning\s+of)\b/i,
  shopping: /\b(amazon|walmart|ebay|etsy|wayfair)\b|\b(add\s+to\s+cart|shop\s+now|buy\s+online|product\s+catalog)\b/i,
  video: /\b(youtube|youtu\.be|vimeo|tiktok)\b/i,
  productOnly: /\/products?\//i,
});

function asCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function normalizeParameters(parameters = {}) {
  const merged = { ...V15_PACKAGE1_SCREEN_PARAMETERS, ...parameters };
  for (const key of ['minDistinctOrganicDomainsForB', 'minDistinctOrganicDomainsForC']) {
    if (!Number.isInteger(merged[key]) || merged[key] < 1) throw new Error(`Invalid primary-SERP screen parameter: ${key}`);
  }
  return merged;
}

function classifyNonLeadOrganic(item = {}) {
  const text = [item.title, item.description, item.snippet, item.url, item.breadcrumb, item.website_name]
    .filter(Boolean).join(' ');
  for (const [category, pattern] of Object.entries(NON_LEAD_PATTERNS)) {
    if (pattern.test(text)) return category;
  }
  return null;
}

export function evaluateWrongIntentMajority(rawItems = []) {
  const organicItems = rawItems.filter((item) => String(item?.type ?? '').toLowerCase() === 'organic');
  const nonLeadItems = organicItems.map((item) => ({ item, category: classifyNonLeadOrganic(item) })).filter((row) => row.category);
  const categoryCounts = {};
  for (const row of nonLeadItems) categoryCounts[row.category] = (categoryCounts[row.category] ?? 0) + 1;
  const clearlyDominant = organicItems.length >= 4 && nonLeadItems.length > organicItems.length / 2;
  return {
    clearlyDominant,
    rawOrganicResultCount: organicItems.length,
    nonLeadOrganicResultCount: nonLeadItems.length,
    requiredMajorityCount: Math.floor(organicItems.length / 2) + 1,
    nonLeadCategoryCounts: categoryCounts,
    nonLeadExamples: nonLeadItems.slice(0, 5).map(({ item, category }) => ({ category, title: item.title ?? null, url: item.url ?? null })),
  };
}

export function visibleRecommendationForScreen(screenDecision) {
  if (screenDecision === V15_SCREEN_DECISIONS.SCREEN_OUT) return 'deprioritize';
  if (screenDecision === V15_SCREEN_DECISIONS.SURVIVE) return 'review';
  throw new Error(`Unknown primary-SERP screen decision: ${screenDecision}`);
}

export function evaluatePrimarySerpScreen({ classified, rawItems = [] } = {}, parameters = V15_PACKAGE1_SCREEN_PARAMETERS) {
  if (!classified || !Array.isArray(classified.uniqueOrganicDomains)) {
    throw new Error('Primary-SERP screen requires saved classified.uniqueOrganicDomains evidence');
  }
  const config = normalizeParameters(parameters);
  const wrongIntent = evaluateWrongIntentMajority(rawItems);
  const uniqueOrganicDomainCount = classified.uniqueOrganicDomains.length;
  const uniqueNicheOrganicDomainCount = Array.isArray(classified.uniqueNicheOrganicDomains)
    ? classified.uniqueNicheOrganicDomains.length : null;
  const paidCount = asCount(classified.paidAds?.count);
  const paidPresent = paidCount > 0 || classified.features?.paid === true;
  const lsaPresent = classified.features?.localServicesAds === true;
  const mapPackPresent = classified.mapPackPresent === true;
  const evidence = {
    uniqueOrganicDomainCount,
    uniqueNicheOrganicDomainCount,
    mapPackPresent,
    paidPresent,
    paidCount,
    lsaPresent,
    organicHomePageCount: asCount(classified.organicHomePages?.count),
    organicSubPageCount: asCount(classified.organicSubPages?.count),
    directoryCount: asCount(classified.directories?.count),
    wrongIntent,
  };

  let screenDecision = V15_SCREEN_DECISIONS.SURVIVE;
  let screenRule = 'NONE';
  let screenReason =
    `SURVIVE: ${uniqueOrganicDomainCount} distinct organic domains; no Package-1 hard screen-out rule fired`;
  if (wrongIntent.clearlyDominant) {
    screenDecision = V15_SCREEN_DECISIONS.SCREEN_OUT;
    screenRule = 'A';
    screenReason =
      `Rule A: clearly non-lead organic intent dominates ${wrongIntent.nonLeadOrganicResultCount}/${wrongIntent.rawOrganicResultCount} organic results`;
  } else if (
    uniqueOrganicDomainCount >= config.minDistinctOrganicDomainsForC
    && (paidPresent || lsaPresent)
  ) {
    const support = [
      paidPresent ? 'paid' : null,
      lsaPresent ? 'LSA' : null,
    ].filter(Boolean).join(' + ');
    screenReason =
      `SURVIVE: ${uniqueOrganicDomainCount} distinct organic domains >= ${config.minDistinctOrganicDomainsForC} with ${support} pressure; high organic diversity plus paid/LSA pressure is context only — review carefully`;
  } else if (
    uniqueOrganicDomainCount >= config.minDistinctOrganicDomainsForB
  ) {
    screenReason =
      `SURVIVE: ${uniqueOrganicDomainCount} distinct organic domains >= ${config.minDistinctOrganicDomainsForB}; high organic-domain diversity is context only and does not independently justify a hard stop`;
  }

  return {
    screenDecision,
    visibleRecommendedDecision: visibleRecommendationForScreen(screenDecision),
    screenRule,
    screenReason,
    parameters: config,
    evidence,
  };
}
