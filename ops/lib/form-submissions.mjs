/**
 * Local copy of lead-form submissions.
 * Storage: research/form-submissions.jsonl (one JSON object per line).
 * Source of truth for new leads is the shared Cloudflare D1 inbox; this file is the dashboard cache.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RESEARCH_DIR } from './candidates.mjs';
import { formIsSpam, loadSpamKeywords } from './spam-keywords.mjs';

const SUBMISSIONS_FILE = path.join(RESEARCH_DIR, 'form-submissions.jsonl');
export const FORM_STATS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Identical leads closer than this are one submission. Keep the earliest. */
export const FORM_DEDUPE_WINDOW_MS = 2 * 60 * 1000;

function ensureFile() {
  mkdirSync(RESEARCH_DIR, { recursive: true });
  if (!existsSync(SUBMISSIONS_FILE)) writeFileSync(SUBMISSIONS_FILE, '', 'utf8');
}

let cache = { mtimeMs: 0, size: -1, rows: null };

function invalidate() {
  cache = { mtimeMs: 0, size: -1, rows: null };
}

export function normalizeLeadDomain(value) {
  let domain = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
  if (domain.startsWith('www.')) domain = domain.slice(4);
  return domain;
}

function readAll() {
  ensureFile();
  const st = statSync(SUBMISSIONS_FILE);
  if (cache.rows && cache.mtimeMs === st.mtimeMs && cache.size === st.size) {
    return cache.rows;
  }
  const text = readFileSync(SUBMISSIONS_FILE, 'utf8');
  if (!text.trim()) {
    cache = { mtimeMs: st.mtimeMs, size: st.size, rows: [] };
    return cache.rows;
  }
  const rows = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      rows.push(JSON.parse(s));
    } catch {
      /* skip bad line */
    }
  }
  cache = { mtimeMs: st.mtimeMs, size: st.size, rows };
  return rows;
}

function rewrite(rows) {
  ensureFile();
  const body = rows.map((row) => JSON.stringify(row)).join('\n');
  writeFileSync(SUBMISSIONS_FILE, body ? `${body}\n` : '', 'utf8');
  invalidate();
}

function asRow(raw) {
  const id = String(raw?.id || '').trim();
  if (!id) return null;
  return {
    id,
    domain: normalizeLeadDomain(raw.domain),
    submittedAt: String(raw.submittedAt || raw.submitted_at || '').trim(),
    pageUrl: String(raw.pageUrl || raw.page_url || '').trim(),
    name: String(raw.name || '').trim(),
    phone: String(raw.phone || '').trim(),
    email: String(raw.email || '').trim(),
    service: String(raw.service || '').trim(),
    message: String(raw.message || '').trim(),
  };
}

/** Same domain, page, name, phone, email, service, and message. */
export function formSubmissionIdentity(row) {
  return [
    normalizeLeadDomain(row?.domain),
    String(row?.pageUrl || row?.page_url || '').trim(),
    String(row?.name || '').trim(),
    String(row?.phone || '').trim(),
    String(row?.email || '').trim(),
    String(row?.service || '').trim(),
    String(row?.message || '').trim(),
  ].join('\0');
}

function submissionTime(row) {
  const t = Date.parse(row?.submittedAt || row?.submitted_at || '');
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Drop a later copy of the same lead inside FORM_DEDUPE_WINDOW_MS.
 * The earliest submittedAt stays. A spam override on a dropped copy is kept
 * when the row that stays does not already have one.
 * @param {object[]} rows
 * @returns {{ rows: object[], removedIds: string[] }}
 */
export function collapseDuplicateFormSubmissions(rows) {
  const indexed = (rows || []).map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    const ta = submissionTime(a.row);
    const tb = submissionTime(b.row);
    const aOk = Number.isFinite(ta);
    const bOk = Number.isFinite(tb);
    if (aOk !== bOk) return aOk ? -1 : 1;
    if (aOk && ta !== tb) return ta - tb;
    const idCmp = String(a.row?.id || '').localeCompare(String(b.row?.id || ''));
    if (idCmp) return idCmp;
    return a.index - b.index;
  });
  /** @type {Map<string, object[]>} */
  const keptByKey = new Map();
  const kept = [];
  const removedIds = [];
  for (const { row } of indexed) {
    const key = formSubmissionIdentity(row);
    const t = submissionTime(row);
    const prior = keptByKey.get(key) || [];
    const match = Number.isFinite(t)
      ? prior.find((prev) => {
          const pt = submissionTime(prev);
          return Number.isFinite(pt) && t >= pt && t - pt <= FORM_DEDUPE_WINDOW_MS;
        })
      : null;
    if (!match) {
      prior.push(row);
      keptByKey.set(key, prior);
      kept.push(row);
      continue;
    }
    const id = String(row?.id || '').trim();
    if (id) removedIds.push(id);
    if (
      (row.spamOverride === true || row.spamOverride === false) &&
      match.spamOverride !== true &&
      match.spamOverride !== false
    ) {
      match.spamOverride = row.spamOverride;
    }
  }
  return { rows: kept, removedIds };
}

