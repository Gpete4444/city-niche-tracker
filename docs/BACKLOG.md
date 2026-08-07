# Backlog (parked)

Items intentionally deferred until Sprint E assemble/launch is routine. Do not block shipping on these.

## Images pipeline

**When:** A site is near launch and needs real visuals.

**Scope (later):**

- Replace Unsplash demos in `public/images/` with niche-appropriate hero / card / gallery assets
- Writer/Editor prompts: only emit `heroImage` / `cardImage` / `featureImage` / `gallery` when files exist
- Keep `npm run generate-map` for coverage SVG ([README](../README.md))
- No generative-image ops pipeline unless we explicitly add one

**Today:** Manual drop-in under `public/images/` + frontmatter `src`/`alt` (see README “Optional images”).

## Template design / layout polish

**When:** After assemble path works and we’re iterating on live Spanish Fork (or next) preview.

**Scope (later):**

- Small spacing / services grid / hero budget tweaks in shared Astro components
- Avoid a full redesign before clone-per-site is proven — every change ships to all assembled sites

## Claude deep compare vs Ippei content

**When:** After a few real sites, to harden Writer prompts.

**Scope (later):**

- Ops or one-off prompt: paste Ippei sample page text/URLs + our staged homepage
- Score SEO structure, local intent, EEAT, CTA clarity, thinness
- Feed findings into `prompts/claude-markdown.md` and agent packs
- **No** Ippei SaaS/API integration (locked in site build pipeline)

## Done vs parked

| Area | Status |
|------|--------|
| Discovery → site-config → content → stage → preview | Working |
| Assemble site folder + checklist + launch docs | Working |
| CF domain / Email Routing / forms Launch helpers | Working (ops Launch + `npm run launch-site`; Web3Forms key still paste; first GH/Worker connect still manual) |
| Images / design / Ippei SEO compare | Parked here |
