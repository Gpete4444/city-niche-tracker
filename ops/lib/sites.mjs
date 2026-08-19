/**
 * Portfolio registry of launched / rentable sites.
 * Storage: research/sites.json — portfolio fields owned here; NAP/infra hydrated from candidate.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RESEARCH_DIR, getCandidateDetail, pathsFor } from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';

export const SITES_FILE = path.join(RESEARCH_DIR, 'sites.json');
export const SITES_FILENAME = 'sites.json';

export const SITE_STATUSES = ['building', 'live', 'listed', 'rented', 'paused', 'retired'];
export const PAYMENT_METHODS = ['ach', 'card', 'check', 'wire', 'cash', 'other'];
export const BILLING_CYCLES = ['monthly', 'annual', 'one_time', 'other'];

const WEB3_PLACEHOLDER_RE = /^(REPLACE_WEB3FORMS_KEY|YOUR_WEB3FORMS_ACCESS_KEY)$/i;

function ensureResearchDir() {
  mkdirSync(RESEARCH_DIR, { recursive: true });
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
  ensureResearchDir();
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

function newSiteId() {
  return `site_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyRenter() {
  return {
    businessName: '',
    contactName: '',
    email: '',
    phone: '',
    notes: '',
  };
}

function emptyPhoneTracking() {
  return {
    phase: 'none', // none | ranking | rented
    provider: null,
    e164: '',
    twilioSid: '',
    voiceWebhookUrl: '',
    forwardTo: '',
    provisionedAt: null,
    forwardedAt: null,
  };
}

function defaultPortfolioFields(partial = {}) {
  return {
    status: SITE_STATUSES.includes(partial.status) ? partial.status : 'building',
    targetRentUsd: partial.targetRentUsd ?? null,
    actualRentUsd: partial.actualRentUsd ?? null,
    renter: { ...emptyRenter(), ...(partial.renter || {}) },
    paymentMethod: PAYMENT_METHODS.includes(partial.paymentMethod)
      ? partial.paymentMethod
      : partial.paymentMethod === null || partial.paymentMethod === undefined
        ? null
        : 'other',
    paymentMethodNotes: partial.paymentMethodNotes ?? '',
    billingCycle: BILLING_CYCLES.includes(partial.billingCycle)
      ? partial.billingCycle
      : 'monthly',
    contractStart: partial.contractStart ?? null,
    contractEnd: partial.contractEnd ?? null,
    nextInvoiceAt: partial.nextInvoiceAt ?? null,
    notes: partial.notes ?? '',
    phoneTracking: {
      ...emptyPhoneTracking(),
      ...(partial.phoneTracking && typeof partial.phoneTracking === 'object'
        ? partial.phoneTracking
        : {}),
    },
  };
}

function loadRegistry() {
  const raw = readJson(SITES_FILE, null);
  if (!raw || typeof raw !== 'object') {
    return { version: 1, sites: [] };
  }
  return {
    version: Number(raw.version) || 1,
    sites: Array.isArray(raw.sites) ? raw.sites : [],
  };
}

function saveRegistry(registry) {
  writeJson(SITES_FILE, {
    version: registry.version || 1,
    sites: registry.sites || [],
  });
}

function cloudflareDashboardUrl(cfProject) {
  const account = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  if (account && cfProject) {
    return `https://dash.cloudflare.com/${account}/workers/services/view/${encodeURIComponent(cfProject)}`;
  }
  if (account) return `https://dash.cloudflare.com/${account}`;
  return 'https://dash.cloudflare.com/';
}

function liveUrlFromDomain(domain) {
  const d = String(domain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  if (!d) return null;
  return `https://${d}`;
}

function moneyOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read-only fields from candidate site-config + meta.
 */
