import { z } from 'astro/zod';
import rawConfig from './site-config.json';
import { sitePath } from '../lib/site-path';
import { publicImageAlt } from '../lib/image-alt.mjs';

const addressSchema = z.object({
  street: z.string().min(1),
  suite: z.string().min(1).optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
});

function peelSuiteFromCity(city: string, suite: string): { city: string; suite: string } {
  const m = String(city || '').match(/^((?:ste|suite|unit)\.?\s+[a-z0-9-]+)\s+(.+)$/i);
  if (!m) return { city, suite };
  const id = m[1].replace(/^(?:ste|suite|unit)\.?\s+/i, '');
  return { city: String(m[2] || '').trim(), suite: suite || (id ? `Ste ${id}` : '') };
}

/** Empty / partial address objects (common after optional NAP fields) → omit. */
function preprocessAddress(value: unknown): unknown {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const o = value as Record<string, unknown>;
  const street = String(o.street ?? '').trim();
  const peeled = peelSuiteFromCity(String(o.city ?? '').trim(), String(o.suite ?? '').trim());
  const city = peeled.city;
  const suite = peeled.suite;
  const state = String(o.state ?? '').trim();
  const zip = String(o.zip ?? '').trim();
  if (!street || !city || !state || !zip) return undefined;
  return suite ? { street, suite, city, state, zip } : { street, city, state, zip };
}

/** Line 1 + Line 2 for footer/schema. Existing composed streets stay as-is. */
export function formatSiteStreet(address?: { street?: string; suite?: string } | null): string {
  const street = String(address?.street || '').trim();
  const suite = String(address?.suite || '').trim();
  if (!street) return '';
  if (!suite) return street;
  const escaped = suite.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`,\\s*${escaped}\\s*$`, 'i').test(street)) return street;
  return `${street}, ${suite}`;
}

const geoSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

