import {
  clusterVolumeHtml,
  competitionOpennessTip,
  computeProposedScore,
  demandVolumeHtml,
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
  thinWordsCalloutHtml,
  thWithTip,
  tipAttr,
  yesNoHtml,
} from './metrics.js';
import { openVisualEditor } from './visual-editor.js';
import {
  ensureResearchMapReady,
  invalidateResearchMapSize,
  openResearchMap,
} from './research-map.js?v=20260902mapFill';
import {
  mountServiceAreaMap,
  mountDiscoveryCitiesMap,
  setServiceAreaTableMode,
  setDiscoveryTableMapMode,
} from './service-area-map.js?v=20260905sa100';
import {
  enableResizableTablesIn,
  enableTableColumnResize,
} from './table-col-resize.js?v=20260825batchNotes14ch';

/** @type {{ destroy: () => void, invalidateSize?: () => void } | null} */
let serviceAreaMount = null;
let serviceAreaLoadGen = 0;
/** @type {string | null} */
let serviceAreaMountedId = null;

function setServiceAreaLoading(visible) {
  const el = document.getElementById('sa-map-loading');
  if (!el) return;
  el.classList.toggle('hidden', !visible);
  el.setAttribute('aria-hidden', visible ? 'false' : 'true');
  el.setAttribute('aria-busy', visible ? 'true' : 'false');
}

function serviceAreaLiveFor(candidateId) {
  return Boolean(
    candidateId &&
      serviceAreaMountedId === candidateId &&
      state.tab === 'site-config' &&
      state.siteConfigOpenStep === 'service-area',
  );
}
/** @type {{ destroy: () => void, invalidateSize?: () => void } | null} */
let discoveryCitiesMount = null;

/** Set large ops tooltip; strips native title to avoid double tips. */
function setElementTip(el, text) {
  if (!el) return;
  el.removeAttribute('title');
  const raw = String(text ?? '').trim();
  if (!raw) {
    el.removeAttribute('data-tip');
    return;
  }
  el.setAttribute('data-tip', raw);
  el.setAttribute('aria-label', raw);
}

/** Sync a table header select-all checkbox to visible row selection. */
function syncHeaderSelectAll(el, { selectedCount, totalCount }) {
  if (!el) return;
  const total = totalCount || 0;
  const selected = selectedCount || 0;
  el.checked = total > 0 && selected === total;
  el.indeterminate = selected > 0 && selected < total;
}

/** Follow-up native `change` after Shift+click range; `change` has no shiftKey. */
let shiftRangePending = null;

function sameShiftRangeKey(a, b) {
  if (a == null || b == null) return false;
  return a === b || String(a) === String(b);
}

function resolveCheckboxFromEvent(event) {
  const t = event?.target;
  if (!t) return null;
  if (t.type === 'checkbox') return t;
  if (typeof t.closest !== 'function') return null;
  const input = t.closest('input[type="checkbox"]');
  if (input) return input;
  const label = t.closest('label');
  if (!label) return null;
  if (label.htmlFor) {
    const byId = document.getElementById(label.htmlFor);
    if (byId?.type === 'checkbox') return byId;
  }
  return label.querySelector('input[type="checkbox"]');
}

function resolveSlotCheckInput(eventTarget, root) {
  if (!eventTarget || typeof eventTarget.closest !== 'function') return null;
  const input = eventTarget.closest('.slot-check-input');
  if (input && (!root || root.contains(input))) return input;
  const label = eventTarget.closest('.slot-check');
  if (!label || (root && !root.contains(label))) return null;
  const inner = label.querySelector('.slot-check-input');
  if (inner && (!root || root.contains(inner))) return inner;
  return null;
}

function consumeShiftRangeChange(input, key) {
  const pending = shiftRangePending;
  if (!pending) return false;
  const inputMatch = Boolean(input && pending.input && input === pending.input);
  const keyMatch = sameShiftRangeKey(pending.key, key);
  if (!inputMatch && !keyMatch) return false;
  shiftRangePending = null;
  if (input) input.checked = pending.want;
  return true;
}

function blockShiftRangePointerDown(event, anchorKey) {
  if (!event.shiftKey || anchorKey == null) return false;
  const input = resolveCheckboxFromEvent(event);
  if (!input) return false;
  event.preventDefault();
  return true;
}

/**
 * Shift+click contiguous range select (file-explorer style).
 * Selects every visible key from the anchor through the clicked key, including the click.
 * Returns true if a range was applied (caller should skip normal toggle / set UI).
 */
function applyShiftRangeCheckboxClick(event, {
  visibleKeys,
  clickedKey,
  anchorKey,
  setAnchor,
  setSelected,
}) {
  const keys = Array.isArray(visibleKeys) ? visibleKeys : [];
  const clickIdx = keys.findIndex((k) => sameShiftRangeKey(k, clickedKey));
  if (clickIdx < 0) {
    setAnchor?.(clickedKey);
    return false;
  }

  if (!event.shiftKey || anchorKey == null) {
    setAnchor?.(clickedKey);
    return false;
  }

  const anchorIdx = keys.findIndex((k) => sameShiftRangeKey(k, anchorKey));
  if (anchorIdx < 0) {
    setAnchor?.(clickedKey);
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  const want = true;
  const lo = Math.min(anchorIdx, clickIdx);
  const hi = Math.max(anchorIdx, clickIdx);
  for (let i = lo; i <= hi; i += 1) setSelected(keys[i], want);
  const input = resolveCheckboxFromEvent(event);
  shiftRangePending = { input, key: clickedKey, want };
  window.setTimeout(() => {
    if (shiftRangePending && shiftRangePending.key === clickedKey && shiftRangePending.input === input) {
      shiftRangePending = null;
    }
  }, 0);
  if (input) {
    input.checked = want;
    queueMicrotask(() => {
      input.checked = want;
    });
  }
  return true;
}

/** After candidate row checkbox changes, refresh selection UI / detail. */
function afterCandidateCheckboxSelection(list) {
  syncHeaderSelectAll(document.getElementById('candidate-select-all'), {
    selectedCount: list.filter((c) => state.selectedIds.has(c.id)).length,
    totalCount: list.length,
  });
  updateCandidateSelectionCount();
  if (state.selectedIds.size > 1) {
    renderList();
    renderActions();
    renderMultiDetail();
  } else if (state.selectedIds.size === 1) {
    void selectCandidate([...state.selectedIds][0]);
  } else {
    renderList();
    renderActions();
    if (state.selectedId) renderDetail();
    else syncCandidatesDetailVisibility();
  }
}

/** Keep in sync with scripts/lib/site-palettes.mjs */
const FALLBACK_PALETTES = [
  {
    id: 'slate-gold',
    label: 'Slate & Gold',
    brand: { primary: '#1C2B3A', accent: '#E8A317', ink: '#0F1720' },
  },
  {
    id: 'forest-copper',
    label: 'Forest & Copper',
    brand: { primary: '#1A3C34', accent: '#C47A3A', ink: '#10201C' },
  },
  {
    id: 'ink-sky',
    label: 'Ink & Sky',
    brand: { primary: '#234E6D', accent: '#3BA3D9', ink: '#0B1220' },
  },
  {
    id: 'brick-sand',
    label: 'Brick & Sand',
    brand: { primary: '#6B2E2B', accent: '#C4A574', ink: '#1A1210' },
  },
  {
    id: 'charcoal-lime',
    label: 'Charcoal & Lime',
    brand: { primary: '#2A2E32', accent: '#B8D43D', ink: '#111314' },
  },
];

/** Keep in sync with scripts/lib/site-fonts.mjs */
const FALLBACK_FONT_THEMES = [
  {
    id: 'archivo-source',
    label: 'Default',
    tip: 'Condensed trades headlines + clear humanist body (current Rover)',
    displayFamily: 'Archivo',
    bodyFamily: 'Source Sans 3',
    displayStack: '"Archivo", "Avenir Next Condensed", ui-sans-serif, system-ui, sans-serif',
    bodyStack: '"Source Sans 3", "Source Sans Pro", ui-sans-serif, system-ui, sans-serif',
    googleHref:
      'https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Source+Sans+3:wght@400;600;700&display=swap',
  },
  {
    id: 'playfair-dm',
    label: 'Fancy',
    tip: 'Editorial serif display + clean geometric body',
    displayFamily: 'Playfair Display',
    bodyFamily: 'DM Sans',
    displayStack: '"Playfair Display", "Times New Roman", Georgia, serif',
    bodyStack: '"DM Sans", "Helvetica Neue", ui-sans-serif, system-ui, sans-serif',
    googleHref:
      'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Playfair+Display:ital,wght@0,600;0,700;1,600&display=swap',
  },
  {
    id: 'outfit-nunito',
    label: 'Friendly',
    tip: 'Warm modern display + soft readable body',
    displayFamily: 'Outfit',
    bodyFamily: 'Nunito Sans',
    displayStack: '"Outfit", "Avenir Next", ui-sans-serif, system-ui, sans-serif',
    bodyStack: '"Nunito Sans", "Segoe UI", ui-sans-serif, system-ui, sans-serif',
    googleHref:
      'https://fonts.googleapis.com/css2?family=Nunito+Sans:ital,opsz,wght@0,6..12,400;0,6..12,600;0,6..12,700;1,6..12,400&family=Outfit:wght@600;700;800&display=swap',
  },
];

function getPalettes() {
  return state.palettes?.length ? state.palettes : FALLBACK_PALETTES;
}

function getFontThemes() {
  return state.fontThemes?.length ? state.fontThemes : FALLBACK_FONT_THEMES;
}

function matchPaletteId(brand = {}) {
  const pHex = String(brand.primary || '').toLowerCase();
  const aHex = String(brand.accent || '').toLowerCase();
  const iHex = String(brand.ink || '').toLowerCase();
  if (brand.paletteId) {
    const byId = getPalettes().find((p) => p.id === brand.paletteId);
    if (byId) return byId.id;
  }
  const hit = getPalettes().find(
    (p) =>
      p.brand.primary.toLowerCase() === pHex &&
      p.brand.accent.toLowerCase() === aHex &&
      p.brand.ink.toLowerCase() === iHex,
  );
  return hit?.id || 'slate-gold';
}

function paletteOptionsHtml(brand = {}) {
  const selected = matchPaletteId(brand);
  return getPalettes()
    .map(
      (p) =>
        `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.label)}</option>`,
    )
    .join('');
}

function paletteSwatchesHtml(brand = {}) {
  const id = matchPaletteId(brand);
  const palette = getPalettes().find((p) => p.id === id) || getPalettes()[0];
  const b = palette?.brand || brand || {};
  return `<span class="palette-swatches" id="sc-brand-swatches" aria-hidden="true">
    <span class="palette-swatch" style="background:${esc(b.primary || '#1C2B3A')}" title="Primary"></span>
    <span class="palette-swatch" style="background:${esc(b.accent || '#E8A317')}" title="Accent"></span>
    <span class="palette-swatch" style="background:${esc(b.ink || '#0F1720')}" title="Ink"></span>
  </span>`;
}

function updatePaletteSwatches(paletteId) {
  const palette = getPalettes().find((p) => p.id === paletteId);
  const root = document.getElementById('sc-brand-swatches');
  if (!palette?.brand || !root) return;
  const spans = root.querySelectorAll('.palette-swatch');
  const colors = [palette.brand.primary, palette.brand.accent, palette.brand.ink];
  spans.forEach((el, i) => {
    if (colors[i]) el.style.background = colors[i];
  });
}

async function ensurePalettes() {
  if (state.palettes?.length) return state.palettes;
  try {
    const data = await api('/api/palettes');
    state.palettes = data.palettes || FALLBACK_PALETTES;
  } catch {
    state.palettes = FALLBACK_PALETTES;
  }
  return state.palettes;
}

async function ensureFontThemes() {
  if (state.fontThemes?.length) return state.fontThemes;
  try {
    const data = await api('/api/font-themes');
    state.fontThemes = data.themes || FALLBACK_FONT_THEMES;
  } catch {
    state.fontThemes = FALLBACK_FONT_THEMES;
  }
  return state.fontThemes;
}

function ensureSiteFontSampleStyles() {
  if (document.getElementById('rover-font-theme-samples')) return;
  const themes = getFontThemes();
  const hrefs = [...new Set(themes.map((t) => t.googleHref).filter(Boolean))];
  hrefs.forEach((href, i) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.id = i === 0 ? 'rover-font-theme-samples' : `rover-font-theme-samples-${i}`;
    document.head.appendChild(link);
  });
}

function matchFontThemeId(brand = {}) {
  const id = String(brand.fontTheme || '').trim();
  if (id && getFontThemes().some((t) => t.id === id)) return id;
  return 'archivo-source';
}

function fontThemeCardsHtml(brand = {}, businessName = '') {
  const current = matchFontThemeId(brand);
  const name = String(businessName || 'Your Business').trim() || 'Your Business';
  return `<div class="font-theme-cards" role="radiogroup" aria-label="Text font">
    ${getFontThemes()
      .map((t) => {
        const on = t.id === current ? 'on' : '';
        return `<button type="button" class="font-theme-card ${on}" data-font-theme="${esc(t.id)}" role="radio" aria-checked="${
          t.id === current ? 'true' : 'false'
        }" data-tip="${esc(t.tip || t.label)}">
          <span class="font-theme-card-label">${esc(t.label)}</span>
          <span class="font-theme-card-sample-display" style="font-family:${esc(t.displayStack)}">Aa</span>
          <span class="font-theme-card-sample-name" style="font-family:${esc(t.displayStack)}">${esc(name)}</span>
          <span class="font-theme-card-sample-body" style="font-family:${esc(t.bodyStack)}">Clear body text for forms, FAQs, and trust copy.</span>
          <span class="font-theme-card-meta muted">${esc(t.displayFamily)} · ${esc(t.bodyFamily)}</span>
        </button>`;
      })
      .join('')}
  </div>`;
}

function hideOpsTooltip() {
  const tip = document.getElementById('ops-tooltip');
  if (!tip) return;
  tip.classList.add('hidden');
  tip.textContent = '';
}

function positionOpsTooltip(tipEl, anchorEl, clientX, clientY) {
  const pad = 12;
  const rect = tipEl.getBoundingClientRect();
  let left;
  let top;
  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    left = clientX + 14;
    top = clientY + 18;
  } else if (anchorEl) {
    const r = anchorEl.getBoundingClientRect();
    left = r.left;
    top = r.bottom + 8;
  } else {
    return;
  }
  if (left + rect.width > window.innerWidth - pad) {
    left = Math.max(pad, window.innerWidth - rect.width - pad);
  }
  if (top + rect.height > window.innerHeight - pad) {
    top = Math.max(pad, (Number.isFinite(clientY) ? clientY : top) - rect.height - 12);
  }
  if (left < pad) left = pad;
  if (top < pad) top = pad;
  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.top = `${Math.round(top)}px`;
}

function showOpsTooltip(anchorEl, clientX, clientY) {
  const tip = document.getElementById('ops-tooltip');
  if (!tip || !anchorEl) return;
  const text = String(anchorEl.getAttribute('data-tip') || '').trim();
  if (!text) {
    hideOpsTooltip();
    return;
  }
  // Avoid native browser tooltip stacking with #ops-tooltip
  anchorEl.removeAttribute('title');
  tip.textContent = text;
  tip.classList.remove('hidden');
  // Measure after show, then place
  positionOpsTooltip(tip, anchorEl, clientX, clientY);
}

function wireOpsTooltips() {
  let activeEl = null;
  const onMove = (event) => {
    if (!activeEl) return;
    showOpsTooltip(activeEl, event.clientX, event.clientY);
  };
  document.addEventListener('pointerover', (event) => {
    const el = event.target?.closest?.('[data-tip]');
    if (!el || !el.getAttribute('data-tip')) return;
    activeEl = el;
    showOpsTooltip(el, event.clientX, event.clientY);
  });
  document.addEventListener('pointerout', (event) => {
    const el = event.target?.closest?.('[data-tip]');
    if (!el || el !== activeEl) return;
    const next = event.relatedTarget?.closest?.('[data-tip]');
    if (next === activeEl) return;
    activeEl = null;
    hideOpsTooltip();
  });
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('focusin', (event) => {
    const el = event.target?.closest?.('[data-tip]');
    if (!el) return;
    activeEl = el;
    showOpsTooltip(el);
  });
  document.addEventListener('focusout', (event) => {
    const el = event.target?.closest?.('[data-tip]');
    if (!el || el !== activeEl) return;
    activeEl = null;
    hideOpsTooltip();
  });
  window.addEventListener('scroll', hideOpsTooltip, true);
  window.addEventListener('resize', hideOpsTooltip);
  document.addEventListener(
    'click',
    (event) => {
      const tip = event.target?.closest?.('summary .tip-info');
      if (!tip) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
}

const state = {
  candidates: [],
  decisionCounts: {},
  selectedId: null,
  selectedIds: new Set(),
  /** Last plain-clicked candidate id for Shift+click range select */
  candidateCheckAnchor: null,
  candidateDecisionFilter: '',
  candidateBatchFilter: '',
  candidateGroupFilter: '',
  candidateVisibilityFilter: 'active',
  candidateTextFilter: '',
  candidateGroups: [],
  archivedCount: 0,
  candidateSort: { key: 'proposedScore', dir: -1 },
  evalConcurrency: 6,
  concurrency: {
    lightSerp: 2,
    evaluations: 6,
    writeSite: 6,
    openaiPhotos: 5,
    openaiBeforeAfter: 2,
    heavy: 2,
  },
  concurrencyMax: {
    lightSerp: 50,
    evaluations: 50,
    writeSite: 50,
    openaiPhotos: 50,
    openaiBeforeAfter: 20,
    heavy: 12,
  },
  detail: null,
  contentOpenStep: null,
  websiteOpenStep: null,
  siteConfigOpenStep: null,
  contentFollowCurrent: undefined,
  websiteFollowCurrent: undefined,
  siteConfigFollowCurrent: undefined,
  view: 'discovery',
  /** @type {'research'|'website-builder'|null} shell mode when on candidates layout */
  pipelineMode: null,
  contentSoftCurrent: null,
  websiteSoftCurrent: null,
  siteConfigSoftCurrent: null,
  contentSoftDone: {},
  websiteSoftDone: {},
  siteConfigSoftDone: {},
  /** Sticky Website → Prepare/preview progress (survives accordion collapse + re-render). */
  assembleProgress: { visible: false, detail: '', done: null, total: null },
  /** Site-Config → Find addresses in-flight (survives re-render). */
  baSearchBusy: false,
  /** 'find' | 'refresh' while baSearchBusy */
  baSearchMode: 'find',
  /** Cached Apify prepaid usage from last Find or /api/apify/usage */
  apifyPlanUsage: null,
  twilioBalance: null,
  apiCostConfigured: null,
  apiCostPayg: null,
  /** Keep Prepare step open while Prepare preview is running. */
  preparePreviewHold: false,
  preparePreviewJobId: null,
  /** Waiting tab opened by Prepare preview (about:blank loader). */
  preparePreviewTab: null,
  heavyJobsSnap: null,
  lightJobsSnap: null,
  /** @type {Record<string, boolean>} candidateId → Twilio ranking number provisioned */
  sitePhoneProvisioned: {},
  phone: {
    sites: [],
    calls: [],
    stats: null,
    selectedSiteId: null,
    selectedCallId: null,
    filterText: '',
    filterPhase: '',
  },
  photoLib: {
    niches: [],
    niche: '',
    groups: [],
    groupId: null,
    view: null,
    selectedMatchKey: null,
    selectedFilename: null,
    selectedRail: null,
    rolePhotos: [],
    selectedChecks: {},
  },
  imageMatchFilter: 'all',
  /** Review images source filter: all | stock | openai */
  imageSourceFilter: 'all',
  /** Review images title search (case-insensitive substring). */
  imageTitleFilter: '',
  /** Full Review-images slot list (not just the active filter). */
  reviewImageSlots: [],
  flux: null,
  reviewBa: null,
  imageSlotChecks: {},
  /** Last plain-clicked Review images slot check id for Shift+click range select */
  imageSlotCheckAnchor: null,
  /** Last plain-clicked Photo tool slot check id for Shift+click range select */
  photoLibCheckAnchor: null,
  /** Review / Photo-lib cards currently showing the generate overlay. */
  imageSlotBusyKeys: {},
  /** Review images Photo groups menu is open. */
  reviewPhotoGroupMenuOpen: false,
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
  discoveryPresets: null,
  discoveryBatches: [],
  discoveryBatchId: null,
  discoveryRows: [],
  discoverySelected: new Set(),
  /** Last plain-clicked Discovery row index for Shift+click range select */
  discoveryCheckAnchor: null,
  discoverySort: { key: null, dir: 1 },
  discoveryFilters: { text: '', human: '', rec: '', mapPack: '' },
  discoveryKnownMode: false,
  discoveryKnownRows: [],
  discoveryKnownSelected: new Set(),
  discoveryKnownCheckAnchor: null,
  discoveryKnownPrunePreview: null,
  lastDiscoveryPack: null,
  discoveryClaudeSent: false,
  sites: [],
  siteStatuses: [],
  sitePaymentMethods: [],
  siteBillingCycles: [],
  selectedSiteId: null,
  siteSort: { key: 'lastLaunchAt', dir: -1 },
  siteFilters: { text: '', status: '', state: '' },
  gscStatus: null,
  sitesPortfolio: { traffic: [], ranks: [] },
  sitesMetricsBusy: false,
  _sitesGscConnectWait: null,
  contentStructureCatalog: null,
  contentStructureCatalogError: null,
  _structureCatalogPromise: null,
};

const DISCOVERY_DECISION_OPTS = [
  '',
  'pursue',
  'maybe',
  'pass',
  'hold',
  'review',
  'ignore',
];

async function api(path, options = {}) {
  let res;
  try {
    const { signal, ...rest } = options;
    res = await fetch(path, {
      headers: { 'content-type': 'application/json', ...(rest.headers || {}) },
      ...rest,
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError' || options.signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    throw new Error(
      'Could not reach Rover ops — is npm run rover still running, or was the prompt response too large? Check the Rover terminal and retry.',
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    if (data.code) err.code = data.code;
    if (data.details) err.details = data.details;
    if (data.suburbCheck) err.suburbCheck = data.suburbCheck;
    if (data.placeholders) err.placeholders = data.placeholders;
    if (data.check) err.check = data.check;
    if (data.contract) err.contract = data.contract;
    if (data.job) err.job = data.job;
    if (data.seoLint) err.seoLint = data.seoLint;
    if (data.speechLint) err.speechLint = data.speechLint;
    if (data.jobId) err.jobId = data.jobId;
    if (data.candidateId) err.candidateId = data.candidateId;
    if (data.running != null) err.running = data.running;
    if (data.limit != null) err.limit = data.limit;
    if (data.selected != null) err.selected = data.selected;
    if (data.batchId) err.batchId = data.batchId;
    if (data.twilioSid) err.twilioSid = data.twilioSid;
    if (data.e164) err.e164 = data.e164;
    if (data.existingId) err.existingId = data.existingId;
    throw err;
  }
  return data;
}

function slicesForTab(tab) {
  switch (tab) {
    case 'prospects':
      return ['prospects'];
    case 'content':
      return ['content', 'images'];
    case 'website':
      return ['content', 'images', 'address'];
    case 'site-config':
      return ['address'];
    default:
      return [];
  }
}

function mergeCandidateDetail(prev, next) {
  if (!next) return prev;
  if (!prev || prev.id !== next.id) return { ...next };
  return {
    ...prev,
    ...next,
    _slices: { ...(prev._slices || {}), ...(next._slices || {}) },
    stageFlags: { ...(prev.stageFlags || {}), ...(next.stageFlags || {}) },
    meta: next.meta ? { ...(prev.meta || {}), ...next.meta } : prev.meta,
  };
}

function candidateDetailUrl(id, slices = []) {
  const list = [...new Set((slices || []).filter(Boolean))];
  const q = list.length ? `?include=${encodeURIComponent(list.join(','))}` : '';
  return `/api/candidates/${encodeURIComponent(id)}${q}`;
}

async function fetchCandidateDetail(id, slices = [], { signal } = {}) {
  return api(candidateDetailUrl(id, slices), { signal });
}

async function ensureDetailSlices(id, slices) {
  const want = [...new Set(slices || [])];
  if (!id) return null;
  const loaded = state.detail?.id === id ? state.detail._slices || {} : {};
  const missing = want.filter((s) => !loaded[s]);
  if (state.detail?.id === id && loaded.shell && !missing.length) return state.detail;
  const next = await fetchCandidateDetail(id, missing.length ? missing : want);
  if (state.selectedId && state.selectedId !== id) return state.detail;
  state.detail = mergeCandidateDetail(state.detail?.id === id ? state.detail : null, next);
  return state.detail;
}

let detailFetchAbort = null;

async function loadSelectedCandidateDetail(id) {
  if (!id) return null;
  try {
    detailFetchAbort?.abort();
  } catch {
    /* ignore */
  }
  const ac = new AbortController();
  detailFetchAbort = ac;
  try {
    const next = await fetchCandidateDetail(id, slicesForTab(state.tab), { signal: ac.signal });
    if (ac.signal.aborted || (state.selectedId && state.selectedId !== id)) return state.detail;
    state.detail = mergeCandidateDetail(state.detail?.id === id ? state.detail : null, next);
    return state.detail;
  } catch (error) {
    if (error?.name === 'AbortError') return state.detail;
    throw error;
  }
}

async function applyCandidatePayload(candidate, id = candidate?.id || state.selectedId) {
  const cid = candidate?.id || id;
  if (candidate && cid) {
    const prev = state.detail?.id === cid ? state.detail : null;
    state.detail = mergeCandidateDetail(prev, candidate);
    if (state.detail?._slices) {
      for (const s of slicesForTab(state.tab)) {
        state.detail._slices[s] = false;
      }
    }
  }
  if (cid) await ensureDetailSlices(cid, slicesForTab(state.tab));
  return state.detail;
}

/** Poll Jobs until a heavy job finishes; returns job.result or throws with check/contract. */
async function waitForHeavyJobResult(jobId, { intervalMs = 400 } = {}) {
  const id = String(jobId || '').trim();
  if (!id) throw new Error('jobId required');
  for (;;) {
    const { job } = await api(`/api/heavy-jobs/${encodeURIComponent(id)}`);
    if (!job) throw new Error('Job not found');
    if (job.status === 'done') return job.result;
    if (job.status === 'error') {
      const err = new Error(job.error || 'Job failed');
      if (job.check) err.check = job.check;
      if (job.contract) err.contract = job.contract;
      throw err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function waitForLightJobResult(jobId, { intervalMs = 400 } = {}) {
  const id = String(jobId || '').trim();
  if (!id) throw new Error('jobId required');
  for (;;) {
    const { job } = await api(`/api/light-jobs/${encodeURIComponent(id)}`);
    if (!job) throw new Error('Job not found');
    if (job.status === 'done') return job.result;
    if (job.status === 'error') {
      const err = new Error(job.error || 'Job failed');
      err.status = 400;
      if (job.check) err.check = job.check;
      if (job.seoLint) err.seoLint = job.seoLint;
      if (job.contract) err.contract = job.contract;
      if (job.speechLint) err.speechLint = job.speechLint;
      throw err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function isSelectedLaunched() {
  const m = state.detail?.meta || {};
  return Boolean(m.lastLaunchAt || m.lastShipAt);
}

/** Modal gate for mutating a launched candidate. Returns false if cancelled. */
async function confirmLaunchedSiteChange(actionLabel = 'This change') {
  if (!isSelectedLaunched()) return true;
  return showModal({
    title: 'Confirm change on launched site',
    confirmLabel: 'Confirm this change',
    cancelLabel: 'Cancel',
    danger: true,
    bodyHtml: `<p><strong>${esc(String(actionLabel))}</strong> on a site that is <strong>already launched</strong>.</p>
      <p>Rover’s working copy will change; the live site will <strong>not</strong> match until you <strong>Push updates</strong>.</p>
      <p class="muted">Cancel if this was accidental. Use Website → <strong>Revert</strong> to restore from the launched GitHub site.</p>`,
  });
}

function withLaunchedConfirmBody(payload = {}) {
  if (!isSelectedLaunched()) return { ...(payload || {}) };
  return { ...(payload || {}), confirmLaunchedEdit: true };
}

function linkUrls(links = []) {
  return (links || [])
    .map((l) => (typeof l === 'string' ? { url: l } : l))
    .filter((l) => l?.url);
}

function tableHeaderCell(h) {
  const s = String(h ?? '');
  if (/^\s*<th[\s>]/i.test(s)) return s;
  return `<th>${esc(s)}</th>`;
}

function tableHtml(headerHtmlOrArray, rows) {
  if (!rows.length) return '<p class="muted">No rows</p>';
  const head =
    typeof headerHtmlOrArray === 'string'
      ? headerHtmlOrArray
      : headerHtmlOrArray.map(tableHeaderCell).join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

function showModal({
  title,
  bodyHtml,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  danger = false,
  hideCancel = false,
  afterOpen = null,
  requireTypedConfirm = null,
}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');
    const typedPhrase = requireTypedConfirm != null ? String(requireTypedConfirm) : '';

    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    if (typedPhrase) {
      bodyEl.insertAdjacentHTML(
        'beforeend',
        `<label class="modal-type-confirm-label">
          <span class="muted small">Type <code>${esc(typedPhrase)}</code> to enable confirmation</span>
          <input id="modal-type-confirm" class="modal-type-confirm-input" type="text" autocomplete="off" spellcheck="false" />
        </label>`,
      );
    }
    confirmBtn.textContent = confirmLabel;
    confirmBtn.classList.toggle('danger', danger);
    confirmBtn.classList.toggle('primary', !danger);
    cancelBtn.textContent = cancelLabel;
    cancelBtn.classList.toggle('hidden', Boolean(hideCancel));
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');

    let onTypedInput = null;
    const typedInput = typedPhrase ? bodyEl.querySelector('#modal-type-confirm') : null;
    if (typedInput) {
      confirmBtn.disabled = true;
      onTypedInput = () => {
        confirmBtn.disabled = typedInput.value !== typedPhrase;
      };
      typedInput.addEventListener('input', onTypedInput);
      typedInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !confirmBtn.disabled) {
          e.preventDefault();
          confirmBtn.click();
        }
      });
      setTimeout(() => typedInput.focus(), 0);
    } else {
      confirmBtn.disabled = false;
    }

    if (typeof afterOpen === 'function') {
      try {
        afterOpen(bodyEl);
      } catch {
        // ignore bind errors
      }
    }

    const close = (result) => {
      if (typedInput && onTypedInput) {
        typedInput.removeEventListener('input', onTypedInput);
      }
      root.classList.add('hidden');
      root.setAttribute('aria-hidden', 'true');
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      confirmBtn.disabled = false;
      root.querySelector('.modal-backdrop').onclick = null;
      cancelBtn.classList.remove('hidden');
      cancelBtn.textContent = 'Cancel';
      resolve(result);
    };

    confirmBtn.onclick = () => {
      if (typedPhrase && typedInput && typedInput.value !== typedPhrase) return;
      close(true);
    };
    cancelBtn.onclick = () => close(false);
    root.querySelector('.modal-backdrop').onclick = () => close(false);
  });
}

function bannerTone(tone) {
  return tone === 'warn' ? 'warn' : tone === 'err' ? 'err' : 'ok';
}

/** Leftover status — top banner, no sound. */
function showToast(message, { tone = 'ok', ms } = {}) {
  showCompleteBanner(message, ms != null ? { tone, ms } : { tone });
}

function prefersReducedMotion() {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
}

/** Soft two-tone complete chime (Web Audio). Failures swallowed. */
function playCompleteSound() {
  if (prefersReducedMotion()) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!playCompleteSound._ctx) playCompleteSound._ctx = new Ctx();
    const ctx = playCompleteSound._ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const tones = [
      { f: 660, t: 0, d: 0.12 },
      { f: 880, t: 0.1, d: 0.18 },
    ];
    for (const { f, t, d } of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.12, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + d);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + d + 0.02);
    }
  } catch {
    /* autoplay / unsupported */
  }
}

/** Top-center slide-in banner. Message is shown as-is. */
function showCompleteBanner(message, { ms = 6000, tone = 'ok' } = {}) {
  const text = String(message || '').trim() || 'Done';
  let el = document.getElementById('ops-complete-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ops-complete-banner';
    el.className = 'ops-complete-banner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = text;
  const reduce = prefersReducedMotion();
  el.classList.toggle('no-motion', reduce);
  el.classList.remove('hidden', 'is-visible', 'tone-ok', 'tone-warn', 'tone-err');
  el.classList.add(`tone-${bannerTone(tone)}`);
  // Force reflow so re-showing retriggers the slide.
  void el.offsetWidth;
  requestAnimationFrame(() => {
    el.classList.add('is-visible');
  });
  clearTimeout(showCompleteBanner._timer);
  showCompleteBanner._timer = setTimeout(() => {
    el.classList.remove('is-visible');
    clearTimeout(showCompleteBanner._hideTimer);
    showCompleteBanner._hideTimer = setTimeout(() => {
      el.classList.add('hidden');
    }, reduce ? 0 : 280);
  }, ms);
}

/** Sound + top banner with an existing message (no “complete” suffix). */
function announceBanner(message, opts) {
  playCompleteSound();
  showCompleteBanner(message, opts);
}

/** Sound + “{step} complete” when a listed job/step finishes. */
function announceStepComplete(stepLabel) {
  const label = String(stepLabel || 'Step').trim() || 'Step';
  announceBanner(`${label} complete`);
}

/** Fill a .job-progress-bar from done/total; clear for indeterminate. */
function setDeterminateProgress(barEl, { done, total } = {}) {
  if (!barEl) return;
  const t = Number(total);
  const d = Number(done);
  if (!Number.isFinite(t) || t <= 0) {
    barEl.classList.remove('is-determinate');
    barEl.style.width = '';
    barEl.style.animation = '';
    return;
  }
  const pct = Math.max(0, Math.min(100, Math.round((100 * (Number.isFinite(d) ? d : 0)) / t)));
  barEl.classList.add('is-determinate');
  barEl.style.animation = 'none';
  barEl.style.width = `${pct}%`;
}

/** Keep job overlays flush under the sticky header. */
function syncJobOverlayTop() {
  const top = document.querySelector('.top');
  const y = top?.getBoundingClientRect().bottom || 56;
  document.documentElement.style.setProperty('--rover-job-overlay-top', `${Math.round(y)}px`);
}
window.addEventListener('resize', syncJobOverlayTop);

/** In-page bars last shown from a job snapshot — only those get auto-cleared. */
const jobSyncedBarOn = {
  accept: false,
  pull: false,
  logoMap: false,
  launch: false,
  openai: false,
};

/** jobId → { candidateId, groupId, slotKey, kind } */
const openaiJobWatch = new Map();
const openaiJobHandled = new Set();
/** @type {{ jobIds: string[], candidateId?: string, groupId?: string, failures: string[], announced: boolean }[]} */
const openaiBatches = [];
let openaiCommitChain = Promise.resolve();

function enqueueOpenaiCommit(fn) {
  const run = openaiCommitChain.then(() => fn());
  openaiCommitChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

function watchOpenaiJobList(jobs, { candidateId, groupId } = {}) {
  const ids = [];
  for (const row of jobs || []) {
    const jobId = String(row.jobId || row.id || '').trim();
    if (!jobId) continue;
    ids.push(jobId);
    openaiJobHandled.delete(jobId);
    openaiJobWatch.set(jobId, {
      candidateId: candidateId || row.candidateId || null,
      groupId: groupId || null,
      slotKey: row.slotKey || row.matchKey || null,
      kind: row.kind || null,
    });
  }
  if (ids.length) {
    openaiBatches.push({
      jobIds: ids,
      candidateId: candidateId || null,
      groupId: groupId || null,
      failures: [],
      announced: false,
    });
  }
  return ids;
}

async function consumeOpenaiJobFinish(job) {
  const id = String(job?.id || '');
  const meta = openaiJobWatch.get(id);
  if (!meta) return;
  openaiJobWatch.delete(id);
  const slotKey = job.slotKey || job.matchKey || meta.slotKey;
  if (job.status === 'error') {
    await settleSlotBusy(slotKey);
    return;
  }
  let result = job.result;
  if (!result) {
    try {
      const packed = await api(`/api/light-jobs/${encodeURIComponent(id)}`);
      result = packed.job?.result;
    } catch {
      result = null;
    }
  }
  const cid = meta.candidateId;
  const isGroup = Boolean(meta.groupId) || String(cid || '').startsWith('photo-group:');
  if (!isGroup) {
    if (cid && state.selectedId === cid) {
      await commitReviewSlot(cid, {
        status: result?.status,
        slotKey,
        candidate: result?.candidate,
      });
    } else {
      await settleSlotBusy(slotKey);
    }
    return;
  }
  const gid = meta.groupId || String(cid || '').replace(/^photo-group:/, '');
  if (gid && photoLibCurrent()?.groupId === gid) {
    try {
      await loadPhotoGroupView();
      renderPhotoView();
    } catch {
      /* ignore */
    }
  }
  await settleSlotBusy(slotKey);
}

function syncOpenaiGenerateFromSnap(snap) {
  const jobs = snap?.jobs || [];
  const openai = jobs.filter((j) => j.phase === 'openai-photo' || j.phase === 'openai-ba');
  const cid = state.selectedId;
  const pgId = photoLibCurrent()?.groupId || '';
  const pgKey = pgId ? `photo-group:${pgId}` : '';
  for (const j of openai) {
    if (j.status !== 'running' && j.status !== 'queued') continue;
    const here =
      j.candidateId === cid || j.candidateId === pgKey || openaiJobWatch.has(String(j.id));
    const key = j.slotKey || j.matchKey;
    if (here && key) beginSlotBusy(key, null, { scroll: false });
  }
  for (const j of openai) {
    const id = String(j.id);
    if (!openaiJobWatch.has(id) || openaiJobHandled.has(id)) continue;
    if (j.status !== 'done' && j.status !== 'error') continue;
    openaiJobHandled.add(id);
    if (j.status === 'error') {
      const batch = openaiBatches.find((b) => b.jobIds.includes(id));
      const meta = openaiJobWatch.get(id);
      const key = j.slotKey || j.matchKey || meta?.slotKey || id;
      if (batch) batch.failures.push(`${key}: ${j.error || 'Generate failed'}`);
    }
    enqueueOpenaiCommit(() => consumeOpenaiJobFinish(j));
  }
  let pending = 0;
  let total = 0;
  for (const batch of openaiBatches) {
    if (batch.announced) continue;
    const remaining = batch.jobIds.filter((id) => !openaiJobHandled.has(id));
    pending += remaining.length;
    total += batch.jobIds.length;
    if (!remaining.length) {
      batch.announced = true;
      const failures = [...batch.failures];
      const n = batch.jobIds.length;
      enqueueOpenaiCommit(async () => {
        jobSyncedBarOn.openai = false;
        setImagesProgress(false);
        if (failures.length) {
          if (!(await showGenerateFailures(failures))) {
            announceBanner(
              `Generated with ${failures.length} error${failures.length === 1 ? '' : 's'}.`,
              { tone: 'warn' },
            );
          }
        } else {
          announceBanner(`Generated ${n} OpenAI job${n === 1 ? '' : 's'}.`);
        }
        refreshImageWallets({ fresh: true });
      });
    }
  }
  if (pending) {
    jobSyncedBarOn.openai = true;
    paintOpenaiBatchProgress(Math.max(0, total - pending), total);
  } else if (jobSyncedBarOn.openai) {
    jobSyncedBarOn.openai = false;
    setImagesProgress(false);
  }
}

function formatGenerateElapsed(ms) {
  const s = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function watchGenerateProgress({
  label,
  detail,
  index = 1,
  total = 1,
  kind = 'photo',
} = {}) {
  const watchStarted = Date.now();
  let timer = null;
  const paint = () => {
    const elapsed = Date.now() - watchStarted;
    const bits = [];
    if (Number(total) > 1) bits.push(`${index} / ${total}`);
    if (detail) bits.push(detail);
    bits.push('generating');
    bits.push(formatGenerateElapsed(elapsed));
    const waiting = Math.max(0, Number(total) - Number(index));
    if (waiting) bits.push(`${waiting} waiting`);
    const multi = Number(total) > 1;
    setImagesProgress(true, {
      label: multi
        ? `Images loading ${index}`
        : label || (kind === 'pair' ? 'Generating pair…' : 'Generating…'),
      detail: multi ? `Images loading ${index}` : bits.join(' · '),
      current: Math.max(0, Number(index) - 1),
      total: Number(total),
    });
  };
  paint();
  timer = setInterval(paint, 800);
  return {
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

function findGeneratingSlotCard(key) {
  const id = String(key || '').trim();
  if (!id) return null;
  const raw = id.replace(/^ba:/, '');
  const keys = [...new Set([id, raw].filter(Boolean))];
  const roots = [document.getElementById('ca-image-slots'), document.getElementById('photo-group-body')].filter(
    Boolean,
  );
  for (const root of roots) {
    for (const card of root.querySelectorAll('.image-slot-card')) {
      const slotKey = card.getAttribute('data-slot-key') || '';
      const matchKey = card.getAttribute('data-match-key') || '';
      const checkId = card.querySelector('.slot-check-input')?.getAttribute('data-check-id') || '';
      if (keys.some((k) => k === slotKey || k === matchKey || k === checkId)) return card;
    }
  }
  return null;
}

function slotGenerateOverlayHtml() {
  return `<div class="slot-generate-overlay" aria-hidden="true">
    <div class="rover-loader rover-loader--dark rover-loader--mark-only">
      <svg class="rover-loader-mark" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <circle class="rover-loader-dot" cx="32" cy="32" r="7.5" />
        <g class="rover-loader-ring rover-loader-ring--inner">
          <circle cx="32" cy="32" r="15" transform="rotate(-45 32 32)" />
        </g>
        <g class="rover-loader-ring rover-loader-ring--outer">
          <circle cx="32" cy="32" r="24" transform="rotate(-11 32 32)" />
        </g>
      </svg>
    </div>
  </div>`;
}

function slotGenerateOverlayHost(card) {
  if (!card) return null;
  return card.querySelector('.ba-pair-thumbs') || card.querySelector('.slot-thumb') || card;
}

function setSlotGenerateOverlay(card, on) {
  const host = slotGenerateOverlayHost(card);
  if (!host) return;
  const overlay =
    host.querySelector(':scope > .slot-generate-overlay') ||
    (host !== card ? card.querySelector(':scope > .slot-generate-overlay') : null);
  if (on) {
    if (!overlay) host.insertAdjacentHTML('beforeend', slotGenerateOverlayHtml());
  } else if (overlay) {
    overlay.remove();
  }
}

function slotBusyKeyList() {
  return Object.keys(state.imageSlotBusyKeys || {}).filter(Boolean);
}

function beginSlotBusy(key, cardEl, { scroll = true } = {}) {
  const next = String(key || '').trim();
  if (!next) return;
  state.imageSlotBusyKeys = { ...(state.imageSlotBusyKeys || {}), [next]: true };
  const card =
    (cardEl && typeof cardEl.closest === 'function' ? cardEl.closest('.image-slot-card') : null) ||
    findGeneratingSlotCard(next);
  if (!card) return;
  setSlotGenerateOverlay(card, true);
  if (scroll && typeof card.scrollIntoView === 'function') {
    card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function restoreSlotBusyOverlays() {
  for (const key of slotBusyKeyList()) {
    const card = findGeneratingSlotCard(key);
    if (card) setSlotGenerateOverlay(card, true);
  }
}

function waitSlotThumbLoaded(card, timeoutMs = 8000) {
  const host = slotGenerateOverlayHost(card);
  if (!host) return Promise.resolve();
  const imgs = [...host.querySelectorAll('img')].filter((img) => !img.closest('.slot-generate-overlay'));
  if (!imgs.length) return Promise.resolve();
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete && img.naturalWidth) {
            resolve();
            return;
          }
          const done = () => {
            img.removeEventListener('load', done);
            img.removeEventListener('error', done);
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(done, timeoutMs);
          img.addEventListener('load', done);
          img.addEventListener('error', done);
        }),
    ),
  );
}

async function settleSlotBusy(key) {
  const keys = key != null && String(key).trim() ? [String(key).trim()] : slotBusyKeyList();
  for (const k of keys) {
    try {
      const card = findGeneratingSlotCard(k);
      if (card) {
        setSlotGenerateOverlay(card, true);
        await waitSlotThumbLoaded(card);
      }
      const live = findGeneratingSlotCard(k);
      if (live) setSlotGenerateOverlay(live, false);
    } finally {
      const next = { ...(state.imageSlotBusyKeys || {}) };
      const raw = String(k).replace(/^ba:/, '');
      delete next[k];
      if (raw) delete next[raw];
      if (raw && !String(k).startsWith('ba:')) delete next[`ba:${raw}`];
      state.imageSlotBusyKeys = next;
    }
  }
}

let reviewImagesWorkDepth = 0;

function hideReviewImagesProgress() {
  if (reviewImagesWorkDepth > 0) return;
  setImagesProgress(false);
}

async function withReviewImagesWork({ label, detail, key, card } = {}, fn) {
  reviewImagesWorkDepth += 1;
  const workLabel = label || 'Images loading…';
  setImagesProgress(true, {
    label: workLabel,
    detail: detail || workLabel,
  });
  const busyKey = String(key || '').trim();
  if (busyKey) beginSlotBusy(busyKey, card, { scroll: Boolean(card) });
  try {
    return await fn();
  } finally {
    if (busyKey) await settleSlotBusy(busyKey);
    reviewImagesWorkDepth = Math.max(0, reviewImagesWorkDepth - 1);
    hideReviewImagesProgress();
  }
}

async function withFluxProgress(opts, fn) {
  const watch = watchGenerateProgress(opts);
  if (opts?.detail) beginSlotBusy(opts.detail, opts.card);
  try {
    return await fn();
  } finally {
    watch.stop();
  }
}

function slugifyPreviewName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function isAssembleStaleClient(d) {
  const staged = d?.meta?.lastSiteStagingAt;
  if (!staged) return false;
  const assembled = d?.meta?.lastAssembleAt;
  if (!assembled) return true;
  const s = Date.parse(staged);
  const a = Date.parse(assembled);
  if (!Number.isFinite(s)) return false;
  if (!Number.isFinite(a)) return true;
  return s > a;
}

function structurePageIdsFromDetail(d) {
  const fromOutline = d?.contentOutlinePackage?.pageIds;
  if (Array.isArray(fromOutline) && fromOutline.length) return fromOutline;
  const fromStructure = d?.contentStructure?.pages;
  if (Array.isArray(fromStructure) && fromStructure.length) return fromStructure;
  return ['home', 'about', 'contact'];
}

/** Expected ### FILE paths for Accept given outline + site-config */
function expectedDraftFilesFromDetail(d) {
  const pages = new Set(structurePageIdsFromDetail(d));
  const cfg = d?.siteConfig || {};
  const files = [];
  if (pages.has('home')) files.push('src/content/pages/index.md');
  if (pages.has('about')) files.push('src/content/pages/about.md');
  if (pages.has('contact')) files.push('src/content/pages/contact.md');
  if (pages.has('services')) {
    for (const name of [...(cfg.services || []), ...(cfg.commercialServices || [])]) {
      const slug = slugifyPreviewName(name);
      if (slug) files.push(`src/content/services/${slug}.md`);
    }
  }
  if (pages.has('locations')) {
    const seen = new Set();
    for (const name of [cfg.primaryCity, ...(cfg.targetSuburbs || [])]) {
      const n = String(name || '').trim();
      if (!n) continue;
      const slug = slugifyPreviewName(n);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      files.push(`src/content/locations/${slug}.md`);
    }
  }
  return files;
}

function shortDraftPath(path) {
  return String(path || '')
    .replace(/^src\/content\//, '')
    .trim();
}

function missingDraftFilesListHtml(missing, { limit = 0 } = {}) {
  const list = Array.isArray(missing) ? missing : [];
  if (!list.length) return '';
  const show = limit > 0 ? list.slice(0, limit) : list;
  const items = show
    .map((f) => `<li><code>${esc(shortDraftPath(f))}</code></li>`)
    .join('');
  const more =
    limit > 0 && list.length > limit
      ? `<li class="muted">+${esc(String(list.length - limit))} more</li>`
      : '';
  return `<ul class="narrative-list" style="margin:0.35rem 0 0">${items}${more}</ul>`;
}

/** Copy continue-write prompt (missing + stub/thin gaps). Safe from modals or Content step. */
async function copyContinueWritePrompt(candidateId) {
  try {
    const data = await api(
      `/api/candidates/${encodeURIComponent(candidateId)}/content/structure/continue-prompt`,
    );
    await navigator.clipboard.writeText(data.prompt || '');
    const n = data.count || 0;
    showToast(
      n
        ? `Continue prompt copied (${n} file${n === 1 ? '' : 's'}).`
        : 'Continue prompt copied to clipboard.',
    );
  } catch (error) {
    await showModal({
      title: 'Copy failed',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
  }
}

function continueWriteControlsHtml({ sm = false } = {}) {
  const cls = `btn primary${sm ? ' btn-sm' : ''} js-copy-continue-prompt`;
  return `<div class="content-continue-actions" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin:0.5rem 0 0">
    <button type="button" class="${cls}" data-tip="Copy a Claude prompt scoped to missing and stub/thin FILEs only">Copy continue prompt</button>
    ${openClaudeAiBtnHtml({ sm })}
  </div>`;
}

function draftFileBatch(path) {
  const p = String(path || '').replace(/\\/g, '/');
  if (/\/pages\/(index|about|contact)\.md$/i.test(p)) return 'Home';
  if (/\/services\//i.test(p)) return 'Services';
  if (/\/locations\//i.test(p)) return 'Locations';
  return null;
}

function uniqueDraftBatches(paths) {
  const order = ['Home', 'Services', 'Locations'];
  const set = new Set();
  for (const rel of paths || []) {
    const b = draftFileBatch(rel);
    if (b) set.add(b);
  }
  return order.filter((b) => set.has(b));
}

function joinBatchNames(list) {
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

/** Shared incomplete-draft copy for modal + Content callouts */
function incompleteDraftExplainHtml({
  have,
  expectedCount,
  missing,
  stubs = [],
  expected = [],
  compact = false,
  showContinueControls = true,
} = {}) {
  const miss = Array.isArray(missing) ? missing : [];
  const stubList = Array.isArray(stubs) ? stubs : [];
  if (!miss.length && !stubList.length) return '';
  const haveN = Number(have) || 0;
  const expN = Number(expectedCount) || haveN + miss.length;
  const progress = miss.length
    ? `<strong>Loaded ${esc(String(haveN))} of ${esc(String(expN))} required files.</strong>`
    : `<strong>All ${esc(String(expN))} required files are present, but ${esc(String(stubList.length))} are stub/thin.</strong>`;
  const missingSet = new Set(miss);
  const missingBatches = uniqueDraftBatches(miss);
  const stubBatches = uniqueDraftBatches(stubList);
  const present = (Array.isArray(expected) ? expected : []).filter((f) => !missingSet.has(f));
  const loadedBatches = uniqueDraftBatches(present);
  const bits = [];
  if (miss.length) {
    if (loadedBatches.length) {
      const verb = loadedBatches.length === 1 ? 'is' : 'are';
      bits.push(`${joinBatchNames(loadedBatches)} ${verb} loaded.`);
    }
    const copyWord = missingBatches.length === 1 ? 'that batch' : 'those batches';
    const missingLabel = joinBatchNames(missingBatches) || 'the missing files';
    bits.push(
      `Continue with <strong>${esc(missingLabel)}</strong> — Copy ${copyWord} (or <strong>Copy continue prompt</strong>), paste FILE blocks, Load again.`,
    );
  }
  if (stubList.length) {
    bits.push(
      `${esc(joinBatchNames(stubBatches) || 'Some')} pages are too thin — <strong>Copy continue prompt</strong> and Load again.`,
    );
  }
  const instruct = bits.length
    ? `<p style="margin:0.35rem 0 0">${bits.join(' ')}</p>`
    : '';
  const controls = showContinueControls ? continueWriteControlsHtml({ sm: compact }) : '';
  const missBlock = miss.length
    ? `<details class="narrative-raw" style="margin-top:0.5rem">
        <summary>Missing files (${esc(String(miss.length))})</summary>
        ${missingDraftFilesListHtml(miss, { limit: compact ? 8 : 0 })}
      </details>`
    : '';
  const stubBlock = stubList.length
    ? `<details class="narrative-raw" style="margin-top:0.35rem" ${compact && !miss.length ? 'open' : ''}>
        <summary>Stub / thin (need rewrite) (${esc(String(stubList.length))})</summary>
        ${missingDraftFilesListHtml(stubList, { limit: compact ? 8 : 0 })}
      </details>`
    : '';
  return `<div class="callout warn">
      <p style="margin:0">${progress}${
        compact && miss.length ? ` Missing ${esc(String(miss.length))} file(s).` : ''
      }${compact && stubList.length ? ` ${esc(String(stubList.length))} stub/thin.` : ''}</p>
      ${instruct}
      ${controls}
      ${missBlock}
      ${stubBlock}
    </div>`;
}

function incompleteDraftCalloutHtml(d) {
  if (!d?.contentDraft?.files && !d?.contentDraft?._ops?.fileList?.length) return '';
  const expected = expectedDraftFilesFromDetail(d);
  if (!expected.length) return '';
  const pages = structurePageIdsFromDetail(d);
  const needsFull =
    pages.includes('about') ||
    pages.includes('contact') ||
    pages.includes('services') ||
    pages.includes('locations');
  if (!needsFull) return '';
  const have = new Set(
    d?.contentDraft?._ops?.fileList ||
      (d?.contentDraft?.files ? Object.keys(d.contentDraft.files) : []),
  );
  const missing = expected.filter((f) => !have.has(f));
  const stubs = Array.isArray(d?.contentDraft?._ops?.check?.launch?.stubs)
    ? d.contentDraft._ops.check.launch.stubs.filter((f) => have.has(f))
    : [];
  if (!missing.length && !stubs.length) return '';
  return incompleteDraftExplainHtml({
    have: have.size,
    expectedCount: expected.length,
    missing,
    stubs,
    expected,
    compact: true,
  });
}

function previewSitemapEntries(d, baseUrl = 'http://127.0.0.1:4322') {
  const base = String(baseUrl).replace(/\/$/, '');
  const cfg = d?.siteConfig || {};
  const pages = new Set(structurePageIdsFromDetail(d));
  const entries = [];
  const push = (label, path) => {
    const p = path.startsWith('/') ? path : `/${path}`;
    entries.push({ label, path: p, url: `${base}${p === '/' ? '/' : p}` });
  };
  if (pages.has('home')) push('Home', '/');
  if (pages.has('about')) push('About', '/about');
  if (pages.has('contact')) push('Contact', '/contact');
  if (pages.has('services')) {
    for (const name of [...(cfg.services || []), ...(cfg.commercialServices || [])]) {
      const slug = slugifyPreviewName(name);
      if (slug) push(String(name), `/services/${slug}`);
    }
  }
  if (pages.has('locations')) {
    const seen = new Set();
    for (const name of [cfg.primaryCity, ...(cfg.targetSuburbs || [])]) {
      const label = String(name || '').trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const slug = slugifyPreviewName(label);
      if (slug) push(`${label} (location)`, `/locations/${slug}`);
    }
  }
  return entries;
}

function previewSitemapHtml(d) {
  const entries = previewSitemapEntries(d);
  if (!entries.length) return '';
  const links = entries
    .map(
      (e) =>
        `<li><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.label)}</a> <span class="muted"><code>${esc(
          e.path,
        )}</code></span></li>`,
    )
    .join('');
  return `<div class="preview-sitemap">
    <h4>Preview sitemap (assembled :4322)</h4>
    <p class="muted small">Open every URL before Launch — this is launch fidelity.</p>
    <ul class="narrative-list">${links}</ul>
  </div>`;
}

async function loadHealth() {
  state.health = await api('/api/health');
  const h = state.health;
  const hostEl = document.getElementById('settings-host');
  const connEl = document.getElementById('settings-connections');
  const listEl = document.getElementById('settings-connections-list');
  if (hostEl) {
    hostEl.textContent =
      h.host && h.port != null ? `${h.host}:${h.port}` : h.host || '127.0.0.1';
  }
  const c = h.connections || {};
  const total = Number(c.total) || 0;
  const ok = Number(c.ok) || 0;
  if (connEl) connEl.textContent = total ? `${ok}/${total}` : '—';
  if (listEl) {
    const items = Array.isArray(c.items) ? c.items : [];
    let lastGroup = null;
    listEl.innerHTML = items
      .map((item) => {
        const group = String(item.group || '').trim();
        let groupHtml = '';
        if (group && group !== lastGroup) {
          lastGroup = group;
          groupHtml = `<div class="settings-conn-group">${esc(group)}</div>`;
        }
        const good = Boolean(item.ok);
        const mark = good ? '✓' : '✕';
        const cls = good ? 'settings-conn-ok' : 'settings-conn-bad';
        return `${groupHtml}<div class="settings-conn-item">
          <span class="settings-conn-name">${esc(item.name || '')}</span>
          <span class="${cls}" aria-label="${good ? 'configured' : 'missing'}">${mark}</span>
        </div>`;
      })
      .join('');
  }
}

/** One-time map: Light 1–4 / Dark 5–8 (schema v2). Old 5→4 Warm, old 4→5 Dark Teal. */
function migrateThemeIdSchema(raw) {
  const id = String(raw || '').trim();
  if (id === 'dark') return '5';
  if (id === 'light') return '1';
  if (id === '4') return '5';
  if (id === '5') return '4';
  return id;
}

function normalizeThemeId(raw) {
  if (raw === 'dark') return '5';
  if (raw === 'light') return '1';
  const id = String(raw || '').trim();
  return /^[1-8]$/.test(id) ? id : '1';
}

function getTheme() {
  try {
    migrateStoredThemeIfNeeded();
    return normalizeThemeId(localStorage.getItem('ops.theme'));
  } catch {
    return '1';
  }
}

function migrateStoredThemeIfNeeded() {
  try {
    if (localStorage.getItem('ops.themeSchema') === '2') return;
    const prev = localStorage.getItem('ops.theme');
    const next = normalizeThemeId(migrateThemeIdSchema(prev));
    localStorage.setItem('ops.theme', next);
    localStorage.setItem('ops.themeSchema', '2');
  } catch {
    /* ignore */
  }
}

function applyTheme(theme) {
  const next = normalizeThemeId(theme);
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('ops.theme', next);
    localStorage.setItem('ops.themeSchema', '2');
  } catch {
    /* ignore */
  }
  document.querySelectorAll('[data-theme-pick]').forEach((btn) => {
    const on = btn.getAttribute('data-theme-pick') === next;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  return next;
}

function closeSettingsMenu() {
  const menu = document.getElementById('settings-menu');
  const btn = document.getElementById('settings-btn');
  if (menu) menu.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  hideOpsTooltip();
}

function closeApiCostMenu() {
  const menu = document.getElementById('api-cost-menu');
  const btn = document.getElementById('api-cost-btn');
  if (menu) menu.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function closeAllJobPopovers() {
  closeHelpPanel();
}

function closeHelpPanel() {
  const pop = document.getElementById('help-panel');
  const btn = document.getElementById('help-btn');
  if (pop) pop.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function wireHelpUi() {
  const btn = document.getElementById('help-btn');
  const pop = document.getElementById('help-panel');
  const search = document.getElementById('help-search');
  const toc = document.getElementById('help-toc');
  const article = document.getElementById('help-article');
  if (!btn || !pop || !toc || !article) return;

  /** @type {{ title: string, sections: Array<{ id: string, title: string, level: number, html: string, text: string }> } | null} */
  let guide = null;
  let loaded = false;

  const renderGuide = (query = '') => {
    const q = String(query || '').trim().toLowerCase();
    const sections = Array.isArray(guide?.sections) ? guide.sections : [];
    const shown = q
      ? sections.filter((s) => String(s.text || '').toLowerCase().includes(q))
      : sections;
    if (!shown.length) {
      toc.innerHTML = '';
      article.innerHTML = `<p class="muted small help-empty">${
        q ? 'No matching sections.' : 'Help is empty.'
      }</p>`;
      return;
    }
    toc.innerHTML = shown
      .map(
        (s) =>
          `<button type="button" class="help-toc-item level-${Number(s.level) || 2}" data-help-id="${esc(
            s.id,
          )}">${esc(s.title)}</button>`,
      )
      .join('');
    article.innerHTML = shown
      .map((s) => {
        const tag = Number(s.level) === 3 ? 'h3' : 'h2';
        return `<section class="help-section" id="help-sec-${esc(s.id)}"><${tag}>${esc(
          s.title,
        )}</${tag}>${s.html || ''}</section>`;
      })
      .join('');
    toc.querySelectorAll('[data-help-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-help-id');
        const target = document.getElementById(`help-sec-${id}`);
        toc.querySelectorAll('.help-toc-item').forEach((item) => {
          item.classList.toggle('is-active', item === el);
        });
        if (target) target.scrollIntoView({ block: 'start' });
      });
    });
  };

  const ensureLoaded = async () => {
    if (loaded && guide) {
      renderGuide(search?.value || '');
      return;
    }
    try {
      guide = await api('/api/help/user-guide');
      loaded = true;
      renderGuide(search?.value || '');
    } catch (error) {
      article.innerHTML = `<p class="muted small help-empty">${esc(error.message || 'Could not load Help.')}</p>`;
    }
  };

  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = pop.classList.contains('hidden');
    if (willOpen) {
      closeSettingsMenu();
      closeApiCostMenu();
      pop.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      void ensureLoaded();
      search?.focus();
    } else {
      closeHelpPanel();
    }
  });
  pop.addEventListener('click', (event) => event.stopPropagation());
  search?.addEventListener('input', () => renderGuide(search.value));
  search?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeHelpPanel();
    }
  });
}

function applyConcurrencyPayload(data) {
  const next = { ...state.concurrency };
  const keys = ['lightSerp', 'evaluations', 'writeSite', 'openaiPhotos', 'openaiBeforeAfter', 'heavy'];
  for (const key of keys) {
    const n = Number(data?.[key]);
    if (Number.isFinite(n) && n >= 1) next[key] = n;
  }
  state.concurrency = next;
  state.evalConcurrency = next.evaluations;
  if (data?.max && typeof data.max === 'object') {
    state.concurrencyMax = { ...state.concurrencyMax, ...data.max };
  }
}

function syncSettingsConcurrencyInputs() {
  document.querySelectorAll('[data-conc-key]').forEach((input) => {
    const key = input.getAttribute('data-conc-key');
    const n = Number(state.concurrency?.[key]);
    if (!Number.isFinite(n)) return;
    const max = Number(state.concurrencyMax?.[key]) || Number(input.max) || 50;
    const v = String(Math.max(1, Math.min(max, Math.round(n))));
    if (input.value !== v) input.value = v;
    const tip = `Maximum ${max}`;
    input.setAttribute('data-tip', tip);
  });
}

function findActiveJob(snap, phase, candidateId) {
  const id = String(candidateId || '');
  const want = String(phase || '');
  return (snap?.jobs || []).find(
    (j) =>
      String(j.candidateId || '') === id &&
      String(j.phase || '') === want &&
      (j.status === 'running' || j.status === 'queued'),
  );
}

function syncLightInPageBars(snap) {
  syncGeneratePackOverlay(snap);
  syncAcceptOverlay(snap);
  const cid = state.selectedId;
  if (!cid) return;
  const logo = findActiveJob(snap, 'logo', cid);
  const map = findActiveJob(snap, 'coverage-map', cid);
  const logoMap = logo || map;
  if (logoMap) {
    jobSyncedBarOn.logoMap = true;
    setImagesProgress(true, {
      label: logoMap.label || (logo ? 'Generating logo…' : 'Generating coverage map…'),
      detail: logoMap.detail || 'Working…',
      current: Number(logoMap.progressDone) || 0,
      total: Number(logoMap.progressTotal) || 0,
      box: 'ca-logo-map',
      fromJob: true,
    });
  } else if (jobSyncedBarOn.logoMap) {
    jobSyncedBarOn.logoMap = false;
    setImagesProgress(false, { box: 'ca-logo-map' });
  }
  const pull = findActiveJob(snap, 'images-pull', cid);
  if (pull) {
    jobSyncedBarOn.pull = true;
    setImagesProgress(true, {
      label: pull.label || 'Pulling photos…',
      detail: pull.detail || 'Working…',
      current: Number(pull.progressDone) || 0,
      total: Number(pull.progressTotal) || 0,
      fromJob: true,
    });
  } else if (jobSyncedBarOn.pull) {
    jobSyncedBarOn.pull = false;
    setImagesProgress(false);
  }
  syncWriteSiteOverlay(snap);
  syncOpenaiGenerateFromSnap(snap);
  const research = ['research', 'enrich', 'prospects']
    .map((p) => findActiveJob(snap, p, cid))
    .find(Boolean);
  if (research) {
    const progress = document.getElementById('job-progress');
    const detailEl = document.getElementById('job-progress-detail');
    const bar = progress?.querySelector('.job-progress-bar');
    const labelEl = progress?.querySelector('.job-progress-label');
    const total = Number(research.progressTotal);
    const done = Number(research.progressDone);
    if (progress) progress.classList.remove('hidden');
    if (detailEl) detailEl.textContent = research.detail || 'Working…';
    if (labelEl) {
      labelEl.textContent =
        Number.isFinite(total) && total > 0
          ? `Running ${jobActLabel(research.phase)} ${Number.isFinite(done) ? done : 0} / ${total}`
          : `Running ${jobActLabel(research.phase)}…`;
    }
    if (bar && Number.isFinite(total) && total > 0) {
      setDeterminateProgress(bar, { done: Number.isFinite(done) ? done : 0, total });
    }
    state.jobStatusLine = research.detail || state.jobStatusLine;
  }
}

/** Only the leader tab holds EventSource + job polls (Chrome: 6 HTTP/1.1 per origin). */
const jobSseStarters = [];
const jobLeaderPollStarters = [];
const JOB_SNAP_STALE_MS = 8000;
let jobSseLeaderStarted = false;
let isJobStreamLeader = false;

function wireJobStream({
  streamUrl,
  pollUrl,
  channelName,
  apply,
}) {
  let lastAppliedSeq = 0;
  let lastSnapAt = 0;
  let bc = null;
  try {
    bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null;
  } catch {
    bc = null;
  }

  const snapSeq = (snap) => {
    const seq = Number(snap?.seq);
    return Number.isFinite(seq) && seq > 0 ? seq : 0;
  };

  const applySnap = (snap, { broadcast = true } = {}) => {
    if (!snap || typeof snap !== 'object') return;
    lastSnapAt = Date.now();
    const seq = snapSeq(snap);
    if (seq > 0) {
      if (seq < lastAppliedSeq) return;
      lastAppliedSeq = seq;
    }
    try {
      apply(snap);
    } catch {
      /* ignore */
    }
    if (broadcast && bc) {
      try {
        bc.postMessage({ snap, at: seq || lastAppliedSeq });
      } catch {
        /* ignore */
      }
    }
  };

  if (bc) {
    bc.onmessage = (ev) => {
      const data = ev?.data;
      if (!data?.snap) return;
      const seq = Number(data.at) || snapSeq(data.snap);
      if (seq > 0 && seq < lastAppliedSeq) {
        lastSnapAt = Date.now();
        return;
      }
      applySnap(data.snap, { broadcast: false });
    };
  }

  const poll = async () => {
    try {
      applySnap(await api(pollUrl));
    } catch {
      /* ignore */
    }
  };

  jobSseStarters.push(() => {
    const es = new EventSource(streamUrl);
    es.onmessage = (ev) => {
      try {
        applySnap(JSON.parse(ev.data));
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      poll();
    };
    return es;
  });

  jobLeaderPollStarters.push(() => {
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  });

  poll();
  if (!bc) {
    setInterval(poll, 2000);
  } else {
    setInterval(() => {
      if (isJobStreamLeader) return;
      if (document.visibilityState !== 'visible') return;
      if (lastSnapAt && Date.now() - lastSnapAt < JOB_SNAP_STALE_MS) return;
      poll();
    }, JOB_SNAP_STALE_MS);
  }
}

function openJobEventSources() {
  const sources = [];
  for (const start of jobSseStarters) {
    try {
      const es = start();
      if (es) sources.push(es);
    } catch {
      /* EventSource unavailable */
    }
  }
  return () => {
    for (const es of sources) {
      try {
        es.close();
      } catch {
        /* ignore */
      }
    }
  };
}

function startJobLeaderPolling() {
  const stops = [];
  for (const start of jobLeaderPollStarters) {
    try {
      const stop = start();
      if (typeof stop === 'function') stops.push(stop);
    } catch {
      /* ignore */
    }
  }
  return () => {
    for (const stop of stops) {
      try {
        stop();
      } catch {
        /* ignore */
      }
    }
  };
}

function becomeJobStreamLeader() {
  isJobStreamLeader = true;
  const closeEs = openJobEventSources();
  const stopPoll = startJobLeaderPolling();
  return () => {
    isJobStreamLeader = false;
    try {
      closeEs();
    } catch {
      /* ignore */
    }
    try {
      stopPoll();
    } catch {
      /* ignore */
    }
  };
}

function startJobStreamLeader() {
  if (jobSseLeaderStarted) return;
  jobSseLeaderStarted = true;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
  if (!locks?.request) {
    becomeJobStreamLeader();
    return;
  }
  void locks.request('rover-job-streams', () => {
    const releaseLeader = becomeJobStreamLeader();
    return new Promise((resolve) => {
      const release = () => {
        releaseLeader();
        resolve();
      };
      window.addEventListener('pagehide', release, { once: true });
    });
  });
}

function wireJobsUi() {
  wireJobStream({
    streamUrl: '/api/jobs/stream',
    pollUrl: '/api/jobs',
    channelName: 'rover-jobs',
    apply: (snap) => {
      const heavy =
        snap?.heavy && typeof snap.heavy === 'object'
          ? snap.heavy
          : snap?.concurrency != null
            ? snap
            : null;
      const light =
        snap?.light && typeof snap.light === 'object'
          ? snap.light
          : snap?.jobs && snap.concurrency == null
            ? snap
            : null;
      if (heavy) {
        state.heavyJobsSnap = heavy;
        if (heavy.concurrency != null) {
          applyConcurrencyPayload({ heavy: heavy.concurrency });
          syncSettingsConcurrencyInputs();
        }
        syncPrepareProgressFromJobs(heavy);
        syncLaunchProgressFromJobs(heavy);
      }
      if (light) {
        state.lightJobsSnap = light;
        syncLightInPageBars(light);
        syncClaudeModeToggle();
      }
    },
  });
  document.addEventListener('click', () => closeAllJobPopovers());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAllJobPopovers();
  });
}

function wireSettingsUi() {
  const btn = document.getElementById('settings-btn');
  const menu = document.getElementById('settings-menu');
  if (!btn || !menu) return;

  applyTheme(getTheme());

  const syncConcurrencyFromServer = async () => {
    try {
      const data = await api('/api/concurrency');
      applyConcurrencyPayload(data);
      syncSettingsConcurrencyInputs();
    } catch {
      syncSettingsConcurrencyInputs();
    }
  };
  void syncConcurrencyFromServer();

  document.querySelectorAll('[data-conc-key]').forEach((input) => {
    const save = async () => {
      const key = input.getAttribute('data-conc-key');
      if (!key) return;
      const max = Number(state.concurrencyMax?.[key]) || Number(input.max) || 50;
      let n = Math.round(Number(input.value));
      if (!Number.isFinite(n)) n = Number(state.concurrency?.[key]) || 1;
      n = Math.max(1, Math.min(max, n));
      input.disabled = true;
      try {
        const data = await api('/api/concurrency', {
          method: 'POST',
          body: JSON.stringify({ [key]: n }),
        });
        applyConcurrencyPayload(data);
        syncSettingsConcurrencyInputs();
      } catch (error) {
        showToast(error?.message || 'Could not update Concurrent Limit.', { tone: 'err' });
        void syncConcurrencyFromServer();
      } finally {
        input.disabled = false;
      }
    };
    input.addEventListener('change', () => {
      void save();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });
  });

  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = menu.classList.contains('hidden');
    if (open) {
      hideOpsTooltip();
      closeAllJobPopovers();
      closeApiCostMenu();
      menu.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      void syncConcurrencyFromServer();
    } else {
      closeSettingsMenu();
    }
  });

  const connToggle = document.getElementById('settings-connections-toggle');
  const connList = document.getElementById('settings-connections-list');
  connToggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!connList) return;
    const willOpen = connList.classList.contains('hidden') || connList.hidden;
    connList.classList.toggle('hidden', !willOpen);
    connList.hidden = !willOpen;
    connToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    connToggle.classList.toggle('is-open', willOpen);
  });

  menu.addEventListener('click', (event) => event.stopPropagation());

  menu.querySelectorAll('[data-theme-pick]').forEach((swatch) => {
    swatch.addEventListener('click', (event) => {
      event.stopPropagation();
      applyTheme(swatch.getAttribute('data-theme-pick'));
    });
  });

  document.addEventListener('click', () => closeSettingsMenu());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSettingsMenu();
  });
}

function formatMoney(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const num = Number(n);
  const d = num < 0.1 && num > 0 ? 4 : digits;
  return `$${num.toFixed(d)}`;
}

const API_SPEND_LABELS = {
  research: 'SERP/Volume',
  enrich: 'Enrich',
  prospects: 'Prospects',
  narrative: 'Narrative (est.)',
  outreach: 'Outreach (est.)',
  writeSite: 'Write site (est.)',
  generatePack: 'Generate pack (est.)',
  addressSearch: 'Address Find (est.)',
};

/** Pipeline order for API $ tip line items. */
const API_SPEND_ORDER = [
  'research',
  'enrich',
  'narrative',
  'prospects',
  'outreach',
  'writeSite',
  'generatePack',
  'addressSearch',
];

function apiSpendLabelForKey(key) {
  const k = String(key || '').trim();
  if (API_SPEND_LABELS[k]) return API_SPEND_LABELS[k];
  if (!k) return 'Other';
  return k
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]+/g, ' ')
    .replace(/^\s+/, '')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function apiSpendOrderIndex(key) {
  const i = API_SPEND_ORDER.indexOf(String(key || ''));
  return i >= 0 ? i : API_SPEND_ORDER.length;
}

/** Sum meta lastCosts into line items + total (Research / Website table). */
function candidateApiSpendBreakdown(c) {
  const raw = c?.lastCosts || c?.meta?.lastCosts || {};
  const parts = [];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, val] of Object.entries(raw)) {
      const n = Number(val);
      if (!Number.isFinite(n) || n < 0) continue;
      parts.push({ key, label: apiSpendLabelForKey(key), value: n });
    }
  }
  parts.sort((a, b) => {
    const d = apiSpendOrderIndex(a.key) - apiSpendOrderIndex(b.key);
    if (d !== 0) return d;
    return String(a.key).localeCompare(String(b.key));
  });
  const total =
    parts.length > 0
      ? Number(parts.reduce((sum, p) => sum + p.value, 0).toFixed(6))
      : null;
  return { parts, total };
}

function candidateApiSpendTip(breakdown) {
  const parts = breakdown?.parts || [];
  if (!parts.length || breakdown?.total == null) {
    return 'No API spend recorded yet';
  }
  const lines = parts.map((p) => `${p.label}  ${formatMoney(p.value)}`);
  lines.push('', `Total  ${formatMoney(breakdown.total)}`);
  return lines.join('\n');
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

  let notes = 'Run SERP / Volume+';
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
  renderApiCostMenu();
}

async function showGenerateFailures(failures) {
  if (!failures.length) return false;
  const items = failures
    .map((line) => `<li>${esc(line)}</li>`)
    .join('');
  await showModal({
    title: 'Generate finished with errors',
    confirmLabel: 'OK',
    hideCancel: true,
    bodyHtml: `<p>${failures.length} job${failures.length === 1 ? '' : 's'} failed. Cards that succeeded were kept.</p><ul>${items}</ul>`,
  });
  return true;
}

function remainingTone(balance, { loading = false, failed = false, unset = false } = {}) {
  if (loading || unset) return 'muted';
  if (failed) return 'err';
  if (balance != null && Number(balance) < 1) return 'warn';
  return 'ok';
}

function apiCostMoney(value) {
  return Number.isFinite(Number(value)) ? formatMoney(value) : '—';
}

function apiCostWalletCell({ configured, loading, ok, balance, spent, failTitle }) {
  const title = failTitle || '';
  if (!configured) {
    return {
      kind: 'merged',
      text: 'Not set',
      tone: 'muted',
      title: title || 'Add this key in .env, then restart Rover.',
    };
  }
  if (loading) {
    return { kind: 'merged', text: '…', tone: 'muted', title };
  }
  if (!ok) {
    return {
      kind: 'wallet',
      spent: null,
      balance: null,
      tone: 'err',
      title: title || 'Could not load remaining balance.',
    };
  }
  return {
    kind: 'wallet',
    spent,
    balance,
    tone: remainingTone(balance),
    title,
  };
}

function apiCostPaygCell(configured, usedFor, spent) {
  if (!configured) {
    return {
      kind: 'merged',
      text: 'Not set',
      tone: 'muted',
      title: `${usedFor} Add the API key in .env, then restart Rover.`,
    };
  }
  return {
    kind: 'payg',
    spent: Number.isFinite(Number(spent)) ? Number(spent) : 0,
    tone: 'ok',
    title: `${usedFor} Spent is Rover-recorded (list price / estimate), not the vendor invoice.`,
  };
}

function apiCostRows() {
  const cfg = state.apiCostConfigured || {};
  const payg = state.apiCostPayg || {};
  const dfs = state.dfsBalance;
  const apify = state.apifyPlanUsage;
  const twilio = state.twilioBalance;
  const dfsConfigured = cfg.dataforseo ?? Boolean(dfs);
  const apifyConfigured = cfg.apify ?? Boolean(apify && apify.ok !== false);
  const twilioConfigured = cfg.twilio ?? twilio?.configured === true;

  const apifyTitleParts = [
    'Address Find LoopNet / Crexi scrapes. Prepaid. All-time spend · remaining this cycle.',
  ];
  if (apify?.ok && apify.monthlyUsageUsd != null && apify.maxMonthlyUsageUsd != null) {
    apifyTitleParts.push(
      `Used ${formatMoney(apify.monthlyUsageUsd)} of ${formatMoney(apify.maxMonthlyUsageUsd)} this cycle.`,
    );
  }

  return [
    {
      name: 'DataForSEO',
      ...apiCostWalletCell({
        configured: dfsConfigured,
        loading: !dfs && dfsConfigured,
        ok: Boolean(dfs?.ok),
        balance: dfs?.balance,
        spent: dfs?.spentAllTime,
        failTitle: dfs?.error
          ? `Discovery, research, ranks. Prepaid wallet. ${dfs.error}`
          : 'Discovery, research, ranks. All-time spend · remaining wallet.',
      }),
    },
    (() => {
      const ab = state.anthropicBalance;
      if (ab?.ok) {
        const vendorSpend = Number(ab.spentAllTime);
        const hasVendorSpend = Number.isFinite(vendorSpend) && vendorSpend > 0;
        return {
          name: 'Anthropic',
          ...apiCostWalletCell({
            configured: true,
            loading: false,
            ok: true,
            balance: ab.balance,
            spent: hasVendorSpend ? vendorSpend : payg.anthropic,
            failTitle: ab.balance != null
              ? 'Prepaid credits · spend and balance from Anthropic Admin API.'
              : 'Prepaid credits. Spent is Rover-recorded; balance unavailable via Admin API.',
          }),
        };
      }
      return {
        name: 'Anthropic',
        ...apiCostPaygCell(
          Boolean(cfg.anthropic),
          'Copy, content, narrative. Prepaid credits billed per token.',
          payg.anthropic,
        ),
      };
    })(),
    {
      name: 'OpenAI',
      ...apiCostPaygCell(
        Boolean(cfg.openai),
        'Phone Whisper / summaries and GPT Image. Prepaid credits billed per use.',
        payg.openai,
      ),
    },
    {
      name: 'Google Maps',
      ...apiCostPaygCell(
        Boolean(cfg.googleMaps),
        'Address Find Places / Geocoding. Pay as you go on Google Cloud.',
        payg.googleMaps,
      ),
    },
    {
      name: 'Apify',
      ...apiCostWalletCell({
        configured: apifyConfigured || Boolean(cfg.apify),
        loading: !apify && Boolean(cfg.apify),
        ok: Boolean(apify?.ok),
        balance: apify?.remainingUsd,
        spent: apify?.spentAllTime,
        failTitle: apify?.error ? `${apifyTitleParts[0]} ${apify.error}` : apifyTitleParts.join(' '),
      }),
    },
    {
      name: 'Twilio',
      ...apiCostWalletCell({
        configured: twilioConfigured,
        loading: !twilio && twilioConfigured,
        ok: Boolean(twilio?.ok),
        balance: twilio?.balance,
        spent: twilio?.spentAllTime,
        failTitle: twilio?.error
          ? `Ranking numbers, calls, recordings. Prepaid account. ${twilio.error}`
          : 'Ranking numbers, calls, recordings. All-time spend · remaining prepaid balance.',
      }),
    },
  ];
}

function renderApiCostMenu() {
  const list = document.getElementById('api-cost-list');
  if (!list) return;
  const body = apiCostRows()
    .map((row) => {
      const name = `<td class="api-cost-name">${esc(row.name)}</td>`;
      if (row.kind === 'merged') {
        return `<tr>
          ${name}
          <td class="api-cost-merged ${esc(row.tone)}" colspan="2" title="${esc(row.title)}">${esc(row.text)}</td>
        </tr>`;
      }
      if (row.kind === 'payg') {
        return `<tr>
          ${name}
          <td class="api-cost-num ${esc(row.tone)}" title="${esc(row.title)}">${esc(apiCostMoney(row.spent))}</td>
          <td class="api-cost-num ${esc(row.tone)}" title="${esc(row.title)}">PAYG</td>
        </tr>`;
      }
      return `<tr>
        ${name}
        <td class="api-cost-num ${esc(row.tone)}" title="${esc(row.title)}">${esc(apiCostMoney(row.spent))}</td>
        <td class="api-cost-num ${esc(row.tone)}" title="${esc(row.title)}">${esc(apiCostMoney(row.balance))}</td>
      </tr>`;
    })
    .join('');
  list.innerHTML = `<table class="api-cost-table">
    <thead>
      <tr>
        <th scope="col"></th>
        <th scope="col">Spent</th>
        <th scope="col">Balance</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

function applyApiCostSnapshot(data) {
  if (!data || typeof data !== 'object') return;
  if (data.configured) state.apiCostConfigured = data.configured;
  if (data.payg) state.apiCostPayg = data.payg;
  if (data.dfs) state.dfsBalance = data.dfs;
  if (data.apify) state.apifyPlanUsage = data.apify;
  if (data.twilio) state.twilioBalance = data.twilio;
  if (data.anthropic) state.anthropicBalance = data.anthropic;
}

function renderFalBalance() {
  renderOpenaiSpendLine();
  renderApiCostMenu();
}

async function loadApiCost({ fresh = false } = {}) {
  try {
    const q = fresh ? '?fresh=1' : '';
    applyApiCostSnapshot(await api(`/api/api-cost${q}`));
  } catch (error) {
    if (!state.dfsBalance) {
      state.dfsBalance = {
        ok: false,
        balance: null,
        error: error.message,
        fetchedAt: new Date().toISOString(),
      };
    }
  }
  renderFalBalance();
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

function refreshImageWallets({ fresh = false } = {}) {
  loadApiCost({ fresh }).catch(() => {});
}

function wireApiCostUi() {
  const btn = document.getElementById('api-cost-btn');
  const menu = document.getElementById('api-cost-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = menu.classList.contains('hidden');
    if (willOpen) {
      closeSettingsMenu();
      closeAllJobPopovers();
      menu.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      renderApiCostMenu();
      void loadApiCost({ fresh: true });
    } else {
      closeApiCostMenu();
    }
  });
  menu.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', () => closeApiCostMenu());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeApiCostMenu();
  });
}

function startBalancePolling() {
  if (state.balanceTimer) clearInterval(state.balanceTimer);
  state.balanceTimer = setInterval(() => {
    loadApiCost().catch(() => {});
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
        }.</p>${
          getForceSerp()
            ? '<p><strong>Force new SERP:</strong> on — refetches Map Pack/organic (~$0.002) before refreshing volumes.</p>'
            : ''
        }`
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
            ${act === 'narrative' ? '<li>Valid JSON is <strong>accepted automatically</strong> (approved package written)</li>' : ''}
            ${
              act === 'write-site' || act === 'writeSite'
                ? '<li>About 12–22 minutes. Stop keeps files already written; retry resumes.</li>'
                : ''
            }
            ${
              act === 'generate-pack' || act === 'generatePack'
                ? '<li>Usually a few minutes. Stop cancels; retry re-imports.</li>'
                : ''
            }
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

const CANDIDATES_BC_NAME = 'rover-candidates';
const CANDIDATES_TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let candidatesBc = null;
let candidatesBcWired = false;
let candidatesRemoteTimer = 0;
let candidatesRemotePending = null;

function getCandidatesBroadcast() {
  if (candidatesBc) return candidatesBc;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      candidatesBc = new BroadcastChannel(CANDIDATES_BC_NAME);
    }
  } catch {
    candidatesBc = null;
  }
  return candidatesBc;
}

function notifyCandidatesChanged({ type = 'candidates', ids = null, batchId = null } = {}) {
  const bc = getCandidatesBroadcast();
  if (!bc) return;
  try {
    bc.postMessage({
      from: CANDIDATES_TAB_ID,
      type,
      ids: ids ? [...ids] : null,
      batchId: batchId || null,
      at: Date.now(),
    });
  } catch {
    /* ignore */
  }
}

function remoteRefreshNeedsDetailRender(data) {
  const type = String(data?.type || '');
  if (type !== 'accept') return true;
  if (state.tab === 'content' && state.contentOpenStep === 'photoGroup') return true;
  if (state.tab === 'website' && state.websiteOpenStep === 'images') return true;
  return false;
}

async function applyRemoteCandidatesRefresh(data) {
  await loadCandidates();
  const ids = Array.isArray(data?.ids) ? data.ids.map(String) : null;
  if (
    state.selectedId &&
    (!ids || ids.includes(String(state.selectedId))) &&
    remoteRefreshNeedsDetailRender(data)
  ) {
    try {
      await loadSelectedCandidateDetail(state.selectedId);
      if (state.selectedIds.size > 1) renderMultiDetail();
      else if (state.detail) renderDetail();
    } catch {
      /* ignore */
    }
  }
  if (data?.type === 'discovery' && data.batchId && data.batchId === state.discoveryBatchId) {
    try {
      const batch = await api(`/api/discovery/batches/${encodeURIComponent(data.batchId)}`);
      state.discoveryRows = batch.rows || [];
      const n = state.discoveryRows.length;
      for (const idx of [...(state.discoverySelected || [])]) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= n) state.discoverySelected.delete(idx);
      }
      renderDiscoveryTable();
    } catch {
      /* ignore */
    }
  }
}

function wireCandidatesBroadcast() {
  if (candidatesBcWired) return;
  candidatesBcWired = true;
  const bc = getCandidatesBroadcast();
  if (!bc) return;
  bc.onmessage = (ev) => {
    const data = ev?.data;
    if (!data || data.from === CANDIDATES_TAB_ID) return;
    candidatesRemotePending = data;
    window.clearTimeout(candidatesRemoteTimer);
    candidatesRemoteTimer = window.setTimeout(() => {
      const next = candidatesRemotePending;
      candidatesRemotePending = null;
      void applyRemoteCandidatesRefresh(next);
    }, 80);
  };
}

async function loadCandidates() {
  const data = await api('/api/candidates');
  state.candidates = data.candidates || [];
  state.candidateGroups = data.groups || [];
  state.decisionCounts = data.decisionCounts || {};
  state.archivedCount = data.archivedCount ?? state.candidates.filter((c) => c.archived).length;
  refreshDecisionFilterCounts();
  refreshVisibilityFilterCounts();
  fillCandidateBatchFilterSelect();
  fillCandidateGroupSelects();
  renderList();
}

function refreshVisibilityFilterCounts() {
  const sel = document.getElementById('candidate-visibility-filter');
  if (!sel) return;
  const all = state.candidates.length;
  const archived = state.archivedCount ?? state.candidates.filter((c) => c.archived).length;
  const active = Math.max(0, all - archived);
  const labels = {
    active: `Active (${active})`,
    archived: `Archived (${archived})`,
    all: `All (${all})`,
  };
  for (const opt of sel.options) {
    if (labels[opt.value] != null) opt.textContent = labels[opt.value];
  }
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
    pass: `pass (${counts.pass ?? 0})`,
  };
  for (const opt of sel.options) {
    if (labels[opt.value] != null) opt.textContent = labels[opt.value];
  }
}

function filteredCandidates() {
  const f = state.candidateDecisionFilter;
  const batchF = state.candidateBatchFilter;
  const groupF = state.candidateGroupFilter;
  const vis = state.candidateVisibilityFilter || 'active';
  const text = String(state.candidateTextFilter || '')
    .trim()
    .toLowerCase();
  const websiteBuilderOnly = state.view === 'website-builder';
  return state.candidates.filter((c) => {
    if (websiteBuilderOnly && c.decision !== 'pursue') return false;
    if (vis === 'active' && c.archived) return false;
    if (vis === 'archived' && !c.archived) return false;
    if (f === '__undecided') {
      if (c.decision) return false;
    } else if (f && c.decision !== f) {
      return false;
    }
    if (batchF && c.source?.batchId !== batchF) return false;
    if (groupF === '__ungrouped') {
      if ((c.groupIds || []).length) return false;
    } else if (groupF && !(c.groupIds || []).includes(groupF)) {
      return false;
    }
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
  const jobValue =
    inputs.jobValue != null && inputs.jobValue !== ''
      ? inputs.jobValue
      : c.narrativeJobValue ?? null;
  return {
    demand: inputs.demand ?? null,
    competition: inputs.competition ?? null,
    jobValue,
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
  if (key === '_stageProgress') return candidateHighestStageStep(c);
  if (key === '_websiteTrack') return candidateHighestWebsiteTrack(c);
  if (key === '_live') return isCandidateLaunched(c) ? 1 : 0;
  if (key === '_rank') return PIPELINE_RANK_SORT[candidatePipelineRank(c)] ?? 0;
  if (key === 'city') return [c.primaryCity, c.state].filter(Boolean).join(', ');
  if (key === 'volume') return c.demandVolumeSum ?? c.clusterVolumeSum;
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
  if (key === 'apiSpend') return candidateApiSpendBreakdown(c).total;
  return c[key];
}

const CANDIDATE_DECISION_OPTS = [
  '',
  'pursue',
  'maybe',
  'review',
  'hold',
  'pass',
];

const CANDIDATE_TABLE_COLS = [
  {
    key: '_select',
    label: '',
    tip: 'Select rows for stage runs',
    cellClass: 'col-narrow',
  },
  {
    key: '_live',
    label: '',
    tip: 'Launched',
    cellClass: 'col-narrow col-center col-live',
    sortable: true,
  },
  {
    key: '_stageProgress',
    label: 'R',
    tip: 'Highest completed evaluation: 1 SERP/Volume · 2 Enrich · 3 Narrative · 4 Prospects',
    cellClass: 'col-stage-progress',
    sortable: true,
  },
  {
    key: '_websiteTrack',
    label: 'W',
    tip: 'Highest completed Website track: 1 Site-Config · 2 Content · 3 Launch',
    cellClass: 'col-stage-progress',
    sortable: true,
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
    label: 'Openness',
    tip: 'Organic openness 1–10. Higher = more open / better for you.',
    sortable: true,
    cellClass: 'col-score-metric',
    source: 'ops',
  },
  {
    key: 'disp',
    label: 'Displace.',
    tip: 'Evaluation 2 — Displaceability 1–10. Higher = easier to outrank.',
    sortable: true,
    cellClass: 'col-score-metric',
    source: 'ops',
  },
  {
    key: 'jobValue',
    label: 'Job value',
    tip: 'Job value score 1–10 from accepted narrative ticket size',
    sortable: true,
    cellClass: 'col-score-metric',
    source: 'ops',
  },
  {
    key: 'serpSoftness',
    label: 'SERP soft',
    tip: 'SERP softness label: soft / mixed / hard',
    sortable: true,
    cellClass: 'col-score-metric',
    source: 'ops',
  },
  {
    key: 'volume',
    label: 'Search vol.',
    tip: 'Demand (scored) / month: primary + α×suburb volumes (α=0.25). Bands apply here, not raw cluster sum.',
    sortable: true,
    cellClass: 'col-truncate',
    source: 'dfs',
  },
  {
    key: 'mapPack',
    label: 'Map Pack',
    tip: 'Map Pack present (Yes/No). When Yes, shows review counts per pack slot (e.g. 78/14/235). LSA if Local Services Ads detected. May show Discovery Light SERP until Eval 1 · SERP / Volume.',
    sortable: true,
    cellClass: 'col-mappack',
    source: 'dfs',
  },
  {
    key: 'researchMap',
    label: 'Map',
    tip: 'Open research Map tab zoomed to this city',
    sortable: false,
    cellClass: 'col-short col-center',
    source: 'ops',
  },
  {
    key: 'orgHome',
    label: 'Homepages',
    tip: 'Niche-relevant / all organic homepages (title+URL token match). Directories excluded. May show Discovery Light SERP counts until Eval 1 · SERP / Volume.',
    sortable: true,
    cellClass: 'col-short col-center',
    source: 'dfs',
  },
  {
    key: 'orgSub',
    label: 'Subpages',
    tip: 'Niche-relevant / all organic subpages (title+URL token match). Directories excluded. May show Discovery Light SERP counts until Eval 1 · SERP / Volume.',
    sortable: true,
    cellClass: 'col-short col-center',
    source: 'dfs',
  },
  {
    key: 'avgCpc',
    label: 'CPC',
    tip: 'Average CPC from SERP / Volume Ads keywords (monetization signal). Blank until SERP / Volume.',
    sortable: true,
    cellClass: 'col-short',
    source: 'dfs',
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
    key: 'jobCost',
    label: 'Job Cost',
    tip: 'Average job value / ticket size from research or narrative',
    sortable: true,
    cellClass: 'col-truncate',
    source: 'claude',
  },
  {
    key: 'decision',
    label: 'Decision',
    tip: 'Decision group — autosaves. Hover shows score-based Recommend (pursue ≥7, maybe 6–7, pass <6, review if stages 1–3 incomplete).',
    sortable: true,
    cellClass: 'col-human',
    source: 'ops',
  },
  {
    key: 'prospects',
    label: 'Prospects',
    tip: 'Evaluation 4 — Prospect count (high priority in tip)',
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
  {
    key: 'apiSpend',
    label: 'API $',
    tip: 'Recorded / estimated API spend for this candidate (hover for breakdown)',
    sortable: true,
    cellClass: 'col-short',
    source: 'ops',
  },
  {
    key: '_rank',
    label: 'Type',
    tip: 'Pipeline rank: Discovery → Research → Website (pursue) → Launched',
    sortable: true,
    cellClass: 'col-short',
    source: 'ops',
  },
];

const PIPELINE_RANK_SORT = {
  Discovery: 0,
  Research: 1,
  Website: 2,
  Launched: 3,
};

function isCandidateLaunched(c) {
  const m = c?.meta || {};
  return Boolean(m.lastLaunchAt || m.lastShipAt);
}

/** Pipeline rank for the Type column (highest wins). */
function candidatePipelineRank(c) {
  if (isCandidateLaunched(c)) return 'Launched';
  if (c?.decision === 'pursue') return 'Website';
  if (c?.stageFlags?.hasResearch) return 'Research';
  return 'Discovery';
}

function launchedBadgeHtml() {
  return `<span class="cand-live-badge" data-tip="Launched" aria-label="Launched"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><circle cx="8" cy="11" r="1.35" fill="currentColor"/><path d="M5.15 8.35a4.1 4.1 0 0 1 5.7 0" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><path d="M3.55 6.35a6.4 6.4 0 0 1 8.9 0" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/></svg></span>`;
}

const STAGE_STEP_TIPS = {
  1: '1 · SERP / Volume complete',
  2: '2 · Enrich complete',
  3: '3 · Narrative complete',
  4: '4 · Prospects complete',
};

const WEBSITE_TRACK_TIPS = {
  1: '1 · Site-Config complete',
  2: '2 · Content complete',
  3: '3 · Launch complete',
};

/** Highest completed Research→Prospects stage (0 = none). */
function candidateHighestStageStep(c) {
  const f = c?.stageFlags || {};
  if (f.hasProspects) return 4;
  if (f.hasNarrative) return 3;
  if (f.hasEnrichment) return 2;
  if (f.hasResearch) return 1;
  return 0;
}

function isWebsiteLaunched(c) {
  const m = c?.meta || {};
  return Boolean(m.lastLaunchAt || m.lastShipAt || m.cloudflarePagesDone || m.dnsDone);
}

/** Durable Site-Config / Content / Launch complete (no in-session soft-done). */
function isWebsiteTrackComplete(c, track) {
  const f = c?.stageFlags || {};
  const m = c?.meta || {};
  if (track === 1) {
    if (!f.hasSiteConfig || !m.lastServiceAreaAt) return false;
    return Boolean(
      m.phoneSkippedAt ||
        m.lastPhoneAt ||
        f.hasSitePhone ||
        (c?.id && state.sitePhoneProvisioned?.[c.id]),
    );
  }
  if (track === 2) return Boolean(f.hasContent);
  if (track === 3) return isWebsiteLaunched(c) && Boolean(m.indexingDone);
  return false;
}

/** Highest completed Website track (0 = none). */
function candidateHighestWebsiteTrack(c) {
  if (isWebsiteTrackComplete(c, 3)) return 3;
  if (isWebsiteTrackComplete(c, 2)) return 2;
  if (isWebsiteTrackComplete(c, 1)) return 1;
  return 0;
}

/** Website (pursue / site artifacts) or Launched — never permanently deletable in Rover. */
function isUndeletableCandidateRow(c) {
  if (!c) return false;
  if (c.decision === 'pursue') return true;
  const m = c.meta || {};
  if (m.lastLaunchAt || m.lastShipAt) return true;
  const f = c.stageFlags || {};
  if (
    f.hasSiteConfig ||
    f.hasSiteConfigDraft ||
    f.hasContent ||
    f.hasContentDraft ||
    f.hasContentBrief ||
    f.hasContentResearch ||
    f.hasBuildPackage ||
    f.hasContentOutlinePackage ||
    f.hasContentStructure
  ) {
    return true;
  }
  return false;
}

function undeletableIdsInSelection(ids = [...state.selectedIds]) {
  return ids.filter((id) => {
    const c = state.candidates.find((x) => x.id === id);
    return isUndeletableCandidateRow(c);
  });
}

function stageStepIconHtml(step, tips = STAGE_STEP_TIPS) {
  const n = Number(step) || 0;
  if (n < 1 || n > 4) return '<span class="muted">—</span>';
  return `<span class="stage-step-icon stage-step-${n}" data-tip="${esc(
    tips[n] || '',
  )}">${n}</span>`;
}

function updateCandidateSelectionCount() {
  const nSelected = state.selectedIds.size;
  const el = document.getElementById('candidate-selection-count');
  if (el) el.textContent = `${nSelected} selected`;
  const bulkMeta = document.getElementById('candidate-bulk-summary-meta');
  if (bulkMeta) bulkMeta.textContent = nSelected ? `${nSelected} selected` : '';
  const countEl = document.getElementById('candidate-filter-count');
  if (countEl) {
    const n = filteredCandidates().length;
    const vis = state.candidateVisibilityFilter || 'active';
    const all = state.candidates.length;
    const archived = state.archivedCount ?? state.candidates.filter((c) => c.archived).length;
    const denom =
      vis === 'archived' ? archived : vis === 'all' ? all : Math.max(0, all - archived);
    countEl.textContent = `Showing ${n} / ${denom}`;
  }
  const batchSel = document.getElementById('candidate-batch-decision');
  const batchBtn = document.getElementById('candidate-batch-decision-btn');
  const groupAction = document.getElementById('candidate-group-action');
  const groupAddBtn = document.getElementById('candidate-group-add-btn');
  const groupRemoveBtn = document.getElementById('candidate-group-remove-btn');
  const addToSitesBtn = document.getElementById('candidate-add-to-sites-btn');
  const archiveBtn = document.getElementById('candidate-archive-btn');
  const unarchiveBtn = document.getElementById('candidate-unarchive-btn');
  const deleteBtn = document.getElementById('candidate-delete-btn');
  const disable = nSelected === 0;
  if (batchSel) batchSel.disabled = disable;
  if (batchBtn) batchBtn.disabled = disable;
  if (groupAction) groupAction.disabled = disable;
  if (groupAddBtn) groupAddBtn.disabled = disable;
  if (groupRemoveBtn) groupRemoveBtn.disabled = disable;
  if (addToSitesBtn) addToSitesBtn.disabled = disable;
  if (archiveBtn) archiveBtn.disabled = disable;
  if (unarchiveBtn) unarchiveBtn.disabled = disable;
  if (deleteBtn) {
    const blocked = undeletableIdsInSelection();
    deleteBtn.disabled = disable || blocked.length > 0;
    if (blocked.length) {
      setElementTip(
        deleteBtn,
        'Website/Launched Candidates cannot be permanently deleted from Rover',
      );
    } else {
      setElementTip(
        deleteBtn,
        'Permanently delete Research selection (not Website/Launched) and scrub Discovery anti-dupe / groups / Sites links',
      );
    }
  }
}

function emptyStateForFilter() {
  const f = state.candidateDecisionFilter;
  const vis = state.candidateVisibilityFilter || 'active';
  if (!state.candidates.length) {
    return 'No candidates yet — Process a discovery batch (all decisions land in groups here).';
  }
  if (state.view === 'website-builder' && !state.candidates.some((c) => c.decision === 'pursue' && !c.archived)) {
    return 'No pursue Candidates yet — mark pursue in Research to open Website.';
  }
  if (vis === 'archived' && !(state.archivedCount ?? state.candidates.some((c) => c.archived))) {
    return 'No archived candidates — Archive hides rows from Active without deleting files.';
  }
  if (vis === 'archived') {
    return 'No archived candidates match these filters.';
  }
  if (f === 'pursue') {
    return state.view === 'website-builder'
      ? 'No pursue Candidates yet — mark pursue in Research to build here.'
      : 'No pursue yet — Process a discovery batch and Accept pursue rows.';
  }
  if (f === 'pass') {
    return `No ${f} candidates — archive groups fill when you Process discovery rows with that decision.`;
  }
  if (f === '__undecided') return 'No undecided candidates.';
  if (state.candidateBatchFilter) {
    return `No candidates from discovery batch “${state.candidateBatchFilter}”.`;
  }
  if (state.candidateGroupFilter === '__ungrouped') {
    return 'No ungrouped candidates for this filter.';
  }
  if (state.candidateGroupFilter) {
    const g = (state.candidateGroups || []).find((x) => x.id === state.candidateGroupFilter);
    return `No candidates in group “${g?.name || state.candidateGroupFilter}”.`;
  }
  if (state.candidateTextFilter) return 'No candidates match this search.';
  if (f) return `No candidates in the “${f}” decision group.`;
  return 'No candidates match these filters.';
}

/** Freeze row selection while Site-Config Service area (map) is open. */
function candidateSelectionLocked() {
  return (
    document.getElementById('view-candidates')?.classList.contains('sa-map-open') ||
    state.siteConfigOpenStep === 'service-area'
  );
}

const DETAIL_SHELF_KEY = 'ops.detailShelf';

function readDetailShelf() {
  try {
    return localStorage.getItem(DETAIL_SHELF_KEY) === '1';
  } catch {
    return false;
  }
}

function persistDetailShelf(on) {
  try {
    localStorage.setItem(DETAIL_SHELF_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function detailShelfToggleInnerHtml(expanded) {
  const icon = expanded
    ? '<svg class="detail-shelf-toggle-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/></svg>'
    : '<svg class="detail-shelf-toggle-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/></svg>';
  return `${icon}<span>${expanded ? 'Collapse' : 'Expand'}</span>`;
}

function applyDetailShelf(on = readDetailShelf()) {
  const allowed = state.tab === 'website' && state.websiteOpenStep === 'images';
  const layout = document.getElementById('view-candidates');
  layout?.classList.toggle('layout-detail-shelf', Boolean(on) && allowed);
  const btn = document.getElementById('detail-shelf-toggle');
  if (btn) {
    btn.classList.toggle('hidden', !allowed);
    const expanded = Boolean(on) && allowed;
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    btn.innerHTML = detailShelfToggleInnerHtml(expanded);
    setElementTip(btn, expanded ? 'Collapse to sidebar width' : 'Expand sidebar over the table');
  }
}

function toggleDetailShelf() {
  if (!(state.tab === 'website' && state.websiteOpenStep === 'images')) return;
  const next = !readDetailShelf();
  persistDetailShelf(next);
  applyDetailShelf(next);
  if (candidateSelectionLocked()) {
    requestAnimationFrame(() => {
      serviceAreaMount?.invalidateSize?.();
      requestAnimationFrame(() => serviceAreaMount?.invalidateSize?.());
    });
  }
}

function syncCandidatesDetailVisibility() {
  const empty = document.getElementById('empty-detail');
  const detail = document.getElementById('detail');
  const layout = document.getElementById('view-candidates');
  const saMapOpen = candidateSelectionLocked();
  const collapsed =
    !saMapOpen && state.selectedIds.size === 0 && !state.selectedId;
  layout?.classList.toggle('layout-detail-collapsed', collapsed);
  applyDetailShelf();

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

function syncSitesDetailVisibility() {
  const layout = document.getElementById('view-sites');
  layout?.classList.toggle('layout-detail-collapsed', !state.selectedSiteId);
}

function syncPhoneDetailVisibility() {
  const layout = document.getElementById('view-phone');
  // Always keep the far-right call detail column visible (empty state when no call).
  layout?.classList.remove('layout-detail-collapsed');
}

/** Click empty table/panel chrome to clear row selection (not rows, controls, or thead). */
const TABLE_DESELECT_IGNORE =
  'thead, input, select, button, a, label, textarea, .col-resize-handle, .candidate-bulk-details, .discovery-filters-bar, .discovery-flow, .sites-gsc-status, .phone-calls-toolbar, #sa-map-canvas, .sa-map-canvas-host, .leaflet-container';
const TABLE_DESELECT_ROW =
  'tr[data-id], tr[data-call-id], tr[data-row-idx]';

function eventPath(e) {
  if (typeof e.composedPath === 'function') {
    try {
      const path = e.composedPath();
      if (Array.isArray(path) && path.length) return path;
    } catch {
      /* ignore */
    }
  }
  const path = [];
  let node = e.target;
  while (node) {
    path.push(node);
    node = node.parentNode;
  }
  return path;
}

function wireTableDeselectOnEmpty(roots, clearFn) {
  const list = (Array.isArray(roots) ? roots : [roots]).filter(Boolean);
  for (const root of list) {
    if (root.dataset.deselectWired === '1') continue;
    root.dataset.deselectWired = '1';
    root.addEventListener('click', (e) => {
      const path = eventPath(e);
      // Use path, not closest(): row click may re-render tbody mid-bubble and detach the tr
      // so `tbody tr[data-id]` no longer matches.
      if (
        path.some(
          (n) =>
            n &&
            typeof n.matches === 'function' &&
            (n.matches(TABLE_DESELECT_ROW) || n.matches(TABLE_DESELECT_IGNORE)),
        )
      ) {
        return;
      }
      clearFn();
    });
  }
}

function clearCandidateRowSelection() {
  if (candidateSelectionLocked()) return;
  if (!state.selectedId && state.selectedIds.size === 0 && !state.detail) return;
  state.selectedId = null;
  state.selectedIds.clear();
  state.detail = null;
  state.multiQueue = false;
  syncCandidatesDetailVisibility();
  renderList();
  renderActions();
}

function clearSitesRowSelection() {
  if (!state.selectedSiteId) return;
  state.selectedSiteId = null;
  renderSitesTable();
  renderSitesDetail();
}

function clearPhoneCallSelection() {
  if (!state.phone?.selectedCallId) return;
  state.phone.selectedCallId = null;
  renderPhoneCalls();
  renderPhoneDetail();
}

function clearDiscoveryRowSelection() {
  if (!state.discoverySelected?.size) return;
  state.discoverySelected = new Set();
  state.discoveryCheckAnchor = null;
  renderDiscoveryTable();
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
      await loadSelectedCandidateDetail(id);
    }
    const data = await api('/api/candidates');
    state.candidates = data.candidates || [];
    state.decisionCounts = data.decisionCounts || {};
    refreshDecisionFilterCounts();
    renderList();
    if (state.selectedIds.size > 1) renderMultiDetail();
    else if (state.selectedId === id && state.detail) renderDetail();
    else renderActions();
    notifyCandidatesChanged({ type: 'candidates', ids: [id] });
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
      return `<th data-tip="${esc(c.tip || '')}"><input type="checkbox" id="candidate-select-all" data-tip="Select filtered" /></th>`;
    }
    if (c.key === '_live') {
      const mark = sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
      const cls = [c.sortable ? 'sortable' : '', c.cellClass || ''].filter(Boolean).join(' ');
      return `<th class="${cls}" data-sort="${esc(c.key)}" data-tip="${esc(c.tip || '')}">${mark}</th>`;
    }
    if (c.key === '_stageProgress' || c.key === '_websiteTrack') {
      const mark = sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
      const cls = [c.sortable ? 'sortable' : '', c.cellClass || ''].filter(Boolean).join(' ');
      return `<th class="${cls}" data-sort="${esc(c.key)}" data-tip="${esc(c.tip || '')}"><span class="th-label th-rover-mark">${esc(
        c.label,
      )}</span>${mark}</th>`;
    }
    const mark = sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
    const cls = [c.sortable ? 'sortable' : '', c.cellClass || ''].filter(Boolean).join(' ');
    const srcTip =
      c.source && DISCOVERY_SOURCES[c.source] ? DISCOVERY_SOURCES[c.source].tip : '';
    const fullTip = [c.tip || c.label, srcTip].filter(Boolean).join(' · ');
    return `<th class="${cls}" data-sort="${esc(c.key)}" data-tip="${esc(fullTip)}"><span class="th-label">${discoverySourceDot(
      c.source,
    )}${esc(c.label)}</span>${mark}</th>`;
  }).join('')}</tr>`;

  const list = sortCandidates(filteredCandidates());
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="${CANDIDATE_TABLE_COLS.length}" class="muted">${esc(
      emptyStateForFilter(),
    )}</td></tr>`;
    syncHeaderSelectAll(document.getElementById('candidate-select-all'), {
      selectedCount: 0,
      totalCount: 0,
    });
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
        if (col.key === '_live') {
          return `<td${tdClass}>${isCandidateLaunched(c) ? launchedBadgeHtml() : ''}</td>`;
        }
        if (col.key === '_stageProgress') {
          return `<td${tdClass}>${stageStepIconHtml(candidateHighestStageStep(c))}</td>`;
        }
        if (col.key === '_websiteTrack') {
          return `<td${tdClass}>${stageStepIconHtml(
            candidateHighestWebsiteTrack(c),
            WEBSITE_TRACK_TIPS,
          )}</td>`;
        }
        if (col.key === 'niche') {
          return `<td${tdClass} data-tip="${esc(c.id)}"><span class="cell-text">${esc(
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
        if (col.key === 'researchMap') {
          const city = c.primaryCity || c.city || '';
          const st = c.state || '';
          if (!city || !st) return `<td${tdClass} class="muted">—</td>`;
          return `<td${tdClass}><button type="button" class="btn btn-sm cand-open-map" data-city="${esc(
            city,
          )}" data-state="${esc(st)}" data-tip="Open Map zoomed to ${esc(city)}, ${esc(
            st,
          )}">Map</button></td>`;
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
          return `<td${tdClass}>${demandVolumeHtml(c.demandVolumeSum ?? c.clusterVolumeSum, {
            alpha: c.suburbOverlapFactor,
          })}</td>`;
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
          return `<td${tdClass} data-tip="${esc(tip)}">${label}</td>`;
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
          return `<td${tdClass} data-tip="${esc(tip)}">${label}</td>`;
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
          const recTip = [c.recommended_decision, c.recommended_reason]
            .filter(Boolean)
            .join(' — ');
          const tip = recTip
            ? `Recommend: ${recTip}`
            : 'Decision group — autosaves on change';
          return `<td${tdClass} data-tip="${esc(tip)}"><select class="cand-decision" data-id="${esc(c.id)}">${CANDIDATE_DECISION_OPTS.map(
            (o) =>
              `<option value="${esc(o)}" ${
                (c.decision || '') === o ? 'selected' : ''
              }>${esc(o || '—')}</option>`,
          ).join('')}</select></td>`;
        }
        if (col.key === 'prospects') {
          if (c.prospectCount == null) return `<td${tdClass}>—</td>`;
          const tip =
            c.highPriority != null ? `${c.highPriority} high priority` : 'Stage 4 prospects';
          return `<td${tdClass} data-tip="${esc(tip)}">${esc(String(c.prospectCount))}${
            c.highPriority != null
              ? ` <span class="muted">(${esc(String(c.highPriority))}↑)</span>`
              : ''
          }</td>`;
        }
        if (col.key === 'batch') {
          const bid = c.source?.batchId || '';
          return `<td${tdClass} data-tip="${esc(bid)}"><span class="cell-text">${esc(
            bid || '—',
          )}</span></td>`;
        }
        if (col.key === 'notes') {
          const notes = c.decisionNotes || '';
          return `<td${tdClass}><input class="cand-notes" data-id="${esc(
            c.id,
          )}" data-tip="${esc(notes)}" value="${esc(notes)}" /></td>`;
        }
        if (col.key === 'apiSpend') {
          const spend = candidateApiSpendBreakdown(c);
          const tip = candidateApiSpendTip(spend);
          const label =
            spend.total == null ? '—' : esc(formatMoney(spend.total));
          return `<td${tdClass} data-tip="${esc(tip)}">${label}</td>`;
        }
        if (col.key === '_rank') {
          return `<td${tdClass}>${esc(candidatePipelineRank(c))}</td>`;
        }
        return `<td${tdClass}>—</td>`;
      });
      return `<tr class="${active}" data-id="${esc(c.id)}">${cells.join('')}</tr>`;
    })
    .join('');

  syncHeaderSelectAll(document.getElementById('candidate-select-all'), {
    selectedCount: list.filter((c) => state.selectedIds.has(c.id)).length,
    totalCount: list.length,
  });

  document.getElementById('candidate-select-all')?.addEventListener('change', (e) => {
    if (candidateSelectionLocked()) {
      e.target.checked = list.every((c) => state.selectedIds.has(c.id));
      return;
    }
    const on = e.target.checked;
    for (const c of list) {
      if (on) state.selectedIds.add(c.id);
      else state.selectedIds.delete(c.id);
    }
    updateCandidateSelectionCount();
    renderList();
    if (state.selectedIds.size > 1) {
      renderActions();
      renderMultiDetail();
    } else if (state.selectedIds.size === 1) {
      void selectCandidate([...state.selectedIds][0]);
    } else {
      renderActions();
      syncCandidatesDetailVisibility();
    }
  });
  thead.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.candidateSort.key === key) state.candidateSort.dir *= -1;
      else state.candidateSort = { key, dir: key === 'proposedScore' || key === '_live' || key === '_rank' || key === '_websiteTrack' ? -1 : 1 };
      renderList();
    });
  });
  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (
        e.target.closest(
          'input.cand-check, select.cand-decision, input.cand-notes, button.cand-open-map',
        )
      )
        return;
      selectCandidate(tr.dataset.id);
    });
  });
  tbody.querySelectorAll('button.cand-open-map').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const city = btn.dataset.city || '';
      const st = btn.dataset.state || '';
      setView('map');
      try {
        await openResearchMap({ city, state: st }, { api, esc, showModal });
      } catch (error) {
        await showModal({
          title: 'Map failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
    });
  });
  tbody.querySelectorAll('.cand-check').forEach((cb) => {
    const applyCandShiftRange = (e) => {
      const id = cb.dataset.id;
      return applyShiftRangeCheckboxClick(e, {
        visibleKeys: list.map((c) => c.id),
        clickedKey: id,
        anchorKey: state.candidateCheckAnchor,
        setAnchor: (key) => {
          state.candidateCheckAnchor = key;
        },
        setSelected: (key, on) => {
          if (on) state.selectedIds.add(key);
          else state.selectedIds.delete(key);
        },
      });
    };
    cb.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (candidateSelectionLocked()) {
        e.preventDefault();
        cb.checked = state.selectedIds.has(cb.dataset.id);
        return;
      }
      if (!e.shiftKey || state.candidateCheckAnchor == null) return;
      blockShiftRangePointerDown(e, state.candidateCheckAnchor);
      if (applyCandShiftRange(e)) afterCandidateCheckboxSelection(list);
    });
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      if (candidateSelectionLocked()) {
        e.preventDefault();
        cb.checked = state.selectedIds.has(cb.dataset.id);
        return;
      }
      if (applyCandShiftRange(e)) afterCandidateCheckboxSelection(list);
    });
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (candidateSelectionLocked()) {
        cb.checked = state.selectedIds.has(cb.dataset.id);
        return;
      }
      const id = cb.dataset.id;
      if (consumeShiftRangeChange(cb, id)) {
        cb.checked = state.selectedIds.has(id);
        return;
      }
      state.candidateCheckAnchor = id;
      if (cb.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      afterCandidateCheckboxSelection(list);
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
  enableTableColumnResize(document.getElementById('candidate-table'), {
    freezeCols: 7,
  });
}

async function selectCandidate(id) {
  if (candidateSelectionLocked()) return;
  state.selectedId = id;
  state.multiQueue = false;
  state.contentOpenStep = null;
  state.websiteOpenStep = null;
  state.siteConfigOpenStep = null;
  state.contentFollowCurrent = undefined;
  state.websiteFollowCurrent = undefined;
  state.siteConfigFollowCurrent = undefined;
  state.contentSoftCurrent = null;
  state.websiteSoftCurrent = null;
  state.siteConfigSoftCurrent = null;
  state.contentSoftDone = {};
  state.websiteSoftDone = {};
  state.siteConfigSoftDone = {};
  state.assembleProgress = { visible: false, detail: '', done: null, total: null };
  state.preparePreviewHold = false;
  state.preparePreviewJobId = null;
  state.preparePreviewTab = null;
  state.reviewImageSlots = [];
  state.reviewBa = null;
  state.reviewPhotoGroupMenuOpen = false;
  if (state.selectedIds.size > 1) {
    renderList();
    renderMultiDetail();
    renderActions();
    return;
  }
  // Keep checkbox selection aligned with the open detail (avoids Accept hitting another id)
  state.selectedIds.clear();
  state.selectedIds.add(id);
  renderList();
  syncCandidatesDetailVisibility();
  document.getElementById('empty-detail').classList.add('hidden');
  document.getElementById('detail').classList.remove('hidden');
  try {
    await loadSelectedCandidateDetail(id);
    if (state.selectedId === id) renderDetail();
  } catch (error) {
    if (error?.name === 'AbortError') return;
    throw error;
  }
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
  const titleEl = document.getElementById('detail-title');
  titleEl.textContent = `${ids.length} candidates selected`;
  setElementTip(titleEl, '');
  titleEl.removeAttribute('aria-label');
  const idTip = document.getElementById('detail-id-tip');
  if (idTip) {
    idTip.classList.add('hidden');
    setElementTip(idTip, '');
    idTip.setAttribute('aria-label', 'Candidate id');
  }
  document.getElementById('detail-sub').textContent =
    'Stage rail runs on the full selection · click a row to focus one candidate';
  renderActions();
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === 'overview');
  });
  const byId = new Map(state.candidates.map((c) => [c.id, c]));
  const batchKids = state.lastBatchJob?.children || [];
  const jobById = new Map(batchKids.map((c) => [c.candidateId, c]));
  const agg = aggregateSelectedFlags();
  const draftCount = agg.hasNarrativeDraft || 0;
  const busy = Boolean(state.activeJobId || state.activeBatchJobId || state.claudeBusy);
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
  const narrBatch =
    draftCount > 0
      ? `<div class="narrative-actions multi-queue-narrative">
          <button type="button" class="btn primary" data-act="accept" ${busy ? 'disabled' : ''} data-tip="Commit narrative drafts for selected candidates with drafts">Accept draft (${draftCount})</button>
          <button type="button" class="btn danger" data-act="reject" ${busy ? 'disabled' : ''} data-tip="Discard narrative drafts for selected candidates">Reject draft (${draftCount})</button>
        </div>`
      : '';
  document.getElementById('tab-panels').innerHTML = `
    <div class="multi-queue">
      <p class="muted">Queue for batch stages. Focus a row for Narrative tab Accept / single detail.</p>
      ${narrBatch}
      <table>
        <thead><tr><th>ID</th><th>Niche</th><th>City</th><th>Stage</th><th>Decision</th><th>Last batch</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  document.querySelectorAll('[data-focus-id]').forEach((tr) => {
    tr.addEventListener('click', () => selectCandidate(tr.dataset.focusId));
  });
  document.querySelectorAll('#tab-panels [data-act]').forEach((btn) => {
    btn.addEventListener('click', () => handleAction(btn.dataset.act, btn));
  });
  enableResizableTablesIn(document.getElementById('tab-panels'), {
    storagePrefix: 'detail:multi',
  });
}

function stageCheckMark() {
  return `<span class="stage-check" ${tipAttr('Completed')}>✓</span>`;
}

function stageDraftMark() {
  return `<span class="stage-draft" ${tipAttr('Draft present (not committed yet)')}>draft</span>`;
}

function updateTabCompletion() {
  const f = state.detail?.stageFlags || {};
  const labels = {
    overview: 'Overview',
    serp: '1 · SERP / Volume',
    keywords: '1 · Keywords',
    enrichment: '2 · Enrich',
    narrative: '3 · Narrative',
    'site-config': '1 · Site-Config',
    content: '2 · Content',
    website: '3 · Launch',
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
      done = isWebsiteTrackComplete(state.detail, 1);
      draft = Boolean(f.hasSiteConfigDraft) && !f.hasSiteConfig;
    }
    if (key === 'content') {
      done = isWebsiteTrackComplete(state.detail, 2);
      draft =
        (Boolean(f.hasContentDraft) || Boolean(f.hasContentBrief)) && !f.hasContent;
    }
    if (key === 'website') {
      const meta = state.detail?.meta || {};
      done = isWebsiteTrackComplete(state.detail, 3);
      draft =
        Boolean(meta.lastAssembleAt || meta.lastSiteStagingAt) &&
        !isWebsiteLaunched(state.detail);
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
    if (key === 'keywords') {
      setElementTip(tab, 'Evaluation 1 · keyword volumes from SERP / Volume');
    }
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

const CLAUDE_UI_MODE_KEY = 'ops.claudeUiMode';
const CLAUDE_UI_RESTORE_KEY = 'ops.claudeUiRestore';
const CLAUDE_UI_VIEWS = new Set([
  'discovery',
  'research',
  'website-builder',
  'launched-sites',
  'phone',
  'map',
  'photo',
]);

function getClaudeUiMode() {
  try {
    return localStorage.getItem(CLAUDE_UI_MODE_KEY) === 'api' ? 'api' : 'paste';
  } catch {
    return 'paste';
  }
}

function setClaudeUiMode(mode) {
  const next = mode === 'api' ? 'api' : 'paste';
  try {
    localStorage.setItem(CLAUDE_UI_MODE_KEY, next);
  } catch {
    /* ignore */
  }
  return next;
}

function anthropicConfigured() {
  const items = state.health?.connections?.items;
  if (Array.isArray(items)) {
    const row = items.find((i) => String(i.name || '') === 'Anthropic');
    if (row) return Boolean(row.ok);
  }
  return Boolean(state.apiCostConfigured?.anthropic);
}

function effectiveClaudeUiMode() {
  const stored = getClaudeUiMode();
  if (stored === 'api' && !anthropicConfigured()) return 'paste';
  return stored;
}

function applyClaudeUiModeAttr(mode = effectiveClaudeUiMode()) {
  document.documentElement.setAttribute('data-claude-mode', mode === 'api' ? 'api' : 'paste');
}

function writeSiteJobRunning(candidateId = null) {
  const jobs = state.lightJobsSnap?.jobs || [];
  const cid = candidateId != null ? String(candidateId) : null;
  return jobs.some(
    (j) =>
      j.phase === 'write-site' &&
      (j.status === 'running' || j.status === 'queued') &&
      (!cid || String(j.candidateId) === cid),
  );
}

function generatePackJobRunning() {
  const jobs = state.lightJobsSnap?.jobs || [];
  return jobs.some(
    (j) => j.phase === 'generate-pack' && (j.status === 'running' || j.status === 'queued'),
  );
}

function claudeApiJobRunning() {
  return writeSiteJobRunning() || generatePackJobRunning() || Boolean(state.claudeBusy);
}

function showAppBootLoading(text = 'Loading…') {
  const boot = document.getElementById('app-boot-loading');
  if (!boot) return;
  const label = boot.querySelector('.rover-loading-text');
  if (label) label.textContent = String(text || 'Loading…');
  boot.classList.remove('hidden');
  boot.setAttribute('aria-hidden', 'false');
  boot.setAttribute('aria-busy', 'true');
}

function hideAppBootLoading() {
  const boot = document.getElementById('app-boot-loading');
  if (!boot) return;
  boot.classList.add('hidden');
  boot.setAttribute('aria-hidden', 'true');
  boot.setAttribute('aria-busy', 'false');
  syncJobOverlayTop();
}

function peekClaudeUiRestore() {
  try {
    const raw = sessionStorage.getItem(CLAUDE_UI_RESTORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function takeClaudeUiRestore() {
  const parsed = peekClaudeUiRestore();
  try {
    sessionStorage.removeItem(CLAUDE_UI_RESTORE_KEY);
  } catch {
    /* ignore */
  }
  return parsed;
}

function stashClaudeUiRestore() {
  const payload = {
    view: state.view,
    tab: state.tab,
    selectedId: state.selectedId || null,
    selectedIds: [...state.selectedIds],
  };
  try {
    sessionStorage.setItem(CLAUDE_UI_RESTORE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

function syncClaudeModeToggle() {
  const stored = getClaudeUiMode();
  const anthropicOk = anthropicConfigured();
  const effective = anthropicOk ? stored : 'paste';
  applyClaudeUiModeAttr(effective);
  const pasteBtn = document.getElementById('claude-mode-paste');
  const apiBtn = document.getElementById('claude-mode-api');
  const locked = claudeApiJobRunning();
  if (pasteBtn) {
    pasteBtn.classList.toggle('active', effective === 'paste');
    pasteBtn.disabled = locked;
    if (locked) {
      setElementTip(pasteBtn, 'Wait until the Claude API job finishes.');
    } else {
      pasteBtn.removeAttribute('data-tip');
      pasteBtn.setAttribute('aria-label', 'Copy and paste');
    }
  }
  if (apiBtn) {
    apiBtn.classList.toggle('active', effective === 'api');
    apiBtn.disabled = locked || !anthropicOk;
    if (!anthropicOk) {
      setElementTip(
        apiBtn,
        'Add ANTHROPIC_API_KEY to .env and restart Rover to use Anthropic API mode.',
      );
    } else if (locked) {
      setElementTip(apiBtn, 'Wait until the Claude API job finishes.');
    } else {
      setElementTip(apiBtn, 'Use Claude through the Anthropic API instead of Copy and paste.');
    }
  }
  syncDiscoveryClaudeModeUi();
}

function switchClaudeUiMode(next) {
  const want = next === 'api' ? 'api' : 'paste';
  if (want === 'api' && !anthropicConfigured()) return;
  if (claudeApiJobRunning()) return;
  if (want === effectiveClaudeUiMode()) {
    setClaudeUiMode(want);
    syncClaudeModeToggle();
    return;
  }
  setClaudeUiMode(want);
  applyClaudeUiModeAttr(want);
  stashClaudeUiRestore();
  showAppBootLoading();
  location.reload();
}

async function applyClaudeUiRestore() {
  const stash = takeClaudeUiRestore();
  if (!stash) return;
  if (stash.tab) state.tab = stash.tab;
  const ids = Array.isArray(stash.selectedIds)
    ? stash.selectedIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const selectedId = String(stash.selectedId || ids[0] || '').trim();
  if (!isCandidatesShellView(state.view)) return;
  try {
    if (ids.length > 1) {
      state.selectedIds = new Set(ids);
      state.selectedId = selectedId || ids[0];
      renderList();
      renderMultiDetail();
      renderActions();
      return;
    }
    if (selectedId) {
      await selectCandidate(selectedId);
    }
  } catch {
    /* candidate may have been deleted */
  }
}

function wireClaudeModeUi() {
  document.getElementById('claude-mode-paste')?.addEventListener('click', () => {
    switchClaudeUiMode('paste');
  });
  document.getElementById('claude-mode-api')?.addEventListener('click', () => {
    switchClaudeUiMode('api');
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== CLAUDE_UI_MODE_KEY) return;
    if (event.newValue === event.oldValue) return;
    if (claudeApiJobRunning()) return;
    showAppBootLoading();
    location.reload();
  });
  syncClaudeModeToggle();
}

function readBaViewpointMap() {
  try {
    const raw = localStorage.getItem('ops.baViewpoint');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function getBaViewpoint(stepKey = 'home') {
  const key = String(stepKey || 'home').trim() || 'home';
  const map = readBaViewpointMap();
  return map[key] === 'outside' ? 'outside' : 'inside';
}

function setBaViewpoint(stepKey, viewpoint) {
  const key = String(stepKey || 'home').trim() || 'home';
  const next = viewpoint === 'outside' ? 'outside' : 'inside';
  const map = { ...readBaViewpointMap(), [key]: next };
  try {
    localStorage.setItem('ops.baViewpoint', JSON.stringify(map));
  } catch {
    /* ignore */
  }
  return next;
}

function cacheBaCardPrompts(matchKey, pair = {}) {
  const key = String(matchKey || '').trim();
  if (!key) return;
  state.baPromptCache = state.baPromptCache || {};
  state.baPromptCache[key] = {
    lastPrompts: pair.lastPrompts || null,
    promptsForGenerate: pair.promptsForGenerate || null,
    promptPlan: pair.promptPlan || null,
  };
}

function pickBaDisplayPrompts(matchKey) {
  const key = String(matchKey || '').trim();
  const cache = state.baPromptCache?.[key] || {};
  const vp = getBaViewpoint(key);
  const gen = cache.promptsForGenerate?.[vp];
  if (gen?.before && gen?.after) {
    return {
      before: gen.before,
      after: gen.after,
      originalBefore: gen.originalBefore || gen.before,
      originalAfter: gen.originalAfter || gen.after,
      viewpoint: vp,
      room: gen.room || null,
      setting: gen.setting || null,
      label:
        gen.source === 'override'
          ? 'Edited'
          : gen.source === 'claude'
            ? 'From Image queries'
            : 'Template',
    };
  }
  const plan = cache.promptPlan?.[vp];
  if (plan?.before && plan?.after) {
    return {
      before: plan.before,
      after: plan.after,
      originalBefore: plan.before,
      originalAfter: plan.after,
      viewpoint: vp,
      room: cache.promptPlan?.room || null,
      label: 'From Image queries',
    };
  }
  return null;
}

function promptDraftStore() {
  state.openaiPromptDrafts = state.openaiPromptDrafts || {};
  return state.openaiPromptDrafts;
}

function promptDraftId(scope, kind, key, vp) {
  return `${scope}|${kind}|${key}|${vp}`;
}

function slotPromptScope(card) {
  if (card?.closest('#view-photo')) {
    const gid = photoLibCurrent()?.groupId;
    return gid ? `pg:${gid}` : 'pg';
  }
  const id = state.detail?.id || state.selectedId || '';
  return id ? `ca:${id}` : 'ca';
}

function slotPromptPanel(card) {
  return card?.querySelector?.('.slot-prompt-panel') || null;
}

function readSlotPromptFields(panel) {
  const kind = panel?.getAttribute('data-prompt-kind') || 'photo';
  if (kind === 'ba') {
    return {
      kind: 'ba',
      before: panel.querySelector('.slot-prompt-before')?.value || '',
      after: panel.querySelector('.slot-prompt-after')?.value || '',
    };
  }
  return {
    kind: 'photo',
    prompt: panel.querySelector('.slot-prompt-text')?.value || '',
  };
}

function applySlotPromptFields(panel, fields = {}) {
  if (!panel) return;
  if (panel.getAttribute('data-prompt-kind') === 'ba') {
    const before = panel.querySelector('.slot-prompt-before');
    const after = panel.querySelector('.slot-prompt-after');
    if (before) before.value = fields.before || '';
    if (after) after.value = fields.after || '';
    return;
  }
  const ta = panel.querySelector('.slot-prompt-text');
  if (ta) ta.value = fields.prompt || '';
}

function stashSlotPromptDraft(card) {
  const panel = slotPromptPanel(card);
  if (!panel) return;
  const key = panel.getAttribute('data-prompt-key') || '';
  const kind = panel.getAttribute('data-prompt-kind') || 'photo';
  const vp = panel.dataset.loadedViewpoint || getBaViewpoint(key);
  const fields = readSlotPromptFields(panel);
  const has = kind === 'ba' ? Boolean(fields.before || fields.after) : Boolean(fields.prompt);
  if (!has) return;
  promptDraftStore()[promptDraftId(slotPromptScope(card), kind, key, vp)] = fields;
}

function promptBodyFromCard(card, { pair = false } = {}) {
  const panel = slotPromptPanel(card);
  const key =
    panel?.getAttribute('data-prompt-key') ||
    card?.getAttribute('data-slot-key') ||
    card?.getAttribute('data-match-key') ||
    '';
  const viewpoint = getBaViewpoint(key);
  if (!panel) return { viewpoint };
  const loaded = panel.dataset.loadedViewpoint;
  if (loaded && loaded !== viewpoint) return { viewpoint };
  const fields = readSlotPromptFields(panel);
  if (pair || fields.kind === 'ba') {
    const before = String(fields.before || '').trim();
    const after = String(fields.after || '').trim();
    return {
      viewpoint,
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    };
  }
  const prompt = String(fields.prompt || '').trim();
  return { viewpoint, ...(prompt ? { prompt } : {}) };
}

function slotPromptApiUrls(card) {
  const panel = slotPromptPanel(card);
  const key = panel?.getAttribute('data-prompt-key') || '';
  const kind = panel?.getAttribute('data-prompt-kind') || 'photo';
  const vp = getBaViewpoint(key);
  const photo = Boolean(card?.closest('#view-photo'));
  if (photo) {
    const gid = photoLibCurrent()?.groupId;
    if (!gid) return null;
    if (kind === 'ba') {
      const params = new URLSearchParams({ matchKey: key, viewpoint: vp });
      return {
        get: `/api/photo-groups/${encodeURIComponent(gid)}/before-after-prompts?${params}`,
        save: `/api/photo-groups/${encodeURIComponent(gid)}/before-after/openai-prompt`,
        saveBody: () => {
          const fields = readSlotPromptFields(panel);
          return {
            matchKey: key,
            viewpoint: vp,
            before: fields.before,
            after: fields.after,
          };
        },
        restoreBody: { matchKey: key, viewpoint: vp, restore: true },
      };
    }
    const params = new URLSearchParams({ viewpoint: vp });
    return {
      get: `/api/photo-groups/${encodeURIComponent(gid)}/slots/${encodeURIComponent(key)}/chatgpt-prompt?${params}`,
      save: `/api/photo-groups/${encodeURIComponent(gid)}/slots/${encodeURIComponent(key)}/openai-prompt`,
      saveBody: () => ({
        viewpoint: vp,
        prompt: readSlotPromptFields(panel).prompt,
      }),
      restoreBody: { viewpoint: vp, restore: true },
    };
  }
  const candidateId = state.detail?.id || state.selectedId;
  if (!candidateId) return null;
  if (kind === 'ba') {
    const { serviceSlug: slug, pairIndex } = baTargetFromGenerateEl(card);
    const params = new URLSearchParams({
      viewpoint: vp,
      pairIndex: String(pairIndex || 1),
    });
    if (slug) params.set('service', slug);
    return {
      get: `/api/candidates/${encodeURIComponent(candidateId)}/images/before-after-prompts?${params}`,
      save: `/api/candidates/${encodeURIComponent(candidateId)}/images/before-after/openai-prompt`,
      saveBody: () => {
        const fields = readSlotPromptFields(panel);
        return {
          viewpoint: vp,
          serviceSlug: slug,
          pairIndex,
          before: fields.before,
          after: fields.after,
        };
      },
      restoreBody: { viewpoint: vp, serviceSlug: slug, pairIndex, restore: true },
    };
  }
  const params = new URLSearchParams({ viewpoint: vp });
  return {
    get: `/api/candidates/${encodeURIComponent(candidateId)}/images/slots/${encodeURIComponent(key)}/chatgpt-prompt?${params}`,
    save: `/api/candidates/${encodeURIComponent(candidateId)}/images/slots/${encodeURIComponent(key)}/openai-prompt`,
    saveBody: () => ({
      viewpoint: vp,
      prompt: readSlotPromptFields(panel).prompt,
    }),
    restoreBody: { viewpoint: vp, restore: true },
  };
}

function applyFetchedPrompt(panel, data, kind) {
  if (kind === 'ba') {
    applySlotPromptFields(panel, {
      before: data.before || '',
      after: data.after || '',
    });
    const meta = panel.querySelector('.ba-prompts-meta');
    if (meta) {
      const label = data.overridden ? 'Edited' : data.source === 'claude' ? 'From Image queries' : 'Template';
      meta.textContent = `${label} · ${data.viewpoint || ''}${data.room ? ` · ${data.room}` : ''}`;
    }
    return;
  }
  applySlotPromptFields(panel, { prompt: data.prompt || '' });
}

async function fetchAndFillPromptPanel(card) {
  const panel = slotPromptPanel(card);
  if (!panel) return;
  const urls = slotPromptApiUrls(card);
  if (!urls) return;
  const kind = panel.getAttribute('data-prompt-kind') || 'photo';
  const key = panel.getAttribute('data-prompt-key') || '';
  const vp = getBaViewpoint(key);
  const data = await api(urls.get);
  applyFetchedPrompt(panel, data, kind);
  panel.dataset.loadedViewpoint = vp;
}

async function loadSlotPromptForViewpoint(card) {
  const panel = slotPromptPanel(card);
  if (!panel) return;
  const key = panel.getAttribute('data-prompt-key') || '';
  const kind = panel.getAttribute('data-prompt-kind') || 'photo';
  const vp = getBaViewpoint(key);
  const draft = promptDraftStore()[promptDraftId(slotPromptScope(card), kind, key, vp)];
  if (draft) {
    applySlotPromptFields(panel, draft);
    panel.dataset.loadedViewpoint = vp;
    return;
  }
  if (kind === 'ba') {
    const picked = pickBaDisplayPrompts(key);
    if (picked) {
      applySlotPromptFields(panel, { before: picked.before, after: picked.after });
      const meta = panel.querySelector('.ba-prompts-meta');
      if (meta) {
        meta.textContent = `${picked.label} · ${picked.viewpoint}${
          picked.room ? ` · ${picked.room}` : ''
        }`;
      }
      panel.dataset.loadedViewpoint = vp;
    }
  }
  if (panel.open) {
    try {
      await fetchAndFillPromptPanel(card);
    } catch {
      /* keep cached/draft text */
    }
  } else {
    panel.dataset.loadedViewpoint = vp;
  }
}

async function persistSlotPromptPanel(card) {
  const panel = slotPromptPanel(card);
  if (!panel) return;
  stashSlotPromptDraft(card);
  const urls = slotPromptApiUrls(card);
  if (!urls) return;
  const fields = readSlotPromptFields(panel);
  const empty =
    fields.kind === 'ba' ? !(fields.before || '').trim() && !(fields.after || '').trim() : !(fields.prompt || '').trim();
  if (empty) return;
  try {
    const data = await api(urls.save, {
      method: 'POST',
      body: JSON.stringify(urls.saveBody()),
    });
    applyFetchedPrompt(panel, data, fields.kind);
  } catch (error) {
    showToast(error.message || 'Could not save prompt');
  }
}

async function restoreSlotPromptPanel(card) {
  const panel = slotPromptPanel(card);
  if (!panel) return;
  const urls = slotPromptApiUrls(card);
  if (!urls) return;
  const key = panel.getAttribute('data-prompt-key') || '';
  const kind = panel.getAttribute('data-prompt-kind') || 'photo';
  const vp = getBaViewpoint(key);
  delete promptDraftStore()[promptDraftId(slotPromptScope(card), kind, key, vp)];
  const data = await api(urls.save, {
    method: 'POST',
    body: JSON.stringify(urls.restoreBody),
  });
  applyFetchedPrompt(panel, data, kind);
  panel.dataset.loadedViewpoint = vp;
}

function fillBaPromptsPanel(card) {
  void loadSlotPromptForViewpoint(card);
}

function slotPromptPanelHtml({ kind = 'photo', key, pair = null } = {}) {
  const tip = 'Copy prompt and OpenAI generate both use this text.';
  const vp = getBaViewpoint(key);
  if (kind === 'ba') {
    cacheBaCardPrompts(key, pair);
    const picked = pickBaDisplayPrompts(key);
    const meta = picked
      ? `${esc(picked.label)} · ${esc(picked.viewpoint)}${picked.room ? ` · ${esc(picked.room)}` : ''}`
      : 'Opens with the current Inside/Outside prompt.';
    return `<details class="slot-prompt-panel ba-prompts" data-prompt-kind="ba" data-prompt-key="${esc(
      key,
    )}" data-loaded-viewpoint="${esc(vp)}">
      <summary class="slot-prompt-summary">
        <span>Prompt</span>
        <button type="button" class="btn btn-sm slot-prompt-restore" data-tip="Restore the original prompt">Restore</button>
      </summary>
      <p class="muted slot-prompt-tip">${esc(tip)}</p>
      <p class="muted ba-prompts-meta">${meta}</p>
      <p class="slot-prompt-label"><strong>Before</strong></p>
      <textarea class="slot-prompt-before ba-prompts-before" spellcheck="false">${esc(picked?.before || '')}</textarea>
      <p class="slot-prompt-label"><strong>After</strong></p>
      <textarea class="slot-prompt-after ba-prompts-after" spellcheck="false">${esc(picked?.after || '')}</textarea>
    </details>`;
  }
  return `<details class="slot-prompt-panel" data-prompt-kind="photo" data-prompt-key="${esc(
    key,
  )}" data-loaded-viewpoint="${esc(vp)}">
    <summary class="slot-prompt-summary">
      <span>Prompt</span>
      <button type="button" class="btn btn-sm slot-prompt-restore" data-tip="Restore the original prompt">Restore</button>
    </summary>
    <p class="muted slot-prompt-tip">${esc(tip)}</p>
    <textarea class="slot-prompt-text" spellcheck="false" placeholder="Opens with the current Inside/Outside prompt."></textarea>
  </details>`;
}

function wireSlotPromptEvents(root) {
  if (!root || root.dataset.promptWired === '1') return;
  root.dataset.promptWired = '1';
  root.addEventListener('mousedown', (ev) => {
    if (ev.target.closest('.slot-prompt-restore')) ev.preventDefault();
  });
  root.addEventListener('click', async (ev) => {
    const restore = ev.target.closest('.slot-prompt-restore');
    if (!restore || !root.contains(restore)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const card = restore.closest('.image-slot-card');
    try {
      await restoreSlotPromptPanel(card);
      showToast('Restored original prompt.');
    } catch (error) {
      showToast(error.message || 'Restore failed');
    }
  });
  root.addEventListener(
    'toggle',
    (ev) => {
      const panel = ev.target;
      if (!(panel instanceof HTMLDetailsElement) || !panel.classList.contains('slot-prompt-panel')) return;
      if (!panel.open) return;
      void loadSlotPromptForViewpoint(panel.closest('.image-slot-card'));
    },
    true,
  );
  root.addEventListener('focusout', (ev) => {
    const panel = ev.target.closest?.('.slot-prompt-panel');
    if (!panel || !root.contains(panel)) return;
    if (ev.relatedTarget && panel.contains(ev.relatedTarget)) return;
    void persistSlotPromptPanel(panel.closest('.image-slot-card'));
  });
}

function baViewpointSegmentHtml(stepKey = 'home') {
  const key = String(stepKey || 'home').trim() || 'home';
  const mode = getBaViewpoint(key);
  const tip =
    'Inside = camera indoors at the service feature · Outside = camera outdoors (foundation / well / exterior). Default Inside.';
  return `<div class="ads-mode-segment ba-viewpoint-segment" role="group" aria-label="Photo viewpoint" data-ba-viewpoint-step="${esc(
    key,
  )}" ${tipAttr(tip)}>
    <button type="button" class="ads-mode-seg${
      mode === 'inside' ? ' active' : ''
    }" data-ba-viewpoint="inside">Inside</button>
    <button type="button" class="ads-mode-seg${
      mode === 'outside' ? ' active' : ''
    }" data-ba-viewpoint="outside">Outside</button>
  </div>`;
}

function baTargetFromGenerateEl(el) {
  const card = el?.closest?.('.photo-ba-card') || el?.closest?.('.image-slot-card');
  const raw = String(
    el?.getAttribute?.('data-match-key') || card?.getAttribute('data-match-key') || 'home:1',
  ).replace(/^ba:/, '');
  const isSvc = raw.startsWith('svc:');
  const fromCardSlug = String(card?.getAttribute('data-service-slug') || '').trim();
  const serviceSlug = isSvc ? raw.slice(4) : fromCardSlug;
  const pairIndex = isSvc
    ? 1
    : Number(card?.getAttribute('data-pair-index') || String(raw).split(':')[1] || 1) || 1;
  return { matchKey: raw, serviceSlug, pairIndex };
}

function getForceSerp() {
  try {
    return localStorage.getItem('ops.forceSerp') === '1';
  } catch {
    return false;
  }
}

function setForceSerp(on) {
  const next = Boolean(on);
  try {
    localStorage.setItem('ops.forceSerp', next ? '1' : '0');
  } catch {
    /* ignore */
  }
  return next;
}

function researchOptsFromUi() {
  return {
    forceSerp: getForceSerp(),
    volumesOnly: false,
  };
}

function adsModeSegmentHtml(disabled = false) {
  const mode = getAdsMode();
  const tip =
    'Live ≈ $0.075–0.09/Ads task · Standard queue ≈ $0.05–0.06 (slower, overnight OK)';
  return `<div class="ads-mode-segment" role="group" aria-label="Ads queue" ${tipAttr(tip)}>
    <button type="button" class="ads-mode-seg${mode === 'live' ? ' active' : ''}" data-ads-mode="live" ${
      disabled ? 'disabled' : ''
    }>Live</button>
    <button type="button" class="ads-mode-seg${
      mode === 'standard' ? ' active' : ''
    }" data-ads-mode="standard" ${disabled ? 'disabled' : ''}>Standard</button>
  </div>`;
}

function forceSerpCheckboxHtml(disabled = false) {
  const on = getForceSerp();
  return `<label class="research-force-serp" ${tipAttr(
    'Refetch Map Pack/organic (~$0.002). Leave off to reuse cached SERP when available.',
  )}>
    <input type="checkbox" id="research-force-serp" ${on ? 'checked' : ''} ${
      disabled ? 'disabled' : ''
    } />
    <span class="research-force-serp-text">Force<br />new SERP</span>
  </label>`;
}

function jobActLabel(act) {
  return (
    {
      research: 'SERP / Volume',
      enrich: 'Enrich',
      narrative: 'Narrative',
      prospects: 'Prospects',
      outreach: 'Outreach',
      'write-site': 'Write site',
      writeSite: 'Write site',
      'generate-pack': 'Generate pack',
      generatePack: 'Generate pack',
      'evaluate-all': 'Run all',
      evaluateAll: 'Run all',
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
  syncClaudeModeToggle();
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
    act === 'evaluate-all' || act === 'evaluateAll'
      ? `<p><strong>Ads volumes:</strong> Live (~$0.075–0.09/task, seconds). Force new SERP is off.</p>
        <p class="muted">Skips steps that already have data. Narrative uses the Anthropic API.</p>`
      : act === 'research'
        ? `<p><strong>Ads volumes:</strong> ${
            getAdsMode() === 'standard'
              ? 'Standard queue (~$0.05–0.06/task, slower — good overnight)'
              : 'Live (~$0.075–0.09/task, seconds)'
          }.</p>${
            getForceSerp()
              ? '<p><strong>Force new SERP:</strong> on — refetches Map Pack/organic (~$0.002) before refreshing volumes.</p>'
              : ''
          }`
        : '';
  return showModal({
    title: preview.title,
    confirmLabel: preview.confirmLabel || `Run on ${preview.runnable}`,
    bodyHtml: `
      ${preview.whatItDoes ? `<p>${esc(preview.whatItDoes)}</p>` : ''}
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
  const isMulti = multiIds.length > 1;
  // Single-target rail follows open detail; batch only when checkboxes > 1
  const targetCount = isMulti ? multiIds.length : state.selectedId || d ? 1 : 0;
  el.classList.remove('hidden');

  const agg = isMulti ? aggregateSelectedFlags() : null;
  const focusedId = isMulti ? null : state.selectedId;
  const listRow = focusedId
    ? state.candidates.find((c) => c.id === focusedId)
    : null;
  const detailMatches = Boolean(d && focusedId && d.id === focusedId);
  const f =
    targetCount === 0
      ? {}
      : detailMatches
        ? d.stageFlags || {}
        : listRow?.stageFlags || d?.stageFlags || {};
  const researchDone =
    targetCount === 0
      ? false
      : targetCount > 1
        ? agg.hasResearch === agg.count && agg.count > 0
        : Boolean(f.hasResearch);
  const enrichDone =
    targetCount === 0
      ? false
      : targetCount > 1
        ? agg.hasEnrichment === agg.count && agg.count > 0
        : Boolean(f.hasEnrichment);
  const narrAccepted =
    targetCount === 0
      ? false
      : targetCount > 1
        ? agg.hasNarrative === agg.count && agg.count > 0
        : Boolean(f.hasNarrative);
  const narrDraft =
    targetCount === 0
      ? false
      : targetCount > 1
        ? agg.hasNarrativeDraft > 0 && agg.hasNarrative < agg.count
        : Boolean(f.hasNarrativeDraft) && !f.hasNarrative;
  const prospectsDone =
    targetCount === 0
      ? false
      : targetCount > 1
        ? agg.hasProspects === agg.count && agg.count > 0
        : Boolean(f.hasProspects);
  const currentStage =
    targetCount === 0
      ? null
      : !researchDone
        ? 'research'
        : !enrichDone
          ? 'enrich'
          : !narrAccepted
            ? 'narrative'
            : null;
  const busy = Boolean(state.activeJobId || state.activeBatchJobId || state.claudeBusy);
  const runningAct = state.activeAct;
  const batchLabel = targetCount > 1 ? ` (${targetCount})` : '';
  const enrichGateOk = researchDone;
  const narrGateOk = enrichDone;
  const prospectsGateOk = narrAccepted;
  const stageBusyAttr = (act, gateOk = true) => {
    if (targetCount === 0) return 'disabled';
    if (!gateOk) return 'disabled';
    if (!busy) return '';
    if (runningAct === act) return 'disabled aria-busy="true"';
    return 'disabled';
  };
  const aggMark = (k, n) =>
    targetCount > 1 ? ` <span class="muted">${k}/${n}</span>` : '';
  const lc =
    targetCount === 0
      ? {}
      : (detailMatches ? d?.meta?.lastCosts : null) ||
        listRow?.lastCosts ||
        d?.meta?.lastCosts ||
        {};
  const costBits = [
    lc.research != null ? `SERP/Volume ${formatMoney(lc.research)}` : null,
    lc.enrich != null ? `Enrich ${formatMoney(lc.enrich)}` : null,
    lc.narrative != null ? `Narrative ~${formatMoney(lc.narrative)}` : null,
    lc.prospects != null ? `Prospects ${formatMoney(lc.prospects)}` : null,
    lc.outreach != null ? `Outreach ~${formatMoney(lc.outreach)}` : null,
  ].filter(Boolean);
  const metaBits = [
    targetCount === 0 ? 'Select rows, then run Evaluations 1–4 on the selection.' : null,
    isMulti ? `${targetCount} selected` : null,
    costBits.length && !isMulti && targetCount > 0
      ? `Last: ${costBits.join(' · ')}`
      : null,
  ].filter(Boolean);
  const narrDisabled = busy || targetCount !== 1 || !narrGateOk;
  const enrichTip = !enrichGateOk
    ? 'Complete Evaluation 1 (SERP / Volume) first'
    : 'Evaluation 2 — page fetch, Domain Rank, thinness / displaceability';
  const narrTip = !narrGateOk
    ? 'Complete Evaluation 2 (Enrich) first'
    : effectiveClaudeUiMode() === 'api'
      ? 'Run Narrative via the Anthropic API (confirm cost first)'
      : 'Copy Claude.ai prompt, then paste the JSON result on the Narrative tab (default — no API cost)';
  const prospectsTip = !prospectsGateOk
    ? 'Complete Evaluation 3 (Narrative) first'
    : 'Find local businesses via Maps SERP (optional)';
  const allFourDone =
    targetCount === 0
      ? false
      : targetCount > 1
        ? agg.hasResearch === agg.count &&
          agg.hasEnrichment === agg.count &&
          agg.hasNarrative === agg.count &&
          agg.hasProspects === agg.count &&
          agg.count > 0
        : Boolean(f.hasResearch && f.hasEnrichment && f.hasNarrative && f.hasProspects);
  const showRunAll = effectiveClaudeUiMode() === 'api';
  const runAllTip = allFourDone
    ? 'Evaluations 1–4 are already complete'
    : 'Fill missing Evaluations 1–4 in order. Ad volumes: Live, no Force new SERP.';

  el.innerHTML = `
    <div
      class="actions-toolbar"
      data-tip="✓ = stage has data. Select rows to batch Evaluations 1–4. Narrative Accept/Reject is on the Narrative tab (or multi-queue when several drafts)."
    >
      <div class="action-group stage-1${researchDone ? ' action-done' : ''}${
        runningAct === 'research' ? ' action-running' : ''
      }${currentStage === 'research' ? ' current' : ''}">
        <span class="action-group-head"><span class="action-group-title">SERP / Volume</span><span class="action-group-num">1${
          researchDone
            ? ` ${stageCheckMark()}`
            : targetCount > 1
              ? aggMark(agg.hasResearch, agg.count)
              : ''
        }</span></span>
        <div class="action-group-btns research-stage-btns">
          <button type="button" class="btn btn-sm primary" data-act="research" data-tip="Ads search volume + CPC (~$0.50+ with several cities). Reuses Map Pack/organic unless Force new SERP is checked." ${stageBusyAttr(
            'research',
          )}>${
            runningAct === 'research'
              ? 'Running…'
              : targetCount > 1
                ? `Ad volumes${batchLabel}`
                : 'Ad volumes'
          }</button>
          ${adsModeSegmentHtml(busy)}
          ${forceSerpCheckboxHtml(busy)}
        </div>
      </div>
      <div class="action-group stage-2${enrichDone ? ' action-done' : ''}${
        runningAct === 'enrich' ? ' action-running' : ''
      }${currentStage === 'enrich' ? ' current' : ''}">
        <span class="action-group-head"><span class="action-group-title">Enrich</span><span class="action-group-num">2${
          enrichDone
            ? ` ${stageCheckMark()}`
            : targetCount > 1
              ? aggMark(agg.hasEnrichment, agg.count)
              : ''
        }</span></span>
        <div class="action-group-btns">
          <button type="button" class="btn btn-sm primary" data-act="enrich" data-tip="${esc(
            enrichTip,
          )}" ${stageBusyAttr('enrich', enrichGateOk)}>${
            runningAct === 'enrich'
              ? 'Running…'
              : targetCount > 1
                ? `Run enrich${batchLabel}`
                : enrichDone
                  ? 'Re-enrich'
                  : 'Run enrich'
          }</button>
        </div>
      </div>
      <div class="action-group stage-narr${narrAccepted ? ' action-done' : ''}${
        narrDraft ? ' action-draft' : ''
      }${runningAct === 'narrative' || runningAct === 'outreach' ? ' action-running' : ''}${
        currentStage === 'narrative' ? ' current' : ''
      }">
        <span class="action-group-head"><span class="action-group-title">Narrative</span><span class="action-group-num">3${
          narrAccepted
            ? ` ${stageCheckMark()}`
            : narrDraft && targetCount === 1
              ? ` ${stageDraftMark()}`
              : targetCount > 1
                ? aggMark(agg.hasNarrativeDraft + agg.hasNarrative, agg.count)
                : ''
        }</span></span>
        <div class="action-group-btns">
          ${
            effectiveClaudeUiMode() === 'api'
              ? `<button type="button" class="btn btn-sm primary" data-act="narrative" ${stageBusyAttr(
                  'narrative',
                  narrGateOk,
                )} data-tip="${esc(narrTip)}">${
                  runningAct === 'narrative'
                    ? 'Running…'
                    : targetCount > 1
                      ? `Run Narrative${batchLabel}`
                      : narrDraft || narrAccepted
                        ? 'Re-run Narrative'
                        : 'Run Narrative'
                }</button>`
              : `<button type="button" class="btn btn-sm primary" data-act="copy-prompt" ${
                  narrDisabled ? 'disabled' : ''
                } data-tip="${esc(narrTip)}">Copy prompt</button>
          ${openClaudeAiBtnHtml({ disabled: narrDisabled, sm: true })}`
          }
        </div>
      </div>
      <span class="stage-rail-sep" aria-hidden="true"></span>
      <div class="action-group stage-4${prospectsDone ? ' action-done' : ''}${
        runningAct === 'prospects' || runningAct === 'outreach' ? ' action-running' : ''
      }">
        <span class="action-group-head"><span class="action-group-title">Prospects</span><span class="action-group-num">4${
          prospectsDone
            ? ` ${stageCheckMark()}`
            : targetCount > 1
              ? aggMark(agg.hasProspects, agg.count)
              : ''
        }</span></span>
        <div class="action-group-btns">
          <button type="button" class="btn btn-sm" data-act="prospects" data-tip="${esc(
            prospectsTip,
          )}" ${stageBusyAttr('prospects', prospectsGateOk)}>${
            runningAct === 'prospects'
              ? 'Running…'
              : targetCount > 1
                ? `Find renters${batchLabel}`
                : prospectsDone
                  ? 'Re-find'
                  : 'Find renters'
          }</button>
        </div>
      </div>
      ${
        showRunAll
          ? `<span class="stage-rail-sep stage-rail-sep-wide" aria-hidden="true"></span>
      <div class="action-group stage-all${allFourDone ? ' action-done' : ''}${
        runningAct === 'evaluate-all' ? ' action-running' : ''
      }">
        <span class="action-group-head"><span class="action-group-title">All</span><span class="action-group-num">1–4${
          allFourDone
            ? ` ${stageCheckMark()}`
            : targetCount > 1
              ? aggMark(
                  Math.min(
                    agg.hasResearch,
                    agg.hasEnrichment,
                    agg.hasNarrative,
                    agg.hasProspects,
                  ),
                  agg.count,
                )
              : ''
        }</span></span>
        <div class="action-group-btns">
          <button type="button" class="btn btn-sm primary" data-act="evaluate-all" data-tip="${esc(
            runAllTip,
          )}" ${stageBusyAttr('evaluate-all', targetCount > 0 && !allFourDone)}>${
            runningAct === 'evaluate-all'
              ? 'Running…'
              : targetCount > 1
                ? `Run all${batchLabel}`
                : 'Run all'
          }</button>
        </div>
      </div>`
          : ''
      }
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
        ? `<p class="stage-toolbar-meta muted"${
            targetCount === 0 ? '' : ' data-tip="Last recorded run costs"'
          }>${esc(metaBits.join(' · '))}</p>`
        : ''
    }
  `;

  el.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => handleAction(btn.dataset.act, btn));
  });
  el.querySelectorAll('[data-ads-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setAdsMode(btn.dataset.adsMode);
      renderActions();
    });
  });
  const forceSerp = el.querySelector('#research-force-serp');
  if (forceSerp) {
    forceSerp.addEventListener('change', () => {
      setForceSerp(forceSerp.checked);
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

async function warnResearchOrphansEnrichment(ids, forceSerp) {
  const enriched = ids.filter((cid) => {
    const row = state.candidates.find((c) => c.id === cid);
    return Boolean(row?.stageFlags?.hasEnrichment);
  });
  if (!enriched.length) return true;
  if (forceSerp) {
    return showModal({
      title: 'Force SERP keeps enrichment (may mark stale)',
      confirmLabel: 'Continue',
      bodyHtml: `<p><strong>${esc(String(enriched.length))}</strong> selected candidate(s) already have Stage 2 enrichment.</p>
        <p>SERP / Volume will <strong>keep</strong> Domain Rank / thinness. If Map Pack/organic URLs change, enrichment is marked <strong>stale</strong> — re-run Enrich when you want fresh Rank.</p>`,
    });
  }
  return showModal({
    title: 'SERP / Volume will keep enrichment',
    confirmLabel: 'Continue',
    bodyHtml: `<p><strong>${esc(String(enriched.length))}</strong> selected candidate(s) already have Stage 2 enrichment.</p>
      <p>Ad volumes will re-pull (main cost). Map Pack/organic stays cached unless you check <strong>Force new SERP</strong>.</p>`,
  });
}

const CONCURRENCY_UI = {
  lightSerp: { title: 'Light SERP limit', label: 'Light SERP' },
  evaluations: { title: 'Evaluation limit', label: 'Evaluations' },
  writeSite: { title: 'Write site limit', label: 'Write site' },
  openaiBeforeAfter: { title: 'OpenAI before/after limit', label: 'OpenAI before/after' },
  heavy: { title: 'Heavy job limit', label: 'Heavy (Prepare / Launch)' },
};

function concurrencyHardMax(key) {
  return Number(state.concurrencyMax?.[key]) || 50;
}

async function explainConcurrencyLimit({ key, selected, running, limit }) {
  const meta = CONCURRENCY_UI[key] || CONCURRENCY_UI.evaluations;
  const m = Number(limit);
  const hardMax = concurrencyHardMax(key);
  const n = selected != null ? Number(selected) : null;
  const run = running != null ? Number(running) : null;
  const lead =
    n != null && Number.isFinite(n)
      ? `You selected <strong>${esc(String(n))}</strong>. Concurrent Limit for <strong>${esc(
          meta.label,
        )}</strong> is <strong>${esc(String(m))}</strong>`
      : `Already <strong>${esc(String(Number.isFinite(run) ? run : m))}</strong> running. Concurrent Limit for <strong>${esc(
          meta.label,
        )}</strong> is <strong>${esc(String(m))}</strong>`;
  const orWhat =
    n != null && Number.isFinite(n) ? 'Or select fewer.' : 'Or wait for one to finish.';
  await showModal({
    title: meta.title,
    confirmLabel: 'OK',
    hideCancel: true,
    bodyHtml: `<p>${lead} — a soft limit so you do not spend too much money at once.</p>
    <p>To run more at the same time, raise <strong>${esc(
      meta.label,
    )}</strong> under <strong>Concurrent Limit</strong> in Settings (maximum ${esc(
      String(hardMax),
    )}). ${orWhat}</p>`,
  });
}

async function maybeExplainHeavyConcurrency(error) {
  if (error?.code !== 'HEAVY_CONCURRENCY') return false;
  await explainConcurrencyLimit({
    key: 'heavy',
    running: error.running,
    limit: error.limit ?? state.concurrency?.heavy ?? 2,
  });
  return true;
}

async function explainEvalConcurrencyLimit(selected, limit) {
  await explainConcurrencyLimit({
    key: 'evaluations',
    selected,
    limit,
  });
}

async function assertEvalConcurrencyAllows(ids) {
  const selected = Array.isArray(ids) ? ids.length : 0;
  if (selected <= 1) return true;
  const limit = Number(state.concurrency?.evaluations) || Number(state.evalConcurrency) || 6;
  if (selected <= limit) return true;
  await explainEvalConcurrencyLimit(selected, limit);
  return false;
}

async function handleAction(act, btn) {
  // Batch only when multi-selected; single path always uses the open detail
  const ids =
    state.selectedIds.size > 1
      ? [...state.selectedIds]
      : state.selectedId
        ? [state.selectedId]
        : [];
  const id = ids.length === 1 ? ids[0] : state.selectedId;
  btn.disabled = true;
  try {
    if (act === 'evaluate-all') {
      if (effectiveClaudeUiMode() !== 'api') return;
      if (state.activeJobId || state.activeBatchJobId || state.claudeBusy) return;
      if (!ids.length) return;
      if (!(await assertEvalConcurrencyAllows(ids))) return;
      const ok = await confirmBatchPaidAction('evaluate-all', ids);
      if (!ok) return;
      const batch = await api('/api/jobs/batch', {
        method: 'POST',
        body: JSON.stringify({
          act: 'evaluate-all',
          candidateIds: ids,
          adsMode: 'live',
          forceSerp: false,
        }),
      });
      state.activeBatchJobId = batch.id;
      state.activeAct = 'evaluate-all';
      state.lastBatchJob = batch;
      state.jobStatusLine = 'Starting Run all…';
      state.tab = 'logs';
      renderActions();
      if (state.selectedIds.size > 1) renderMultiDetail();
      pollBatchJob(batch.id);
      return;
    }

    if (act === 'research' || act === 'enrich' || act === 'prospects' || act === 'narrative') {
      if (state.activeJobId || state.activeBatchJobId || state.claudeBusy) return;
      if (!ids.length) return;
      if (!(await assertEvalConcurrencyAllows(ids))) return;

      if (act === 'narrative' && ids.length === 1) {
        const ok = await confirmPaidAction('narrative');
        if (!ok) return;
        state.claudeBusy = true;
        state.activeAct = 'narrative';
        state.jobStatusLine = 'Calling Claude…';
        renderActions();
        syncClaudeModeToggle();
        if (state.tab === 'narrative') renderDetail();
        try {
          const result = await api(`/api/candidates/${encodeURIComponent(ids[0])}/narrative`, {
            method: 'POST',
            body: '{}',
          });
          await loadSelectedCandidateDetail(ids[0]);
          state.tab = 'narrative';
          renderDetail();
          announceStepComplete('Narrative');
          await showActualCostModal({
            title: result.parseError
              ? 'Narrative draft (parse error)'
              : result.accepted
                ? 'Narrative accepted'
                : 'Narrative draft needs fixes',
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

      if (ids.length > 1) {
        if (act === 'research') {
          const proceed = await warnResearchOrphansEnrichment(ids, getForceSerp());
          if (!proceed) return;
        }
        const ok = await confirmBatchPaidAction(act, ids);
        if (!ok) return;
        const researchOpts = act === 'research' ? researchOptsFromUi() : {};
        const batch = await api('/api/jobs/batch', {
          method: 'POST',
          body: JSON.stringify({
            act,
            candidateIds: ids,
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
        const proceed = await warnResearchOrphansEnrichment(ids, getForceSerp());
        if (!proceed) return;
      }
      const ok = await confirmPaidAction(act);
      if (!ok) return;
      state.activeAct = act;
      state.jobStatusLine = 'Starting…';
      renderActions();
      const researchOpts = act === 'research' ? researchOptsFromUi() : {};
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
      state.tab = 'narrative';
      renderDetail();
      showToast('Narrative prompt copied — paste Claude’s JSON → Load as draft (auto-accepts when valid).');
      return;
    }

    if (act === 'accept' || act === 'reject') {
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
          await loadSelectedCandidateDetail(state.selectedId);
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
          await loadSelectedCandidateDetail(state.selectedId);
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

      const singleId = state.selectedId;
      if (!singleId) return;
      if (act === 'accept') {
        await acceptNarrativeWithOverride(singleId);
      } else {
        await api(`/api/candidates/${encodeURIComponent(singleId)}/narrative/reject`, {
          method: 'POST',
          body: '{}',
        });
      }
      await loadSelectedCandidateDetail(singleId);
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
      syncClaudeModeToggle();
      if (state.tab === 'prospects') renderDetail();
      try {
        const result = await api(`/api/candidates/${encodeURIComponent(id)}/prospects-outreach`, {
          method: 'POST',
          body: '{}',
        });
        await loadSelectedCandidateDetail(id);
        if (state.detail) state.detail = { ...state.detail, _outreachDraft: result.draft };
        state.tab = 'prospects';
        renderDetail();
        announceStepComplete('Outreach');
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
    if (error.code === 'EVAL_CONCURRENCY') {
      await explainEvalConcurrencyLimit(
        error.selected ?? ids.length,
        error.limit ?? state.evalConcurrency,
      );
    } else {
      await showModal({
        title: 'Action failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
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
        await loadSelectedCandidateDetail(state.selectedId);
        await loadCandidates();
        if (job.status === 'ok') {
          announceStepComplete(jobActLabel(finishedAct));
          if (finishedAct === 'research') state.tab = 'serp';
          else if (finishedAct === 'enrich') state.tab = 'enrichment';
          else if (finishedAct === 'prospects') state.tab = 'prospects';
        } else {
          announceBanner(`${jobActLabel(finishedAct)} failed`, { tone: 'err' });
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
  const narrative = state.detail.narrative;
  const s = state.detail.summary || {};
  const meta = state.detail.meta || {};
  const scoring = r?.scoring || {};
  const inputs = scoring.scoreInputs || {};
  const narrInputs = narrative?.scoring?.scoreInputs || {};
  const resolvedJobValue =
    inputs.jobValue != null && inputs.jobValue !== ''
      ? inputs.jobValue
      : narrInputs.jobValue != null && narrInputs.jobValue !== ''
        ? narrInputs.jobValue
        : null;
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
    jobValue: resolvedJobValue,
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
    'maybe',
    'pass',
    'hold',
    'review',
  ];

  const softNotes = {
    soft: 'Few dedicated niche sites (≤1 homepage, ≤5 domains) — favorable for openness',
    mixed: 'In between soft and hard — weigh openness + displaceability',
    hard: 'Crowded SERP (pack + strong locals and/or many niche domains)',
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
          : 'Needs SERP / Volume',
    ],
    [
      'Demand (scored)',
      demandVolumeHtml(s.demandVolumeSum ?? s.clusterVolumeSum, {
        alpha: s.suburbOverlapFactor,
      }),
      s.demandVolumeSum != null
        ? `${s.demandVolumeSum} / mo demandVolumeSum (primary ${s.primaryVolumeSum ?? '—'} · cluster ${s.clusterVolumeSum ?? '—'})`
        : s.clusterVolumeSum != null
          ? `${s.clusterVolumeSum} searches / mo cluster (legacy — rescore to get demandVolumeSum)`
          : '—',
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
        value: resolvedJobValue,
        max: 10,
        label: 'Job value',
        extraTip: SCORE_INPUT_TIPS.jobValue,
      }),
      resolvedJobValue == null ? 'Set via narrative / Claude' : '—',
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
      overallProvisional
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
    return `<span class="metric metric-neutral" ${tipAttr(tip)}>—</span>`;
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
  if (!serp) return '<p class="muted">No research yet — run SERP / Volume (Evaluation 1).</p>';
  const lookups = enrichmentLookups();
  const mapPackWebsiteCount =
    serp.mapPackWebsiteCount ??
    (serp.localPack || []).filter((b) => b.hasWebsite ?? Boolean(b.url)).length;
  const mapPackSlotCount = serp.mapPackSlotCount ?? (serp.localPack || []).length;
  const local = (serp.localPack || []).map((b, i) => {
    const hasWebsite = b.hasWebsite != null ? Boolean(b.hasWebsite) : Boolean(b.url);
    return [
      String(i + 1),
      esc(b.title),
      esc(b.domain),
      esc(b.rating ?? '—'),
      esc(b.reviewsCount ?? '—'),
      yesNoHtml(hasWebsite, {
        yesTip: 'Map Pack listing includes a website URL.',
        noTip: 'No website URL on this Map Pack slot — often GBP-only / phone-lead angle.',
      }),
      b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">link</a>` : '—',
    ];
  });

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
      l.nicheRelevant
        ? `<span class="metric metric-good" ${tipAttr('Title+URL matched ≥2 niche tokens (or 1 if niche is one word)')}>Yes</span>`
        : `<span class="metric metric-neutral" ${tipAttr('Title+URL did not match niche tokens — synonyms/brands without niche words count as No')}>No</span>`,
      yesNoHtml(Boolean(l.looksEmd), {
        yesTip:
          'EMD heuristic: registrable domain (hyphens stripped) contains niche tokens (≥2, or 1 if niche is one token). Applies to homepage and subpage URLs. Display only — not a score input.',
        noTip:
          'Domain does not look like an exact-match niche domain under the token rule (missing looksEmd on older JSON also shows as No).',
      }),
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
    thWithTip(
      'Niche?',
      'SERP-time only: title + URL must contain niche tokens (words >2 chars). Needs ≥2 token hits, or 1 if the niche is a single token. No page HTML; synonyms/brands without niche words → No.',
    ),
    thWithTip(
      'EMD?',
      'Exact-match domain flag for every organic row. Niche tokens appear in the domain with hyphens stripped. Display heuristic — not used in proposedScore. Older JSON without looksEmd shows No until SERP / Volume re-annotates.',
    ),
    thWithTip('Title', 'SERP title'),
    thWithTip('URL', 'Landing URL'),
  ];
  const dirHeaders = [
    thWithTip('Blue #', blueTip),
    thWithTip('Abs #', absTip),
    thWithTip('Domain', 'Directory domain'),
    thWithTip(
      'Domain Rank',
      'DataForSEO Rank 0–100 after Stage 2 enrich. Higher = stronger competitor. Not Moz DA.',
    ),
    thWithTip('URL', 'Landing URL'),
  ];
  const mapPackSiteTip =
    'Map Pack websites: count of slots with a website URL. No-URL slots are often GBP-only / harder phone-lead angles until you build a real site + GBP.';
  const organicNumberingTip =
    'Abs # is full-page position (not “organic 1–10”). Gaps (e.g. missing 1 or 10–12) are usually AI Overview / related blocks — not missing blue links. Map Pack rows below are separate and unnumbered in Abs #. We request ~10 organic URLs; Abs # can still be 13+ when other features sit above them. Blue # is a simple 1…N among the blue links we list.';
  const nicheEmdTip =
    'Niche? matches niche words in the SERP title + URL only (no page HTML). Needs at least two niche tokens (or one if the niche is a single word). Synonyms or brand names without those words show as No — that can disagree with a human read of the page. EMD? is Yes/No for every organic row (homepage or subpage).';
  const organicInfoTip = `${organicNumberingTip} ${nicheEmdTip}`;

  return `
    ${statusLineHtml(`
      Map Pack: ${mapPackHtml(serp.mapPackPresent, {
        slotCount: mapPackSlotCount,
        reviewsLabel: serp.mapPackReviews?.reviewsLabel,
        avgReviews: serp.mapPackReviews?.avgReviews,
        maxReviews: serp.mapPackReviews?.maxReviews,
        hasLsa: serp.features?.localServicesAds,
        websiteCount: mapPackWebsiteCount,
      })}
      · Organic homepages: <strong data-tip="Higher count = harder SERP">${esc(homeCount)}</strong>
      · Unique domains: <strong data-tip="Higher count = harder SERP">${esc(domainCount)}</strong>
      · Sites ${esc(String(mapPackWebsiteCount))}/${esc(String(mapPackSlotCount))}
      · item types: ${esc((serp.itemTypes || []).join(', '))}
    `)}
    ${headingWithInfoHtml('h3', 'Map Pack', mapPackSiteTip)}
    ${tableHtml(
      [
        '#',
        'Business',
        'Domain',
        'Rating',
        'Reviews',
        thWithTip('Site?', 'Does this Map Pack slot include a website URL?'),
        'URL',
      ],
      local,
    )}
    ${headingWithInfoHtml('h3', 'Organic', organicInfoTip)}
    ${tableHtml(organicHeaders, organic)}
    <h3>Directories</h3>
    ${tableHtml(dirHeaders, dirs)}
    <h3>Paid ads</h3>
    ${tableHtml(['Domain', 'Title', 'URL'], paid)}
  `;
}


function fmtCityPop(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return String(Math.round(v));
}

function citiesMeasuredHtml(vols) {
  const byCity = Array.isArray(vols?.byCity) ? vols.byCity : [];
  const lines = [];
  if (byCity.length) {
    for (const row of byCity) {
      const city = String(row.city || '').trim();
      const state = String(row.state || '').trim();
      if (!city) continue;
      const label = state ? `${city}, ${state}` : city;
      const pop = fmtCityPop(row.population);
      lines.push(pop ? `${label} · ${pop}` : label);
    }
  } else {
    for (const label of vols?.citiesMeasured || []) {
      const s = String(label || '').trim();
      if (s) lines.push(s);
    }
  }
  if (!lines.length) {
    return `<span class="metric metric-neutral">—</span>`;
  }
  return `<span class="metric metric-neutral cities-measured-list">${lines
    .map((line) => `<span class="cities-measured-item">${esc(line)}</span>`)
    .join('')}</span>`;
}

function renderKeywords() {
  const vols = state.detail.research?.volumes;
  if (!vols) return '<p class="muted">No volumes yet — run SERP / Volume (Evaluation 1).</p>';
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
  ];

  return `
    <div class="stat-grid">
      ${statCard('Primary sum', `<span class="metric metric-neutral"><strong>${esc(vols.primaryVolumeSum)}</strong><span class="metric-suffix"> /mo</span></span>`)}
      ${statCard('Cluster sum', clusterVolumeHtml(vols.clusterVolumeSum))}
      ${statCard(
        'Demand (scored)',
        demandVolumeHtml(vols.demandVolumeSum ?? vols.clusterVolumeSum, {
          alpha: vols.suburbOverlapFactor,
        }),
      )}
      ${statCard('Cities measured', citiesMeasuredHtml(vols))}
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
  const wordCountSummary = enr.extras?.wordCountSummary || null;
  const multiLocationPageCount = enr.extras?.multiLocationPageCount ?? null;
  const dispTip = displaceabilityTip({
    score: d.score ?? null,
    bandLabel: d.band?.label ?? d.band?.id ?? null,
    pageCount: d.pageCount ?? null,
    thinStubCount: d.thinStubCount ?? null,
    strongNichePageCount: d.strongNichePageCount ?? null,
    medianThinnessScore: d.medianThinnessScore ?? null,
    medianDomainRank: d.medianDomainRank ?? null,
    hint: d.hint ?? null,
    wordCountSummary,
    multiLocationPageCount,
  });
  const staleCallout = enr.stale
    ? `<div class="callout warn"><strong>Enrichment stale</strong> — SERP / Volume URLs changed since this Rank/thinness run (${esc(
        enr.staleReason || 'serp_urls_changed',
      )}). Domain Rank still shows below; re-run Enrich for a fresh Stage 2.</div>`
    : '';
  const pages = (enr.pages || []).map((p) => {
    const rankBand = domainRankBand(p.domainRank);
    const multiLoc =
      p.kind === 'map_pack'
        ? null
        : p.fetchFailed
          ? null
          : Boolean(p.signals?.looksMultiLocation);
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
      multiLoc == null
        ? `<span class="metric metric-neutral" ${tipAttr('Multi-loc flag unavailable for this row')}>—</span>`
        : yesNoHtml(multiLoc, {
            yesTip:
              'Page HTML shows multi-location / nationwide template signals (national player heuristic).',
            noTip: 'No strong multi-location template signals on this page.',
          }),
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
    thWithTip(
      'Multi-loc?',
      'Enrich-time HTML heuristic: nationwide / multi-city template signals. Display only — already nudges thinness.',
    ),
    'Domain',
    'URL',
  ];

  return `
    ${legendHtml()}
    ${staleCallout}
    ${thinWordsCalloutHtml({
      wordCountSummary,
      multiLocationPageCount,
      thinStubShare: d.thinStubShare,
      pages: enr.pages || [],
    })}
    ${
      fetchFailedCount > 0
        ? `<div class="callout warn"><strong>${esc(String(fetchFailedCount))}</strong> page fetch failure(s) — labeled <code>fetch_failed</code>, excluded from displaceability. Re-run Enrich to retry.</div>`
        : ''
    }
    <div class="enrich-disp-row">
      ${metricHtml({
        value: d.score,
        max: 10,
        label: 'Displaceability',
        extraTip: dispTip,
      })}
      <p class="muted enrich-disp-hint" data-tip="${esc(dispTip)}">${
        d.band?.label || d.band?.id
          ? `<strong>${esc(d.band.label ?? d.band.id)}</strong> · `
          : ''
      }${esc(d.hint || 'Hover the score for the full scoring recipe.')}</p>
    </div>
    <h3>Pages</h3>
    ${tableHtml(pageHeaders, pages)}
    <h3>Domains</h3>
    ${tableHtml(
      [
        'Domain',
        thWithTip('Rank', '0–100. Higher = harder competitor'),
        'Ref domains',
        'Status',
      ],
      domains,
    )}
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
      <button type="button" class="btn primary" data-act="accept" data-tip="Commit narrative draft → approved package">Accept draft</button>
      <button type="button" class="btn danger" data-act="reject" data-tip="Discard narrative draft">Reject draft</button>
    </div>`);
  } else {
    parts.push(
      statusLineHtml(
        `Accepted narrative · ${esc(source)}${
          state.detail?.stageFlags?.hasApproved ? ' · approved package ready' : ''
        }`,
      ),
    );
  }

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

  return parts.join('');
}

function narrativePasteBoxHtml({ replace = false, hideHeading = false } = {}) {
  if (effectiveClaudeUiMode() === 'api') return '';
  return `
    <div class="narrative-paste">
      ${hideHeading ? '' : `<h3>${replace ? 'Replace draft from paste' : 'Paste Claude.ai JSON'}</h3>`}
      <p class="muted">Copy Claude’s JSON response, paste below, then Load as draft — valid narratives accept automatically.</p>
      <textarea id="narrative-paste" class="narrative-paste-input" rows="2" placeholder='{ "niche": "...", "scoring": { ... } }'></textarea>
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
  const apiMode = effectiveClaudeUiMode() === 'api';
  const parts = [];
  parts.push(
    panelHowToHtml({
      label: 'Narrative',
      info: apiMode
        ? 'Run Narrative from Evaluation 3. Valid JSON is accepted automatically. If the draft needs fixes, Accept or Reject here.'
        : 'Copy prompt → Claude.ai → paste JSON → Load as draft (auto-accepts when valid). Optional Anthropic API is on the stage rail only when a key is set — never required.',
    }),
  );
  if (busy) {
    parts.push(`<div id="ca-narrative-progress" class="job-progress" aria-live="polite">
      <div class="job-progress-track"><div class="job-progress-bar"></div></div>
      <p class="job-progress-label">Run Narrative</p>
      <p class="job-progress-detail">Calling Claude…</p>
    </div>`);
  }
  if (draft) {
    parts.push(narrativeReviewHtml(draft, { pending: true }));
    parts.push(narrativePasteBoxHtml({ replace: true }));
  } else if (accepted) {
    if (apiMode) {
      parts.push(
        `<p class="muted">Replace from Evaluation 3 → Re-run Narrative.</p>`,
      );
    } else {
      parts.push(`
      <details class="narrative-replace">
        <summary>Replace draft from paste</summary>
        ${narrativePasteBoxHtml({ replace: true, hideHeading: true })}
      </details>
    `);
    }
  } else if (apiMode) {
    parts.push(
      `<p class="muted">No narrative yet — select this candidate and <strong>Run Narrative</strong> on Evaluation 3.</p>`,
    );
  } else {
    parts.push(narrativePasteBoxHtml({ replace: false }));
  }
  if (accepted) {
    parts.push('<h3 class="scores-heading">Accepted</h3>');
    parts.push(narrativeReviewHtml(accepted, { pending: false }));
  }
  return parts.join('');
}

const SITE_CONFIG_NAP_LEGACY_KEY = 'ops.siteConfigNap';

function siteConfigNapStorageKey(candidateId) {
  const id = String(candidateId || state.selectedId || state.detail?.id || '').trim();
  return id ? `${SITE_CONFIG_NAP_LEGACY_KEY}.${id}` : null;
}

/** Drop legacy global NAP once — do not copy onto candidates (would re-poison other cities). */
function dropLegacySiteConfigNap() {
  try {
    if (localStorage.getItem(SITE_CONFIG_NAP_LEGACY_KEY) != null) {
      localStorage.removeItem(SITE_CONFIG_NAP_LEGACY_KEY);
    }
  } catch {
    /* ignore */
  }
}

/** Per-candidate site-config NAP draft (domain, look, address form). Never shared across cities. */
function siteConfigNapFromLocal(candidateId) {
  dropLegacySiteConfigNap();
  const key = siteConfigNapStorageKey(candidateId);
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') || {};
  } catch {
    return {};
  }
}

function writeSiteConfigNapLocal(nap, candidateId) {
  dropLegacySiteConfigNap();
  const key = siteConfigNapStorageKey(candidateId);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(nap));
  } catch {
    /* ignore */
  }
}

/** Optional street NAP for site-config — omit incomplete address (build Zod). */
function siteConfigAddressFromForm(primaryCity, state) {
  const street = document.getElementById('sc-edit-street')?.value?.trim() || '';
  const zip = document.getElementById('sc-edit-zip')?.value?.trim() || '';
  if (!street) return null;
  return {
    street,
    zip,
    city: String(primaryCity || '').trim(),
    state: String(state || '').trim(),
  };
}

/** Brand from Look controls + existing draft (no hex inputs on step 4). */
function siteConfigBrandPatchFromForm(existingBrand = {}) {
  const prev = existingBrand && typeof existingBrand === 'object' ? existingBrand : {};
  const paletteId =
    document.getElementById('sc-brand-palette')?.value?.trim() || prev.paletteId || '';
  const fontTheme =
    document.getElementById('sc-font-theme')?.value?.trim() || prev.fontTheme || '';
  const palette = getPalettes().find((p) => p.id === paletteId);
  return {
    paletteId,
    fontTheme,
    primary: palette?.brand?.primary || prev.primary || '',
    accent: palette?.brand?.accent || prev.accent || '',
    ink: palette?.brand?.ink || prev.ink || '',
  };
}

function saveSiteConfigNapFromForm(candidateId) {
  const id = candidateId || state.selectedId || state.detail?.id;
  const prev = siteConfigNapFromLocal(id);
  const ba = state.detail?.businessAddress?.selection;
  const nap = {
    domain: document.getElementById('sc-domain')?.value?.trim() || prev.domain || '',
    businessName: document.getElementById('sc-business')?.value?.trim() || prev.businessName || '',
    phone: document.getElementById('sc-phone')?.value?.trim() || prev.phone || '',
    email: document.getElementById('sc-email')?.value?.trim() || prev.email || '',
    radiusMiles: document.getElementById('sc-radius')?.value?.trim() || prev.radiusMiles || '15',
    addressStreet:
      document.getElementById('sc-street')?.value?.trim() ||
      prev.addressStreet ||
      ba?.street ||
      '',
    addressCity:
      document.getElementById('sc-addr-city')?.value?.trim() ||
      prev.addressCity ||
      ba?.city ||
      '',
    addressState:
      document.getElementById('sc-addr-state')?.value?.trim() ||
      prev.addressState ||
      ba?.state ||
      '',
    addressZip:
      document.getElementById('sc-zip')?.value?.trim() || prev.addressZip || ba?.zip || '',
    paletteId:
      document.getElementById('sc-brand-palette')?.value?.trim() || prev.paletteId || 'slate-gold',
    fontTheme:
      document.getElementById('sc-font-theme')?.value?.trim() || prev.fontTheme || 'archivo-source',
    siteArchetype:
      prev.siteArchetype ||
      state.detail?.meta?.siteArchetype ||
      state.detail?.siteConfig?.siteArchetype ||
      state.detail?.siteConfigDraft?.siteArchetype ||
      'multi_service',
    domainPick: prev.domainPick || null,
  };
  writeSiteConfigNapLocal(nap, id);
  return nap;
}

function saveSiteConfigLookToLocal({ paletteId, fontTheme } = {}) {
  const id = state.selectedId || state.detail?.id;
  const prev = siteConfigNapFromLocal(id);
  const nap = {
    ...prev,
    paletteId: String(paletteId || prev.paletteId || 'slate-gold').trim() || 'slate-gold',
    fontTheme: String(fontTheme || prev.fontTheme || 'archivo-source').trim() || 'archivo-source',
  };
  writeSiteConfigNapLocal(nap, id);
  return nap;
}

/** Bare hostname for NAP / Domain field (no protocol, path, or trailing slash). */
function normalizeDomainHostname(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^www\./i, '');
  s = s.split('/')[0].split('?')[0].split('#')[0].trim();
  s = s.replace(/\.$/, '');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(s)) {
    return s.includes('.') ? s : '';
  }
  return s;
}

/** Mirrors ops/lib/site-config.mjs businessNameFromDomain (browser cannot import ops/lib). */
function businessNameFromDomainClient(domain, { primaryCity, niche } = {}) {
  const normKey = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  const titleWord = (w) => {
    const s = String(w || '').trim();
    if (!s) return '';
    if (/^(hvac|llc|inc)$/i.test(s)) return s.toUpperCase();
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  };
  const suffixes = ['experts', 'solutions', 'group', 'elite', 'pros', 'pro'];
  const leftover = [
    'installation',
    'installations',
    'repair',
    'repairs',
    'service',
    'services',
    'cleaning',
    'plumbing',
    'plumber',
    'roofing',
    'concrete',
    'drywall',
    'sewer',
    'drain',
    'fencing',
    'fence',
    'painting',
    'garage',
    'windows',
    'siding',
    'hvac',
    'door',
    'doors',
  ];

  let host = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./, '');
  host = host.split('/')[0].split('?')[0].split('#')[0].replace(/\.$/, '');
  const label = (host.split('.')[0] || host).replace(/[^a-z0-9]/g, '');
  if (!label) return '';

  let rest = label;
  const parts = [];

  const cityRaw = String(primaryCity || '').trim();
  const citySlug = normKey(cityRaw);
  if (citySlug && rest.startsWith(citySlug)) {
    parts.push(cityRaw);
    rest = rest.slice(citySlug.length);
  }

  const nicheRaw = String(niche || '').trim();
  const nicheSlug = normKey(nicheRaw);
  if (nicheSlug && rest.startsWith(nicheSlug)) {
    parts.push(nicheRaw);
    rest = rest.slice(nicheSlug.length);
  } else if (nicheRaw) {
    const nicheWords = nicheRaw.split(/\s+/).filter(Boolean);
    const peeled = [];
    let cursor = rest;
    for (const w of nicheWords) {
      const ws = normKey(w);
      if (ws && cursor.startsWith(ws)) {
        peeled.push(w);
        cursor = cursor.slice(ws.length);
      } else {
        peeled.length = 0;
        break;
      }
    }
    if (peeled.length) {
      parts.push(...peeled);
      rest = cursor;
    }
  }

  const sortedSuffixes = [...suffixes].sort((a, b) => b.length - a.length);
  const suffixParts = [];
  let guard = 0;
  while (rest && guard++ < 8) {
    let hit = false;
    for (const suf of sortedSuffixes) {
      if (rest === suf || (rest.endsWith(suf) && rest.length >= suf.length)) {
        suffixParts.unshift(titleWord(suf));
        rest = rest.slice(0, -suf.length);
        hit = true;
        break;
      }
    }
    if (!hit) break;
  }

  if (rest) {
    const known = [...leftover].sort((a, b) => b.length - a.length);
    let cursor = rest;
    let peelGuard = 0;
    while (cursor && peelGuard++ < 24) {
      let hit = false;
      for (const k of known) {
        if (cursor.startsWith(k)) {
          parts.push(titleWord(k));
          cursor = cursor.slice(k.length);
          hit = true;
          break;
        }
      }
      if (hit) continue;
      let bestIdx = -1;
      let bestLen = 0;
      for (const k of known) {
        const idx = cursor.indexOf(k);
        if (idx > 0 && (bestIdx < 0 || idx < bestIdx || (idx === bestIdx && k.length > bestLen))) {
          bestIdx = idx;
          bestLen = k.length;
        }
      }
      if (bestIdx > 0) {
        parts.push(titleWord(cursor.slice(0, bestIdx)));
        cursor = cursor.slice(bestIdx);
        continue;
      }
      parts.push(titleWord(cursor));
      break;
    }
  }

  parts.push(...suffixParts);
  const name = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (name) return name;
  return label
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map(titleWord)
    .join(' ');
}

/** Parse Claude domain-pick paste into up to 10 suggestion rows. */
function parseDomainPickPaste(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const out = [];
  const pushRow = (domain, available, note) => {
    const host = normalizeDomainHostname(domain);
    if (!host || out.some((r) => r.domain === host)) return;
    let avail = null;
    if (available === true || available === 'true' || available === 'yes') avail = true;
    else if (available === false || available === 'false' || available === 'no') avail = false;
    out.push({
      domain: host,
      available: avail,
      note: String(note || '').trim() || null,
    });
  };
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const obj = JSON.parse(raw.slice(start, end + 1));
      const list = Array.isArray(obj?.domains) ? obj.domains : Array.isArray(obj) ? obj : null;
      if (list) {
        for (const row of list) {
          if (typeof row === 'string') pushRow(row, null, null);
          else if (row && typeof row === 'object') {
            pushRow(row.domain || row.host || row.url, row.available, row.note || row.reason);
          }
          if (out.length >= 10) break;
        }
      }
    }
  } catch {
    /* fall through to line parse */
  }
  if (!out.length) {
    for (const line of raw.split(/\r?\n/)) {
      const cleaned = line
        .replace(/^\s*[-*•]\s*/, '')
        .replace(/^\s*\d+[.)]\s*/, '')
        .trim();
      if (!cleaned) continue;
      const hostMatch = cleaned.match(
        /(?:https?:\/\/)?(?:www\.)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/i,
      );
      if (!hostMatch) continue;
      pushRow(hostMatch[1], null, cleaned.replace(hostMatch[0], '').replace(/^[\s—\-|:]+/, '').trim());
      if (out.length >= 10) break;
    }
  }
  return out.slice(0, 10);
}

function writeDomainPickToNap(
  { domainPick: pickPatch, domain, businessName, email } = {},
  candidateId,
) {
  const id = candidateId || state.selectedId || state.detail?.id;
  const prev = siteConfigNapFromLocal(id);
  const prevPick =
    prev.domainPick && typeof prev.domainPick === 'object' ? prev.domainPick : {};
  const nap = {
    ...prev,
    domainPick: pickPatch ? { ...prevPick, ...pickPatch } : prevPick,
  };
  if (domain != null) nap.domain = String(domain);
  if (businessName != null) nap.businessName = String(businessName);
  if (email != null) nap.email = String(email);
  writeSiteConfigNapLocal(nap, id);
  return nap;
}

function siteConfigAcceptedSummaryHtml(accepted) {
  if (!accepted) return '';
  const bits = [accepted.businessName, accepted.primaryCity || accepted.city, accepted.state]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  const domain = String(accepted.domain || '').trim();
  return statusLineHtml(
    `Accepted${bits.length ? `: <strong>${esc(bits.join(' · '))}</strong>` : ''}${
      domain ? ` · <code>${esc(domain)}</code>` : ''
    }. Continue on the <strong>Content</strong> tab.`,
  );
}

/** Strip markdown bold for Review Images Search line (stale manifests may still store **). */
function stripMdBoldDisplay(s) {
  return String(s || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\*\*|\*\*$/g, '')
    .trim();
}

function caSvcChoiceRowHtml(name, listKey) {
  const n = String(name || '').trim();
  return `<div class="ca-svc-choice-item is-on" data-svc-row>
    <span class="ve-section-pos" aria-hidden="true"></span>
    <label class="ca-svc-choice-label">
      <input type="checkbox" class="ca-svc-check" data-list="${esc(listKey)}" value="${esc(n)}" checked />
      <span>${esc(n)}</span>
    </label>
    <span class="ve-section-move">
      <button type="button" class="ve-section-arrow" data-svc-move="up" data-list="${esc(
        listKey,
      )}" aria-label="Move ${esc(n)} up">▲</button>
      <button type="button" class="ve-section-arrow" data-svc-move="down" data-list="${esc(
        listKey,
      )}" aria-label="Move ${esc(n)} down">▼</button>
    </span>
  </div>`;
}

function serviceNamesChoiceListHtml(names, listKey) {
  const list = (names || []).map((n) => String(n || '').trim()).filter(Boolean);
  const items = list.map((n) => caSvcChoiceRowHtml(n, listKey)).join('');
  return `<div class="ca-svc-choice-list" data-list="${esc(listKey)}">
    ${items}
    <input type="text" class="ca-svc-custom" data-list="${esc(listKey)}" placeholder="Custom Service" autocomplete="off" />
  </div>`;
}

/** Renumber checked rows and enable/disable ▲▼ (visual-editor style). */
function refreshCaSvcListOrder(listEl) {
  if (!listEl) return;
  const rows = [...listEl.querySelectorAll('[data-svc-row]')];
  const checkedRows = rows.filter((r) => r.querySelector('.ca-svc-check')?.checked);
  let pos = 0;
  for (const row of rows) {
    const on = Boolean(row.querySelector('.ca-svc-check')?.checked);
    row.classList.toggle('is-on', on);
    const posEl = row.querySelector('.ve-section-pos');
    if (posEl) posEl.textContent = on ? String(++pos) : '';
    const midIdx = on ? checkedRows.indexOf(row) : -1;
    const up = row.querySelector('[data-svc-move="up"]');
    const down = row.querySelector('[data-svc-move="down"]');
    if (up) up.disabled = !on || midIdx <= 0;
    if (down) down.disabled = !on || midIdx < 0 || midIdx >= checkedRows.length - 1;
  }
}

function moveCaSvcRow(btn) {
  if (!btn || btn.disabled) return;
  const dir = btn.dataset.svcMove === 'up' ? -1 : 1;
  const row = btn.closest('[data-svc-row]');
  const listEl = btn.closest('.ca-svc-choice-list');
  if (!row || !listEl) return;
  const checkedRows = [...listEl.querySelectorAll('[data-svc-row]')].filter((r) =>
    r.querySelector('.ca-svc-check')?.checked,
  );
  const i = checkedRows.indexOf(row);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= checkedRows.length) return;
  const other = checkedRows[j];
  if (dir < 0) other.before(row);
  else other.after(row);
  refreshCaSvcListOrder(listEl);
}

function createCaSvcChoiceRow(name, listKey) {
  const wrap = document.createElement('div');
  wrap.innerHTML = caSvcChoiceRowHtml(name, listKey);
  return wrap.firstElementChild;
}

/** Checked residential/commercial names from Review services UI (or null if not mounted). */
function collectServicesChoiceFromUi() {
  const root =
    document.getElementById('ca-svc-choice-draft') ||
    document.getElementById('ca-svc-choice-accepted');
  if (!root) return null;
  const pick = (listKey) => {
    const names = [];
    const seen = new Set();
    const listEl = root.querySelector(`.ca-svc-choice-list[data-list="${listKey}"]`);
    const checks = listEl
      ? listEl.querySelectorAll('.ca-svc-check:checked')
      : root.querySelectorAll(`.ca-svc-check[data-list="${listKey}"]:checked`);
    checks.forEach((cb) => {
      const n = String(cb.value || '').trim();
      if (!n) return;
      const key = n.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      names.push(n);
    });
    return names.slice(0, 12);
  };
  return {
    services: pick('residential'),
    commercialServices: pick('commercial'),
  };
}

function commitCaSvcCustomInput(input) {
  if (!input || !input.classList?.contains('ca-svc-custom')) return;
  const listKey = String(input.dataset.list || '');
  const name = String(input.value || '').trim();
  if (!listKey || !name) return;
  const wrap = input.closest('.ca-svc-choice-list');
  if (!wrap) return;
  const existing = [...wrap.querySelectorAll('.ca-svc-check')].map((cb) =>
    String(cb.value || '')
      .trim()
      .toLowerCase(),
  );
  if (existing.includes(name.toLowerCase())) {
    input.value = '';
    return;
  }
  if (existing.length >= 12) {
    input.value = '';
    return;
  }
  const row = createCaSvcChoiceRow(name, listKey);
  if (!row) return;
  input.before(row);
  input.value = '';
  refreshCaSvcListOrder(wrap);
}

function wireServicesChoiceInputs() {
  const root =
    document.getElementById('ca-svc-choice-draft') ||
    document.getElementById('ca-svc-choice-accepted');
  if (!root || root.dataset.svcWired === '1') return;
  root.dataset.svcWired = '1';
  root.querySelectorAll('.ca-svc-choice-list').forEach((listEl) => refreshCaSvcListOrder(listEl));
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (!t?.classList?.contains('ca-svc-custom')) return;
    e.preventDefault();
    commitCaSvcCustomInput(t);
  });
  root.addEventListener('focusout', (e) => {
    const t = e.target;
    if (!t?.classList?.contains('ca-svc-custom')) return;
    commitCaSvcCustomInput(t);
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (!t?.classList?.contains('ca-svc-check')) return;
    refreshCaSvcListOrder(t.closest('.ca-svc-choice-list'));
  });
  root.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('[data-svc-move]');
    if (!btn || !root.contains(btn)) return;
    e.preventDefault();
    moveCaSvcRow(btn);
  });
}

/**
 * Easy-read residential vs commercial lists + Accept choices (forever Config UX).
 * @param {{ residential: string[], commercial: string[], mode: 'draft'|'accepted', asStepBody?: boolean }} opts
 */
function siteConfigServicesChoiceHtml({
  residential = [],
  commercial = [],
  mode = 'draft',
  asStepBody = false,
} = {}) {
  const res = (residential || []).map((n) => String(n || '').trim()).filter(Boolean);
  const com = (commercial || []).map((n) => String(n || '').trim()).filter(Boolean);
  const bothId =
    mode === 'accepted' ? 'site-config-accept-keep-commercial' : 'site-config-accept-with-commercial';
  const residentialId =
    mode === 'accepted' ? 'site-config-accept-residential-only-update' : 'site-config-accept-residential-only';
  const commercialId =
    mode === 'accepted' ? 'site-config-accept-commercial-only-update' : 'site-config-accept-commercial-only';

  const actions = `<div class="ca-svc-choice-actions">
        <button type="button" class="btn" id="${esc(residentialId)}" data-tip="Write checked residential as primary services; clear commercialServices (one What we do grid).">Residential Only</button>
        <button type="button" class="btn primary" id="${esc(bothId)}" data-tip="Write both checked lists — homepage Residential + Commercial grids when commercial is non-empty.">Residential + Commercial</button>
        <button type="button" class="btn" id="${esc(commercialId)}" data-tip="Promote checked commercial to primary services; clear commercialServices (one What we do grid).">Commercial Only</button>
      </div>`;

  const heading = asStepBody
    ? ''
    : `<h4 style="margin:0 0 0.5rem">${mode === 'accepted' ? 'Accepted services' : 'Review services before Accept'}</h4>`;
  const wrapClass = asStepBody ? 'ca-svc-choice ca-svc-choice--step' : 'ca-svc-choice';

  return `<div class="${wrapClass}" id="ca-svc-choice-${esc(mode)}">
    ${heading}
    <div class="ca-svc-choice-cols">
      <div>
        <p class="muted" style="margin:0 0 0.25rem;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.04em">Residential / primary</p>
        ${serviceNamesChoiceListHtml(res, 'residential')}
      </div>
      <div>
        <p class="muted" style="margin:0 0 0.25rem;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.04em">Commercial (optional homepage split)</p>
        ${serviceNamesChoiceListHtml(com, 'commercial')}
      </div>
    </div>
    ${actions}
  </div>`;
}

const BA_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BA_SOURCES_LS_KEY = 'baAddressSources';
const BA_FIND_CAPS_LS_KEY = 'baAddressFindCaps';
const BA_CLEAN_PER_RUN_DEFAULT = 10;
const BA_LISTINGS_PER_RUN_DEFAULT = 40;
const BA_CLEAN_PER_RUN_MIN = 1;
const BA_CLEAN_PER_RUN_MAX = 25;
const BA_LISTINGS_PER_RUN_MIN = 10;
const BA_LISTINGS_PER_RUN_MAX = 200;

function baGetSourceReadiness() {
  return (
    state.baSources ||
    state.baRecover?.[state.detail?.id]?.readiness ||
    state.detail?.businessAddress?.lastSearchStats?.readiness || {
      token: false,
      loopnet: false,
      crexi: false,
    }
  );
}

function baLoadSourceToggles() {
  const readiness = baGetSourceReadiness();
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(BA_SOURCES_LS_KEY) || 'null');
  } catch {
    saved = null;
  }
  let loopnet = saved?.loopnet != null ? Boolean(saved.loopnet) : readiness.loopnet;
  let crexi = saved?.crexi != null ? Boolean(saved.crexi) : readiness.crexi;
  if (!readiness.loopnet) loopnet = false;
  if (!readiness.crexi) crexi = false;
  if (!loopnet && !crexi) {
    if (readiness.loopnet) loopnet = true;
    else if (readiness.crexi) crexi = true;
  }
  return { loopnet, crexi };
}

function baSaveSourceToggles(sources) {
  try {
    localStorage.setItem(
      BA_SOURCES_LS_KEY,
      JSON.stringify({
        loopnet: Boolean(sources?.loopnet),
        crexi: Boolean(sources?.crexi),
      }),
    );
  } catch {
    /* ignore */
  }
}

function baClampCleanPerRun(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return BA_CLEAN_PER_RUN_DEFAULT;
  return Math.min(BA_CLEAN_PER_RUN_MAX, Math.max(BA_CLEAN_PER_RUN_MIN, Math.floor(n)));
}

function baClampListingsPerRun(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return BA_LISTINGS_PER_RUN_DEFAULT;
  return Math.min(BA_LISTINGS_PER_RUN_MAX, Math.max(BA_LISTINGS_PER_RUN_MIN, Math.floor(n)));
}

function baLoadFindCaps() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(BA_FIND_CAPS_LS_KEY) || 'null');
  } catch {
    saved = null;
  }
  return {
    cleanPerRun: baClampCleanPerRun(saved?.cleanPerRun ?? BA_CLEAN_PER_RUN_DEFAULT),
    listingsPerRun: baClampListingsPerRun(saved?.listingsPerRun ?? BA_LISTINGS_PER_RUN_DEFAULT),
  };
}

function baSaveFindCaps(caps) {
  try {
    localStorage.setItem(
      BA_FIND_CAPS_LS_KEY,
      JSON.stringify({
        cleanPerRun: baClampCleanPerRun(caps?.cleanPerRun),
        listingsPerRun: baClampListingsPerRun(caps?.listingsPerRun),
      }),
    );
  } catch {
    /* ignore */
  }
}

function baReadFindCapsFromDom() {
  const cleanEl = document.getElementById('ba-clean-per-run');
  const pullEl = document.getElementById('ba-listings-per-run');
  const loaded = baLoadFindCaps();
  const caps = {
    cleanPerRun: baClampCleanPerRun(cleanEl ? cleanEl.value : loaded.cleanPerRun),
    listingsPerRun: baClampListingsPerRun(pullEl ? pullEl.value : loaded.listingsPerRun),
  };
  baSaveFindCaps(caps);
  if (cleanEl) cleanEl.value = String(caps.cleanPerRun);
  if (pullEl) pullEl.value = String(caps.listingsPerRun);
  return caps;
}

function baReadSourceTogglesFromDom() {
  const readiness = baGetSourceReadiness();
  const loopnetEl = document.getElementById('ba-source-loopnet');
  const crexiEl = document.getElementById('ba-source-crexi');
  let loopnet = loopnetEl ? Boolean(loopnetEl.checked) : baLoadSourceToggles().loopnet;
  let crexi = crexiEl ? Boolean(crexiEl.checked) : baLoadSourceToggles().crexi;
  if (!readiness.loopnet) loopnet = false;
  if (!readiness.crexi) crexi = false;
  if (!loopnet && !crexi) {
    if (readiness.loopnet) loopnet = true;
    else if (readiness.crexi) crexi = true;
  }
  baSaveSourceToggles({ loopnet, crexi });
  return { loopnet, crexi };
}

function baCanonicalCrexiUrl(url, idHint = '') {
  const raw = String(url || '').trim();
  const hint = String(idHint || '').trim();
  const pickId = (s) => {
    const str = String(s || '');
    const trail = str.match(/\/(\d{4,})(?:\/?(?:\?|#|$))/);
    if (trail) return trail[1];
    const digits = str.match(/\b(\d{5,})\b/);
    return digits ? digits[1] : '';
  };
  const id = pickId(raw) || pickId(hint);
  if (id) return `https://www.crexi.com/properties/${id}`;
  if (/^https?:\/\//i.test(raw) && /crexi\.com/i.test(raw)) return raw;
  return '';
}

function baListingPortalLinksHtml(row) {
  const urls = {
    ...(row?.listingUrls && typeof row.listingUrls === 'object' ? row.listingUrls : {}),
  };
  if (row?.listingUrl && /^https?:\/\//i.test(String(row.listingUrl))) {
    const src = row.source === 'crexi' ? 'crexi' : 'loopnet';
    if (!urls[src]) urls[src] = row.listingUrl;
  }
  if (urls.crexi) {
    urls.crexi = baCanonicalCrexiUrl(urls.crexi, row?.id) || urls.crexi;
  }
  const parts = [];
  if (/^https?:\/\//i.test(String(urls.loopnet || ''))) {
    parts.push(
      `<a href="${esc(urls.loopnet)}" target="_blank" rel="noopener">LoopNet</a>`,
    );
  }
  if (/^https?:\/\//i.test(String(urls.crexi || ''))) {
    parts.push(`<a href="${esc(urls.crexi)}" target="_blank" rel="noopener">Crexi</a>`);
  }
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

/** Live-rebuild Maps/Street View hrefs from lat/lng so old shortlists pick up URL fixes. */
function baAddressQueryWithoutSuite(row = {}) {
  return [row.street, row.city, row.state, row.zip].filter(Boolean).join(', ');
}

function baHasCoords(row = {}) {
  return (
    row.lat != null &&
    row.lng != null &&
    row.lat !== '' &&
    row.lng !== '' &&
    Number.isFinite(Number(row.lat)) &&
    Number.isFinite(Number(row.lng))
  );
}

function baMapsHref(row = {}) {
  if (baHasCoords(row)) {
    return `https://www.google.com/maps/?q=${Number(row.lat)},${Number(row.lng)}`;
  }
  const q = baAddressQueryWithoutSuite(row);
  if (q) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  return row.mapsUrl || '#';
}

function baStreetViewHref(row = {}) {
  if (baHasCoords(row)) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${Number(row.lat)},${Number(row.lng)}`;
  }
  const q = baAddressQueryWithoutSuite(row);
  if (q) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  return row.streetViewUrl || '#';
}

function baFormatUsd(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return `$${v.toFixed(v < 0.1 && v > 0 ? 4 : 2)}`;
}

function baApifyCostLabel(cost, stats) {
  if (cost?.cacheHit || (cost?.apifyEstUsd === 0 && !cost?.apifyUsd)) {
    return '$0 (cache)';
  }
  if (cost?.apifyUsd != null && Number(cost.apifyUsd) > 0) {
    return baFormatUsd(cost.apifyUsd);
  }
  const est =
    cost?.apifyEstUsd != null
      ? Number(cost.apifyEstUsd)
      : stats?.apifyReturned
        ? Number(stats.apifyReturned) * Number(cost?.apifyRatePerListing || 0.00145)
        : null;
  if (est == null || Number.isNaN(est)) return '—';
  const n = cost?.listingsForApifyEst ?? stats?.apifyReturned;
  const rate = Number(cost?.apifyRatePerListing ?? 0.00145);
  return `est. ${baFormatUsd(est)}${n != null ? ` (${n} × $${rate}/ea)` : ''}`;
}

function baPlanBarHtml(plan) {
  if (!plan?.ok) {
    return plan?.error
      ? `<div class="muted small">Apify plan: ${esc(plan.error)}</div>`
      : '';
  }
  const used = Number(plan.monthlyUsageUsd);
  const max = Number(plan.maxMonthlyUsageUsd);
  const rem = plan.remainingUsd;
  if (!Number.isFinite(used) || !Number.isFinite(max) || max <= 0) {
    return `<div class="muted small">Apify plan: used ${baFormatUsd(used)}</div>`;
  }
  const pct = Math.min(100, Math.round((used / max) * 100));
  return `<div class="muted small">Apify prepaid: <strong>${baFormatUsd(used)}</strong> used · <strong>${baFormatUsd(
    rem,
  )}</strong> left of ${baFormatUsd(max)} (${pct}%)</div>`;
}

/** Readable Find funnel + cost for Last search + Find complete modal. */
function baInventoryFromPkg(pkg, recover = null) {
  // Prefer live city-cache recover payload when present (fresher than last Find stats).
  if (recover?.inventoryTotal != null) {
    return {
      total: Number(recover.inventoryTotal),
      reviewed: Number(recover.inventoryReviewed ?? 0),
      left: Number(recover.unscreenedRemaining ?? 0),
      claimed: Number(recover.usedAddressesInCity ?? pkg?.usedAddressesSummary ?? 0),
    };
  }

  const stats = pkg?.lastSearchStats || {};
  if (stats.inventoryTotal != null) {
    const total = Number(stats.inventoryTotal);
    const reviewed = Number(stats.inventoryReviewed ?? 0);
    const left = Number(
      stats.unscreenedRemaining != null
        ? stats.unscreenedRemaining
        : Math.max(0, total - reviewed),
    );
    const claimed = Number(
      stats.usedAddressesInCity ?? pkg?.usedAddressesSummary ?? 0,
    );
    return { total, reviewed, left, claimed };
  }

  const listings = Array.isArray(pkg?.listingCache?.listings) ? pkg.listingCache.listings : [];
  const screened = pkg?.screenedKeys || {};
  let total = 0;
  let reviewed = 0;
  for (const row of listings) {
    const street = String(row?.street || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    const zip = String(row?.zip || '')
      .replace(/\D/g, '')
      .slice(0, 5);
    if (!street || !zip) continue;
    total += 1;
    if (screened[`${street}|${zip}`]) reviewed += 1;
  }
  const left =
    stats.unscreenedRemaining != null
      ? Number(stats.unscreenedRemaining)
      : Math.max(0, total - reviewed);
  const claimed = Number(stats.usedAddressesInCity ?? pkg?.usedAddressesSummary ?? 0);
  return { total, reviewed, left, claimed };
}

function baSourceBudgetNums(budget = {}) {
  const urlCount = Math.max(1, Number(budget.pullUrlCount || 2));
  const lastPull = Number(budget.lastPullMax ?? 0);
  const nextPull = Number(budget.nextPullMax ?? 0);
  const lastBudget = Number(
    budget.lastPullBudget ?? (lastPull > 0 ? lastPull * urlCount : 0),
  );
  const nextBudget = Number(
    budget.nextPullBudget ?? (nextPull > 0 ? nextPull * urlCount : 0),
  );
  const hardBudget = Number(
    budget.pullHardMaxBudget ??
      (Number(budget.pullHardMax) > 0 ? Number(budget.pullHardMax) * urlCount : 0),
  );
  const proposedBudget = Number(
    budget.proposedHardMaxBudget ??
      (Number(budget.proposedHardMax) > 0
        ? Number(budget.proposedHardMax) * urlCount
        : 0),
  );
  const absBudget = Number(
    budget.absolutePullMaxBudget ??
      (Number(budget.absolutePullMax) > 0
        ? Number(budget.absolutePullMax) * urlCount
        : 0),
  );
  return { urlCount, lastBudget, nextBudget, hardBudget, proposedBudget, absBudget };
}

function baCheckedSourcesExhausted(recover, stats, toggles) {
  const inv = recover?.sourceInventory || stats?.sourceInventory || {};
  const readiness = baGetSourceReadiness();
  const checked = [];
  if (toggles.loopnet && readiness.loopnet) checked.push('loopnet');
  if (toggles.crexi && readiness.crexi) checked.push('crexi');
  if (!checked.length) return false;
  return checked.every((src) => {
    const row = inv[src];
    if (row?.exhausted != null) return Boolean(row.exhausted);
    const total = Number(row?.total ?? row?.inventoryTotal ?? 0);
    const left = Number(row?.left ?? row?.unscreenedRemaining ?? 0);
    return total > 0 && left === 0;
  });
}

function baSourceLabelFromToggles(toggles) {
  const parts = [];
  if (toggles.loopnet) parts.push('LoopNet');
  if (toggles.crexi) parts.push('Crexi');
  return parts.length ? parts.join(' + ') : 'listings';
}

function baAggregateCheckedBudgets(recover, stats, toggles) {
  const budgets = recover?.sourceBudgets || stats?.sourceBudgets || {};
  const checked = [];
  if (toggles.loopnet) checked.push('loopnet');
  if (toggles.crexi) checked.push('crexi');
  if (!checked.length) {
    return {
      lastBudget: Number(recover?.lastPullBudget || 0),
      nextBudget: Number(recover?.nextPullBudget || 0),
      hardBudget: Number(recover?.pullHardMaxBudget || 0),
      proposedBudget: Number(recover?.proposedHardMaxBudget || 0),
      absBudget: Number(recover?.absolutePullMaxBudget || 0),
      canRaise: Boolean(recover?.canRaiseMax || recover?.needsMaxRaise),
      needsRaise: Boolean(recover?.needsMaxRaise),
      atAbsolute: Boolean(recover?.deepenAtCap) && !recover?.canRaiseMax,
      sourceLabel: baSourceLabelFromToggles(toggles),
    };
  }
  let lastBudget = 0;
  let nextBudget = 0;
  let hardBudget = 0;
  let proposedBudget = 0;
  let absBudget = 0;
  let canRaise = false;
  let needsRaise = false;
  let atAbsolute = true;
  for (const src of checked) {
    const b = budgets[src] || {};
    const nums = baSourceBudgetNums(b);
    lastBudget += nums.lastBudget;
    nextBudget += nums.nextBudget;
    hardBudget += nums.hardBudget;
    proposedBudget += nums.proposedBudget;
    absBudget += nums.absBudget;
    if (b.canRaiseMax || b.needsMaxRaise) canRaise = true;
    if (b.needsMaxRaise || (b.deepenAtCap && (b.canRaiseMax || b.needsMaxRaise))) needsRaise = true;
    if (!(b.deepenAtCap && !b.canRaiseMax)) atAbsolute = false;
  }
  if (checked.length === 1) {
    const b = budgets[checked[0]] || {};
    atAbsolute = Boolean(b.deepenAtCap) && !b.canRaiseMax;
    needsRaise = Boolean(b.needsMaxRaise) || (Boolean(b.deepenAtCap) && Boolean(b.canRaiseMax));
    canRaise = Boolean(b.canRaiseMax || b.needsMaxRaise);
  }
  return {
    lastBudget,
    nextBudget,
    hardBudget,
    proposedBudget,
    absBudget,
    canRaise,
    needsRaise,
    atAbsolute,
    sourceLabel: baSourceLabelFromToggles(toggles),
  };
}

function baOneSourceInventoryLineHtml(label, inv, budget, { muted = false } = {}) {
  const total = Number(inv?.total ?? inv?.inventoryTotal ?? 0);
  const reviewed = Number(inv?.reviewed ?? inv?.inventoryReviewed ?? 0);
  const left = Number(inv?.left ?? inv?.unscreenedRemaining ?? 0);
  const nums = baSourceBudgetNums(budget || {});
  const canRaise = Boolean(budget?.canRaiseMax || budget?.needsMaxRaise);
  const atSoftCeiling =
    Boolean(budget?.deepenAtCap || budget?.needsMaxRaise) && canRaise;
  const atAbsolute = Boolean(budget?.deepenAtCap) && !canRaise && nums.hardBudget > 0;
  let suffix = '';
  if (budget?.canDeepen && nums.nextBudget > nums.lastBudget && !atSoftCeiling && !atAbsolute) {
    suffix = ` · next deeper → <strong>${nums.nextBudget}</strong>`;
  } else if (atSoftCeiling && nums.proposedBudget > 0) {
    suffix = ` · at ceiling (${nums.hardBudget || '—'}) — deeper raises to <strong>${nums.proposedBudget}</strong>`;
  } else if (atAbsolute) {
    suffix = ` · at max (${nums.absBudget || nums.hardBudget})`;
  }
  const opacity = muted ? 'opacity:0.65;' : '';
  if (total <= 0) {
    const notPulled = `<div class="muted small" style="${opacity}">${esc(
      label,
    )}: <strong>not pulled yet</strong> — use <strong>Find addresses</strong></div>`;
    if (nums.lastBudget > 0) {
      return `${notPulled}<div class="muted small" style="${opacity}margin-top:0.1rem">Pull target: <strong>${nums.lastBudget}</strong>${suffix}</div>`;
    }
    return notPulled;
  }
  return `<div style="margin-top:0.35rem;${opacity}">
    <div class="muted small"><strong>${esc(label)}</strong>: <strong>${total}</strong> listings · <strong>${reviewed}</strong> reviewed · <strong>${left}</strong> left</div>
    ${
      nums.lastBudget > 0
        ? `<div class="muted small" style="margin-top:0.1rem">Pull target: <strong>${nums.lastBudget}</strong>${suffix}</div>`
        : ''
    }
  </div>`;
}

function baInventoryProgressHtml(inv, { style = '', recover = null, stats = null, toggles = null } = {}) {
  const sourceInv = recover?.sourceInventory || stats?.sourceInventory || null;
  const sourceBudgets = recover?.sourceBudgets || stats?.sourceBudgets || null;
  const t = toggles || baLoadSourceToggles();
  const claimed = Number(
    recover?.usedAddressesInCity ?? inv?.claimed ?? stats?.usedAddressesInCity ?? 0,
  );

  if (sourceInv || sourceBudgets) {
    const lnInv = sourceInv?.loopnet || {};
    const cxInv = sourceInv?.crexi || {};
    const lnBudget = sourceBudgets?.loopnet || {};
    const cxBudget = sourceBudgets?.crexi || {};
    const hasAny =
      Number(lnInv.total || lnInv.inventoryTotal || 0) > 0 ||
      Number(cxInv.total || cxInv.inventoryTotal || 0) > 0 ||
      Number(lnBudget.lastPullMax || 0) > 0 ||
      Number(cxBudget.lastPullMax || 0) > 0 ||
      Number(lnBudget.lastPullBudget || 0) > 0 ||
      Number(cxBudget.lastPullBudget || 0) > 0;
    if (!hasAny && Number(inv?.total || 0) <= 0) return '';
    return `<div class="ba-inventory" style="margin-top:0.35rem;${style}">
      ${baOneSourceInventoryLineHtml('LoopNet', lnInv, lnBudget, { muted: !t.loopnet })}
      ${baOneSourceInventoryLineHtml('Crexi', cxInv, cxBudget, { muted: !t.crexi })}
      ${
        claimed > 0
          ? `<div class="muted small" style="margin-top:0.25rem">${claimed} claimed in city (all sources)</div>`
          : ''
      }
    </div>`;
  }

  // Legacy single-strip fallback
  const total = Number(inv?.total || 0);
  if (total <= 0 && !recover?.lastPullMax && !recover?.nextPullMax && !recover?.lastPullBudget) {
    return '';
  }
  const reviewed = Number(inv?.reviewed || 0);
  const left = Number(inv?.left || 0);
  const nums = baSourceBudgetNums(recover || inv || {});
  const depthNote =
    nums.lastBudget > 0
      ? `<div class="muted small" style="margin-top:0.15rem">Pull target: <strong>${nums.lastBudget}</strong></div>`
      : '';
  if (total <= 0) {
    return depthNote
      ? `<div class="ba-inventory" style="margin-top:0.35rem;${style}">${depthNote}</div>`
      : '';
  }
  return `<div class="ba-inventory" style="margin-top:0.35rem;${style}">
    <div class="muted small">Inventory: <strong>${total}</strong> listings · <strong>${reviewed}</strong> reviewed · <strong>${left}</strong> left${
      claimed > 0 ? ` · ${claimed} claimed` : ''
    }</div>
    ${depthNote}
  </div>`;
}

/** Shared lead-in for Fetch deeper when checked-source inventory is 0 left. */
function baExhaustedDeepenWarnHtml({
  variant = 'deepen',
  lastBudget = 0,
  nextBudget = 0,
  hardBudget = 0,
  proposedBudget = 0,
  sourceLabel = 'listings',
} = {}) {
  const label = sourceLabel || 'listings';
  const lead = `<p><strong>All cached ${esc(label)} listings are already screened (0 left).</strong></p>
    <p class="muted">Fetch deeper re-scrapes <strong>${esc(
      label,
    )}</strong> from the top (not “new only”) and <strong>may add few or no new streets</strong>. Apify is billable.</p>`;
  if (variant === 'raise') {
    return `${lead}
      <p class="muted">This also <strong>doubles</strong> the pull ceiling from up to <strong>${esc(
        String(hardBudget),
      )}</strong> → up to <strong>${esc(String(proposedBudget))}</strong>, then scrapes at up to <strong>${esc(
        String(nextBudget),
      )}</strong> listings.</p>`;
  }
  if (variant === 'absolute') {
    return `${lead}
      <p class="muted">Pull budget is already at the absolute max (up to <strong>${esc(
        String(hardBudget),
      )}</strong>). Refresh re-scrapes at max and may not help. Prefer Manual commercial, recover, or Use anyway.</p>`;
  }
  return `${lead}
    <p class="muted">This raises the pull budget from up to <strong>${esc(
      String(lastBudget),
    )}</strong> → up to <strong>${esc(String(nextBudget))}</strong> listings.</p>`;
}

function baSearchReportBodyHtml(pkg, { title = 'Last search', failed = false } = {}) {
  const stats = pkg?.lastSearchStats || {};
  const cost = pkg?.lastSearchCost || {};
  const plan = pkg?.apifyPlanUsage || state.apifyPlanUsage || null;
  const kind = pkg?.lastSearchErrorKind || null;
  const places = Number(stats.placesCalls ?? 0);
  const clean = Number(stats.shortlist ?? 0);
  const added = Number(stats.added ?? 0);
  const total = Number(stats.shortlistTotal ?? pkg?.shortlist?.length ?? 0);
  const secondaryN = Number(stats.secondaryCount || 0);

  const placesTotal =
    cost?.apifyUsd != null && Number(cost.apifyUsd) > 0
      ? Number(cost.apifyUsd) + (Number(cost.placesEstUsd) || 0)
      : (Number(cost.apifyEstUsd) || 0) + (Number(cost.placesEstUsd) || 0);

  const face = `<div class="ba-search-face" style="margin-top:0.35rem">
    <div>Result: <strong>${clean}</strong> clean · <strong>${added}</strong> new · <strong>${total}</strong> recommended${
      secondaryN > 0 ? ` · <strong>${secondaryN}</strong> secondary` : ''
    }</div>
    <div style="margin-top:0.25rem">Cost: Apify ${baApifyCostLabel(cost, stats)} · Places est. ${baFormatUsd(
      cost.placesEstUsd,
    )} · Total ~${baFormatUsd(placesTotal || cost.totalEstUsd)}</div>
    ${
      stats.placesBudgetReached || kind === 'places_budget'
        ? `<div class="muted small" style="margin-top:0.25rem">Places budget: <strong>${esc(
            String(places),
          )}</strong> / ${esc(String(stats.placesBudget ?? '—'))} lookups this run — Find again to screen more.</div>`
        : Number(stats.placesBudget) > 0
          ? `<div class="muted small" style="margin-top:0.25rem">Places: ${esc(String(places))} lookups · budget ${esc(
              String(stats.placesBudget),
            )}/run</div>`
          : ''
    }
  </div>`;

  const billingHint =
    kind === 'apify_billing'
      ? `<p style="margin:0.45rem 0 0">Apify blocked this run. Add credit at <a href="https://console.apify.com/billing/subscription" target="_blank" rel="noopener">Apify billing</a>, then retry. Manual commercial / home paste / Skip still work.</p>`
      : kind === 'apify_config'
        ? `<p style="margin:0.45rem 0 0">Add <code>APIFY_TOKEN</code>, at least one of <code>APIFY_LOOPNET_ACTOR_ID</code> / <code>APIFY_CREXI_ACTOR_ID</code>, and <code>GOOGLE_MAPS_API_KEY</code> to <code>.env</code>, restart Rover, then retry.</p>`
        : kind === 'places_budget'
          ? `<p style="margin:0.45rem 0 0">Stopped early to cap Places spend. Run <strong>Find addresses</strong> again to continue screening remaining streets (another budget), or use Manual / recover / home / Skip.</p>`
          : '';

  const planHtml = baPlanBarHtml(plan);
  const costDetails =
    cost.note || planHtml
      ? `<details class="narrative-raw" style="margin-top:0.45rem">
    <summary class="muted small">Cost</summary>
    ${
      cost.note
        ? `<div class="muted small" style="margin-top:0.35rem">${esc(cost.note)}</div>`
        : ''
    }
    ${planHtml ? `<div style="margin-top:0.35rem">${planHtml}</div>` : ''}
  </details>`
      : '';

  const showError =
    pkg?.lastSearchError && kind !== 'cache_exhausted'
      ? `<p class="muted small" style="margin:0.45rem 0 0">${esc(pkg.lastSearchError)}</p>`
      : '';

  return `<div class="callout ${
    failed && kind !== 'places_budget' ? 'danger' : 'ok'
  }" style="margin-top:0.75rem">
    <strong>${esc(title)}</strong>
    ${face}
    ${billingHint}
    ${showError}
    ${costDetails}
    <div class="muted small" style="margin-top:0.35rem">${esc(pkg?.lastSearchAt || '')}</div>
  </div>`;
}

function renderSiteConfig() {
  ensurePalettes().catch(() => {});
  ensureFontThemes().catch(() => {});
  ensureSiteFontSampleStyles();
  const d = state.detail;
  const f = d?.stageFlags || {};
  const decision = d?.meta?.decision || null;
  const nap = siteConfigNapFromLocal(d?.id);
  const pack = d?.approved;
  const draft = d?.siteConfigDraft;
  const accepted = d?.siteConfig;
  const ready = Boolean(f.hasNarrative && f.hasApproved && decision === 'pursue');
  const apiMode = effectiveClaudeUiMode() === 'api';
  const brandForLook = {
    ...(draft || accepted)?.brand,
    paletteId:
      (draft || accepted)?.brand?.paletteId || nap.paletteId || 'slate-gold',
    fontTheme:
      (draft || accepted)?.brand?.fontTheme || nap.fontTheme || 'archivo-source',
  };
  const baPkg = d?.businessAddress;
  const baSel = baPkg?.selection;
  // Match server cityStateFromCandidate — never use NAP city for finder geography.
  const geoCity = String(
    (baPkg?.city && String(baPkg.city).trim()) ||
      (draft || accepted)?.primaryCity ||
      pack?.primaryCity ||
      pack?.city ||
      '',
  ).trim();
  const geoState = String(
    (baPkg?.state && String(baPkg.state).trim()) ||
      (draft || accepted)?.state ||
      pack?.state ||
      '',
  )
    .trim()
    .toUpperCase();
  const addrCity = geoCity;
  const addrState = geoState;
  const stepDone = {
    details: Boolean(accepted) || Boolean(String(nap.domain || '').trim() && String(nap.businessName || '').trim()),
    look:
      Boolean(accepted) ||
      Boolean((draft || accepted)?.brand?.fontTheme) ||
      Boolean((draft || accepted)?.brand?.paletteId) ||
      Boolean(nap.paletteId || nap.fontTheme),
    address:
      Boolean(accepted?.address?.street) ||
      Boolean(baSel?.street) ||
      Boolean(baPkg?.skipped) ||
      Boolean(d?.meta?.businessAddressStatus === 'skipped'),
    domain:
      Boolean(accepted?.domain) ||
      Boolean(String(nap.domain || '').trim()) ||
      isSoftDone('siteConfigSoftDone', 'domain'),
    paste: Boolean(draft) || Boolean(accepted),
    // Explicit save only — Claude-seeded coverageAreas do not complete this step.
    serviceArea: Boolean(accepted && d?.meta?.lastServiceAreaAt),
    // Provision or Skip only — a real NAP phone from Claude does not complete this step.
    phone: Boolean(
      accepted &&
        (isSoftDone('siteConfigSoftDone', 'phone') ||
          state.sitePhoneProvisioned?.[d?.id] ||
          Boolean(d?.meta?.phoneSkippedAt) ||
          Boolean(d?.meta?.lastPhoneAt)),
    ),
  };
  const detailsDone = stepDone.details || isSoftDone('siteConfigSoftDone', 'details');
  const lookDone = stepDone.look || isSoftDone('siteConfigSoftDone', 'look');
  const addressDone = stepDone.address || isSoftDone('siteConfigSoftDone', 'address');
  const domainDone = stepDone.domain || isSoftDone('siteConfigSoftDone', 'domain');
  const pasteDone = stepDone.paste || isSoftDone('siteConfigSoftDone', 'paste');
  const servicesDone =
    Boolean(accepted) || isSoftDone('siteConfigSoftDone', 'services');
  const serviceAreaDone =
    stepDone.serviceArea || isSoftDone('siteConfigSoftDone', 'service-area');
  const phoneDone = stepDone.phone;
  const detailsGateDone = apiMode ? Boolean(draft || accepted) : detailsDone;
  // Forward-only: paste mode 4 details → 5 paste → 6 services; API 4 details (until draft) → 5 services
  const durableCurrent = !lookDone
    ? 'look'
    : !addressDone
      ? 'address'
      : !domainDone
        ? 'domain'
        : !detailsGateDone
          ? 'details'
          : !apiMode && !pasteDone
            ? 'paste'
            : !servicesDone
              ? 'services'
              : !serviceAreaDone
                ? 'service-area'
                : !phoneDone
                  ? 'phone'
                  : null;
  const scStepOrder = apiMode
    ? SITE_CONFIG_STEP_ORDER.filter((id) => id !== 'paste')
    : SITE_CONFIG_STEP_ORDER;
  const currentId = resolvePanelCurrent('siteConfigSoftCurrent', durableCurrent, scStepOrder);
  if (apiMode && state.siteConfigOpenStep === 'paste') {
    state.siteConfigOpenStep = pasteDone ? 'services' : 'details';
  }
  if (state.siteConfigFollowCurrent !== currentId) {
    state.siteConfigOpenStep = currentId;
    state.siteConfigFollowCurrent = currentId;
  }
  const openId = state.siteConfigOpenStep;
  const parts = [];

  parts.push(
    panelHowToHtml({
      label: 'Site config',
      info: apiMode
        ? '1 Colors & fonts → 2 Address → 3 Domain → 4 Business details (Fill site-config) → 5 Review services & Accept → 6 Service area → 7 Provision phone → Content.'
        : '1 Colors & fonts → 2 Address → 3 Domain → 4 Business details → 5 Paste & edit draft → 6 Review services & Accept → 7 Service area → 8 Provision phone → Content.',
    }),
  );
  if (isSelectedLaunched()) {
    parts.push(
      `<div class="callout warn"><strong>Already launched.</strong> Site-config changes here will not match the live site until you Push updates. Mutating actions ask for confirmation.</div>`,
    );
  }

  if (!f.hasNarrative) {
    parts.push(
      `<div class="callout warn">Accept the Narrative draft first, then come back here.</div>`,
    );
  } else if (!f.hasApproved) {
    parts.push(
      `<div class="callout warn">Narrative is accepted but the approved package is missing — re-Load the narrative JSON (auto-accepts) to regenerate it.</div>`,
    );
  } else if (decision !== 'pursue') {
    parts.push(
      `<div class="callout warn">Decision is <code>${esc(
        decision || 'unset',
      )}</code> — set <strong>pursue</strong> on Overview before site-config.</div>`,
    );
  } else if (!accepted) {
    parts.push(
      statusLineHtml(
        `Ready${pack?.niche ? ` · ${esc(pack.niche)}` : ''}${
          pack?.city ? ` · ${esc(pack.city)}` : ''
        }`,
      ),
    );
  }

  if (accepted) {
    parts.push(siteConfigAcceptedSummaryHtml(accepted));
    const dw = domainBrandMismatchClient(accepted.domain, {
      niche: accepted.niche,
      businessName: accepted.businessName,
      primaryCity: accepted.primaryCity,
    });
    if (dw.mismatch) {
      parts.push(
        `<div class="callout warn"><strong>Domain vs brand:</strong> ${esc(dw.reason)}</div>`,
      );
    }
  }

  const lockedUntilAccept = apiMode
    ? '<p class="muted small">Locked until you <strong>Accept</strong> site-config in Review services (step 5).</p>'
    : '<p class="muted small">Locked until you <strong>Accept</strong> site-config in Review services (step 6).</p>';
  const lockedUntilDraft = apiMode
    ? '<p class="muted small">Locked until you <strong>Fill site-config</strong> in Business details (step 4).</p>'
    : '<p class="muted small">Locked until you <strong>Load draft</strong> in Paste Claude’s reply (step 5).</p>';

  parts.push(
    contentStepHtml({
      id: 'look',
      num: 1,
      title: 'Colors & fonts',
      done: lookDone,
      open: openId === 'look',
      current: currentId === 'look' && !lookDone,
      info: apiMode
        ? 'Pick a brand palette and a site-wide text font first. Apply saves the look, then continue to Address → Domain → Business details → Fill site-config.'
        : 'Pick a brand palette and a site-wide text font first. Apply saves the look, then continue to Address → Domain → Business details → Copy.',
      bodyHtml: `
        <h4>Site colors</h4>
        <div class="site-config-palette">
          <label data-tip="Named brand palette — Apply writes primary / accent / ink">
            Palette
            <select id="sc-brand-palette">
              ${paletteOptionsHtml(brandForLook)}
            </select>
          </label>
          ${paletteSwatchesHtml(brandForLook)}
        </div>
        <h4>Text font</h4>
        <p class="disc-tool-blurb">Affects the whole site (headings + body). Default matches current Rover.</p>
        <input type="hidden" id="sc-font-theme" value="${esc(matchFontThemeId(brandForLook))}" />
        ${fontThemeCardsHtml(
          brandForLook,
          (draft || accepted)?.businessName || nap.businessName || '',
        )}
        <div class="narrative-actions" style="justify-content:flex-end;margin-top:0.75rem">
          <button type="button" class="btn primary" id="sc-apply-look" data-tip="Save palette and font theme (to draft when available, otherwise until Load draft)">Apply look</button>
        </div>
        ${
          draft || accepted
            ? ''
            : `<p class="muted small">No draft yet — Apply look remembers your choice and steers the ${
                apiMode ? 'Fill site-config' : 'Copy'
              } prompt; it writes into site-config when you ${
                apiMode ? 'Fill site-config' : 'Load draft'
              }.</p>`
        }`,
    }),
  );

  const shortlist = Array.isArray(baPkg?.shortlist) ? baPkg.shortlist : [];
  const baStats = baPkg?.lastSearchStats || null;
  const baErrorKind = baPkg?.lastSearchErrorKind || null;
  const baSearchFailed =
    Boolean(baPkg?.lastSearchAt) &&
    (baPkg?.status === 'empty_search' ||
      baPkg?.status === 'error' ||
      baErrorKind === 'apify_billing' ||
      baErrorKind === 'apify_config' ||
      (baErrorKind !== 'cache_exhausted' &&
        shortlist.length === 0 &&
        (baStats?.listingsIn != null || baPkg?.lastSearchError)));

  const baFailureTitle =
    baErrorKind === 'apify_billing'
      ? 'Apify usage limit'
      : baErrorKind === 'apify_config'
        ? 'Find not configured'
        : baSearchFailed
          ? 'Find note'
          : 'Last search';

  const baCacheSize = Number(
    baStats?.cacheSize ?? baPkg?.listingCache?.listings?.length ?? 0,
  );
  const baSrcTogglesEarly = baLoadSourceToggles();
  const baRecoverEarly = state.baRecover?.[d?.id] || null;
  const baCacheExhausted = baCheckedSourcesExhausted(
    baRecoverEarly,
    baStats,
    baSrcTogglesEarly,
  );

  const baBusy = Boolean(state.baSearchBusy);
  const baBusyMode = state.baSearchMode || 'find';

  const lastSearchReportHtml = baPkg?.lastSearchAt
    ? baSearchReportBodyHtml(baPkg, { title: baFailureTitle, failed: baSearchFailed })
    : baPlanBarHtml(baPkg?.apifyPlanUsage || state.apifyPlanUsage);

  if (!state.apifyPlanUsage && !baPkg?.apifyPlanUsage && !state._apifyUsageAttempted) {
    state._apifyUsageAttempted = true;
    api('/api/apify/usage')
      .then((u) => {
        if (u) {
          state.apifyPlanUsage = u;
          if (document.getElementById('ba-find-addresses')) renderDetail();
        }
      })
      .catch(() => {});
  }

  const baShortlistRowHtml = (row, i, { secondary = false } = {}) => {
    const checks = Array.isArray(row.checks)
      ? row.checks
      : [
          { pass: true, label: 'Single street number (not a numeric range)' },
          ...(row.propertyType
            ? [{ pass: true, label: `Property type allowed: ${row.propertyType}` }]
            : []),
          { pass: true, label: `ZIP present (${row.zip || '—'})` },
          {
            pass: true,
            label: 'Places — no active OPERATIONAL Maps listing at this street+ZIP',
          },
          ...(row.suite
            ? [{ pass: null, label: `Suggested suite ${row.suite} (NAP-friendly stub)` }]
            : []),
          {
            pass: null,
            label: `Shortlist rank #${i + 1} of up to 25 (accumulated recommendations)`,
          },
        ];
    const checkItems = checks
      .map((c) => {
        const mark = c.pass === true ? '✓' : c.pass === false ? '✗' : '·';
        return `<li><span class="muted">${mark}</span> ${esc(c.label || '')}</li>`;
      })
      .join('');
    const listingCityLabel = String(row.city || '').trim();
    const mapsCityLabel = String(row.mapsLocality || '').trim();
    const listingMapsDiffer =
      listingCityLabel &&
      mapsCityLabel &&
      listingCityLabel.toLowerCase() !== mapsCityLabel.toLowerCase();
    const localityNote = listingMapsDiffer
      ? `<div class="muted small" style="margin-top:0.2rem">Listing: <strong>${esc(
          listingCityLabel,
        )}</strong> · Maps: <strong>${esc(mapsCityLabel)}</strong>${
          secondary ? ` (not ${esc(addrCity || 'target city')})` : ''
        }</div>`
      : secondary && mapsCityLabel
        ? `<div class="muted small" style="margin-top:0.2rem">Maps: <strong>${esc(
            mapsCityLabel,
          )}</strong> (not ${esc(addrCity || row.city || 'target city')})</div>`
        : row.localityUnknown
          ? `<div class="muted small" style="margin-top:0.2rem">Maps locality unknown — use with caution</div>`
          : '';
    return `<div class="callout" style="margin:0;padding:0.65rem 0.75rem${
      secondary ? ';opacity:0.95' : ''
    }">
      <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:flex-start;justify-content:space-between">
        <div>
          <strong>${esc(row.street)}${row.suite ? `, ${esc(row.suite)}` : ''}</strong>
          ${secondary ? ` <span class="muted small">Secondary</span>` : ''}
          <div class="muted small">${esc(row.city)}, ${esc(row.state)} ${esc(row.zip)}${
            row.propertyType ? ` · ${esc(row.propertyType)}` : ''
          }${row.expandedFrom ? ` · from range ${esc(row.expandedFrom)}` : ''}${
            row.foundAt ? ` · found ${esc(String(row.foundAt).slice(0, 10))}` : ''
          }</div>
          ${localityNote}
          <div class="muted small" style="margin-top:0.25rem">
            <a href="${esc(baMapsHref(row))}" target="_blank" rel="noopener">Maps</a>
            ·
            <a href="${esc(baStreetViewHref(row))}" target="_blank" rel="noopener">Street View</a>
            ${baListingPortalLinksHtml(row)}
          </div>
          <details class="narrative-raw lint-findings" style="margin-top:0.4rem">
            <summary><strong>How chosen</strong></summary>
            <ul class="speech-lint-list" style="margin:0.35rem 0 0">${checkItems}</ul>
          </details>
        </div>
        <button type="button" class="btn${
          secondary ? '' : ' primary'
        } ba-use-addr" data-ba-index="${i}" data-ba-tier="${
          secondary ? 'secondary' : 'primary'
        }" data-tip="Use this address in Business details">Use this</button>
      </div>
    </div>`;
  };

  const primaryShortlist = shortlist
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => row.tier !== 'secondary');
  const secondaryShortlist = shortlist
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => row.tier === 'secondary');

  const shortlistHtml = shortlist.length
    ? `<div class="ba-shortlist" style="margin-top:0.75rem">
        ${
          primaryShortlist.length
            ? `<p style="margin:0 0 0.4rem"><strong>Recommended</strong>
                <span class="muted small">(${primaryShortlist.length})</span>
              </p>
              <div style="display:flex;flex-direction:column;gap:0.5rem;margin-bottom:${
                secondaryShortlist.length ? '0.75rem' : '0'
              }">
                ${primaryShortlist.map(({ row, i }) => baShortlistRowHtml(row, i)).join('')}
              </div>`
            : ''
        }
        ${
          secondaryShortlist.length
            ? `<p style="margin:0 0 0.4rem"><strong>Secondary</strong>
                <span class="muted small">(${secondaryShortlist.length})</span>
              </p>
              <div style="display:flex;flex-direction:column;gap:0.5rem">
                ${secondaryShortlist
                  .map(({ row, i }) => baShortlistRowHtml(row, i, { secondary: true }))
                  .join('')}
              </div>`
            : ''
        }
      </div>`
    : '';

  const baRecover = state.baRecover?.[d?.id] || null;
  const shortlistKeySet = new Set(
    shortlist.map((row) => {
      const street = String(row?.street || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      const zip = String(row?.zip || '')
        .replace(/\D/g, '')
        .slice(0, 5);
      return `${street}|${zip}`;
    }),
  );
  const recoverStateOk = (row) => {
    const rowState = String(row?.state || '')
      .trim()
      .toUpperCase();
    if (!geoState || !rowState) return true;
    return rowState === geoState;
  };
  const recoverCleans = (Array.isArray(baRecover?.cleans) ? baRecover.cleans : []).filter((row) => {
    if (!recoverStateOk(row)) return false;
    const street = String(row?.street || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    const zip = String(row?.zip || '')
      .replace(/\D/g, '')
      .slice(0, 5);
    return !shortlistKeySet.has(`${street}|${zip}`);
  });
  const recoverOverrides = (Array.isArray(baRecover?.overrides) ? baRecover.overrides : []).filter(
    recoverStateOk,
  );
  const showRecover =
    baCacheExhausted ||
    baSearchFailed ||
    shortlist.length === 0 ||
    recoverCleans.length > 0 ||
    recoverOverrides.length > 0;

  const recoverRowHtml = (row, kind) => {
    const btnClass = kind === 'override' ? 'btn ba-use-override' : 'btn primary ba-use-recover';
    const btnLabel = kind === 'override' ? 'Use anyway' : 'Use this';
    const listingCityLabel = String(row.city || '').trim();
    const mapsCityLabel = String(row.mapsLocality || '').trim();
    const listingMapsDiffer =
      listingCityLabel &&
      mapsCityLabel &&
      listingCityLabel.toLowerCase() !== mapsCityLabel.toLowerCase();
    const warn =
      kind === 'override'
        ? `<div class="muted small" style="margin-top:0.2rem">Active Maps listing at this address${
            row.fail
              ? ` — ${esc(
                  String(row.fail)
                    .replace(/^existing Maps business:\s*/i, '')
                    .replace(/^active Maps listing:\s*/i, ''),
                )}`
              : ''
          }. Operator risk.</div>`
        : listingMapsDiffer
          ? `<div class="muted small" style="margin-top:0.2rem">Listing: <strong>${esc(
              listingCityLabel,
            )}</strong> · Maps: <strong>${esc(mapsCityLabel)}</strong>${
              row.tier === 'secondary' ? ` (not ${esc(addrCity || 'target city')})` : ''
            }</div>`
          : row.tier === 'secondary' && mapsCityLabel
            ? `<div class="muted small" style="margin-top:0.2rem">Secondary — Maps: <strong>${esc(
                mapsCityLabel,
              )}</strong> (not ${esc(addrCity || row.city || 'target city')})</div>`
            : '';
    return `<div class="callout" style="margin:0;padding:0.55rem 0.7rem">
      <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:flex-start;justify-content:space-between">
        <div>
          <strong>${esc(row.street)}${row.suite ? `, ${esc(row.suite)}` : ''}</strong>
          ${row.tier === 'secondary' ? ` <span class="muted small">Secondary</span>` : ''}
          <div class="muted small">${esc(row.city)}, ${esc(row.state)} ${esc(row.zip)}${
            row.propertyType ? ` · ${esc(row.propertyType)}` : ''
          }</div>
          ${warn}
          <div class="muted small" style="margin-top:0.2rem">
            <a href="${esc(baMapsHref(row))}" target="_blank" rel="noopener">Maps</a>
            ·
            <a href="${esc(baStreetViewHref(row))}" target="_blank" rel="noopener">Street View</a>
            ${baListingPortalLinksHtml(row)}
          </div>
        </div>
        <button type="button" class="${btnClass}" data-ba-recover-kind="${esc(
          kind,
        )}" data-ba-dedupe-key="${esc(row.dedupeKey || '')}" data-ba-tier="${esc(
          row.tier === 'secondary' ? 'secondary' : 'primary',
        )}" ${baBusy ? 'disabled' : ''}>${btnLabel}</button>
      </div>
    </div>`;
  };

  const recoverHtml =
    showRecover && (recoverCleans.length || recoverOverrides.length)
      ? `<div class="ba-recover" style="margin-top:0.75rem">
        ${
          recoverCleans.length
            ? `<p style="margin:0 0 0.35rem"><strong>Unclaimed cleans</strong>
                <span class="muted small"> — prior Places-clean streets still free in this city</span></p>
              <div style="display:flex;flex-direction:column;gap:0.4rem;margin-bottom:0.65rem">
                ${recoverCleans.map((row) => recoverRowHtml(row, 'clean')).join('')}
              </div>`
            : ''
        }
        ${
          recoverOverrides.length
            ? `<details class="narrative-raw" style="margin-top:0.65rem">
                <summary><strong>Use anyway</strong>
                  <span class="muted small"> — ${recoverOverrides.length} local-metro active-listing reject${
                    recoverOverrides.length === 1 ? '' : 's'
                  } (confirm before claiming)</span>
                </summary>
                <div style="display:flex;flex-direction:column;gap:0.4rem;margin-top:0.45rem">
                  ${recoverOverrides.map((row) => recoverRowHtml(row, 'override')).join('')}
                </div>
              </details>`
            : ''
        }
      </div>`
      : '';

  if (
    d?.id &&
    (ready || f.hasApproved) &&
    !state._baRecoverAttempted?.[d.id] &&
    !state.baRecover?.[d.id]
  ) {
    if (!state._baRecoverAttempted) state._baRecoverAttempted = {};
    state._baRecoverAttempted[d.id] = true;
    api(`/api/candidates/${encodeURIComponent(d.id)}/address/recover`)
      .then((data) => {
        if (!state.baRecover) state.baRecover = {};
        state.baRecover[d.id] = data;
        if (data?.readiness) state.baSources = data.readiness;
        if (document.getElementById('ba-find-addresses')) renderDetail();
      })
      .catch(() => {});
  }

  const baProgressHtml = baBusy
    ? `<div id="ba-search-progress" class="job-progress" aria-live="polite" style="margin-top:0.65rem">
        <div class="job-progress-track"><div class="job-progress-bar"></div></div>
        <p class="job-progress-label">${
          baBusyMode === 'refresh' ? 'Refreshing listings…' : 'Finding addresses…'
        }</p>
        <p class="job-progress-detail">${
          baBusyMode === 'refresh'
            ? `Pulling checked sources for ${esc(addrCity || 'city')}${
                addrState ? `, ${esc(addrState)}` : ''
              } (Apify billable; deeper when cache is exhausted), then screening with Places.`
            : `Continuing from city cache when available, then screening with Places for ${esc(
                addrCity || 'city',
              )}${addrState ? `, ${esc(addrState)}` : ''}. Cache hits skip Apify.`
        }</p>
      </div>`
    : '';

  const selectedBanner = baSel
    ? `<div class="callout" style="margin-top:0.5rem"><strong>Selected:</strong> ${esc(
        baSel.street,
      )}, ${esc(baSel.city)}, ${esc(baSel.state)} ${esc(baSel.zip)}</div>`
    : baPkg?.skipped
      ? `<div class="callout" style="margin-top:0.5rem">Address skipped — street left blank for site-config.</div>`
      : '';

  const baSrcToggles = baSrcTogglesEarly;
  const baSrcReady = baGetSourceReadiness();
  const baFindCaps = baLoadFindCaps();
  const sourceToggleHtml = `<div class="muted small" style="margin-top:0.5rem;display:flex;flex-wrap:wrap;gap:0.85rem;align-items:center">
    <span>Sources:</span>
    <label style="display:inline-flex;align-items:center;gap:0.3rem;cursor:${
      baSrcReady.loopnet ? 'pointer' : 'not-allowed'
    }" data-tip="${
      baSrcReady.loopnet
        ? 'Include LoopNet in Find / Refresh'
        : 'Set APIFY_LOOPNET_ACTOR_ID in .env'
    }">
      <input type="checkbox" id="ba-source-loopnet" ${baSrcToggles.loopnet ? 'checked' : ''} ${
        !baSrcReady.loopnet || baBusy ? 'disabled' : ''
      } /> LoopNet
    </label>
    <label style="display:inline-flex;align-items:center;gap:0.3rem;cursor:${
      baSrcReady.crexi ? 'pointer' : 'not-allowed'
    }" data-tip="${
      baSrcReady.crexi ? 'Include Crexi in Find / Refresh' : 'Set APIFY_CREXI_ACTOR_ID in .env'
    }">
      <input type="checkbox" id="ba-source-crexi" ${baSrcToggles.crexi ? 'checked' : ''} ${
        !baSrcReady.crexi || baBusy ? 'disabled' : ''
      } /> Crexi
    </label>
  </div>
  <div class="muted small" style="margin-top:0.45rem;display:flex;flex-wrap:wrap;gap:0.85rem;align-items:center">
    <label style="display:inline-flex;align-items:center;gap:0.3rem" data-tip="Stop Places screening after this many clean streets (1–25)">
      Clean target
      <input type="number" id="ba-clean-per-run" min="${BA_CLEAN_PER_RUN_MIN}" max="${BA_CLEAN_PER_RUN_MAX}" step="1" value="${
        baFindCaps.cleanPerRun
      }" ${baBusy ? 'disabled' : ''} style="width:3.5rem" />
    </label>
    <label style="display:inline-flex;align-items:center;gap:0.3rem" data-tip="How many listings to pull per source on Find / Refresh (10–200)">
      Pull size
      <input type="number" id="ba-listings-per-run" min="${BA_LISTINGS_PER_RUN_MIN}" max="${BA_LISTINGS_PER_RUN_MAX}" step="1" value="${
        baFindCaps.listingsPerRun
      }" ${baBusy ? 'disabled' : ''} style="width:3.5rem" />
    </label>
  </div>`;

  parts.push(
    contentStepHtml({
      id: 'address',
      num: 2,
      title: 'Business address',
      done: addressDone,
      open: openId === 'address' || baBusy,
      current: currentId === 'address' && !addressDone,
      info: `Find a clean commercial street in ${esc(
        addrCity || 'your city',
      )} (or Manual / home / Skip). Selection pre-fills Business details; next step is Domain.`,
      bodyHtml: `
        ${
          baPkg || state.baRecover?.[d?.id]
            ? baInventoryProgressHtml(
                baInventoryFromPkg(baPkg, state.baRecover?.[d?.id] || null),
                {
                  recover: state.baRecover?.[d?.id] || null,
                  stats: baPkg?.lastSearchStats || null,
                  toggles: baSrcTogglesEarly,
                  style: 'margin-top:0',
                },
              )
            : ''
        }
        ${selectedBanner}
        ${sourceToggleHtml}
        <div class="narrative-actions" style="flex-wrap:wrap;gap:0.5rem;align-items:center;margin-top:0.5rem">
          <button type="button" class="btn${baCacheExhausted ? '' : ' primary'}" id="ba-find-addresses" data-tip="Pull and screen checked sources. Use Find for a first Crexi/LoopNet pull or when that source still has streets left. Cache hits skip Apify." ${
            baBusy || !(ready || f.hasApproved) ? 'disabled' : ''
          }${baBusy ? ' aria-busy="true"' : ''}>Find addresses</button>
          <button type="button" class="btn${baCacheExhausted ? ' primary' : ''}" id="ba-refresh-loopnet" data-tip="${
            baCacheExhausted
              ? 'Checked sources are at 0 left — raise pull depth (Apify billable), then screen new streets.'
              : 'Re-scrape checked sources (Apify billable). Prefer Find when a source is not exhausted yet.'
          }" ${baBusy || !(ready || f.hasApproved) ? 'disabled' : ''}>${
            baCacheExhausted ? 'Fetch deeper' : 'Refresh listings'
          }</button>
          <button type="button" class="btn" id="ba-show-manual" data-tip="Paste any commercial street and claim it for this candidate." ${
            baBusy ? 'disabled' : ''
          }>Manual commercial</button>
          <button type="button" class="btn" id="ba-show-home" data-tip="Use your home street instead of a commercial listing." ${
            baBusy ? 'disabled' : ''
          }>Use my home address</button>
          <button type="button" class="btn" id="ba-skip-address" data-tip="Continue without a business street address." ${
            baBusy ? 'disabled' : ''
          }>Skip address</button>
        </div>
        ${baProgressHtml}
        <div id="ba-manual-panel" class="hidden" style="margin-top:0.65rem">
          <label style="display:block">
            <span class="muted small">Commercial street (include city, state, ZIP — single number, not a range)</span>
            <input id="ba-manual-line" type="text" placeholder="6778 S 1300 E, ${esc(
              addrCity || 'City',
            )}, ${esc(addrState || 'ST')} 84121" style="width:100%;margin-top:0.25rem" />
          </label>
          <div class="narrative-actions" style="justify-content:flex-end;margin-top:0.4rem">
            <button type="button" class="btn primary" id="ba-save-manual">Save commercial address</button>
          </div>
        </div>
        <div id="ba-home-panel" class="hidden" style="margin-top:0.65rem">
          <label style="display:block">
            <span class="muted small">Home street (include city, state, ZIP)</span>
            <input id="ba-home-line" type="text" placeholder="123 Main St, ${esc(
              addrCity || 'City',
            )}, ${esc(addrState || 'ST')} 00000" style="width:100%;margin-top:0.25rem" />
          </label>
          <div class="narrative-actions" style="justify-content:flex-end;margin-top:0.4rem">
            <button type="button" class="btn primary" id="ba-save-home">Save address</button>
          </div>
        </div>
        ${lastSearchReportHtml}
        ${shortlistHtml}
        ${recoverHtml}`,
    }),
  );

  const preStreet = baSel?.street || nap.addressStreet || '';
  const preZip = baSel?.zip || nap.addressZip || '';
  // Form prefills may use per-candidate NAP; city/state fall back to finder geography.
  const preCity = baSel?.city || nap.addressCity || addrCity;
  const preState = baSel?.state || nap.addressState || addrState;

  const domainPick =
    nap.domainPick && typeof nap.domainPick === 'object' ? nap.domainPick : {};
  const domainSuggestions = Array.isArray(domainPick.suggestions)
    ? domainPick.suggestions
    : [];
  const selectedDomain = normalizeDomainHostname(domainPick.selectedDomain || '');
  const customDomain = String(domainPick.customDomain || '').trim();
  const domainChoiceReady = Boolean(
    selectedDomain || normalizeDomainHostname(customDomain),
  );
  const domainRowsHtml = domainSuggestions.length
    ? `<ul class="sc-domain-pick-list">${domainSuggestions
        .map((row) => {
          const host = normalizeDomainHostname(row.domain);
          if (!host) return '';
          const on = selectedDomain && selectedDomain === host && !customDomain;
          const avail =
            row.available === true
              ? ' · maybe available'
              : row.available === false
                ? ' · likely taken'
                : '';
          const note = row.note ? ` — ${esc(row.note)}` : '';
          return `<li class="sc-domain-pick-row">
            <span class="sc-domain-pick-label"><code>${esc(host)}</code>${esc(avail)}${note}</span>
            <label class="sc-domain-pick-toggle" data-tip="Select this domain (only one)">
              <input type="checkbox" class="sc-domain-pick-opt" data-domain="${esc(host)}" ${
                on ? 'checked' : ''
              } />
              <span class="sc-domain-pick-switch" aria-hidden="true"></span>
            </label>
          </li>`;
        })
        .join('')}</ul>`
    : `<p class="muted small">${
        apiMode
          ? 'Run Suggest domains to see top Exact Match hosts.'
          : 'Paste Claude’s reply and Load to see top Exact Match suggestions.'
      }</p>`;

  const domainBusy = Boolean(state.claudeBusy && state.activeAct === 'domain-pick');
  const domainGateOk = ready || f.hasApproved;
  const domainSuggestLabel = domainBusy
    ? 'Suggesting…'
    : domainSuggestions.length
      ? 'Re-run Suggest domains'
      : 'Suggest domains';
  const domainClaudeHtml = apiMode
    ? `<div class="narrative-actions">
          <button type="button" class="btn primary" id="sc-domain-suggest" data-tip="Fill Exact Match hosts via the Anthropic API (confirm cost first)" ${
            domainGateOk && !domainBusy ? '' : 'disabled'
          }${domainBusy ? ' aria-busy="true"' : ''}>${esc(domainSuggestLabel)}</button>
        </div>`
    : `<div class="narrative-actions">
          <button type="button" class="btn primary" id="sc-domain-copy-prompt" data-tip="Copy Exact Domain Match prompt for Claude.ai" ${
            domainGateOk ? '' : 'disabled'
          }>Copy domain prompt</button>
          ${openClaudeAiBtnHtml({
            disabled: !domainGateOk,
            id: 'sc-domain-open-claude',
            tip: 'Open Claude.ai (paste the copied domain prompt)',
          })}
        </div>
        <div class="narrative-paste" style="margin-top:0.65rem">
          <h4>Paste Claude’s domain list</h4>
          <textarea id="sc-domain-paste" class="narrative-paste-input" rows="2" placeholder="Paste Claude’s JSON or domain list…" data-tip="Paste Exact Domain Match reply"></textarea>
          <div class="narrative-actions">
            <button type="button" class="btn primary" id="sc-domain-paste-load" data-tip="Parse pasted domains into the list below">Load</button>
          </div>
        </div>`;

  parts.push(
    contentStepHtml({
      id: 'domain',
      num: 3,
      title: 'Domain',
      done: domainDone,
      open: openId === 'domain',
      current: currentId === 'domain' && !domainDone,
      info: apiMode
        ? 'Run Suggest domains for Exact Match hosts (primary city first only), pick one (or enter a custom host), buy on Cloudflare if needed, then Continue to Business details.'
        : 'Copy the Exact Domain Match prompt, paste Claude’s top 10 (primary city first only), pick one (or enter a custom host), buy on Cloudflare if needed, then Continue to Business details.',
      bodyHtml: `
        <p class="disc-tool-blurb">Claude suggests Exact Domain Match hosts that start with the primary city and the niche’s strongest keywords (plus a few city-first suffixes like pros / elite). No other cities. Availability is Claude’s best guess only — confirm when you buy.</p>
        ${domainClaudeHtml}
        <div class="sc-domain-pick" style="margin-top:0.65rem">
          <h4>Suggestions</h4>
          ${domainRowsHtml}
          <label class="sc-domain-custom" style="display:block;margin-top:0.55rem">
            <span class="label-with-tip-head">
              <span>Custom domain</span>
              <button type="button" class="tip-info" data-tip="Use your own host instead of a suggestion. Clears any toggle." aria-label="About Custom domain">i</button>
            </span>
            <input id="sc-domain-custom" type="text" value="${esc(customDomain)}" placeholder="yourdomain.com" />
          </label>
          <div class="narrative-actions" style="margin-top:0.65rem;flex-wrap:wrap;gap:0.4rem">
            <a class="btn" href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer" id="sc-domain-cloudflare" data-tip="Open Cloudflare Dashboard — register or transfer the domain (Registrar), then Continue">Buy on Cloudflare</a>
            <button type="button" class="btn primary" id="sc-domain-continue" data-tip="Save chosen domain into Business details" ${
              domainChoiceReady ? '' : 'disabled'
            }>Continue</button>
          </div>
        </div>`,
    }),
  );

  const scBusy = Boolean(state.claudeBusy && state.activeAct === 'site-config');
  const scGenerateLabel = scBusy ? 'Filling…' : draft ? 'Re-run' : 'Fill site-config';
  const detailsClaudeHtml = apiMode
    ? `<div class="narrative-actions" style="justify-content:flex-end">
          <button type="button" class="btn primary" id="sc-site-config-generate" data-tip="Fill site-config draft via the Anthropic API (confirm cost first). Accept stays in Review services." ${
            (ready || f.hasApproved) && !scBusy ? '' : 'disabled'
          }${scBusy ? ' aria-busy="true"' : ''}>${esc(scGenerateLabel)}</button>
        </div>`
    : `<div class="narrative-actions" style="justify-content:flex-end">
          <button type="button" class="btn primary" id="sc-copy-prompt" data-tip="Copy Claude.ai site-config prompt (stays on this step)" ${ready || f.hasApproved ? '' : 'disabled'}>Copy site-config prompt</button>
          ${openClaudeAiBtnHtml({
            disabled: !(ready || f.hasApproved),
            id: 'sc-open-claude',
            tip: 'Open Claude.ai and continue to Paste Claude’s reply',
          })}
        </div>`;

  const draftEditParts = [];
  const ph = draft?._ops?.placeholders || [];
  if (draft && ph.length) {
    draftEditParts.push(
      `<div class="callout warn">Still need filling: <code>${esc(ph.join(', '))}</code> — edit the matching fields below before Accept (or Accept anyway for an early build).</div>`,
    );
  } else if (draft) {
    draftEditParts.push(statusLineHtml('Draft looks complete — save if you edit, then Accept in Review services.'));
  }
  if (draft) {
    const suburbsText = Array.isArray(draft.targetSuburbs) ? draft.targetSuburbs.join('; ') : '';
    const servicesText = Array.isArray(draft.services) ? draft.services.join('; ') : '';
    const commercialText = Array.isArray(draft.commercialServices)
      ? draft.commercialServices.join('; ')
      : '';
    const svcN = Array.isArray(draft.services) ? draft.services.length : 0;
    const lim = Number(draft.homepageServicesLimit ?? 8);
    const showCards = svcN ? Math.min(svcN, Number.isFinite(lim) ? lim : 8) : 0;
    const phoneStep = apiMode ? '7' : '8';
    draftEditParts.push(`
      <div class="narrative-actions" style="margin-top:1rem">
        <h4 style="margin:0">Edit draft</h4>
      </div>
      <p class="muted">Fix anything Claude got wrong. Accept is in <strong>Review services</strong> (next step). Brand colors come from <strong>Colors & fonts</strong> (step 1).</p>
      <div class="site-config-nap" id="sc-draft-edit">
        <label>Business name <input id="sc-edit-businessName" type="text" value="${esc(draft.businessName || '')}" /></label>
        <label>Domain <input id="sc-edit-domain" type="text" value="${esc(draft.domain || '')}" /></label>
        <label>
          <span class="label-with-tip-head">
            <span>Phone</span>
            <button type="button" class="tip-info" data-tip="Optional Claude seed. Ranking number is set in step ${phoneStep} and replaces this on the live site-config." aria-label="About draft Phone">i</button>
          </span>
          <input id="sc-edit-phone" type="text" value="${esc(draft.phone || '')}" placeholder="Optional — provision in step ${phoneStep}" />
        </label>
        <label>Email <input id="sc-edit-email" type="email" value="${esc(draft.email || '')}" /></label>
        <label class="site-config-span2">Tagline <input id="sc-edit-tagline" type="text" value="${esc(draft.tagline || '')}" /></label>
        <label>Primary CTA <input id="sc-edit-primaryCta" type="text" value="${esc(draft.primaryCta || '')}" /></label>
        <label>Primary city <input id="sc-edit-primaryCity" type="text" value="${esc(draft.primaryCity || '')}" /></label>
        <label>State <input id="sc-edit-state" type="text" value="${esc(draft.state || '')}" maxlength="2" /></label>
        <label>Niche <input id="sc-edit-niche" type="text" value="${esc(draft.niche || '')}" /></label>
        <label>Radius (mi) <input id="sc-edit-radius" type="text" value="${esc(String(draft.serviceRadiusMiles ?? ''))}" /></label>
        <label>Street (optional) <input id="sc-edit-street" type="text" value="${esc(draft.address?.street || '')}" placeholder="Only if real — never invent" data-tip="Optional real street for LocalBusiness schema. Leave blank if unknown." /></label>
        <label>ZIP (optional) <input id="sc-edit-zip" type="text" value="${esc(draft.address?.zip || '')}" placeholder="e.g. 84084" data-tip="Optional ZIP with street. Leave blank if unknown." /></label>
        <label class="site-config-span2">Target suburbs <input id="sc-edit-suburbs" type="text" value="${esc(suburbsText)}" placeholder="City A; City B" /></label>
        <label class="site-config-span2">Services (each gets a page) <input id="sc-edit-services" type="text" value="${esc(servicesText)}" placeholder="Service A; Service B" data-tip="Every name here gets a service page" /></label>
        <label class="site-config-span2">Commercial services (optional) <input id="sc-edit-commercial" type="text" value="${esc(commercialText)}" placeholder="Commercial A; Commercial B" data-tip="Homepage commercial split — finalize with Accept in Review services" /></label>
        <label class="site-config-span2">Homepage “What we do” cards
          <input id="sc-edit-svc-limit" type="number" min="1" max="12" value="${esc(String(draft.homepageServicesLimit ?? 8))}" data-tip="Prefer 6 or 8 homepage cards. Service pages are still created for every Services name." />
          <span class="muted" style="display:block;margin-top:0.35rem;font-size:0.85em;font-weight:400">Prefer 6 (3×2) or 8 (4×2).${
            svcN ? ` Currently showing ${esc(String(showCards))} of ${esc(String(svcN))} on homepage.` : ''
          }</span>
        </label>
        <label>
          <span class="label-with-tip-head">
            <span>Web3Forms key</span>
            <a href="https://web3forms.com/" target="_blank" rel="noopener">Get key</a>
          </span>
          <input id="sc-edit-web3" type="text" value="${esc(draft.web3FormsAccessKey || '')}" placeholder="Required for contact forms" />
        </label>
        <label>Turnstile site key <input id="sc-edit-turnstile" type="text" value="${esc(draft.turnstileSiteKey || '')}" placeholder="optional" /></label>
      </div>
      <div class="narrative-actions" style="justify-content:flex-end;margin-top:1rem">
        <button type="button" class="btn primary" id="site-config-save-draft-btn" data-tip="Save edits without Accept">Save draft</button>
      </div>
    `);
  }

  parts.push(
    contentStepHtml({
      id: 'details',
      num: 4,
      title: 'Business details',
      done: apiMode ? Boolean(draft || accepted) : detailsDone,
      open: openId === 'details',
      current: currentId === 'details' && !(apiMode ? Boolean(draft || accepted) : detailsDone),
      info: apiMode
        ? 'Domain comes from step 3 when set. Fill name, email, and radius. Phone is optional here — ranking number comes in step 7. Address comes from step 2 when set. Fill site-config loads a draft; Accept is in Review services.'
        : 'Domain comes from step 3 when set. Fill name, email, and radius. Phone is optional here — ranking number comes in step 8. Address comes from step 2 when set. Copy site-config prompt, then Paste.',
      bodyHtml: `
        <p class="disc-tool-blurb">${
          apiMode
            ? 'Seeds the Fill site-config prompt and fills blanks if Claude leaves them. Does not Accept.'
            : 'Used when you copy the prompt and merged into the draft if Claude leaves blanks.'
        }</p>
        <div class="site-config-nap">
          <label>
            <span class="label-with-tip-head">
              <span>Domain</span>
              <button type="button" class="tip-info" data-tip="Public hostname without https:// (e.g. yourdomain.com). Prefills from Domain step." aria-label="About Domain">i</button>
            </span>
            <input id="sc-domain" type="text" value="${esc(nap.domain || '')}" placeholder="yourdomain.com" />
          </label>
          <label>
            <span class="label-with-tip-head">
              <span>Business name</span>
              <button type="button" class="tip-info" data-tip="Customer-facing brand name on the site." aria-label="About Business name">i</button>
            </span>
            <input id="sc-business" type="text" value="${esc(nap.businessName || '')}" placeholder="Brand LLC" />
          </label>
          <label>
            <span class="label-with-tip-head">
              <span>Phone</span>
              <button type="button" class="tip-info" data-tip="Optional for the Claude prompt. Your ranking number is set in step ${
                apiMode ? '7' : '8'
              } (Provision phone) and replaces this on the live site-config." aria-label="About Phone">i</button>
            </span>
            <input id="sc-phone" type="text" value="${esc(nap.phone || '')}" placeholder="Optional — provision in step ${
              apiMode ? '7' : '8'
            }" />
          </label>
          <label class="site-config-email">
            <span class="label-with-tip-head">
              <span>Email</span>
              <button type="button" class="tip-info" data-tip="Public site leads address (usually leads@yourdomain.com) — shown in footer, contact, and schema. Not your personal Gmail." aria-label="About Email">i</button>
            </span>
            <input id="sc-email" type="email" value="${esc(nap.email || '')}" placeholder="leads@yourdomain.com" />
          </label>
          <label class="site-config-radius">
            <span class="label-with-tip-head">
              <span>Radius (mi)</span>
              <button type="button" class="tip-info" data-tip="Default radius seed for Service area map." aria-label="About Radius">i</button>
            </span>
            <input id="sc-radius" type="text" value="${esc(nap.radiusMiles || '15')}" />
          </label>
          <label class="site-config-span2">
            <span class="label-with-tip-head">
              <span>Street</span>
              <button type="button" class="tip-info" data-tip="From Address step — edit only if needed. Leave blank to omit LocalBusiness street." aria-label="About Street">i</button>
            </span>
            <input id="sc-street" type="text" value="${esc(preStreet)}" placeholder="From Address step or blank" />
          </label>
          <label>
            <span>City</span>
            <input id="sc-addr-city" type="text" value="${esc(preCity)}" />
          </label>
          <label>
            <span>State</span>
            <input id="sc-addr-state" type="text" value="${esc(preState)}" maxlength="2" />
          </label>
          <label>
            <span>ZIP</span>
            <input id="sc-zip" type="text" value="${esc(preZip)}" placeholder="00000" />
          </label>
        </div>
        ${detailsClaudeHtml}
        ${apiMode ? draftEditParts.join('') : ''}`,
    }),
  );

  const pasteParts = [];
  pasteParts.push(`
    <div class="narrative-paste">
      <h4>${draft ? 'Replace from Claude' : 'Paste Claude’s reply'}</h4>
      <p class="muted">Paste Claude’s full reply below, then <strong>Load draft</strong>. Edit fields here, then continue to <strong>Review services</strong> to Accept. Extra commentary after the JSON is fine.</p>
      <textarea id="site-config-paste" class="narrative-paste-input" rows="2" placeholder="Paste Claude’s site-config reply here…" data-tip="Paste Claude site-config reply"></textarea>
      <div class="narrative-actions">
        <button type="button" class="btn primary" id="site-config-paste-load-btn" data-tip="Load paste as draft — then edit fields and Accept in Review services" ${
          f.hasApproved ? '' : 'disabled'
        }>Load draft</button>
      </div>
      <p class="disc-tool-blurb"><strong>Load draft</strong> does not write the live config yet — Accept is in the next step.</p>
    </div>
  `);
  pasteParts.push(...draftEditParts);

  if (!apiMode) {
    parts.push(
      contentStepHtml({
        id: 'paste',
        num: 5,
        title: 'Paste Claude’s reply',
        done: pasteDone,
        open: openId === 'paste',
        current: currentId === 'paste' && !pasteDone,
        info: 'Paste Claude’s site-config reply, Load draft, and edit all fields here. Accept is in the next step (Review services).',
        bodyHtml: pasteParts.join(''),
      }),
    );
  }

  const servicesBodyHtml = accepted
    ? siteConfigServicesChoiceHtml({
        residential: accepted.services || [],
        commercial: accepted.commercialServices || [],
        mode: 'accepted',
        asStepBody: true,
      })
    : draft
      ? siteConfigServicesChoiceHtml({
          residential: draft.services || [],
          commercial: draft.commercialServices || [],
          mode: 'draft',
          asStepBody: true,
        })
      : lockedUntilDraft;

  parts.push(
    contentStepHtml({
      id: 'services',
      num: apiMode ? 5 : 6,
      title: 'Review services',
      done: servicesDone,
      open: openId === 'services',
      current: currentId === 'services' && !servicesDone,
      locked: !(draft || accepted),
      bodyHtml: servicesBodyHtml,
    }),
  );

  const covN = accepted && Array.isArray(accepted.coverageAreas) ? accepted.coverageAreas.length : 0;
  const pageN = accepted && Array.isArray(accepted.targetSuburbs) ? accepted.targetSuburbs.length : 0;
  parts.push(
    contentStepHtml({
      id: 'service-area',
      num: apiMode ? 6 : 7,
      title: 'Service area',
      done: serviceAreaDone,
      open: openId === 'service-area',
      current: currentId === 'service-area' && !serviceAreaDone,
      locked: !accepted,
      info: 'Set radius on the map, toggle coverage cities, then save. Claude-seeded suburbs alone do not complete this step. Blue Page = SEO location pages (prefer 4–6 including primary).',
      bodyHtml: accepted
        ? `
          <p class="disc-tool-blurb">Coverage can be wide. Blue Page = location page (prefer 4–6 including primary). Click Page to toggle without removing coverage.</p>
          ${
            serviceAreaDone
              ? `<p class="muted small">Saved · ${esc(String(covN))} coverage · ${esc(String(pageN))} location pages · ${esc(
                  String(accepted.serviceRadiusMiles ?? ''),
                )} mi — reopen to edit.</p>`
              : ''
          }
          <div id="sa-host" class="sa-host"></div>
        `
        : lockedUntilAccept,
    }),
  );

  const phoneTrackingHint = accepted?.phone
    ? `<p class="muted small">Current site-config phone: <code>${esc(accepted.phone)}</code></p>`
    : '';
  const alreadyProvisioned = Boolean(state.sitePhoneProvisioned?.[d?.id]);
  parts.push(
    contentStepHtml({
      id: 'phone',
      num: apiMode ? 7 : 8,
      title: 'Provision phone number',
      done: phoneDone,
      open: openId === 'phone',
      current: currentId === 'phone' && !phoneDone,
      locked: !accepted,
      info: 'Buy a Twilio local DID or Skip (~$1.15/mo). A phone already in site-config from Claude does not complete this step. Whisper uses business name. See docs/PHONE-TRACKING.md.',
      bodyHtml: accepted
        ? `
          <p class="disc-tool-blurb">Provision a local ranking number, then continue Content → Website Prepare / Launch.</p>
          ${phoneTrackingHint}
          <div class="narrative-actions" style="align-items:center;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem">
            <label class="muted small" style="display:inline-flex;align-items:center;gap:0.35rem">
              Area code (optional)
              <input id="sc-twilio-area" type="text" inputmode="numeric" maxlength="3" placeholder="auto" style="width:4rem" />
            </label>
            <button type="button" class="btn primary" id="sc-provision-twilio" data-tip="Buy Twilio ranking number and write site-config phone" ${
              alreadyProvisioned ? 'disabled' : ''
            }>Provision new phone number</button>
            <button type="button" class="btn" id="sc-skip-phone" data-tip="Skip Twilio for now — continue with the current site-config phone (Launch still flags placeholders)" ${
              phoneDone ? 'disabled' : ''
            }>Skip</button>
          </div>
          <p class="muted small" id="sc-phone-tracking-status"></p>
        `
        : lockedUntilAccept,
    }),
  );

  return parts.join('');
}

function panelHowToHtml({ label, info }) {
  return `<div class="panel-how-to">
    <span class="panel-how-to-label">${esc(label)}</span>
    <button type="button" class="tip-info" data-tip="${esc(info)}" aria-label="About ${esc(
      label,
    )}">i</button>
  </div>`;
}

function statusLineHtml(innerHtml) {
  if (!innerHtml) return '';
  return `<p class="status-line">${innerHtml}</p>`;
}

function headingWithInfoHtml(tag, text, info) {
  const t = String(tag || 'h3').toLowerCase();
  const safe = t === 'h2' || t === 'h4' ? t : 'h3';
  return `<${safe} class="heading-with-info"><span>${esc(text)}</span><button type="button" class="tip-info" data-tip="${esc(
    info,
  )}" aria-label="About ${esc(text)}">i</button></${safe}>`;
}

function contentStepHtml({
  id,
  num,
  title,
  done,
  open,
  info,
  bodyHtml,
  current = false,
  locked = false,
  plain = false,
  freeze = false,
  freezeHtml = '',
  headActionsHtml = '',
}) {
  const infoBtn = info
    ? `<button type="button" class="tip-info" data-tip="${esc(info)}" aria-label="About ${esc(
        title,
      )}">i</button>`
    : '';
  const actions = headActionsHtml || '';
  if (plain) {
    return `<section class="content-step website-utility-panel${open ? ' open' : ''}${
      locked ? ' locked' : ''
    }" data-content-step="${esc(id)}">
      <div class="content-step-head-wrap">
        <button type="button" class="content-step-head" data-content-toggle="${esc(id)}">
          <span class="content-step-label">${esc(title)}</span>
        </button>
        ${infoBtn}
        ${actions}
      </div>
      <div class="content-step-body">${bodyHtml}</div>
    </section>`;
  }
  const head = `<div class="content-step-head-wrap">
      <button type="button" class="content-step-head" data-content-toggle="${esc(id)}">
        <span class="disc-step-mark" aria-hidden="true"></span>
        <span class="content-step-label">${esc(String(num))} · ${esc(title)}</span>
      </button>
      ${infoBtn}
      ${actions}
    </div>`;
  const top = freeze
    ? `<div class="content-step-freeze">${head}${freezeHtml || ''}</div>`
    : head;
  return `<section class="content-step${done ? ' done' : ''}${open ? ' open' : ''}${
    current ? ' current' : ''
  }${locked ? ' locked' : ''}" data-content-step="${esc(id)}">
    ${top}
    <div class="content-step-body">${bodyHtml}</div>
  </section>`;
}

const SITE_CONFIG_STEP_ORDER = [
  'look',
  'address',
  'domain',
  'details',
  'paste',
  'services',
  'service-area',
  'phone',
];
const CONTENT_STEP_ORDER = [
  'structure',
  'fieldResearch',
  'brief',
  'outline',
  'write',
  'editor',
  'finalCheck',
  'imageQueries',
  'photoGroup',
  'accept',
];
const CONTENT_INNER_STEPS = new Set([
  'fieldResearch',
  'brief',
  'outline',
  'write',
  'editor',
  'finalCheck',
  'imageQueries',
]);
function contentStepOrder({ photosOn = true, apiMode = false } = {}) {
  if (apiMode) {
    return photosOn
      ? ['structure', 'writeSite', 'photoGroup', 'accept']
      : ['structure', 'writeSite', 'accept'];
  }
  return CONTENT_STEP_ORDER;
}
const WEBSITE_STEP_ORDER = ['logoMap', 'images', 'prepare', 'launch', 'indexing'];

/** Force open + pulse to stepId (Copy / handoff) without waiting for durable done. */
function advancePanelStep(panel, stepId) {
  if (panel === 'site-config') {
    state.siteConfigOpenStep = stepId;
    state.siteConfigSoftCurrent = stepId;
    state.siteConfigFollowCurrent = stepId;
    markSoftDonePrior('siteConfigSoftDone', SITE_CONFIG_STEP_ORDER, stepId);
  } else if (panel === 'website') {
    state.websiteOpenStep = stepId;
    state.websiteSoftCurrent = stepId;
    state.websiteFollowCurrent = stepId;
    markSoftDonePrior('websiteSoftDone', WEBSITE_STEP_ORDER, stepId);
  } else {
    state.contentOpenStep = stepId;
    state.contentSoftCurrent = stepId;
    state.contentFollowCurrent = stepId;
    markSoftDonePrior(
      'contentSoftDone',
      contentStepOrder({
        photosOn: contentPhotosEnabled(state.detail || {}),
        apiMode: effectiveClaudeUiMode() === 'api',
      }),
      stepId,
    );
  }
}

/** Sticky green-check for steps before the soft-advanced target. */
function markSoftDonePrior(softDoneKey, order, stepId) {
  const map = { ...(state[softDoneKey] || {}) };
  const idx = order.indexOf(stepId);
  if (idx <= 0) {
    state[softDoneKey] = map;
    return;
  }
  for (let i = 0; i < idx; i += 1) map[order[i]] = true;
  state[softDoneKey] = map;
}

function isSoftDone(softDoneKey, stepId) {
  return Boolean(state[softDoneKey]?.[stepId]);
}

/** Prefer soft current until durable catches up or panel is complete.
 *  If `order` is given, never keep a soft current that skipped an earlier incomplete step. */
function resolvePanelCurrent(softKey, durableCurrent, order) {
  const soft = state[softKey];
  if (!soft) return durableCurrent;
  if (soft === durableCurrent || durableCurrent == null) {
    state[softKey] = null;
    return durableCurrent;
  }
  if (Array.isArray(order) && order.length) {
    const si = order.indexOf(soft);
    const di = order.indexOf(durableCurrent);
    if (si >= 0 && di >= 0 && di < si) {
      state[softKey] = null;
      return durableCurrent;
    }
  }
  return soft;
}

/** Numbered action row: n · label + optional controls; done replaces n with ✓; loaded appends a check after the label. */
function contentActionRow({ n, label, hint, controlsHtml = '', done = false, loaded = false }) {
  const loadedMark = loaded
    ? ` <span class="content-action-check" aria-label="Loaded">✓</span>`
    : '';
  return `<div class="content-action-row${done ? ' content-action-row-done' : ''}">
    <div class="content-action-meta">
      <span class="content-action-num${done ? ' content-action-num-done' : ''}"${
        done ? ` ${tipAttr('Completed')}` : ''
      }>${done ? '✓' : esc(String(n))}</span>
      <div>
        <div class="content-action-label">${label}${loadedMark}</div>
        ${hint ? `<p class="disc-tool-blurb">${hint}</p>` : ''}
      </div>
    </div>
    ${controlsHtml ? `<div class="content-action-controls">${controlsHtml}</div>` : ''}
  </div>`;
}

function photoGroupDisplayName(g) {
  if (!g) return '';
  if (g.kind === 'master') return String(g.name || `${g.niche || 'Niche'} master`);
  return String(g.name || g.id || '');
}

function attachedPhotoGroupIds(d) {
  const doc = d?.photoGroupAttached;
  if (!doc || doc.skipped) return [];
  if (Array.isArray(doc.groupIds) && doc.groupIds.length) {
    const seen = new Set();
    const out = [];
    for (const id of doc.groupIds) {
      const v = String(id || '').trim();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }
  if (doc.groupId) return [String(doc.groupId)];
  return [];
}

function photoGroupRankOrdinal(n) {
  const v = n % 100;
  const suffix =
    v >= 11 && v <= 13 ? 'th' : v % 10 === 1 ? 'st' : v % 10 === 2 ? 'nd' : v % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

const PHOTO_GROUP_RANK_MAX = 6;

function photoGroupLibraryCount(d) {
  return Array.isArray(d?.photoGroups) ? d.photoGroups.length : 0;
}

function compactPhotoGroupRankIds(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids || []) {
    const v = String(id || '').trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function photoGroupRankLoadButtonId(idPrefix) {
  if (idPrefix === 'cs-pg-select') return 'cs-pg-load';
  if (idPrefix === 'ca-pg-select') return 'ca-pg-load';
  return '';
}

function photoGroupRankStackEl(idPrefix) {
  return document.querySelector(`.pg-rank-stack[data-pg-prefix="${idPrefix}"]`);
}

function photoGroupSelectOptionsHtml(
  d,
  { selectedId = '', excludeIds = [], emptyLabel = 'Select a saved photo group…' } = {},
) {
  const groups = (Array.isArray(d?.photoGroups) ? d.photoGroups : [])
    .slice()
    .sort((a, b) =>
      photoGroupDisplayName(a).localeCompare(photoGroupDisplayName(b), undefined, {
        sensitivity: 'base',
      }),
    );
  const skip = new Set((excludeIds || []).filter((id) => id && id !== selectedId));
  const opts = [`<option value="">${esc(emptyLabel)}</option>`];
  for (const g of groups) {
    if (skip.has(g.id)) continue;
    const n = Number(g.slotCount || 0);
    const ba = Number(g.baPairCount || 0);
    const extra = ba ? ` · ${ba} BA` : '';
    const sel = g.id === selectedId ? ' selected' : '';
    opts.push(
      `<option value="${esc(g.id)}"${sel}>${esc(photoGroupDisplayName(g))} (${n} photos${extra})</option>`,
    );
  }
  return opts.join('');
}

function photoGroupRankRowHtml(idPrefix, i, selectedId, excludeIds) {
  const rank = i + 1;
  const emptyLabel = i === 0 ? 'Select a saved photo group…' : 'None';
  return `<label class="pg-rank-row"><span class="pg-rank-label">${esc(photoGroupRankOrdinal(rank))}</span>
      <select class="pg-select" id="${esc(idPrefix)}-${rank}" data-pg-rank="${rank}" data-tip="Priority ${rank}. All saved groups, A–Z">
        ${photoGroupSelectOptionsHtml(state.detail, { selectedId, excludeIds, emptyLabel })}
      </select></label>`;
}

function photoGroupRankRowsFromIds(idPrefix, ids) {
  const chosen = compactPhotoGroupRankIds(ids).slice(0, PHOTO_GROUP_RANK_MAX);
  const lib = photoGroupLibraryCount(state.detail);
  const addEmpty = chosen.length < PHOTO_GROUP_RANK_MAX && (chosen.length === 0 || chosen.length < lib);
  const rows = [];
  for (let i = 0; i < chosen.length; i += 1) {
    rows.push(photoGroupRankRowHtml(idPrefix, i, chosen[i], chosen.slice(0, i)));
  }
  if (addEmpty) rows.push(photoGroupRankRowHtml(idPrefix, chosen.length, '', chosen));
  return rows.join('');
}

function photoGroupRankSelectsHtml(idPrefix) {
  const attached = attachedPhotoGroupIds(state.detail);
  return `<div class="pg-rank-stack" data-pg-prefix="${esc(idPrefix)}">${photoGroupRankRowsFromIds(idPrefix, attached)}</div>`;
}

function readPhotoGroupRankIds(idPrefix) {
  const stack = photoGroupRankStackEl(idPrefix);
  if (!stack) return [];
  return compactPhotoGroupRankIds(
    [...stack.querySelectorAll('select[data-pg-rank]')].map((sel) => sel.value || ''),
  );
}

function setPhotoGroupRankLoadDisabled(idPrefix, empty) {
  const loadId = photoGroupRankLoadButtonId(idPrefix);
  const loadBtn = loadId ? document.getElementById(loadId) : null;
  if (loadBtn) loadBtn.disabled = empty;
}

function renumberPhotoGroupRankRows(stack, idPrefix) {
  [...stack.querySelectorAll('.pg-rank-row')].forEach((row, i) => {
    const rank = i + 1;
    const label = row.querySelector('.pg-rank-label');
    if (label) label.textContent = photoGroupRankOrdinal(rank);
    const sel = row.querySelector('select[data-pg-rank]');
    if (sel) {
      sel.id = `${idPrefix}-${rank}`;
      sel.setAttribute('data-pg-rank', String(rank));
    }
  });
}

function ensurePhotoGroupTrailingEmpty(stack, idPrefix) {
  const selects = [...stack.querySelectorAll('select[data-pg-rank]')];
  const ids = compactPhotoGroupRankIds(selects.map((sel) => sel.value || ''));
  const last = selects[selects.length - 1];
  const lastEmpty = last && !String(last.value || '').trim();
  const lib = photoGroupLibraryCount(state.detail);
  const canAdd = ids.length < PHOTO_GROUP_RANK_MAX && ids.length < lib;
  if (canAdd && !lastEmpty) {
    stack.insertAdjacentHTML('beforeend', photoGroupRankRowHtml(idPrefix, selects.length, '', ids));
  }
  while (true) {
    const sels = [...stack.querySelectorAll('select[data-pg-rank]')];
    if (sels.length < 2) break;
    const a = sels[sels.length - 1];
    const b = sels[sels.length - 2];
    if (!String(a.value || '').trim() && !String(b.value || '').trim()) {
      a.closest('.pg-rank-row')?.remove();
    } else break;
  }
}

function patchPhotoGroupRankSelects(idPrefix, changedSelect) {
  const stack = photoGroupRankStackEl(idPrefix);
  if (!stack) return;
  if (changedSelect && !String(changedSelect.value || '').trim()) {
    const selects = [...stack.querySelectorAll('select[data-pg-rank]')];
    const isLast = changedSelect === selects[selects.length - 1];
    if (!isLast) {
      changedSelect.closest('.pg-rank-row')?.remove();
      renumberPhotoGroupRankRows(stack, idPrefix);
    }
  }
  ensurePhotoGroupTrailingEmpty(stack, idPrefix);
  setPhotoGroupRankLoadDisabled(idPrefix, readPhotoGroupRankIds(idPrefix).length === 0);
}

function wirePhotoGroupRankSelects(idPrefix) {
  const stack = photoGroupRankStackEl(idPrefix);
  if (!stack) return;
  stack.addEventListener('change', (e) => {
    if (!e.target?.matches?.('select[data-pg-rank]')) return;
    patchPhotoGroupRankSelects(idPrefix, e.target);
  });
  setPhotoGroupRankLoadDisabled(idPrefix, readPhotoGroupRankIds(idPrefix).length === 0);
}

function photoGroupToolbarHtml({ selectId, loadId, saveId, loadLabel, skipId }) {
  const selects = photoGroupRankSelectsHtml(selectId);
  const loadBtn = `<button type="button" class="btn pg-load" id="${esc(loadId)}" disabled>${esc(loadLabel)}</button>`;
  if (skipId) {
    return `<div class="photo-group-toolbar">
      ${selects}
      <button type="button" class="btn pg-skip" id="${esc(skipId)}">Skip</button>
      ${loadBtn}
    </div>`;
  }
  return `<div class="flex-wrap gap-2" style="display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center">
      ${selects}
      ${loadBtn}
      ${
        saveId
          ? `<button type="button" class="btn" id="${esc(saveId)}" data-tip="Save this site’s stock photos, uploads, and ChatGPT before/after pairs">Save photo group</button>`
          : ''
      }
    </div>`;
}

/**
 * Optional shortcut next to Copy prompt controls.
 * @param {{ disabled?: boolean, sm?: boolean, id?: string, tip?: string }} [opts]
 */
function openClaudeAiBtnHtml({ disabled = false, sm = false, id = '', tip = '' } = {}) {
  const tipText =
    tip ||
    'Optional — open Claude.ai in a new tab. Does not copy the prompt or change this step.';
  const tipHtml = tipAttr(tipText);
  const idAttr = id ? ` id="${esc(id)}"` : '';
  const cls = `btn${sm ? ' btn-sm' : ''} open-claude-ai`;
  if (disabled) {
    return `<span class="${cls}" aria-disabled="true"${idAttr} ${tipHtml}>Open Claude.ai</span>`;
  }
  return `<a class="${cls}" href="https://claude.ai" target="_blank" rel="noopener noreferrer"${idAttr} ${tipHtml}>Open Claude.ai</a>`;
}

function photoGroupPreviewBodyHtml(preview, { attach = false } = {}) {
  const unused = Number(preview?.unused || 0);
  const empty = Number(preview?.targetEmpty || 0);
  const similar = Number(preview?.similarTray || 0);
  const trayTotal = Number(preview?.tray || 0) + Number(preview?.baTray || 0);
  const leftover = Math.max(0, trayTotal - similar);
  const names = Array.isArray(preview?.groups) && preview.groups.length
    ? preview.groups.map((g) => g.name || g.id).join(' → ')
    : preview?.group?.name || 'this group';
  const rankNote =
    Array.isArray(preview?.groups) && preview.groups.length > 1
      ? ' First group fills matching slots; later groups fill leftovers. Empty slots take the first tray still as live; extras stay on trays.'
      : '';
  return `<p>${
    attach
      ? 'Accept will copy these files instead of pulling stock. Logo and coverage map still generate.'
      : 'Replaces matching Review images on this site. Empty slots take the first matching tray still as live. Leftover matching photos stay in each slot’s tray. Similar titles also go to trays (a before/after pair can appear on every similar service) — click Use to apply.'
  }${rankNote}</p>
    <p>Group <strong>${esc(names)}</strong>${
      preview?.group?.niche ? ` · ${esc(preview.group.niche)}` : ''
    }.</p>
    <ul class="narrative-list">
      <li>${esc(String(preview?.applied || 0))} stock slots will be filled</li>
      <li>${esc(String(preview?.baApplied || 0))} ChatGPT before/after pairs</li>
      ${
        leftover
          ? `<li>${esc(String(leftover))} leftover matching photos added to trays</li>`
          : ''
      }
      ${
        similar
          ? `<li>${esc(String(similar))} similar titles added to trays</li>`
          : ''
      }
      ${
        unused
          ? `<li>${esc(String(unused))} saved photos unused (no matching or similar slot)</li>`
          : ''
      }
      ${
        empty
          ? `<li>${esc(String(empty))} slots on this site stay empty</li>`
          : ''
      }
    </ul>`;
}

async function savePhotoGroupFromUi(candidateId, { refresh, nextStep, tab } = {}) {
  let nameInput = null;
  const niche = state.detail?.siteConfig?.niche || state.detail?.config?.niche || '';
  const ok = await showModal({
    title: 'Save photo group',
    confirmLabel: 'Save',
    bodyHtml: `<p>Saves stock photos, uploads, and ChatGPT before/after pairs for <strong>${esc(
      niche || 'this niche',
    )}</strong>.</p>
      <label class="modal-type-confirm-label"><span class="muted small">Group name</span>
      <input id="pg-save-name" class="modal-type-confirm-input" type="text" autocomplete="off" /></label>`,
    afterOpen: (body) => {
      nameInput = body.querySelector('#pg-save-name');
      nameInput?.focus();
    },
  });
  if (!ok) return;
  const name = String(nameInput?.value || '').trim();
  if (!name) {
    await showModal({
      title: 'Name required',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: '<p>Enter a name for this photo group.</p>',
    });
    return;
  }
  const post = (replaceExisting) =>
    api(`/api/candidates/${encodeURIComponent(candidateId)}/photo-groups`, {
      method: 'POST',
      body: JSON.stringify({ name, replaceExisting }),
    });
  try {
    let result;
    try {
      result = await withReviewImagesWork({ label: 'Saving photo group…' }, () => post(false));
    } catch (error) {
      if (error.status !== 409) throw error;
      const replace = await showModal({
        title: 'Replace existing group?',
        confirmLabel: 'Replace',
        danger: true,
        bodyHtml: `<p>${esc(error.message)}</p><p>Replace the saved files with this site’s current photos?</p>`,
      });
      if (!replace) return;
      result = await withReviewImagesWork({ label: 'Saving photo group…' }, () => post(true));
    }
    if (refresh) await refresh(result.candidate, nextStep, tab);
    showToast(`Saved photo group “${result.group?.name || name}”.`);
  } catch (error) {
    await showModal({
      title: 'Save photo group failed',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
  }
}

async function loadPhotoGroupFromUi(
  candidateId,
  selectId,
  { attach = false, refresh, nextStep, tab } = {},
) {
  const groupIds = readPhotoGroupRankIds(selectId);
  if (!groupIds.length) {
    await showModal({
      title: 'Pick a photo group',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: '<p>Select at least one saved photo group (1st) to load.</p>',
    });
    return;
  }
  try {
    const preview = await withReviewImagesWork({ label: 'Loading photo groups…' }, () =>
      api(
        `/api/candidates/${encodeURIComponent(candidateId)}/photo-groups/preview`,
        {
          method: 'POST',
          body: JSON.stringify({ groupIds }),
        },
      ),
    );
    const ok = await showModal({
      title: attach ? 'Load photo group on Accept?' : 'Load photo group?',
      confirmLabel: attach ? 'Load on Accept' : 'Replace photos',
      bodyHtml: photoGroupPreviewBodyHtml(preview, { attach }),
    });
    if (!ok) return;
    if (
      !(await confirmLaunchedSiteChange(attach ? 'Attach photo group' : 'Load photo group'))
    ) {
      return;
    }
    const result = await withReviewImagesWork({ label: 'Loading photo group…' }, async () => {
      const loaded = await api(
        `/api/candidates/${encodeURIComponent(candidateId)}/photo-groups/${
          attach ? 'attach' : 'load'
        }`,
        {
          method: 'POST',
          body: JSON.stringify(withLaunchedConfirmBody({ groupIds })),
        },
      );
      if (refresh) await refresh(loaded.candidate, nextStep, tab);
      if (!attach) {
        await refreshImageSlotsGrid(candidateId);
      }
      return loaded;
    });
    const label =
      result.attached?.names?.join(' → ') ||
      preview.groups?.map((g) => g.name).join(' → ') ||
      preview.group?.name;
    announceBanner(
      attach
        ? `Photo group “${label}” ready for Accept.`
        : result.human?.[0] || 'Photo group loaded.',
    );
  } catch (error) {
    await showModal({
      title: attach ? 'Photo group failed' : 'Load photo group failed',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
  }
}

/** Advisory speech-lint findings for Content → Editor panel */
function speechLintFindingsHtml(speechLint) {
  if (!speechLint) return '';
  const findings = speechLint.findings || [];
  if (!findings.length) {
    return `<div class="callout"><strong>Speech/SEO Refinement:</strong> No speech flags.</div>`;
  }
  const items = findings
    .slice(0, 25)
    .map((f) => {
      const where = [f.file, f.section].filter(Boolean).map((x) => esc(String(x))).join(' · ');
      return `<li><code>${esc(f.rule || 'flag')}</code>${where ? ` · ${where}` : ''}<br><span class="muted">${esc(
        f.excerpt || '',
      )}</span>${f.suggestion ? `<br>${esc(f.suggestion)}` : ''}</li>`;
    })
    .join('');
  const more =
    findings.length > 25
      ? `<p class="muted">Showing 25 of ${esc(String(findings.length))}.</p>`
      : '';
  return `<details class="narrative-raw lint-findings"><summary><strong>Speech:</strong> ${esc(
    String(findings.length),
  )} finding(s)</summary><ul class="speech-lint-list">${items}</ul>${more}</details>`;
}

/** SEO lint findings (critical vs soft) */
function seoLintFindingsHtml(seoLint) {
  if (!seoLint) return '';
  const findings = seoLint.findings || [];
  if (!findings.length) {
    return `<div class="callout"><strong>Speech/SEO Refinement:</strong> No SEO flags.</div>`;
  }
  const critical = findings.filter((f) => f.severity === 'critical');
  const items = findings
    .slice(0, 25)
    .map((f) => {
      const sev = f.severity === 'critical' ? 'critical' : 'soft';
      return `<li><code>${esc(sev)}</code> · <code>${esc(f.rule || 'flag')}</code> · ${esc(
        f.file || '',
      )}<br><span class="muted">${esc(f.excerpt || '')}</span>${
        f.suggestion ? `<br>${esc(f.suggestion)}` : ''
      }</li>`;
    })
    .join('');
  const critNote = critical.length
    ? ` · ${esc(String(critical.length))} critical`
    : '';
  return `<details class="narrative-raw lint-findings"><summary><strong>SEO:</strong> ${esc(
    String(findings.length),
  )} finding(s)${critNote}</summary><ul class="speech-lint-list">${items}</ul></details>`;
}

function autoFixSummaryHtml(autoFix) {
  if (!autoFix?.changeCount) return '';
  const changes = autoFix.changes || [];
  const speech = changes.filter((c) => (c.kind || kindFromRule(c.rule)) === 'speech');
  const seo = changes.filter((c) => (c.kind || kindFromRule(c.rule)) === 'seo');
  const speechN = autoFix.speechCount ?? speech.length;
  const seoN = autoFix.seoCount ?? seo.length;

  const list = (rows) =>
    rows
      .slice(0, 20)
      .map(
        (c) =>
          `<li><code>${esc(c.rule || '')}</code> · ${esc(c.file || '')}<br><span class="muted">${esc(
            c.detail || '',
          )}</span></li>`,
      )
      .join('');

  const speechBlock = speech.length
    ? `<p class="muted" style="margin:0.5rem 0 0.25rem"><strong>Speech</strong> (${esc(
        String(speechN),
      )})</p><ul class="speech-lint-list">${list(speech)}</ul>`
    : '';
  const seoBlock = seo.length
    ? `<p class="muted" style="margin:0.5rem 0 0.25rem"><strong>SEO</strong> (${esc(
        String(seoN),
      )})</p><ul class="speech-lint-list">${list(seo)}</ul>`
    : '';

  return `<details class="narrative-raw" open><summary>Auto-fixed ${esc(
    String(autoFix.changeCount),
  )} issue(s) (${esc(String(speechN))} speech · ${esc(String(seoN))} SEO)</summary>${speechBlock}${seoBlock}</details>`;
}

function kindFromRule(rule) {
  return rule === 'missing_internal_link' ? 'seo' : 'speech';
}

/**
 * Claude editor rewrite is recommended when speech leftovers, Critical SEO, or soft SEO remain.
 * @param {object|null|undefined} draftOrLints - content draft, or { speechLint, seoLint }
 */
function contentNeedsEditorRewrite(draftOrLints) {
  const speechLint = draftOrLints?.speechLint || draftOrLints?._ops?.speechLint;
  const seoLint = draftOrLints?.seoLint || draftOrLints?._ops?.seoLint;
  const speechN = speechLint?.findings?.length || 0;
  const criticalSeoN = (seoLint?.findings || []).filter((f) => f.severity === 'critical').length;
  const softSeoN = (seoLint?.findings || []).filter((f) => f.severity !== 'critical').length;
  const advisoryN = speechN + softSeoN;
  return {
    needed: speechN > 0 || criticalSeoN > 0 || softSeoN > 0,
    speechN,
    criticalSeoN,
    softSeoN,
    advisoryN,
    softOnly: softSeoN > 0 && speechN === 0 && criticalSeoN === 0,
  };
}

function lintSevDotHtml(tone, count, tip) {
  if (!count) return '';
  const cls = tone === 'critical' ? 'lint-sev-dot lint-sev-critical' : 'lint-sev-dot lint-sev-advisory';
  return `<span class="lint-sev-count" ${tipAttr(tip)}><span class="${cls}" aria-hidden="true"></span><span class="lint-sev-n">${esc(
    String(count),
  )}</span></span>`;
}

function editorRewriteWhyHtml(needs, workflowHtml) {
  if (!needs?.needed) return '';
  const bits = [];
  if (needs.speechN) {
    bits.push(
      `${esc(String(needs.speechN))} speech leftover(s) auto-fix could not safely clear`,
    );
  }
  if (needs.criticalSeoN) {
    bits.push(
      `${esc(String(needs.criticalSeoN))} Critical SEO finding(s) that block Accept unless overridden`,
    );
  }
  if (needs.softSeoN) {
    bits.push(`${esc(String(needs.softSeoN))} soft SEO finding(s) (recommended Claude pass)`);
  }
  const label = needs.softOnly ? 'Claude rewrite recommended' : 'Claude rewrite needed';
  const dots = [
    lintSevDotHtml(
      'advisory',
      needs.advisoryN,
      'Advisory — Accept allowed; Claude pass recommended',
    ),
    lintSevDotHtml(
      'critical',
      needs.criticalSeoN,
      'Critical SEO — blocks Accept unless overridden',
    ),
  ]
    .filter(Boolean)
    .join('');
  return `<div class="callout warn editor-rewrite-why">
    <div class="editor-rewrite-status"><strong>${label}:</strong>${
      dots ? ` <span class="lint-sev-dots">${dots}</span>` : ''
    } ${bits.join(' · ')}</div>
    <p class="editor-rewrite-workflow muted">${
      workflowHtml ||
      'Copy the editor prompt → fix in Claude.ai → paste FILE blocks → Load, then Speech/SEO Refinement again.'
    }</p>
  </div>`;
}

function speechCheckResultBodyHtml({ speechLint, seoLint, autoFix }) {
  const needs = contentNeedsEditorRewrite({ speechLint, seoLint });
  const speechN = needs.speechN;
  const fixN = autoFix?.changeCount || 0;
  const fixSpeech = autoFix?.speechCount ?? 0;
  const fixSeo = autoFix?.seoCount ?? 0;
  const fixLine = fixN
    ? `<p class="muted">Auto-fixed ${esc(String(fixN))} (${esc(String(fixSpeech))} speech · ${esc(
        String(fixSeo),
      )} SEO).</p>`
    : '<p class="muted">No auto-fixes needed this pass.</p>';

  if (!needs.needed) {
    return `<p><strong>No rewrite needed.</strong> Speech leftovers and SEO flags are clear.</p>${fixLine}<p><strong>Up next:</strong> <strong>Final check</strong>.</p>`;
  }

  if (needs.softOnly) {
    return `<p><strong>Recommended Claude pass for soft SEO.</strong></p>
    <p>${esc(String(needs.softSeoN))} soft SEO flag(s) remain (advisory — Accept is not blocked).</p>
    ${fixLine}
    <p>Use <strong>Copy editor prompt</strong> on this step → Claude.ai → paste revised FILE blocks → Load. Or Accept now if you are fine shipping with soft flags.</p>`;
  }

  const bits = [];
  if (speechN) bits.push(`${esc(String(speechN))} speech leftover(s)`);
  if (needs.criticalSeoN) bits.push(`${esc(String(needs.criticalSeoN))} Critical SEO`);
  if (needs.softSeoN) bits.push(`${esc(String(needs.softSeoN))} soft SEO`);
  return `<p><strong>Additional Claude pass needed.</strong></p>
    <p>${bits.join(' · ')}.</p>
    ${fixLine}
    <p>Rover auto-fix cleared what it could safely. Use <strong>Copy editor prompt</strong> on this step → Claude.ai → paste revised FILE blocks → Load.${
      needs.criticalSeoN
        ? ' Critical SEO blocks Accept until fixed (or you override on Accept).'
        : ' You can still Accept if only speech leftovers remain.'
    }</p>`;
}

function firstIncompleteContentStep(flags, { photosOn = true } = {}) {
  if (!flags.structure) return 'structure';
  if (!flags.fieldResearch) return 'fieldResearch';
  if (!flags.brief) return 'brief';
  if (!flags.outline) return 'outline';
  if (!flags.write) return 'write';
  if (!flags.editor) return 'editor';
  if (!flags.finalCheck) return 'finalCheck';
  if (photosOn) {
    if (!flags.imageQueries) return 'imageQueries';
    if (!flags.photoGroup) return 'photoGroup';
  }
  if (!flags.accepted) return 'accept';
  return 'accept';
}

function contentPhotosEnabled(d) {
  return Object.values(d?.contentStructure?.photos || {}).some((p) => p && p.enabled);
}

function contentImageQueriesLoaded(d) {
  return Boolean(
    d?.imagesPlan?.loadedAt ||
      d?.contentDraft?._ops?.lastImagesPlanAt ||
      d?.content?._ops?.lastImagesPlanAt,
  );
}

function contentPhotoGroupSettled(d) {
  const attached = Boolean(d?.photoGroupAttached?.groupId);
  return attached || (Boolean(d?.photoGroupAttached?.skipped) && !attached);
}

/** Next Content step after Final check (Image queries → photo group → Accept). */
function nextContentStepAfterFinal(d) {
  if (contentPhotosEnabled(d)) {
    if (!contentImageQueriesLoaded(d)) return 'imageQueries';
    if (!contentPhotoGroupSettled(d)) return 'photoGroup';
  }
  return 'accept';
}

function nextContentStepAfterImages(d) {
  if (contentPhotosEnabled(d) && !contentPhotoGroupSettled(d)) return 'photoGroup';
  return 'accept';
}

function contentUpNextHtml(stepDone, ready, { secCount = 0, outlineConfirmed = false, outlineDrafted = false, photosOn = true, apiMode = false, writeSiteDone = false } = {}) {
  if (!ready) {
    return `<div class="callout warn">Accept <strong>Site config</strong> first (business NAP, services, suburbs).</div>`;
  }
  const structureBits = [
    'Structure checklist',
    secCount ? `${esc(String(secCount))} sections` : '',
    outlineConfirmed ? 'outline confirmed' : outlineDrafted ? 'outline drafted' : '',
    stepDone.accepted ? 'content accepted' : stepDone.write ? 'draft ready' : '',
  ].filter(Boolean);
  const structureLine = structureBits.join(' · ');

  if (stepDone.accepted) {
    return statusLineHtml(structureLine);
  }

  if (apiMode) {
    let apiNext = '';
    if (!stepDone.structure) {
      apiNext = 'Up next: <strong>Structure</strong> — pages + sections → Continue';
    } else if (!writeSiteDone) {
      apiNext = 'Up next: <strong>Write site with Claude</strong> — confirm cost, then wait on the overlay';
    } else if (photosOn && !stepDone.photoGroup) {
      apiNext =
        'Up next: <strong>Load photo group</strong> — Load a saved group or Skip, then Accept';
    } else {
      apiNext =
        'Up next: <strong>Accept content</strong> — then <strong>Website → Prepare preview</strong>';
    }
    return statusLineHtml(`${apiNext}${structureLine ? ` · ${structureLine}` : ''}`);
  }

  let upNext = '';
  if (!stepDone.structure) {
    upNext = 'Up next: <strong>Structure</strong> — pages + sections → Continue';
  } else if (!stepDone.fieldResearch) {
    upNext =
      'Up next: <strong>Site research</strong> — Copy field-research prompt → Claude.ai → Load';
  } else if (!stepDone.brief) {
    upNext =
      'Up next: <strong>Content brief</strong> — Copy brief prompt → Claude.ai → Load &amp; confirm';
  } else if (!stepDone.outline) {
    upNext =
      'Up next: <strong>Outline</strong> — Copy structure prompt → Claude.ai → Load &amp; confirm';
  } else if (!stepDone.write) {
    upNext =
      'Up next: <strong>Full write (batched)</strong> — Home / Services / Locations → Load FILE';
  } else if (!stepDone.editor) {
    upNext =
      'Up next: <strong>Humanize</strong> — Speech/SEO Refinement (Load FILE auto-runs lint)';
  } else if (!stepDone.finalCheck) {
    upNext =
      'Up next: <strong>Final check</strong> — Copy final-check prompt → Load OK / FILE fixes';
  } else if (photosOn && !stepDone.imageQueries) {
    upNext =
      'Up next: <strong>Image queries</strong> — Copy prompt → paste JSON → Load';
  } else if (photosOn && !stepDone.photoGroup) {
    upNext =
      'Up next: <strong>Load photo group</strong> — Load a saved group or Skip, then Accept';
  } else {
    upNext =
      'Up next: <strong>Accept content</strong> — then <strong>Website → Prepare preview</strong>';
  }
  return statusLineHtml(`${upNext}${structureLine ? ` · ${structureLine}` : ''}`);
}

function contentPassStripHtml(stepDone, currentId, { photosOn = true, apiMode = false } = {}) {
  const labels = apiMode
    ? [
        ['structure', 'Structure'],
        ['writeSite', 'Write site'],
        ...(photosOn ? [['photoGroup', 'Group']] : []),
        ['accept', 'Accept'],
      ]
    : [
        ['structure', 'Structure'],
        ['fieldResearch', 'Site research'],
        ['brief', 'Brief'],
        ['outline', 'Outline'],
        ['write', 'Write'],
        ['editor', 'Humanize'],
        ['finalCheck', 'Final'],
        ...(photosOn
          ? [
              ['imageQueries', 'Images'],
              ['photoGroup', 'Group'],
            ]
          : []),
        ['accept', 'Accept'],
      ];
  const chips = labels
    .map(([id, label]) => {
      const done = Boolean(stepDone[id]);
      const cur = currentId === id && !done;
      const cls = done ? 'is-done' : cur ? 'is-current' : 'is-todo';
      return `<span class="content-pass-chip ${cls}">${done ? '✓ ' : ''}${esc(label)}</span>`;
    })
    .join('<span class="content-pass-sep">→</span>');
  return `<div class="content-pass-strip" aria-label="Content pass progress">${chips}</div>`;
}

function roverJobOverlayHtml({
  overlayId,
  title,
  titleId,
  phases,
  phaseAttr = 'data-ws-phase',
  phasesId,
  barId,
  detailId,
  stopId,
  ariaLabel,
} = {}) {
  const items = (phases || [])
    .map((p) => `<li ${phaseAttr}="${esc(p)}">${esc(p)}</li>`)
    .join('');
  const stop = stopId
    ? `<button type="button" class="btn" id="${esc(stopId)}">Stop</button>`
    : '';
  return `<div id="${esc(overlayId)}" class="content-claude-job-overlay hidden" hidden aria-hidden="true">
    <div class="rover-loading-card">
      <div class="rover-loader rover-loader--dark" role="img" aria-label="${esc(ariaLabel || title || 'Working')}">
        <svg class="rover-loader-mark" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true">
          <circle class="rover-loader-dot" cx="32" cy="32" r="7.5" />
          <g class="rover-loader-ring rover-loader-ring--inner">
            <circle cx="32" cy="32" r="15" transform="rotate(-45 32 32)" />
          </g>
          <g class="rover-loader-ring rover-loader-ring--outer">
            <circle cx="32" cy="32" r="24" transform="rotate(-11 32 32)" />
          </g>
        </svg>
        <img class="rover-loader-word" src="/brand/rover-wordmark-dark.png" alt="" width="618" height="81" decoding="async" />
      </div>
      <p class="rover-loading-text" id="${esc(titleId)}">${esc(title)}</p>
      <ol class="ws-overlay-phases" id="${esc(phasesId)}">${items}</ol>
      <div class="job-progress" style="width:min(22rem,90%)">
        <div class="job-progress-track"><div class="job-progress-bar" id="${esc(barId)}"></div></div>
      </div>
      <p class="muted small" id="${esc(detailId)}">Starting…</p>
      ${stop}
    </div>
  </div>`;
}

const WEBSITE_JOB_OVERLAY_IDS = [
  'website-prepare-overlay',
  'website-ship-overlay',
  'website-launch-overlay',
];

function setRoverJobOverlayVisible(overlayId, visible) {
  const overlay = document.getElementById(overlayId);
  if (!overlay) return;
  overlay.classList.toggle('hidden', !visible);
  overlay.hidden = !visible;
  overlay.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (visible) syncJobOverlayTop();
}

function hideWebsiteJobOverlaysExcept(keepId) {
  for (const id of WEBSITE_JOB_OVERLAY_IDS) {
    if (id !== keepId) setRoverJobOverlayVisible(id, false);
  }
}

function paintRoverJobOverlay({ overlayId, detailId, barId, phasesId, stopId, job } = {}) {
  setRoverJobOverlayVisible(overlayId, true);
  const overlay = document.getElementById(overlayId);
  if (overlay && job?.id) overlay.dataset.jobId = job.id;
  const detail = String(job?.detail || 'Working…');
  const detailEl = document.getElementById(detailId);
  if (detailEl) detailEl.textContent = detail;
  const stopBtn = stopId ? document.getElementById(stopId) : null;
  if (stopBtn) stopBtn.disabled = /stopping/i.test(detail);
  const bar = document.getElementById(barId);
  const total = Number(job?.progressTotal);
  const done = Number(job?.progressDone);
  if (bar && Number.isFinite(total) && total > 0) {
    setDeterminateProgress(bar, { done: Number.isFinite(done) ? done : 0, total });
  } else if (bar) {
    setDeterminateProgress(bar, {});
  }
  const currentN = Number.isFinite(done) ? done : 0;
  document.querySelectorAll(`#${phasesId} li`).forEach((li, i) => {
    const n = i + 1;
    li.classList.toggle('is-current', currentN > 0 && n === currentN);
    li.classList.toggle('is-done', currentN > 0 && n < currentN);
  });
}

function writeSiteOverlayHtml(photosOn = true) {
  const phases = photosOn
    ? ['Research', 'Plan', 'Write', 'Polish', 'Image queries']
    : ['Research', 'Plan', 'Write', 'Polish'];
  return roverJobOverlayHtml({
    overlayId: 'content-write-site-overlay',
    title: 'Write site with Claude',
    titleId: 'ws-overlay-title',
    phases,
    phaseAttr: 'data-ws-phase',
    phasesId: 'ws-overlay-phases',
    barId: 'ws-overlay-bar',
    detailId: 'ws-overlay-detail',
    stopId: 'ws-overlay-stop',
    ariaLabel: 'Writing site',
  });
}

const ACCEPT_OVERLAY_PHASES = ['Write files', 'Photos', 'Logo', 'Coverage map'];

function acceptOverlayHtml() {
  return roverJobOverlayHtml({
    overlayId: 'content-accept-overlay',
    title: 'Accept content',
    titleId: 'ac-overlay-title',
    phases: ACCEPT_OVERLAY_PHASES,
    phaseAttr: 'data-ac-phase',
    phasesId: 'ac-overlay-phases',
    barId: 'ac-overlay-bar',
    detailId: 'ac-overlay-detail',
    ariaLabel: 'Accepting content',
  });
}

function shortenLaunchPhase(step) {
  const s = String(step || '');
  if (/keys|site-config/i.test(s)) return 'Keys';
  if (/GitHub/i.test(s)) return 'GitHub';
  if (/npm install|build/i.test(s)) return 'Build';
  if (/Wrangler/i.test(s)) return 'Deploy';
  if (/Workers Builds/i.test(s)) return 'Workers';
  if (/Cloudflare/i.test(s)) return 'Cloudflare';
  return s.replace(/…/g, '').trim() || 'Launch';
}

function launchOverlayPhaseLabels(body = {}) {
  return launchProgressStepsFromForm(body).map(shortenLaunchPhase);
}

const PREPARE_OVERLAY_PHASES = ['Staging', 'Stop preview', 'Assemble', 'Build', 'Preview'];

function launchOverlayHtml() {
  const phases =
    Array.isArray(state._launchOverlayPhases) && state._launchOverlayPhases.length
      ? state._launchOverlayPhases
      : ['Keys', 'GitHub', 'Build', 'Deploy', 'Workers', 'Cloudflare'];
  return roverJobOverlayHtml({
    overlayId: 'website-launch-overlay',
    title: 'Run launch',
    titleId: 'ln-overlay-title',
    phases,
    phaseAttr: 'data-ln-phase',
    phasesId: 'ln-overlay-phases',
    barId: 'ln-overlay-bar',
    detailId: 'ln-overlay-detail',
    ariaLabel: 'Launching site',
  });
}

function prepareOverlayHtml() {
  return roverJobOverlayHtml({
    overlayId: 'website-prepare-overlay',
    title: 'Prepare preview',
    titleId: 'pr-overlay-title',
    phases: PREPARE_OVERLAY_PHASES,
    phaseAttr: 'data-pr-phase',
    phasesId: 'pr-overlay-phases',
    barId: 'pr-overlay-bar',
    detailId: 'pr-overlay-detail',
    ariaLabel: 'Preparing preview',
  });
}

function shipOverlayHtml() {
  const phases =
    Array.isArray(state._shipOverlayPhases) && state._shipOverlayPhases.length
      ? state._shipOverlayPhases
      : ['GitHub', 'Build', 'Deploy', 'Workers'];
  return roverJobOverlayHtml({
    overlayId: 'website-ship-overlay',
    title: 'Push updates',
    titleId: 'sh-overlay-title',
    phases,
    phaseAttr: 'data-sh-phase',
    phasesId: 'sh-overlay-phases',
    barId: 'sh-overlay-bar',
    detailId: 'sh-overlay-detail',
    ariaLabel: 'Pushing updates',
  });
}

function setWriteSiteOverlayVisible(visible) {
  setRoverJobOverlayVisible('content-write-site-overlay', visible);
}

function syncWriteSiteOverlay(snap) {
  const cid = state.selectedId;
  const job = findActiveJob(snap, 'write-site', cid);
  const overlay = document.getElementById('content-write-site-overlay');
  if (job) {
    state._writeSiteTrack = { candidateId: job.candidateId, jobId: job.id };
    paintRoverJobOverlay({
      overlayId: 'content-write-site-overlay',
      detailId: 'ws-overlay-detail',
      barId: 'ws-overlay-bar',
      phasesId: 'ws-overlay-phases',
      stopId: 'ws-overlay-stop',
      job,
    });
    return;
  }
  setWriteSiteOverlayVisible(false);
  const track = state._writeSiteTrack;
  if (!track) return;
  const finished = (snap?.jobs || []).find((j) => String(j.id) === String(track.jobId));
  const stillElsewhere =
    finished && (finished.status === 'running' || finished.status === 'queued');
  if (stillElsewhere) return;
  if (state._writeSiteHandledJobId === track.jobId) return;
  state._writeSiteHandledJobId = track.jobId;
  state._writeSiteTrack = null;
  const targetId = track.candidateId;
  void (async () => {
    if (state.selectedId === targetId) {
      try {
        await applyCandidatePayload(null, targetId);
        const candidate = state.detail;
        if (state.tab === 'content') {
          if (finished?.status === 'done') {
            const photosOn = contentPhotosEnabled(candidate);
            advancePanelStep('content', photosOn ? 'photoGroup' : 'accept');
          }
          renderDetail();
        }
      } catch {
        /* ignore */
      }
    }
    if (finished?.status === 'done') {
      announceStepComplete('Write site');
    } else if (finished?.status === 'error' || !finished) {
      const msg = finished?.error || 'Write site stopped or failed.';
      if (/stopped/i.test(msg)) {
        announceBanner('Write site stopped — files written so far are kept.');
      } else {
        announceBanner('Write site failed', { tone: 'err' });
        await showModal({
          title: 'Write site failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(msg)}</p>${
            finished?.speechLint
              ? speechLintFindingsHtml(finished.speechLint)
              : ''
          }`,
        });
      }
    }
  })();
}

function snapWithOptimisticWriteSite(jobId, candidateId) {
  const jobs = [...(state.lightJobsSnap?.jobs || [])];
  if (!jobs.some((j) => String(j.id) === String(jobId))) {
    jobs.unshift({
      id: jobId,
      candidateId,
      phase: 'write-site',
      label: 'Write site',
      status: 'running',
      detail: 'Starting…',
      progressDone: 0,
      progressTotal: 5,
    });
  }
  return { ...(state.lightJobsSnap || {}), jobs };
}

async function startWriteSiteFromUi(id) {
  if (!(await confirmPaidAction('write-site'))) return;
  if (!(await confirmLaunchedSiteChange('Write site with Claude'))) return;
  try {
    const accepted = await api(`/api/candidates/${encodeURIComponent(id)}/content/write-site`, {
      method: 'POST',
      body: JSON.stringify(withLaunchedConfirmBody({})),
    });
    state._writeSiteHandledJobId = null;
    state._writeSiteTrack = { candidateId: id, jobId: accepted.jobId };
    syncWriteSiteOverlay(snapWithOptimisticWriteSite(accepted.jobId, id));
    syncClaudeModeToggle();
  } catch (error) {
    if (error.code === 'WRITE_SITE_RUNNING' && error.jobId) {
      state._writeSiteTrack = { candidateId: id, jobId: error.jobId };
      syncWriteSiteOverlay(snapWithOptimisticWriteSite(error.jobId, id));
      return;
    }
    if (error.code === 'WRITE_SITE_CAP' || error.code === 'WRITE_SITE_BUSY') {
      if (error.code === 'WRITE_SITE_CAP') {
        await explainConcurrencyLimit({
          key: 'writeSite',
          running: error.running,
          limit: error.limit ?? state.concurrency?.writeSite ?? 6,
        });
        return;
      }
      await showModal({
        title: 'Write site already running',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>Write site is already running for <code>${esc(
          error.candidateId || 'another candidate',
        )}</code>. Watch Light, or open that candidate’s Content tab to Stop.</p>`,
      });
      return;
    }
    await showModal({
      title: 'Write site failed to start',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
  }
}

function snapWithOptimisticAccept(candidateId) {
  const jobs = [...(state.lightJobsSnap?.jobs || [])];
  if (!jobs.some((j) => j.phase === 'accept' && String(j.candidateId) === String(candidateId) && (j.status === 'running' || j.status === 'queued'))) {
    jobs.unshift({
      id: 'optimistic-accept',
      candidateId,
      phase: 'accept',
      label: 'Accept',
      status: 'running',
      detail: 'Starting…',
      progressDone: 0,
      progressTotal: 4,
    });
  }
  return { ...(state.lightJobsSnap || {}), jobs };
}

function syncAcceptOverlay(snap) {
  const cid = state.selectedId;
  const job = findActiveJob(snap, 'accept', cid);
  if (job) {
    paintRoverJobOverlay({
      overlayId: 'content-accept-overlay',
      detailId: 'ac-overlay-detail',
      barId: 'ac-overlay-bar',
      phasesId: 'ac-overlay-phases',
      job,
    });
    return;
  }
  if (state._acceptHold) {
    setRoverJobOverlayVisible('content-accept-overlay', true);
    return;
  }
  setRoverJobOverlayVisible('content-accept-overlay', false);
}

function showAcceptOverlayStarting() {
  state._acceptHold = true;
  syncAcceptOverlay(snapWithOptimisticAccept(state.selectedId));
}

function hideAcceptOverlay() {
  state._acceptHold = false;
  setRoverJobOverlayVisible('content-accept-overlay', false);
}

function discoveryPackLightId(batchId) {
  return `discovery:${String(batchId || '').trim()}`;
}

function findActiveGeneratePackJob(snap, batchId) {
  const bid = String(batchId || '');
  const key = discoveryPackLightId(bid);
  return (snap?.jobs || []).find(
    (j) =>
      String(j.phase || '') === 'generate-pack' &&
      (j.status === 'running' || j.status === 'queued') &&
      (String(j.batchId || '') === bid || String(j.candidateId || '') === key),
  );
}

function setGeneratePackOverlayVisible(visible) {
  const overlay = document.getElementById('discovery-generate-pack-overlay');
  if (!overlay) return;
  overlay.classList.toggle('hidden', !visible);
  overlay.hidden = !visible;
  overlay.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (visible) syncJobOverlayTop();
}

function syncGeneratePackOverlay(snap) {
  const bid = state.discoveryBatchId;
  const job = bid ? findActiveGeneratePackJob(snap, bid) : null;
  const overlay = document.getElementById('discovery-generate-pack-overlay');
  if (job) {
    state._generatePackTrack = { batchId: job.batchId || bid, jobId: job.id };
    if (overlay) overlay.dataset.jobId = job.id;
    setGeneratePackOverlayVisible(Boolean(overlay) && state.view === 'discovery');
    const detail = String(job.detail || 'Working…');
    const detailEl = document.getElementById('gp-overlay-detail');
    if (detailEl) detailEl.textContent = detail;
    const stopBtn = document.getElementById('gp-overlay-stop');
    if (stopBtn) stopBtn.disabled = /stopping/i.test(detail);
    const bar = document.getElementById('gp-overlay-bar');
    const total = Number(job.progressTotal);
    const done = Number(job.progressDone);
    if (bar && Number.isFinite(total) && total > 0) {
      setDeterminateProgress(bar, { done: Number.isFinite(done) ? done : 0, total });
    }
    const currentN = Number.isFinite(done) ? done : 0;
    document.querySelectorAll('#gp-overlay-phases [data-gp-phase]').forEach((li, i) => {
      const n = i + 1;
      li.classList.toggle('is-current', currentN > 0 && n === currentN);
      li.classList.toggle('is-done', currentN > 0 && n < currentN);
    });
    return;
  }
  setGeneratePackOverlayVisible(false);
  const track = state._generatePackTrack;
  if (!track) return;
  const finished = (snap?.jobs || []).find((j) => String(j.id) === String(track.jobId));
  const stillElsewhere =
    finished && (finished.status === 'running' || finished.status === 'queued');
  if (stillElsewhere) return;
  if (state._generatePackHandledJobId === track.jobId) return;
  state._generatePackHandledJobId = track.jobId;
  state._generatePackTrack = null;
  const targetBatch = track.batchId;
  void (async () => {
    if (targetBatch && state.view === 'discovery') {
      try {
        await selectDiscoveryBatch(targetBatch);
        showDiscoverySidebarStep('enrich');
      } catch {
        /* ignore */
      }
    }
    if (finished?.status === 'done') {
      announceStepComplete('Generate pack');
    } else if (finished?.status === 'error' || !finished) {
      const msg = finished?.error || 'Generate pack stopped or failed.';
      if (/stopped/i.test(msg)) {
        announceBanner('Generate pack stopped.');
      } else {
        announceBanner('Generate pack failed', { tone: 'err' });
        await showModal({
          title: 'Generate pack failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(msg)}</p>`,
        });
      }
    }
  })();
}

function snapWithOptimisticGeneratePack(jobId, batchId) {
  const jobs = [...(state.lightJobsSnap?.jobs || [])];
  if (!jobs.some((j) => String(j.id) === String(jobId))) {
    jobs.unshift({
      id: jobId,
      candidateId: discoveryPackLightId(batchId),
      batchId,
      phase: 'generate-pack',
      label: 'Generate pack',
      status: 'running',
      detail: 'Starting…',
      progressDone: 0,
      progressTotal: 2,
    });
  }
  return { ...(state.lightJobsSnap || {}), jobs };
}

async function confirmGeneratePackCost(batchId) {
  const preview = await api(
    `/api/discovery/batches/${encodeURIComponent(batchId)}/cost-preview`,
  );
  if (preview.error) {
    await showModal({
      title: preview.title || 'Cannot run',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>${esc(preview.error)}</p>`,
    });
    return false;
  }
  return showModal({
    title: preview.title,
    confirmLabel: preview.confirmLabel || 'Generate pack',
    bodyHtml: `
      <p>${esc(preview.whatItDoes)}</p>
      <p><strong>Estimated cost:</strong> ${esc(preview.estimateLabel)}</p>
      <p class="muted">${esc(preview.estimateDetail || '')}</p>
      <ul>
        <li>Model: <code>${esc(preview.model || state.health?.model || '')}</code></li>
        <li>Uses paid API tokens</li>
        <li>Usually a few minutes. Stop cancels; retry re-imports.</li>
      </ul>
      ${
        preview.overwriteNote
          ? `<p class="callout"><strong>Already ran:</strong> ${esc(preview.overwriteNote)}</p>`
          : ''
      }
      ${preview.freeFallback ? `<p class="muted">${esc(preview.freeFallback)}</p>` : ''}
    `,
  });
}

async function startGeneratePackFromUi(batchId) {
  const id = String(batchId || state.discoveryBatchId || '').trim();
  if (!id) {
    await showModal({
      title: 'No pack yet',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: '<p>Generate a Discovery pack first (step 1).</p>',
    });
    return;
  }
  if (!(await confirmGeneratePackCost(id))) return;
  try {
    const accepted = await api(`/api/discovery/batches/${encodeURIComponent(id)}/generate-pack`, {
      method: 'POST',
      body: '{}',
    });
    state._generatePackHandledJobId = null;
    state._generatePackTrack = { batchId: id, jobId: accepted.jobId };
    syncGeneratePackOverlay(snapWithOptimisticGeneratePack(accepted.jobId, id));
    syncClaudeModeToggle();
  } catch (error) {
    if (error.code === 'GENERATE_PACK_RUNNING' && error.jobId) {
      state._generatePackTrack = { batchId: id, jobId: error.jobId };
      syncGeneratePackOverlay(snapWithOptimisticGeneratePack(error.jobId, id));
      return;
    }
    if (error.code === 'GENERATE_PACK_BUSY') {
      await showModal({
        title: 'Generate pack already running',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>Generate pack is already running for <code>${esc(
          error.batchId || error.candidateId || 'another batch',
        )}</code>. One Generate pack at a time. Watch Light, or open that batch to Stop.</p>`,
      });
      return;
    }
    await showModal({
      title: 'Generate pack failed to start',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
  }
}

function syncDiscoveryApiRerunButton() {
  const btn = document.getElementById('discovery-generate-pack');
  if (!btn) return;
  const api = effectiveClaudeUiMode() === 'api';
  const id = String(state.discoveryBatchId || '').trim();
  const show = api && Boolean(id);
  btn.classList.toggle('hidden', !show);
  if (!show) return;
  const hasRows = (state.discoveryRows?.length || 0) > 0;
  btn.textContent = hasRows ? 'Re-run Generate pack' : 'Generate pack';
  btn.disabled = generatePackJobRunning();
}

function syncDiscoveryClaudeModeUi() {
  const api = effectiveClaudeUiMode() === 'api';
  const packTip = document.querySelector('#discovery-new-pack-section .tip-info');
  const claudeLabel = document.querySelector('#discovery-claude-pack-section .discovery-flow-label');
  const claudeTip = document.querySelector('#discovery-claude-pack-section .tip-info');
  const enrichLabel = document.querySelector('#discovery-enrich-section .discovery-flow-label');
  if (packTip) {
    setElementTip(
      packTip,
      api
        ? 'Set filters, then Generate. Creates the pack and runs Claude via the Anthropic API (confirm cost). Glance/fix rows, then Light SERP.'
        : 'Set filters, then Generate. Claude gets a filtered compact High-Ticket niche list (not the full guide) and Claude-only CSV headers.',
    );
  }
  if (claudeLabel) claudeLabel.textContent = '2 · Send to Claude';
  if (claudeTip) {
    setElementTip(
      claudeTip,
      'Download the CSV template, copy the Claude prompt, then paste both in Claude.ai.',
    );
  }
  if (enrichLabel) enrichLabel.textContent = api ? '2 · Light SERP' : '4 · Light SERP';
  syncDiscoveryApiRerunButton();
}

function firstIncompleteWebsiteStep({ logoMapDone, imagesDone, prepareDone, launched, indexingDone }) {
  if (!logoMapDone) return 'logoMap';
  if (!imagesDone) return 'images';
  if (!prepareDone) return 'prepare';
  if (!launched) return 'launch';
  if (!indexingDone) return 'indexing';
  return null;
}

/** Public host for live sitemap / robots links (no scheme, no trailing slash). */
function liveSiteHost(domain) {
  return String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .replace(/^www\./, '');
}

function liveSiteUrl(domain) {
  const host = liveSiteHost(domain);
  if (!host || isLaunchDomainPlaceholder(host)) return '';
  return `https://${host}`;
}

function liveSitemapUrl(domain) {
  const host = liveSiteHost(domain);
  if (!host || isLaunchDomainPlaceholder(host)) return '';
  return `https://${host}/sitemap.xml`;
}

function liveRobotsUrl(domain) {
  const host = liveSiteHost(domain);
  if (!host || isLaunchDomainPlaceholder(host)) return '';
  return `https://${host}/robots.txt`;
}

function isLaunchPhonePlaceholder(phone) {
  const phoneRaw = String(phone || '').trim();
  return (
    !phoneRaw ||
    /^\+?1?X+$/i.test(phoneRaw.replace(/[\s\-().]/g, '')) ||
    /X{4,}/i.test(phoneRaw) ||
    phoneRaw === '+1XXXXXXXXXX'
  );
}

function isLaunchDomainPlaceholder(domain) {
  const d = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  return !d || d === 'example.com' || d === 'www.example.com' || /^tbd\b/i.test(d);
}

function isLaunchWeb3Placeholder(key) {
  const s = String(key || '').trim();
  return (
    !s ||
    /^(REPLACE_WEB3FORMS_KEY|YOUR_WEB3FORMS_ACCESS_KEY)$/i.test(s) ||
    /^REPLACE_/i.test(s) ||
    /^YOUR_WEB3FORMS/i.test(s) ||
    /^tbd\b/i.test(s)
  );
}

/** Prefer draft launch scalars when accepted still holds placeholders (mirrors ops/lib/site-config.mjs). */
function effectiveSiteConfigForLaunchClient(accepted, draft) {
  const base =
    accepted && typeof accepted === 'object'
      ? (() => {
          const { _ops, ...rest } = accepted;
          return rest;
        })()
      : {};
  if (!draft || typeof draft !== 'object') return { ...base };
  const { _ops, ...fromDraft } = draft;
  const out = { ...base };
  const prefer = (key, draftIsPlaceholder, acceptedIsPlaceholder) => {
    if (!draftIsPlaceholder(fromDraft[key]) && acceptedIsPlaceholder(base[key])) {
      out[key] = fromDraft[key];
    }
  };
  prefer('web3FormsAccessKey', isLaunchWeb3Placeholder, isLaunchWeb3Placeholder);
  prefer('domain', isLaunchDomainPlaceholder, isLaunchDomainPlaceholder);
  prefer('phone', isLaunchPhonePlaceholder, isLaunchPhonePlaceholder);
  prefer(
    'email',
    (v) => {
      const s = String(v || '').trim();
      return !s || s === 'leads@example.com' || /^tbd\b/i.test(s) || /@example\.com$/i.test(s);
    },
    (v) => {
      const s = String(v || '').trim();
      return !s || s === 'leads@example.com' || /^tbd\b/i.test(s) || /@example\.com$/i.test(s);
    },
  );
  prefer(
    'businessName',
    (v) => {
      const s = String(v || '').trim();
      return !s || /^tbd\b/i.test(s) || s === 'TBD Business';
    },
    (v) => {
      const s = String(v || '').trim();
      return !s || /^tbd\b/i.test(s) || s === 'TBD Business';
    },
  );
  prefer(
    'turnstileSiteKey',
    (v) => !String(v || '').trim(),
    (v) => !String(v || '').trim(),
  );
  return out;
}

/** Soft warn when hostname tokens don't overlap niche/brand/city (mirrors ops/lib/site-config.mjs). */
function domainBrandMismatchClient(domain, { niche, businessName, primaryCity } = {}) {
  const host = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .replace(/^www\./, '');
  if (!host || host === 'example.com' || /^tbd\b/i.test(host)) {
    return { mismatch: false, domain: host, reason: null };
  }
  const label = host.split('.')[0] || host;
  const hostTokens = label.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const stop = new Set([
    'the',
    'and',
    'for',
    'pros',
    'llc',
    'inc',
    'com',
    'net',
    'org',
    'www',
    'services',
    'service',
    'local',
    'home',
  ]);
  const meaningful = hostTokens.filter((t) => !stop.has(t));
  if (!meaningful.length) return { mismatch: false, domain: host, reason: null };
  const hay = `${niche || ''} ${businessName || ''} ${primaryCity || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
  const hayTokens = new Set(
    hay
      .split(/\s+/)
      .filter((t) => t.length > 2 && !stop.has(t)),
  );
  const hit = meaningful.some((t) =>
    [...hayTokens].some((h) => h.includes(t) || t.includes(h)),
  );
  if (hit) return { mismatch: false, domain: host, reason: null };
  return {
    mismatch: true,
    domain: host,
    reason: `Hostname “${host}” does not share tokens with niche/brand/city — use the final client domain before go-live (test hosts are OK for preview).`,
  };
}

function napCsvFromSiteConfig(cfg = {}) {
  const services = [
    ...(Array.isArray(cfg.services) ? cfg.services : []),
    ...(Array.isArray(cfg.commercialServices) ? cfg.commercialServices : []),
  ]
    .map((s) => (typeof s === 'string' ? s : s?.name))
    .filter(Boolean)
    .join('; ');
  const row = {
    businessName: cfg.businessName || '',
    phone: cfg.phone || '',
    email: cfg.email || '',
    street: cfg.address?.street || '',
    city: cfg.address?.city || cfg.primaryCity || '',
    state: cfg.address?.state || cfg.state || '',
    zip: cfg.address?.zip || '',
    domain: cfg.domain || '',
    niche: cfg.niche || '',
    services,
  };
  const headers = Object.keys(row);
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return `${headers.join(',')}\n${headers.map((h) => escape(row[h])).join(',')}\n`;
}

function citationsChecklistHtml(cfg = {}) {
  const items = [
    'Google Business Profile — website URL + NAP match site-config',
    'Apple Business Connect',
    'Bing Places',
    'Yelp Business',
    'BBB and/or local chamber (when applicable)',
    '1–2 niche directories or supplier partner links',
  ];
  return `<div class="callout" id="ca-citations" style="margin-top:0.75rem">
    <strong>Citations (off-page)</strong>
    <p class="muted" style="margin:0.35rem 0 0.5rem;font-size:0.85rem">Head-term ranking needs local citations and GBP — Assemble cannot mint backlinks. Check these off before expecting page-one speed.</p>
    <ul class="narrative-list" style="margin:0 0 0.5rem">
      ${items.map((t) => `<li>${esc(t)}</li>`).join('')}
    </ul>
    <div class="narrative-actions" style="justify-content:flex-start">
      <button type="button" class="btn btn-sm" id="ca-download-nap" data-tip="Download NAP CSV from accepted site-config for directory forms">Download NAP CSV</button>
    </div>
  </div>`;
}

/** Preflight issues for Launch step (domain / phone / web3). */
function launchPreflightIssues({ domain, phone, web3FormsAccessKey }) {
  const issues = [];
  if (isLaunchDomainPlaceholder(domain)) {
    issues.push({ id: 'domain', label: 'Domain still empty or example.com' });
  }
  if (isLaunchPhonePlaceholder(phone)) {
    issues.push({ id: 'phone', label: 'Phone still a placeholder (set under Advanced or Site config)' });
  }
  if (isLaunchWeb3Placeholder(web3FormsAccessKey)) {
    issues.push({
      id: 'web3',
      label: 'Web3Forms access key missing or placeholder — create at web3forms.com and paste',
    });
  }
  return issues;
}

function launchPreflightHtml(issues) {
  if (!issues?.length) return '';
  return `<div class="callout warn"><strong>Before launch:</strong><ul class="narrative-list">${issues
    .map((i) => `<li>${esc(i.label)}</li>`)
    .join('')}</ul></div>`;
}

function applyShipFreshnessUi(diff) {
  const box = document.getElementById('ca-ship-freshness');
  const msg = document.getElementById('ca-ship-freshness-msg');
  if (!box || !msg) return;
  let status = diff?.status || 'unknown';
  if (status === 'behind') status = 'behind';
  else if (status === 'current') status = 'current';
  box.dataset.status = status;
  const assembleTip =
    diff?.timestampHint?.assembleNewerThanShip && status === 'current'
      ? ` <span class="muted">(Assemble ${esc(diff.timestampHint.lastAssembleAt || '')} · last ship ${esc(diff.timestampHint.lastShipAt || 'never')})</span>`
      : '';
  const matchInfoTip =
    status === 'current'
      ? ` <button type="button" class="tip-info" data-tip="Local assembled tree matches GitHub origin/main — already pushed. Prepare preview builds locally only; use Push updates to ship to GitHub + Cloudflare when status shows a mismatch." aria-label="About matched GitHub status">i</button>`
      : '';
  msg.innerHTML = `${esc(diff?.summary || 'Could not determine ship status.')}${assembleTip}${matchInfoTip}`;
}

function formatShipDiffModalHtml(diff) {
  const files = (diff?.files || [])
    .map((f) => `<li><code>${esc(f.status || '?')}</code> ${esc(f.path || '')}</li>`)
    .join('');
  const dirty = (diff?.dirty || []).map((l) => `<li><code>${esc(l)}</code></li>`).join('');
  const noise = (diff?.noise || []).map((p) => `<li><code>${esc(p)}</code></li>`).join('');
  const stat = diff?.stat ? `<pre class="code-block" style="max-height:14rem;overflow:auto">${esc(diff.stat)}</pre>` : '';
  const behind = diff?.status === 'behind' || Boolean(diff?.needsPush && (diff?.files?.length || diff?.dirty?.length));
  return `<p><strong>${esc(diff?.summary || '')}</strong></p>
    <p class="muted">Status: <code>${esc(diff?.status || '—')}</code>
      · needs push: ${diff?.needsPush ? 'yes' : 'no'}
      · fetch: ${diff?.fetchOk ? 'ok' : 'failed / skipped'}</p>
    ${stat || (behind ? '<p class="muted">No --stat output.</p>' : '')}
    ${
      files
        ? `<p>Changed paths vs <code>origin/main</code>:</p><ul class="narrative-list">${files}</ul>`
        : behind
          ? '<p class="muted">No name-status differences vs origin/main.</p>'
          : ''
    }
    ${
      dirty
        ? `<p>Uncommitted (porcelain):</p><ul class="narrative-list">${dirty}</ul>`
        : ''
    }
    ${
      noise
        ? `<p class="muted">Ignored metadata (not a publish signal):</p><ul class="narrative-list muted">${noise}</ul>`
        : ''
    }
    ${
      behind
        ? '<p class="muted">Prepare preview first if Stage changed the package, then Push updates.</p>'
        : noise
          ? '<p class="muted">No Push needed for assemble receipt-only changes.</p>'
          : ''
    }`;
}

async function loadShipFreshness(candidateId, { showError = false } = {}) {
  const box = document.getElementById('ca-ship-freshness');
  const msg = document.getElementById('ca-ship-freshness-msg');
  if (!box) return null;
  if (msg) msg.textContent = 'Checking whether assembled matches GitHub…';
  try {
    const diff = await api(`/api/candidates/${encodeURIComponent(candidateId)}/ship-diff`);
    applyShipFreshnessUi(diff);
    return diff;
  } catch (error) {
    if (msg) {
      msg.textContent = showError
        ? error.message || 'Ship status check failed'
        : 'Could not check GitHub (network or git). Use Refresh status.';
    }
    box.dataset.status = 'unknown';
    return null;
  }
}

function collectLaunchFormValues() {
  return {
    domain: document.getElementById('ca-launch-domain')?.value?.trim() || '',
    businessName: document.getElementById('ca-launch-business')?.value?.trim() || '',
    phone: document.getElementById('ca-launch-phone')?.value?.trim() || '',
    email: document.getElementById('ca-launch-email')?.value?.trim() || '',
    destinationEmail: document.getElementById('ca-launch-dest')?.value?.trim() || '',
    web3FormsAccessKey: document.getElementById('ca-launch-web3')?.value?.trim() || '',
    turnstileSiteKey: document.getElementById('ca-launch-turnstile')?.value?.trim() || '',
    ship: Boolean(document.getElementById('ca-launch-ship')?.checked),
    runCloudflare: Boolean(document.getElementById('ca-launch-run-cf')?.checked),
    createTurnstile: Boolean(document.getElementById('ca-launch-create-turnstile')?.checked),
    markCloudflareProjectDone: Boolean(document.getElementById('ca-launch-mark-cf')?.checked),
  };
}

/** Launch Advanced checkbox + “i” tip (data-tip on icon only). */
function launchOptCheckboxHtml({ id, label, tip, ariaLabel, checked = false }) {
  return `<div class="launch-opt">
    <label class="launch-opt-label" for="${esc(id)}">
      <input id="${esc(id)}" type="checkbox"${checked ? ' checked' : ''} />
      <span>${esc(label)}</span>
    </label>
    <button type="button" class="tip-info" data-tip="${esc(tip)}" aria-label="${esc(ariaLabel)}">i</button>
  </div>`;
}


function ensureStructureCatalog({ force = false } = {}) {
  if (state.contentStructureCatalog?.sections?.length) {
    return Promise.resolve(state.contentStructureCatalog);
  }
  if (!force && state.contentStructureCatalogError) {
    return Promise.reject(new Error(state.contentStructureCatalogError));
  }
  if (state._structureCatalogPromise) return state._structureCatalogPromise;
  state._structureCatalogPromise = api('/api/content/structure/catalog')
    .then((catalog) => {
      state.contentStructureCatalog = catalog;
      state.contentStructureCatalogError = null;
      state._structureCatalogPromise = null;
      if (state.tab === 'content') renderDetail();
      return catalog;
    })
    .catch((error) => {
      state._structureCatalogPromise = null;
      state.contentStructureCatalogError =
        error?.message || 'Couldn’t load section catalog';
      if (state.tab === 'content') renderDetail();
      throw error;
    });
  return state._structureCatalogPromise;
}

function structureSectionRowHtml(s, selectedSections, photos) {
  const on = selectedSections.has(s.id);
  const photo = photos[s.id];
  const photoOn = Boolean(photo?.enabled);
  const photoTip =
    s.id === 'services'
      ? 'Photos appear on homepage What we do cards. With Service pages off they use homepage serviceCardImages; with Service pages on they use each service card/hero image.'
      : s.id === 'offerProcess' || s.id === 'process'
        ? 'One photo per process step — slot labels use step titles from homepage content.'
        : '';
  const photoRow = s.photoCapable
    ? `<label class="check structure-photo"${
        photoTip ? ` data-tip="${esc(photoTip)}"` : ''
      }><input type="checkbox" name="structure-photo" value="${esc(
        s.id,
      )}" ${photoOn ? 'checked' : ''} ${on ? '' : 'disabled'}/> Include photos${
        s.maxImages ? ` <span class="muted">(up to ${esc(String(s.maxImages))})</span>` : ''
      }</label>`
    : '';
  return `<div class="structure-section-row">
    <label class="check structure-check"><input type="checkbox" name="structure-section" value="${esc(
      s.id,
    )}" data-photo-capable="${s.photoCapable ? '1' : '0'}" ${on ? 'checked' : ''} ${
      s.required ? 'disabled' : ''
    }/> ${esc(s.label)}${s.required ? ' <span class="muted">(required)</span>' : ''}</label>
    ${photoRow}
  </div>`;
}

function structureChecklistHtml(d, catalog) {
  const structure = d?.contentStructure || {};
  const defaults = catalog?.defaults || { pages: [], sections: [], photos: {} };
  const selectedPages = new Set(structure.pages?.length ? structure.pages : defaults.pages || []);
  const selectedSections = new Set(
    structure.sections?.length ? structure.sections : defaults.sections || [],
  );
  const photos = structure.photos || defaults.photos || {};
  const pages = catalog?.pages || [];
  const sections = catalog?.sections || [];
  const presets = catalog?.presets || [];
  const loadError = state.contentStructureCatalogError;

  const presetBtns = presets
    .map(
      (p) =>
        `<button type="button" class="btn btn-sm structure-preset" data-preset="${esc(
          p.id,
        )}" data-tip="${esc(p.tip || p.name)}">${esc(p.label)}</button>`,
    )
    .join('');

  const pageChecks = pages
    .map((p) => {
      const on = selectedPages.has(p.id);
      return `<label class="check structure-check"><input type="checkbox" name="structure-page" value="${esc(
        p.id,
      )}" ${on ? 'checked' : ''} ${p.required ? 'disabled' : ''}/> ${esc(p.label)}${
        p.required ? ' <span class="muted">(required)</span>' : ''
      }</label>`;
    })
    .join('');

  const groupBlurbs = {
    home: 'Homepage H1/H2 blocks and Astro section keys.',
    services:
      'Shared template — applies to each name in site-config services and commercialServices. svcHero photos cover both lists; homepage splits into Residential + Commercial when commercialServices is set.',
    about: 'About page sections.',
    contact: 'Contact page sections.',
    locations: 'Shared template — applies to each suburb in targetSuburbs.',
  };

  /** Match live homepage order (hero first, then DEFAULT_HOME_SECTION_ORDER). */
  const HOME_SECTION_ORDER = [
    'hero',
    'trust',
    'intro',
    'services',
    'whyChooseUs',
    'process',
    'offerProcess',
    'cost',
    'materials',
    'timeline',
    'codes',
    'diyVsPro',
    'whenToCall',
    'areas',
    'gallery',
    'beforeAfter',
    'reviews',
    'faqs',
    'cta',
  ];
  const homeOrderIndex = (id) => {
    const i = HOME_SECTION_ORDER.indexOf(id);
    return i >= 0 ? i : 500;
  };

  const sectionGroups = pages
    .map((p) => {
      let groupSections = sections.filter((s) => (s.pages || []).includes(p.id));
      if (p.id === 'home') {
        groupSections = [...groupSections].sort(
          (a, b) => homeOrderIndex(a.id) - homeOrderIndex(b.id) || String(a.id).localeCompare(String(b.id)),
        );
      }
      if (!groupSections.length) return '';
      const pageOn = selectedPages.has(p.id);
      const rows = groupSections
        .map((s) => structureSectionRowHtml(s, selectedSections, photos))
        .join('');
      return `<div class="structure-page-group" data-page="${esc(p.id)}" ${
        pageOn ? '' : 'hidden'
      }>
        <h4>${esc(p.label)} sections</h4>
        <p class="muted small">${esc(groupBlurbs[p.id] || 'Sections for this page type.')}</p>
        <div class="structure-checks structure-sections">${rows}</div>
      </div>`;
    })
    .join('');

  const statusCallout = loadError
    ? `<div class="callout warn">Couldn’t load section catalog: ${esc(loadError)}. Hard-refresh or restart Rover, then reopen Structure.</div>`
    : !catalog
      ? `<div class="callout">Loading section checklist…</div>`
      : '';

  return `
    <p class="muted small" id="structure-process-hint">Services pages use <strong>How we work</strong> (process). <strong>Deep offer process</strong> is for single-offer sites only — never both.</p>
    ${statusCallout}
    <div class="structure-presets">
      <span class="muted small">Presets</span>
      ${presetBtns || '<span class="muted">—</span>'}
    </div>
    <h4>Pages</h4>
    <div class="structure-checks">${pageChecks}</div>
    ${sectionGroups}
    ${contentActionRow({
      n: 1,
      label: 'Continue — compose outline <span class="muted">(Required)</span>',
      hint: 'Saves your checklist and builds the downloadable outline package.',
      controlsHtml: `<button type="button" class="btn primary" id="cs-compose" ${
        catalog?.sections?.length ? '' : 'disabled'
      }>Continue</button>`,
    })}`;
}

function renderContent() {
  const d = state.detail;
  const f = d?.stageFlags || {};
  const draft = d?.contentDraft;
  const accepted = d?.content;
  const brief = d?.contentBrief;
  const outlinePkg = d?.contentOutlinePackage;
  const structure = d?.contentStructure;
  const outline = d?.contentOutline;
  const research = d?.contentResearch;
  const pack = d?.buildPackage;
  const catalog = state.contentStructureCatalog;
  const ready = Boolean(f.hasSiteConfig);
  if (ready) ensureStructureCatalog().catch(() => {});
  const outlineConfirmed =
    outlinePkg?.status === 'confirmed' || Boolean(f.hasContentOutlineConfirmed);
  const structureReady = Boolean(
    structure?.sections?.length || outlinePkg?.sections?.length || f.hasContentStructure,
  );
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
  const lintSource = draft || accepted;
  const speechChecked = Boolean(lintSource?._ops?.lastSpeechCheckAt);
  const editorNeeds = contentNeedsEditorRewrite(lintSource);
  const needsEditorClaude = speechChecked && editorNeeds.needed;
  const hasEditableContent = Boolean(draft?.files) || Boolean(accepted?.files);
  const seoCritical = (lintSource?._ops?.seoLint?.findings || []).filter(
    (f) => f.severity === 'critical',
  );
  const contentAcceptedLive = Boolean(accepted) || Boolean(f.hasContent);
  // After Accept, draft is deleted — still treat Speech/SEO as done (clean publish).
  // Soft progress: speech findings must clear. Critical SEO can use Accept override.
  const editorClear = Boolean(speechChecked && editorNeeds.speechN === 0);
  const fieldResearch = d?.contentFieldResearch;
  const fieldOk = Boolean(fieldResearch?.status === 'loaded' || f.hasContentFieldResearch);
  const briefOk = brief?.status === 'confirmed' || Boolean(f.hasContentBriefConfirmed);
  const writeBatches = draft?._ops?.writeBatches || accepted?._ops?.writeBatches || {};
  const pageIds = structurePageIdsFromDetail(d);
  const wantServices = pageIds.includes('services');
  const wantLocations = pageIds.includes('locations');
  const haveServices =
    [...(d?.siteConfig?.services || []), ...(d?.siteConfig?.commercialServices || [])].filter(
      Boolean,
    ).length > 0;
  const haveLocations =
    [d?.siteConfig?.primaryCity, ...(d?.siteConfig?.targetSuburbs || [])].filter(Boolean).length >
      0;
  const needServices = wantServices && haveServices;
  const needLocations = wantLocations && haveLocations;
  const batchesComplete =
    Boolean(writeBatches.home || writeBatches.all) &&
    (!needServices || Boolean(writeBatches.services || writeBatches.all)) &&
    (!needLocations || Boolean(writeBatches.locations || writeBatches.all));
  const writeFilesReady =
    Boolean(draft?.files) ||
    Boolean(accepted?.files) ||
    Boolean(f.hasContentDraft) ||
    Boolean(f.hasContent);
  const writeOk = writeFilesReady && (batchesComplete || contentAcceptedLive);
  const finalOk = Boolean(
    draft?._ops?.lastFinalCheckAt || accepted?._ops?.lastFinalCheckAt || f.hasContentFinalCheck,
  );
  const photosOn = Object.values(structure?.photos || {}).some((p) => p && p.enabled);
  const queriesLoaded = Boolean(
    d?.imagesPlan?.loadedAt ||
      draft?._ops?.lastImagesPlanAt ||
      accepted?._ops?.lastImagesPlanAt,
  );
  const photoGroupAttached = Boolean(d?.photoGroupAttached?.groupId);
  const photoGroupSkipped = Boolean(d?.photoGroupAttached?.skipped) && !photoGroupAttached;
  const masterReady = Boolean(d?.photoNicheMaster?.id) && !photoGroupSkipped;
  const photosReady = !photosOn || queriesLoaded;
  const stepDone = {
    structure: structureReady && Boolean(outlinePkg?.sections?.length),
    fieldResearch: fieldOk,
    brief: briefOk,
    outline: outlineConfirmed,
    write: writeOk,
    editor: editorClear || (contentAcceptedLive && !draft),
    finalCheck: finalOk || (contentAcceptedLive && !draft),
    imageQueries: !photosOn || queriesLoaded,
    photoGroup: photoGroupAttached || photoGroupSkipped,
    photosReady,
    accepted: contentAcceptedLive,
    oneshot: writeFilesReady,
    research: Boolean(research) || Boolean(f.hasContentResearch),
    outlineLegacy: Boolean(outline) || Boolean(f.hasContentOutline),
  };
  // Open draft with speech leftovers: stay on Humanize (copy/paste lives here)
  if (draft && speechChecked && editorNeeds.speechN > 0) {
    if (
      state.contentSoftCurrent === 'accept' ||
      state.contentSoftCurrent === 'finalCheck' ||
      state.contentSoftCurrent === 'imageQueries' ||
      state.contentSoftCurrent === 'photoGroup'
    ) {
      state.contentSoftCurrent = 'editor';
      state.contentFollowCurrent = 'editor';
      state.contentOpenStep = 'editor';
    }
  }
  if (state.contentSoftDone?.editor && !stepDone.editor) {
    const nextSoft = { ...state.contentSoftDone };
    delete nextSoft.editor;
    state.contentSoftDone = nextSoft;
  }
  if (state.contentSoftDone?.editorPack) {
    const nextSoft = { ...state.contentSoftDone };
    delete nextSoft.editorPack;
    state.contentSoftDone = nextSoft;
  }
  if (
    state.contentOpenStep === 'editorPack' ||
    state.contentSoftCurrent === 'editorPack' ||
    state.contentFollowCurrent === 'editorPack'
  ) {
    state.contentOpenStep = 'editor';
    state.contentSoftCurrent = 'editor';
    state.contentFollowCurrent = 'editor';
  }
  // Soft must not green Final without durable stamp (mixed scorecard signals)
  if (state.contentSoftDone?.finalCheck && !finalOk) {
    const nextSoft = { ...state.contentSoftDone };
    delete nextSoft.finalCheck;
    // Also clear accept soft-advance past an unstamped Final
    delete nextSoft.accept;
    state.contentSoftDone = nextSoft;
  }
  const apiMode = effectiveClaudeUiMode() === 'api';
  const writeSiteDone =
    Boolean(fieldOk) &&
    Boolean(briefOk) &&
    Boolean(outlineConfirmed) &&
    Boolean(writeOk) &&
    Boolean(stepDone.editor) &&
    Boolean(stepDone.finalCheck) &&
    Boolean(stepDone.imageQueries);
  stepDone.writeSite = writeSiteDone;
  const contentOrder = contentStepOrder({ photosOn, apiMode });
  const durableCurrent = apiMode
    ? !stepDone.structure
      ? 'structure'
      : !writeSiteDone
        ? 'writeSite'
        : photosOn && !stepDone.photoGroup
          ? 'photoGroup'
          : stepDone.accepted
            ? null
            : 'accept'
    : draft && speechChecked && editorNeeds.speechN > 0
      ? 'editor'
      : stepDone.accepted
        ? null
        : firstIncompleteContentStep(stepDone, { photosOn });
  const currentId = resolvePanelCurrent('contentSoftCurrent', durableCurrent, contentOrder);
  if (apiMode && CONTENT_INNER_STEPS.has(state.contentOpenStep)) {
    state.contentOpenStep = 'writeSite';
    state.contentSoftCurrent = 'writeSite';
    state.contentFollowCurrent = 'writeSite';
  } else if (!apiMode && state.contentOpenStep === 'writeSite') {
    const inner = firstIncompleteContentStep(stepDone, { photosOn });
    state.contentOpenStep = inner;
    state.contentSoftCurrent = inner;
    state.contentFollowCurrent = inner;
  }
  if (state.contentFollowCurrent !== currentId) {
    state.contentOpenStep = currentId;
    state.contentFollowCurrent = currentId;
  }
  const openId = state.contentOpenStep;
  const structureDone = stepDone.structure || isSoftDone('contentSoftDone', 'structure');
  const fieldResearchDone =
    stepDone.fieldResearch || isSoftDone('contentSoftDone', 'fieldResearch');
  const briefDone = stepDone.brief || isSoftDone('contentSoftDone', 'brief');
  const outlineDone = stepDone.outline || isSoftDone('contentSoftDone', 'outline');
  const writeDone = stepDone.write || isSoftDone('contentSoftDone', 'write');
  const editorDone =
    draft && speechChecked && editorNeeds.speechN > 0
      ? false
      : stepDone.editor;
  const finalCheckDone = Boolean(finalOk);
  const imageQueriesDone = Boolean(queriesLoaded);
  const photoGroupDone = Boolean(photoGroupAttached || photoGroupSkipped);
  const acceptDone = stepDone.accepted || isSoftDone('contentSoftDone', 'accept');
  const parts = [];

  parts.push(
    panelHowToHtml({
      label: 'Content',
      info: apiMode
        ? photosOn
          ? 'API path: Structure → Write site with Claude → optional photo group → Accept. Copy & paste mode still has the ten-step path.'
          : 'API path: Structure → Write site with Claude → Accept.'
        : photosOn
        ? 'Content path (required): Structure → Site research → Brief → Outline → batched Full write → Humanize (Speech/SEO clear) → Final check → Image queries (required) → optional Load photo group → Accept. Claude.ai paste only (no Anthropic API). Then Website → Prepare preview.'
        : 'Eight-pass path (required): Structure → Site research → Brief → Outline → batched Full write → Humanize (Speech/SEO clear) → Final check → Accept. Claude.ai paste only (no Anthropic API). Then Website → Prepare preview.',
    }),
  );
  if (isSelectedLaunched()) {
    parts.push(
      `<div class="callout warn"><strong>Already launched.</strong> Content/structure changes here will not match the live site until you Push updates. Mutating actions ask for confirmation. Use Website → Revert to restore from GitHub.</div>`,
    );
  }
  const secCount = outlinePkg?.sectionIds?.length || structure?.sections?.length || 0;
  parts.push(
    contentUpNextHtml(stepDone, ready, {
      secCount,
      outlineConfirmed,
      outlineDrafted: Boolean(outlinePkg),
      photosOn,
      apiMode,
      writeSiteDone,
    }),
  );
  parts.push(contentPassStripHtml(stepDone, currentId, { photosOn, apiMode }));

  parts.push(
    contentStepHtml({
      id: 'structure',
      num: 1,
      title: 'Structure',
      done: structureDone,
      open: openId === 'structure',
      current: currentId === 'structure' && !structureDone,
      info: 'Choose site pages, then H2 blocks per page type. Prefer Preset C for ranking builds — selecting every section makes Full write heavy. Photo-capable sections can include image slots.',
      bodyHtml: ready
        ? `<div class="callout"><strong>Entity matching (Rank &amp; Rent):</strong> Home = primary niche+city · Services = offer entities only · Locations = geo proof for real suburbs. Mirror what a future GBP will claim — do not invent categories you will not deliver. Avoid weekly-blog sprawl. See <code>docs/SECTION-UX.md#entity-matching</code>.</div>
        ${structureChecklistHtml(d, catalog)}`
        : `<p class="muted">Accept Site config to unlock the checklist.</p>`,
    }),
  );

  if (apiMode) {
    const wsBusy = writeSiteJobRunning(d?.id);
    const spent = d?.meta?.lastCosts?.writeSite;
    const leftoverN = editorNeeds.speechN || 0;
    parts.push(
      contentStepHtml({
        id: 'writeSite',
        num: 2,
        title: 'Write site with Claude',
        done: writeSiteDone,
        open: openId === 'writeSite',
        current: currentId === 'writeSite' && !writeSiteDone,
        locked: !structureDone || !ready,
        info: 'One job per candidate: Site research → Brief → Outline → Full write → Polish → Image queries when photos are on. Up to six candidates can Write site at once. Skips steps already loaded. Stop keeps files written so far.',
        bodyHtml: `
          ${
            writeSiteDone
              ? `<div class="callout"><strong>Write site complete</strong>${
                  spent != null ? ` · last run ${esc(formatMoney(spent))}` : ''
                }</div>`
              : `<p class="disc-tool-blurb">Anthropic API writes the site from Structure. Confirm cost, then wait on the overlay (or watch Light).</p>`
          }
          ${
            leftoverN
              ? `<div class="callout warn"><strong>Speech leftovers (${esc(String(leftoverN))})</strong> — Retry Write site (resume) or switch to Copy &amp; paste Humanize.</div>
                 ${speechLintFindingsHtml(draft?._ops?.speechLint)}
                 ${seoLintFindingsHtml(draft?._ops?.seoLint)}`
              : ''
          }
          <div class="narrative-actions" style="flex-wrap:wrap;gap:0.4rem">
            <button type="button" class="btn primary" id="cs-write-site" ${
              structureDone && ready && !wsBusy ? '' : 'disabled'
            }>${writeSiteDone ? 'Re-run Write site' : leftoverN ? 'Retry Write site' : 'Write site with Claude'}</button>
          </div>`,
      }),
    );
  }

  if (!apiMode) {
  const fieldQ = Array.isArray(fieldResearch?.homeownerQuestions)
    ? fieldResearch.homeownerQuestions.length
    : 0;
  const fieldAngles = Array.isArray(fieldResearch?.competitorAngles)
    ? fieldResearch.competitorAngles.length
    : 0;
  parts.push(
    contentStepHtml({
      id: 'fieldResearch',
      num: 2,
      title: 'Site research',
      done: fieldResearchDone,
      open: openId === 'fieldResearch',
      current: currentId === 'fieldResearch' && !fieldResearchDone,
      locked: !structureDone,
      info: 'Required Pass 1 feed. Copy field-research prompt → Claude.ai (web OK) → Load JSON. Optional notes enrich the Brief; they do not replace Load.',
      bodyHtml: `
        ${
          fieldOk
            ? `<p class="muted">Loaded · ${esc(String(fieldQ))} questions · ${esc(
                String(fieldAngles),
              )} competitor angles</p>`
            : `<div class="callout warn">Required — Load field research to continue.</div>`
        }
        ${contentActionRow({
          n: 1,
          label: 'Copy field-research prompt <span class="muted">(Required)</span>',
          controlsHtml: `<button type="button" class="btn primary" id="cs-copy-field-research" ${
            structureDone ? '' : 'disabled'
          }>Copy field-research prompt</button>
          ${openClaudeAiBtnHtml({ disabled: !structureDone })}`,
        })}
        ${contentActionRow({
          n: 2,
          label: 'Paste field-research JSON <span class="muted">(Required)</span>',
          controlsHtml: `<textarea id="cs-field-research-paste" class="narrative-paste-input" rows="2" placeholder='{ "homeownerQuestions": [ ... ] }'></textarea>`,
        })}
        ${contentActionRow({
          n: 3,
          label: 'Operator notes <span class="muted">(Optional enrichment)</span>',
          controlsHtml: `<textarea id="cs-field-notes" class="narrative-paste-input" rows="2" placeholder="Extra competitor URLs or notes Claude missed">${esc(
            fieldResearch?.operatorNotes || '',
          )}</textarea>`,
        })}
        ${contentActionRow({
          n: 4,
          label: 'Load field research <span class="muted">(Required)</span>',
          controlsHtml: `<button type="button" class="btn primary" id="cs-load-field-research" ${
            structureDone ? '' : 'disabled'
          }>Load field research</button>`,
        })}`,
    }),
  );

  parts.push(
    contentStepHtml({
      id: 'brief',
      num: 3,
      title: 'Content brief',
      done: briefDone,
      open: openId === 'brief',
      current: currentId === 'brief' && !briefDone,
      locked: !fieldResearchDone,
      info: 'Required Pass 1 synthesis. Copy brief prompt → Claude.ai → Load & confirm. Unlocks Outline.',
      bodyHtml: `
        ${
          briefOk
            ? `<p class="muted">Brief confirmed · ${esc(
                String((brief?.pages || []).length || 0),
              )} pages</p>`
            : `<div class="callout warn">Required — confirm brief before Outline.</div>`
        }
        ${contentActionRow({
          n: 1,
          label: 'Copy brief prompt <span class="muted">(Required)</span>',
          controlsHtml: `<button type="button" class="btn primary" id="cs-copy-brief" ${
            fieldOk ? '' : 'disabled'
          }>Copy brief prompt</button>
          ${openClaudeAiBtnHtml({ disabled: !fieldOk })}`,
        })}
        ${contentActionRow({
          n: 2,
          label: 'Paste brief JSON <span class="muted">(Required)</span>',
          controlsHtml: `<textarea id="cs-brief-paste" class="narrative-paste-input" rows="2" placeholder='{ "pages": [ ... ] }'></textarea>`,
        })}
        ${contentActionRow({
          n: 3,
          label: 'Load &amp; confirm brief <span class="muted">(Required)</span>',
          controlsHtml: `<button type="button" class="btn primary" id="cs-confirm-brief" ${
            fieldOk ? '' : 'disabled'
          }>Load &amp; confirm brief</button>`,
        })}`,
    }),
  );

  parts.push(
    contentStepHtml({
      id: 'outline',
      num: 4,
      title: 'Outline (Pass 2)',
      done: outlineDone,
      open: openId === 'outline',
      current: currentId === 'outline' && !outlineDone,
      locked: !briefDone,
      info: 'Pass 2 — strategic outline. Copy structure prompt (needs confirmed brief), refine in Claude.ai, Load & confirm.',
      bodyHtml: `
        ${
          outlinePkg?.sections?.length
            ? `<p class="muted">${esc(String(outlinePkg.sections.length))} outline sections · status <code>${esc(
                outlinePkg.status || '',
              )}</code></p>`
            : `<div class="callout warn">Compose an outline from Structure → Continue first.</div>`
        }
        ${contentActionRow({
          n: 1,
          label: 'Copy structure prompt <span class="muted">(Required)</span>',
          controlsHtml: `<button type="button" class="btn primary" id="cs-copy-structure" ${
            outlinePkg?.sections?.length && briefOk ? '' : 'disabled'
          }>Copy structure prompt</button>
          ${openClaudeAiBtnHtml({ disabled: !(outlinePkg?.sections?.length && briefOk) })}`,
        })}
        ${contentActionRow({
          n: 2,
          label: 'Paste refined outline JSON <span class="muted">(Required)</span>',
          controlsHtml: `<textarea id="cs-outline-paste" class="narrative-paste-input" rows="2" placeholder='{ "sections": [ ... ] }'></textarea>`,
        })}
        ${contentActionRow({
          n: 3,
          label: 'Load &amp; confirm outline <span class="muted">(Required)</span>',
          hint: 'Loads Claude’s JSON and locks it for the full-write prompt.',
          controlsHtml: `<button type="button" class="btn primary" id="cs-paste-outline" ${
            briefOk ? '' : 'disabled'
          }>Load &amp; confirm outline</button>`,
        })}`,
    }),
  );

  parts.push(
    contentStepHtml({
      id: 'write',
      num: 5,
      title: 'Full write (batched · Pass 3)',
      done: writeDone,
      open: openId === 'write',
      current: currentId === 'write' && !writeDone,
      locked: !outlineDone,
      info: 'Pass 3 — batch by page group for tone variance. All enabled batches required. Prefer batches over Copy all (truncation risk).',
      bodyHtml: `
        ${incompleteDraftCalloutHtml(d)}
        ${
          wantServices && !haveServices
            ? `<div class="callout warn">Structure includes <strong>Services</strong> pages, but site-config has no services — add them in Site config or turn Services off in Structure.</div>`
            : ''
        }
        ${
          wantLocations && !haveLocations
            ? `<div class="callout warn">Structure includes <strong>Locations</strong> pages, but site-config has no primary city or suburbs — add them in Site config or turn Locations off in Structure.</div>`
            : ''
        }
        ${contentActionRow({
          n: 1,
          label: 'Copy Home batch <span class="muted">(Required)</span>',
          loaded: Boolean(writeBatches.home || writeBatches.all),
          controlsHtml: `<button type="button" class="btn primary" id="cs-copy-write-home" ${
            outlineConfirmed ? '' : 'disabled'
          }>Copy Home batch</button>
          ${openClaudeAiBtnHtml({ disabled: !outlineConfirmed })}`,
        })}
        ${
          needServices
            ? contentActionRow({
                n: 2,
                label: 'Copy Services batch <span class="muted">(Required)</span>',
                loaded: Boolean(writeBatches.services || writeBatches.all),
                controlsHtml: `<button type="button" class="btn primary" id="cs-copy-write-services" ${
                  outlineConfirmed ? '' : 'disabled'
                }>Copy Services batch</button>
                ${openClaudeAiBtnHtml({ disabled: !outlineConfirmed })}`,
              })
            : ''
        }
        ${
          needLocations
            ? contentActionRow({
                n: 3,
                label: 'Copy Locations batch <span class="muted">(Required)</span>',
                loaded: Boolean(writeBatches.locations || writeBatches.all),
                controlsHtml: `<button type="button" class="btn primary" id="cs-copy-write-locations" ${
                  outlineConfirmed ? '' : 'disabled'
                }>Copy Locations batch</button>
                ${openClaudeAiBtnHtml({ disabled: !outlineConfirmed })}`,
              })
            : ''
        }
        ${contentActionRow({
          n: 4,
          label: 'Copy all (legacy) <span class="muted">(truncation risk)</span>',
          controlsHtml: `<button type="button" class="btn" id="cs-copy-write" data-tip="Prefer batched copies for ranking builds" ${
            outlineConfirmed ? '' : 'disabled'
          }>Copy all</button>`,
        })}
        ${contentActionRow({
          n: 5,
          label: 'Paste FILE blocks <span class="muted">(Required)</span>',
          controlsHtml: `<textarea id="ca-writer-paste" class="narrative-paste-input" rows="2" placeholder="### FILE: src/content/pages/index.md&#10;---&#10;..." data-tip="Paste ### FILE: markdown blocks"></textarea>`,
        })}
        ${contentActionRow({
          n: 6,
          label: 'Load FILE blocks as draft <span class="muted">(Required)</span>',
          controlsHtml: `<button type="button" class="btn primary" id="ca-paste-writer" data-tip="Parse FILE blocks into candidate draft" ${ready ? '' : 'disabled'}>Load FILE blocks as draft</button>`,
        })}`,
    }),
  );

  const editorStatusBits = [];
  if (stepDone.accepted) {
    editorStatusBits.push(
      `<div class="callout">Accepted site still live — Load creates a draft; Accept again to publish fixes.</div>`,
    );
  }
  if (!speechChecked && !stepDone.accepted) {
    editorStatusBits.push(
      `<div class="callout warn">Speech/SEO Refinement not run yet — Humanize stays incomplete until lint is clear.</div>`,
    );
  } else if (needsEditorClaude) {
    editorStatusBits.push(
      editorRewriteWhyHtml(
        editorNeeds,
        'Copy editor prompt on this step → Claude.ai → paste FILE blocks → Load.',
      ),
    );
  } else if (speechChecked && !stepDone.accepted) {
    editorStatusBits.push(
      `<div class="callout"><strong>Humanize clear.</strong> Up next: <strong>Final check</strong>.</div>
                <p class="muted">Speech/SEO Refinement run at ${esc(
                  String(lintSource?._ops?.lastSpeechCheckAt || ''),
                )}</p>`,
    );
  }
  const editorStatusCallout = editorStatusBits.join('\n');
  const editorClaudeChrome = hasEditableContent
    ? `        ${contentActionRow({
          n: 2,
          label: 'Copy editor prompt',
          hint: 'Passes 4–7: Burstiness → Perplexity → Bookends → Conversion + findings. Paste back only changed FILEs; Load merges.',
          controlsHtml: `<button type="button" class="btn primary" id="ca-copy-editor" data-tip="Copy findings-scoped editor prompt for Claude.ai" ${
            writeDone && ready ? '' : 'disabled'
          }>Copy editor prompt</button>
          ${openClaudeAiBtnHtml({ disabled: !(writeDone && ready) })}`,
        })}
        ${contentActionRow({
          n: 3,
          label: 'Paste revised FILE blocks',
          hint: 'Load here after Claude — Speech/SEO Refinement runs automatically.',
          controlsHtml: `<textarea id="ca-editor-paste" class="narrative-paste-input" rows="2" placeholder="### FILE: src/content/pages/index.md&#10;---&#10;..." data-tip="Paste revised ### FILE: blocks"></textarea>`,
        })}
        ${contentActionRow({
          n: 4,
          label: 'Load FILE blocks as draft',
          controlsHtml: `<button type="button" class="btn primary" id="ca-paste-editor" data-tip="Parse FILE blocks into candidate draft" ${writeDone && ready ? '' : 'disabled'}>Load FILE blocks as draft</button>`,
        })}`
    : `<p class="muted">Load Full write FILE blocks first.</p>`;

  parts.push(
    contentStepHtml({
      id: 'editor',
      num: 6,
      title: 'Humanize (Passes 4–7)',
      done: editorDone,
      open: openId === 'editor',
      current: currentId === 'editor' && !editorDone,
      locked: !writeDone,
      info: 'Required. Speech/SEO Refinement auto-fixes then re-lints. After Load, Speech/SEO runs automatically. Step is done when lint is clear. Copy editor prompt is for leftover findings and Passes 4–7.',
      bodyHtml: `
        ${incompleteDraftCalloutHtml(d)}
        ${contentActionRow({
          n: 1,
          label: 'Speech/SEO Refinement <span class="muted">(Required)</span>',
          hint: 'Auto-fixes soft issues, then re-lints. Always shows a result message.',
          controlsHtml: `<button type="button" class="btn primary" id="ca-speech-check" data-tip="Auto-fix + scan draft for speech + SEO issues" ${
            hasEditableContent && ready ? '' : 'disabled'
          }>Speech/SEO Refinement</button>`,
        })}
        <div id="ca-autofix-panel">${autoFixSummaryHtml(draft?._ops?.autoFix)}</div>
        <div id="ca-speech-lint-panel">${
          speechChecked ? speechLintFindingsHtml(draft?._ops?.speechLint) : ''
        }</div>
        <div id="ca-seo-lint-panel">${
          speechChecked ? seoLintFindingsHtml(draft?._ops?.seoLint) : ''
        }</div>
        ${editorStatusCallout}
        ${editorClaudeChrome}`,
    }),
  );

  parts.push(
    contentStepHtml({
      id: 'finalCheck',
      num: 7,
      title: 'Final check (Pass 8)',
      done: finalCheckDone,
      open: openId === 'finalCheck',
      current: currentId === 'finalCheck' && !finalCheckDone,
      locked: !editorDone,
      info: 'Required Pass 8. Copy final-check prompt → Claude returns {"ok":true} or ### FILE fixes → Load. Accept stays blocked until this runs.',
      bodyHtml: `
        ${
          finalOk
            ? `<div class="callout"><strong>Final check recorded</strong> at ${esc(
                String(draft?._ops?.lastFinalCheckAt || accepted?._ops?.lastFinalCheckAt || ''),
              )}${
                draft?._ops?.lastFinalCheckSummary
                  ? ` — ${esc(draft._ops.lastFinalCheckSummary)}`
                  : ''
              }</div>`
            : `<div class="callout warn">Required — run Final check before Accept.</div>`
        }
        ${contentActionRow({
          n: 1,
          label: 'Copy final-check prompt <span class="muted">(Required)</span>',
          controlsHtml: `<button type="button" class="btn primary" id="cs-copy-final" ${
            editorDone && writeFilesReady ? '' : 'disabled'
          }>Copy final-check prompt</button>
          ${openClaudeAiBtnHtml({ disabled: !(editorDone && writeFilesReady) })}`,
        })}
        ${contentActionRow({
          n: 2,
          label: 'Paste OK JSON or FILE fixes <span class="muted">(Required)</span>',
          controlsHtml: `<textarea id="cs-final-paste" class="narrative-paste-input" rows="2" placeholder='{"ok":true} or ### FILE: …'></textarea>`,
        })}
        ${contentActionRow({
          n: 3,
          label: 'Load final-check result <span class="muted">(Required)</span>',
          controlsHtml: `<button type="button" class="btn primary" id="cs-load-final" ${
            editorDone && writeFilesReady ? '' : 'disabled'
          }>Load final-check result</button>`,
        })}`,
    }),
  );

  } // !apiMode inner paste steps

  if (!apiMode && photosOn) {
    const imagePlanAt = String(
      d?.imagesPlan?.loadedAt ||
        draft?._ops?.lastImagesPlanAt ||
        accepted?._ops?.lastImagesPlanAt ||
        '',
    );
    const imageSlotN = Number(d?.imagesPlan?.slotCount || draft?._ops?.lastImagesPlanSlotCount || 0);
    parts.push(
      contentStepHtml({
        id: 'imageQueries',
        num: 8,
        title: 'Image queries',
        done: imageQueriesDone,
        open: openId === 'imageQueries',
        current: currentId === 'imageQueries' && !imageQueriesDone,
        locked: !finalCheckDone,
        info: 'Required. Copy prompt → paste JSON → Load. Stock slot queries plus before/after generate prompts. A photo group or niche master does not skip this step.',
        bodyHtml: `
        ${
          imageQueriesDone
            ? `<div class="callout"><strong>Image queries loaded</strong>${
                imagePlanAt ? ` at ${esc(imagePlanAt)}` : ''
              }${imageSlotN ? ` — ${esc(String(imageSlotN))} slot queries` : ''}</div>`
            : `<div class="callout warn">Required before Accept. Load Image queries even if you will Load a named photo group or use the niche master on step 9.</div>`
        }
        ${contentActionRow({
          n: 1,
          label: 'Copy image-queries prompt <span class="muted">(Required)</span>',
          hint: 'Lists every photo slot and every before/after key. Claude returns stock-search phrases plus inside/outside generate prompts. Do not skip.',
          controlsHtml: `<button type="button" class="btn primary" id="cs-copy-images" ${
            finalCheckDone && writeFilesReady ? '' : 'disabled'
          }>Copy image-queries prompt</button>
          ${openClaudeAiBtnHtml({ disabled: !(finalCheckDone && writeFilesReady) })}`,
        })}
        ${contentActionRow({
          n: 2,
          label: 'Paste image-queries JSON <span class="muted">(Required)</span>',
          controlsHtml: `<textarea id="cs-images-paste" class="narrative-paste-input" rows="2" placeholder='{"profile":{...},"slots":{"hero-1":{"query":"…"}},"beforeAfter":{"home:1":{...}}}'></textarea>`,
        })}
        ${contentActionRow({
          n: 3,
          label: 'Load image queries <span class="muted">(Required)</span>',
          controlsHtml: `<button type="button" class="btn primary" id="cs-load-images" ${
            finalCheckDone && writeFilesReady ? '' : 'disabled'
          }>Load image queries</button>`,
        })}`,
      }),
    );
  }

  if (photosOn) {
    parts.push(
      contentStepHtml({
        id: 'photoGroup',
        num: apiMode ? 3 : 9,
        title: 'Load photo group',
        done: photoGroupDone,
        open: openId === 'photoGroup',
        current: currentId === 'photoGroup' && !photoGroupDone,
        locked: apiMode ? !writeSiteDone : !finalCheckDone,
        info: 'Optional. Rank as many saved groups as you need. The 1st fills matching slots; later groups fill leftovers; extras go into trays. Empty slots take the first tray still as live. Or skip for stock / niche master. Save named groups later from Website → Review images or Photo.',
        bodyHtml: `
        ${
          photoGroupAttached
            ? `<div class="callout"><strong>Photo group${
                (d.photoGroupAttached.names || d.photoGroupAttached.groups || []).length > 1
                  ? 's'
                  : ''
              } “${esc(
                (d.photoGroupAttached.names || d.photoGroupAttached.groups?.map((g) => g.name) || [d.photoGroupAttached.name || d.photoGroupAttached.groupId]).filter(Boolean).join(' → '),
              )}”</strong> selected — Accept will load those photos instead of pulling stock.${
                d.photoGroupAttached.attachedAt
                  ? ` Attached ${esc(d.photoGroupAttached.attachedAt)}.`
                  : ''
              }</div>`
            : photoGroupSkipped
              ? `<div class="callout"><strong>Skipped</strong> — Accept will pull stock from Image queries.</div>`
              : d?.photoNicheMaster?.id
                ? `<div class="callout">Accept will use <strong>${esc(
                    d.photoNicheMaster.name ||
                      `${d.photoGroupNiche || d.photoNicheMaster.niche || 'Niche'} master`,
                  )}</strong>. Skip for a fresh stock Pull (Image queries required).</div>`
                : `<div class="callout">Optional — skip if you loaded Image queries for a fresh stock Pull.</div>`
        }
        ${contentActionRow({
          n: 1,
          label: 'Load a saved photo group',
          hint: 'Rank groups in order. Accept copies 1st, then fills leftovers from later groups. Empty slots take the first tray still as live; extras stay on trays. Logo and coverage map still generate.',
          done: photoGroupDone,
          controlsHtml: photoGroupToolbarHtml({
            selectId: 'cs-pg-select',
            loadId: 'cs-pg-load',
            skipId: 'cs-pg-skip',
            loadLabel: 'Load',
          }),
        })}`,
      }),
    );
  }

  const acceptReady =
    Boolean(draft) &&
    speechChecked &&
    fieldOk &&
    briefOk &&
    writeOk &&
    editorNeeds.speechN === 0 &&
    finalOk &&
    photosReady;
  parts.push(
    contentStepHtml({
      id: 'accept',
      num: apiMode ? (photosOn ? 4 : 3) : photosOn ? 10 : 8,
      title: 'Accept content',
      done: acceptDone,
      open: openId === 'accept',
      current: currentId === 'accept' && !stepDone.accepted,
      locked: apiMode ? !writeSiteDone || (photosOn && !photosReady) : !finalCheckDone || (photosOn && !photosReady),
      info: 'Accept writes shared src/content/. When photos are on, Image queries must be loaded first. Accept then copies a named group or niche master (including before/after pairs) or pulls stock (Skip on step 9). Logo + coverage map still run. Fresh stock Pull leaves before/after empty until Website → Review images → OpenAI pair.',
      bodyHtml: `
        ${incompleteDraftCalloutHtml(d)}
        ${
          !acceptReady && draft
            ? `<div class="callout warn">Accept locked until ${
                apiMode
                  ? 'Write site with Claude finishes'
                  : `Site research, Brief, Write batches, Humanize (Speech/SEO clear), and Final check${
                      photosOn ? ' — plus Image queries (step 8)' : ''
                    }`
              } — are done.</div>`
            : ''
        }
        ${
          seoCritical.length
            ? `<div class="callout warn"><strong>Critical SEO:</strong> ${esc(
                seoCritical.map((f) => f.excerpt || f.rule).join('; '),
              )}. Use Copy editor prompt on the Humanize step, or check override below.</div>
              <label class="check"><input type="checkbox" id="content-accept-seo-override" /> Accept with SEO warnings</label>`
            : ''
        }
        <div class="narrative-actions" style="justify-content:flex-end">
          <button type="button" class="btn primary" id="content-accept-btn" data-tip="Accept draft — write files into src/content/" ${
            acceptReady ? '' : 'disabled'
          }>Accept content</button>
        </div>
        ${check?.errors?.length ? `<div class="callout warn"><strong>Errors:</strong> ${esc(check.errors.join('; '))}</div>` : ''}
        ${
          check?.warnings?.length || contract?.warnings?.length
            ? `<div class="callout warn"><strong>Warnings:</strong> ${esc(
                [...(check?.warnings || []), ...(contract?.warnings || [])].join('; '),
              )}</div>`
            : ''
        }
        ${(() => {
          const written = accepted?._ops?.written;
          const paths =
            Array.isArray(written) && written.length
              ? written
              : fileList.length
                ? fileList
                : [];
          if (!paths.length && !accepted?._ops) return '';
          const summary = accepted?._ops
            ? `Last accept: ${esc(String(accepted._ops.written?.length || paths.length))} files · pruned ${esc(
                String(accepted._ops.pruned?.length || 0),
              )}`
            : `Draft files (${esc(String(paths.length))})`;
          if (!paths.length) {
            return `<p class="muted">${summary}</p>`;
          }
          const list = paths
            .map((p) => `<li><code>${esc(p)}</code></li>`)
            .join('');
          return `<details class="narrative-raw content-advanced">
            <summary>${summary}</summary>
            <ul class="narrative-list" style="margin:0.5rem 0 0">${list}</ul>
          </details>`;
        })()}`,
    }),
  );

  return `<div class="content-panel-wrap">${writeSiteOverlayHtml(photosOn)}${acceptOverlayHtml()}${parts.join('')}</div>`;
}

function imagesStatusLine(d, { withTime = true } = {}) {
  const m = d?.imagesManifest;
  if (!m?.files?.length) {
    const photosOn = Boolean(
      d?.contentStructure?.photos &&
        Object.values(d.contentStructure.photos).some((p) => p?.enabled),
    );
    if (!photosOn) return 'No Structure photo slots enabled — pull will skip.';
    return 'No images pulled yet. Accept content (auto stock + logo/map).';
  }
  const sources = m.sources || {};
  const srcPart = Object.keys(sources).length
    ? ` · ${Object.entries(sources)
        .map(([k, v]) => `${k}×${v}`)
        .join(' · ')}`
    : '';
  const at = withTime && m.pulledAt ? ` · ${m.pulledAt}` : '';
  return `${m.files.length} file(s) on disk${srcPart}${at}`;
}

function paintImagesStatusEl(el, d) {
  if (!el || !d) return;
  const short = imagesStatusLine(d, { withTime: false });
  const full = imagesStatusLine(d);
  el.textContent = short;
  el.setAttribute('data-tip', full);
  el.setAttribute('aria-label', full);
}

function imagesMatchDotHtml(grade, tip, { tipped = true, cycle = false, slotKey = '' } = {}) {
  const isEmpty = grade === 'missing' || grade === 'empty';
  const g = isEmpty
    ? 'empty'
    : grade === 'upload'
      ? 'upload'
      : grade === 'good' || grade === 'ok' || grade === 'poor'
        ? grade
        : 'poor';
  const cls = `img-match-dot img-match-${g}`;
  if (!tipped) {
    return `<span class="${cls}" aria-hidden="true"></span>`;
  }
  const canCycle = Boolean(cycle && slotKey && (g === 'poor' || g === 'ok' || g === 'good'));
  const tipText =
    tip ||
    (isEmpty
      ? 'No photo in this slot'
      : g === 'upload'
        ? 'Operator upload'
        : g === 'good'
          ? 'Good match'
          : g === 'ok'
            ? 'OK match'
            : 'Poor match');
  const cycleTip = canCycle ? `${tipText}. Click to cycle Poor, OK, Good.` : tipText;
  if (canCycle) {
    return `<button type="button" class="${cls} img-match-dot-cycle" data-slot-grade-cycle data-slot-key="${esc(
      slotKey,
    )}" data-grade="${esc(g)}" data-tip="${esc(cycleTip)}" aria-label="${esc(cycleTip)}"></button>`;
  }
  return `<span class="${cls}" data-tip="${esc(tipText)}" aria-label="${esc(tipText)}"></span>`;
}

function nextImageMatchGrade(grade) {
  if (grade === 'poor') return 'ok';
  if (grade === 'ok') return 'good';
  return 'poor';
}

function imagesSlotGrade(slot) {
  if (!slot) return null;
  if (slot.missing) return 'missing';
  if (slot.source === 'upload') return 'upload';
  const g = slot.matchGrade;
  return g === 'good' || g === 'ok' || g === 'poor' ? g : null;
}

function imagesMatchFilterId(activeFilter) {
  if (activeFilter === 'empty' || activeFilter === 'missing') return 'empty';
  return ['all', 'poor', 'ok', 'good', 'upload'].includes(activeFilter) ? activeFilter : 'all';
}

function imagesSlotMatchesFilter(slot, filter) {
  const grade = imagesSlotGrade(slot);
  const f = imagesMatchFilterId(filter);
  if (f === 'all') return true;
  if (f === 'empty') return grade === 'missing';
  return grade === f;
}

function imagesTitleQuery(q) {
  return String(q ?? '').trim().toLowerCase();
}

function imagesTextMatchesTitle(text, q) {
  const n = imagesTitleQuery(q);
  if (!n) return true;
  return String(text || '').toLowerCase().includes(n);
}

function imagesSlotTitle(slot) {
  return String(slot?.label || slot?.key || '');
}

function reviewBaTitle(pair) {
  if (!pair) return '';
  return pair.serviceName
    ? `Before & after — ${pair.serviceName}`
    : `Before & after — home ${pair.pairIndex || 1}`;
}

function imagesSlotMatchesTitle(slot, q) {
  return imagesTextMatchesTitle(imagesSlotTitle(slot), q);
}

function imagesSourceFilterId(activeFilter) {
  return ['all', 'stock', 'openai'].includes(activeFilter) ? activeFilter : 'all';
}

function imagesSlotSourceKind(slot) {
  if (!slot || slot.missing) return null;
  const src = String(slot.source || '').toLowerCase();
  if (src === 'openai' || src === 'stock') return src;
  if (src === 'upload' || src === 'chatgpt') return src;
  if (src === 'flux') return null;
  if (slot.provider) return 'stock';
  return src || null;
}

function imagesSlotSourceLabel(slot) {
  if (!slot || slot.missing) return 'missing';
  const src = String(slot.source || '').trim();
  if (!src || src.toLowerCase() === 'flux') return '';
  return src;
}

function imagesSlotMatchesSource(slot, filter) {
  const f = imagesSourceFilterId(filter);
  if (f === 'all') return true;
  return imagesSlotSourceKind(slot) === f;
}

function imagesMatchGradeSelectLabel(filterId) {
  return (
    {
      poor: 'Poor',
      ok: 'Ok',
      good: 'Good',
      upload: 'Uploaded',
      empty: 'Empty',
    }[imagesMatchFilterId(filterId)] || 'slots'
  );
}

function imagesMatchTotalsHtml(totals, activeFilter = 'all') {
  const t = totals || {};
  const poor = Number(t.poor) || 0;
  const ok = Number(t.ok) || 0;
  const good = Number(t.good) || 0;
  const uploaded = Number(t.uploaded) || 0;
  const missing = Number(t.missing) || 0;
  const total = poor + ok + good + uploaded + missing;
  const active = imagesMatchFilterId(activeFilter);
  const filterBtn = (id, inner, tip) => {
    const pressed = active === id;
    return `<button type="button" class="img-match-totals-btn${
      pressed ? ' is-active' : ''
    }" data-match-filter="${esc(id)}" aria-pressed="${pressed ? 'true' : 'false'}" data-tip="${esc(
      tip,
    )}">${inner}</button>`;
  };
  const gradeSelect = (filterId, label, count) => {
    const disabled = count < 1 ? ' disabled' : '';
    return `<button type="button" class="btn btn-sm img-match-grade-select" data-grade-select="${esc(
      filterId,
    )}" data-tip="${esc(`Select all ${label} — click again to clear`)}"${disabled}>Select</button>`;
  };
  const gradeGroup = (filterId, inner, tip, count) => `<span class="img-match-totals-group">
      ${filterBtn(filterId, inner, tip)}
      ${gradeSelect(filterId, imagesMatchGradeSelectLabel(filterId), count)}
    </span>`;
  const untipped = { tipped: false };
  return `<div class="img-match-totals" role="toolbar" aria-label="Photo match filters">
    ${filterBtn(
      'all',
      `<strong>${esc(String(total))}</strong>
      <span class="muted">All</span>`,
      `Show all ${total} photo slot${total === 1 ? '' : 's'}`,
    )}
    ${gradeGroup(
      'poor',
      `${imagesMatchDotHtml('poor', null, untipped)}
      <strong>${esc(String(poor))}</strong>
      <span class="muted">Poor</span>`,
      `Show ${poor} Poor match${poor === 1 ? '' : 'es'} (filled slots only)`,
      poor,
    )}
    ${gradeGroup(
      'ok',
      `${imagesMatchDotHtml('ok', null, untipped)}
      <strong>${esc(String(ok))}</strong>
      <span class="muted">Ok</span>`,
      `Show ${ok} Ok match${ok === 1 ? '' : 'es'}`,
      ok,
    )}
    ${gradeGroup(
      'good',
      `${imagesMatchDotHtml('good', null, untipped)}
      <strong>${esc(String(good))}</strong>
      <span class="muted">Good</span>`,
      `Show ${good} Good match${good === 1 ? '' : 'es'}`,
      good,
    )}
    ${gradeGroup(
      'upload',
      `${imagesMatchDotHtml('upload', null, untipped)}
      <strong>${esc(String(uploaded))}</strong>
      <span class="muted">Uploaded</span>`,
      `Show ${uploaded} operator upload${uploaded === 1 ? '' : 's'}`,
      uploaded,
    )}
    ${gradeGroup(
      'empty',
      `${imagesMatchDotHtml('missing', null, untipped)}
      <strong>${esc(String(missing))}</strong>
      <span class="muted">Empty</span>`,
      `Show ${missing} Empty slot${missing === 1 ? '' : 's'}`,
      missing,
    )}
  </div>`;
}

function rememberOpenaiStatus(data) {
  const src = data?.openai || data?.flux;
  if (src && typeof src === 'object' && src.openaiKeySet != null) {
    state.flux = { openaiKeySet: Boolean(src.openaiKeySet) };
  }
}

function fluxIsOpenaiConfigured(flux) {
  return Boolean(
    flux?.openaiKeySet ||
      state.flux?.openaiKeySet ||
      state.photoLib?.flux?.openaiKeySet ||
      state.apiCostConfigured?.openai,
  );
}

function candidateOpenaiSpend(c) {
  const n = Number(c?.lastCosts?.openai ?? c?.meta?.lastCosts?.openai);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function openaiSpendText(detail) {
  return `OpenAI spend ${formatMoney(candidateOpenaiSpend(detail))}`;
}

function openaiSpendLineHtml(detail) {
  return `<p id="ca-openai-spend" class="muted">${esc(openaiSpendText(detail))}</p>`;
}

function renderOpenaiSpendLine() {
  const el = document.getElementById('ca-openai-spend');
  if (!el) return;
  el.textContent = openaiSpendText(state.detail);
}

function patchListLastCosts(candidate) {
  if (!candidate?.id) return;
  const costs = candidate.lastCosts || candidate.meta?.lastCosts;
  if (!costs) return;
  const row = (state.candidates || []).find((c) => c.id === candidate.id);
  if (row) row.lastCosts = { ...(row.lastCosts || {}), ...costs };
}

/** Keep the table row's Live / Type / W in sync with the open detail (launch, Push, Revert). */
function syncListRowFromDetail(candidate) {
  if (!candidate?.id) return;
  const list = state.candidates || [];
  const i = list.findIndex((c) => c.id === candidate.id);
  if (i < 0) return;
  const prev = list[i];
  const beforeLive = isCandidateLaunched(prev);
  const beforeTrack = candidateHighestWebsiteTrack(prev);
  const beforeRank = candidatePipelineRank(prev);
  const next = {
    ...prev,
    meta: candidate.meta || prev.meta,
    stageFlags: { ...(prev.stageFlags || {}), ...(candidate.stageFlags || {}) },
    lastCosts: candidate.lastCosts || candidate.meta?.lastCosts || prev.lastCosts,
    decision: candidate.meta?.decision ?? prev.decision,
    updatedAt: candidate.meta?.updatedAt || prev.updatedAt,
  };
  list[i] = next;
  if (
    beforeLive !== isCandidateLaunched(next) ||
    beforeTrack !== candidateHighestWebsiteTrack(next) ||
    beforeRank !== candidatePipelineRank(next)
  ) {
    renderList();
    notifyCandidatesChanged({ type: 'candidates', ids: [candidate.id] });
  }
}

function slotCheckHtml({ id, checked, extraClass = '' }) {
  return `<label class="slot-check${extraClass ? ` ${extraClass}` : ''}"><input type="checkbox" class="slot-check-input" data-check-id="${esc(id)}"${checked ? ' checked' : ''} /></label>`;
}

function slotThumbImg(src, { alt = '', role = '' } = {}) {
  if (!src) {
    return `<div class="slot-thumb-empty muted">${role ? esc(role) : ''}</div>`;
  }
  return `<img class="slot-zoom-img" src="${esc(src)}" alt="${esc(alt)}" data-zoom-src="${esc(src)}" data-zoom-alt="${esc(alt || role)}" loading="lazy" />`;
}

function slotAiMark(kind) {
  if (kind === 'openai') {
    return '<svg class="btn-ai-logo" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 1.4 12.8 4.2v5.6L8 12.6 3.2 9.8V4.2L8 1.4zm0 1.9L4.8 5v4l3.2 1.8L11.2 9V5L8 3.3zm0 2.1 2.1 1.2v2.4L8 10.2 5.9 9V6.6L8 5.4z"/></svg>';
  }
  if (kind === 'chatgpt') {
    return '<svg class="btn-ai-logo" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 2.5h10c.8 0 1.5.7 1.5 1.5v6c0 .8-.7 1.5-1.5 1.5H7.2L3.5 14.2V11.5H3c-.8 0-1.5-.7-1.5-1.5v-6C1.5 3.2 2.2 2.5 3 2.5z"/></svg>';
  }
  return '';
}

function chatgptOpenBtnHtml() {
  return `<a class="btn btn-sm btn-ai" href="https://chatgpt.com/" target="_blank" rel="noopener" data-tip="Open ChatGPT in a new tab">${slotAiMark('chatgpt')}<span>ChatGPT</span></a>`;
}

function photoGroupsAttachedOnDetail() {
  const doc = state.detail?.photoGroupAttached;
  if (!doc || doc.skipped) return false;
  if (Array.isArray(doc.groupIds) && doc.groupIds.length) return true;
  return Boolean(doc.groupId);
}

function variantTrayHtml(variants, { ba = false, seeMore = false, slotKey = '' } = {}) {
  const list = Array.isArray(variants)
    ? variants.filter((v) =>
        ba ? v.id && v.beforeUrl && v.afterUrl : v.filename && v.previewUrl,
      )
    : [];
  const shown = seeMore ? list.slice(0, 7) : list;
  const cards = shown
    .map((v) => {
      if (ba) {
        return `<button type="button" class="slot-variant ba slot-variant-use" data-pair-id="${esc(v.id)}" data-before-filename="${esc(v.beforeFilename || '')}" data-tip="Use this before/after pair">
          <div class="slot-variant-pair">
            ${v.beforeUrl ? `<img src="${esc(v.beforeUrl)}" alt="" data-zoom-src="${esc(v.beforeUrl)}" class="slot-zoom-tray" />` : '<div></div>'}
            ${v.afterUrl ? `<img src="${esc(v.afterUrl)}" alt="" data-zoom-src="${esc(v.afterUrl)}" class="slot-zoom-tray" />` : '<div></div>'}
          </div>
        </button>`;
      }
      return `<button type="button" class="slot-variant slot-variant-use" data-filename="${esc(v.filename)}" data-tip="Use this photo">
        <img src="${esc(v.previewUrl)}" alt="" data-zoom-src="${esc(v.previewUrl)}" class="slot-zoom-tray" />
      </button>`;
    })
    .join('');
  const moreBtn =
    seeMore && slotKey
      ? `<button type="button" class="slot-variant slot-see-more" data-slot-key="${esc(slotKey)}"${ba ? ' data-ba="1"' : ''} data-tip="${ba ? 'Browse before/after pairs to use in this slot' : 'Browse photos to use in this slot'}">See More</button>`
      : '';
  if (!cards && !moreBtn) return '';
  return `<div class="slot-variant-tray">${cards}${moreBtn}</div>`;
}

async function openLoadedGroupSeeMore(candidateId, slotKey) {
  let data;
  try {
    data = await withReviewImagesWork({ label: 'Loading photos…' }, () =>
      api(`/api/candidates/${encodeURIComponent(candidateId)}/photo-groups/stills`),
    );
  } catch (error) {
    await showModal({
      title: 'See More failed',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
    return;
  }
  const photos = Array.isArray(data?.photos) ? data.photos : [];
  if (!photos.length) {
    await showModal({
      title: 'See More',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: '<p>No photos in the loaded photo groups.</p>',
    });
    return;
  }
  const names = (data.names || []).filter(Boolean).join(' → ');
  await showSeeMorePicker({
    title: names ? `Loaded groups — ${names}` : 'Loaded photo groups',
    photos,
    onPick: async (groupId, filename) => {
      await withReviewImagesWork(
        {
          label: 'Loading photo…',
          key: slotKey,
          card: document.querySelector(reviewCardAttrSel('data-slot-key', slotKey)),
        },
        async () => {
          const used = await api(
            `/api/candidates/${encodeURIComponent(candidateId)}/images/slots/${encodeURIComponent(slotKey)}/use-group-file`,
            {
              method: 'POST',
              body: JSON.stringify(withLaunchedConfirmBody({ groupId, filename })),
            },
          );
          await refreshImageSlotInPlace(candidateId, { slotKey, status: used.status });
          showToast('Loaded photo from group.');
        },
      );
    },
  });
}

async function openLoadedGroupBaSeeMore(candidateId, slotKey) {
  let data;
  try {
    data = await withReviewImagesWork({ label: 'Loading photos…' }, () =>
      api(`/api/candidates/${encodeURIComponent(candidateId)}/photo-groups/ba-pairs`),
    );
  } catch (error) {
    await showModal({
      title: 'See More failed',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
    return;
  }
  const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
  if (!pairs.length) {
    await showModal({
      title: 'See More',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: '<p>No before/after pairs in the loaded photo groups.</p>',
    });
    return;
  }
  const names = (data.names || []).filter(Boolean).join(' → ');
  const refreshKey = slotKey.startsWith('ba:') ? slotKey : `ba:${slotKey}`;
  await showSeeMorePicker({
    title: names ? `Loaded groups — ${names}` : 'Loaded photo groups',
    photos: pairs,
    ba: true,
    onPick: async ({ groupId, beforeFilename, afterFilename }) => {
      await withReviewImagesWork(
        {
          label: 'Loading pair…',
          key: slotKey,
          card: document.querySelector(reviewCardAttrSel('data-match-key', slotKey)),
        },
        async () => {
          const used = await api(
            `/api/candidates/${encodeURIComponent(candidateId)}/images/before-after/use-group-pair`,
            {
              method: 'POST',
              body: JSON.stringify(
                withLaunchedConfirmBody({ matchKey: slotKey, groupId, beforeFilename, afterFilename }),
              ),
            },
          );
          await refreshImageSlotInPlace(candidateId, { slotKey: refreshKey, status: used.status });
          showToast('Loaded before/after pair from group.');
        },
      );
    },
  });
}

function photoLibGroupStills() {
  const lib = photoLibCurrent();
  const groupId = lib.groupId;
  const groupName = lib.view?.group?.name || '';
  const photos = [];
  const seen = new Set();
  const add = (filename, previewUrl, label) => {
    if (!filename || !previewUrl || seen.has(`${groupId}\0${filename}`)) return;
    seen.add(`${groupId}\0${filename}`);
    photos.push({ groupId, groupName, filename, previewUrl, label });
  };
  for (const sec of lib.view?.sections || []) {
    for (const s of sec.slots || []) {
      add(s.filename, s.previewUrl, s.label || s.filename);
      for (const v of s.variants || []) {
        add(v.filename, v.previewUrl, s.label || v.filename);
      }
    }
  }
  return { photos, groupName, groupId };
}

async function openPhotoLibSeeMore(matchKey) {
  const { photos, groupName, groupId } = photoLibGroupStills();
  if (!groupId) return;
  if (!photos.length) {
    await showModal({
      title: 'See More',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: '<p>No photos in this group.</p>',
    });
    return;
  }
  await showSeeMorePicker({
    title: groupName ? `Group — ${groupName}` : 'Photo group',
    photos,
    onPick: async (fromGroupId, filename) => {
      beginSlotBusy(matchKey, document.querySelector(`#photo-group-body ${reviewCardAttrSel('data-match-key', matchKey)}`));
      await api(`/api/photo-groups/${encodeURIComponent(groupId)}/slots/use-file`, {
        method: 'POST',
        body: JSON.stringify({ matchKey, fromGroupId, filename }),
      });
      await loadPhotoGroupView();
      renderPhotoView();
      await settleSlotBusy(matchKey);
      showToast('Loaded photo from group.');
    },
  });
}

function photoLibGroupBaPairs() {
  const lib = photoLibCurrent();
  const groupId = lib.groupId;
  const groupName = lib.view?.group?.name || '';
  const pairs = [];
  const seen = new Set();
  const add = (beforeFilename, afterFilename, beforeUrl, afterUrl, label) => {
    if (!beforeFilename || !afterFilename || !beforeUrl || !afterUrl) return;
    const id = `${groupId}\0${beforeFilename}\0${afterFilename}`;
    if (seen.has(id)) return;
    seen.add(id);
    pairs.push({
      groupId,
      groupName,
      beforeFilename,
      afterFilename,
      beforeUrl,
      afterUrl,
      label,
    });
  };
  const labelFor = (p) => {
    const role = p.serviceName ? p.serviceName : `Home ${p.pairIndex || 1}`;
    return groupName ? `${role} · ${groupName}` : role;
  };
  for (const p of [...(lib.view?.beforeAfter?.home || []), ...(lib.view?.beforeAfter?.services || [])]) {
    add(p.before?.filename, p.after?.filename, p.beforeUrl, p.afterUrl, labelFor(p));
    for (const v of p.variants || []) {
      add(v.beforeFilename, v.afterFilename, v.beforeUrl, v.afterUrl, labelFor(p));
    }
  }
  return { pairs, groupName, groupId };
}

async function openPhotoLibBaSeeMore(matchKey) {
  const { pairs, groupName, groupId } = photoLibGroupBaPairs();
  if (!groupId) return;
  if (!pairs.length) {
    await showModal({
      title: 'See More',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: '<p>No before/after pairs in this group.</p>',
    });
    return;
  }
  await showSeeMorePicker({
    title: groupName ? `Group — ${groupName}` : 'Photo group',
    photos: pairs,
    ba: true,
    onPick: async ({ groupId: fromGroupId, beforeFilename, afterFilename }) => {
      beginSlotBusy(
        matchKey,
        document.querySelector(`#photo-group-body ${reviewCardAttrSel('data-match-key', matchKey)}`),
      );
      await api(`/api/photo-groups/${encodeURIComponent(groupId)}/before-after/use-pair`, {
        method: 'POST',
        body: JSON.stringify({ matchKey, fromGroupId, beforeFilename, afterFilename }),
      });
      await loadPhotoGroupView();
      renderPhotoView();
      await settleSlotBusy(matchKey);
      showToast('Loaded before/after pair from group.');
    },
  });
}

async function showSeeMorePicker({ title, photos, ba = false, onPick }) {
  const cards = photos
    .map((p) => {
      if (ba) {
        return `<button type="button" class="see-more-card ba" data-group-id="${esc(p.groupId)}" data-before-filename="${esc(p.beforeFilename)}" data-after-filename="${esc(p.afterFilename)}">
        <div class="slot-variant-pair">
          <img class="slot-zoom-tray" src="${esc(p.beforeUrl)}" alt="" data-zoom-src="${esc(p.beforeUrl)}" />
          <img class="slot-zoom-tray" src="${esc(p.afterUrl)}" alt="" data-zoom-src="${esc(p.afterUrl)}" />
        </div>
        <span class="see-more-card-meta">${esc(p.label || '')}</span>
      </button>`;
      }
      return `<button type="button" class="see-more-card" data-group-id="${esc(p.groupId)}" data-filename="${esc(p.filename)}">
        <img class="slot-zoom-tray" src="${esc(p.previewUrl)}" alt="${esc(p.label || '')}" data-zoom-src="${esc(p.previewUrl)}" />
        <span class="see-more-card-meta">${esc(p.label || p.filename)}</span>
      </button>`;
    })
    .join('');
  const hint = ba
    ? 'Click a pair to use it in this slot. Previous live pair goes to the tray.'
    : 'Click a photo to use it in this slot. Previous live photo goes to the tray.';
  let picked = null;
  await showModal({
    title,
    confirmLabel: 'Close',
    hideCancel: true,
    bodyHtml: `<p class="muted">${hint}</p>
      <input id="see-more-search" class="modal-type-confirm-input see-more-search" type="search" placeholder="Search titles…" autocomplete="off" spellcheck="false" />
      <p class="muted small see-more-empty hidden">No matching titles</p>
      <div class="see-more-grid">${cards}</div>`,
    afterOpen: (bodyEl) => {
      const searchEl = bodyEl.querySelector('#see-more-search');
      const emptyEl = bodyEl.querySelector('.see-more-empty');
      const cardEls = [...bodyEl.querySelectorAll('.see-more-card')];
      const applyFilter = () => {
        const q = String(searchEl?.value || '')
          .trim()
          .toLowerCase();
        let visible = 0;
        for (const btn of cardEls) {
          const label = (btn.querySelector('.see-more-card-meta')?.textContent || '').toLowerCase();
          const match = !q || label.includes(q);
          btn.classList.toggle('hidden', !match);
          if (match) visible += 1;
        }
        emptyEl?.classList.toggle('hidden', visible > 0);
      };
      searchEl?.addEventListener('input', applyFilter);
      searchEl?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') e.preventDefault();
      });
      setTimeout(() => searchEl?.focus(), 0);
      cardEls.forEach((btn) => {
        btn.addEventListener('click', () => {
          if (picked) return;
          const groupId = btn.getAttribute('data-group-id');
          if (ba) {
            const beforeFilename = btn.getAttribute('data-before-filename');
            const afterFilename = btn.getAttribute('data-after-filename');
            if (!groupId || !beforeFilename || !afterFilename) return;
            picked = { groupId, beforeFilename, afterFilename };
          } else {
            const filename = btn.getAttribute('data-filename');
            if (!groupId || !filename) return;
            picked = { groupId, filename };
          }
          for (const card of cardEls) card.disabled = true;
          document.getElementById('modal-confirm')?.click();
        });
      });
    },
  });
  if (!picked) return;
  try {
    if (ba) await onPick(picked);
    else await onPick(picked.groupId, picked.filename);
  } catch (error) {
    await settleSlotBusy();
    await showModal({
      title: ba ? 'Use pair failed' : 'Use photo failed',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
  }
}

function openaiGenerateBtnHtml({ pair = false, extra = '', bulk = false, flux } = {}) {
  const configured = fluxIsOpenaiConfigured(flux);
  const label = pair ? 'OpenAI pair' : 'OpenAI';
  const tip = configured
    ? bulk
      ? 'GPT Image 2: generate each selected photo slot (~$0.04) and Before & after pair (~$0.09). Replaces live files; previous go to the tray. Tray keeps 8; oldest is removed. Uses Inside/Outside.'
      : pair
      ? 'GPT Image 2 medium. ChatGPT-style prompts for the current Inside/Outside. Generate Before, then edit After. ~$0.09. Replaces live pair; previous goes to the tray. Tray keeps 8; oldest is removed.'
      : 'GPT Image 2 medium. ChatGPT-style prompt for the current Inside/Outside. ~$0.04. Replaces the live slot; previous photo goes to the tray. Tray keeps 8; oldest is removed.'
    : 'Set OPENAI_API_KEY in .env (same key as Phone), then restart Rover.';
  const disabled = configured ? '' : ' disabled';
  const bulkClass = bulk ? ' slot-generate-selected-openai' : '';
  return `<button type="button" class="btn btn-sm btn-ai slot-generate-openai${pair ? ' ba' : ''}${bulkClass}" data-tip="${esc(tip)}"${disabled}${extra}>${slotAiMark('openai')}<span>${esc(label)}</span></button>`;
}

function slotSourceActionsHtml({
  kind = 'photo',
  viewpointKey,
  generateExtra = '',
  copyHtml = '',
  filesHtml = '',
} = {}) {
  const generate =
    kind === 'ba'
      ? openaiGenerateBtnHtml({ pair: true, extra: generateExtra })
      : openaiGenerateBtnHtml({ extra: generateExtra });
  const files = String(filesHtml || '').trim()
    ? `<div class="slot-files-row">${filesHtml}</div>`
    : '';
  return `<div class="slot-source-actions">
    <div class="slot-ai-group">
      ${baViewpointSegmentHtml(viewpointKey)}
      <div class="slot-ai-group-btns">${generate}${copyHtml}${chatgptOpenBtnHtml()}</div>
    </div>
    ${files}
  </div>`;
}

function selectedGenerateCostLine(nSlots, nPairs) {
  const gen = 0.04;
  const pair = 0.09;
  const total = nSlots * gen + nPairs * pair;
  const bits = [];
  if (nSlots) bits.push(`${nSlots} photo${nSlots === 1 ? '' : 's'} ≈ $${(nSlots * gen).toFixed(2)}`);
  if (nPairs) bits.push(`${nPairs} pair${nPairs === 1 ? '' : 's'} ≈ $${(nPairs * pair).toFixed(2)}`);
  return bits.length ? `${bits.join(' · ')} (about $${total.toFixed(2)})` : '';
}

function countSelectedBySource(slots, checks) {
  const out = { stock: 0, openai: 0 };
  for (const s of slots || []) {
    if (!checks?.[s.key]) continue;
    const k = imagesSlotSourceKind(s);
    if (k === 'stock' || k === 'openai') out[k] += 1;
  }
  return out;
}

function fluxToolbarHtml({
  nSlots,
  nPairs,
  flux,
  id,
  repull = false,
  sourceCounts = null,
  titleSearch = false,
}) {
  const n = nSlots + nPairs;
  const openaiExtra = n < 1 ? ' disabled' : '';
  const repullBtn = repull
    ? `<button type="button" class="btn btn-sm review-selected-repull" data-tip="Re-pull stock for selected photo slots (not Before &amp; after)"${
        nSlots < 1 ? ' disabled' : ''
      }>Re-pull</button>`
    : '';
  const unselectBtn = `<button type="button" class="btn btn-sm flux-unselect-all" data-tip="Clear every selected photo and before/after"${
    n < 1 ? ' disabled' : ''
  }>Unselect all</button>`;
  const source = imagesSourceFilterId(state.imageSourceFilter);
  const counts = sourceCounts || { stock: 0, openai: 0 };
  const sourceBtn = (filterId, label, tip) => {
    const pressed = source === filterId;
    return `<button type="button" class="btn btn-sm review-source-filter${
      pressed ? ' is-active' : ''
    }" data-source-filter="${esc(filterId)}" aria-pressed="${pressed ? 'true' : 'false'}" data-tip="${esc(
      tip,
    )}">${esc(label)}</button>`;
  };
  const sourceBtns = repull
    ? `<span class="review-source-filters" role="group" aria-label="Filter by source">${sourceBtn(
        'stock',
        `Stock ${counts.stock}`,
        'Show stock photos only — click again for all',
      )}${sourceBtn(
        'openai',
        `OpenAI ${counts.openai}`,
        'Show OpenAI photos only — click again for all',
      )}</span>`
    : '';
  const titleSearchHtml = titleSearch
    ? `<input id="review-title-search" class="modal-type-confirm-input flux-toolbar-title-search" type="search" placeholder="Search titles…" autocomplete="off" spellcheck="false" value="${esc(state.imageTitleFilter || '')}" />`
    : '';
  return `<div class="flux-toolbar" id="${esc(id)}">
    <span class="review-selected-count">Selected images ${esc(String(n))}</span>
    ${unselectBtn}
    ${sourceBtns}
    <span class="flux-toolbar-sep" role="separator" aria-hidden="true"></span>
    <span class="flux-toolbar-generate-label">Generate</span>
    ${repullBtn}
    ${openaiGenerateBtnHtml({ bulk: true, extra: openaiExtra, flux })}
    ${titleSearchHtml}
  </div>`;
}

function imagesSlotCardHtml(slot) {
  const checked = Boolean(state.imageSlotChecks?.[slot.key]);
  const thumb = slotThumbImg(slot.previewUrl, { role: 'Empty' });
  const grade = imagesSlotGrade(slot);
  const tip =
    grade === 'upload'
      ? 'Operator upload'
      : slot.matchTip ||
        (slot.missing
          ? 'No photo in this slot'
          : slot.score != null
            ? `Score ${slot.score}`
            : '');
  const matchDot = grade
    ? imagesMatchDotHtml(grade, tip, { cycle: true, slotKey: slot.key })
    : '';
  const sourceLabel = imagesSlotSourceLabel(slot);
  const badge = sourceLabel
    ? `<span class="muted" style="font-size:0.75rem">${esc(sourceLabel)}</span>`
    : '';
  return `<div class="image-slot-card" data-slot-key="${esc(slot.key)}" style="border:1px solid var(--border);border-radius:6px;overflow:hidden;background:var(--bg-subtle)">
    ${slotCheckHtml({ id: slot.key, checked })}
    <div class="slot-thumb" style="aspect-ratio:16/10;background:#0f172a0d;display:flex;align-items:center;justify-content:center">${thumb}</div>
    <div style="padding:0.45rem 0.55rem;display:flex;flex-direction:column;gap:0.25rem">
      <strong style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem">${matchDot}${esc(slot.label || slot.key)}</strong>
      ${badge}
      ${slotSourceActionsHtml({
        kind: 'photo',
        viewpointKey: slot.key,
        generateExtra: ` data-slot-key="${esc(slot.key)}"`,
        copyHtml: `<button type="button" class="btn btn-sm ca-slot-chatgpt-prompt" data-slot-key="${esc(slot.key)}" data-tip="Copy a ChatGPT image prompt for this slot (uses Inside/Outside), then generate and Upload">Copy prompt</button>`,
        filesHtml: `<button type="button" class="btn btn-sm ca-slot-repull" data-slot-key="${esc(slot.key)}" data-tip="Fetch a different stock photo for this slot">Re-pull</button>
        <label class="btn btn-sm" style="cursor:pointer;margin:0" data-tip="Upload a local image for this slot">
          Upload
          <input type="file" class="ca-slot-upload" data-slot-key="${esc(slot.key)}" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
        </label>`,
      })}
      ${slotPromptPanelHtml({ kind: 'photo', key: slot.key })}
    </div>
    ${variantTrayHtml(slot.variants, {
      seeMore: photoGroupsAttachedOnDetail(),
      slotKey: slot.key,
    })}
  </div>`;
}

function reviewBaCardHtml(candidateId, pair) {
  const key = pair.matchKey || (pair.slug ? `svc:${pair.slug}` : `home:${pair.pairIndex || 1}`);
  const checkId = `ba:${key}`;
  const checked = Boolean(state.imageSlotChecks?.[checkId]);
  const label = reviewBaTitle(pair);
  const kind = pair.slug ? 'service' : 'home';
  const slot = baPairAsReviewSlot(pair);
  const grade = imagesSlotGrade(slot);
  const tip =
    grade === 'upload'
      ? 'Operator upload'
      : pair.matchTip || (slot.missing ? 'No photo in this slot' : '');
  const matchDot = grade ? imagesMatchDotHtml(grade, tip, { cycle: true, slotKey: checkId }) : '';
  const sourceLabel = imagesSlotSourceLabel(slot);
  const badge = sourceLabel
    ? `<span class="muted" style="font-size:0.75rem">${esc(sourceLabel)}</span>`
    : '';
  return `<div class="image-slot-card photo-ba-card" data-ba="1" data-ba-kind="${esc(kind)}" data-match-key="${esc(key)}" data-pair-index="${esc(String(pair.pairIndex || 1))}" data-service-slug="${esc(pair.slug || '')}" style="border:1px solid var(--border);border-radius:6px;overflow:hidden;background:var(--bg-subtle)">
    ${slotCheckHtml({ id: checkId, checked })}
    <div class="ba-pair-thumbs">
      <figure>${slotThumbImg(pair.beforeUrl, { alt: 'Before' })}<figcaption class="muted">Before</figcaption></figure>
      <figure>${slotThumbImg(pair.afterUrl, { alt: 'After' })}<figcaption class="muted">After</figcaption></figure>
    </div>
    <div style="padding:0.45rem 0.55rem;display:flex;flex-direction:column;gap:0.25rem">
      <strong style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem">${matchDot}${esc(label)}</strong>
      ${badge}
      ${slotSourceActionsHtml({
        kind: 'ba',
        viewpointKey: key,
        generateExtra: ` data-match-key="${esc(key)}"`,
        copyHtml: `<button type="button" class="btn btn-sm ca-ba-card-copy" data-ba-kind="before" data-service-slug="${esc(pair.slug || '')}" data-tip="Copy the current Inside/Outside BEFORE prompt (same text OpenAI pair uses)">Copy before</button>
        <button type="button" class="btn btn-sm ca-ba-card-copy" data-ba-kind="after" data-service-slug="${esc(pair.slug || '')}" data-tip="Copy the current Inside/Outside AFTER prompt (same text OpenAI pair uses)">Copy after</button>`,
        filesHtml: `<label class="btn btn-sm" style="cursor:pointer;margin:0" data-tip="Replaces the live pair; previous goes to the tray. Tray keeps 8; oldest is removed.">
          Import pair
          <input type="file" class="ca-ba-card-import" data-service-slug="${esc(pair.slug || '')}" data-pair-index="${esc(String(pair.pairIndex || 1))}" accept="image/jpeg,image/png,image/webp" multiple hidden />
        </label>`,
      })}
      ${slotPromptPanelHtml({ kind: 'ba', key, pair })}
    </div>
    ${variantTrayHtml(pair.variants, {
      ba: true,
      seeMore: photoGroupsAttachedOnDetail(),
      slotKey: key,
    })}
  </div>`;
}

function siteImageFileUrl(candidateId, filename, bust) {
  if (!candidateId || !filename) return '';
  const q = bust ? `?v=${encodeURIComponent(bust)}` : '';
  return `/api/candidates/${encodeURIComponent(candidateId)}/images/file/${encodeURIComponent(filename)}${q}`;
}

function logoMapPreviewCardHtml({ src, label, alt, emptyRole, kind }) {
  const thumb = slotThumbImg(src, { alt, role: emptyRole });
  return `<div class="image-slot-card logo-map-preview logo-map-preview-${esc(kind)}">
    <div class="slot-thumb slot-thumb-contain">${thumb}</div>
    <strong>${esc(label)}</strong>
  </div>`;
}

function mapLabelPlacementSegmentHtml(selected) {
  const mode = String(selected || '').toLowerCase() === 'center' ? 'center' : 'callout';
  const tip =
    'Centered = city name on the city. Callout = name off to the side with a line. Click Regenerate coverage map to apply (does not re-run Nominatim on toggle alone).';
  return `<div class="ads-mode-segment" id="ca-map-label-placement" role="group" aria-label="City label placement" ${tipAttr(
    tip,
  )}>
    <button type="button" class="ads-mode-seg${
      mode === 'center' ? ' active' : ''
    }" data-map-label-placement="center">Centered</button>
    <button type="button" class="ads-mode-seg${
      mode === 'callout' ? ' active' : ''
    }" data-map-label-placement="callout">Callout</button>
  </div>`;
}

function logoGenerateModeFromValue(value) {
  const m = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  if (m === 'mark' || m === 'icon') return 'mark';
  if (m === 'monogram') return 'monogram';
  if (m === 'marktext' || m === 'wordmark' || m === 'markplus') return 'markText';
  return 'markText';
}

function logoAssetFilename(d) {
  const src = String(d?.siteConfig?.logo?.src || '').trim();
  const base = decodeURIComponent((src.split('/').pop() || '').split('?')[0]);
  if (/^logo\.(svg|png|jpe?g|webp)$/i.test(base)) return base;
  return 'logo.svg';
}

function logoGenerateModeSegmentHtml(selected) {
  const mode = logoGenerateModeFromValue(selected);
  const tip =
    'Mark = simple 2D icon, no letters (~$0.04 OpenAI). Mark + text = icon plus the business name (~$0.04). Monogram = local SVG initials (free). Click Generate logo to apply.';
  const seg = (id, label) =>
    `<button type="button" class="ads-mode-seg${mode === id ? ' active' : ''}" data-logo-style="${esc(id)}">${esc(
      label,
    )}</button>`;
  return `<div class="ads-mode-segment" id="ca-logo-style" role="group" aria-label="Logo style" ${tipAttr(tip)}>
    ${seg('mark', 'Mark')}
    ${seg('markText', 'Mark + text')}
    ${seg('monogram', 'Monogram')}
  </div>`;
}

function logoPromptEditorHtml(d) {
  const mode = logoGenerateModeFromValue(d?.meta?.logoGenerateMode);
  const defaults = d?.logoPromptDefaults || {};
  const saved = String(d?.meta?.logoPrompt || '').trim();
  const initial =
    saved ||
    (mode === 'mark' ? defaults.mark : defaults.markText) ||
    defaults.markText ||
    '';
  return `<details class="logo-prompt-details" id="ca-logo-prompt-wrap">
    <summary>Logo prompt</summary>
    <textarea id="ca-logo-prompt" rows="5" spellcheck="false">${esc(initial)}</textarea>
    <p class="muted">Used for Mark and Mark + text. Monogram ignores this.</p>
  </details>`;
}

function logoMapVariantTrayHtml(variants, { kind, candidateId, bust } = {}) {
  const list = Array.isArray(variants) ? variants.filter((v) => v.filename) : [];
  if (!list.length) return '';
  const attr = kind === 'map' ? 'data-map-variant' : 'data-logo-variant';
  const tip =
    kind === 'map'
      ? 'Use this coverage map. Tray keeps 2; oldest is removed.'
      : 'Use this logo. Tray keeps 4; oldest is removed.';
  const cards = list
    .map((v) => {
      const src = siteImageFileUrl(candidateId, v.filename, v.at || bust);
      return `<button type="button" class="slot-variant logo-map-variant" ${attr}="${esc(
        v.filename,
      )}" data-tip="${esc(tip)}">${
        src ? `<img src="${esc(src)}" alt="" />` : ''
      }</button>`;
    })
    .join('');
  return `<div class="slot-variant-tray logo-map-variant-tray">${cards}</div>`;
}

function selectedLogoGenerateMode() {
  return logoGenerateModeFromValue(
    document.querySelector('#ca-logo-style .ads-mode-seg.active')?.getAttribute('data-logo-style'),
  );
}

function syncLogoGenerateButton() {
  const btn = document.getElementById('ca-generate-logo');
  if (!btn) return;
  const mode = selectedLogoGenerateMode();
  const needsAi = mode === 'mark' || mode === 'markText';
  const ok = !needsAi || fluxIsOpenaiConfigured();
  btn.disabled = !ok;
  const tip = !ok
    ? 'Set OPENAI_API_KEY in .env (same key as Phone), then restart Rover.'
    : needsAi
      ? 'GPT Image 2 (~$0.04). Replaces the header logo. Uses the selected Mark or Mark + text style.'
      : 'Local SVG monogram from the business name. Replaces the header logo.';
  btn.setAttribute('data-tip', tip);
}

function imagesReviewChromeHtml({ spendHtml = '', actionsHtml = '', progressHtml = '', statusHtml = '' } = {}) {
  return `<div class="review-images-chrome">
      ${spendHtml}
      ${actionsHtml}
      ${progressHtml}
      ${statusHtml}
      <div id="ca-flux-toolbar"></div>
      <div id="ca-image-slots-totals"></div>
    </div>`;
}

function imagesSlotsShellHtml() {
  return `<div id="ca-image-slots">
    <div id="ca-image-slots-grid" class="ca-image-slots-sections"></div>
    <p id="ca-image-slots-filter-empty" class="muted" style="display:none;font-size:0.85rem;margin:0.35rem 0 0"></p>
    <p id="ca-image-slots-empty" class="muted" style="display:none;font-size:0.85rem;margin:0.35rem 0 0">No Structure photo slots enabled.</p>
  </div>`;
}

function reviewBaCardsHtml(
  candidateId,
  baStatus,
  { filter = 'all', sourceFilter = 'all', titleQ = '' } = {},
) {
  if (!baStatus) return '';
  const cards = listReviewBaPairs(baStatus)
    .filter((p) => {
      const slot = baPairAsReviewSlot(p);
      return (
        imagesSlotMatchesFilter(slot, filter) &&
        imagesSlotMatchesSource(slot, sourceFilter) &&
        imagesTextMatchesTitle(reviewBaTitle(p), titleQ)
      );
    })
    .map((p) => reviewBaCardHtml(candidateId, p))
    .join('');
  if (!cards) return '';
  return `<section class="ca-image-slot-section" data-section-group="beforeAfter">
      <h4 class="ca-image-slot-section-title">Before &amp; after</h4>
      <div class="ca-image-slot-section-grid">${cards}</div>
    </section>`;
}

function countReviewChecks() {
  const checks = state.imageSlotChecks || {};
  let nSlots = 0;
  let nPairs = 0;
  for (const [id, on] of Object.entries(checks)) {
    if (!on) continue;
    if (String(id).startsWith('ba:')) nPairs += 1;
    else nSlots += 1;
  }
  return { nSlots, nPairs };
}

function renderReviewFluxToolbar() {
  const el = document.getElementById('ca-flux-toolbar');
  if (!el) return;
  const { nSlots, nPairs } = countReviewChecks();
  const sourceCounts = countSelectedBySource(
    [
      ...(state.reviewImageSlots || []),
      ...listReviewBaPairs(state.reviewBa).map(baPairAsReviewSlot),
    ],
    state.imageSlotChecks,
  );
  el.outerHTML = fluxToolbarHtml({
    nSlots,
    nPairs,
    id: 'ca-flux-toolbar',
    repull: true,
    sourceCounts,
    titleSearch: true,
  });
}

function listReviewBaPairs(baStatus) {
  if (!baStatus) return [];
  const home = baStatus.homePairs || [];
  const services = baStatus.svcBeforeAfterEnabled ? baStatus.services || [] : [];
  return [...home, ...services];
}

function pickReviewBaPairFromStatus(status, slotKey) {
  const raw = String(slotKey || '').replace(/^ba:/, '');
  if (raw.startsWith('svc:')) {
    const slug = raw.slice(4);
    return (status?.services || []).find((s) => s.slug === slug) || null;
  }
  const n = Math.max(1, Number(String(raw).split(':')[1]) || 1);
  return (status?.homePairs || []).find((p) => (p.pairIndex || 1) === n) || status?.homePairs?.[0] || null;
}

function baPairAsReviewSlot(pair) {
  const matchKey =
    pair?.matchKey || (pair?.slug ? `svc:${pair.slug}` : `home:${pair.pairIndex || 1}`);
  return {
    key: `ba:${matchKey}`,
    label: reviewBaTitle(pair),
    missing: Boolean(pair?.missing) || !pair?.complete,
    source: pair?.source || null,
    matchGrade: pair?.matchGrade || null,
    matchTip: pair?.matchTip || '',
  };
}

function mergeMatchTotals(photoTotals, baPairs) {
  const t = {
    poor: Number(photoTotals?.poor) || 0,
    ok: Number(photoTotals?.ok) || 0,
    good: Number(photoTotals?.good) || 0,
    uploaded: Number(photoTotals?.uploaded) || 0,
    missing: Number(photoTotals?.missing) || 0,
  };
  for (const pair of baPairs || []) {
    const grade = imagesSlotGrade(baPairAsReviewSlot(pair));
    if (grade === 'missing') t.missing += 1;
    else if (grade === 'upload') t.uploaded += 1;
    else if (grade === 'good') t.good += 1;
    else if (grade === 'ok') t.ok += 1;
    else t.poor += 1;
  }
  return t;
}

function reviewPhotoMatchTotals(slots) {
  const t = { poor: 0, ok: 0, good: 0, uploaded: 0, missing: 0 };
  for (const slot of slots || []) {
    if (slot?.missing) t.missing += 1;
    else if (slot?.source === 'upload') t.uploaded += 1;
    else if (slot?.matchGrade === 'good') t.good += 1;
    else if (slot?.matchGrade === 'ok') t.ok += 1;
    else t.poor += 1;
  }
  return t;
}

function reviewSlotsForGrade(filterId) {
  const grade = imagesMatchFilterId(filterId);
  if (grade === 'all') return [];
  const titleQ = state.imageTitleFilter || '';
  const photos = (state.reviewImageSlots || []).filter(
    (s) => imagesSlotMatchesFilter(s, grade) && imagesSlotMatchesTitle(s, titleQ),
  );
  const ba = listReviewBaPairs(state.reviewBa)
    .map(baPairAsReviewSlot)
    .filter((s) => imagesSlotMatchesFilter(s, grade) && imagesSlotMatchesTitle(s, titleQ));
  return [...photos, ...ba];
}

function toggleSelectReviewGrade(filterId) {
  const slots = reviewSlotsForGrade(filterId);
  if (!slots.length) return;
  const checks = { ...(state.imageSlotChecks || {}) };
  const allOn = slots.every((s) => Boolean(checks[s.key]));
  for (const s of slots) {
    if (allOn) delete checks[s.key];
    else checks[s.key] = true;
  }
  state.imageSlotChecks = checks;
  const root = document.getElementById('ca-image-slots');
  if (root) {
    for (const s of slots) {
      const input = root.querySelector(`.slot-check-input[data-check-id="${CSS.escape(s.key)}"]`);
      if (input) input.checked = !allOn;
    }
  }
  renderReviewFluxToolbar();
}

async function repullReviewSlots(candidateId, slotKeys) {
  const keys = [...new Set((slotKeys || []).filter(Boolean))].filter(
    (k) => !String(k).startsWith('ba:'),
  );
  if (!keys.length) {
    showToast('No photo slots selected to re-pull.');
    return;
  }
  if (
    !(await confirmLaunchedSiteChange(
      `Re-pull ${keys.length} photo slot${keys.length === 1 ? '' : 's'}`,
    ))
  ) {
    return;
  }
  let lastCandidate = null;
  try {
    for (const slotKey of keys) beginSlotBusy(slotKey, null, { scroll: false });
    for (let i = 0; i < keys.length; i += 1) {
      const slotKey = keys[i];
      beginSlotBusy(slotKey);
      setImagesProgress(true, {
        label: `Images loading ${i + 1}`,
        detail: `Images loading ${i + 1}`,
        current: i + 1,
        total: keys.length,
      });
      const result = await api(
        `/api/candidates/${encodeURIComponent(candidateId)}/images/slots/${encodeURIComponent(slotKey)}/repull`,
        { method: 'POST', body: JSON.stringify(withLaunchedConfirmBody({})) },
      );
      lastCandidate = result.candidate || lastCandidate;
      await commitReviewSlot(candidateId, { candidate: lastCandidate, slotKey });
    }
    showToast(`Re-pulled ${keys.length} slot${keys.length === 1 ? '' : 's'}.`);
  } catch (error) {
    await refreshImageSlotsGrid(candidateId);
    await settleSlotBusy();
    await showModal({
      title: 'Re-pull failed',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>${esc(error.message)}</p><p class="muted">Slots already re-pulled were kept.</p>`,
    });
  } finally {
    setImagesProgress(false);
  }
}

function openaiPhotoConcurrency() {
  const n = Number(state.concurrency?.openaiPhotos);
  return Number.isFinite(n) && n >= 1 ? n : 5;
}

function openaiBaConcurrency() {
  const n = Number(state.concurrency?.openaiBeforeAfter);
  return Number.isFinite(n) && n >= 1 ? n : 2;
}

async function gateOpenaiBeforeAfterKeys(baKeys) {
  const keys = Array.isArray(baKeys) ? baKeys : [];
  if (!keys.length) return keys;
  const limit = openaiBaConcurrency();
  if (keys.length <= limit) return keys;
  await explainConcurrencyLimit({
    key: 'openaiBeforeAfter',
    selected: keys.length,
    limit,
  });
  return [];
}

function isOpenaiRateLimitError(error) {
  if (Number(error?.status) === 429 || error?.code === 'openai-rate-limit') return true;
  return /rate limit|too many requests|\b429\b/i.test(String(error?.message || error || ''));
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withOpenaiRateLimitRetry(fn, { attempts = 4 } = {}) {
  let delay = 15000;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isOpenaiRateLimitError(error) || i === attempts - 1) throw error;
      await waitMs(delay);
      delay = Math.min(60_000, delay * 2);
    }
  }
}

async function runPool(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;
  const n = Math.max(1, Math.min(Number(limit) || 1, list.length));
  let next = 0;
  async function take() {
    while (next < list.length) {
      const i = next;
      next += 1;
      await worker(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: n }, () => take()));
}

async function runWeightedPool(items, limit, weightOf, worker) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;
  const max = Math.max(1, Number(limit) || 1);
  let next = 0;
  let activeWeight = 0;
  let inflight = 0;
  await new Promise((resolve, reject) => {
    const kick = () => {
      while (next < list.length) {
        const item = list[next];
        const w = Math.min(max, Math.max(1, Number(weightOf?.(item)) || 1));
        if (inflight > 0 && activeWeight + w > max) break;
        next += 1;
        activeWeight += w;
        inflight += 1;
        Promise.resolve(worker(item, next - 1)).then(
          () => {
            activeWeight -= w;
            inflight -= 1;
            if (next >= list.length && inflight === 0) resolve();
            else kick();
          },
          (err) => reject(err),
        );
      }
      if (next >= list.length && inflight === 0) resolve();
    };
    kick();
  });
}

function createSerialQueue() {
  let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(() => fn());
    chain = run.then(
      () => {},
      () => {},
    );
    return run;
  };
}

function paintOpenaiBatchProgress(done, total) {
  setImagesProgress(true, {
    label: `Images loading ${done}`,
    detail: `Images loading ${done}`,
    current: done,
    total,
  });
}

async function postOpenaiGenerate(url, body) {
  try {
    return await api(url, { method: 'POST', body: JSON.stringify(body) });
  } catch (error) {
    if (error.status === 409 && error.jobId) {
      return {
        accepted: true,
        jobs: [
          {
            jobId: error.jobId,
            reused: true,
            slotKey: error.slotKey || null,
            matchKey: error.matchKey || null,
          },
        ],
      };
    }
    throw error;
  }
}

async function generateReviewSelected(candidateId) {
  const checks = state.imageSlotChecks || {};
  const slotKeys = Object.keys(checks).filter((k) => checks[k] && !k.startsWith('ba:'));
  const baKeys = Object.keys(checks).filter((k) => checks[k] && k.startsWith('ba:'));
  const nSlots = slotKeys.length;
  const nPairs = baKeys.length;
  const n = nSlots + nPairs;
  if (!n) return;
  if (n >= 8) {
    const ok = await showModal({
      title: 'Generate OpenAI',
      confirmLabel: 'Generate',
      bodyHtml: `<p>${esc(selectedGenerateCostLine(nSlots, nPairs))}</p><p>Generate ${n} job${n === 1 ? '' : 's'}?</p>`,
    });
    if (!ok) return;
  }
  if (!(await confirmLaunchedSiteChange('Generate OpenAI photos'))) {
    return;
  }
  const prompts = {};
  const baItems = [];
  for (const slotKey of slotKeys) {
    const card = document.querySelector(reviewCardAttrSel('data-slot-key', slotKey));
    prompts[slotKey] = promptBodyFromCard(card);
    beginSlotBusy(slotKey, null, { scroll: false });
  }
  for (const baId of baKeys) {
    const raw = baId.replace(/^ba:/, '');
    const card =
      document.querySelector(reviewCardAttrSel('data-match-key', raw)) ||
      document.querySelector(reviewCardAttrSel('data-match-key', baId));
    const fromEl = card ? baTargetFromGenerateEl(card) : {};
    prompts[baId] = promptBodyFromCard(card, { pair: true });
    baItems.push({
      matchKey: baId,
      serviceSlug: fromEl.serviceSlug || '',
      pairIndex: fromEl.pairIndex || 1,
      ...prompts[baId],
    });
    beginSlotBusy(baId, null, { scroll: false });
  }
  paintOpenaiBatchProgress(0, n);
  try {
    const out = await postOpenaiGenerate(
      `/api/candidates/${encodeURIComponent(candidateId)}/images/generate-openai`,
      withLaunchedConfirmBody({
        slotKeys,
        baItems,
        prompts,
      }),
    );
    watchOpenaiJobList(out.jobs || [], { candidateId });
    syncOpenaiGenerateFromSnap(state.lightJobsSnap || { jobs: out.jobs || [] });
  } catch (error) {
    await settleSlotBusy();
    setImagesProgress(false);
    await showModal({
      title: 'Generate failed',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
  }
}

function imageSlotSectionKey(group) {
  return String(group?.key || group?.sectionId || '');
}

function imageSlotSectionHtml(group, cardsHtml) {
  const key = imageSlotSectionKey(group);
  return `<section class="ca-image-slot-section" data-section-group="${esc(key)}">
      <h4 class="ca-image-slot-section-title">${esc(group.label || key)}</h4>
      <div class="ca-image-slot-section-grid">${cardsHtml}</div>
    </section>`;
}

function isHeroIntroPair(a, b) {
  const keys = new Set([imageSlotSectionKey(a), imageSlotSectionKey(b)]);
  return keys.has('hero') && keys.has('intro');
}

function joinImageSlotSections(groups, renderSection) {
  const parts = [];
  for (let i = 0; i < groups.length; i += 1) {
    const a = groups[i];
    const b = groups[i + 1];
    if (b && isHeroIntroPair(a, b)) {
      parts.push(
        `<div class="ca-image-slot-hero-intro">${renderSection(a)}${renderSection(b)}</div>`,
      );
      i += 1;
    } else {
      parts.push(renderSection(a));
    }
  }
  return parts.join('');
}

function imagesSlotsGroupedHtml(slots) {
  const groups = [];
  const byKey = new Map();
  for (const slot of slots) {
    const gKey = slot.sectionGroup || slot.sectionId || 'other';
    if (!byKey.has(gKey)) {
      const group = {
        key: gKey,
        label: slot.sectionLabel || slot.sectionId || gKey,
        slots: [],
      };
      byKey.set(gKey, group);
      groups.push(group);
    }
    byKey.get(gKey).slots.push(slot);
  }
  return joinImageSlotSections(groups, (g) =>
    imageSlotSectionHtml(g, g.slots.map(imagesSlotCardHtml).join('')),
  );
}

function reviewCardAttrSel(name, value) {
  const raw = String(value || '');
  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(raw) : raw.replace(/"/g, '\\"');
  return `.image-slot-card[${name}="${escaped}"]`;
}

function upsertReviewSlotState(slot) {
  if (!slot?.key) return;
  const list = Array.isArray(state.reviewImageSlots) ? [...state.reviewImageSlots] : [];
  const i = list.findIndex((s) => s.key === slot.key);
  if (i >= 0) list[i] = slot;
  else list.push(slot);
  state.reviewImageSlots = list;
}

function upsertReviewBaPair(pair) {
  if (!pair) return;
  const ba = { ...(state.reviewBa || {}) };
  if (pair.slug) {
    const services = [...(ba.services || [])];
    const i = services.findIndex((s) => s.slug === pair.slug);
    if (i >= 0) services[i] = pair;
    else services.push(pair);
    ba.services = services;
  } else {
    const homePairs = [...(ba.homePairs || [])];
    const n = pair.pairIndex || 1;
    const i = homePairs.findIndex((p) => (p.pairIndex || 1) === n);
    if (i >= 0) homePairs[i] = pair;
    else homePairs.push(pair);
    ba.homePairs = homePairs;
  }
  state.reviewBa = ba;
}

function patchReviewImageCard(candidateId, { slotKey, slot, baPair } = {}) {
  const grid = document.getElementById('ca-image-slots-grid');
  if (!grid) return false;
  const pair = baPair;
  if (pair || String(slotKey || '').startsWith('ba:')) {
    if (!pair) return false;
    upsertReviewBaPair(pair);
    paintReviewImageSlotsFromState(candidateId, { renderToolbar: true });
    return true;
  }
  if (slot?.key) {
    upsertReviewSlotState(slot);
    paintReviewImageSlotsFromState(candidateId, { renderToolbar: true });
    return true;
  }
  return false;
}

function paintReviewImageSlotsFromState(candidateId, { matchTotals = null, renderToolbar = true } = {}) {
  const grid = document.getElementById('ca-image-slots-grid');
  const empty = document.getElementById('ca-image-slots-empty');
  const filterEmpty = document.getElementById('ca-image-slots-filter-empty');
  const totalsEl = document.getElementById('ca-image-slots-totals');
  if (!grid) return;
  const filter = imagesMatchFilterId(state.imageMatchFilter);
  state.imageMatchFilter = filter;
  const sourceFilter = imagesSourceFilterId(state.imageSourceFilter);
  state.imageSourceFilter = sourceFilter;
  const titleQ = state.imageTitleFilter || '';
  const slots = state.reviewImageSlots || [];
  const baList = listReviewBaPairs(state.reviewBa);
  const baHtml = state.reviewBa
    ? reviewBaCardsHtml(candidateId, state.reviewBa, { filter, sourceFilter, titleQ })
    : '';

  if (!slots.length && !baList.length) {
    grid.innerHTML = '';
    if (totalsEl) totalsEl.innerHTML = '';
    if (filterEmpty) {
      filterEmpty.style.display = 'none';
      filterEmpty.textContent = '';
    }
    if (empty) empty.style.display = 'block';
    if (renderToolbar) renderReviewFluxToolbar();
    restoreSlotBusyOverlays();
    return;
  }

  if (empty) empty.style.display = 'none';
  if (totalsEl) {
    totalsEl.innerHTML = imagesMatchTotalsHtml(
      mergeMatchTotals(reviewPhotoMatchTotals(slots), baList),
      filter,
    );
  }
  const visible = slots.filter(
    (s) =>
      imagesSlotMatchesFilter(s, filter) &&
      imagesSlotMatchesSource(s, sourceFilter) &&
      imagesSlotMatchesTitle(s, titleQ),
  );
  grid.innerHTML = `${imagesSlotsGroupedHtml(visible)}${baHtml}`;
  if (renderToolbar) renderReviewFluxToolbar();
  restoreSlotBusyOverlays();
  if (filterEmpty) {
    if (!visible.length && !baHtml) {
      filterEmpty.style.display = 'block';
      const labels = {
        all: 'No photo slots.',
        poor: 'No poor matches.',
        ok: 'No ok matches.',
        good: 'No good matches.',
        upload: 'No operator uploads.',
        empty: 'No empty slots.',
      };
      const sourceLabels = {
        stock: 'No stock photos.',
        openai: 'No OpenAI photos.',
      };
      filterEmpty.textContent = imagesTitleQuery(titleQ)
        ? 'No matching titles.'
        : sourceFilter !== 'all' && filter === 'all'
          ? sourceLabels[sourceFilter] || 'No matching slots.'
          : sourceFilter !== 'all'
            ? 'No matching slots.'
            : labels[filter] || 'No matching slots.';
    } else {
      filterEmpty.style.display = 'none';
      filterEmpty.textContent = '';
    }
  }
}

async function refreshImageSlotsGrid(candidateId) {
  const grid = document.getElementById('ca-image-slots-grid');
  const empty = document.getElementById('ca-image-slots-empty');
  const filterEmpty = document.getElementById('ca-image-slots-filter-empty');
  const totalsEl = document.getElementById('ca-image-slots-totals');
  if (!grid) return;
  try {
    const data = await api(`/api/candidates/${encodeURIComponent(candidateId)}/images/slots`);
    state.reviewImageSlots = data?.slots || [];
    rememberOpenaiStatus(data);
    try {
      const baStatus = await api(
        `/api/candidates/${encodeURIComponent(candidateId)}/images/before-after-status`,
      );
      state.reviewBa = baStatus;
      rememberOpenaiStatus(baStatus);
    } catch {
      state.reviewBa = null;
    }
    paintReviewImageSlotsFromState(candidateId, {
      matchTotals: data.matchTotals,
      renderToolbar: true,
    });
  } catch (error) {
    if (totalsEl) totalsEl.innerHTML = '';
    if (filterEmpty) {
      filterEmpty.style.display = 'none';
      filterEmpty.textContent = '';
    }
    if (empty) empty.style.display = 'none';
    grid.innerHTML = `<p class="muted" style="font-size:0.85rem">${esc(error.message || 'Could not load slots')}</p>`;
  }
}

/** After slot Re-pull/Upload/generate: keep Review images open; patch one card when possible. */
async function commitReviewSlot(candidateId, { candidate, slotKey, slot, baPair, status } = {}) {
  if (candidate) {
    state.detail = candidate;
    patchListLastCosts(candidate);
  }
  state.websiteOpenStep = 'images';
  state.websiteFollowCurrent = 'images';
  state.websiteSoftCurrent = 'images';
  const statusEl = document.getElementById('ca-images-status');
  paintImagesStatusEl(statusEl, state.detail);
  renderOpenaiSpendLine();
  const mappedSlot = slot || status?.slot || null;
  const mappedPair = baPair || status?.pair || null;
  const patched = patchReviewImageCard(candidateId, {
    slotKey,
    slot: mappedSlot,
    baPair: mappedPair,
  });
  if (!patched) await refreshImageSlotsGrid(candidateId);
  if (slotKey) await settleSlotBusy(slotKey);
}

async function refreshImageSlotInPlace(candidateId, patch) {
  const opts =
    patch && typeof patch === 'object'
      ? 'status' in patch || 'slot' in patch || 'baPair' in patch || 'slotKey' in patch || 'candidate' in patch
        ? patch
        : { candidate: patch }
      : {};
  await commitReviewSlot(candidateId, opts);
  await settleSlotBusy(opts.slotKey);
  hideReviewImagesProgress();
}

function wireImageSlotActions(candidateId, _refreshFn) {
  const root =
    document.querySelector('#tab-panels [data-content-step="images"]') ||
    document.getElementById('ca-image-slots');
  if (!root || root.dataset.wired === '1') return;
  root.dataset.wired = '1';
  wireSlotPromptEvents(root);

  root.addEventListener('input', (ev) => {
    const search = ev.target.closest?.('#review-title-search');
    if (!search || !root.contains(search)) return;
    state.imageTitleFilter = String(search.value || '');
    paintReviewImageSlotsFromState(candidateId, { renderToolbar: false });
  });
  root.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    if (!ev.target.closest?.('#review-title-search')) return;
    ev.preventDefault();
  });

  const applyImageSlotShiftRange = (ev) => {
    const input = resolveSlotCheckInput(ev.target, root);
    if (!input) return false;
    const id = input.getAttribute('data-check-id');
    if (!id) return false;
    const visibleKeys = [...root.querySelectorAll('.image-slot-card .slot-check-input')]
      .map((el) => el.getAttribute('data-check-id'))
      .filter(Boolean);
    const checks = { ...(state.imageSlotChecks || {}) };
    const ranged = applyShiftRangeCheckboxClick(ev, {
      visibleKeys,
      clickedKey: id,
      anchorKey: state.imageSlotCheckAnchor,
      setAnchor: (key) => {
        state.imageSlotCheckAnchor = key;
      },
      setSelected: (key, on) => {
        if (on) checks[key] = true;
        else delete checks[key];
      },
    });
    if (!ranged) return false;
    state.imageSlotChecks = checks;
    for (const el of root.querySelectorAll('.image-slot-card .slot-check-input')) {
      const key = el.getAttribute('data-check-id');
      el.checked = Boolean(checks[key]);
    }
    renderReviewFluxToolbar();
    return true;
  };

  root.addEventListener(
    'pointerdown',
    (ev) => {
      if (!ev.shiftKey || state.imageSlotCheckAnchor == null) return;
      if (!resolveSlotCheckInput(ev.target, root)) return;
      blockShiftRangePointerDown(ev, state.imageSlotCheckAnchor);
      applyImageSlotShiftRange(ev);
    },
    true,
  );

  root.addEventListener('click', (ev) => {
    applyImageSlotShiftRange(ev);
  });

  root.addEventListener('change', async (ev) => {
    const input = resolveSlotCheckInput(ev.target, root) || ev.target.closest?.('.slot-check-input');
    if (input && root.contains(input)) {
      const id = input.getAttribute('data-check-id');
      if (!id) return;
      if (consumeShiftRangeChange(input, id)) {
        input.checked = Boolean(state.imageSlotChecks?.[id]);
        return;
      }
      state.imageSlotCheckAnchor = id;
      state.imageSlotChecks = { ...(state.imageSlotChecks || {}), [id]: input.checked };
      renderReviewFluxToolbar();
      return;
    }
    const baImport = ev.target.closest('.ca-ba-card-import');
    if (!baImport || !root.contains(baImport)) return;
    const files = [...(baImport.files || [])];
    baImport.value = '';
    if (files.length < 2) {
      showToast('Select two images for the pair.');
      return;
    }
    const slug = baImport.getAttribute('data-service-slug') || '';
    const card = baImport.closest('.image-slot-card');
    const matchKey = card?.getAttribute('data-match-key') || '';
    try {
      await withReviewImagesWork(
        {
          label: 'Importing pair…',
          key: matchKey,
          card,
        },
        async () => {
          const payloadFiles = [];
          for (const file of files.slice(0, 2)) {
            payloadFiles.push({
              name: file.name,
              lastModified: file.lastModified || 0,
              dataUrl: await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
                reader.readAsDataURL(file);
              }),
            });
          }
          await api(`/api/candidates/${encodeURIComponent(candidateId)}/images/before-after-import`, {
            method: 'POST',
            body: JSON.stringify(
              withLaunchedConfirmBody({
                files: payloadFiles,
                serviceSlug: slug || undefined,
                pairIndex: Number(baImport.getAttribute('data-pair-index') || 1) || 1,
              }),
            ),
          });
          await refreshImageSlotInPlace(candidateId, {
            slotKey: matchKey.startsWith('ba:') ? matchKey : matchKey ? `ba:${matchKey}` : undefined,
          });
          showToast('Imported before/after pair.');
        },
      );
    } catch (error) {
      await showModal({
        title: 'Import failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  root.addEventListener('click', async (ev) => {
    const gradeBtn = ev.target.closest('[data-slot-grade-cycle]');
    if (gradeBtn && root.contains(gradeBtn)) {
      ev.preventDefault();
      ev.stopPropagation();
      if (gradeBtn.disabled) return;
      const slotKey = gradeBtn.getAttribute('data-slot-key');
      const current = gradeBtn.getAttribute('data-grade');
      if (!slotKey || (current !== 'poor' && current !== 'ok' && current !== 'good')) return;
      const next = nextImageMatchGrade(current);
      gradeBtn.disabled = true;
      try {
        if (String(slotKey).startsWith('ba:')) {
          const data = await withReviewImagesWork({ label: 'Updating match…' }, () =>
            api(`/api/candidates/${encodeURIComponent(candidateId)}/images/before-after/match-grade`, {
              method: 'POST',
              body: JSON.stringify({ matchKey: slotKey.replace(/^ba:/, ''), matchGrade: next }),
            }),
          );
          const status = data?.status || data;
          if (status) state.reviewBa = status;
          const pair = pickReviewBaPairFromStatus(status, slotKey);
          const patched = patchReviewImageCard(candidateId, { slotKey, baPair: pair });
          if (!patched) await refreshImageSlotsGrid(candidateId);
        } else {
          const data = await withReviewImagesWork({ label: 'Updating match…' }, () =>
            api(
              `/api/candidates/${encodeURIComponent(candidateId)}/images/slots/${encodeURIComponent(slotKey)}/match-grade`,
              { method: 'POST', body: JSON.stringify({ matchGrade: next }) },
            ),
          );
          const slot = data?.slot || (data?.slots || []).find((s) => s.key === slotKey) || null;
          const patched = patchReviewImageCard(candidateId, { slotKey, slot });
          if (!patched) await refreshImageSlotsGrid(candidateId);
        }
      } catch (error) {
        await showModal({
          title: 'Could not set match grade',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      } finally {
        gradeBtn.disabled = false;
      }
      return;
    }
    const selectBtn = ev.target.closest('[data-grade-select]');
    if (selectBtn && root.contains(selectBtn)) {
      ev.preventDefault();
      ev.stopPropagation();
      if (selectBtn.disabled) return;
      toggleSelectReviewGrade(selectBtn.getAttribute('data-grade-select'));
      return;
    }
    const unselectAll = ev.target.closest('.flux-unselect-all');
    if (unselectAll && root.contains(unselectAll)) {
      ev.preventDefault();
      ev.stopPropagation();
      if (unselectAll.disabled) return;
      state.imageSlotChecks = {};
      root.querySelectorAll('.slot-check-input').forEach((el) => {
        el.checked = false;
      });
      renderReviewFluxToolbar();
      return;
    }
    const selectedRepull = ev.target.closest('.review-selected-repull');
    if (selectedRepull && root.contains(selectedRepull)) {
      ev.preventDefault();
      ev.stopPropagation();
      if (selectedRepull.disabled) return;
      const checks = state.imageSlotChecks || {};
      const slotKeys = Object.keys(checks).filter((k) => checks[k] && !k.startsWith('ba:'));
      selectedRepull.disabled = true;
      try {
        await repullReviewSlots(candidateId, slotKeys);
      } finally {
        selectedRepull.disabled = false;
        renderReviewFluxToolbar();
      }
      return;
    }
    const filterBtn = ev.target.closest('[data-match-filter]');
    if (filterBtn && root.contains(filterBtn)) {
      const next = imagesMatchFilterId(filterBtn.getAttribute('data-match-filter'));
      if (state.imageMatchFilter === next) return;
      state.imageMatchFilter = next;
      paintReviewImageSlotsFromState(candidateId, { renderToolbar: true });
      return;
    }
    const sourceBtn = ev.target.closest('[data-source-filter]');
    if (sourceBtn && root.contains(sourceBtn)) {
      ev.preventDefault();
      const next = imagesSourceFilterId(sourceBtn.getAttribute('data-source-filter'));
      state.imageSourceFilter = state.imageSourceFilter === next ? 'all' : next;
      paintReviewImageSlotsFromState(candidateId, { renderToolbar: true });
      return;
    }
    const vpBtn = ev.target.closest('[data-ba-viewpoint]');
    if (vpBtn && root.contains(vpBtn)) {
      const group = vpBtn.closest('[data-ba-viewpoint-step]');
      if (!group || !root.contains(group)) return;
      ev.preventDefault();
      const stepKey = group.dataset?.baViewpointStep || '';
      if (!stepKey) return;
      const card = group.closest('.photo-ba-card') || group.closest('.image-slot-card');
      stashSlotPromptDraft(card);
      const next = setBaViewpoint(stepKey, vpBtn.dataset.baViewpoint);
      group.querySelectorAll('[data-ba-viewpoint]').forEach((b) => {
        b.classList.toggle('active', b.dataset.baViewpoint === next);
      });
      fillBaPromptsPanel(card);
      return;
    }
    const openaiBulk = ev.target.closest('.slot-generate-selected-openai');
    if (openaiBulk && root.contains(openaiBulk)) {
      ev.preventDefault();
      const btn = openaiBulk;
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        await generateReviewSelected(candidateId);
      } finally {
        btn.disabled = false;
        renderReviewFluxToolbar();
      }
      return;
    }
    const openaiBtn = ev.target.closest('.slot-generate-openai');
    if (
      openaiBtn &&
      root.contains(openaiBtn) &&
      !openaiBtn.classList.contains('slot-generate-selected-openai')
    ) {
      ev.preventDefault();
      if (openaiBtn.disabled) return;
      const isPair = openaiBtn.classList.contains('ba') || Boolean(openaiBtn.closest('.photo-ba-card'));
      if (!(await confirmLaunchedSiteChange(isPair ? 'Generate OpenAI pair' : 'Generate OpenAI photo'))) return;
      openaiBtn.disabled = true;
      try {
        if (isPair) {
          const { matchKey, serviceSlug: slug, pairIndex } = baTargetFromGenerateEl(openaiBtn);
          const card = openaiBtn.closest('.image-slot-card');
          beginSlotBusy(matchKey, card);
          const out = await postOpenaiGenerate(
            `/api/candidates/${encodeURIComponent(candidateId)}/images/before-after-generate-openai`,
            withLaunchedConfirmBody({
              ...promptBodyFromCard(card, { pair: true }),
              matchKey,
              serviceSlug: slug,
              pairIndex,
            }),
          );
          watchOpenaiJobList(out.jobs || [{ jobId: out.jobId, slotKey: matchKey, kind: 'pair' }], {
            candidateId,
          });
        } else {
          const slotKey = openaiBtn.getAttribute('data-slot-key');
          if (!slotKey) return;
          const card = openaiBtn.closest('.image-slot-card');
          beginSlotBusy(slotKey, card);
          const out = await postOpenaiGenerate(
            `/api/candidates/${encodeURIComponent(candidateId)}/images/slots/${encodeURIComponent(slotKey)}/generate-openai`,
            withLaunchedConfirmBody(promptBodyFromCard(card)),
          );
          watchOpenaiJobList(out.jobs || [{ jobId: out.jobId, slotKey, kind: 'photo' }], {
            candidateId,
          });
        }
        syncOpenaiGenerateFromSnap(state.lightJobsSnap);
      } catch (error) {
        setImagesProgress(false);
        await settleSlotBusy();
        await showModal({
          title: 'Generate failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      } finally {
        openaiBtn.disabled = false;
      }
      return;
    }
    const varBtn = ev.target.closest('.slot-variant-use');
    if (varBtn && root.contains(varBtn)) {
      ev.preventDefault();
      const card = varBtn.closest('.image-slot-card');
      if (varBtn.getAttribute('data-pair-id')) {
        const matchKey = card?.getAttribute('data-match-key') || '';
        const slug = card?.getAttribute('data-service-slug') || '';
        const pairIndex = Number(card?.getAttribute('data-pair-index') || 1) || 1;
        try {
          await withReviewImagesWork(
            { label: 'Loading pair…', key: matchKey, card },
            async () => {
              const used = await api(
                `/api/candidates/${encodeURIComponent(candidateId)}/images/before-after/variants/use`,
                {
                  method: 'POST',
                  body: JSON.stringify(
                    withLaunchedConfirmBody({
                      pairId: varBtn.getAttribute('data-pair-id'),
                      matchKey,
                      serviceSlug: slug,
                      pairIndex,
                      beforeFilename: varBtn.getAttribute('data-before-filename') || '',
                    }),
                  ),
                },
              );
              await refreshImageSlotInPlace(candidateId, {
                slotKey: matchKey.startsWith('ba:') ? matchKey : `ba:${matchKey}`,
                status: used.status,
              });
              showToast('Restored before/after pair.');
            },
          );
        } catch (error) {
          await showModal({
            title: 'Swap failed',
            confirmLabel: 'OK',
            hideCancel: true,
            bodyHtml: `<p>${esc(error.message)}</p>`,
          });
        }
        return;
      }
      const slotKey = card?.getAttribute('data-slot-key');
      const filename = varBtn.getAttribute('data-filename');
      if (!slotKey || !filename) return;
      try {
        await withReviewImagesWork(
          { label: 'Loading photo…', key: slotKey, card },
          async () => {
            const used = await api(
              `/api/candidates/${encodeURIComponent(candidateId)}/images/slots/${encodeURIComponent(slotKey)}/variants/use`,
              {
                method: 'POST',
                body: JSON.stringify(withLaunchedConfirmBody({ filename })),
              },
            );
            await refreshImageSlotInPlace(candidateId, { slotKey, status: used.status });
            showToast('Restored previous photo.');
          },
        );
      } catch (error) {
        await showModal({
          title: 'Swap failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
      return;
    }
    const seeMoreBtn = ev.target.closest('.slot-see-more');
    if (seeMoreBtn && root.contains(seeMoreBtn)) {
      ev.preventDefault();
      const slotKey = seeMoreBtn.getAttribute('data-slot-key');
      if (!slotKey) return;
      if (seeMoreBtn.getAttribute('data-ba') === '1') {
        void openLoadedGroupBaSeeMore(candidateId, slotKey);
      } else {
        void openLoadedGroupSeeMore(candidateId, slotKey);
      }
      return;
    }
    const baCopy = ev.target.closest('.ca-ba-card-copy');
    if (baCopy && root.contains(baCopy)) {
      ev.preventDefault();
      const kind = baCopy.getAttribute('data-ba-kind') || 'before';
      const { matchKey, serviceSlug: slug, pairIndex } = baTargetFromGenerateEl(baCopy);
      try {
        const card = baCopy.closest('.image-slot-card');
        const fromPanel = promptBodyFromCard(card, { pair: true });
        let text = kind === 'after' ? fromPanel.after : fromPanel.before;
        if (!text) {
          const params = new URLSearchParams({
            viewpoint: fromPanel.viewpoint || getBaViewpoint(matchKey),
            pairIndex: String(pairIndex || 1),
          });
          if (slug) params.set('service', slug);
          const prompts = await api(
            `/api/candidates/${encodeURIComponent(candidateId)}/images/before-after-prompts?${params}`,
          );
          text = prompts[kind] || prompts.pair || '';
        }
        await navigator.clipboard.writeText(text);
        showToast(`Copied ${kind} prompt (${text.length} chars).`);
      } catch (error) {
        showToast(error.message || 'Copy failed');
      }
      return;
    }
    const promptBtn = ev.target.closest('.ca-slot-chatgpt-prompt');
    if (promptBtn && root.contains(promptBtn)) {
      ev.preventDefault();
      const slotKey = promptBtn.getAttribute('data-slot-key');
      if (!slotKey) return;
      promptBtn.disabled = true;
      try {
        const card = promptBtn.closest('.image-slot-card');
        const fromPanel = promptBodyFromCard(card);
        let text = fromPanel.prompt || '';
        let label = slotKey;
        let viewpoint = fromPanel.viewpoint || getBaViewpoint(slotKey);
        if (!text) {
          const params = new URLSearchParams({ viewpoint });
          const data = await api(
            `/api/candidates/${encodeURIComponent(candidateId)}/images/slots/${encodeURIComponent(slotKey)}/chatgpt-prompt?${params}`,
          );
          text = String(data?.prompt || '');
          label = data.label || slotKey;
          viewpoint = data.viewpoint || viewpoint;
        }
        if (!text) throw new Error('Empty prompt');
        await navigator.clipboard.writeText(text);
        showToast(
          `Copied ChatGPT prompt · ${label} · ${viewpoint} (${text.length} chars). Paste into ChatGPT, then Upload.`,
        );
      } catch (error) {
        await showModal({
          title: 'Prompt failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      } finally {
        promptBtn.disabled = false;
      }
      return;
    }
    const btn = ev.target.closest('.ca-slot-repull');
    if (!btn) return;
    const slotKey = btn.getAttribute('data-slot-key');
    if (!slotKey) return;
    if (!(await confirmLaunchedSiteChange(`Re-pull photo slot ${slotKey}`))) return;
    btn.disabled = true;
    try {
      await withReviewImagesWork(
        {
          label: `Re-pulling ${slotKey}…`,
          detail: 'Searching providers',
          key: slotKey,
          card: btn.closest('.image-slot-card'),
        },
        async () => {
          const result = await api(
            `/api/candidates/${encodeURIComponent(candidateId)}/images/slots/${encodeURIComponent(slotKey)}/repull`,
            { method: 'POST', body: JSON.stringify(withLaunchedConfirmBody({})) },
          );
          await refreshImageSlotInPlace(candidateId, {
            candidate: result.candidate,
            slotKey,
            slot: result.slot,
            status: result.status,
          });
        },
      );
    } catch (error) {
      await showModal({
        title: 'Re-pull failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      btn.disabled = false;
    }
  });

  root.addEventListener('change', async (ev) => {
    const input = ev.target.closest('.ca-slot-upload');
    if (!input || input.tagName !== 'INPUT') return;
    const slotKey = input.getAttribute('data-slot-key');
    const file = input.files?.[0];
    if (!slotKey || !file) return;
    if (!(await confirmLaunchedSiteChange(`Upload photo for ${slotKey}`))) {
      input.value = '';
      return;
    }
    const card = input.closest('.image-slot-card');
    try {
      await withReviewImagesWork(
        {
          label: `Uploading ${slotKey}…`,
          detail: file.name,
          key: slotKey,
          card,
        },
        async () => {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read file'));
            reader.readAsDataURL(file);
          });
          const result = await api(
            `/api/candidates/${encodeURIComponent(candidateId)}/images/slots/${encodeURIComponent(slotKey)}/upload`,
            {
              method: 'POST',
              body: JSON.stringify(
                withLaunchedConfirmBody({ dataUrl, alt: file.name.replace(/\.[^.]+$/, '') }),
              ),
            },
          );
          await refreshImageSlotInPlace(candidateId, {
            candidate: result.candidate,
            slotKey,
            slot: result.slot,
            status: result.status,
          });
        },
      );
    } catch (error) {
      await showModal({
        title: 'Upload failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      input.value = '';
    }
  });
}

function renderWebsite() {
  const d = state.detail;
  const f = d?.stageFlags || {};
  const draft = d?.contentDraft;
  const accepted = d?.content;
  const hasMarkdown = Boolean(draft || accepted || f.hasContent);
  const stagedAt = d?.meta?.lastSiteStagingAt || null;
  const stagingPath = d?.meta?.siteStagingPath || null;
  const assembledAt = d?.meta?.lastAssembleAt || null;
  const assembledPath = d?.meta?.assembledSitePath || null;
  const launched = Boolean(d?.meta?.lastLaunchAt || d?.meta?.lastShipAt);
  const alreadyLive = Boolean(
    launched || d?.meta?.dnsDone || d?.meta?.emailRoutingDone || d?.meta?.cloudflarePagesDone,
  );
  const cfg = effectiveSiteConfigForLaunchClient(d?.siteConfig, d?.siteConfigDraft);
  const flags = {
    staged: Boolean(stagedAt || stagingPath),
    assembled: Boolean(assembledAt || assembledPath),
    launched,
    alreadyLive,
  };
  const assembleStale = isAssembleStaleClient(d);
  const pageIds = structurePageIdsFromDetail(d);
  const wantsServices = pageIds.includes('services');
  const wantsLocations = pageIds.includes('locations');
  const imagesDone = Boolean(d?.imagesManifest?.files?.length || f.hasImages);
  const hasLogoAsset = Boolean(f.hasLogo || d?.siteConfig?.logo);
  const hasCoverageMapAsset = Boolean(f.hasCoverageMap);
  const logoMapDone = hasLogoAsset;
  const logoBtnLabel = hasLogoAsset ? 'Regenerate logo' : 'Generate logo';
  const mapBtnLabel = hasCoverageMapAsset ? 'Regenerate coverage map' : 'Generate coverage map';
  const logoTip = hasLogoAsset
    ? 'Accept usually already created this. Click to replace the existing header logo. Previous logos go to the tray (keeps 4).'
    : 'Accept normally creates Mark + text. Use here if Accept skipped or failed, or to pick another style.';
  const mapTip = hasCoverageMapAsset
    ? 'Accept usually already created this. Click to replace the existing coverage-map.svg and homepage Areas map. Previous maps go to the tray (keeps 2).'
    : 'Accept normally creates this when Areas exist. Use here if Accept skipped or failed.';
  const logoHint = hasLogoAsset
    ? 'Pick Mark, Mark + text, or Monogram, then generate. Edit the logo prompt if you want a different mark.'
    : 'Usually auto after Accept (Mark + text) — use if logo is still missing. Pick a style, then generate.';
  const mapHint = hasCoverageMapAsset
    ? 'Centered vs Callout replaces map on regenerate. Tray keeps 2 previous maps.'
    : 'Usually auto after Accept when Areas exist — use if the map is still missing. Pick Centered or Callout, then generate.';
  const prepareDone = flags.staged && flags.assembled && !assembleStale;
  const indexingStepDone =
    Boolean(d?.meta?.indexingDone) || isSoftDone('websiteSoftDone', 'indexing');
  const stepFlags = {
    logoMapDone,
    imagesDone,
    prepareDone,
    launched: flags.launched,
    indexingDone: indexingStepDone,
  };
  const durableCurrent = firstIncompleteWebsiteStep(stepFlags);
  const currentId = resolvePanelCurrent('websiteSoftCurrent', durableCurrent, WEBSITE_STEP_ORDER);
  if (state.preparePreviewHold) {
    state.websiteOpenStep = 'prepare';
    state.websiteSoftCurrent = 'prepare';
    state.websiteFollowCurrent = 'prepare';
  } else if (state.websiteFollowCurrent !== currentId) {
    state.websiteOpenStep = currentId;
    state.websiteFollowCurrent = currentId;
  }
  const openId = state.websiteOpenStep;
  const logoMapStepDone = logoMapDone || isSoftDone('websiteSoftDone', 'logoMap');
  const imagesStepDone = imagesDone || isSoftDone('websiteSoftDone', 'images');
  // Hold blocks the green check so a re-Prepare does not look finished mid-run.
  const prepareStepDone =
    !state.preparePreviewHold &&
    (prepareDone || isSoftDone('websiteSoftDone', 'prepare'));
  const launchStepDone = flags.launched || isSoftDone('websiteSoftDone', 'launch');
  const parts = [];

  parts.push(
    panelHowToHtml({
      label: 'Website',
      info: 'Logo & Map → Review images → Prepare preview → Launch (or Push updates) → Indexing (Search Console + sitemap). Revert restores Rover from GitHub if a launched site drifted.',
    }),
  );
  if (flags.launched) {
    parts.push(
      `<div class="callout warn"><strong>Already launched.</strong> Edits here change Rover’s working copy only — the live site will not match until you <strong>Push updates</strong>. Mutating actions ask for confirmation. Use <strong>Revert</strong> below to restore from the current launched GitHub site.</div>`,
    );
  }
  const phoneRaw = String(cfg.phone || '').trim();
  const phoneIsPlaceholder = isLaunchPhonePlaceholder(phoneRaw);
  const launchIssues = launchPreflightIssues({
    domain: cfg.domain,
    phone: cfg.phone,
    web3FormsAccessKey: cfg.web3FormsAccessKey,
  });
  if (phoneIsPlaceholder) {
    parts.push(
      `<div class="callout warn"><strong>Phone placeholder:</strong> still <code>+1XXXXXXXXXX</code> (or empty). Set a real click-to-call number in Site config (or Launch → Advanced) before launch — Rover will not invent one.</div>`,
    );
  }
  const domainWarn = domainBrandMismatchClient(cfg.domain, {
    niche: cfg.niche,
    businessName: cfg.businessName,
    primaryCity: cfg.primaryCity,
  });
  if (domainWarn.mismatch) {
    parts.push(
      `<div class="callout warn"><strong>Domain vs brand:</strong> ${esc(domainWarn.reason)}</div>`,
    );
  }
  if (!hasMarkdown && !f.hasContent) {
    parts.push(
      `<div class="callout warn">Accept content on the <strong>Content</strong> tab first (all service/location FILEs when Structure includes them).</div>`,
    );
  } else if (!logoMapDone) {
    parts.push(
      statusLineHtml(
        'Up next: <strong>Logo &amp; Map</strong> — header logo (coverage map when Areas exist; usually auto after Accept).',
      ),
    );
  } else if (!imagesDone) {
    parts.push(
      statusLineHtml(
        'Up next: <strong>Review images</strong> — stock photos and before/after (usually auto after Accept).',
      ),
    );
  } else if (!prepareDone) {
    parts.push(
      statusLineHtml(
        `Up next: <strong>Prepare preview</strong> — stages the full launch package${
          wantsServices ? ' (including every service page)' : ''
        }, assembles the sibling site, then open the sitemap on :4322.`,
      ),
    );
  } else if (!flags.launched) {
    parts.push(
      statusLineHtml(
        flags.alreadyLive
          ? 'Site already live: after <strong>Prepare preview</strong>, use <strong>Push updates</strong> (or Run launch for keys/CF).'
          : 'Up next: open every <strong>Preview sitemap</strong> URL, then <strong>Run launch</strong>.',
      ),
    );
  } else if (!indexingStepDone) {
    parts.push(
      statusLineHtml(
        'Up next: <strong>Indexing</strong> — submit the live sitemap in Google Search Console and request indexing on money pages.',
      ),
    );
  } else {
    parts.push(
      statusLineHtml(
        flags.alreadyLive
          ? 'Website day-one steps complete. Use <strong>Push updates</strong> when content changes.'
          : 'Website day-one steps complete.',
      ),
    );
  }

  const assembleProg = state.assembleProgress || { visible: false, detail: '' };
  const assembleProgVisible = Boolean(assembleProg.visible && !state.preparePreviewHold);

  parts.push(
    contentStepHtml({
      id: 'logoMap',
      num: 1,
      title: 'Logo & Map',
      done: logoMapStepDone,
      open: openId === 'logoMap',
      current: currentId === 'logoMap' && !logoMapStepDone,
      info: 'Accept already generates a Mark + text header logo (and a coverage map when Areas exist). Use these buttons if Accept skipped or to replace them. Coverage map is optional — Areas / Nominatim often skip it.',
      bodyHtml: `
        <div id="ca-logo-map-previews">
        ${contentActionRow({
          n: 1,
          label: logoBtnLabel,
          hint: logoHint,
          done: hasLogoAsset,
          controlsHtml: `<div class="logo-map-controls">
            ${logoPromptEditorHtml(d)}
            <div class="logo-map-row-preview">
            <div class="logo-map-preview-stack">
            ${logoMapPreviewCardHtml({
              src: hasLogoAsset
                ? siteImageFileUrl(d.id, logoAssetFilename(d), d.meta?.lastLogoAt || 'logo')
                : '',
              label: 'Logo',
              alt: 'Logo',
              emptyRole: 'No logo yet',
              kind: 'logo',
            })}
            ${logoMapVariantTrayHtml(d.logoVariants, {
              kind: 'logo',
              candidateId: d.id,
              bust: d.meta?.lastLogoAt || 'logo',
            })}
            </div>
            ${logoGenerateModeSegmentHtml(d.meta?.logoGenerateMode)}
            <button type="button" class="btn" id="ca-generate-logo" data-tip="${esc(
              logoTip,
            )}">${esc(logoBtnLabel)}</button>
          </div>
          </div>`,
        })}
        ${contentActionRow({
          n: 2,
          label: mapBtnLabel,
          hint: mapHint,
          done: hasCoverageMapAsset,
          controlsHtml: `<div class="logo-map-row-preview">
            <div class="logo-map-preview-stack">
            ${logoMapPreviewCardHtml({
              src: hasCoverageMapAsset
                ? siteImageFileUrl(
                    d.id,
                    'coverage-map.svg',
                    d.meta?.lastCoverageMapAt || 'map',
                  )
                : '',
              label: 'Coverage map',
              alt: 'Coverage map',
              emptyRole: 'No map yet',
              kind: 'map',
            })}
            ${logoMapVariantTrayHtml(d.coverageMapVariants, {
              kind: 'map',
              candidateId: d.id,
              bust: d.meta?.lastCoverageMapAt || 'map',
            })}
            </div>
            ${mapLabelPlacementSegmentHtml(d.meta?.coverageMapLabelPlacement)}
            <button type="button" class="btn" id="ca-generate-map" data-tip="${esc(
              mapTip,
            )}">${esc(mapBtnLabel)}</button>
          </div>`,
        })}
        </div>
        <div id="ca-logo-map-progress" class="job-progress hidden" aria-live="polite">
          <div class="job-progress-track"><div class="job-progress-bar" id="ca-logo-map-progress-bar"></div></div>
          <p class="job-progress-label" id="ca-logo-map-progress-label">Working…</p>
          <p class="job-progress-detail" id="ca-logo-map-progress-detail">Starting…</p>
        </div>`,
    }),
  );

  parts.push(
    contentStepHtml({
      id: 'images',
      num: 2,
      title: 'Review images',
      done: imagesStepDone,
      open: openId === 'images',
      current: currentId === 'images' && !imagesStepDone,
      freeze: openId === 'images',
      headActionsHtml: `<button type="button" class="btn btn-sm detail-shelf-toggle hidden" id="detail-shelf-toggle" aria-expanded="false" data-tip="Expand sidebar over the table">${detailShelfToggleInnerHtml(false)}</button>`,
      freezeHtml:
        openId === 'images'
          ? imagesReviewChromeHtml({
              spendHtml: openaiSpendLineHtml(state.detail),
              actionsHtml: `<div class="photo-group-menu">
              <button type="button" class="btn btn-sm" id="ca-pg-menu-toggle" aria-expanded="${
                state.reviewPhotoGroupMenuOpen ? 'true' : 'false'
              }" aria-controls="ca-pg-menu" data-tip="Save, rank, and load photo groups">Photo groups</button>
              <div id="ca-pg-menu" class="photo-group-menu-panel${
                state.reviewPhotoGroupMenuOpen ? '' : ' hidden'
              }">
                <div class="photo-group-menu-actions">
                  <button type="button" class="btn btn-sm pg-save" id="ca-pg-save" data-tip="Save this site’s stock photos, uploads, and ChatGPT before/after pairs">Save photo group</button>
                  <button type="button" class="btn btn-sm pg-load" id="ca-pg-load" disabled data-tip="Replace this site’s Review images. 1st group fills matching slots; later groups fill leftovers; empty slots take the first tray still as live; extras go to trays.">Load</button>
                </div>
                ${photoGroupRankSelectsHtml('ca-pg-select')}
              </div>
            </div>`,
              progressHtml: `<div id="ca-images-progress" class="job-progress hidden" aria-live="polite">
          <div class="job-progress-track"><div class="job-progress-bar" id="ca-images-progress-bar"></div></div>
          <p class="job-progress-label" id="ca-images-progress-label">Working…</p>
          <p class="job-progress-detail" id="ca-images-progress-detail">Starting…</p>
        </div>`,
            })
          : '',
      info: 'Accept content already pulls stock photos. <strong>Photo groups</strong> saves, ranks, and loads named groups. Per-slot Re-pull / Upload / Copy prompt (ChatGPT) for near-launch QA — process slots show step titles; What we do cards use named service slots. ChatGPT before/after is optional gallery polish. Logo and coverage map live under <strong>Logo &amp; Map</strong>.',
      bodyHtml: imagesSlotsShellHtml(),
    }),
  );

  const prepareInfoParts = ['Home/About/Contact'];
  if (wantsServices) prepareInfoParts.push('every service page');
  if (wantsLocations) prepareInfoParts.push('every location page');
  const prepareInfo = `Prepare preview stages the full launch package (${prepareInfoParts.join(
    ' + ',
  )}), assembles the sibling site (full rebuild when template layout is newer; otherwise content refresh), stops any old :4322 preview, and opens the assembled preview (does not ship live — use Push updates or Run launch for that).`;
  parts.push(
    contentStepHtml({
      id: 'prepare',
      num: 3,
      title: 'Prepare preview',
      done: prepareStepDone,
      open: openId === 'prepare' || openId === 'stage' || openId === 'assemble',
      current: currentId === 'prepare' && !prepareStepDone,
      info: prepareInfo,
      bodyHtml: `
        <div class="narrative-actions" style="justify-content:center">
          <button type="button" class="btn primary" id="ca-prepare-preview" data-tip="Stage → assemble (full if template newer) → open preview :4322" ${
            hasMarkdown && !state.preparePreviewHold ? '' : 'disabled'
          }>Prepare preview</button>
          <button type="button" class="btn" id="ca-open-assembled-preview" data-tip="Preview assembled site on 127.0.0.1:4322" ${flags.assembled ? '' : 'disabled'}>Open site preview</button>
          <button type="button" class="btn" id="ca-visual-edit" data-tip="Operator visual editor on the assembled preview" ${hasMarkdown ? '' : 'disabled'}>Edit visually</button>
          <button type="button" class="btn" id="ca-checklist" data-tip="Show assemble / deploy checklist">Checklist</button>
        </div>
        <div id="ca-assemble-progress" class="job-progress${assembleProgVisible ? '' : ' hidden'}" aria-live="polite" style="margin-top:0.75rem">
          <div class="job-progress-track"><div class="job-progress-bar"></div></div>
          <p class="job-progress-label" id="ca-assemble-progress-label">${esc(
            Number(assembleProg.total) > 0
              ? prepareProgressLabel(assembleProg.done, assembleProg.total)
              : 'Preparing preview…',
          )}</p>
          <p class="job-progress-detail" id="ca-assemble-progress-detail">${esc(
            assembleProg.detail || (state.preparePreviewHold ? 'Starting…' : 'Working…'),
          )}</p>
        </div>`,
    }),
  );

  parts.push(
    contentStepHtml({
      id: 'launch',
      num: 4,
      title: 'Launch',
      done: launchStepDone,
      open: openId === 'launch',
      current: currentId === 'launch' && !flags.launched,
      info: flags.alreadyLive
        ? 'Already live: Prepare preview first, then Push updates (GitHub + build + Worker). Run launch only when you need to change keys or re-run Cloudflare domain/email.'
        : 'Before Run launch: buy/point domain NS at Cloudflare (zone must exist), paste Web3Forms key, set Gmail destination for leads@. Then Run launch. After: verify Gmail once if the destination is new. Auto ship + Cloudflare on by default.',
      bodyHtml: `
        ${
          assembleStale
            ? `<div class="callout warn">Assemble is stale vs Stage — run <strong>Prepare preview</strong> again before Launch or Push updates.</div>`
            : ''
        }
        ${
          flags.alreadyLive
            ? ''
            : `<div class="callout"><strong>Before Run launch</strong>
          <ol class="narrative-list">
            <li>Buy the domain and point nameservers to Cloudflare (zone must exist in this account)</li>
            <li>Create a form at <a href="https://web3forms.com" target="_blank" rel="noopener">web3forms.com</a> and paste the access key below</li>
            <li>Set Email Routing destination (Gmail) below</li>
          </ol>
          <p class="muted" style="margin:0.35rem 0 0">Then Run launch. After: click Cloudflare’s verify link in Gmail once if the destination is new; smoke-test the live form.</p>
        </div>`
        }
        ${launchPreflightHtml(launchIssues)}
        ${citationsChecklistHtml(cfg)}
        <div id="ca-launch-form">
        <div class="site-config-nap ca-launch-nap" style="margin-top:0.5rem">
          <label>
            <span class="label-with-tip-head">
              <span>Domain</span>
              <button type="button" class="tip-info" data-tip="Public hostname for go-live. Point nameservers to Cloudflare first so the zone exists in this account before Run Cloudflare domain / email." aria-label="About Domain">i</button>
            </span>
            <input id="ca-launch-domain" type="text" value="${esc(cfg.domain || '')}" placeholder="yourdomain.com" />
          </label>
          <label>
            <span class="label-with-tip-head">
              <span>Business name</span>
              <button type="button" class="tip-info" data-tip="Customer-facing brand name on the site." aria-label="About Business name">i</button>
            </span>
            <input id="ca-launch-business" type="text" value="${esc(cfg.businessName || '')}" placeholder="Brand LLC" />
          </label>
          <label>
            <span class="label-with-tip-head">
              <span>Phone</span>
              <button type="button" class="tip-info" data-tip="Click-to-call number written into site-config at launch." aria-label="About Phone">i</button>
            </span>
            <input id="ca-launch-phone" type="text" value="${esc(cfg.phone || '')}" placeholder="+1…" />
          </label>
          <label>
            <span class="label-with-tip-head">
              <span>Web3Forms access key</span>
              <button type="button" class="tip-info" data-tip="Form access key from web3forms.com — delivers lead form submissions." aria-label="About Web3Forms access key">i</button>
              <a href="https://web3forms.com/" target="_blank" rel="noopener">Get key</a>
            </span>
            <input id="ca-launch-web3" type="text" value="${esc(cfg.web3FormsAccessKey || '')}" placeholder="Paste from web3forms.com" />
          </label>
          <label>
            <span class="label-with-tip-head">
              <span>Leads email</span>
              <button type="button" class="tip-info" data-tip="Public site leads address (usually leads@yourdomain.com) — shown in footer, contact, and schema. Not your personal Gmail." aria-label="About Leads email">i</button>
            </span>
            <input id="ca-launch-email" type="email" value="${esc(cfg.email || '')}" placeholder="leads@yourdomain.com" />
          </label>
          <label>
            <span class="label-with-tip-head">
              <span>Email Routing destination</span>
              <button type="button" class="tip-info" data-tip="Where Cloudflare forwards leads@ (usually your Gmail). Not the address printed on the website — that is Config → Email / Leads email." aria-label="About Email Routing destination">i</button>
            </span>
            <input id="ca-launch-dest" type="email" value="" placeholder="your@gmail.com" />
          </label>
          <label>
            <span class="label-with-tip-head">
              <span>Turnstile site key</span>
              <button type="button" class="tip-info" data-tip="Optional Cloudflare Turnstile site key for form bot protection." aria-label="About Turnstile site key">i</button>
            </span>
            <input id="ca-launch-turnstile" type="text" value="${esc(cfg.turnstileSiteKey || '')}" placeholder="optional" />
          </label>
        </div>
        <div class="ca-launch-opts">
          ${launchOptCheckboxHtml({
            id: 'ca-launch-ship',
            label: 'Auto ship (GitHub + build + Worker deploy)',
            ariaLabel: 'About Auto ship',
            checked: true,
            tip: 'Publishes the website online (saves it, builds it, and puts it on the internet). Leave on for a normal go-live. Turn off only if you are re-running Launch for Cloudflare/keys without republishing.',
          })}
          ${launchOptCheckboxHtml({
            id: 'ca-launch-run-cf',
            label: 'Run Cloudflare domain / email API',
            ariaLabel: 'About Cloudflare domain / email',
            checked: !flags.alreadyLive,
            tip: flags.alreadyLive
              ? 'Domain and Email Routing are already set up for this site — left off by default. Turn on only if you need to re-attach the custom domain or recreate leads@ forwarding. Prefer Push updates for template/content publishes.'
              : 'Attaches the Worker custom domain and forwards leads@ to your Gmail. Requires the domain zone already in this Cloudflare account (buy/point NS first). Leave on when launching a new domain.',
          })}
          ${launchOptCheckboxHtml({
            id: 'ca-launch-create-turnstile',
            label: 'Create Turnstile widget',
            ariaLabel: 'About Create Turnstile widget',
            tip: 'Adds a spam/bot check to the contact form. Leave off unless you want that protection — most launches don’t need it.',
          })}
          ${launchOptCheckboxHtml({
            id: 'ca-launch-mark-cf',
            label: 'Mark CF Worker project done',
            ariaLabel: 'About Mark CF Worker project done',
            tip: 'Only updates Rover’s checklist to say hosting is done. Does not publish or fix anything. Leave off for normal launches; use only if the site is already live but Rover still shows incomplete.',
          })}
        </div>
        <div class="narrative-actions">
          ${
            flags.alreadyLive
              ? `<button type="button" class="btn primary" id="ca-push-updates" data-tip="Prepare preview first, then push assembled site to GitHub + build + Cloudflare Worker. Skips first-time domain/email setup." ${flags.assembled ? '' : 'disabled'}>Push updates</button>
          <button type="button" class="btn" id="ca-launch" data-tip="Full launch: patch keys + optional ship + optional CF domain/email" ${flags.assembled ? '' : 'disabled'}>Run launch</button>`
              : `<button type="button" class="btn primary" id="ca-launch" data-tip="Ship + CF helpers" ${flags.assembled ? '' : 'disabled'}>Run launch</button>`
          }
          <button type="button" class="btn" id="ca-launch-status" data-tip="Status, human leftovers, machine creds">Launch status</button>
        </div>
        ${
          flags.alreadyLive && flags.assembled
            ? `<div id="ca-ship-freshness" class="ca-ship-status" data-status="pending" role="status" aria-live="polite">
          <span class="ca-ship-status-dot" aria-hidden="true"></span>
          <p id="ca-ship-freshness-msg" class="ca-ship-status-msg">Checking whether assembled matches GitHub…</p>
          <div class="ca-ship-status-actions narrative-actions">
            <button type="button" class="btn btn-sm" id="ca-ship-diff-refresh" data-tip="Fetch origin and compare assembled tree to GitHub">Refresh status</button>
            <button type="button" class="btn btn-sm" id="ca-ship-diff-show" data-tip="List files that differ from origin/main before you Push updates">Show file differences</button>
          </div>
        </div>`
            : ''
        }
        <p class="muted">${
          flags.alreadyLive
            ? 'Push updates = ship only (GitHub + build + Worker). Re-assemble via Prepare preview when template/content changed.'
            : 'Create key at <a href="https://web3forms.com" target="_blank" rel="noopener">web3forms.com</a> · before Run launch: domain NS at Cloudflare · after: verify Gmail once if new'
        }</p>
        </div>`,
    }),
  );

  const sitemapUrl = liveSitemapUrl(cfg.domain);
  const robotsUrl = liveRobotsUrl(cfg.domain);
  const siteUrl = liveSiteUrl(cfg.domain);
  const indexingLocked = !flags.launched;
  parts.push(
    contentStepHtml({
      id: 'indexing',
      num: 5,
      title: 'Indexing',
      done: indexingStepDone,
      open: openId === 'indexing',
      current: currentId === 'indexing' && !indexingStepDone,
      locked: indexingLocked,
      info: 'After go-live: add the site in Google Search Console, submit the sitemap once, and request indexing on the homepage plus a few money pages. Indexing is not ranking.',
      bodyHtml: indexingLocked
        ? `<p class="muted">Finish <strong>Run launch</strong> first, then return here to submit the live sitemap in Search Console.</p>`
        : `<div class="callout">
          <strong>Day-one indexing</strong>
          <ol class="narrative-list">
            <li>Add a <strong>Domain</strong> property in Google Search Console and verify with DNS TXT (covers apex + www).</li>
            <li>Indexing → Sitemaps → submit the sitemap URL once (do not resubmit daily).</li>
            <li>URL Inspection → <strong>Request indexing</strong> on the homepage and top 2–3 money pages only.</li>
            <li>Wait — monitor Page indexing; don’t thrash resubmits.</li>
          </ol>
        </div>
        <p class="muted" style="margin:0.65rem 0 0.35rem">Also after launch: verify Gmail once if Email Routing is new; smoke-test the live form; use Launch’s <strong>Download NAP CSV</strong> for citations / GBP.</p>
        <div class="narrative-actions" style="justify-content:flex-start;flex-wrap:wrap;gap:0.5rem;margin-top:0.75rem">
          <button type="button" class="btn primary" id="ca-copy-site-url" data-tip="Copy https://{domain}" ${
            siteUrl ? '' : 'disabled'
          }>Copy URL</button>
          <button type="button" class="btn" id="ca-copy-sitemap-url" data-tip="Copy https://{domain}/sitemap.xml" ${
            sitemapUrl ? '' : 'disabled'
          }>Copy sitemap URL</button>
          <a class="btn" href="https://search.google.com/search-console" target="_blank" rel="noopener" data-tip="Open Google Search Console">Open Search Console</a>
          ${
            sitemapUrl
              ? `<a class="btn" href="${esc(sitemapUrl)}" target="_blank" rel="noopener" data-tip="Open live sitemap.xml">Open sitemap</a>`
              : ''
          }
          ${
            robotsUrl
              ? `<a class="btn" href="${esc(robotsUrl)}" target="_blank" rel="noopener" data-tip="Open live robots.txt">Open robots.txt</a>`
              : ''
          }
          ${
            indexingStepDone
              ? `<button type="button" class="btn" id="ca-indexing-mark-done" disabled data-tip="Indexing already marked done for this site">Done</button>`
              : `<button type="button" class="btn" id="ca-indexing-mark-done" data-tip="Mark this step done when you’ve submitted the sitemap">Mark done</button>`
          }
        </div>
        ${
          siteUrl || sitemapUrl
            ? `<p class="muted" style="margin-top:0.5rem;font-size:0.85rem">${
                siteUrl
                  ? `<code id="ca-site-url-text">${esc(siteUrl)}</code>`
                  : ''
              }${
                siteUrl && sitemapUrl ? '<br>' : ''
              }${
                sitemapUrl
                  ? `<code id="ca-sitemap-url-text">${esc(sitemapUrl)}</code>`
                  : ''
              }</p>`
            : `<p class="muted" style="margin-top:0.5rem">Set a real domain on Launch / site-config to get the site URL.</p>`
        }`,
    }),
  );

  const canRevert = Boolean(flags.launched && d?.meta?.githubRepo);
  parts.push(
    contentStepHtml({
      id: 'revert',
      title: 'Revert',
      plain: true,
      open: openId === 'revert',
      locked: !canRevert,
      info: 'Overwrites Rover content, structure, site-config, and images from GitHub origin/main for this site. Does not change the live Cloudflare deploy.',
      bodyHtml: canRevert
        ? `<p>Replace Rover’s working copy (content, structure, site-config, and images) with the <strong>current launched site</strong> from GitHub (<code>${esc(
            String(d.meta.githubRepo),
          )}</code> · <code>origin/main</code>). Does <strong>not</strong> change the live Cloudflare site.</p>
        <p class="muted">Use this if you edited a launched candidate by mistake and want Rover to match what is shipped.</p>
        <div class="narrative-actions" style="justify-content:flex-start;margin-top:0.75rem">
          <button type="button" class="btn danger" id="ca-revert-launched" data-tip="Overwrite Rover working copy from GitHub launched site">Revert to launched site</button>
        </div>`
        : flags.launched
          ? `<p class="muted">Revert needs a <code>githubRepo</code> on this candidate (set at Launch / Ship).</p>`
          : `<p class="muted">Available after Launch / Ship — restores Rover from the launched GitHub site.</p>`,
    }),
  );

  return `<div class="content-panel-wrap">${prepareOverlayHtml()}${shipOverlayHtml()}${launchOverlayHtml()}${parts.join('')}</div>`;
}

function shipProgressStepsFromOpts({
  skipGithub = false,
  skipBuild = false,
  skipDeploy = false,
  skipBuildsConnect = false,
} = {}) {
  const steps = [];
  if (!skipGithub) steps.push('GitHub create + push…');
  if (!skipBuild) steps.push('npm install + build…');
  if (!skipDeploy) steps.push('Wrangler deploy…');
  if (!skipBuildsConnect && !skipGithub) steps.push('Workers Builds…');
  return steps;
}

function launchProgressStepsFromForm(body = {}) {
  const steps = ['Writing keys / site-config…'];
  if (body.ship !== false) {
    steps.push(
      ...shipProgressStepsFromOpts({
        skipGithub: Boolean(body.skipGithub),
        skipBuild: Boolean(body.skipBuild),
        skipDeploy: Boolean(body.skipDeploy),
        skipBuildsConnect: Boolean(body.skipBuildsConnect),
      }),
    );
  }
  if (body.runCloudflare !== false) {
    steps.push('Cloudflare domain / Email Routing…');
  }
  return steps;
}

function setLaunchOverlayPhases(phases) {
  const list = Array.isArray(phases) && phases.length ? phases : ['Keys'];
  state._launchOverlayPhases = list;
  const ol = document.getElementById('ln-overlay-phases');
  if (!ol) return;
  ol.innerHTML = list.map((p) => `<li data-ln-phase="${esc(p)}">${esc(p)}</li>`).join('');
}

function snapWithOptimisticLaunch(candidateId, phases) {
  const jobs = [...(state.heavyJobsSnap?.jobs || [])];
  if (
    !jobs.some(
      (j) =>
        j.phase === 'launch' &&
        String(j.candidateId) === String(candidateId) &&
        (j.status === 'running' || j.status === 'queued'),
    )
  ) {
    jobs.unshift({
      id: 'optimistic-launch',
      candidateId,
      phase: 'launch',
      label: 'Launch',
      status: 'running',
      detail: 'Starting…',
      progressDone: 0,
      progressTotal: phases.length || 1,
    });
  }
  return { ...(state.heavyJobsSnap || {}), jobs };
}

function paintPrepareOverlay(job) {
  hideWebsiteJobOverlaysExcept('website-prepare-overlay');
  const leftover = document.getElementById('ca-assemble-progress');
  if (leftover) leftover.classList.add('hidden');
  paintRoverJobOverlay({
    overlayId: 'website-prepare-overlay',
    detailId: 'pr-overlay-detail',
    barId: 'pr-overlay-bar',
    phasesId: 'pr-overlay-phases',
    job,
  });
}

function hidePrepareOverlay() {
  setRoverJobOverlayVisible('website-prepare-overlay', false);
}

function defaultShipOverlayPhases() {
  return shipProgressStepsFromOpts({}).map(shortenLaunchPhase);
}

function setShipOverlayPhases(phases) {
  const list = Array.isArray(phases) && phases.length ? phases : ['GitHub'];
  state._shipOverlayPhases = list;
  const ol = document.getElementById('sh-overlay-phases');
  if (!ol) return;
  ol.innerHTML = list.map((p) => `<li data-sh-phase="${esc(p)}">${esc(p)}</li>`).join('');
}

function paintShipOverlay(job) {
  hideWebsiteJobOverlaysExcept('website-ship-overlay');
  paintRoverJobOverlay({
    overlayId: 'website-ship-overlay',
    detailId: 'sh-overlay-detail',
    barId: 'sh-overlay-bar',
    phasesId: 'sh-overlay-phases',
    job,
  });
}

function hideShipOverlay({ clearHold = true } = {}) {
  if (clearHold) state._shipHold = false;
  setRoverJobOverlayVisible('website-ship-overlay', false);
}

function showShipOverlayStarting() {
  const phases = defaultShipOverlayPhases();
  state._shipHold = true;
  setShipOverlayPhases(phases);
  paintShipOverlay({
    detail: 'Starting…',
    progressDone: 0,
    progressTotal: phases.length,
  });
}

function syncLaunchOverlay(snap) {
  const id = String(state.selectedId || '').trim();
  const jobs = Array.isArray(snap?.jobs) ? snap.jobs : [];
  const job = jobs.find(
    (j) =>
      String(j.candidateId || '') === id &&
      j.phase === 'launch' &&
      (j.status === 'queued' || j.status === 'running'),
  );
  if (job) {
    hideWebsiteJobOverlaysExcept('website-launch-overlay');
    paintRoverJobOverlay({
      overlayId: 'website-launch-overlay',
      detailId: 'ln-overlay-detail',
      barId: 'ln-overlay-bar',
      phasesId: 'ln-overlay-phases',
      job: {
        ...job,
        detail: job.status === 'queued' ? 'Queued…' : job.detail || 'Working…',
      },
    });
    return;
  }
  if (state._launchHold) {
    hideWebsiteJobOverlaysExcept('website-launch-overlay');
    setRoverJobOverlayVisible('website-launch-overlay', true);
    return;
  }
  setRoverJobOverlayVisible('website-launch-overlay', false);
}

function showLaunchOverlayStarting(body) {
  const phases = launchOverlayPhaseLabels(body);
  state._launchHold = true;
  setLaunchOverlayPhases(phases);
  syncLaunchOverlay(snapWithOptimisticLaunch(state.selectedId, phases));
}

function hideLaunchOverlay() {
  state._launchHold = false;
  setRoverJobOverlayVisible('website-launch-overlay', false);
}

function prepareProgressLabel(done, total) {
  if (Number(total) > 0) return `Preparing preview ${Number(done) || 0} / ${Number(total)}`;
  return 'Preparing preview…';
}

function prepareStepLine(detail, done, total) {
  const name = String(detail || '').trim() || 'Working…';
  if (Number(total) > 0) return `${name} ${Number(done) || 0}/${Number(total)}`;
  return name;
}

function patchPreviewWaitingTab({ title, body, done, total, detail } = {}) {
  const tab = state.preparePreviewTab;
  if (!tab || tab.closed) return;
  try {
    const doc = tab.document;
    if (!doc) return;
    if (title) {
      const tEl = doc.getElementById('rover-preview-title');
      if (tEl) tEl.textContent = title;
      doc.title = title;
    }
    if (body != null) {
      const bEl = doc.getElementById('rover-preview-body');
      if (bEl) bEl.innerHTML = body;
    }
    const bar = doc.getElementById('rover-preview-bar');
    const stepEl = doc.getElementById('rover-preview-step');
    const t = Number(total);
    const d = Number(done);
    if (bar && Number.isFinite(t) && t > 0) {
      const pct = Math.max(0, Math.min(100, Math.round((100 * (Number.isFinite(d) ? d : 0)) / t)));
      bar.style.width = `${pct}%`;
    }
    if (stepEl) stepEl.textContent = prepareStepLine(detail, done, total);
  } catch {
    /* closed / cross-origin */
  }
}

function setAssembleProgress(visible, detail, { done = null, total = null } = {}) {
  const prev = state.assembleProgress || {};
  const nextDone = done != null && Number.isFinite(Number(done)) ? Number(done) : prev.done;
  const nextTotal = total != null && Number.isFinite(Number(total)) ? Number(total) : prev.total;
  const detailText = detail != null ? String(detail) : prev.detail || '';
  state.assembleProgress = {
    visible: Boolean(visible),
    detail: detailText,
    done: visible ? nextDone : null,
    total: visible ? nextTotal : null,
  };
  const known = visible && Number(nextTotal) > 0;
  const label = visible
    ? known
      ? prepareProgressLabel(nextDone, nextTotal)
      : 'Preparing preview…'
    : '';
  const box = document.getElementById('ca-assemble-progress');
  const detailEl = document.getElementById('ca-assemble-progress-detail');
  const labelEl = document.getElementById('ca-assemble-progress-label');
  const bar = box?.querySelector('.job-progress-bar');
  const useOverlay = Boolean(state.preparePreviewHold);

  if (useOverlay) {
    if (box) box.classList.add('hidden');
    if (visible) {
      paintPrepareOverlay({
        detail: detailText || 'Working…',
        progressDone: known ? nextDone : 0,
        progressTotal: known ? nextTotal : 5,
      });
    } else {
      hidePrepareOverlay();
    }
  } else {
    hidePrepareOverlay();
    if (box) {
      box.classList.toggle('hidden', !visible);
      if (detailEl && detail != null) detailEl.textContent = String(detail);
      if (labelEl && visible) labelEl.textContent = label;
    }
    if (!visible) {
      setDeterminateProgress(bar, {});
    } else if (known) {
      setDeterminateProgress(bar, { done: nextDone, total: nextTotal });
    } else {
      setDeterminateProgress(bar, {});
    }
  }

  if (visible) {
    patchPreviewWaitingTab({
      title: 'Preparing preview…',
      done: nextDone,
      total: nextTotal,
      detail: detailText,
    });
  }
}

function syncLaunchProgressFromJobs(snap) {
  const id = String(state.selectedId || '').trim();
  if (!id) return;
  const jobs = Array.isArray(snap?.jobs) ? snap.jobs : [];
  const job = jobs.find(
    (j) =>
      String(j.candidateId || '') === id &&
      (j.phase === 'launch' || j.phase === 'ship') &&
      (j.status === 'queued' || j.status === 'running'),
  );
  if (!job) {
    if (jobSyncedBarOn.launch) jobSyncedBarOn.launch = false;
    if (!state._shipHold) hideShipOverlay({ clearHold: false });
    syncLaunchOverlay(snap);
    return;
  }
  if (job.phase === 'launch') {
    jobSyncedBarOn.launch = true;
    hideShipOverlay();
    syncLaunchOverlay(snap);
    return;
  }
  jobSyncedBarOn.launch = true;
  const total = Number(job.progressTotal);
  const done = Number(job.progressDone);
  const known = Number.isFinite(total) && total > 0;
  const n = Number.isFinite(done) && done > 0 ? done : 0;
  const detail = job.status === 'queued' ? 'Queued…' : job.detail || 'Working…';
  const phases =
    Array.isArray(state._shipOverlayPhases) && state._shipOverlayPhases.length
      ? state._shipOverlayPhases
      : defaultShipOverlayPhases();
  setShipOverlayPhases(phases);
  paintShipOverlay({
    ...job,
    detail,
    progressDone: known ? n : 0,
    progressTotal: known ? total : phases.length,
  });
}

/** Drive Website prepare overlay from Heavy jobs for this candidate. */
function syncPrepareProgressFromJobs(snap) {
  const id = String(state.selectedId || '').trim();
  if (!id) return;
  const jobs = Array.isArray(snap?.jobs) ? snap.jobs : [];
  const heldJobId = String(state.preparePreviewJobId || '').trim();
  const active = jobs.find(
    (j) =>
      String(j.candidateId || '') === id &&
      j.phase === 'prepare' &&
      (j.status === 'queued' || j.status === 'running'),
  );
  const held = heldJobId ? jobs.find((j) => j.id === heldJobId) : null;

  if (active) {
    const total = Number(active.progressTotal) > 0 ? Number(active.progressTotal) : 5;
    const n = Number.isFinite(Number(active.progressDone)) ? Number(active.progressDone) : 0;
    const detail = active.status === 'queued' ? 'Queued…' : active.detail || 'Running…';
    paintPrepareOverlay({
      detail,
      progressDone: active.status === 'queued' ? 0 : n,
      progressTotal: total,
    });
    if (state.preparePreviewHold) {
      state.assembleProgress = {
        visible: true,
        detail,
        done: n,
        total,
      };
      patchPreviewWaitingTab({
        title: 'Preparing preview…',
        done: n,
        total,
        detail,
      });
    }
    return;
  }

  if (held && held.status === 'done') {
    paintPrepareOverlay({
      detail: 'Prepare finished — opening result…',
      progressDone: 5,
      progressTotal: 5,
    });
    return;
  }
  if (held && held.status === 'error') {
    paintPrepareOverlay({
      detail: `Prepare failed: ${held.error || held.detail || 'error'}`,
      progressDone: 0,
      progressTotal: 5,
    });
    return;
  }

  if (!state.preparePreviewHold) hidePrepareOverlay();
}

function beginAcceptProgress(detail = 'Starting…') {
  setAcceptProgress(true, {
    label: 'Accepting 0 / 4',
    detail,
    step: 0,
    total: 4,
  });
}

function setAcceptProgress(visible, { label, detail, step = null, total = null, fromJob = false } = {}) {
  const box = document.getElementById('ca-accept-progress');
  const labelEl = document.getElementById('ca-accept-progress-label');
  const detailEl = document.getElementById('ca-accept-progress-detail');
  const bar = document.getElementById('ca-accept-progress-bar');
  const done =
    visible && total != null ? (step == null ? 0 : Math.min(Number(total), Number(step) + 1)) : undefined;
  if (box) {
    box.classList.toggle('hidden', !visible);
    if (labelEl && label) labelEl.textContent = label;
    if (detailEl && detail) detailEl.textContent = detail;
    if (!visible) {
      setDeterminateProgress(bar, {});
    } else if (total != null) {
      setDeterminateProgress(bar, { done, total: Number(total) });
    }
  }
}

function setImagesProgress(visible, { label, detail, current, total, box: boxPrefix = 'ca-images', fromJob = false } = {}) {
  const prefix = boxPrefix || 'ca-images';
  const box = document.getElementById(`${prefix}-progress`);
  const labelEl = document.getElementById(`${prefix}-progress-label`);
  const detailEl = document.getElementById(`${prefix}-progress-detail`);
  const bar = document.getElementById(`${prefix}-progress-bar`);
  const known = Number(total) > 0 && Number(current) >= 0;
  if (box) {
    box.classList.toggle('hidden', !visible);
    if (labelEl && label) labelEl.textContent = label;
    if (detailEl && detail) detailEl.textContent = detail;
    if (!visible) {
      setDeterminateProgress(bar, {});
    } else {
      setDeterminateProgress(bar, known ? { done: Number(current), total: Number(total) } : {});
    }
  }
}

function wireContentTab(d) {
  if (!d) return;
  const id = d.id;
  const ready = Boolean(d.stageFlags?.hasSiteConfig);
  const refresh = async (candidate, nextStep, tab = 'content') => {
    if (tab === 'website') {
      if (nextStep) advancePanelStep('website', nextStep);
      state.tab = 'website';
    } else {
      if (nextStep) advancePanelStep('content', nextStep);
      state.tab = 'content';
    }
    await applyCandidatePayload(candidate, id);
    renderDetail();
  };
  const copyPrompt = (path, title, { advanceTo, panel = 'content' } = {}) => async () => {
    try {
      const data = await api(path);
      await navigator.clipboard.writeText(data.prompt || '');
      showToast(`${title || 'Prompt'} copied to clipboard.`);
      if (advanceTo) {
        advancePanelStep(panel, advanceTo);
        renderDetail();
      }
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
      if (state.tab === 'website') {
        state.websiteOpenStep = state.websiteOpenStep === step ? null : step;
      } else if (state.tab === 'site-config') {
        state.siteConfigOpenStep = state.siteConfigOpenStep === step ? null : step;
      } else {
        state.contentOpenStep = state.contentOpenStep === step ? null : step;
      }
      const openId =
        state.tab === 'website'
          ? state.websiteOpenStep
          : state.tab === 'site-config'
            ? state.siteConfigOpenStep
            : state.contentOpenStep;
      document.querySelectorAll('#tab-panels .content-step').forEach((el) => {
        el.classList.toggle('open', el.dataset.contentStep === openId);
      });
      applyDetailShelf();
      if (state.tab === 'website' && openId === 'images') {
        const needsPaint =
          !document.querySelector('#tab-panels .review-images-chrome') ||
          !document.getElementById('ca-image-slots-grid');
        if (needsPaint) renderDetail();
        else void refreshImageSlotsGrid(id);
      }
    });
  });

  document.getElementById('cs-write-site')?.addEventListener('click', () => {
    void startWriteSiteFromUi(id);
  });
  document.getElementById('ws-overlay-stop')?.addEventListener('click', async () => {
    const overlay = document.getElementById('content-write-site-overlay');
    const jobId = overlay?.dataset.jobId || state._writeSiteTrack?.jobId;
    if (!jobId) return;
    const btn = document.getElementById('ws-overlay-stop');
    if (btn) btn.disabled = true;
    const detailEl = document.getElementById('ws-overlay-detail');
    if (detailEl) detailEl.textContent = 'Stopping…';
    try {
      await api(`/api/light-jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
    } catch (error) {
      if (btn) btn.disabled = false;
      await showModal({
        title: 'Could not stop',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });
  if (state.tab === 'content') {
    syncWriteSiteOverlay(state.lightJobsSnap);
    syncAcceptOverlay(state.lightJobsSnap);
  }
  if (state.tab === 'website') syncLaunchOverlay(state.heavyJobsSnap);

  const collectStructureSelection = () => {
    const pages = [...document.querySelectorAll('input[name="structure-page"]')]
      .filter((el) => el.checked || el.disabled)
      .map((el) => el.value);
    // Required sections are disabled+checked; never treat disabled-unchecked (e.g. offerProcess) as selected
    const sections = [...document.querySelectorAll('input[name="structure-section"]')]
      .filter((el) => el.checked)
      .map((el) => el.value);
    const photos = {};
    const catalogSections = state.contentStructureCatalog?.sections || [];
    const maxById = new Map(catalogSections.map((s) => [s.id, Number(s.maxImages) || 3]));
    for (const el of document.querySelectorAll('input[name="structure-photo"]')) {
      if (!el.checked) continue;
      const max = maxById.get(el.value) || 3;
      photos[el.value] = { enabled: true, count: max };
    }
    return { pages, sections, photos };
  };

  const syncStructurePhotoToggles = () => {
    document.querySelectorAll('input[name="structure-section"]').forEach((sec) => {
      const photo = document.querySelector(`input[name="structure-photo"][value="${sec.value}"]`);
      if (!photo) return;
      photo.disabled = !sec.checked;
      if (!sec.checked) photo.checked = false;
    });
  };

  const syncStructurePageGroups = () => {
    document.querySelectorAll('.structure-page-group').forEach((g) => {
      const pid = g.dataset.page;
      const pageCb = document.querySelector(`input[name="structure-page"][value="${pid}"]`);
      const on = Boolean(pageCb && (pageCb.checked || pageCb.disabled));
      g.hidden = !on;
      if (!on) {
        g.querySelectorAll('input[name="structure-section"]').forEach((sec) => {
          if (!sec.disabled) sec.checked = false;
        });
        g.querySelectorAll('input[name="structure-photo"]').forEach((ph) => {
          ph.checked = false;
          ph.disabled = true;
        });
      }
    });
    syncStructurePhotoToggles();
  };

  /** Services page → process only; single-offer → offerProcess wins if both checked */
  const syncProcessOfferExclusion = () => {
    const servicesPage = document.querySelector('input[name="structure-page"][value="services"]');
    const processCb = document.querySelector('input[name="structure-section"][value="process"]');
    const offerCb = document.querySelector('input[name="structure-section"][value="offerProcess"]');
    const hint = document.getElementById('structure-process-hint');
    const servicesOn = Boolean(servicesPage && (servicesPage.checked || servicesPage.disabled));
    if (!processCb || !offerCb) return;
    if (servicesOn) {
      if (offerCb.checked) {
        offerCb.checked = false;
        const photo = document.querySelector('input[name="structure-photo"][value="offerProcess"]');
        if (photo) {
          photo.checked = false;
          photo.disabled = true;
        }
      }
      offerCb.disabled = true;
      if (hint) {
        hint.textContent =
          'Services pages use How we work (process). Deep offer process is disabled while Services is on.';
      }
    } else {
      offerCb.disabled = false;
      if (processCb.checked && offerCb.checked) {
        processCb.checked = false;
        const photo = document.querySelector('input[name="structure-photo"][value="process"]');
        if (photo) {
          photo.checked = false;
          photo.disabled = true;
        }
        if (hint) {
          hint.textContent =
            'Deep offer process is for single-offer sites. How we work was unchecked — pick one process style.';
        }
      } else if (hint) {
        hint.textContent =
          'Services pages use How we work (process). Deep offer process is for single-offer sites only — never both.';
      }
    }
    syncStructurePhotoToggles();
  };

  document.querySelectorAll('input[name="structure-section"]').forEach((el) => {
    el.addEventListener('change', () => {
      if (el.value === 'process' || el.value === 'offerProcess') syncProcessOfferExclusion();
      syncStructurePhotoToggles();
    });
  });
  document.querySelectorAll('input[name="structure-page"]').forEach((el) => {
    el.addEventListener('change', () => {
      syncStructurePageGroups();
      syncProcessOfferExclusion();
    });
  });
  syncProcessOfferExclusion();

  if (ready) {
    ensureStructureCatalog().catch(() => {});
    // Hydrate once when detail has no structure object. Do not re-fetch on
    // status === 'empty' — that is the synthetic default and would loop
    // renderDetail forever (checkboxes never stick before first Save).
    if (!d.contentStructure) {
      if (!state._structureHydratePromise || state._structureHydrateId !== id) {
        state._structureHydrateId = id;
        state._structureHydratePromise = api(
          `/api/candidates/${encodeURIComponent(id)}/content/structure`,
        )
          .then((data) => {
            if (state._structureHydrateId !== id) return;
            let changed = false;
            if (data.catalog?.sections?.length) {
              state.contentStructureCatalog = data.catalog;
              state.contentStructureCatalogError = null;
              changed = true;
            }
            if (data.structure && state.detail?.id === id) {
              state.detail.contentStructure = data.structure;
              changed = true;
            }
            if (data.outline && state.detail?.id === id && !state.detail.contentOutlinePackage) {
              state.detail.contentOutlinePackage = data.outline;
              changed = true;
            }
            if (changed && state.tab === 'content') renderDetail();
          })
          .catch((error) => {
            if (state._structureHydrateId !== id) return;
            if (!state.contentStructureCatalog) {
              state.contentStructureCatalogError =
                error?.message || 'Couldn’t load section catalog';
              if (state.tab === 'content') renderDetail();
            }
          })
          .finally(() => {
            if (state._structureHydrateId === id) {
              state._structureHydratePromise = null;
            }
          });
      }
    }
  }

  document.querySelectorAll('.structure-preset').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!(await confirmLaunchedSiteChange('Apply structure preset'))) return;
        const result = await api(`/api/candidates/${encodeURIComponent(id)}/content/structure`, {
          method: 'POST',
          body: JSON.stringify(
            withLaunchedConfirmBody({ presetId: btn.dataset.preset, applyPreset: true }),
          ),
        });
        await applyCandidatePayload(result.candidate, id);
        state.contentOpenStep = 'structure';
        renderDetail();
      } catch (error) {
        await showModal({
          title: 'Preset failed',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
    });
  });

  document.getElementById('cs-compose')?.addEventListener('click', async () => {
    try {
      if (!(await confirmLaunchedSiteChange('Compose content outline'))) return;
      const selection = collectStructureSelection();
      await api(`/api/candidates/${encodeURIComponent(id)}/content/structure`, {
        method: 'POST',
        body: JSON.stringify(withLaunchedConfirmBody(selection)),
      });
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/content/structure/compose`, {
        method: 'POST',
        body: JSON.stringify(withLaunchedConfirmBody(selection)),
      });
      await refresh(result.candidate, 'fieldResearch');
      if (result.warnings?.length) {
        announceBanner(result.warnings.join(' '), { tone: 'warn' });
      } else {
        announceBanner('Outline composed — Site research next.');
      }
    } catch (error) {
      await showModal({
        title: 'Compose failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document
    .getElementById('cs-copy-structure')
    ?.addEventListener(
      'click',
      copyPrompt(
        `/api/candidates/${encodeURIComponent(id)}/content/structure/prompt`,
        'Structure prompt',
      ),
    );

  document.getElementById('cs-paste-outline')?.addEventListener('click', async () => {
    const text = document.getElementById('cs-outline-paste')?.value || '';
    if (!text.trim()) {
      await showModal({
        title: 'Nothing to paste',
        confirmLabel: 'OK',
        bodyHtml: '<p>Paste the refined outline JSON first.</p>',
      });
      return;
    }
    try {
      if (!(await confirmLaunchedSiteChange('Paste / confirm outline'))) return;
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/content/structure/outline`, {
        method: 'POST',
        body: JSON.stringify(withLaunchedConfirmBody({ json: text })),
      });
      const confirmed = await api(
        `/api/candidates/${encodeURIComponent(id)}/content/structure/confirm`,
        { method: 'POST', body: JSON.stringify(withLaunchedConfirmBody({})) },
      );
      await refresh(confirmed.candidate || result.candidate, 'write');
      announceBanner('Outline loaded & confirmed — copy full-write prompt next.');
    } catch (error) {
      await showModal({
        title: 'Outline load failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document
    .getElementById('cs-copy-write')
    ?.addEventListener(
      'click',
      copyPrompt(
        `/api/candidates/${encodeURIComponent(id)}/content/structure/write-prompt`,
        'Full-write prompt',
      ),
    );

  document
    .getElementById('cs-copy-write-home')
    ?.addEventListener(
      'click',
      copyPrompt(
        `/api/candidates/${encodeURIComponent(id)}/content/structure/write-prompt?batch=home`,
        'Home batch prompt',
      ),
    );
  document
    .getElementById('cs-copy-write-services')
    ?.addEventListener(
      'click',
      copyPrompt(
        `/api/candidates/${encodeURIComponent(id)}/content/structure/write-prompt?batch=services`,
        'Services batch prompt',
      ),
    );
  document
    .getElementById('cs-copy-write-locations')
    ?.addEventListener(
      'click',
      copyPrompt(
        `/api/candidates/${encodeURIComponent(id)}/content/structure/write-prompt?batch=locations`,
        'Locations batch prompt',
      ),
    );

  document
    .getElementById('cs-copy-field-research')
    ?.addEventListener('click', async () => {
      try {
        const notes = document.getElementById('cs-field-notes')?.value || '';
        const q = notes.trim()
          ? `?notes=${encodeURIComponent(notes.trim())}`
          : '';
        const data = await api(
          `/api/candidates/${encodeURIComponent(id)}/content/field-research/prompt${q}`,
        );
        await navigator.clipboard.writeText(data.prompt || '');
        showToast('Field-research prompt copied to clipboard.');
      } catch (error) {
        await showModal({
          title: 'Copy failed',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
    });

  document.getElementById('cs-load-field-research')?.addEventListener('click', async () => {
    const text = document.getElementById('cs-field-research-paste')?.value || '';
    if (!text.trim()) {
      await showModal({
        title: 'Nothing to paste',
        confirmLabel: 'OK',
        bodyHtml: '<p>Paste the field-research JSON from Claude first.</p>',
      });
      return;
    }
    try {
      if (!(await confirmLaunchedSiteChange('Load field research'))) return;
      const notes = document.getElementById('cs-field-notes')?.value || '';
      const result = await api(
        `/api/candidates/${encodeURIComponent(id)}/content/field-research`,
        {
          method: 'POST',
          body: JSON.stringify(
            withLaunchedConfirmBody({ json: text, operatorNotes: notes }),
          ),
        },
      );
      await refresh(result.candidate, 'brief');
      announceBanner('Site research loaded — Content brief next.');
    } catch (error) {
      await showModal({
        title: 'Site research load failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('cs-copy-brief')?.addEventListener('click', async () => {
    try {
      const notes = document.getElementById('cs-field-notes')?.value || '';
      const q = notes.trim() ? `?notes=${encodeURIComponent(notes.trim())}` : '';
      const data = await api(
        `/api/candidates/${encodeURIComponent(id)}/content/soft-brief/prompt${q}`,
      );
      await navigator.clipboard.writeText(data.prompt || '');
      showToast('Brief synthesis prompt copied to clipboard.');
    } catch (error) {
      await showModal({
        title: 'Copy failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('cs-confirm-brief')?.addEventListener('click', async () => {
    const text = document.getElementById('cs-brief-paste')?.value || '';
    if (!text.trim()) {
      await showModal({
        title: 'Nothing to paste',
        confirmLabel: 'OK',
        bodyHtml: '<p>Paste the Content brief JSON from Claude first.</p>',
      });
      return;
    }
    try {
      if (!(await confirmLaunchedSiteChange('Load & confirm brief'))) return;
      const result = await api(
        `/api/candidates/${encodeURIComponent(id)}/content/soft-brief/confirm`,
        {
          method: 'POST',
          body: JSON.stringify(withLaunchedConfirmBody({ json: text })),
        },
      );
      await refresh(result.candidate, 'outline');
      announceBanner('Brief confirmed — Outline next.');
    } catch (error) {
      await showModal({
        title: 'Brief confirm failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document
    .getElementById('cs-copy-final')
    ?.addEventListener(
      'click',
      copyPrompt(
        `/api/candidates/${encodeURIComponent(id)}/content/final-check/prompt`,
        'Final-check prompt',
      ),
    );

  document
    .getElementById('cs-copy-images')
    ?.addEventListener(
      'click',
      copyPrompt(
        `/api/candidates/${encodeURIComponent(id)}/content/images-prompt`,
        'Image-queries prompt',
      ),
    );

  document.getElementById('cs-load-images')?.addEventListener('click', async () => {
    const text = document.getElementById('cs-images-paste')?.value || '';
    if (!text.trim()) {
      await showModal({
        title: 'Nothing to paste',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: '<p>Paste the image-queries JSON from Claude first.</p>',
      });
      return;
    }
    try {
      if (!(await confirmLaunchedSiteChange('Load image queries'))) return;
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/content/images-plan`, {
        method: 'POST',
        body: JSON.stringify(withLaunchedConfirmBody({ json: text })),
      });
      const next = nextContentStepAfterImages(result.candidate);
      await refresh(result.candidate, next);
      const n = result.slotCount ? ` ${result.slotCount} slots` : '';
      announceBanner(
        next === 'photoGroup'
          ? `Image queries loaded${n}. Load photo group next.`
          : `Image queries loaded${n}. Accept next.`,
      );
    } catch (error) {
      await showModal({
        title: 'Image queries failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('cs-pg-load')?.addEventListener('click', () =>
    loadPhotoGroupFromUi(id, 'cs-pg-select', {
      attach: true,
      refresh,
      nextStep: 'accept',
      tab: 'content',
    }),
  );
  wirePhotoGroupRankSelects('cs-pg-select');
  document.getElementById('cs-pg-skip')?.addEventListener('click', async () => {
    try {
      if (!(await confirmLaunchedSiteChange('Skip photo group'))) return;
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/photo-groups/skip`, {
        method: 'POST',
        body: JSON.stringify(withLaunchedConfirmBody({})),
      });
      await refresh(result.candidate, 'accept');
      announceBanner(
        result.attached?.groupId
          ? 'Photo group already loaded — Accept next.'
          : 'Load photo group skipped — Accept next.',
      );
    } catch (error) {
      await showModal({
        title: 'Skip photo group failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('cs-load-final')?.addEventListener('click', async () => {
    const text = document.getElementById('cs-final-paste')?.value || '';
    if (!text.trim()) {
      await showModal({
        title: 'Nothing to paste',
        confirmLabel: 'OK',
        bodyHtml: '<p>Paste {"ok":true} or ### FILE fixes from Claude first.</p>',
      });
      return;
    }
    try {
      if (!(await confirmLaunchedSiteChange('Load final-check result'))) return;
      const result = await api(
        `/api/candidates/${encodeURIComponent(id)}/content/final-check`,
        {
          method: 'POST',
          body: JSON.stringify(withLaunchedConfirmBody({ text })),
        },
      );
      const stampedAt =
        result.candidate?.contentDraft?._ops?.lastFinalCheckAt ||
        result.candidate?.stageFlags?.hasContentFinalCheck;
      if (!stampedAt) {
        await showModal({
          title: 'Final check not recorded',
          confirmLabel: 'OK',
          bodyHtml:
            '<p>Server did not stamp Final check. Paste <code>{"ok":true}</code> or ### FILE fixes and Load again.</p>',
        });
        await refresh(result.candidate || state.detail, 'finalCheck');
        return;
      }
      const next = nextContentStepAfterFinal(result.candidate);
      await refresh(result.candidate, next);
      announceBanner(
        next === 'imageQueries'
          ? 'Final check recorded — Image queries next.'
          : next === 'photoGroup'
            ? 'Final check recorded — Load photo group next.'
            : 'Final check recorded — Accept when all required passes are done.',
      );
    } catch (error) {
      await showModal({
        title: 'Final check load failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.querySelectorAll('.js-copy-continue-prompt').forEach((btn) => {
    btn.addEventListener('click', () => copyContinueWritePrompt(id));
  });

  document
    .getElementById('ca-copy-editor')
    ?.addEventListener(
      'click',
      copyPrompt(`/api/candidates/${encodeURIComponent(id)}/content/editor/prompt`, 'Editor prompt'),
    );
  document.getElementById('ca-speech-check')?.addEventListener('click', async () => {
    try {
      const data = await api(`/api/candidates/${encodeURIComponent(id)}/content/speech-lint`);
      const needs = contentNeedsEditorRewrite(data);
      const cand = data.candidate || state.detail;
      if (needs.needed) {
        await showModal({
          title: needs.softOnly
            ? 'Speech/SEO Refinement — rewrite recommended'
            : 'Speech/SEO Refinement — rewrite needed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: speechCheckResultBodyHtml(data),
        });
      } else {
        announceBanner('Speech/SEO Refinement clear — Final check next.');
      }
      await refresh(cand, needs.needed ? 'editor' : 'finalCheck');
    } catch (error) {
      await showModal({
        title: 'Speech/SEO Refinement failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });
  const loadFileBlocks = async (textareaId) => {
    try {
      const text = document.getElementById(textareaId)?.value || '';
      const reAcceptNeeded =
        textareaId === 'ca-editor-paste' &&
        Boolean(state.detail?.content?.files) &&
        Boolean(state.detail?.flags?.hasContent);
      const wantsFull =
        structurePageIdsFromDetail(state.detail).includes('services') ||
        structurePageIdsFromDetail(state.detail).includes('locations') ||
        state.detail?.contentOutlinePackage?.status === 'confirmed';
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/content/agent-paste`, {
        method: 'POST',
        body: JSON.stringify({ text, mode: wantsFull ? 'full' : 'homepage_first' }),
      });
      const launch = result.check?.launch;
      const missing = launch?.missing || [];
      const msgs = [...(result.check?.errors || []), ...(result.check?.warnings || [])];
      const speechN = result.speechLint?.findings?.length || 0;
      const seoN = result.seoLint?.findings?.length || 0;
      const fixN = result.autoFix?.changeCount || 0;
      const fixSpeech = result.autoFix?.speechCount || 0;
      const fixSeo = result.autoFix?.seoCount || 0;
      const proofN = result.socialProofMerge?.merged
        ? result.socialProofMerge?.reviewCount || 0
        : 0;

      if (missing.length) {
        await refresh(result.candidate, textareaId === 'ca-writer-paste' ? 'write' : 'editor');
        const stubs = launch?.stubs || [];
        const expectedFiles = expectedDraftFilesFromDetail(result.candidate || state.detail);
        const incompleteHtml = incompleteDraftExplainHtml({
          have: launch?.have || 0,
          expectedCount: launch?.expectedCount || expectedFiles.length || missing.length,
          missing,
          stubs,
          expected: expectedFiles,
          compact: false,
          showContinueControls: true,
        });
        const proofHtml = proofN
          ? `<p class="muted">Also seeded ${esc(String(proofN))} placeholder review(s) into site-config — replace with real reviews before launch.</p>`
          : '';
        await showModal({
          title: 'Partial draft loaded',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `${incompleteHtml}${proofHtml}
          <p class="muted">Auto-fixed ${esc(String(fixN))} (${esc(String(fixSpeech))} speech · ${esc(
            String(fixSeo),
          )} SEO) · remaining ${esc(String(speechN))} speech · ${esc(String(seoN))} SEO.</p>`,
          afterOpen: (body) => {
            body.querySelectorAll('.js-copy-continue-prompt').forEach((btn) => {
              btn.addEventListener('click', () => copyContinueWritePrompt(id));
            });
          },
        });
        return;
      }

      // Full path count, but stub/thin may still block Accept — surface continue prompt
      const stubsOnly = launch?.stubs || [];
      if (stubsOnly.length) {
        await refresh(result.candidate, textareaId === 'ca-writer-paste' ? 'write' : 'editor');
        const expectedFiles = expectedDraftFilesFromDetail(result.candidate || state.detail);
        const incompleteHtml = incompleteDraftExplainHtml({
          have: launch?.have || 0,
          expectedCount: launch?.expectedCount || expectedFiles.length || 0,
          missing: [],
          stubs: stubsOnly,
          expected: expectedFiles,
          compact: false,
          showContinueControls: true,
        });
        await showModal({
          title: 'Draft needs rewrite',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `${incompleteHtml}
          <p class="muted">Files loaded, but Accept will reject stub/thin service or location pages until you continue-write them.</p>`,
          afterOpen: (body) => {
            body.querySelectorAll('.js-copy-continue-prompt').forEach((btn) => {
              btn.addEventListener('click', () => copyContinueWritePrompt(id));
            });
          },
        });
        return;
      }
      // Full draft: auto Speech/SEO Refinement, then advance
      let speechData = null;
      let needsRewrite = false;
      try {
        speechData = await api(`/api/candidates/${encodeURIComponent(id)}/content/speech-lint`);
        needsRewrite = contentNeedsEditorRewrite(speechData).needed;
      } catch {
        needsRewrite = true;
      }
      const candidate =
        speechData?.candidate || result.candidate || null;
      if (candidate) await applyCandidatePayload(candidate, id);
      else await loadSelectedCandidateDetail(id);
      const nextStep = needsRewrite ? 'editor' : reAcceptNeeded ? 'accept' : 'finalCheck';
      await refresh(candidate, nextStep);
      const bits = [
        'Draft loaded',
        fixN ? `auto-fixed ${fixN}` : null,
        proofN ? `${proofN} placeholder reviews` : null,
        needsRewrite
          ? 'speech/SEO leftovers — rewrite or Accept with care'
          : reAcceptNeeded
            ? 'Speech/SEO Refinement clear — Accept again to publish'
            : 'Speech/SEO Refinement clear — Final check next',
      ].filter(Boolean);
      announceBanner(bits.join(' · '), { tone: needsRewrite || msgs.length ? 'warn' : 'ok' });
    } catch (error) {
      await showModal({
        title: 'Paste failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  };
  document
    .getElementById('ca-paste-writer')
    ?.addEventListener('click', () => loadFileBlocks('ca-writer-paste'));
  document
    .getElementById('ca-paste-editor')
    ?.addEventListener('click', () => loadFileBlocks('ca-editor-paste'));
  let previewWordmarkDataUrl = '';
  let previewWordmarkWarmPromise = null;

  const warmPreviewWordmark = () => {
    if (previewWordmarkDataUrl) return Promise.resolve(previewWordmarkDataUrl);
    if (previewWordmarkWarmPromise) return previewWordmarkWarmPromise;
    const url = `${window.location.origin}/brand/rover-wordmark-dark.png`;
    previewWordmarkWarmPromise = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`wordmark ${res.status}`);
        return res.blob();
      })
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              previewWordmarkDataUrl = String(reader.result || '');
              resolve(previewWordmarkDataUrl);
            };
            reader.onerror = () => reject(reader.error || new Error('wordmark read failed'));
            reader.readAsDataURL(blob);
          }),
      )
      .catch(() => {
        previewWordmarkWarmPromise = null;
        return '';
      });
    return previewWordmarkWarmPromise;
  };
  // Prefetch while Rover is idle so Prepare preview first paint includes the wordmark.
  warmPreviewWordmark();

  const writePreviewTabHtml = (tab, { title, body, done = null, total = null, detail = '' } = {}) => {
    if (!tab || tab.closed) return;
    try {
      const doc = tab.document;
      const existingTitle = doc.getElementById('rover-preview-title');
      const existingBody = doc.getElementById('rover-preview-body');
      const useProgress = done != null && Number(total) > 0;
      const stepLine = useProgress ? prepareStepLine(detail || 'Queued…', done, total) : '';
      const pct = useProgress
        ? Math.max(0, Math.min(100, Math.round((100 * Number(done || 0)) / Number(total))))
        : 0;
      if (existingTitle && existingBody) {
        doc.title = title;
        existingTitle.textContent = title;
        existingBody.innerHTML = body;
        let bar = doc.getElementById('rover-preview-bar');
        let stepEl = doc.getElementById('rover-preview-step');
        if (useProgress && (!bar || !stepEl)) {
          const progress = doc.createElement('div');
          progress.className = 'preview-progress';
          progress.innerHTML = `<div class="preview-progress-track"><div class="preview-progress-bar" id="rover-preview-bar"></div></div><p class="preview-progress-step" id="rover-preview-step"></p>`;
          existingTitle.insertAdjacentElement('afterend', progress);
          bar = doc.getElementById('rover-preview-bar');
          stepEl = doc.getElementById('rover-preview-step');
        }
        if (useProgress && bar) bar.style.width = `${pct}%`;
        if (useProgress && stepEl) stepEl.textContent = stepLine;
        return;
      }

      const brandBase = `${window.location.origin}/brand`;
      const wordSrc = previewWordmarkDataUrl || `${brandBase}/rover-wordmark-dark.png`;
      tab.document.open();
      tab.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
        <link rel="stylesheet" href="${brandBase}/rover-loader.css" />
        <style>
          *{box-sizing:border-box}
          body{
            margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
            font:15px/1.45 system-ui,sans-serif;color:#e8e8e8;background:#000;
            padding:1.5rem;
          }
          .wrap{display:flex;flex-direction:column;align-items:center;gap:1.25rem;max-width:28rem;text-align:center;width:min(28rem,100%)}
          h1{font-size:1.05rem;font-weight:600;margin:0;color:#fff}
          p{margin:0;color:rgba(255,255,255,0.72)}
          code{font-size:0.9em;color:rgba(255,255,255,0.88)}
          .preview-progress{width:100%;display:flex;flex-direction:column;gap:.4rem;align-items:stretch}
          .preview-progress-track{height:6px;border-radius:999px;background:rgba(255,255,255,.15);overflow:hidden}
          .preview-progress-bar{height:100%;width:0;background:#2f6bff;border-radius:999px;transition:width .25s ease}
          .preview-progress-step{margin:0;font-size:.8rem;font-weight:650;color:#fff}
          /* Critical hero loader — about:blank often cannot load /brand CSS */
          .rover-loader{
            --rover-loader-accent:#2f6bff;
            --rover-loader-ring:#fff;
            display:flex;flex-direction:column;align-items:center;justify-content:center;
            gap:1.5rem;width:auto;max-width:100%;line-height:0;
          }
          .rover-loader-mark{
            width:min(12rem,40vw);height:min(12rem,40vw);
            flex-shrink:0;display:block;overflow:visible;
          }
          .rover-loader-dot{fill:var(--rover-loader-accent)}
          .rover-loader-ring circle{fill:none;stroke:var(--rover-loader-ring);stroke-linecap:round}
          .rover-loader-ring--inner circle{stroke-width:3.5;stroke-dasharray:12 11.5}
          .rover-loader-ring--outer circle{stroke-width:3;stroke-dasharray:9.5 9.3}
          .rover-loader-ring--inner{
            transform-box:fill-box;transform-origin:center;
            animation:rover-spin-ccw 2.4s linear infinite;
          }
          .rover-loader-ring--outer{
            transform-box:fill-box;transform-origin:center;
            animation:rover-spin-cw 3.2s linear infinite;
          }
          .rover-loader-word{
            display:block;height:2.25rem;width:auto;max-width:min(16rem,70vw);object-fit:contain;
          }
          @keyframes rover-spin-cw{to{transform:rotate(360deg)}}
          @keyframes rover-spin-ccw{to{transform:rotate(-360deg)}}
          @media (prefers-reduced-motion:reduce){
            .rover-loader-ring--inner,.rover-loader-ring--outer{animation:none}
          }
        </style></head><body>
        <div class="wrap" id="rover-preview-shell">
          <div class="rover-loader rover-loader--dark rover-loader--hero" role="img" aria-label="Loading">
            <svg class="rover-loader-mark" viewBox="0 0 64 64" width="192" height="192" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true">
              <circle class="rover-loader-dot" cx="32" cy="32" r="7.5"></circle>
              <g class="rover-loader-ring rover-loader-ring--inner">
                <circle cx="32" cy="32" r="15" transform="rotate(-45 32 32)"></circle>
              </g>
              <g class="rover-loader-ring rover-loader-ring--outer">
                <circle cx="32" cy="32" r="24" transform="rotate(-11 32 32)"></circle>
              </g>
            </svg>
            <img class="rover-loader-word" src="${wordSrc}" alt="" width="618" height="81" decoding="sync" />
          </div>
          <h1 id="rover-preview-title">${title}</h1>
          ${
            useProgress
              ? `<div class="preview-progress">
            <div class="preview-progress-track"><div class="preview-progress-bar" id="rover-preview-bar" style="width:${pct}%"></div></div>
            <p class="preview-progress-step" id="rover-preview-step"></p>
          </div>`
              : ''
          }
          <p id="rover-preview-body">${body}</p>
        </div>
        </body></html>`);
      tab.document.close();
      if (useProgress) {
        const stepEl = tab.document.getElementById('rover-preview-step');
        if (stepEl) stepEl.textContent = stepLine;
      }
    } catch {
      /* cross-origin or closed */
    }
  };

  const openAssembledPreview = async ({ quiet = false, previewTab: existingTab = null } = {}) => {
    const previewUrlDefault = 'http://127.0.0.1:4322/';
    let previewTab = existingTab;
    if (!previewTab || previewTab.closed) {
      try {
        previewTab = window.open('about:blank', '_blank');
      } catch {
        previewTab = null;
      }
    }
    await warmPreviewWordmark();
    // Reused Prepare tab already has the one waiting blurb — don't swap copy mid-run.
    let hasShell = false;
    try {
      hasShell = Boolean(previewTab && !previewTab.closed && previewTab.document?.getElementById('rover-preview-title'));
    } catch {
      hasShell = false;
    }
    if (!hasShell) {
      writePreviewTabHtml(previewTab, {
        title: 'Starting assembled preview…',
        body: 'Rover is starting the site preview on <code>127.0.0.1:4322</code>. This can take up to a couple of minutes — keep this tab open.',
      });
    }
    if (!quiet) setAssembleProgress(true, 'Starting preview server on :4322…');
    const waitTimer = setInterval(() => {
      if (!quiet) setAssembleProgress(true, 'Waiting for preview on :4322 (astro preview)…');
    }, 8000);
    try {
      const preview = await api(`/api/candidates/${encodeURIComponent(id)}/assembled/preview`, {
        method: 'POST',
        body: JSON.stringify({ forceRebind: true }),
      });
      const url = preview.url || previewUrlDefault;
      if (preview.ok) {
        if (!quiet) setAssembleProgress(true, 'Preview server ready — opening site…');
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
      } else {
        writePreviewTabHtml(previewTab, {
          title: 'Assembled preview failed',
          body: esc(String(preview.error || 'Could not start assembled preview on :4322.')),
        });
      }
      return preview;
    } catch (error) {
      writePreviewTabHtml(previewTab, {
        title: 'Assembled preview failed',
        body: esc(String(error?.message || error || 'Could not start assembled preview.')),
      });
      throw error;
    } finally {
      clearInterval(waitTimer);
      // Caller owns clearing sticky progress (Prepare / Open site preview finally).
    }
  };

  document.getElementById('ca-prepare-preview')?.addEventListener('click', async () => {
    state.preparePreviewHold = true;
    state.preparePreviewJobId = null;
    state.websiteOpenStep = 'prepare';
    state.websiteSoftCurrent = 'prepare';
    state.websiteFollowCurrent = 'prepare';
    // Re-render so Prepare is disabled before gaps/modals.
    renderDetail();
    setAssembleProgress(true, 'Checking content…', { done: 0, total: 5 });
    let previewTab = null;
    const abortPrepareUi = () => {
      state.preparePreviewHold = false;
      state.preparePreviewJobId = null;
      state.preparePreviewTab = null;
      setAssembleProgress(false);
      try {
        if (previewTab && !previewTab.closed) previewTab.close();
      } catch {
        /* ignore */
      }
      if (state.selectedId === id && state.tab === 'website') renderDetail();
    };
    try {
      const gaps = await api(
        `/api/candidates/${encodeURIComponent(id)}/launch-content-gaps`,
      );
      let forcePrepare = false;
      if (!gaps.ok) {
        const gapPaths = [...(gaps.missing || []), ...(gaps.stubs || [])];
        const proceed = await showModal({
          title: 'Content not launch-ready',
          confirmLabel: 'Prepare anyway',
          cancelLabel: 'Cancel',
          danger: true,
          bodyHtml: `<p>${esc(gaps.error || 'Stub or missing location/service pages.')}</p>
            <p class="muted">Continue write / Accept full pages first to avoid wasting Prepare time. Staging still enforces this gate if you force.</p>
            ${
              gapPaths.length
                ? `<ul class="narrative-list">${gapPaths
                    .slice(0, 16)
                    .map((m) => `<li><code>${esc(String(m))}</code></li>`)
                    .join('')}</ul>`
                : ''
            }`,
        });
        if (!proceed) {
          abortPrepareUi();
          return;
        }
        forcePrepare = true;
      }

      if (!(await confirmLaunchedSiteChange('Prepare preview'))) {
        abortPrepareUi();
        return;
      }

      try {
        previewTab = window.open('about:blank', '_blank');
      } catch {
        previewTab = null;
      }
      await warmPreviewWordmark();
      writePreviewTabHtml(previewTab, {
        title: 'Preparing preview…',
        body: 'Rover is staging, assembling, and starting the site preview (port pool from :4322). This can take a couple of minutes — keep this tab open.',
        done: 0,
        total: 5,
        detail: 'Queued…',
      });
      state.preparePreviewTab = previewTab;
      setAssembleProgress(true, 'Queued…', { done: 0, total: 5 });

      let jobId = null;
      try {
        const accepted = await api(`/api/candidates/${encodeURIComponent(id)}/prepare-preview`, {
          method: 'POST',
          body: JSON.stringify(withLaunchedConfirmBody({ forcePrepare })),
        });
        jobId = accepted.jobId;
      } catch (enqueueErr) {
        if (enqueueErr.code === 'HEAVY_CONCURRENCY') {
          abortPrepareUi();
          await explainConcurrencyLimit({
            key: 'heavy',
            running: enqueueErr.running,
            limit: enqueueErr.limit ?? state.concurrency?.heavy ?? 2,
          });
          return;
        }
        const joinId = enqueueErr?.status === 409 && enqueueErr?.job?.id ? enqueueErr.job.id : null;
        if (!joinId) throw enqueueErr;
        jobId = joinId;
        setAssembleProgress(true, 'Prepare preview already running — joining…', { done: 0, total: 5 });
      }
      state.preparePreviewJobId = jobId;
      const prepared = await waitForHeavyJobResult(jobId);
      const staged = prepared.staged || {};
      const serviceN = staged.serviceCount != null ? Number(staged.serviceCount) : null;
      const locationN = staged.locationCount != null ? Number(staged.locationCount) : null;
      const modeLabel =
        prepared.mode === 'refresh'
          ? 'Refresh'
          : prepared.fullReason === 'template'
            ? 'Full assemble (template newer)'
            : 'Full assemble';
      const assembleMs =
        prepared.ms != null ? `${Math.round(Number(prepared.ms) / 1000)}s` : '';
      const buildMs =
        prepared.build?.ms != null ? `${Math.round(Number(prepared.build.ms) / 1000)}s` : '';
      const preview = prepared.preview || null;
      if (preview?.ok && preview.url) {
        setAssembleProgress(true, 'Preview ready — opening site…', { done: 5, total: 5 });
        try {
          if (previewTab && !previewTab.closed) {
            previewTab.location.replace(preview.url);
            previewTab.focus?.();
          } else {
            window.open(preview.url, '_blank');
          }
        } catch {
          window.open(preview.url, '_blank');
        }
      } else if (preview && !preview.ok) {
        writePreviewTabHtml(previewTab, {
          title: 'Assembled preview failed',
          body: esc(String(preview.error || 'Could not start assembled preview.')),
        });
      }
      state.preparePreviewHold = false;
      await refresh(prepared.candidate || state.detail, 'launch', 'website');
      setAssembleProgress(true, preview?.ok ? 'Preview ready' : 'Preview failed', {
        done: 5,
        total: 5,
      });
      announceStepComplete('Prepare preview');
      const buildLine = prepared.build?.ok
        ? prepared.build?.buildSkipped
          ? `Build skipped (dist still fresh${buildMs ? ` · ${buildMs}` : ''})`
          : prepared.build?.npmInstallSkipped
            ? `Build ok (reused node_modules${buildMs ? ` · ${buildMs}` : ''})`
            : `Build ok${buildMs ? ` · ${buildMs}` : ''}`
        : prepared.build?.error
          ? `Build failed: ${prepared.build.error}`
          : 'Build skipped';
      const previewUrl = preview?.ok && preview?.url ? preview.url : null;
      const map = previewSitemapHtml(state.detail);
      await showModal({
        title:
          prepared.build?.ok === false
            ? 'Prepared (build failed)'
            : preview?.ok
              ? 'Preview ready'
              : 'Prepared (preview failed)',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>Stage → ${esc(modeLabel)} complete (local preview only${
          assembleMs ? ` · assemble ${esc(assembleMs)}` : ''
        }).</p>
          <p>${
            serviceN != null
              ? `<strong>${esc(String(serviceN))} service page(s)</strong> staged`
              : 'Full package staged'
          }${
            locationN != null ? ` · <strong>${esc(String(locationN))} location page(s)</strong>` : ''
          }${
            Array.isArray(staged.written) ? ` · ${esc(String(staged.written.length))} files` : ''
          }.</p>
          <p>${esc(buildLine)}. Use <strong>Push updates</strong> or <strong>Run launch</strong> to ship live.</p>
          ${
            preview?.ok && previewUrl
              ? `<p>Opened <a href="${esc(previewUrl)}" target="_blank" rel="noopener">${esc(previewUrl)}</a> — click every Preview sitemap URL before Launch.</p>${map}`
              : `<p class="callout warn">${esc(preview?.error || 'Could not open assembled preview')}</p>`
          }`,
      });
    } catch (error) {
      writePreviewTabHtml(previewTab, {
        title: 'Prepare preview failed',
        body: esc(String(error?.message || error || 'Prepare preview failed.')),
      });
      const missing = error.check?.missing || error.check?.stubs || error.check?.errors || [];
      await showModal({
        title: 'Prepare preview failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>${
          missing.length
            ? `<ul class="narrative-list">${missing
                .slice(0, 12)
                .map((m) => `<li><code>${esc(typeof m === 'string' ? m : m)}</code></li>`)
                .join('')}</ul>`
            : ''
        }`,
      });
    } finally {
      state.preparePreviewHold = false;
      state.preparePreviewJobId = null;
      state.preparePreviewTab = null;
      setAssembleProgress(false);
      if (state.selectedId === id && state.tab === 'website') renderDetail();
    }
  });
  document.getElementById('ca-pg-menu-toggle')?.addEventListener('click', () => {
    const toggle = document.getElementById('ca-pg-menu-toggle');
    const panel = document.getElementById('ca-pg-menu');
    if (!toggle || !panel) return;
    const willOpen = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !willOpen);
    toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    state.reviewPhotoGroupMenuOpen = willOpen;
  });
  const pgMenu = document.querySelector('#tab-panels [data-content-step="images"] .photo-group-menu');
  if (pgMenu && pgMenu.dataset.leaveWired !== '1') {
    pgMenu.dataset.leaveWired = '1';
    let leaveTimer = null;
    const selectFocused = () => {
      const ae = document.activeElement;
      return Boolean(ae && pgMenu.contains(ae) && String(ae.tagName || '').toLowerCase() === 'select');
    };
    const closeMenu = () => {
      const toggle = document.getElementById('ca-pg-menu-toggle');
      const panel = document.getElementById('ca-pg-menu');
      if (!toggle || !panel) return;
      panel.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
      state.reviewPhotoGroupMenuOpen = false;
    };
    pgMenu.addEventListener('mouseenter', () => {
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
    });
    pgMenu.addEventListener('mouseleave', () => {
      if (selectFocused()) return;
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        if (selectFocused()) return;
        closeMenu();
      }, 180);
    });
  }
  document.getElementById('ca-pg-save')?.addEventListener('click', () =>
    savePhotoGroupFromUi(id, { refresh, nextStep: 'images', tab: 'website' }),
  );
  document.getElementById('ca-pg-load')?.addEventListener('click', () =>
    loadPhotoGroupFromUi(id, 'ca-pg-select', {
      attach: false,
      refresh,
      nextStep: 'images',
      tab: 'website',
    }),
  );
  wirePhotoGroupRankSelects('ca-pg-select');
  wireImageSlotActions(id, refresh);
  if (state.websiteOpenStep === 'images') {
    if ((state.reviewImageSlots && state.reviewImageSlots.length) || state.reviewBa) {
      paintReviewImageSlotsFromState(id, { renderToolbar: true });
    }
    void refreshImageSlotsGrid(id);
  }
  document.getElementById('ca-logo-style')?.addEventListener('click', (ev) => {
    const seg = ev.target.closest('[data-logo-style]');
    if (!seg) return;
    ev.preventDefault();
    const prev = selectedLogoGenerateMode();
    document.querySelectorAll('#ca-logo-style [data-logo-style]').forEach((b) => {
      b.classList.toggle('active', b === seg);
    });
    const next = logoGenerateModeFromValue(seg.getAttribute('data-logo-style'));
    const ta = document.getElementById('ca-logo-prompt');
    const defaults = state.detail?.logoPromptDefaults || {};
    if (ta && (next === 'mark' || next === 'markText')) {
      const prevDefault = String(defaults[prev] || '').trim();
      if (!ta.value.trim() || ta.value.trim() === prevDefault) {
        ta.value = defaults[next] || ta.value;
      }
    }
    syncLogoGenerateButton();
  });
  document.getElementById('ca-generate-logo')?.addEventListener('click', async () => {
    const btn = document.getElementById('ca-generate-logo');
    const mode = selectedLogoGenerateMode();
    const needsAi = mode === 'mark' || mode === 'markText';
    if (needsAi && !fluxIsOpenaiConfigured()) {
      await showModal({
        title: 'OpenAI key required',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: '<p>Set <code>OPENAI_API_KEY</code> in .env (same key as Phone), then restart Rover.</p>',
      });
      return;
    }
    if (!(await confirmLaunchedSiteChange('Generate / regenerate logo'))) return;
    if (btn) btn.disabled = true;
    const logoCard = document.querySelector('#ca-logo-map-previews .logo-map-preview-logo');
    if (needsAi && logoCard) setSlotGenerateOverlay(logoCard, true);
    setImagesProgress(true, {
      label: 'Generating logo…',
      detail: needsAi ? 'GPT Image 2…' : 'Building SVG monogram',
      current: 1,
      total: 3,
      box: 'ca-logo-map',
    });
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/logo/generate`, {
        method: 'POST',
        body: JSON.stringify(
          withLaunchedConfirmBody({
            mode,
            prompt: needsAi ? document.getElementById('ca-logo-prompt')?.value || '' : '',
          }),
        ),
      });
      const payload =
        result?.accepted && result.jobId ? await waitForLightJobResult(result.jobId) : result;
      setImagesProgress(true, {
        label: 'Logo ready',
        detail: payload.path || payload.logo?.src || '/images/logo.svg',
        current: 3,
        total: 3,
        box: 'ca-logo-map',
      });
      announceStepComplete('Generate logo');
      await refresh(payload.candidate, 'logoMap', 'website');
      await showModal({
        title: 'Logo generated',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>Wrote <code>${esc(payload.path || payload.logo?.src || '/images/logo.svg')}</code> and set site-config <code>logo</code>. Use <strong>Prepare preview</strong> to see it on the header.</p>`,
      });
    } catch (error) {
      setImagesProgress(false, { box: 'ca-logo-map' });
      await showModal({
        title: 'Logo failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      if (logoCard) setSlotGenerateOverlay(logoCard, false);
      if (btn) btn.disabled = false;
      syncLogoGenerateButton();
      setTimeout(() => setImagesProgress(false, { box: 'ca-logo-map' }), 800);
    }
  });
  syncLogoGenerateButton();
  document.getElementById('ca-logo-map-previews')?.addEventListener('click', async (ev) => {
    const logoVar = ev.target.closest('[data-logo-variant]');
    const mapVar = ev.target.closest('[data-map-variant]');
    if (!logoVar && !mapVar) return;
    ev.preventDefault();
    const filename = (logoVar || mapVar).getAttribute(logoVar ? 'data-logo-variant' : 'data-map-variant');
    if (!filename) return;
    if (
      !(await confirmLaunchedSiteChange(
        logoVar ? 'Switch to this logo' : 'Switch to this coverage map',
      ))
    ) {
      return;
    }
    const path = logoVar
      ? `/api/candidates/${encodeURIComponent(id)}/logo/variants/use`
      : `/api/candidates/${encodeURIComponent(id)}/coverage-map/variants/use`;
    try {
      const result = await api(path, {
        method: 'POST',
        body: JSON.stringify(withLaunchedConfirmBody({ filename })),
      });
      await refresh(result.candidate, 'logoMap', 'website');
    } catch (error) {
      await showModal({
        title: logoVar ? 'Logo switch failed' : 'Map switch failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });
  document.getElementById('ca-map-label-placement')?.addEventListener('click', (ev) => {
    const seg = ev.target.closest('[data-map-label-placement]');
    if (!seg) return;
    ev.preventDefault();
    document.querySelectorAll('#ca-map-label-placement [data-map-label-placement]').forEach((b) => {
      b.classList.toggle('active', b === seg);
    });
  });
  document.getElementById('ca-generate-map')?.addEventListener('click', async () => {
    const btn = document.getElementById('ca-generate-map');
    if (!(await confirmLaunchedSiteChange('Generate coverage map'))) return;
    if (btn) btn.disabled = true;
    const labelPlacement =
      document
        .querySelector('#ca-map-label-placement .ads-mode-seg.active')
        ?.getAttribute('data-map-label-placement') === 'center'
        ? 'center'
        : 'callout';
    setImagesProgress(true, {
      label: 'Generating coverage map…',
      detail: 'Starting…',
      current: 0,
      total: 0,
      box: 'ca-logo-map',
    });
    let pollTimer = null;
    const pollProgress = async () => {
      try {
        const snap = await api(
          `/api/candidates/${encodeURIComponent(id)}/coverage-map/progress`,
        );
        if (!snap || (snap.status !== 'running' && !snap.active)) return;
        const total = Number(snap.total) || 0;
        const current = Number(snap.current) || 0;
        setImagesProgress(true, {
          label: total > 0 ? `Coverage map ${current}/${total}` : 'Generating coverage map…',
          detail: snap.detail || snap.label || 'Starting…',
          current,
          total,
          box: 'ca-logo-map',
        });
      } catch {
        // ignore poll errors while generate runs
      }
    };
    pollTimer = setInterval(pollProgress, 500);
    void pollProgress();
    try {
      const accepted = await api(`/api/candidates/${encodeURIComponent(id)}/coverage-map/generate`, {
        method: 'POST',
        body: JSON.stringify(withLaunchedConfirmBody({ labelPlacement })),
      });
      const result =
        accepted?.accepted && accepted.jobId
          ? await waitForLightJobResult(accepted.jobId)
          : accepted;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      const total = Number(result.requested || result.areas) || 1;
      setImagesProgress(true, {
        label: 'Coverage map ready',
        detail: `${result.areas || '?'} areas · ${result.path || 'coverage-map.svg'}`,
        current: total,
        total,
        box: 'ca-logo-map',
      });
      announceStepComplete('Coverage map');
      await refresh(result.candidate, 'logoMap', 'website');
      const miss = Array.isArray(result.missingBoundaries) ? result.missingBoundaries : [];
      const missHtml = miss.length
        ? `<p class="callout warn"><strong>No map outline</strong> (still listed as Also serving on the site): ${esc(
            miss.join('; '),
          )}.</p>`
        : '';
      await showModal({
        title: 'Coverage map ready',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>Wrote <code>${esc(result.path || 'coverage-map.svg')}</code> with <strong>${esc(
          String(result.areas || ''),
        )}</strong> outlined area(s)${
          result.requested != null && result.requested !== result.areas
            ? ` of ${esc(String(result.requested))} requested`
            : ''
        } and wired <code>coverageMap</code> on homepage.</p>${missHtml}<p class="muted">Use <strong>Prepare preview</strong> to refresh Areas.</p>`,
      });
    } catch (error) {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      setImagesProgress(false, { box: 'ca-logo-map' });
      await showModal({
        title: 'Coverage map failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      if (pollTimer) clearInterval(pollTimer);
      if (btn) btn.disabled = false;
      setTimeout(() => setImagesProgress(false, { box: 'ca-logo-map' }), 800);
    }
  });

  document.getElementById('ca-open-assembled-preview')?.addEventListener('click', async () => {
    if (isAssembleStaleClient(state.detail)) {
      const goPrepare = await showModal({
        title: 'Assemble is stale',
        confirmLabel: 'Prepare preview',
        cancelLabel: 'Preview anyway',
        bodyHtml: `<p>Staging (<code>${esc(
          state.detail?.meta?.lastSiteStagingAt || '',
        )}</code>) is newer than Assemble (<code>${esc(
          state.detail?.meta?.lastAssembleAt || 'never',
        )}</code>).</p>
        <p>Preview may show incomplete/old content. Run <strong>Prepare preview</strong> for launch fidelity.</p>`,
      });
      if (goPrepare) {
        document.getElementById('ca-prepare-preview')?.click();
        return;
      }
    }
    setAssembleProgress(true, 'Starting assembled preview…');
    try {
      const preview = await openAssembledPreview({ quiet: false });
      const url = preview?.url || 'http://127.0.0.1:4322/';
      const map = previewSitemapHtml(state.detail);
      const bindNote = preview?.rebound
        ? ' (rebound :4322 to this assembled site)'
        : preview?.started
          ? ' (started preview server)'
          : ' (already bound to this site)';
      await showModal({
        title: preview?.ok ? 'Assembled preview ready' : 'Assembled preview failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: preview?.ok
          ? `<p>Opened this candidate’s assembled site: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>${bindNote}.</p>
             <p class="muted">Path: <code>${esc(preview.assembledSitePath || preview.boundSiteRoot || '')}</code></p>
             ${map}`
          : `<p>${esc(preview?.error || 'Could not start assembled preview')}</p>`,
      });
    } catch (error) {
      await showModal({
        title: 'Preview failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      setAssembleProgress(false);
    }
  });

  document.getElementById('ca-visual-edit')?.addEventListener('click', async () => {
    await openVisualEditor(id, { api, esc, showModal });
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

  const fillLaunchDefaults = async () => {
    try {
      const st = await api(`/api/candidates/${encodeURIComponent(id)}/launch`);
      const dest = document.getElementById('ca-launch-dest');
      if (dest && !dest.value && st.defaultNotifyEmail) dest.value = st.defaultNotifyEmail;
      return st;
    } catch {
      return null;
    }
  };
  fillLaunchDefaults();
  loadShipFreshness(id);

  document.getElementById('ca-ship-diff-refresh')?.addEventListener('click', async () => {
    const btn = document.getElementById('ca-ship-diff-refresh');
    if (btn) btn.disabled = true;
    try {
      await loadShipFreshness(id, { showError: true });
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById('ca-ship-diff-show')?.addEventListener('click', async () => {
    const btn = document.getElementById('ca-ship-diff-show');
    if (btn) btn.disabled = true;
    try {
      const diff = await loadShipFreshness(id, { showError: true });
      await showModal({
        title: 'Ship file differences',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: formatShipDiffModalHtml(
          diff || {
            status: 'unknown',
            summary: 'Could not load diff.',
            files: [],
            dirty: [],
            stat: '',
          },
        ),
      });
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById('ca-download-nap')?.addEventListener('click', () => {
    const cfg = effectiveSiteConfigForLaunchClient(
      state.detail?.siteConfig,
      state.detail?.siteConfigDraft,
    );
    const csv = napCsvFromSiteConfig(cfg);
    const host = String(cfg.domain || cfg.businessName || 'site')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    downloadText(`${host || 'site'}-nap.csv`, csv, 'text/csv');
  });

  document.getElementById('ca-copy-site-url')?.addEventListener('click', async () => {
    const cfg = effectiveSiteConfigForLaunchClient(
      state.detail?.siteConfig,
      state.detail?.siteConfigDraft,
    );
    const url =
      document.getElementById('ca-site-url-text')?.textContent?.trim() ||
      liveSiteUrl(cfg.domain);
    if (!url) {
      showToast('Set a real domain first.', { tone: 'warn' });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('Site URL copied.');
    } catch {
      showToast('Could not copy — select the URL below.', { tone: 'warn' });
    }
  });

  document.getElementById('ca-copy-sitemap-url')?.addEventListener('click', async () => {
    const cfg = effectiveSiteConfigForLaunchClient(
      state.detail?.siteConfig,
      state.detail?.siteConfigDraft,
    );
    const url =
      document.getElementById('ca-sitemap-url-text')?.textContent?.trim() ||
      liveSitemapUrl(cfg.domain);
    if (!url) {
      showToast('Set a real domain first.', { tone: 'warn' });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('Sitemap URL copied.');
    } catch {
      showToast('Could not copy — select the URL below.', { tone: 'warn' });
    }
  });

  document.getElementById('ca-indexing-mark-done')?.addEventListener('click', async () => {
    if (Boolean(state.detail?.meta?.indexingDone)) return;
    const btn = document.getElementById('ca-indexing-mark-done');
    if (btn) btn.disabled = true;
    state.websiteSoftDone = { ...(state.websiteSoftDone || {}), indexing: true };
    state.websiteFollowCurrent = null;
    state.websiteOpenStep = 'indexing';
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/indexing/done`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (result.candidate) await applyCandidatePayload(result.candidate);
      else await loadSelectedCandidateDetail(id);
      showToast('Indexing marked done.');
      renderDetail();
      notifyCandidatesChanged({ type: 'candidates', ids: [id] });
    } catch (error) {
      const map = { ...(state.websiteSoftDone || {}) };
      delete map.indexing;
      state.websiteSoftDone = map;
      if (btn) btn.disabled = false;
      await showModal({
        title: 'Could not save Indexing',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('ca-revert-launched')?.addEventListener('click', async () => {
    const btn = document.getElementById('ca-revert-launched');
    const repo = String(state.detail?.meta?.githubRepo || '').trim();
    const ok = await showModal({
      title: 'Revert to launched site?',
      confirmLabel: 'Revert',
      cancelLabel: 'Cancel',
      danger: true,
      requireTypedConfirm: 'REVERT',
      bodyHtml: `<p>This overwrites Rover’s <strong>content, structure, site-config, and images</strong> with <code>${esc(
        repo || 'GitHub origin/main',
      )}</code>.</p>
        <p>The <strong>live Cloudflare site is not changed</strong>.</p>
        <p class="muted">Type <code>REVERT</code> to enable the button.</p>`,
    });
    if (!ok) return;
    if (btn) btn.disabled = true;
    setAssembleProgress(true, 'Reverting from launched GitHub site…');
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/revert-launched`, {
        method: 'POST',
        body: JSON.stringify({ confirmRevert: true }),
      });
      await refresh(result.candidate || state.detail, 'launch', 'website');
      setAssembleProgress(false);
      await showModal({
        title: 'Reverted to launched site',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>Restored from <code>${esc(result.githubRepo || repo)}</code>${
          result.sha ? ` @ <code>${esc(result.sha)}</code>` : ''
        }.</p>
          <p>${esc(String(result.contentFiles || 0))} content file(s) · ${esc(
          String(result.imagesCopied || 0),
        )} image(s). Live site unchanged — use Prepare preview if you want a local preview.</p>`,
      });
    } catch (error) {
      setAssembleProgress(false);
      await showModal({
        title: 'Revert failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById('ca-launch-status')?.addEventListener('click', async () => {
    try {
      const st = await fillLaunchDefaults();
      if (!st) throw new Error('Could not load launch status');
      let ship = null;
      try {
        ship = await api(`/api/candidates/${encodeURIComponent(id)}/ship`);
      } catch {
        ship = null;
      }
      const flags = [
        `Assembled: ${st.assembled ? 'yes' : 'no'}`,
        `GitHub repo: ${st.githubRepo || ship?.githubRepo || 'not yet'}`,
        `gh authenticated: ${ship ? (ship.ghAuthenticated ? 'yes' : 'no — run gh auth login once') : 'unknown'}`,
        `GitHub owner: ${ship?.githubOwner || 'set GITHUB_OWNER in .env'}`,
        `CF credentials: ${st.cloudflareConfigured ? 'yes' : 'missing in .env'}`,
        `Web3Forms key: ${st.web3FormsAccessKeySet ? 'set' : 'placeholder / missing'}`,
        `CF Worker project: ${st.cloudflarePagesDone ? '✓' : '○'}`,
        `DNS / custom domain: ${st.dnsDone ? '✓' : '○'}`,
        `Forms: ${st.formsDone ? '✓' : '○'}`,
        `Email Routing: ${st.emailRoutingDone ? '✓' : '○'}`,
        st.lastShipAt ? `Last ship: ${st.lastShipAt}` : '',
        st.lastLaunchAt ? `Last launch: ${st.lastLaunchAt}` : '',
      ]
        .filter(Boolean)
        .map((l) => `<li>${esc(l)}</li>`)
        .join('');
      await showModal({
        title: 'Launch status',
        confirmLabel: 'OK',
        bodyHtml: `<ul class="narrative-list">${flags}</ul>
          <p class="muted">Slug: <code>${esc(st.assembledSiteSlug || '—')}</code>
          · path: <code>${esc(st.assembledSitePath || '—')}</code></p>
          <p class="muted">Human leftovers: before CF attach — buy/point domain NS → Cloudflare; paste Web3Forms key; after — verify Email Routing destination once. One-time machine: <code>gh auth login</code> + <code>GITHUB_OWNER</code> + <code>CLOUDFLARE_*</code>.</p>`,
      });
    } catch (error) {
      await showModal({ title: 'Failed', confirmLabel: 'OK', bodyHtml: `<p>${esc(error.message)}</p>` });
    }
  });

  document.getElementById('ca-push-updates')?.addEventListener('click', async () => {
    if (isAssembleStaleClient(state.detail)) {
      const proceed = await showModal({
        title: 'Assemble is stale',
        confirmLabel: 'Push anyway',
        cancelLabel: 'Cancel',
        danger: true,
        bodyHtml: `<p>Staging is newer than Assemble. Push may ship incomplete/old content.</p>
          <p>Prefer <strong>Prepare preview</strong> first, then Push updates.</p>`,
      });
      if (!proceed) return;
    }

    const pushBtn = document.getElementById('ca-push-updates');
    const launchBtn = document.getElementById('ca-launch');
    const form = document.getElementById('ca-launch-form');
    if (pushBtn) pushBtn.disabled = true;
    if (launchBtn) launchBtn.disabled = true;
    form?.querySelectorAll('input,button,select,textarea').forEach((el) => {
      el.disabled = true;
    });
    showShipOverlayStarting();
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/ship`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await refresh(result.candidate || state.detail, 'launch', 'website');
      announceStepComplete('Push updates');
      const human = (result.human || []).map((h) => `<li>${esc(h)}</li>`).join('');
      await showModal({
        title: result.ok ? 'Updates pushed' : 'Push partial',
        confirmLabel: 'OK',
        bodyHtml: `<p>Ship-only: GitHub + build + Cloudflare Worker (no domain/email setup).</p>
          <ul class="narrative-list">${human || '<li>No extra notes</li>'}</ul>
          ${
            result.steps?.github?.repoUrl
              ? `<p class="muted">Repo: <a href="${esc(result.steps.github.repoUrl)}" target="_blank" rel="noopener">${esc(result.steps.github.fullName || result.steps.github.repoUrl)}</a></p>`
              : ''
          }
          <p class="muted">If the live site still looks old, confirm <strong>Prepare preview</strong> ran after your template/content changes, then Push updates again.</p>`,
      });
    } catch (error) {
      if (await maybeExplainHeavyConcurrency(error)) return;
      await showModal({
        title: 'Push updates failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      hideShipOverlay();
      form?.querySelectorAll('input,button,select,textarea').forEach((el) => {
        el.disabled = false;
      });
      if (pushBtn) pushBtn.disabled = false;
      if (launchBtn) launchBtn.disabled = false;
    }
  });

  document.getElementById('ca-launch')?.addEventListener('click', async () => {
    if (isAssembleStaleClient(state.detail)) {
      const proceed = await showModal({
        title: 'Assemble is stale',
        confirmLabel: 'Launch anyway',
        cancelLabel: 'Cancel',
        danger: true,
        bodyHtml: `<p>Staging is newer than Assemble. Launch may ship incomplete/old content.</p>
          <p>Prefer <strong>Prepare preview</strong> and check the Preview sitemap first.</p>`,
      });
      if (!proceed) return;
    }

    const pendingBody = collectLaunchFormValues();
    const issues = launchPreflightIssues(pendingBody);
    let allowIncompleteLaunch = false;
    if (issues.length && pendingBody.ship !== false) {
      const ok = await showModal({
        title: 'Launch blocked — incomplete site',
        confirmLabel: 'Ship incomplete anyway',
        cancelLabel: 'Cancel',
        danger: true,
        bodyHtml: `<p>Auto ship requires a real domain, phone, Web3Forms key, and non-placeholder reviews:</p>
          <ul class="narrative-list">${issues.map((i) => `<li>${esc(i.label)}</li>`).join('')}</ul>
          <p class="muted">Fix these above, or confirm you intentionally want to ship incomplete (forms/NAP may be broken on the live site).</p>`,
      });
      if (!ok) return;
      allowIncompleteLaunch = true;
    } else if (issues.length) {
      const ok = await showModal({
        title: 'Placeholders still set',
        confirmLabel: 'Continue without shipping',
        cancelLabel: 'Cancel',
        danger: true,
        bodyHtml: `<p>These still look incomplete (ship is off, so Launch will only patch keys):</p>
          <ul class="narrative-list">${issues.map((i) => `<li>${esc(i.label)}</li>`).join('')}</ul>`,
      });
      if (!ok) return;
    }

    const btn = document.getElementById('ca-launch');
    const form = document.getElementById('ca-launch-form');
    if (btn) btn.disabled = true;
    form?.querySelectorAll('input,button,select,textarea').forEach((el) => {
      el.disabled = true;
    });
    showLaunchOverlayStarting(pendingBody);
    try {
      const body = { ...pendingBody, allowIncompleteLaunch };
      let jobId = null;
      try {
        const accepted = await api(`/api/candidates/${encodeURIComponent(id)}/launch`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        jobId = accepted.jobId;
      } catch (enqueueErr) {
        if (enqueueErr.code === 'HEAVY_CONCURRENCY') {
          hideLaunchOverlay();
          await explainConcurrencyLimit({
            key: 'heavy',
            running: enqueueErr.running,
            limit: enqueueErr.limit ?? state.concurrency?.heavy ?? 2,
          });
          return;
        }
        const joinId = enqueueErr?.status === 409 && enqueueErr?.job?.id ? enqueueErr.job.id : null;
        if (!joinId) throw enqueueErr;
        jobId = joinId;
      }
      const result = await waitForHeavyJobResult(jobId);
      hideLaunchOverlay();
      await refresh(result.candidate, 'indexing', 'website');
      announceStepComplete('Launch');
      const human = (result.human || []).map((h) => `<li>${esc(h)}</li>`).join('');
      const shipOk = result.ship?.ok ? 'Ship (GitHub/Worker) ok' : result.ship ? 'Ship partial/failed' : 'Ship skipped';
      const cfOk = result.cloudflare?.ok ? 'Cloudflare domain/email ran' : 'Cloudflare domain/email skipped or incomplete';
      await showModal({
        title: result.ok ? 'Launch updated' : 'Launch incomplete',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(shipOk)}. ${esc(cfOk)}. Forms key: ${result.formsDone ? 'set' : 'still placeholder'}.</p>
          <ul class="narrative-list">${human || '<li>No extra notes</li>'}</ul>
          ${
            result.assembledConfigPath
              ? `<p class="muted">Wrote <code>${esc(result.assembledConfigPath)}</code></p>`
              : ''
          }
          ${
            result.ship?.steps?.github?.repoUrl
              ? `<p class="muted">Repo: <a href="${esc(result.ship.steps.github.repoUrl)}" target="_blank" rel="noopener">${esc(result.ship.steps.github.fullName)}</a></p>`
              : ''
          }
          <p class="muted"><strong>After launch:</strong> verify Gmail once if Email Routing is new; smoke-test the live form; then use <strong>Website → Indexing</strong> for Search Console + sitemap.</p>`,
      });
    } catch (error) {
      if (await maybeExplainHeavyConcurrency(error)) return;
      const blockerList = (error.details?.blockers || [])
        .map((b) => `<li>${esc(b.label || b.id || b)}</li>`)
        .join('');
      await showModal({
        title: error.code === 'LAUNCH_BLOCKED' ? 'Launch blocked' : 'Launch failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>${
          blockerList ? `<ul class="narrative-list">${blockerList}</ul>` : ''
        }`,
      });
    } finally {
      hideLaunchOverlay();
      form?.querySelectorAll('input,button,select,textarea').forEach((el) => {
        el.disabled = false;
      });
      if (btn) btn.disabled = false;
    }
  });

  const acceptBtn = document.getElementById('content-accept-btn');
  if (acceptBtn) {
    acceptBtn.addEventListener('click', async () => {
      const ignoreSeo = Boolean(document.getElementById('content-accept-seo-override')?.checked);
      const ok = await showModal({
        title: 'Accept content?',
        confirmLabel: 'Write src/content/',
        bodyHtml: ignoreSeo
          ? '<p>Accepts the draft into <code>src/content/</code> <strong>with SEO warnings overridden</strong>.</p>'
          : '<p>Accepts the candidate draft into shared <code>src/content/</code> (backs up existing Markdown, prunes leftovers not in the bundle).</p>',
      });
      if (!ok) return;
      if (!(await confirmLaunchedSiteChange('Accept content'))) return;
      acceptBtn.disabled = true;
      showAcceptOverlayStarting();
      try {
        const runAccept = async (body) => {
          const accepted = await api(`/api/candidates/${encodeURIComponent(id)}/content/accept`, {
            method: 'POST',
            body: JSON.stringify(body),
          });
          if (accepted?.accepted && accepted.jobId) {
            return waitForLightJobResult(accepted.jobId);
          }
          return accepted;
        };
        let result;
        try {
          result = await runAccept(withLaunchedConfirmBody({ ignoreSeoWarnings: ignoreSeo }));
        } catch (error) {
          if (error.message?.includes('ignoreWarnings') || error.check?.warnings?.length) {
            hideAcceptOverlay();
            const force = await showModal({
              title: 'Content warnings',
              confirmLabel: 'Write anyway',
              bodyHtml: `<p>${esc(error.message)}</p>`,
            });
            if (!force) throw error;
            showAcceptOverlayStarting();
            result = await runAccept(
              withLaunchedConfirmBody({ ignoreWarnings: true, ignoreSeoWarnings: ignoreSeo }),
            );
          } else if (error.message?.includes('ignoreSeoWarnings') || error.seoLint) {
            hideAcceptOverlay();
            const force = await showModal({
              title: 'Critical SEO findings',
              confirmLabel: 'Accept with SEO warnings',
              bodyHtml: `<p>${esc(error.message)}</p><p class="muted">Or cancel and fix via the Editor step.</p>`,
            });
            if (!force) throw error;
            showAcceptOverlayStarting();
            result = await runAccept(withLaunchedConfirmBody({ ignoreSeoWarnings: true }));
          } else {
            throw error;
          }
        }
        hideAcceptOverlay();
        announceStepComplete('Accept content');
        await refresh(result.candidate, 'prepare', 'website');
        notifyCandidatesChanged({ type: 'accept', ids: [id] });
        const map = result.coverageMap;
        const logo = result.logo;
        const mapMissing = map && (map.ok === false || map.skipped);
        const logoOk = logo && logo.ok !== false && logo.path;
        const mapOk = map && map.ok && map.path;
        const mapMissList = Array.isArray(map?.missingBoundaries) ? map.missingBoundaries : [];
        const mapWarn = mapMissing
          ? `<p class="callout warn">Coverage map missing${
              map.warning ? `: ${esc(map.warning)}` : ''
            }. Accept already tried — re-run under <strong>Website</strong> → Logo &amp; Map → <strong>Regenerate coverage map</strong> (button says Generate if none exists yet), then Prepare preview.</p>`
          : mapOk && mapMissList.length
            ? `<p class="callout warn">Coverage map drawn for <strong>${esc(
                String(map.areas ?? ''),
              )}</strong> city outline(s). <strong>No outline</strong> (still Also serving): ${esc(
                mapMissList.join('; '),
              )}.</p>`
            : '';
        const failedSlots = Array.isArray(result.images?.failedSlots)
          ? result.images.failedSlots
          : [];
        const failedN = Number(result.images?.failed) || failedSlots.length;
        const imageFailGuide =
          failedN > 0
            ? `<div class="callout warn"><strong>${esc(String(failedN))} image slot(s) need attention</strong> — content Accept is still done.
          <ol style="margin:0.4rem 0 0;padding-left:1.25rem">
            <li>Open <strong>Website</strong> → <strong>Review images</strong></li>
            <li>${
              failedSlots.length
                ? `For ${failedSlots
                    .map((s) => `<code>${esc(s.key)}</code>`)
                    .join(', ')}: <strong>Re-pull</strong> or <strong>Upload</strong> an owner photo`
                : 'For each failed slot: <strong>Re-pull</strong> or <strong>Upload</strong> an owner photo'
            }</li>
            <li>Continue to <strong>Prepare preview</strong></li>
          </ol></div>`
            : '';
        const imageLines = (result.images?.human || [])
          .filter((h) => /^Images:/i.test(String(h || '')))
          .map((h) => `<p class="muted">${esc(h)}</p>`)
          .join('');
        const imageWarn = result.images?.warning
          ? `<p class="callout warn">${esc(result.images.warning)}</p>`
          : '';
        const failedSlotRows = failedSlots
          .map(
            (s) =>
              `<li><span class="accept-asset-warn" aria-hidden="true"></span> <code>${esc(
                s.key,
              )}</code> needs attention</li>`,
          )
          .join('');
        const logoRow = logoOk
          ? `<li><span class="stage-check" aria-hidden="true">✓</span> Logo generated</li>`
          : logo
            ? `<li><span class="accept-asset-skip" aria-hidden="true">○</span> Logo skipped${
                logo.warning ? ` <span class="muted">(${esc(logo.warning)})</span>` : ''
              }</li>`
            : '';
        const mapRow = mapOk
          ? `<li><span class="stage-check" aria-hidden="true">✓</span> Coverage map generated${
              mapMissList.length
                ? ` <span class="muted">(${esc(String(mapMissList.length))} without outline — Also serving)</span>`
                : ''
            }</li>`
          : mapMissing
            ? `<li><span class="accept-asset-skip" aria-hidden="true">○</span> Coverage map missing</li>`
            : '';
        const assetChecklistHtml =
          failedSlotRows || logoRow || mapRow
            ? `<ul class="accept-asset-check">${failedSlotRows}${logoRow}${mapRow}</ul>`
            : '';
        await showModal({
          title: 'Content accepted',
          confirmLabel: 'OK',
          bodyHtml: `<p>Wrote <strong>${esc(String(result.written?.length || 0))}</strong> file(s) to <code>src/content/</code>.</p>
          ${imageWarn}${imageFailGuide}${imageLines}${assetChecklistHtml}${mapWarn}
          <p><strong>Up next:</strong> <strong>Website</strong> → Logo &amp; Map → Review images → <strong>Prepare preview</strong> (full Stage + Assemble + open :4322).</p>`,
        });
      } catch (error) {
        hideAcceptOverlay();
        const gapsMissing = error.check?.missing || [];
        const gapsStubs = error.check?.stubs || [];
        const isLaunchGap =
          /incomplete for launch|stub\/thin|Missing required file/i.test(String(error.message || '')) ||
          gapsMissing.length > 0 ||
          gapsStubs.length > 0;
        const gapHtml = isLaunchGap
          ? incompleteDraftExplainHtml({
              have: Math.max(
                0,
                (error.check?.expected?.length || gapsMissing.length + gapsStubs.length) -
                  gapsMissing.length,
              ),
              expectedCount: error.check?.expected?.length || 0,
              missing: gapsMissing,
              stubs: gapsStubs,
              compact: false,
              showContinueControls: true,
            })
          : '';
        await showModal({
          title: 'Accept failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>${gapHtml}`,
          afterOpen: (body) => {
            body.querySelectorAll('.js-copy-continue-prompt').forEach((btn) => {
              btn.addEventListener('click', () => copyContinueWritePrompt(id));
            });
          },
        });
        if (isLaunchGap) {
          await refresh(state.detail, 'write');
        }
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
        <div class="stat prospects-outreach-copy">
          ${
            effectiveClaudeUiMode() === 'api'
              ? `<button type="button" class="btn primary" data-act="outreach" data-tip="Draft outreach copy via the Anthropic API (optional)" ${
                  state.claudeBusy && state.activeAct === 'outreach' ? 'disabled' : ''
                }>${
                  state.claudeBusy && state.activeAct === 'outreach'
                    ? 'Running…'
                    : state.detail._outreachDraft
                      ? 'Re-run Outreach'
                      : 'Run Outreach'
                }</button>`
              : `<button type="button" class="btn primary" id="prospects-copy-outreach-prompt" data-tip="Copy Claude.ai outreach prompt with this prospects JSON">
            Copy outreach prompt
          </button>
          ${openClaudeAiBtnHtml()}`
          }
        </div>
      </div>
    `);
    const rows = (p.prospects || []).map((x) => [
      esc(x.outreachPriority),
      metricHtml({
        value: x.outreachScore,
        max: 10,
        label: 'Outreach score',
        extraTip: 'Higher = better outreach fit for Rover.',
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
        ],
        rows,
      ),
    );
  }
  if (state.detail._outreachDraft) {
    parts.push('<h3>Outreach draft (Claude)</h3>');
    parts.push(`<div class="json-block">${esc(JSON.stringify(state.detail._outreachDraft, null, 2))}</div>`);
  } else if (p && effectiveClaudeUiMode() === 'api') {
    parts.push('<p class="muted">Optional: Run Outreach to draft copy from this prospects list. Does not block Website.</p>');
  }
  if (state.claudeBusy && state.activeAct === 'outreach') {
    parts.unshift(`<div class="job-progress" aria-live="polite">
      <div class="job-progress-track"><div class="job-progress-bar"></div></div>
      <p class="job-progress-label">Run Outreach</p>
      <p class="job-progress-detail">Calling Claude…</p>
    </div>`);
  }
  return parts.join('');
}

function renderLogs() {
  return `<div class="log" id="job-log">${esc('(Run a job to stream logs here)')}</div>`;
}

function wireSiteConfigTab(d) {
  if (!d) return;
  const paletteSelect = document.getElementById('sc-brand-palette');
  if (paletteSelect) {
    paletteSelect.addEventListener('change', () => {
      updatePaletteSwatches(paletteSelect.value);
      saveSiteConfigLookToLocal({
        paletteId: paletteSelect.value,
        fontTheme: document.getElementById('sc-font-theme')?.value,
      });
    });
  }
  document.querySelectorAll('[data-font-theme]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-font-theme');
      const hidden = document.getElementById('sc-font-theme');
      if (hidden) hidden.value = id || '';
      document.querySelectorAll('[data-font-theme]').forEach((el) => {
        const on = el.getAttribute('data-font-theme') === id;
        el.classList.toggle('on', on);
        el.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      saveSiteConfigLookToLocal({
        paletteId: document.getElementById('sc-brand-palette')?.value,
        fontTheme: id,
      });
    });
  });
  const applyLookBtn = document.getElementById('sc-apply-look');
  if (applyLookBtn) {
    applyLookBtn.addEventListener('click', async () => {
      const paletteId = document.getElementById('sc-brand-palette')?.value?.trim() || 'slate-gold';
      const fontTheme = document.getElementById('sc-font-theme')?.value?.trim() || 'archivo-source';
      applyLookBtn.disabled = true;
      saveSiteConfigLookToLocal({ paletteId, fontTheme });
      const hasConfig = Boolean(d.siteConfigDraft || d.siteConfig || state.detail?.siteConfigDraft || state.detail?.siteConfig);
      try {
        if (hasConfig) {
          const result = await api(`/api/candidates/${encodeURIComponent(d.id)}/site-config/brand`, {
            method: 'POST',
            body: JSON.stringify({ paletteId, fontTheme, allowNonPursue: false }),
          });
          await applyCandidatePayload(result.candidate, d.id);
        }
        if (!state.siteConfigSoftDone) state.siteConfigSoftDone = {};
        state.siteConfigSoftDone.look = true;
        state.tab = 'site-config';
        advancePanelStep('site-config', 'address');
        renderDetail();
        showToast(
          hasConfig
            ? `Look applied · ${paletteId} · ${fontTheme}`
            : `Look saved · ${paletteId} · ${fontTheme} — applied when you ${
                effectiveClaudeUiMode() === 'api' ? 'Fill site-config' : 'Load draft'
              }`,
          { tone: 'ok' },
        );
      } catch (error) {
        await showModal({
          title: 'Look failed',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
        applyLookBtn.disabled = false;
      }
    });
  }
  const afterAddressChoice = async (result) => {
    if (result?.candidate) await applyCandidatePayload(result.candidate);
    if (!state.siteConfigSoftDone) state.siteConfigSoftDone = {};
    state.siteConfigSoftDone.address = true;
    advancePanelStep('site-config', 'domain');
    renderDetail();
  };

  const syncDomainContinueEnabled = () => {
    const btn = document.getElementById('sc-domain-continue');
    if (!btn) return;
    const custom = normalizeDomainHostname(document.getElementById('sc-domain-custom')?.value);
    const checked = [...document.querySelectorAll('.sc-domain-pick-opt:checked')];
    btn.disabled = !(custom || checked.length === 1);
  };

  document.getElementById('sc-domain-suggest')?.addEventListener('click', async () => {
    if (state.claudeBusy) return;
    if (!(await confirmPaidAction('domain-pick'))) return;
    state.claudeBusy = true;
    state.activeAct = 'domain-pick';
    state.jobStatusLine = 'Suggesting domains…';
    syncClaudeModeToggle();
    renderDetail();
    try {
      const nap = siteConfigNapFromLocal(d.id);
      const result = await api(
        `/api/candidates/${encodeURIComponent(d.id)}/site-config/suggest-domains`,
        {
          method: 'POST',
          body: JSON.stringify({ businessName: nap.businessName || '' }),
        },
      );
      writeDomainPickToNap({
        domainPick: {
          suggestions: result.suggestions || [],
          selectedDomain: null,
          customDomain: '',
        },
      });
      state.tab = 'site-config';
      state.siteConfigOpenStep = 'domain';
      state.siteConfigSoftCurrent = 'domain';
      renderDetail();
      const n = (result.suggestions || []).length;
      showToast(`Loaded ${n} domain suggestion${n === 1 ? '' : 's'}.`);
      await showActualCostModal({
        title: 'Domain suggestions',
        costUsd: result.costUsd,
        costNote: result.costNote,
        provider: 'anthropic',
      });
    } catch (error) {
      state.claudeBusy = false;
      state.activeAct = null;
      state.jobStatusLine = '';
      syncClaudeModeToggle();
      renderDetail();
      await showModal({
        title: 'Suggest domains failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      state.claudeBusy = false;
      state.activeAct = null;
      state.jobStatusLine = '';
      syncClaudeModeToggle();
      renderDetail();
    }
  });

  document.getElementById('sc-domain-copy-prompt')?.addEventListener('click', async () => {
    try {
      const nap = siteConfigNapFromLocal(d.id);
      const qs = new URLSearchParams({
        businessName: nap.businessName || '',
      });
      const data = await api(
        `/api/candidates/${encodeURIComponent(d.id)}/site-config/domain-prompt?${qs}`,
      );
      await navigator.clipboard.writeText(data.prompt || '');
      showToast('Domain prompt copied — paste into Claude.ai, then Load the reply below.');
    } catch (error) {
      await showModal({
        title: 'Copy failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('sc-domain-paste-load')?.addEventListener('click', () => {
    const text = document.getElementById('sc-domain-paste')?.value || '';
    const suggestions = parseDomainPickPaste(text);
    if (!suggestions.length) {
      showToast('No domains found in paste — use the JSON block or a list of hostnames.', {
        tone: 'warn',
      });
      return;
    }
    writeDomainPickToNap({
      domainPick: {
        suggestions,
        selectedDomain: null,
        customDomain: '',
      },
    });
    state.tab = 'site-config';
    state.siteConfigOpenStep = 'domain';
    state.siteConfigSoftCurrent = 'domain';
    renderDetail();
    showToast(`Loaded ${suggestions.length} domain suggestion${suggestions.length === 1 ? '' : 's'}.`);
  });

  document.querySelectorAll('.sc-domain-pick-opt').forEach((input) => {
    input.addEventListener('change', () => {
      const host = normalizeDomainHostname(input.dataset.domain);
      if (input.checked) {
        document.querySelectorAll('.sc-domain-pick-opt').forEach((el) => {
          if (el !== input) el.checked = false;
        });
        const customEl = document.getElementById('sc-domain-custom');
        if (customEl) customEl.value = '';
        writeDomainPickToNap({
          domainPick: { selectedDomain: host, customDomain: '' },
        });
      } else {
        writeDomainPickToNap({
          domainPick: { selectedDomain: null },
        });
      }
      syncDomainContinueEnabled();
    });
  });

  document.getElementById('sc-domain-custom')?.addEventListener('input', () => {
    const customEl = document.getElementById('sc-domain-custom');
    const customRaw = String(customEl?.value || '').trim();
    if (customRaw) {
      document.querySelectorAll('.sc-domain-pick-opt').forEach((el) => {
        el.checked = false;
      });
      writeDomainPickToNap({
        domainPick: {
          selectedDomain: null,
          customDomain: customRaw,
        },
      });
    } else {
      writeDomainPickToNap({
        domainPick: { customDomain: '' },
      });
    }
    syncDomainContinueEnabled();
  });

  document.getElementById('sc-domain-continue')?.addEventListener('click', () => {
    const custom = normalizeDomainHostname(document.getElementById('sc-domain-custom')?.value);
    const checked = [...document.querySelectorAll('.sc-domain-pick-opt:checked')];
    const fromToggle = checked.length === 1 ? normalizeDomainHostname(checked[0].dataset.domain) : '';
    const chosen = custom || fromToggle;
    if (!chosen) {
      showToast('Select a suggestion or enter a custom domain.', { tone: 'warn' });
      return;
    }
    const d = state.detail;
    const napPrev = siteConfigNapFromLocal(d?.id);
    const ba = d?.businessAddress;
    const primaryCity = String(
      d?.approved?.primaryCity ||
        d?.research?.primaryCity ||
        d?.research?.summary?.primaryCity ||
        d?.meta?.primaryCity ||
        napPrev?.addressCity ||
        ba?.selection?.city ||
        ba?.city ||
        d?.siteConfig?.primaryCity ||
        d?.primaryCity ||
        d?.city ||
        '',
    ).trim();
    const niche = String(
      d?.approved?.niche ||
        d?.research?.niche ||
        d?.research?.summary?.niche ||
        d?.meta?.niche ||
        d?.siteConfig?.niche ||
        d?.niche ||
        '',
    ).trim();
    const businessName = businessNameFromDomainClient(chosen, { primaryCity, niche });
    const email = `leads@${chosen}`;
    writeDomainPickToNap({
      domain: chosen,
      businessName,
      email,
      domainPick: {
        selectedDomain: custom ? null : chosen,
        customDomain: custom || '',
      },
    });
    if (!state.siteConfigSoftDone) state.siteConfigSoftDone = {};
    state.siteConfigSoftDone.domain = true;
    advancePanelStep('site-config', 'details');
    renderDetail();
    showToast(
      businessName
        ? `Domain set · ${chosen} · ${businessName}`
        : `Domain set · ${chosen}`,
    );
  });

  document.getElementById('ba-show-home')?.addEventListener('click', () => {
    document.getElementById('ba-home-panel')?.classList.remove('hidden');
    document.getElementById('ba-manual-panel')?.classList.add('hidden');
  });
  document.getElementById('ba-show-manual')?.addEventListener('click', () => {
    document.getElementById('ba-manual-panel')?.classList.remove('hidden');
    document.getElementById('ba-home-panel')?.classList.add('hidden');
  });

  const refreshBaRecover = async () => {
    try {
      const data = await api(`/api/candidates/${encodeURIComponent(d.id)}/address/recover`);
      if (!state.baRecover) state.baRecover = {};
      state.baRecover[d.id] = data;
      if (state._baRecoverAttempted) state._baRecoverAttempted[d.id] = true;
    } catch {
      /* ignore */
    }
  };

  const runBaAddressSearch = async ({
    refresh = false,
    deepen = null,
    raisePullMax = false,
    refreshLoopnet = null,
  } = {}) => {
    if (state.baSearchBusy) return;
    const sources = baReadSourceTogglesFromDom();
    const findCaps = baReadFindCapsFromDom();
    if (!sources.loopnet && !sources.crexi) {
      await showModal({
        title: 'No listing source selected',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml:
          '<p>Check <strong>LoopNet</strong> and/or <strong>Crexi</strong>, or set the matching actor id in <code>.env</code>.</p>',
      });
      return;
    }
    const doRefresh = refreshLoopnet != null ? Boolean(refreshLoopnet) : Boolean(refresh);
    state.baSearchBusy = true;
    state.baSearchMode = doRefresh ? 'refresh' : 'find';
    if (!state.siteConfigOpenStep) state.siteConfigOpenStep = 'address';
    renderDetail();
    const stopBaBusy = () => {
      state.baSearchBusy = false;
      state.baSearchMode = 'find';
      renderDetail();
    };
    try {
      const body = {
        sources,
        cleanPerRun: findCaps.cleanPerRun,
        listingsPerRun: findCaps.listingsPerRun,
        refresh: {
          loopnet: doRefresh && sources.loopnet,
          crexi: doRefresh && sources.crexi,
        },
      };
      if (deepen != null) {
        body.deepen = {
          loopnet: Boolean(deepen) && sources.loopnet,
          crexi: Boolean(deepen) && sources.crexi,
        };
      }
      if (raisePullMax) {
        body.raisePullMax = {
          loopnet: sources.loopnet,
          crexi: sources.crexi,
        };
      }
      const result = await api(`/api/candidates/${encodeURIComponent(d.id)}/address/search`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (result?.candidate) await applyCandidatePayload(result.candidate);
      if (result?.sources) state.baSources = result.sources;
      if (result?.apifyPlanUsage) state.apifyPlanUsage = result.apifyPlanUsage;
      else if (result?.package?.apifyPlanUsage) {
        state.apifyPlanUsage = result.package.apifyPlanUsage;
      }
      if (result?.recover) {
        if (!state.baRecover) state.baRecover = {};
        state.baRecover[d.id] = result.recover;
        if (result.recover.readiness) state.baSources = result.recover.readiness;
      } else {
        await refreshBaRecover();
      }
      const pkg = result?.package || state.detail?.businessAddress;
      const kind = pkg?.lastSearchErrorKind;
      stopBaBusy();
      if (kind === 'apify_billing') {
        await showModal({
          title: 'Apify usage limit',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(pkg?.lastSearchError || 'Apify usage limit reached.')}</p>
            <p>Add credit or upgrade at <a href="https://console.apify.com/billing/subscription" target="_blank" rel="noopener">Apify billing</a>, then retry Find.</p>
            <p class="muted">Until then use <strong>Manual commercial</strong>, home paste, or <strong>Skip address</strong>.</p>`,
        });
        return;
      }
      announceStepComplete(doRefresh ? 'Refresh addresses' : 'Find addresses');
      const added = Number(pkg?.lastSearchStats?.added ?? 0);
      const clean = Number(pkg?.lastSearchStats?.shortlist ?? 0);
      const title =
        kind === 'cache_exhausted'
          ? '0 left — Fetch deeper?'
          : clean === 0
            ? 'Find complete — no new cleans'
            : added > 0
              ? 'Find complete'
              : 'Find complete';
      await showModal({
        title,
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: baSearchReportBodyHtml(pkg, {
          title: 'This run',
          failed: Boolean(
            kind &&
              kind !== 'empty_screened' &&
              kind !== 'cache_exhausted' &&
              kind !== 'places_budget',
          ),
        }),
      });
    } catch (error) {
      try {
        const refreshed = await fetchCandidateDetail(d.id, ['address']);
        if (refreshed) await applyCandidatePayload(refreshed, d.id);
      } catch {
        /* keep prior detail */
      }
      const kind =
        state.detail?.businessAddress?.lastSearchErrorKind ||
        (/402|remaining usage|paid plan|billing\/subscription/i.test(error.message || '')
          ? 'apify_billing'
          : null);
      stopBaBusy();
      if (kind === 'apify_billing') {
        await showModal({
          title: 'Apify usage limit',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>
          <p>Add credit or upgrade at <a href="https://console.apify.com/billing/subscription" target="_blank" rel="noopener">Apify billing</a>, then retry Find.</p>
          <p class="muted">Until then use <strong>Manual commercial</strong>, home paste, or <strong>Skip address</strong>.</p>`,
        });
      } else {
        await showModal({
          title: 'Address search failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p><p class="muted">You can still use Manual commercial, home paste, or Skip. Check APIFY_* and GOOGLE_MAPS_API_KEY in .env for Find.</p>`,
        });
      }
    } finally {
      if (state.baSearchBusy) stopBaBusy();
    }
  };

  document.getElementById('ba-find-addresses')?.addEventListener('click', async () => {
    if (state.baSearchBusy) return;
    const pkg = state.detail?.businessAddress;
    const cache = pkg?.listingCache;
    const cacheLen = Array.isArray(cache?.listings) ? cache.listings.length : 0;
    const age = cache?.fetchedAt ? Date.now() - Date.parse(cache.fetchedAt) : Infinity;
    const fresh = Number.isFinite(age) && age >= 0 && age < BA_CACHE_TTL_MS;
    const toggles = baReadSourceTogglesFromDom();
    const recover = state.baRecover?.[d.id];
    const stats = pkg?.lastSearchStats || {};
    const exhausted = baCheckedSourcesExhausted(recover, stats, toggles);

    if (exhausted) {
      const agg = baAggregateCheckedBudgets(recover, stats, toggles);
      const {
        lastBudget,
        nextBudget,
        hardBudget,
        proposedBudget,
        canRaise,
        needsRaise,
        atAbsolute,
        sourceLabel,
      } = agg;

      if (needsRaise && canRaise) {
        const go = await showModal({
          title: 'Cache exhausted — raise ceiling?',
          confirmLabel: 'Double ceiling & fetch deeper',
          cancelLabel: 'Cancel',
          bodyHtml: baExhaustedDeepenWarnHtml({
            variant: 'raise',
            nextBudget,
            hardBudget,
            proposedBudget,
            sourceLabel,
          }),
        });
        if (!go) return;
        await runBaAddressSearch({
          refresh: true,
          deepen: true,
          raisePullMax: true,
        });
        return;
      }

      const go = await showModal({
        title: atAbsolute
          ? 'Cache exhausted — at max'
          : 'Cache exhausted — Fetch deeper?',
        confirmLabel: atAbsolute ? 'Refresh anyway' : 'Fetch deeper (billable)',
        cancelLabel: 'Cancel',
        bodyHtml: baExhaustedDeepenWarnHtml({
          variant: atAbsolute ? 'absolute' : 'deepen',
          lastBudget,
          nextBudget,
          hardBudget,
          sourceLabel,
        }),
      });
      if (!go) return;
      await runBaAddressSearch({
        refresh: true,
        deepen: !atAbsolute,
      });
      return;
    }

    if (cacheLen > 0 && !fresh) {
      const go = await showModal({
        title: 'Listing cache is stale',
        confirmLabel: 'Refresh listings',
        cancelLabel: 'Screen remaining',
        bodyHtml: `<p>Cached listings are older than 7 days.</p>
          <p class="muted"><strong>Refresh listings</strong> re-scrapes checked sources (Apify billable). <strong>Screen remaining</strong> keeps the old cache and only runs Places on unscreened streets (Apify $0). Street ranges expand to start/end numbers.</p>`,
      });
      if (go === true) {
        await runBaAddressSearch({ refresh: true });
      } else if (go === false) {
        await runBaAddressSearch({ refresh: false });
      }
      return;
    }

    await runBaAddressSearch({ refresh: false });
  });

  document.getElementById('ba-source-loopnet')?.addEventListener('change', () => {
    baReadSourceTogglesFromDom();
    renderDetail();
  });
  document.getElementById('ba-source-crexi')?.addEventListener('change', () => {
    baReadSourceTogglesFromDom();
    renderDetail();
  });
  document.getElementById('ba-clean-per-run')?.addEventListener('change', () => {
    baReadFindCapsFromDom();
  });
  document.getElementById('ba-listings-per-run')?.addEventListener('change', () => {
    baReadFindCapsFromDom();
  });

  document.getElementById('ba-refresh-loopnet')?.addEventListener('click', async () => {
    if (state.baSearchBusy) return;
    const pkg = state.detail?.businessAddress;
    const toggles = baReadSourceTogglesFromDom();
    const recover = state.baRecover?.[d.id];
    const stats = pkg?.lastSearchStats || {};
    const exhausted = baCheckedSourcesExhausted(recover, stats, toggles);
    const agg = baAggregateCheckedBudgets(recover, stats, toggles);
    const {
      lastBudget,
      nextBudget,
      hardBudget,
      proposedBudget,
      canRaise,
      needsRaise,
      atAbsolute,
      sourceLabel,
    } = agg;

    if (exhausted && needsRaise && canRaise) {
      const go = await showModal({
        title: 'Cache exhausted — raise ceiling?',
        confirmLabel: 'Double ceiling & fetch deeper',
        cancelLabel: 'Cancel',
        bodyHtml: baExhaustedDeepenWarnHtml({
          variant: 'raise',
          nextBudget,
          hardBudget,
          proposedBudget,
          sourceLabel,
        }),
      });
      if (!go) return;
      await runBaAddressSearch({
        refresh: true,
        deepen: true,
        raisePullMax: true,
      });
      return;
    }

    if (exhausted && !atAbsolute && !needsRaise) {
      const go = await showModal({
        title: 'Cache exhausted — Fetch deeper?',
        confirmLabel: 'Fetch deeper (billable)',
        cancelLabel: 'Cancel',
        bodyHtml: baExhaustedDeepenWarnHtml({
          variant: 'deepen',
          lastBudget,
          nextBudget,
          sourceLabel,
        }),
      });
      if (!go) return;
      await runBaAddressSearch({ refresh: true, deepen: true });
      return;
    }

    const go = await showModal({
      title: exhausted && atAbsolute ? 'Cache exhausted — at max' : 'Refresh listings?',
      confirmLabel: exhausted && atAbsolute ? 'Refresh anyway' : 'Refresh (billable)',
      cancelLabel: 'Cancel',
      bodyHtml:
        exhausted && atAbsolute
          ? baExhaustedDeepenWarnHtml({
              variant: 'absolute',
              hardBudget,
              sourceLabel,
            })
          : `<p>This re-runs Apify for <strong>${esc(
              sourceLabel,
            )}</strong> (checked sources) for this city (billable), merges new listings into the cache, and screens streets not already decided. Numeric ranges expand to start/end endpoints.</p>
        <p class="muted">Prefer <strong>Find addresses</strong> when a checked source is not exhausted — that continues without raising pull depth. When exhausted, use <strong>Fetch deeper</strong>.</p>`,
    });
    if (!go) return;
    await runBaAddressSearch({
      refresh: true,
      deepen: exhausted && !atAbsolute && !needsRaise,
    });
  });
  document.getElementById('ba-save-manual')?.addEventListener('click', async () => {
    const line = document.getElementById('ba-manual-line')?.value?.trim() || '';
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(d.id)}/address/manual`, {
        method: 'POST',
        body: JSON.stringify({ line }),
      });
      await afterAddressChoice(result);
    } catch (error) {
      await showModal({
        title: 'Save commercial address failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });
  document.getElementById('ba-save-home')?.addEventListener('click', async () => {
    const line = document.getElementById('ba-home-line')?.value?.trim() || '';
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(d.id)}/address/home`, {
        method: 'POST',
        body: JSON.stringify({ line }),
      });
      await afterAddressChoice(result);
    } catch (error) {
      await showModal({
        title: 'Save address failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });
  document.getElementById('ba-skip-address')?.addEventListener('click', async () => {
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(d.id)}/address/skip`, {
        method: 'POST',
        body: '{}',
      });
      await afterAddressChoice(result);
    } catch (error) {
      await showModal({
        title: 'Skip failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });
  document.querySelectorAll('.ba-use-addr').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.dataset.baIndex);
      const row = state.detail?.businessAddress?.shortlist?.[idx];
      if (!row) return;
      const targetCity = String(
        state.detail?.businessAddress?.city ||
          state.detail?.siteConfig?.primaryCity ||
          state.detail?.approved?.primaryCity ||
          state.detail?.approved?.city ||
          '',
      ).trim();
      if (row.tier === 'secondary' || btn.dataset.baTier === 'secondary') {
        const go = await showModal({
          title: 'Use Secondary address?',
          confirmLabel: 'Use Secondary',
          cancelLabel: 'Cancel',
          bodyHtml: `<p><strong>${esc(row.street)}</strong>, ${esc(row.city)}, ${esc(row.state)} ${esc(
            row.zip,
          )}</p>
            <p class="muted">Places-clean, but Google Maps locality is <strong>${esc(
              row.mapsLocality || 'outside the target city',
            )}</strong>${
              targetCity ? ` (not ${esc(targetCity)})` : ''
            }. Prefer an in-city Recommended address when available.</p>`,
        });
        if (!go) return;
      }
      try {
        const result = await api(`/api/candidates/${encodeURIComponent(d.id)}/address/select`, {
          method: 'POST',
          body: JSON.stringify({
            selection: {
              street: row.street,
              suite: row.suite,
              city: row.city,
              state: row.state,
              zip: row.zip,
              source: row.tier === 'secondary' ? 'commercial_secondary' : 'commercial',
              lat: row.lat,
              lng: row.lng,
              listingSource: row.source || undefined,
            },
          }),
        });
        await afterAddressChoice(result);
      } catch (error) {
        await showModal({
          title: /already used/i.test(error.message || '') ? 'Address already claimed' : 'Select failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
    });
  });

  const selectRecoverRow = async (kind, dedupeKey) => {
    const pack = state.baRecover?.[d.id];
    const list = kind === 'override' ? pack?.overrides : pack?.cleans;
    const row = Array.isArray(list)
      ? list.find((r) => String(r.dedupeKey || '') === String(dedupeKey || ''))
      : null;
    if (!row) return;
    if (kind === 'override') {
      const go = await showModal({
        title: 'Use anyway?',
        confirmLabel: 'Use anyway',
        cancelLabel: 'Cancel',
        bodyHtml: `<p><strong>${esc(row.street)}</strong>, ${esc(row.city)}, ${esc(row.state)} ${esc(
          row.zip,
        )}</p>
          <p class="muted">Places previously found a Maps business at this street number${
            row.fail ? ` (${esc(String(row.fail))})` : ''
          }. Claiming it is an operator override — GBP verification may be harder.</p>`,
      });
      if (!go) return;
    } else if (row.tier === 'secondary') {
      const targetCity = String(
        state.detail?.businessAddress?.city ||
          state.detail?.siteConfig?.primaryCity ||
          state.detail?.approved?.primaryCity ||
          '',
      ).trim();
      const go = await showModal({
        title: 'Use Secondary address?',
        confirmLabel: 'Use Secondary',
        cancelLabel: 'Cancel',
        bodyHtml: `<p><strong>${esc(row.street)}</strong>, ${esc(row.city)}, ${esc(row.state)} ${esc(
          row.zip,
        )}</p>
          <p class="muted">Maps locality is <strong>${esc(
            row.mapsLocality || 'outside the target city',
          )}</strong>${targetCity ? ` (not ${esc(targetCity)})` : ''}.</p>`,
      });
      if (!go) return;
    }
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(d.id)}/address/select`, {
        method: 'POST',
        body: JSON.stringify({
          selection: {
            street: row.street,
            suite: row.suite || '',
            city: row.city,
            state: row.state,
            zip: row.zip,
            source:
              kind === 'override'
                ? 'override'
                : row.tier === 'secondary'
                  ? 'recovered_secondary'
                  : 'recovered',
          },
        }),
      });
      await afterAddressChoice(result);
    } catch (error) {
      await showModal({
        title: /already used/i.test(error.message || '') ? 'Address already claimed' : 'Select failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  };

  document.querySelectorAll('.ba-use-recover').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await selectRecoverRow('clean', btn.dataset.baDedupeKey);
    });
  });
  document.querySelectorAll('.ba-use-override').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await selectRecoverRow('override', btn.dataset.baDedupeKey);
    });
  });

  const copyBtn = document.getElementById('sc-copy-prompt');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        const nap = saveSiteConfigNapFromForm();
        const qs = new URLSearchParams({
          domain: nap.domain || '',
          businessName: nap.businessName || '',
          phone: nap.phone || '',
          email: nap.email || '',
          radiusMiles: nap.radiusMiles || '15',
          siteArchetype: nap.siteArchetype || 'multi_service',
          paletteId: nap.paletteId || 'slate-gold',
          fontTheme: nap.fontTheme || 'archivo-source',
          addressStreet: nap.addressStreet || '',
          addressCity: nap.addressCity || '',
          addressState: nap.addressState || '',
          addressZip: nap.addressZip || '',
        });
        const data = await api(
          `/api/candidates/${encodeURIComponent(d.id)}/site-config/prompt?${qs}`,
        );
        await navigator.clipboard.writeText(data.prompt || '');
        showToast('Site-config prompt copied — paste into Claude.ai, then continue with Open Claude.ai or Paste below.');
        // Stay on Business details — Open Claude.ai advances to Paste.
      } catch (error) {
        await showModal({
          title: 'Copy failed',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
    });
  }

  document.getElementById('sc-open-claude')?.addEventListener('click', () => {
    // Let the new-tab navigation start, then collapse Details / open Paste.
    setTimeout(() => {
      advancePanelStep('site-config', 'paste');
      renderDetail();
    }, 0);
  });

  document.getElementById('sc-site-config-generate')?.addEventListener('click', async () => {
    if (state.claudeBusy) return;
    if (!(await confirmPaidAction('site-config'))) return;
    state.claudeBusy = true;
    state.activeAct = 'site-config';
    state.jobStatusLine = 'Filling site-config…';
    syncClaudeModeToggle();
    renderDetail();
    try {
      const nap = saveSiteConfigNapFromForm();
      const result = await api(`/api/candidates/${encodeURIComponent(d.id)}/site-config/generate`, {
        method: 'POST',
        body: JSON.stringify({
          domain: nap.domain || '',
          businessName: nap.businessName || '',
          phone: nap.phone || '',
          email: nap.email || '',
          radiusMiles: nap.radiusMiles || '15',
          siteArchetype: nap.siteArchetype || 'multi_service',
          paletteId: nap.paletteId || 'slate-gold',
          fontTheme: nap.fontTheme || 'archivo-source',
          addressStreet: nap.addressStreet || '',
          addressCity: nap.addressCity || '',
          addressState: nap.addressState || '',
          addressZip: nap.addressZip || '',
          allowNonPursue: false,
        }),
      });
      await applyCandidatePayload(result.candidate, d.id);
      d.siteConfigDraft = result.draft || state.detail?.siteConfigDraft;
      if (nap.paletteId || nap.fontTheme) {
        try {
          const look = await api(`/api/candidates/${encodeURIComponent(d.id)}/site-config/brand`, {
            method: 'POST',
            body: JSON.stringify({
              paletteId: nap.paletteId || 'slate-gold',
              fontTheme: nap.fontTheme || 'archivo-source',
              allowNonPursue: false,
            }),
          });
          state.detail = look.candidate || state.detail;
          d.siteConfigDraft = look.draft || state.detail?.siteConfigDraft;
        } catch {
          /* draft loaded; look apply optional */
        }
      }
      state.tab = 'site-config';
      const notes = [];
      if (result.placeholders?.length) {
        notes.push(`Placeholders: ${result.placeholders.join(', ')}`);
      }
      showToast(
        notes.length
          ? `Draft loaded — Accept in Review services. ${notes.join(' · ')}`
          : 'Draft loaded — continue to Review services to Accept.',
        { tone: notes.length ? 'warn' : 'ok' },
      );
      advancePanelStep('site-config', 'services');
      renderDetail();
      await showActualCostModal({
        title: 'Fill site-config',
        costUsd: result.costUsd,
        costNote: result.costNote,
        provider: 'anthropic',
      });
    } catch (error) {
      state.claudeBusy = false;
      state.activeAct = null;
      state.jobStatusLine = '';
      syncClaudeModeToggle();
      renderDetail();
      await showModal({
        title: 'Fill site-config failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      state.claudeBusy = false;
      state.activeAct = null;
      state.jobStatusLine = '';
      syncClaudeModeToggle();
      renderDetail();
    }
  });

  const saveDraftBtn = document.getElementById('site-config-save-draft-btn');
  if (saveDraftBtn) {
    saveDraftBtn.addEventListener('click', async () => {
      saveDraftBtn.disabled = true;
      try {
        const nap = saveSiteConfigNapFromForm();
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
          turnstileSiteKey: document.getElementById('sc-edit-turnstile')?.value?.trim() || '',
          targetSuburbs: document.getElementById('sc-edit-suburbs')?.value || '',
          services: document.getElementById('sc-edit-services')?.value || '',
          commercialServices: document.getElementById('sc-edit-commercial')?.value || '',
          homepageServicesLimit: document.getElementById('sc-edit-svc-limit')?.value || '8',
          brand: siteConfigBrandPatchFromForm(d.siteConfigDraft?.brand || state.detail?.siteConfigDraft?.brand),
          address: siteConfigAddressFromForm(
            document.getElementById('sc-edit-primaryCity')?.value?.trim() || '',
            document.getElementById('sc-edit-state')?.value?.trim() || '',
          ),
          siteArchetype: nap.siteArchetype,
        };
        const result = await api(`/api/candidates/${encodeURIComponent(d.id)}/site-config/draft`, {
          method: 'POST',
          body: JSON.stringify({ patch, ...nap, allowNonPursue: false }),
        });
        await applyCandidatePayload(result.candidate, d.id);
        state.tab = 'site-config';
        renderDetail();
        const left = result.placeholders || [];
        await showModal({
          title: 'Draft updated',
          confirmLabel: 'OK',
          bodyHtml: left.length
            ? `<p>Still placeholders: <code>${esc(left.join(', '))}</code></p>`
            : '',
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

  async function acceptSiteConfigFromUi(triggerBtn, { servicesMode = 'both' } = {}) {
    if (triggerBtn) triggerBtn.disabled = true;
    try {
      const mode =
        servicesMode === 'residential' || servicesMode === 'commercial' ? servicesMode : 'both';
      const clearCommercial = mode !== 'both';
      const nap = saveSiteConfigNapFromForm();
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
      const choiceLists = collectServicesChoiceFromUi();
      const hasChoiceUi = Boolean(choiceLists);

      if (hasChoiceUi && mode === 'commercial' && !choiceLists.commercialServices.length) {
        await showModal({
          title: 'No commercial services selected',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml:
            '<p>Check at least one commercial service (or add a custom) before <strong>Commercial Only</strong>.</p>',
        });
        if (triggerBtn) triggerBtn.disabled = false;
        return false;
      }
      if (hasChoiceUi && mode === 'residential' && !choiceLists.services.length) {
        await showModal({
          title: 'No residential services selected',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml:
            '<p>Check at least one residential service (or add a custom) before <strong>Residential Only</strong>.</p>',
        });
        if (triggerBtn) triggerBtn.disabled = false;
        return false;
      }
      if (hasChoiceUi && mode === 'both' && !choiceLists.services.length) {
        await showModal({
          title: 'No residential services selected',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml:
            '<p><strong>Residential + Commercial</strong> needs at least one checked residential service (primary list).</p>',
        });
        if (triggerBtn) triggerBtn.disabled = false;
        return false;
      }

      const needsDraftSeed =
        !hasEditForm &&
        !d.siteConfigDraft &&
        !state.detail?.siteConfigDraft &&
        Boolean(d.siteConfig || state.detail?.siteConfig);

      if (hasEditForm || needsDraftSeed || clearCommercial || hasChoiceUi) {
        const patch = hasEditForm
          ? {
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
              turnstileSiteKey: document.getElementById('sc-edit-turnstile')?.value?.trim() || '',
              targetSuburbs: document.getElementById('sc-edit-suburbs')?.value || '',
              services: document.getElementById('sc-edit-services')?.value || '',
              commercialServices: clearCommercial
                ? ''
                : document.getElementById('sc-edit-commercial')?.value || '',
              homepageServicesLimit: document.getElementById('sc-edit-svc-limit')?.value || '8',
              brand: siteConfigBrandPatchFromForm(
                d.siteConfigDraft?.brand || state.detail?.siteConfigDraft?.brand,
              ),
              address: siteConfigAddressFromForm(
                document.getElementById('sc-edit-primaryCity')?.value?.trim() || '',
                document.getElementById('sc-edit-state')?.value?.trim() || '',
              ),
              siteArchetype: nap.siteArchetype,
            }
          : clearCommercial
            ? { commercialServices: '' }
            : {};

        if (hasChoiceUi) {
          if (mode === 'commercial') {
            patch.services = choiceLists.commercialServices;
            patch.commercialServices = '';
          } else if (mode === 'residential') {
            patch.services = choiceLists.services;
            patch.commercialServices = '';
          } else {
            patch.services = choiceLists.services;
            patch.commercialServices = choiceLists.commercialServices;
          }
        }

        if (hasEditForm) {
          if (nap.domain && isPh(patch.domain, 'example.com')) patch.domain = nap.domain;
          if (nap.phone && isPh(patch.phone, '+1XXXXXXXXXX')) patch.phone = nap.phone;
          if (nap.email && isPh(patch.email, 'leads@example.com')) patch.email = nap.email;
          if (nap.businessName && isPh(patch.businessName, 'TBD Business')) {
            patch.businessName = nap.businessName;
          }
        }

        const synced = await api(`/api/candidates/${encodeURIComponent(d.id)}/site-config/draft`, {
          method: 'POST',
          body: JSON.stringify({ patch, ...nap, allowNonPursue: false }),
        });
        state.detail = synced.candidate || state.detail;
        d.siteConfigDraft = synced.draft || d.siteConfigDraft;
        remaining = synced.placeholders || synced.draft?._ops?.placeholders || [];
      }

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

      const modeBlurb =
        mode === 'residential'
          ? '<p>Writes site-config with <strong>residential services only</strong> (commercialServices cleared). No Claude re-prompt.</p>'
          : mode === 'commercial'
            ? '<p>Writes site-config with <strong>commercial services as primary</strong> (commercialServices cleared). No Claude re-prompt.</p>'
            : '<p>Writes draft to <code>src/config/site-config.json</code> (backs up previous). Next step is content markdown.</p>';

      const ok = await showModal({
        title: 'Write site-config.json?',
        confirmLabel: remaining.length ? 'Write with placeholders' : 'Write file',
        bodyHtml: remaining.length
          ? `<p>Writes to <code>src/config/site-config.json</code> (backs up previous).</p>
               <p>Still placeholders: <code>${esc(remaining.join(', '))}</code> — OK for an early build; fill later in Edit draft.</p>`
          : modeBlurb,
      });
      if (!ok) {
        if (triggerBtn) triggerBtn.disabled = false;
        renderDetail();
        return false;
      }
      if (!(await confirmLaunchedSiteChange('Accept site-config'))) {
        if (triggerBtn) triggerBtn.disabled = false;
        renderDetail();
        return false;
      }

      const postAccept = (extra = {}) =>
        api(`/api/candidates/${encodeURIComponent(d.id)}/site-config/accept`, {
          method: 'POST',
          body: JSON.stringify(
            withLaunchedConfirmBody({
              allowNonPursue: false,
              allowPlaceholders: true,
              ...extra,
            }),
          ),
        });
      let result;
      try {
        result = await postAccept();
      } catch (error) {
        if (/placeholder/i.test(String(error.message || ''))) {
          result = await postAccept({ allowPlaceholders: true });
        } else {
          throw error;
        }
      }
      await applyCandidatePayload(result.candidate, d.id);
      advancePanelStep('site-config', 'service-area');
      state.tab = 'site-config';
      renderDetail();
      const wroteBit =
        mode === 'residential'
          ? ' with residential services only'
          : mode === 'commercial'
            ? ' with commercial services as primary'
            : '';
      await showModal({
        title: 'Site config written',
        confirmLabel: 'OK',
        bodyHtml: `<p>Wrote <code>${esc(result.path || 'src/config/site-config.json')}</code>${wroteBit}. Next: <strong>6 · Service area</strong> (map + radius), then <strong>7 · Provision phone</strong> / Content.</p>${
          result.domainWarn?.mismatch
            ? `<div class="callout warn" style="margin-top:0.75rem"><strong>Domain vs brand:</strong> ${esc(
                result.domainWarn.reason ||
                  'Hostname does not match niche/brand/city — set the final client domain before go-live.',
              )}</div>`
            : ''
        }`,
      });
      return true;
    } catch (error) {
      await showModal({
        title: 'Accept failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
      if (triggerBtn) triggerBtn.disabled = false;
      renderDetail();
      return false;
    }
  }

  const pasteLoadBtn = document.getElementById('site-config-paste-load-btn');
  if (pasteLoadBtn) {
    pasteLoadBtn.addEventListener('click', async () => {
      const text = document.getElementById('site-config-paste')?.value || '';
      if (!text.trim()) {
        await showModal({
          title: 'Nothing to paste',
          confirmLabel: 'OK',
          bodyHtml: '<p>Paste site-config JSON first.</p>',
        });
        return;
      }
      pasteLoadBtn.disabled = true;
      try {
        const nap = saveSiteConfigNapFromForm();
        const result = await api(`/api/candidates/${encodeURIComponent(d.id)}/site-config/paste`, {
          method: 'POST',
          body: JSON.stringify({ json: text, ...nap, allowNonPursue: false }),
        });
        await applyCandidatePayload(result.candidate, d.id);
        d.siteConfigDraft = result.draft || state.detail?.siteConfigDraft;
        if (nap.paletteId || nap.fontTheme) {
          try {
            const look = await api(`/api/candidates/${encodeURIComponent(d.id)}/site-config/brand`, {
              method: 'POST',
              body: JSON.stringify({
                paletteId: nap.paletteId || 'slate-gold',
                fontTheme: nap.fontTheme || 'archivo-source',
                allowNonPursue: false,
              }),
            });
            state.detail = look.candidate || state.detail;
            d.siteConfigDraft = look.draft || state.detail?.siteConfigDraft;
          } catch {
            /* draft loaded; look apply optional */
          }
        }
        state.tab = 'site-config';
        const notes = [];
        if (result.placeholders?.length) {
          notes.push(`Placeholders: ${result.placeholders.join(', ')}`);
        }
        showToast(
          notes.length
            ? `Draft loaded — edit fields if needed, then Accept in Review services. ${notes.join(' · ')}`
            : 'Draft loaded — continue to Review services to Accept.',
          { tone: notes.length ? 'warn' : 'ok' },
        );
        advancePanelStep('site-config', 'services');
        renderDetail();
      } catch (error) {
        await showModal({
          title: 'Paste failed',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
        const btn = document.getElementById('site-config-paste-load-btn');
        if (btn) btn.disabled = false;
        renderDetail();
      }
    });
  }

  const bindAccept = (id, opts = {}) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', () => {
        acceptSiteConfigFromUi(btn, opts);
      });
    }
  };
  wireServicesChoiceInputs();
  bindAccept('site-config-accept-btn', { servicesMode: 'both' });
  bindAccept('site-config-reaccept-btn', { servicesMode: 'both' });
  bindAccept('site-config-accept-with-commercial', { servicesMode: 'both' });
  bindAccept('site-config-accept-keep-commercial', { servicesMode: 'both' });
  bindAccept('site-config-accept-residential-only', { servicesMode: 'residential' });
  bindAccept('site-config-accept-residential-only-update', { servicesMode: 'residential' });
  bindAccept('site-config-accept-commercial-only', { servicesMode: 'commercial' });
  bindAccept('site-config-accept-commercial-only-update', { servicesMode: 'commercial' });

  document.getElementById('sc-provision-twilio')?.addEventListener('click', async () => {
    const cid = d.id;
    if (!cid) return;
    const areaCode = String(document.getElementById('sc-twilio-area')?.value || '')
      .replace(/\D/g, '')
      .slice(0, 3);
    const ok = await showModal({
      title: 'Provision Twilio ranking number?',
      confirmLabel: 'Buy number',
      bodyHtml: `<p>Buys one US local number (~$1.15/mo), writes accepted site-config phone, and sets whisper from business name.</p>
        <p class="muted small">Area: ${areaCode ? esc(areaCode) : 'locality from site-config city/state'}</p>`,
    });
    if (!ok) return;
    const btn = document.getElementById('sc-provision-twilio');
    const status = document.getElementById('sc-phone-tracking-status');
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Provisioning…';
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(cid)}/phone/provision-twilio`, {
        method: 'POST',
        body: JSON.stringify({
          confirm: true,
          ...(areaCode.length === 3 ? { areaCode } : {}),
        }),
      });
      state.sitePhoneProvisioned = { ...(state.sitePhoneProvisioned || {}), [cid]: true };
      markSoftDonePrior('siteConfigSoftDone', SITE_CONFIG_STEP_ORDER, 'phone');
      if (!state.siteConfigSoftDone) state.siteConfigSoftDone = {};
      state.siteConfigSoftDone.phone = true;
      await applyCandidatePayload(result.candidate, cid);
      renderDetail();
      notifyCandidatesChanged({ type: 'candidates', ids: [cid] });
      await showModal({
        title: 'Number provisioned',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p><strong>${esc(result.provisioned?.phone || result.provisioned?.e164 || '')}</strong> written to site-config.</p>
          <p class="muted small">Continue Content, then Website Prepare / Launch. Use Launched → Update site phone number if you need to re-ship later.</p>`,
      });
    } catch (error) {
      if (status) status.textContent = '';
      if (btn) btn.disabled = false;
      await showModal({
        title: 'Provision failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>${
          error.twilioSid
            ? `<p class="muted small">Twilio SID: <code>${esc(error.twilioSid)}</code>${
                error.e164 ? ` · ${esc(error.e164)}` : ''
              }. Do not buy again until this SID is resolved in Twilio Console.</p>`
            : ''
        }`,
      });
    }
  });

  document.getElementById('sc-skip-phone')?.addEventListener('click', async () => {
    const cid = d.id;
    if (!cid) return;
    const btn = document.getElementById('sc-skip-phone');
    if (btn) btn.disabled = true;
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(cid)}/phone/skip`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!state.siteConfigSoftDone) state.siteConfigSoftDone = {};
      state.siteConfigSoftDone.phone = true;
      markSoftDonePrior('siteConfigSoftDone', SITE_CONFIG_STEP_ORDER, 'phone');
      await applyCandidatePayload(result.candidate, cid);
      renderDetail();
      notifyCandidatesChanged({ type: 'candidates', ids: [cid] });
    } catch (error) {
      if (btn) btn.disabled = false;
      await showModal({
        title: 'Skip phone failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  // Reflect existing portfolio phoneTracking if present
  void (async () => {
    const status = document.getElementById('sc-phone-tracking-status');
    const btn = document.getElementById('sc-provision-twilio');
    if (!status || !d.id) return;
    try {
      const data = await api(`/api/candidates/${encodeURIComponent(d.id)}/portfolio-site`);
      const row = data.site;
      const pt = row?.phoneTracking;
      if (pt?.provider === 'twilio' && pt.twilioSid) {
        status.textContent = `Twilio ${pt.e164 || ''} provisioned${
          pt.provisionedAt ? ` · ${String(pt.provisionedAt).slice(0, 10)}` : ''
        }`;
        if (btn) btn.disabled = true;
        if (!state.sitePhoneProvisioned?.[d.id]) {
          state.sitePhoneProvisioned = { ...(state.sitePhoneProvisioned || {}), [d.id]: true };
          if (!state.siteConfigSoftDone) state.siteConfigSoftDone = {};
          state.siteConfigSoftDone.phone = true;
          renderDetail();
        }
      }
    } catch {
      /* ignore */
    }
  })();

  const saHost = document.getElementById('sa-host');
  const saMapCanvas = document.getElementById('sa-map-canvas');
  const serviceAreaOpen =
    state.siteConfigOpenStep === 'service-area' &&
    Boolean(d.siteConfig?.primaryCity && d.siteConfig?.state);

  if (serviceAreaMount) {
    try {
      serviceAreaMount.destroy();
    } catch {
      /* ignore */
    }
    serviceAreaMount = null;
  }
  serviceAreaMountedId = null;
  setServiceAreaTableMode(false);

  if (serviceAreaOpen && saHost && saMapCanvas) {
    const gen = ++serviceAreaLoadGen;
    serviceAreaMountedId = d.id;
    setServiceAreaTableMode(true);
    setServiceAreaLoading(true);
    syncCandidatesDetailVisibility();
    const accepted = d.siteConfig;
    void mountServiceAreaMap({
      mapHost: saMapCanvas,
      controlsHost: saHost,
      api,
      esc,
      primaryCity: accepted.primaryCity,
      state: accepted.state,
      radiusMiles: d.meta?.lastServiceAreaAt
        ? accepted.serviceRadiusMiles || 15
        : 15,
      initialSelected: Array.isArray(accepted.coverageAreas)
        ? accepted.coverageAreas
        : (accepted.targetSuburbs || []).map((name) => ({ name, state: accepted.state })),
      claudeOrder: Array.isArray(accepted.targetSuburbs) ? accepted.targetSuburbs : [],
      researchSuggestedSuburbs: Array.isArray(d.approved?.suggestedSuburbs)
        ? d.approved.suggestedSuburbs
        : Array.isArray(d.narrative?.suggestedSuburbs)
          ? d.narrative.suggestedSuburbs
          : [],
      onAccept: async ({ radiusMiles, selectedCities, locationPageCities }, { onProgress } = {}) => {
        const res = await fetch(
          `/api/candidates/${encodeURIComponent(d.id)}/site-config/service-area`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              radiusMiles,
              selectedCities,
              claudeOrder: accepted.targetSuburbs || [],
              locationPageCities: locationPageCities || [],
            }),
          },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || res.statusText || 'Service area save failed');
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response stream from service-area save');
        const decoder = new TextDecoder();
        let buffer = '';
        let result = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let msg;
            try {
              msg = JSON.parse(trimmed);
            } catch {
              continue;
            }
            if (msg.type === 'progress') {
              onProgress?.({
                label: msg.label,
                detail: msg.detail,
                current: msg.current,
                total: msg.total,
              });
            } else if (msg.type === 'error') {
              throw new Error(msg.error || 'Service area save failed');
            } else if (msg.type === 'done') {
              result = msg;
            }
          }
        }
        if (buffer.trim()) {
          let msg;
          try {
            msg = JSON.parse(buffer.trim());
          } catch {
            msg = null;
          }
          if (msg?.type === 'error') {
            throw new Error(msg.error || 'Service area save failed');
          }
          if (msg?.type === 'done') result = msg;
        }
        if (!result) throw new Error('Service area save ended without a result');
        if (!state.siteConfigSoftDone) state.siteConfigSoftDone = {};
        state.siteConfigSoftDone['service-area'] = true;
        markSoftDonePrior('siteConfigSoftDone', SITE_CONFIG_STEP_ORDER, 'service-area');
        await applyCandidatePayload(result.candidate, d.id);
        const mapNote = result.coverageMap?.error
          ? ` · map: ${result.coverageMap.error}`
          : result.coverageMap?.warning
            ? ` · ${result.coverageMap.warning}`
            : '';
        showToast(
          `Service area saved · ${result.coverageAreas?.length || 0} coverage · ${
            result.targetSuburbs?.length || 0
          } location pages${mapNote}`,
          { tone: result.coverageMap?.error ? 'warn' : 'ok' },
        );
        advancePanelStep('site-config', 'phone');
        renderDetail();
        notifyCandidatesChanged({ type: 'candidates', ids: [d.id] });
      },
    })
      .then(async (m) => {
        if (gen !== serviceAreaLoadGen) {
          try {
            m?.destroy?.();
          } catch {
            /* ignore */
          }
          return;
        }
        serviceAreaMount = m;
        serviceAreaMountedId = d.id;
        await m?.invalidateSize?.();
      })
      .finally(() => {
        if (gen === serviceAreaLoadGen) setServiceAreaLoading(false);
      });
  } else {
    serviceAreaLoadGen += 1;
    serviceAreaMountedId = null;
    setServiceAreaLoading(false);
  }
}

function renderDetail() {
  hideOpsTooltip();
  const d = state.detail;
  if (!d) return;
  if (state.selectedIds.size > 1) {
    renderMultiDetail();
    return;
  }
  state.multiQueue = false;
  syncListRowFromDetail(d);
  syncCandidatesDetailVisibility();
  document.getElementById('empty-detail').classList.add('hidden');
  document.getElementById('detail').classList.remove('hidden');
  const niche = d.summary?.niche || d.config?.niche || '';
  const city =
    d.summary?.primaryCity ||
    String(d.config?.primary || '')
      .split(',')[0]
      ?.trim() ||
    '';
  const stateCode =
    d.summary?.state ||
    String(d.config?.primary || '')
      .split(',')[1]
      ?.trim() ||
    '';
  const place = [city, stateCode].filter(Boolean).join(', ');
  const title = [niche, place].filter(Boolean).join(' · ') || d.id;
  const titleEl = document.getElementById('detail-title');
  titleEl.textContent = title;
  setElementTip(titleEl, '');
  if (d.id && title !== d.id) {
    titleEl.setAttribute('aria-label', `${title} (${d.id})`);
  } else {
    titleEl.removeAttribute('aria-label');
  }
  const srcBatch = d.meta?.source?.batchId;
  document.getElementById('detail-sub').textContent = '';
  const tipBits = [];
  if (d.id) tipBits.push(`Id: ${d.id}`);
  if (srcBatch) tipBits.push(`Discovery: ${srcBatch}`);
  const idTip = document.getElementById('detail-id-tip');
  if (idTip) {
    if (tipBits.length) {
      idTip.classList.remove('hidden');
      setElementTip(idTip, tipBits.join('\n'));
      idTip.setAttribute('aria-label', 'Candidate id');
    } else {
      idTip.classList.add('hidden');
      setElementTip(idTip, '');
      idTip.setAttribute('aria-label', 'Candidate id');
    }
  }
  renderActions();
  updateTabCompletion();

  if (serviceAreaLiveFor(d.id)) {
    setServiceAreaTableMode(true);
    syncCandidatesDetailVisibility();
    serviceAreaMount?.invalidateSize?.();
    return;
  }

  const panels = {
    overview: renderOverview,
    serp: renderSerp,
    keywords: renderKeywords,
    enrichment: renderEnrichment,
    narrative: renderNarrative,
    'site-config': renderSiteConfig,
    content: renderContent,
    website: renderWebsite,
    prospects: renderProspects,
    logs: renderLogs,
  };
  document.getElementById('tab-panels').innerHTML = (panels[state.tab] || renderOverview)();

  const tabPanels = document.getElementById('tab-panels');
  enableResizableTablesIn(tabPanels, {
    storagePrefix: `detail:${state.tab || 'overview'}`,
  });
  tabPanels.querySelectorAll('[data-act="accept"], [data-act="reject"], [data-act="outreach"]').forEach((btn) => {
    btn.addEventListener('click', () => handleAction(btn.dataset.act, btn));
  });

  // Leftover drafts (pre–auto-accept): commit once when detail opens
  if (
    d.narrativeDraft &&
    !d.narrativeDraft.parseError &&
    !state._narrativeAutoAccepting &&
    !(state.narrativeAutoAcceptFailed instanceof Set && state.narrativeAutoAcceptFailed.has(d.id))
  ) {
    state._narrativeAutoAccepting = true;
    acceptNarrativeWithOverride(d.id)
      .then(async () => {
        if (state.narrativeAutoAcceptFailed instanceof Set) {
          state.narrativeAutoAcceptFailed.delete(d.id);
        }
        await loadSelectedCandidateDetail(d.id);
        await loadCandidates();
        if (state.selectedId === d.id) renderDetail();
        announceStepComplete('Narrative');
      })
      .catch((error) => {
        if (!(state.narrativeAutoAcceptFailed instanceof Set)) {
          state.narrativeAutoAcceptFailed = new Set();
        }
        state.narrativeAutoAcceptFailed.add(d.id);
        showToast(error.message || 'Narrative draft needs fixes', { tone: 'warn' });
      })
      .finally(() => {
        state._narrativeAutoAccepting = false;
      });
  }

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
        await loadSelectedCandidateDetail(d.id);
        state.tab = 'narrative';
        await loadCandidates();
        renderDetail();
        if (state.detail?.stageFlags?.hasNarrative) {
          if (state.narrativeAutoAcceptFailed instanceof Set) {
            state.narrativeAutoAcceptFailed.delete(d.id);
          }
          announceStepComplete('Narrative');
        } else if (state.detail?.narrativeDraft) {
          showToast('Draft saved — fix validation issues and Load again', { tone: 'warn' });
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

  const outreachCopyBtn = document.getElementById('prospects-copy-outreach-prompt');
  if (outreachCopyBtn) {
    outreachCopyBtn.addEventListener('click', async () => {
      outreachCopyBtn.disabled = true;
      try {
        const data = await api(
          `/api/candidates/${encodeURIComponent(d.id)}/copy-outreach-prompt`,
        );
        await navigator.clipboard.writeText(data.prompt || '');
        showToast('Outreach prompt copied — paste in Claude.ai.');
      } catch (error) {
        await showModal({
          title: 'Copy failed',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      } finally {
        outreachCopyBtn.disabled = false;
      }
    });
  }

  wireSiteConfigTab(d);
  wireContentTab(d);
  applyDetailShelf();
  if (state.assembleProgress?.visible) {
    setAssembleProgress(true, state.assembleProgress.detail, {
      done: state.assembleProgress.done,
      total: state.assembleProgress.total,
    });
  }

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
        await loadSelectedCandidateDetail(d.id);
        await loadCandidates();
        renderDetail();
        notifyCandidatesChanged({ type: 'candidates', ids: [d.id] });
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
  restoreSlotBusyOverlays();
}

async function loadConcurrencySettings() {
  try {
    const data = await api('/api/concurrency');
    applyConcurrencyPayload(data);
  } catch {
    /* keep defaults */
  }
  syncSettingsConcurrencyInputs();
}

function wireUi() {
  wireOpsTooltips();
  wireTableDeselectOnEmpty(
    document.querySelector('.candidates-table-panel'),
    clearCandidateRowSelection,
  );
  wireTableDeselectOnEmpty(document.querySelector('.sites-table-panel'), clearSitesRowSelection);
  wireTableDeselectOnEmpty(document.querySelector('.phone-calls-panel'), clearPhoneCallSelection);
  wireTableDeselectOnEmpty(
    document.querySelector('.discovery-table-panel'),
    clearDiscoveryRowSelection,
  );
  syncCandidatesDetailVisibility();
  syncSitesDetailVisibility();
  syncPhoneDetailVisibility();
  document.getElementById('candidates-detail-panel')?.addEventListener('click', (event) => {
    const btn = event.target.closest('#detail-shelf-toggle');
    if (!btn) return;
    event.preventDefault();
    toggleDetailShelf();
  });
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
  document.getElementById('candidate-batch-filter')?.addEventListener('change', (e) => {
    state.candidateBatchFilter = e.target.value;
    renderList();
    renderActions();
  });
  document.getElementById('candidate-group-filter')?.addEventListener('change', (e) => {
    state.candidateGroupFilter = e.target.value;
    renderList();
    renderActions();
  });
  document.getElementById('candidate-visibility-filter')?.addEventListener('change', (e) => {
    state.candidateVisibilityFilter = e.target.value || 'active';
    renderList();
    renderActions();
  });
  document.getElementById('candidate-filter-text')?.addEventListener('input', (e) => {
    state.candidateTextFilter = e.target.value;
    renderList();
  });
  document.getElementById('candidate-select-filtered')?.addEventListener('click', () => {
    if (candidateSelectionLocked()) return;
    for (const c of filteredCandidates()) state.selectedIds.add(c.id);
    renderList();
    renderActions();
    if (state.selectedIds.size > 1) renderMultiDetail();
  });
  document.getElementById('candidate-clear-selection')?.addEventListener('click', () => {
    clearCandidateRowSelection();
  });
  document.getElementById('candidate-add-to-sites-btn')?.addEventListener('click', async () => {
    const ids = [...state.selectedIds];
    if (!ids.length) return;
    const ok = await showModal({
      title: 'Add selection to Launched?',
      confirmLabel: `Add to Launched (${ids.length})`,
      bodyHtml: `<p>Add <strong>${esc(String(ids.length))}</strong> selected candidate(s) that have already <strong>Run launch</strong>. Unlaunched rows (Site-Config phone only) are rejected.</p>`,
    });
    if (!ok) return;
    try {
      const result = await api('/api/sites', {
        method: 'POST',
        body: JSON.stringify({ candidateIds: ids }),
      });
      const added = result.added?.length || 0;
      const updated = result.updated?.length || 0;
      const failed = result.errors?.length || 0;
      const errBits = (result.errors || [])
        .slice(0, 8)
        .map((e) => `<li>${esc(e.id)}: ${esc(e.error)}</li>`)
        .join('');
      const openSites = await showModal({
        title: 'Added to Sites',
        confirmLabel: 'Open Sites',
        bodyHtml: `<p>Added <strong>${esc(String(added))}</strong> · updated <strong>${esc(
          String(updated),
        )}</strong>${failed ? ` · failed <strong>${esc(String(failed))}</strong>` : ''}.</p>${
          errBits ? `<ul>${errBits}</ul>` : ''
        }`,
      });
      if (openSites) {
        setView('launched-sites');
        await loadSites();
      }
    } catch (error) {
      await showModal({
        title: 'Add to Sites failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
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
      notifyCandidatesChanged({ type: 'candidates', ids });
      if (state.selectedId) {
        await loadSelectedCandidateDetail(state.selectedId);
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
  document.getElementById('candidate-group-add-btn')?.addEventListener('click', () => {
    applyGroupMembership('add');
  });
  document.getElementById('candidate-group-remove-btn')?.addEventListener('click', () => {
    applyGroupMembership('remove');
  });
  document.getElementById('candidate-group-manage-btn')?.addEventListener('click', () => {
    manageCandidateGroups();
  });
  document.getElementById('candidate-archive-btn')?.addEventListener('click', () => {
    applyCandidateArchive(true);
  });
  document.getElementById('candidate-unarchive-btn')?.addEventListener('click', () => {
    applyCandidateArchive(false);
  });
  document.getElementById('candidate-delete-btn')?.addEventListener('click', () => {
    applyCandidatePermanentDelete();
  });
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.tab = tab.dataset.tab;
      const id = state.selectedId;
      void (async () => {
        if (id) await ensureDetailSlices(id, slicesForTab(state.tab));
        renderDetail();
      })();
    });
  });

  wireClaudeModeUi();
  wireDiscoveryUi();
}

function normalizeAppView(view) {
  if (view === 'candidates') return 'research';
  if (view === 'sites') return 'launched-sites';
  return view;
}

function isCandidatesShellView(view) {
  return view === 'research' || view === 'website-builder';
}

function applyPipelineTabMode() {
  const tabs = document.getElementById('tabs');
  if (!tabs) return;
  const mode = state.view === 'website-builder' ? 'website-builder' : 'research';
  state.pipelineMode = mode;
  tabs.dataset.pipelineMode = mode;

  const researchTabs = new Set(['serp', 'keywords', 'enrichment', 'narrative', 'prospects']);
  const buildTabs = new Set(['site-config', 'content', 'website']);
  if (mode === 'research' && buildTabs.has(state.tab)) {
    state.tab = 'overview';
  }
  if (mode === 'website-builder' && researchTabs.has(state.tab)) {
    state.tab = state.detail?.stageFlags?.hasSiteConfig ? 'site-config' : 'overview';
  }

  const titleEl =
    document.getElementById('candidates-view-title') ||
    document.querySelector('#view-candidates .panel-head h1');
  if (titleEl) {
    titleEl.textContent = mode === 'website-builder' ? 'Website' : 'Research';
  }
  const subEl = document.getElementById('candidates-view-sub');
  if (subEl) {
    subEl.textContent =
      mode === 'website-builder'
        ? 'Website Candidates (pursue) — Site-Config, Content, Launch'
        : 'Research Candidates — SERP/Volume, Enrich, Narrative, Prospects';
  }
}

function setView(view) {
  view = normalizeAppView(view);
  state.view = view;
  hideOpsTooltip();
  const onCandidates = isCandidatesShellView(view);
  document.getElementById('view-candidates').classList.toggle('hidden', !onCandidates);
  document.getElementById('view-discovery').classList.toggle('hidden', view !== 'discovery');
  document.getElementById('view-sites')?.classList.toggle('hidden', view !== 'launched-sites');
  document.getElementById('view-phone')?.classList.toggle('hidden', view !== 'phone');
  document.getElementById('view-map')?.classList.toggle('hidden', view !== 'map');
  document.getElementById('view-photo')?.classList.toggle('hidden', view !== 'photo');
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  if (onCandidates) {
    applyPipelineTabMode();
    fillCandidateBatchFilterSelect();
    renderList();
    renderActions();
    syncCandidatesDetailVisibility();
    if (state.detail) renderDetail();
  }
  if (view === 'launched-sites') {
    loadSites().catch(() => {});
  }
  if (view === 'phone') {
    loadPhoneView().catch(() => {});
  }
  if (view === 'photo') {
    loadPhotoView().catch(() => {});
  }
  if (view === 'map') {
    // Shared readyPromise with openResearchMap — no second init / US fit race.
    ensureResearchMapReady({ api, esc, showModal })
      .then(() => invalidateResearchMapSize())
      .catch((error) => {
        const n = document.getElementById('rm-status');
        if (n) {
          n.textContent = error.message || 'Map failed';
          n.dataset.kind = 'err';
        }
      });
  }
  if (view === 'discovery') {
    syncDiscoveryClaudeModeUi();
    syncGeneratePackOverlay(state.lightJobsSnap);
  } else {
    closeDiscoveryCitiesMap();
  }
}

const SITE_TABLE_COLS = [
  { key: 'niche', label: 'Niche' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'researchMap', label: 'Map', sortable: false },
  { key: 'domain', label: 'Domain' },
  { key: 'status', label: 'Status' },
  { key: 'clicks28d', label: 'Clicks 28d' },
  { key: 'impressions28d', label: 'Impr 28d' },
  { key: 'primaryPosition', label: 'Pos' },
  { key: 'primaryPage', label: 'Page' },
  { key: 'gscLastSyncAt', label: 'GSC sync' },
  { key: 'lastRankCheckAt', label: 'Rank check' },
  { key: 'targetRentUsd', label: 'Target $' },
  { key: 'actualRentUsd', label: 'Actual $' },
  { key: 'lastLaunchAt', label: 'Launched' },
];

function formatSiteMetricNum(n, digits = 0) {
  if (n == null || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return digits > 0 ? num.toFixed(digits) : String(Math.round(num));
}

/** Format Y axis tick for Sites charts. */
function formatSitesChartAxis(v, yFormat) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (yFormat === 'percent') return `${Math.round(n)}%`;
  return String(Math.round(n));
}

/**
 * Simple multi-series SVG line chart.
 * series: [{ label, color, points: [{ y }] }] — null/NaN y dropped.
 * opts: { yLabel, height, yFormat: 'number'|'percent', invertY, minPoints }
 */
function renderSvgLineChart(
  container,
  seriesList,
  { yLabel = '', height = 110, yFormat = 'number', invertY = false, minPoints = 2 } = {},
) {
  if (!container) return;

  const cleaned = (seriesList || [])
    .map((s) => ({
      label: s.label || '',
      color: s.color || '#2a9d8f',
      points: (s.points || [])
        .map((p) => {
          const y = p == null || typeof p !== 'object' ? Number(p) : Number(p.y);
          return Number.isFinite(y) ? { y } : null;
        })
        .filter(Boolean),
    }))
    .filter((s) => s.points.length > 0);

  const series =
    cleaned.filter((s) => s.points.length >= minPoints).length > 0
      ? cleaned.filter((s) => s.points.length >= minPoints)
      : minPoints <= 1
        ? cleaned
        : [];

  if (!series.length) {
    container.innerHTML = `<div class="sites-chart-empty muted small">No data yet</div>`;
    return;
  }

  const w = 320;
  const h = height;
  const pad = { t: 14, r: 10, b: 12, l: 34 };
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  let yMin = Math.min(...allY);
  let yMax = Math.max(...allY);
  if (yMin === yMax) {
    if (yFormat === 'percent') {
      yMin = Math.max(0, yMin - 5);
      yMax = Math.min(100, yMax + 5);
      if (yMin === yMax) {
        yMin = 0;
        yMax = 100;
      }
    } else if (invertY) {
      yMin = Math.max(1, yMin - 1);
      yMax = yMax + 1;
    } else {
      yMin = Math.max(0, yMin - 1);
      yMax = yMax + 1;
    }
  } else {
    const padAmt = (yMax - yMin) * 0.08 || 1;
    yMin -= padAmt;
    yMax += padAmt;
    if (yFormat === 'percent') {
      yMin = Math.max(0, yMin);
      yMax = Math.min(100, yMax);
    } else if (!invertY && yMin > 0 && yMin < (yMax - yMin) * 0.2) {
      yMin = 0;
    }
  }
  if (yMax <= yMin) yMax = yMin + 1;

  const maxPts = Math.max(...series.map((s) => s.points.length));
  const xAt = (i, len) =>
    pad.l + (i / Math.max((len || maxPts) - 1, 1)) * (w - pad.l - pad.r);
  const yAt = (v) => {
    const t = (v - yMin) / (yMax - yMin);
    const norm = invertY ? t : 1 - t;
    return pad.t + norm * (h - pad.t - pad.b);
  };

  // Axis labels: top of plot = better for invertY (lower rank), else higher value
  const topLabel = invertY ? formatSitesChartAxis(yMin, yFormat) : formatSitesChartAxis(yMax, yFormat);
  const botLabel = invertY ? formatSitesChartAxis(yMax, yFormat) : formatSitesChartAxis(yMin, yFormat);

  const paths = series
    .map((s) => {
      const d = s.points
        .map((p, i) => {
          const cmd = i === 0 ? 'M' : 'L';
          return `${cmd}${xAt(i, s.points.length).toFixed(1)},${yAt(p.y).toFixed(1)}`;
        })
        .join(' ');
      return `<path d="${d}" fill="none" stroke="${esc(s.color)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join('');

  const dots =
    maxPts <= 24
      ? series
          .map((s) =>
            s.points
              .map(
                (p, i) =>
                  `<circle cx="${xAt(i, s.points.length).toFixed(1)}" cy="${yAt(p.y).toFixed(
                    1,
                  )}" r="2.25" fill="${esc(s.color)}" />`,
              )
              .join(''),
          )
          .join('')
      : '';

  const legend = series
    .map(
      (s) =>
        `<li class="sites-chart-legend-item" title="${esc(s.label)}">
          <span class="sites-chart-legend-dot" style="background:${esc(s.color)}"></span>
          <span class="sites-chart-legend-label">${esc(s.label)}</span>
        </li>`,
    )
    .join('');

  container.innerHTML = `<div class="sites-chart-plot">
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(
      yLabel || 'chart',
    )}">
      <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${h - pad.b}" stroke="currentColor" stroke-opacity="0.12" />
      <line x1="${pad.l}" y1="${h - pad.b}" x2="${w - pad.r}" y2="${h - pad.b}" stroke="currentColor" stroke-opacity="0.12" />
      ${paths}${dots}
      <text x="4" y="${pad.t + 3}" fill="currentColor" font-size="10" opacity="0.55">${esc(topLabel)}</text>
      <text x="4" y="${h - pad.b + 3}" fill="currentColor" font-size="10" opacity="0.55">${esc(botLabel)}</text>
    </svg>
  </div>
  <ul class="sites-chart-legend">${legend}</ul>`;
}

function renderSitesPortfolioCharts() {
  const wrap = document.getElementById('sites-portfolio-charts');
  if (!wrap) return;
  const traffic = state.sitesPortfolio?.traffic || [];
  const ranks = state.sitesPortfolio?.ranks || [];
  const hasAny = traffic.length || ranks.length || (state.sites || []).some((s) => s.clicks28d != null);
  wrap.classList.toggle('hidden', !hasAny && !(state.gscStatus?.connected));

  renderSvgLineChart(
    document.getElementById('sites-chart-traffic'),
    [
      {
        label: 'Clicks',
        color: '#2a9d8f',
        points: traffic.map((r) => ({ y: r.clicks })),
      },
      {
        label: 'Impressions',
        color: '#e9c46a',
        points: traffic.map((r) => ({ y: r.impressions })),
      },
    ],
    { yLabel: 'Portfolio traffic', yFormat: 'number', minPoints: 2 },
  );

  renderSvgLineChart(
    document.getElementById('sites-chart-ranks'),
    [
      {
        label: '% on page 1',
        color: '#457b9d',
        points: ranks
          .filter((r) => r.page1Share != null && Number.isFinite(Number(r.page1Share)))
          .map((r) => ({ y: Math.round(Number(r.page1Share) * 100) })),
      },
    ],
    { yLabel: 'Primary on page 1', yFormat: 'percent', minPoints: 2 },
  );
}

function updateSitesGscConnectButton() {
  const connectBtn = document.getElementById('sites-gsc-connect-btn');
  if (!connectBtn) return;
  const g = state.gscStatus || {};
  connectBtn.textContent = 'Connect GSC';
  if (g.connected) {
    connectBtn.classList.add('hidden');
    connectBtn.hidden = true;
    connectBtn.disabled = true;
    return;
  }
  connectBtn.classList.remove('hidden');
  connectBtn.hidden = false;
  if (!g.configured) {
    connectBtn.disabled = true;
    return;
  }
  connectBtn.disabled = Boolean(state.sitesMetricsBusy);
}

function renderSitesGscStatus() {
  const el = document.getElementById('sites-gsc-status');
  if (!el) return;
  const g = state.gscStatus || {};
  if (!g.configured) {
    el.textContent =
      'GSC: set GOOGLE_GSC_CLIENT_ID + GOOGLE_GSC_CLIENT_SECRET in .env (Desktop OAuth). Redirect: ' +
      (g.redirectUri || 'http://127.0.0.1:8787/api/gsc/oauth/callback');
  } else if (g.connected) {
    el.textContent = `GSC: connected${g.email ? ` (${g.email})` : ''}${
      g.updatedAt ? ` · ${String(g.updatedAt).slice(0, 16).replace('T', ' ')}` : ''
    }`;
  } else {
    el.textContent = `GSC: not connected · redirect URI must be allowed: ${g.redirectUri || ''}`;
  }
  updateSitesGscConnectButton();
}

/** Sites eligible for GSC/rank bulk jobs (matches server metricsEligibleSites). */
function sitesMetricsEligible() {
  return (state.sites || []).filter((s) => {
    if (!s.lastLaunchAt && !s.lastShipAt) return false;
    if (!['live', 'listed', 'rented', 'building'].includes(String(s.status || ''))) return false;
    return Boolean(s.domain || s.liveUrl);
  });
}

function siteMetricsDomainLabel(s) {
  return s?.domain || s?.liveUrl || s?.id || 'site';
}

function setSitesMetricsProgress({ visible, label, detail, pct } = {}) {
  const wrap = document.getElementById('sites-metrics-progress');
  const bar = document.getElementById('sites-metrics-progress-bar');
  const labelEl = document.getElementById('sites-metrics-progress-label');
  const detailEl = document.getElementById('sites-metrics-progress-detail');
  if (wrap) {
    wrap.classList.toggle('hidden', !visible);
    if (labelEl && label != null) labelEl.textContent = label;
    if (detailEl && detail != null) detailEl.textContent = detail;
    if (pct == null || !Number.isFinite(Number(pct))) {
      setDeterminateProgress(bar, {});
    } else {
      setDeterminateProgress(bar, { done: Number(pct), total: 100 });
    }
  }
}

function setSitesMetricsButtonsDisabled(busy) {
  state.sitesMetricsBusy = Boolean(busy);
  const ids = [
    'sites-gsc-sync-btn',
    'sites-rank-sync-btn',
    'sites-add-btn',
    'sites-refresh-btn',
    'sites-kw-add',
    'sites-kw-save',
    'sites-rank-check-one',
    'sites-gsc-sync-one',
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.disabled = Boolean(busy);
  }
  updateSitesGscConnectButton();
}

function clearSitesGscConnectWait() {
  const wait = state._sitesGscConnectWait;
  if (!wait) return;
  if (wait.pollTimer) clearInterval(wait.pollTimer);
  if (wait.timeoutTimer) clearTimeout(wait.timeoutTimer);
  if (wait.onFocus) window.removeEventListener('focus', wait.onFocus);
  state._sitesGscConnectWait = null;
}

async function finishSitesGscConnectWait({ connected = false, timedOut = false } = {}) {
  clearSitesGscConnectWait();
  try {
    await loadSites();
  } catch {
    /* ignore */
  }
  setSitesMetricsProgress({ visible: false, label: '', detail: '', pct: null });
  setSitesMetricsButtonsDisabled(false);
  if (timedOut && !connected) {
    await showModal({
      title: 'GSC connect still waiting',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>No connection confirmed after 2 minutes. Finish Google sign-in in the popup, or click <strong>Connect GSC</strong> again.</p>`,
    });
  } else if (connected) {
    setSitesMetricsProgress({
      visible: true,
      label: 'GSC connected',
      detail: 'Ready to Sync GSC',
      pct: 100,
    });
    setTimeout(() => {
      if (!state.sitesMetricsBusy) {
        setSitesMetricsProgress({ visible: false, label: '', detail: '', pct: null });
      }
    }, 1500);
  }
}

function startSitesGscConnectWait() {
  clearSitesGscConnectWait();
  setSitesMetricsButtonsDisabled(true);
  setSitesMetricsProgress({
    visible: true,
    label: 'Waiting for Google sign-in…',
    detail: 'Complete consent in the popup window',
    pct: null,
  });

  const poll = async () => {
    try {
      const status = await api('/api/gsc/status');
      state.gscStatus = status;
      if (status?.connected) {
        await finishSitesGscConnectWait({ connected: true });
      }
    } catch {
      /* keep waiting */
    }
  };

  const onFocus = () => {
    poll();
  };

  const pollTimer = setInterval(poll, 2000);
  const timeoutTimer = setTimeout(() => {
    if (state._sitesGscConnectWait) {
      finishSitesGscConnectWait({ timedOut: true });
    }
  }, 120000);

  state._sitesGscConnectWait = { pollTimer, timeoutTimer, onFocus };
  window.addEventListener('focus', onFocus);
}

/**
 * Run an async Sites metrics job with progress bar + button lock.
 * @param {{ label: string, detail?: string }} start
 * @param {(ctx: { setProgress: Function }) => Promise<void>} fn
 */
async function withSitesMetricsBusy(start, fn) {
  if (state.sitesMetricsBusy) return;
  setSitesMetricsButtonsDisabled(true);
  setSitesMetricsProgress({
    visible: true,
    label: start.label || 'Working…',
    detail: start.detail || 'Starting…',
    pct: start.pct != null ? start.pct : null,
  });
  try {
    await fn({
      setProgress: (opts) => setSitesMetricsProgress({ visible: true, ...opts }),
    });
  } finally {
    setSitesMetricsProgress({ visible: false, label: '', detail: '', pct: null });
    setSitesMetricsButtonsDisabled(false);
  }
}

async function syncSitesGscSequential(siteList) {
  const sites = siteList || sitesMetricsEligible();
  if (!sites.length) {
    await showModal({
      title: 'GSC sync',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>No eligible sites (need status live/listed/rented/building and a domain).</p>`,
    });
    return;
  }
  let synced = 0;
  let failed = 0;
  const errors = [];
  await withSitesMetricsBusy(
    { label: 'Syncing GSC…', detail: `0/${sites.length}`, pct: 0 },
    async ({ setProgress }) => {
      for (let i = 0; i < sites.length; i += 1) {
        const s = sites[i];
        const label = siteMetricsDomainLabel(s);
        setProgress({
          label: 'Syncing GSC…',
          detail: `${i + 1}/${sites.length} · ${label}`,
          pct: Math.round(((i + 0.5) / sites.length) * 100),
        });
        try {
          const result = await api('/api/gsc/sync', {
            method: 'POST',
            body: JSON.stringify({ siteId: s.id }),
          });
          if (result.ok) synced += 1;
          else {
            failed += 1;
            errors.push(`${label}: ${result.error || 'failed'}`);
          }
        } catch (error) {
          failed += 1;
          errors.push(`${label}: ${error.message || error}`);
        }
        setProgress({
          label: 'Syncing GSC…',
          detail: `${i + 1}/${sites.length} · ${label}`,
          pct: Math.round(((i + 1) / sites.length) * 100),
        });
      }
      await loadSites();
    },
  );
  await showModal({
    title: 'GSC sync',
    confirmLabel: 'OK',
    hideCancel: true,
    bodyHtml: `<p>Synced ${esc(synced)} · failed ${esc(failed)}</p>${
      errors.length
        ? `<pre class="muted small" style="white-space:pre-wrap;max-height:160px;overflow:auto">${esc(
            errors.slice(0, 12).join('\n'),
          )}</pre>`
        : ''
    }`,
  });
}

async function checkSitesRanksSequential(siteList) {
  const sites = siteList || sitesMetricsEligible();
  if (!sites.length) {
    await showModal({
      title: 'Rank check',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>No eligible sites (need status live/listed/rented/building and a domain).</p>`,
    });
    return;
  }
  let checked = 0;
  let failed = 0;
  let costUsd = 0;
  const errors = [];
  await withSitesMetricsBusy(
    {
      label: 'Checking ranks (Standard queue)…',
      detail: `0/${sites.length} — can take several minutes`,
      pct: 0,
    },
    async ({ setProgress }) => {
      for (let i = 0; i < sites.length; i += 1) {
        const s = sites[i];
        const label = siteMetricsDomainLabel(s);
        setProgress({
          label: 'Checking ranks (Standard queue)…',
          detail: `${i + 1}/${sites.length} · ${label}`,
          pct: Math.round(((i + 0.5) / sites.length) * 100),
        });
        try {
          const result = await api(`/api/sites/${encodeURIComponent(s.id)}/rank-check`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
          costUsd += Number(result.costUsd) || 0;
          if (result.ok) checked += 1;
          else {
            failed += 1;
            errors.push(`${label}: ${result.error || 'finished with errors'}`);
          }
        } catch (error) {
          failed += 1;
          errors.push(`${label}: ${error.message || error}`);
        }
        setProgress({
          label: 'Checking ranks (Standard queue)…',
          detail: `${i + 1}/${sites.length} · ${label}`,
          pct: Math.round(((i + 1) / sites.length) * 100),
        });
      }
      await loadSites();
    },
  );
  await showModal({
    title: 'Rank sync',
    confirmLabel: 'OK',
    hideCancel: true,
    bodyHtml: `<p>Checked ${esc(checked)} · failed ${esc(failed)} · cost ~$${esc(
      Number(costUsd || 0).toFixed(4),
    )}</p>${
      errors.length
        ? `<pre class="muted small" style="white-space:pre-wrap;max-height:160px;overflow:auto">${esc(
            errors.slice(0, 12).join('\n'),
          )}</pre>`
        : ''
    }`,
  });
}

async function loadSites() {
  const data = await api('/api/sites');
  state.sites = data.sites || [];
  state.siteStatuses = data.statuses || [];
  state.sitePaymentMethods = data.paymentMethods || [];
  state.siteBillingCycles = data.billingCycles || [];
  state.gscStatus = data.gsc || null;
  state.sitesPortfolio = data.portfolio || { traffic: [], ranks: [] };
  fillSitesStateFilter();
  renderSitesGscStatus();
  renderSitesPortfolioCharts();
  renderSitesTable();
  renderSitesDetail();
}

function fillSitesStateFilter() {
  const sel = document.getElementById('sites-filter-state');
  if (!sel) return;
  const current = state.siteFilters.state || '';
  const states = [
    ...new Set(state.sites.map((s) => String(s.state || '').trim().toUpperCase()).filter(Boolean)),
  ].sort();
  sel.innerHTML =
    `<option value="">State: all</option>` +
    states.map((st) => `<option value="${esc(st)}">${esc(st)}</option>`).join('');
  sel.value = current;
}

function filteredSites() {
  const text = String(state.siteFilters.text || '')
    .trim()
    .toLowerCase();
  const status = state.siteFilters.status || '';
  const st = String(state.siteFilters.state || '')
    .trim()
    .toUpperCase();
  let rows = state.sites.filter((s) => {
    if (status && s.status !== status) return false;
    if (st && String(s.state || '').toUpperCase() !== st) return false;
    if (!text) return true;
    const hay = [s.niche, s.city, s.state, s.domain, s.businessName, s.candidateId, s.email]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(text);
  });

  const { key, dir } = state.siteSort;
  rows = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * dir;
  });
  return rows;
}

function formatSiteMoney(n) {
  if (n == null || n === '') return '—';
  return formatMoney(n, 0);
}

function formatSiteDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return String(iso).slice(0, 10);
  }
}

function renderSitesTable() {
  const table = document.getElementById('sites-table');
  if (!table) return;
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  const rows = filteredSites();
  const countEl = document.getElementById('sites-filter-count');
  if (countEl) {
    countEl.textContent = `${rows.length} of ${state.sites.length}`;
  }

  thead.innerHTML = `<tr>${SITE_TABLE_COLS.map((col) => {
    if (col.sortable === false) {
      return `<th>${esc(col.label)}</th>`;
    }
    const active = state.siteSort.key === col.key;
    const arrow = active ? (state.siteSort.dir > 0 ? ' ↑' : ' ↓') : '';
    return `<th class="sortable" data-sort="${esc(col.key)}">${esc(col.label)}${arrow}</th>`;
  }).join('')}</tr>`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${SITE_TABLE_COLS.length}" class="muted">No launched sites yet — Run Launch on a Website candidate.</td></tr>`;
  } else {
    tbody.innerHTML = rows
      .map((s) => {
        const active = s.id === state.selectedSiteId ? 'active' : '';
        const domainCell = s.liveUrl
          ? `<a href="${esc(s.liveUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(
              s.domain || s.liveUrl,
            )}</a>`
          : esc(s.domain || '—');
        const city = s.city || '';
        const st = s.state || '';
        const mapCell =
          !city || !st
            ? `<td class="muted">—</td>`
            : `<td><button type="button" class="btn btn-sm sites-open-map" data-city="${esc(
                city,
              )}" data-state="${esc(st)}" data-tip="Open Map zoomed to ${esc(city)}, ${esc(
                st,
              )}">Map</button></td>`;
        return `<tr class="${active}" data-id="${esc(s.id)}">
          <td>${esc(s.niche || '—')}</td>
          <td>${esc(s.city || '—')}</td>
          <td>${esc(s.state || '—')}</td>
          ${mapCell}
          <td>${domainCell}</td>
          <td><span class="site-status site-status-${esc(s.status || '')}">${esc(s.status || '—')}</span></td>
          <td>${esc(formatSiteMetricNum(s.clicks28d))}</td>
          <td>${esc(formatSiteMetricNum(s.impressions28d))}</td>
          <td>${esc(s.primaryPosition == null ? '—' : s.primaryPosition)}</td>
          <td>${esc(s.primaryPage == null ? '—' : s.primaryPage)}</td>
          <td>${esc(formatSiteDate(s.gscLastSyncAt))}</td>
          <td>${esc(formatSiteDate(s.lastRankCheckAt))}</td>
          <td>${esc(formatSiteMoney(s.targetRentUsd))}</td>
          <td>${esc(formatSiteMoney(s.actualRentUsd))}</td>
          <td>${esc(formatSiteDate(s.lastLaunchAt))}</td>
        </tr>`;
      })
      .join('');
  }

  thead.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.siteSort.key === key) state.siteSort.dir *= -1;
      else state.siteSort = { key, dir: key === 'lastLaunchAt' ? -1 : 1 };
      renderSitesTable();
    });
  });
  tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button.sites-open-map, a')) return;
      state.selectedSiteId = tr.dataset.id;
      renderSitesTable();
      renderSitesDetail();
    });
  });
  tbody.querySelectorAll('button.sites-open-map').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const city = btn.dataset.city || '';
      const st = btn.dataset.state || '';
      setView('map');
      try {
        await openResearchMap({ city, state: st }, { api, esc, showModal });
      } catch (error) {
        await showModal({
          title: 'Map failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
    });
  });
  enableTableColumnResize(table);
}

function selectedSite() {
  return state.sites.find((s) => s.id === state.selectedSiteId) || null;
}

/** Portfolio or hydrate flags: already shipped / live enough for Push (not first Launch). */
function sitePortfolioIsLive(s) {
  if (!s) return false;
  if (['live', 'listed', 'rented'].includes(String(s.status || ''))) return true;
  return Boolean(s.lastShipAt || s.lastLaunchAt || s.cloudflarePagesDone);
}

/**
 * Sites: Prepare-equivalent (Stage → Assemble with ship) + Push when already live.
 * Does not Run launch (domain/email) — hand off to Website tab for first go-live.
 */
async function publishSitePhoneFromSites(s) {
  const id = s?.candidateId;
  if (!id) return;

  const statusEl = document.getElementById('sites-phone-publish-status');
  const provisionBtn = document.getElementById('sites-provision-twilio');
  const updateBtn = document.getElementById('sites-update-site-phone');
  const setStatus = (text) => {
    if (!statusEl) return;
    if (!text) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = text;
  };
  const setBusy = (busy) => {
    if (updateBtn) updateBtn.disabled = busy;
    if (provisionBtn) {
      // Stay disabled while busy or when already provisioned
      provisionBtn.disabled =
        busy || Boolean(s.phoneTracking?.provider === 'twilio' && s.phoneTracking?.twilioSid);
    }
  };

  const alreadyLive = sitePortfolioIsLive(s);
  setBusy(true);
  setStatus('Staging full launch package…');

  try {
    await api(`/api/candidates/${encodeURIComponent(id)}/staging`, {
      method: 'POST',
      body: JSON.stringify({ mode: 'full', openPreview: false }),
    });

    setStatus('Assembling (npm install + build; auto-ship if credentials set)…');
    const assembled = await api(`/api/candidates/${encodeURIComponent(id)}/assemble`, {
      method: 'POST',
      body: JSON.stringify({ force: true, build: true, ship: true }),
    });

    const buildOk = assembled.build?.ok !== false;
    let ship = assembled.ship || null;
    const shipNeedsPush =
      alreadyLive &&
      (!ship?.ok || ship?.skipped || ship?.error);

    if (shipNeedsPush) {
      setStatus('Pushing updates to GitHub + Cloudflare…');
      try {
        const pushed = await api(`/api/candidates/${encodeURIComponent(id)}/ship`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        ship = {
          ok: Boolean(pushed.ok),
          ...(pushed.ok ? {} : { error: pushed.error || 'Push incomplete' }),
          pushed: true,
          human: pushed.human,
        };
      } catch (error) {
        ship = { ok: false, error: error.message, pushed: true };
      }
    }

    await loadSites();
    renderSitesTable();
    renderSitesDetail();

    if (!alreadyLive) {
      const goWebsite = await showModal({
        title: 'Package prepared',
        confirmLabel: 'Open Website tab',
        cancelLabel: 'Stay on Launched',
        bodyHtml: `<p>Stage → Assemble finished${
          buildOk ? '' : ' (build reported a problem — check Website)'
        }. Assembled site-config includes the new phone.</p>
          <p>This listing is <strong>not live yet</strong>. Finish first go-live with <strong>Website → Run launch</strong> (domain / email / Web3Forms). Launch is not run from Launched.</p>`,
      });
      if (goWebsite) {
        setView('website-builder');
        await selectCandidate(id);
        state.tab = 'website';
        if (typeof advancePanelStep === 'function') {
          try {
            advancePanelStep('website', 'launch');
          } catch {
            /* ignore */
          }
        }
        renderDetail();
      }
      return;
    }

    const shipLine = ship?.ok
      ? ship.pushed
        ? 'Push updates ok'
        : 'Auto-ship ok'
      : ship?.skipped
        ? `Ship skipped — ${ship.reason || 'credentials missing'}`
        : ship?.error
          ? `Ship issue: ${ship.error}`
          : 'Ship status unknown';

    await showModal({
      title: ship?.ok ? 'Live phone updated' : 'Prepared (check ship)',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>Stage → Assemble complete for <code>${esc(id)}</code>.</p>
        <p>${esc(shipLine)}</p>
        <p class="muted small">Live CTAs should show <code>${esc(s.phoneTracking?.e164 || s.phone || '')}</code> after Cloudflare finishes the deploy.</p>`,
    });
  } catch (error) {
    await showModal({
      title: 'Update site phone failed',
      confirmLabel: 'OK',
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
    setStatus('');
    renderSitesDetail();
  }
}

function renderSitesDetail() {
  const empty = document.getElementById('sites-empty-detail');
  const body = document.getElementById('sites-detail-body');
  if (!empty || !body) return;
  syncSitesDetailVisibility();
  const s = selectedSite();
  if (!s) {
    empty.classList.remove('hidden');
    body.classList.add('hidden');
    body.innerHTML = '';
    return;
  }
  empty.classList.add('hidden');
  body.classList.remove('hidden');
  const r = s.renter || {};
  const statusOpts = (state.siteStatuses.length ? state.siteStatuses : ['building', 'live', 'listed', 'rented', 'paused', 'retired'])
    .map((v) => `<option value="${esc(v)}" ${s.status === v ? 'selected' : ''}>${esc(v)}</option>`)
    .join('');
  const payOpts =
    `<option value="">—</option>` +
    (state.sitePaymentMethods.length
      ? state.sitePaymentMethods
      : ['ach', 'card', 'check', 'wire', 'cash', 'other']
    )
      .map((v) => `<option value="${esc(v)}" ${s.paymentMethod === v ? 'selected' : ''}>${esc(v)}</option>`)
      .join('');
  const billingOpts = (state.siteBillingCycles.length
    ? state.siteBillingCycles
    : ['monthly', 'annual', 'one_time', 'other']
  )
    .map((v) => `<option value="${esc(v)}" ${s.billingCycle === v ? 'selected' : ''}>${esc(v)}</option>`)
    .join('');

  body.innerHTML = `
    <div class="sites-detail-head">
      <div class="sites-detail-head-main">
        <h2>${esc(s.businessName || s.niche || s.domain || 'Site')}</h2>
        <p class="muted">${esc([s.city, s.state].filter(Boolean).join(', '))}${
          s.candidateId ? ` · <code>${esc(s.candidateId)}</code>` : ''
        }</p>
      </div>
      ${
        s.candidateId
          ? `<button type="button" class="btn primary btn-sm" id="sites-visual-edit" data-tip="Operator visual editor — visitors never see this">Edit site</button>`
          : ''
      }
    </div>
    <div class="sites-detail-links muted small">
      ${s.liveUrl ? `<a href="${esc(s.liveUrl)}" target="_blank" rel="noopener">Live</a>` : ''}
      ${s.cloudflareDashboardUrl ? `<a href="${esc(s.cloudflareDashboardUrl)}" target="_blank" rel="noopener">Cloudflare</a>` : ''}
      ${s.web3FormsDashboardUrl ? `<a href="${esc(s.web3FormsDashboardUrl)}" target="_blank" rel="noopener">Web3Forms</a>${s.web3FormsAccessKeySet ? ' · key set' : ' · no key'}` : ''}
      ${s.githubRepoUrl ? `<a href="${esc(s.githubRepoUrl)}" target="_blank" rel="noopener">GitHub</a>` : ''}
      ${
        s.gscPropertyUrl
          ? `<a href="https://search.google.com/search-console" target="_blank" rel="noopener">GSC</a>`
          : ''
      }
    </div>
    ${
      s.candidateId && (s.status === 'paused' || s.status === 'retired')
        ? `<p class="muted small sites-detail-status-note">Site is ${esc(s.status)} — visual edits still go to candidate source, then Publish to ship.</p>`
        : !s.candidateId
          ? `<p class="muted small sites-detail-status-note">No candidate id — cannot visual-edit this row.</p>`
          : ''
    }
    <div class="sites-metrics-block">
      <h3>Search metrics</h3>
      <p class="muted small sites-metrics-summary">
        28d: ${esc(formatSiteMetricNum(s.clicks28d))} clicks ·
        ${esc(formatSiteMetricNum(s.impressions28d))} impr ·
        CTR ${esc(s.ctr28d == null ? '—' : `${(Number(s.ctr28d) * 100).toFixed(1)}%`)} ·
        avg pos ${esc(formatSiteMetricNum(s.avgPosition28d, 1))}
        ${s.gscSyncError ? `<br/><span class="sites-metric-err">GSC: ${esc(s.gscSyncError)}</span>` : ''}
      </p>
      <p class="muted small sites-metrics-summary">
        Primary rank: pos ${esc(s.primaryPosition == null ? '—' : s.primaryPosition)} ·
        page ${esc(s.primaryPage == null ? '—' : s.primaryPage)}
        ${s.rankSyncError ? `<br/><span class="sites-metric-err">Ranks: ${esc(s.rankSyncError)}</span>` : ''}
      </p>
      <div class="sites-detail-charts">
        <div class="sites-chart-card">
          <h3>Traffic</h3>
          <div id="sites-detail-chart-traffic" class="sites-chart"></div>
        </div>
        <div class="sites-chart-card">
          <h3>Keyword position</h3>
          <div id="sites-detail-chart-ranks" class="sites-chart"></div>
        </div>
      </div>
      <h3 class="sites-kw-heading">Tracked keywords (≤5)</h3>
      <div id="sites-kw-list"></div>
      <div class="sites-kw-actions">
        <button type="button" class="btn primary btn-sm" id="sites-kw-save">Save keywords</button>
        <button type="button" class="btn btn-sm" id="sites-kw-add">Add keyword</button>
        <button type="button" class="btn btn-sm" id="sites-rank-check-one">Check ranks</button>
        <button type="button" class="btn btn-sm" id="sites-gsc-sync-one">Sync GSC</button>
      </div>
    </div>
    <form id="sites-edit-form" class="sites-edit-form">
      <h3>Portfolio</h3>
      <div class="sites-field-row">
        <label>Status <select name="status">${statusOpts}</select></label>
        <label>Billing cycle <select name="billingCycle">${billingOpts}</select></label>
      </div>
      <div class="sites-field-row">
        <label>Target rent ($/mo) <input name="targetRentUsd" type="number" step="1" min="0" value="${esc(s.targetRentUsd ?? '')}" /></label>
        <label>Actual rent ($/mo) <input name="actualRentUsd" type="number" step="1" min="0" value="${esc(s.actualRentUsd ?? '')}" /></label>
      </div>
      <div class="sites-field-row">
        <label>Payment method <select name="paymentMethod">${payOpts}</select></label>
        <label>Payment notes <input name="paymentMethodNotes" type="text" value="${esc(s.paymentMethodNotes || '')}" /></label>
      </div>
      <div class="sites-field-row">
        <label>Contract start <input name="contractStart" type="date" value="${esc((s.contractStart || '').slice(0, 10))}" /></label>
        <label>Contract end <input name="contractEnd" type="date" value="${esc((s.contractEnd || '').slice(0, 10))}" /></label>
      </div>
      <label class="sites-field-span">Next invoice <input name="nextInvoiceAt" type="date" value="${esc((s.nextInvoiceAt || '').slice(0, 10))}" /></label>
      <h3>Renter</h3>
      <div class="sites-field-row">
        <label>Business <input name="renterBusinessName" type="text" value="${esc(r.businessName || '')}" /></label>
        <label>Contact <input name="renterContactName" type="text" value="${esc(r.contactName || '')}" /></label>
      </div>
      <div class="sites-field-row">
        <label>Email <input name="renterEmail" type="email" value="${esc(r.email || '')}" /></label>
        <label>Phone <input name="renterPhone" type="text" value="${esc(r.phone || '')}" /></label>
      </div>
      <label class="sites-field-span">Renter notes <textarea name="renterNotes" rows="2">${esc(r.notes || '')}</textarea></label>
      <label class="sites-field-span">Site notes <textarea name="notes" rows="2">${esc(s.notes || '')}</textarea></label>
      <div class="sites-form-actions">
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>
    <p class="muted small sites-nap-line">Site NAP: ${esc(s.phone || '—')} · ${esc(s.email || '—')}${
      s.launchCostUsd != null ? ` · Launch costs ~${esc(formatMoney(s.launchCostUsd))}` : ''
    }</p>
    <div class="sites-phone-tracking">
      <h3>Phone tracking</h3>
      ${
        s.phoneTracking?.provider === 'twilio' && s.phoneTracking?.e164
          ? `<p class="muted small">Twilio <code>${esc(s.phoneTracking.e164)}</code>${
              s.phoneTracking.phase ? ` · ${esc(s.phoneTracking.phase)}` : ''
            }${
              s.phoneTracking.provisionedAt
                ? ` · ${esc(String(s.phoneTracking.provisionedAt).slice(0, 10))}`
                : ''
            }${
              s.phoneTracking.forwardTo
                ? ` · → ${esc(s.phoneTracking.forwardTo)}`
                : ''
            }</p>`
          : `<p class="muted small">No ranking DID yet (~$1.15/mo). Forwards to <code>TWILIO_FORWARD_TO</code>.</p>`
      }
      <div class="sites-phone-actions">
        <label class="sites-phone-area muted small">
          Area
          <input id="sites-twilio-area" type="text" inputmode="numeric" maxlength="3" placeholder="auto" />
        </label>
        <button type="button" class="btn primary btn-sm" id="sites-provision-twilio" ${
          !s.candidateId || (s.phoneTracking?.provider === 'twilio' && s.phoneTracking?.twilioSid)
            ? 'disabled'
            : ''
        }>Provision</button>
        <button type="button" class="btn btn-sm" id="sites-update-site-phone" ${
          s.candidateId && s.phoneTracking?.provider === 'twilio' && s.phoneTracking?.twilioSid
            ? ''
            : 'disabled'
        } data-tip="Stage → Assemble (and Push if already live) so CTAs show the new NAP">Update site phone</button>
        <button type="button" class="btn btn-sm" id="sites-forward-renter" ${
          s.phoneTracking?.provider === 'twilio' &&
          s.phoneTracking?.twilioSid &&
          String(s.renter?.phone || '').trim()
            ? ''
            : 'disabled'
        } data-tip="Keep same DID; dial renter.phone instead of TWILIO_FORWARD_TO">Forward to renter</button>
        <button type="button" class="btn btn-sm" id="sites-view-calls" ${
          s.phoneTracking?.provider === 'twilio' && s.phoneTracking?.e164 ? '' : 'disabled'
        }>View calls →</button>
      </div>
      <p class="muted small" id="sites-phone-publish-status" hidden></p>
      ${
        !s.candidateId
          ? `<p class="muted small">Link a candidate first (accepted site-config required).</p>`
          : s.phoneTracking?.provider === 'twilio' && s.phoneTracking?.twilioSid
            ? `<p class="muted small">After provision, use <strong>Update site phone</strong> to push NAP. First go-live still needs Website → Run launch.</p>`
            : ''
      }
    </div>
    <div class="sites-danger-zone">
      <h3>Remove</h3>
      <p class="muted small">Removes this listing from Launched only. Research candidate and live site are kept.</p>
      <button type="button" class="btn danger solid" id="sites-delete-btn">Remove from Sites</button>
    </div>
  `;

  // Per-site charts
  const daily = s.metrics?.gsc?.daily || [];
  renderSvgLineChart(
    document.getElementById('sites-detail-chart-traffic'),
    [
      { label: 'Clicks', color: '#2a9d8f', points: daily.map((r) => ({ y: r.clicks })) },
      { label: 'Impressions', color: '#e9c46a', points: daily.map((r) => ({ y: r.impressions })) },
    ],
    { yLabel: 'Site traffic', yFormat: 'number', minPoints: 2 },
  );
  const kwSeries = (s.rankKeywords || []).slice(0, 5).map((kw, idx) => {
    const hist = s.metrics?.ranks?.byKeyword?.[kw.keyword]?.history || [];
    const colors = ['#457b9d', '#2a9d8f', '#e9c46a', '#e76f51', '#9b5de5'];
    return {
      label: kw.isPrimary ? `${kw.keyword} (primary)` : kw.keyword,
      color: colors[idx % colors.length],
      points: hist
        .filter((p) => p.position != null && Number.isFinite(Number(p.position)))
        .map((p) => ({ y: Number(p.position) })),
    };
  });
  renderSvgLineChart(document.getElementById('sites-detail-chart-ranks'), kwSeries, {
    yLabel: 'Keyword position',
    yFormat: 'number',
    invertY: true,
    minPoints: 2,
  });

  const kwList = document.getElementById('sites-kw-list');
  const renderKwRows = (keywords) => {
    if (!kwList) return;
    const rows = keywords.length
      ? keywords
      : [{ keyword: '', isPrimary: true, source: 'manual' }];
    kwList.innerHTML = rows
      .map(
        (kw, i) => `<div class="sites-kw-row" data-idx="${i}">
        <label class="muted small" style="display:inline-flex;align-items:center;gap:0.25rem;white-space:nowrap">
          <input type="radio" name="sites-kw-primary" ${kw.isPrimary ? 'checked' : ''} /> Primary
        </label>
        <input type="text" class="sites-kw-input" value="${esc(kw.keyword || '')}" placeholder="keyword + city" maxlength="120" />
        <button type="button" class="btn sites-kw-remove" title="Remove">×</button>
      </div>`,
      )
      .join('');
    kwList.querySelectorAll('.sites-kw-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.sites-kw-row');
        row?.remove();
        if (!kwList.querySelector('.sites-kw-row')) renderKwRows([]);
      });
    });
  };
  renderKwRows(s.rankKeywords || []);

  document.getElementById('sites-kw-add')?.addEventListener('click', () => {
    const current = [...(kwList?.querySelectorAll('.sites-kw-row') || [])].map((row) => ({
      keyword: row.querySelector('.sites-kw-input')?.value || '',
      isPrimary: Boolean(row.querySelector('input[type=radio]')?.checked),
      source: 'manual',
    }));
    if (current.length >= 5) return;
    current.push({ keyword: '', isPrimary: false, source: 'manual' });
    renderKwRows(current);
  });

  document.getElementById('sites-kw-save')?.addEventListener('click', async () => {
    const keywords = [...(kwList?.querySelectorAll('.sites-kw-row') || [])].map((row) => ({
      keyword: row.querySelector('.sites-kw-input')?.value || '',
      isPrimary: Boolean(row.querySelector('input[type=radio]')?.checked),
      source: 'manual',
    }));
    try {
      await api(`/api/sites/${encodeURIComponent(s.id)}/rank-keywords`, {
        method: 'POST',
        body: JSON.stringify({ keywords }),
      });
      await loadSites();
    } catch (error) {
      await showModal({
        title: 'Save keywords failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('sites-rank-check-one')?.addEventListener('click', async () => {
    if (state.sitesMetricsBusy) return;
    let result = null;
    try {
      await withSitesMetricsBusy(
        {
          label: 'Checking ranks (Standard queue)…',
          detail: siteMetricsDomainLabel(s),
          pct: null,
        },
        async ({ setProgress }) => {
          setProgress({
            label: 'Checking ranks (Standard queue)…',
            detail: `1/1 · ${siteMetricsDomainLabel(s)}`,
            pct: 50,
          });
          result = await api(`/api/sites/${encodeURIComponent(s.id)}/rank-check`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
          setProgress({
            label: 'Checking ranks (Standard queue)…',
            detail: `1/1 · ${siteMetricsDomainLabel(s)}`,
            pct: 100,
          });
          await loadSites();
        },
      );
      if (result) {
        await showModal({
          title: result.ok ? 'Rank check done' : 'Rank check finished with errors',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>Cost ~$${esc(Number(result.costUsd || 0).toFixed(4))}</p>
            <pre class="muted small" style="white-space:pre-wrap">${esc(
              JSON.stringify(result.keywords || [], null, 2),
            )}</pre>`,
        });
      }
    } catch (error) {
      await showModal({
        title: 'Rank check failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('sites-gsc-sync-one')?.addEventListener('click', async () => {
    if (state.sitesMetricsBusy) return;
    let result = null;
    try {
      await withSitesMetricsBusy(
        {
          label: 'Syncing GSC…',
          detail: siteMetricsDomainLabel(s),
          pct: null,
        },
        async ({ setProgress }) => {
          setProgress({
            label: 'Syncing GSC…',
            detail: `1/1 · ${siteMetricsDomainLabel(s)}`,
            pct: 50,
          });
          result = await api('/api/gsc/sync', {
            method: 'POST',
            body: JSON.stringify({ siteId: s.id }),
          });
          setProgress({
            label: 'Syncing GSC…',
            detail: `1/1 · ${siteMetricsDomainLabel(s)}`,
            pct: 100,
          });
          await loadSites();
        },
      );
      if (result && !result.ok) {
        await showModal({
          title: 'GSC sync issue',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(result.error || 'Unknown error')}</p>`,
        });
      }
    } catch (error) {
      await showModal({
        title: 'GSC sync failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  if (state.sitesMetricsBusy) setSitesMetricsButtonsDisabled(true);

  document.getElementById('sites-visual-edit')?.addEventListener('click', async () => {
    if (!s.candidateId) return;
    if (s.status === 'paused' || s.status === 'retired') {
      const go = await showModal({
        title: `Site is ${s.status}`,
        confirmLabel: 'Edit anyway',
        bodyHtml: `<p>This listing is <strong>${esc(s.status)}</strong>. Visual edits still write candidate source, then Publish ships if credentials are set.</p>`,
      });
      if (!go) return;
    }
    await openVisualEditor(s.candidateId, { api, esc, showModal });
  });

  document.getElementById('sites-provision-twilio')?.addEventListener('click', async () => {
    if (!s.candidateId) return;
    const areaEl = document.getElementById('sites-twilio-area');
    const areaCode = String(areaEl?.value || '')
      .replace(/\D/g, '')
      .slice(0, 3);
    const ok = await showModal({
      title: 'Provision Twilio ranking number?',
      confirmLabel: 'Buy number',
      bodyHtml: `<p>Buys one US local number (~$1.15/mo + per-minute usage), sets site NAP, and forwards calls to your <code>TWILIO_FORWARD_TO</code> with a whisper.</p>
        <p class="muted small">${esc([s.city, s.state].filter(Boolean).join(', ') || 'geo from site-config')}${
          areaCode ? ` · area ${esc(areaCode)}` : ' · locality search'
        }</p>`,
    });
    if (!ok) return;
    try {
      const result = await api(`/api/sites/${encodeURIComponent(s.id)}/phone/provision-twilio`, {
        method: 'POST',
        body: JSON.stringify({
          confirm: true,
          ...(areaCode.length === 3 ? { areaCode } : {}),
        }),
      });
      const idx = state.sites.findIndex((x) => x.id === s.id);
      if (idx >= 0) state.sites[idx] = result.site;
      else await loadSites();
      renderSitesTable();
      renderSitesDetail();
      await showModal({
        title: 'Number provisioned',
        confirmLabel: 'OK',
        bodyHtml: `<p><strong>${esc(result.provisioned?.phone || result.provisioned?.e164 || '')}</strong> written to site-config.</p>
          <p class="muted small">Next: click <strong>Update site phone number</strong> to Stage → Assemble (and Push if already live).</p>`,
      });
    } catch (error) {
      await showModal({
        title: 'Provision failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>${
          error.twilioSid
            ? `<p class="muted small">Twilio SID: <code>${esc(error.twilioSid)}</code>${
                error.e164 ? ` · ${esc(error.e164)}` : ''
              }. Do not buy again until this SID is resolved in Twilio Console.</p>`
            : ''
        }`,
      });
    }
  });

  document.getElementById('sites-update-site-phone')?.addEventListener('click', async () => {
    if (!s.candidateId || !(s.phoneTracking?.provider === 'twilio' && s.phoneTracking?.twilioSid)) return;
    const alreadyLive = sitePortfolioIsLive(s);
    const ok = await showModal({
      title: 'Update site phone number?',
      confirmLabel: alreadyLive ? 'Prepare + Push' : 'Prepare package',
      bodyHtml: alreadyLive
        ? `<p>Runs Stage → Assemble (with ship when credentials allow) and <strong>Push updates</strong> if ship did not finish — so live CTAs show <code>${esc(s.phoneTracking.e164 || s.phone || '')}</code>.</p>
           <p class="muted small">Can take several minutes.</p>`
        : `<p>Runs Stage → Assemble so the assembled package has the new phone.</p>
           <p class="muted small">This site is not live yet — after Prepare you still need <strong>Website → Run launch</strong> for first go-live (domain / email). Launch is not run from here.</p>`,
    });
    if (!ok) return;
    await publishSitePhoneFromSites(s);
  });

  document.getElementById('sites-forward-renter')?.addEventListener('click', async () => {
    if (!(s.phoneTracking?.provider === 'twilio' && s.phoneTracking?.twilioSid)) return;
    if (!String(s.renter?.phone || '').trim()) return;
    const ok = await showModal({
      title: 'Forward to renter?',
      confirmLabel: 'Update Twilio',
      bodyHtml: `<p>Keeps the same tracking DID <code>${esc(s.phoneTracking.e164 || '')}</code> and dials <code>${esc(s.renter.phone)}</code> instead of your ranking forward.</p>
        <p class="muted small">Sets phone phase to <strong>rented</strong>. Whisper still plays to whoever answers.</p>`,
    });
    if (!ok) return;
    try {
      const result = await api(`/api/sites/${encodeURIComponent(s.id)}/phone/forward-renter`, {
        method: 'POST',
        body: JSON.stringify({ confirm: true }),
      });
      const idx = state.sites.findIndex((x) => x.id === s.id);
      if (idx >= 0) state.sites[idx] = result.site;
      else await loadSites();
      renderSitesTable();
      renderSitesDetail();
      await showModal({
        title: 'Forward updated',
        confirmLabel: 'OK',
        bodyHtml: `<p>Now forwarding to <code>${esc(result.forward?.forwardTo || s.renter.phone)}</code>.</p>`,
      });
    } catch (error) {
      await showModal({
        title: 'Forward failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('sites-view-calls')?.addEventListener('click', () => {
    if (!(s.phoneTracking?.provider === 'twilio' && s.phoneTracking?.e164)) return;
    state.phone.selectedSiteId = s.id;
    state.phone.selectedCallId = null;
    setView('phone');
  });

  document.getElementById('sites-edit-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const patch = {
      status: fd.get('status'),
      targetRentUsd: fd.get('targetRentUsd'),
      actualRentUsd: fd.get('actualRentUsd'),
      paymentMethod: fd.get('paymentMethod') || null,
      paymentMethodNotes: fd.get('paymentMethodNotes'),
      billingCycle: fd.get('billingCycle'),
      contractStart: fd.get('contractStart') || null,
      contractEnd: fd.get('contractEnd') || null,
      nextInvoiceAt: fd.get('nextInvoiceAt') || null,
      notes: fd.get('notes'),
      renter: {
        businessName: fd.get('renterBusinessName'),
        contactName: fd.get('renterContactName'),
        email: fd.get('renterEmail'),
        phone: fd.get('renterPhone'),
        notes: fd.get('renterNotes'),
      },
    };
    try {
      const result = await api(`/api/sites/${encodeURIComponent(s.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      const idx = state.sites.findIndex((x) => x.id === s.id);
      if (idx >= 0) state.sites[idx] = result.site;
      else await loadSites();
      renderSitesTable();
      renderSitesDetail();
    } catch (error) {
      await showModal({
        title: 'Save failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('sites-delete-btn')?.addEventListener('click', async () => {
    const label = s.domain || s.candidateId || s.id;
    const hasTwilio = Boolean(
      s.phoneTracking?.provider === 'twilio' && (s.phoneTracking?.e164 || s.phoneTracking?.twilioSid),
    );
    const layer1 = await showModal({
      title: 'Remove from Launched?',
      confirmLabel: 'Continue',
      danger: true,
      bodyHtml: `<p>You are about to remove <strong>${esc(label)}</strong> from the Launched table.</p>
        <ul>
          <li>Removes this listing from the Sites registry only.</li>
          <li>Does <strong>not</strong> delete the Research candidate, site-config, or the live website.</li>
          <li>Metrics history for this site id may remain on disk (orphaned).</li>
          ${
            hasTwilio
              ? `<li>Twilio DID <code>${esc(s.phoneTracking.e164 || s.phoneTracking.twilioSid)}</code> is <strong>not</strong> released by this action.</li>`
              : ''
          }
        </ul>
        <p class="muted small">Next step asks you to type <code>REMOVE</code> to confirm.</p>`,
    });
    if (!layer1) return;

    const layer2 = await showModal({
      title: 'Type to confirm removal',
      confirmLabel: 'Remove permanently',
      danger: true,
      requireTypedConfirm: 'REMOVE',
      bodyHtml: `<p>Confirm removal of <strong>${esc(label)}</strong> from Launched.</p>
        <p class="muted small">This cannot be undone from the UI (you can re-add the candidate later).</p>`,
    });
    if (!layer2) return;

    try {
      await api(`/api/sites/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      state.selectedSiteId = null;
      await loadSites();
    } catch (error) {
      await showModal({
        title: 'Remove failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });
}

function formatPhoneDuration(sec) {
  const n = Math.max(0, Number(sec) || 0);
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatPhoneWhen(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return String(iso).slice(0, 16);
  }
}

function phoneAnsweredLabel(call) {
  if (call?.answered === true) return { text: 'Answered', cls: 'answered' };
  if (call?.answered === false) return { text: 'Missed', cls: 'missed' };
  const st = String(call?.status || '').toLowerCase();
  if (['completed', 'answered', 'in-progress'].includes(st)) {
    return { text: 'Answered', cls: 'answered' };
  }
  if (['no-answer', 'busy', 'failed', 'canceled', 'cancelled'].includes(st)) {
    return { text: 'Missed', cls: 'missed' };
  }
  return { text: st || 'Unknown', cls: '' };
}

function photoLibStoredNiche() {
  try {
    return String(localStorage.getItem('ops.photoNiche') || '').trim();
  } catch {
    return '';
  }
}

function photoLibStoreNiche(niche) {
  try {
    if (niche) localStorage.setItem('ops.photoNiche', niche);
  } catch {
    /* ignore */
  }
}

function photoLibCurrent() {
  return state.photoLib || {};
}

function photoLibFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function photoLibMasterLabel(g) {
  if (!g) return 'Niche master';
  if (g.kind === 'master') return g.name || `${g.niche || 'Niche'} master`;
  return g.name || g.id;
}

function photoLibSlotCardHtml(slot, { selected = false } = {}) {
  const key = slot.matchKey || slot.key;
  const checked = Boolean(state.photoLib.selectedChecks?.[key]);
  const thumb = slotThumbImg(slot.previewUrl, { role: 'Empty' });
  const grade = slot.matchGrade;
  const matchDot = grade ? imagesMatchDotHtml(grade, slot.matchTip || grade) : '';
  const sourceLabel = imagesSlotSourceLabel(slot);
  const badge = sourceLabel
    ? `<span class="muted" style="font-size:0.75rem">${esc(sourceLabel)}</span>`
    : '';
  return `<div class="image-slot-card photo-slot-card${selected ? ' selected' : ''}" data-match-key="${esc(
    key,
  )}" data-filename="${esc(slot.filename || '')}">
    ${slotCheckHtml({ id: key, checked })}
    <div class="slot-thumb" style="aspect-ratio:16/10;background:#0f172a0d;display:flex;align-items:center;justify-content:center">${thumb}</div>
    <div style="padding:0.45rem 0.55rem;display:flex;flex-direction:column;gap:0.25rem">
      <strong style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem">${matchDot}${esc(
        slot.label || slot.key || key,
      )}</strong>
      ${badge}
      ${slotSourceActionsHtml({
        kind: 'photo',
        viewpointKey: key,
        generateExtra: ` data-match-key="${esc(key)}"`,
        copyHtml: `<button type="button" class="btn btn-sm photo-slot-chatgpt" data-match-key="${esc(key)}" data-tip="Copy a ChatGPT image prompt for this slot">Copy prompt</button>`,
        filesHtml: `<button type="button" class="btn btn-sm photo-slot-repull" data-match-key="${esc(key)}" data-tip="Fetch a different stock photo into this group">Re-pull</button>
        <label class="btn btn-sm" style="cursor:pointer;margin:0" data-tip="Upload a local image into this group">
          Upload
          <input type="file" class="photo-slot-upload" data-match-key="${esc(key)}" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
        </label>
        <button type="button" class="btn btn-sm photo-slot-swap" data-match-key="${esc(key)}" data-filename="${esc(slot.filename || '')}" data-tip="Select this slot, then pick an alternate in Swap">Swap</button>`,
      })}
      ${slotPromptPanelHtml({ kind: 'photo', key })}
    </div>
    ${variantTrayHtml(slot.variants, {
      seeMore: true,
      slotKey: key,
    })}
  </div>`;
}

function photoLibBaCardHtml(pair, { selected = false } = {}) {
  const key = pair.matchKey;
  const checked = Boolean(state.photoLib.selectedChecks?.[key]);
  const label = pair.serviceName
    ? `Before & after — ${pair.serviceName}`
    : `Before & after — home ${pair.pairIndex || 1}`;
  const kind = pair.serviceName || pair.serviceSlug ? 'service' : 'home';
  const slot = baPairAsReviewSlot({
    ...pair,
    matchKey: key,
    slug: pair.serviceSlug || pair.slug,
  });
  const grade = imagesSlotGrade(slot);
  const tip =
    grade === 'upload'
      ? 'Operator upload'
      : pair.matchTip || (slot.missing ? 'No photo in this slot' : '');
  const matchDot = grade ? imagesMatchDotHtml(grade, tip) : '';
  const sourceLabel = imagesSlotSourceLabel(slot);
  const badge = sourceLabel
    ? `<span class="muted" style="font-size:0.75rem">${esc(sourceLabel)}</span>`
    : '';
  return `<div class="image-slot-card photo-slot-card photo-ba-card${selected ? ' selected' : ''}" data-match-key="${esc(
    key,
  )}" data-ba="1" data-ba-kind="${esc(kind)}" data-filename="${esc(pair.before?.filename || '')}" data-pair-index="${esc(String(pair.pairIndex || 1))}" data-service-slug="${esc(pair.serviceSlug || '')}" data-service-name="${esc(pair.serviceName || '')}">
    ${slotCheckHtml({ id: key, checked })}
    <div class="ba-pair-thumbs">
      <figure>${slotThumbImg(pair.beforeUrl, { alt: 'Before' })}<figcaption class="muted">Before</figcaption></figure>
      <figure>${slotThumbImg(pair.afterUrl, { alt: 'After' })}<figcaption class="muted">After</figcaption></figure>
    </div>
    <div style="padding:0.55rem;display:flex;flex-direction:column;gap:0.35rem">
      <strong style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem">${matchDot}${esc(label)}</strong>
      ${badge}
      ${slotSourceActionsHtml({
        kind: 'ba',
        viewpointKey: key,
        generateExtra: ` data-match-key="${esc(key)}"`,
        copyHtml: `<button type="button" class="btn btn-sm photo-ba-copy" data-match-key="${esc(key)}" data-ba-kind="before" data-tip="Copy the current Inside/Outside BEFORE prompt">Copy before</button>
        <button type="button" class="btn btn-sm photo-ba-copy" data-match-key="${esc(key)}" data-ba-kind="after">Copy after</button>`,
        filesHtml: `<label class="btn btn-sm" style="cursor:pointer;margin:0" data-tip="Replaces the live pair; previous goes to the tray. Tray keeps 8; oldest is removed.">
          Import pair
          <input type="file" class="photo-ba-import" data-match-key="${esc(key)}" data-ba-kind="${esc(kind)}" data-service-slug="${esc(pair.serviceSlug || '')}" data-service-name="${esc(pair.serviceName || '')}" data-pair-index="${esc(String(pair.pairIndex || 1))}" accept="image/jpeg,image/png,image/webp" multiple hidden />
        </label>
        <button type="button" class="btn btn-sm photo-slot-swap" data-match-key="${esc(key)}" data-ba="1" data-filename="${esc(pair.before?.filename || '')}">Swap pair</button>`,
      })}
      ${slotPromptPanelHtml({ kind: 'ba', key, pair })}
    </div>
    ${variantTrayHtml(pair.variants, { ba: true, seeMore: true, slotKey: key })}
  </div>`;
}

function renderPhotoLibrary() {
  const list = document.getElementById('photo-lib-list');
  const select = document.getElementById('photo-niche-select');
  const lib = photoLibCurrent();
  if (select) {
    const niches = lib.niches || [];
    select.innerHTML = niches.length
      ? niches
          .map(
            (n) =>
              `<option value="${esc(n)}"${n === lib.niche ? ' selected' : ''}>${esc(n)}</option>`,
          )
          .join('')
      : '<option value="">No niches yet</option>';
  }
  if (!list) return;
  const groups = lib.groups || [];
  if (!groups.length) {
    list.innerHTML =
      '<div class="empty">No groups for this niche yet. Save from Review images, or Prepare preview to seed the master.</div>';
    return;
  }
  list.innerHTML = groups
    .map((g) => {
      const active = g.id === lib.groupId ? ' active' : '';
      const isMaster = g.kind === 'master';
      const badge = isMaster ? '<span class="photo-lib-badge">Master</span>' : '';
      const n = Number(g.slotCount || 0);
      const ba = Number(g.baPairCount || 0);
      const actions = isMaster
        ? `<button type="button" class="btn btn-sm photo-lib-dup" data-group-id="${esc(g.id)}">Duplicate</button>`
        : `<button type="button" class="btn btn-sm photo-lib-rename" data-group-id="${esc(
            g.id,
          )}">Rename</button>
           <button type="button" class="btn btn-sm photo-lib-dup" data-group-id="${esc(g.id)}">Duplicate</button>
           <button type="button" class="btn btn-sm photo-lib-delete" data-group-id="${esc(g.id)}">Delete</button>`;
      return `<div class="photo-lib-row${active}" data-group-id="${esc(g.id)}" role="button" tabindex="0">
        <span class="photo-lib-row-name">${badge}${esc(photoLibMasterLabel(g))}</span>
        <span class="photo-lib-row-meta">${n} photo${n === 1 ? '' : 's'}${ba ? ` · ${ba} BA` : ''}</span>
        <span class="photo-lib-row-actions">${actions}</span>
      </div>`;
    })
    .join('');
}

function countPhotoChecks() {
  const lib = photoLibCurrent();
  const checks = lib.selectedChecks || {};
  let nSlots = 0;
  let nPairs = 0;
  for (const [id, on] of Object.entries(checks)) {
    if (!on) continue;
    if (String(id).startsWith('ba:')) nPairs += 1;
    else nSlots += 1;
  }
  return { nSlots, nPairs };
}

function renderPhotoFluxToolbar() {
  const el = document.getElementById('photo-flux-toolbar');
  if (!el) return;
  const { nSlots, nPairs } = countPhotoChecks();
  const html = fluxToolbarHtml({
    nSlots,
    nPairs,
    flux: photoLibCurrent().flux,
    id: 'photo-flux-toolbar',
  });
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  el.replaceWith(wrap.firstElementChild);
}

async function generatePhotoSelected() {
  const lib = photoLibCurrent();
  if (!lib.groupId) return;
  const checks = lib.selectedChecks || {};
  const slotIds = Object.keys(checks).filter((k) => checks[k] && !k.startsWith('ba:'));
  const baIds = Object.keys(checks).filter((k) => checks[k] && k.startsWith('ba:'));
  const ids = [...slotIds, ...baIds];
  if (!ids.length) return;
  const nSlots = slotIds.length;
  const nPairs = baIds.length;
  const n = nSlots + nPairs;
  if (n >= 8) {
    const ok = await showModal({
      title: 'Generate OpenAI',
      confirmLabel: 'Generate',
      bodyHtml: `<p>${esc(selectedGenerateCostLine(nSlots, nPairs))}</p>`,
    });
    if (!ok) return;
  }
  const photoRoot = document.getElementById('view-photo') || document.getElementById('photo-group-body');
  const prompts = {};
  const baItems = [];
  for (const id of slotIds) {
    const card = photoRoot?.querySelector(reviewCardAttrSel('data-match-key', id));
    prompts[id] = promptBodyFromCard(card);
    beginSlotBusy(id, null, { scroll: false });
  }
  for (const id of baIds) {
    const card = photoRoot?.querySelector(reviewCardAttrSel('data-match-key', id));
    prompts[id] = promptBodyFromCard(card, { pair: true });
    baItems.push({ matchKey: id, ...prompts[id] });
    beginSlotBusy(id, null, { scroll: false });
  }
  paintOpenaiBatchProgress(0, n);
  try {
    const out = await postOpenaiGenerate(
      `/api/photo-groups/${encodeURIComponent(lib.groupId)}/generate-openai`,
      { slotKeys: slotIds, baItems, prompts },
    );
    watchOpenaiJobList(out.jobs || [], { groupId: lib.groupId, candidateId: `photo-group:${lib.groupId}` });
    syncOpenaiGenerateFromSnap(state.lightJobsSnap || { jobs: out.jobs || [] });
  } catch (error) {
    await settleSlotBusy();
    setImagesProgress(false);
    await showModal({
      title: 'Generate failed',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
  }
}

function renderPhotoGroup() {
  const body = document.getElementById('photo-group-body');
  const title = document.getElementById('photo-group-title');
  const sub = document.getElementById('photo-group-sub');
  const lib = photoLibCurrent();
  const view = lib.view;
  if (title) {
    title.textContent = view?.group
      ? photoLibMasterLabel(view.group)
      : lib.niche
        ? 'Select a group'
        : 'No photo groups yet';
  }
  if (sub) {
    sub.textContent = view?.group?.kind === 'master'
      ? 'Niche master — grows on Prepare preview. Load default is best grade, then newest.'
      : 'Named snapshot. Edits write this group only — not the live site.';
  }
  if (!body) return;
  renderPhotoFluxToolbar();
  if (!view?.group) {
    body.innerHTML =
      '<div class="empty">Skipping Photo does not block Content, Accept, stock Pull, or Launch. Named groups save from Review images. The niche master fills in after Prepare preview.</div>';
    return;
  }
  const selected = lib.selectedMatchKey;
  const sections = joinImageSlotSections(view.sections || [], (g) =>
    imageSlotSectionHtml(
      g,
      (g.slots || [])
        .map((s) => photoLibSlotCardHtml(s, { selected: s.matchKey === selected }))
        .join(''),
    ),
  );
  const baHome = [...(view.beforeAfter?.home || [])];
  if (!baHome.length) {
    baHome.push({
      pairIndex: 1,
      matchKey: 'ba:home:1',
      beforeUrl: null,
      afterUrl: null,
    });
  }
  const baSvc = view.beforeAfter?.services || [];
  const baHtml = `<section class="ca-image-slot-section">
      <h4 class="ca-image-slot-section-title">Before &amp; after</h4>
      <div class="ca-image-slot-section-grid">${[
        ...baHome.map((p) => photoLibBaCardHtml(p, { selected: p.matchKey === selected })),
        ...baSvc.map((p) => photoLibBaCardHtml(p, { selected: p.matchKey === selected })),
      ].join('')}</div>
    </section>`;
  body.innerHTML = `<div class="ca-image-slots-sections">${sections}${baHtml}</div>`;
  restoreSlotBusyOverlays();
}

function photoLibSelectedSlotTitle(lib) {
  const key = lib.selectedMatchKey;
  if (!key) return '';
  for (const sec of lib.view?.sections || []) {
    const hit = (sec.slots || []).find((s) => s.matchKey === key);
    if (hit) return hit.label || hit.key || key;
  }
  const ba = [...(lib.view?.beforeAfter?.home || []), ...(lib.view?.beforeAfter?.services || [])];
  const pair = ba.find((p) => p.matchKey === key);
  if (pair) {
    return pair.serviceName
      ? `Before & after — ${pair.serviceName}`
      : `Before & after — home ${pair.pairIndex || 1}`;
  }
  return key;
}

function photoRailSelKey({ fromGroupId, groupId, filename, ba, matchKey } = {}) {
  return `${fromGroupId || groupId || ''}|${filename || ''}|${ba ? '1' : '0'}|${matchKey || ''}`;
}

function renderPhotoSwapRail() {
  const rail = document.getElementById('photo-swap-rail');
  if (!rail) return;
  const lib = photoLibCurrent();
  if (!lib.selectedMatchKey) {
    rail.innerHTML = '<div class="empty">Select a slot, then pick an alternate here.</div>';
    return;
  }
  const title = photoLibSelectedSlotTitle(lib);
  const note = `<p class="muted photo-swap-rail-note">Alternates for “${esc(
    title,
  )}”. Copies into this group only — not the live site.</p>`;
  const photos = lib.rolePhotos || [];
  if (!photos.length) {
    rail.innerHTML = `${note}<div class="empty">No other photos for this slot.</div>`;
    return;
  }
  const selectedKey = photoRailSelKey(lib.selectedRail || {});
  const cards = photos
    .map((p) => {
      const sel = photoRailSelKey({
        fromGroupId: p.groupId,
        filename: p.filename || '',
        ba: p.ba,
        matchKey: p.matchKey,
      });
      const selected = sel === selectedKey ? ' selected' : '';
      const badge = p.kind === 'master' ? '<span class="photo-lib-badge">Master</span> ' : '';
      if (p.ba) {
        return `<button type="button" class="photo-swap-card${selected}" data-from-group="${esc(
          p.groupId,
        )}" data-match-key="${esc(p.matchKey)}" data-ba="1">
          <div class="photo-swap-thumbs">
            ${p.beforeUrl ? `<img src="${esc(p.beforeUrl)}" alt="" />` : '<div class="muted">Before</div>'}
            ${p.afterUrl ? `<img src="${esc(p.afterUrl)}" alt="" />` : '<div class="muted">After</div>'}
          </div>
          <div class="photo-swap-card-meta">${badge}${esc(p.groupName || p.groupId)}</div>
        </button>`;
      }
      const img = p.previewUrl
        ? `<img src="${esc(p.previewUrl)}" alt="" />`
        : '<div class="muted" style="aspect-ratio:16/10;display:flex;align-items:center;justify-content:center">Missing</div>';
      const grade = p.matchGrade ? ` · ${p.matchGrade}` : '';
      return `<button type="button" class="photo-swap-card${selected}" data-from-group="${esc(
        p.groupId,
      )}" data-match-key="${esc(p.matchKey)}" data-filename="${esc(p.filename || '')}">
        ${img}
        <div class="photo-swap-card-meta">${badge}${esc(p.groupName || p.groupId)}${esc(grade)}</div>
      </button>`;
    })
    .join('');
  const useDisabled = lib.selectedRail ? '' : ' disabled';
  rail.innerHTML = `${note}${cards}<button type="button" class="btn primary photo-swap-use"${useDisabled}>Use in this group</button>`;
}

function renderPhotoView() {
  renderPhotoLibrary();
  renderPhotoGroup();
  renderPhotoSwapRail();
}

async function loadPhotoSwapRail() {
  const lib = photoLibCurrent();
  if (!lib.niche || !lib.selectedMatchKey) {
    lib.rolePhotos = [];
    renderPhotoSwapRail();
    return;
  }
  const q = new URLSearchParams({
    niche: lib.niche,
    key: lib.selectedMatchKey,
    exclude: lib.groupId || '',
    filename: lib.selectedFilename || '',
  });
  const data = await api(`/api/photo-library/roles?${q.toString()}`);
  lib.rolePhotos = data.photos || [];
  if (lib.selectedRail) {
    const still = (lib.rolePhotos || []).some((p) => {
      return (
        photoRailSelKey({
          fromGroupId: p.groupId,
          filename: p.filename || '',
          ba: p.ba,
          matchKey: p.matchKey,
        }) === photoRailSelKey(lib.selectedRail)
      );
    });
    if (!still) lib.selectedRail = null;
  }
  renderPhotoSwapRail();
}

async function loadPhotoGroupView() {
  const lib = photoLibCurrent();
  if (!lib.groupId) {
    lib.view = null;
    lib.rolePhotos = [];
    return;
  }
  lib.view = await api(`/api/photo-groups/${encodeURIComponent(lib.groupId)}`);
  rememberOpenaiStatus(lib.view);
  if (lib.view?.openai) lib.flux = lib.view.openai;
  if (lib.selectedMatchKey) {
    await loadPhotoSwapRail();
  }
}

async function loadPhotoView() {
  const lib = photoLibCurrent();
  const preferred =
    lib.niche ||
    photoLibStoredNiche() ||
    state.detail?.photoGroupNiche ||
    state.detail?.siteConfig?.niche ||
    '';
  try {
    const data = await api(
      `/api/photo-library${preferred ? `?niche=${encodeURIComponent(preferred)}` : ''}`,
    );
    lib.niches = data.niches || [];
    const match = lib.niches.find(
      (n) => n.toLowerCase() === String(preferred).toLowerCase(),
    );
    lib.niche = match || lib.niches[0] || '';
    if (lib.niche && lib.niche !== data.niche) {
      const scoped = await api(`/api/photo-library?niche=${encodeURIComponent(lib.niche)}`);
      lib.groups = scoped.groups || [];
    } else {
      lib.groups = data.groups || [];
    }
    photoLibStoreNiche(lib.niche);
    if (!lib.groupId || !lib.groups.some((g) => g.id === lib.groupId)) {
      const master = lib.groups.find((g) => g.kind === 'master');
      lib.groupId = master?.id || lib.groups[0]?.id || null;
    }
    await loadPhotoGroupView();
    renderPhotoView();
  } catch (error) {
    const body = document.getElementById('photo-group-body');
    if (body) {
      body.innerHTML = `<div class="empty">${esc(error.message || 'Could not load Photo')}</div>`;
    }
  }
}

async function photoLibPromptName(title, initial = '') {
  let nameInput = null;
  const ok = await showModal({
    title,
    confirmLabel: 'Save',
    bodyHtml: `<label class="modal-type-confirm-label"><span class="muted small">Name</span>
      <input id="photo-lib-name" class="modal-type-confirm-input" type="text" autocomplete="off" value="${esc(
        initial,
      )}" /></label>`,
    afterOpen: (body) => {
      nameInput = body.querySelector('#photo-lib-name');
      nameInput?.focus();
      nameInput?.select();
    },
  });
  if (!ok) return null;
  return String(nameInput?.value || '').trim();
}

function wireImageZoom() {
  if (document.body.dataset.imgZoomWired === '1') return;
  document.body.dataset.imgZoomWired = '1';
  const peek = document.getElementById('img-peek');
  const box = document.getElementById('img-lightbox');
  const inner = document.getElementById('img-lightbox-inner');
  const prevBtn = document.getElementById('img-lightbox-prev');
  const nextBtn = document.getElementById('img-lightbox-next');
  let peekTimer = null;
  let lbItems = [];
  let lbIndex = 0;
  const hidePeek = () => {
    clearTimeout(peekTimer);
    if (!peek) return;
    peek.onload = null;
    peek.classList.add('hidden');
    peek.classList.remove('img-peek-logo');
    peek.hidden = true;
  };
  const placePeek = (anchor) => {
    if (!peek || peek.hidden || !anchor?.isConnected) return;
    const pad = 8;
    const gap = 8;
    const r = anchor.getBoundingClientRect();
    const w = peek.offsetWidth || 360;
    const h = peek.offsetHeight || 240;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceRight = vw - r.right - gap - pad;
    const spaceLeft = r.left - gap - pad;
    let left =
      spaceLeft >= w || spaceLeft >= spaceRight ? r.left - gap - w : r.right + gap;
    left = Math.min(Math.max(pad, left), Math.max(pad, vw - w - pad));
    let top = r.top;
    top = Math.min(Math.max(pad, top), Math.max(pad, vh - h - pad));
    peek.style.left = `${left}px`;
    peek.style.top = `${top}px`;
  };
  const showPeekFor = (img) => {
    if (!peek || !img) return;
    const src = img.getAttribute('data-zoom-src') || img.src;
    const logoPeek =
      Boolean(img.closest('.logo-map-preview-logo')) || /\/logo\.(svg|png)(\?|$)/i.test(src);
    peek.classList.toggle('img-peek-logo', logoPeek);
    const finish = () => {
      requestAnimationFrame(() => placePeek(img));
    };
    peek.onload = finish;
    peek.src = src;
    peek.classList.remove('hidden');
    peek.hidden = false;
    if (peek.complete) finish();
  };
  const closeLightbox = () => {
    if (!box) return;
    box.classList.add('hidden');
    box.hidden = true;
    if (inner) inner.innerHTML = '';
    lbItems = [];
    if (prevBtn) prevBtn.hidden = true;
    if (nextBtn) nextBtn.hidden = true;
  };
  const showLightboxEntry = (entry) => {
    if (!box || !inner || !entry) return;
    hidePeek();
    const html = entry.ba
      ? `<div class="img-lightbox-ba">${entry.srcs
          .map((src) => `<img src="${esc(src)}" alt="" />`)
          .join('')}</div>`
      : `<img src="${esc(entry.srcs[0] || '')}" alt="" />`;
    inner.innerHTML = `${html}${entry.caption ? `<div class="img-lightbox-caption">${esc(entry.caption)}</div>` : ''}`;
    box.classList.remove('hidden');
    box.hidden = false;
    const many = lbItems.length > 1;
    if (prevBtn) prevBtn.hidden = !many;
    if (nextBtn) nextBtn.hidden = !many;
  };
  const collectLightboxItems = (fromEl) => {
    const section =
      fromEl.closest('#ca-logo-map-previews') ||
      fromEl.closest('.ca-image-slot-section') ||
      fromEl.closest('#ca-image-slots-grid') ||
      fromEl.closest('#photo-group-body');
    const cards = [...(section?.querySelectorAll('.image-slot-card') || [])];
    return cards
      .map((card) => {
        const ba = card.getAttribute('data-ba') === '1';
        const imgs = ba
          ? [...card.querySelectorAll('.ba-pair-thumbs .slot-zoom-img')]
          : [...card.querySelectorAll('.slot-thumb .slot-zoom-img')];
        const srcs = imgs
          .map((i) => i.getAttribute('data-zoom-src') || i.src)
          .filter(Boolean);
        if (!srcs.length) return null;
        return {
          ba,
          srcs,
          caption: card.querySelector('strong')?.textContent || '',
          card,
        };
      })
      .filter(Boolean);
  };
  const openFromImg = (img) => {
    const card = img.closest('.image-slot-card');
    lbItems = collectLightboxItems(img);
    lbIndex = Math.max(
      0,
      lbItems.findIndex((item) => item.card === card),
    );
    showLightboxEntry(lbItems[lbIndex]);
  };
  const stepLightbox = (delta) => {
    if (!lbItems.length || box?.hidden) return;
    lbIndex = (lbIndex + delta + lbItems.length) % lbItems.length;
    showLightboxEntry(lbItems[lbIndex]);
  };
  document.addEventListener(
    'click',
    (ev) => {
      if (ev.target.closest('#img-lightbox-close') || ev.target.id === 'img-lightbox') {
        closeLightbox();
        return;
      }
      if (ev.target.closest('#img-lightbox-prev')) {
        ev.preventDefault();
        stepLightbox(-1);
        return;
      }
      if (ev.target.closest('#img-lightbox-next')) {
        ev.preventDefault();
        stepLightbox(1);
        return;
      }
      const img = ev.target.closest('.slot-zoom-img');
      if (!img || img.classList.contains('slot-zoom-tray')) return;
      ev.preventDefault();
      ev.stopPropagation();
      openFromImg(img);
    },
    true,
  );
  document.addEventListener('mouseover', (ev) => {
    const img = ev.target.closest('.slot-zoom-img, .slot-zoom-tray');
    if (!img || !img.src || box?.hidden === false) {
      if (ev.target.closest('button:not(.slot-variant-use), a, .slot-check')) hidePeek();
      return;
    }
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => {
      if (!peek || !img.isConnected) return;
      showPeekFor(img);
    }, 500);
  });
  document.addEventListener('mouseout', (ev) => {
    if (!ev.target.closest('.slot-zoom-img, .slot-zoom-tray')) return;
    hidePeek();
  });
  document.addEventListener('keydown', (ev) => {
    if (box?.hidden) return;
    if (ev.key === 'Escape') {
      closeLightbox();
      return;
    }
    if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      stepLightbox(-1);
    }
    if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      stepLightbox(1);
    }
  });
}

function wirePhotoUi() {
  const root = document.getElementById('view-photo');
  if (!root || root.dataset.wired === '1') return;
  root.dataset.wired = '1';
  wireSlotPromptEvents(root);

  const applyPhotoSlotShiftRange = (ev) => {
    const slotCheck = resolveSlotCheckInput(ev.target, root);
    if (!slotCheck) return false;
    const id = slotCheck.getAttribute('data-check-id');
    if (!id) return false;
    const lib = photoLibCurrent();
    const visibleKeys = [...root.querySelectorAll('.image-slot-card .slot-check-input')]
      .map((el) => el.getAttribute('data-check-id'))
      .filter(Boolean);
    const checks = { ...(lib.selectedChecks || {}) };
    const ranged = applyShiftRangeCheckboxClick(ev, {
      visibleKeys,
      clickedKey: id,
      anchorKey: state.photoLibCheckAnchor,
      setAnchor: (key) => {
        state.photoLibCheckAnchor = key;
      },
      setSelected: (key, on) => {
        if (on) checks[key] = true;
        else delete checks[key];
      },
    });
    if (!ranged) return false;
    lib.selectedChecks = checks;
    for (const el of root.querySelectorAll('.image-slot-card .slot-check-input')) {
      const key = el.getAttribute('data-check-id');
      el.checked = Boolean(checks[key]);
    }
    renderPhotoFluxToolbar();
    return true;
  };

  root.addEventListener(
    'pointerdown',
    (ev) => {
      if (!ev.shiftKey || state.photoLibCheckAnchor == null) return;
      if (!resolveSlotCheckInput(ev.target, root)) return;
      blockShiftRangePointerDown(ev, state.photoLibCheckAnchor);
      applyPhotoSlotShiftRange(ev);
    },
    true,
  );

  root.addEventListener('change', (ev) => {
    const input = resolveSlotCheckInput(ev.target, root) || ev.target.closest?.('.slot-check-input');
    if (!input || !root.contains(input)) return;
    const id = input.getAttribute('data-check-id');
    if (!id) return;
    const lib = photoLibCurrent();
    if (consumeShiftRangeChange(input, id)) {
      input.checked = Boolean(lib.selectedChecks?.[id]);
      return;
    }
    state.photoLibCheckAnchor = id;
    lib.selectedChecks = { ...(lib.selectedChecks || {}), [id]: input.checked };
    renderPhotoFluxToolbar();
  });

  document.getElementById('photo-niche-select')?.addEventListener('change', async (ev) => {
    const lib = photoLibCurrent();
    lib.niche = ev.target.value;
    lib.groupId = null;
    lib.view = null;
    lib.selectedMatchKey = null;
    lib.selectedRail = null;
    photoLibStoreNiche(lib.niche);
    await loadPhotoView();
  });

  root.addEventListener('click', async (ev) => {
    const slotCheck = resolveSlotCheckInput(ev.target, root);
    if (slotCheck && root.contains(slotCheck)) {
      applyPhotoSlotShiftRange(ev);
      return;
    }
    const lib = photoLibCurrent();
    const unselectAll = ev.target.closest('.flux-unselect-all');
    if (unselectAll && root.contains(unselectAll)) {
      ev.preventDefault();
      ev.stopPropagation();
      if (unselectAll.disabled) return;
      lib.selectedChecks = {};
      root.querySelectorAll('.slot-check-input').forEach((el) => {
        el.checked = false;
      });
      renderPhotoFluxToolbar();
      return;
    }
    const vpBtn = ev.target.closest('[data-ba-viewpoint]');
    if (vpBtn && root.contains(vpBtn)) {
      const group = vpBtn.closest('[data-ba-viewpoint-step]');
      if (!group) return;
      ev.preventDefault();
      const stepKey = group.dataset?.baViewpointStep || '';
      const card = group.closest('.photo-ba-card') || group.closest('.image-slot-card');
      stashSlotPromptDraft(card);
      const next = setBaViewpoint(stepKey, vpBtn.dataset.baViewpoint);
      group.querySelectorAll('[data-ba-viewpoint]').forEach((b) => {
        b.classList.toggle('active', b.dataset.baViewpoint === next);
      });
      fillBaPromptsPanel(card);
      return;
    }

    const openaiBulk = ev.target.closest('.slot-generate-selected-openai');
    if (openaiBulk && root.contains(openaiBulk)) {
      ev.preventDefault();
      const btn = openaiBulk;
      if (!lib.groupId || btn.disabled) return;
      btn.disabled = true;
      try {
        await generatePhotoSelected();
      } finally {
        btn.disabled = false;
        renderPhotoFluxToolbar();
      }
      return;
    }

    const openaiBtn = ev.target.closest('.slot-generate-openai');
    if (
      openaiBtn &&
      root.contains(openaiBtn) &&
      !openaiBtn.classList.contains('slot-generate-selected-openai')
    ) {
      ev.preventDefault();
      if (!lib.groupId || openaiBtn.disabled) return;
      openaiBtn.disabled = true;
      const isPair = openaiBtn.classList.contains('ba') || Boolean(openaiBtn.closest('.photo-ba-card'));
      try {
        const matchKey = openaiBtn.getAttribute('data-match-key') || '';
        const card = openaiBtn.closest('.image-slot-card');
        beginSlotBusy(matchKey, card);
        const url = isPair
          ? `/api/photo-groups/${encodeURIComponent(lib.groupId)}/before-after/generate-openai`
          : `/api/photo-groups/${encodeURIComponent(lib.groupId)}/slots/generate-openai`;
        const out = await postOpenaiGenerate(url, {
          matchKey,
          kind: isPair ? 'pair' : 'photo',
          ...promptBodyFromCard(card, { pair: isPair }),
        });
        watchOpenaiJobList(out.jobs || [{ jobId: out.jobId, slotKey: matchKey, matchKey }], {
          groupId: lib.groupId,
          candidateId: `photo-group:${lib.groupId}`,
        });
        syncOpenaiGenerateFromSnap(state.lightJobsSnap);
      } catch (error) {
        await settleSlotBusy();
        await showModal({
          title: 'Generate failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      } finally {
        openaiBtn.disabled = false;
      }
      return;
    }

    const seeMoreBtn = ev.target.closest('.slot-see-more');
    if (seeMoreBtn && root.contains(seeMoreBtn)) {
      ev.preventDefault();
      const matchKey = seeMoreBtn.getAttribute('data-slot-key');
      if (!matchKey) return;
      if (seeMoreBtn.getAttribute('data-ba') === '1') {
        void openPhotoLibBaSeeMore(matchKey);
      } else {
        void openPhotoLibSeeMore(matchKey);
      }
      return;
    }

    const varBtn = ev.target.closest('.slot-variant-use');
    if (varBtn && root.contains(varBtn)) {
      ev.preventDefault();
      if (!lib.groupId) return;
      const card = varBtn.closest('.image-slot-card');
      const matchKey = card?.getAttribute('data-match-key') || '';
      try {
        if (varBtn.getAttribute('data-pair-id')) {
          await api(
            `/api/photo-groups/${encodeURIComponent(lib.groupId)}/before-after/variants/use`,
            {
              method: 'POST',
              body: JSON.stringify({
                matchKey,
                pairId: varBtn.getAttribute('data-pair-id'),
                beforeFilename: varBtn.getAttribute('data-before-filename') || '',
              }),
            },
          );
          showToast('Restored before/after pair.');
        } else {
          await api(`/api/photo-groups/${encodeURIComponent(lib.groupId)}/slots/variants/use`, {
            method: 'POST',
            body: JSON.stringify({
              matchKey,
              filename: varBtn.getAttribute('data-filename'),
            }),
          });
          showToast('Restored previous photo.');
        }
        await loadPhotoGroupView();
        renderPhotoView();
      } catch (error) {
        await showModal({
          title: 'Swap failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
      return;
    }

    const renameBtn = ev.target.closest('.photo-lib-rename');
    if (renameBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      const id = renameBtn.getAttribute('data-group-id');
      const g = (lib.groups || []).find((x) => x.id === id);
      const name = await photoLibPromptName('Rename photo group', g?.name || '');
      if (!name) return;
      try {
        await api(`/api/photo-groups/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        });
        await loadPhotoView();
        showToast(`Renamed to “${name}”.`);
      } catch (error) {
        await showModal({
          title: 'Rename failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
      return;
    }

    const dupBtn = ev.target.closest('.photo-lib-dup');
    if (dupBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      const id = dupBtn.getAttribute('data-group-id');
      const g = (lib.groups || []).find((x) => x.id === id);
      const name = await photoLibPromptName(
        'Duplicate photo group',
        `${photoLibMasterLabel(g)} copy`,
      );
      if (!name) return;
      try {
        const result = await api(`/api/photo-groups/${encodeURIComponent(id)}/duplicate`, {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
        lib.groupId = result.group?.id || lib.groupId;
        await loadPhotoView();
        showToast(`Duplicated “${result.group?.name || name}”.`);
      } catch (error) {
        await showModal({
          title: 'Duplicate failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
      return;
    }

    const delBtn = ev.target.closest('.photo-lib-delete');
    if (delBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      const id = delBtn.getAttribute('data-group-id');
      const g = (lib.groups || []).find((x) => x.id === id);
      const ok = await showModal({
        title: 'Delete photo group?',
        confirmLabel: 'Delete',
        danger: true,
        bodyHtml: `<p>Delete <strong>${esc(
          g?.name || id,
        )}</strong>? Sites that had this group attached will be detached (Skip / Image queries / master still work).</p>`,
      });
      if (!ok) return;
      try {
        await api(`/api/photo-groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (lib.groupId === id) lib.groupId = null;
        await loadPhotoView();
        showToast('Photo group deleted.');
      } catch (error) {
        await showModal({
          title: 'Delete failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
      return;
    }

    const row = ev.target.closest('.photo-lib-row');
    if (row && !ev.target.closest('.photo-lib-row-actions')) {
      const id = row.getAttribute('data-group-id');
      if (id && id !== lib.groupId) {
        lib.groupId = id;
        lib.selectedMatchKey = null;
        lib.selectedFilename = null;
        lib.selectedRail = null;
        lib.rolePhotos = [];
        await loadPhotoGroupView();
        renderPhotoView();
      }
      return;
    }

    const swapBtn = ev.target.closest('.photo-slot-swap');
    if (swapBtn) {
      ev.preventDefault();
      lib.selectedMatchKey = swapBtn.getAttribute('data-match-key') || '';
      lib.selectedFilename = swapBtn.getAttribute('data-filename') || '';
      lib.selectedRail = null;
      try {
        await loadPhotoSwapRail();
        renderPhotoGroup();
      } catch (error) {
        await showModal({
          title: 'Swap rail failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
      return;
    }

    const useBtn = ev.target.closest('.photo-swap-use');
    if (useBtn) {
      ev.preventDefault();
      if (!lib.groupId || !lib.selectedRail) return;
      useBtn.disabled = true;
      try {
        await api(`/api/photo-groups/${encodeURIComponent(lib.groupId)}/slots/swap`, {
          method: 'POST',
          body: JSON.stringify({
            matchKey: lib.selectedRail.matchKey,
            fromGroupId: lib.selectedRail.fromGroupId,
            filename: lib.selectedRail.filename || '',
            ba: Boolean(lib.selectedRail.ba),
          }),
        });
        lib.selectedRail = null;
        await loadPhotoGroupView();
        renderPhotoView();
        showToast('Copied into this group.');
      } catch (error) {
        await showModal({
          title: 'Swap failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      } finally {
        useBtn.disabled = false;
      }
      return;
    }

    const railCard = ev.target.closest('.photo-swap-card');
    if (railCard) {
      ev.preventDefault();
      lib.selectedRail = {
        fromGroupId: railCard.getAttribute('data-from-group') || '',
        matchKey: railCard.getAttribute('data-match-key') || '',
        filename: railCard.getAttribute('data-filename') || '',
        ba: railCard.getAttribute('data-ba') === '1',
      };
      renderPhotoSwapRail();
      return;
    }

    const card = ev.target.closest('.photo-slot-card');
    if (card && !ev.target.closest('button, a, label, input')) {
      lib.selectedMatchKey = card.getAttribute('data-match-key') || '';
      lib.selectedFilename = card.getAttribute('data-filename') || '';
      lib.selectedRail = null;
      try {
        await loadPhotoSwapRail();
        renderPhotoGroup();
      } catch {
        renderPhotoGroup();
      }
      return;
    }

    const repullBtn = ev.target.closest('.photo-slot-repull');
    if (repullBtn) {
      ev.preventDefault();
      if (!lib.groupId) return;
      const matchKey = repullBtn.getAttribute('data-match-key');
      repullBtn.disabled = true;
      beginSlotBusy(matchKey, repullBtn.closest('.image-slot-card'));
      try {
        await api(`/api/photo-groups/${encodeURIComponent(lib.groupId)}/slots/repull`, {
          method: 'POST',
          body: JSON.stringify({ matchKey }),
        });
        await loadPhotoGroupView();
        renderPhotoView();
        await settleSlotBusy();
        showToast('Re-pulled into this group.');
      } catch (error) {
        await settleSlotBusy();
        await showModal({
          title: 'Re-pull failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      } finally {
        repullBtn.disabled = false;
      }
      return;
    }

    const gptBtn = ev.target.closest('.photo-slot-chatgpt');
    if (gptBtn) {
      ev.preventDefault();
      if (!lib.groupId) return;
      const matchKey = gptBtn.getAttribute('data-match-key');
      try {
        const card = gptBtn.closest('.image-slot-card');
        const fromPanel = promptBodyFromCard(card);
        let text = fromPanel.prompt || '';
        if (!text) {
          const viewpoint = fromPanel.viewpoint || getBaViewpoint(matchKey);
          const data = await api(
            `/api/photo-groups/${encodeURIComponent(lib.groupId)}/slots/${encodeURIComponent(
              matchKey,
            )}/chatgpt-prompt?viewpoint=${encodeURIComponent(viewpoint)}`,
          );
          text = data.prompt || '';
        }
        await navigator.clipboard.writeText(text);
        showToast('ChatGPT prompt copied.');
      } catch (error) {
        await showModal({
          title: 'Copy prompt failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
      return;
    }

    const baCopy = ev.target.closest('.photo-ba-copy');
    if (baCopy) {
      ev.preventDefault();
      const kind = baCopy.getAttribute('data-ba-kind');
      const key = baCopy.getAttribute('data-match-key') || '';
      if (!lib.groupId) return;
      try {
        const card = baCopy.closest('.image-slot-card');
        const fromPanel = promptBodyFromCard(card, { pair: true });
        let text = kind === 'after' ? fromPanel.after : fromPanel.before;
        if (!text) {
          const params = new URLSearchParams({
            matchKey: key,
            viewpoint: fromPanel.viewpoint || getBaViewpoint(key),
          });
          const prompts = await api(
            `/api/photo-groups/${encodeURIComponent(lib.groupId)}/before-after-prompts?${params}`,
          );
          text = prompts[kind] || prompts.pair || '';
        }
        await navigator.clipboard.writeText(text);
        showToast(`${kind === 'before' ? 'Before' : 'After'} prompt copied.`);
      } catch (error) {
        await showModal({
          title: 'Copy failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
    }
  });

  root.addEventListener('change', async (ev) => {
    const lib = photoLibCurrent();
    const upload = ev.target.closest('.photo-slot-upload');
    if (upload && upload.tagName === 'INPUT') {
      const file = upload.files?.[0];
      const matchKey = upload.getAttribute('data-match-key');
      if (!file || !matchKey || !lib.groupId) {
        upload.value = '';
        return;
      }
      try {
        const dataUrl = await photoLibFileDataUrl(file);
        await api(`/api/photo-groups/${encodeURIComponent(lib.groupId)}/slots/upload`, {
          method: 'POST',
          body: JSON.stringify({
            matchKey,
            dataUrl,
            alt: file.name.replace(/\.[^.]+$/, ''),
          }),
        });
        await loadPhotoGroupView();
        renderPhotoView();
        showToast('Uploaded into this group.');
      } catch (error) {
        await showModal({
          title: 'Upload failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      } finally {
        upload.value = '';
      }
      return;
    }

    const baImport = ev.target.closest('.photo-ba-import');
    if (baImport && baImport.tagName === 'INPUT') {
      const files = [...(baImport.files || [])].slice(0, 2);
      if (files.length < 2 || !lib.groupId) {
        baImport.value = '';
        if (files.length && files.length < 2) {
          await showModal({
            title: 'Need two images',
            confirmLabel: 'OK',
            hideCancel: true,
            bodyHtml: '<p>Choose a Before image and an After image.</p>',
          });
        }
        return;
      }
      try {
        const [beforeDataUrl, afterDataUrl] = await Promise.all(
          files.map((f) => photoLibFileDataUrl(f)),
        );
        await api(`/api/photo-groups/${encodeURIComponent(lib.groupId)}/before-after/import`, {
          method: 'POST',
          body: JSON.stringify({
            kind: baImport.getAttribute('data-ba-kind') || 'home',
            pairIndex: Number(baImport.getAttribute('data-pair-index') || 1),
            serviceSlug: baImport.getAttribute('data-service-slug') || '',
            serviceName: baImport.getAttribute('data-service-name') || '',
            beforeDataUrl,
            afterDataUrl,
          }),
        });
        await loadPhotoGroupView();
        renderPhotoView();
        showToast('Imported before/after pair.');
      } catch (error) {
        await showModal({
          title: 'Import failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      } finally {
        baImport.value = '';
      }
    }
  });
}

async function loadPhoneView() {
  const syncStatus = document.getElementById('phone-sync-status');
  if (syncStatus) {
    syncStatus.hidden = false;
    syncStatus.textContent = 'Syncing from Twilio…';
  }
  let syncError = null;
  try {
    const syncBody = {};
    if (state.phone.selectedSiteId) syncBody.siteId = state.phone.selectedSiteId;
    const syncRes = await api('/api/phone/sync', {
      method: 'POST',
      body: JSON.stringify(syncBody),
    });
    if (syncStatus) {
      const n = Number(syncRes.upserted || 0);
      const q = Number(syncRes.summarizedQueued || 0);
      syncStatus.textContent =
        n || q
          ? `Synced ${n} call${n === 1 ? '' : 's'} from Twilio${q ? ` · ${q} summar${q === 1 ? 'y' : 'ies'} queued` : ''}`
          : 'Synced with Twilio — no new calls in range';
    }
  } catch (error) {
    syncError = error?.message || String(error);
    if (syncStatus) {
      syncStatus.textContent = `Sync skipped: ${syncError}`;
    }
  }

  try {
    const sitesRes = await api('/api/phone/sites');
    state.phone.sites = sitesRes.sites || [];
    const q = state.phone.selectedSiteId
      ? `?siteId=${encodeURIComponent(state.phone.selectedSiteId)}`
      : '';
    const callsRes = await api(`/api/phone/calls${q}`);
    state.phone.calls = callsRes.calls || [];
    state.phone.stats = callsRes.stats || sitesRes.stats || null;
  } catch (error) {
    if (syncStatus && !syncError) {
      syncStatus.hidden = false;
      syncStatus.textContent = error?.message || 'Failed to load calls';
    }
    throw error;
  }

  renderPhoneSites();
  renderPhoneStats();
  renderPhoneCalls();
  renderPhoneDetail();
}

function filteredPhoneSites() {
  const text = String(state.phone.filterText || '')
    .trim()
    .toLowerCase();
  const phase = String(state.phone.filterPhase || '').trim();
  return (state.phone.sites || []).filter((s) => {
    if (phase && s.phase !== phase) return false;
    if (!text) return true;
    const hay = `${s.businessName || ''} ${s.niche || ''} ${s.e164 || ''} ${s.city || ''} ${s.state || ''}`.toLowerCase();
    return hay.includes(text);
  });
}

function renderPhoneSites() {
  const root = document.getElementById('phone-sites-list');
  if (!root) return;
  const rows = filteredPhoneSites();
  const allActive = !state.phone.selectedSiteId;
  const parts = [
    `<button type="button" class="phone-site-row${allActive ? ' active' : ''}" data-phone-site="">
      <span class="phone-site-name">All sites</span>
      <span class="phone-site-meta muted small">Portfolio scope</span>
    </button>`,
  ];
  for (const s of rows) {
    const st = s.stats || {};
    const active = state.phone.selectedSiteId === s.id ? ' active' : '';
    parts.push(`<button type="button" class="phone-site-row${active}" data-phone-site="${esc(s.id)}">
      <span class="phone-site-name">${esc(s.businessName || s.niche || s.id)}</span>
      <span class="phone-site-meta muted small">${esc(s.e164 || '—')} · ${esc(s.phase || '—')}</span>
      <span class="phone-site-meta muted small">${Number(st.answered || 0)} answered · ${Number(st.missed || 0)} missed</span>
    </button>`);
  }
  if (!rows.length) {
    parts.push(`<p class="muted small" style="padding:0.5rem">No Twilio DIDs yet — provision from Launched.</p>`);
  }
  root.innerHTML = parts.join('');
  root.querySelectorAll('[data-phone-site]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-phone-site') || '';
      state.phone.selectedSiteId = id || null;
      state.phone.selectedCallId = null;
      try {
        await loadPhoneView();
      } catch (error) {
        console.warn(error);
      }
    });
  });
}

function renderPhoneStats() {
  const strip = document.getElementById('phone-stats-strip');
  const label = document.getElementById('phone-scope-label');
  if (label) {
    if (!state.phone.selectedSiteId) label.textContent = 'All sites';
    else {
      const site = (state.phone.sites || []).find((s) => s.id === state.phone.selectedSiteId);
      label.textContent = site?.businessName || site?.niche || state.phone.selectedSiteId;
    }
  }
  if (!strip) return;
  const st = state.phone.stats || {};
  const rate = st.answerRate != null ? `${Math.round(Number(st.answerRate) * 100)}%` : '—';
  strip.innerHTML = `
    <span>Answered <strong>${Number(st.answered || 0)}</strong></span>
    <span>Missed <strong>${Number(st.missed || 0)}</strong></span>
    <span>Answer rate <strong>${esc(rate)}</strong></span>
    <span>Talk min <strong>${Number(st.talkMinutes || 0)}</strong></span>
    <span>Summaries <strong>${Number(st.withSummary || 0)}</strong></span>
  `;
}

function renderPhoneCalls() {
  const tbody = document.querySelector('#phone-calls-table tbody');
  const empty = document.getElementById('phone-calls-empty');
  if (!tbody) return;
  const calls = state.phone.calls || [];
  if (empty) empty.classList.toggle('hidden', calls.length > 0);
  tbody.innerHTML = calls
    .map((c) => {
      const chip = phoneAnsweredLabel(c);
      const when = formatPhoneWhen(c.endedAt || c.startedAt || c.createdAt || c.updatedAt);
      const active = state.phone.selectedCallId === c.id || state.phone.selectedCallId === c.callSid;
      return `<tr data-call-id="${esc(c.id || c.callSid)}" class="${active ? 'active' : ''}">
        <td>${esc(when)}</td>
        <td>${esc(c.from || '—')}</td>
        <td><span class="phone-status-chip ${chip.cls}">${esc(chip.text)}</span></td>
        <td>${esc(formatPhoneDuration(c.durationSec || c.recordingDurationSec))}</td>
        <td>${c.summary ? '✓' : c.error ? '!' : '—'}</td>
      </tr>`;
    })
    .join('');
  tbody.querySelectorAll('tr[data-call-id]').forEach((tr) => {
    tr.addEventListener('click', () => {
      state.phone.selectedCallId = tr.getAttribute('data-call-id');
      renderPhoneCalls();
      renderPhoneDetail();
    });
  });
  enableTableColumnResize(document.getElementById('phone-calls-table'));
}

function renderPhoneDetail() {
  const empty = document.getElementById('phone-empty-detail');
  const body = document.getElementById('phone-detail-body');
  if (!empty || !body) return;
  syncPhoneDetailVisibility();
  const call = (state.phone.calls || []).find(
    (c) => c.id === state.phone.selectedCallId || c.callSid === state.phone.selectedCallId,
  );
  if (!call) {
    empty.classList.remove('hidden');
    body.classList.add('hidden');
    body.innerHTML = '';
    return;
  }
  empty.classList.add('hidden');
  body.classList.remove('hidden');
  const chip = phoneAnsweredLabel(call);
  const site = (state.phone.sites || []).find((s) => s.id === call.siteId);
  const hasRec = Boolean(call.recordingSid || call.recordingUrl);
  body.innerHTML = `
    <div class="sites-detail-head">
      <h2>${esc(formatPhoneWhen(call.endedAt || call.startedAt || call.createdAt))}</h2>
      <p class="muted small">${esc(call.from || '—')} → ${esc(call.to || '—')}</p>
    </div>
    <p><span class="phone-status-chip ${chip.cls}">${esc(chip.text)}</span>
      · ${esc(formatPhoneDuration(call.durationSec || call.recordingDurationSec))}
      ${call.forwardTo ? ` · forward ${esc(call.forwardTo)}` : ''}</p>
    ${
      hasRec
        ? `<audio controls preload="metadata" src="/api/phone/calls/${encodeURIComponent(call.id || call.callSid)}/recording"></audio>`
        : `<p class="muted small">No recording on this call.</p>`
    }
    <h3>Summary</h3>
    ${
      call.summary
        ? `<p class="phone-summary">${esc(call.summary)}</p>`
        : `<p class="muted small">${call.error ? esc(call.error) : 'No summary yet — appears a few minutes after hangup when recording + webhook are configured.'}</p>
           <button type="button" class="btn" id="phone-resummarize" ${hasRec ? '' : 'disabled'}>Generate summary</button>`
    }
    <details>
      <summary class="muted small">Transcript</summary>
      <pre class="phone-transcript">${esc(call.transcript || '—')}</pre>
    </details>
    <div class="narrative-actions" style="margin-top:0.75rem">
      ${
        call.siteId
          ? `<button type="button" class="btn" id="phone-open-site">Open site in Launched</button>`
          : ''
      }
    </div>
  `;
  document.getElementById('phone-open-site')?.addEventListener('click', () => {
    if (!call.siteId) return;
    state.selectedSiteId = call.siteId;
    setView('launched-sites');
  });
  document.getElementById('phone-resummarize')?.addEventListener('click', async () => {
    try {
      const result = await api(`/api/phone/calls/${encodeURIComponent(call.id || call.callSid)}/summarize`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const idx = state.phone.calls.findIndex(
        (c) => c.id === call.id || c.callSid === call.callSid,
      );
      if (idx >= 0 && result.call) state.phone.calls[idx] = result.call;
      else await loadPhoneView();
      renderPhoneCalls();
      renderPhoneDetail();
      renderPhoneStats();
    } catch (error) {
      await showModal({
        title: 'Summary failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });
}

function wirePhoneUi() {
  document.getElementById('phone-refresh-btn')?.addEventListener('click', () => {
    loadPhoneView().catch(() => {});
  });
  document.getElementById('phone-filter-text')?.addEventListener('input', (e) => {
    state.phone.filterText = e.target.value;
    renderPhoneSites();
  });
  document.getElementById('phone-filter-phase')?.addEventListener('change', (e) => {
    state.phone.filterPhase = e.target.value;
    renderPhoneSites();
  });
}

function wireSitesUi() {
  document.getElementById('sites-refresh-btn')?.addEventListener('click', () => {
    if (state.sitesMetricsBusy) return;
    loadSites().catch(() => {});
  });
  document.getElementById('sites-filter-text')?.addEventListener('input', (e) => {
    state.siteFilters.text = e.target.value;
    renderSitesTable();
  });
  document.getElementById('sites-filter-status')?.addEventListener('change', (e) => {
    state.siteFilters.status = e.target.value;
    renderSitesTable();
  });
  document.getElementById('sites-filter-state')?.addEventListener('change', (e) => {
    state.siteFilters.state = e.target.value;
    renderSitesTable();
  });
  document.getElementById('sites-add-btn')?.addEventListener('click', async () => {
    if (state.sitesMetricsBusy) return;
    const candidateId = window.prompt('Candidate id to add to Sites:');
    if (!candidateId?.trim()) return;
    try {
      const result = await api('/api/sites', {
        method: 'POST',
        body: JSON.stringify({ candidateId: candidateId.trim() }),
      });
      await loadSites();
      state.selectedSiteId = result.site?.id || null;
      renderSitesTable();
      renderSitesDetail();
    } catch (error) {
      await showModal({
        title: 'Add failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('sites-gsc-connect-btn')?.addEventListener('click', async () => {
    if (state.sitesMetricsBusy || state.gscStatus?.connected) return;
    try {
      const started = await api('/api/gsc/oauth/start');
      startSitesGscConnectWait();
      window.open(started.authUrl, 'rover-gsc-oauth', 'width=520,height=720');
    } catch (error) {
      clearSitesGscConnectWait();
      setSitesMetricsProgress({ visible: false, label: '', detail: '', pct: null });
      setSitesMetricsButtonsDisabled(false);
      await showModal({
        title: 'Connect GSC failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>
          <p class="muted small">Add OAuth client id/secret to <code>.env</code>. Redirect URI: <code>http://127.0.0.1:8787/api/gsc/oauth/callback</code></p>`,
      });
    }
  });

  window.addEventListener('message', (event) => {
    if (event?.data?.type === 'rover-gsc-connected') {
      finishSitesGscConnectWait({ connected: true }).catch(() => {});
    }
  });

  document.getElementById('sites-gsc-sync-btn')?.addEventListener('click', async () => {
    if (state.sitesMetricsBusy) return;
    try {
      await syncSitesGscSequential();
    } catch (error) {
      await showModal({
        title: 'GSC sync failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('sites-rank-sync-btn')?.addEventListener('click', async () => {
    if (state.sitesMetricsBusy) return;
    const go = await showModal({
      title: 'Check ranks for all sites?',
      confirmLabel: 'Run Standard queue',
      bodyHtml: `<p>Uses DataForSEO <strong>Standard</strong> organic SERP (depth 20) for up to 5 keywords per live/building site. Progress shows each site; can take several minutes.</p>`,
    });
    if (!go) return;
    try {
      await checkSitesRanksSequential();
    } catch (error) {
      await showModal({
        title: 'Rank sync failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });
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
  if (el) {
    if (census.ok) {
      const n = Number(census.placeCount);
      const places = Number.isFinite(n) ? n.toLocaleString() : String(census.placeCount ?? '');
      el.textContent = `Census ok · ${places} places`;
      setElementTip(el, census.path || '');
      el.classList.remove('warn-text');
    } else {
      el.textContent = `Census missing — set CENSUS_POP_CSV`;
      setElementTip(el, census.error || census.path || '');
      el.classList.add('warn-text');
    }
  }
  bindDiscoveryPlaceAutofill();
  bindDiscoveryUseMap();
}

function normalizeDiscoveryStateInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const states = state.discoveryPresets?.states || [];
  const hit = states.find(
    (st) =>
      String(st.name || '').toLowerCase() === s.toLowerCase() ||
      String(st.abbr || '').toLowerCase() === s.toLowerCase(),
  );
  return hit ? hit.abbr : s.toUpperCase().slice(0, 2);
}

function splitDiscoveryCities(raw) {
  return String(raw || '')
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Discovery niches textarea: newlines / semicolons (keep commas inside names). */
function parseDiscoveryNicheList(raw) {
  const out = [];
  const seen = new Set();
  for (const part of String(raw || '').split(/[\n;]+/)) {
    const n = part.trim();
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

function joinDiscoveryCities(parts) {
  return parts.map((s) => String(s || '').trim()).filter(Boolean).join(', ');
}

function hideSuggestList(listEl) {
  if (!listEl) return;
  listEl.innerHTML = '';
  listEl.classList.add('hidden');
  listEl.hidden = true;
}

/** Stop Chrome history/autofill chips from covering custom geo suggest lists. */
function disableBrowserGeoAutofill(input) {
  if (!input || input.dataset.geoAutofillBound === '1') return;
  input.dataset.geoAutofillBound = '1';
  input.setAttribute('autocomplete', 'new-password');
  input.setAttribute('readonly', 'readonly');
  input.addEventListener('focus', () => {
    // Unlock only after Chrome has seen readonly on focus (no mousedown unlock).
    setTimeout(() => {
      input.removeAttribute('readonly');
    }, 0);
  });
  input.addEventListener('blur', () => {
    input.setAttribute('readonly', 'readonly');
  });
}

function showSuggestList(listEl, items) {
  if (!listEl) return;
  if (!items.length) {
    hideSuggestList(listEl);
    return;
  }
  listEl.innerHTML = items
    .map(
      (it, i) =>
        `<li role="option" data-value="${esc(it.value)}" aria-selected="${i === 0 ? 'true' : 'false'}">${esc(
          it.label,
        )}</li>`,
    )
    .join('');
  listEl.classList.remove('hidden');
  listEl.hidden = false;
}

function moveSuggestSelection(listEl, delta) {
  const opts = [...(listEl?.querySelectorAll('li[role="option"]') || [])];
  if (!opts.length) return;
  let idx = opts.findIndex((el) => el.getAttribute('aria-selected') === 'true');
  if (idx < 0) idx = 0;
  opts[idx].setAttribute('aria-selected', 'false');
  idx = (idx + delta + opts.length) % opts.length;
  opts[idx].setAttribute('aria-selected', 'true');
  opts[idx].scrollIntoView({ block: 'nearest' });
}

function selectedSuggestValue(listEl) {
  const el = listEl?.querySelector('li[aria-selected="true"]');
  return el ? el.getAttribute('data-value') || '' : '';
}

function bindDiscoveryPlaceAutofill() {
  if (bindDiscoveryPlaceAutofill._done) return;
  bindDiscoveryPlaceAutofill._done = true;

  const stateInput = document.getElementById('discovery-state');
  const citiesInput = document.getElementById('discovery-cities');
  const stateSuggest = document.getElementById('discovery-state-suggest');
  const citySuggest = document.getElementById('discovery-city-suggest');
  if (!stateInput || !citiesInput || !stateSuggest || !citySuggest) return;

  disableBrowserGeoAutofill(stateInput);
  disableBrowserGeoAutofill(citiesInput);

  const normalizeStateField = () => {
    const next = normalizeDiscoveryStateInput(stateInput.value);
    if (next !== stateInput.value) stateInput.value = next;
  };

  const refreshStateSuggestions = () => {
    const q = String(stateInput.value || '').trim().toLowerCase();
    const states = state.discoveryPresets?.states || [];
    const items = states
      .filter((st) => {
        if (!q) return true;
        return (
          String(st.abbr || '').toLowerCase().startsWith(q) ||
          String(st.name || '').toLowerCase().startsWith(q) ||
          String(st.name || '').toLowerCase().includes(q)
        );
      })
      .map((st) => ({ value: st.abbr, label: `${st.abbr} — ${st.name}` }));
    showSuggestList(stateSuggest, items);
  };

  const pickState = (abbr) => {
    if (!abbr) return;
    stateInput.value = abbr;
    hideSuggestList(stateSuggest);
    normalizeStateField();
  };

  stateInput.addEventListener('focus', refreshStateSuggestions);
  stateInput.addEventListener('input', refreshStateSuggestions);
  stateInput.addEventListener('keydown', (event) => {
    if (stateSuggest.hidden) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSuggestSelection(stateSuggest, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSuggestSelection(stateSuggest, -1);
    } else if (event.key === 'Enter') {
      const v = selectedSuggestValue(stateSuggest);
      if (v) {
        event.preventDefault();
        pickState(v);
      }
    } else if (event.key === 'Escape') {
      hideSuggestList(stateSuggest);
    }
  });
  stateSuggest.addEventListener('mousedown', (event) => {
    const li = event.target?.closest?.('li[data-value]');
    if (!li) return;
    event.preventDefault();
    pickState(li.getAttribute('data-value'));
  });
  stateInput.addEventListener('blur', () => {
    setTimeout(() => {
      hideSuggestList(stateSuggest);
      normalizeStateField();
    }, 120);
  });

  let cityTimer = null;
  let cityReq = 0;
  let cityPrefix = [];

  const refreshCitySuggestions = async () => {
    const raw = citiesInput.value;
    const trailingSep = /[,|]\s*$/.test(raw);
    const parts = splitDiscoveryCities(raw);
    const q = trailingSep ? '' : String(parts[parts.length - 1] || '');
    cityPrefix = trailingSep ? parts : parts.slice(0, -1);
    const st = normalizeDiscoveryStateInput(stateInput.value);
    const reqId = ++cityReq;
    try {
      const qs = new URLSearchParams({ q, state: st, limit: '40' });
      const data = await api(`/api/discovery/places?${qs.toString()}`);
      if (reqId !== cityReq) return;
      const places = data?.places || [];
      showSuggestList(
        citySuggest,
        places.map((p) => ({
          value: p.city,
          label: st ? p.city : `${p.city}, ${p.state}`,
        })),
      );
    } catch {
      if (reqId !== cityReq) return;
      hideSuggestList(citySuggest);
    }
  };

  const pickCity = (city) => {
    if (!city) return;
    citiesInput.value = joinDiscoveryCities([...cityPrefix, city]);
    hideSuggestList(citySuggest);
    citiesInput.focus();
  };

  citiesInput.addEventListener('focus', () => {
    refreshCitySuggestions().catch(() => {});
  });
  citiesInput.addEventListener('input', () => {
    clearTimeout(cityTimer);
    cityTimer = setTimeout(() => {
      refreshCitySuggestions().catch(() => {});
    }, 200);
  });
  citiesInput.addEventListener('keydown', (event) => {
    if (citySuggest.hidden) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSuggestSelection(citySuggest, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSuggestSelection(citySuggest, -1);
    } else if (event.key === 'Enter') {
      const v = selectedSuggestValue(citySuggest);
      if (v) {
        event.preventDefault();
        pickCity(v);
      }
    } else if (event.key === 'Escape') {
      hideSuggestList(citySuggest);
    }
  });
  citySuggest.addEventListener('mousedown', (event) => {
    const li = event.target?.closest?.('li[data-value]');
    if (!li) return;
    event.preventDefault();
    pickCity(li.getAttribute('data-value'));
  });
  citiesInput.addEventListener('blur', () => {
    setTimeout(() => hideSuggestList(citySuggest), 120);
  });

  document.addEventListener('click', (event) => {
    if (!event.target?.closest?.('.suggest-wrap')) {
      hideSuggestList(stateSuggest);
      hideSuggestList(citySuggest);
    }
  });
}

function closeDiscoveryCitiesMap() {
  if (discoveryCitiesMount) {
    try {
      discoveryCitiesMount.destroy();
    } catch {
      /* ignore */
    }
    discoveryCitiesMount = null;
  }
  setDiscoveryTableMapMode(false);
  const controls = document.getElementById('discovery-map-controls');
  const useBtn = document.getElementById('discovery-use-map');
  const doneBtn = document.getElementById('discovery-map-done');
  if (controls) {
    controls.classList.add('hidden');
    controls.innerHTML = '';
  }
  if (useBtn) useBtn.classList.remove('hidden');
  if (doneBtn) doneBtn.classList.add('hidden');
}

function syncDiscoveryCitiesFromMap(selectedCities) {
  const citiesInput = document.getElementById('discovery-cities');
  if (!citiesInput) return;
  const names = (selectedCities || []).map((c) => (typeof c === 'string' ? c : c?.name)).filter(Boolean);
  citiesInput.value = joinDiscoveryCities(names);
}

function readDiscoveryPackPopRange() {
  const minEl = document.getElementById('discovery-min-pop');
  const maxEl = document.getElementById('discovery-max-pop');
  const minPop = Number(minEl?.value);
  const maxPop = Number(maxEl?.value);
  return {
    minPop: Number.isFinite(minPop) ? minPop : 70000,
    maxPop: Number.isFinite(maxPop) ? maxPop : 200000,
  };
}

async function openDiscoveryCitiesMap() {
  const stateInput = document.getElementById('discovery-state');
  const citiesInput = document.getElementById('discovery-cities');
  const mapHost = document.getElementById('discovery-map-canvas');
  const controlsHost = document.getElementById('discovery-map-controls');
  const useBtn = document.getElementById('discovery-use-map');
  const doneBtn = document.getElementById('discovery-map-done');
  if (!mapHost || !controlsHost) return;

  const st = normalizeDiscoveryStateInput(stateInput?.value || '');
  if (stateInput && st) stateInput.value = st;
  if (!st) {
    showToast('Pick a State first to use the map.', { tone: 'warn' });
    return;
  }

  const cityParts = splitDiscoveryCities(citiesInput?.value || '');
  const primaryCity = cityParts[0] || '';
  const { minPop, maxPop } = readDiscoveryPackPopRange();

  closeDiscoveryCitiesMap();
  setDiscoveryTableMapMode(true);
  controlsHost.classList.remove('hidden');
  if (useBtn) useBtn.classList.add('hidden');
  if (doneBtn) doneBtn.classList.remove('hidden');

  try {
    discoveryCitiesMount = await mountDiscoveryCitiesMap({
      mapHost,
      controlsHost,
      api,
      esc,
      primaryCity,
      state: st,
      radiusMiles: 40,
      minPop,
      maxPop,
      initialSelected: cityParts.map((name) => ({ name, state: st })),
      onSelectionChange: ({ selectedCities }) => {
        syncDiscoveryCitiesFromMap(selectedCities);
      },
    });
    discoveryCitiesMount?.invalidateSize?.();
    requestAnimationFrame(() => discoveryCitiesMount?.invalidateSize?.());
  } catch (error) {
    closeDiscoveryCitiesMap();
    showToast(error?.message || 'Map failed to open', { tone: 'warn' });
  }
}

function bindDiscoveryUseMap() {
  if (bindDiscoveryUseMap._done) return;
  bindDiscoveryUseMap._done = true;
  document.getElementById('discovery-use-map')?.addEventListener('click', () => {
    openDiscoveryCitiesMap().catch((e) => showToast(e?.message || 'Map failed', { tone: 'warn' }));
  });
  document.getElementById('discovery-map-done')?.addEventListener('click', () => {
    closeDiscoveryCitiesMap();
  });

  let popTimer = null;
  const onPopChange = () => {
    if (!discoveryCitiesMount?.setPopRange) return;
    clearTimeout(popTimer);
    popTimer = setTimeout(() => {
      const { minPop, maxPop } = readDiscoveryPackPopRange();
      discoveryCitiesMount
        .setPopRange({ minPop, maxPop })
        ?.catch?.((e) => showToast(e?.message || 'Pop filter failed', { tone: 'warn' }));
    }, 280);
  };
  document.getElementById('discovery-min-pop')?.addEventListener('input', onPopChange);
  document.getElementById('discovery-max-pop')?.addEventListener('input', onPopChange);
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
  const processed = b.lastProcess ? ' · processed' : '';
  return `${b.id} · ${stage} · ${rows}${processed}`;
}

function discoveryRowProcessStatus(row) {
  const status = String(row?.process_status || '').trim().toLowerCase();
  if (status === 'promoted' || status === 'tracked' || status === 'ignored') return status;
  if (String(row?.candidateId || '').trim()) return 'promoted';
  return '';
}

function isDiscoveryRowProcessed(row) {
  return Boolean(discoveryRowProcessStatus(row));
}

function isDiscoveryRowPendingProcess(row) {
  return Boolean(String(row?.human_decision || '').trim()) && !isDiscoveryRowProcessed(row);
}

function discoveryHumanDecisionProgress(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  let decided = 0;
  let pendingProcess = 0;
  for (const row of list) {
    const hasDecision = Boolean(String(row?.human_decision || '').trim());
    if (hasDecision || isDiscoveryRowProcessed(row)) decided += 1;
    if (isDiscoveryRowPendingProcess(row)) pendingProcess += 1;
  }
  return {
    decided,
    total,
    pendingProcess,
    allDecided: total > 0 && decided === total,
  };
}

function updateDiscoveryProcessControls() {
  const processBtn = document.getElementById('discovery-process-btn');
  const progressEl = document.getElementById('discovery-process-progress');
  const backfillBtn = document.getElementById('discovery-backfill-light-serp');
  const { decided, total, pendingProcess, allDecided } = discoveryHumanDecisionProgress(
    state.discoveryRows,
  );
  const canProcess = allDecided && pendingProcess > 0;
  const canBackfillLightSerp = state.discoveryRows.some((r) => {
    if (String(r?.candidateId || '').trim()) return true;
    return discoveryRowProcessStatus(r) === 'promoted';
  });

  if (processBtn) {
    processBtn.disabled = !canProcess;
    setElementTip(
      processBtn,
      total === 0
        ? 'Import a batch and set Decisions first'
        : !allDecided
          ? `Set Decision on every row (${decided}/${total}) before processing`
          : pendingProcess === 0
            ? 'No unprocessed rows left — all decided rows are already processed'
            : `Process ${pendingProcess} decided row(s): pursue/maybe/review/hold → Candidates; pass → tracked; ignore → skip (rediscoverable)`,
    );
  }

  if (backfillBtn) {
    backfillBtn.disabled = !canBackfillLightSerp || !state.discoveryBatchId;
  }

  if (progressEl) {
    if (total === 0) {
      progressEl.hidden = true;
      progressEl.textContent = '';
    } else {
      progressEl.hidden = false;
      progressEl.textContent = allDecided
        ? `${decided}/${total} Decisions made`
        : `${decided}/${total} Decisions made, complete decisions to process batch.`;
    }
  }
}

/** Sort key for batch dropdowns: createdAt, else trailing stamp in id, else id. */
function discoveryBatchSortKey(b) {
  const created = String(b?.createdAt || '').trim();
  if (created) return created;
  const id = String(b?.id || '');
  const m = id.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})(?:$|[^0-9])/);
  if (m) return m[1].replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3');
  return id;
}

function compareDiscoveryBatchesNewestFirst(a, b) {
  const ka = discoveryBatchSortKey(a);
  const kb = discoveryBatchSortKey(b);
  const byTime = String(kb).localeCompare(String(ka));
  if (byTime) return byTime;
  return String(b?.id || '').localeCompare(String(a?.id || ''));
}

function fillCandidateBatchFilterSelect() {
  const sel = document.getElementById('candidate-batch-filter');
  if (!sel) return;
  const fromBatches = state.discoveryBatches || [];
  const fromCandidates = new Set(
    (state.candidates || []).map((c) => c.source?.batchId).filter(Boolean),
  );
  const ids = new Map();
  for (const b of fromBatches) ids.set(b.id, b);
  for (const id of fromCandidates) {
    if (!ids.has(id)) ids.set(id, { id, rowCount: null, stage: '' });
  }
  const prev = state.candidateBatchFilter || '';
  const opts = ['<option value="">Batch: all</option>'];
  const sorted = [...ids.values()].sort(compareDiscoveryBatchesNewestFirst);
  for (const b of sorted) {
    const label = b.rowCount != null ? formatDiscoveryBatchOption(b) : b.id;
    const selected = b.id === prev ? ' selected' : '';
    opts.push(`<option value="${esc(b.id)}"${selected}>${esc(label)}</option>`);
  }
  sel.innerHTML = opts.join('');
  if (prev && !ids.has(prev)) {
    state.candidateBatchFilter = '';
    sel.value = '';
  } else {
    sel.value = prev;
  }
}

function fillCandidateGroupSelects() {
  const groups = [...(state.candidateGroups || [])].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }),
  );
  const filterSel = document.getElementById('candidate-group-filter');
  if (filterSel) {
    const prev = state.candidateGroupFilter || '';
    const opts = [
      '<option value="">Group: all</option>',
      '<option value="__ungrouped">ungrouped</option>',
    ];
    for (const g of groups) {
      const n = Array.isArray(g.ids) ? g.ids.length : 0;
      opts.push(
        `<option value="${esc(g.id)}">${esc(g.name)} (${n})</option>`,
      );
    }
    filterSel.innerHTML = opts.join('');
    if (prev === '__ungrouped' || groups.some((g) => g.id === prev) || !prev) {
      filterSel.value = prev;
      state.candidateGroupFilter = prev;
    } else {
      state.candidateGroupFilter = '';
      filterSel.value = '';
    }
  }

  const actionSel = document.getElementById('candidate-group-action');
  if (actionSel) {
    const prev = actionSel.value || '';
    const opts = [
      '<option value="">—</option>',
      '<option value="__new">New group…</option>',
    ];
    for (const g of groups) {
      opts.push(`<option value="${esc(g.id)}">${esc(g.name)}</option>`);
    }
    actionSel.innerHTML = opts.join('');
    if (prev === '__new' || groups.some((g) => g.id === prev)) {
      actionSel.value = prev;
    } else {
      actionSel.value = '';
    }
  }
}

async function ensureGroupIdForAction() {
  const sel = document.getElementById('candidate-group-action');
  let groupId = sel?.value || '';
  if (!groupId) {
    await showModal({
      title: 'Pick a group',
      confirmLabel: 'OK',
      bodyHtml: '<p>Select a named group, or choose <strong>New group…</strong>.</p>',
    });
    return null;
  }
  if (groupId === '__new') {
    const name = window.prompt('New group name');
    if (name == null) return null;
    const trimmed = String(name).trim();
    if (!trimmed) {
      await showModal({
        title: 'Name required',
        confirmLabel: 'OK',
        bodyHtml: '<p>Group name cannot be empty.</p>',
      });
      return null;
    }
    const data = await api('/api/candidate-groups', {
      method: 'POST',
      body: JSON.stringify({ name: trimmed }),
    });
    state.candidateGroups = data.groups || [];
    fillCandidateGroupSelects();
    notifyCandidatesChanged({ type: 'candidates' });
    groupId = data.group?.id || null;
    if (sel && groupId) sel.value = groupId;
  }
  return groupId;
}

async function applyGroupMembership(op) {
  const ids = [...state.selectedIds];
  if (!ids.length) return;
  try {
    const groupId = await ensureGroupIdForAction();
    if (!groupId) return;
    const group = (state.candidateGroups || []).find((g) => g.id === groupId);
    const label = group?.name || groupId;
    const ok = await showModal({
      title: op === 'add' ? 'Add to group?' : 'Remove from group?',
      confirmLabel: op === 'add' ? `Add (${ids.length})` : `Remove (${ids.length})`,
      bodyHtml: `<p>${op === 'add' ? 'Add' : 'Remove'} <strong>${esc(
        String(ids.length),
      )}</strong> selected candidate(s) ${op === 'add' ? 'to' : 'from'} <strong>${esc(
        label,
      )}</strong>.</p>`,
    });
    if (!ok) return;
    await api(`/api/candidate-groups/${encodeURIComponent(groupId)}/members`, {
      method: 'POST',
      body: JSON.stringify({ ids, op }),
    });
    await loadCandidates();
    notifyCandidatesChanged({ type: 'candidates', ids });
  } catch (error) {
    await showModal({
      title: 'Group update failed',
      confirmLabel: 'OK',
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
  }
}

async function applyCandidateArchive(archived) {
  const ids = [...state.selectedIds];
  if (!ids.length) return;
  const verb = archived ? 'Archive' : 'Unarchive';
  const ok = await showModal({
    title: `${verb} selection?`,
    confirmLabel: `${verb} (${ids.length})`,
    bodyHtml: archived
      ? `<p>Archive <strong>${esc(String(ids.length))}</strong> selected candidate(s). They leave the Active list; research files stay. Switch Visibility to <strong>Archived</strong> to view or restore.</p>`
      : `<p>Unarchive <strong>${esc(String(ids.length))}</strong> selected candidate(s) back to the Active list.</p>`,
  });
  if (!ok) return;
  try {
    const result = await api('/api/candidates/archive', {
      method: 'POST',
      body: JSON.stringify({ ids, archived }),
    });
    await loadCandidates();
    notifyCandidatesChanged({ type: 'candidates', ids });
    const visible = new Set(filteredCandidates().map((c) => c.id));
    for (const id of [...state.selectedIds]) {
      if (!visible.has(id)) state.selectedIds.delete(id);
    }
    if (state.selectedId && !visible.has(state.selectedId)) {
      state.selectedId = null;
      state.detail = null;
      syncCandidatesDetailVisibility();
    } else if (state.selectedId) {
      await loadSelectedCandidateDetail(state.selectedId);
      if (state.selectedIds.size > 1) renderMultiDetail();
      else renderDetail();
    }
    renderList();
    renderActions();
    if (result.errors?.length) {
      const bits = result.errors
        .slice(0, 8)
        .map((e) => `<li>${esc(e.id)}: ${esc(e.error)}</li>`)
        .join('');
      await showModal({
        title: `${verb} partial`,
        confirmLabel: 'OK',
        bodyHtml: `<p>Some rows failed:</p><ul>${bits}</ul>`,
      });
    }
  } catch (error) {
    await showModal({
      title: `${verb} failed`,
      confirmLabel: 'OK',
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
  }
}

async function applyCandidatePermanentDelete() {
  const ids = [...state.selectedIds];
  if (!ids.length) return;
  const blocked = undeletableIdsInSelection(ids);
  if (blocked.length) {
    const sample = blocked
      .slice(0, 8)
      .map((id) => {
        const c = state.candidates.find((x) => x.id === id);
        const label = c
          ? `${c.niche || '?'} · ${c.primaryCity || c.city || '?'} · ${c.state || '?'}`
          : id;
        return `<li><code>${esc(id)}</code> — ${esc(label)}</li>`;
      })
      .join('');
    const more =
      blocked.length > 8 ? `<li class="muted">…and ${blocked.length - 8} more</li>` : '';
    await showModal({
      title: 'Cannot delete Website / Launched',
      confirmLabel: 'OK',
      bodyHtml: `<p>Website Candidates and Launched Candidates cannot be permanently deleted from Rover.</p>
        <ul>${sample}${more}</ul>
        <p class="muted">Deselect them (or use Archive for Research-only cleanup) and try again.</p>`,
    });
    return;
  }
  const sample = ids
    .slice(0, 8)
    .map((id) => {
      const c = state.candidates.find((x) => x.id === id);
      const label = c
        ? `${c.niche || '?'} · ${c.primaryCity || c.city || '?'} · ${c.state || '?'}`
        : id;
      return `<li><code>${esc(id)}</code> — ${esc(label)}</li>`;
    })
    .join('');
  const more =
    ids.length > 8 ? `<li class="muted">…and ${ids.length - 8} more</li>` : '';

  const layer1 = await showModal({
    title: 'Delete candidates permanently?',
    confirmLabel: 'Continue',
    danger: true,
    bodyHtml: `<p>You are about to permanently delete <strong>${esc(String(ids.length))}</strong> Research candidate(s):</p>
      <ul>${sample}${more}</ul>
      <ul>
        <li>Wipes all Research artifacts for each id under <code>research/</code> (JSON, drafts, staging/images folders).</li>
        <li>Removes them from Discovery known / tracked anti-dupe lists so markets can be rediscovered.</li>
        <li>Removes membership in named groups and clears Discovery batch <code>candidateId</code> links.</li>
        <li>Does <strong>not</strong> delete Website or Launched Candidates (blocked by Rover).</li>
        <li>Does <strong>not</strong> release Twilio DIDs or tear down a live host / DNS.</li>
      </ul>
      <p class="muted small">Next step asks you to type <code>DELETE</code> to confirm.</p>`,
  });
  if (!layer1) return;

  const layer2 = await showModal({
    title: 'Type to confirm permanent delete',
    confirmLabel: 'Delete permanently',
    danger: true,
    requireTypedConfirm: 'DELETE',
    bodyHtml: `<p>Confirm permanent delete of <strong>${esc(String(ids.length))}</strong> candidate(s). This cannot be undone from the UI.</p>`,
  });
  if (!layer2) return;

  try {
    const result = await api('/api/candidates/delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
    const deletedSet = new Set((result.deleted || []).map((d) => d.id));
    for (const id of deletedSet) state.selectedIds.delete(id);
    if (state.selectedId && deletedSet.has(state.selectedId)) {
      state.selectedId = null;
      state.detail = null;
      syncCandidatesDetailVisibility();
    }
    await loadCandidates();
    try {
      await loadSites();
    } catch {
      /* optional */
    }
    if (state.selectedId && state.selectedIds.has(state.selectedId)) {
      await loadSelectedCandidateDetail(state.selectedId);
      if (state.selectedIds.size > 1) renderMultiDetail();
      else renderDetail();
    } else if (state.selectedIds.size > 1) {
      renderMultiDetail();
    } else if (state.selectedIds.size === 1) {
      await selectCandidate([...state.selectedIds][0]);
    }
    renderList();
    renderActions();
    if (result.errors?.length) {
      const bits = result.errors
        .slice(0, 8)
        .map((e) => `<li>${esc(e.id)}: ${esc(e.error)}</li>`)
        .join('');
      await showModal({
        title: 'Delete partial',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>Some rows failed:</p><ul>${bits}</ul>`,
      });
    }
  } catch (error) {
    await showModal({
      title: 'Delete failed',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
  }
}

async function manageCandidateGroups() {
  const groups = [...(state.candidateGroups || [])].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }),
  );
  if (!groups.length) {
    await showModal({
      title: 'No groups yet',
      confirmLabel: 'OK',
      bodyHtml:
        '<p>Create one with <strong>Group → New group…</strong> and Add on a selection.</p>',
    });
    return;
  }
  const options = groups
    .map((g) => {
      const n = Array.isArray(g.ids) ? g.ids.length : 0;
      return `<option value="${esc(g.id)}">${esc(g.name)} (${n})</option>`;
    })
    .join('');

  const doRename = await showModal({
    title: 'Manage groups',
    confirmLabel: 'Rename…',
    bodyHtml: `<p>Rename the selected group, or Cancel to delete instead.</p>
      <label>Group <select id="manage-group-select">${options}</select></label>`,
  });
  const groupId =
    document.getElementById('manage-group-select')?.value || groups[0]?.id;
  if (!groupId) return;

  if (doRename) {
    const current = groups.find((g) => g.id === groupId);
    const name = window.prompt('Rename group', current?.name || '');
    if (name == null) return;
    try {
      await api(`/api/candidate-groups/${encodeURIComponent(groupId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      await loadCandidates();
      notifyCandidatesChanged({ type: 'candidates' });
    } catch (error) {
      await showModal({
        title: 'Rename failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
    return;
  }

  const doDelete = await showModal({
    title: 'Delete group?',
    confirmLabel: 'Delete',
    danger: true,
    bodyHtml: `<p>Deletes the named list only — candidates stay. Cancel to leave groups unchanged.</p>
      <label>Group <select id="manage-group-delete-select">${options}</select></label>`,
  });
  if (!doDelete) return;
  const delId =
    document.getElementById('manage-group-delete-select')?.value || groupId;
  try {
    await api(`/api/candidate-groups/${encodeURIComponent(delId)}`, {
      method: 'DELETE',
    });
    if (state.candidateGroupFilter === delId) state.candidateGroupFilter = '';
    await loadCandidates();
    notifyCandidatesChanged({ type: 'candidates' });
  } catch (error) {
    await showModal({
      title: 'Delete failed',
      confirmLabel: 'OK',
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
  }
}

async function loadDiscoveryBatches() {
  const data = await api('/api/discovery/batches');
  state.discoveryBatches = data.batches || [];
  fillCandidateBatchFilterSelect();
  const sel = document.getElementById('discovery-batch-select');
  if (!sel) return;
  const blankLabel = state.discoveryBatches.length ? 'No batch selected' : 'No batches yet';
  const opts = [`<option value="">${esc(blankLabel)}</option>`];
  for (const b of state.discoveryBatches) {
    opts.push(
      `<option value="${esc(b.id)}">${esc(formatDiscoveryBatchOption(b))}</option>`,
    );
  }
  sel.innerHTML = opts.join('');
  const id = state.discoveryBatchId || '';
  sel.value = id && state.discoveryBatches.some((b) => b.id === id) ? id : '';
  if (state.discoveryBatchId && sel.value !== state.discoveryBatchId) {
    state.discoveryBatchId = null;
  }
}

function clearDiscoveryBatch() {
  state.discoveryBatchId = null;
  state.discoveryRows = [];
  state.discoverySelected = new Set();
  state.discoveryCheckAnchor = null;
  const title = document.getElementById('discovery-batch-title');
  if (title) title.textContent = 'No batch selected';
  const sub = document.getElementById('discovery-batch-sub');
  if (sub) sub.textContent = '';
  const logEl = document.getElementById('discovery-process-log');
  if (logEl) {
    logEl.classList.add('hidden');
    logEl.innerHTML = '';
  }
  const sel = document.getElementById('discovery-batch-select');
  if (sel) sel.value = '';
  renderDiscoveryTable();
  updateDiscoveryStepChecks({}, []);
  updateDiscoveryProcessControls();
  syncDiscoveryApiRerunButton();
}

const DISCOVERY_SOURCES = {
  claude: { id: 'claude', label: 'Claude', tip: 'From Claude narrative CSV' },
  census: { id: 'census', label: 'Census', tip: 'US Census population lookup on import' },
  dfs: { id: 'dfs', label: 'DFS', tip: 'DataForSEO Discovery Light SERP' },
  ops: { id: 'ops', label: 'Rover', tip: 'Computed or set in Rover UI' },
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
    key: 'suggested_suburbs',
    label: 'Suburbs',
    sortable: true,
    tip: 'Claude suggested nearby suburbs (count; hover cell for names)',
    cellClass: 'col-short col-center',
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
    tip: 'Yes/No from DFS Light SERP',
    cellClass: 'col-short',
    source: 'dfs',
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
    key: 'Est. Monthly Search Volume',
    label: 'Est. MSV',
    sortable: true,
    tip: 'Claude estimated monthly searches for Niche + City (primary only). Discovery triage only — not used after Process / Research.',
    cellClass: 'col-short',
    source: 'claude',
  },
  {
    key: 'Organic Home Page',
    label: 'Homepages',
    sortable: true,
    tip: 'Organic homepage count from DFS Light SERP (URL path / only; directories excluded). Not niche-title filtered.',
    cellClass: 'col-short col-center',
    source: 'dfs',
  },
  {
    key: 'Organic Sub Page',
    label: 'Subpages',
    sortable: true,
    tip: 'Organic subpage count from DFS Light SERP (non-homepage URLs; directories excluded). Not niche-title filtered.',
    cellClass: 'col-short col-center',
    source: 'dfs',
  },
  {
    key: 'confidence_serp',
    label: 'Conf SERP',
    sortable: true,
    tip: 'high after DFS Light SERP',
    cellClass: 'col-short',
    source: 'dfs',
  },
  {
    key: 'recommended_decision',
    label: 'Recommend',
    sortable: true,
    tip: 'Score-based: review until Research stages 1–3; then pursue ≥7 / maybe 6–7 / pass <6',
    cellClass: 'col-short',
    source: 'ops',
  },
  {
    key: '_accept',
    label: 'Accept',
    sortable: false,
    tip: 'Copy Recommend → Decision',
    cellClass: 'col-narrow',
    source: 'ops',
  },
  {
    key: 'human_decision',
    label: 'Decision',
    sortable: true,
    tip: 'Your decision for Process batch (see sidebar Decision meanings)',
    cellClass: 'col-human',
    source: 'ops',
  },
  {
    key: 'decision_notes',
    label: 'Notes',
    sortable: false,
    tip: 'Notes (Claude/Rover warnings or your comments)',
    cellClass: 'col-notes',
    source: 'ops',
  },
  {
    key: 'candidateId',
    label: 'Candidate',
    sortable: true,
    tip: 'Candidate id after promote, or “tracked” / “ignored”',
    cellClass: 'col-truncate',
    source: 'ops',
  },
];

function discoverySourceDot(sourceId) {
  const src = DISCOVERY_SOURCES[sourceId];
  if (!src) return '';
  return `<span class="src-dot src-${esc(src.id)}" data-tip="${esc(src.tip)}" aria-label="${esc(
    src.label,
  )}"></span>`;
}

function renderSourceLegend(elId, { exclude = [] } = {}) {
  const el = document.getElementById(elId);
  if (!el) return;
  const skip = new Set(exclude);
  el.innerHTML = Object.values(DISCOVERY_SOURCES)
    .filter((s) => !skip.has(s.id))
    .map(
      (s) =>
        `<span class="src-legend-item" data-tip="${esc(s.tip)}"><span class="src-dot src-${esc(
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

function parseSuggestedSuburbsList(raw) {
  return String(raw || '')
    .split(/;/)
    .map((s) => s.trim())
    .filter(Boolean);
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
  if (key === 'suggested_suburbs') {
    const raw = row.suggested_suburbs;
    if (raw == null || String(raw).trim() === '') return -1;
    return parseSuggestedSuburbsList(raw).length;
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
    const selected = state.discoverySelected?.size || 0;
    count.textContent =
      selected > 0
        ? `Showing ${n} / ${state.discoveryRows.length} · ${selected} selected`
        : `Showing ${n} / ${state.discoveryRows.length}`;
  }
  syncDiscoveryBulkHumanUi();
}

/** Show bulk Human select only when 2+ Discovery rows are selected. */
function syncDiscoveryBulkHumanUi() {
  const wrap = document.getElementById('discovery-bulk-human-wrap');
  if (!wrap) return;
  const show = (state.discoverySelected?.size || 0) > 1;
  wrap.classList.toggle('hidden', !show);
  wrap.hidden = !show;
  if (!show) {
    const sel = document.getElementById('discovery-bulk-human');
    if (sel) sel.value = '';
  }
}

async function persistDiscoveryDecisions(updates) {
  if (!state.discoveryBatchId || !updates.length) return null;
  const result = await api(
    `/api/discovery/batches/${encodeURIComponent(state.discoveryBatchId)}/decisions`,
    { method: 'POST', body: JSON.stringify({ updates }) },
  );
  state.discoveryRows = result.rows;
  notifyCandidatesChanged({ type: 'discovery', batchId: state.discoveryBatchId });
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
    updateDiscoveryProcessControls();
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

async function reopenDiscoveryIndices(indices) {
  if (!state.discoveryBatchId || !indices?.length) return;
  try {
    const result = await api(
      `/api/discovery/batches/${encodeURIComponent(state.discoveryBatchId)}/reopen`,
      {
        method: 'POST',
        body: JSON.stringify({ indices }),
      },
    );
    state.discoveryRows = result.rows;
    await loadDiscoveryBatches();
    renderDiscoveryTable();
    updateDiscoveryStepChecks(
      state.discoveryBatches.find((b) => b.id === state.discoveryBatchId) || {
        id: state.discoveryBatchId,
      },
      state.discoveryRows,
    );
    showToast(
      `Reopened ${result.reopened?.length || 0} row(s). Change Decision if needed, then Process batch.`,
    );
  } catch (error) {
    await showModal({
      title: 'Reopen failed',
      confirmLabel: 'OK',
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
  }
}

async function acceptDiscoveryIndices(indices) {
  const updates = [];
  for (const idx of indices) {
    const row = state.discoveryRows[idx];
    if (!row?.recommended_decision) continue;
    if (isDiscoveryRowProcessed(row)) continue;
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

function discoveryKnownRowKey(row) {
  return [row?.niche, row?.city, row?.state]
    .map((v) => String(v || '').trim().toLowerCase())
    .join('|');
}

function syncDiscoveryKnownChrome() {
  const known = Boolean(state.discoveryKnownMode);
  document.getElementById('discovery-known-chrome')?.classList.toggle('hidden', !known);
  document.getElementById('discovery-batch-chrome')?.classList.toggle('hidden', known);
  const mapHost = document.getElementById('discovery-map-canvas');
  if (known && mapHost) mapHost.classList.add('hidden');
  const removeBtn = document.getElementById('discovery-known-remove');
  if (removeBtn) removeBtn.disabled = state.discoveryKnownSelected.size === 0;
}

async function loadDiscoveryKnownList() {
  const data = await api('/api/discovery/known');
  state.discoveryKnownRows = Array.isArray(data.rows) ? data.rows : [];
  state.discoveryKnownPrunePreview = data.prunePreview || null;
  state.discoveryKnownSelected = new Set();
  state.discoveryKnownCheckAnchor = null;
  const sub = document.getElementById('discovery-known-sub');
  if (sub) {
    const n = state.discoveryKnownRows.length;
    const cand = state.discoveryKnownRows.filter((r) => r.source === 'candidate').length;
    const tracked = n - cand;
    sub.textContent = `${n} pairs · ${cand} Candidate · ${tracked} Tracked`;
  }
}

async function enterDiscoveryKnownMode() {
  state.discoveryKnownMode = true;
  syncDiscoveryKnownChrome();
  await loadDiscoveryKnownList();
  renderDiscoveryTable();
}

function exitDiscoveryKnownMode() {
  state.discoveryKnownMode = false;
  state.discoveryKnownSelected = new Set();
  state.discoveryKnownCheckAnchor = null;
  syncDiscoveryKnownChrome();
  renderDiscoveryTable();
}

function renderDiscoveryKnownTable() {
  const thead = document.querySelector('#discovery-table thead');
  const tbody = document.querySelector('#discovery-table tbody');
  if (!thead || !tbody) return;
  syncDiscoveryKnownChrome();
  thead.innerHTML = `<tr>
    <th data-tip="Select"><input type="checkbox" id="discovery-known-select-all" /></th>
    <th>Niche</th>
    <th>City</th>
    <th>State</th>
    <th>Decision</th>
    <th>Source</th>
  </tr>`;
  const legend = document.getElementById('discovery-source-legend');
  if (legend) legend.innerHTML = '';

  const rows = state.discoveryKnownRows || [];
  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="muted">No do-not-repropose pairs — Generate Pack will allow any market that fits filters.</td></tr>';
    syncHeaderSelectAll(document.getElementById('discovery-known-select-all'), {
      selectedCount: 0,
      totalCount: 0,
    });
    const removeBtn = document.getElementById('discovery-known-remove');
    if (removeBtn) removeBtn.disabled = true;
    return;
  }

  tbody.innerHTML = rows
    .map((row) => {
      const key = discoveryKnownRowKey(row);
      const checked = state.discoveryKnownSelected.has(key) ? 'checked' : '';
      const sourceLabel = row.source === 'tracked' ? 'Tracked' : 'Candidate';
      return `<tr data-known-key="${esc(key)}">
        <td><input type="checkbox" class="disc-known-check" data-known-key="${esc(key)}" ${checked} /></td>
        <td>${esc(row.niche || '')}</td>
        <td>${esc(row.city || '')}</td>
        <td>${esc(row.state || '')}</td>
        <td>${esc(row.decision || '—')}</td>
        <td class="muted">${esc(sourceLabel)}${
          row.candidateId ? ` · <span class="cell-text">${esc(row.candidateId)}</span>` : ''
        }</td>
      </tr>`;
    })
    .join('');

  syncHeaderSelectAll(document.getElementById('discovery-known-select-all'), {
    selectedCount: rows.filter((r) => state.discoveryKnownSelected.has(discoveryKnownRowKey(r)))
      .length,
    totalCount: rows.length,
  });
  const removeBtn = document.getElementById('discovery-known-remove');
  if (removeBtn) removeBtn.disabled = state.discoveryKnownSelected.size === 0;

  document.getElementById('discovery-known-select-all')?.addEventListener('change', (e) => {
    const on = e.target.checked;
    state.discoveryKnownSelected = new Set();
    if (on) {
      for (const r of rows) state.discoveryKnownSelected.add(discoveryKnownRowKey(r));
    }
    tbody.querySelectorAll('.disc-known-check').forEach((box) => {
      box.checked = on;
    });
    if (removeBtn) removeBtn.disabled = state.discoveryKnownSelected.size === 0;
  });

  tbody.querySelectorAll('.disc-known-check').forEach((cb) => {
    const applyKnownShiftRange = (event) => {
      const key = cb.dataset.knownKey;
      const ranged = applyShiftRangeCheckboxClick(event, {
        visibleKeys: rows.map((r) => discoveryKnownRowKey(r)),
        clickedKey: key,
        anchorKey: state.discoveryKnownCheckAnchor,
        setAnchor: (k) => {
          state.discoveryKnownCheckAnchor = k;
        },
        setSelected: (k, on) => {
          if (on) state.discoveryKnownSelected.add(k);
          else state.discoveryKnownSelected.delete(k);
        },
      });
      if (!ranged) return false;
      tbody.querySelectorAll('.disc-known-check').forEach((box) => {
        box.checked = state.discoveryKnownSelected.has(box.dataset.knownKey);
      });
      queueMicrotask(() => {
        cb.checked = state.discoveryKnownSelected.has(key);
      });
      syncHeaderSelectAll(document.getElementById('discovery-known-select-all'), {
        selectedCount: state.discoveryKnownSelected.size,
        totalCount: rows.length,
      });
      if (removeBtn) removeBtn.disabled = state.discoveryKnownSelected.size === 0;
      return true;
    };
    cb.addEventListener('pointerdown', (event) => {
      if (!event.shiftKey || state.discoveryKnownCheckAnchor == null) return;
      blockShiftRangePointerDown(event, state.discoveryKnownCheckAnchor);
      applyKnownShiftRange(event);
    });
    cb.addEventListener('click', (event) => {
      const key = cb.dataset.knownKey;
      if (applyKnownShiftRange(event)) return;
      if (consumeShiftRangeChange(cb, key)) {
        cb.checked = state.discoveryKnownSelected.has(key);
        return;
      }
      state.discoveryKnownCheckAnchor = key;
      if (cb.checked) state.discoveryKnownSelected.add(key);
      else state.discoveryKnownSelected.delete(key);
      syncHeaderSelectAll(document.getElementById('discovery-known-select-all'), {
        selectedCount: state.discoveryKnownSelected.size,
        totalCount: rows.length,
      });
      if (removeBtn) removeBtn.disabled = state.discoveryKnownSelected.size === 0;
    });
  });
}

function renderDiscoveryTable() {
  if (state.discoveryKnownMode) {
    renderDiscoveryKnownTable();
    return;
  }
  syncDiscoveryKnownChrome();
  const thead = document.querySelector('#discovery-table thead');
  const tbody = document.querySelector('#discovery-table tbody');
  const sort = state.discoverySort;
  thead.innerHTML = `<tr>${DISCOVERY_TABLE_COLS.map((c) => {
    const tip = c.tip || c.label || '';
    if (c.key === '_select') {
      return `<th data-tip="${esc(tip)}"><input type="checkbox" id="discovery-select-all" data-tip="${esc(tip)}" /></th>`;
    }
    const mark =
      sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
    const cls = [c.sortable ? 'sortable' : '', c.cellClass || ''].filter(Boolean).join(' ');
    const label = c.label || (c.key === '_accept' ? 'Accept' : '');
    const srcTip = c.source && DISCOVERY_SOURCES[c.source] ? DISCOVERY_SOURCES[c.source].tip : '';
    const fullTip = [tip, srcTip].filter(Boolean).join(' · ');
    return `<th class="${cls}" data-sort="${esc(c.key)}" data-tip="${esc(fullTip)}"><span class="th-label">${discoverySourceDot(
      c.source,
    )}${esc(label)}</span>${mark}</th>`;
  }).join('')}</tr>`;
  renderDiscoverySourceLegend();

  const acceptSel = document.getElementById('discovery-accept-selected');
  const acceptAll = document.getElementById('discovery-accept-all');

  if (!state.discoveryRows.length) {
    tbody.innerHTML = `<tr><td colspan="${DISCOVERY_TABLE_COLS.length}" class="muted">Import a filled CSV or select a batch.</td></tr>`;
    updateDiscoveryProcessControls();
    syncHeaderSelectAll(document.getElementById('discovery-select-all'), {
      selectedCount: 0,
      totalCount: 0,
    });
    if (acceptSel) acceptSel.disabled = true;
    if (acceptAll) acceptAll.disabled = true;
    syncDiscoveryFilterInputs();
    return;
  }

  const view = getDiscoveryViewRows();
  tbody.innerHTML = view
    .map(({ row, index: idx }) => {
      const checked = state.discoverySelected.has(idx) ? 'checked' : '';
      const processStatus = discoveryRowProcessStatus(row);
      const processed = Boolean(processStatus);
      const tracked = processStatus === 'tracked';
      const ignored = processStatus === 'ignored';
      const cells = DISCOVERY_TABLE_COLS.map((col) => {
        const tdClass = col.cellClass ? ` class="${esc(col.cellClass)}"` : '';
        if (col.key === '_select') {
          return `<td${tdClass}><input type="checkbox" data-disc-idx="${idx}" class="disc-row-check" ${checked} /></td>`;
        }
        if (col.key === '_accept') {
          if (tracked || ignored) {
            return `<td${tdClass}><button type="button" class="btn btn-sm" data-reopen-idx="${idx}" data-tip="${
              ignored
                ? 'Clear ignored status so you can change Decision and Process again'
                : 'Clear tracked status so you can change Decision and Process again'
            }">Reopen</button></td>`;
          }
          if (processed) {
            return `<td${tdClass}><span class="metric metric-good" data-tip="In Candidates as ${esc(
              row.candidateId || '',
            )}">✓ Candidates</span></td>`;
          }
          const disabled = !row.recommended_decision ? 'disabled' : '';
          return `<td${tdClass}><button type="button" class="btn btn-accept" data-accept-idx="${idx}" data-tip="Copy Recommend → Decision" ${disabled}>Accept</button></td>`;
        }
        if (col.key === 'recommended_decision') {
          const rec = row.recommended_decision || '—';
          const reason = row.recommended_reason || '';
          const cls = [col.cellClass, 'rec-cell'].filter(Boolean).join(' ');
          return `<td class="${esc(cls)}" data-tip="${esc(reason)}"><strong>${esc(rec)}</strong></td>`;
        }
        if (col.key === 'human_decision') {
          const v = row.human_decision || '';
          if (tracked) {
            return `<td${tdClass}><span class="metric disc-tracked-mark" data-tip="Tracked (${esc(
              v || '—',
            )}) — not in Candidates. Reopen to change.">○ Tracked · ${esc(v || '—')}</span></td>`;
          }
          if (ignored) {
            return `<td${tdClass}><span class="metric disc-ignored-mark" data-tip="Ignored this batch — not tracked, can rediscover. Reopen to change.">○ Ignored · ${esc(
              v || 'ignore',
            )}</span></td>`;
          }
          if (processed) {
            return `<td${tdClass}><span class="metric metric-good" data-tip="In Candidates as ${esc(
              row.candidateId || '',
            )}">✓ ${esc(v || '—')}</span></td>`;
          }
          return `<td${tdClass}><select data-idx="${idx}" data-field="human_decision">${DISCOVERY_DECISION_OPTS.map(
            (o) => `<option value="${o}" ${v === o ? 'selected' : ''}>${o || '—'}</option>`,
          ).join('')}</select></td>`;
        }
        if (col.key === 'decision_notes') {
          const notes = row.decision_notes || '';
          if (processed) {
            return `<td${tdClass} data-tip="${esc(notes)}"><span class="cell-text muted">${esc(
              notes || '—',
            )}</span></td>`;
          }
          return `<td${tdClass}><input data-idx="${idx}" data-field="decision_notes" data-tip="${esc(notes)}" value="${esc(
            notes,
          )}" /></td>`;
        }
        if (col.key === 'candidateId') {
          if (tracked) {
            return `<td${tdClass} data-tip="Tracked only — not a Candidate"><span class="cell-text muted">tracked</span></td>`;
          }
          if (ignored) {
            return `<td${tdClass} data-tip="Ignored this batch — rediscoverable"><span class="cell-text muted">ignored</span></td>`;
          }
          const val = row.candidateId || '';
          return `<td${tdClass} data-tip="${esc(val)}"><span class="cell-text">${esc(val || '—')}</span></td>`;
        }
        if (col.key === 'suggested_suburbs') {
          const raw = row.suggested_suburbs;
          if (raw == null || String(raw).trim() === '') {
            return `<td${tdClass}><span class="cell-text muted">—</span></td>`;
          }
          const cities = parseSuggestedSuburbsList(raw);
          const tip = cities.length ? cities.join('\n') : '';
          return `<td${tdClass}${tip ? ` data-tip="${esc(tip)}"` : ''}><span class="cell-text">${esc(
            String(cities.length),
          )}</span></td>`;
        }
        const val = row[col.key] ?? '';
        return `<td${tdClass} data-tip="${esc(val)}"><span class="cell-text">${esc(val)}</span></td>`;
      });
      const rowClass = [
        processed ? 'disc-row-processed' : '',
        tracked ? 'disc-row-tracked' : '',
        ignored ? 'disc-row-ignored' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<tr data-row-idx="${idx}" class="${rowClass}">${cells.join('')}</tr>`;
    })
    .join('');

  updateDiscoveryProcessControls();
  const reopenSel = document.getElementById('discovery-reopen-selected');
  if (reopenSel) {
    const canReopen = [...state.discoverySelected].some((idx) =>
      isDiscoveryRowProcessed(state.discoveryRows[idx]),
    );
    reopenSel.disabled = !canReopen;
  }
  if (acceptSel) acceptSel.disabled = state.discoverySelected.size === 0;
  if (acceptAll) {
    acceptAll.disabled = !view.some(
      ({ row }) => row.recommended_decision && !isDiscoveryRowProcessed(row),
    );
  }
  syncDiscoveryFilterInputs();

  const discSelectAll = document.getElementById('discovery-select-all');
  const discSelectedVisible = view.filter(({ index }) =>
    state.discoverySelected.has(index),
  ).length;
  syncHeaderSelectAll(discSelectAll, {
    selectedCount: discSelectedVisible,
    totalCount: view.length,
  });

  discSelectAll?.addEventListener('change', (e) => {
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
    const syncDiscSelectionUi = () => {
      syncHeaderSelectAll(document.getElementById('discovery-select-all'), {
        selectedCount: view.filter(({ index }) => state.discoverySelected.has(index))
          .length,
        totalCount: view.length,
      });
      if (acceptSel) acceptSel.disabled = state.discoverySelected.size === 0;
      const reopenBtn = document.getElementById('discovery-reopen-selected');
      if (reopenBtn) {
        reopenBtn.disabled = ![...state.discoverySelected].some((i) =>
          isDiscoveryRowProcessed(state.discoveryRows[i]),
        );
      }
      syncDiscoveryFilterInputs();
    };
    const applyDiscShiftRange = (e) => {
      const idx = Number(cb.dataset.discIdx);
      const ranged = applyShiftRangeCheckboxClick(e, {
        visibleKeys: view.map(({ index }) => index),
        clickedKey: idx,
        anchorKey: state.discoveryCheckAnchor,
        setAnchor: (key) => {
          state.discoveryCheckAnchor = key;
        },
        setSelected: (key, on) => {
          if (on) state.discoverySelected.add(key);
          else state.discoverySelected.delete(key);
        },
      });
      if (!ranged) return false;
      tbody.querySelectorAll('.disc-row-check').forEach((box) => {
        const i = Number(box.dataset.discIdx);
        box.checked = state.discoverySelected.has(i);
      });
      syncDiscSelectionUi();
      return true;
    };
    cb.addEventListener('pointerdown', (e) => {
      if (!e.shiftKey || state.discoveryCheckAnchor == null) return;
      blockShiftRangePointerDown(e, state.discoveryCheckAnchor);
      applyDiscShiftRange(e);
    });
    cb.addEventListener('click', (e) => {
      applyDiscShiftRange(e);
    });
    cb.addEventListener('change', (e) => {
      const idx = Number(cb.dataset.discIdx);
      if (consumeShiftRangeChange(cb, idx)) {
        cb.checked = state.discoverySelected.has(idx);
        return;
      }
      state.discoveryCheckAnchor = idx;
      if (cb.checked) state.discoverySelected.add(idx);
      else state.discoverySelected.delete(idx);
      syncDiscSelectionUi();
    });
  });
  tbody.querySelectorAll('[data-accept-idx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await acceptDiscoveryIndices([Number(btn.dataset.acceptIdx)]);
    });
  });
  tbody.querySelectorAll('[data-reopen-idx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await reopenDiscoveryIndices([Number(btn.dataset.reopenIdx)]);
    });
  });
  enableTableColumnResize(document.getElementById('discovery-table'), {
    freezeCols: 4,
  });
}

async function selectDiscoveryBatch(id) {
  const data = await api(`/api/discovery/batches/${encodeURIComponent(id)}`);
  state.discoveryBatchId = data.batch.id;
  state.discoveryRows = data.rows || [];
  state.discoverySelected = new Set();
  state.discoveryCheckAnchor = null;
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
      ? `process +${data.batch.lastProcess.promoted?.length || 0} · ○${
          data.batch.lastProcess.tracked?.length || 0
        } · ░${data.batch.lastProcess.ignored?.length || 0} · −${data.batch.lastProcess.skipped?.length || 0}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const batchSel = document.getElementById('discovery-batch-select');
  if (batchSel && batchSel.value !== data.batch.id) {
    batchSel.value = data.batch.id;
  }
  const logEl = document.getElementById('discovery-process-log');
  if (logEl) {
    const lp = data.batch.lastProcess;
    if (lp) {
      logEl.classList.remove('hidden');
      const linked = (lp.promoted || []).filter((p) => p.linkedExisting).length;
      logEl.innerHTML = `<p class="muted">Last process: +${esc(
        String(lp.promoted?.length || 0),
      )} Candidates${linked ? ` (${esc(String(linked))} linked)` : ''} · ○${esc(
        String(lp.tracked?.length || 0),
      )} tracked · ░${esc(String(lp.ignored?.length || 0))} ignored · −${esc(
        String(lp.skipped?.length || 0),
      )} skipped · SERP / Volume ×${esc(
        String(lp.pursueQueued?.length || 0),
      )}</p>`;
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
  if (effectiveClaudeUiMode() === 'api') {
    syncDiscoveryApiRerunButton();
    syncGeneratePackOverlay(state.lightJobsSnap);
  }
  await loadDiscoveryBatches();
}

function updateDiscoveryStepChecks(batch, rows) {
  const hasRows = (rows?.length || 0) > 0;
  const serpDone =
    Boolean(batch?.lastSerpProbe) ||
    (hasRows && rows.some((r) => String(r.serp_source || '').includes('dataforseo')));
  const steps = {
    claude: hasRows || Boolean(batch?.files?.lastImport) || Boolean(batch?.rowCount),
    enrich: serpDone,
    decisions: hasRows && rows.some((r) => String(r.human_decision || '').trim() !== ''),
    processed:
      batch?.stage === 'discovery_processed' ||
      Boolean(batch?.lastProcess) ||
      (hasRows && rows.some((r) => isDiscoveryRowProcessed(r))),
  };
  const rail = document.getElementById('discovery-steps');
  rail?.querySelectorAll('.disc-step').forEach((el) => {
    const key = el.dataset.step;
    el.classList.toggle('done', Boolean(steps[key]));
  });

  const packDone =
    Boolean(state.lastDiscoveryPack) ||
    Boolean(batch?.id) ||
    Boolean(state.discoveryBatchId);
  const flowDone = {
    pack: packDone,
    claude: Boolean(state.discoveryClaudeSent) || steps.claude,
    import: steps.claude,
    enrich: serpDone,
  };
  document.querySelectorAll('.discovery-flow-step[data-flow-step]').forEach((el) => {
    const key = el.dataset.flowStep;
    el.classList.toggle('done', Boolean(flowDone[key]));
  });
}

function showDiscoverySidebarStep(step) {
  if (effectiveClaudeUiMode() === 'api' && (step === 'import' || step === 'claude')) {
    step = step === 'claude' ? 'pack' : 'enrich';
  }
  const sections = {
    pack: document.getElementById('discovery-new-pack-section'),
    claude: document.getElementById('discovery-claude-pack-section'),
    import: document.getElementById('discovery-import-section'),
    enrich: document.getElementById('discovery-enrich-section'),
  };
  for (const [key, el] of Object.entries(sections)) {
    if (!el) continue;
    const isCurrent = key === step;
    el.open = isCurrent;
    el.classList.toggle('current', isCurrent);
  }
}

function wireDiscoveryUi() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setView(btn.dataset.view);
      if (btn.dataset.view === 'discovery') {
        loadDiscoveryBatches().catch(() => {});
      }
      if (btn.dataset.view === 'launched-sites' || btn.dataset.view === 'sites') {
        loadSites().catch(() => {});
      }
      if (btn.dataset.view === 'phone') {
        loadPhoneView().catch(() => {});
      }
      if (btn.dataset.view === 'photo') {
        loadPhotoView().catch(() => {});
      }
    });
  });

  showDiscoverySidebarStep('pack');
  syncDiscoveryClaudeModeUi();
  document.getElementById('discovery-new-pack-section')?.addEventListener('click', (event) => {
    if (event.target.closest('#discovery-generate-pack')) {
      void startGeneratePackFromUi(state.discoveryBatchId);
    }
  });
  document.getElementById('gp-overlay-stop')?.addEventListener('click', async () => {
    const overlay = document.getElementById('discovery-generate-pack-overlay');
    const jobId = overlay?.dataset.jobId || state._generatePackTrack?.jobId;
    if (!jobId) return;
    const btn = document.getElementById('gp-overlay-stop');
    if (btn) btn.disabled = true;
    const detailEl = document.getElementById('gp-overlay-detail');
    if (detailEl) detailEl.textContent = 'Stopping…';
    try {
      await api(`/api/light-jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
    } catch (error) {
      if (btn) btn.disabled = false;
      await showModal({
        title: 'Could not stop',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });
  wireSitesUi();
  wirePhoneUi();
  wirePhotoUi();
  wireImageZoom();

  document.getElementById('discovery-batch-select')?.addEventListener('change', (event) => {
    const id = event.target.value;
    if (id) selectDiscoveryBatch(id).catch(() => {});
    else clearDiscoveryBatch();
  });

  document.getElementById('discovery-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const niches = [
      ...event.target.querySelectorAll('input[name="niche"]:checked'),
    ].map((el) => el.value);
    for (const n of parseDiscoveryNicheList(fd.get('suggestedNiches'))) {
      if (!niches.some((x) => String(x).toLowerCase() === n.toLowerCase())) niches.push(n);
    }
    const requiredNiches = parseDiscoveryNicheList(fd.get('requiredNiches'));
    const cities = splitDiscoveryCities(fd.get('packCities'));
    try {
      const pack = await api('/api/discovery/pack', {
        method: 'POST',
        body: JSON.stringify({
          state: normalizeDiscoveryStateInput(String(fd.get('packState') || '')),
          niches,
          requiredNiches,
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
      state.discoveryClaudeSent = false;
      updateDiscoveryStepChecks(pack.batch, state.discoveryRows);
      await loadDiscoveryBatches();
      await selectDiscoveryBatch(pack.batch.id);
      if (effectiveClaudeUiMode() === 'api') {
        syncDiscoveryApiRerunButton();
        await startGeneratePackFromUi(pack.batch.id);
      } else {
        const box = document.getElementById('discovery-pack-result');
        const empty = document.getElementById('discovery-pack-empty');
        if (empty) empty.classList.add('hidden');
        box.classList.remove('hidden');
        box.innerHTML = `
        <ol class="discovery-pack-next">
          <li><button type="button" class="btn primary" id="dl-discovery-csv">Download Discovery Pack Template</button></li>
          <li><button type="button" class="btn" id="copy-discovery-claude">Copy Claude Prompt</button></li>
          <li>Paste both in <a href="https://claude.ai" target="_blank" rel="noopener noreferrer">Claude.ai</a></li>
        </ol>
      `;
        document.getElementById('dl-discovery-csv').onclick = () =>
          downloadText(pack.csvName || 'discovery.csv', pack.csv, 'text/csv');
        const markClaudeSent = () => {
          state.discoveryClaudeSent = true;
          updateDiscoveryStepChecks(pack.batch, state.discoveryRows);
          showDiscoverySidebarStep('import');
        };
        document.getElementById('copy-discovery-claude').onclick = async () => {
          await navigator.clipboard.writeText(pack.claudePrompt);
          showToast('Claude prompt copied to clipboard.');
        };
        box.querySelector('a[href="https://claude.ai"]')?.addEventListener('click', () => {
          markClaudeSent();
        });
        showDiscoverySidebarStep('claude');
      }
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
        batch: result.batch,
      };
      await loadDiscoveryBatches();
      await selectDiscoveryBatch(result.batch.id);
      showDiscoverySidebarStep('enrich');
      const warns = result.batch.popBandWarnings || [];
      const warnHtml = warns.length
        ? `<p class="muted">${esc(String(warns.length))} row(s) outside preferred pop band.</p>`
        : '';
      await showModal({
        title: 'Claude CSV imported',
        confirmLabel: 'OK',
        bodyHtml: `<p>Loaded <strong>${esc(String(result.rows.length))}</strong> rows. Next: <strong>Light SERP</strong>.</p>${warnHtml}`,
      });
    } catch (error) {
      await showModal({
        title: 'Import failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('discovery-enrich-pack-btn')?.addEventListener('click', () =>
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
    const indices = [...(state.discoverySelected || [])]
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n));
    const scopedIndices = indices.length ? indices : null;
    showDiscoverySidebarStep('enrich');
    try {
      const previewQs = scopedIndices
        ? `?indices=${scopedIndices.map((n) => encodeURIComponent(String(n))).join(',')}`
        : '';
      const preview = await api(
        `/api/discovery/batches/${encodeURIComponent(state.discoveryBatchId)}/serp-probe/preview${previewQs}`,
      );
      if (!preview.hasDataForSeo) {
        await showModal({
          title: 'DataForSEO required',
          confirmLabel: 'OK',
          bodyHtml:
            '<p>Add <code>DATAFORSEO_LOGIN</code> / <code>DATAFORSEO_PASSWORD</code> to <code>.env</code> to run Discovery Light SERP.</p>',
        });
        return;
      }
      const bal =
        state.dfsBalance?.ok && state.dfsBalance.balance != null
          ? `<p class="muted">DFS balance: ${esc(formatMoney(state.dfsBalance.balance))}</p>`
          : '';
      const ok = await showModal({
        title: 'Run Discovery Light SERP?',
        confirmLabel: preview.confirmLabel || 'Probe',
        bodyHtml: `
          <p>${esc(preview.estimateLabel || '')}</p>
          <p class="muted">${esc(preview.estimateDetail || '')}</p>
          ${bal}
          <p class="muted">Overwrites Map Pack + organic/directory counts, then re-runs Recommend.</p>
        `,
      });
      if (!ok) return;
      const enrichBtn = document.getElementById('discovery-enrich-pack-btn');
      if (enrichBtn) enrichBtn.disabled = true;
      if (progress) progress.classList.remove('hidden');
      setDeterminateProgress(bar, { done: 0, total: preview.probeCount });
      if (labelEl) labelEl.textContent = 'Starting Light SERP…';
      if (detailEl) detailEl.textContent = `0 / ${preview.probeCount}`;

      const started = await api(
        `/api/discovery/batches/${encodeURIComponent(state.discoveryBatchId)}/serp-probe`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...(scopedIndices ? { indices: scopedIndices } : {}),
          }),
        },
      );
      const jobId = started.jobId;
      if (!jobId) throw new Error('Probe did not return a job id');

      await new Promise((resolve, reject) => {
        const tick = async () => {
          try {
            const job = await api(`/api/discovery/serp-probe-jobs/${encodeURIComponent(jobId)}`);
            setDeterminateProgress(bar, { done: job.done || 0, total: job.total });
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
        setDeterminateProgress(bar, {});
        if (progress) progress.classList.add('hidden');
        if (job.status === 'error') {
          announceBanner('Light SERP failed', { tone: 'err' });
        } else {
          announceStepComplete('Light SERP');
        }
        const p = job.probe || job;
        await showModal({
          title: 'Light SERP complete',
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
        showDiscoverySidebarStep(null);
        await loadDfsBalance();
      });
    } catch (error) {
      setDeterminateProgress(bar, {});
      if (progress) progress.classList.add('hidden');
      if (error.code === 'LIGHT_SERP_CONCURRENCY') {
        await explainConcurrencyLimit({
          key: 'lightSerp',
          running: error.running,
          limit: error.limit ?? state.concurrency?.lightSerp ?? 2,
        });
      } else {
        await showModal({
          title: 'Light SERP failed',
          confirmLabel: 'OK',
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      }
    } finally {
      const enrichBtn = document.getElementById('discovery-enrich-pack-btn');
      if (enrichBtn) enrichBtn.disabled = false;
    }
  }

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
      bodyHtml: `<p>Copy Recommend → Decision for <strong>${esc(
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

  document.getElementById('discovery-bulk-human')?.addEventListener('change', async (e) => {
    const sel = e.target;
    if (!(sel instanceof HTMLSelectElement)) return;
    const raw = sel.value;
    if (!raw) return;
    const human_decision = raw === '__clear' ? '' : raw;
    if (human_decision && !DISCOVERY_DECISION_OPTS.includes(human_decision)) {
      sel.value = '';
      return;
    }
    const selected = [...(state.discoverySelected || [])]
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n));
    const editable = selected.filter((idx) => {
      const row = state.discoveryRows[idx];
      return row && !isDiscoveryRowProcessed(row);
    });
    if (!editable.length) {
      sel.value = '';
      await showModal({
        title: 'Nothing to update',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml:
          '<p>Selected rows are already processed, tracked, or ignored. Reopen them first, or select editable rows.</p>',
      });
      return;
    }
    const updates = editable.map((idx) => {
      const fromDom = discoveryDecisionUpdateFromDom(idx);
      return {
        index: idx,
        human_decision,
        decision_notes: fromDom?.decision_notes ?? state.discoveryRows[idx]?.decision_notes ?? '',
      };
    });
    try {
      await persistDiscoveryDecisions(updates);
      updateDiscoveryStepChecks(
        state.discoveryBatches.find((b) => b.id === state.discoveryBatchId) || {
          id: state.discoveryBatchId,
        },
        state.discoveryRows,
      );
      updateDiscoveryProcessControls();
      renderDiscoveryTable();
    } catch (error) {
      await showModal({
        title: 'Save failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      sel.value = '';
    }
  });
  discoveryTbody?.addEventListener('input', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (el.dataset.field !== 'decision_notes') return;
    const idx = Number(el.dataset.idx);
    if (!Number.isFinite(idx)) return;
    setElementTip(el, el.value);
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

  document.getElementById('discovery-reopen-selected')?.addEventListener('click', async () => {
    const indices = [...state.discoverySelected].filter((idx) =>
      isDiscoveryRowProcessed(state.discoveryRows[idx]),
    );
    if (!indices.length) {
      await showModal({
        title: 'Nothing to reopen',
        confirmLabel: 'OK',
        bodyHtml: '<p>Select processed, tracked, or ignored rows first.</p>',
      });
      return;
    }
    const ok = await showModal({
      title: 'Reopen selected rows?',
      confirmLabel: `Reopen ${indices.length}`,
      bodyHtml:
        '<p>Clears processed/tracked/ignored markers so you can change Decision and Process again. Existing Candidate files are kept.</p>',
    });
    if (!ok) return;
    await reopenDiscoveryIndices(indices);
  });

  document.getElementById('discovery-backfill-light-serp')?.addEventListener('click', async () => {
    if (!state.discoveryBatchId) return;
    const btn = document.getElementById('discovery-backfill-light-serp');
    if (btn) btn.disabled = true;
    try {
      const result = await api(
        `/api/discovery/batches/${encodeURIComponent(state.discoveryBatchId)}/backfill-light-serp`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      await loadCandidates();
      await showModal({
        title: 'Light SERP backfill complete',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>Updated <strong>${esc(String(result.updatedCount ?? 0))}</strong> Candidate seed(s).</p>
          <p class="muted">Skipped ${esc(String(result.skippedCount ?? 0))} (no Light SERP columns) · missing Candidate ${esc(
            String(result.missingCount ?? 0),
          )}.</p>
          <p>Open <strong>Research</strong> — Map Pack / Homepages / Subpages should show from Discovery until you run Eval 1 · SERP / Volume.</p>`,
      });
    } catch (error) {
      await showModal({
        title: 'Backfill failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      updateDiscoveryProcessControls();
    }
  });

  document.getElementById('discovery-known-open')?.addEventListener('click', async () => {
    try {
      await enterDiscoveryKnownMode();
    } catch (error) {
      await showModal({
        title: 'Could not load anti-dupe list',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('discovery-known-back')?.addEventListener('click', () => {
    exitDiscoveryKnownMode();
  });

  document.getElementById('discovery-known-remove')?.addEventListener('click', async () => {
    const keys = [...state.discoveryKnownSelected];
    if (!keys.length) return;
    const selectedRows = state.discoveryKnownRows.filter((r) =>
      keys.includes(discoveryKnownRowKey(r)),
    );
    const candN = selectedRows.filter((r) => r.source === 'candidate').length;
    const trackedN = selectedRows.length - candN;
    const ok = await showModal({
      title: 'Remove from do-not-repropose?',
      confirmLabel: `Remove ${selectedRows.length}`,
      bodyHtml: `<p>Remove <strong>${esc(String(selectedRows.length))}</strong> selected pair(s).</p>
        <ul>
          <li><strong>${esc(String(candN))}</strong> Candidate — permanently deleted from Research</li>
          <li><strong>${esc(String(trackedN))}</strong> Tracked-only — unblocked for Claude</li>
        </ul>`,
    });
    if (!ok) return;
    try {
      const result = await api('/api/discovery/known/remove', {
        method: 'POST',
        body: JSON.stringify({
          keys: selectedRows.map((r) => ({ niche: r.niche, city: r.city, state: r.state })),
        }),
      });
      state.discoveryKnownRows = Array.isArray(result.rows) ? result.rows : [];
      state.discoveryKnownSelected = new Set();
      state.discoveryKnownCheckAnchor = null;
      const sub = document.getElementById('discovery-known-sub');
      if (sub) {
        const n = state.discoveryKnownRows.length;
        const cand = state.discoveryKnownRows.filter((r) => r.source === 'candidate').length;
        sub.textContent = `${n} pairs · ${cand} Candidate · ${n - cand} Tracked`;
      }
      await loadCandidates();
      renderDiscoveryTable();
    } catch (error) {
      await showModal({
        title: 'Remove failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('discovery-known-prune')?.addEventListener('click', async () => {
    try {
      const data = await api('/api/discovery/known');
      const p = data.prunePreview || {};
      const ok = await showModal({
        title: 'Wipe do-not-repropose to Active Research?',
        confirmLabel: 'Wipe',
        bodyHtml: `<p>Keep <strong>${esc(String(p.keepCount ?? 0))}</strong> Active Candidates.</p>
          <ul>
            <li>Permanently delete <strong>${esc(String(p.archivedDeleteCount ?? 0))}</strong> archived / orphan Candidate id(s)</li>
            <li>Skip <strong>${esc(String(p.archivedProtectedCount ?? 0))}</strong> archived Website/Launched (never deleted)</li>
            <li>Drop <strong>${esc(String(p.trackedDropCount ?? 0))}</strong> tracked-only pair(s) outside Active</li>
          </ul>
          <p class="muted">After wipe, the editor list shows orphans + Research Eval 1 only. Full anti-dupe CSV for Claude is unchanged.</p>`,
      });
      if (!ok) return;
      const result = await api('/api/discovery/known/prune-to-active', { method: 'POST', body: '{}' });
      await loadCandidates();
      if (state.discoveryKnownMode) {
        state.discoveryKnownRows = Array.isArray(result.rows) ? result.rows : [];
        state.discoveryKnownSelected = new Set();
        state.discoveryKnownCheckAnchor = null;
        const sub = document.getElementById('discovery-known-sub');
        if (sub) {
          const n = state.discoveryKnownRows.length;
          const cand = state.discoveryKnownRows.filter((r) => r.source === 'candidate').length;
          sub.textContent = `${n} pairs · ${cand} Candidate · ${n - cand} Tracked`;
        }
        renderDiscoveryTable();
      }
      await showModal({
        title: 'Wipe complete',
        confirmLabel: 'OK',
        bodyHtml: `<p>Kept <strong>${esc(String(result.keepCount ?? 0))}</strong> Active.
          Deleted <strong>${esc(String(result.archivedDeleted ?? 0))}</strong> archived/orphan.
          Dropped <strong>${esc(String(result.trackedDropped ?? 0))}</strong> tracked.
          Known list now <strong>${esc(String(result.knownCount ?? 0))}</strong>.</p>`,
      });
    } catch (error) {
      await showModal({
        title: 'Wipe failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  });

  document.getElementById('discovery-process-btn')?.addEventListener('click', async () => {
    if (!state.discoveryBatchId) return;
    // Flush any pending notes timers, then persist all DOM edits
    for (const timer of discoveryNotesSaveTimers.values()) clearTimeout(timer);
    discoveryNotesSaveTimers.clear();
    const updates = state.discoveryRows
      .map((_, idx) => discoveryDecisionUpdateFromDom(idx))
      .filter(Boolean);
    await persistDiscoveryDecisions(updates);

    const withDecision = state.discoveryRows.filter(isDiscoveryRowPendingProcess);
    const alreadyCount = state.discoveryRows.filter(isDiscoveryRowProcessed).length;
    const pursueCount = withDecision.filter((r) => r.human_decision === 'pursue').length;
    const promoteCount = withDecision.filter((r) =>
      ['pursue', 'maybe', 'review', 'hold'].includes(r.human_decision),
    ).length;
    const trackCount = withDecision.filter((r) => r.human_decision === 'pass').length;
    const ignoreCount = withDecision.filter((r) => r.human_decision === 'ignore').length;
    if (!withDecision.length) {
      await showModal({
        title: 'Nothing to process',
        confirmLabel: 'OK',
        bodyHtml: alreadyCount
          ? '<p>All decided rows are already processed. Set decisions on remaining rows, Reopen tracked/ignored rows, or open Candidates.</p>'
          : '<p>Set Decisions (or Accept recommendations) first.</p>',
      });
      return;
    }
    const estLow = (pursueCount * 0.2).toFixed(2);
    const estHigh = (pursueCount * 1.5).toFixed(2);
    const adsMode = getAdsMode();
    const adsLine =
      pursueCount > 0
        ? `<p><strong>SERP / Volume Ads mode:</strong> ${
            adsMode === 'standard'
              ? 'Standard queue (cheaper, slower — overnight OK)'
              : 'Live (faster)'
          }. Change on Research → Ad volumes.</p>`
        : '';
    const ok = await showModal({
      title: 'Process discovery batch?',
      confirmLabel: pursueCount
        ? `Process + SERP / Volume (${pursueCount} pursue)`
        : 'Process',
      bodyHtml: `<p><strong>${esc(String(promoteCount))}</strong> → Candidates · <strong>${esc(
        String(trackCount),
      )}</strong> tracked (pass) · <strong>${esc(String(ignoreCount))}</strong> ignored · already done ${esc(
        String(alreadyCount),
      )}.</p>
        <p><strong>Pursue → SERP / Volume:</strong> ${esc(String(pursueCount))} · est. $${esc(estLow)}–$${esc(estHigh)} DFS</p>
        ${adsLine}
        <p class="muted">Ignore skips this batch without blocking rediscovery. Pass tracks (anti-dupe) without Candidates.</p>`,
    });
    if (!ok) return;
    try {
      const batchId = state.discoveryBatchId;
      const result = await api(
        `/api/discovery/batches/${encodeURIComponent(batchId)}/process`,
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
      await loadDiscoveryBatches();
      if (result.batchJob?.id) {
        state.activeBatchJobId = result.batchJob.id;
        state.activeAct = 'research';
        pollBatchJob(result.batchJob.id);
      }
      const alreadySkipped = (result.skipped || []).filter(
        (s) => s.reason === 'already processed',
      ).length;
      const fullyDone =
        (result.rows || []).length > 0 &&
        (result.rows || []).every((r) => isDiscoveryRowProcessed(r));
      const openCandidates =
        fullyDone && (result.promoted?.length || 0) > 0;
      await showModal({
        title: fullyDone ? 'Batch fully processed' : 'Batch processed',
        confirmLabel: openCandidates ? 'Open Research' : 'OK',
        bodyHtml: `<p>+<strong>${esc(String(result.promoted?.length || 0))}</strong> Candidates · ○<strong>${esc(
          String(result.tracked?.length || 0),
        )}</strong> tracked · ░<strong>${esc(
          String(result.ignored?.length || 0),
        )}</strong> ignored · skipped ${esc(String(result.skipped?.length || 0))}${
          alreadySkipped
            ? ` (${esc(String(alreadySkipped))} already processed)`
            : ''
        } · SERP / Volume queued for ${esc(String(result.pursueIds?.length || 0))} pursue.${
          (result.promoted || []).some((p) => p.linkedExisting)
            ? ` · ${esc(
                String((result.promoted || []).filter((p) => p.linkedExisting).length),
              )} linked to existing candidates (anti-dupe).`
            : ''
        }</p><p class="muted">${
          openCandidates
            ? 'Switching to Research filtered to this batch.'
            : 'Pass is tracked (anti-dupe). Ignore stays rediscoverable. Reopen a row to change your mind.'
        }</p>`,
      });
      updateDiscoveryStepChecks(result.batch, result.rows);
      if (openCandidates) {
        state.candidateBatchFilter = batchId;
        fillCandidateBatchFilterSelect();
        setView('research');
        renderList();
        renderActions();
      }
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
  const bar = progress?.querySelector('.job-progress-bar');
  if (progress) progress.classList.remove('hidden');
  const tick = async () => {
    try {
      const batch = await api(`/api/jobs/batches/${encodeURIComponent(batchJobId)}`);
      state.lastBatchJob = batch;
      const total = batch.children?.length || 0;
      const done = (batch.done || 0) + (batch.failed || 0);
      setDeterminateProgress(bar, { done, total });
      const failBits = (batch.children || [])
        .filter((c) => c.status === 'error')
        .slice(0, 2)
        .map((c) => `${c.candidateId}: ${c.error || 'error'}`)
        .join(' · ');
      if (detailEl) {
        const stepBits = (batch.children || [])
          .filter((c) => c.status === 'running' && c.step)
          .slice(0, 2)
          .map((c) => `${c.candidateId}: ${jobActLabel(c.step)}`)
          .join(' · ');
        detailEl.textContent = `${jobActLabel(batch.act)}: ${done}/${total} finished · ${
          batch.running || 0
        } running · ${batch.pending || 0} queued${stepBits ? ` · ${stepBits}` : ''}${
          failBits ? ` · ${failBits}` : ''
        }`;
      }
      state.jobStatusLine = detailEl?.textContent || '';
      if (state.selectedIds.size > 1) renderMultiDetail();
      if (batch.status === 'running') {
        state.pollTimer = setTimeout(tick, 800);
        return;
      }
      state.activeBatchJobId = null;
      state.activeAct = null;
      setDeterminateProgress(bar, {});
      if (progress) progress.classList.add('hidden');
      if (batch.status === 'ok' || batch.status === 'done') {
        announceStepComplete(`Batch ${jobActLabel(batch.act)}`);
      } else {
        announceBanner(`Batch ${jobActLabel(batch.act)} failed`, { tone: 'err' });
      }
      await loadCandidates();
      if (state.selectedIds.size > 1) renderMultiDetail();
      else if (state.selectedId) {
        await loadSelectedCandidateDetail(state.selectedId);
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
      setDeterminateProgress(bar, {});
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

try {
  await loadHealth();
  void loadApiCost();
  startBalancePolling();
  await loadRubric();
  wireSettingsUi();
  wireApiCostUi();
  wireJobsUi();
  wireHelpUi();
  await loadConcurrencySettings();
  wireUi();
  syncClaudeModeToggle();
  renderDiscoverySourceLegend();
  const restorePeek = peekClaudeUiRestore();
  const restoreView = CLAUDE_UI_VIEWS.has(restorePeek?.view) ? restorePeek.view : 'discovery';
  setView(restoreView);
  try {
    await loadDiscoveryPresets();
    await loadDiscoveryBatches();
  } catch {
    /* discovery optional until server restart */
  }
  await loadCandidates();
} finally {
  hideAppBootLoading();
}
startJobStreamLeader();
wireCandidatesBroadcast();
await applyClaudeUiRestore();
