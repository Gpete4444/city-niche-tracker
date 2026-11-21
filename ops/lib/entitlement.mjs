/**
 * Weekly plan check. This source checkout never locks. A customer install
 * locks paid actions unless the signed-in plan allows them.
 */
import { isCandidateLaunched } from './launched-edit-guard.mjs';

const MAINTAIN_PREFIXES = ['/api/forms', '/api/phone', '/api/sites', '/api/gsc'];

function candidateId(requestPath) {
  const match = String(requestPath || '').match(/^\/api\/candidates\/([^/]+)/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function requiredPlan(method, requestPath) {
  const verb = String(method || 'GET').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return null;
  const path = String(requestPath || '');
  if (!path.startsWith('/api/')) return null;
  if (
    path.startsWith('/api/account') ||
    path.startsWith('/api/health') ||
    path.startsWith('/api/concurrency') ||
    path.startsWith('/api/user-guide') ||
    path.startsWith('/api/eval-concurrency') ||
    path.startsWith('/api/heavy-jobs/concurrency')
  ) {
    return null;
  }
  if (MAINTAIN_PREFIXES.some((prefix) => path.startsWith(prefix))) return 'maintain';
  const id = candidateId(path);
  let launched = false;
  if (id) {
    try {
      launched = isCandidateLaunched(id);
    } catch {
      launched = false;
    }
  }
  if (id && launched) {
    if (/\/launch|\/ship|\/assemble|\/content|\/images|\/site-config|\/visual-edit|\/revert-launched/.test(path)) {
      return 'maintain';
    }
  }
  if (
    path.startsWith('/api/discovery') ||
    path.startsWith('/api/shotgun') ||
    path.startsWith('/api/zone-guides') ||
    path.startsWith('/api/map') ||
    path.startsWith('/api/jobs') ||
    path.startsWith('/api/candidates') ||
    path.startsWith('/api/candidate-groups') ||
    path.startsWith('/api/photo-groups') ||
    path.startsWith('/api/niche-')
  ) {
    return 'full';
  }
  return null;
}

export function planAllows(entitlement, need) {
  if (!need) return true;
  if (!entitlement || typeof entitlement !== 'object') return false;
  if (entitlement.role === 'admin') return true;
  const plan = String(entitlement.plan || '');
  const until = Date.parse(String(entitlement.paidThrough || ''));
  if (!Number.isFinite(until) || until <= Date.now()) return false;
  if (plan === 'full') return true;
  if (plan === 'maintain') return need === 'maintain';
  return false;
}

export function entitlementError(need) {
  const label = need === 'maintain' ? 'Maintain' : 'Full';
  const error = new Error(`This action needs a ${label} week. Open Account setup to review the plan.`);
  error.status = 402;
  error.code = 'plan_required';
  error.plan = need;
  return error;
}
