/**
 * Site-config handoff from approved Candidate package.
 */

import { copyFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  extractPromptTemplate,
  getApprovedPackage,
  getCandidateDetail,
  pathsFor,
  readPromptFile,
  saveMeta,
} from './candidates.mjs';
import { buildGoogleStyleSocialProof, socialProofNeedsSeed } from '../../scripts/lib/review-seed.mjs';
import {
  applyArchetypeDefaults,
  listArchetypes,
  normalizeArchetype,
  suggestArchetype,
} from '../../scripts/lib/site-archetypes.mjs';
import { applyPaletteToBrand, getPalette, SITE_PALETTES } from '../../scripts/lib/site-palettes.mjs';
import {
  applyFontThemeToBrand,
  getFontTheme,
  SITE_FONT_THEMES,
} from '../../scripts/lib/site-fonts.mjs';
import { mergeLocationPages, toCoverageAreas } from './geo-neighbors.mjs';

const ROOT = process.cwd();
const SITE_CONFIG_PATH = path.join(ROOT, 'src', 'config', 'site-config.json');

/** Stable TBD tokens — used for fill + incompleteness scan. */
export const SITE_CONFIG_PLACEHOLDERS = {
  domain: 'example.com',
  phone: '+1XXXXXXXXXX',
  email: 'leads@example.com',
  web3FormsAccessKey: 'REPLACE_WEB3FORMS_KEY',
  tagline: 'TBD — local service tagline',
  primaryCta: 'Get a Free Estimate',
  businessName: 'TBD Business',
  niche: 'TBD Niche',
  primaryCity: 'TBD City',
  state: 'XX',
  listItem: 'TBD',
  brand: {
    primary: '#1C2B3A',
    accent: '#E8A317',
    ink: '#0F1720',
  },
};

/**
 * Optional street NAP: keep only a complete address; otherwise omit.
 * Incomplete `{ street: "", zip: "" }` breaks Astro Zod at build time.
 */
export function normalizeSiteAddress(addr, { primaryCity, state } = {}) {
  if (addr == null) return undefined;
  if (typeof addr !== 'object' || Array.isArray(addr)) return undefined;
  const street = String(addr.street || '').trim();
  const zip = String(addr.zip || '').trim();
  const city = String(addr.city || primaryCity || '').trim();
  const st = String(addr.state || state || '')
    .trim()
    .toUpperCase();
  if (!street || !zip || !city || !st) return undefined;
  return { street, city, state: st, zip };
}

function applyNormalizedAddress(config) {
  if (!config || typeof config !== 'object') return config;
  const next = { ...config };
  const addr = normalizeSiteAddress(next.address, {
    primaryCity: next.primaryCity,
    state: next.state,
  });
  if (addr) next.address = addr;
  else delete next.address;
  return next;
}

/** Consumer inboxes must not ship as the public site contact address. */
const PERSONAL_EMAIL_HOST_RE =
  /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol)\./i;

function normNameKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Public NAP email: prefer leads@domain; never print personal Gmail/Yahoo/etc on the site.
 */
export function publicLeadsEmail(email, domain) {
  const d = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\/$/, '');
  const e = String(email || '').trim();
  const lower = e.toLowerCase();
  if (d && (!e || PERSONAL_EMAIL_HOST_RE.test(lower) || /@example\.com$/i.test(lower))) {
    return `leads@${d}`;
  }
  return e || (d ? `leads@${d}` : '');
}

/**
 * Avoid shipping the niche label as the company name (weak brand on every page).
 */
export function ensureBusinessNameNotNiche(config) {
  const c = { ...(config && typeof config === 'object' ? config : {}) };
  const niche = String(c.niche || '').trim();
  let name = String(c.businessName || '').trim();
  if (!niche) return c;
  const nicheKey = normNameKey(niche);
  const nameKey = normNameKey(name);
  const looksLikeNiche =
    !name ||
    nameKey === nicheKey ||
    nameKey === normNameKey(`${niche} services`) ||
    nameKey === normNameKey(`${niche} service`);
  if (looksLikeNiche) {
    c.businessName = /pros$/i.test(niche) ? niche : `${niche} Pros`;
  }
  return c;
}

/**
 * Soft SEO warn when public hostname tokens don't overlap niche / brand / primary city.
 * Does not block Accept or Launch (test hosts must still ship).
 * @returns {{ mismatch: boolean, domain: string, reason: string|null }}
 */
