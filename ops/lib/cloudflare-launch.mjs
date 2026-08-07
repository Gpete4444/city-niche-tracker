/**
 * Cloudflare API helpers for Rank & Rent launch:
 * zone lookup, Email Routing (leads@ → Gmail), Worker custom domain, optional Turnstile.
 *
 * Requires CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN in .env.
 * API calls are free; product usage follows CF free/paid plans.
 */

const CF_API = 'https://api.cloudflare.com/client/v4';

export function getCloudflareCredentials() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
  if (!accountId || !apiToken) {
    const err = new Error(
      'Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN. Copy from .env.example into .env.',
    );
    err.status = 400;
    throw err;
  }
  return { accountId, apiToken };
}

export function cloudflareConfigured() {
  try {
    getCloudflareCredentials();
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} method
 * @param {string} pathSuffix - e.g. /zones?name=example.com
 * @param {object} [body]
 */
export async function cfFetch(method, pathSuffix, body) {
  const { apiToken } = getCloudflareCredentials();
  const url = pathSuffix.startsWith('http') ? pathSuffix : `${CF_API}${pathSuffix}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    const err = new Error(`Cloudflare API ${method} ${pathSuffix}: non-JSON (${res.status})`);
    err.status = 502;
    throw err;
  }
  if (!res.ok || data.success === false) {
    const msgs = (data.errors || [])
      .map((e) => e.message || JSON.stringify(e))
      .filter(Boolean);
    const err = new Error(
      msgs.length
        ? `Cloudflare API: ${msgs.join('; ')}`
        : `Cloudflare API ${method} ${pathSuffix} failed (${res.status})`,
    );
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.cfErrors = data.errors || [];
    err.cfResult = data.result;
    throw err;
  }
  return data.result;
}

/** Normalize apex domain (strip www / path). */
export function normalizeDomain(domain) {
  let d = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (d.startsWith('www.')) d = d.slice(4);
  return d;
}

/**
 * Find zone for domain (exact or parent). Returns null if not in account.
 * @param {string} domain
 */
export async function findZone(domain) {
  const apex = normalizeDomain(domain);
  if (!apex) return null;

  const exact = await cfFetch('GET', `/zones?name=${encodeURIComponent(apex)}&per_page=5`);
  if (Array.isArray(exact) && exact.length) return exact[0];

  const parts = apex.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    const list = await cfFetch('GET', `/zones?name=${encodeURIComponent(parent)}&per_page=5`);
    if (Array.isArray(list) && list.length) return list[0];
  }
  return null;
}

/**
 * Enable Email Routing for zone if needed.
 * @param {string} zoneId
 */
export async function ensureEmailRoutingEnabled(zoneId) {
  let settings;
  try {
    settings = await cfFetch('GET', `/zones/${zoneId}/email/routing`);
  } catch {
    settings = null;
  }
  if (settings?.enabled) return { enabled: true, created: false, settings };

  try {
    const result = await cfFetch('POST', `/zones/${zoneId}/email/routing/enable`);
    return { enabled: true, created: true, settings: result };
  } catch (error) {
    // Some accounts use PUT /dns_settings or already-enabled variants
    try {
      const result = await cfFetch('POST', `/zones/${zoneId}/email/routing/dns`);
      return { enabled: true, created: true, settings: result, via: 'dns' };
    } catch {
      throw error;
    }
  }
}

/**
 * Ensure destination address exists (may need Gmail verification click).
 * @param {string} zoneId
 * @param {string} destinationEmail
 */
export async function ensureEmailDestination(zoneId, destinationEmail) {
  const email = String(destinationEmail || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    const err = new Error('destinationEmail must be a valid address (e.g. your Gmail)');
    err.status = 400;
    throw err;
  }

  const list = await cfFetch('GET', `/zones/${zoneId}/email/routing/addresses`);
  const existing = (Array.isArray(list) ? list : []).find(
    (a) => String(a.email || '').toLowerCase() === email,
  );
  if (existing) {
    return {
      email,
      id: existing.id,
      verified: Boolean(existing.verified),
      created: false,
      destination: existing,
    };
  }

  const created = await cfFetch('POST', `/zones/${zoneId}/email/routing/addresses`, {
    email,
  });
  return {
    email,
    id: created?.id,
    verified: Boolean(created?.verified),
    created: true,
    destination: created,
  };
}

/**
 * Create or reuse literal forward rule for leads@domain → destination.
 * @param {string} zoneId
 * @param {string} leadsAddress
 * @param {string} destinationEmail
 */
export async function ensureLeadsForwardRule(zoneId, leadsAddress, destinationEmail) {
  const to = String(leadsAddress || '').trim().toLowerCase();
  const dest = String(destinationEmail || '').trim().toLowerCase();
  const rules = await cfFetch('GET', `/zones/${zoneId}/email/routing/rules`);
  const list = Array.isArray(rules) ? rules : [];

  const match = list.find((r) =>
    (r.matchers || []).some(
      (m) => m.type === 'literal' && m.field === 'to' && String(m.value || '').toLowerCase() === to,
    ),
  );

  if (match) {
    const alreadyForwards = (match.actions || []).some(
      (a) =>
        a.type === 'forward' &&
        (a.value || []).some((v) => String(v).toLowerCase() === dest),
    );
    if (alreadyForwards && match.enabled !== false) {
      return { rule: match, created: false, updated: false };
    }
    const updated = await cfFetch('PUT', `/zones/${zoneId}/email/routing/rules/${match.id}`, {
      name: match.name || `Forward ${to}`,
      enabled: true,
      matchers: [{ type: 'literal', field: 'to', value: to }],
      actions: [{ type: 'forward', value: [dest] }],
    });
    return { rule: updated, created: false, updated: true };
  }

  const created = await cfFetch('POST', `/zones/${zoneId}/email/routing/rules`, {
    name: `Forward ${to}`,
    enabled: true,
    matchers: [{ type: 'literal', field: 'to', value: to }],
    actions: [{ type: 'forward', value: [dest] }],
  });
  return { rule: created, created: true, updated: false };
}

/**
 * List Worker scripts; return true if script name exists.
 * @param {string} scriptName
 */
export async function workerExists(scriptName) {
  const { accountId } = getCloudflareCredentials();
  const name = String(scriptName || '').trim();
  if (!name) return false;
  try {
    await cfFetch('GET', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Attach custom domain (hostname) to a Worker. Zone must be on Cloudflare.
 * @param {{ hostname: string, service: string, environment?: string, zoneId?: string }} opts
 */
export async function attachWorkerCustomDomain(opts) {
  const { accountId } = getCloudflareCredentials();
  const hostname = normalizeDomain(opts.hostname);
  const service = String(opts.service || '').trim();
  const environment = opts.environment || 'production';
  if (!hostname || !service) {
    const err = new Error('hostname and Worker service name are required');
    err.status = 400;
    throw err;
  }

  const body = {
    hostname,
    service,
    environment,
  };
  if (opts.zoneId) body.zone_id = opts.zoneId;

  // Prefer PUT upsert; fall back to POST create
  try {
    const result = await cfFetch('PUT', `/accounts/${accountId}/workers/domains`, body);
    return { domain: result, created: true, method: 'PUT' };
  } catch (putErr) {
    try {
      const result = await cfFetch('POST', `/accounts/${accountId}/workers/domains`, body);
      return { domain: result, created: true, method: 'POST' };
    } catch {
      throw putErr;
    }
  }
}

/**
 * Create a Turnstile widget for the domain (optional).
 * @param {string} domain
 * @param {string} [name]
 */
export async function createTurnstileWidget(domain, name) {
  const { accountId } = getCloudflareCredentials();
  const apex = normalizeDomain(domain);
  const result = await cfFetch('POST', `/accounts/${accountId}/challenges/widgets`, {
    sites: [apex, `www.${apex}`],
    mode: 'managed',
    name: name || `rr-${apex}`,
  });
  return {
    sitekey: result?.sitekey || result?.id || null,
    secret: result?.secret || null,
    widget: result,
  };
}

/**
 * Full CF launch helper for one site.
 * @param {{
 *   domain: string,
 *   leadsEmail: string,
 *   destinationEmail: string,
 *   workerName: string,
 *   createTurnstile?: boolean,
 *   attachDomain?: boolean,
 *   setupEmail?: boolean,
 * }} opts
 */
export async function runCloudflareLaunch(opts) {
  const domain = normalizeDomain(opts.domain);
  const leadsEmail = String(opts.leadsEmail || `leads@${domain}`).trim().toLowerCase();
  const destinationEmail = String(opts.destinationEmail || '').trim().toLowerCase();
  const workerName = String(opts.workerName || '').trim();
  const attachDomain = opts.attachDomain !== false;
  const setupEmail = opts.setupEmail !== false;
  const wantTurnstile = Boolean(opts.createTurnstile);

  const human = [];
  const steps = {};

  if (!domain || domain === 'example.com') {
    const err = new Error('Set a real domain in site-config before Cloudflare launch');
    err.status = 400;
    throw err;
  }

  const zone = await findZone(domain);
  if (!zone) {
    human.push(
      `Add ${domain} to Cloudflare (or point nameservers to CF) so a zone exists in this account, then re-run Launch.`,
    );
    return {
      ok: false,
      domain,
      zone: null,
      human,
      steps,
      error: `No Cloudflare zone found for ${domain}`,
    };
  }

  steps.zone = {
    id: zone.id,
    name: zone.name,
    status: zone.status,
    nameServers: zone.name_servers || [],
  };

  if (zone.status && zone.status !== 'active') {
    human.push(
      `Zone status is "${zone.status}". Finish nameserver cutover at the registrar, then re-run if needed.`,
    );
  }

  if (setupEmail) {
    if (!destinationEmail) {
      human.push(
        'Set Email Routing destination (Gmail) in Launch or WEB3FORMS_DEFAULT_NOTIFY_EMAIL in .env to create the leads@ rule.',
      );
      steps.emailRouting = { skipped: true, reason: 'missing_destination' };
    } else {
      steps.emailRouting = await ensureEmailRoutingEnabled(zone.id);
      steps.destination = await ensureEmailDestination(zone.id, destinationEmail);
      if (!steps.destination.verified) {
        human.push(
          `Check ${destinationEmail} for a Cloudflare Email Routing verification link (required once).`,
        );
      }
      try {
        steps.leadsRule = await ensureLeadsForwardRule(zone.id, leadsEmail, destinationEmail);
      } catch (error) {
        steps.leadsRule = { error: error.message };
        human.push(
          `Could not create Email Routing rule for ${leadsEmail}: ${error.message}. Verify the destination address first, then re-run.`,
        );
      }
    }
  }

  if (attachDomain) {
    if (!workerName) {
      human.push('No Worker name (assemble slug) — skip custom domain attach until the Worker exists.');
      steps.workerDomain = { skipped: true, reason: 'missing workerName' };
    } else {
      const exists = await workerExists(workerName);
      steps.worker = { name: workerName, exists };
      if (!exists) {
        human.push(
          `Worker "${workerName}" not found. Push the assembled site to GitHub, create the Workers Builds project, deploy once, then re-run Launch to attach ${domain}.`,
        );
        steps.workerDomain = { skipped: true, reason: 'worker_missing' };
      } else {
        try {
          steps.workerDomain = await attachWorkerCustomDomain({
            hostname: domain,
            service: workerName,
            zoneId: zone.id,
          });
        } catch (error) {
          steps.workerDomain = { error: error.message };
          human.push(`Custom domain attach failed: ${error.message}`);
        }
      }
    }
  }

  if (wantTurnstile) {
    try {
      steps.turnstile = await createTurnstileWidget(domain, `rr-${workerName || domain}`);
    } catch (error) {
      steps.turnstile = { error: error.message };
      human.push(`Turnstile create failed: ${error.message}`);
    }
  }

  const emailOk =
    !setupEmail ||
    (Boolean(steps.leadsRule?.rule || steps.leadsRule?.created === false) &&
      !steps.leadsRule?.error);
  const domainOk =
    !attachDomain ||
    Boolean(steps.workerDomain?.domain) ||
    steps.workerDomain?.skipped;

  return {
    ok: Boolean(zone) && (!setupEmail || emailOk || steps.destination),
    domain,
    leadsEmail,
    destinationEmail,
    workerName,
    zone: steps.zone,
    steps,
    human,
    turnstileSiteKey: steps.turnstile?.sitekey || null,
    dnsDone: Boolean(steps.workerDomain?.domain),
    emailRoutingDone: Boolean(steps.leadsRule?.rule && !steps.leadsRule?.error),
  };
}
