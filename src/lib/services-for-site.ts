import type { SiteConfig } from '../config/site';
import { homepageServicesDisplayLimit } from '../config/site';
import { servicePath, sitePath } from './site-path';

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
    heroImage?: {
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

/** Prefer cardImage; fall back to hero when card art is missing (avoids empty chrome). */
function pickServiceCardImage(e: ServiceEntryLike): ServiceCard['image'] | undefined {
  const card = e.data.cardImage;
  if (card?.src) return card;
  const hero = e.data.heroImage;
  if (hero?.src) return hero;
  return undefined;
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
  cityOverride?: string,
): ServiceCard[] {
  const list = names || [];
  const cap = limit != null ? limit : list.length;
  const sliceNames = list.slice(0, cap);
  if (!sliceNames.length) return [];
  const city =
    String(cityOverride || site.primaryCity || '')
      .trim() || 'your area';

  const filtered = filterServicesByNames(entries, sliceNames);
  if (filtered.length) {
    const byName = new Map(filtered.map((e) => [norm(e.data.serviceName), e]));
    return sliceNames.map((name) => {
      const e = byName.get(norm(name));
      if (e) {
        return {
          id: e.id,
          title: e.data.serviceName,
          href: servicePath(e.id),
          description: cityOverride
            ? `${e.data.serviceName} serving ${city} and nearby cities.`
            : e.data.description || `${e.data.serviceName} serving ${city}.`,
          image: pickServiceCardImage(e),
        };
      }
      return {
        title: name,
        href: sitePath('/contact'),
        description: `${name} serving ${city} and nearby cities.`,
      };
    });
  }

  return sliceNames.map((name) => ({
    title: name,
    href: sitePath('/contact'),
    description: `${name} serving ${city} and nearby cities.`,
  }));
}

/** Fallback cards from site.services when no matching service Markdown exists. */
export function serviceCardsFromSite(
  site: SiteServices,
  limit?: number,
  cityOverride?: string,
): ServiceCard[] {
  return cardsFromNames([], site.services, site, limit, cityOverride);
}

/**
 * Residential service cards for homepage: filtered MD pages, or site-config fallback.
 */
export function serviceCardsForSite<T extends ServiceEntryLike>(
  entries: T[],
  site: SiteServices,
  limit?: number,
  cityOverride?: string,
): ServiceCard[] {
  const cap = limit ?? homepageServicesDisplayLimit(site as SiteConfig);
  return cardsFromNames(entries, site.services, site, cap, cityOverride);
}

/** Commercial service cards (site.commercialServices). */
export function commercialServiceCardsForSite<T extends ServiceEntryLike>(
  entries: T[],
  site: SiteServices,
  limit?: number,
  cityOverride?: string,
): ServiceCard[] {
  const names = site.commercialServices;
  if (!names?.length) return [];
  const cap = limit ?? homepageServicesDisplayLimit(site as SiteConfig);
  return cardsFromNames(entries, names, site, cap, cityOverride);
}

/** Attach homepage serviceCardImages to cards missing card/hero art (by display order). */
export function applyServiceCardImages<T extends ServiceCard>(
  cards: T[],
  images: Array<{ src?: string; alt?: string } | null | undefined> | null | undefined,
  startIndex = 0,
): { cards: T[]; nextIndex: number } {
  const list = Array.isArray(images) ? images : [];
  let i = startIndex;
  const out = cards.map((card) => {
    const img = list[i];
    i += 1;
    if (card.image?.src) return card;
    const src = String(img?.src || '').trim();
    if (!src) return card;
    return {
      ...card,
      image: {
        src,
        alt: String(img?.alt || card.title || 'Service').trim() || card.title,
      },
    };
  });
  return { cards: out, nextIndex: i };
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
