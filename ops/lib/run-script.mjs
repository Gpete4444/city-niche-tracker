import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { saveMeta, pathsFor } from './candidates.mjs';
import {
  openLightJob,
  updateLightJobProgress,
  finishLightJob,
} from './rover-light-jobs.mjs';

const ROOT = process.cwd();
const jobs = new Map();
const SCRIPT_JOB_KEEP = 20;
const SCRIPT_LOG_CHARS = 80_000;
const SCRIPT_LOG_LINES = 200;

const SCRIPT_LIGHT_LABEL = {
  research: 'SERP / Volume',
  'serp-seeds': 'SERP seeds',
  enrich: 'Enrich',
  prospects: 'Prospects',
};

const SCRIPT_LIGHT_PROGRESS = {
  research: {
    total: 4,
    steps: [
      { re: /Maps SERP|map pack/i, done: 1, detail: 'Map Pack…' },
      { re: /organic|SERP via/i, done: 2, detail: 'Organic SERP…' },
      { re: /volume|keyword/i, done: 3, detail: 'Volumes…' },
      { re: /cost this run|wrote research/i, done: 4, detail: 'Finishing…' },
    ],
  },
  enrich: {
    total: 3,
    steps: [
      { re: /backlink|domain rank/i, done: 1, detail: 'Backlinks…' },
      { re: /thin|page/i, done: 2, detail: 'Thinness…' },
      { re: /cost this run|enrich/i, done: 3, detail: 'Finishing…' },
    ],
  },
  prospects: {
    total: 3,
    steps: [
      { re: /Maps SERP/i, done: 1, detail: 'Finding renters…' },
      { re: /Paid ads|score|rank/i, done: 2, detail: 'Scoring…' },
      { re: /Wrote /i, done: 3, detail: 'Finishing…' },
    ],
  },
};

function attachScriptLightJob(job) {
  const spec = SCRIPT_LIGHT_PROGRESS[job.label];
  if (!spec) return;
  const { jobId } = openLightJob({
    candidateId: job.candidateId,
    phase: job.label,
    label: SCRIPT_LIGHT_LABEL[job.label] || job.label,
    progressTotal: spec.total,
  });
  job.lightJobId = jobId;
  updateLightJobProgress(jobId, { detail: 'Starting…', done: 0, total: spec.total });
}

function advanceScriptLightJob(job, chunkText) {
  const spec = SCRIPT_LIGHT_PROGRESS[job.label];
  const lightId = job.lightJobId;
  if (!spec || !lightId) return;
  const text = String(chunkText || '');
  let done = Number(job._lightDone) || 0;
  for (const step of spec.steps) {
    if (step.done <= done) continue;
    if (step.re.test(text)) {
      done = step.done;
      job._lightDone = done;
      updateLightJobProgress(lightId, { detail: step.detail, done, total: spec.total });
    }
  }
}

function closeScriptLightJob(job) {
  const lightId = job.lightJobId;
  if (!lightId) return;
  if (job.status === 'ok') {
    const spec = SCRIPT_LIGHT_PROGRESS[job.label];
    if (spec) {
      updateLightJobProgress(lightId, { detail: 'Done', done: spec.total, total: spec.total });
    }
    finishLightJob(lightId, { result: { jobId: job.id, status: job.status } });
    return;
  }
  finishLightJob(lightId, { error: new Error(job.error || 'Job failed') });
}

export function getJob(jobId) {
  return jobs.get(jobId) ?? null;
}

export function listJobsForCandidate(candidateId) {
  return [...jobs.values()].filter((j) => j.candidateId === candidateId);
}

export function findRunningScriptJob(candidateId, label) {
  const cid = String(candidateId || '').trim();
  const lab = String(label || '').trim();
  if (!cid || !lab) return null;
  return (
    [...jobs.values()].find(
      (j) =>
        String(j.candidateId || '') === cid &&
        String(j.label || '') === lab &&
        j.status === 'running',
    ) || null
  );
}

