/**
 * Indexing submit: scopes, DNS TXT, verify retry, one sitemap submit.
 * Run: node scripts/test-gsc-indexing-submit.mjs
 */
import { GSC_OAUTH_SCOPES, gscHasIndexingScopes, isGscInsufficientScope } from '../ops/lib/gsc-oauth.mjs';
import {
  ensureDnsTxtRecord,
  isAlreadyVerifiedMessage,
  isRetryableVerificationError,
  sitemapListIncludes,
  submitDomainToSearchConsole,
} from '../ops/lib/gsc-indexing-submit.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

const READONLY = 'https://www.googleapis.com/auth/webmasters.readonly';
const WRITE = 'https://www.googleapis.com/auth/webmasters';
const VERIFY = 'https://www.googleapis.com/auth/siteverification';
const HOST = 'sparksdrywallrepair.com';
const readyAuth = { configured: true, connected: true, scope: `${WRITE} ${VERIFY}` };

assert(GSC_OAUTH_SCOPES.includes(WRITE), 'oauth requests webmasters');
assert(GSC_OAUTH_SCOPES.includes(VERIFY), 'oauth requests siteverification');
assert(!GSC_OAUTH_SCOPES.includes(READONLY), 'oauth does not request readonly');
assert(!gscHasIndexingScopes(READONLY), 'readonly is not enough');
assert(!gscHasIndexingScopes(`${READONLY} ${VERIFY}`), 'readonly plus verify is not enough');
assert(gscHasIndexingScopes(`${WRITE} ${VERIFY}`), 'write plus verify');
assert(
  isGscInsufficientScope({
    status: 403,
    message: 'Request had insufficient authentication scopes.',
  }),
  'scope message',
);
assert(
  !isGscInsufficientScope({
    status: 403,
    message: 'User does not have sufficient permission for site',
  }),
  'site permission is not a scope error',
);

assert(sitemapListIncludes({ sitemap: [{ path: `https://${HOST}/sitemap.xml` }] }, `https://${HOST}/sitemap.xml`), 'sitemap match');
assert(!sitemapListIncludes({ sitemap: [{ path: `https://${HOST}/other.xml` }] }, `https://${HOST}/sitemap.xml`), 'sitemap miss');
assert(isAlreadyVerifiedMessage({ message: 'You are already an owner of this site.' }), 'already owner');
assert(
  isRetryableVerificationError({ status: 400, message: 'The necessary verification token could not be found.' }),
  'token missing retries',
);
assert(!isRetryableVerificationError({ status: 403, message: 'nope', code: 'GSC_SCOPE_INSUFFICIENT' }), 'scope does not retry');

const txtCalls = [];
const txt = await ensureDnsTxtRecord({
  zoneId: 'z1',
  name: HOST,
  content: 'google-site-verification=abc',
  cf: async (method, path, body) => {
    txtCalls.push({ method, path, body });
    if (method === 'GET') {
      return [{ id: 'old', content: '"google-site-verification=abc"' }];
    }
    return { id: 'new' };
  },
});
assertEqual(txt.created, false, 'quoted TXT already present');
assertEqual(txtCalls.length, 1, 'no second TXT write');

const created = await ensureDnsTxtRecord({
  zoneId: 'z1',
  name: HOST,
  content: 'google-site-verification=new',
  cf: async (method) => (method === 'GET' ? [{ id: 'spf', content: 'v=spf1 include:_spf.mx.cloudflare.net ~all' }] : { id: 'txt2' }),
});
assertEqual(created.created, true, 'new token is added beside SPF');
assertEqual(created.id, 'txt2', 'created id');

async function expectThrow(fn, code, label) {
  try {
    await fn();
  } catch (error) {
    if (code) assertEqual(error.code, code, label);
    else assert(error instanceof Error, label);
    return error;
  }
  console.error(`${label}: did not throw`);
  process.exit(1);
}

await expectThrow(
  () => submitDomainToSearchConsole('example.com', { authStatus: readyAuth, gscFetchUrl: async () => { throw new Error('called'); } }),
  undefined,
  'placeholder domain',
);

