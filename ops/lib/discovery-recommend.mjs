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
  'ignore',
];

/** Decisions auto-recommended (hold / ignore are human-only). */
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
  const hasNarrative = Boolean(input.hasNarrative);
  const incomplete = !hasResearch || !hasNarrative;

  if (incomplete) {
    const missing = [];
    if (!hasResearch) missing.push('search snapshot');
    if (!hasNarrative) missing.push('written story');
    return {
      recommended_decision: 'review',
      recommended_reason: `Still needed: ${missing.join(' and ')}. Finish those before using the score.`,
    };
  }

  const score = input.score;
  if (score == null || !Number.isFinite(Number(score))) {
    return {
      recommended_decision: 'review',
      recommended_reason: 'No overall score yet. Finish the required research steps before using the score.',
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
      'Discovery has no overall score yet. Process this row, then finish the required research steps before using the score.',
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
    const existingHuman = String(row.human_decision || '').trim();
    const existingNotes = String(row.decision_notes ?? '').trim();
    return {
      ...row,
      recommended_decision: rec.recommended_decision,
      recommended_reason: rec.recommended_reason,
      // Never clobber operator Decision / notes (Process + Light SERP re-run this).
      human_decision: existingHuman || rec.recommended_decision,
      decision_notes: existingNotes
        ? row.decision_notes
        : existingHuman
          ? row.decision_notes || ''
          : rec.recommended_reason,
    };
  });
}
