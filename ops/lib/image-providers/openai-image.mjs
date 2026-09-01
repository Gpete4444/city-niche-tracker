/**
 * GPT Image 2 (OpenAI) for BA pairs and per-slot OpenAI generate. Same OPENAI_API_KEY as Phone.
 */
import { compressSiteJpeg } from '../image-jpeg.mjs';

export const OPENAI_IMAGE_MODEL = 'gpt-image-2';
export const OPENAI_IMAGE_QUALITY = 'medium';
export const OPENAI_IMAGE_SIZE = '1536x1024';

/** Medium 1536×1024 generate + edit ≈ $0.041 + $0.049. */
export const OPENAI_IMAGE_COST = {
  generate: 0.041,
  edit: 0.049,
  pair: 0.09,
};

const GEN_URL = 'https://api.openai.com/v1/images/generations';
const EDIT_URL = 'https://api.openai.com/v1/images/edits';
const REQUEST_MS = 180_000;

export function openaiImageKeySet() {
  return Boolean(String(process.env.OPENAI_API_KEY || '').trim());
}

function openaiKey() {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) {
    throw Object.assign(
      new Error(
        'Set OPENAI_API_KEY in .env (same key as Phone), then restart Rover.',
      ),
      { status: 400, code: 'openai-unconfigured' },
    );
  }
  return key;
}

function openaiError(status, json, rawText = '') {
  const msg =
    json?.error?.message ||
    json?.message ||
    (rawText && String(rawText).slice(0, 240)) ||
    `OpenAI images failed (${status})`;
  return Object.assign(new Error(msg), { status: status || 400, code: 'openai-image' });
}

async function decodeImagePayload(json) {
  const item = Array.isArray(json?.data) ? json.data[0] : json?.data;
  const b64 = item?.b64_json || json?.b64_json;
  if (b64) return Buffer.from(b64, 'base64');
  const url = item?.url || json?.url;
  if (url) {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`OpenAI image download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw Object.assign(new Error('OpenAI images returned no image data'), {
    status: 502,
    code: 'openai-image',
  });
}

async function parseOpenaiResponse(res) {
  const rawText = await res.text();
  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw openaiError(res.status, {}, rawText);
  }
  if (!res.ok) throw openaiError(res.status, json, rawText);
  return json;
}

function imageBlob(buffer) {
  const bytes = Uint8Array.from(buffer);
  if (typeof File === 'function') {
    return new File([bytes], 'before.jpg', { type: 'image/jpeg' });
  }
  return new Blob([bytes], { type: 'image/jpeg' });
}

/**
 * @param {{
 *   prompt: string,
 *   size?: string,
 *   quality?: string,
 *   background?: string,
 *   outputFormat?: string,
 *   compress?: boolean,
 * }} opts
 * @returns {Promise<{ buffer: Buffer, provider: 'openai' }>}
 */
export async function generateOpenaiImage({
  prompt,
  size = OPENAI_IMAGE_SIZE,
  quality = OPENAI_IMAGE_QUALITY,
  background,
  outputFormat,
  compress = true,
} = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw Object.assign(new Error('prompt required'), { status: 400 });
  const key = openaiKey();
  const body = {
    model: OPENAI_IMAGE_MODEL,
    prompt: text,
    quality,
    size,
    n: 1,
  };
  if (background) body.background = background;
  if (outputFormat) body.output_format = outputFormat;
  const res = await fetch(GEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_MS),
  });
  const json = await parseOpenaiResponse(res);
  const raw = await decodeImagePayload(json);
  if (compress === false) return { buffer: raw, provider: 'openai' };
  return { buffer: await compressSiteJpeg(raw), provider: 'openai' };
}

/**
 * @param {{ prompt: string, imageBuffer: Buffer }} opts
 * @returns {Promise<{ buffer: Buffer, provider: 'openai' }>}
 */
export async function editOpenaiImage({ prompt, imageBuffer } = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw Object.assign(new Error('prompt required'), { status: 400 });
  if (!imageBuffer?.length) throw Object.assign(new Error('imageBuffer required'), { status: 400 });
  const key = openaiKey();
  const form = new FormData();
  form.append('model', OPENAI_IMAGE_MODEL);
  form.append('prompt', text);
  form.append('quality', OPENAI_IMAGE_QUALITY);
  form.append('size', OPENAI_IMAGE_SIZE);
  form.append('n', '1');
  form.append('image', imageBlob(imageBuffer), 'before.jpg');
  const res = await fetch(EDIT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(REQUEST_MS),
  });
  const json = await parseOpenaiResponse(res);
  const raw = await decodeImagePayload(json);
  return { buffer: await compressSiteJpeg(raw), provider: 'openai' };
}
