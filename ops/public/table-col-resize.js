/**
 * Fit table columns to content (smallest width that shows full cell values).
 * Drag-to-resize with session-only memory (survives re-renders; no localStorage).
 * Optional freezeCols syncs sticky `left` to widths so frozen columns do not drift.
 */

const MIN_COL_PX = 40;
const HANDLE_CLASS = 'col-resize-handle';
const DEFAULT_NARROW_CH = 14;
const NARROW_DEFAULT_CLASS_RE = /\bcol-(?:batch|notes)\b/;

/** @type {Map<string, { colCount: number, widths: Record<string, number>, manual: Set<number> }>} */
const sessionByTable = new Map();
let anonTableSeq = 0;

function isNarrowDefaultCol(th) {
  return Boolean(th && NARROW_DEFAULT_CLASS_RE.test(th.className || ''));
}

/** Pixel width of N `ch` units using the table’s font. */
function measureChPx(table, ch = DEFAULT_NARROW_CH) {
  const probe = document.createElement('span');
  const cs = getComputedStyle(table);
  probe.style.cssText =
    'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;white-space:nowrap;padding:0;border:0;margin:0;';
  probe.style.font = cs.font;
  probe.style.width = `${ch}ch`;
  table.appendChild(probe);
  const px = Math.ceil(probe.getBoundingClientRect().width);
  probe.remove();
  return Math.max(MIN_COL_PX, px || MIN_COL_PX);
}

function tableSessionKey(table) {
  if (table.id) return table.id;
  if (table.dataset.tableKey) return table.dataset.tableKey;
  if (!table.dataset.colResizeSession) {
    anonTableSeq += 1;
    table.dataset.colResizeSession = `anon-${anonTableSeq}`;
  }
  return table.dataset.colResizeSession;
}

function getSession(key) {
  return sessionByTable.get(key) || null;
}

function setSession(key, colCount, widths, manual) {
  sessionByTable.set(key, {
    colCount,
    widths: { ...widths },
    manual: new Set(manual),
  });
}

function headerCells(table) {
  const row = table.querySelector('thead tr');
  if (!row) return [];
  return [...row.children].filter((el) => el.tagName === 'TH');
}

function bodyRows(table) {
  if (!table.tBodies?.length) return [];
  return [...table.tBodies].flatMap((tb) => [...tb.rows]);
}

function ensureColgroup(table, colCount) {
  let group = table.querySelector('colgroup[data-col-resize]');
  if (!group) {
    group = document.createElement('colgroup');
    group.setAttribute('data-col-resize', '1');
    table.insertBefore(group, table.firstChild);
  }
  while (group.children.length < colCount) {
    group.appendChild(document.createElement('col'));
  }
  while (group.children.length > colCount) {
    group.lastChild.remove();
  }
  return group;
}

