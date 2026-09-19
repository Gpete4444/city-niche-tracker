/**
 * Also serving = leftover coverage cities (not a location page), capped like Site-Config.
 * Zone UI shows the 10 nearest; Accept persists that list for the assembled site.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathsFor } from './candidates.mjs';
import { leftoverMilesFromPrimary, clusterForCandidate } from './shotgun.mjs';
import { toCoverageAreas } from './geo-neighbors.mjs';

export const ALSO_SERVING_CAP = 10;

const ROOT = process.cwd();
const SITE_CONFIG_PATH = path.join(ROOT, 'src', 'config', 'site-config.json');

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

function coverageCityNames({ coverageAreas, state } = {}) {
  const out = [];
  const seen = new Set();
  const siteState = norm(state);
  for (const a of coverageAreas || []) {
    const name = String(a?.name || '').trim();
    if (!name) continue;
    const key = norm(name);
    if (seen.has(key)) continue;
    if (a?.state && siteState && norm(a.state) !== siteState) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function seoLocationKeys({ primaryCity, targetSuburbs } = {}) {
  const keys = new Set();
  const primary = String(primaryCity || '').trim();
  if (primary) keys.add(norm(primary));
  for (const s of targetSuburbs || []) {
    const name = String(s || '').trim();
    if (name) keys.add(norm(name));
  }
  return keys;
}

/** Coverage cities that are not primary / targetSuburbs (location pages). */
export function leftoverCoverageNames(site = {}) {
  const seo = seoLocationKeys(site);
  return coverageCityNames(site).filter((name) => !seo.has(norm(name)));
}

/**
 * Nearest leftover coverage names, capped (default 10).
 * `distanceMiles(name, state)` optional — when omitted, keep coverage order.
 */
export function deriveAlsoServingNames({
  coverageAreas,
  primaryCity,
  targetSuburbs,
  state,
  distanceMiles = null,
  skipName = null,
  cap = ALSO_SERVING_CAP,
} = {}) {
  const leftovers = leftoverCoverageNames({
    coverageAreas,
    primaryCity,
    targetSuburbs,
    state,
  }).filter((name) => (typeof skipName === 'function' ? !skipName(name, state) : true));
  const st = String(state || '').trim();
  if (typeof distanceMiles === 'function') {
    leftovers.sort((a, b) => {
      const da = Number(distanceMiles(a, st));
      const db = Number(distanceMiles(b, st));
      const na = Number.isFinite(da) ? da : Number.POSITIVE_INFINITY;
      const nb = Number.isFinite(db) ? db : Number.POSITIVE_INFINITY;
      if (na !== nb) return na - nb;
      return a.localeCompare(b);
    });
  }
  const limit = Math.max(0, Number(cap) || ALSO_SERVING_CAP);
  return leftovers.slice(0, limit);
}

export function coverageNameKeys(areas) {
  return (Array.isArray(areas) ? areas : [])
    .map((a) => norm(typeof a === 'string' ? a : a?.name))
    .filter(Boolean)
    .sort()
    .join('|');
}

/** Persist only location pages + Also serving (not the full radius). */
export function coverageAreasForPlan({
  primaryCity,
  state,
  targetSuburbs = [],
  alsoServing = [],
} = {}) {
  const selected = [...(targetSuburbs || []), ...(alsoServing || [])].map((name) => ({
    name: String(name || '').trim(),
    state,
  }));
  return toCoverageAreas(selected, primaryCity, state);
}

export function alsoServingListsEqual(a, b) {
  const aa = (Array.isArray(a) ? a : []).map((s) => norm(s)).filter(Boolean);
  const bb = (Array.isArray(b) ? b : []).map((s) => norm(s)).filter(Boolean);
  if (aa.length !== bb.length) return false;
  return aa.every((v, i) => v === bb[i]);
}

/**
 * Names the site should list: persisted alsoServing if present, else leftover coverage.
 * Always excludes location-page cities and caps at 10.
 */
export function alsoServingNamesFromSite(site = {}, { cap = ALSO_SERVING_CAP } = {}) {
  const seo = seoLocationKeys(site);
  const limit = Math.max(0, Number(cap) || ALSO_SERVING_CAP);
  const saved = (Array.isArray(site.alsoServing) ? site.alsoServing : [])
    .map((s) => String(s || '').trim())
    .filter((name) => name && !seo.has(norm(name)));
  if (saved.length) return saved.slice(0, limit);
  return leftoverCoverageNames(site).slice(0, limit);
}

/** Return `{ config, changed, alsoServing }` with derived alsoServing and trimmed coverage. */
export function withDerivedAlsoServing(
  config,
  { distanceMiles = null, skipName = null, cap = ALSO_SERVING_CAP } = {},
) {
  if (!config || typeof config !== 'object') {
    return { config, changed: false, alsoServing: [] };
  }
  const alsoServing = deriveAlsoServingNames({
    coverageAreas: config.coverageAreas,
    primaryCity: config.primaryCity,
    targetSuburbs: config.targetSuburbs,
    state: config.state,
    distanceMiles,
    skipName,
    cap,
  });
  const coverageAreas = coverageAreasForPlan({
    primaryCity: config.primaryCity,
    state: config.state,
    targetSuburbs: config.targetSuburbs,
    alsoServing,
  });
  const changed =
    !alsoServingListsEqual(config.alsoServing, alsoServing) ||
    coverageNameKeys(config.coverageAreas) !== coverageNameKeys(coverageAreas);
  return {
    config: changed ? { ...config, alsoServing, coverageAreas } : config,
    changed,
    alsoServing,
    coverageAreas,
  };
}

/**
 * Fill or refresh alsoServing on accepted site-config (and template mirror when that is live).
 * Used on coverage-map generate / Stage so existing Accepts pick up the 10-cap without reopening step 6.
 */
export function ensureAlsoServingOnSiteConfig(candidateId) {
  const p = pathsFor(candidateId);
  const acceptedRaw = readJson(p.siteConfig);
  if (!acceptedRaw || typeof acceptedRaw !== 'object') {
    return { ok: false, changed: false, alsoServing: [] };
  }
  const { _ops, ...accepted } = acceptedRaw;
  const inZone = Boolean(clusterForCandidate(candidateId));
  const { config: next, changed, alsoServing } = withDerivedAlsoServing(accepted, {
    distanceMiles: inZone
      ? (name, st) => leftoverMilesFromPrimary(name, st, candidateId)
      : null,
  });
  if (!changed) {
    return { ok: true, changed: false, alsoServing, config: next };
  }

  writeJson(p.siteConfig, {
    ...next,
    ...(_ops && typeof _ops === 'object' ? { _ops } : {}),
  });

  const meta = readJson(p.meta) || {};
  if (meta.siteConfigPath === 'src/config/site-config.json') {
    writeJson(SITE_CONFIG_PATH, next);
  }

  return { ok: true, changed: true, alsoServing, config: next };
}
