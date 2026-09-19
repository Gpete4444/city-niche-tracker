import type { SiteConfig } from '../config/site';
import { locationPath, sitePath } from './site-path';

export type LocationEntryLike = {
  id: string;
  data: {
    city: string;
    state: string;
    draft?: boolean;
  };
};

export type LocationLink = {
  id?: string;
  city: string;
  state: string;
  href: string;
};

type SiteGeo = Pick<
  SiteConfig,
  'primaryCity' | 'state' | 'targetSuburbs' | 'coverageAreas' | 'alsoServing'
>;

/** Same cap as Site-Config Zone Also serving column. */
const ALSO_SERVING_CAP = 10;

function norm(s: string) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

/** Cities that get real /locations pages: primary + targetSuburbs. */
export function seoLocationCities(site: SiteGeo): Set<string> {
  const cities = new Set<string>();
  if (site.primaryCity) cities.add(norm(site.primaryCity));
  for (const s of site.targetSuburbs || []) {
    if (s) cities.add(norm(String(s)));
  }
  return cities;
}

function coverageCityNames(site: SiteGeo): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of site.coverageAreas || []) {
    const name = String(a?.name || '').trim();
    if (!name) continue;
    const key = norm(name);
    if (seen.has(key)) continue;
    if (a?.state && site.state && norm(a.state) !== norm(site.state)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Location MD entries for SEO pages only (primary + targetSuburbs).
 * Prefer that set; if empty match, fall back to same-state entries filtered by SEO names only.
 */
export function filterLocationsForSite<T extends LocationEntryLike>(
  entries: T[],
  site: SiteGeo,
): T[] {
  const siteState = norm(site.state);
  const sameState = (entries || []).filter(
    (e) => !e.data.draft && norm(e.data.state) === siteState,
  );
  const prefer = seoLocationCities(site);
  if (!prefer.size) return sameState;
  const preferred = sameState.filter((e) => prefer.has(norm(e.data.city)));
  return preferred.length ? preferred : sameState.filter((e) => prefer.has(norm(e.data.city)));
}

/**
 * Coverage cities without a location page — for “Also serving” (link to contact).
 * Prefers persisted site.alsoServing (Accept / Stage); otherwise leftover coverage.
 * Always capped at 10. Homepage always appends “and others” after this list.
 */
export function alsoServingLinks(site: SiteGeo): LocationLink[] {
  const state = String(site.state || '').trim().toUpperCase();
  const seo = seoLocationCities(site);
  const saved = (site.alsoServing || [])
    .map((s) => String(s || '').trim())
    .filter((name) => name && !seo.has(norm(name)));
  const names = (saved.length ? saved : coverageCityNames(site).filter((name) => !seo.has(norm(name))))
    .slice(0, ALSO_SERVING_CAP);
  return names.map((city) => ({ city, state, href: sitePath('/contact') }));
}

/** @deprecated Prefer alsoServingLinks + filterLocationsForSite */
export function locationLinksFromSite(site: SiteGeo): LocationLink[] {
  const state = String(site.state || '').trim().toUpperCase();
  const seen = new Set<string>();
  const out: LocationLink[] = [];

  const push = (city: string) => {
    const name = String(city || '').trim();
    if (!name) return;
    const key = norm(name);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ city: name, state, href: sitePath('/contact') });
  };

  if (Array.isArray(site.coverageAreas) && site.coverageAreas.length) {
    for (const area of site.coverageAreas) {
      if (area?.state && norm(area.state) !== norm(state)) continue;
      push(area.name);
    }
  }
  if (!out.length) {
    for (const suburb of site.targetSuburbs || []) push(suburb);
  }
  return out;
}

/**
 * Location links for homepage / nav: filtered MD pages, or SEO city fallback to contact.
 */
export function locationLinksForSite<T extends LocationEntryLike>(
  entries: T[],
  site: SiteGeo,
): LocationLink[] {
  const filtered = filterLocationsForSite(entries, site);
  if (filtered.length) {
    return filtered.map((e) => ({
      id: e.id,
      city: e.data.city,
      state: e.data.state,
      href: locationPath(e.id),
    }));
  }
  const seo = seoLocationCities(site);
  const state = String(site.state || '').trim().toUpperCase();
  const out: LocationLink[] = [];
  if (site.primaryCity && seo.has(norm(site.primaryCity))) {
    out.push({ city: site.primaryCity, state, href: sitePath('/contact') });
  }
  for (const s of site.targetSuburbs || []) {
    const name = String(s || '').trim();
    if (!name) continue;
    out.push({ city: name, state, href: sitePath('/contact') });
  }
  return out;
}
