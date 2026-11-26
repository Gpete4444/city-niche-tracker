# Operator one-time setup manual (Rover 2.8)

Do this **once per machine / account** before you run sites. Visual map: [OPERATOR-FLOWS.md](OPERATOR-FLOWS.md) · printable [flows/operator-flows.html](flows/operator-flows.html). After the required Settings rows are green, use [OPERATOR-SITE-RUNBOOK.md](OPERATOR-SITE-RUNBOOK.md) for every niche → live site.

**Where keys go:** gear → **Account setup**. Each row has **How to get this key**. **Save** applies that key with no restart. The `.env` paste blocks below are the advanced path. A hand edit of `.env` still needs a restart. This development checkout does not ask you to sign in and does not lock the pipeline. Weekly **Full** / **Maintain** applies only on a customer install ([ACCOUNTS.md](ACCOUNTS.md)).

**Deep paste-every-key guide:** [ENV-SETUP.md](ENV-SETUP.md) (same order as Settings → API/Other).  
**Repo access first (browser only)?** [GITHUB-ACCESS-GATEWAY.md](GITHUB-ACCESS-GATEWAY.md).  
**Moving an old Rover folder to 2.8?** [ROVER-UPDATE-COPY.md](ROVER-UPDATE-COPY.md).

**Not in this doc:** buying a domain, Provision phone, Run launch, or picking the next city in a metro cluster — those are **per site** (see the site runbook, especially **Part B0** — find sibling cities in Research via Decision **hold** / **FIND** / Batch; do **not** use the Research **Cluster:** dropdown for metro packages).

### Lead mail (Rover 2.5 onward, including 2.8) — Web3Forms removed

**Web3Forms is gone for go-live.** Do not create a Web3Forms form, paste an access key, or expect Launch to set one up. **Run launch** stops until the forms inbox exists.

New path (required once, then every site reuses it):

```text
Contact form → Rover forms Worker (D1) → email from leads@{domain}
                → Cloudflare Email Routing → lead notify email
                → Phone/Form (same lead while Rover is open)
```

1. Set the lead notify address in gear → **Account setup** (or `LEAD_NOTIFY_EMAIL` in `.env`). Gmail, Zoho, or any inbox Cloudflare can verify.
2. Phone/Form → **Set up inbox** (Cloudflare token needs **Account → D1 → Edit**).
3. Launch / Push updates writes `formsIngestUrl` into the live contact form.

Old Web3Forms access keys in research configs are leftovers only. They are not used for new ships.

---

## 0. GitHub account + Cursor (once)

You need GitHub for (a) reading / cloning the private Rover repo and (b) Launch **Auto ship** creating a private repo per site. Cursor is the editor + terminal you use on this PC.

### 0a. GitHub account and Rover invite

