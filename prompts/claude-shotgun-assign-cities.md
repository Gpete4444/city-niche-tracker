# Cluster — Assign cluster cities (Claude.ai)

You assign **Hub / Cluster Cities** for one cluster metro. Use **only** the Census place table. Never invent names.

{{FILTER_BRIEF}}

{{ZONE_GUIDE}}

**Niche:** {{NICHE}}
**Hub seed:** {{HUB_CITY}}, {{HUB_STATE}}
**Radius:** {{CLUSTER_MILES}} mi (or inner {{INNER_MILES}} · outer {{OUTER_MILES}})
**Cluster Cities pop band:** {{CITIES_BAND}}

## Roles

- **Hub:** the hub (or the best independent-demand city in range if the seed is wrong).
- **Cluster Cities:** every good-fit city in band and radius — no maximum. Real municipalities with their own “niche + city” intent.
- A neighbor in the **Hub** pop band is a **rivalHub** — leave it out (unassigned / skipped with reason).
- Cities that already have a Rover candidate: **include them** and set `"alreadySite": true`. Do not skip them just because they exist.
- Skip bedroom CDPs with no independent search name.

## Census places (only pick from this list)

```text
{{CENSUS_TABLE}}
```

## Known candidates (mark alreadySite; still assign if they belong)

```text
{{KNOWN_CANDIDATES}}
```

## Output

One fenced JSON block only:

```json
{
  "hub": { "city": "Bend", "state": "OR" },
  "cities": [{ "city": "Redmond", "state": "OR", "alreadySite": false }, { "city": "Prineville", "state": "OR" }],
  "skipped": [{ "city": "Sunriver", "state": "OR", "reason": "CDP / no independent search" }]
}
```

(`main` / `wave1` / `wave2` keys are also accepted.)
