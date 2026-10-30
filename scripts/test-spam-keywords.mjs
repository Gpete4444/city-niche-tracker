/**
 * Spam phrases flag SEO-style form leads and summarized calls, and those
 * rows stay out of the Phone/Form totals.
 */
import assert from 'node:assert/strict';
import { buildLeadRollup } from '../ops/lib/forms-rollup.mjs';
import { callIsSpam, formIsSpam } from '../ops/lib/spam-keywords.mjs';

const keywords = ['seo', 'website improvement', 'xfinity', 'angie', 'angi', 'usbusinessonline'];
const now = Date.parse('2026-10-13T12:00:00.000Z');
const submittedAt = '2026-10-12T15:00:00.000Z';

const seoOffer = {
  domain: 'example.com',
  submittedAt,
  name: 'Growth Desk',
  email: 'hello@rank-offer.example',
  phone: '555-0100',
  service: 'Other / Not sure',
  message: 'We can help with SEO and website improvement for your business.',
};
const homeowner = {
  domain: 'example.com',
  submittedAt,
  name: 'Jane Homeowner',
  email: 'jane@gmail.com',
  phone: '555-0199',
  service: 'Concrete lifting',
  message: 'The driveway is sinking near the garage.',
};

assert.equal(formIsSpam(seoOffer, keywords), true);
assert.equal(formIsSpam(homeowner, keywords), false);
assert.equal(formIsSpam({ ...homeowner, message: 'We are changing the garage floor.' }, keywords), false);
assert.equal(formIsSpam({ ...homeowner, message: 'This is Angie with Angi.' }, keywords), true);
assert.equal(formIsSpam({ ...homeowner, message: 'Please call about Xfinity' }, keywords), true);
assert.equal(formIsSpam({ ...homeowner, email: 'sales@usbusinessonline.com' }, keywords), true);
assert.equal(formIsSpam({ ...seoOffer, spamOverride: false }, keywords), false);
assert.equal(formIsSpam({ ...homeowner, spamOverride: true }, keywords), true);

const seoCall = {
  siteId: 'site-1',
  startedAt: submittedAt,
  summary: 'Caller pitched an SEO package.',
  transcript: 'We improve websites.',
};
const homeownerCall = {
  siteId: 'site-1',
  startedAt: submittedAt,
  summary: 'Homeowner wants a quote for a sinking slab.',
  transcript: 'The garage floor is uneven.',
};
const unsummarized = { siteId: 'site-1', startedAt: submittedAt, summary: '', transcript: '' };

assert.equal(callIsSpam(seoCall, keywords), true);
assert.equal(callIsSpam(homeownerCall, keywords), false);
assert.equal(callIsSpam(unsummarized, keywords), false);
assert.equal(callIsSpam({ ...unsummarized, transcript: 'This is Angie from the list.' }, keywords), true);
assert.equal(callIsSpam({ ...seoCall, spamOverride: false }, keywords), false);
assert.equal(callIsSpam({ ...homeownerCall, spamOverride: true }, keywords), true);

const keptSeo = { ...seoOffer, spamOverride: false };
const markedHomeowner = { ...homeowner, id: 'home-spam', spamOverride: true };
const keptSeoCall = { ...seoCall, spamOverride: false };
const markedHomeownerCall = { ...homeownerCall, spamOverride: true };

const rollup = buildLeadRollup({
  sites: [{ id: 'site-1', domain: 'example.com', candidateId: 'cand-1', businessName: 'Example' }],
  forms: [seoOffer, homeowner, keptSeo, markedHomeowner].filter((row) => !formIsSpam(row, keywords)),
  calls: [seoCall, homeownerCall, unsummarized, keptSeoCall, markedHomeownerCall].filter(
    (row) => !callIsSpam(row, keywords),
  ),
  now,
});

assert.equal(rollup.totals.forms, 2);
assert.equal(rollup.totals.forms7d, 2);
assert.equal(rollup.totals.calls, 3);
assert.equal(rollup.sites[0].forms, 2);
assert.equal(rollup.sites[0].calls, 3);

console.log('spam keyword filter ok');