const brandSchema = z.object({
  primary: z.string().regex(/^#([0-9A-Fa-f]{6})$/),
  accent: z.string().regex(/^#([0-9A-Fa-f]{6})$/),
  ink: z.string().regex(/^#([0-9A-Fa-f]{6})$/),
  /** Darker accent text on light bands. Omitted palettes use `accent`. */
  accentOnLight: z
    .string()
    .regex(/^#([0-9A-Fa-f]{6})$/)
    .optional(),
  paletteId: z.string().min(1).optional(),
  fontTheme: z.string().min(1).optional(),
});

const imageLikeSchema = z.object({
  src: z.string().min(1),
  alt: z.string().min(1),
});

const socialProofSchema = z.object({
  rating: z
    .object({
      value: z.number().min(1).max(5),
      reviewCount: z.number().int().nonnegative(),
      source: z.string().min(1),
      url: z.union([z.string().url(), z.literal('')]).optional(),
    })
    .optional(),
  licenses: z
    .array(
      z.object({
        name: z.string().min(1),
        number: z.string().min(1).optional(),
        jurisdiction: z.string().min(1).optional(),
      }),
    )
    .optional()
    .default([]),
  statistics: z
    .array(
      z.object({
        value: z.string().min(1),
        label: z.string().min(1),
      }),
    )
    .optional()
    .default([]),
  reviews: z
    .array(
      z.object({
        quote: z.string().min(1),
        author: z.string().min(1),
        location: z.string().min(1).optional(),
        rating: z.number().int().min(1).max(5).optional(),
        source: z.string().min(1).optional(),
        date: z.string().min(1).optional(),
        avatarUrl: z.string().optional(),
        verified: z.boolean().optional(),
      }),
    )
    .optional()
    .default([]),
});

export type SocialProof = z.infer<typeof socialProofSchema>;

/** Seed trust strip + reviews when a site config has no socialProof yet. */
export function defaultSeedSocialProof(
  city = 'Local',
  state = '',
  opts: {
    businessName?: string;
    niche?: string;
    services?: unknown[];
    seedKey?: string;
    primaryCity?: string;
    targetSuburbs?: unknown[];
    coverageAreas?: unknown[];
  } = {},
): SocialProof {
  const brand = String(opts.businessName || '').trim() || 'the team';
  const niche = String(opts.niche || 'the work').trim().toLowerCase() || 'the work';
  const primary = String(opts.primaryCity || city || 'Local').trim();
  const suburbs = Array.isArray(opts.targetSuburbs) ? opts.targetSuburbs : [];
  const areas = Array.isArray(opts.coverageAreas) ? opts.coverageAreas : [];
  const locList: string[] = [];
  const seen = new Set<string>();
  const push = (c: string) => {
    let name = String(c || '').trim();
    if (!name) return;
    name = name.replace(/,\s*([A-Za-z]{2})\s*,\s*\1\s*$/i, (_, st) => `, ${String(st).toUpperCase()}`);
    const st = String(state || '').trim();
    const already = st
      ? new RegExp(`,\\s*${st.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')
      : null;
    const label = st
      ? already && already.test(name)
        ? name.replace(already, `, ${st}`)
        : `${name}, ${st}`
      : name;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    locList.push(label);
  };
  push(primary);
  for (const s of suburbs) {
    if (locList.length >= 3) break;
    push(typeof s === 'string' ? s : String((s as { name?: string; city?: string })?.name || (s as { city?: string })?.city || ''));
  }
  for (const a of areas) {
    if (locList.length >= 3) break;
    push(typeof a === 'string' ? a : String((a as { name?: string; city?: string })?.name || (a as { city?: string })?.city || ''));
  }
  while (locList.length < 3 && locList[0]) locList.push(locList[0]);

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
        jurisdiction: state || undefined,
      },
    ],
    statistics: [
      { value: '15+', label: 'Years local experience' },
      { value: '500+', label: 'Projects completed' },
      { value: '4.9★', label: 'Average customer rating' },
    ],
    reviews: [
      {
        quote: `Honestly did not expect such a professional team. They showed up on time, explained every step, and the ${niche} turned out better than I pictured.`,
        author: 'David C.',
        rating: 5,
        source: 'Google',
        date: new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10),
        verified: true,
        avatarUrl: '/images/review-avatars/m01.jpg',
        location: locList[0],
      },
      {
        quote: `Called ${brand} after a neighbor tip in ${primary}. Super easy to deal with — clear answers, no runaround, and they actually cared about the details.`,
        author: 'Sarah M.',
        location: locList[1] || locList[0],
        rating: 5,
        source: 'Google',
        date: new Date(Date.now() - 11 * 86400000).toISOString().slice(0, 10),
        verified: true,
        avatarUrl: '/images/review-avatars/f01.jpg',
      },
      {
        quote: `Price was way more affordable than the other quotes we got. Still felt premium — clean jobsite, solid finish, and I'd hire them again without thinking twice.`,
        author: 'James R.',
        rating: 5,
        source: 'Google',
        date: new Date(Date.now() - 24 * 86400000).toISOString().slice(0, 10),
        verified: true,
        location: locList[2] || locList[0],
      },
    ],
  };
}

/** @deprecated Use defaultSeedSocialProof */
export const defaultPlaceholderSocialProof = defaultSeedSocialProof;

/** Visible blank-tagline token. Hero and footer must not print this. */
export const PLACEHOLDER_TAGLINE = 'TBD — local service tagline';

/** Stable opening of the invented review used to recognize the default social-proof seed. */
export const DEFAULT_SEED_REVIEW_QUOTE = 'Honestly did not expect such a professional team';

export function isPlaceholderTagline(value?: string | null): boolean {
  const s = String(value ?? '').trim();
  if (!s) return true;
  if (s === PLACEHOLDER_TAGLINE) return true;
  return /^tbd\b/i.test(s);
}

/** Tagline safe to print. The TBD token becomes an empty string. */
export function publicTagline(value?: string | null): string {
  const s = String(value ?? '').trim();
  return isPlaceholderTagline(s) ? '' : s;
}

export function socialProofIsDefaultSeed(proof?: SocialProof | null): boolean {
  const reviews = proof?.reviews ?? [];
  return reviews.some((review) => String(review.quote || '').includes(DEFAULT_SEED_REVIEW_QUOTE));
}

export function socialProofHasTrustStrip(proof?: SocialProof | null): boolean {
  if (!proof) return false;
  return Boolean(
    proof.rating ||
      (proof.licenses && proof.licenses.length) ||
      (proof.statistics && proof.statistics.length),
  );
}

function statisticDuplicatesRating(
  stat: { value: string; label: string },
  rating?: SocialProof['rating'],
): boolean {
  if (!rating) return false;
  const label = String(stat.label || '');
  const value = String(stat.value || '');
  if (/average\s+customer\s+rating/i.test(label)) return true;
  const num = parseFloat(value.replace(/[^\d.]/g, ''));
  return (
    Number.isFinite(num) &&
    Math.abs(num - rating.value) < 0.05 &&
    /rating|★|\*/i.test(`${value} ${label}`)
  );
}

/** Trust-row statistics. A stat that repeats the Google rating is omitted. */
export function trustStripStatistics(proof?: SocialProof | null) {
  if (!proof) return [];
  return (proof.statistics ?? []).filter((stat) => !statisticDuplicatesRating(stat, proof.rating));
}

/** Licenses for the trust row. */
export function trustStripLicenses(proof?: SocialProof | null) {
  return proof?.licenses ?? [];
}

export const siteConfigSchema = z.object({
  businessName: z.string().min(1),
  tagline: z.string().min(1),
  domain: z.string().min(1),
  niche: z.string().min(1),
  primaryCity: z.string().min(1),
  state: z.string().min(1),
  targetSuburbs: z.array(z.string().min(1)).default([]),
  /** Leftover coverage cities listed on the homepage (max 10, nearest when Zone). */
  alsoServing: z.array(z.string().min(1)).max(10).optional(),
  coverageAreas: z
    .array(
      z.object({
        name: z.string().min(1),
        state: z.string().min(2),
      }),
    )
    .optional(),
  serviceRadiusMiles: z.number().positive().optional(),
  address: z.preprocess(preprocessAddress, addressSchema.optional()),
  geo: geoSchema.optional(),
  phone: z.string().min(1),
  email: z.string().email(),
  /** Legacy Web3Forms key. The contact form posts to formsIngestUrl and builds when this is missing. */
  web3FormsAccessKey: z.string().optional().default(''),
  turnstileSiteKey: z.string().optional().default(''),
  /** Public Rover forms inbox endpoint. Empty until the inbox is set up and the site is assembled. */
  formsIngestUrl: z.string().optional().default(''),
  primaryCta: z.string().min(1),
  /** Residential / primary services (display order = priority; typically volume-ranked at generation). */
  services: z.array(z.string().min(1)).min(1).max(12),
  /** Optional commercial services; homepage shows after residential when present. */
  commercialServices: z.array(z.string().min(1)).max(12).optional(),
  /** Cap residential (and commercial) cards per section on the homepage. */
  homepageServicesLimit: z.number().int().min(1).max(12).optional().default(8),
  siteArchetype: z.enum(['multi_service', 'single_service']).optional().default('multi_service'),
  homepageSections: z.array(z.string().min(1)).optional(),
  brand: brandSchema,
  socialProof: socialProofSchema.optional(),
  logo: imageLikeSchema.optional(),
});

export type SiteConfig = z.infer<typeof siteConfigSchema>;
export type SiteAddress = z.infer<typeof addressSchema>;

export const site = siteConfigSchema.parse(rawConfig);

export function siteShowsServiceCards(config: SiteConfig = site): boolean {
  const sections = config.homepageSections;
  if (Array.isArray(sections) && sections.length) return sections.includes('services');
  return (config.siteArchetype ?? 'multi_service') === 'multi_service';
}

/** How many service cards to show per homepage section (1–12). Prefer 6 (3×2) or 8 (4×2). */
export function homepageServicesDisplayLimit(config: SiteConfig = site): number {
  const n = Number(config.homepageServicesLimit);
  if (!Number.isFinite(n)) return 8;
  return Math.min(12, Math.max(1, Math.floor(n)));
}

export function siteShowsServicesNav(config: SiteConfig = site): boolean {
  return siteShowsServiceCards(config) && (config.services?.length ?? 0) > 0;
}

export function siteUrl(path = '/'): string {
  return `https://${site.domain}${sitePath(path)}`;
}

/** Format +15095550199 → (509) 555-0199 for display */
export function formatPhoneDisplay(phone: string = site.phone): string {
  const digits = phone.replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (local.length !== 10) return phone;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

export function phoneHref(phone: string = site.phone): string {
  const digits = phone.replace(/\D/g, '');
  return `tel:+${digits}`;
}

/** Alt text for a content photo. Generic and service-slot captions pick up the city. */
export function contentImageAlt(
  alt: string,
  extra: { serviceName?: string } = {},
): string {
  return publicImageAlt(alt, {
    businessName: site.businessName,
    niche: site.niche,
    city: site.primaryCity,
    state: site.state,
    serviceName: extra.serviceName,
    services: [...(site.services || []), ...(site.commercialServices || [])],
  });
}
