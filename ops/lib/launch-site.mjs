/**
 * Orchestrate Rover launch: patch assembled site-config (NAP / leads email),
 * run Cloudflare helpers, set checklist meta flags.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyLaunchNumber,
  getCandidateDetail,
  launchStampPatch,
  loadMeta,
  pathsFor,
  RESEARCH_DIR,
  saveMeta,
  withLaunchCountLock,
} from './candidates.mjs';
import { getAssembleChecklist, templateComponentsNewerThanAssembled, templateStaleLaunchError } from './assemble-site.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import {
  cloudflareConfigured,
  normalizeDomain,
  runCloudflareLaunch,
} from './cloudflare-launch.mjs';
import { shipAssembledSite, listShipProgressSteps } from './ship-site.mjs';
import {
  isGithubPushRejectedMessage,
  isGithubRepoCreateRateLimitMessage,
  isGithubRepoMissingMessage,
  resolveGithubOwner,
} from './github-site.mjs';
import { upsertSiteAfterLaunch } from './sites.mjs';
import {
  publicLeadsEmail,
  ensureBusinessNameNotNiche,
  effectiveSiteConfigForLaunch,
  getSiteConfigDraft,
  normalizeSiteAddress,
  parseListField,
} from './site-config.mjs';
import { formsInboxStatus, formsIngestSubmitUrl, syncFormsAllowlist } from './forms-inbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const WEB3_PLACEHOLDER_RE = /^(REPLACE_WEB3FORMS_KEY|YOUR_WEB3FORMS_ACCESS_KEY)$/i;

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function resolveAssembledRoot(detail) {
  const rel = detail.meta?.assembledSitePath;
  if (!rel) return null;
  const abs = path.isAbsolute(rel) ? rel : path.resolve(ROOT, rel);
  return existsSync(abs) ? abs : null;
}

function defaultNotifyEmail() {
  return String(process.env.LEAD_NOTIFY_EMAIL || process.env.WEB3FORMS_DEFAULT_NOTIFY_EMAIL || '').trim();
}

export function isLaunchWeb3Placeholder(key) {
  const s = String(key || '').trim();
  return (
    !s ||
    WEB3_PLACEHOLDER_RE.test(s) ||
    /^REPLACE_/i.test(s) ||
    /^YOUR_WEB3FORMS/i.test(s) ||
    /^tbd\b/i.test(s)
  );
}

export function isLaunchDomainPlaceholder(domain) {
  const d = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  return !d || d === 'example.com' || d === 'www.example.com' || /^tbd\b/i.test(d);
}

export function isLaunchPhonePlaceholder(phone) {
  const phoneRaw = String(phone || '').trim();
  return (
    !phoneRaw ||
    /^\+?1?X+$/i.test(phoneRaw.replace(/[\s\-().]/g, '')) ||
    /X{4,}/i.test(phoneRaw) ||
    phoneRaw === '+1XXXXXXXXXX'
  );
}

/**
 * Hard blockers for Auto ship / first go-live.
 * @returns {{ id: string, label: string }[]}
 */
export function collectLaunchBlockers(config = {}, opts = {}) {
  const issues = [];
  if (isLaunchDomainPlaceholder(config.domain)) {
    issues.push({ id: 'domain', label: 'Domain still empty or example.com' });
  }
  if (isLaunchPhonePlaceholder(config.phone)) {
    issues.push({
      id: 'phone',
      label: 'Phone still a placeholder (provision Twilio or set a real number)',
    });
  }
  const inboxReady =
    opts.formsInboxReady !== undefined ? Boolean(opts.formsInboxReady) : formsInboxStatus().ready;
  if (!inboxReady) {
    issues.push({
      id: 'forms',
      label: 'Forms inbox is not set up. Open Phone/Form and click Set up inbox.',
    });
  }
  const destination = String(opts.destinationEmail ?? defaultNotifyEmail() ?? '').trim();
  if (!destination) {
    issues.push({
      id: 'destination',
      label:
        'Email Routing destination missing — set it in Launch or LEAD_NOTIFY_EMAIL',
    });
  }
  return issues;
}

/**
 * Patch NAP / forms fields into assembled + research site-config copies.
 * @param {string} candidateId
 * @param {object} patch
 */
