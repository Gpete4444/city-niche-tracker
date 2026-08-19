/**
 * Append-only Twilio call log + summarize pipeline (STT → Claude).
 * Storage: research/phone-calls.jsonl (one JSON object per line).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import twilio from 'twilio';
import { RESEARCH_DIR } from './candidates.mjs';
import { listSites, listSitesWithPhone } from './sites.mjs';

const CALLS_FILE = path.join(RESEARCH_DIR, 'phone-calls.jsonl');
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_SUMMARY_MODEL = 'gpt-4o-mini';

function env(name) {
  return String(process.env[name] || '').trim();
}

function requireOpenAiKey() {
  const key = env('OPENAI_API_KEY');
  if (!key) {
    throw Object.assign(
      new Error('Missing OPENAI_API_KEY — needed for phone call summaries'),
      { status: 400 },
    );
  }
  return key;
}

function ensureCallsFile() {
  mkdirSync(RESEARCH_DIR, { recursive: true });
  if (!existsSync(CALLS_FILE)) writeFileSync(CALLS_FILE, '', 'utf8');
}

function twilioClient() {
  const sid = env('TWILIO_ACCOUNT_SID');
  const token = env('TWILIO_AUTH_TOKEN');
  if (!sid || !token) {
    throw Object.assign(new Error('Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN'), { status: 400 });
  }
  return twilio(sid, token);
}

function rowId(callSid, siteId) {
  return createHash('sha1').update(`${siteId || ''}:${callSid || ''}`).digest('hex').slice(0, 16);
}

/** Validate shared secret from Twilio Function relay. */
export function assertPhoneWebhookSecret(headerOrBodySecret) {
  const expected = env('ROVER_PHONE_WEBHOOK_SECRET');
  if (!expected) {
    throw Object.assign(
      new Error('ROVER_PHONE_WEBHOOK_SECRET not set — cannot accept phone webhooks'),
      { status: 503 },
    );
  }
  const got = String(headerOrBodySecret || '').trim();
  if (!got || got.length !== expected.length) {
    throw Object.assign(new Error('Invalid phone webhook secret'), { status: 401 });
  }
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (!timingSafeEqual(a, b)) {
    throw Object.assign(new Error('Invalid phone webhook secret'), { status: 401 });
  }
}

export function signPhoneRelayPayload(bodyObj) {
  const secret = env('ROVER_PHONE_WEBHOOK_SECRET');
  if (!secret) return '';
  const raw = JSON.stringify(bodyObj);
  return createHmac('sha256', secret).update(raw).digest('hex');
}

function readAllCalls() {
  ensureCallsFile();
  const text = readFileSync(CALLS_FILE, 'utf8');
  if (!text.trim()) return [];
  const rows = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      rows.push(JSON.parse(s));
    } catch {
      /* skip bad line */
    }
  }
  return rows;
}

function rewriteAllCalls(rows) {
  ensureCallsFile();
  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  writeFileSync(CALLS_FILE, body ? `${body}\n` : '', 'utf8');
}

function upsertCall( partial ) {
  const callSid = String(partial.callSid || '').trim();
  if (!callSid) {
    throw Object.assign(new Error('callSid required'), { status: 400 });
  }
  const rows = readAllCalls();
  const idx = rows.findIndex((r) => r.callSid === callSid);
  const prev = idx >= 0 ? rows[idx] : {};
  const siteId = String(partial.siteId || prev.siteId || '').trim();
  const next = {
    id: prev.id || rowId(callSid, siteId),
    callSid,
    siteId: siteId || null,
    from: partial.from ?? prev.from ?? '',
    to: partial.to ?? prev.to ?? '',
    status: partial.status ?? prev.status ?? '',
    answered:
      partial.answered !== undefined
        ? Boolean(partial.answered)
        : prev.answered !== undefined
          ? Boolean(prev.answered)
          : null,
    durationSec: Number(partial.durationSec ?? prev.durationSec ?? 0) || 0,
    startedAt: partial.startedAt || prev.startedAt || null,
    endedAt: partial.endedAt || prev.endedAt || null,
    forwardTo: partial.forwardTo || prev.forwardTo || '',
    recordingSid: partial.recordingSid || prev.recordingSid || '',
    recordingUrl: partial.recordingUrl || prev.recordingUrl || '',
    recordingDurationSec:
      Number(partial.recordingDurationSec ?? prev.recordingDurationSec ?? 0) || 0,
    transcript: partial.transcript ?? prev.transcript ?? '',
    summary: partial.summary ?? prev.summary ?? '',
    summaryAt: partial.summaryAt || prev.summaryAt || null,
    error: partial.error !== undefined ? partial.error : prev.error || null,
    updatedAt: new Date().toISOString(),
    createdAt: prev.createdAt || new Date().toISOString(),
  };
  if (idx >= 0) rows[idx] = next;
  else rows.push(next);
  rewriteAllCalls(rows);
  return next;
}

function answeredFromDialStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed' || s === 'answered' || s === 'in-progress') return true;
  if (['no-answer', 'busy', 'failed', 'canceled', 'cancelled'].includes(s)) return false;
  return null;
}

/**
 * Resolve portfolio site id from Twilio To number or explicit siteId.
 */
export function resolveSiteIdFromPhonePayload({ siteId, to } = {}) {
  if (siteId) {
    const hit = listSites().find((s) => s.id === siteId);
    if (hit) return hit.id;
  }
  const digits = String(to || '').replace(/\D/g, '');
  if (!digits) return null;
  for (const s of listSites()) {
    const e164 = String(s.phoneTracking?.e164 || s.phone || '').replace(/\D/g, '');
    if (e164 && (e164 === digits || e164.endsWith(digits) || digits.endsWith(e164))) {
      return s.id;
    }
  }
  return null;
}

export function handleDialStatusWebhook(body = {}) {
  const callSid = body.CallSid || body.callSid || body.ParentCallSid;
  const dialStatus = body.DialCallStatus || body.CallStatus || body.status || '';
  const duration = Number(body.DialCallDuration || body.CallDuration || body.duration || 0) || 0;
  const siteId = resolveSiteIdFromPhonePayload({
    siteId: body.siteId || body.SiteId,
    to: body.To || body.to || body.Called,
  });
  const answered = answeredFromDialStatus(dialStatus);
  return upsertCall({
    callSid,
    siteId,
    from: body.From || body.from || '',
    to: body.To || body.to || '',
    status: dialStatus || 'unknown',
    answered,
    durationSec: duration,
    startedAt: body.Timestamp || body.timestamp || null,
    endedAt: new Date().toISOString(),
    forwardTo: body.forward || body.Forward || body.forwardTo || '',
  });
}

export function handleRecordingWebhook(body = {}) {
  const callSid = body.CallSid || body.callSid;
  const recordingSid = body.RecordingSid || body.recordingSid || '';
  const recordingUrl = String(body.RecordingUrl || body.recordingUrl || '').replace(/\.(json|xml)$/i, '');
  const duration = Number(body.RecordingDuration || body.recordingDuration || 0) || 0;
  const siteId = resolveSiteIdFromPhonePayload({
    siteId: body.siteId || body.SiteId,
    to: body.To || body.to,
  });
  const row = upsertCall({
    callSid,
    siteId,
    from: body.From || body.from || '',
    to: body.To || body.to || '',
    status: body.CallStatus || body.status || 'completed',
    answered: true,
    recordingSid,
    recordingUrl: recordingUrl ? `${recordingUrl}.mp3` : '',
    recordingDurationSec: duration,
    durationSec: duration,
  });
  return row;
}

