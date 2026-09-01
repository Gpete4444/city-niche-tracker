# Rover changelog

## Unreleased

## Version 1.6 (`1.6.0`)

Photo library, Flux/OpenAI generate, launch step progress, and Review image trays:

- **Photo library:** New Map / Photo / Phone tool tab for niche masters and named groups; Accept can attach or Skip
- **Flux + OpenAI generate:** Per-slot and bulk generate on Review images and Photo; OpenAI pair for before/after; tray keeps 8
- **Review images:** Click-to-cycle match grade; compact slot overlay loader (rings on black square); stock Re-pull archives the live photo onto the tray
- **Logo:** Mark / Mark + text / Monogram; GPT Image 2 for mark modes
- **Launch:** Determinate bar `Launching N / total` from real GitHub / build / deploy / CF steps (same for Push updates)
- **Revert:** Collapsed by default (click header to expand)
- **Nav:** Tool order Map, Photo, Phone with theme-colored icons
- **Themes:** Theme 1 is Blue (default); Theme 2 is Teal
- **Address Maps / Street View:** Pin `maps/?q=lat,lng`; Street View via official `map_action=pano&viewpoint=` from stored coords
- **Content / map:** Coverage map and content-pass / auto-fix / image-query pipeline updates; service-area map polish

## Version 1.5 (`1.5.0`)

Address Find operator controls, theme system expansion, Phone layout, and Research/Website spend visibility:

- **Address Find caps:** Clean target + Pull size inputs on Site-Config Address (browser localStorage); stop Places after N cleans; pull size drives Apify maxItems
- **Address Find UI:** Drop inventory % bars; replace Technical details with closed Cost dropdown (estimate note + Apify prepaid text); rename to **Pull target**
- **Address active listing gate:** Places rejects only **OPERATIONAL** Maps listings locked to street+ZIP (not temp/permanent closed); fail copy `active Maps listing`; legacy `existing Maps business` cache keys re-screen on Find
- **Address metro + wrong-state:** Hard rejects outside candidate state / metro radius; recover and Use anyway respect locality
- **Address 40-listing batches:** Find / Fetch deeper default pull **~40 listings** total (LoopNet 20/URL ×2, Crexi 40; deepen +20/+40); Places budget default stays 40
- **Address sources:** LoopNet and Crexi toggles (run either or both); shared city cache with per-source pull budgets; `APIFY_CREXI_ACTOR_ID` + Settings greens; listing links labeled by portal
- **Per-source inventory UX:** LoopNet and Crexi inventory/budget lines; Fetch deeper / exhausted modals only for checked sources
- **Recommended tier:** Listing city must match the target; Crexi links normalized to `crexi.com/properties/{id}`
- **Themes 1–8:** Light 1–4 (Teal, Blue, Sage, Warm) and Dark 5–8 (Dark Teal, Slate, Amber, Forest); settings picker with Light | Dark columns; one-time localStorage migrate; logo + stage arrows follow dark themes 5–8
- **Theme accents:** Active stage pill, healthy DFS chip, and Launched|Phone separator use theme `--accent` / `--chip`
- **Stage arrows:** PNG light/dark pipeline arrows between Discovery → Research → Website → Launched
- **Phone detail:** Far-right call detail column always visible (empty state when no call selected)
- **API $ column:** Research / Website candidates table shows summed `lastCosts` with pipeline-ordered breakdown tip
- **Backfill Light SERP → Research:** Discovery toolbar copies batch Map Pack / homepage counts onto existing Candidate seeds (no DFS)
- **Research Light SERP seed:** Process copies Discovery Map Pack / homepage / subpage counts onto Candidates for the Research table until Eval 1 · SERP / Volume
- **Discovery Decision `ignore`:** Process marks the row done without Candidates or anti-dupe; sidebar Decision meanings legend; table column renamed Human → Decision
- **Discovery Est. MSV:** Claude fills `Est. Monthly Search Volume` for Discovery triage only — not seeded into Research
- **Discovery Niche head terms:** Suggested/OPEN expand to high-volume head-term Niche cells; **Required** still locks exact Niche text
- **Discovery anti-dupe:** Generate Pack skips archived Candidates; Advanced sidebar to edit/wipe the do-not-repropose list
- **Protection:** Website/Launched Candidates cannot be permanently deleted (Delete permanently, known Remove, wipe) — server returns 409
- **Do-not-repropose editor:** Advanced list shows tracked/orphan pairs + Research Eval 1 only
- **Evaluation order:** Enrich requires SERP/Volume; Narrative requires Enrich; Prospects requires Narrative (UI + API)
- **Vocabulary:** Top nav Stages `1 Discovery → 2 Research → 3 Website → 4 Launched` then Phone · Map; Research Evaluations; Website Tracks 1–3
- **Docs:** Operator work-flow + naming charts ([ROVER-FLOW.md](ROVER-FLOW.md)); USER-FLOW / ENV-SETUP Address updates

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
