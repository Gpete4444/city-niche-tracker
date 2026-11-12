/**
 * Zone guide storage, commit copy, and prompt inclusion. Does not call Claude.
 * Run: node scripts/test-zone-guide.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deleteGroup } from '../ops/lib/candidate-groups.mjs';
import { buildCopyPrompt, pathsFor } from '../ops/lib/candidates.mjs';
import { injectEightPassContext, buildFieldResearchPrompt, buildSoftBriefPrompt } from '../ops/lib/content-eight-pass.mjs';
import { commitShotgunZoneForBatch } from '../ops/lib/discovery.mjs';
import { buildAssignCitiesPrompt, buildFindHubsPrompt, seedDiscoveryPackFromZone } from '../ops/lib/discovery-shotgun.mjs';
import { buildDomainPickPrompt, buildSiteConfigPrompt } from '../ops/lib/site-config.mjs';
import {
  loadShotgunClusters,
  saveShotgunDraft,
  setShotgunClustersFileForTests,
} from '../ops/lib/shotgun.mjs';
import {
  acceptZoneGuide,
  acceptedZoneGuideForCandidate,
  copyZoneGuideFromBatch,
  readZoneGuide,
  saveZoneGuideProposed,
  saveZoneGuideSource,
  setZoneGuidesDirForTests,
  zoneGuideBlockForCandidate,
  zoneGuideDistillJobFields,
} from '../ops/lib/zone-guide.mjs';
import { finishLightJob, getLightJob, openLightJob } from '../ops/lib/rover-light-jobs.mjs';

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const BRIEF = `# Zone brief

## Market
Wasatch foundation repair.

## Cities
- Prefer: Provo — PREFER_PROVO_TOKEN older homes

## Homepage
Homepage stays on foundation repair. HOMEPAGE_FOUNDATION_TOKEN
Do not put concrete lifting in the homepage H1.

## Services
Primary:
- Foundation repair
Secondary:
- Driveway lifting DRIVEWAY_LIFT_TOKEN

## Terminology
Use polyjacking. POLYJACK_TOKEN

## Local angles
Freeze-thaw FREEZE_THAW_TOKEN

## Symptom themes
Driveway sinking near the garage.
`;

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function batch(id, niche) {
  const dir = path.join(process.cwd(), 'research', 'batches', id);
  mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, 'meta.json'), {
    id,
    createdAt: new Date().toISOString(),
    stage: 'discovery_pack',
    filters: { packType: 'cluster', shotgunNiche: niche, requiredNiches: [niche] },
    files: {},
  });
  return dir;
}

const stamp = Date.now().toString(36);
const guidesDir = mkdtempSync(path.join(os.tmpdir(), 'rover-zone-guide-'));
const clustersFile = path.join(guidesDir, 'shotgun-clusters.json');
const batchIds = [];
const candidateId = `zg${stamp}`;
const outsiderId = `zgout${stamp}`;
const zoneId = `sg_guide_${stamp}`;
let groupIds = [];

setZoneGuidesDirForTests(guidesDir);
setShotgunClustersFileForTests(clustersFile);
writeJson(clustersFile, {
  clusters: [
    {
      id: zoneId,
      niche: `Guide Niche ${stamp}`,
      name: `Zone · Guide Niche ${stamp} · Provo UT`,
      sgNumber: 3,
      hub: { city: 'Provo', state: 'UT' },
      planningGuideUpdatedAt: null,
      members: [
        { city: 'Provo', state: 'UT', role: 'hub', candidateId },
        { city: 'Lehi', state: 'UT', role: 'member', clusterKey: 1 },
      ],
    },
  ],
});

try {
  const savedSource = saveZoneGuideSource('zone', zoneId, 'SOURCE_ONLY_TOKEN pitch script');
  assert(!savedSource.acceptedAt, 'saving source does not accept a brief');
  assert(savedSource.accepted === '', 'source save leaves the accepted brief empty');
  assert(acceptedZoneGuideForCandidate(candidateId) === '', 'prompts ignore the source');
  assert(zoneGuideBlockForCandidate(outsiderId, 'full') === '', 'a candidate outside the zone gets no brief');

  saveZoneGuideProposed('zone', zoneId, '## Market\nPROPOSED_ONLY_TOKEN');
  assert(!acceptedZoneGuideForCandidate(candidateId).includes('PROPOSED_ONLY_TOKEN'), 'prompts ignore a proposal');

  const live = acceptZoneGuide('zone', zoneId, BRIEF);
  assert(live.briefState === 'accepted', 'accept marks the brief live');
  assert(loadShotgunClusters().clusters[0].planningGuideUpdatedAt === live.acceptedAt, 'zone row stores the accept time');
  const liveText = acceptedZoneGuideForCandidate(candidateId);
  assert(liveText.includes('PREFER_PROVO_TOKEN'), 'a member reads the accepted brief');
  assert(!liveText.includes('SOURCE_ONLY_TOKEN'), 'the accepted brief is not the source');
  assert(!liveText.includes('PROPOSED_ONLY_TOKEN'), 'accept does not keep the proposal');
  assert(zoneGuideBlockForCandidate(outsiderId, 'cities') === '', 'an empty zone lookup stays empty');

  const cities = zoneGuideBlockForCandidate(candidateId, 'cities');
  assert(cities.includes('PREFER_PROVO_TOKEN'), 'city prompts get Market and Cities');
  assert(!cities.includes('DRIVEWAY_LIFT_TOKEN'), 'city prompts skip the service list');
  const services = zoneGuideBlockForCandidate(candidateId, 'site-config');
  assert(services.includes('DRIVEWAY_LIFT_TOKEN'), 'site config gets Services');
  assert(services.includes('HOMEPAGE_FOUNDATION_TOKEN'), 'site config gets Homepage');
  assert(!services.includes('FREEZE_THAW_TOKEN'), 'site config skips local angles');
  const rules = zoneGuideBlockForCandidate(candidateId, 'rules');
  assert(rules.includes('HOMEPAGE_FOUNDATION_TOKEN'), 'write rules include the homepage constraint');
  assert(rules.includes('POLYJACK_TOKEN'), 'write rules include terminology');
  assert(!rules.includes('FREEZE_THAW_TOKEN'), 'write rules skip the long local-angle section');

  const findId = `zgfind${stamp}`;
  batchIds.push(findId);
  const findDir = batch(findId, `Guide Niche ${stamp}`);
  saveShotgunDraft(findDir, {
    strategy: 'cluster',
    niche: `Guide Niche ${stamp}`,
    hub: { city: 'Provo', state: 'UT', population: 115000 },
    members: [{ city: 'Provo', state: 'UT', role: 'hub' }],
    clusterMiles: 30,
    innerMiles: 30,
    outerMiles: 30,
  });
  acceptZoneGuide('batch', findId, BRIEF);
  saveZoneGuideSource('batch', findId, 'SOURCE_ONLY_TOKEN');
  saveZoneGuideProposed('batch', findId, '## Cities\nPROPOSED_ONLY_TOKEN');
  const findPrompt = buildFindHubsPrompt(findId, { api: false });
  assert(findPrompt.includes('PREFER_PROVO_TOKEN'), 'find hubs includes the accepted city bias');
  assert(!findPrompt.includes('{{ZONE_GUIDE}}'), 'find hubs replaces the placeholder');
  assert(!findPrompt.includes('SOURCE_ONLY_TOKEN'), 'find hubs does not read the source');
  assert(!findPrompt.includes('PROPOSED_ONLY_TOKEN'), 'find hubs does not read the proposal');
  const assignPrompt = buildAssignCitiesPrompt(findId, { api: false }).prompt;
  assert(assignPrompt.includes('PREFER_PROVO_TOKEN'), 'assign cities includes the accepted city bias');
  assert(!assignPrompt.includes('PROPOSED_ONLY_TOKEN'), 'assign cities does not read the proposal');

  const p = pathsFor(candidateId);
  writeJson(p.research, { niche: 'Foundation Repair', primaryCity: 'Provo', state: 'UT' });
  writeJson(p.meta, { decision: 'pursue' });
  writeJson(p.narrative, { niche: 'Foundation Repair', city: 'Provo', state: 'UT' });
  writeJson(p.approved, {
    niche: 'Foundation Repair',
    city: 'Provo',
    primaryCity: 'Provo',
    state: 'UT',
    suggestedServices: ['Foundation repair'],
  });
  writeJson(p.siteConfig, {
    businessName: 'Provo Foundation',
    niche: 'Foundation Repair',
    primaryCity: 'Provo',
    state: 'UT',
    services: ['Foundation Repair'],
    domain: 'provofoundation.test',
  });
  writeJson(p.contentStructure, { sections: [{ id: 'hero', heading: 'Hero' }], pages: ['home'] });
  writeJson(p.contentFieldResearch, {
    status: 'loaded',
    homeownerQuestions: ['Why is the driveway sinking?', 'What is polyjacking?', 'Is the wall cracked?'],
  });
  writeJson(path.join(path.dirname(p.research), `${p.id}-city-context.json`), {
    builtAt: new Date().toISOString(),
    places: [{ name: 'Provo', isPrimary: true }],
  });

  const sitePrompt = buildSiteConfigPrompt(candidateId, {
    businessName: 'Provo Foundation',
    domain: 'provofoundation.test',
  }).prompt;
  assert(sitePrompt.includes('DRIVEWAY_LIFT_TOKEN'), 'site-config prompt includes secondary services');
  assert(!sitePrompt.includes('FREEZE_THAW_TOKEN'), 'site-config prompt skips local angles');
  assert(!sitePrompt.includes('{{ZONE_GUIDE}}'), 'site-config prompt replaces the placeholder');
  const domainPrompt = buildDomainPickPrompt(candidateId, { businessName: 'Provo Foundation' }).prompt;
  assert(domainPrompt.includes('HOMEPAGE_FOUNDATION_TOKEN'), 'domain pick keeps the primary niche');
  assert(!domainPrompt.includes('DRIVEWAY_LIFT_TOKEN'), 'domain pick does not get the service list');
  const narrative = buildCopyPrompt(candidateId);
  assert(narrative.includes('FREEZE_THAW_TOKEN'), 'narrative prompt gets the full brief');
  assert(narrative.includes('PREFER_PROVO_TOKEN'), 'narrative prompt keeps city guidance');
  assert(!narrative.includes('SOURCE_ONLY_TOKEN'), 'narrative prompt skips the source');
  const field = await buildFieldResearchPrompt(candidateId);
  assert(field.prompt.includes('FREEZE_THAW_TOKEN'), 'field research gets the full brief');
  assert(!field.prompt.includes('SOURCE_ONLY_TOKEN'), 'field research skips the source');
  const soft = await buildSoftBriefPrompt(candidateId);
  assert(soft.prompt.includes('POLYJACK_TOKEN'), 'content brief gets the full brief');
  assert(!soft.prompt.includes('PROPOSED_ONLY_TOKEN'), 'content brief skips the proposal');
  const eight = injectEightPassContext(candidateId);
  assert(eight.prefix.includes('HOMEPAGE_FOUNDATION_TOKEN'), 'write context includes zone rules');
  assert(eight.prefix.includes('POLYJACK_TOKEN'), 'write context includes terminology');
  assert(!eight.prefix.includes('FREEZE_THAW_TOKEN'), 'write context does not paste the whole brief');
  assert(!eight.prefix.includes('SOURCE_ONLY_TOKEN'), 'write context skips the source');

  const commitId = `zgcommit${stamp}`;
  batchIds.push(commitId);
  const commitDir = batch(commitId, `Commit Guide ${stamp}`);
  saveShotgunDraft(commitDir, {
    strategy: 'cluster',
    niche: `Commit Guide ${stamp}`,
    hub: { city: 'Lehi', state: 'UT', population: 80000 },
    members: [
      { city: 'Lehi', state: 'UT', role: 'hub', population: 80000 },
      { city: 'Spanish Fork', state: 'UT', role: 'member', clusterKey: 1 },
    ],
    clusterMiles: 30,
    innerMiles: 30,
    outerMiles: 30,
  });
  acceptZoneGuide('batch', commitId, BRIEF);
  const committed = commitShotgunZoneForBatch(commitId);
  assert(committed?.id, 'process creates the zone');
  groupIds = [committed.groupId, ...Object.values(committed.packClusterGroups || {})].filter(Boolean);
  const copied = readZoneGuide('zone', committed.id);
  assert(copied.accepted.includes('PREFER_PROVO_TOKEN'), 'process copies the accepted brief onto the zone');
  assert(
    loadShotgunClusters().clusters.some((c) => c.id === committed.id && c.planningGuideUpdatedAt),
    'process stamps the zone accept time',
  );
  acceptZoneGuide('zone', committed.id, `${BRIEF}\nZONE_NEWER_TOKEN`);
  const skipped = copyZoneGuideFromBatch(commitId, committed.id);
  assert(skipped.copied === false, 'a newer zone brief is left in place');
  assert(
    readZoneGuide('zone', committed.id).accepted.includes('ZONE_NEWER_TOKEN'),
    'copy does not clobber a newer zone brief',
  );

  const sourceZone = `sg_src_${stamp}`;
  const reuseNiche = `Reuse Guide ${stamp}`;
  const registry = loadShotgunClusters();
  registry.clusters.push({
    id: sourceZone,
    niche: `Source Guide ${stamp}`,
    name: `Zone · Source Guide ${stamp} · Provo UT`,
    sgNumber: 8,
    hub: { city: 'Provo', state: 'UT' },
    members: [
      { city: 'Provo', state: 'UT', role: 'hub' },
      { city: 'Orem', state: 'UT', role: 'member', clusterKey: 2 },
    ],
  });
  writeJson(clustersFile, registry);
  acceptZoneGuide('zone', sourceZone, `${BRIEF}\nSOURCE_ZONE_TOKEN`);
  const reuseId = `zgreuse${stamp}`;
  batchIds.push(reuseId);
  batch(reuseId, reuseNiche);
  const seeded = seedDiscoveryPackFromZone(reuseId, sourceZone);
  assert(seeded.existing === false, 'a new niche stays a draft');
  const reusedGuide = readZoneGuide('batch', reuseId);
  assert(!reusedGuide.source.includes('SOURCE_ZONE_TOKEN'), 'reusing a zone does not copy its guide');
  assert(!reusedGuide.accepted.includes('SOURCE_ZONE_TOKEN'), 'reusing a zone does not copy the accepted brief');

  const zoneFields = zoneGuideDistillJobFields('zone', 'sg_zone1');
  assert(zoneFields.candidateId === 'zone-guide:sg_zone1', 'zone distill uses a zone job key');
  assert(!zoneFields.batchId, 'zone distill does not pretend to be a discovery batch');
  const batchFields = zoneGuideDistillJobFields('batch', 'batch-1');
  assert(batchFields.batchId === 'batch-1' && !batchFields.candidateId, 'batch distill stays on the batch id');
  const opened = openLightJob({
    ...zoneFields,
    phase: 'zone-guide-distill',
    label: 'Distill zone guide',
  });
  assert(opened.jobId, 'zone distill job opens without a real candidate');
  assert(
    getLightJob(opened.jobId)?.candidateId === 'zone-guide:sg_zone1',
    'zone distill job keeps the zone key',
  );
  finishLightJob(opened.jobId, { result: { ok: true } });

  console.log('zone guide tests passed');
} finally {
  setZoneGuidesDirForTests(null);
  setShotgunClustersFileForTests(null);
  for (const id of groupIds) {
    try {
      deleteGroup(id);
    } catch {
      /* already gone */
    }
  }
  for (const id of batchIds) {
    rmSync(path.join(process.cwd(), 'research', 'batches', id), { recursive: true, force: true });
  }
  const files = pathsFor(candidateId);
  for (const file of [
    files.research,
    files.meta,
    files.narrative,
    files.approved,
    files.siteConfig,
    files.contentStructure,
    files.contentFieldResearch,
    path.join(path.dirname(files.research), `${files.id}-city-context.json`),
  ]) {
    rmSync(file, { force: true });
  }
  rmSync(guidesDir, { recursive: true, force: true });
}
