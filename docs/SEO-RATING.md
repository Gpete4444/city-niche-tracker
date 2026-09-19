# Rover content SEO rating

Letter-grade snapshot of how strong Rover’s **content pipeline** is for **local page-1 speed** and **human readability** — not Domain Rank, Moz DA, or live SERP position.

Re-grade when major Content / Outline / Editor / Accept changes land; append under [History](#history) instead of deleting prior snapshots.

## Rubric

| Focus | Means |
| --- | --- |
| Page-1 speed | How well Structure → Field research → Brief → Outline → batched Full write → Humanize → Final check → Accept produces landings that can compete in soft–mid local SERPs when the operator runs the heavy path |
| Human readability | Contractor-on-the-phone voice: service-first intros, speech lint, Humanize pack (burstiness / perplexity / bookends / conversion) |
| Out of scope here | GBP, citations, backlinks, paid ads, niche softness of a specific market — operator checklist lives under Website → Launch (Citations + NAP CSV); see [SITE-INDEXING.md](SITE-INDEXING.md) |

## Current grade (2026-08)

### Overall: **B+** (target after eight-pass Soft path: still **B+**, with Pass 1–3 / bookends trending up)

Up from **B−** after ranking-wins work (live PAA / organic titles into Outline, harder keyword/FAQ Accept, Editor + speech gate). Eight-pass Soft path (Field research → Brief → batched write → Humanize pack → Final check) raises operator consistency and Pass 3–8 coverage; re-score after live candidates complete the new cadence.

| Dimension | Grade | Notes |
| --- | --- | --- |
| Helpful content depth | **B+** | Cost, timeline, materials, DIY, codes, when-to-call, FAQs — Preset C “value SEO” kit |
| On-page SEO scaffolding | **B+** | Keyword targets, FAQ seeds, full-write link checklist wired into outline/write |
| Human readability / speech | **B+** | Humanize required; ordered Passes 4–7 + Final check gate Accept |
| Keyword / SERP precision | **A−** | Live PAA + organic titles on SERP; hard Accept on primary KW / FAQ coverage (override available) |
| E-E-A-T / trust depth | **C+** | Stronger About/trust/reviews prompts; still no case-study / owner-credential workflow |
| Internal linking / topical cluster | **B** | Required-link checklist + soft lint; not a full hub-spoke CMS |
| Operator consistency | **A−** | No Skip on Soft path; scorecard + Final check before Accept |

### What moved the grade

- Keyword targets + FAQ seeds baked into outline / full-write
- Live SERP PAA + organic titles feeding Outline
- Critical SEO findings block Accept unless **Accept with SEO warnings** is checked
- Editor + speech check treated as a real step before Accept
- Required-link checklist for internal linking
- **Eight-pass Soft path (2026-08):** Field research Claude JSON → Brief confirm → batched Full write → Humanize pack → Final check; shared guardrails; entity-matching Structure callout

### Ceiling / next levers

Still under **A−** mainly because of:

- Thin real-world **E-E-A-T** beyond seeded `socialProof` (case studies, owner credentials)
- Operators who override Accept SEO warnings
- No full hub-spoke CMS for topical clusters / supporting topical pages (Brief may list `supportingTopics[]` later)

**Shipped toward the next grade (2026-08 local-depth forever):** City context briefs (Wikipedia + discovery seed) inject into Outline refine + Full write; stronger loc*/materials instructions; Accept critical `location_body_thin` / `location_bodies_near_duplicate` plus soft materials specificity. Re-grade after operators re-run Full write on live candidates.

Off-site levers (GBP, reviews, citations) usually move rankings faster than more on-page fluff — see parked Ippei deep compare in [BACKLOG.md](BACKLOG.md).

## History

### Detector pack (2026-09) — pipeline lever (grade pending next-candidate re-score)

- Contrast closer cap (≥2 per FILE), per-FILE bookend policy, location Why-choose/FAQ mix, structured em-dash budget.
- Projected site crawl **~62%** (58–68) after the next Write that actually follows the new prompts + lint. No Accept “AI-likely %” gate. No Sparks backfill.

### Ranking-first bands + local sources (2026-09) — pipeline lever (grade pending re-score)

- Homepage encyclopedia kept; service cost/DIY/permits **rotate** per FILE (coverage `min(2, n)`).
- City context + field research require public citations; location near-duplicate / stitch lint tightened.
- Detector pack shipped in the following History entry.

### Eight-pass Soft path (2026-08) — pipeline lever (grade held **B+**; operator consistency ↑)

- Soft steps: Structure → Field research → Brief → Outline → batched Full write → Humanize → Final check → Accept (no Skip)
- Prompts: `content-guardrails.md`, `content-field-research.md`, `content-brief.md`, `content-final-check.md`; editor pack Passes 4–7
- Accept gates: field research loaded, brief confirmed, `lastFinalCheckAt`, speech clear

### Local-depth forever (2026-08) — pipeline lever (grade pending re-score)

- `ops/lib/city-context.mjs` — cached city briefs for primary + suburbs
- Full-write / Structure prompts embed briefs as reference-only
- Accept enforces location depth uniqueness; materials soft lint for concrete methods

### Baseline (pre ranking-wins) — Overall **B−**

| Dimension | Grade |
| --- | --- |
| Helpful content depth | B+ |
| On-page SEO scaffolding | B |
| Human readability / speech | B |
| Keyword / SERP precision | C+ |
| E-E-A-T / trust depth | C |
| Internal linking / topical cluster | C+ |
| Operator consistency | C+ |

Strong enough for soft–mid local SERPs with **Preset C + Outline + Editor**; weaker at forcing the winning page every time without keyword/PAA enforcement and Accept gates.
