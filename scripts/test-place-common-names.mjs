/**
 * Boise, Idaho uses the common name. Boise City, Oklahoma stays Census-named.
 * Run: node scripts/test-place-common-names.mjs
 */
import { lookupPopulation, suggestPlaces } from '../ops/lib/census.mjs';
import { adjacentPlaces, findPlaceFeatureLocal } from '../ops/lib/geo-neighbors.mjs';
import { resolveNamedLocation } from './lib/dataforseo.mjs';

function assert(cond, message) {
  if (!cond) {
    console.error(message);
    process.exit(1);
  }
}

function assertEqual(got, want, message) {
  if (got !== want) {
    console.error(`${message}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

const boise = suggestPlaces({ q: 'Boise', state: 'ID', limit: 20 });
assert(boise.ok, 'suggest Boise ID ok');
assertEqual(boise.places.length, 1, 'one Idaho row for Boise');
assertEqual(boise.places[0].city, 'Boise', 'picker city');
assertEqual(boise.places[0].state, 'ID', 'picker state');

const censusQuery = suggestPlaces({ q: 'Boise City', state: 'ID', limit: 20 });
assertEqual(censusQuery.places.length, 1, 'Census name still finds one Idaho row');
assertEqual(censusQuery.places[0].city, 'Boise', 'Census name displays as Boise');

const browse = suggestPlaces({ q: '', state: 'ID', limit: 2000 });
const idahoLabels = browse.places.filter((row) => row.city === 'Boise' || row.city === 'Boise City');
assertEqual(idahoLabels.length, 1, 'Idaho browse has a single Boise label');
assertEqual(idahoLabels[0].city, 'Boise', 'browse label');

const fromCommon = findPlaceFeatureLocal('Boise', 'ID');
const fromCensus = findPlaceFeatureLocal('Boise City', 'ID');
assert(fromCommon && fromCensus, 'both Idaho names resolve');
assertEqual(fromCommon.properties.geoid, '1608830', 'Boise geoid');
assertEqual(fromCensus.properties.geoid, '1608830', 'Boise City geoid');
assertEqual(fromCommon.properties.name, 'Boise', 'polygon name');
assertEqual(fromCensus.properties.name, 'Boise', 'census query polygon name');
assert(fromCommon === fromCensus, 'both names are the same feature');

const oklahoma = findPlaceFeatureLocal('Boise City', 'OK');
assert(oklahoma, 'Oklahoma Boise City exists');
assertEqual(oklahoma.properties.name, 'Boise City', 'Oklahoma keeps Boise City');
assertEqual(oklahoma.properties.geoid, '4007300', 'Oklahoma geoid');

const garden = findPlaceFeatureLocal('Garden City', 'ID');
const idahoCity = findPlaceFeatureLocal('Idaho City', 'ID');
assert(garden && idahoCity, 'other Idaho City towns still match');
assertEqual(garden.properties.name, 'Garden City', 'Garden City unchanged');
assertEqual(idahoCity.properties.name, 'Idaho City', 'Idaho City unchanged');

const popCommon = lookupPopulation('Boise', 'ID');
const popCensus = lookupPopulation('Boise City', 'ID');
assert(popCommon > 200000, 'Boise population is the capital');
assertEqual(popCensus, popCommon, 'both names share one population');

const neighbors = adjacentPlaces('Boise', 'ID', { minPop: 0 });
const neighborsCensus = adjacentPlaces('Boise City', 'ID', { minPop: 0 });
assert(neighbors.length > 0, 'Boise has neighbors');
assert(
  neighbors.some((row) => row.name === 'Meridian' || row.name === 'Garden City'),
  'Treasure Valley neighbors',
);
assertEqual(
  neighborsCensus.map((row) => `${row.name}|${row.state}`).join(','),
  neighbors.map((row) => `${row.name}|${row.state}`).join(','),
  'Census name uses the same neighbor list',
);
const meridian = adjacentPlaces('Meridian', 'ID', { minPop: 0 });
assert(
  meridian.some((row) => row.name === 'Boise'),
  'Meridian lists Boise',
);
assert(
  !meridian.some((row) => row.name === 'Boise City'),
  'Meridian does not list Boise City',
);

const ads = [{ locationName: 'Boise,Idaho,United States', locationCode: 101 }];
assertEqual(resolveNamedLocation(ads, 'Boise', 'ID')?.locationCode, 101, 'Ads Boise');
assertEqual(resolveNamedLocation(ads, 'Boise City', 'ID')?.locationCode, 101, 'Ads Boise City ID');
assertEqual(resolveNamedLocation(ads, 'Boise City', 'OK'), null, 'Ads does not send Oklahoma to Boise');

console.log('place common names ok');
