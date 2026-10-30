/**
 * Phone summaries stay empty when the recording has nothing of substance.
 * Run: node scripts/test-phone-summary-substance.mjs
 */
import {
  NO_MESSAGE_LEFT,
  transcriptHasCallSubstance,
} from '../ops/lib/phone-calls.mjs';

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

assertEqual(NO_MESSAGE_LEFT, 'No message was left.', 'note text');
assertEqual(transcriptHasCallSubstance(''), false, 'empty');
assertEqual(transcriptHasCallSubstance('you'), false, 'you');
assertEqual(transcriptHasCallSubstance('Thank you.'), false, 'thank you');
assertEqual(transcriptHasCallSubstance('Bye.'), false, 'bye');
assertEqual(transcriptHasCallSubstance('. .'), false, 'dots');
assertEqual(transcriptHasCallSubstance('And... Bye. Bye. Bye. Bye.'), false, 'bye run');
assertEqual(
  transcriptHasCallSubstance('At the tone, please record your message.'),
  false,
  'beep prompt',
);
assertEqual(
  transcriptHasCallSubstance(
    'Available at the tone. Please record your message when you have finished recording you may',
  ),
  false,
  'truncated beep prompt',
);
assertEqual(
  transcriptHasCallSubstance(
    'Hello, this is Linda Shipp. We need to have a back patio and pool deck looked at.',
  ),
  true,
  'patio voicemail',
);
assertEqual(
  transcriptHasCallSubstance('Ava Martinez from USBusinessOnline.com'),
  true,
  'name only still has substance',
);

console.log('test-phone-summary-substance: ok');
