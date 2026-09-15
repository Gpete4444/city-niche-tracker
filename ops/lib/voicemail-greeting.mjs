/**
 * Global ranking voicemail greeting: local copy + Twilio Functions public Asset.
 * Spoken fallback is a public Asset `/voicemail-fallback.txt` (Function env values max at 100 chars).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import twilio from 'twilio';
import { RESEARCH_DIR } from './candidates.mjs';

export const DEFAULT_VOICEMAIL_FALLBACK_SAY =
  "You've reached {site}. Please leave your name, number, and a brief message after the tone.";

const GREETING_DIR = path.join(RESEARCH_DIR, 'voicemail-greeting');
const META_FILE = path.join(GREETING_DIR, 'meta.json');
const ASSET_FRIENDLY = 'rover-voicemail-greeting';
const FALLBACK_ASSET_FRIENDLY = 'rover-voicemail-fallback';
const FALLBACK_PATH = '/voicemail-fallback.txt';
const GREETING_PATHS = new Set([
  '/voicemail-greeting.mp3',
  '/voicemail-greeting.wav',
  '/voicemail-greeting',
]);
const MAX_BYTES = 5 * 1024 * 1024;
const ENV_GREETING_URL = 'TWILIO_VOICEMAIL_GREETING_URL';
const ENV_FALLBACK_URL = 'TWILIO_VOICEMAIL_FALLBACK_URL';
const ENV_FALLBACK_SAY = 'TWILIO_VOICEMAIL_FALLBACK_SAY';
const TWILIO_FUNCTIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../twilio-functions',
);
const VOICE_FUNCTIONS = [
  { path: '/inbound', file: 'inbound.js' },
  { path: '/whisper', file: 'whisper.js' },
  { path: '/voicemail-done', file: 'voicemail-done.js' },
  { path: '/recording', file: 'recording.js' },
  { path: '/status', file: 'status.js' },
];

function env(name) {
  return String(process.env[name] || '').trim();
}

function ensureDir() {
  mkdirSync(GREETING_DIR, { recursive: true });
}

function emptyMeta() {
  return {
    filename: '',
    contentType: '',
    greetingUrl: '',
    fallbackSay: DEFAULT_VOICEMAIL_FALLBACK_SAY,
    usingUploadedGreeting: false,
    updatedAt: null,
    fallbackUpdatedAt: null,
    assetSid: '',
    fallbackAssetSid: '',
    fallbackUrl: '',
    publishError: null,
    functionsSourceHash: '',
    functionsDeployedAt: null,
  };
}

export function loadGreetingMeta() {
  ensureDir();
  if (!existsSync(META_FILE)) return emptyMeta();
  try {
    const raw = JSON.parse(readFileSync(META_FILE, 'utf8'));
    return { ...emptyMeta(), ...(raw && typeof raw === 'object' ? raw : {}) };
  } catch {
    return emptyMeta();
  }
}

function saveMeta(partial) {
  ensureDir();
  const next = { ...loadGreetingMeta(), ...partial };
  writeFileSync(META_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

function localAudioPath(filename) {
  const name = String(filename || '').trim();
  if (!name) return '';
  return path.join(GREETING_DIR, name);
}

export function greetingAudioFile() {
  const meta = loadGreetingMeta();
  const p = localAudioPath(meta.filename);
  if (!p || !existsSync(p)) return null;
  return { path: p, contentType: meta.contentType || 'audio/mpeg', filename: meta.filename };
}

export function greetingStatus() {
  const meta = loadGreetingMeta();
  const file = greetingAudioFile();
  return {
    hasAudio: Boolean(file),
    filename: file ? meta.filename : '',
    contentType: file ? meta.contentType : '',
    fallbackSay: meta.fallbackSay || DEFAULT_VOICEMAIL_FALLBACK_SAY,
    defaultFallbackSay: DEFAULT_VOICEMAIL_FALLBACK_SAY,
    usingUploadedGreeting: Boolean(meta.usingUploadedGreeting && file),
    greetingUrl: meta.greetingUrl || '',
    fallbackUrl: meta.fallbackUrl || '',
    updatedAt: meta.updatedAt || null,
    fallbackUpdatedAt: meta.fallbackUpdatedAt || null,
    publishError: meta.publishError || null,
  };
}

function twilioClient() {
  const sid = env('TWILIO_ACCOUNT_SID');
  const token = env('TWILIO_AUTH_TOKEN');
  if (!sid || !token) {
    throw Object.assign(
      new Error('Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN'),
      { status: 400 },
    );
  }
  return twilio(sid, token);
}

function webhookHost() {
  try {
    return new URL(env('TWILIO_VOICE_WEBHOOK_URL')).host.toLowerCase();
  } catch {
    return '';
  }
}

function versionSid(item) {
  if (!item) return '';
  if (typeof item === 'string') return item;
  return String(item.sid || '').trim();
}

function assetPath(item) {
  if (!item || typeof item === 'string') return '';
  return String(item.path || '').trim();
}

function functionPath(item) {
  if (!item || typeof item === 'string') return '';
  return String(item.path || '').trim();
}

function functionSidOf(item) {
  if (!item || typeof item === 'string') return '';
  return String(item.functionSid || item.function_sid || '').trim();
}

/**
 * Resolve the Functions service + environment that serves TWILIO_VOICE_WEBHOOK_URL.
 */
