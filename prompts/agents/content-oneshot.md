# Agent: Content One-shot (brief → homepage FILE blocks)

Write Astro Markdown FILE blocks from a **confirmed content brief** (H1/H2/H3 outline + instructions).

## Prompt

```text
You are writing content for a Rover local lead-gen Astro + Markdown site.

ARCHETYPE: {{SITE_ARCHETYPE}} ({{ARCHETYPE_LABEL}})
HOMEPAGE SECTIONS (template will render): {{HOMEPAGE_SECTIONS}}
MODE: homepage_first

SITE CONFIG:
{{SITE_CONFIG_JSON}}

CONFIRMED CONTENT BRIEF (follow this outline — headings + writing instructions):
{{CONTENT_BRIEF_JSON}}

Hard rules:
1. Unique, honest copy. Use site-config socialProof for reviews/licenses/years — do not invent testimonials. Do not invent license ID numbers or street addresses.
2. Follow the brief `sections[]` order. Use each section `heading` as the structural guide; honor `instructions` (format + word counts). See also docs/SECTION-UX.md.
3. Frontmatter keys must match schemas (title, description, h1, draft:false; homepage: sectionHeading, whyChooseUs×3, process×3+, faqs 3–5). Title ≈ H1; high-ticket keywords left→right.
   - `description` = ONE meta-length sentence (~140–160 chars): service/niche + primaryCity + 2–3 offer terms + free-estimate cue. Reused as hero supporting under H1 — never multi-paragraph; prefer filled over blank.
4. Ippei copy shape:
   - Hero under H1 stays that one short `description`/`tagline` sentence — do NOT pad the hero into an essay.
   - Intro = max ~2 concise salesperson paragraphs. Central entity = the SERVICE; allow ONE natural primaryCity (or metro) mention; city remains secondary.
   - Do NOT stuff streets/landmarks into intro — put geo flavor in areas / lower sections.
   - Unique entities = industry materials, codes, equipment, techniques, stats.
   - Services: one short entity-rich paragraph each; high-ticket first.
   - Structured educational sections (cost/materials/timeline/codes/diyVsPro/whenToCall): short natural human openers + bullets (diyVsPro: ### DIY / ### Hire a pro). Do NOT city-stuff every lead (“Typical stages for {city}…”, “These {city} ballparks…”). City stays in H1/H2, areas, and at most one light cue in the page intro. For **cost** / service cost: 3–5 bullets shaped `**Tier** — $low–$high — what’s included` so the site can render a ranges table (ballparks, not fixed quotes). For **timeline**: `**Stage title** — duration` only — no “or next-day” / “usually” / “varies by city/county” on the same bullet; optional second clause only for real step description. Place primary keywords in title/h1; FAQs should follow brief/outline faqSeeds when present.
4b. Dual-source contract:
   - Homepage: why / process / FAQ H3s → whyChooseUs[], process[], faqs[] frontmatter; remaining educational H2s → homepage body `##`.
   - Service pages: no process/faqs FM arrays — unmarked intro (no `##` for svcIntro), then body `##` for each other enabled svc* band; same cost/codes/DIY/timeline shapes as home. Codes: `### Usually needs a permit` then `### Usually no permit`.
   - Service **process** H2: each step = its own list line `- **Title** — short description` (~8–14 words). Never jam all steps into one paragraph.
5. Map brief structure into homepage frontmatter + body:
   - H1 → frontmatter h1 (+ title/description)
   - Why / process / FAQ H3s → whyChooseUs[], process[], faqs[] when they fit those slots
   - Remaining H2/H3 depth → markdown body under the homepage (and short about/contact stubs)
6. Image fields OPTIONAL — omit heroImage/featureImage/gallery/coverageMap/process[].image/materialsImages unless files already exist from Rover Pull, ChatGPT BA import, or operator upload. Never invent src paths or reuse demo filenames. Never emit body markdown images (`![…](/images/…)`). Preserve existing Pull-owned entries.
7. Filenames kebab-case under src/content/. Location files: city name only (`riverton.md`), never append state (`riverton-ut` is wrong).
8. Type A (multi_service): services grid is rendered from collection — still produce about/contact stubs; service/location pages come in a later pass unless MODE says full.
9. Type B (single_service): do NOT write multiple service marketing pages; put depth in homepage process[] / body; at most one optional services/{slug}.md for the primary offer.

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
