/**
 * Cheap required Research path: SERP seeds without Ads/Enrich/Prospects.
 * Run: node scripts/test-skip-optional-evals.mjs
 */
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createCandidate,
  deleteCandidates,
  deriveStage,
  pathsFor,
  researchHasAdsVolumes,
} from '../ops/lib/candidates.mjs';
import {
  parseEstimatedMonthlySearchVolume,
} from './lib/estimated-volume.mjs';
import { buildResearchScoring, scoreDemand } from './lib/scoring.mjs';
import { assertEvalPrerequisite } from '../ops/lib/candidate-protection.mjs';
import { applyResearchSeoSeeds } from '../ops/lib/content-structure.mjs';
import { recommendFromScoreAndStages } from '../ops/lib/discovery-recommend.mjs';
import {
  missingEvalAllSteps,
  normalizeEvalRunMode,
} from '../ops/lib/eval-run-mode.mjs';
import { ensureResearchSerpSeeds } from '../ops/lib/serp-seeds.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

assertEqual(normalizeEvalRunMode(undefined), 'required', 'default required');
assertEqual(normalizeEvalRunMode('all'), 'all', 'all');
assertEqual(normalizeEvalRunMode('required'), 'required', 'required');

assertEqual(parseEstimatedMonthlySearchVolume('2400').value, 2400, 'parse integer');
assertEqual(parseEstimatedMonthlySearchVolume('1,800-3,200').value, 2500, 'parse range midpoint');
assertEqual(parseEstimatedMonthlySearchVolume('1800 to 3200').value, 2500, 'parse to range');
assertEqual(parseEstimatedMonthlySearchVolume('').value, null, 'parse blank');
assertEqual(parseEstimatedMonthlySearchVolume('n/a').value, null, 'parse junk');
assertEqual(scoreDemand(2400), 10, '2400 → demand 10');

const openSerp = {
  directories: { links: [{ rankAbsolute: 1 }] },
  organicHomePages: { links: [] },
  organicSubPages: { links: [] },
  uniqueOrganicDomains: ['example.com'],
};

const skippedNoEst = buildResearchScoring({
  clusterVolumeSum: 0,
  primaryVolumeSum: 0,
  volumesSkipped: true,
  mapPackPresent: false,
  classifiedSerp: openSerp,
});
assertEqual(skippedNoEst.scoreInputs.demand, null, 'skip + no estimate → Demand null');
assertEqual(skippedNoEst.proposedScore, null, 'skip + no estimate → Overall null');
assertEqual(skippedNoEst.scoreInputs.demandSource, null, 'no demandSource');

const skippedEst = buildResearchScoring({
  clusterVolumeSum: 0,
  primaryVolumeSum: 0,
  volumesSkipped: true,
  estimatedDemandVolume: 2400,
  mapPackPresent: false,
  classifiedSerp: openSerp,
});
assertEqual(skippedEst.scoreInputs.demand, 10, 'skip + 2400 → Demand 10');
assertEqual(skippedEst.scoreInputs.demandSource, 'claude_estimate', 'demandSource estimate');
assert(skippedEst.proposedScore != null, 'skip + estimate → Overall present');
assertEqual(skippedEst.demandBand.demandVolumeSum, null, 'Ads demandVolumeSum stays null');

const adsWins = buildResearchScoring({
  clusterVolumeSum: 80,
  primaryVolumeSum: 80,
  volumesSkipped: false,
  estimatedDemandVolume: 2400,
  mapPackPresent: false,
  classifiedSerp: openSerp,
});
assertEqual(adsWins.scoreInputs.demandSource, 'ads', 'Ads present ignores Claude estimate source');
assert(adsWins.scoreInputs.demand !== 10, 'Ads 80/mo is not scored as 2400');

assert(!researchHasAdsVolumes(null), 'null volumes');
assert(!researchHasAdsVolumes({ volumes: { volumesSkipped: true, keywords: [] } }), 'skipped');
assert(
  researchHasAdsVolumes({ volumes: { volumesSkipped: false, primaryVolumeSum: 1200, keywords: [] } }),
  'measured',
);

const rec = recommendFromScoreAndStages({
  hasResearch: true,
  hasEnrichment: false,
  hasNarrative: true,
  score: 7.2,
});
assertEqual(rec.recommended_decision, 'pursue', 'recommend without enrich');

const incomplete = recommendFromScoreAndStages({
  hasResearch: true,
  hasEnrichment: false,
  hasNarrative: false,
  score: 8,
});
assertEqual(incomplete.recommended_decision, 'review', 'review without narrative');

