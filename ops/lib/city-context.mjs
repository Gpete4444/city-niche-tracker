/**
 * Structured city briefs for Content Outline / Full write (local depth forever).
 * Wikipedia REST summary + discovery seed + census pop — reference only, never copy verbatim.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getCandidateDetail, pathsFor, RESEARCH_DIR } from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { lookupPopulation } from './census.mjs';

const WIKI_UA = 'RoverLocalSEO/1.0 (city-context; local service site builder)';
const EXTRACT_MAX = 1600;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const STATE_ABBR_TO_NAME = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

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

export function cityContextPath(candidateId) {
  const safe = pathsFor(candidateId).id;
  return path.join(RESEARCH_DIR, `${safe}-city-context.json`);
}

function stateFullName(state) {
  const s = String(state || '').trim();
  if (!s) return '';
  if (s.length === 2) return STATE_ABBR_TO_NAME[s.toUpperCase()] || s;
  return s;
}

function wikiTitle(city, state) {
  const c = String(city || '').trim();
  const st = stateFullName(state);
  if (!c) return '';
  return st ? `${c}, ${st}` : c;
}

function extractClimateHints(text) {
  const t = String(text || '');
  const hints = [];
  const patterns = [
    /\b(humid|humidity|subtropical|arid|dry climate|continental|marine|coastal|winter|summer|snowfall|rainfall|precipitation|drought|freeze|frost)\b[^.!?]{0,80}/gi,
    /\bclimate\b[^.!?]{0,120}/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(t)) !== null && hints.length < 4) {
      const phrase = m[0].replace(/\s+/g, ' ').trim();
      if (phrase.length > 12 && !hints.includes(phrase)) hints.push(phrase);
    }
  }
  return hints;
}

function extractHousingHints(text) {
  const t = String(text || '');
  const hints = [];
  const patterns = [
    /\b(founded|incorporated|census-designated|mid-century|ranch|suburban|residential|manufactured|housing|population of)\b[^.!?]{0,100}/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(t)) !== null && hints.length < 4) {
      const phrase = m[0].replace(/\s+/g, ' ').trim();
      if (phrase.length > 10 && !hints.includes(phrase)) hints.push(phrase);
    }
  }
  return hints;
}

function extractNeighborhoodHints(text) {
  const t = String(text || '');
  const hints = [];
  // "neighborhoods such as X, Y, and Z" / "including X and Y"
  const lists = [
    ...t.matchAll(
      /(?:neighborhoods?|communities|districts|areas)\s+(?:such as|including|like)\s+([A-Z][^.]{8,120})/g,
    ),
  ];
  for (const m of lists) {
    const chunk = String(m[1] || '')
      .split(/,| and |;/)
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s.length > 2 && s.length < 40 && /^[A-Z]/.test(s));
    for (const n of chunk) {
      if (!hints.includes(n) && hints.length < 8) hints.push(n);
    }
  }
  return hints;
}

async function fetchWikiIntroExtract(title) {
  if (!title) return '';
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&redirects=1&titles=${encodeURIComponent(title)}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': WIKI_UA,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return '';
    const data = await res.json();
    const pages = data?.query?.pages || {};
    const first = Object.values(pages)[0];
    const extract = String(first?.extract || '').trim();
    if (!extract || first?.missing != null) return '';
    return extract.length > EXTRACT_MAX ? `${extract.slice(0, EXTRACT_MAX).trim()}…` : extract;
  } catch {
    return '';
  }
}

async function fetchWikiSummary(title) {
  if (!title) return { ok: false, note: 'empty title' };
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': WIKI_UA,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return { ok: false, note: 'wikipedia 404', title };
    if (!res.ok) return { ok: false, note: `wikipedia ${res.status}`, title };
    const data = await res.json();
    if (data.type === 'disambiguation') {
      return { ok: false, note: 'disambiguation', title };
    }
    let extract = String(data.extract || '').trim();
    if (!extract) return { ok: false, note: 'empty extract', title };
    const pageUrl = data.content_urls?.desktop?.page || null;
    let climateHints = extractClimateHints(extract);
    let housingHints = extractHousingHints(extract);
    let neighborhoodHints = extractNeighborhoodHints(extract);
    if (!climateHints.length && !housingHints.length) {
      const longer = await fetchWikiIntroExtract(title);
      if (longer) {
        extract = longer;
        climateHints = extractClimateHints(extract);
        housingHints = extractHousingHints(extract);
        neighborhoodHints = neighborhoodHints.length
          ? neighborhoodHints
          : extractNeighborhoodHints(extract);
      }
    }
    const truncated =
      extract.length > EXTRACT_MAX ? `${extract.slice(0, EXTRACT_MAX).trim()}…` : extract;
    return {
      ok: true,
      title: data.title || title,
      description: data.description || null,
      extract: truncated,
      url: pageUrl,
      climateHints,
      housingHints,
      neighborhoodHints,
    };
  } catch (err) {
    return { ok: false, note: err?.message || 'wiki fetch failed', title };
  }
}

function placeNamesFromConfig(config) {
  const primary = String(config.primaryCity || '').trim();
  const state = String(config.state || '').trim();
  const suburbs = (config.targetSuburbs || [])
    .map((s) => (typeof s === 'string' ? s : s?.name || s?.city || ''))
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  const seen = new Set();
  const places = [];
  for (const name of [primary, ...suburbs]) {
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    places.push({
      name,
      state,
      isPrimary: Boolean(primary && name.toLowerCase() === primary.toLowerCase()),
    });
  }
  return places;
}

/**
 * Prompt rules block for Outline / Full write.
 */
