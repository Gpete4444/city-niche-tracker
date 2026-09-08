/**
 * Cloudflare API helpers for Rover launch:
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
    // Assets-only Workers often return 204 No Content on GET /workers/scripts/{name}
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) {
      if (res.ok) return null;
      data = { success: false, errors: [{ message: `empty body (${res.status})` }] };
    } else {
      data = JSON.parse(text);
    }
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
  return hostnameForWorker(domain, { allowWww: false });
}

/**
 * Hostname for Worker custom-domain attach. Apex by default; keep www when requested.
 * @param {string} domain
 * @param {{ allowWww?: boolean }} [opts]
 */
export function hostnameForWorker(domain, opts = {}) {
  let d = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!opts.allowWww && d.startsWith('www.')) d = d.slice(4);
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
 * Zone settings GET/enable may 403 with Account-scoped Address tokens — soft-fail.
 * @param {string} zoneId
 */
export async function ensureEmailRoutingEnabled(zoneId) {
  let settings;
  try {
    settings = await cfFetch('GET', `/zones/${zoneId}/email/routing`);
  } catch (error) {
    return {
      enabled: null,
      created: false,
      skipped: true,
      reason: error.message || 'zone_email_routing_unavailable',
    };
  }
  if (settings?.enabled) return { enabled: true, created: false, settings };

  try {
    const result = await cfFetch('POST', `/zones/${zoneId}/email/routing/enable`);
    return { enabled: true, created: true, settings: result };
  } catch (error) {
    try {
      const result = await cfFetch('POST', `/zones/${zoneId}/email/routing/dns`);
      return { enabled: true, created: true, settings: result, via: 'dns' };
    } catch {
      return {
        enabled: null,
        created: false,
        skipped: true,
        reason: error.message || 'enable_failed',
      };
    }
  }
}

/**
 * Ensure destination address exists (may need Gmail verification click).
 * Uses account-level Addresses API (Account → Email Routing Addresses permission).
 * @param {string} _zoneId unused — addresses are account-scoped
 * @param {string} destinationEmail
 */
