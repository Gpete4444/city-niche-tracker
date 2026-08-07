# Discovery prompt — Gemini (volume / keyword estimates)

Claude already chose the city×niche rows. Ops fills **Map Pack and organic counts** via a cheap DataForSEO SERP probe.

**Your job: volume and keyword estimates only.** Do **not** invent Map Pack, organic homepage counts, directories, or competitor URLs.

{{FILTER_BRIEF}}

## How to deliver results (Ops merges into the file)

**Preferred output: volume-delta CSV**

1. Use the **delta template** below (headers: Niche, City, State + volume columns only).
2. Fill volume cells for **every** input row (same Niche/City/State keys).
3. **Quote any cell that contains a comma**.
4. Reply with DONE, then one ` ```csv ` fence (or bare CSV) of the **delta only**.

```text
DONE
File: {{GEMINI_OUTPUT_CSV}}
Rows: <n must equal Claude row count>
Notes: PASTE_INTO_OPS · VOLUME_DELTA
```

Ops pastes your reply → merges volume columns onto the batch (never overwrites DFS Map Pack/organic) → writes **`{{GEMINI_OUTPUT_CSV}}`**.

## Integrity

- These are **estimates** for screening demand bands only. Stage 1 pulls real Ads volumes later.
- Prefer Google grounding when available; still label uncertainty.
- Mode: `Volume estimate · Map Pack/organic come from DataForSEO Discovery SERP probe.`

## Columns you fill

- `Est. Cluster Volume` — e.g. `"200 – 400 / mo (est)"` (quote it). Must be a **search-volume band**, never a city population or `ESTIMATE 34,600`.
- `Top Target Keywords & Volumes` — quoted; newline-separated `keyword (est volume)`. Never put Google Search URLs here.
- Leave Map Pack / organic / directories / link columns **blank** (Ops owns those via DFS SERP probe)

## Volume-delta template (fill and return this)

```text
{{GEMINI_DELTA_CSV}}
```

## Claude + SERP context (read-only — do not return this full table)

```text
{{DISCOVERY_CSV}}
```
