/**
 * Section band surfaces — strict A/B alternation for light sections.
 * Brand / ink bands are reserved for Areas and final CTA.
 */

export const SURFACE_A = 'section-surface-raised';
export const SURFACE_B = 'section-surface-muted';
export const SURFACE_BRAND = 'section-surface-brand';
export const SURFACE_INK = 'section-surface-ink';

/** Even index → A (white), odd → B (muted contrast). */
export function bandSurface(index: number): string {
  return index % 2 === 0 ? SURFACE_A : SURFACE_B;
}

/**
 * Canonical homepage Structure / render order (astroKeys + prose ids).
 * Keep in sync with index.astro + HomeSections.astro + Structure registry order.
 */
export const HOMEPAGE_SECTION_ORDER = [
  'hero',
  'trust',
  'intro',
  'services',
  'whyChooseUs',
  'process',
  'offerProcess',
  'cost',
  'materials',
  'timeline',
  'codes',
  'diyVsPro',
  'whenToCall',
  'areas',
  'gallery',
  'beforeAfter',
  'reviews',
  'faqs',
  'cta',
] as const;

export type HomepageSectionId = (typeof HOMEPAGE_SECTION_ORDER)[number];

export function sortHomepageSectionIds(ids: string[]): string[] {
  const rank = new Map(HOMEPAGE_SECTION_ORDER.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => {
    const ra = rank.has(a) ? (rank.get(a) as number) : 900;
    const rb = rank.has(b) ? (rank.get(b) as number) : 900;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}
