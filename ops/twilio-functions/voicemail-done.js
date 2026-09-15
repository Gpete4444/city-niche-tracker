/**
 * Twilio Serverless Function: /voicemail-done
 * Record action — thank the caller after they leave a message.
 */
exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  twiml.say('Thank you. Goodbye.');
  twiml.hangup();
  return callback(null, twiml);
};
