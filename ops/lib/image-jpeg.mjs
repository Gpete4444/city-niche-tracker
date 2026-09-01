/**
 * Compress generated photos at write time. Astro copies public/images as-is.
 */
import sharp from 'sharp';

const LONG_EDGE = 1024;
const JPEG_QUALITY = 80;

/**
 * @param {Buffer} buffer
 * @param {{ longEdge?: number, quality?: number }} [opts]
 * @returns {Promise<Buffer>}
 */
export async function compressSiteJpeg(buffer, opts = {}) {
  const longEdge = Number(opts.longEdge) > 0 ? Number(opts.longEdge) : LONG_EDGE;
  const quality = Number(opts.quality) > 0 ? Number(opts.quality) : JPEG_QUALITY;
  if (!buffer?.length) {
    throw Object.assign(new Error('Empty image buffer'), { status: 400 });
  }
  return sharp(buffer)
    .rotate()
    .resize({
      width: longEdge,
      height: longEdge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}
