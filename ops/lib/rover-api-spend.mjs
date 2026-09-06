/**
 * Cumulative Rover-recorded spend for pay-as-you-go providers (Anthropic, OpenAI, Google Maps).
 * Not a vendor invoice — list-price / estimates Rover already logs.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RESEARCH_DIR = path.join(process.cwd(), 'research');
const SPEND_FILE = path.join(RESEARCH_DIR, 'rover-api-spend.json');

export const ROVER_PAYG_PROVIDERS = ['anthropic', 'openai', 'googleMaps'];

function roundUsd(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(6));
}

function defaultSpend(partial = {}) {
  return {
    anthropic: roundUsd(partial.anthropic),
    openai: roundUsd(partial.openai),
    googleMaps: roundUsd(partial.googleMaps),
    updatedAt: partial.updatedAt || new Date().toISOString(),
    seededAt: partial.seededAt || null,
  };
}

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * One-time totals from existing candidate files.
 * Anthropic/Maps are last-run per candidate (re-runs under-counted). OpenAI lastCosts are cumulative.
 */
function seedFromDisk() {
  let anthropic = 0;
  let openai = 0;
  let googleMaps = 0;
  if (!existsSync(RESEARCH_DIR)) {
    return defaultSpend({ anthropic, openai, googleMaps, seededAt: new Date().toISOString() });
  }
  let files = [];
  try {
    files = readdirSync(RESEARCH_DIR);
  } catch {
    files = [];
  }
  for (const file of files) {
    const full = path.join(RESEARCH_DIR, file);
    if (file.endsWith('.meta.json')) {
      const meta = readJson(full, null);
      const lc = meta?.lastCosts || {};
      anthropic += money(lc.narrative) + money(lc.outreach);
      openai += money(lc.openai);
    } else if (file.endsWith('-business-address.json')) {
      const pkg = readJson(full, null);
      googleMaps += money(pkg?.lastSearchCost?.placesEstUsd);
    }
  }
  return defaultSpend({
    anthropic,
    openai,
    googleMaps,
    seededAt: new Date().toISOString(),
  });
}

function loadOrSeed() {
  if (existsSync(SPEND_FILE)) {
    const raw = readJson(SPEND_FILE, null);
    if (raw && typeof raw === 'object') return defaultSpend(raw);
  }
  const seeded = seedFromDisk();
  writeJson(SPEND_FILE, seeded);
  return seeded;
}

export function getRoverApiSpend() {
  return loadOrSeed();
}

/** Add a positive USD amount to a PAYG provider. No-op on invalid provider or non-positive delta.
 * Sync read-modify-write is atomic on this Node process (one thread); concurrent jobs
 * cannot interleave inside this function.
 */
export function recordRoverApiSpend(provider, usd) {
  const key = String(provider || '').trim();
  if (!ROVER_PAYG_PROVIDERS.includes(key)) return loadOrSeed();
  const delta = Number(usd);
  if (!Number.isFinite(delta) || delta <= 0) return loadOrSeed();
  const current = loadOrSeed();
  current[key] = roundUsd(Number(current[key] || 0) + delta);
  current.updatedAt = new Date().toISOString();
  writeJson(SPEND_FILE, current);
  return current;
}
