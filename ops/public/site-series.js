/**
 * Calendar-aligned launched-site series for Launched charts.
 * Missing data is omitted from the axis, never plotted as zero.
 */
export const SITE_SERIES_MAX_DAYS = 90;
export const INSPECT_HISTORY_RETENTION = 104;
/** GSC Search Analytics is usually final after 2–3 days. Last 3 UTC days (through yesterday) are incomplete. */
export const GSC_INCOMPLETE_DAYS = 3;

export function isoDay(value) {
  if (value == null || value === '') return '';
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const [year, month, date] = String(day || '').split('-').map(Number);
  if (!year || !month || !date) return '';
  const next = new Date(Date.UTC(year, month - 1, date));
  next.setUTCDate(next.getUTCDate() + Number(n) || 0);
  return next.toISOString().slice(0, 10);
}

export function calendarDays(first, last, max = 400) {
  if (!first || !last || first > last) return [];
  const days = [];
  for (let day = first; day && day <= last && days.length < max; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

export function sliceLastDays(days, rangeDays = SITE_SERIES_MAX_DAYS) {
  const n = Math.max(1, Number(rangeDays) || SITE_SERIES_MAX_DAYS);
  const list = Array.isArray(days) ? days : [];
  if (list.length <= n) return list;
  return list.slice(list.length - n);
}

/** First UTC day that is still landing in Search Console (today − 3 → through yesterday). */
export function gscIncompleteStart(todayIso) {
  const today = isoDay(todayIso || new Date());
  if (!today) return '';
  return addDays(today, -GSC_INCOMPLETE_DAYS);
}

/**
 * Split a GSC series at `start` so the chart can draw a solid complete segment
 * and a dotted incomplete tail. Arrays share the last complete point so the
 * dashed path continues from the solid one. Days before `start` stay complete.
 */
export function splitGscCompleteIncomplete(values, days, start) {
  const list = Array.isArray(values) ? values : [];
  const dates = Array.isArray(days) ? days : [];
  const n = Math.max(list.length, dates.length);
  const complete = Array(n).fill(null);
  const incomplete = Array(n).fill(null);
  const valueAt = (i) => (i < list.length ? list[i] : null);
  if (!start) {
    for (let i = 0; i < n; i += 1) complete[i] = valueAt(i);
    return { complete, incomplete };
  }
  let lastComplete = -1;
  let hasIncompleteDay = false;
  for (let i = 0; i < n; i += 1) {
    const day = dates[i] || '';
    const value = valueAt(i);
    if (day && day < start) {
      complete[i] = value;
      lastComplete = i;
    } else {
      incomplete[i] = value;
      hasIncompleteDay = true;
    }
  }
  if (hasIncompleteDay && lastComplete >= 0) incomplete[lastComplete] = complete[lastComplete];
  return { complete, incomplete };
}

export function windowTotalsFromDaily(daily, days = 7) {
  const rows = (Array.isArray(daily) ? daily : [])
    .map((row) => ({
      date: isoDay(row?.date),
      clicks: Number(row?.clicks) || 0,
      impressions: Number(row?.impressions) || 0,
    }))
    .filter((row) => row.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) return { clicks: 0, impressions: 0 };
  const end = rows[rows.length - 1].date;
  const start = addDays(end, -(Math.max(1, Number(days) || 7) - 1));
  let clicks = 0;
  let impressions = 0;
  for (const row of rows) {
    if (row.date < start || row.date > end) continue;
    clicks += row.clicks;
    impressions += row.impressions;
  }
  return { clicks, impressions };
}

export function siteChartLabel(site) {
  return String(site?.businessName || site?.domain || site?.city || site?.id || 'site').trim() || 'site';
}

export function hasGscSeries(site) {
  const last = site?.metrics?.gsc?.lastSyncAt || site?.gscLastSyncAt;
  const err = site?.metrics?.gsc?.syncError || site?.gscSyncError;
  return Boolean(last) && !err;
}

export function inspectSnapshots(site) {
  const gsc = site?.metrics?.gsc || {};
  const hist = Array.isArray(gsc.inspectHistory) ? gsc.inspectHistory : [];
  const points = hist
    .map((point) => ({
      checkedAt: isoDay(point?.checkedAt),
      indexed: Number(point?.indexed) || 0,
      submitted: Number(point?.submitted) || 0,
      notIndexed: Number(point?.notIndexed) || 0,
    }))
    .filter((point) => point.checkedAt)
    .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));
  if (points.length) return points;
  const checkedAt = isoDay(gsc.inspectCheckedAt || site?.inspectCheckedAt);
  if (!checkedAt) return [];
  const indexedRaw = gsc.inspectIndexed ?? site?.inspectIndexed;
  const submittedRaw = gsc.inspectSubmitted ?? site?.inspectSubmitted;
  if (indexedRaw == null && submittedRaw == null) return [];
  const indexed = Number(indexedRaw) || 0;
  const submitted = Number(submittedRaw) || 0;
  return [
    {
      checkedAt,
      indexed,
      submitted,
      notIndexed: Number(gsc.inspectNotIndexed ?? site?.inspectNotIndexed) || Math.max(0, submitted - indexed),
    },
  ];
}

