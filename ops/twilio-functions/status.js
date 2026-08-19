/**
 * Twilio Serverless Function: /status
 * Relays Dial / call status callbacks into Rover (HMAC + shared secret).
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
    CallSid: event.CallSid || event.ParentCallSid,
    ParentCallSid: event.ParentCallSid,
    DialCallStatus: event.DialCallStatus,
    CallStatus: event.CallStatus,
    DialCallDuration: event.DialCallDuration,
    CallDuration: event.CallDuration,
    From: event.From,
    To: event.To,
    Called: event.Called,
    Timestamp: event.Timestamp,
    siteId: event.siteId || event.SiteId || '',
    forward: event.forward || event.Forward || '',
  };

  postToRover(context, '/api/phone/webhooks/status', payload)
    .then((result) => {
      // Dial action expects TwiML; empty response is fine after dial completes.
      const twiml = new Twilio.twiml.VoiceResponse();
      callback(null, twiml);
      console.log('status relay', result);
    })
    .catch((err) => {
      console.error('status relay failed', err);
      const twiml = new Twilio.twiml.VoiceResponse();
      callback(null, twiml);
    });
};
