/**
 * One account service for every Rover login.
 * Stores email, a password hash, the weekly plan, and a machine seat.
 * Does not store API keys.
 *
 * Password hash is PBKDF2-SHA-256 (WebCrypto). The password is never written
 * to D1 or to logs.
 */
const PBKDF2_ITERATIONS = 210_000;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      ...extraHeaders,
    },
  });
}

function bytesToB64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function b64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeEqual(left, right) {
  const a = String(left);
  const b = String(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hashPassword(password, saltB64 = '') {
  const salt = saltB64 ? b64ToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return { hash: bytesToB64(new Uint8Array(bits)), salt: bytesToB64(salt) };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function adminEmails(env) {
  return String(env.ADMIN_EMAILS || '')
    .split(',')
    .map((item) => normalizeEmail(item))
    .filter(Boolean);
}

function roleFor(env, email) {
  return adminEmails(env).includes(email) ? 'admin' : 'customer';
}

function publicUser(row) {
  return {
    email: row.email,
    role: row.role,
    emailConfirmed: Boolean(row.email_confirmed),
    plan: row.plan || null,
    paidThrough: row.paid_through || null,
    machineId: row.machine_id || null,
  };
}

async function readBody(request) {
  const type = String(request.headers.get('Content-Type') || '');
  if (type.includes('application/x-www-form-urlencoded')) {
    const text = await request.text();
    return Object.fromEntries(new URLSearchParams(text));
  }
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function userByEmail(env, email) {
  return env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
}

async function userById(env, id) {
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

async function bearerUser(request, env) {
  const header = String(request.headers.get('Authorization') || '');
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const session = await env.DB.prepare(
    'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?',
  )
    .bind(tokenHash)
    .first();
  if (!session) return null;
  if (Date.parse(session.expires_at) <= Date.now()) return null;
  return userById(env, session.user_id);
}

async function createSession(env, userId) {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
  )
    .bind(tokenHash, userId, expires)
    .run();
  return token;
}

async function issueEmailToken(env, userId, purpose) {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(tokenHash, userId, purpose, expires)
    .run();
  return token;
}

async function sendMail(env, { to, subject, text }) {
  if (env.EMAIL && typeof env.EMAIL.send === 'function' && env.MAIL_FROM) {
    await env.EMAIL.send({
      to,
      from: env.MAIL_FROM,
      subject,
      text,
    });
    return { sent: true };
  }
  if (env.RESEND_API_KEY && env.MAIL_FROM) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail.slice(0, 200) || 'Mail send failed');
    }
    return { sent: true };
  }
  if (env.DEV_RETURN_LINKS === '1') return { sent: false, dev: true };
  const error = new Error('Account email is not configured.');
  error.status = 503;
  throw error;
}

function appBase(env) {
  return String(env.APP_BASE_URL || '').replace(/\/$/, '');
}

async function consumeEmailToken(env, token, purpose) {
  const tokenHash = await sha256Hex(String(token || ''));
  const row = await env.DB.prepare(
    'SELECT user_id, purpose, expires_at FROM email_tokens WHERE token_hash = ?',
  )
    .bind(tokenHash)
    .first();
  if (!row || row.purpose !== purpose || Date.parse(row.expires_at) <= Date.now()) return null;
  await env.DB.prepare('DELETE FROM email_tokens WHERE token_hash = ?').bind(tokenHash).run();
  return row.user_id;
}

async function stripeForm(env, path, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data?.error?.message || 'Stripe request failed');
    error.status = 502;
    throw error;
  }
  return data;
}

function priceForPlan(env, plan) {
  if (plan === 'full') return env.STRIPE_PRICE_FULL || '';
  if (plan === 'maintain') return env.STRIPE_PRICE_MAINTAIN || '';
  return '';
}

async function verifyStripeSignature(request, env, raw) {
  const header = String(request.headers.get('Stripe-Signature') || '');
  const secret = String(env.STRIPE_WEBHOOK_SECRET || '');
  if (!secret) return false;
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, value];
    }),
  );
  const timestamp = parts.t || '';
  const signature = parts.v1 || '';
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${raw}`),
  );
  const hex = [...new Uint8Array(signed)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return safeEqual(hex, signature);
}

async function handleSignup(request, env) {
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  if (!looksLikeEmail(email)) return json({ error: 'Enter a valid email address.' }, 400);
  if (password.length < 8) return json({ error: 'Use at least 8 characters for the password.' }, 400);
  const existing = await userByEmail(env, email);
  if (existing) return json({ error: 'An account with that email already exists.' }, 409);
  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  const role = roleFor(env, email);
  await env.DB.prepare(
    `INSERT INTO users (
      id, email, password_hash, password_salt, email_confirmed, role, created_at
    ) VALUES (?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(id, email, hash, salt, role, new Date().toISOString())
    .run();
  const token = await issueEmailToken(env, id, 'confirm');
  const link = `${appBase(env)}/confirm?token=${token}`;
  const mail = await sendMail(env, {
    to: email,
    subject: 'Confirm your Rover account',
    text: `Confirm your Rover email:\n\n${link}\n\nThis link expires in one hour.`,
  });
  const payload = { ok: true, email, confirmRequired: true };
  if (mail.dev) payload.devLink = link;
  return json(payload, 201);
}