export async function resolveVoiceService() {
  const client = twilioClient();
  const host = webhookHost();
  const forcedSid = env('TWILIO_SERVERLESS_SERVICE_SID');
  const services = await client.serverless.v1.services.list({ limit: 50 });
  let service = null;
  if (forcedSid) {
    service = services.find((s) => s.sid === forcedSid) || null;
    if (!service) {
      try {
        service = await client.serverless.v1.services(forcedSid).fetch();
      } catch {
        service = null;
      }
    }
  }
  if (!service && host) {
    for (const s of services) {
      const envs = await client.serverless.v1.services(s.sid).environments.list({ limit: 20 });
      const envHit = envs.find((e) => {
        const domain = String(e.domainName || '').toLowerCase();
        return domain && (host === domain || host.endsWith(`.${domain}`) || domain === host);
      });
      if (envHit) {
        return { client, service: s, environment: envHit };
      }
    }
  }
  if (!service) {
    service =
      services.find((s) => String(s.uniqueName || '').toLowerCase() === 'rover-voice') ||
      services[0] ||
      null;
  }
  if (!service) {
    throw Object.assign(
      new Error(
        'No Twilio Functions service found. Deploy ops/twilio-functions (see docs/PHONE-TRACKING.md) or set TWILIO_SERVERLESS_SERVICE_SID.',
      ),
      { status: 400 },
    );
  }
  const environments = await client.serverless.v1.services(service.sid).environments.list({
    limit: 20,
  });
  const environment =
    environments.find((e) => String(e.domainName || '').toLowerCase() === host) ||
    environments.find((e) => String(e.uniqueName || '').toLowerCase() === 'dev') ||
    environments[0] ||
    null;
  if (!environment) {
    throw Object.assign(
      new Error('Twilio Functions service has no environment to deploy to'),
      { status: 400 },
    );
  }
  return { client, service, environment };
}

async function latestBuild(client, serviceSid, environmentSid) {
  const deployments = await client.serverless.v1
    .services(serviceSid)
    .environments(environmentSid)
    .deployments.list({ limit: 5 });
  const buildSid = deployments[0]?.buildSid;
  if (!buildSid) {
    throw Object.assign(
      new Error(
        'No Twilio Functions deployment yet. Deploy All on the rover-voice service (inbound, whisper, voicemail-done, recording) first.',
      ),
      { status: 400 },
    );
  }
  return client.serverless.v1.services(serviceSid).builds(buildSid).fetch();
}

async function waitForBuild(client, serviceSid, buildSid) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const build = await client.serverless.v1.services(serviceSid).builds(buildSid).fetch();
    const status = String(build.status || '').toLowerCase();
    if (status === 'completed') return build;
    if (status === 'failed') {
      throw Object.assign(new Error('Twilio Functions build failed'), { status: 502 });
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw Object.assign(new Error('Twilio Functions build timed out'), { status: 504 });
}

