/**
 * One-shot: crop Rover artboard into 6 transparent brand PNGs.
 * Run: node scripts/crop-rover-brand.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC =
  process.env.ROVER_BRAND_SRC ||
  path.join(
    process.env.USERPROFILE || '',
    '.cursor/projects/c-Repos-Rover/assets/c__Users_pault_AppData_Roaming_Cursor_User_workspaceStorage_ea342c6277a9e84d5977fe2f5d07bee2_images_Artboard_1_4x-aab71e9d-566f-430d-8312-2a4bb349a41b.png',
  );
const OUT = path.join(ROOT, 'ops/public/brand');

/** Near-black artboard / JPEG gray smear — keeps navy ink and white/blue marks. */
function isBg(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  // Flat gray/black (JPEG noise), not colored ink
  if (max - min <= 12 && max <= 72) return true;
  return false;
}

function bboxFromRgba(data, width, height, x0, y0, x1, y1) {
  let minX = x1;
  let minY = y1;
  let maxX = x0;
  let maxY = y0;
  let found = false;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a < 8) continue;
      found = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!found) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Split content into left icon cluster and right wordmark via largest horizontal gap. */
function splitIconAndWordmark(data, width, height, box) {
  const colHas = new Array(box.width).fill(false);
  for (let y = box.top; y < box.top + box.height; y += 1) {
    for (let x = box.left; x < box.left + box.width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i + 3] >= 8) colHas[x - box.left] = true;
    }
  }
  let bestGap = 0;
  let gapStart = -1;
  let gapEnd = -1;
  let i = 0;
  while (i < colHas.length) {
    if (!colHas[i]) {
      const start = i;
      while (i < colHas.length && !colHas[i]) i += 1;
      const len = i - start;
      if (len > bestGap) {
        bestGap = len;
        gapStart = start;
        gapEnd = i;
      }
    } else i += 1;
  }
  if (bestGap < 8 || gapStart < 0) {
    // Fallback: icon is leftmost ~square portion of content height
    const iconW = Math.min(box.height + 20, Math.floor(box.width * 0.35));
    return {
      icon: { left: box.left, top: box.top, width: iconW, height: box.height },
      word: {
        left: box.left + iconW,
        top: box.top,
        width: box.width - iconW,
        height: box.height,
      },
    };
  }
  const splitX = box.left + Math.floor((gapStart + gapEnd) / 2);
  const iconBox = bboxFromRgba(data, width, height, box.left, box.top, splitX, box.top + box.height);
  const wordBox = bboxFromRgba(
    data,
    width,
    height,
    splitX,
    box.top,
    box.left + box.width,
    box.top + box.height,
  );
  return { icon: iconBox, word: wordBox };
}

async function knockOutBlackToRgba(inputPath) {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (isBg(r, g, b)) data[i + 3] = 0;
  }
  return { data, width, height };
}

async function writeCrop(data, width, height, box, outPath, { maxWidth, square }) {
  if (!box || box.width < 1 || box.height < 1) {
    throw new Error(`No content for ${outPath}: ${JSON.stringify(box)}`);
  }
  const pad = 4;
  const left = Math.max(0, box.left - pad);
  const top = Math.max(0, box.top - pad);
  const right = Math.min(width, box.left + box.width + pad);
  const bottom = Math.min(height, box.top + box.height + pad);
  const w = right - left;
  const h = bottom - top;
  if (w < 1 || h < 1 || left + w > width || top + h > height) {
    throw new Error(`Bad extract ${outPath}: ${JSON.stringify({ left, top, w, h, width, height })}`);
  }

  let buf = await sharp(data, { raw: { width, height, channels: 4 } })
    .extract({ left, top, width: w, height: h })
    .png()
    .toBuffer();

  // Trim transparent margins
  buf = await sharp(buf).trim({ threshold: 1 }).png().toBuffer();

  if (square) {
    buf = await sharp(buf)
      .resize(256, 256, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  } else if (maxWidth) {
    buf = await sharp(buf)
      .resize({ width: maxWidth, withoutEnlargement: true, fit: 'inside' })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  } else {
    buf = await sharp(buf).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  }

  fs.writeFileSync(outPath, buf);
  console.log(`wrote ${path.relative(ROOT, outPath)} (${Math.round(buf.length / 1024)} KB)`);
}

async function main() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`Source not found: ${SRC}`);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const { data, width, height } = await knockOutBlackToRgba(SRC);
  const mid = Math.floor(height / 2);

  const topBox = bboxFromRgba(data, width, height, 0, 0, width, mid);
  const botBox = bboxFromRgba(data, width, height, 0, mid, width, height);
  if (!topBox || !botBox) throw new Error('Could not find top/bottom content');

  const topSplit = splitIconAndWordmark(data, width, height, topBox);
  const botSplit = splitIconAndWordmark(data, width, height, botBox);

  await writeCrop(data, width, height, topBox, path.join(OUT, 'rover-logo-light.png'), {
    maxWidth: 800,
  });
  await writeCrop(data, width, height, botBox, path.join(OUT, 'rover-logo-dark.png'), {
    maxWidth: 800,
  });
  await writeCrop(data, width, height, topSplit.icon, path.join(OUT, 'rover-icon-light.png'), {
    square: true,
  });
  await writeCrop(data, width, height, botSplit.icon, path.join(OUT, 'rover-icon-dark.png'), {
    square: true,
  });
  await writeCrop(data, width, height, topSplit.word, path.join(OUT, 'rover-wordmark-light.png'), {
    maxWidth: 640,
  });
  await writeCrop(data, width, height, botSplit.word, path.join(OUT, 'rover-wordmark-dark.png'), {
    maxWidth: 640,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
