/**
 * Cost estimates for ops pre-run modals.
 * Claude $/MTok are public list prices used only for estimates — not invoices.
 */

import {
  buildCopyPrompt,
  getCandidateDetail,
  loadMeta,
  readPromptFile,
} from './candidates.mjs';

function defaultModel() {
  return process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
}

/** Approximate Sonnet list pricing (USD per million tokens). */
export const CLAUDE_RATES = {
  // Default for claude-sonnet-4* and similar
  default: { inputPerMTok: 3, outputPerMTok: 15, label: 'Claude Sonnet (list price est.)' },
};

export function ratesForModel(model = defaultModel()) {
  return CLAUDE_RATES.default;
}

export function estimateTokensFromText(text) {
  const n = String(text || '').length;
  return Math.max(1, Math.ceil(n / 4));
}

export function estimateClaudeCostUsd({ inputTokens, outputTokens, model }) {
  const rates = ratesForModel(model);
  const cost =
    (inputTokens / 1_000_000) * rates.inputPerMTok +
    (outputTokens / 1_000_000) * rates.outputPerMTok;
  return {
    costUsd: Number(cost.toFixed(4)),
    inputTokens,
    outputTokens,
    rates,
    costNote: `Estimate from tokens × ${rates.label}. Not an Anthropic invoice.`,
  };
}

function formatUsd(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return `$${Number(n).toFixed(Number(n) < 0.1 ? 4 : 2)}`;
}

function formatRange(low, high) {
  return `${formatUsd(low)}–${formatUsd(high)}`;
}

function countEnrichTargets(research) {
  if (!research?.serp) return 0;
  const urls = new Set();
  for (const bucket of [
    research.serp.organicHomePages?.links,
    research.serp.organicSubPages?.links,
    research.serp.directories?.links,
  ]) {
    for (const link of bucket || []) {
      const url = typeof link === 'string' ? link : link?.url;
      if (url) urls.add(url);
    }
  }
  return urls.size || (research.serp.uniqueOrganicDomains?.length ?? 0);
}

function overwriteFlags(detail, act) {
  const f = detail.stageFlags || {};
  if (act === 'research') return Boolean(f.hasResearch);
  if (act === 'enrich') return Boolean(f.hasEnrichment);
  if (act === 'prospects') return Boolean(f.hasProspects);
  if (act === 'narrative') return Boolean(f.hasNarrativeDraft || f.hasNarrative);
  return false;
}

/**
 * Build a cost preview for a paid stage action.
 * @param {string} candidateId
 * @param {string} act research|enrich|prospects|narrative|outreach
 */