export function patchLaunchSiteConfig(candidateId, patch = {}) {
  const detail = getCandidateDetail(candidateId);
  const loaded = loadAcceptedSiteConfig(candidateId);
  if (!loaded?.config) {
    const err = new Error('Accept site-config first');
    err.status = 400;
    throw err;
  }

  const next = { ...loaded.config };
  const assign = (key, value) => {
    if (value === undefined || value === null) return;
    const s = String(value).trim();
    if (!s) return;
    next[key] = s;
  };

  assign('domain', patch.domain);
  assign('phone', patch.phone);
  assign('email', patch.email);
  assign('businessName', patch.businessName);
  for (const key of ['tagline', 'primaryCta', 'niche', 'primaryCity', 'state']) {
    if (patch[key] === undefined) continue;
    const s = String(patch[key] ?? '').trim();
    if (!s) continue;
    next[key] = key === 'state' ? s.toUpperCase() : s;
  }
  if (patch.serviceRadiusMiles !== undefined) {
    const n = Number(patch.serviceRadiusMiles);
    if (Number.isFinite(n) && n > 0) next.serviceRadiusMiles = n;
  }
  if (patch.targetSuburbs !== undefined) next.targetSuburbs = parseListField(patch.targetSuburbs);
  if (patch.address === null) {
    delete next.address;
  } else if (patch.address && typeof patch.address === 'object') {
    const norm = normalizeSiteAddress(patch.address, {
      primaryCity: next.primaryCity,
      state: next.state,
    });
    if (norm) next.address = norm;
    else delete next.address;
  }
  if (patch.web3FormsAccessKey !== undefined) {
    const key = String(patch.web3FormsAccessKey || '').trim();
    if (key) next.web3FormsAccessKey = key;
  }
  if (patch.turnstileSiteKey !== undefined) {
    next.turnstileSiteKey = String(patch.turnstileSiteKey || '').trim();
  }
  const formsIngest = formsIngestSubmitUrl();
  if (formsIngest) next.formsIngestUrl = formsIngest;

  Object.assign(next, ensureBusinessNameNotNiche(next));
  if (next.domain) {
    next.email = publicLeadsEmail(next.email, next.domain);
  }

  const researchPath = pathsFor(candidateId).siteConfig;
  writeJson(researchPath, next);

  const livePath = path.join(ROOT, 'src', 'config', 'site-config.json');
  if (existsSync(livePath) && detail.meta?.siteConfigPath === 'src/config/site-config.json') {
    writeJson(livePath, next);
  }

  const assembledRoot = resolveAssembledRoot(detail);
  let assembledConfigPath = null;
  if (assembledRoot) {
    assembledConfigPath = path.join(assembledRoot, 'src', 'config', 'site-config.json');
    writeJson(assembledConfigPath, next);
  }

  return {
    config: next,
    researchPath: path.relative(ROOT, researchPath).replace(/\\/g, '/'),
    assembledConfigPath: assembledConfigPath
      ? path.relative(ROOT, assembledConfigPath).replace(/\\/g, '/')
      : null,
    assembledSitePath: assembledRoot
      ? path.relative(ROOT, assembledRoot).replace(/\\/g, '/')
      : detail.meta?.assembledSitePath || null,
  };
}

function readLaunchCountRows() {
  if (!existsSync(RESEARCH_DIR)) return [];
  const rows = [];
  for (const name of readdirSync(RESEARCH_DIR)) {
    if (!name.endsWith('.meta.json')) continue;
    const id = name.slice(0, -'.meta.json'.length);
    const meta = loadMeta(id);
    rows.push({
      id,
      lastLaunchAt: meta?.lastLaunchAt || null,
      lastShipAt: meta?.lastShipAt || null,
      launchNumber: meta?.launchNumber ?? null,
    });
  }
  return rows;
}

/**
 * Stamp the first success and assign launchNumber while holding the launch-count lock.
 * Already-launched sites without a number are numbered in first-launch order first.
 */
