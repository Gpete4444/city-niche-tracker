/**
 * Cluster Discovery jobs: Find hubs, Assign cluster cities, pinned Generate pack.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { claudeMessages, defaultModel } from './claude.mjs';
import { estimateClaudeCostUsd, estimateTokensFromText } from './cost-estimates.mjs';
import { recordRoverApiSpend } from './rover-api-spend.mjs';
import { updateLightJobProgress } from './rover-light-jobs.mjs';
import { formatKnownCandidatesForPrompt } from './known-candidates.mjs';
import {
  buildFilterBrief,
  createDiscoveryPack,
  DISCOVERY_CLAUDE_COLUMNS,
  DISCOVERY_COLUMNS,
  getBatch,
  importDiscoveryCsv,
  normalizeFilters,
  rowsToCsv,
} from './discovery.mjs';
import { getCandidateShell } from './candidates.mjs';
import {
  annotateMembersWithPipeline,
  applyHubScanToDraft,
  applyWaveCaps,
  censusTableForPrompt,
  emptyShotgunDraft,
  ensureLockedHubOnDraft,
  findShotgunClusterByHub,
  findShotgunMember,
  formatHubHintTable,
  hubPopAllowed,
  inPopBand,
  isPackMember,
  applyMemberPaint,
  setZoneHub,
  clusterName,
  listViableHubs,
  loadShotgunDraft,
  membersFromAssign,
  mergeClaudeHub,
  mergePickerHubs,
  normalizeClusterRole,
  normalizeShotgunSettings,
  parseAssignWavesJson,
  parseFindHubsJson,
  placeKey,
  saveShotgunDraft,
  scoreHubCity,
  seedMembersFromPreferred,
  upsertShotgunCluster,
  clampClusterMiles,
} from './shotgun.mjs';
import { shotgunRingPools, findPlaceFeatureLocal, placeInZoneRadius } from './geo-neighbors.mjs';

const ROOT = process.cwd();

function formatUsd(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return `$${Number(n).toFixed(Number(n) < 0.1 ? 4 : 2)}`;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw Object.assign(new Error('Stopped'), { status: 499, cancelled: true });
  }
}

function fillPrompt(relativePath, vars = {}) {
  const full = path.join(ROOT, relativePath);
  if (!existsSync(full)) throw new Error(`Prompt not found: ${relativePath}`);
  let out = readFileSync(full, 'utf8');
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value == null ? '' : String(value));
  }
  return out;
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

function draftFor(batchId) {
  const { batch, dir } = getBatch(batchId);
  return {
    batch,
    dir,
    draft: loadShotgunDraft(dir) || emptyShotgunDraft(batch.filters || {}),
  };
}

function nicheOf(batch, draft) {
  return (
    String(draft.niche || '').trim() ||
    String(batch.filters?.shotgunNiche || '').trim() ||
    String(batch.filters?.requiredNiches?.[0] || '').trim()
  );
}

function shotgunKnown(batch) {
  const f = normalizeFilters(batch.filters || {});
  return formatKnownCandidatesForPrompt({
    stateFilter: f.states.length ? f.states : null,
    limit: 200,
    compact: true,
  });
}

export function ensureShotgunDraft(batchId) {
  const { batch, dir } = getBatch(batchId);
  const existing = loadShotgunDraft(dir);
  if (existing) return existing;
  const draft = emptyShotgunDraft(batch.filters || {});
  return saveShotgunDraft(dir, draft);
}

export function ensureHubScan(batchId) {
  const { batch, dir, draft } = draftFor(batchId);
  let current = draft;
  if (draft.hub?.city && draft.hub?.state) {
    const withLock = ensureLockedHubOnDraft(draft);
    if (withLock !== draft) current = saveShotgunDraft(dir, withLock);
  }
  const hasWaveLists = (current.viableHubs || []).some((h) => Array.isArray(h.wave1));
  const scanComplete =
    Boolean(current.hubScan) &&
    Array.isArray(current.viableHubs) &&
    Array.isArray(current.rejectedHubs) &&
    (hasWaveLists || !(current.viableHubs || []).length);
  if (scanComplete) {
    return {
      batch,
      dir,
      draft: current,
      scan: {
        scanned: current.hubScan.scanned,
        viable: current.viableHubs,
        rejected: current.rejectedHubs,
        states: current.hubScan.states || [],
        error: current.hubScan.error || null,
        settings: normalizeShotgunSettings(current),
      },
    };
  }
  if (current.hub?.city && current.hub?.state) {
    return {
      batch,
      dir,
      draft: current,
      scan: {
        scanned: Number(current.hubScan?.scanned) || 0,
        viable: current.viableHubs || [],
        rejected: current.rejectedHubs || [],
        states: current.hubScan?.states || [],
        error: current.hubScan?.error || null,
        settings: normalizeShotgunSettings(current),
      },
    };
  }
  const f = normalizeFilters(batch.filters || {});
  const scan = listViableHubs(f.states, current);
  const next = saveShotgunDraft(dir, applyHubScanToDraft(current, scan));
  return { batch, dir, draft: next, scan };
}

export function assertFindHubsAllowed(batchId) {
  ensureHubScan(batchId);
}

export function buildFindHubsPrompt(batchId, { api = false } = {}) {
  const { batch, draft } = draftFor(batchId);
  const f = normalizeFilters(batch.filters || {});
  const s = normalizeShotgunSettings(draft);
  const niche = nicheOf(batch, draft);
  const file = api
    ? 'prompts/claude-shotgun-find-hubs-api.md'
    : 'prompts/claude-shotgun-find-hubs.md';
  return fillPrompt(file, {
    FILTER_BRIEF: buildFilterBrief(f),
    NICHE: niche,
    KNOWN_CANDIDATES: shotgunKnown(batch),
    VIABLE_TABLE: formatHubHintTable(draft.viableHubs, draft.rejectedHubs),
    HUB_BAND: `${s.bands.hub.min}–${s.bands.hub.max ?? '∞'}`,
    CITIES_BAND: `${s.bands.cities.min}–${s.bands.cities.max ?? '∞'}`,
    CLUSTER_MILES: String(s.clusterMiles),
    WAVE1_BAND: `${s.bands.cities.min}–${s.bands.cities.max ?? '∞'}`,
    WAVE2_BAND: `${s.bands.cities.min}–${s.bands.cities.max ?? '∞'}`,
    INNER_MILES: String(s.clusterMiles),
    OUTER_MILES: String(s.clusterMiles),
  });
}

export function buildAssignWavesPrompt(batchId, { api = false } = {}) {
  const { batch, draft } = draftFor(batchId);
  const f = normalizeFilters(batch.filters || {});
  const s = normalizeShotgunSettings(draft);
  const niche = nicheOf(batch, draft);
  const hub = draft.hub;
  if (!hub?.city || !hub?.state) {
    throw Object.assign(new Error('Pick a hub before Assign cluster cities'), { status: 400 });
  }
  const rings = shotgunRingPools(hub.city, hub.state, {
    innerMiles: s.clusterMiles,
    outerMiles: s.clusterMiles,
    wave1: s.bands.cities,
    wave2: s.bands.cities,
  });
  const file = api
    ? 'prompts/claude-shotgun-assign-waves-api.md'
    : 'prompts/claude-shotgun-assign-waves.md';
  return {
    prompt: fillPrompt(file, {
      FILTER_BRIEF: buildFilterBrief(f),
      NICHE: niche,
      HUB_CITY: rings.primary.name,
      HUB_STATE: rings.primary.state,
      INNER_MILES: String(s.clusterMiles),
      OUTER_MILES: String(s.clusterMiles),
      CLUSTER_MILES: String(s.clusterMiles),
      WAVE1_BAND: `${s.bands.cities.min}–${s.bands.cities.max ?? '∞'}`,
      WAVE2_BAND: `${s.bands.cities.min}–${s.bands.cities.max ?? '∞'}`,
      CITIES_BAND: `${s.bands.cities.min}–${s.bands.cities.max ?? '∞'}`,
      CENSUS_TABLE: censusTableForPrompt(rings),
      KNOWN_CANDIDATES: shotgunKnown(batch),
    }),
    rings,
  };
}

function pinnedRows(niche, members) {
  return (members || [])
    .filter((m) => isPackMember(m))
    .filter((m) => !m.candidateId)
    .map((m) => {
      const row = {};
      for (const col of DISCOVERY_CLAUDE_COLUMNS) row[col] = '';
      row.Niche = niche;
      row.City = m.city;
      row.State = m.state;
      return row;
    });
}

export function buildGeneratePackPrompt(batchId, { api = false } = {}) {
  const { batch, dir, draft } = draftFor(batchId);
  const f = normalizeFilters(batch.filters || {});
  const niche = nicheOf(batch, draft);
  const annotated = annotateMembersWithPipeline(niche, draft.members || []);
  const rows = pinnedRows(niche, annotated);
  const csv = rowsToCsv(rows, DISCOVERY_CLAUDE_COLUMNS);
  const siblings = annotated
    .map((m) => `${m.city}, ${m.state} (${m.role})`)
    .join('\n');
  const file = api
    ? 'prompts/claude-shotgun-generate-pack-api.md'
    : 'prompts/claude-shotgun-generate-pack.md';
  return fillPrompt(file, {
    FILTER_BRIEF: buildFilterBrief(f),
    NICHE: niche,
    PINNED_CSV: csv.trimEnd(),
    SIBLING_CITIES: siblings || '(none)',
    OUTPUT_BASENAME: batch.outputBasename || `shotgun-${batch.id}`,
    CLAUDE_OUTPUT_CSV: batch.files?.claudeCsv || 'shotgun-claude.csv',
    BATCH_DIR: dir,
  });
}

export function getShotgunCostPreview(batchId, act) {
  const { batch } = getBatch(batchId);
  let prompt = '';
  let title = 'Cluster Claude?';
  let what = '';
  if (act === 'shotgun-find-hubs') {
    ensureHubScan(batchId);
    prompt = buildFindHubsPrompt(batchId, { api: true });
    title = 'Find hubs with Claude?';
    what =
      'Claude proposes hubs plus Cluster Cities. Rover Census-matches places and miles. Census leftovers stay on the map.';
  } else if (act === 'shotgun-assign-waves') {
    prompt = buildAssignWavesPrompt(batchId, { api: true }).prompt;
    title = 'Assign cluster cities with Claude?';
    what = 'Claude assigns Hub / Cluster Cities from the Census table. You can still click the map.';
  } else {
    prompt = buildGeneratePackPrompt(batchId, { api: true });
    title = 'Generate cluster pack with Claude?';
    what =
      'Claude fills copy for this hub’s Hub + Cluster Cities only. Other hubs in the picker are not packed. Existing pipeline cities are merged, not duplicated.';
    act = 'shotgun-generate-pack';
  }
  const inputTokens = estimateTokensFromText(prompt);
  const outputTokens = act === 'shotgun-generate-pack' ? 4000 : 2000;
  const priced = estimateClaudeCostUsd({
    inputTokens,
    outputTokens,
    model: defaultModel(),
  });
  const lastCost = batch.lastCosts?.[act] ?? null;
  return {
    act,
    provider: 'anthropic',
    title,
    whatItDoes: what,
    estimateLabel:
      lastCost != null
        ? `Last run: ${formatUsd(lastCost)}`
        : `~${formatUsd(priced.costUsd)} (${inputTokens.toLocaleString()} in + ~${outputTokens.toLocaleString()} out tokens)`,
    estimateUsdLow: lastCost ?? priced.costUsd,
    estimateUsdHigh: lastCost ?? priced.costUsd,
    estimateDetail:
      lastCost != null ? 'Using your last cost for this step.' : priced.costNote,
    model: defaultModel(),
    confirmLabel:
      lastCost != null
        ? `${title.replace('?', '')} (est. ${formatUsd(lastCost)})`
        : `${title.replace('?', '')} (est. ${formatUsd(priced.costUsd)})`,
    freeFallback: 'Prefer Copy & paste? Switch the header toggle.',
  };
}

export function importFindHubsText(batchId, text) {
  const { dir, draft, batch } = ensureHubScan(batchId);
  const parsed = parseFindHubsJson(text);
  const survivors = [];
  const claudeRejected = [];
  for (const h of parsed.hubs) {
    const merged = mergeClaudeHub(h, draft);
    if (merged.ok) survivors.push(merged.hub);
    else {
      claudeRejected.push({
        city: h.city,
        state: h.state,
        why: h.why || '',
        rejectReason: merged.rejectReason || 'rejected',
      });
    }
  }
  const next = saveShotgunDraft(dir, {
    ...draft,
    step: 'hub',
    hubs: survivors,
    claudeClustersRan: true,
    rejectedHubs: draft.rejectedHubs || [],
    claudeRejectedHubs: claudeRejected,
    niche: nicheOf(batch, draft),
  });
  return {
    draft: next,
    survivors,
    rejected: claudeRejected,
  };
}

export function selectShotgunHub(batchId, city, state) {
  const { dir, draft, batch } = draftFor(batchId);
  if (!String(city || '').trim() || !String(state || '').trim()) {
    return clearShotgunHub(batchId);
  }
  const scored = scoreHubCity(city, state, draft);
  if (!hubPopAllowed(scored.population, normalizeShotgunSettings(draft).bands.hub)) {
    const err = new Error(
      scored.rejectReason || `${city} is outside the Hub population band.`,
    );
    err.status = 400;
    throw err;
  }
  const fromClaude = (draft.hubs || []).find(
    (h) => placeKey(h.city, h.state) === placeKey(city, state),
  );
  const members = annotateMembersWithPipeline(
    nicheOf(batch, draft),
    seedMembersFromPreferred(fromClaude || scored, scored),
  );
  const hasCities = members.some((m) => isPackMember(m) && normalizeClusterRole(m.role) !== 'hub');
  return saveShotgunDraft(dir, {
    ...draft,
    hub: { city: scored.city, state: scored.state, population: scored.population },
    members,
    step: hasCities ? 'pack' : 'assign',
  });
}

export function clearShotgunHub(batchId) {
  const { dir, draft } = draftFor(batchId);
  return saveShotgunDraft(dir, {
    ...draft,
    hub: null,
    members: [],
    step: 'hub',
  });
}

export function importAssignWavesText(batchId, text) {
  const { dir, draft, batch } = draftFor(batchId);
  if (!draft.hub?.city) {
    throw Object.assign(new Error('Pick a hub before Assign cluster cities'), { status: 400 });
  }
  const parsed = parseAssignWavesJson(text);
  const capped = applyWaveCaps(parsed);
  const s = normalizeShotgunSettings(draft);
  const rings = shotgunRingPools(draft.hub.city, draft.hub.state, {
    innerMiles: s.clusterMiles,
    outerMiles: s.clusterMiles,
    wave1: s.bands.cities,
    wave2: s.bands.cities,
  });
  const allow = new Set(
    [placeKey(rings.primary.name, rings.primary.state)].concat(
      rings.innerPool.map((p) => placeKey(p.name, p.state)),
      rings.outerPool.map((p) => placeKey(p.name, p.state)),
    ),
  );
  const keep = (c) => allow.has(placeKey(c.city, c.state));
  const main = keepCity(capped.main, allow) ? capped.main : {
    city: rings.primary.name,
    state: rings.primary.state,
  };
  const wave1 = capped.wave1.filter(keep);
  const wave2 = capped.wave2.filter(keep);
  const members = annotateMembersWithPipeline(
    nicheOf(batch, draft),
    membersFromAssign({ main, wave1, wave2 }, rings),
  );
  return saveShotgunDraft(dir, {
    ...draft,
    hub: { city: main.city, state: main.state, population: rings.primary.population },
    members,
    skipped: parsed.skipped,
    step: 'pack',
  });
}

function keepCity(c, allow) {
  return c && allow.has(placeKey(c.city, c.state));
}

export function applyGeneratePackRows(batchId, members) {
  const { batch, dir, draft } = draftFor(batchId);
  const niche = nicheOf(batch, draft);
  const annotated = annotateMembersWithPipeline(niche, members || draft.members || []);
  const cluster = upsertShotgunCluster({
    id: draft.clusterId,
    niche,
    hub: draft.hub,
    innerMiles: draft.innerMiles,
    outerMiles: draft.outerMiles,
    bands: draft.bands,
    members: annotated,
    source: draft.source || 'discovery',
    batchId,
  });
  saveShotgunDraft(dir, { ...draft, members: annotated, clusterId: cluster.id, groupId: cluster.groupId });
  return { cluster, members: annotated, batch };
}

export async function runFindHubsJob(batchId, { jobId, signal } = {}) {
  assertFindHubsAllowed(batchId);
  const prompt = buildFindHubsPrompt(batchId, { api: true });
  const tick = (detail, done) => updateLightJobProgress(jobId, { detail, done, total: 2 });
  tick('Finding clusters', 1);
  throwIfAborted(signal);
  const { text, costUsd, usage, truncated } = await claudeMessages({
    user: prompt,
    maxTokens: 2500,
    effort: 'low',
    signal,
  });
  if (truncated) {
    throw Object.assign(new Error('Claude hit the token cap — retry Find clusters.'), { status: 502 });
  }
  if (costUsd != null) {
    recordRoverApiSpend('anthropic', costUsd);
    patchBatchMeta(batchId, { lastCosts: { 'shotgun-find-hubs': costUsd } });
  }
  tick('Gating Census pools', 2);
  const result = importFindHubsText(batchId, text);
  return { ok: true, ...result, costUsd: costUsd ?? null, usage };
}

export async function runAssignWavesJob(batchId, { jobId, signal } = {}) {
  const { prompt } = buildAssignWavesPrompt(batchId, { api: true });
  const tick = (detail, done) => updateLightJobProgress(jobId, { detail, done, total: 2 });
  tick('Assigning waves', 1);
  throwIfAborted(signal);
  const { text, costUsd, usage, truncated } = await claudeMessages({
    user: prompt,
    maxTokens: 2500,
    effort: 'low',
    signal,
  });
  if (truncated) {
    throw Object.assign(new Error('Claude hit the token cap — retry Assign cluster cities.'), { status: 502 });
  }
  if (costUsd != null) {
    recordRoverApiSpend('anthropic', costUsd);
    patchBatchMeta(batchId, { lastCosts: { 'shotgun-assign-waves': costUsd } });
  }
  tick('Updating map', 2);
  const draft = importAssignWavesText(batchId, text);
  return { ok: true, draft, costUsd: costUsd ?? null, usage };
}

export async function runShotgunGeneratePackJob(batchId, { jobId, signal } = {}) {
  const prompt = buildGeneratePackPrompt(batchId, { api: true });
  const tick = (detail, done) => updateLightJobProgress(jobId, { detail, done, total: 2 });
  tick('Calling Claude', 1);
  throwIfAborted(signal);
  const { text, costUsd, usage, truncated } = await claudeMessages({
    user: prompt,
    maxTokens: 8000,
    effort: 'low',
    signal,
  });
  if (truncated) {
    throw Object.assign(new Error('Claude hit the token cap — retry Generate cluster pack.'), {
      status: 502,
    });
  }
  if (costUsd != null) {
    recordRoverApiSpend('anthropic', costUsd);
    patchBatchMeta(batchId, { lastCosts: { 'shotgun-generate-pack': costUsd } });
  }
  tick('Importing CSV', 2);
  const imported = importDiscoveryCsv(batchId, text, { createIfMissing: false });
  const { dir, draft } = draftFor(batchId);
  applyGeneratePackRows(batchId, draft.members);
  const next = loadShotgunDraft(dir);
  syncShotgunRosterRows(batchId, next.members);
  return {
    ok: true,
    batch: imported.batch,
    rowCount: imported.batch?.rowCount ?? 0,
    draft: next,
    costUsd: costUsd ?? null,
    usage,
  };
}

function stampShotgunRolesOnRows(batchId, members) {
  const { rows, dir } = getBatch(batchId);
  const byKey = new Map();
  for (const m of members || []) {
    byKey.set(placeKey(m.city, m.state), m.role);
  }
  for (const row of rows) {
    const k = placeKey(row.City, row.State);
    if (byKey.has(k)) row.shotgun_role = normalizeClusterRole(byKey.get(k)) || byKey.get(k);
  }
  writeFileSync(path.join(dir, 'candidates.csv'), rowsToCsv(rows), 'utf8');
}

export function syncShotgunRosterRows(batchId, members) {
  const { rows, dir, batch } = getBatch(batchId);
  const { draft } = draftFor(batchId);
  const niche = nicheOf(batch, draft);
  const list = annotateMembersWithPipeline(niche, members || draft.members || []);
  stampShotgunRolesOnRows(batchId, list);
  const { rows: nextRows } = getBatch(batchId);
  const seen = new Set(nextRows.map((r) => placeKey(r.City, r.State)));
  let added = 0;
  for (const m of list) {
    if (!m.candidateId) continue;
    const k = placeKey(m.city, m.state);
    if (seen.has(k)) continue;
    const row = {};
    for (const col of DISCOVERY_COLUMNS) row[col] = '';
    row.Niche = niche;
    row.City = m.city;
    row.State = m.state;
    row.shotgun_role = m.role;
    row.candidateId = m.candidateId;
    row.process_status = 'promoted';
    row.human_decision = 'pursue';
    row.decision_notes = `Already in pipeline (${m.pipelineStage || 'Research'})`;
    nextRows.push(row);
    added += 1;
  }
  if (added) {
    writeFileSync(path.join(dir, 'candidates.csv'), rowsToCsv(nextRows), 'utf8');
  }
  return { rows: nextRows, added };
}

export function getShotgunWorkspace(batchId) {
  const { batch, dir, draft: scanned } = ensureHubScan(batchId);
  const draft = scanned;
  const s = normalizeShotgunSettings(draft);
  const niche = nicheOf(batch, draft);
  const miles = s.clusterMiles;
  let rings = null;
  if (draft.hub?.city && draft.hub?.state) {
    try {
      rings = shotgunRingPools(draft.hub.city, draft.hub.state, {
        innerMiles: miles,
        outerMiles: miles,
        wave1: s.bands.cities,
        wave2: s.bands.cities,
      });
    } catch (error) {
      rings = { error: error.message };
    }
  }
  const members = annotateMembersWithPipeline(niche, draft.members || []);
  const assigned = members.filter((m) => isPackMember(m));
  const picked = mergePickerHubs(draft.viableHubs, draft.hubs, draft.rejectedHubs);
  return {
    draft: { ...draft, members },
    pickerHubs: [...picked.claude, ...picked.censusExtras],
    claudeHubs: picked.claude,
    censusExtras: picked.censusExtras,
    rings,
    settings: s,
    niche,
    summary: {
      newCount: assigned.filter((m) => !m.candidateId).length,
      existingCount: assigned.filter((m) => m.candidateId).length,
      blocked: assigned.filter((m) => m.otherClusterId || m.passed || m.archived).length,
    },
    prompts: {
      findHubs: buildFindHubsPrompt(batchId, { api: false }),
      assignWaves: draft.hub?.city ? buildAssignWavesPrompt(batchId, { api: false }).prompt : '',
      generatePack: assigned.length ? buildGeneratePackPrompt(batchId, { api: false }) : '',
    },
    dir,
    batch,
  };
}

function moveShotgunHub(batchId, city, state, opts = {}) {
  const { dir, draft, batch } = draftFor(batchId);
  const fromKey = placeKey(draft.hub.city, draft.hub.state);
  const toKey = placeKey(city, state);
  if (!toKey || (fromKey && fromKey === toKey)) return draft;
  const feat = findPlaceFeatureLocal(city, state);
  const already = (draft.members || []).find((m) => placeKey(m.city, m.state) === toKey);
  if (!feat && !already) {
    throw Object.assign(new Error('No Census place match for that city'), { status: 400 });
  }
  const name = feat?.properties?.name || already?.city || city;
  const st = feat?.properties?.state || already?.state || String(state || '').toUpperCase();
  const pop = Number(feat?.properties?.population ?? already?.population) || draft.hub.population || null;
  const s = normalizeShotgunSettings(draft);
  const liveRaw = Number(opts.radiusMiles);
  const milesCap = Number.isFinite(liveRaw) ? clampClusterMiles(liveRaw) : s.clusterMiles;
  const members = annotateMembersWithPipeline(
    nicheOf(batch, draft),
    setZoneHub(draft.members || [], {
      fromCity: draft.hub.city,
      fromState: draft.hub.state,
      toCity: name,
      toState: st,
      population: pop,
    }),
  );
  const hub = { city: name, state: st, population: pop };
  const saved = saveShotgunDraft(dir, {
    ...draft,
    hub,
    members,
    step: 'pack',
    clusterMiles: milesCap,
    innerMiles: milesCap,
    outerMiles: milesCap,
  });
  if (draft.clusterId) {
    try {
      upsertShotgunCluster({
        id: draft.clusterId,
        niche: nicheOf(batch, saved),
        hub,
        members,
        name: clusterName(nicheOf(batch, saved), name, st),
        innerMiles: milesCap,
        outerMiles: milesCap,
        clusterMiles: milesCap,
        bands: draft.bands,
        batchId,
      });
    } catch {
      /* registry sync is best-effort while still in Discovery */
    }
  }
  return saved;
}

