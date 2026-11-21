/**
 * Calendar-aligned launched series: empty sites do not zero/extend the axis,
 * ranks and index snapshots forward-fill, 7d totals come from daily rows.
 * Run: node scripts/test-site-series.mjs
 */
import {
  addDays,
  aggregateSiteSeries,
  appendInspectHistory,
  buildSiteMetricsSeries,
  distinctInspectDays,
  gscIncompleteStart,
  gscPageType,
  gscQueryPattern,
  rollupGscPagesByType,
  rollupGscQueries,
  sliceSeriesRange,
  splitGscCompleteIncomplete,
  windowTotalsFromDaily,
} from '../ops/lib/site-series.mjs';
import { metricsSummary } from '../ops/lib/site-metrics.mjs';

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

function site({ id, gsc = {}, ranks = {}, rankKeywords = [] } = {}) {
  return {
    id,
    businessName: id,
    domain: `${id}.com`,
    metrics: {
      gsc: {
        lastSyncAt: gsc.lastSyncAt || null,
        syncError: gsc.syncError || null,
        daily: gsc.daily || [],
        inspectHistory: gsc.inspectHistory || [],
        inspectIndexed: gsc.inspectIndexed ?? null,
        inspectSubmitted: gsc.inspectSubmitted ?? null,
        inspectCheckedAt: gsc.inspectCheckedAt || null,
      },
      rankKeywords,
      ranks,
    },
  };
}

const established = site({
  id: 'old',
  gsc: {
    lastSyncAt: '2026-11-10T12:00:00.000Z',
    daily: [
      { date: '2026-11-08', clicks: 4, impressions: 100 },
      { date: '2026-11-09', clicks: 6, impressions: 120 },
      { date: '2026-11-10', clicks: 5, impressions: 110 },
    ],
  },
  rankKeywords: [{ keyword: 'plumber boise', isPrimary: true }],
  ranks: {
    byKeyword: {
      'plumber boise': {
        history: [
          { checkedAt: '2026-11-08T12:00:00.000Z', page: 2, position: 12 },
          { checkedAt: '2026-11-10T12:00:00.000Z', page: 1, position: 4 },
        ],
      },
    },
  },
});

const emptyNew = site({
  id: 'new',
  gsc: {
    lastSyncAt: '2026-11-18T12:00:00.000Z',
    daily: [
      { date: '2026-11-16', clicks: 0, impressions: 0 },
      { date: '2026-11-17', clicks: 0, impressions: 0 },
      { date: '2026-11-18', clicks: 0, impressions: 0 },
    ],
  },
});

const unsynced = site({ id: 'bare' });

const neverRanked = site({
  id: 'norank',
  gsc: {
    lastSyncAt: '2026-11-10T12:00:00.000Z',
    daily: [{ date: '2026-11-10', clicks: 1, impressions: 20 }],
  },
});

const seven = windowTotalsFromDaily(
  [
    { date: '2026-11-01', clicks: 10, impressions: 100 },
    { date: '2026-11-08', clicks: 2, impressions: 20 },
    { date: '2026-11-09', clicks: 3, impressions: 30 },
    { date: '2026-11-10', clicks: 4, impressions: 40 },
  ],
  7,
);
assertEqual(seven.clicks, 9, '7d clicks from last 7 calendar days of series');
assertEqual(seven.impressions, 90, '7d impressions from last 7 calendar days of series');
const summary7 = metricsSummary({
  gsc: {
    lastSyncAt: '2026-11-10T00:00:00.000Z',
    daily: [
      { date: '2026-11-01', clicks: 10, impressions: 100 },
      { date: '2026-11-08', clicks: 2, impressions: 20 },
      { date: '2026-11-09', clicks: 3, impressions: 30 },
      { date: '2026-11-10', clicks: 4, impressions: 40 },
    ],
  },
});
assertEqual(summary7.clicks7d, 9, 'metricsSummary clicks7d');
assertEqual(summary7.impressions7d, 90, 'metricsSummary impressions7d');
assertEqual(metricsSummary(null).clicks7d, null, 'no metrics means no 7d');

const built = buildSiteMetricsSeries([established, emptyNew, unsynced], { rangeDays: 90 });
assert(!built.days.includes('2026-11-18'), 'zero-only new site does not extend the axis');
assert(built.days.includes('2026-11-08'), 'traffic dates stay on the axis');
assertEqual(built.days[built.days.length - 1], '2026-11-10', 'right edge is last traffic/rank date, not empty GSC yesterday');
assertEqual(built.coverage.gsc.included.join(','), 'old,new', 'synced sites included for GSC');
assertEqual(built.coverage.gsc.excluded.map((row) => row.id).join(','), 'bare', 'never-synced excluded');
assertEqual(built.coverage.gsc.excluded[0].action, 'Sync GSC', 'GSC exclude action');
assertEqual(built.coverage.ranks.excluded.map((row) => row.action).join(','), 'Check ranks,Check ranks', 'rank exclude action');

