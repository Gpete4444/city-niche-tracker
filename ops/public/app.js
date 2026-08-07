import {
  classifyClusterVolume,
  clusterVolumeHtml,
  competitionOpennessTip,
  computeProposedScore,
  displaceabilityBand,
  displaceabilityTip,
  domainRankBand,
  esc,
  legendHtml,
  mapPackHtml,
  metricHtml,
  overallScoreHtml,
  SCORE_INPUT_TIPS,
  serpSoftnessHtml,
  setRubric,
  strengthLabelHtml,
  thWithTip,
} from './metrics.js';

const state = {
  candidates: [],
  decisionCounts: {},
  selectedId: null,
  selectedIds: new Set(),
  candidateDecisionFilter: '',
  candidateStageFilter: '',
  candidateTextFilter: '',
  candidateSort: { key: 'proposedScore', dir: -1 },
  detail: null,
  contentOpenStep: null,
  multiQueue: false,
  lastBatchJob: null,
  tab: 'overview',
  activeJobId: null,
  activeBatchJobId: null,
  activeAct: null,
  jobStatusLine: '',
  claudeBusy: false,
  pollTimer: null,
  health: null,
  dfsBalance: null,
  balanceTimer: null,
  view: 'discovery',
  discoveryPresets: null,
  discoveryBatches: [],
  discoveryBatchId: null,
  discoveryRows: [],
  discoverySelected: new Set(),
  discoverySort: { key: null, dir: 1 },
  discoveryFilters: { text: '', human: '', rec: '', mapPack: '' },
  lastDiscoveryPack: null,
};

const DISCOVERY_DECISION_OPTS = [
  '',
  'pursue',
  'maybe',
  'deprioritize',
  'pass',
  'hold',
  'review',
  'pass_unless_gbp_angle',
];

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    if (data.code) err.code = data.code;
    if (data.details) err.details = data.details;
    if (data.suburbCheck) err.suburbCheck = data.suburbCheck;
    if (data.placeholders) err.placeholders = data.placeholders;
    if (data.check) err.check = data.check;
    throw err;
  }
  return data;
}

function linkUrls(links = []) {
  return (links || [])
    .map((l) => (typeof l === 'string' ? { url: l } : l))
    .filter((l) => l?.url);
}

function tableHtml(headerHtmlOrArray, rows) {
  if (!rows.length) return '<p class="muted">No rows</p>';
  const head =
    typeof headerHtmlOrArray === 'string'
      ? headerHtmlOrArray
      : headerHtmlOrArray.map((h) => `<th>${esc(h)}</th>`).join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

function showModal({ title, bodyHtml, confirmLabel = 'Continue', danger = false }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');

    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    confirmBtn.textContent = confirmLabel;
    confirmBtn.classList.toggle('danger', danger);
    confirmBtn.classList.toggle('primary', !danger);
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');

    const close = (result) => {
      root.classList.add('hidden');
      root.setAttribute('aria-hidden', 'true');
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      root.querySelector('.modal-backdrop').onclick = null;
      resolve(result);
    };

    confirmBtn.onclick = () => close(true);
    cancelBtn.onclick = () => close(false);
    root.querySelector('.modal-backdrop').onclick = () => close(false);
  });
}

async function loadHealth() {
  state.health = await api('/api/health');
  const h = state.health;
  const hostEl = document.getElementById('settings-host');
  const dfsEl = document.getElementById('settings-dfs');
  const anthEl = document.getElementById('settings-anthropic');
  if (hostEl) {
    hostEl.textContent =
      h.host && h.port != null ? `${h.host}:${h.port}` : h.host || '127.0.0.1';
  }
  if (dfsEl) dfsEl.textContent = h.hasDataForSeo ? 'ok' : 'missing';
  if (anthEl) {
    anthEl.textContent = h.hasAnthropic
      ? `ok · ${h.model || '—'}`
      : `missing · ${h.model || '—'}`;
  }
}

function getTheme() {
  try {
    return localStorage.getItem('ops.theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  try {
    localStorage.setItem('ops.theme', next);
  } catch {
    /* ignore */
  }
  const toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.checked = next === 'dark';
  return next;
}

function closeSettingsMenu() {
  const menu = document.getElementById('settings-menu');
  const btn = document.getElementById('settings-btn');
  if (menu) menu.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function wireSettingsUi() {
  const btn = document.getElementById('settings-btn');
  const menu = document.getElementById('settings-menu');
  const toggle = document.getElementById('theme-toggle');
  if (!btn || !menu) return;

  applyTheme(getTheme());

  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = menu.classList.contains('hidden');
    if (open) {
      menu.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
    } else {
      closeSettingsMenu();
    }
  });

  menu.addEventListener('click', (event) => event.stopPropagation());

  document.addEventListener('click', () => closeSettingsMenu());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSettingsMenu();
  });

  toggle?.addEventListener('change', () => {
    applyTheme(toggle.checked ? 'dark' : 'light');
  });
}

function formatMoney(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const num = Number(n);
  const d = num < 0.1 && num > 0 ? 4 : digits;
  return `$${num.toFixed(d)}`;
}

/** DataForSEO stage costs that sum to the Overview API cost total. */
function dfsCostBreakdown(detail) {
  const research = detail?.research;
  const metaLc = detail?.meta?.lastCosts || {};
  const cumResearch = Number(research?.estimatedApiCostUsd);
  const enrichFromJson = Number(research?.enrichment?.estimatedApiCostUsd);
  const prospectsFromJson = Number(detail?.prospects?.estimatedApiCostUsd);

  let enrich =
    Number.isFinite(enrichFromJson) && enrichFromJson > 0
      ? enrichFromJson
      : Number.isFinite(Number(metaLc.enrich))
        ? Number(metaLc.enrich)
        : null;

  let prospects =
    Number.isFinite(prospectsFromJson) && prospectsFromJson > 0
      ? prospectsFromJson
      : Number.isFinite(Number(metaLc.prospects))
        ? Number(metaLc.prospects)
        : null;

  let researchOnly = null;
  if (Number.isFinite(cumResearch)) {
    researchOnly =
      enrich != null ? Math.max(0, Number((cumResearch - enrich).toFixed(6))) : cumResearch;
  } else if (Number.isFinite(Number(metaLc.research))) {
    researchOnly = Number(metaLc.research);
  }

  const parts = [];
  if (researchOnly != null && researchOnly > 0) {
    parts.push({ key: 'Research', value: researchOnly });
  }
  if (enrich != null && enrich > 0) {
    parts.push({ key: 'Enrich', value: enrich });
  }
  if (prospects != null && prospects > 0) {
    parts.push({ key: 'Prospects', value: prospects });
  }

  const total =
    parts.length > 0
      ? Number(parts.reduce((sum, p) => sum + p.value, 0).toFixed(6))
      : Number.isFinite(cumResearch)
        ? cumResearch
        : null;

  let notes = 'Run Stage 1+';
  if (total != null) {
    if (parts.length >= 2) {
      notes = `${parts.map((p) => `${p.key} ${formatMoney(p.value)}`).join(' · ')} = ${formatMoney(total)}`;
    } else if (parts.length === 1) {
      notes = `${parts[0].key} ${formatMoney(parts[0].value)} = ${formatMoney(total)}`;
    } else {
      notes = `Recorded DataForSEO spend ${formatMoney(total)}`;
    }
  }

  return {
    research: researchOnly,
    enrich,
    prospects,
    total,
    notes,
  };
}

function renderDfsBalance() {
  const el = document.getElementById('dfs-balance');
  if (!el) return;
  const b = state.dfsBalance;
  el.classList.remove('ok', 'warn', 'err', 'muted');
  if (!b) {
    el.classList.add('muted');
    el.textContent = 'DFS …';
    el.title = 'Loading DataForSEO balance';
    return;
  }
  if (!b.ok || b.balance == null) {
    el.classList.add('err');
    el.textContent = 'DFS balance —';
    el.title = b.error || 'Could not load DataForSEO balance';
    return;
  }
  const bal = Number(b.balance);
  el.classList.add(bal < 1 ? 'warn' : 'ok');
  el.textContent = `DFS ${formatMoney(bal)}`;
  el.title = `DataForSEO balance ${formatMoney(bal)} · updated ${b.fetchedAt || ''}`;
}

async function loadDfsBalance() {
  try {
    state.dfsBalance = await api('/api/dfs-balance');
  } catch (error) {
    state.dfsBalance = {
      ok: false,
      balance: null,
      error: error.message,
      fetchedAt: new Date().toISOString(),
    };
  }
  renderDfsBalance();
}

function startBalancePolling() {
  if (state.balanceTimer) clearInterval(state.balanceTimer);
  state.balanceTimer = setInterval(() => {
    loadDfsBalance().catch(() => {});
  }, 60_000);
}

async function confirmPaidAction(act) {
  const id = state.selectedId;
  const preview = await api(
    `/api/candidates/${encodeURIComponent(id)}/cost-preview?act=${encodeURIComponent(act)}`,
  );
  if (preview.error) {
    await showModal({
      title: preview.title || 'Cannot run',
      confirmLabel: 'OK',
      bodyHtml: `<p>${esc(preview.error)}</p>`,
    });
    return false;
  }

  const balanceLine =
    preview.provider === 'dataforseo' && state.dfsBalance?.balance != null
      ? `<p><strong>Your DataForSEO balance:</strong> ${esc(formatMoney(state.dfsBalance.balance))}</p>`
      : preview.provider === 'dataforseo'
        ? `<p class="muted">DataForSEO balance unavailable${
            state.dfsBalance?.error ? `: ${esc(state.dfsBalance.error)}` : ''
          }</p>`
        : '';

  const adsNote =
    act === 'research'
      ? `<p><strong>Ads volumes:</strong> ${
          getAdsMode() === 'standard'
            ? 'Standard queue (~$0.05–0.06/task, slower — good overnight)'
            : 'Live (~$0.075–0.09/task, seconds)'
        }. Change beside Run research.</p>`
      : '';

  const bodyHtml = `
    <p>${esc(preview.whatItDoes)}</p>
    <p><strong>Estimated cost:</strong> ${esc(preview.estimateLabel)}</p>
    <p class="muted">${esc(preview.estimateDetail || '')}</p>
    ${adsNote}
    ${balanceLine}
    ${
      preview.overwriteNote
        ? `<p class="callout"><strong>Already ran:</strong> ${esc(preview.overwriteNote)}</p>`
        : ''
    }
    ${
      preview.provider === 'anthropic'
        ? `<ul>
            <li>Model: <code>${esc(preview.model || state.health?.model || '')}</code></li>
            <li>Uses paid API tokens</li>
            ${act === 'narrative' ? '<li>Result is a <strong>draft only</strong> until you click Accept</li>' : ''}
          </ul>`
        : '<p class="muted">Charged to your DataForSEO account when the job runs.</p>'
    }
    ${preview.freeFallback ? `<p class="muted">${esc(preview.freeFallback)}</p>` : ''}
  `;

  return showModal({
    title: preview.title,
    confirmLabel: preview.confirmLabel || 'Run',
    bodyHtml,
  });
}

async function showActualCostModal({ title, costUsd, costNote, provider }) {
  const label =
    provider === 'anthropic' || provider === 'anthropic-estimate'
      ? 'Claude (token estimate)'
      : 'DataForSEO';
  await showModal({
    title: title || 'Run complete',
    confirmLabel: 'OK',
    bodyHtml: `
      <p><strong>This run:</strong> ${
        costUsd != null ? esc(formatMoney(costUsd)) : '—'
      } <span class="muted">(${esc(label)})</span></p>
      ${costNote ? `<p class="muted">${esc(costNote)}</p>` : ''}
    `,
  });
}

async function loadRubric() {
  try {
    const data = await api('/api/rubric');
    setRubric(data);
  } catch {
    /* metrics.js fallback bands */
  }
}

async function loadCandidates() {
  const data = await api('/api/candidates');
  state.candidates = data.candidates || [];
  state.decisionCounts = data.decisionCounts || {};
  refreshDecisionFilterCounts();
  renderList();
}

function refreshDecisionFilterCounts() {
  const sel = document.getElementById('candidate-decision-filter');
  if (!sel) return;
  const counts = state.decisionCounts || {};
  const labels = {
    '': `Decision: all (${counts.__all ?? state.candidates.length})`,
    __undecided: `undecided (${counts.__undecided ?? 0})`,
    pursue: `pursue (${counts.pursue ?? 0})`,
    maybe: `maybe (${counts.maybe ?? 0})`,
    review: `review (${counts.review ?? 0})`,
    hold: `hold (${counts.hold ?? 0})`,
    deprioritize: `deprioritize (${counts.deprioritize ?? 0})`,
    pass: `pass (${counts.pass ?? 0})`,
    pass_unless_gbp_angle: `pass_unless_gbp_angle (${counts.pass_unless_gbp_angle ?? 0})`,
  };
  for (const opt of sel.options) {
    if (labels[opt.value] != null) opt.textContent = labels[opt.value];
  }
}

function filteredCandidates() {
  const f = state.candidateDecisionFilter;
  const stageF = state.candidateStageFilter;
  const text = String(state.candidateTextFilter || '')
    .trim()
    .toLowerCase();
  return state.candidates.filter((c) => {
    if (f === '__undecided') {
      if (c.decision) return false;
    } else if (f && c.decision !== f) {
      return false;
    }
    if (stageF && c.stage !== stageF) return false;
    if (text) {
      const hay = [c.id, c.niche, c.primaryCity, c.state, c.source?.batchId]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}

function sortCandidates(list) {
  const { key, dir } = state.candidateSort || { key: 'proposedScore', dir: -1 };
  const sorted = [...list];
  sorted.sort((a, b) => {
    const av = candidateSortValue(a, key);
    const bv = candidateSortValue(b, key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * dir;
  });
  return sorted;
}

function selectedCandidateIds() {
  const multi = [...state.selectedIds];
  if (multi.length) return multi;
  return state.selectedId ? [state.selectedId] : [];
}

function aggregateSelectedFlags() {
  const ids = new Set(selectedCandidateIds());
  const totals = {
    count: ids.size,
    hasResearch: 0,
    hasEnrichment: 0,
    hasNarrativeDraft: 0,
    hasNarrative: 0,
    hasProspects: 0,
  };
  for (const c of state.candidates) {
    if (!ids.has(c.id)) continue;
    const f = c.stageFlags || {};
    if (f.hasResearch) totals.hasResearch += 1;
    if (f.hasEnrichment) totals.hasEnrichment += 1;
    if (f.hasNarrativeDraft) totals.hasNarrativeDraft += 1;
    if (f.hasNarrative) totals.hasNarrative += 1;
    if (f.hasProspects) totals.hasProspects += 1;
  }
  return totals;
}

function candidateOverallInputs(c) {
  const inputs = c.scoreInputs || {};
  return {
    demand: inputs.demand ?? null,
    competition: inputs.competition ?? null,
    jobValue: inputs.jobValue ?? null,
    mapPackGap: inputs.mapPackGap ?? null,
    displaceability: c.displaceability ?? inputs.displaceability ?? null,
  };
}

function candidateSortValue(c, key) {
  if (key === 'proposedScore') {
    return (
      computeProposedScore(candidateOverallInputs(c)) ??
      c.proposedScore ??
      null
    );
  }
  if (key === 'city') return [c.primaryCity, c.state].filter(Boolean).join(', ');
  if (key === 'volume') return c.clusterVolumeSum;
  if (key === 'jobCost') return c.jobCostText || '';
  if (key === 'orgHome') return c.organicHomeNicheCount ?? c.organicHomeCount;
  if (key === 'orgSub') return c.organicSubNicheCount ?? c.organicSubCount;
  if (key === 'avgCpc') return c.averageCpc;
  if (key === 'lsa') return c.hasLocalServicesAds ? 1 : 0;
  if (key === 'mpReviews') return c.mapPackAvgReviews;
  if (key === 'competition') return c.scoreInputs?.competition ?? null;
  if (key === 'demand') return c.scoreInputs?.demand ?? null;
  if (key === 'jobValue') return c.scoreInputs?.jobValue ?? null;
  if (key === 'serpSoftness') return c.serpSoftness || '';
  if (key === 'population') return c.population;
  if (key === 'mapPack') {
    if (c.mapPackPresent == null) return null;
    if (!c.mapPackPresent) return 0;
    const counts = c.mapPackReviewCounts || [];
    const nums = counts.map(Number).filter((n) => Number.isFinite(n));
    return nums.length ? Math.max(...nums) : 1;
  }
  if (key === 'disp') return c.displaceability;
  if (key === 'prospects') return c.prospectCount;
  if (key === 'batch') return c.source?.batchId || '';
  if (key === 'notes') return c.decisionNotes || '';
  return c[key];
}

const CANDIDATE_DECISION_OPTS = [
  '',
  'pursue',
  'maybe',
  'review',
  'hold',
  'deprioritize',
  'pass',
  'pass_unless_gbp_angle',
];

const CANDIDATE_TABLE_COLS = [
  {
    key: '_select',
    label: '',
    tip: 'Select rows for stage runs',
    cellClass: 'col-narrow',
  },
  {
    key: 'niche',
    label: 'Niche',
    tip: 'Service niche',
    sortable: true,
    cellClass: 'col-truncate',
    source: 'claude',
  },
  {
    key: 'city',
    label: 'City',
    tip: 'Primary city',
    sortable: true,
    cellClass: 'col-truncate',
    source: 'claude',
  },
  {
    key: 'state',
    label: 'State',
    tip: 'Two-letter US state',
    sortable: true,
    cellClass: 'col-short',
    source: 'claude',
  },
  {
    key: 'population',
    label: 'Population',
    tip: 'US Census place population when available',
    sortable: true,
    cellClass: 'col-short',
    source: 'census',
  },
  {
    key: 'mapPack',
    label: 'Map Pack',
    tip: 'Map Pack present (Yes/No). When Yes, shows review counts per pack slot (e.g. 78/14/235). LSA if Local Services Ads detected.',
    sortable: true,
    cellClass: 'col-mappack',
    source: 'dfs',
  },
  {
    key: 'volume',
    label: 'Est. Volume',
    tip: 'Cluster search volume / month across geos. Higher = more demand.',
    sortable: true,
    cellClass: 'col-truncate',
    source: 'gemini',
  },
  {
    key: 'jobCost',
    label: 'Job Cost',
    tip: 'Average job value / ticket size from research or narrative',
    sortable: true,
    cellClass: 'col-truncate',
    source: 'claude',
  },
  {
    key: 'orgHome',
    label: 'Org Home',
    tip: 'Niche-relevant / all organic homepages (title+URL token match). Directories excluded.',
    sortable: true,
    cellClass: 'col-short',
    source: 'dfs',
  },
  {
    key: 'orgSub',
    label: 'Org Sub',
    tip: 'Niche-relevant / all organic subpages (title+URL token match). Directories excluded.',
    sortable: true,
    cellClass: 'col-short',
    source: 'dfs',
  },
  {
    key: 'avgCpc',
    label: 'CPC',
    tip: 'Average CPC from Stage 1 Ads keywords (monetization signal). Blank until research.',
    sortable: true,
    cellClass: 'col-short',
    source: 'dfs',
  },
  {
    key: 'proposedScore',
    label: 'Score',
    tip: 'Overall 1–10. Provisional (*) until job value is set. Higher = better.',
    sortable: true,
    cellClass: 'col-score-metric',
    source: 'ops',
  },
  {
    key: 'demand',
    label: 'Demand',
    tip: 'Demand score 1–10 from cluster search volume band',
    sortable: true,
    cellClass: 'col-score-metric',
    source: 'ops',
  },
  {
    key: 'competition',
    label: 'Open.',
    tip: 'Organic openness 1–10. Higher = more open / better for you.',
    sortable: true,
    cellClass: 'col-score-metric',
    source: 'ops',
  },
  {
    key: 'disp',
    label: 'Disp.',
    tip: 'Stage 2 — Displaceability 1–10. Higher = easier to outrank.',
    sortable: true,
    cellClass: 'col-score-metric',
    source: 'ops',
  },
  {
    key: 'jobValue',
    label: 'Job Val.',
    tip: 'Job value score 1–10 from accepted narrative ticket size',
    sortable: true,
    cellClass: 'col-score-metric',
    source: 'ops',
  },
  {
    key: 'serpSoftness',
    label: 'Softness',
    tip: 'SERP softness label: soft / mixed / hard',
    sortable: true,
    cellClass: 'col-score-metric',
    source: 'ops',
  },
  {
    key: 'decision',
    label: 'Decision',
    tip: 'Decision group — autosaves on change',
    sortable: true,
    cellClass: 'col-human',
    source: 'ops',
  },
  {
    key: 'stage',
    label: 'Stage',
    tip: 'Pipeline progress',
    sortable: true,
    cellClass: 'col-short',
    source: 'ops',
  },
  {
    key: 'prospects',
    label: 'Prospects',
    tip: 'Stage 4 — Prospect count (high priority in tip)',
    sortable: true,
    cellClass: 'col-short',
    source: 'ops',
  },
  {
    key: 'batch',
    label: 'Batch',
    tip: 'Source discovery batch id',
    sortable: true,
    cellClass: 'col-batch',
    source: 'ops',
  },
  {
    key: 'notes',
    label: 'Notes',
    tip: 'Decision notes',
    sortable: false,
    cellClass: 'col-notes',
    source: 'ops',
  },
];

function updateCandidateSelectionCount() {
  const el = document.getElementById('candidate-selection-count');
  if (el) el.textContent = `${state.selectedIds.size} selected`;
  const countEl = document.getElementById('candidate-filter-count');
  if (countEl) {
    const n = filteredCandidates().length;
    countEl.textContent = `Showing ${n} / ${state.candidates.length}`;
  }
  const batchSel = document.getElementById('candidate-batch-decision');
  const batchBtn = document.getElementById('candidate-batch-decision-btn');
  const disable = state.selectedIds.size === 0;
  if (batchSel) batchSel.disabled = disable;
  if (batchBtn) batchBtn.disabled = disable;
}

function emptyStateForFilter() {
  const f = state.candidateDecisionFilter;
  if (!state.candidates.length) {
    return 'No candidates yet — Process a discovery batch (all decisions land in groups here).';
  }
  if (f === 'pursue') return 'No pursue yet — Process a discovery batch and Accept pursue rows.';
  if (f === 'pass' || f === 'deprioritize' || f === 'pass_unless_gbp_angle') {
    return `No ${f} candidates — archive groups fill when you Process discovery rows with that decision.`;
  }
  if (f === '__undecided') return 'No undecided candidates.';
  if (state.candidateStageFilter) {
    return `No candidates in stage “${state.candidateStageFilter}” for this filter.`;
  }
  if (state.candidateTextFilter) return 'No candidates match this search.';
  if (f) return `No candidates in the “${f}” decision group.`;
  return 'No candidates match these filters.';
}

function syncCandidatesDetailVisibility() {
  const empty = document.getElementById('empty-detail');
  const detail = document.getElementById('detail');
  if (!empty || !detail) return;
  if (state.selectedIds.size > 1) {
    empty.classList.add('hidden');
    detail.classList.remove('hidden');
    return;
  }
  if (state.selectedId && state.detail) {
    empty.classList.add('hidden');
    detail.classList.remove('hidden');
    return;
  }
  empty.classList.remove('hidden');
  detail.classList.add('hidden');
  empty.textContent =
    state.selectedIds.size === 0 && !state.selectedId
      ? 'Select rows to run stages · click a row to open detail'
      : 'Loading…';
}

async function persistCandidateDecision(id, decision, notes) {
  try {
    const row = state.candidates.find((c) => c.id === id);
    const body = {
      decision: decision || null,
      notes:
        notes !== undefined
          ? notes || null
          : row?.decisionNotes ?? null,
    };
    await api(`/api/candidates/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (row) {
      row.decision = decision || null;
      if (notes !== undefined) row.decisionNotes = notes || null;
    }
    if (state.detail?.id === id) {
      state.detail = await api(`/api/candidates/${encodeURIComponent(id)}`);
    }
    const data = await api('/api/candidates');
    state.candidates = data.candidates || [];
    state.decisionCounts = data.decisionCounts || {};
    refreshDecisionFilterCounts();
    renderList();
    if (state.selectedIds.size > 1) renderMultiDetail();
    else if (state.selectedId === id && state.detail) renderDetail();
    else renderActions();
  } catch (error) {
    await showModal({
      title: 'Save failed',
      confirmLabel: 'OK',
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
    await loadCandidates();
  }
}

function renderList() {
  const thead = document.querySelector('#candidate-table thead');
  const tbody = document.querySelector('#candidate-table tbody');
  if (!thead || !tbody) return;
  renderSourceLegend('candidate-source-legend');
  const sort = state.candidateSort;
  thead.innerHTML = `<tr>${CANDIDATE_TABLE_COLS.map((c) => {
    if (c.key === '_select') {
      return `<th title="${esc(c.tip || '')}"><input type="checkbox" id="candidate-select-all" title="Select filtered" /></th>`;
    }
    const mark = sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
    const cls = [c.sortable ? 'sortable' : '', c.cellClass || ''].filter(Boolean).join(' ');
    const srcTip =
      c.source && DISCOVERY_SOURCES[c.source] ? DISCOVERY_SOURCES[c.source].tip : '';
    const fullTip = [c.tip || c.label, srcTip].filter(Boolean).join(' · ');
    return `<th class="${cls}" data-sort="${esc(c.key)}" title="${esc(fullTip)}"><span class="th-label">${discoverySourceDot(
      c.source,
    )}${esc(c.label)}</span>${mark}</th>`;
  }).join('')}</tr>`;

  const list = sortCandidates(filteredCandidates());
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="${CANDIDATE_TABLE_COLS.length}" class="muted">${esc(
      emptyStateForFilter(),
    )}</td></tr>`;
    updateCandidateSelectionCount();
    renderActions();
    return;
  }

  tbody.innerHTML = list
    .map((c) => {
      const active = c.id === state.selectedId ? 'active' : '';
      const checked = state.selectedIds.has(c.id) ? 'checked' : '';
      const overallInputs = candidateOverallInputs(c);
      const overall =
        computeProposedScore(overallInputs) ?? c.proposedScore ?? null;
      const cells = CANDIDATE_TABLE_COLS.map((col) => {
        const tdClass = col.cellClass ? ` class="${esc(col.cellClass)}"` : '';
        if (col.key === '_select') {
          return `<td${tdClass}><input type="checkbox" class="cand-check" data-id="${esc(
            c.id,
          )}" ${checked} /></td>`;
        }
        if (col.key === 'niche') {
          return `<td${tdClass} title="${esc(c.id)}"><span class="cell-text">${esc(
            c.niche || '—',
          )}</span></td>`;
        }
        if (col.key === 'city') {
          return `<td${tdClass}><span class="cell-text">${esc(c.primaryCity || '—')}</span></td>`;
        }
        if (col.key === 'state') {
          return `<td${tdClass}><span class="cell-text">${esc(c.state || '—')}</span></td>`;
        }
        if (col.key === 'population') {
          return `<td${tdClass}>${
            c.population == null ? '—' : esc(String(c.population))
          }</td>`;
        }
        if (col.key === 'mapPack') {
          return `<td${tdClass}>${mapPackHtml(c.mapPackPresent, {
            reviewsLabel: c.mapPackReviewsLabel,
            avgReviews: c.mapPackAvgReviews,
            maxReviews: c.mapPackMaxReviews,
            hasLsa: c.hasLocalServicesAds,
          })}</td>`;
        }
        if (col.key === 'volume') {
          return `<td${tdClass}>${clusterVolumeHtml(c.clusterVolumeSum)}</td>`;
        }
        if (col.key === 'jobCost') {
          return `<td${tdClass}><span class="cell-text">${esc(
            c.jobCostText || '—',
          )}</span></td>`;
        }
        if (col.key === 'orgHome') {
          const all = c.organicHomeCount;
          const niche = c.organicHomeNicheCount;
          if (all == null && niche == null) return `<td${tdClass}>—</td>`;
          const label =
            niche != null && all != null ? `${niche}/${all}` : esc(String(niche ?? all));
          const tip =
            niche != null && all != null
              ? `${niche} niche-relevant of ${all} organic homepages (title+URL)`
              : 'Organic homepage count';
          return `<td${tdClass} title="${esc(tip)}">${label}</td>`;
        }
        if (col.key === 'orgSub') {
          const all = c.organicSubCount;
          const niche = c.organicSubNicheCount;
          if (all == null && niche == null) return `<td${tdClass}>—</td>`;
          const label =
            niche != null && all != null ? `${niche}/${all}` : esc(String(niche ?? all));
          const tip =
            niche != null && all != null
              ? `${niche} niche-relevant of ${all} organic subpages (title+URL)`
              : 'Organic subpage count';
          return `<td${tdClass} title="${esc(tip)}">${label}</td>`;
        }
        if (col.key === 'avgCpc') {
          if (c.averageCpc == null) return `<td${tdClass}>—</td>`;
          return `<td${tdClass}>$${esc(String(c.averageCpc))}</td>`;
        }
        if (col.key === 'proposedScore') {
          return `<td${tdClass}>${overallScoreHtml(overallInputs, overall, {
            compact: true,
          })}</td>`;
        }
        if (col.key === 'demand') {
          const v = overallInputs.demand;
          return `<td${tdClass}>${
            v == null
              ? '—'
              : metricHtml({
                  value: v,
                  max: 10,
                  polarity: 'higher-better',
                  label: 'Demand',
                  extraTip: SCORE_INPUT_TIPS.demand,
                })
          }</td>`;
        }
        if (col.key === 'competition') {
          const v = overallInputs.competition;
          return `<td${tdClass}>${
            v == null
              ? '—'
              : metricHtml({
                  value: v,
                  max: 10,
                  polarity: 'higher-better',
                  label: 'Organic openness',
                  extraTip: competitionOpennessTip({
                    score: v,
                    uniqueDomainCount: c.uniqueOrganicDomains,
                    homepageCount: c.organicHomeCount,
                    medianDomainRank: c.medianDomainRank,
                  }),
                })
          }</td>`;
        }
        if (col.key === 'disp') {
          const disp = overallInputs.displaceability;
          if (disp == null) return `<td${tdClass}>—</td>`;
          const dispBand = displaceabilityBand(disp);
          return `<td${tdClass}>${metricHtml({
            value: disp,
            max: 10,
            polarity: 'higher-better',
            label: 'Displaceability',
            extraTip: dispBand ? `${dispBand.label} (${dispBand.range || ''})` : '',
          })}</td>`;
        }
        if (col.key === 'jobValue') {
          const v = overallInputs.jobValue;
          return `<td${tdClass}>${
            v == null
              ? '—'
              : metricHtml({
                  value: v,
                  max: 10,
                  polarity: 'higher-better',
                  label: 'Job value',
                  extraTip: SCORE_INPUT_TIPS.jobValue,
                })
          }</td>`;
        }
        if (col.key === 'serpSoftness') {
          return `<td${tdClass}>${serpSoftnessHtml(c.serpSoftness)}</td>`;
        }
        if (col.key === 'decision') {
          return `<td${tdClass}><select class="cand-decision" data-id="${esc(c.id)}">${CANDIDATE_DECISION_OPTS.map(
            (o) =>
              `<option value="${esc(o)}" ${
                (c.decision || '') === o ? 'selected' : ''
              }>${esc(o || '—')}</option>`,
          ).join('')}</select></td>`;
        }
        if (col.key === 'stage') return `<td${tdClass}>${esc(c.stage || '—')}</td>`;
        if (col.key === 'prospects') {
          if (c.prospectCount == null) return `<td${tdClass}>—</td>`;
          const tip =
            c.highPriority != null ? `${c.highPriority} high priority` : 'Stage 4 prospects';
          return `<td${tdClass} title="${esc(tip)}">${esc(String(c.prospectCount))}${
            c.highPriority != null
              ? ` <span class="muted">(${esc(String(c.highPriority))}↑)</span>`
              : ''
          }</td>`;
        }
        if (col.key === 'batch') {
          const bid = c.source?.batchId || '';
          return `<td${tdClass} title="${esc(bid)}"><span class="cell-text">${esc(
            bid || '—',
          )}</span></td>`;
        }
        if (col.key === 'notes') {
          const notes = c.decisionNotes || '';
          return `<td${tdClass}><input class="cand-notes" data-id="${esc(
            c.id,
          )}" title="${esc(notes)}" value="${esc(notes)}" /></td>`;
        }
        return `<td${tdClass}>—</td>`;
      });
      return `<tr class="${active}" data-id="${esc(c.id)}">${cells.join('')}</tr>`;
    })
    .join('');

  document.getElementById('candidate-select-all')?.addEventListener('change', (e) => {
    const on = e.target.checked;
    for (const c of list) {
      if (on) state.selectedIds.add(c.id);
      else state.selectedIds.delete(c.id);
    }
    updateCandidateSelectionCount();
    renderList();
    renderActions();
    if (state.selectedIds.size > 1) renderMultiDetail();
    else syncCandidatesDetailVisibility();
  });
  thead.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.candidateSort.key === key) state.candidateSort.dir *= -1;
      else state.candidateSort = { key, dir: key === 'proposedScore' ? -1 : 1 };
      renderList();
    });
  });
  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('input.cand-check, select.cand-decision, input.cand-notes')) return;
      selectCandidate(tr.dataset.id);
    });
  });
  tbody.querySelectorAll('.cand-check').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      const id = cb.dataset.id;
      if (cb.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      updateCandidateSelectionCount();
      renderActions();
      if (state.selectedIds.size > 1) renderMultiDetail();
      else if (state.selectedId) renderDetail();
      else syncCandidatesDetailVisibility();
    });
  });
  tbody.querySelectorAll('select.cand-decision').forEach((sel) => {
    sel.addEventListener('click', (e) => e.stopPropagation());
    sel.addEventListener('change', (e) => {
      e.stopPropagation();
      void persistCandidateDecision(sel.dataset.id, sel.value);
    });
  });
  tbody.querySelectorAll('input.cand-notes').forEach((inp) => {
    inp.addEventListener('click', (e) => e.stopPropagation());
    inp.addEventListener('blur', () => {
      const row = state.candidates.find((x) => x.id === inp.dataset.id);
      const next = inp.value;
      if ((row?.decisionNotes || '') === next) return;
      void persistCandidateDecision(inp.dataset.id, row?.decision || '', next);
    });
  });
  updateCandidateSelectionCount();
  renderActions();
}