export function hasIndexSeries(site) {
  return inspectSnapshots(site).length > 0;
}

export function distinctInspectDays(sites) {
  const days = new Set();
  for (const site of Array.isArray(sites) ? sites : []) {
    for (const snap of inspectSnapshots(site)) {
      if (snap.checkedAt) days.add(snap.checkedAt);
    }
  }
  return days.size;
}

export function primaryRankHistory(site) {
  const metrics = site?.metrics;
  const keywords = metrics?.rankKeywords || site?.rankKeywords || [];
  const primary = keywords.find((row) => row && row.isPrimary) || keywords[0];
  if (!primary?.keyword) return [];
  const hist = metrics?.ranks?.byKeyword?.[primary.keyword]?.history || [];
  return hist
    .map((point) => ({
      checkedAt: isoDay(point?.checkedAt),
      page: point?.page == null ? null : Number(point.page),
      position: point?.position == null ? null : Number(point.position),
    }))
    .filter((point) => point.checkedAt)
    .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));
}

export function hasRankSeries(site) {
  return primaryRankHistory(site).length > 0;
}

export function appendInspectHistory(history, snapshot, max = INSPECT_HISTORY_RETENTION) {
  const checkedAtRaw = snapshot?.checkedAt || new Date().toISOString();
  const day = isoDay(checkedAtRaw);
  if (!day) return Array.isArray(history) ? [...history] : [];
  const point = {
    checkedAt: String(checkedAtRaw).length > 10 ? String(checkedAtRaw) : `${day}T12:00:00.000Z`,
    indexed: Number(snapshot?.indexed) || 0,
    submitted: Number(snapshot?.submitted) || 0,
    notIndexed: Number(snapshot?.notIndexed) || 0,
  };
  const next = (Array.isArray(history) ? history : []).filter((row) => isoDay(row?.checkedAt) !== day);
  next.push(point);
  next.sort((a, b) => String(a.checkedAt).localeCompare(String(b.checkedAt)));
  if (next.length <= max) return next;
  return next.slice(next.length - max);
}

function gscDailyMap(site) {
  const daily = site?.metrics?.gsc?.daily || [];
  const map = new Map();
  for (const row of daily) {
    const date = isoDay(row?.date);
    if (!date) continue;
    map.set(date, {
      clicks: Number(row?.clicks) || 0,
      impressions: Number(row?.impressions) || 0,
    });
  }
  return map;
}

function gscWindow(site) {
  const lastSync = isoDay(site?.metrics?.gsc?.lastSyncAt || site?.gscLastSyncAt);
  const dates = [...gscDailyMap(site).keys()].sort();
  const maxDaily = dates[dates.length - 1] || '';
  const minDaily = dates[0] || '';
  const end = maxDaily || lastSync;
  if (!end) return null;
  const startFromSync = addDays(end, -89);
  const start = minDaily && minDaily < startFromSync ? minDaily : startFromSync;
  return { start, end };
}

function impressionDates(site) {
  const dates = [];
  for (const [date, row] of gscDailyMap(site)) {
    if ((row.impressions || 0) > 0 || (row.clicks || 0) > 0) dates.push(date);
  }
  return dates.sort();
}

function forwardFill(points, days, pick) {
  const out = days.map(() => null);
  if (!points.length) return out;
  let index = 0;
  let last = null;
  for (let i = 0; i < days.length; i += 1) {
    const day = days[i];
    while (index < points.length && points[index].checkedAt <= day) {
      last = points[index];
      index += 1;
    }
    out[i] = last ? pick(last) : null;
  }
  return out;
}

