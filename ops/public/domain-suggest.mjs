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

/** Lowercase niche name used as the pattern-file key. */
export function nichePatternKey(niche) {
  return String(niche || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Turn a typed template into the stored pattern.
 * `[City]` is required. Missing `.com` is added. Any other ending is rejected.
 * Letters and digits around `[City]` are kept; spaces and hyphens are folded in.
 */
export function normalizeNicheDomainPattern(raw) {
  let s = String(raw || '').trim();
  if (!s) return { ok: false, error: 'Enter a pattern such as [City]SewerPros.com.' };
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  s = s.split('/')[0].split('?')[0].split('#')[0].trim().replace(/\.$/, '');
  if (!/\[city\]/i.test(s)) {
    return { ok: false, error: 'Include [City] so each city gets its own host.' };
  }
  const dot = s.lastIndexOf('.');
  let label = s;
  if (dot >= 0) {
    const tld = s.slice(dot + 1);
    if (!/^com$/i.test(tld)) return { ok: false, error: 'Niche patterns use .com.' };
    label = s.slice(0, dot);
    if (label.includes('.')) {
      return { ok: false, error: 'Use one host, like [City]SewerPros.com.' };
    }
  }
  const pieces = label.split(/\[city\]/i);
  let shaped = '';
  let hasName = false;
  for (let i = 0; i < pieces.length; i += 1) {
    if (i > 0) shaped += '[City]';
    const chunk = pieces[i];
    if (!chunk) continue;
    if (/^[a-z0-9]+$/i.test(chunk)) {
      shaped += chunk;
      hasName = true;
      continue;
    }
    const token = chunk.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!token) {
      return { ok: false, error: 'Use letters and digits around [City], then .com.' };
    }
    shaped += token;
    hasName = true;
  }
  if (!hasName) {
    return { ok: false, error: 'Add a name around [City], such as [City]SewerPros.com.' };
  }
  const pattern = `${shaped}.com`;
  return { ok: true, pattern, key: pattern.toLowerCase() };
}

/** Expand `[City]` with the same city slug Exact Match uses. Empty when the pattern or city is unusable. */
export function expandNicheDomainPattern(pattern, city) {
  const norm = normalizeNicheDomainPattern(pattern);
  const citySlug = domainToken(city);
  if (!norm.ok || !citySlug) return '';
  const host = norm.pattern.replace(/\[City\]/g, citySlug).toLowerCase();
  if (!/^[a-z0-9]+\.com$/.test(host)) return '';
  return host;
}

function suggestionHost(domain) {
  return String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
}

/**
 * Put saved niche hosts first. An expanded host already in the list is not duplicated.
 * @param {Array<{domain:string, available?: boolean|null, note?: string|null}>} suggestions
 * @param {string[]} patterns
 * @param {string} city
 */
export function mergeNicheDomainSuggestions(suggestions, patterns, city) {
  const patternList = Array.isArray(patterns) ? patterns : [];
  const active = new Set();
  for (const pattern of patternList) {
    const host = expandNicheDomainPattern(pattern, city);
    if (host) active.add(host);
  }
  const existing = (Array.isArray(suggestions) ? suggestions : []).filter((row) => {
    if (row?.note !== 'saved for this niche') return true;
    return active.has(suggestionHost(row?.domain));
  });
  const byHost = new Map();
  for (const row of existing) {
    const host = suggestionHost(row?.domain);
    if (!host || byHost.has(host)) continue;
    byHost.set(host, row);
  }
  const saved = [];
  const seen = new Set();
  for (const pattern of patternList) {
    const host = expandNicheDomainPattern(pattern, city);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    const prev = byHost.get(host);
    saved.push({
      domain: host,
      available: prev && (prev.available === true || prev.available === false) ? prev.available : null,
      note: 'saved for this niche',
    });
  }
  const rest = [];
  for (const row of existing) {
    const host = suggestionHost(row?.domain);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    rest.push(row);
  }
  return [...saved, ...rest];
}
