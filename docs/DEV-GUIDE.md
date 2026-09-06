# Rover Dev Guide

Source of truth for engineers. Change the **pipeline** (prompts, Structure, `ops/lib`, shared Astro `src/`) so current and future candidates work — not one assembled tree under `rank-and-rent-sites/` or `rover-sites/`.

Operator walkthrough: [USER-GUIDE.md](USER-GUIDE.md). Time estimates: [USER-FLOW.md](USER-FLOW.md).

## Product vs folders {#product-vs-folders}

| Name | What it is |
| ---- | ---------- |
| **Rover** | Product and dashboard. Say Rover in UI copy and chat — never “Ops”. |
| `ops/` | Code folder for the dashboard (`ops/public`, `ops/server.mjs`, `ops/lib/`). Path ≠ product name. |
| `src/` | Shared Astro template (pages, components, `site-config`, content collections). |
| `research/` | Per-candidate JSON, drafts, staging, meta. Gitignored secrets/tokens. |
| `prompts/` | Claude / agent prompts. Pipeline-forever: fix the prompt, not one site’s Markdown. |
| `scripts/` | Research, enrich, prospects, scoring CLI used by Rover jobs. |
| Assembled trees | `rover-sites/` or `rank-and-rent-sites/` copies. Temporary recovery only after the forever fix ships. |

Start the dashboard with `npm run rover` (alias `npm run ops`).

## How to run {#run}

```powershell
npm run rover
```

Binds **127.0.0.1:8787**. Do not expose it.

Template preview (shared `src/`):

```powershell
astro dev --background
```

Ports: Rover **8787**; Astro template often **4321**; assembled previews use a pool from **4322**. Stop with `astro dev stop`. After `.env` changes, restart Rover.

## Pipeline data {#pipeline-data}

Each candidate id maps through [`ops/lib/candidates.mjs`](../ops/lib/candidates.mjs) `pathsFor(id)` to files under `research/`:

- `{id}.config.json`, `{id}.research.json`, `{id}.narrative.json` / draft, `{id}.approved.json`
- Meta (decisions, `indexingDone`, assemble paths, last job ids)
- `site-staging/`, photo manifests, pull status

**Ranks:** Discovery Candidate → Research Candidate (after Process) → Website Candidate (`decision === 'pursue'`) → Launched Candidate.

**Decisions:** pursue, maybe, review, hold, pass, ignore. **pursue** unlocks Website. Pass is tracked (do-not-repropose). Ignore is rediscoverable.

Do not invent a second “Ops product”. Dashboard state lives in `ops/public/app.js` `state` plus these files.

## Dashboard {#dashboard}

- Server: [`ops/server.mjs`](../ops/server.mjs) — Express, static `ops/public`, all `/api/*`.
- Client: [`ops/public/app.js`](../ops/public/app.js) + [`ops/public/index.html`](../ops/public/index.html) + [`ops/public/styles.css`](../ops/public/styles.css).
- Views: `discovery`, `research`, `website-builder`, `launched-sites`, `phone`, `map`, `photo`.
- Jobs SSE: `GET /api/heavy-jobs/stream`, `GET /api/light-jobs/stream` (register `/stream` **before** `/:jobId`).
- Help: `GET /api/help/user-guide` (User guide only).

## Forever rule {#forever}

When a bug shows on one candidate:

1. Fix prompts, Structure, `ops/lib/*`, or shared `src/`.
2. Then Assemble / Write / Pull / Stage so the next candidate cannot hit the same class of failure.
3. Candidate-specific backfills are recovery after that fix, never the only remedy.

## Discovery {#discovery}

**What:** Pack filters → Claude CSV → import → Light SERP → decisions → Process.

**Where:** [`ops/lib/discovery.mjs`](../ops/lib/discovery.mjs), [`ops/lib/census.mjs`](../ops/lib/census.mjs), [`ops/lib/discovery-recommend.mjs`](../ops/lib/discovery-recommend.mjs), [`ops/lib/discovery-serp-probe.mjs`](../ops/lib/discovery-serp-probe.mjs), [`ops/lib/known-candidates.mjs`](../ops/lib/known-candidates.mjs), [`prompts/discovery-claude.md`](../prompts/discovery-claude.md).

**API:** `/api/discovery/presets`, batches, places, `serp-probe`.

**Connects:** Process creates Research candidates via [`createCandidate`](../ops/lib/candidates.mjs). Do-not-repropose uses known + tracked pairs (Website/Launched never wiped from Advanced).

**Do not:** Patch a single imported CSV as the product fix; change pack prompt or Process rules.

## Research scripts and scoring {#research}

**What:** Evaluation 1 SERP/Volume, Evaluation 2 Enrich, optional Prospects. Rubric bands in UI.

