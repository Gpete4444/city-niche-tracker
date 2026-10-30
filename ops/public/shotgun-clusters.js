/** Zone map: Cluster fills, Cluster number on labels, one Zone radius. */

export const CLUSTER_MAX = 20;

/** Keep in sync with ops/lib/geo-neighbors.mjs MAX_CLUSTER_MILES. */
export const MAX_CLUSTER_MILES = 200;

/** 1-based Cluster 1…20 fills. */
export const CLUSTER_COLORS = [
  '#059669',
  '#d97706',
  '#7c3aed',
  '#0284c7',
  '#e11d48',
  '#0d9488',
  '#c026d3',
  '#65a30d',
  '#ea580c',
  '#4f46e5',
  '#0ea5e9',
  '#a21caf',
  '#ca8a04',
  '#be185d',
  '#047857',
  '#4338ca',
  '#c2410c',
  '#0f766e',
  '#5b21b6',
  '#b45309',
];

export function parseClusterKey(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 1 || n > CLUSTER_MAX) return 0;
  return n;
}

export function clusterColor(n) {
  const i = parseClusterKey(n);
  if (!i) return '';
  return CLUSTER_COLORS[i - 1] || CLUSTER_COLORS[0];
}

/** Default leftover Also serving fill accent — same hex as Cluster 2 fill. */
export const ALSO_SERVING_AMBER = '#d97706';
/** Used when the open cluster already owns ALSO_SERVING_AMBER. */
export const ALSO_SERVING_AMBER_FALLBACK = '#9a3412';
export const PAGE_OUTLINE = '#1e3a8a';
export const PRIMARY_OUTLINE = '#0f766e';
/** Bold findability ring for this site’s plan cities. */
export const PLAN_OUTLINE = '#0f172a';

function hexEq(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/** Leftover Also serving stroke for the open cluster — never the current cluster fill. */
export function alsoServingHighlightColor(currentClusterKey) {
  const own = clusterColor(currentClusterKey);
  if (own && hexEq(own, ALSO_SERVING_AMBER)) return ALSO_SERVING_AMBER_FALLBACK;
  return ALSO_SERVING_AMBER;
}

/**
 * Bold black outline for this site’s plan: primary, current-cluster siblings,
 * location pages, leftover Also serving, operator-selected coverage, and
 * selected other-cluster siblings (Also serving). Unselected other-cluster
 * siblings stay cluster-colored.
 * @returns {{ color: string, weight: number } | null}
 */
export function serviceAreaEmphasisOutline({
  isSibling = false,
  isCurrentClusterSibling = false,
  isPrimary = false,
  hasPage = false,
  leftoverServing = false,
  siblingAlsoServing = false,
  isSelected = false,
} = {}) {
  if (isSibling && !isCurrentClusterSibling && !siblingAlsoServing) return null;
  if (
    isPrimary ||
    isCurrentClusterSibling ||
    hasPage ||
    leftoverServing ||
    siblingAlsoServing ||
    isSelected
  ) {
    return { color: PLAN_OUTLINE, weight: 3 };
  }
  return null;
}

export function memberClusterKey(m) {
  return parseClusterKey(m?.clusterKey);
}

export function clampClusterMiles(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 30;
  return Math.max(1, Math.min(MAX_CLUSTER_MILES, n));
}

export function cityMapLabel(name, clusterKey, { hub = false } = {}) {
  const n = parseClusterKey(clusterKey);
  const prefix = n >= 1 ? `${n} ` : '';
  const star = hub ? '★ ' : '';
  return `${star}${prefix}${name}`;
}