async function selectCandidate(id) {
  state.selectedId = id;
  state.multiQueue = false;
  state.contentOpenStep = null;
  if (state.selectedIds.size > 1) {
    renderList();
    renderMultiDetail();
    renderActions();
    return;
  }
  if (state.selectedIds.size === 0) state.selectedIds.add(id);
  renderList();
  syncCandidatesDetailVisibility();
  document.getElementById('empty-detail').classList.add('hidden');
  document.getElementById('detail').classList.remove('hidden');
  state.detail = await api(`/api/candidates/${encodeURIComponent(id)}`);
  renderDetail();
}

function renderMultiDetail() {
  const ids = [...state.selectedIds];
  if (ids.length <= 1) {
    state.multiQueue = false;
    if (state.selectedId) renderDetail();
    return;
  }
  state.multiQueue = true;
  document.getElementById('empty-detail').classList.add('hidden');
  document.getElementById('detail').classList.remove('hidden');
  document.getElementById('detail-title').textContent = `${ids.length} candidates selected`;
  document.getElementById('detail-sub').textContent =
    'Stage rail runs on the full selection · click a row to focus one candidate';
  document.getElementById('stage-chip').textContent = 'multi';
  renderActions();
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === 'overview');
  });
  const byId = new Map(state.candidates.map((c) => [c.id, c]));
  const batchKids = state.lastBatchJob?.children || [];
  const jobById = new Map(batchKids.map((c) => [c.candidateId, c]));
  const rows = ids
    .map((id) => {
      const c = byId.get(id) || { id };
      const job = jobById.get(id);
      const jobCell = job
        ? `${esc(job.status)}${job.error ? ` · ${esc(job.error)}` : ''}`
        : '—';
      return `<tr data-focus-id="${esc(id)}">
        <td>${esc(id)}</td>
        <td>${esc(c.niche || '')}</td>
        <td>${esc([c.primaryCity, c.state].filter(Boolean).join(', '))}</td>
        <td>${esc(c.stage || '')}</td>
        <td>${esc(c.decision || '—')}</td>
        <td>${jobCell}</td>
      </tr>`;
    })
    .join('');
  document.getElementById('tab-panels').innerHTML = `
    <div class="multi-queue">
      <p class="muted">Queue for batch stages. Focus a row for Narrative Accept / single detail.</p>
      <table>
        <thead><tr><th>ID</th><th>Niche</th><th>City</th><th>Stage</th><th>Decision</th><th>Last batch</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  document.querySelectorAll('[data-focus-id]').forEach((tr) => {
    tr.addEventListener('click', () => selectCandidate(tr.dataset.focusId));
  });
}

function stageCheckMark() {
  return '<span class="stage-check" title="Completed" aria-label="Completed">✓</span>';
}

function stageDraftMark() {
  return '<span class="stage-draft" title="Draft present (not accepted yet)">draft</span>';
}

function updateTabCompletion() {
  const f = state.detail?.stageFlags || {};
  const labels = {
    overview: 'Overview',
    serp: 'SERP',
    keywords: 'Keywords',
    enrichment: 'Enrichment',
    narrative: '3 · Narrative',
    'site-config': 'Site config',
    content: 'Content',
    prospects: '4 · Prospects',
    logs: 'Logs',
  };
  document.querySelectorAll('.tab').forEach((tab) => {
    const key = tab.dataset.tab;
    const base = labels[key] || tab.textContent.replace(/[✓·].*$/, '').trim();
    let done = false;
    let draft = false;
    if (key === 'serp' || key === 'keywords') done = Boolean(f.hasResearch);
    if (key === 'enrichment') done = Boolean(f.hasEnrichment);
    if (key === 'narrative') {
      done = Boolean(f.hasNarrative);
      draft = Boolean(f.hasNarrativeDraft) && !f.hasNarrative;
    }
    if (key === 'site-config') {
      done = Boolean(f.hasSiteConfig);
      draft = Boolean(f.hasSiteConfigDraft) && !f.hasSiteConfig;
    }
    if (key === 'content') {
      done = Boolean(f.hasContent);
      draft = Boolean(f.hasContentDraft) && !f.hasContent;
    }
    if (key === 'prospects') done = Boolean(f.hasProspects);
    tab.classList.toggle('tab-done', done);
    tab.classList.toggle('tab-draft', draft);
    tab.innerHTML = done
      ? `${esc(base)} ${stageCheckMark()}`
      : draft
        ? `${esc(base)} ${stageDraftMark()}`
        : esc(base);
    tab.classList.toggle('active', key === state.tab);
  });
}

function getAdsMode() {
  try {
    const v = localStorage.getItem('ops.adsMode');
    return v === 'standard' ? 'standard' : 'live';
  } catch {
    return 'live';
  }
}

function setAdsMode(mode) {
  const next = mode === 'standard' ? 'standard' : 'live';
  try {
    localStorage.setItem('ops.adsMode', next);
  } catch {
    /* ignore */
  }
  return next;
}

function getResearchMode() {
  try {
    const v = localStorage.getItem('ops.researchMode');
    if (v === 'force_serp' || v === 'volumes_only') return v;
    return 'default';
  } catch {
    return 'default';
  }
}

function setResearchMode(mode) {
  const next =
    mode === 'force_serp' || mode === 'volumes_only' ? mode : 'default';
  try {
    localStorage.setItem('ops.researchMode', next);
  } catch {
    /* ignore */
  }
  return next;
}

function researchOptsFromMode(mode = getResearchMode()) {
  return {
    forceSerp: mode === 'force_serp',
    volumesOnly: mode === 'volumes_only',
  };
}

function adsModeSelectHtml(disabled = false) {
  const mode = getAdsMode();
  return `<select id="ads-mode-select" class="ads-mode-select" title="Live ≈ $0.075–0.09/Ads task · Standard queue ≈ $0.05–0.06 (slower, overnight OK)" ${
    disabled ? 'disabled' : ''
  }>
    <option value="live"${mode === 'live' ? ' selected' : ''}>Live</option>
    <option value="standard"${mode === 'standard' ? ' selected' : ''}>Standard</option>
  </select>`;
}

function researchModeSelectHtml(disabled = false) {
  const mode = getResearchMode();
  return `<select id="research-mode-select" class="research-mode-select" title="Default reuses Discovery SERP cache when fresh. Volumes-only refreshes Ads from existing research SERP. Force SERP refetches Map Pack/organic." ${
    disabled ? 'disabled' : ''
  }>
    <option value="default"${mode === 'default' ? ' selected' : ''}>Reuse SERP</option>
    <option value="volumes_only"${mode === 'volumes_only' ? ' selected' : ''}>Volumes only</option>
    <option value="force_serp"${mode === 'force_serp' ? ' selected' : ''}>Force SERP</option>
  </select>`;
}

function jobActLabel(act) {
  return (
    {
      research: 'Stage 1 research',
      enrich: 'Stage 2 enrich',
      narrative: 'Stage 3 narrative',
      prospects: 'Stage 4 prospects',
      outreach: 'Claude outreach',
    }[act] || act || 'job'
  );
}

function latestProgressLine(logText) {
  const lines = String(logText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (
      /Maps SERP:|Paid ads|cost this run|SERP via|Enrich|keywords|backlinks|prospect/i.test(
        line,
      )
    ) {
      return line.length > 140 ? `${line.slice(0, 137)}…` : line;
    }
  }
  const last = lines[lines.length - 1];
  if (!last) return '';
  return last.length > 140 ? `${last.slice(0, 137)}…` : last;
}

function updateJobProgressDetail(text) {
  state.jobStatusLine = text || '';
  const el = document.getElementById('job-progress-detail');
  if (el) el.textContent = state.jobStatusLine || 'Working…';
}

function clearJobBusy() {
  state.activeJobId = null;
  state.activeBatchJobId = null;
  state.activeAct = null;
  state.jobStatusLine = '';
  state.claudeBusy = false;
}

async function confirmBatchPaidAction(act, ids) {
  let preview;
  try {
    preview = await api('/api/jobs/batch/cost-preview', {
      method: 'POST',
      body: JSON.stringify({ act, candidateIds: ids }),
    });
  } catch (error) {
    await showModal({
      title: 'Cost preview failed',
      confirmLabel: 'OK',
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
    return false;
  }
  if (!preview.runnable) {
    await showModal({
      title: 'Cannot run batch',
      confirmLabel: 'OK',
      bodyHtml: `<p>No runnable candidates for ${esc(act)}.</p><ul>${(preview.errors || [])
        .slice(0, 8)
        .map((e) => `<li>${esc(e.id)}: ${esc(e.error)}</li>`)
        .join('')}</ul>`,
    });
    return false;
  }
  const bal =
    state.dfsBalance?.ok && state.dfsBalance.balance != null
      ? `<p class="muted">DFS balance: ${esc(formatMoney(state.dfsBalance.balance))}</p>`
      : '';
  const errHtml = (preview.errors || []).length
    ? `<p class="warn-text">${esc(String(preview.errors.length))} will be skipped:</p><ul>${preview.errors
        .slice(0, 6)
        .map((e) => `<li>${esc(e.id)}: ${esc(e.error)}</li>`)
        .join('')}</ul>`
    : '';
  const adsNote =
    act === 'research'
      ? `<p><strong>Ads volumes:</strong> ${
          getAdsMode() === 'standard'
            ? 'Standard queue (~$0.05–0.06/task, slower — good overnight)'
            : 'Live (~$0.075–0.09/task, seconds)'
        }. Change beside Run research.</p>`
      : '';
  return showModal({
    title: preview.title,
    confirmLabel: preview.confirmLabel || `Run on ${preview.runnable}`,
    bodyHtml: `
      <p>${esc(preview.estimateLabel || '')}</p>
      <p class="muted">${esc(preview.estimateDetail || '')}</p>
      ${adsNote}
      ${preview.overwriteNote ? `<p class="warn-text">${esc(preview.overwriteNote)}</p>` : ''}
      ${bal}
      ${errHtml}
    `,
  });
}

function renderActions() {
  const el = document.getElementById('stage-rail');
  if (!el) return;
  const d = state.detail;
  const multiIds = [...state.selectedIds];
  const targetCount = multiIds.length > 0 ? multiIds.length : d ? 1 : 0;
  el.classList.remove('hidden');

  if (targetCount === 0) {
    el.innerHTML = `
      <div class="stage-rail-head">Stages</div>
      <p class="stage-toolbar-meta muted">Select rows, then run Stage 1–4 on the selection.</p>
    `;
    return;
  }

  const agg = targetCount > 1 ? aggregateSelectedFlags() : null;
  const focusedId =
    multiIds.length === 1 ? multiIds[0] : multiIds.length === 0 ? state.selectedId : null;
  const listRow = focusedId
    ? state.candidates.find((c) => c.id === focusedId)
    : null;
  const f = d?.stageFlags || listRow?.stageFlags || {};
  const hasAnthropic = Boolean(state.health?.hasAnthropic);
  const researchDone =
    targetCount > 1
      ? agg.hasResearch === agg.count && agg.count > 0
      : Boolean(f.hasResearch);
  const enrichDone =
    targetCount > 1
      ? agg.hasEnrichment === agg.count && agg.count > 0
      : Boolean(f.hasEnrichment);
  const narrAccepted =
    targetCount > 1
      ? agg.hasNarrative === agg.count && agg.count > 0
      : Boolean(f.hasNarrative);
  const narrDraft =
    targetCount > 1
      ? agg.hasNarrativeDraft > 0 && agg.hasNarrative < agg.count
      : Boolean(f.hasNarrativeDraft) && !f.hasNarrative;
  const prospectsDone =
    targetCount > 1
      ? agg.hasProspects === agg.count && agg.count > 0
      : Boolean(f.hasProspects);
  const busy = Boolean(state.activeJobId || state.activeBatchJobId || state.claudeBusy);
  const runningAct = state.activeAct;
  const batchLabel = targetCount > 1 ? ` (${targetCount})` : '';
  const stageBusyAttr = (act) => {
    if (!busy) return '';
    if (runningAct === act) return 'disabled aria-busy="true"';
    return 'disabled';
  };
  const aggMark = (k, n) =>
    targetCount > 1 ? ` <span class="muted">${k}/${n}</span>` : '';
  const lc = d?.meta?.lastCosts || {};
  const costBits = [
    lc.research != null ? `Research ${formatMoney(lc.research)}` : null,
    lc.enrich != null ? `Enrich ${formatMoney(lc.enrich)}` : null,
    lc.narrative != null ? `Narrative ~${formatMoney(lc.narrative)}` : null,
    lc.prospects != null ? `Prospects ${formatMoney(lc.prospects)}` : null,
    lc.outreach != null ? `Outreach ~${formatMoney(lc.outreach)}` : null,
  ].filter(Boolean);
  const metaBits = [
    targetCount > 1 ? `${targetCount} selected` : null,
    costBits.length && targetCount <= 1 ? `Last: ${costBits.join(' · ')}` : null,
  ].filter(Boolean);

  el.innerHTML = `
    <div
      class="actions-toolbar"
      title="✓ = stage has data. Select rows to batch Stage 1–4. Accept works on selection when drafts exist."
    >
      <div class="action-group stage-1${researchDone ? ' action-done' : ''}${
        runningAct === 'research' ? ' action-running' : ''
      }">
        <span class="action-group-head">1${
          researchDone
            ? ` ${stageCheckMark()}`
            : targetCount > 1
              ? aggMark(agg.hasResearch, agg.count)
              : ''
        }</span>
        <div class="action-group-btns">
          ${adsModeSelectHtml(busy)}
          ${researchModeSelectHtml(busy)}
          <button type="button" class="btn btn-sm" data-act="research" ${stageBusyAttr(
            'research',
          )}>${
            runningAct === 'research'
              ? 'Running…'
              : targetCount > 1
                ? `Research${batchLabel}`
                : researchDone
                  ? 'Re-run'
                  : 'Research'
          }</button>
        </div>
      </div>
      <div class="action-group stage-2${enrichDone ? ' action-done' : ''}${
        runningAct === 'enrich' ? ' action-running' : ''
      }">
        <span class="action-group-head">2${
          enrichDone
            ? ` ${stageCheckMark()}`
            : targetCount > 1
              ? aggMark(agg.hasEnrichment, agg.count)
              : ''
        }</span>
        <div class="action-group-btns">
          <button type="button" class="btn btn-sm" data-act="enrich" ${stageBusyAttr('enrich')}>${
            runningAct === 'enrich'
              ? 'Running…'
              : targetCount > 1
                ? `Enrich${batchLabel}`
                : enrichDone
                  ? 'Re-run'
                  : 'Enrich'
          }</button>
        </div>
      </div>
      <div class="action-group stage-narr${narrAccepted ? ' action-done' : ''}${
        narrDraft ? ' action-draft' : ''
      }${runningAct === 'narrative' || runningAct === 'outreach' ? ' action-running' : ''}">
        <span class="action-group-head">3${
          narrAccepted
            ? ` ${stageCheckMark()}`
            : narrDraft && targetCount === 1
              ? ` ${stageDraftMark()}`
              : targetCount > 1
                ? aggMark(agg.hasNarrativeDraft + agg.hasNarrative, agg.count)
                : ''
        }</span>
        <div class="action-group-btns">
          <button type="button" class="btn btn-sm primary" data-act="narrative" ${
            !hasAnthropic || busy ? 'disabled' : ''
          } ${runningAct === 'narrative' ? 'aria-busy="true"' : ''}>${
            runningAct === 'narrative'
              ? 'Claude…'
              : targetCount > 1
                ? `Claude${batchLabel}`
                : 'Claude'
          }</button>
          <button type="button" class="btn btn-sm" data-act="copy-prompt" ${
            busy || targetCount > 1 ? 'disabled' : ''
          } title="Copy Claude.ai prompt">Copy</button>
          <button type="button" class="btn btn-sm" data-act="accept" ${
            busy
              ? 'disabled'
              : targetCount > 1
                ? agg?.hasNarrativeDraft > 0
                  ? ''
                  : 'disabled'
                : d?.narrativeDraft
                  ? ''
                  : 'disabled'
          }>${targetCount > 1 ? `Accept${batchLabel}` : 'Accept'}</button>
          <button type="button" class="btn btn-sm danger" data-act="reject" ${
            busy
              ? 'disabled'
              : targetCount > 1
                ? agg?.hasNarrativeDraft > 0
                  ? ''
                  : 'disabled'
                : d?.narrativeDraft
                  ? ''
                  : 'disabled'
          }>${targetCount > 1 ? `Reject${batchLabel}` : 'Reject'}</button>
        </div>
      </div>
      <div class="action-group stage-4${prospectsDone ? ' action-done' : ''}${
        runningAct === 'prospects' || runningAct === 'outreach' ? ' action-running' : ''
      }">
        <span class="action-group-head">4${
          prospectsDone
            ? ` ${stageCheckMark()}`
            : targetCount > 1
              ? aggMark(agg.hasProspects, agg.count)
              : ''
        }</span>
        <div class="action-group-btns">
          <button type="button" class="btn btn-sm" data-act="prospects" ${stageBusyAttr(
            'prospects',
          )}>${
            runningAct === 'prospects'
              ? 'Running…'
              : targetCount > 1
                ? `Prospects${batchLabel}`
                : prospectsDone
                  ? 'Re-run'
                  : 'Prospects'
          }</button>
          <button type="button" class="btn btn-sm" data-act="outreach" ${
            !hasAnthropic || busy || targetCount > 1 ? 'disabled' : ''
          } ${runningAct === 'outreach' ? 'aria-busy="true"' : ''}>${
            runningAct === 'outreach' ? 'Claude…' : 'Outreach'
          }</button>
        </div>
      </div>
    </div>
    <div id="job-progress" class="job-progress${busy ? '' : ' hidden'}" aria-live="polite">
      <div class="job-progress-track"><div class="job-progress-bar"></div></div>
      <p class="job-progress-label">Running ${esc(jobActLabel(runningAct))}…</p>
      <p class="job-progress-detail" id="job-progress-detail">${esc(
        state.jobStatusLine || 'Working…',
      )}</p>
    </div>
    ${
      metaBits.length
        ? `<p class="stage-toolbar-meta muted" title="Last recorded run costs">${esc(
            metaBits.join(' · '),
          )}</p>`
        : ''
    }
  `;

  el.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => handleAction(btn.dataset.act, btn));
  });
  const adsSel = el.querySelector('#ads-mode-select');
  if (adsSel) {
    adsSel.addEventListener('change', () => {
      setAdsMode(adsSel.value);
    });
  }
  const researchSel = el.querySelector('#research-mode-select');
  if (researchSel) {
    researchSel.addEventListener('change', () => {
      setResearchMode(researchSel.value);
    });
  }
}

async function acceptNarrativeWithOverride(id, { allowJobCostOverride = false } = {}) {
  try {
    return await api(`/api/candidates/${encodeURIComponent(id)}/narrative/accept`, {
      method: 'POST',
      body: JSON.stringify({ allowJobCostOverride }),
    });
  } catch (error) {
    if (error.code === 'job_cost_seed_mismatch' && !allowJobCostOverride) {
      const ok = await showModal({
        title: 'Job cost outside Discovery seed band',
        confirmLabel: 'Accept anyway',
        bodyHtml: `<p>${esc(error.message)}</p><p class="muted">Prefer adding <code>averageJobCostUsd.basis</code> in the draft. Override only if you reviewed the ticket size.</p>`,
      });
      if (!ok) throw error;
      return acceptNarrativeWithOverride(id, { allowJobCostOverride: true });
    }
    throw error;
  }
}

async function handleBatchNarrativeAccept(ids) {
  const result = await api('/api/candidates/narrative/accept', {
    method: 'POST',
    body: JSON.stringify({ ids, allowJobCostOverride: false }),
  });
  let accepted = [...(result.accepted || [])];
  let errors = [...(result.errors || [])];
  const mismatchIds = errors
    .filter((e) => e.code === 'job_cost_seed_mismatch')
    .map((e) => e.id);
  if (mismatchIds.length) {
    const ok = await showModal({
      title: 'Some job costs outside seed band',
      confirmLabel: `Override & accept (${mismatchIds.length})`,
      bodyHtml: `<p>${esc(String(mismatchIds.length))} draft(s) are outside the Discovery job-cost band and lack a basis note.</p>
        <p class="muted">${esc(mismatchIds.join(', '))}</p>`,
    });
    if (ok) {
      const retry = await api('/api/candidates/narrative/accept', {
        method: 'POST',
        body: JSON.stringify({ ids: mismatchIds, allowJobCostOverride: true }),
      });
      accepted = accepted.concat(retry.accepted || []);
      errors = errors
        .filter((e) => e.code !== 'job_cost_seed_mismatch')
        .concat(retry.errors || []);
    }
  }
  return { accepted, errors };
}

async function warnResearchOrphansEnrichment(ids, researchMode) {
  if (researchMode === 'volumes_only') return true;
  const enriched = ids.filter((cid) => {
    const row = state.candidates.find((c) => c.id === cid);
    return Boolean(row?.stageFlags?.hasEnrichment);
  });
  if (!enriched.length) return true;
  return showModal({
    title: 'Re-run Stage 1 may orphan enrichment',
    confirmLabel: 'Continue research',
    bodyHtml: `<p><strong>${esc(String(enriched.length))}</strong> selected candidate(s) already have Stage 2 enrichment.</p>
      <p class="muted">SERP changes can make Rank/thinness stale. Re-run Enrich after research finishes (or use Volumes only to refresh Ads without touching SERP).</p>`,
  });
}

async function handleAction(act, btn) {
  const multiIds = [...state.selectedIds];
  const id = multiIds.length === 1 ? multiIds[0] : state.selectedId;
  btn.disabled = true;
  try {
    if (act === 'research' || act === 'enrich' || act === 'prospects' || act === 'narrative') {
      if (state.activeJobId || state.activeBatchJobId || state.claudeBusy) return;
      const ids = multiIds.length > 0 ? multiIds : id ? [id] : [];
      if (!ids.length) return;

      if (act === 'narrative' && ids.length === 1) {
        const ok = await confirmPaidAction('narrative');
        if (!ok) return;
        state.claudeBusy = true;
        state.activeAct = 'narrative';
        state.jobStatusLine = 'Calling Claude…';
        renderActions();
        try {
          const result = await api(`/api/candidates/${encodeURIComponent(ids[0])}/narrative`, {
            method: 'POST',
            body: '{}',
          });
          state.detail = await api(`/api/candidates/${encodeURIComponent(ids[0])}`);
          state.tab = 'narrative';
          renderDetail();
          await showActualCostModal({
            title: result.parseError ? 'Narrative draft (parse error)' : 'Narrative draft ready',
            costUsd: result.costUsd,
            costNote: result.costNote,
            provider: 'anthropic',
          });
        } finally {
          clearJobBusy();
          renderActions();
        }
        return;
      }

      if (ids.length > 1 || (act !== 'narrative' && ids.length >= 1 && multiIds.length > 1)) {
        if (act === 'research') {
          const proceed = await warnResearchOrphansEnrichment(ids, getResearchMode());
          if (!proceed) return;
        }
        const ok = await confirmBatchPaidAction(act, ids);
        if (!ok) return;
        const researchOpts = act === 'research' ? researchOptsFromMode() : {};
        const batch = await api('/api/jobs/batch', {
          method: 'POST',
          body: JSON.stringify({
            act,
            candidateIds: ids,
            concurrency: act === 'narrative' ? 1 : 1,
            adsMode: act === 'research' ? getAdsMode() : undefined,
            ...researchOpts,
          }),
        });
        state.activeBatchJobId = batch.id;
        state.activeAct = act;
        state.lastBatchJob = batch;
        state.jobStatusLine = 'Starting batch…';
        state.tab = 'logs';
        renderActions();
        if (state.selectedIds.size > 1) renderMultiDetail();
        pollBatchJob(batch.id);
        return;
      }

      if (act === 'narrative') return;

      if (act === 'research') {
        const proceed = await warnResearchOrphansEnrichment(ids, getResearchMode());
        if (!proceed) return;
      }
      const ok = await confirmPaidAction(act);
      if (!ok) return;
      state.activeAct = act;
      state.jobStatusLine = 'Starting…';
      renderActions();
      const researchOpts = act === 'research' ? researchOptsFromMode() : {};
      const job = await api(`/api/candidates/${encodeURIComponent(ids[0])}/${act}`, {
        method: 'POST',
        body: JSON.stringify(
          act === 'research' ? { adsMode: getAdsMode(), ...researchOpts } : {},
        ),
      });
      state.activeJobId = job.job?.id || job.id;
      state.tab = 'logs';
      renderDetail();
      startJobPoll(state.activeJobId, act);
      return;
    }

    if (act === 'copy-prompt') {
      if (!id) return;
      const data = await api(`/api/candidates/${encodeURIComponent(id)}/copy-prompt`);
      await navigator.clipboard.writeText(data.prompt || '');
      await showModal({
        title: 'Copied',
        confirmLabel: 'OK',
        bodyHtml: '<p>Claude.ai prompt is on your clipboard.</p>',
      });
      return;
    }

    if (act === 'accept' || act === 'reject') {
      const ids = multiIds.length > 0 ? multiIds : id ? [id] : [];
      if (!ids.length) return;

      if (act === 'reject' && ids.length > 1) {
        const ok = await showModal({
          title: 'Reject narrative drafts?',
          confirmLabel: `Reject (${ids.length})`,
          bodyHtml: `<p>Discard draft JSON for <strong>${esc(String(ids.length))}</strong> selected candidates (accepted narratives are kept).</p>`,
        });
        if (!ok) return;
        const result = await api('/api/candidates/narrative/reject', {
          method: 'POST',
          body: JSON.stringify({ ids }),
        });
        await loadCandidates();
        if (state.selectedId) {
          state.detail = await api(`/api/candidates/${encodeURIComponent(state.selectedId)}`);
        }
        if (state.selectedIds.size > 1) renderMultiDetail();
        else renderDetail();
        if (result.errors?.length) {
          await showModal({
            title: 'Some rejects failed',
            confirmLabel: 'OK',
            bodyHtml: `<p>${esc(result.errors.map((e) => `${e.id}: ${e.error}`).join('; '))}</p>`,
          });
        }
        return;
      }

      if (act === 'accept' && ids.length > 1) {
        const ok = await showModal({
          title: 'Accept narrative drafts?',
          confirmLabel: `Accept (${ids.length})`,
          bodyHtml: `<p>Accept drafts for <strong>${esc(String(ids.length))}</strong> selected candidates. Writes approved packages when validation passes.</p>`,
        });
        if (!ok) return;
        const result = await handleBatchNarrativeAccept(ids);
        await loadCandidates();
        if (state.selectedId) {
          state.detail = await api(`/api/candidates/${encodeURIComponent(state.selectedId)}`);
        }
        if (state.selectedIds.size > 1) renderMultiDetail();
        else renderDetail();
        const errMsg = (result.errors || []).map((e) => `${e.id}: ${e.error}`).join('; ');
        await showModal({
          title: 'Batch Accept complete',
          confirmLabel: 'OK',
          bodyHtml: `<p>Accepted <strong>${esc(String(result.accepted?.length || 0))}</strong>${
            result.errors?.length
              ? ` · failed <strong>${esc(String(result.errors.length))}</strong>`
              : ''
          }.</p>${errMsg ? `<p class="muted">${esc(errMsg)}</p>` : ''}`,
        });
        return;
      }

      if (!id) return;
      if (act === 'accept') {
        await acceptNarrativeWithOverride(id);
      } else {
        await api(`/api/candidates/${encodeURIComponent(id)}/narrative/reject`, {
          method: 'POST',
          body: '{}',
        });
      }
      state.detail = await api(`/api/candidates/${encodeURIComponent(id)}`);
      await loadCandidates();
      renderDetail();
      return;
    }

    if (act === 'outreach') {
      if (!id) return;
      const ok = await confirmPaidAction('outreach');
      if (!ok) return;
      state.claudeBusy = true;
      state.activeAct = 'outreach';
      renderActions();
      try {
        const result = await api(`/api/candidates/${encodeURIComponent(id)}/prospects-outreach`, {
          method: 'POST',
          body: '{}',
        });
        state.detail = await api(`/api/candidates/${encodeURIComponent(id)}`);
        state.tab = 'prospects';
        renderDetail();
        await showActualCostModal({
          title: 'Outreach draft ready',
          costUsd: result.costUsd,
          costNote: result.costNote,
          provider: 'anthropic',
        });
      } finally {
        clearJobBusy();
        renderActions();
      }
    }
  } catch (error) {
    clearJobBusy();
    await showModal({
      title: 'Action failed',
      confirmLabel: 'OK',
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
  } finally {
    btn.disabled = false;
    renderActions();
  }
}

function startJobPoll(jobId, act) {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      const job = await api(`/api/jobs/${jobId}`);
      const logEl = document.getElementById('job-log');
      if (logEl) logEl.textContent = job.logText || '(no output yet)';
      updateJobProgressDetail(latestProgressLine(job.logText) || 'Working…');
      if (job.status !== 'running') {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        const finishedAct = act;
        clearJobBusy();
        state.detail = await api(`/api/candidates/${encodeURIComponent(state.selectedId)}`);
        await loadCandidates();
        if (job.status === 'ok') {
          if (finishedAct === 'research') state.tab = 'serp';
          else if (finishedAct === 'enrich') state.tab = 'enrichment';
          else if (finishedAct === 'prospects') state.tab = 'prospects';
        } else {
          state.tab = 'logs';
        }
        renderDetail();
        if (job.status === 'ok') {
          await loadDfsBalance();
          await showActualCostModal({
            title: `${finishedAct} complete`,
            costUsd: job.costUsd,
            costNote:
              job.costUsd != null
                ? 'Actual DataForSEO cost for this run.'
                : 'Cost not found in job logs.',
            provider: job.costSource || 'dataforseo',
          });
        } else {
          const tail = String(job.logText || '')
            .trim()
            .split(/\r?\n/)
            .slice(-8)
            .join('\n');
          await showModal({
            title: `${jobActLabel(finishedAct)} failed`,
            confirmLabel: 'OK',
            bodyHtml: `
              <p><strong>${esc(job.error || 'Job exited with an error')}</strong></p>
              ${
                tail
                  ? `<pre class="log-snippet">${esc(tail)}</pre>`
                  : '<p class="muted">No log output.</p>'
              }
              <p class="muted">See the Logs tab for the full stream.</p>
            `,
          });
        }
      }
    } catch {
      /* ignore transient */
    }
  }, 1000);
}

function statCard(label, valueHtml) {
  return `<div class="stat"><span class="stat-label">${esc(label)}</span>${valueHtml}</div>`;
}

function renderOverview() {
  const r = state.detail.research;
  const s = state.detail.summary || {};
  const meta = state.detail.meta || {};
  const scoring = r?.scoring || {};
  const inputs = scoring.scoreInputs || {};
  const dispSource = r?.enrichment?.displaceability || scoring.displaceability || {};
  const dispScore = s.displaceability ?? inputs.displaceability ?? dispSource.score ?? null;
  const dispBand = displaceabilityBand(dispScore);
  const uniqueDomainCount = r?.serp?.uniqueOrganicDomains?.length ?? null;
  const homepageCount = r?.serp?.organicHomePages?.count ?? null;
  const competitionTip = competitionOpennessTip({
    uniqueDomainCount,
    homepageCount,
    score: inputs.competition,
    medianDomainRank: dispSource.medianDomainRank ?? null,
  });
  const dispTip = displaceabilityTip({
    score: dispScore,
    bandLabel: dispBand?.label ?? dispSource.band?.label ?? null,
    pageCount: dispSource.pageCount ?? null,
    thinStubCount: dispSource.thinStubCount ?? null,
    strongNichePageCount: dispSource.strongNichePageCount ?? null,
    medianThinnessScore: dispSource.medianThinnessScore ?? null,
    medianDomainRank: dispSource.medianDomainRank ?? null,
    hint: dispSource.hint ?? null,
  });

  const overallInputs = {
    demand: inputs.demand ?? null,
    competition: inputs.competition ?? null,
    jobValue: inputs.jobValue ?? null,
    mapPackGap: inputs.mapPackGap ?? null,
    displaceability:
      dispSource.score ??
      inputs.displaceability ??
      s.displaceability ??
      null,
  };
  const overallScore =
    computeProposedScore(overallInputs) ??
    s.proposedScore ??
    scoring.proposedScore ??
    null;
  const overallProvisional =
    overallScore != null && (overallInputs.jobValue == null || overallInputs.jobValue === '');

  const decisionOptions = [
    'pursue',
    'deprioritize',
    'maybe',
    'pass',
    'hold',
    'pass_unless_gbp_angle',
    'review',
  ];

  const softNotes = {
    soft: 'Few dedicated niche sites (≤1 homepage, ≤5 domains) — favorable; feeds pursue rules',
    mixed: 'In between soft and hard — weigh openness + displaceability; feeds decision rules',
    hard: 'Crowded SERP (pack + strong locals and/or many niche domains) — feeds deprioritize rules',
  };
  const dfsCosts = dfsCostBreakdown(state.detail);

  const scoreRows = [
    [
      'Overall score',
      overallScoreHtml(overallInputs, overallScore),
      overallProvisional
        ? 'Provisional — job value not set yet'
        : overallScore != null
          ? 'Weighted blend of available inputs'
          : 'Needs Stage 1 research',
    ],
    [
      'Cluster search volume',
      clusterVolumeHtml(s.clusterVolumeSum),
      s.clusterVolumeSum != null ? `${s.clusterVolumeSum} searches / mo across cluster geos` : '—',
    ],
    [
      'Map Pack',
      mapPackHtml(s.mapPackPresent, {
        slotCount: r?.serp?.localPack?.length ?? null,
        reviewsLabel: s.mapPackReviewsLabel,
        avgReviews: s.mapPackAvgReviews,
        maxReviews: s.mapPackMaxReviews,
        hasLsa: s.hasLocalServicesAds,
      }),
      s.mapPackPresent == null
        ? '—'
        : s.mapPackPresent
          ? `Present · ${s.mapPackReviewsLabel || `${r?.serp?.localPack?.length ?? '—'} locals`}`
          : 'Absent (gap)',
    ],
    [
      'Demand',
      metricHtml({
        value: inputs.demand,
        max: 10,
        label: 'Demand',
        extraTip: SCORE_INPUT_TIPS.demand,
      }),
      'From cluster search volume band',
    ],
    [
      'Organic openness',
      metricHtml({
        value: inputs.competition,
        max: 10,
        label: 'Organic openness',
        extraTip: competitionTip,
      }),
      uniqueDomainCount != null
        ? `${uniqueDomainCount} unique domains${homepageCount != null ? ` · ${homepageCount} homepages` : ''}`
        : '—',
    ],
    [
      'Displaceability',
      metricHtml({
        value: dispScore,
        max: 10,
        label: 'Displaceability',
        extraTip: dispTip,
      }),
      dispBand?.label || (dispScore == null ? 'Run Stage 2 enrich' : '—'),
    ],
    [
      'Job value',
      metricHtml({
        value: inputs.jobValue,
        max: 10,
        label: 'Job value',
        extraTip: SCORE_INPUT_TIPS.jobValue,
      }),
      inputs.jobValue == null ? 'Set via narrative / Claude' : '—',
    ],
    [
      'SERP softness',
      serpSoftnessHtml(s.serpSoftness),
      softNotes[s.serpSoftness] || 'soft / mixed / hard category for decision rules',
    ],
    [
      'API cost (USD)',
      `<span class="metric metric-neutral">${esc(formatMoney(dfsCosts.total))}</span>`,
      esc(dfsCosts.notes),
    ],
    [
      'Decision (yours)',
      `<span class="metric metric-neutral">${esc(meta.decision ?? '—')}</span>`,
      meta.decisionNotes ? esc(meta.decisionNotes) : 'Saved via form below · filter Candidates by decision group',
    ],
    [
      'Discovery source',
      `<span class="metric metric-neutral">${esc(meta.source?.batchId || '—')}</span>`,
      meta.source?.rowKey
        ? esc(`${meta.source.niche || ''} · ${meta.source.city || ''}, ${meta.source.state || ''}`)
        : 'Created outside Discovery or not stamped yet',
    ],
  ];

  return `
    ${legendHtml()}
    ${
      overallProvisional || state.detail?.narrativeDraft
        ? `<div class="callout warn finalize-job-val"><strong>Finalize Job Val</strong> — overall score is provisional until Stage 3 sets <code>averageJobCostUsd</code> + <code>jobValue</code>, then Accept.</div>`
        : ''
    }
    <h3 class="scores-heading">Scores</h3>
    <div class="scores-table">
      ${tableHtml(['Metric', 'Score', 'Notes'], scoreRows)}
    </div>
    <div class="decision-row">
      <label>Decision
        <select id="decision-select">
          ${decisionOptions
            .map(
              (d) =>
                `<option value="${d}" ${meta.decision === d ? 'selected' : ''}>${d}</option>`,
            )
            .join('')}
        </select>
      </label>
      <input id="decision-notes" placeholder="Notes" value="${esc(meta.decisionNotes || '')}" style="min-width:220px" />
      <button type="button" class="btn primary" id="save-decision">Save decision</button>
    </div>
    <details class="overview-paths">
      <summary>File paths</summary>
      ${tableHtml(
        ['Key', 'Path'],
        Object.entries(state.detail.paths || {}).map(([k, v]) => [esc(k), esc(v)]),
      )}
    </details>
  `;
}

function enrichmentLookups() {
  const enr = state.detail?.research?.enrichment;
  const byUrl = new Map();
  const byDomain = new Map();
  for (const p of enr?.pages || []) {
    if (p?.url) byUrl.set(String(p.url).replace(/\/$/, ''), p);
    if (p?.domain && p.domainRank != null && !byDomain.has(p.domain)) {
      byDomain.set(p.domain, p.domainRank);
    }
  }
  for (const [domain, row] of Object.entries(enr?.domains || {})) {
    if (row?.rank != null) byDomain.set(domain, row.rank);
  }
  return { byUrl, byDomain, hasEnrichment: Boolean(enr) };
}

function domainRankCell(link, lookups) {
  const urlKey = String(link.url || '').replace(/\/$/, '');
  const page = lookups.byUrl.get(urlKey);
  const rank = page?.domainRank ?? lookups.byDomain.get(link.domain) ?? null;
  if (rank == null) {
    const tip = lookups.hasEnrichment
      ? 'No Domain Rank for this URL/domain'
      : 'Run Stage 2 enrich for DataForSEO Domain Rank (0–100; not Moz DA)';
    return `<span class="metric metric-neutral" title="${esc(tip)}">—</span>`;
  }
  const rankBand = domainRankBand(rank);
  return metricHtml({
    value: rank,
    max: 100,
    polarity: 'higher-harder',
    label: 'DataForSEO Domain Rank (not Moz DA)',
    extraTip: rankBand ? `${rankBand.label} (${rankBand.range})` : '',
  });
}

function renderSerp() {
  const serp = state.detail.research?.serp;
  if (!serp) return '<p class="muted">No research yet — run Stage 1 (blue group).</p>';
  const lookups = enrichmentLookups();
  const local = (serp.localPack || []).map((b, i) => [
    String(i + 1),
    esc(b.title),
    esc(b.domain),
    esc(b.rating ?? '—'),
    esc(b.reviewsCount ?? '—'),
    b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">link</a>` : '—',
  ]);

  const blueLinks = [
    ...linkUrls(serp.organicHomePages?.links).map((l) => ({ ...l, kind: 'organic', type: 'homepage' })),
    ...linkUrls(serp.organicSubPages?.links).map((l) => ({ ...l, kind: 'organic', type: 'subpage' })),
    ...linkUrls(serp.directories?.links).map((l) => ({ ...l, kind: 'directory', type: 'directory' })),
  ]
    .sort((a, b) => {
      const ra = a.rankAbsolute == null ? 9999 : Number(a.rankAbsolute);
      const rb = b.rankAbsolute == null ? 9999 : Number(b.rankAbsolute);
      return ra - rb;
    })
    .map((l, i) => ({ ...l, blueNum: i + 1 }));

  const organic = blueLinks
    .filter((l) => l.kind === 'organic')
    .map((l) => [
      esc(l.blueNum),
      esc(l.rankAbsolute ?? '—'),
      esc(l.type),
      esc(l.domain || ''),
      domainRankCell(l, lookups),
      esc(l.title || ''),
      `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url)}</a>`,
    ]);
  const dirs = blueLinks
    .filter((l) => l.kind === 'directory')
    .map((l) => [
      esc(l.blueNum),
      esc(l.rankAbsolute ?? '—'),
      esc(l.domain || ''),
      domainRankCell(l, lookups),
      `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url)}</a>`,
    ]);
  const paid = linkUrls(serp.paidAds?.links).map((l) => [
    esc(l.domain || ''),
    esc(l.title || ''),
    l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">link</a>` : '—',
  ]);

  const homeCount = serp.organicHomePages?.count ?? 0;
  const domainCount = serp.uniqueOrganicDomains?.length ?? 0;
  const absTip =
    'Abs # = DataForSEO rank_absolute: position among EVERYTHING on the page (AI Overview, features, organic links…). Gaps are normal — missing numbers are usually AI Overview, related searches, or other blocks we do not list. Depth requests ~10 organic URLs; Abs # can still exceed 10.';
  const blueTip =
    'Blue # = order among listed blue links only (organic + directories), sorted by Abs #. Map Pack businesses are separate and not numbered here.';
  const organicHeaders = [
    thWithTip('Blue #', blueTip),
    thWithTip('Abs #', absTip),
    thWithTip('Type', 'Niche homepage vs location/service subpage'),
    thWithTip('Domain', 'Competitor domain'),
    thWithTip(
      'Domain Rank',
      'DataForSEO Rank 0–100 after Stage 2 enrich. Higher = stronger competitor = harder for you. Not Moz DA.',
    ),
    thWithTip('Title', 'SERP title'),
    thWithTip('URL', 'Landing URL'),
  ].join('');
  const dirHeaders = [
    thWithTip('Blue #', blueTip),
    thWithTip('Abs #', absTip),
    thWithTip('Domain', 'Directory domain'),
    thWithTip(
      'Domain Rank',
      'DataForSEO Rank 0–100 after Stage 2 enrich. Higher = stronger competitor. Not Moz DA.',
    ),
    thWithTip('URL', 'Landing URL'),
  ].join('');

  return `
    <div class="callout">
      Map Pack: ${mapPackHtml(serp.mapPackPresent, {
        slotCount: serp.localPack?.length,
        reviewsLabel: serp.mapPackReviews?.reviewsLabel,
        avgReviews: serp.mapPackReviews?.avgReviews,
        maxReviews: serp.mapPackReviews?.maxReviews,
        hasLsa: serp.features?.localServicesAds,
      })}
      · Organic homepages: <strong title="Higher count = harder SERP">${esc(homeCount)}</strong>
      · Unique domains: <strong title="Higher count = harder SERP">${esc(domainCount)}</strong>
      · item types: ${esc((serp.itemTypes || []).join(', '))}
    </div>
    <div class="callout">
      <strong>About numbering:</strong> Abs # is full-page position (not “organic 1–10”).
      Gaps (e.g. missing 1 or 10–12) are usually AI Overview / related blocks — not missing blue links.
      Map Pack rows below are separate and unnumbered in Abs #.
      We request ~10 organic URLs; Abs # can still be 13+ when other features sit above them.
      Blue # is a simple 1…N among the blue links we list.
    </div>
    <h3>Map Pack</h3>
    ${tableHtml(['#', 'Business', 'Domain', 'Rating', 'Reviews', 'URL'], local)}
    <h3>Organic</h3>
    ${tableHtml(organicHeaders, organic)}
    <h3>Directories</h3>
    ${tableHtml(dirHeaders, dirs)}
    <h3>Paid ads</h3>
    ${tableHtml(['Domain', 'Title', 'URL'], paid)}
  `;
}

