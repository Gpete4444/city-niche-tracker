/**
 * Combined phone totals count only voicemail messages marked as a lead.
 */
import assert from 'node:assert/strict';
import { buildLeadRollup } from '../ops/lib/forms-rollup.mjs';
import { callCountsAsCombinedLead, callHasMessage } from '../ops/lib/phone-calls.mjs';

const now = Date.parse('2026-10-13T12:00:00.000Z');
const startedAt = '2026-10-12T15:00:00.000Z';

const message = {
  siteId: 'site-1',
  kind: 'voicemail',
  startedAt,
  summary: 'Homeowner wants a quote for a sinking slab.',
};
const unmarked = { ...message };
const marked = { ...message, lead: true };
const spamLead = {
  ...message,
  lead: true,
  summary: 'Caller pitched an SEO package.',
};
const empty = {
  siteId: 'site-1',
  kind: 'voicemail',
  startedAt,
  summary: 'No message was left.',
  lead: true,
};
const missed = {
  siteId: 'site-1',
  kind: '',
  startedAt,
  summary: 'They called back.',
  lead: true,
};

assert.equal(callHasMessage(message), true);
assert.equal(callHasMessage(empty), false);
assert.equal(callHasMessage({ ...message, kind: 'inbound' }), false);
assert.equal(callHasMessage(missed), false);
assert.equal(callCountsAsCombinedLead(unmarked), false);
assert.equal(callCountsAsCombinedLead(marked), true);
assert.equal(callCountsAsCombinedLead(spamLead), true);
assert.equal(callCountsAsCombinedLead(empty), false);
assert.equal(callCountsAsCombinedLead({ ...marked, lead: false }), false);

const rollup = buildLeadRollup({
  sites: [{ id: 'site-1', domain: 'example.com', candidateId: 'cand-1', businessName: 'Example' }],
  forms: [],
  calls: [unmarked, marked, spamLead, empty, missed].filter(callCountsAsCombinedLead),
  now,
});

assert.equal(rollup.totals.calls, 2);
assert.equal(rollup.totals.calls7d, 2);
assert.equal(rollup.sites[0].calls, 2);
assert.equal(rollup.sites[0].calls7d, 2);

function localDay(value) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const formDay = '2026-10-11T18:00:00.000Z';
const seriesRollup = buildLeadRollup({
  sites: [
    { id: 'site-1', domain: 'example.com', candidateId: 'cand-1', businessName: 'Example' },
    { id: 'site-2', domain: 'other.example', candidateId: 'cand-2', businessName: 'Other' },
  ],
  forms: [
    { domain: 'example.com', submittedAt: formDay },
    { domain: 'other.example', submittedAt: startedAt },
  ],
  calls: [unmarked, marked, spamLead, empty, missed].filter(callCountsAsCombinedLead),
  now,
});
const series = seriesRollup.series;
const formIndex = series.days.indexOf(localDay(formDay));
const callIndex = series.days.indexOf(localDay(startedAt));
assert.equal(series.days[0], localDay(formDay));
assert.equal(series.days.at(-1), localDay(now));
assert.ok(formIndex >= 0 && callIndex > formIndex);
assert.equal(series.bySite['site-1'].forms[formIndex], 1);
assert.equal(series.bySite['site-1'].forms.reduce((sum, n) => sum + n, 0), 1);
assert.equal(series.bySite['site-1'].calls[callIndex], 2);
assert.equal(series.bySite['site-1'].calls.reduce((sum, n) => sum + n, 0), 2);
assert.equal(series.bySite['site-1'].calls[formIndex], 0);
assert.equal(series.bySite['site-2'].forms.reduce((sum, n) => sum + n, 0), 1);
assert.equal(series.bySite['site-2'].calls.reduce((sum, n) => sum + n, 0), 0);
assert.equal(
  series.bySite['site-1'].calls.reduce((sum, n) => sum + n, 0) +
    series.bySite['site-1'].forms.reduce((sum, n) => sum + n, 0),
  seriesRollup.sites[0].calls + seriesRollup.sites[0].forms,
);

console.log('phone lead flag ok');
