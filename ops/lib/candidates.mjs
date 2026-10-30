import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import {
  computeDemandVolumeSum,
  proposedScore as computeProposedScore,
  scoreDemand,
} from '../../scripts/lib/scoring.mjs';
import { resolveEstimatedVolumeForSeed } from '../../scripts/lib/estimated-volume.mjs';
import { recommendCandidate } from './discovery-recommend.mjs';
import {
  annotateSerpNicheRelevance,
  averageKeywordCpc,
  detectSerpFeatures,
  summarizeMapPackReviews,
} from '../../scripts/lib/serp-signals.mjs';
import { lookupPopulation } from './census.mjs';
import { recordRoverApiSpend } from './rover-api-spend.mjs';
import { logoPromptDefaultsForConfig } from './logo-prompt.mjs';
import { normalizeCityStateCluster } from './city-state.mjs';
import { loadTwilioProvisionIndex } from './site-phone-index.mjs';
import {
  applyHomepageDesignedSectionLiftToFiles,
  stampHomepageLiftOnDraftOps,
} from './content-auto-fix.mjs';

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

const NICHE_ACRONYMS = new Set(['hvac', 'ac', 'llc', 'inc', 'seo', 'led', 'pvc']);

function titleCaseNichePiece(piece) {
  if (!piece) return piece;
  const lower = piece.toLowerCase();
  if (NICHE_ACRONYMS.has(lower)) return piece.toUpperCase();
  if (/^[A-Z]{2,}$/.test(piece)) return piece;
  if (/[A-Z]/.test(piece)) return piece;
  return piece.replace(/[a-z]/, (ch) => ch.toUpperCase());
}

