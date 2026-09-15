/**
 * City-first Exact Match domain ideas (no Claude / WHOIS).
 * Hostname = lowercase letters+digits only, primary city first, .com.
 */

/** Lowercase a–z0–9 slug (drops spaces, hyphens, punctuation). */
export function domainToken(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Trailing intent words stripped from the niche slug (longest first). */
const HEAD_STRIP = [
  'installations',
  'installation',
  'replacements',
  'replacement',
  'contractors',
  'contractor',
  'restorations',
  'restoration',
  'encapsulations',
  'encapsulation',
  'cleanings',
  'cleaning',
  'repairs',
  'repair',
  'services',
  'service',
  'lining',
  'install',
];

/** Niche without a trailing repair/install/service word — e.g. drywallrepair → drywall. */
export function nicheHeadToken(niche) {
  const slug = domainToken(niche);
  if (!slug) return '';
  for (const suf of HEAD_STRIP) {
    if (slug.length > suf.length && slug.endsWith(suf)) return slug.slice(0, -suf.length);
  }
  return slug;
}

/**
 * Up to 10 Exact Match hosts. Skip duplicates (e.g. niche already ends in installation).
 * @returns {{ domain: string, available: null, note: string }[]}
 */
export function suggestExactMatchDomains({ city, niche } = {}) {
  const citySlug = domainToken(city);
  const nicheSlug = domainToken(niche);
  if (!citySlug || !nicheSlug) return [];
  const head = nicheHeadToken(niche) || nicheSlug;

  const patterns = [
    { rest: nicheSlug, note: 'exact niche+primary city' },
    {
      rest: nicheSlug.endsWith('s') ? '' : `${nicheSlug}s`,
      note: 'plural exact match variant',
    },
    { rest: `${nicheSlug}service`, note: 'niche+service keyword' },
    { rest: `${head}patch`, note: 'high-intent repair variant' },
    { rest: `${head}installation`, note: 'close niche variant, installation intent' },
    { rest: `${head}contractor`, note: `${head} contractor search variant` },
    { rest: `${head}fix`, note: 'short repair-intent variant' },
    { rest: `${nicheSlug}pros`, note: 'city-first + pros suffix' },
    { rest: `${head}experts`, note: 'city-first + experts suffix' },
    { rest: `${head}solutions`, note: 'city-first + solutions suffix' },
  ];

  const seen = new Set();
  const out = [];
  for (const p of patterns) {
    const rest = String(p.rest || '');
    if (!rest) continue;
    const host = `${citySlug}${rest}.com`;
    if (!host.startsWith(citySlug) || seen.has(host)) continue;
    seen.add(host);
    out.push({ domain: host, available: null, note: p.note });
  }
  return out;
}
