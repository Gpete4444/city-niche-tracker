/**
 * Rover UI sounds: built-in tones, uploaded clips, master mute, per-event silence.
 * Preferences live in localStorage. Clip bytes live in IndexedDB.
 * Safe to import from Node (no window work until a browser calls in).
 */

export const AUDIO_EVENTS = [
  { id: 'click', name: 'Button click', group: 'Interface', builtin: 'tick' },
  { id: 'tab', name: 'Top bar tab', group: 'Interface', builtin: 'tab' },
  { id: 'success', name: 'Success', group: 'Status', builtin: 'success' },
  { id: 'warning', name: 'Warning', group: 'Status', builtin: 'warning' },
  { id: 'error', name: 'Error', group: 'Status', builtin: 'error' },
  { id: 'launch', name: 'Launch success', group: 'Status', builtin: 'launch' },
  { id: 'job', name: 'Job started', group: 'Pipeline', builtin: 'job' },
  { id: 'copy', name: 'Copied', group: 'Pipeline', builtin: 'copy' },
  { id: 'incoming', name: 'Incoming', group: 'Pipeline', builtin: 'incoming' },
];

export const AUDIO_BUILTINS = [
  { id: 'tick', name: 'Soft tick' },
  { id: 'tab', name: 'Tab' },
  { id: 'success', name: 'Chime' },
  { id: 'warning', name: 'Warning tone' },
  { id: 'error', name: 'Error tone' },
  { id: 'launch', name: 'Fanfare' },
  { id: 'job', name: 'Blip' },
  { id: 'copy', name: 'Pop' },
  { id: 'incoming', name: 'Doorbell' },
];

export const AUDIO_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxClips: 20,
};

const ENABLED_KEY = 'ops.audio.enabled';
const VOLUME_KEY = 'ops.audio.volume';
const ASSIGN_KEY = 'ops.audio.assignments';
const MUTED_KEY = 'ops.audio.mutedEvents';
const DB_NAME = 'rover-audio';
const STORE = 'clips';
const LAUNCH_URL = '/sounds/launch-success.mp3';
const LAUNCH_PLAY_SECONDS = 15;
const LAUNCH_FADE_START = 10;
const CLIP_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
]);

const PRESETS = {
  tick: [{ type: 'sine', f: 1480, t: 0, d: 0.028, g: 0.045 }],
  tab: [
    { type: 'sine', f: 520, t: 0, d: 0.055, g: 0.06 },
    { type: 'sine', f: 700, t: 0.06, d: 0.07, g: 0.055 },
  ],
  success: [
    { type: 'sine', f: 660, t: 0, d: 0.12, g: 0.12 },
    { type: 'sine', f: 880, t: 0.1, d: 0.18, g: 0.12 },
  ],
  warning: [{ type: 'triangle', f: 440, t: 0, d: 0.16, g: 0.09 }],
  error: [
    { type: 'triangle', f: 520, t: 0, d: 0.11, g: 0.1 },
    { type: 'triangle', f: 340, t: 0.12, d: 0.18, g: 0.1 },
  ],
  launch: [
    { type: 'triangle', f: 523.25, t: 0, d: 0.14, g: 0.14 },
    { type: 'triangle', f: 659.25, t: 0.12, d: 0.14, g: 0.14 },
    { type: 'triangle', f: 783.99, t: 0.24, d: 0.16, g: 0.14 },
    { type: 'triangle', f: 1046.5, t: 0.38, d: 0.42, g: 0.14 },
  ],
  job: [{ type: 'sine', f: 400, f2: 640, t: 0, d: 0.12, g: 0.07 }],
  copy: [{ type: 'sine', f: 1560, t: 0, d: 0.04, g: 0.05 }],
  incoming: [
    { type: 'sine', f: 784, t: 0, d: 0.12, g: 0.09 },
    { type: 'sine', f: 988, t: 0.14, d: 0.2, g: 0.09 },
  ],
};

const listeners = new Set();
let listening = false;
let channel = null;
let dbPromise = null;
let audioCtx = null;
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

let launchAudio = null;
let launchHandle = null;
let primeToken = 0;
let launchPrimed = false;
let previewStop = null;
let lastClickAt = 0;
let gestureAudio = null;
let gestureUnlocked = false;
const urlCache = new Map();

