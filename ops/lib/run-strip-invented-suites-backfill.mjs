/**
 * Strip Rover-invented STE-* NAP stubs from accepted configs/content, then
 * stage + assemble + ship launched sites so live footer/schema match.
 *
 * Usage:
 *   node ops/lib/run-strip-invented-suites-backfill.mjs --dry-run
 *   node ops/lib/run-strip-invented-suites-backfill.mjs
 *   node ops/lib/run-strip-invented-suites-backfill.mjs --skip-ship
 *   node ops/lib/run-strip-invented-suites-backfill.mjs --ids=sparks-drywall-repair
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RESEARCH_DIR, pathsFor } from './candidates.mjs';
import { isCandidateLaunched } from './launched-edit-guard.mjs';
import { stripInventedSuite } from './address-screen.mjs';
import { stageSiteContent } from './site-staging.mjs';
import { assembleSite } from './assemble-site.mjs';
import { shipAssembledSite } from './ship-site.mjs';
import { loadEnvFile } from '../../scripts/lib/dataforseo.mjs';

loadEnvFile();

const ROOT = process.cwd();
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipShip = args.includes('--skip-ship');
const skipAssemble = args.includes('--skip-assemble');
const idArg = args.find((a) => a.startsWith('--ids='));
const wantIds = new Set(
  (idArg ? idArg.slice('--ids='.length).split(',') : [])
    .map((s) => s.trim())
    .filter(Boolean),
);

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function streetHasInventedSuite(street) {
  return Boolean(street && stripInventedSuite(street) !== String(street).trim());
}

function stripSuiteAfterStreet(text, streetBase) {
  if (!text || !streetBase) return text;
  const re = new RegExp(`${escapeRegExp(streetBase)}(?:,\\s*STE-\\d+)?`, 'gi');
  return String(text).replace(re, streetBase);
}

function stripSuiteInValue(value, streetBase) {
  if (typeof value === 'string') return stripSuiteAfterStreet(value, streetBase);
  if (Array.isArray(value)) return value.map((v) => stripSuiteInValue(v, streetBase));
  if (value && typeof value === 'object') {
    const out = Array.isArray(value) ? [] : {};
    for (const [k, v] of Object.entries(value)) out[k] = stripSuiteInValue(v, streetBase);
    return out;
  }
  return value;
}

function listSiteConfigIds() {
  return readdirSync(RESEARCH_DIR)
    .filter((f) => f.endsWith('-site-config.json') && !f.includes('.backup-'))
    .map((f) => f.replace(/-site-config\.json$/i, ''))
    .filter((id) => !wantIds.size || wantIds.has(id));
}

function patchBusinessAddress(candidateId, streetBase) {
  const file = pathsFor(candidateId).businessAddress;
  const pkg = readJson(file);
  if (!pkg || typeof pkg !== 'object') return false;
  let dirty = false;
  if (pkg.selection && typeof pkg.selection === 'object') {
    const nextStreet = stripInventedSuite(pkg.selection.streetBase || pkg.selection.street);
    if (
      nextStreet !== pkg.selection.street ||
      pkg.selection.suite ||
      pkg.selection.streetBase !== nextStreet
    ) {
      pkg.selection = {
        ...pkg.selection,
        street: nextStreet || streetBase,
        streetBase: nextStreet || streetBase,
        suite: '',
      };
      dirty = true;
    }
  }
  if (Array.isArray(pkg.shortlist) && pkg.shortlist.length) {
    pkg.shortlist = pkg.shortlist.map((row) => {
      const street = stripInventedSuite(row.street);
      const checks = Array.isArray(row.checks) ? row.checks.filter((c) => c?.id !== 'suite') : row.checks;
      if (street !== row.street || row.suite || (Array.isArray(row.checks) && row.checks.some((c) => c?.id === 'suite'))) {
        dirty = true;
        return { ...row, street, suite: '', checks };
      }
      return row;
    });
  }
  if (dirty && !dryRun) writeJson(file, pkg);
  return dirty;
}

function patchContentFile(filePath, streetBase) {
  const doc = readJson(filePath);
  if (!doc || typeof doc !== 'object') return false;
  const next = stripSuiteInValue(doc, streetBase);
  if (JSON.stringify(next) === JSON.stringify(doc)) return false;
  if (!dryRun) writeJson(filePath, next);
  return true;
}

function patchTemplateSiteConfig(streetBase, oldStreet) {
  const file = path.join(ROOT, 'src', 'config', 'site-config.json');
  const cfg = readJson(file);
  const street = cfg?.address?.street;
  if (!street || (street !== oldStreet && stripInventedSuite(street) !== streetBase)) return false;
  if (!streetHasInventedSuite(street)) return false;
  cfg.address = { ...cfg.address, street: streetBase };
  if (!dryRun) writeJson(file, cfg);
  return true;
}

function collectTargets() {
  const rows = [];
  for (const id of listSiteConfigIds()) {
    const p = pathsFor(id);
    const cfg = readJson(p.siteConfig);
    const street = String(cfg?.address?.street || '').trim();
    const streetBase = stripInventedSuite(street);
    const configDirty = Boolean(street && street !== streetBase);
    const content = readJson(p.content);
    const draft = readJson(p.contentDraft);
    const blob = `${JSON.stringify(content || {})}\n${JSON.stringify(draft || {})}`;
    const contentDirty = Boolean(
      streetBase &&
        (new RegExp(`${escapeRegExp(streetBase)},\\s*STE-\\d+`, 'i').test(blob) ||
          (street && street !== streetBase && blob.includes(street))),
    );
    const ba = readJson(p.businessAddress);
    const baDirty = Boolean(
      streetHasInventedSuite(ba?.selection?.street) ||
        ba?.selection?.suite ||
        (Array.isArray(ba?.shortlist) &&
          ba.shortlist.some((r) => r?.suite || streetHasInventedSuite(r?.street))),
    );
    if (!configDirty && !contentDirty && !baDirty) continue;
    rows.push({
      candidateId: id,
      launched: isCandidateLaunched(id),
      oldStreet: street || ba?.selection?.street || '',
      newStreet: streetBase || stripInventedSuite(ba?.selection?.street || ''),
      configDirty,
      contentDirty,
      baDirty,
    });
  }
  return rows;
}

function applyStrip(row) {
  const p = pathsFor(row.candidateId);
  const changed = [];
  if (row.configDirty) {
    const cfg = readJson(p.siteConfig);
    if (cfg?.address) {
      cfg.address = { ...cfg.address, street: row.newStreet };
      if (!dryRun) writeJson(p.siteConfig, cfg);
      changed.push('site-config');
    }
  }
  if (patchBusinessAddress(row.candidateId, row.newStreet)) changed.push('business-address');
  if (patchContentFile(p.content, row.newStreet)) changed.push('content');
  if (patchContentFile(p.contentDraft, row.newStreet)) changed.push('content-draft');
  if (patchContentFile(p.buildPackage, row.newStreet)) changed.push('build-package');
  if (patchTemplateSiteConfig(row.newStreet, row.oldStreet)) changed.push('template-site-config');
  return changed;
}

const targets = collectTargets();
if (!targets.length) {
  console.log('No invented STE-* suites found.');
  process.exit(0);
}

console.log(`${dryRun ? 'Dry run — ' : ''}found ${targets.length} candidate(s) with invented suites:`);
for (const row of targets) {
  console.log(
    `  ${row.launched ? 'LAUNCHED' : 'unlaunched'}  ${row.candidateId}\n    ${row.oldStreet}  →  ${row.newStreet}`,
  );
}

if (dryRun) {
  process.exit(0);
}

const results = [];
for (const row of targets) {
  const out = {
    candidateId: row.candidateId,
    launched: row.launched,
    oldStreet: row.oldStreet,
    newStreet: row.newStreet,
    changed: [],
    stage: null,
    assemble: null,
    ship: null,
    ok: false,
    error: null,
  };
  console.log(`\n=== ${row.candidateId} (${row.launched ? 'launched' : 'unlaunched'}) ===`);
  try {
    out.changed = applyStrip(row);
    console.log('Stripped:', out.changed.join(', ') || 'nothing');
    if (row.launched && !skipAssemble) {
      console.log('Stage…');
      stageSiteContent(row.candidateId, { mode: 'full', refreshPackage: true });
      out.stage = { ok: true };
      console.log('Assemble…');
      assembleSite(row.candidateId, { force: true });
      out.assemble = { ok: true };
    } else if (row.launched && skipAssemble) {
      out.assemble = { skipped: true };
    }
    if (row.launched && !skipShip && !skipAssemble) {
      console.log('Ship…');
      const ship = await shipAssembledSite(row.candidateId, {});
      out.ship = { ok: ship.ok, error: ship.ok ? null : ship.human?.join('; ') };
      if (!ship.ok) throw new Error(ship.human?.join('; ') || 'ship failed');
    } else if (row.launched && skipShip) {
      out.ship = { skipped: true };
    }
    out.ok = true;
  } catch (error) {
    out.error = error.message || String(error);
    console.error('FAILED:', out.error);
  }
  results.push(out);
}

const failed = results.filter((r) => !r.ok);
console.log(`\nDone. ok=${results.filter((r) => r.ok).length} failed=${failed.length}`);
console.log(JSON.stringify(results, null, 2));
if (failed.length) process.exitCode = 1;
