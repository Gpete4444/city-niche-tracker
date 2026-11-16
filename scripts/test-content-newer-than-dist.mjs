/**
 * A dist without the built CSS bundle must not count as up to date.
 * Run: node scripts/test-content-newer-than-dist.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { contentNewerThanDist, distHasBuiltCss } from '../ops/lib/assembled-preview.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

const root = mkdtempSync(path.join(tmpdir(), 'rover-dist-css-'));
const dist = path.join(root, 'dist');
const astroDir = path.join(dist, '_astro');
const indexPath = path.join(dist, 'index.html');
mkdirSync(astroDir, { recursive: true });

try {
  assert(contentNewerThanDist(root), 'missing index needs a build');

  writeFileSync(
    indexPath,
    '<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Archivo"></head><body>plain</body></html>\n',
    'utf8',
  );
  assert(!distHasBuiltCss(root), 'google fonts alone is not the site bundle');
  assert(contentNewerThanDist(root), 'css-less dist needs a build');

  writeFileSync(
    indexPath,
    '<html><head><link rel="stylesheet" href="/_astro/BaseLayout.abc123.css"></head><body>linked</body></html>\n',
    'utf8',
  );
  assert(!distHasBuiltCss(root), 'a link without the css file is not a built bundle');
  assert(contentNewerThanDist(root), 'missing css file needs a build');

  writeFileSync(path.join(astroDir, 'BaseLayout.abc123.css'), 'body{color:#111}\n', 'utf8');
  assert(distHasBuiltCss(root), 'link plus css file is a built bundle');
  assert(!contentNewerThanDist(root), 'fresh dist with css does not need a rebuild');

  writeFileSync(
    indexPath,
    '<html><head><link href="https://fonts.googleapis.com/css?family=Archivo" rel="stylesheet"></head></html>\n',
    'utf8',
  );
  assert(!distHasBuiltCss(root), 'css file without a homepage link is not enough');
  assert(contentNewerThanDist(root), 'unlinked css still needs a build');

  writeFileSync(
    indexPath,
    '<html><head><link rel="stylesheet" href="/_astro/BaseLayout.abc123.css"></head></html>\n',
    'utf8',
  );
  const contentDir = path.join(root, 'src', 'content');
  mkdirSync(contentDir, { recursive: true });
  const page = path.join(contentDir, 'index.md');
  writeFileSync(page, '# newer\n', 'utf8');
  const future = new Date(Date.now() + 60_000);
  utimesSync(page, future, future);
  assert(contentNewerThanDist(root), 'newer content still needs a build when css is present');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('test-content-newer-than-dist: ok');
