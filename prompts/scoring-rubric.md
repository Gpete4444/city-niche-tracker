# Candidate scoring rubric (specialty / high-ticket)

Canonical machine-readable source: [`scripts/lib/scoring-rubric.json`](../scripts/lib/scoring-rubric.json)  
Applied by: [`scripts/lib/scoring.mjs`](../scripts/lib/scoring.mjs) → attached as `scoring` on every `npm run research-candidate` report.

Claude must follow this file when polishing `jobValue` / `proposedScore`. Do not invent a parallel scale.

## Pipeline stages

| Stage | Command | Collects |
| --- | --- | --- |
| **1** | `npm run research-candidate` | SERP, volumes, demand/competition/mapPackGap |
| **2** | `npm run enrich-candidate` or `research-candidate --enrich` | DataForSEO Rank, page thinness, displaceability |
| **3** | `npm run prospect-renters` | Renter prospects (after pursue) |

Stage 2 is recommended when Stage 1 `enrichmentRecommended` is true (mid+ demand and decision review/pursue/maybe). Stage 3 is sales intel only — not every candidate.

## Volume method

Ads Keyword Planner monthly volume for the selected keyword set is measured **per city geo**.

- **`volumes.primaryVolumeSum`** — searches **from** the primary city geo (not about that city).
- **`volumes.clusterVolumeSum`** — sum across Ads-targetable cities in the cluster (**display only**; metro geos overlap, so this double-counts shared demand and grows with longer suburb lists).
- **`volumes.demandVolumeSum`** — what scoring uses:

  `demandVolumeSum = primaryVolumeSum + α × max(0, clusterVolumeSum − primaryVolumeSum)`

  Default **α = 0.25** (`volumeMetric.suburbOverlapFactor`). If primary is missing, fall back to cluster sum.

- Not rough geo-phrase ranges on `…louisville ky` phrases.
- Ads buckets (10, 20, 30, 50…) are noisy at the low end.
- Ads `competition` / CPC ≠ organic difficulty.

## Authority metric (Stage 2)

Use **DataForSEO Rank** (0–100), from `/backlinks/summary/live`.

**This is not Moz Domain Authority or Ahrefs Domain Rating.** Use it only for relative comparison across competitors in the same report.

| Median domain Rank | Effect on Displaceability |
| --- | --- |
| &lt; 20 | +1 (more displaceable) |
| 20–39 | no Rank adjustment |
| ≥ 40 | −1 (less displaceable) |

Also collect **page Rank** per ranking URL — a strong domain can still have a thin location stub.

## Demand bands (high-ticket specialty)

Bands apply to **`demandVolumeSum`**, not raw cluster sum.

| Band | Demand vol / mo | Score | Treat as |
| --- | --- | --- | --- |
| Low | &lt; 60 | ~2–4 | Only if soft SERP **and** high ticket |
| Mid | 60–179 | ~6–7 | Default “look closer” |
| High | 180–399 | ~8–9 | Strong demand if SERP not locked |
| Very high | 400+ | 10 | Score competition harder |

Low-ticket niches (&lt; ~$1,500 avg job): treat each band one tier stricter.

## Score inputs (each 1–10, higher = better opportunity)

| Input | Who sets it | Meaning |
| --- | --- | --- |
| **demand** | Stage 1 | From demandVolumeSum scale (primary + α×suburb) |
| **competition** | Stage 1; preserved in Stage 2 | Structural organic Openness from classified result type, blue-link position, all-domain breadth, and top-five homepage concentration |
| **mapPackGap** | Stage 1 | 9 if Map Pack absent, 3 if present |
| **jobValue** | Claude / human | From estimated average job cost |
| **displaceability** | Stage 2 | How displaceable blue-link pages look (thin stubs vs strong niche pages) |

**proposedScore (Stage 1, no displaceability):** renormalize `0.30·demand + 0.30·competition + 0.25·jobValue + 0.15·mapPackGap`  
**proposedScore (Stage 2):** `0.25·demand + 0.25·competition + 0.20·jobValue + 0.15·mapPackGap + 0.15·displaceability`  
Remains `null` until `jobValue` is set.