export function hydrateFromCandidate(candidateId) {
  let detail;
  try {
    detail = getCandidateDetail(candidateId);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }

  const config = loadAcceptedSiteConfig(candidateId)?.config || {};
  const meta = detail.meta || {};
  const research = detail.research || {};
  const approved = detail.approved || {};

  const niche =
    config.niche ||
    research.niche ||
    approved.niche ||
    meta.niche ||
    null;
  const city =
    config.primaryCity ||
    (typeof config.primary === 'string' ? config.primary.split(',')[0]?.trim() : null) ||
    research.primaryCity ||
    approved.city ||
    null;
  const state =
    config.state ||
    (typeof config.primary === 'string' ? config.primary.split(',')[1]?.trim() : null) ||
    research.state ||
    approved.state ||
    (typeof meta.primary === 'string' ? meta.primary.split(',')[1]?.trim() : null) ||
    null;

  const domain = String(config.domain || meta.launchDomain || '').trim() || null;
  const web3 = String(config.web3FormsAccessKey || '').trim();
  const web3FormsAccessKeySet = Boolean(web3) && !WEB3_PLACEHOLDER_RE.test(web3);
  const cfProject = meta.cfProject || null;

  const lastCosts = meta.lastCosts || {};
  const launchCostUsd = Object.values(lastCosts).reduce((sum, v) => {
    const n = Number(v);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  return {
    candidateId: pathsFor(candidateId).id,
    niche,
    city,
    state,
    businessName: config.businessName || null,
    domain,
    liveUrl: liveUrlFromDomain(domain),
    phone: config.phone || null,
    email: config.email || null,
    githubRepo: meta.githubRepo || null,
    githubRepoUrl: meta.githubRepoUrl || null,
    cfProject,
    cloudflareDashboardUrl: cloudflareDashboardUrl(cfProject),
    web3FormsDashboardUrl: 'https://web3forms.com/',
    web3FormsAccessKeySet,
    turnstileSiteKeySet: Boolean(String(config.turnstileSiteKey || '').trim()),
    formsDone: Boolean(meta.formsDone),
    dnsDone: Boolean(meta.dnsDone),
    emailRoutingDone: Boolean(meta.emailRoutingDone),
    cloudflarePagesDone: Boolean(meta.cloudflarePagesDone),
    lastLaunchAt: meta.lastLaunchAt || null,
    lastShipAt: meta.lastShipAt || null,
    launchCostUsd: launchCostUsd > 0 ? Math.round(launchCostUsd * 1000) / 1000 : null,
    lastCosts,
  };
}

function mergeSiteRow(row) {
  const hydrated = row.candidateId ? hydrateFromCandidate(row.candidateId) : null;
  return {
    ...row,
    renter: { ...emptyRenter(), ...(row.renter || {}) },
    phoneTracking: {
      ...emptyPhoneTracking(),
      ...(row.phoneTracking && typeof row.phoneTracking === 'object' ? row.phoneTracking : {}),
    },
    hydrated: Boolean(hydrated),
    ...(hydrated || {
      niche: row.niche || null,
      city: row.city || null,
      state: row.state || null,
      businessName: row.businessName || null,
      domain: row.domain || null,
      liveUrl: liveUrlFromDomain(row.domain),
      phone: row.phone || null,
      email: row.email || null,
      githubRepo: null,
      githubRepoUrl: null,
      cfProject: null,
      cloudflareDashboardUrl: cloudflareDashboardUrl(null),
      web3FormsDashboardUrl: 'https://web3forms.com/',
      web3FormsAccessKeySet: false,
      turnstileSiteKeySet: false,
      formsDone: false,
      dnsDone: false,
      emailRoutingDone: false,
      cloudflarePagesDone: false,
      lastLaunchAt: null,
      lastShipAt: null,
      launchCostUsd: null,
      lastCosts: null,
    }),
  };
}

export function listSites() {
  return loadRegistry().sites.map(mergeSiteRow);
}

export function getSite(id) {
  const row = loadRegistry().sites.find((s) => s.id === id);
  if (!row) {
    throw Object.assign(new Error('Site not found'), { status: 404 });
  }
  return mergeSiteRow(row);
}

/**
 * Create or return existing row for a candidate.
 * @param {{ candidateId: string, status?: string }} opts
 */
export function upsertSiteFromCandidate({ candidateId, status } = {}) {
  const id = String(candidateId || '').trim();
  if (!id) {
    throw Object.assign(new Error('candidateId is required'), { status: 400 });
  }
  const hydrated = hydrateFromCandidate(id);
  if (!hydrated) {
    throw Object.assign(new Error(`Candidate not found: ${id}`), { status: 404 });
  }

  const registry = loadRegistry();
  const existing = registry.sites.find((s) => s.candidateId === hydrated.candidateId);
  if (existing) {
    existing.updatedAt = nowIso();
    if (status && SITE_STATUSES.includes(status)) existing.status = status;
    else if (
      existing.status === 'building' &&
      (hydrated.cloudflarePagesDone || hydrated.formsDone || hydrated.domain)
    ) {
      existing.status = 'live';
    }
    saveRegistry(registry);
    return mergeSiteRow(existing);
  }

  const ts = nowIso();
  const initialStatus =
    status && SITE_STATUSES.includes(status)
      ? status
      : hydrated.cloudflarePagesDone || hydrated.formsDone || hydrated.domain
        ? 'live'
        : 'building';

  const row = {
    id: newSiteId(),
    candidateId: hydrated.candidateId,
    ...defaultPortfolioFields({ status: initialStatus }),
    createdAt: ts,
    updatedAt: ts,
  };
  registry.sites.push(row);
  saveRegistry(registry);
  return mergeSiteRow(row);
}

/**
 * Upsert after Launch — never throws into launch flow.
 */
export function upsertSiteAfterLaunch(candidateId) {
  try {
    return upsertSiteFromCandidate({ candidateId });
  } catch (error) {
    console.warn('[sites] upsert after launch failed:', error.message);
    return null;
  }
}

/**
 * Batch upsert from candidate ids. Idempotent — existing rows count as updated.
 * @param {string[]} candidateIds
 * @returns {{ added: object[], updated: object[], errors: { id: string, error: string }[] }}
 */
export function upsertSitesFromCandidates(candidateIds = []) {
  const ids = [
    ...new Set((candidateIds || []).map((id) => String(id || '').trim()).filter(Boolean)),
  ];
  if (!ids.length) {
    throw Object.assign(new Error('candidateIds required'), { status: 400 });
  }

  const known = new Set(loadRegistry().sites.map((s) => s.candidateId).filter(Boolean));
  const added = [];
  const updated = [];
  const errors = [];

  for (const raw of ids) {
    try {
      const hydrated = hydrateFromCandidate(raw);
      if (!hydrated) {
        throw Object.assign(new Error(`Candidate not found: ${raw}`), { status: 404 });
      }
      const cid = hydrated.candidateId;
      const existed = known.has(cid);
      const site = upsertSiteFromCandidate({ candidateId: cid });
      if (existed) updated.push(site);
      else {
        added.push(site);
        known.add(cid);
      }
    } catch (error) {
      errors.push({ id: raw, error: error.message || String(error) });
    }
  }

  return { added, updated, errors };
}

export function createManualSite(body = {}) {
  const domain = String(body.domain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  if (!domain && !body.candidateId) {
    throw Object.assign(new Error('candidateId or domain is required'), { status: 400 });
  }
  if (body.candidateId) {
    return upsertSiteFromCandidate({
      candidateId: body.candidateId,
      status: body.status,
    });
  }

  const registry = loadRegistry();
  const dup = registry.sites.find(
    (s) => String(s.domain || '').toLowerCase() === domain.toLowerCase(),
  );
  if (dup) {
    throw Object.assign(new Error(`Site for domain ${domain} already exists`), {
      status: 409,
    });
  }

  const ts = nowIso();
  const row = {
    id: newSiteId(),
    candidateId: null,
    domain,
    niche: body.niche || null,
    city: body.city || null,
    state: body.state || null,
    businessName: body.businessName || null,
    phone: body.phone || null,
    email: body.email || null,
    ...defaultPortfolioFields(body),
    createdAt: ts,
    updatedAt: ts,
  };
  registry.sites.push(row);
  saveRegistry(registry);
  return mergeSiteRow(row);
}

export function updateSite(id, patch = {}) {
  const registry = loadRegistry();
  const row = registry.sites.find((s) => s.id === id);
  if (!row) {
    throw Object.assign(new Error('Site not found'), { status: 404 });
  }

  if (patch.status !== undefined) {
    if (!SITE_STATUSES.includes(patch.status)) {
      throw Object.assign(new Error(`status must be one of: ${SITE_STATUSES.join(', ')}`), {
        status: 400,
      });
    }
    row.status = patch.status;
  }
  if (patch.targetRentUsd !== undefined) row.targetRentUsd = moneyOrNull(patch.targetRentUsd);
  if (patch.actualRentUsd !== undefined) row.actualRentUsd = moneyOrNull(patch.actualRentUsd);
  if (patch.paymentMethod !== undefined) {
    if (patch.paymentMethod === null || patch.paymentMethod === '') {
      row.paymentMethod = null;
    } else if (!PAYMENT_METHODS.includes(patch.paymentMethod)) {
      throw Object.assign(
        new Error(`paymentMethod must be one of: ${PAYMENT_METHODS.join(', ')}`),
        { status: 400 },
      );
    } else {
      row.paymentMethod = patch.paymentMethod;
    }
  }
  if (patch.paymentMethodNotes !== undefined) {
    row.paymentMethodNotes = String(patch.paymentMethodNotes || '');
  }
  if (patch.billingCycle !== undefined) {
    if (!BILLING_CYCLES.includes(patch.billingCycle)) {
      throw Object.assign(
        new Error(`billingCycle must be one of: ${BILLING_CYCLES.join(', ')}`),
        { status: 400 },
      );
    }
    row.billingCycle = patch.billingCycle;
  }
  if (patch.contractStart !== undefined) row.contractStart = patch.contractStart || null;
  if (patch.contractEnd !== undefined) row.contractEnd = patch.contractEnd || null;
  if (patch.nextInvoiceAt !== undefined) row.nextInvoiceAt = patch.nextInvoiceAt || null;
  if (patch.notes !== undefined) row.notes = String(patch.notes || '');

  if (patch.renter && typeof patch.renter === 'object') {
    row.renter = {
      ...emptyRenter(),
      ...(row.renter || {}),
      ...Object.fromEntries(
        ['businessName', 'contactName', 'email', 'phone', 'notes'].map((k) => [
          k,
          patch.renter[k] !== undefined
            ? String(patch.renter[k] ?? '')
            : String(row.renter?.[k] ?? ''),
        ]),
      ),
    };
  }

  if (patch.phoneTracking && typeof patch.phoneTracking === 'object') {
    row.phoneTracking = {
      ...emptyPhoneTracking(),
      ...(row.phoneTracking || {}),
      ...patch.phoneTracking,
    };
  }

  // Manual rows may update identity fields
  if (!row.candidateId) {
    for (const key of ['niche', 'city', 'state', 'businessName', 'domain', 'phone', 'email']) {
      if (patch[key] !== undefined) row[key] = patch[key] || null;
    }
  }

  row.updatedAt = nowIso();
  saveRegistry(registry);
  return mergeSiteRow(row);
}

/**
 * Merge phoneTracking onto a portfolio row (Twilio provision / forward cutover).
 */
export function setSitePhoneTracking(id, phoneTracking = {}) {
  return updateSite(id, { phoneTracking });
}

/** Sites with a Twilio DID (for Phone tab sidebar). */
export function listSitesWithPhone() {
  return listSites().filter(
    (s) => s.phoneTracking?.provider === 'twilio' && s.phoneTracking?.e164,
  );
}

export function deleteSite(id) {
  const registry = loadRegistry();
  const idx = registry.sites.findIndex((s) => s.id === id);
  if (idx < 0) {
    throw Object.assign(new Error('Site not found'), { status: 404 });
  }
  const [removed] = registry.sites.splice(idx, 1);
  saveRegistry(registry);
  return { ok: true, id: removed.id, candidateId: removed.candidateId || null };
}
