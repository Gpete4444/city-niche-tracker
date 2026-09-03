/**
 * Flux 2 Pro on fal.ai. Hero / gallery / Photo Flux generate only.
 * Before/after pairs and the OpenAI generate button use GPT Image 2, not this module.
 * Not a stock IMAGE_SOURCES provider.
 */

import { compressSiteJpeg } from '../image-jpeg.mjs';
import { openaiImageKeySet } from './openai-image.mjs';

export const FLUX_COST = {
  generate: 0.03,
  edit: 0.045,
};

/** Cannot pay for one fal photo. */
const FAL_GENERATE_MIN = FLUX_COST.generate;

const FAL_GENERATE = 'fal-ai/flux-2-pro';
const FAL_EDIT = 'fal-ai/flux-pro/kontext';
const FAL_QUEUE = 'https://queue.fal.run';

function falKey() {
  return String(process.env.FAL_KEY || process.env.FAL_API_KEY || '').trim();
}

function falAdminKeyConfigured() {
  return Boolean(String(process.env.FAL_ADMIN_KEY || '').trim());
}

function falAdminKey() {
  return String(process.env.FAL_ADMIN_KEY || falKey()).trim();
}

export function fluxStatus() {
  const fal = Boolean(falKey());
  return {
    configured: fal,
    provider: fal ? 'fal' : null,
    falKeySet: fal,
    adminKeySet: falAdminKeyConfigured(),
    openaiKeySet: openaiImageKeySet(),
    cost: FLUX_COST,
  };
}

const FAL_BILLING_URL = 'https://api.fal.ai/v1/account/billing?expand=credits';
const FAL_USAGE_URL = 'https://api.fal.ai/v1/models/usage';
const FAL_BALANCE_TTL_MS = 60_000;
let falBalanceCache = { at: 0, payload: null };

function pickFalBalance(json) {
  const n = Number(
    json?.credits?.current_balance ??
      json?.credits?.balance ??
      json?.current_balance ??
      json?.balance,
  );
  return Number.isFinite(n) ? n : null;
}

function falErrorMessage(json, status) {
  const raw = json?.error?.message || json?.detail || json?.message || json?.error;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw && typeof raw === 'object') {
    const nested = raw.message || raw.msg || raw.detail;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
    try {
      return JSON.stringify(raw).slice(0, 240);
    } catch {
      /* ignore */
    }
  }
  return `fal.ai billing failed (${status})`;
}

