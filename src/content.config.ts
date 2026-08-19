import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const imageSchema = z.object({
  src: z.string().min(1),
  alt: z.string().min(1),
});

const pageFields = {
  title: z.string(),
  description: z.string(),
  h1: z.string(),
  heroImage: imageSchema.optional(),
  draft: z.boolean().optional().default(false),
};

const pages = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/pages' }),
  schema: z.object({
    ...pageFields,
    sectionHeading: z.string().optional(),
    featureImage: imageSchema.optional(),
    coverageMap: imageSchema.optional(),
    gallery: z.array(imageSchema).optional(),
    materialsImages: z.array(imageSchema).optional(),
    whyChooseUs: z
      .array(
        z.object({
          title: z.string(),
          description: z.string(),
        }),
      )
      .optional(),
    process: z
      .array(
        z.object({
          title: z.string(),
          description: z.string(),
          image: imageSchema.optional(),
        }),
      )
      .optional(),
    faqs: z
      .array(
        z.object({
          question: z.string(),
          answer: z.string(),
        }),
      )
      .optional(),
  }),
});

const services = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/services' }),
  schema: z.object({
    ...pageFields,
    serviceName: z.string(),
    order: z.number().optional(),
    cardImage: imageSchema.optional(),
    materialsImages: z.array(imageSchema).optional(),
    processImages: z.array(imageSchema).optional(),
  }),
});

const locations = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/locations' }),
  schema: z.object({
    ...pageFields,
    city: z.string(),
    state: z.string(),
    parentCity: z.string().optional(),
  }),
});

export const collections = { pages, services, locations };
