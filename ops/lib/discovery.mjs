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
import {
  backfillStoredCandidateNiches,
  createCandidate,
  pathsFor,
  saveMeta,
  setDecision,
  titleCaseNiche,
} from './candidates.mjs';
import {
  findCandidateByGeo,
  formatKnownCandidatesForPrompt,
  knownCandidatesCount,
  regenerateKnownCandidates,
  backfillTrackedNicheTitleCase,
  upsertTrackedDecision,
  removeTrackedDecision,
} from './known-candidates.mjs';
import { startBatchJobs } from './batch-jobs.mjs';
import { isSerpCacheFresh, readSerpCache, serpCachePath } from '../../scripts/lib/serp-cache.mjs';
import {
  estimatedVolumeFields,
  parseEstimatedMonthlySearchVolume,
  resolveEstimatedVolumeForSeed,
} from '../../scripts/lib/estimated-volume.mjs';

export { resolveEstimatedVolumeForSeed };
import { normalizeCityStateCluster } from './city-state.mjs';
import {
  annotateMembersWithPipeline,
  applyHubScanToDraft,
  emptyShotgunDraft,
  ensureLockedHubOnDraft,
  isClusterPack,
  listViableHubs,
  loadShotgunDraft,
  normalizePackType,
  normalizeShotgunSettings,
  paintedZoneConflictMessage,
  saveShotgunDraft,
  shotgunDraftHubCount,
  backfillShotgunNicheTitleCase,
  upsertShotgunCluster,
} from './shotgun.mjs';
import { copyZoneGuideFromBatch } from './zone-guide.mjs';

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
  'Est. Monthly Search Volume',
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
  'shotgun_role',
  'candidateId',
  'process_status',
  'source_mode',
  'serp_source',
];

/** Columns Claude fills in Discovery (plus blank Population). Rover owns the rest after import. */
export const DISCOVERY_CLAUDE_COLUMNS = [
  'Niche',
  'City',
  'State',
  'Population',
  'Average Job Cost',
  'Est. Monthly Search Volume',
  'Est. time to rank with GBP',
  'Est. time to rank without GBP',
  'pain_points',
  'suggested_services',
  'suggested_suburbs',
  'confidence_narrative',
];

/** Human decisions that create/link Candidates. */
export const PROMOTE_DECISIONS = ['pursue', 'maybe', 'review', 'hold'];
/** Human decisions stored for anti-dupe only — not Candidates. */
export const TRACK_ONLY_DECISIONS = ['pass'];
/** Human decisions that finish the batch row without Candidates or anti-dupe. */
export const IGNORE_ONLY_DECISIONS = ['ignore'];

export function discoveryRowProcessStatus(row) {
  const status = String(row?.process_status || '').trim().toLowerCase();
  if (status === 'promoted' || status === 'tracked' || status === 'ignored') return status;
  if (String(row?.candidateId || '').trim()) return 'promoted';
  return '';
}

export function isDiscoveryRowProcessed(row) {
  return Boolean(discoveryRowProcessStatus(row));
}

const WIZARD_NICHES = [
  'Artificial Grass',
  'Asphalt Paving',
  'Commercial Roof Repair',
  'Concrete',
  'Concrete Repair',
  'Custom Cabinets',
  'Custom Countertops',
  'Drywall',
  'Electric Gate Repair',
  'Epoxy Flooring',
  'Fences',
  'Foundation Repair',
  'Kitchen & Bathroom Remodeling',
  'Landscaping',
  'Masonry',
  'Metal Gates',
  'Mobile Services',
  'Mobile Windshield Repair',
  'Mold Removal',
  'Painting',
  'Railing',
  'Repair Service',
  'Retaining Wall',
  'Roof Repair',
  'Tile Pavers',
  'Tree Service',
  'Windows',
  'Wood Flooring',
];

