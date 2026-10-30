/**
 * Assembled public/images must stay under the Workers Free static-file cap.
 * Run: node scripts/test-prune-public-images.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyTreeSkippingGaps, shouldSkipTemplatePublicImage } from '../ops/lib/assemble-site.mjs';
import {
  distExceedsWorkersFreeLimit,
  pruneUnreferencedPublicImages,
  WORKERS_FREE_STATIC_FILE_LIMIT,
} from '../ops/lib/prune-public-images.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

const tmp = path.join(os.tmpdir(), `rover-prune-images-${Date.now()}`);
const site = path.join(tmp, 'site');
const templateImages = path.join(tmp, 'template-images');

mkdirSync(path.join(site, 'src', 'content', 'pages'), { recursive: true });
mkdirSync(path.join(site, 'src', 'pages'), { recursive: true });
mkdirSync(path.join(site, 'public', 'images', 'review-avatars'), { recursive: true });
mkdirSync(templateImages, { recursive: true });

writeFileSync(
  path.join(site, 'src', 'content', 'pages', 'index.md'),
  [
    '---',
    'heroImage:',
    '  src: "/images/keep-a.jpg?v=1"',
    '  alt: "Keep A"',
    'gallery:',
    '  - src: "/images/keep-b.png"',
    '    alt: "Keep B"',
    '  - src: "/images/seed.jpg"',
    '    alt: "Seed"',
    '---',
    '',
  ].join('\n'),
);
writeFileSync(
  path.join(site, 'src', 'pages', 'index.astro'),
  "const fallback = '/images/coverage-map.svg';\n",
);
writeFileSync(path.join(site, 'public', 'images', 'keep-a.jpg'), 'site-bytes');
writeFileSync(path.join(site, 'public', 'images', 'keep-b.png'), 'b');
writeFileSync(path.join(site, 'public', 'images', 'stranger.jpg'), 'nope');
writeFileSync(path.join(site, 'public', 'images', 'leftover'), '');
writeFileSync(path.join(site, 'public', 'images', 'review-avatars', 'm01.jpg'), 'avatar');
writeFileSync(path.join(templateImages, 'keep-a.jpg'), 'template-bytes');
writeFileSync(path.join(templateImages, 'seed.jpg'), 'seed');
writeFileSync(path.join(templateImages, 'coverage-map.svg'), '<svg/>');

const pruned = pruneUnreferencedPublicImages(site, { templateImagesDir: templateImages });
assert(existsSync(path.join(site, 'public', 'images', 'keep-a.jpg')), 'keeps referenced jpg');
assert(
  readFileSync(path.join(site, 'public', 'images', 'keep-a.jpg'), 'utf8') === 'site-bytes',
  'does not overwrite an image already on the site',
);
assert(existsSync(path.join(site, 'public', 'images', 'keep-b.png')), 'keeps referenced png');
assert(existsSync(path.join(site, 'public', 'images', 'seed.jpg')), 'backfills a content image from the template');
assert(
  existsSync(path.join(site, 'public', 'images', 'review-avatars', 'm01.jpg')),
  'keeps review avatars',
);
assert(!existsSync(path.join(site, 'public', 'images', 'stranger.jpg')), 'deletes unreferenced image');
assert(!existsSync(path.join(site, 'public', 'images', 'leftover')), 'deletes extensionless leftover');
assert(
  !existsSync(path.join(site, 'public', 'images', 'coverage-map.svg')),
  'does not backfill a component fallback from another candidate cache',
);
assert(pruned.removed === 2, `removed stranger and leftover (got ${pruned.removed})`);
assert(pruned.kept === 4, `kept two refs, seed, and avatar (got ${pruned.kept})`);
assert(pruned.backfilled.length === 1 && pruned.backfilled[0] === 'seed.jpg', 'backfill list is the seed only');

assert(shouldSkipTemplatePublicImage('loose.jpg', 'public/images'), 'skip loose template image');
assert(
  shouldSkipTemplatePublicImage('x.jpg', 'public/images/ba-clean'),
  'skip nested loose template image',
);
assert(
  !shouldSkipTemplatePublicImage('review-avatars', 'public/images'),
  'copy review-avatars directory',
);
assert(
  !shouldSkipTemplatePublicImage('m01.jpg', 'public/images/review-avatars'),
  'copy files inside review-avatars',
);
assert(!shouldSkipTemplatePublicImage('favicon.svg', 'public'), 'copy other public files');

const tpl = path.join(tmp, 'tpl');
const dest = path.join(tmp, 'dest');
mkdirSync(path.join(tpl, 'public', 'images', 'review-avatars'), { recursive: true });
writeFileSync(path.join(tpl, 'public', 'images', 'loose.jpg'), 'loose');
writeFileSync(path.join(tpl, 'public', 'images', 'review-avatars', 'm01.jpg'), 'avatar');
writeFileSync(path.join(tpl, 'public', 'favicon.svg'), '<svg/>');
copyTreeSkippingGaps(tpl, dest, {
  skipName: (name, rel) => shouldSkipTemplatePublicImage(name, rel),
});
assert(!existsSync(path.join(dest, 'public', 'images', 'loose.jpg')), 'template copy leaves loose image behind');
assert(
  existsSync(path.join(dest, 'public', 'images', 'review-avatars', 'm01.jpg')),
  'template copy keeps review avatars',
);
assert(existsSync(path.join(dest, 'public', 'favicon.svg')), 'template copy keeps favicon');

assert(!distExceedsWorkersFreeLimit(WORKERS_FREE_STATIC_FILE_LIMIT - 1), '19999 files can deploy');
assert(distExceedsWorkersFreeLimit(WORKERS_FREE_STATIC_FILE_LIMIT), '20000 files are over the free limit');

rmSync(tmp, { recursive: true, force: true });
console.log('test-prune-public-images: ok');
