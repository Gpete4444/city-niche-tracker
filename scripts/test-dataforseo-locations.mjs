/**
 * SERP location resolution, Ads geo fallback, and Live Ads 40202 retry.
 * Run: node scripts/test-dataforseo-locations.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dataForSeoRequest,
  dataForSeoRetryWaitMs,
  resetDataForSeoTransportForTests,
  resolveAdsLocationWithFallback,
  resolveNamedLocation,
  resolveSerpTaskLocation,
  serpLocationPayload,
  setDataForSeoTransportForTests,
} from './lib/dataforseo.mjs';
import { organicSerpTaskBody } from './lib/serp-classify.mjs';
import { acquireAdsLiveSlot } from './lib/ads-volume.mjs';
import { adsVolumeHonesty, demandVolumeHtml } from '../ops/public/metrics.js';

function assertEqual(got, want, label) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) {
    console.error(`${label}: got ${a}, want ${b}`);
    process.exit(1);
  }
}

const locations = [
  { locationName: 'Phoenix,Arizona,United States', locationCode: 1026481 },
  { locationName: 'Litchfield Park,Arizona,United States', locationCode: 1023991 },
  { locationName: 'Arizona,United States', locationCode: 2007 },
  { locationName: 'St. Louis,Missouri,United States', locationCode: 1016367 },
];

assertEqual(
  resolveNamedLocation(locations, 'Phoenix', 'AZ')?.locationCode,
  1026481,
  'listed city matches',
);
assertEqual(
  resolveNamedLocation(locations, 'St Louis', 'MO')?.locationCode,
  1016367,
  'St. vs St fuzzy',
);
assertEqual(
  resolveNamedLocation(locations, 'Circle City', 'AZ'),
  null,
  'unlisted CDP is not a named match',
);

const listed = resolveSerpTaskLocation('Phoenix', 'AZ', { locations });
assertEqual(listed?.kind, 'named', 'listed SERP kind');
assertEqual(listed?.fallback, null, 'listed SERP no fallback');
assertEqual(listed?.location_name, 'Phoenix,Arizona,United States', 'listed SERP name');
assertEqual(
  serpLocationPayload(listed),
  { location_name: 'Phoenix,Arizona,United States' },
  'named payload uses location_name',
);

const pin = resolveSerpTaskLocation('Circle City', 'AZ', {
  locations,
  lookupCentroid: () => ({ lat: 33.7736, lng: -112.5885 }),
});
assert.equal(pin.kind, 'coordinate');
assert.equal(pin.fallback, 'coordinate');
assert.equal(pin.location_coordinate, '33.7736,-112.5885,200');
assertEqual(
  serpLocationPayload(pin),
  { location_coordinate: '33.7736,-112.5885,200' },
  'coordinate payload',
);
assertEqual(
  organicSerpTaskBody('artificial turf installation Circle City AZ', pin).location_coordinate,
  '33.7736,-112.5885,200',
  'organic SERP body uses coordinate',
);
assert.equal(
  organicSerpTaskBody('artificial turf installation Circle City AZ', pin).location_name,
  undefined,
  'organic SERP body does not send invalid location_name with a pin',
);

const stateOnly = resolveSerpTaskLocation('Nowhereville', 'AZ', {
  locations,
  lookupCentroid: () => null,
});
assert.equal(stateOnly.kind, 'state');
assert.equal(stateOnly.fallback, 'state');
assert.equal(stateOnly.location_name, 'Arizona,United States');

const neighborHit = resolveAdsLocationWithFallback(locations, 'Circle City', 'AZ', {
  neighbors: [
    { name: 'Circle City', state: 'AZ', population: 400 },
    { name: 'Litchfield Park', state: 'AZ', population: 6871 },
  ],
});
assert.equal(neighborHit.fallback, 'neighbor');
assert.equal(neighborHit.location.locationCode, 1023991);
assert.equal(neighborHit.fallbackFrom, 'Litchfield Park, AZ');

const noAdsGeo = resolveAdsLocationWithFallback(locations, 'Circle City', 'AZ', {
  neighbors: [{ name: 'Tiny CDP', state: 'AZ', population: 50 }],
});
assert.equal(noAdsGeo, null, 'no state Ads fallback');

const exactAds = resolveAdsLocationWithFallback(locations, 'Phoenix', 'AZ', { neighbors: [] });
assert.equal(exactAds.fallback, null);
assert.equal(exactAds.location.locationCode, 1026481);

assert.equal(dataForSeoRetryWaitMs(40202, 1, () => 0), 65000, '40202 min wait');
assert.equal(dataForSeoRetryWaitMs(40202, 1, () => 1), 80000, '40202 max wait');
assert.equal(dataForSeoRetryWaitMs(40101, 2), 3000, 'transient wait stays 1.5s * attempt');

process.env.DATAFORSEO_LOGIN ||= 'test-login';
process.env.DATAFORSEO_PASSWORD ||= 'test-password';

{
  let calls = 0;
  const waits = [];
  setDataForSeoTransportForTests({
    requestJson: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          status: 200,
          json: {
            status_code: 20000,
            tasks: [
              {
                status_code: 40202,
                status_message: 'The rates limit per minute has been exceeded: 12 >= 12.',
              },
            ],
          },
        };
      }
      return {
        ok: true,
        status: 200,
        json: {
          status_code: 20000,
          tasks: [{ status_code: 20000, result: [], cost: 0 }],
        },
      };
    },
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  try {
    const json = await dataForSeoRequest(
      '/keywords_data/google_ads/keywords_for_keywords/live',
      { keywords: ['turf'] },
      { retries: 3, label: 'keywords_for_keywords' },
    );
    assert.equal(calls, 2, '40202 task status retries then succeeds');
    assert.equal(json.tasks[0].status_code, 20000);
    assert.ok(waits[0] >= 65000 && waits[0] <= 80000, `40202 wait was ${waits[0]}`);
  } finally {
    resetDataForSeoTransportForTests();
  }
}

{
  let calls = 0;
  const waits = [];
  setDataForSeoTransportForTests({
    requestJson: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: {
          status_code: 20000,
          tasks: [
            {
              status_code: 40501,
              status_message: "Invalid Field: 'location_name'.",
            },
          ],
        },
      };
    },
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  try {
    const json = await dataForSeoRequest(
      '/serp/google/organic/live/advanced',
      { keyword: 'x', location_name: 'Circle City,Arizona,United States' },
      { retries: 4, label: 'serp' },
    );
    assert.equal(calls, 1, '40501 is not retried');
    assert.equal(json.tasks[0].status_code, 40501);
    assert.equal(waits.length, 0, '40501 does not wait');
  } finally {
    resetDataForSeoTransportForTests();
  }
}

{
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rover-ads-rpm-'));
  const clock = { t: 1_000_000 };
  const sleeps = [];
  try {
    const first = await acquireAdsLiveSlot({
      maxPerWindow: 2,
      windowMs: 1_000,
      cacheDir: dir,
      now: () => clock.t,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.t += ms;
      },
    });
    const second = await acquireAdsLiveSlot({
      maxPerWindow: 2,
      windowMs: 1_000,
      cacheDir: dir,
      now: () => clock.t,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.t += ms;
      },
    });
    assert.equal(first.count, 1);
    assert.equal(second.count, 2);
    const third = await acquireAdsLiveSlot({
      maxPerWindow: 2,
      windowMs: 1_000,
      cacheDir: dir,
      now: () => clock.t,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.t += ms;
      },
    });
    assert.ok(sleeps.length >= 1, 'third Live Ads call waited for a slot');
    assert.ok(sleeps[0] >= 50, `wait ${sleeps[0]}`);
    assert.equal(third.count, 1, 'window rolled after wait');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

assert.equal(adsVolumeHonesty({ volumesSkipped: true }).mode, 'skipped', 'skipped volumes');
assert.equal(
  adsVolumeHonesty({ adsLocationFallback: { kind: 'state' } }).mode,
  'skipped',
  'stale statewide Ads hidden',
);
assert.equal(
  adsVolumeHonesty({
    adsLocationFallback: { kind: 'neighbor', from: 'Glendale, AZ', requested: 'Citrus Park, AZ' },
  }).mode,
  'neighbor',
  'neighbor Ads labeled',
);
assert.ok(
  demandVolumeHtml(7430, { honesty: { mode: 'skipped', staleState: true } }).includes('—'),
  'statewide 7430 does not render as Very high',
);

console.log('test-dataforseo-locations: ok');
