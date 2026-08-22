const PREVIEW_ORIGIN = 'http://127.0.0.1:4322';
const MSG = 'rover-ve';
const HELLO_MS = 8000;

let deps = { api: null, esc: null, showModal: null };
let candidateId = null;
let snapshot = null;
let selected = null;
let dirty = false;
let device = 'desktop';
let helloWait = null;
let busy = false;
let previewRefreshing = false;
let structurePreviewQueued = false;
let structurePreviewTimer = null;
let sectionVisibleWait = null;
let reorderWait = null;
/** Sidebar row order — stable across hide/show (not enabled-first). */
let sectionDisplayOrder = null;
const STRUCTURE_PREVIEW_MS = 800;

function waitForHello(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      helloWait = null;
      resolve(false);
    }, ms);
    helloWait = () => {
      clearTimeout(t);
      helloWait = null;
      resolve(true);
    };
  });
}

function el(id) {
  return document.getElementById(id);
}

function frame() {
  return el('ve-frame');
}

function setStatus(text, kind = '') {
  const n = el('ve-status');
  if (!n) return;
  n.textContent = text || '';
  n.dataset.kind = kind;
}

function setProgressVisible(on) {
  const bar = el('ve-progress');
  if (!bar) return;
  bar.classList.toggle('hidden', !on);
  bar.setAttribute('aria-hidden', on ? 'false' : 'true');
}

function showStageLoading(step) {
  const overlay = el('ve-stage-loading');
  const text = el('ve-stage-loading-text');
  if (text) text.textContent = step || 'Loading…';
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
  }
  setProgressVisible(true);
  setStatus(step || 'Loading…');
}

function hideStageLoading() {
  const overlay = el('ve-stage-loading');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }
  setProgressVisible(false);
}

async function attachPreview(href = '/') {
  const iframe = frame();
  const pending = waitForHello(HELLO_MS);
  if (iframe) iframe.src = bust(href);
  return pending;
}

function bust(href = '/') {
  const path = href.startsWith('http') ? new URL(href).pathname : href || '/';
  const u = new URL(path, `${PREVIEW_ORIGIN}/`);
  u.searchParams.set('ve', String(Date.now()));
  return u.toString();
}

function postToFrame(payload) {
  const win = frame()?.contentWindow;
  if (!win) return;
  win.postMessage({ type: MSG, ...payload }, PREVIEW_ORIGIN);
}

function activateFrame() {
  postToFrame({ action: 'activate' });
  liveApplyTheme();
}

function renderPageSelect() {
  const sel = el('ve-page');
  if (!sel) return;
  const pages = snapshot?.pages || [];
  const current = sel.value;
  sel.innerHTML = pages
    .map(
      (p) =>
        `<option value="${deps.esc(p.href)}">${deps.esc(p.label)}${p.href === '/' ? ' (home)' : ''}</option>`,
    )
    .join('');
  if (pages.some((p) => p.href === current)) sel.value = current;
}

function liveApplyTheme({ paletteId, fontThemeId } = {}) {
  const brand = snapshot?.config?.brand || {};
  const palette =
    (snapshot?.palettes || []).find((p) => p.id === (paletteId || snapshot?.config?.paletteId)) ||
    null;
  const theme =
    (snapshot?.fontThemes || []).find(
      (t) => t.id === (fontThemeId || snapshot?.config?.fontTheme || 'archivo-source'),
    ) || null;
  const primary = palette?.brand?.primary || brand.primary;
  const accent = palette?.brand?.accent || brand.accent;
  const ink = palette?.brand?.ink || brand.ink;
  postToFrame({
    action: 'applyTheme',
    primary,
    accent,
    ink,
    fontDisplay: theme?.displayStack || '',
    fontBody: theme?.bodyStack || '',
    googleHref: theme?.googleHref || '',
  });
}

function renderPalette() {
  const wrap = el('ve-palettes');
  if (!wrap) return;
  const current = snapshot?.config?.paletteId || '';
  wrap.innerHTML = (snapshot?.palettes || [])
    .map((p) => {
      const on = p.id === current ? 'on' : '';
      const b = p.brand || {};
      return `<button type="button" class="ve-swatch ${on}" data-palette="${deps.esc(p.id)}" title="${deps.esc(p.label)}">
        <span style="background:${deps.esc(b.primary || '#333')}"></span>
        <span style="background:${deps.esc(b.accent || '#999')}"></span>
        ${deps.esc(p.label)}
      </button>`;
    })
    .join('');
  wrap.querySelectorAll('[data-palette]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const paletteId = btn.dataset.palette;
      liveApplyTheme({ paletteId });
      await applyPatches([{ type: 'palette', paletteId }], { liveOk: true });
    });
  });
  renderFonts();
}

