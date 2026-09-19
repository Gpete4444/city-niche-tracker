/**
 * Recovery: fill leftover Address shortlist rows with listed unused Ste N.
 * Does not Assemble / Push. Forever Find already scrapes details on new screens.
 *
 *   node scripts/fill-shortlist-listed-suites.mjs --ids=prosper-concrete-lifting
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RESEARCH_DIR, pathsFor } from '../ops/lib/candidates.mjs';
import {
  composeNapStreet,
  fetchListedSuitesForListing,
  pickFirstUnusedListedSuite,
  sanitizeListedSuite,
  shortlistDedupeKey,
  splitNapStreet,
  stripInventedSuite,
} from '../ops/lib/address-screen.mjs';
import { loadEnvFile } from './lib/dataforseo.mjs';

loadEnvFile();

const args = process.argv.slice(2);
const idArg = args.find((a) => a.startsWith('--ids='));
const wantIds = (idArg ? idArg.slice('--ids='.length).split(',') : ['prosper-concrete-lifting'])
  .map((s) => s.trim())
  .filter(Boolean);

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

function nowIso() {
  return new Date().toISOString();
}

function cityCachePath(city, state) {
  const slug = `${String(city || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}-${String(state || '').toLowerCase()}`;
  return path.join(RESEARCH_DIR, 'address-city-cache', `${slug}.json`);
}

function displayAddress(row, suite = row.suite) {
  const street = composeNapStreet(stripInventedSuite(splitNapStreet(row.street).street), suite);
  return [street, row.city, row.state, row.zip].filter(Boolean).join(', ');
}

function listingUrlOf(row) {
  return String(row?.listingUrl || row?.listingUrls?.loopnet || row?.url || row?.urls?.loopnet || '').trim();
}

function listingMatchesRow(listing, row) {
  if (!listing) return false;
  if (listingUrlOf(listing) && listingUrlOf(listing) === listingUrlOf(row)) return true;
  return shortlistDedupeKey(listing) === shortlistDedupeKey(row);
}

function applyListingSuites(listings, row, suites, fetchedAt) {
  if (!Array.isArray(listings)) return;
  for (const listing of listings) {
    if (!listingMatchesRow(listing, row)) continue;
    listing.listedSuites = suites;
    listing.suitesFetchedAt = fetchedAt;
  }
}

function patchPlacesLabel(row, label) {
  row.reasons = (Array.isArray(row.reasons) ? row.reasons : []).map((reason) => {
    const text = String(reason || '');
    if (/places|no active OPERATIONAL|street\+ZIP/i.test(text)) return label;
    return reason;
  });
  if (!row.reasons.some((reason) => String(reason) === label)) {
    row.reasons = [...row.reasons.filter((reason) => !/STE-\d+/i.test(String(reason))), label];
  }
  row.checks = (Array.isArray(row.checks) ? row.checks : []).map((check) => {
    if (check?.id === 'places_clean') return { ...check, pass: true, label };
    return check;
  });
}

function rowAlreadyFilled(row, cacheListing) {
  const suite = sanitizeListedSuite(row.suite);
  if (suite && (row.listedSuites || []).length) return { skip: true, reason: 'already has listed suite' };
  if (cacheListing?.suitesFetchedAt && !(cacheListing.listedSuites || []).length && !suite) {
    return { skip: true, reason: 'details already empty' };
  }
  return { skip: false };
}

async function fillCandidate(candidateId) {
  const p = pathsFor(candidateId);
  const pkg = readJson(p.businessAddress);
  if (!pkg?.shortlist?.length) {
    console.log(`No shortlist for ${candidateId}`);
    return;
  }
  const city = pkg.city || 'Prosper';
  const state = pkg.state || 'TX';
  const cacheFile = cityCachePath(city, state);
  const cityCache = readJson(cacheFile) || { listings: [], screenedKeys: {} };
  const fetchedAt = nowIso();

  console.log(`\n=== ${candidateId} (${pkg.shortlist.length} recommended) ===`);

  for (const row of pkg.shortlist) {
    const street = stripInventedSuite(splitNapStreet(row.street).street);
    row.street = street;
    const url = listingUrlOf(row);
    const cacheListing = (cityCache.listings || []).find((listing) => listingMatchesRow(listing, row));
    const already = rowAlreadyFilled(row, cacheListing);
    const oldAddr = displayAddress(row, sanitizeListedSuite(row.suite));

    console.log(`\n${street}`);
    if (url) console.log(`Listing: ${url}`);

    if (already.skip) {
      console.log(`KEEP ADDRESS: ${oldAddr}`);
      console.log(`Skip: ${already.reason}`);
      continue;
    }
    if (!url) {
      console.log(`KEEP ADDRESS: ${oldAddr}`);
      console.log('Skip: missing listing URL');
      continue;
    }

    let suites = [];
    try {
      suites = (await fetchListedSuitesForListing(url, row.source || 'loopnet'))
        .map(sanitizeListedSuite)
        .filter(Boolean);
    } catch (error) {
      console.log(`KEEP ADDRESS: ${oldAddr}`);
      console.log(`Skip: details error: ${error.message}`);
      continue;
    }
    console.log(`Suites: ${suites.join(', ') || '(none)'}`);

    let picked = '';
    let placesLabel = 'Places — no active OPERATIONAL Maps listing at this street+ZIP';
    if (suites.length) {
      const pick = await pickFirstUnusedListedSuite(
        { street, city: row.city || city, state: row.state || state, zip: row.zip },
        suites,
      );
      if (pick.allTaken || !pick.suite) {
        console.log(`KEEP ADDRESS: ${oldAddr}`);
        console.log('Skip: all listed suites have an active Maps listing');
        applyListingSuites(cityCache.listings, row, suites, fetchedAt);
        applyListingSuites(pkg.listingCache?.listings, row, suites, fetchedAt);
        row.listedSuites = suites;
        continue;
      }
      picked = pick.suite;
      placesLabel = `Places — listed ${picked} unused`;
    }

    row.suite = picked;
    row.listedSuites = suites;
    patchPlacesLabel(row, placesLabel);
    applyListingSuites(cityCache.listings, row, suites, fetchedAt);
    applyListingSuites(pkg.listingCache?.listings, row, suites, fetchedAt);

    const key = shortlistDedupeKey(row);
    const screened = {
      fail: null,
      at: fetchedAt,
      clean: true,
      suite: picked,
      suitesFetched: true,
      tier: row.tier === 'secondary' ? 'secondary' : 'primary',
      mapsLocality: row.mapsLocality || null,
      mapsState: row.mapsState || null,
      lat: row.lat ?? null,
      lng: row.lng ?? null,
    };
    pkg.screenedKeys = { ...(pkg.screenedKeys || {}), [key]: screened };
    cityCache.screenedKeys = { ...(cityCache.screenedKeys || {}), [key]: screened };

    const newAddr = displayAddress(row, picked);
    if (newAddr === oldAddr) {
      console.log(`KEEP ADDRESS: ${newAddr}`);
    } else {
      console.log(`OLD ADDRESS: ${oldAddr}`);
      console.log(`NEW ADDRESS: ${newAddr}`);
    }
  }

  pkg.updatedAt = fetchedAt;
  cityCache.updatedAt = fetchedAt;
  writeJson(p.businessAddress, pkg);
  writeJson(cacheFile, cityCache);
  console.log(`\nWrote ${p.businessAddress}`);
  console.log(`Wrote ${cacheFile}`);
}

for (const id of wantIds) {
  await fillCandidate(id);
}
