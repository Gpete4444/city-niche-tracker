/** Zone map: Cluster fills, Cluster number on labels, one Zone radius. */

export const WAVE_DEFAULT_COUNT = 3;
export const WAVE_MAX = 10;
export const CLUSTER_MAX = 10;

/** 1-based Cluster 1…10 fills (same hues Waves used to use). */
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
];
export const WAVE_COLORS = CLUSTER_COLORS;

export function parseWaveNumber(role) {
  if (typeof role === 'number' && Number.isFinite(role)) {
    const n = Math.round(role);
    return n >= 1 && n <= WAVE_MAX ? n : 0;
  }
  const r = String(role || '')
    .trim()
    .toLowerCase();
  if (r === 'city') return 1;
  const m = /^wave([1-9]|10)$/.exec(r);
  return m ? Number(m[1]) : 0;
}

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

export function memberWave(m) {
  const n = Math.round(Number(m?.wave));
  if (Number.isFinite(n) && n >= 1 && n <= WAVE_MAX) return n;
  return parseWaveNumber(m?.role);
}

export function memberClusterKey(m) {
  return parseClusterKey(m?.clusterKey);
}

export function waveRole(n) {
  const i = Math.round(Number(n));
  if (!Number.isFinite(i) || i < 1 || i > WAVE_MAX) return '';
  return `wave${i}`;
}

export function isWaveRole(role) {
  return parseWaveNumber(role) >= 1;
}

export function clampWaveCount(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return WAVE_DEFAULT_COUNT;
  return Math.max(WAVE_DEFAULT_COUNT, Math.min(WAVE_MAX, n));
}

export function clampClusterMiles(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 30;
  return Math.max(1, Math.min(100, n));
}

export function normalizeWaveMiles(raw, { waveCount, clusterMiles } = {}) {
  const count = clampWaveCount(waveCount);
  const fallback = clampClusterMiles(clusterMiles);
  const src = Array.isArray(raw) ? raw : [];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const prev = i === 0 ? 1 : out[i - 1];
    const rawVal = src[i] ?? (i === 0 ? fallback : out[i - 1]);
    out.push(Math.max(prev, clampClusterMiles(rawVal)));
  }
  return out;
}

export function setWaveMilesAt(waveMiles, index, miles) {
  const next = [...(waveMiles || [])];
  if (!next.length) return next;
  const i = Math.max(0, Math.min(next.length - 1, Math.round(Number(index))));
  const min = i === 0 ? 1 : next[i - 1];
  next[i] = Math.max(min, clampClusterMiles(miles));
  for (let j = i + 1; j < next.length; j += 1) {
    next[j] = Math.max(next[j], next[j - 1]);
  }
  return next.map((n) => clampClusterMiles(n));
}

export function extendWaveMiles(waveMiles, waveCount, clusterMiles) {
  const count = clampWaveCount(waveCount);
  const next = normalizeWaveMiles(waveMiles, {
    waveCount: Math.max(WAVE_DEFAULT_COUNT, waveMiles?.length || 0),
    clusterMiles,
  });
  while (next.length < count) {
    const last = next[next.length - 1] || clampClusterMiles(clusterMiles);
    next.push(Math.min(100, last + 10));
  }
  return next.slice(0, count);
}

export function waveColor(n) {
  const i = Math.round(Number(n));
  if (!Number.isFinite(i) || i < 1) return CLUSTER_COLORS[0];
  return CLUSTER_COLORS[Math.min(WAVE_MAX, i) - 1] || CLUSTER_COLORS[0];
}

export function waveLabel(roleOrN) {
  const n = typeof roleOrN === 'number' ? roleOrN : parseWaveNumber(roleOrN);
  return n >= 1 ? `Wave ${n}` : '';
}

export function cityMapLabel(name, clusterKey, { hub = false } = {}) {
  const n = parseClusterKey(clusterKey);
  const prefix = n >= 1 ? `${n} ` : '';
  const star = hub ? '★ ' : '';
  return `${star}${prefix}${name}`;
}