function freezeColCount(table) {
  const n = Number(table?.dataset?.freezeCols);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function columnWidthPx(th, widths, index) {
  const stored = widths?.[String(index)];
  if (stored != null && Number.isFinite(Number(stored))) {
    return Math.max(MIN_COL_PX, Number(stored));
  }
  const measured = th.getBoundingClientRect().width;
  return measured > 0 ? measured : MIN_COL_PX;
}

/**
 * Set sticky left offsets from column widths.
 * @param {HTMLTableElement} table
 * @param {Record<string, number>} [widths]
 */
function syncFreezeOffsets(table, widths = {}) {
  const n = freezeColCount(table);
  const ths = headerCells(table);
  if (!ths.length) return;
  const rows = bodyRows(table);
  const count = Math.min(n, ths.length);

  let left = 0;
  for (let i = 0; i < ths.length; i++) {
    const th = ths[i];
    if (i < count) {
      const leftPx = `${Math.round(left)}px`;
      th.style.left = leftPx;
      for (const tr of rows) {
        const td = tr.children[i];
        if (!td || td.tagName !== 'TD') continue;
        td.style.left = leftPx;
      }
      left += columnWidthPx(th, widths, i);
    } else if (th.style.left) {
      th.style.left = '';
      for (const tr of rows) {
        const td = tr.children[i];
        if (td?.tagName === 'TD') td.style.left = '';
      }
    }
  }
}

function clearInlineColWidths(table) {
  const ths = headerCells(table);
  const group = table.querySelector('colgroup[data-col-resize]');
  const rows = bodyRows(table);
  ths.forEach((th, i) => {
    const col = group?.children[i];
    if (col) {
      col.style.width = '';
      col.style.minWidth = '';
    }
    th.style.width = '';
    th.style.minWidth = '';
    th.style.maxWidth = '';
    for (const tr of rows) {
      const td = tr.children[i];
      if (!td || td.tagName !== 'TD') continue;
      td.style.width = '';
      td.style.minWidth = '';
      td.style.maxWidth = '';
    }
  });
}

function applyWidths(table, widths) {
  const ths = headerCells(table);
  if (!ths.length) return;
  const group = ensureColgroup(table, ths.length);
  const hasAny = Object.keys(widths).some((k) => widths[k] != null);
  table.classList.toggle('table-cols-resized', hasAny);
  const rows = bodyRows(table);
  ths.forEach((th, i) => {
    const col = group.children[i];
    const w = widths[String(i)];
    if (w != null && Number.isFinite(Number(w))) {
      const px = `${Math.max(MIN_COL_PX, Number(w))}px`;
      col.style.width = px;
      col.style.minWidth = px;
      th.style.width = px;
      th.style.minWidth = px;
      th.style.maxWidth = px;
      for (const tr of rows) {
        const td = tr.children[i];
        if (!td || td.tagName !== 'TD') continue;
        td.style.width = px;
        td.style.minWidth = px;
        td.style.maxWidth = px;
      }
    } else {
      col.style.width = '';
      col.style.minWidth = '';
      th.style.width = '';
      th.style.minWidth = '';
      th.style.maxWidth = '';
      for (const tr of rows) {
        const td = tr.children[i];
        if (!td || td.tagName !== 'TD') continue;
        td.style.width = '';
        td.style.minWidth = '';
        td.style.maxWidth = '';
      }
    }
  });
  syncFreezeOffsets(table, widths);
}

function stripResizeHandles(table) {
  table.querySelectorAll(`.${HANDLE_CLASS}`).forEach((el) => el.remove());
}

/**
 * Measure each column to the smallest width that still shows full cell content.
 * @param {HTMLTableElement} table
 * @returns {Record<string, number>}
 */
function measureContentWidths(table) {
  const ths = headerCells(table);
  if (!ths.length) return {};
  const rows = bodyRows(table);

  clearInlineColWidths(table);
  table.classList.remove('table-cols-resized');
  table.classList.add('table-cols-measuring');

  const widths = {};
  for (let i = 0; i < ths.length; i++) {
    let max = MIN_COL_PX;
    const cells = [ths[i]];
    for (const tr of rows) {
      const td = tr.children[i];
      if (td?.tagName === 'TD') cells.push(td);
    }
    for (const cell of cells) {
      const w = Math.ceil(Math.max(cell.scrollWidth, cell.getBoundingClientRect().width));
      if (w > max) max = w;
    }
    widths[String(i)] = max;
  }

  table.classList.remove('table-cols-measuring');
  return widths;
}

/**
 * Measure a single column while other columns keep their applied widths.
 * @param {HTMLTableElement} table
 * @param {number} index
 * @param {Record<string, number>} otherWidths
 * @returns {number}
 */
function measureOneColumn(table, index, otherWidths) {
  const ths = headerCells(table);
  if (!ths[index]) return MIN_COL_PX;

  const next = { ...otherWidths };
  delete next[String(index)];
  applyWidths(table, next);
  table.classList.add('table-cols-measuring');

  const rows = bodyRows(table);
  let max = MIN_COL_PX;
  const cells = [ths[index]];
  for (const tr of rows) {
    const td = tr.children[index];
    if (td?.tagName === 'TD') cells.push(td);
  }
  for (const cell of cells) {
    cell.style.width = '';
    cell.style.minWidth = '';
    cell.style.maxWidth = '';
    const w = Math.ceil(Math.max(cell.scrollWidth, cell.getBoundingClientRect().width));
    if (w > max) max = w;
  }

  table.classList.remove('table-cols-measuring');
  return max;
}

function attachHandles(table, sessionKey, state) {
  const ths = headerCells(table);
  ths.forEach((th, index) => {
    th.querySelectorAll(`.${HANDLE_CLASS}`).forEach((el) => el.remove());

    const handle = document.createElement('span');
    handle.className = HANDLE_CLASS;
    handle.setAttribute('aria-hidden', 'true');
    handle.title = 'Drag to resize · double-click to fit content';

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = th.getBoundingClientRect().width;
      table.classList.add('table-cols-resizing');

      const onMove = (ev) => {
        const next = Math.max(MIN_COL_PX, Math.round(startWidth + (ev.clientX - startX)));
        state.widths[String(index)] = next;
        state.manual.add(index);
        applyWidths(table, state.widths);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        table.classList.remove('table-cols-resizing');
        setSession(sessionKey, ths.length, state.widths, state.manual);
        requestAnimationFrame(() => syncFreezeOffsets(table, state.widths));
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    handle.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.manual.delete(index);
      const fitted = isNarrowDefaultCol(th)
        ? measureChPx(table, DEFAULT_NARROW_CH)
        : measureOneColumn(table, index, state.widths);
      state.widths[String(index)] = fitted;
      setSession(sessionKey, ths.length, state.widths, state.manual);
      applyWidths(table, state.widths);
      requestAnimationFrame(() => syncFreezeOffsets(table, state.widths));
    });

    handle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    th.appendChild(handle);
  });
}

