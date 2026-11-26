# Operator site runbook — niche to live site (Rover 2.8)

Step-by-step for a **new operator** who already finished [OPERATOR-ONE-TIME-SETUP.md](OPERATOR-ONE-TIME-SETUP.md) (APIs, Cloudflare, GitHub, Twilio Functions, **Forms inbox**, `LEAD_NOTIFY_EMAIL`). This is the **per-site** path: find a market, build the site, go live. Visual map: [OPERATOR-FLOWS.md](OPERATOR-FLOWS.md) · printable [flows/operator-flows.html](flows/operator-flows.html).

**Example first site:** Gilbert Smart Home Automation (`gilbertsmarthomeautomation.com`) — one primary city plus **Also serving** towns (not a Zone multi-page cluster).

**Not in this doc:** one-time accounts / `.env` / Twilio Functions / `gh auth` / Phone/Form **Set up inbox** — see [OPERATOR-ONE-TIME-SETUP.md](OPERATOR-ONE-TIME-SETUP.md) (and [ENV-SETUP.md](ENV-SETUP.md) for every key).

**Related:** one-time [OPERATOR-ONE-TIME-SETUP.md](OPERATOR-ONE-TIME-SETUP.md) · screens/buttons [USER-GUIDE.md](USER-GUIDE.md) · times [USER-FLOW.md](USER-FLOW.md) · launch button [LAUNCH.md](LAUNCH.md) · indexing [SITE-INDEXING.md](SITE-INDEXING.md) · phone detail [PHONE-TRACKING.md](PHONE-TRACKING.md).

The short card [WEBSITE-STAGE-STEP-BY-STEP.docx](WEBSITE-STAGE-STEP-BY-STEP.docx) is the three photo routes (first city, later city, gap-fill). When it says only “Provision phone” or “Indexing,” use the area-code and Indexing steps in this runbook.

### Lead mail (2.5 onward, including 2.8) — no Web3Forms

The live contact form posts to the **Rover forms Worker** (`formsIngestUrl`). Launch needs the forms inbox ready and an **Email Routing destination** (`LEAD_NOTIFY_EMAIL`).

**Do not** create a Web3Forms form or paste an access key. That product path was removed for go-live starting in 2.5 and remains the rule in 2.8. Set the notify address in gear → **Account setup**.

---

## Before you start