async function handleLogin(request, env) {
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const machineId = String(body.machineId || '').trim();
  const takeover = body.takeover === true;
  const user = await userByEmail(env, email);
  if (!user) return json({ error: 'Email or password is wrong.' }, 401);
  const next = await hashPassword(password, user.password_salt);
  if (!safeEqual(next.hash, user.password_hash)) {
    return json({ error: 'Email or password is wrong.' }, 401);
  }
  if (!user.email_confirmed && user.role !== 'admin') {
    return json({ error: 'Confirm the email before signing in.', code: 'confirm_required' }, 403);
  }
  const role = roleFor(env, email);
  if (role !== user.role) {
    await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, user.id).run();
    user.role = role;
  }
  if (role !== 'admin' && machineId) {
    if (user.machine_id && user.machine_id !== machineId && !takeover) {
      return json(
        {
          error: 'This account is already active on another computer.',
          code: 'seat_taken',
        },
        409,
      );
    }
    await env.DB.prepare('UPDATE users SET machine_id = ? WHERE id = ?').bind(machineId, user.id).run();
    user.machine_id = machineId;
  }
  const token = await createSession(env, user.id);
  return json({ ok: true, token, user: publicUser(user) });
}

async function handleForgot(request, env) {
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  const user = looksLikeEmail(email) ? await userByEmail(env, email) : null;
  if (!user) return json({ ok: true });
  const token = await issueEmailToken(env, user.id, 'reset');
  const link = `${appBase(env)}/reset?token=${token}`;
  const mail = await sendMail(env, {
    to: email,
    subject: 'Reset your Rover password',
    text: `Set a new Rover password:\n\n${link}\n\nThis link expires in one hour. If you did not ask for this, ignore it.`,
  });
  const payload = { ok: true };
  if (mail.dev) payload.devLink = link;
  return json(payload);
}

async function handleReset(request, env) {
  const body = await readBody(request);
  const password = String(body.password || '');
  if (password.length < 8) return json({ error: 'Use at least 8 characters for the password.' }, 400);
  const userId = await consumeEmailToken(env, body.token, 'reset');
  if (!userId) return json({ error: 'That reset link is no longer valid.' }, 400);
  const { hash, salt } = await hashPassword(password);
  await env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
    .bind(hash, salt, userId)
    .run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
  return json({ ok: true });
}

async function handleConfirm(request, env) {
  const body = await readBody(request);
  const userId = await consumeEmailToken(env, body.token, 'confirm');
  if (!userId) return json({ error: 'That confirmation link is no longer valid.' }, 400);
  await env.DB.prepare('UPDATE users SET email_confirmed = 1 WHERE id = ?').bind(userId).run();
  return json({ ok: true });
}

async function handleCheckout(request, env, user) {
  if (user.role === 'admin') return json({ error: 'The admin account does not need a weekly plan.' }, 400);
  if (!user.email_confirmed) return json({ error: 'Confirm the email before paying.' }, 403);
  const body = await readBody(request);
  const plan = body.plan === 'maintain' ? 'maintain' : body.plan === 'full' ? 'full' : '';
  const price = priceForPlan(env, plan);
  if (!plan || !env.STRIPE_SECRET_KEY || !price) {
    return json({ error: 'Weekly billing is not turned on yet.', code: 'billing_unconfigured' }, 503);
  }
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripeForm(env, 'customers', {
      email: user.email,
      'metadata[userId]': user.id,
    });
    customerId = customer.id;
    await env.DB.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?')
      .bind(customerId, user.id)
      .run();
  }
  const base = appBase(env);
  const session = await stripeForm(env, 'checkout/sessions', {
    mode: 'subscription',
    customer: customerId,
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    success_url: `${base}/billing/done?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/billing/cancel`,
    client_reference_id: user.id,
    'metadata[userId]': user.id,
    'metadata[plan]': plan,
    'subscription_data[metadata][userId]': user.id,
    'subscription_data[metadata][plan]': plan,
  });
  return json({ ok: true, url: session.url });
}