/** Merge by id, then drop identical leads inside the dedupe window. */
export function upsertFormSubmissions(incoming) {
  const rows = readAll();
  const before = new Set(rows.map((row) => row.id));
  const byId = new Map(rows.map((row) => [row.id, row]));
  let touched = false;
  for (const raw of incoming || []) {
    const next = asRow(raw);
    if (!next) continue;
    const prev = byId.get(next.id);
    if (!prev) {
      byId.set(next.id, next);
      touched = true;
      continue;
    }
    const merged = { ...prev, ...next };
    if (
      (prev.spamOverride === true || prev.spamOverride === false) &&
      next.spamOverride !== true &&
      next.spamOverride !== false
    ) {
      merged.spamOverride = prev.spamOverride;
    }
    byId.set(next.id, merged);
    touched = true;
  }
  const collapsed = collapseDuplicateFormSubmissions([...byId.values()]);
  if (collapsed.removedIds.length) touched = true;
  if (touched) rewrite(collapsed.rows);
  const added = collapsed.rows.reduce((n, row) => n + (before.has(row.id) ? 0 : 1), 0);
  return { added, total: collapsed.rows.length, removed: collapsed.removedIds.length };
}

/** One-time pass over the local cache. Returns the ids that were dropped. */
export function dedupeStoredFormSubmissions() {
  const collapsed = collapseDuplicateFormSubmissions(readAll());
  if (collapsed.removedIds.length) rewrite(collapsed.rows);
  return { removedIds: collapsed.removedIds, total: collapsed.rows.length };
}

export function listFormSubmissions({ limit = 2000 } = {}) {
  const rows = readAll()
    .slice()
    .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
  const cap = Math.max(1, Math.min(10000, Number(limit) || 2000));
  return flagFormSpam(rows.slice(0, cap));
}

function flagFormSpam(rows) {
  const keywords = loadSpamKeywords();
  return rows.map((row) => ({ ...row, spam: formIsSpam(row, keywords) }));
}

export function getFormSubmission(id) {
  const key = String(id || '').trim();
  if (!key) return null;
  const row = readAll().find((item) => item.id === key);
  return row ? flagFormSpam([row])[0] : null;
}

export function setFormSpamOverride(id, spam) {
  if (spam !== true && spam !== false) {
    const err = new Error('spam must be true or false');
    err.status = 400;
    throw err;
  }
  const key = String(id || '').trim();
  const rows = readAll();
  const idx = rows.findIndex((row) => row.id === key);
  if (idx < 0) {
    const err = new Error('Submission not found');
    err.status = 404;
    throw err;
  }
  rows[idx] = { ...rows[idx], spamOverride: spam };
  rewrite(rows);
  return getFormSubmission(key);
}

export function countSince(rows, timeKey, sinceMs) {
  let n = 0;
  for (const row of rows || []) {
    const t = Date.parse(row?.[timeKey] || '');
    if (Number.isFinite(t) && t >= sinceMs) n += 1;
  }
  return n;
}

/** @param {string} iso */
export function formCountsForDomain(rows, domain, now = Date.now()) {
  const want = normalizeLeadDomain(domain);
  const mine = (rows || []).filter((row) => normalizeLeadDomain(row.domain) === want);
  const since = now - FORM_STATS_WINDOW_MS;
  return {
    forms: mine.length,
    forms7d: countSince(mine, 'submittedAt', since),
  };
}

export function callInstant(call) {
  return call?.startedAt || call?.endedAt || call?.createdAt || '';
}

export function callCountsForSite(calls, siteId, now = Date.now()) {
  const id = String(siteId || '');
  const mine = (calls || []).filter((call) => String(call?.siteId || '') === id);
  const since = now - FORM_STATS_WINDOW_MS;
  return {
    calls: mine.length,
    calls7d: countSince(mine.map((call) => ({ at: callInstant(call) })), 'at', since),
  };
}
