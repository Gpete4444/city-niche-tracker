/**
 * Assemble must skip unreadable public/images paths (missing BA tray).
 * Photo-group BA tray rows require both copies on disk.
 * Run: node scripts/test-copy-tree-missing.mjs
 */
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyTreeSkippingGaps, safeStat } from '../ops/lib/assemble-site.mjs';
import { baEntryFilesOnDisk, compactBaTray } from '../ops/lib/image-tray.mjs';
import { baTrayEntryFromCopies } from '../ops/lib/photo-groups.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const missingAbs = path.join(os.tmpdir(), `rover-missing-ba-${Date.now()}`, 'nope.jpg');
assert(safeStat(missingAbs) === null, 'safeStat missing path is null');
assert(safeStat('') === null, 'safeStat empty is null');

const tmpRoot = path.join(os.tmpdir(), `rover-copy-gaps-${Date.now()}`);
const src = path.join(tmpRoot, 'src');
const dest = path.join(tmpRoot, 'dest');
const images = path.join(src, 'public', 'images');
mkdirSync(images, { recursive: true });
writeFileSync(path.join(images, 'keep.jpg'), PIXEL);
writeFileSync(path.join(src, 'good.txt'), 'ok\n');

const danglingName = 'svc-ba-commercial-concrete-lifting-pg3-after.jpg';
let madeDangling = false;
try {
  symlinkSync(path.join(images, 'does-not-exist-target.jpg'), path.join(images, danglingName));
  madeDangling = safeStat(path.join(images, danglingName)) === null;
} catch {
  madeDangling = false;
}

copyTreeSkippingGaps(src, dest);
assert(existsSync(path.join(dest, 'good.txt')), 'copies readable file');
assert(existsSync(path.join(dest, 'public', 'images', 'keep.jpg')), 'copies readable image');
assert(
  !existsSync(path.join(dest, 'public', 'images', danglingName)),
  'does not copy unreadable BA tray path',
);

const siteImages = path.join(tmpRoot, 'site-images');
mkdirSync(siteImages, { recursive: true });
writeFileSync(path.join(siteImages, 'svc-ba-commercial-concrete-lifting-pg1-before.jpg'), PIXEL);
writeFileSync(path.join(siteImages, 'svc-ba-commercial-concrete-lifting-pg1-after.jpg'), PIXEL);
writeFileSync(path.join(siteImages, 'svc-ba-commercial-concrete-lifting-pg3-before.jpg'), PIXEL);

assert(
  baTrayEntryFromCopies(null, 'svc-ba-commercial-concrete-lifting-pg3-after.jpg') === null,
  'failed after-copy is not persisted',
);
assert(
  baTrayEntryFromCopies('svc-ba-commercial-concrete-lifting-pg3-before.jpg', null) === null,
  'failed before-copy is not persisted',
);
assert(
  baTrayEntryFromCopies(
    'svc-ba-commercial-concrete-lifting-pg1-before.jpg',
    'svc-ba-commercial-concrete-lifting-pg1-after.jpg',
    { source: 'photo-group' },
  )?.afterFilename === 'svc-ba-commercial-concrete-lifting-pg1-after.jpg',
  'complete pair is persisted',
);

assert(
  !baEntryFilesOnDisk(siteImages, {
    beforeFilename: 'svc-ba-commercial-concrete-lifting-pg3-before.jpg',
    afterFilename: 'svc-ba-commercial-concrete-lifting-pg3-after.jpg',
  }),
  'pg3-after missing on disk is rejected',
);

const kept = compactBaTray(siteImages, [
  {
    beforeFilename: 'svc-ba-commercial-concrete-lifting-pg1-before.jpg',
    afterFilename: 'svc-ba-commercial-concrete-lifting-pg1-after.jpg',
  },
  {
    beforeFilename: 'svc-ba-commercial-concrete-lifting-pg3-before.jpg',
    afterFilename: 'svc-ba-commercial-concrete-lifting-pg3-after.jpg',
  },
]);
assert(kept.length === 1, 'compactBaTray drops missing pgN-after');
assert(
  kept[0].afterFilename === 'svc-ba-commercial-concrete-lifting-pg1-after.jpg',
  'keeps complete BA tray pair',
);

rmSync(tmpRoot, { recursive: true, force: true });
console.log(
  `test-copy-tree-missing: ok${madeDangling ? ' (dangling symlink skipped)' : ' (safeStat + missing after)'}`,
);
