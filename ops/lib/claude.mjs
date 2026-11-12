import {
  autoAcceptNarrativeDraft,
  buildCopyPrompt,
  extractPromptTemplate,
  getCandidateDetail,
  getCandidateShell,
  loadMeta,
  readPromptFile,
  saveMeta,
  saveNarrativeDraft,
} from './candidates.mjs';
import { zoneGuideBlockForCandidate } from './zone-guide.mjs';
import { estimateClaudeCostUsd } from './cost-estimates.mjs';
import { recordRoverApiSpend } from './rover-api-spend.mjs';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export function requireAnthropicKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      'Missing ANTHROPIC_API_KEY. Add it to .env (see .env.example). You can still use Copy prompt.',
    );
  }
  return key;
}

const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

export function defaultModel() {
  return String(process.env.ANTHROPIC_MODEL || '').trim() || 'claude-sonnet-5';
}

export function defaultEffort() {
  const raw = String(process.env.ANTHROPIC_EFFORT || '').trim().toLowerCase();
  return EFFORT_LEVELS.has(raw) ? raw : 'medium';
}

function resolveEffort(override) {
  const raw = String(override || '').trim().toLowerCase();
  return EFFORT_LEVELS.has(raw) ? raw : defaultEffort();
}

function isSonnet5(model) {
  return String(model || '').startsWith('claude-sonnet-5');
}

function extractJsonFence(text) {
  const m = String(text || '').match(/```(?:json)?\s*([\s\S]*?)```/i);
  return m ? m[1].trim() : null;
}

function tryParseJsonObject(cleaned) {
  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return { ok: true, value: JSON.parse(cleaned.slice(start, end + 1)) };
      } catch {
        /* fall through */
      }
    }
    return { ok: false };
  }
}

function parseJsonLoose(text) {
  const raw = String(text || '');
  const fenced = extractJsonFence(raw);
  const trimmed = raw.trim();
  const candidates = [];
  if (fenced) candidates.push(fenced);
  if (trimmed && trimmed !== fenced) candidates.push(trimmed);
  for (const cleaned of candidates) {
    const parsed = tryParseJsonObject(cleaned);
    if (parsed.ok) return { ok: true, value: parsed.value };
  }
  return { ok: false, value: null, raw: fenced || trimmed };
}

export { parseJsonLoose };

const ANTHROPIC_RETRY_ATTEMPTS = 6;
const ANTHROPIC_RETRY_CAP_MS = 60_000;

const ANTHROPIC_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504, 520, 529]);

export function isAnthropicRetryableStatus(status) {
  return ANTHROPIC_RETRYABLE_STATUSES.has(Number(status));
}

const TRANSIENT_FETCH_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT',
]);

/** Dropped connection or timeout. Stop and abort are not retried. */
export function isTransientFetchError(error) {
  if (!error || error.cancelled || error.name === 'AbortError') return false;
  const codes = [];
  const walk = (err, depth) => {
    if (!err || depth > 3) return;
    codes.push(String(err.code || '').toUpperCase());
    if (err.cause) walk(err.cause, depth + 1);
    if (Array.isArray(err.errors)) {
      for (const child of err.errors) walk(child, depth + 1);
    }
  };
  walk(error, 0);
  if (codes.some((code) => TRANSIENT_FETCH_CODES.has(code))) return true;
  const msg = `${error.message || ''} ${error.cause?.message || ''}`;
  return /fetch failed|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timed out|timeout/i.test(msg);
}

/**
 * @param {number} attempt zero-based failed attempt index
 * @param {string | null | undefined} retryAfterHeader
 */
export function anthropicRetryDelayMs(attempt, retryAfterHeader) {
  const header = String(retryAfterHeader ?? '').trim();
  if (header) {
    const sec = Number(header);
    if (Number.isFinite(sec) && sec >= 0) {
      return Math.min(ANTHROPIC_RETRY_CAP_MS, Math.max(0, Math.round(sec * 1000)));
    }
  }
  const n = Number(attempt);
  const exp = Number.isFinite(n) && n >= 0 ? n : 0;
  return Math.min(ANTHROPIC_RETRY_CAP_MS, 2000 * 2 ** exp);
}

