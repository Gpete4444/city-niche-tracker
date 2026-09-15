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
  mapAnalyticsDimensionRows,
  matchGscProperty,
  summarizeSitemapIndex,
} from '../ops/lib/gsc-sync.mjs';
import {
  fallbackSitemapUrls,
  filterSitemapPageUrls,
  isInspectIndexed,
  isRetryableInspectError,
  markdownRelToPathname,
  parseSitemapLocs,
  rollupInspectByUrl,
  shouldReuseCachedPass,
} from '../ops/lib/gsc-index-inspect.mjs';

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

const byQuery = buildSearchAnalyticsQueryBody({
  startDate: '2026-08-01',
  endDate: '2026-08-28',
  dimensions: ['query'],
});
assertEqual(byQuery.rowLimit, 100, 'query rowLimit');
const byPage = buildSearchAnalyticsQueryBody({
  startDate: '2026-08-01',
  endDate: '2026-08-28',
  dimensions: ['page'],
});
assertEqual(byPage.rowLimit, 50, 'page rowLimit');

const mapped = mapAnalyticsDimensionRows(
  [
    { keys: ['plumber denver'], clicks: 4, impressions: 80, ctr: 0.05, position: 8.24 },
    { keys: ['  '], clicks: 1, impressions: 2, position: 3 },
  ],
  'query',
);
assertEqual(mapped.length, 1, 'skip empty query keys');
assertEqual(mapped[0].query, 'plumber denver', 'query key');
assertEqual(mapped[0].clicks, 4, 'query clicks');
assertEqual(mapped[0].position, 8.2, 'position rounded');

const emptySm = summarizeSitemapIndex({ sitemap: [] });
assertEqual(emptySm.sitemapIndexed, null, 'empty sitemap indexed null');
const sm = summarizeSitemapIndex({
  sitemap: [
    {
      path: 'https://example.com/sitemap.xml',
      contents: [
        { type: 'web', submitted: '12', indexed: '8' },
        { type: 'image', submitted: 40, indexed: 40 },
      ],
    },
  ],
});
assertEqual(sm.sitemapPath, 'https://example.com/sitemap.xml', 'sitemap path');
assertEqual(sm.sitemapSubmitted, 12, 'web submitted');
assertEqual(sm.sitemapIndexed, 8, 'web indexed');
assertEqual(sm.sitemapNotIndexed, 4, 'not indexed proxy');

assertEqual(markdownRelToPathname('src/content/pages/index.md'), '/', 'home path');
assertEqual(markdownRelToPathname('src/content/pages/about.md'), '/about/', 'about path');
assertEqual(markdownRelToPathname('src/content/services/drain.md'), '/services/drain/', 'service path');
assertEqual(markdownRelToPathname('src/content/locations/omaha.md'), '/locations/omaha/', 'location path');
assertEqual(markdownRelToPathname('src/content/pages/notes.txt'), null, 'non-markdown skipped');

const fallback = fallbackSitemapUrls(
  {
    'src/content/pages/index.md': '',
    'src/content/pages/about.md': '',
    'src/content/pages/contact.md': '',
  },
  'example.com',
);
assertEqual(fallback.includes('https://example.com/'), true, 'fallback home');
assertEqual(fallback.includes('https://example.com/privacy/'), true, 'fallback privacy');
assertEqual(fallback.length, 4, 'fallback 3 pages + privacy');

const urlset = parseSitemapLocs(`<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/privacy/</loc></url>
</urlset>`);
assertEqual(urlset.isIndex, false, 'urlset not index');
assertEqual(urlset.locs.length, 2, 'urlset locs');

const indexXml = parseSitemapLocs(`<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-0.xml</loc></sitemap>
</sitemapindex>`);
assertEqual(indexXml.isIndex, true, 'sitemapindex');
assertEqual(indexXml.locs[0], 'https://example.com/sitemap-0.xml', 'child sitemap loc');

const filtered = filterSitemapPageUrls(
  ['https://example.com/', 'https://example.com/sitemap-0.xml', 'https://other.com/x/', 'not-a-url'],
  'example.com',
);
assertEqual(filtered.join(','), 'https://example.com/', 'filter same-host pages');

assert(isInspectIndexed({ inspectionResult: { indexStatusResult: { verdict: 'PASS' } } }), 'PASS indexed');
assert(
  isInspectIndexed({
    inspectionResult: { indexStatusResult: { coverageState: 'Submitted and indexed' } },
  }),
  'coverage indexed',
);
assert(
  !isInspectIndexed({
    inspectionResult: { indexStatusResult: { coverageState: 'Crawled - currently not indexed' } },
  }),
  'not indexed coverage',
);
assert(!isInspectIndexed({ inspectionResult: { indexStatusResult: { verdict: 'FAIL' } } }), 'FAIL not indexed');

const now = Date.parse('2026-09-11T12:00:00.000Z');
assert(
  shouldReuseCachedPass({ indexed: true, inspectedAt: '2026-09-10T12:00:00.000Z' }, now),
  'recent PASS cached',
);
assert(
  !shouldReuseCachedPass({ indexed: true, inspectedAt: '2026-09-01T12:00:00.000Z' }, now),
  'stale PASS reinspect',
);
assert(
  !shouldReuseCachedPass({ indexed: false, inspectedAt: '2026-09-10T12:00:00.000Z' }, now),
  'FAIL always reinspect',
);

const emptyRollup = rollupInspectByUrl({}, []);
assertEqual(emptyRollup.inspectIndexed, 0, 'empty inspect indexed');
assertEqual(emptyRollup.inspectSubmitted, 0, 'empty inspect submitted');

const rollup = rollupInspectByUrl(
  {
    'https://example.com/': { indexed: true },
    'https://example.com/privacy/': { indexed: false },
    'https://example.com/gone/': { indexed: true },
  },
  ['https://example.com/', 'https://example.com/about/', 'https://example.com/privacy/'],
);
assertEqual(rollup.inspectIndexed, 1, 'rollup indexed only sitemap URLs');
assertEqual(rollup.inspectSubmitted, 3, 'rollup submitted');
assertEqual(rollup.inspectNotIndexed, 2, 'rollup not indexed');

assert(
  isRetryableInspectError({
    status: 500,
    message: 'Internal error encountered. (INTERNAL)',
    details: { error: { status: 'INTERNAL', message: 'Internal error encountered.' } },
  }),
  'INTERNAL 500 retryable',
);
assert(isRetryableInspectError({ status: 429 }), '429 retryable');
assert(isRetryableInspectError({ status: 503 }), '503 retryable');
assert(
  isRetryableInspectError({ message: 'Internal error encountered. (INTERNAL)' }),
  'INTERNAL in message retryable',
);
assert(!isRetryableInspectError({ status: 400, message: 'Bad Request' }), '400 not retryable');
assert(!isRetryableInspectError({ status: 403, details: { error: { status: 'PERMISSION_DENIED' } } }), '403 not retryable');
assert(!isRetryableInspectError({ code: 'GSC_AUTH_REVOKED', status: 401 }), 'auth revoked not retryable');

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
