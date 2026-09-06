/**
 * Site-config handoff from approved Candidate package.
 */

import { copyFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  extractPromptTemplate,
  getApprovedPackage,
  getCandidateDetail,
  getCandidateShell,
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
import { getBusinessAddressPackage } from './address-screen.mjs';
import { claudeMessages } from './claude.mjs';

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

const DOMAIN_NAME_SUFFIXES = ['experts', 'solutions', 'group', 'elite', 'pros', 'pro'];
const DOMAIN_NAME_LEFTOVER_WORDS = [
  'installation',
  'installations',
  'repair',
  'repairs',
  'service',
  'services',
  'cleaning',
  'plumbing',
  'plumber',
  'roofing',
  'concrete',
  'drywall',
  'sewer',
  'drain',
  'fencing',
  'fence',
  'painting',
  'garage',
  'windows',
  'siding',
  'hvac',
  'door',
  'doors',
];

function titleCaseDomainWord(w) {
  const s = String(w || '').trim();
  if (!s) return '';
  if (/^(hvac|llc|inc)$/i.test(s)) return s.toUpperCase();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Derive a display business name from an Exact Match hostname + city/niche context.
 * e.g. everettdrywallrepairpros.com + Everett + Drywall Repair → "Everett Drywall Repair Pros"
 */
export function businessNameFromDomain(domain, { primaryCity, niche } = {}) {
  let host = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./, '');
  host = host.split('/')[0].split('?')[0].split('#')[0].replace(/\.$/, '');
  const label = (host.split('.')[0] || host).replace(/[^a-z0-9]/g, '');
  if (!label) return '';

  let rest = label;
  const parts = [];

  const cityRaw = String(primaryCity || '').trim();
  const citySlug = normNameKey(cityRaw);
  if (citySlug && rest.startsWith(citySlug)) {
    parts.push(cityRaw);
    rest = rest.slice(citySlug.length);
  }

  const nicheRaw = String(niche || '').trim();
  const nicheSlug = normNameKey(nicheRaw);
  if (nicheSlug && rest.startsWith(nicheSlug)) {
    parts.push(nicheRaw);
    rest = rest.slice(nicheSlug.length);
  } else if (nicheRaw) {
    const nicheWords = nicheRaw.split(/\s+/).filter(Boolean);
    const peeled = [];
    let cursor = rest;
    for (const w of nicheWords) {
      const ws = normNameKey(w);
      if (ws && cursor.startsWith(ws)) {
        peeled.push(w);
        cursor = cursor.slice(ws.length);
      } else {
        peeled.length = 0;
        break;
      }
    }
    if (peeled.length) {
      parts.push(...peeled);
      rest = cursor;
    }
  }

  const suffixes = [...DOMAIN_NAME_SUFFIXES].sort((a, b) => b.length - a.length);
  const suffixParts = [];
  let guard = 0;
  while (rest && guard++ < 8) {
    let hit = false;
    for (const suf of suffixes) {
      if (rest === suf || (rest.endsWith(suf) && rest.length >= suf.length)) {
        suffixParts.unshift(titleCaseDomainWord(suf));
        rest = rest.slice(0, -suf.length);
        hit = true;
        break;
      }
    }
    if (!hit) break;
  }

  if (rest) {
    const known = [...DOMAIN_NAME_LEFTOVER_WORDS].sort((a, b) => b.length - a.length);
    let cursor = rest;
    let peelGuard = 0;
    while (cursor && peelGuard++ < 24) {
      let hit = false;
      for (const k of known) {
        if (cursor.startsWith(k)) {
          parts.push(titleCaseDomainWord(k));
          cursor = cursor.slice(k.length);
          hit = true;
          break;
        }
      }
      if (hit) continue;
      // Residual prefix before the next known token (e.g. city slug when context missing)
      let bestIdx = -1;
      let bestLen = 0;
      for (const k of known) {
        const idx = cursor.indexOf(k);
        if (idx > 0 && (bestIdx < 0 || idx < bestIdx || (idx === bestIdx && k.length > bestLen))) {
          bestIdx = idx;
          bestLen = k.length;
        }
      }
      if (bestIdx > 0) {
        parts.push(titleCaseDomainWord(cursor.slice(0, bestIdx)));
        cursor = cursor.slice(bestIdx);
        continue;
      }
      parts.push(titleCaseDomainWord(cursor));
      break;
    }
  }

  parts.push(...suffixParts);
  const name = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (name) return name;

  // Fallback: naive camel/slug split of the full label
  return label
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(titleCaseDomainWord)
    .join(' ');
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

/** Launch-critical scalars: prefer draft when accepted still holds a placeholder. */
const LAUNCH_MERGE_KEYS = [
  'web3FormsAccessKey',
  'domain',
  'phone',
  'email',
  'turnstileSiteKey',
  'businessName',
];

function isLaunchMergePlaceholder(key, value) {
  const s = String(value ?? '').trim();
  if (key === 'turnstileSiteKey') return !s;
  if (!s) return true;
  if (key === 'web3FormsAccessKey') {
    return (
      WEB3_PLACEHOLDER_RE.test(s) ||
      /^REPLACE_/i.test(s) ||
      /^YOUR_WEB3FORMS/i.test(s) ||
      /^tbd\b/i.test(s)
    );
  }
  if (key === 'domain') {
    const d = s
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '');
    return !d || d === 'example.com' || d === 'www.example.com' || /^tbd\b/i.test(d);
  }
  if (key === 'phone') {
    return (
      /^\+?1?X+$/i.test(s.replace(/[\s\-().]/g, '')) ||
      /X{4,}/i.test(s) ||
      s === '+1XXXXXXXXXX'
    );
  }
  if (key === 'email') {
    return s === 'leads@example.com' || /^tbd\b/i.test(s) || /@example\.com$/i.test(s);
  }
  if (key === 'businessName') {
    return looksTbd(s) || s === SITE_CONFIG_PLACEHOLDERS.businessName;
  }
  return false;
}

/**
 * Merge accepted + draft for Launch UI / status: prefer draft when accepted is
 * still a placeholder (e.g. Web3Forms key saved in step 4 after Accept).
 */
export function effectiveSiteConfigForLaunch(accepted, draft) {
  const base = stripSiteConfigOps(accepted) || {};
  const fromDraft = stripSiteConfigOps(draft);
  if (!fromDraft) return { ...base };
  const out = { ...base };
  for (const key of LAUNCH_MERGE_KEYS) {
    const draftVal = fromDraft[key];
    const acceptedVal = base[key];
    if (
      !isLaunchMergePlaceholder(key, draftVal) &&
      isLaunchMergePlaceholder(key, acceptedVal)
    ) {
      out[key] = draftVal;
    }
  }
  return out;
}

/**
 * When draft has a real Web3Forms key and accepted still has a placeholder,
 * promote the key onto research accepted + template site-config.
 */
function promoteWeb3FormsKeyFromDraft(candidateId, draft) {
  const key = String(draft?.web3FormsAccessKey ?? '').trim();
  if (!key || isLaunchMergePlaceholder('web3FormsAccessKey', key)) return false;

  const p = pathsFor(candidateId);
  const acceptedRaw = readJson(p.siteConfig);
  if (!acceptedRaw || typeof acceptedRaw !== 'object') return false;

  const { _ops: prevOps, ...accepted } = acceptedRaw;
  if (!isLaunchMergePlaceholder('web3FormsAccessKey', accepted.web3FormsAccessKey)) {
    return false;
  }

  const nextAccepted = {
    ...accepted,
    web3FormsAccessKey: key,
    _ops: {
      ...(prevOps && typeof prevOps === 'object' ? prevOps : {}),
      web3PromotedFromDraftAt: new Date().toISOString(),
    },
  };
  writeJson(p.siteConfig, nextAccepted);

  const template = readTemplateSiteConfig();
  if (template && typeof template === 'object') {
    backupTemplateSiteConfig();
    mkdirSync(path.dirname(SITE_CONFIG_PATH), { recursive: true });
    writeJson(SITE_CONFIG_PATH, { ...template, web3FormsAccessKey: key });
  }

  return true;
}

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

const SUBURB_SCHEMA_JUNK = new Set(['id', 'string', 'xx', 'tbd', 'name', 'state', '[object object]']);

/** City label from a string or object. Never use id / ID / placeId. */
function suburbNameFromItem(x) {
  if (x == null) return '';
  if (typeof x === 'string' || typeof x === 'number') return String(x).trim();
  if (typeof x === 'object' && !Array.isArray(x)) {
    return String(x.name ?? x.city ?? x.label ?? x.place ?? '').trim();
  }
  if (Array.isArray(x)) return suburbNameFromItem(x[0]);
  return '';
}

/**
 * Real municipality names only: coerce objects, drop schema tokens / ids / duplicates / primary.
 * Empty list is fine — Service area fills targetSuburbs next.
 */
export function normalizeTargetSuburbs(raw, { primaryCity, pack } = {}) {
  const primary = String(primaryCity || '').trim().toLowerCase();
  const seen = new Set();
  const out = [];

  const ingest = (list) => {
    const items = Array.isArray(list) ? list : parseListField(list);
    for (const item of items) {
      const name = suburbNameFromItem(item);
      if (!name || name.length < 2) continue;
      if (/^\d+$/.test(name)) continue;
      if (SUBURB_SCHEMA_JUNK.has(name.toLowerCase())) continue;
      if (/^tbd\b/i.test(name)) continue;
      const key = name.toLowerCase();
      if (primary && key === primary) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
      if (out.length >= 8) return;
    }
  };

  ingest(raw);
  if (!out.length && pack) ingest(suburbsFromPack(pack));
  return out;
}

/** Split semicolon/comma lists from ops form fields into string[]. */
export function parseListField(raw) {
  if (Array.isArray(raw)) {
    return raw.map((x) => suburbNameFromItem(x)).filter(Boolean);
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

  if (suburbs.length > 5) {
    warnings.push(
      `targetSuburbs has ${suburbs.length} entries (prefer 3–5 suburbs / 4–6 location pages including primary)`,
    );
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

export function buildDomainPickPrompt(candidateId, nap = {}) {
  const { pack } = assertSiteConfigHandoffReady(candidateId, {
    allowNonPursue: Boolean(nap.allowNonPursue),
  });
  const md = readPromptFile('prompts/claude-domain-pick.md');
  const template = extractPromptTemplate(md);
  const businessName =
    String(nap.businessName || '').trim() ||
    String(pack.narrative?.businessName || pack.businessName || '').trim() ||
    'omit';
  const filled = template
    .replace('{{NICHE}}', String(pack.niche || '').trim() || 'omit')
    .replace(
      '{{CITY}}',
      String(pack.primaryCity || pack.city || '').trim() || 'omit',
    )
    .replace('{{STATE}}', String(pack.state || '').trim().toUpperCase() || 'omit')
    .replace('{{BUSINESS_NAME}}', businessName);
  return {
    prompt: filled,
    package: {
      niche: pack.niche ?? null,
      primaryCity: pack.primaryCity ?? pack.city ?? null,
      state: pack.state ?? null,
    },
  };
}

function normalizeDomainHostname(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^www\./i, '');
  s = s.split('/')[0].split('?')[0].split('#')[0].trim();
  s = s.replace(/\.$/, '');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(s)) {
    return s.includes('.') ? s : '';
  }
  return s;
}

/** Parse Claude domain-pick JSON (or a hostname list) into up to 10 suggestion rows. */
export function parseDomainSuggestions(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const out = [];
  const pushRow = (domain, available, note) => {
    const host = normalizeDomainHostname(domain);
    if (!host || out.some((r) => r.domain === host)) return;
    let avail = null;
    if (available === true || available === 'true' || available === 'yes') avail = true;
    else if (available === false || available === 'false' || available === 'no') avail = false;
    out.push({
      domain: host,
      available: avail,
      note: String(note || '').trim() || null,
    });
  };
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const obj = JSON.parse(raw.slice(start, end + 1));
      const list = Array.isArray(obj?.domains) ? obj.domains : Array.isArray(obj) ? obj : null;
      if (list) {
        for (const row of list) {
          if (typeof row === 'string') pushRow(row, null, null);
          else if (row && typeof row === 'object') {
            pushRow(row.domain || row.host || row.url, row.available, row.note || row.reason);
          }
          if (out.length >= 10) break;
        }
      }
    }
  } catch {
    /* fall through to line parse */
  }
  if (!out.length) {
    for (const line of raw.split(/\r?\n/)) {
      const cleaned = line
        .replace(/^\s*[-*•]\s*/, '')
        .replace(/^\s*\d+[.)]\s*/, '')
        .trim();
      if (!cleaned) continue;
      const hostMatch = cleaned.match(
        /(?:https?:\/\/)?(?:www\.)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/i,
      );
      if (!hostMatch) continue;
      pushRow(hostMatch[1], null, cleaned.replace(hostMatch[0], '').replace(/^[\s—\-|:]+/, '').trim());
      if (out.length >= 10) break;
    }
  }
  return out.slice(0, 10);
}

