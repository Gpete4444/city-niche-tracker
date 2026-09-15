/**
 * Reset launch for a new domain: confirm gate, meta clear, Sites row, mocked GH/CF.
 * Run: node scripts/test-reset-launch-for-domain.mjs
 */
import { writeFileSync } from 'node:fs';
import {
  createCandidate,
  deleteCandidates,
  loadMeta,
  pathsFor,
  saveMeta,
} from '../ops/lib/candidates.mjs';
import { upsertSiteFromCandidate, getSiteByCandidateId } from '../ops/lib/sites.mjs';
import {
  currentLaunchHosts,
  normalizeLaunchHost,
  resetLaunchForNewDomain,
} from '../ops/lib/reset-launch-for-domain.mjs';

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

async function assertRejects(fn, code, label) {
  try {
    await fn();
    console.error(`${label}: expected throw ${code}`);
    process.exit(1);
  } catch (error) {
    if (error.code !== code) {
      console.error(`${label}: got ${error.code}, want ${code} (${error.message})`);
      process.exit(1);
    }
  }
}

assertEqual(normalizeLaunchHost('https://www.SparksDrywallRepairPros.com/'), 'sparksdrywallrepairpros.com', 'normalize host');

const id = `__test-reset-launch-${Date.now().toString(36)}`;
const ghCalls = [];
const cfCalls = [];

try {
  createCandidate({
    niche: 'Drywall Repair',
    primary: 'Testville,NV',
    id,
  });
  const p = pathsFor(id);
  writeFileSync(
    p.siteConfig,
    `${JSON.stringify(
      {
        niche: 'Drywall Repair',
        primaryCity: 'Testville',
        state: 'NV',
        domain: 'sparksdrywallrepairpros.com',
        email: 'leads@sparksdrywallrepairpros.com',
        phone: '+15555550100',
        businessName: 'Testville Drywall Repair Pros',
        web3FormsAccessKey: 'test-key',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  saveMeta(id, {
    lastLaunchAt: '2026-01-01T00:00:00.000Z',
    lastShipAt: '2026-01-01T00:00:00.000Z',
    githubRepo: 'acme/sparksdrywallrepairpros-com',
    githubRepoUrl: 'https://github.com/acme/sparksdrywallrepairpros-com',
    cfProject: 'sparksdrywallrepairpros-com',
    assembledSiteSlug: 'sparksdrywallrepairpros-com',
    assembledSitePath: '../rover-sites/sparksdrywallrepairpros-com',
    launchDomain: 'sparksdrywallrepairpros.com',
    cloudflarePagesDone: true,
    dnsDone: true,
    emailRoutingDone: true,
    formsDone: true,
    indexingDone: true,
  });
  upsertSiteFromCandidate({ candidateId: id, status: 'live' });
  assert(getSiteByCandidateId(id), 'sites row exists');

  const hosts = currentLaunchHosts({ meta: loadMeta(id) }, { domain: 'sparksdrywallrepairpros.com' });
  assert(hosts.includes('sparksdrywallrepairpros.com'), 'current hosts include old domain');

  await assertRejects(
    () => resetLaunchForNewDomain(id, { confirmResetLaunch: false }),
    'RESET_LAUNCH_CONFIRM_REQUIRED',
    'missing confirm',
  );
  await assertRejects(
    () =>
      resetLaunchForNewDomain(id, {
        confirmResetLaunch: true,
        confirmDomain: 'wrong.com',
      }),
    'RESET_LAUNCH_CONFIRM_MISMATCH',
    'wrong confirm host',
  );

  const result = await resetLaunchForNewDomain(id, {
    confirmResetLaunch: true,
    confirmDomain: 'sparksdrywallrepairpros.com',
    domain: 'sparksdrywallrepair.com',
    deleteGithubRepoFn: async (fullName) => {
      ghCalls.push(fullName);
      return { ok: true, deleted: true, fullName };
    },
    teardownCloudflareFn: async (args) => {
      cfCalls.push(args);
      return { ok: true, workerDeleted: true, detached: ['sparksdrywallrepairpros.com'], human: ['deleted worker'] };
    },
  });

  assertEqual(ghCalls, ['acme/sparksdrywallrepairpros-com'], 'gh delete old repo');
  assertEqual(cfCalls[0]?.workerName, 'sparksdrywallrepairpros-com', 'cf worker name');
  assert(cfCalls[0]?.hostnames?.includes('sparksdrywallrepairpros.com'), 'cf old host');
  assertEqual(result.newDomain, 'sparksdrywallrepair.com', 'new domain');
  assertEqual(result.leftovers, [], 'no leftovers');

  const meta = loadMeta(id);
  assertEqual(meta.lastLaunchAt, null, 'lastLaunchAt cleared');
  assertEqual(meta.githubRepo, null, 'githubRepo cleared');
  assertEqual(meta.assembledSitePath, null, 'assembled path cleared');
  assertEqual(meta.assembledSiteSlug, null, 'assembled slug cleared');
  assertEqual(meta.indexingDone, false, 'indexing cleared');
  assert(!getSiteByCandidateId(id), 'sites row removed');

  const cfg = JSON.parse((await import('node:fs')).readFileSync(p.siteConfig, 'utf8'));
  assertEqual(cfg.domain, 'sparksdrywallrepair.com', 'accepted domain patched');
  assertEqual(cfg.email, 'leads@sparksdrywallrepair.com', 'leads@ moved to new host');
} finally {
  try {
    deleteCandidates([id]);
  } catch {
    /* ignore */
  }
}

console.log('test-reset-launch-for-domain: ok');