/** First letter of each word (and hyphen part), including after an opening parenthesis. Existing capitals and short acronyms stay. */
export function titleCaseNiche(raw) {
  const s = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  return s
    .split(' ')
    .map((word) => word.split('-').map(titleCaseNichePiece).join('-'))
    .join(' ');
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
    contentFieldResearch: path.join(RESEARCH_DIR, `${safe}-content-field-research.json`),
    contentStructure: path.join(RESEARCH_DIR, `${safe}-content-structure.json`),
    contentOutlinePackage: path.join(RESEARCH_DIR, `${safe}-content-outline-package.json`),
    buildPackage: path.join(RESEARCH_DIR, `${safe}-build-package.json`),
    siteStaging: path.join(RESEARCH_DIR, safe, 'site-staging'),
    siteImages: path.join(RESEARCH_DIR, safe, 'site-images'),
    imagesManifest: path.join(RESEARCH_DIR, `${safe}-images-manifest.json`),
    imagesPullStatus: path.join(RESEARCH_DIR, `${safe}-images-pull.json`),
    imagesPlan: path.join(RESEARCH_DIR, `${safe}-images-plan.json`),
    baVariants: path.join(RESEARCH_DIR, `${safe}-ba-variants.json`),
    photoGroup: path.join(RESEARCH_DIR, `${safe}-photo-group.json`),
    openaiPrompts: path.join(RESEARCH_DIR, `${safe}-openai-prompts.json`),
    prospects: path.join(RESEARCH_DIR, `${safe}-prospects.json`),
    prospectsDraft: path.join(RESEARCH_DIR, `${safe}-prospects.draft.json`),
    businessAddress: path.join(RESEARCH_DIR, `${safe}-business-address.json`),
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

const LIST_CACHE_TTL_MS = 10_000;
let listCacheAt = 0;
/** @type {object[] | null} */
let listCacheRows = null;

/** List rows keep a slim meta — not logoVariants / coverage maps / job blobs. */
const LIST_META_KEYS = [
  'decision',
  'decisionNotes',
  'archivedAt',
  'updatedAt',
  'source',
  'lastCosts',
  'lastLaunchAt',
  'lastShipAt',
  'lastLaunchAttemptAt',
  'cloudflarePagesDone',
  'dnsDone',
  'emailRoutingDone',
  'formsDone',
  'lastServiceAreaAt',
  'phoneSkippedAt',
  'lastPhoneAt',
  'indexingDone',
  'lastAssembleAt',
  'lastSiteStagingAt',
];

export function invalidateCandidateListCache() {
  listCacheAt = 0;
  listCacheRows = null;
}

function slimListMeta(meta) {
  const src = meta && typeof meta === 'object' ? meta : {};
  const out = {};
  for (const k of LIST_META_KEYS) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  return out;
}

function writeJson(filePath, data) {
  ensureResearchDir();
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  invalidateCandidateListCache();
}

export function defaultMeta(partial = {}) {
  return {
    id: partial.id ?? null,
    createdAt: partial.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    decision: partial.decision ?? null,
    decisionNotes: partial.decisionNotes ?? null,
    archivedAt: partial.archivedAt ?? null,
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

/**
 * Meta patch for a launch or ship outcome.
 * The first success sets lastLaunchAt. A later success does not move it.
 * A failure records lastLaunchAttemptAt and leaves lastLaunchAt alone.
 * @param {object | null | undefined} meta
 * @param {{ ok?: boolean, at: string }} outcome
 */
export function launchStampPatch(meta, { ok, at }) {
  if (!ok) return { lastLaunchAttemptAt: at };
  if (meta?.lastLaunchAt) return {};
  return { lastLaunchAt: at };
}

/** Stamp lastPhoneAt / hasSitePhone from skip, persist, or portfolio Twilio (in-memory). */
function attachPhoneDone(meta, stageFlags, id, index) {
  const skipped = Boolean(meta?.phoneSkippedAt);
  const stamped = Boolean(meta?.lastPhoneAt);
  const fromIndex = index instanceof Map ? index.get(id) : null;
  const hasSitePhone = Boolean(skipped || stamped || fromIndex);
  const nextMeta = { ...(meta || {}) };
  if (!stamped && fromIndex) nextMeta.lastPhoneAt = fromIndex;
  return {
    meta: nextMeta,
    stageFlags: { ...(stageFlags || {}), hasSitePhone },
  };
}

/** Drop launch/ship bookkeeping so a test (or mis-pointed) candidate is Website again. Keeps content and staging. */
export function clearLaunchedBookkeeping(id, extra = {}) {
  return saveMeta(id, {
    lastLaunchAt: null,
    lastShipAt: null,
    lastLaunchAttemptAt: null,
    githubRepo: null,
    githubRepoUrl: null,
    cfProject: null,
    launchDomain: null,
    cloudflarePagesDone: false,
    dnsDone: false,
    emailRoutingDone: false,
    formsDone: false,
    assembledSitePath: null,
    assembledSiteSlug: null,
    indexingDone: false,
    lastAssembleAt: null,
    ...extra,
  });
}

/** Add to a lastCosts key (OpenAI image spend is cumulative; other keys are usually last-run). */
export function addLastCost(id, key, deltaUsd) {
  const name = String(key || '').trim();
  const delta = Number(deltaUsd);
  if (!name || !Number.isFinite(delta) || delta === 0) return loadMeta(id);
  const current = loadMeta(id);
  const prev = Number(current.lastCosts?.[name]) || 0;
  const next = Number((prev + delta).toFixed(6));
  if (name === 'openai' && delta > 0) recordRoverApiSpend('openai', delta);
  return saveMeta(id, { lastCosts: { [name]: next } });
}

/** True when Ads Planner volumes were measured (not the cheap SERP-seed hydrate). */
export function researchHasAdsVolumes(research) {
  const vols = research?.volumes;
  if (!vols || typeof vols !== 'object') return false;
  if (vols.volumesSkipped) return false;
  if (vols.adsLocationFallback?.kind === 'state') return false;
  if (vols.primaryVolumeSum != null && Number.isFinite(Number(vols.primaryVolumeSum))) return true;
  if (vols.demandVolumeSum != null && Number.isFinite(Number(vols.demandVolumeSum))) return true;
  if (vols.clusterVolumeSum != null && Number.isFinite(Number(vols.clusterVolumeSum))) return true;
  return Array.isArray(vols.keywords) && vols.keywords.length > 0;
}

export function deriveStage(id, researchOverride = undefined) {
  const p = pathsFor(id);
  const hasResearchFile =
    researchOverride !== undefined ? Boolean(researchOverride) : existsSync(p.research);
  const research =
    researchOverride !== undefined ? researchOverride : hasResearchFile ? readJson(p.research) : null;
  const hasResearch = Boolean(research);
  const hasVolumes = researchHasAdsVolumes(research);
  const hasEnrichment = Boolean(research?.enrichment);
  const hasNarrative = existsSync(p.narrative);
  const hasDraft = existsSync(p.narrativeDraft);
  const hasProspects = existsSync(p.prospects);
  const hasSiteConfig = existsSync(p.siteConfig);
  const hasContent = existsSync(p.content);

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
    hasVolumes,
    hasEnrichment,
    hasNarrativeDraft: hasDraft,
    hasNarrative,
    hasProspects,
    hasSiteConfig,
    hasContent,
    enrichmentRecommended: Boolean(research?.scoring?.enrichmentRecommended),
  };
}

/**
 * True once Eval 1 (SERP / Volume) or a later stage has run.
 * A discovery stub with only niche/city/state does not lock.
 */
export function isResearchEvalStarted(research, stageFlags = {}) {
  if (
    stageFlags.hasEnrichment ||
    stageFlags.hasNarrative ||
    stageFlags.hasNarrativeDraft ||
    stageFlags.hasProspects ||
    stageFlags.hasSiteConfig ||
    stageFlags.hasContent
  ) {
    return true;
  }
  if (!research || typeof research !== 'object') return false;
  return Boolean(
    research.serp ||
      research.volumes ||
      research.scoring ||
      research.enrichment,
  );
}

export function isCandidateNicheRenameLocked(id) {
  const flags = deriveStage(id);
  const research = flags.hasResearch ? readJson(pathsFor(id).research) : null;
  return isResearchEvalStarted(research, flags);
}

/**
 * Root niche rename. Does not change candidate id.
 * After Eval 1, require confirmAfterEval — label only; SERP/scores/photos/site-config stay.
 */
export function renameCandidateNiche(id, rawNiche, { confirmAfterEval = false } = {}) {
  const niche = titleCaseNiche(rawNiche);
  if (!niche) {
    throw Object.assign(new Error('Niche is required'), { status: 400 });
  }
  if (niche.length > 80) {
    throw Object.assign(new Error('Niche must be 80 characters or fewer'), { status: 400 });
  }
  const p = pathsFor(id);
  if (!existsSync(p.config) && !existsSync(p.meta) && !existsSync(p.research)) {
    throw Object.assign(new Error(`Candidate not found: ${id}`), { status: 404 });
  }
  if (isCandidateNicheRenameLocked(id) && !confirmAfterEval) {
    throw Object.assign(
      new Error(
        'Niche is locked after SERP / Volume. Confirm the rename (ripple effects) or change it before Ad volumes on new rows.',
      ),
      { status: 400, code: 'NICHE_LOCKED' },
    );
  }

  const config = readJson(p.config);
  if (config && typeof config === 'object') {
    writeJson(p.config, { ...config, niche });
  } else {
    writeJson(p.config, { niche });
  }
  saveMeta(id, { niche });

  const research = readJson(p.research);
  if (research && typeof research === 'object' && !Array.isArray(research)) {
    writeJson(p.research, { ...research, niche });
  }

  const seed = readJson(p.discoverySeed);
  if (seed && typeof seed === 'object' && !Array.isArray(seed)) {
    const next = { ...seed, niche };
    writeJson(p.discoverySeed, next);
  }

  invalidateCandidateListCache();
  return { ok: true, id: p.id, niche, confirmedAfterEval: Boolean(confirmAfterEval) };
}

function nicheFieldChanged(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (typeof data.niche !== 'string') return null;
  const next = titleCaseNiche(data.niche);
  if (!next || next === data.niche) return null;
  return next;
}

/** Title-case niche on candidate meta, config, research, and discovery seed. Ids stay put. */
export function backfillStoredCandidateNiches() {
  ensureResearchDir();
  const ids = new Set();
  for (const name of readdirSync(RESEARCH_DIR)) {
    if (name.endsWith('.meta.json')) ids.add(name.slice(0, -'.meta.json'.length));
    else if (name.endsWith('.config.json')) ids.add(name.slice(0, -'.config.json'.length));
  }
  let files = 0;
  for (const id of ids) {
    let p;
    try {
      p = pathsFor(id);
    } catch {
      continue;
    }
    for (const file of [p.meta, p.config, p.research, p.discoverySeed]) {
      if (!existsSync(file)) continue;
      const data = readJson(file);
      const next = nicheFieldChanged(data);
      if (!next) continue;
      writeJson(file, { ...data, niche: next });
      files += 1;
    }
  }
  return { candidates: ids.size, files };
}

export const CANDIDATE_DECISIONS = [
  'pursue',
  'maybe',
  'pass',
  'hold',
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
  const list = (candidates || listCandidates()).filter((c) => !c.archived);
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
  const volumesSkipped =
    Boolean(research.volumes?.volumesSkipped) ||
    research.volumes?.adsLocationFallback?.kind === 'state';
  const demandSource = inputs.demandSource ?? research.scoring?.demandBand?.demandSource ?? null;
  const estimatedFromResearch =
    research.volumes?.estimatedMonthlySearchVolume != null &&
    Number.isFinite(Number(research.volumes.estimatedMonthlySearchVolume))
      ? Number(research.volumes.estimatedMonthlySearchVolume)
      : research.scoring?.demandBand?.estimatedDemandVolume ?? null;
  let demand = inputs.demand ?? null;
  let resolvedDemandSource = demandSource;
  if (volumesSkipped) {
    if (demandSource === 'claude_estimate' && demand != null) {
      /* keep scored estimate */
    } else if (estimatedFromResearch != null) {
      demand = scoreDemand(estimatedFromResearch);
      resolvedDemandSource = 'claude_estimate';
    } else {
      demand = null;
      resolvedDemandSource = null;
    }
  }
  const nextProposed =
    computeProposedScore({
      demand,
      competition: inputs.competition,
      jobValue: inputs.jobValue,
      mapPackGap: inputs.mapPackGap,
      displaceability,
    }) ?? (volumesSkipped && demand == null ? null : recomputed ?? stored);

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
    proposedScore: nextProposed,
    overallProvisional: inputs.jobValue == null && nextProposed != null,
    clusterVolumeSum: research.volumes?.volumesSkipped || research.volumes?.adsLocationFallback?.kind === 'state'
      ? null
      : research.volumes?.clusterVolumeSum ?? null,
    primaryVolumeSum: research.volumes?.volumesSkipped || research.volumes?.adsLocationFallback?.kind === 'state'
      ? null
      : research.volumes?.primaryVolumeSum ?? null,
    demandVolumeSum: (() => {
      const vols = research.volumes || {};
      if (vols.volumesSkipped || vols.adsLocationFallback?.kind === 'state') return null;
      const stored =
        vols.demandVolumeSum ?? research.scoring?.demandBand?.demandVolumeSum ?? null;
      if (stored != null && Number.isFinite(Number(stored))) return Number(stored);
      const computed = computeDemandVolumeSum({
        primaryVolumeSum: vols.primaryVolumeSum ?? null,
        clusterVolumeSum: vols.clusterVolumeSum ?? null,
        suburbOverlapFactor:
          vols.suburbOverlapFactor ?? research.scoring?.suburbOverlapFactor ?? null,
      });
      return vols.clusterVolumeSum != null || vols.primaryVolumeSum != null
        ? computed.demandVolumeSum
        : null;
    })(),
    suburbOverlapFactor:
      research.volumes?.suburbOverlapFactor ??
      research.scoring?.suburbOverlapFactor ??
      null,
    volumesSkipped,
    adsLocationFallback: research.volumes?.adsLocationFallback ?? null,
    estimatedMonthlySearchVolume: estimatedFromResearch,
    estimatedMonthlySearchVolumeRaw: research.volumes?.estimatedMonthlySearchVolumeRaw ?? null,
    estimatedVolumeSource: research.volumes?.estimatedVolumeSource ?? null,
    demandSource: resolvedDemandSource,
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
      demand,
      demandSource: resolvedDemandSource,
      competition: inputs.competition ?? null,
      jobValue: inputs.jobValue ?? null,
      mapPackGap: inputs.mapPackGap ?? null,
      displaceability,
    },
  };
}

