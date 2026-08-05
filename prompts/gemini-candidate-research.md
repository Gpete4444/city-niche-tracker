# Gemini prompt: candidate research (spreadsheet row)

Use this **before** site assembly. Output fills or drafts a row in your Rank & Rent candidate sheet (`Final Potentials`). Spot-check Map Pack, competitor links, and volumes before scoring.

Do **not** use this output as `site-config.json`. After you approve a candidate, run [`gemini-site-config.md`](gemini-site-config.md).

## Prompt

```text
You are researching Rank & Rent niche × city candidates for a local lead-gen site.

Candidate:
- Niche: {{NICHE}}
- City (or city cluster): {{CITY}}
- State: {{STATE}}
- Optional radius miles: {{RADIUS_MILES}}
- Optional known population: {{POPULATION_OR_BLANK}}

Return ONE JSON object only (no markdown fences) matching the schema below.

Hard rules:
1. Search volumes, job costs, time-to-rank, and competitor counts are DRAFT MODEL ESTIMATES unless I paste verified Keyword Planner / tool data below.
2. Every volume object must include "source": "model_estimate" (or "user_provided" if I pasted real data).
3. Do not invent GBP review ratings, "#1 contractor" claims, licenses, or street addresses.
4. Prefer fewer competitor links you are confident about over long fabricated lists. If unsure, lower confidence and shorten links.
5. Support multi-city markets (e.g. "Meridian & Nampa") via cityCluster[].
6. Map Pack and GBP fields must be labeled as unverified drafts; I will confirm via Google Search.

JSON schema:
{
  "niche": "string",
  "city": "string",
  "state": "XX",
  "cityCluster": ["string"],
  "population": 0,
  "googleSearchQuery": "Niche City ST",
  "googleSearchLink": "https://www.google.com/search?q=...",
  "estClusterVolumeMonthly": {
    "low": 0,
    "high": 0,
    "confidence": "low",
    "source": "model_estimate"
  },
  "keywords": [
    {
      "keyword": "string",
      "estVolumeMonthly": { "low": 0, "high": 0 },
      "intent": "transactional|commercial|informational",
      "source": "model_estimate"
    }
  ],
  "relatedKeywords": ["string"],
  "averageJobCostUsd": { "low": 0, "high": 0, "source": "model_estimate" },
  "mapPackPresent": false,
  "mapPackConfidence": "low",
  "gbpServesLocationCount": null,
  "competitors": {
    "directories": { "count": 0, "links": ["https://..."] },
    "organicHomePages": { "count": 0, "links": ["https://..."] },
    "organicSubPages": { "count": 0, "links": ["https://..."] }
  },
  "estTimeToRankMonths": {
    "withGbp": "2-3",
    "withoutGbp": "3-5",
    "confidence": "low"
  },
  "localPainPoints": ["string", "string", "string"],
  "suggestedServices": ["string", "string", "string"],
  "suggestedSuburbs": ["string", "string", "string", "string"],
  "scoreInputs": {
    "demand": 0,
    "competition": 0,
    "jobValue": 0,
    "mapPackGap": 0,
    "notes": "string"
  },
  "proposedScore": 0.0,
  "spreadsheetFields": {
    "estClusterVolumeText": "280 – 500 / mo",
    "topTargetKeywordsAndVolumesText": "keyword (80–150/mo)\\nkeyword2 (40–80/mo)",
    "averageJobCostText": "$1,500 – $4,500",
    "estTimeToRankWithGbpText": "2–3 Months",
    "estTimeToRankWithoutGbpText": "2–3 Months",
    "mapPackText": "No",
    "directoriesCount": 0,
    "organicHomePageCount": 0,
    "organicSubPageCount": 0,
    "directoriesLinksText": "https://...\\nhttps://...",
    "organicHomePageLinksText": "https://...\\nhttps://...",
    "organicSubPageLinksText": "https://...\\nhttps://..."
  },
  "verificationChecklist": [
    "Open googleSearchLink and confirm Map Pack Yes/No",
    "Replace model volume estimates with Keyword Planner if available",
    "Click competitor links; remove dead or irrelevant URLs",
    "Confirm population from Census / local source if needed",
    "Recompute Score after verification"
  ]
}

Scoring guidance for scoreInputs (1–10 integers) and proposedScore (one decimal):
- demand: cluster volume + commercial intent
- competition: fewer strong organic/directory competitors → higher
- jobValue: higher average ticket → higher
- mapPackGap: no map pack / weak local pack → higher opportunity
- proposedScore: weighted blend; explain briefly in scoreInputs.notes

Optional verified data from me (may be empty):
{{PASTE_KEYWORD_PLANNER_OR_BLANK}}
```

## Mapping to Excel (`Final Potentials`)

| Spreadsheet column | JSON field |
| --- | --- |
| Niche | `niche` |
| City | `city` (or join `cityCluster`) |
| State | `state` |
| Population | `population` |
| Google Search Link | `googleSearchLink` |
| Score | `proposedScore` (after your verification) |
| Est. Cluster Volume | `spreadsheetFields.estClusterVolumeText` |
| Top Target Keywords & Volumes | `spreadsheetFields.topTargetKeywordsAndVolumesText` |
| Average Job Cost | `spreadsheetFields.averageJobCostText` |
| Est. time to rank with GBP | `spreadsheetFields.estTimeToRankWithGbpText` |
| Est. time to rank without GBP | `spreadsheetFields.estTimeToRankWithoutGbpText` |
| Map Pack | `spreadsheetFields.mapPackText` |
| GBP Serves Location | `gbpServesLocationCount` (verify manually) |
| Directories | `spreadsheetFields.directoriesCount` |
| Organic Home Page | `spreadsheetFields.organicHomePageCount` |
| Organic Sub Page | `spreadsheetFields.organicSubPageCount` |
| Directories (Links) | `spreadsheetFields.directoriesLinksText` |
| Organic Home Page (Links) | `spreadsheetFields.organicHomePageLinksText` |
| Organic Sub Page (Links) | `spreadsheetFields.organicSubPageLinksText` |

## After Gemini

1. Paste `spreadsheetFields` (+ identity columns) into the candidate sheet.
2. Open `googleSearchLink` and correct Map Pack / competitor links.
3. Mark volumes as verified only after a real keyword tool pass.
4. Adjust Score using verified `scoreInputs`.
5. When approved, run [`gemini-site-config.md`](gemini-site-config.md) with this JSON attached.