function prefersReducedMotion() {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function isSoundId(id) {
  if (typeof id !== 'string') return false;
  if (id.startsWith('builtin:')) return Boolean(PRESETS[id.slice(8)]);
  if (id.startsWith('clip:')) return /^[0-9a-f-]{8,}$/i.test(id.slice(5));
  return false;
}

function eventById(eventId) {
  return AUDIO_EVENTS.find((event) => event.id === eventId) || null;
}

function readAssignments() {
  const raw = readJson(ASSIGN_KEY, {});
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const event of AUDIO_EVENTS) {
    const id = raw[event.id];
    if (isSoundId(id)) out[event.id] = id;
  }
  return out;
}

function readMuted() {
  const raw = readJson(MUTED_KEY, []);
  if (!Array.isArray(raw)) return [];
  const known = new Set(AUDIO_EVENTS.map((event) => event.id));
  return raw.filter((id) => known.has(id));
}

export function defaultSoundId(eventId) {
  const event = eventById(eventId);
  return event ? `builtin:${event.builtin}` : 'builtin:tick';
}

export function audioEnabled() {
  try {
    const value = localStorage.getItem(ENABLED_KEY);
    if (value === '0') return false;
    if (value === '1') return true;
  } catch {
    return true;
  }
  return !prefersReducedMotion();
}

export function setAudioEnabled(on) {
  localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
  publish('enabled');
}

export function getVolume() {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw == null || raw === '') return 0.7;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0.7;
    return Math.max(0, Math.min(1, n));
  } catch {
    return 0.7;
  }
}

export function setVolume(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return;
  const clamped = Math.max(0, Math.min(1, Math.round(next * 1000) / 1000));
  const stored = localStorage.getItem(VOLUME_KEY);
  if (stored != null && Math.abs(clamped - getVolume()) < 0.0005) return;
  localStorage.setItem(VOLUME_KEY, String(clamped));
  publish('volume');
}

export function isEventMuted(eventId) {
  return readMuted().includes(eventId);
}

export function setEventMuted(eventId, muted) {
  if (!eventById(eventId)) return;
  const list = readMuted().filter((id) => id !== eventId);
  if (muted) list.push(eventId);
  writeJson(MUTED_KEY, list);
  publish('mute');
}

export function getAssignment(eventId) {
  return readAssignments()[eventId] || defaultSoundId(eventId);
}

export function assignmentIsDefault(eventId) {
  return getAssignment(eventId) === defaultSoundId(eventId);
}

export function setAssignment(eventId, soundId) {
  if (!eventById(eventId) || !isSoundId(soundId)) return;
  const map = readAssignments();
  map[eventId] = soundId;
  writeJson(ASSIGN_KEY, map);
  publish('assign');
}

export function resetAssignment(eventId) {
  if (!eventById(eventId)) return;
  const map = readAssignments();
  delete map[eventId];
  writeJson(ASSIGN_KEY, map);
  publish('assign');
}

export function soundLabel(soundId, clips = []) {
  if (typeof soundId !== 'string') return 'Sound';
  if (soundId.startsWith('builtin:')) {
    const id = soundId.slice(8);
    return AUDIO_BUILTINS.find((item) => item.id === id)?.name || 'Built-in';
  }
  if (soundId.startsWith('clip:')) {
    const id = soundId.slice(5);
    return clips.find((clip) => clip.id === id)?.name || 'Uploaded sound';
  }
  return 'Sound';
}

function emit(reason) {
  for (const fn of listeners) {
    try {
      fn(reason);
    } catch {
      /* listener */
    }
  }
}

function getChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  try {
    channel = new BroadcastChannel('rover-audio');
    channel.onmessage = (event) => {
      const reason = event?.data?.reason || 'state';
      if (reason === 'library') clearClipUrls();
      emit(reason);
    };
  } catch {
    channel = null;
  }
  return channel;
}

function ensureListening() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  getChannel();
  window.addEventListener('storage', (event) => {
    if (!event.key || !event.key.startsWith('ops.audio.')) return;
    if (event.key === VOLUME_KEY) emit('volume');
    else if (event.key === ENABLED_KEY) emit('enabled');
    else emit('state');
  });
}

