/**
 * Apply listed LoopNet/Crexi suites to accepted NAP, then
 * stage + assemble + ship launched sites so live footer/schema match.
 *
 * Usage:
 *   node ops/lib/run-listed-suite-nap-backfill.mjs --dry-run
 *   node ops/lib/run-listed-suite-nap-backfill.mjs
 *   node ops/lib/run-listed-suite-nap-backfill.mjs --skip-ship
 *   node ops/lib/run-listed-suite-nap-backfill.mjs --ids=sparks-drywall-repair
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RESEARCH_DIR, pathsFor } from './candidates.mjs';
import { isCandidateLaunched } from './launched-edit-guard.mjs';
import {
  composeNapStreet,
  extractListedSuites,
  fetchListedSuitesForListing,
  getCityAddressCache,
  pickFirstUnusedListedSuite,
  runApifyCrexi,
  runApifyLoopnet,
  sanitizeListedSuite,
  splitNapStreet,
  stripInventedSuite,
} from './address-screen.mjs';
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
const cityEnrich = args.includes('--city-enrich');
const includeUnlaunched = args.includes('--include-unlaunched');
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

function streetZipKey(street, zip) {
  const base = splitNapStreet(street).street.toLowerCase().replace(/\s+/g, ' ').trim();
  const z = String(zip || '').replace(/\D/g, '').slice(0, 5);
  return `${base}|${z}`;
}

function streetNumber(street) {
  return String(street || '').match(/\d+/)?.[0] || '';
}

function listingsMatchStreet(listing, street, zip) {
  if (streetZipKey(listing.street, listing.zip) === streetZipKey(street, zip)) return true;
  const wantZip = String(zip || '').replace(/\D/g, '').slice(0, 5);
  const gotZip = String(listing.zip || '').replace(/\D/g, '').slice(0, 5);
  if (wantZip && gotZip && wantZip !== gotZip) return false;
  const wantNum = streetNumber(street);
  const gotNum = streetNumber(listing.street);
  if (!wantNum || !gotNum) return false;
  if (wantNum === gotNum) return true;
  const range = String(listing.street || '').match(/(\d+)\s*[-–]\s*(\d+)/);
  if (range && wantNum >= range[1] && wantNum <= range[2]) return true;
  return false;
}

function listSiteConfigIds() {
  return readdirSync(RESEARCH_DIR)
    .filter((f) => f.endsWith('-site-config.json') && !f.includes('.backup-'))
    .map((f) => f.replace(/-site-config\.json$/i, ''))
    .filter((id) => !wantIds.size || wantIds.has(id));
}

function listingUrlFromPackage(ba, street, zip) {
  const sel = ba?.selection || {};
  if (sel.listingUrl) return { url: sel.listingUrl, source: sel.source };
  const urls = sel.listingUrls || {};
  if (urls.loopnet) return { url: urls.loopnet, source: 'loopnet' };
  if (urls.crexi) return { url: urls.crexi, source: 'crexi' };
  for (const row of Array.isArray(ba?.shortlist) ? ba.shortlist : []) {
    if (!listingsMatchStreet(row, street, zip)) continue;
    const href = row.listingUrl || row.listingUrls?.loopnet || row.listingUrls?.crexi || '';
    if (href) return { url: href, source: row.source || 'loopnet' };
  }
  return { url: '', source: '' };
}

function suitesFromCache(city, state, street, zip) {
  const cache = getCityAddressCache(city, state);
  const listing = (cache?.listings || []).find((row) => listingsMatchStreet(row, street, zip));
  if (!listing) return [];
  return listing.listedSuites?.length ? listing.listedSuites : extractListedSuites(listing);
}

function replaceStreetInValue(value, oldStreet, newStreet) {
  if (!oldStreet || !newStreet || oldStreet === newStreet) return value;
  if (typeof value === 'string') {
    return value.split(oldStreet).join(newStreet);
  }
  if (Array.isArray(value)) return value.map((v) => replaceStreetInValue(v, oldStreet, newStreet));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = replaceStreetInValue(v, oldStreet, newStreet);
    return out;
  }
  return value;
}

const cityListingMemo = new Map();

async function listingsForCity(city, state, preferCrexi) {
  const key = `${String(city).toLowerCase()}|${String(state).toUpperCase()}|${preferCrexi ? 'crexi' : 'loopnet'}`;
  if (cityListingMemo.has(key)) return cityListingMemo.get(key);
  const pull = preferCrexi
    ? await runApifyCrexi({ city, state, max: 40 })
    : await runApifyLoopnet({ city, state, max: 40 });
  const listings = Array.isArray(pull?.listings) ? pull.listings : [];
  cityListingMemo.set(key, listings);
  return listings;
}

function suitesFromListings(listings, street, zip) {
  const listing = (listings || []).find((row) => listingsMatchStreet(row, street, zip));
  if (!listing) return [];
  return listing.listedSuites?.length ? listing.listedSuites : extractListedSuites(listing);
}

async function resolveListedSuites(row) {
  if (!row.listingUrl) return { suites: [], via: 'no-url' };
  const suites = await fetchListedSuitesForListing(row.listingUrl, row.listingSource);
  return { suites, via: suites.length ? 'listing-details' : 'listing-details-empty' };
}

function logKeepAddress(row, reason) {
  console.log('Skip:', reason);
  console.log(`KEEP ADDRESS: ${[row.oldStreet, row.city, row.state, row.zip].filter(Boolean).join(', ')}`);
}

function collectTargets() {
  const rows = [];
  for (const id of listSiteConfigIds()) {
    const p = pathsFor(id);
    const cfg = readJson(p.siteConfig);
    const ba = readJson(p.businessAddress);
    const streetRaw = String(cfg?.address?.street || ba?.selection?.street || '').trim();
    if (!includeUnlaunched && !isCandidateLaunched(id)) continue;
    if (!streetRaw) continue;
    const split = splitNapStreet(streetRaw);
    const streetBase = stripInventedSuite(split.street);
    if (!streetBase || !cfg?.address?.zip && !ba?.selection?.zip) continue;
    if (split.suite && !/^STE-\d+$/i.test(split.suite)) continue;
    const zip = String(cfg?.address?.zip || ba?.selection?.zip || '').trim();
    const city = String(cfg?.address?.city || ba?.selection?.city || cfg?.primaryCity || '').trim();
    const state = String(cfg?.address?.state || ba?.selection?.state || cfg?.state || '').trim();
    const listing = listingUrlFromPackage(ba, streetBase, zip);
    rows.push({
      candidateId: id,
      launched: isCandidateLaunched(id),
      streetBase,
      oldStreet: streetRaw,
      zip,
      city,
      state,
      listingUrl: listing.url,
      listingSource: listing.source,
    });
  }
  return rows;
}

function applySuite(row) {
  const p = pathsFor(row.candidateId);
  const changed = [];
  const cfg = readJson(p.siteConfig);
  if (cfg?.address) {
    cfg.address = { ...cfg.address, street: row.newStreet };
    if (!dryRun) writeJson(p.siteConfig, cfg);
    changed.push('site-config');
  }
  const ba = readJson(p.businessAddress);
  if (ba?.selection) {
    ba.selection = {
      ...ba.selection,
      street: row.streetBase,
      streetBase: row.streetBase,
      suite: row.suite,
      listingUrl: row.listingUrl || ba.selection.listingUrl,
      listingUrls: ba.selection.listingUrls,
    };
    if (!dryRun) writeJson(p.businessAddress, ba);
    changed.push('business-address');
  }
  for (const [key, file] of [
    ['content', p.content],
    ['content-draft', p.contentDraft],
    ['build-package', p.buildPackage],
  ]) {
    const doc = readJson(file);
    if (!doc) continue;
    const next = replaceStreetInValue(doc, row.oldStreet, row.newStreet);
    if (JSON.stringify(next) === JSON.stringify(doc)) continue;
    if (!dryRun) writeJson(file, next);
    changed.push(key);
  }
  const templateFile = path.join(ROOT, 'src', 'config', 'site-config.json');
  const template = readJson(templateFile);
  const tStreet = template?.address?.street;
  if (tStreet && (tStreet === row.oldStreet || stripInventedSuite(tStreet) === row.streetBase)) {
    template.address = { ...template.address, street: row.newStreet };
    if (!dryRun) writeJson(templateFile, template);
    changed.push('template-site-config');
  }
  return changed;
}

const targets = collectTargets();
if (!targets.length) {
  console.log('No accepted commercial streets need a listed-suite pass.');
  process.exit(0);
}

console.log(`${dryRun ? 'Dry run — ' : ''}checking ${targets.length} candidate(s) for listed suites…`);

const results = [];
for (const row of targets) {
  const out = {
    candidateId: row.candidateId,
    launched: row.launched,
    oldStreet: row.oldStreet,
    newStreet: row.oldStreet,
    suite: '',
    skip: null,
    changed: [],
    stage: null,
    assemble: null,
    ship: null,
    ok: false,
    error: null,
  };
  console.log(`\n=== ${row.candidateId} (${row.launched ? 'launched' : 'unlaunched'}) ===`);
    if (row.listingUrl) console.log(`Listing: ${row.listingUrl}`);
  try {
    const resolved = await resolveListedSuites(row);
    const suites = (resolved.suites || []).map(sanitizeListedSuite).filter(Boolean);
    console.log(`Suites via ${resolved.via}: ${suites.join(', ') || '(none)'}`);
    if (!suites.length) {
      out.skip = resolved.via === 'no-url' ? 'missing listing URL' : 'no listed suites';
      out.ok = true;
      logKeepAddress(row, out.skip);
      results.push(out);
      continue;
    }
    const pick = await pickFirstUnusedListedSuite(
      { street: row.streetBase, city: row.city, state: row.state, zip: row.zip },
      suites,
    );
    if (pick.allTaken || !pick.suite) {
      out.skip = 'all listed suites have an active Maps listing';
      out.ok = true;
      logKeepAddress(row, out.skip);
      results.push(out);
      continue;
    }
    row.suite = pick.suite;
    row.newStreet = composeNapStreet(row.streetBase, pick.suite);
    out.suite = pick.suite;
    out.newStreet = row.newStreet;
    if (row.newStreet === row.oldStreet) {
      out.skip = 'already composed';
      out.ok = true;
      logKeepAddress(row, out.skip);
      results.push(out);
      continue;
    }
    const fullNew = [row.newStreet, row.city, row.state, row.zip].filter(Boolean).join(', ');
    const fullOld = [row.oldStreet, row.city, row.state, row.zip].filter(Boolean).join(', ');
    console.log(`OLD ADDRESS: ${fullOld}`);
    console.log(`NEW ADDRESS: ${fullNew}`);
    if (dryRun) {
      out.ok = true;
      results.push(out);
      continue;
    }
    out.changed = applySuite(row);
    console.log('Wrote:', out.changed.join(', ') || 'nothing');
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
      console.log(`SHIPPED ADDRESS: ${[row.newStreet, row.city, row.state, row.zip].filter(Boolean).join(', ')}`);
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
const shipped = results.filter((r) => r.ship?.ok);
const skipped = results.filter((r) => r.skip);
console.log(
  `\nDone. ok=${results.filter((r) => r.ok).length} shipped=${shipped.length} skipped=${skipped.length} failed=${failed.length}`,
);
console.log(JSON.stringify(results, null, 2));
if (failed.length) process.exitCode = 1;
