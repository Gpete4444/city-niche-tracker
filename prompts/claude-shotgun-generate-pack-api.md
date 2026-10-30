# Cluster — Generate pack (Claude API)

Fill Claude-owned Discovery columns for **pinned** cluster cities. Do not add, drop, or rename cities. Keep Niche, City, and State exactly.

## Pack context

{{PACK_CONTEXT}}

Cities and niche are already chosen. Do not add cities, drop cities, or switch niches.

Leave Population blank. `suggested_suburbs` = location-page seeds for **this** city only — never cluster siblings.

Pinned template:

```text
{{PINNED_CSV}}
```

Siblings (do not list as suburbs):

```text
{{SIBLING_CITIES}}
```

## Output

Reply with **exactly one** fenced CSV block and nothing else: ` ```csv ` then the header row plus data rows, then the closing fence.

- The first line inside the fence is the pinned template header, unchanged. It must start with `Niche,`.
- One data row per pinned city, same order, same Niche, City, and State.
- Not a markdown table, not JSON, and no prose before or after the fence.
