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
} from './research-map.js?v=20260818map1';
import {
  mountServiceAreaMap,
  mountDiscoveryCitiesMap,
  setServiceAreaTableMode,
  setDiscoveryTableMapMode,
} from './service-area-map.js?v=20260819pages';

/** @type {{ destroy: () => void, invalidateSize?: () => void } | null} */
let serviceAreaMount = null;
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
  candidateDecisionFilter: '',
  candidateStageFilter: '',
  candidateBatchFilter: '',
  candidateGroupFilter: '',
  candidateVisibilityFilter: 'active',
  candidateTextFilter: '',
  candidateGroups: [],
  archivedCount: 0,
  candidateSort: { key: 'proposedScore', dir: -1 },
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
  assembleProgress: { visible: false, detail: '' },
  /** Site-Config → Find addresses in-flight (survives re-render). */
  baSearchBusy: false,
  /** 'find' | 'refresh' while baSearchBusy */
  baSearchMode: 'find',
  /** Cached Apify prepaid usage from last Find or /api/apify/usage */
  apifyPlanUsage: null,
  /** Keep Prepare step open while Prepare preview is running. */
  preparePreviewHold: false,
  preparePreviewJobId: null,
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
  imageMatchFilter: 'all',
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
  discoverySort: { key: null, dir: 1 },
  discoveryFilters: { text: '', human: '', rec: '', mapPack: '' },
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
    if (data.twilioSid) err.twilioSid = data.twilioSid;
    if (data.e164) err.e164 = data.e164;
    throw err;
  }
  return data;
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

