# Agent: Content Writer (homepage-first)

Write Astro Markdown FILE blocks for the homepage (and stubs if needed).

## Prompt

```text
You are writing content for a Rover local lead-gen Astro + Markdown site.

ARCHETYPE: {{SITE_ARCHETYPE}} ({{ARCHETYPE_LABEL}})
HOMEPAGE SECTIONS (template will render): {{HOMEPAGE_SECTIONS}}
MODE: homepage_first

SITE CONFIG:
{{SITE_CONFIG_JSON}}

APPROVED OUTLINE:
{{CONTENT_OUTLINE_JSON}}

CONTENT RESEARCH:
{{CONTENT_RESEARCH_JSON}}

Hard rules:
1. Unique, honest copy. Use site-config socialProof for reviews/licenses/years — do not invent testimonials. Do not invent license ID numbers or street addresses.
2. Frontmatter keys must match schemas (title, description, h1, draft:false; homepage: sectionHeading, whyChooseUs×3, process×3+, faqs 3–5). Title ≈ H1; high-ticket keywords left→right.
   - `description` = ONE meta-length sentence (~140–160 chars): service/niche + primaryCity + 2–3 offer terms + free-estimate cue. It is reused as the hero supporting line under H1 — never multi-paragraph, never blank when you can write a sharp one.
3. Ippei copy shape (see docs/SECTION-UX.md):
   - Hero under H1 stays that one short `description`/`tagline` sentence — do NOT pad the hero into an essay.
   - Intro = max ~2 concise salesperson paragraphs. Central entity = the SERVICE; allow ONE natural primaryCity (or metro) mention; city remains secondary.
   - Do NOT stuff streets/landmarks into intro — put geo flavor in areas / lower sections.
   - Unique entities = industry materials, codes, equipment, techniques, stats.
   - Services: one short entity-rich paragraph each; high-ticket first.
   - Educational sections: short natural human openers + bullets (diyVsPro: ### DIY / ### Hire a pro). Do NOT city-stuff every lead (“Typical stages for {city}…”). City in H1/H2, areas, and at most one light cue in the page intro. For **cost**: 3–5 bullets `**Tier** — $low–$high — what’s included` (ballpark ranges for a table; never a single fixed quote). For **timeline**: `**Stage title** — duration` only — no “or next-day” / “usually” / “varies by city/county” hedges on the same bullet; optional second clause only for real step description.
   - Place primary/supporting keywords from the outline into H1/H2; FAQ questions should follow outline faqSeeds / PAA when provided (niche/service only — never city trivia, pets, civic officials, or unrelated appliances).
3b. Dual-source contract:
   - Homepage: whyChooseUs / process / faqs / gallery = **frontmatter only**; body = intro + educational `##` bands (cost/materials/timeline/codes/diy/whenToCall).
   - Service pages (when writing them): **no** process/faqs FM arrays — unmarked intro (no `##` for svcIntro) + every other band as body `##`; use the same cost/codes/DIY/timeline bullet shapes as homepage educational sections. Codes: `### Usually needs a permit` then `### Usually no permit`.
   - Service **process** H2: each step = its own list line `- **Title** — short description` (~8–14 words). Never jam all steps into one paragraph.
   - Never invent service-page `process:` or `faqs:` YAML.
4. Image fields OPTIONAL — omit heroImage/featureImage/gallery/coverageMap/process[].image/materialsImages unless files already exist from Rover Pull, ChatGPT BA import, or operator upload. Never invent src paths or reuse demo filenames. Never emit body markdown images (`![…](/images/…)`). Preserve existing Pull-owned entries.
5. Filenames kebab-case under src/content/. Location files: city name only (`riverton.md`), never append state (`riverton-ut` is wrong).
6. Type A: services grid is rendered from collection — still produce about/contact stubs; service/location pages come in a later pass unless MODE says full.
7. Type B: do NOT write multiple service marketing pages; put depth in homepage process[]; at most one optional services/{slug}.md for the primary offer.

Required in homepage_first mode:
- ### FILE: src/content/pages/index.md  (full homepage)
- ### FILE: src/content/pages/about.md  (short stub OK)
- ### FILE: src/content/pages/contact.md (short stub OK)

## Output (pick one)

### Claude.ai / chat paste (preferred)
Output ONLY ### FILE blocks — full markdown under each heading. No commentary before/after.

### FILE: src/content/pages/index.md
---
...frontmatter...
---

body

### FILE: src/content/pages/about.md
...

### FILE: src/content/pages/contact.md
...

### Claude Code in the repo
Prefer the same ### FILE: blocks in your reply so the operator can paste into ops.
If you write files to disk instead:
1. Write ONLY these three paths (homepage_first), then stop.
2. Do NOT treat disk write as final Accept — ops will **Import from src/content** into research/{candidateId}-content.draft.json.
3. Do not prune or rewrite unrelated content files.
```