export async function ensureEmailDestination(_zoneId, destinationEmail) {
  const { accountId } = getCloudflareCredentials();
  const email = String(destinationEmail || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    const err = new Error('destinationEmail must be a valid address (e.g. your Gmail)');
    err.status = 400;
    throw err;
  }

  const list = await cfFetch('GET', `/accounts/${accountId}/email/routing/addresses`);
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
      via: 'account',
    };
  }

  const created = await cfFetch('POST', `/accounts/${accountId}/email/routing/addresses`, {
    email,
  });
  return {
    email,
    id: created?.id,
    verified: Boolean(created?.verified),
    created: true,
    destination: created,
    via: 'account',
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
 * Return true if a Worker script exists.
 * Note: GET /workers/scripts/{name} returns 204 (empty) for assets-only Workers,
 * which our JSON client treats as failure — use /settings or /services instead.
 * @param {string} scriptName
 */
export async function workerExists(scriptName) {
  const { accountId } = getCloudflareCredentials();
  const name = String(scriptName || '').trim();
  if (!name) return false;
  const encoded = encodeURIComponent(name);
  try {
    await cfFetch('GET', `/accounts/${accountId}/workers/scripts/${encoded}/settings`);
    return true;
  } catch {
    try {
      await cfFetch('GET', `/accounts/${accountId}/workers/services/${encoded}`);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Attach custom domain (hostname) to a Worker. Zone must be on Cloudflare.
 * @param {{ hostname: string, service: string, environment?: string, zoneId?: string }} opts
 */
export async function attachWorkerCustomDomain(opts) {
  const { accountId } = getCloudflareCredentials();
  const hostname = hostnameForWorker(opts.hostname, { allowWww: Boolean(opts.allowWww) });
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
 * Force HTTPS at the zone (Always Use HTTPS + Full SSL + HSTS).
 * Soft-fails individual settings so a 403 cannot block Launch.
 * @param {string} zoneId
 */
export async function ensureZoneHttpsSettings(zoneId) {
  const id = String(zoneId || '').trim();
  if (!id) {
    const err = new Error('zoneId required');
    err.status = 400;
    throw err;
  }
  const steps = {};

  try {
    steps.alwaysUseHttps = await cfFetch('PATCH', `/zones/${id}/settings/always_use_https`, {
      value: 'on',
    });
  } catch (error) {
    steps.alwaysUseHttps = { error: error.message };
  }

  try {
    steps.ssl = await cfFetch('PATCH', `/zones/${id}/settings/ssl`, { value: 'full' });
  } catch (error) {
    steps.ssl = { error: error.message };
  }

  try {
    steps.hsts = await cfFetch('PATCH', `/zones/${id}/settings/security_header`, {
      value: {
        strict_transport_security: {
          enabled: true,
          max_age: 15552000,
          include_subdomains: true,
          preload: false,
          nosniff: true,
        },
      },
    });
  } catch (error) {
    steps.hsts = { error: error.message };
  }

  return steps;
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

  try {
    steps.https = await ensureZoneHttpsSettings(zone.id);
    const httpsErrs = ['alwaysUseHttps', 'ssl', 'hsts']
      .map((k) => steps.https?.[k]?.error)
      .filter(Boolean);
    if (httpsErrs.length) {
      human.push(`HTTPS zone settings partial: ${httpsErrs.join('; ')}`);
    } else {
      human.push('Zone Always Use HTTPS + Full SSL + HSTS enabled.');
    }
  } catch (error) {
    steps.https = { error: error.message };
    human.push(`HTTPS zone settings skipped: ${error.message}`);
  }

  if (setupEmail) {
    if (!destinationEmail) {
      human.push(
        'Set Email Routing destination (Gmail) in Launch or WEB3FORMS_DEFAULT_NOTIFY_EMAIL in .env to create the leads@ rule.',
      );
      steps.emailRouting = { skipped: true, reason: 'missing_destination' };
    } else {
      try {
        steps.emailRouting = await ensureEmailRoutingEnabled(zone.id);
        if (steps.emailRouting?.skipped) {
          human.push(
            `Zone Email Routing settings API unavailable (${steps.emailRouting.reason}). If Email Routing is not on yet, enable it in the Cloudflare dashboard for ${domain}.`,
          );
        }
      } catch (error) {
        steps.emailRouting = { skipped: true, error: error.message };
        human.push(`Email Routing enable skipped: ${error.message}`);
      }

      try {
        steps.destination = await ensureEmailDestination(zone.id, destinationEmail);
        if (!steps.destination.verified) {
          human.push(
            `Check ${destinationEmail} for a Cloudflare Email Routing verification link (required once).`,
          );
        }
      } catch (error) {
        steps.destination = { error: error.message };
        human.push(
          `Could not ensure Email Routing destination ${destinationEmail}: ${error.message}`,
        );
      }

      if (steps.destination && !steps.destination.error) {
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
          `Worker "${workerName}" not found yet. Re-run Launch with Auto ship (or wait a few seconds after Wrangler deploy) to attach ${domain}.`,
        );
        steps.workerDomain = { skipped: true, reason: 'worker_missing' };
      } else {
        try {
          steps.workerDomain = await attachWorkerCustomDomain({
            hostname: domain,
            service: workerName,
            zoneId: zone.id,
          });
          human.push(
            steps.workerDomain?.created
              ? `Attached custom domain ${domain} → Worker "${workerName}".`
              : `Custom domain ${domain} already attached to Worker "${workerName}".`,
          );
        } catch (error) {
          steps.workerDomain = { error: error.message };
          human.push(`Custom domain attach failed: ${error.message}`);
        }
        try {
          steps.workerDomainWww = await attachWorkerCustomDomain({
            hostname: `www.${domain}`,
            service: workerName,
            zoneId: zone.id,
            allowWww: true,
          });
          human.push(
            steps.workerDomainWww?.created
              ? `Attached custom domain www.${domain} → Worker "${workerName}".`
              : `Custom domain www.${domain} already attached to Worker "${workerName}".`,
          );
        } catch (error) {
          steps.workerDomainWww = { error: error.message };
          human.push(`www custom domain attach failed: ${error.message}`);
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
