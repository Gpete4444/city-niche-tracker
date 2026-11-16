/**
 * Stage, force-assemble, and ship the 30 sites whose homepage intro
 * linked the business name to /. Does not call launchSite.
 * Resume: sites with shipOk in the log are skipped.
 * Run: node scripts/relaunch-brand-link-sites.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from './lib/dataforseo.mjs';
import { stageSiteContent } from '../ops/lib/site-staging.mjs';
import { assembleSite, finalizePreviousAssembledSite } from '../ops/lib/assemble-site.mjs';
import { shipAssembledSite } from '../ops/lib/ship-site.mjs';

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

const LOG = path.resolve('research/_brand-link-relaunch.json');

function log(line) {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(text);
}

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

function brandLinkLeft(siteRoot) {
  const indexPath = path.join(siteRoot, 'src', 'content', 'pages', 'index.md');
  const configPath = path.join(siteRoot, 'src', 'config', 'site-config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const name = String(config.businessName || '').trim();
  const text = fs.readFileSync(indexPath, 'utf8');
  if (!name) return 'missing businessName';
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\[${escaped}\\]\\(\\s*/\\s*\\)`, 'i').test(text)) {
    return `[${name}](/) still in index.md`;
  }
  const intro = fs.readFileSync(path.join(siteRoot, 'src', 'pages', 'index.astro'), 'utf8');
  if (!intro.includes('simpleProseToHtml')) return 'assembled index.astro is missing the intro renderer';
  return '';
}

loadEnvFile();
const results = readLog();

for (const id of IDS) {
  const prior = results[id];
  if (prior?.shipOk) {
    log(`SKIP ${id} already shipped`);
    continue;
  }
  const row = {
    id,
    startedAt: new Date().toISOString(),
    shipOk: false,
    error: '',
  };
  try {
    if (prior?.assembledOk && prior?.brandClean && prior.absoluteSiteRoot && fs.existsSync(prior.absoluteSiteRoot)) {
      log(`SHIP-ONLY ${id}`);
      row.assembledOk = true;
      row.absoluteSiteRoot = prior.absoluteSiteRoot;
      row.mode = prior.mode || '';
    } else {
      log(`STAGE ${id}`);
      stageSiteContent(id, { mode: 'full', refreshPackage: true });
      log(`ASSEMBLE ${id}`);
      const assembled = assembleSite(id, { force: true });
      row.assembledOk = true;
      row.mode = assembled.mode;
      row.absoluteSiteRoot = assembled.absoluteSiteRoot;
      row.previousSiteRoot = assembled.previousSiteRoot || '';
      const brand = brandLinkLeft(assembled.absoluteSiteRoot);
      if (brand) throw new Error(brand);
      row.brandClean = true;
      if (assembled.previousSiteRoot) {
        log(`RETIRE ${id}`);
        await finalizePreviousAssembledSite(assembled.previousSiteRoot);
        row.retired = true;
      }
    }
    log(`SHIP ${id}`);
    const ship = await shipAssembledSite(id, {});
    row.shipOk = Boolean(ship.ok);
    row.slug = ship.slug || '';
    row.human = (ship.human || []).slice(-6);
    if (!ship.ok) {
      row.error = (ship.human || []).filter(Boolean).join(' | ').slice(0, 500) || 'ship returned ok:false';
    }
    log(`${row.shipOk ? 'SHIPPED' : 'SHIP-FAIL'} ${id} ${row.error}`);
  } catch (error) {
    row.error = error?.message || String(error);
    log(`FAILED ${id} ${row.error}`);
  }
  row.finishedAt = new Date().toISOString();
  results[id] = row;
  writeLog(results);
}

const shipped = IDS.filter((id) => results[id]?.shipOk);
const failed = IDS.filter((id) => !results[id]?.shipOk);
log(`DONE shipped=${shipped.length} failed=${failed.length}`);
if (failed.length) {
  for (const id of failed) log(`FAIL ${id} ${results[id]?.error || 'no result'}`);
  process.exitCode = 1;
}
