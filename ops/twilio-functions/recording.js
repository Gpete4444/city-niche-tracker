/**
 * Twilio Serverless Function: /recording
 * Relays recordingStatusCallback into Rover, then Rover enqueues OpenAI STT + summary.
 * Ranking voicemail: SMS TWILIO_FORWARD_TO from the ranking DID (skip empty recordings).
 *
 * Env: ROVER_WEBHOOK_URL, ROVER_PHONE_WEBHOOK_SECRET, TWILIO_FORWARD_TO
 */
const crypto = require('crypto');

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function sameE164(a, b) {
  const da = digits(a);
  const db = digits(b);
  if (!da || !db) return false;
  return da === db || da.endsWith(db) || db.endsWith(da);
}

function shouldSmsVoicemail(context, event) {
  const mode = String(event.mode || event.Mode || '').toLowerCase();
  if (mode === 'voicemail' || mode === 'ranking') return true;
  const forward = String(event.forward || event.Forward || '').trim();
  const notify = String(context.TWILIO_FORWARD_TO || '').trim();
  if (!forward) return true;
  if (notify && sameE164(forward, notify)) return true;
  return false;
}

function postToRover(context, path, payload) {
  const base = String(context.ROVER_WEBHOOK_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const secret = String(context.ROVER_PHONE_WEBHOOK_SECRET || '').trim();
  if (!base || !secret) {
    return Promise.resolve({ skipped: true, reason: 'ROVER_WEBHOOK_URL or secret missing' });
  }
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-rover-phone-secret': secret,
      'x-rover-phone-signature': signature,
    },
    body,
  }).then(async (res) => {
    const text = await res.text();
    return { status: res.status, text: text.slice(0, 500) };
  });
}

function sendVoicemailSms(context, event) {
  if (!shouldSmsVoicemail(context, event)) {
    return Promise.resolve({ skipped: true, reason: 'not voicemail' });
  }
  const duration = Number(event.RecordingDuration || event.recordingDuration || 0) || 0;
  if (duration < 1) {
    return Promise.resolve({ skipped: true, reason: 'empty recording' });
  }
  const to = String(context.TWILIO_FORWARD_TO || '').trim();
  if (!to) {
    return Promise.resolve({ skipped: true, reason: 'TWILIO_FORWARD_TO missing' });
  }
  const fromDid = String(event.To || event.Called || '').trim();
  if (!fromDid) {
    return Promise.resolve({ skipped: true, reason: 'no ranking DID on To' });
  }
  const site = String(event.site || event.Site || 'a ranking site').slice(0, 80);
  const caller = String(event.From || event.from || 'unknown');
  const client = context.getTwilioClient();
  return client.messages
    .create({
      to,
      from: fromDid,
      body: `Rover voicemail for ${site}: ${caller} left a ${duration}s message. Open Phone in Rover to listen.`,
    })
    .then((msg) => ({ ok: true, sid: msg.sid }))
    .catch((err) => {
      console.error('voicemail SMS failed', err);
      return { ok: false, error: err?.message || String(err) };
    });
}

exports.handler = function (context, event, callback) {
  const payload = {
    CallSid: event.CallSid,
    RecordingSid: event.RecordingSid,
    RecordingUrl: event.RecordingUrl,
    RecordingDuration: event.RecordingDuration,
    RecordingStatus: event.RecordingStatus,
    CallStatus: event.CallStatus,
    From: event.From,
    To: event.To,
    siteId: event.siteId || event.SiteId || '',
    site: event.site || event.Site || '',
    forward: event.forward || event.Forward || '',
    mode: event.mode || event.Mode || '',
  };

  Promise.all([
    postToRover(context, '/api/phone/webhooks/recording', payload),
    sendVoicemailSms(context, event),
  ])
    .then((result) => {
      callback(null, '');
      console.log('recording relay', result);
    })
    .catch((err) => {
      console.error('recording relay failed', err);
      callback(null, '');
    });
};
