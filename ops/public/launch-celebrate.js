/** Launch-success confetti. Sound is bound from rover-audio so this file stays importable in Node. */

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
  const t = Date.parse(row?.lastLaunchAt || row?.lastShipAt || row?.createdAt || 0);
  return Number.isFinite(t) ? t : 0;
}

function rowMatchesId(row, id) {
  if (!id) return false;
  return String(row?.candidateId || '') === id || String(row?.id || '') === id;
}

/** 1-based ordinal among launched sites (stable on re-launch) plus portfolio total. */
export function launchedCountStats(sites, candidateId, current = {}) {
  const id = String(candidateId || '');
  const launched = (sites || []).filter(siteLaunched);
  if (id && !launched.some((s) => rowMatchesId(s, id))) {
    launched.push({
      candidateId: id,
      lastLaunchAt: current.lastLaunchAt || current.lastShipAt || new Date().toISOString(),
    });
  }
  const sorted = [...launched].sort((a, b) => {
    const dt = siteTime(a) - siteTime(b);
    if (dt) return dt;
    return String(a.candidateId || a.id || '').localeCompare(String(b.candidateId || b.id || ''));
  });
  const total = Math.max(1, sorted.length);
  const idx = sorted.findIndex((s) => rowMatchesId(s, id));
  return {
    ordinal: idx >= 0 ? idx + 1 : total,
    total,
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

let launchAudio = {
  play() {
    return () => {};
  },
  prime() {},
  stop() {},
};

/** Dashboard binds rover-audio so mute, volume, and clip assignment apply. */
export function bindLaunchAudio(api) {
  if (!api) return;
  launchAudio = api;
}

export function stopLaunchSuccessSound() {
  launchAudio.stop('launch');
}

/** Call from the Launch click (user gesture) so playback still works after the job finishes. */
export function primeLaunchSuccessSound() {
  launchAudio.prime('launch');
}

/** Assigned launch clip, or the built-in fanfare. Returns a stop function. */
export function playLaunchSuccessSound() {
  return launchAudio.play('launch') || (() => {});
}