**Where:** [`scripts/research-candidate.mjs`](../scripts/research-candidate.mjs), [`scripts/enrich-candidate.mjs`](../scripts/enrich-candidate.mjs), [`scripts/prospect-renters.mjs`](../scripts/prospect-renters.mjs), [`scripts/lib/scoring-rubric.json`](../scripts/lib/scoring-rubric.json), [`prompts/scoring-rubric.md`](../prompts/scoring-rubric.md), [`ops/lib/run-script.mjs`](../ops/lib/run-script.mjs), [`ops/lib/batch-jobs.mjs`](../ops/lib/batch-jobs.mjs).

**API:** `POST /api/candidates/:id/research`, `/enrich`, `/prospects`; poll `GET /api/jobs/:jobId`. Script jobs also open **Light** jobs with coarse log milestones.

**Connects:** Writes `research/{id}.research.json`. Enrich requires Eval 1. UI metrics: [`ops/public/metrics.js`](../ops/public/metrics.js).

**Do not:** Hand-edit one research JSON to “fix scoring”; change the rubric and rescore path.

## Narrative and Claude {#narrative}

**What:** Copy prompt → Claude JSON → Load draft → Accept approved package.

**Where:** [`ops/lib/claude.mjs`](../ops/lib/claude.mjs), [`prompts/claude-candidate-research.md`](../prompts/claude-candidate-research.md), accept in [`ops/lib/candidates.mjs`](../ops/lib/candidates.mjs) (`acceptNarrative`).

**API:** `GET .../copy-prompt`, `POST .../narrative/paste`, `.../narrative/accept`. Job-cost seed band can 400 `job_cost_seed_mismatch`.

**Connects:** Accept merges narrative into research + `approved` pack. Required before Prospects. `pursue` is a human decision on Overview, not automatic.

## Site-config and address {#site-config}

**What:** Palette/fonts, commercial address Find, NAP, Claude site-config, Accept, service area map, Twilio provision.

**Where:** [`ops/lib/site-config.mjs`](../ops/lib/site-config.mjs), [`ops/lib/address-screen.mjs`](../ops/lib/address-screen.mjs), [`ops/lib/geo-neighbors.mjs`](../ops/lib/geo-neighbors.mjs), [`scripts/lib/site-palettes.mjs`](../scripts/lib/site-palettes.mjs), [`scripts/lib/site-fonts.mjs`](../scripts/lib/site-fonts.mjs), [`prompts/claude-site-config.md`](../prompts/claude-site-config.md), [`src/config/site.ts`](../src/config/site.ts) (Zod).

**API:** `/api/candidates/:id/site-config/*`, `/address/*`, service-area.

**Connects:** Accepted config is what assemble injects. Address Find uses Apify (LoopNet/Crexi) + Google Places. Active OPERATIONAL listing lock is in address-screen, not a one-off site.

**Do not:** Hard-code one city’s streets in an assembled `site-config.json` as the product fix.

## Content eight-pass {#content}

**What:** Structure → site research → brief → outline → batched write → humanize → final check → image queries → photo group → Accept.

**Where:** [`ops/lib/content-structure.mjs`](../ops/lib/content-structure.mjs), [`ops/lib/content-agents.mjs`](../ops/lib/content-agents.mjs), [`ops/lib/content-markdown.mjs`](../ops/lib/content-markdown.mjs), [`ops/lib/content-eight-pass.mjs`](../ops/lib/content-eight-pass.mjs), [`ops/lib/content-seo-lint.mjs`](../ops/lib/content-seo-lint.mjs), [`ops/lib/content-speech-lint.mjs`](../ops/lib/content-speech-lint.mjs), [`ops/lib/content-auto-fix.mjs`](../ops/lib/content-auto-fix.mjs), [`prompts/agents/`](../prompts/agents/), [`docs/SECTION-UX.md`](SECTION-UX.md).

**API:** `/api/candidates/:id/content/*`, `POST .../content/accept` (Light job, 4 ticks: write files, photos, logo, coverage map).

**Connects:** Accept writes `src/content/` in the **template** working tree (backed up), then assets. Service body typing: [`src/lib/service-body.ts`](../src/lib/service-body.ts) (`classifyHeading`). Typed sections: [`src/components/sections/TypedProseSection.astro`](../src/components/sections/TypedProseSection.astro).

**Do not:** Fix a single assembled `src/content/services/*.md` instead of heading classifiers / prompts.

## Images, logo, map, photo library {#images}

**What:** Stock pull, slot generate (OpenAI), logo, coverage SVG, niche photo groups.

