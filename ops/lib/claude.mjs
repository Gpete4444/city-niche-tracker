import {
  autoAcceptNarrativeDraft,
  buildCopyPrompt,
  extractPromptTemplate,
  getCandidateDetail,
  readPromptFile,
  saveMeta,
  saveNarrativeDraft,
} from './candidates.mjs';
import { estimateClaudeCostUsd } from './cost-estimates.mjs';

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

export function defaultModel() {
  return process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
}

function stripCodeFences(text) {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  return m ? m[1].trim() : trimmed;
}

function parseJsonLoose(text) {
  const cleaned = stripCodeFences(text);
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
    return { ok: false, value: null, raw: cleaned };
  }
}

export { parseJsonLoose };

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
    candidate: getCandidateDetail(candidateId),
  };
}

function attachClaudeCost(usage, model, costKey) {
  const inputTokens = Number(usage?.input_tokens) || 0;
  const outputTokens = Number(usage?.output_tokens) || 0;
  const priced = estimateClaudeCostUsd({ inputTokens, outputTokens, model });
  if (costKey && priced.costUsd != null) {
    saveMeta(costKey.candidateId, {
      lastCosts: { [costKey.label]: priced.costUsd },
      ...(costKey.label === 'narrative'
        ? { lastNarrativeAt: new Date().toISOString() }
        : {}),
    });
  }
  return {
    usage,
    costUsd: priced.costUsd,
    costNote: priced.costNote,
    costSource: 'anthropic-estimate',
  };
}

/**
 * Call Anthropic Messages API with the candidate-research prompt + research JSON.
 * Writes a draft and auto-accepts when validation passes.
 */
export async function generateNarrativeDraft(candidateId) {
  const detail = getCandidateDetail(candidateId);
  if (!detail.research) {
    throw new Error('No research JSON — run Stage 1 (and ideally Stage 2 enrich) first');
  }

  const key = requireAnthropicKey();
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
    .replace('{{DISCOVERY_NARRATIVE_SEED}}', seedBlock);

  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      temperature: 0.3,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(
      `Anthropic HTTP ${response.status}: ${json?.error?.message || JSON.stringify(json).slice(0, 400)}`,
    );
  }

  const text = (json.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  const parsed = parseJsonLoose(text);
  const usage = json.usage ?? null;
  const cost = attachClaudeCost(usage, model, { candidateId, label: 'narrative' });

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

  const key = requireAnthropicKey();
  const model = defaultModel();
  const md = readPromptFile('prompts/claude-prospect-renters.md');
  const template = extractPromptTemplate(md);
  const userContent = template.replace(
    '{{PASTE_OUTPUT_OF_npm_run_prospect_renters}}',
    JSON.stringify(detail.prospects, null, 2),
  );

  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.4,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(
      `Anthropic HTTP ${response.status}: ${json?.error?.message || JSON.stringify(json).slice(0, 400)}`,
    );
  }

  const text = (json.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  const parsed = parseJsonLoose(text);
  const cost = attachClaudeCost(json.usage ?? null, model, { candidateId, label: 'outreach' });
  return {
    ok: parsed.ok,
    model,
    draft: parsed.ok ? parsed.value : { parseError: true, rawText: text },
    ...cost,
  };
}
