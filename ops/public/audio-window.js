import {
  AUDIO_BUILTINS,
  AUDIO_EVENTS,
  addClip,
  assignmentIsDefault,
  audioEnabled,
  getAssignment,
  getVolume,
  isEventMuted,
  listClips,
  preview,
  removeClip,
  resetAssignment,
  setAssignment,
  setAudioEnabled,
  setEventMuted,
  setVolume,
  soundLabel,
  stopPreview,
  subscribeAudio,
} from './rover-audio.js?v=20261106audio2';

const GROUPS = ['Interface', 'Status', 'Pipeline'];
const ICONS = {
  play: '<polygon points="8 6 18 12 8 18 8 6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  swap: '<path d="M16 3l4 4-4 4"/><path d="M20 7H4"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h16"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  remove: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  speaker:
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  speakerOff:
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
};

const listEl = document.getElementById('audio-list');
const errorEl = document.getElementById('audio-error');
const volumeEl = document.getElementById('audio-volume');
const masterEl = document.getElementById('audio-master');
const popoutEl = document.getElementById('audio-popout');
const closeEl = document.getElementById('audio-close');
const fileEl = document.getElementById('audio-file');
const docked = new URLSearchParams(location.search).get('dock') === '1';

let clips = [];
let playing = null;
let playToken = 0;
let swapPop = null;
let swapAnchor = null;
let assignAfterUpload = '';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