/** Non-blocking status — prefer over dismiss-only OK modals on happy paths. */
function showToast(message, { tone = 'ok', ms = 4200 } = {}) {
  let el = document.getElementById('ops-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ops-toast';
    el.className = 'ops-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = String(message || '').trim();
  el.classList.remove('hidden', 'tone-ok', 'tone-warn', 'tone-err');
  el.classList.add(`tone-${tone === 'warn' ? 'warn' : tone === 'err' ? 'err' : 'ok'}`);
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.classList.add('hidden');
  }, ms);
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
    for (const name of cfg.targetSuburbs || []) {
      const slug = slugifyPreviewName(name);
      if (slug) files.push(`src/content/locations/${slug}.md`);
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

/** Shared incomplete-draft copy for modal + Content callouts */
function incompleteDraftExplainHtml({
  have,
  expectedCount,
  missing,
  stubs = [],
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
  const howTo = `<ol class="narrative-list" style="margin:0.4rem 0 0;padding-left:1.25rem">
      <li>Stay on <strong>Content → Full write</strong> (do not Accept yet).</li>
      <li>Click <strong>Copy continue prompt</strong> → paste into Claude.ai (Open Claude.ai optional).</li>
      <li>Copy Claude’s new <code>### FILE:</code> blocks → paste into <strong>Paste FILE blocks</strong>.</li>
      <li>Click <strong>Load FILE blocks as draft</strong> again (Rover merges; gaps should clear).</li>
      <li>Repeat if Claude truncates again, then <strong>Accept</strong>.</li>
    </ol>`;
  const whyHappens = miss.length
    ? `<p style="margin:0.35rem 0 0"><strong>Why this happens:</strong> Claude has a limit on how long a single reply can be. A full site write is large, so it often stops mid-way and leaves later pages (usually locations) out. That is normal — use <strong>Copy continue prompt</strong> to finish the rest.</p>`
    : `<p style="margin:0.35rem 0 0"><strong>Why this happens:</strong> Seed stubs or a truncated Claude reply can leave service/location pages too thin for Accept. Use <strong>Copy continue prompt</strong> to rewrite those files fully.</p>`;
  const gate = `<p style="margin:0.35rem 0 0"><strong>Does this block you?</strong> Not on Content — you can keep loading chunks. You need all non-stub files before <strong>Accept</strong> / <strong>Prepare preview</strong> for a full site.</p>`;
  const controls = showContinueControls ? continueWriteControlsHtml({ sm: compact }) : '';
  const missBlock = miss.length
    ? `<details class="narrative-raw" style="margin-top:0.5rem" ${compact ? 'open' : ''}>
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
  if (compact) {
    return `<div class="callout warn">
      <p style="margin:0">${progress}${
        miss.length ? ` Missing ${esc(String(miss.length))} file(s).` : ''
      }${stubList.length ? ` ${esc(String(stubList.length))} stub/thin.` : ''}</p>
      ${whyHappens}
      ${gate}
      <p style="margin:0.35rem 0 0"><strong>How to finish</strong></p>
      ${howTo}
      ${controls}
      ${missBlock}
      ${stubBlock}
    </div>`;
  }
  return `<div class="callout warn">
      <p style="margin:0 0 0.35rem">${progress}</p>
      ${whyHappens}
      ${gate}
      <p style="margin:0.5rem 0 0"><strong>How to finish</strong></p>
      ${howTo}
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

function normalizeThemeId(raw) {
  if (raw === 'dark') return '4';
  if (raw === 'light') return '1';
  const id = String(raw || '').trim();
  return /^[1-6]$/.test(id) ? id : '1';
}

function getTheme() {
  try {
    return normalizeThemeId(localStorage.getItem('ops.theme'));
  } catch {
    return '1';
  }
}

function applyTheme(theme) {
  const next = normalizeThemeId(theme);
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('ops.theme', next);
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

function closeJobsPopover() {
  const pop = document.getElementById('jobs-popover');
  const btn = document.getElementById('jobs-btn');
  if (pop) pop.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function syncSettingsJobsK(concurrency) {
  const sel = document.getElementById('settings-jobs-k');
  if (!sel) return;
  const n = Number(concurrency);
  if (!Number.isFinite(n) || n < 1) return;
  const v = String(Math.max(1, Math.min(6, Math.round(n))));
  if (sel.value !== v) sel.value = v;
}

function renderHeavyJobs(snap) {
  const badge = document.getElementById('jobs-badge');
  const meta = document.getElementById('jobs-popover-meta');
  const list = document.getElementById('jobs-popover-list');
  if (!badge || !list) return;
  syncSettingsJobsK(snap?.concurrency);
  const active = Number(snap?.activeCount || 0);
  if (active > 0) {
    badge.textContent = String(active);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
  if (meta) {
    meta.textContent = `K=${snap?.concurrency ?? '—'} · ${snap?.running ?? 0} running · ${snap?.queued ?? 0} queued`;
  }
  const jobs = Array.isArray(snap?.jobs) ? snap.jobs : [];
  const activeJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const activeIds = new Set(activeJobs.map((j) => String(j.candidateId || '')));
  const recentJobs = jobs
    .filter((j) => j.status === 'done' || j.status === 'error')
    .filter((j) => !activeIds.has(String(j.candidateId || '')))
    .slice(0, 5);
  const renderRow = (j) => {
    const status = esc(j.status || '');
    const phase = esc(j.label || j.phase || '');
    const id = esc(j.candidateId || '');
    const detail = j.detail || j.error || '';
    return `<button type="button" class="jobs-row" data-jobs-candidate="${id}">
        <span class="jobs-row-id">${id}</span>
        <span class="jobs-row-status ${status}">${status}</span>
        <span class="jobs-row-meta">${phase}${detail ? ` · ${esc(detail)}` : ''}</span>
      </button>`;
  };
  if (!activeJobs.length && !recentJobs.length) {
    list.innerHTML = `<p class="muted small jobs-empty">No jobs running.</p>`;
    return;
  }
  let html = '';
  if (activeJobs.length) {
    html += activeJobs.map(renderRow).join('');
  } else {
    html += `<p class="muted small jobs-empty">No jobs running.</p>`;
  }
  if (recentJobs.length && activeJobs.length) {
    html += `<p class="muted small jobs-recent-label">Recent</p>`;
    html += recentJobs.map(renderRow).join('');
  } else if (recentJobs.length && !activeJobs.length) {
    html += `<p class="muted small jobs-recent-label">Recent</p>`;
    html += recentJobs.map(renderRow).join('');
  }
  list.innerHTML = html;
  list.querySelectorAll('[data-jobs-candidate]').forEach((row) => {
    row.addEventListener('click', () => {
      const cid = row.getAttribute('data-jobs-candidate');
      closeJobsPopover();
      if (cid && typeof selectCandidate === 'function') {
        try {
          selectCandidate(cid);
        } catch {
          /* ignore */
        }
      }
    });
  });
}

function wireJobsUi() {
  const btn = document.getElementById('jobs-btn');
  const pop = document.getElementById('jobs-popover');
  if (!btn || !pop) return;

  /** @type {number} last applied snapshot seq (0 = none) */
  let lastAppliedSeq = 0;
  /** @type {BroadcastChannel | null} */
  let bc = null;
  try {
    bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rover-heavy-jobs') : null;
  } catch {
    bc = null;
  }

  const snapSeq = (snap) => {
    const seq = Number(snap?.seq);
    return Number.isFinite(seq) && seq > 0 ? seq : 0;
  };

  const applySnap = (snap, { broadcast = true } = {}) => {
    if (!snap || typeof snap !== 'object') return;
    const seq = snapSeq(snap);
    // Prefer monotonic seq. If seq is missing, always apply (never use Date.now as watermark).
    if (seq > 0) {
      if (seq < lastAppliedSeq) return;
      lastAppliedSeq = seq;
    }
    try {
      renderHeavyJobs(snap);
      syncPrepareProgressFromJobs(snap);
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
      if (seq > 0 && seq < lastAppliedSeq) return;
      applySnap(data.snap, { broadcast: false });
    };
  }

  const poll = async () => {
    try {
      const snap = await api('/api/heavy-jobs');
      applySnap(snap);
    } catch {
      /* ignore */
    }
  };

  const pollIfVisible = () => {
    if (document.visibilityState === 'visible') poll();
  };

  let es = null;
  try {
    es = new EventSource('/api/heavy-jobs/stream');
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
  } catch {
    es = null;
  }
  setInterval(poll, 2000);
  poll();
  document.addEventListener('visibilitychange', pollIfVisible);
  window.addEventListener('focus', pollIfVisible);

  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = pop.classList.contains('hidden');
    if (willOpen) {
      closeSettingsMenu();
      pop.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      poll();
    } else {
      closeJobsPopover();
    }
  });
  pop.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', () => closeJobsPopover());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeJobsPopover();
  });
}

function wireSettingsUi() {
  const btn = document.getElementById('settings-btn');
  const menu = document.getElementById('settings-menu');
  if (!btn || !menu) return;

  applyTheme(getTheme());

  const jobsK = document.getElementById('settings-jobs-k');
  const syncJobsKFromServer = async () => {
    try {
      const snap = await api('/api/heavy-jobs');
      syncSettingsJobsK(snap?.concurrency ?? 2);
    } catch {
      /* ignore */
    }
  };
  void syncJobsKFromServer();
  jobsK?.addEventListener('change', async () => {
    const n = Number(jobsK.value);
    jobsK.disabled = true;
    try {
      const snap = await api('/api/heavy-jobs/concurrency', {
        method: 'POST',
        body: JSON.stringify({ concurrency: n }),
      });
      syncSettingsJobsK(snap?.concurrency ?? n);
      showToast(`Jobs concurrency set to K=${snap?.concurrency ?? n}.`);
    } catch (error) {
      showToast(error?.message || 'Could not update Jobs K.', { tone: 'err' });
      void syncJobsKFromServer();
    } finally {
      jobsK.disabled = false;
    }
  });

  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = menu.classList.contains('hidden');
    if (open) {
      hideOpsTooltip();
      menu.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      void syncJobsKFromServer();
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
    return;
  }
  if (!b.ok || b.balance == null) {
    el.classList.add('err');
    el.textContent = 'DFS balance —';
    return;
  }
  const bal = Number(b.balance);
  el.classList.add(bal < 1 ? 'warn' : 'ok');
  el.textContent = `DFS ${formatMoney(bal)}`;
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
    if (stageF && c.stage !== stageF) return false;
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
    key: 'researchMap',
    label: 'Map',
    tip: 'Open research Map tab zoomed to this city',
    sortable: false,
    cellClass: 'col-short',
    source: 'ops',
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
    label: 'Search vol.',
    tip: 'Stage 1 Ads Planner cluster search volume / month (sum across measured geos).',
    sortable: true,
    cellClass: 'col-truncate',
    source: 'dfs',
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
    label: 'Homepages',
    tip: 'Niche-relevant / all organic homepages (title+URL token match). Directories excluded.',
    sortable: true,
    cellClass: 'col-short',
    source: 'dfs',
  },
  {
    key: 'orgSub',
    label: 'Subpages',
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
    label: 'Openness',
    tip: 'Organic openness 1–10. Higher = more open / better for you.',
    sortable: true,
    cellClass: 'col-score-metric',
    source: 'ops',
  },
  {
    key: 'disp',
    label: 'Displace.',
    tip: 'Stage 2 — Displaceability 1–10. Higher = easier to outrank.',
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
  const disable = state.selectedIds.size === 0;
  if (batchSel) batchSel.disabled = disable;
  if (batchBtn) batchBtn.disabled = disable;
  if (groupAction) groupAction.disabled = disable;
  if (groupAddBtn) groupAddBtn.disabled = disable;
  if (groupRemoveBtn) groupRemoveBtn.disabled = disable;
  if (addToSitesBtn) addToSitesBtn.disabled = disable;
  if (archiveBtn) archiveBtn.disabled = disable;
  if (unarchiveBtn) unarchiveBtn.disabled = disable;
}

function emptyStateForFilter() {
  const f = state.candidateDecisionFilter;
  const vis = state.candidateVisibilityFilter || 'active';
  if (!state.candidates.length) {
    return 'No candidates yet — Process a discovery batch (all decisions land in groups here).';
  }
  if (state.view === 'website-builder' && !state.candidates.some((c) => c.decision === 'pursue' && !c.archived)) {
    return 'No pursue Candidates yet — mark pursue in Research to open Website Builder.';
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
  if (f === 'pass' || f === 'deprioritize' || f === 'pass_unless_gbp_angle') {
    return `No ${f} candidates — archive groups fill when you Process discovery rows with that decision.`;
  }
  if (f === '__undecided') return 'No undecided candidates.';
  if (state.candidateStageFilter) {
    return `No candidates in stage “${state.candidateStageFilter}” for this filter.`;
  }
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
      return `<th data-tip="${esc(c.tip || '')}"><input type="checkbox" id="candidate-select-all" data-tip="Select filtered" /></th>`;
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
      else state.candidateSort = { key, dir: key === 'proposedScore' ? -1 : 1 };
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
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      const id = cb.dataset.id;
      if (cb.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
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
        const sole = [...state.selectedIds][0];
        // Open detail follows the sole checkbox so rail actions match the panel
        void selectCandidate(sole);
      } else {
        renderList();
        renderActions();
        if (state.selectedId) renderDetail();
        else syncCandidatesDetailVisibility();
      }
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
  state.assembleProgress = { visible: false, detail: '' };
  state.preparePreviewHold = false;
  state.preparePreviewJobId = null;
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
}

function stageCheckMark() {
  return `<span class="stage-check" ${tipAttr('Completed')}>✓</span>`;
}

function stageDraftMark() {
  return `<span class="stage-draft" ${tipAttr('Draft present (not accepted yet)')}>draft</span>`;
}

function updateTabCompletion() {
  const f = state.detail?.stageFlags || {};
  const labels = {
    overview: 'Overview',
    serp: '1 · Research',
    keywords: '1 · Keywords',
    enrichment: '2 · Enrich',
    narrative: '3 · Narrative',
    'site-config': '4 · Site-Config',
    content: '5 · Content',
    website: '6 · Website',
    prospects: 'Prospects',
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
      draft =
        (Boolean(f.hasContentDraft) || Boolean(f.hasContentBrief)) && !f.hasContent;
    }
    if (key === 'website') {
      const meta = state.detail?.meta || {};
      done = Boolean(meta.lastShipAt || meta.cloudflarePagesDone || meta.dnsDone);
      draft = Boolean(meta.lastAssembleAt || meta.lastSiteStagingAt) && !done;
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
      setElementTip(tab, 'Stage 1 · keyword volumes from research');
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

  if (targetCount === 0) {
    el.innerHTML = `
      <div class="stage-rail-head">Stages</div>
      <p class="stage-toolbar-meta muted">Select rows, then run Stage 1–4 on the selection.</p>
    `;
    return;
  }

  const agg = isMulti ? aggregateSelectedFlags() : null;
  const focusedId = isMulti ? null : state.selectedId;
  const listRow = focusedId
    ? state.candidates.find((c) => c.id === focusedId)
    : null;
  const detailMatches = Boolean(d && focusedId && d.id === focusedId);
  const f = detailMatches
    ? d.stageFlags || {}
    : listRow?.stageFlags || d?.stageFlags || {};
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
  const currentStage = !researchDone
    ? 'research'
    : !enrichDone
      ? 'enrich'
      : !narrAccepted
        ? 'narrative'
        : null;
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
  const lc = (detailMatches ? d?.meta?.lastCosts : null) || listRow?.lastCosts || d?.meta?.lastCosts || {};
  const costBits = [
    lc.research != null ? `Research ${formatMoney(lc.research)}` : null,
    lc.enrich != null ? `Enrich ${formatMoney(lc.enrich)}` : null,
    lc.narrative != null ? `Narrative ~${formatMoney(lc.narrative)}` : null,
    lc.prospects != null ? `Prospects ${formatMoney(lc.prospects)}` : null,
    lc.outreach != null ? `Outreach ~${formatMoney(lc.outreach)}` : null,
  ].filter(Boolean);
  const metaBits = [
    isMulti ? `${targetCount} selected` : null,
    costBits.length && !isMulti ? `Last: ${costBits.join(' · ')}` : null,
  ].filter(Boolean);

  el.innerHTML = `
    <div
      class="actions-toolbar"
      data-tip="✓ = stage has data. Select rows to batch Stage 1–4. Narrative Accept/Reject is on the Narrative tab (or multi-queue when several drafts)."
    >
      <div class="action-group stage-1${researchDone ? ' action-done' : ''}${
        runningAct === 'research' ? ' action-running' : ''
      }${currentStage === 'research' ? ' current' : ''}">
        <span class="action-group-head"><span class="action-group-title">Research</span><span class="action-group-num">1${
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
          <button type="button" class="btn btn-sm primary" data-act="enrich" data-tip="Stage 2 — page fetch, Domain Rank, thinness / displaceability" ${stageBusyAttr('enrich')}>${
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
          <button type="button" class="btn btn-sm primary" data-act="copy-prompt" ${
            busy || targetCount > 1 ? 'disabled' : ''
          } data-tip="Copy Claude.ai prompt, then paste the JSON result on the Narrative tab (default — no API cost)">Copy prompt</button>
          ${openClaudeAiBtnHtml({ disabled: busy || targetCount > 1, sm: true })}
        </div>
      </div>
      <span class="stage-rail-sep" aria-hidden="true"></span>
      <div class="action-group stage-4${prospectsDone ? ' action-done' : ''}${
        runningAct === 'prospects' || runningAct === 'outreach' ? ' action-running' : ''
      }">
        <span class="action-group-head"><span class="action-group-title">Prospects</span><span class="action-group-num">${
          prospectsDone
            ? stageCheckMark()
            : targetCount > 1
              ? aggMark(agg.hasProspects, agg.count)
              : ''
        }</span></span>
        <div class="action-group-btns">
          <button type="button" class="btn btn-sm" data-act="prospects" data-tip="Find local businesses via Maps SERP (optional)" ${stageBusyAttr(
            'prospects',
          )}>${
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
        ? `<p class="stage-toolbar-meta muted" data-tip="Last recorded run costs">${esc(
            metaBits.join(' · '),
          )}</p>`
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
        <p>Stage 1 will <strong>keep</strong> Domain Rank / thinness. If Map Pack/organic URLs change, enrichment is marked <strong>stale</strong> — re-run Enrich when you want fresh Rank.</p>`,
    });
  }
  return showModal({
    title: 'Stage 1 will keep enrichment',
    confirmLabel: 'Continue',
    bodyHtml: `<p><strong>${esc(String(enriched.length))}</strong> selected candidate(s) already have Stage 2 enrichment.</p>
      <p>Ad volumes will re-pull (main cost). Map Pack/organic stays cached unless you check <strong>Force new SERP</strong>.</p>`,
  });
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
    if (act === 'research' || act === 'enrich' || act === 'prospects' || act === 'narrative') {
      if (state.activeJobId || state.activeBatchJobId || state.claudeBusy) return;
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
      showToast('Narrative prompt copied — paste Claude’s JSON → Load as draft → Accept.');
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
      state.detail = await api(`/api/candidates/${encodeURIComponent(singleId)}`);
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
  if (!serp) return '<p class="muted">No research yet — run Stage 1 (blue group).</p>';
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
      'Exact-match domain flag for every organic row. Niche tokens appear in the domain with hyphens stripped. Display heuristic — not used in proposedScore. Older JSON without looksEmd shows No until Stage 1 re-annotates.',
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
  ];

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
    ? `<div class="callout warn"><strong>Enrichment stale</strong> — Stage 1 SERP URLs changed since this Rank/thinness run (${esc(
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
  return `
    <div class="narrative-paste">
      ${hideHeading ? '' : `<h3>${replace ? 'Replace draft from paste' : 'Paste Claude.ai JSON'}</h3>`}
      <p class="muted">Copy Claude’s JSON response, paste below, then Load as draft. Review the readable summary, then Accept draft or Reject draft.</p>
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
  const parts = [];
  parts.push(
    panelHowToHtml({
      label: 'Narrative',
      info: 'Copy prompt → Claude.ai → paste JSON → Load as draft → Accept. Optional Anthropic API draft is on the stage rail only when a key is set — never required.',
    }),
  );
  if (busy) {
    parts.push(`<div class="callout warn">Calling Claude… results will appear here when ready.</div>`);
  }
  if (draft) {
    parts.push(narrativeReviewHtml(draft, { pending: true }));
    parts.push(narrativePasteBoxHtml({ replace: true }));
  } else if (accepted) {
    parts.push(`
      <details class="narrative-replace">
        <summary>Replace draft from paste</summary>
        ${narrativePasteBoxHtml({ replace: true, hideHeading: true })}
      </details>
    `);
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
    radiusMiles: document.getElementById('sc-radius')?.value?.trim() || prev.radiusMiles || '40',
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

function serviceNamesBulletHtml(names) {
  const list = (names || []).map((n) => String(n || '').trim()).filter(Boolean);
  if (!list.length) return '<p class="muted" style="margin:0.25rem 0">None</p>';
  return `<ul class="narrative-list ca-svc-choice-list">${list.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
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
  const hasCommercial = com.length > 0;
  const keepId =
    mode === 'accepted' ? 'site-config-accept-keep-commercial' : 'site-config-accept-with-commercial';
  const residentialId =
    mode === 'accepted' ? 'site-config-accept-residential-only-update' : 'site-config-accept-residential-only';
  const singleAcceptId = mode === 'accepted' ? 'site-config-reaccept-btn' : 'site-config-accept-btn';
  const keepLabel = mode === 'accepted' ? 'Keep commercial' : 'Accept with commercial';
  const resLabel = mode === 'accepted' ? 'Update to residential only' : 'Accept residential only';

  const actions = hasCommercial
    ? `<div class="narrative-actions" style="justify-content:flex-start;flex-wrap:wrap;gap:0.5rem">
        <button type="button" class="btn primary" id="${esc(keepId)}" data-tip="Keep commercial list — homepage shows Residential + Commercial grids">${esc(keepLabel)}</button>
        <button type="button" class="btn" id="${esc(residentialId)}" data-tip="Clear commercialServices — one What we do grid, fewer card photos. No Claude re-prompt.">${esc(resLabel)}</button>
      </div>
      <p class="muted" style="margin:0.35rem 0 0;font-size:0.85rem">Residential only = one What we do grid. Commercial = second grid (needs more card photos). No new Claude prompt either way.</p>`
    : `<div class="narrative-actions" style="justify-content:flex-start">
        <button type="button" class="btn primary" id="${esc(singleAcceptId)}" data-tip="Write site-config and unlock Content">${
          mode === 'accepted' ? 'Re-write site-config' : 'Accept site-config'
        }</button>
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
        ${serviceNamesBulletHtml(res)}
      </div>
      <div>
        <p class="muted" style="margin:0 0 0.25rem;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.04em">Commercial (optional homepage split)</p>
        ${serviceNamesBulletHtml(com)}
      </div>
    </div>
    ${actions}
  </div>`;
}

const BA_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  return `<div class="ba-plan-usage" style="margin-top:0.35rem">
    <div class="muted small">Apify prepaid: <strong>${baFormatUsd(used)}</strong> used · <strong>${baFormatUsd(
      rem,
    )}</strong> left of ${baFormatUsd(max)} (${pct}%)</div>
    <div class="job-progress-track" style="height:6px;margin-top:0.25rem"><div class="job-progress-bar" style="width:${pct}%;animation:none"></div></div>
  </div>`;
}

/** Readable Find funnel + cost for Last search + Find complete modal. */
function baSearchReportBodyHtml(pkg, { title = 'Last search', failed = false } = {}) {
  const stats = pkg?.lastSearchStats || {};
  const cost = pkg?.lastSearchCost || {};
  const query = pkg?.lastSearchQuery || {};
  const plan = pkg?.apifyPlanUsage || state.apifyPlanUsage || null;
  const kind = pkg?.lastSearchErrorKind || null;
  const cacheSize = Number(stats.cacheSize ?? pkg?.listingCache?.listings?.length ?? 0);
  const apifyReturned = Number(stats.apifyReturned ?? 0);
  const considered = Number(stats.considered ?? stats.listingsIn ?? 0);
  const skipped = Number(stats.skippedAlreadyScreened ?? 0);
  const skippedUsed = Number(stats.skippedAlreadyUsed ?? 0);
  const localRejects = Number(stats.localRejects ?? 0);
  const places = Number(stats.placesCalls ?? 0);
  const clean = Number(stats.shortlist ?? 0);
  const added = Number(stats.added ?? 0);
  const total = Number(stats.shortlistTotal ?? pkg?.shortlist?.length ?? 0);
  const unscreened = Number(stats.unscreenedRemaining ?? 0);
  const usedInCity = Number(stats.usedAddressesInCity ?? pkg?.usedAddressesSummary ?? 0);

  const rejectEntries = Object.entries(stats.rejectTallies || {}).sort((a, b) => b[1] - a[1]);
  const rejectLines = rejectEntries
    .slice(0, 8)
    .map(([k, n]) => `${esc(k)} (${n})`)
    .join(' · ');

  const placesTotal =
    cost?.apifyUsd != null && Number(cost.apifyUsd) > 0
      ? Number(cost.apifyUsd) + (Number(cost.placesEstUsd) || 0)
      : (Number(cost.apifyEstUsd) || 0) + (Number(cost.placesEstUsd) || 0);

  const loopnetLine = stats.cacheHit
    ? `LoopNet: city cache · ${cacheSize} listings · ${skipped} already screened · ${considered} considered`
    : `LoopNet: ${apifyReturned} returned · ${considered} considered${
        skipped ? ` · ${skipped} already screened` : ''
      }`;

  const face = `<div class="ba-search-face" style="margin-top:0.35rem">
    <div>${esc(loopnetLine)}${
      skippedUsed ? ` · <strong>${skippedUsed}</strong> already used by another candidate` : ''
    }</div>
    <div>Places: <strong>${places}</strong> lookups · <strong>${localRejects}</strong> local rejects (no Maps)</div>
    <div>Result: <strong>${clean}</strong> clean · <strong>${added}</strong> new · <strong>${total}</strong> recommended${
      unscreened > 0 ? ` · ${unscreened} still unscreened` : ''
    }${usedInCity > 0 ? ` · ${usedInCity} claimed in city` : ''}</div>
    <div style="margin-top:0.25rem">Cost: Apify ${baApifyCostLabel(cost, stats)} · Places est. ${baFormatUsd(
      cost.placesEstUsd,
    )} · Total ~${baFormatUsd(placesTotal || cost.totalEstUsd)}</div>
  </div>`;

  const billingHint =
    kind === 'apify_billing'
      ? `<p style="margin:0.45rem 0 0">Apify blocked this run. Add credit at <a href="https://console.apify.com/billing/subscription" target="_blank" rel="noopener">Apify billing</a>, then retry. Home paste / Skip still work.</p>`
      : kind === 'apify_config'
        ? `<p style="margin:0.45rem 0 0">Add <code>APIFY_TOKEN</code>, <code>APIFY_LOOPNET_ACTOR_ID</code>, and <code>GOOGLE_MAPS_API_KEY</code> to <code>.env</code>, restart Rover, then retry.</p>`
        : kind === 'cache_exhausted'
          ? `<p style="margin:0.45rem 0 0">City LoopNet cache has no more free candidates (screened or already used). Use <strong>Refresh LoopNet</strong> to pull new listings (costs Apify).</p>`
          : '';

  const details = `<details class="narrative-raw" style="margin-top:0.45rem">
    <summary class="muted small">Technical details</summary>
    <div class="muted small" style="margin-top:0.35rem">
      Queried: <strong>${esc(
        query.location || [pkg?.city, pkg?.state].filter(Boolean).join(', ') || '—',
      )}</strong>
      ${query.locationSlug ? ` · slug <code>${esc(query.locationSlug)}</code>` : ''}
      ${query.actorId ? ` · actor <code>${esc(query.actorId)}</code>` : ''}
      ${pkg?.cityCacheKey ? ` · city cache <code>${esc(pkg.cityCacheKey)}</code>` : ''}
    </div>
    ${
      Array.isArray(query.searchUrls) && query.searchUrls.length
        ? `<div class="muted small" style="margin-top:0.2rem">URLs: ${query.searchUrls
            .map((u) => `<code>${esc(u)}</code>`)
            .join(' · ')}</div>`
        : ''
    }
    ${
      rejectLines
        ? `<div class="muted small" style="margin-top:0.25rem">Reject tallies: ${rejectLines}</div>`
        : ''
    }
    ${
      cost.apifyRunId
        ? `<div class="muted small" style="margin-top:0.2rem"><a href="https://console.apify.com/view/runs/${esc(
            cost.apifyRunId,
          )}" target="_blank" rel="noopener">Apify run</a></div>`
        : ''
    }
    ${cost.note ? `<div class="muted small" style="margin-top:0.2rem">${esc(cost.note)}</div>` : ''}
    ${baPlanBarHtml(plan)}
  </details>`;

  return `<div class="callout ${failed ? 'danger' : 'ok'}" style="margin-top:0.75rem">
    <strong>${esc(title)}</strong>
    ${face}
    ${billingHint}
    ${
      pkg?.lastSearchError
        ? `<p class="muted small" style="margin:0.45rem 0 0">${esc(pkg.lastSearchError)}</p>`
        : ''
    }
    ${details}
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
  const cityCacheKeyForUi = (() => {
    const pkgCity = String(baPkg?.city || '').trim().toLowerCase();
    const pkgState = String(baPkg?.state || '')
      .trim()
      .toUpperCase();
    const geoMatch =
      pkgCity &&
      pkgState &&
      pkgCity === geoCity.toLowerCase() &&
      pkgState === geoState;
    if (geoMatch && baPkg?.cityCacheKey) return baPkg.cityCacheKey;
    if (geoCity && geoState) {
      return `${geoCity.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${geoState
        .toLowerCase()
        .slice(0, 2)}`;
    }
    return '';
  })();
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
    paste: Boolean(draft) || Boolean(accepted),
    // Explicit save only — Claude-seeded coverageAreas do not complete this step.
    serviceArea: Boolean(accepted && d?.meta?.lastServiceAreaAt),
    // Provision or Skip only — a real NAP phone from Claude does not complete this step.
    phone: Boolean(
      accepted &&
        (isSoftDone('siteConfigSoftDone', 'phone') ||
          state.sitePhoneProvisioned?.[d?.id] ||
          Boolean(d?.meta?.phoneSkippedAt)),
    ),
  };
  const detailsDone = stepDone.details || isSoftDone('siteConfigSoftDone', 'details');
  const lookDone = stepDone.look || isSoftDone('siteConfigSoftDone', 'look');
  const addressDone = stepDone.address || isSoftDone('siteConfigSoftDone', 'address');
  const pasteDone = stepDone.paste || isSoftDone('siteConfigSoftDone', 'paste');
  const servicesDone =
    Boolean(accepted) || isSoftDone('siteConfigSoftDone', 'services');
  const serviceAreaDone =
    stepDone.serviceArea || isSoftDone('siteConfigSoftDone', 'service-area');
  const phoneDone = stepDone.phone;
  // Forward-only: 1 look → 2 address → 3 details → 4 paste → 5 services → 6 service-area → 7 phone
  const durableCurrent = !lookDone
    ? 'look'
    : !addressDone
      ? 'address'
      : !detailsDone
        ? 'details'
        : !pasteDone
          ? 'paste'
          : !servicesDone
            ? 'services'
            : !serviceAreaDone
              ? 'service-area'
              : !phoneDone
                ? 'phone'
                : null;
  const currentId = resolvePanelCurrent('siteConfigSoftCurrent', durableCurrent);
  if (state.siteConfigFollowCurrent !== currentId) {
    state.siteConfigOpenStep = currentId;
    state.siteConfigFollowCurrent = currentId;
  }
  const openId = state.siteConfigOpenStep;
  const parts = [];

  parts.push(
    panelHowToHtml({
      label: 'Site config',
      info: '1 Colors & fonts → 2 Address → 3 Business details → 4 Paste & edit draft → 5 Review services & Accept → 6 Service area → 7 Provision phone → Content.',
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
      `<div class="callout warn">Narrative is accepted but the approved package is missing — Accept the narrative draft again.</div>`,
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

  const lockedUntilAccept =
    '<p class="muted small">Locked until you <strong>Accept</strong> site-config in Review services (step 5).</p>';
  const lockedUntilDraft =
    '<p class="muted small">Locked until you <strong>Load draft</strong> in Paste Claude’s reply (step 4).</p>';

  parts.push(
    contentStepHtml({
      id: 'look',
      num: 1,
      title: 'Colors & fonts',
      done: lookDone,
      open: openId === 'look',
      current: currentId === 'look' && !lookDone,
      info: 'Pick a brand palette and a site-wide text font first. Apply saves the look, then continue to Address → Business details → Copy.',
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
            : `<p class="muted small">No draft yet — Apply look remembers your choice and steers the Copy prompt; it writes into site-config when you Load draft.</p>`
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
      baErrorKind === 'cache_exhausted' ||
      (shortlist.length === 0 && (baStats?.listingsIn != null || baPkg?.lastSearchError)));

  const baFailureTitle =
    baErrorKind === 'apify_billing'
      ? 'Apify usage limit'
      : baErrorKind === 'apify_config'
        ? 'Find not configured'
        : baErrorKind === 'cache_exhausted'
          ? 'Cache exhausted'
          : baSearchFailed
            ? 'Find note'
            : 'Last search';

  const baCacheSize = Number(
    baStats?.cacheSize ?? baPkg?.listingCache?.listings?.length ?? 0,
  );
  const baCacheExhausted =
    baErrorKind === 'cache_exhausted' ||
    (baCacheSize > 0 &&
      baStats?.unscreenedRemaining != null &&
      Number(baStats.unscreenedRemaining) === 0);

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

  const shortlistHtml = shortlist.length
    ? `<div class="ba-shortlist" style="margin-top:0.75rem">
        <p style="margin:0 0 0.4rem"><strong>Recommended addresses</strong>
          <span class="muted small">(${shortlist.length} — kept across Finds; newest uniques first)</span>
        </p>
        <div style="display:flex;flex-direction:column;gap:0.5rem">
        ${shortlist
          .map((row, i) => {
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
                    label: 'Places — no OPERATIONAL business at this street number',
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
            return `<div class="callout" style="margin:0;padding:0.65rem 0.75rem">
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:flex-start;justify-content:space-between">
              <div>
                <strong>${esc(row.street)}${row.suite ? `, ${esc(row.suite)}` : ''}</strong>
                <div class="muted small">${esc(row.city)}, ${esc(row.state)} ${esc(row.zip)}${
                  row.propertyType ? ` · ${esc(row.propertyType)}` : ''
                }${row.foundAt ? ` · found ${esc(String(row.foundAt).slice(0, 10))}` : ''}</div>
                <div class="muted small" style="margin-top:0.25rem">
                  <a href="${esc(row.mapsUrl || '#')}" target="_blank" rel="noopener">Maps</a>
                  ·
                  <a href="${esc(row.streetViewUrl || '#')}" target="_blank" rel="noopener">Street View</a>
                </div>
                <details class="narrative-raw lint-findings" style="margin-top:0.4rem">
                  <summary><strong>How chosen</strong></summary>
                  <ul class="speech-lint-list" style="margin:0.35rem 0 0">${checkItems}</ul>
                </details>
              </div>
              <button type="button" class="btn primary ba-use-addr" data-ba-index="${i}" data-tip="Use this address in Business details">Use this</button>
            </div>
          </div>`;
          })
          .join('')}
        </div>
      </div>`
    : '';

  const baBusy = Boolean(state.baSearchBusy);
  const baBusyMode = state.baSearchMode || 'find';
  const baProgressHtml = baBusy
    ? `<div id="ba-search-progress" class="job-progress" aria-live="polite" style="margin-top:0.65rem">
        <div class="job-progress-track"><div class="job-progress-bar"></div></div>
        <p class="job-progress-label">${
          baBusyMode === 'refresh' ? 'Refreshing LoopNet…' : 'Finding addresses…'
        }</p>
        <p class="job-progress-detail">${
          baBusyMode === 'refresh'
            ? `Pulling new LoopNet listings for ${esc(addrCity || 'city')}${
                addrState ? `, ${esc(addrState)}` : ''
              } (Apify billable), then screening with Places.`
            : `Continuing from LoopNet cache when available, then screening with Places for ${esc(
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
      )} (or paste home / skip). Selection pre-fills Business details.`,
      bodyHtml: `
        <p class="disc-tool-blurb">Default: commercial finder for <strong>${esc(
          addrCity || 'city',
        )}${addrState ? `, ${esc(addrState)}` : ''}</strong>. LoopNet inventory, Places screens, and <strong>used addresses</strong> are shared across candidates in this city — Find will not recommend a street you already claimed. Re-Find continues from city cache (Apify $0); <strong>Refresh LoopNet</strong> re-scrapes (billable).</p>
        ${
          cityCacheKeyForUi
            ? `<p class="muted small" style="margin:0.35rem 0 0">City cache: <code>${esc(
                cityCacheKeyForUi,
              )}</code>${
                baPkg?.usedAddressesSummary
                  ? ` · ${Number(baPkg.usedAddressesSummary)} address(es) already claimed`
                  : ''
              }</p>`
            : ''
        }
        ${selectedBanner}
        <div class="narrative-actions" style="flex-wrap:wrap;gap:0.5rem;align-items:center;margin-top:0.5rem">
          <button type="button" class="btn${baCacheExhausted ? '' : ' primary'}" id="ba-find-addresses" data-tip="Search for unused commercial addresses in this city. Free if we already have a recent listing list." ${
            baBusy || !(ready || f.hasApproved) ? 'disabled' : ''
          }${baBusy ? ' aria-busy="true"' : ''}>Find addresses</button>
          <button type="button" class="btn${baCacheExhausted ? ' primary' : ''}" id="ba-refresh-loopnet" data-tip="Download a fresh listing list (costs money), then look for new unused addresses." ${
            baBusy || !(ready || f.hasApproved) ? 'disabled' : ''
          }>Refresh LoopNet</button>
          <button type="button" class="btn" id="ba-show-home" data-tip="Use your home street instead of a commercial listing." ${
            baBusy ? 'disabled' : ''
          }>Use my home address</button>
          <button type="button" class="btn" id="ba-skip-address" data-tip="Continue without a business street address." ${
            baBusy ? 'disabled' : ''
          }>Skip address</button>
        </div>
        ${baProgressHtml}
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
        ${shortlistHtml}`,
    }),
  );

  const preStreet = baSel?.street || nap.addressStreet || '';
  const preZip = baSel?.zip || nap.addressZip || '';
  // Form prefills may use per-candidate NAP; city/state fall back to finder geography.
  const preCity = baSel?.city || nap.addressCity || addrCity;
  const preState = baSel?.state || nap.addressState || addrState;

  parts.push(
    contentStepHtml({
      id: 'details',
      num: 3,
      title: 'Business details',
      done: detailsDone,
      open: openId === 'details',
      current: currentId === 'details' && !detailsDone,
      info: 'Fill domain, name, email, and radius. Phone is optional here — ranking number comes in step 7. Address comes from step 2 when set. Copy site-config prompt, then Paste.',
      bodyHtml: `
        <p class="disc-tool-blurb">Used when you copy the prompt and merged into the draft if Claude leaves blanks.</p>
        <div class="site-config-nap">
          <label>
            <span class="label-with-tip-head">
              <span>Domain</span>
              <button type="button" class="tip-info" data-tip="Public hostname without https:// (e.g. yourdomain.com)." aria-label="About Domain">i</button>
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
              <button type="button" class="tip-info" data-tip="Optional for the Claude prompt. Your ranking number is set in step 7 (Provision phone) and replaces this on the live site-config." aria-label="About Phone">i</button>
            </span>
            <input id="sc-phone" type="text" value="${esc(nap.phone || '')}" placeholder="Optional — provision in step 7" />
          </label>
          <label>
            <span class="label-with-tip-head">
              <span>Email</span>
              <button type="button" class="tip-info" data-tip="Public site leads address (usually leads@yourdomain.com) — shown in footer, contact, and schema. Not your personal Gmail." aria-label="About Email">i</button>
            </span>
            <input id="sc-email" type="email" value="${esc(nap.email || '')}" placeholder="leads@yourdomain.com" />
          </label>
          <label>
            <span class="label-with-tip-head">
              <span>Radius (mi)</span>
              <button type="button" class="tip-info" data-tip="Default radius seed for Service area map." aria-label="About Radius">i</button>
            </span>
            <input id="sc-radius" type="text" value="${esc(nap.radiusMiles || '40')}" />
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
        <div class="narrative-actions" style="justify-content:flex-end">
          <button type="button" class="btn primary" id="sc-copy-prompt" data-tip="Copy Claude.ai site-config prompt (stays on this step)" ${ready || f.hasApproved ? '' : 'disabled'}>Copy site-config prompt</button>
          ${openClaudeAiBtnHtml({
            disabled: !(ready || f.hasApproved),
            id: 'sc-open-claude',
            tip: 'Open Claude.ai and continue to Paste Claude’s reply',
          })}
        </div>`,
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

  if (draft?._ops?.suburbCheck?.warnings?.length) {
    pasteParts.push(
      `<div class="callout warn">Suburb warnings: ${esc(draft._ops.suburbCheck.warnings.join('; '))}</div>`,
    );
  }

  const ph = draft?._ops?.placeholders || [];
  if (draft && ph.length) {
    pasteParts.push(
      `<div class="callout warn">Still need filling: <code>${esc(ph.join(', '))}</code> — edit the matching fields below before Accept (or Accept anyway for an early build).</div>`,
    );
  } else if (draft) {
    pasteParts.push(statusLineHtml('Draft looks complete — save if you edit, then Accept in Review services.'));
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
    pasteParts.push(`
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
            <button type="button" class="tip-info" data-tip="Optional Claude seed. Ranking number is set in step 7 and replaces this on the live site-config." aria-label="About draft Phone">i</button>
          </span>
          <input id="sc-edit-phone" type="text" value="${esc(draft.phone || '')}" placeholder="Optional — provision in step 7" />
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
      id: 'paste',
      num: 4,
      title: 'Paste Claude’s reply',
      done: pasteDone,
      open: openId === 'paste',
      current: currentId === 'paste' && !pasteDone,
      info: 'Paste Claude’s site-config reply, Load draft, and edit all fields here. Accept is in the next step (Review services).',
      bodyHtml: pasteParts.join(''),
    }),
  );

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
      num: 5,
      title: 'Review services',
      done: servicesDone,
      open: openId === 'services',
      current: currentId === 'services' && !servicesDone,
      locked: !(draft || accepted),
      info: 'Choose residential-only or keep commercial, then Accept to write site-config. After Accept you can adjust services here without re-pasting Claude.',
      bodyHtml: servicesBodyHtml,
    }),
  );

  const covN = accepted && Array.isArray(accepted.coverageAreas) ? accepted.coverageAreas.length : 0;
  const pageN = accepted && Array.isArray(accepted.targetSuburbs) ? accepted.targetSuburbs.length : 0;
  parts.push(
    contentStepHtml({
      id: 'service-area',
      num: 6,
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
      num: 7,
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
}) {
  const infoBtn = info
    ? `<button type="button" class="tip-info" data-tip="${esc(info)}" aria-label="About ${esc(
        title,
      )}">i</button>`
    : '';
  if (plain) {
    return `<section class="content-step website-utility-panel${open ? ' open' : ''}${
      locked ? ' locked' : ''
    }" data-content-step="${esc(id)}">
      <div class="content-step-head-wrap">
        <span class="content-step-label">${esc(title)}</span>
        ${infoBtn}
      </div>
      <div class="content-step-body">${bodyHtml}</div>
    </section>`;
  }
  return `<section class="content-step${done ? ' done' : ''}${open ? ' open' : ''}${
    current ? ' current' : ''
  }${locked ? ' locked' : ''}" data-content-step="${esc(id)}">
    <div class="content-step-head-wrap">
      <button type="button" class="content-step-head" data-content-toggle="${esc(id)}">
        <span class="disc-step-mark" aria-hidden="true"></span>
        <span class="content-step-label">${esc(String(num))} · ${esc(title)}</span>
      </button>
      ${infoBtn}
    </div>
    <div class="content-step-body">${bodyHtml}</div>
  </section>`;
}

const SITE_CONFIG_STEP_ORDER = ['look', 'address', 'details', 'paste', 'services', 'service-area', 'phone'];
const CONTENT_STEP_ORDER = ['structure', 'outline', 'write', 'editor', 'accept'];
const WEBSITE_STEP_ORDER = ['images', 'prepare', 'launch', 'indexing'];

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
    markSoftDonePrior('contentSoftDone', CONTENT_STEP_ORDER, stepId);
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

/** Prefer soft current until durable catches up or panel is complete. */
function resolvePanelCurrent(softKey, durableCurrent) {
  const soft = state[softKey];
  if (soft && (soft === durableCurrent || durableCurrent == null)) {
    state[softKey] = null;
  }
  return state[softKey] ?? durableCurrent;
}

/** Numbered action row: n · label + optional controls; done shows green ✓ */
function contentActionRow({ n, label, hint, controlsHtml = '', done = false }) {
  return `<div class="content-action-row${done ? ' content-action-row-done' : ''}">
    <div class="content-action-meta">
      <span class="content-action-num${done ? ' content-action-num-done' : ''}"${
        done ? ` ${tipAttr('Completed')}` : ''
      }>${done ? '✓' : esc(String(n))}</span>
      <div>
        <div class="content-action-label">${label}</div>
        ${hint ? `<p class="disc-tool-blurb">${hint}</p>` : ''}
      </div>
    </div>
    ${controlsHtml ? `<div class="content-action-controls">${controlsHtml}</div>` : ''}
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

function editorRewriteWhyHtml(needs) {
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
    <p class="editor-rewrite-workflow muted">Copy the editor prompt → fix in Claude.ai → paste FILE blocks → Load, then Speech/SEO Refinement again.</p>
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
    return `<p><strong>No rewrite needed.</strong> Speech leftovers and SEO flags are clear.</p>${fixLine}<p><strong>Up next:</strong> <strong>Accept content</strong>.</p>`;
  }

  if (needs.softOnly) {
    return `<p><strong>Recommended Claude pass for soft SEO.</strong></p>
    <p>${esc(String(needs.softSeoN))} soft SEO flag(s) remain (advisory — Accept is not blocked).</p>
    ${fixLine}
    <p>Use <strong>Copy editor prompt</strong> below → Claude.ai → paste revised FILE blocks → Load, then Speech/SEO Refinement again. Or Accept now if you are fine shipping with soft flags.</p>`;
  }

  const bits = [];
  if (speechN) bits.push(`${esc(String(speechN))} speech leftover(s)`);
  if (needs.criticalSeoN) bits.push(`${esc(String(needs.criticalSeoN))} Critical SEO`);
  if (needs.softSeoN) bits.push(`${esc(String(needs.softSeoN))} soft SEO`);
  return `<p><strong>Additional Claude pass needed.</strong></p>
    <p>${bits.join(' · ')}.</p>
    ${fixLine}
    <p>Rover auto-fix cleared what it could safely. Use <strong>Copy editor prompt</strong> below → Claude.ai → paste revised FILE blocks → Load, then Speech/SEO Refinement again.${
      needs.criticalSeoN
        ? ' Critical SEO blocks Accept until fixed (or you override on Accept).'
        : ' You can still Accept if only speech leftovers remain.'
    }</p>`;
}

function firstIncompleteContentStep(flags) {
  if (!flags.structure) return 'structure';
  if (!flags.outline) return 'outline';
  if (!flags.write) return 'write';
  if (!flags.editor) return 'editor';
  if (!flags.accepted) return 'accept';
  return 'accept';
}

function contentUpNextHtml(stepDone, ready, { secCount = 0, outlineConfirmed = false, outlineDrafted = false } = {}) {
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

  let upNext = '';
  if (!stepDone.structure) {
    upNext = 'Up next: <strong>Structure</strong> — pages + sections → Continue';
  } else if (!stepDone.outline) {
    upNext =
      'Up next: <strong>Outline paste cycle</strong> — Copy structure prompt → Claude.ai → Load &amp; confirm';
  } else if (!stepDone.write) {
    upNext =
      'Up next: <strong>Write paste cycle</strong> — Copy full-write prompt → Claude.ai → Load FILE (auto Speech/SEO Refinement)';
  } else if (!stepDone.editor) {
    upNext =
      'Up next: <strong>Speech/SEO Refinement</strong> (auto on Load; re-run if needed) — Claude Copy/Load available for leftovers or soft SEO';
  } else {
    upNext =
      'Up next: <strong>Accept content</strong> — then <strong>Website → Prepare preview</strong>';
  }
  return statusLineHtml(`${upNext}${structureLine ? ` · ${structureLine}` : ''}`);
}

function briefSectionsTableHtml(brief) {
  const rows = Array.isArray(brief?.sections) ? brief.sections : [];
  if (!rows.length) {
    return `<p class="muted">No sections yet — Generate draft brief.</p>`;
  }
  const body = rows
    .map(
      (row, idx) => `<tr data-brief-idx="${idx}">
      <td><select class="brief-level" data-tip="Heading level">
        <option value="H1"${row.level === 'H1' ? ' selected' : ''}>H1</option>
        <option value="H2"${row.level === 'H2' ? ' selected' : ''}>H2</option>
        <option value="H3"${row.level === 'H3' ? ' selected' : ''}>H3</option>
      </select></td>
      <td><input type="text" class="brief-heading" value="${esc(row.heading || '')}" data-tip="Section heading" /></td>
      <td><textarea class="brief-instructions" rows="2" data-tip="Writer instructions">${esc(
        row.instructions || '',
      )}</textarea></td>
    </tr>`,
    )
    .join('');
  return `<div class="brief-table-wrap">
    <table class="brief-table">
      <thead><tr><th>Level</th><th>Heading</th><th>Instructions</th></tr></thead>
      <tbody id="brief-sections-body">${body}</tbody>
    </table>
  </div>`;
}

function collectBriefSectionsFromDom() {
  const rows = [...document.querySelectorAll('#brief-sections-body tr')];
  return rows.map((tr, idx) => ({
    id: state.detail?.contentBrief?.sections?.[idx]?.id || `section-${idx + 1}`,
    level: tr.querySelector('.brief-level')?.value || 'H2',
    heading: tr.querySelector('.brief-heading')?.value || '',
    instructions: tr.querySelector('.brief-instructions')?.value || '',
    kind: state.detail?.contentBrief?.sections?.[idx]?.kind || null,
    ...(state.detail?.contentBrief?.sections?.[idx]?.subHeadline
      ? { subHeadline: state.detail.contentBrief.sections[idx].subHeadline }
      : {}),
  }));
}

function firstIncompleteWebsiteStep({ imagesDone, prepareDone, launched, indexingDone }) {
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
  // Open draft: done only when Speech/SEO ran and findings are clear.
  const editorClear = Boolean(speechChecked && !editorNeeds.needed);
  const stepDone = {
    structure: structureReady && Boolean(outlinePkg?.sections?.length),
    outline: outlineConfirmed,
    write:
      Boolean(draft?.files) ||
      Boolean(accepted?.files) ||
      Boolean(f.hasContentDraft) ||
      Boolean(f.hasContent),
    editor: editorClear || (contentAcceptedLive && !draft),
    accepted: contentAcceptedLive,
    brief: brief?.status === 'confirmed' || Boolean(f.hasContentBriefConfirmed),
    oneshot:
      Boolean(draft?.files) ||
      Boolean(accepted?.files) ||
      Boolean(f.hasContentDraft) ||
      Boolean(f.hasContent),
    research: Boolean(research) || Boolean(f.hasContentResearch),
    outlineLegacy: Boolean(outline) || Boolean(f.hasContentOutline),
  };
  // Open draft with findings: keep Speech/SEO as current (wins over Accept soft-advance)
  if (draft && speechChecked && editorNeeds.needed) {
    if (state.contentSoftDone?.editor) {
      const nextSoft = { ...state.contentSoftDone };
      delete nextSoft.editor;
      state.contentSoftDone = nextSoft;
    }
    if (state.contentSoftCurrent === 'accept') {
      state.contentSoftCurrent = 'editor';
      state.contentFollowCurrent = 'editor';
      state.contentOpenStep = 'editor';
    }
  }
  const durableCurrent =
    draft && speechChecked && editorNeeds.needed
      ? 'editor'
      : stepDone.accepted
        ? null
        : firstIncompleteContentStep(stepDone);
  const currentId = resolvePanelCurrent('contentSoftCurrent', durableCurrent);
  if (state.contentFollowCurrent !== currentId) {
    state.contentOpenStep = currentId;
    state.contentFollowCurrent = currentId;
  }
  const openId = state.contentOpenStep;
  const structureDone = stepDone.structure || isSoftDone('contentSoftDone', 'structure');
  const outlineDone = stepDone.outline || isSoftDone('contentSoftDone', 'outline');
  const writeDone = stepDone.write || isSoftDone('contentSoftDone', 'write');
  const editorDone =
    draft && speechChecked && editorNeeds.needed
      ? false
      : stepDone.editor || isSoftDone('contentSoftDone', 'editor');
  const acceptDone = stepDone.accepted || isSoftDone('contentSoftDone', 'accept');
  const parts = [];

  parts.push(
    panelHowToHtml({
      label: 'Content',
      info: 'Structure → outline Copy / Load & confirm → write Copy / Load (auto Speech/SEO Refinement) → Accept. Default path is Claude.ai paste (no Anthropic API). Then Website → Prepare preview.',
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
    }),
  );

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
        ? structureChecklistHtml(d, catalog)
        : `<p class="muted">Accept Site config to unlock the checklist.</p>`,
    }),
  );

  parts.push(
    contentStepHtml({
      id: 'outline',
      num: 2,
      title: 'Outline (paste cycle 1)',
      done: outlineDone,
      open: openId === 'outline',
      current: currentId === 'outline' && !outlineDone,
      info: 'Paste cycle 1 of 2. Copy the SEO structure prompt, refine in Claude.ai, paste JSON back, then Load & confirm (one step). No Anthropic API required.',
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
            outlinePkg?.sections?.length ? '' : 'disabled'
          }>Copy structure prompt</button>
          ${openClaudeAiBtnHtml({ disabled: !outlinePkg?.sections?.length })}`,
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
          controlsHtml: `<button type="button" class="btn primary" id="cs-paste-outline">Load &amp; confirm outline</button>`,
        })}`,
    }),
  );

  parts.push(
    contentStepHtml({
      id: 'write',
      num: 3,
      title: 'Full write (paste cycle 2)',
      done: writeDone,
      open: openId === 'write',
      current: currentId === 'write' && !writeDone,
      info: 'Paste cycle 2 of 2. Copy the full-write prompt (needs confirmed outline). Paste Claude’s ### FILE blocks and Load — Speech/SEO Refinement runs automatically when the draft is complete.',
      bodyHtml: `
        ${incompleteDraftCalloutHtml(d)}
        ${contentActionRow({
          n: 1,
          label: 'Copy full-write prompt <span class="muted">(Required)</span>',
          controlsHtml: `<button type="button" class="btn primary" id="cs-copy-write" ${
            outlineConfirmed ? '' : 'disabled'
          }>Copy full-write prompt</button>
          ${openClaudeAiBtnHtml({ disabled: !outlineConfirmed })}`,
        })}
        ${contentActionRow({
          n: 2,
          label: 'Paste FILE blocks <span class="muted">(Required)</span>',
          controlsHtml: `<textarea id="ca-writer-paste" class="narrative-paste-input" rows="2" placeholder="### FILE: src/content/pages/index.md&#10;---&#10;..." data-tip="Paste ### FILE: markdown blocks"></textarea>`,
        })}
        ${contentActionRow({
          n: 3,
          label: 'Load FILE blocks as draft <span class="muted">(Required)</span>',
          controlsHtml: `<button type="button" class="btn primary" id="ca-paste-writer" data-tip="Parse FILE blocks into candidate draft" ${ready ? '' : 'disabled'}>Load FILE blocks as draft</button>`,
        })}`,
    }),
  );

  const editorClaudeLabel = editorNeeds.criticalSeoN
    ? 'Needed for Critical SEO'
    : needsEditorClaude
      ? 'Recommended'
      : 'Optional';
  const editorStatusBits = [];
  if (stepDone.accepted) {
    editorStatusBits.push(
      `<div class="callout">Accepted site still live — Load creates a draft; Accept again to publish fixes.</div>`,
    );
  }
  if (!speechChecked && !stepDone.accepted) {
    editorStatusBits.push(
      `<div class="callout warn">Speech/SEO Refinement not run yet — Accept stays blocked.</div>`,
    );
  } else if (needsEditorClaude) {
    editorStatusBits.push(editorRewriteWhyHtml(editorNeeds));
  } else if (speechChecked && !stepDone.accepted) {
    editorStatusBits.push(
      `<div class="callout"><strong>No Claude rewrite needed.</strong> Up next: <strong>Accept content</strong>.</div>
                <p class="muted">Speech/SEO Refinement run at ${esc(
                  String(lintSource?._ops?.lastSpeechCheckAt || ''),
                )}</p>`,
    );
  }
  const editorStatusCallout = editorStatusBits.join('\n');
  const editorClaudeChrome = hasEditableContent
    ? `        ${contentActionRow({
          n: 2,
          label: `Copy editor prompt <span class="muted">(${editorClaudeLabel})</span>`,
          hint: 'Prompt includes only files with open findings — paste back only changed FILEs; Load merges. Works from draft or accepted content.',
          controlsHtml: `<button type="button" class="btn primary" id="ca-copy-editor" data-tip="Copy findings-scoped editor prompt for Claude.ai" ${
            ready ? '' : 'disabled'
          }>Copy editor prompt</button>
          ${openClaudeAiBtnHtml({ disabled: !ready })}`,
        })}
        ${contentActionRow({
          n: 3,
          label: 'Paste revised FILE blocks',
          hint: 'Load here after Claude — then Speech/SEO Refinement again.',
          controlsHtml: `<textarea id="ca-editor-paste" class="narrative-paste-input" rows="2" placeholder="### FILE: src/content/pages/index.md&#10;---&#10;..." data-tip="Paste revised ### FILE: blocks"></textarea>`,
        })}
        ${contentActionRow({
          n: 4,
          label: 'Load FILE blocks as draft',
          controlsHtml: `<button type="button" class="btn" id="ca-paste-editor" data-tip="Parse FILE blocks into candidate draft" ${ready ? '' : 'disabled'}>Load FILE blocks as draft</button>`,
        })}
        <details class="narrative-raw content-advanced" style="margin-top:0.5rem">
          <summary>Advanced</summary>
          <p class="muted">Only if markdown was edited on disk outside Rover (e.g. Claude Code). Normal paste path: use Load above.</p>
          <button type="button" class="btn" id="ca-import-disk-editor" ${ready ? '' : 'disabled'}>Import from src/content</button>
        </details>`
    : '';

  parts.push(
    contentStepHtml({
      id: 'editor',
      num: 4,
      title: 'Speech/SEO Refinement',
      done: editorDone,
      open: openId === 'editor',
      current: currentId === 'editor' && !editorDone,
      info: 'Speech/SEO Refinement runs automatically after a complete FILE Load. Re-run anytime. Copy editor prompt / Load stay available for speech leftovers, Critical SEO, and soft SEO — including after Accept (Load seeds a new draft; Accept again to publish).',
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
      id: 'accept',
      num: 5,
      title: 'Accept content',
      done: acceptDone,
      open: openId === 'accept',
      current: currentId === 'accept' && !stepDone.accepted,
      info: 'Accept writes shared src/content/, auto-pulls stock photos when enabled, and generates logo + coverage map when possible. Then open Website → Prepare preview.',
      bodyHtml: `
        ${incompleteDraftCalloutHtml(d)}
        ${
          seoCritical.length
            ? `<div class="callout warn"><strong>Critical SEO:</strong> ${esc(
                seoCritical.map((f) => f.excerpt || f.rule).join('; '),
              )}. Use Copy editor prompt on the Speech/SEO Refinement step, or check override below.</div>
              <label class="check"><input type="checkbox" id="content-accept-seo-override" /> Accept with SEO warnings</label>`
            : ''
        }
        <div class="narrative-actions" style="justify-content:flex-end">
          <button type="button" class="btn primary" id="content-accept-btn" data-tip="Accept draft — write files into src/content/" ${
            draft && speechChecked ? '' : 'disabled'
          }>Accept content</button>
        </div>
        <div id="ca-accept-progress" class="job-progress hidden" aria-live="polite">
          <div class="job-progress-track"><div class="job-progress-bar" id="ca-accept-progress-bar"></div></div>
          <p class="job-progress-label" id="ca-accept-progress-label">Accepting…</p>
          <p class="job-progress-detail" id="ca-accept-progress-detail">Starting…</p>
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

  parts.push(`
    <details class="narrative-raw content-legacy">
      <summary>Optional / Advanced — legacy Brief → One-shot</summary>
      <p class="disc-tool-blurb">Previous default path. Prefer Structure → Outline → Full write above.</p>
      ${contentActionRow({
        n: 'A',
        label: 'Generate / refresh draft brief',
        controlsHtml: `<button type="button" class="btn" id="cb-generate" ${ready ? '' : 'disabled'}>Generate draft brief</button>`,
      })}
      ${briefSectionsTableHtml(brief)}
      ${contentActionRow({
        n: 'B',
        label: 'Save brief / Confirm brief',
        controlsHtml: `<button type="button" class="btn" id="cb-save" ${brief ? '' : 'disabled'}>Save brief</button>
          <button type="button" class="btn" id="cb-confirm" ${brief ? '' : 'disabled'}>Confirm brief</button>`,
      })}
      ${contentActionRow({
        n: 'C',
        label: 'Copy legacy one-shot prompt',
        controlsHtml: `<button type="button" class="btn" id="cb-copy-oneshot" ${
          stepDone.brief ? '' : 'disabled'
        }>Copy one-shot prompt</button>
        ${openClaudeAiBtnHtml({ disabled: !stepDone.brief })}`,
      })}
    </details>
  `);

  parts.push(`
    <details class="narrative-raw content-legacy">
      <summary>Optional / Advanced — legacy Researcher → Outline → Writer</summary>
      <p class="disc-tool-blurb">Previous multi-agent path.</p>
      ${contentActionRow({
        n: 'A',
        label: 'Copy researcher prompt',
        controlsHtml: `<button type="button" class="btn" id="ca-copy-researcher" data-tip="Copy researcher prompt for Claude" ${ready ? '' : 'disabled'}>Copy prompt</button>
        ${openClaudeAiBtnHtml({ disabled: !ready })}`,
      })}
      ${contentActionRow({
        n: 'B',
        label: 'Paste researcher JSON',
        controlsHtml: `<textarea id="ca-research-paste" class="narrative-paste-input" rows="2" placeholder="Paste researcher JSON" data-tip="Paste Claude researcher JSON"></textarea>
          <button type="button" class="btn" id="ca-paste-researcher" data-tip="Save research pack for this candidate" ${ready ? '' : 'disabled'}>Save research</button>`,
      })}
      ${contentActionRow({
        n: 'C',
        label: 'Seed default outline',
        controlsHtml: `<button type="button" class="btn" id="ca-seed-outline" data-tip="Seed default outline from archetype template" ${ready ? '' : 'disabled'}>Seed default outline</button>`,
      })}
      ${contentActionRow({
        n: 'D',
        label: 'Copy / paste outline',
        controlsHtml: `<button type="button" class="btn" id="ca-copy-outline" data-tip="Copy outline prompt for Claude" ${ready ? '' : 'disabled'}>Copy outline prompt</button>
          ${openClaudeAiBtnHtml({ disabled: !ready })}
          <textarea id="ca-outline-paste" class="narrative-paste-input" rows="2" placeholder="Paste outline JSON" data-tip="Paste outline JSON"></textarea>
          <button type="button" class="btn" id="ca-paste-outline" data-tip="Save outline for this candidate" ${ready ? '' : 'disabled'}>Save outline</button>`,
      })}
      ${contentActionRow({
        n: 'E',
        label: 'Copy writer prompt (outline-based)',
        controlsHtml: `<button type="button" class="btn" id="ca-copy-writer" data-tip="Copy writer prompt" ${outline ? '' : 'disabled'}>Copy writer prompt</button>
        ${openClaudeAiBtnHtml({ disabled: !outline })}`,
      })}
      ${
        outline
          ? `<details class="narrative-raw"><summary>Current outline</summary><div class="json-block">${esc(
              JSON.stringify(outline, null, 2),
            )}</div></details>`
          : ''
      }
      ${research ? `<p class="muted">Research saved${research._ops?.savedAt ? ` · ${esc(research._ops.savedAt)}` : ''}</p>` : ''}
    </details>
  `);

  parts.push(`
    <details class="narrative-raw content-legacy">
      <summary>Optional / Advanced — legacy full-suite one-shot markdown</summary>
      <p class="disc-tool-blurb">Full-suite paste via <code>claude-markdown.md</code>.</p>
      <div class="narrative-actions">
        <button type="button" class="btn" id="content-copy-prompt" data-tip="Copy full one-shot markdown prompt" ${ready ? '' : 'disabled'}>Copy full markdown prompt</button>
        ${openClaudeAiBtnHtml({ disabled: !ready })}
      </div>
      <textarea id="content-paste" class="narrative-paste-input" rows="2" placeholder="Optional: paste full ### FILE suite"></textarea>
      <div class="narrative-actions">
        <button type="button" class="btn" id="content-paste-btn" data-tip="Load legacy FILE suite as draft" ${ready ? '' : 'disabled'}>Load as draft</button>
      </div>
    </details>
  `);

  return parts.join('');
}

