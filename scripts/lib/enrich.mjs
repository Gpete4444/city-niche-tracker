import {
  dataForSeoRequest,
  isDirectoryDomain,
  registrableDomain,
  taskResult,
} from './dataforseo.mjs';
import { classifyPageStrength, fetchPageSignals } from './page-heuristics.mjs';
import { applyEnrichmentToScoring, scoreDisplaceability } from './scoring.mjs';

export async function fetchBacklinksSummary(target) {
  const json = await dataForSeoRequest(
    '/backlinks/summary/live',
    {
      target,
      include_subdomains: true,
      rank_scale: 'one_hundred',
    },
    { retries: 3, label: `backlinks:${target}` },
  );
  const { result, cost } = taskResult(json, `backlinks:${target}`);
  const row = result?.[0] ?? {};
  return {
    cost,
    target,
    rank: row.rank ?? null,
    backlinks: row.backlinks ?? null,
    referringDomains: row.referring_domains ?? null,
    referringMainDomains: row.referring_main_domains ?? null,
    spamScore: row.spam_score ?? null,
  };
}

function collectTargets(research) {
  const pages = [];
  const normalize = (entry) => {
    if (!entry) return null;
    if (typeof entry === 'string') {
      return {
        title: null,
        url: entry,
        domain: registrableDomain(entry),
        rankAbsolute: null,
      };
    }
    if (!entry.url) return null;
    return {
      title: entry.title ?? null,
      url: entry.url,
      domain: entry.domain || registrableDomain(entry.url),
      rankAbsolute: entry.rankAbsolute ?? null,
    };
  };

  const push = (raw, kind) => {
    const entry = normalize(raw);
    if (!entry?.url) return;
    if (!entry.domain || isDirectoryDomain(entry.domain)) return;
    pages.push({ kind, ...entry });
  };

  for (const entry of research.serp?.organicHomePages?.links ?? []) push(entry, 'organic_homepage');
  for (const entry of research.serp?.organicSubPages?.links ?? []) push(entry, 'organic_subpage');
  for (const entry of research.serp?.localPack ?? []) {
    if (entry.url) push(entry, 'map_pack');
  }

  const seen = new Set();
  const uniquePages = [];
  for (const page of pages) {
    const key = page.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniquePages.push(page);
  }

  const domains = [...new Set(uniquePages.map((p) => p.domain))];
  return { pages: uniquePages, domains };
}

function extractPaidAndMapPackExtras(research) {
  const paidFromSerp = research.serp?.paidAds;
  const paidPresent =
    (paidFromSerp?.count ?? 0) > 0 ||
    (research.serp?.itemTypes ?? []).some((t) => /paid|ads?/i.test(String(t)));
  const mapPackStrength = (research.serp?.localPack ?? []).map((b) => ({
    title: b.title ?? null,
    url: b.url ?? null,
    domain: b.domain ?? null,
    rating: b.rating ?? null,
    reviewsCount: b.reviewsCount ?? null,
  }));
  return {
    paidAdsPresentOnSerp: paidPresent,
    paidAds: paidFromSerp ?? { count: 0, links: [] },
    mapPackStrength,
  };
}

function keywordIntentMix(keywords = []) {
  const withCpc = keywords.filter((k) => k.cpc != null);
  const highAds = keywords.filter((k) => String(k.competition).toUpperCase() === 'HIGH');
  return {
    keywordCount: keywords.length,
    withCpcCount: withCpc.length,
    highAdsCompetitionCount: highAds.length,
    shareHighAdsCompetition:
      keywords.length === 0 ? null : Number((highAds.length / keywords.length).toFixed(2)),
    avgCpc:
      withCpc.length === 0
        ? null
        : Number((withCpc.reduce((s, k) => s + Number(k.cpc), 0) / withCpc.length).toFixed(2)),
  };
}

function volumeConcentration(volumes = {}) {
  const primary = volumes.primaryVolumeSum ?? 0;
  const cluster = volumes.clusterVolumeSum ?? 0;
  return {
    primaryVolumeSum: primary,
    clusterVolumeSum: cluster,
    primaryShareOfCluster:
      cluster > 0 ? Number((primary / cluster).toFixed(2)) : null,
    note:
      cluster > 0 && primary / cluster >= 0.7
        ? 'Demand concentrated in primary city — location pages help but metro-core keywords matter most.'
        : 'Demand more distributed across measured cluster cities.',
  };
}

/**
 * Stage 2 enrichment against an existing Stage 1 research JSON.
 */
