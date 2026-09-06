import { normalizeCityStateCluster } from '../ops/lib/city-state.mjs';

function assertEqual(got, want, label) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) {
    console.error(`${label}: got ${a}, want ${b}`);
    process.exit(1);
  }
}

assertEqual(
  normalizeCityStateCluster('Goodyear, Litchfield Park, Tolleson, Buckeye', 'AZ'),
  ['Goodyear,AZ', 'Litchfield Park,AZ', 'Tolleson,AZ', 'Buckeye,AZ'],
  'comma city list + AZ',
);

assertEqual(
  normalizeCityStateCluster('Jeffersontown,KY;St. Matthews,KY', 'KY'),
  ['Jeffersontown,KY', 'St. Matthews,KY'],
  'semicolon City,ST',
);

assertEqual(
  normalizeCityStateCluster('Bellevue,NE|Papillion,NE', 'NE'),
  ['Bellevue,NE', 'Papillion,NE'],
  'pipe City,ST',
);

assertEqual(
  normalizeCityStateCluster('Litchfield Park', 'AZ'),
  ['Litchfield Park,AZ'],
  'single city + AZ',
);

assertEqual(
  normalizeCityStateCluster('Goodyear,AZ; Litchfield Park', 'AZ'),
  ['Goodyear,AZ', 'Litchfield Park,AZ'],
  'mixed City,ST and city name',
);

assertEqual(
  normalizeCityStateCluster(['Goodyear, Litchfield Park, Tolleson, Buckeye'], 'AZ'),
  ['Goodyear,AZ', 'Litchfield Park,AZ', 'Tolleson,AZ', 'Buckeye,AZ'],
  'array with one comma-list string',
);

assertEqual(
  normalizeCityStateCluster(['Bellevue,NE', 'Papillion,NE', 'La Vista,NE'], 'NE'),
  ['Bellevue,NE', 'Papillion,NE', 'La Vista,NE'],
  'already-normalized array',
);

assertEqual(
  normalizeCityStateCluster('Goodyear, AZ, Litchfield Park', 'AZ'),
  ['Goodyear,AZ', 'Litchfield Park,AZ'],
  'City, ST then another city in one comma string',
);

console.log('test-suburbs-cluster: ok');
