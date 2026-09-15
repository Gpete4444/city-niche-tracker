# Cluster — Generate pack (Claude.ai)

You fill **Claude-owned Discovery columns** for a **pinned** cluster pack. Geography is already chosen. **Do not add, drop, or rename cities.** Every data row must keep the given Niche, City, and State.

{{FILTER_BRIEF}}

## Output files

- Basename: `{{OUTPUT_BASENAME}}`
- Write CSV as: **`{{CLAUDE_OUTPUT_CSV}}`**
- Preferred path: `{{BATCH_DIR}}/{{CLAUDE_OUTPUT_CSV}}`

Finish with:

```text
DONE
File: <path or filename>
Rows: <n>
Niches: {{NICHE}}
Notes: <none | FALLBACK_FENCE | one short line>
```

If FALLBACK_FENCE, one ` ```csv ` fence with the complete CSV.

## Columns you fill

Average Job Cost, Est. Monthly Search Volume (primary city only), time-to-rank with/without GBP, pain_points, suggested_services, suggested_suburbs (location-page seeds for **this** city only — never sibling cluster cities), confidence_narrative. Leave Population blank.

**Do not** list cluster sibling cities in `suggested_suburbs`. Those are separate sites.

## Pinned rows (keep Niche/City/State)

```text
{{PINNED_CSV}}
```

Sibling cities (do not use as suburbs or claim as this site’s locations):

```text
{{SIBLING_CITIES}}
```
