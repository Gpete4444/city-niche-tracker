/**
 * Account setup, missing-key codes, plan checks, and the account worker.
 * Run: node scripts/test-account-access.mjs
 */
import worker, { hashPassword } from '../ops/account-worker/src/index.js';
import { maskSecret } from '../ops/lib/account-setup-catalog.mjs';
import { missingFieldForRequest } from '../ops/lib/missing-key.mjs';
import { planAllows, requiredPlan } from '../ops/lib/entitlement.mjs';
import { isSourceCheckout } from '../ops/lib/source-checkout.mjs';
import { assertRelaunchNotifyEmail } from '../ops/lib/relaunch-launched.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
}

function memoryDb() {
  const users = [];
  const sessions = [];
  const emailTokens = [];
  function prepare(sql) {
    const q = sql.replace(/\s+/g, ' ').trim();
    return {
      bind(...params) {
        return {
          async first() {
            if (q.startsWith('SELECT * FROM users WHERE email')) {
              return users.find((row) => row.email === params[0]) || null;
            }
            if (q.startsWith('SELECT * FROM users WHERE id')) {
              return users.find((row) => row.id === params[0]) || null;
            }
            if (q.startsWith('SELECT user_id, expires_at FROM sessions')) {
              return sessions.find((row) => row.token_hash === params[0]) || null;
            }
            if (q.startsWith('SELECT user_id, purpose, expires_at FROM email_tokens')) {
              return emailTokens.find((row) => row.token_hash === params[0]) || null;
            }
            return null;
          },
          async run() {
            if (q.startsWith('INSERT INTO users')) {
              users.push({
                id: params[0],
                email: params[1],
                password_hash: params[2],
                password_salt: params[3],
                email_confirmed: 0,
                role: params[4],
                stripe_customer_id: null,
                plan: null,
                paid_through: null,
                machine_id: null,
                created_at: params[5],
              });
            } else if (q.startsWith('INSERT INTO sessions')) {
              sessions.push({ token_hash: params[0], user_id: params[1], expires_at: params[2] });
            } else if (q.startsWith('INSERT INTO email_tokens')) {
              emailTokens.push({
                token_hash: params[0],
                user_id: params[1],
                purpose: params[2],
                expires_at: params[3],
              });
            } else if (q.startsWith('DELETE FROM email_tokens')) {
              const index = emailTokens.findIndex((row) => row.token_hash === params[0]);
              if (index >= 0) emailTokens.splice(index, 1);
            } else if (q.startsWith('DELETE FROM sessions WHERE user_id')) {
              for (let i = sessions.length - 1; i >= 0; i -= 1) {
                if (sessions[i].user_id === params[0]) sessions.splice(i, 1);
              }
            } else if (q.startsWith('DELETE FROM sessions WHERE token_hash')) {
              const index = sessions.findIndex((row) => row.token_hash === params[0]);
              if (index >= 0) sessions.splice(index, 1);
            } else if (q.startsWith('UPDATE users SET email_confirmed')) {
              const user = users.find((row) => row.id === params[0]);
              if (user) user.email_confirmed = 1;
            } else if (q.startsWith('UPDATE users SET password_hash')) {
              const user = users.find((row) => row.id === params[2]);
              if (user) {
                user.password_hash = params[0];
                user.password_salt = params[1];
              }
            } else if (q.startsWith('UPDATE users SET role')) {
              const user = users.find((row) => row.id === params[1]);
              if (user) user.role = params[0];
            } else if (q.startsWith('UPDATE users SET machine_id')) {
              const user = users.find((row) => row.id === params[1]);
              if (user) user.machine_id = params[0];
            }
            return { success: true };
          },
        };
      },
    };
  }
  return { prepare };
}

