/**
 * Cross-tab Zone Service area broadcast + claim maps.
 * Run: node scripts/test-zone-service-area-sync.mjs
 */
import {
  remoteRefreshTouchesZone,
  serviceAreaClaimMaps,
  zoneServiceAreaBroadcastIds,
  zoneServiceAreaClusterId,
} from '../ops/public/zone-service-area-sync.mjs';

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

const gooId = 'zz_test_clp_goodyear';
const avoId = 'zz_test_clp_avondale';
const clusterId = 'sg_clp_test';
const gooDetail = {
  id: gooId,
  shotgunClusterId: clusterId,
  shotgunMembers: [
    { city: 'Goodyear', candidateId: gooId },
    { city: 'Avondale', candidateId: avoId },
  ],
};

const ids = zoneServiceAreaBroadcastIds(gooDetail);
assert(ids.includes(gooId), 'broadcast includes self');
assert(ids.includes(avoId), 'broadcast includes sibling Zone member');
assertEqual(ids.length, 2, 'broadcast de-dupes hub listed twice');
assertEqual(zoneServiceAreaClusterId(gooDetail), clusterId, 'cluster id from shotgunClusterId');
assertEqual(
  zoneServiceAreaClusterId({ shotgunZoneId: 'sg_zone' }),
  'sg_zone',
  'cluster id falls back to shotgunZoneId',
);

assert(
  remoteRefreshTouchesZone({ ids, clusterId }, {
    selectedId: avoId,
    clusterId,
    memberIds: [gooId, avoId],
  }),
  'Avondale tab sees Goodyear Accept via member ids',
);
assert(
  remoteRefreshTouchesZone({ ids: [gooId], clusterId }, {
    selectedId: avoId,
    clusterId,
    memberIds: [],
  }),
  'same clusterId is enough without member list',
);
assert(
  !remoteRefreshTouchesZone({ ids: [gooId] }, {
    selectedId: avoId,
    clusterId: '',
    memberIds: [],
  }),
  'other-site id is ignored without Zone membership',
);
assert(
  remoteRefreshTouchesZone({ ids: null }, { selectedId: avoId }),
  'null ids means all candidates',
);
assert(
  !remoteRefreshTouchesZone({ ids: [gooId], clusterId }, { selectedId: '' }),
  'no selection is not a Zone touch',
);

const maps = serviceAreaClaimMaps([
  { name: 'Tolleson', ownerCity: 'Avondale', kind: 'page' },
  { name: '' },
]);
assertEqual(maps.claimedPlaceKeys.join(','), 'Tolleson', 'claim names are leftover pages only');
assertEqual(maps.claimedBy.Tolleson, 'Avondale', 'claim owner');
assertEqual(maps.claimedKinds.Tolleson, 'page', 'claim kind');

console.log('test-zone-service-area-sync: ok');
