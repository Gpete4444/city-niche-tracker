/**
 * Manual named candidate groups (playlist-style membership).
 * Registry: research/candidate-groups.json — not per-candidate meta.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RESEARCH_DIR } from './candidates.mjs';

export const GROUPS_FILE = path.join(RESEARCH_DIR, 'candidate-groups.json');
export const GROUPS_FILENAME = 'candidate-groups.json';

function ensureResearchDir() {
  mkdirSync(RESEARCH_DIR, { recursive: true });
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

export function loadGroupsRegistry() {
  const raw = readJson(GROUPS_FILE, { groups: [] });
  const groups = Array.isArray(raw?.groups) ? raw.groups : [];
  return {
    groups: groups
      .filter((g) => g && typeof g === 'object' && g.id && g.name)
      .map((g) => ({
        id: String(g.id),
        name: String(g.name),
        ids: normalizeIds(g.ids),
        createdAt: g.createdAt || null,
        updatedAt: g.updatedAt || null,
      })),
  };
}

function saveGroupsRegistry(registry) {
  writeJson(GROUPS_FILE, {
    groups: (registry.groups || []).map((g) => ({
      id: g.id,
      name: g.name,
      ids: normalizeIds(g.ids),
      createdAt: g.createdAt || nowIso(),
      updatedAt: g.updatedAt || nowIso(),
    })),
  });
  return loadGroupsRegistry();
}

export function listGroups() {
  return loadGroupsRegistry().groups;
}

/** Map candidateId → groupId[] */
export function membershipByCandidateId(groups = null) {
  const list = groups || listGroups();
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
  const byId = membershipByCandidateId();
  return candidates.map((c) => ({
    ...c,
    groupIds: byId.get(c.id) || [],
  }));
}

export function createGroup(name) {
  const trimmed = normalizeName(name);
  if (!trimmed) {
    throw Object.assign(new Error('Group name is required'), { status: 400 });
  }
  const registry = loadGroupsRegistry();
  if (registry.groups.some((g) => g.name.toLowerCase() === trimmed.toLowerCase())) {
    throw Object.assign(new Error(`Group “${trimmed}” already exists`), { status: 409 });
  }
  const ts = nowIso();
  const group = { id: newGroupId(), name: trimmed, ids: [], createdAt: ts, updatedAt: ts };
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
      (g) => g.id !== id && g.name.toLowerCase() === trimmed.toLowerCase(),
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
