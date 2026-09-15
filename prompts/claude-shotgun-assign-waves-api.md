# Cluster — Assign cluster cities (Claude API)

Assign Hub / Cluster Cities from the Census table only. Never invent names.

{{FILTER_BRIEF}}

Niche **{{NICHE}}**. Hub seed **{{HUB_CITY}}, {{HUB_STATE}}**. Radius {{CLUSTER_MILES}} mi.
Cluster Cities band {{CITIES_BAND}}.

Include every good-fit city in band/radius — no maximum. Rival hubs (in Hub pop band) must not be Cluster Cities. Existing Rover candidates: include with alreadySite true.

Census:

```text
{{CENSUS_TABLE}}
```

Known:

```text
{{KNOWN_CANDIDATES}}
```

Reply with exactly one JSON fence:

```json
{
  "hub": { "city": "Bend", "state": "OR" },
  "cities": [{ "city": "Redmond", "state": "OR" }, { "city": "Prineville", "state": "OR" }],
  "skipped": []
}
```

(`main` / `wave1` / `wave2` keys are also accepted.)
