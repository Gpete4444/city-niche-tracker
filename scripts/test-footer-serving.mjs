import { footerServingText } from '../src/lib/footer-serving.mjs';

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

assertEqual(
  footerServingText({ primaryCity: 'Midvale', state: 'UT' }),
  'Serving Midvale, UT',
  'primary only',
);

assertEqual(
  footerServingText({
    primaryCity: 'Midvale',
    state: 'UT',
    alsoServing: [
      'Murray',
      'White City',
      'Sandy',
      'Cottonwood Heights',
      'Taylorsville',
      'Holladay',
      'West Jordan',
      'Millcreek',
      'South Jordan',
      'South Salt Lake',
    ],
  }),
  'Serving Midvale, UT and nearby: Murray, White City, Sandy, Cottonwood Heights, Taylorsville, Holladay, West Jordan, Millcreek, South Jordan, South Salt Lake',
  'also serving order',
);

assertEqual(
  footerServingText({
    primaryCity: 'Lehi',
    state: 'UT',
    targetSuburbs: ['American Fork'],
    alsoServing: ['American Fork', 'Eagle Mountain', ' ', 'Lehi'],
  }),
  'Serving Lehi, UT and nearby: American Fork, Eagle Mountain',
  'suburb is not repeated',
);

console.log('test-footer-serving: ok');
