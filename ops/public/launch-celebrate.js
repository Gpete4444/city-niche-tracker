/** Launch-success confetti + fanfare. No-op when the user prefers reduced motion. */

const SOUND_URL = '/sounds/launch-success.mp3';
const PLAY_SECONDS = 15;
const FADE_START = 10;
const CONFETTI_MS = 2800;
const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#06b6d4', '#eab308'];

function prefersReducedMotion() {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
}

function siteLaunched(row) {
  return Boolean(row?.lastLaunchAt || row?.lastShipAt);
}

function siteTime(row) {
  const t = Date.parse(row?.createdAt || row?.lastLaunchAt || row?.lastShipAt || 0);
  return Number.isFinite(t) ? t : 0;
}

/** 1-based ordinal among launched sites (stable on re-launch) plus portfolio total. */
export function launchedCountStats(sites, candidateId) {
  const launched = (sites || []).filter(siteLaunched);
  const sorted = [...launched].sort((a, b) => {
    const dt = siteTime(a) - siteTime(b);
    if (dt) return dt;
    return String(a.candidateId || a.id || '').localeCompare(String(b.candidateId || b.id || ''));
  });
  const total = sorted.length;
  const id = String(candidateId || '');
  const idx = sorted.findIndex(
    (s) => String(s.candidateId || '') === id || String(s.id || '') === id,
  );
  return {
    ordinal: idx >= 0 ? idx + 1 : Math.max(1, total),
    total: Math.max(1, total),
  };
}

function spawnPiece(x, y, vx, vy) {
  return {
    x,
    y,
    vx,
    vy,
    w: 6 + Math.random() * 7,
    h: 8 + Math.random() * 10,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.45,
    color: COLORS[(Math.random() * COLORS.length) | 0],
    gravity: 0.16 + Math.random() * 0.1,
    drag: 0.988 + Math.random() * 0.008,
  };
}

function burstToward(particles, originX, originY, dirX, dirY, count) {
  const base = Math.atan2(dirY, dirX);
  for (let i = 0; i < count; i++) {
    const angle = base + (Math.random() - 0.5) * 1.05;
    const speed = 9 + Math.random() * 16;
    particles.push(
      spawnPiece(originX, originY, Math.cos(angle) * speed, Math.sin(angle) * speed - Math.random() * 5),
    );
  }
}

function fallFromTop(particles, width, count) {
  for (let i = 0; i < count; i++) {
    particles.push(
      spawnPiece(
        Math.random() * width,
        -12 - Math.random() * 40,
        (Math.random() - 0.5) * 3,
        2 + Math.random() * 5,
      ),
    );
  }
}

/** Full-viewport confetti: left + right cannons and a light fall from the top. */
export function burstLaunchConfetti() {
  if (prefersReducedMotion() || typeof document === 'undefined') return;
  const prev = document.getElementById('launch-confetti');
  if (prev) prev.remove();

  const canvas = document.createElement('canvas');
  canvas.id = 'launch-confetti';
  canvas.className = 'launch-confetti';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();

  const particles = [];
  const w = canvas.width;
  const h = canvas.height;
  const midY = h * 0.62;
  burstToward(particles, 0, midY, 1, -0.35, 70);
  burstToward(particles, w, midY, -1, -0.35, 70);
  fallFromTop(particles, w, 55);

  const started = performance.now();
  let raf = 0;
  const onResize = () => resize();
  window.addEventListener('resize', onResize);

  const tick = (now) => {
    const elapsed = now - started;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fade = elapsed > CONFETTI_MS - 500 ? Math.max(0, 1 - (elapsed - (CONFETTI_MS - 500)) / 500) : 1;
    ctx.globalAlpha = fade;

    for (const p of particles) {
      p.vy += p.gravity;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    if (elapsed < CONFETTI_MS) {
      raf = requestAnimationFrame(tick);
      return;
    }
    window.removeEventListener('resize', onResize);
    cancelAnimationFrame(raf);
    canvas.remove();
  };

  raf = requestAnimationFrame(tick);
  setTimeout(() => {
    if (document.body.contains(canvas)) {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
      canvas.remove();
    }
  }, CONFETTI_MS + 800);
}

let primedAudio = null;
let activeSound = null;

function playFallbackFanfare() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!playFallbackFanfare._ctx) playFallbackFanfare._ctx = new Ctx();
    const ctx = playFallbackFanfare._ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const notes = [
      { f: 523.25, t: 0, d: 0.14 },
      { f: 659.25, t: 0.12, d: 0.14 },
      { f: 783.99, t: 0.24, d: 0.16 },
      { f: 1046.5, t: 0.38, d: 0.42 },
    ];
    for (const { f, t, d } of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.14, now + t + 0.02);
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

