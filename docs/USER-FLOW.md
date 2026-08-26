# Rover — from discovery to launch

A plain-language map of what you do in Rover, with **time estimates** for each step.

**How this guide is organized**


| Name          | What it means in Rover                                       |
| ------------- | ------------------------------------------------------------ |
| **Workspace** | A group in the top bar (Potential Candidates · Candidates)   |
| **Screen**    | A button you click in the top bar (Discovery, Research, …)   |
| **Panel**     | A work area on a candidate’s detail side                     |
| **Step**      | A numbered checklist inside Site-Config, Content, or Website |


```text
Potential Candidates          →          Candidates
Discovery → Research → Map    →    Website Builder → Launched Sites → Phone
```

Most markets die early on purpose. Only **pursue** rows get a full website build.

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
| SERP probe (batch)                                       | ~5 sec       | ~1–3 min                | ~2 min          |
| Human decisions (Accept all + quick skim)                | ~1–2 min     | —                       | ~2 min          |
| Process batch                                            | ~10 sec      | ~15–30 sec              | ~30 sec         |
| **Discovery subtotal (once per batch)**                  | **~3 min**   | **~11 min**             | **~15 min**     |
| **Research** *(per pursue candidate)*                    |              |                         |                 |
| Overview — glance scores                                 | ~10–20 sec   | —                       | ~20 sec         |
| 1 · Research — run Ad volumes                            | ~5 sec       | ~1–3 min                | ~2 min          |
| 1 · Keywords — glance volumes                            | ~10–20 sec   | —                       | ~20 sec         |
| 2 · Enrich *(optional; skip if not needed)*              | ~5 sec       | ~1–2 min                | ~2 min          |
| 3 · Narrative — copy → Claude → Load → Accept            | ~30–45 sec   | ~3–5 min                | ~5 min          |
| Set decision to **pursue**                               | ~5–10 sec    | —                       | ~10 sec         |
| Prospects *(optional — not in totals)*                   | ~30 sec      | ~1–3 min                | ~3 min          |
| **Research subtotal** *(incl. Enrich)*                   | **~2 min**   | **~8 min**              | **~10 min**     |
| **Research subtotal** *(skip Enrich)*                    | **~2 min**   | **~6 min**              | **~8 min**      |
| **Website Builder · Site-Config**                        |              |                         |                 |
| 1 · Colors & fonts (pick + Apply)                        | ~10–20 sec   | —                       | ~20 sec         |
| 2 · Address (Find + pick, or Skip)                       | ~15–30 sec   | ~30–60 sec if Find      | ~1 min          |
| 3 · Business details (name / domain / NAP)               | ~30–60 sec   | —                       | ~1 min          |
| 4 · Paste & edit draft (Claude site-config)              | ~20–40 sec   | ~2–4 min                | ~4 min          |
| 5 · Review services → Accept                             | ~10–20 sec   | —                       | ~20 sec         |
| 6 · Service area (confirm)                               | ~15–30 sec   | —                       | ~30 sec         |
| 7 · Provision phone (or Skip)                            | ~10 sec      | ~15–30 sec              | ~30 sec         |
| **Site-Config subtotal**                                 | **~3 min**   | **~4 min**              | **~7 min**      |
| **Website Builder · Content**                            |              |                         |                 |
| 1 · Structure (Preset C)                                 | ~5–10 sec    | —                       | ~10 sec         |
| 2 · Outline (copy → Claude → Load & confirm)             | ~20–30 sec   | ~3–5 min                | ~5 min          |
| 3 · Full write (copy → Claude → Load FILEs)              | ~20–40 sec   | ~10–18 min              | ~15 min         |
| 4 · Speech/SEO (auto; skim if clean)                     | ~10–20 sec   | ~1–2 min (auto)         | ~2 min          |
| 5 · Accept content (+ auto logo / photos / map)          | ~5–10 sec    | ~1–3 min                | ~2 min          |
| **Content subtotal**                                     | **~2 min**   | **~20 min**             | **~22 min**     |
| **Website Builder · Website**                            |              |                         |                 |
| 1 · Review images (glance; skip polish)                  | ~20–40 sec   | —                       | ~30 sec         |
| 2 · Prepare preview (Stage + Assemble)                   | ~5–10 sec    | ~2–4 min                | ~3 min          |
| 2 · QA preview (spot-check key URLs)                     | ~1–2 min     | —                       | ~2 min          |
| Buy domain + point NS at Cloudflare                      | ~3–5 min     | —                       | ~5 min          |
| Create Web3Forms form + paste key                        | ~30–60 sec   | —                       | ~1 min          |
| 3 · Run launch (paste keys + Auto ship)                  | ~30–60 sec   | ~3–5 min                | ~5 min          |
| Verify Gmail + smoke-test form                           | ~1 min       | *(email may lag)*       | ~1–2 min        |
| **Website / Launch subtotal**                            | **~8 min**   | **~7 min**              | **~15 min**     |
| **Launched Sites**                                       |              |                         |                 |
| First touch — rent / links (optional same day)           | ~20–30 sec   | —                       | ~30 sec         |
| **Launched Sites subtotal**                              | **~30 sec**  | **—**                   | **~30 sec**     |
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
| **Content Full write (Claude)**      | **~10–18 min**  | Largest single wait                    |
| Content outline Claude               | ~3–5 min        |                                        |
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
| Site-Config through Content Accept                | ~25–35 min (mostly Claude Full write) |
| Prepare → Launch (domain/keys ready)              | ~10–15 min                            |
| **One site, cold start (batch + build + launch)** | **~1–1.5 hours**                      |


