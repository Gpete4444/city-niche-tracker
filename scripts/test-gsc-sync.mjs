/**
 * GSC sync helpers: property match, query body, single-flight refresh, revoke.
 * Run: node scripts/test-gsc-sync.mjs
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  GSC_AUTH_REVOKED,
  _configureGscOauthForTests,
  formatGscApiError,
  getGscAccessToken,
  getGscAuthStatus,
  isGscRefreshRevoked,
} from '../ops/lib/gsc-oauth.mjs';
import {
  buildSearchAnalyticsQueryBody,
  isGscPropertyUnverified,
  matchGscProperty,
} from '../ops/lib/gsc-sync.mjs';

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

const entries = [
  { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
  { siteUrl: 'https://www.other.com/', permissionLevel: 'siteOwner' },
  { siteUrl: 'https://not-example.com/', permissionLevel: 'siteOwner' },
  { siteUrl: 'https://www.prefix.com/', permissionLevel: 'siteFullUser' },
  { siteUrl: 'sc-domain:pending.com', permissionLevel: 'siteUnverifiedUser' },
];

assertEqual(matchGscProperty('example.com', entries), 'sc-domain:example.com', 'domain property');
assertEqual(matchGscProperty('www.example.com', entries), 'sc-domain:example.com', 'www stripped');
assertEqual(matchGscProperty('prefix.com', entries), 'https://www.prefix.com/', 'url-prefix www');
assertEqual(matchGscProperty('example.com', [{ siteUrl: 'https://example.com/' }]), 'https://example.com/', 'apex https');
assertEqual(
  matchGscProperty('example.com', entries.filter((e) => e.siteUrl !== 'sc-domain:example.com')),
  null,
  'no fuzzy substring match on not-example.com',
);
assertEqual(matchGscProperty('missing.com', entries), null, 'no match');
assert(isGscPropertyUnverified(entries[4]), 'unverified permission');
assert(!isGscPropertyUnverified(entries[0]), 'owner is verified');

const totals = buildSearchAnalyticsQueryBody({
  startDate: '2026-08-01',
  endDate: '2026-08-28',
  dimensions: [],
});
assertEqual(Object.hasOwn(totals, 'dimensions'), false, 'totals omit empty dimensions');
assertEqual(totals.startDate, '2026-08-01', 'totals start');
assertEqual(totals.rowLimit, 25, 'totals rowLimit');

const byDate = buildSearchAnalyticsQueryBody({
  startDate: '2026-06-01',
  endDate: '2026-08-28',
  dimensions: ['date'],
});
assert(Array.isArray(byDate.dimensions) && byDate.dimensions[0] === 'date', 'date dimensions kept');
assertEqual(byDate.rowLimit, 500, 'date rowLimit');

assert(isGscRefreshRevoked({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), 'invalid_grant');
assert(
  isGscRefreshRevoked({ error: { message: 'Token has been expired or revoked.' } }),
  'api 401 message',
);
assert(!isGscRefreshRevoked({ error: { message: 'Bad Request', errors: [{ reason: 'invalid' }] } }), '400 is not revoke');

assertEqual(
  formatGscApiError({ error: { message: 'Bad Request', errors: [{ reason: 'invalid' }] } }),
  'Bad Request (invalid)',
  '400 reason appended',
);

const prevId = process.env.GOOGLE_GSC_CLIENT_ID;
const prevSecret = process.env.GOOGLE_GSC_CLIENT_SECRET;
process.env.GOOGLE_GSC_CLIENT_ID = prevId || 'test-gsc-client';
process.env.GOOGLE_GSC_CLIENT_SECRET = prevSecret || 'test-gsc-secret';

const dir = mkdtempSync(path.join(tmpdir(), 'rover-gsc-'));
const tokenFile = path.join(dir, 'gsc-oauth.json');

function writeExpiredTokens(refresh = 'refresh-1') {
  writeFileSync(
    tokenFile,
    `${JSON.stringify({
      access_token: 'old-access',
      refresh_token: refresh,
      expiry_date: Date.now() - 5_000,
      updatedAt: new Date().toISOString(),
    })}\n`,
    'utf8',
  );
}

try {
  writeExpiredTokens();
  let refreshPosts = 0;
  _configureGscOauthForTests({
    tokenFile,
    fetchImpl: async (url) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        refreshPosts += 1;
        await new Promise((r) => setTimeout(r, 80));
        return {
          ok: true,
          json: async () => ({ access_token: 'new-access', expires_in: 3600 }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    },
  });
  const [a, b] = await Promise.all([getGscAccessToken(), getGscAccessToken()]);
  assertEqual(refreshPosts, 1, 'single-flight refresh POST');
  assertEqual(a, 'new-access', 'token a');
  assertEqual(b, 'new-access', 'token b');

  writeExpiredTokens();
  _configureGscOauthForTests({
    tokenFile,
    fetchImpl: async (url) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return {
          ok: false,
          json: async () => ({
            error: 'invalid_grant',
            error_description: 'Token has been expired or revoked.',
          }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    },
  });
  let thrown = null;
  try {
    await getGscAccessToken();
  } catch (error) {
    thrown = error;
  }
  assert(thrown, 'revoke throws');
  assertEqual(thrown.code, GSC_AUTH_REVOKED, 'GSC_AUTH_REVOKED code');
  assert(!existsSync(tokenFile), 'token file cleared');
  assertEqual(getGscAuthStatus().connected, false, 'status disconnected after revoke');
} finally {
  _configureGscOauthForTests({ fetchImpl: null, tokenFile: null });
  if (!prevId) delete process.env.GOOGLE_GSC_CLIENT_ID;
  else process.env.GOOGLE_GSC_CLIENT_ID = prevId;
  if (!prevSecret) delete process.env.GOOGLE_GSC_CLIENT_SECRET;
  else process.env.GOOGLE_GSC_CLIENT_SECRET = prevSecret;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log('test-gsc-sync: ok');