export function domainBrandMismatch(domain, { niche, businessName, primaryCity } = {}) {
  const host = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .replace(/^www\./, '');
  if (!host || host === 'example.com' || /^tbd\b/i.test(host)) {
    return { mismatch: false, domain: host, reason: null };
  }
  const label = host.split('.')[0] || host;
  const hostTokens = label
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
  const stop = new Set([
    'the',
    'and',
    'for',
    'pros',
    'llc',
    'inc',
    'com',
    'net',
    'org',
    'www',
    'services',
    'service',
    'local',
    'home',
  ]);
  const meaningful = hostTokens.filter((t) => !stop.has(t));
  if (!meaningful.length) return { mismatch: false, domain: host, reason: null };

  const hay = `${niche || ''} ${businessName || ''} ${primaryCity || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
  const hayTokens = new Set(
    hay
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 2 && !stop.has(t)),
  );
  const hit = meaningful.some((t) =>
    [...hayTokens].some((h) => h.includes(t) || t.includes(h)),
  );
  if (hit) return { mismatch: false, domain: host, reason: null };
  return {
    mismatch: true,
    domain: host,
    reason: `Hostname “${host}” does not share tokens with niche/brand/city — use the final client domain before go-live (test hosts are OK for preview).`,
  };
}

/** Seed social proof so trust strip / reviews render when config omits them. */
export function defaultPlaceholderSocialProof(city = 'Local', state = '', opts = {}) {
  return buildGoogleStyleSocialProof(city, state, {
    businessName: opts.businessName,
    niche: opts.niche,
    services: opts.services,
    primaryCity: opts.primaryCity || city,
    targetSuburbs: opts.targetSuburbs,
    coverageAreas: opts.coverageAreas,
    seedKey:
      opts.seedKey ||
      [opts.businessName, city, state, opts.niche].filter(Boolean).join('|'),
  });
}

const WEB3_PLACEHOLDER_RE = /^(REPLACE_WEB3FORMS_KEY|YOUR_WEB3FORMS_ACCESS_KEY)$/i;

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function isBlank(v) {
  if (v == null) return true;
  if (typeof v === 'string') return !v.trim();
  if (Array.isArray(v)) return v.length === 0 || v.every((x) => isBlank(x));
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

function looksTbd(v) {
  const s = String(v ?? '').trim();
  if (!s) return true;
  return /^tbd\b/i.test(s) || s === 'XX' || s === SITE_CONFIG_PLACEHOLDERS.listItem;
}

/** Split semicolon/comma lists from ops form fields into string[]. */
export function parseListField(raw) {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || '').trim()).filter(Boolean);
  }
  return String(raw || '')
    .split(/[;\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Extract the first balanced JSON object from chat paste (ignores trailing prose).
 * @returns {object}
 */
export function extractJsonObject(text) {
  let cleaned = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!cleaned) {
    const err = new Error('Paste is empty');
    err.status = 400;
    throw err;
  }

  const fence = cleaned.match(/```(?:json)?\s*\r?\n?([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  else cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    const direct = JSON.parse(cleaned);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
  } catch {
    /* fall through to brace scan */
  }

  const start = cleaned.indexOf('{');
  if (start < 0) {
    const err = new Error('Could not parse site-config JSON (no object found)');
    err.status = 400;
    throw err;
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const slice = cleaned.slice(start, i + 1);
        try {
          const value = JSON.parse(slice);
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            const err = new Error('Site-config must be a JSON object');
            err.status = 400;
            throw err;
          }
          return value;
        } catch (e) {
          if (e.status) throw e;
          const err = new Error(`Could not parse site-config JSON: ${e.message}`);
          err.status = 400;
          throw err;
        }
      }
    }
  }

  const err = new Error('Could not parse site-config JSON (unbalanced braces)');
  err.status = 400;
  throw err;
}

/**
 * Soft suburb sanity: flag empty names, duplicate entries, weird tokens.
 * Does not call Census — advisory only.
 */
