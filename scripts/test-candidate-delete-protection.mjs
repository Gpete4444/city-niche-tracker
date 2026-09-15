/**
 * Launched candidates stay undeletable; unlaunched Website can be wiped
 * (Rover files + local assembled folder).
 * Run: node scripts/test-candidate-delete-protection.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createCandidate,
  deleteCandidates,
  loadMeta,
  pathsFor,
  saveMeta,
} from '../ops/lib/candidates.mjs';
import {
  assertDeletableIds,
  isUndeletableCandidate,
} from '../ops/lib/candidate-protection.mjs';

const ROOT = process.cwd();
const stamp = Date.now().toString(36);
const ids = [];

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

const sitesRoot = mkdtempSync(path.join(os.tmpdir(), 'rover-del-sites-'));
process.env.ASSEMBLED_SITES_DIR = sitesRoot;

async function cleanup() {
  for (const id of ids) {
    try {
      saveMeta(id, { lastLaunchAt: null, lastShipAt: null });
    } catch {
      /* gone */
    }
    try {
      await deleteCandidates([id]);
    } catch {
      /* ignore */
    }
  }
  try {
    rmSync(sitesRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

try {
  const researchId = `__test-del-research-${stamp}`;
  ids.push(researchId);
  createCandidate({
    niche: 'Gutter Cleaning',
    primary: 'Testville,TX',
    id: researchId,
  });
  assert(!isUndeletableCandidate(researchId), 'research-only is deletable');
  assertDeletableIds([researchId]);
  const researchPaths = pathsFor(researchId);
  const researchResult = await deleteCandidates([researchId]);
  assertEqual(researchResult.deleted.length, 1, 'research deleted count');
  assertEqual(researchResult.errors.length, 0, 'research errors');
  assert(!existsSync(researchPaths.meta), 'research meta gone');
  assert(!existsSync(researchPaths.config), 'research config gone');

  const websiteId = `__test-del-website-${stamp}`;
  ids.push(websiteId);
  createCandidate({
    niche: 'Artificial Grass Installation',
    primary: 'Surprise,AZ',
    id: websiteId,
    decision: 'pursue',
  });
  const websitePaths = pathsFor(websiteId);
  writeFileSync(websitePaths.siteConfig, `${JSON.stringify({ niche: 'Artificial Grass Installation' }, null, 2)}\n`);
  const siteDir = path.join(sitesRoot, 'surprise-grass');
  mkdirSync(siteDir, { recursive: true });
  writeFileSync(path.join(siteDir, 'index.html'), '<html></html>\n');
  saveMeta(websiteId, {
    assembledSitePath: path.relative(ROOT, siteDir).replace(/\\/g, '/'),
  });
  assert(loadMeta(websiteId).decision === 'pursue', 'website pursue');
  assert(!isUndeletableCandidate(websiteId), 'unlaunched website is deletable');
  assertDeletableIds([websiteId]);
  assert(existsSync(siteDir), 'assembled dir exists before delete');
  const websiteResult = await deleteCandidates([websiteId]);
  assertEqual(websiteResult.deleted.length, 1, 'website deleted count');
  assertEqual(websiteResult.errors.length, 0, 'website errors');
  assert(!existsSync(websitePaths.meta), 'website meta gone');
  assert(!existsSync(websitePaths.siteConfig), 'website site-config gone');
  assert(!existsSync(siteDir), 'assembled dir removed');

  const launchedId = `__test-del-launched-${stamp}`;
  ids.push(launchedId);
  createCandidate({
    niche: 'Drywall Repair',
    primary: 'Phoenix,AZ',
    id: launchedId,
    decision: 'pursue',
  });
  const launchedPaths = pathsFor(launchedId);
  writeFileSync(launchedPaths.siteConfig, `${JSON.stringify({ niche: 'Drywall Repair' }, null, 2)}\n`);
  const launchedDir = path.join(sitesRoot, 'phoenix-drywall');
  mkdirSync(launchedDir, { recursive: true });
  writeFileSync(path.join(launchedDir, 'index.html'), '<html></html>\n');
  saveMeta(launchedId, {
    lastLaunchAt: new Date().toISOString(),
    assembledSitePath: path.relative(ROOT, launchedDir).replace(/\\/g, '/'),
  });
  assert(isUndeletableCandidate(launchedId), 'launched is undeletable');
  let blocked = false;
  try {
    assertDeletableIds([launchedId]);
  } catch (err) {
    blocked = err.code === 'UNDELETABLE_CANDIDATE' && err.status === 409;
    assert(/Launched Candidate/.test(err.message), 'launched error text');
  }
  assert(blocked, 'assertDeletableIds throws for launched');
  const launchedResult = await deleteCandidates([launchedId]);
  assertEqual(launchedResult.deleted.length, 0, 'launched not deleted');
  assertEqual(launchedResult.errors.length, 1, 'launched error recorded');
  assert(existsSync(launchedPaths.meta), 'launched meta kept');
  assert(existsSync(launchedPaths.siteConfig), 'launched site-config kept');
  assert(existsSync(launchedDir), 'launched assembled dir kept');

  saveMeta(launchedId, { lastLaunchAt: null, lastShipAt: null });
  assert(!isUndeletableCandidate(launchedId), 'cleared launch becomes deletable');

  console.log('test-candidate-delete-protection: ok');
} finally {
  await cleanup();
}