function applySkippedVolumeEstimate(summary, research, discoverySeed) {
  if (!summary || typeof summary !== 'object') return summary;
  const volumesSkipped = Boolean(
    summary.volumesSkipped ||
      research?.volumes?.volumesSkipped ||
      research?.volumes?.adsLocationFallback?.kind === 'state',
  );
  if (!volumesSkipped || researchHasAdsVolumes(research)) return summary;
  const estimate = resolveEstimatedVolumeForSeed({
    estimatedMonthlySearchVolume:
      summary.estimatedMonthlySearchVolume ?? discoverySeed?.estimatedMonthlySearchVolume,
    estimatedMonthlySearchVolumeRaw:
      summary.estimatedMonthlySearchVolumeRaw ?? discoverySeed?.estimatedMonthlySearchVolumeRaw,
    estimatedVolumeSource:
      summary.estimatedVolumeSource ?? discoverySeed?.estimatedVolumeSource,
    batchId: discoverySeed?.batchId,
    rowIndex: discoverySeed?.rowIndex,
  });
  if (estimate.value == null) return summary;
  const demand = scoreDemand(estimate.value);
  const scoreInputs = {
    ...(summary.scoreInputs || {}),
    demand,
    demandSource: 'claude_estimate',
  };
  return {
    ...summary,
    estimatedMonthlySearchVolume: estimate.value,
    estimatedMonthlySearchVolumeRaw: estimate.raw,
    estimatedVolumeSource: estimate.source || 'discovery_claude',
    demandSource: 'claude_estimate',
    scoreInputs,
    proposedScore:
      computeProposedScore({
        demand,
        competition: scoreInputs.competition,
        jobValue: scoreInputs.jobValue,
        mapPackGap: scoreInputs.mapPackGap,
        displaceability: scoreInputs.displaceability ?? summary.displaceability,
      }) ?? summary.proposedScore,
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

/** Filename suffixes under research/ that belong to a candidate id (longest first). */
const RESEARCH_ARTIFACT_SUFFIXES = [
  '-content-outline-package.json',
  '-content-structure.json',
  '-content-field-research.json',
  '-content-research.json',
  '-content-outline.json',
  '-content-brief.json',
  '-gbp-categories.json',
  '-content.draft.json',
  '-site-config.draft.json',
  '-images-manifest.json',
  '-images-plan.json',
  '-images-pull.json',
  '-ba-variants.json',
  '-photo-group.json',
  '-openai-prompts.json',
  '-build-package.json',
  '-discovery-seed.json',
  '-narrative.draft.json',
  '-prospects.draft.json',
  '-business-address.json',
  '-visual-edit-undo.json',
  '-city-context.json',
  '-site-config.json',
  '-content.json',
  '-narrative.json',
  '-prospects.json',
  '-approved.json',
  '.meta.json',
  '.config.json',
  '.json',
];

const RESEARCH_REGISTRY_FILES = new Set(['candidate-groups.json', 'known-candidates.json']);

/** Map a research/ filename to a candidate id, or null if not a candidate artifact. */
export function candidateIdFromResearchFile(file) {
  const name = String(file || '');
  if (!name.endsWith('.json') || RESEARCH_REGISTRY_FILES.has(name)) return null;
  for (const suffix of RESEARCH_ARTIFACT_SUFFIXES) {
    if (name.endsWith(suffix)) {
      const id = name.slice(0, -suffix.length);
      return id || null;
    }
  }
  return null;
}

function isResearchReport(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.niche && data.primaryCity && data.state) return true;
  if (data.serp || data.volumes || data.scoring) return true;
  return false;
}

function candidateHasCoreFiles(id) {
  const p = pathsFor(id);
  if (existsSync(p.config)) return true;
  if (existsSync(p.narrative) || existsSync(p.prospects) || existsSync(p.discoverySeed)) return true;
  if (existsSync(p.research) && isResearchReport(readJson(p.research))) return true;
  if (existsSync(p.meta)) {
    const meta = readJson(p.meta);
    if (meta?.primary && meta?.niche) return true;
  }
  return false;
}

const PHANTOM_SIDECAR_ID_SUFFIXES = ['-images-plan', '-ba-variants', '-photo-group', '-openai-prompts'];

/** Drop leftover `{parent}-images-plan.meta.json` etc. Never delete sidecar `.json` artifacts. */
function prunePhantomSidecarMetas() {
  ensureResearchDir();
  for (const file of readdirSync(RESEARCH_DIR)) {
    if (!file.endsWith('.meta.json')) continue;
    const id = file.slice(0, -'.meta.json'.length);
    const kind = PHANTOM_SIDECAR_ID_SUFFIXES.find((s) => id.endsWith(s));
    if (!kind) continue;
    const parent = id.slice(0, -kind.length);
    if (!parent) continue;
    const phantom = pathsFor(id);
    if (existsSync(phantom.config)) continue;
    if (!candidateHasCoreFiles(parent)) continue;
    try {
      unlinkSync(path.join(RESEARCH_DIR, file));
    } catch {
      /* ignore */
    }
  }
}

function buildCandidateListRows() {
  ensureResearchDir();
  prunePhantomSidecarMetas();
  const files = readdirSync(RESEARCH_DIR);
  const cleaned = new Set();

  for (const file of files) {
    const id = candidateIdFromResearchFile(file);
    if (!id) continue;
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) continue;
    cleaned.add(id);
  }

  const phoneIndex = loadTwilioProvisionIndex();

  return [...cleaned]
    .filter((id) => candidateHasCoreFiles(id))
    .sort()
    .map((id) => {
      const p = pathsFor(id);
      const research = readJson(p.research);
      const config = readJson(p.config);
      const meta = loadMeta(id);
      const prospects = readJson(p.prospects);
      const narrative = readJson(p.narrative);
      const discoverySeed = readJson(p.discoverySeed);
      const stageInfo = deriveStage(id, research);
      let summary = summarizeResearch(research) || {
        niche: config?.niche ?? meta.niche ?? null,
        primaryCity: config?.primary?.split(',')[0]?.trim() ?? null,
        state: config?.primary?.split(',')[1]?.trim() ?? null,
        cityCluster: config?.cluster ?? [],
      };
      // Discovery Light SERP triage until Eval 1 writes research.serp
      const light = discoverySeed?.lightSerp;
      if (light && typeof light === 'object') {
        const hasResearchSerp =
          research?.serp &&
          (research.serp.mapPackPresent != null ||
            research.serp.organicHomePages != null ||
            research.serp.organicSubPages != null);
        if (!hasResearchSerp) {
          summary = {
            ...summary,
            mapPackPresent:
              summary.mapPackPresent != null ? summary.mapPackPresent : light.mapPackPresent,
            organicHomeCount:
              summary.organicHomeCount != null ? summary.organicHomeCount : light.organicHomeCount,
            organicSubCount:
              summary.organicSubCount != null ? summary.organicSubCount : light.organicSubCount,
            organicHomeNicheCount:
              summary.organicHomeNicheCount != null
                ? summary.organicHomeNicheCount
                : light.organicHomeNicheCount,
            organicSubNicheCount:
              summary.organicSubNicheCount != null
                ? summary.organicSubNicheCount
                : light.organicSubNicheCount,
            lightSerpSource: light.source || 'discovery_light_serp',
          };
        }
      }
      summary = applySkippedVolumeEstimate(summary, research, discoverySeed);
      const narrJob =
        narrative?.scoring?.scoreInputs?.jobValue ?? narrative?.scoreInputs?.jobValue;
      if (
        (summary.scoreInputs?.jobValue == null || summary.scoreInputs?.jobValue === '') &&
        narrJob != null &&
        narrJob !== '' &&
        Number.isFinite(Number(narrJob))
      ) {
        const jobValue = Number(narrJob);
        summary = {
          ...summary,
          scoreInputs: { ...(summary.scoreInputs || {}), jobValue },
          overallProvisional: false,
          proposedScore:
            computeProposedScore({
              demand: summary.scoreInputs?.demand,
              competition: summary.scoreInputs?.competition,
              jobValue,
              mapPackGap: summary.scoreInputs?.mapPackGap,
              displaceability: summary.scoreInputs?.displaceability ?? summary.displaceability,
            }) ?? summary.proposedScore,
        };
      }
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
      const attached = attachPhoneDone(meta, stageInfo, id, phoneIndex);
      const displayNiche = String(meta.niche || config?.niche || summary.niche || '').trim();
      const row = {
        id,
        ...summary,
        ...(displayNiche ? { niche: displayNiche } : {}),
        nicheRenameLocked: isResearchEvalStarted(research, attached.stageFlags),
        ...prospectSummary,
        population: population != null ? Number(population) : null,
        jobCostText,
        decisionNotes: attached.meta.decisionNotes ?? null,
        stage: attached.stageFlags.stage,
        stageFlags: attached.stageFlags,
        decision: attached.meta.decision ?? summary.decision ?? null,
        archived: Boolean(attached.meta.archivedAt),
        archivedAt: attached.meta.archivedAt ?? null,
        source: attached.meta.source ?? null,
        lastCosts: attached.meta.lastCosts ?? null,
        researchCostUsd: attached.meta.lastCosts?.research ?? summary.estimatedApiCostUsd ?? null,
        meta: slimListMeta(attached.meta),
        updatedAt: attached.meta.updatedAt,
      };
      const rec = recommendCandidate(row);
      return {
        ...row,
        recommended_decision: rec.recommended_decision,
        recommended_reason: rec.recommended_reason,
      };
    });
}

