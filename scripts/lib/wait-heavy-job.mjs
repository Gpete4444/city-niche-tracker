/**
 * Poll a Rover heavy job until done/error.
 */
const BASE = 'http://127.0.0.1:8787';
const TAB = 'agent-sparks-relaunch';

export async function postJson(path, body, { headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Rover-Tab-Id': TAB, ...headers },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text || res.statusText };
  }
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export async function claimWriteLease(candidateId, { takeover = true } = {}) {
  return postJson(`/api/candidates/${encodeURIComponent(candidateId)}/website-lease`, { takeover });
}

export async function heartbeatWriteLease(candidateId) {
  return postJson(`/api/candidates/${encodeURIComponent(candidateId)}/website-lease/heartbeat`, {});
}

export async function waitHeavyJob(jobId, { intervalMs = 2000, label = 'job', candidateId } = {}) {
  const id = String(jobId || '').trim();
  if (!id) throw new Error('jobId required');
  for (;;) {
    if (candidateId) {
      try {
        await heartbeatWriteLease(candidateId);
      } catch {
        /* lease may expire; takeover again */
        try {
          await claimWriteLease(candidateId, { takeover: true });
        } catch {
          /* ignore */
        }
      }
    }
    const res = await fetch(`${BASE}/api/heavy-jobs/${encodeURIComponent(id)}`);
    const data = await res.json();
    const job = data.job || data;
    const status = job.status;
    const detail = job.progress?.detail || job.label || '';
    process.stdout.write(`[${label}] ${status}${detail ? ` — ${detail}` : ''}\n`);
    if (status === 'done') return job.result;
    if (status === 'error') {
      const err = new Error(job.error || `${label} failed`);
      err.job = job;
      throw err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
