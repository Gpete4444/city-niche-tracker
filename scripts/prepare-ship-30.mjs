/**
 * Stage, assemble like Prepare preview, and ship the same 30 sites, six at a time.
 * Does not call launchSite and does not start a local preview.
 * Resume: only shipOk in research/_template-prepare-ship-30.json is skipped.
 * Run: node scripts/prepare-ship-30.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IDS = [
  'apache-junction-artificial-turf',
  'caldwell-drywall-repair',
  'casa-grande-epoxy-flooring',
  'centerville-trenchless-sewer-repair',
  'coolidge-artificial-turf',
  'dayton-trenchless-sewer-repair',
  'draper-foundation-repair',
  'erlanger-trenchless-sewer-repair',
  'florence-trenchless-sewer-repair',
  'forest-park-trenchless-sewer-repair',
  'fort-thomas-trenchless-sewer-repair',
  'garden-city-drywall-repair',
  'holladay-foundation-repair',
  'huber-heights-trenchless-sewer-repair',
  'kuna-drywall-repair',
  'middleton-drywall-repair',
  'midvale-foundation-repair',
  'millcreek-foundation-repair',
  'new-river-epoxy-flooring',
  'north-salt-lake-foundation-repair',
  'orem-foundation-repair',
  'richmond-trenchless-sewer-repair',
  'riverside-trenchless-sewer-repair',
  'saratoga-springs-foundation-repair',
  'springboro-trenchless-sewer-repair',
  'springfield-trenchless-sewer-repair',
  'syracuse-foundation-repair',
  'temple-custom-cabinets',
  'vandalia-trenchless-sewer-repair',
  'west-haven-foundation-repair',
];

const POOL = 6;
const RESULT_MARK = 'TEMPLATE_PREPARE_SHIP_RESULT ';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const LOG = path.join(root, 'research', '_template-prepare-ship-30.json');

function readLog() {
  try {
    const data = JSON.parse(fs.readFileSync(LOG, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeLog(data) {
  fs.writeFileSync(LOG, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function progressLabel(row) {
  if (!row?.shipOk) return 'failed';
  return row.mapOld ? 'shipped map-old' : 'shipped';
}

function mapWasLeftOld(relabel) {
  if (!relabel || relabel.redrawn === true) return false;
  const reason = String(relabel.reason || '');
  return reason !== '' && reason !== 'complete' && reason !== 'missing';
}

const oneId = process.argv[2] === '--one' ? String(process.argv[3] || '').trim() : '';

if (oneId) {
  const { loadEnvFile } = await import('./lib/dataforseo.mjs');
  const { stageSiteContent } = await import('../ops/lib/site-staging.mjs');
  const { assembleSite, finalizePreviousAssembledSite } = await import('../ops/lib/assemble-site.mjs');
  const { shipAssembledSite } = await import('../ops/lib/ship-site.mjs');
  loadEnvFile(root);
  const row = {
    id: oneId,
    startedAt: new Date().toISOString(),
    shipOk: false,
    mapOld: false,
    error: '',
  };
  try {
    console.error(`STAGE ${oneId}`);
    const staged = stageSiteContent(oneId, { mode: 'full', refreshPackage: true });
    const relabel = staged.coverageMapRelabel || {};
    row.mapRelabel = {
      redrawn: Boolean(relabel.redrawn),
      reason: relabel.reason || (relabel.redrawn ? 'redrawn' : ''),
    };
    row.mapOld = mapWasLeftOld(relabel);
    console.error(`ASSEMBLE ${oneId}`);
    const assembled = assembleSite(oneId, { force: false, refresh: true });
    row.assembledOk = true;
    row.mode = assembled.mode;
    row.absoluteSiteRoot = assembled.absoluteSiteRoot;
    row.previousSiteRoot = assembled.previousSiteRoot || '';
    try {
      const cfg = JSON.parse(
        fs.readFileSync(path.join(assembled.absoluteSiteRoot, 'src', 'config', 'site-config.json'), 'utf8'),
      );
      row.domain = String(cfg.domain || '').trim();
    } catch {
      row.domain = '';
    }
    if (assembled.previousSiteRoot) {
      console.error(`RETIRE ${oneId}`);
      await finalizePreviousAssembledSite(assembled.previousSiteRoot);
      row.retired = true;
    }
    console.error(`SHIP ${oneId}`);
    const ship = await shipAssembledSite(oneId, {});
    row.shipOk = Boolean(ship.ok);
    row.slug = ship.slug || '';
    row.human = (ship.human || []).slice(-8);
    if (!ship.ok) {
      row.error = (ship.human || []).filter(Boolean).join(' | ').slice(0, 500) || 'ship returned ok:false';
    }
  } catch (error) {
    row.error = error?.message || String(error);
    console.error(`FAILED ${oneId} ${row.error}`);
  }
  row.finishedAt = new Date().toISOString();
  process.stdout.write(`${RESULT_MARK}${JSON.stringify(row)}\n`);
  process.exit(row.shipOk ? 0 : 1);
}

const results = readLog();
let done = 0;
for (const id of IDS) {
  if (results[id]?.shipOk) {
    done += 1;
    console.log(`${done}/${IDS.length} ${id} ${progressLabel(results[id])}`);
  }
}

const pending = IDS.filter((id) => !results[id]?.shipOk);
console.error(`START pending=${pending.length} pool=${Math.min(POOL, pending.length)}`);

function runOne(id) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, 'prepare-ship-30.mjs'), '--one', id], {
      cwd: root,
      windowsHide: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    let settled = false;
    const finish = (row) => {
      if (settled) return;
      settled = true;
      results[id] = row;
      writeLog(results);
      done += 1;
      console.log(`${done}/${IDS.length} ${id} ${progressLabel(row)}`);
      resolve(row);
    };
    child.stdout.on('data', (buf) => {
      const text = buf.toString();
      out += text;
      process.stdout.write(text);
    });
    child.on('error', (error) => {
      finish({
        id,
        shipOk: false,
        mapOld: false,
        error: error?.message || String(error),
        finishedAt: new Date().toISOString(),
      });
    });
    child.on('close', () => {
      if (settled) return;
      const line = out
        .split(/\r?\n/)
        .map((item) => item.trim())
        .reverse()
        .find((item) => item.startsWith(RESULT_MARK));
      let row = null;
      if (line) {
        try {
          row = JSON.parse(line.slice(RESULT_MARK.length));
        } catch {
          row = null;
        }
      }
      if (!row || row.id !== id) {
        row = {
          id,
          shipOk: false,
          mapOld: false,
          error: out.trim().slice(-500) || 'child exited without a result',
          finishedAt: new Date().toISOString(),
        };
      }
      finish(row);
    });
  });
}

let cursor = 0;
async function worker() {
  while (cursor < pending.length) {
    const id = pending[cursor];
    cursor += 1;
    await runOne(id);
  }
}

const workers = Math.min(POOL, pending.length);
await Promise.all(Array.from({ length: workers }, () => worker()));

const shipped = IDS.filter((id) => results[id]?.shipOk);
const failed = IDS.filter((id) => !results[id]?.shipOk);
const mapOld = IDS.filter((id) => results[id]?.shipOk && results[id]?.mapOld);
console.log(`DONE shipped=${shipped.length} failed=${failed.length} map-old=${mapOld.length}`);
for (const id of failed) console.log(`FAIL ${id} ${results[id]?.error || 'no result'}`);
for (const id of mapOld) console.log(`MAP-OLD ${id} ${results[id]?.mapRelabel?.reason || ''}`);
if (failed.length) process.exitCode = 1;
