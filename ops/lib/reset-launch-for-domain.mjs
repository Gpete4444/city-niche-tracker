/**
 * Tear down a wrong-domain launch so Website → Run launch can go-live again.
 * Keeps content, photos, logo, map. Clears GitHub/CF/Rover launch bookkeeping.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  clearLaunchedBookkeeping,
  getCandidateDetail,
  getCandidateShell,
  pathsFor,
} from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { deleteGithubRepo } from './github-site.mjs';
import { hostnameForWorker, teardownWorkerForRelaunch } from './cloudflare-launch.mjs';
import { patchLaunchSiteConfig } from './launch-site.mjs';
import { publicLeadsEmail } from './site-config.mjs';
import { deleteSitesByCandidateIds } from './sites.mjs';
import { loadEnvFile } from '../../scripts/lib/dataforseo.mjs';

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function normalizeLaunchHost(value) {
  return hostnameForWorker(value, { allowWww: false });
}

export function currentLaunchHosts(detail, config = {}) {
  const meta = detail?.meta || {};
  const hosts = [
    config.domain,
    meta.launchDomain,
  ]
    .map((h) => normalizeLaunchHost(h))
    .filter(Boolean);
  return [...new Set(hosts)];
}

function leadsAtHost(email, host) {
  const e = String(email || '').trim().toLowerCase();
  const h = normalizeLaunchHost(host);
  return Boolean(h && e === `leads@${h}`);
}

function patchDraftNap(candidateId, { domain, email }) {
  const file = pathsFor(candidateId).siteConfigDraft;
  if (!existsSync(file)) return false;
  const draft = readJson(file);
  if (!draft || typeof draft !== 'object') return false;
  if (domain) draft.domain = domain;
  if (email) draft.email = email;
  writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  return true;
}

/**
 * @param {string} candidateId
 * @param {{
 *   confirmResetLaunch?: boolean,
 *   confirmDomain?: string,
 *   domain?: string,
 *   deleteGithubRepoFn?: Function,
 *   teardownCloudflareFn?: Function,
 * }} [opts]
 */
export async function resetLaunchForNewDomain(candidateId, opts = {}) {
  loadEnvFile();
  if (!opts.confirmResetLaunch) {
    const err = new Error('Type the current live domain to confirm relaunch.');
    err.status = 400;
    err.code = 'RESET_LAUNCH_CONFIRM_REQUIRED';
    throw err;
  }

  const detail = getCandidateDetail(candidateId);
  const loaded = loadAcceptedSiteConfig(candidateId);
  const config = loaded?.config || {};
  const oldHosts = currentLaunchHosts(detail, config);
  const typed = normalizeLaunchHost(opts.confirmDomain);
  if (!typed || !oldHosts.includes(typed)) {
    const err = new Error(
      `Confirm domain must match the current live host (${oldHosts.join(' or ') || 'unknown'}).`,
    );
    err.status = 400;
    err.code = 'RESET_LAUNCH_CONFIRM_MISMATCH';
    throw err;
  }

  const oldGithub = String(detail.meta?.githubRepo || '').trim() || null;
  const oldWorker =
    String(detail.meta?.cfProject || '').trim() ||
    String(detail.meta?.assembledSiteSlug || '').trim() ||
    null;
  const oldDomain = oldHosts[0] || typed;
  const newDomain = normalizeLaunchHost(opts.domain);

  const leftovers = [];
  const human = [];

  const deleteGh = typeof opts.deleteGithubRepoFn === 'function' ? opts.deleteGithubRepoFn : deleteGithubRepo;
  const teardownCf =
    typeof opts.teardownCloudflareFn === 'function'
      ? opts.teardownCloudflareFn
      : teardownWorkerForRelaunch;

  const github = await deleteGh(oldGithub);
  if (github?.ok === false) leftovers.push(`GitHub: ${github.error || 'delete failed'}`);
  else if (github?.deleted) human.push(`Deleted GitHub repo ${github.fullName}.`);
  else if (github?.skipped) human.push(`GitHub repo skipped (${github.reason || 'none'}).`);
  else if (github?.human) human.push(...github.human);

  const cloudflare = await teardownCf({
    workerName: oldWorker,
    hostnames: oldHosts,
  });
  if (cloudflare?.human) human.push(...cloudflare.human);
  if (cloudflare?.ok === false) leftovers.push(`Cloudflare: ${cloudflare.error || 'teardown failed'}`);

  let nap = null;
  if (newDomain && newDomain !== oldDomain) {
    const prevEmail = String(config.email || '').trim();
    const nextEmail = leadsAtHost(prevEmail, oldDomain)
      ? `leads@${newDomain}`
      : publicLeadsEmail(prevEmail, newDomain);
    nap = patchLaunchSiteConfig(candidateId, { domain: newDomain, email: nextEmail });
    patchDraftNap(candidateId, { domain: newDomain, email: nextEmail });
    human.push(`Site-config domain is now ${newDomain}.`);
  }

  const meta = clearLaunchedBookkeeping(candidateId);
  const sites = deleteSitesByCandidateIds([candidateId]);
  if (sites.removed?.length) {
    human.push(`Removed ${sites.removed.length} Launched Sites row(s).`);
  }

  return {
    ok: true,
    candidateId,
    oldDomain,
    newDomain: newDomain || oldDomain,
    github,
    cloudflare,
    leftovers,
    human,
    sitesRemoved: sites.removed || [],
    nap,
    meta,
    candidate: getCandidateShell(candidateId),
  };
}
