import assert from 'node:assert/strict';

import {
  applyEnrichmentToScoring,
  buildResearchScoring,
  scoreCompetition,
  scoreDisplaceability,
  stageOneSoftnessInputs,
} from './lib/scoring.mjs';

function classifiedFixture(pattern, uniqueDomainCount) {
  const classified = {
    directories: { links: [] },
    organicHomePages: { count: 0, nicheRelevantCount: 0, links: [] },
    organicSubPages: { links: [] },
    uniqueOrganicDomains: Array.from({ length: uniqueDomainCount }, (_, i) => `domain-${i}.test`),
    uniqueNicheOrganicDomains: [],
  };

  pattern.forEach((type, index) => {
    const link = { rankAbsolute: index + 1 };
    if (type === 'D') classified.directories.links.push(link);
    else if (type === 'H' || type === 'Xh') {
      classified.organicHomePages.links.push({ ...link, nicheRelevant: type === 'H' });
      classified.organicHomePages.count += 1;
      if (type === 'H') classified.organicHomePages.nicheRelevantCount += 1;
    } else {
      classified.organicSubPages.links.push({ ...link, nicheRelevant: type === 'S' });
    }
  });
  return classified;
}

function score(pattern, breadth) {
  return scoreCompetition({ classifiedSerp: classifiedFixture(pattern, breadth) }).score;
}

const syntheticGoldens = [
  ['A empty', [], 0, null],
  ['B ten directories', Array(10).fill('D'), 0, 9.1],
  ['C ten niche homepages', Array(10).fill('H'), 10, 1.8],
  ['D homepage #1', ['H', ...Array(9).fill('D')], 1, 7.7],
  ['E homepage #10', [...Array(9).fill('D'), 'H'], 1, 8.9],
  ['F ten niche subpages', Array(10).fill('S'), 10, 7.6],
  ['G ten non-niche subpages', Array(10).fill('X'), 10, 6.3],
  ['H five top homepages', [...Array(5).fill('H'), ...Array(5).fill('D')], 5, 3.5],
  ['I five top directories', [...Array(5).fill('D'), ...Array(5).fill('H')], 5, 7.3],
];

for (const [name, pattern, breadth, expected] of syntheticGoldens) {
  assert.equal(score(pattern, breadth), expected, name);
}

const patternJ = ['Xh', 'S', 'D', 'S', 'D', 'S', 'D', 'S', 'D', 'S'];
// n=9: p=36/55, T=6.8909ΓÇª, U=5.05, top-five h=10/40, Hterm=8.25.
// Math.round((.70*T + .10*U + .20*Hterm) * 10) / 10 = 7.0.
assert.equal(score(patternJ, 9), 7.0, 'J Xh #1 with favorable S/D below');
assert.equal(
  score(['X', ...patternJ.slice(1)], 9),
  7.7,
  'J control proves Xh is homepage occupancy and is not X',
);

const hAtSix = ['S', 'D', 'S', 'D', 'S', 'H', 'S', 'D', 'S', 'D'];
const hAtOne = ['H', 'D', 'S', 'D', 'S', 'S', 'S', 'D', 'S', 'D'];
assert.equal(score(hAtSix, 10), 7.5, 'K H only at #6');
assert.equal(score(hAtOne, 10), 6.8, 'K comparison H at #1');
assert.ok(score(hAtSix, 10) - score(hAtOne, 10) >= 0.5, 'H #6 is materially more open');

const tiedSources = classifiedFixture([], 0);
tiedSources.directories.links.push({ rankAbsolute: 3 });
tiedSources.organicHomePages.links.push({ rankAbsolute: 3, nicheRelevant: true });
tiedSources.organicSubPages.links.push({ rankAbsolute: 3, nicheRelevant: true });
assert.equal(
  scoreCompetition({ classifiedSerp: tiedSources }).pattern,
  'D/H/S',
  'equal raw ranks use directory, homepage, subpage precedence',
);

const stageOneClassified = classifiedFixture(patternJ, 9);
stageOneClassified.uniqueNicheOrganicDomains = [];
const softnessInputs = stageOneSoftnessInputs(stageOneClassified);
assert.deepEqual(
  softnessInputs,
  { uniqueOrganicDomainCount: 0, organicHomePageCount: 0 },
  'Stage-1 softness preserves valid zero niche counts instead of falling through to all domains',
);

