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
import {
  EVAL_ALL_STEP_LABELS,
  EVAL_ALL_STEPS_ALL,
  EVAL_ALL_STEPS_REQUIRED,
  EVAL_RUN_MODE_ALL,
  EVAL_RUN_MODE_REQUIRED,
  missingEvalAllStepsFromFlags,
  normalizeEvalRunMode,
} from './eval-run-mode.mjs';

function defaultModel() {
  return String(process.env.ANTHROPIC_MODEL || '').trim() || 'claude-sonnet-5';
}

/** Approximate Sonnet list pricing (USD per million tokens). */
export const CLAUDE_RATES = {
  // Claude Sonnet 5 list: $2 input / $10 output per MTok
  default: { inputPerMTok: 2, outputPerMTok: 10, label: 'Claude Sonnet 5 (list price est.)' },
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

const EVAL_ALL_STEPS = EVAL_ALL_STEPS_ALL;

function estimateEvalAllStep(candidateId, step) {
  if (step === 'narrative') {
    try {
      const p = getCostPreview(candidateId, 'narrative');
      if (!p.error) return p;
    } catch {
      /* use heuristic when research JSON is not on disk yet */
    }
    const priced = estimateClaudeCostUsd({
      inputTokens: 4000,
      outputTokens: 2500,
      model: defaultModel(),
    });
    return {
      act: 'narrative',
      estimateUsdLow: priced.costUsd,
      estimateUsdHigh: priced.costUsd,
    };
  }
  return getCostPreview(candidateId, step);
}

function estimateRequiredResearchStep(candidateId) {
  const detail = getCandidateDetail(candidateId);
  if (detail?.stageFlags?.hasResearch) {
    return { act: 'serp-seeds', estimateUsdLow: 0, estimateUsdHigh: 0 };
  }
  return {
    act: 'serp-seeds',
    estimateUsdLow: 0,
    estimateUsdHigh: 0.002,
  };
}

function getEvaluateAllCostPreview(candidateId, evalRunMode = EVAL_RUN_MODE_REQUIRED) {
  const mode = normalizeEvalRunMode(evalRunMode);
  const required = mode === EVAL_RUN_MODE_REQUIRED;
  const detail = getCandidateDetail(candidateId);
  const missing = missingEvalAllStepsFromFlags(detail?.stageFlags || {}, mode);
  const allSteps = required ? EVAL_ALL_STEPS_REQUIRED : EVAL_ALL_STEPS;
  const title = required ? 'Run all required?' : 'Run all evaluations?';
  if (!missing.length) {
    return {
      act: 'evaluate-all',
      evalRunMode: mode,
      provider: 'mixed',
      title,
      whatItDoes: required
        ? 'Required Research steps are already complete (SERP seeds + Narrative).'
        : 'Evaluations 1–4 are already complete.',
      error: required
        ? 'Already complete — SERP seeds and Narrative are done.'
        : 'Already complete — Evaluations 1–4 are done.',
      confirmLabel: 'Cannot run',
    };
  }
  let low = 0;
  let high = 0;
  for (const step of missing) {
    const p =
      required && step === 'research'
        ? estimateRequiredResearchStep(candidateId)
        : estimateEvalAllStep(candidateId, step);
    low += Number(p.estimateUsdLow) || 0;
    high += Number(p.estimateUsdHigh) || 0;
  }
  const skipped = allSteps.filter((s) => !missing.includes(s)).map((s) =>
    required && s === 'research' ? 'SERP seeds' : EVAL_ALL_STEP_LABELS[s],
  );
  const running = missing.map((s) =>
    required && s === 'research' ? 'SERP seeds' : EVAL_ALL_STEP_LABELS[s],
  );
  const same = Math.abs(low - high) < 0.0001;
  return {
    act: 'evaluate-all',
    evalRunMode: mode,
    provider: 'mixed',
    title: required ? 'Run all required (missing steps)?' : 'Run all missing evaluations?',
    whatItDoes: required
      ? `Cheapest Research path (${running.join(
          ' → ',
        )}). Skips Ads volumes, Enrich, and Prospects. Website Write still has its own Claude cost later.`
      : `Fills missing evaluations in order (${running.join(
          ' → ',
        )}). Ad volumes use Live queue and do not force a new SERP. Narrative uses the Anthropic API.`,
    estimateLabel: same ? `~${formatUsd(low)}` : formatRange(low, high),
    estimateUsdLow: Number(low.toFixed(4)),
    estimateUsdHigh: Number(high.toFixed(4)),
    estimateDetail: skipped.length
      ? `Skipping already done: ${skipped.join(', ')}.`
      : required
        ? 'SERP seeds + Narrative will run.'
        : 'All four steps will run.',
    willOverwrite: false,
    overwriteNote: null,
    confirmLabel: `${required ? 'Run all required' : 'Run all'} (est. ${
      same ? formatUsd(low) : formatRange(low, high)
    })`,
    missingSteps: missing,
    skippedSteps: skipped,
  };
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
 * @param {string} act research|enrich|prospects|narrative|outreach|domain-pick|site-config|write-site|expand-locations|evaluate-all
 */
export function getCostPreview(candidateId, act, opts = {}) {
  if (act === 'evaluate-all' || act === 'evaluateAll') {
    return getEvaluateAllCostPreview(candidateId, opts.evalRunMode);
  }
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
    return {
      act,
      provider: 'dataforseo',
      title: 'Ad volumes?',
      whatItDoes:
        'Pulls Ads keyword search volumes and CPC across the city cluster into the research file.',
      estimateLabel: lastCost != null ? `Last run: ${formatUsd(lastCost)}` : formatRange(0.2, 1.5),
      estimateUsdLow: lastCost ?? 0.2,
      estimateUsdHigh: lastCost ?? 1.5,
      estimateDetail:
        lastCost != null
          ? 'Using your last Stage 1 cost for this candidate as the estimate.'
          : `Typical Ads volume cost for ~${cityCount} cities and ~${related} related keywords. Actual depends on DataForSEO pricing.`,
      willOverwrite,
      overwriteNote: willOverwrite
        ? 'This candidate already has research. Running again refreshes volumes (and SERP only if Force new SERP is on). Stage 2 Enrich stays on the file unless SERP URLs change (then marked stale).'
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
        'Sends the research to Claude. A valid reply is accepted automatically. If it needs fixes, Accept or reject it on the story step.',
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
      freeFallback: 'Copy and paste is the other mode in the header.',
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

  if (act === 'domain-pick' || act === 'suggest-domains' || act === 'domainPick') {
    const lastCost = last.domainPick ?? null;
    const md = readPromptFile('prompts/claude-domain-pick.md');
    const inputTokens = estimateTokensFromText(md);
    const outputTokens = 800;
    const priced = estimateClaudeCostUsd({
      inputTokens,
      outputTokens,
      model: defaultModel(),
    });
    return {
      act: 'domain-pick',
      provider: 'anthropic',
      title: lastCost != null ? 'Re-run domain suggestions?' : 'Suggest domains with Claude?',
      whatItDoes:
        'Sends the Exact Domain Match prompt to Claude and fills the suggestion list. You still pick a host, buy it, and Continue. Availability is Claude’s guess only.',
      estimateLabel:
        lastCost != null
          ? `Last run: ${formatUsd(lastCost)}`
          : `~${formatUsd(priced.costUsd)} (${inputTokens.toLocaleString()} in + ~${outputTokens.toLocaleString()} out tokens)`,
      estimateUsdLow: lastCost ?? priced.costUsd,
      estimateUsdHigh: lastCost ?? priced.costUsd,
      estimateDetail:
        lastCost != null
          ? 'Using your last domain-suggest cost for this candidate as the estimate.'
          : priced.costNote,
      model: defaultModel(),
      inputTokensEst: inputTokens,
      outputTokensEst: outputTokens,
      willOverwrite: lastCost != null,
      overwriteNote: lastCost != null
        ? 'Running again replaces the suggestion list and clears any selected or custom host.'
        : null,
      confirmLabel:
        lastCost != null
          ? `Suggest domains (est. ${formatUsd(lastCost)})`
          : `Suggest domains (est. ${formatUsd(priced.costUsd)})`,
      freeFallback: 'Prefer Copy & paste? Switch the header toggle.',
    };
  }

  if (act === 'site-config' || act === 'generate-site-config' || act === 'siteConfig') {
    const lastCost = last.siteConfig ?? null;
    const md = readPromptFile('prompts/claude-site-config.md');
    const packBlob = JSON.stringify(detail.approved || {});
    const inputTokens = estimateTokensFromText(`${md}${packBlob}`);
    const outputTokens = 2500;
    const priced = estimateClaudeCostUsd({
      inputTokens,
      outputTokens,
      model: defaultModel(),
    });
    const hasDraft = Boolean(detail.siteConfigDraft || detail.stageFlags?.hasSiteConfig);
    return {
      act: 'site-config',
      provider: 'anthropic',
      title: lastCost != null || hasDraft ? 'Re-run Fill site-config?' : 'Fill site-config with Claude?',
      whatItDoes:
        'Sends the Business details NAP plus approved narrative package to Claude and loads a site-config draft. You still Review services and Accept. Does not write the live config.',
      estimateLabel:
        lastCost != null
          ? `Last run: ${formatUsd(lastCost)}`
          : `~${formatUsd(priced.costUsd)} (${inputTokens.toLocaleString()} in + ~${outputTokens.toLocaleString()} out tokens)`,
      estimateUsdLow: lastCost ?? priced.costUsd,
      estimateUsdHigh: lastCost ?? priced.costUsd,
      estimateDetail:
        lastCost != null
          ? 'Using your last Fill site-config cost for this candidate as the estimate.'
          : priced.costNote,
      model: defaultModel(),
      inputTokensEst: inputTokens,
      outputTokensEst: outputTokens,
      willOverwrite: Boolean(detail.siteConfigDraft),
      overwriteNote: detail.siteConfigDraft
        ? 'Running again replaces the current site-config draft. Accept is still in Review services.'
        : null,
      confirmLabel:
        lastCost != null
          ? `Fill site-config (est. ${formatUsd(lastCost)})`
          : `Fill site-config (est. ${formatUsd(priced.costUsd)})`,
      freeFallback: 'Prefer Copy & paste? Switch the header toggle.',
    };
  }

  if (act === 'write-site' || act === 'writeSite') {
    const lastCost = last.writeSite ?? null;
    const photosOn = Boolean(
      Object.values(detail.contentStructure?.photos || {}).some((p) => p && p.enabled),
    );
    const low = lastCost ?? 1.8;
    const high = lastCost ?? (photosOn ? 4.0 : 3.2);
    return {
      act: 'write-site',
      provider: 'anthropic',
      title: 'Write site with Claude?',
      whatItDoes:
        'Runs Site research, Brief, Outline, Full write, Speech/SEO polish, and Image queries (when photos are on) via the Anthropic API. Skips steps that are already loaded. You can Stop; finished files are kept.',
      estimateLabel:
        lastCost != null ? `Last run: ${formatUsd(lastCost)}` : formatRange(low, high),
      estimateUsdLow: low,
      estimateUsdHigh: high,
      estimateDetail:
        lastCost != null
          ? 'Using your last Write site cost for this candidate as the estimate.'
          : `Typical ${photosOn ? 'large' : 'medium'} site. Actual depends on pages already written and Claude tokens.`,
      willOverwrite: Boolean(
        detail.stageFlags?.hasContentDraft || detail.stageFlags?.hasContentBrief,
      ),
      overwriteNote: null,
      confirmLabel:
        lastCost != null ? `Write site (est. ${formatUsd(lastCost)})` : `Write site (est. ${formatRange(low, high)})`,
      freeFallback: 'Prefer Copy & paste? Switch the header toggle.',
    };
  }

  if (act === 'expand-locations' || act === 'expandLocations') {
    const lastCost = last.expandLocations ?? null;
    const low = lastCost ?? 0.12;
    const high = lastCost ?? 0.45;
    return {
      act: 'expand-locations',
      provider: 'anthropic',
      title: 'Expand location pages?',
      whatItDoes:
        'Sends only the thin location Markdown files back to Claude to add unique local copy until each body is at least 450 words. Home and service pages stay as they are.',
      estimateLabel:
        lastCost != null ? `Last run: ${formatUsd(lastCost)}` : formatRange(low, high),
      estimateUsdLow: low,
      estimateUsdHigh: high,
      estimateDetail:
        lastCost != null
          ? 'Using your last Expand location pages cost for this candidate as the estimate.'
          : 'Typical 1–3 thin location files. Actual depends on Claude tokens.',
      willOverwrite: Boolean(detail.stageFlags?.hasContentDraft),
      overwriteNote: 'Rewrites the thin location draft files only.',
      confirmLabel:
        lastCost != null
          ? `Expand pages (est. ${formatUsd(lastCost)})`
          : `Expand pages (est. ${formatRange(low, high)})`,
      freeFallback: null,
    };
  }

  throw Object.assign(new Error(`Unknown act for cost preview: ${act}`), { status: 400 });
}

/**
 * Aggregated cost preview for multi-candidate batch runs.
 */
export function getBatchCostPreview(candidateIds = [], act, opts = {}) {
  const ids = [...new Set(candidateIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const evalAll = act === 'evaluate-all' || act === 'evaluateAll';
  const mode = evalAll ? normalizeEvalRunMode(opts.evalRunMode) : EVAL_RUN_MODE_ALL;
  const required = evalAll && mode === EVAL_RUN_MODE_REQUIRED;
  const previews = [];
  const errors = [];
  let low = 0;
  let high = 0;
  let overwriteCount = 0;
  for (const id of ids) {
    try {
      const p = getCostPreview(id, act, { evalRunMode: mode });
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
  const provider =
    previews[0]?.provider ||
    (evalAll ? 'mixed' : act === 'narrative' ? 'anthropic' : 'dataforseo');
  const actTitle = evalAll
    ? required
      ? 'Run all required'
      : 'Run all'
    : act === 'research'
      ? 'Ad volumes'
      : act === 'enrich'
        ? 'enrich'
        : act;
  const same = Math.abs(low - high) < 0.0001;
  return {
    act: evalAll ? 'evaluate-all' : act,
    evalRunMode: evalAll ? mode : undefined,
    provider,
    count: ids.length,
    runnable: previews.length,
    title: evalAll
      ? required
        ? `Run all required on ${ids.length}?`
        : `Run all missing evaluations on ${ids.length}?`
      : `Batch ${actTitle} on ${ids.length}?`,
    estimateUsdLow: Number(low.toFixed(4)),
    estimateUsdHigh: Number(high.toFixed(4)),
    estimateLabel:
      same
        ? `~${formatUsd(low)} for ${previews.length} candidates`
        : `${formatUsd(low)}–${formatUsd(high)} for ${previews.length} candidates`,
    estimateDetail: evalAll
      ? required
        ? `Cheapest Research path (SERP seeds + Narrative). Skips Ads volumes, Enrich, and Prospects. Sum of remaining steps (${previews.length} runnable${
            errors.length ? `, ${errors.length} skipped` : ''
          }).`
        : `Fill-gaps 1–4. Ad volumes: Live, no Force new SERP. Narrative uses the Anthropic API. Sum of remaining steps (${previews.length} runnable${
            errors.length ? `, ${errors.length} skipped` : ''
          }).`
      : `Sum of per-candidate estimates (${previews.length} runnable${
          errors.length ? `, ${errors.length} skipped` : ''
        }).`,
    whatItDoes: evalAll
      ? required
        ? 'Runs missing required Research steps (SERP seeds → Narrative). Enough to Accept, set pursue, and build. Website Write still has its own Claude cost later.'
        : 'Runs missing Evaluations in order (SERP / Volume → Enrich → Narrative → Prospects). Skips steps that already have data.'
      : null,
    willOverwrite: overwriteCount > 0,
    overwriteNote:
      overwriteCount > 0
        ? `${overwriteCount} of ${previews.length} already have this stage data and would be overwritten.`
        : null,
    confirmLabel: evalAll
      ? `${required ? 'Run all required' : 'Run all'} on ${previews.length} (est. ${
          same ? formatUsd(low) : `${formatUsd(low)}–${formatUsd(high)}`
        })`
      : `Run on ${previews.length} (est. ${
          same ? formatUsd(low) : `${formatUsd(low)}–${formatUsd(high)}`
        })`,
    errors,
    previews,
  };
}