function renderKeywords() {
  const vols = state.detail.research?.volumes;
  if (!vols) return '<p class="muted">No volumes yet — run Stage 1 (blue group).</p>';
  const rows = (vols.keywords || []).map((k) => [
    esc(k.keyword),
    esc(k.primaryVolume),
    esc(k.clusterSum),
    esc(k.competition ?? '—'),
    esc(k.cpc ?? '—'),
    esc(JSON.stringify(k.perCity || {})),
  ]);
  const headers = [
    thWithTip('Keyword', 'Keyword from related ideas + seeds'),
    thWithTip('Primary', 'Monthly volume FROM the primary city geo (not “about” the city)'),
    thWithTip('Cluster', 'Sum of volumes across measured cluster cities'),
    thWithTip('Comp', 'Google Ads auction competition (LOW/MED/HIGH) — not organic SEO difficulty'),
    thWithTip('CPC', 'Ads cost-per-click when available — commercial intent proxy'),
    thWithTip('Per city', 'Volume broken out by measured city'),
  ].join('');

  return `
    <div class="stat-grid">
      ${statCard('Primary sum', `<span class="metric metric-neutral"><strong>${esc(vols.primaryVolumeSum)}</strong><span class="metric-suffix"> /mo</span></span>`)}
      ${statCard('Cluster sum', clusterVolumeHtml(vols.clusterVolumeSum))}
      ${statCard('Cities measured', `<span class="metric metric-neutral">${esc((vols.citiesMeasured || []).join(', ') || '—')}</span>`)}
    </div>
    ${tableHtml(headers, rows)}
  `;
}

