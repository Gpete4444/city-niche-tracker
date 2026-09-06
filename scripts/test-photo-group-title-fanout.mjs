import {
  canonicalSlotTitle,
  promoteFirstTrayIntoEmptyPlan,
  slotsMatchingCanonicalTitle,
  titlesStronglyMatch,
} from '../ops/lib/photo-groups.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

const board = {
  sectionId: 'svcMaterials',
  materialTitle: 'Moisture-resistant board',
  serviceName: 'Drywall installation',
  key: 'svc-materials-1',
};
const boardDrywall = {
  sectionId: 'materials',
  materialTitle: 'Moisture-resistant drywall board',
  label: 'Moisture-resistant drywall board',
  key: 'home-materials-2',
};
const boardPhoto = {
  sectionId: 'svcMaterials',
  label: 'Moisture-resistant board photo',
  serviceName: 'Water stain repair',
  key: 'svc-materials-3',
};
const primer = {
  sectionId: 'svcMaterials',
  materialTitle: 'Moisture-resistant primer-sealer',
  serviceName: 'Drywall installation',
  key: 'svc-materials-4',
};

assert(
  canonicalSlotTitle(board) === 'moisture resistant board',
  `canonical board: ${canonicalSlotTitle(board)}`,
);
assert(
  canonicalSlotTitle(boardPhoto) === 'moisture resistant board',
  `canonical board photo dropped: ${canonicalSlotTitle(boardPhoto)}`,
);
assert(titlesStronglyMatch(canonicalSlotTitle(board), canonicalSlotTitle(boardDrywall)), 'board ⊂ drywall board');
assert(titlesStronglyMatch('Moisture-resistant board', 'Moisture-resistant drywall board'), 'string form matches');
assert(
  !titlesStronglyMatch('Moisture-resistant board', 'Moisture-resistant primer-sealer'),
  'primer-sealer is not board',
);

const targets = [board, boardDrywall, boardPhoto, primer];
const hits = slotsMatchingCanonicalTitle(board, targets).map((s) => s.key);
assert(hits.includes(board.key), 'self match');
assert(hits.includes(boardDrywall.key), 'fan-out to home materials drywall board');
assert(hits.includes(boardPhoto.key), 'fan-out to other service board photo');
assert(!hits.includes(primer.key), 'primer-sealer excluded from board fan-out');
assert(hits.length === 3, `fan-out size ${hits.length}`);

const processA = {
  sectionId: 'svcProcess',
  processTitle: 'Hang the board',
  serviceName: 'Installation',
  key: 'p1',
};
const processB = {
  sectionId: 'process',
  processTitle: 'Hang the board',
  key: 'p2',
};
assert(slotsMatchingCanonicalTitle(processA, [processB, primer]).map((s) => s.key).join() === 'p2', 'process title fan-out');

const plan = {
  applied: [
    {
      matchKey: 'a',
      saved: { filename: 'live.jpg' },
      target: { key: 'a' },
      group: { id: 'g' },
      rank: 1,
    },
  ],
  tray: [
    { matchKey: 'b', saved: { filename: 'first.jpg' }, target: { key: 'b' }, group: { id: 'g' }, rank: 1 },
    { matchKey: 'b', saved: { filename: 'second.jpg' }, target: { key: 'b' }, group: { id: 'g' }, rank: 1 },
    { matchKey: 'a', saved: { filename: 'extra.jpg' }, target: { key: 'a' }, group: { id: 'g' }, rank: 1 },
  ],
};
promoteFirstTrayIntoEmptyPlan(plan);
assert(plan.applied.length === 2, `promoted one empty, applied ${plan.applied.length}`);
assert(plan.applied[1].fromTray === true, 'fromTray flag');
assert(plan.applied[1].saved.filename === 'first.jpg', 'first tray still becomes live');
assert(plan.tray.length === 2, `tray leftover ${plan.tray.length}`);
assert(
  plan.tray.every((r) => r.saved.filename !== 'first.jpg'),
  'promoted row left the tray',
);
assert(
  plan.tray.some((r) => r.matchKey === 'b' && r.saved.filename === 'second.jpg'),
  'rest of empty-slot tray kept',
);
assert(
  plan.tray.some((r) => r.matchKey === 'a' && r.saved.filename === 'extra.jpg'),
  'already-live slot keeps extras on tray',
);

console.log('test-photo-group-title-fanout: ok');
