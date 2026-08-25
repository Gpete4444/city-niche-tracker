#!/usr/bin/env node
/**
 * DataForSEO candidate research:
 * - Google organic SERP → Map Pack + organic home/sub/directory counts
 * - Related keywords (Ads) for primary city
 * - Search volume for each cluster city, then sum + compare
 *
 * Usage:
 *   node scripts/research-candidate.mjs --niche "Trenchless Sewer Pipe Lining" --primary "Louisville,KY" --cluster "Jeffersontown,KY;St. Matthews,KY;Shively,KY" --related 10
 *
 * Requires DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in .env
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  adsLocationName,
  loadAdsLocations,
  loadEnvFile,
  resolveAdsLocation,
} from './lib/dataforseo.mjs';
import { fetchRelatedKeywords, fetchSearchVolumes, normalizeAdsMode } from './lib/ads-volume.mjs';
import { classifySerpItems, fetchOrganicSerp } from './lib/serp-classify.mjs';
import {
  classifiedToResearchSerp,
  isSerpCacheFresh,
  readSerpCache,
} from './lib/serp-cache.mjs';
import { averageKeywordCpc, enrichClassifiedSerp } from './lib/serp-signals.mjs';
import { applyEnrichmentToScoring, buildResearchScoring, shouldAutoEnrich, resolvePreservedJobFields, attachPreservedJobFields } from './lib/scoring.mjs';
import { enrichResearchReport } from './lib/enrich.mjs';

loadEnvFile();

function normalizeSerpUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\/$/, '')
    .toLowerCase();
}

/** Organic home + sub + directory landing URLs for enrichment staleness checks. */
function serpUrlSet(serp) {
  const urls = new Set();
  for (const bucket of [
    serp?.organicHomePages?.links,
    serp?.organicSubPages?.links,
    serp?.directories?.links,
  ]) {
    for (const link of bucket || []) {
      const raw = typeof link === 'string' ? link : link?.url;
      const key = normalizeSerpUrl(raw);
      if (key) urls.add(key);
    }
  }
  return urls;
}

function serpUrlSetsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const u of a) {
    if (!b.has(u)) return false;
  }
  return true;
}

/**
 * Never drop Stage 2 enrichment on Stage 1 rewrite. Mark stale when SERP URL set changes.
 */
function preservePriorEnrichment(report, priorResearch) {
  const prior = priorResearch?.enrichment;
  if (!prior || typeof prior !== 'object') return report;

  const urlsChanged = !serpUrlSetsEqual(serpUrlSet(priorResearch.serp), serpUrlSet(report.serp));
  const enrichment = {
    ...prior,
    stale: urlsChanged,
    staleReason: urlsChanged ? 'serp_urls_changed' : null,
    preservedFromStage1At: new Date().toISOString(),
  };
  if (!urlsChanged) {
    delete enrichment.staleReason;
    enrichment.stale = false;
  }

  report.enrichment = enrichment;
  report.scoring = applyEnrichmentToScoring(report, enrichment, priorResearch);
  report.scoreInputs = report.scoring.scoreInputs;
  report.proposedScore = report.scoring.proposedScore;
  report.decision = report.scoring.decision;

  if (urlsChanged) {
    console.error(
      'Stage 1: kept prior enrichment but marked stale (SERP organic/directory URLs changed). Re-run Enrich when ready.',
    );
  } else {
    console.error('Stage 1: preserved prior Stage 2 enrichment (SERP URLs unchanged).');
  }
  return report;
}

function usage() {
  console.log(`Usage (PowerShell-safe — prefer --config):

  # 1) Create research/louisville.json (see research/example-candidate.json)
  # 2) Run:
  npm run research-candidate -- --config research/louisville.json

Or flags (avoid ";" in PowerShell — it ends statements):
  npm run research-candidate -- --niche "Trenchless Sewer Pipe Lining" --primary "Louisville,KY" --cluster "Jeffersontown,KY|St. Matthews,KY|Shively,KY" --related 10 --out research/out.json

Ads volumes: --ads-mode live (default, faster) or --ads-mode standard (cheaper queue, slower).
SERP: reuses Discovery cache when --serp-cache is set (≤14 days). --force-serp refetches.
--volumes-only refreshes Ads volumes only (reuses SERP from existing --out research JSON).
Add --enrich for Stage 2 (DataForSEO Rank + page thinness + displaceability) in the same run.
Cluster cities: separate with | not ;
`);
}