const stageOneScoring = buildResearchScoring({
  clusterVolumeSum: 250,
  mapPackPresent: false,
  classifiedSerp: stageOneClassified,
  softnessUniqueOrganicDomainCount: softnessInputs.uniqueOrganicDomainCount,
  softnessOrganicHomePageCount: softnessInputs.organicHomePageCount,
  averageJobUsd: 8000,
});
assert.equal(stageOneScoring.scoreInputs.competition, 7.0, 'Stage 1 produces decimal M3 Openness');
assert.equal(stageOneScoring.serpSoftness.id, 'soft', 'Stage-1 softness uses niche-domain zero');

const research = {
  volumes: { clusterVolumeSum: 250 },
  serp: {
    mapPackPresent: false,
    uniqueOrganicDomains: stageOneClassified.uniqueOrganicDomains,
    organicHomePages: { count: 0 },
  },
  scoring: stageOneScoring,
};
const highRankEnrichment = {
  displaceability: { score: 3, medianDomainRank: 80, hint: 'synthetic high Rank' },
};
const stageTwoHighRank = applyEnrichmentToScoring(research, highRankEnrichment);
assert.equal(stageTwoHighRank.scoreInputs.competition, 7.0, 'Stage 2 preserves Stage-1 competition');
assert.equal(stageTwoHighRank.displaceability.score, 3, 'Stage 2 may update displaceability');
assert.equal(stageTwoHighRank.scoreInputs.demand, stageOneScoring.scoreInputs.demand, 'demand unchanged');
assert.equal(
  stageTwoHighRank.scoreInputs.mapPackGap,
  stageOneScoring.scoreInputs.mapPackGap,
  'Map Pack gap unchanged',
);
assert.equal(stageTwoHighRank.scoreInputs.jobValue, 8, 'existing job value is preserved');
assert.equal(
  stageTwoHighRank.serpSoftness.id,
  'hard',
  'Stage-2 softness retains Rover 1.0 all-domain semantics rather than Stage-1 softness',
);

const lowRankEnrichment = {
  displaceability: { score: 7, medianDomainRank: 10, hint: 'synthetic low Rank' },
};
const stageTwoLowRank = applyEnrichmentToScoring(research, lowRankEnrichment);
assert.equal(stageTwoLowRank.scoreInputs.competition, 7.0, 'low median Rank cannot nudge competition');
assert.equal(stageTwoLowRank.displaceability.score, 7, 'low Rank remains available to Displaceability');
assert.equal(stageTwoLowRank.serpSoftness.id, 'hard', 'Stage-2 softness is unchanged by Rank');

// Port-safety: directly execute production Domain Rank branches in scoreDisplaceability.
// The enrichment pass-through tests above use hardcoded displaceability scores and cannot
// detect accidental removal of Rank arithmetic inside scoreDisplaceability itself.
function displaceabilityPage(domainRank) {
  return {
    kind: 'organic',
    strengthLabel: 'moderate',
    thinnessScore: 5,
    domainRank,
    pageRank: null,
    fetchFailed: false,
    signals: {
      fetched: true,
      fetchFailed: false,
      wordCount: 1000,
    },
  };
}
const displaceHigh = scoreDisplaceability([displaceabilityPage(80)]);
const displaceNeutral = scoreDisplaceability([displaceabilityPage(30)]);
const displaceLow = scoreDisplaceability([displaceabilityPage(10)]);
const displaceMissing = scoreDisplaceability([displaceabilityPage(null)]);
assert.equal(displaceHigh.score, 4, 'high Domain Rank lowers Displaceability');
assert.equal(displaceNeutral.score, 5, 'neutral Domain Rank leaves base Displaceability');
assert.equal(displaceLow.score, 6, 'low Domain Rank raises Displaceability');
assert.equal(displaceMissing.score, 5, 'missing Domain Rank leaves base Displaceability');
assert.equal(displaceHigh.score, displaceNeutral.score - 1);
assert.equal(displaceLow.score, displaceNeutral.score + 1);
assert.equal(displaceLow.score - displaceHigh.score, 2);
assert.equal(displaceMissing.score, displaceNeutral.score);
assert.equal(displaceHigh.medianDomainRank, 80);
assert.equal(displaceNeutral.medianDomainRank, 30);
assert.equal(displaceLow.medianDomainRank, 10);
assert.equal(displaceMissing.medianDomainRank, null);

console.log('PASS test-openness: synthetic M3, input split, softness, Stage-2 preservation, and Displaceability Rank');
