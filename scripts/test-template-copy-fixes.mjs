/**
 * Small words, scope group labels, and location FAQ questions.
 * Run: node scripts/test-template-copy-fixes.mjs
 */
import { markdownToHtml } from 'satteri';
import { fixSmallWords } from '../src/lib/small-words.mjs';
import { parseLabeledBulletGroups } from '../src/lib/labeled-bullet-groups.mjs';
import { createBoldFaqQuestionPlugin } from '../src/lib/bold-faq-question.mjs';
import { polishServiceArticleHeading } from '../src/lib/service-article-heading.mjs';
import { linkifyProsePhones } from '../src/lib/linkify-prose-phone.mjs';
import { publicImageAlt } from '../src/lib/image-alt.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

assertEqual(fixSmallWords('Piering And Underpinning'), 'Piering and Underpinning', 'service name');
assertEqual(fixSmallWords('Backfill And Cleanup'), 'Backfill and Cleanup', 'step title');
assertEqual(fixSmallWords('And more'), 'And more', 'first word stays');
assertEqual(
  fixSmallWords("What's included with Piering And Underpinning"),
  "What's included with Piering and Underpinning",
  'heading',
);

const scope = parseLabeledBulletGroups(`**Typically included**: inspection, a written plan, and cleanup.

**Optional:**
- Interior drain tile add-on
- Wall anchor if bowing is found

**Customer prep:**
- Clear access to the basement
`);
assert(scope.intro.includes('Typically included'), 'included stays in the intro');
assert(!scope.intro.includes('Optional'), 'optional label leaves the intro');
assert(!scope.intro.includes('Customer prep'), 'prep label leaves the intro');
assertEqual(scope.groups.length, 2, 'two labeled groups');
assertEqual(scope.groups[0].label, 'Optional', 'optional label');
assertEqual(scope.groups[0].bullets.length, 2, 'optional bullets stay together');
assertEqual(scope.groups[1].label, 'Customer prep', 'prep label');
assertEqual(scope.groups[1].bullets.length, 1, 'prep bullet stays with its label');

const plugin = createBoldFaqQuestionPlugin();
const split = plugin.paragraph({
  type: 'paragraph',
  children: [{ type: 'text', value: 'Do older homes need a different repair?\nOften, yes.' }],
});
assertEqual(split.children[0].type, 'strong', 'question is bold');
assertEqual(split.children[0].children[0].value, 'Do older homes need a different repair?', 'question text');
assertEqual(split.children[1].type, 'break', 'answer starts on the next line');
assertEqual(
  plugin.paragraph({
    type: 'paragraph',
    children: [{ type: 'text', value: 'Is that crack new? Worth a look either way.' }],
  }),
  undefined,
  'same-line question stays',
);

const html = await markdownToHtml('Do older homes need a different repair?\nOften, yes.\n', {
  mdastPlugins: [createBoldFaqQuestionPlugin()],
});
const page = typeof html === 'string' ? html : html.html;
assert(page.includes('<strong>Do older homes need a different repair?</strong>'), 'rendered question is bold');
assert(page.includes('<br'), 'rendered answer breaks onto its own line');
assert(!page.includes('<strong>Is that crack new?</strong>'), 'plugin does not invent a same-line question');

assertEqual(
  polishServiceArticleHeading('How long does a Piering and Underpinning take?'),
  'How long does piering and underpinning take?',
  'service article heading',
);
assertEqual(
  polishServiceArticleHeading('What does a Commercial Foundation Repair cost in Midvale?'),
  'What does commercial foundation repair cost in Midvale?',
  'cost article heading',
);
assertEqual(
  polishServiceArticleHeading('How long does a haircut take?'),
  'How long does a haircut take?',
  'ordinary heading stays',
);

const phone = linkifyProsePhones(
  'Call [Midvale Foundation Pros](/contact) at +1 (385) 557-8453 or use the [contact form](/contact).',
  { businessName: 'Midvale Foundation Pros', phone: '+13855578453' },
);
assert(phone.includes('Midvale Foundation Pros at'), 'business name is plain text');
assert(!phone.includes('](/contact) at'), 'business name is not a contact link');
assert(phone.includes('[(385) 557-8453](tel:+13855578453)'), 'phone is a tel link');
assert(phone.includes('[contact form](/contact)'), 'contact form link stays');

const altCtx = {
  businessName: 'Midvale Foundation Pros',
  niche: 'Foundation Repair',
  city: 'Midvale',
  state: 'UT',
  serviceName: 'Piering And Underpinning',
  services: ['Foundation Repair', 'Piering And Underpinning'],
};
assertEqual(
  publicImageAlt('Hero photo', altCtx),
  'piering and underpinning in Midvale, UT',
  'service hero alt',
);
assertEqual(
  publicImageAlt('Hero photo', { ...altCtx, serviceName: '' }),
  'Midvale Foundation Pros foundation repair in Midvale, UT',
  'homepage hero alt',
);
assertEqual(
  publicImageAlt('Piering And Underpinning photo', { ...altCtx, serviceName: '' }),
  'piering and underpinning in Midvale, UT',
  'service slot alt',
);
assertEqual(
  publicImageAlt('Steel Push Piers photo', altCtx),
  'Steel Push Piers photo',
  'specific caption stays',
);

console.log('test-template-copy-fixes: ok');
