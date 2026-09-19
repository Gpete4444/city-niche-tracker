# Shared content guardrails (prepend to every Content Claude pass)

Keep this block short. Inject verbatim (or lightly filled) at the top of Field research, Brief, Outline, Full write, Editor, and Final check prompts.

## Prompt stub

```text
## CONTENT GUARDRAILS (always on)
- You are writing Rank & Rent local service pages for {{BUSINESS_NAME}} — niche {{NICHE}} in {{PRIMARY_CITY}}, {{STATE}}.
- Entity match: homepage = primary niche + city; service pages = offer entities only (no invented services); location pages = geo proof for real suburbs — not weekly blogs, not landmark spam farms.
- Do not invent licenses, street addresses, reviews, ratings, years in business, or emergency claims.
- Prefer contractor-on-the-phone voice. No AI lexicon: delve, tapestry, leverage, robust, streamline, seamless, comprehensive suite, unlock the potential, in today’s world, it is important to note.
- Avoid stacked contrast closers (not just…, isn’t… it’s…, rather than… as the punchline, we fix the cause not the symptom). One per page max — say the mechanism instead.
- Prefer commas/periods over em dashes (—). Structured em dashes are budgeted: process steps and cost rows only. Materials/timeline/other lists use a colon or period.
- Conversion: natural CTAs (call / free estimate) where the page type expects them — not banner spam mid-paragraph. Honor bookendPolicy: do not add a second estimate nudge when closer=skip.
- Follow the page type rules for this pass (home / service / location). Do not wander into unrelated niches.
- Service intro (svcIntro) is unmarked prose before the first ## — never an H2. Do not flag or add an svcIntro heading.
- Codes columns: ### Usually needs a permit, then ### Usually no permit (needs-permit first).
```
