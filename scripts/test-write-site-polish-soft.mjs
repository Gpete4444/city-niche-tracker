/**
 * Write site Polish: leftover speech is advisory after editor retries.
 * Critical SEO keeps requesting editor; leftover thin location pages fail Write site.
 * Run: node scripts/test-write-site-polish-soft.mjs
 */
import {
  EXPAND_LOCATION_ATTEMPTS,
  LOCATION_WRITE_CHUNK,
  POLISH_EDITOR_ATTEMPTS,
  chunkList,
  composeWriteSiteInnerDone,
  leftoversFromLint,
  polishNeedsEditor,
  polishShouldSkipBecauseFinalStamped,
  polishSpeechShouldBlockWrite,
  polishThinLocationsShouldBlockWrite,
  thinLocationSeoFindings,
  writeSitePolishDone,
} from '../ops/lib/content-write-site.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

assert(POLISH_EDITOR_ATTEMPTS === 3, 'editor retries three times');
assert(EXPAND_LOCATION_ATTEMPTS === 2, 'expand locations twice');
assert(LOCATION_WRITE_CHUNK === 3, 'locations write in chunks of 3');
assert(
  polishSpeechShouldBlockWrite({ speechN: 4, attempts: POLISH_EDITOR_ATTEMPTS }) === false,
  'never 422 on leftover speech after max editor attempts',
);
assert(writeSitePolishDone({ speechChecked: true }) === true, 'checked speech finishes Polish');
assert(writeSitePolishDone({ speechChecked: false }) === false, 'unchecked speech is not done');

assert(
  polishNeedsEditor({ speechN: 0, criticalSeoN: 2 }) === true,
  'critical SEO needs editor on every attempt',
);
assert(
  polishNeedsEditor({ speechN: 0, criticalSeoN: 0 }) === false,
  'clear lint does not need editor',
);
assert(
  polishShouldSkipBecauseFinalStamped({ lastFinalCheckAt: '2026-09-16', criticalSeoN: 0 }) === true,
  'stamped final + no critical skips polish',
);
assert(
  polishShouldSkipBecauseFinalStamped({ lastFinalCheckAt: '2026-09-16', criticalSeoN: 3 }) ===
    false,
  'stamped final + critical SEO still polishes',
);
assert(
  polishThinLocationsShouldBlockWrite({ thinLocationN: 1 }) === true,
  'leftover thin locations fail Write site',
);
assert(
  polishThinLocationsShouldBlockWrite({ thinLocationN: 0 }) === false,
  'no thin locations do not fail',
);

const seoLint = {
  findings: [
    { severity: 'critical', rule: 'location_body_thin', file: 'src/content/locations/aubrey.md' },
    { severity: 'soft', rule: 'materials_generic', file: 'src/content/pages/index.md' },
  ],
};
assert(thinLocationSeoFindings(seoLint).length === 1, 'counts thin location findings');
assert(leftoversFromLint(null, seoLint).thinLocationN === 1, 'leftovers expose thinLocationN');
assert(leftoversFromLint(null, seoLint).criticalSeoN === 1, 'leftovers count critical');

const chunks = chunkList(['a', 'b', 'c', 'd', 'e', 'f'], 3);
assert(chunks.length === 2 && chunks[0].length === 3 && chunks[1].length === 3, 'chunk 6 into 3+3');

const leftover = composeWriteSiteInnerDone({
  fieldLoaded: true,
  briefConfirmed: true,
  outlineConfirmed: true,
  writeComplete: true,
  speechChecked: true,
  speechN: 3,
  finalOk: true,
  photosOn: false,
  queriesLoaded: false,
});
assert(leftover.editor === true, 'writeSiteInnerDone.editor true with leftover speech + lastSpeechCheckAt');
assert(leftover.all === true, 'writeSiteInnerDone.all true with leftover speech + lastSpeechCheckAt');

const unchecked = composeWriteSiteInnerDone({
  fieldLoaded: true,
  briefConfirmed: true,
  outlineConfirmed: true,
  writeComplete: true,
  speechChecked: false,
  speechN: 0,
  finalOk: true,
  photosOn: false,
});
assert(unchecked.editor === false, 'editor false without lastSpeechCheckAt');
assert(unchecked.all === false, 'all false without lastSpeechCheckAt');

console.log('test-write-site-polish-soft: ok');