export function assertScriptJobStartAllowed(candidateId, label) {
  const running = findRunningScriptJob(candidateId, label);
  if (!running) return;
  throw Object.assign(new Error(`${label} is already running for this candidate`), {
    status: 409,
    code: 'EVAL_JOB_RUNNING',
    jobId: running.id,
    candidateId: String(candidateId || ''),
  });
}

function appendLog(job, chunk, stream) {
  const text = chunk.toString();
  job.logs.push({ t: Date.now(), stream, text });
  if (job.logs.length > SCRIPT_LOG_LINES) job.logs.splice(0, job.logs.length - SCRIPT_LOG_LINES);
  job.logText += text;
  if (job.logText.length > SCRIPT_LOG_CHARS) {
    job.logText = job.logText.slice(-Math.floor(SCRIPT_LOG_CHARS * 0.75));
  }
}

function trimFinishedScriptJob(job) {
  if (!job) return;
  job.logs = [];
  if (job.logText && job.logText.length > SCRIPT_LOG_CHARS) {
    job.logText = job.logText.slice(-Math.floor(SCRIPT_LOG_CHARS * 0.75));
  }
}

function pruneScriptJobs() {
  const finished = [...jobs.values()]
    .filter((j) => j.status && j.status !== 'running')
    .sort((a, b) => String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')));
  for (const job of finished.slice(SCRIPT_JOB_KEEP)) {
    jobs.delete(job.id);
  }
}

export function lastJobErrorLine(job, code) {
  const stderr = [...(job.logs || [])]
    .filter((e) => e.stream === 'stderr')
    .map((e) => String(e.text || ''))
    .join('');
  const fromLogs = stderr
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const last = fromLogs.length ? fromLogs[fromLogs.length - 1] : '';
  if (last) return last.slice(0, 400);
  const fromText = String(job.logText || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const lastText = fromText.length ? fromText[fromText.length - 1] : '';
  if (lastText) return lastText.slice(0, 400);
  return `Exit code ${code}`;
}

export function isUvHandleClosingCrash(text) {
  const s = String(text || '');
  return /UV_HANDLE_CLOSING/i.test(s) || /src[/\\]win[/\\]async\.c/i.test(s);
}

function parseCostFromLog(logText) {
  const m = String(logText || '').match(/cost this run:\s*\$([0-9.]+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function readJsonSafe(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveJobCostUsd(job) {
  const fromLog = parseCostFromLog(job.logText);
  if (fromLog != null) return fromLog;

  const p = pathsFor(job.candidateId);
  if (job.label === 'research') {
    const research = readJsonSafe(p.research);
    const n = Number(research?.estimatedApiCostUsd);
    return Number.isFinite(n) ? n : null;
  }
  if (job.label === 'enrich') {
    const research = readJsonSafe(p.research);
    const n = Number(research?.enrichment?.estimatedApiCostUsd);
    return Number.isFinite(n) ? n : null;
  }
  if (job.label === 'prospects') {
    const prospects = readJsonSafe(p.prospects);
    const n = Number(prospects?.estimatedApiCostUsd);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function recordJobCost(job) {
  const costUsd = resolveJobCostUsd(job);
  job.costUsd = costUsd;
  job.costSource = 'dataforseo';
  if (costUsd != null) {
    saveMeta(job.candidateId, {
      lastCosts: { [job.label]: costUsd },
    });
  }
}

function argValue(args, flag) {
  const i = (args || []).indexOf(flag);
  if (i < 0) return null;
  const next = args[i + 1];
  return next && !String(next).startsWith('--') ? String(next) : null;
}

function prospectsOutputComplete(job) {
  if (job.label !== 'prospects') return false;
  const prospects = readJsonSafe(pathsFor(job.candidateId).prospects);
  if (!prospects) return false;
  if (!Number.isFinite(Number(prospects.prospectCount))) return false;
  const generatedAt = Date.parse(prospects.generatedAt);
  const started = Date.parse(job.startedAt);
  if (Number.isFinite(generatedAt) && Number.isFinite(started) && generatedAt + 2000 < started) {
    return false;
  }
  return true;
}

function scriptOutputComplete(job) {
  if (prospectsOutputComplete(job)) return true;
  const outPath = argValue(job.args, '--out');
  if (!outPath) return false;
  const data = readJsonSafe(outPath);
  if (!data || typeof data !== 'object') return false;
  const generatedAt = Date.parse(data.generatedAt);
  const started = Date.parse(job.startedAt);
  if (Number.isFinite(generatedAt) && Number.isFinite(started) && generatedAt + 2000 < started) {
    return false;
  }
  return Boolean(data.generatedAt || data.serp || data.enrichment || data.prospectCount != null);
}

const WIN_SPAWN_STAGGER_MS = 150;
let evalSpawnStaggerMs = process.platform === 'win32' ? WIN_SPAWN_STAGGER_MS : 0;
let nextEvalSpawnAt = 0;

export function setEvalSpawnStaggerMsForTests(ms) {
  evalSpawnStaggerMs = Math.max(0, Number(ms) || 0);
  nextEvalSpawnAt = 0;
}

function scheduleEvalSpawn(fn) {
  const now = Date.now();
  const wait = Math.max(0, nextEvalSpawnAt - now);
  nextEvalSpawnAt = now + wait + evalSpawnStaggerMs;
  if (wait > 0) setTimeout(fn, wait);
  else fn();
}

function finishScriptJob(job) {
  closeScriptLightJob(job);
  trimFinishedScriptJob(job);
  pruneScriptJobs();
}

function spawnJobChild(job) {
  const scriptPath = path.join(ROOT, job.script);
  const child = spawn(process.execPath, [scriptPath, ...job.args], {
    cwd: ROOT,
    env: { ...process.env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  job.pid = child.pid;

  child.stdout.on('data', (chunk) => {
    appendLog(job, chunk, 'stdout');
    advanceScriptLightJob(job, chunk);
  });
  child.stderr.on('data', (chunk) => {
    appendLog(job, chunk, 'stderr');
    advanceScriptLightJob(job, chunk);
  });

  child.on('error', (error) => {
    if (job.status !== 'running') return;
    job.status = 'error';
    job.error = error.message;
    job.finishedAt = new Date().toISOString();
    appendLog(job, `${error.message}\n`, 'stderr');
    finishScriptJob(job);
  });

  child.on('close', async (code) => {
    if (job.status !== 'running') return;
    const outputOk = code === 0 || scriptOutputComplete(job);
    if (!outputOk && isUvHandleClosingCrash(job.logText) && !job._uvRetry) {
      job._uvRetry = true;
      appendLog(
        job,
        'Retrying after Windows libuv handle crash (UV_HANDLE_CLOSING)…\n',
        'stderr',
      );
      scheduleEvalSpawn(() => spawnJobChild(job));
      return;
    }
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    if (!outputOk) {
      job.status = 'error';
      job.error = lastJobErrorLine(job, code);
      finishScriptJob(job);
      return;
    }
    try {
      recordJobCost(job);
      if (typeof job.onSuccess === 'function') {
        await job.onSuccess(job);
      }
      job.status = 'ok';
      if (code !== 0) {
        appendLog(
          job,
          `Exit ${code} but output file is complete — marked ok.\n`,
          'stderr',
        );
      }
    } catch (error) {
      job.status = 'error';
      job.error = error.message;
      appendLog(job, `onSuccess: ${error.message}\n`, 'stderr');
    }
    finishScriptJob(job);
  });
}

/**
 * Spawn a node script relative to repo root. Returns job record immediately.
 */
export function startJob({
  candidateId,
  label,
  script,
  args = [],
  onSuccess = null,
}) {
  assertScriptJobStartAllowed(candidateId, label);
  const jobId = randomUUID();
  const job = {
    id: jobId,
    candidateId,
    label,
    script,
    args,
    onSuccess,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    logs: [],
    logText: '',
    error: null,
    costUsd: null,
    costSource: null,
    _uvRetry: false,
  };
  jobs.set(jobId, job);
  saveMeta(candidateId, { lastJobId: jobId });
  attachScriptLightJob(job);
  scheduleEvalSpawn(() => spawnJobChild(job));
  return job;
}

export function runResearch(candidateId, { adsMode = 'live', forceSerp = false, volumesOnly = false, skipVolumes = false } = {}) {
  const p = pathsFor(candidateId);
  const mode = String(adsMode || 'live').toLowerCase() === 'standard' ? 'standard' : 'live';
  const skip = Boolean(skipVolumes);
  const args = ['--config', p.config, '--out', p.research, '--ads-mode', mode];
  if (forceSerp) args.push('--force-serp');
  if (volumesOnly && !skip) args.push('--volumes-only');
  if (skip) args.push('--skip-volumes');
  return startJob({
    candidateId,
    label: skip ? 'serp-seeds' : 'research',
    script: 'scripts/research-candidate.mjs',
    args,
    onSuccess: () => {
      saveMeta(candidateId, {
        lastResearchAt: new Date().toISOString(),
        lastAdsMode: mode,
        lastResearchMode: skip ? 'skip_volumes' : forceSerp ? 'force_serp' : 'default',
      });
    },
  });
}

export function runEnrich(candidateId) {
  const p = pathsFor(candidateId);
  return startJob({
    candidateId,
    label: 'enrich',
    script: 'scripts/enrich-candidate.mjs',
    args: ['--research', p.research, '--out', p.research],
    onSuccess: () => {
      saveMeta(candidateId, { lastEnrichAt: new Date().toISOString() });
    },
  });
}

export function runProspects(candidateId) {
  const p = pathsFor(candidateId);
  return startJob({
    candidateId,
    label: 'prospects',
    script: 'scripts/prospect-renters.mjs',
    args: ['--research', p.research, '--out', p.prospects],
    onSuccess: () => {
      saveMeta(candidateId, { lastProspectsAt: new Date().toISOString() });
    },
  });
}

/**
 * Async Narrative draft as a job record (for batch runner + single poll).
 */
export function runNarrativeJob(candidateId) {
  assertScriptJobStartAllowed(candidateId, 'narrative');
  const jobId = randomUUID();
  const job = {
    id: jobId,
    candidateId,
    label: 'narrative',
    script: 'claude-narrative',
    args: [],
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    logs: [],
    logText: '',
    error: null,
    costUsd: null,
    costSource: 'anthropic',
  };
  jobs.set(jobId, job);
  saveMeta(candidateId, { lastJobId: jobId });

  (async () => {
    try {
      appendLog(job, `Narrative draft for ${candidateId}…\n`, 'stdout');
      const { generateNarrativeDraft } = await import('./claude.mjs');
      const result = await generateNarrativeDraft(candidateId);
      if (result.costUsd != null) {
        job.costUsd = result.costUsd;
        saveMeta(candidateId, { lastCosts: { narrative: result.costUsd } });
      }
      appendLog(
        job,
        result.parseError
          ? 'Draft saved with parse error — review raw text.\n'
          : 'Narrative draft saved.\n',
        'stdout',
      );
      job.status = 'ok';
      job.exitCode = 0;
      job.finishedAt = new Date().toISOString();
    } catch (error) {
      job.status = 'error';
      job.error = error.message;
      job.finishedAt = new Date().toISOString();
      appendLog(job, `${error.message}\n`, 'stderr');
    }
    trimFinishedScriptJob(job);
    pruneScriptJobs();
  })();

  return job;
}
