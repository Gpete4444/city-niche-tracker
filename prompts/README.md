# Prompts (Claude + DataForSEO)

**Operator UI:** `npm run rover` (alias `npm run ops`) → [http://127.0.0.1:8787](http://127.0.0.1:8787) runs the Rover pipeline locally (tables, stage actions, Anthropic draft → Accept). Prefer that over manual CLI when reviewing candidates.

**Discovery screen:** Rover → **Discovery** tab → generate CSV + Claude prompts → import → **DFS SERP probe** → decide. See [`discovery-claude.md`](discovery-claude.md).

Primary paid research path:

1. **Stage 1 — DataForSEO** — `npm run research-candidate` → Map Pack, organic counts; Ads volumes optional (`--skip-volumes` / Run all required). Rover modes: reuse Discovery SERP cache, **volumes-only**, **skip-volumes**, or **force SERP**.
2. **Stage 2 — Enrich** (optional) — `npm run enrich-candidate` (or `--enrich`) → DataForSEO Rank (not Moz DA), page thinness, displaceability (`fetch_failed` pages excluded)
3. **Stage 3 — Narrative** — Rover Claude / [`claude-candidate-research.md`](claude-candidate-research.md) → pain points, suburbs, services, keyword phrases when volumes skipped, jobValue / proposedScore. Needs SERP seeds, not Enrich. **Accept** writes `research/{id}-approved.json` (required handoff artifact)
4. **Site-config** — Rover **Site config** tab or [`claude-site-config.md`](claude-site-config.md) from approved package + NAP → `src/config/site-config.json` (suburb sanity on accept)
5. **Content** — Rover **Content** tab: **Structure → Outline → Full write → Editor → Accept**. Checklist + letter presets (`prompts/sections/registry.json`; prefer **C** for ranking). Outline seeds keywords from research volumes + live SERP PAA questions / organic titles. Editor is the human-speech + SEO pass (Speech check required; critical SEO blocks Accept unless override). Type A/B is a soft site-config hint. Legacy Brief / one-shot remain under Advanced → then Website Stage → Assemble → Launch
6. **Stage 4 — Prospects** (optional; outreach only — does not block build) — `npm run prospect-renters` → [`claude-prospect-renters.md`](claude-prospect-renters.md)

Scoring definitions (volume bands, Rank disclaimer, SERP softness, displaceability, specialty decision rules, Map Pack vs blue-links playbook): [`scoring-rubric.md`](scoring-rubric.md) · [`scripts/lib/scoring-rubric.json`](../scripts/lib/scoring-rubric.json)

Discovery uses Claude for narrative and DataForSEO SERP probe for Map Pack/organic. Claude’s Est. Monthly Search Volume is a primary-city guess — not Ads. When Ads volumes are skipped it can seed Research Demand (labeled estimate). Full cluster Ads volumes + Rank come from Stage 1+ after you promote a shortlist.