function checkDayFlags(points, days) {
  const seen = new Set((points || []).map((point) => point.checkedAt).filter(Boolean));
  return days.map((day) => (seen.has(day) ? 1 : 0));
}

function coveragePack(sites, test, action) {
  const included = [];
  const excluded = [];
  for (const site of sites) {
    if (!site?.id) continue;
    if (test(site)) included.push(site.id);
    else excluded.push({ id: site.id, name: siteChartLabel(site), action });
  }
  return { included, excluded };
}

export function coverageForSites(sites) {
  const list = Array.isArray(sites) ? sites : [];
  return {
    gsc: coveragePack(list, hasGscSeries, 'Sync GSC'),
    ranks: coveragePack(list, hasRankSeries, 'Check ranks'),
    indexed: coveragePack(list, hasIndexSeries, 'Check index'),
  };
}

function emptyDayArray(days) {
  return days.map(() => null);
}

export function buildSiteMetricsSeries(sites, { rangeDays = SITE_SERIES_MAX_DAYS } = {}) {
  const list = Array.isArray(sites) ? sites : [];
  const coverage = coverageForSites(list);
  let first = '';
  let last = '';
  const consider = (day) => {
    if (!day) return;
    if (!first || day < first) first = day;
    if (!last || day > last) last = day;
  };
  for (const site of list) {
    if (hasGscSeries(site)) {
      for (const day of impressionDates(site)) consider(day);
    }
    if (hasRankSeries(site)) {
      const hist = primaryRankHistory(site);
      if (hist.length) {
        consider(hist[0].checkedAt);
        consider(hist[hist.length - 1].checkedAt);
      }
    }
    if (hasIndexSeries(site)) {
      const snaps = inspectSnapshots(site);
      if (snaps.length) {
        consider(snaps[0].checkedAt);
        consider(snaps[snaps.length - 1].checkedAt);
      }
    }
  }
  const days = sliceLastDays(calendarDays(first, last), rangeDays);
  const bySite = {};
  for (const site of list) {
    const id = site?.id;
    if (!id) continue;
    const gscOk = hasGscSeries(site);
    const rankOk = hasRankSeries(site);
    const indexOk = hasIndexSeries(site);
    const daily = gscDailyMap(site);
    const win = gscOk ? gscWindow(site) : null;
    const clicks = [];
    const impressions = [];
    const hasImpressions = [];
    for (const day of days) {
      if (!gscOk || !win || day < win.start || day > win.end) {
        clicks.push(null);
        impressions.push(null);
        hasImpressions.push(null);
        continue;
      }
      const row = daily.get(day) || { clicks: 0, impressions: 0 };
      clicks.push(row.clicks);
      impressions.push(row.impressions);
      hasImpressions.push(row.impressions > 0 ? 1 : 0);
    }
    const rankHist = rankOk ? primaryRankHistory(site) : [];
    const snaps = indexOk ? inspectSnapshots(site) : [];
    bySite[id] = {
      hasGsc: gscOk,
      hasRank: rankOk,
      hasIndex: indexOk,
      clicks,
      impressions,
      hasImpressions,
      page1: rankOk ? forwardFill(rankHist, days, (point) => (point.page === 1 ? 1 : 0)) : emptyDayArray(days),
      position: rankOk
        ? forwardFill(rankHist, days, (point) => (Number.isFinite(point.position) ? point.position : null))
        : emptyDayArray(days),
      rankCheck: rankOk ? checkDayFlags(rankHist, days) : emptyDayArray(days),
      indexed: indexOk ? forwardFill(snaps, days, (point) => point.indexed) : emptyDayArray(days),
      submitted: indexOk ? forwardFill(snaps, days, (point) => point.submitted) : emptyDayArray(days),
      indexCheck: indexOk ? checkDayFlags(snaps, days) : emptyDayArray(days),
    };
  }
  return { days, bySite, coverage, rangeDays: Number(rangeDays) || SITE_SERIES_MAX_DAYS };
}

