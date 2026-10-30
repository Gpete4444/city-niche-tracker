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
- **Website Builder Service area:** map clicks select **coverageAreas** (customer trust / Areas SVG). Non-Zone keeps a radius slider + ring and Claude-first **targetSuburbs** ≤8 SEO location pages. Zone candidates ignore research seed, hide the radius ring, auto-page nearest leftover (non-site) towns, and derive `serviceRadiusMiles` from the farthest selected city. Requires `npm run build-research-map`.
- **Discovery Pack Use Map:** same shared map beside Cities (`Use Map` / `Done`) fills the pack Cities field from the discovery table panel.
- **Site Config `radiusMiles` / `serviceRadiusMiles`:** set on the Service area map (NAP field is a default seed only)

**Later analysis should cover:** single vs multi-city SERP option; how cluster cities are chosen vs measured for Ads volumes; UX to surface “SERP @ primary / volumes @ N cities”.

**Not the same as** the interactive research Map tab (below) — that is geography/population UI; this section is SERP/volume/geo targeting analysis.

## Interactive research Map tab (Discovery + Candidates)

**Status:** Shipped in Rover (operator Map tab). Rebuild GeoJSON after Census updates: `npm run build-research-map`.

**Scope (delivered):**

- New Rover top nav **Map** tab — full-bleed (no Discovery/Candidates sidebars)
- City + county boundary layers, independent on/off, overlay when both on
- Zoom in/out; readable **name + population** on the map (declutter at low zoom)
- Live min/max population filter (defaults 5k–500k)
- State `<select>` + City autofill + **Show** to zoom
- Candidates table **Map** column (separate from Map Pack) → open Map zoomed to row city
- Operator-only — **not** the visitor coverage SVG (`generate-coverage-map`)

**Data:**

- Place pop: `data/census/SUB-IP-EST2025-POP.csv` (incorporated) + `data/census/acs5-place-pop.csv` (ACS 5-year B01003 place totals by GEOID — CDPs / gap-fill; built from Census summary-file FTP, no API key; SUB-IP wins on name+state)
- County pop: `data/census/co-est2025-alldata.csv` (`SUMLEV=050`, `POPESTIMATE2025`, FIPS → shapefile `GEOID`)
- Boundaries: Census cartographic Places + Counties 500k (`cb_2025_us_place_500k`, `cb_2025_us_county_500k`) — copy from Downloads into `data/census/boundaries/` on build, join, serve as GeoJSON
- **Build:** `npm run build-research-map` → `data/census/map/{places,counties}.geojson` (gitignored; rebuild after Census updates). Set `FORCE_ACS_REFRESH=1` to re-download ACS place pops.

**Shipped (Rover Map tab):** full-bleed Map nav; native state select; city suggest; pop filter (default 5k–500k); Show zoom (auto-widens filter); Candidates Map column; Leaflet + `/api/map/*`; CDPs via ACS GEOID join.

## Images pipeline

**Rule:** All image fixes must harden the pipeline for current and future candidates (see `.cursor/rules/pipeline-forever.mdc`) — not one-off assembled-site patches.

**When:** A site is near launch and needs real visuals.

**Done (remainder):**

- Phase 1: niche-aware stock Pull scoring + Writer/Editor omit image FM unless files exist (incl. nested `process[].image`)
- Phase 2: Rover Website per-slot review (Re-pull / Upload) for launch-ready swaps
- Keep `npm run generate-map` for coverage SVG ([README](../README.md))

**Shipped:**

- Stock **Pull images** (Unsplash/Pexels) for Structure photo slots (niche query map + description/tag scoring)
- Per-slot **Re-pull** / **Upload** on Website → Images
- **ChatGPT before/after (browser prompts):** Website → copy niche prompts → import into `gallery`
- Manual drop-in under `public/images/` + frontmatter `src`/`alt` (see README “Optional images”)
- Omit missing image FM (top-level + gallery/materials + nested `process[].image`); optional `site-images` roots on Stage

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
| CF domain / Email Routing / forms Launch helpers | Working (Rover Launch emails from `leads@`) |
| Images / design / Ippei SEO compare | Images pipeline remainder done (Pull scoring + omit FM + slot Re-pull/Upload); design polish + Ippei compare still parked |
| City cluster / SERP / distance | Parked above |
| Interactive research Map tab | Done (Rover Map tab; rebuild GeoJSON with `npm run build-research-map`) |
| Phase 5a named groups | Done |
| Phases 5b Rover UX | Parked above |
| Phase 6 Content Structure (outline-first) | Done |
