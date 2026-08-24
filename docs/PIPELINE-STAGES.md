# Pipeline stages (operator funnel)

**User-facing walkthrough (discovery → launch):** [USER-FLOW.md](USER-FLOW.md)

Rover’s **operator stages** (how you work the product) are separate from internal research API “stages” (SERP / enrich / prospects).

## Four funnel stages

| Stage | Top nav | What happens | Conversion |
|-------|---------|--------------|------------|
| **1 · Discovery** | Discovery | Huge set of potential markets; light review | Low % advance |
| **2 · Research** | Research | Hard data: SERP, keywords, enrich, narrative, prospects. Last filter before commit | Low % advance |
| **3 · Website Builder** | Website Builder | **All** committed candidates get full build (Site-Config → Content → Prepare / Launch) | High completion |
| **4 · Launched Sites** | Launched Sites | Portfolio tracking, rent, phone provision / forward — not the build workshop | Ongoing ops |

**Official Candidate (committed):** a market that has entered **Website Builder** (typically **pursue**). Everything from Site-Config onward is expected to be completed.

**Map** is a geography assist (not a funnel stage). It sits between Research and Website Builder in the top nav.

**Phone** is call-ops chrome (not a funnel stage): review answered/missed calls, recordings, and AI summaries across DIDs.

```mermaid
flowchart LR
  disc[1_Discovery]
  res[2_Research]
  web[3_WebsiteBuilder]
  sites[4_LaunchedSites]
  disc -->|"low pct"| res
  res -->|"pursue / promote"| web
  web -->|"Launch"| sites
```

## Top nav (names, order, groups)

**Order:** Discovery → Research → Map → Website Builder → Launched Sites → Phone

| Group label | Tabs |
|-------------|------|
| **Potential Candidates** | Discovery, Research |
| *(ungrouped)* | Map |
| **Candidates** | Website Builder, Launched Sites, Phone |

Group labels are chrome only (not clickable). Main tabs are prominent; the **active** tab is strongly highlighted.

## Mapping to older UI

| Today (legacy) | Target |
|----------------|--------|
| Discovery | Discovery |
| Candidates (research + build mixed) | Split: **Research** + **Website Builder** |
| Map | Map |
| Sites | **Launched Sites** |

Detail sub-tabs:

- **Research view:** Overview, Research, Keywords, Enrich, Narrative, Prospects, Logs  
- **Website Builder view:** Overview, Site-Config, Content, Website (Prepare/Launch), Logs  

Promotion: **pursue** (or equivalent) moves a row into Website Builder’s working set.

## Phone tracking

Once in **Website Builder**, a ranking number is expected. Preferred path: **provision after Site-Config Accept** (business name + geo real), then Prepare / Launch. Rent cutover keeps the same Twilio DID and sets forward to `renter.phone`. Review answered/missed calls, recordings, and AI summaries on the **Phone** tab (Sites has a deep link). See [PHONE-TRACKING.md](PHONE-TRACKING.md).

Do **not** buy Twilio numbers in Discovery or Research. CallRail is not used.

## Related docs

- User walkthrough: [USER-FLOW.md](USER-FLOW.md)
- Production flowchart: [MASTER-FLOW.md](MASTER-FLOW.md)
- Phone ops: [PHONE-TRACKING.md](PHONE-TRACKING.md)
