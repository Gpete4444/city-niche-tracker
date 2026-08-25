import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rubric = JSON.parse(readFileSync(path.join(__dirname, 'scoring-rubric.json'), 'utf8'));

export function getScoringRubric() {
  return rubric;
}

function inRange(value, rule) {
  if (rule.minInclusive != null && value < rule.minInclusive) return false;
  if (rule.maxExclusive != null && value >= rule.maxExclusive) return false;
  if (rule.minExclusive != null && value <= rule.minExclusive) return false;
  if (rule.maxInclusive != null && value > rule.maxInclusive) return false;
  return true;
}

function median(nums) {
  const vals = nums.filter((n) => n != null && !Number.isNaN(Number(n))).map(Number).sort((a, b) => a - b);
  if (vals.length === 0) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

export function classifyDemandBand(clusterVolumeSum) {
  const volume = Number(clusterVolumeSum) || 0;
  for (const [id, band] of Object.entries(rubric.demandBands)) {
    if (inRange(volume, band)) {
      return { id, ...band, clusterVolumeSum: volume };
    }
  }
  return { id: 'low', ...rubric.demandBands.low, clusterVolumeSum: volume };
}

export function scoreDemand(clusterVolumeSum) {
  const volume = Number(clusterVolumeSum) || 0;
  for (const row of rubric.demandScoreScale) {
    if (inRange(volume, row)) return row.score;
  }
  return 2;
}

export function scoreCompetition({
  uniqueOrganicDomainCount,
  organicHomePageCount = 0,
  medianDomainRank = null,
}) {
  const n = Number(uniqueOrganicDomainCount) || 0;
  let score = 2;
  let label = 'Hard';
  for (const row of rubric.competitionScore.scale) {
    if (
      row.maxUniqueOrganicDomainsInclusive != null &&
      n <= row.maxUniqueOrganicDomainsInclusive
    ) {
      score = row.score;
      label = row.label;
      break;
    }
    if (
      row.minUniqueOrganicDomainsInclusive != null &&
      n >= row.minUniqueOrganicDomainsInclusive
    ) {
      score = row.score;
      label = row.label;
    }
  }

  const adj = rubric.competitionScore.homepageAdjustment;
  if (organicHomePageCount >= adj.organicHomePagesAtLeast) {
    score = Math.max(1, score + adj.delta);
    label = `${label} (homepage penalty)`;
  }

  const rankAdj = rubric.competitionScore.medianDomainRankAdjustment;
  if (medianDomainRank != null) {
    if (medianDomainRank >= rankAdj.highRankMinInclusive) {
      score = Math.max(1, score + rankAdj.delta);
      label = `${label} (high Rank)`;
    } else if (medianDomainRank < rankAdj.lowRankMaxExclusive) {
      score = Math.min(10, score + rankAdj.deltaLow);
      label = `${label} (low Rank)`;
    }
  }

  return {
    score,
    label,
    uniqueOrganicDomainCount: n,
    organicHomePageCount,
    medianDomainRank,
  };
}

export function scoreMapPackGap(mapPackPresent) {
  const row = mapPackPresent ? rubric.mapPackGapScore.present : rubric.mapPackGapScore.absent;
  return {
    score: row.score,
    label: row.label,
    mapPackPresent: Boolean(mapPackPresent),
  };
}

export function scoreJobValue(averageJobUsd) {
  if (averageJobUsd == null || Number.isNaN(Number(averageJobUsd))) {
    return { score: null, label: null, averageJobUsd: null, ticketClass: null };
  }
  const value = Number(averageJobUsd);
  let score = 3;
  let label = 'Low ticket';
  for (const row of rubric.jobValueScore.scale) {
    if (inRange(value, row)) {
      score = row.score;
      label = row.label;
      break;
    }
  }
  return { score, label, averageJobUsd: value, ticketClass: classifyTicketClass(value) };
}

export function classifyTicketClass(averageJobUsd) {
  if (averageJobUsd == null || Number.isNaN(Number(averageJobUsd))) return null;
  const value = Number(averageJobUsd);
  for (const [id, row] of Object.entries(rubric.ticketClasses)) {
    if (inRange(value, row.avgJobUsd)) return id;
  }
  return 'high';
}

export function classifySerpSoftness({
  mapPackPresent,
  organicHomePageCount,
  uniqueOrganicDomainCount,
}) {
  const soft = rubric.serpSoftness.soft;
  const hard = rubric.serpSoftness.hard;

  const isHard = hard.anyOf.some((rule) => {
    if (rule.uniqueOrganicDomainsMinInclusive != null) {
      if (uniqueOrganicDomainCount >= rule.uniqueOrganicDomainsMinInclusive) return true;
    }
    if (rule.organicHomePageCountMinInclusive != null && rule.mapPackPresent) {
      if (organicHomePageCount >= rule.organicHomePageCountMinInclusive && mapPackPresent) {
        return true;
      }
    }
    return false;
  });

  if (isHard) {
    return { id: 'hard', note: hard.note };
  }

  const isSoft =
    organicHomePageCount <= soft.allOf[0].organicHomePageCountMaxInclusive &&
    uniqueOrganicDomainCount <= soft.allOf[1].uniqueOrganicDomainsMaxInclusive;

  if (isSoft) {
    return { id: 'soft', note: soft.note };
  }

  return {
    id: 'mixed',
    note: 'Between soft and hard — review organic homepage count, domains, Map Pack, and Stage 2 displaceability.',
  };
}

export function classifyDisplaceabilityBand(score) {
  if (score == null) return null;
  for (const [id, band] of Object.entries(rubric.displaceability.bands)) {
    if (inRange(score, band)) return { id, ...band, score };
  }
  return { id: 'mid', ...rubric.displaceability.bands.mid, score };
}

/**
 * Aggregate organic page rows into a displaceability score (1–10, higher = easier).
 */
export function scoreDisplaceability(pageRows = []) {
  const organicAll = pageRows.filter((p) => p.kind !== 'map_pack');
  const fetchFailedCount = organicAll.filter(
    (p) => p.signals?.fetchFailed || p.signals?.fetched === false || p.fetchFailed,
  ).length;
  const organic = organicAll.filter(
    (p) => !(p.signals?.fetchFailed || p.fetchFailed || (p.signals?.fetched === false && p.signals?.wordCount == null)),
  );
  if (organic.length === 0) {
    return {
      score: null,
      band: null,
      pageCount: 0,
      thinStubCount: 0,
      moderateCount: 0,
      strongNichePageCount: 0,
      thinStubShare: null,
      strongNichePageShare: null,
      medianThinnessScore: null,
      medianDomainRank: null,
      medianPageRank: null,
      fetchFailedCount,
      hint:
        fetchFailedCount > 0
          ? `All ${fetchFailedCount} organic page fetch(es) failed — displaceability incomplete.`
          : 'No organic pages to score.',
    };
  }

  const thinStubCount = organic.filter((p) => p.strengthLabel === 'thin_stub').length;
  const strongNichePageCount = organic.filter((p) => p.strengthLabel === 'strong_niche_page').length;
  const moderateCount = organic.filter((p) => p.strengthLabel === 'moderate').length;
  const thinStubShare = thinStubCount / organic.length;
  const strongNichePageShare = strongNichePageCount / organic.length;
  const medianThinnessScore = median(organic.map((p) => p.thinnessScore));
  const medianDomainRank = median(organic.map((p) => p.domainRank));
  const medianPageRank = median(organic.map((p) => p.pageRank));

  let score = medianThinnessScore ?? 5;
  if (thinStubShare >= 0.6) score += 1;
  if (strongNichePageShare >= 0.35) score -= 2;
  if (strongNichePageCount >= 3) score -= 1;
  if (medianDomainRank != null && medianDomainRank >= 40) score -= 1;
  if (medianDomainRank != null && medianDomainRank < 20) score += 1;
  score = Math.max(1, Math.min(10, Math.round(score)));

  const band = classifyDisplaceabilityBand(score);
  let hint = rubric.displaceability.aggregateHints.mostlyThinStubs;
  if (strongNichePageShare >= 0.35 || score <= 3) {
    hint = rubric.displaceability.aggregateHints.severalStrongPages;
  } else if (score < 7) {
    hint = 'Mixed page strength — review individual enrichment.pages before committing.';
  }
  if (fetchFailedCount > 0) {
    hint = `${hint} (${fetchFailedCount} page fetch failure(s) excluded from aggregate).`;
  }

  return {
    score,
    band,
    pageCount: organic.length,
    thinStubCount,
    moderateCount,
    strongNichePageCount,
    thinStubShare: Number(thinStubShare.toFixed(2)),
    strongNichePageShare: Number(strongNichePageShare.toFixed(2)),
    medianThinnessScore,
    medianDomainRank,
    medianPageRank,
    fetchFailedCount,
    hint,
    honestyLimit: rubric.displaceability.honestyLimit,
  };
}

function ruleMatches(ruleWhen, ctx) {
  if (ruleWhen.demandBandIn && !ruleWhen.demandBandIn.includes(ctx.demandBandId)) return false;
  if (ruleWhen.serpSoftness && ruleWhen.serpSoftness !== ctx.serpSoftnessId) return false;
  if (ruleWhen.ticketClassIn) {
    if (!ctx.ticketClass || !ruleWhen.ticketClassIn.includes(ctx.ticketClass)) return false;
  }
  if (ruleWhen.displaceabilityBandIn) {
    if (
      !ctx.displaceabilityBandId ||
      !ruleWhen.displaceabilityBandIn.includes(ctx.displaceabilityBandId)
    ) {
      return false;
    }
  }
  return true;
}

export function applyDecisionRules({
  demandBandId,
  serpSoftnessId,
  ticketClass,
  displaceabilityBandId = null,
}) {
  const ctx = { demandBandId, serpSoftnessId, ticketClass, displaceabilityBandId };
  for (const rule of rubric.decisionRulesSpecialtyHighTicket) {
    const keys = Object.keys(rule.when || {});
    if (keys.length === 0) continue;
    if (rule.id === 'pass_low_otherwise' && serpSoftnessId === 'soft' && !ticketClass) {
      continue;
    }
    if (ruleMatches(rule.when, ctx)) {
      return {
        decision: rule.decision,
        ruleId: rule.id,
        summary: rule.summary,
        appliesTo: rubric.appliesTo,
      };
    }
  }
  const fallback = rubric.decisionRulesSpecialtyHighTicket.find((r) => r.id === 'review_default');
  return {
    decision: fallback.decision,
    ruleId: fallback.id,
    summary: fallback.summary,
    appliesTo: rubric.appliesTo,
  };
}

/**
 * Weighted overall opportunity score (1 decimal).
 * Requires Stage 1 trio: demand, competition, mapPackGap.
 * jobValue and displaceability are optional — weights renormalize over present inputs.
 */
export function proposedScore({
  demand,
  competition,
  jobValue = null,
  mapPackGap,
  displaceability = null,
}) {
  const w = rubric.proposedScoreWeights;
  if (demand == null || competition == null || mapPackGap == null) {
    return null;
  }

  const parts = [
    { key: 'demand', value: demand, weight: w.demand },
    { key: 'competition', value: competition, weight: w.competition },
    { key: 'mapPackGap', value: mapPackGap, weight: w.mapPackGap },
  ];
  if (jobValue != null) parts.push({ key: 'jobValue', value: jobValue, weight: w.jobValue });
  if (displaceability != null) {
    parts.push({ key: 'displaceability', value: displaceability, weight: w.displaceability });
  }

  const weightSum = parts.reduce((sum, p) => sum + p.weight, 0);
  if (weightSum <= 0) return null;
  const value = parts.reduce((sum, p) => sum + p.value * p.weight, 0) / weightSum;
  return Math.round(value * 10) / 10;
}

export function shouldAutoEnrich(scoring) {
  const gate = rubric.enrichmentGate;
  const demandOk = gate.demandBandIn.includes(scoring?.demandBand?.id);
  const decisionOk = gate.decisionIn.includes(scoring?.decision?.decision);
  return Boolean(demandOk && decisionOk);
}

/**
 * Build the scoring block attached to DataForSEO research output.
 * jobValue stays null until Claude/human supplies average job cost.
 * displaceability stays null until Stage 2 enrichment.
 */
export function buildResearchScoring({
  clusterVolumeSum,
  mapPackPresent,
  uniqueOrganicDomainCount,
  organicHomePageCount,
  averageJobUsd = null,
  medianDomainRank = null,
  displaceability = null,
}) {
  const demandBand = classifyDemandBand(clusterVolumeSum);
  const demand = scoreDemand(clusterVolumeSum);
  const competition = scoreCompetition({
    uniqueOrganicDomainCount,
    organicHomePageCount,
    medianDomainRank,
  });
  const mapPackGap = scoreMapPackGap(mapPackPresent);
  const jobValue = scoreJobValue(averageJobUsd);
  const serpSoftness = classifySerpSoftness({
    mapPackPresent,
    organicHomePageCount,
    uniqueOrganicDomainCount,
  });
  const displaceabilityScore = displaceability?.score ?? null;
  const displaceabilityBand = displaceability?.band ?? classifyDisplaceabilityBand(displaceabilityScore);
  const decision = applyDecisionRules({
    demandBandId: demandBand.id,
    serpSoftnessId: serpSoftness.id,
    ticketClass: jobValue.ticketClass,
    displaceabilityBandId: displaceabilityBand?.id ?? null,
  });

  const inputs = {
    demand,
    competition: competition.score,
    jobValue: jobValue.score,
    mapPackGap: mapPackGap.score,
    displaceability: displaceabilityScore,
    notes: [
      demandBand.howToTreat,
      `${competition.label}: ${uniqueOrganicDomainCount} unique organic domains, ${organicHomePageCount} niche homepages.`,
      mapPackGap.label,
      jobValue.score == null
        ? 'Overall score is provisional until jobValue (average job cost) is set by Claude/human.'
        : `${jobValue.label} (~$${jobValue.averageJobUsd}).`,
      displaceabilityScore == null
        ? 'displaceability pending Stage 2 enrich (npm run enrich-candidate); overall score renormalizes without it.'
        : `displaceability=${displaceabilityScore} (${displaceabilityBand?.label ?? 'n/a'}): ${displaceability?.hint ?? ''}`,
      `SERP ${serpSoftness.id}: ${serpSoftness.note}`,
      `Decision (${decision.ruleId}): ${decision.summary}`,
    ].join(' '),
  };

  return {
    rubricVersion: rubric.version,
    appliesTo: rubric.appliesTo,
    volumeMetric: rubric.volumeMetric.field,
    authorityMetric: rubric.authorityMetric,
    demandBand: {
      id: demandBand.id,
      label: demandBand.label,
      clusterVolumeSum: demandBand.clusterVolumeSum,
      howToTreat: demandBand.howToTreat,
    },
    serpSoftness,
    ticketClass: jobValue.ticketClass,
    displaceability: displaceability
      ? { ...displaceability, band: displaceabilityBand }
      : null,
    pathToWin: {
      principle: rubric.pathToWin.blueLinksFirst,
      siteOnlyDefinition: rubric.pathToWin.siteOnlyDefinition,
      twoLanes: rubric.pathToWin.twoLanes,
      playbook: rubric.pathToWin.playbook,
      forThisSerp: mapPackPresent
        ? rubric.pathToWin.mapPackPresent
        : rubric.pathToWin.mapPackAbsent,
    },
    decision,
    scoreInputs: inputs,
    proposedScore: proposedScore(inputs),
    enrichmentRecommended: shouldAutoEnrich({
      demandBand,
      decision,
    }),
    definitions: {
      demandBands: rubric.demandBands,
      displaceability: rubric.displaceability,
      decisionRulesSpecialtyHighTicket: rubric.decisionRulesSpecialtyHighTicket.map((r) => ({
        id: r.id,
        decision: r.decision,
        summary: r.summary,
      })),
    },
  };
}

/**
 * Recompute scoring after Stage 2 enrichment attaches page Rank / displaceability.
 * @param {object} research - research used for volumes/SERP (may be a fresh Stage 1 report)
 * @param {object} enrichment - Stage 2 enrichment block
 * @param {object|null} jobSource - optional prior research/narrative carrier for jobValue
 *   (Stage 1 rewrite passes priorResearch so null jobValue on the fresh report is not used)
 */
export function applyEnrichmentToScoring(research, enrichment, jobSource = null) {
  const displaceability = enrichment.displaceability;
  const scoring = buildResearchScoring({
    clusterVolumeSum: research.volumes?.clusterVolumeSum ?? 0,
    mapPackPresent: Boolean(research.serp?.mapPackPresent),
    uniqueOrganicDomainCount: research.serp?.uniqueOrganicDomains?.length ?? 0,
    organicHomePageCount: research.serp?.organicHomePages?.count ?? 0,
    medianDomainRank: displaceability?.medianDomainRank ?? null,
    displaceability,
  });

  const source = jobSource || research;
  const priorJob =
    source?.scoring?.scoreInputs?.jobValue ?? source?.scoreInputs?.jobValue ?? null;
  if (priorJob != null && priorJob !== '') {
    const jobValue = Number(priorJob);
    if (Number.isFinite(jobValue)) {
      scoring.scoreInputs.jobValue = jobValue;
      scoring.ticketClass =
        source?.scoring?.ticketClass ?? research.scoring?.ticketClass ?? scoring.ticketClass;
      scoring.proposedScore = proposedScore(scoring.scoreInputs);
      scoring.decision = applyDecisionRules({
        demandBandId: scoring.demandBand.id,
        serpSoftnessId: scoring.serpSoftness.id,
        ticketClass: scoring.ticketClass,
        displaceabilityBandId: scoring.displaceability?.band?.id ?? null,
      });
      scoring.enrichmentRecommended = shouldAutoEnrich(scoring);
      scoring.scoreInputs.notes = [
        scoring.scoreInputs.notes,
        `Preserved prior jobValue=${jobValue} from research/narrative.`,
        `Decision after enrich (${scoring.decision.ruleId}): ${scoring.decision.summary}`,
      ].join(' ');
    }
  }

  return scoring;
}

/** Pick jobValue + averageJobCostUsd from prior research, else accepted narrative. */
export function resolvePreservedJobFields({ priorResearch = null, narrative = null } = {}) {
  const priorJob =
    priorResearch?.scoring?.scoreInputs?.jobValue ?? priorResearch?.scoreInputs?.jobValue;
  const narrJob =
    narrative?.scoring?.scoreInputs?.jobValue ?? narrative?.scoreInputs?.jobValue;
  let jobValue = null;
  if (priorJob != null && priorJob !== '' && Number.isFinite(Number(priorJob))) {
    jobValue = Number(priorJob);
  } else if (narrJob != null && narrJob !== '' && Number.isFinite(Number(narrJob))) {
    jobValue = Number(narrJob);
  }
  const averageJobCostUsd =
    priorResearch?.averageJobCostUsd ?? narrative?.averageJobCostUsd ?? null;
  const ticketClass =
    (jobValue != null &&
      (priorResearch?.scoring?.ticketClass ?? narrative?.scoring?.ticketClass)) ||
    null;
  return { jobValue, averageJobCostUsd, ticketClass };
}

/** Attach preserved Narrative/prior job fields onto a Stage 1 research report. */
export function attachPreservedJobFields(report, fields) {
  if (!report?.scoring?.scoreInputs || !fields || fields.jobValue == null) return report;
  report.scoring.scoreInputs.jobValue = fields.jobValue;
  if (fields.ticketClass) report.scoring.ticketClass = fields.ticketClass;
  if (fields.averageJobCostUsd) report.averageJobCostUsd = fields.averageJobCostUsd;
  report.scoring.proposedScore = proposedScore(report.scoring.scoreInputs);
  report.scoreInputs = report.scoring.scoreInputs;
  report.proposedScore = report.scoring.proposedScore;
  const note = `Preserved jobValue=${fields.jobValue} from prior research/narrative.`;
  if (!String(report.scoring.scoreInputs.notes || '').includes(note)) {
    report.scoring.scoreInputs.notes = [report.scoring.scoreInputs.notes, note]
      .filter(Boolean)
      .join(' ');
  }
  return report;
}
