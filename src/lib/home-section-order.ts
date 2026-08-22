/** Default homepage body order when site.homepageSections is unset (matches registry). */
export const DEFAULT_HOME_SECTION_ORDER = [
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
  'reviews',
  'faqs',
  'cta',
] as const;

const PROSE_KEYS = new Set(['cost', 'materials', 'timeline', 'codes', 'diyVsPro', 'whenToCall']);

/** Keys rendered inside HomeSections (not hero / trust / intro / services). */
export const HOME_SECTIONS_BODY_KEYS = new Set([
  'whyChooseUs',
  'process',
  'offerProcess',
  ...PROSE_KEYS,
  'areas',
  'gallery',
  'reviews',
  'faqs',
  'cta',
]);

export function isProseHomeKey(key: string): boolean {
  return PROSE_KEYS.has(key);
}

/** Ordered astro keys for the homepage (hero excluded from return). */
export function orderedHomeSectionKeys(homepageSections: string[] | null | undefined): string[] {
  const raw =
    Array.isArray(homepageSections) && homepageSections.length
      ? homepageSections
      : [...DEFAULT_HOME_SECTION_ORDER];
  const mid = raw.filter((k) => k && k !== 'hero');
  const withoutCta = mid.filter((k) => k !== 'cta');
  const out = [...withoutCta];
  if (mid.includes('cta') || (!homepageSections?.length && DEFAULT_HOME_SECTION_ORDER.includes('cta'))) {
    if (!out.includes('cta')) out.push('cta');
  }
  return out;
}
