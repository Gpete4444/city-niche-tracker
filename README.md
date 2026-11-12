# Rover

**Version 2.6** (`2.6.0`)

Clone-per-site Astro template and local Rover dashboard for local lead-gen websites. Swap `site-config.json` + Markdown content, ship a new repo, attach Cloudflare Workers.

**Guides:** [User guide](docs/USER-GUIDE.md) (operators) · [Dev guide](docs/DEV-GUIDE.md) (engineers) · [User flow / times](docs/USER-FLOW.md)

**Stack:** Astro + Tailwind CSS v4 + Cloudflare Workers (static assets) + Web3Forms + optional Turnstile.  
**Repo:** [github.com/7D7D/Rover](https://github.com/7D7D/Rover)

## Quick start

```powershell
cd c:\Repos\Rover
npm install
npm run dev
```

Build check:

```powershell
npm run build
npm run preview
```

**Rover dashboard** (pipeline UI):

```powershell
npm run rover
# alias: npm run ops
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787).
## Clone a new site

1. **Use this repo as a GitHub template** (or `git clone` and remove `.git`, then `git init`).
2. Edit [`src/config/site-config.json`](src/config/site-config.json) — business name, geo, phone, email, Web3Forms key, brand colors.
3. Replace Markdown under:
   - `src/content/pages/` — `index.md`, `about.md`, `contact.md`
   - `src/content/services/` — one file per service
   - `src/content/locations/` — primary + suburbs as location pages (prefer **4–6 total**; avoid thin duplicates). Extra coverage cities show as “Also serving,” not separate pages.
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

**Rover Website path (preferred):** On a candidate’s Website step, use **Pull images**, per-slot **Re-pull** / **Upload**, and **Before & after (ChatGPT)** import. Assets land in `research/{id}/site-images/`, wire into content frontmatter, then **Stage → Assemble**.

Manual fallback: place optimized WebP or AVIF files in `public/images/` (or the candidate’s `site-images/`), then reference them from Markdown frontmatter:

- `heroImage` — optional hero background on any page schema
- `featureImage` — optional homepage intro image
- `process[].image` — optional image for each “How it works” step
- `coverageMap` — optional static service-area map
- `gallery[]` — optional homepage project gallery
- `cardImage` — optional service-card thumbnail

Every image object requires `src` and meaningful `alt` text. The included Unsplash files are demo placeholders only; see [`IMAGE-CREDITS.md`](IMAGE-CREDITS.md). Replace them with niche stock (Pull) or verified owner project photos before launch.

To regenerate the demo coverage map after changing `coverageAreas` in `site-config.json`:

```powershell
npm run generate-map
```

The script performs rate-limited Nominatim lookups and creates `public/images/coverage-map.svg` from OpenStreetMap municipal boundaries. Review every generated map before publishing; municipal boundaries do not guarantee that a contractor serves every address inside them.

## Cloudflare Pages settings

This template is a **static** Astro site (`dist/`). In the Cloudflare dashboard you will usually see **Workers & Pages**.

### Workers Builds (current CF UI — Deploy command required)

If Build settings show a required **Deploy command** and no “Output directory”:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy` (keep this)
- Non-production deploy (optional): `npx wrangler versions upload`
- Repo must include [`wrangler.json`](wrangler.json) with `"assets": { "directory": "./dist" }` (Assemble writes the Worker `name` from the site slug)
- Optional env: `NODE_VERSION=22`

### Classic Pages (Output directory field)

If you create a **Pages** project instead and see Output directory:

- Build command: `npm run build`
- Deploy command: empty
- Output directory: `dist`

Master pipeline flowchart + tools matrix: [`docs/MASTER-FLOW.md`](docs/MASTER-FLOW.md). Full assemble → deploy runbook: [`docs/ASSEMBLE-AND-LAUNCH.md`](docs/ASSEMBLE-AND-LAUNCH.md). **Run launch** details: [`docs/LAUNCH.md`](docs/LAUNCH.md). Parked follow-ons: [`docs/BACKLOG.md`](docs/BACKLOG.md).

## Operator dashboard (local)

For day-to-day pipeline work, use the local ops UI instead of juggling CLI commands:

```powershell
npm run rover
# alias: npm run ops
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787) — bound to localhost only. Do **not** expose this port or deploy it to Cloudflare Pages.

**Flow:** Discovery = Claude (pick rows + narrative) → **cheap DataForSEO SERP probe** (~$0.002/row for Map Pack + organic counts) → decide → **Process batch** promotes rows into Candidates by `meta.decision`. Only `pursue` auto-queues Stage 1 (full cluster volumes + scoring; Live or Standard Ads queue).

**Anti-dupe:** Rover maintains `research/known-candidates.csv` from all candidates (any group). New Discovery Claude prompts include that list so city×niche pairs are not re-proposed; Process links to an existing candidate instead of creating a duplicate.

Add `ANTHROPIC_API_KEY` to `.env` for one-click Claude narrative drafts (Accept required before save). DataForSEO keys are still required for Stage 1–2 / Prospects scripts.

The UI lists every candidate under `research/`, shows full tables (SERP, keywords, enrichment, prospects), runs research/enrich/prospects with live logs, and advances decision + narrative Accept/Reject.

## Candidate research (DataForSEO + Claude)

Chat models do **not** fetch live Google SERPs or city keyword volumes reliably. Use DataForSEO for facts; Claude for narrative.

1. Copy [`.env.example`](.env.example) → `.env` and add DataForSEO API login/password (and `ANTHROPIC_API_KEY` for ops narrative).
2. Prefer `npm run rover` (or `npm run ops`), or pull SERP + volumes via CLI:

```powershell
# Prefer --config on Windows (PowerShell strips quotes / breaks on ";")
npm run research-candidate -- --config scripts/examples/louisville-candidate.json
```

Or with flags — use `|` between cluster cities, never `;`:

```powershell
npm run research-candidate -- --niche "Trenchless Sewer Pipe Lining" --primary "Louisville,KY" --cluster "Jeffersontown,KY|St. Matthews,KY|Shively,KY" --related 10 --out research/louisville-trenchless.json
```

Cluster cities are matched against Google Ads geo targets before volumes are requested. Small suburbs (e.g. St. Matthews, KY) have no geo target, so they are skipped and listed under `volumes.citiesWithoutAdsGeoTarget` instead of failing the run. The **primary** city uses an Ads-listed neighbor if needed; it never uses statewide Ads volume. If neither the city nor a neighbor is in Ads, volumes are skipped (SERP still writes) so demand is not inflated.

Each research JSON includes a `scoring` block from [`scripts/lib/scoring-rubric.json`](scripts/lib/scoring-rubric.json): demand band, SERP softness, specialty/high-ticket decision rules, and score inputs. Human-readable guide: [`prompts/scoring-rubric.md`](prompts/scoring-rubric.md). `jobValue` / `proposedScore` stay null until Claude fills average job cost.

### Stage 2 — authority + page strength

When Stage 1 sets `scoring.enrichmentRecommended` (or anytime you want Rank/thinness):

```powershell
npm run enrich-candidate -- --research research/louisville-trenchless.json
# or fold into Stage 1:
npm run research-candidate -- --config scripts/examples/louisville-candidate.json --enrich
```

Adds DataForSEO **Rank** (0–100, **not** Moz DA), per-URL page heuristics, and `displaceability` (automates the “are these thin stubs?” gate). Failed HTML fetches are labeled `fetch_failed` and excluded from displaceability.

**Rover tip:** Stage 1 re-runs **keep** Stage 2 enrichment. Force SERP may mark it stale if organic/directory URLs change — re-Enrich when you want fresh Rank. The stage-rail research mode blurb explains Reuse SERP vs Volumes only vs Force SERP (Ads volumes are usually the costly part).

### Stage 3 — Claude narrative (Accept → approved package)

Paste Stage 1/2 JSON into [`prompts/claude-candidate-research.md`](prompts/claude-candidate-research.md) (or use ops Claude / Copy prompt). **Accept** validates job cost + `jobValue`, merges soft fields, and writes `research/{id}-approved.json`. Decision **pursue** + approved package unlocks site-config.

### Stage 4 — renter prospects (optional; does not block build)

```powershell
npm run prospect-renters -- --research research/louisville-trenchless.json
```

Then optional outreach polish: [`prompts/claude-prospect-renters.md`](prompts/claude-prospect-renters.md).

4. Approved package → ops **Site config** tab or [`prompts/claude-site-config.md`](prompts/claude-site-config.md) → `src/config/site-config.json`.
5. Content → ops **Content** tab or [`prompts/claude-markdown.md`](prompts/claude-markdown.md) → `src/content/` → `npm run build`.

See [`prompts/README.md`](prompts/README.md). Outputs under `research/` are gitignored.

## Assembly-line phases

1. DataForSEO research → `npm run research-candidate`
2. Enrich (Rank + page strength) → `npm run enrich-candidate` when recommended
3. Claude narrative → Accept → `*-approved.json` ([`prompts/claude-candidate-research.md`](prompts/claude-candidate-research.md))
4. Optional `npm run prospect-renters` (outreach; parallel to build)
5. Site-config from approved package ([`prompts/claude-site-config.md`](prompts/claude-site-config.md))
6. Claude Markdown into collections (ops Content tab / [`prompts/claude-markdown.md`](prompts/claude-markdown.md))
7. Domain / DNS → Cloudflare
8. Assemble → this template + inject config/content
9. Deploy → Pages
10. Email Routing + Web3Forms (+ Turnstile)
11. Twilio phone intelligence — ranking DID, rent forward (same number), Phone tab ([`docs/PHONE-TRACKING.md`](docs/PHONE-TRACKING.md); Website Builder Site-Config / Launched Sites / Phone, not Launch). Operator stages: [`docs/PIPELINE-STAGES.md`](docs/PIPELINE-STAGES.md).
12. GSC + Looker / AgencyAnalytics later

**Throughput note:** Expect more sites/day once Assemble + Launch are routine. First GitHub/Workers project connect is still manual; CF domain + Email Routing + Web3Forms paste are ops Launch. Ten “live” sites with real QA in one day is still usually fiction.

## Demo seed

Ships with Spokane concrete-lifting sample config and content so `npm run build` works out of the box. Replace everything before a real deploy.
