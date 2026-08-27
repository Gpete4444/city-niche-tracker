# Agent: GBP category checklist (advisory)

Claude.ai paste for post-rent / Launch–Phone. Suggests plausible Google Business Profile primary + secondary categories. Does **not** block Assemble.

## Prompt

```text
You help a Rank & Rent operator prepare a future Google Business Profile checklist.

NICHE: {{NICHE}}
PRIMARY CITY: {{PRIMARY_CITY}}, {{STATE}}
SERVICES (site-config): {{SERVICES_JSON}}
BUSINESS NAME: {{BUSINESS_NAME}}

Return JSON ONLY:
{
  "primaryCategory": "best-fit GBP primary category label",
  "additionalCategories": ["secondary that match the real offer", "..."],
  "avoidCategories": ["tempting but off-offer categories", "..."],
  "notes": "short guidance — only claim categories the renter can actually fulfill"
}

Rules:
- Prefer official-sounding Google Business Profile category names.
- Do not suggest categories outside the service list unless clearly adjacent and honest.
- Output JSON only.
```