function publish(reason) {
  ensureListening();
  emit(reason);
  try {
    getChannel()?.postMessage({ reason });
  } catch {
    /* channel closed */
  }
}

export function subscribeAudio(fn) {
  ensureListening();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not save that sound.'));
  });
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      dbPromise = null;
      reject(new Error('Could not save that sound.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error('Could not save that sound.'));
    };
  });
  return dbPromise;
}

function clearClipUrls() {
  for (const url of urlCache.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
  urlCache.clear();
}

export async function listClips() {
  const db = await openDb();
  const rows = await reqToPromise(db.transaction(STORE).objectStore(STORE).getAll());
  return (rows || [])
    .map((row) => ({
      id: row.id,
      name: row.name,
      mime: row.mime,
      createdAt: row.createdAt || 0,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function getClip(id) {
  const db = await openDb();
  return reqToPromise(db.transaction(STORE).objectStore(STORE).get(id));
}

function mimeForName(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  return '';
}

export async function addClip(file) {
  const name = String(file?.name || 'Sound')
    .replace(/^.*[\\/]/, '')
    .slice(0, 80) || 'Sound';
  const mime = String(file?.type || '').toLowerCase();
  const extOk = /\.(mp3|wav|ogg|m4a)$/i.test(name);
  const mimeOk = CLIP_MIME.has(mime);
  if (!file || (!extOk && !mimeOk)) {
    throw new Error('Use an mp3, wav, ogg, or m4a file.');
  }
  if (file.size > AUDIO_LIMITS.maxBytes) throw new Error('That file is over 2 MB.');
  const existing = await listClips();
  if (existing.length >= AUDIO_LIMITS.maxClips) throw new Error('The library is full (20 sounds).');
  const id = crypto.randomUUID();
  const type = mimeOk ? mime : mimeForName(name);
  const blob = type && file.type !== type ? new Blob([file], { type }) : file;
  const record = { id, name, mime: type || mime, blob, createdAt: Date.now() };
  try {
    const db = await openDb();
    await reqToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record));
  } catch (error) {
    if (error?.message === 'The library is full (20 sounds).' || error?.message === 'That file is over 2 MB.') {
      throw error;
    }
    throw new Error('Could not save that sound.');
  }
  publish('library');
  return { id, name, mime: record.mime, createdAt: record.createdAt };
}

export async function removeClip(id) {
  const db = await openDb();
  await reqToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
  const cached = urlCache.get(id);
  if (cached) {
    try {
      URL.revokeObjectURL(cached);
    } catch {
      /* ignore */
    }
    urlCache.delete(id);
  }
  const map = readAssignments();
  let changed = false;
  for (const key of Object.keys(map)) {
    if (map[key] === `clip:${id}`) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) writeJson(ASSIGN_KEY, map);
  publish('library');
}

function getCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  return audioCtx;
}

function resumeCtx() {
  try {
    const ctx = getCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch {
    /* autoplay */
  }
}

function unlockMediaElement() {
  if (gestureUnlocked || typeof Audio === 'undefined') return;
  try {
    if (!gestureAudio) gestureAudio = new Audio(SILENT_WAV);
    const pending = gestureAudio.play();
    if (pending && typeof pending.then === 'function') {
      pending
        .then(() => {
          gestureUnlocked = true;
          try {
            gestureAudio.pause();
          } catch {
            /* ignore */
          }
        })
        .catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

function ensureLaunchAudio() {
  if (!launchAudio) {
    launchAudio = new Audio(LAUNCH_URL);
    launchAudio.preload = 'auto';
  }
  return launchAudio;
}

function primeLaunchElement() {
  if (launchPrimed || launchHandle) return;
  try {
    const audio = ensureLaunchAudio();
    const token = ++primeToken;
    audio.muted = true;
    audio.volume = 0;
    const pending = audio.play();
    if (pending && typeof pending.then === 'function') {
      pending
        .then(() => {
          if (token !== primeToken || launchHandle) return;
          audio.pause();
          try {
            audio.currentTime = 0;
          } catch {
            /* not seekable yet */
          }
          audio.muted = false;
          audio.volume = getVolume();
          launchPrimed = true;
        })
        .catch(() => {
          audio.muted = false;
        });
    }
  } catch {
    /* ignore */
  }
}

export function prime(eventId) {
  if (typeof window === 'undefined' || !audioEnabled()) return;
  ensureListening();
  resumeCtx();
  unlockMediaElement();
  if (!eventId || eventId === 'launch' || getAssignment(eventId) === 'builtin:launch') {
    if (getAssignment('launch') === 'builtin:launch') primeLaunchElement();
  }
}

export function installAudioUnlock() {
  if (typeof window === 'undefined') return;
  ensureListening();
  const onGesture = () => {
    if (!audioEnabled()) return;
    resumeCtx();
    unlockMediaElement();
    if (getAssignment('launch') === 'builtin:launch') primeLaunchElement();
  };
  window.addEventListener('pointerdown', onGesture, { passive: true });
}

export function installCopySound(playCopy) {
  try {
    const clip = navigator.clipboard;
    if (!clip || typeof clip.writeText !== 'function' || clip.writeText.__roverAudio) return;
    const original = clip.writeText.bind(clip);
    const wrapped = function writeText(text) {
      return Promise.resolve(original(text)).then((result) => {
        try {
          playCopy();
        } catch {
          /* sound must not fail the copy */
        }
        return result;
      });
    };
    wrapped.__roverAudio = true;
    clip.writeText = wrapped;
  } catch {
    /* clipboard writeText is read-only here */
  }
}

function playNotes(notes, volume, onEnded) {
  const ctx = getCtx();
  if (!ctx) {
    onEnded?.();
    return () => {};
  }
  resumeCtx();
  const now = ctx.currentTime;
  const oscillators = [];
  let maxEnd = 0;
  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.type || 'sine';
    const start = now + (note.t || 0);
    const dur = Math.max(0.02, note.d || 0.1);
    if (note.f2 && note.f > 0) {
      osc.frequency.setValueAtTime(note.f, start);
      osc.frequency.exponentialRampToValueAtTime(note.f2, start + dur);
    } else {
      osc.frequency.setValueAtTime(note.f || 440, start);
    }
    const peak = Math.max(0.0002, (note.g ?? 0.08) * volume);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.02, dur * 0.45));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.03);
    oscillators.push(osc);
    maxEnd = Math.max(maxEnd, (note.t || 0) + dur);
  }
  let timer = window.setTimeout(() => onEnded?.(), (maxEnd + 0.04) * 1000);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    timer = 0;
    for (const osc of oscillators) {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
    }
  };
}

function playBlob(blob, volume, onEnded) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.volume = Math.max(0, Math.min(1, volume));
  let done = false;
  const finish = (notify) => {
    if (done) return;
    done = true;
    try {
      audio.pause();
    } catch {
      /* ignore */
    }
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
    if (notify) onEnded?.();
  };
  audio.addEventListener('ended', () => finish(true), { once: true });
  audio.addEventListener('error', () => finish(true), { once: true });
  const pending = audio.play();
  if (pending && typeof pending.catch === 'function') pending.catch(() => finish(true));
  return () => finish(false);
}

