# Pipeline stages (operator funnel)

**User-facing walkthrough (discovery → launch):** [USER-GUIDE.md](USER-GUIDE.md) · times: [USER-FLOW.md](USER-FLOW.md)

Rover’s **Stages** (top-bar pipeline) are separate from Research **Evaluations** (SERP/Volume → Prospects) and Website **Tracks** (Site-Config → Content → Launch).

## Four Stages

| Stage | Top nav | What happens | Conversion |
|-------|---------|--------------|------------|
| **1 · Discovery** | Discovery | Huge set of potential markets; Light SERP + decide; Process | Low % advance |
| **2 · Research** | Research | Hard data: Evaluations (SERP/Volume, Enrich, Narrative, Prospects). Last filter before commit | Low % advance |
| **3 · Website** | Website | **Website Candidates** (`pursue`) get full build (Tracks: Site-Config → Content → Launch) | High completion |
| **4 · Launched** | Launched | Portfolio tracking, rent, phone provision / forward — not the build workshop | Ongoing ops |

**Candidate ranks:** Discovery Candidate → Research Candidate (after Process) → Website Candidate (`pursue`) → Launched Candidate.

**Phone**, **Map**, and **Photo** are satellites (not Stages): Phone = call-ops; Map = geography assist; Photo = optional photo-group organizer. Top-bar order places them **after** Stage 4.

```mermaid
flowchart LR
  disc[1_Discovery]
  res[2_Research]
  web[3_Website]
  sites[4_Launched]
  disc -->|"Process"| res
  res -->|"Decision pursue"| web
  web -->|"Launch"| sites
```

## Top nav (names and order)

**Order:** `1 Discovery` → `2 Research` → `3 Website` → `4 Launched` · `Phone` · `Map` · `Photo`

| Kind | Tabs |
|------|------|
| **Stages** (numbered + arrows) | Discovery, Research, Website, Launched |
| **Satellites** (unnumbered) | Phone, Map, Photo |

## Evaluations vs Tracks

| Research Evaluations | Website Tracks |
|----------------------|----------------|
| 1 · SERP / Volume (+ Keywords) | 1 · Site-Config |
| 2 · Enrich | 2 · Content |
| 3 · Narrative | 3 · Launch |
| 4 · Prospects | |

**Light SERP** = Discovery-only cheap Map Pack/organic probe (not Evaluation 1).

Promotion: **pursue** moves a Research Candidate into Website’s working set.

## Phone tracking

Once in **Website**, a ranking number is expected. Preferred path: **provision after Site-Config Accept** (business name + geo real), then Prepare / Launch. Rent cutover keeps the same Twilio DID and sets forward to `renter.phone`. Review answered/missed calls, recordings, and AI summaries on the **Phone** tab. See [PHONE-TRACKING.md](PHONE-TRACKING.md).

Do **not** buy Twilio numbers in Discovery or Research. CallRail is not used.

## Related docs

- User walkthrough: [USER-FLOW.md](USER-FLOW.md)
- Production flowchart: [MASTER-FLOW.md](MASTER-FLOW.md)
- Phone ops: [PHONE-TRACKING.md](PHONE-TRACKING.md)