**Where:** [`ops/lib/fill-site-images.mjs`](../ops/lib/fill-site-images.mjs), [`ops/lib/generate-site-logo.mjs`](../ops/lib/generate-site-logo.mjs), [`ops/lib/generate-coverage-map.mjs`](../ops/lib/generate-coverage-map.mjs), [`ops/lib/photo-groups.mjs`](../ops/lib/photo-groups.mjs), [`ops/lib/photo-library.mjs`](../ops/lib/photo-library.mjs), [`ops/lib/openai-generate.mjs`](../ops/lib/openai-generate.mjs), [`ops/lib/chatgpt-slot-image.mjs`](../ops/lib/chatgpt-slot-image.mjs), [`ops/lib/chatgpt-before-after.mjs`](../ops/lib/chatgpt-before-after.mjs).

**API:** `/images/pull`, slot generate/repull, `/logo/generate`, `/coverage-map/generate`, photo-groups. Pull and map forward `onProgress` into Light jobs.

**Connects:** Homepage Also serving: [`src/components/HomeSections.astro`](../src/components/HomeSections.astro). Coverage callout placement is in generate-coverage-map (gutter outside union bbox). Photo groups live under `research/_photo-groups/` (gitignored). Niche master upserts on Prepare preview.

**Do not:** Hand-replace one live `public/images/` file as the forever photo fix.

## Heavy jobs vs Light jobs {#jobs}

**Heavy** ([`ops/lib/rover-heavy-jobs.mjs`](../ops/lib/rover-heavy-jobs.mjs)): Concurrent Limit pool (1–12), **one active job per candidate**, phases `assemble` | `preview` | `prepare` | `launch` | `ship` (plus `orphan`). Extra starts when already at the box get `HEAVY_CONCURRENCY` (no silent queue). `updateJobProgress({ detail, done, total })`. Snapshot `progressDone` / `progressTotal` for header rows.

**Light** ([`ops/lib/rover-light-jobs.mjs`](../ops/lib/rover-light-jobs.mjs)): no K queue. Accept, logo, coverage-map, images-pull, research/enrich/prospects (via `openLightJob` in run-script). **Write site** allows up to the Settings Write site box on different candidates (`assertWriteSiteStartAllowed`); same candidate is still exclusive. Generate pack stays one at a time. **Concurrent Limit** ([`ops/lib/rover-concurrency.mjs`](../ops/lib/rover-concurrency.mjs)) lives in Settings — Evaluations UI batches that select more rows than the box get `EVAL_CONCURRENCY`. Same candidate + act cannot double-start (`assertScriptJobStartAllowed`).

**UI:** [`renderHeavyJobs`](../ops/public/app.js) / `renderLightJobs`; master strip summarizes when 2+ active.

**Do not:** Start a second heavy phase on the same candidate (409). Wrap new long UI work as Light (or Heavy if it must serialize with assemble).

## Stage, assemble, preview, ship, launch {#ship}

**What:** Stage template copy → assemble sibling folder → local preview → GitHub + Wrangler → CF domain/email.

**Where:** [`ops/lib/site-staging.mjs`](../ops/lib/site-staging.mjs), [`ops/lib/assemble-site.mjs`](../ops/lib/assemble-site.mjs), [`ops/lib/assemble-site-worker.mjs`](../ops/lib/assemble-site-worker.mjs), [`ops/lib/assembled-preview.mjs`](../ops/lib/assembled-preview.mjs), [`ops/lib/ship-site.mjs`](../ops/lib/ship-site.mjs), [`ops/lib/launch-site.mjs`](../ops/lib/launch-site.mjs), [`ops/lib/cloudflare-launch.mjs`](../ops/lib/cloudflare-launch.mjs), [`ops/lib/github-site.mjs`](../ops/lib/github-site.mjs), [`ops/lib/preview-fidelity.mjs`](../ops/lib/preview-fidelity.mjs), [`ops/lib/launched-edit-guard.mjs`](../ops/lib/launched-edit-guard.mjs), [`ops/lib/visual-edit.mjs`](../ops/lib/visual-edit.mjs).

**API:** `POST .../prepare-preview` (202 + poll heavy job; 5 ticks), `.../assemble` (4 ticks), `.../assembled/preview` (2 ticks), `.../launch`, `.../ship`. Live sites: Prepare then **Push updates** (ship only).

**Connects:** Default assemble dir `rover-sites/` (`ASSEMBLED_SITES_DIR`). Docs: [ASSEMBLE-AND-LAUNCH.md](ASSEMBLE-AND-LAUNCH.md), [LAUNCH.md](LAUNCH.md).

**Do not:** Edit files only inside one assembled folder and skip template/`ops` — the next Prepare overwrites from staging + template.

## Phone {#phone}

**What:** Twilio ranking DID, forward on rent, call log, recordings, summaries.

