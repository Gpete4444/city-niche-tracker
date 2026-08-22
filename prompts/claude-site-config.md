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
- Street NAP (operator-approved — use exactly; never invent a different street or ZIP):
  - street: {{ADDRESS_STREET}}
  - city: {{ADDRESS_CITY}}
  - state: {{ADDRESS_STATE}}
  - zip: {{ADDRESS_ZIP}}
  (If street is blank / "omit", omit the entire "address" object from JSON.)
- Website type / siteArchetype: {{SITE_ARCHETYPE}}
  (multi_service = Type A multi-service local; single_service = Type B single-offer specialty)
- Operator brand look (Colors & fonts in Rover) — use these brand hexes and fontTheme:
  - paletteId: {{PALETTE_ID}} ({{PALETTE_LABEL}})
  - primary: {{BRAND_PRIMARY}}
  - accent: {{BRAND_ACCENT}}
  - ink: {{BRAND_INK}}
  - fontTheme: {{FONT_THEME}}

Use from research/narrative when present:
- niche → niche (exact string; do not synonym-swap)
- city / primaryCity → primaryCity
- state → state
- suggestedServices → starting labels for services; expand to related residential offers
- suggestedSuburbs → targetSuburbs (prefer 3–5 suburbs / 4–6 location pages with primary; Website Builder Service area may widen coverageAreas and keep ≤5 SEO suburbs)
- coverageAreas = primary city + service-area selections (map radius + toggles); each with correct state (cross-state OK)
- localPainPoints may inform tagline wording only — do not invent stats
- niche / keyword volumes (when present) → order services by expected search demand (highest first). Do NOT copy raw volume numbers into site-config.

Ignore for site-config (research-only dump):
competitors, scores, mapPack, spreadsheetFields, verificationChecklist, DataForSEO cost fields, raw volume fields as output values

Return ONLY valid JSON matching this schema. No markdown fences, no commentary before/after the JSON. Rover will ignore trailing text if present, but a single clean object is preferred.

Rules:
1. Treat SERP / competitor claims as draft research, not verified facts beyond what DataForSEO already measured.
2. Include "address" (street + city + state + zip) only when Street NAP above provides a real street — copy those fields exactly. Never invent a street or postal code. Omit "geo" unless I provide coordinates. If street is blank / omit, omit "address" entirely.
3. Omit "socialProof" unless I provide owner rating/licenses/reviews — Rover will seed defaults when empty. Do not invent review counts from SERP competitors.
4. Prefer real municipalities for suburbs.
5. "brand" hex colors: use the operator Colors & fonts values above (primary/accent/ink + paletteId). Avoid purple gradients and cream+terracotta clichés.
   Include "fontTheme": "{{FONT_THEME}}" on brand (operator-chosen; do not invent other font ids).
6. Placeholders allowed: web3FormsAccessKey = "YOUR_WEB3FORMS_ACCESS_KEY", turnstileSiteKey = "".
7. services = residential / primary list only. Order by expected search demand (highest first). multi_service: typically 6–12 related labels when volume supports it (hard max 12). single_service: usually 1 primary offer label.
8. commercialServices (optional): when the niche commonly has commercial demand (roofing, concrete, HVAC, plumbing, etc.), add a shorter commercial list (also max 12, volume-ordered). Otherwise omit the field.
9. homepageServicesLimit: integer 1–12 — how many “What we do” cards on the homepage. Prefer **6 (3×2)** or **8 (4×2)** for ~2 scrolls; independent of services.length (e.g. 10 service pages, homepageServicesLimit 8).
10. tagline = ONE sentence used as the homepage hero supporting line (under H1). Pattern: niche/primary offer + primaryCity + 2–3 concrete offer terms + free-estimate cue. Aim ~140–160 characters. Do NOT write soft/generic lines (“specialized … for surrounding communities”). Do NOT make it multiple sentences or a paragraph.
    Example: "Full kitchen and bathroom remodeling in Spanish Fork, UT — cabinetry, tile, walk-in showers. Free estimates."

JSON shape:
{
  "businessName": "string",
  "tagline": "string (one SEO-sharp sentence; see rule 10)",
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
  "homepageServicesLimit": 8,
  "brand": {
    "primary": "{{BRAND_PRIMARY}}",
    "accent": "{{BRAND_ACCENT}}",
    "ink": "{{BRAND_INK}}",
    "paletteId": "{{PALETTE_ID}}",
    "fontTheme": "{{FONT_THEME}}"
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
5. Replace `socialProof` with owner credentials/reviews before launch (Rover may seed defaults).
6. Generate Markdown with [`claude-markdown.md`](claude-markdown.md) / ops Content agents.
