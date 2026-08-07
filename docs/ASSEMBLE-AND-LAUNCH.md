# Assemble and launch

End-to-end path from a staged candidate to a live Cloudflare Workers site.

## Prerequisites

1. Site-config accepted for the candidate
2. Content accepted (at least homepage_first)
3. **Stage homepage** in ops (writes `research/{id}/site-staging/`)
4. Optional: template GitHub remote (see below) — assemble works **without** it via local copy
5. For **Launch** automation: `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` in `.env` (see `.env.example`). API calls are free.

## 1. Template GitHub remote (checklist item)

Create once for the master template:

```powershell
cd c:\Repos\rank-and-rent-template
gh repo create rank-and-rent-template --private --source=. --remote=origin --push
gh api repos/7D7D/rank-and-rent-template -X PATCH -f is_template=true
```

Or if the empty remote already exists:

```powershell
git remote add origin https://github.com/7D7D/rank-and-rent-template.git
# commit template-worthy files, then:
git push -u origin master
gh api repos/7D7D/rank-and-rent-template -X PATCH -f is_template=true
```

Ops detects the remote via `git remote get-url origin` or env:

```text
TEMPLATE_GITHUB_REPO=7D7D/rank-and-rent-template
```

Do **not** commit `.env` or `research/` (gitignored).

## 2. Assemble site folder

In ops → Content → **Assemble site**, or:

```powershell
# API (ops server running)
# POST /api/candidates/{id}/assemble  { "force": true }
```

Creates a sibling folder (default):

```text
c:\Repos\rank-and-rent-sites\{domain-or-slug}\
```

Override with `ASSEMBLED_SITES_DIR`.

What happens:

1. Copies this template (skips `ops/`, `research/`, `node_modules/`, `prompts/`, `data/`, `.env`)
2. Injects staging `src/config/site-config.json` + staged pages
3. Syncs live `src/content/services/` and `locations/` stubs
4. `git init` + initial commit in the site folder
5. Writes `_assemble.json` with next steps

## 3. Build smoke test

```powershell
cd c:\Repos\rank-and-rent-sites\{slug}
npm install
npm run build
```

Checklist marks **build** done when `dist/index.html` exists.

## 4. GitHub + first Cloudflare Worker deploy (still manual once)

1. Push the assembled site to its **own** GitHub repo (one repo per domain):

   ```powershell
   cd c:\Repos\rank-and-rent-sites\{slug}
   gh repo create my-site-domain --private --source=. --remote=origin --push
   ```

2. Cloudflare Dashboard → **Workers & Pages** → Create → connect that GitHub repo.

### If the UI looks like “Worker” Builds (Deploy command required)

This is the common 2025+ UI. There is **no** “Output directory = dist” field. Static files are published via Wrangler assets:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` (**required** — keep it) |
| Non-production deploy | `npx wrangler versions upload` (optional) |
| Path / root | `/` |

Repo must include `wrangler.json` with:

```json
{
  "name": "your-site-slug",
  "compatibility_date": "2025-08-01",
  "assets": {
    "directory": "./dist"
  }
}
```

Assemble writes this file using the site slug as `name`. Optional: set env `NODE_VERSION=22`.

### If the UI is classic Pages (Output directory visible)

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | empty |
| Output directory | `dist` |

If install fails with `npm ci` / lockfile out of sync, regenerate `package-lock.json` in the template (`npm install`), re-assemble or copy the lock into the site repo, and push again.

## 5. Ops Launch (Cloudflare API + Web3Forms paste)

After Assemble (and ideally after the Worker exists), use ops → Content → **Launch**:

1. Paste **Web3Forms** access key ([web3forms.com](https://web3forms.com) — create form manually; no public create-form API)
2. Set domain / `leads@` / Email Routing destination (Gmail)
3. Check **Run Cloudflare API** (needs `.env` tokens)
4. **Run launch**

What Launch does:

- Writes NAP + Web3Forms (+ optional Turnstile) into the **assembled** `src/config/site-config.json` (and research copy)
- Looks up the CF zone for the domain
- Enables Email Routing, ensures destination address, creates `leads@` → forward rule
- Attaches custom domain to the Worker named by assemble slug (when the Worker exists)
- Optionally creates a Turnstile widget
- Sets checklist meta flags (`formsDone`, `dnsDone`, `emailRoutingDone`, …)

CLI:

```powershell
npm run launch-site -- <candidateId>
npm run launch-site -- <candidateId> --skip-cloudflare
npm run launch-site -- <candidateId> --turnstile --destination=you@gmail.com
```

### Human leftovers (API cannot do these)

1. **Buy the domain** / point nameservers at Cloudflare (zone must exist in your account)
2. **Verify** Email Routing destination once (click link in Gmail)
3. **Create** the Web3Forms form and paste the key (semi-automation)
4. **Commit + push** the assembled site after Launch writes the key so CF rebuilds
5. First-time **GitHub repo + Workers Builds** project connect (§4)

### Cost

Cloudflare and Web3Forms **API calls are $0**. You pay domains (~$10–15/yr) and stay on free tiers for typical static + Email Routing + ~250 Web3Forms submissions/mo.

## 6. Forms notes

- Site form already posts to `https://api.web3forms.com/submit` via `LeadForm.astro`
- Placeholders `YOUR_*` and `REPLACE_WEB3FORMS_*` show the demo banner
- Optional `turnstileSiteKey` from Launch or Site config edit

Never commit real keys to the **template** master if demos use placeholders.

## 7. Ops checklist flags

Assemble / build / template remote are auto-detected. CF / DNS / forms / email flags are set by **Launch** (or remain open until you run it). Open **Assemble checklist** or **Launch status** in ops.

## Related

- Master flowchart + tools matrix: [MASTER-FLOW.md](MASTER-FLOW.md)
- Parked follow-ons (images, design polish, Ippei SEO compare): [BACKLOG.md](BACKLOG.md)
- Astro preview during ops: Stage homepage opens `http://127.0.0.1:4321/`
