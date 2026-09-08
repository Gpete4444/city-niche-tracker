/**
 * Child process: OpenAI image generate/edit, JPEG compress, persist.
 * Does not import the job queue (parent owns that).
 */
import { generateImageSlotOpenai, generateCandidateBaPairOpenai } from './openai-generate.mjs';
import { generatePhotoGroupSlotOpenai, generatePhotoGroupBaPairOpenai } from './photo-library.mjs';

async function run(payload = {}) {
  const kind = String(payload.kind || '');
  const opts = payload.opts && typeof payload.opts === 'object' ? payload.opts : {};
  if (kind === 'candidate-slot') {
    return generateImageSlotOpenai(payload.candidateId, payload.slotKey, opts);
  }
  if (kind === 'candidate-ba') {
    return generateCandidateBaPairOpenai(payload.candidateId, opts);
  }
  if (kind === 'photo-group-slot') {
    return generatePhotoGroupSlotOpenai(payload.groupId, opts);
  }
  if (kind === 'photo-group-ba') {
    return generatePhotoGroupBaPairOpenai(payload.groupId, opts);
  }
  throw Object.assign(new Error(`Unknown image worker kind: ${kind || '(empty)'}`), { status: 400 });
}

process.on('message', async (msg) => {
  try {
    const result = await run(msg?.payload || {});
    process.send({ ok: true, result });
  } catch (error) {
    process.send({
      ok: false,
      error: {
        message: error?.message ? String(error.message) : String(error),
        status: error?.status || 500,
        code: error?.code || 'openai-worker',
      },
    });
  }
});
