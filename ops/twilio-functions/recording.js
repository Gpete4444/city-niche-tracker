/**
 * Twilio Serverless Function: /recording
 * Relays recordingStatusCallback into Rover, then Rover enqueues OpenAI STT + summary.
 *
 * Env: ROVER_WEBHOOK_URL, ROVER_PHONE_WEBHOOK_SECRET
 */
const crypto = require('crypto');

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
    forward: event.forward || event.Forward || '',
  };

  postToRover(context, '/api/phone/webhooks/recording', payload)
    .then((result) => {
      callback(null, '');
      console.log('recording relay', result);
    })
    .catch((err) => {
      console.error('recording relay failed', err);
      callback(null, '');
    });
};
