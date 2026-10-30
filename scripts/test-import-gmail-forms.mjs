/**
 * Parser for past Web3Forms emails.
 * Run: node scripts/test-import-gmail-forms.mjs
 */
import { leadFromMail, parseWeb3FormsBody } from '../ops/lib/import-gmail-forms.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

const sites = [
  { domain: 'seagovilleconcretelifting.com', businessName: 'Seagoville Concrete Lifting' },
  { domain: 'spanishfork.example', businessName: 'Kitchen and Bathroom Remodeling in Spanish Fork, UT' },
];

const colonBody = `
Name: Jane Doe
Phone: (214) 555-0199
Email: jane@example.com
Service: Concrete Leveling
Message: The porch is sinking near the steps.

This message was sent from https://seagovilleconcretelifting.com/contact/
`;

const stackedBody = `
Name
Jane Doe

Email
jane@example.com

Phone
214-555-0100

What do you need?
Foundation repair

Details
A corner of the driveway dropped.
`;

const colon = parseWeb3FormsBody(colonBody);
assert(colon.name === 'Jane Doe', 'colon name');
assert(colon.phone === '(214) 555-0199', 'colon phone');
assert(colon.email === 'jane@example.com', 'colon email');
assert(colon.service === 'Concrete Leveling', 'colon service');
assert(colon.message.includes('porch is sinking'), 'colon message');

const stacked = parseWeb3FormsBody(stackedBody);
assert(stacked.name === 'Jane Doe', 'stacked name');
assert(stacked.service === 'Foundation repair', 'stacked service');
assert(stacked.message.includes('driveway dropped'), 'stacked message');

const lead = leadFromMail(
  {
    id: 'abc123',
    subject: 'Lead: Seagoville Concrete Lifting',
    text: colonBody,
    internalDate: String(Date.parse('2026-08-01T15:00:00.000Z')),
  },
  sites,
);
assert(lead?.id === 'gmail_abc123', 'gmail id');
assert(lead?.domain === 'seagovilleconcretelifting.com', 'matched domain');
assert(lead?.pageUrl.includes('seagovilleconcretelifting.com/contact'), 'page url');
assert(lead?.submittedAt.startsWith('2026-08-01'), 'submitted at');

const byName = leadFromMail(
  {
    id: 'def456',
    subject: 'Lead: Kitchen & Bathroom Remodeling in Spanish Fork, UT',
    text: stackedBody,
    internalDate: String(Date.parse('2026-07-01T12:00:00.000Z')),
  },
  [{ domain: 'spanishforkremodel.com', businessName: 'Kitchen & Bathroom Remodeling in Spanish Fork, UT' }],
);
assert(byName?.domain === 'spanishforkremodel.com', 'matched business name');

const skipped = leadFromMail(
  { id: 'nope', subject: 'Hello', text: 'Name: Pat\nEmail: pat@example.com', internalDate: '1' },
  sites,
);
assert(skipped === null, 'unmatched mail is skipped');

console.log('gmail form import parser ok');
