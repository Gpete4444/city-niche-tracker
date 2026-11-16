/**
 * Candidate city on an accepted site-config.
 * Lives outside site-config.mjs so candidates.mjs can heal primaryCity
 * without loading the site-config import cycle during startup.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathsFor } from './candidates.mjs';

function siteCityKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** City label from a string or object. Never use id / ID / placeId. */
export function suburbNameFromItem(x) {
  if (x == null) return '';
  if (typeof x === 'string' || typeof x === 'number') return String(x).trim();
  if (typeof x === 'object' && !Array.isArray(x)) {
    return String(x.name ?? x.city ?? x.label ?? x.place ?? '').trim();
  }
  if (Array.isArray(x)) return suburbNameFromItem(x[0]);
  return '';
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

/** Candidate city: research primary, then config `City,ST`. */
export function candidateCityFromDocs(research, config) {
  const fromResearch = String(research?.primaryCity || research?.summary?.primaryCity || '').trim();
  if (fromResearch) return fromResearch;
  return (
    String(config?.primary || '')
      .split(',')[0]
      ?.trim() || ''
  );
}

/** Candidate state: research state, then the ST half of config `City,ST`. */
export function candidateStateFromDocs(research, config) {
  const fromResearch = String(research?.state || research?.summary?.state || '')
    .trim()
    .toUpperCase();
  if (fromResearch) return fromResearch;
  return String(String(config?.primary || '').split(',')[1] || '')
    .trim()
    .toUpperCase();
}

/**
 * Site city is the candidate city. A street in a neighboring town must not become primaryCity,
 * and the site city is the homepage — not a suburb page.
 * Does not change the street address. A config for a different state is left alone
 * (it is not this candidate's site).
 */
export function restoreSiteCityConfig(config, siteCity, { siteState } = {}) {
  if (!config || typeof config !== 'object') return { config, changed: false };
  const city = String(siteCity || '').trim();
  if (!city) return { config, changed: false };
  const expectedState = String(siteState || '').trim().toUpperCase();
  const configState = String(config.state || '').trim().toUpperCase();
  if (expectedState && configState && expectedState !== configState) {
    return { config, changed: false };
  }
  const cityKey = siteCityKey(city);
  const primaryDrifted = siteCityKey(config.primaryCity) !== cityKey;
  const suburbs = Array.isArray(config.targetSuburbs) ? config.targetSuburbs : null;
  const nextSuburbs = suburbs
    ? suburbs.filter((item) => siteCityKey(suburbNameFromItem(item)) !== cityKey)
    : null;
  const suburbsDrifted = Boolean(suburbs && nextSuburbs.length !== suburbs.length);
  if (!primaryDrifted && !suburbsDrifted) return { config, changed: false };
  return {
    changed: true,
    config: {
      ...config,
      primaryCity: city,
      ...(suburbsDrifted ? { targetSuburbs: nextSuburbs } : {}),
    },
  };
}

/**
 * Persist a drifted accepted site-config so the Service area map locks the candidate city.
 * No-op when primaryCity already matches and the site city is not listed as a suburb page.
 */
export function persistRestoredSiteCity(candidateId, { research, config, raw } = {}) {
  const p = pathsFor(candidateId);
  const researchDoc = research === undefined ? readJson(p.research) : research;
  const configDoc = config === undefined ? readJson(p.config) : config;
  const siteCity = candidateCityFromDocs(researchDoc, configDoc);
  const siteState = candidateStateFromDocs(researchDoc, configDoc);
  const disk = raw === undefined ? readJson(p.siteConfig) : raw;
  if (!disk || typeof disk !== 'object') return { changed: false, config: disk || null };
  const { _ops, ...clean } = disk;
  const restored = restoreSiteCityConfig(clean, siteCity, { siteState });
  if (!restored.changed) return { changed: false, config: disk };
  const next = {
    ...restored.config,
    _ops: {
      ...(_ops && typeof _ops === 'object' ? _ops : {}),
      siteCityRestoredAt: new Date().toISOString(),
    },
  };
  writeJson(p.siteConfig, next);
  return { changed: true, config: next };
}