export async function suggestDomainsWithClaude(candidateId, nap = {}) {
  const { prompt, package: pack } = buildDomainPickPrompt(candidateId, nap);
  const { text, costUsd, costNote, usage, model } = await claudeMessages({
    user: prompt,
    maxTokens: 2048,
    temperature: 0.3,
    costKey: { candidateId, label: 'domainPick' },
  });
  const suggestions = parseDomainSuggestions(text);
  if (!suggestions.length) {
    throw Object.assign(
      new Error('Claude returned no domain hosts — try Suggest domains again.'),
      { status: 400 },
    );
  }
  return {
    ok: true,
    suggestions,
    costUsd,
    costNote,
    usage,
    model,
    package: pack,
  };
}

export async function generateSiteConfigWithClaude(candidateId, nap = {}) {
  const { prompt } = buildSiteConfigPrompt(candidateId, nap);
  const { text, costUsd, costNote, usage, model } = await claudeMessages({
    user: prompt,
    maxTokens: 8192,
    temperature: 0.3,
    costKey: { candidateId, label: 'siteConfig' },
  });
  const pasted = pasteSiteConfigDraft(candidateId, text, nap);
  return {
    ok: true,
    draft: pasted.draft,
    placeholders: pasted.placeholders,
    suburbCheck: pasted.suburbCheck,
    costUsd,
    costNote,
    usage,
    model,
    candidate: pasted.candidate,
  };
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

  let addrStreet = String(nap.addressStreet || nap.street || '').trim();
  let addrCity = String(nap.addressCity || '').trim();
  let addrState = String(nap.addressState || '')
    .trim()
    .toUpperCase();
  let addrZip = String(nap.addressZip || nap.zip || '').trim();
  const addrPkg = getBusinessAddressPackage(candidateId);
  if (addrPkg?.skipped) {
    addrStreet = '';
    addrCity = '';
    addrState = '';
    addrZip = '';
  } else if (!addrStreet && addrPkg?.selection) {
    addrStreet = String(addrPkg.selection.street || '').trim();
    addrCity = String(addrPkg.selection.city || '').trim();
    addrState = String(addrPkg.selection.state || '')
      .trim()
      .toUpperCase();
    addrZip = String(addrPkg.selection.zip || '').trim();
  }

  const filled = template
    .replace('{{PASTE_APPROVED_CANDIDATE_JSON}}', JSON.stringify(pack, null, 2))
    .replace('{{DOMAIN}}', String(nap.domain || '').trim() || 'example.com')
    .replace(
      '{{BUSINESS_NAME}}',
      String(nap.businessName || '').trim() || (pack.niche ? `${pack.niche} Pros` : 'Business'),
    )
    .replace('{{PHONE}}', String(nap.phone || '').trim() || '+1XXXXXXXXXX')
    .replace('{{EMAIL}}', publicLeadsEmail(nap.email, nap.domain) || 'leads@example.com')
    .replace(
      '{{RADIUS_MILES}}',
      nap.radiusMiles != null && nap.radiusMiles !== '' ? String(nap.radiusMiles) : '15',
    )
    .replace('{{ADDRESS_STREET}}', addrStreet || 'omit')
    .replace(
      '{{ADDRESS_CITY}}',
      addrCity || String(pack.primaryCity || pack.city || '').trim() || 'omit',
    )
    .replace(
      '{{ADDRESS_STATE}}',
      addrState || String(pack.state || '').trim().toUpperCase() || 'omit',
    )
    .replace('{{ADDRESS_ZIP}}', addrZip || 'omit')
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
    address: addrStreet
      ? { street: addrStreet, city: addrCity, state: addrState, zip: addrZip }
      : null,
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
  if (suburbs.length && suburbs.every((x) => looksTbd(x))) placeholders.push('targetSuburbs');

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
  base.targetSuburbs = normalizeTargetSuburbs(base.targetSuburbs, {
    primaryCity: base.primaryCity,
    pack,
  });

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

  const napRadius = Number(nap.radiusMiles);
  if (Number.isFinite(napRadius) && napRadius > 0) {
    base.serviceRadiusMiles = napRadius;
  } else if (isBlank(base.serviceRadiusMiles) || Number(base.serviceRadiusMiles) === 40) {
    // Blank or leftover Claude example (40) → operator default 15.
    base.serviceRadiusMiles = 15;
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
    candidate: getCandidateShell(candidateId),
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

  promoteWeb3FormsKeyFromDraft(candidateId, draft);

  return {
    ok: true,
    draft,
    suburbCheck,
    placeholders,
    candidate: getCandidateShell(candidateId),
  };
}

/**
 * Write draft to src/config/site-config.json (backs up previous).
 */
export function acceptSiteConfig(
  candidateId,
  {
    allowNonPursue = false,
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
  const pack = getApprovedPackage(candidateId);
  const clean = applyNormalizedAddress(
    ensureBusinessNameNotNiche(applyArchetypeDefaults(cleanRaw)),
  );
  clean.targetSuburbs = normalizeTargetSuburbs(clean.targetSuburbs, {
    primaryCity: clean.primaryCity,
    pack,
  });
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
    candidate: getCandidateShell(candidateId),
  };
}

/**
 * Persist Service area Accept: coverageAreas + radius + location pages (targetSuburbs).
 * Prefer ≤5 suburbs (6 pages with primary). Hard cap 8 suburbs.
 */
export function acceptServiceArea(
  candidateId,
  {
    radiusMiles,
    selectedCities = [],
    claudeOrder = null,
    locationPageCities = null,
  } = {},
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
      ? Math.min(100, Math.max(1, miles))
      : Number(accepted.serviceRadiusMiles) || 15;

  const selected = Array.isArray(selectedCities) ? selectedCities : [];
  if (!selected.length) {
    const err = new Error('Select at least one coverage city');
    err.status = 400;
    throw err;
  }

  const coverageAreas = toCoverageAreas(selected, primaryCity, state);
  const primaryNorm = String(primaryCity).trim().toLowerCase();

  let targetSuburbs;
  if (Array.isArray(locationPageCities) && locationPageCities.length) {
    const covNames = new Set(
      coverageAreas.map((a) => String(a.name || '').trim().toLowerCase()).filter(Boolean),
    );
    const seen = new Set();
    targetSuburbs = [];
    for (const raw of locationPageCities) {
      const name = String(typeof raw === 'string' ? raw : raw?.name || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (key === primaryNorm) continue;
      if (!covNames.has(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      targetSuburbs.push(name);
      if (targetSuburbs.length >= 8) break;
    }
  } else {
    const claude =
      Array.isArray(claudeOrder) && claudeOrder.length
        ? claudeOrder
        : Array.isArray(accepted.targetSuburbs)
          ? accepted.targetSuburbs
          : [];
    targetSuburbs = mergeLocationPages({
      coverage: coverageAreas,
      claudeOrder: claude,
      primaryCity,
      state,
      max: 5,
    });
  }

  const pageCount = 1 + targetSuburbs.length;
  if (pageCount > 6) {
    const err = new Error(
      `Too many location pages (${pageCount}). Pick up to 6 cities for pages (others stay as coverage only).`,
    );
    err.status = 400;
    err.code = 'LOCATION_PAGES_OVER_CAP';
    err.pageCount = pageCount;
    throw err;
  }

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
    candidate: getCandidateShell(candidateId),
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
    candidate: getCandidateShell(candidateId),
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
    candidate: getCandidateShell(candidateId),
  };
}

export { listArchetypes, suggestArchetype, normalizeArchetype };
