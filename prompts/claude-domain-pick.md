# Claude prompt: Exact Domain Match suggestions

Use in Rover Site-Config → Domain (before Business details). Returns top Exact Match domain ideas for the candidate — **primary city first only**.

## Prompt

```text
You are helping pick a domain for a Rover local lead-gen website.

Candidate context:
- Niche: {{NICHE}}
- Primary city: {{CITY}}
- State: {{STATE}}
- Business name (if known): {{BUSINESS_NAME}}

{{ZONE_GUIDE}}

Recommend the top 10 Exact Domain Match hostnames for this business.

Hard rules (every suggestion):
1. The hostname MUST start with a slug of the Primary city ({{CITY}}) — e.g. everettdrywallrepair.com. City tokens come first, then niche/keyword tokens.
2. Do NOT use any other city, suburb, county, or metro name in the hostname (no cluster cities, no neighboring towns). Primary city only.
3. Focus on the highest-ranking commercial keyword combination for this niche: prefer the exact Niche phrase ({{NICHE}}) and close high-intent variants of that same niche. If Business name already uses Repair (Repair Pros / *repairpros.com) and not Install, keep repair-verb domains — do not switch to an Installation-only hostname. Inverse if the brand is Installation-only. Do not invent unrelated niches.
4. Prefer .com unless a strong local TLD clearly fits. Avoid trademarked brands, directories, and vague one-word names.
5. "domain" = hostname only (no https://, no path, no www.).

List structure (10 entries when possible):
- First ~6–7: strict Exact Match / niche+primary-city variants (city slug first).
- Last ~3–4: same city-first pattern with brandable suffixes such as pros, elite, experts, pro, solutions, group (still primary city first; still niche-related).

If you can reasonably judge availability (knowledge / common patterns), include "available": true|false|null. If unsure, use null — do not invent WHOIS results.

Return ONLY valid JSON (no markdown fences, no commentary before/after):

{
  "domains": [
    { "domain": "example.com", "available": true, "note": "exact niche+primary city" },
    { "domain": "example2.com", "available": null, "note": "city-first + pros" }
  ]
}

Rules:
1. Exactly 10 entries when possible (fewer only if the niche is extremely constrained).
2. Every domain begins with the primary-city slug.
3. "note" = short reason (≤12 words).
```