function renderFonts() {
  const wrap = el('ve-fonts');
  if (!wrap) return;
  const current = snapshot?.config?.fontTheme || 'archivo-source';
  wrap.innerHTML = (snapshot?.fontThemes || [])
    .map((t) => {
      const on = t.id === current ? 'on' : '';
      return `<button type="button" class="ve-font ${on}" data-font-theme="${deps.esc(t.id)}" title="${deps.esc(
        t.tip || t.label,
      )}">
        <span class="ve-font-label">${deps.esc(t.label)}</span>
        <span class="ve-font-sample" style="font-family:${deps.esc(t.displayStack)}">Aa</span>
        <span class="ve-font-meta">${deps.esc(t.displayFamily)} / ${deps.esc(t.bodyFamily)}</span>
      </button>`;
    })
    .join('');
  wrap.querySelectorAll('[data-font-theme]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fontTheme = btn.dataset.fontTheme;
      liveApplyTheme({ fontThemeId: fontTheme });
      await applyPatches([{ type: 'fontTheme', fontTheme }], { liveOk: true });
    });
  });
}

function structureIdToAstroKey(id) {
  if (!id) return null;
  // Process / offerProcess share one homepage band in the template.
  if (id === 'offerProcess') return 'process';
  const cat = (snapshot?.catalogSections || []).find((s) => s.id === id);
  const key = cat?.astroKey || (id === 'beforeAfter' ? 'gallery' : id);
  if (key === 'offerProcess') return 'process';
  return key || null;
}