function renderEnrichment() {
  const enr = state.detail.research?.enrichment;
  if (!enr) return '<p class="muted">No enrichment — run Stage 2 (purple group).</p>';
  const d = enr.displaceability || {};
  const fetchFailedCount =
    enr.fetchFailedCount ??
    d.fetchFailedCount ??
    (enr.pages || []).filter((p) => p.fetchFailed || p.strengthLabel === 'fetch_failed').length;
  const dispTip = displaceabilityTip({
    score: d.score ?? null,
    bandLabel: d.band?.label ?? d.band?.id ?? null,
    pageCount: d.pageCount ?? null,
    thinStubCount: d.thinStubCount ?? null,
    strongNichePageCount: d.strongNichePageCount ?? null,
    medianThinnessScore: d.medianThinnessScore ?? null,
    medianDomainRank: d.medianDomainRank ?? null,
    hint: d.hint ?? null,
  });
  const pages = (enr.pages || []).map((p) => {
    const rankBand = domainRankBand(p.domainRank);
    return [
      strengthLabelHtml(p.strengthLabel),
      metricHtml({
        value: p.thinnessScore,
        max: 10,
        polarity: 'higher-thinner',
        label: 'Thinness',
        extraTip: 'Higher = thinner page = easier to displace.',
      }),
      metricHtml({
        value: p.domainRank,
        max: 100,
        polarity: 'higher-harder',
        label: 'DataForSEO domain Rank (not Moz DA)',
        extraTip: rankBand ? `${rankBand.label} (${rankBand.range})` : '',
      }),
      metricHtml({
        value: p.pageRank,
        max: 100,
        polarity: 'higher-harder',
        label: 'DataForSEO page Rank',
        extraTip: 'Higher = stronger page = harder for you.',
      }),
      esc(p.signals?.wordCount ?? '—'),
      esc(p.domain),
      `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a>`,
    ];
  });
  const domains = Object.entries(enr.domains || {}).map(([domain, row]) => {
    const rankBand = domainRankBand(row.rank);
    return [
      esc(domain),
      metricHtml({
        value: row.rank,
        max: 100,
        polarity: 'higher-harder',
        label: 'Domain Rank',
        extraTip: rankBand ? `${rankBand.label}` : row.error || '',
      }),
      esc(row.referringDomains ?? '—'),
      esc(row.error ? 'error' : 'ok'),
    ];
  });

  const pageHeaders = [
    thWithTip('Label', 'thin_stub = easier · strong_niche_page = harder · fetch_failed = excluded'),
    thWithTip('Thin', '1–10. Higher = thinner = easier to displace'),
    thWithTip('Dom Rank', '0–100 DataForSEO Rank. Higher = stronger competitor = harder for you. Not Moz DA.'),
    thWithTip('Page Rank', '0–100 page-level Rank. Higher = harder for you.'),
    thWithTip('Words', 'Approximate main-content word count from HTML fetch'),
    'Domain',
    'URL',
  ].join('');

  return `
    ${legendHtml()}
    <div class="callout warn">${esc(enr.metricDisclaimer || '')}</div>
    ${
      fetchFailedCount > 0
        ? `<div class="callout warn"><strong>${esc(String(fetchFailedCount))}</strong> page fetch failure(s) — labeled <code>fetch_failed</code>, excluded from displaceability. Re-run Enrich to retry.</div>`
        : ''
    }
    <div class="stat-grid">
      ${statCard(
        'Displaceability',
        metricHtml({
          value: d.score,
          max: 10,
          label: 'Displaceability',
          extraTip: dispTip,
        }),
      )}
      ${statCard(
        'Band',
        `<span class="metric metric-neutral" title="${esc(dispTip)}">${esc(d.band?.label ?? d.band?.id ?? '—')}</span>`,
      )}
      ${statCard('Thin stub share', `<span class="metric metric-neutral" title="Share of organic URLs labeled thin_stub. Higher often means easier.">${esc(d.thinStubShare ?? '—')}</span>`)}
      ${statCard('Fetch failures', `<span class="metric metric-${fetchFailedCount > 0 ? 'bad' : 'neutral'}" title="HTML fetches that failed after retry"><strong>${esc(String(fetchFailedCount))}</strong></span>`)}
    </div>
    <p class="muted" title="${esc(dispTip)}">${esc(d.hint || 'Hover Displaceability for the full scoring recipe.')}</p>
    <h3>Pages</h3>
    ${tableHtml(pageHeaders, pages)}
    <h3>Domains</h3>
    ${tableHtml(
      [
        'Domain',
        thWithTip('Rank', '0–100. Higher = harder competitor'),
        'Ref domains',
        'Status',
      ].join(''),
      domains,
    )}
    <h3>Extras</h3>
    <div class="json-block">${esc(JSON.stringify(enr.extras || {}, null, 2))}</div>
  `;
}