export function validateSuburbsForSiteConfig(config) {
  const warnings = [];
  const primary = String(config?.primaryCity || '').trim();
  const state = String(config?.state || '').trim().toUpperCase();
  const suburbs = Array.isArray(config?.targetSuburbs) ? config.targetSuburbs : [];
  const coverage = Array.isArray(config?.coverageAreas) ? config.coverageAreas : [];

  if (!suburbs.length) warnings.push('targetSuburbs is empty');
  const seen = new Set();
  for (const s of suburbs) {
    const name = String(s || '').trim();
    if (!name) {
      warnings.push('Empty suburb name in targetSuburbs');
      continue;
    }
    if (name.length < 2) warnings.push(`Suburb looks too short: "${name}"`);
    if (/^\d+$/.test(name)) warnings.push(`Suburb looks numeric: "${name}"`);
    const key = name.toLowerCase();
    if (seen.has(key)) warnings.push(`Duplicate suburb: "${name}"`);
    seen.add(key);
    if (primary && key === primary.toLowerCase()) {
      warnings.push(`Suburb duplicates primary city: "${name}"`);
    }
  }

  if (suburbs.length > 8) {
    warnings.push(`targetSuburbs has ${suburbs.length} entries (prefer ≤8 SEO location pages)`);
  }

  for (const area of coverage) {
    const name = String(area?.name || '').trim();
    const st = String(area?.state || '').trim().toUpperCase();
    if (!name) warnings.push('coverageAreas entry missing name');
    if (!st || st.length !== 2) warnings.push(`coverageAreas "${name}" needs 2-letter state`);
    if (state && st && st !== state) {
      warnings.push(`coverageAreas "${name}" is ${st} (primary state ${state}) — confirm intentional`);
    }
  }

  return { ok: warnings.length === 0, warnings };
}

export function assertSiteConfigHandoffReady(candidateId, { allowNonPursue = false } = {}) {
  const detail = getCandidateDetail(candidateId);
  const flags = detail.stageFlags || {};
  if (!flags.hasNarrative) {
    const err = new Error('Accept Stage 3 narrative first (approved package required)');
    err.status = 400;
    throw err;
  }
  const decision = detail.meta?.decision || detail.summary?.decision || null;
  if (!allowNonPursue && decision !== 'pursue') {
    const err = new Error(
      `Decision is "${decision || 'unset'}" — set pursue (or pass allowNonPursue) before site-config`,
    );
    err.status = 400;
    throw err;
  }
  const pack = getApprovedPackage(candidateId);
  if (!pack) {
    const err = new Error(
      'No approved package — re-Accept narrative to generate research/{id}-approved.json',
    );
    err.status = 400;
    throw err;
  }
  return { detail, pack, decision };
}

export function buildSiteConfigPrompt(candidateId, nap = {}) {
  const { pack } = assertSiteConfigHandoffReady(candidateId, {
    allowNonPursue: Boolean(nap.allowNonPursue),
  });
  const suggested = normalizeArchetype(
    nap.siteArchetype ||
      suggestArchetype({
        services: pack.suggestedServices,
        niche: pack.niche,
        suggestedServices: pack.suggestedServices,
      }),
  );
  const palette = getPalette(nap.paletteId || 'slate-gold');
  const fontTheme = getFontTheme(nap.fontTheme || 'archivo-source');
  const md = readPromptFile('prompts/claude-site-config.md');
  const template = extractPromptTemplate(md);
  const filled = template
    .replace('{{PASTE_APPROVED_CANDIDATE_JSON}}', JSON.stringify(pack, null, 2))
    .replace('{{DOMAIN}}', String(nap.domain || '').trim() || 'example.com')
    .replace('{{BUSINESS_NAME}}', String(nap.businessName || '').trim() || (pack.niche ? `${pack.niche} Pros` : 'Business'))
    .replace('{{PHONE}}', String(nap.phone || '').trim() || '+1XXXXXXXXXX')
    .replace(
      '{{EMAIL}}',
      publicLeadsEmail(nap.email, nap.domain) || 'leads@example.com',
    )
    .replace(
      '{{RADIUS_MILES}}',
      nap.radiusMiles != null && nap.radiusMiles !== '' ? String(nap.radiusMiles) : '40',
    )
    .replace('{{SITE_ARCHETYPE}}', suggested)
    .replaceAll('{{PALETTE_ID}}', palette.id)
    .replaceAll('{{PALETTE_LABEL}}', palette.label)
    .replaceAll('{{BRAND_PRIMARY}}', palette.brand.primary)
    .replaceAll('{{BRAND_ACCENT}}', palette.brand.accent)
    .replaceAll('{{BRAND_INK}}', palette.brand.ink)
    .replaceAll('{{FONT_THEME}}', fontTheme.id);
  return {
    prompt: filled,
    package: pack,
    suggestedArchetype: suggested,
    archetypes: listArchetypes(),
    paletteId: palette.id,
    fontTheme: fontTheme.id,
  };
}

function pickNonBlank(...candidates) {
  for (const c of candidates) {
    if (!isBlank(c)) return c;
  }
  return undefined;
}

function servicesFromPack(pack) {
  if (!pack) return [];
  return parseListField(pack.suggestedServices);
}

