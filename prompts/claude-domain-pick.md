# Claude prompt: Exact Domain Match suggestions

Use in Rover Site-Config → Domain (before Business details). Returns top Exact Match domain ideas for the candidate.

## Prompt

```text
You are helping pick a domain for a Rover local lead-gen website.

Candidate context:
- Niche: {{NICHE}}
- Primary city: {{CITY}}
- State: {{STATE}}
- City cluster: {{CITY_CLUSTER}}
- Business name (if known): {{BUSINESS_NAME}}

Recommend the top 5 Exact Domain Match hostnames for this business (niche + geo preferred). Prefer .com unless a strong local TLD clearly fits. Avoid trademarked brands, directories, and vague one-word names.

If you can reasonably judge availability (knowledge / common patterns), include "available": true|false|null. If unsure, use null — do not invent WHOIS results.

Return ONLY valid JSON (no markdown fences, no commentary before/after):

{
  "domains": [
    { "domain": "example.com", "available": true, "note": "exact niche+city" },
    { "domain": "example2.com", "available": null, "note": "niche + metro" }
  ]
}

Rules:
1. Exactly 5 entries when possible (fewer only if the niche is extremely constrained).
2. "domain" = hostname only (no https://, no path, no www.).
3. Prefer readable Exact Match: niche tokens + city/region when it still looks brandable.
4. "note" = short reason (≤12 words).
```