function imagesStatusLine(d) {
  const m = d?.imagesManifest;
  if (!m?.files?.length) {
    const photosOn = Boolean(
      d?.contentStructure?.photos &&
        Object.values(d.contentStructure.photos).some((p) => p?.enabled),
    );
    if (!photosOn) return 'No Structure photo slots enabled — pull will skip.';
    return 'No images pulled yet. Accept content (auto stock + logo/map) or Pull photos.';
  }
  const sources = m.sources || {};
  const srcPart = Object.keys(sources).length
    ? ` · ${Object.entries(sources)
        .map(([k, v]) => `${k}×${v}`)
        .join(' · ')}`
    : '';
  const at = m.pulledAt ? ` · ${m.pulledAt}` : '';
  return `${m.files.length} file(s) on disk${srcPart}${at}`;
}

function imagesMatchDotHtml(grade, tip, { tipped = true } = {}) {
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
  return `<span class="${cls}" data-tip="${esc(tipText)}" aria-label="${esc(tipText)}"></span>`;
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
  const bulkRepull = (grade, count) => {
    const label = grade === 'poor' ? 'Poor' : 'Ok';
    const disabled = count < 1 ? ' disabled' : '';
    return `<button type="button" class="btn btn-sm img-match-bulk-repull" data-bulk-repull="${esc(
      grade,
    )}" data-tip="${esc(`Re-pull all ${label} matches`)}"${disabled}>Re-pull</button>`;
  };
  const untipped = { tipped: false };
  return `<div class="img-match-totals" role="toolbar" aria-label="Photo match filters">
    ${filterBtn(
      'all',
      `<strong>${esc(String(total))}</strong>
      <span class="muted">All</span>`,
      `Show all ${total} photo slot${total === 1 ? '' : 's'}`,
    )}
    <span class="img-match-totals-group">
      ${filterBtn(
        'poor',
        `${imagesMatchDotHtml('poor', null, untipped)}
      <strong>${esc(String(poor))}</strong>
      <span class="muted">Poor</span>`,
        `Show ${poor} Poor match${poor === 1 ? '' : 'es'} (filled slots only)`,
      )}
      ${bulkRepull('poor', poor)}
    </span>
    <span class="img-match-totals-group">
      ${filterBtn(
        'ok',
        `${imagesMatchDotHtml('ok', null, untipped)}
      <strong>${esc(String(ok))}</strong>
      <span class="muted">Ok</span>`,
        `Show ${ok} Ok match${ok === 1 ? '' : 'es'}`,
      )}
      ${bulkRepull('ok', ok)}
    </span>
    ${filterBtn(
      'good',
      `${imagesMatchDotHtml('good', null, untipped)}
      <strong>${esc(String(good))}</strong>
      <span class="muted">Good</span>`,
      `Show ${good} Good match${good === 1 ? '' : 'es'}`,
    )}
    ${filterBtn(
      'upload',
      `${imagesMatchDotHtml('upload', null, untipped)}
      <strong>${esc(String(uploaded))}</strong>
      <span class="muted">Uploaded</span>`,
      `Show ${uploaded} operator upload${uploaded === 1 ? '' : 's'}`,
    )}
    ${filterBtn(
      'empty',
      `${imagesMatchDotHtml('missing', null, untipped)}
      <strong>${esc(String(missing))}</strong>
      <span class="muted">Empty</span>`,
      `Show ${missing} Empty slot${missing === 1 ? '' : 's'}`,
    )}
  </div>`;
}