async function fetchFalBilling() {
  const key = falAdminKey();
  const res = await fetch(FAL_BILLING_URL, {
    headers: { Authorization: `Key ${key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  const balance = pickFalBalance(json);
  if (res.ok && balance != null) {
    return { balance, currency: json.credits?.currency || json.currency || 'USD' };
  }
  if (!res.ok) {
    const msg = falErrorMessage(json, res.status);
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        falAdminKeyConfigured()
          ? `${msg} This key is API scope. Create an Admin key at fal.ai/dashboard/keys, set FAL_ADMIN_KEY, then restart Rover.`
          : `${msg} Set FAL_ADMIN_KEY in .env (fal dashboard → API keys → Admin), then restart Rover.`,
      );
    }
    throw new Error(msg);
  }
  throw new Error('fal.ai billing returned no credit balance');
}

function sumFalSummaryCost(json) {
  const rows = Array.isArray(json?.summary) ? json.summary : [];
  let total = 0;
  let any = false;
  for (const row of rows) {
    const n = Number(row?.cost_total ?? row?.cost);
    if (!Number.isFinite(n)) continue;
    total += n;
    any = true;
  }
  return any ? total : null;
}

/** All-time spend from 2018-01-01 UTC. Failures return null so remaining still shows. */
async function fetchFalAllTimeSpend() {
  const key = falAdminKey();
  if (!key) return null;
  const url = `${FAL_USAGE_URL}?expand=summary&start=${encodeURIComponent('2018-01-01')}&timezone=UTC`;
  const res = await fetch(url, {
    headers: { Authorization: `Key ${key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const summed = sumFalSummaryCost(json);
  return summed == null ? 0 : summed;
}

let falLockedDepleted = false;

export function invalidateFalBalanceCache() {
  falBalanceCache = { at: 0, payload: null };
}

function falRemainingTooLow(balance) {
  return Number.isFinite(Number(balance)) && Number(balance) + 1e-9 < FAL_GENERATE_MIN;
}

function markFalDepleted() {
  falLockedDepleted = true;
  invalidateFalBalanceCache();
}

function falBalanceMeta(balance = null) {
  return {
    adminKeySet: falAdminKeyConfigured(),
    falKeySet: Boolean(falKey()),
    falDepleted: Boolean(falKey()) && (falLockedDepleted || falRemainingTooLow(balance)),
    provider: fluxStatus().provider,
  };
}

function falEmptyError() {
  return Object.assign(
    new Error(
      'Fal remaining cannot cover this photo. Add fal.ai credits, or use OpenAI generate on the slot.',
    ),
    { status: 400, code: 'flux-exhausted' },
  );
}

/**
 * Refuse fal generate when remaining credits are below this job.
 * API and Admin keys share one fal account wallet.
 * @param {'generate'|'edit'} kind
 */
export async function assertFluxCredits(kind = 'generate') {
  requireConfigured();
  const needed = FLUX_COST[kind] ?? FLUX_COST.generate;
  const bal = await getFalBalance();
  if (!bal.ok || bal.balance == null) return;
  if (Number(bal.balance) + 1e-9 < needed) throw falEmptyError();
}

/**
 * fal.ai remaining credits.
 * @param {{ fresh?: boolean }} [opts]
 */
export async function getFalBalance({ fresh = false } = {}) {
  const fetchedAt = new Date().toISOString();
  if (!falAdminKey()) {
    return {
      ok: false,
      balance: null,
      spentAllTime: null,
      ...falBalanceMeta(null),
      error: 'Set FAL_ADMIN_KEY in .env (fal dashboard → API keys → Admin), then restart Rover.',
      fetchedAt,
    };
  }
  const now = Date.now();
  if (!fresh && falBalanceCache.payload && now - falBalanceCache.at < FAL_BALANCE_TTL_MS) {
    return { ...falBalanceCache.payload, ...falBalanceMeta(falBalanceCache.payload.balance) };
  }
  try {
    const [billing, spentAllTime] = await Promise.all([
      fetchFalBilling(),
      fetchFalAllTimeSpend().catch(() => null),
    ]);
    const payload = {
      ok: true,
      balance: billing.balance,
      spentAllTime,
      currency: billing.currency,
      ...falBalanceMeta(billing.balance),
      error: null,
      fetchedAt,
    };
    falBalanceCache = { at: now, payload };
    return payload;
  } catch (error) {
    const payload = {
      ok: false,
      balance: null,
      spentAllTime: null,
      ...falBalanceMeta(null),
      error: error.message || String(error),
      fetchedAt,
    };
    falBalanceCache = { at: now, payload };
    return payload;
  }
}

function requireConfigured() {
  const status = fluxStatus();
  if (!status.configured) {
    throw Object.assign(
      new Error('No Flux key configured. Set FAL_KEY in .env (fal.ai), then restart Rover.'),
      { status: 400, code: 'flux-unconfigured' },
    );
  }
  return status;
}

let fluxJobProgress = null;

export function setFluxJobProgress(patch = {}) {
  const now = Date.now();
  const prev = fluxJobProgress;
  const stepChanged = patch.step && patch.step !== prev?.step;
  fluxJobProgress = {
    ...(prev || {}),
    ...patch,
    updatedAt: now,
    startedAt: patch.startedAt || (stepChanged ? now : prev?.startedAt) || now,
  };
}

export function getFluxJobProgress() {
  if (!fluxJobProgress) return { ok: true, active: false };
  return { ok: true, active: true, ...fluxJobProgress };
}

export function clearFluxJobProgress() {
  fluxJobProgress = null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadUrl(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Flux image download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

const FAL_QUEUE_MAX_MS = 10 * 60 * 1000;
const FAL_GENERATE_RUN_MS = 180_000;
const FAL_EDIT_RUN_MS = 300_000;
const FAL_GENERATE_HARD_MS = 12 * 60 * 1000;
const FAL_EDIT_HARD_MS = 15 * 60 * 1000;

function bufferToDataUri(buffer, mime = 'image/jpeg') {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

const FLUX_CONTENT_POLICY_MSG =
  'Flux blocked this prompt (content policy). Rewrite the slot prompt, then retry Flux generate.';

const FLUX_EXHAUSTED_MSG =
  'Flux locked Generate (exhausted / user locked) even if remaining credits still show. Create a new API-scope key at fal.ai/dashboard/keys, set FAL_KEY, then restart Rover.';

function falDetailList(json) {
  if (Array.isArray(json?.detail)) return json.detail;
  if (Array.isArray(json?.error?.detail)) return json.error.detail;
  return [];
}

function isFalContentPolicy(json, rawText = '') {
  const blob = `${JSON.stringify(json || {})} ${rawText}`;
  if (/content_policy|content checker/i.test(blob)) return true;
  return falDetailList(json).some((d) => {
    const t = String(d?.type || '').toLowerCase();
    const m = String(d?.msg || d?.message || '').toLowerCase();
    return t === 'content_policy_violation' || m.includes('content checker') || m.includes('content policy');
  });
}

function isFalExhausted(json, rawText = '', status) {
  const blob = `${JSON.stringify(json || {})} ${rawText}`.toLowerCase();
  if (/exhausted balance|user is locked/.test(blob)) return true;
  return status === 403 && /exhaust|lock/.test(blob);
}

function falQueueError(model, status, json, rawText = '') {
  if (isFalContentPolicy(json, rawText)) {
    return Object.assign(new Error(FLUX_CONTENT_POLICY_MSG), {
      status: status || 422,
      code: 'flux-content-policy',
    });
  }
  if (isFalExhausted(json, rawText, status)) {
    markFalDepleted();
    return Object.assign(new Error(FLUX_EXHAUSTED_MSG), {
      status: status || 403,
      code: 'flux-exhausted',
    });
  }
  const first = falDetailList(json)[0];
  const msg =
    (first && (first.msg || first.message)) ||
    (typeof json?.detail === 'string' && json.detail) ||
    json?.error?.message ||
    json?.message ||
    (rawText && String(rawText).slice(0, 200)) ||
    `failed (${status})`;
  return Object.assign(new Error(`fal.ai ${model} failed (${status}): ${msg}`), { status: status || 400 });
}

function falQueuedStatus(st) {
  const u = String(st || '').toUpperCase();
  return !u || u === 'IN_QUEUE' || u === 'SUBMITTING';
}

function falRunningStatus(st) {
  const u = String(st || '').toUpperCase();
  return u === 'IN_PROGRESS' || u === 'PROCESSING';
}

async function falCancel(model, requestId, key) {
  if (!requestId) return;
  try {
    await fetch(`${FAL_QUEUE}/${model}/requests/${requestId}/cancel`, {
      method: 'PUT',
      headers: { Authorization: `Key ${key}` },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    /* ignore */
  }
}

async function falQueue(model, input, { runMs = FAL_GENERATE_RUN_MS, hardCapMs = FAL_GENERATE_HARD_MS } = {}) {
  const key = falKey();
  const started = Date.now();
  setFluxJobProgress({ model, status: 'SUBMITTING' });
  const submit = await fetch(`${FAL_QUEUE}/${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30000),
  });
  const submitText = await submit.text();
  let submitJson;
  try {
    submitJson = JSON.parse(submitText);
  } catch {
    throw falQueueError(model, submit.status, {}, submitText);
  }
  if (Array.isArray(submitJson?.images) && submitJson.images[0]?.url) {
    return submitJson;
  }
  const requestId = submitJson.request_id || submitJson.requestId;
  if (!submit.ok && !requestId) {
    throw falQueueError(model, submit.status, submitJson, submitText);
  }
  if (!requestId) {
    throw new Error(`fal.ai ${model} returned no request_id`);
  }
  setFluxJobProgress({ model, status: 'IN_QUEUE' });
  let lastStatus = 'IN_QUEUE';
  let runStarted = null;
  const failTimeout = async (message, { cancelQueue = false } = {}) => {
    if (cancelQueue) await falCancel(model, requestId, key);
    throw Object.assign(new Error(message), { status: 504 });
  };
  for (;;) {
    const now = Date.now();
    if (now - started > hardCapMs) {
      const queued = falQueuedStatus(lastStatus);
      await failTimeout(
        queued
          ? `fal.ai ${model} still queued after 10 min`
          : `fal.ai ${model} timed out still generating`,
        { cancelQueue: queued },
      );
    }
    if (!runStarted && falQueuedStatus(lastStatus) && now - started > FAL_QUEUE_MAX_MS) {
      await failTimeout(`fal.ai ${model} still queued after 10 min`, { cancelQueue: true });
    }
    if (runStarted && now - runStarted > runMs) {
      await failTimeout(`fal.ai ${model} timed out still generating`);
    }
    const statusRes = await fetch(`${FAL_QUEUE}/${model}/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    const statusJson = await statusRes.json().catch(() => ({}));
    const st = String(statusJson.status || '').toUpperCase();
    if (st) lastStatus = st;
    if (falRunningStatus(lastStatus) && !runStarted) runStarted = Date.now();
    const queuePosition = statusJson.queue_position ?? statusJson.queuePosition;
    setFluxJobProgress({
      model,
      status: lastStatus || 'IN_QUEUE',
      queuePosition: Number.isFinite(Number(queuePosition)) ? Number(queuePosition) : null,
    });
    if (st === 'COMPLETED' || st === 'OK') {
      const resultRes = await fetch(`${FAL_QUEUE}/${model}/requests/${requestId}`, {
        headers: { Authorization: `Key ${key}` },
        signal: AbortSignal.timeout(30000),
      });
      const resultJson = await resultRes.json();
      if (!resultRes.ok) {
        throw falQueueError(model, resultRes.status, resultJson);
      }
      return resultJson;
    }
    if (st === 'FAILED' || st === 'ERROR' || st === 'CANCELLED') {
      throw falQueueError(
        model,
        400,
        statusJson,
        String(statusJson.error || statusJson.detail || st),
      );
    }
    await sleep(1200);
  }
}

function firstImageUrl(payload) {
  const images = payload?.images || payload?.data?.images;
  const url = images?.[0]?.url || payload?.image?.url || payload?.url;
  if (!url) throw new Error('Flux returned no image URL');
  return url;
}

async function generateViaFal(prompt, { seed } = {}) {
  const input = {
    prompt,
    image_size: 'landscape_4_3',
    output_format: 'jpeg',
    safety_tolerance: '2',
  };
  if (Number.isFinite(Number(seed))) input.seed = Number(seed);
  const payload = await falQueue(
    FAL_GENERATE,
    input,
    { runMs: FAL_GENERATE_RUN_MS, hardCapMs: FAL_GENERATE_HARD_MS },
  );
  const outSeed = Number.isFinite(Number(payload?.seed)) ? Number(payload.seed) : null;
  return { buffer: await downloadUrl(firstImageUrl(payload)), seed: outSeed };
}

async function editViaFal(prompt, imageBuffer) {
  const payload = await falQueue(
    FAL_EDIT,
    {
      prompt,
      image_url: bufferToDataUri(imageBuffer),
      aspect_ratio: '4:3',
      output_format: 'jpeg',
      safety_tolerance: '2',
    },
    { runMs: FAL_EDIT_RUN_MS, hardCapMs: FAL_EDIT_HARD_MS },
  );
  return downloadUrl(firstImageUrl(payload));
}

async function finishJpeg(buffer) {
  return compressSiteJpeg(buffer);
}

/**
 * @param {{ prompt: string, seed?: number }} opts
 * @returns {Promise<{ buffer: Buffer, provider: 'fal', seed?: number|null }>}
 */
export async function generateFluxImage({ prompt, seed } = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw Object.assign(new Error('prompt required'), { status: 400 });
  requireConfigured();
  await assertFluxCredits('generate');
  setFluxJobProgress({
    step: 'generate',
    status: 'SUBMITTING',
    model: FAL_GENERATE,
  });
  const raw = await generateViaFal(text, { seed });
  return { buffer: await finishJpeg(raw.buffer), provider: 'fal', seed: raw.seed };
}

/**
 * @param {{ prompt: string, imageBuffer: Buffer }} opts
 * @returns {Promise<{ buffer: Buffer, provider: 'fal' }>}
 */
export async function editFluxImage({ prompt, imageBuffer } = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw Object.assign(new Error('prompt required'), { status: 400 });
  if (!imageBuffer?.length) throw Object.assign(new Error('imageBuffer required'), { status: 400 });
  requireConfigured();
  await assertFluxCredits('edit');
  setFluxJobProgress({
    step: 'edit',
    status: 'SUBMITTING',
    model: FAL_EDIT,
  });
  const raw = await editViaFal(text, imageBuffer);
  return { buffer: await finishJpeg(raw), provider: 'fal' };
}
