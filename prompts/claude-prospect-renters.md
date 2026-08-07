# Claude prompt: renter outreach angles (after prospect-renters)

Use **after** `npm run prospect-renters` on an approved (pursue) candidate.

Do **not** invent review counts, ad flags, phones, or Map Pack ownership — copy from the prospects JSON.

## Prompt

```text
You are drafting Rank & Rent outreach angles for local contractors.

I will paste a prospect-renters JSON (Stage 3). For each high- and medium-priority prospect, return concise outreach notes:

{
  "niche": "copy",
  "city": "copy",
  "state": "copy",
  "prospects": [
    {
      "name": "copy",
      "domain": "copy",
      "outreachPriority": "copy",
      "hook": "1–2 sentences why a niche lead-gen site helps them",
      "objectionToExpect": "string",
      "doNotPitchIf": "string — e.g. already owns Map Pack + strong niche site"
    }
  ]
}

Rules:
1. Prefer prospects with website + reviews who do NOT own the niche Map Pack / organic SERP.
2. runningAds=true → they have budget; lead with ROI not education.
3. ownsMapPackSlot or ranksOrganicallyForNiche → usually skip or soft “overflow leads” angle only.
4. sizeProxy / reviewBand are proxies only — never claim employee counts.
5. Do not invent contact data.

PROSPECTS_JSON:
{{PASTE_OUTPUT_OF_npm_run_prospect_renters}}
```