## Displaceability (Stage 2) — replaces the manual “open 8 URLs” gate

Scores each organic homepage/sub-page (not a promise of ranking in 4–6 months):

- URL shape (location / service-area stubs)
- Title / H1 niche match
- Word count
- Multi-location template signals
- Page Rank + domain Rank

| Label | Meaning |
| --- | --- |
| `thin_stub` | Likely displaceable location/service stub |
| `moderate` | Mixed |
| `strong_niche_page` | Purpose-built niche page / higher page Rank |

| Displaceability score | Band | Notes |
| --- | --- | --- |
| ≥ 7 | high | Mostly thin stubs — favorable openness signal |
| 4–6 | mid | Mixed — review `enrichment.pages` |
| ≤ 3 | low | Strong niche pages — harder organic lane |

## SERP softness

- **Soft:** ≤1 organic niche homepage **and** ≤5 unique organic service domains  
- **Hard:** (≥2 niche homepages **and** Map Pack present) **or** ≥8 unique organic domains  
- **Mixed:** everything else → use displaceability when available

## Decision rules (Overall score)

Rover recommends from **Overall (proposedScore)** after Research stages **1 Research · 2 Enrich · 3 Narrative** are complete:

1. Stages 1–3 incomplete or no Overall score → **review**
2. Overall **≥ 7** → **pursue**
3. Overall **≥ 6 and &lt; 7** → **maybe**
4. Overall **&lt; 6** → **pass**
5. **hold** is human-only (not auto-recommended)

## Path to win: two local SERP lanes

Local Google results have **two lanes**. Score Map Pack gap and organic competition separately; do not treat “the SERP” as one thing.

### 1. Map Pack

The 3 local businesses shown with the map. Google heavily favors a **Google Business Profile (GBP)**:

- Reviews and review velocity
- Address / NAP consistency
- Categories
- Proximity to the searcher
- Profile activity / completeness

### 2. Blue links

The normal organic results under/around that pack. Google favors **web pages**:

- Relevance to the query
- Content depth
- Internal links / site structure
- Backlinks and domain signals

### What “site-only” means

**Site-only** = a Rank & Rent website **without a strong GBP** (often with no GBP at all at launch).

A new Rank & Rent asset usually starts site-only. You generally **cannot win the Map Pack early** without a real GBP. You **can** rank a well-built niche site in the blue links — especially when competitors only have thin location sub-pages and no dedicated niche homepage (example pattern: 0 organic homepages while Map Pack is already filled).

### Playbook

1. **Build the site** → aim to rank in **organic blue links** → get leads  
2. **Rent** to a contractor who has (or will create) a real GBP  
3. **Push Map Pack** as a second phase once the GBP is attached  

That asset’s realistic first win is **blue links, not the map**. Soft organic (few niche homepages) still supports building even when Map Pack is present; plan blue links first, Map Pack second.

### How this affects scoring

- **Map Pack absent** → stronger early opportunity; blue links face less pack squeeze; GBP later can attack both lanes.
- **Map Pack present** → expect to compete below the pack first; still pursue if organic is soft (≤1 niche homepage / mostly sub-pages).
- **Time-to-rank estimates** should usually quote a longer path *without* GBP (blue links only) vs *with* GBP (Map Pack becomes realistic).

## Rover display flags (not score inputs)

SERP / Enrichment tabs may show **Map Pack Site?**, organic **EMD?**, enrich **Multi-loc?**, and thin-words summaries. These are human heuristics for review — they do **not** change `proposedScore` weights or decision rules yet.

## Stage 3 renter prospecting

After **pursue**, run `npm run prospect-renters`. Review-count bands are a **size proxy only** (not employee headcount). Prefer outreach to businesses with websites + reviews that do **not** already own the niche Map Pack / organic SERP; ads presence signals budget.
