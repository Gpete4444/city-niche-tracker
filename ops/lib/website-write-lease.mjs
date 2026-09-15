/**
 * One Website editor per candidate. Other tabs may view; saves are refused
 * unless they hold the lease or Take over.
 */
const LEASE_MS = 15_000;

/** @type {Map<string, { tabId: string, expiresAt: number, heldAt: number }>} */
const leases = new Map();

function normId(candidateId) {
  return String(candidateId || '').trim();
}

function normTab(tabId) {
  return String(tabId || '').trim();
}

function prune(candidateId) {
  const id = normId(candidateId);
  if (!id) return;
  const cur = leases.get(id);
  if (cur && cur.expiresAt <= Date.now()) leases.delete(id);
}

export function peekWebsiteWriteLease(candidateId) {
  const id = normId(candidateId);
  if (!id) return null;
  prune(id);
  const cur = leases.get(id);
  if (!cur) return null;
  return {
    candidateId: id,
    holderTabId: cur.tabId,
    expiresAt: cur.expiresAt,
    heldAt: cur.heldAt,
  };
}

/**
 * @param {string} candidateId
 * @param {string} tabId
 * @param {{ takeover?: boolean }} [opts]
 * @returns {{ ok: boolean, mine: boolean, holderTabId: string | null, expiresAt: number | null, candidateId: string }}
 */
export function claimWebsiteWriteLease(candidateId, tabId, { takeover = false } = {}) {
  const id = normId(candidateId);
  const tab = normTab(tabId);
  if (!id) {
    throw Object.assign(new Error('candidateId required'), { status: 400 });
  }
  if (!tab) {
    throw Object.assign(new Error('Tab id required'), { status: 400, code: 'WEBSITE_WRITE_TAB' });
  }
  prune(id);
  const cur = leases.get(id);
  if (cur && cur.tabId !== tab && !takeover) {
    return {
      ok: false,
      mine: false,
      holderTabId: cur.tabId,
      expiresAt: cur.expiresAt,
      candidateId: id,
    };
  }
  const next = { tabId: tab, expiresAt: Date.now() + LEASE_MS, heldAt: Date.now() };
  leases.set(id, next);
  return {
    ok: true,
    mine: true,
    holderTabId: tab,
    expiresAt: next.expiresAt,
    candidateId: id,
  };
}

export function heartbeatWebsiteWriteLease(candidateId, tabId) {
  const id = normId(candidateId);
  const tab = normTab(tabId);
  if (!id) {
    throw Object.assign(new Error('candidateId required'), { status: 400 });
  }
  if (!tab) {
    throw Object.assign(new Error('Tab id required'), { status: 400, code: 'WEBSITE_WRITE_TAB' });
  }
  prune(id);
  const cur = leases.get(id);
  if (cur && cur.tabId !== tab) {
    throw Object.assign(new Error('Could not save — this business is open for editing in another tab.'), {
      status: 409,
      code: 'WEBSITE_WRITE_LOCKED',
      holderTabId: cur.tabId,
      candidateId: id,
    });
  }
  const next = cur || { tabId: tab, heldAt: Date.now(), expiresAt: 0 };
  next.tabId = tab;
  next.expiresAt = Date.now() + LEASE_MS;
  if (!cur) next.heldAt = Date.now();
  leases.set(id, next);
  return {
    ok: true,
    mine: true,
    holderTabId: tab,
    expiresAt: next.expiresAt,
    candidateId: id,
  };
}

export function releaseWebsiteWriteLease(candidateId, tabId) {
  const id = normId(candidateId);
  const tab = normTab(tabId);
  const cur = leases.get(id);
  if (cur && (!tab || cur.tabId === tab)) leases.delete(id);
  return { ok: true, released: true, candidateId: id };
}

export function assertWebsiteWriteAllowed(candidateId, tabId) {
  const id = normId(candidateId);
  const tab = normTab(tabId);
  if (!id) {
    throw Object.assign(new Error('candidateId required'), { status: 400 });
  }
  if (!tab) {
    throw Object.assign(
      new Error('Could not save — this business is open for editing in another tab.'),
      { status: 409, code: 'WEBSITE_WRITE_LOCKED', holderTabId: null, candidateId: id },
    );
  }
  prune(id);
  const cur = leases.get(id);
  if (!cur) {
    const next = { tabId: tab, expiresAt: Date.now() + LEASE_MS, heldAt: Date.now() };
    leases.set(id, next);
    return;
  }
  if (cur.tabId === tab) {
    cur.expiresAt = Date.now() + LEASE_MS;
    return;
  }
  throw Object.assign(new Error('Could not save — this business is open for editing in another tab.'), {
    status: 409,
    code: 'WEBSITE_WRITE_LOCKED',
    holderTabId: cur.tabId,
    candidateId: id,
  });
}

/** Banner / grey-out only when the blocked lease is the row on screen. */
export function websiteWriteLockApplies({ selectedId, leaseCandidateId, mine } = {}) {
  const selected = String(selectedId || '').trim();
  const lease = String(leaseCandidateId || '').trim();
  return Boolean(selected && lease && selected === lease && mine === false);
}

export function expireWebsiteWriteLeaseForTests(candidateId) {
  const id = normId(candidateId);
  const cur = leases.get(id);
  if (cur) cur.expiresAt = 0;
}

export function resetWebsiteWriteLeasesForTests() {
  leases.clear();
}

export const WEBSITE_WRITE_LEASE_MS = LEASE_MS;
