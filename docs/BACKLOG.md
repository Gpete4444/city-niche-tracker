# Backlog (parked)

Items intentionally deferred. Do not block shipping on these.

## Rover UX phases (from pipeline backlog)

| Phase | Status | Notes |
|------|--------|-------|
| 1 UI quick wins + 1b discovery handoff | Done | Stage titles, table headers, Niche?, narrative collapse, tooltips, sticky cols, process-skip, Candidates batch filter, always-visible h-scroll |
| 2 Website tab + honest preview + auto build/ship + content simplify + Launch progress | Done (this sprint) | Website tab owns Stage/Assemble/Launch; assembled preview :4322; Assemble auto-builds/ships when credentials set |
| 3 Content brief → one-shot write | Done (this sprint) | Default Content path: Brief → Confirm → one-shot FILE paste → Accept; Researcher/Outline/Writer under Advanced |
| 4 SERP / enrich signal upgrades | Done (this sprint) | Map Pack Site?/website counts, organic EMD?, Enrichment Multi-loc? + thin-words callout (display flags only) |
| Stage 1 keep enrichment + research UX | Done (this sprint) | Stage 1 never drops Stage 2 enrichment (marks stale if SERP URLs change); clearer research-mode blurbs; detail table h-scroll; EMD Yes/No on all organic rows |
| 5a Named candidate groups | Done (this sprint) | Manual named lists; filter + add/remove selection; Manage rename/delete |
| 5b Pipeline ease | Parked | Broader Candidates flow polish (deferred; unspecified) |
| 6 Site Config + Website builder flow review | Done | Outline-first Content Structure (H2 checklist + presets + photos); Type A/B demoted to soft hint; Astro honors `homepageSections` |
| Sites portfolio tab | Done | JSON registry + Add to Sites + launch upsert |

## City cluster / SERP / distance (analysis later)

**When:** Before changing how Stage 1 or Discovery pick geos.

**Current behavior (as of 2026-08-09):**

- **SERP** (Stage 1 + Discovery probe): primary city only — no UI choice for multi-city SERP
- **Volumes** (Stage 1): multi-geo — primary + config `cluster` (from Discovery `suggested_suburbs`); Ads Planner volumes summed across those geos
- **Discovery Pack:** no distance/radius filter in New pack (state, pop, seasonality, tiers, Map Pack preference, niches/cities)
- **Site Config `radiusMiles`:** website service-area copy only — not SERP targeting
- **Candidates Est. Volume:** Stage 1 DFS Ads cluster sum (not Discovery Gemini); Discovery table Est. Volume remains Gemini

**Later analysis should cover:** single vs multi-city SERP option; whether a distance-from-primary Discovery filter should return; how cluster cities are chosen vs measured; UX to surface “SERP @ primary / volumes @ N cities”.

## Images pipeline

**When:** A site is near launch and needs real visuals.

**Scope (later):**

- Replace Unsplash demos in `public/images/` with niche-appropriate hero / card / gallery assets
- Writer/Editor prompts: only emit `heroImage` / `cardImage` / `featureImage` / `gallery` when files exist
- Keep `npm run generate-map` for coverage SVG ([README](../README.md))
- No generative-image ops pipeline unless we explicitly add one

**Today:** Manual drop-in under `public/images/` + frontmatter `src`/`alt` (see README “Optional images”).

## Template design / layout polish

**When:** After assemble path works and we’re iterating on live sites.

**Scope (later):**

- Small spacing / services grid / hero budget tweaks in shared Astro components
- Avoid a full redesign before clone-per-site is proven — every change ships to all assembled sites

## Claude deep compare vs Ippei content

**When:** After a few real sites, to harden Writer prompts.

**Scope (later):**

- Rover or one-off prompt: paste Ippei sample page text/URLs + our staged homepage
- Score SEO structure, local intent, EEAT, CTA clarity, thinness
- Feed findings into `prompts/claude-markdown.md` and agent packs
- **No** Ippei SaaS/API integration (locked in site build pipeline)

## Done vs parked

| Area | Status |
|------|--------|
| Discovery → site-config → content → Website (stage/assemble/launch) | Working |
| Assemble auto build + optional auto-ship + assembled preview :4322 | Working |
| CF domain / Email Routing / forms Launch helpers | Working (Rover Launch; Web3Forms key still paste) |
| Images / design / Ippei SEO compare | Parked here |
| City cluster / SERP / distance | Parked above |
| Phase 5a named groups | Done |
| Phases 5b Rover UX | Parked above |
| Phase 6 Content Structure (outline-first) | Done |
