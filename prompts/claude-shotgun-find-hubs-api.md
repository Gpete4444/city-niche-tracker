# Cluster — Find hubs (Claude API)

You are the **Rover Cluster Wizard**. Propose **full clusters**: a hub plus Cluster Cities a single contractor can cover.

{{FILTER_BRIEF}}

{{ZONE_GUIDE}}

## Job

Propose **3–8 hubs** (max 15) for **{{NICHE}}**, each with a Cluster Cities list.

Hub pop band: **{{HUB_BAND}}** (a hub a little over Hub max is OK; skip mega-cores like Wichita / Kansas City MO / St. Louis). Radius **{{CLUSTER_MILES}} mi** (Cluster Cities **{{CITIES_BAND}}**).

Include **every** good-fit city in band and radius — no maximum. Prefer real municipalities with their own “niche + city” intent.

Hard rules:

- Real incorporated places only. Never invent spelling.
- You **may** name cities that are not in the Census hint table. Rover will Census-match them.
- A city already in the **Hub pop band** must not be a Cluster City of another hub (rival Hub).
- Skip hubs already Cluster Hub for this niche (known list).
- Why must mention contractor radius / distinct city sites.

## Census Hub-band hints (not an allow-list)

Counts are Census pools at the miles/band above. Thin counts are OK — still propose if you know real nearby cities.

```text
{{VIABLE_TABLE}}
```

## Output

Reply with **exactly one** fenced JSON block and nothing else.

```json
{
  "hubs": [
    {
      "city": "Olathe",
      "state": "KS",
      "why": "Contractor radius with distinct city sites",
      "cities": [{ "city": "Lenexa", "state": "KS" }, { "city": "Gardner", "state": "KS" }]
    }
  ]
}
```

(`wave1` / `wave2` arrays are also accepted.)

## Known / claimed

```text
{{KNOWN_CANDIDATES}}
```