function sleepAbortable(ms, signal) {
  const wait = Math.max(0, Number(ms) || 0);
  if (wait <= 0) {
    if (signal?.aborted) {
      return Promise.reject(Object.assign(new Error('Stopped'), { status: 499, cancelled: true }));
    }
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const fail = () => {
      reject(Object.assign(new Error('Stopped'), { status: 499, cancelled: true }));
    };
    if (signal?.aborted) {
      fail();
      return;
    }
    const t = setTimeout(resolve, wait);
    const onAbort = () => {
      clearTimeout(t);
      fail();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Save a Claude.ai (or other) narrative JSON paste and auto-accept when valid.
 */
export function pasteNarrativeDraft(candidateId, raw) {
  const detail = getCandidateDetail(candidateId);
  if (!detail.research) {
    throw new Error('No research JSON — run Stage 1 first');
  }

  let value = raw;
  if (typeof raw === 'string') {
    const parsed = parseJsonLoose(raw);
    if (!parsed.ok) {
      const err = new Error('Could not parse JSON. Paste the full Claude object (or a ```json fence).');
      err.status = 400;
      throw err;
    }
    value = parsed.value;
  } else if (raw && typeof raw === 'object') {
    value = raw;
  } else {
    const err = new Error('Paste a JSON object or string');
    err.status = 400;
    throw err;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const err = new Error('Narrative must be a JSON object');
    err.status = 400;
    throw err;
  }
  if (!value.scoring || typeof value.scoring !== 'object') {
    const err = new Error('Narrative JSON must include a scoring object');
    err.status = 400;
    throw err;
  }

  const draft = saveNarrativeDraft(candidateId, value, {
    source: 'paste',
    model: null,
    parseError: false,
  });
  const auto = autoAcceptNarrativeDraft(candidateId);
  return {
    ok: true,
    draft: auto.accepted ? null : draft,
    accepted: Boolean(auto.accepted),
    acceptError: auto.accepted ? null : auto.error || null,
    acceptCode: auto.accepted ? null : auto.code || null,
    jobCostOverride: auto.jobCostOverride || false,
    narrative: auto.narrative || null,
    approved: auto.approved || null,
    candidate: getCandidateShell(candidateId),
  };
}

function attachClaudeCost(usage, model, costKey) {
  const inputTokens = Number(usage?.input_tokens) || 0;
  const outputTokens = Number(usage?.output_tokens) || 0;
  const priced = estimateClaudeCostUsd({ inputTokens, outputTokens, model });
  let costUsd = priced.costUsd;
  if (costKey?.accumulate && costUsd != null) {
    const prev = Number(loadMeta(costKey.candidateId)?.lastCosts?.[costKey.label]) || 0;
    costUsd = Number((prev + costUsd).toFixed(4));
  }
  if (costKey && costUsd != null) {
    saveMeta(costKey.candidateId, {
      lastCosts: { [costKey.label]: costUsd },
      ...(costKey.label === 'narrative'
        ? { lastNarrativeAt: new Date().toISOString() }
        : {}),
    });
    recordRoverApiSpend('anthropic', priced.costUsd);
  }
  return {
    usage,
    costUsd,
    callCostUsd: priced.costUsd,
    costNote: priced.costNote,
    costSource: 'anthropic-estimate',
  };
}

/**
 * Prefer opts.messages (multi-turn). Otherwise a single user turn from opts.user.
 * @param {{ user?: string, messages?: { role?: string, content?: string }[] }} opts
 */
export function resolveClaudeMessages(opts = {}) {
  if (Array.isArray(opts.messages) && opts.messages.length) {
    return opts.messages.map((m) => ({
      role: m?.role === 'assistant' ? 'assistant' : 'user',
      content: String(m?.content ?? ''),
    }));
  }
  return [{ role: 'user', content: String(opts.user || '') }];
}

/**
 * Shared Anthropic Messages call. AbortError becomes Stopped.
 * @param {{
 *   user?: string,
 *   messages?: { role?: string, content?: string }[],
 *   system?: string,
 *   cacheSystem?: boolean,
 *   maxTokens?: number,
 *   temperature?: number,
 *   effort?: string,
 *   signal?: AbortSignal,
 *   costKey?: { candidateId: string, label: string, accumulate?: boolean },
 *   fetch?: typeof fetch,
 *   retrySleep?: (ms: number, signal?: AbortSignal) => Promise<void>,
 * }} opts
 */
export async function claudeMessages(opts = {}) {
  const messages = resolveClaudeMessages(opts);
  if (!messages.some((m) => m.role === 'user' && String(m.content).trim())) {
    throw Object.assign(new Error('claudeMessages needs a user prompt'), { status: 400 });
  }
  if (opts.signal?.aborted) {
    throw Object.assign(new Error('Stopped'), { status: 499, cancelled: true });
  }
  const key = requireAnthropicKey();
  const model = defaultModel();
  const headers = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  };
  const workspaceId = String(process.env.ANTHROPIC_WORKSPACE_ID || '').trim();
  if (workspaceId) {
    headers['anthropic-workspace-id'] = workspaceId;
  }
  if (opts.cacheSystem && opts.system) {
    headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
  }
  const body = {
    model,
    max_tokens: Number(opts.maxTokens) > 0 ? Number(opts.maxTokens) : 8192,
    messages,
    output_config: { effort: resolveEffort(opts.effort) },
  };
  if (!isSonnet5(model)) {
    body.temperature = opts.temperature == null ? 0.4 : Number(opts.temperature);
  }
  if (opts.system) {
    const sys = String(opts.system);
    body.system = opts.cacheSystem
      ? [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }]
      : sys;
  }
  const doFetch = typeof opts.fetch === 'function' ? opts.fetch : fetch;
  const retrySleep = typeof opts.retrySleep === 'function' ? opts.retrySleep : sleepAbortable;

  let response;
  let json = {};
  for (let attempt = 0; attempt < ANTHROPIC_RETRY_ATTEMPTS; attempt += 1) {
    if (opts.signal?.aborted) {
      throw Object.assign(new Error('Stopped'), { status: 499, cancelled: true });
    }
    try {
      response = await doFetch(ANTHROPIC_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError' || opts.signal?.aborted || error?.cancelled) {
        throw Object.assign(new Error('Stopped'), { status: 499, cancelled: true });
      }
      if (isTransientFetchError(error) && attempt < ANTHROPIC_RETRY_ATTEMPTS - 1) {
        const delay = anthropicRetryDelayMs(attempt);
        await retrySleep(delay, opts.signal);
        continue;
      }
      throw error;
    }
    json = await response.json().catch(() => ({}));
    if (response.ok) break;
    const retryable = isAnthropicRetryableStatus(response.status);
    if (!retryable || attempt === ANTHROPIC_RETRY_ATTEMPTS - 1) {
      const raw = json?.error?.message || JSON.stringify(json).slice(0, 400);
      const msg = String(raw || '');
      if (/anthropic-workspace-id is required/i.test(msg)) {
        throw new Error(
          'This Anthropic key needs a workspace. Set ANTHROPIC_WORKSPACE_ID in .env to the wrkspc_… id from Console → Settings → Workspaces, then restart Rover.',
        );
      }
      if (Number(response.status) === 520 && !json?.error?.message) {
        throw new Error("Anthropic's connection dropped. Try this step again.");
      }
      throw new Error(`Anthropic HTTP ${response.status}: ${raw}`);
    }
    const delay = anthropicRetryDelayMs(attempt, response.headers?.get?.('retry-after'));
    await retrySleep(delay, opts.signal);
  }

  const text = (json.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  const parsed = parseJsonLoose(text);
  const stopReason = json.stop_reason || json.stopReason || null;
  const truncated = stopReason === 'max_tokens';
  const cost = attachClaudeCost(json.usage ?? null, model, opts.costKey);
  return { text, json, parsed, model, stopReason, truncated, ...cost };
}

/**
 * Call Anthropic Messages API with the candidate-research prompt + research JSON.
 * Writes a draft and auto-accepts when validation passes.
 */
export async function generateNarrativeDraft(candidateId) {
  const { ensureResearchSerpSeeds } = await import('./serp-seeds.mjs');
  ensureResearchSerpSeeds(candidateId);
  const detail = getCandidateDetail(candidateId);
  if (!detail.research) {
    throw new Error('No research JSON — add SERP seeds (Run all required or Ad volumes) first');
  }

  const model = defaultModel();
  const md = readPromptFile('prompts/claude-candidate-research.md');
  const template = extractPromptTemplate(md);
  const seedBlock = detail.discoverySeed
    ? JSON.stringify(detail.discoverySeed, null, 2)
    : '(none — no Discovery Claude seed on this candidate)';
  const userContent = template
    .replace(
      '{{PASTE_OUTPUT_OF_research_or_enrich_candidate}}',
      JSON.stringify(detail.research, null, 2),
    )
    .replace(
      '{{PASTE_OUTPUT_OF_npm_run_research-candidate}}',
      JSON.stringify(detail.research, null, 2),
    )
    .replace('{{DISCOVERY_NARRATIVE_SEED}}', seedBlock)
    .split('{{ZONE_GUIDE}}')
    .join(zoneGuideBlockForCandidate(candidateId, 'full'));

  const { text, parsed, usage, costUsd, costNote, costSource } = await claudeMessages({
    user: userContent,
    maxTokens: 8192,
    temperature: 0.3,
    costKey: { candidateId, label: 'narrative' },
  });
  const cost = { usage, costUsd, costNote, costSource };

  if (!parsed.ok) {
    const draft = {
      parseError: true,
      rawText: parsed.raw || text,
      model,
      usage,
    };
    saveNarrativeDraft(candidateId, draft, { model, usage, parseError: true });
    return {
      ok: false,
      parseError: true,
      draft,
      accepted: false,
      model,
      ...cost,
      copyPrompt: buildCopyPrompt(candidateId),
    };
  }

  const draft = saveNarrativeDraft(candidateId, parsed.value, { model, usage, parseError: false });
  const auto = autoAcceptNarrativeDraft(candidateId);
  return {
    ok: true,
    parseError: false,
    draft: auto.accepted ? null : draft,
    accepted: Boolean(auto.accepted),
    acceptError: auto.accepted ? null : auto.error || null,
    acceptCode: auto.accepted ? null : auto.code || null,
    jobCostOverride: auto.jobCostOverride || false,
    narrative: auto.narrative || null,
    approved: auto.approved || null,
    model,
    ...cost,
    copyPrompt: buildCopyPrompt(candidateId),
  };
}

export async function generateProspectsOutreachDraft(candidateId) {
  const detail = getCandidateDetail(candidateId);
  if (!detail.prospects) {
    throw new Error('No prospects JSON — run Stage 4 prospect-renters first');
  }

  const model = defaultModel();
  const md = readPromptFile('prompts/claude-prospect-renters.md');
  const template = extractPromptTemplate(md);
  const userContent = template.replace(
    '{{PASTE_OUTPUT_OF_npm_run_prospect_renters}}',
    JSON.stringify(detail.prospects, null, 2),
  );

  const { text, parsed, usage, costUsd, costNote, costSource } = await claudeMessages({
    user: userContent,
    maxTokens: 4096,
    temperature: 0.4,
    costKey: { candidateId, label: 'outreach' },
  });
  return {
    ok: parsed.ok,
    model,
    draft: parsed.ok ? parsed.value : { parseError: true, rawText: text },
    usage,
    costUsd,
    costNote,
    costSource,
  };
}