function imagesSlotCardHtml(slot) {
  const thumb = slot.previewUrl
    ? `<img src="${esc(slot.previewUrl)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover" />`
    : `<span class="muted" style="font-size:0.75rem">Empty</span>`;
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
  const matchDot = grade ? imagesMatchDotHtml(grade, tip) : '';
  const badge = slot.source
    ? `<span class="muted" style="font-size:0.75rem">${esc(slot.source)}</span>`
    : `<span class="muted" style="font-size:0.75rem">missing</span>`;
  const q = stripMdBoldDisplay(String(slot.query || slot.queryHint || '').trim());
  const qShort = q.length > 72 ? `${q.slice(0, 70)}…` : q;
  const queryLine = q
    ? `<span class="muted" style="font-size:0.7rem;line-height:1.25" title="${esc(q)}">Search: ${esc(qShort)}</span>`
    : '';
  return `<div class="image-slot-card" data-slot-key="${esc(slot.key)}" style="border:1px solid var(--border);border-radius:6px;overflow:hidden;background:var(--bg-subtle)">
    <div style="aspect-ratio:16/10;background:#0f172a0d;display:flex;align-items:center;justify-content:center">${thumb}</div>
    <div style="padding:0.45rem 0.55rem;display:flex;flex-direction:column;gap:0.25rem">
      <strong style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem">${matchDot}${esc(slot.label || slot.key)}</strong>
      <span class="muted" style="font-size:0.75rem">${esc(slot.wiredFm || slot.key)}</span>
      ${queryLine}
      ${badge}
      <div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-top:0.15rem;align-items:center">
        <button type="button" class="btn btn-sm ca-slot-repull" data-slot-key="${esc(slot.key)}" data-tip="Fetch a different stock photo for this slot">Re-pull</button>
        <label class="btn btn-sm" style="cursor:pointer;margin:0" data-tip="Upload a local image for this slot">
          Upload
          <input type="file" class="ca-slot-upload" data-slot-key="${esc(slot.key)}" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
        </label>
        ${baViewpointSegmentHtml(slot.key)}
        <button type="button" class="btn btn-sm ca-slot-chatgpt-prompt" data-slot-key="${esc(slot.key)}" data-tip="Copy a ChatGPT image prompt for this slot (uses Inside/Outside), then generate and Upload">Copy prompt</button>
        <a class="btn btn-sm" href="https://chatgpt.com/" target="_blank" rel="noopener" data-tip="Open ChatGPT in a new tab">Open ChatGPT</a>
      </div>
    </div>
  </div>`;
}

function baThumbUrl(candidateId, filename) {
  if (!filename) return '';
  return `/api/candidates/${encodeURIComponent(candidateId)}/images/file/${encodeURIComponent(filename)}`;
}

function baPreviewStripHtml(candidateId, before, after, emptyLabel = 'No pair imported yet.') {
  const beforeSrc = before?.filename ? baThumbUrl(candidateId, before.filename) : '';
  const afterSrc = after?.filename ? baThumbUrl(candidateId, after.filename) : '';
  if (!beforeSrc && !afterSrc) {
    return `<p class="muted ba-preview-empty" style="margin:0.4rem 0 0;font-size:0.85rem">${esc(emptyLabel)}</p>`;
  }
  const cell = (src, label, alt) =>
    src
      ? `<figure style="margin:0;flex:1;min-width:120px;max-width:220px">
          <img src="${esc(src)}" alt="${esc(alt || label)}" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;border:1px solid var(--border);display:block" />
          <figcaption class="muted" style="margin-top:0.25rem;font-size:0.75rem;text-align:center">${esc(label)}</figcaption>
        </figure>`
      : `<div class="muted" style="flex:1;min-width:120px;max-width:220px;aspect-ratio:4/3;border:1px dashed var(--border);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:0.8rem">${esc(label)} missing</div>`;
  return `<div class="ba-preview" style="display:flex;flex-wrap:wrap;gap:0.65rem;margin-top:0.5rem">${cell(
    beforeSrc,
    'Before',
    before?.alt,
  )}${cell(afterSrc, 'After', after?.alt)}</div>`;
}