const outline = {
  keywords: { primary: 'trenchless sewer', supporting: [], city: 'Louisville, KY', volumeHints: [] },
  keywordTargets: [],
  sections: [],
};
applyResearchSeoSeeds(
  outline,
  {
    research: {
      volumes: { volumesSkipped: true, keywords: [] },
      serp: { peopleAlsoAskQuestions: ['How much does lining cost?'] },
    },
    approved: { suggestedKeywords: ['sewer lining louisville', 'pipe bursting cost'] },
  },
  { sections: [] },
);
assert(outline.keywords.supporting.includes('sewer lining louisville'), 'suggested keyword seed');
assert(outline.faqSeeds?.some((q) => /lining/i.test(q)), 'PAA faq seed');

const stamp = Date.now().toString(36);
const cacheDir = path.join(os.tmpdir(), `rover-serp-cache-${stamp}`);
mkdirSync(cacheDir, { recursive: true });
const cachePath = path.join(cacheDir, 'row.json');
writeFileSync(
  cachePath,
  `${JSON.stringify({
    at: new Date().toISOString(),
    classified: {
      mapPackPresent: false,
      organicHomePages: { count: 2, links: [{ title: 'Acme Trenchless', url: 'https://example.com' }] },
      organicSubPages: { count: 1, links: [] },
      directories: { count: 0, links: [] },
      uniqueOrganicDomains: ['example.com'],
      peopleAlsoAskQuestions: ['What is trenchless repair?'],
      organicTitles: ['Acme Trenchless Louisville'],
    },
    itemTypes: ['organic'],
    items: [],
    checkUrl: null,
  })}\n`,
  'utf8',
);

const id = `__test-skip-opt-${stamp}`;
try {
  createCandidate({
    niche: 'Trenchless Sewer Repair',
    primary: 'Louisville,KY',
    id,
    serpCache: cachePath,
  });
  const flags0 = deriveStage(id);
  assert(!flags0.hasResearch, 'no research yet');
  assert(!flags0.hasVolumes, 'no volumes yet');

  let threw = false;
  try {
    assertEvalPrerequisite(id, 'narrative');
  } catch {
    threw = true;
  }
  assert(threw, 'narrative blocked without seeds');

  const hydrated = ensureResearchSerpSeeds(id);
  assert(hydrated.ready, 'hydrate ready');
  assertEqual(hydrated.source, 'discovery_cache', 'hydrate from cache');
  const flags1 = deriveStage(id);
  assert(flags1.hasResearch, 'hasResearch after hydrate');
  assert(!flags1.hasVolumes, 'hasVolumes false after hydrate');
  assert(hydrated.research?.volumes?.volumesSkipped === true, 'volumesSkipped true');
  assertEqual(hydrated.research?.scoring?.scoreInputs?.demand, null, 'hydrate without estimate → Demand null');
  assertEqual(hydrated.research?.proposedScore, null, 'hydrate without estimate → Overall null');
  assert(!researchHasAdsVolumes(hydrated.research), 'estimate path is not Ads volumes');

  const seedPath = pathsFor(id).discoverySeed;
  writeFileSync(
    seedPath,
    `${JSON.stringify({
      source: 'discovery_claude',
      estimatedMonthlySearchVolume: 2400,
      estimatedMonthlySearchVolumeRaw: '2400',
      estimatedVolumeSource: 'discovery_claude',
    })}\n`,
    'utf8',
  );
  unlinkSync(pathsFor(id).research);
  const hydratedEst = ensureResearchSerpSeeds(id);
  assert(hydratedEst.ready, 'rehydrate ready');
  assertEqual(hydratedEst.research?.scoring?.scoreInputs?.demand, 10, 'hydrate + 2400 → Demand 10');
  assertEqual(
    hydratedEst.research?.scoring?.scoreInputs?.demandSource,
    'claude_estimate',
    'hydrate demandSource estimate',
  );
  assertEqual(hydratedEst.research?.volumes?.demandVolumeSum, null, 'Ads demandVolumeSum stays null');
  assertEqual(hydratedEst.research?.volumes?.estimatedMonthlySearchVolume, 2400, 'estimate persisted on volumes');
  assert(!researchHasAdsVolumes(hydratedEst.research), 'Claude estimate does not flip hasVolumes');
  assert(!deriveStage(id).hasVolumes, 'hasVolumes still false with estimate');

  assertEvalPrerequisite(id, 'narrative');

  assertEqual(missingEvalAllSteps(id, 'required').join(','), 'narrative', 'required missing narrative');
  assert(
    missingEvalAllSteps(id, 'all').includes('research'),
    'all mode still wants Ads volumes',
  );
  assert(missingEvalAllSteps(id, 'all').includes('enrich'), 'all wants enrich');
} finally {
  try {
    await deleteCandidates([id]);
  } catch {
    /* ignore */
  }
  rmSync(cacheDir, { recursive: true, force: true });
}

console.log('test-skip-optional-evals: ok');
