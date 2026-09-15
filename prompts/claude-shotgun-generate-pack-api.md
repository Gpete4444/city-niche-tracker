# Cluster — Generate pack (Claude API)

Fill Claude-owned Discovery columns for **pinned** cluster cities. Do not add, drop, or rename cities. Keep Niche, City, State exactly.

{{FILTER_BRIEF}}

Leave Population blank. `suggested_suburbs` = location-page seeds for **this** city only — never cluster siblings.

Pinned template:

```text
{{PINNED_CSV}}
```

Siblings (do not list as suburbs):

```text
{{SIBLING_CITIES}}
```
