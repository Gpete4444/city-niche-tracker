# Rank & Rent Master Template

Clone-per-site Astro template for local lead-gen Rank & Rent websites. Swap `site-config.json` + Markdown content, push a new repo, attach Cloudflare Pages.

**Stack:** Astro + Tailwind CSS v4 + Cloudflare Pages (static) + Web3Forms + optional Turnstile.

## Quick start

```powershell
cd c:\Repos\rank-and-rent-template
npm install
npm run dev
```

Build check:

```powershell
npm run build
npm run preview
```

## Clone a new site

1. **Use this repo as a GitHub template** (or `git clone` and remove `.git`, then `git init`).
2. Edit [`src/config/site-config.json`](src/config/site-config.json) — business name, geo, phone, email, Web3Forms key, brand colors.
3. Replace Markdown under:
   - `src/content/pages/` — `index.md`, `about.md`, `contact.md`
   - `src/content/services/` — one file per service
   - `src/content/locations/` — one file per suburb (keep 4–6; avoid thin duplicates)
4. Update `public/robots.txt` sitemap host to the new domain.
5. Commit, push to a **new** GitHub repo (one repo per domain).
6. Create a Cloudflare Pages project → Framework: Astro → Build: `npm run build` → Output: `dist`.
7. Attach the custom domain; set Email Routing; paste tracking phone into config and redeploy.

## Site config fields

| Field | Purpose |
| --- | --- |
| `businessName`, `tagline`, `domain`, `niche` | Identity + SEO chrome |
| `primaryCity`, `state`, `targetSuburbs` | Geo / areaServed |
| `address`, `geo` | Optional — omit street address if you have no real NAP; schema falls back to `ProfessionalService` + city |
| `phone`, `email` | CTA + schema |
| `web3FormsAccessKey` | Lead form (required string; replace before launch) |
| `turnstileSiteKey` | Optional spam protection |
| `primaryCta`, `services[]` | Marketing copy / form options |
| `brand.primary/accent/ink` | CSS theme tokens |
| `socialProof` | Optional verified ratings, licenses, statistics, and customer reviews |

Validated at import time via Zod in [`src/config/site.ts`](src/config/site.ts).

### Optional social proof

The homepage hides these sections when their arrays are empty. Add only claims supplied and verified by the eventual business owner:

```json
"socialProof": {
  "rating": {
    "value": 4.9,
    "reviewCount": 87,
    "source": "Google",
    "url": "https://example.com/verified-review-profile"
  },
  "licenses": [
    {
      "name": "Licensed Contractor",
      "number": "LICENSE-NUMBER",
      "jurisdiction": "WA"
    }
  ],
  "statistics": [
    { "value": "15+", "label": "Years of experience" },
    { "value": "400+", "label": "Projects completed" }
  ],
  "reviews": [
    {
      "quote": "Verified customer review text.",
      "author": "Customer name or initials",
      "location": "Spokane, WA",
      "rating": 5,
      "source": "Google"
    }
  ]
}
```

Ratings and reviews are displayed on the page but are intentionally not added to `LocalBusiness` JSON-LD. Google treats self-serving review markup for local businesses as ineligible for review rich results.

## Content collections

Defined in [`src/content.config.ts`](src/content.config.ts). Frontmatter must match the schema or **the build fails** — that is intentional.

JSON-LD is generated in [`src/components/LocalSchema.astro`](src/components/LocalSchema.astro) from config + page props. Do **not** ship a separate AI-written `schema.json`.

## Optional images

Place optimized WebP or AVIF files in `public/images/`, then reference them from Markdown frontmatter:

- `heroImage` — optional hero background on any page schema
- `featureImage` — optional homepage intro image
- `process[].image` — optional image for each “How it works” step
- `coverageMap` — optional static service-area map
- `gallery[]` — optional homepage project gallery
- `cardImage` — optional service-card thumbnail

Every image object requires `src` and meaningful `alt` text. The included Unsplash files are demo placeholders only; see [`IMAGE-CREDITS.md`](IMAGE-CREDITS.md). Replace them with verified owner project photos before launch.

To regenerate the demo coverage map after changing `coverageAreas` in `site-config.json`:

```powershell
npm run generate-map
```

The script performs rate-limited Nominatim lookups and creates `public/images/coverage-map.svg` from OpenStreetMap municipal boundaries. Review every generated map before publishing; municipal boundaries do not guarantee that a contractor serves every address inside them.

## Cloudflare Pages settings

- Build command: `npm run build`
- Output directory: `dist`
- Node version: 22+ (see `package.json` engines)
- Prefer `npm ci` if you commit the lockfile (recommended)

## Assembly-line phases (ops, not this repo)

1. Research → draft `site-config.json` (spot-check Gemini output) — see [`prompts/gemini-site-config.md`](prompts/gemini-site-config.md)
2. Content → Claude Markdown into collections only — see [`prompts/claude-markdown.md`](prompts/claude-markdown.md)
3. Domain / DNS → Cloudflare
4. Assemble → this template + inject config/content
5. Deploy → Pages
6. Email Routing + Web3Forms (+ Turnstile)
7. Twilio while ranking → CallRail when rented
8. GSC + Looker / AgencyAnalytics later

**Throughput note:** Expect 3–5 solid sites/day until you script Cloudflare/GitHub. Ten “live” sites with real QA in one day is usually fiction.

## Demo seed

Ships with Spokane concrete-lifting sample config and content so `npm run build` works out of the box. Replace everything before a real deploy.
