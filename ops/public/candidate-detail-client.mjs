/**
 * Client-safe candidate detail helpers (no fs).
 * Shared by Rover Review and regression scripts.
 */

export function mergeCandidateDetail(prev, next) {
  if (!next) return prev;
  if (!prev || prev.id !== next.id) return { ...next };
  return {
    ...prev,
    ...next,
    _slices: { ...(prev._slices || {}), ...(next._slices || {}) },
    stageFlags: { ...(prev.stageFlags || {}), ...(next.stageFlags || {}) },
    meta: next.meta ? { ...(prev.meta || {}), ...next.meta } : prev.meta,
  };
}

/**
 * True when Review tray See More may copy from loaded groups:
 * Content attach sidecar (unless skipped) or applied imagesManifest ids.
 */
export function photoGroupsLoadedOnDetail(detail) {
  const doc = detail?.photoGroupAttached;
  if (doc && !doc.skipped) {
    if (Array.isArray(doc.groupIds) && doc.groupIds.length) return true;
    if (doc.groupId) return true;
  }
  const man = detail?.imagesManifest;
  if (Array.isArray(man?.photoGroupIds) && man.photoGroupIds.length) return true;
  return Boolean(man?.photoGroupId);
}
