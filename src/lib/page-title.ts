/**
 * Document <title> resolution — keep SERP titles ≤ ~60 chars when possible.
 */

export function normalizeBrandKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(pros|llc|inc|co|company|services|service)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function namesRoughlyEqual(a: string, b: string): boolean {
  const na = normalizeBrandKey(a);
  const nb = normalizeBrandKey(b);
  return Boolean(na && na === nb);
}

/** True if title already carries the brand (exact or token-normalized). */
export function titleContainsBrand(title: string, businessName: string): boolean {
  const t = String(title || '');
  const brand = String(businessName || '').trim();
  if (!brand) return false;
  if (t.includes(brand)) return true;
  const tn = normalizeBrandKey(t);
  const bn = normalizeBrandKey(brand);
  return Boolean(bn && tn.includes(bn));
}

/**
 * Match BaseLayout / SEO lint: append `| brand` only when missing and under maxLen.
 */
export function resolvePageTitle(
  title: string,
  businessName: string,
  maxLen = 60,
): string {
  const t = String(title || '').trim();
  const brand = String(businessName || '').trim();
  if (!t) return brand;
  if (!brand || titleContainsBrand(t, brand)) return t;
  const withBrand = `${t} | ${brand}`;
  if (withBrand.length <= maxLen) return withBrand;
  return t;
}
