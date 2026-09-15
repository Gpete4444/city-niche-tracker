import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  attachLaunchedGroupIds,
  createGroup,
  GROUP_SCOPE_CANDIDATES,
  GROUP_SCOPE_LAUNCHED,
  listGroups,
  setGroupsFileForTests,
  updateGroupMembers,
} from '../ops/lib/candidate-groups.mjs';

function assert(ok, label) {
  if (!ok) {
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

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'rover-launched-groups-'));
const groupsFile = path.join(tmpDir, 'candidate-groups.json');
setGroupsFileForTests(groupsFile);

try {
  const launched = createGroup('Portfolio A', { scope: GROUP_SCOPE_LAUNCHED });
  assert(launched.scope === GROUP_SCOPE_LAUNCHED, 'launched group has launched scope');
  assertEqual(listGroups(GROUP_SCOPE_CANDIDATES).length, 0, 'candidates list ignores launched group');
  assertEqual(listGroups(GROUP_SCOPE_LAUNCHED).length, 1, 'launched list includes new group');
  assertEqual(listGroups(GROUP_SCOPE_LAUNCHED)[0].id, launched.id, 'launched list id matches');

  const research = createGroup('Portfolio A');
  assert(research.scope === GROUP_SCOPE_CANDIDATES, 'default scope is candidates');
  assertEqual(listGroups(GROUP_SCOPE_CANDIDATES).length, 1, 'same name allowed in candidates scope');
  assertEqual(listGroups(GROUP_SCOPE_LAUNCHED).length, 1, 'launched list still one group');

  let addFailed = false;
  try {
    updateGroupMembers(launched.id, ['not-a-launched-candidate'], 'add');
  } catch (error) {
    addFailed = true;
    assertEqual(error.status, 400, 'unlaunched add is 400');
    assert(
      String(error.message).includes('Not launched'),
      `unlaunched add mentions not launched: ${error.message}`,
    );
  }
  assert(addFailed, 'adding unlaunched id to launched group throws');
  assertEqual(
    listGroups(GROUP_SCOPE_LAUNCHED)[0].ids.length,
    0,
    'failed add leaves launched group empty',
  );

  updateGroupMembers(research.id, ['not-a-launched-candidate'], 'add');
  assertEqual(
    listGroups(GROUP_SCOPE_CANDIDATES)[0].ids[0],
    'not-a-launched-candidate',
    'research groups still accept unlaunched ids',
  );

  const attached = attachLaunchedGroupIds([
    { id: 'site-1', candidateId: 'not-a-launched-candidate', niche: 'Test' },
    { id: 'site-2', candidateId: null, niche: 'Manual' },
  ]);
  assertEqual(attached[0].groupIds.length, 0, 'launched attach ignores research membership');
  assertEqual(attached[1].groupIds.length, 0, 'manual site with no candidateId has no groups');

  console.log('test-launched-groups: ok');
} finally {
  setGroupsFileForTests(null);
  rmSync(tmpDir, { recursive: true, force: true });
}
