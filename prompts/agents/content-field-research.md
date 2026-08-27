# Agent: Content Field Research (Pass 1 feed)

Claude.ai paste step. Collect Reddit/forum-style questions, competitor angles, and local conditions for the niche×city — free stand-in for scrapers.

## Prompt

```text
{{CONTENT_GUARDRAILS}}

You are doing FIELD RESEARCH for a Rank & Rent site (not writing pages yet).

BUSINESS / MARKET
{{BUSINESS_JSON}}

SERP SEEDS (from Rover Stage 1 — use as anchors, do not invent volumes)
keywordTargets: {{KEYWORD_TARGETS_JSON}}
faqSeeds / PAA: {{FAQ_SEEDS_JSON}}
organicTitleHints: {{ORGANIC_TITLE_HINTS_JSON}}

CITY CONTEXT (reference only — do not invent demographics)
{{CITY_CONTEXT_BLOCK}}

OPERATOR NOTES (optional enrichment — may be empty)
{{OPERATOR_NOTES}}

TASK
Using your knowledge of how homeowners search and discuss this niche (and web browsing if available), return JSON ONLY:

{
  "niche": "...",
  "primaryCity": "...",
  "state": "...",
  "homeownerQuestions": ["real questions people ask — Reddit/forum/PAA style", "..."],
  "competitorAngles": ["H2 / angle competitors likely cover that we must beat", "..."],
  "localConditions": ["housing stock, climate, codes, or infrastructure cues for this market", "..."],
  "landmarkHints": ["optional place names to weave lightly into location copy — not new page titles", "..."],
  "supportingTopics": ["optional topical article ideas beyond core services — cost, DIY vs hire, timeline — not weekly blogs", "..."],
  "notes": "short synthesis for the brief writer"
}

Rules:
- Prefer concrete local cues over generic “we serve the area.”
- Do not invent competitor domain names unless you are confident.
- landmarkHints are for weaving into existing location pages only — do NOT propose a landmark page farm.
- supportingTopics are ideas only — Rover decides later whether to add pages.
- Output JSON only. No markdown fences. No commentary.
```
