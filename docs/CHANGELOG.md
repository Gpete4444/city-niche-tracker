# Rover changelog

## Unreleased

## Version 2.2 (`2.2.0`)

Concurrency defaults, a Website write lock, Launch that does not freeze other tabs, and a recoverable GSC sync:

- **Concurrent Limit defaults:** Light SERP, Generate pack, Heavy (Prepare / Launch), and assembled previews default to **5**. Generate pack and assembled previews are now Settings rows (pack max 10, previews max 8). Extra Generate packs on *different* batches pop the limit; the same batch is still one at a time. Preview pool size follows Settings, not only `ASSEMBLED_PREVIEW_SLOTS`.
- **Website write lock:** Two Rover tabs can open the same Website candidate to watch, but only one can save (grades, photos, Site-Config, Visual Edit, Accept). The other tab is read-only until the editor closes, the lock expires (~15s), or you **Take over**. The lock applies only to that same row — a tab on a different candidate can still Run launch / Prepare / Push. Hard-refresh every open tab.
- **Launch does not freeze Rover:** GitHub push and Wrangler deploy use async spawn (same as npm build). Other tabs stay clickable and reloadable while a site ships.
- **GSC sync:** Token refresh is single-flight. A revoked Google login clears tokens, stops the batch, and asks to **Reconnect GSC** once instead of failing every site. 400s include Google’s reason; unverified properties say so; property match is exact Domain / URL-prefix only.
- **Regression:** `scripts/test-concurrency-settings.mjs`, `scripts/test-website-write-lease.mjs`, `scripts/test-ship-async-spawn.mjs`, `scripts/test-gsc-sync.mjs`.

## Version 2.1 (`2.1.0`)

Dashboard stays clickable during photo generate, and live sites follow a consistent indexing URL policy:

- **Concurrent work:** OpenAI Review generate (and Photo library generate) enqueue as light jobs and return immediately (HTTP 202). Extra stills and before/after pairs **queue globally** at the Concurrent Limit boxes — including across tabs and candidates — instead of holding Chrome’s six connections. Accept, logo, coverage map, and Pull photos also return 202. Image generate + JPEG persist run in a forked worker so the dashboard stays clickable. One `/api/jobs/stream` EventSource replaces the two Heavy/Light streams. Hard-refresh every open Rover tab.
- **Live URL policy:** Trailing slashes on every HTML path (`/about/`, `/services/{slug}/`). Coverage-map cities without a real location page link to `/contact/` — they never invent `/locations/{slug}/`. The Worker **301s `http://` → `https://`** and slashless paths; `*.workers.dev` sends `X-Robots-Tag: noindex`.
- **Launch HTTPS:** Cloudflare launch turns on Always Use HTTPS, Full SSL, and HSTS when the token can edit zone settings (soft-skip otherwise), and attaches **www** plus apex to the Worker.
- **Sitemap:** Pipeline always emits `sitemap.xml` (`src/integrations/ensure-sitemap-xml.mjs`).
- **Regression:** `scripts/test-openai-generate-jobs.mjs` (202 enqueue + global caps). `scripts/test-gsc-url-policy.mjs` (trailing slash + coverage-map hrefs). Concurrency tests cover the unified jobs stream.

## Version 2.0 (`2.0.0`)

Leaner Rover process and dashboard payloads, plus Research **Run all** and a 15-mile service-area default:

- **Shared Census map cache:** Map and service-area load `places.geojson` / `counties.geojson` once per process (`ops/lib/census-map-layers.mjs`) instead of each keeping a parsed copy.
- **Candidate list:** `GET /api/candidates` uses a 10s write-invalidated cache and slim list `meta` (no logo/coverage variant blobs). Twilio provision dates come from a separate `sites.json` index so the list path does not cycle through full candidate loads.
- **Lazy candidate detail:** Opening a candidate loads a shell; Content, Launch, Site-Config, and Prospects fetch only their slices. POST responses return a shell; the dashboard merges and refetches the open tab.
- **Phone:** Call JSONL is cached by file mtime/size. Recording playback streams instead of buffering the full MP3.
- **Preview hygiene:** Rover shutdown stops template `:4321` and assembled preview children. Idle assembled previews evict after 15 minutes. Default preview pool is 2 slots (`ASSEMBLED_PREVIEW_SLOTS`).
- **Job memory:** Eval script logs are capped; finished Heavy/Light `result` objects drop after 60s. Finished script jobs keep the last 20.
- **UI stay-alive:** Accept, photo-group Load, and image copy yield the event loop so SSE and clicks are not blocked for the whole copy burst. Accept is exclusive per candidate.
- **Run all:** In Anthropic API mode, Research **Run all** fills missing Evaluations 1–4 in order (Live ads; no forced SERP). Stops if Narrative still needs Accept. Copy & paste hides the button.
- **Photo groups:** Load lists groups for this candidate’s niche (plus already-attached ids), not the whole library.
- **Service area:** Default radius is **15 miles** (was 40). Max selectable radius is 100. Map city toggles show a busy spinner while the polygon updates.
- **Status banner:** Top-center complete/fail banner is larger and supports ok / warn / error tones.
- **Env example:** Keys grouped by pipeline stage. Image source vars are uncommented placeholders.
- **Regression:** `scripts/test-candidate-memory-pass.mjs` (list cache, slim meta, slices, shared GeoJSON). `scripts/test-photo-groups-detail-filter.mjs` (niche filter). Concurrency tests cover Accept-already-running.

