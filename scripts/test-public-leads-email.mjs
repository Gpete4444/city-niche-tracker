/**
 * Public leads@ vs personal Gmail — Web3Forms recipient is the same address.
 * Run: node scripts/test-public-leads-email.mjs
 */
import { publicLeadsEmail } from '../ops/lib/site-config.mjs';

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

assertEqual(
  publicLeadsEmail('paulthiriot@gmail.com', 'sachseconcretelifting.com'),
  'leads@sachseconcretelifting.com',
  'personal Gmail becomes leads@domain',
);
assertEqual(
  publicLeadsEmail('', 'sachseconcretelifting.com'),
  'leads@sachseconcretelifting.com',
  'empty email becomes leads@domain',
);
assertEqual(
  publicLeadsEmail('leads@sachseconcretelifting.com', 'sachseconcretelifting.com'),
  'leads@sachseconcretelifting.com',
  'already-leads stays',
);
assertEqual(
  publicLeadsEmail('office@sachseconcretelifting.com', 'sachseconcretelifting.com'),
  'office@sachseconcretelifting.com',
  'custom domain mailbox stays',
);

console.log('test-public-leads-email: ok');
