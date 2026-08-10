import { z } from 'astro/zod';
import rawConfig from './site-config.json';

const addressSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
});

const geoSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

const brandSchema = z.object({
  primary: z.string().regex(/^#([0-9A-Fa-f]{6})$/),
  accent: z.string().regex(/^#([0-9A-Fa-f]{6})$/),
  ink: z.string().regex(/^#([0-9A-Fa-f]{6})$/),
  paletteId: z.string().min(1).optional(),
});

const socialProofSchema = z.object({
  rating: z
    .object({
      value: z.number().min(1).max(5),
      reviewCount: z.number().int().nonnegative(),
      source: z.string().min(1),
      url: z.string().url().optional(),
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
      }),
    )
    .optional()
    .default([]),
});

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
  address: addressSchema.optional(),
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
  homepageServicesLimit: z.number().int().min(1).max(12).optional().default(12),
  siteArchetype: z.enum(['multi_service', 'single_service']).optional().default('multi_service'),
  homepageSections: z.array(z.string().min(1)).optional(),
  brand: brandSchema,
  socialProof: socialProofSchema.optional(),
});

export type SiteConfig = z.infer<typeof siteConfigSchema>;
export type SiteAddress = z.infer<typeof addressSchema>;

export const site = siteConfigSchema.parse(rawConfig);

export function siteShowsServiceCards(config: SiteConfig = site): boolean {
  const sections = config.homepageSections;
  if (Array.isArray(sections) && sections.length) return sections.includes('services');
  return (config.siteArchetype ?? 'multi_service') === 'multi_service';
}

/** How many service cards to show per homepage section (1–12). */
export function homepageServicesDisplayLimit(config: SiteConfig = site): number {
  const n = Number(config.homepageServicesLimit);
  if (!Number.isFinite(n)) return 12;
  return Math.min(12, Math.max(1, Math.floor(n)));
}

export function siteShowsServicesNav(config: SiteConfig = site): boolean {
  return siteShowsServiceCards(config) && (config.services?.length ?? 0) > 0;
}

export function siteUrl(path = '/'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `https://${site.domain}${normalized === '/' ? '' : normalized}`;
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