export function setShotgunMemberPaint(batchId, city, state, opts = {}) {
  const { dir, draft, batch } = draftFor(batchId);
  if (!draft.hub?.city) {
    throw Object.assign(new Error('Pick a hub first'), { status: 400 });
  }
  const rawTool = String(opts.tool || 'cluster').toLowerCase();
  if (rawTool === 'hub') {
    return moveShotgunHub(batchId, city, state, opts);
  }
  const tool = 'cluster';
  const slot = opts.slot;
  const s = normalizeShotgunSettings(draft);
  const liveRaw = Number(opts.radiusMiles);
  const sLive = normalizeShotgunSettings({
    ...draft,
    clusterMiles: Number.isFinite(liveRaw) ? liveRaw : s.clusterMiles,
  });
  const k = placeKey(city, state);
  const zone = placeInZoneRadius(city, state, draft.hub.city, draft.hub.state, sLive.clusterMiles);
  const feat = zone.feat;
  const already = (draft.members || []).find((m) => placeKey(m.city, m.state) === k);
  const isHub = k === placeKey(draft.hub.city, draft.hub.state);
  const clearing = !Number(slot);
  if (!already && !isHub && !clearing) {
    if (!feat) {
      throw Object.assign(new Error('No Census place match for that city'), { status: 400 });
    }
    if (!zone.inZone) {
      throw Object.assign(new Error('City is outside the Zone radius'), { status: 400 });
    }
    const pop = Number(feat?.properties?.population) || 0;
    const overrideMin = Number(opts.minPop);
    const overrideMax = Number(opts.maxPop);
    const useMapRange = Number.isFinite(overrideMin) && Number.isFinite(overrideMax);
    if (useMapRange) {
      if (!inPopBand(pop, { min: overrideMin, max: overrideMax })) {
        throw Object.assign(new Error('Population is outside the map min/max range'), { status: 400 });
      }
    } else if (!inPopBand(pop, s.bands.cities)) {
      throw Object.assign(new Error('Population is outside the Cluster Cities band'), { status: 400 });
    }
  }
  const name = feat?.properties?.name || already?.city || city;
  const st = feat?.properties?.state || already?.state || String(state || '').toUpperCase();
  const pop = Number(feat?.properties?.population ?? already?.population) || null;
  const miles = isHub ? 0 : zone.miles;
  const members = annotateMembersWithPipeline(
    nicheOf(batch, draft),
    applyMemberPaint(draft.members || [], draft.hub, {
      city: name,
      state: st,
      tool,
      slot,
      population: pop,
      miles,
      name,
      featState: st,
    }),
  );
  const saved = saveShotgunDraft(dir, {
    ...draft,
    members,
    step: 'pack',
    clusterMiles: sLive.clusterMiles,
    innerMiles: sLive.clusterMiles,
    outerMiles: sLive.clusterMiles,
  });
  if (draft.clusterId) {
    try {
      upsertShotgunCluster({
        id: draft.clusterId,
        niche: nicheOf(batch, saved),
        hub: draft.hub,
        members,
        innerMiles: sLive.clusterMiles,
        outerMiles: sLive.clusterMiles,
        clusterMiles: sLive.clusterMiles,
        bands: draft.bands,
        batchId,
      });
    } catch {
      /* registry sync is best-effort while still in Discovery */
    }
  }
  return saved;
}