function clearActiveSound() {
  const s = activeSound;
  activeSound = null;
  if (!s) return;
  if (s.raf) cancelAnimationFrame(s.raf);
  if (s.timer) clearTimeout(s.timer);
  try {
    s.audio.removeEventListener('timeupdate', s.onTime);
    s.audio.removeEventListener('error', s.onError);
    s.audio.pause();
    s.audio.currentTime = 0;
    s.audio.volume = 1;
  } catch {
    /* ignore */
  }
}

export function stopLaunchSuccessSound() {
  clearActiveSound();
}

/**
 * Call from the Launch click (user gesture) so playback still works after the job finishes.
 */
export function primeLaunchSuccessSound() {
  if (prefersReducedMotion()) return;
  try {
    if (!primedAudio) {
      primedAudio = new Audio(SOUND_URL);
      primedAudio.preload = 'auto';
    }
    const a = primedAudio;
    a.muted = true;
    a.volume = 0;
    const p = a.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        a.pause();
        a.currentTime = 0;
        a.muted = false;
        a.volume = 1;
      }).catch(() => {
        a.muted = false;
        a.volume = 1;
      });
    }
  } catch {
    /* ignore */
  }
}

function applyFade(audio) {
  const t = audio.currentTime || 0;
  if (t >= PLAY_SECONDS) {
    stopLaunchSuccessSound();
    return true;
  }
  if (t >= FADE_START) {
    audio.volume = Math.max(0, 1 - (t - FADE_START) / (PLAY_SECONDS - FADE_START));
  } else {
    audio.volume = 1;
  }
  return false;
}

/** First 15s of the launch track; volume 1 until 10s, then linear fade to 0 by 15s. */
export function playLaunchSuccessSound() {
  stopLaunchSuccessSound();
  if (prefersReducedMotion()) return () => {};

  const audio = primedAudio || new Audio(SOUND_URL);
  primedAudio = audio;
  audio.muted = false;
  audio.volume = 1;
  try {
    audio.currentTime = 0;
  } catch {
    /* not seekable yet */
  }

  const onTime = () => {
    applyFade(audio);
  };
  const onError = () => {
    stopLaunchSuccessSound();
    playFallbackFanfare();
  };

  const tick = () => {
    if (!activeSound || activeSound.audio !== audio) return;
    if (applyFade(audio)) return;
    activeSound.raf = requestAnimationFrame(tick);
  };

  audio.addEventListener('timeupdate', onTime);
  audio.addEventListener('error', onError, { once: true });

  activeSound = {
    audio,
    raf: 0,
    timer: 0,
    onTime,
    onError,
  };

  const started = audio.play();
  if (started && typeof started.catch === 'function') {
    started.catch(() => {
      stopLaunchSuccessSound();
      playFallbackFanfare();
    });
  }
  activeSound.raf = requestAnimationFrame(tick);
  activeSound.timer = setTimeout(() => stopLaunchSuccessSound(), (PLAY_SECONDS + 0.25) * 1000);

  return () => stopLaunchSuccessSound();
}
