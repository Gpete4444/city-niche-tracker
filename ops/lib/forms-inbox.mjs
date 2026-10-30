/**
 * Provision and read the shared Rover forms inbox (one Worker + one D1 database).
 * The dashboard pulls submissions. Live sites POST leads here; the Worker emails them.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESEARCH_DIR } from './candidates.mjs';
import { cfFetch, cloudflareConfigured, getCloudflareCredentials } from './cloudflare-launch.mjs';
import { normalizeLeadDomain, upsertFormSubmissions } from './form-submissions.mjs';
import { loadSpamKeywords, normalizeSpamKeywords } from './spam-keywords.mjs';
import { listLaunchedSites } from './sites.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKER_DIR = path.join(ROOT, 'ops', 'forms-worker');
const STATE_FILE = path.join(RESEARCH_DIR, 'forms-inbox.json');
const LOCAL_WRANGLER = path.join(WORKER_DIR, 'wrangler.local.json');
export const FORMS_WORKER_NAME = 'rover-forms';
const DB_NAME = 'rover-forms';

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function loadFormsInboxState() {
  const raw = readJson(STATE_FILE, {});
  return raw && typeof raw === 'object' ? raw : {};
}

function saveFormsInboxState(patch) {
  const next = { ...loadFormsInboxState(), ...patch };
  writeJson(STATE_FILE, next);
  return next;
}

/** Worker origin, or the full /submit URL if that is what was saved. */
export function formsIngestUrl() {
  const fromEnv = String(process.env.ROVER_FORMS_INGEST_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return String(loadFormsInboxState().ingestUrl || '').trim().replace(/\/$/, '');
}

/** URL the browser posts to. */
export function formsIngestSubmitUrl() {
  const raw = formsIngestUrl();
  if (!raw) return '';
  if (/\/submit$/i.test(raw)) return raw;
  return `${raw}/submit`;
}

export function formsInboxStatus() {
  const state = loadFormsInboxState();
  const ingestUrl = formsIngestSubmitUrl();
  return {
    ready: Boolean(state.databaseId && ingestUrl),
    databaseId: state.databaseId || '',
    workerName: state.workerName || FORMS_WORKER_NAME,
    ingestUrl,
    provisionedAt: state.provisionedAt || null,
    submissionsSyncedThrough: state.submissionsSyncedThrough || null,
  };
}

function requireReady() {
  const status = formsInboxStatus();
  if (!status.ready) {
    const err = new Error('Forms inbox is not set up yet. Use Set up inbox on Phone/Form.');
    err.status = 400;
    err.needsSetup = true;
    throw err;
  }
  return status;
}

function d1Rows(result) {
  const first = Array.isArray(result) ? result[0] : result;
  return Array.isArray(first?.results) ? first.results : [];
}

async function d1Query(databaseId, sql, params = []) {
  const { accountId } = getCloudflareCredentials();
  const result = await cfFetch('POST', `/accounts/${accountId}/d1/database/${databaseId}/query`, {
    sql,
    params,
  });
  return d1Rows(result);
}

function schemaStatements() {
  const file = path.join(WORKER_DIR, 'schema.sql');
  return readFileSync(file, 'utf8')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith('--'));
}

async function findOrCreateDatabase() {
  const { accountId } = getCloudflareCredentials();
  const listed = await cfFetch('GET', `/accounts/${accountId}/d1/database?per_page=100`);
  const databases = Array.isArray(listed) ? listed : [];
  const named = databases.find((db) => db.name === DB_NAME);
  if (named?.uuid) return named.uuid;
  const created = await cfFetch('POST', `/accounts/${accountId}/d1/database`, { name: DB_NAME });
  const id = created?.uuid;
  if (!id) {
    const err = new Error('Cloudflare did not return a D1 database id');
    err.status = 502;
    throw err;
  }
  return id;
}

async function applySchema(databaseId) {
  for (const sql of schemaStatements()) {
    await d1Query(databaseId, sql, []);
  }
  await ensureNotifyEmailColumn(databaseId);
}

/** Existing databases were created before notify_email. CREATE IF NOT EXISTS will not add it. */
async function ensureNotifyEmailColumn(databaseId) {
  try {
    await d1Query(databaseId, 'ALTER TABLE sites ADD COLUMN notify_email TEXT', []);
  } catch (error) {
    const msg = String(error?.message || error);
    if (!/duplicate column|already exists/i.test(msg)) throw error;
  }
}

