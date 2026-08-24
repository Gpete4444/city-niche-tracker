/** V1.5 primary-SERP screen compatibility mapping for Discovery rows. */

import { visibleRecommendationForScreen } from './v15-primary-serp-screen.mjs';

export const DISCOVERY_DECISIONS = [
  'pursue',
  'maybe',
  'deprioritize',
  'pass',
  'hold',
  'review',
  'pass_unless_gbp_angle',
];

function confLow(...values) {
  return values.some((value) => String(value || '').trim().toLowerCase() === 'low');
}

/**
 * Package 1 never infers pursuit from surviving the cheap primary-SERP screen.
 * Rows without the new screen evidence remain review/maybe instead of falling
 * back to the retired Map Pack + homepage-count veto.
 * @returns {{ recommended_decision: string, recommended_reason: string }}
 */
export function recommendDiscoveryRow(row = {}) {
  const screenDecision = String(row.screenDecision ?? '').trim().toUpperCase();
  if (screenDecision === 'SCREEN_OUT' || screenDecision === 'SURVIVE') {
    return {
      recommended_decision: visibleRecommendationForScreen(screenDecision),
      recommended_reason: row.screenReason || `V1.5 primary-SERP screen: ${screenDecision}`,
    };
  }
  if (confLow(row.confidence_serp, row.confidence_narrative)) {
    return {
      recommended_decision: 'maybe',
      recommended_reason: 'Low confidence — run the V1.5 primary-SERP screen before human review',
    };
  }
  return {
    recommended_decision: 'review',
    recommended_reason: 'V1.5 primary-SERP screen evidence missing — review or run the SERP screen',
  };
}

export function applyRecommendations(rows = []) {
  return rows.map((row) => {
    const recommendation = recommendDiscoveryRow(row);
    return {
      ...row,
      recommended_decision: recommendation.recommended_decision,
      recommended_reason: recommendation.recommended_reason,
    };
  });
}
