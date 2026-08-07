/**
 * Discovery stage: free CSV pack + Claude/Gemini prompts + batch import.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { lookupPopulation, censusStatus } from './census.mjs';
import { applyRecommendations, DISCOVERY_DECISIONS } from './discovery-recommend.mjs';
import { createCandidate, setDecision, pathsFor, saveMeta } from './candidates.mjs';
import {
  findCandidateByGeo,
  formatKnownCandidatesForPrompt,
  knownCandidatesCount,
  regenerateKnownCandidates,
} from './known-candidates.mjs';
import { startBatchJobs } from './batch-jobs.mjs';
import { isSerpCacheFresh, readSerpCache, serpCachePath } from '../../scripts/lib/serp-cache.mjs';

const ROOT = process.cwd();
const BATCHES_DIR = path.join(ROOT, 'research', 'batches');

export const DISCOVERY_COLUMNS = [
  'Niche',
  'City',
  'State',
  'Population',
  'Google Search Link',
  'Score',
  'Est. Cluster Volume',
  'Top Target Keywords & Volumes',
  'Average Job Cost',
  'Est. time to rank with GBP',
  'Est. time to rank without GBP',
  'Map Pack',
  'GBP Serves Location',
  'Directories',
  'Organic Home Page',
  'Organic Sub Page',
  'Directories (Links)',
  'Organic Home Page (Links)',
  'Organic Sub Page (Links)',
  'pain_points',
  'suggested_services',
  'suggested_suburbs',
  'da_est',
  'backlinks_est',
  'confidence_serp',
  'confidence_narrative',
  'claude_serp_audit',
  'recommended_decision',
  'recommended_reason',
  'human_decision',
  'decision_notes',
  'candidateId',
  'source_mode',
  'serp_source',
];

const WIZARD_NICHES = [
  'Roof Repair',
  'Drywall Repair',
  'Concrete Repair',
  'Kitchen & Bathroom Remodeling',
  'Mold Removal',
  'Commercial Roof Repair',
];

const CATALOG_CATEGORIES = [
  'Plumbing',
  'Electrical',
  'Concrete & Masonry',
  'Exterior Home',
  'Interior Remodeling',
  'Stairs, Railings & Architectural Metalwork',
  'HVAC & Climate',
  'Water & Fire Damage Restoration',
  'Landscaping & Outdoor Living',
  'Roofing & Waterproofing',
  'Flooring & Surface Specialty',
  'Windows, Doors & Glass',
  'Tree & Land Services',
  'Specialty Trades & Luxury',
  'Commercial & Industrial Services',
];

const TIER_RANK = { platinum: 4, gold: 3, silver: 2, bronze: 1 };


function ensureBatchesDir() {
  mkdirSync(BATCHES_DIR, { recursive: true });
}

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function loadNicheJobCosts() {
  return readJson(path.join(ROOT, 'data', 'niche-job-costs.json'), []) || [];
}

function slugBatchId(label) {
  const base = String(label || 'batch')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${base || 'batch'}-${stamp}`;
}

function googleSearchLink(niche, city, state) {
  const q = encodeURIComponent(`${niche} ${city} ${state}`);
  return `https://www.google.com/search?q=${q}`;
}

function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv(rows, columns = DISCOVERY_COLUMNS) {
  const lines = [columns.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(columns.map((col) => csvEscape(row[col] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Minimal CSV parser supporting quotes and newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  const s = String(text || '').replace(/^\uFEFF/, '');

  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((c) => String(c).trim() !== '')) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  row.push(cell);
  if (row.some((c) => String(c).trim() !== '')) rows.push(row);

  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cells[idx] ?? '';
    });
    return obj;
  });
}

function readPromptTemplate(relativePath) {
  const full = path.join(ROOT, relativePath);
  if (!existsSync(full)) throw new Error(`Prompt not found: ${relativePath}`);
  return readFileSync(full, 'utf8');
}

function normalizeFilters(filters = {}) {
  const stateRaw = String(filters.state || '')
    .trim()
    .toUpperCase();
  const state = stateRaw.length === 2 ? stateRaw : '';
  const niches = (filters.niches || []).map((n) => String(n).trim()).filter(Boolean);
  const cities = (filters.cities || []).map((c) => String(c).trim()).filter(Boolean);
  const categories = (filters.categories || [])
    .map((c) => String(c).trim())
    .filter(Boolean);
  const maxRows = Math.min(100, Math.max(1, Number(filters.maxRows) || 40));
  const minPopulation = Number(filters.minPopulation);
  const maxPopulation = Number(filters.maxPopulation);
  const seasonalityRaw = String(filters.seasonality || 'year_round').toLowerCase();
  const seasonality = ['year_round', 'allow_seasonal', 'seasonal_only'].includes(seasonalityRaw)
    ? seasonalityRaw
    : 'year_round';
  const order = ['platinum', 'gold', 'silver', 'bronze'];
  let tiers = (filters.tiers || [])
    .map((t) => String(t).trim().toLowerCase())
    .filter((t) => TIER_RANK[t]);
  // Backward compat: old minTier "gold" meant Gold+
  if (!tiers.length && filters.minTier) {
    const minTierRaw = String(filters.minTier).toLowerCase();
    const min = TIER_RANK[minTierRaw] || 3;
    tiers = order.filter((t) => TIER_RANK[t] >= min);
  }
  if (!tiers.length) tiers = ['platinum', 'gold'];
  const mapPackRaw = String(filters.mapPackPreference || 'prefer_absent').toLowerCase();
  const mapPackPreference = ['prefer_absent', 'allow_present', 'prefer_present'].includes(mapPackRaw)
    ? mapPackRaw
    : 'prefer_absent';
  const minJobCost = Number(filters.minJobCost);
  return {
    state,
    niches,
    cities,
    categories,
    maxRows,
    minPopulation: Number.isFinite(minPopulation) ? minPopulation : 70000,
    maxPopulation: Number.isFinite(maxPopulation) ? maxPopulation : 200000,
    seasonality,
    tiers,
    mapPackPreference,
    minJobCost: Number.isFinite(minJobCost) && minJobCost > 0 ? minJobCost : null,
  };
}

function autoLabel(f) {
  const statePart = f.state || 'us';
  const nichePart = f.niches.length
    ? f.niches
        .slice(0, 2)
        .map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
        .join('-')
    : f.categories.length
      ? f.categories
          .slice(0, 2)
          .map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
          .join('-')
      : 'open-niches';
  return `${statePart}-${nichePart}`;
}

function seasonalityLabel(v) {
  if (v === 'allow_seasonal') return 'Allow seasonal (prefer year-round)';
  if (v === 'seasonal_only') return 'Seasonal-only OK / prefer seasonal demand';
  return 'Year-round only (default)';
}

function tiersLabel(tiers) {
  const order = ['platinum', 'gold', 'silver', 'bronze'];
  const set = new Set(tiers);
  const picked = order.filter((t) => set.has(t)).map((t) => t[0].toUpperCase() + t.slice(1));
  return picked.length ? picked.join(' / ') : 'Platinum / Gold (default)';
}

function mapPackLabel(v) {
  if (v === 'allow_present') return 'Allow Map Pack present';
  if (v === 'prefer_present') return 'Prefer Map Pack present (soft)';
  return 'Prefer Map Pack absent (soft — estimate after Claude)';
}

/** Human-readable filter brief injected into Claude/Gemini prompts. */
export function buildFilterBrief(filters = {}) {
  const f = normalizeFilters(filters);
  const lines = [
    '## Operator filters (from Rank & Rent Ops)',
    '',
    `- **State:** ${f.state || 'ANY (nationwide — pick the best US markets)'}`,
    `- **Niches:** ${
      f.niches.length
        ? f.niches.join('; ')
        : 'OPEN — choose from the High-Ticket catalog; include **at least 3 different niches** when possible'
    }`,
    `- **Catalog categories:** ${
      f.categories.length
        ? f.categories.join('; ')
        : 'ALL categories in the High-Ticket catalog'
    }`,
    `- **Cities:** ${
      f.cities.length
        ? f.cities.join('; ')
        : f.state
          ? `OPEN within ${f.state} — choose the best cities in that state`
          : 'OPEN nationwide — choose the best cities'
    }`,
    `- **Population band (prefer):** ${f.minPopulation.toLocaleString()} – ${f.maxPopulation.toLocaleString()} (incorporated place / city proper when known)`,
    `- **Seasonality:** ${seasonalityLabel(f.seasonality)}`,
    `- **Ticket tiers allowed:** ${tiersLabel(f.tiers)} — only niches in these catalog tiers`,
    `- **Min job cost:** ${
      f.minJobCost != null
        ? `$${f.minJobCost.toLocaleString()}+ average job (approximate)`
        : 'None beyond tier filter'
    }`,
    `- **Map Pack preference:** ${mapPackLabel(f.mapPackPreference)}`,
    `- **Max rows:** ${f.maxRows}`,
    '',
    'Respect these constraints. Prefer real municipalities. Do not invent fake cities.',
  ];
  return lines.join('\n');
}

