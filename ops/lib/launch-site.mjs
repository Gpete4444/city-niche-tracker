/**
 * Orchestrate Rover launch: patch assembled site-config (Web3Forms / NAP / Turnstile),
 * run Cloudflare helpers, set checklist meta flags.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCandidateDetail, pathsFor, saveMeta } from './candidates.mjs';
import { getAssembleChecklist } from './assemble-site.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import {
  cloudflareConfigured,
  normalizeDomain,
  runCloudflareLaunch,
} from './cloudflare-launch.mjs';
import { shipAssembledSite } from './ship-site.mjs';
import { upsertSiteAfterLaunch } from './sites.mjs';

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
  return String(process.env.WEB3FORMS_DEFAULT_NOTIFY_EMAIL || '').trim();
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
  if (patch.web3FormsAccessKey !== undefined) {
    const key = String(patch.web3FormsAccessKey || '').trim();
    if (key) next.web3FormsAccessKey = key;
  }
  if (patch.turnstileSiteKey !== undefined) {
    next.turnstileSiteKey = String(patch.turnstileSiteKey || '').trim();
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
 * }} [opts]
 */
export async function launchSite(candidateId, opts = {}) {
  const detail = getCandidateDetail(candidateId);
  const assembledRoot = resolveAssembledRoot(detail);
  if (!assembledRoot) {
    const err = new Error('Assemble the site first (no assembledSitePath)');
    err.status = 400;
    err.checklist = getAssembleChecklist(candidateId);
    throw err;
  }

  const loaded = loadAcceptedSiteConfig(candidateId);
  const base = loaded?.config || {};
  const domain = normalizeDomain(opts.domain || base.domain);
  const email =
    String(opts.email || base.email || (domain ? `leads@${domain}` : '')).trim() ||
    '';
  const destinationEmail =
    String(opts.destinationEmail || defaultNotifyEmail() || '').trim() || '';

  const patched = patchLaunchSiteConfig(candidateId, {
    domain,
    phone: opts.phone,
    email,
    businessName: opts.businessName,
    web3FormsAccessKey: opts.web3FormsAccessKey,
    turnstileSiteKey: opts.turnstileSiteKey,
  });

  const web3Key = String(patched.config.web3FormsAccessKey || '').trim();
  const formsDone = Boolean(web3Key) && !WEB3_PLACEHOLDER_RE.test(web3Key);

  const human = [];
  if (!formsDone) {
    human.push(
      'Create a form at https://web3forms.com and paste the access key into Launch, then re-run (or Save keys only).',
    );
  } else {
    human.push('Web3Forms key written to assembled site-config.');
  }

  let ship = null;
  const doShip = opts.ship !== false;
  if (doShip) {
    try {
      ship = await shipAssembledSite(candidateId, {
        skipGithub: opts.skipGithub === true,
        skipBuild: opts.skipBuild === true,
        skipDeploy: opts.skipDeploy === true || !cloudflareConfigured(),
        skipBuildsConnect: opts.skipBuildsConnect === true,
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
      const workerName =
        detail.meta?.assembledSiteSlug ||
        path.basename(assembledRoot) ||
        null;
      cf = await runCloudflareLaunch({
        domain,
        leadsEmail: email.includes('@') ? email : `leads@${domain}`,
        destinationEmail,
        workerName,
        createTurnstile: Boolean(opts.createTurnstile),
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
    }
  } else {
    human.push('Skipped Cloudflare API (runCloudflare=false).');
  }

  const metaPatch = {
    lastLaunchAt: new Date().toISOString(),
    formsDone,
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

  // If Worker exists and domain attach succeeded, treat CF project as present
  if (cf?.steps?.worker?.exists || ship?.steps?.deploy?.ok) {
    metaPatch.cloudflarePagesDone = true;
    metaPatch.cfProject = cf?.workerName || ship?.slug || detail.meta?.assembledSiteSlug;
  }
  if (cf?.workerName) metaPatch.cfProject = cf.workerName;

  saveMeta(candidateId, metaPatch);

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

  return {
    ok: formsDone || Boolean(cf?.ok) || Boolean(ship?.ok),
    candidateId,
    config: patched.config,
    assembledSitePath: patched.assembledSitePath,
    assembledConfigPath: patched.assembledConfigPath,
    formsDone,
    ship,
    cloudflare: cf,
    human,
    checklist,
    site,
    meta: loadMetaSafe(candidateId),
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
  const config = loadAcceptedSiteConfig(candidateId)?.config || {};
  const assembledRoot = resolveAssembledRoot(detail);
  const web3 = String(config.web3FormsAccessKey || '').trim();
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
    web3FormsAccessKeySet: Boolean(web3) && !WEB3_PLACEHOLDER_RE.test(web3),
    turnstileSiteKeySet: Boolean(String(config.turnstileSiteKey || '').trim()),
    formsDone: Boolean(detail.meta?.formsDone),
    dnsDone: Boolean(detail.meta?.dnsDone),
    emailRoutingDone: Boolean(detail.meta?.emailRoutingDone),
    cloudflarePagesDone: Boolean(detail.meta?.cloudflarePagesDone),
    lastLaunchAt: detail.meta?.lastLaunchAt || null,
    checklist: getAssembleChecklist(candidateId),
  };
}
