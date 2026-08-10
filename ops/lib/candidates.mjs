import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { proposedScore as computeProposedScore } from '../../scripts/lib/scoring.mjs';
import {
  annotateSerpNicheRelevance,
  averageKeywordCpc,
  detectSerpFeatures,
  summarizeMapPackReviews,
} from '../../scripts/lib/serp-signals.mjs';
import { lookupPopulation } from './census.mjs';

const ROOT = process.cwd();
export const RESEARCH_DIR = path.join(ROOT, 'research');

function ensureResearchDir() {
  mkdirSync(RESEARCH_DIR, { recursive: true });
}

export function slugifyCandidate({ niche, primaryCity, state }) {
  const base = `${primaryCity}-${niche}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return base || `candidate-${Date.now()}`;
}

export function pathsFor(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('Invalid candidate id');
  return {
    id: safe,
    research: path.join(RESEARCH_DIR, `${safe}.json`),
    meta: path.join(RESEARCH_DIR, `${safe}.meta.json`),
    config: path.join(RESEARCH_DIR, `${safe}.config.json`),
    narrative: path.join(RESEARCH_DIR, `${safe}-narrative.json`),
    narrativeDraft: path.join(RESEARCH_DIR, `${safe}-narrative.draft.json`),
    discoverySeed: path.join(RESEARCH_DIR, `${safe}-discovery-seed.json`),
    approved: path.join(RESEARCH_DIR, `${safe}-approved.json`),
    siteConfigDraft: path.join(RESEARCH_DIR, `${safe}-site-config.draft.json`),
    siteConfig: path.join(RESEARCH_DIR, `${safe}-site-config.json`),
    contentDraft: path.join(RESEARCH_DIR, `${safe}-content.draft.json`),
    content: path.join(RESEARCH_DIR, `${safe}-content.json`),
    contentResearch: path.join(RESEARCH_DIR, `${safe}-content-research.json`),
    contentOutline: path.join(RESEARCH_DIR, `${safe}-content-outline.json`),
    contentBrief: path.join(RESEARCH_DIR, `${safe}-content-brief.json`),
    contentStructure: path.join(RESEARCH_DIR, `${safe}-content-structure.json`),
    contentOutlinePackage: path.join(RESEARCH_DIR, `${safe}-content-outline-package.json`),
    buildPackage: path.join(RESEARCH_DIR, `${safe}-build-package.json`),
    siteStaging: path.join(RESEARCH_DIR, safe, 'site-staging'),
    siteImages: path.join(RESEARCH_DIR, safe, 'site-images'),
    imagesManifest: path.join(RESEARCH_DIR, `${safe}-images-manifest.json`),
    imagesPullStatus: path.join(RESEARCH_DIR, `${safe}-images-pull.json`),
    prospects: path.join(RESEARCH_DIR, `${safe}-prospects.json`),
    prospectsDraft: path.join(RESEARCH_DIR, `${safe}-prospects.draft.json`),
  };
}

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureResearchDir();
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function defaultMeta(partial = {}) {
  return {
    id: partial.id ?? null,
    createdAt: partial.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    decision: partial.decision ?? null,
    decisionNotes: partial.decisionNotes ?? null,
    lastResearchAt: partial.lastResearchAt ?? null,
    lastEnrichAt: partial.lastEnrichAt ?? null,
    lastNarrativeAt: partial.lastNarrativeAt ?? null,
    lastProspectsAt: partial.lastProspectsAt ?? null,
    lastCosts: partial.lastCosts ?? {},
    lastJobId: partial.lastJobId ?? null,
    ...partial,
  };
}

export function loadMeta(id) {
  const p = pathsFor(id);
  return readJson(p.meta, defaultMeta({ id: p.id }));
}

export function saveMeta(id, patch = {}) {
  const current = loadMeta(id);
  const nextPatch = { ...patch };
  if (patch.lastCosts) {
    nextPatch.lastCosts = { ...(current.lastCosts || {}), ...patch.lastCosts };
  }
  const next = defaultMeta({ ...current, ...nextPatch, id: pathsFor(id).id });
  writeJson(pathsFor(id).meta, next);
  return next;
}

export function deriveStage(id) {
  const p = pathsFor(id);
  const hasResearch = existsSync(p.research);
  const research = hasResearch ? readJson(p.research) : null;
  const hasEnrichment = Boolean(research?.enrichment);
  const hasNarrative = existsSync(p.narrative);
  const hasDraft = existsSync(p.narrativeDraft);
  const hasProspects = existsSync(p.prospects);

  // Pipeline progress only — decision lives on meta separately
  let stage = 'new';
  if (hasResearch && !hasEnrichment) stage = 'researched';
  if (hasEnrichment) stage = 'enriched';
  if (hasDraft && !hasNarrative) stage = 'narrative_draft';
  if (hasNarrative) stage = 'narrative_accepted';
  if (hasProspects) stage = 'prospected';

  return {
    stage,
    hasConfig: existsSync(p.config),
    hasResearch,
    hasEnrichment,
    hasNarrativeDraft: hasDraft,
    hasNarrative,
    hasProspects,
    enrichmentRecommended: Boolean(research?.scoring?.enrichmentRecommended),
  };
}

export const CANDIDATE_DECISIONS = [
  'pursue',
  'deprioritize',
  'maybe',
  'pass',
  'hold',
  'pass_unless_gbp_angle',
  'review',
];

/** Ensure .config.json exists for legacy research files so Stage 1 can re-run. */
export function ensureConfigFromResearch(id) {
  const p = pathsFor(id);
  if (existsSync(p.config)) return readJson(p.config);
  const research = readJson(p.research);
  if (!research) return null;
  const config = {
    niche: research.niche,
    primary: `${research.primaryCity},${research.state}`,
    cluster: (research.cityCluster || [])
      .filter((c) => !c.startsWith(research.primaryCity))
      .map((c) => c.replace(', ', ',')),
    related: research.volumes?.keywords?.length || 10,
    out: path.relative(ROOT, p.research).replace(/\\/g, '/'),
  };
  writeJson(p.config, config);
  return config;
}

export function decisionGroupCounts(candidates = null) {
  const list = candidates || listCandidates();
  const counts = { __all: list.length, __undecided: 0 };
  for (const d of CANDIDATE_DECISIONS) counts[d] = 0;
  for (const c of list) {
    const d = c.decision;
    if (!d) counts.__undecided += 1;
    else if (counts[d] != null) counts[d] += 1;
    else counts[d] = 1;
  }
  return counts;
}

function summarizeResearch(research) {
  if (!research) return null;
  const inputs = research.scoring?.scoreInputs || {};
  const stored = research.proposedScore ?? research.scoring?.proposedScore ?? null;
  const displaceability =
    research.enrichment?.displaceability?.score ??
    inputs.displaceability ??
    null;
  const recomputed = computeProposedScore({
    demand: inputs.demand,
    competition: inputs.competition,
    jobValue: inputs.jobValue,
    mapPackGap: inputs.mapPackGap,
    displaceability,
  });
  const disp = research.enrichment?.displaceability || research.scoring?.displaceability || {};

  let serp = research.serp || {};
  const needsNiche =
    serp.organicHomePages?.nicheRelevantCount == null &&
    (serp.organicHomePages?.links?.length || serp.organicSubPages?.links?.length);
  if (needsNiche && research.niche) {
    serp = annotateSerpNicheRelevance(serp, research.niche);
  }
  const mapPackReviews =
    serp.mapPackReviews || summarizeMapPackReviews(serp.localPack || []);
  const features =
    serp.features || detectSerpFeatures(serp.itemTypes || [], []);

  const organicHome = serp.organicHomePages;
  const organicHomeCount = Array.isArray(organicHome)
    ? organicHome.length
    : organicHome?.count ?? organicHome?.links?.length ?? null;
  const organicHomeNicheCount =
    organicHome?.nicheRelevantCount ??
    (Array.isArray(organicHome?.links)
      ? organicHome.links.filter((l) => l.nicheRelevant).length
      : null);
  const organicSub = serp.organicSubPages;
  const organicSubCount = Array.isArray(organicSub)
    ? organicSub.length
    : organicSub?.count ?? organicSub?.links?.length ?? null;
  const organicSubNicheCount =
    organicSub?.nicheRelevantCount ??
    (Array.isArray(organicSub?.links)
      ? organicSub.links.filter((l) => l.nicheRelevant).length
      : null);

  const avgCpc =
    research.volumes?.averageCpc ?? averageKeywordCpc(research.volumes?.keywords || []);

  return {
    niche: research.niche ?? null,
    primaryCity: research.primaryCity ?? null,
    state: research.state ?? null,
    cityCluster: research.cityCluster ?? [],
    demandBand: research.scoring?.demandBand?.id ?? null,
    serpSoftness: research.scoring?.serpSoftness?.id ?? null,
    displaceability,
    displaceabilityBand: disp.band?.id ?? research.scoring?.displaceability?.band?.id ?? null,
    thinStubShare: disp.thinStubShare ?? null,
    strongNichePageShare: disp.strongNichePageShare ?? null,
    medianDomainRank: disp.medianDomainRank ?? null,
    decision: research.decision?.decision ?? research.scoring?.decision?.decision ?? null,
    proposedScore: recomputed ?? stored,
    overallProvisional: inputs.jobValue == null && recomputed != null,
    clusterVolumeSum: research.volumes?.clusterVolumeSum ?? null,
    averageCpc: avgCpc,
    mapPackPresent: serp.mapPackPresent ?? null,
    mapPackAvgReviews: mapPackReviews.avgReviews ?? null,
    mapPackMaxReviews: mapPackReviews.maxReviews ?? null,
    mapPackReviewsLabel: mapPackReviews.reviewsLabel ?? null,
    mapPackReviewCounts: mapPackReviews.reviewsBySlot ?? null,
    hasLocalServicesAds: features.localServicesAds ?? false,
    organicHomeCount,
    organicHomeNicheCount,
    organicSubCount,
    organicSubNicheCount,
    uniqueOrganicDomains: Array.isArray(serp.uniqueOrganicDomains)
      ? serp.uniqueOrganicDomains.length
      : serp.uniqueOrganicDomains?.length ?? null,
    estimatedApiCostUsd: research.estimatedApiCostUsd ?? null,
    ticketClass: research.scoring?.ticketClass ?? null,
    estTimeToRankMonths:
      research.scoring?.estTimeToRankMonths?.withGbp ??
      research.scoring?.estTimeToRankMonths ??
      null,
    scoreInputs: {
      demand: inputs.demand ?? null,
      competition: inputs.competition ?? null,
      jobValue: inputs.jobValue ?? null,
      mapPackGap: inputs.mapPackGap ?? null,
      displaceability,
    },
  };
}

function summarizeProspects(prospects) {
  if (!prospects) {
    return { prospectCount: null, highPriority: null };
  }
  return {
    prospectCount:
      prospects.prospectCount ??
      (Array.isArray(prospects.prospects) ? prospects.prospects.length : null),
    highPriority: prospects.summary?.highPriority ?? null,
  };
}

function formatJobCostRange(avg) {
  if (!avg || typeof avg !== 'object') return null;
  const low = Number(avg.low);
  const high = Number(avg.high);
  const mid = Number(avg.midpoint);
  if (Number.isFinite(low) && Number.isFinite(high)) {
    return `$${Math.round(low).toLocaleString('en-US')}-$${Math.round(high).toLocaleString('en-US')}`;
  }
  if (Number.isFinite(mid)) return `~$${Math.round(mid).toLocaleString('en-US')}`;
  return null;
}

export function listCandidates() {
  ensureResearchDir();
  const files = readdirSync(RESEARCH_DIR);
  const cleaned = new Set();

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    // Registry / index files living in research/ — not candidates.
    if (file === 'candidate-groups.json' || file === 'known-candidates.json') continue;
    if (file.endsWith('.meta.json') || file.endsWith('.config.json')) {
      cleaned.add(file.replace(/\.(meta|config)\.json$/, ''));
      continue;
    }
    if (file.endsWith('-narrative.draft.json')) {
      cleaned.add(file.replace(/-narrative\.draft\.json$/, ''));
      continue;
    }
    if (file.endsWith('-narrative.json')) {
      cleaned.add(file.replace(/-narrative\.json$/, ''));
      continue;
    }
    if (file.endsWith('-prospects.draft.json')) {
      cleaned.add(file.replace(/-prospects\.draft\.json$/, ''));
      continue;
    }
    if (file.endsWith('-prospects.json')) {
      cleaned.add(file.replace(/-prospects\.json$/, ''));
      continue;
    }
    cleaned.add(file.replace(/\.json$/, ''));
  }

  return [...cleaned]
    .sort()
    .map((id) => {
      const p = pathsFor(id);
      const research = readJson(p.research);
      const config = readJson(p.config);
      const meta = loadMeta(id);
      const prospects = readJson(p.prospects);
      const narrative = readJson(p.narrative);
      const stageInfo = deriveStage(id);
      const summary = summarizeResearch(research) || {
        niche: config?.niche ?? meta.niche ?? null,
        primaryCity: config?.primary?.split(',')[0]?.trim() ?? null,
        state: config?.primary?.split(',')[1]?.trim() ?? null,
        cityCluster: config?.cluster ?? [],
      };
      const prospectSummary = summarizeProspects(prospects);
      const city = summary.primaryCity;
      const state = summary.state;
      const population =
        research?.population ??
        meta.population ??
        (city && state ? lookupPopulation(city, state) : null);
      const jobCostText =
        formatJobCostRange(narrative?.averageJobCostUsd) ||
        formatJobCostRange(research?.averageJobCostUsd) ||
        null;
      return {
        id,
        ...summary,
        ...prospectSummary,
        population: population != null ? Number(population) : null,
        jobCostText,
        decisionNotes: meta.decisionNotes ?? null,
        stage: stageInfo.stage,
        stageFlags: stageInfo,
        decision: meta.decision ?? summary.decision ?? null,
        source: meta.source ?? null,
        lastCosts: meta.lastCosts ?? null,
        researchCostUsd: meta.lastCosts?.research ?? summary.estimatedApiCostUsd ?? null,
        meta,
        updatedAt: meta.updatedAt,
      };
    });
}

export function getCandidateDetail(id) {
  const p = pathsFor(id);
  if (
    !existsSync(p.research) &&
    !existsSync(p.config) &&
    !existsSync(p.meta) &&
    !existsSync(p.narrative) &&
    !existsSync(p.prospects)
  ) {
    const err = new Error(`Candidate not found: ${id}`);
    err.status = 404;
    throw err;
  }

  const research = readJson(p.research);
  const config = readJson(p.config);
  const meta = loadMeta(id);
  const narrative = readJson(p.narrative);
  const narrativeDraft = readJson(p.narrativeDraft);
  const discoverySeed = readJson(p.discoverySeed);
  const approved = readJson(p.approved);
  const siteConfigDraft = readJson(p.siteConfigDraft);
  const siteConfigAccepted = readJson(p.siteConfig);
  const contentDraft = readJson(p.contentDraft);
  const contentAccepted = readJson(p.content);
  const contentResearch = readJson(p.contentResearch);
  const contentOutline = readJson(p.contentOutline);
  const contentBrief = readJson(p.contentBrief);
  const contentStructure = readJson(p.contentStructure);
  const contentOutlinePackage = readJson(p.contentOutlinePackage);
  const buildPackage = readJson(p.buildPackage);
  const imagesManifest = readJson(p.imagesManifest);
  const prospects = readJson(p.prospects);
  const stageInfo = deriveStage(id);

  return {
    id: p.id,
    paths: Object.fromEntries(
      Object.entries(p).map(([k, v]) => [k, path.relative(ROOT, v).replace(/\\/g, '/')]),
    ),
    stage: stageInfo.stage,
    stageFlags: {
      ...stageInfo,
      hasApproved: Boolean(approved),
      hasSiteConfigDraft: Boolean(siteConfigDraft),
      hasSiteConfig: Boolean(siteConfigAccepted),
      hasContentDraft: Boolean(contentDraft),
      hasContent: Boolean(contentAccepted),
      hasContentResearch: Boolean(contentResearch),
      hasContentOutline: Boolean(contentOutline),
      hasContentBrief: Boolean(contentBrief),
      hasContentBriefConfirmed: Boolean(contentBrief?.status === 'confirmed'),
      hasContentStructure: Boolean(contentStructure),
      hasContentOutlinePackage: Boolean(contentOutlinePackage),
      hasContentOutlineConfirmed: Boolean(contentOutlinePackage?.status === 'confirmed'),
      hasBuildPackage: Boolean(buildPackage),
      hasImages: Boolean(imagesManifest?.files?.length),
    },
    meta,
    config,
    research,
    narrative,
    narrativeDraft,
    discoverySeed,
    approved,
    siteConfigDraft,
    siteConfig: siteConfigAccepted,
    contentDraft,
    content: contentAccepted,
    contentResearch,
    contentOutline,
    contentBrief,
    contentStructure,
    contentOutlinePackage,
    buildPackage,
    imagesManifest,
    prospects,
    summary: summarizeResearch(research),
  };
}

export function createCandidate({
  niche,
  primary,
  cluster = [],
  related = 10,
  seeds = [],
  id: requestedId,
  source = null,
  decision = null,
  decisionNotes = null,
  serpCache = null,
  discoverySeed = null,
}) {
  if (!niche || !primary) throw new Error('niche and primary (City,ST) are required');
  const [city, state] = String(primary).split(',').map((s) => s.trim());
  if (!city || !state) throw new Error('primary must look like "Louisville,KY"');

  let id = requestedId || slugifyCandidate({ niche, primaryCity: city, state });
  let p = pathsFor(id);
  if (existsSync(p.research) || existsSync(p.config)) {
    id = `${id}-${Date.now().toString(36).slice(-4)}`;
    p = pathsFor(id);
  }

  const config = {
    niche,
    primary: `${city},${state.toUpperCase()}`,
    cluster: Array.isArray(cluster) ? cluster : String(cluster).split(/[|;]/).map((s) => s.trim()).filter(Boolean),
    related: Number(related) || 10,
    seeds,
    out: path.relative(ROOT, p.research).replace(/\\/g, '/'),
  };
  if (serpCache) {
    config.serpCache = String(serpCache).replace(/\\/g, '/');
  }

  writeJson(p.config, config);
  if (discoverySeed && typeof discoverySeed === 'object') {
    writeJson(p.discoverySeed, discoverySeed);
  }
  const metaPatch = {
    id,
    createdAt: new Date().toISOString(),
    niche,
    primary: config.primary,
  };
  if (source) metaPatch.source = source;
  if (decision) {
    metaPatch.decision = decision;
    metaPatch.decisionNotes = decisionNotes ?? null;
  }
  saveMeta(id, metaPatch);
  bumpKnownCandidates();

  return { id, config, meta: loadMeta(id) };
}

export function saveNarrativeDraft(id, draft, extra = {}) {
  const p = pathsFor(id);
  writeJson(p.narrativeDraft, {
    ...draft,
    _ops: {
      savedAt: new Date().toISOString(),
      ...extra,
    },
  });
  saveMeta(id, { lastNarrativeAt: new Date().toISOString() });
  return readJson(p.narrativeDraft);
}

function mergeNarrativeIntoResearch(research, narrative) {
  if (!research || !narrative) return research;
  const scoring = narrative.scoring || {};
  const inputs = scoring.scoreInputs || {};
  const prior = research.scoring || {};
  const nextScoring = {
    ...prior,
    ...(scoring.ticketClass != null ? { ticketClass: scoring.ticketClass } : {}),
    ...(scoring.displaceabilityBand != null && typeof scoring.displaceabilityBand === 'object'
      ? { displaceabilityBand: scoring.displaceabilityBand }
      : {}),
    ...(scoring.decision ? { decision: scoring.decision } : {}),
    scoreInputs: {
      ...(prior.scoreInputs || {}),
      ...inputs,
    },
  };
  if (scoring.demandBand && typeof scoring.demandBand === 'object') {
    nextScoring.demandBand = scoring.demandBand;
  }
  if (scoring.serpSoftness && typeof scoring.serpSoftness === 'object') {
    nextScoring.serpSoftness = scoring.serpSoftness;
  }
  if (scoring.rubricVersion != null) nextScoring.rubricVersion = scoring.rubricVersion;

  const proposed =
    scoring.proposedScore ??
    computeProposedScore({
      demand: nextScoring.scoreInputs.demand,
      competition: nextScoring.scoreInputs.competition,
      jobValue: nextScoring.scoreInputs.jobValue,
      mapPackGap: nextScoring.scoreInputs.mapPackGap,
      displaceability: nextScoring.scoreInputs.displaceability,
    });
  if (proposed != null) nextScoring.proposedScore = proposed;

  return {
    ...research,
    scoring: nextScoring,
    scoreInputs: nextScoring.scoreInputs,
    proposedScore: nextScoring.proposedScore ?? research.proposedScore ?? null,
    decision: scoring.decision ?? research.decision ?? null,
    averageJobCostUsd: narrative.averageJobCostUsd ?? research.averageJobCostUsd ?? null,
    localPainPoints: narrative.localPainPoints ?? research.localPainPoints ?? null,
    suggestedServices: narrative.suggestedServices ?? research.suggestedServices ?? null,
    suggestedSuburbs: narrative.suggestedSuburbs ?? research.suggestedSuburbs ?? null,
    estTimeToRankMonths: narrative.estTimeToRankMonths ?? research.estTimeToRankMonths ?? null,
  };
}

/** Parse "$8,000 – $22,000" or similar into { low, high }. */
export function parseJobCostBandText(text) {
  if (!text) return null;
  const nums = String(text)
    .replace(/,/g, '')
    .match(/(\d+(?:\.\d+)?)/g);
  if (!nums?.length) return null;
  const vals = nums.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!vals.length) return null;
  if (vals.length === 1) return { low: vals[0], high: vals[0], midpoint: vals[0] };
  const low = Math.min(...vals);
  const high = Math.max(...vals);
  return { low, high, midpoint: (low + high) / 2 };
}

function jobCostMidpoint(avg) {
  if (!avg || typeof avg !== 'object') return null;
  if (avg.midpoint != null && Number.isFinite(Number(avg.midpoint))) return Number(avg.midpoint);
  const low = Number(avg.low);
  const high = Number(avg.high);
  if (Number.isFinite(low) && Number.isFinite(high)) return (low + high) / 2;
  if (Number.isFinite(low)) return low;
  if (Number.isFinite(high)) return high;
  return null;
}

/**
 * Validate narrative draft before Accept.
 * @returns {{ ok: true } | { ok: false, error: string, code?: string, details?: object }}
 */
export function validateNarrativeAccept(draft, discoverySeed = null, { allowJobCostOverride = false } = {}) {
  if (!draft || typeof draft !== 'object') {
    return { ok: false, error: 'Draft is empty or invalid', code: 'empty' };
  }
  if (draft.parseError) {
    return { ok: false, error: 'Draft has a parse error — fix JSON before Accept', code: 'parse' };
  }
  const avg = draft.averageJobCostUsd;
  const mid = jobCostMidpoint(avg);
  if (mid == null || mid <= 0) {
    return {
      ok: false,
      error: 'averageJobCostUsd (low/high/midpoint) is required before Accept',
      code: 'job_cost_missing',
    };
  }
  const jobVal = draft.scoring?.scoreInputs?.jobValue;
  if (jobVal == null || Number.isNaN(Number(jobVal))) {
    return {
      ok: false,
      error: 'scoring.scoreInputs.jobValue is required before Accept',
      code: 'job_value_missing',
    };
  }

  const seedBand =
    parseJobCostBandText(discoverySeed?.averageJobCostText) ||
    (discoverySeed?.averageJobCostUsd
      ? {
          low: Number(discoverySeed.averageJobCostUsd.low),
          high: Number(discoverySeed.averageJobCostUsd.high),
          midpoint: jobCostMidpoint(discoverySeed.averageJobCostUsd),
        }
      : null);

  if (seedBand?.low != null && seedBand?.high != null && Number.isFinite(seedBand.low)) {
    const lo = Math.min(seedBand.low, seedBand.high) * 0.5;
    const hi = Math.max(seedBand.low, seedBand.high) * 1.75;
    if (mid < lo || mid > hi) {
      const basis = String(avg.basis || draft.scoring?.decision?.summary || '').trim();
      if (!allowJobCostOverride && basis.length < 12) {
        return {
          ok: false,
          error: `Job cost midpoint $${Math.round(mid)} is outside Discovery seed band ~$${Math.round(seedBand.low)}–$${Math.round(seedBand.high)}. Add averageJobCostUsd.basis (≥12 chars) or pass allowJobCostOverride.`,
          code: 'job_cost_seed_mismatch',
          details: { mid, seedBand },
        };
      }
    }
  }

  return { ok: true, mid, seedBand };
}

export function buildApprovedPackage(id, narrative, research, meta = {}, discoverySeed = null) {
  return {
    generatedAt: new Date().toISOString(),
    candidateId: id,
    source: 'narrative_accept',
    decision: meta.decision ?? narrative?.scoring?.decision?.decision ?? null,
    niche: narrative?.niche ?? research?.niche ?? null,
    city: narrative?.city ?? research?.primaryCity ?? null,
    state: narrative?.state ?? research?.state ?? null,
    cityCluster: narrative?.cityCluster ?? research?.cityCluster ?? [],
    population: narrative?.population ?? research?.population ?? null,
    averageJobCostUsd: narrative?.averageJobCostUsd ?? null,
    estTimeToRankMonths: narrative?.estTimeToRankMonths ?? null,
    localPainPoints: narrative?.localPainPoints ?? null,
    suggestedServices: narrative?.suggestedServices ?? null,
    suggestedSuburbs: narrative?.suggestedSuburbs ?? null,
    scoring: narrative?.scoring ?? null,
    proposedScore: narrative?.scoring?.proposedScore ?? research?.proposedScore ?? null,
    discoverySeed: discoverySeed
      ? {
          averageJobCostText: discoverySeed.averageJobCostText ?? null,
          humanDecision: discoverySeed.humanDecision ?? null,
          batchId: discoverySeed.batchId ?? null,
        }
      : null,
    researchSummary: research
      ? {
          mapPackPresent: research.serp?.mapPackPresent ?? null,
          clusterVolumeSum: research.volumes?.clusterVolumeSum ?? null,
          averageCpc: research.volumes?.averageCpc ?? null,
          organicHomeCount: research.serp?.organicHomePages?.count ?? null,
          organicHomeNicheCount: research.serp?.organicHomePages?.nicheRelevantCount ?? null,
          hasLocalServicesAds: research.serp?.features?.localServicesAds ?? null,
          displaceability: research.enrichment?.displaceability?.score ?? null,
          medianDomainRank: research.enrichment?.displaceability?.medianDomainRank ?? null,
        }
      : null,
    narrative,
    researchRef: research ? path.relative(ROOT, pathsFor(id).research).replace(/\\/g, '/') : null,
  };
}

export function getApprovedPackage(id) {
  return readJson(pathsFor(id).approved);
}

export function acceptNarrative(id, { allowJobCostOverride = false } = {}) {
  const p = pathsFor(id);
  const draft = readJson(p.narrativeDraft);
  if (!draft) throw Object.assign(new Error('No narrative draft to accept'), { status: 400 });
  const discoverySeed = readJson(p.discoverySeed);
  const check = validateNarrativeAccept(draft, discoverySeed, { allowJobCostOverride });
  if (!check.ok) {
    throw Object.assign(new Error(check.error), {
      status: 400,
      code: check.code,
      details: check.details,
    });
  }

  const { _ops, ...clean } = draft;
  writeJson(p.narrative, {
    ...clean,
    _ops: {
      acceptedAt: new Date().toISOString(),
      fromDraft: true,
      source: _ops?.source ?? null,
      model: _ops?.model ?? null,
      jobCostMidpoint: check.mid,
      seedBand: check.seedBand,
      allowJobCostOverride: Boolean(allowJobCostOverride),
    },
  });
  if (existsSync(p.narrativeDraft)) unlinkSync(p.narrativeDraft);

  const research = readJson(p.research);
  if (research) {
    writeJson(p.research, mergeNarrativeIntoResearch(research, clean));
  }

  const decision = clean.scoring?.decision?.decision ?? null;
  const decisionNotes = clean.scoring?.decision?.summary ?? null;
  const metaPatch = { lastNarrativeAt: new Date().toISOString() };
  if (decision) {
    metaPatch.decision = decision;
    metaPatch.decisionNotes = decisionNotes;
  }
  const meta = saveMeta(id, metaPatch);

  const pack = buildApprovedPackage(id, clean, readJson(p.research), meta, discoverySeed);
  writeJson(p.approved, pack);
  saveMeta(id, { lastApprovedAt: new Date().toISOString() });

  return { narrative: readJson(p.narrative), approved: pack };
}

export function rejectNarrative(id) {
  const p = pathsFor(id);
  if (existsSync(p.narrativeDraft)) unlinkSync(p.narrativeDraft);
  saveMeta(id, { updatedAt: new Date().toISOString() });
  return { ok: true };
}

export function acceptNarratives(ids = [], opts = {}) {
  const accepted = [];
  const errors = [];
  for (const raw of ids) {
    const id = String(raw || '').trim();
    if (!id) continue;
    try {
      const result = acceptNarrative(id, opts);
      accepted.push({ id, ...result });
    } catch (error) {
      errors.push({ id, error: error.message, code: error.code || null });
    }
  }
  return { accepted, errors };
}

export function rejectNarratives(ids = []) {
  const rejected = [];
  const errors = [];
  for (const raw of ids) {
    const id = String(raw || '').trim();
    if (!id) continue;
    try {
      rejectNarrative(id);
      rejected.push(id);
    } catch (error) {
      errors.push({ id, error: error.message });
    }
  }
  return { rejected, errors };
}

export function setDecision(id, decision, notes = null) {
  if (!CANDIDATE_DECISIONS.includes(decision)) {
    throw new Error(`decision must be one of: ${CANDIDATE_DECISIONS.join(', ')}`);
  }
  const meta = saveMeta(id, { decision, decisionNotes: notes });
  bumpKnownCandidates();
  return meta;
}

export function setDecisions(ids = [], decision, notes = null) {
  if (!CANDIDATE_DECISIONS.includes(decision)) {
    throw new Error(`decision must be one of: ${CANDIDATE_DECISIONS.join(', ')}`);
  }
  const updated = [];
  const errors = [];
  for (const raw of ids) {
    const id = String(raw || '').trim();
    if (!id) continue;
    try {
      updated.push(setDecision(id, decision, notes));
    } catch (error) {
      errors.push({ id, error: error.message });
    }
  }
  bumpKnownCandidates();
  return { updated, errors, decision };
}

function bumpKnownCandidates() {
  import('./known-candidates.mjs')
    .then((m) => m.safeRegenerateKnownCandidates())
    .catch(() => {});
}

export function readPromptFile(relativePath) {
  const full = path.join(ROOT, relativePath);
  if (!existsSync(full)) throw new Error(`Prompt not found: ${relativePath}`);
  return readFileSync(full, 'utf8');
}

/** Extract first ```text ... ``` fence from a prompt markdown file. */
export function extractPromptTemplate(markdown) {
  const fence = markdown.match(/```text\r?\n([\s\S]*?)```/);
  if (!fence) throw new Error('No ```text prompt block found in markdown');
  return fence[1].trim();
}

export function buildCopyPrompt(id) {
  const detail = getCandidateDetail(id);
  if (!detail.research) throw new Error('No research JSON — run Stage 1 first');
  const md = readPromptFile('prompts/claude-candidate-research.md');
  const template = extractPromptTemplate(md);
  const seedBlock = detail.discoverySeed
    ? JSON.stringify(detail.discoverySeed, null, 2)
    : '(none — no Discovery Claude seed on this candidate)';
  const filled = template
    .replace(
      '{{PASTE_OUTPUT_OF_research_or_enrich_candidate}}',
      JSON.stringify(detail.research, null, 2),
    )
    .replace(
      '{{PASTE_OUTPUT_OF_npm_run_research-candidate}}',
      JSON.stringify(detail.research, null, 2),
    )
    .replace('{{DISCOVERY_NARRATIVE_SEED}}', seedBlock);
  return filled;
}