1. If you do not have a GitHub account yet, follow [GITHUB-ACCESS-GATEWAY.md](GITHUB-ACCESS-GATEWAY.md) through **Accept invitation** to **https://github.com/7D7D/Rover**.
2. Confirm you can open the repo while signed in: [github.com/7D7D/Rover](https://github.com/7D7D/Rover).
3. Remember the **exact** username (profile menu, top-right). Launch later requires `gh` and `GITHUB_OWNER` to match this account (or an org it can create repos under).

### 0b. Install Git (Windows)

1. Install [Git for Windows](https://git-scm.com/download/win) if `git --version` fails in a new terminal.
2. During setup, leave defaults (PATH available from command line is fine).

### 0c. Install Cursor

1. Download and install [Cursor](https://cursor.com/) (Windows).
2. Sign in when prompted (Cursor account is separate from GitHub).
3. Optional but useful: **Settings → Cursor Settings → account** so Agent / chat work on this machine.

### 0d. Clone Rover into Cursor

Pick **one** path.

**Option A — Cursor UI**

1. Cursor → **File → Open Folder…** only works after the folder exists. First clone:
2. **Terminal → New Terminal** (or install GitHub Desktop / use PowerShell) and run:

   ```powershell
   cd C:\Repos
   git clone https://github.com/7D7D/Rover.git Rover-2.8
   ```

3. Cursor → **File → Open Folder…** → select `C:\Repos\Rover-2.8` (or your path).
4. If Git asks you to sign in to GitHub for a private clone, use the same account Paul invited.

**Option B — GitHub CLI (good if you will Launch from this PC)**

1. Install [GitHub CLI](https://cli.github.com/) if needed.
2. In PowerShell:

   ```powershell
   gh auth login
   ```

   Choose GitHub.com → HTTPS → Login with a web browser → finish as the invited account.
3. Clone:

   ```powershell
   cd C:\Repos
   gh repo clone 7D7D/Rover Rover-2.8
   ```

4. Open that folder in Cursor (**File → Open Folder…**).

### 0e. Cursor day-to-day for Rover

1. Always open the **Rover folder root** (the folder that contains `package.json`, `ops/`, `docs/`, `.env`).
2. Use Cursor’s terminal for `npm install`, `npm run rover`, and `gh` commands (same folder).
3. Edit `.env` in Cursor; **never commit** it.
4. When Help points you at a paste prompt (Gemini address search, image prompts from captions), paste into the tool named in Help — not into `.env`.

---

## 1. Install Node and open Rover

1. Install [Node.js](https://nodejs.org/) **22.12+** if needed (`node -v`).
2. In the Rover folder (Cursor terminal):

   ```powershell
   npm install
   ```

3. Copy `.env.example` → `.env` (keep `.env.example` unchanged).
4. Prefer gear → **Account setup** for each key below. **Save** applies it with no restart. `.env` still works if you paste there instead. **Never commit `.env`.**
5. After a hand edit of `.env`: stop Rover (`Ctrl+C`) and run `npm run rover` again. Account setup does not need that restart.
6. Dashboard: [http://127.0.0.1:8787](http://127.0.0.1:8787) → gear → **API/Other** → make the **required** rows green (checklist at the end). Some rows stay red by design when unset: **Template repo**, **Assembled sites dir** (defaults work), **Anthropic Admin**, unused stock providers, unused Apify actor, and GSC until you Connect.

If you are upgrading from an older Rover folder, copy local data first ([ROVER-UPDATE-COPY.md](ROVER-UPDATE-COPY.md)), then `npm install` here.

---

## 2. Discovery & research — DataForSEO

**Once:** create/fund a DataForSEO account.

1. [DataForSEO API Access](https://app.dataforseo.com/api-access) — sign up / log in.
2. Copy API **login** and **password** from that page.
3. Fund at least **SERP** and **Keywords Data** (Backlinks for Enrich; Maps SERP for Prospects).
4. In `.env`:

   ```env
   DATAFORSEO_LOGIN=you@example.com
   DATAFORSEO_PASSWORD=your-api-password
   ```

5. Restart Rover → Settings → **DataForSEO** green.

Full notes: [ENV-SETUP.md](ENV-SETUP.md) §1.

---

## 3. Copy & AI — Anthropic + OpenAI

### Anthropic (Claude)

1. [Anthropic Console](https://console.anthropic.com/) — create API key; add credits.
2. If the key is identity-linked / multi-workspace, also set `ANTHROPIC_WORKSPACE_ID` (Settings → Workspaces → `wrkspc_…`).
3. In `.env`:

   ```env
   ANTHROPIC_API_KEY=sk-ant-…
   # ANTHROPIC_WORKSPACE_ID=wrkspc_…
   ```

4. Restart Rover → **Anthropic** green.

### OpenAI

Used for image generate, logos, and Phone STT/summaries (same key).

1. [OpenAI API keys](https://platform.openai.com/api-keys) — create key; billing on.
2. In `.env`:

   ```env
   OPENAI_API_KEY=sk-…
   ```

3. Restart Rover → **Website · images → GPT Image (OpenAI)** and **Phone → OpenAI** both green (same key).

Full notes: [ENV-SETUP.md](ENV-SETUP.md) §2 / §6b.

---

## 4. Site-Config · address — Google Maps + Apify (required)

**Required** for Site-Config **Find** commercial streets (the normal address path). Manual / Home paste / Skip still work without these, but operators should set Maps + Apify once so Find is green before the first site.

### 4a. Google Maps API key

1. Open [Google Cloud Console](https://console.cloud.google.com/) and sign in.
2. Project picker (top bar) → **New project** → name it (e.g. `rover-maps`) → **Create** → select that project.
3. Open [Billing](https://console.cloud.google.com/billing) and **link a billing account** to the project (Maps calls fail until billing is on).
4. Enable both APIs in this project:
   - [Places API (New)](https://console.cloud.google.com/apis/library/places.googleapis.com) → **Enable** (not the legacy Places API).
   - [Geocoding API](https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com) → **Enable**.
5. Open [Credentials](https://console.cloud.google.com/apis/credentials) → **+ Create credentials** → **API key** → copy the key (`AIza…`).
6. Restrict the key (recommended): edit the key → **API restrictions** → **Restrict key** → select only **Places API (New)** and **Geocoding API** → **Save**.  
   For application restrictions, prefer **IP addresses** (this machine’s public IP). Do **not** use HTTP referrers — Rover calls Maps from the server, not the browser.
7. In Cursor, open `.env` and paste:

   ```env
   GOOGLE_MAPS_API_KEY=AIza…
   ```

8. Save → `Ctrl+C` → `npm run rover` → Settings → **Site-config · address → Google Maps** green.

More detail: [GOOGLE-MAPS-API.md](GOOGLE-MAPS-API.md).

### 4b. Apify (LoopNet + Crexi)

Find needs `APIFY_TOKEN` plus **at least one** of LoopNet / Crexi actor ids (set both if you use both toggles).

1. Open [Apify Console → Integrations](https://console.apify.com/settings/integrations) — sign up or log in; add billing / credits if prompted.
2. Copy your **API token** (`apify_api_…`).
3. Open the [Apify Store](https://apify.com/store). Prefer actors around ~$1.20–$1.50 per 1K results.
4. **LoopNet:** open a LoopNet actor page (e.g. Solidcode). Copy the id under the title (`username/actor-name`) and convert `/` to `~` for `.env` (example `solidcode~loopnet-com-scraper`).
5. **Crexi:** open [Solidcode Crexi scraper](https://apify.com/solidcode/crexi-scraper). Copy `solidcode/crexi-scraper` → use `solidcode~crexi-scraper` in `.env`.
6. In Cursor, open `.env` and paste (fill real values):

   ```env
   APIFY_TOKEN=apify_api_…
   APIFY_LOOPNET_ACTOR_ID=username~loopnet-actor-name
   APIFY_CREXI_ACTOR_ID=solidcode~crexi-scraper
   ```

   Optional defaults Rover already knows (override only if needed):

   ```env
   # APIFY_LOOPNET_FALLBACK_ACTOR_ID=abotapi~loopnet-scraper
   # APIFY_LOOPNET_DETAILS_ACTOR_ID=one-api~loopnet-scraper
   ```

7. Save → restart Rover → Settings → **Apify token** green, plus **LoopNet actor** and/or **Crexi actor** for the sources you use. Find needs the token and **at least one** actor — the other actor row may stay red.

---

## 5. Website · images (stock)

At least one stock provider for Accept / Pull (unless you always Skip stock and use photo groups / OpenAI only):

```env
UNSPLASH_ACCESS_KEY=
PEXELS_API_KEY=
PIXABAY_API_KEY=
```

GPT Image uses `OPENAI_API_KEY` above. Full notes: [ENV-SETUP.md](ENV-SETUP.md) §4.

---

## 6. Assemble & launch — GitHub CLI + owner (once)

Launch **Auto ship** creates a private repo per site under one GitHub user/org. This is separate from “can I read the Rover docs repo.”

1. Install [GitHub CLI](https://cli.github.com/) if you skipped Option B above.
2. In a terminal (Cursor terminal is fine):

   ```powershell
   gh auth login
   ```

   Choose GitHub.com → HTTPS → Login with a web browser → finish as the account that **owns** site repos.
3. Confirm:

   ```powershell
   gh api user --jq .login
   ```

   That login must match (or be allowed to create repos under) `GITHUB_OWNER`.
4. In `.env`:

   ```env
   GITHUB_OWNER=YourExactGitHubUserOrOrg
   ```

   Example: if `gh` prints `Gpete4444`, set `GITHUB_OWNER=Gpete4444` (not a different account).
5. Optional:

   ```env
   TEMPLATE_GITHUB_REPO=7D7D/Rover
   ASSEMBLED_SITES_DIR=C:\Repos\rover-sites
   ```

   Create `rover-sites` if you set a custom path. Default without `ASSEMBLED_SITES_DIR` is `../rover-sites` next to Rover.
6. Restart Rover → **GitHub owner** green.

**Pitfall from first launch:** `gh` logged in as account A while `GITHUB_OWNER` is account B → `cannot create a repository for …`. Fix login or owner so they match.

---

## 7. Assemble & launch — Cloudflare (once)

Rover ships Workers and (on Launch) Email Routing / custom domain into **one** Cloudflare account.

### 7a. Pick the account

Use the account where you will host **all** lead-gen domains. Every site zone must live here.  
Account ID appears in the dashboard URL:

`https://dash.cloudflare.com/<ACCOUNT_ID>/…`

Also: Workers & Pages → right sidebar **Account ID**.

### 7b. Register a workers.dev subdomain (once per account)

1. Cloudflare → that account → **Workers & Pages**.
2. If prompted, set up / register a **workers.dev** subdomain (e.g. `long-unit-82eb.workers.dev`).
3. Confirm **Account details → Subdomain** shows a value. First Wrangler deploy fails until this exists.

### 7c. API token

1. [API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → **Create Custom Token**.
2. Name e.g. `Rover Launch`.
3. Permissions (minimum for Launch + forms inbox):

   | Scope | Permission | Level |
   | --- | --- | --- |
   | Account | Workers Scripts | Edit |
   | Account | Account Settings | Read |
   | Account | Email Routing Addresses | Edit |
   | Account | D1 | Edit *(forms inbox — required)* |
   | Zone | Zone | Read |
   | Zone | DNS | Edit |
   | Zone | Email Routing Rules | Edit |
   | Zone | Zone Settings | Edit *(optional HTTPS/HSTS)* |
   | Account | Workers Builds Configuration | Edit *(optional push-to-deploy)* |
   | Account | Turnstile | Edit *(optional — Launch does not create widgets)* |

4. Create a **user** API token (account-owned tokens fail Workers Builds). Prefer your Cloudflare user profile → API Tokens.
5. **Account Resources** → Include → **this** account only (the one with your site domains).
6. **Zone Resources** → Include → All zones (or specific zones later).
7. Continue → **Create Token** → copy once. Paste carefully (do not double-paste).
8. In `.env`:

   ```env
   CLOUDFLARE_ACCOUNT_ID=paste-account-id-here
   CLOUDFLARE_API_TOKEN=…
   ```

9. Restart Rover → **Cloudflare** green.

### 7d. Optional: Workers Builds ↔ GitHub (once)

For auto rebuild on `git push`:

1. Cloudflare → any Worker → **Settings → Builds → Connect** → authorize GitHub for your org/user.
2. Keep **Workers Builds Configuration → Edit** on the API token.
3. Soft-fail on Launch (“Builds skipped”) is OK if Wrangler deploy succeeded.

### 7e. Lead notify inbox (required)

This is the mailbox that receives every form lead. The forms Worker emails **from** `leads@{domain}` **to** this address. Launch also uses it as the Cloudflare **Email Routing destination** (so `leads@` forwards there).

```text
Contact form → Rover forms Worker → email + Cloudflare Email Routing → LEAD_NOTIFY_EMAIL
```

1. Confirm you can open the mailbox (Gmail is common; **Zoho or another inbox is fine** if Cloudflare can verify it as an Email Routing destination).
2. Gear → **Account setup** → **Lead notify email** → paste the address → **Save**. That applies with no restart. Or put it in `.env` as `LEAD_NOTIFY_EMAIL=` and restart. The old name `WEB3FORMS_DEFAULT_NOTIFY_EMAIL` is still read only if `LEAD_NOTIFY_EMAIL` is empty (legacy fallback — not Web3Forms itself).
3. Settings → **Lead notify email** green.
4. Do not restart while a Launch is running.

Per-site domain cutover and smoke-test: [OPERATOR-SITE-RUNBOOK.md](OPERATOR-SITE-RUNBOOK.md) **A6–A7**.

### 7f. Forms inbox (required)

**Required for go-live.** Replaces Web3Forms. The live contact form posts only to this shared Worker (`formsIngestUrl`). Launch treats forms as done when the inbox is ready **and** the Email Routing destination is set.

1. Confirm the Cloudflare token includes **Account → D1 → Edit** and **Workers Scripts → Edit** (section 7c). Prefer `LEAD_NOTIFY_EMAIL` already set so the Worker gets `NOTIFY_EMAIL` at deploy.
2. Restart Rover after any token change.
3. Open **Phone/Form** → **Set up inbox**. Rover creates the D1 database, deploys the worker, and saves `research/forms-inbox.json`.
4. Settings → **Forms inbox** green when a database id and ingest URL are saved (restart if the row was open before setup).
5. Already-live sites that still used Web3Forms (or had no ingest URL) pick up the inbox on the **next ship** (Prepare preview → Push updates, or Launch). Form totals stay 0 until that ship.

Optional override (leave unset to use the saved URL):

```env
ROVER_FORMS_INGEST_URL=https://rover-forms.your-subdomain.workers.dev
```

**Import past leads** (optional, Gmail only): Phone/Form → **Import past leads** can copy older lead emails from a **Gmail** inbox that used to receive Web3Forms mail. It uses the Gmail API — **not Zoho, Outlook, or other hosts**. If `LEAD_NOTIFY_EMAIL` is Zoho (or anything except `@gmail.com` / `@googlemail.com`), skip Import; keep old mail in that inbox and rely on the forms Worker for new leads. Setup: [ENV-SETUP.md](ENV-SETUP.md) §5f.

Full notes: [ENV-SETUP.md](ENV-SETUP.md) §5f · [LAUNCH.md](LAUNCH.md) · [ASSEMBLE-AND-LAUNCH.md](ASSEMBLE-AND-LAUNCH.md) §6.

---

## 8. Phone — Twilio Functions (required, once per Twilio account)

**Required** before you **Provision ranking number** on any site. Settings **Phone → Twilio** turns green from the Account SID, auth token, forward-to number, and voice webhook — it does **not** prove Functions are deployed. You still need a Functions service named exactly `rover-voice`. Do these clicks in order. Do not skip **Deploy All**.

**Provision** buys one of that city’s area codes, including an overlay. If those codes are out of stock, it buys the closest number in the same state. Type an area code on the provision step to keep that code only.

Function source lives in the Rover folder at `ops/twilio-functions/` (same text as [USER-GUIDE.md](USER-GUIDE.md#phone-twilio-code)). Paste from either place.

### 8a. Twilio account + credentials

1. Open [Twilio Console](https://console.twilio.com/) — sign up or log in.
2. Add money to the account (a trial can test webhooks; buying local ranking numbers needs funds).
3. On the Console home, copy **Account SID** (starts with `AC`).
4. Click the eye next to **Auth Token** and copy it. Keep both ready for Account setup.

### 8b. Create the `rover-voice` Functions service

1. Left menu → **Functions and Assets** (sometimes under Develop) → **Services**.
2. **Create Service**. Unique name must be exactly **`rover-voice`**. Create it.
3. Add these Functions (paste all five on first setup — Rover also republishes them from `ops/twilio-functions/` later). For each: **Add Function** → set **Path** exactly → set **Access** to **Public** → delete default editor text → paste the matching file → **Save**.

   | Path | File in Rover | Needed for |
   | --- | --- | --- |
   | `/inbound` | `ops/twilio-functions/inbound.js` | Ranking voice URL (required) |
   | `/whisper` | `ops/twilio-functions/whisper.js` | Rented Dial whisper (required when rented) |
   | `/voicemail-done` | `ops/twilio-functions/voicemail-done.js` | Ranking voicemail end (required) |
   | `/recording` | `ops/twilio-functions/recording.js` | SMS notify when a message is left (required for texts) |
   | `/status` | `ops/twilio-functions/status.js` | Optional live relay; Phone history still syncs via Twilio REST without it |

4. On that same service, open **Environment Variables** (or Variables). Add one variable only for now:
   - Key: `TWILIO_FORWARD_TO`
   - Value: your cell in E.164 (US example `+18015551234` — plus sign, country code, no spaces or dashes)
5. Click **Deploy All**. Wait until Twilio says it succeeded. If it fails, fix the on-screen error, then **Deploy All** again.
6. On the service page, copy the domain (looks like `rover-voice-1234.twil.io`). Your webhook is that domain with `/inbound` on the end:

   `https://rover-voice-1234.twil.io/inbound`

### 8c. Save the phone keys and verify in Rover

1. Gear → **Account setup**. Paste **Twilio Account SID**, **Twilio auth token**, and **Forward calls to** (E.164, example `+18015551234`). **Save**. That applies with no restart.
2. The voice webhook is not on Account setup. In `.env` set:

   ```env
   TWILIO_VOICE_WEBHOOK_URL=https://rover-voice-xxxx.twil.io/inbound
   ```

   It must be `https://` and must end with `/inbound`. Do **not** use Rover’s `http://127.0.0.1:8787` address.
3. Save `.env`. In the Rover terminal: `Ctrl+C`, then `npm run rover` again. That restart is only for the webhook line.
4. Gear → **API/Other** → **Phone → Twilio** must be green (keys only — still Deploy All the Functions above).
5. Top bar → **Phone** → expand **Ranking greeting** → **Save spoken fallback** once (even if you did not change the words). That writes a public Asset (`/voicemail-fallback.txt`); it is not a Function env value. Upload a greeting MP3 when ready.

After this, Phone Refresh can update Function code from `ops/twilio-functions/` — you do not re-paste unless you create a **new** Twilio account.

Trust Hub / A2P registration is optional later for SMS deliverability; voicemail still works without it.  
**Per site later:** Site-Config → **Provision ranking number** (site runbook). Rover stays on that city’s area codes, then the closest in-state number. Smoke-test: call the DID from another phone — your cell must **not** ring; you hear the greeting/voicemail.

If Twilio stays red: [USER-GUIDE.md](USER-GUIDE.md#phone-twilio-setup) → **If something goes wrong**.

---

## 9. Google Search Console OAuth (optional, once)

Needed for **Launched → Sync GSC / Check index** and for Website → Indexing → **Submit to Search Console**.

1. Follow [ENV-SETUP.md](ENV-SETUP.md) §7 — Desktop OAuth client, Search Console API enabled.
2. Redirect URI: `http://127.0.0.1:8787/api/gsc/oauth/callback`.
3. Gear → **Account setup** → paste **Search Console client ID** and **client secret** → **Save** (no restart). Or set `GOOGLE_GSC_CLIENT_ID` and `GOOGLE_GSC_CLIENT_SECRET` in `.env` and restart.
4. **Launched → Connect GSC** once in the browser. Finish login with the Gmail you added as a test user. Rover does not open Google’s account chooser on its own.

Same OAuth client is reused later only if you **Import past leads** from a **Gmail** inbox (enable Gmail API + redirect `http://127.0.0.1:8787/api/forms/gmail/callback` — see [ENV-SETUP.md](ENV-SETUP.md) §5f). Skip that if notify mail is Zoho or another non-Gmail host.

Per-site Domain property + sitemap submit stays in the [site runbook](OPERATOR-SITE-RUNBOOK.md) / [SITE-INDEXING.md](SITE-INDEXING.md).

---

## 10. Final checklist

| Done? | Item |
| --- | --- |
| ☐ | GitHub account invited to `7D7D/Rover` |
| ☐ | Git installed; Cursor installed; Rover folder open in Cursor |
| ☐ | `npm install` + `.env` from `.env.example` |
| ☐ | DataForSEO login/password + funded products |
| ☐ | Anthropic API key (+ workspace id if needed) |
| ☐ | OpenAI API key (GPT Image + Phone rows) |
| ☐ | Google Maps: billing + Places (New) + Geocoding + `GOOGLE_MAPS_API_KEY` |
| ☐ | Apify token + at least one of LoopNet / Crexi actor ids |
| ☐ | Optional: Unsplash / Pexels / Pixabay (at least one recommended) |
| ☐ | `gh auth login` + `GITHUB_OWNER` match (**GitHub owner** green ≠ `gh` logged in by itself) |
| ☐ | Cloudflare account id + **user** API token (incl. **D1 Edit**) |
| ☐ | workers.dev subdomain registered |
| ☐ | `LEAD_NOTIFY_EMAIL` set (**Lead notify email** green) |
| ☐ | Phone/Form → **Set up inbox** (**Forms inbox** green) |
| ☐ | Twilio: `rover-voice` Public Functions + **Deploy All** |
| ☐ | Twilio: SID, token, and forward-to in Account setup; webhook in `.env`; **Phone → Twilio** green |
| ☐ | Phone → Save spoken fallback |
| ☐ | Optional: GSC OAuth env + **Connect GSC** (env alone stays red) |
| ☐ | Required Settings greens done (Template repo / Assembled sites dir / Anthropic Admin may stay red) |

Then open [OPERATOR-SITE-RUNBOOK.md](OPERATOR-SITE-RUNBOOK.md) and build your first site. For the **second city in the same niche/metro**, follow that runbook **Part B** (start at **B0** to find hold/cluster-batch siblings in Research).

---

## Pitfalls learned on the first live site

| Symptom | Fix |
| --- | --- |
| Private clone 404 | Wrong GitHub account, or invite not accepted — [GITHUB-ACCESS-GATEWAY.md](GITHUB-ACCESS-GATEWAY.md) |
| `cannot create a repository for …` | `gh api user --jq .login` must match `GITHUB_OWNER` |
| Cloudflare `Invalid access token` | Token typo / double-paste; recreate a **user** token; restart Rover |
| Cloudflare Unauthorized on wrong account | `CLOUDFLARE_ACCOUNT_ID` must be the account that owns the domain zone |
| Wrangler: register workers.dev subdomain | Workers & Pages → set subdomain once |
| Forms inbox setup fails | Add **Account → D1 → Edit** (+ Workers Scripts Edit); set `LEAD_NOTIFY_EMAIL`; restart Rover; **Set up inbox** again |
| Launch: Forms inbox is not set up | Finish §7f before Run launch — do **not** create a Web3Forms form |
| Form totals stay 0 on live sites | Inbox set up, but site not shipped again after `forms-inbox.json` existed |
| Still seeing Web3Forms on a live contact form | Prepare preview → Push updates (or Launch) so Assemble writes `formsIngestUrl` |
| Import past leads asks for Gmail / fails on Zoho | Expected — Import is Gmail-only; Zoho keep old mail there; new leads use the forms Worker |
| Lead mail never arrives | Destination not Verified in Cloudflare Email Routing, or smoke-test before the site shipped with `formsIngestUrl` |
| Google Maps red / Find fails billing | Project billing not linked, or key missing Places API **(New)** / Geocoding |
| Find returns 0 / Apify errors | Missing `APIFY_TOKEN` or actor id uses `/` instead of `~` |
| Phone → Twilio red | Wrong webhook (must end `/inbound`) or Auth Token typo — green still does not prove Deploy All |
| Ranking call rings your cell | Functions still on old Dial build, or Access not **Public** — Deploy All again; open Phone once so Rover can refresh Function source |
| GSC stays red after env only | Click **Connect GSC** in the browser; needs configured **and** connected |
| GSC “Invalid sitemap address” | Domain property needs **full** URL `https://domain/sitemap.xml` |
| GSC “Page with redirect” on www | Expected — Worker 301s `www` → HTTPS apex. Do not Validate fix; use the apex URL |

---

## Related

| Doc | When |
| --- | --- |
| [OPERATOR-FLOWS.md](OPERATOR-FLOWS.md) | Visual flowchart + **maintenance checklist** (update flows when this manual changes) |
| [flows/operator-flows.html](flows/operator-flows.html) | Printable / PDF flowcharts |
| [GITHUB-ACCESS-GATEWAY.md](GITHUB-ACCESS-GATEWAY.md) | GitHub signup + invite (browser) |
| [ROVER-UPDATE-COPY.md](ROVER-UPDATE-COPY.md) | Bring `.env` / `research/` into a new Rover folder |
| [ENV-SETUP.md](ENV-SETUP.md) | Every Settings key, screenshots |
| [GOOGLE-MAPS-API.md](GOOGLE-MAPS-API.md) | Maps project / Places (New) / key restrict |
| [OPERATOR-SITE-RUNBOOK.md](OPERATOR-SITE-RUNBOOK.md) | Per-site niche → live |
| [USER-GUIDE.md](USER-GUIDE.md#phone-twilio-setup) | Twilio Function code blocks |
| [PHONE-TRACKING.md](PHONE-TRACKING.md) | Phone ops after setup |
| [LAUNCH.md](LAUNCH.md) | Run launch / token permissions |
| [ASSEMBLE-AND-LAUNCH.md](ASSEMBLE-AND-LAUNCH.md) | Assemble / ship deep dive |
