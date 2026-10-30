/**
 * Logos request a transparent PNG from gpt-image-2.5-flare.
 * Photo generates stay on gpt-image-2 with no background field.
 * Run: node scripts/test-logo-image-model.mjs
 */
import {
  OPENAI_IMAGE_MODEL,
  OPENAI_LOGO_IMAGE_MODEL,
  logoOpenaiImageRequest,
  openaiGenerateBody,
} from '../ops/lib/image-providers/openai-image.mjs';

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

const logo = openaiGenerateBody(logoOpenaiImageRequest('flat mark'));
assertEqual(logo.model, OPENAI_LOGO_IMAGE_MODEL, 'logo model');
assertEqual(logo.model, 'gpt-image-2.5-flare', 'logo model id');
assertEqual(logo.background, 'transparent', 'logo background');
assertEqual(logo.output_format, 'png', 'logo format');
assertEqual(logo.size, '1024x1024', 'logo size');
assertEqual(logo.quality, 'medium', 'logo quality');

const photo = openaiGenerateBody({ prompt: 'a kitchen' });
assertEqual(photo.model, OPENAI_IMAGE_MODEL, 'photo model');
assertEqual(photo.model, 'gpt-image-2', 'photo model id');
assert(!Object.hasOwn(photo, 'background'), 'photo has no background field');
assert(!Object.hasOwn(photo, 'output_format'), 'photo has no output format');

console.log('test-logo-image-model: ok');