export function setShotgunMemberRole(batchId, city, state, role, opts = {}) {
  const want = normalizeClusterRole(role) || String(role || '').toLowerCase();
  if (want === 'unassigned') {
    return setShotgunMemberPaint(batchId, city, state, { ...opts, tool: 'cluster', slot: 0 });
  }
  if (want === 'hub') {
    return setShotgunMemberPaint(batchId, city, state, { ...opts, tool: 'hub' });
  }
  return setShotgunMemberPaint(batchId, city, state, { ...opts, tool: 'cluster', slot: 0 });
}

export function setShotgunRadius(batchId, miles) {
  const { dir, draft } = draftFor(batchId);
  const s = normalizeShotgunSettings({ ...draft, clusterMiles: miles });
  return saveShotgunDraft(dir, {
    ...draft,
    clusterMiles: s.clusterMiles,
    innerMiles: s.clusterMiles,
    outerMiles: s.clusterMiles,
  });
}

export function finalizeShotgunImport(batchId) {
  const { draft } = draftFor(batchId);
  applyGeneratePackRows(batchId, draft.members);
  const next = loadShotgunDraft(draftFor(batchId).dir);
  syncShotgunRosterRows(batchId, next.members);
  return getShotgunWorkspace(batchId);
}

export function startShotgunThisMetro(candidateId) {
  const shell = getCandidateShell(candidateId);
  const niche = String(shell.config?.niche || shell.summary?.niche || '').trim();
  const primary = String(shell.config?.primary || '');
  const [cityPart, statePart] = primary.split(',').map((s) => s.trim());
  const city = String(shell.summary?.primaryCity || cityPart || '').trim();
  const state = String(shell.summary?.state || statePart || '')
    .trim()
    .toUpperCase();
  if (!niche || !city || !state) {
    throw Object.assign(new Error('Candidate needs niche, city, and state'), { status: 400 });
  }
  const asHub = findShotgunClusterByHub(niche, city, state);
  if (asHub) {
    return { existing: true, cluster: asHub, batchId: asHub.batchId || null };
  }
  const asMember = findShotgunMember(niche, city, state);
  if (asMember) {
    return { existing: true, cluster: asMember.cluster, batchId: asMember.cluster.batchId || null };
  }
  let scored;
  try {
    scored = scoreHubCity(city, state, {});
  } catch (error) {
    throw Object.assign(new Error(error.message || 'No Census place match for this city'), {
      status: 400,
    });
  }
  if (!scored.viable) {
    throw Object.assign(
      new Error(
        scored.rejectReason ||
          `${city} does not have enough Cluster Cities. Raise miles or lower pop mins.`,
      ),
      { status: 400 },
    );
  }
  const pack = createDiscoveryPack({
    packType: 'cluster',
    shotgunNiche: niche,
    requiredNiches: [niche],
    state,
    cities: [city],
    maxRows: 20,
  });
  selectShotgunHub(pack.batch.id, city, state);
  return { existing: false, pack, batchId: pack.batch.id };
}

export { formatUsd };
