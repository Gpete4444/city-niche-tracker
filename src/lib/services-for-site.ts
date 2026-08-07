import type { SiteConfig } from '../config/site';
import { homepageServicesDisplayLimit } from '../config/site';

export type ServiceEntryLike = {
  id: string;
  data: {
    serviceName: string;
    description?: string;
    draft?: boolean;
    order?: number;
    cardImage?: {
      src: string;
      alt: string;
    };
  };
};

export type ServiceCard = {
  id?: string;
  title: string;
  href: string;
  description: string;
  image?: {
    src: string;
    alt: string;
  };
};

type SiteServices = Pick<
  SiteConfig,
  'services' | 'commercialServices' | 'primaryCity' | 'niche' | 'homepageServicesLimit'
>;

function norm(s: string) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

function byOrder<T extends ServiceEntryLike>(a: T, b: T) {
  return (a.data.order ?? 99) - (b.data.order ?? 99);
}

function nameSet(names: string[] | undefined): Set<string> {
  return new Set((names || []).map(norm).filter(Boolean));
}

/**
 * Keep non-draft entries whose serviceName is in the given name list.
 * Preserves list order when matching by name; falls back to MD order when filtering only.
 */
export function filterServicesByNames<T extends ServiceEntryLike>(
  entries: T[],
  names: string[] | undefined,
): T[] {
  const allowed = nameSet(names);
  const live = (entries || []).filter((e) => !e.data.draft);
  if (!allowed.size) return [];
  const byName = new Map(live.map((e) => [norm(e.data.serviceName), e]));
  const ordered: T[] = [];
  for (const name of names || []) {
    const hit = byName.get(norm(name));
    if (hit) ordered.push(hit);
  }
  return ordered.length ? ordered : live.filter((e) => allowed.has(norm(e.data.serviceName))).sort(byOrder);
}

/** Residential services only (site.services). */
export function filterServicesForSite<T extends ServiceEntryLike>(
  entries: T[],
  site: SiteServices,
): T[] {
  return filterServicesByNames(entries, site.services);
}

function cardsFromNames(
  entries: ServiceEntryLike[],
  names: string[] | undefined,
  site: SiteServices,
  limit?: number,
): ServiceCard[] {
  const list = names || [];
  const cap = limit != null ? limit : list.length;
  const sliceNames = list.slice(0, cap);
  if (!sliceNames.length) return [];

  const filtered = filterServicesByNames(entries, sliceNames);
  if (filtered.length) {
    const byName = new Map(filtered.map((e) => [norm(e.data.serviceName), e]));
    return sliceNames.map((name) => {
      const e = byName.get(norm(name));
      if (e) {
        return {
          id: e.id,
          title: e.data.serviceName,
          href: `/services/${e.id}`,
          description: e.data.description || `${e.data.serviceName} serving ${site.primaryCity}.`,
          image: e.data.cardImage,
        };
      }
      const city = String(site.primaryCity || '').trim() || 'your area';
      return {
        title: name,
        href: '/contact',
        description: `${name} serving ${city} and nearby cities.`,
      };
    });
  }

  const city = String(site.primaryCity || '').trim() || 'your area';
  return sliceNames.map((name) => ({
    title: name,
    href: '/contact',
    description: `${name} serving ${city} and nearby cities.`,
  }));
}

/** Fallback cards from site.services when no matching service Markdown exists. */
export function serviceCardsFromSite(site: SiteServices, limit?: number): ServiceCard[] {
  return cardsFromNames([], site.services, site, limit);
}

/**
 * Residential service cards for homepage: filtered MD pages, or site-config fallback.
 */
export function serviceCardsForSite<T extends ServiceEntryLike>(
  entries: T[],
  site: SiteServices,
  limit?: number,
): ServiceCard[] {
  const cap = limit ?? homepageServicesDisplayLimit(site as SiteConfig);
  return cardsFromNames(entries, site.services, site, cap);
}

/** Commercial service cards (site.commercialServices). */
export function commercialServiceCardsForSite<T extends ServiceEntryLike>(
  entries: T[],
  site: SiteServices,
  limit?: number,
): ServiceCard[] {
  const names = site.commercialServices;
  if (!names?.length) return [];
  const cap = limit ?? homepageServicesDisplayLimit(site as SiteConfig);
  return cardsFromNames(entries, names, site, cap);
}

/** All configured service names (residential + commercial) for prune/seed. */
export function allConfiguredServiceNames(site: SiteServices): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...(site.services || []), ...(site.commercialServices || [])]) {
    const key = norm(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(name).trim());
  }
  return out;
}
