/**
 * Discovery stage: free CSV pack + Claude prompt + batch import.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { lookupPopulation, censusStatus, listUsStates } from './census.mjs';
import { applyRecommendations, DISCOVERY_DECISIONS } from './discovery-recommend.mjs';
import { createCandidate, setDecision, pathsFor, saveMeta } from './candidates.mjs';
import {
  findCandidateByGeo,
  formatKnownCandidatesForPrompt,
  knownCandidatesCount,
  regenerateKnownCandidates,
  upsertTrackedDecision,
  removeTrackedDecision,
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
  'process_status',
  'source_mode',
  'serp_source',
];

/** Human decisions that create/link Candidates. */
export const PROMOTE_DECISIONS = ['pursue', 'maybe', 'review', 'hold'];
/** Human decisions stored for anti-dupe only — not Candidates. */
export const TRACK_ONLY_DECISIONS = ['pass', 'deprioritize', 'pass_unless_gbp_angle'];

export function discoveryRowProcessStatus(row) {
  const status = String(row?.process_status || '').trim().toLowerCase();
  if (status === 'promoted' || status === 'tracked') return status;
  if (String(row?.candidateId || '').trim()) return 'promoted';
  return '';
}

export function isDiscoveryRowProcessed(row) {
  return Boolean(discoveryRowProcessStatus(row));
}

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

