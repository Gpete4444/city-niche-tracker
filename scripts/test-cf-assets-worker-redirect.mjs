/**
 * Assets worker URL policy: one 301 to HTTPS apex with a trailing slash.
 * Run: node scripts/test-cf-assets-worker-redirect.mjs
 */
import { canonicalRedirectTarget } from '../src/cf-assets-worker.js';

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

assertEqual(
  canonicalRedirectTarget('http://www.example.com/about'),
  'https://example.com/about/',
  'http www slashless combines into one hop',
);
assertEqual(
  canonicalRedirectTarget('https://www.example.com/about/'),
  'https://example.com/about/',
  'www already slashed',
);
assertEqual(
  canonicalRedirectTarget('http://example.com/'),
  'https://example.com/',
  'http homepage',
);
assertEqual(
  canonicalRedirectTarget('https://example.com/about'),
  'https://example.com/about/',
  'slashless apex',
);
assertEqual(
  canonicalRedirectTarget('https://www.example.com/sitemap.xml'),
  'https://example.com/sitemap.xml',
  'www file keeps the filename',
);
assertEqual(
  canonicalRedirectTarget('https://example.com/about/?q=1'),
  null,
  'canonical page stays',
);
assertEqual(
  canonicalRedirectTarget('https://www.example.com/about?q=1'),
  'https://example.com/about/?q=1',
  'query survives the combined redirect',
);
assertEqual(
  canonicalRedirectTarget('https://site.workers.dev/about'),
  'https://site.workers.dev/about/',
  'workers.dev host is not treated as www',
);

console.log('test-cf-assets-worker-redirect: ok');
