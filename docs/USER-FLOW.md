# Rover — from discovery to launch

A plain-language map of what you do in Rover, with **time estimates** for each step.

**Operator manual (screens and buttons):** [USER-GUIDE.md](USER-GUIDE.md) — also in Rover via header **Help**.  
**Engineers:** [DEV-GUIDE.md](DEV-GUIDE.md).

**How this guide is organized**


| Name          | What it means in Rover                                       |
| ------------- | ------------------------------------------------------------ |
| **Stage**     | Top-bar pipeline: 1 Discovery → 2 Research → 3 Website → 4 Launched |
| **Evaluation**| Numbered checklist inside Research (SERP/Volume → Prospects) |
| **Track**     | Numbered checklist inside Website (Site-Config → Content → Launch) |
| **Step**      | A numbered item inside a Discovery flow, Evaluation, or Track |
| **Screen**    | A top-bar destination (includes satellites Phone · Map · Photo) |
| **Panel**     | A work area on a candidate’s detail side                     |

Visual overview: [ROVER-FLOW.md](ROVER-FLOW.md) (work-flow chart + naming hierarchy).


```text
1 Discovery → 2 Research → 3 Website → 4 Launched · Phone · Map · Photo
```

Most markets die early on purpose. Only **pursue** rows become **Website Candidates** and get a full site build.

---



## Time estimates (happy path)

**How to read this:** an experienced operator’s **active** time on most Rover steps is a click, paste, or quick skim — often **under 10 seconds**. Wall-clock is dominated by **waiting** on Claude, DataForSEO, assemble, and ship — not by hunting through the UI.

Assumptions: you know the product, reuse defaults / Preset C, trust Claude after a short skim, no major retries, one ~40-row Discovery batch, then **one pursue** site to live. “You” = hands-on time. “Waiting” = Claude / APIs / local build while you can switch away.


