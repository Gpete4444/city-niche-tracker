/**
 * Score-based decision recommendations.
 * Review when Research stages 1–3 are incomplete or Overall score is missing;
 * otherwise pursue / maybe / pass from proposedScore bands.
 */

export const DISCOVERY_DECISIONS = [
  'pursue',
  'maybe',
  'pass',
  'hold',
  'review',
];

/** Decisions auto-recommended (hold is human-only). */
export const AUTO_DECISIONS = ['pursue', 'maybe', 'pass', 'review'];

/**
 * @param {{
 *   score?: number | null,
 *   hasResearch?: boolean,
 *   hasEnrichment?: boolean,
 *   hasNarrative?: boolean,
 * }} input
 * @returns {{ recommended_decision: string, recommended_reason: string }}
 */
export function recommendFromScoreAndStages(input = {}) {
  const hasResearch = Boolean(input.hasResearch);
  const hasEnrichment = Boolean(input.hasEnrichment);
  const hasNarrative = Boolean(input.hasNarrative);
  const incomplete = !hasResearch || !hasEnrichment || !hasNarrative;

  if (incomplete) {
    const missing = [];
    if (!hasResearch) missing.push('1 Research');
    if (!hasEnrichment) missing.push('2 Enrich');
    if (!hasNarrative) missing.push('3 Narrative');
    return {
      recommended_decision: 'review',
      recommended_reason: `Research stages incomplete (${missing.join(', ')}) — run stages before score-based decide`,
    };
  }

  const score = input.score;
  if (score == null || !Number.isFinite(Number(score))) {
    return {
      recommended_decision: 'review',
      recommended_reason: 'No Overall score yet — need score inputs after Research stages',
    };
  }

  const n = Number(score);
  if (n >= 7) {
    return {
      recommended_decision: 'pursue',
      recommended_reason: `Overall score ${n} ≥ 7`,
    };
  }
  if (n >= 6) {
    return {
      recommended_decision: 'maybe',
      recommended_reason: `Overall score ${n} is ≥ 6 and < 7`,
    };
  }
  return {
    recommended_decision: 'pass',
    recommended_reason: `Overall score ${n} < 6`,
  };
}

/**
 * Discovery rows have no Overall score / Research stages yet → always review.
 * @returns {{ recommended_decision: string, recommended_reason: string }}
 */
export function recommendDiscoveryRow(_row = {}) {
  return {
    recommended_decision: 'review',
    recommended_reason:
      'Discovery has no Overall score yet — Process into Research and complete stages 1–3 for score-based recommend',
  };
}

/**
 * Research / Candidate list row (needs proposedScore + stageFlags).
 * @param {object} c
 * @returns {{ recommended_decision: string, recommended_reason: string }}
 */
export function recommendCandidate(c = {}) {
  const f = c.stageFlags || {};
  const score =
    c.proposedScore != null && Number.isFinite(Number(c.proposedScore))
      ? Number(c.proposedScore)
      : null;
  return recommendFromScoreAndStages({
    score,
    hasResearch: f.hasResearch,
    hasEnrichment: f.hasEnrichment,
    hasNarrative: f.hasNarrative,
  });
}

export function applyRecommendations(rows = []) {
  return rows.map((row) => {
    const rec = recommendDiscoveryRow(row);
    return {
      ...row,
      recommended_decision: rec.recommended_decision,
      recommended_reason: rec.recommended_reason,
      human_decision: rec.recommended_decision,
      decision_notes: rec.recommended_reason,
    };
  });
}