function enabledAstroOrder(sectionIds) {
  const keys = [];
  const seen = new Set();
  for (const id of sectionIds || []) {
    const key = structureIdToAstroKey(id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function liveReorderSections(sectionIds) {
  return new Promise((resolve) => {
    const order = enabledAstroOrder(sectionIds);
    const t = setTimeout(() => {
      reorderWait = null;
      resolve({ found: 0, moved: 0, order, timedOut: true });
    }, 600);
    reorderWait = (msg) => {
      clearTimeout(t);
      reorderWait = null;
      resolve({
        found: Number(msg?.found) || 0,
        moved: Number(msg?.moved) || 0,
        order: msg?.order || order,
      });
      return true;
    };
    postToFrame({ action: 'reorderSections', order });
  });
}

async function refreshPreviewForLiveSections() {
  if (!candidateId) return;
  setStatus('Refreshing preview for section order…');
  showStageLoading('Refreshing preview…');
  try {
    await deps.api(`/api/candidates/${encodeURIComponent(candidateId)}/visual-edit/preview`, {
      method: 'POST',
      body: JSON.stringify({ smart: true }),
    });
    await attachPreview(el('ve-page')?.value || '/');
    activateFrame();
  } finally {
    hideStageLoading();
  }
}

/** Live DOM reorder first; rebuild once if markers missing; persist; honest status. */
async function applyLiveSectionOrder(nextSections) {
  let result = await liveReorderSections(nextSections);
  if (result.found < 2) {
    setStatus('Preview missing section markers — refreshing…');
    await refreshPreviewForLiveSections();
    result = await liveReorderSections(nextSections);
  }
  const ok = await applyPatches(
    [{ type: 'structure', action: 'reorder', sections: nextSections }],
    { quiet: true },
  );
  if (!ok) return false;
  await syncSectionVisibilityFromStructure();
  if (result.moved >= 2) {
    setStatus('Live preview updated', 'ok');
    return true;
  }
  setStatus('Order saved — preview did not move (try Save draft)', 'err');
  return false;
}

function liveSetSectionVisible(sectionId, visible) {
  return new Promise((resolve) => {
    const key = structureIdToAstroKey(sectionId);
    if (!key) {
      resolve(false);
      return;
    }
    const t = setTimeout(() => {
      sectionVisibleWait = null;
      resolve(false);
    }, 400);
    sectionVisibleWait = (msg) => {
      if (msg?.id && msg.id !== key) return false;
      clearTimeout(t);
      sectionVisibleWait = null;
      resolve(Boolean(msg?.ok));
      return true;
    };
    postToFrame({ action: 'setSectionVisible', id: key, visible: Boolean(visible) });
  });
}

/** Clear stale hidden attrs so required/enabled bands match structure.sections. */
async function syncSectionVisibilityFromStructure() {
  const on = new Set(snapshot?.structure?.sections || []);
  for (const s of snapshot?.catalogSections || []) {
    if (!s?.id) continue;
    await liveSetSectionVisible(s.id, on.has(s.id));
  }
}

function pinDisplayEnds(ids) {
  const list = (ids || []).map(String).filter(Boolean);
  const mid = list.filter((id) => id !== 'hero' && id !== 'cta');
  const out = [];
  if (list.includes('hero')) out.push('hero');
  out.push(...mid);
  if (list.includes('cta')) out.push('cta');
  return out;
}

function buildInitialDisplayOrder() {
  const catalog = snapshot?.catalogSections || [];
  const byId = new Set(catalog.map((s) => s.id));
  const enabled = (snapshot?.structure?.sections || []).filter((id) => byId.has(id));
  const rankOrder = snapshot?.homepageSectionOrder || catalog.map((s) => s.id);
  const rank = new Map(rankOrder.map((id, i) => [id, i]));
  let list = [...enabled];
  const disabled = catalog.map((s) => s.id).filter((id) => !enabled.includes(id));
  for (const id of disabled) {
    const target = rank.has(id) ? rank.get(id) : Number.POSITIVE_INFINITY;
    let insertAt = list.length;
    for (let i = 0; i < list.length; i += 1) {
      const r = rank.has(list[i]) ? rank.get(list[i]) : Number.POSITIVE_INFINITY;
      if (r > target) {
        insertAt = i;
        break;
      }
    }
    list.splice(insertAt, 0, id);
  }
  for (const s of catalog) {
    if (!list.includes(s.id)) list.push(s.id);
  }
  return pinDisplayEnds(list.filter((id) => byId.has(id)));
}

function ensureDisplayOrder() {
  const catalog = snapshot?.catalogSections || [];
  const byId = new Set(catalog.map((s) => s.id));
  if (!sectionDisplayOrder?.length) {
    sectionDisplayOrder = buildInitialDisplayOrder();
    return sectionDisplayOrder;
  }
  sectionDisplayOrder = sectionDisplayOrder.filter((id) => byId.has(id));
  const rankOrder = snapshot?.homepageSectionOrder || catalog.map((s) => s.id);
  const rank = new Map(rankOrder.map((id, i) => [id, i]));
  for (const s of catalog) {
    if (sectionDisplayOrder.includes(s.id)) continue;
    const target = rank.has(s.id) ? rank.get(s.id) : Number.POSITIVE_INFINITY;
    let insertAt = sectionDisplayOrder.length;
    for (let i = 0; i < sectionDisplayOrder.length; i += 1) {
      const r = rank.has(sectionDisplayOrder[i])
        ? rank.get(sectionDisplayOrder[i])
        : Number.POSITIVE_INFINITY;
      if (r > target) {
        insertAt = i;
        break;
      }
    }
    sectionDisplayOrder.splice(insertAt, 0, s.id);
  }
  sectionDisplayOrder = pinDisplayEnds(sectionDisplayOrder);
  return sectionDisplayOrder;
}

function enabledFromDisplayOrder() {
  const on = new Set(snapshot?.structure?.sections || []);
  return ensureDisplayOrder().filter((id) => on.has(id));
}

function resetDisplayOrderToRegistry() {
  const catalog = snapshot?.catalogSections || [];
  const byId = new Set(catalog.map((s) => s.id));
  const order = (snapshot?.homepageSectionOrder || catalog.map((s) => s.id)).filter((id) =>
    byId.has(id),
  );
  for (const s of catalog) {
    if (!order.includes(s.id)) order.push(s.id);
  }
  sectionDisplayOrder = pinDisplayEnds(order);
  return sectionDisplayOrder;
}

function renderSections() {
  const wrap = el('ve-sections');
  if (!wrap) return;
  const on = new Set(snapshot?.structure?.sections || []);
  const catalog = snapshot?.catalogSections || [];
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const orderedIds = ensureDisplayOrder().filter((id) => byId.has(id));
  const enabled = enabledFromDisplayOrder();
  const movable = enabled.filter((id) => id !== 'hero' && id !== 'cta');

  let enabledPos = 0;
  wrap.innerHTML = orderedIds
    .map((id) => {
      const s = byId.get(id);
      if (!s) return '';
      const enabledRow = on.has(s.id);
      const posLabel = enabledRow ? String(++enabledPos) : '';
      const checked = enabledRow ? 'checked' : '';
      const pinned = s.id === 'hero' || s.id === 'cta';
      const required = Boolean(s.required);
      const midIdx = movable.indexOf(s.id);
      const canUp = enabledRow && !pinned && midIdx > 0;
      const canDown = enabledRow && !pinned && midIdx >= 0 && midIdx < movable.length - 1;
      const reqAttr = required ? ' disabled' : '';
      const reqTip = required ? ' data-tip="Required section — always on"' : '';
      const rowClass = enabledRow ? 've-section-row is-on' : 've-section-row';
      return `<div class="${rowClass}" data-section-row="${deps.esc(s.id)}">
        <span class="ve-section-pos" aria-hidden="true">${posLabel}</span>
        <label class="ve-check"${reqTip}>
          <input type="checkbox" data-section-id="${deps.esc(s.id)}" ${checked}${reqAttr}/>
          <span>${deps.esc(s.label)}</span>
        </label>
        <span class="ve-section-move">
          <button type="button" class="ve-section-arrow" data-section-move="up" data-section-id="${deps.esc(s.id)}" ${canUp ? '' : 'disabled'} aria-label="Move ${deps.esc(s.label)} up">▲</button>
          <button type="button" class="ve-section-arrow" data-section-move="down" data-section-id="${deps.esc(s.id)}" ${canDown ? '' : 'disabled'} aria-label="Move ${deps.esc(s.label)} down">▼</button>
        </span>
      </div>`;
    })
    .join('');

  wrap.querySelectorAll('input[type="checkbox"][data-section-id]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (input.disabled) return;
      const sectionId = input.dataset.sectionId;
      const showing = input.checked;
      const def = (snapshot?.catalogSections || []).find((s) => s.id === sectionId);
      if (def?.required) {
        input.checked = true;
        return;
      }
      const patches = [
        {
          type: 'structure',
          action: showing ? 'show' : 'hide',
          sectionId,
        },
      ];
      if (showing) {
        const onNext = new Set([...(snapshot?.structure?.sections || []), sectionId]);
        const desired = ensureDisplayOrder().filter((id) => onNext.has(id));
        patches.push({ type: 'structure', action: 'reorder', sections: desired });
      }
      const ok = await applyPatches(patches, { quiet: true });
      if (!ok) {
        input.checked = !showing;
        return;
      }
      const sections = enabledFromDisplayOrder();
      await liveSetSectionVisible(sectionId, showing);
      let result = await liveReorderSections(sections);
      if (result.found < 2) {
        setStatus('Preview missing section markers — refreshing…');
        await refreshPreviewForLiveSections();
        result = await liveReorderSections(sections);
        await syncSectionVisibilityFromStructure();
      }
      if (result.moved >= 1 || result.found >= 1) {
        setStatus('Live preview updated', 'ok');
      } else {
        setStatus('Saved — Save draft if preview did not update', 'err');
      }
    });
  });

  wrap.querySelectorAll('[data-section-move]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const id = btn.dataset.sectionId;
      const dir = btn.dataset.sectionMove === 'up' ? -1 : 1;
      if (!id || id === 'hero' || id === 'cta' || !on.has(id)) return;
      const display = [...ensureDisplayOrder()];
      const i = display.indexOf(id);
      if (i < 0) return;
      let j = i + dir;
      while (j >= 0 && j < display.length) {
        const other = display[j];
        if (on.has(other) && other !== 'hero' && other !== 'cta') break;
        j += dir;
      }
      if (j < 0 || j >= display.length) return;
      const swapId = display[j];
      display[i] = swapId;
      display[j] = id;
      sectionDisplayOrder = pinDisplayEnds(display);
      await applyLiveSectionOrder(enabledFromDisplayOrder());
    });
  });
}

