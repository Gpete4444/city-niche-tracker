/**
 * Discovery Claude Est. Monthly Search Volume — primary-city guess, not Ads.
 * Used for Demand only when Ads volumes are skipped.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function parseEstimatedMonthlySearchVolume(raw) {
  if (raw == null) return { value: null, raw: null };
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { value: Math.round(raw), raw: String(raw) };
  }
  const text = String(raw).trim();
  if (!text) return { value: null, raw: '' };
  const cleaned = text.replace(/,/g, '').replace(/≈|~/g, '').trim();
  const rangePair = cleaned.match(/^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/);
  const toPair = cleaned.match(/^(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)/i);
  const pair = rangePair || toPair;
  if (pair) {
    const a = Number(pair[1]);
    const b = Number(pair[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return { value: Math.round((a + b) / 2), raw: text };
    }
  }
  const single = cleaned.match(/^(\d+(?:\.\d+)?)/);
  if (single) {
    const n = Number(single[1]);
    if (Number.isFinite(n)) return { value: Math.round(n), raw: text };
  }
  return { value: null, raw: text };
}

export function estimatedVolumeFields(parsed, source = 'discovery_claude') {
  if (!parsed || parsed.value == null || !Number.isFinite(Number(parsed.value))) {
    return {
      estimatedMonthlySearchVolume: null,
      estimatedMonthlySearchVolumeRaw: parsed?.raw ?? null,
      estimatedVolumeSource: null,
    };
  }
  return {
    estimatedMonthlySearchVolume: Number(parsed.value),
    estimatedMonthlySearchVolumeRaw: parsed.raw ?? String(parsed.value),
    estimatedVolumeSource: source,
  };
}

export function resolveEstimatedVolumeFromSeed(seed) {
  if (!seed || typeof seed !== 'object') {
    return { value: null, raw: null, source: null };
  }
  if (
    seed.estimatedMonthlySearchVolume != null &&
    Number.isFinite(Number(seed.estimatedMonthlySearchVolume))
  ) {
    return {
      value: Number(seed.estimatedMonthlySearchVolume),
      raw: seed.estimatedMonthlySearchVolumeRaw ?? String(seed.estimatedMonthlySearchVolume),
      source: seed.estimatedVolumeSource || 'discovery_claude',
    };
  }
  const parsed = parseEstimatedMonthlySearchVolume(seed.estimatedMonthlySearchVolumeRaw);
  if (parsed.value != null) {
    return { ...parsed, source: seed.estimatedVolumeSource || 'discovery_claude' };
  }
  return { value: null, raw: parsed.raw, source: null };
}

export function resolveEstimatedVolumeFromResearch(research) {
  return resolveEstimatedVolumeFromSeed(research?.volumes);
}

/** Seed fields first; old seeds fall back to the Discovery batch CSV row. */
export function resolveEstimatedVolumeForSeed(seed) {
  const fromSeed = resolveEstimatedVolumeFromSeed(seed);
  if (fromSeed.value != null) return fromSeed;
  const batchId = String(seed?.batchId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const rowIndex = Number(seed?.rowIndex);
  if (!batchId || !Number.isInteger(rowIndex) || rowIndex < 0) return fromSeed;
  const csvPath = path.join(process.cwd(), 'research', 'batches', batchId, 'candidates.csv');
  if (!existsSync(csvPath)) return fromSeed;
  try {
    const rows = parseCsvRecords(readFileSync(csvPath, 'utf8'));
    const parsed = parseEstimatedMonthlySearchVolume(rows[rowIndex]?.['Est. Monthly Search Volume']);
    if (parsed.value != null) {
      return { value: parsed.value, raw: parsed.raw, source: 'discovery_claude' };
    }
  } catch {
    /* batch missing or unreadable */
  }
  return fromSeed;
}

function parseCsvRecords(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((c) => String(c).trim() !== '')) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  row.push(cell);
  if (row.some((c) => String(c).trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cells[idx] ?? '';
    });
    return obj;
  });
}
