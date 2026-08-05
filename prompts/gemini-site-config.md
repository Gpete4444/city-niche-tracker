# Gemini prompt: draft `site-config.json`

Use for Phase 1 research. Paste into Gemini, then **spot-check** every city, suburb, keyword, and claim before using the JSON.

## Prompt

```text
You are helping build a Rank & Rent local lead-gen website.

Target niche and market:
- Niche: {{NICHE}}
- Primary city: {{CITY}}
- State: {{STATE}}
- Domain: {{DOMAIN}}
- Business name: {{BUSINESS_NAME}}
- Phone (E.164): {{PHONE}}
- Email: {{EMAIL}}

Return ONLY valid JSON matching this schema. No markdown fences, no commentary.

Rules:
1. Treat SERP / competitor claims as draft research, not verified facts.
2. Omit "address" and "geo" unless I provide a real street NAP. Do not invent a street address.
3. Omit or empty "socialProof" (rating, licenses, statistics, reviews) unless I provide verified owner data.
4. Choose 4–6 nearby suburbs/cities within roughly {{RADIUS_MILES}} miles. Prefer real municipalities.
5. "coverageAreas" must list primary city plus those suburbs, each with correct state abbreviation (cross-state OK).
6. "services" must be 3–5 concrete service labels useful for cards and forms.
7. "brand" hex colors: industrial/trades look. Avoid purple gradients and cream+terracotta clichés.
8. Placeholders allowed: web3FormsAccessKey = "YOUR_WEB3FORMS_ACCESS_KEY", turnstileSiteKey = "".

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

Also append a short "notes" sibling object AFTER the JSON is invalid for our build — wait: do NOT append notes. Output the config object only.

After you draft the JSON, list 5 local buyer pain points and primary keywords as a SEPARATE plain-text section titled NOTES (outside the JSON). I will discard NOTES when saving site-config.json.
```

## After Gemini

1. Save the JSON to `src/config/site-config.json`.
2. Verify city/suburb spelling and state borders.
3. Replace phone, email, Web3Forms key before launch.
4. Run `npm run generate-map` if `coverageAreas` changed.
5. Do not fill `socialProof` until the renter supplies verified credentials/reviews.
