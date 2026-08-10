# Claude prompt: Markdown content collections

Use for Phase 2 after `site-config.json` is finalized (ops **Site config** Accept, or [`claude-site-config.md`](claude-site-config.md)). Prefer ops **Content** tab (copy prompt → paste → write).

Output **only** Markdown files for this Astro template. Do **not** create `schema.json` — JSON-LD is generated in Astro.

## Prompt

```text
You are writing content for a Rover local lead-gen Astro + Markdown site.

I will paste site-config.json. Produce Markdown files that match the collection schemas below exactly.

Hard rules:
1. Unique copy per page. Location pages must not be near-duplicates with city names swapped.
2. Cap location pages at 4–6 suburbs from targetSuburbs / coverageAreas.
3. No fabricated reviews, ratings, licenses, years in business, project counts, or emergency claims.
4. No fake street address.
5. Image fields are OPTIONAL. For a new site without photos, omit heroImage, featureImage, gallery, coverageMap, cardImage, and process[].image — OR leave them pointing at /images/... only if I say to reuse demo paths.
6. Homepage process steps: exactly 3. whyChooseUs: exactly 3. faqs: 3–5.
7. Filenames: kebab-case. Services go in services/, locations in locations/, pages in pages/.
8. Frontmatter keys must match schemas or the Astro build fails.

Required files:
- pages/index.md
- pages/about.md
- pages/contact.md
- services/{slug}.md for each item in config.services (order: 1..n)
- locations/{slug}.md for 4–6 suburbs (include city, state, parentCity = primaryCity)

### pages collection frontmatter
title, description, h1, draft (false)
Optional homepage-only fields (index.md):
sectionHeading, featureImage {src, alt}, coverageMap {src, alt}, gallery [{src, alt}],
whyChooseUs [{title, description}],
process [{title, description, image? {src, alt}}],
faqs [{question, answer}],
heroImage {src, alt}

### services collection frontmatter
title, description, h1, serviceName, order, draft (false)
Optional: heroImage, cardImage

### locations collection frontmatter
title, description, h1, city, state, parentCity?, draft (false)
Optional: heroImage

Body: 2–4 short paragraphs of useful local copy. Mention climate/soil/buyer pain specific to that city when credible; otherwise stay honest and general.

For index.md body: 2 short paragraphs under the frontmatter.

Output format:
For each file, print:

### FILE: src/content/pages/index.md
---
...frontmatter...
---

body

(Repeat for every file. No other commentary.)
```

## Paste after the prompt

```text
SITE CONFIG:
{{paste full site-config.json here}}
```

## After Claude

1. Prefer ops → **Content** → Load as draft → Write `src/content/` (backs up + prunes demo leftovers).
2. Or manually replace files under `src/content/` and delete leftover demo Markdown.
3. Run `npm run build` — fix any Zod frontmatter errors.
4. Skim every location page for uniqueness before deploy.
