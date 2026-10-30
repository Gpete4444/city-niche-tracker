/**
 * Forms Worker: store, email, spam, dedupe, honeypot, rate limit.
 * Run: node scripts/test-forms-worker.mjs
 */
import worker from '../ops/forms-worker/src/index.js';

function assert(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
}

function memoryDb() {
  const sites = [];
  const submissions = [];
  const hits = [];
  const keywords = [];
  function prepare(sql) {
    const q = sql.replace(/\s+/g, ' ').trim();
    const statement = (params) => ({
      async first() {
        if (q.startsWith('SELECT domain, business_name, notify_email')) {
          return sites.find((row) => row.domain === params[0]) || null;
        }
        if (q.includes('FROM submissions')) {
          const [domain, pageUrl, name, phone, email, service, message, since] = params;
          return (
            submissions.find(
              (row) =>
                row.domain === domain &&
                (row.page_url || '') === pageUrl &&
                (row.name || '') === name &&
                (row.phone || '') === phone &&
                (row.email || '') === email &&
                (row.service || '') === service &&
                (row.message || '') === message &&
                row.submitted_at >= since,
            ) || null
          );
        }
        if (q.includes('COUNT(*)')) {
          const [ip, since] = params;
          const n = hits.filter((hit) => hit.ip === ip && hit.submitted_at >= since).length;
          return { n };
        }
        return null;
      },
      async run() {
        if (q.startsWith('INSERT INTO submissions')) {
          const [id, domain, submitted_at, page_url, name, phone, email, service, message] = params;
          submissions.push({
            id,
            domain,
            submitted_at,
            page_url,
            name,
            phone,
            email,
            service,
            message,
          });
        } else if (q.startsWith('INSERT INTO submit_hits')) {
          hits.push({ ip: params[0], submitted_at: params[1] });
        } else if (q.startsWith('DELETE FROM submit_hits')) {
          const since = params[0];
          for (let i = hits.length - 1; i >= 0; i -= 1) {
            if (hits[i].submitted_at < since) hits.splice(i, 1);
          }
        }
        return { success: true };
      },
      async all() {
        if (q.includes('spam_keywords')) {
          return { results: keywords.map((keyword) => ({ keyword })) };
        }
        return { results: [] };
      },
    });
    const bound = statement([]);
    bound.bind = (...params) => statement(params);
    return bound;
  }
  return { prepare, sites, submissions, hits, keywords };
}

function post(db, body, { ip = '203.0.113.8', emailSend, notify = 'owner@gmail.com', email = true } = {}) {
  const sent = [];
  const pending = [];
  const env = {
    DB: db,
    NOTIFY_EMAIL: notify,
  };
  if (email) {
    env.EMAIL = {
      send: async (message) => {
        if (emailSend) return emailSend(message);
        sent.push(message);
      },
    };
    env.EMAIL.sent = sent;
  }
  const ctx = {
    waitUntil(promise) {
      pending.push(Promise.resolve(promise));
    },
  };
  const request = new Request('https://forms.example/submit', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'text/plain' },
    body: JSON.stringify(body),
  });
  return worker.fetch(request, env, ctx).then(async (res) => {
    const parsed = await res.json();
    await Promise.all(pending);
    return { status: res.status, body: parsed, sent };
  });
}

const db = memoryDb();
db.sites.push({
  domain: 'example.com',
  business_name: 'Example Pros',
  notify_email: 'owner@gmail.com',
});
db.keywords.push('viagra');

const storedOnly = await post(db, {
  domain: 'example.com',
  page_url: 'https://example.com/',
  name: 'Legacy',
  phone: '555-0199',
  message: 'old form copy',
});
assert(storedOnly.status === 201 && storedOnly.body.stored === true && !storedOnly.body.emailed, 'legacy copy stores without email');
assert(storedOnly.sent.length === 0, 'legacy copy does not email');
assert(db.submissions.length === 1, 'legacy copy inserted one row');