export function listCandidates({ force = false } = {}) {
  const now = Date.now();
  if (!force && listCacheRows && now - listCacheAt < LIST_CACHE_TTL_MS) {
    return listCacheRows;
  }
  const rows = buildCandidateListRows();
  listCacheRows = rows;
  listCacheAt = now;
  return rows;
}

/**
 * Ensure volumes.byCity has Census population for UI (Cities measured).
 * Read-time only — next SERP/Volume persists via research-candidate.
 */
function parseCityStateLabel(label) {
  const s = String(label || '').trim();
  const m = s.match(/^(.+),\s*([A-Za-z]{2})$/);
  if (!m) return null;
  return { city: m[1].trim(), state: m[2].toUpperCase() };
}

function ensureVolumesByCityPopulations(research) {
  if (!research || typeof research !== 'object') return research;
  const vols = research.volumes;
  if (!vols || typeof vols !== 'object') return research;

  let byCity = Array.isArray(vols.byCity) ? vols.byCity.map((row) => ({ ...row })) : [];
  if (!byCity.length && Array.isArray(vols.citiesMeasured)) {
    byCity = vols.citiesMeasured
      .map((label) => parseCityStateLabel(label))
      .filter(Boolean)
      .map(({ city, state }) => ({ city, state, population: null }));
  }

  for (const row of byCity) {
    const pop = Number(row.population);
    if (Number.isFinite(pop) && pop > 0) continue;
    const looked = lookupPopulation(row.city, row.state);
    row.population = looked != null ? Number(looked) : null;
  }

  return {
    ...research,
    volumes: {
      ...vols,
      byCity,
    },
  };
}