const aggAll = aggregateSiteSeries(built, ['old', 'new', 'bare']);
const last = built.days.length - 1;
assertEqual(aggAll.impressions[last], 110, 'impressions stay the established total');
assertEqual(aggAll.clicks[last], 5, 'clicks stay the established total');
assertEqual(aggAll.impressions.join(','), '100,120,110', 'new zeros do not insert a zero spike on traffic days');

const nov8 = built.days.indexOf('2026-11-08');
const nov9 = built.days.indexOf('2026-11-09');
const nov10 = built.days.indexOf('2026-11-10');
assertEqual(aggAll.page1Count[nov8], 0, 'rank forward-fill starts off page 1');
assertEqual(aggAll.page1Count[nov9], 0, 'rank forward-fill holds last check on days without a check');
assertEqual(aggAll.page1Count[nov10], 1, 'rank updates on the later check day');
assertEqual(aggAll.avgPosition[nov9], 12, 'avg position forward-fills');
assertEqual(aggAll.avgPosition[nov10], 4, 'avg position uses the new check');
assertEqual(aggAll.rankCheckDays[nov8], 1, 'rank check flag on check day');
assertEqual(aggAll.rankCheckDays[nov9], 0, 'no rank check flag on a forward-fill day');
assertEqual(aggAll.page1OnCheck[nov9], null, 'check-day series is null between checks');
assertEqual(aggAll.page1OnCheck[nov10], 1, 'check-day series has the check value');
assertEqual(aggAll.rankCheckDayCount, 2, 'two rank check days');

const newOnly = buildSiteMetricsSeries([emptyNew], { rangeDays: 90 });
assertEqual(newOnly.days.length, 0, 'zero-only set does not invent a calendar axis');

const sliced = sliceSeriesRange(built, 1);
assertEqual(sliced.days.join(','), '2026-11-10', 'slice last N calendar days');
assertEqual(aggregateSiteSeries(sliced, ['old']).impressions[0], 110, 'sliced values follow days');

const withIndex = site({
  id: 'idx',
  gsc: {
    lastSyncAt: '2026-11-10T12:00:00.000Z',
    daily: [{ date: '2026-11-10', clicks: 1, impressions: 8 }],
    inspectHistory: [
      { checkedAt: '2026-11-08T08:00:00.000Z', indexed: 2, submitted: 10, notIndexed: 8 },
      { checkedAt: '2026-11-10T08:00:00.000Z', indexed: 6, submitted: 10, notIndexed: 4 },
    ],
  },
});
const idxSeries = buildSiteMetricsSeries([withIndex], { rangeDays: 90 });
const idxAgg = aggregateSiteSeries(idxSeries, ['idx']);
const i8 = idxSeries.days.indexOf('2026-11-08');
const i9 = idxSeries.days.indexOf('2026-11-09');
const i10 = idxSeries.days.indexOf('2026-11-10');
assertEqual(idxAgg.indexed[i8], 2, 'indexed snapshot day');
assertEqual(idxAgg.indexed[i9], 2, 'indexed forward-fills between checks');
assertEqual(idxAgg.indexed[i10], 6, 'later check replaces indexed');
assertEqual(idxAgg.indexCheckDayCount, 2, 'two index check days');
assertEqual(idxAgg.indexedOnCheck[i9], null, 'indexed check-day series skips fill days');
assertEqual(idxAgg.indexedOnCheck[i10], 6, 'indexed check-day series on check day');
assertEqual(distinctInspectDays([withIndex]), 2, 'two inspect snapshots are two distinct days');

const seeded = site({
  id: 'seed',
  gsc: {
    inspectCheckedAt: '2026-11-05T00:00:00.000Z',
    inspectIndexed: 3,
    inspectSubmitted: 12,
  },
});
const seededSeries = buildSiteMetricsSeries([seeded]);
assertEqual(seededSeries.coverage.indexed.included.join(','), 'seed', 'latest inspect rollup seeds history');
assertEqual(aggregateSiteSeries(seededSeries, ['seed']).indexed.at(-1), 3, 'seeded indexed value');
assertEqual(aggregateSiteSeries(seededSeries, ['seed']).indexCheckDayCount, 1, 'seeded inspect is one check day');
assertEqual(distinctInspectDays([seeded]), 1, 'seeded inspect is one distinct day');
assertEqual(distinctInspectDays([withIndex, seeded]), 3, 'inspect days union across sites');

const hist = appendInspectHistory(
  [{ checkedAt: '2026-11-01T10:00:00.000Z', indexed: 1, submitted: 10, notIndexed: 9 }],
  { checkedAt: '2026-11-01T18:00:00.000Z', indexed: 4, submitted: 10, notIndexed: 6 },
);
assertEqual(hist.length, 1, 'one snapshot per calendar day');
assertEqual(hist[0].indexed, 4, 'later check that day replaces');