function stopLaunchPlayback() {
  const stop = launchHandle;
  launchHandle = null;
  if (stop) stop();
}

function playLaunchFile(volume, onEnded) {
  stopLaunchPlayback();
  primeToken += 1;
  const audio = ensureLaunchAudio();
  let inner = () => {};
  let notified = false;
  const notify = () => {
    if (notified) return;
    notified = true;
    onEnded?.();
  };
  const stop = () => {
    const fn = inner;
    inner = () => {};
    fn();
    if (launchHandle === stop) launchHandle = null;
  };
  launchHandle = stop;

  let fileStopped = false;
  let fellBack = false;
  let raf = 0;
  let timer = 0;
  const detach = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (timer) clearTimeout(timer);
    timer = 0;
    audio.removeEventListener('timeupdate', onTime);
    audio.removeEventListener('error', onError);
  };
  const stopFile = () => {
    if (fileStopped) return;
    fileStopped = true;
    detach();
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      /* ignore */
    }
  };
  inner = stopFile;

  const applyLevel = () => {
    const t = audio.currentTime || 0;
    if (t >= LAUNCH_PLAY_SECONDS) return true;
    const fade =
      t >= LAUNCH_FADE_START
        ? Math.max(0, 1 - (t - LAUNCH_FADE_START) / (LAUNCH_PLAY_SECONDS - LAUNCH_FADE_START))
        : 1;
    audio.volume = Math.max(0, Math.min(1, volume * fade));
    return false;
  };
  const finishFile = () => {
    if (launchHandle !== stop || notified) return;
    stopFile();
    inner = () => {};
    if (launchHandle === stop) launchHandle = null;
    notify();
  };
  const onTime = () => {
    if (fileStopped || launchHandle !== stop) return;
    if (applyLevel()) finishFile();
  };
  const useFallback = () => {
    if (launchHandle !== stop || notified || fellBack) return;
    fellBack = true;
    stopFile();
    inner = playNotes(PRESETS.launch, volume, notify);
  };
  const onError = () => useFallback();

  audio.muted = false;
  audio.volume = Math.max(0, Math.min(1, volume));
  try {
    audio.currentTime = 0;
  } catch {
    /* not seekable yet */
  }
  audio.addEventListener('timeupdate', onTime);
  audio.addEventListener('error', onError, { once: true });
  const started = audio.play();
  if (started && typeof started.catch === 'function') {
    started.catch(() => useFallback());
  }
  const tick = () => {
    if (fileStopped || launchHandle !== stop) return;
    if (applyLevel()) {
      finishFile();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  timer = window.setTimeout(() => finishFile(), (LAUNCH_PLAY_SECONDS + 0.25) * 1000);
  return stop;
}

function startSound(soundId, volume, onEnded, event) {
  if (soundId === 'builtin:launch') return playLaunchFile(volume, onEnded);
  if (soundId.startsWith('builtin:')) {
    const notes = PRESETS[soundId.slice(8)] || PRESETS.tick;
    return playNotes(notes, volume, onEnded);
  }
  if (soundId.startsWith('clip:')) {
    let cancelled = false;
    let inner = () => {};
    const stop = () => {
      cancelled = true;
      inner();
    };
    getClip(soundId.slice(5))
      .then((clip) => {
        if (cancelled) return;
        if (!clip?.blob) {
          const fallback = event ? defaultSoundId(event.id) : '';
          if (fallback && fallback !== soundId) inner = startSound(fallback, volume, onEnded, null);
          else onEnded?.();
          return;
        }
        inner = playBlob(clip.blob, volume, onEnded);
      })
      .catch(() => {
        if (!cancelled) onEnded?.();
      });
    return stop;
  }
  onEnded?.();
  return () => {};
}

export function stop(eventId) {
  if (eventId === 'launch') stopLaunchPlayback();
  else stopPreview();
}

export function stopPreview() {
  const stopFn = previewStop;
  previewStop = null;
  if (stopFn) stopFn();
}

export function preview(soundId, onEnded) {
  stopPreview();
  const volume = getVolume();
  if (!isSoundId(soundId) || volume <= 0.001) {
    onEnded?.();
    return () => {};
  }
  let ended = false;
  let wrapped = () => {};
  const finish = () => {
    if (ended) return;
    ended = true;
    if (previewStop === wrapped) previewStop = null;
    onEnded?.();
  };
  const stopFn = startSound(soundId, volume, finish, null);
  wrapped = () => {
    if (ended) return;
    ended = true;
    stopFn();
    if (previewStop === wrapped) previewStop = null;
  };
  previewStop = wrapped;
  return wrapped;
}

export function play(eventId) {
  ensureListening();
  const event = eventById(eventId);
  if (!event || !audioEnabled() || isEventMuted(eventId)) return () => {};
  if (eventId === 'click') {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastClickAt < 40) return () => {};
    lastClickAt = now;
  }
  const volume = getVolume();
  if (volume <= 0.001) return () => {};
  try {
    resumeCtx();
    unlockMediaElement();
    return startSound(getAssignment(eventId), volume, null, event);
  } catch {
    return () => {};
  }
}
