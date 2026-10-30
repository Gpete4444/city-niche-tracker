/**
 * Cluster Generate pack: split pinned cities across Claude calls, merge once.
 */
import {
  DISCOVERY_CLAUDE_COLUMNS,
  extractCsvFromChatPaste,
  parseCsv,
  parseCsvRecords,
  rowsToCsv,
} from './discovery.mjs';
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

function fenceBodies(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const bodies = [];
  const re = /```(?:csv|text)?\s*\r?\n([\s\S]*?)```/gi;
  let match = re.exec(raw);
  while (match) {
    bodies.push(match[1]);
    match = re.exec(raw);
  }
  return bodies.length ? bodies : [raw];
}

/** Data rows with no header, same width as the pinned template. Cluster pack only. */
function headerlessPinnedCsv(text) {
  const width = DISCOVERY_CLAUDE_COLUMNS.length;
  const headerNames = new Set(DISCOVERY_CLAUDE_COLUMNS.map((col) => col.toLowerCase()));
  for (const body of fenceBodies(text)) {
    const records = parseCsvRecords(body);
    if (!records.length || !records.every((row) => row.length === width)) continue;
    const firstCell = String(records[0][0] || '').trim().toLowerCase();
    if (headerNames.has(firstCell)) continue;
    const rows = records.map((cells) => {
      const obj = {};
      DISCOVERY_CLAUDE_COLUMNS.forEach((col, idx) => {
        obj[col] = cells[idx] ?? '';
      });
      return obj;
    });
    return rowsToCsv(rows, DISCOVERY_CLAUDE_COLUMNS);
  }
  return null;
}

export function parseGeneratePackCsv(text) {
  try {
    return parseCsv(extractCsvFromChatPaste(text));
  } catch (err) {
    if (!/No CSV header found/.test(String(err?.message || ''))) throw err;
    const recovered = headerlessPinnedCsv(text);
    if (!recovered) throw err;
    return parseCsv(recovered);
  }
}

const FORMAT_RETRY_SUFFIX =
  '\n\nYour previous reply had no CSV header. Reply with only one ```csv fence. The first line must start with Niche,';

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
 * A reply with no CSV header is retried once before the job fails.
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
  const work = chunkPinnedRows(pinnedRows).map((rows) => ({
    rows,
    retried: false,
    formatRetried: false,
  }));
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
    const user = item.formatRetried
      ? `${buildPrompt(item.rows)}${FORMAT_RETRY_SUFFIX}`
      : buildPrompt(item.rows);
    const result = await claudeMessagesFn({
      user,
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
        work[i] = { rows: item.rows, retried: true, formatRetried: Boolean(item.formatRetried) };
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
        { rows: item.rows.slice(0, mid), retried: false, formatRetried: false },
        { rows: item.rows.slice(mid), retried: false, formatRetried: false },
      );
      continue;
    }
    let parsed;
    try {
      parsed = parseGeneratePackCsv(result?.text || '');
    } catch (err) {
      if (!item.formatRetried && /No CSV header found/.test(String(err?.message || ''))) {
        work[i] = { rows: item.rows, retried: Boolean(item.retried), formatRetried: true };
        continue;
      }
      throw err;
    }
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
