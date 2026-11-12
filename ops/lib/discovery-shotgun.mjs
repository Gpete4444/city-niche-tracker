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
  buildGeneratePackContext,
  createDiscoveryPack,
  DISCOVERY_CLAUDE_COLUMNS,
  DISCOVERY_COLUMNS,
  getBatch,
  importDiscoveryCsv,
  normalizeFilters,
  rowsToCsv,
} from './discovery.mjs';
import { getCandidateShell, titleCaseNiche } from './candidates.mjs';
import {
  annotateMembersWithPipeline,
  applyHubScanToDraft,
  applyCityCaps,
  censusTableForPrompt,
  emptyShotgunDraft,
  ensureLockedHubOnDraft,
  findShotgunClusterByHub,
  findShotgunMember,
  formatHubHintTable,
  hubPopAllowed,
  isPackMember,
  applyMemberPaint,
  applyMemberPaintMany,
  pruneMembersOutsideZone,
  centroidInsideZone,
  setZoneHub,
  buildZoneReuseDraft,
  clusterName,
  listViableHubs,
  loadShotgunClusters,
  loadShotgunDraft,
  membersFromAssign,
  mergeClaudeHub,
  mergePickerHubs,
  normalizeClusterRole,
  normalizeShotgunSettings,
  parseAssignCitiesJson,
  parseFindHubsJson,
  placeKey,
  saveShotgunDraft,
  scoreHubCity,
  seedMembersFromPreferred,
  upsertShotgunCluster,
  clampClusterMiles,
} from './shotgun.mjs';
import { shotgunRingPools, findPlaceFeatureLocal, placeInZoneRadius } from './geo-neighbors.mjs';
import {
  fillGeneratePackRowChunks,
  formatGeneratePackSiblings,
  GENERATE_PACK_CHUNK,
  generatePackChunkCount,
  generatePackChunkMaxTokens,
} from './discovery-generate-pack-chunks.mjs';
import { zoneGuideBlockForBatch } from './zone-guide.mjs';

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
    out = out.split(`{{${key}}}`).join(value == null ? '' : String(value));
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
  const raw =
    String(draft?.niche || '').trim() ||
    String(batch?.filters?.shotgunNiche || '').trim() ||
    String(batch?.filters?.requiredNiches?.[0] || '').trim();
  return titleCaseNiche(raw);
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
  const hasCityLists = (current.viableHubs || []).some(
    (h) => Array.isArray(h.innerCities) || Array.isArray(h.wave1),
  );
  const scanComplete =
    Boolean(current.hubScan) &&
    Array.isArray(current.viableHubs) &&
    Array.isArray(current.rejectedHubs) &&
    (hasCityLists || !(current.viableHubs || []).length);
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
    INNER_MILES: String(s.clusterMiles),
    OUTER_MILES: String(s.clusterMiles),
    ZONE_GUIDE: zoneGuideBlockForBatch(batchId, 'cities'),
  });
}

export function buildAssignCitiesPrompt(batchId, { api = false } = {}) {
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
    citiesBand: s.bands.cities,
  });
  const file = api
    ? 'prompts/claude-shotgun-assign-cities-api.md'
    : 'prompts/claude-shotgun-assign-cities.md';
  return {
    prompt: fillPrompt(file, {
      FILTER_BRIEF: buildFilterBrief(f),
      NICHE: niche,
      HUB_CITY: rings.primary.name,
      HUB_STATE: rings.primary.state,
      INNER_MILES: String(s.clusterMiles),
      OUTER_MILES: String(s.clusterMiles),
      CLUSTER_MILES: String(s.clusterMiles),
      CITIES_BAND: `${s.bands.cities.min}–${s.bands.cities.max ?? '∞'}`,
      CENSUS_TABLE: censusTableForPrompt(rings),
      KNOWN_CANDIDATES: shotgunKnown(batch),
      ZONE_GUIDE: zoneGuideBlockForBatch(batchId, 'cities'),
    }),
    rings,
  };
}