function baServiceStepHtml(candidateId, service, stepN) {
  const slug = service.slug;
  const done = Boolean(service.complete);
  return contentActionRow({
    n: stepN,
    label: `Before & after — ${service.serviceName} (ChatGPT)`,
    hint: `Copy prompts → generate in ChatGPT → import two images for <strong>${esc(
      service.serviceName,
    )}</strong> (earlier filename time = Before).`,
    done,
    controlsHtml: `
      <div class="flex-wrap gap-2" style="display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center" data-ba-service="${esc(
        slug,
      )}">
        ${baViewpointSegmentHtml(slug)}
        <button type="button" class="btn ca-ba-svc-copy" data-ba-service="${esc(
          slug,
        )}" data-ba-kind="before" data-tip="Copy BEFORE prompt for this service">Copy before</button>
        <button type="button" class="btn ca-ba-svc-copy" data-ba-service="${esc(
          slug,
        )}" data-ba-kind="after" data-tip="Copy AFTER prompt for this service">Copy after</button>
        <a class="btn" href="https://chatgpt.com/" target="_blank" rel="noopener" data-tip="Open ChatGPT in a new tab">Open ChatGPT</a>
        <label class="btn" style="cursor:pointer" data-tip="Choose before then after image files">
          Import pair
          <input type="file" class="ca-ba-svc-import" data-ba-service="${esc(
            slug,
          )}" accept="image/jpeg,image/png,image/webp" multiple hidden />
        </label>
      </div>
      <p class="muted ca-ba-svc-status" data-ba-service="${esc(
        slug,
      )}" style="margin:0.35rem 0 0;font-size:0.85rem"></p>
      <div class="ca-ba-svc-preview" data-ba-service="${esc(slug)}">${baPreviewStripHtml(
        candidateId,
        service.before,
        service.after,
        `No pair for ${service.serviceName} yet.`,
      )}</div>`,
  });
}

async function refreshBeforeAfterUi(candidateId) {
  const homePreview = document.getElementById('ca-ba-preview');
  const svcHost = document.getElementById('ca-svc-ba-steps');
  try {
    const status = await api(
      `/api/candidates/${encodeURIComponent(candidateId)}/images/before-after-status`,
    );
    if (homePreview) {
      homePreview.innerHTML = baPreviewStripHtml(
        candidateId,
        status.home?.before,
        status.home?.after,
      );
    }
    if (svcHost) {
      if (status.svcBeforeAfterEnabled && (status.services || []).length) {
        svcHost.innerHTML = (status.services || [])
          .map((svc, i) => baServiceStepHtml(candidateId, svc, 5 + i))
          .join('');
      } else {
        svcHost.innerHTML = '';
      }
    }
  } catch (error) {
    if (homePreview) {
      homePreview.innerHTML = `<p class="muted" style="margin:0.4rem 0 0;font-size:0.85rem">${esc(
        error.message || 'Could not load before/after status',
      )}</p>`;
    }
  }
}

function imagesSlotsShellHtml() {
  return `<div id="ca-image-slots" style="margin-top:0.75rem">
    <p class="muted" style="margin:0 0 0.35rem;font-size:0.85rem">Per-slot review (near launch): Re-pull stock, Upload owner/ChatGPT photos, or Copy prompt → ChatGPT → Upload. Stage → Assemble after changes. Use All / poor / ok / good / uploaded / empty to filter.</p>
    <div id="ca-image-slots-totals"></div>
    <div id="ca-image-slots-grid" class="ca-image-slots-sections"></div>
    <p id="ca-image-slots-filter-empty" class="muted" style="display:none;font-size:0.85rem;margin:0.35rem 0 0"></p>
    <p id="ca-image-slots-empty" class="muted" style="display:none;font-size:0.85rem;margin:0.35rem 0 0">No Structure photo slots enabled.</p>
  </div>`;
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
  return groups
    .map(
      (g) => `<section class="ca-image-slot-section" data-section-group="${esc(g.key)}">
      <h4 class="ca-image-slot-section-title">${esc(g.label)}</h4>
      <div class="ca-image-slot-section-grid">${g.slots.map(imagesSlotCardHtml).join('')}</div>
    </section>`,
    )
    .join('');
}