## Version 1.9 (`1.9.0`)

Loading chrome cleanup, Discovery API one-button, Concurrent Limit, Flux removal, and Review images:

- **Loading chrome:** Removed the full-width header progress strip and the Heavy / Light buttons. Help stays. Heavy/Light job streams still sync overlays on another tab for the same candidate. Prepare preview and Push updates use the same viewport card as Run launch. Light SERP, Find addresses, GSC, Research, Open assembled preview, and Revert keep in-page bars.
- **Discovery API:** Generate Discovery pack creates the pack and runs Claude in one click (confirm cost, then the overlay). Sidebar step 2 is hidden. Light SERP is step 2. Re-run Generate pack sits under Step 1 when a batch is selected. Copy & paste still has Send to Claude + Import.
- **Launch / Heavy jobs:** Launch returns immediately (202 + jobId) like Prepare, so a second Launch is queued right away. The job card dims the workspace under the top bar.
- **Review images header:** The Images loading strip no longer appears when you open another Website step or the pane re-renders. It still shows for Pull, generate, See More apply, Load/Save photo group, import, upload, and tray Use.
- **Many Rover tabs:** Only the tab that holds Heavy/Light streams polls those APIs. Extra tabs listen over BroadcastChannel (and poll only if that snap goes stale), so Launch on one tab no longer freezes the others on Chrome’s six-connection cap. The same-candidate overlay still paints. Hard-refresh every open tab after this change.
- **Coverage map labels:** Location-page cities (primary + targetSuburbs) are never dropped as area outliers, so a metro of tiny also-served towns no longer hides Cedar Rapids-sized page cities from the map.
- **Service process photos:** Review `svcProcess` slots use the same process H2 match as the site (“Our Repair Process”, “Our … Approach”, “How we …”, and “how the process works”), so How it works cards are not left without a slot to fill.
- **Preview sections:** Card grids pick a column count that divides the item count (no empty last-row cells). Six process steps stay 3×2; two materials cards stay two columns. Process blurbs render as sentences (capital, period). Timeline stages strip leftover `**` markdown, unpack packed `**Job** —` chains into separate stages, and clean stray `— ,` after duration chips.
- **See More apply:** Clicking a still or pair closes the picker immediately, then shows Images loading and the slot overlay on that Review (or Photo) card so apply is visible and the picker cannot keep receiving clicks.
- **Review images filters:** Empty (and Poor / Ok / Good / Uploaded) counts and the visible grid update as soon as a slot is filled or graded — See More, Re-pull, Upload, generate, and the match-grade dot no longer leave a stale Empty list.
- **See More loaded groups:** Review images Load now writes the same photo-group sidecar as Content attach, so See More, rank dropdowns, and the next Accept follow the groups you just loaded (including a newly ranked first group). See More lists applied `photoGroupIds` from the images manifest when present, so a site that already loaded stays in sync without a second Load.
- **Review images loading:** Cycling a match-grade dot no longer leaves a stuck slot loader (settle re-finds the live card; grade patches one card). Import, Load/Save photo group, See More, tray Use, and opening the grid show the Images loading strip. The Photo groups menu closes when the pointer leaves it.
- **OpenAI prompt editor:** Every Review and Photo still and before/after slot has a Prompt dropdown. Edits apply to both Copy prompt and OpenAI generate. Restore returns the canonical prompt. Commercial services are staged in commercial buildings (not homes); commercial BA slots skip stale Image-queries living-room text until a new paste.
- **Photo group trays:** Load matches materials/process by title across home and services (Moisture-resistant board on every board slot, not primer-sealer). Empty slots take the first tray still as live; extras stay on the tray. Opening Review images heals unlaunched sites the same way. **See More** on Review and Photo trays opens stills from the loaded / open group to swap onto that slot. Before/after slots have the same button; the picker lists only BA pairs from those groups. Search titles in that picker to hide non-matching stills. Hover a thumb for the same large preview as Review slots. Review images has the same title search in the toolbar; the selected-images OpenAI generate button stays compact. Review **Photo groups** is a compact menu (Save, ranked dropdowns, Load); the bulk Pull / Re-pull photos button is gone (per-slot Re-pull remains).
- **Decisions persist:** Rover boot no longer resets operator maybe / pursue / pass to the score Recommend. Other Chrome tabs pick up decision and named-group changes without a refresh.
- **Write site Polish:** Prose em dashes are auto-fixed (comma or period; numeric ranges become en dashes). Structured `**Label** —` bullets stay. Write site no longer fails Polish on leftover `em_dash` findings.
- **Write site Image queries:** Agent prompts accept Windows (CRLF) line endings. Parallel Write site jobs no longer fail at Image queries with `missing text block: content-image-queries.md`.
- **Boot overlay:** The loading card hides once the dashboard can render. API Cost wallets (including Apify all-time spend) no longer block first paint; opening the API Cost menu still refreshes them.
- **Flux generate removed:** Review / Photo no longer generate on fal.ai. Existing Flux image files stay on disk unlabeled (no Flux badge or filter). OpenAI generate spans the full slot row. Settings and API Cost drop Flux / fal remaining. The fal-low-budget popup is gone.
- **Concurrent Limit:** Settings (gear) has one group of boxes, in pipeline order: Light SERP, Evaluations, Write site, OpenAI photos, OpenAI before/after, Heavy (Prepare / Launch). Each row is marked **D** / **R** / **W** in Space Grotesk using theme ink (Light 1–4 / Dark 5–8). Hover a box for its hard max. Selecting or starting more than a box shows the same limit popup (raise that row in Settings, or wait / select fewer). **OpenAI photos** is the exception — extra stills queue in the background. Light SERP queues extra cities inside a Run and only pops up if another Run would exceed the box. Heavy no longer silent-queues extra Prepare / Launch. The Research legend Concurrent box and Jobs K are gone.
- **Top nav:** The header (stages, Help, API Cost, Settings) stays at the top while the page scrolls.
- **Write site:** Up to six **Write site with Claude** jobs can run at once (different candidates). The same candidate still cannot start a second Write site. Anthropic `429` / `529` retries with backoff. Generate pack stays one at a time.
- **Top nav:** Tight headers keep Help on one line (?) so it is not clipped at the top. Stage labels never wrap (no number above the name). Compact `1-D` / `2-R` / `3-W` / `4-L` follows the header width, not the window, and all four switch together. Map / Photo / Phone drop to icons so they do not overlap Help.
- **Run Narrative:** Anthropic API mode can run Narrative on a multi-select (one at a time, cost confirm first), same as Enrich. Copy prompt / Claude.ai paste stays one candidate.
- **Research table:** `{id}-images-plan.json`, `{id}-ba-variants.json`, and `{id}-photo-group.json` belong to the real candidate. They no longer show up as blank Research rows. Leftover phantom `.meta.json` files for those aliases are dropped; the sidecar JSON is kept.
- **Stage 1 cluster:** Discovery suburb lists like `Goodyear, Litchfield Park, Tolleson` become `City,ST` before SERP/Volume. Already-promoted configs are healed on the next research run. Failed batch jobs show the last script error, not only `Exit code 1`.
- **Generate pack:** Discovery API pack uses low Claude effort, a CSV-fence prompt (not the Claude.ai file protocol), and a shorter known-markets list so Calling Claude finishes sooner. Write site stays medium effort. Incomplete (truncated) CSVs fail instead of importing a partial table.
- **Accept / Launch overlay:** Accept content, Run launch, Prepare preview, and Push updates use the same Rover loading card as Write site with Claude (wordmark, phase chips, progress bar). No Stop — those jobs run until they finish.
- **Materials rows:** Writer prompts ask for 3 or 6 option cards (never 4–8). Load / Stage / Assemble drop leftover bullets and `materialsImages` so the 3-wide grid has no hole. The template also hides extras on the next assemble.
- **Review BA grades:** Before/after cards count in All / Poor / Ok / Good / Uploaded / Empty (and Stock / OpenAI). Each pair shows the same color dot and source badge as photos. Filled generated or loaded pairs start as Ok; Import pair is Uploaded; incomplete is Empty. Click the dot to set Poor / Ok / Good.
- **Review lag:** Opening Review no longer SHA-hashes trays on every status poll. OpenAI generate (and Use) replace only the finished card instead of rebuilding the whole grid. More RAM or a future installer does not fix this — generate still shares Rover’s Node process.
- **Tray Use:** Look up the clicked thumb by the card’s `matchKey` (and before filename / photo filename if the pair id or slot list misses). Hide before/after tray thumbs whose files are gone. Live BA matching stays digits-only (`svc-ba-{slug}-{n}`), so similar `pg` / `var` copies stay on the tray.
- **Photo groups:** Load puts unused photos with similar titles on the best matching slot’s tray. Service before/after pairs also go onto **every** similar service tray (not only one best name), still never as live. Click Use to apply, including on empty slots. Refresh does not fill trays — Load again on Review images.
- **Homepage YAML:** Process `image:` keys use each list item’s indent (not a hardcoded 4 spaces). Load, Stage, and Assemble pull over-indented `image` / `src` / `alt` back so Prepare preview can parse homepage frontmatter.
- **Image trays:** Do not keep duplicate photos or before/after pairs (same `photoId` or file bytes). Ranked photo-group leftovers skip copies of the live slot or an existing tray item; opening Review images or Photo compacts leftover 8-copy grids and unlinks extras.
- **Header loading strip:** Removed. Local progress (Pull, BA search, generate, Light SERP) stays on the step. Overlay jobs no longer leave a full-width bar under the nav.
- **Photo groups:** Rank as many saved groups as you need on Content Load photo group and Review images. Start with one dropdown; a new row appears after each pick. The 1st fills matching slots; later groups fill leftovers; leftover matching photos (and before/after pairs) go into that slot’s tray (cap 8). Load needs at least one group. Skip on Content is unchanged.