async function onDefaultSectionOrder() {
  if (!candidateId || busy) return;
  const enabled = snapshot?.structure?.sections || [];
  if (!enabled.length) return;
  resetDisplayOrderToRegistry();
  const next = enabledFromDisplayOrder();
  const same =
    next.length === enabled.length && next.every((id, i) => id === enabled[i]);
  if (same) {
    await syncSectionVisibilityFromStructure();
    renderSections();
    setStatus('Already default order', 'ok');
    return;
  }
  await applyLiveSectionOrder(next);
}

function renderNap() {
  const c = snapshot?.config || {};
  const set = (id, v) => {
    const n = el(id);
    if (n) n.value = v || '';
  };
  set('ve-nap-name', c.businessName);
  set('ve-nap-phone', c.phone);
  set('ve-nap-email', c.email);
  set('ve-nap-cta', c.primaryCta);
  set('ve-nap-tagline', c.tagline);
}

function fieldHtml(binding, currentText) {
  const kind = binding?.kind || 'text';
  if (binding?.type === 'image' || kind === 'image') {
    return `
      <label>Alt text <input id="ve-field-alt" type="text" value="${deps.esc(selected?.currentAlt || '')}" /></label>
      <label class="ve-file">Replace photo
        <span class="ve-file-row">
          <button type="button" class="btn ve-file-btn" id="ve-file-pick">Choose photo</button>
          <input id="ve-field-file" type="file" accept="image/*" />
          <span class="ve-file-name muted" id="ve-file-name">No file chosen</span>
        </span>
      </label>
      <div class="ve-row">
        <button type="button" class="btn primary" id="ve-apply">Apply upload</button>
        ${
          binding.slotKey
            ? `<button type="button" class="btn" id="ve-repull">Re-pull</button>`
            : ''
        }
      </div>
      <p class="muted small">Upload writes the candidate image, then Save draft to see it on the page.</p>`;
  }
  if (binding?.type === 'bodyStep') {
    const isTitle = binding.field === 'title';
    return `
      <label>Step title <input id="ve-field-title" type="text" value="${deps.esc(isTitle ? currentText : '')}" /></label>
      <label>Step description <textarea id="ve-field-desc" rows="4">${deps.esc(isTitle ? '' : currentText)}</textarea></label>
      <button type="button" class="btn primary" id="ve-apply">Apply</button>`;
  }
  if (binding?.type === 'list') {
    return `
      <label>${deps.esc(binding.field || 'Text')}
        ${kind === 'body' ? `<textarea id="ve-field-text" rows="5">${deps.esc(currentText)}</textarea>` : `<input id="ve-field-text" type="text" value="${deps.esc(currentText)}" />`}
      </label>
      <div class="ve-row">
        <button type="button" class="btn primary" id="ve-apply">Apply</button>
        <button type="button" class="btn" id="ve-list-add">Add</button>
        <button type="button" class="btn" id="ve-list-up">Up</button>
        <button type="button" class="btn" id="ve-list-down">Down</button>
        <button type="button" class="btn danger" id="ve-list-remove">Remove</button>
      </div>`;
  }
  return `
    <label>${deps.esc(binding?.key || binding?.field || 'Text')}
      ${kind === 'body' ? `<textarea id="ve-field-text" rows="5">${deps.esc(currentText)}</textarea>` : `<input id="ve-field-text" type="text" value="${deps.esc(currentText)}" />`}
    </label>
    <button type="button" class="btn primary" id="ve-apply">Apply</button>`;
}

