/**
 * Lead rollup counts: zone/cluster sums match the header.
 * Run: node scripts/test-form-submissions.mjs
 */
import { buildLeadRollup } from '../ops/lib/forms-rollup.mjs';
import { collapseDuplicateFormSubmissions, normalizeLeadDomain } from '../ops/lib/form-submissions.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

assert(normalizeLeadDomain('https://www.Example.com/contact') === 'example.com', 'domain normalizes');

const now = Date.parse('2026-10-12T18:00:00.000Z');
const day = 24 * 60 * 60 * 1000;
const membership = new Map([
  [
    'cand-a',
    { clusterId: 'zone-1', clusterName: 'Dallas concrete', sgNumber: 4, clusterKey: 2 },
  ],
  ['cand-b', { clusterId: 'zone-1', clusterName: 'Dallas concrete', sgNumber: 4, clusterKey: 2 }],
]);

const rollup = buildLeadRollup({
  now,
  sites: [
    {
      id: 'site-a',
      candidateId: 'cand-a',
      businessName: 'Alpha',
      domain: 'www.alpha.example',
      phoneTracking: { phase: 'ranking' },
    },
    {
      id: 'site-b',
      candidateId: 'cand-b',
      businessName: 'Beta',
      domain: 'beta.example',
      phoneTracking: { phase: 'none' },
    },
  ],
  forms: [
    { id: '1', domain: 'alpha.example', submittedAt: new Date(now - day).toISOString() },
    { id: '2', domain: 'alpha.example', submittedAt: new Date(now - 10 * day).toISOString() },
    { id: '3', domain: 'beta.example', submittedAt: new Date(now - 2 * day).toISOString() },
  ],
  calls: [
    { siteId: 'site-a', startedAt: new Date(now - day).toISOString() },
    { siteId: 'site-a', createdAt: new Date(now - 20 * day).toISOString() },
    { siteId: 'site-b', startedAt: new Date(now - 3 * day).toISOString() },
  ],
  membership,
});

assert(rollup.totals.forms === 3, `forms total ${rollup.totals.forms}`);
assert(rollup.totals.forms7d === 2, `forms 7d ${rollup.totals.forms7d}`);
assert(rollup.totals.calls === 3, `calls total ${rollup.totals.calls}`);
assert(rollup.totals.calls7d === 2, `calls 7d ${rollup.totals.calls7d}`);

const alpha = rollup.sites.find((site) => site.id === 'site-a');
assert(alpha.forms === 2 && alpha.forms7d === 1, 'alpha form counts');
assert(alpha.calls === 2 && alpha.calls7d === 1, 'alpha call counts');
assert(alpha.zoneNumber === 4 && alpha.clusterKey === 2, 'zone and cluster attached');
assert(alpha.domain === 'alpha.example', 'www stripped on the site row');

const summed = rollup.sites.reduce(
  (sum, site) => {
    sum.forms += site.forms;
    sum.forms7d += site.forms7d;
    sum.calls += site.calls;
    sum.calls7d += site.calls7d;
    return sum;
  },
  { forms: 0, forms7d: 0, calls: 0, calls7d: 0 },
);
assert(summed.forms === rollup.totals.forms, 'header forms match sites');
assert(summed.forms7d === rollup.totals.forms7d, 'header forms 7d match sites');
assert(summed.calls === rollup.totals.calls, 'header calls match sites');
assert(summed.calls7d === rollup.totals.calls7d, 'header calls 7d match sites');

const lead = {
  domain: 'mckinneyconcretelifting.com',
  pageUrl: 'https://mckinneyconcretelifting.com/locations/mckinney/#lead-form',
  name: 'Virgil Ararao',
  phone: '214-250-6985',
  email: 'virgilararao@gmail.com',
  service: 'Polyurethane Foam Leveling',
  message: 'Uneven front porch step.',
};
const burst = collapseDuplicateFormSubmissions([
  { ...lead, id: 'sub_later', submittedAt: '2026-10-15T01:29:03.519Z' },
  { ...lead, id: 'sub_earlier', submittedAt: '2026-10-15T01:29:03.517Z' },
]);
assert(burst.rows.length === 1 && burst.rows[0].id === 'sub_earlier', '2ms pair keeps the earliest');
assert(burst.removedIds[0] === 'sub_later', '2ms pair drops the later id');

const marked = collapseDuplicateFormSubmissions([
  { ...lead, id: 'sub_earlier', submittedAt: '2026-10-15T01:29:03.517Z' },
  { ...lead, id: 'sub_later', submittedAt: '2026-10-15T01:29:03.519Z', spamOverride: true },
]);
assert(marked.rows[0].spamOverride === true, 'dropped spam override stays on the keeper');

const keptMark = collapseDuplicateFormSubmissions([
  { ...lead, id: 'sub_earlier', submittedAt: '2026-10-15T01:29:03.517Z', spamOverride: false },
  { ...lead, id: 'sub_later', submittedAt: '2026-10-15T01:29:03.519Z', spamOverride: true },
]);
assert(keptMark.rows[0].spamOverride === false, 'earliest override is left in place');

const laterInquiry = collapseDuplicateFormSubmissions([
  { ...lead, id: 'first', submittedAt: '2026-10-15T01:29:03.517Z' },
  { ...lead, id: 'second', submittedAt: '2026-10-15T01:32:03.517Z' },
]);
assert(laterInquiry.rows.length === 2 && laterInquiry.removedIds.length === 0, 'same text three minutes later stays');

const different = collapseDuplicateFormSubmissions([
  { ...lead, id: 'a', submittedAt: '2026-10-15T01:29:03.517Z' },
  { ...lead, id: 'b', submittedAt: '2026-10-15T01:29:03.519Z', message: 'Driveway crack.' },
]);
assert(different.rows.length === 2, 'different message stays');

console.log('form submission rollup ok');
