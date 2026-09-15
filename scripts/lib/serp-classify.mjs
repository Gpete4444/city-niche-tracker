/**
 * Shared Google organic SERP fetch + local-pack / organic classification.
 * Used by Stage 1 research and Discovery DFS SERP probe.
 */

import {
  dataForSeoRequest,
  isDirectoryDomain,
  isHomepageUrl,
  registrableDomain,
  serpLocationPayload,
  taskResult,
} from './dataforseo.mjs';

export function classifySerpItems(items = []) {
  const localPack = [];
  const directories = [];
  const organicHomePages = [];
  const organicSubPages = [];
  const paidAds = [];
  const seenHome = new Set();
  const seenSub = new Set();
  const seenDir = new Set();
  const seenPaid = new Set();

  for (const item of items) {
    if (item.type === 'local_pack') {
      const url = item.url ?? null;
      localPack.push({
        title: item.title ?? null,
        url,
        domain: item.domain ? registrableDomain(item.domain) : null,
        rating: item.rating?.value ?? item.rating ?? null,
        reviewsCount: item.rating?.votes_count ?? item.reviews_count ?? null,
        hasWebsite: Boolean(url),
      });
      continue;
    }

    if (item.type === 'paid' || item.type === 'shopping' || item.type === 'paid_list') {
      const domain = item.domain
        ? registrableDomain(item.domain)
        : item.url
          ? registrableDomain(item.url)
          : null;
      const key = `${domain}|${item.url ?? item.title ?? ''}`;
      if (domain && !seenPaid.has(key)) {
        seenPaid.add(key);
        paidAds.push({
          title: item.title ?? null,
          url: item.url ?? null,
          domain,
        });
      }
      continue;
    }

    if (item.type !== 'organic' || !item.url) continue;

    const domain = registrableDomain(item.domain || item.url);
    const entry = {
      title: item.title ?? null,
      url: item.url,
      domain,
      rankAbsolute: item.rank_absolute ?? null,
    };

    if (isDirectoryDomain(domain)) {
      if (!seenDir.has(domain)) {
        seenDir.add(domain);
        directories.push(entry);
      }
      continue;
    }

    if (isHomepageUrl(item.url)) {
      if (!seenHome.has(domain)) {
        seenHome.add(domain);
        organicHomePages.push(entry);
      }
    } else if (!seenSub.has(`${domain}|${item.url}`)) {
      seenSub.add(`${domain}|${item.url}`);
      organicSubPages.push(entry);
    }
  }

  const organicDomains = new Set([
    ...organicHomePages.map((x) => x.domain),
    ...organicSubPages.map((x) => x.domain),
  ]);

  const mapPackWebsiteCount = localPack.filter((b) => b.hasWebsite).length;
  const mapPackSlotCount = localPack.length;

  return {
    mapPackPresent: localPack.length > 0,
    localPack,
    mapPackSlotCount,
    mapPackWebsiteCount,
    mapPackNoWebsiteCount: mapPackSlotCount - mapPackWebsiteCount,
    directories: { count: directories.length, links: directories },
    organicHomePages: { count: organicHomePages.length, links: organicHomePages },
    organicSubPages: { count: organicSubPages.length, links: organicSubPages },
    uniqueOrganicDomains: [...organicDomains],
    paidAds: { count: paidAds.length, links: paidAds },
  };
}

/**
 * POST body for Google organic SERP. `locationSpec` is a name string or
 * `{ location_name } | { location_code } | { location_coordinate }`.
 */
export function organicSerpTaskBody(keyword, locationSpec, extra = {}) {
  return {
    keyword,
    ...serpLocationPayload(locationSpec),
    language_code: 'en',
    device: extra.device || 'desktop',
    depth: extra.depth ?? 10,
  };
}

/**
 * Live Google organic SERP (depth 10). ~$0.002 typical live cost.
 * @returns {Promise<{ cost: number, checkUrl: string|null, itemTypes: any[], items: any[], endpoint: string }>}
 */
export async function fetchOrganicSerp(keyword, locationSpec) {
  const tryEndpoints = [
    '/serp/google/organic/live/advanced',
    '/serp/google/organic/live/regular',
  ];

  let lastError;
  for (const endpoint of tryEndpoints) {
    try {
      const json = await dataForSeoRequest(
        endpoint,
        organicSerpTaskBody(keyword, locationSpec),
        { retries: 4, label: endpoint },
      );
      const { result, cost } = taskResult(json, 'serp');
      const page = result[0] ?? {};
      return {
        cost,
        checkUrl: page.check_url ?? null,
        itemTypes: page.item_types ?? [],
        items: page.items ?? [],
        endpoint,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function linkListToCell(links = []) {
  return (links || [])
    .map((l) => (typeof l === 'string' ? l : l?.url))
    .filter(Boolean)
    .join('\n');
}
