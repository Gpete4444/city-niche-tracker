/**
 * Lightweight discovery recommended-decision heuristic.
 * Prefer DataForSEO-probed Map Pack/organic; blank Map Pack never auto-pursues.
 */

export const DISCOVERY_DECISIONS = [
  'pursue',
  'maybe',
  'deprioritize',
  'pass',
  'hold',
  'review',
  'pass_unless_gbp_angle',
];

function parseOrganicCount(value) {
  const s = String(value ?? '').trim();
  if (!s || /^n\/?a$/i.test(s)) return null;
  const n = Number(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function mapPackPresent(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'yes' || s === 'y' || s === 'true' || s === '1') return true;
  if (s === 'no' || s === 'n' || s === 'false' || s === '0') return false;
  return null;
}

function confLow(...values) {
  return values.some((v) => String(v || '').trim().toLowerCase() === 'low');
}

function confMedium(...values) {
  return values.some((v) => String(v || '').trim().toLowerCase() === 'medium');
}

function isDfsProbed(row) {
  return String(row.serp_source || '').toLowerCase().includes('dataforseo');
}

/**
 * @returns {{ recommended_decision: string, recommended_reason: string }}
 */
export function recommendDiscoveryRow(row = {}) {
  const pack = mapPackPresent(row['Map Pack']);
  const homes = parseOrganicCount(row['Organic Home Page']);
  const lowConf = confLow(row.confidence_serp, row.confidence_narrative);
  const medConf = confMedium(row.confidence_serp);
  const probed = isDfsProbed(row);

  // Blank Map Pack = unknown — never treat as soft pursue
  if (pack == null) {
    if (lowConf) {
      return {
        recommended_decision: 'maybe',
        recommended_reason: 'Map Pack unknown + low confidence — run DFS SERP probe',
      };
    }
    return {
      recommended_decision: 'review',
      recommended_reason: 'Map Pack blank/unknown — run Discovery DFS SERP probe before pursue',
    };
  }

  if (lowConf && pack === true && homes != null && homes >= 2) {
    return {
      recommended_decision: 'pass_unless_gbp_angle',
      recommended_reason: 'Map Pack present + ≥2 niche homepages + low confidence',
    };
  }

  if (pack === true && homes != null && homes >= 2) {
    return {
      recommended_decision: 'deprioritize',
      recommended_reason: probed
        ? 'DFS: Map Pack present + ≥2 organic niche homepages'
        : 'Map Pack present + ≥2 organic niche homepages',
    };
  }

  if (pack === true && (homes == null || homes <= 1)) {
    return {
      recommended_decision: 'pass_unless_gbp_angle',
      recommended_reason: probed
        ? 'DFS: Map Pack present but soft organic (≤1 homepage) — GBP angle only'
        : 'Map Pack present but soft organic (≤1 homepage) — GBP angle only',
    };
  }

  if (lowConf) {
    return {
      recommended_decision: 'maybe',
      recommended_reason: 'Low confidence on SERP or narrative estimates',
    };
  }

  // Estimated (non-DFS) Map Pack=No at medium confidence → review, not pursue
  if (pack === false && !probed && medConf) {
    return {
      recommended_decision: 'review',
      recommended_reason: 'Estimated Map Pack=No at medium confidence — verify with DFS SERP probe',
    };
  }

  if (pack === false && (homes == null || homes <= 1) && !lowConf) {
    return {
      recommended_decision: 'pursue',
      recommended_reason: probed
        ? 'DFS: No Map Pack + soft organic (≤1 homepage)'
        : 'No Map Pack + soft organic (≤1 homepage) — estimate only',
    };
  }

  if (pack === false && homes != null && homes >= 2) {
    return {
      recommended_decision: 'review',
      recommended_reason: 'Map Pack absent but ≥2 niche homepages — mixed',
    };
  }

  return {
    recommended_decision: 'review',
    recommended_reason: 'Mixed or incomplete SERP signals',
  };
}

export function applyRecommendations(rows = []) {
  return rows.map((row) => {
    const rec = recommendDiscoveryRow(row);
    return {
      ...row,
      recommended_decision: rec.recommended_decision,
      recommended_reason: rec.recommended_reason,
    };
  });
}
