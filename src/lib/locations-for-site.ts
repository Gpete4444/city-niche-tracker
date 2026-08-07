import type { SiteConfig } from '../config/site';

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

type SiteGeo = Pick<SiteConfig, 'primaryCity' | 'state' | 'targetSuburbs' | 'coverageAreas'>;

function norm(s: string) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

function allowedCities(site: SiteGeo): Set<string> {
  const cities = new Set<string>();
  if (site.primaryCity) cities.add(norm(site.primaryCity));
  for (const s of site.targetSuburbs || []) {
    if (s) cities.add(norm(s));
  }
  for (const a of site.coverageAreas || []) {
    if (a?.name) cities.add(norm(a.name));
  }
  return cities;
}

/**
 * Keep non-draft location entries for this site's state.
 * Prefer cities in primaryCity / targetSuburbs / coverageAreas when any are set;
 * if that preference empties the list, keep all same-state entries.
 */
export function filterLocationsForSite<T extends LocationEntryLike>(
  entries: T[],
  site: SiteGeo,
): T[] {
  const siteState = norm(site.state);
  const sameState = (entries || []).filter(
    (e) => !e.data.draft && norm(e.data.state) === siteState,
  );
  const prefer = allowedCities(site);
  if (!prefer.size) return sameState;
  const preferred = sameState.filter((e) => prefer.has(norm(e.data.city)));
  return preferred.length ? preferred : sameState;
}

/** Fallback chips from site-config when no matching location Markdown exists. */
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
    out.push({ city: name, state, href: '/contact' });
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
 * Location links for homepage / nav: filtered MD pages, or site-config fallback.
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
      href: `/locations/${e.id}`,
    }));
  }
  return locationLinksFromSite(site);
}