| Step                                                     | You (active) | Waiting (Claude / APIs) | Wall-clock      |
| -------------------------------------------------------- | ------------ | ----------------------- | --------------- |
| **Discovery**                                            |              |                         |                 |
| New Discovery Pack (filters → Generate)                  | ~30–60 sec   | —                       | ~1 min          |
| Send to Claude (download + copy prompt)                  | ~10 sec      | ~8–12 min (pack)        | ~10 min         |
| Import Claude CSV                                        | ~10–15 sec   | —                       | ~15 sec         |
| Light SERP (batch)                                       | ~5 sec       | ~1–3 min                | ~2 min          |
| Decisions (Accept all + quick skim)                      | ~1–2 min     | —                       | ~2 min          |
| Process batch                                            | ~10 sec      | ~15–30 sec              | ~30 sec         |
| **Discovery subtotal (once per batch)**                  | **~3 min**   | **~11 min**             | **~15 min**     |
| **Research** *(per pursue candidate)*                    |              |                         |                 |
| Overview — glance scores                                 | ~10–20 sec   | —                       | ~20 sec         |
| 1 · SERP / Volume — run Ad volumes                            | ~5 sec       | ~1–3 min                | ~2 min          |
| 1 · Keywords — glance volumes                            | ~10–20 sec   | —                       | ~20 sec         |
| 2 · Enrich *(optional; skip if not needed)*              | ~5 sec       | ~1–2 min                | ~2 min          |
| 3 · Narrative — copy → Claude → Load → Accept            | ~30–45 sec   | ~3–5 min                | ~5 min          |
| Set decision to **pursue**                               | ~5–10 sec    | —                       | ~10 sec         |
| Prospects *(optional — not in totals)*                   | ~30 sec      | ~1–3 min                | ~3 min          |
| **Research subtotal** *(incl. Enrich)*                   | **~2 min**   | **~8 min**              | **~10 min**     |
| **Research subtotal** *(skip Enrich)*                    | **~2 min**   | **~6 min**              | **~8 min**      |
| **Website · Site-Config Track**                        |              |                         |                 |
| 1 · Colors & fonts (pick + Apply)                        | ~10–20 sec   | —                       | ~20 sec         |
| 2 · Address (Find + pick, or Skip)                       | ~15–30 sec   | ~30–60 sec if Find      | ~1 min          |
| 3 · Business details (name / domain / NAP)               | ~30–60 sec   | —                       | ~1 min          |
| 4 · Paste & edit draft (Claude site-config)              | ~20–40 sec   | ~2–4 min                | ~4 min          |
| 5 · Review services → Accept                             | ~10–20 sec   | —                       | ~20 sec         |
| 6 · Service area (confirm)                               | ~15–30 sec   | —                       | ~30 sec         |
| 7 · Provision phone (or Skip)                            | ~10 sec      | ~15–30 sec              | ~30 sec         |
| **Site-Config subtotal**                                 | **~3 min**   | **~4 min**              | **~7 min**      |
| **Website · Content Track**                            |              |                         |                 |
| 1 · Structure (Preset C)                                 | ~5–10 sec    | —                       | ~10 sec         |
| 2 · Site research (copy → Claude → Load)                | ~20–30 sec   | ~3–6 min                | ~5 min          |
| 3 · Content brief (copy → Claude → Load & confirm)       | ~15–25 sec   | ~2–4 min                | ~4 min          |
| 4 · Outline (copy → Claude → Load & confirm)             | ~20–30 sec   | ~3–5 min                | ~5 min          |
| 5 · Full write batched (Home / Services / Locations)     | ~40–90 sec   | ~12–22 min              | ~18 min         |
| 6 · Humanize (editor pack + Speech/SEO)                  | ~20–40 sec   | ~3–8 min                | ~6 min          |
| 7 · Final check (copy → Load OK / FILE fixes)            | ~10–20 sec   | ~2–4 min                | ~3 min          |
| 8 · Image queries                                        | ~20–40 sec   | —                       | ~30 sec         |
| 9 · Load photo group (optional; Skip if using queries)   | ~5–10 sec    | —                       | ~10 sec         |
| 10 · Accept content (+ photo group or stock pull / logo / map) | ~5–10 sec | ~1–3 min             | ~2 min          |
| **Content subtotal**                                     | **~3 min**   | **~30 min**             | **~43 min**     |
| **Website · Launch Track**                            |              |                         |                 |
| 1 · Logo & Map (glance; skip if Accept already wrote them) | ~10–20 sec | —                       | ~15 sec         |
| 2 · Review images (glance; skip polish)                  | ~20–40 sec   | —                       | ~30 sec         |
| 3 · Prepare preview (Stage + Assemble)                   | ~5–10 sec    | ~2–4 min                | ~3 min          |
| 3 · QA preview (spot-check key URLs)                     | ~1–2 min     | —                       | ~2 min          |
| Buy domain + point NS at Cloudflare                      | ~3–5 min     | —                       | ~5 min          |
| Create Web3Forms form (Recipient = leads@) + paste key    | ~30–60 sec   | —                       | ~1 min          |
| 3 · Run launch (paste keys + Auto ship)                  | ~30–60 sec   | ~3–5 min                | ~5 min          |
| Verify Gmail + smoke-test form                           | ~1 min       | *(email may lag)*       | ~1–2 min        |
| **Website / Launch subtotal**                            | **~8 min**   | **~7 min**              | **~15 min**     |
| **Launched**                                       |              |                         |                 |
| First touch — rent / links (optional same day)           | ~20–30 sec   | —                       | ~30 sec         |
| **Launched subtotal**                              | **~30 sec**  | **—**                   | **~30 sec**     |
|                                                          |              |                         |                 |
| **Total — Discovery batch (once)**                       | **~3 min**   | **~11 min**             | **~15 min**     |
| **Total — one pursue site (Research → live, w/ Enrich)** | **~15 min**  | **~39 min**             | **~55 min**     |
| **Total — one pursue site (skip Enrich)**                | **~15 min**  | **~37 min**             | **~53 min**     |
| **Total — batch + first pursue site**                    | **~18 min**  | **~50 min**             | **~1 h 10 min** |




### What actually eats the clock


