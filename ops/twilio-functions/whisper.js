/**
 * Twilio Serverless Function: /whisper
 * Plays only to the person answering (not the caller), then connects.
 */
exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  const site = (event.site || event.Site || 'your ranking site').toString().slice(0, 80);
  twiml.say(`Call from ${site}.`);
  return callback(null, twiml);
};
