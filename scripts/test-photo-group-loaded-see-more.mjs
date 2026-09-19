import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  mergeCandidateDetail,
  photoGroupsLoadedOnDetail,
} from '../ops/public/candidate-detail-client.mjs';
import { pathsFor } from '../ops/lib/candidates.mjs';
import {
  PHOTO_GROUPS_DIR,
  dropPhotoGroupFromIndex,
  getAttachedPhotoGroup,
  groupIdIsLoaded,
  listAttachedGroupStills,
  loadedPhotoGroupIds,
  persistAttachedPhotoGroups,
  persistPhotoGroupRecord,
} from '../ops/lib/photo-groups.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

function assertEqual(got, want, label) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) {
    console.error(`${label}: got ${a}, want ${b}`);
    process.exit(1);
  }
}

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const candidateId = 'zz-rover-test-pg-loaded';
const groupE = {
  id: 'zz-rover-test-pg-e',
  name: 'Drywall Repair E',
  niche: 'Test niche',
  slots: [{ filename: 'e.jpg', label: 'E still' }],
  beforeAfter: { home: [], services: [] },
};
const groupD = {
  id: 'zz-rover-test-pg-d',
  name: 'Drywall Repair D',
  niche: 'Test niche',
  slots: [{ filename: 'd.jpg', label: 'D still' }],
  beforeAfter: { home: [], services: [] },
};

const p = pathsFor(candidateId);
const created = [];

function track(file) {
  created.push(file);
  return file;
}

function writeGroupFile(id, filename) {
  const dir = path.join(PHOTO_GROUPS_DIR, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, filename), PIXEL);
}

try {
  persistPhotoGroupRecord(groupE);
  persistPhotoGroupRecord(groupD);
  writeGroupFile(groupE.id, 'e.jpg');
  writeGroupFile(groupD.id, 'd.jpg');

  persistAttachedPhotoGroups(candidateId, [groupD, groupE]);
  track(p.photoGroup);
  writeFileSync(
    track(p.imagesManifest),
    `${JSON.stringify(
      {
        version: 1,
        candidateId,
        photoGroupId: groupE.id,
        photoGroupIds: [groupE.id, groupD.id],
        photoGroupName: `${groupE.name} → ${groupD.name}`,
        slots: {},
        files: [],
        usedIds: [],
      },
      null,
      2,
    )}\n`,
  );

  assertEqual(
    loadedPhotoGroupIds(candidateId),
    [groupE.id, groupD.id],
    'loaded ids prefer manifest over stale sidecar',
  );
  assert(
    groupIdIsLoaded(candidateId, groupE.id),
    'first applied group is allowed even when sidecar is stale',
  );

  const stills = listAttachedGroupStills(candidateId);
  assertEqual(stills.names, [groupE.name, groupD.name], 'See More names follow applied order');
  assertEqual(stills.groupIds, [groupE.id, groupD.id], 'See More groupIds follow applied order');
  assert(
    stills.photos.some((row) => row.groupId === groupE.id && row.filename === 'e.jpg'),
    'See More includes a still from the first applied group',
  );

  const attached = persistAttachedPhotoGroups(candidateId, [groupE, groupD]);
  assertEqual(attached.groupIds, [groupE.id, groupD.id], 'persist sidecar ids');
  assertEqual(attached.names, [groupE.name, groupD.name], 'persist sidecar names');
  const sidecar = getAttachedPhotoGroup(candidateId);
  assertEqual(sidecar.groupIds, [groupE.id, groupD.id], 'sidecar matches load order');
  assertEqual(sidecar.names, [groupE.name, groupD.name], 'sidecar names match load order');

  const openDetail = {
    id: candidateId,
    photoGroupAttached: sidecar,
    imagesManifest: {
      photoGroupIds: [groupE.id, groupD.id],
      photoGroupId: groupE.id,
    },
    _slices: { images: true, shell: true },
  };
  const shell = {
    id: candidateId,
    name: 'Wylie Concrete Lifting',
    _slices: { shell: true },
  };
  const merged = mergeCandidateDetail(openDetail, shell);
  assert(merged.photoGroupAttached === sidecar, 'shell merge keeps photoGroupAttached');
  assertEqual(
    merged.imagesManifest.photoGroupIds,
    [groupE.id, groupD.id],
    'shell merge keeps photoGroupIds',
  );
  assert(merged._slices.images && merged._slices.shell, 'shell merge keeps images slice flag');
  assert(photoGroupsLoadedOnDetail(merged), 'See More after shell merge');
  assert(
    photoGroupsLoadedOnDetail({ photoGroupAttached: sidecar }),
    'See More from sidecar groupIds',
  );
  assert(
    photoGroupsLoadedOnDetail({
      imagesManifest: { photoGroupIds: [groupE.id], photoGroupId: groupE.id },
    }),
    'See More from applied photoGroupIds',
  );
  assert(
    photoGroupsLoadedOnDetail({ imagesManifest: { photoGroupId: groupE.id } }),
    'See More from applied photoGroupId',
  );
  assert(
    !photoGroupsLoadedOnDetail({ photoGroupAttached: { skipped: true } }),
    'See More hidden when sidecar skipped and no manifest ids',
  );
  assert(
    photoGroupsLoadedOnDetail({
      photoGroupAttached: { skipped: true },
      imagesManifest: { photoGroupIds: [groupE.id] },
    }),
    'See More from manifest when sidecar skipped',
  );
  assert(!photoGroupsLoadedOnDetail({}), 'See More hidden with no groups');
} finally {
  for (const file of created) {
    try {
      if (existsSync(file)) unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
  for (const id of [groupE.id, groupD.id]) {
    dropPhotoGroupFromIndex(id);
    try {
      rmSync(path.join(PHOTO_GROUPS_DIR, id), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

console.log('test-photo-group-loaded-see-more: ok');
