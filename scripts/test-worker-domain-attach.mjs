/**
 * Worker custom-domain attach decisions.
 * Run: node scripts/test-worker-domain-attach.mjs
 */
import { missingWorkerHostnames } from '../ops/lib/cloudflare-launch.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

const service = 'elmirageartificialturf-com';
const want = {
  apex: 'elmirageartificialturf.com',
  www: 'www.elmirageartificialturf.com',
  service,
};

const missing = missingWorkerHostnames([], want);
assert(
  missing.missing.join(',') === 'elmirageartificialturf.com,www.elmirageartificialturf.com',
  'both hostnames are missing when the account has none',
);
assert(missing.already.length === 0 && missing.conflicts.length === 0, 'missing has no already or conflict');

const already = missingWorkerHostnames(
  [
    { hostname: 'elmirageartificialturf.com', service },
    { hostname: 'www.elmirageartificialturf.com', service },
  ],
  want,
);
assert(already.missing.length === 0, 'already on this Worker is not missing');
assert(
  already.already.join(',') === 'elmirageartificialturf.com,www.elmirageartificialturf.com',
  'already lists both hostnames',
);
assert(already.conflicts.length === 0, 'same Worker is not a conflict');

const conflict = missingWorkerHostnames(
  [
    { hostname: 'ElMirageArtificialTurf.com', service: 'other-worker' },
    { hostname: 'www.elmirageartificialturf.com', service },
  ],
  want,
);
assert(conflict.missing.length === 0, 'conflict case has nothing to create');
assert(conflict.already.join(',') === 'www.elmirageartificialturf.com', 'www stays on this Worker');
assert(
  conflict.conflicts.length === 1 &&
    conflict.conflicts[0].hostname === 'elmirageartificialturf.com' &&
    conflict.conflicts[0].service === 'other-worker',
  'apex on a different Worker is a conflict and is not moved',
);

console.log('test-worker-domain-attach: ok');