function suburbsFromPack(pack) {
  if (!pack) return [];
  return parseListField(pack.suggestedSuburbs);
}

/**
 * List keys that are still blank or still hold known placeholder tokens.
 */
export function scanSiteConfigPlaceholders(config) {
  const c = config || {};
  const placeholders = [];
  const P = SITE_CONFIG_PLACEHOLDERS;

  const checkStr = (key, val, known) => {
    const s = String(val ?? '').trim();
    if (!s || s === known || looksTbd(s)) placeholders.push(key);
  };

  checkStr('businessName', c.businessName, P.businessName);
  checkStr('tagline', c.tagline, P.tagline);
  checkStr('domain', c.domain, P.domain);
  checkStr('niche', c.niche, P.niche);
  checkStr('primaryCity', c.primaryCity, P.primaryCity);
  {
    const st = String(c.state ?? '').trim().toUpperCase();
    if (!st || st === 'XX') placeholders.push('state');
  }
  checkStr('phone', c.phone, P.phone);
  checkStr('email', c.email, P.email);
  {
    const key = String(c.web3FormsAccessKey ?? '').trim();
    if (!key || WEB3_PLACEHOLDER_RE.test(key)) placeholders.push('web3FormsAccessKey');
  }
  {
    const s = String(c.primaryCta ?? '').trim();
    if (!s || looksTbd(s)) placeholders.push('primaryCta');
  }

  const suburbs = Array.isArray(c.targetSuburbs) ? c.targetSuburbs : [];
  if (!suburbs.length || suburbs.every((x) => looksTbd(x))) placeholders.push('targetSuburbs');

  const services = Array.isArray(c.services) ? c.services : [];
  if (!services.length || services.every((x) => looksTbd(x))) placeholders.push('services');

  const brand = c.brand || {};
  if (
    isBlank(brand.primary) ||
    isBlank(brand.accent) ||
    isBlank(brand.ink) ||
    !/^#[0-9A-Fa-f]{6}$/.test(String(brand.primary || '')) ||
    !/^#[0-9A-Fa-f]{6}$/.test(String(brand.accent || '')) ||
    !/^#[0-9A-Fa-f]{6}$/.test(String(brand.ink || ''))
  ) {
    placeholders.push('brand');
  }

  return [...new Set(placeholders)];
}

/**
 * Merge pasted config + NAP + approved package, then fill remaining required fields.
 * @returns {{ config: object, placeholders: string[] }}
 */