1. Terminal in the Rover folder → `npm run rover` (leave it running).
2. Open [http://127.0.0.1:8787](http://127.0.0.1:8787). To reload Rover, click the page and press Ctrl+Shift+R. Ctrl+F5 opens the Windows Voice Access window.
3. Gear → **Account setup** holds the keys. Gear → **API/Other** should be green for the work you will do (Anthropic, DataForSEO, Cloudflare, GitHub owner, Twilio, **Lead notify email**, **Forms inbox**). Template repo / Assembled sites dir / Anthropic Admin may stay red.
4. Know your lead inbox (Gmail, Zoho, or another verified destination). That is the **Email Routing destination** / `LEAD_NOTIFY_EMAIL` — not `leads@{domain}`.

### Naming (so the UI makes sense)

| Term | Meaning |
| --- | --- |
| **Stage** | Top bar: Discovery → Research → Website → Launched |
| **Evaluation** | Numbered checklist inside Research |
| **Track** | Numbered checklist inside Website: Site-Config → Content → Launch |
| **Also serving** | Towns in coverage that are **not** full location pages (footer / map list) |

### Claude content path used here

This runbook assumes **Anthropic API** mode: **Write site with Claude** on the Content track.

If Settings uses **Copy & paste** instead, Content steps become Copy prompt → Claude.ai → Load (same outcomes; more clicks). Discovery also splits into Generate → Send to Claude → Import instead of one Generate pack job. Structure **Continue** opens **Site research** instead of Write site.

### Same-niche structure & images (Rover 2.8)

Rover is built so a **second city in the same niche** can reuse the first city’s skeleton and photos — when you follow the cadence below. It is structured, not fully automatic.

| Piece | What Rover does | What you must do |
| --- | --- | --- |
| **Structure** | New Content checklists **default to Preset C** (same pages/sections for every niche). | **Use Preset C** on every city. Do not switch to A/B or uncheck sections unless you intentionally want a different layout (that breaks same-niche photo reuse). Structure is saved **per candidate**. |
| **Service names** | **Build from niche** / **Save niche default** / **Load niche default** keep the service list aligned (`research/_niche-service-lists.json`). | On city 1: Build → Apply → **Save niche default**. On city 2+: **Load niche default** (or Build again) before Site-Config Accept. Same names → same photo slots. |
| **Process / materials titles** | Write site stores shared homepage + per-service process/materials **titles** per niche (`research/_niche-photo-blocks.json`). Later cities keep those titles; city prose under them is rewritten. | Treat process/materials titles as **niche-wide**. Same install steps everywhere; only city prose changes. Before leaving city 1, open Review images → Filter **Empty** and fill every materials/process slot so the master is complete. |
| **Image identity** | Each photo slot has a stable **`matchKey`** (e.g. `svcHero:smart home setup`, `home:process:1`, `svcMaterials:…:2`) plus process/material titles. Load / Accept match by that identity (exact key, then title fan-out for process/materials). | Keep service names **and** process/materials titles aligned with the niche default / photo blocks. New titles = empty slots on the next city. |
| **Niche master** | **Prepare preview** upserts this city’s Review images into **`{Niche} master`**. **Replace master** on Review images overwrites the shared master with this city’s current slots. | City 1: Skip photo group → Accept → fill empties → **Save photo group** → **Prepare preview** (creates master). City 2+: leave **master** selected → click **Load** → **Load on Accept** → Accept (Skip stock on). If a later city fills gaps the master lacked, **Replace master**, then Load that master onto sibling cities. |

**Breaks reuse:** Skip on Content photo-group step when you meant to reuse; never running Prepare preview / Replace master after city 1 photos are good; renaming services; inventing new materials/process titles on a later Write site; stripping process/materials photo sections from Structure; shipping city 2 while city 1 still had Empty materials slots.

---

## Part A — First site (single primary city + Also serving)

Use this for the first go-live in a niche/metro (Gilbert-style).

### A1. Discovery — find niche × city ideas

1. Open stage **1 Discovery**.
2. Set filters (state, niche text, population, etc.).
3. **Generate Discovery pack** (API mode: confirm cost; wait for Claude).
4. Run **Light SERP** on the batch (cheap probe before Research).
5. Set a decision on every row:
   - **pursue / maybe / review / hold** → can become Research
   - **pass** → tracked; Generate pack won’t re-propose that pair
   - **ignore** → skip
6. **Process batch** — keepers become Research Candidates.

Most rows die here on purpose. Only strong pairs go on.

### A2. Research — prove the market, then pursue

1. Open stage **2 Research**; select the candidate (e.g. Smart Home Automation × Gilbert, AZ).
2. Prefer **Run all required** (SERP seeds + Narrative) unless you want paid Ads volumes / Enrich / Prospects.
3. **Evaluation 1 · SERP / Volume** — run if not already covered. Glance softness / demand.
4. **Evaluation 2 · Enrich** — optional; skip if not needed.
5. **Evaluation 3 · Narrative** — required. **Run all required** accepts the story. When Stage says `narrative_accepted`, **Accept draft** is hidden. **Accept draft** shows only while a draft is still waiting; that click opens **Accept narrative drafts?**, then **Batch Accept complete**. Copy/paste: Copy → Claude → Load → Accept.
6. On **Overview**, set decision to **pursue** when you are ready to build. That unlocks Website.

**Prospects** (Evaluation 4) is optional and does not block Website.

### A3. Website · Site-Config track

Open stage **3 Website**; select the pursue candidate.

1. **Colors & fonts** — pick palette + font theme → **Apply**.
2. **Address** — Find commercial streets (LoopNet / Crexi), or Manual / Home paste / Skip. Suite stays on **Address line 2** (never merged into City). Find rejects under-construction / proposed listings and does not invent `STE-*` stubs. If both finders return 0 listings or the run fails, click **?** (Help) → **Gemini address search** and paste that prompt into [gemini.google.com](https://gemini.google.com/). Fill in this site’s niche, city, and state. Open the source URL. If the street is real and in **this** city, enter it with **Manual commercial**. If Gemini replies “none”, click **Skip**. The **Selected** callout includes suite when present.
3. **Domain** — real host (e.g. `gilbertsmarthomeautomation.com`). Do not leave `example.com`.
4. **Business details** — seeds **Fill site-config**. This step does **not** Accept.
   - Business name is **city-specific**: `Gilbert Smart Home Automation`, `Chandler Smart Home Automation`. Do not reuse one name across the cluster.
   - Email is `leads@{domain}`.
   - **Street** is the same address chosen in step 2 (suite stays on Address line 2).
5. **Edit draft** — this form is what gets saved. Set **Business name** here to the city-specific name. **Street (optional)** is already the step-2 street. **Commercial A / Commercial B** are grey hints on an empty box — leave them blank. **Save draft**. There is no Accept button here.
6. **Review services → Accept** — for the **first** city in a niche, use **Build from niche** → **Apply**, then **Save niche default** so later cities share the same service names (and therefore the same image slot keys). On later cities, **Load niche default** first. Confirm dialog title is **Write site-config.json?** If placeholders remain, click **Write with placeholders**. That is Accept. It replaces an older `example.com` package. (Live form delivery uses the forms inbox URL on ship — not a Web3Forms access key.)
7. **Service area** (Gilbert-style / non-Zone):
   - Keep **one primary city** (Gilbert).
   - AUTO seed only suggests towns within **~5 miles** of the primary (caps still apply). Farther towns need an operator click/pin.
   - Non-Zone still has a radius slider (default **15 miles**). Zone / cluster candidates have **no** radius ring — leftover pages + Also serving rules apply instead (see User Guide).
   - Nearby towns stay **Also serving** (listed on the site; **not** separate location landing pages unless you explicitly turn **Page** on).
   - To remove a town, click its row in **Selected cities** (the word **remove**). The Also serving box and map labels do not remove it.
   - Prefer a small set of location pages (often just the primary) for the first site.
8. **Provision phone** (per site — do this):
   - Leave the area-code box empty. Click **Provision ranking number**. Rover buys one of that city’s area codes, including an overlay. If those codes are out of stock, it buys the closest number in the same state.
   - Type an area code only when you want that code and no other. A typed code that is out of stock stops. It does not fall through to another code. Phoenix-area codes 480, 602, and 623 are often empty at Twilio; an empty box then buys the closest in-state number (often a 928). Do not type a code a voice assistant suggests — 562 is Long Beach, California.
   - Confirm the number appears on the candidate / site-config.
   - Open top-nav **Phone** once if you have not saved a ranking greeting / spoken fallback yet for this Twilio account.
   - Test from another phone: you should hear the greeting/voicemail — **your cell must not ring**.
   - Do **not** buy numbers in Discovery or Research.

### A4. Website · Content track

1. **Structure** — **Use Preset C** (chip should already be highlighted). Leave it on Preset C, then **Continue** (API mode opens Write site; Copy & paste opens Site research). Do not pick A/B or clear boxes for normal same-niche builds.
2. **Write site with Claude** (API) — one job; confirm cost; wait (often ~15–25+ min wall-clock). Covers research → brief → outline → full write → polish. Shared niche **process/materials titles** are reused so image roles stay identifiable across cities.
   - Polish expands thin **service** pages (up to two tries) and thin **location** pages. Location bodies under 450 words fail Write site (**Retry**). After Write site, Accept may offer **Expand location pages**.
   - If a step fails (e.g. thin location pages), use **Retry** / **Expand location pages** as the UI offers.
   - If it fails with **invalid YAML frontmatter** on `index.md` (duplicate key), click **OK** and run **Write site** again. Do not Accept and do not open Launch.
3. **Image queries** — if Write site did not leave them ready, complete this step (needed for stock photos when not loading a photo group / skipping stock).
4. **Load photo group** — on the **first** site in a niche, usually **Skip** (fresh stock on Accept). On a later site, leave the 1st dropdown on the **{Niche} master** (e.g. Smart Home Automation Installation master) → click **Load** → confirm **Load on Accept**. Click **Skip** only for a fresh stock pull. Logo and coverage map still generate on Accept.
5. **Accept** — writes pages, copies the master or pulls stock, logo, and coverage map. Wait for the card to finish.
   - **Skip stock image pull** — leave on to skip Unsplash / Pexels / Pixabay when the master/group should supply photos. Logo and coverage map still run. On a first site with Skip photo group, leave Skip stock **off** unless you will fill slots with OpenAI generate.
   - Next is Launch, not before this Accept.

### A5. Website · Launch track (before go-live)

1. **Logo & Map** — glance; regenerate only if Accept left gaps. (After a Rover upgrade that changes the logo image model, restart Rover before regenerating logos.)
2. **Review images** — grade/re-pull/generate as needed. Unlaunched sites stamp the site logo on before/after photos by default — use **Remove logo** / **Add logo** if needed (buttons stay off for launched sites). If photos do not match their captions, click **?** (Help) → **Image prompts from captions** and paste that text into Cursor so it writes a prompt for **all** of the images. On city 1 (and any city that will **Replace master**):
   - Filter **Empty** (click the Empty **count**, not only Select) → fill every empty materials/process slot with **OpenAI** or **Re-pull** before you save the master.
   - **Save photo group** with a clear name (e.g. `Smart Home Automation_Gilbert`) for backup.
3. **Prepare preview** — Stage + Assemble + local preview (serial; one site at a time). Wait for the card. This **upserts the niche master** so the next same-niche city can place these photos by slot identity. To force the shared master to this city’s slots, use Review images → Photo groups → **Replace master**.
4. **QA preview** — spot-check home, contact, 1–2 services, phone/email in footer.

### A5b. Gap-fill a city, then refresh the niche master (same niche)

Use when a later city (or a repaired first city) still shows Empty materials/process slots the master did not cover — e.g. Chandler after Gilbert.

1. **3 Website** → select that city → **3 · Launch** → **Review images**.
2. Filter **Empty** → **Select** (optional, for bulk) → **OpenAI** (or Re-pull) until Empty is 0 on slots you care about.
3. Photo groups → **Replace master** (confirm). This overwrites `{Niche} master` with this city’s Review images.
4. Optional: **Save photo group** (e.g. `Smart Home Automation_Chandler_Gold`) as a named backup.
5. For **each sibling city** already on this niche (Gilbert, Mesa, San Tan, …): select city → Review images → dropdown = niche master → **Load** → confirm replace/load → **Prepare preview** → **Push updates** if live.
6. Do not regenerate the same empties on every sibling after the master is replaced — Load the new master instead.

### A6. Lead mail — forms Worker + Cloudflare destination

A lead travels **contact form → Rover forms Worker → email FROM `leads@{domain}` TO your notify inbox**, with Cloudflare Email Routing also forwarding `leads@` to that same destination.

| Address | Where it is set | What it is |
| --- | --- | --- |
| `leads@{domain}` | Site-config / Launch **Leads email**; Cloudflare routing rule | Public From / forward address — not a Zoho/Gmail mailbox you create |
| Notify inbox | Gear → **Account setup** → **Lead notify email** (or `.env` `LEAD_NOTIFY_EMAIL`) and Launch **Email Routing destination** | Where every form lead lands |
| Forms inbox | Phone/Form → **Set up inbox** (once per machine) | Worker + D1 that stores leads and sends the email |

### A6b. Do these in this order (do not go back)

Finish each step before the next one.

1. **Notify inbox + forms inbox already done (one-time).** You can open the lead notify address. Settings **Forms inbox** is green. If you just edited `.env` or the Cloudflare token by hand, restart Rover **now**, before Launch. Account setup **Save** does not need a restart. Do not restart again in the middle of the steps below.
2. **Domain in this Cloudflare account, status Active.** Rover does not buy the domain. Buy it in the dashboard for the same account as `CLOUDFLARE_ACCOUNT_ID`.
   1. Open [dash.cloudflare.com](https://dash.cloudflare.com).
   2. In the left sidebar, click **Domains**.
   3. Click **Overview**.
   4. Click the blue **Add domain**.
   5. Click **Buy** when the name is not registered yet. Click **Connect a domain** when you already own it.
   6. Type the exact domain and continue.
   7. If the popup says the name does not appear to be a registered domain, click the blue **Buy domain**. Leave **Connect domain anyway** alone.
   8. Finish the purchase. The next page is **Your domain is ready**. **Manage** on that page is renewal and WHOIS, not the website.
   9. In the left sidebar, click **Domains**, then **Overview**.
   10. In **Search by domain name...**, type the start of the domain. A new name can be missing from the first rows.
   11. Click the domain name.
   12. Stop when the page says **Your domain is now protected by Cloudflare** and the Domains list shows **Active**. Buying here sets the nameservers. You do not add them at another registrar.
   Already own it somewhere else: **Add domain** → **Connect a domain**, then set that registrar’s nameservers to the two Cloudflare nameservers on the screen, and wait until this account shows **Active**.
3. **Email Routing destination Verified (once per inbox).** Open the domain from **Domains** → **Overview**, then **Email** → **Email Routing** → Destination addresses. If the notify address is new, open that inbox and click Cloudflare’s verify link. Stop until the destination shows **Verified**. You do this once per notify address, not on every site.
4. Continue to **A7 Run launch**. Leave **Connect domain and email** checked so Launch creates the `leads@{domain}` → destination rule. Do **not** create a Web3Forms form.

### A7. Run launch

1. In a terminal, run `gh api user --jq .login`. The printed name must be the **GitHub owner** in gear → **Account setup**. If **Run launch** says `SomeUser cannot create a repository for YourOwner`, run `gh auth login` as that owner and click **Run launch** again.
2. Website → **Launch** on this candidate.
3. Confirm **Domain**, **Business name**, **phone** (Twilio DID), **Leads email** = `leads@{domain}`.
4. **Email Routing destination** = the notify inbox from A6b (not `leads@`). Prefills from Account setup / `LEAD_NOTIFY_EMAIL`. Gmail connect and relaunch use that same address.
5. Leave **Auto ship** and **Connect domain and email** checked for first go-live.
6. If Launch preflight says **Forms inbox is not set up**, stop and finish one-time setup §7f — do not invent a Web3Forms key.
7. **Run launch** — wait (~3–5 min). Soft warnings (e.g. Workers Builds) are OK if ship + domain attached. Ship also attaches apex + www to the Worker when those hostnames are free. If Launch says no Cloudflare zone was found, the domain is not **Active** in this account yet — finish A6b, then click **Run launch** again.
8. If Chrome says the live site uses an unsupported protocol in the first minutes, reload. On the domain, **SSL/TLS** → **Edge Certificates** should list the name as **Active**.
9. Submit the **live** contact form. The message must arrive in the notify inbox and appear under **Phone/Form**. If it does not: confirm the site shipped after inbox setup, destination is Verified, and Cloudflare has `leads@{domain}` → that destination.

### A8. Indexing (day one)

1. Website → **5 · Indexing**.
2. **1. Submit to Search Console.** Rover verifies the Domain property with a Cloudflare DNS TXT record and submits `https://{domain}/sitemap.xml` once. Do not resubmit daily. Confirm **Open sitemap** loads a `<urlset>` of page URLs.
3. **2. Copy URL and open Search Console.** That opens URL Inspection for the homepage.
   1. Stay on the **GOOGLE INDEX** tab at the top right.
   2. Click **REQUEST INDEXING**.
   3. When the green **Indexing requested** box appears, click **Dismiss**. **URL is not on Google** stays until Google crawls the page. That is the queue, not a rejection.
   4. Click the top box **Inspect any URL in "{domain}"**.
   5. Paste one service URL (`https://{domain}/services/…/`) and press Enter.
   6. Click **REQUEST INDEXING**, then **Dismiss**.
   7. Repeat for one or two more service pages only. The sitemap covers the rest.
   **LIVE TEST** on a brand-new site can say **Failed: Robots.txt unreachable** and **URL is not available to Google** even when `https://{domain}/robots.txt` opens in your browser. That live-test page has no Dismiss. The circular arrow next to **Tested on** only retests. A red 404 in DevTools on the Search Console page is Google’s own icon. Settings → Crawling → **No robots.txt file** on day one is the same “not fetched yet” state. If **REQUEST INDEXING** is rejected and the live test still says robots.txt unreachable, open the domain → **Security** → **Settings** → group **Bot traffic** and leave **Bot fight mode** off. The old **Security → Bots** menu is gone.
4. A **Page with redirect** email (`http`, `www`, or a path with no trailing slash) means those redirects are working. Do **not** click **Validate fix**. Ignore 404 emails for URLs that are not on the site.
5. **3. Mark done.** That flag stays on after reload. In 2.8, Mark done closes the indexing buttons. Submit does not stay available for a later rebuild.

New domains often show **0 indexed** on the sitemap for days — normal. Do not thrash resubmits. Later: **Launched → Sync GSC / Check index**. The Launched page is three bands: **Portfolio** charts, **Search mix** (pages by type and top queries), then **Sites**. **Cluster tree** / **Flat list** switches the site list. Chart checkboxes limit the four daily charts; none checked uses every listed site.

### A9. Done for this site

- Site appears under **4 Launched** (Cluster tree by default: Zone → Cluster → Site).
- Later content/template fixes: **Prepare preview** → **Push updates** (not a full Run launch unless changing domain / destination / CF helpers).
- Already-live sites that still post to Web3Forms or lack `formsIngestUrl`: **Prepare preview → Push updates** (or Launch) once so Assemble writes the forms Worker URL.

---

## Part B — Second (and later) site in the same niche / metro

Same pipeline stages. Differences vs the Gilbert-style first site:

| Topic | 1st site (e.g. Gilbert) | 2nd+ site (e.g. another city, same niche) |
| --- | --- | --- |
| Discovery / Research | Full path to **pursue** | Same — each city is its **own** candidate |
| Domain | New domain every time | New domain every time |
| Forms inbox | Already set up once | **Reuse** — same Worker |
| Notify destination | Same `LEAD_NOTIFY_EMAIL` | Same destination (already Verified) |
| Email Routing | Launch creates `leads@{new-domain}` → destination | Same |
| Twilio phone | **Provision** a new ranking DID | New DID per site |
| Service area | Primary + Also serving | New primary city; Also serving list for **that** market. Avoid stealing another site’s location **Page** without meaning to |
| Photos | Skip photo group → fill **all** Empty materials/process → **Save photo group** + Prepare preview / Replace master | Leave 1st dropdown on **{Niche} master** → **Load** → Load on Accept → Accept with Skip stock on. If empties remain, fill once → **Replace master** → Load onto siblings (A5b) |
| Review services | Build from niche / Save niche default when useful | Load niche default or Build from niche again |
| Business name | `{City} {Niche}` (e.g. Gilbert Smart Home Automation) | New city name on **Edit draft**, not one shared name |
| Site-Config Accept | Review services → **Write with placeholders** if needed | Same. Fix `example.com` / `leads@example.com` in Edit draft before that click |
| Logo / coverage map | Generated on Accept | Regenerated per site (brand/city specific) |
| Content | Full Write site | Full Write site for the new city (do not copy Gilbert markdown by hand) |
| Prepare preview / Launch | Serial — one at a time | Same — never two Prepare/Launch on one machine overlapping |
| Indexing | **Submit to Search Console**, then request indexing, then **Mark done** | New Domain property + `sitemap.xml` for the **new** domain |

### B0. Find other cities in the same metro / niche cluster

After the first city is live (or deep in Website), sibling cities are often already in **Research** as separate candidates — not under the first city’s detail page.

**Do not use the Research “Cluster:” dropdown for this.** That filter is shotgun **Cl 1–20** (rental-package key). Metro siblings from a Discovery “cluster” batch usually do **not** share that filter value.

**Step-by-step (Research list):**

1. Open stage **2 Research** (sibling cities that are not yet **pursue** stay here — not under Launched).
2. Set **Decision** to **all** or **hold**. Cluster siblings are often left on **hold** until you pick the next city (they will not show if Decision is filtered to **pursue** only).
3. Leave **Cluster** on **all**.
4. In **FIND**, type the niche (e.g. `smart home`) or a city name (e.g. `mesa`, `chandler`).
5. Optional: open **Batch** and choose the Discovery batch named like `cluster-{niche}-…` (same batch that created the metro package).
6. Open the next city row → finish SERP seeds + Narrative → set decision to **pursue** when ready → continue Site-Config as in Part A / B1.

**Example (Smart Home Automation, East Valley):** after Gilbert, expect Research rows such as Mesa, Chandler, Queen Creek, San Tan Valley (often **hold**). Each gets its own domain, Twilio DID, and launch — same forms inbox and notify destination.

**Also serving ≠ next site.** Towns listed as Also serving on Gilbert’s service-area map are coverage on that site — they are **not** automatically Research candidates. Only process a town as a new site when it appears as its own candidate (or you create one via Discovery).

### B1. Recommended order for site 2+

1. Find the next city candidate (**B0**) → Research → **pursue**.
2. Site-Config → city-specific name + real domain in **Edit draft** → Review services (**Build from niche** / niche default as needed) → Accept → Service area (remove towns from **Selected cities**; one nearby leftover page is fine) → **Provision phone**.
3. Content → Structure (**use Preset C**) → **Write site** (retry if homepage YAML fails) → leave the niche **master** selected → **Load** → Load on Accept → Accept (Skip stock on). Then Launch.
4. Review images: Filter Empty. If 0, Prepare preview → QA. If empties remain, follow **A5b** (fill → Replace master → Load onto siblings) before you pay to regenerate the same slots on every city.
5. Buy the domain in this Cloudflare account until it is **Active** (A6b) → destination already Verified → Run launch → Indexing (**Submit to Search Console**, **GOOGLE INDEX** → **REQUEST INDEXING** on the homepage and 2–3 services, **Mark done**).

### B2. What you reuse vs recreate

**Reuse (same niche / machine):** forms inbox, `LEAD_NOTIFY_EMAIL`, niche service default, niche photo-block titles, `{Niche} master` / named photo groups, **always Preset C**, palette habits.

**Always recreate:** domain, Cloudflare zone cutover for that domain, `leads@` routing rule (Launch), Twilio DID, site-config Accept, Write site **city prose**, Assemble/ship, GSC property. Do **not** rename services away from the niche default if you want master photos to land in the right slots.

---

## Part C — Quick checklists

### Every site (print / sticky)

- [ ] Research Narrative Accept + decision **pursue**
- [ ] Site-Config Accept + Service area set
- [ ] Twilio **Provision ranking number** + smoke call
- [ ] Structure → **Use Preset C**
- [ ] Write site / Content Accept (Skip stock understood)
- [ ] Prepare preview + QA
- [ ] Domain bought in this Cloudflare account (**Domains → Overview → Add domain**, status **Active**)
- [ ] Notify destination Verified (once); Forms inbox already green
- [ ] `gh` login matches **GitHub owner**
- [ ] Run launch (**Auto ship** + **Connect domain and email**) — no Web3Forms key
- [ ] Live form smoke-test → notify inbox + Phone/Form
- [ ] Indexing **Submit to Search Console** (`https://{domain}/sitemap.xml`)
- [ ] **GOOGLE INDEX** → **REQUEST INDEXING** on the homepage + 2–3 services (**Dismiss** the green box)
- [ ] Indexing **Mark done**

### Do not

- Switch Structure off **Preset C** (A/B or cleared boxes) on a normal same-niche build
- Create a Web3Forms form / paste an access key (removed for go-live; use forms inbox)
- Put a personal mailbox as the public site email instead of `leads@{domain}`
- Request indexing on every URL the first day
- Treat GSC “Page with redirect” on www as a broken site — apex is correct
- Hand-edit a single assembled folder under `rover-sites/` as the forever fix — fix template / Rover / prompts, then Prepare preview → Push updates
- Run two Prepare preview / Launch jobs on the same machine at once

---

## After go-live (light ops)

| Action | When |
| --- | --- |
| **Push updates** | Content/template change after Prepare preview; or to attach forms inbox URL on older live sites |
| **Run launch** | Changing domain / Email Routing destination / re-running Cloudflare email-domain helpers |
| **Launched → Sync GSC / Check index** | After Connect GSC; weekly glance |
| **Phone** / **Phone/Form** | Review voicemails and form leads; later **Set forward to renter** when rented |
| **Citations / NAP CSV** | Optional off-page; Launch checklist + Download NAP CSV |

Ranks take weeks to months. Indexing ≠ ranking.

---

## Reference map

| Need | Doc |
| --- | --- |
| Every screen/control | [USER-GUIDE.md](USER-GUIDE.md) |
| Time estimates | [USER-FLOW.md](USER-FLOW.md) |
| Run launch fields | [LAUNCH.md](LAUNCH.md) |
| Assemble / ship / forms Worker | [ASSEMBLE-AND-LAUNCH.md](ASSEMBLE-AND-LAUNCH.md) |
| GSC / sitemap | [SITE-INDEXING.md](SITE-INDEXING.md) |
| Twilio ranking → rent | [PHONE-TRACKING.md](PHONE-TRACKING.md) |
| Multi-site day schedule | [OPERATOR-CADENCE.md](OPERATOR-CADENCE.md) |
| One-time setup checklist | [OPERATOR-ONE-TIME-SETUP.md](OPERATOR-ONE-TIME-SETUP.md) |
| Operator flowcharts (+ keep-in-sync checklist) | [OPERATOR-FLOWS.md](OPERATOR-FLOWS.md) · [flows/](flows/) |
| Every Settings key | [ENV-SETUP.md](ENV-SETUP.md) |