function parseArgs(argv) {
  const args = {
    niche: '',
    primary: '',
    cluster: [],
    seeds: [],
    related: 10,
    out: '',
    skipVolumes: false,
    enrich: false,
    config: '',
    adsMode: 'live',
    serpCache: '',
    forceSerp: false,
    volumesOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === '--config') {
      args.config = next;
      i += 1;
    } else if (flag === '--niche') {
      args.niche = next;
      i += 1;
    } else if (flag === '--primary') {
      args.primary = next;
      i += 1;
    } else if (flag === '--cluster') {
      args.cluster = String(next)
        .split(/[|;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      i += 1;
    } else if (flag === '--seeds') {
      args.seeds = String(next)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      i += 1;
    } else if (flag === '--related') {
      args.related = Number(next) || 10;
      i += 1;
    } else if (flag === '--out') {
      args.out = next;
      i += 1;
    } else if (flag === '--ads-mode') {
      args.adsMode = normalizeAdsMode(next);
      i += 1;
    } else if (flag === '--serp-cache') {
      args.serpCache = next;
      i += 1;
    } else if (flag === '--force-serp') {
      args.forceSerp = true;
    } else if (flag === '--volumes-only') {
      args.volumesOnly = true;
    } else if (flag === '--skip-volumes') {
      args.skipVolumes = true;
    } else if (flag === '--enrich') {
      args.enrich = true;
    } else if (flag === '--help' || flag === '-h') {
      usage();
      process.exit(0);
    }
  }

  // CLI flags win over config file values when both are present (ops passes --out explicitly).
  const cliOut = args.out;
  const cliEnrich = args.enrich;
  const cliSkip = args.skipVolumes;
  const cliAdsMode = argv.includes('--ads-mode') ? args.adsMode : null;
  const cliSerpCache = argv.includes('--serp-cache') ? args.serpCache : null;
  const cliForceSerp = args.forceSerp;
  const cliVolumesOnly = args.volumesOnly;

  if (args.config) {
    const raw = JSON.parse(readFileSync(path.resolve(args.config), 'utf8'));
    args.niche = raw.niche ?? args.niche;
    args.primary = raw.primary ?? args.primary;
    args.cluster = raw.cluster ?? args.cluster;
    args.seeds = raw.seeds ?? args.seeds;
    args.related = raw.related ?? args.related;
    args.out = cliOut || raw.out || args.out;
    args.skipVolumes = cliSkip || raw.skipVolumes || false;
    args.enrich = cliEnrich || raw.enrich || false;
    args.adsMode = cliAdsMode || normalizeAdsMode(raw.adsMode ?? args.adsMode);
    args.serpCache = cliSerpCache || raw.serpCache || args.serpCache || '';
    args.forceSerp = cliForceSerp || Boolean(raw.forceSerp);
    args.volumesOnly = cliVolumesOnly || Boolean(raw.volumesOnly);
  } else {
    args.adsMode = normalizeAdsMode(args.adsMode);
  }

  if (!args.niche || !args.primary) {
    usage();
    process.exit(1);
  }

  if (args.niche.split(/\s+/).length === 1 && /pipe|sewer|concrete/i.test(args.niche) === false) {
    console.error(
      `Warning: niche looks like a single token ("${args.niche}"). On PowerShell, quotes are often stripped by npm — use --config instead.`,
    );
  }

  return args;
}

function parseCityState(value) {
  const match = String(value).match(/^(.+),\s*([A-Za-z]{2})$/);
  if (!match) {
    throw new Error(`Expected "City,ST" got "${value}"`);
  }
  return { city: match[1].trim(), state: match[2].trim().toUpperCase() };
}

function googleSearchLink(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

async function fetchSerp(keyword, locationName) {
  console.error(`SERP for "${keyword}" @ ${locationName}`);
  return fetchOrganicSerp(keyword, locationName);
}

function buildSpreadsheetFields(report) {
  const kwLines = report.volumes.keywords.map((k) => {
    const cluster = k.clusterSum ?? k.primaryVolume ?? 0;
    return `${k.keyword} (${cluster}/mo cluster sum)`;
  });

  const linkUrls = (links = []) =>
    links
      .map((l) => (typeof l === 'string' ? l : l?.url))
      .filter(Boolean)
      .join('\n');

  return {
    estClusterVolumeText: `${report.volumes.clusterVolumeSum} / mo (sum of city geos)`,
    topTargetKeywordsAndVolumesText: kwLines.join('\n'),
    mapPackText: report.serp.mapPackPresent ? 'Yes' : 'No',
    directoriesCount: report.serp.directories.count,
    organicHomePageCount: report.serp.organicHomePages.count,
    organicSubPageCount: report.serp.organicSubPages.count,
    directoriesLinksText: linkUrls(report.serp.directories.links),
    organicHomePageLinksText: linkUrls(report.serp.organicHomePages.links),
    organicSubPageLinksText: linkUrls(report.serp.organicSubPages.links),
    paidAdsCount: report.serp.paidAds?.count ?? 0,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const primary = parseCityState(args.primary);
  const cluster = args.cluster.map(parseCityState);
  const allCities = [primary, ...cluster.filter((c) => !(c.city === primary.city && c.state === primary.state))];

  const niche = args.niche.trim();
  const query = `${niche} ${primary.city} ${primary.state}`;
  const primaryLocation = adsLocationName(primary.city, primary.state);
  const seeds =
    args.seeds.length > 0
      ? args.seeds
      : [niche.toLowerCase(), `${niche.toLowerCase()} ${primary.city.toLowerCase()}`];

  let totalCost = 0;
  let serpRaw = null;
  let serp = null;
  let serpReused = false;
  let serpCacheAt = null;
  let priorResearch = null;

  const outPath = args.out ? path.resolve(args.out) : '';
  if (outPath && existsSync(outPath)) {
    try {
      priorResearch = JSON.parse(readFileSync(outPath, 'utf8'));
    } catch {
      priorResearch = null;
    }
  }

  if (args.volumesOnly && priorResearch?.serp) {
    console.error('SERP: volumes-only — reusing SERP from existing research file');
    serp = priorResearch.serp;
    serpRaw = {
      cost: 0,
      checkUrl: priorResearch.dataForSeoCheckUrl || null,
      itemTypes: priorResearch.serp.itemTypes || priorResearch.serp.features?.itemTypes || [],
      items: [],
      endpoint: 'volumes-only-reuse',
    };
    serpReused = true;
    serpCacheAt = priorResearch.serp.discoverySerpAt || priorResearch.generatedAt || null;
  }

  const cachePath = args.serpCache ? path.resolve(args.serpCache) : '';
  if (!serp && !args.forceSerp && cachePath) {
    const cache = readSerpCache(cachePath);
    if (isSerpCacheFresh(cache)) {
      console.error(`SERP: reusing Discovery cache ${cachePath} (probed ${cache.at})`);
      serp = cache.classified;
      serpRaw = {
        cost: 0,
        checkUrl: cache.checkUrl || null,
        itemTypes: cache.itemTypes || [],
        items: cache.items || [],
        endpoint: cache.endpoint || 'discovery-cache',
      };
      serpReused = true;
      serpCacheAt = cache.at;
    } else if (cache) {
      console.error(`SERP: Discovery cache stale or incomplete (${cachePath}) — fetching live`);
    } else if (existsSync(cachePath)) {
      console.error(`SERP: could not read cache ${cachePath} — fetching live`);
    }
  }

  if (!serp && !args.forceSerp && priorResearch?.serp) {
    console.error('SERP: reusing prior research SERP (no fresh Discovery cache)');
    serp = priorResearch.serp;
    serpRaw = {
      cost: 0,
      checkUrl: priorResearch.dataForSeoCheckUrl || null,
      itemTypes: priorResearch.serp.itemTypes || priorResearch.serp.features?.itemTypes || [],
      items: [],
      endpoint: 'prior-research-reuse',
    };
    serpReused = true;
    serpCacheAt = priorResearch.serp.discoverySerpAt || priorResearch.generatedAt || null;
  }

  if (!serp) {
    if (args.volumesOnly) {
      throw new Error(
        'volumes-only requires an existing research file with serp (run full Stage 1 once first)',
      );
    }
    console.error(`SERP: "${query}" @ ${primaryLocation}`);
    serpRaw = await fetchSerp(query, primaryLocation);
    totalCost += serpRaw.cost;
    serp = classifySerpItems(serpRaw.items);
  }

  // Cheap local re-annotate (niche / Map Pack website / EMD) — no API cost.
  serp = enrichClassifiedSerp(serp, {
    niche,
    itemTypes: serpRaw.itemTypes,
    items: serpRaw.items || [],
  });
  const nicheHomeCount =
    serp.organicHomePages?.nicheRelevantCount ?? serp.organicHomePages?.count ?? 0;
  const nicheDomainCount =
    serp.uniqueNicheOrganicDomains?.length ?? serp.uniqueOrganicDomains?.length ?? 0;

  let related = { cost: 0, ideas: [] };
  let keywords = [];
  const volumesByCity = [];
  const unsupportedCities = [];

  if (!args.skipVolumes) {
    const adsMode = normalizeAdsMode(args.adsMode);
    console.error(`Ads volume mode: ${adsMode}`);
    const adsLocations = await loadAdsLocations();
    const resolvedPrimary = resolveAdsLocation(adsLocations, primary.city, primary.state);
    if (!resolvedPrimary) {
      throw new Error(
        `Google Ads has no geo target for "${primary.city}, ${primary.state}". Use a larger city or county for --primary.`,
      );
    }

    console.error(`Related keywords @ ${resolvedPrimary.locationName} (seeds: ${seeds.join(', ')})`);
    related = await fetchRelatedKeywords(
      seeds,
      resolvedPrimary.locationCode,
      Math.max(args.related, 5),
      { mode: adsMode },
    );
    totalCost += related.cost;

    const seedExtras = seeds.map((s) => ({
      keyword: s,
      searchVolume: null,
      competition: null,
      competitionIndex: null,
      cpc: null,
    }));
    const merged = [...seedExtras, ...related.ideas];
    const deduped = [];
    const seen = new Set();
    for (const idea of merged) {
      const key = idea.keyword.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(idea);
    }
    const selected = deduped.slice(0, args.related);

    for (const place of allCities) {
      const resolved = resolveAdsLocation(adsLocations, place.city, place.state);
      if (!resolved) {
        console.error(
          `Skipping ${place.city}, ${place.state}: no Google Ads geo target (too small for Ads targeting).`,
        );
        unsupportedCities.push(`${place.city}, ${place.state}`);
        continue;
      }

      console.error(`Volumes @ ${resolved.locationName} (${selected.length} keywords)`);
      try {
        const vol = await fetchSearchVolumes(
          selected.map((k) => k.keyword),
          resolved.locationCode,
          { mode: adsMode },
        );
        totalCost += vol.cost;
        volumesByCity.push({
          city: place.city,
          state: place.state,
          locationName: resolved.locationName,
          locationCode: resolved.locationCode,
          keywords: vol.byKeyword,
        });
      } catch (error) {
        console.error(`Volumes failed for ${resolved.locationName}: ${error.message}`);
        unsupportedCities.push(`${place.city}, ${place.state}`);
      }
    }

    keywords = selected.map((idea) => {
      const perCity = {};
      let clusterSum = 0;
      let primaryVolume = null;
      for (const cityBlock of volumesByCity) {
        const row = cityBlock.keywords[idea.keyword.toLowerCase()];
        const volume = row?.searchVolume ?? 0;
        perCity[`${cityBlock.city}, ${cityBlock.state}`] = volume;
        clusterSum += volume;
        if (cityBlock.city === primary.city && cityBlock.state === primary.state) {
          primaryVolume = volume;
        }
      }
      return {
        keyword: idea.keyword,
        primaryVolume,
        clusterSum,
        perCity,
        competition: idea.competition,
        cpc: idea.cpc,
      };
    });
  }

  const clusterVolumeSum = keywords.reduce((sum, k) => sum + (k.clusterSum ?? 0), 0);
  const primaryVolumeSum = keywords.reduce((sum, k) => sum + (k.primaryVolume ?? 0), 0);

  const scoring = buildResearchScoring({
    clusterVolumeSum,
    mapPackPresent: serp.mapPackPresent,
    uniqueOrganicDomainCount: nicheDomainCount,
    organicHomePageCount: nicheHomeCount,
  });
  if (serp.features?.localServicesAds && scoring.scoreInputs) {
    scoring.scoreInputs.notes = `${scoring.scoreInputs.notes || ''} Local Services Ads present on SERP — organic/phone leads may sit below LSAs.`.trim();
  }
  const avgCpc = averageKeywordCpc(keywords);

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'dataforseo',
    niche,
    primaryCity: primary.city,
    state: primary.state,
    cityCluster: allCities.map((c) => `${c.city}, ${c.state}`),
    googleSearchQuery: query,
    googleSearchLink: googleSearchLink(query),
    dataForSeoCheckUrl: serpRaw.checkUrl,
    serp: classifiedToResearchSerp(serp, {
      itemTypes: serpRaw.itemTypes,
      reusedFrom: serpReused
        ? {
            at: serpCacheAt,
            cachePath: path.relative(process.cwd(), cachePath).replace(/\\/g, '/'),
          }
        : null,
    }),
    volumes: {
      mode: 'per_city_sum',
      adsMode: normalizeAdsMode(args.adsMode),
      primaryLocation,
      primaryVolumeSum,
      clusterVolumeSum,
      averageCpc: avgCpc,
      relatedIdeasFromPrimary: related.ideas,
      keywords,
      citiesMeasured: volumesByCity.map((block) => `${block.city}, ${block.state}`),
      citiesWithoutAdsGeoTarget: unsupportedCities,
      byCity: volumesByCity.map((block) => ({
        city: block.city,
        state: block.state,
        locationName: block.locationName,
        locationCode: block.locationCode,
        keywordVolumes: Object.fromEntries(
          Object.entries(block.keywords).map(([k, v]) => [k, v.searchVolume]),
        ),
      })),
    },
    scoring,
    scoreInputs: scoring.scoreInputs,
    proposedScore: scoring.proposedScore,
    decision: scoring.decision,
    spreadsheetFields: null,
    estimatedApiCostUsd: Number(totalCost.toFixed(5)),
    nextStep:
      'Paste this JSON into prompts/claude-candidate-research.md. Use scripts/lib/scoring-rubric.json for jobValue + proposedScore. Do not invent volumes or competitor counts.',
  };

  report.spreadsheetFields = buildSpreadsheetFields(report);

  if (args.enrich || shouldAutoEnrich(scoring)) {
    if (!args.enrich && shouldAutoEnrich(scoring)) {
      console.error(
        'Stage 1 suggests enrichment (mid+ demand + review/pursue/maybe). Pass --enrich to run Stage 2 in this invocation, or: npm run enrich-candidate -- --research <out.json>',
      );
    }
    if (args.enrich) {
      console.error('Running Stage 2 enrichment (--enrich)…');
      const { report: enriched, enrichCost } = await enrichResearchReport(report);
      Object.assign(report, enriched);
      totalCost += enrichCost;
    }
  }

  // Keep prior Stage 2 enrichment unless this run just fetched a fresh --enrich block.
  if (!args.enrich && priorResearch?.enrichment) {
    preservePriorEnrichment(report, priorResearch);
    report.spreadsheetFields = buildSpreadsheetFields(report);
  }

  // Never drop Narrative/Claude jobValue when Stage 1 rewrites research JSON.
  let narrative = null;
  if (args.out) {
    const narrPath = path.resolve(String(args.out).replace(/\.json$/i, '') + '-narrative.json');
    if (existsSync(narrPath)) {
      try {
        narrative = JSON.parse(readFileSync(narrPath, 'utf8'));
      } catch {
        narrative = null;
      }
    }
  }
  const jobFields = resolvePreservedJobFields({ priorResearch, narrative });
  if (jobFields.jobValue != null) {
    attachPreservedJobFields(report, jobFields);
    report.spreadsheetFields = buildSpreadsheetFields(report);
    console.error(`Stage 1: preserved jobValue=${jobFields.jobValue} from prior research/narrative.`);
  }

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) {
    const resolvedOut = path.resolve(args.out);
    mkdirSync(path.dirname(resolvedOut), { recursive: true });
    writeFileSync(resolvedOut, json, 'utf8');
    console.error(`Wrote ${resolvedOut}`);
  }
  process.stdout.write(json);
  console.error(`Estimated DataForSEO cost this run: $${totalCost.toFixed(4)}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