| Bottleneck                           | Typical wait    | Notes                                  |
| ------------------------------------ | --------------- | -------------------------------------- |
| Discovery Claude pack                | ~8–12 min       | Whole batch in one go                  |
| Narrative / site-config Claude       | ~3–5 min each   | Short JSON replies                     |
| **Content Full write (Claude)**      | **~12–22 min**  | Largest wait (batched Home/Services/Locations) |
| Content field research / brief       | ~5–10 min       | Pass 1 feed + synthesis                        |
| Content outline Claude               | ~3–5 min        | Pass 2                                         |
| Content Humanize + Final check       | ~5–12 min       | Passes 4–8                                     |
| DataForSEO Research / Enrich / probe | ~1–3 min each   | Click is instant                       |
| Prepare preview (assemble)           | ~2–4 min        | Local                                  |
| Run launch (ship + CF)               | ~3–5 min        |                                        |
| Domain buy + NS                      | ~3–5 min active | Propagation can add passive wait later |


Almost every in-app **button / paste / Accept** step is **~5–30 seconds** of your time when you already know what you’re doing.

**Scheduling 10 sites/day:** see [OPERATOR-CADENCE.md](OPERATOR-CADENCE.md) (weekly prep vs daily 5h build block).

### What’s left out of the totals


| Item                                     | Why                                           |
| ---------------------------------------- | --------------------------------------------- |
| **Map**                                  | Helper only (~30 sec when used)               |
| **Photo**                                | Optional group organizer; never blocks Accept |
| **Prospects**                            | Optional; does not block build                |
| **Visual editor / ChatGPT before–after** | Optional polish (add ~10–30 min if you do it) |
| **DNS propagation**                      | Passive wait after NS change                  |
| **Phone screen (ongoing)**               | Post-launch ops                               |
| **Retries / truncated Claude**           | Can re-add a Full write wait (~10–18 min)     |




### Rough ranges (experienced operator)


| Path                                              | Typical wall-clock                    |
| ------------------------------------------------- | ------------------------------------- |
| Discovery batch only                              | ~12–20 min                            |
| Research → pursue (no Enrich)                     | ~6–10 min                             |
| Site-Config through Content Accept                | ~35–50 min (mostly Claude Content path) |
| Prepare → Launch (domain/keys ready)              | ~10–15 min                            |
| **One site, cold start (batch + build + launch)** | **~1–1.5 hours**                      |


---



## Big picture

1. **Find markets** (Discovery) — shortlist niche × city ideas.
2. **Prove the market** (Research) — search data, story, decide pursue or pass.
3. **Build the site** (Website) — brand, pages, content, preview, go live.
4. **Run the portfolio** (Launched · Phone) — rent status, calls, updates.

---



## Stages: Discovery + Research



### Screen: Discovery


| What you do                           | Why                                        |
| ------------------------------------- | ------------------------------------------ |
| **1 · New Discovery Pack**            | Creates a Claude-only CSV template + prompt (filtered compact High-Ticket catalog, not the full guide). **Required** Niche text stays exact; **Suggested**/OPEN prefer **head terms** (e.g. Drywall → Drywall Repair). Claude also estimates **Est. Monthly Search Volume** (Niche+City). That guess is not Ads truth; when Ads volumes are skipped it can seed Research Demand as **est.** |
| **2 · Send to Claude**                | Claude fills candidate rows for the pack   |
| **3 · Import Claude CSV**             | Rows appear in the batch table             |
| **4 · Light SERP**                    | Light competition signal before Research   |
| Set a **Decision** on every row       | Required before Process                    |
| **Process batch**                     | Keepers → Research; pass → tracked; ignore → skip (rediscoverable) |
| **Advanced** (sidebar)                | Edit / wipe Generate Pack **do-not-repropose** editor (tracked orphans + Research Eval 1 only; Launched never listed) |


**Forward:** pursue, maybe, review, hold · **Tracked only:** pass · **Skip (rediscoverable):** ignore

Generate Pack tells Claude not to re-propose Niche×City×State pairs already in Active Research Candidates or tracked. Archived Candidates are excluded from the prompt. Use **Advanced → Edit do-not-repropose list** (shift-select + Remove) or **Wipe to match Active Research** to clean test leftovers. The Advanced editor only shows tracked/orphan pairs and Research Candidates at Evaluation 1 — Launched Candidates cannot be removed or permanently deleted from Rover. Unlaunched Website Candidates can be permanently deleted from the candidate list (Rover files + local assembled folder; not GitHub / Cloudflare / Twilio).

### Screen: Research


