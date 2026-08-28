# Rover — work flow & naming

Plain-language charts for operators. Detailed time estimates live in [USER-FLOW.md](USER-FLOW.md).

## Work flow

Find markets → study them → build the site → go live.

```mermaid
flowchart TD
  start([Start]) --> D

  subgraph D [Stage 1 · Discovery — Find markets]
    D1[New pack] --> D2[Claude]
    D2 --> D3[Import]
    D3 --> D4[Light SERP]
    D4 --> D5[Decision]
    D5 --> D6[Process batch]
  end

  D6 -->|keepers| R
  D6 -->|pass| Tracked[Tracked only · do-not-repropose]

  subgraph R [Stage 2 · Research — Study the market]
    R1[Eval 1 · SERP / Volume] --> R2[Eval 2 · Enrich]
    R2 --> R3[Eval 3 · Narrative]
    R3 --> R4[Eval 4 · Prospects · optional]
    R3 --> Decide{Decision}
  end

  Decide -->|pursue| W
  Decide -->|maybe / review / hold / pass| Stay[Stay in Research or exit]

  subgraph W [Stage 3 · Website — Build the site]
    W1[Track 1 · Site-Config] --> W2[Track 2 · Content]
    W2 --> W3[Track 3 · Launch]
  end

  W3 --> L

  subgraph L [Stage 4 · Launched — Go live]
    Live[Launched portfolio]
  end

  Helpers[Helper screens · Phone · Map] -.-> L
```

Most markets stop early on purpose. Only **pursue** becomes a **Website Candidate** and gets a full site.

## Naming structure

```mermaid
flowchart TB
  subgraph Stages [Stages]
    direction LR
    S1[1 Discovery] --- S2[2 Research] --- S3[3 Website] --- S4[4 Launched]
  end

  Stages --> Step[Step]
  Stages --> Evaluation[Evaluation]
  Stages --> Track[Track]
```

| Term | Meaning |
| ---- | ------- |
| **Stage** | Top-bar pipeline: 1 Discovery → 2 Research → 3 Website → 4 Launched |
| **Evaluation** | Numbered checklist inside Research (SERP/Volume → Prospects) |
| **Track** | Numbered checklist inside Website (Site-Config → Content → Launch) |
| **Step** | Numbered action inside Discovery or inside a Track |

**Easy mix-ups:** Light SERP is a Discovery **Step**, not Research Evaluation 1. **Site research** is a Content Track step (not “field research” in the UI).
