/**
 * Read-only Twilio provision index from research/sites.json.
 * Does not import candidates.mjs (sites.mjs already does — avoid a cycle).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SITES_FILE = path.join(process.cwd(), 'research', 'sites.json');

/**
 * @returns {Map<string, string|null>} candidateId → provisionedAt (ISO or null)
 */
export function loadTwilioProvisionIndex() {
  const map = new Map();
  if (!existsSync(SITES_FILE)) return map;
  try {
    const raw = JSON.parse(readFileSync(SITES_FILE, 'utf8'));
    const sites = Array.isArray(raw?.sites) ? raw.sites : [];
    for (const site of sites) {
      const id = String(site?.candidateId || '').trim();
      const pt = site?.phoneTracking;
      if (!id || pt?.provider !== 'twilio' || !pt.twilioSid) continue;
      map.set(id, pt.provisionedAt || site.updatedAt || site.createdAt || null);
    }
  } catch {
    /* ignore unreadable registry */
  }
  return map;
}
