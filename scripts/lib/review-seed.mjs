/**
 * Google-style socialProof review seed (exactly 3 cards).
 * Used by Rover site-config paste / Accept / Load.
 */

const MALE_FIRST = [
  'James', 'Michael', 'David', 'John', 'Robert', 'William', 'Richard', 'Thomas',
  'Daniel', 'Matthew', 'Anthony', 'Mark', 'Steven', 'Paul', 'Andrew', 'Joshua',
  'Kevin', 'Brian', 'Ryan', 'Jason', 'Justin', 'Brandon', 'Eric', 'Nathan',
];

const FEMALE_FIRST = [
  'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Jessica',
  'Sarah', 'Karen', 'Nancy', 'Lisa', 'Betty', 'Margaret', 'Sandra', 'Ashley',
  'Emily', 'Donna', 'Michelle', 'Dorothy', 'Carol', 'Amanda', 'Melissa', 'Deborah',
];

const LAST_INITIALS = 'ABCDEFGHJKLMNPRSTVW'.split('');

/** Bundled photoreal avatar paths (gendered). */
export const MALE_AVATARS = [
  '/images/review-avatars/m01.jpg',
  '/images/review-avatars/m02.jpg',
  '/images/review-avatars/m03.jpg',
  '/images/review-avatars/m04.jpg',
];

export const FEMALE_AVATARS = [
  '/images/review-avatars/f01.jpg',
  '/images/review-avatars/f02.jpg',
  '/images/review-avatars/f03.jpg',
  '/images/review-avatars/f04.jpg',
];

function hashStr(s) {
  let h = 2166136261;
  const str = String(s || '');
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}

