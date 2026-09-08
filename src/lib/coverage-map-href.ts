import { locationPath, sitePath } from './site-path';

export type CoverageMapLocationPage = {
  id?: string;
  city?: string;
};

export function slugifyAreaName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Coverage-map city → real location page, or /contact/ when no page exists.
 * Never invent `/locations/{slug}/` for coverage-only towns.
 */
export function coverageMapAreaHref(
  cityRaw: string,
  locationPages: Array<string | CoverageMapLocationPage> = [],
): string {
  const slug = slugifyAreaName(cityRaw);
  if (!slug) return sitePath('/');
  for (const p of locationPages || []) {
    const id = typeof p === 'string' ? p : String(p?.id || '').trim();
    const city = typeof p === 'string' ? '' : String(p?.city || '').trim();
    if (!id && !city) continue;
    if (slugifyAreaName(id) === slug || slugifyAreaName(city) === slug) {
      return locationPath(id || slug);
    }
  }
  return sitePath('/contact');
}
