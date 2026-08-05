# Gemini prompt: draft `site-config.json`

Use **after** a candidate is approved from research ([`gemini-candidate-research.md`](gemini-candidate-research.md)). Paste into Gemini, then **spot-check** every city, suburb, keyword, and claim before saving JSON.

This prompt builds Astro `site-config.json` only. It ignores research-only fields (volumes, scores, competitor URLs).

## Prompt

```text
You are helping build a Rank & Rent local lead-gen website from an approved candidate.

Approved candidate research JSON (may include volumes/scores/competitors — use only the fields listed in "Use from research"):
{{PASTE_APPROVED_RESEARCH_JSON}}

Also provide:
- Domain: {{DOMAIN}}
- Business name: {{BUSINESS_NAME}}
- Phone (E.164): {{PHONE}}
- Email: {{EMAIL}}
- Service radius miles (optional): {{RADIUS_MILES}}

Use from research when present:
- niche → niche
- city / primary city from cityCluster[0] or city → primaryCity
- state → state
- suggestedServices → services (3–5 labels)
- suggestedSuburbs → targetSuburbs (4–6)
- coverageAreas = primary city + suggestedSuburbs, each with correct state (cross-state OK)
- localPainPoints may inform tagline wording only — do not invent stats

Ignore for site-config (research-only):
estClusterVolumeMonthly, keywords volumes, competitors, scores, mapPack, time-to-rank, spreadsheetFields, verificationChecklist

Return ONLY valid JSON matching this schema. No markdown fences, no commentary before/after the JSON.

Rules:
1. Treat SERP / competitor claims as draft research, not verified facts.
2. Omit "address" and "geo" unless I provide a real street NAP. Do not invent a street address.
3. Omit or empty "socialProof" (rating, licenses, statistics, reviews) unless I provide verified owner data.
4. Prefer real municipalities for suburbs.
5. "brand" hex colors: industrial/trades look. Avoid purple gradients and cream+terracotta clichés. Default OK:
   primary #1C2B3A, accent #E8A317, ink #0F1720
6. Placeholders allowed: web3FormsAccessKey = "YOUR_WEB3FORMS_ACCESS_KEY", turnstileSiteKey = "".

JSON shape:
{
  "businessName": "string",
  "tagline": "string (one sentence)",
  "domain": "string (no protocol)",
  "niche": "string",
  "primaryCity": "string",
  "state": "XX",
  "targetSuburbs": ["string"],
  "coverageAreas": [{ "name": "string", "state": "XX" }],
  "serviceRadiusMiles": 40,
  "phone": "+1XXXXXXXXXX",
  "email": "leads@example.com",
  "web3FormsAccessKey": "YOUR_WEB3FORMS_ACCESS_KEY",
  "turnstileSiteKey": "",
  "primaryCta": "Get a Free Estimate",
  "services": ["string"],
  "brand": {
    "primary": "#1C2B3A",
    "accent": "#E8A317",
    "ink": "#0F1720"
  },
  "socialProof": {
    "licenses": [],
    "statistics": [],
    "reviews": []
  }
}
```

## After Gemini

1. Save the JSON to `src/config/site-config.json`.
2. Verify city/suburb spelling and state borders.
3. Replace phone, email, Web3Forms key before launch.
4. Run `npm run generate-map` if `coverageAreas` changed.
5. Do not fill `socialProof` until the renter supplies verified credentials/reviews.
6. Generate Markdown with [`claude-markdown.md`](claude-markdown.md).
