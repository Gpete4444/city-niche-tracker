/**
 * Memory-pass invariants: list cache identity, slim list meta, detail slices.
 */
import {
  CANDIDATE_DETAIL_SLICES,
  getCandidateDetail,
  getCandidateShell,
  invalidateCandidateListCache,
  listCandidates,
} from '../ops/lib/candidates.mjs';
import { loadMapLayer } from '../ops/lib/census-map-layers.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

assert(Array.isArray(CANDIDATE_DETAIL_SLICES), 'CANDIDATE_DETAIL_SLICES export');
assert(CANDIDATE_DETAIL_SLICES.includes('content'), 'content slice');
assert(CANDIDATE_DETAIL_SLICES.includes('images'), 'images slice');
assert(CANDIDATE_DETAIL_SLICES.includes('address'), 'address slice');
assert(CANDIDATE_DETAIL_SLICES.includes('prospects'), 'prospects slice');

invalidateCandidateListCache();
const first = listCandidates({ force: true });
const cached = listCandidates();
assert(first === cached, 'listCandidates TTL cache returns same array');
invalidateCandidateListCache();
const rebuilt = listCandidates({ force: true });
assert(rebuilt !== first, 'force / invalidate rebuilds list array');

for (const row of rebuilt) {
  assert(row.meta == null || !('logoVariants' in row.meta), `${row.id} list meta must omit logoVariants`);
  assert(row.meta == null || !('coverageMapVariants' in row.meta), `${row.id} list meta must omit coverageMapVariants`);
}

let threw = false;
try {
  getCandidateShell('__no-such-candidate__');
} catch (err) {
  threw = err.status === 404;
}
assert(threw, 'getCandidateShell 404 for missing id');

if (rebuilt[0]?.id) {
  const id = rebuilt[0].id;
  const shell = getCandidateDetail(id, { include: [] });
  assert(shell._slices?.shell === true, 'shell marks _slices.shell');
  assert(shell._slices?.content === false, 'shell omits content slice');
  assert(!('contentDraft' in shell), 'shell omits contentDraft');
  assert(!('businessAddress' in shell), 'shell omits businessAddress');
  assert(!('prospects' in shell), 'shell omits prospects');
  const content = getCandidateDetail(id, { include: ['content'] });
  assert(content._slices?.content === true, 'include=content marks slice');
  assert('contentDraft' in content || 'content' in content, 'content slice has content keys');
}

const placesA = loadMapLayer('places');
const placesB = loadMapLayer('places');
if (placesA) {
  assert(placesA === placesB, 'places GeoJSON cache is shared by identity');
}

console.log('test-candidate-memory-pass: ok');