function photoGroupDisplayName(g) {
  if (!g) return '';
  if (g.kind === 'master') return String(g.name || `${g.niche || 'Niche'} master`);
  return String(g.name || g.id || '');
}

/** Rank dropdowns only need this niche (plus any already-attached ids). Other niches stay on GET /api/photo-groups. */
export function filterPhotoGroupsForCandidate(groups, { niche, attached } = {}) {
  const list = Array.isArray(groups) ? groups : [];
  const nicheKey = String(niche || '')
    .trim()
    .toLowerCase();
  const attachedIds = new Set();
  if (attached && !attached.skipped) {
    for (const id of attached.groupIds || []) {
      const v = String(id || '').trim();
      if (v) attachedIds.add(v);
    }
    const one = String(attached.groupId || '').trim();
    if (one) attachedIds.add(one);
  }
  return list.filter((g) => {
    if (!g) return false;
    if (attachedIds.has(String(g.id || ''))) return true;
    if (!nicheKey) return false;
    return (
      String(g.niche || '')
        .trim()
        .toLowerCase() === nicheKey
    );
  });
}

export const CANDIDATE_DETAIL_SLICES = ['content', 'images', 'address', 'prospects'];

function parseDetailIncludes(include) {
  if (include === 'all' || include === true) return 'all';
  if (include == null || include === 'shell' || include === false) return new Set();
  const arr = Array.isArray(include)
    ? include
    : String(include)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  if (arr.includes('all')) return 'all';
  return new Set(arr.filter((s) => s && s !== 'shell'));
}

function wantSlice(include, slice) {
  return include === 'all' || include.has(slice);
}

/**
 * Full detail when called with no opts (pipeline / workers).
 * HTTP uses `{ include: [] }` (shell) or `include=content,images,…`.
 */
