# Claude prompt: candidate narrative (after DataForSEO)

Use **after** Stage 1 (`npm run research-candidate`) and ideally **after** Stage 2 (`npm run enrich-candidate` or `--enrich`) when `enrichmentRecommended` is true.

Claude fills soft fields only — pain points, suburbs, services, job-cost estimates, and **jobValue / proposedScore polish**.

Scoring definitions: [`scoring-rubric.md`](scoring-rubric.md) / [`scripts/lib/scoring-rubric.json`](../scripts/lib/scoring-rubric.json).

Do **not** invent Map Pack, competitor URLs/counts, keyword volumes, DataForSEO Rank, word counts, or displaceability labels. Copy those from the research JSON.

## Workflow

```powershell
npm run research-candidate -- --config scripts/examples/louisville-candidate.json
npm run enrich-candidate -- --research research/louisville-trenchless.json
```

Paste the enriched JSON into Claude with this prompt.

## Prompt

```text
You are completing Rover candidate research for a local lead-gen site (specialty / high-ticket rubric v2).

I will paste a DataForSEO research JSON. It already contains:
- Exact niche string
- SERP classification (Map Pack, directories, organic homes/subs, unique domains, paid ads if present)
- Related keywords with per-city volumes and cluster sums
- A `scoring` block (demandBand, serpSoftness, decision, scoreInputs)
- Optionally an `enrichment` block (DataForSEO Rank — NOT Moz DA — page thinness, displaceability)

Your job: add narrative and finish scoring ONLY.

If a Discovery narrative seed is provided below, treat it as a draft starting point for:
- averageJobCostUsd / Average Job Cost text
- localPainPoints / pain_points
- suggestedServices / suggested_services
- suggestedSuburbs / suggested_suburbs
- estTimeToRankMonths
Polish against Stage 1/2 facts; do not invent SERP or volume numbers. Prefer refining the seed over rewriting from scratch when the seed is present and coherent.

Rules for numbers:
- Do not invent Rank, referring domains, word counts, or strengthLabel values.
- If enrichment.displaceability exists, treat it as the automated replacement for “manually open the 8 URLs.” You may confirm or note disagreement in scoreInputs.notes; do not silently overwrite without reason.
- You may adjust competition or mapPackGap by at most ±1 with a written reason.
- jobValue from averageJobCostUsd midpoint per rubric.
- proposedScore: if displaceability is present use weights 0.25/0.25/0.20/0.15/0.15 (demand/competition/jobValue/mapPackGap/displaceability); else renormalize the four Stage-1 weights. One decimal.
- Re-apply specialty decision rules after ticketClass + displaceabilityBand are known.

Return ONE JSON object (no markdown fences) with this shape:

{
  "niche": "copy exactly from research JSON",
  "city": "primary city",
  "state": "XX",
  "cityCluster": ["from research or lightly refined real municipalities"],
  "population": 0,
  "googleSearchQuery": "copy exactly",
  "googleSearchLink": "copy exactly",
  "dataForSeo": {
    "mapPackPresent": true,
    "directoriesCount": 0,
    "organicHomePageCount": 0,
    "organicSubPageCount": 0,
    "uniqueOrganicDomainCount": 0,
    "clusterVolumeSum": 0,
    "primaryVolumeSum": 0,
    "demandVolumeSum": 0,
    "suburbOverlapFactor": 0.25,
    "keywords": [],
    "displaceabilityScore": null,
    "medianDomainRank": null,
    "thinStubShare": null
  },
  "averageJobCostUsd": { "low": 0, "high": 0, "midpoint": 0, "confidence": "low", "basis": "string" },
  "estTimeToRankMonths": {
    "withGbp": "2-3",
    "withoutGbp": "3-5",
    "confidence": "low",
    "basis": "string — site-only assets usually win blue links first; Map Pack usually needs GBP"
  },
  "localPainPoints": ["string", "string", "string"],
  "suggestedServices": ["string", "string", "string"],
  "suggestedSuburbs": ["string", "string", "string", "string"],
  "scoring": {
    "rubricVersion": 2,
    "demandBand": "copy",
    "serpSoftness": "copy",
    "ticketClass": "low|mid|high",
    "displaceabilityBand": "low|mid|high|null",
    "decision": {
      "decision": "pursue|maybe|pass|hold|review",
      "ruleId": "string",
      "summary": "string"
    },
    "scoreInputs": {
      "demand": 0,
      "competition": 0,
      "jobValue": 0,
      "mapPackGap": 0,
      "displaceability": null,
      "notes": "string"
    },
    "proposedScore": 0.0
  },
  "spreadsheetFields": {
    "estClusterVolumeText": "copy",
    "topTargetKeywordsAndVolumesText": "copy",
    "averageJobCostText": "$X – $Y",
    "estTimeToRankWithGbpText": "2–3 Months",
    "estTimeToRankWithoutGbpText": "3–5 Months",
    "mapPackText": "Yes|No",
    "directoriesCount": 0,
    "organicHomePageCount": 0,
    "organicSubPageCount": 0,
    "directoriesLinksText": "copy",
    "organicHomePageLinksText": "copy",
    "organicSubPageLinksText": "copy",
    "demandBandText": "mid",
    "displaceabilityText": "high|mid|low|pending",
    "decisionText": "review",
    "proposedScoreText": "7.2"
  },
  "verificationChecklist": [
    "Confirm enrichment.pages if Stage 2 ran — thin_stub vs strong_niche_page",
    "Confirm population from Census if needed",
    "Human review of job-cost and time-to-rank estimates",
    "If pursue: run npm run prospect-renters for outreach list"
  ]
}

DATAFORSEO_RESEARCH_JSON:
{{PASTE_OUTPUT_OF_research_or_enrich_candidate}}

DISCOVERY_NARRATIVE_SEED (from Discovery Claude — polish, do not ignore without reason):
{{DISCOVERY_NARRATIVE_SEED}}
```

## After Claude

1. Merge into your `Final Potentials` sheet using `spreadsheetFields`.
2. Keep raw DataForSEO JSON for audit.
3. If decision is pursue → [`prospect-renters`](../README.md) then [`claude-site-config.md`](claude-site-config.md).
