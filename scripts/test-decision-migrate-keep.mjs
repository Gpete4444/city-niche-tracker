import { recommendCandidate } from '../ops/lib/discovery-recommend.mjs';
import {
  migrateCandidateDecision,
  shouldRewriteOperatorDecision,
} from '../ops/lib/migrate-decisions-score.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

assert(shouldRewriteOperatorDecision('deprioritize'), 'legacy deprioritize rewrites');
assert(shouldRewriteOperatorDecision('pass_unless_gbp_angle'), 'legacy pass_unless rewrites');
assert(shouldRewriteOperatorDecision(''), 'empty rewrites');
assert(shouldRewriteOperatorDecision('nope'), 'invalid rewrites');
assert(!shouldRewriteOperatorDecision('pursue'), 'pursue stays');
assert(!shouldRewriteOperatorDecision('maybe'), 'maybe stays');
assert(!shouldRewriteOperatorDecision('pass'), 'pass stays');
assert(!shouldRewriteOperatorDecision('hold'), 'hold stays');
assert(!shouldRewriteOperatorDecision('review'), 'review stays');
assert(!shouldRewriteOperatorDecision('ignore'), 'ignore stays');

const maybeBand = {
  id: 'drywall-repair-hoover-al',
  decision: 'pursue',
  decisionNotes: 'operator override',
  proposedScore: 6.4,
  stageFlags: { hasResearch: true, hasEnrichment: true, hasNarrative: true },
};
const rec = recommendCandidate(maybeBand);
assert(rec.recommended_decision === 'maybe', `score 6.4 should recommend maybe, got ${rec.recommended_decision}`);
assert(
  migrateCandidateDecision(maybeBand) === null,
  'operator pursue must not be overwritten by maybe recommend',
);

const legacy = {
  id: 'legacy-row',
  decision: 'deprioritize',
  proposedScore: 5,
  stageFlags: { hasResearch: true, hasEnrichment: true, hasNarrative: true },
};
const migrated = migrateCandidateDecision(legacy);
assert(migrated?.decision === 'pass', `legacy deprioritize → pass, got ${migrated?.decision}`);

console.log('test-decision-migrate-keep: ok');
