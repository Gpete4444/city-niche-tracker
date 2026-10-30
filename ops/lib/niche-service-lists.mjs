/**
 * One residential + commercial service-name list per niche.
 * Review Services can load it onto a site; Write site still writes each site.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listCandidates, pathsFor, RESEARCH_DIR, titleCaseNiche } from './candidates.mjs';

const STORE_FILE = path.join(RESEARCH_DIR, '_niche-service-lists.json');
const MAX_NAMES = 12;

export function normalizeServiceNameList(raw) {
  const items = Array.isArray(raw) ? raw : String(raw ?? '').split(/[;\n]/);
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const name = titleCaseNiche(item);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_NAMES) break;
  }
  return out;
}

function readStore(filePath) {
  if (!existsSync(filePath)) return { lists: {} };
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!data || typeof data.lists !== 'object' || !data.lists) return { lists: {} };
    return { lists: data.lists };
  } catch {
    return { lists: {} };
  }
}

function writeStore(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function getNicheServiceList(niche, filePath = STORE_FILE) {
  const label = titleCaseNiche(niche);
  if (!label) return null;
  const store = readStore(filePath);
  return store.lists[label.toLowerCase()] || null;
}

export function saveNicheServiceList(
  { niche, services, commercialServices } = {},
  filePath = STORE_FILE,
) {
  const label = titleCaseNiche(niche);
  if (!label) {
    throw Object.assign(new Error('Niche is required'), { status: 400 });
  }
  const nextServices = normalizeServiceNameList(services);
  const nextCommercial = normalizeServiceNameList(commercialServices);
  if (!nextServices.length) {
    throw Object.assign(
      new Error('Check at least one residential service before saving a niche default.'),
      { status: 400 },
    );
  }
  const store = readStore(filePath);
  const record = {
    niche: label,
    services: nextServices,
    commercialServices: nextCommercial,
    updatedAt: new Date().toISOString(),
  };
  store.lists[label.toLowerCase()] = record;
  writeStore(filePath, store);
  return record;
}

function readConfigFile(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Position 1 scores 12, position 12 scores 1. Later copies of a name add to that score. Pass `limit: null` to keep every ranked name. */
export function rankServiceNames(lists, limit = MAX_NAMES) {
  const scores = new Map();
  for (const raw of lists || []) {
    const names = normalizeServiceNameList(raw);
    names.forEach((name, index) => {
      const key = name.toLowerCase();
      const points = 13 - (index + 1);
      const prev = scores.get(key);
      if (!prev) scores.set(key, { name, score: points });
      else prev.score += points;
    });
  }
  const ranked = [...scores.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((row) => row.name);
  if (limit == null) return ranked;
  return ranked.slice(0, limit);
}

/** Next names in rank order, skipping ones removed in this dialog. */
export function visibleServiceNames(ranked, removed = [], limit = MAX_NAMES) {
  const skip = new Set(
    (removed || [])
      .map((name) => String(name ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  const out = [];
  for (const name of ranked || []) {
    const label = String(name ?? '').trim();
    if (!label || skip.has(label.toLowerCase())) continue;
    out.push(label);
    if (limit != null && out.length >= limit) break;
  }
  return out;
}

function serviceListsFromConfig(cfg) {
  if (!cfg) return null;
  const services = normalizeServiceNameList(cfg.services);
  const commercialServices = normalizeServiceNameList(cfg.commercialServices);
  if (!services.length && !commercialServices.length) return null;
  return { services, commercialServices };
}

function isCommercialServiceName(name) {
  return /\bcommercial\b/i.test(name);
}

/** Research JSON stores an array. Discovery seeds are a semicolon or comma list. */
function normalizeSuggestedServiceNames(raw) {
  if (Array.isArray(raw)) return normalizeServiceNameList(raw);
  const text = String(raw ?? '').trim();
  if (!text) return [];
  const parts = /[;\n]/.test(text) ? text.split(/[;\n]/) : text.split(',');
  return normalizeServiceNameList(parts);
}

/**
 * Research suggestions are a second ballot. A name already on that city's site-config
 * for the same column is not scored again. "Commercial" in the name votes commercial.
 */
function splitSuggestedServices(raw, siteServices, siteCommercial) {
  const residentialSeen = new Set((siteServices || []).map((name) => name.toLowerCase()));
  const commercialSeen = new Set((siteCommercial || []).map((name) => name.toLowerCase()));
  const residential = [];
  const commercial = [];
  for (const name of normalizeSuggestedServiceNames(raw)) {
    const key = name.toLowerCase();
    if (isCommercialServiceName(name)) {
      if (commercialSeen.has(key)) continue;
      commercial.push(name);
      commercialSeen.add(key);
    } else if (!residentialSeen.has(key)) {
      residential.push(name);
      residentialSeen.add(key);
    }
  }
  return { residential, commercial };
}

function nicheKeyMatches(rawNiche, key) {
  const nicheKey = titleCaseNiche(rawNiche || '').toLowerCase();
  return !nicheKey || nicheKey === key;
}

function suggestedServicesFromFiles(p, key) {
  const research = readConfigFile(p.research);
  if (research && nicheKeyMatches(research.niche, key)) {
    if (normalizeSuggestedServiceNames(research.suggestedServices).length) {
      return research.suggestedServices;
    }
  }
  const seed = readConfigFile(p.discoverySeed);
  if (!seed || !nicheKeyMatches(seed.niche, key)) return null;
  return seed.suggestedServices ?? null;
}

function collectNicheServiceSources(label) {
  const key = label.toLowerCase();
  const out = [];
  for (const row of listCandidates()) {
    if (titleCaseNiche(row?.niche).toLowerCase() !== key) continue;
    let p;
    try {
      p = pathsFor(row.id);
    } catch {
      continue;
    }
    const accepted = readConfigFile(p.siteConfig);
    const cfg = accepted || readConfigFile(p.siteConfigDraft);
    const cfgNicheOk = cfg && titleCaseNiche(cfg.niche || row.niche).toLowerCase() === key;
    const site = cfgNicheOk ? serviceListsFromConfig(cfg) : null;
    const suggestedServices = suggestedServicesFromFiles(p, key);
    if (!site && !normalizeSuggestedServiceNames(suggestedServices).length) continue;
    out.push({
      niche: label,
      services: site?.services || [],
      commercialServices: site?.commercialServices || [],
      suggestedServices,
    });
  }
  return out;
}

/**
 * Rank service names already stored for this niche.
 * Site-config lists and research suggestions are separate ballots.
 * Pass `sources` in tests. Otherwise reads accepted site-configs (draft only when none is accepted)
 * plus research suggestedServices, or the discovery seed when research has none.
 * @returns {{ niche: string, services: string[], commercialServices: string[], cityCount: number, siteCount: number, researchCount: number }}
 */
export function buildNicheServiceList(niche, sources) {
  const label = titleCaseNiche(niche);
  if (!label) {
    throw Object.assign(new Error('Niche is required'), { status: 400 });
  }
  const key = label.toLowerCase();
  const rows = Array.isArray(sources) ? sources : collectNicheServiceSources(label);
  const serviceBallots = [];
  const commercialBallots = [];
  let cityCount = 0;
  let siteCount = 0;
  let researchCount = 0;
  for (const row of rows) {
    if (titleCaseNiche(row?.niche || label).toLowerCase() !== key) continue;
    const site = serviceListsFromConfig(row);
    const siteServices = site?.services || [];
    const siteCommercial = site?.commercialServices || [];
    const suggested = splitSuggestedServices(row?.suggestedServices, siteServices, siteCommercial);
    const hasSite = Boolean(site);
    const hasResearch = suggested.residential.length > 0 || suggested.commercial.length > 0;
    if (!hasSite && !hasResearch) continue;
    cityCount += 1;
    if (hasSite) {
      siteCount += 1;
      serviceBallots.push(siteServices);
      commercialBallots.push(siteCommercial);
    }
    if (hasResearch) {
      researchCount += 1;
      serviceBallots.push(suggested.residential);
      commercialBallots.push(suggested.commercial);
    }
  }
  return {
    niche: label,
    services: rankServiceNames(serviceBallots, null),
    commercialServices: rankServiceNames(commercialBallots, null),
    cityCount,
    siteCount,
    researchCount,
  };
}

function titleCaseNameArray(raw) {
  if (!Array.isArray(raw)) return { list: raw, changed: false };
  let changed = false;
  const list = raw.map((item) => {
    if (typeof item !== 'string') return item;
    const next = titleCaseNiche(item);
    if (next !== item) changed = true;
    return next;
  });
  return { list, changed };
}

/**
 * Rewrite stored service names on accepted and draft site-configs,
 * the working site-config, and the niche default list.
 * Page copy is left alone.
 */
export function backfillStoredServiceNameTitleCase({
  researchDir = RESEARCH_DIR,
  workingConfigPath = path.join(path.dirname(RESEARCH_DIR), 'src', 'config', 'site-config.json'),
} = {}) {
  let files = 0;

  const rewriteConfig = (filePath) => {
    if (!filePath || !existsSync(filePath)) return;
    const data = readConfigFile(filePath);
    if (!data) return;
    let changed = false;
    for (const key of ['services', 'commercialServices']) {
      const result = titleCaseNameArray(data[key]);
      if (!result.changed) continue;
      data[key] = result.list;
      changed = true;
    }
    if (!changed) return;
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    files += 1;
  };

  if (existsSync(researchDir)) {
    for (const name of readdirSync(researchDir)) {
      if (name.endsWith('-site-config.json') || name.endsWith('-site-config.draft.json')) {
        rewriteConfig(path.join(researchDir, name));
      }
    }
  }
  rewriteConfig(workingConfigPath);

  const storePath = path.join(researchDir, '_niche-service-lists.json');
  if (existsSync(storePath)) {
    const store = readStore(storePath);
    let changed = false;
    for (const record of Object.values(store.lists || {})) {
      if (!record || typeof record !== 'object') continue;
      for (const key of ['services', 'commercialServices']) {
        const result = titleCaseNameArray(record[key]);
        if (!result.changed) continue;
        record[key] = result.list;
        changed = true;
      }
    }
    if (changed) {
      writeStore(storePath, store);
      files += 1;
    }
  }

  return { files };
}
