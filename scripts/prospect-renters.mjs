#!/usr/bin/env node
/**
 * Stage 3 renter prospecting (approved candidates only).
 * Finds local service businesses via Google Maps SERP + flags ads/directory signals.
 *
 * Usage:
 *   npm run prospect-renters -- --research research/louisville-trenchless.json
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  adsLocationName,
  dataForSeoRequest,
  isDirectoryDomain,
  loadEnvFile,
  registrableDomain,
  taskResult,
} from './lib/dataforseo.mjs';

loadEnvFile();

function usage() {
  console.log(`Usage:
  npm run prospect-renters -- --research research/louisville-trenchless.json
  npm run prospect-renters -- --research research/out.json --out research/out-prospects.json --limit 20

Stage 3 only — run after you decide to pursue/build. Not part of every research run.
`);
}

function parseArgs(argv) {
  const args = { research: '', out: '', limit: 20, queries: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === '--research') {
      args.research = next;
      i += 1;
    } else if (flag === '--out') {
      args.out = next;
      i += 1;
    } else if (flag === '--limit') {
      args.limit = Number(next) || 20;
      i += 1;
    } else if (flag === '--queries') {
      args.queries = String(next)
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      i += 1;
    } else if (flag === '--help' || flag === '-h') {
      usage();
      process.exit(0);
    }
  }
  if (!args.research) {
    usage();
    process.exit(1);
  }
  return args;
}

function reviewBand(count) {
  if (count == null) return 'unknown';
  if (count < 20) return 'small';
  if (count < 100) return 'medium';
  if (count < 300) return 'established';
  return 'large';
}

function sizeProxyLabel(band) {
  return {
    unknown: 'Size unknown — review count missing',
    small: 'Likely small operator (few reviews) — may be price-sensitive',
    medium: 'Mid-size local presence (review proxy, not headcount)',
    established: 'Established local brand (review proxy)',
    large: 'Large / multi-crew likely (review proxy) — may already dominate',
  }[band];
}

function scoreProspect(p, context) {
  let score = 5;
  const reasons = [];

  if (p.website) {
    score += 1;
    reasons.push('has website');
  } else {
    score -= 1;
    reasons.push('no website');
  }

  if (p.reviewBand === 'medium' || p.reviewBand === 'established') {
    score += 2;
    reasons.push('solid review presence');
  }
  if (p.reviewBand === 'large') {
    score -= 1;
    reasons.push('very large review footprint — may not need to rent');
  }
  if (p.reviewBand === 'small') {
    score += 0;
    reasons.push('small review footprint');
  }

  if (p.runningAds) {
    score += 2;
    reasons.push('appears in paid SERP — has ad budget');
  }
  if (p.directoryOnly) {
    score -= 1;
    reasons.push('directory-looking web presence');
  }
  if (p.ownsMapPackSlot) {
    score -= 2;
    reasons.push('already in Map Pack for niche query — weak rental fit');
  }
  if (p.ranksOrganicallyForNiche) {
    score -= 1;
    reasons.push('already ranks organically for niche');
  }
  if (p.website && !p.ranksOrganicallyForNiche && !p.ownsMapPackSlot) {
    score += 1;
    reasons.push('website but not dominating niche SERP — outreach candidate');
  }

  if (context.nicheTokens.some((t) => (p.category || '').toLowerCase().includes(t))) {
    score += 1;
    reasons.push('category aligns with niche');
  }

  score = Math.max(1, Math.min(10, score));
  let priority = 'medium';
  if (score >= 8) priority = 'high';
  else if (score <= 4) priority = 'low';

  return { outreachScore: score, outreachPriority: priority, reasons };
}

async function fetchMapsSerp(keyword, locationName, depth = 20) {
  const json = await dataForSeoRequest(
    '/serp/google/maps/live/advanced',
    {
      keyword,
      location_name: locationName,
      language_code: 'en',
      device: 'desktop',
      depth,
    },
    { retries: 3, label: `maps:${keyword}` },
  );
  const { result, cost } = taskResult(json, 'maps');
  const page = result?.[0] ?? {};
  return { cost, items: page.items ?? [], checkUrl: page.check_url ?? null };
}

function defaultQueries(research) {
  const city = research.primaryCity;
  const state = research.state;
  const niche = String(research.niche || '').trim();
  const queries = [];
  if (niche && city && state) {
    queries.push(`${niche} ${city} ${state}`);
  }
  const related = (research.volumes?.keywords || [])
    .map((k) => String(k.keyword || '').trim())
    .filter((k) => k && k.toLowerCase() !== niche.toLowerCase());
  for (const kw of related.slice(0, 2)) {
    if (city && state) queries.push(`${kw} ${city} ${state}`);
  }
  // Only add plumbing-generic queries when niche itself looks plumbing-related
  const nicheLower = niche.toLowerCase();
  const isPlumbing =
    /\b(plumb|sewer|drain|pipe|trenchless|water.?heater|toilet)\b/i.test(nicheLower);
  if (isPlumbing && city && state) {
    if (!/\bplumber\b/i.test(nicheLower)) queries.push(`plumber ${city} ${state}`);
    if (!/\bsewer\b/i.test(nicheLower)) queries.push(`sewer repair ${city} ${state}`);
  }
  return [...new Set(queries)].slice(0, 3);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const researchPath = path.resolve(args.research);
  const research = JSON.parse(readFileSync(researchPath, 'utf8'));
  const outPath = path.resolve(
    args.out ||
      researchPath.replace(/\.json$/i, '-prospects.json') ||
      path.join(path.dirname(researchPath), 'prospects.json'),
  );

  const locationName =
    research.volumes?.primaryLocation ||
    adsLocationName(research.primaryCity, research.state);
  const queries = args.queries.length > 0 ? args.queries : defaultQueries(research);
  const nicheTokens = String(research.niche || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3);

  const organicDomains = new Set(research.serp?.uniqueOrganicDomains ?? []);
  const mapPackDomains = new Set(
    (research.serp?.localPack ?? []).map((b) => b.domain).filter(Boolean),
  );
  const paidFromResearch = new Set(
    (research.serp?.paidAds?.links ?? research.enrichment?.extras?.paidAds?.links ?? [])
      .map((l) => l.domain || (l.url ? registrableDomain(l.url) : null))
      .filter(Boolean),
  );

  let totalCost = 0;
  const byDomain = new Map();

  for (const query of queries) {
    console.error(`Maps SERP: "${query}" @ ${locationName}`);
    try {
      const maps = await fetchMapsSerp(query, locationName, Math.min(args.limit, 20));
      totalCost += maps.cost;
      for (const item of maps.items) {
        if (item.type && item.type !== 'maps_search' && item.type !== 'local_pack') {
          // DataForSEO maps items are often type maps_search
        }
        const title = item.title ?? item.cid_info?.title ?? null;
        const domain = item.domain
          ? registrableDomain(item.domain)
          : item.url
            ? registrableDomain(item.url)
            : null;
        if (!title) continue;
        const key = domain || title.toLowerCase();
        const rating = item.rating?.value ?? item.rating ?? null;
        const reviewsCount = item.rating?.votes_count ?? item.reviews_count ?? null;
        const phone = item.phone ?? item.cid_info?.phone ?? null;
        const category = item.category ?? item.category_ids?.[0] ?? null;
        const address = item.address ?? item.cid_info?.address ?? null;
        const website =
          domain && !isDirectoryDomain(domain)
            ? item.url || `https://${domain}`
            : null;

        const existing = byDomain.get(key) ?? {
          name: title,
          domain,
          website,
          phone,
          address,
          category,
          rating,
          reviewsCount,
          sources: [],
        };
        existing.sources.push(query);
        existing.rating = existing.rating ?? rating;
        existing.reviewsCount = existing.reviewsCount ?? reviewsCount;
        existing.phone = existing.phone ?? phone;
        existing.address = existing.address ?? address;
        existing.category = existing.category ?? category;
        existing.website = existing.website ?? website;
        existing.domain = existing.domain ?? domain;
        byDomain.set(key, existing);
      }
    } catch (error) {
      console.error(`Maps failed for "${query}": ${error.message}`);
    }
  }

  // Reuse Stage 1 paidAds — do not re-fetch organic SERP (~$0.002 saved)
  console.error(
    `Paid ads: reusing Stage 1 research.serp.paidAds (${paidFromResearch.size} domain(s))`,
  );

  const prospects = [...byDomain.values()]
    .map((raw) => {
      const domain = raw.domain;
      const band = reviewBand(raw.reviewsCount);
      const prospect = {
        name: raw.name,
        domain,
        website: raw.website,
        phone: raw.phone,
        address: raw.address,
        category: raw.category,
        rating: raw.rating,
        reviewsCount: raw.reviewsCount,
        reviewBand: band,
        sizeProxy: sizeProxyLabel(band),
        sizeDisclaimer: 'Review-count bands are a size proxy only — not employee headcount.',
        runningAds: domain ? paidFromResearch.has(domain) : false,
        directoryOnly: domain ? isDirectoryDomain(domain) : false,
        ownsMapPackSlot: domain ? mapPackDomains.has(domain) : false,
        ranksOrganicallyForNiche: domain ? organicDomains.has(domain) : false,
        seenInQueries: [...new Set(raw.sources)],
      };
      const scored = scoreProspect(prospect, { nicheTokens });
      return { ...prospect, ...scored };
    })
    .sort((a, b) => b.outreachScore - a.outreachScore)
    .slice(0, args.limit);

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'dataforseo',
    stage: 'renter_prospecting',
    niche: research.niche,
    primaryCity: research.primaryCity,
    state: research.state,
    researchFile: path.relative(process.cwd(), researchPath),
    queries,
    prospectCount: prospects.length,
    prospects,
    summary: {
      highPriority: prospects.filter((p) => p.outreachPriority === 'high').length,
      mediumPriority: prospects.filter((p) => p.outreachPriority === 'medium').length,
      lowPriority: prospects.filter((p) => p.outreachPriority === 'low').length,
      runningAds: prospects.filter((p) => p.runningAds).length,
      inMapPack: prospects.filter((p) => p.ownsMapPackSlot).length,
    },
    estimatedApiCostUsd: Number(totalCost.toFixed(5)),
    nextStep:
      'Use high-priority prospects for outreach. Prefer businesses with websites + reviews that do not already own the niche Map Pack / organic SERP. Claude can draft outreach angles — do not invent review counts or ad flags.',
  };

  const json = `${JSON.stringify(report, null, 2)}\n`;
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, json, 'utf8');
  console.error(`Wrote ${outPath}`);
  console.error(
    `Prospects: ${report.prospectCount} (high ${report.summary.highPriority} / mid ${report.summary.mediumPriority} / low ${report.summary.lowPriority})`,
  );
  console.error(`Estimated DataForSEO cost: $${totalCost.toFixed(4)}`);
  process.stdout.write(json);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