function loadHighTicketNiches() {
  const full = path.join(ROOT, 'data', 'high-ticket-rank-and-rent-niches.md');
  if (!existsSync(full)) {
    return '_High-ticket niches catalog missing at data/high-ticket-rank-and-rent-niches.md._';
  }
  return readFileSync(full, 'utf8').trimEnd();
}

function fillPrompt(relativePath, vars = {}) {
  const md = readPromptTemplate(relativePath);
  let out = md;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value == null ? '' : String(value));
  }
  return out;
}

/**
 * Empty template — Claude chooses rows. Headers only.
 */
export function buildEmptyTemplateRows() {
  return [];
}

export function createDiscoveryPack(filters = {}) {
  ensureBatchesDir();
  const f = normalizeFilters(filters);
  const rows = buildEmptyTemplateRows();
  const csv = rowsToCsv(rows);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const label = autoLabel(f);
  const batchId = slugBatchId(label);
  const dir = path.join(BATCHES_DIR, batchId);
  mkdirSync(dir, { recursive: true });

  const outputBasename = `discovery-${label}-${stamp}`;
  const csvName = `${outputBasename}.csv`;
  const claudeCsvName = `${outputBasename}-claude.csv`;
  const geminiCsvName = `${outputBasename}-gemini.csv`;
  writeFileSync(path.join(dir, csvName), csv, 'utf8');

  const filterBrief = buildFilterBrief(f);
  const highTicketNiches = loadHighTicketNiches();
  const promptVars = {
    FILTER_BRIEF: filterBrief,
    DISCOVERY_CSV: csv.trimEnd(),
    OUTPUT_BASENAME: outputBasename,
    CLAUDE_OUTPUT_CSV: claudeCsvName,
    GEMINI_OUTPUT_CSV: geminiCsvName,
    BATCH_DIR: dir,
    HIGH_TICKET_NICHES: highTicketNiches,
    KNOWN_CANDIDATES: formatKnownCandidatesForPrompt({
      stateFilter: f.state || null,
      limit: 500,
    }),
  };
  const claudePrompt = fillPrompt('prompts/discovery-claude.md', promptVars);
  const emptyDelta = rowsToGeminiDeltaCsv([]);
  const geminiPrompt = fillPrompt('prompts/discovery-gemini.md', {
    ...promptVars,
    GEMINI_DELTA_CSV: emptyDelta.trimEnd(),
    HIGH_TICKET_NICHES: '',
  });
  writeFileSync(path.join(dir, 'prompt-claude.md'), claudePrompt, 'utf8');
  writeFileSync(path.join(dir, 'prompt-gemini.md'), geminiPrompt, 'utf8');
  writeFileSync(path.join(dir, 'filters.md'), `${filterBrief}\n`, 'utf8');

  const meta = {
    id: batchId,
    createdAt: new Date().toISOString(),
    stage: 'discovery_pack',
    filters: {
      state: f.state || null,
      niches: f.niches,
      cities: f.cities,
      categories: f.categories,
      minPopulation: f.minPopulation,
      maxPopulation: f.maxPopulation,
      maxRows: f.maxRows,
      seasonality: f.seasonality,
      tiers: f.tiers,
      minJobCost: f.minJobCost,
      mapPackPreference: f.mapPackPreference,
      label,
    },
    files: {
      csv: csvName,
      claudeCsv: claudeCsvName,
      geminiCsv: geminiCsvName,
      claudePrompt: 'prompt-claude.md',
      geminiPrompt: 'prompt-gemini.md',
      filters: 'filters.md',
    },
    outputBasename,
    rowCount: 0,
    census: censusStatus(),
  };
  writeJson(path.join(dir, 'meta.json'), meta);

  return {
    batch: meta,
    csv,
    csvName,
    claudeCsvName,
    geminiCsvName,
    outputBasename,
    batchDir: dir,
    claudePrompt,
    geminiPrompt,
    filterBrief,
    rows,
    knownCandidatesCount: knownCandidatesCount(),
  };
}

