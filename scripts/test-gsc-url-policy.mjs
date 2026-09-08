/**
 * URL policy + coverage-map hrefs (no invented location pages).
 * Run: node scripts/test-gsc-url-policy.mjs
 */

function sitePath(path = '/') {
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

function servicePath(id) {
  return sitePath(`/services/${String(id || '').trim()}`);
}

function locationPath(id) {
  return sitePath(`/locations/${String(id || '').trim()}`);
}

function slugifyAreaName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function coverageMapAreaHref(cityRaw, locationPages = []) {
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

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

function assert(ok, label) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
}

assertEqual(sitePath('/'), '/', 'home');
assertEqual(sitePath('/about'), '/about/', 'about slash');
assertEqual(sitePath('/about/'), '/about/', 'about already slashed');
assertEqual(sitePath('/contact#lead-form'), '/contact/#lead-form', 'hash kept');
assertEqual(sitePath('mailto:leads@example.com'), 'mailto:leads@example.com', 'mailto');
assertEqual(servicePath('drywall-repair'), '/services/drywall-repair/', 'service path');
assertEqual(locationPath('mill-creek'), '/locations/mill-creek/', 'location path');
assertEqual(slugifyAreaName('Mill Creek'), 'mill-creek', 'slugify');

const pages = [
  { id: 'everett', city: 'Everett' },
  { id: 'mill-creek', city: 'Mill Creek' },
];
assertEqual(coverageMapAreaHref('Everett', pages), '/locations/everett/', 'map primary');
assertEqual(coverageMapAreaHref('Mill Creek', pages), '/locations/mill-creek/', 'map suburb');
assertEqual(coverageMapAreaHref('Mukilteo', pages), '/contact/', 'coverage-only → contact');
assertEqual(coverageMapAreaHref('mill-creek', pages), '/locations/mill-creek/', 'slug as city');

assert(true, 'coverage-map href policy');
console.log('test-gsc-url-policy: ok');