---



## Big picture

1. **Find markets** (Discovery) — shortlist niche × city ideas.
2. **Prove the market** (Research) — search data, story, decide pursue or pass.
3. **Build the site** (Website Builder) — brand, pages, content, preview, go live.
4. **Run the portfolio** (Launched Sites · Phone) — rent status, calls, updates.

---



## Workspace: Potential Candidates



### Screen: Discovery


| What you do                           | Why                                        |
| ------------------------------------- | ------------------------------------------ |
| **1 · New Discovery Pack**            | Creates a Claude-only CSV template + prompt (filtered compact High-Ticket catalog, not the full guide) |
| **2 · Send to Claude**                | Claude fills candidate rows for the pack   |
| **3 · Import Claude CSV**             | Rows appear in the batch table             |
| **4 · SERP probe**                    | Light competition signal before Research   |
| Set a **Human** decision on every row | Required before Process                    |
| **Process batch**                     | Keepers → Research; passes → tracked       |


**Forward:** pursue, maybe, review, hold · **Tracked only:** pass

### Screen: Research


| Panel         | What you do                                         |
| ------------- | --------------------------------------------------- |
| Overview      | Glance snapshot; set **pursue** when ready to build |
| 1 · Research  | Run Ad volumes / SERP signals                       |
| 1 · Keywords  | Glance keyword volumes                              |
| 2 · Enrich    | Optional competitor depth                           |
| 3 · Narrative | Copy prompt → Claude → Load draft → Accept          |
| Prospects     | Optional renter list (does not block build)         |
| Logs          | Job history                                         |




### Screen: Map

Geography assist for picking cities. Not a required pipeline stage.

---



## Workspace: Candidates



### Screen: Website Builder


| Panel               | Steps                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| **4 · Site-Config** | Colors → Address → Details → Paste draft → Accept services → Service area → Phone |
| **5 · Content**     | Structure → Outline → Full write → Speech/SEO → Accept                            |
| **6 · Website**     | Review images → Prepare preview → Launch                                          |


**Before Run launch (outside Rover):** buy/point domain NS · Web3Forms key · Gmail routing destination.

**Already live?** Prepare preview → **Push updates**.

### Screen: Launched Sites

Portfolio tracking — rent status, renter, payment, infra links.

### Screen: Phone

Twilio calls — answered/missed, recordings, AI summaries. Numbers are provisioned in Site-Config, not Discovery/Research.

---



## Still done by hand

- Buy domain + point NS at Cloudflare  
- Create Web3Forms form + paste key  
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
| [PHONE-TRACKING.md](PHONE-TRACKING.md)               | Twilio ranking → rented cutover                 |
| [SITE-INDEXING.md](SITE-INDEXING.md)                 | Post-launch Google indexing                     |
| [SITES-METRICS.md](SITES-METRICS.md)                 | GSC traffic + keyword ranks                     |