| Panel         | What you do                                         |
| ------------- | --------------------------------------------------- |
| Overview      | Glance snapshot; set **pursue** when ready to build |
| 1 · SERP / Volume  | Run Ad volumes / SERP signals                       |
| 1 · Keywords  | Glance keyword volumes                              |
| 2 · Enrich    | Requires Eval 1 complete                            |
| 3 · Narrative | Requires Eval 2; Copy prompt → Claude → Load draft → Accept |
| 4 · Prospects | Requires Eval 3 (Narrative accepted)                |
| Logs          | Job history                                         |




### Screen: Map

Geography assist for picking cities. Not a required pipeline stage.

---

### Screen: Photo

Optional group organizer (not a Stage). Skipping Photo does not block Content, Accept, stock Pull, Image queries, or Launch.

- **Named groups** are snapshots you save from Website → Review images (or Duplicate on Photo).
- **Niche master** (`{Niche} master`) is pinned and cannot be renamed or deleted. It **merges on Prepare preview** (after Review images polish) — even if you never open Photo. Accept on later sites in the same niche **uses the master** unless you **Load** a named group or **Skip** Content step 9 (fresh stock Pull; Image queries required).
- Load matches by **role** (same service/slot), not a Structure copy. Shared names fill; new names stay empty; leftover photos are unused. Preview names empties (“No photo for Popcorn ceiling”).
- Groups stay local under `research/_photo-groups/` (gitignored).

---



## Stages: Website + Launched (+ satellites)



### Screen: Website


| Panel               | Steps                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| **1 · Site-Config** | Colors → Address → Details → Paste draft → Accept services → Service Area → Phone |
| **2 · Content**     | Structure → Site research → Brief → Outline → batched Full write → Humanize → Final check → Image queries → Load photo group (optional) → Accept. API: Write site polish expands thin location pages; Accept can **Expand location pages** if a finished draft is still under 450 words. |
| **3 · Launch**     | Logo & Map (regenerate logo/map if Accept skipped) → Review images (save/load photo groups; niche master first in the dropdown) → Prepare preview (upserts niche master) → Launch |


**Site-Config · Address (step 2)**

- **Find addresses** — LoopNet and/or **Crexi** (checkboxes; both on when both actors are configured) → shared city cache + Places. Before Places, Find scrapes that listing’s LoopNet/Crexi URL for Space Availability suites (same details actor as launched-site backfill) and shows the first unused unit on the recommended card (`1221 E University Dr, Ste 1`). **Clean target** (default **10**, stop Places after that many cleans) and **Pull size** (default **40** listings per source; LoopNet ~half per office/retail URL) are set on the Address step and remembered in the browser. When the listing publishes Ste/Suite/Unit rows, Places checks those units in order and persists the first unused (`Ste 1`, not invented `STE-100`). Floor-only labels (1st Floor / Retail / Shell) are not suites — those stay street-only and still fail if an **active OPERATIONAL Maps listing** locks to street number + ZIP. Same-state / metro streets screen first; outside-metro drops. Numeric street ranges expand to **start + end** only. Places budget stays env/default (`PLACES_BUDGET_PER_RUN`, default **40**). Crexi targets For Lease + Retail + Traditional Office (falls back to Office+Retail if subtype URLs return nothing). **Use Find** for a first pull of a checked source or when that source still has streets left.
- **Recommended vs Secondary** — Places-clean streets are **Recommended** when Google Maps locality **and** the listing city both match the target city. Places-clean but Maps locality outside the target (e.g. Kearns vs Salt Lake City), or listing city outside the target even when Maps matches (e.g. Taylorsville listing geocoded as Salt Lake City), are **Secondary** when still inside the metro radius (lower priority; confirm before use).
- **Refresh listings / Fetch deeper** — paid Apify re-scrape for **checked** sources only (not delta-only). Pull size follows the Address-step control; deepen steps stay +20/URL LoopNet / +40 Crexi (ceiling **500**→double up to **2000**/URL). **Fetch deeper** only when every checked source is at **0 left** (never-pulled Crexi is not “exhausted” — use Find). LoopNet Solidcode uses 2 URLs (office+retail); Crexi typically 1 startUrl.
- **Manual commercial** — paste any single commercial street + ZIP and claim it (`source: manual`).
- **Unclaimed cleans / Use anyway** — when Find is empty: reuse prior Places-clean streets still free in the city, or override an active-listing reject (confirm). Old “existing Maps business” cache fails are eligible for re-screen on the next Find.
- **Home paste / Skip** — residential NAP or leave street blank.
- **Inventory line** — per-source listings · reviewed · left · **Pull target** (no fill bar). Last search shows Result + Cost; a closed **Cost** dropdown has the estimate footnote and Apify prepaid. Claimed count is city-wide.

