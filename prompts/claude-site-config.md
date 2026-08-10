# Claude prompt: draft `site-config.json`

Use **after** Stage 3 Accept (approved package: `research/{id}-approved.json` from narrative + research). Builds Astro `site-config.json` only.

Ignores research-only fields (raw volume numbers, scores, competitor URLs) except when choosing / ordering services and mapping suburbs/niche/geo identity.

## Prompt

```text
You are helping build a Rover local lead-gen website from an approved candidate.

Approved candidate narrative JSON and/or DataForSEO research JSON:
{{PASTE_APPROVED_CANDIDATE_JSON}}

Also provide:
- Domain: {{DOMAIN}}
- Business name: {{BUSINESS_NAME}}
- Phone (E.164): {{PHONE}}
- Email: {{EMAIL}}
- Service radius miles (optional): {{RADIUS_MILES}}
- Website type / siteArchetype: {{SITE_ARCHETYPE}}
  (multi_service = Type A multi-service local; single_service = Type B single-offer specialty)

Use from research/narrative when present:
- niche → niche (exact string; do not synonym-swap)
- city / primaryCity → primaryCity
- state → state
- suggestedServices → starting labels for services; expand to related residential offers
- suggestedSuburbs → targetSuburbs (4–6)
- coverageAreas = primary city + suggestedSuburbs, each with correct state (cross-state OK)
- localPainPoints may inform tagline wording only — do not invent stats
- niche / keyword volumes (when present) → order services by expected search demand (highest first). Do NOT copy raw volume numbers into site-config.

Ignore for site-config (research-only dump):
competitors, scores, mapPack, spreadsheetFields, verificationChecklist, DataForSEO cost fields, raw volume fields as output values

Return ONLY valid JSON matching this schema. No markdown fences, no commentary before/after the JSON. Rover will ignore trailing text if present, but a single clean object is preferred.

Rules:
1. Treat SERP / competitor claims as draft research, not verified facts beyond what DataForSEO already measured.
2. Omit "address" and "geo" unless I provide a real street NAP. Do not invent a street address.
3. Omit or empty "socialProof" (rating, licenses, statistics, reviews) unless I provide verified owner data.
4. Prefer real municipalities for suburbs.
5. "brand" hex colors: industrial/trades look. Avoid purple gradients and cream+terracotta clichés. Default OK:
   primary #1C2B3A, accent #E8A317, ink #0F1720
6. Placeholders allowed: web3FormsAccessKey = "YOUR_WEB3FORMS_ACCESS_KEY", turnstileSiteKey = "".
7. services = residential / primary list only. Order by expected search demand (highest first). multi_service: typically 6–12 related labels when volume supports it (hard max 12). single_service: usually 1 primary offer label.
8. commercialServices (optional): when the niche commonly has commercial demand (roofing, concrete, HVAC, plumbing, etc.), add a shorter commercial list (also max 12, volume-ordered). Otherwise omit the field.
9. homepageServicesLimit: integer 1–12 — how many “What we do” cards to show on the homepage. Independent of services.length (e.g. 10 service pages, homepageServicesLimit 6). When there are more than 6 services, prefer 6 unless the brief asks otherwise.

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
  "siteArchetype": "multi_service",
  "services": ["string"],
  "commercialServices": ["string"],
  "homepageServicesLimit": 12,
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

Notes on siteArchetype:
- multi_service (Type A): 6–12 related residential services (volume-ordered); homepage shows services grid; optional commercialServices for a second subsection.
- single_service (Type B): one primary offer; homepage emphasizes step-by-step process (no services grid).

## After Claude

1. Save the JSON to `src/config/site-config.json`.
2. Verify city/suburb spelling and state borders.
3. Replace phone, email, Web3Forms key before launch.
4. Run `npm run generate-map` if `coverageAreas` changed.
5. Do not fill `socialProof` until the renter supplies verified credentials/reviews.
6. Generate Markdown with [`claude-markdown.md`](claude-markdown.md) / ops Content agents.