/**
 * Fit columns to content; re-apply session manual widths; attach drag handles.
 * @param {HTMLTableElement | null} table
 * @param {{ freezeCols?: number }} [options]
 */
export function enableTableColumnResize(table, { freezeCols = 0 } = {}) {
  if (!table || table.tagName !== 'TABLE') return;
  const freeze = Number(freezeCols) > 0 ? Math.floor(Number(freezeCols)) : 0;
  if (freeze > 0) table.dataset.freezeCols = String(freeze);
  else delete table.dataset.freezeCols;

  const sessionKey = tableSessionKey(table);
  const ths = headerCells(table);
  const colCount = ths.length;
  if (!colCount) return;

  stripResizeHandles(table);

  let session = getSession(sessionKey);
  if (session && session.colCount !== colCount) {
    sessionByTable.delete(sessionKey);
    session = null;
  }

  const measured = measureContentWidths(table);
  const widths = { ...measured };
  const manual = session ? new Set(session.manual) : new Set();

  if (session) {
    for (const idx of manual) {
      const key = String(idx);
      const prev = session.widths[key];
      if (prev != null && Number.isFinite(Number(prev))) {
        widths[key] = Math.max(MIN_COL_PX, Number(prev));
      } else {
        manual.delete(idx);
      }
    }
  }

  const narrowPx = measureChPx(table, DEFAULT_NARROW_CH);
  for (let i = 0; i < colCount; i++) {
    if (manual.has(i)) continue;
    if (isNarrowDefaultCol(ths[i])) widths[String(i)] = narrowPx;
  }

  setSession(sessionKey, colCount, widths, manual);
  const state = getSession(sessionKey);
  applyWidths(table, state.widths);
  attachHandles(table, sessionKey, state);
  requestAnimationFrame(() => syncFreezeOffsets(table, state.widths));
}

/**
 * Fit all `.table-wrap > table` under root.
 * @param {ParentNode | null} root
 */
export function enableResizableTablesIn(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('.table-wrap > table').forEach((table) => {
    enableTableColumnResize(table);
  });
}