export function getCandidateDetail(id, opts = undefined) {
  const include =
    opts == null || opts.include === undefined ? 'all' : parseDetailIncludes(opts.include);
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

  healResearchJobValueFromNarrative(id);

  const research = ensureVolumesByCityPopulations(readJson(p.research));
  const config = readJson(p.config);
  const meta = loadMeta(id);
  const narrative = readJson(p.narrative);
  const narrativeDraft = readJson(p.narrativeDraft);
  const discoverySeed = readJson(p.discoverySeed);
  const approved = readJson(p.approved);
  const siteConfigDraft = readJson(p.siteConfigDraft);
  const siteConfigAccepted = readJson(p.siteConfig);
  const contentBrief = readJson(p.contentBrief);
  const contentFieldResearch = readJson(p.contentFieldResearch);
  const contentOutlinePackage = readJson(p.contentOutlinePackage);
  const imagesPlan = readJson(p.imagesPlan);
  const photoGroupAttached = readJson(p.photoGroup);
  const photoGroupNiche = String(
    siteConfigAccepted?.niche || siteConfigDraft?.niche || config?.niche || '',
  ).trim();

  const loadContent = wantSlice(include, 'content');
  const loadImages = wantSlice(include, 'images');
  const loadAddress = wantSlice(include, 'address');
  const loadProspects = wantSlice(include, 'prospects');

  let contentDraft = loadContent ? readJson(p.contentDraft) : null;
  if (loadContent && contentDraft?.files && typeof contentDraft.files === 'object') {
    const lifted = applyHomepageDesignedSectionLiftToFiles(contentDraft.files, {
      config: siteConfigAccepted || siteConfigDraft || config || {},
      outline: contentOutlinePackage || {},
    });
    const stampedOps = stampHomepageLiftOnDraftOps(contentDraft._ops, {
      changes: lifted.changes || [],
      files: lifted.files,
    });
    const warningsChanged =
      JSON.stringify(contentDraft._ops?.check?.warnings || []) !==
        JSON.stringify(stampedOps.check?.warnings || []) ||
      JSON.stringify(contentDraft._ops?.contract?.warnings || []) !==
        JSON.stringify(stampedOps.contract?.warnings || []);
    if (lifted.changed || warningsChanged) {
      contentDraft = {
        ...contentDraft,
        files: lifted.files,
        _ops: stampedOps,
      };
      writeJson(p.contentDraft, contentDraft);
    }
  }
  const contentAccepted = loadContent ? readJson(p.content) : null;
  const contentResearch = loadContent ? readJson(p.contentResearch) : null;
  const contentOutline = loadContent ? readJson(p.contentOutline) : null;
  const contentStructure = loadContent ? readJson(p.contentStructure) : null;
  const buildPackage = loadContent ? readJson(p.buildPackage) : null;
  const imagesManifest = loadImages ? readJson(p.imagesManifest) : null;

  let photoGroupsAll = [];
  let photoGroups = [];
  let photoNicheMaster = null;
  if (loadImages) {
    const photoGroupsIndex = readJson(path.join(RESEARCH_DIR, '_photo-groups', 'index.json'));
    photoGroupsAll = photoGroupsIndex?.groups || [];
    photoGroups = filterPhotoGroupsForCandidate(photoGroupsAll, {
      niche: photoGroupNiche,
      attached: photoGroupAttached,
    })
      .slice()
      .sort((a, b) =>
        photoGroupDisplayName(a).localeCompare(photoGroupDisplayName(b), undefined, {
          sensitivity: 'base',
        }),
      );
    const nicheKey = photoGroupNiche.toLowerCase();
    photoNicheMaster =
      photoGroupsAll.find(
        (g) =>
          g.kind === 'master' &&
          String(g.niche || '')
            .trim()
            .toLowerCase() === nicheKey,
      ) || null;
  }

  const prospects = loadProspects ? readJson(p.prospects) : null;
  const businessAddress = loadAddress ? readJson(p.businessAddress) : null;
  const stageInfo = deriveStage(id, research);

  const hasContentDraftFile = existsSync(p.contentDraft);
  const hasContentFile = existsSync(p.content);

  const detail = {
    id: p.id,
    paths: Object.fromEntries(
      Object.entries(p).map(([k, v]) => [k, path.relative(ROOT, v).replace(/\\/g, '/')]),
    ),
    stage: stageInfo.stage,
    stageFlags: {
      ...stageInfo,
      hasApproved: Boolean(approved),
      hasSiteConfigDraft: Boolean(siteConfigDraft) || existsSync(p.siteConfigDraft),
      hasSiteConfig: Boolean(siteConfigAccepted) || existsSync(p.siteConfig),
      hasContentDraft: loadContent ? Boolean(contentDraft) : hasContentDraftFile,
      hasContent: loadContent ? Boolean(contentAccepted) : hasContentFile,
      hasContentUnreadable: Boolean(loadContent && hasContentFile && !contentAccepted),
      hasContentResearch: loadContent ? Boolean(contentResearch) : existsSync(p.contentResearch),
      hasContentOutline: loadContent ? Boolean(contentOutline) : existsSync(p.contentOutline),
      hasContentBrief: Boolean(contentBrief),
      hasContentBriefConfirmed: Boolean(contentBrief?.status === 'confirmed'),
      hasContentFieldResearch: Boolean(contentFieldResearch?.status === 'loaded'),
      hasContentFinalCheck: Boolean(
        contentDraft?._ops?.lastFinalCheckAt ||
          contentAccepted?._ops?.lastFinalCheckAt ||
          (!loadContent && hasContentFile),
      ),
      hasContentImagesPlan: Boolean(
        imagesPlan?.loadedAt ||
          contentDraft?._ops?.lastImagesPlanAt ||
          contentAccepted?._ops?.lastImagesPlanAt ||
          photoGroupAttached?.groupId ||
          (photoNicheMaster?.id && !photoGroupAttached?.skipped) ||
          existsSync(p.imagesPlan),
      ),
      hasContentStructure: loadContent ? Boolean(contentStructure) : existsSync(p.contentStructure),
      hasContentOutlinePackage: Boolean(contentOutlinePackage),
      hasContentOutlineConfirmed: Boolean(contentOutlinePackage?.status === 'confirmed'),
      hasBuildPackage: loadContent ? Boolean(buildPackage) : existsSync(p.buildPackage),
      hasImages: loadImages
        ? Boolean(imagesManifest?.files?.length)
        : existsSync(p.imagesManifest),
      hasLogo:
        Boolean(siteConfigAccepted?.logo) ||
        existsSync(path.join(p.siteImages, 'logo.svg')) ||
        existsSync(path.join(p.siteImages, 'logo.png')),
      hasCoverageMap: existsSync(path.join(p.siteImages, 'coverage-map.svg')),
      hasBusinessAddress: loadAddress
        ? Boolean(businessAddress?.selection || businessAddress?.skipped || businessAddress?.status)
        : existsSync(p.businessAddress),
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
    logoPromptDefaults: logoPromptDefaultsForConfig(siteConfigAccepted || siteConfigDraft || {}),
    logoVariants: Array.isArray(meta.logoVariants) ? meta.logoVariants : [],
    coverageMapVariants: Array.isArray(meta.coverageMapVariants) ? meta.coverageMapVariants : [],
    summary: applySkippedVolumeEstimate(summarizeResearch(research), research, discoverySeed),
    archived: Boolean(meta.archivedAt),
    archivedAt: meta.archivedAt ?? null,
    photoGroupNiche,
    _slices: {
      shell: true,
      content: loadContent,
      images: loadImages,
      address: loadAddress,
      prospects: loadProspects,
    },
  };

  if (loadContent) {
    detail.contentDraft = contentDraft;
    detail.content = contentAccepted;
    detail.contentResearch = contentResearch;
    detail.contentOutline = contentOutline;
    detail.contentBrief = contentBrief;
    detail.contentFieldResearch = contentFieldResearch;
    detail.contentStructure = contentStructure;
    detail.contentOutlinePackage = contentOutlinePackage;
    detail.buildPackage = buildPackage;
  }
  if (loadImages) {
    detail.imagesManifest = imagesManifest;
    detail.imagesPlan = imagesPlan;
    detail.photoGroupAttached = photoGroupAttached;
    detail.photoNicheMaster = photoNicheMaster;
    detail.photoGroups = photoGroups;
  }
  if (loadProspects) detail.prospects = prospects;
  if (loadAddress) detail.businessAddress = businessAddress;

  const phoneIndex = loadTwilioProvisionIndex();
  const attached = attachPhoneDone(detail.meta, detail.stageFlags, detail.id, phoneIndex);
  if (!detail.meta.lastPhoneAt && !detail.meta.phoneSkippedAt && attached.meta.lastPhoneAt) {
    detail.meta = saveMeta(detail.id, { lastPhoneAt: attached.meta.lastPhoneAt });
    detail.stageFlags = { ...attached.stageFlags, hasSitePhone: true };
  } else {
    detail.meta = attached.meta;
    detail.stageFlags = attached.stageFlags;
  }
  return detail;
}

export function getCandidateShell(id) {
  return getCandidateDetail(id, { include: [] });
}

export function createCandidate({
  niche: rawNiche,
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
  const niche = titleCaseNiche(rawNiche);
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
    cluster: normalizeCityStateCluster(cluster, state.toUpperCase()),
    related: Number(related) || 10,
    seeds,
    out: path.relative(ROOT, p.research).replace(/\\/g, '/'),
  };
  if (serpCache) {
    config.serpCache = String(serpCache).replace(/\\/g, '/');
  }

  writeJson(p.config, config);
  if (discoverySeed && typeof discoverySeed === 'object') {
    const seed = Array.isArray(discoverySeed) ? discoverySeed : { ...discoverySeed };
    if (!Array.isArray(seed) && typeof seed.niche === 'string') seed.niche = titleCaseNiche(seed.niche);
    writeJson(p.discoverySeed, seed);
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

export function mergeNarrativeIntoResearch(research, narrative) {
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
    suggestedKeywords: narrative.suggestedKeywords ?? research.suggestedKeywords ?? null,
    estTimeToRankMonths: narrative.estTimeToRankMonths ?? research.estTimeToRankMonths ?? null,
  };
}

/** If accepted narrative has jobValue but research does not, merge and persist. */
export function healResearchJobValueFromNarrative(id) {
  const p = pathsFor(id);
  const research = readJson(p.research);
  const narrative = readJson(p.narrative);
  if (!research || !narrative) return null;
  const researchJob = research.scoring?.scoreInputs?.jobValue ?? research.scoreInputs?.jobValue;
  const narrJob = narrative.scoring?.scoreInputs?.jobValue ?? narrative.scoreInputs?.jobValue;
  const researchMissing =
    researchJob == null || researchJob === '' || !Number.isFinite(Number(researchJob));
  const narrHas =
    narrJob != null && narrJob !== '' && Number.isFinite(Number(narrJob));
  if (!researchMissing || !narrHas) return null;
  const merged = mergeNarrativeIntoResearch(research, narrative);
  writeJson(p.research, merged);
  return merged;
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
export function validateNarrativeAccept(draft, discoverySeed = null, { allowJobCostOverride = false, research = null } = {}) {
  if (!draft || typeof draft !== 'object') {
    return { ok: false, error: 'Draft is empty or invalid', code: 'empty' };
  }
  if (draft.parseError) {
    return { ok: false, error: 'Draft has a parse error — fix JSON and Load again', code: 'parse' };
  }
  const avg = draft.averageJobCostUsd;
  const mid = jobCostMidpoint(avg);
  if (mid == null || mid <= 0) {
    return {
      ok: false,
      error: 'averageJobCostUsd (low/high/midpoint) is required',
      code: 'job_cost_missing',
    };
  }
  const jobVal = draft.scoring?.scoreInputs?.jobValue;
  if (jobVal == null || Number.isNaN(Number(jobVal))) {
    return {
      ok: false,
      error: 'scoring.scoreInputs.jobValue is required',
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

  const suggestedKeywords = Array.isArray(draft.suggestedKeywords)
    ? draft.suggestedKeywords
        .map((row) =>
          typeof row === 'string'
            ? row.trim()
            : String(row?.keyword || row?.phrase || '').trim(),
        )
        .filter(Boolean)
    : [];
  const volumesSkipped = Boolean(
    research?.volumes?.volumesSkipped || discoverySeed?.volumesSkipped,
  );
  let warning = null;
  if (volumesSkipped && suggestedKeywords.length === 0) {
    warning =
      'No suggestedKeywords — Website supporting keywords will be thin. Re-run Narrative or add phrases.';
  }

  return { ok: true, mid, seedBand, warning, suggestedKeywords };
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
    suggestedKeywords: narrative?.suggestedKeywords ?? research?.suggestedKeywords ?? null,
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
          clusterVolumeSum:
            research.volumes?.volumesSkipped || research.volumes?.adsLocationFallback?.kind === 'state'
              ? null
              : research.volumes?.clusterVolumeSum ?? null,
          primaryVolumeSum:
            research.volumes?.volumesSkipped || research.volumes?.adsLocationFallback?.kind === 'state'
              ? null
              : research.volumes?.primaryVolumeSum ?? null,
          demandVolumeSum:
            research.volumes?.volumesSkipped || research.volumes?.adsLocationFallback?.kind === 'state'
              ? null
              : research.volumes?.demandVolumeSum ??
                research.scoring?.demandBand?.demandVolumeSum ??
                null,
          suburbOverlapFactor:
            research.volumes?.suburbOverlapFactor ?? research.scoring?.suburbOverlapFactor ?? null,
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

/**
 * Commit a narrative draft if validation passes.
 * Job-cost seed-band mismatches auto-override (no separate Accept click).
 * Leaves the draft in place when validation fails for other reasons.
 */
export function autoAcceptNarrativeDraft(id) {
  const p = pathsFor(id);
  const draft = readJson(p.narrativeDraft);
  if (!draft) return { accepted: false, skipped: true, reason: 'no_draft' };
  if (draft.parseError) {
    return { accepted: false, skipped: true, reason: 'parse_error', draft };
  }
  try {
    const result = acceptNarrative(id, { allowJobCostOverride: false });
    return { accepted: true, jobCostOverride: false, ...result };
  } catch (error) {
    if (error.code === 'job_cost_seed_mismatch') {
      try {
        const result = acceptNarrative(id, { allowJobCostOverride: true });
        return { accepted: true, jobCostOverride: true, ...result };
      } catch (retryError) {
        return {
          accepted: false,
          error: retryError.message,
          code: retryError.code || null,
          draft: readJson(p.narrativeDraft),
        };
      }
    }
    return {
      accepted: false,
      error: error.message,
      code: error.code || null,
      draft: readJson(p.narrativeDraft),
    };
  }
}

export function acceptNarrative(id, { allowJobCostOverride = false } = {}) {
  const p = pathsFor(id);
  const draft = readJson(p.narrativeDraft);
  if (!draft) throw Object.assign(new Error('No narrative draft to accept'), { status: 400 });
  const discoverySeed = readJson(p.discoverySeed);
  const research = readJson(p.research);
  const check = validateNarrativeAccept(draft, discoverySeed, { allowJobCostOverride, research });
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

  return { narrative: readJson(p.narrative), approved: pack, warning: check.warning || null };
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

export function setArchived(ids = [], archived = true) {
  const wantArchived = Boolean(archived);
  const updated = [];
  const errors = [];
  for (const raw of ids) {
    const id = String(raw || '').trim();
    if (!id) continue;
    try {
      const p = pathsFor(id);
      if (
        !existsSync(p.research) &&
        !existsSync(p.config) &&
        !existsSync(p.meta) &&
        !existsSync(p.narrative) &&
        !existsSync(p.prospects)
      ) {
        throw new Error(`Candidate not found: ${id}`);
      }
      const meta = saveMeta(id, {
        archivedAt: wantArchived ? new Date().toISOString() : null,
      });
      updated.push({ id: p.id, archived: Boolean(meta.archivedAt), archivedAt: meta.archivedAt });
    } catch (error) {
      errors.push({ id, error: error.message });
    }
  }
  return { updated, errors, archived: wantArchived };
}

function resolveCandidateGeo(id) {
  const p = pathsFor(id);
  const meta = loadMeta(id);
  const config = readJson(p.config);
  const research = readJson(p.research);
  const primary = String(config?.primary || '');
  const [primaryCityFromConfig, stateFromConfig] = primary.split(',').map((s) => s.trim());
  const niche =
    String(meta.niche || research?.niche || research?.summary?.niche || config?.niche || '').trim();
  const city = String(
    meta.primaryCity ||
      research?.primaryCity ||
      research?.summary?.primaryCity ||
      primaryCityFromConfig ||
      '',
  ).trim();
  const state = String(
    meta.state || research?.state || research?.summary?.state || stateFromConfig || '',
  )
    .trim()
    .toUpperCase();
  return { niche, city, state };
}

function wipeCandidateFiles(id) {
  const p = pathsFor(id);
  const deletedFiles = [];
  ensureResearchDir();
  for (const file of readdirSync(RESEARCH_DIR)) {
    if (candidateIdFromResearchFile(file) !== p.id) continue;
    const full = path.join(RESEARCH_DIR, file);
    try {
      if (statSync(full).isFile()) {
        unlinkSync(full);
        deletedFiles.push(file);
      }
    } catch {
      /* continue */
    }
  }
  // Known path files that may not be covered by suffix list yet
  for (const key of Object.keys(p)) {
    if (key === 'id' || key === 'siteStaging' || key === 'siteImages') continue;
    const full = p[key];
    if (typeof full !== 'string' || !full.endsWith('.json')) continue;
    if (!existsSync(full)) continue;
    try {
      unlinkSync(full);
      deletedFiles.push(path.basename(full));
    } catch {
      /* continue */
    }
  }
  const candidateDir = path.join(RESEARCH_DIR, p.id);
  if (existsSync(candidateDir)) {
    try {
      rmSync(candidateDir, { recursive: true, force: true });
    } catch {
      /* continue */
    }
  }
  invalidateCandidateListCache();
  return deletedFiles;
}

/**
 * Permanently delete unlaunched candidates and scrub Rover-local references
 * (groups, tracked anti-dupe, Sites registry, Discovery batch candidateId links,
 * local assembled folder under rover-sites). Launched ids are skipped.
 */
export async function deleteCandidates(ids = []) {
  const deleted = [];
  const errors = [];
  const geos = [];
  const normalizedIds = [];
  const assembledDirs = [];
  const assembledById = new Map();

  let launchedGuard = null;
  try {
    launchedGuard = await import('./launched-edit-guard.mjs');
  } catch {
    launchedGuard = null;
  }
  let assembleMod = null;
  try {
    assembleMod = await import('./assemble-site.mjs');
  } catch (error) {
    console.warn('[deleteCandidates] assemble-site import failed:', error.message);
  }

  ensureResearchDir();
  for (const raw of ids) {
    let p;
    try {
      p = pathsFor(raw);
    } catch (error) {
      errors.push({ id: String(raw || ''), error: error.message });
      continue;
    }
    const id = p.id;
    if (launchedGuard?.isCandidateLaunched?.(id)) {
      errors.push({
        id,
        error: `Cannot permanently delete Launched Candidate(s): ${id}`,
      });
      continue;
    }
    if (!candidateHasCoreFiles(id) && !existsSync(path.join(RESEARCH_DIR, id))) {
      const orphan = readdirSync(RESEARCH_DIR).some((f) => candidateIdFromResearchFile(f) === id);
      if (!orphan) {
        errors.push({ id, error: `Candidate not found: ${id}` });
        continue;
      }
    }
    if (assembleMod) {
      try {
        assembledById.set(id, assembleMod.collectAssembledSiteDirsForDelete(id));
      } catch {
        /* continue */
      }
    }
    normalizedIds.push(id);
    try {
      geos.push(resolveCandidateGeo(id));
      const files = wipeCandidateFiles(id);
      deleted.push({ id, filesRemoved: files.length });
      assembledDirs.push(...(assembledById.get(id) || []));
    } catch (error) {
      errors.push({ id, error: error.message });
    }
  }

  if (assembleMod && assembledDirs.length) {
    const seen = new Set();
    for (const dir of assembledDirs) {
      const key = String(dir || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      try {
        await assembleMod.removeLocalAssembledSiteDir(dir);
      } catch (error) {
        console.warn('[deleteCandidates] assembled folder rm failed:', error.message);
      }
    }
  }

  if (normalizedIds.length) {
    try {
      const groups = await import('./candidate-groups.mjs');
      groups.purgeCandidateIds(normalizedIds);
    } catch (error) {
      console.warn('[deleteCandidates] group purge failed:', error.message);
    }
    try {
      const sites = await import('./sites.mjs');
      sites.deleteSitesByCandidateIds(normalizedIds);
    } catch (error) {
      console.warn('[deleteCandidates] sites scrub failed:', error.message);
    }
    try {
      const known = await import('./known-candidates.mjs');
      for (const g of geos) {
        if (g.niche && g.city && g.state) {
          known.removeTrackedDecision(g);
        }
      }
      known.safeRegenerateKnownCandidates();
    } catch (error) {
      console.warn('[deleteCandidates] known/tracked scrub failed:', error.message);
    }
    try {
      const discovery = await import('./discovery.mjs');
      discovery.scrubCandidateIdsFromBatches(normalizedIds);
    } catch (error) {
      console.warn('[deleteCandidates] discovery batch scrub failed:', error.message);
    }
  }

  return { deleted, errors };
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

export function buildOutreachCopyPrompt(id) {
  const detail = getCandidateDetail(id);
  if (!detail.prospects) {
    throw Object.assign(new Error('No prospects JSON — run Stage 4 first'), { status: 400 });
  }
  const md = readPromptFile('prompts/claude-prospect-renters.md');
  const template = extractPromptTemplate(md);
  return template.replace(
    '{{PASTE_OUTPUT_OF_npm_run_prospect_renters}}',
    JSON.stringify(detail.prospects, null, 2),
  );
}
