/**
 * One-pass refresh for an already launched site: before/after logo, Rover form, notify address.
 * Assemble and Launch stay with the caller so a batch can pool them.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureBaLogo, setBaLogo } from './ba-logo.mjs';
import { pathsFor, saveMeta } from './candidates.mjs';

export function assertRelaunchNotifyEmail(value) {
  const expected = String(
    process.env.LEAD_NOTIFY_EMAIL || process.env.WEB3FORMS_DEFAULT_NOTIFY_EMAIL || '',
  )
    .trim()
    .toLowerCase();
  const email = String(value || '').trim().toLowerCase();
  if (!expected || !email) {
    throw Object.assign(
      new Error('Set the lead notify email in Account setup before relaunch.'),
      { status: 400, code: 'missing_key', field: 'leadNotifyEmail' },
    );
  }
  if (email !== expected) {
    throw Object.assign(
      new Error('Relaunch email must match the lead notify email in Account setup.'),
      { status: 400, code: 'missing_key', field: 'leadNotifyEmail' },
    );
  }
  return email;
}

export function relaunchSiteLabel(site) {
  const name = String(site?.businessName || site?.niche || site?.candidateId || 'Site').trim();
  const city = String(site?.city || '').trim();
  if (city && !name.toLowerCase().includes(city.toLowerCase())) return `${name} · ${city}`;
  return name;
}

export function relaunchProgressLine(done, total, label, { ok = false, error = '', logo = '' } = {}) {
  const head = `${done} of ${total} — ${label}`;
  if (!ok) {
    const detail = String(error || 'launch failed').replace(/\s+/g, ' ').trim().slice(0, 240);
    return `${head} failed: ${detail}`;
  }
  if (logo === 'no-logo' || logo === 'logo-unreadable') return `${head} shipped, no logo`;
  return `${head} shipped`;
}

export function configWithoutWeb3Key(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  const next = { ...config };
  delete next.web3FormsAccessKey;
  return next;
}

export function stripWeb3KeyInFile(filePath) {
  if (!filePath || !existsSync(filePath)) return { stripped: false, reason: 'missing' };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return { stripped: false, reason: 'invalid' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { stripped: false, reason: 'invalid' };
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, 'web3FormsAccessKey')) {
    return { stripped: false, reason: 'absent' };
  }
  writeFileSync(filePath, `${JSON.stringify(configWithoutWeb3Key(parsed), null, 2)}\n`, 'utf8');
  return { stripped: true };
}

/** Drop the Web3Forms key from the accepted config, its draft, and staging. */
export function clearAcceptedWeb3Key(candidateId) {
  const paths = pathsFor(candidateId);
  const files = [
    paths.siteConfig,
    paths.siteConfigDraft,
    path.join(paths.siteStaging, 'src', 'config', 'site-config.json'),
  ];
  return files.map((filePath) => ({ filePath, ...stripWeb3KeyInFile(filePath) }));
}

export function setLaunchedNotifyEmail(candidateId, email) {
  const notifyEmail = assertRelaunchNotifyEmail(email);
  saveMeta(candidateId, { notifyEmail });
  return notifyEmail;
}

/**
 * Stamp before/after photos on a launched site.
 * A missing or unreadable logo does not throw; the caller still assembles and launches.
 */
export async function stampLaunchedBaLogo(candidateId) {
  let logo = await ensureBaLogo(candidateId, { allowLaunched: true });
  if (logo?.skipped === 'off') {
    try {
      logo = await setBaLogo(candidateId, true, { allowLaunched: true });
    } catch {
      return { ok: true, skipped: 'no-logo', changed: 0 };
    }
  }
  return logo;
}