const happy = await post(db, {
  domain: 'example.com',
  deliver: true,
  page_url: 'https://example.com/',
  name: 'Ada',
  phone: '555-0100',
  email: 'ada@visitor.test',
  service: 'Repair',
  message: 'Need a quote',
});
assert(happy.status === 201 && happy.body.ok === true && !happy.body.emailed, 'happy confirms before the email finishes');
assert(db.submissions.length === 2, 'happy inserted one row');
assert(happy.sent.length === 1, 'happy sent one email');
assert(happy.sent[0].to === 'owner@gmail.com', 'email to notify');
assert(happy.sent[0].from.email === 'leads@example.com', 'email from leads@');
assert(happy.sent[0].from.name === 'Example Pros', 'email from name');
assert(happy.sent[0].replyTo === 'ada@visitor.test', 'reply-to visitor');
assert(happy.sent[0].text.includes('Ada'), 'body includes name');

const dup = await post(db, {
  domain: 'example.com',
  deliver: true,
  page_url: 'https://example.com/',
  name: 'Ada',
  phone: '555-0100',
  email: 'ada@visitor.test',
  service: 'Repair',
  message: 'Need a quote',
});
assert(dup.status === 200 && dup.body.duplicate === true, 'duplicate returns existing');
assert(db.submissions.length === 2, 'duplicate does not insert');
assert(dup.sent.length === 0, 'duplicate does not email');

const spam = await post(db, {
  domain: 'example.com',
  deliver: true,
  name: 'Bot',
  phone: '555-0101',
  email: 'bot@spam.test',
  message: 'buy viagra now',
});
assert(spam.status === 201 && spam.body.spam === true, 'spam stores and flags');
assert(spam.sent.length === 0, 'spam does not email');
assert(db.submissions.length === 3, 'spam row kept');

const honey = await post(db, {
  domain: 'example.com',
  name: 'Bot',
  botcheck: '1',
  message: 'hello',
});
assert(honey.status === 200 && honey.body.dropped === true, 'honeypot drops');
assert(db.submissions.length === 3, 'honeypot does not store');
assert(honey.sent.length === 0, 'honeypot does not email');

const unknown = await post(db, {
  domain: 'missing.test',
  name: 'Ada',
  message: 'hi',
});
assert(unknown.status === 403 && unknown.body.error === 'unknown_domain', 'unknown domain rejected');

const limitedDb = memoryDb();
limitedDb.sites.push({
  domain: 'example.com',
  business_name: 'Example Pros',
  notify_email: 'owner@gmail.com',
});
for (let i = 0; i < 8; i += 1) {
  const res = await post(limitedDb, {
    domain: 'example.com',
    deliver: true,
    name: 'Ada',
    message: `quote ${i}`,
  }, { ip: '198.51.100.4' });
  assert(res.status === 201, `rate slot ${i + 1} allowed`);
}
assert(limitedDb.submissions.length === 8, 'eight leads stored');
const ninth = await post(limitedDb, {
  domain: 'example.com',
  deliver: true,
  name: 'Ada',
  message: 'quote 9',
}, { ip: '198.51.100.4' });
assert(ninth.status === 429 && ninth.body.error === 'rate_limited', 'ninth request rate limited');
assert(limitedDb.submissions.length === 8, 'rate limit does not insert');

const failDb = memoryDb();
failDb.sites.push({
  domain: 'example.com',
  business_name: 'Example Pros',
  notify_email: 'owner@gmail.com',
});
const failed = await post(
  failDb,
  { domain: 'example.com', deliver: true, name: 'Ada', email: 'ada@visitor.test', message: 'please call' },
  { emailSend: async () => { throw new Error('smtp down'); } },
);
assert(failed.status === 201 && failed.body.ok === true, 'email failure still confirms after the lead is stored');
assert(failDb.submissions.length === 1, 'failed email still stored');

const bareDb = memoryDb();
bareDb.sites.push({ domain: 'example.com', business_name: 'Example Pros', notify_email: '' });
const missing = await post(
  bareDb,
  { domain: 'example.com', deliver: true, name: 'Ada', message: 'hello' },
  { notify: '' },
);
assert(missing.status === 502 && missing.body.error === 'email_not_configured' && missing.body.stored === true, 'missing notify keeps the row');

const noBinding = memoryDb();
noBinding.sites.push({
  domain: 'example.com',
  business_name: 'Example Pros',
  notify_email: 'owner@gmail.com',
});
const unbound = await post(
  noBinding,
  { domain: 'example.com', deliver: true, name: 'Ada', message: 'hello' },
  { email: false },
);
assert(unbound.status === 201 && unbound.body.ok === true, 'missing EMAIL binding still confirms');
assert(noBinding.submissions.length === 1, 'missing EMAIL binding still stored');

console.log('test-forms-worker: ok');
