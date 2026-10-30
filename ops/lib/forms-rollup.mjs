/**
 * Zone → Cluster → Site counts for the Phone/Form combined view.
 * Totals are the sum of launched sites so the tree matches the header.
 */
import { shotgunMembershipByCandidateId } from './shotgun.mjs';
import { listLaunchedSites } from './sites.mjs';
import { callCountsAsCombinedLead, listPhoneCalls } from './phone-calls.mjs';
import {
  FORM_STATS_WINDOW_MS,
  callCountsForSite,
  callInstant,
  formCountsForDomain,
  listFormSubmissions,
  normalizeLeadDomain,
} from './form-submissions.mjs';

function calendarDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function nextCalendarDay(day) {
  const [year, month, date] = String(day || '').split('-').map(Number);
  if (!year || !month || !date) return '';
  const next = new Date(year, month - 1, date);
  next.setDate(next.getDate() + 1);
  return calendarDay(next);
}

/** Daily form and phone counts per site, from the first lead through today. */
export function buildLeadSeries({ sites = [], calls = [], forms = [], now = Date.now() } = {}) {
  const siteIdByDomain = new Map();
  for (const site of sites) {
    const domain = normalizeLeadDomain(site.domain);
    if (domain && site.id) siteIdByDomain.set(domain, site.id);
  }
  const bumps = new Map();
  const bump = (siteId, day, key) => {
    if (!siteId || !day) return;
    if (!bumps.has(siteId)) bumps.set(siteId, new Map());
    const days = bumps.get(siteId);
    const row = days.get(day) || { forms: 0, calls: 0 };
    row[key] += 1;
    days.set(day, row);
  };
  for (const call of calls) {
    bump(String(call?.siteId || ''), calendarDay(callInstant(call)), 'calls');
  }
  for (const form of forms) {
    bump(siteIdByDomain.get(normalizeLeadDomain(form?.domain)), calendarDay(form?.submittedAt), 'forms');
  }
  let first = '';
  let last = calendarDay(now);
  for (const days of bumps.values()) {
    for (const day of days.keys()) {
      if (!first || day < first) first = day;
      if (day > last) last = day;
    }
  }
  if (!first) return { days: [], bySite: {} };
  const dayList = [];
  for (let day = first; day && day <= last && dayList.length < 4000; day = nextCalendarDay(day)) {
    dayList.push(day);
  }
  const bySite = {};
  for (const [siteId, days] of bumps) {
    bySite[siteId] = {
      forms: dayList.map((day) => days.get(day)?.forms || 0),
      calls: dayList.map((day) => days.get(day)?.calls || 0),
    };
  }
  return { days: dayList, bySite };
}

export function buildLeadRollup({
  sites = [],
  calls = [],
  forms = [],
  membership = new Map(),
  now = Date.now(),
} = {}) {
  const siteRows = sites.map((site) => {
    const hit = site.candidateId ? membership.get(site.candidateId) : null;
    const domain = normalizeLeadDomain(site.domain);
    const formCounts = formCountsForDomain(forms, domain, now);
    const callCounts = callCountsForSite(calls, site.id, now);
    const zoneNumber = Number(hit?.sgNumber);
    return {
      id: site.id,
      candidateId: site.candidateId || '',
      businessName: site.businessName || site.niche || domain || site.id,
      city: site.city || '',
      state: site.state || '',
      niche: site.niche || '',
      domain,
      phase: site.phoneTracking?.phase && site.phoneTracking.phase !== 'none' ? site.phoneTracking.phase : '',
      lastLaunchAt: site.lastLaunchAt || null,
      zoneId: hit?.clusterId || '',
      zoneName: hit?.clusterName || '',
      zoneNumber: Number.isFinite(zoneNumber) && zoneNumber >= 1 ? zoneNumber : 0,
      clusterKey: Number(hit?.clusterKey) || 0,
      forms: formCounts.forms,
      forms7d: formCounts.forms7d,
      calls: callCounts.calls,
      calls7d: callCounts.calls7d,
    };
  });

  const totals = siteRows.reduce(
    (sum, site) => {
      sum.forms += site.forms;
      sum.forms7d += site.forms7d;
      sum.calls += site.calls;
      sum.calls7d += site.calls7d;
      return sum;
    },
    { forms: 0, forms7d: 0, calls: 0, calls7d: 0 },
  );

  return {
    totals,
    sites: siteRows,
    windowMs: FORM_STATS_WINDOW_MS,
    series: buildLeadSeries({ sites, calls, forms, now }),
  };
}

export function leadRollup(now = Date.now()) {
  return buildLeadRollup({
    sites: listLaunchedSites(),
    calls: listPhoneCalls({ limit: 10000 }).filter(callCountsAsCombinedLead),
    forms: listFormSubmissions({ limit: 10000 }).filter((row) => !row.spam),
    membership: shotgunMembershipByCandidateId(),
    now,
  });
}