export function withSiteConfigPlaceholders(config, nap = {}, pack = null) {
  const P = SITE_CONFIG_PLACEHOLDERS;
  const base = { ...(config && typeof config === 'object' ? config : {}) };
  const filledKeys = [];

  const setIfNeeded = (key, value, { asPlaceholder = false } = {}) => {
    if (!isBlank(base[key])) return;
    if (value == null || (typeof value === 'string' && !String(value).trim())) return;
    base[key] = typeof value === 'string' ? String(value).trim() : value;
    if (asPlaceholder) filledKeys.push(key);
  };

  // NAP overlays (only when blank)
  setIfNeeded('domain', nap.domain);
  setIfNeeded('businessName', nap.businessName);
  setIfNeeded('phone', nap.phone);
  setIfNeeded('email', publicLeadsEmail(nap.email, nap.domain || base.domain));
  if (isBlank(base.serviceRadiusMiles) && nap.radiusMiles != null && nap.radiusMiles !== '') {
    const n = Number(nap.radiusMiles);
    if (Number.isFinite(n) && n > 0) base.serviceRadiusMiles = n;
  }

  // Pack seeds
  setIfNeeded('niche', pack?.niche);
  setIfNeeded('primaryCity', pack?.city);
  setIfNeeded('state', pack?.state ? String(pack.state).toUpperCase() : null);
  setIfNeeded(
    'businessName',
    pickNonBlank(nap.businessName, pack?.niche ? `${pack.niche} Pros` : null),
  );

  if (isBlank(base.services)) {
    const svc = servicesFromPack(pack);
    if (svc.length) base.services = svc;
  }
  if (isBlank(base.targetSuburbs)) {
    const subs = suburbsFromPack(pack);
    if (subs.length) base.targetSuburbs = subs;
  }

  // Explicit placeholders for anything still missing
  const ensure = (key, value) => {
    if (!isBlank(base[key])) return;
    base[key] = value;
    filledKeys.push(key);
  };

  ensure('businessName', P.businessName);
  ensure('tagline', P.tagline);
  ensure('domain', P.domain);
  ensure('niche', P.niche);
  ensure('primaryCity', P.primaryCity);
  ensure('state', P.state);
  ensure('phone', P.phone);
  ensure('email', P.email);
  ensure('web3FormsAccessKey', P.web3FormsAccessKey);
  ensure('primaryCta', P.primaryCta);

  if (isBlank(base.targetSuburbs)) {
    base.targetSuburbs = [P.listItem];
    filledKeys.push('targetSuburbs');
  }
  if (isBlank(base.services)) {
    base.services = [P.listItem];
    filledKeys.push('services');
  }

  const brand = { ...(base.brand || {}) };
  let brandFilled = false;
  for (const k of ['primary', 'accent', 'ink']) {
    if (isBlank(brand[k]) || !/^#[0-9A-Fa-f]{6}$/.test(String(brand[k]))) {
      brand[k] = P.brand[k];
      brandFilled = true;
    }
  }
  base.brand = brand;
  if (brandFilled) filledKeys.push('brand');

  if (base.turnstileSiteKey == null) base.turnstileSiteKey = '';

  if (isBlank(base.serviceRadiusMiles)) {
    const n = Number(nap.radiusMiles);
    base.serviceRadiusMiles = Number.isFinite(n) && n > 0 ? n : 40;
  }

  base.siteArchetype = normalizeArchetype(
    nap.siteArchetype || base.siteArchetype || suggestArchetype(base),
  );

  const proof = base.socialProof && typeof base.socialProof === 'object' ? base.socialProof : null;
  // Empty OR still Local homeowner / Neighborhood customer / Repeat client trio
  if (socialProofNeedsSeed(base)) {
    base.socialProof = defaultPlaceholderSocialProof(base.primaryCity, base.state, {
      businessName: base.businessName,
      niche: base.niche,
      services: base.services,
      primaryCity: base.primaryCity,
      targetSuburbs: base.targetSuburbs,
      coverageAreas: base.coverageAreas,
      seedKey: base.domain || base.businessName || `${base.primaryCity}|${base.state}`,
    });
    filledKeys.push('socialProof');
  } else if (proof && 'status' in proof) {
    const { status: _drop, ...rest } = proof;
    base.socialProof = rest;
  }

  const configOut = ensureBusinessNameNotNiche(applyArchetypeDefaults(base));
  if (!isBlank(configOut.domain)) {
    configOut.email = publicLeadsEmail(configOut.email, configOut.domain);
  }
  // Prefer live scan so known placeholder tokens (even if pasted) stay flagged
  const placeholders = scanSiteConfigPlaceholders(configOut);
  return {
    config: applyNormalizedAddress(configOut),
    placeholders,
    filledKeys: [...new Set(filledKeys)],
  };
}

function writeDraftFile(candidateId, config, opsExtra = {}) {
  const p = pathsFor(candidateId);
  const suburbCheck = validateSuburbsForSiteConfig(config);
  const placeholders = scanSiteConfigPlaceholders(config);
  const draft = {
    ...config,
    _ops: {
      savedAt: new Date().toISOString(),
      incomplete: placeholders.length > 0,
      placeholders,
      suburbCheck,
      ...opsExtra,
    },
  };
  writeJson(p.siteConfigDraft, draft);
  saveMeta(candidateId, { lastSiteConfigDraftAt: new Date().toISOString() });
  return { draft: readJson(p.siteConfigDraft), suburbCheck, placeholders };
}

export function pasteSiteConfigDraft(candidateId, raw, nap = {}) {
  const { pack } = assertSiteConfigHandoffReady(candidateId, {
    allowNonPursue: Boolean(nap.allowNonPursue),
  });

  let value = raw;
  if (typeof raw === 'string') {
    value = extractJsonObject(raw);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const err = new Error('Site-config must be a JSON object');
    err.status = 400;
    throw err;
  }

  const { config, placeholders } = withSiteConfigPlaceholders(value, nap, pack);
  const { draft, suburbCheck } = writeDraftFile(candidateId, config, {
    source: 'paste',
    nap: {
      domain: nap.domain || null,
      businessName: nap.businessName || null,
      phone: nap.phone || null,
      email: nap.email || null,
    },
  });

  return {
    ok: true,
    draft,
    suburbCheck,
    placeholders,
    candidate: getCandidateDetail(candidateId),
  };
}

export function getSiteConfigDraft(candidateId) {
  return readJson(pathsFor(candidateId).siteConfigDraft);
}

/**
 * Merge operator edits into the existing draft (shallow + brand/address nested).
 */
