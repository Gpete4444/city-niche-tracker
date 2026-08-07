# Assemble and launch

End-to-end path from a staged candidate to a live Cloudflare Pages site.

## Prerequisites

1. Site-config accepted for the candidate
2. Content accepted (at least homepage_first)
3. **Stage homepage** in ops (writes `research/{id}/site-staging/`)
4. Optional: template GitHub remote (see below) — assemble works **without** it via local copy

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

## 4. Cloudflare Pages

1. Push the assembled site to its **own** GitHub repo (one repo per domain):

   ```powershell
   cd c:\Repos\rank-and-rent-sites\{slug}
   gh repo create my-site-domain --private --source=. --remote=origin --push
   ```

2. Cloudflare Dashboard → Workers & Pages → Create → Connect Git
3. Settings:
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
   - **Node version:** 22+ (match `package.json` engines)
4. Deploy

## 5. DNS

1. In Pages → Custom domains → add your domain
2. At the registrar / CF DNS, point the domain as Cloudflare instructs (usually CNAME to `*.pages.dev` or CF proxy)

## 6. Forms (Web3Forms + optional Turnstile)

1. Create a key at [web3forms.com](https://web3forms.com)
2. In the **assembled** site’s `src/config/site-config.json`, set `web3FormsAccessKey`
3. Optional: set `turnstileSiteKey` from Cloudflare Turnstile
4. Commit, push, redeploy Pages

Never commit real keys to the **template** master if demos use placeholders.

## 7. Email Routing (`leads@`)

1. Cloudflare → Email → Email Routing for the domain
2. Destination address you control
3. Match `site-config.json` `email` (e.g. `leads@example.com`)

## Ops checklist flags

Manual CF/DNS/forms/email steps are not auto-detected yet. After you finish them, you can record in candidate meta later; for now treat the checklist UI as a runbook with ✓ only for remote / staging / assemble / local build artifacts.

## Related

- Parked follow-ons (images, design polish, Ippei SEO compare): [BACKLOG.md](BACKLOG.md)
- Astro preview during ops: Stage homepage opens `http://127.0.0.1:4321/`
