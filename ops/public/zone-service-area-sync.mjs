/**
 * Cross-tab Zone Service area: which candidate ids to notify, and whether
 * this tab should reload sibling claims without a full page refresh.
 */

export function zoneServiceAreaBroadcastIds(detail = {}) {
  const ids = [];
  const seen = new Set();
  const add = (raw) => {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  add(detail?.id);
  for (const member of detail?.shotgunMembers || []) {
    add(member?.candidateId);
  }
  return ids;
}

export function zoneServiceAreaClusterId(detail = {}) {
  return String(detail?.shotgunClusterId || detail?.shotgunZoneId || '').trim() || null;
}

/**
 * True when a BroadcastChannel payload should refresh this tab's Zone claims.
 * `ids: null` means "all candidates".
 */
export function remoteRefreshTouchesZone(
  data = {},
  { selectedId = '', clusterId = '', memberIds = [] } = {},
) {
  const selected = String(selectedId || '').trim();
  if (!selected) return false;
  const ids = Array.isArray(data?.ids) ? data.ids.map((id) => String(id)) : null;
  if (!ids) return true;
  if (ids.includes(selected)) return true;
  const remoteCluster = String(data?.clusterId || '').trim();
  const localCluster = String(clusterId || '').trim();
  if (remoteCluster && localCluster && remoteCluster === localCluster) return true;
  const members = new Set((memberIds || []).map((id) => String(id || '').trim()).filter(Boolean));
  return ids.some((id) => members.has(id));
}

export function serviceAreaClaimMaps(entries = []) {
  const claimedPlaceKeys = [];
  const claimedBy = {};
  const claimedKinds = {};
  for (const row of entries || []) {
    const name = String(row?.name || '').trim();
    if (!name) continue;
    claimedPlaceKeys.push(name);
    claimedBy[name] = String(row.ownerCity || '').trim();
    claimedKinds[name] = String(row.kind || 'page');
  }
  return { claimedPlaceKeys, claimedBy, claimedKinds };
}