export function updateSiteConfigDraft(candidateId, patch = {}, nap = {}) {
  assertSiteConfigHandoffReady(candidateId, { allowNonPursue: Boolean(nap.allowNonPursue) });
  const p = pathsFor(candidateId);
  let existing = readJson(p.siteConfigDraft);
  // Seed from accepted config when draft was cleared after Accept (forever: update commercial without re-paste).
  if (!existing) {
    const accepted = stripSiteConfigOps(readJson(p.siteConfig));
    if (!accepted) {
      const err = new Error('No site-config draft — paste JSON first');
      err.status = 400;
      throw err;
    }
    existing = {
      ...accepted,
      _ops: { source: 'from-accepted', seededAt: new Date().toISOString() },
    };
  }

  const { _ops: prevOps, ...prev } = existing;
  const next = { ...prev };

  const scalarKeys = [
    'businessName',
    'tagline',
    'domain',
    'niche',
    'primaryCity',
    'state',
    'phone',
    'email',
    'web3FormsAccessKey',
    'turnstileSiteKey',
    'primaryCta',
    'siteArchetype',
  ];
  for (const key of scalarKeys) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }

  if (patch.serviceRadiusMiles !== undefined) {
    const n = Number(patch.serviceRadiusMiles);
    next.serviceRadiusMiles = Number.isFinite(n) && n > 0 ? n : next.serviceRadiusMiles;
  }
  if (patch.homepageServicesLimit !== undefined) {
    const n = Number(patch.homepageServicesLimit);
    if (Number.isFinite(n)) {
      next.homepageServicesLimit = Math.min(12, Math.max(1, Math.floor(n)));
    }
  }
  if (patch.targetSuburbs !== undefined) next.targetSuburbs = parseListField(patch.targetSuburbs);
  if (patch.services !== undefined) {
    next.services = parseListField(patch.services).slice(0, 12);
  }
  if (patch.commercialServices !== undefined) {
    const list = parseListField(patch.commercialServices).slice(0, 12);
    next.commercialServices = list.length ? list : undefined;
  }

  if (patch.brand && typeof patch.brand === 'object') {
    next.brand = { ...(next.brand || {}), ...patch.brand };
  }
  if (patch.address !== undefined) {
    if (patch.address === null) {
      delete next.address;
    } else if (typeof patch.address === 'object') {
      const merged = { ...(next.address || {}), ...patch.address };
      const norm = normalizeSiteAddress(merged, {
        primaryCity: next.primaryCity,
        state: next.state,
      });
      if (norm) next.address = norm;
      else delete next.address;
    }
  } else {
    const norm = normalizeSiteAddress(next.address, {
      primaryCity: next.primaryCity,
      state: next.state,
    });
    if (norm) next.address = norm;
    else delete next.address;
  }

  const pack = getApprovedPackage(candidateId);
  const { config, placeholders } = withSiteConfigPlaceholders(next, nap, pack);
  const { draft, suburbCheck } = writeDraftFile(candidateId, config, {
    source: 'edit',
    previousSource: prevOps?.source || null,
    nap: {
      domain: nap.domain || null,
      businessName: nap.businessName || null,
      phone: nap.phone || null,
      email: nap.email || null,
    },
  });

  return {
    ok: true,
    draft,
    suburbCheck,
    placeholders,
    candidate: getCandidateDetail(candidateId),
  };
}

/**
 * Write draft to src/config/site-config.json (backs up previous).
 */
