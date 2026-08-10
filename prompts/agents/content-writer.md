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
1. Unique, honest copy. No fabricated reviews, licenses, years, project counts, or street addresses.
2. Frontmatter keys must match schemas (title, description, h1, draft:false; homepage: sectionHeading, whyChooseUs×3, process×3+, faqs 3–5).
3. Image fields OPTIONAL — omit heroImage/featureImage/gallery/coverageMap/process[].image unless told to reuse demo paths.
4. Filenames kebab-case under src/content/.
5. Type A: services grid is rendered from collection — still produce about/contact stubs; service/location pages come in a later pass unless MODE says full.
6. Type B: do NOT write multiple service marketing pages; put depth in homepage process[]; at most one optional services/{slug}.md for the primary offer.

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