async function handlePortal(env, user) {
  if (!user.stripe_customer_id || !env.STRIPE_SECRET_KEY) {
    return json({ error: 'Weekly billing is not turned on yet.', code: 'billing_unconfigured' }, 503);
  }
  const session = await stripeForm(env, 'billing_portal/sessions', {
    customer: user.stripe_customer_id,
    return_url: `${appBase(env)}/billing`,
  });
  return json({ ok: true, url: session.url });
}

async function applySubscription(env, { userId, customerId, plan, paidThrough, clear = false }) {
  if (clear) {
    await env.DB.prepare('UPDATE users SET plan = NULL, paid_through = NULL WHERE id = ?')
      .bind(userId)
      .run();
    return;
  }
  await env.DB.prepare(
    'UPDATE users SET stripe_customer_id = COALESCE(?, stripe_customer_id), plan = ?, paid_through = ? WHERE id = ?',
  )
    .bind(customerId || null, plan || null, paidThrough || null, userId)
    .run();
}

async function handleWebhook(request, env) {
  const raw = await request.text();
  const ok = await verifyStripeSignature(request, env, raw);
  if (!ok) return json({ error: 'Invalid Stripe signature.' }, 400);
  const event = JSON.parse(raw);
  const type = event.type;
  const object = event.data?.object || {};
  if (type === 'checkout.session.completed') {
    const userId = object.metadata?.userId || object.client_reference_id;
    const plan = object.metadata?.plan;
    const periodEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    if (userId && plan) {
      await applySubscription(env, {
        userId,
        customerId: object.customer,
        plan,
        paidThrough: periodEnd,
      });
    }
  }
  if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
    const userId = object.metadata?.userId;
    const plan = object.metadata?.plan;
    const end = object.current_period_end
      ? new Date(Number(object.current_period_end) * 1000).toISOString()
      : null;
    if (userId) {
      const ended = type === 'customer.subscription.deleted' || object.status === 'canceled';
      await applySubscription(env, {
        userId,
        customerId: object.customer,
        plan: ended ? null : plan,
        paidThrough: ended ? null : end,
        clear: ended,
      });
    }
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return json({ ok: true }, 204);
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true });
      if (request.method === 'POST' && url.pathname === '/signup') return handleSignup(request, env);
      if (request.method === 'POST' && url.pathname === '/login') return handleLogin(request, env);
      if (request.method === 'POST' && url.pathname === '/forgot') return handleForgot(request, env);
      if (request.method === 'POST' && url.pathname === '/reset') return handleReset(request, env);
      if (request.method === 'POST' && url.pathname === '/confirm') return handleConfirm(request, env);
      if (request.method === 'POST' && url.pathname === '/stripe/webhook') return handleWebhook(request, env);
      if (request.method === 'GET' && (url.pathname === '/confirm' || url.pathname === '/reset')) {
        const token = url.searchParams.get('token') || '';
        const purpose = url.pathname === '/confirm' ? 'confirm' : 'reset';
        const page = `<!doctype html><meta charset="utf-8"><title>Rover account</title>
          <form method="post" action="${url.pathname}">
            <p>${purpose === 'confirm' ? 'Confirm this Rover email.' : 'Choose a new password (at least 8 characters).'}</p>
            <input type="hidden" name="token" value="${token.replace(/[^a-f0-9]/gi, '')}">
            ${purpose === 'reset' ? '<input name="password" type="password" minlength="8" required>' : ''}
            <button type="submit">${purpose === 'confirm' ? 'Confirm email' : 'Save password'}</button>
          </form>`;
        return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      const user = await bearerUser(request, env);
      if (!user) return json({ error: 'Sign in required.' }, 401);
      if (request.method === 'GET' && url.pathname === '/me') return json({ ok: true, user: publicUser(user) });
      if (request.method === 'POST' && url.pathname === '/logout') {
        const header = String(request.headers.get('Authorization') || '');
        const token = header.slice(7).trim();
        const tokenHash = await sha256Hex(token);
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
        return json({ ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/billing/checkout') {
        return handleCheckout(request, env, user);
      }
      if (request.method === 'POST' && url.pathname === '/billing/portal') return handlePortal(env, user);
      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      const message = String(error?.message || 'Account service error');
      if (!/password/i.test(message)) console.log(message.slice(0, 200));
      return json({ error: message }, error.status || 500);
    }
  },
};