export function sliceSeriesRange(series, rangeDays = SITE_SERIES_MAX_DAYS) {
  const days = Array.isArray(series?.days) ? series.days : [];
  const sliced = sliceLastDays(days, rangeDays);
  if (sliced.length === days.length) {
    return { ...(series || {}), days: sliced, rangeDays: Number(rangeDays) || SITE_SERIES_MAX_DAYS };
  }
  const start = days.length - sliced.length;
  const bySite = {};
  for (const [id, row] of Object.entries(series?.bySite || {})) {
    bySite[id] = {
      ...row,
      clicks: (row.clicks || []).slice(start),
      impressions: (row.impressions || []).slice(start),
      hasImpressions: (row.hasImpressions || []).slice(start),
      page1: (row.page1 || []).slice(start),
      position: (row.position || []).slice(start),
      rankCheck: (row.rankCheck || []).slice(start),
      indexed: (row.indexed || []).slice(start),
      submitted: (row.submitted || []).slice(start),
      indexCheck: (row.indexCheck || []).slice(start),
    };
  }
  return {
    ...(series || {}),
    days: sliced,
    bySite,
    coverage: series?.coverage,
    rangeDays: Number(rangeDays) || SITE_SERIES_MAX_DAYS,
  };
}

function rollingMean(values, window = 7) {
  return values.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let i = Math.max(0, index - window + 1); i <= index; i += 1) {
      const value = values[i];
      if (value == null || !Number.isFinite(Number(value))) continue;
      sum += Number(value);
      count += 1;
    }
    return count ? sum / count : null;
  });
}

export function aggregateSiteSeries(series, siteIds) {
  const days = Array.isArray(series?.days) ? series.days : [];
  const ids = Array.isArray(siteIds) ? siteIds : Object.keys(series?.bySite || {});
  const n = days.length;
  const clicks = Array(n).fill(null);
  const impressions = Array(n).fill(null);
  const sitesWithImpressions = Array(n).fill(null);
  const page1Count = Array(n).fill(null);
  const rankedCount = Array(n).fill(null);
  const positionSum = Array(n).fill(0);
  const positionN = Array(n).fill(0);
  const indexed = Array(n).fill(null);
  const submitted = Array(n).fill(null);
  const rankCheckDays = Array(n).fill(0);
  const indexCheckDays = Array(n).fill(0);
  const idSet = new Set(ids.map(String));
  let gscN = 0;
  let rankN = 0;
  let indexN = 0;
  for (const [id, row] of Object.entries(series?.bySite || {})) {
    if (!idSet.has(String(id))) continue;
    if (row.hasGsc) gscN += 1;
    if (row.hasRank) rankN += 1;
    if (row.hasIndex) indexN += 1;
    for (let i = 0; i < n; i += 1) {
      if (row.hasGsc && row.clicks?.[i] != null) {
        clicks[i] = (clicks[i] || 0) + Number(row.clicks[i] || 0);
        impressions[i] = (impressions[i] || 0) + Number(row.impressions[i] || 0);
        sitesWithImpressions[i] = (sitesWithImpressions[i] || 0) + (Number(row.hasImpressions?.[i]) || 0);
      }
      if (row.hasRank && row.page1?.[i] != null) {
        page1Count[i] = (page1Count[i] || 0) + Number(row.page1[i] || 0);
        rankedCount[i] = (rankedCount[i] || 0) + 1;
        if (Number.isFinite(Number(row.position?.[i]))) {
          positionSum[i] += Number(row.position[i]);
          positionN[i] += 1;
        }
        if (Number(row.rankCheck?.[i]) === 1) rankCheckDays[i] = 1;
      }
      if (row.hasIndex && row.indexed?.[i] != null) {
        indexed[i] = (indexed[i] || 0) + Number(row.indexed[i] || 0);
        submitted[i] = (submitted[i] || 0) + Number(row.submitted?.[i] || 0);
        if (Number(row.indexCheck?.[i]) === 1) indexCheckDays[i] = 1;
      }
    }
  }
  const avgPosition = days.map((_, i) => (positionN[i] ? positionSum[i] / positionN[i] : null));
  const ctr = days.map((_, i) => {
    if (impressions[i] == null) return null;
    if (!impressions[i]) return 0;
    return (clicks[i] || 0) / impressions[i];
  });
  const page1OnCheck = days.map((_, i) => (rankCheckDays[i] ? page1Count[i] : null));
  const positionOnCheck = days.map((_, i) => (rankCheckDays[i] ? avgPosition[i] : null));
  const indexedOnCheck = days.map((_, i) => (indexCheckDays[i] ? indexed[i] : null));
  const rankCheckDayCount = rankCheckDays.filter(Boolean).length;
  const indexCheckDayCount = indexCheckDays.filter(Boolean).length;
  return {
    days,
    clicks,
    impressions,
    clicks7: rollingMean(clicks, 7),
    impressions7: rollingMean(impressions, 7),
    ctr,
    sitesWithImpressions,
    page1Count,
    rankedCount,
    avgPosition,
    page1OnCheck,
    positionOnCheck,
    indexedOnCheck,
    rankCheckDays,
    indexCheckDays,
    rankCheckDayCount,
    indexCheckDayCount,
    indexed,
    submitted,
    gscN,
    rankN,
    indexN,
  };
}

