# Rover changelog

## Version 1.4 (`1.4.0`)

Site-Config **Address** finder (LoopNet + Places) and related operator UX since 1.3:

- **Recommended vs Secondary:** Places-clean streets whose Maps locality matches the target city stay Recommended; suburb mismatches (e.g. Kearns / West Valley vs Salt Lake City) land in Secondary, with Geocoding + retier API for existing shortlists
- **Pull budget:** First LoopNet pull defaults to 200/URL; Fetch deeper +100; per-city moving ceiling starts at 500/URL, doubles on confirm (absolute 2000/URL); UI shows total listing budgets (× search URLs), not confusing “per URL” depth
- **Exhausted cache:** Fetch deeper confirms lead with 0-left warning — re-scrapes from the top, may add few/no new streets, Apify billable — before ceiling-raise / budget details
- **Address step UI:** Compact layout (no long blurb / Cache exhausted box / duplicate inventory); Last search is Result + Cost with funnel under Technical details; LoopNet link beside Maps / Street View
- **Maps / Street View links:** Prefer geocoded lat/lng; never put STE-* suite stubs in Maps search (avoids wrong Places matches); Street View uses `maps?q=…&layer=c` (no black `map_action=pano` links)
- **Inventory / deepen:** City-cache inventory progress, Fetch deeper when 0 left, Manual commercial / recover / Use anyway paths documented in USER-FLOW and ENV-SETUP (Geocoding API required for locality tier)

## Version 1.3 (`1.3.0`)

Debiased demand scoring and tighter Discovery / Research operator UX since 1.2:

- **Debiased demand (rubric v4):** Score on `demandVolumeSum = primary + α × suburb` (α = 0.25); bands low &lt;60 / mid 60–180 / high 180–400 / very_high ≥400. Primary and Cluster sums stay display-only; Keywords + Overview show **Demand (scored)**
- **Discovery Claude pack:** Compact High-Ticket catalog in the pack; slim CSV columns; `suggested_suburbs` prefer 3–5 (pain/services stay ≤3)
- **Research UX:** Permanent delete with two-step confirm; Shift+click checkbox ranges; State before Suburbs; state dropdown no longer capped at 20
- **Docs:** Demand-volume decision + Ads-vs-Research volumes Word docs; scoring-rubric overlap guidance (cluster sum double-counts metro demand)

## Version 1.2 (`1.2.0`)

Operator UX and decision/map reliability since 1.1:

- **Tables:** Content-fit column widths with session drag-resize; Batch/Notes default ~14ch; Discovery Notes match; stage progress column; freeze strip; Homepages/Subpages centered
- **Research filters:** Compact Find + Selection/Decision/Groups accordion (manual open only; no auto-toggle; no deselect on accordion/toolbar chrome)
- **Stages:** Always-visible Stage 1–4 boxes (actions disabled until selection) to stop table jump
- **Short viewports:** Page scroll unlocked on Discovery / Research / Website Builder / Launched Sites / Phone when the window is short or narrow
- **Decisions:** Score-based recommend (pursue ≥7 / maybe 6–7 / pass &lt;6); Discovery stays review until Research stages 1–3; migration helper on startup
- **Map:** Fix *City place names (Park City, etc.); St/Mt/Ft aliases; safer Show matching; selection label beside Reset

## Version 1.1 (`1.1.0`) — continued

### Structural Openness

- **Structural Openness:** Stage-1 competition uses structural blue-link Openness; Stage 2 preserves that score; Domain Rank stays on Displaceability only (rubric v3).

### Earlier 1.1

Pipeline and Rover dashboard improvements for parallel work and clearer operator feedback:

- True parallel **Prepare preview** via heavy jobs + worker staging (Jobs K pool)
- In-step Prepare progress bar (no false green check while running)
- Launch-content gaps preflight; join existing Prepare job on 409
- Launched-site edit guard + **Revert** from GitHub Ship
- Restore fidelity for confirmed Structure / image slots / locations
- Operator cadence, env setup, GSC/metrics, and related docs
