import { filterPhotoGroupsForCandidate } from '../ops/lib/candidates.mjs';

function assertEqual(got, want, label) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) {
    console.error(`${label}: got ${a}, want ${b}`);
    process.exit(1);
  }
}

const groups = [
  { id: 'plumb-master', kind: 'master', niche: 'Plumbing' },
  { id: 'plumb-a', kind: 'group', niche: 'Plumbing' },
  { id: 'hvac-master', kind: 'master', niche: 'HVAC' },
  { id: 'hvac-a', kind: 'group', niche: 'HVAC' },
];

assertEqual(
  filterPhotoGroupsForCandidate(groups, { niche: 'Plumbing' }).map((g) => g.id),
  ['plumb-master', 'plumb-a'],
  'niche + master only',
);

assertEqual(
  filterPhotoGroupsForCandidate(groups, {
    niche: 'Plumbing',
    attached: { groupIds: ['hvac-a'] },
  }).map((g) => g.id),
  ['plumb-master', 'plumb-a', 'hvac-a'],
  'keeps attached other-niche id',
);

assertEqual(
  filterPhotoGroupsForCandidate(groups, { niche: '' }).map((g) => g.id),
  [],
  'no niche → no library',
);

assertEqual(
  filterPhotoGroupsForCandidate(groups, {
    niche: '',
    attached: { groupId: 'hvac-a' },
  }).map((g) => g.id),
  ['hvac-a'],
  'no niche still keeps attached',
);

assertEqual(
  filterPhotoGroupsForCandidate(groups, {
    niche: 'HVAC',
    attached: { skipped: true, groupIds: ['plumb-a'] },
  }).map((g) => g.id),
  ['hvac-master', 'hvac-a'],
  'skipped attach does not pull other niches',
);

assertEqual(
  filterPhotoGroupsForCandidate(groups, { niche: 'Plumbing.' }).map((g) => g.id),
  ['plumb-master', 'plumb-a'],
  'trailing period still matches the niche',
);

console.log('test-photo-groups-detail-filter: ok');
