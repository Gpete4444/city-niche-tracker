/**
 * Manual named candidate groups (playlist-style membership).
 * Registry: research/candidate-groups.json — not per-candidate meta.
 * scope: "candidates" (Research/Website) or "launched" (Launched table only).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RESEARCH_DIR } from './candidates.mjs';
import { isCandidateLaunched } from './launched-edit-guard.mjs';

export const GROUPS_FILE = path.join(RESEARCH_DIR, 'candidate-groups.json');
export const GROUPS_FILENAME = 'candidate-groups.json';

export const GROUP_SCOPE_CANDIDATES = 'candidates';
export const GROUP_SCOPE_LAUNCHED = 'launched';

let groupsFileOverride = null;

/** Test-only: point the registry at a temp file. Pass null to restore. */
export function setGroupsFileForTests(filePath) {
  groupsFileOverride = filePath || null;
}

function groupsFile() {
  return groupsFileOverride || GROUPS_FILE;
}

function ensureResearchDir() {
  mkdirSync(path.dirname(groupsFile()), { recursive: true });
}

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureResearchDir();
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

function newGroupId() {
  return `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeName(name) {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

function normalizeIds(ids = []) {
  const out = [];
  const seen = new Set();
  for (const raw of ids) {
    const id = String(raw ?? '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function normalizeScope(scope) {
  const raw = String(scope ?? '')
    .trim()
    .toLowerCase();
  if (raw === GROUP_SCOPE_LAUNCHED) return GROUP_SCOPE_LAUNCHED;
  return GROUP_SCOPE_CANDIDATES;
}

export function loadGroupsRegistry() {
  const raw = readJson(groupsFile(), { groups: [] });
  const groups = Array.isArray(raw?.groups) ? raw.groups : [];
  return {
    groups: groups
      .filter((g) => g && typeof g === 'object' && g.id && g.name)
      .map((g) => ({
        id: String(g.id),
        name: String(g.name),
        ids: normalizeIds(g.ids),
        scope: normalizeScope(g.scope),
        createdAt: g.createdAt || null,
        updatedAt: g.updatedAt || null,
      })),
  };
}

function saveGroupsRegistry(registry) {
  writeJson(groupsFile(), {
    groups: (registry.groups || []).map((g) => ({
      id: g.id,
      name: g.name,
      ids: normalizeIds(g.ids),
      scope: normalizeScope(g.scope),
      createdAt: g.createdAt || nowIso(),
      updatedAt: g.updatedAt || nowIso(),
    })),
  });
  return loadGroupsRegistry();
}

export function listGroups(scope = GROUP_SCOPE_CANDIDATES) {
  const want = normalizeScope(scope);
  return loadGroupsRegistry().groups.filter((g) => g.scope === want);
}

/** Map candidateId → groupId[] (from the given list, or all groups if omitted). */
export function membershipByCandidateId(groups = null) {
  const list = groups || loadGroupsRegistry().groups;
  const map = new Map();
  for (const g of list) {
    for (const id of g.ids || []) {
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(g.id);
    }
  }
  return map;
}

export function attachGroupIds(candidates = []) {
  const byId = membershipByCandidateId(listGroups(GROUP_SCOPE_CANDIDATES));
  return candidates.map((c) => ({
    ...c,
    groupIds: byId.get(c.id) || [],
  }));
}

/** Attach Launched-scope groupIds using each site’s candidateId. */
export function attachLaunchedGroupIds(sites = []) {
  const byId = membershipByCandidateId(listGroups(GROUP_SCOPE_LAUNCHED));
  return sites.map((s) => ({
    ...s,
    groupIds: s.candidateId ? byId.get(s.candidateId) || [] : [],
  }));
}

export function createGroup(name, { scope } = {}) {
  const trimmed = normalizeName(name);
  if (!trimmed) {
    throw Object.assign(new Error('Group name is required'), { status: 400 });
  }
  const groupScope = normalizeScope(scope);
  const registry = loadGroupsRegistry();
  if (
    registry.groups.some(
      (g) => g.scope === groupScope && g.name.toLowerCase() === trimmed.toLowerCase(),
    )
  ) {
    throw Object.assign(new Error(`Group “${trimmed}” already exists`), { status: 409 });
  }
  const ts = nowIso();
  const group = {
    id: newGroupId(),
    name: trimmed,
    ids: [],
    scope: groupScope,
    createdAt: ts,
    updatedAt: ts,
  };
  registry.groups.push(group);
  saveGroupsRegistry(registry);
  return group;
}

export function renameGroup(id, name) {
  const trimmed = normalizeName(name);
  if (!trimmed) {
    throw Object.assign(new Error('Group name is required'), { status: 400 });
  }
  const registry = loadGroupsRegistry();
  const group = registry.groups.find((g) => g.id === id);
  if (!group) {
    throw Object.assign(new Error('Group not found'), { status: 404 });
  }
  if (
    registry.groups.some(
      (g) =>
        g.id !== id &&
        g.scope === group.scope &&
        g.name.toLowerCase() === trimmed.toLowerCase(),
    )
  ) {
    throw Object.assign(new Error(`Group “${trimmed}” already exists`), { status: 409 });
  }
  group.name = trimmed;
  group.updatedAt = nowIso();
  saveGroupsRegistry(registry);
  return group;
}

export function deleteGroup(id) {
  const registry = loadGroupsRegistry();
  const idx = registry.groups.findIndex((g) => g.id === id);
  if (idx < 0) {
    throw Object.assign(new Error('Group not found'), { status: 404 });
  }
  const [removed] = registry.groups.splice(idx, 1);
  saveGroupsRegistry(registry);
  return removed;
}

export function updateGroupMembers(id, ids = [], op = 'add') {
  const action = String(op || 'add').toLowerCase();
  if (action !== 'add' && action !== 'remove') {
    throw Object.assign(new Error('op must be add or remove'), { status: 400 });
  }
  const memberIds = normalizeIds(ids);
  if (!memberIds.length) {
    throw Object.assign(new Error('ids required'), { status: 400 });
  }
  const registry = loadGroupsRegistry();
  const group = registry.groups.find((g) => g.id === id);
  if (!group) {
    throw Object.assign(new Error('Group not found'), { status: 404 });
  }
  if (action === 'add' && group.scope === GROUP_SCOPE_LAUNCHED) {
    const notLaunched = memberIds.filter((mid) => !isCandidateLaunched(mid));
    if (notLaunched.length) {
      throw Object.assign(
        new Error(
          `Launched groups only accept launched candidates. Not launched: ${notLaunched.join(', ')}`,
        ),
        { status: 400 },
      );
    }
  }
  const set = new Set(group.ids || []);
  if (action === 'add') {
    for (const mid of memberIds) set.add(mid);
  } else {
    for (const mid of memberIds) set.delete(mid);
  }
  group.ids = [...set];
  group.updatedAt = nowIso();
  saveGroupsRegistry(registry);
  return group;
}

/** Remove candidate ids from every named group (permanent delete). */
export function purgeCandidateIds(ids = []) {
  const remove = new Set(normalizeIds(ids));
  if (!remove.size) return { groupsTouched: 0, idsRemoved: 0 };
  const registry = loadGroupsRegistry();
  let groupsTouched = 0;
  let idsRemoved = 0;
  for (const g of registry.groups) {
    const before = (g.ids || []).length;
    g.ids = (g.ids || []).filter((id) => !remove.has(id));
    const dropped = before - g.ids.length;
    if (dropped > 0) {
      groupsTouched += 1;
      idsRemoved += dropped;
      g.updatedAt = nowIso();
    }
  }
  if (idsRemoved) saveGroupsRegistry(registry);
  return { groupsTouched, idsRemoved };
}