export function getCostPreview(candidateId, act) {
  const detail = getCandidateDetail(candidateId);
  const meta = loadMeta(candidateId);
  const last = meta.lastCosts || {};
  const config = detail.config || {};
  const research = detail.research;
  const cityCount =
    research?.cityCluster?.length ||
    (config.cluster ? 1 + (Array.isArray(config.cluster) ? config.cluster.length : 0) : 1);
  const related = Number(config.related) || research?.volumes?.keywords?.length || 10;
  const enrichTargets = countEnrichTargets(research);
  const willOverwrite = overwriteFlags(detail, act);

  if (act === 'research') {
    const lastCost = last.research ?? null;
    const hasSerpCache = Boolean(config.serpCache);
    return {
      act,
      provider: 'dataforseo',
      title: 'Run Stage 1 research?',
      whatItDoes: hasSerpCache
        ? 'Reuses Discovery organic SERP (Map Pack / organic counts) when the probe cache is fresh, then pulls Ads keyword volumes across the city cluster. Saves everything into the research file.'
        : 'Looks up this niche on Google for your city, counts Map Pack / organic competitors, and pulls monthly search volumes for your keywords across the city cluster. Saves everything into the research file.',
      estimateLabel: lastCost != null ? `Last run: ${formatUsd(lastCost)}` : formatRange(0.2, 1.5),
      estimateUsdLow: lastCost ?? 0.2,
      estimateUsdHigh: lastCost ?? 1.5,
      estimateDetail:
        lastCost != null
          ? 'Using your last Stage 1 cost for this candidate as the estimate.'
          : hasSerpCache
            ? `Typical Ads volume cost for ~${cityCount} cities and ~${related} related keywords (organic SERP reused from Discovery when cache ≤14 days). Actual depends on DataForSEO pricing.`
            : `Typical range for ~${cityCount} cities and ~${related} related keywords. Actual cost depends on DataForSEO pricing.`,
      willOverwrite,
      overwriteNote: willOverwrite
        ? 'This candidate already has research. Running again replaces SERP, keywords, volumes, and scoring. Stage 1 rewrites the research file, so enrichment on that file is overwritten until you re-run Stage 2. Pass forceSerp / --force-serp to ignore Discovery SERP cache.'
        : null,
      confirmLabel: lastCost != null ? `Run (est. ${formatUsd(lastCost)})` : 'Run (est. $0.20–$1.50)',
    };
  }

  if (act === 'enrich') {
    const lastCost = last.enrich ?? null;
    const heuristic = Math.min(2, Math.max(0.1, 0.05 * Math.max(enrichTargets, 1)));
    return {
      act,
      provider: 'dataforseo',
      title: 'Run Stage 2 enrich?',
      whatItDoes:
        'Checks how strong competitor websites look (DataForSEO Domain Rank and page thinness) so you can score how displaceable they are. Updates the Enrichment tab.',
      estimateLabel: lastCost != null ? `Last run: ${formatUsd(lastCost)}` : `~${formatUsd(heuristic)}`,
      estimateUsdLow: lastCost ?? heuristic,
      estimateUsdHigh: lastCost ?? heuristic,
      estimateDetail:
        lastCost != null
          ? 'Using your last Stage 2 cost for this candidate as the estimate.'
          : `About ${enrichTargets || 'a few'} blue-link URLs/domains × ~$0.05 each (clamped). Actual varies by DataForSEO backlink calls.`,
      willOverwrite,
      overwriteNote: willOverwrite
        ? 'Enrichment already exists. Running again replaces Domain Rank, page strength, and displaceability.'
        : null,
      confirmLabel: `Run (est. ${formatUsd(lastCost ?? heuristic)})`,
    };
  }

  if (act === 'prospects') {
    const lastCost = last.prospects ?? null;
    return {
      act,
      provider: 'dataforseo',
      title: 'Run Stage 4 prospects?',
      whatItDoes:
        'Searches for local businesses that might rent this niche site (Maps results). Reuses Stage 1 paid-ad domains — does not re-fetch organic SERP. Saves a prospects list for outreach.',
      estimateLabel: lastCost != null ? `Last run: ${formatUsd(lastCost)}` : formatRange(0.05, 0.4),
      estimateUsdLow: lastCost ?? 0.05,
      estimateUsdHigh: lastCost ?? 0.4,
      estimateDetail:
        lastCost != null
          ? 'Using your last Stage 4 cost for this candidate as the estimate.'
          : 'Typical Maps lookup cost for one niche + city (no second organic SERP).',
      willOverwrite,
      overwriteNote: willOverwrite
        ? 'Prospects already exist. Running again replaces the prospects list.'
        : null,
      confirmLabel: lastCost != null ? `Run (est. ${formatUsd(lastCost)})` : 'Run (est. $0.05–$0.40)',
    };
  }

  if (act === 'narrative') {
    if (!research) {
      return {
        act,
        provider: 'anthropic',
        title: 'Run Stage 3 narrative?',
        whatItDoes: 'Needs research JSON first.',
        error: 'No research JSON — run Stage 1 first.',
        confirmLabel: 'Cannot run',
      };
    }
    const promptApprox = buildCopyPrompt(candidateId);
    const inputTokens = estimateTokensFromText(promptApprox);
    const outputTokens = 2500;
    const priced = estimateClaudeCostUsd({
      inputTokens,
      outputTokens,
      model: defaultModel(),
    });
    return {
      act,
      provider: 'anthropic',
      title: willOverwrite ? 'Replace Stage 3 narrative?' : 'Run Stage 3 narrative?',
      whatItDoes:
        'Sends your research JSON to Claude with the candidate-research prompt. Claude fills soft fields (job value, narrative, proposed score polish) into a draft you must Accept before it becomes final.',
      estimateLabel: `~${formatUsd(priced.costUsd)} (${inputTokens.toLocaleString()} in + ~${outputTokens.toLocaleString()} out tokens)`,
      estimateUsdLow: priced.costUsd,
      estimateUsdHigh: priced.costUsd,
      estimateDetail: priced.costNote,
      model: defaultModel(),
      inputTokensEst: inputTokens,
      outputTokensEst: outputTokens,
      willOverwrite,
      overwriteNote: willOverwrite
        ? 'A narrative draft or accepted file already exists. Running again replaces the current draft. An accepted narrative stays until you Accept again.'
        : null,
      confirmLabel: `Run (est. ${formatUsd(priced.costUsd)})`,
      freeFallback: 'Prefer free/manual? Cancel and use Copy Claude.ai prompt instead.',
    };
  }

  if (act === 'outreach') {
    if (!detail.prospects) {
      return {
        act,
        provider: 'anthropic',
        title: 'Run Claude outreach?',
        whatItDoes: 'Needs prospects first.',
        error: 'No prospects JSON — run Stage 4 first.',
        confirmLabel: 'Cannot run',
      };
    }
    const md = readPromptFile('prompts/claude-prospect-renters.md');
    const blob = md + JSON.stringify(detail.prospects);
    const inputTokens = estimateTokensFromText(blob);
    const outputTokens = 1500;
    const priced = estimateClaudeCostUsd({
      inputTokens,
      outputTokens,
      model: defaultModel(),
    });
    return {
      act,
      provider: 'anthropic',
      title: 'Run Claude outreach draft?',
      whatItDoes:
        'Sends your prospects list to Claude to draft outreach copy. Uses Anthropic API tokens. Shown on the Prospects tab (v1 has no separate Accept step).',
      estimateLabel: `~${formatUsd(priced.costUsd)} (${inputTokens.toLocaleString()} in + ~${outputTokens.toLocaleString()} out tokens)`,
      estimateUsdLow: priced.costUsd,
      estimateUsdHigh: priced.costUsd,
      estimateDetail: priced.costNote,
      model: defaultModel(),
      willOverwrite: false,
      overwriteNote: null,
      confirmLabel: `Run (est. ${formatUsd(priced.costUsd)})`,
    };
  }

  throw Object.assign(new Error(`Unknown act for cost preview: ${act}`), { status: 400 });
}