export const GEMINI_MERGE_COLUMNS = [
  'Est. Cluster Volume',
  'Top Target Keywords & Volumes',
  'Map Pack',
  'GBP Serves Location',
  'Directories',
  'Organic Home Page',
  'Organic Sub Page',
  'Directories (Links)',
  'Organic Home Page (Links)',
  'Organic Sub Page (Links)',
  'da_est',
  'backlinks_est',
  'confidence_serp',
];

/** Columns Gemini should fill when DFS owns Map Pack/organic (volume delta). */
export const GEMINI_VOLUME_COLUMNS = [
  'Est. Cluster Volume',
  'Top Target Keywords & Volumes',
];

/** Preferred Gemini paste headers (volume delta). */
export const GEMINI_DELTA_COLUMNS = [
  'Niche',
  'City',
  'State',
  ...GEMINI_VOLUME_COLUMNS,
];

/** Competition columns owned by DFS Discovery probe — Gemini must not overwrite after probe. */
export const DFS_SERP_COLUMNS = [
  'Map Pack',
  'GBP Serves Location',
  'Directories',
  'Organic Home Page',
  'Organic Sub Page',
  'Directories (Links)',
  'Organic Home Page (Links)',
  'Organic Sub Page (Links)',
];

const CLAUDE_LOCK_COLUMNS = [
  'Niche',
  'City',
  'State',
  'Average Job Cost',
  'Est. time to rank with GBP',
  'Est. time to rank without GBP',
  'pain_points',
  'suggested_services',
  'suggested_suburbs',
  'confidence_narrative',
];

function isYesNoToken(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  return ['yes', 'y', 'true', '1', 'no', 'n', 'false', '0'].includes(s);
}

/** Word Yes/No only — digits 0/1 are valid count cells, not Map Pack swaps. */
function isYesNoWord(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  return ['yes', 'y', 'true', 'no', 'n', 'false'].includes(s);
}

function normalizeMapPackValue(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';
  if (['yes', 'y', 'true', '1'].includes(s)) return 'Yes';
  if (['no', 'n', 'false', '0'].includes(s)) return 'No';
  return null;
}

function isValidCountCell(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return true;
  if (/^n\/?a$/i.test(s)) return true;
  // Accept numeric counts first (including 0 and 1)
  if (/^\d+(\.\d+)?$/.test(s.replace(/,/g, ''))) return true;
  // Reject Yes/No words that land here after a CSV column shift
  if (isYesNoWord(s)) return false;
  return false;
}

function isValidConfidenceSerp(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return true;
  return ['high', 'medium', 'low'].includes(s);
}

function isValidClusterVolume(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return true;
  if (!/\d/.test(s)) return false;
  // Claude-style "ESTIMATE 34,600" is population, not search volume
  if (/^estimate\b/i.test(s)) return false;
  // Reject pure fragments like "000" from split $15,000
  if (/^\d{1,3}$/.test(s) && Number(s) < 50) return false;
  // Bare city-size integers (e.g. "34600" / "34,600") without range or /mo
  const digitsOnly = s.replace(/[,\s]/g, '');
  if (/^\d{4,}$/.test(digitsOnly) && !/[-–—]|\/\s*mo|\bmo\b|\bper\b|\brange\b/i.test(s)) {
    return false;
  }
  return true;
}

