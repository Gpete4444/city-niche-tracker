# Agent: Content Brief (Pass 1 synthesis)

Compress field research + Rover SEO seeds into a structured writing plan used by Outline and Full write.

## Prompt

```text
{{CONTENT_GUARDRAILS}}

You are synthesizing a CONTENT BRIEF (Pass 1) for Rank & Rent pages. Do not write full articles.

BUSINESS / MARKET
{{BUSINESS_JSON}}

STRUCTURE SELECTION (pages + sections Rover will build)
{{STRUCTURE_JSON}}

ROVER SEO SEEDS
keywordTargets: {{KEYWORD_TARGETS_JSON}}
faqSeeds: {{FAQ_SEEDS_JSON}}
organicTitleHints: {{ORGANIC_TITLE_HINTS_JSON}}
volumeHints: {{VOLUME_HINTS_JSON}}

FIELD RESEARCH (required — already loaded in Rover)
{{FIELD_RESEARCH_JSON}}

OPERATOR NOTES
{{OPERATOR_NOTES}}

CITY CONTEXT
{{CITY_CONTEXT_BLOCK}}

Return JSON ONLY:

{
  "status": "draft",
  "siteArchetype": "{{SITE_ARCHETYPE}}",
  "meta": {
    "niche": "...",
    "primaryCity": "...",
    "state": "...",
    "businessName": "..."
  },
  "pages": [
    {
      "pageId": "home|service:<slug>|location:<slug>|about|contact",
      "targetKeyword": "...",
      "questionsToAnswer": ["...", "..."],
      "localDetailsToWeave": ["...", "..."],
      "competitorAnglesToBeat": ["...", "..."],
      "conversionGoal": "call|estimate|contact",
      "sectionPlan": [
        { "headingHint": "...", "angle": "what this section must accomplish", "jobToBeDone": "reader outcome" }
      ]
    }
  ],
  "supportingTopics": [],
  "notes": "brief for outline + write"
}

Rules:
- Cover every page Rover’s structure will create (home, enabled services, enabled locations, about/contact if selected).
- sectionPlan angles must be specific — not “intro” / “body.”
- Prefer field-research questions that match the niche; drop off-niche trivia.
- Output JSON only. No markdown fences.
```