async function createAssetVersion({ serviceSid, assetSid, assetPathName, buffer, filename, contentType }) {
  const sid = env('TWILIO_ACCOUNT_SID');
  const token = env('TWILIO_AUTH_TOKEN');
  const form = new FormData();
  form.append('Path', assetPathName);
  form.append('Visibility', 'public');
  const blob = new Blob([buffer], { type: contentType || 'application/octet-stream' });
  form.append('Content', blob, filename || 'voicemail-greeting.mp3');
  const url = `https://serverless-upload.twilio.com/v1/Services/${serviceSid}/Assets/${assetSid}/Versions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
    },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(
      new Error(
        `Twilio Asset version failed (${res.status}): ${json?.message || JSON.stringify(json).slice(0, 300)}`,
      ),
      { status: 502 },
    );
  }
  return json;
}

async function createFunctionVersion({ serviceSid, functionSid, functionPathName, buffer, filename }) {
  const sid = env('TWILIO_ACCOUNT_SID');
  const token = env('TWILIO_AUTH_TOKEN');
  const form = new FormData();
  form.append('Path', functionPathName);
  form.append('Visibility', 'public');
  const blob = new Blob([buffer], { type: 'application/javascript' });
  form.append('Content', blob, filename || 'inbound.js');
  const url = `https://serverless-upload.twilio.com/v1/Services/${serviceSid}/Functions/${functionSid}/Versions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
    },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(
      new Error(
        `Twilio Function version failed for ${functionPathName} (${res.status}): ${json?.message || JSON.stringify(json).slice(0, 300)}`,
      ),
      { status: 502 },
    );
  }
  return json;
}

function readVoiceFunctionSpecs() {
  return VOICE_FUNCTIONS.map((spec) => {
    const filePath = path.join(TWILIO_FUNCTIONS_DIR, spec.file);
    if (!existsSync(filePath)) {
      throw Object.assign(new Error(`Missing Twilio Function source ${spec.file}`), { status: 500 });
    }
    return { ...spec, buffer: readFileSync(filePath) };
  });
}

function hashVoiceFunctions(specs = readVoiceFunctionSpecs()) {
  const h = createHash('sha256');
  for (const spec of specs) {
    h.update(spec.path);
    h.update('\n');
    h.update(spec.buffer);
    h.update('\n');
  }
  return h.digest('hex');
}