function request(path, { method = 'GET', body, token, env }) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return worker.fetch(
    new Request(`https://account.test${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
  );
}

const masked = maskSecret('sk-ant-secret-value');
assert(masked.set === true && masked.last4 === 'alue', 'mask keeps only the last four');
assert(maskSecret('').set === false, 'empty secret is not set');
assert(maskSecret('abcd').last4 === '', 'short secret hides the whole value');

const previousLogin = process.env.DATAFORSEO_LOGIN;
const previousPassword = process.env.DATAFORSEO_PASSWORD;
delete process.env.DATAFORSEO_LOGIN;
delete process.env.DATAFORSEO_PASSWORD;
assert(
  missingFieldForRequest('POST', '/api/discovery/batches/abc/serp-probe') === 'DATAFORSEO_LOGIN',
  'serp probe reports the DataForSEO field',
);
process.env.DATAFORSEO_LOGIN = 'login';
process.env.DATAFORSEO_PASSWORD = 'secret';
assert(missingFieldForRequest('POST', '/api/discovery/batches/abc/serp-probe') === null, 'set keys pass');
assert(missingFieldForRequest('GET', '/api/discovery/batches/abc') === null, 'reads do not require a key');
if (previousLogin == null) delete process.env.DATAFORSEO_LOGIN;
else process.env.DATAFORSEO_LOGIN = previousLogin;
if (previousPassword == null) delete process.env.DATAFORSEO_PASSWORD;
else process.env.DATAFORSEO_PASSWORD = previousPassword;

assert(requiredPlan('GET', '/api/discovery/pack') === null, 'GET is not a paid action');
assert(requiredPlan('POST', '/api/discovery/pack') === 'full', 'discovery is Full');
assert(requiredPlan('POST', '/api/phone/calls') === 'maintain', 'phone is Maintain');
assert(requiredPlan('POST', '/api/account/login') === null, 'sign-in is not gated');
assert(planAllows({ role: 'admin' }, 'full') === true, 'admin skips the paid-through date');
assert(planAllows({ plan: 'maintain', paidThrough: '2099-01-01T00:00:00.000Z' }, 'full') === false, 'Maintain cannot launch new work');
assert(planAllows({ plan: 'full', paidThrough: '2099-01-01T00:00:00.000Z' }, 'maintain') === true, 'Full includes Maintain');
assert(planAllows({ plan: 'full', paidThrough: '2000-01-01T00:00:00.000Z' }, 'full') === false, 'expired week locks');
assert(isSourceCheckout(process.cwd()) === true, 'this repo is the source checkout');

const previousNotify = process.env.LEAD_NOTIFY_EMAIL;
process.env.LEAD_NOTIFY_EMAIL = 'owner@example.com';
assert(assertRelaunchNotifyEmail('owner@example.com') === 'owner@example.com', 'relaunch uses the saved lead email');
let rejected = false;
try {
  assertRelaunchNotifyEmail('other@example.com');
} catch (error) {
  rejected = error.field === 'leadNotifyEmail';
}
assert(rejected, 'relaunch refuses a different inbox');
if (previousNotify == null) delete process.env.LEAD_NOTIFY_EMAIL;
else process.env.LEAD_NOTIFY_EMAIL = previousNotify;

const env = {
  DB: memoryDb(),
  DEV_RETURN_LINKS: '1',
  ADMIN_EMAILS: 'admin@example.com',
  APP_BASE_URL: 'https://account.test',
};

const signup = await request('/signup', {
  method: 'POST',
  body: { email: 'user@example.com', password: 'correct-horse' },
  env,
});
const created = await signup.json();
assert(signup.status === 201 && created.devLink, 'signup returns a confirm link without storing the password');
const token = new URL(created.devLink).searchParams.get('token');
const confirmed = await request('/confirm', { method: 'POST', body: { token }, env });
assert(confirmed.status === 200, 'confirm email');
const login = await request('/login', {
  method: 'POST',
  body: { email: 'user@example.com', password: 'correct-horse', machineId: 'machine-a' },
  env,
});
const session = await login.json();
assert(login.status === 200 && session.token && !session.user.password, 'login returns a token, not the password');
const again = await request('/login', {
  method: 'POST',
  body: { email: 'user@example.com', password: 'correct-horse', machineId: 'machine-b' },
  env,
});
assert(again.status === 409, 'second computer needs a seat move');
const me = await request('/me', { token: session.token, env });
const meBody = await me.json();
assert(me.status === 200 && meBody.user.email === 'user@example.com', 'session reads the account');

const adminSignup = await request('/signup', {
  method: 'POST',
  body: { email: 'admin@example.com', password: 'admin-password' },
  env,
});
assert(adminSignup.status === 201, 'admin email can sign up');
const adminLogin = await request('/login', {
  method: 'POST',
  body: { email: 'admin@example.com', password: 'admin-password', machineId: 'a' },
  env,
});
const adminBody = await adminLogin.json();
assert(adminBody.user.role === 'admin', 'configured admin email is the admin role');

const hashed = await hashPassword('correct-horse');
const againHash = await hashPassword('correct-horse', hashed.salt);
assert(hashed.hash === againHash.hash, 'the same password hashes to the same value');
const wrong = await hashPassword('wrong-password', hashed.salt);
assert(wrong.hash !== hashed.hash, 'a different password does not match');

console.log('account access tests passed');