export async function commitLaunchCount(candidateId, { ok, at, patch = {} } = {}) {
  return withLaunchCountLock(() => {
    const before = readLaunchCountRows();
    const applied = applyLaunchNumber(before, { id: candidateId, ok, at });
    const previous = new Map(before.map((row) => [row.id, row]));
    for (const row of applied.rows) {
      const prev = previous.get(row.id);
      const prevNum = Number(prev?.launchNumber) || 0;
      const nextNum = Number(row.launchNumber) || 0;
      const numberChanged = nextNum > 0 && nextNum !== prevNum;
      if (row.id === candidateId) {
        const stamp = {};
        if (ok && row.lastLaunchAt && row.lastLaunchAt !== (prev?.lastLaunchAt || null)) {
          stamp.lastLaunchAt = row.lastLaunchAt;
        }
        if (!ok) Object.assign(stamp, launchStampPatch(prev || {}, { ok: false, at }));
        saveMeta(candidateId, {
          ...patch,
          ...stamp,
          ...(nextNum > 0 ? { launchNumber: nextNum } : {}),
        });
      } else if (numberChanged) {
        saveMeta(row.id, { launchNumber: nextNum });
      }
    }
    return {
      launchNumber: applied.launchNumber,
      launchedTotal: applied.launchedTotal,
    };
  });
}

/**
 * Launch: write keys + optional Cloudflare setup.
 * @param {string} candidateId
 * @param {{
 *   domain?: string,
 *   phone?: string,
 *   email?: string,
 *   web3FormsAccessKey?: string,
 *   turnstileSiteKey?: string,
 *   destinationEmail?: string,
 *   runCloudflare?: boolean,
 *   ship?: boolean,
 *   skipGithub?: boolean,
 *   skipBuild?: boolean,
 *   skipDeploy?: boolean,
 *   skipBuildsConnect?: boolean,
 *   createTurnstile?: boolean,
 *   attachDomain?: boolean,
 *   setupEmail?: boolean,
 *   markCloudflareProjectDone?: boolean,
 *   allowIncompleteLaunch?: boolean,
 *   onProgress?: (p: { done: number, total: number, detail: string }) => void,
 * }} [opts]
 */
export function listLaunchProgressSteps(opts = {}) {
  const steps = ['Writing keys / site-config…'];
  if (opts.ship !== false) {
    steps.push(
      ...listShipProgressSteps({
        skipGithub: opts.skipGithub === true,
        skipBuild: opts.skipBuild === true,
        skipDeploy: opts.skipDeploy === true || !cloudflareConfigured(),
        skipBuildsConnect: opts.skipBuildsConnect === true,
      }),
    );
  }
  if (opts.runCloudflare !== false && cloudflareConfigured()) {
    steps.push('Cloudflare domain / Email Routing…');
  }
  return steps;
}

