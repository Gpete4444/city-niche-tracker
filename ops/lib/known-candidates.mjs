/**
 * Living known-candidates index for Discovery anti-dupe.
 * Regenerated from research/*.meta.json + configs — not hand-edited as source of truth.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  RESEARCH_DIR,
  listCandidates,
  loadMeta,
  pathsFor,
} from './candidates.mjs';

const KNOWN_CSV = path.join(RESEARCH_DIR, 'known-candidates.csv');
const KNOWN_COLUMNS = ['Niche', 'City', 'State', 'decision', 'candidateId', 'updatedAt'];

function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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

/** Rewrite research/known-candidates.csv from all candidates. */
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
  let rows = [...indexCandidatesByGeo().values()];
  if (st) rows = rows.filter((r) => r.state === st);
  rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const total = rows.length;
  rows = rows.slice(0, Math.max(0, limit));

  if (!rows.length) {
    return '_No known candidates yet — you may propose any city×niche that fits the filters._';
  }

  const header = st
    ? `Known candidates already in Rover (state ${st}; showing ${rows.length} of ${total}). Do **not** re-propose these Niche×City×State pairs — they already live in Candidates (any decision group).`
    : `Known candidates already in Rover (showing ${rows.length} of ${total}). Do **not** re-propose these Niche×City×State pairs — they already live in Candidates (any decision group).`;

  const lines = [
    header,
    '',
    'Niche,City,State,decision,candidateId',
    ...rows.map(
      (r) =>
        `${csvEscape(r.niche)},${csvEscape(r.city)},${csvEscape(r.state)},${csvEscape(r.decision)},${csvEscape(r.id)}`,
    ),
  ];
  return lines.join('\n');
}

export function knownCandidatesCount() {
  return indexCandidatesByGeo().size;
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