await expectThrow(
  () =>
    submitDomainToSearchConsole(HOST, {
      authStatus: { configured: true, connected: false, scope: null },
    }),
  'GSC_AUTH_REVOKED',
  'not connected',
);

let scopeCalls = 0;
await expectThrow(
  () =>
    submitDomainToSearchConsole(HOST, {
      authStatus: { configured: true, connected: true, scope: READONLY },
      gscFetchUrl: async () => {
        scopeCalls += 1;
        return {};
      },
    }),
  'GSC_SCOPE_INSUFFICIENT',
  'readonly token',
);
assertEqual(scopeCalls, 0, 'readonly token does not call Google');

const sleeps = [];
let verifyTries = 0;
const pathCalls = [];
const happy = await submitDomainToSearchConsole(HOST, {
  authStatus: readyAuth,
  verifyWaitMs: 1,
  sleep: async (ms) => {
    sleeps.push(ms);
  },
  findZone: async () => ({ id: 'zone1' }),
  ensureDnsTxtRecord: async () => ({ created: true, id: 'txt' }),
  gscFetchUrl: async (url) => {
    if (String(url).includes('/token')) return { token: 'google-site-verification=abc' };
    verifyTries += 1;
    if (verifyTries < 3) {
      throw Object.assign(new Error('The necessary verification token could not be found on your site.'), {
        status: 400,
      });
    }
    return { id: `sc-domain:${HOST}` };
  },
  gscFetch: async (path, opts = {}) => {
    pathCalls.push({ path, method: opts.method || 'GET' });
    if (path.endsWith('/sitemaps')) return { sitemap: [] };
    return null;
  },
});
assertEqual(happy.host, HOST, 'happy host');
assertEqual(happy.dnsCreated, true, 'dns created');
assertEqual(happy.sitemapAlreadySubmitted, false, 'sitemap submitted');
assertEqual(verifyTries, 3, 'verify retried twice');
assertEqual(sleeps.length, 2, 'slept between retries');
assertEqual(pathCalls.filter((c) => c.method === 'PUT' && c.path.includes('/sitemaps/')).length, 1, 'one sitemap put');
assert(pathCalls.some((c) => c.method === 'PUT' && c.path.includes(encodeURIComponent(`sc-domain:${HOST}`))), 'site put');

const skipCalls = [];
const skipped = await submitDomainToSearchConsole(HOST, {
  authStatus: readyAuth,
  verifyWaitMs: 1,
  sleep: async () => {},
  findZone: async () => ({ id: 'zone1' }),
  ensureDnsTxtRecord: async () => ({ created: false, id: 'txt' }),
  gscFetchUrl: async (url) => {
    if (String(url).includes('/token')) return { token: 'google-site-verification=abc' };
    throw Object.assign(new Error('You are already an owner of this site.'), { status: 400 });
  },
  gscFetch: async (path, opts = {}) => {
    skipCalls.push({ path, method: opts.method || 'GET' });
    if (path.endsWith('/sitemaps')) return { sitemap: [{ path: `https://${HOST}/sitemap.xml` }] };
    return null;
  },
});
assertEqual(skipped.sitemapAlreadySubmitted, true, 'already submitted');
assertEqual(skipCalls.filter((c) => c.path.includes('/sitemaps/')).length, 0, 'no second sitemap put');

let latePuts = 0;
await expectThrow(
  () =>
    submitDomainToSearchConsole(HOST, {
      authStatus: readyAuth,
      verifyAttempts: 2,
      verifyWaitMs: 1,
      sleep: async () => {},
      findZone: async () => ({ id: 'zone1' }),
      ensureDnsTxtRecord: async () => ({ created: true, id: 'txt' }),
      gscFetchUrl: async (url) => {
        if (String(url).includes('/token')) return { token: 'google-site-verification=abc' };
        throw Object.assign(new Error('The necessary verification token could not be found.'), { status: 400 });
      },
      gscFetch: async () => {
        latePuts += 1;
        return null;
      },
    }),
  undefined,
  'dns lag message',
);
assertEqual(latePuts, 0, 'failed verify does not add the property');

console.log('gsc indexing submit ok');
