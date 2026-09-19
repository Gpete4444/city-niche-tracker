/**
 * Cluster Generate pack: split pinned cities across Claude calls, merge once.
 */
import { extractCsvFromChatPaste, parseCsv } from './discovery.mjs';
import { placeKey } from './shotgun.mjs';

export const GENERATE_PACK_CHUNK = 20;

export function chunkPinnedRows(rows, size = GENERATE_PACK_CHUNK) {
  const list = Array.isArray(rows) ? rows : [];
  const n = Math.max(1, Math.round(Number(size) || GENERATE_PACK_CHUNK));
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

export function generatePackChunkMaxTokens(rowCount) {
  const n = Math.min(100, Math.max(1, Number(rowCount) || 1));
  return Math.min(16384, Math.max(6144, n * 200));
}

export function generatePackChunkCount(rowCount, size = GENERATE_PACK_CHUNK) {
  const n = Math.max(0, Number(rowCount) || 0);
  if (!n) return 1;
  return Math.ceil(n / Math.max(1, Number(size) || GENERATE_PACK_CHUNK));
}

export function formatGeneratePackSiblings(members) {
  const lines = (members || []).map((m) => `${m.city}, ${m.state} (${m.role})`).filter((s) => s.trim());
  return lines.join('\n') || '(none)';
}

export function parseGeneratePackCsv(text) {
  const extracted = extractCsvFromChatPaste(text);
  return parseCsv(extracted);
}

export function mergeGeneratePackRows(chunks) {
  const byKey = new Map();
  for (const rows of chunks || []) {
    for (const row of rows || []) {
      const k = placeKey(row.City, row.State);
      if (!k) continue;
      byKey.set(k, row);
    }
  }
  return [...byKey.values()];
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw Object.assign(new Error('Stopped'), { status: 499, cancelled: true });
  }
}

/**
 * Sequential Claude fills. Retry a truncated chunk once; then split in half.
 * Fails only if a 1-city chunk still hits the token cap.
 *
 * @param {{
 *   pinnedRows: object[],
 *   buildPrompt: (chunkRows: object[]) => string,
 *   claudeMessagesFn: (opts: object) => Promise<{ text: string, costUsd?: number, usage?: object, truncated?: boolean }>,
 *   signal?: AbortSignal,
 *   onChunk?: (info: { index: number, total: number, cities: number, retry: boolean }) => void,
 * }} opts
 */
export async function fillGeneratePackRowChunks({
  pinnedRows = [],
  buildPrompt,
  claudeMessagesFn,
  signal,
  onChunk,
} = {}) {
  const work = chunkPinnedRows(pinnedRows).map((rows) => ({ rows, retried: false }));
  if (!work.length) {
    return { rows: [], costUsd: 0, usage: null, calls: 0 };
  }
  const collected = [];
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let calls = 0;
  let i = 0;
  while (i < work.length) {
    throwIfAborted(signal);
    const item = work[i];
    onChunk?.({
      index: i + 1,
      total: work.length,
      cities: item.rows.length,
      retry: item.retried,
    });
    const result = await claudeMessagesFn({
      user: buildPrompt(item.rows),
      maxTokens: generatePackChunkMaxTokens(item.rows.length),
      effort: 'low',
      signal,
    });
    calls += 1;
    if (result?.costUsd != null) costUsd += Number(result.costUsd) || 0;
    inputTokens += Number(result?.usage?.input_tokens) || 0;
    outputTokens += Number(result?.usage?.output_tokens) || 0;
    if (result?.truncated) {
      if (!item.retried) {
        work[i] = { rows: item.rows, retried: true };
        continue;
      }
      if (item.rows.length <= 1) {
        throw Object.assign(new Error('Claude hit the token cap — retry Generate cluster pack.'), {
          status: 502,
        });
      }
      const mid = Math.ceil(item.rows.length / 2);
      work.splice(
        i,
        1,
        { rows: item.rows.slice(0, mid), retried: false },
        { rows: item.rows.slice(mid), retried: false },
      );
      continue;
    }
    const parsed = parseGeneratePackCsv(result?.text || '');
    if (!parsed.length) {
      throw Object.assign(new Error('CSV has no data rows'), { status: 400 });
    }
    collected.push(parsed);
    i += 1;
  }
  return {
    rows: mergeGeneratePackRows(collected),
    costUsd: costUsd || null,
    usage:
      inputTokens || outputTokens
        ? { input_tokens: inputTokens, output_tokens: outputTokens }
        : null,
    calls,
  };
}