function isoOrNull(value) {
  if (!value) return null;
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

/**
 * Durable backfill: pull Calls + Recordings from Twilio REST for portfolio DIDs.
 * Does not require webhooks/tunnel — recovers history while Rover was offline.
 *
 * @param {{ siteId?: string|null, sinceDays?: number, callLimit?: number }} opts
 */
export async function syncCallsFromTwilio({
  siteId = null,
  sinceDays = 30,
  callLimit = 100,
} = {}) {
  const client = twilioClient();
  const days = Math.max(1, Math.min(90, Number(sinceDays) || 30));
  const limit = Math.max(1, Math.min(200, Number(callLimit) || 100));
  const startTimeAfter = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let sites = listSitesWithPhone();
  if (siteId) {
    sites = sites.filter((s) => s.id === siteId);
    if (!sites.length) {
      const one = listSites().find((s) => s.id === siteId);
      if (one?.phoneTracking?.provider === 'twilio' && one.phoneTracking?.e164) {
        sites = [one];
      }
    }
  }

  let upserted = 0;
  let summarizedQueued = 0;
  const siteIds = [];

  for (const site of sites) {
    const e164 = String(site.phoneTracking?.e164 || '').trim();
    if (!e164) continue;
    siteIds.push(site.id);

    let calls;
    try {
      calls = await client.calls.list({
        to: e164,
        startTimeAfter,
        limit,
      });
    } catch (error) {
      throw Object.assign(
        new Error(`Twilio calls.list failed for ${e164}: ${error?.message || error}`),
        { status: error?.status || 502 },
      );
    }

    for (const call of calls) {
      const callSid = call.sid;
      if (!callSid) continue;
      const status = String(call.status || '').toLowerCase();
      const answered = answeredFromDialStatus(status);
      const durationSec = Number(call.duration || 0) || 0;
      const forwardTo = site.phoneTracking?.forwardTo || '';

      let recordingSid = '';
      let recordingUrl = '';
      let recordingDurationSec = 0;
      try {
        const recordings = await client.recordings.list({ callSid, limit: 5 });
        const rec = recordings.find((r) => r.status === 'completed') || recordings[0];
        if (rec?.sid) {
          recordingSid = rec.sid;
          recordingDurationSec = Number(rec.duration || 0) || 0;
          const accountSid = env('TWILIO_ACCOUNT_SID');
          recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${rec.sid}.mp3`;
        }
      } catch (error) {
        console.warn(`[phone-calls] recordings.list ${callSid}:`, error.message);
      }

      const prev = getPhoneCall(callSid);
      upsertCall({
        callSid,
        siteId: site.id,
        from: call.from || '',
        to: call.to || e164,
        status: status || 'unknown',
        answered,
        durationSec: durationSec || recordingDurationSec,
        startedAt: isoOrNull(call.startTime) || isoOrNull(call.dateCreated),
        endedAt: isoOrNull(call.endTime),
        forwardTo,
        recordingSid: recordingSid || undefined,
        recordingUrl: recordingUrl || undefined,
        recordingDurationSec: recordingDurationSec || undefined,
      });
      upserted += 1;

      const after = getPhoneCall(callSid);
      const hasRecording = Boolean(after?.recordingSid || after?.recordingUrl || recordingSid);
      const needsSummary =
        hasRecording &&
        after?.answered !== false &&
        !after?.summary &&
        !(prev?.summary);
      if (needsSummary) {
        enqueueSummarizePhoneCall(callSid);
        summarizedQueued += 1;
      }
    }
  }

  return {
    ok: true,
    upserted,
    summarizedQueued,
    sites: siteIds.length,
    siteIds,
    sinceDays: days,
  };
}

export function listPhoneCalls({ siteId = null, limit = 200 } = {}) {
  let rows = readAllCalls();
  if (siteId) rows = rows.filter((r) => r.siteId === siteId);
  rows.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  return rows.slice(0, Math.max(1, Math.min(1000, Number(limit) || 200)));
}

export function getPhoneCall(idOrSid) {
  const key = String(idOrSid || '').trim();
  return readAllCalls().find((r) => r.id === key || r.callSid === key) || null;
}

export function phoneCallStats({ siteId = null } = {}) {
  const rows = listPhoneCalls({ siteId, limit: 5000 });
  let answered = 0;
  let missed = 0;
  let talkSec = 0;
  let withSummary = 0;
  for (const r of rows) {
    if (r.answered === true) {
      answered += 1;
      talkSec += Number(r.durationSec || r.recordingDurationSec || 0) || 0;
    } else if (r.answered === false) missed += 1;
    if (r.summary) withSummary += 1;
  }
  const total = answered + missed;
  return {
    total,
    answered,
    missed,
    answerRate: total ? answered / total : 0,
    talkMinutes: Math.round((talkSec / 60) * 10) / 10,
    withSummary,
  };
}

async function fetchTranscriptForRecording(recordingSid) {
  const client = twilioClient();
  // Request a transcription; poll briefly for completion.
  let transcription;
  try {
    transcription = await client.recordings(recordingSid).transcriptions.create();
  } catch (error) {
    // Some accounts use Voice Intelligence only — fall back to listing existing
    const existing = await client.recordings(recordingSid).transcriptions.list({ limit: 1 });
    if (existing[0]) transcription = existing[0];
    else throw error;
  }
  const sid = transcription.sid;
  for (let i = 0; i < 20; i += 1) {
    const t = await client.transcriptions(sid).fetch();
    if (t.status === 'completed') return String(t.transcriptionText || '').trim();
    if (t.status === 'failed') {
      throw new Error('Twilio transcription failed');
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Twilio transcription timed out');
}

async function summarizeWithOpenAi(transcript, meta = {}) {
  const key = requireOpenAiKey();
  const model = env('OPENAI_PHONE_MODEL') || OPENAI_SUMMARY_MODEL;
  const siteLabel = meta.siteLabel || meta.siteId || 'ranking site';
  const userContent = `Summarize this phone call between a potential customer and a local business in 3–5 short sentences. Focus on: what the caller wanted, urgency, and next steps. Do not invent details.

Business / site: ${siteLabel}
From: ${meta.from || 'unknown'}

Transcript:
${transcript.slice(0, 24000)}`;

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      temperature: 0.2,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(
      `OpenAI HTTP ${response.status}: ${json?.error?.message || JSON.stringify(json).slice(0, 300)}`,
    );
  }
  const text = json.choices?.[0]?.message?.content;
  return String(text || '').trim();
}

/**
 * Transcribe + OpenAI (gpt-4o-mini) summary for an answered call with recording.
 */
export async function summarizePhoneCall(callSidOrId) {
  const row = getPhoneCall(callSidOrId);
  if (!row) {
    throw Object.assign(new Error('Call not found'), { status: 404 });
  }
  if (!row.recordingSid && !row.recordingUrl) {
    throw Object.assign(new Error('No recording on this call'), { status: 400 });
  }
  if (row.answered === false) {
    return upsertCall({
      callSid: row.callSid,
      error: 'Skipped summary — call not answered',
    });
  }

  try {
    let transcript = row.transcript || '';
    if (!transcript && row.recordingSid) {
      transcript = await fetchTranscriptForRecording(row.recordingSid);
    }
    if (!transcript) {
      throw new Error('Empty transcript');
    }
    const site = row.siteId ? listSites().find((s) => s.id === row.siteId) : null;
    const summary = await summarizeWithOpenAi(transcript, {
      siteId: row.siteId,
      siteLabel: site?.businessName || site?.niche || row.siteId,
      from: row.from,
    });
    return upsertCall({
      callSid: row.callSid,
      transcript,
      summary,
      summaryAt: new Date().toISOString(),
      error: null,
    });
  } catch (error) {
    return upsertCall({
      callSid: row.callSid,
      error: error.message || String(error),
    });
  }
}

/** Fire-and-forget summarize (does not throw to webhook). */
export function enqueueSummarizePhoneCall(callSidOrId) {
  setImmediate(() => {
    summarizePhoneCall(callSidOrId).catch((err) => {
      console.warn('[phone-calls] summarize failed:', err.message);
    });
  });
}

export async function getRecordingStream(callSidOrId) {
  const row = getPhoneCall(callSidOrId);
  if (!row?.recordingUrl && !row?.recordingSid) {
    throw Object.assign(new Error('No recording'), { status: 404 });
  }
  const sid = env('TWILIO_ACCOUNT_SID');
  const token = env('TWILIO_AUTH_TOKEN');
  let url = row.recordingUrl;
  if (!url && row.recordingSid) {
    url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Recordings/${row.recordingSid}.mp3`;
  }
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Twilio recording fetch failed (${response.status})`), {
      status: 502,
    });
  }
  const buf = Buffer.from(await response.arrayBuffer());
  return { buf, contentType: response.headers.get('content-type') || 'audio/mpeg', row };
}

export { CALLS_FILE };
