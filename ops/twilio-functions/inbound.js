/**
 * Twilio Serverless Function: /inbound
 * Deploy to Twilio Functions; set service env:
 *   TWILIO_FORWARD_TO=+1…   (SMS notify + legacy ranking Dial match)
 *   TWILIO_VOICEMAIL_GREETING_URL=https://…/voicemail-greeting.mp3  (optional Play)
 *   TWILIO_VOICEMAIL_FALLBACK_URL=https://…/voicemail-fallback.txt  (optional; else /voicemail-fallback.txt)
 *   ROVER_WEBHOOK_URL=https://…  (optional public Rover base, no trailing slash)
 *   ROVER_PHONE_WEBHOOK_SECRET=… (shared with Rover .env)
 *
 * Rover sets voiceUrl to:
 *   ranking: https://YOUR.twil.io/inbound?site=BusinessName&siteId=site_…&mode=voicemail
 *   rented:  https://YOUR.twil.io/inbound?site=BusinessName&siteId=site_…&forward=+1…
 *
 * Spoken fallback is a public Asset (not a Function env value — those max out at 100 chars).
 */
const DEFAULT_FALLBACK =
  "You've reached {site}. Please leave your name, number, and a brief message after the tone.";

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function sameE164(a, b) {
  const da = digits(a);
  const db = digits(b);
  if (!da || !db) return false;
  return da === db || da.endsWith(db) || db.endsWith(da);
}

function isVoicemailMode(event, context, forwardTo) {
  const mode = String(event.mode || event.Mode || '').toLowerCase();
  if (mode === 'voicemail' || mode === 'ranking') return true;
  if (mode === 'dial') return false;
  const notify = String(context.TWILIO_FORWARD_TO || '').trim();
  if (forwardTo && notify && sameE164(forwardTo, notify)) return true;
  if (!forwardTo) return true;
  return false;
}

function attachRecord(twiml, domain, recordingPath) {
  twiml.record({
    playBeep: true,
    timeout: 5,
    maxLength: 120,
    action: `https://${domain}/voicemail-done`,
    method: 'POST',
    recordingStatusCallback: `https://${domain}${recordingPath}`,
    recordingStatusCallbackMethod: 'POST',
    recordingStatusCallbackEvent: 'completed',
  });
}

function sayFallbackAndRecord(twiml, site, text, domain, recordingPath, callback) {
  const raw = String(text || DEFAULT_FALLBACK).trim().slice(0, 500) || DEFAULT_FALLBACK;
  twiml.say(raw.replace(/\{site\}/gi, site));
  attachRecord(twiml, domain, recordingPath);
  return callback(null, twiml);
}

exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  const forwardTo = (event.forward || event.Forward || '').toString().trim();
  const site = (event.site || event.Site || 'your ranking site').toString().slice(0, 80);
  const siteId = (event.siteId || event.SiteId || '').toString().trim();
  const voicemail = isVoicemailMode(event, context, forwardTo);

  const domain = context.DOMAIN_NAME;
  const statusQs = new URLSearchParams();
  if (siteId) statusQs.set('siteId', siteId);
  if (site) statusQs.set('site', site);
  if (voicemail) statusQs.set('mode', 'voicemail');
  if (forwardTo) statusQs.set('forward', forwardTo);
  const statusPath = `/status?${statusQs.toString()}`;
  const recordingPath = `/recording?${statusQs.toString()}`;

  if (voicemail) {
    const greetingUrl = String(context.TWILIO_VOICEMAIL_GREETING_URL || '').trim();
    if (greetingUrl) {
      twiml.play(greetingUrl);
      attachRecord(twiml, domain, recordingPath);
      return callback(null, twiml);
    }
    const fallbackUrl = String(context.TWILIO_VOICEMAIL_FALLBACK_URL || '').trim()
      || `https://${domain}/voicemail-fallback.txt`;
    fetch(fallbackUrl)
      .then((res) => (res.ok ? res.text() : ''))
      .then((text) => sayFallbackAndRecord(twiml, site, text, domain, recordingPath, callback))
      .catch(() => sayFallbackAndRecord(twiml, site, DEFAULT_FALLBACK, domain, recordingPath, callback));
    return;
  }

  if (!forwardTo) {
    twiml.say('This line is not configured yet.');
    return callback(null, twiml);
  }

  const dialOpts = {
    record: 'record-from-answer',
    action: `https://${domain}${statusPath}`,
    method: 'POST',
    recordingStatusCallback: `https://${domain}${recordingPath}`,
    recordingStatusCallbackMethod: 'POST',
    recordingStatusCallbackEvent: 'completed',
  };

  const dial = twiml.dial(dialOpts);

  dial.number(
    {
      url: `https://${domain}/whisper?site=${encodeURIComponent(site)}`,
      statusCallback: `https://${domain}${statusPath}`,
      statusCallbackEvent: 'initiated ringing answered completed',
      statusCallbackMethod: 'POST',
    },
    forwardTo,
  );

  return callback(null, twiml);
};