function normalizeNicheList(rawList) {
  const out = [];
  const seen = new Set();
  for (const item of rawList || []) {
    const n = String(item || '').trim();
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

function normalizeFilters(filters = {}) {
  const stateRaw = String(filters.state || '')
    .trim()
    .toUpperCase();
  const state = stateRaw.length === 2 ? stateRaw : '';
  const niches = normalizeNicheList(filters.niches);
  const requiredNiches = normalizeNicheList(filters.requiredNiches);
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
    requiredNiches,
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
  const nicheSource = f.requiredNiches.length
    ? f.requiredNiches
    : f.niches.length
      ? f.niches
      : f.categories;
  const nichePart = nicheSource.length
    ? nicheSource
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

/** Human-readable filter brief injected into Claude prompts. */
export function buildFilterBrief(filters = {}) {
  const f = normalizeFilters(filters);
  let nichesLine;
  if (f.requiredNiches.length) {
    nichesLine = `- **Required niches (exclusive):** ${f.requiredNiches.join('; ')}
- **Niche rule:** Every row’s Niche MUST be one of the Required niches only — do not substitute catalog alternatives. Include each required niche in ≥1 row when Max rows allows. Custom names are valid even if absent from the High-Ticket catalog.`;
  } else if (f.niches.length) {
    nichesLine = `- **Niches (suggested):** ${f.niches.join('; ')}
- **Niche rule:** Soft preference — prefer these niches when a strong city fit exists; you may still pick other High-Ticket catalog niches that match tiers/categories.`;
  } else {
    nichesLine = `- **Niches:** OPEN — choose from the High-Ticket catalog; include **at least 3 different niches** when possible`;
  }
  const lines = [
    '## Operator filters (from Rover)',
    '',
    `- **State:** ${f.state || 'ANY (nationwide — pick the best US markets)'}`,
    nichesLine,
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
    f.requiredNiches.length
      ? `- **Ticket tiers allowed:** ${tiersLabel(f.tiers)} — apply when picking cities/services framing; Required niches override catalog tier membership`
      : `- **Ticket tiers allowed:** ${tiersLabel(f.tiers)} — only niches in these catalog tiers`,
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
  writeFileSync(path.join(dir, csvName), csv, 'utf8');

  const filterBrief = buildFilterBrief(f);
  const highTicketNiches = loadHighTicketNiches();
  const promptVars = {
    FILTER_BRIEF: filterBrief,
    DISCOVERY_CSV: csv.trimEnd(),
    OUTPUT_BASENAME: outputBasename,
    CLAUDE_OUTPUT_CSV: claudeCsvName,
    BATCH_DIR: dir,
    HIGH_TICKET_NICHES: highTicketNiches,
    KNOWN_CANDIDATES: formatKnownCandidatesForPrompt({
      stateFilter: f.state || null,
      limit: 500,
    }),
  };
  const claudePrompt = fillPrompt('prompts/discovery-claude.md', promptVars);
  writeFileSync(path.join(dir, 'prompt-claude.md'), claudePrompt, 'utf8');
  writeFileSync(path.join(dir, 'filters.md'), `${filterBrief}\n`, 'utf8');

  const meta = {
    id: batchId,
    createdAt: new Date().toISOString(),
    stage: 'discovery_pack',
    filters: {
      state: f.state || null,
      niches: f.niches,
      requiredNiches: f.requiredNiches,
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
      claudePrompt: 'prompt-claude.md',
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
    outputBasename,
    batchDir: dir,
    claudePrompt,
    filterBrief,
    rows,
    knownCandidatesCount: knownCandidatesCount(),
  };
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

/** Header may be Niche,... or "Niche","City",... (Excel / Claude quoted CSV). */
function isDiscoveryCsvHeaderLine(line) {
  return /^"?Niche"?\s*,/i.test(String(line || '').trim());
}

/** Pull CSV out of Claude chat paste (DONE header, fences, or bare CSV). */
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

/**
 * Import Claude CSV into a batch. Saves *-claude.csv.
 */
export function importDiscoveryCsv(batchId, csvText, { createIfMissing = true } = {}) {
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
  writeFileSync(path.join(dir, claudeCsvName), rowsToCsv(scoredRows), 'utf8');

  const meta = {
    ...prev,
    id,
    updatedAt: new Date().toISOString(),
    stage: 'discovery_claude',
    rowCount: scoredRows.length,
    outputBasename: prev.outputBasename || outputBasename,
    files: {
      ...(prev.files || {}),
      candidates: 'candidates.csv',
      lastImport: csvName,
      claudeCsv: claudeCsvName,
    },
    census: {
      ...censusStatus(),
      filledOnImport: censusFilled,
      missOnImport: censusMiss,
    },
    popBandWarnings: popWarnings.length ? popWarnings : undefined,
  };
  if (!meta.createdAt) meta.createdAt = new Date().toISOString();

  writeJson(path.join(dir, 'meta.json'), meta);
  return { batch: meta, rows: scoredRows };
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
 * Promote or track rows with human_decision; optional Stage 1 batch for pursue.
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
  const tracked = [];
  const skipped = [];
  const pursueIds = [];
  let nextRows = applyRecommendations(rows);

  for (let i = 0; i < nextRows.length; i += 1) {
    const row = nextRows[i];
    if (isDiscoveryRowProcessed(row)) {
      skipped.push({
        index: i,
        reason: 'already processed',
        process_status: discoveryRowProcessStatus(row),
        candidateId: row.candidateId || null,
        decision: row.human_decision || null,
      });
      continue;
    }
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

    if (TRACK_ONLY_DECISIONS.includes(decision)) {
      try {
        upsertTrackedDecision({
          niche: row.Niche,
          city: row.City,
          state: row.State,
          decision,
          batchId: batch.id,
        });
        row.process_status = 'tracked';
        row.candidateId = '';
        nextRows[i] = row;
        tracked.push({
          index: i,
          decision,
          niche: row.Niche,
          city: row.City,
          state: String(row.State).toUpperCase(),
        });
      } catch (error) {
        skipped.push({ index: i, reason: error.message, decision });
      }
      continue;
    }

    if (!PROMOTE_DECISIONS.includes(decision)) {
      skipped.push({ index: i, reason: 'invalid decision', decision });
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
        skipped.push({
          index: i,
          reason: 'already processed',
          candidateId,
          decision,
        });
        continue;
      }
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
        row.candidateId = candidateId;
        row.process_status = 'promoted';
        nextRows[i] = row;
        promoted.push({
          index: i,
          candidateId,
          decision,
          niche: row.Niche,
          primary,
          linkedExisting: true,
        });
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
      row.candidateId = candidateId;
      row.process_status = 'promoted';
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
    tracked,
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
    tracked,
    skipped,
    pursueIds,
    batchJob,
  };
}

/**
 * Clear process_status on rows so Process can run again (e.g. change mind on pass).
 */
export function reopenDiscoveryRows(batchId, indices = []) {
  const { batch, rows, dir } = getBatch(batchId);
  const idxList = [...new Set((indices || []).map((n) => Number(n)))].filter(
    (n) => Number.isInteger(n) && n >= 0 && n < rows.length,
  );
  if (!idxList.length) {
    const err = new Error('No valid row indices to reopen');
    err.status = 400;
    throw err;
  }

  const reopened = [];
  for (const i of idxList) {
    const row = rows[i];
    const status = discoveryRowProcessStatus(row);
    if (!status) continue;
    if (status === 'tracked') {
      removeTrackedDecision({
        niche: row.Niche,
        city: row.City,
        state: row.State,
      });
    }
    // Keep candidate files on disk; clear Discovery markers so Process can run again.
    row.process_status = '';
    row.candidateId = '';
    rows[i] = row;
    reopened.push({
      index: i,
      previousStatus: status,
      niche: row.Niche,
      city: row.City,
      state: row.State,
      human_decision: row.human_decision || '',
    });
  }

  writeFileSync(path.join(dir, 'candidates.csv'), rowsToCsv(rows), 'utf8');
  const meta = {
    ...batch,
    updatedAt: new Date().toISOString(),
    rowCount: rows.length,
  };
  writeJson(path.join(dir, 'meta.json'), meta);
  return { batch: meta, rows, reopened };
}

export function discoveryPresets() {
  return {
    niches: WIZARD_NICHES,
    categories: CATALOG_CATEGORIES,
    tiers: ['platinum', 'gold', 'silver', 'bronze'],
    seasonality: ['year_round', 'allow_seasonal', 'seasonal_only'],
    mapPackPreferences: ['prefer_absent', 'allow_present', 'prefer_present'],
    decisions: DISCOVERY_DECISIONS,
    promoteDecisions: PROMOTE_DECISIONS,
    trackOnlyDecisions: TRACK_ONLY_DECISIONS,
    jobCosts: loadNicheJobCosts(),
    census: censusStatus(),
    states: listUsStates(),
    columns: DISCOVERY_COLUMNS,
  };
}
