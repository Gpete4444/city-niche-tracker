export const DISCOVERY_ADS_USABLE_P3_STATUSES = Object.freeze([
  'complete',
  'partial',
  'no_nearby_candidates',
  'nearby_unavailable',
  'max_nearby_zero',
]);

function parseCity(value) {
  const match = String(value || '').trim().match(/^(.+),\s*([A-Za-z]{2})$/);
  return match ? { city: match[1].trim(), state: match[2].toUpperCase() } : null;
}

function normalizeCluster(primary, values) {
  if (!Array.isArray(values)) return null;
  const target = parseCity(`${primary.city},${primary.state}`);
  if (!target) return null;
  const targetKey = `${target.city.toLowerCase()}|${target.state}`;
  const seen = new Set([targetKey]);
  const result = [];
  for (const value of values) {
    const city = parseCity(value);
    if (!city) return null;
    const key = `${city.city.toLowerCase()}|${city.state}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(`${city.city},${city.state}`);
  }
  return result.sort((left, right) => left.localeCompare(right));
}

export function discoveryAdsEvidenceIsCurrent(row, evidence, clusterEvidence, currentCluster) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;
  const p3Status = String(clusterEvidence?.status || '');
  if (!DISCOVERY_ADS_USABLE_P3_STATUSES.includes(p3Status)) return false;
  const primary = { city: String(row?.City || '').trim(), state: String(row?.State || '').trim().toUpperCase() };
  const authoritativeCluster = ['complete', 'partial'].includes(p3Status)
    ? normalizeCluster(primary, currentCluster)
    : [];
  const storedCluster = normalizeCluster(primary, evidence.adsCluster || []);
  const target = evidence.target && parseCity(`${evidence.target.city},${evidence.target.state}`);
  return authoritativeCluster !== null
    && storedCluster !== null
    && JSON.stringify(authoritativeCluster) === JSON.stringify(storedCluster)
    && evidence.rowKey === [row?.Niche, row?.City, row?.State].map((value) => String(value || '').trim().toLowerCase()).join('|')
    && evidence.signatureVersion === 1
    && evidence.keywordContractVersion === 'v1-seeds-related-limit-1'
    && evidence.intentClassifierVersion === 1
    && target?.city.toLowerCase() === primary.city.toLowerCase()
    && target?.state === primary.state;
}
