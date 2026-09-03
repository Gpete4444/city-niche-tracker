# Rover User Guide

How to run the pipeline from finding a market to a live site. This is the operator manual: every screen and control you can see. Time estimates live in [USER-FLOW.md](USER-FLOW.md). API keys: [ENV-SETUP.md](ENV-SETUP.md).

## What Rover is {#what-rover-is}

Rover finds local home-service markets worth ranking for, then ships a lead-gen website for that niche × city. You rent the site (or its leads) to a local operator. Most markets stop early on purpose. Only rows you mark **pursue** become Website Candidates and get a full site.

## How to start {#start}

1. On this machine, open a terminal in the Rover folder.
2. Run `npm run rover`.
3. Open [http://127.0.0.1:8787](http://127.0.0.1:8787).
4. After you change API keys in `.env`, stop Rover and start it again. Settings only reloads keys on startup.

First-time keys: follow [ENV-SETUP.md](ENV-SETUP.md) until Settings → API/Other is green.

## Chrome {#chrome}

The top bar is always there.

### Version {#chrome-version}

**v1.8** (or current) sits next to the Rover wordmark. That is the product version, not a candidate.

### Stages {#chrome-stages}

Numbered pipeline: **1 Discovery** → **2 Research** → **3 Website** → **4 Launched**. Click a stage to switch screens. Arrows are decoration; they do not skip work.

### Map, Photo, Phone {#chrome-satellites}

Unnumbered helpers after Launched. They are not stages. You can skip Map and Photo. Phone is for calls after a ranking number exists.

### Heavy and Light {#chrome-jobs}

**Heavy** lists assemble / preview / prepare / launch / ship jobs, each with a step bar (`3/5`). **Light** lists Accept, logo, coverage map, pull photos, and SERP / Enrich / Prospects. Badges show how many are running. Click a row to jump to that candidate. **Jobs K** in Settings is how many Heavy jobs may run at once (1–6).

### Header strip {#chrome-strip}

When one job is running, a thin bar under the header shows that job. When two or more run, it says how many — open Heavy or Light to see each bar.

### API Cost {#chrome-api-cost}

Dollar icon. Spend by provider (DataForSEO, Claude, and others). Anthropic, OpenAI, and Google Maps show Rover-recorded spend and **PAYG** for balance. It does not start jobs.

### Settings {#chrome-settings}

Gear. **Host** is this Rover instance. **API/Other** expands the green ✓ / red ✕ key checklist. **Jobs K** is Heavy concurrency. **Theme** is Light 1–4 and Dark 5–8 (Blue is default light).

### Help {#chrome-help}

Opens this User guide in a searchable panel. The Dev guide stays in the repo, not in this panel.

## Naming {#naming}

| Term | Meaning |
| ---- | ------- |
| **Stage** | Top-bar pipeline: Discovery → Research → Website → Launched |
| **Evaluation** | Numbered checklist inside Research (SERP/Volume → Prospects) |
| **Track** | Numbered checklist inside Website (Site-Config → Content → Launch) |
| **Step** | A numbered item inside Discovery, an Evaluation, or a Track |
| **Screen** | A top-bar destination (includes Phone · Map · Photo) |
| **Panel** | A work area on a candidate’s detail side |

Easy mix-ups: **Light SERP** is a Discovery step, not Research Evaluation 1. **Site research** is a Content step, not “field research” in the UI.

## Discovery {#discovery}

Find niche × city ideas. Most rows will not become sites.

### New Discovery Pack {#discovery-new-pack}

Creates a CSV template and a Claude prompt from your filters. Required niche text stays exact. Suggested / OPEN niches prefer head terms (Drywall → Drywall Repair). Claude also estimates monthly search volume for triage only.

### Send to Claude {#discovery-send-claude}

Copy the prompt, run it in Claude, wait for the filled CSV. This is usually the longest Discovery wait.

### Import Claude CSV {#discovery-import}

Paste or load the CSV. Rows appear in the batch table.

### Light SERP {#discovery-light-serp}

Cheap Map Pack / organic probe so you can decide before paying for full Research. Not the same as Research → SERP / Volume.

### Decision {#discovery-decision}

Every row needs a decision before Process:

- **pursue, maybe, review, hold** — keepers that go to Research
- **pass** — tracked only (Generate Pack will not re-propose that pair)
- **ignore** — skip; can show up again later

### Process batch {#discovery-process}

Keepers become Research Candidates. Pass goes to the tracked list. Ignore is skipped.

### Advanced {#discovery-advanced}

Sidebar editor for the **do-not-repropose** list (tracked orphans + Research at Evaluation 1). Website and Launched candidates cannot be removed here. Use **Wipe to match Active Research** to clean test leftovers.

## Research {#research}

Prove the market with paid search data and a written story. Set **pursue** only when you are ready to build. The list table shows a green **LIVE** badge after the checkbox for launched sites (blank otherwise), then Evaluation (1–4) and Website Track (1 Site-Config · 2 Content · 3 Launch), and **Type** after API $ (Discovery / Research / Website / Launched).

### Overview {#research-overview}

Snapshot of scores and flags. Set **pursue** here when Evaluations look good. That move unlocks Website.

### SERP / Volume {#research-serp}

Evaluation 1. Runs ad volumes and SERP signals. **Force new SERP** re-pulls Map Pack / organic (keeps enrichment, may mark it stale). Watch **Light** for the job bar. **Keywords** is a glance at volumes on the same evaluation.

### Enrich {#research-enrich}

Evaluation 2. Domain rank / thinness. Requires Evaluation 1. Optional if you already trust the market; skipping saves a wait.

### Narrative {#research-narrative}

Evaluation 3. **Copy prompt** → Claude → **Load** the JSON draft → **Accept**. Requires Evaluation 2. Accept writes the approved package. Job-cost outside the Discovery seed band asks you to override or fix the draft.

### Prospects {#research-prospects}

Evaluation 4. Optional renter list. Requires Narrative accepted. Does not block Website.

### Logs {#research-logs}

Job history and raw output for the selected candidate.

## Website {#website}

Build the site for a **pursue** candidate. Three tracks, in order: Site-Config → Content → Launch.

### Site-Config {#website-site-config}

1. **Colors & fonts** — pick a palette and font theme, then Apply.
2. **Address** — Find commercial streets (LoopNet / Crexi → Places), Manual commercial, Home paste, or Skip. Recommended vs Secondary is about city match. See Find details below.
3. **Business details** — name, domain, NAP fields.
4. **Paste & edit draft** — Claude site-config JSON; Load into the editor.
5. **Review services → Accept** — locks site-config.
6. **Service area** — confirm cities on the map.
7. **Provision phone** — Twilio ranking number, or Skip. Do not buy numbers in Discovery or Research.

**Find addresses:** Clean target (default 10) stops Places after that many clean streets. Pull size (default ~40 listings per source) is remembered in this browser. A street is rejected only for an **active OPERATIONAL** Maps listing on that street + ZIP. **Refresh / Fetch deeper** re-scrapes checked sources (costs Apify). Use **Find** when a source still has streets left; **Fetch deeper** when every checked source is exhausted.

### Content {#website-content}

1. **Structure** — usually Preset C. Chooses which homepage / service sections exist.
2. **Site research** — Copy → Claude → Load.
3. **Content brief** — Copy → Claude → Load & confirm.
4. **Outline** — Copy → Claude → Load & confirm.
5. **Full write** — batched Home / Services / Locations. Longest Claude wait.
6. **Humanize** — editor pack (burstiness, perplexity, bookends, conversion).
7. **Final check** — Copy → Load OK or FILE fixes.
8. **Image queries** — search phrases for stock photos.
9. **Load photo group** — optional. Skip uses fresh stock on Accept (queries required).
10. **Accept** — writes pages, then photos (group, niche master, or stock pull), logo, and coverage map. Watch **Light**.

### Launch track {#website-launch}

1. **Logo & Map** — regenerate logo or coverage map if Accept skipped them. Accept uses **Mark + text**. Logo modes: Mark, Mark + text, Monogram. Previous logos (up to 4) and maps (up to 2) sit in trays under the previews.
2. **Review images** — grade slots, re-pull, generate, save/load photo groups. Niche master is first in the dropdown.
3. **Prepare preview** — stages, assembles, builds, starts a local preview. Watch **Heavy** (`Staging… 1/5` through Starting preview). A waiting tab opens while it runs.
4. **QA preview** — spot-check key URLs on the preview.
5. **Run launch** — first go-live: paste domain / Web3Forms / email destination; Auto ship is on by default.
6. **Push updates** — already live: ship GitHub + build + Worker only. Run **Prepare preview** first if content changed.

**Before first launch (outside Rover):** buy the domain and point NS at Cloudflare; create a Web3Forms form; have a Gmail (or inbox) for `leads@` routing.

## Launched {#launched}

Portfolio of live sites: rent status, renter, payment, infra links. **Indexing Mark done** stays checked after reload. **Push updates** from Website ships later content. Metrics (Search Console ranks) need GSC connected — see Settings greens and [SITES-METRICS.md](SITES-METRICS.md).

## Phone {#phone}

Call log for ranking numbers: answered / missed, recordings, AI summaries. Provision in Site-Config, not here. Rent cutover keeps the same number and forwards to the renter. Details: [PHONE-TRACKING.md](PHONE-TRACKING.md).

## Map {#map}

Geography assist for picking cities. Not required. Discovery can use it as a helper; Website Service area is the coverage map you confirm for the site.

## Photo {#photo}

Optional group organizer. Skipping it does **not** block Content, Accept, stock Pull, Image queries, or Launch.

- **Named groups** — snapshots from Website → Review images (or Duplicate here).
- **Niche master** (`{Niche} master`) — pinned. **Prepare preview** merges Review images into it. Later Accept in the same niche **uses the master** unless you Load a named group or Skip Content step 9.
- Load matches by **role** (service/slot), not a full Structure copy.

## Jobs {#jobs}

Long work always shows a bar. **Heavy** = prepare / assemble / preview / launch / ship (limited by Jobs K). **Light** = Accept, logo, map, pull photos, SERP / Enrich / Prospects (no K). In-page bars on a step match the same numbers as the list. If several things run, open both lists instead of trusting the single header strip.

## Waiting vs doing {#waiting}

Most clicks are seconds. Wall-clock is Claude, DataForSEO, Prepare preview, and Launch. Typical waits: Discovery Claude pack ~8–12 min; Full write ~12–22 min; Prepare preview ~2–4 min; Launch ship ~3–5 min. Full table: [USER-FLOW.md](USER-FLOW.md). You can switch candidates or screens while a job runs — watch Heavy / Light.

## Still done by hand {#manual}

- Buy domain + point NS at Cloudflare
- Create Web3Forms form + paste the key
- Verify Email Routing in Gmail once
- One-time machine setup (`gh auth`, Cloudflare tokens)

## Related docs {#related}

| Doc | When |
| --- | --- |
| [USER-FLOW.md](USER-FLOW.md) | Time estimates |
| [ENV-SETUP.md](ENV-SETUP.md) | API keys |
| [OPERATOR-CADENCE.md](OPERATOR-CADENCE.md) | 10 sites/day schedule |
| [PHONE-TRACKING.md](PHONE-TRACKING.md) | Ranking number → renter forward |
| [SITE-INDEXING.md](SITE-INDEXING.md) | Google indexing after launch |
| [LAUNCH.md](LAUNCH.md) | Run launch / Push updates |
| [DEV-GUIDE.md](DEV-GUIDE.md) | Engineers (repo only) |