function listHtml(items) {
  if (!items?.length) return '<p class="muted">—</p>';
  return `<ul class="narrative-list">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
}

function narrativeReviewHtml(doc, { pending = false } = {}) {
  if (!doc) return '';
  if (doc.parseError) {
    return `<div class="json-block">${esc(doc.rawText || '')}</div>`;
  }
  const scoring = doc.scoring || {};
  const inputs = scoring.scoreInputs || {};
  const job = doc.averageJobCostUsd || {};
  const ttr = doc.estTimeToRankMonths || {};
  const source = doc._ops?.source === 'paste' ? 'pasted' : doc._ops?.model ? `API · ${doc._ops.model}` : 'draft';
  const parts = [];
  if (pending) {
    const jobValMissing =
      inputs.jobValue == null || inputs.jobValue === '' || Number.isNaN(Number(inputs.jobValue));
    const costMissing = job.low == null && job.high == null && job.midpoint == null;
    parts.push(`<div class="callout warn">Draft pending Accept · ${esc(source)}
      ${doc._ops?.usage ? ` · usage ${esc(JSON.stringify(doc._ops.usage))}` : ''}
    </div>`);
    if (jobValMissing || costMissing) {
      parts.push(`<div class="callout warn finalize-job-val"><strong>Finalize Job Val</strong> before Accept —
        ${costMissing ? 'set <code>averageJobCostUsd</code> (low/high/midpoint) · ' : ''}
        ${jobValMissing ? 'set <code>scoring.scoreInputs.jobValue</code> (1–10)' : 'jobValue present'}
        ${doc.averageJobCostUsd?.basis ? '' : ' · add <code>basis</code> if outside Discovery seed band'}
      </div>`);
    }
    parts.push(`<div class="narrative-actions">
      <button type="button" class="btn primary" data-act="accept">Accept into candidate</button>
      <button type="button" class="btn danger" data-act="reject">Reject draft</button>
    </div>`);
  } else {
    parts.push(`<div class="callout">Accepted narrative · ${esc(source)}${
      state.detail?.stageFlags?.hasApproved ? ' · approved package ready' : ''
    }</div>`);
  }

  parts.push(`<h3>Scores</h3>`);
  parts.push(
    tableHtml(
      ['Metric', 'Value'],
      [
        [
          'Overall (proposed)',
          overallScoreHtml(
            {
              demand: inputs.demand,
              competition: inputs.competition,
              jobValue: inputs.jobValue,
              mapPackGap: inputs.mapPackGap,
              displaceability: inputs.displaceability,
            },
            scoring.proposedScore,
          ),
        ],
        [
          'Demand',
          metricHtml({
            value: inputs.demand,
            max: 10,
            label: 'Demand',
            extraTip: SCORE_INPUT_TIPS.demand,
          }),
        ],
        [
          'Organic openness',
          metricHtml({
            value: inputs.competition,
            max: 10,
            label: 'Organic openness',
            extraTip: SCORE_INPUT_TIPS.competition,
          }),
        ],
        [
          'Job value',
          metricHtml({
            value: inputs.jobValue,
            max: 10,
            label: 'Job value',
            extraTip: SCORE_INPUT_TIPS.jobValue,
          }),
        ],
        [
          'Map Pack gap',
          metricHtml({
            value: inputs.mapPackGap,
            max: 10,
            label: 'Map Pack gap',
            extraTip: SCORE_INPUT_TIPS.mapPackGap,
          }),
        ],
        [
          'Displaceability',
          metricHtml({
            value: inputs.displaceability,
            max: 10,
            label: 'Displaceability',
            extraTip: SCORE_INPUT_TIPS.displaceability,
          }),
        ],
        ['Ticket class', esc(scoring.ticketClass ?? '—')],
        [
          'Displaceability band',
          esc(
            typeof scoring.displaceabilityBand === 'object'
              ? scoring.displaceabilityBand?.id ?? scoring.displaceabilityBand?.label
              : scoring.displaceabilityBand ?? '—',
          ),
        ],
      ],
    ),
  );

  parts.push(`<h3>Decision</h3>`);
  parts.push(
    tableHtml(
      ['Field', 'Value'],
      [
        ['Decision', esc(scoring.decision?.decision ?? '—')],
        ['Rule', esc(scoring.decision?.ruleId ?? '—')],
        ['Summary', esc(scoring.decision?.summary ?? '—')],
      ],
    ),
  );

  parts.push(`<h3>Job cost</h3>`);
  parts.push(
    tableHtml(
      ['Field', 'Value'],
      [
        [
          'Range',
          job.low != null || job.high != null
            ? esc(`$${job.low ?? '?'} – $${job.high ?? '?'}`)
            : '—',
        ],
        ['Midpoint', job.midpoint != null ? esc(`$${job.midpoint}`) : '—'],
        ['Confidence', esc(job.confidence ?? '—')],
        ['Basis', esc(job.basis ?? '—')],
      ],
    ),
  );

  parts.push(`<h3>Time to rank</h3>`);
  parts.push(
    tableHtml(
      ['Field', 'Value'],
      [
        ['With GBP', esc(ttr.withGbp ?? '—')],
        ['Without GBP', esc(ttr.withoutGbp ?? '—')],
        ['Confidence', esc(ttr.confidence ?? '—')],
        ['Basis', esc(ttr.basis ?? '—')],
      ],
    ),
  );

  parts.push(`<h3>Local pain points</h3>${listHtml(doc.localPainPoints)}`);
  parts.push(`<h3>Suggested services</h3>${listHtml(doc.suggestedServices)}`);
  parts.push(`<h3>Suggested suburbs</h3>${listHtml(doc.suggestedSuburbs)}`);

  if (doc.spreadsheetFields && typeof doc.spreadsheetFields === 'object') {
    parts.push(`<h3>Spreadsheet fields</h3>`);
    parts.push(
      tableHtml(
        ['Field', 'Value'],
        Object.entries(doc.spreadsheetFields).map(([k, v]) => [
          esc(k),
          `<span class="pre-cell">${esc(v == null ? '—' : String(v))}</span>`,
        ]),
      ),
    );
  }

  parts.push(`<details class="narrative-raw"><summary>Raw JSON</summary>
    <div class="json-block">${esc(JSON.stringify(doc, null, 2))}</div>
  </details>`);
  return parts.join('');
}

function narrativePasteBoxHtml({ replace = false } = {}) {
  return `
    <div class="narrative-paste">
      <h3>${replace ? 'Replace draft from paste' : 'Paste Claude.ai JSON'}</h3>
      <p class="muted">Copy Claude’s JSON response, paste below, then Load as draft. Review the readable summary, then Accept or Reject.</p>
      <textarea id="narrative-paste" class="narrative-paste-input" rows="10" placeholder='{ "niche": "...", "scoring": { ... } }'></textarea>
      <div class="narrative-actions">
        <button type="button" class="btn primary" id="narrative-paste-btn">Load as draft</button>
      </div>
    </div>
  `;
}

function renderNarrative() {
  const draft = state.detail.narrativeDraft;
  const accepted = state.detail.narrative;
  const busy = state.claudeBusy && state.activeAct === 'narrative';
  const parts = [];
  parts.push(
    `<p class="action-hint">Claude API (when key set) writes a draft here · Or Copy Claude.ai prompt → paste JSON below · Nothing commits until Accept (writes <code>*-approved.json</code>)</p>`,
  );
  if (busy) {
    parts.push(`<div class="callout warn">Calling Claude… results will appear here when ready.</div>`);
  }
  if (draft) {
    parts.push(narrativeReviewHtml(draft, { pending: true }));
    parts.push(narrativePasteBoxHtml({ replace: true }));
  } else {
    parts.push(narrativePasteBoxHtml({ replace: false }));
  }
  if (accepted) {
    parts.push('<h3 class="scores-heading">Accepted</h3>');
    parts.push(narrativeReviewHtml(accepted, { pending: false }));
  }
  return parts.join('');
}

function siteConfigNapFromLocal() {
  try {
    return JSON.parse(localStorage.getItem('ops.siteConfigNap') || '{}') || {};
  } catch {
    return {};
  }
}

function saveSiteConfigNapFromForm() {
  const nap = {
    domain: document.getElementById('sc-domain')?.value?.trim() || '',
    businessName: document.getElementById('sc-business')?.value?.trim() || '',
    phone: document.getElementById('sc-phone')?.value?.trim() || '',
    email: document.getElementById('sc-email')?.value?.trim() || '',
    radiusMiles: document.getElementById('sc-radius')?.value?.trim() || '40',
    siteArchetype: document.getElementById('sc-archetype')?.value || 'multi_service',
  };
  try {
    localStorage.setItem('ops.siteConfigNap', JSON.stringify(nap));
  } catch {
    /* ignore */
  }
  return nap;
}

function renderSiteConfig() {
  const d = state.detail;
  const f = d?.stageFlags || {};
  const decision = d?.meta?.decision || null;
  const nap = siteConfigNapFromLocal();
  const pack = d?.approved;
  const draft = d?.siteConfigDraft;
  const accepted = d?.siteConfig;
  const ready = Boolean(f.hasNarrative && f.hasApproved && decision === 'pursue');
  const parts = [];

  parts.push(
    `<p class="action-hint">Handoff after Stage 3 Accept + decision <strong>pursue</strong>. Fills <code>prompts/claude-site-config.md</code> from the approved package, then writes <code>src/config/site-config.json</code>.</p>`,
  );

  if (!f.hasNarrative) {
    parts.push(
      `<div class="callout warn">Accept Stage 3 narrative first (creates <code>*-approved.json</code>).</div>`,
    );
  } else if (!f.hasApproved) {
    parts.push(
      `<div class="callout warn">Narrative accepted but no approved package — re-Accept the draft (or paste + Accept) to generate it.</div>`,
    );
  } else if (decision !== 'pursue') {
    parts.push(
      `<div class="callout warn">Decision is <code>${esc(decision || 'unset')}</code> — set <strong>pursue</strong> on Overview before site-config (or use allow non-pursue in advanced).</div>`,
    );
  } else {
    parts.push(
      `<div class="callout">Ready · approved package${pack?.niche ? ` · ${esc(pack.niche)}` : ''}${
        pack?.city ? ` · ${esc(pack.city)}` : ''
      }</div>`,
    );
  }

  parts.push(`
    <h3>Website type</h3>
    <div class="site-config-nap">
      <label title="Type A = services grid · Type B = single-offer specialty homepage">Type
        <select id="sc-archetype">
          <option value="multi_service"${(nap.siteArchetype || accepted?.siteArchetype || 'multi_service') === 'multi_service' ? ' selected' : ''}>Type A — Multi-service local</option>
          <option value="single_service"${(nap.siteArchetype || accepted?.siteArchetype) === 'single_service' ? ' selected' : ''}>Type B — Single-offer specialty</option>
        </select>
      </label>
      <p class="muted" style="grid-column:1/-1">Type A shows a services grid. Type B uses a deep offer/process homepage (egress-style niches).</p>
    </div>
    <h3>Operator NAP / domain</h3>
    <p class="disc-tool-blurb">Used in the Claude prompt and merged into the draft when fields are still placeholders.</p>
    <div class="site-config-nap">
      <label title="Public domain without https://">Domain <input id="sc-domain" type="text" value="${esc(nap.domain || '')}" placeholder="example.com" /></label>
      <label title="Customer-facing brand name">Business name <input id="sc-business" type="text" value="${esc(nap.businessName || '')}" placeholder="Brand LLC" /></label>
      <label title="E.164 phone for click-to-call">Phone <input id="sc-phone" type="text" value="${esc(nap.phone || '')}" placeholder="+1XXXXXXXXXX" /></label>
      <label title="Lead inbox email">Email <input id="sc-email" type="email" value="${esc(nap.email || '')}" placeholder="leads@example.com" /></label>
      <label title="Service radius in miles">Radius (mi) <input id="sc-radius" type="text" value="${esc(nap.radiusMiles || '40')}" /></label>
      <label class="muted" style="justify-content:flex-end" title="Allow site-config when decision is not pursue"><span><input id="sc-allow-non-pursue" type="checkbox" /> Allow non-pursue</span></label>
    </div>
    <div class="narrative-actions">
      <button type="button" class="btn primary" id="sc-copy-prompt" title="Copy filled Claude site-config prompt (includes approved package)" ${ready || f.hasApproved ? '' : 'disabled'}>Copy site-config prompt</button>
      <button type="button" class="btn" id="sc-open-approved" title="Show approved candidate JSON" ${f.hasApproved ? '' : 'disabled'}>Show approved JSON</button>
      <button type="button" class="btn" id="sc-save-archetype" title="Save website type on candidate + draft" ${f.hasApproved || draft || accepted ? '' : 'disabled'}>Save type</button>
    </div>
  `);

  parts.push(`
    <div class="narrative-paste">
      <h3>${draft ? 'Replace site-config draft' : 'Paste site-config JSON'}</h3>
      <p class="muted">Paste Claude’s site-config object (one JSON object; trailing commentary is ignored), then Load draft. Missing fields get TBD placeholders you can edit below.</p>
      <textarea id="site-config-paste" class="narrative-paste-input" rows="10" placeholder='{ "businessName": "...", "targetSuburbs": [...] }' title="Paste Claude site-config JSON"></textarea>
      <div class="narrative-actions">
        <button type="button" class="btn primary" id="site-config-paste-btn" title="Load paste as research/{id}-site-config.draft.json" ${
          f.hasApproved ? '' : 'disabled'
        }>Load as draft</button>
        <button type="button" class="btn" id="site-config-accept-btn" title="Accept draft = write src/config/site-config.json" ${
          draft ? '' : 'disabled'
        }>Accept site-config</button>
      </div>
      <p class="disc-tool-blurb"><strong>Accept site-config</strong> is the accept step — it writes <code>src/config/site-config.json</code> (backs up the previous file).</p>
    </div>
  `);

  if (draft?._ops?.suburbCheck?.warnings?.length) {
    parts.push(
      `<div class="callout warn">Suburb warnings: ${esc(draft._ops.suburbCheck.warnings.join('; '))}</div>`,
    );
  }

  const ph = draft?._ops?.placeholders || [];
  if (draft && ph.length) {
    parts.push(
      `<div class="callout warn">Placeholders still set: <code>${esc(ph.join(', '))}</code> — fill via Edit draft before Accept (or Accept with placeholders for an early build).</div>`,
    );
  } else if (draft) {
    parts.push(`<div class="callout">Draft looks complete (no TBD placeholders).</div>`);
  }

  if (draft) {
    const brand = draft.brand || {};
    const suburbsText = Array.isArray(draft.targetSuburbs) ? draft.targetSuburbs.join('; ') : '';
    const servicesText = Array.isArray(draft.services) ? draft.services.join('; ') : '';
    const commercialText = Array.isArray(draft.commercialServices)
      ? draft.commercialServices.join('; ')
      : '';
    parts.push(`
      <h3>Edit draft</h3>
      <p class="muted">Save small NAP / copy fixes without re-pasting Claude JSON.</p>
      <div class="site-config-nap" id="sc-draft-edit">
        <label>Business name <input id="sc-edit-businessName" type="text" value="${esc(draft.businessName || '')}" /></label>
        <label>Domain <input id="sc-edit-domain" type="text" value="${esc(draft.domain || '')}" /></label>
        <label>Phone <input id="sc-edit-phone" type="text" value="${esc(draft.phone || '')}" /></label>
        <label>Email <input id="sc-edit-email" type="email" value="${esc(draft.email || '')}" /></label>
        <label>Tagline <input id="sc-edit-tagline" type="text" value="${esc(draft.tagline || '')}" /></label>
        <label>Primary CTA <input id="sc-edit-primaryCta" type="text" value="${esc(draft.primaryCta || '')}" /></label>
        <label>Niche <input id="sc-edit-niche" type="text" value="${esc(draft.niche || '')}" /></label>
        <label>Primary city <input id="sc-edit-primaryCity" type="text" value="${esc(draft.primaryCity || '')}" /></label>
        <label>State <input id="sc-edit-state" type="text" value="${esc(draft.state || '')}" maxlength="2" /></label>
        <label>Radius (mi) <input id="sc-edit-radius" type="text" value="${esc(String(draft.serviceRadiusMiles ?? ''))}" /></label>
        <label>Web3Forms key <input id="sc-edit-web3" type="text" value="${esc(draft.web3FormsAccessKey || '')}" /></label>
        <label>Brand primary <input id="sc-edit-brand-primary" type="text" value="${esc(brand.primary || '')}" placeholder="#1C2B3A" /></label>
        <label>Brand accent <input id="sc-edit-brand-accent" type="text" value="${esc(brand.accent || '')}" placeholder="#E8A317" /></label>
        <label>Brand ink <input id="sc-edit-brand-ink" type="text" value="${esc(brand.ink || '')}" placeholder="#0F1720" /></label>
        <label class="site-config-span2">Target suburbs <input id="sc-edit-suburbs" type="text" value="${esc(suburbsText)}" placeholder="City A; City B" /></label>
        <label class="site-config-span2">Services (residential, up to 12) <input id="sc-edit-services" type="text" value="${esc(servicesText)}" placeholder="Service A; Service B" /></label>
        <label class="site-config-span2">Commercial services (optional) <input id="sc-edit-commercial" type="text" value="${esc(commercialText)}" placeholder="Commercial A; Commercial B" /></label>
        <label>Homepage services limit <input id="sc-edit-svc-limit" type="number" min="1" max="12" value="${esc(String(draft.homepageServicesLimit ?? 12))}" title="Max cards per section (1–12)" /></label>
      </div>
      <div class="narrative-actions">
        <button type="button" class="btn primary" id="site-config-save-draft-btn" title="Save Edit draft fields into research/{id}-site-config.draft.json">Save draft</button>
      </div>
      <details class="narrative-raw"><summary>Raw draft JSON</summary>
        <div class="json-block">${esc(JSON.stringify(draft, null, 2))}</div>
      </details>
    `);
  }
  if (accepted) {
    parts.push('<h3>Last accepted (research copy)</h3>');
    parts.push(`<div class="json-block">${esc(JSON.stringify(accepted, null, 2))}</div>`);
  }
  if (pack) {
    parts.push(`<details class="narrative-raw"><summary>Approved package</summary>
      <div class="json-block">${esc(JSON.stringify(pack, null, 2))}</div>
    </details>`);
  }
  return parts.join('');
}

function contentStepHtml({ id, num, title, done, open, tip, bodyHtml }) {
  return `<section class="content-step${done ? ' done' : ''}${open ? ' open' : ''}" data-content-step="${esc(id)}">
    <button type="button" class="content-step-head" data-content-toggle="${esc(id)}" title="${esc(tip || '')}">
      <span class="disc-step-mark" aria-hidden="true"></span>
      <span class="content-step-label">${esc(String(num))} · ${esc(title)}</span>
    </button>
    <div class="content-step-body">${bodyHtml}</div>
  </section>`;
}

/** Numbered action row: n · label + optional controls */
function contentActionRow({ n, label, hint, controlsHtml = '' }) {
  return `<div class="content-action-row">
    <div class="content-action-meta">
      <span class="content-action-num">${esc(String(n))}</span>
      <div>
        <div class="content-action-label">${label}</div>
        ${hint ? `<p class="disc-tool-blurb">${hint}</p>` : ''}
      </div>
    </div>
    ${controlsHtml ? `<div class="content-action-controls">${controlsHtml}</div>` : ''}
  </div>`;
}

function firstIncompleteContentStep(flags) {
  if (!flags.research) return 'researcher';
  if (!flags.outline) return 'outline';
  if (!flags.writer) return 'writer';
  if (!flags.accepted) return 'editor';
  if (!flags.builder) return 'builder';
  return 'builder';
}

function contentUpNextHtml(stepDone, ready) {
  if (!ready) {
    return `<div class="callout warn">Up next: Accept <strong>Site config</strong> first.</div>`;
  }
  if (!stepDone.research) {
    return `<div class="callout">Up next: <strong>Step 1 · Researcher</strong> — Copy prompt → paste JSON → Save research.</div>`;
  }
  if (!stepDone.outline) {
    return `<div class="callout">Up next: <strong>Step 2 · Outline</strong> — Seed default, or Copy prompt → paste → Save.</div>`;
  }
  if (!stepDone.writer) {
    return `<div class="callout">Up next: <strong>Step 3 · Writer</strong> — Load FILE blocks or Import from src/content.</div>`;
  }
  if (!stepDone.accepted) {
    return `<div class="callout">Up next: <strong>Step 4 · Accept content</strong> — writes shared <code>src/content/</code>.</div>`;
  }
  if (!stepDone.builder) {
    return `<div class="callout">Up next: <strong>Step 5 · Stage homepage</strong> (also refreshes the build package).</div>`;
  }
  return `<div class="callout">Up next: <strong>Assemble checklist</strong> · optional <code>npm run build</code> / <code>astro dev</code>.</div>`;
}

function renderContent() {
  const d = state.detail;
  const f = d?.stageFlags || {};
  const draft = d?.contentDraft;
  const accepted = d?.content;
  const outline = d?.contentOutline;
  const research = d?.contentResearch;
  const pack = d?.buildPackage;
  const ready = Boolean(f.hasSiteConfig);
  const arch =
    d?.siteConfig?.siteArchetype ||
    d?.meta?.siteArchetype ||
    siteConfigNapFromLocal().siteArchetype ||
    'multi_service';
  const check = draft?._ops?.check || accepted?._ops?.check;
  const contract = draft?._ops?.contract || pack?.contract;
  const fileList = (() => {
    if (draft?._ops?.fileList?.length) return draft._ops.fileList;
    if (draft?.files) return Object.keys(draft.files).sort();
    if (accepted?._ops?.fileList?.length) return accepted._ops.fileList;
    if (accepted?._ops?.written?.length) return accepted._ops.written;
    if (accepted?.files) return Object.keys(accepted.files).sort();
    return [];
  })();
  const stagedAt = d?.meta?.lastSiteStagingAt || null;
  const stagingPath = d?.meta?.siteStagingPath || null;
  const stepDone = {
    research: Boolean(research) || Boolean(f.hasContentResearch),
    outline: Boolean(outline) || Boolean(f.hasContentOutline),
    writer: Boolean(draft?.files) || Boolean(accepted?.files) || Boolean(f.hasContentDraft) || Boolean(f.hasContent),
    accepted: Boolean(accepted) || Boolean(f.hasContent),
    builder: Boolean(pack || f.hasBuildPackage || stagedAt || stagingPath),
  };
  const defaultOpen = firstIncompleteContentStep(stepDone);
  if (state.contentOpenStep == null) state.contentOpenStep = defaultOpen;
  const openId = state.contentOpenStep;
  const hasMarkdown = Boolean(draft || accepted);
  const parts = [];

  parts.push(
    `<p class="action-hint">Agentic flow: <strong>Researcher → Outline → Writer → Accept → Stage</strong>. Drafts in <code>research/{id}-*</code>; Accept writes shared <code>src/content/</code>; Stage copies into <code>research/{id}/site-staging/</code>.</p>`,
  );
  parts.push(contentUpNextHtml(stepDone, ready));

  if (!ready) {
    parts.push(
      `<div class="callout warn">Accept <strong>Site config</strong> first (set Website type A/B there).</div>`,
    );
  } else {
    parts.push(
      `<div class="callout">Website type: <strong>${esc(
        arch === 'single_service' ? 'Type B — single-offer' : 'Type A — multi-service',
      )}</strong>${stepDone.outline ? ' · outline ready' : ''}${
        stepDone.accepted ? ' · content accepted' : stepDone.writer ? ' · draft ready' : ''
      }${stagedAt ? ' · staged' : ''}</div>`,
    );
  }

  parts.push(
    contentStepHtml({
      id: 'researcher',
      num: 1,
      title: 'Researcher',
      done: stepDone.research,
      open: openId === 'researcher',
      tip: '1 Copy → 2 Paste → 3 Save research',
      bodyHtml: `
        <p class="disc-tool-blurb">Gathers angles and claims for the outline. Does not write site markdown.</p>
        ${contentActionRow({
          n: 1,
          label: 'Copy researcher prompt',
          hint: 'Run in Claude, then return with JSON.',
          controlsHtml: `<button type="button" class="btn" id="ca-copy-researcher" title="Copy researcher prompt for Claude" ${ready ? '' : 'disabled'}>Copy prompt</button>`,
        })}
        ${contentActionRow({
          n: 2,
          label: 'Paste researcher JSON',
          hint: 'Paste Claude’s research pack below.',
          controlsHtml: `<textarea id="ca-research-paste" class="narrative-paste-input" rows="4" placeholder="Paste researcher JSON" title="Paste Claude researcher JSON"></textarea>`,
        })}
        ${contentActionRow({
          n: 3,
          label: 'Save research pack',
          hint: 'Writes <code>research/{id}-content-research.json</code>.',
          controlsHtml: `<button type="button" class="btn primary" id="ca-paste-researcher" title="Save research pack for this candidate" ${ready ? '' : 'disabled'}>Save research</button>`,
        })}
        ${research ? `<p class="muted">Saved${research._ops?.savedAt ? ` · ${esc(research._ops.savedAt)}` : ''}</p>` : ''}`,
    }),
  );

  parts.push(
    contentStepHtml({
      id: 'outline',
      num: 2,
      title: 'Outline',
      done: stepDone.outline,
      open: openId === 'outline',
      tip: 'Seed shortcut, or Copy → Paste → Save',
      bodyHtml: `
        <p class="disc-tool-blurb">Homepage section plan. Pick <strong>one</strong> path.</p>
        ${contentActionRow({
          n: 'A',
          label: 'Seed default outline (shortcut)',
          hint: 'Uses the archetype template — skip Claude if this is enough.',
          controlsHtml: `<button type="button" class="btn primary" id="ca-seed-outline" title="Seed default outline from archetype template" ${ready ? '' : 'disabled'}>Seed default outline</button>`,
        })}
        <p class="content-or">or</p>
        ${contentActionRow({
          n: 1,
          label: 'Copy outline prompt',
          hint: 'Ask Claude for outline JSON.',
          controlsHtml: `<button type="button" class="btn" id="ca-copy-outline" title="Copy outline prompt for Claude" ${ready ? '' : 'disabled'}>Copy prompt</button>`,
        })}
        ${contentActionRow({
          n: 2,
          label: 'Paste outline JSON',
          controlsHtml: `<textarea id="ca-outline-paste" class="narrative-paste-input" rows="4" placeholder="Paste outline JSON" title="Paste outline JSON"></textarea>`,
        })}
        ${contentActionRow({
          n: 3,
          label: 'Save outline',
          controlsHtml: `<button type="button" class="btn" id="ca-paste-outline" title="Save outline for this candidate" ${ready ? '' : 'disabled'}>Save outline</button>`,
        })}
        ${outline ? `<details class="narrative-raw"><summary>Current outline</summary><div class="json-block">${esc(JSON.stringify(outline, null, 2))}</div></details>` : ''}`,
    }),
  );

  parts.push(
    contentStepHtml({
      id: 'writer',
      num: 3,
      title: 'Writer (homepage-first)',
      done: stepDone.writer,
      open: openId === 'writer',
      tip: 'Paste FILE blocks, or Import from disk',
      bodyHtml: `
        <p class="disc-tool-blurb">Loads candidate draft <code>research/{id}-content.draft.json</code> — not Accept. Pick <strong>one</strong> path.</p>
        ${contentActionRow({
          n: 1,
          label: 'Copy writer prompt',
          hint: 'Claude.ai: return <code>### FILE:</code> blocks. Claude Code: write three pages or output FILE blocks.',
          controlsHtml: `<button type="button" class="btn" id="ca-copy-writer" title="Copy writer prompt" ${outline ? '' : 'disabled'}>Copy prompt</button>`,
        })}
        ${contentActionRow({
          n: 2,
          label: 'Paste FILE blocks',
          controlsHtml: `<textarea id="ca-writer-paste" class="narrative-paste-input" rows="8" placeholder="### FILE: src/content/pages/index.md&#10;---&#10;..." title="Paste ### FILE: markdown blocks"></textarea>`,
        })}
        ${contentActionRow({
          n: 3,
          label: 'Load FILE blocks as draft',
          hint: 'Primary path for chat paste.',
          controlsHtml: `<button type="button" class="btn primary" id="ca-paste-writer" title="Parse FILE blocks into candidate draft" ${ready ? '' : 'disabled'}>Load FILE blocks as draft</button>`,
        })}
        <p class="content-or">or</p>
        ${contentActionRow({
          n: 'B',
          label: 'Import from src/content',
          hint: 'After Claude Code wrote index/about/contact on disk — rehydrates the candidate draft.',
          controlsHtml: `<button type="button" class="btn" id="ca-import-disk" title="Import index/about/contact from live src/content into candidate draft" ${ready ? '' : 'disabled'}>Import from src/content</button>`,
        })}`,
    }),
  );

  parts.push(
    contentStepHtml({
      id: 'editor',
      num: 4,
      title: 'Editor + Accept',
      done: stepDone.accepted,
      open: openId === 'editor',
      tip: 'Optional edit, then Accept content',
      bodyHtml: `
        <p class="disc-tool-blurb">Optional polish, then Accept. Accept writes shared <code>src/content/</code> and is required before Stage.</p>
        ${contentActionRow({
          n: 1,
          label: 'Copy editor prompt (optional)',
          hint: 'Paste revised ### FILE: blocks back into Writer (step 3) and Load again.',
          controlsHtml: `<button type="button" class="btn" id="ca-copy-editor" title="Copy editor prompt with current draft FILE blocks" ${draft ? '' : 'disabled'}>Copy editor prompt</button>`,
        })}
        ${contentActionRow({
          n: 2,
          label: 'Accept content',
          hint: 'Writes draft → <code>src/content/</code> (backs up previous). Then go to Step 5.',
          controlsHtml: `<button type="button" class="btn primary" id="content-accept-btn" title="Accept draft — write files into src/content/" ${draft ? '' : 'disabled'}>Accept content (write src/content/)</button>`,
        })}
        ${fileList.length ? `<p class="muted">Files: ${fileList.map((p) => `<code>${esc(p)}</code>`).join(' · ')}</p>` : ''}
        ${check?.errors?.length ? `<div class="callout warn"><strong>Errors:</strong> ${esc(check.errors.join('; '))}</div>` : ''}
        ${
          check?.warnings?.length || contract?.warnings?.length
            ? `<div class="callout warn"><strong>Warnings:</strong> ${esc(
                [...(check?.warnings || []), ...(contract?.warnings || [])].join('; '),
              )}</div>`
            : ''
        }
        ${
          accepted?._ops
            ? `<p class="muted">Last accept: ${esc(String(accepted._ops.written?.length || 0))} files · pruned ${esc(
                String(accepted._ops.pruned?.length || 0),
              )}</p>`
            : ''
        }`,
    }),
  );

  parts.push(
    contentStepHtml({
      id: 'builder',
      num: 5,
      title: 'Website builder',
      done: stepDone.builder,
      open: openId === 'builder',
      tip: '1 Stage → 2 Checklist → 3 optional Build package',
      bodyHtml: `
        <p class="disc-tool-blurb"><strong>Stage homepage</strong> is the next step after Accept. It copies into <code>research/{id}/site-staging/</code> and also refreshes the build package. Then <strong>Assemble site</strong> writes a sibling folder for GitHub/CF Pages.</p>
        ${contentActionRow({
          n: 1,
          label: 'Stage homepage',
          hint: 'Primary next action. Stages the candidate, starts Astro if needed, opens preview.',
          controlsHtml: `<button type="button" class="btn primary" id="ca-stage" title="Stage homepage and open Astro preview" ${hasMarkdown ? '' : 'disabled'}>Stage homepage</button>
          <button type="button" class="btn" id="ca-open-preview" title="Open http://127.0.0.1:4321/ (starts Astro if needed)">Open preview</button>`,
        })}
        ${contentActionRow({
          n: 2,
          label: 'Assemble site',
          hint: 'Copy template → inject staging → sibling site folder. Then checklist / CF Pages.',
          controlsHtml: `<button type="button" class="btn" id="ca-assemble" title="Assemble site folder from staging" ${stagedAt ? '' : 'disabled'}>Assemble site</button>
          <button type="button" class="btn" id="ca-checklist" title="Show assemble / deploy checklist">Assemble checklist</button>`,
        })}
        ${contentActionRow({
          n: 3,
          label: 'Build package JSON (advanced)',
          hint: 'Optional if you already Staged — Stage refreshes the package automatically.',
          controlsHtml: `<button type="button" class="btn" id="ca-build-package" title="Build package JSON for this candidate" ${hasMarkdown ? '' : 'disabled'}>Build package JSON</button>`,
        })}
        ${
          stagedAt
            ? `<div class="callout">Staged${stagingPath ? ` · <code>${esc(stagingPath)}</code>` : ''} · ${esc(stagedAt)}. Open checklist or run <code>npm run build</code>.</div>`
            : ''
        }
        ${
          pack
            ? `<details class="narrative-raw"><summary>Build package</summary><div class="json-block">${esc(
                JSON.stringify(pack, null, 2),
              )}</div></details>`
            : ''
        }`,
    }),
  );

  parts.push(`
    <details class="narrative-raw content-legacy">
      <summary>Legacy one-shot markdown prompt</summary>
      <p class="disc-tool-blurb">Optional full-suite paste. Prefer steps 1–4 above.</p>
      <div class="narrative-actions">
        <button type="button" class="btn" id="content-copy-prompt" title="Copy full one-shot markdown prompt" ${ready ? '' : 'disabled'}>Copy full markdown prompt</button>
      </div>
      <textarea id="content-paste" class="narrative-paste-input" rows="6" placeholder="Optional: paste full ### FILE suite"></textarea>
      <div class="narrative-actions">
        <button type="button" class="btn" id="content-paste-btn" title="Load legacy FILE suite as draft" ${ready ? '' : 'disabled'}>Load as draft</button>
      </div>
    </details>
  `);

  return parts.join('');
}

function wireContentTab(d) {
  if (!d) return;
  const id = d.id;
  const refresh = async (candidate, nextStep) => {
    if (nextStep) state.contentOpenStep = nextStep;
    state.detail = candidate || (await api(`/api/candidates/${encodeURIComponent(id)}`));
    state.tab = 'content';
    renderDetail();
  };
  const copyPrompt = (path, title) => async () => {
    try {
      const data = await api(path);
      await navigator.clipboard.writeText(data.prompt || '');
      await showModal({
        title: title || 'Copied',
        confirmLabel: 'OK',
        bodyHtml: '<p>Prompt is on your clipboard.</p>',
      });
    } catch (error) {
      await showModal({
        title: 'Copy failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  };

  document.querySelectorAll('[data-content-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const step = btn.getAttribute('data-content-toggle');
      state.contentOpenStep = state.contentOpenStep === step ? null : step;
      renderDetail();
    });
  });

  document
    .getElementById('ca-copy-researcher')
    ?.addEventListener(
      'click',
      copyPrompt(`/api/candidates/${encodeURIComponent(id)}/content/researcher/prompt`, 'Researcher prompt'),
    );
  document.getElementById('ca-paste-researcher')?.addEventListener('click', async () => {
    try {
      const text = document.getElementById('ca-research-paste')?.value || '';
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/content/researcher/paste`, {
        method: 'POST',
        body: JSON.stringify({ json: text }),
      });
      await refresh(result.candidate, 'outline');
    } catch (error) {
      await showModal({ title: 'Paste failed', confirmLabel: 'OK', bodyHtml: `<p>${esc(error.message)}</p>` });
    }
  });
  document.getElementById('ca-seed-outline')?.addEventListener('click', async () => {
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/content/outline/seed`, {
        method: 'POST',
        body: '{}',
      });
      await refresh(result.candidate, 'writer');
    } catch (error) {
      await showModal({ title: 'Seed failed', confirmLabel: 'OK', bodyHtml: `<p>${esc(error.message)}</p>` });
    }
  });
  document
    .getElementById('ca-copy-outline')
    ?.addEventListener(
      'click',
      copyPrompt(`/api/candidates/${encodeURIComponent(id)}/content/outline/prompt`, 'Outline prompt'),
    );
  document.getElementById('ca-paste-outline')?.addEventListener('click', async () => {
    try {
      const text = document.getElementById('ca-outline-paste')?.value || '';
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/content/outline/paste`, {
        method: 'POST',
        body: JSON.stringify({ json: text }),
      });
      await refresh(result.candidate, 'writer');
    } catch (error) {
      await showModal({ title: 'Paste failed', confirmLabel: 'OK', bodyHtml: `<p>${esc(error.message)}</p>` });
    }
  });
  document
    .getElementById('ca-copy-writer')
    ?.addEventListener(
      'click',
      copyPrompt(`/api/candidates/${encodeURIComponent(id)}/content/writer/prompt`, 'Writer prompt'),
    );
  document
    .getElementById('ca-copy-editor')
    ?.addEventListener(
      'click',
      copyPrompt(`/api/candidates/${encodeURIComponent(id)}/content/editor/prompt`, 'Editor prompt'),
    );
  document.getElementById('ca-paste-writer')?.addEventListener('click', async () => {
    try {
      const text = document.getElementById('ca-writer-paste')?.value || '';
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/content/agent-paste`, {
        method: 'POST',
        body: JSON.stringify({ text, mode: 'homepage_first' }),
      });
      await refresh(result.candidate, 'editor');
      const msgs = [...(result.check?.errors || []), ...(result.check?.warnings || [])];
      if (msgs.length) {
        await showModal({
          title: 'Draft loaded',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(msgs.join('; '))}</p>`,
        });
      }
    } catch (error) {
      await showModal({ title: 'Paste failed', confirmLabel: 'OK', bodyHtml: `<p>${esc(error.message)}</p>` });
    }
  });
  document.getElementById('ca-import-disk')?.addEventListener('click', async () => {
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/content/import-disk`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'homepage_first' }),
      });
      await refresh(result.candidate, 'editor');
      const msgs = [...(result.check?.errors || []), ...(result.check?.warnings || [])];
      await showModal({
        title: 'Imported to candidate draft',
        confirmLabel: 'OK',
        bodyHtml: `<p>Loaded from <code>src/content/pages/</code> into <code>research/${esc(
          id,
        )}-content.draft.json</code>. Accept when ready.</p>${
          msgs.length ? `<p class="muted">${esc(msgs.join('; '))}</p>` : ''
        }`,
      });
    } catch (error) {
      await showModal({
        title: 'Import failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });
  document.getElementById('ca-build-package')?.addEventListener('click', async () => {
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/build-package`, {
        method: 'POST',
        body: '{}',
      });
      await refresh(result.candidate, 'builder');
      await showModal({
        title: 'Build package',
        confirmLabel: 'OK',
        bodyHtml: `<p>Wrote <code>*-build-package.json</code> · archetype <code>${esc(
          result.package?.siteArchetype || '',
        )}</code></p>`,
      });
    } catch (error) {
      await showModal({ title: 'Failed', confirmLabel: 'OK', bodyHtml: `<p>${esc(error.message)}</p>` });
    }
  });
  document.getElementById('ca-stage')?.addEventListener('click', async () => {
    const previewUrlDefault = 'http://127.0.0.1:4321/';
    // No noopener — we need the Window handle to navigate once Astro is ready
    let previewTab = null;
    try {
      previewTab = window.open(previewUrlDefault, '_blank');
    } catch {
      previewTab = null;
    }
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/staging`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'homepage_first', openPreview: true }),
      });
      await refresh(result.candidate, 'builder');
      const previewUrl = result.previewUrl || result.preview?.url || previewUrlDefault;
      const previewOk = Boolean(result.preview?.ok);
      if (previewOk) {
        try {
          if (previewTab && !previewTab.closed) {
            previewTab.location.replace(previewUrl);
            previewTab.focus?.();
          } else {
            window.open(previewUrl, '_blank');
          }
        } catch {
          window.open(previewUrl, '_blank');
        }
      }
      const previewNote = previewOk
        ? `<p>Preview: <a href="${esc(previewUrl)}" target="_blank" rel="noopener">${esc(previewUrl)}</a>${
            result.preview?.started ? ' (started Astro dev)' : ''
          }. If the tab is empty, refresh it once.</p>
           <p class="muted">Shows accepted live <code>src/content/</code> + site-config.</p>`
        : `<p class="muted">Could not start preview${
            result.preview?.error ? `: ${esc(result.preview.error)}` : ''
          }. Click <strong>Open preview</strong> or run <code>astro dev --background</code>, then open <a href="${esc(previewUrl)}" target="_blank" rel="noopener">${esc(previewUrl)}</a>.</p>`;
      await showModal({
        title: 'Staged',
        confirmLabel: 'OK',
        bodyHtml: `<p>Staged to <code>${esc(result.stagingPath)}</code> (${esc(
          String(result.written?.length || 0),
        )} files). Build package refreshed.</p>
        ${previewNote}
        <p class="muted">Next: <strong>Assemble checklist</strong>.</p>`,
      });
    } catch (error) {
      await showModal({ title: 'Staging failed', confirmLabel: 'OK', bodyHtml: `<p>${esc(error.message)}</p>` });
    }
  });
  document.getElementById('ca-open-preview')?.addEventListener('click', async () => {
    const previewUrlDefault = 'http://127.0.0.1:4321/';
    let previewTab = null;
    try {
      previewTab = window.open(previewUrlDefault, '_blank');
    } catch {
      previewTab = null;
    }
    try {
      const preview = await api('/api/preview/ensure', { method: 'POST', body: '{}' });
      const url = preview.url || previewUrlDefault;
      if (preview.ok) {
        try {
          if (previewTab && !previewTab.closed) {
            previewTab.location.replace(url);
            previewTab.focus?.();
          } else {
            window.open(url, '_blank');
          }
        } catch {
          window.open(url, '_blank');
        }
      }
      await showModal({
        title: preview.ok ? 'Preview ready' : 'Preview not ready',
        confirmLabel: 'OK',
        bodyHtml: preview.ok
          ? `<p>Opened <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>${
              preview.started ? ' (started Astro dev)' : ''
            }. Refresh the tab if it loaded before the server was up.</p>`
          : `<p>${esc(preview.error || 'Could not start Astro')}</p>
             <p class="muted">Run <code>astro dev --background</code> in the repo, then open <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>.</p>`,
      });
    } catch (error) {
      await showModal({ title: 'Preview failed', confirmLabel: 'OK', bodyHtml: `<p>${esc(error.message)}</p>` });
    }
  });
  document.getElementById('ca-checklist')?.addEventListener('click', async () => {
    try {
      const data = await api(`/api/candidates/${encodeURIComponent(id)}/assemble/checklist`);
      const list = (data.steps || [])
        .map((s) => {
          const detail = s.detail ? ` <span class="muted">— ${esc(s.detail)}</span>` : '';
          return `<li>${s.done ? '✓' : '○'} ${esc(s.label)}${detail}</li>`;
        })
        .join('');
      const remoteHint = data.templateRemote?.url
        ? `<p class="muted">Template remote: <code>${esc(data.templateRemote.nameWithOwner || data.templateRemote.url)}</code></p>`
        : `<p class="muted">No GitHub remote yet — assemble still works via local copy. See <code>docs/ASSEMBLE-AND-LAUNCH.md</code>.</p>`;
      await showModal({
        title: 'Assemble checklist',
        confirmLabel: 'OK',
        bodyHtml: `<ul class="narrative-list">${list}</ul>${remoteHint}`,
      });
    } catch (error) {
      await showModal({ title: 'Failed', confirmLabel: 'OK', bodyHtml: `<p>${esc(error.message)}</p>` });
    }
  });

  document.getElementById('ca-assemble')?.addEventListener('click', async () => {
    const btn = document.getElementById('ca-assemble');
    if (btn) btn.disabled = true;
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/assemble`, {
        method: 'POST',
        body: JSON.stringify({ force: true }),
      });
      state.detail = result.candidate || (await api(`/api/candidates/${encodeURIComponent(id)}`));
      state.tab = 'content';
      renderDetail();
      const next = (result.nextSteps || []).map((s) => `<li><code>${esc(s)}</code></li>`).join('');
      await showModal({
        title: 'Site assembled',
        confirmLabel: 'OK',
        bodyHtml: `<p>Wrote <code>${esc(result.absoluteSiteRoot || result.siteRoot)}</code></p>
          <ul class="narrative-list">${next}</ul>
          <p class="muted">Checklist + Cloudflare steps: <code>docs/ASSEMBLE-AND-LAUNCH.md</code></p>`,
      });
    } catch (error) {
      await showModal({
        title: 'Assemble failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  const copyBtn = document.getElementById('content-copy-prompt');
  if (copyBtn) {
    copyBtn.addEventListener(
      'click',
      copyPrompt(`/api/candidates/${encodeURIComponent(id)}/content/prompt`, 'Content prompt'),
    );
  }
  const pasteBtn = document.getElementById('content-paste-btn');
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      const text = document.getElementById('content-paste')?.value || '';
      if (!text.trim()) {
        await showModal({
          title: 'Nothing to paste',
          confirmLabel: 'OK',
          bodyHtml: '<p>Paste Claude’s ### FILE blocks first.</p>',
        });
        return;
      }
      pasteBtn.disabled = true;
      try {
        const result = await api(`/api/candidates/${encodeURIComponent(id)}/content/paste`, {
          method: 'POST',
          body: JSON.stringify({ text }),
        });
        await refresh(result.candidate, 'editor');
      } catch (error) {
        await showModal({
          title: 'Paste failed',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
        pasteBtn.disabled = false;
      }
    });
  }
  const acceptBtn = document.getElementById('content-accept-btn');
  if (acceptBtn) {
    acceptBtn.addEventListener('click', async () => {
      const ok = await showModal({
        title: 'Accept content?',
        confirmLabel: 'Write src/content/',
        bodyHtml:
          '<p>Accepts the candidate draft into shared <code>src/content/</code> (backs up existing Markdown, prunes leftovers not in the bundle).</p>',
      });
      if (!ok) return;
      acceptBtn.disabled = true;
      try {
        let result;
        try {
          result = await api(`/api/candidates/${encodeURIComponent(id)}/content/accept`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
        } catch (error) {
          if (error.message?.includes('ignoreWarnings') || error.check?.warnings?.length) {
            const force = await showModal({
              title: 'Content warnings',
              confirmLabel: 'Write anyway',
              bodyHtml: `<p>${esc(error.message)}</p>`,
            });
            if (!force) throw error;
            result = await api(`/api/candidates/${encodeURIComponent(id)}/content/accept`, {
              method: 'POST',
              body: JSON.stringify({ ignoreWarnings: true }),
            });
          } else {
            throw error;
          }
        }
        await refresh(result.candidate, 'builder');
        await showModal({
          title: 'Content accepted',
          confirmLabel: 'OK',
          bodyHtml: `<p>Wrote <strong>${esc(String(result.written?.length || 0))}</strong> file(s) to <code>src/content/</code>.</p>
          <p><strong>Up next:</strong> open Step 5 and click <strong>Stage homepage</strong>.</p>`,
        });
      } catch (error) {
        await showModal({
          title: 'Accept failed',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
        acceptBtn.disabled = false;
      }
    });
  }
}

function renderProspects() {
  const p = state.detail.prospects;
  const parts = [];
  if (!p) {
    parts.push('<p class="muted">No prospects — save decision pursue (optional), then Run Stage 4 (orange group).</p>');
  } else {
    parts.push(`
      <div class="stat-grid">
        ${statCard('Prospects', `<span class="metric metric-neutral"><strong>${esc(p.prospectCount)}</strong></span>`)}
        ${statCard('High priority', `<span class="metric metric-good"><strong>${esc(p.summary?.highPriority)}</strong></span>`)}
        ${statCard('Running ads', `<span class="metric metric-neutral"><strong>${esc(p.summary?.runningAds)}</strong></span>`)}
        ${statCard('API cost', `<span class="metric metric-neutral"><strong>${esc(p.estimatedApiCostUsd)}</strong></span>`)}
      </div>
    `);
    const rows = (p.prospects || []).map((x) => [
      esc(x.outreachPriority),
      metricHtml({
        value: x.outreachScore,
        max: 10,
        label: 'Outreach score',
        extraTip: 'Higher = better outreach fit for Rank & Rent.',
      }),
      esc(x.name),
      esc(x.domain || '—'),
      esc(x.rating ?? '—'),
      esc(x.reviewsCount ?? '—'),
      esc(x.reviewBand),
      x.runningAds ? 'yes' : 'no',
      x.ownsMapPackSlot ? 'yes' : 'no',
      esc((x.reasons || []).join('; ')),
    ]);
    parts.push(
      tableHtml(
        [
          'Priority',
          thWithTip('Score', '1–10 outreach fit. Higher = better prospect for you.'),
          'Name',
          'Domain',
          'Rating',
          'Reviews',
          'Band',
          'Ads',
          'Map Pack',
          'Reasons',
        ].join(''),
        rows,
      ),
    );
  }
  if (state.detail._outreachDraft) {
    parts.push('<h3>Outreach draft (Claude)</h3>');
    parts.push(`<div class="json-block">${esc(JSON.stringify(state.detail._outreachDraft, null, 2))}</div>`);
  }
  return parts.join('');
}

function renderLogs() {
  return `<div class="log" id="job-log">${esc('(Run a job to stream logs here)')}</div>`;
}

function wireSiteConfigTab(d) {
  if (!d) return;
  const copyBtn = document.getElementById('sc-copy-prompt');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        const nap = saveSiteConfigNapFromForm();
        const allow = Boolean(document.getElementById('sc-allow-non-pursue')?.checked);
        const qs = new URLSearchParams({
          domain: nap.domain || '',
          businessName: nap.businessName || '',
          phone: nap.phone || '',
          email: nap.email || '',
          radiusMiles: nap.radiusMiles || '40',
          siteArchetype: nap.siteArchetype || 'multi_service',
        });
        if (allow) qs.set('allowNonPursue', '1');
        const data = await api(
          `/api/candidates/${encodeURIComponent(d.id)}/site-config/prompt?${qs}`,
        );
        await navigator.clipboard.writeText(data.prompt || '');
        await showModal({
          title: 'Copied',
          confirmLabel: 'OK',
          bodyHtml: '<p>Site-config Claude prompt is on your clipboard (includes approved package).</p>',
        });
      } catch (error) {
        await showModal({
          title: 'Copy failed',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
    });
  }
  const showPack = document.getElementById('sc-open-approved');
  if (showPack) {
    showPack.addEventListener('click', async () => {
      const pack = d.approved;
      if (!pack) return;
      await showModal({
        title: 'Approved package',
        confirmLabel: 'OK',
        bodyHtml: `<div class="json-block" style="max-height:50vh;overflow:auto">${esc(
          JSON.stringify(pack, null, 2),
        )}</div>`,
      });
    });
  }
  const saveArch = document.getElementById('sc-save-archetype');
  if (saveArch) {
    saveArch.addEventListener('click', async () => {
      try {
        const nap = saveSiteConfigNapFromForm();
        const result = await api(`/api/candidates/${encodeURIComponent(d.id)}/archetype`, {
          method: 'POST',
          body: JSON.stringify({ siteArchetype: nap.siteArchetype }),
        });
        state.detail = result.candidate || (await api(`/api/candidates/${encodeURIComponent(d.id)}`));
        renderDetail();
        await showModal({
          title: 'Website type saved',
          confirmLabel: 'OK',
          bodyHtml: `<p>Set to <code>${esc(result.siteArchetype)}</code>.</p>`,
        });
      } catch (error) {
        await showModal({
          title: 'Save failed',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
    });
  }
  const pasteBtn = document.getElementById('site-config-paste-btn');
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      const text = document.getElementById('site-config-paste')?.value || '';
      if (!text.trim()) {
        await showModal({
          title: 'Nothing to paste',
          confirmLabel: 'OK',
          bodyHtml: '<p>Paste site-config JSON first.</p>',
        });
        return;
      }
      pasteBtn.disabled = true;
      try {
        const nap = saveSiteConfigNapFromForm();
        const allow = Boolean(document.getElementById('sc-allow-non-pursue')?.checked);
        const result = await api(`/api/candidates/${encodeURIComponent(d.id)}/site-config/paste`, {
          method: 'POST',
          body: JSON.stringify({ json: text, ...nap, allowNonPursue: allow }),
        });
        state.detail = result.candidate || (await api(`/api/candidates/${encodeURIComponent(d.id)}`));
        state.tab = 'site-config';
        renderDetail();
        const notes = [];
        if (result.placeholders?.length) {
          notes.push(`Placeholders: ${result.placeholders.join(', ')}`);
        }
        if (result.suburbCheck?.warnings?.length) {
          notes.push(result.suburbCheck.warnings.join('; '));
        }
        if (notes.length) {
          await showModal({
            title: 'Draft saved',
            confirmLabel: 'OK',
            bodyHtml: `<p>${esc(notes.join(' · '))}</p><p class="muted">Edit draft fields below, then Save draft.</p>`,
          });
        }
      } catch (error) {
        await showModal({
          title: 'Paste failed',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
        pasteBtn.disabled = false;
      }
    });
  }

  const saveDraftBtn = document.getElementById('site-config-save-draft-btn');
  if (saveDraftBtn) {
    saveDraftBtn.addEventListener('click', async () => {
      saveDraftBtn.disabled = true;
      try {
        const nap = saveSiteConfigNapFromForm();
        const allow = Boolean(document.getElementById('sc-allow-non-pursue')?.checked);
        const patch = {
          businessName: document.getElementById('sc-edit-businessName')?.value?.trim() || '',
          domain: document.getElementById('sc-edit-domain')?.value?.trim() || '',
          phone: document.getElementById('sc-edit-phone')?.value?.trim() || '',
          email: document.getElementById('sc-edit-email')?.value?.trim() || '',
          tagline: document.getElementById('sc-edit-tagline')?.value?.trim() || '',
          primaryCta: document.getElementById('sc-edit-primaryCta')?.value?.trim() || '',
          niche: document.getElementById('sc-edit-niche')?.value?.trim() || '',
          primaryCity: document.getElementById('sc-edit-primaryCity')?.value?.trim() || '',
          state: document.getElementById('sc-edit-state')?.value?.trim() || '',
          serviceRadiusMiles: document.getElementById('sc-edit-radius')?.value?.trim() || '',
          web3FormsAccessKey: document.getElementById('sc-edit-web3')?.value?.trim() || '',
          targetSuburbs: document.getElementById('sc-edit-suburbs')?.value || '',
          services: document.getElementById('sc-edit-services')?.value || '',
          commercialServices: document.getElementById('sc-edit-commercial')?.value || '',
          homepageServicesLimit: document.getElementById('sc-edit-svc-limit')?.value || '12',
          brand: {
            primary: document.getElementById('sc-edit-brand-primary')?.value?.trim() || '',
            accent: document.getElementById('sc-edit-brand-accent')?.value?.trim() || '',
            ink: document.getElementById('sc-edit-brand-ink')?.value?.trim() || '',
          },
          siteArchetype: nap.siteArchetype,
        };
        const result = await api(`/api/candidates/${encodeURIComponent(d.id)}/site-config/draft`, {
          method: 'POST',
          body: JSON.stringify({ patch, ...nap, allowNonPursue: allow }),
        });
        state.detail = result.candidate || (await api(`/api/candidates/${encodeURIComponent(d.id)}`));
        state.tab = 'site-config';
        renderDetail();
        const left = result.placeholders || [];
        await showModal({
          title: 'Draft updated',
          confirmLabel: 'OK',
          bodyHtml: left.length
            ? `<p>Still placeholders: <code>${esc(left.join(', '))}</code></p>`
            : '<p>No TBD placeholders left.</p>',
        });
      } catch (error) {
        await showModal({
          title: 'Save failed',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
        saveDraftBtn.disabled = false;
      }
    });
  }

  const acceptBtn = document.getElementById('site-config-accept-btn');
  if (acceptBtn) {
    acceptBtn.addEventListener('click', async () => {
      acceptBtn.disabled = true;
      try {
        const nap = saveSiteConfigNapFromForm();
        const allow = Boolean(document.getElementById('sc-allow-non-pursue')?.checked);
        const isPh = (v, known) => {
          const s = String(v || '').trim();
          return (
            !s ||
            s === known ||
            /^tbd\b/i.test(s) ||
            /^REPLACE_/i.test(s) ||
            /^YOUR_WEB3FORMS/i.test(s) ||
            s === 'example.com' ||
            s === '+1XXXXXXXXXX' ||
            s === 'leads@example.com'
          );
        };

        let remaining =
          d.siteConfigDraft?._ops?.placeholders ||
          state.detail?.siteConfigDraft?._ops?.placeholders ||
          [];

        const hasEditForm = Boolean(document.getElementById('sc-edit-businessName'));
        if (hasEditForm) {
          const patch = {
            businessName:
              document.getElementById('sc-edit-businessName')?.value?.trim() ||
              nap.businessName ||
              '',
            domain: document.getElementById('sc-edit-domain')?.value?.trim() || nap.domain || '',
            phone: document.getElementById('sc-edit-phone')?.value?.trim() || nap.phone || '',
            email: document.getElementById('sc-edit-email')?.value?.trim() || nap.email || '',
            tagline: document.getElementById('sc-edit-tagline')?.value?.trim() || '',
            primaryCta: document.getElementById('sc-edit-primaryCta')?.value?.trim() || '',
            niche: document.getElementById('sc-edit-niche')?.value?.trim() || '',
            primaryCity: document.getElementById('sc-edit-primaryCity')?.value?.trim() || '',
            state: document.getElementById('sc-edit-state')?.value?.trim() || '',
            serviceRadiusMiles:
              document.getElementById('sc-edit-radius')?.value?.trim() || nap.radiusMiles || '',
            web3FormsAccessKey: document.getElementById('sc-edit-web3')?.value?.trim() || '',
            targetSuburbs: document.getElementById('sc-edit-suburbs')?.value || '',
            services: document.getElementById('sc-edit-services')?.value || '',
            commercialServices: document.getElementById('sc-edit-commercial')?.value || '',
            homepageServicesLimit: document.getElementById('sc-edit-svc-limit')?.value || '12',
            brand: {
              primary: document.getElementById('sc-edit-brand-primary')?.value?.trim() || '',
              accent: document.getElementById('sc-edit-brand-accent')?.value?.trim() || '',
              ink: document.getElementById('sc-edit-brand-ink')?.value?.trim() || '',
            },
            siteArchetype: nap.siteArchetype,
          };
          if (nap.domain && isPh(patch.domain, 'example.com')) patch.domain = nap.domain;
          if (nap.phone && isPh(patch.phone, '+1XXXXXXXXXX')) patch.phone = nap.phone;
          if (nap.email && isPh(patch.email, 'leads@example.com')) patch.email = nap.email;
          if (nap.businessName && isPh(patch.businessName, 'TBD Business')) {
            patch.businessName = nap.businessName;
          }

          const synced = await api(`/api/candidates/${encodeURIComponent(d.id)}/site-config/draft`, {
            method: 'POST',
            body: JSON.stringify({ patch, ...nap, allowNonPursue: allow }),
          });
          state.detail = synced.candidate || state.detail;
          d.siteConfigDraft = synced.draft || d.siteConfigDraft;
          remaining = synced.placeholders || synced.draft?._ops?.placeholders || [];
        }

        // Client-side scan if _ops list missing/stale
        if (!remaining.length && hasEditForm) {
          const checks = [
            ['tagline', document.getElementById('sc-edit-tagline')?.value, null],
            ['domain', document.getElementById('sc-edit-domain')?.value, 'example.com'],
            ['phone', document.getElementById('sc-edit-phone')?.value, '+1XXXXXXXXXX'],
            ['email', document.getElementById('sc-edit-email')?.value, 'leads@example.com'],
            ['web3FormsAccessKey', document.getElementById('sc-edit-web3')?.value, 'REPLACE_WEB3FORMS_KEY'],
          ];
          remaining = checks.filter(([_, v, known]) => isPh(v, known)).map(([k]) => k);
        }

        const ok = await showModal({
          title: 'Write site-config.json?',
          confirmLabel: remaining.length ? 'Write with placeholders' : 'Write file',
          bodyHtml: remaining.length
            ? `<p>Writes to <code>src/config/site-config.json</code> (backs up previous).</p>
               <p>Still placeholders: <code>${esc(remaining.join(', '))}</code> — OK for an early build; fill later in Edit draft.</p>`
            : '<p>Writes draft to <code>src/config/site-config.json</code> (backs up previous). Next step is content markdown.</p>',
        });
        if (!ok) {
          acceptBtn.disabled = false;
          renderDetail();
          return;
        }

        // Ops draft handoff: always allow placeholders once the operator confirmed.
        const postAccept = (extra = {}) =>
          api(`/api/candidates/${encodeURIComponent(d.id)}/site-config/accept`, {
            method: 'POST',
            body: JSON.stringify({
              allowNonPursue: allow,
              allowPlaceholders: true,
              ...extra,
            }),
          });
        let result;
        try {
          result = await postAccept();
        } catch (error) {
          if (error.suburbCheck) {
            const force = await showModal({
              title: 'Suburb warnings',
              confirmLabel: 'Write anyway',
              bodyHtml: `<p>${esc(error.message)}</p>`,
            });
            if (!force) throw error;
            result = await postAccept({ ignoreSuburbWarnings: true });
          } else if (/placeholder/i.test(String(error.message || ''))) {
            // Defensive retry if an older server ignored the flag
            result = await postAccept({ allowPlaceholders: true });
          } else {
            throw error;
          }
        }
        state.detail = result.candidate || (await api(`/api/candidates/${encodeURIComponent(d.id)}`));
        state.tab = 'site-config';
        renderDetail();
        await showModal({
          title: 'Site config written',
          confirmLabel: 'OK',
          bodyHtml: `<p>Wrote <code>${esc(result.path || 'src/config/site-config.json')}</code>. Open the <strong>Content</strong> tab next.</p>`,
        });
      } catch (error) {
        await showModal({
          title: 'Accept failed',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
        acceptBtn.disabled = false;
        renderDetail();
      }
    });
  }
}

function renderDetail() {
  const d = state.detail;
  if (!d) return;
  if (state.selectedIds.size > 1) {
    renderMultiDetail();
    return;
  }
  state.multiQueue = false;
  syncCandidatesDetailVisibility();
  document.getElementById('empty-detail').classList.add('hidden');
  document.getElementById('detail').classList.remove('hidden');
  document.getElementById('detail-title').textContent = d.summary?.niche || d.config?.niche || d.id;
  const srcBatch = d.meta?.source?.batchId;
  document.getElementById('detail-sub').textContent = [
    d.id,
    [d.summary?.primaryCity || d.config?.primary, d.summary?.state].filter(Boolean).join(''),
    srcBatch ? `discovery ${srcBatch}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  document.getElementById('stage-chip').textContent = d.stage;

  renderActions();
  updateTabCompletion();

  const panels = {
    overview: renderOverview,
    serp: renderSerp,
    keywords: renderKeywords,
    enrichment: renderEnrichment,
    narrative: renderNarrative,
    'site-config': renderSiteConfig,
    content: renderContent,
    prospects: renderProspects,
    logs: renderLogs,
  };
  document.getElementById('tab-panels').innerHTML = (panels[state.tab] || renderOverview)();

  const tabPanels = document.getElementById('tab-panels');
  tabPanels.querySelectorAll('[data-act="accept"], [data-act="reject"]').forEach((btn) => {
    btn.addEventListener('click', () => handleAction(btn.dataset.act, btn));
  });
  const pasteBtn = document.getElementById('narrative-paste-btn');
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      const text = document.getElementById('narrative-paste')?.value || '';
      if (!text.trim()) {
        await showModal({
          title: 'Nothing to paste',
          confirmLabel: 'OK',
          bodyHtml: '<p>Paste Claude’s JSON response into the box first.</p>',
        });
        return;
      }
      pasteBtn.disabled = true;
      try {
        await api(`/api/candidates/${encodeURIComponent(d.id)}/narrative/paste`, {
          method: 'POST',
          body: JSON.stringify({ json: text }),
        });
        state.detail = await api(`/api/candidates/${encodeURIComponent(d.id)}`);
        state.tab = 'narrative';
        renderDetail();
      } catch (error) {
        await showModal({
          title: 'Paste failed',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
        pasteBtn.disabled = false;
      }
    });
  }

  wireSiteConfigTab(d);
  wireContentTab(d);

  const saveBtn = document.getElementById('save-decision');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      try {
        await api(`/api/candidates/${encodeURIComponent(d.id)}/decision`, {
          method: 'POST',
          body: JSON.stringify({
            decision: document.getElementById('decision-select').value,
            notes: document.getElementById('decision-notes').value || null,
          }),
        });
        state.detail = await api(`/api/candidates/${encodeURIComponent(d.id)}`);
        await loadCandidates();
        renderDetail();
      } catch (error) {
        await showModal({
          title: 'Error',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
    });
  }

  if (state.activeJobId && state.tab === 'logs') {
    api(`/api/jobs/${state.activeJobId}`).then((job) => {
      const logEl = document.getElementById('job-log');
      if (logEl) logEl.textContent = job.logText || '(no output yet)';
    });
  }
}

function wireUi() {
  document.getElementById('btn-refresh').addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    loadCandidates();
  });
  document.getElementById('candidate-decision-filter')?.addEventListener('change', (e) => {
    state.candidateDecisionFilter = e.target.value;
    renderList();
    renderActions();
  });
  document.getElementById('candidate-stage-filter')?.addEventListener('change', (e) => {
    state.candidateStageFilter = e.target.value;
    renderList();
    renderActions();
  });
  document.getElementById('candidate-filter-text')?.addEventListener('input', (e) => {
    state.candidateTextFilter = e.target.value;
    renderList();
  });
  document.getElementById('candidate-select-filtered')?.addEventListener('click', () => {
    for (const c of filteredCandidates()) state.selectedIds.add(c.id);
    renderList();
    renderActions();
    if (state.selectedIds.size > 1) renderMultiDetail();
  });
  document.getElementById('candidate-clear-selection')?.addEventListener('click', () => {
    state.selectedIds.clear();
    renderList();
    renderActions();
    syncCandidatesDetailVisibility();
    if (state.selectedId && state.detail) renderDetail();
  });
  document.getElementById('candidate-batch-decision-btn')?.addEventListener('click', async () => {
    const decision = document.getElementById('candidate-batch-decision')?.value;
    const ids = [...state.selectedIds];
    if (!decision || !ids.length) return;
    const ok = await showModal({
      title: 'Set decision on selection?',
      confirmLabel: `Set ${decision} (${ids.length})`,
      bodyHtml: `<p>Apply <strong>${esc(decision)}</strong> to <strong>${esc(
        String(ids.length),
      )}</strong> selected candidates (decision groups).</p>`,
    });
    if (!ok) return;
    try {
      await api('/api/candidates/decisions', {
        method: 'POST',
        body: JSON.stringify({ ids, decision }),
      });
      await loadCandidates();
      if (state.selectedId) {
        state.detail = await api(`/api/candidates/${encodeURIComponent(state.selectedId)}`);
        if (state.selectedIds.size > 1) renderMultiDetail();
        else renderDetail();
      }
    } catch (error) {
      await showModal({
        title: 'Batch decision failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.tab = tab.dataset.tab;
      renderDetail();
    });
  });

  wireDiscoveryUi();
}

function setView(view) {
  state.view = view;
  document.getElementById('view-candidates').classList.toggle('hidden', view !== 'candidates');
  document.getElementById('view-discovery').classList.toggle('hidden', view !== 'discovery');
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  if (view === 'candidates') {
    renderActions();
    syncCandidatesDetailVisibility();
  }
}

function downloadText(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function loadDiscoveryPresets() {
  state.discoveryPresets = await api('/api/discovery/presets');
  const box = document.getElementById('discovery-niches');
  const niches = state.discoveryPresets?.niches || [];
  box.innerHTML = niches
    .map(
      (n) =>
        `<label class="check"><input type="checkbox" name="niche" value="${esc(n)}" /> ${esc(n)}</label>`,
    )
    .join('');
  const catBox = document.getElementById('discovery-categories');
  if (catBox) {
    const cats = state.discoveryPresets?.categories || [];
    catBox.innerHTML = cats
      .map(
        (c) =>
          `<label class="check"><input type="checkbox" name="category" value="${esc(c)}" /> ${esc(c)}</label>`,
      )
      .join('');
  }
  const census = state.discoveryPresets?.census || {};
  const el = document.getElementById('census-status');
  if (!el) return;
  if (census.ok) {
    const n = Number(census.placeCount);
    const places = Number.isFinite(n) ? n.toLocaleString() : String(census.placeCount ?? '');
    el.textContent = `Census ok · ${places} places`;
    el.title = census.path || '';
    el.classList.remove('warn-text');
  } else {
    el.textContent = `Census missing — set CENSUS_POP_CSV`;
    el.title = census.error || census.path || '';
    el.classList.add('warn-text');
  }
}

function shortDiscoveryStage(stage) {
  return String(stage || '')
    .replace(/^discovery_/, '')
    .replace(/_/g, ' ')
    .trim();
}

function formatDiscoveryBatchOption(b) {
  const stage = shortDiscoveryStage(b.stage) || 'pack';
  const rows = `${b.rowCount ?? 0} rows`;
  return `${b.id} · ${stage} · ${rows}`;
}

async function loadDiscoveryBatches() {
  const data = await api('/api/discovery/batches');
  state.discoveryBatches = data.batches || [];
  const sel = document.getElementById('discovery-batch-select');
  if (!sel) return;
  if (!state.discoveryBatches.length) {
    sel.innerHTML = '<option value="">No batches yet</option>';
    return;
  }
  sel.innerHTML = state.discoveryBatches
    .map((b) => {
      const selected = b.id === state.discoveryBatchId ? ' selected' : '';
      return `<option value="${esc(b.id)}"${selected}>${esc(formatDiscoveryBatchOption(b))}</option>`;
    })
    .join('');
  if (state.discoveryBatchId) sel.value = state.discoveryBatchId;
}

const DISCOVERY_SOURCES = {
  claude: { id: 'claude', label: 'Claude', tip: 'From Claude narrative CSV' },
  census: { id: 'census', label: 'Census', tip: 'US Census population lookup on import' },
  gemini: { id: 'gemini', label: 'Gemini', tip: 'Gemini volume / keyword estimates' },
  dfs: { id: 'dfs', label: 'DFS', tip: 'DataForSEO Discovery SERP probe' },
  ops: { id: 'ops', label: 'Ops', tip: 'Computed or set in Ops UI' },
};

const DISCOVERY_TABLE_COLS = [
  {
    key: '_select',
    label: '',
    sortable: false,
    tip: 'Select rows for Accept selected / bulk actions',
    cellClass: 'col-narrow',
  },
  {
    key: 'Niche',
    label: 'Niche',
    sortable: true,
    tip: 'Service niche (Claude)',
    cellClass: 'col-truncate',
    source: 'claude',
  },
  {
    key: 'City',
    label: 'City',
    sortable: true,
    tip: 'Primary city (Claude)',
    cellClass: 'col-truncate',
    source: 'claude',
  },
  {
    key: 'State',
    label: 'State',
    sortable: true,
    tip: 'Two-letter US state (Claude)',
    cellClass: 'col-short',
    source: 'claude',
  },
  {
    key: 'Population',
    label: 'Population',
    sortable: true,
    tip: 'Census on import when available; else Claude estimate',
    cellClass: 'col-short',
    source: 'census',
  },
  {
    key: 'Map Pack',
    label: 'Map Pack',
    sortable: true,
    tip: 'Yes/No from DFS SERP probe (preferred). Gemini estimates only if no probe yet.',
    cellClass: 'col-short',
    source: 'dfs',
  },
  {
    key: 'Est. Cluster Volume',
    label: 'Est. Volume',
    sortable: true,
    tip: 'Gemini estimated monthly search volume band (not Stage 1 Ads volumes)',
    cellClass: 'col-truncate',
    source: 'gemini',
  },
  {
    key: 'Average Job Cost',
    label: 'Job Cost',
    sortable: true,
    tip: 'Claude estimated average job value / ticket size',
    cellClass: 'col-truncate',
    source: 'claude',
  },
  {
    key: 'Organic Home Page',
    label: 'Org Home',
    sortable: true,
    tip: 'Organic homepage count from DFS SERP probe (URL path / only; directories excluded). Not niche-title filtered.',
    cellClass: 'col-short',
    source: 'dfs',
  },
  {
    key: 'Organic Sub Page',
    label: 'Org Sub',
    sortable: true,
    tip: 'Organic subpage count from DFS SERP probe (non-homepage URLs; directories excluded). Not niche-title filtered.',
    cellClass: 'col-short',
    source: 'dfs',
  },
  {
    key: 'confidence_serp',
    label: 'Conf SERP',
    sortable: true,
    tip: 'high after DFS probe; otherwise Gemini confidence on estimates',
    cellClass: 'col-short',
    source: 'dfs',
  },
  {
    key: 'recommended_decision',
    label: 'Recommend',
    sortable: true,
    tip: 'Ops heuristic from Map Pack + organic (best after DFS probe)',
    cellClass: 'col-short',
    source: 'ops',
  },
  {
    key: '_accept',
    label: 'Accept',
    sortable: false,
    tip: 'Copy Recommend → Human',
    cellClass: 'col-narrow',
    source: 'ops',
  },
  {
    key: 'human_decision',
    label: 'Human',
    sortable: true,
    tip: 'Your decision for Process batch',
    cellClass: 'col-human',
    source: 'ops',
  },
  {
    key: 'decision_notes',
    label: 'Notes',
    sortable: false,
    tip: 'Notes (Claude/Ops warnings or your comments)',
    cellClass: 'col-notes',
    source: 'ops',
  },
  {
    key: 'candidateId',
    label: 'Candidate',
    sortable: true,
    tip: 'Linked candidate id after Process',
    cellClass: 'col-truncate',
    source: 'ops',
  },
];

function discoverySourceDot(sourceId) {
  const src = DISCOVERY_SOURCES[sourceId];
  if (!src) return '';
  return `<span class="src-dot src-${esc(src.id)}" title="${esc(src.tip)}" aria-label="${esc(
    src.label,
  )}"></span>`;
}

function renderSourceLegend(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = Object.values(DISCOVERY_SOURCES)
    .map(
      (s) =>
        `<span class="src-legend-item" title="${esc(s.tip)}"><span class="src-dot src-${esc(
          s.id,
        )}"></span>${esc(s.label)}</span>`,
    )
    .join('');
}

function renderDiscoverySourceLegend() {
  renderSourceLegend('discovery-source-legend');
  renderSourceLegend('candidate-source-legend');
}

function normalizeMapPackFilterValue(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';
  if (['yes', 'y', 'true', '1'].includes(s)) return 'yes';
  if (['no', 'n', 'false', '0'].includes(s)) return 'no';
  return s;
}

function discoveryRowMatchesFilters(row) {
  const f = state.discoveryFilters;
  const text = String(f.text || '').trim().toLowerCase();
  if (text) {
    const hay = `${row.Niche || ''} ${row.City || ''} ${row.State || ''}`.toLowerCase();
    if (!hay.includes(text)) return false;
  }
  if (f.human === '__empty') {
    if (String(row.human_decision || '').trim()) return false;
  } else if (f.human && String(row.human_decision || '') !== f.human) {
    return false;
  }
  if (f.rec && String(row.recommended_decision || '') !== f.rec) return false;
  if (f.mapPack === '__empty') {
    if (String(row['Map Pack'] || '').trim()) return false;
  } else if (f.mapPack) {
    const want = normalizeMapPackFilterValue(f.mapPack);
    const got = normalizeMapPackFilterValue(row['Map Pack']);
    if (want !== got) return false;
  }
  return true;
}

function parseDiscoverySortValue(row, key) {
  if (key === 'Population') {
    const n = Number(String(row.Population || '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : -1;
  }
  if (key === 'Organic Home Page') {
    const n = Number(String(row['Organic Home Page'] || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : -1;
  }
  if (key === 'Organic Sub Page') {
    const n = Number(String(row['Organic Sub Page'] || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : -1;
  }
  if (key === 'Est. Cluster Volume') {
    const m = String(row['Est. Cluster Volume'] || '').match(/(\d+)/);
    return m ? Number(m[1]) : -1;
  }
  return String(row[key] ?? '').toLowerCase();
}

function getDiscoveryViewRows() {
  const indexed = state.discoveryRows.map((row, index) => ({ row, index }));
  let list = indexed.filter(({ row }) => discoveryRowMatchesFilters(row));
  const { key, dir } = state.discoverySort;
  if (key) {
    list = [...list].sort((a, b) => {
      const av = parseDiscoverySortValue(a.row, key);
      const bv = parseDiscoverySortValue(b.row, key);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }
  return list;
}

function syncDiscoveryFilterInputs() {
  const bar = document.getElementById('discovery-table-filters');
  if (!bar) return;
  if (!state.discoveryRows.length) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  const count = document.getElementById('discovery-filter-count');
  if (count) {
    const n = getDiscoveryViewRows().length;
    count.textContent = `Showing ${n} / ${state.discoveryRows.length}`;
  }
}

async function persistDiscoveryDecisions(updates) {
  if (!state.discoveryBatchId || !updates.length) return null;
  const result = await api(
    `/api/discovery/batches/${encodeURIComponent(state.discoveryBatchId)}/decisions`,
    { method: 'POST', body: JSON.stringify({ updates }) },
  );
  state.discoveryRows = result.rows;
  return result;
}

function discoveryDecisionUpdateFromDom(idx) {
  const row = state.discoveryRows[idx];
  if (!row) return null;
  const decisionEl = document.querySelector(
    `select[data-idx="${idx}"][data-field="human_decision"]`,
  );
  const notesEl = document.querySelector(
    `input[data-idx="${idx}"][data-field="decision_notes"]`,
  );
  return {
    index: idx,
    human_decision: decisionEl ? decisionEl.value : row.human_decision || '',
    decision_notes: notesEl ? notesEl.value : row.decision_notes || '',
  };
}

async function persistDiscoveryRowFromDom(idx) {
  const update = discoveryDecisionUpdateFromDom(idx);
  if (!update || !state.discoveryBatchId) return null;
  try {
    const result = await persistDiscoveryDecisions([update]);
    updateDiscoveryStepChecks(
      state.discoveryBatches.find((b) => b.id === state.discoveryBatchId) || {
        id: state.discoveryBatchId,
      },
      state.discoveryRows,
    );
    return result;
  } catch (error) {
    await showModal({
      title: 'Save failed',
      confirmLabel: 'OK',
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
    return null;
  }
}

const discoveryNotesSaveTimers = new Map();

function scheduleDiscoveryNotesAutosave(idx) {
  const prev = discoveryNotesSaveTimers.get(idx);
  if (prev) clearTimeout(prev);
  discoveryNotesSaveTimers.set(
    idx,
    setTimeout(() => {
      discoveryNotesSaveTimers.delete(idx);
      void persistDiscoveryRowFromDom(idx);
    }, 400),
  );
}

function flushDiscoveryNotesAutosave(idx) {
  const prev = discoveryNotesSaveTimers.get(idx);
  if (prev) {
    clearTimeout(prev);
    discoveryNotesSaveTimers.delete(idx);
  }
  return persistDiscoveryRowFromDom(idx);
}

async function acceptDiscoveryIndices(indices) {
  const updates = [];
  for (const idx of indices) {
    const row = state.discoveryRows[idx];
    if (!row?.recommended_decision) continue;
    updates.push({
      index: idx,
      human_decision: row.recommended_decision,
      decision_notes: row.decision_notes || row.recommended_reason || '',
    });
  }
  if (!updates.length) {
    await showModal({
      title: 'Nothing to accept',
      confirmLabel: 'OK',
      bodyHtml: '<p>No recommended decisions on the selected rows.</p>',
    });
    return;
  }
  await persistDiscoveryDecisions(updates);
  renderDiscoveryTable();
  updateDiscoveryStepChecks(
    { id: state.discoveryBatchId, ...(state.discoveryBatches.find((b) => b.id === state.discoveryBatchId) || {}) },
    state.discoveryRows,
  );
}

function renderDiscoveryTable() {
  const thead = document.querySelector('#discovery-table thead');
  const tbody = document.querySelector('#discovery-table tbody');
  const sort = state.discoverySort;
  thead.innerHTML = `<tr>${DISCOVERY_TABLE_COLS.map((c) => {
    const tip = c.tip || c.label || '';
    if (c.key === '_select') {
      return `<th title="${esc(tip)}"><input type="checkbox" id="discovery-select-all" title="${esc(tip)}" /></th>`;
    }
    const mark =
      sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
    const cls = c.sortable ? 'sortable' : '';
    const label = c.label || (c.key === '_accept' ? 'Accept' : '');
    const srcTip = c.source && DISCOVERY_SOURCES[c.source] ? DISCOVERY_SOURCES[c.source].tip : '';
    const fullTip = [tip, srcTip].filter(Boolean).join(' · ');
    return `<th class="${cls}" data-sort="${esc(c.key)}" title="${esc(fullTip)}"><span class="th-label">${discoverySourceDot(
      c.source,
    )}${esc(label)}</span>${mark}</th>`;
  }).join('')}</tr>`;
  renderDiscoverySourceLegend();

  const processBtn = document.getElementById('discovery-process-btn');
  const acceptSel = document.getElementById('discovery-accept-selected');
  const acceptAll = document.getElementById('discovery-accept-all');

  if (!state.discoveryRows.length) {
    tbody.innerHTML = `<tr><td colspan="${DISCOVERY_TABLE_COLS.length}" class="muted">Import a filled CSV or select a batch.</td></tr>`;
    if (processBtn) processBtn.disabled = true;
    if (acceptSel) acceptSel.disabled = true;
    if (acceptAll) acceptAll.disabled = true;
    syncDiscoveryFilterInputs();
    return;
  }

  const view = getDiscoveryViewRows();
  tbody.innerHTML = view
    .map(({ row, index: idx }) => {
      const checked = state.discoverySelected.has(idx) ? 'checked' : '';
      const cells = DISCOVERY_TABLE_COLS.map((col) => {
        const tdClass = col.cellClass ? ` class="${esc(col.cellClass)}"` : '';
        if (col.key === '_select') {
          return `<td${tdClass}><input type="checkbox" data-disc-idx="${idx}" class="disc-row-check" ${checked} /></td>`;
        }
        if (col.key === '_accept') {
          const disabled = row.recommended_decision ? '' : 'disabled';
          return `<td${tdClass}><button type="button" class="btn btn-accept" data-accept-idx="${idx}" title="Copy Recommend → Human" ${disabled}>Accept</button></td>`;
        }
        if (col.key === 'recommended_decision') {
          const rec = row.recommended_decision || '—';
          const reason = row.recommended_reason || '';
          const cls = [col.cellClass, 'rec-cell'].filter(Boolean).join(' ');
          return `<td class="${esc(cls)}" title="${esc(reason)}"><strong>${esc(rec)}</strong></td>`;
        }
        if (col.key === 'human_decision') {
          const v = row.human_decision || '';
          return `<td${tdClass}><select data-idx="${idx}" data-field="human_decision">${DISCOVERY_DECISION_OPTS.map(
            (o) => `<option value="${o}" ${v === o ? 'selected' : ''}>${o || '—'}</option>`,
          ).join('')}</select></td>`;
        }
        if (col.key === 'decision_notes') {
          const notes = row.decision_notes || '';
          return `<td${tdClass}><input data-idx="${idx}" data-field="decision_notes" title="${esc(notes)}" value="${esc(
            notes,
          )}" /></td>`;
        }
        const val = row[col.key] ?? '';
        return `<td${tdClass} title="${esc(val)}"><span class="cell-text">${esc(val)}</span></td>`;
      });
      return `<tr data-row-idx="${idx}">${cells.join('')}</tr>`;
    })
    .join('');

  if (processBtn) processBtn.disabled = false;
  if (acceptSel) acceptSel.disabled = state.discoverySelected.size === 0;
  if (acceptAll) {
    acceptAll.disabled = !view.some(({ row }) => row.recommended_decision);
  }
  syncDiscoveryFilterInputs();

  document.getElementById('discovery-select-all')?.addEventListener('change', (e) => {
    const on = e.target.checked;
    for (const { index } of view) {
      if (on) state.discoverySelected.add(index);
      else state.discoverySelected.delete(index);
    }
    renderDiscoveryTable();
  });
  thead.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.discoverySort.key === key) state.discoverySort.dir *= -1;
      else state.discoverySort = { key, dir: 1 };
      renderDiscoveryTable();
    });
  });
  tbody.querySelectorAll('.disc-row-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      const idx = Number(cb.dataset.discIdx);
      if (cb.checked) state.discoverySelected.add(idx);
      else state.discoverySelected.delete(idx);
      if (acceptSel) acceptSel.disabled = state.discoverySelected.size === 0;
    });
  });
  tbody.querySelectorAll('[data-accept-idx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await acceptDiscoveryIndices([Number(btn.dataset.acceptIdx)]);
    });
  });
}

async function selectDiscoveryBatch(id) {
  const data = await api(`/api/discovery/batches/${encodeURIComponent(id)}`);
  state.discoveryBatchId = data.batch.id;
  state.discoveryRows = data.rows || [];
  state.discoverySelected = new Set();
  document.getElementById('discovery-batch-title').textContent = data.batch.id;
  const stage = shortDiscoveryStage(data.batch.stage);
  const serp = data.batch.lastSerpProbe;
  document.getElementById('discovery-batch-sub').textContent = [
    stage,
    `${data.rows?.length || 0} rows`,
    data.batch.filters?.state || null,
    serp
      ? `SERP $${serp.costUsd ?? '?'} · MP ${serp.mapPackYes ?? '?'}/${serp.mapPackNo ?? '?'}`
      : null,
    data.batch.lastProcess
      ? `process +${data.batch.lastProcess.promoted?.length || 0}/−${data.batch.lastProcess.skipped?.length || 0}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const batchSel = document.getElementById('discovery-batch-select');
  if (batchSel && batchSel.value !== data.batch.id) {
    batchSel.value = data.batch.id;
  }
  // Collapse SERP/Gemini tools when a batch is loaded to keep sidebar short
  const serpSec = document.getElementById('discovery-serp-section');
  const gemSec = document.getElementById('discovery-gemini-section');
  if (serpSec) serpSec.open = false;
  if (gemSec) gemSec.open = false;
  const logEl = document.getElementById('discovery-process-log');
  if (logEl) {
    const lp = data.batch.lastProcess;
    if (lp) {
      logEl.classList.remove('hidden');
      const linked = (lp.promoted || []).filter((p) => p.linkedExisting).length;
      logEl.innerHTML = `<p class="muted">Last process: +${esc(
        String(lp.promoted?.length || 0),
      )}${linked ? ` (${esc(String(linked))} linked)` : ''} · −${esc(
        String(lp.skipped?.length || 0),
      )} · Stage 1 ×${esc(String(lp.pursueQueued?.length || 0))}</p>`;
    } else {
      logEl.classList.add('hidden');
      logEl.innerHTML = '';
    }
  }
  if (
    state.discoveryRows.length &&
    state.discoveryRows.some((r) => !r.recommended_decision)
  ) {
    try {
      const rec = await api(
        `/api/discovery/batches/${encodeURIComponent(id)}/recommend`,
        { method: 'POST', body: '{}' },
      );
      state.discoveryRows = rec.rows;
    } catch {
      /* ignore */
    }
  }
  renderDiscoveryTable();
  updateDiscoveryStepChecks(data.batch, state.discoveryRows);
  await loadDiscoveryBatches();
}

function updateDiscoveryStepChecks(batch, rows) {
  const rail = document.getElementById('discovery-steps');
  if (!rail) return;
  const hasRows = (rows?.length || 0) > 0;
  const steps = {
    claude: hasRows || Boolean(batch?.files?.lastImport) || Boolean(batch?.rowCount),
    serpProbe:
      Boolean(batch?.lastSerpProbe) ||
      (hasRows && rows.some((r) => String(r.serp_source || '').includes('dataforseo'))),
    geminiVolumes:
      hasRows && rows.some((r) => String(r['Est. Cluster Volume'] || '').trim() !== ''),
    decisions: hasRows && rows.some((r) => String(r.human_decision || '').trim() !== ''),
    processed: batch?.stage === 'discovery_processed' || Boolean(batch?.lastProcess),
  };
  rail.querySelectorAll('.disc-step').forEach((el) => {
    const key = el.dataset.step;
    el.classList.toggle('done', Boolean(steps[key]));
  });
}

function wireDiscoveryUi() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setView(btn.dataset.view);
      if (btn.dataset.view === 'discovery') {
        loadDiscoveryBatches().catch(() => {});
      }
    });
  });

  document.getElementById('discovery-batch-select')?.addEventListener('change', (event) => {
    const id = event.target.value;
    if (id) selectDiscoveryBatch(id).catch(() => {});
  });

  document.getElementById('discovery-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const niches = [...event.target.querySelectorAll('input[name="niche"]:checked')].map(
      (el) => el.value,
    );
    const custom = String(fd.get('customNiche') || '').trim();
    if (custom) niches.push(custom);
    const cities = String(fd.get('cities') || '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const pack = await api('/api/discovery/pack', {
        method: 'POST',
        body: JSON.stringify({
          state: String(fd.get('state') || '').toUpperCase(),
          niches,
          cities,
          categories: [...event.target.querySelectorAll('input[name="category"]:checked')].map(
            (el) => el.value,
          ),
          minPopulation: Number(fd.get('minPopulation')) || 70000,
          maxPopulation: Number(fd.get('maxPopulation')) || 200000,
          maxRows: Number(fd.get('maxRows')) || 40,
          seasonality: String(fd.get('seasonality') || 'year_round'),
          tiers: [...event.target.querySelectorAll('input[name="tier"]:checked')].map(
            (el) => el.value,
          ),
          minJobCost: fd.get('minJobCost') ? Number(fd.get('minJobCost')) : null,
          mapPackPreference: String(fd.get('mapPackPreference') || 'prefer_absent'),
        }),
      });
      state.lastDiscoveryPack = pack;
      state.discoveryBatchId = pack.batch.id;
      const box = document.getElementById('discovery-pack-result');
      box.classList.remove('hidden');
      const claudeCsv = pack.claudeCsvName || pack.batch?.files?.claudeCsv || '';
      const geminiCsv = pack.geminiCsvName || pack.batch?.files?.geminiCsv || '';
      box.innerHTML = `
        <div class="callout">Pack ready · <strong>${esc(pack.batch.id)}</strong> · empty CSV · max ${esc(String(pack.batch.filters?.maxRows ?? ''))}<br/>
          Claude file: <code>${esc(claudeCsv)}</code> · Gemini file: <code>${esc(geminiCsv)}</code>
          ${
            pack.knownCandidatesCount
              ? `<br/><span class="muted">Known candidates injected into Claude prompt: ${esc(
                  String(pack.knownCandidatesCount),
                )} (research/known-candidates.csv)</span>`
              : ''
          }
        </div>
        <div class="narrative-actions">
          <button type="button" class="btn primary" id="dl-discovery-csv">Download CSV template</button>
          <button type="button" class="btn" id="dl-discovery-claude">Download Claude prompt</button>
          <button type="button" class="btn" id="dl-discovery-gemini">Download Gemini prompt</button>
          <button type="button" class="btn" id="copy-discovery-claude">Copy Claude prompt</button>
          <button type="button" class="btn" id="copy-discovery-gemini">Copy Gemini prompt</button>
        </div>
        <ol class="discovery-steps">
          <li>Claude → import CSV</li>
          <li><strong>DFS SERP probe</strong> (~$0.002/row) → Map Pack + organic · Recommend</li>
          <li>Gemini volumes · Accept / Process · pursue → Stage 1</li>
        </ol>
      `;
      document.getElementById('dl-discovery-csv').onclick = () =>
        downloadText(pack.csvName || 'discovery.csv', pack.csv, 'text/csv');
      document.getElementById('dl-discovery-claude').onclick = () =>
        downloadText('prompt-claude.md', pack.claudePrompt);
      document.getElementById('dl-discovery-gemini').onclick = () =>
        downloadText('prompt-gemini.md', pack.geminiPrompt);
      document.getElementById('copy-discovery-claude').onclick = async () => {
        await navigator.clipboard.writeText(pack.claudePrompt);
        await showModal({
          title: 'Copied',
          confirmLabel: 'OK',
          bodyHtml: '<p>Claude prompt is on your clipboard.</p>',
        });
      };
      document.getElementById('copy-discovery-gemini').onclick = async () => {
        await navigator.clipboard.writeText(pack.geminiPrompt);
        await showModal({
          title: 'Copied',
          confirmLabel: 'OK',
          bodyHtml: '<p>Gemini prompt is on your clipboard.</p>',
        });
      };
      await loadDiscoveryBatches();
      await selectDiscoveryBatch(pack.batch.id);
    } catch (error) {
      await showModal({
        title: 'Discovery pack failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('discovery-upload-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    document.getElementById('discovery-upload-text').value = text;
  });

  document.getElementById('discovery-import-btn').addEventListener('click', async () => {
    const csv = document.getElementById('discovery-upload-text').value;
    if (!csv.trim()) {
      await showModal({
        title: 'Nothing to import',
        confirmLabel: 'OK',
        bodyHtml: '<p>Paste or choose a Claude CSV file first.</p>',
      });
      return;
    }
    try {
      const result = await api('/api/discovery/import', {
        method: 'POST',
        body: JSON.stringify({
          csv,
          batchId: state.discoveryBatchId || null,
          role: 'claude',
        }),
      });
      state.lastDiscoveryPack = {
        ...(state.lastDiscoveryPack || {}),
        geminiPrompt: result.geminiPrompt || state.lastDiscoveryPack?.geminiPrompt,
        batch: result.batch,
      };
      await loadDiscoveryBatches();
      await selectDiscoveryBatch(result.batch.id);
      const warns = result.batch.popBandWarnings || [];
      const warnHtml = warns.length
        ? `<p class="muted">${esc(String(warns.length))} row(s) outside preferred pop band.</p>`
        : '';
      await showModal({
        title: 'Claude CSV imported',
        confirmLabel: 'OK',
        bodyHtml: `<p>Loaded <strong>${esc(String(result.rows.length))}</strong> rows. Gemini prompt rebuilt with these rows — use <strong>Copy Gemini prompt (with rows)</strong>.</p>${warnHtml}`,
      });
    } catch (error) {
      await showModal({
        title: 'Import failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('copy-batch-gemini-prompt')?.addEventListener('click', async () => {
    if (!state.discoveryBatchId) {
      await showModal({
        title: 'No batch',
        confirmLabel: 'OK',
        bodyHtml: '<p>Select a batch and import Claude CSV first.</p>',
      });
      return;
    }
    try {
      const data = await api(
        `/api/discovery/batches/${encodeURIComponent(state.discoveryBatchId)}/gemini-prompt`,
      );
      await navigator.clipboard.writeText(data.geminiPrompt);
      await showModal({
        title: 'Copied',
        confirmLabel: 'OK',
        bodyHtml: '<p>Gemini prompt (with Claude rows embedded) is on your clipboard.</p>',
      });
    } catch (error) {
      await showModal({
        title: 'Copy failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('discovery-serp-probe-btn')?.addEventListener('click', () =>
    runDiscoverySerpProbeUi(),
  );

  async function runDiscoverySerpProbeUi() {
  if (!state.discoveryBatchId) {
    await showModal({
      title: 'No batch',
      confirmLabel: 'OK',
      bodyHtml: '<p>Select a batch and import Claude CSV first.</p>',
    });
    return;
  }
  const progress = document.getElementById('discovery-probe-progress');
  const bar = document.getElementById('discovery-probe-bar');
  const labelEl = document.getElementById('discovery-probe-label');
  const detailEl = document.getElementById('discovery-probe-detail');
  try {
    const preview = await api(
      `/api/discovery/batches/${encodeURIComponent(state.discoveryBatchId)}/serp-probe/preview`,
    );
    if (!preview.hasDataForSeo) {
      await showModal({
        title: 'DataForSEO required',
        confirmLabel: 'OK',
        bodyHtml:
          '<p>Add <code>DATAFORSEO_LOGIN</code> / <code>DATAFORSEO_PASSWORD</code> to <code>.env</code> to run the Discovery SERP probe.</p>',
      });
      return;
    }
    const bal =
      state.dfsBalance?.ok && state.dfsBalance.balance != null
        ? `<p class="muted">DFS balance: ${esc(formatMoney(state.dfsBalance.balance))}</p>`
        : '';
    const ok = await showModal({
      title: 'Run Discovery SERP probe?',
      confirmLabel: preview.confirmLabel || 'Probe',
      bodyHtml: `
          <p>${esc(preview.estimateLabel || '')}</p>
          <p class="muted">${esc(preview.estimateDetail || '')}</p>
          ${bal}
          <p class="muted">Overwrites Map Pack + organic/directory counts, then re-runs Recommend.</p>
        `,
    });
    if (!ok) return;
    for (const id of ['discovery-serp-probe-btn']) {
      const b = document.getElementById(id);
      if (b) b.disabled = true;
    }
    if (progress) progress.classList.remove('hidden');
    if (bar) {
      bar.style.width = '0%';
      bar.style.animation = 'none';
    }
    if (labelEl) labelEl.textContent = 'Starting SERP probe…';
    if (detailEl) detailEl.textContent = `0 / ${preview.probeCount}`;

    const started = await api(
      `/api/discovery/batches/${encodeURIComponent(state.discoveryBatchId)}/serp-probe`,
      { method: 'POST', body: JSON.stringify({ concurrency: 1 }) },
    );
    const jobId = started.jobId;
    if (!jobId) throw new Error('Probe did not return a job id');

    await new Promise((resolve, reject) => {
      const tick = async () => {
        try {
          const job = await api(`/api/discovery/serp-probe-jobs/${encodeURIComponent(jobId)}`);
          const pct = job.total ? Math.round((100 * (job.done || 0)) / job.total) : 0;
          if (bar) bar.style.width = `${pct}%`;
          if (labelEl) {
            labelEl.textContent =
              job.status === 'running'
                ? `Probing ${job.done || 0} / ${job.total}`
                : `Probe ${job.status}`;
          }
          if (detailEl) {
            detailEl.textContent = job.currentLabel
              ? job.currentLabel
              : `ok ${job.ok || 0} · errors ${job.errors || 0} · ${formatMoney(job.costUsd || 0)}`;
          }
          if (job.status === 'running') {
            setTimeout(tick, 400);
            return;
          }
          resolve(job);
        } catch (error) {
          reject(error);
        }
      };
      tick();
    }).then(async (job) => {
      await loadDiscoveryBatches();
      await selectDiscoveryBatch(job.batchId || state.discoveryBatchId);
      if (progress) progress.classList.add('hidden');
      const p = job.probe || job;
      await showModal({
        title: 'SERP probe complete',
        confirmLabel: 'OK',
        bodyHtml: `<p>Probed <strong>${esc(String(p.probed || job.total || 0))}</strong> · ok ${esc(
          String(p.ok ?? job.ok ?? 0),
        )} · errors ${esc(String(p.errors ?? job.errors ?? 0))}</p>
        <p>Map Pack Yes ${esc(String(p.mapPackYes ?? job.mapPackYes ?? 0))} · No ${esc(
          String(p.mapPackNo ?? job.mapPackNo ?? 0),
        )} · flips to Yes ${esc(String(p.flipsToYes ?? job.flipsToYes ?? 0))} · flips to No ${esc(
          String(p.flipsToNo ?? job.flipsToNo ?? 0),
        )}</p>
        <p><strong>Cost:</strong> ${
          (p.costUsd ?? job.costUsd) != null
            ? esc(formatMoney(p.costUsd ?? job.costUsd))
            : '—'
        }</p>`,
      });
      await loadDfsBalance();
    });
  } catch (error) {
    if (progress) progress.classList.add('hidden');
    await showModal({
      title: 'SERP probe failed',
      confirmLabel: 'OK',
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
  } finally {
    for (const id of ['discovery-serp-probe-btn']) {
      const b = document.getElementById(id);
      if (b) b.disabled = false;
    }
  }
}

  document.getElementById('discovery-gemini-merge-btn')?.addEventListener('click', async () => {
    const paste = document.getElementById('discovery-gemini-paste')?.value || '';
    if (!state.discoveryBatchId) {
      await showModal({
        title: 'No batch',
        confirmLabel: 'OK',
        bodyHtml: '<p>Select a batch and import Claude CSV first.</p>',
      });
      return;
    }
    if (!paste.trim()) {
      await showModal({
        title: 'Nothing to merge',
        confirmLabel: 'OK',
        bodyHtml: '<p>Paste Gemini’s full DONE + CSV reply first.</p>',
      });
      return;
    }
    try {
      const result = await api(
        `/api/discovery/batches/${encodeURIComponent(state.discoveryBatchId)}/gemini-merge`,
        {
          method: 'POST',
          body: JSON.stringify({ paste }),
        },
      );
      await loadDiscoveryBatches();
      await selectDiscoveryBatch(result.batch.id);
      const unmatched = result.unmatched || [];
      const unmatchedHtml = unmatched.length
        ? `<p class="muted">${esc(String(unmatched.length))} Claude row(s) had no Gemini match:</p><ul>${unmatched
            .slice(0, 8)
            .map((u) => `<li>${esc(u)}</li>`)
            .join('')}</ul>`
        : '';
      const warnings = result.mergeWarnings || result.batch?.geminiMerge?.warnings || [];
      const warnCount = result.batch?.geminiMerge?.warningCount ?? warnings.length;
      const warningsHtml = warnings.length
        ? `<p class="warn-text">${esc(String(warnCount))} field warning(s) — invalid/shifted cells were skipped or healed:</p><ul class="merge-warn-list">${warnings
            .slice(0, 12)
            .map((w) => `<li>${esc(w)}</li>`)
            .join('')}</ul>${
            warnCount > 12
              ? `<p class="muted">…and ${esc(String(warnCount - 12))} more</p>`
              : ''
          }`
        : '';
      await showModal({
        title: 'Gemini merged',
        confirmLabel: 'OK',
        bodyHtml: `<p>Matched <strong>${esc(String(result.matched))}</strong> / ${esc(
          String(result.batch.rowCount),
        )} rows. Wrote <code>${esc(result.batch.files?.geminiCsv || '')}</code>.</p>${unmatchedHtml}${warningsHtml}`,
      });
    } catch (error) {
      await showModal({
        title: 'Gemini merge failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });
  document.getElementById('discovery-accept-selected')?.addEventListener('click', async () => {
    await acceptDiscoveryIndices([...state.discoverySelected]);
  });
  document.getElementById('discovery-accept-all')?.addEventListener('click', async () => {
    const view = getDiscoveryViewRows();
    const indices = view
      .filter(({ row }) => row.recommended_decision)
      .map(({ index }) => index);
    if (!indices.length) {
      await showModal({
        title: 'Nothing to accept',
        confirmLabel: 'OK',
        bodyHtml: '<p>No recommended decisions on the visible rows.</p>',
      });
      return;
    }
    const ok = await showModal({
      title: 'Accept all recommendations?',
      confirmLabel: `Accept ${indices.length}`,
      bodyHtml: `<p>Copy Recommend → Human for <strong>${esc(
        String(indices.length),
      )}</strong> visible row(s) (respects current filters).</p>`,
    });
    if (!ok) return;
    await acceptDiscoveryIndices(indices);
    updateDiscoveryStepChecks(
      state.discoveryBatches.find((b) => b.id === state.discoveryBatchId) || { id: state.discoveryBatchId },
      state.discoveryRows,
    );
  });

  const discoveryTbody = document.querySelector('#discovery-table tbody');
  discoveryTbody?.addEventListener('change', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLSelectElement)) return;
    if (el.dataset.field !== 'human_decision') return;
    const idx = Number(el.dataset.idx);
    if (!Number.isFinite(idx)) return;
    void persistDiscoveryRowFromDom(idx);
  });
  discoveryTbody?.addEventListener('input', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (el.dataset.field !== 'decision_notes') return;
    const idx = Number(el.dataset.idx);
    if (!Number.isFinite(idx)) return;
    el.title = el.value;
    scheduleDiscoveryNotesAutosave(idx);
  });
  discoveryTbody?.addEventListener(
    'blur',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement)) return;
      if (el.dataset.field !== 'decision_notes') return;
      const idx = Number(el.dataset.idx);
      if (!Number.isFinite(idx)) return;
      void flushDiscoveryNotesAutosave(idx);
    },
    true,
  );

  const bindFilter = (id, key) => {
    document.getElementById(id)?.addEventListener('input', (e) => {
      state.discoveryFilters[key] = e.target.value;
      renderDiscoveryTable();
    });
    document.getElementById(id)?.addEventListener('change', (e) => {
      state.discoveryFilters[key] = e.target.value;
      renderDiscoveryTable();
    });
  };
  bindFilter('discovery-filter-text', 'text');
  bindFilter('discovery-filter-human', 'human');
  bindFilter('discovery-filter-rec', 'rec');
  bindFilter('discovery-filter-mappack', 'mapPack');

  document.getElementById('discovery-process-btn')?.addEventListener('click', async () => {
    if (!state.discoveryBatchId) return;
    // Flush any pending notes timers, then persist all DOM edits
    for (const timer of discoveryNotesSaveTimers.values()) clearTimeout(timer);
    discoveryNotesSaveTimers.clear();
    const updates = state.discoveryRows
      .map((_, idx) => discoveryDecisionUpdateFromDom(idx))
      .filter(Boolean);
    await persistDiscoveryDecisions(updates);

    const withDecision = state.discoveryRows.filter((r) => String(r.human_decision || '').trim());
    const pursueCount = withDecision.filter((r) => r.human_decision === 'pursue').length;
    if (!withDecision.length) {
      await showModal({
        title: 'Nothing to process',
        confirmLabel: 'OK',
        bodyHtml: '<p>Set human decisions (or Accept recommendations) first.</p>',
      });
      return;
    }
    const estLow = (pursueCount * 0.2).toFixed(2);
    const estHigh = (pursueCount * 1.5).toFixed(2);
    const adsMode = getAdsMode();
    const adsLine =
      pursueCount > 0
        ? `<p><strong>Stage 1 Ads mode:</strong> ${
            adsMode === 'standard'
              ? 'Standard queue (cheaper, slower — overnight OK)'
              : 'Live (faster)'
          }. Change on Candidates → Run research.</p>`
        : '';
    const ok = await showModal({
      title: 'Process discovery batch?',
      confirmLabel: pursueCount
        ? `Process + Stage 1 (${pursueCount} pursue)`
        : 'Process (no Stage 1)',
      bodyHtml: `<p>Promote <strong>${esc(String(withDecision.length))}</strong> decided rows into Candidates (decision groups).</p>
        <p><strong>Pursue → Stage 1:</strong> ${esc(String(pursueCount))} · est. $${esc(estLow)}–$${esc(estHigh)} DFS</p>
        ${adsLine}
        <p class="muted">maybe/review/hold/pass land in Candidates without research.</p>`,
    });
    if (!ok) return;
    try {
      const result = await api(
        `/api/discovery/batches/${encodeURIComponent(state.discoveryBatchId)}/process`,
        {
          method: 'POST',
          body: JSON.stringify({
            runStage1ForPursue: true,
            concurrency: 1,
            adsMode,
          }),
        },
      );
      state.discoveryRows = result.rows;
      renderDiscoveryTable();
      await loadCandidates();
      if (result.batchJob?.id) {
        state.activeBatchJobId = result.batchJob.id;
        state.activeAct = 'research';
        pollBatchJob(result.batchJob.id);
      }
      await showModal({
        title: 'Batch processed',
        confirmLabel: 'OK',
        bodyHtml: `<p>Promoted <strong>${esc(String(result.promoted.length))}</strong> · skipped ${esc(
          String(result.skipped.length),
        )} · Stage 1 queued for ${esc(String(result.pursueIds?.length || 0))} pursue.${
          (result.promoted || []).some((p) => p.linkedExisting)
            ? ` · ${esc(
                String((result.promoted || []).filter((p) => p.linkedExisting).length),
              )} linked to existing candidates (anti-dupe).`
            : ''
        }</p><p class="muted">pass / deprioritize land in Candidates decision groups (filterable archives).</p>`,
      });
    } catch (error) {
      await showModal({
        title: 'Process failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });
}

async function pollBatchJob(batchJobId) {
  const progress = document.getElementById('job-progress');
  const detailEl = document.getElementById('job-progress-detail');
  if (progress) progress.classList.remove('hidden');
  const tick = async () => {
    try {
      const batch = await api(`/api/jobs/batches/${encodeURIComponent(batchJobId)}`);
      state.lastBatchJob = batch;
      const total = batch.children?.length || 0;
      const done = (batch.done || 0) + (batch.failed || 0);
      const failBits = (batch.children || [])
        .filter((c) => c.status === 'error')
        .slice(0, 2)
        .map((c) => `${c.candidateId}: ${c.error || 'error'}`)
        .join(' · ');
      if (detailEl) {
        detailEl.textContent = `${batch.act}: ${done}/${total} finished · ${batch.running || 0} running · ${
          batch.pending || 0
        } queued${failBits ? ` · ${failBits}` : ''}`;
      }
      state.jobStatusLine = detailEl?.textContent || '';
      if (state.selectedIds.size > 1) renderMultiDetail();
      if (batch.status === 'running') {
        state.pollTimer = setTimeout(tick, 800);
        return;
      }
      state.activeBatchJobId = null;
      state.activeAct = null;
      if (progress) progress.classList.add('hidden');
      await loadCandidates();
      if (state.selectedIds.size > 1) renderMultiDetail();
      else if (state.selectedId) {
        state.detail = await api(`/api/candidates/${encodeURIComponent(state.selectedId)}`);
        renderDetail();
      }
      renderActions();
      const failList = (batch.children || [])
        .filter((c) => c.status === 'error')
        .slice(0, 8)
        .map((c) => `<li>${esc(c.candidateId)}: ${esc(c.error || 'error')}</li>`)
        .join('');
      await showModal({
        title: 'Batch jobs finished',
        confirmLabel: 'OK',
        bodyHtml: `<p>Status: <strong>${esc(batch.status)}</strong> · ok ${esc(
          String(batch.done),
        )} · failed ${esc(String(batch.failed))}</p>${
          failList ? `<ul>${failList}</ul>` : ''
        }`,
      });
    } catch (error) {
      state.activeBatchJobId = null;
      if (progress) progress.classList.add('hidden');
      await showModal({
        title: 'Batch poll failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  };
  tick();
}

await loadHealth();
await loadDfsBalance();
startBalancePolling();
await loadRubric();
wireSettingsUi();
wireUi();
renderDiscoverySourceLegend();
setView('discovery');
try {
  await loadDiscoveryPresets();
  await loadDiscoveryBatches();
} catch {
  /* discovery optional until server restart */
}
await loadCandidates();
