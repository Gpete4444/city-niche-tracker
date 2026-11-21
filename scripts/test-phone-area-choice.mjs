/**
 * Ranking for a new Twilio number. No Twilio call.
 */
import assert from 'node:assert/strict';
import { cityAreaCodes } from '../ops/lib/city-area-codes.mjs';
import { chooseLocalNumber } from '../ops/lib/phone-area-choice.mjs';

const lat = 40;
const lng = -112;

function row(phoneNumber, locality, latitude, longitude) {
  return { phoneNumber, locality, latitude, longitude };
}

const overlayWins = chooseLocalNumber(
  [
    row('+19285550000', 'Flagstaff', 40.01, -112),
    row('+13855550000', 'Salt Lake City', 40.5, -112),
  ],
  {
    cityNpas: ['385', '801'],
    cityNames: ['Salt Lake City'],
    lat,
    lng,
  },
);
assert.equal(overlayWins.match, 'city');
assert.equal(overlayWins.number.phoneNumber, '+13855550000');

const closerInCode = chooseLocalNumber(
  [
    row('+18015550000', 'Ogden', 41.2, -112),
    row('+13855550000', 'Provo', 40.2, -112),
  ],
  {
    cityNpas: ['385', '801'],
    cityNames: ['Salt Lake City'],
    lat,
    lng,
  },
);
assert.equal(closerInCode.match, 'area-code');
assert.equal(closerInCode.number.phoneNumber, '+13855550000');

const closerOtherCode = chooseLocalNumber(
  [
    row('+19285550000', 'Flagstaff', 40.1, -112),
    row('+15205550000', 'Tucson', 42, -112),
  ],
  {
    cityNpas: ['385', '801'],
    cityNames: ['Salt Lake City'],
    lat,
    lng,
  },
);
assert.equal(closerOtherCode.match, 'nearest');
assert.equal(closerOtherCode.number.phoneNumber, '+19285550000');

const typed = chooseLocalNumber(
  [
    row('+13855550000', 'Salt Lake City', 40, -112),
    row('+18015550000', 'Ogden', 41, -112),
  ],
  { typedAreaCode: '801', lat, lng },
);
assert.equal(typed.match, 'area-code');
assert.equal(typed.number.phoneNumber, '+18015550000');
assert.equal(
  chooseLocalNumber([row('+13855550000', 'Salt Lake City', 40, -112)], {
    typedAreaCode: '801',
    lat,
    lng,
  }),
  null,
);

const saltLake = cityAreaCodes('Salt Lake City', 'UT');
assert.ok(saltLake.includes('801'));
assert.ok(saltLake.includes('385'));

const phoenix = cityAreaCodes('Phoenix', 'AZ');
for (const code of ['480', '602', '623']) assert.ok(phoenix.includes(code), code);
assert.ok(!phoenix.includes('928'));
assert.ok(!phoenix.includes('520'));

const springfield = cityAreaCodes('Springfield', 'IL');
assert.ok(springfield.includes('217'));
assert.ok(springfield.includes('447'));

const saintGeorge = cityAreaCodes('St. George', 'UT');
assert.ok(saintGeorge.includes('435'));
assert.ok(!saintGeorge.includes('385'));
assert.ok(!cityAreaCodes('Flagstaff', 'AZ').includes('602'));
assert.ok(cityAreaCodes('Boise City', 'ID').includes('208'));

console.log('phone area choice ok');