/** True when Population should be replaced by Census (blank or Claude ESTIMATE…). */
export function needsCensusPopulation(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return true;
  if (/^estimate\b/i.test(s)) return true;
  // Non-numeric junk (URLs, notes) — treat as empty for Census fill
  const n = Number(String(s).replace(/estimate\s*/i, '').replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n <= 0) return true;
  return false;
}

function isValidUrlish(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return true;
  return /^https?:\/\//i.test(s) || s.includes('.');
}

/**
 * @returns {{ ok: boolean, value: string, reason?: string }}
 */
export function sanitizeGeminiField(col, raw) {
  const s = raw == null ? '' : String(raw);
  const trimmed = s.trim();
  if (!trimmed) return { ok: true, value: '' };

  if (col === 'Map Pack') {
    const norm = normalizeMapPackValue(trimmed);
    if (norm == null) return { ok: false, value: '', reason: `invalid Map Pack "${trimmed}"` };
    return { ok: true, value: norm };
  }
  if (
    col === 'Organic Home Page' ||
    col === 'Organic Sub Page' ||
    col === 'Directories' ||
    col === 'GBP Serves Location'
  ) {
    if (!isValidCountCell(trimmed)) {
      return { ok: false, value: '', reason: `invalid count in ${col}: "${trimmed}"` };
    }
    return { ok: true, value: trimmed };
  }
  if (col === 'confidence_serp') {
    if (!isValidConfidenceSerp(trimmed)) {
      return { ok: false, value: '', reason: `invalid confidence_serp "${trimmed}"` };
    }
    return { ok: true, value: trimmed.toLowerCase() };
  }
  if (col === 'Est. Cluster Volume') {
    if (!isValidClusterVolume(trimmed)) {
      return { ok: false, value: '', reason: `invalid Est. Cluster Volume "${trimmed}"` };
    }
    return { ok: true, value: trimmed };
  }
  if (
    col === 'Directories (Links)' ||
    col === 'Organic Home Page (Links)' ||
    col === 'Organic Sub Page (Links)'
  ) {
    // Allow multi-line URLs; reject suburb-looking lists without URLs
    if (/;/.test(trimmed) && !/https?:\/\//i.test(trimmed) && !/\.[a-z]{2,}/i.test(trimmed)) {
      return { ok: false, value: '', reason: `${col} looks like suburbs, not links` };
    }
    return { ok: true, value: s };
  }
  if (col === 'da_est' || col === 'backlinks_est') {
    if (isYesNoToken(trimmed)) {
      return { ok: false, value: '', reason: `invalid ${col}` };
    }
    return { ok: true, value: trimmed };
  }
  if (col === 'Top Target Keywords & Volumes') {
    return { ok: true, value: s };
  }
  return { ok: true, value: s };
}

/** Fix common CSV-shift damage: Map Pack got "000", Yes/No landed in Organic Home Page. */
export function healShiftedGeminiRow(g, warnings, rowLabel) {
  const next = { ...g };
  const mapNorm = normalizeMapPackValue(next['Map Pack']);
  const orgRaw = String(next['Organic Home Page'] ?? '').trim();
  if (mapNorm == null && isYesNoWord(orgRaw)) {
    next['Map Pack'] = normalizeMapPackValue(orgRaw);
    next['Organic Home Page'] = '';
    warnings.push(`${rowLabel}: healed Map Pack from Organic Home Page (CSV column shift)`);
  }
  const conf = String(next.confidence_serp ?? '').trim();
  if (conf && !isValidConfidenceSerp(conf) && /;/.test(conf)) {
    next.confidence_serp = '';
    warnings.push(`${rowLabel}: cleared confidence_serp (looked like suburbs — CSV shift)`);
  }
  const vol = String(next['Est. Cluster Volume'] ?? '').trim();
  if (vol && !isValidClusterVolume(vol)) {
    next['Est. Cluster Volume'] = '';
    warnings.push(`${rowLabel}: cleared bad Est. Cluster Volume "${vol}"`);
  }
  return next;
}

function rowsToGeminiDeltaCsv(rows) {
  return rowsToCsv(rows, GEMINI_DELTA_COLUMNS);
}
/** Pull CSV out of Gemini/Claude chat paste (DONE header, fences, or bare CSV). */
/** Header may be Niche,... or "Niche","City",... (Excel / Claude quoted CSV). */
function isDiscoveryCsvHeaderLine(line) {
  return /^"?Niche"?\s*,/i.test(String(line || '').trim());
}

/** Pull CSV out of Gemini/Claude chat paste (DONE header, fences, or bare CSV). */
export function extractCsvFromChatPaste(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  if (!raw.trim()) {
    const err = new Error('Paste is empty');
    err.status = 400;
    throw err;
  }

  const fence = raw.match(/```(?:csv|text)?\s*\r?\n([\s\S]*?)```/i);
  if (fence) {
    const inner = fence[1].trim();
    if (isDiscoveryCsvHeaderLine(inner.split(/\r?\n/)[0]) || /^"?Niche"?\s*,/im.test(inner)) {
      return inner;
    }
  }

  const lines = raw.split(/\r?\n/);
  let start = lines.findIndex((l) => isDiscoveryCsvHeaderLine(l));
  if (start < 0) {
    const err = new Error('No CSV header found (expected a line starting with Niche, or "Niche",)');
    err.status = 400;
    throw err;
  }
  // Drop trailing DONE-only noise already above; keep from header to end, trim trailing blanks
  const body = lines.slice(start);
  while (body.length && !String(body[body.length - 1]).trim()) body.pop();
  return body.join('\n');
}

