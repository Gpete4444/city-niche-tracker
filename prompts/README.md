# Prompts (Claude + DataForSEO)

**Operator UI:** `npm run ops` → [http://127.0.0.1:8787](http://127.0.0.1:8787) runs the pipeline locally (tables, stage actions, Anthropic draft → Accept). Prefer that over manual CLI when reviewing candidates.

**Discovery screen:** Ops → **Discovery** tab → generate CSV + Claude prompts → import → **DFS SERP probe** → **Gemini volumes** → decide. See [`discovery-claude.md`](discovery-claude.md) · [`discovery-gemini.md`](discovery-gemini.md).

Primary paid research path:

1. **Stage 1 — DataForSEO** — `npm run research-candidate` → Map Pack, organic counts, per-city volumes, demand band + decision stub. Ops modes: reuse Discovery SERP cache, **volumes-only**, or **force SERP**.
2. **Stage 2 — Enrich** — `npm run enrich-candidate` (or `--enrich`) → DataForSEO Rank (not Moz DA), page thinness, displaceability (`fetch_failed` pages excluded)
3. **Stage 3 — Narrative** — ops Claude / [`claude-candidate-research.md`](claude-candidate-research.md) → pain points, suburbs, services, jobValue / proposedScore. **Accept** writes `research/{id}-approved.json` (required handoff artifact)
4. **Site-config** — ops **Site config** tab or [`claude-site-config.md`](claude-site-config.md) from approved package + NAP → `src/config/site-config.json` (suburb sanity on accept)
5. **Content** — ops **Content** tab: Researcher → Outline → Writer → Editor (homepage-first), keyed by **siteArchetype** (Type A multi_service / Type B single_service) → build package → stage → `npm run build`
6. **Stage 4 — Prospects** (optional; outreach only — does not block build) — `npm run prospect-renters` → [`claude-prospect-renters.md`](claude-prospect-renters.md)

Scoring definitions (volume bands, Rank disclaimer, SERP softness, displaceability, specialty decision rules, Map Pack vs blue-links playbook): [`scoring-rubric.md`](scoring-rubric.md) · [`scripts/lib/scoring-rubric.json`](../scripts/lib/scoring-rubric.json)

Discovery uses Claude for narrative, DataForSEO SERP probe for Map Pack/organic, and Gemini for volume estimates. Full cluster volumes + Rank still come from Stage 1+ after you promote a shortlist.
