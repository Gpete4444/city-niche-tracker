# Candidate scoring rubric (specialty / high-ticket)

Canonical machine-readable source: [`scripts/lib/scoring-rubric.json`](../scripts/lib/scoring-rubric.json)  
Applied by: [`scripts/lib/scoring.mjs`](../scripts/lib/scoring.mjs) ΓåÆ attached as `scoring` on every `npm run research-candidate` report.

Claude must follow this file when polishing `jobValue` / `proposedScore`. Do not invent a parallel scale.

## Pipeline stages

| Stage | Command | Collects |
| --- | --- | --- |
| **1** | `npm run research-candidate` | SERP, volumes, demand/competition/mapPackGap |
| **2** | `npm run enrich-candidate` or `research-candidate --enrich` | DataForSEO Rank, page thinness, displaceability |
| **3** | `npm run prospect-renters` | Renter prospects (after pursue) |

Stage 2 is recommended when Stage 1 `enrichmentRecommended` is true (mid+ demand and decision review/pursue/maybe). Stage 3 is sales intel only ΓÇö not every candidate.

## Volume method

`volumes.clusterVolumeSum` = Google Ads Keyword Planner monthly volume for the selected keyword set, measured **per city geo**, then **summed** across Ads-targetable cities in the cluster.

- Not rough geo-phrase ranges on `ΓÇªlouisville ky` phrases.
- `primaryVolume` = searches **from** that city geo.
- Ads buckets (10, 20, 30, 50ΓÇª) are noisy at the low end.
- Ads `competition` / CPC Γëá organic difficulty.

## Authority metric (Stage 2)

Use **DataForSEO Rank** (0ΓÇô100), from `/backlinks/summary/live`.

**This is not Moz Domain Authority or Ahrefs Domain Rating.** Use it only for relative comparison across competitors in the same report.

| Median domain Rank | Effect on Displaceability |
| --- | --- |
| &lt; 20 | +1 (more displaceable) |
| 20ΓÇô39 | no Rank adjustment |
| ΓëÑ 40 | ΓêÆ1 (less displaceable) |

Also collect **page Rank** per ranking URL ΓÇö a strong domain can still have a thin location stub.

## Demand bands (high-ticket specialty)

| Band | Cluster vol / mo | Score | Treat as |
| --- | --- | --- | --- |
| Low | &lt; 100 | ~2ΓÇô4 | Only if soft SERP **and** high ticket |
| Mid | 100ΓÇô299 | ~6ΓÇô7 | Default ΓÇ£look closerΓÇ¥ |
| High | 300ΓÇô699 | ~8ΓÇô9 | Strong demand if SERP not locked |
| Very high | 700+ | 10 | Score competition harder |

Low-ticket niches (&lt; ~$1,500 avg job): treat each band one tier stricter.

## Score inputs (each 1ΓÇô10, higher = better opportunity)

| Input | Who sets it | Meaning |
| --- | --- | --- |
| **demand** | Stage 1 | From cluster volume scale |
| **competition** | Stage 1; preserved in Stage 2 | Structural organic Openness from classified result type, blue-link position, all-domain breadth, and top-five homepage concentration |
| **mapPackGap** | Stage 1 | 9 if Map Pack absent, 3 if present |
| **jobValue** | Claude / human | From estimated average job cost |
| **displaceability** | Stage 2 | How displaceable blue-link pages look (thin stubs vs strong niche pages) |

**proposedScore (Stage 1, no displaceability):** renormalize `0.30┬╖demand + 0.30┬╖competition + 0.25┬╖jobValue + 0.15┬╖mapPackGap`  
**proposedScore (Stage 2):** `0.25┬╖demand + 0.25┬╖competition + 0.20┬╖jobValue + 0.15┬╖mapPackGap + 0.15┬╖displaceability`  
Remains `null` until `jobValue` is set.

## Displaceability (Stage 2) ΓÇö replaces the manual ΓÇ£open 8 URLsΓÇ¥ gate

Scores each organic homepage/sub-page (not a promise of ranking in 4ΓÇô6 months):

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

| Displaceability score | Band | Decision hint |
| --- | --- | --- |
| ΓëÑ 7 | high | Mostly thin stubs ΓåÆ lean **pursue** even at mid proposedScore |
| 4ΓÇô6 | mid | Mixed ΓÇö review `enrichment.pages` |
| Γëñ 3 | low | Strong niche pages ΓåÆ **deprioritize** |

## SERP softness

- **Soft:** Γëñ1 organic niche homepage **and** Γëñ5 unique organic service domains  
- **Hard:** (ΓëÑ2 niche homepages **and** Map Pack present) **or** ΓëÑ8 unique organic domains  
- **Mixed:** everything else ΓåÆ use displaceability when available

## Decision rules (specialty / high-ticket)

1. Mid+ volume + soft SERP ΓåÆ **pursue**
2. Mid+ volume + mixed SERP + high displaceability ΓåÆ **pursue**
3. Mid volume + mixed SERP + low displaceability ΓåÆ **deprioritize**
4. Mid volume + hard SERP ΓåÆ **deprioritize**
5. Low volume + soft SERP + high ticket ΓåÆ **maybe** (portfolio bet)
6. Low volume otherwise ΓåÆ **pass** (if ticket still unknown and SERP is soft ΓåÆ **review**)
7. High/very-high volume + hard SERP ΓåÆ **pass_unless_gbp_angle**
8. Else ΓåÆ **review**

## Path to win: two local SERP lanes

Local Google results have **two lanes**. Score Map Pack gap and organic competition separately; do not treat ΓÇ£the SERPΓÇ¥ as one thing.

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

### What ΓÇ£site-onlyΓÇ¥ means

**Site-only** = a Rank & Rent website **without a strong GBP** (often with no GBP at all at launch).

A new Rank & Rent asset usually starts site-only. You generally **cannot win the Map Pack early** without a real GBP. You **can** rank a well-built niche site in the blue links ΓÇö especially when competitors only have thin location sub-pages and no dedicated niche homepage (example pattern: 0 organic homepages while Map Pack is already filled).

### Playbook

1. **Build the site** ΓåÆ aim to rank in **organic blue links** ΓåÆ get leads  
2. **Rent** to a contractor who has (or will create) a real GBP  
3. **Push Map Pack** as a second phase once the GBP is attached  

That assetΓÇÖs realistic first win is **blue links, not the map**. Soft organic (few niche homepages) still supports building even when Map Pack is present; plan blue links first, Map Pack second.

### How this affects scoring

- **Map Pack absent** ΓåÆ stronger early opportunity; blue links face less pack squeeze; GBP later can attack both lanes.
- **Map Pack present** ΓåÆ expect to compete below the pack first; still pursue if organic is soft (Γëñ1 niche homepage / mostly sub-pages).
- **Time-to-rank estimates** should usually quote a longer path *without* GBP (blue links only) vs *with* GBP (Map Pack becomes realistic).

## Rover display flags (not score inputs)

SERP / Enrichment tabs may show **Map Pack Site?**, organic **EMD?**, enrich **Multi-loc?**, and thin-words summaries. These are human heuristics for review ΓÇö they do **not** change `proposedScore` weights or decision rules yet.

## Stage 3 renter prospecting

After **pursue**, run `npm run prospect-renters`. Review-count bands are a **size proxy only** (not employee headcount). Prefer outreach to businesses with websites + reviews that do **not** already own the niche Map Pack / organic SERP; ads presence signals budget.