function renderInspector() {
  const box = el('ve-selected');
  const panel = el('ve-selected-section');
  if (!box) return;
  if (!selected?.binding) {
    panel?.classList.remove('is-active');
    box.innerHTML = '';
    return;
  }
  panel?.classList.add('is-active');
  const b = selected.binding;
  box.innerHTML = `
    <p class="ve-sel-label">${deps.esc(b.type)} · ${deps.esc(b.key || b.field || b.listKey || b.kind || '')}</p>
    ${fieldHtml(b, selected.currentText || '')}
  `;
  el('ve-apply')?.addEventListener('click', onApplySelected);
  el('ve-repull')?.addEventListener('click', onRepull);
  const fileInput = el('ve-field-file');
  const fileName = el('ve-file-name');
  el('ve-file-pick')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    if (fileName) {
      fileName.textContent = fileInput.files?.[0]?.name || 'No file chosen';
    }
  });
  el('ve-list-add')?.addEventListener('click', () =>
    applyPatches([{ type: 'list', file: b.file, listKey: b.listKey, action: 'add' }]),
  );
  el('ve-list-remove')?.addEventListener('click', () =>
    applyPatches([{ type: 'list', file: b.file, listKey: b.listKey, index: b.index, action: 'remove' }]),
  );
  el('ve-list-up')?.addEventListener('click', () =>
    applyPatches([{ type: 'list', file: b.file, listKey: b.listKey, index: b.index, action: 'move', dir: -1 }]),
  );
  el('ve-list-down')?.addEventListener('click', () =>
    applyPatches([{ type: 'list', file: b.file, listKey: b.listKey, index: b.index, action: 'move', dir: 1 }]),
  );
}