export function pinnedRows(niche, members) {
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

export function buildGeneratePackPrompt(batchId, { api = false, pinnedRows: pinned = null } = {}) {
  const { batch, dir, draft } = draftFor(batchId);
  const f = normalizeFilters(batch.filters || {});
  const niche = nicheOf(batch, draft);
  const annotated = annotateMembersWithPipeline(niche, draft.members || []);
  const rows = Array.isArray(pinned) ? pinned : pinnedRows(niche, annotated);
  const csv = rowsToCsv(rows, DISCOVERY_CLAUDE_COLUMNS);
  const file = api
    ? 'prompts/claude-shotgun-generate-pack-api.md'
    : 'prompts/claude-shotgun-generate-pack.md';
  return fillPrompt(file, {
    FILTER_BRIEF: api ? '' : buildFilterBrief(f),
    PACK_CONTEXT: buildGeneratePackContext(f, niche),
    NICHE: niche,
    PINNED_CSV: csv.trimEnd(),
    SIBLING_CITIES: formatGeneratePackSiblings(annotated),
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
  } else if (act === 'shotgun-assign-cities' || act === 'shotgun-assign-waves') {
    prompt = buildAssignCitiesPrompt(batchId, { api: true }).prompt;
    act = 'shotgun-assign-cities';
    title = 'Assign cluster cities with Claude?';
    what = 'Claude assigns Hub / Cluster Cities from the Census table. You can still click the map.';
  } else {
    const { draft } = draftFor(batchId);
    const niche = nicheOf(batch, draft);
    const annotated = annotateMembersWithPipeline(niche, draft.members || []);
    const pinned = pinnedRows(niche, annotated);
    const chunks = generatePackChunkCount(pinned.length);
    prompt = buildGeneratePackPrompt(batchId, {
      api: true,
      pinnedRows: pinned.slice(0, GENERATE_PACK_CHUNK),
    });
    title = 'Generate cluster pack with Claude?';
    what =
      'Claude fills copy for this hub’s Hub + Cluster Cities only. Other hubs in the picker are not packed. Existing pipeline cities are merged, not duplicated.';
    act = 'shotgun-generate-pack';
    const inputTokens = estimateTokensFromText(prompt) * chunks;
    const perOut = generatePackChunkMaxTokens(Math.min(GENERATE_PACK_CHUNK, pinned.length || 1));
    const outputTokens = perOut * chunks;
    const priced = estimateClaudeCostUsd({
      inputTokens,
      outputTokens,
      model: defaultModel(),
    });
    const lastCost =
      batch.lastCosts?.[act] ??
      (act === 'shotgun-assign-cities' ? batch.lastCosts?.['shotgun-assign-waves'] : null) ??
      null;
    const callsNote = chunks > 1 ? `${chunks} Claude calls` : '1 Claude call';
    return {
      act,
      provider: 'anthropic',
      title,
      whatItDoes: what,
      estimateLabel:
        lastCost != null
          ? `Last run: ${formatUsd(lastCost)}`
          : `~${formatUsd(priced.costUsd)} (${callsNote} · ${inputTokens.toLocaleString()} in + ~${outputTokens.toLocaleString()} out tokens)`,
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
  const inputTokens = estimateTokensFromText(prompt);
  const outputTokens = 2000;
  const priced = estimateClaudeCostUsd({
    inputTokens,
    outputTokens,
    model: defaultModel(),
  });
  const lastCost =
    batch.lastCosts?.[act] ??
    (act === 'shotgun-assign-cities' ? batch.lastCosts?.['shotgun-assign-waves'] : null) ??
    null;
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

export function importAssignCitiesText(batchId, text) {
  const { dir, draft, batch } = draftFor(batchId);
  if (!draft.hub?.city) {
    throw Object.assign(new Error('Pick a hub before Assign cluster cities'), { status: 400 });
  }
  const parsed = parseAssignCitiesJson(text);
  const capped = applyCityCaps(parsed);
  const s = normalizeShotgunSettings(draft);
  const rings = shotgunRingPools(draft.hub.city, draft.hub.state, {
    innerMiles: s.clusterMiles,
    outerMiles: s.clusterMiles,
    citiesBand: s.bands.cities,
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
  const cities = (capped.cities || []).filter(keep);
  const members = annotateMembersWithPipeline(
    nicheOf(batch, draft),
    membersFromAssign({ main, cities }, rings),
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
  const annotated = annotateMembersWithPipeline(
    niche,
    members || draft.members || [],
    draft.clusterId,
  );
  let cluster = null;
  if (draft.clusterId) {
    cluster = upsertShotgunCluster({
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
  }
  saveShotgunDraft(dir, {
    ...draft,
    members: annotated,
    clusterId: cluster?.id || draft.clusterId || null,
    groupId: cluster?.groupId || draft.groupId || null,
  });
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

export async function runAssignCitiesJob(batchId, { jobId, signal } = {}) {
  const { prompt } = buildAssignCitiesPrompt(batchId, { api: true });
  const tick = (detail, done) => updateLightJobProgress(jobId, { detail, done, total: 2 });
  tick('Assigning cluster cities', 1);
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
    patchBatchMeta(batchId, { lastCosts: { 'shotgun-assign-cities': costUsd } });
  }
  tick('Updating map', 2);
  const draft = importAssignCitiesText(batchId, text);
  return { ok: true, draft, costUsd: costUsd ?? null, usage };
}

export async function runShotgunGeneratePackJob(batchId, { jobId, signal } = {}) {
  const { batch, draft } = draftFor(batchId);
  const niche = nicheOf(batch, draft);
  const annotated = annotateMembersWithPipeline(niche, draft.members || []);
  const pinned = pinnedRows(niche, annotated);
  const tick = (detail, done) => updateLightJobProgress(jobId, { detail, done, total: 2 });
  tick(
    pinned.length > GENERATE_PACK_CHUNK
      ? `Calling Claude (1/${generatePackChunkCount(pinned.length)} · ${Math.min(GENERATE_PACK_CHUNK, pinned.length)} cities)…`
      : 'Calling Claude',
    1,
  );
  throwIfAborted(signal);
  const filled = await fillGeneratePackRowChunks({
    pinnedRows: pinned,
    buildPrompt: (chunkRows) => buildGeneratePackPrompt(batchId, { api: true, pinnedRows: chunkRows }),
    claudeMessagesFn: claudeMessages,
    signal,
    onChunk: ({ index, total, cities }) => {
      tick(`Calling Claude (${index}/${total} · ${cities} cities)…`, 1);
    },
  });
  if (filled.costUsd != null) {
    recordRoverApiSpend('anthropic', filled.costUsd);
    patchBatchMeta(batchId, { lastCosts: { 'shotgun-generate-pack': filled.costUsd } });
  }
  tick('Importing CSV', 2);
  const csv = rowsToCsv(filled.rows, DISCOVERY_CLAUDE_COLUMNS);
  const imported = importDiscoveryCsv(batchId, csv, { createIfMissing: false });
  applyGeneratePackRows(batchId, draft.members);
  const { dir } = draftFor(batchId);
  const next = loadShotgunDraft(dir);
  syncShotgunRosterRows(batchId, next.members);
  return {
    ok: true,
    batch: imported.batch,
    rowCount: imported.batch?.rowCount ?? 0,
    draft: next,
    costUsd: filled.costUsd ?? null,
    usage: filled.usage,
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
        citiesBand: s.bands.cities,
      });
    } catch (error) {
      rings = { error: error.message };
    }
  }
  const members = annotateMembersWithPipeline(niche, draft.members || [], draft.clusterId);
  let sgNumber = draft.sgNumber;
  if (!sgNumber && draft.clusterId) {
    const cluster = loadShotgunClusters().clusters.find((c) => c.id === draft.clusterId);
    sgNumber = cluster?.sgNumber || null;
  }
  const assigned = members.filter((m) => isPackMember(m));
  const picked = mergePickerHubs(draft.viableHubs, draft.hubs, draft.rejectedHubs);
  return {
    draft: { ...draft, members, sgNumber: sgNumber || draft.sgNumber || null },
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
      assignCities: draft.hub?.city ? buildAssignCitiesPrompt(batchId, { api: false }).prompt : '',
      generatePack: assigned.length ? buildGeneratePackPrompt(batchId, { api: false }) : '',
    },
    dir,
    batch,
  };
}

function zoneReuseShotgunDraft(planned, cluster = null) {
  const s = normalizeShotgunSettings({
    clusterMiles: cluster?.clusterMiles ?? planned.clusterMiles,
    bands: cluster?.bands || planned.bands,
  });
  const hub = cluster?.hub || planned.hub || {};
  const draft = {
    ...emptyShotgunDraft({
      shotgunNiche: cluster?.niche || planned.niche,
      clusterMiles: s.clusterMiles,
      bands: s.bands,
    }),
    niche: cluster?.niche || planned.niche,
    step: 'pack',
    hub: {
      city: hub.city,
      state: hub.state,
      population: hub.population ?? null,
      why: '',
    },
    clusterMiles: s.clusterMiles,
    innerMiles: s.clusterMiles,
    outerMiles: s.clusterMiles,
    bands: s.bands,
    members: cluster?.members || planned.members || [],
    reusedFromZoneId: planned.reusedFromZoneId || cluster?.reusedFromZoneId || null,
    source: 'zone-reuse',
  };
  if (cluster?.id) {
    draft.clusterId = cluster.id;
    draft.groupId = cluster.groupId || null;
    draft.sgNumber = cluster.sgNumber;
  }
  return draft;
}

function rememberZoneOnBatch(dir, batch, planned, cluster) {
  const hub = cluster?.hub || planned?.hub || {};
  const miles = cluster?.clusterMiles ?? planned?.clusterMiles;
  const filters = {
    ...(batch.filters || {}),
    state: hub.state || batch.filters?.state || null,
    states: hub.state ? [hub.state] : batch.filters?.states,
    cities: hub.city ? [hub.city] : batch.filters?.cities,
    shotgunNiche: cluster?.niche || planned?.niche || batch.filters?.shotgunNiche,
    innerMiles: miles ?? batch.filters?.innerMiles,
    outerMiles: miles ?? batch.filters?.outerMiles,
    shotgunBands: cluster?.bands || planned?.bands || batch.filters?.shotgunBands,
  };
  const meta = { ...batch, filters };
  writeFileSync(path.join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return meta;
}

/**
 * Copy a painted zone onto this pack: same hub and cluster keys, new niche.
 * Saves a draft only. Process batch creates the zone and assigns its number.
 * Does not call selectShotgunHub — that rebuilds members and drops the paint.
 * When this niche already has the hub, returns that zone instead of a second one.
 */
export function seedDiscoveryPackFromZone(batchId, sourceZoneId) {
  const { batch, dir } = getBatch(batchId);
  const sourceId = String(sourceZoneId || '').trim();
  const source = loadShotgunClusters().clusters.find((c) => c.id === sourceId);
  if (!source) {
    throw Object.assign(new Error('Zone not found'), { status: 404 });
  }
  const niche = nicheOf(batch, { niche: batch.filters?.shotgunNiche });
  const planned = buildZoneReuseDraft(source, niche);
  if (planned.existing) {
    const cluster = planned.cluster;
    const existingBatchId = String(cluster.batchId || '').trim();
    if (existingBatchId && existingBatchId !== batch.id) {
      try {
        getBatch(existingBatchId);
        return { existing: true, cluster, batchId: existingBatchId, discardNewBatch: true };
      } catch {
        /* the old batch folder is gone; attach this pack to that zone */
      }
    }
    const saved = upsertShotgunCluster({
      id: cluster.id,
      batchId: batch.id,
    });
    const draft = saveShotgunDraft(dir, zoneReuseShotgunDraft(planned, saved));
    rememberZoneOnBatch(dir, batch, planned, saved);
    return { existing: true, cluster: saved, draft, batchId: batch.id, discardNewBatch: false };
  }
  const draft = saveShotgunDraft(dir, zoneReuseShotgunDraft(planned));
  rememberZoneOnBatch(dir, batch, planned, null);
  return { existing: false, cluster: null, draft, batchId: batch.id, discardNewBatch: false };
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
    if (!centroidInsideZone(zone, sLive.clusterMiles)) {
      throw Object.assign(new Error('City is outside the Zone radius'), { status: 400 });
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

export function setShotgunMemberPaintMany(batchId, cities, opts = {}) {
  const { dir, draft, batch } = draftFor(batchId);
  if (!draft.hub?.city) {
    throw Object.assign(new Error('Pick a hub first'), { status: 400 });
  }
  if (String(opts.tool || 'cluster').toLowerCase() === 'hub') {
    throw Object.assign(new Error('Circle select cannot set the hub'), { status: 400 });
  }
  const slot = opts.slot;
  const s = normalizeShotgunSettings(draft);
  const liveRaw = Number(opts.radiusMiles);
  const sLive = normalizeShotgunSettings({
    ...draft,
    clusterMiles: Number.isFinite(liveRaw) ? liveRaw : s.clusterMiles,
  });
  const hubKey = placeKey(draft.hub.city, draft.hub.state);
  const clearing = !Number(slot);
  const resolved = [];
  for (const raw of cities || []) {
    const city = raw?.city;
    const state = raw?.state;
    const k = placeKey(city, state);
    if (!k || k === hubKey) continue;
    const zone = placeInZoneRadius(city, state, draft.hub.city, draft.hub.state, sLive.clusterMiles);
    const feat = zone.feat;
    const already = (draft.members || []).find((m) => placeKey(m.city, m.state) === k);
    if (!already && !clearing) {
      if (!feat) continue;
      if (!centroidInsideZone(zone, sLive.clusterMiles)) continue;
    }
    if (!already && !feat) continue;
    resolved.push({
      city: feat?.properties?.name || already?.city || city,
      state: feat?.properties?.state || already?.state || String(state || '').toUpperCase(),
      population: Number(feat?.properties?.population ?? already?.population) || null,
      miles: zone.miles,
      name: feat?.properties?.name || already?.city || city,
      featState: feat?.properties?.state || already?.state || String(state || '').toUpperCase(),
    });
  }
  const members = annotateMembersWithPipeline(
    nicheOf(batch, draft),
    applyMemberPaintMany(draft.members || [], draft.hub, {
      cities: resolved,
      slot,
      mode: 'set',
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
  const { dir, draft, batch } = draftFor(batchId);
  const s = normalizeShotgunSettings({ ...draft, clusterMiles: miles });
  const members = draft.hub?.city
    ? annotateMembersWithPipeline(
        nicheOf(batch, draft),
        pruneMembersOutsideZone(draft.hub, draft.members || [], s.clusterMiles),
      )
    : draft.members || [];
  const saved = saveShotgunDraft(dir, {
    ...draft,
    members,
    clusterMiles: s.clusterMiles,
    innerMiles: s.clusterMiles,
    outerMiles: s.clusterMiles,
  });
  if (draft.clusterId) {
    try {
      upsertShotgunCluster({
        id: draft.clusterId,
        niche: nicheOf(batch, saved),
        hub: draft.hub,
        members,
        innerMiles: s.clusterMiles,
        outerMiles: s.clusterMiles,
        clusterMiles: s.clusterMiles,
        bands: draft.bands,
        batchId,
      });
    } catch {
      /* registry sync is best-effort while still in Discovery */
    }
  }
  return saved;
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
