/**
 * Reuse a painted zone on a new niche: draft first, zone number on process, same cluster keys, no copied sites.
 * Run: node scripts/test-zone-reuse.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deleteGroup } from '../ops/lib/candidate-groups.mjs';
import { titleCaseNiche } from '../ops/lib/candidates.mjs';
import { commitShotgunZoneForBatch } from '../ops/lib/discovery.mjs';
import {
  applyGeneratePackRows,
  seedDiscoveryPackFromZone,
} from '../ops/lib/discovery-shotgun.mjs';
import {
  loadShotgunClusters,
  loadShotgunDraft,
  setShotgunClustersFileForTests,
} from '../ops/lib/shotgun.mjs';

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function groupIdsIn(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const ids = [];
  for (const c of raw.clusters || []) {
    if (c.groupId) ids.push(c.groupId);
    for (const gid of Object.values(c.packClusterGroups || {})) {
      if (gid) ids.push(gid);
    }
  }
  return ids;
}

function withZones(clusters, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rover-zone-reuse-'));
  const file = path.join(dir, 'shotgun-clusters.json');
  writeFileSync(file, `${JSON.stringify({ clusters }, null, 2)}\n`);
  const batches = [];
  setShotgunClustersFileForTests(file);
  const batch = (id, niche) => {
    const batchDir = path.join(process.cwd(), 'research', 'batches', id);
    mkdirSync(batchDir, { recursive: true });
    writeFileSync(
      path.join(batchDir, 'meta.json'),
      `${JSON.stringify(
        {
          id,
          createdAt: new Date().toISOString(),
          stage: 'discovery_pack',
          filters: {
            packType: 'cluster',
            shotgunNiche: niche,
            requiredNiches: [niche],
          },
          files: {},
        },
        null,
        2,
      )}\n`,
    );
    batches.push(batchDir);
    return batchDir;
  };
  try {
    return fn({ file, batch });
  } finally {
    try {
      for (const id of groupIdsIn(file)) {
        try {
          deleteGroup(id);
        } catch {
          /* already gone */
        }
      }
    } catch {
      /* registry file missing */
    }
    setShotgunClustersFileForTests(null);
    for (const batchDir of batches) {
      rmSync(batchDir, { recursive: true, force: true });
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

function sourceZone() {
  return {
    id: 'sg_src',
    niche: 'Concrete',
    name: 'Zone · Concrete · Phoenix AZ',
    sgNumber: 4,
    hub: { city: 'Phoenix', state: 'AZ', population: 1600000 },
    clusterMiles: 42,
    bands: {
      hub: { min: 60000, max: 200000 },
      cities: { min: 2000, max: 60000 },
    },
    members: [
      { city: 'Phoenix', state: 'AZ', role: 'hub', population: 1600000 },
      {
        city: 'Mesa',
        state: 'AZ',
        role: 'member',
        clusterKey: 1,
        candidateId: 'cand_old',
        population: 504258,
      },
      { city: 'Gilbert', state: 'AZ', role: 'member', clusterKey: 2 },
      { city: 'Casa Grande', state: 'AZ', role: 'unassigned' },
    ],
  };
}

const stamp = Date.now().toString(36);
const niche = titleCaseNiche(`Zone Reuse ${stamp}`);

withZones(
  [
    sourceZone(),
    {
      id: 'sg_windows',
      niche: 'Windows',
      name: 'Zone · Windows · Tucson AZ',
      sgNumber: 9,
      hub: { city: 'Tucson', state: 'AZ' },
      members: [{ city: 'Tucson', state: 'AZ', role: 'hub' }],
    },
  ],
  ({ batch }) => {
    const batchDir = batch(`zone-reuse-new-${stamp}`, niche);
    const seeded = seedDiscoveryPackFromZone(`zone-reuse-new-${stamp}`, 'sg_src');
    assert(seeded.existing === false, 'new niche gets a draft');
    assert(seeded.cluster == null, 'draft does not create a zone');
    assert(loadShotgunClusters().clusters.length === 2, 'zone registry is unchanged until process');
    const draft = loadShotgunDraft(batchDir);
    assert(!draft.clusterId, 'draft has no zone id');
    assert(!draft.sgNumber, 'draft has no zone number');
    assert(draft.reusedFromZoneId === 'sg_src', 'records the source zone');
    assert(draft.niche === niche, 'draft niche is the new niche');
    assert(!JSON.stringify(draft.members).includes('cand_old'), 'does not copy site ids');
    const draftKeys = Object.fromEntries((draft.members || []).map((m) => [m.city, m.clusterKey]));
    assert(draftKeys.Mesa === 1 && draftKeys.Gilbert === 2, 'seeded draft keeps cluster keys');
    assert(!(draft.members || []).some((m) => m.city === 'Casa Grande'), 'draft skips unpainted cities');
    const draftHub = (draft.members || []).find((m) => m.city === 'Phoenix');
    assert(draftHub?.role === 'hub', 'hub role is copied');
    assert(draft.hub?.city === 'Phoenix' && draft.hub?.state === 'AZ', 'draft hub is Phoenix');
    assert(draft.clusterMiles === 42, 'draft keeps the zone radius');
    assert(draft.step === 'pack', 'draft is ready to generate');
    applyGeneratePackRows(`zone-reuse-new-${stamp}`, draft.members);
    const generated = loadShotgunDraft(batchDir);
    assert(!generated.clusterId, 'generate pack does not create a zone');
    assert(loadShotgunClusters().clusters.length === 2, 'generate pack leaves the registry unchanged');

    const cluster = commitShotgunZoneForBatch(`zone-reuse-new-${stamp}`);
    assert(cluster.sgNumber === 10, 'processing assigns max + 1');
    assert(cluster.id !== 'sg_src', 'new zone id');
    assert(cluster.reusedFromZoneId === 'sg_src', 'zone records the source');
    assert(cluster.niche === niche, 'zone niche is the new niche');
    assert(!JSON.stringify(cluster.members).includes('cand_old'), 'zone does not copy site ids');
    const keys = Object.fromEntries((cluster.members || []).map((m) => [m.city, m.clusterKey]));
    assert(keys.Mesa === 1, 'Mesa keeps cluster 1');
    assert(keys.Gilbert === 2, 'Gilbert keeps cluster 2');
    assert(!('Casa Grande' in keys), 'unpainted cities stay behind');
    const hub = (cluster.members || []).find((m) => m.city === 'Phoenix');
    assert(hub?.role === 'hub', 'hub role is copied');
    const saved = loadShotgunDraft(batchDir);
    assert(saved.sgNumber === 10, 'processed draft has the zone number');
    assert(saved.clusterId === cluster.id, 'draft points at the new zone');

    const againDir = batch(`zone-reuse-again-${stamp}`, niche);
    const again = seedDiscoveryPackFromZone(`zone-reuse-again-${stamp}`, 'sg_src');
    assert(again.existing === true, 'same niche and hub opens the zone');
    assert(again.discardNewBatch === true, 'does not keep a second pack');
    assert(again.cluster.sgNumber === 10, 'does not assign another zone number');
    assert(again.batchId === `zone-reuse-new-${stamp}`, 'opens the zone pack');
    assert(!existsSync(path.join(againDir, 'shotgun.json')), 'second pack is not seeded');
    assert(loadShotgunClusters().clusters.length === 3, 'no second zone for this hub');
  },
);

withZones(
  [
    sourceZone(),
    {
      id: 'sg_have',
      niche,
      name: `Zone · ${niche} · Phoenix AZ`,
      sgNumber: 6,
      batchId: `zone-reuse-have-${stamp}`,
      hub: { city: 'Phoenix', state: 'AZ', population: 1600000 },
      clusterMiles: 42,
      members: [
        { city: 'Phoenix', state: 'AZ', role: 'hub' },
        { city: 'Mesa', state: 'AZ', role: 'member', clusterKey: 4 },
      ],
    },
  ],
  ({ batch }) => {
    batch(`zone-reuse-have-${stamp}`, niche);
    const fresh = batch(`zone-reuse-dup-${stamp}`, niche);
    const seeded = seedDiscoveryPackFromZone(`zone-reuse-dup-${stamp}`, 'sg_src');
    assert(seeded.existing === true, 'refuses a second zone when this niche already has the hub');
    assert(seeded.cluster.id === 'sg_have', 'returns the existing zone');
    assert(seeded.cluster.sgNumber === 6, 'keeps the existing zone number');
    assert(seeded.discardNewBatch === true, 'does not seed another pack');
    assert(!existsSync(path.join(fresh, 'shotgun.json')), 'new pack is left unused');
    const zones = loadShotgunClusters().clusters;
    assert(zones.length === 2, 'does not create a zone');
    assert(!zones.some((c) => c.groupId), 'does not create a group when opening the existing zone');
  },
);

withZones(
  [
    sourceZone(),
    {
      id: 'sg_tucson',
      niche: 'Windows',
      name: 'Zone · Windows · Tucson AZ',
      sgNumber: 9,
      hub: { city: 'Tucson', state: 'AZ' },
      members: [
        { city: 'Tucson', state: 'AZ', role: 'hub' },
        { city: 'Mesa', state: 'AZ', role: 'member', clusterKey: 3 },
      ],
    },
  ],
  ({ batch }) => {
    batch(`zone-reuse-swap-phoenix-${stamp}`, niche);
    batch(`zone-reuse-swap-tucson-${stamp}`, niche);
    const phoenix = seedDiscoveryPackFromZone(`zone-reuse-swap-phoenix-${stamp}`, 'sg_src');
    const tucson = seedDiscoveryPackFromZone(`zone-reuse-swap-tucson-${stamp}`, 'sg_tucson');
    assert(phoenix.existing === false && tucson.existing === false, 'both paints stay drafts');
    assert(loadShotgunClusters().clusters.length === 2, 'swapping zones does not create a zone');
    const committed = commitShotgunZoneForBatch(`zone-reuse-swap-tucson-${stamp}`);
    assert(committed.hub.city === 'Tucson', 'processed batch uses the zone that was picked');
    assert(committed.sgNumber === 10, 'processed swap assigns the next zone number');
    let swapMessage = '';
    try {
      commitShotgunZoneForBatch(`zone-reuse-swap-phoenix-${stamp}`);
    } catch (error) {
      swapMessage = error.message || '';
    }
    assert(/Mesa, AZ is already in/.test(swapMessage), 'processing a second overlapping pack is refused');
    assert(loadShotgunClusters().clusters.length === 3, 'the refused pack does not create a zone');
  },
);

let conflictMessage = '';
try {
  withZones(
    [
      sourceZone(),
      {
        id: 'sg_mesa',
        niche,
        name: `Zone · ${niche} · Tucson AZ`,
        sgNumber: 6,
        hub: { city: 'Tucson', state: 'AZ' },
        members: [
          { city: 'Tucson', state: 'AZ', role: 'hub' },
          { city: 'Mesa', state: 'AZ', role: 'member', clusterKey: 3 },
        ],
      },
    ],
    ({ batch }) => {
      batch(`zone-reuse-conflict-${stamp}`, niche);
      seedDiscoveryPackFromZone(`zone-reuse-conflict-${stamp}`, 'sg_src');
    },
  );
} catch (error) {
  conflictMessage = error.message || '';
}
assert(/Mesa, AZ is already in/.test(conflictMessage), 'names the city already in another zone');

console.log('test-zone-reuse: ok');