async function applyPatches(patches, { liveOk = false, quiet = false } = {}) {
  if (!candidateId || busy) return false;
  if (!quiet) setStatus('Saving…');
  try {
    const result = await deps.api(`/api/candidates/${encodeURIComponent(candidateId)}/visual-edit`, {
      method: 'POST',
      body: JSON.stringify({ patches }),
    });
    snapshot = result.snapshot || snapshot;
    dirty = true;
    renderNap();
    renderPalette();
    renderSections();
    el('ve-dirty')?.classList.remove('hidden');
    if (!quiet) {
      setStatus(
        liveOk
          ? 'Live preview updated — Save draft to keep permanently'
          : 'Applied — Save draft to refresh the page',
        'ok',
      );
    }
    return true;
  } catch (error) {
    setStatus(error.message || 'Save failed', 'err');
    await deps.showModal({
      title: 'Apply failed',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>${deps.esc(error.message)}</p>`,
    });
    return false;
  }
}

async function onApplySelected() {
  const b = selected?.binding;
  if (!b) return;
  if (b.type === 'image' || b.kind === 'image') {
    const file = el('ve-field-file')?.files?.[0];
    const alt = el('ve-field-alt')?.value || selected.currentAlt || 'Photo';
    if (!file) {
      if (alt && alt !== selected.currentAlt) {
        await applyPatches([
          {
            type: 'image',
            file: b.file,
            key: b.key,
            listKey: b.listKey,
            index: b.index,
            nested: Boolean(b.nested),
            src: selected.currentSrc || '',
            alt,
          },
        ]);
      }
      return;
    }
    const dataUrl = await readFileDataUrl(file);
    setStatus('Uploading photo…');
    const result = await deps.api(`/api/candidates/${encodeURIComponent(candidateId)}/visual-edit/image`, {
      method: 'POST',
      body: JSON.stringify({
        dataUrl,
        alt,
        file: b.file,
        key: b.key,
        listKey: b.listKey,
        index: b.index,
        nested: Boolean(b.nested),
      }),
    });
    snapshot = result.snapshot || snapshot;
    dirty = true;
    el('ve-dirty')?.classList.remove('hidden');
    setStatus('Photo uploaded — Save draft to refresh', 'ok');
    return;
  }
  if (b.type === 'bodyStep') {
    const title = el('ve-field-title')?.value || '';
    const description = el('ve-field-desc')?.value || '';
    await applyPatches([
      { type: 'bodyStep', file: b.file, index: b.index, title, description },
    ]);
    return;
  }
  const value = el('ve-field-text')?.value ?? '';
  postToFrame({ action: 'setText', text: value });
  if (b.type === 'config') {
    await applyPatches([{ type: 'config', key: b.key, value }]);
    return;
  }
  if (b.type === 'fm') {
    await applyPatches([{ type: 'fm', file: b.file, key: b.key, value }]);
    return;
  }
  if (b.type === 'list') {
    await applyPatches([
      {
        type: 'list',
        file: b.file,
        listKey: b.listKey,
        index: b.index,
        field: b.field,
        action: 'set',
        value,
      },
    ]);
  }
}

async function onRepull() {
  const slotKey = selected?.binding?.slotKey;
  if (!slotKey) return;
  setStatus('Re-pulling photo…');
  try {
    await deps.api(
      `/api/candidates/${encodeURIComponent(candidateId)}/images/slots/${encodeURIComponent(slotKey)}/repull`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    dirty = true;
    el('ve-dirty')?.classList.remove('hidden');
    setStatus('Re-pulled — Save draft to refresh', 'ok');
  } catch (error) {
    setStatus(error.message || 'Re-pull failed', 'err');
  }
}

function readFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(file);
  });
}

async function rebuildPreview({
  message = 'Staging + assembling preview… this can take a minute',
  successStatus = 'Preview rebuilt',
  useBusy = true,
  failTitle = 'Save draft failed',
} = {}) {
  if (!candidateId) return false;
  if (useBusy) {
    if (busy) return false;
    busy = true;
  } else {
    if (previewRefreshing) return false;
    previewRefreshing = true;
  }
  showStageLoading(message);
  try {
    const result = await deps.api(`/api/candidates/${encodeURIComponent(candidateId)}/visual-edit/preview`, {
      method: 'POST',
      body: JSON.stringify({ rebuild: true }),
    });
    snapshot = result.snapshot || snapshot;
    dirty = false;
    el('ve-dirty')?.classList.add('hidden');
    const href = el('ve-page')?.value || '/';
    showStageLoading('Loading rebuilt preview…');
    await attachPreview(href);
    setStatus(successStatus, 'ok');
    return true;
  } catch (error) {
    setStatus(error.message || 'Preview failed', 'err');
    await deps.showModal({
      title: failTitle,
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>${deps.esc(error.message)}</p>`,
    });
    return false;
  } finally {
    if (useBusy) busy = false;
    else previewRefreshing = false;
    hideStageLoading();
  }
}

function scheduleStructurePreviewRefresh() {
  setStatus('Updating preview…');
  clearTimeout(structurePreviewTimer);
  structurePreviewTimer = setTimeout(() => {
    structurePreviewTimer = null;
    void runStructurePreviewRefresh();
  }, STRUCTURE_PREVIEW_MS);
}

async function runStructurePreviewRefresh() {
  if (busy || previewRefreshing) {
    structurePreviewQueued = true;
    return;
  }
  await rebuildPreview({
    message: 'Updating preview…',
    successStatus: 'Live preview updated',
    useBusy: false,
    failTitle: 'Preview update failed',
  });
  if (structurePreviewQueued) {
    structurePreviewQueued = false;
    scheduleStructurePreviewRefresh();
  }
}

