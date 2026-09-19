/**
 * Shared Concurrent Limit values for this Rover process.
 * Source of truth: research/_rover/concurrency-settings.json
 * Migrates eval-concurrency.json and Jobs K in runtime-settings.json once.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ROVER_DIR = path.join(ROOT, 'research', '_rover');
const FILE = path.join(ROVER_DIR, 'concurrency-settings.json');
const EVAL_LEGACY = path.join(ROVER_DIR, 'eval-concurrency.json');
const RUNTIME_LEGACY = path.join(ROVER_DIR, 'runtime-settings.json');

export const CONCURRENCY_KEYS = [
  'lightSerp',
  'generatePack',
  'evaluations',
  'writeSite',
  'openaiPhotos',
  'openaiBeforeAfter',
  'heavy',
  'assembledPreviews',
];

export const CONCURRENCY_DEFAULTS = {
  lightSerp: 5,
  generatePack: 5,
  evaluations: 6,
  writeSite: 6,
  openaiPhotos: 5,
  openaiBeforeAfter: 2,
  heavy: 5,
  assembledPreviews: 5,
};

export const CONCURRENCY_MAX = {
  lightSerp: 100,
  generatePack: 10,
  evaluations: 100,
  writeSite: 50,
  openaiPhotos: 50,
  openaiBeforeAfter: 20,
  heavy: 12,
  assembledPreviews: 8,
};

export const CONCURRENCY_MIN = 1;

export const CONCURRENCY_LABELS = {
  lightSerp: 'Light SERP',
  generatePack: 'Generate pack',
  evaluations: 'Evaluations',
  writeSite: 'Write site',
  openaiPhotos: 'OpenAI photos',
  openaiBeforeAfter: 'OpenAI before/after',
  heavy: 'Heavy (Prepare / Launch)',
  assembledPreviews: 'Assembled previews',
};

function readJson(file) {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {unknown} n
 * @returns {number}
 */
export function clampConcurrencyKey(key, n) {
  const def = CONCURRENCY_DEFAULTS[key] ?? CONCURRENCY_DEFAULTS.evaluations;
  const max = CONCURRENCY_MAX[key] ?? 50;
  if (n == null || n === '') return def;
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return def;
  return Math.max(CONCURRENCY_MIN, Math.min(max, v));
}

function emptyValues() {
  const out = {};
  for (const key of CONCURRENCY_KEYS) out[key] = CONCURRENCY_DEFAULTS[key];
  return out;
}

function normalize(raw) {
  const out = emptyValues();
  if (!raw || typeof raw !== 'object') return out;
  for (const key of CONCURRENCY_KEYS) {
    if (raw[key] != null) out[key] = clampConcurrencyKey(key, raw[key]);
  }
  return out;
}

function migrateFromLegacy() {
  const values = emptyValues();
  const evalRaw = readJson(EVAL_LEGACY);
  if (evalRaw) {
    values.evaluations = clampConcurrencyKey(
      'evaluations',
      evalRaw.value ?? evalRaw.concurrency ?? evalRaw.evaluations,
    );
  }
  const runtimeRaw = readJson(RUNTIME_LEGACY);
  if (runtimeRaw && runtimeRaw.concurrency != null) {
    values.heavy = clampConcurrencyKey('heavy', runtimeRaw.concurrency);
  } else if (process.env.ROVER_SHIP_CONCURRENCY) {
    values.heavy = clampConcurrencyKey('heavy', process.env.ROVER_SHIP_CONCURRENCY);
  }
  return values;
}

function loadValues() {
  const existing = readJson(FILE);
  if (existing) return normalize(existing);
  const migrated = migrateFromLegacy();
  writeValues(migrated);
  return migrated;
}

function writeValues(values) {
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(
    FILE,
    `${JSON.stringify({ ...values, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
}

export function getConcurrency() {
  return loadValues();
}

/**
 * @param {Record<string, unknown>} partial
 * @returns {Record<string, number>}
 */
export function setConcurrencySettings(partial = {}) {
  const current = loadValues();
  const next = { ...current };
  if (partial && typeof partial === 'object') {
    for (const key of CONCURRENCY_KEYS) {
      if (partial[key] != null && partial[key] !== '') {
        next[key] = clampConcurrencyKey(key, partial[key]);
      }
    }
  }
  writeValues(next);
  return next;
}

export function concurrencyPayload() {
  const values = getConcurrency();
  return {
    ...values,
    min: CONCURRENCY_MIN,
    max: { ...CONCURRENCY_MAX },
    defaults: { ...CONCURRENCY_DEFAULTS },
    labels: { ...CONCURRENCY_LABELS },
  };
}