function svg(name, filled) {
  const attrs = filled
    ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg width="16" height="16" viewBox="0 0 24 24" ${attrs} aria-hidden="true">${ICONS[name]}</svg>`;
}

function iconButton({ act, id, label, icon, extraClass = '', pressed = '' }) {
  const pressedAttr = pressed === '' ? '' : ` aria-pressed="${pressed}"`;
  return `<button type="button" class="audio-icon-btn${extraClass ? ` ${extraClass}` : ''}" data-act="${esc(act)}" data-id="${esc(id)}" aria-label="${esc(label)}" data-tip="${esc(label)}"${pressedAttr}>${icon}</button>`;
}

function showError(message) {
  if (!errorEl) return;
  const text = String(message || '').trim();
  errorEl.hidden = !text;
  errorEl.textContent = text;
}

function applyTheme() {
  let theme = '1';
  try {
    const stored = localStorage.getItem('ops.theme');
    if (/^[1-8]$/.test(stored || '')) theme = stored;
  } catch {
    theme = '1';
  }
  document.documentElement.setAttribute('data-theme', theme);
}

function syncHeader() {
  const on = audioEnabled();
  masterEl.classList.toggle('is-off', !on);
  masterEl.setAttribute('aria-pressed', on ? 'true' : 'false');
  const label = on ? 'Turn sounds off' : 'Turn sounds on';
  masterEl.setAttribute('aria-label', label);
  masterEl.setAttribute('data-tip', label);
  if (document.activeElement !== volumeEl) volumeEl.value = String(getVolume());
}

function closeSwap() {
  if (swapAnchor) swapAnchor.setAttribute('aria-expanded', 'false');
  swapAnchor = null;
  swapPop?.remove();
  swapPop = null;
}

function renderList() {
  closeSwap();
  const parts = [];
  for (const group of GROUPS) {
    const events = AUDIO_EVENTS.filter((event) => event.group === group);
    if (!events.length) continue;
    parts.push(`<div class="audio-group">${esc(group)}</div>`);
    for (const event of events) {
      const soundId = getAssignment(event.id);
      const active = playing?.scope === 'event' && playing.id === event.id;
      const silenced = isEventMuted(event.id);
      const playLabel = active ? `Stop ${event.name}` : `Play ${event.name}`;
      const silenceLabel = silenced ? `Turn on ${event.name}` : `Silence ${event.name}`;
      const reset = assignmentIsDefault(event.id)
        ? ''
        : iconButton({
            act: 'reset',
            id: event.id,
            label: `Reset ${event.name}`,
            icon: svg('reset'),
          });
      parts.push(`<div class="audio-row">
        <span class="audio-row-name">${esc(event.name)}</span>
        <span class="audio-row-clip">${esc(soundLabel(soundId, clips))}</span>
        <span class="audio-row-actions">
          ${iconButton({
            act: 'play',
            id: event.id,
            label: playLabel,
            icon: svg(active ? 'stop' : 'play', true),
          })}
          ${iconButton({
            act: 'swap',
            id: event.id,
            label: `Swap ${event.name}`,
            icon: svg('swap'),
          })}
          ${reset}
          ${iconButton({
            act: 'silence',
            id: event.id,
            label: silenceLabel,
            icon: svg(silenced ? 'speakerOff' : 'speaker'),
            extraClass: silenced ? 'is-silenced' : '',
            pressed: silenced ? 'true' : 'false',
          })}
        </span>
      </div>`);
    }
  }
  const uploads = clips
    .map((clip) => {
      const active = playing?.scope === 'clip' && playing.id === clip.id;
      const playLabel = active ? `Stop ${clip.name}` : `Play ${clip.name}`;
      return `<div class="audio-row">
        <span class="audio-row-name">${esc(clip.name)}</span>
        <span class="audio-row-actions">
          ${iconButton({ act: 'play-clip', id: clip.id, label: playLabel, icon: svg(active ? 'stop' : 'play', true) })}
          ${iconButton({ act: 'remove', id: clip.id, label: `Remove ${clip.name}`, icon: svg('remove') })}
        </span>
      </div>`;
    })
    .join('');
  parts.push(`<div class="audio-group audio-library-head"><span>Library</span>
    <button type="button" class="audio-icon-btn" data-act="upload" aria-label="Upload sound" data-tip="Upload sound">${svg('upload')}</button>
  </div>`);
  parts.push(uploads || '<p class="audio-empty">No uploaded sounds</p>');
  listEl.innerHTML = parts.join('');
}

function haltPreview() {
  playToken += 1;
  playing = null;
  stopPreview();
  renderList();
}

function beginPreview(scope, id, soundId) {
  playToken += 1;
  const token = playToken;
  playing = { scope, id };
  renderList();
  preview(soundId, () => {
    if (token !== playToken) return;
    playing = null;
    renderList();
  });
}

function openSwap(anchor, eventId) {
  closeSwap();
  const current = getAssignment(eventId);
  const pop = document.createElement('div');
  pop.className = 'audio-swap-pop';
  pop.setAttribute('role', 'menu');
  const item = (soundId, name) =>
    `<button type="button" class="audio-swap-item${soundId === current ? ' is-current' : ''}" data-sound="${esc(soundId)}" role="menuitem">${esc(name)}</button>`;
  const builtins = AUDIO_BUILTINS.map((builtin) => item(`builtin:${builtin.id}`, builtin.name)).join('');
  const uploaded = clips.map((clip) => item(`clip:${clip.id}`, clip.name)).join('');
  pop.innerHTML = `<div class="audio-swap-label">Built-in</div>${builtins}${
    uploaded ? `<div class="audio-swap-label">Uploaded</div>${uploaded}` : ''
  }<button type="button" class="audio-swap-item audio-swap-upload" data-upload="1" role="menuitem">${svg('upload')}<span>Upload</span></button>`;
  document.body.appendChild(pop);
  const rect = anchor.getBoundingClientRect();
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  let left = Math.min(rect.left, window.innerWidth - width - 8);
  if (left < 8) left = 8;
  let top = rect.bottom + 4;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  swapPop = pop;
  swapAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  pop.addEventListener('click', (event) => {
    if (event.target.closest('[data-upload]')) {
      assignAfterUpload = eventId;
      closeSwap();
      fileEl.click();
      return;
    }
    const choice = event.target.closest('[data-sound]');
    if (!choice) return;
    setAssignment(eventId, choice.dataset.sound);
    closeSwap();
  });
}

function closeWindow() {
  if (docked && window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'rover-audio-dock-close' }, location.origin);
    return;
  }
  window.close();
}

function wireTooltips() {
  const tip = document.getElementById('ops-tooltip');
  if (!tip) return;
  let active = null;
  const hide = () => {
    active = null;
    tip.classList.add('hidden');
    tip.textContent = '';
  };
  const show = (el, x, y) => {
    const text = String(el.getAttribute('data-tip') || '').trim();
    if (!text) {
      hide();
      return;
    }
    active = el;
    tip.textContent = text;
    tip.classList.remove('hidden');
    const rect = tip.getBoundingClientRect();
    let left = Number.isFinite(x) ? x + 12 : el.getBoundingClientRect().left;
    let top = Number.isFinite(y) ? y + 16 : el.getBoundingClientRect().bottom + 6;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, (Number.isFinite(y) ? y : top) - rect.height - 12);
    tip.style.left = `${Math.max(8, Math.round(left))}px`;
    tip.style.top = `${Math.max(8, Math.round(top))}px`;
  };
  document.addEventListener('pointerover', (event) => {
    const el = event.target?.closest?.('[data-tip]');
    if (!el) return;
    show(el, event.clientX, event.clientY);
  });
  document.addEventListener('pointerout', (event) => {
    const el = event.target?.closest?.('[data-tip]');
    if (!el || el !== active) return;
    hide();
  });
  document.addEventListener('pointermove', (event) => {
    if (active) show(active, event.clientX, event.clientY);
  });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', () => {
    hide();
    closeSwap();
  });
}

async function reloadClips() {
  try {
    clips = await listClips();
  } catch {
    clips = [];
    showError('Could not read uploaded sounds.');
  }
}

listEl.addEventListener('click', (event) => {
  const btn = event.target.closest('button');
  if (!btn || !listEl.contains(btn)) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id || '';
  if (act === 'upload') {
    assignAfterUpload = '';
    fileEl.click();
    return;
  }
  if (act === 'play') {
    if (playing?.scope === 'event' && playing.id === id) haltPreview();
    else beginPreview('event', id, getAssignment(id));
    return;
  }
  if (act === 'play-clip') {
    if (playing?.scope === 'clip' && playing.id === id) haltPreview();
    else beginPreview('clip', id, `clip:${id}`);
    return;
  }
  if (act === 'swap') {
    if (swapAnchor === btn) closeSwap();
    else openSwap(btn, id);
    return;
  }
  if (act === 'reset') {
    resetAssignment(id);
    return;
  }
  if (act === 'silence') {
    setEventMuted(id, !isEventMuted(id));
    return;
  }
  if (act === 'remove') {
    if (playing?.scope === 'clip' && playing.id === id) {
      playToken += 1;
      playing = null;
      stopPreview();
    }
    removeClip(id).catch(() => showError('Could not remove that sound.'));
  }
});

fileEl.addEventListener('change', async () => {
  const file = fileEl.files?.[0];
  const eventId = assignAfterUpload;
  assignAfterUpload = '';
  fileEl.value = '';
  if (!file) return;
  try {
    const clip = await addClip(file);
    if (eventId) setAssignment(eventId, `clip:${clip.id}`);
    showError('');
  } catch (error) {
    showError(error?.message || 'Could not save that sound.');
  }
});

volumeEl.addEventListener('input', () => {
  setVolume(volumeEl.value);
});

masterEl.addEventListener('click', () => {
  setAudioEnabled(!audioEnabled());
});

popoutEl.hidden = !docked;
if (docked) document.body.classList.add('audio-docked');
popoutEl.addEventListener('click', () => {
  const opened = window.open('/audio.html', 'rover-audio', 'width=440,height=640,resizable=yes');
  if (!opened) {
    showError('The browser blocked the pop-out. Allow pop-ups for Rover.');
    return;
  }
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'rover-audio-dock-close' }, location.origin);
  }
});
closeEl.addEventListener('click', () => closeWindow());

document.addEventListener('click', (event) => {
  if (!swapPop) return;
  if (swapPop.contains(event.target)) return;
  if (event.target?.closest?.('[data-act="swap"]')) return;
  closeSwap();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (swapPop) {
    closeSwap();
    return;
  }
  closeWindow();
});

window.addEventListener('storage', (event) => {
  if (event.key === 'ops.theme') applyTheme();
});

subscribeAudio(async (reason) => {
  syncHeader();
  if (reason === 'volume' || reason === 'enabled') return;
  if (reason === 'library' || reason === 'state') await reloadClips();
  renderList();
});

wireTooltips();
syncHeader();
reloadClips().then(() => renderList());
