/**
 * Root niche rename; after Eval 1 require confirmAfterEval.
 * Run: node scripts/test-rename-candidate-niche.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import {
  createCandidate,
  deleteCandidates,
  isResearchEvalStarted,
  listCandidates,
  pathsFor,
  renameCandidateNiche,
} from '../ops/lib/candidates.mjs';

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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

assert(!isResearchEvalStarted(null), 'no research unlocked');
assert(
  !isResearchEvalStarted({ niche: 'Drywall Installation', primaryCity: 'Springfield', state: 'IL' }),
  'stub without SERP unlocked',
);
assert(isResearchEvalStarted({ serp: { organic: [] } }), 'serp locks');
assert(isResearchEvalStarted({ volumes: { keywords: [] } }), 'volumes lock');
assert(isResearchEvalStarted({}, { hasEnrichment: true }), 'enrich locks');
assert(isResearchEvalStarted({}, { hasSiteConfig: true }), 'site-config locks');

const id = `__test-niche-rename-${Date.now().toString(36)}`;
try {
  createCandidate({
    niche: 'Drywall Installation',
    primary: 'Testville,TX',
    id,
  });
  const renamed = renameCandidateNiche(id, 'Drywall Repair');
  assertEqual(renamed.niche, 'Drywall Repair', 'rename return');
  const p = pathsFor(id);
  assertEqual(readJson(p.config).niche, 'Drywall Repair', 'config niche');
  assertEqual(readJson(p.meta).niche, 'Drywall Repair', 'meta niche');
  const row = listCandidates({ force: true }).find((c) => c.id === id);
  assertEqual(row?.niche, 'Drywall Repair', 'list niche');
  assert(!row?.nicheRenameLocked, 'list unlocked before eval');

  let locked = false;
  try {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      p.research,
      `${JSON.stringify({
        niche: 'Drywall Repair',
        primaryCity: 'Testville',
        state: 'TX',
        volumes: { keywords: [{ keyword: 'drywall repair', volume: 10 }] },
      }, null, 2)}\n`,
      'utf8',
    );
    renameCandidateNiche(id, 'Sheetrock Repair');
  } catch (err) {
    locked = err.code === 'NICHE_LOCKED' || /locked/i.test(err.message);
    assertEqual(err.status, 400, 'locked status');
  }
  assert(locked, 'rename after volumes without confirm is locked');
  assertEqual(readJson(p.config).niche, 'Drywall Repair', 'locked keeps prior niche');

  const confirmed = renameCandidateNiche(id, 'Sheetrock Repair', { confirmAfterEval: true });
  assertEqual(confirmed.niche, 'Sheetrock Repair', 'confirmAfterEval rename');
  assertEqual(readJson(p.config).niche, 'Sheetrock Repair', 'confirmed config');
  assertEqual(readJson(p.research).niche, 'Sheetrock Repair', 'research label only');
  assert(Array.isArray(readJson(p.research).volumes?.keywords), 'volumes not wiped');
  const rowAfter = listCandidates({ force: true }).find((c) => c.id === id);
  assertEqual(rowAfter?.niche, 'Sheetrock Repair', 'list after confirm');
} finally {
  if (existsSync(pathsFor(id).config) || existsSync(pathsFor(id).meta)) {
    await deleteCandidates([id]);
  }
}

console.log('test-rename-candidate-niche: ok');