const capped = appendInspectHistory(
  Array.from({ length: 104 }, (_, i) => ({
    checkedAt: `${addDays('2026-01-01', i)}T12:00:00.000Z`,
    indexed: i,
    submitted: 10,
    notIndexed: 0,
  })),
  { checkedAt: '2026-08-01T12:00:00.000Z', indexed: 99, submitted: 10, notIndexed: 0 },
);
assertEqual(capped.length, 104, 'inspect history retention cap');
assertEqual(capped.at(-1).indexed, 99, 'newest snapshot kept');

const mixedRanks = buildSiteMetricsSeries([established, neverRanked]);
assertEqual(mixedRanks.coverage.ranks.included.join(','), 'old', 'unranked site excluded from rank series');
assertEqual(mixedRanks.coverage.ranks.excluded[0].id, 'norank', 'unranked site named in coverage');

assertEqual(gscIncompleteStart('2026-11-19'), '2026-11-16', 'incomplete window starts 3 UTC days before today');
assertEqual(gscIncompleteStart('2026-11-19T18:00:00.000Z'), '2026-11-16', 'incomplete start uses the UTC calendar day');

const lagDays = ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'];
const lagValues = [100, 110, 120, 40, 10, 0];
const split = splitGscCompleteIncomplete(lagValues, lagDays, '2026-11-16');
assertEqual(split.complete.join(','), '100,110,120,,,', 'days before incomplete start stay solid');
assertEqual(split.incomplete.join(','), ',,120,40,10,0', 'dotted tail shares the last complete point');
assertEqual(split.complete[3], null, 'incomplete days are not on the solid series');
assertEqual(split.incomplete[1], null, 'days before the join are not dashed');

const allComplete = splitGscCompleteIncomplete([8, 9], ['2026-11-10', '2026-11-11'], '2026-11-16');
assertEqual(allComplete.complete.join(','), '8,9', 'series that ends before the lag stays solid');
assertEqual(allComplete.incomplete.join(','), ',', 'no dotted stub when every day is complete');

const allLag = splitGscCompleteIncomplete([4, 1], ['2026-11-17', '2026-11-18'], '2026-11-16');
assertEqual(allLag.complete.join(','), ',', 'no solid segment when every day is still landing');
assertEqual(allLag.incomplete.join(','), '4,1', 'whole series is dotted when it sits in the lag window');

assertEqual(gscPageType('https://allenconcretelifting.com/'), 'home', 'apex home');
assertEqual(gscPageType('https://allenconcretelifting.com'), 'home', 'host-only home');
assertEqual(gscPageType('https://allenconcretelifting.com/locations/fairview/'), 'locations', 'location page');
assertEqual(gscPageType('https://allenconcretelifting.com/services/concrete-crack-repair/'), 'services', 'service page');
assertEqual(gscPageType('https://allenconcretelifting.com/contact/'), 'contact', 'contact page');
assertEqual(gscPageType('https://allenconcretelifting.com/about/'), 'other', 'about is other');

assertEqual(
  gscQueryPattern('Cabinet Refacing Zephyrhills', { city: 'Zephyrhills' }),
  'cabinet refacing {city}',
  'city token in query',
);
assertEqual(
  gscQueryPattern('zephyrhills cabinet refacing', { city: 'Zephyrhills' }),
  '{city} cabinet refacing',
  'city-first query',
);

const rollSites = [
  {
    id: 'a',
    city: 'Fairview',
    metrics: {
      gsc: {
        topPages: [
          { page: 'https://a.com/', clicks: 4, impressions: 285 },
          { page: 'https://a.com/locations/fairview/', clicks: 1, impressions: 95 },
          { page: 'https://a.com/services/crack-repair/', clicks: 1, impressions: 74 },
        ],
        topQueries: [
          { query: 'concrete lifting fairview', clicks: 3, impressions: 40 },
          { query: 'foundation repair', clicks: 1, impressions: 12 },
        ],
      },
    },
  },
  {
    id: 'b',
    city: 'Princeton',
    metrics: {
      gsc: {
        topPages: [{ page: 'https://b.com/', clicks: 2, impressions: 80 }],
        topQueries: [{ query: 'concrete lifting princeton', clicks: 2, impressions: 30 }],
      },
    },
  },
];
const byType = rollupGscPagesByType(rollSites);
assertEqual(byType.find((row) => row.type === 'home').impressions, 365, 'home impressions sum across sites');
assertEqual(byType.find((row) => row.type === 'home').sites, 2, 'home site count');
assertEqual(byType.find((row) => row.type === 'locations').pages, 1, 'one location URL in top pages');
assertEqual(byType.find((row) => row.type === 'contact').pages, 0, 'unused types stay zero');
const byQuery = rollupGscQueries(rollSites, { limit: 10 });
assertEqual(byQuery[0].query, 'concrete lifting {city}', 'city-stripped query is the top pattern');
assertEqual(byQuery[0].sites, 2, 'same niche query counts two sites');
assertEqual(byQuery[0].clicks, 5, 'pattern clicks sum');

console.log('test-site-series: ok');
