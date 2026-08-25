/**
 * Living known-candidates index for Discovery anti-dupe.
 * Candidate rows regenerated from research/*.meta.json + configs.
 * Tracked (pass/etc.) decisions live in research/tracked-decisions.csv and merge into prompts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  RESEARCH_DIR,
  listCandidates,
  loadMeta,
  pathsFor,
} from './candidates.mjs';

const KNOWN_CSV = path.join(RESEARCH_DIR, 'known-candidates.csv');
const TRACKED_CSV = path.join(RESEARCH_DIR, 'tracked-decisions.csv');
const KNOWN_COLUMNS = ['Niche', 'City', 'State', 'decision', 'candidateId', 'updatedAt'];
const TRACKED_COLUMNS = ['Niche', 'City', 'State', 'decision', 'batchId', 'updatedAt'];

function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Minimal CSV parse for known/tracked files (quoted cells). */
function parseSimpleCsv(text) {
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
      if (row.some((c) => String(c).trim() !== '')) rows.push(row);
      row = [];
      cell = '';
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((c) => String(c).trim() !== '')) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h || '').trim());
  return rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cells[idx] ?? '';
    });
    return obj;
  });
}

export function candidateGeoKey({ niche, city, state }) {
  return [niche, city, state]
    .map((v) => String(v || '').trim().toLowerCase())
    .join('|');
}

export function parsePrimary(primary) {
  const parts = String(primary || '')
    .split(',')
    .map((s) => s.trim());
  return {
    city: parts[0] || '',
    state: (parts[1] || '').toUpperCase(),
  };
}

/**
 * Build a map geoKey → { id, niche, city, state, decision, updatedAt }
 */
export function indexCandidatesByGeo() {
  const map = new Map();
  for (const c of listCandidates()) {
    const niche = c.niche || c.meta?.niche || '';
    const city = c.primaryCity || parsePrimary(c.meta?.primary).city || '';
    const state = (c.state || parsePrimary(c.meta?.primary).state || '').toUpperCase();
    if (!niche || !city || !state) continue;
    const key = candidateGeoKey({ niche, city, state });
    map.set(key, {
      id: c.id,
      niche,
      city,
      state,
      decision: c.decision || '',
      updatedAt: c.updatedAt || c.meta?.updatedAt || '',
    });
  }
  return map;
}

export function findCandidateByGeo({ niche, city, state }) {
  const key = candidateGeoKey({ niche, city, state });
  return indexCandidatesByGeo().get(key) || null;
}

export function knownCandidatesPath() {
  return KNOWN_CSV;
}

export function trackedDecisionsPath() {
  return TRACKED_CSV;
}

/** Load tracked (pass/etc.) decisions. */
export function loadTrackedDecisions() {
  if (!existsSync(TRACKED_CSV)) return [];
  try {
    return parseSimpleCsv(readFileSync(TRACKED_CSV, 'utf8'))
      .map((r) => ({
        niche: String(r.Niche || r.niche || '').trim(),
        city: String(r.City || r.city || '').trim(),
        state: String(r.State || r.state || '')
          .trim()
          .toUpperCase(),
        decision: String(r.decision || '').trim(),
        batchId: String(r.batchId || '').trim(),
        updatedAt: String(r.updatedAt || '').trim(),
      }))
      .filter((r) => r.niche && r.city && r.state);
  } catch {
    return [];
  }
}

function writeTrackedDecisions(rows) {
  mkdirSync(RESEARCH_DIR, { recursive: true });
  const sorted = [...rows].sort((a, b) => {
    const ak = `${a.state}|${a.city}|${a.niche}`;
    const bk = `${b.state}|${b.city}|${b.niche}`;
    return ak.localeCompare(bk);
  });
  const lines = [TRACKED_COLUMNS.join(',')];
  for (const r of sorted) {
    lines.push(
      [
        csvEscape(r.niche),
        csvEscape(r.city),
        csvEscape(r.state),
        csvEscape(r.decision),
        csvEscape(r.batchId || ''),
        csvEscape(r.updatedAt || ''),
      ].join(','),
    );
  }
  writeFileSync(TRACKED_CSV, `${lines.join('\n')}\n`, 'utf8');
  return sorted;
}