function matchListedFunction(listed, fnPath, currentFns) {
  const want = fnPath.replace(/^\//, '').toLowerCase();
  const fromBuild = (currentFns || []).find((item) => functionPath(item) === fnPath);
  const sid = functionSidOf(fromBuild);
  if (sid) {
    const hit = listed.find((f) => f.sid === sid);
    if (hit) return hit;
  }
  return (
    listed.find((f) => {
      const n = String(f.friendlyName || '')
        .replace(/^\//, '')
        .toLowerCase();
      return n === want || n === fnPath.toLowerCase();
    }) || null
  );
}

async function findOrCreateVoiceFunction(client, serviceSid, fnPath, listed, currentFns) {
  const existing = matchListedFunction(listed, fnPath, currentFns);
  if (existing) return existing;
  const created = await client.serverless.v1.services(serviceSid).functions.create({
    friendlyName: fnPath.replace(/^\//, ''),
  });
  listed.push(created);
  return created;
}

async function uploadVoiceFunctionVersions(client, service, currentFns) {
  const specs = readVoiceFunctionSpecs();
  const listed = await client.serverless.v1.services(service.sid).functions.list({ limit: 50 });
  const ours = new Set(VOICE_FUNCTIONS.map((d) => d.path));
  const sids = [];
  for (const spec of specs) {
    const fn = await findOrCreateVoiceFunction(client, service.sid, spec.path, listed, currentFns);
    const version = await createFunctionVersion({
      serviceSid: service.sid,
      functionSid: fn.sid,
      functionPathName: spec.path,
      buffer: spec.buffer,
      filename: spec.file,
    });
    const sid = versionSid(version);
    if (!sid) {
      throw new Error(`Twilio Function version for ${spec.path} had no SID`);
    }
    sids.push(sid);
  }
  for (const item of currentFns || []) {
    const p = functionPath(item);
    if (p && !ours.has(p) && versionSid(item)) sids.push(versionSid(item));
  }
  return sids;
}

async function functionVersionsForBuild(client, service, current) {
  const specs = readVoiceFunctionSpecs();
  const hash = hashVoiceFunctions(specs);
  const meta = loadGreetingMeta();
  const currentFns = current.functionVersions || [];
  if (meta.functionsSourceHash === hash && currentFns.length) {
    return { sids: currentFns.map(versionSid).filter(Boolean), hash, uploaded: false };
  }
  const sids = await uploadVoiceFunctionVersions(client, service, currentFns);
  return { sids, hash, uploaded: true };
}

async function createAndDeployBuild({
  client,
  service,
  environment,
  current,
  functionVersions,
  assetVersions,
  functionsHash,
} = {}) {
  if (!functionVersions?.length) {
    throw Object.assign(
      new Error('Current Twilio deploy has no Function versions — Deploy All from ops/twilio-functions first.'),
      { status: 400 },
    );
  }
  const deps = current.dependencies;
  const dependencies =
    typeof deps === 'string' ? deps : deps != null ? JSON.stringify(deps) : undefined;
  const build = await client.serverless.v1.services(service.sid).builds.create({
    functionVersions,
    assetVersions: assetVersions?.length ? assetVersions : undefined,
    ...(dependencies ? { dependencies } : {}),
    ...(current.runtime ? { runtime: current.runtime } : {}),
  });
  await waitForBuild(client, service.sid, build.sid);
  await client.serverless.v1
    .services(service.sid)
    .environments(environment.sid)
    .deployments.create({ buildSid: build.sid });
  if (functionsHash) {
    saveMeta({
      functionsSourceHash: functionsHash,
      functionsDeployedAt: new Date().toISOString(),
    });
  }
  return build;
}

async function setEnvironmentVariable(client, serviceSid, environmentSid, key, value) {
  const vars = await client.serverless.v1
    .services(serviceSid)
    .environments(environmentSid)
    .variables.list({ limit: 100 });
  const existing = vars.find((v) => v.key === key);
  if (value == null || value === '') {
    if (existing) {
      await client.serverless.v1
        .services(serviceSid)
        .environments(environmentSid)
        .variables(existing.sid)
        .remove();
    }
    return { deleted: Boolean(existing) };
  }
  const str = String(value);
  if (str.length > 100) {
    return { skipped: true, reason: 'twilio env values max 100 characters' };
  }
  if (existing) {
    await client.serverless.v1
      .services(serviceSid)
      .environments(environmentSid)
      .variables(existing.sid)
      .update({ value: str });
    return { updated: true, sid: existing.sid };
  }
  const created = await client.serverless.v1
    .services(serviceSid)
    .environments(environmentSid)
    .variables.create({ key, value: str });
  return { created: true, sid: created.sid };
}

async function findOrCreateNamedAsset(client, serviceSid, { sid, friendlyName }) {
  if (sid) {
    try {
      const existing = await client.serverless.v1.services(serviceSid).assets(sid).fetch();
      if (existing?.sid) return existing;
    } catch {
      /* create below */
    }
  }
  const listed = await client.serverless.v1.services(serviceSid).assets.list({ limit: 50 });
  const hit = listed.find((a) => String(a.friendlyName || '') === friendlyName);
  if (hit) return hit;
  return client.serverless.v1.services(serviceSid).assets.create({ friendlyName });
}

function findOrCreateGreetingAsset(client, serviceSid, meta) {
  return findOrCreateNamedAsset(client, serviceSid, {
    sid: meta.assetSid,
    friendlyName: ASSET_FRIENDLY,
  });
}

function findOrCreateFallbackAsset(client, serviceSid, meta) {
  return findOrCreateNamedAsset(client, serviceSid, {
    sid: meta.fallbackAssetSid,
    friendlyName: FALLBACK_ASSET_FRIENDLY,
  });
}

function greetingAssetPath(ext) {
  return ext === 'wav' ? '/voicemail-greeting.wav' : '/voicemail-greeting.mp3';
}

async function deployBuildWithAssets({
  client,
  service,
  environment,
  addVersionSids = [],
  replacePaths = [],
} = {}) {
  const current = await latestBuild(client, service.sid, environment.sid);
  const fn = await functionVersionsForBuild(client, service, current);
  const drop = new Set(replacePaths.filter(Boolean));
  const assetVersions = (current.assetVersions || [])
    .filter((a) => {
      const p = assetPath(a);
      if (drop.has(p)) return false;
      return Boolean(versionSid(a));
    })
    .map(versionSid);
  for (const sid of addVersionSids) {
    if (sid) assetVersions.push(sid);
  }

  return createAndDeployBuild({
    client,
    service,
    environment,
    current,
    functionVersions: fn.sids,
    assetVersions,
    functionsHash: fn.uploaded ? fn.hash : undefined,
  });
}

/**
 * Publish ops/twilio-functions source into the live Twilio build when the files changed.
 * No-op when the stored hash already matches.
 */
export async function ensureVoiceFunctionsDeployed() {
  const { client, service, environment } = await resolveVoiceService();
  const current = await latestBuild(client, service.sid, environment.sid);
  const fn = await functionVersionsForBuild(client, service, current);
  if (!fn.uploaded) {
    return { ok: true, skipped: true, hash: fn.hash };
  }
  const assetVersions = (current.assetVersions || []).map(versionSid).filter(Boolean);
  const build = await createAndDeployBuild({
    client,
    service,
    environment,
    current,
    functionVersions: fn.sids,
    assetVersions,
    functionsHash: fn.hash,
  });
  return { ok: true, skipped: false, buildSid: build.sid, hash: fn.hash };
}

function detectAudio({ buffer, filename, contentType }) {
  const name = String(filename || 'voicemail-greeting.mp3').toLowerCase();
  const type = String(contentType || '').toLowerCase();
  const isWav =
    type.includes('wav') || name.endsWith('.wav') || name.endsWith('.wave');
  const isMp3 = type.includes('mpeg') || type.includes('mp3') || name.endsWith('.mp3');
  if (!isWav && !isMp3) {
    throw Object.assign(new Error('Upload an MP3 or WAV greeting'), { status: 400 });
  }
  if (!buffer?.length) {
    throw Object.assign(new Error('Greeting file was empty'), { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    throw Object.assign(new Error('Greeting must be 5 MB or smaller'), { status: 400 });
  }
  const ext = isWav ? 'wav' : 'mp3';
  return {
    ext,
    contentType: isWav ? 'audio/wav' : 'audio/mpeg',
    filename: `voicemail-greeting.${ext}`,
  };
}

/**
 * Save locally and publish to Twilio Functions as a public asset.
 */
export async function uploadVoicemailGreeting({ buffer, filename, contentType } = {}) {
  const kind = detectAudio({ buffer, filename, contentType });
  ensureDir();
  const prev = loadGreetingMeta();
  const dest = path.join(GREETING_DIR, kind.filename);
  if (prev.filename && prev.filename !== kind.filename) {
    const old = localAudioPath(prev.filename);
    if (old && existsSync(old)) {
      try {
        unlinkSync(old);
      } catch {
        /* ignore */
      }
    }
  }
  writeFileSync(dest, buffer);

  let meta = saveMeta({
    filename: kind.filename,
    contentType: kind.contentType,
    updatedAt: new Date().toISOString(),
    usingUploadedGreeting: false,
    publishError: null,
  });

  try {
    const { client, service, environment } = await resolveVoiceService();
    const asset = await findOrCreateGreetingAsset(client, service.sid, meta);
    const version = await createAssetVersion({
      serviceSid: service.sid,
      assetSid: asset.sid,
      assetPathName: greetingAssetPath(kind.ext),
      buffer,
      filename: kind.filename,
      contentType: kind.contentType,
    });
    const versionSidVal = version.sid;
    if (!versionSidVal) {
      throw new Error('Twilio Asset version had no SID');
    }
    await deployBuildWithAssets({
      client,
      service,
      environment,
      addVersionSids: [versionSidVal],
      replacePaths: [...GREETING_PATHS],
    });
    const greetingUrl = `https://${environment.domainName}${greetingAssetPath(kind.ext)}`;
    await setEnvironmentVariable(client, service.sid, environment.sid, ENV_GREETING_URL, greetingUrl);
    meta = saveMeta({
      assetSid: asset.sid,
      greetingUrl,
      usingUploadedGreeting: true,
      publishError: null,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    meta = saveMeta({
      usingUploadedGreeting: false,
      publishError: error.message || String(error),
    });
    throw Object.assign(
      new Error(
        `Saved locally, but Twilio publish failed: ${error.message}. Callers will hear the spoken fallback until this succeeds.`,
      ),
      { status: error.status || 502, meta: greetingStatus() },
    );
  }
  return greetingStatus();
}

export async function removeVoicemailGreeting() {
  const prev = loadGreetingMeta();
  if (prev.filename) {
    const p = localAudioPath(prev.filename);
    if (p && existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
  let publishError = null;
  try {
    const { client, service, environment } = await resolveVoiceService();
    await deployBuildWithAssets({
      client,
      service,
      environment,
      addVersionSids: [],
      replacePaths: [...GREETING_PATHS],
    });
    await setEnvironmentVariable(client, service.sid, environment.sid, ENV_GREETING_URL, '');
  } catch (error) {
    publishError = error.message || String(error);
  }
  saveMeta({
    filename: '',
    contentType: '',
    greetingUrl: '',
    usingUploadedGreeting: false,
    updatedAt: new Date().toISOString(),
    publishError,
    assetSid: prev.assetSid || '',
  });
  const status = greetingStatus();
  if (publishError) {
    throw Object.assign(
      new Error(
        `Removed local greeting, but Twilio still has the file: ${publishError}. Retry or unset TWILIO_VOICEMAIL_GREETING_URL in Functions env.`,
      ),
      { status: 502, meta: status },
    );
  }
  return status;
}

export async function saveVoicemailFallback(text) {
  const fallbackSay = String(text || '').trim() || DEFAULT_VOICEMAIL_FALLBACK_SAY;
  if (fallbackSay.length > 500) {
    throw Object.assign(new Error('Spoken fallback must be 500 characters or less'), { status: 400 });
  }
  ensureDir();
  writeFileSync(path.join(GREETING_DIR, 'voicemail-fallback.txt'), fallbackSay, 'utf8');
  saveMeta({
    fallbackSay,
    fallbackUpdatedAt: new Date().toISOString(),
    publishError: null,
  });
  try {
    const { client, service, environment } = await resolveVoiceService();
    const meta = loadGreetingMeta();
    const asset = await findOrCreateFallbackAsset(client, service.sid, meta);
    const version = await createAssetVersion({
      serviceSid: service.sid,
      assetSid: asset.sid,
      assetPathName: FALLBACK_PATH,
      buffer: Buffer.from(fallbackSay, 'utf8'),
      filename: 'voicemail-fallback.txt',
      contentType: 'text/plain; charset=utf-8',
    });
    const versionSidVal = version.sid;
    if (!versionSidVal) {
      throw new Error('Twilio fallback Asset version had no SID');
    }
    await deployBuildWithAssets({
      client,
      service,
      environment,
      addVersionSids: [versionSidVal],
      replacePaths: [FALLBACK_PATH],
    });
    const fallbackUrl = `https://${environment.domainName}${FALLBACK_PATH}`;
    await setEnvironmentVariable(client, service.sid, environment.sid, ENV_FALLBACK_SAY, '');
    await setEnvironmentVariable(client, service.sid, environment.sid, ENV_FALLBACK_URL, '');
    saveMeta({
      fallbackAssetSid: asset.sid,
      fallbackUrl,
      publishError: null,
      fallbackUpdatedAt: new Date().toISOString(),
    });
  } catch (error) {
    saveMeta({ publishError: error.message || String(error) });
    throw Object.assign(
      new Error(
        `Saved locally, but Twilio publish failed: ${error.message}. Redeploy /inbound from ops/twilio-functions, then Save again. Live calls still use the previous spoken fallback.`,
      ),
      { status: error.status || 502, meta: greetingStatus() },
    );
  }
  return greetingStatus();
}