export async function enrichResearchReport(research, { includeMapPackPages = true } = {}) {
  const niche = research.niche ?? '';
  const { pages: allPages, domains } = collectTargets(research);
  const pages = includeMapPackPages
    ? allPages
    : allPages.filter((p) => p.kind !== 'map_pack');

  let totalCost = 0;
  const domainStats = {};

  for (const domain of domains) {
    console.error(`Backlinks domain Rank @ ${domain}`);
    try {
      const summary = await fetchBacklinksSummary(domain);
      totalCost += summary.cost;
      domainStats[domain] = summary;
    } catch (error) {
      console.error(`Backlinks failed for ${domain}: ${error.message}`);
      domainStats[domain] = {
        target: domain,
        rank: null,
        backlinks: null,
        referringDomains: null,
        referringMainDomains: null,
        spamScore: null,
        error: error.message,
      };
    }
  }

  const pageRows = [];
  for (const page of pages) {
    console.error(`Page enrich @ ${page.url}`);
    let pageSummary = {
      rank: null,
      referringDomains: null,
      backlinks: null,
      error: null,
    };
    try {
      // Prefer path-inclusive target without protocol for page-level Rank
      const pageTarget = page.url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
      const summary = await fetchBacklinksSummary(pageTarget);
      totalCost += summary.cost;
      pageSummary = summary;
    } catch (error) {
      pageSummary.error = error.message;
      console.error(`Page Rank failed for ${page.url}: ${error.message}`);
    }

    const signals = await fetchPageSignals(page.url, { niche, retries: 1 });
    const domainRank = domainStats[page.domain]?.rank ?? null;
    const pageRank = pageSummary.rank ?? null;
    const strength = classifyPageStrength(signals, { domainRank, pageRank });

    pageRows.push({
      kind: page.kind,
      title: page.title,
      url: page.url,
      domain: page.domain,
      domainRank,
      pageRank,
      referringDomains: pageSummary.referringDomains ?? domainStats[page.domain]?.referringDomains ?? null,
      domainReferringDomains: domainStats[page.domain]?.referringDomains ?? null,
      backlinksToPage: pageSummary.backlinks ?? null,
      thinnessScore: strength.thinnessScore,
      strengthLabel: strength.strengthLabel,
      fetchFailed: Boolean(strength.fetchFailed || signals.fetchFailed),
      signals: {
        urlLooksLikeLocationStub: signals.urlLooksLikeLocationStub,
        wordCount: signals.wordCount,
        title: signals.title,
        h1: signals.h1,
        titleHasNiche: signals.titleHasNiche,
        h1HasNiche: signals.h1HasNiche,
        schemaTypes: signals.schemaTypes,
        internalLinkCount: signals.internalLinkCount,
        looksMultiLocation: signals.looksMultiLocation,
        fetched: signals.fetched,
        fetchFailed: signals.fetchFailed,
        fetchError: signals.error,
      },
      notes: strength.notes,
    });
  }

  const organicRows = pageRows.filter((p) => p.kind !== 'map_pack');
  const displaceability = scoreDisplaceability(organicRows);
  const fetchFailedCount = organicRows.filter((p) => p.fetchFailed).length;

  const extrasPaid = extractPaidAndMapPackExtras(research);
  const directoriesTop3 = (research.serp?.directories?.links ?? [])
    .map((l) => (typeof l === 'string' ? l : l?.url))
    .filter(Boolean)
    .slice(0, 3);
  const directoryDominance = {
    directoryCount: research.serp?.directories?.count ?? directoriesTop3.length,
    topDirectories: directoriesTop3,
    angiOrYelpPresent: directoriesTop3.some((u) => /angi\.com|yelp\.com/i.test(String(u))),
  };

  const enrichment = {
    generatedAt: new Date().toISOString(),
    metricDisclaimer:
      'DataForSEO Rank is a 0–100 backlink-based authority score. It is NOT Moz Domain Authority or Ahrefs Domain Rating.',
    domains: domainStats,
    pages: pageRows,
    displaceability,
    fetchFailedCount,
    extras: {
      paidAdsPresentOnSerp: extrasPaid.paidAdsPresentOnSerp,
      paidAds: extrasPaid.paidAds,
      mapPackStrength: extrasPaid.mapPackStrength,
      directoryDominance,
      keywordIntentMix: keywordIntentMix(research.volumes?.keywords ?? []),
      volumeConcentration: volumeConcentration(research.volumes ?? {}),
    },
    estimatedApiCostUsd: Number(totalCost.toFixed(5)),
  };

  const scoring = applyEnrichmentToScoring(research, enrichment);

  return {
    report: {
      ...research,
      enrichment,
      scoring,
      scoreInputs: scoring.scoreInputs,
      proposedScore: scoring.proposedScore,
      decision: scoring.decision,
      estimatedApiCostUsd: Number(
        ((research.estimatedApiCostUsd ?? 0) + totalCost).toFixed(5),
      ),
      nextStep:
        scoring.decision?.decision === 'pursue' || scoring.decision?.decision === 'maybe'
          ? 'Candidate looks buildable. Optionally run npm run prospect-renters, then prompts/claude-site-config.md.'
          : 'Review enrichment.displaceability and competitor page table before site-config. Do not invent Rank or word counts.',
    },
    enrichCost: totalCost,
  };
}