export function acceptSiteConfig(
  candidateId,
  {
    allowNonPursue = false,
    ignoreSuburbWarnings = false,
    allowPlaceholders = false,
  } = {},
) {
  assertSiteConfigHandoffReady(candidateId, { allowNonPursue });
  const p = pathsFor(candidateId);
  const draftPath = p.siteConfigDraft;
  const draft = readJson(draftPath);
  if (!draft) {
    const err = new Error('No site-config draft — paste JSON first');
    err.status = 400;
    throw err;
  }
  const { _ops, ...cleanRaw } = draft;
  const clean = applyNormalizedAddress(
    ensureBusinessNameNotNiche(applyArchetypeDefaults(cleanRaw)),
  );
  if (!isBlank(clean.domain)) {
    clean.email = publicLeadsEmail(clean.email, clean.domain);
  }
  const placeholders = scanSiteConfigPlaceholders(clean);
  if (placeholders.length && !allowPlaceholders) {
    const err = new Error(
      `Draft still has placeholders: ${placeholders.slice(0, 8).join(', ')}. Fill them in Edit draft, or pass allowPlaceholders.`,
    );
    err.status = 400;
    err.placeholders = placeholders;
    throw err;
  }

  const suburbCheck = validateSuburbsForSiteConfig(clean);
  if (!suburbCheck.ok && !ignoreSuburbWarnings) {
    const err = new Error(
      `Suburb checks failed: ${suburbCheck.warnings.slice(0, 3).join('; ')}. Pass ignoreSuburbWarnings to proceed.`,
    );
    err.status = 400;
    err.suburbCheck = suburbCheck;
    throw err;
  }

  mkdirSync(path.dirname(SITE_CONFIG_PATH), { recursive: true });
  if (existsSync(SITE_CONFIG_PATH)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    copyFileSync(
      SITE_CONFIG_PATH,
      path.join(path.dirname(SITE_CONFIG_PATH), `site-config.backup-${stamp}.json`),
    );
  }
  writeJson(SITE_CONFIG_PATH, clean);
  writeJson(p.siteConfig, {
    ...clean,
    _ops: {
      acceptedAt: new Date().toISOString(),
      writtenTo: 'src/config/site-config.json',
      suburbCheck,
      placeholders,
      allowPlaceholders: Boolean(allowPlaceholders),
      fromDraft: true,
    },
  });
  if (existsSync(draftPath)) unlinkSync(draftPath);
  saveMeta(candidateId, {
    lastSiteConfigAt: new Date().toISOString(),
    siteConfigPath: 'src/config/site-config.json',
    siteArchetype: clean.siteArchetype,
  });
  return {
    ok: true,
    config: clean,
    path: 'src/config/site-config.json',
    suburbCheck,
    placeholders,
    domainWarn: domainBrandMismatch(clean.domain, {
      niche: clean.niche,
      businessName: clean.businessName,
      primaryCity: clean.primaryCity,
    }),
    candidate: getCandidateDetail(candidateId),
  };
}

/**
 * Persist Service area Accept: coverageAreas + radius + Claude-first targetSuburbs (≤8).
 */
export function acceptServiceArea(
  candidateId,
  { radiusMiles, selectedCities = [], claudeOrder = null } = {},
) {
  const p = pathsFor(candidateId);
  const acceptedRaw = readJson(p.siteConfig);
  const accepted = stripSiteConfigOps(acceptedRaw);
  if (!accepted) {
    const err = new Error('Accept Site config first, then set Service area');
    err.status = 400;
    throw err;
  }

  const primaryCity = String(accepted.primaryCity || '').trim();
  const state = String(accepted.state || '').trim().toUpperCase();
  if (!primaryCity || !state) {
    const err = new Error('Site config needs primaryCity and state');
    err.status = 400;
    throw err;
  }

  const miles = Number(radiusMiles);
  const serviceRadiusMiles =
    Number.isFinite(miles) && miles > 0
      ? Math.min(120, Math.max(1, miles))
      : Number(accepted.serviceRadiusMiles) || 40;

  const selected = Array.isArray(selectedCities) ? selectedCities : [];
  if (!selected.length) {
    const err = new Error('Select at least one coverage city');
    err.status = 400;
    throw err;
  }

  const coverageAreas = toCoverageAreas(selected, primaryCity, state);
  const claude =
    Array.isArray(claudeOrder) && claudeOrder.length
      ? claudeOrder
      : Array.isArray(accepted.targetSuburbs)
        ? accepted.targetSuburbs
        : [];

  const targetSuburbs = mergeLocationPages({
    coverage: coverageAreas,
    claudeOrder: claude,
    primaryCity,
    state,
    max: 8,
  });

  const next = {
    ...accepted,
    serviceRadiusMiles,
    coverageAreas,
    targetSuburbs,
  };

  const suburbCheck = validateSuburbsForSiteConfig(next);

  writeJson(p.siteConfig, {
    ...next,
    _ops: {
      ...(acceptedRaw?._ops && typeof acceptedRaw._ops === 'object' ? acceptedRaw._ops : {}),
      serviceAreaAcceptedAt: new Date().toISOString(),
      suburbCheck,
    },
  });

  mkdirSync(path.dirname(SITE_CONFIG_PATH), { recursive: true });
  writeJson(SITE_CONFIG_PATH, next);

  saveMeta(candidateId, {
    lastServiceAreaAt: new Date().toISOString(),
    serviceRadiusMiles,
    coverageCount: coverageAreas.length,
    locationPageCount: targetSuburbs.length,
  });

  return {
    ok: true,
    config: next,
    suburbCheck,
    coverageAreas,
    targetSuburbs,
    serviceRadiusMiles,
    candidate: getCandidateDetail(candidateId),
  };
}

