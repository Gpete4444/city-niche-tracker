/**
 * Domain templates saved once per niche, e.g. `[City]SewerPros.com`.
 * File is created on the first save.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { nichePatternKey, normalizeNicheDomainPattern } from '../public/domain-suggest.mjs';

const FILE = path.join(process.cwd(), 'data', 'niche-domain-patterns.json');

function readAll(filePath) {
  if (!existsSync(filePath)) return {};
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return data;
  } catch {
    return {};
  }
}

function writeAll(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function patternsFor(data, key) {
  const list = data[key];
  return Array.isArray(list) ? list.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

export function listNicheDomainPatterns(niche, filePath = FILE) {
  const key = nichePatternKey(niche);
  if (!key) return [];
  return patternsFor(readAll(filePath), key);
}

export function addNicheDomainPattern(niche, pattern, filePath = FILE) {
  const key = nichePatternKey(niche);
  if (!key) {
    throw Object.assign(new Error('Niche is required.'), { status: 400 });
  }
  const norm = normalizeNicheDomainPattern(pattern);
  if (!norm.ok) {
    throw Object.assign(new Error(norm.error), { status: 400 });
  }
  const all = readAll(filePath);
  const list = patternsFor(all, key);
  const added = !list.some((item) => {
    const existing = normalizeNicheDomainPattern(item);
    return existing.ok && existing.key === norm.key;
  });
  if (added) list.push(norm.pattern);
  all[key] = list;
  writeAll(filePath, all);
  return { niche: key, pattern: norm.pattern, patterns: list, added };
}

export function removeNicheDomainPattern(niche, pattern, filePath = FILE) {
  const key = nichePatternKey(niche);
  if (!key) {
    throw Object.assign(new Error('Niche is required.'), { status: 400 });
  }
  const norm = normalizeNicheDomainPattern(pattern);
  const target = norm.ok ? norm.key : String(pattern || '').trim().toLowerCase();
  if (!target) {
    throw Object.assign(new Error('Pattern is required.'), { status: 400 });
  }
  if (!existsSync(filePath)) return { niche: key, patterns: [] };
  const all = readAll(filePath);
  const list = patternsFor(all, key).filter((item) => {
    const existing = normalizeNicheDomainPattern(item);
    const itemKey = existing.ok ? existing.key : item.toLowerCase();
    return itemKey !== target && item !== String(pattern || '').trim();
  });
  if (list.length) all[key] = list;
  else delete all[key];
  writeAll(filePath, all);
  return { niche: key, patterns: list };
}
