/**
 * Launched Stop bumps index and rank generations, and an empty rank list does not post.
 * Run: node scripts/test-launched-job-stop.mjs
 */
import { bumpIndexCheckCancel, indexCheckCancelToken } from '../ops/lib/gsc-index-inspect.mjs';
import {
  bumpRankCheckCancel,
  checkAllSiteRanks,
  rankCheckCancelToken,
} from '../ops/lib/rank-track.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

const indexToken = indexCheckCancelToken();
bumpIndexCheckCancel();
assert(indexCheckCancelToken() !== indexToken, 'index cancel generation did not change');

const rankToken = rankCheckCancelToken();
bumpRankCheckCancel();
assert(rankCheckCancelToken() !== rankToken, 'rank cancel generation did not change');

const empty = await checkAllSiteRanks({ siteIds: [] });
assert(empty.ok === true && empty.checked === 0 && empty.results.length === 0, 'empty rank list posted');
const missing = await checkAllSiteRanks({});
assert(missing.ok === true && missing.checked === 0, 'missing rank list posted');

console.log('test-launched-job-stop: ok');