async function refreshImageSlotsGrid(candidateId) {
  const grid = document.getElementById('ca-image-slots-grid');
  const empty = document.getElementById('ca-image-slots-empty');
  const filterEmpty = document.getElementById('ca-image-slots-filter-empty');
  const totalsEl = document.getElementById('ca-image-slots-totals');
  if (!grid) return;
  const filter = imagesMatchFilterId(state.imageMatchFilter);
  state.imageMatchFilter = filter;
  try {
    const data = await api(`/api/candidates/${encodeURIComponent(candidateId)}/images/slots`);
    const slots = data?.slots || [];
    if (!slots.length) {
      grid.innerHTML = '';
      if (totalsEl) totalsEl.innerHTML = '';
      if (filterEmpty) {
        filterEmpty.style.display = 'none';
        filterEmpty.textContent = '';
      }
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (totalsEl) totalsEl.innerHTML = imagesMatchTotalsHtml(data.matchTotals, filter);
    const visible = slots.filter((s) => imagesSlotMatchesFilter(s, filter));
    grid.innerHTML = imagesSlotsGroupedHtml(visible);
    if (filterEmpty) {
      if (!visible.length) {
        filterEmpty.style.display = 'block';
        const labels = {
          all: 'No photo slots.',
          poor: 'No poor matches.',
          ok: 'No ok matches.',
          good: 'No good matches.',
          upload: 'No operator uploads.',
          empty: 'No empty slots.',
        };
        filterEmpty.textContent = labels[filter] || 'No matching slots.';
      } else {
        filterEmpty.style.display = 'none';
        filterEmpty.textContent = '';
      }
    }
  } catch (error) {
    if (totalsEl) totalsEl.innerHTML = '';
    if (filterEmpty) {
      filterEmpty.style.display = 'none';
      filterEmpty.textContent = '';
    }
    grid.innerHTML = `<p class="muted" style="font-size:0.85rem">${esc(error.message || 'Could not load slots')}</p>`;
  }
}

/** After slot Re-pull/Upload: keep Review images open; refresh grid + status only. */
async function refreshImageSlotInPlace(candidateId, candidate) {
  if (candidate) state.detail = candidate;
  state.websiteOpenStep = 'images';
  state.websiteFollowCurrent = 'images';
  state.websiteSoftCurrent = 'images';
  const statusEl = document.getElementById('ca-images-status');
  if (statusEl && state.detail) {
    statusEl.textContent = imagesStatusLine(state.detail);
  }
  await refreshImageSlotsGrid(candidateId);
  setImagesProgress(false);
}

function wireImageSlotActions(candidateId, _refreshFn) {
  const root = document.getElementById('ca-image-slots');
  if (!root || root.dataset.wired === '1') return;
  root.dataset.wired = '1';

  root.addEventListener('click', async (ev) => {
    const bulkBtn = ev.target.closest('.img-match-bulk-repull');
    if (bulkBtn && root.contains(bulkBtn)) {
      ev.preventDefault();
      ev.stopPropagation();
      if (bulkBtn.disabled) return;
      const grade = bulkBtn.getAttribute('data-bulk-repull');
      if (grade !== 'poor' && grade !== 'ok') return;
      const gradeLabel = grade === 'poor' ? 'Poor' : 'Ok';
      if (!(await confirmLaunchedSiteChange(`Re-pull ${gradeLabel} photo slots`))) return;
      bulkBtn.disabled = true;
      try {
        const data = await api(`/api/candidates/${encodeURIComponent(candidateId)}/images/slots`);
        const targets = (data?.slots || []).filter((s) => imagesSlotMatchesFilter(s, grade));
        if (!targets.length) {
          showToast(`No ${gradeLabel} slots to re-pull.`);
          return;
        }
        state.imageMatchFilter = grade;
        let lastCandidate = null;
        for (let i = 0; i < targets.length; i += 1) {
          const slotKey = targets[i].key;
          setImagesProgress(true, {
            label: `Re-pulling ${gradeLabel}…`,
            detail: slotKey,
            current: i + 1,
            total: targets.length,
          });
          const result = await api(
            `/api/candidates/${encodeURIComponent(candidateId)}/images/slots/${encodeURIComponent(slotKey)}/repull`,
            { method: 'POST', body: JSON.stringify(withLaunchedConfirmBody({})) },
          );
          lastCandidate = result.candidate || lastCandidate;
        }
        await refreshImageSlotInPlace(candidateId, lastCandidate);
        showToast(`Re-pulled ${targets.length} ${gradeLabel} slot${targets.length === 1 ? '' : 's'}.`);
      } catch (error) {
        setImagesProgress(false);
        await refreshImageSlotsGrid(candidateId);
        await showModal({
          title: 'Bulk Re-pull failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p><p class="muted">Slots already re-pulled were kept.</p>`,
        });
      } finally {
        bulkBtn.disabled = false;
      }
      return;
    }
    const filterBtn = ev.target.closest('[data-match-filter]');
    if (filterBtn && root.contains(filterBtn)) {
      const next = imagesMatchFilterId(filterBtn.getAttribute('data-match-filter'));
      if (state.imageMatchFilter === next) return;
      state.imageMatchFilter = next;
      await refreshImageSlotsGrid(candidateId);
      return;
    }
    const vpBtn = ev.target.closest('[data-ba-viewpoint]');
    if (vpBtn && root.contains(vpBtn)) {
      const group = vpBtn.closest('[data-ba-viewpoint-step]');
      if (!group || !root.contains(group)) return;
      ev.preventDefault();
      const stepKey = group.dataset?.baViewpointStep || '';
      if (!stepKey) return;
      const next = setBaViewpoint(stepKey, vpBtn.dataset.baViewpoint);
      group.querySelectorAll('[data-ba-viewpoint]').forEach((b) => {
        b.classList.toggle('active', b.dataset.baViewpoint === next);
      });
      return;
    }
    const promptBtn = ev.target.closest('.ca-slot-chatgpt-prompt');
    if (promptBtn && root.contains(promptBtn)) {
      ev.preventDefault();
      const slotKey = promptBtn.getAttribute('data-slot-key');
      if (!slotKey) return;
      promptBtn.disabled = true;
      try {
        const viewpoint = getBaViewpoint(slotKey);
        const params = new URLSearchParams({ viewpoint });
        const data = await api(
          `/api/candidates/${encodeURIComponent(candidateId)}/images/slots/${encodeURIComponent(slotKey)}/chatgpt-prompt?${params}`,
        );
        const text = String(data?.prompt || '');
        if (!text) throw new Error('Empty prompt');
        await navigator.clipboard.writeText(text);
        showToast(
          `Copied ChatGPT prompt · ${data.label || slotKey} · ${data.viewpoint || viewpoint} (${text.length} chars). Paste into ChatGPT, then Upload.`,
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
    setImagesProgress(true, {
      label: `Re-pulling ${slotKey}…`,
      detail: 'Searching providers',
      current: 1,
      total: 2,
    });
    try {
      const result = await api(
        `/api/candidates/${encodeURIComponent(candidateId)}/images/slots/${encodeURIComponent(slotKey)}/repull`,
        { method: 'POST', body: JSON.stringify(withLaunchedConfirmBody({})) },
      );
      setImagesProgress(true, {
        label: 'Slot updated',
        detail: result.slot?.filename || slotKey,
        current: 2,
        total: 2,
      });
      await refreshImageSlotInPlace(candidateId, result.candidate);
    } catch (error) {
      setImagesProgress(false);
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
    setImagesProgress(true, {
      label: `Uploading ${slotKey}…`,
      detail: file.name,
      current: 1,
      total: 2,
    });
    try {
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
      setImagesProgress(true, {
        label: 'Upload saved',
        detail: result.slot?.filename || slotKey,
        current: 2,
        total: 2,
      });
      await refreshImageSlotInPlace(candidateId, result.candidate);
    } catch (error) {
      setImagesProgress(false);
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
  const imagesDone = Boolean(
    d?.imagesManifest?.files?.length || f.hasImages || d?.siteConfig?.logo,
  );
  const hasLogoAsset = Boolean(f.hasLogo || d?.siteConfig?.logo);
  const hasCoverageMapAsset = Boolean(f.hasCoverageMap);
  const hasStockPhotos = Boolean(d?.imagesManifest?.files?.length || f.hasImages);
  const pullPhotosBtnLabel = hasStockPhotos ? 'Re-pull photos' : 'Pull photos';
  const pullPhotosTip = hasStockPhotos
    ? 'Accept usually already pulled stock. Fills empty slots, or asks before replacing when every slot is full (not logo/map).'
    : 'Accept normally pulls stock. Use here if Accept skipped or failed.';
  const pullPhotosHint = hasStockPhotos
    ? 'Already on site from Accept (or a prior run) — fills gaps, or confirms before replacing stock only (not logo/map).'
    : 'Usually auto after Accept — use if stock slots are still empty.';
  const logoBtnLabel = hasLogoAsset ? 'Regenerate logo' : 'Generate logo';
  const mapBtnLabel = hasCoverageMapAsset ? 'Regenerate coverage map' : 'Generate coverage map';
  const logoTip = hasLogoAsset
    ? 'Accept usually already created this. Click to replace the existing header logo SVG.'
    : 'Accept normally creates this. Use here if Accept skipped or failed.';
  const mapTip = hasCoverageMapAsset
    ? 'Accept usually already created this. Click to replace the existing coverage-map.svg and homepage Areas map.'
    : 'Accept normally creates this when Areas exist. Use here if Accept skipped or failed.';
  const logoHint = hasLogoAsset
    ? 'Already on site from Accept (or a prior run) — this button replaces the monogram SVG.'
    : 'Usually auto after Accept — use if logo is still missing.';
  const mapHint = hasCoverageMapAsset
    ? 'Already on site from Accept (or a prior run) — this button replaces the Nominatim SVG / Areas map.'
    : 'Usually auto after Accept when Areas exist — use if the map is still missing.';
  const prepareDone = flags.staged && flags.assembled && !assembleStale;
  const indexingStepDone = isSoftDone('websiteSoftDone', 'indexing');
  const stepFlags = {
    imagesDone,
    prepareDone,
    launched: flags.launched,
    indexingDone: indexingStepDone,
  };
  const durableCurrent = firstIncompleteWebsiteStep(stepFlags);
  const currentId = resolvePanelCurrent('websiteSoftCurrent', durableCurrent);
  if (state.preparePreviewHold) {
    state.websiteOpenStep = 'prepare';
    state.websiteSoftCurrent = 'prepare';
    state.websiteFollowCurrent = 'prepare';
  } else if (state.websiteFollowCurrent !== currentId) {
    state.websiteOpenStep = currentId;
    state.websiteFollowCurrent = currentId;
  }
  const openId = state.websiteOpenStep;
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
      info: 'Review images → Prepare preview → Launch (or Push updates) → Indexing (Search Console + sitemap). Revert restores Rover from GitHub if a launched site drifted.',
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
  } else if (!imagesDone) {
    parts.push(
      statusLineHtml(
        'Up next: <strong>Review images</strong> — stock photos, logo, and coverage map (usually auto after Accept).',
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
  const assembleProgVisible = Boolean(assembleProg.visible || state.preparePreviewHold);

  parts.push(
    contentStepHtml({
      id: 'images',
      num: 1,
      title: 'Review images',
      done: imagesStepDone,
      open: openId === 'images',
      current: currentId === 'images' && !imagesStepDone,
      info: 'Accept content already pulls stock photos (and generates logo/map when possible). Use <strong>Pull photos</strong> to fill empty slots, or to replace the set when every slot is full. Per-slot Re-pull / Upload / Copy prompt (ChatGPT) for near-launch QA — process slots show step titles; What we do cards use named service slots. ChatGPT before/after is optional gallery polish.',
      bodyHtml: `
        ${contentActionRow({
          n: 1,
          label: pullPhotosBtnLabel,
          hint: pullPhotosHint,
          done: hasStockPhotos,
          controlsHtml: `
            <div class="flex-wrap gap-2" style="display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center">
              <button type="button" class="btn" id="ca-pull-images" data-tip="${esc(
                pullPhotosTip,
              )}">${esc(pullPhotosBtnLabel)}</button>
            </div>`,
        })}
        ${contentActionRow({
          n: 2,
          label: logoBtnLabel,
          hint: logoHint,
          done: hasLogoAsset,
          controlsHtml: `<button type="button" class="btn" id="ca-generate-logo" data-tip="${esc(
            logoTip,
          )}">${esc(logoBtnLabel)}</button>`,
        })}
        ${contentActionRow({
          n: 3,
          label: mapBtnLabel,
          hint: mapHint,
          done: hasCoverageMapAsset,
          controlsHtml: `<button type="button" class="btn" id="ca-generate-map" data-tip="${esc(
            mapTip,
          )}">${esc(mapBtnLabel)}</button>`,
        })}
        ${contentActionRow({
          n: 4,
          label: 'Before & after (ChatGPT)',
          hint: 'Homepage gallery: copy prompts → generate in ChatGPT (browser) → import two images (any order; earlier filename time = Before).',
          controlsHtml: `
            <div class="flex-wrap gap-2" style="display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center">
              ${baViewpointSegmentHtml('home')}
              <button type="button" class="btn" id="ca-ba-copy-before" data-tip="Copy BEFORE image prompt">Copy before</button>
              <button type="button" class="btn" id="ca-ba-copy-after" data-tip="Copy AFTER image prompt">Copy after</button>
              <a class="btn" id="ca-ba-open-chatgpt" href="https://chatgpt.com/" target="_blank" rel="noopener" data-tip="Open ChatGPT in a new tab">Open ChatGPT</a>
              <label class="btn" style="cursor:pointer" data-tip="Choose before then after image files">
                Import pair
                <input type="file" id="ca-ba-import-files" accept="image/jpeg,image/png,image/webp" multiple hidden />
              </label>
            </div>
            <p class="muted" id="ca-ba-status" style="margin:0.35rem 0 0;font-size:0.85rem"></p>
            <div id="ca-ba-preview"></div>`,
        })}
        <div id="ca-svc-ba-steps"></div>
        <div id="ca-images-progress" class="job-progress hidden" aria-live="polite">
          <div class="job-progress-track"><div class="job-progress-bar" id="ca-images-progress-bar"></div></div>
          <p class="job-progress-label" id="ca-images-progress-label">Working…</p>
          <p class="job-progress-detail" id="ca-images-progress-detail">Starting…</p>
        </div>
        <div id="ca-images-status" class="callout muted">${esc(imagesStatusLine(d))}</div>
        ${imagesSlotsShellHtml()}`,
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
      num: 2,
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
          <p class="job-progress-label" id="ca-assemble-progress-label">Preparing preview…</p>
          <p class="job-progress-detail" id="ca-assemble-progress-detail">${esc(
            assembleProg.detail || (state.preparePreviewHold ? 'Starting…' : 'Working…'),
          )}</p>
        </div>`,
    }),
  );

  parts.push(
    contentStepHtml({
      id: 'launch',
      num: 3,
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
        <div id="ca-launch-progress" class="job-progress hidden" aria-live="polite">
          <div class="job-progress-track"><div class="job-progress-bar"></div></div>
          <p class="job-progress-label" id="ca-launch-progress-label">Launching…</p>
          <p class="job-progress-detail" id="ca-launch-progress-detail">Starting…</p>
        </div>
        </div>`,
    }),
  );

  const sitemapUrl = liveSitemapUrl(cfg.domain);
  const robotsUrl = liveRobotsUrl(cfg.domain);
  const indexingLocked = !flags.launched;
  parts.push(
    contentStepHtml({
      id: 'indexing',
      num: 4,
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
          <button type="button" class="btn primary" id="ca-copy-sitemap-url" data-tip="Copy https://{domain}/sitemap.xml" ${
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
          <button type="button" class="btn" id="ca-indexing-mark-done" data-tip="Mark this step done when you’ve submitted the sitemap">Mark done</button>
        </div>
        ${
          sitemapUrl
            ? `<p class="muted" style="margin-top:0.5rem;font-size:0.85rem"><code id="ca-sitemap-url-text">${esc(
                sitemapUrl,
              )}</code></p>`
            : `<p class="muted" style="margin-top:0.5rem">Set a real domain on Launch / site-config to get the sitemap URL.</p>`
        }`,
    }),
  );

  const canRevert = Boolean(flags.launched && d?.meta?.githubRepo);
  parts.push(
    contentStepHtml({
      id: 'revert',
      title: 'Revert',
      plain: true,
      open: true,
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

  return parts.join('');
}

const LAUNCH_PROGRESS_STEPS = [
  'Writing keys / site-config…',
  'GitHub create + push…',
  'npm install + build…',
  'Wrangler deploy…',
  'Cloudflare domain / Email Routing…',
];

const SHIP_PROGRESS_STEPS = [
  'GitHub commit + push…',
  'npm install + build…',
  'Wrangler deploy…',
  'Workers Builds (best-effort)…',
];

function setLaunchProgress(visible, label, detail) {
  const box = document.getElementById('ca-launch-progress');
  const labelEl = document.getElementById('ca-launch-progress-label');
  const detailEl = document.getElementById('ca-launch-progress-detail');
  if (!box) return;
  box.classList.toggle('hidden', !visible);
  if (labelEl && label) labelEl.textContent = label;
  if (detailEl && detail) detailEl.textContent = detail;
}

function setAssembleProgress(visible, detail) {
  state.assembleProgress = {
    visible: Boolean(visible),
    detail: detail != null ? String(detail) : state.assembleProgress?.detail || '',
  };
  const box = document.getElementById('ca-assemble-progress');
  const detailEl = document.getElementById('ca-assemble-progress-detail');
  const labelEl = document.getElementById('ca-assemble-progress-label');
  if (!box) return;
  box.classList.toggle('hidden', !visible);
  if (detailEl && detail != null) detailEl.textContent = String(detail);
  if (labelEl && visible) labelEl.textContent = 'Preparing preview…';
}

/** Drive Website prepare spinner from Jobs SSE/poll for the held prepare jobId. */
function syncPrepareProgressFromJobs(snap) {
  const id = String(state.selectedId || '').trim();
  const heldJobId = String(state.preparePreviewJobId || '').trim();
  if (!id || !state.preparePreviewHold || !heldJobId) return;
  const jobs = Array.isArray(snap?.jobs) ? snap.jobs : [];
  const job = jobs.find((j) => j.id === heldJobId);
  if (!job) return;

  if (job.status === 'queued') {
    setAssembleProgress(true, 'Prepare preview: Queued…');
    return;
  }
  if (job.status === 'running') {
    setAssembleProgress(
      true,
      `Prepare preview: ${job.detail || 'Running…'}`,
    );
    return;
  }
  if (job.status === 'done') {
    // Click handler owns hold / button; only update progress copy here.
    setAssembleProgress(true, 'Prepare finished — opening result…');
    return;
  }
  if (job.status === 'error') {
    setAssembleProgress(
      true,
      `Prepare failed: ${job.error || job.detail || 'error'}`,
    );
  }
}

const ACCEPT_PROGRESS_STEPS = [
  'Writing files to src/content…',
  'Pulling stock photos (if enabled)…',
  'Generating logo…',
  'Finishing assets (photos, logo, coverage map)…',
];

function formatAcceptElapsed(ms) {
  const sec = Math.max(0, Math.floor(Number(ms) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function startAcceptProgressTicker() {
  const startedAt = Date.now();
  let stepIdx = 0;
  const tick = () => {
    const elapsed = formatAcceptElapsed(Date.now() - startedAt);
    const step = ACCEPT_PROGRESS_STEPS[stepIdx] || ACCEPT_PROGRESS_STEPS.at(-1);
    const stillWorking =
      stepIdx >= ACCEPT_PROGRESS_STEPS.length - 1
        ? `Still working (${elapsed}) — photos and coverage map can take 1–3 min for large service areas. Watch the Rover terminal for [accept] / [coverage-map] lines.`
        : `${step} (${elapsed})`;
    setAcceptProgress(true, {
      label: 'Accepting…',
      detail: stillWorking,
    });
    stepIdx = Math.min(stepIdx + 1, ACCEPT_PROGRESS_STEPS.length - 1);
  };
  tick();
  return setInterval(tick, 2000);
}

function setAcceptProgress(visible, { label, detail } = {}) {
  const box = document.getElementById('ca-accept-progress');
  const labelEl = document.getElementById('ca-accept-progress-label');
  const detailEl = document.getElementById('ca-accept-progress-detail');
  if (!box) return;
  box.classList.toggle('hidden', !visible);
  if (labelEl && label) labelEl.textContent = label;
  if (detailEl && detail) detailEl.textContent = detail;
}

function setImagesProgress(visible, { label, detail, current, total } = {}) {
  const box = document.getElementById('ca-images-progress');
  const labelEl = document.getElementById('ca-images-progress-label');
  const detailEl = document.getElementById('ca-images-progress-detail');
  const bar = document.getElementById('ca-images-progress-bar');
  if (!box) return;
  box.classList.toggle('hidden', !visible);
  if (labelEl && label) labelEl.textContent = label;
  if (detailEl && detail) detailEl.textContent = detail;
  if (bar) {
    const known = Number(total) > 0 && Number(current) >= 0;
    bar.classList.toggle('is-determinate', known);
    if (known) {
      const pct = Math.max(4, Math.min(100, Math.round((Number(current) / Number(total)) * 100)));
      bar.style.width = `${pct}%`;
    } else {
      bar.style.width = '';
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
    state.detail = candidate || (await api(`/api/candidates/${encodeURIComponent(id)}`));
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
      renderDetail();
    });
  });

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
        state.detail = result.candidate;
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
      await refresh(result.candidate, 'outline');
      if (result.warnings?.length) {
        showToast(result.warnings.join(' '), { tone: 'warn' });
      } else {
        showToast('Outline composed — copy structure prompt next.');
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
      showToast('Outline loaded & confirmed — copy full-write prompt next.');
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

  document.querySelectorAll('.js-copy-continue-prompt').forEach((btn) => {
    btn.addEventListener('click', () => copyContinueWritePrompt(id));
  });

  document.getElementById('cb-generate')?.addEventListener('click', async () => {
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/content/brief`, {
        method: 'POST',
        body: JSON.stringify({ regenerate: true }),
      });
      await refresh(result.candidate, 'structure');
    } catch (error) {
      await showModal({ title: 'Brief failed', confirmLabel: 'OK', bodyHtml: `<p>${esc(error.message)}</p>` });
    }
  });
  document.getElementById('cb-save')?.addEventListener('click', async () => {
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/content/brief`, {
        method: 'POST',
        body: JSON.stringify({
          sections: collectBriefSectionsFromDom(),
          meta: state.detail?.contentBrief?.meta || {},
          siteArchetype: state.detail?.contentBrief?.siteArchetype,
        }),
      });
      await refresh(result.candidate, 'structure');
    } catch (error) {
      await showModal({ title: 'Save failed', confirmLabel: 'OK', bodyHtml: `<p>${esc(error.message)}</p>` });
    }
  });
  document.getElementById('cb-confirm')?.addEventListener('click', async () => {
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/content/brief/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          sections: collectBriefSectionsFromDom(),
          meta: state.detail?.contentBrief?.meta || {},
          siteArchetype: state.detail?.contentBrief?.siteArchetype,
        }),
      });
      await refresh(result.candidate, 'write');
    } catch (error) {
      await showModal({ title: 'Confirm failed', confirmLabel: 'OK', bodyHtml: `<p>${esc(error.message)}</p>` });
    }
  });
  document
    .getElementById('cb-copy-oneshot')
    ?.addEventListener(
      'click',
      copyPrompt(`/api/candidates/${encodeURIComponent(id)}/content/oneshot/prompt`, 'One-shot prompt'),
    );

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
      await refresh(result.candidate);
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
      await refresh(result.candidate);
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
      await refresh(result.candidate);
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
  document.getElementById('ca-speech-check')?.addEventListener('click', async () => {
    try {
      const data = await api(`/api/candidates/${encodeURIComponent(id)}/content/speech-lint`);
      const needs = contentNeedsEditorRewrite(data);
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
        showToast('Speech/SEO Refinement clear — ready to Accept.');
      }
      await refresh(data.candidate || state.detail, needs.needed ? 'editor' : 'accept');
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
        const incompleteHtml = incompleteDraftExplainHtml({
          have: launch?.have || 0,
          expectedCount: launch?.expectedCount || missing.length,
          missing,
          stubs,
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
        const incompleteHtml = incompleteDraftExplainHtml({
          have: launch?.have || 0,
          expectedCount: launch?.expectedCount || 0,
          missing: [],
          stubs: stubsOnly,
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
        speechData?.candidate || result.candidate || (await api(`/api/candidates/${encodeURIComponent(id)}`));
      // Prefer Accept when lint is clean; stay on Speech/SEO Refinement when rewrite still recommended
      await refresh(candidate, needsRewrite ? 'editor' : 'accept');
      const bits = [
        'Draft loaded',
        fixN ? `auto-fixed ${fixN}` : null,
        proofN ? `${proofN} placeholder reviews` : null,
        needsRewrite
          ? 'speech/SEO leftovers — rewrite or Accept with care'
          : reAcceptNeeded
            ? 'Speech/SEO Refinement clear — Accept again to publish'
            : 'Speech/SEO Refinement clear',
      ].filter(Boolean);
      showToast(bits.join(' · '), { tone: needsRewrite || msgs.length ? 'warn' : 'ok' });
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
  const importDiskToDraft = async () => {
    try {
      const pages = structurePageIdsFromDetail(state.detail);
      const wantsFull =
        pages.includes('services') ||
        pages.includes('locations') ||
        pages.includes('about') ||
        pages.includes('contact') ||
        state.detail?.contentOutlinePackage?.status === 'confirmed';
      const mode = wantsFull ? 'full' : 'homepage_first';
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/content/import-disk`, {
        method: 'POST',
        body: JSON.stringify({ mode }),
      });
      await refresh(result.candidate, 'editor');
      const msgs = [...(result.check?.errors || []), ...(result.check?.warnings || [])];
      const fixN = result.autoFix?.changeCount || 0;
      const fileN = Object.keys(result.draft?.files || {}).length;
      await showModal({
        title: 'Imported to candidate draft',
        confirmLabel: 'OK',
        bodyHtml: `<p>Loaded <strong>${esc(String(fileN))}</strong> file(s) from <code>src/content/</code> (${esc(
          mode,
        )}) into <code>research/${esc(
          id,
        )}-content.draft.json</code>. Accept when ready.</p>${
          msgs.length ? `<p class="muted">${esc(msgs.join('; '))}</p>` : ''
        }${fixN ? `<p class="muted">Auto-fixed ${esc(String(fixN))} issue(s).</p>` : ''}`,
      });
    } catch (error) {
      await showModal({
        title: 'Import failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  };
  document.getElementById('ca-import-disk-editor')?.addEventListener('click', importDiskToDraft);
  const runPullImages = async () => {
    const pullBtn = document.getElementById('ca-pull-images');
    const setBusy = (busy) => {
      if (pullBtn) pullBtn.disabled = busy;
    };
    let replace = false;
    try {
      const slotSnap = await api(`/api/candidates/${encodeURIComponent(id)}/images/slots`);
      const slots = slotSnap?.slots || [];
      if (!slots.length) {
        await showModal({
          title: 'No photo slots',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml:
            '<p>Structure has no photo-capable sections for this candidate. Enable photos on sections first.</p>',
        });
        return;
      }
      const missing = slots.filter((s) => s.missing).length;
      if (missing === 0) {
        const ok = await showModal({
          title: 'Replace existing stock photos?',
          confirmLabel: 'Replace all',
          cancelLabel: 'Cancel',
          bodyHtml:
            '<p>Every slot already has a photo. Replace re-downloads stock only (not logo or coverage map). Per-slot Re-pull can refresh one image instead.</p>',
        });
        if (!ok) return;
        replace = true;
      }
    } catch (error) {
      await showModal({
        title: 'Could not check photo slots',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
      return;
    }

    if (!(await confirmLaunchedSiteChange(replace ? 'Replace stock photos' : 'Pull photos'))) {
      return;
    }

    setBusy(true);
    setImagesProgress(true, {
      label: replace ? 'Replacing images…' : 'Pulling photos…',
      detail: 'Starting…',
    });
    let pollTimer = null;
    const pollProgress = async () => {
      try {
        const snap = await api(`/api/candidates/${encodeURIComponent(id)}/images`);
        const ps = snap?.pullStatus;
        if (ps?.status === 'running') {
          setImagesProgress(true, {
            label: replace ? 'Replacing images…' : 'Pulling photos…',
            detail: ps.label || `${ps.current || 0}/${ps.total || '?'}`,
            current: ps.current,
            total: ps.total,
          });
        }
      } catch {
        // ignore poll errors while pull runs
      }
    };
    pollTimer = setInterval(pollProgress, 600);
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/images/pull`, {
        method: 'POST',
        body: JSON.stringify(withLaunchedConfirmBody({ replace: Boolean(replace) })),
      });
      clearInterval(pollTimer);
      pollTimer = null;
      const filled = result.filled ?? 0;
      const total = result.total ?? 0;
      const sources = result.sources || {};
      const sourceLine = Object.keys(sources).length
        ? ` · ${Object.entries(sources)
            .map(([k, v]) => `${k}×${v}`)
            .join(' · ')}`
        : '';
      setImagesProgress(true, {
        label: replace ? 'Images replaced' : 'Photos pulled',
        detail: `${filled}/${total} slots${sourceLine}`,
        current: total,
        total: total || 1,
      });
      await refresh(result.candidate, 'images', 'website');
      const lines = (result.human || []).map((h) => `<p>${esc(h)}</p>`).join('');
      const files = (result.files || [])
        .slice(0, 12)
        .map((f) => `<li><code>${esc(f.filename || '')}</code></li>`)
        .join('');
      await showModal({
        title: replace ? 'Images replaced' : 'Photos pulled',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `${lines || '<p>Done.</p>'}${
          files ? `<ul class="narrative-list">${files}</ul>` : ''
        }`,
      });
    } catch (error) {
      if (pollTimer) clearInterval(pollTimer);
      setImagesProgress(false);
      await showModal({
        title: 'Image pull failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      setBusy(false);
      if (pollTimer) clearInterval(pollTimer);
    }
  };

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

  const writePreviewTabHtml = (tab, { title, body }) => {
    if (!tab || tab.closed) return;
    try {
      const doc = tab.document;
      const existingTitle = doc.getElementById('rover-preview-title');
      const existingBody = doc.getElementById('rover-preview-body');
      if (existingTitle && existingBody) {
        doc.title = title;
        existingTitle.textContent = title;
        existingBody.innerHTML = body;
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
          .wrap{display:flex;flex-direction:column;align-items:center;gap:1.25rem;max-width:28rem;text-align:center}
          h1{font-size:1.05rem;font-weight:600;margin:0;color:#fff}
          p{margin:0;color:rgba(255,255,255,0.72)}
          code{font-size:0.9em;color:rgba(255,255,255,0.88)}
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
          <p id="rover-preview-body">${body}</p>
        </div>
        </body></html>`);
      tab.document.close();
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
    setAssembleProgress(true, 'Checking content…');
    // Re-render so the in-step bar appears and Prepare is disabled before gaps/modals.
    renderDetail();
    let previewTab = null;
    let progressTimer = null;
    const abortPrepareUi = () => {
      if (progressTimer) clearInterval(progressTimer);
      state.preparePreviewHold = false;
      state.preparePreviewJobId = null;
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
      });
      setAssembleProgress(true, 'Prepare preview queued (stage → assemble → preview)…');
      progressTimer = setInterval(() => {
        setAssembleProgress(
          true,
          'Prepare preview running (stage → assemble → build → preview)… check Jobs for status',
        );
      }, 8000);

      let jobId = null;
      try {
        const accepted = await api(`/api/candidates/${encodeURIComponent(id)}/prepare-preview`, {
          method: 'POST',
          body: JSON.stringify(withLaunchedConfirmBody({ forcePrepare })),
        });
        jobId = accepted.jobId;
      } catch (enqueueErr) {
        const joinId = enqueueErr?.status === 409 && enqueueErr?.job?.id ? enqueueErr.job.id : null;
        if (!joinId) throw enqueueErr;
        jobId = joinId;
        setAssembleProgress(true, 'Prepare preview already running — joining…');
      }
      state.preparePreviewJobId = jobId;
      const prepared = await waitForHeavyJobResult(jobId);
      clearInterval(progressTimer);
      progressTimer = null;
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
        setAssembleProgress(true, 'Preview ready — opening site…');
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
      setAssembleProgress(true, preview?.ok ? 'Preview ready' : 'Preview failed');
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
      if (progressTimer) clearInterval(progressTimer);
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
      if (progressTimer) clearInterval(progressTimer);
      state.preparePreviewHold = false;
      state.preparePreviewJobId = null;
      setAssembleProgress(false);
      if (state.selectedId === id && state.tab === 'website') renderDetail();
    }
  });
  document.getElementById('ca-pull-images')?.addEventListener('click', () => runPullImages());
  wireImageSlotActions(id, refresh);
  void refreshImageSlotsGrid(id);
  void refreshBeforeAfterUi(id);
  document.getElementById('ca-generate-logo')?.addEventListener('click', async () => {
    const btn = document.getElementById('ca-generate-logo');
    if (!(await confirmLaunchedSiteChange('Generate / regenerate logo'))) return;
    if (btn) btn.disabled = true;
    setImagesProgress(true, {
      label: 'Generating logo…',
      detail: 'Building SVG monogram',
      current: 1,
      total: 3,
    });
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/logo/generate`, {
        method: 'POST',
        body: JSON.stringify(withLaunchedConfirmBody({})),
      });
      setImagesProgress(true, {
        label: 'Logo ready',
        detail: result.path || '/images/logo.svg',
        current: 3,
        total: 3,
      });
      await refresh(result.candidate, 'images', 'website');
      await showModal({
        title: 'Logo generated',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>Wrote <code>${esc(result.path || '/images/logo.svg')}</code> and set site-config <code>logo</code>. Use <strong>Prepare preview</strong> to see it on the header.</p>`,
      });
    } catch (error) {
      setImagesProgress(false);
      await showModal({
        title: 'Logo failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      if (btn) btn.disabled = false;
      setTimeout(() => setImagesProgress(false), 800);
    }
  });
  document.getElementById('ca-generate-map')?.addEventListener('click', async () => {
    const btn = document.getElementById('ca-generate-map');
    if (!(await confirmLaunchedSiteChange('Generate coverage map'))) return;
    if (btn) btn.disabled = true;
    setImagesProgress(true, {
      label: 'Generating coverage map…',
      detail: 'Looking up municipal boundaries (~1s per city)',
      current: 0,
      total: 0,
    });
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/coverage-map/generate`, {
        method: 'POST',
        body: JSON.stringify(withLaunchedConfirmBody({})),
      });
      setImagesProgress(true, {
        label: 'Coverage map ready',
        detail: `${result.areas || '?'} areas · ${result.path || 'coverage-map.svg'}`,
        current: 1,
        total: 1,
      });
      await refresh(result.candidate, 'images', 'website');
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
      setImagesProgress(false);
      await showModal({
        title: 'Coverage map failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      if (btn) btn.disabled = false;
      setTimeout(() => setImagesProgress(false), 800);
    }
  });

  const baStatus = (msg) => {
    const el = document.getElementById('ca-ba-status');
    if (el) el.textContent = msg || '';
  };
  const baSvcStatus = (slug, msg) => {
    const el = document.querySelector(`.ca-ba-svc-status[data-ba-service="${CSS.escape(slug)}"]`);
    if (el) el.textContent = msg || '';
  };
  const copyBaPrompt = async (kind, serviceSlug = '') => {
    try {
      const stepKey = serviceSlug || 'home';
      const viewpoint = getBaViewpoint(stepKey);
      const params = new URLSearchParams({ viewpoint });
      if (serviceSlug) params.set('service', serviceSlug);
      const prompts = await api(
        `/api/candidates/${encodeURIComponent(id)}/images/before-after-prompts?${params}`,
      );
      const text = prompts[kind] || prompts.pair || '';
      await navigator.clipboard.writeText(text);
      const note = `Copied ${kind} prompt · ${viewpoint} (${text.length} chars). Paste into ChatGPT.`;
      if (serviceSlug) baSvcStatus(serviceSlug, note);
      else baStatus(note);
    } catch (error) {
      if (serviceSlug) baSvcStatus(serviceSlug, error.message || 'Copy failed');
      else baStatus(error.message || 'Copy failed');
      await showModal({
        title: 'Prompt failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    }
  };
  document.getElementById('ca-ba-copy-before')?.addEventListener('click', () =>
    copyBaPrompt('before'),
  );
  document.getElementById('ca-ba-copy-after')?.addEventListener('click', () =>
    copyBaPrompt('after'),
  );

  const applyBaViewpointClick = (btn) => {
    const group = btn.closest('[data-ba-viewpoint-step]');
    const stepKey = group?.dataset?.baViewpointStep || 'home';
    const next = setBaViewpoint(stepKey, btn.dataset.baViewpoint);
    group?.querySelectorAll('[data-ba-viewpoint]').forEach((b) => {
      b.classList.toggle('active', b.dataset.baViewpoint === next);
    });
  };
  const homeBaControls = document.getElementById('ca-ba-copy-before')?.closest('.flex-wrap');
  if (homeBaControls && homeBaControls.dataset.baViewpointWired !== '1') {
    homeBaControls.dataset.baViewpointWired = '1';
    homeBaControls.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-ba-viewpoint]');
      if (!btn || !homeBaControls.contains(btn)) return;
      applyBaViewpointClick(btn);
    });
  }

  const fileToDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
      reader.readAsDataURL(file);
    });

  const importBaPair = async (files, serviceSlug = '') => {
    const payloadFiles = [];
    for (const file of files.slice(0, 2)) {
      payloadFiles.push({
        name: file.name,
        lastModified: file.lastModified || 0,
        dataUrl: await fileToDataUrl(file),
      });
    }
    const body = { files: payloadFiles };
    if (serviceSlug) body.serviceSlug = serviceSlug;
    return api(`/api/candidates/${encodeURIComponent(id)}/images/before-after-import`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  };

  document.getElementById('ca-ba-import-files')?.addEventListener('change', async (ev) => {
    const input = ev.target;
    const files = [...(input.files || [])];
    if (!files.length) return;
    if (files.length < 2) {
      baStatus('Select two images (any order — earlier filename time becomes Before).');
      input.value = '';
      return;
    }
    baStatus('Importing before/after pair (ordering by filename time)…');
    try {
      const result = await importBaPair(files);
      await refresh(result.candidate, 'images', 'website');
      baStatus(
        `Imported pair #${result.pairIndex}: ${result.files?.map((f) => f.filename).join(', ')}. Stage → Assemble to preview.`,
      );
      await showModal({
        title: 'Before/after imported',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>Ordered by filename time (earlier = Before). Saved <code>${esc(
          (result.files || []).map((f) => f.filename).join('</code>, <code>'),
        )}</code>. Stock beforeAfter pulls were cleared. Stage → Assemble to preview.</p>`,
      });
    } catch (error) {
      baStatus(error.message || 'Import failed');
      await showModal({
        title: 'Import failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      input.value = '';
    }
  });

  const svcBaRoot = document.getElementById('ca-svc-ba-steps');
  if (svcBaRoot && svcBaRoot.dataset.baWired !== '1') {
    svcBaRoot.dataset.baWired = '1';
    svcBaRoot.addEventListener('click', (ev) => {
      const vpBtn = ev.target.closest('[data-ba-viewpoint]');
      if (vpBtn && svcBaRoot.contains(vpBtn)) {
        applyBaViewpointClick(vpBtn);
        return;
      }
      const btn = ev.target.closest('.ca-ba-svc-copy');
      if (!btn || !svcBaRoot.contains(btn)) return;
      const slug = btn.getAttribute('data-ba-service') || '';
      const kind = btn.getAttribute('data-ba-kind') || 'before';
      copyBaPrompt(kind, slug);
    });
    svcBaRoot.addEventListener('change', async (ev) => {
      const input = ev.target.closest('.ca-ba-svc-import');
      if (!input || !svcBaRoot.contains(input)) return;
      const slug = input.getAttribute('data-ba-service') || '';
      const files = [...(input.files || [])];
      if (!files.length) return;
      if (files.length < 2) {
        baSvcStatus(slug, 'Select two images (any order — earlier filename time becomes Before).');
        input.value = '';
        return;
      }
      baSvcStatus(slug, 'Importing before/after pair…');
      try {
        const result = await importBaPair(files, slug);
        await refresh(result.candidate, 'images', 'website');
        baSvcStatus(
          slug,
          `Imported ${result.serviceName || slug}: ${result.files?.map((f) => f.filename).join(', ')}. Stage → Assemble to preview.`,
        );
        await showModal({
          title: 'Service before/after imported',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>Saved for <strong>${esc(
            result.serviceName || slug,
          )}</strong>: <code>${esc(
            (result.files || []).map((f) => f.filename).join('</code>, <code>'),
          )}</code>. Stage → Assemble to preview.</p>`,
        });
      } catch (error) {
        baSvcStatus(slug, error.message || 'Import failed');
        await showModal({
          title: 'Import failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p>`,
        });
      } finally {
        input.value = '';
      }
    });
  }

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

  document.getElementById('ca-indexing-mark-done')?.addEventListener('click', () => {
    state.websiteSoftDone = { ...(state.websiteSoftDone || {}), indexing: true };
    state.websiteFollowCurrent = null;
    state.websiteOpenStep = 'indexing';
    showToast('Indexing marked done.');
    renderDetail();
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
    let stepIdx = 0;
    setLaunchProgress(true, 'Pushing updates…', SHIP_PROGRESS_STEPS[0]);
    const shipTimer = setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, SHIP_PROGRESS_STEPS.length - 1);
      setLaunchProgress(true, 'Pushing updates…', SHIP_PROGRESS_STEPS[stepIdx]);
    }, 12000);
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/ship`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await refresh(result.candidate || state.detail, 'launch', 'website');
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
      await showModal({
        title: 'Push updates failed',
        confirmLabel: 'OK',
        bodyHtml: `<p>${esc(error.message)}</p>`,
      });
    } finally {
      clearInterval(shipTimer);
      setLaunchProgress(false);
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
    let stepIdx = 0;
    setLaunchProgress(true, 'Launching…', LAUNCH_PROGRESS_STEPS[0]);
    const launchTimer = setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, LAUNCH_PROGRESS_STEPS.length - 1);
      setLaunchProgress(true, 'Launching…', LAUNCH_PROGRESS_STEPS[stepIdx]);
    }, 12000);
    try {
      const body = { ...pendingBody, allowIncompleteLaunch };
      const result = await api(`/api/candidates/${encodeURIComponent(id)}/launch`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await refresh(result.candidate, 'indexing', 'website');
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
      clearInterval(launchTimer);
      setLaunchProgress(false);
      form?.querySelectorAll('input,button,select,textarea').forEach((el) => {
        el.disabled = false;
      });
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
        if (!(await confirmLaunchedSiteChange('Paste content draft'))) {
          pasteBtn.disabled = false;
          return;
        }
        const result = await api(`/api/candidates/${encodeURIComponent(id)}/content/paste`, {
          method: 'POST',
          body: JSON.stringify(withLaunchedConfirmBody({ text })),
        });
        await refresh(result.candidate, 'accept');
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
      let acceptTimer = startAcceptProgressTicker();
      try {
        let result;
        try {
          result = await api(`/api/candidates/${encodeURIComponent(id)}/content/accept`, {
            method: 'POST',
            body: JSON.stringify(withLaunchedConfirmBody({ ignoreSeoWarnings: ignoreSeo })),
          });
        } catch (error) {
          if (error.message?.includes('ignoreWarnings') || error.check?.warnings?.length) {
            clearInterval(acceptTimer);
            setAcceptProgress(false);
            const force = await showModal({
              title: 'Content warnings',
              confirmLabel: 'Write anyway',
              bodyHtml: `<p>${esc(error.message)}</p>`,
            });
            if (!force) throw error;
            acceptTimer = startAcceptProgressTicker();
            try {
              result = await api(`/api/candidates/${encodeURIComponent(id)}/content/accept`, {
                method: 'POST',
                body: JSON.stringify(
                  withLaunchedConfirmBody({ ignoreWarnings: true, ignoreSeoWarnings: ignoreSeo }),
                ),
              });
            } finally {
              clearInterval(acceptTimer);
            }
          } else if (error.message?.includes('ignoreSeoWarnings') || error.seoLint) {
            clearInterval(acceptTimer);
            setAcceptProgress(false);
            const force = await showModal({
              title: 'Critical SEO findings',
              confirmLabel: 'Accept with SEO warnings',
              bodyHtml: `<p>${esc(error.message)}</p><p class="muted">Or cancel and fix via the Editor step.</p>`,
            });
            if (!force) throw error;
            acceptTimer = startAcceptProgressTicker();
            try {
              result = await api(`/api/candidates/${encodeURIComponent(id)}/content/accept`, {
                method: 'POST',
                body: JSON.stringify(withLaunchedConfirmBody({ ignoreSeoWarnings: true })),
              });
            } finally {
              clearInterval(acceptTimer);
            }
          } else {
            throw error;
          }
        }
        clearInterval(acceptTimer);
        setAcceptProgress(false);
        await refresh(result.candidate, 'prepare', 'website');
        const map = result.coverageMap;
        const logo = result.logo;
        const mapMissing = map && (map.ok === false || map.skipped);
        const logoOk = logo && logo.ok !== false && logo.path;
        const mapOk = map && map.ok && map.path;
        const mapMissList = Array.isArray(map?.missingBoundaries) ? map.missingBoundaries : [];
        const mapWarn = mapMissing
          ? `<p class="callout warn">Coverage map missing${
              map.warning ? `: ${esc(map.warning)}` : ''
            }. Accept already tried — re-run under <strong>Website</strong> → Review images → <strong>Regenerate coverage map</strong> (button says Generate if none exists yet), then Prepare preview.</p>`
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
          <p><strong>Up next:</strong> <strong>Website</strong> → Review images → <strong>Prepare preview</strong> (full Stage + Assemble + open :4322).</p>`,
        });
      } catch (error) {
        clearInterval(acceptTimer);
        setAcceptProgress(false);
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
          <button type="button" class="btn primary" id="prospects-copy-outreach-prompt" data-tip="Copy Claude.ai outreach prompt with this prospects JSON">
            Copy outreach prompt
          </button>
          ${openClaudeAiBtnHtml()}
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
          state.detail = result.candidate || (await api(`/api/candidates/${encodeURIComponent(d.id)}`));
        }
        if (!state.siteConfigSoftDone) state.siteConfigSoftDone = {};
        state.siteConfigSoftDone.look = true;
        state.tab = 'site-config';
        advancePanelStep('site-config', 'address');
        renderDetail();
        showToast(
          hasConfig
            ? `Look applied · ${paletteId} · ${fontTheme}`
            : `Look saved · ${paletteId} · ${fontTheme} — applied when you Load draft`,
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
    if (result?.candidate) state.detail = result.candidate;
    if (!state.siteConfigSoftDone) state.siteConfigSoftDone = {};
    state.siteConfigSoftDone.address = true;
    advancePanelStep('site-config', 'details');
    renderDetail();
  };
  document.getElementById('ba-show-home')?.addEventListener('click', () => {
    document.getElementById('ba-home-panel')?.classList.remove('hidden');
  });

  const runBaAddressSearch = async ({ refreshLoopnet = false } = {}) => {
    if (state.baSearchBusy) return;
    state.baSearchBusy = true;
    state.baSearchMode = refreshLoopnet ? 'refresh' : 'find';
    if (!state.siteConfigOpenStep) state.siteConfigOpenStep = 'address';
    renderDetail();
    const stopBaBusy = () => {
      state.baSearchBusy = false;
      state.baSearchMode = 'find';
      renderDetail();
    };
    try {
      const result = await api(`/api/candidates/${encodeURIComponent(d.id)}/address/search`, {
        method: 'POST',
        body: JSON.stringify({ refreshLoopnet: Boolean(refreshLoopnet) }),
      });
      if (result?.candidate) state.detail = result.candidate;
      if (result?.apifyPlanUsage) state.apifyPlanUsage = result.apifyPlanUsage;
      else if (result?.package?.apifyPlanUsage) {
        state.apifyPlanUsage = result.package.apifyPlanUsage;
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
            <p class="muted">Until then use <strong>Use my home address</strong> or <strong>Skip address</strong>.</p>`,
        });
        return;
      }
      const added = Number(pkg?.lastSearchStats?.added ?? 0);
      const clean = Number(pkg?.lastSearchStats?.shortlist ?? 0);
      const title =
        kind === 'cache_exhausted'
          ? 'Cache exhausted'
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
          failed: Boolean(kind && kind !== 'empty_screened'),
        }),
      });
    } catch (error) {
      try {
        const refreshed = await api(`/api/candidates/${encodeURIComponent(d.id)}`);
        if (refreshed) state.detail = refreshed;
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
          <p class="muted">Until then use <strong>Use my home address</strong> or <strong>Skip address</strong>.</p>`,
        });
      } else {
        await showModal({
          title: 'Address search failed',
          confirmLabel: 'OK',
          hideCancel: true,
          bodyHtml: `<p>${esc(error.message)}</p><p class="muted">You can still Use my home address or Skip. Check APIFY_* and GOOGLE_MAPS_API_KEY in .env for Find.</p>`,
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
    const unscreened =
      pkg?.lastSearchStats?.unscreenedRemaining != null
        ? Number(pkg.lastSearchStats.unscreenedRemaining)
        : null;

    if (cacheLen > 0 && fresh && unscreened === 0) {
      const go = await showModal({
        title: 'No more cached candidates',
        confirmLabel: 'Refresh LoopNet',
        cancelLabel: 'Cancel',
        bodyHtml: `<p>All listings in the cached LoopNet list are already screened.</p>
          <p class="muted"><strong>Refresh LoopNet</strong> pulls new listings (costs Apify), then screens only streets you have not seen yet.</p>`,
      });
      if (!go) return;
      await runBaAddressSearch({ refreshLoopnet: true });
      return;
    }

    if (cacheLen > 0 && !fresh) {
      const go = await showModal({
        title: 'LoopNet cache is stale',
        confirmLabel: 'Refresh LoopNet',
        cancelLabel: 'Screen remaining',
        bodyHtml: `<p>Cached listings are older than 7 days.</p>
          <p class="muted"><strong>Refresh LoopNet</strong> re-scrapes (Apify billable). <strong>Screen remaining</strong> keeps the old cache and only runs Places on unscreened streets (Apify $0).</p>`,
      });
      // showModal: confirm=true, cancel=false — need check how cancel works
      if (go === true) {
        await runBaAddressSearch({ refreshLoopnet: true });
      } else if (go === false) {
        await runBaAddressSearch({ refreshLoopnet: false });
      }
      return;
    }

    await runBaAddressSearch({ refreshLoopnet: false });
  });

  document.getElementById('ba-refresh-loopnet')?.addEventListener('click', async () => {
    if (state.baSearchBusy) return;
    const go = await showModal({
      title: 'Refresh LoopNet?',
      confirmLabel: 'Refresh (billable)',
      cancelLabel: 'Cancel',
      bodyHtml: `<p>This re-runs the Apify LoopNet actor for this city (billable), merges new listings into the cache, and screens streets not already decided.</p>
        <p class="muted">Prefer <strong>Find addresses</strong> when the cache is still fresh — that continues without Apify.</p>`,
    });
    if (!go) return;
    await runBaAddressSearch({ refreshLoopnet: true });
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
              source: 'commercial',
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
          radiusMiles: nap.radiusMiles || '40',
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
        state.detail = result.candidate || (await api(`/api/candidates/${encodeURIComponent(d.id)}`));
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

  async function acceptSiteConfigFromUi(triggerBtn, { clearCommercial = false } = {}) {
    if (triggerBtn) triggerBtn.disabled = true;
    try {
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
      const needsDraftSeed =
        !hasEditForm &&
        !d.siteConfigDraft &&
        !state.detail?.siteConfigDraft &&
        Boolean(d.siteConfig || state.detail?.siteConfig);

      if (hasEditForm || needsDraftSeed || clearCommercial) {
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

      const ok = await showModal({
        title: 'Write site-config.json?',
        confirmLabel: remaining.length ? 'Write with placeholders' : 'Write file',
        bodyHtml: remaining.length
          ? `<p>Writes to <code>src/config/site-config.json</code> (backs up previous).</p>
               <p>Still placeholders: <code>${esc(remaining.join(', '))}</code> — OK for an early build; fill later in Edit draft.</p>`
          : clearCommercial
            ? '<p>Writes site-config with <strong>commercialServices cleared</strong> (one What we do grid). No Claude re-prompt.</p>'
            : '<p>Writes draft to <code>src/config/site-config.json</code> (backs up previous). Next step is content markdown.</p>',
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
        if (error.suburbCheck) {
          const force = await showModal({
            title: 'Suburb warnings',
            confirmLabel: 'Write anyway',
            bodyHtml: `<p>${esc(error.message)}</p>`,
          });
          if (!force) throw error;
          result = await postAccept({ ignoreSuburbWarnings: true });
        } else if (/placeholder/i.test(String(error.message || ''))) {
          result = await postAccept({ allowPlaceholders: true });
        } else {
          throw error;
        }
      }
      state.detail = result.candidate || (await api(`/api/candidates/${encodeURIComponent(d.id)}`));
      advancePanelStep('site-config', 'service-area');
      state.tab = 'site-config';
      renderDetail();
      await showModal({
        title: 'Site config written',
        confirmLabel: 'OK',
        bodyHtml: `<p>Wrote <code>${esc(result.path || 'src/config/site-config.json')}</code>${
          clearCommercial ? ' with residential services only' : ''
        }. Next: <strong>6 · Service area</strong> (map + radius), then <strong>7 · Provision phone</strong> / Content.</p>${
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
        state.detail = result.candidate || (await api(`/api/candidates/${encodeURIComponent(d.id)}`));
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
        if (result.suburbCheck?.warnings?.length) {
          notes.push(result.suburbCheck.warnings.join('; '));
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
  bindAccept('site-config-accept-btn');
  bindAccept('site-config-reaccept-btn');
  bindAccept('site-config-accept-with-commercial', { clearCommercial: false });
  bindAccept('site-config-accept-keep-commercial', { clearCommercial: false });
  bindAccept('site-config-accept-residential-only', { clearCommercial: true });
  bindAccept('site-config-accept-residential-only-update', { clearCommercial: true });

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
      state.detail = result.candidate || (await api(`/api/candidates/${encodeURIComponent(cid)}`));
      renderDetail();
      await showModal({
        title: 'Number provisioned',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p><strong>${esc(result.provisioned?.phone || result.provisioned?.e164 || '')}</strong> written to site-config.</p>
          <p class="muted small">Continue Content, then Website Prepare / Launch. Use Launched Sites → Update site phone number if you need to re-ship later.</p>`,
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
      state.detail = result.candidate || (await api(`/api/candidates/${encodeURIComponent(cid)}`));
      renderDetail();
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
      const data = await api('/api/sites');
      const row = (data.sites || []).find((s) => s.candidateId === d.id);
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
  setServiceAreaTableMode(false);

  if (serviceAreaOpen && saHost && saMapCanvas) {
    setServiceAreaTableMode(true);
    const accepted = d.siteConfig;
    void mountServiceAreaMap({
      mapHost: saMapCanvas,
      controlsHost: saHost,
      api,
      esc,
      primaryCity: accepted.primaryCity,
      state: accepted.state,
      radiusMiles: accepted.serviceRadiusMiles || 40,
      initialSelected: Array.isArray(accepted.coverageAreas)
        ? accepted.coverageAreas
        : (accepted.targetSuburbs || []).map((name) => ({ name, state: accepted.state })),
      claudeOrder: Array.isArray(accepted.targetSuburbs) ? accepted.targetSuburbs : [],
      onAccept: async ({ radiusMiles, selectedCities, locationPageCities }) => {
        const result = await api(
          `/api/candidates/${encodeURIComponent(d.id)}/site-config/service-area`,
          {
            method: 'POST',
            body: JSON.stringify({
              radiusMiles,
              selectedCities,
              claudeOrder: accepted.targetSuburbs || [],
              locationPageCities: locationPageCities || [],
            }),
          },
        );
        if (!state.siteConfigSoftDone) state.siteConfigSoftDone = {};
        state.siteConfigSoftDone['service-area'] = true;
        markSoftDonePrior('siteConfigSoftDone', SITE_CONFIG_STEP_ORDER, 'service-area');
        state.detail = result.candidate || (await api(`/api/candidates/${encodeURIComponent(d.id)}`));
        showToast(
          `Service area saved · ${result.coverageAreas?.length || 0} coverage · ${
            result.targetSuburbs?.length || 0
          } location pages`,
          { tone: 'ok' },
        );
        advancePanelStep('site-config', 'phone');
        renderDetail();
      },
    }).then((m) => {
      serviceAreaMount = m;
      m?.invalidateSize?.();
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
  wireOpsTooltips();
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
  document.getElementById('candidate-add-to-sites-btn')?.addEventListener('click', async () => {
    const ids = [...state.selectedIds];
    if (!ids.length) return;
    const ok = await showModal({
      title: 'Add selection to Sites?',
      confirmLabel: `Add to Sites (${ids.length})`,
      bodyHtml: `<p>Upsert <strong>${esc(String(ids.length))}</strong> selected candidate(s) into the Sites portfolio. Existing rows are updated, not duplicated.</p>`,
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
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.tab = tab.dataset.tab;
      renderDetail();
    });
  });

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
    titleEl.textContent = mode === 'website-builder' ? 'Website Builder' : 'Research';
  }
  const subEl = document.getElementById('candidates-view-sub');
  if (subEl) {
    subEl.textContent =
      mode === 'website-builder'
        ? 'Committed Candidates (pursue) — Site-Config, Content, Prepare / Launch'
        : 'Potential Candidates — SERP, enrich, narrative, prospects';
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
  if (view !== 'discovery') {
    closeDiscoveryCitiesMap();
  }
}

const SITE_TABLE_COLS = [
  { key: 'niche', label: 'Niche' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'ST' },
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
  if (!wrap) return;
  wrap.classList.toggle('hidden', !visible);
  if (labelEl && label != null) labelEl.textContent = label;
  if (detailEl && detail != null) detailEl.textContent = detail;
  if (bar) {
    if (pct == null || !Number.isFinite(Number(pct))) {
      bar.classList.remove('is-determinate');
      bar.style.width = '';
    } else {
      const clamped = Math.max(0, Math.min(100, Number(pct)));
      bar.classList.add('is-determinate');
      bar.style.width = `${clamped}%`;
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
    const active = state.siteSort.key === col.key;
    const arrow = active ? (state.siteSort.dir > 0 ? ' ↑' : ' ↓') : '';
    return `<th class="sortable" data-sort="${esc(col.key)}">${esc(col.label)}${arrow}</th>`;
  }).join('')}</tr>`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${SITE_TABLE_COLS.length}" class="muted">No sites yet — Launch a candidate or Add from candidate.</td></tr>`;
  } else {
    tbody.innerHTML = rows
      .map((s) => {
        const active = s.id === state.selectedSiteId ? 'active' : '';
        const domainCell = s.liveUrl
          ? `<a href="${esc(s.liveUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(
              s.domain || s.liveUrl,
            )}</a>`
          : esc(s.domain || '—');
        return `<tr class="${active}" data-id="${esc(s.id)}">
          <td>${esc(s.niche || '—')}</td>
          <td>${esc(s.city || '—')}</td>
          <td>${esc(s.state || '—')}</td>
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
    tr.addEventListener('click', () => {
      state.selectedSiteId = tr.dataset.id;
      renderSitesTable();
      renderSitesDetail();
    });
  });
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
        cancelLabel: 'Stay on Launched Sites',
        bodyHtml: `<p>Stage → Assemble finished${
          buildOk ? '' : ' (build reported a problem — check Website Builder)'
        }. Assembled site-config includes the new phone.</p>
          <p>This listing is <strong>not live yet</strong>. Finish first go-live with <strong>Website Builder → Run launch</strong> (domain / email / Web3Forms). Launch is not run from Launched Sites.</p>`,
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
      <p class="muted small">Removes this listing from Launched Sites only. Research candidate and live site are kept.</p>
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
      title: 'Remove from Launched Sites?',
      confirmLabel: 'Continue',
      danger: true,
      bodyHtml: `<p>You are about to remove <strong>${esc(label)}</strong> from the Launched Sites table.</p>
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
      bodyHtml: `<p>Confirm removal of <strong>${esc(label)}</strong> from Launched Sites.</p>
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
    parts.push(`<p class="muted small" style="padding:0.5rem">No Twilio DIDs yet — provision from Launched Sites.</p>`);
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
}

function renderPhoneDetail() {
  const empty = document.getElementById('phone-empty-detail');
  const body = document.getElementById('phone-detail-body');
  if (!empty || !body) return;
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
          ? `<button type="button" class="btn" id="phone-open-site">Open site in Launched Sites</button>`
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
      .slice(0, 20)
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
  if (status === 'promoted' || status === 'tracked') return status;
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
  const { decided, total, pendingProcess, allDecided } = discoveryHumanDecisionProgress(
    state.discoveryRows,
  );
  const canProcess = allDecided && pendingProcess > 0;

  if (processBtn) {
    processBtn.disabled = !canProcess;
    setElementTip(
      processBtn,
      total === 0
        ? 'Import a batch and set Human decisions first'
        : !allDecided
          ? `Set Human on every row (${decided}/${total}) before processing`
          : pendingProcess === 0
            ? 'No unprocessed rows left — all decided rows are already processed'
            : `Process ${pendingProcess} decided row(s): pursue/maybe/review/hold → Candidates; pass/deprioritize → tracked`,
    );
  }

  if (progressEl) {
    if (total === 0) {
      progressEl.hidden = true;
      progressEl.textContent = '';
    } else {
      progressEl.hidden = false;
      progressEl.textContent = allDecided
        ? `${decided}/${total} Human decisions made`
        : `${decided}/${total} Human decisions made, complete decisions to process batch.`;
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
    const visible = new Set(filteredCandidates().map((c) => c.id));
    for (const id of [...state.selectedIds]) {
      if (!visible.has(id)) state.selectedIds.delete(id);
    }
    if (state.selectedId && !visible.has(state.selectedId)) {
      state.selectedId = null;
      state.detail = null;
      syncCandidatesDetailVisibility();
    } else if (state.selectedId) {
      state.detail = await api(`/api/candidates/${encodeURIComponent(state.selectedId)}`);
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
}

const DISCOVERY_SOURCES = {
  claude: { id: 'claude', label: 'Claude', tip: 'From Claude narrative CSV' },
  census: { id: 'census', label: 'Census', tip: 'US Census population lookup on import' },
  dfs: { id: 'dfs', label: 'DFS', tip: 'DataForSEO Discovery SERP probe' },
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
    tip: 'Yes/No from DFS SERP probe',
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
    key: 'Organic Home Page',
    label: 'Homepages',
    sortable: true,
    tip: 'Organic homepage count from DFS SERP probe (URL path / only; directories excluded). Not niche-title filtered.',
    cellClass: 'col-short',
    source: 'dfs',
  },
  {
    key: 'Organic Sub Page',
    label: 'Subpages',
    sortable: true,
    tip: 'Organic subpage count from DFS SERP probe (non-homepage URLs; directories excluded). Not niche-title filtered.',
    cellClass: 'col-short',
    source: 'dfs',
  },
  {
    key: 'confidence_serp',
    label: 'Conf SERP',
    sortable: true,
    tip: 'high after DFS SERP probe',
    cellClass: 'col-short',
    source: 'dfs',
  },
  {
    key: 'recommended_decision',
    label: 'Recommend',
    sortable: true,
    tip: 'Rover heuristic from Map Pack + organic (best after DFS probe)',
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
    tip: 'Notes (Claude/Rover warnings or your comments)',
    cellClass: 'col-notes',
    source: 'ops',
  },
  {
    key: 'candidateId',
    label: 'Candidate',
    sortable: true,
    tip: 'Candidate id after promote, or “tracked” for pass/deprioritize',
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
      `Reopened ${result.reopened?.length || 0} row(s). Change Human if needed, then Process batch.`,
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

function renderDiscoveryTable() {
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
    const cls = c.sortable ? 'sortable' : '';
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
      const cells = DISCOVERY_TABLE_COLS.map((col) => {
        const tdClass = col.cellClass ? ` class="${esc(col.cellClass)}"` : '';
        if (col.key === '_select') {
          return `<td${tdClass}><input type="checkbox" data-disc-idx="${idx}" class="disc-row-check" ${checked} /></td>`;
        }
        if (col.key === '_accept') {
          if (tracked) {
            return `<td${tdClass}><button type="button" class="btn btn-sm" data-reopen-idx="${idx}" data-tip="Clear tracked status so you can change Human and Process again">Reopen</button></td>`;
          }
          if (processed) {
            return `<td${tdClass}><span class="metric metric-good" data-tip="In Candidates as ${esc(
              row.candidateId || '',
            )}">✓ Candidates</span></td>`;
          }
          const disabled = !row.recommended_decision ? 'disabled' : '';
          return `<td${tdClass}><button type="button" class="btn btn-accept" data-accept-idx="${idx}" data-tip="Copy Recommend → Human" ${disabled}>Accept</button></td>`;
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
          const val = row.candidateId || '';
          return `<td${tdClass} data-tip="${esc(val)}"><span class="cell-text">${esc(val || '—')}</span></td>`;
        }
        const val = row[col.key] ?? '';
        return `<td${tdClass} data-tip="${esc(val)}"><span class="cell-text">${esc(val)}</span></td>`;
      });
      const rowClass = [
        processed ? 'disc-row-processed' : '',
        tracked ? 'disc-row-tracked' : '',
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
    cb.addEventListener('change', () => {
      const idx = Number(cb.dataset.discIdx);
      if (cb.checked) state.discoverySelected.add(idx);
      else state.discoverySelected.delete(idx);
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
      ? `process +${data.batch.lastProcess.promoted?.length || 0} · ○${
          data.batch.lastProcess.tracked?.length || 0
        } · −${data.batch.lastProcess.skipped?.length || 0}`
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
      )} tracked · −${esc(String(lp.skipped?.length || 0))} skipped · Stage 1 ×${esc(
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
    });
  });

  showDiscoverySidebarStep('pack');
  wireSitesUi();
  wirePhoneUi();

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
      updateDiscoveryStepChecks(pack.batch, state.discoveryRows);
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
        bodyHtml: `<p>Loaded <strong>${esc(String(result.rows.length))}</strong> rows. Next: <strong>SERP probe</strong>.</p>${warnHtml}`,
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
    showDiscoverySidebarStep('enrich');
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
      const enrichBtn = document.getElementById('discovery-enrich-pack-btn');
      if (enrichBtn) enrichBtn.disabled = true;
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
        showDiscoverySidebarStep(null);
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
        bodyHtml: '<p>Select processed or tracked rows first.</p>',
      });
      return;
    }
    const ok = await showModal({
      title: 'Reopen selected rows?',
      confirmLabel: `Reopen ${indices.length}`,
      bodyHtml:
        '<p>Clears processed/tracked markers so you can change Human and Process again. Existing Candidate files are kept.</p>',
    });
    if (!ok) return;
    await reopenDiscoveryIndices(indices);
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
    const trackCount = withDecision.filter((r) =>
      ['pass', 'deprioritize', 'pass_unless_gbp_angle'].includes(r.human_decision),
    ).length;
    if (!withDecision.length) {
      await showModal({
        title: 'Nothing to process',
        confirmLabel: 'OK',
        bodyHtml: alreadyCount
          ? '<p>All decided rows are already processed. Set decisions on remaining rows, Reopen tracked rows, or open Candidates.</p>'
          : '<p>Set human decisions (or Accept recommendations) first.</p>',
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
          }. Change on Candidates → Ad volumes.</p>`
        : '';
    const ok = await showModal({
      title: 'Process discovery batch?',
      confirmLabel: pursueCount
        ? `Process + Stage 1 (${pursueCount} pursue)`
        : 'Process',
      bodyHtml: `<p><strong>${esc(String(promoteCount))}</strong> → Candidates · <strong>${esc(
        String(trackCount),
      )}</strong> tracked (pass/deprioritize/…) · already done ${esc(String(alreadyCount))}.</p>
        <p><strong>Pursue → Stage 1:</strong> ${esc(String(pursueCount))} · est. $${esc(estLow)}–$${esc(estHigh)} DFS</p>
        ${adsLine}
        <p class="muted">Blank Human rows are ignored. Pass does not create Candidates.</p>`,
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
        )}</strong> tracked · skipped ${esc(String(result.skipped?.length || 0))}${
          alreadySkipped
            ? ` (${esc(String(alreadySkipped))} already processed)`
            : ''
        } · Stage 1 queued for ${esc(String(result.pursueIds?.length || 0))} pursue.${
          (result.promoted || []).some((p) => p.linkedExisting)
            ? ` · ${esc(
                String((result.promoted || []).filter((p) => p.linkedExisting).length),
              )} linked to existing candidates (anti-dupe).`
            : ''
        }</p><p class="muted">${
          openCandidates
            ? 'Switching to Research filtered to this batch.'
            : 'Tracked passes stay out of Research — Reopen a row to change your mind.'
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
wireJobsUi();
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
