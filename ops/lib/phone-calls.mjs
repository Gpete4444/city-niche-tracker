/**
 * Append-only Twilio call log + summarize pipeline (OpenAI STT → OpenAI summary).
 * Storage: research/phone-calls.jsonl (one JSON object per line).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import twilio from 'twilio';
import { RESEARCH_DIR } from './candidates.mjs';
import { listSites, listSitesWithPhone } from './sites.mjs';
import { ensureRankingVoicemailUrls } from './phone-tracking-twilio.mjs';
import { ensureVoiceFunctionsDeployed } from './voicemail-greeting.mjs';
import { callIsSpam, loadSpamKeywords } from './spam-keywords.mjs';

const CALLS_FILE = path.join(RESEARCH_DIR, 'phone-calls.jsonl');
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_SUMMARY_MODEL = 'gpt-4o-mini';
const OPENAI_TRANSCRIBE_MODEL = 'whisper-1';
export const NO_MESSAGE_LEFT = 'No message was left.';

const FILLER_WORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'uh',
  'um',
  'hmm',
  'hi',
  'hey',
  'hello',
  'you',
  'thanks',
  'thank',
  'bye',
  'goodbye',
  'ok',
  'okay',
  'yeah',
  'yep',
]);

function transcriptWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the caller said something besides filler or the voicemail beep prompt. */
export function transcriptHasCallSubstance(transcript) {
  let words = transcriptWords(transcript);
  if (!words) return false;
  words = words
    .replace(/\bavailable at the tone\b/g, ' ')
    .replace(/\bat the tone\b/g, ' ')
    .replace(/\bplease record your message\b/g, ' ')
    .replace(/\brecord your message\b/g, ' ')
    .replace(/\bwhen you have finished recording you may hang up\b/g, ' ')
    .replace(/\bwhen you have finished recording\b/g, ' ')
    .replace(/\byou may hang up\b/g, ' ')
    .replace(/\byou may\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return false;
  const parts = words.split(' ').filter(Boolean);
  return parts.some((word) => !FILLER_WORDS.has(word));
}

function summaryFromModel(text) {
  const summary = String(text || '').trim();
  if (!summary || /^no message was left\.?$/i.test(summary)) return NO_MESSAGE_LEFT;
  return summary;
}

function env(name) {
  return String(process.env[name] || '').trim();
}

function requireOpenAiKey() {
  const key = env('OPENAI_API_KEY');
  if (!key) {
    throw Object.assign(
      new Error('Missing OPENAI_API_KEY — needed for phone transcripts and summaries'),
      { status: 400 },
    );
  }
  return key;
}

function ensureCallsFile() {
  mkdirSync(RESEARCH_DIR, { recursive: true });
  if (!existsSync(CALLS_FILE)) writeFileSync(CALLS_FILE, '', 'utf8');
}

let callsCache = { mtimeMs: 0, size: -1, rows: null };

function invalidateCallsCache() {
  callsCache = { mtimeMs: 0, size: -1, rows: null };
}

function readAllCalls() {
  ensureCallsFile();
  const st = statSync(CALLS_FILE);
  if (
    callsCache.rows &&
    callsCache.mtimeMs === st.mtimeMs &&
    callsCache.size === st.size
  ) {
    return callsCache.rows;
  }
  const text = readFileSync(CALLS_FILE, 'utf8');
  if (!text.trim()) {
    callsCache = { mtimeMs: st.mtimeMs, size: st.size, rows: [] };
    return callsCache.rows;
  }
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
  callsCache = { mtimeMs: st.mtimeMs, size: st.size, rows };
  return rows;
}

function rewriteAllCalls(rows) {
  ensureCallsFile();
  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  writeFileSync(CALLS_FILE, body ? `${body}\n` : '', 'utf8');
  invalidateCallsCache();
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
    kind: partial.kind !== undefined ? String(partial.kind || '') : prev.kind || '',
    error: partial.error !== undefined ? partial.error : prev.error || null,
    spamOverride:
      partial.spamOverride === true || partial.spamOverride === false
        ? partial.spamOverride
        : prev.spamOverride === true || prev.spamOverride === false
          ? prev.spamOverride
          : undefined,
    lead:
      partial.lead === true || partial.lead === false
        ? partial.lead
        : prev.lead === true || prev.lead === false
          ? prev.lead
          : undefined,
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
  const mode = String(body.mode || body.Mode || '').toLowerCase();
  const isVoicemail = mode === 'voicemail' || mode === 'ranking';
  const row = upsertCall({
    callSid,
    siteId,
    from: body.From || body.from || '',
    to: body.To || body.to || '',
    status: body.CallStatus || body.status || 'completed',
    answered: isVoicemail ? duration >= 1 : true,
    kind: isVoicemail && duration >= 1 ? 'voicemail' : '',
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

  try {
    await ensureVoiceFunctionsDeployed();
  } catch (error) {
    console.warn('[phone-calls] voice functions deploy:', error.message);
  }
  try {
    await ensureRankingVoicemailUrls();
  } catch (error) {
    console.warn('[phone-calls] ranking voicemail migrate:', error.message);
  }

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
      let answered = answeredFromDialStatus(status);
      const durationSec = Number(call.duration || 0) || 0;
      const forwardTo = site.phoneTracking?.forwardTo || '';
      const ranking = site.phoneTracking?.phase === 'ranking';

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
      if (ranking) {
        answered = recordingDurationSec >= 1;
      }
      upsertCall({
        callSid,
        siteId: site.id,
        from: call.from || '',
        to: call.to || e164,
        status: status || 'unknown',
        answered,
        kind: ranking && recordingDurationSec >= 1 ? 'voicemail' : ranking ? '' : prev?.kind || '',
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
  return flagCallSpam(rows.slice(0, Math.max(1, Math.min(1000, Number(limit) || 200))));
}

function flagCallSpam(rows) {
  const keywords = loadSpamKeywords();
  return rows.map((row) => ({ ...row, spam: callIsSpam(row, keywords) }));
}

export function getPhoneCall(idOrSid) {
  const key = String(idOrSid || '').trim();
  const row = readAllCalls().find((r) => r.id === key || r.callSid === key) || null;
  return row ? flagCallSpam([row])[0] : null;
}

/** True when the call is a voicemail that left a real message. */
export function callHasMessage(call) {
  if (String(call?.kind || '') !== 'voicemail') return false;
  const summary = String(call?.summary || '').trim();
  if (!summary) return false;
  return !/^no message was left\.?$/i.test(summary);
}

/** Combined phone totals count only messages explicitly marked as a lead. */
export function callCountsAsCombinedLead(call) {
  return call?.lead === true && callHasMessage(call);
}

export function setPhoneCallLead(idOrSid, lead) {
  if (lead !== true && lead !== false) {
    const err = new Error('lead must be true or false');
    err.status = 400;
    throw err;
  }
  const key = String(idOrSid || '').trim();
  const row = readAllCalls().find((item) => item.id === key || item.callSid === key) || null;
  if (!row?.callSid) {
    const err = new Error('Call not found');
    err.status = 404;
    throw err;
  }
  if (!callHasMessage(row)) {
    const err = new Error('Only voicemail messages can be marked as a lead');
    err.status = 400;
    throw err;
  }
  upsertCall({ callSid: row.callSid, lead });
  return getPhoneCall(key);
}

export function setPhoneCallSpam(idOrSid, spam) {
  if (spam !== true && spam !== false) {
    const err = new Error('spam must be true or false');
    err.status = 400;
    throw err;
  }
  const key = String(idOrSid || '').trim();
  const row = readAllCalls().find((item) => item.id === key || item.callSid === key) || null;
  if (!row?.callSid) {
    const err = new Error('Call not found');
    err.status = 404;
    throw err;
  }
  upsertCall({ callSid: row.callSid, spamOverride: spam });
  return getPhoneCall(key);
}

export function phoneCallStats({ siteId = null } = {}) {
  const rows = listPhoneCalls({ siteId, limit: 5000 }).filter((row) => !row.spam);
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

function twilioRecordingMp3Url(recordingSid, recordingUrl = '') {
  const sid = env('TWILIO_ACCOUNT_SID');
  const fromRow = String(recordingUrl || '').trim();
  if (fromRow) {
    return fromRow.replace(/\.(json|wav)(\?.*)?$/i, '.mp3$2');
  }
  const recSid = String(recordingSid || '').trim();
  if (!recSid || !sid) return '';
  return `https://api.twilio.com/2010-04-01/Accounts/${sid}/Recordings/${recSid}.mp3`;
}

async function fetchRecordingResponse({ recordingSid = '', recordingUrl = '' } = {}) {
  const sid = env('TWILIO_ACCOUNT_SID');
  const token = env('TWILIO_AUTH_TOKEN');
  if (!sid || !token) {
    throw Object.assign(new Error('Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN'), { status: 400 });
  }
  const url = twilioRecordingMp3Url(recordingSid, recordingUrl);
  if (!url) {
    throw Object.assign(new Error('No recording URL or SID'), { status: 400 });
  }
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!response.ok) {
    throw new Error(`Twilio recording download failed (${response.status})`);
  }
  return response;
}

async function downloadRecordingMp3({ recordingSid = '', recordingUrl = '' } = {}) {
  const response = await fetchRecordingResponse({ recordingSid, recordingUrl });
  const buf = Buffer.from(await response.arrayBuffer());
  if (!buf.length) {
    throw new Error('Twilio recording was empty');
  }
  return buf;
}

/**
 * Speech-to-text via OpenAI audio transcriptions (Whisper by default).
 * Twilio Recording Transcriptions API has no create() in the Node SDK — STT is OpenAI-only.
 */
async function transcribeRecordingAudio({ recordingSid = '', recordingUrl = '' } = {}) {
  const key = requireOpenAiKey();
  const model = env('OPENAI_PHONE_TRANSCRIBE_MODEL') || OPENAI_TRANSCRIBE_MODEL;
  const audio = await downloadRecordingMp3({ recordingSid, recordingUrl });
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'recording.mp3');
  form.append('model', model);
  const response = await fetch(OPENAI_TRANSCRIBE_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `OpenAI transcription HTTP ${response.status}: ${
        json?.error?.message || JSON.stringify(json).slice(0, 300)
      }`,
    );
  }
  const text = String(json.text || '').trim();
  if (!text) {
    throw new Error('Empty transcript from OpenAI');
  }
  return text;
}

async function summarizeWithOpenAi(transcript, meta = {}) {
  const key = requireOpenAiKey();
  const model = env('OPENAI_PHONE_MODEL') || OPENAI_SUMMARY_MODEL;
  const siteLabel = meta.siteLabel || meta.siteId || 'ranking site';
  const userContent = `Summarize this voicemail or phone call so an operator can act on it. Be concise and useful. Include only what the transcript states: who called, what they want, and any phone number or next step they gave.

Do not invent a job, urgency, appointment, quote, or callback. Do not use the business name to guess why they called. If the transcript has nothing of substance, reply with exactly: ${NO_MESSAGE_LEFT}

Business / site: ${siteLabel}
From: ${meta.from || 'unknown'}

Transcript:
${transcript.slice(0, 24000)}`;

  const response = await fetch(OPENAI_CHAT_URL, {
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
  return summaryFromModel(text);
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
    if (!transcript && (row.recordingSid || row.recordingUrl)) {
      transcript = await transcribeRecordingAudio({
        recordingSid: row.recordingSid,
        recordingUrl: row.recordingUrl,
      });
    }
    if (!transcript || !transcriptHasCallSubstance(transcript)) {
      return upsertCall({
        callSid: row.callSid,
        transcript: transcript || row.transcript || '',
        summary: NO_MESSAGE_LEFT,
        summaryAt: new Date().toISOString(),
        error: null,
      });
    }
    const site = row.siteId ? listSites().find((s) => s.id === row.siteId) : null;
    let summary = await summarizeWithOpenAi(transcript, {
      siteId: row.siteId,
      siteLabel: site?.businessName || site?.niche || row.siteId,
      from: row.from,
    });
    if (summary === NO_MESSAGE_LEFT) summary = String(transcript).trim();
    return upsertCall({
      callSid: row.callSid,
      transcript,
      summary,
      summaryAt: new Date().toISOString(),
      error: null,
    });
  } catch (error) {
    const message = error.message || String(error);
    if (/empty transcript/i.test(message)) {
      return upsertCall({
        callSid: row.callSid,
        summary: NO_MESSAGE_LEFT,
        summaryAt: new Date().toISOString(),
        error: null,
      });
    }
    return upsertCall({
      callSid: row.callSid,
      error: message,
    });
  }
}

/**
 * Overwrite invented summaries. Empty recordings get the note. Real messages are summarized again.
 */
export async function replaceInventedPhoneSummaries() {
  const rows = readAllCalls();
  let noted = 0;
  let resummarized = 0;
  for (const row of rows) {
    if (!row?.summary || !row.callSid) continue;
    if (!transcriptHasCallSubstance(row.transcript || '')) {
      if (row.summary === NO_MESSAGE_LEFT) continue;
      upsertCall({
        callSid: row.callSid,
        summary: NO_MESSAGE_LEFT,
        summaryAt: new Date().toISOString(),
        error: null,
      });
      noted += 1;
      continue;
    }
    await summarizePhoneCall(row.callSid);
    resummarized += 1;
  }
  return { noted, resummarized };
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
  try {
    const response = await fetchRecordingResponse({
      recordingSid: row.recordingSid,
      recordingUrl: row.recordingUrl,
    });
    return {
      webStream: response.body,
      contentType: 'audio/mpeg',
      contentLength: response.headers.get('content-length'),
      row,
    };
  } catch (error) {
    const status = /failed \(\d+\)/.test(error.message || '') ? 502 : error.status || 500;
    throw Object.assign(new Error(error.message || 'Twilio recording fetch failed'), { status });
  }
}

export { CALLS_FILE };
