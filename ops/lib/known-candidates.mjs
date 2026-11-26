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
  titleCaseNiche,
} from './candidates.mjs';
import {
  assertDeletableIds,
  isUndeletableCandidate,
  researchHighestEvalStep,
} from './candidate-protection.mjs';

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
  return [titleCaseNiche(niche), city, state]
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
 * Build a map geoKey → { id, niche, city, state, decision, updatedAt, archived }
 * @param {{ includeArchived?: boolean }} [opts]
 */
export function indexCandidatesByGeo({ includeArchived = true } = {}) {
  const map = new Map();
  for (const c of listCandidates()) {
    if (!includeArchived && c.archived) continue;
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
      archived: Boolean(c.archived),
    });
  }
  return map;
}

export function findCandidateByGeo({ niche, city, state }) {
  const key = candidateGeoKey({ niche, city, state });
  return indexCandidatesByGeo({ includeArchived: true }).get(key) || null;
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

/** Title-case Niche cells on tracked pass/hold rows. */
export function backfillTrackedNicheTitleCase() {
  const rows = loadTrackedDecisions();
  let changed = 0;
  const next = rows.map((row) => {
    const niche = titleCaseNiche(row.niche);
    if (niche === row.niche) return row;
    changed += 1;
    return { ...row, niche };
  });
  if (changed) writeTrackedDecisions(next);
  return { rows: changed };
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

/** Active Candidates + tracked decisions for anti-dupe (candidates win on same geo). Archived excluded. */
export function indexKnownForPrompt() {
  const map = indexCandidatesByGeo({ includeArchived: false });
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
  try {
    const claimedPath = path.join(RESEARCH_DIR, 'shotgun-claimed.json');
    if (existsSync(claimedPath)) {
      const claimed = JSON.parse(readFileSync(claimedPath, 'utf8'));
      for (const g of claimed.geos || []) {
        const key = candidateGeoKey(g);
        if (!key || map.has(key)) continue;
        map.set(key, {
          id: '',
          niche: g.niche,
          city: g.city,
          state: g.state,
          decision: 'shotgun',
          updatedAt: claimed.updatedAt || '',
          tracked: true,
        });
      }
    }
  } catch {
    /* optional shotgun claimed file */
  }
  return map;
}

/** Rewrite research/known-candidates.csv from active (non-archived) candidates. */
export function regenerateKnownCandidates() {
  mkdirSync(RESEARCH_DIR, { recursive: true });
  const rows = [...indexCandidatesByGeo({ includeArchived: false }).values()].sort((a, b) => {
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

/** Rows for Discovery Advanced editor (orphans/tracked + Research Eval exactly 1). */
export function listKnownForEditor() {
  const rows = [];
  const candKeys = new Set();
  for (const c of listCandidates()) {
    if (c.archived) continue;
    const niche = c.niche || c.meta?.niche || '';
    const city = c.primaryCity || parsePrimary(c.meta?.primary).city || '';
    const state = (c.state || parsePrimary(c.meta?.primary).state || '').toUpperCase();
    if (!niche || !city || !state) continue;
    if (isUndeletableCandidate(c.id)) continue;
    if (researchHighestEvalStep(c.id) !== 1) continue;
    const key = candidateGeoKey({ niche, city, state });
    candKeys.add(key);
    rows.push({
      niche,
      city,
      state,
      decision: c.decision || '',
      candidateId: c.id,
      source: 'candidate',
      updatedAt: c.updatedAt || c.meta?.updatedAt || '',
    });
  }
  for (const t of loadTrackedDecisions()) {
    if (candKeys.has(candidateGeoKey(t))) continue;
    rows.push({
      niche: t.niche,
      city: t.city,
      state: t.state,
      decision: t.decision,
      candidateId: '',
      source: 'tracked',
      updatedAt: t.updatedAt || '',
    });
  }
  rows.sort((a, b) => {
    const ak = `${a.state}|${a.city}|${a.niche}`;
    const bk = `${b.state}|${b.city}|${b.niche}`;
    return ak.localeCompare(bk);
  });
  return rows;
}

/** Preview counts for wipe-to-active (no mutations). */
export function previewPruneKnownToActive() {
  const all = listCandidates();
  const active = all.filter((c) => !c.archived);
  const archived = all.filter((c) => c.archived);
  const archivedDeletable = archived.filter((c) => !isUndeletableCandidate(c.id));
  const archivedProtected = archived.filter((c) => isUndeletableCandidate(c.id));
  const keepKeys = new Set();
  for (const c of active) {
    const niche = c.niche || c.meta?.niche || '';
    const city = c.primaryCity || parsePrimary(c.meta?.primary).city || '';
    const state = (c.state || parsePrimary(c.meta?.primary).state || '').toUpperCase();
    if (!niche || !city || !state) continue;
    keepKeys.add(candidateGeoKey({ niche, city, state }));
  }
  const tracked = loadTrackedDecisions();
  const trackedDrop = tracked.filter((t) => !keepKeys.has(candidateGeoKey(t)));
  return {
    keepCount: active.length,
    archivedDeleteCount: archivedDeletable.length,
    archivedProtectedCount: archivedProtected.length,
    archivedIds: archivedDeletable.map((c) => c.id),
    trackedDropCount: trackedDrop.length,
    knownAfter: keepKeys.size,
  };
}

/**
 * Keep Active Research candidates; permanently delete archived (except undeletable); drop tracked outside keep set.
 */
export async function pruneKnownToActiveCandidates() {
  const preview = previewPruneKnownToActive();
  const keepKeys = new Set();
  for (const c of listCandidates().filter((x) => !x.archived)) {
    const niche = c.niche || c.meta?.niche || '';
    const city = c.primaryCity || parsePrimary(c.meta?.primary).city || '';
    const state = (c.state || parsePrimary(c.meta?.primary).state || '').toUpperCase();
    if (!niche || !city || !state) continue;
    keepKeys.add(candidateGeoKey({ niche, city, state }));
  }

  let deleteResult = { deleted: [], errors: [] };
  if (preview.archivedIds.length) {
    assertDeletableIds(preview.archivedIds);
    const { deleteCandidates } = await import('./candidates.mjs');
    deleteResult = await deleteCandidates(preview.archivedIds);
  }

  const trackedBefore = loadTrackedDecisions();
  const trackedKeep = trackedBefore.filter((t) => keepKeys.has(candidateGeoKey(t)));
  const trackedDropped = trackedBefore.length - trackedKeep.length;
  writeTrackedDecisions(trackedKeep);
  const known = regenerateKnownCandidates();

  return {
    keepCount: preview.keepCount,
    archivedDeleted: deleteResult.deleted?.length || 0,
    archivedProtected: preview.archivedProtectedCount || 0,
    archivedErrors: deleteResult.errors || [],
    trackedDropped,
    knownCount: known.count,
    rows: listKnownForEditor(),
  };
}

/**
 * Remove known entries by Niche×City×State. Candidate → permanent delete; tracked-only → untrack.
 * Refuses any key that maps to an undeletable (Launched) candidate (no partial wipe).
 */
export async function removeKnownEntries(keys = []) {
  const list = Array.isArray(keys) ? keys : [];
  const idsToDelete = [];
  const trackedToRemove = [];
  const seenIds = new Set();
  const blockedKeys = [];

  for (const raw of list) {
    const niche = String(raw?.niche || '').trim();
    const city = String(raw?.city || '').trim();
    const state = String(raw?.state || '')
      .trim()
      .toUpperCase();
    if (!niche || !city || !state) continue;
    const existing = findCandidateByGeo({ niche, city, state });
    if (existing?.id) {
      if (isUndeletableCandidate(existing.id)) {
        blockedKeys.push({ niche, city, state, candidateId: existing.id });
        continue;
      }
      if (!seenIds.has(existing.id)) {
        seenIds.add(existing.id);
        idsToDelete.push(existing.id);
      }
      continue;
    }
    trackedToRemove.push({ niche, city, state });
  }

  if (blockedKeys.length) {
    const err = new Error(
      `Cannot remove Launched Candidate(s) from do-not-repropose: ${blockedKeys
        .map((k) => k.candidateId)
        .join(', ')}`,
    );
    err.status = 409;
    err.code = 'UNDELETABLE_CANDIDATE';
    err.details = { blocked: blockedKeys };
    throw err;
  }

  let trackedRemoved = 0;
  for (const t of trackedToRemove) {
    const r = removeTrackedDecision(t);
    trackedRemoved += r.removed;
  }

  let deleteResult = { deleted: [], errors: [] };
  if (idsToDelete.length) {
    assertDeletableIds(idsToDelete);
    const { deleteCandidates } = await import('./candidates.mjs');
    deleteResult = await deleteCandidates(idsToDelete);
  } else {
    regenerateKnownCandidates();
  }

  return {
    deletedCandidates: deleteResult.deleted?.length || 0,
    deleteErrors: deleteResult.errors || [],
    trackedRemoved,
    rows: listKnownForEditor(),
  };
}

function compactKnownCell(value) {
  return String(value || '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Coerce stateFilter (string or array) to unique 2-letter abbrs, or null for nationwide.
 * @param {string|string[]|null|undefined} stateFilter
 * @returns {string[]|null}
 */
export function knownStateFilterList(stateFilter) {
  if (stateFilter == null || stateFilter === '') return null;
  const list = Array.isArray(stateFilter) ? stateFilter : [stateFilter];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const st = String(item || '')
      .trim()
      .toUpperCase();
    if (st.length !== 2 || seen.has(st)) continue;
    seen.add(st);
    out.push(st);
  }
  return out.length ? out : null;
}

/**
 * Markdown/CSV block for Discovery Claude prompt.
 * @param {{ stateFilter?: string|string[]|null, limit?: number, compact?: boolean }} opts
 */
export function formatKnownCandidatesForPrompt({
  stateFilter = null,
  limit = 500,
  compact = false,
} = {}) {
  const states = knownStateFilterList(stateFilter);
  let rows = [...indexKnownForPrompt().values()];
  if (states) {
    const allow = new Set(states);
    rows = rows.filter((r) => allow.has(r.state));
  }
  rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const total = rows.length;
  rows = rows.slice(0, Math.max(0, limit));

  if (!rows.length) {
    return '_No known candidates yet — you may propose any city×niche that fits the filters._';
  }

  const stateLabel = states
    ? states.length === 1
      ? `state ${states[0]}`
      : `states ${states.join(', ')}`
    : null;
  const header = stateLabel
    ? `Known markets already in Rover (${stateLabel}; showing ${rows.length} of ${total}). Do **not** re-propose these Niche×City×State pairs — they are Candidates or previously tracked (pass/etc.).`
    : `Known markets already in Rover (showing ${rows.length} of ${total}). Do **not** re-propose these Niche×City×State pairs — they are Candidates or previously tracked (pass/etc.).`;

  if (compact) {
    return [
      `${header} Format: niche|city|ST`,
      '',
      ...rows.map(
        (r) =>
          `${compactKnownCell(r.niche)}|${compactKnownCell(r.city)}|${compactKnownCell(r.state)}`,
      ),
    ].join('\n');
  }

  const lines = [
    header,
    '',
    'Niche,City,State',
    ...rows.map(
      (r) => `${csvEscape(r.niche)},${csvEscape(r.city)},${csvEscape(r.state)}`,
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