const CATALOG_CATEGORIES = [
  'Plumbing',
  'Electrical',
  'Concrete & Masonry',
  'Exterior Home',
  'Basement Finishing',
  'Interior Specialties',
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

/** CSV records (quotes and newlines inside quotes). Empty rows are dropped. */
export function parseCsvRecords(text) {
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
  return rows;
}

function parseCsvObjects(text) {
  const records = parseCsvRecords(text);
  if (!records.length) return { columns: [], rows: [] };
  const columns = records[0].map((h) => String(h).trim());
  const rows = records.slice(1).map((cells) => {
    const obj = {};
    columns.forEach((h, idx) => {
      obj[h] = cells[idx] ?? '';
    });
    return obj;
  });
  return { columns, rows };
}

function titleCaseNicheRow(row, columns) {
  const obj = { ...row };
  let changed = false;
  for (const h of columns) {
    if (!/^niche$/i.test(h)) continue;
    const next = titleCaseNiche(obj[h]);
    if (next !== obj[h]) {
      obj[h] = next;
      changed = true;
    }
  }
  return { row: obj, changed };
}

/** Minimal CSV parser supporting quotes and newlines inside quotes. */
export function parseCsv(text) {
  const { columns, rows } = parseCsvObjects(text);
  if (!columns.length) return [];
  return rows.map((row) => titleCaseNicheRow(row, columns).row);
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
    const n = titleCaseNiche(item);
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

function normalizeStateAbbr(raw) {
  const s = String(raw || '')
    .trim()
    .toUpperCase();
  return s.length === 2 ? s : '';
}

function normalizeCityList(raw) {
  if (Array.isArray(raw)) return raw.map((c) => String(c).trim()).filter(Boolean);
  return String(raw || '')
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function mergeDiscoveryRegions(incoming) {
  const byKey = new Map();
  const order = [];
  for (const item of incoming || []) {
    const state = normalizeStateAbbr(item?.state);
    const cities = normalizeCityList(item?.cities);
    if (!state && !cities.length) continue;
    const key = state || '\0';
    if (!byKey.has(key)) {
      byKey.set(key, { state, cities: [] });
      order.push(key);
    }
    const slot = byKey.get(key);
    for (const city of cities) {
      if (!slot.cities.some((c) => c.toLowerCase() === city.toLowerCase())) slot.cities.push(city);
    }
  }
  return order.map((k) => byKey.get(k));
}

export function normalizeFilters(filters = {}) {
  const rawRegions = Array.isArray(filters.regions) ? filters.regions : null;
  const regions = mergeDiscoveryRegions(
    rawRegions && rawRegions.length
      ? rawRegions
      : [{ state: filters.state, cities: filters.cities }],
  );
  const states = [...new Set(regions.map((r) => r.state).filter(Boolean))];
  const state = states[0] || '';
  const cities = regions.flatMap((r) => r.cities);
  const niches = normalizeNicheList(filters.niches);
  const requiredNiches = normalizeNicheList(filters.requiredNiches);
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
    states,
    regions,
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
    packType: normalizePackType(filters.packType),
    shotgunNiche: titleCaseNiche(filters.shotgunNiche || requiredNiches[0] || ''),
    clusterMiles: Number(filters.clusterMiles ?? filters.outerMiles ?? filters.innerMiles) || undefined,
    innerMiles: Number(filters.innerMiles) || undefined,
    outerMiles: Number(filters.outerMiles) || undefined,
    shotgunBands: filters.shotgunBands || null,
  };
}

export function emptyDiscoveryRowsHint(batch) {
  if (isClusterPack(batch?.filters?.packType)) {
    return 'Batch has no rows — generate the cluster pack from the selected hub first';
  }
  return 'Batch has no rows — import Claude CSV first';
}

export function autoLabel(f) {
  if (isClusterPack(f.packType)) {
    const niche = String(f.shotgunNiche || f.requiredNiches?.[0] || 'niche')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    const hub = String(f.cities?.[0] || 'hub')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24);
    return `cluster-${niche || 'niche'}-${hub || 'hub'}`;
  }
  const statePart =
    Array.isArray(f.states) && f.states.length
      ? f.states.map((s) => String(s).toLowerCase()).join('-')
      : 'us';
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

/** Niche, seasonality, and tiers only — cluster Generate pack must not see row-picking rules. */
export function buildGeneratePackContext(filters = {}, niche = '') {
  const f = normalizeFilters(filters);
  const name = String(niche || f.shotgunNiche || '').trim() || '(none)';
  return [
    `Niche: **${name}**`,
    `Seasonality: ${seasonalityLabel(f.seasonality)}`,
    `Ticket tiers: ${tiersLabel(f.tiers)}`,
  ].join('\n');
}

function mapPackLabel(v) {
  if (v === 'allow_present') return 'Allow Map Pack present';
  if (v === 'prefer_present') return 'Prefer Map Pack present (soft)';
  return 'Prefer Map Pack absent (soft — estimate after Claude)';
}

/** Active niche-mode rules only (injected into discovery-claude.md). */
export function buildNicheRules(filters = {}) {
  const f = normalizeFilters(filters);
  if (f.requiredNiches.length && f.niches.length) {
    return `3. **Niche mode (hybrid):** For each Required niche, emit ≥1 row whose \`Niche\` cell is that name **verbatim (exact match after trim)** when Max rows allows — no synonym rename for those must-include rows. Fill remaining rows preferring Suggested themes (soft) as **high-volume head terms** (e.g. Suggested Drywall → Drywall Repair); you may pick other High-Ticket catalog niches as head terms when the Suggested list is short. Required is never an exclusive lock.`;
  }
  if (f.requiredNiches.length) {
    return `3. **Niche mode (Required):** For each Required niche, emit ≥1 row whose \`Niche\` cell is that name **verbatim (exact match after trim)** when Max rows allows — no synonym rename for those must-include rows. Fill remaining rows from the High-Ticket catalog (OPEN soft) as **high-volume head terms**, honoring tiers/categories. Required is never an exclusive lock — do not restrict every row to Required names only.`;
  }
  if (f.niches.length) {
    return `3. **Niche mode (Suggested):** Soft preference — Suggested names are **theme seeds**. Prefer head-term niches under those themes when a strong city fit exists; diversify head terms across rows. You may still pick other High-Ticket catalog niches (as head terms) that match tiers/categories.`;
  }
  return `3. **Niche mode (OPEN):** Pick from the High-Ticket niches catalog below as **head terms** (catalog lines that are already head terms are fine); include at least 3 different niches when Max rows allows. Respect Ticket tiers / Min job cost / Catalog categories (only listed tiers — not “tier and above”).`;
}

/** Human-readable filter brief injected into Claude prompts. */
export function buildFilterBrief(filters = {}) {
  const f = normalizeFilters(filters);
  let nichesLine;
  if (f.requiredNiches.length && f.niches.length) {
    nichesLine = `- **Required niches (must-include, exact Niche text):** ${f.requiredNiches.join('; ')}
- **Suggested niche themes:** ${f.niches.join('; ')}
- **Niche rule:** Hybrid — for each Required niche, ≥1 row whose Niche is that name **verbatim (exact match after trim)** when Max rows allows (no synonym rename for must-include rows). Remaining rows prefer Suggested themes as **high-volume head terms**; catalog overflow OK. Never put city/near-me in Niche. Required is never an exclusive lock.`;
  } else if (f.requiredNiches.length) {
    nichesLine = `- **Required niches (must-include, exact Niche text):** ${f.requiredNiches.join('; ')}
- **Niche rule:** For each Required niche, ≥1 row whose Niche is that name **verbatim (exact match after trim)** when Max rows allows. Fill remaining rows from the High-Ticket catalog (OPEN soft) as **high-volume head terms**. Required is never an exclusive lock. Never put city/near-me in Niche.`;
  } else if (f.niches.length) {
    nichesLine = `- **Suggested niche themes:** ${f.niches.join('; ')}
- **Niche rule:** Soft preference — treat Suggested as themes; emit **head-term** Niche cells (highest typical local-service volume variants). Diversify head terms across rows. Other catalog niches OK. Never put city/near-me in Niche.`;
  } else {
    nichesLine = `- **Niches:** OPEN — choose **head-term** niches from the High-Ticket catalog; include **at least 3 different niches** when possible`;
  }
  const marketLines = [];
  if (isClusterPack(f.packType)) {
    if (!f.regions.length) {
      marketLines.push(
        '- **Hub states:** ANY (nationwide). Rings may cross state lines.',
      );
    } else {
      const statesLabel = f.states.length ? f.states.join(', ') : 'the selected states';
      marketLines.push(
        `- **Hubs in ${statesLabel}.** Not Single City OPEN cities — do not invent famous cores outside the Hub population band. Skip cores outside the Hub band. State filter limits hubs; Cluster Cities rings may still cross state lines.`,
      );
      for (const r of f.regions) {
        if (r.cities.length) {
          marketLines.push(`  - ${r.state || 'ANY'}: ${r.cities.join('; ')}`);
        }
      }
    }
    marketLines.push(
      '- **Census Hub-band table is a hint list**, not an allow-list. You may name real municipalities that are missing from it. Rover Census-matches your picks.',
    );
  } else if (!f.regions.length) {
    marketLines.push(`- **State:** ANY (nationwide — pick the best US markets)`);
    marketLines.push(`- **Cities:** OPEN nationwide — choose the best cities`);
  } else {
    marketLines.push('- **Markets:**');
    for (const r of f.regions) {
      const label = r.state || 'ANY';
      const cities =
        r.cities.length
          ? r.cities.join('; ')
          : r.state
            ? `OPEN within ${r.state} — choose the best cities in that state`
            : 'OPEN nationwide — choose the best cities';
      marketLines.push(`  - ${label}: ${cities}`);
    }
  }
  const lines = [
    '## Operator filters (from Rover)',
    '',
    ...marketLines,
    nichesLine,
    `- **Catalog categories:** ${
      f.categories.length
        ? f.categories.join('; ')
        : 'ALL categories in the High-Ticket catalog'
    }`,
    isClusterPack(f.packType)
      ? null
      : `- **Population band (prefer):** ${f.minPopulation.toLocaleString()} – ${f.maxPopulation.toLocaleString()} (incorporated place / city proper when known)`,
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
    isClusterPack(f.packType)
      ? `- **Pack type:** Cluster Cities (one niche × one metro). Hub band ${f.shotgunBands?.hub?.min ?? 60000}–${f.shotgunBands?.hub?.max ?? 200000}; Cluster Cities ${f.clusterMiles || f.outerMiles || 30} mi / ${f.shotgunBands?.cities?.min ?? f.shotgunBands?.wave1?.min ?? 2000}–${f.shotgunBands?.cities?.max ?? f.shotgunBands?.wave1?.max ?? 60000}. State filter limits hubs; rings may cross state lines.`
      : `- **Pack type:** Single City (independent cities)`,
    '',
    'Respect these constraints. Prefer real municipalities. Do not invent fake cities.',
  ].filter((line) => line != null);
  return lines.join('\n');
}

/** Map a numbered section heading to a CATALOG_CATEGORIES label. */
function categoryFromSectionHeading(heading) {
  const cleaned = String(heading || '')
    .replace(/^#+\s*/, '')
    .replace(/\\\./g, '.')
    .replace(/\\&/g, '&')
    .trim();
  let best = null;
  for (const cat of CATALOG_CATEGORIES) {
    if (cleaned.includes(cat) && (!best || cat.length > best.length)) best = cat;
  }
  return best;
}

function stripMdCell(raw) {
  return String(raw || '')
    .replace(/\\&/g, '&')
    .replace(/\*\*/g, '')
    .replace(/\|/g, '/')
    .trim();
}

/**
 * Parse primary niche tables from the High-Ticket guide (skip TOC, bonus, sorted lists, strategy).
 * @returns {{ niche: string, tier: string, category: string, avgJob: string }[]}
 */
export function parseHighTicketCatalog(md) {
  const text = String(md || '');
  const entries = [];
  const seen = new Set();
  let category = null;
  let inTierTable = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (/^##\s+(Bonus|Quick-Reference|Strategy)\b/i.test(line.trim())) break;
    if (/^##\s+\d/i.test(line.trim())) {
      category = categoryFromSectionHeading(line.trim());
      inTierTable = false;
      continue;
    }
    if (!category) continue;
    if (/^\|\s*[#\\]*\s*\|/i.test(line) && /Niche/i.test(line) && /Tier/i.test(line)) {
      inTierTable = true;
      continue;
    }
    if (/^\|\s*:?-{2,}/.test(line)) continue;
    if (!inTierTable || !line.startsWith('|')) {
      if (line.startsWith('##') || line.startsWith('---')) inTierTable = false;
      continue;
    }
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(stripMdCell);
    // # | Niche | Avg. Job Value | Tier | Notes
    if (cells.length < 4) continue;
    const niche = cells[1];
    const avgJob = cells[2];
    const tierRaw = cells[3];
    if (!niche || /^niche/i.test(niche)) continue;
    const tier = String(tierRaw || '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    if (!TIER_RANK[tier]) continue;
    const key = `${niche.toLowerCase()}|${category.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      niche,
      tier: tier.charAt(0).toUpperCase() + tier.slice(1),
      category,
      avgJob,
    });
  }
  return entries;
}

let _cachedCatalogEntries = null;

function loadHighTicketCatalogEntries() {
  if (_cachedCatalogEntries) return _cachedCatalogEntries;
  const full = path.join(ROOT, 'data', 'high-ticket-rank-and-rent-niches.md');
  if (!existsSync(full)) {
    _cachedCatalogEntries = [];
    return _cachedCatalogEntries;
  }
  _cachedCatalogEntries = parseHighTicketCatalog(readFileSync(full, 'utf8'));
  return _cachedCatalogEntries;
}

/**
 * Compact, filter-matched niche list for the Discovery Claude prompt (not the full guide).
 */
export function buildCompactHighTicketCatalog(filters = {}) {
  const f = normalizeFilters(filters);
  const tierSet = new Set((f.tiers || []).map((t) => String(t).toLowerCase()));
  const categorySet = f.categories.length
    ? new Set(f.categories.map((c) => String(c).trim().toLowerCase()))
    : null;

  const entries = loadHighTicketCatalogEntries().filter((e) => {
    if (tierSet.size && !tierSet.has(String(e.tier).toLowerCase())) return false;
    if (categorySet && !categorySet.has(String(e.category).toLowerCase())) return false;
    return true;
  });

  if (!entries.length) {
    if (!loadHighTicketCatalogEntries().length) {
      return '_High-ticket niches catalog missing or unreadable at data/high-ticket-rank-and-rent-niches.md._';
    }
    return '_No niches match the selected tiers/categories. Broaden filters or use Required/Suggested niches._';
  }

  const lines = [
    'Niche | Category',
    '--- | ---',
    ...entries.map((e) => `${e.niche} | ${e.category}`),
  ];
  return lines.join('\n');
}

/** Expand Claude short CSVs (or full exports) onto DISCOVERY_COLUMNS. */
export function normalizeDiscoveryImportRows(rows) {
  return (rows || []).map((row) => {
    const out = {};
    for (const col of DISCOVERY_COLUMNS) {
      const v = row?.[col];
      out[col] = v == null ? '' : String(v);
    }
    return out;
  });
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
 * Anthropic API Generate pack prompt (CSV fence only — not the Claude.ai file protocol).
 */
export function buildDiscoveryApiPrompt(batchId) {
  const { batch } = getBatch(batchId);
  const f = normalizeFilters(batch.filters || {});
  const csv = rowsToCsv(buildEmptyTemplateRows(), DISCOVERY_CLAUDE_COLUMNS);
  return fillPrompt('prompts/discovery-claude-api.md', {
    FILTER_BRIEF: buildFilterBrief(f),
    NICHE_RULES: buildNicheRules(f),
    DISCOVERY_CSV: csv.trimEnd(),
    HIGH_TICKET_NICHES: buildCompactHighTicketCatalog(f),
    KNOWN_CANDIDATES: formatKnownCandidatesForPrompt({
      stateFilter: f.states.length ? f.states : null,
      limit: 200,
      compact: true,
    }),
  });
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
  const csv = rowsToCsv(rows, DISCOVERY_CLAUDE_COLUMNS);
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
  const highTicketNiches = buildCompactHighTicketCatalog(f);
  const promptVars = {
    FILTER_BRIEF: filterBrief,
    NICHE_RULES: buildNicheRules(f),
    DISCOVERY_CSV: csv.trimEnd(),
    OUTPUT_BASENAME: outputBasename,
    CLAUDE_OUTPUT_CSV: claudeCsvName,
    BATCH_DIR: dir,
    HIGH_TICKET_NICHES: highTicketNiches,
    KNOWN_CANDIDATES: formatKnownCandidatesForPrompt({
      stateFilter: f.states.length ? f.states : null,
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
      states: f.states,
      regions: f.regions,
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
      packType: f.packType,
      shotgunNiche: f.shotgunNiche || null,
      innerMiles: f.innerMiles || null,
      outerMiles: f.outerMiles || null,
      shotgunBands: f.shotgunBands || null,
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

  if (isClusterPack(f.packType)) {
    const s = normalizeShotgunSettings({
      innerMiles: f.innerMiles,
      outerMiles: f.outerMiles,
      bands: f.shotgunBands,
    });
    const hubCity = f.cities[0] || '';
    const hubState = f.state || '';
    let draft = {
      ...emptyShotgunDraft({
        shotgunNiche: f.shotgunNiche,
        requiredNiches: f.requiredNiches,
        innerMiles: s.innerMiles,
        outerMiles: s.outerMiles,
        bands: s.bands,
      }),
      niche: f.shotgunNiche,
      hub: hubCity && hubState ? { city: hubCity, state: hubState } : null,
      step: hubCity && hubState ? 'assign' : 'hub',
    };
    if (!draft.hub) {
      const scan = listViableHubs(f.states, draft);
      draft = applyHubScanToDraft(draft, scan);
    } else {
      draft = ensureLockedHubOnDraft(draft);
    }
    saveShotgunDraft(dir, draft);
    meta.hubCount = shotgunDraftHubCount(draft);
    writeJson(path.join(dir, 'meta.json'), meta);
  }

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

/** Markdown table row. Comma-CSV lines that merely contain a pipe stay comma-CSV. */
function pipeRowCells(line) {
  const s = String(line || '').trim();
  if (!s.includes('|')) return null;
  if (!s.startsWith('|') && s.includes(',')) return null;
  const cells = s.split('|').map((c) => c.trim());
  if (cells[0] === '') cells.shift();
  if (cells.length && cells[cells.length - 1] === '') cells.pop();
  if (cells.length < 2) return null;
  if (cells.every((c) => /^:?-{3,}:?$/.test(c))) return { separator: true, cells };
  return { separator: false, cells };
}

function pipeLineIsNicheHeader(line) {
  const pipe = pipeRowCells(line);
  if (!pipe || pipe.separator) return false;
  return isDiscoveryCsvHeaderLine(pipe.cells.map(csvEscape).join(','));
}

function csvFromPipeOrComma(block) {
  const lines = String(block || '').split(/\r?\n/);
  const start = lines.findIndex((l) => isDiscoveryCsvHeaderLine(l) || pipeLineIsNicheHeader(l));
  if (start < 0) return null;
  const pipeHeader = pipeLineIsNicheHeader(lines[start]) && !isDiscoveryCsvHeaderLine(lines[start]);
  if (!pipeHeader) {
    const body = lines.slice(start);
    while (body.length && !String(body[body.length - 1]).trim()) body.pop();
    return body.join('\n');
  }
  const out = [];
  for (let i = start; i < lines.length; i += 1) {
    if (!String(lines[i]).trim()) continue;
    const pipe = pipeRowCells(lines[i]);
    if (!pipe) break;
    if (pipe.separator) continue;
    out.push(pipe.cells.map(csvEscape).join(','));
  }
  return out.length ? out.join('\n') : null;
}

function fenceBodies(raw) {
  const bodies = [];
  const re = /```(?:csv|text)?\s*\r?\n([\s\S]*?)```/gi;
  let match = re.exec(raw);
  while (match) {
    bodies.push(match[1]);
    match = re.exec(raw);
  }
  return bodies;
}

function claudeReplyExcerpt(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const max = 160;
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

/** Pull CSV out of Claude chat paste (DONE header, fences, pipe table, or bare CSV). */
export function extractCsvFromChatPaste(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  if (!raw.trim()) {
    const err = new Error('Paste is empty');
    err.status = 400;
    throw err;
  }

  for (const inner of fenceBodies(raw)) {
    const csv = csvFromPipeOrComma(inner);
    if (csv) return csv;
  }
  const csv = csvFromPipeOrComma(raw);
  if (csv) return csv;

  const excerpt = claudeReplyExcerpt(raw);
  const err = new Error(
    `No CSV header found (expected a line starting with Niche, or "Niche",). Claude replied: "${excerpt}"`,
  );
  err.status = 400;
  throw err;
}

export function rowKey(row) {
  return [row.Niche, row.City, row.State]
    .map((v) => String(v || '').trim().toLowerCase())
    .join('|');
}

function parseDiscoveryYesNo(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  if (v === 'yes' || v === 'y' || v === 'true' || v === '1') return true;
  if (v === 'no' || v === 'n' || v === 'false' || v === '0') return false;
  return null;
}

function parseDiscoveryCount(value) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Light SERP triage fields from Discovery batch row — shown on Research list
 * before Eval 1 (does not create research.json / hasResearch).
 */
export function discoveryLightSerpFromRow(row = {}) {
  const mapPackPresent = parseDiscoveryYesNo(row['Map Pack']);
  const organicHomeCount = parseDiscoveryCount(row['Organic Home Page']);
  const organicSubCount = parseDiscoveryCount(row['Organic Sub Page']);
  const directoriesCount = parseDiscoveryCount(row.Directories);
  const organicHomeNicheCount = parseDiscoveryCount(row.organic_home_niche);
  const organicSubNicheCount = parseDiscoveryCount(row.organic_sub_niche);
  const hasAny =
    mapPackPresent != null ||
    organicHomeCount != null ||
    organicSubCount != null ||
    directoriesCount != null ||
    organicHomeNicheCount != null ||
    organicSubNicheCount != null;
  if (!hasAny) return null;
  return {
    source: 'discovery_light_serp',
    mapPackPresent,
    organicHomeCount,
    organicSubCount,
    directoriesCount,
    organicHomeNicheCount,
    organicSubNicheCount,
    organicHomeLinks: row['Organic Home Page (Links)'] || null,
    organicSubLinks: row['Organic Sub Page (Links)'] || null,
    directoriesLinks: row['Directories (Links)'] || null,
    confidenceSerp: row.confidence_serp || null,
    serpSource: row.serp_source || null,
  };
}

function estimatedVolumeFromDiscoveryRow(row) {
  const raw = row?.['Est. Monthly Search Volume'];
  return estimatedVolumeFields(parseEstimatedMonthlySearchVolume(raw));
}

/** Soft fields from Discovery Claude — seed Stage 3 instead of reinventing. */
export function discoveryNarrativeSeedFromRow(row, { batchId = null, rowIndex = null } = {}) {
  const lightSerp = discoveryLightSerpFromRow(row);
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
    ...estimatedVolumeFromDiscoveryRow(row),
    localPainPoints: row.pain_points || null,
    suggestedServices: row.suggested_services || null,
    suggestedSuburbs: row.suggested_suburbs || null,
    confidenceNarrative: row.confidence_narrative || null,
    decisionNotes: row.decision_notes || row.recommended_reason || null,
    humanDecision: row.human_decision || null,
    recommendedDecision: row.recommended_decision || null,
    ...(lightSerp ? { lightSerp } : {}),
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
 * Copy Discovery Light SERP Map Pack / homepage counts onto existing Candidates'
 * discovery-seed.json (no DFS, no research.json). For batches processed before seeding.
 */
export function backfillLightSerpFromBatch(batchId) {
  const { batch, rows, dir } = getBatch(batchId);
  if (!rows.length) {
    const err = new Error('Batch has no rows');
    err.status = 400;
    throw err;
  }

  const updated = [];
  const skipped = [];
  const missing = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const lightSerp = discoveryLightSerpFromRow(row);
    if (!lightSerp) {
      skipped.push({ index: i, reason: 'no_light_serp_columns' });
      continue;
    }

    let candidateId = String(row.candidateId || '').trim();
    if (!candidateId && discoveryRowProcessStatus(row) === 'promoted') {
      const existing = findCandidateByGeo({
        niche: row.Niche,
        city: row.City,
        state: row.State,
      });
      if (existing?.id) candidateId = existing.id;
    }
    if (!candidateId) {
      missing.push({
        index: i,
        reason: 'no_candidate',
        niche: row.Niche,
        city: row.City,
        state: row.State,
      });
      continue;
    }

    const p = pathsFor(candidateId);
    if (!existsSync(p.config) && !existsSync(p.meta) && !existsSync(p.discoverySeed)) {
      missing.push({ index: i, candidateId, reason: 'candidate_not_found' });
      continue;
    }

    let seed = null;
    if (existsSync(p.discoverySeed)) {
      try {
        seed = JSON.parse(readFileSync(p.discoverySeed, 'utf8'));
      } catch {
        seed = null;
      }
    }
    if (!seed || typeof seed !== 'object') {
      seed = discoveryNarrativeSeedFromRow(row, { batchId: batch.id, rowIndex: i });
    } else {
      const est = estimatedVolumeFromDiscoveryRow(row);
      seed = {
        ...seed,
        lightSerp,
        ...(est.estimatedMonthlySearchVolume != null ? est : {}),
        batchId: seed.batchId || batch.id,
        rowIndex: seed.rowIndex != null ? seed.rowIndex : i,
        rowKey: seed.rowKey || rowKey(row),
      };
    }
    writeFileSync(p.discoverySeed, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');

    const serpRel = resolveFreshSerpCacheRel(dir, rowKey(row));
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

    updated.push({ index: i, candidateId });
  }

  return {
    batchId: batch.id,
    updated,
    skipped,
    missing,
    updatedCount: updated.length,
    skippedCount: skipped.length,
    missingCount: missing.length,
  };
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
  const parsed = parseCsv(extracted);
  if (!parsed.length) {
    const err = new Error('CSV has no data rows');
    err.status = 400;
    throw err;
  }
  const rows = normalizeDiscoveryImportRows(parsed);

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
    if (
      !isClusterPack(prev.filters?.packType) &&
      Number.isFinite(pop) &&
      (pop < bandMin || pop > bandMax)
    ) {
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
    .map((name) => {
      const dir = path.join(BATCHES_DIR, name);
      const meta = readJson(path.join(dir, 'meta.json'));
      if (!meta) return null;
      if (isClusterPack(meta.filters?.packType)) {
        meta.hubCount = shotgunDraftHubCount(loadShotgunDraft(dir));
      }
      return meta;
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

/**
 * Best-effort: blank candidateId / process_status on Discovery batch CSVs for deleted ids.
 */
export function scrubCandidateIdsFromBatches(candidateIds = []) {
  const want = new Set(
    (candidateIds || []).map((id) => String(id || '').trim()).filter(Boolean),
  );
  if (!want.size || !existsSync(BATCHES_DIR)) return { filesTouched: 0, rowsCleared: 0 };

  let filesTouched = 0;
  let rowsCleared = 0;

  for (const name of readdirSync(BATCHES_DIR)) {
    const dir = path.join(BATCHES_DIR, name);
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of entries) {
      if (!file.endsWith('.csv')) continue;
      const full = path.join(dir, file);
      let rows;
      try {
        rows = parseCsv(readFileSync(full, 'utf8'));
      } catch {
        continue;
      }
      if (!rows.length) continue;
      let changed = false;
      for (const row of rows) {
        const cid = String(row.candidateId || '').trim();
        if (!cid || !want.has(cid)) continue;
        row.candidateId = '';
        row.process_status = '';
        changed = true;
        rowsCleared += 1;
      }
      if (!changed) continue;
      try {
        writeFileSync(full, rowsToCsv(rows), 'utf8');
        filesTouched += 1;
      } catch {
        /* ignore */
      }
    }
  }
  return { filesTouched, rowsCleared };
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
  const shotgun = loadShotgunDraft(dir);
  return { batch: meta, rows, dir, shotgun };
}

/** Mark zone-map cities as already promoted so Generate pack does not pack them again. */
export function appendPromotedZoneRows(batchId, entries = []) {
  const list = (entries || []).filter((e) => e?.city && e?.state && e?.candidateId);
  if (!batchId || !list.length) return { added: 0, updated: 0 };
  const { batch, rows, dir } = getBatch(batchId);
  let added = 0;
  let updated = 0;
  for (const entry of list) {
    const city = String(entry.city).trim();
    const state = String(entry.state).trim().toUpperCase();
    const niche = String(entry.niche || batch.filters?.shotgunNiche || '').trim();
    let row = rows.find(
      (r) =>
        String(r.City || '')
          .trim()
          .toLowerCase() === city.toLowerCase() &&
        String(r.State || '')
          .trim()
          .toUpperCase() === state,
    );
    if (!row) {
      row = {};
      for (const col of DISCOVERY_COLUMNS) row[col] = '';
      rows.push(row);
      added += 1;
    } else {
      updated += 1;
    }
    if (niche) row.Niche = row.Niche || niche;
    row.City = city;
    row.State = state;
    row.human_decision = 'pursue';
    row.process_status = 'promoted';
    row.candidateId = entry.candidateId;
    row.shotgun_role = row.shotgun_role || 'member';
    if (!row.decision_notes) row.decision_notes = 'Added from zone map';
  }
  writeFileSync(path.join(dir, 'candidates.csv'), rowsToCsv(rows), 'utf8');
  const meta = {
    ...batch,
    updatedAt: new Date().toISOString(),
    rowCount: rows.length,
    files: { ...(batch.files || {}), candidates: 'candidates.csv' },
  };
  writeJson(path.join(dir, 'meta.json'), meta);
  return { added, updated, batch: meta };
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
  return normalizeCityStateCluster(text, state);
}

/**
 * Create or update this pack's zone from the current draft.
 * Painted cities already in another zone for the niche reject the commit.
 */
export function commitShotgunZoneForBatch(batchId, { members: memberOverride } = {}) {
  const { batch, dir } = getBatch(batchId);
  if (!isClusterPack(batch.filters?.packType)) return null;
  const draft = loadShotgunDraft(dir);
  if (!draft?.hub?.city) return null;
  const niche = draft.niche || batch.filters?.shotgunNiche;
  const rawMembers = memberOverride == null ? draft.members || [] : memberOverride;
  const message = paintedZoneConflictMessage(niche, rawMembers, draft.clusterId);
  if (message) {
    throw Object.assign(new Error(message), { status: 400 });
  }
  const members = annotateMembersWithPipeline(niche, rawMembers, draft.clusterId);
  const patch = {
    niche,
    hub: draft.hub,
    innerMiles: draft.innerMiles,
    outerMiles: draft.outerMiles,
    clusterMiles: draft.clusterMiles,
    bands: draft.bands,
    members,
    source: draft.source || 'discovery',
    batchId,
  };
  if (draft.clusterId) patch.id = draft.clusterId;
  if (draft.reusedFromZoneId) patch.reusedFromZoneId = draft.reusedFromZoneId;
  if (draft.sgNumber) patch.sgNumber = draft.sgNumber;
  const cluster = upsertShotgunCluster(patch);
  copyZoneGuideFromBatch(batchId, cluster.id);
  saveShotgunDraft(dir, {
    ...draft,
    members,
    clusterId: cluster.id,
    groupId: cluster.groupId,
    sgNumber: cluster.sgNumber,
  });
  return cluster;
}

function assertShotgunZoneFree(batch, dir) {
  if (!isClusterPack(batch.filters?.packType)) return;
  const draft = loadShotgunDraft(dir);
  if (!draft?.hub?.city) return;
  const message = paintedZoneConflictMessage(
    draft.niche || batch.filters?.shotgunNiche,
    draft.members,
    draft.clusterId,
  );
  if (message) {
    throw Object.assign(new Error(message), { status: 400 });
  }
}

/**
 * Promote or track rows with human_decision; optional Stage 1 batch for pursue.
 */
export function processDiscoveryBatch(
  batchId,
  { runStage1ForPursue = false, decisions = null, concurrency = 1, adsMode = 'live' } = {},
) {
  const { batch, rows, dir } = getBatch(batchId);
  if (!rows.length) {
    const err = new Error('Batch has no rows');
    err.status = 400;
    throw err;
  }
  assertShotgunZoneFree(batch, dir);

  const allow = Array.isArray(decisions) && decisions.length
    ? new Set(decisions.map((d) => String(d).trim()))
    : null;

  const promoted = [];
  const tracked = [];
  const ignored = [];
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

    if (IGNORE_ONLY_DECISIONS.includes(decision)) {
      row.process_status = 'ignored';
      row.candidateId = '';
      nextRows[i] = row;
      ignored.push({
        index: i,
        decision,
        niche: row.Niche,
        city: row.City,
        state: String(row.State).toUpperCase(),
      });
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
    ignored,
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

  if (isClusterPack(batch.filters?.packType)) {
    const draft = loadShotgunDraft(dir);
    if (draft?.hub?.city) {
      const byGeo = new Map();
      for (const p of promoted) {
        if (!p.candidateId) continue;
        const row = nextRows[p.index];
        if (!row) continue;
        byGeo.set(
          `${String(row.City || '').toLowerCase()}|${String(row.State || '').toUpperCase()}`,
          p.candidateId,
        );
      }
      const members = (draft.members || []).map((m) => {
        const k = `${String(m.city || '').toLowerCase()}|${String(m.state || '').toUpperCase()}`;
        return byGeo.has(k) ? { ...m, candidateId: byGeo.get(k) } : m;
      });
      commitShotgunZoneForBatch(batchId, { members });
    }
  }

  return {
    batch: meta,
    rows: nextRows,
    promoted,
    tracked,
    ignored,
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

function titleCaseBatchFilters(filters) {
  let changed = false;
  if (typeof filters.shotgunNiche === 'string') {
    const next = titleCaseNiche(filters.shotgunNiche);
    if (next !== filters.shotgunNiche) {
      filters.shotgunNiche = next;
      changed = true;
    }
  }
  for (const key of ['requiredNiches', 'niches']) {
    if (!Array.isArray(filters[key])) continue;
    const next = filters[key].map((item) => titleCaseNiche(item));
    if (next.some((item, i) => item !== filters[key][i])) {
      filters[key] = next;
      changed = true;
    }
  }
  return changed;
}

function backfillDiscoveryBatchNiches() {
  if (!existsSync(BATCHES_DIR)) return { files: 0 };
  let files = 0;
  for (const name of readdirSync(BATCHES_DIR)) {
    const dir = path.join(BATCHES_DIR, name);
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    const metaPath = path.join(dir, 'meta.json');
    if (existsSync(metaPath)) {
      const meta = readJson(metaPath);
      if (meta?.filters && titleCaseBatchFilters(meta.filters)) {
        writeJson(metaPath, meta);
        files += 1;
      }
    }
    for (const file of entries) {
      if (!file.endsWith('.csv')) continue;
      const full = path.join(dir, file);
      let text;
      try {
        text = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const { columns, rows } = parseCsvObjects(text);
      if (!columns.some((h) => /^niche$/i.test(h))) continue;
      let changed = false;
      const next = rows.map((row) => {
        const result = titleCaseNicheRow(row, columns);
        if (result.changed) changed = true;
        return result.row;
      });
      if (!changed) continue;
      writeFileSync(full, rowsToCsv(next, columns), 'utf8');
      files += 1;
    }
  }
  return { files };
}

/** Title-case stored niches on candidates, discovery batches, zones, and the known-candidate index. */
export function backfillStoredNicheTitleCase() {
  const candidates = backfillStoredCandidateNiches();
  const batches = backfillDiscoveryBatchNiches();
  const shotgun = backfillShotgunNicheTitleCase();
  const tracked = backfillTrackedNicheTitleCase();
  const known = regenerateKnownCandidates();
  return {
    candidates,
    batches,
    shotgun,
    tracked,
    knownCount: known.count,
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
    promoteDecisions: PROMOTE_DECISIONS,
    trackOnlyDecisions: TRACK_ONLY_DECISIONS,
    ignoreOnlyDecisions: IGNORE_ONLY_DECISIONS,
    jobCosts: loadNicheJobCosts(),
    census: censusStatus(),
    states: listUsStates(),
    columns: DISCOVERY_COLUMNS,
  };
}
