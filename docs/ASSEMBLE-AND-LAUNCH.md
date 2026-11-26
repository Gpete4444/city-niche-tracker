# Assemble and launch

End-to-end path from a staged candidate to a live Cloudflare Workers site.

## Prerequisites

1. Site-config accepted for the candidate
2. Content accepted (at least homepage_first)
3. **Stage homepage** in Rover (writes `research/{id}/site-staging/`)
4. Optional: template GitHub remote (see below) — assemble works **without** it via local copy
5. For **Launch** automation: `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` in `.env` (see `.env.example`). API calls are free.

## 1. Template GitHub remote (checklist item)

Create once for the master template ([github.com/7D7D/Rover](https://github.com/7D7D/Rover)):

```powershell
cd c:\Repos\Rover
gh repo create Rover --private --source=. --remote=origin --push
gh api repos/7D7D/Rover -X PATCH -f is_template=true
```

Or if the empty remote already exists:

```powershell
git remote add origin https://github.com/7D7D/Rover.git
# commit template-worthy files, then:
git push -u origin master
gh api repos/7D7D/Rover -X PATCH -f is_template=true
```

Rover detects the remote via `git remote get-url origin` or env:

```text
TEMPLATE_GITHUB_REPO=7D7D/Rover
```

Do **not** commit `.env` or `research/` (gitignored).

## 2. Assemble site folder

In Rover → Content → **Assemble site**, or:

```powershell
# API (Rover server running)
# POST /api/candidates/{id}/assemble  { "force": true }
```

Creates a sibling folder (default):

```text
c:\Repos\rover-sites\{domain-or-slug}\
```

Override with `ASSEMBLED_SITES_DIR` in `.env` (Rover UI and `npm run assemble-site` both load it).

What happens:

1. Copies this template (skips `ops/`, `research/`, `node_modules/`, `prompts/`, `data/`, `.env`)
2. Injects staging `src/config/site-config.json` + staged pages
3. Syncs live `src/content/services/` and `locations/` stubs
4. `git init` + initial commit in the site folder
5. Writes `_assemble.json` with next steps

## 3. Build smoke test

```powershell
cd c:\Repos\rover-sites\{slug}
npm install
npm run build
```

Checklist marks **build** done when `dist/index.html` exists.

## 4. GitHub + Cloudflare Worker deploy (automated by Launch)

**Per-site** GitHub create/push and Worker deploy run via Rover **Launch** (**Auto ship**) or **Push updates** (ship only, for sites already live). You should not run `gh` / `wrangler` yourself for each site.

### One-time machine setup

1. Install [GitHub CLI](https://cli.github.com) and run `gh auth login` once
2. Set `GITHUB_OWNER=your-org-or-user` in `.env` (or rely on `gh api user` / `TEMPLATE_GITHUB_REPO`)
3. Set `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (Workers Scripts Edit at minimum)
4. Optional for push-to-deploy rebuilds (one-time):
   - Install the **Cloudflare Workers and Pages** GitHub App: CF dashboard → any Worker → **Settings → Builds → Connect → GitHub** → authorize for `7D7D` (or your org). Docs: [GitHub integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)
   - On your **user** API token ([My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens)), add **Account → Workers Builds Configuration → Edit** (and keep Workers Scripts Edit). Account-owned tokens return `Authentication error` on the Builds API.
   - Re-run Launch (or ship) so Rover can `PUT …/builds/repos/connections` + create the production trigger (`npm run build` / `npx wrangler deploy`).

### What Auto ship does

1. `gh repo create` (private) for the assemble slug if needed, commit, push `main`
2. `npm install` + `npm run build` in the assembled folder
3. `npx wrangler deploy` (creates/updates the Worker from `wrangler.json`)
4. Best-effort Workers Builds GitHub connection (skipped quietly if the Builds API isn’t available)

Assemble already writes `wrangler.json` with `"assets": { "directory": "./dist" }` and the site slug as `name`.

If install fails with `npm ci` / lockfile out of sync, regenerate `package-lock.json` in the template (`npm install`), re-assemble, and re-run Launch.

## 5. Rover Launch (ship + Cloudflare Email Routing)

After Assemble, use Rover → Website → **Launch**:

1. Set domain / `leads@` / Email Routing destination (lead notify inbox from Account setup)
2. Leave **Auto ship** and **Connect domain and email** checked
3. **Run launch**

The live form posts to the shared Rover forms Worker (`formsIngestUrl`). **Web3Forms is not used.** That Worker stores the lead and emails the destination from `leads@{domain}`. Run launch stops until Phone/Form → **Set up inbox** has run once.

**Full step-by-step reference (UI fields, pipeline, soft-fails, env, meta flags):** [LAUNCH.md](LAUNCH.md).

Summary of what Launch does:

- Writes NAP into the **assembled** `src/config/site-config.json` (and research copy)
- Auto ship: GitHub repo + build + Wrangler deploy + Workers Builds connect (§4)
- Cloudflare: Email Routing (`leads@` → destination) + custom domain attach to the Worker
- Sets checklist meta flags (`formsDone`, `dnsDone`, `emailRoutingDone`, …)

### Already live — Push updates

After the first Launch, Website shows **Push updates** (primary). It calls ship only (`POST /api/candidates/:id/ship`): GitHub push + build + Wrangler — **no** domain/email API. Flow for template or content forever-fixes:

1. **Prepare preview** (Stage + Assemble) so the assembled tree picks up shared template changes
2. **Push updates**

**Run Cloudflare** defaults **off** when the candidate already looks live. Use **Run launch** only when changing keys or intentionally re-running CF helpers.

CLI:

```powershell
npm run launch-site -- <candidateId>
npm run launch-site -- <candidateId> --skip-cloudflare
npm run launch-site -- <candidateId> --skip-ship
npm run launch-site -- <candidateId> --destination=you@gmail.com
```

### Human leftovers (API cannot do these)

1. **Buy the domain in this Cloudflare account** (**Domains** → **Overview** → **Add domain**) so the zone is **Active**. Rover does not buy it.
2. **Verify** the Email Routing destination once (click the link in that inbox) when the destination is new
3. **One-time** machine setup: `gh auth login` + gear → **Account setup** (GitHub owner, Cloudflare, lead notify email) — not per site

### Cost

Cloudflare **API calls are $0**. You pay domains (~$10–15/yr). Form mail to the verified destination does not count toward the daily sending quota.

## 6. Forms notes

- `LeadForm.astro` posts only to the Rover forms Worker (`formsIngestUrl`)
- One-time: Phone/Form → **Set up inbox** (D1 + Worker). Per site: Launch / Push updates writes the ingest URL
- The Worker stores the lead, then emails `leads@{domain}` → the Email Routing destination
- Do **not** create a Web3Forms form or paste an access key
- A failed email stays in Phone/Form and the page shows an error
- Launch does not create a Turnstile widget. The form uses a honeypot, the domain allowlist, and a per-IP rate limit. See [TURNSTILE.md](TURNSTILE.md).

Never commit real keys to the **template** master if demos use placeholders.

## 7. Rover checklist flags

Assemble / build / template remote are auto-detected. CF / DNS / forms / email flags are set by **Launch** (or remain open until you run it). Open **Assemble checklist** or **Launch status** in Rover.

## Related

- Master flowchart + tools matrix: [MASTER-FLOW.md](MASTER-FLOW.md)
- **Run launch** button details: [LAUNCH.md](LAUNCH.md)
- Parked follow-ons (images, design polish, Ippei SEO compare): [BACKLOG.md](BACKLOG.md)
- Astro preview during ops: Stage homepage opens `http://127.0.0.1:4321/`
