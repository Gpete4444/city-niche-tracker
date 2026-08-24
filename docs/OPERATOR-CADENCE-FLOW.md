# Operator cadence — flowchart

Visual map of **weekly prep** (outside the day) vs the **daily 5-hour** build/launch block. Full narrative: [OPERATOR-CADENCE.md](OPERATOR-CADENCE.md).

**Best view:** open the colorful interactive page → [OPERATOR-CADENCE-FLOW.html](OPERATOR-CADENCE-FLOW.html) (double-click in Finder/Explorer, or open from the `docs` folder).

![Weekly prep vs daily waves and serial launch](images/operator-cadence/overview-flow.png)

---

## Two clocks at a glance

```mermaid
flowchart TB
  subgraph weekly [Weekly_prep_OUTSIDE_daily_5h]
    direction LR
    D["Discovery"]
    R["Research"]
    P["Pursue_~50"]
    D --> R --> P
  end

  subgraph daily [Daily_5h_build_and_launch]
    direction TB
    Q["Today_take_10_from_queue"]
    subgraph waves [Parallel_waves_of_3_to_4]
      direction TB
      WA["Wave_A_sites_1_to_4<br/>SiteConfig_then_Content"]
      WB["Wave_B_sites_5_to_8<br/>during_A_launches"]
      WC["Wave_C_sites_9_to_10<br/>fill_gaps"]
      WA --> WB --> WC
    end
    subgraph launch [Serial_launch_rail]
      direction TB
      PR["Prepare_preview_one"]
      LN["Launch_ship_one"]
      PR --> LN
    end
    Q --> WA
    WA -->|"first_Accept"| PR
    LN -->|"ship_waits"| WB
    WB --> PR
    WC --> PR
  end

  P -->|"queue_for_the_week"| Q

  classDef weekly fill:#ccfbf1,stroke:#0f766e,color:#134e4a
  classDef daily fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e
  classDef wave fill:#ffedd5,stroke:#b45309,color:#7c2d12
  classDef launch fill:#ffedd5,stroke:#c2410c,color:#7c2d12
  classDef queue fill:#d1fae5,stroke:#047857,color:#064e3b

  class D,R,P weekly
  class Q queue
  class WA,WB,WC wave
  class PR,LN launch
```

---

## Legend

| Color / lane | Meaning |
|--------------|---------|
| Teal weekly strip | **Not** in the daily 5h — Discovery → Research → ~50 pursue |
| Blue / amber / mint waves | Parallel Site-Config + Content (3–4 sites) |
| Coral launch rail | **One at a time** — Prepare (`:4322`) then Launch |
| Metrics | **You ~2.2h** hands-on · **Calendar ~3.5–5h** until 10 live |

---

## Rules etched on the chart

1. Weekly prep clock ≠ daily 5h clock.
2. Parallelize Content across candidates (prefer one Rover window + multiple Claude chats).
3. Never overlap Prepare / Launch; never the same candidate in two tabs.
4. Use ship waits to advance the next wave.

---

## Related

- [OPERATOR-CADENCE.md](OPERATOR-CADENCE.md) — full schedule math
- [USER-FLOW.md](USER-FLOW.md) — per-step times
- [OPERATOR-CADENCE-FLOW.html](OPERATOR-CADENCE-FLOW.html) — colorful HTML poster
