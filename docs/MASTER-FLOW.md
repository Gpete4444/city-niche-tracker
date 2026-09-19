# Rover — master flow

Shareable overview of the full project: how a market becomes a live lead-gen site, and which tools do which work.

**What this is:** **Rover** finds local niches worth ranking for, then ships a static lead-gen website per market (rank-and-rent style). You rent the site (or its leads) to a local operator. One **master template** plus the local **Rover dashboard** drive the pipeline; each live site is its **own GitHub repo** hosted on **Cloudflare Workers**. Forms go through **Web3Forms**; `leads@` mail uses **Cloudflare Email Routing**.

**Operator funnel (Discovery → Research → Website Builder → Launched Sites):** see [PIPELINE-STAGES.md](PIPELINE-STAGES.md).  
**Operator manual (screens and buttons):** [USER-GUIDE.md](USER-GUIDE.md). Time estimates: [USER-FLOW.md](USER-FLOW.md).

**Repo:** [github.com/7D7D/Rover](https://github.com/7D7D/Rover)

---

## Master flowchart

Phases read **left to right in two rows**; sub-steps stack vertically inside each phase box. Nodes marked **human** are still manual.

```mermaid
flowchart TB
  subgraph row1 [Phases 1 to 5]
    direction LR

    subgraph disc [1 Discover markets]
      direction TB
      d1["Census place seeds"] --> d2["Create discovery pack"]
      d2 --> d3["Process batch"]
      d3 --> d4["Candidate list in ops"]
    end

    subgraph res [2 Research SERP]
      direction TB
      r1["Stage 1 SERP and keywords"] --> r2["Stage 2 enrich when recommended"]
      r2 --> r3["Optional Stage 4 renter prospects"]
    end

    subgraph dec [3 Decide pursue]
      direction TB
      e1["Claude narrative draft"] --> e2["Human Accept or reject"]
      e2 --> e3["Pursue gate unlocks build"]
    end

    subgraph scfg [4 Site config]
      direction TB
      s1["NAP plus Claude prompt"] --> s2["Paste or edit draft"]
      s2 --> s3["Accept site-config.json"]
    end

    subgraph cont [5 Content]
      direction TB
      c1["Structure H2 checklist"] --> c2["Outline Load and confirm"]
      c2 --> c3["Full-write FILE paste"]
      c3 --> c4["Auto speech check"]
      c4 --> c5["Accept"]
    end

    disc --> res --> dec --> scfg --> cont
  end

  subgraph row2 [Phases 6 to 10]
    direction LR

    subgraph stg [6 Stage preview]
      direction TB
      t1["Stage homepage to site-staging"] --> t2["Astro preview QA"]
    end

    subgraph asm [7 Assemble]
      direction TB
      a1["Assemble sibling site folder"] --> a2["Local npm run build smoke"]
    end

    subgraph ship [8 GitHub plus CF Worker]
      direction TB
      h1["Launch Auto ship: gh create and push"] --> h2["npm build plus Wrangler deploy"]
      h2 --> h3["Optional Workers Builds connect"]
    end

    subgraph launch [9 Launch]
      direction TB
      l1["Buy domain and point NS — human"] --> l2["Create Web3Forms form — human"]
      l2 --> l3["Paste access key in Rover Launch"]
      l3 --> l4["Rover Launch Email Routing and custom domain"]
      l4 --> l5["Verify Gmail destination — human"]
    end

    subgraph live [10 Live / rent]
      direction TB
      v1["Form and leads@ receive leads"] --> v2["Track on Sites tab"]
      v2 --> v3["Hand off site or leads to renter"]
    end

    stg --> asm --> ship --> launch --> live
  end

  cont --> stg
```

Open on GitHub or [mermaid.live](https://mermaid.live) to view the rendered boxes (paste the `mermaid` code block). Left-to-right in two rows.

### Steps: what happens and why

| Step | What happens | Why it exists |
| --- | --- | --- |
| **1 · Discover markets** | Rover discovery packs + census place seeds shortlist niches/cities. | Avoid building sites in dead markets; start from population and niche fit. |
| **2 · Research SERP** | DataForSEO SERP/keywords (and related signals) score opportunity. | Prove search demand and that competition is beatable before spending content time. |
| **3 · Decide pursue** | Claude narrative + human Accept; decision = pursue / skip. | Gate expensive work (site-config, content, domain) to winners only. |
| **4 · Site config** | Lock business name, domain, phone, email, services, suburbs, brand. | One JSON source of truth so pages, schema, and CTAs stay consistent. |
| **5 · Content** | **Structure** → outline SEO (keywords + SERP PAA/organic titles) → **Load & confirm** → full-write FILE paste (auto speech check) → **Editor** only if leftovers → Accept (critical SEO needs override). Prefer Preset C. Content SEO letter grade: [SEO-RATING.md](SEO-RATING.md). | Best SEO value: operator-chosen sections, SERP-grounded FAQs/keywords, human-speech pass before Accept. |
| **6 · Stage preview** | Stage **full** site (all Structure-selected pages including every service/location FILE) into `site-staging/`, then Assemble + open **every** preview sitemap URL on :4322. Re-Assemble after every Stage (stale warning if skipped). | Catch wrong market/content before Launch — preview must match what ships. |
| **7 · Assemble** | Copy template + inject staging into `rover-sites/{slug}`. | Isolate each domain in its own folder/repo (clone-per-site). |
| **8 · GitHub + CF Worker** | First go-live: Launch Auto ship. Later updates: **Push updates** (ship only) after Prepare preview. | Cheap global hosting with one Worker project per site — no per-site terminal. |
| **9 · Launch** | Email Routing (`leads@` → Gmail); create Web3Forms form with Recipient Emails = `leads@{domain}`; paste key; Rover ships + attaches domain. Full button reference: [LAUNCH.md](LAUNCH.md). | Go live on the real domain with working form and `leads@` inbox. |
| **10 · Live / rent** | Leads hit inbox/form; hand site or leads to a local renter. Track inventory on the **Sites** tab (rent status, pricing, payment method, CF/Web3Forms links). Day-one indexing (GSC, sitemap, Request indexing): [SITE-INDEXING.md](SITE-INDEXING.md). | The business model: ranked site → rented asset. |

### Still human (API cannot fully automate)

- **Buy the domain** and point nameservers at Cloudflare (step 9).
- **Create** a Web3Forms form with Recipient Emails = `leads@{domain}` (not the account Gmail) and paste the access key (step 9).
- **Verify** Email Routing destination once, then the Web3Forms `leads@` verify link (step 9).
- **One-time machine setup:** `gh auth login` + `.env` (`GITHUB_OWNER`, `CLOUDFLARE_*`) — not per site.

Detailed runbook: [ASSEMBLE-AND-LAUNCH.md](ASSEMBLE-AND-LAUNCH.md). **Run launch** button reference: [LAUNCH.md](LAUNCH.md). After go-live indexing: [SITE-INDEXING.md](SITE-INDEXING.md).

---

## Tools legend

| Tool | Used for |
| --- | --- |
| Rover dashboard (`npm run rover`) | Local pipeline UI / orchestration |
| DataForSEO | SERP, keywords, maps, enrichment signals |
| Census places CSV | City/population seeds for discovery |
| Claude (Anthropic) | Narrative, site-config draft, content writing |
| Astro + Tailwind | Site template / static pages |
| Local IDE / Cursor | Edit template, ops, prompts |
| GitHub | Template repo + one repo per live site |
| Cloudflare Workers | Host/build/deploy static site |
| Cloudflare Email Routing | `leads@` → inbox |
| Cloudflare Turnstile | Optional form spam protection |
| Web3Forms | Contact form → email |
| Domain registrar | Buy/point domain nameservers |
| Gmail (or inbox) | Receive forwarded `leads@` mail (forms + mailto) |
| Wrangler / CF Builds | `npx wrangler deploy` in CI |

---

## Tools × steps matrix

`X` = that tool is actively used in that step.

| Tool | 1 Discover | 2 Research | 3 Decide | 4 Site config | 5 Content | 6 Stage | 7 Assemble | 8 Ship | 9 Launch | 10 Live |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Rover dashboard | X | X | X | X | X | X | X | | X | |
| DataForSEO | X | X | | | | | | | | |
| Census places CSV | X | | | | | | | | | |
| Claude (Anthropic) | | | X | X | X | | | | | |
| Astro + Tailwind | | | | | X | X | X | X | | X |
| Local IDE / Cursor | X | X | X | X | X | X | X | X | X | |
| GitHub | | | | | | | X | X | X | |
| Cloudflare Workers | | | | | | | | X | X | X |
| Cloudflare Email Routing | | | | | | | | | X | X |
| Cloudflare Turnstile | | | | | | | | | X | X |
| Web3Forms | | | | | | | | | X | X |
| Domain registrar | | | | | | | | X | X | |
| Gmail (or inbox) | | | | | | | | | X | X |
| Wrangler / CF Builds | | | | | | | | X | | |

---

## Costs (stage and tool)

Estimates align with Rover pre-run modals ([`ops/lib/cost-estimates.mjs`](../ops/lib/cost-estimates.mjs)). DataForSEO and Claude figures are **estimates**, not invoices; provider list prices change.

**Rough all-in per new site (research + content + domain year 1):** about **$11–$20** on free hosting/forms (domain dominates). Typical pursue-path API/AI spend is often **~$1–$5** without heavy enrich.

### Per-stage variable costs

| Stage | Primary tools | Typical cost / site (USD) | Notes |
| --- | --- | --- | --- |
| 1 Discover | Rover, Census CSV, Claude (pick rows), DataForSEO SERP probe | ~$0.002/row probe + small Claude | Probe is cheap; Claude for pack narrative varies by tokens |
| 2 Research | DataForSEO Stage 1 | $0–$0.002 seeds, or ~$0.20–$1.50 Ads | Cheap path reuses Discovery SERP; Ads volumes optional |
| 2b Enrich | DataForSEO Stage 2 | ~$0.05–$0.80 | Optional; does not block Narrative / Website |
| 2c Prospects | DataForSEO Stage 4 | ~$0.05–$0.40 | Optional; does not block build |
| 3 Decide | Claude narrative | ~$0.05–$0.50 est. | Sonnet list ~$2/$10 per MTok; required to build |
| 4 Site config | Claude draft | ~$0.02–$0.20 est. | One JSON draft |
| 5 Content | Claude researcher / outline / writer | ~$0.20–$2.00 est. | Largest Claude spend; homepage-first is cheaper than full suite |
| 6–7 Stage / Assemble | Rover, Astro, local machine | $0 | No paid API |
| 8 Ship | GitHub, CF Workers, Wrangler | $0 on free tiers | Still buy domain separately |
| 9 Launch | Web3Forms, CF Email Routing, Turnstile, registrar | Domain ~$10–15/yr; APIs $0 | Web3Forms free ~250 submissions/mo |
| 10 Live / rent | Web3Forms, Email Routing, Gmail | $0 until form volume / paid CF | Call tracking: Twilio intelligence — see [`docs/PHONE-TRACKING.md`](PHONE-TRACKING.md); not in this cost table |

### Per-tool billing

| Tool | Billing model | Rover use cost |
| --- | --- | --- |
| Rover dashboard | Local free | $0 |
| Census CSV | In-repo | $0 |
| DataForSEO | Pay-as-you-go API | See stage ranges above |
| Claude (Anthropic) | Token usage | See stage ranges; model override via `ANTHROPIC_MODEL` |
| Astro / Tailwind / IDE | Local / free | $0 |
| GitHub | Free private OK for this scale | $0 |
| Cloudflare Workers | Free tier (~100 Workers) | $0 typical static |
| CF Email Routing | Free inbound | $0 |
| CF Turnstile | Free typical | $0 |
| CF Management API | No per-call fee | $0 |
| Web3Forms | Free ~250/mo; paid ~$5–18+/mo | $0 until over free |
| Domain registrar | Annual | ~$10–15/site/year |
| Gmail | Free | $0 |

Does not include your time, phone tracking (Twilio), or analytics add-ons.

---

## Out of scope

Images polish, template design tweaks, and deep SEO compare work are parked in [BACKLOG.md](BACKLOG.md). Current content-pipeline SEO letter grade: [SEO-RATING.md](SEO-RATING.md). Post-launch Google indexing: [SITE-INDEXING.md](SITE-INDEXING.md). This flowchart is the **production path** from discovery to a rentable live site.
