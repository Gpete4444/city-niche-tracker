/**
 * Anthropic API Generate pack: Claude fills the Discovery CSV, then Rover imports
 * the same path as paste Import Claude CSV.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { claudeMessages, defaultModel } from './claude.mjs';
import { buildDiscoveryApiPrompt, getBatch, importDiscoveryCsv } from './discovery.mjs';
import { estimateClaudeCostUsd, estimateTokensFromText } from './cost-estimates.mjs';
import { recordRoverApiSpend } from './rover-api-spend.mjs';
import { updateLightJobProgress } from './rover-light-jobs.mjs';

function formatUsd(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return `$${Number(n).toFixed(Number(n) < 0.1 ? 4 : 2)}`;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw Object.assign(new Error('Stopped'), { status: 499, cancelled: true });
  }
}

function generatePackMaxTokens(maxRows) {
  const n = Math.min(100, Math.max(1, Number(maxRows) || 40));
  return Math.min(16384, Math.max(6144, n * 200));
}

function patchBatchMeta(batchId, patch) {
  const { batch, dir } = getBatch(batchId);
  const next = {
    ...batch,
    ...patch,
    lastCosts: { ...(batch.lastCosts || {}), ...(patch.lastCosts || {}) },
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(dir, 'meta.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function getGeneratePackCostPreview(batchId) {
  const { batch } = getBatch(batchId);
  const prompt = buildDiscoveryApiPrompt(batchId);
  const inputTokens = estimateTokensFromText(prompt);
  const maxRows = Math.min(100, Math.max(1, Number(batch.filters?.maxRows) || 40));
  const outputTokens = Math.min(8000, Math.max(2500, maxRows * 80));
  const priced = estimateClaudeCostUsd({
    inputTokens,
    outputTokens,
    model: defaultModel(),
  });
  const lastCost = batch.lastCosts?.generatePack ?? null;
  const hasRows = Number(batch.rowCount) > 0 || Boolean(batch.files?.lastImport);
  return {
    act: 'generate-pack',
    provider: 'anthropic',
    title: hasRows ? 'Re-run Generate pack?' : 'Generate pack with Claude?',
    whatItDoes:
      'Sends this batch’s Discovery prompt to Claude. Rover imports the CSV into the table for glance/fix, then Light SERP. Same files as Import Claude CSV.',
    estimateLabel:
      lastCost != null
        ? `Last run: ${formatUsd(lastCost)}`
        : `~${formatUsd(priced.costUsd)} (${inputTokens.toLocaleString()} in + ~${outputTokens.toLocaleString()} out tokens)`,
    estimateUsdLow: lastCost ?? priced.costUsd,
    estimateUsdHigh: lastCost ?? priced.costUsd,
    estimateDetail:
      lastCost != null
        ? 'Using your last Generate pack cost for this batch as the estimate.'
        : priced.costNote,
    model: defaultModel(),
    willOverwrite: hasRows,
    overwriteNote: hasRows
      ? 'This batch already has Claude rows. Running again replaces the imported CSV.'
      : null,
    confirmLabel:
      lastCost != null
        ? `Generate pack (est. ${formatUsd(lastCost)})`
        : `Generate pack (est. ${formatUsd(priced.costUsd)})`,
    freeFallback: null,
  };
}

/**
 * @param {string} batchId
 * @param {{ jobId: string, signal?: AbortSignal }} ctx
 */
export async function runGeneratePackJob(batchId, { jobId, signal } = {}) {
  const { batch } = getBatch(batchId);
  const prompt = buildDiscoveryApiPrompt(batchId);
  const maxRows = Math.min(100, Math.max(1, Number(batch.filters?.maxRows) || 40));
  const maxTokens = generatePackMaxTokens(maxRows);
  const tick = (detail, done) => {
    updateLightJobProgress(jobId, { detail, done, total: 2 });
  };
  tick('Calling Claude', 1);
  throwIfAborted(signal);
  const { text, costUsd, costNote, usage, truncated } = await claudeMessages({
    user: prompt,
    maxTokens,
    effort: 'low',
    signal,
  });
  if (truncated) {
    throw Object.assign(
      new Error('Claude hit the token cap — CSV incomplete. Retry Generate pack.'),
      { status: 502 },
    );
  }
  if (costUsd != null) {
    recordRoverApiSpend('anthropic', costUsd);
    patchBatchMeta(batchId, { lastCosts: { generatePack: costUsd } });
  }
  throwIfAborted(signal);
  tick('Importing CSV', 2);
  const imported = importDiscoveryCsv(batchId, text, { createIfMissing: false });
  tick('Done', 2);
  return {
    ok: true,
    batch: imported.batch,
    rowCount: imported.batch?.rowCount ?? imported.rows?.length ?? 0,
    costUsd: costUsd ?? null,
    costNote: costNote ?? null,
    usage: usage ?? null,
  };
}