function defaultNotifyEmail() {
  return String(process.env.LEAD_NOTIFY_EMAIL || process.env.WEB3FORMS_DEFAULT_NOTIFY_EMAIL || '')
    .trim()
    .toLowerCase();
}

function writeLocalWrangler(databaseId) {
  const notify = defaultNotifyEmail();
  const config = {
    name: FORMS_WORKER_NAME,
    compatibility_date: '2026-10-15',
    main: './src/index.js',
    send_email: [{ name: 'EMAIL' }],
    d1_databases: [
      {
        binding: 'DB',
        database_name: DB_NAME,
        database_id: databaseId,
      },
    ],
  };
  if (notify) config.vars = { NOTIFY_EMAIL: notify };
  writeJson(LOCAL_WRANGLER, config);
}

function runWranglerDeploy() {
  const { accountId, apiToken } = getCloudflareCredentials();
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return new Promise((resolve, reject) => {
    const child = spawn(npx, ['wrangler', 'deploy', '--config', 'wrangler.local.json'], {
      cwd: WORKER_DIR,
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: apiToken,
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      reject(Object.assign(new Error('wrangler deploy timed out'), { status: 500, stdout, stderr }));
    }, 180_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          Object.assign(
            new Error(`wrangler deploy failed (exit ${code}): ${(stderr || stdout).slice(-2000)}`),
            { status: 500, stdout, stderr },
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function ingestUrlFromDeployOutput(text) {
  const match = String(text || '').match(/https:\/\/[a-z0-9-]+\.[a-z0-9.-]*workers\.dev/i);
  return match ? match[0].replace(/\/$/, '') : '';
}

async function workersDevOrigin() {
  try {
    const { accountId } = getCloudflareCredentials();
    const result = await cfFetch('GET', `/accounts/${accountId}/workers/subdomain`);
    const sub = String(result?.subdomain || '').trim();
    if (!sub) return '';
    return `https://${FORMS_WORKER_NAME}.${sub}.workers.dev`;
  } catch {
    return '';
  }
}

/**
 * Create D1, apply schema, deploy the worker, and record the public URL.
 */
export async function ensureFormsInbox() {
  if (!cloudflareConfigured()) {
    const err = new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN before setting up the forms inbox.');
    err.status = 400;
    throw err;
  }
  const databaseId = await findOrCreateDatabase();
  saveFormsInboxState({ databaseId, workerName: FORMS_WORKER_NAME });
  await applySchema(databaseId);
  writeLocalWrangler(databaseId);
  const deployed = await runWranglerDeploy();
  const fromLog = ingestUrlFromDeployOutput(`${deployed.stdout}\n${deployed.stderr}`);
  const ingestUrl = fromLog || (await workersDevOrigin()) || formsIngestUrl();
  if (!ingestUrl) {
    const err = new Error(
      'Worker deployed, but Rover could not read its workers.dev URL. Set ROVER_FORMS_INGEST_URL to https://rover-forms.<your-subdomain>.workers.dev',
    );
    err.status = 500;
    throw err;
  }
  const state = saveFormsInboxState({
    databaseId,
    workerName: FORMS_WORKER_NAME,
    ingestUrl,
    provisionedAt: new Date().toISOString(),
  });
  const allowlist = await syncFormsAllowlist();
  const spamKeywords = await syncSpamKeywords(loadSpamKeywords());
  return { ...formsInboxStatus(), state, allowlist, spamKeywords };
}

function launchedAllowlistRows() {
  const rows = [];
  const seen = new Set();
  for (const site of listLaunchedSites()) {
    const domain = normalizeLeadDomain(site.domain);
    if (!domain || !domain.includes('.') || seen.has(domain)) continue;
    seen.add(domain);
    rows.push({
      domain,
      siteId: site.id || '',
      candidateId: site.candidateId || '',
      businessName: site.businessName || site.niche || '',
      notifyEmail: String(site.notifyEmail || defaultNotifyEmail() || '').trim().toLowerCase(),
    });
  }
  return rows;
}

/**
 * Copy the saved spam phrases into D1 so live sites can check them
 * while Rover is closed. Does not redeploy the worker.
 */
export async function syncSpamKeywords(keywords) {
  const status = formsInboxStatus();
  if (!status.ready || !status.databaseId) return { synced: false };
  const list = normalizeSpamKeywords(keywords);
  await d1Query(
    status.databaseId,
    'CREATE TABLE IF NOT EXISTS spam_keywords (keyword TEXT PRIMARY KEY)',
    [],
  );
  await d1Query(status.databaseId, 'DELETE FROM spam_keywords', []);
  for (let i = 0; i < list.length; i += 40) {
    const chunk = list.slice(i, i + 40);
    const values = chunk.map(() => '(?)').join(', ');
    await d1Query(
      status.databaseId,
      `INSERT INTO spam_keywords (keyword) VALUES ${values}`,
      chunk,
    );
  }
  return { synced: true, keywords: list };
}

/** Replace the D1 site allowlist with current launched domains. */
export async function syncFormsAllowlist() {
  const status = requireReady();
  await applySchema(status.databaseId);
  const rows = launchedAllowlistRows();
  // D1 allows 100 bound parameters. Each site row binds 5 values.
  for (let i = 0; i < rows.length; i += 18) {
    const chunk = rows.slice(i, i + 18);
    const values = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const params = chunk.flatMap((row) => [
      row.domain,
      row.siteId,
      row.candidateId,
      row.businessName,
      row.notifyEmail || null,
    ]);
    await d1Query(
      status.databaseId,
      `INSERT INTO sites (domain, site_id, candidate_id, business_name, notify_email) VALUES ${values}
       ON CONFLICT(domain) DO UPDATE SET
         site_id = excluded.site_id,
         candidate_id = excluded.candidate_id,
         business_name = excluded.business_name,
         notify_email = COALESCE(sites.notify_email, excluded.notify_email)`,
      params,
    );
  }
  if (rows.length) {
    await d1Query(
      status.databaseId,
      `DELETE FROM sites WHERE domain NOT IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(rows.map((row) => row.domain))],
    );
  }
  return { domains: rows.length };
}

/** Delete inbox rows by id. Local Gmail copies are not in D1, so those ids are skipped. */
export async function deleteInboxSubmissions(ids) {
  const status = requireReady();
  const unique = [
    ...new Set((ids || []).map((id) => String(id || '').trim()).filter((id) => id.startsWith('sub_'))),
  ];
  for (let i = 0; i < unique.length; i += 80) {
    const chunk = unique.slice(i, i + 80);
    const marks = chunk.map(() => '?').join(', ');
    await d1Query(status.databaseId, `DELETE FROM submissions WHERE id IN (${marks})`, chunk);
  }
  return { deleted: unique.length };
}

/**
 * Pull submissions newer than the last sync (with overlap) into the local jsonl.
 */
export async function syncFormSubmissionsFromInbox() {
  const status = requireReady();
  await syncFormsAllowlist();
  const state = loadFormsInboxState();
  const through = String(state.submissionsSyncedThrough || '').trim();
  const sinceMs = through ? Date.parse(through) - 2 * 24 * 60 * 60 * 1000 : 0;
  const since = Number.isFinite(sinceMs) && sinceMs > 0 ? new Date(sinceMs).toISOString() : '1970-01-01T00:00:00.000Z';
  const incoming = [];
  let cursorAt = since;
  let cursorId = '';
  for (let page = 0; page < 40; page += 1) {
    const batch = await d1Query(
      status.databaseId,
      `SELECT id, domain, submitted_at, page_url, name, phone, email, service, message
       FROM submissions
       WHERE submitted_at > ? OR (submitted_at = ? AND id > ?)
       ORDER BY submitted_at ASC, id ASC
       LIMIT 200`,
      [cursorAt, cursorAt, cursorId],
    );
    if (!batch.length) break;
    incoming.push(...batch);
    const last = batch[batch.length - 1];
    cursorAt = last.submitted_at;
    cursorId = last.id;
    if (batch.length < 200) break;
  }
  const saved = upsertFormSubmissions(incoming);
  let newest = through;
  for (const row of incoming) {
    const at = String(row.submitted_at || '');
    if (at && (!newest || at > newest)) newest = at;
  }
  if (newest) saveFormsInboxState({ submissionsSyncedThrough: newest });
  return { ...saved, fetched: incoming.length, inbox: formsInboxStatus() };
}
