/**
 * Twilio Serverless Function: /inbound
 * Deploy to Twilio Functions; set service env:
 *   TWILIO_FORWARD_TO=+1…   (ranking default)
 *   ROVER_WEBHOOK_URL=https://…  (optional public Rover base, no trailing slash)
 *   ROVER_PHONE_WEBHOOK_SECRET=… (shared with Rover .env)
 *
 * Rover sets voiceUrl to:
 *   https://YOUR.twil.io/inbound?site=BusinessName&siteId=site_…&forward=+1…
 */
exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  const forwardTo = (event.forward || event.Forward || context.TWILIO_FORWARD_TO || '')
    .toString()
    .trim();
  const site = (event.site || event.Site || 'your ranking site').toString().slice(0, 80);
  const siteId = (event.siteId || event.SiteId || '').toString().trim();

  if (!forwardTo) {
    twiml.say('This line is not configured yet.');
    return callback(null, twiml);
  }

  const domain = context.DOMAIN_NAME;
  const statusQs = new URLSearchParams();
  if (siteId) statusQs.set('siteId', siteId);
  statusQs.set('forward', forwardTo);
  const statusPath = `/status?${statusQs.toString()}`;
  const recordingPath = `/recording?${statusQs.toString()}`;

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
