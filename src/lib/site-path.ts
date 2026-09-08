/**
 * Site-relative paths with a trailing slash (Astro `trailingSlash: 'always'`).
 * Home is `/`. Hash, query, mailto, tel, and absolute URLs are left intact.
 */
export function sitePath(path = '/'): string {
  const raw = String(path ?? '').trim();
  if (!raw) return '/';
  if (/^(#|mailto:|tel:|https?:|javascript:)/i.test(raw)) return raw;
  const hashIdx = raw.indexOf('#');
  const qIdx = raw.indexOf('?');
  let cut = raw.length;
  if (hashIdx >= 0) cut = Math.min(cut, hashIdx);
  if (qIdx >= 0) cut = Math.min(cut, qIdx);
  const pathname = raw.slice(0, cut);
  const suffix = raw.slice(cut);
  let p = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (p !== '/' && !p.endsWith('/')) p += '/';
  return `${p}${suffix}`;
}

export function servicePath(id: string): string {
  return sitePath(`/services/${String(id || '').trim()}`);
}

export function locationPath(id: string): string {
  return sitePath(`/locations/${String(id || '').trim()}`);
}
