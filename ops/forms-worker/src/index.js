/**
 * Shared inbox for Rover lead forms.
 * Public POST /submit stores the lead in D1 and emails the account's
 * Email Routing destination from leads@domain. Rover reads D1 with the
 * Cloudflare API — this worker does not list submissions.
 */

/** Same window as FORM_DEDUPE_WINDOW_MS in ops/lib/form-submissions.mjs. */
const DEDUPE_WINDOW_MS = 2 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 8;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function clip(value, max) {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeDomain(value) {
  let domain = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
  if (domain.startsWith('www.')) domain = domain.slice(4);
  return domain;
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function clientIp(request) {
  const cf = String(request.headers.get('CF-Connecting-IP') || '').trim();
  if (cf) return cf.slice(0, 80);
  const forwarded = String(request.headers.get('x-forwarded-for') || '')
    .split(',')[0]
    .trim();
  return (forwarded || 'unknown').slice(0, 80);
}

function leadEmailText(fields) {
  return [
    `New lead for ${fields.businessName || fields.domain}`,
    '',
    `Name: ${fields.name || '—'}`,
    `Phone: ${fields.phone || '—'}`,
    `Email: ${fields.email || '—'}`,
    `Service: ${fields.service || '—'}`,
    `Page: ${fields.pageUrl || '—'}`,
    '',
    fields.message || '',
  ].join('\n');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/submit') {
      return handleSubmit(request, env, ctx);
    }
    return json({ ok: false, error: 'not_found' }, 404);
  },
};

async function handleSubmit(request, env, ctx) {
  let payload;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }
  if (String(payload.botcheck || '').trim()) {
    return json({ ok: true, dropped: true });
  }

  const domain = normalizeDomain(payload.domain);
  if (!domain || !domain.includes('.')) {
    return json({ ok: false, error: 'domain_required' }, 400);
  }

  const name = clip(payload.name, 200);
  const phone = clip(payload.phone, 40);
  const email = clip(payload.email, 200);
  const service = clip(payload.service, 200);
  const message = clip(payload.message, 8000);
  const pageUrl = clip(payload.page_url || payload.pageUrl, 500);
  if (!name && !phone && !email && !message) {
    return json({ ok: false, error: 'empty' }, 400);
  }

  const site = await env.DB.prepare(
    'SELECT domain, business_name, notify_email FROM sites WHERE domain = ?',
  )
    .bind(domain)
    .first();
  if (!site) {
    return json({ ok: false, error: 'unknown_domain' }, 403);
  }

  const ip = clientIp(request);
  if (await rateLimited(env, ip)) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const existing = await env.DB.prepare(
    `SELECT id FROM submissions
     WHERE domain = ?
       AND ifnull(page_url, '') = ?
       AND ifnull(name, '') = ?
       AND ifnull(phone, '') = ?
       AND ifnull(email, '') = ?
       AND ifnull(service, '') = ?
       AND ifnull(message, '') = ?
       AND submitted_at >= ?
     ORDER BY submitted_at ASC
     LIMIT 1`,
  )
    .bind(domain, pageUrl, name, phone, email, service, message, since)
    .first();
  if (existing?.id) {
    const spam = await leadIsSpam(env, { name, phone, email, service, message });
    return json({ ok: true, id: existing.id, duplicate: true, spam }, 200);
  }

  const id = `sub_${crypto.randomUUID().replace(/-/g, '')}`;
  const submittedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO submissions (id, domain, submitted_at, page_url, name, phone, email, service, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, domain, submittedAt, pageUrl, name, phone, email, service, message)
    .run();

  const fields = { name, phone, email, service, message };
  const spam = await leadIsSpam(env, fields);
  if (spam) {
    return json({ ok: true, id, spam: true }, 201);
  }

  // Sites that have not been shipped again still post a copy here and then
  // email through Web3Forms. Only the new form sets deliver, so those sites
  // do not get a second email from this Worker.
  if (payload.deliver !== true) {
    return json({ ok: true, id, stored: true }, 201);
  }

  const businessName = clip(site.business_name, 120);
  const notify = clip(site.notify_email || env.NOTIFY_EMAIL, 200).toLowerCase();
  if (!looksLikeEmail(notify)) {
    return json({ ok: false, stored: true, id, error: 'email_not_configured' }, 502);
  }

  const send = sendLeadEmail(env, {
    to: notify,
    domain,
    businessName,
    replyTo: email,
    subject: clip(`Lead: ${businessName || domain}`, 180),
    text: leadEmailText({ businessName, domain, name, phone, email, service, message, pageUrl }),
  });
  // The page confirms as soon as the row is stored. A later send failure keeps the row.
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(send.catch(() => {}));
    return json({ ok: true, id }, 201);
  }
  try {
    await send;
  } catch {
    return json({ ok: false, stored: true, id, error: 'email_failed' }, 502);
  }
  return json({ ok: true, id, emailed: true }, 201);
}

async function rateLimited(env, ip) {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  await env.DB.prepare('DELETE FROM submit_hits WHERE submitted_at < ?').bind(since).run();
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM submit_hits WHERE ip = ? AND submitted_at >= ?',
  )
    .bind(ip, since)
    .first();
  const count = Number(row?.n || 0);
  if (count >= RATE_LIMIT) return true;
  await env.DB.prepare('INSERT INTO submit_hits (ip, submitted_at) VALUES (?, ?)')
    .bind(ip, new Date().toISOString())
    .run();
  return false;
}

async function sendLeadEmail(env, { to, domain, businessName, replyTo, subject, text }) {
  if (!env.EMAIL || typeof env.EMAIL.send !== 'function') {
    throw new Error('email_not_configured');
  }
  const fromEmail = `leads@${domain}`;
  const message = {
    to,
    from: businessName ? { email: fromEmail, name: businessName } : fromEmail,
    subject,
    text,
  };
  const reply = String(replyTo || '').trim();
  if (looksLikeEmail(reply) && reply.toLowerCase() !== String(to).toLowerCase()) {
    message.replyTo = reply;
  }
  await env.EMAIL.send(message);
}

async function leadIsSpam(env, fields) {
  let keywords = [];
  try {
    const listed = await env.DB.prepare('SELECT keyword FROM spam_keywords').all();
    keywords = (listed?.results || [])
      .map((row) => String(row?.keyword || '').trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return false;
  }
  const hay = ` ${[fields.name, fields.email, fields.phone, fields.service, fields.message].join('\n').toLowerCase()} `;
  return keywords.some((phrase) => {
    const needle = String(phrase || '').trim().toLowerCase();
    if (!needle) return false;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ +/g, '\\s+');
    return new RegExp(`[^a-z0-9]${escaped}[^a-z0-9]`, 'i').test(hay);
  });
}
