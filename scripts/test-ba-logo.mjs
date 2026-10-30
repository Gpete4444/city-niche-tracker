/**
 * Before/after logo stamp: clean copy, restore, no double logo.
 * Automatic stamp skips a launched site. Add logo stamps it from the clean photo.
 * Run: node scripts/test-ba-logo.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { pathsFor } from '../ops/lib/candidates.mjs';
import {
  BA_LOGO_PLATE,
  baLogoCleanDir,
  compositeBaLogo,
  ensureBaLogo,
  forgetBaLogoFiles,
  readBaLogoState,
  setBaLogo,
} from '../ops/lib/ba-logo.mjs';

const id = 'zz-ba-logo-test';
const publicNames = [
  'logo.png',
  'gallery-ba-1-before.png',
  'gallery-ba-1-after.png',
  'gallery-ba-2-before.png',
  'svc-ba-pet-turf-1-before.png',
];

function assert(cond, label) {
  if (!cond) throw new Error(label);
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

async function plateFillPixel(stampedBuf, originalBuf, photo) {
  const stamped = await sharp(stampedBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const original = await sharp(originalBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = stamped.info;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const at = (x, y) => {
    const i = (y * width + x) * channels;
    return [stamped.data[i], stamped.data[i + 1], stamped.data[i + 2]];
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      const orig = [original.data[i], original.data[i + 1], original.data[i + 2]];
      if (orig[0] !== photo[0] || orig[1] !== photo[1] || orig[2] !== photo[2]) continue;
      const px = at(x, y);
      if (px[0] === orig[0] && px[1] === orig[1] && px[2] === orig[2]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (minX >= maxX || minY >= maxY) return null;
  const white = [255, 255, 255];
  let px = null;
  for (let step = 1; step < 12; step += 1) {
    const candidate = at(Math.min(width - 1, minX + step), Math.min(height - 1, minY + step));
    if (dist(candidate, white) < dist(candidate, photo)) {
      px = candidate;
      break;
    }
  }
  if (!px) return null;
  return { px, distPhoto: dist(px, photo), distWhite: dist(px, white) };
}

async function plateRim(stampedBuf, originalBuf, photo, ink) {
  const stamped = await sharp(stampedBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const original = await sharp(originalBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = stamped.info;
  let plate = null;
  let mark = null;
  const grow = (box, x, y) =>
    box
      ? {
          minX: Math.min(box.minX, x),
          minY: Math.min(box.minY, y),
          maxX: Math.max(box.maxX, x),
          maxY: Math.max(box.maxY, y),
        }
      : { minX: x, minY: y, maxX: x, maxY: y };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      const orig = [original.data[i], original.data[i + 1], original.data[i + 2]];
      if (orig[0] !== photo[0] || orig[1] !== photo[1] || orig[2] !== photo[2]) continue;
      const px = [stamped.data[i], stamped.data[i + 1], stamped.data[i + 2]];
      if (px[0] === orig[0] && px[1] === orig[1] && px[2] === orig[2]) continue;
      plate = grow(plate, x, y);
      if (dist(px, ink) < dist(px, [255, 255, 255]) && dist(px, ink) < dist(px, photo)) {
        mark = grow(mark, x, y);
      }
    }
  }
  if (!plate || !mark) return null;
  return {
    extraW: plate.maxX - plate.minX - (mark.maxX - mark.minX),
    extraH: plate.maxY - plate.minY - (mark.maxY - mark.minY),
  };
}

async function solidPng(color, width = 320, height = 200) {
  return sharp({
    create: { width, height, channels: 3, background: color },
  })
    .png()
    .toBuffer();
}

function snapshotPublic() {
  const dir = path.join(process.cwd(), 'public', 'images');
  const snap = new Map();
  for (const name of publicNames) {
    const file = path.join(dir, name);
    snap.set(file, existsSync(file) ? readFileSync(file) : null);
  }
  return () => {
    for (const [file, buf] of snap) {
      if (buf) writeFileSync(file, buf);
      else if (existsSync(file)) unlinkSync(file);
    }
  };
}

async function main() {
  const restorePublic = snapshotPublic();
  const paths = pathsFor(id);
  try {
    const logo = await sharp({
      create: {
        width: 48,
        height: 48,
        channels: 4,
        background: { r: 12, g: 28, b: 90, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const photo = { r: 20, g: 140, b: 50 };
    const original = await solidPng(photo);
    const once = await compositeBaLogo(original, logo, { filename: 'gallery-ba-1-before.png' });
    const twice = await compositeBaLogo(original, logo, { filename: 'gallery-ba-1-before.png' });
    assert(once.equals(twice), 'second composite of the clean photo matches the first');
    assert(!once.equals(original), 'stamp changes the photo');
    const plate = await plateFillPixel(once, original, [photo.r, photo.g, photo.b]);
    assert(plate, 'found a plate pixel outside the mark');
    assert(
      plate.distWhite < plate.distPhoto,
      `plate is the previous near-white level (${plate.px.join(',')})`,
    );
    const stacked = await compositeBaLogo(once, logo, { filename: 'gallery-ba-1-before.png' });
    assert(!stacked.equals(once), 'stamping a stamped photo would stack a second logo');
    const ink = { r: 12, g: 28, b: 90, alpha: 1 };
    const mark = await sharp({
      create: { width: 24, height: 24, channels: 4, background: ink },
    })
      .png()
      .toBuffer();
    const paddedLogo = await sharp({
      create: { width: 120, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: mark, left: 48, top: 48 }])
      .png()
      .toBuffer();
    const hugged = await compositeBaLogo(original, paddedLogo, { filename: 'gallery-ba-1-before.png' });
    const rim = await plateRim(hugged, original, [photo.r, photo.g, photo.b], [ink.r, ink.g, ink.b]);
    assert(rim, 'padded logo still produces a plate and a mark');
    assert(rim.extraW <= 18 && rim.extraH <= 18, `box hugs the mark (${rim.extraW}x${rim.extraH})`);
    assert(rim.extraW >= 2 && rim.extraH >= 2, 'box keeps a slim rim');

    rmSync(path.join(paths.siteImages, '..'), { recursive: true, force: true });
    for (const file of [paths.meta, paths.imagesManifest]) {
      if (existsSync(file)) unlinkSync(file);
    }
    mkdirSync(paths.siteImages, { recursive: true });
    writeFileSync(paths.meta, `${JSON.stringify({ id })}\n`);
    const beforeName = 'gallery-ba-1-before.png';
    const afterName = 'gallery-ba-1-after.png';
    const svcName = 'svc-ba-pet-turf-1-before.png';
    const beforePath = path.join(paths.siteImages, beforeName);
    const afterPath = path.join(paths.siteImages, afterName);
    const svcPath = path.join(paths.siteImages, svcName);
    writeFileSync(beforePath, original);
    writeFileSync(afterPath, await solidPng({ r: 40, g: 70, b: 160 }));
    writeFileSync(svcPath, await solidPng({ r: 180, g: 90, b: 40 }));

    const bare = await ensureBaLogo(id, { sync: false });
    assert(bare.skipped === 'no-logo', 'no logo means no stamp');
    assert(readFileSync(beforePath).equals(original), 'photo stays clean when there is no logo');
    assert(!existsSync(path.join(baLogoCleanDir(id), beforeName)), 'no clean copy without a logo');

    writeFileSync(path.join(paths.siteImages, 'logo.png'), logo);
    const stamped = await ensureBaLogo(id, { sync: false });
    assert(stamped.enabled === true, 'stamp is on by default');
    assert(stamped.changed >= 1, 'first stamp writes the live files');
    const stampedBefore = readFileSync(beforePath);
    const cleanBefore = readFileSync(path.join(baLogoCleanDir(id), beforeName));
    assert(cleanBefore.equals(original), 'clean copy is the original photo');
    assert(stampedBefore.equals(once), 'live file is the single stamp');
    assert(!readFileSync(afterPath).equals(await solidPng({ r: 40, g: 70, b: 160 })), 'after photo is stamped');
    assert(
      !readFileSync(svcPath).equals(await solidPng({ r: 180, g: 90, b: 40 })),
      'service before/after photo is stamped',
    );

    const again = await ensureBaLogo(id, { sync: false });
    assert(again.changed === 0, 'second stamp does not rewrite files');
    assert(readFileSync(beforePath).equals(stampedBefore), 'second ensure matches the first stamp');

    const oldPlate = JSON.parse(readFileSync(paths.imagesManifest, 'utf8'));
    oldPlate.baLogoPlate = 1;
    writeFileSync(paths.imagesManifest, `${JSON.stringify(oldPlate, null, 2)}\n`);
    writeFileSync(beforePath, original);
    const rebuilt = await ensureBaLogo(id, { sync: false });
    assert(rebuilt.changed >= 1, 'old plate version rebuilds from the clean file');
    assert(readFileSync(beforePath).equals(stampedBefore), 'rebuild matches the current stamp');
    assert(readFileSync(path.join(baLogoCleanDir(id), beforeName)).equals(original), 'rebuild keeps the clean copy');
    const plateNow = JSON.parse(readFileSync(paths.imagesManifest, 'utf8'));
    assert(plateNow.baLogoPlate === BA_LOGO_PLATE, 'plate version is current');

    const manifest = JSON.parse(readFileSync(paths.imagesManifest, 'utf8'));
    manifest.baLogoStamped = [];
    writeFileSync(paths.imagesManifest, `${JSON.stringify(manifest, null, 2)}\n`);
    await ensureBaLogo(id, { sync: false });
    assert(readFileSync(beforePath).equals(stampedBefore), 'stamping from the clean copy does not stack a logo');

    const removed = await setBaLogo(id, false, { sync: false });
    assert(removed.enabled === false, 'remove turns the stamp off');
    assert(readFileSync(beforePath).equals(original), 'remove restores the clean photo');

    const added = await setBaLogo(id, true, { sync: false });
    assert(added.enabled === true, 'add turns the stamp on');
    assert(readFileSync(beforePath).equals(stampedBefore), 'add matches the first stamp');
    const addedAgain = await setBaLogo(id, true, { sync: false });
    assert(addedAgain.changed === 0, 'second add does not rewrite');
    assert(readFileSync(beforePath).equals(stampedBefore), 'second add matches the first stamp');

    const replacement = await solidPng({ r: 200, g: 30, b: 30 });
    forgetBaLogoFiles(id, [beforeName]);
    writeFileSync(beforePath, replacement);
    const restamped = await ensureBaLogo(id, { sync: false });
    assert(restamped.changed >= 1, 'a replaced photo is stamped from the new file');
    const replacementStamp = await compositeBaLogo(replacement, logo, { filename: beforeName });
    assert(readFileSync(beforePath).equals(replacementStamp), 'replaced photo gets one logo');
    assert(
      readFileSync(path.join(baLogoCleanDir(id), beforeName)).equals(replacement),
      'clean copy follows the replaced photo',
    );

    const launchedName = 'gallery-ba-2-before.png';
    const launchedPath = path.join(paths.siteImages, launchedName);
    const launchedOriginal = await solidPng({ r: 10, g: 10, b: 10 });
    writeFileSync(paths.meta, `${JSON.stringify({ id, lastLaunchAt: '2020-01-01T00:00:00.000Z' })}\n`);
    writeFileSync(launchedPath, launchedOriginal);
    const beforeLaunchBytes = readFileSync(beforePath);
    const launched = await ensureBaLogo(id, { sync: false });
    assert(launched.skipped === 'launched', 'launched candidate is skipped');
    assert(readBaLogoState(id).launched === true, 'launched state is reported');
    assert(readFileSync(launchedPath).equals(launchedOriginal), 'launched photo is not stamped');
    assert(!existsSync(path.join(baLogoCleanDir(id), launchedName)), 'launched photo gets no clean copy');
    assert(readFileSync(beforePath).equals(beforeLaunchBytes), 'launched ensure does not restamp existing photos');
    const addedOnLaunch = await setBaLogo(id, true, { sync: false });
    assert(addedOnLaunch.enabled === true, 'add logo works on a launched site');
    const launchedStamp = await compositeBaLogo(launchedOriginal, logo, { filename: launchedName });
    assert(readFileSync(launchedPath).equals(launchedStamp), 'add logo stamps the launched photo once');
    assert(
      readFileSync(path.join(baLogoCleanDir(id), launchedName)).equals(launchedOriginal),
      'launched add keeps the clean photo',
    );

    console.log('ba logo ok');
  } finally {
    restorePublic();
    rmSync(path.dirname(paths.siteImages), { recursive: true, force: true });
    for (const file of [paths.meta, paths.imagesManifest]) {
      if (existsSync(file)) unlinkSync(file);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
