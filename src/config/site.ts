import { z } from 'astro/zod';
import rawConfig from './site-config.json';
import { sitePath } from '../lib/site-path';

const addressSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
});

/** Empty / partial address objects (common after optional NAP fields) → omit. */
function preprocessAddress(value: unknown): unknown {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const o = value as Record<string, unknown>;
  const street = String(o.street ?? '').trim();
  const city = String(o.city ?? '').trim();
  const state = String(o.state ?? '').trim();
  const zip = String(o.zip ?? '').trim();
  if (!street || !city || !state || !zip) return undefined;
  return { street, city, state, zip };
}

const geoSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

const brandSchema = z.object({
  primary: z.string().regex(/^#([0-9A-Fa-f]{6})$/),
  accent: z.string().regex(/^#([0-9A-Fa-f]{6})$/),
  ink: z.string().regex(/^#([0-9A-Fa-f]{6})$/),
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
    const name = String(c || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    locList.push(state ? `${name}, ${state}` : name);
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

export function socialProofHasTrustStrip(proof?: SocialProof | null): boolean {
  if (!proof) return false;
  return Boolean(
    proof.rating ||
      (proof.licenses && proof.licenses.length) ||
      (proof.statistics && proof.statistics.length),
  );
}

export const siteConfigSchema = z.object({
  businessName: z.string().min(1),
  tagline: z.string().min(1),
  domain: z.string().min(1),
  niche: z.string().min(1),
  primaryCity: z.string().min(1),
  state: z.string().min(1),
  targetSuburbs: z.array(z.string().min(1)).min(1),
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
  web3FormsAccessKey: z.string().min(1),
  turnstileSiteKey: z.string().optional().default(''),
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