/**
 * Aggregated cost preview for multi-candidate batch runs.
 */
export function getBatchCostPreview(candidateIds = [], act) {
  const ids = [...new Set(candidateIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const previews = [];
  const errors = [];
  let low = 0;
  let high = 0;
  let overwriteCount = 0;
  for (const id of ids) {
    try {
      const p = getCostPreview(id, act);
      if (p.error) {
        errors.push({ id, error: p.error });
        continue;
      }
      previews.push({ id, ...p });
      low += Number(p.estimateUsdLow) || 0;
      high += Number(p.estimateUsdHigh) || 0;
      if (p.willOverwrite) overwriteCount += 1;
    } catch (error) {
      errors.push({ id, error: error.message });
    }
  }
  const provider = previews[0]?.provider || (act === 'narrative' ? 'anthropic' : 'dataforseo');
  return {
    act,
    provider,
    count: ids.length,
    runnable: previews.length,
    title: `Batch ${act} on ${ids.length}?`,
    estimateUsdLow: Number(low.toFixed(4)),
    estimateUsdHigh: Number(high.toFixed(4)),
    estimateLabel:
      Math.abs(low - high) < 0.0001
        ? `~${formatUsd(low)} for ${previews.length} candidates`
        : `${formatUsd(low)}–${formatUsd(high)} for ${previews.length} candidates`,
    estimateDetail: `Sum of per-candidate estimates (${previews.length} runnable${
      errors.length ? `, ${errors.length} skipped` : ''
    }).`,
    willOverwrite: overwriteCount > 0,
    overwriteNote:
      overwriteCount > 0
        ? `${overwriteCount} of ${previews.length} already have this stage data and would be overwritten.`
        : null,
    confirmLabel: `Run on ${previews.length} (est. ${
      Math.abs(low - high) < 0.0001 ? formatUsd(low) : `${formatUsd(low)}–${formatUsd(high)}`
    })`,
    errors,
    previews,
  };
}