**Where:** [`ops/lib/phone-tracking-twilio.mjs`](../ops/lib/phone-tracking-twilio.mjs), [`ops/lib/phone-calls.mjs`](../ops/lib/phone-calls.mjs), [`ops/twilio-functions/`](../ops/twilio-functions/).

**API:** `/api/phone/*`, `POST .../phone/provision-twilio`, skip. Doc: [PHONE-TRACKING.md](PHONE-TRACKING.md).

**Do not:** Provision in Discovery/Research. CallRail is not used.

## Map screen {#map-screen}

**What:** Geography assist (Discovery cities / coverage preview).

**Where:** [`ops/lib/research-map.mjs`](../ops/lib/research-map.mjs), [`ops/public/research-map.js`](../ops/public/research-map.js), [`ops/public/service-area-map.js`](../ops/public/service-area-map.js). API `/api/map/*`.

Separate from **coverage-map.svg** generation (Launch track Logo & Map).

## Photo screen {#photo-screen}

**What:** Niche masters and named groups UI. Apply path is Website Load / Accept / Prepare upsert.

**Where:** [`ops/lib/photo-library.mjs`](../ops/lib/photo-library.mjs), [`ops/lib/photo-groups.mjs`](../ops/lib/photo-groups.mjs).

## Launched metrics and GSC {#launched-metrics}

**What:** Portfolio rows, rent, indexing done flag, Search Console traffic/ranks.

**Where:** [`ops/lib/sites.mjs`](../ops/lib/sites.mjs), [`ops/lib/site-metrics.mjs`](../ops/lib/site-metrics.mjs), [`ops/lib/gsc-sync.mjs`](../ops/lib/gsc-sync.mjs), [`ops/lib/gsc-oauth.mjs`](../ops/lib/gsc-oauth.mjs), [`ops/lib/rank-track.mjs`](../ops/lib/rank-track.mjs). Docs: [SITES-METRICS.md](SITES-METRICS.md), [SITE-INDEXING.md](SITE-INDEXING.md).

`POST /api/candidates/:id/indexing/done` persists `indexingDone` / `lastIndexingAt` on meta (not in-memory only).

## Template (Astro) {#template}

**What:** The site every assemble copies.

**Where:** `src/pages/`, `src/components/`, `src/config/site-config.json` + `site.ts`, `src/content/`, [`src/lib/service-body.ts`](../src/lib/service-body.ts), [`src/lib/locations-for-site.ts`](../src/lib/locations-for-site.ts).

**Connects:** Structure drives which sections render. Extra coverage cities = Also serving, not extra location pages (prefer 4–6 location files). Schema/NAP fallbacks when no street.

**Do not:** Patch `rank-and-rent-sites/{slug}/src/...` as the only fix.

## Costs and env {#env}

[`ops/lib/api-cost.mjs`](../ops/lib/api-cost.mjs), [`ops/lib/cost-estimates.mjs`](../ops/lib/cost-estimates.mjs), [ENV-SETUP.md](ENV-SETUP.md), `.env.example`. Settings greens come from `/api/health`-style connection checks on the server.

## Help {#help}

[`ops/lib/help-markdown.mjs`](../ops/lib/help-markdown.mjs) parses [USER-GUIDE.md](USER-GUIDE.md) into `{ sections: [{ id, title, level, html, text }] }`. `GET /api/help/user-guide`. Dev guide is not served to the dashboard.

## Topic docs {#topic-docs}

| Doc | Use |
| --- | --- |
| [USER-GUIDE.md](USER-GUIDE.md) | Operator chrome and clicks |
| [USER-FLOW.md](USER-FLOW.md) | Time estimates |
| [ROVER-FLOW.md](ROVER-FLOW.md) | Naming + flowchart |
| [PIPELINE-STAGES.md](PIPELINE-STAGES.md) | Funnel definitions |
| [MASTER-FLOW.md](MASTER-FLOW.md) | Tools and costs overview |
| [ASSEMBLE-AND-LAUNCH.md](ASSEMBLE-AND-LAUNCH.md) | Assemble/ship runbook |
| [LAUNCH.md](LAUNCH.md) | Run launch / Push updates |
| [SECTION-UX.md](SECTION-UX.md) | Structure section UX |
| [ENV-SETUP.md](ENV-SETUP.md) | Keys |
| [PHONE-TRACKING.md](PHONE-TRACKING.md) | Twilio |
| [SITE-INDEXING.md](SITE-INDEXING.md) | Google index |
| [SITES-METRICS.md](SITES-METRICS.md) | GSC |
| [SEO-RATING.md](SEO-RATING.md) | On-page quality |
| [CHANGELOG.md](CHANGELOG.md) | Releases |
| [GITHUB-ACCESS-GATEWAY.md](GITHUB-ACCESS-GATEWAY.md) | Repo access for non-devs |