export function upsertTrackedDecision({
  niche,
  city,
  state,
  decision,
  batchId = '',
  updatedAt = new Date().toISOString(),
}) {
  const next = {
    niche: String(niche || '').trim(),
    city: String(city || '').trim(),
    state: String(state || '')
      .trim()
      .toUpperCase(),
    decision: String(decision || '').trim(),
    batchId: String(batchId || '').trim(),
    updatedAt: String(updatedAt || new Date().toISOString()),
  };
  if (!next.niche || !next.city || !next.state) {
    throw new Error('tracked decision needs Niche, City, State');
  }
  const key = candidateGeoKey(next);
  const rows = loadTrackedDecisions().filter((r) => candidateGeoKey(r) !== key);
  rows.push(next);
  writeTrackedDecisions(rows);
  return next;
}

export function removeTrackedDecision({ niche, city, state }) {
  const key = candidateGeoKey({ niche, city, state });
  const before = loadTrackedDecisions();
  const rows = before.filter((r) => candidateGeoKey(r) !== key);
  writeTrackedDecisions(rows);
  return { removed: before.length - rows.length };
}

/** Candidates + tracked decisions for anti-dupe (candidates win on same geo). */
export function indexKnownForPrompt() {
  const map = indexCandidatesByGeo();
  for (const t of loadTrackedDecisions()) {
    const key = candidateGeoKey(t);
    if (map.has(key)) continue;
    map.set(key, {
      id: '',
      niche: t.niche,
      city: t.city,
      state: t.state,
      decision: t.decision,
      updatedAt: t.updatedAt,
      tracked: true,
    });
  }
  return map;
}

/** Rewrite research/known-candidates.csv from all candidates (not tracked). */
export function regenerateKnownCandidates() {
  mkdirSync(RESEARCH_DIR, { recursive: true });
  const rows = [...indexCandidatesByGeo().values()].sort((a, b) => {
    const ak = `${a.state}|${a.city}|${a.niche}`;
    const bk = `${b.state}|${b.city}|${b.niche}`;
    return ak.localeCompare(bk);
  });
  const lines = [KNOWN_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.niche),
        csvEscape(r.city),
        csvEscape(r.state),
        csvEscape(r.decision),
        csvEscape(r.id),
        csvEscape(r.updatedAt),
      ].join(','),
    );
  }
  writeFileSync(KNOWN_CSV, `${lines.join('\n')}\n`, 'utf8');
  return { path: KNOWN_CSV, count: rows.length, rows };
}

/**
 * Markdown/CSV block for Discovery Claude prompt.
 * @param {{ stateFilter?: string|null, limit?: number }} opts
 */
export function formatKnownCandidatesForPrompt({ stateFilter = null, limit = 500 } = {}) {
  const st = stateFilter ? String(stateFilter).trim().toUpperCase() : null;
  let rows = [...indexKnownForPrompt().values()];
  if (st) rows = rows.filter((r) => r.state === st);
  rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const total = rows.length;
  rows = rows.slice(0, Math.max(0, limit));

  if (!rows.length) {
    return '_No known candidates yet — you may propose any city×niche that fits the filters._';
  }

  const header = st
    ? `Known markets already in Rover (state ${st}; showing ${rows.length} of ${total}). Do **not** re-propose these Niche×City×State pairs — they are Candidates or previously tracked (pass/etc.).`
    : `Known markets already in Rover (showing ${rows.length} of ${total}). Do **not** re-propose these Niche×City×State pairs — they are Candidates or previously tracked (pass/etc.).`;

  const lines = [
    header,
    '',
    'Niche,City,State,decision,candidateId',
    ...rows.map(
      (r) =>
        `${csvEscape(r.niche)},${csvEscape(r.city)},${csvEscape(r.state)},${csvEscape(r.decision)},${csvEscape(r.id || (r.tracked ? 'tracked' : ''))}`,
    ),
  ];
  return lines.join('\n');
}

export function knownCandidatesCount() {
  return indexKnownForPrompt().size;
}

/** Safe regenerate after candidate mutations (never throws into API). */
export function safeRegenerateKnownCandidates() {
  try {
    return regenerateKnownCandidates();
  } catch (error) {
    console.warn('[known-candidates] regenerate failed:', error.message);
    return null;
  }
}

export function loadMetaDecision(id) {
  return loadMeta(id)?.decision ?? null;
}

export function pathsExist(id) {
  const p = pathsFor(id);
  return existsSync(p.config) || existsSync(p.research) || existsSync(p.meta);
}