export function setCandidateArchetype(candidateId, siteArchetype) {
  const id = normalizeArchetype(siteArchetype);
  const p = pathsFor(candidateId);
  const draft = readJson(p.siteConfigDraft);
  if (draft) {
    writeJson(p.siteConfigDraft, applyArchetypeDefaults({ ...draft, siteArchetype: id }));
  }
  const accepted = readJson(p.siteConfig);
  if (accepted) {
    const next = applyArchetypeDefaults({ ...accepted, siteArchetype: id });
    writeJson(p.siteConfig, next);
  }
  saveMeta(candidateId, { siteArchetype: id });
  return {
    ok: true,
    siteArchetype: id,
    archetypes: listArchetypes(),
    candidate: getCandidateDetail(candidateId),
  };
}

function stripSiteConfigOps(config) {
  if (!config || typeof config !== 'object') return null;
  const { _ops, ...rest } = config;
  return rest;
}

function readTemplateSiteConfig() {
  if (!existsSync(SITE_CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(SITE_CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function backupTemplateSiteConfig() {
  if (!existsSync(SITE_CONFIG_PATH)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  copyFileSync(
    SITE_CONFIG_PATH,
    path.join(path.dirname(SITE_CONFIG_PATH), `site-config.backup-${stamp}.json`),
  );
}

/**
 * Apply a named palette and/or font theme to draft (seeded from accepted/template if needed).
 * Also syncs brand into research accepted + src/config/site-config.json when present.
 */
export function applySiteConfigBrand(candidateId, paletteId, nap = {}) {
  assertSiteConfigHandoffReady(candidateId, { allowNonPursue: Boolean(nap.allowNonPursue) });
  const paletteKey = String(paletteId || nap.paletteId || '').trim();
  const fontKey = String(nap.fontTheme || '').trim();
  const knownPalette = paletteKey
    ? SITE_PALETTES.find((p) => p.id === paletteKey)
    : null;
  const knownFont = fontKey ? SITE_FONT_THEMES.find((t) => t.id === fontKey) : null;
  if (paletteKey && !knownPalette) {
    const err = new Error('Unknown palette id');
    err.status = 400;
    throw err;
  }
  if (fontKey && !knownFont) {
    const err = new Error('Unknown font theme id');
    err.status = 400;
    throw err;
  }
  if (!knownPalette && !knownFont) {
    const err = new Error('Provide paletteId and/or fontTheme');
    err.status = 400;
    throw err;
  }

  const p = pathsFor(candidateId);
  const draftExisting = readJson(p.siteConfigDraft);
  const accepted = readJson(p.siteConfig);
  const template = readTemplateSiteConfig();
  const base =
    stripSiteConfigOps(draftExisting) || stripSiteConfigOps(accepted) || stripSiteConfigOps(template);
  if (!base) {
    const err = new Error(
      'No site-config draft or accepted config — paste/load a draft before picking colors or fonts',
    );
    err.status = 400;
    throw err;
  }

  let brand = { ...(base.brand || {}) };
  if (knownPalette) {
    brand = applyPaletteToBrand(brand, knownPalette.id);
  }
  if (knownFont) {
    brand = applyFontThemeToBrand(brand, knownFont.id);
  } else if (!brand.fontTheme) {
    brand = applyFontThemeToBrand(brand, 'archivo-source');
  }

  const next = {
    ...base,
    brand,
  };

  const { draft, placeholders, suburbCheck } = writeDraftFile(candidateId, next, {
    source: 'look',
    paletteId: brand.paletteId || null,
    fontTheme: brand.fontTheme || null,
  });

  if (accepted) {
    const { _ops: prevOps, ...clean } = accepted;
    writeJson(p.siteConfig, {
      ...clean,
      brand: next.brand,
      _ops: {
        ...(prevOps && typeof prevOps === 'object' ? prevOps : {}),
        lastBrandLookAt: new Date().toISOString(),
        paletteId: brand.paletteId || null,
        fontTheme: brand.fontTheme || null,
      },
    });
  }

  if (template && typeof template === 'object') {
    backupTemplateSiteConfig();
    mkdirSync(path.dirname(SITE_CONFIG_PATH), { recursive: true });
    writeJson(SITE_CONFIG_PATH, { ...template, brand: next.brand });
  }

  return {
    ok: true,
    draft,
    brand: next.brand,
    paletteId: brand.paletteId || null,
    fontTheme: brand.fontTheme || null,
    placeholders,
    suburbCheck,
    candidate: getCandidateDetail(candidateId),
  };
}

export { listArchetypes, suggestArchetype, normalizeArchetype };