function shuffle(rand, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Stagger: past week / past two weeks / past month (one each). */
function staggeredDates(rand) {
  const week = 2 + Math.floor(rand() * 5); // 2–6
  const twoWeeks = 8 + Math.floor(rand() * 7); // 8–14
  const month = 20 + Math.floor(rand() * 11); // 20–30
  return shuffle(rand, [week, twoWeeks, month]).map(isoDaysAgo);
}

function nicheKeywords(niche = '', services = []) {
  const bits = [];
  const n = String(niche || '').trim();
  if (n) bits.push(n.toLowerCase());
  for (const s of services || []) {
    const name = typeof s === 'string' ? s : s?.name || s?.title || '';
    const t = String(name || '').trim().toLowerCase();
    if (t && !bits.includes(t)) bits.push(t);
    if (bits.length >= 6) break;
  }
  if (!bits.length) bits.push('service', 'project', 'work');
  return bits;
}

/**
 * Top 3 SEO locations for review cards: primaryCity, then targetSuburbs, pad from coverageAreas.
 * @param {{ primaryCity?: string, state?: string, targetSuburbs?: any[], coverageAreas?: any[] }} config
 * @returns {string[]} up to 3 "City, ST" labels
 */
export function topReviewLocations(config = {}) {
  const state = String(config.state || '').trim();
  const out = [];
  const seen = new Set();

  const pushCity = (cityRaw) => {
    const city = String(cityRaw || '').trim();
    if (!city) return;
    const key = city.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(state ? `${city}, ${state}` : city);
  };

  pushCity(config.primaryCity);
  for (const s of config.targetSuburbs || []) {
    if (out.length >= 3) break;
    pushCity(typeof s === 'string' ? s : s?.name || s?.city || '');
  }
  for (const a of config.coverageAreas || []) {
    if (out.length >= 3) break;
    pushCity(typeof a === 'string' ? a : a?.name || a?.city || '');
  }
  while (out.length < 3 && out[0]) out.push(out[0]);
  return out.slice(0, 3);
}

function buildQuotes({ businessName, city, keywords, rand }) {
  const brand = String(businessName || '').trim() || 'the team';
  const place = String(city || '').trim();
  const kw = shuffle(rand, [...keywords]);
  const k0 = kw[0] || 'the work';
  const k1 = kw[1] || kw[0] || 'the project';
  const k2 = kw[2] || kw[0] || 'the job';

  const professional = `Honestly did not expect such a professional team. They showed up on time, explained every step, and the ${k0} turned out better than I pictured.`;

  const withBrand = place
    ? `Called ${brand} after a neighbor tip in ${place}. Super easy to deal with — clear answers, no runaround, and they actually cared about the details on our ${k1}.`
    : `Called ${brand} after a friend recommended them. Super easy to deal with — clear answers, no runaround, and they actually cared about the details on our ${k1}.`;

  const affordable = `Price was way more affordable than the other quotes we got for ${k2}. Still felt premium — clean jobsite, solid finish, and I'd hire them again without thinking twice.`;

  const trio = [
    { quote: professional, cue: 'pro' },
    { quote: withBrand, cue: 'brand' },
    { quote: affordable, cue: 'price' },
  ];
  return shuffle(rand, trio).map((t) => t.quote);
}

function pickPeople(rand, seedKey) {
  const g0 = pick(rand, ['male', 'female']);
  const g1 = g0 === 'male' ? 'female' : 'male';
  const g2 = pick(rand, ['male', 'female']);
  const order = shuffle(rand, [g0, g1, g2]);

  const usedFirst = new Set();
  const people = [];
  const maleAv = shuffle(rand, [...MALE_AVATARS]);
  const femaleAv = shuffle(rand, [...FEMALE_AVATARS]);
  let mi = hashStr(seedKey) % maleAv.length;
  let fi = hashStr(`${seedKey}:f`) % femaleAv.length;

  for (const gender of order) {
    const pool = gender === 'male' ? MALE_FIRST : FEMALE_FIRST;
    let first = pick(rand, pool);
    let guard = 0;
    while (usedFirst.has(first) && guard < 20) {
      first = pick(rand, pool);
      guard += 1;
    }
    usedFirst.add(first);
    const last = pick(rand, LAST_INITIALS);
    const author = `${first} ${last}.`;
    let avatarUrl;
    if (gender === 'male') {
      avatarUrl = maleAv[mi % maleAv.length];
      mi += 1;
    } else {
      avatarUrl = femaleAv[fi % femaleAv.length];
      fi += 1;
    }
    people.push({ gender, author, first, last, avatarUrl });
  }

  return people;
}

/** First L. author pattern used by Rover seed (e.g. "Dorothy P."). */
function looksLikeSeedAuthor(author) {
  return /^[A-Z][a-z]+ [A-Z]\.$/.test(String(author || '').trim());
}

function isRoverSeedReview(r) {
  if (!r || typeof r !== 'object') return false;
  if (!looksLikeSeedAuthor(r.author || r.name)) return false;
  if (Number(r.rating) !== 5) return false;
  const src = String(r.source || 'Google');
  if (!/google/i.test(src)) return false;
  return true;
}

function avatarNeedsUpgrade(avatarUrl) {
  const u = String(avatarUrl || '').trim();
  if (!u) return true;
  return /\.svg(\?|$)/i.test(u);
}

/**
 * Build Google-style socialProof object.
 * @param {string} city
 * @param {string} state
 * @param {{ businessName?: string, niche?: string, services?: any[], seedKey?: string, targetSuburbs?: any[], coverageAreas?: any[], primaryCity?: string }} [opts]
 */
export function buildGoogleStyleSocialProof(city = 'Local', state = '', opts = {}) {
  const businessName = String(opts.businessName || '').trim();
  const niche = String(opts.niche || '').trim();
  const services = Array.isArray(opts.services) ? opts.services : [];
  const seedKey = String(opts.seedKey || `${businessName}|${city}|${state}|${niche}`);
  const rand = mulberry32(hashStr(seedKey) || 1);

  const keywords = nicheKeywords(niche, services);
  const dates = staggeredDates(rand);
  const people = pickPeople(rand, seedKey);
  const quotes = buildQuotes({
    businessName: businessName || 'the company',
    city,
    keywords,
    rand,
  });

  const locations = topReviewLocations({
    primaryCity: opts.primaryCity || city,
    state,
    targetSuburbs: opts.targetSuburbs,
    coverageAreas: opts.coverageAreas,
  });

  const reviews = people.map((p, i) => {
    const row = {
      quote: quotes[i],
      author: p.author,
      rating: 5,
      source: 'Google',
      date: dates[i],
      verified: true,
      avatarUrl: p.avatarUrl,
    };
    if (locations[i]) row.location = locations[i];
    return row;
  });

  return {
    rating: {
      value: 4.9,
      reviewCount: 47,
      source: 'Google',
      url: '',
    },
    licenses: [
      {
        name: 'Licensed & Insured',
        ...(state ? { jurisdiction: String(state).toUpperCase() } : {}),
      },
    ],
    statistics: [
      { value: '15+', label: 'Years local experience' },
      { value: '500+', label: 'Projects completed' },
      { value: '4.9★', label: 'Average customer rating' },
    ],
    reviews,
  };
}

const PLACEHOLDER_AUTHORS = new Set(['local homeowner', 'neighborhood customer', 'repeat client']);

/**
 * True when socialProof is missing, empty, placeholder, or an outdated Rover seed pack
 * (SVG/missing avatars or incomplete locations).
 */
export function socialProofNeedsSeed(config = {}) {
  const proof = config?.socialProof;
  if (!proof || typeof proof !== 'object') return true;
  const reviews = Array.isArray(proof.reviews) ? proof.reviews : [];
  if (!reviews.length) return true;
  if (
    reviews.every((r) =>
      PLACEHOLDER_AUTHORS.has(String(r.author || r.name || '').toLowerCase().trim()),
    )
  ) {
    return true;
  }
  // Upgrade outdated Rover-seeded packs only (do not wipe operator-edited reviews).
  if (reviews.length === 3 && reviews.every(isRoverSeedReview)) {
    if (reviews.some((r) => avatarNeedsUpgrade(r.avatarUrl))) return true;
    if (reviews.some((r) => !String(r.location || '').trim())) return true;
  }
  return false;
}

/**
 * Replace empty/placeholder/outdated socialProof on a site-config object (mutates + returns).
 */
export function applyGoogleStyleSocialProofIfNeeded(config = {}) {
  if (!config || typeof config !== 'object') return { config, seeded: false };
  if (!socialProofNeedsSeed(config)) {
    return { config, seeded: false, reviewCount: config.socialProof?.reviews?.length || 0 };
  }
  const city = config.primaryCity || 'Local';
  const state = config.state || '';
  const socialProof = buildGoogleStyleSocialProof(city, state, {
    businessName: config.businessName,
    niche: config.niche,
    services: config.services,
    seedKey: config.domain || config.businessName || `${city}|${state}`,
    primaryCity: config.primaryCity || city,
    targetSuburbs: config.targetSuburbs,
    coverageAreas: config.coverageAreas,
  });
  config.socialProof = socialProof;
  return { config, seeded: true, reviewCount: socialProof.reviews.length };
}