export function rowKey(row) {
  return [row.Niche, row.City, row.State]
    .map((v) => String(v || '').trim().toLowerCase())
    .join('|');
}

/** Soft fields from Discovery Claude — seed Stage 3 instead of reinventing. */
export function discoveryNarrativeSeedFromRow(row, { batchId = null, rowIndex = null } = {}) {
  return {
    source: 'discovery_claude',
    batchId,
    rowIndex,
    rowKey: rowKey(row),
    capturedAt: new Date().toISOString(),
    niche: row.Niche || null,
    city: row.City || null,
    state: row.State ? String(row.State).toUpperCase() : null,
    population: row.Population || null,
    averageJobCostText: row['Average Job Cost'] || null,
    estTimeToRankWithGbp: row['Est. time to rank with GBP'] || null,
    estTimeToRankWithoutGbp: row['Est. time to rank without GBP'] || null,
    localPainPoints: row.pain_points || null,
    suggestedServices: row.suggested_services || null,
    suggestedSuburbs: row.suggested_suburbs || null,
    confidenceNarrative: row.confidence_narrative || null,
    decisionNotes: row.decision_notes || row.recommended_reason || null,
    humanDecision: row.human_decision || null,
    recommendedDecision: row.recommended_decision || null,
  };
}

function saveMetaSource(candidateId, source) {
  saveMeta(candidateId, { source });
}

function resolveFreshSerpCacheRel(batchDir, key) {
  const abs = serpCachePath(batchDir, key);
  const cache = readSerpCache(abs);
  if (!isSerpCacheFresh(cache)) return null;
  return path.relative(ROOT, abs).replace(/\\/g, '/');
}