## Version 1.8 (`1.8.0`)

Anthropic API pipeline, Write site JSON budget, and Census coverage maps:

- **Anthropic API:** Copy & paste vs API mode; `ANTHROPIC_WORKSPACE_ID` on Messages; default model `claude-sonnet-5` at medium effort; omit temperature for Sonnet 5; cost rates $2 / $10 per MTok.
- **Site-Config (API):** Suggest domains (one button); **Fill site-config** for steps 4–5; paste mode unchanged.
- **Write site:** Brief `pages[]` uses 32768 `max_tokens`; other Write steps 16384; truncated JSON surfaces a retry error (field research already saved).
- **Coverage map:** Census place polygons first; Nominatim fallback skips parks/counties and axis-aligned bounding boxes; drop polygons >12× median area.
- **GBP:** Category checklist prompt removed.
- **Save photo group:** No launched-site confirm — save copies into the photo library only (Load / Attach still ask).
- **Map fills:** Leaflet MultiPolygons (Fuquay-Varina and other annexation islands) explode into separate polygons so the main body fills instead of outline-only fragments. One label per city.
- **Launch:** Step 4 includes Business name (written into site-config on Run launch). Step 5 Indexing has Copy URL for the live homepage.
- **Photo groups:** Load up to three ranked groups on Content step 9 and Review images. The 1st fills matching slots; the 2nd and 3rd fill leftovers; leftover matching photos (and before/after pairs) go into that slot’s tray (cap 8). Load needs at least one group. Skip on step 9 is unchanged.
- **Logo:** Accept generates Mark + text (falls back to Monogram if OpenAI is not configured). Logo prompt is a collapsed editor on Logo & Map. Previous logos sit in a tray of 4.
- **Coverage map:** Previous maps sit in a tray of 2.
- **Content Load:** Invalid homepage YAML fails Load with the file named (tabs and list indent are healed first). Service intro H2s that match the unmarked-intro pattern are stripped; reversed permit `###` columns are swapped so needs-permit is first.
- **svcIntro:** Registry/outline treat service intro as unmarked body, not an H2.
- **Full write:** Missing files starts collapsed; click the summary to expand.
- **Full write:** Open Claude.ai sits next to Copy Home, Copy Services, and Copy Locations batches.
- **API Cost PAYG:** Anthropic, OpenAI, and Google Maps show Rover-recorded Spent and **PAYG** for Balance (not a spanning Pay as you go label).
- **Launched table:** Header is **State** (was ST). **Map** after State opens the Map tab zoomed to that city, same as the candidate table.
- **Table Live + W:** Opening a candidate (or finishing Launch) copies launch meta onto that table row so Live, Type, and W match the pane without a hard refresh.
- **Shift+click:** Range select always includes the box you click (file-explorer style). A follow-up native `change` no longer unchecks that endpoint — Review, Photo, candidate table, and Discovery (grid order, including Before & after).
- **OpenAI generate:** Photos still run 5 at a time. Before & after pairs run 2 at a time (each pair is two API images). Rate-limit waits 15s / 30s / 60s so a full batch can finish. Failed slots list in a modal. Same price per image.
- **Selected images row:** Count, Unselect all, then Stock / OpenAI filters (with selected counts) sit left of a rule. Generate, Re-pull, and OpenAI sit right. Photo tool uses the same grouping without Re-pull or source filters.
- **Detail shelf:** Expand sits on the right of **2 · Review images**. That header plus the Review images toolbar stay frozen while slots scroll. Expand (chevrons-left) slides the sidebar over the table; Collapse (chevrons-right) or leaving the step returns the split.
- **Slot loaders:** OpenAI generate shows as generating (not queued). Re-pull, OpenAI, and Pull use a full-thumb dimmed overlay so the Rover loader is visible on empty slots.
- **Live slot loading:** Re-pull, OpenAI, and Pull paint each Review (and Photo) slot as soon as that image exists. The card loader stays until the thumb is in the DOM — not until the whole batch finishes.
- **Review images Select / Re-pull:** Poor, Ok, Good, Uploaded, and Empty each have Select (toggle that grade). Re-pull sits on the selected-images row before OpenAI and applies to checked photo slots.
- **Photo group dropdown:** Content step 9 and Website Review images list every saved group and master, A–Z (not filtered to this candidate’s niche). Load/attach works across niches.
- **Content next step:** After Humanize, current/open/strip stay on Final check (then Image queries → Load photo group → Accept). Load FILE no longer jumps to Accept while 7–9 are still open.
- **Structure C:** Preset C checks every page and section except Deep offer process, including Location pages and every Include photos box.
- **Service area pop filter:** Min pop / Max pop inputs sit on the radius row (same pattern as the Map tab). Empty max means no cap. Primary city stays selectable.
- **Service area loading:** Opening the Site-Config Service Area step shows the Rover loading card over the map and sidebar until cities are on the map and clickable. Accept/save still uses the existing progress bar.
- **Service area sidebar:** Map-open layout keeps the detail panel as a flex column so the tab body scrolls instead of clipping.
- **R / W headers:** Evaluation and Website Track columns are labeled **R** and **W** in Space Grotesk (same type as the header stage names). Hover tips unchanged.
- **Track tabs:** Site-Config, Content, and Launch are separate pills, colored like Evaluations 1–3 (and the table Track icons).
- **Website Track column:** Numbered circle after Evaluation for Site-Config / Content / Launch (same 1–3 colors). Empty until track 1; launched rows show 3.
- **Candidate table LIVE + Type:** Green live badge after the checkbox on launched rows only. **Type** after API $ is Discovery / Research / Website / Launched.
- **Prospects job close:** Light ticks on `Maps SERP` (not stuck at Starting). Script no longer dumps the full JSON to stdout. If the child exits non-zero after writing `{id}-prospects.json`, Rover still sets `lastProspectsAt`.
- **User + Dev guides:** [USER-GUIDE.md](USER-GUIDE.md) is the operator manual (what you see and click). [DEV-GUIDE.md](DEV-GUIDE.md) maps every pipeline component to files. Header **Help** opens a searchable User guide panel.

## Version 1.7 (`1.7.0`)

Jobs lists, preview progress, coverage map callouts, and pipeline persist:

- **Service process headings:** Classify “Our {service} Process”, “Our … Approach”, and “How we …” as `process` (numbered step cards). Generic service lists parse `**Title** — detail` instead of showing raw markdown.
- **Indexing Mark done:** Persists on candidate meta (`indexingDone` / `lastIndexingAt`). Reload, re-select, and Push updates do not uncheck it.
- **Coverage map:** Callout chips sit in a gutter outside city outlines; smaller cities paint on top and stay clickable; Also serving always ends with “and others.”
- **Prepare preview bar:** Determinate 5-step bar (Staging → preview) on the waiting tab and Website Prepare step, same n/total pattern as Launch.
- **Heavy / Light Jobs:** Header has **Heavy** (assemble / preview / prepare / launch / ship) and **Light** (Accept, logo, coverage map, pull photos, SERP / Enrich / Prospects). Each row has its own step bar (`detail n/total`). Two or more in-flight jobs show a header summary instead of overwriting one strip.

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