export async function launchSite(candidateId, opts = {}) {
  const detail = getCandidateDetail(candidateId);
  const assembledRoot = resolveAssembledRoot(detail);
  if (!assembledRoot) {
    const err = new Error('Assemble the site first (no assembledSitePath)');
    err.status = 400;
    err.checklist = getAssembleChecklist(candidateId);
    throw err;
  }

  if (opts.ship !== false) {
    const stale = templateStaleLaunchError(assembledRoot);
    if (stale) throw stale;
  }

  const loaded = loadAcceptedSiteConfig(candidateId);
  const base = loaded?.config || {};
  const domain = normalizeDomain(opts.domain || base.domain);
  const email =
    publicLeadsEmail(
      opts.email || base.email,
      domain || base.domain,
    ) ||
    (domain ? `leads@${domain}` : '');
  const destinationEmail =
    String(opts.destinationEmail || defaultNotifyEmail() || '').trim() || '';

  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const planned = listLaunchProgressSteps(opts);
  const total = planned.length;
  let done = 0;
  const tick = (detail) => {
    done += 1;
    onProgress?.({ done, total, detail });
  };

  tick('Writing keys / site-config…');
  const patched = patchLaunchSiteConfig(candidateId, {
    domain,
    phone: opts.phone,
    email,
    businessName: opts.businessName,
    web3FormsAccessKey: opts.web3FormsAccessKey,
    turnstileSiteKey: opts.turnstileSiteKey,
  });

  const formsDone = formsInboxStatus().ready && Boolean(destinationEmail);

  const doShip = opts.ship !== false;
  const blockers = collectLaunchBlockers(patched.config, { destinationEmail });
  if (doShip && blockers.length && opts.allowIncompleteLaunch !== true) {
    const err = new Error(
      `Launch blocked — fix before shipping: ${blockers.map((b) => b.label).join('; ')}`,
    );
    err.status = 400;
    err.code = 'LAUNCH_BLOCKED';
    err.details = { blockers };
    throw err;
  }

  const human = [];
  if (!formsInboxStatus().ready) {
    human.push('Set up the forms inbox on Phone/Form, then re-run Launch so the contact form can deliver leads.');
  } else if (!destinationEmail) {
    human.push('Set the Email Routing destination so Rover can email the lead to your inbox.');
  } else {
    human.push(
      `Rover emails leads from ${email || `leads@${domain || 'the domain'}`} to ${destinationEmail}.`,
    );
  }
  if (blockers.length && opts.allowIncompleteLaunch === true) {
    human.push(
      `Incomplete launch override: ${blockers.map((b) => b.id).join(', ')} still need attention.`,
    );
  }

  let ship = null;
  if (doShip) {
    try {
      ship = await shipAssembledSite(candidateId, {
        skipGithub: opts.skipGithub === true,
        skipBuild: opts.skipBuild === true,
        skipDeploy: opts.skipDeploy === true || !cloudflareConfigured(),
        skipBuildsConnect: opts.skipBuildsConnect === true,
        onProgress: ({ detail }) => tick(detail),
      });
      human.push(...(ship.human || []));
    } catch (error) {
      ship = error.ship || { ok: false, error: error.message };
      human.push(`Ship failed: ${error.message}`);
      // Continue to CF helpers when possible (email/domain) even if ship failed mid-way
    }
  } else if (formsDone) {
    human.push('Skipped auto ship (GitHub/build/deploy).');
  }

  let cf = null;
  const runCf = opts.runCloudflare !== false;
  if (runCf) {
    if (!cloudflareConfigured()) {
      human.push(
        'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env to automate deploy + domain + Email Routing.',
      );
    } else {
      try {
        tick('Cloudflare domain / Email Routing…');
        const workerName =
          detail.meta?.assembledSiteSlug ||
          path.basename(assembledRoot) ||
          null;
        cf = await runCloudflareLaunch({
          domain,
          leadsEmail: email.includes('@') ? email : `leads@${domain}`,
          destinationEmail,
          workerName,
          createTurnstile: false,
          attachDomain: opts.attachDomain !== false,
          setupEmail: opts.setupEmail !== false,
        });
        human.push(...(cf.human || []));

        if (cf.turnstileSiteKey && !opts.turnstileSiteKey) {
          Object.assign(
            patched,
            patchLaunchSiteConfig(candidateId, {
              turnstileSiteKey: cf.turnstileSiteKey,
            }),
          );
        }
      } catch (error) {
        cf = { ok: false, error: error.message };
        human.push(`Cloudflare helpers failed: ${error.message}`);
      }
    }
  } else {
    human.push('Skipped Cloudflare API (runCloudflare=false).');
  }

  const shipOk = Boolean(ship?.ok);
  // Go-live success requires a real forms key and a successful ship when shipping was requested.
  const ok = formsDone && (!doShip || shipOk);
  const shipBlob = [
    ship?.error,
    ship?.steps?.github?.error,
    ...(Array.isArray(ship?.human) ? ship.human : []),
    ...human,
  ]
    .filter(Boolean)
    .join('\n');
  const repoRateLimit = !shipOk && isGithubRepoCreateRateLimitMessage(shipBlob);
  const repoMissing = !shipOk && !repoRateLimit && isGithubRepoMissingMessage(shipBlob);
  const pushRejected = !shipOk && !repoMissing && !repoRateLimit && isGithubPushRejectedMessage(shipBlob);

  const at = new Date().toISOString();
  const metaPatch = {
    formsDone,
    notifyEmail: destinationEmail || null,
    launchDomain: domain || null,
  };

  if (ship?.steps?.github?.fullName) {
    metaPatch.githubRepo = ship.steps.github.fullName;
    metaPatch.githubRepoUrl = ship.steps.github.repoUrl;
  }
  if (ship?.steps?.deploy?.ok || opts.markCloudflareProjectDone || detail.meta?.cloudflarePagesDone) {
    metaPatch.cloudflarePagesDone = true;
  }
  if (cf?.dnsDone) metaPatch.dnsDone = true;
  if (cf?.emailRoutingDone) metaPatch.emailRoutingDone = true;
  if (formsDone) metaPatch.formsDone = true;
  if (shipOk) {
    metaPatch.lastLaunchBlocker = null;
    metaPatch.lastLaunchRepoName = null;
  } else if (repoRateLimit) {
    metaPatch.lastLaunchBlocker = 'github-repo-rate-limit';
  } else if (repoMissing) {
    const fromUrl = shipBlob.match(/github\.com\/([^/\s'"]+)\/([^/\s'".]+)/i);
    const owner = resolveGithubOwner() || (fromUrl ? fromUrl[1] : '');
    const slug = detail.meta?.assembledSiteSlug || (fromUrl ? fromUrl[2] : '');
    metaPatch.lastLaunchBlocker = 'github-repo-missing';
    metaPatch.lastLaunchRepoName = owner && slug ? `${owner}/${slug}` : null;
  } else if (pushRejected) {
    metaPatch.lastLaunchBlocker = 'github-push-rejected';
  }

  // If Worker exists and domain attach succeeded, treat CF project as present
  if (cf?.steps?.worker?.exists || ship?.steps?.deploy?.ok) {
    metaPatch.cloudflarePagesDone = true;
    metaPatch.cfProject = cf?.workerName || ship?.slug || detail.meta?.assembledSiteSlug;
  }
  if (cf?.workerName) metaPatch.cfProject = cf.workerName;

  const launchTally = await commitLaunchCount(candidateId, { ok, at, patch: metaPatch });

  // Refresh build-package deploy stubs when present
  const packPath = pathsFor(candidateId).buildPackage;
  const pack = readJson(packPath);
  if (pack && typeof pack === 'object') {
    pack.deploy = {
      ...(pack.deploy || {}),
      domain: domain || pack.deploy?.domain || null,
      cfProject: metaPatch.cfProject || pack.deploy?.cfProject || null,
      repoName: pack.deploy?.repoName || detail.meta?.assembledSiteSlug || null,
    };
    writeJson(packPath, pack);
  }

  const checklist = getAssembleChecklist(candidateId);
  const site = upsertSiteAfterLaunch(candidateId);

  if (formsInboxStatus().ready) {
    try {
      await syncFormsAllowlist();
    } catch (error) {
      human.push(`Forms allowlist not updated: ${error.message}`);
    }
  }

  return {
    ok,
    candidateId,
    config: patched.config,
    assembledSitePath: patched.assembledSitePath,
    assembledConfigPath: patched.assembledConfigPath,
    formsDone,
    blockers,
    ship,
    cloudflare: cf,
    human,
    checklist,
    site,
    meta: loadMetaSafe(candidateId),
    launchTally,
  };
}

function loadMetaSafe(id) {
  return getCandidateDetail(id).meta;
}

/**
 * Status for Launch UI (no secrets).
 */
export function getLaunchStatus(candidateId) {
  const detail = getCandidateDetail(candidateId);
  const accepted = loadAcceptedSiteConfig(candidateId)?.config || {};
  const draft = getSiteConfigDraft(candidateId);
  const config = effectiveSiteConfigForLaunch(accepted, draft);
  const assembledRoot = resolveAssembledRoot(detail);
  const web3 = String(config.web3FormsAccessKey || '').trim();
  const inbox = formsInboxStatus();
  const blockers = collectLaunchBlockers(config, { formsInboxReady: inbox.ready });
  return {
    candidateId,
    cloudflareConfigured: cloudflareConfigured(),
    defaultNotifyEmail: defaultNotifyEmail() || null,
    assembled: Boolean(assembledRoot),
    assembledSitePath: detail.meta?.assembledSitePath || null,
    assembledSiteSlug: detail.meta?.assembledSiteSlug || null,
    githubRepo: detail.meta?.githubRepo || null,
    githubRepoUrl: detail.meta?.githubRepoUrl || null,
    lastShipAt: detail.meta?.lastShipAt || null,
    domain: config.domain || null,
    phone: config.phone || null,
    email: config.email || null,
    web3FormsRecipient: publicLeadsEmail(config.email, config.domain) || null,
    web3FormsAccessKeySet: Boolean(web3) && !isLaunchWeb3Placeholder(web3),
    formsInboxReady: inbox.ready,
    templateStale: Boolean(assembledRoot && templateComponentsNewerThanAssembled(assembledRoot)),
    turnstileSiteKeySet: Boolean(String(config.turnstileSiteKey || '').trim()),
    formsDone: Boolean(detail.meta?.formsDone),
    dnsDone: Boolean(detail.meta?.dnsDone),
    emailRoutingDone: Boolean(detail.meta?.emailRoutingDone),
    cloudflarePagesDone: Boolean(detail.meta?.cloudflarePagesDone),
    lastLaunchAt: detail.meta?.lastLaunchAt || null,
    launchBlockers: blockers,
    checklist: getAssembleChecklist(candidateId),
  };
}
