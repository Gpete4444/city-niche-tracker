/**
 * Anthropic API Generate pack: Claude fills the Discovery CSV, then Rover imports
 * the same path as paste Import Claude CSV.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { claudeMessages, defaultModel } from './claude.mjs';
import { getBatch, importDiscoveryCsv } from './discovery.mjs';
import { estimateClaudeCostUsd, estimateTokensFromText } from './cost-estimates.mjs';
import { recordRoverApiSpend } from './rover-api-spend.mjs';
import { updateLightJobProgress } from './rover-light-jobs.mjs';

const API_CSV_APPENDIX = `

## Anthropic Messages (Rover API)

You cannot write files into the repo. File and artifact tools are unavailable.

Use Notes: FALLBACK_FENCE. After the DONE block, output exactly one \`\`\`csv fence containing the complete CSV (header row + data rows). Do not paste CSV as unfenced prose.
`;

function formatUsd(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return `$${Number(n).toFixed(Number(n) < 0.1 ? 4 : 2)}`;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw Object.assign(new Error('Stopped'), { status: 499, cancelled: true });
  }
}

function readBatchPrompt(batchId) {
  const { batch, dir } = getBatch(batchId);
  const name = batch.files?.claudePrompt || 'prompt-claude.md';
  const promptPath = path.join(dir, name);
  if (!existsSync(promptPath)) {
    throw Object.assign(
      new Error('No Claude prompt for this pack — Generate Discovery pack first'),
      { status: 400 },
    );
  }
  return {
    batch,
    dir,
    prompt: readFileSync(promptPath, 'utf8'),
  };
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
  const { batch, prompt } = readBatchPrompt(batchId);
  const blob = `${prompt}${API_CSV_APPENDIX}`;
  const inputTokens = estimateTokensFromText(blob);
  const outputTokens = 6000;
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
    freeFallback: 'Prefer Copy & paste? Switch the header toggle.',
  };
}

/**
 * @param {string} batchId
 * @param {{ jobId: string, signal?: AbortSignal }} ctx
 */
export async function runGeneratePackJob(batchId, { jobId, signal } = {}) {
  const { prompt } = readBatchPrompt(batchId);
  const tick = (detail, done) => {
    updateLightJobProgress(jobId, { detail, done, total: 2 });
  };
  tick('Calling Claude', 1);
  throwIfAborted(signal);
  const { text, costUsd, costNote, usage } = await claudeMessages({
    user: `${prompt}${API_CSV_APPENDIX}`,
    maxTokens: 16384,
    temperature: 0.3,
    signal,
  });
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