async function onSaveDraft() {
  if (!candidateId || busy) return;
  clearTimeout(structurePreviewTimer);
  structurePreviewTimer = null;
  structurePreviewQueued = false;
  if (previewRefreshing) {
    setStatus('Updating preview…');
    while (previewRefreshing) {
      await new Promise((r) => setTimeout(r, 100));
    }
    setStatus('Preview rebuilt', 'ok');
    return;
  }
  await rebuildPreview();
}

function lintList(lint, key) {
  const findings = lint?.[key] || lint?.findings || [];
  if (!Array.isArray(findings) || !findings.length) return '';
  return `<ul>${findings
    .slice(0, 8)
    .map((f) => `<li>${deps.esc(f.excerpt || f.rule || f.suggestion || '')}</li>`)
    .join('')}</ul>`;
}

async function onPublish() {
  if (!candidateId || busy) return;
  const go = await deps.showModal({
    title: 'Publish this site?',
    confirmLabel: 'Publish',
    bodyHtml:
      '<p>Runs speech + SEO lint, then Assemble and ship (if GitHub + Cloudflare are configured). Live Worker HTML is not edited in place — source is the candidate.</p>',
  });
  if (!go) return;
  busy = true;
  showStageLoading('Publishing… lint, assemble, ship');
  try {
    const result = await deps.api(`/api/candidates/${encodeURIComponent(candidateId)}/visual-edit/publish`, {
      method: 'POST',
      body: JSON.stringify({ ship: true }),
    });
    snapshot = result.snapshot || snapshot;
    dirty = false;
    el('ve-dirty')?.classList.add('hidden');
    const href = el('ve-page')?.value || '/';
    showStageLoading('Loading published preview…');
    await attachPreview(href);
    const shipNote = result.ship?.skipped
      ? result.ship.reason
      : result.ship?.ok === false
        ? result.ship.error
        : result.ship?.ok
          ? 'Shipped'
          : '';
    setStatus(`Published${shipNote ? ` · ${shipNote}` : ''}`, 'ok');
    await deps.showModal({
      title: 'Published',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>Assemble finished.${shipNote ? ` ${deps.esc(shipNote)}.` : ''}</p>
        ${result.speechLint && !result.speechLint.ok ? `<p>Speech notes:</p>${lintList(result.speechLint)}` : ''}
        ${result.seoLint && result.seoLint.findings?.length ? `<p>SEO notes:</p>${lintList(result.seoLint)}` : ''}`,
    });
  } catch (error) {
    const seo = error.seoLint;
    const critical = (seo?.findings || []).filter((f) => f.severity === 'critical');
    if (critical.length) {
      const override = await deps.showModal({
        title: 'SEO lint blocked publish',
        confirmLabel: 'Publish anyway',
        bodyHtml: `<p>${deps.esc(error.message)}</p>${lintList(seo)}`,
      });
      if (override) {
        busy = false;
        hideStageLoading();
        await publishAnyway();
        return;
      }
    } else {
      await deps.showModal({
        title: 'Publish failed',
        confirmLabel: 'OK',
        hideCancel: true,
        bodyHtml: `<p>${deps.esc(error.message)}</p>${lintList(error.speechLint)}${lintList(error.seoLint)}`,
      });
    }
    setStatus(error.message || 'Publish failed', 'err');
  } finally {
    busy = false;
    hideStageLoading();
  }
}

async function publishAnyway() {
  busy = true;
  showStageLoading('Publishing with SEO override…');
  try {
    const result = await deps.api(`/api/candidates/${encodeURIComponent(candidateId)}/visual-edit/publish`, {
      method: 'POST',
      body: JSON.stringify({ ship: true, ignoreSeoWarnings: true }),
    });
    snapshot = result.snapshot || snapshot;
    dirty = false;
    el('ve-dirty')?.classList.add('hidden');
    const href = el('ve-page')?.value || '/';
    showStageLoading('Loading published preview…');
    await attachPreview(href);
    setStatus('Published (SEO override)', 'ok');
  } catch (error) {
    setStatus(error.message || 'Publish failed', 'err');
  } finally {
    busy = false;
    hideStageLoading();
  }
}

async function onUndo() {
  const go = await deps.showModal({
    title: 'Undo visual edits?',
    confirmLabel: 'Undo',
    bodyHtml: '<p>Restores content, NAP, and Structure to the snapshot from when you opened the editor.</p>',
  });
  if (!go) return;
  try {
    const result = await deps.api(`/api/candidates/${encodeURIComponent(candidateId)}/visual-edit/undo`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    snapshot = result.snapshot || snapshot;
    dirty = true;
    el('ve-dirty')?.classList.remove('hidden');
    renderNap();
    renderPalette();
    renderSections();
    setStatus('Restored snapshot — Save draft to refresh the page', 'ok');
  } catch (error) {
    setStatus(error.message || 'Undo failed', 'err');
  }
}

function onMessage(ev) {
  if (ev.origin !== PREVIEW_ORIGIN) return;
  const msg = ev.data;
  if (!msg || msg.type !== MSG) return;
  if (msg.action === 'hello' || msg.action === 'ready') {
    if (helloWait) helloWait();
    activateFrame();
    void syncSectionVisibilityFromStructure();
    return;
  }
  if (msg.action === 'sectionVisibleResult') {
    if (sectionVisibleWait) sectionVisibleWait(msg);
    return;
  }
  if (msg.action === 'reorderResult') {
    if (reorderWait) reorderWait(msg);
    return;
  }
  if (msg.action === 'select') {
    selected = msg;
    renderInspector();
  }
}

function setDevice(next) {
  device = next;
  el('ve-chrome')?.setAttribute('data-device', next);
  el('ve-device-desktop')?.classList.toggle('primary', next === 'desktop');
  el('ve-device-mobile')?.classList.toggle('primary', next === 'mobile');
}

function closeEditor() {
  const root = el('visual-editor');
  root?.classList.add('hidden');
  if (root) root.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('ve-open');
  hideStageLoading();
  const iframe = frame();
  if (iframe) iframe.src = 'about:blank';
  window.removeEventListener('message', onMessage);
  candidateId = null;
  snapshot = null;
  selected = null;
  dirty = false;
  busy = false;
  sectionDisplayOrder = null;
}

async function applyNap() {
  const patches = [
    { type: 'config', key: 'businessName', value: el('ve-nap-name')?.value || '' },
    { type: 'config', key: 'phone', value: el('ve-nap-phone')?.value || '' },
    { type: 'config', key: 'email', value: el('ve-nap-email')?.value || '' },
    { type: 'config', key: 'primaryCta', value: el('ve-nap-cta')?.value || '' },
    { type: 'config', key: 'tagline', value: el('ve-nap-tagline')?.value || '' },
  ];
  await applyPatches(patches);
}

function wireOnce() {
  if (el('visual-editor')?.dataset.wired) return;
  const root = el('visual-editor');
  if (!root) return;
  root.dataset.wired = '1';
  el('ve-close')?.addEventListener('click', closeEditor);
  el('ve-save-draft')?.addEventListener('click', onSaveDraft);
  el('ve-publish')?.addEventListener('click', onPublish);
  el('ve-undo')?.addEventListener('click', onUndo);
  el('ve-nap-apply')?.addEventListener('click', applyNap);
  el('ve-sections-default-order')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onDefaultSectionOrder();
  });
  el('ve-device-desktop')?.addEventListener('click', () => setDevice('desktop'));
  el('ve-device-mobile')?.addEventListener('click', () => setDevice('mobile'));
  el('ve-page')?.addEventListener('change', (e) => {
    const iframe = frame();
    if (iframe) iframe.src = bust(e.target.value || '/');
  });
  frame()?.addEventListener('load', () => {
    setTimeout(activateFrame, 200);
  });
}

export async function openVisualEditor(id, { api, esc, showModal }) {
  deps = { api, esc, showModal };
  candidateId = id;
  selected = null;
  dirty = false;
  busy = false;
  sectionDisplayOrder = null;
  wireOnce();
  const root = el('visual-editor');
  if (!root) {
    await showModal({
      title: 'Visual editor missing',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: '<p>Reload Rover — the editor shell is not in the page.</p>',
    });
    return;
  }
  root.classList.remove('hidden');
  root.setAttribute('aria-hidden', 'false');
  document.body.classList.add('ve-open');
  el('ve-dirty')?.classList.add('hidden');
  showStageLoading('Loading session…');
  window.addEventListener('message', onMessage);
  try {
    snapshot = await api(`/api/candidates/${encodeURIComponent(id)}/visual-edit`);
    renderPageSelect();
    renderNap();
    renderPalette();
    renderSections();
    renderInspector();

    const href = '/';
    let attached = false;

    showStageLoading('Preparing preview…');
    await api(`/api/candidates/${encodeURIComponent(id)}/visual-edit/preview`, {
      method: 'POST',
      body: JSON.stringify({ smart: true }),
    });
    attached = await attachPreview(href);

    if (!attached) {
      showStageLoading('Retrying preview attach…');
      attached = await attachPreview(href);
    }

    hideStageLoading();
    setStatus(
      attached ? '' : 'Preview may still be starting — try Save draft if outlines do not appear.',
      attached ? '' : 'err',
    );
  } catch (error) {
    hideStageLoading();
    setStatus(error.message || 'Could not open editor', 'err');
    await showModal({
      title: 'Visual editor failed',
      confirmLabel: 'OK',
      hideCancel: true,
      bodyHtml: `<p>${esc(error.message)}</p>`,
    });
  }
}