export function sumAlignedWindow(values, days = 7) {
  const list = Array.isArray(values) ? values : [];
  if (!list.length) return null;
  const width = Math.max(1, Number(days) || 7);
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, list.length - width); i < list.length; i += 1) {
    if (list[i] == null || !Number.isFinite(Number(list[i]))) continue;
    sum += Number(list[i]);
    count += 1;
  }
  return count ? sum : null;
}

export const GSC_PAGE_TYPES = ['home', 'locations', 'services', 'contact', 'other'];
export const GSC_PAGE_TYPE_LABELS = {
  home: 'Home',
  locations: 'Locations',
  services: 'Services',
  contact: 'Contact',
  other: 'Other',
};

function pagePathname(pageUrl) {
  const raw = String(pageUrl || '').trim();
  if (!raw) return '';
  try {
    const withProto = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw.replace(/^\/\//, '')}`;
    return new URL(withProto).pathname || '/';
  } catch {
    const cut = raw.split(/[?#]/)[0];
    if (cut.startsWith('/')) return cut;
    const slash = cut.indexOf('/');
    return slash >= 0 ? cut.slice(slash) : '/';
  }
}

/** Classify a Search Console page URL into home / locations / services / contact / other. */
export function gscPageType(pageUrl) {
  const path = pagePathname(pageUrl).replace(/\/+$/, '') || '/';
  const lower = path.toLowerCase();
  if (lower === '/') return 'home';
  if (lower === '/contact' || lower.startsWith('/contact/')) return 'contact';
  if (lower === '/locations' || lower.startsWith('/locations/')) return 'locations';
  if (lower === '/services' || lower.startsWith('/services/')) return 'services';
  return 'other';
}

function escapeRe(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Collapse a site’s city into `{city}` so the same niche query rolls up across the set. */
export function gscQueryPattern(query, site) {
  let text = String(query || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!text) return '';
  const city = String(site?.city || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (city) {
    const re = new RegExp(`\\b${escapeRe(city)}\\b`, 'g');
    text = text.replace(re, '{city}').replace(/\s+/g, ' ').trim();
  }
  return text;
}

export function rollupGscPagesByType(sites) {
  const acc = Object.fromEntries(
    GSC_PAGE_TYPES.map((type) => [
      type,
      { type, clicks: 0, impressions: 0, pages: 0, siteIds: new Set() },
    ]),
  );
  for (const site of Array.isArray(sites) ? sites : []) {
    const rows = site?.metrics?.gsc?.topPages || [];
    for (const row of rows) {
      const type = gscPageType(row?.page);
      const cur = acc[type] || acc.other;
      cur.clicks += Number(row?.clicks) || 0;
      cur.impressions += Number(row?.impressions) || 0;
      cur.pages += 1;
      if (site?.id) cur.siteIds.add(String(site.id));
    }
  }
  return GSC_PAGE_TYPES.map((type) => ({
    type,
    label: GSC_PAGE_TYPE_LABELS[type] || type,
    clicks: acc[type].clicks,
    impressions: acc[type].impressions,
    pages: acc[type].pages,
    sites: acc[type].siteIds.size,
  }));
}

export function rollupGscQueries(sites, { limit = 25 } = {}) {
  const map = new Map();
  for (const site of Array.isArray(sites) ? sites : []) {
    const rows = site?.metrics?.gsc?.topQueries || [];
    for (const row of rows) {
      const query = gscQueryPattern(row?.query, site);
      if (!query) continue;
      const cur = map.get(query) || { query, clicks: 0, impressions: 0, siteIds: new Set() };
      cur.clicks += Number(row?.clicks) || 0;
      cur.impressions += Number(row?.impressions) || 0;
      if (site?.id) cur.siteIds.add(String(site.id));
      map.set(query, cur);
    }
  }
  const cap = Math.max(1, Number(limit) || 25);
  return [...map.values()]
    .map((row) => ({
      query: row.query,
      clicks: row.clicks,
      impressions: row.impressions,
      sites: row.siteIds.size,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.query.localeCompare(b.query))
    .slice(0, cap);
}