**Site-Config · Business details (step 4)** — Street is GBP **Address Line 1** (no suite). **Address line 2** is the listed suite (`Ste 3`). City stays the city only — never `Ste 3 Prosper`. Fill site-config and live footer/schema follow the same split.

**Site-Config · Service area** — Click a city on the map to add or remove coverage (reversible; remove also drops its Page). Non-Zone still uses the research-seed suburb list and a radius slider. Zone candidates have no radius ring: **Suggested location pages** = this primary plus the closest leftover (non-site) towns (one site each); **Also serving** = other coverage including Zone sibling cities and leftover towns another Zone site already Also-serves or already pages (overlap is allowed). Sibling cities cannot be pages. Turning **Page** on a leftover that already has a location page on another Zone site stays exclusive (confirm steals that page). Min pop defaults to 0 so leftover CDPs appear. Use the table **Page** button to turn a location page on or off.

**Before Run launch (outside Rover):** buy/point domain NS · Email Routing so `leads@` exists · Web3Forms Recipient Emails = `leads@{domain}` · Gmail routing destination.

**Already live?** Prepare preview → **Push updates**.

**Photo groups:** After Review images looks right, **Save photo group** stores that niche’s stock photos, uploads, and ChatGPT before/after pairs (save only from Review images). **Prepare preview** also upserts those photos into **{Niche} master** (union of roles, up to 8 alternates per role). On a later candidate in the same niche, Accept **uses the master** unless you **Load** a named group or **Skip** Content step 9 (fresh stock Pull; Image queries required). **Load** (Website → Review images or Content step 9) copies matching slots only — extra sections from the saved site are unused. Logo and coverage map still generate per site on Accept; operator regenerate lives on Website → **Logo & Map**. The Photo screen organizes groups; it does not apply them to a live candidate.

### Screen: Launched

Portfolio tracking — rent status, renter, payment, infra links.

### Screen: Phone

Twilio calls — answered/missed, recordings, AI summaries. Numbers are provisioned in Site-Config, not Discovery/Research.

---



## Still done by hand

- Buy domain + point NS at Cloudflare  
- Create Web3Forms form (Recipient Emails = `leads@{domain}`) + paste key  
- Verify Email Routing in Gmail once  
- One-time machine setup (`gh auth`, Cloudflare tokens in `.env`)

---



## Related docs


| Doc                                                  | When you need it                                |
| ---------------------------------------------------- | ----------------------------------------------- |
| [ENV-SETUP.md](ENV-SETUP.md)                         | API keys / .env (do this before first batch)    |
| [GITHUB-ACCESS-GATEWAY.md](GITHUB-ACCESS-GATEWAY.md) | Non-technical GitHub signup (Google Doc source) |
| [OPERATOR-CADENCE.md](OPERATOR-CADENCE.md)           | 10 sites/day schedule (weekly prep vs daily 5h) |
| [OPERATOR-CADENCE-FLOW.md](OPERATOR-CADENCE-FLOW.md) | Color flowchart (also open the .html poster)    |
| [PIPELINE-STAGES.md](PIPELINE-STAGES.md)             | Funnel definitions and nav naming               |
| [MASTER-FLOW.md](MASTER-FLOW.md)                     | Tools, costs, technical flowchart               |
| [ASSEMBLE-AND-LAUNCH.md](ASSEMBLE-AND-LAUNCH.md)     | Assemble / ship / Cloudflare deep dive          |
| [LAUNCH.md](LAUNCH.md)                               | Launch button reference                         |
| [PHONE-TRACKING.md](PHONE-TRACKING.md)               | Twilio ranking voicemail → rented cutover       |
| [SITE-INDEXING.md](SITE-INDEXING.md)                 | Post-launch Google indexing                     |
| [SITES-METRICS.md](SITES-METRICS.md)                 | GSC traffic + keyword ranks                     |