function attachDiscoveryArtifacts(candidateId, row, batchDir, batchId, rowIndex) {
  const p = pathsFor(candidateId);
  const key = rowKey(row);
  const serpRel = resolveFreshSerpCacheRel(batchDir, key);
  if (serpRel && existsSync(p.config)) {
    try {
      const config = JSON.parse(readFileSync(p.config, 'utf8'));
      if (config.serpCache !== serpRel) {
        config.serpCache = serpRel;
        writeFileSync(p.config, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      }
    } catch {
      /* ignore */
    }
  }
  const seed = discoveryNarrativeSeedFromRow(row, { batchId, rowIndex });
  writeFileSync(p.discoverySeed, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
  return { serpCache: serpRel, discoverySeed: true };
}

function refreshGeminiPromptForBatch(dir, meta, rows) {
  const fullCsv = rowsToCsv(rows);
  // Volume-only delta — Map Pack/organic come from DFS probe
  const deltaRows = rows.map((r) => {
    const d = { Niche: r.Niche, City: r.City, State: r.State };
    for (const col of GEMINI_VOLUME_COLUMNS) d[col] = r[col] || '';
    return d;
  });
  const deltaCsv = rowsToGeminiDeltaCsv(deltaRows);
  const filterBrief =
    existsSync(path.join(dir, 'filters.md'))
      ? readFileSync(path.join(dir, 'filters.md'), 'utf8').trimEnd()
      : buildFilterBrief(meta.filters || {});
  const outputBasename = meta.outputBasename || `discovery-${meta.filters?.label || 'batch'}`;
  const claudeCsvName = meta.files?.claudeCsv || `${outputBasename}-claude.csv`;
  const geminiCsvName = meta.files?.geminiCsv || `${outputBasename}-gemini.csv`;
  const geminiPrompt = fillPrompt('prompts/discovery-gemini.md', {
    FILTER_BRIEF: filterBrief,
    DISCOVERY_CSV: fullCsv.trimEnd(),
    GEMINI_DELTA_CSV: deltaCsv.trimEnd(),
    OUTPUT_BASENAME: outputBasename,
    CLAUDE_OUTPUT_CSV: claudeCsvName,
    GEMINI_OUTPUT_CSV: geminiCsvName,
    BATCH_DIR: dir,
    HIGH_TICKET_NICHES: '',
  });
  writeFileSync(path.join(dir, 'prompt-gemini.md'), geminiPrompt, 'utf8');
  return geminiPrompt;
}

/**
 * Import Claude (or full) CSV into a batch. Saves *-claude.csv and refreshes Gemini prompt
 * with the real rows embedded so Gemini does not need a separate file upload.
 */
export function importDiscoveryCsv(batchId, csvText, { createIfMissing = true, role = 'claude' } = {}) {
  ensureBatchesDir();
  let id = batchId;
  let dir;
  if (!id && createIfMissing) {
    id = slugBatchId('import');
    dir = path.join(BATCHES_DIR, id);
    mkdirSync(dir, { recursive: true });
  } else {
    id = String(batchId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    dir = path.join(BATCHES_DIR, id);
    if (!existsSync(dir)) {
      if (!createIfMissing) {
        const err = new Error('Batch not found');
        err.status = 404;
        throw err;
      }
      mkdirSync(dir, { recursive: true });
    }
  }

  const extracted = extractCsvFromChatPaste(csvText);
  const rows = parseCsv(extracted);
  if (!rows.length) {
    const err = new Error('CSV has no data rows');
    err.status = 400;
    throw err;
  }

  const prev = readJson(path.join(dir, 'meta.json'), {});
  const minPop = Number(prev.filters?.minPopulation);
  const maxPop = Number(prev.filters?.maxPopulation);
  const bandMin = Number.isFinite(minPop) ? minPop : 70000;
  const bandMax = Number.isFinite(maxPop) ? maxPop : 200000;
  const popWarnings = [];

  let censusFilled = 0;
  let censusMiss = 0;
  for (const row of rows) {
    if (needsCensusPopulation(row.Population) && row.City && row.State) {
      const pop = lookupPopulation(row.City, row.State);
      if (pop != null) {
        row.Population = String(pop);
        censusFilled += 1;
      } else {
        censusMiss += 1;
        // Clear ESTIMATE/junk so UI does not look like official Census
        if (/^estimate\b/i.test(String(row.Population ?? '').trim())) {
          row.Population = '';
        }
      }
    }
    if (!row.source_mode) row.source_mode = 'estimate';
    if (!row['Google Search Link'] && row.Niche && row.City && row.State) {
      row['Google Search Link'] = googleSearchLink(row.Niche, row.City, row.State);
    }
    const pop = Number(String(row.Population || '').replace(/,/g, ''));
    if (Number.isFinite(pop) && (pop < bandMin || pop > bandMax)) {
      const note = `Outside preferred pop band (${bandMin.toLocaleString()}–${bandMax.toLocaleString()})`;
      popWarnings.push(`${row.City || '?'}, ${row.State || '?'}: ${pop.toLocaleString()}`);
      if (!String(row.decision_notes || '').trim()) row.decision_notes = note;
    }
  }

  const scoredRows = applyRecommendations(rows);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const csvName = `discovery-imported-${stamp}.csv`;
  writeFileSync(path.join(dir, csvName), rowsToCsv(scoredRows), 'utf8');
  writeFileSync(path.join(dir, 'candidates.csv'), rowsToCsv(scoredRows), 'utf8');

  const outputBasename = prev.outputBasename || `discovery-${prev.filters?.label || id}-${stamp}`;
  const claudeCsvName = prev.files?.claudeCsv || `${outputBasename}-claude.csv`;
  if (role !== 'gemini') {
    writeFileSync(path.join(dir, claudeCsvName), rowsToCsv(scoredRows), 'utf8');
  }

  const meta = {
    ...prev,
    id,
    updatedAt: new Date().toISOString(),
    stage: role === 'gemini' ? 'discovery_gemini' : 'discovery_claude',
    rowCount: scoredRows.length,
    outputBasename: prev.outputBasename || outputBasename,
    files: {
      ...(prev.files || {}),
      candidates: 'candidates.csv',
      lastImport: csvName,
      claudeCsv: claudeCsvName,
      geminiCsv: prev.files?.geminiCsv || `${outputBasename}-gemini.csv`,
    },
    census: {
      ...censusStatus(),
      filledOnImport: censusFilled,
      missOnImport: censusMiss,
    },
    popBandWarnings: popWarnings.length ? popWarnings : undefined,
  };
  if (!meta.createdAt) meta.createdAt = new Date().toISOString();

  let geminiPrompt = null;
  if (role !== 'gemini') {
    geminiPrompt = refreshGeminiPromptForBatch(dir, meta, scoredRows);
  }

  writeJson(path.join(dir, 'meta.json'), meta);
  return { batch: meta, rows: scoredRows, geminiPrompt };
}

/**
 * Paste Gemini chat output (DONE + CSV / fence). Merges SERP columns onto Claude rows;
 * never overwrites Claude narrative/time-to-rank fields. Writes *-gemini.csv.
 * Validates fields to reject CSV column-shift damage (e.g. Map Pack = "000").
 */
export function mergeGeminiPaste(batchId, pasteText) {
  const { batch, rows, dir } = getBatch(batchId);
  if (!rows.length) {
    const err = new Error('Batch has no Claude rows yet — import Claude CSV first');
    err.status = 400;
    throw err;
  }

  const extracted = extractCsvFromChatPaste(pasteText);
  const geminiRows = parseCsv(extracted);
  if (!geminiRows.length) {
    const err = new Error('Gemini paste has no data rows');
    err.status = 400;
    throw err;
  }

  const byKey = new Map(geminiRows.map((r) => [rowKey(r), r]));
  let matched = 0;
  const missing = [];
  const mergeWarnings = [];

  const mergedRaw = rows.map((base) => {
    const label = `${base.City || '?'}, ${base.State || '?'} · ${base.Niche || '?'}`;
    let g = byKey.get(rowKey(base));
    if (!g) {
      missing.push(label);
      return { ...base };
    }
    matched += 1;
    g = healShiftedGeminiRow(g, mergeWarnings, label);
    const next = { ...base };
    const dfsSerpLocked = String(base.serp_source || '').toLowerCase().includes('dataforseo');
    for (const col of GEMINI_MERGE_COLUMNS) {
      if (g[col] == null || String(g[col]).trim() === '') continue;
      if (dfsSerpLocked && DFS_SERP_COLUMNS.includes(col)) {
        mergeWarnings.push(`${label}: kept DFS ${col} (ignored Gemini)`);
        continue;
      }
      const cleaned = sanitizeGeminiField(col, g[col]);
      if (!cleaned.ok) {
        mergeWarnings.push(`${label}: skipped ${col} — ${cleaned.reason}`);
        continue;
      }
      if (cleaned.value !== '') next[col] = cleaned.value;
    }
    if ((!next['Google Search Link'] || !String(next['Google Search Link']).trim()) && g['Google Search Link']) {
      const link = String(g['Google Search Link']).trim();
      if (isValidUrlish(link)) next['Google Search Link'] = link;
      else mergeWarnings.push(`${label}: skipped Google Search Link (invalid)`);
    }
    if ((!next.decision_notes || !String(next.decision_notes).trim()) && g.decision_notes) {
      const notes = String(g.decision_notes).trim();
      // Don't copy suburb lists into notes
      if (notes && !(notes.includes(';') && /,\s*[A-Z]{2}\b/.test(notes) && notes.length > 80)) {
        next.decision_notes = notes;
      }
    }
    for (const col of CLAUDE_LOCK_COLUMNS) {
      if (base[col] != null && String(base[col]).trim() !== '') next[col] = base[col];
    }
    return next;
  });

  const merged = applyRecommendations(mergedRaw);

  const geminiCsvName = batch.files?.geminiCsv || `${batch.outputBasename || batch.id}-gemini.csv`;
  writeFileSync(path.join(dir, geminiCsvName), rowsToCsv(merged), 'utf8');
  writeFileSync(path.join(dir, 'candidates.csv'), rowsToCsv(merged), 'utf8');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const lastImport = `discovery-gemini-merge-${stamp}.csv`;
  writeFileSync(path.join(dir, lastImport), rowsToCsv(merged), 'utf8');

  const meta = {
    ...batch,
    updatedAt: new Date().toISOString(),
    stage: 'discovery_gemini',
    rowCount: merged.length,
    files: {
      ...(batch.files || {}),
      candidates: 'candidates.csv',
      geminiCsv: geminiCsvName,
      lastImport,
    },
    geminiMerge: {
      matched,
      geminiRowCount: geminiRows.length,
      claudeRowCount: rows.length,
      unmatched: missing,
      warnings: mergeWarnings.slice(0, 50),
      warningCount: mergeWarnings.length,
    },
  };
  writeJson(path.join(dir, 'meta.json'), meta);
  return {
    batch: meta,
    rows: merged,
    matched,
    unmatched: missing,
    mergeWarnings,
  };
}

export function getBatchGeminiPrompt(batchId) {
  const { batch, dir } = getBatch(batchId);
  const promptPath = path.join(dir, batch.files?.geminiPrompt || 'prompt-gemini.md');
  if (!existsSync(promptPath)) {
    const err = new Error('Gemini prompt not found — import Claude CSV first');
    err.status = 404;
    throw err;
  }
  return { batch, geminiPrompt: readFileSync(promptPath, 'utf8') };
}

export function listBatches() {
  ensureBatchesDir();
  return readdirSync(BATCHES_DIR)
    .filter((name) => existsSync(path.join(BATCHES_DIR, name, 'meta.json')))
    .map((name) => readJson(path.join(BATCHES_DIR, name, 'meta.json')))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export function getBatch(batchId) {
  const id = String(batchId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const dir = path.join(BATCHES_DIR, id);
  const meta = readJson(path.join(dir, 'meta.json'));
  if (!meta) {
    const err = new Error('Batch not found');
    err.status = 404;
    throw err;
  }
  const candidatesPath = path.join(dir, 'candidates.csv');
  const fallbackCsv = meta.files?.csv ? path.join(dir, meta.files.csv) : null;
  const csvPath = existsSync(candidatesPath)
    ? candidatesPath
    : fallbackCsv && existsSync(fallbackCsv)
      ? fallbackCsv
      : null;
  const rows = csvPath ? parseCsv(readFileSync(csvPath, 'utf8')) : [];
  return { batch: meta, rows, dir };
}

export function updateBatchDecisions(batchId, updates = []) {
  const { batch, rows, dir } = getBatch(batchId);
  for (const u of updates) {
    const idx = Number(u.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= rows.length) continue;
    if (u.human_decision != null) {
      const d = String(u.human_decision || '').trim();
      if (d && !DISCOVERY_DECISIONS.includes(d)) continue;
      rows[idx].human_decision = d;
    }
    if (u.decision_notes != null) rows[idx].decision_notes = u.decision_notes;
  }
  writeFileSync(path.join(dir, 'candidates.csv'), rowsToCsv(rows), 'utf8');
  const meta = {
    ...batch,
    updatedAt: new Date().toISOString(),
    rowCount: rows.length,
  };
  writeJson(path.join(dir, 'meta.json'), meta);
  return { batch: meta, rows };
}

export function recommendBatch(batchId) {
  const { batch, rows, dir } = getBatch(batchId);
  const next = applyRecommendations(rows);
  writeFileSync(path.join(dir, 'candidates.csv'), rowsToCsv(next), 'utf8');
  if (batch.files?.geminiCsv) {
    writeFileSync(path.join(dir, batch.files.geminiCsv), rowsToCsv(next), 'utf8');
  }
  const meta = {
    ...batch,
    updatedAt: new Date().toISOString(),
    rowCount: next.length,
  };
  writeJson(path.join(dir, 'meta.json'), meta);
  return { batch: meta, rows: next };
}

function parseSuburbsCluster(text, state) {
  const st = String(state || '').toUpperCase();
  return String(text || '')
    .split(/;/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.includes(',')) return part.replace(/\s+/g, ' ');
      return st ? `${part},${st}` : part;
    });
}

/**
 * Promote rows with human_decision into candidates; optional Stage 1 batch for pursue.
 */
export function processDiscoveryBatch(
  batchId,
  { runStage1ForPursue = true, decisions = null, concurrency = 1, adsMode = 'live' } = {},
) {
  const { batch, rows, dir } = getBatch(batchId);
  if (!rows.length) {
    const err = new Error('Batch has no rows');
    err.status = 400;
    throw err;
  }

  const allow = Array.isArray(decisions) && decisions.length
    ? new Set(decisions.map((d) => String(d).trim()))
    : null;

  const promoted = [];
  const skipped = [];
  const pursueIds = [];
  let nextRows = applyRecommendations(rows);

  for (let i = 0; i < nextRows.length; i += 1) {
    const row = nextRows[i];
    const decision = String(row.human_decision || '').trim();
    if (!decision) {
      skipped.push({ index: i, reason: 'no human_decision' });
      continue;
    }
    if (allow && !allow.has(decision)) {
      skipped.push({ index: i, reason: 'decision filtered out', decision });
      continue;
    }
    if (!DISCOVERY_DECISIONS.includes(decision)) {
      skipped.push({ index: i, reason: 'invalid decision', decision });
      continue;
    }
    if (!row.Niche || !row.City || !row.State) {
      skipped.push({ index: i, reason: 'missing Niche/City/State' });
      continue;
    }

    let candidateId = String(row.candidateId || '').trim();
    const primary = `${row.City},${String(row.State).toUpperCase()}`;
    const cluster = parseSuburbsCluster(row.suggested_suburbs, row.State);
    const source = {
      batchId: batch.id,
      rowKey: rowKey(row),
      rowIndex: i,
      niche: row.Niche,
      city: row.City,
      state: String(row.State).toUpperCase(),
    };

    try {
      if (candidateId && existsSync(pathsFor(candidateId).config)) {
        setDecision(candidateId, decision, row.decision_notes || row.recommended_reason || null);
        saveMetaSource(candidateId, source);
        attachDiscoveryArtifacts(candidateId, row, dir, batch.id, i);
      } else {
        const existing = findCandidateByGeo({
          niche: row.Niche,
          city: row.City,
          state: row.State,
        });
        if (existing) {
          candidateId = existing.id;
          setDecision(candidateId, decision, row.decision_notes || row.recommended_reason || null);
          saveMetaSource(candidateId, source);
          attachDiscoveryArtifacts(candidateId, row, dir, batch.id, i);
          promoted.push({
            index: i,
            candidateId,
            decision,
            niche: row.Niche,
            primary,
            linkedExisting: true,
          });
          row.candidateId = candidateId;
          nextRows[i] = row;
          if (decision === 'pursue') {
            const p = pathsFor(candidateId);
            if (!existsSync(p.research)) pursueIds.push(candidateId);
          }
          continue;
        }
        const serpCache = resolveFreshSerpCacheRel(dir, rowKey(row));
        const discoverySeed = discoveryNarrativeSeedFromRow(row, {
          batchId: batch.id,
          rowIndex: i,
        });
        const created = createCandidate({
          niche: row.Niche,
          primary,
          cluster,
          source,
          decision,
          decisionNotes: row.decision_notes || row.recommended_reason || null,
          serpCache,
          discoverySeed,
        });
        candidateId = created.id;
      }
      row.candidateId = candidateId;
      nextRows[i] = row;
      promoted.push({ index: i, candidateId, decision, niche: row.Niche, primary });
      if (decision === 'pursue') {
        const p = pathsFor(candidateId);
        if (!existsSync(p.research)) pursueIds.push(candidateId);
      }
    } catch (error) {
      skipped.push({ index: i, reason: error.message });
    }
  }

  writeFileSync(path.join(dir, 'candidates.csv'), rowsToCsv(nextRows), 'utf8');
  if (batch.files?.geminiCsv) {
    writeFileSync(path.join(dir, batch.files.geminiCsv), rowsToCsv(nextRows), 'utf8');
  }

  let batchJob = null;
  if (runStage1ForPursue && pursueIds.length) {
    batchJob = startBatchJobs({
      act: 'research',
      candidateIds: pursueIds,
      concurrency,
      adsMode,
    });
  }

  const processLog = {
    at: new Date().toISOString(),
    promoted,
    skipped,
    pursueQueued: pursueIds,
    batchJobId: batchJob?.id || null,
  };
  writeJson(path.join(dir, 'process-log.json'), processLog);
  try {
    regenerateKnownCandidates();
  } catch {
    /* ignore */
  }

  const meta = {
    ...batch,
    updatedAt: new Date().toISOString(),
    stage: 'discovery_processed',
    rowCount: nextRows.length,
    lastProcess: processLog,
    files: {
      ...(batch.files || {}),
      candidates: 'candidates.csv',
      processLog: 'process-log.json',
    },
  };
  writeJson(path.join(dir, 'meta.json'), meta);

  return {
    batch: meta,
    rows: nextRows,
    promoted,
    skipped,
    pursueIds,
    batchJob,
  };
}

export function discoveryPresets() {
  return {
    niches: WIZARD_NICHES,
    categories: CATALOG_CATEGORIES,
    tiers: ['platinum', 'gold', 'silver', 'bronze'],
    seasonality: ['year_round', 'allow_seasonal', 'seasonal_only'],
    mapPackPreferences: ['prefer_absent', 'allow_present', 'prefer_present'],
    decisions: DISCOVERY_DECISIONS,
    jobCosts: loadNicheJobCosts(),
    census: censusStatus(),
    columns: DISCOVERY_COLUMNS,
  };
}