export function cityContextPromptRules() {
  return `## City context briefs (reference only)
- Use the City context JSON below for local flavor: climate, geography, housing eras, named neighborhoods **when listed**.
- Prefer sourced cues (wiki url, census pop, field-research items with sourceUrl). Empty hints stay empty — do **not** invent neighborhoods or soils.
- Do **not** invent demographics, awards, or neighborhoods not in the brief or site-config.
- Do **not** copy Wikipedia sentences verbatim — paraphrase into contractor speech tied to the niche.
- Each location FILE must be **distinct** (different local notes / housing cues); never clone suburb copy or stitch two other cities together.
- Materials/methods: name concrete products or methods suited to local climate (not “professional grade” alone).
- Location pages: ~600+ words across loc* sections; Accept enforces thin / near-duplicate location bodies.`;
}

/**
 * Compact JSON safe to embed in prompts.
 */
export function compactCityContextForPrompt(pkg) {
  if (!pkg || typeof pkg !== 'object') return null;
  return {
    niche: pkg.niche || null,
    primaryCity: pkg.primaryCity || null,
    state: pkg.state || null,
    localPainPoints: pkg.localPainPoints || null,
    writerRules: pkg.writerRules || null,
    places: (pkg.places || []).map((p) => ({
      name: p.name,
      isPrimary: p.isPrimary,
      population: p.population ?? null,
      neighbors: p.neighbors || [],
      wiki: p.wiki
        ? {
            title: p.wiki.title,
            description: p.wiki.description,
            extract: p.wiki.extract,
            climateHints: p.wiki.climateHints || [],
            housingHints: p.wiki.housingHints || [],
            neighborhoodHints: p.wiki.neighborhoodHints || [],
            note: p.wiki.ok === false ? p.wiki.note : undefined,
          }
        : null,
    })),
  };
}

/**
 * Build or return cached city-context package for a candidate.
 * @param {string} candidateId
 * @param {{ force?: boolean }} [opts]
 */
export async function buildCityContextPackage(candidateId, opts = {}) {
  const p = pathsFor(candidateId);
  const cachePath = cityContextPath(candidateId);
  const force = Boolean(opts.force);

  if (!force && existsSync(cachePath)) {
    const cached = readJson(cachePath);
    const age = cached?.builtAt ? Date.now() - Date.parse(cached.builtAt) : Infinity;
    if (cached?.places?.length && Number.isFinite(age) && age < CACHE_TTL_MS) {
      return cached;
    }
  }

  const config =
    loadAcceptedSiteConfig(candidateId)?.config ||
    getCandidateDetail(candidateId)?.siteConfig ||
    {};
  const detail = getCandidateDetail(candidateId);
  const seed = readJson(p.discoverySeed) || detail?.discoverySeed || {};
  const localPainPoints =
    seed.localPainPoints ||
    detail?.approved?.localPainPoints ||
    detail?.research?.localPainPoints ||
    null;

  const state = String(config.state || '').trim();
  const placesMeta = placeNamesFromConfig(config);
  const allNames = placesMeta.map((x) => x.name);

  const places = [];
  for (const place of placesMeta) {
    const title = wikiTitle(place.name, state);
    const wiki = await fetchWikiSummary(title);
    // Soft fallback: try city alone if "City, State" missed
    let wikiResult = wiki;
    if (!wiki.ok && state) {
      const retry = await fetchWikiSummary(place.name);
      if (retry.ok) wikiResult = retry;
    }

    let population = null;
    try {
      const pop = lookupPopulation(place.name, state);
      if (pop != null && Number.isFinite(Number(pop))) population = Number(pop);
    } catch {
      // ignore
    }

    const neighbors = allNames
      .filter((n) => n.toLowerCase() !== place.name.toLowerCase())
      .slice(0, 8);

    places.push({
      name: place.name,
      state,
      isPrimary: place.isPrimary,
      population,
      neighbors,
      wiki: wikiResult.ok
        ? {
            ok: true,
            title: wikiResult.title,
            description: wikiResult.description,
            extract: wikiResult.extract,
            url: wikiResult.url,
            climateHints: wikiResult.climateHints || [],
            housingHints: wikiResult.housingHints || [],
            neighborhoodHints: wikiResult.neighborhoodHints || [],
          }
        : {
            ok: false,
            note: wikiResult.note || 'unavailable',
            title,
          },
    });

    // Be polite to Wikipedia
    await new Promise((r) => setTimeout(r, 120));
  }

  const pkg = {
    version: 1,
    candidateId: p.id,
    builtAt: new Date().toISOString(),
    niche: config.niche || null,
    primaryCity: config.primaryCity || null,
    state,
    localPainPoints: localPainPoints || null,
    writerRules:
      'Reference only. Paraphrase; never invent demographics/neighborhoods; never quote wiki verbatim; keep location files distinct; name concrete methods/products for climate.',
    places,
  };

  writeJson(cachePath, pkg);
  return pkg;
}

/**
 * Sync helper: return cache if fresh, else null (caller may await build).
 */
export function getCachedCityContext(candidateId) {
  const cached = readJson(cityContextPath(candidateId));
  if (!cached?.places?.length) return null;
  const age = cached.builtAt ? Date.now() - Date.parse(cached.builtAt) : Infinity;
  if (!Number.isFinite(age) || age >= CACHE_TTL_MS) return null;
  return cached;
}
