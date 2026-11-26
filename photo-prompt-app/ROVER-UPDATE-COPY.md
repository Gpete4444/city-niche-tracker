# Rover version upgrade — master copy list

**This is the single source of truth** for moving local operator data into a new Rover folder (for example Rover 2.7 → 2.8). Agents and operators should follow **this file** on every upgrade — do not invent a shorter list.

Program updates replace **code**. They do **not** bring the local files below. Niche **master images** and named photo groups live under `research/_photo-groups/` (for example `master-smart-home-automation-installation`). Copying all of `research/` brings **every** niche master and every saved city group.

**Forms note (2.5 onward, including 2.8):** go-live uses the **Rover forms Worker**, not Web3Forms. Copying `research/` includes `forms-inbox.json` when present, and any keys already saved under `research/_rover/` (Account setup). After upgrade, confirm **Lead notify email** + **Forms inbox** are green, then **Prepare preview → Push updates** on any live site that still posts to Web3Forms so Assemble writes `formsIngestUrl`.

**2.8 keys:** gear → **Account setup** is the place to enter or confirm keys. **Save** applies them with no restart. `.env` is still copied and still works. This development checkout does not ask for a weekly login.

**Automated copy (preferred):**

```powershell
# From the NEW Rover folder (or any folder that has the script after you pull code):
.\scripts\rover-upgrade-copy.ps1 -OldRoot "C:\RanknRent\Rover-2.7-upstream" -NewRoot "C:\RanknRent\Rover-2.8-upstream"
```

Then run the **After copy** steps at the bottom. The script mirrors this checklist.

**Also mirrored for convenience:** `photo-prompt-app/ROVER-UPDATE-COPY.md` (keep in sync with this file when the list changes).

---

## Copy every time (required)

| From the old Rover folder | Why |
| --- | --- |
| **`research/`** (entire folder) | All candidates; **all niche masters and photo groups** (`research/_photo-groups/`, e.g. Smart Home Automation master + Gilbert group); site images; prompt sidecars; GSC tokens; phone call log; voicemail greeting; **forms inbox** (`research/forms-inbox.json` when present). Do **not** cherry-pick files unless you know you only need one candidate. |
| **`.env`** | API keys and local settings. Also `.env.production` if you use one. Prefer `LEAD_NOTIFY_EMAIL=` (forms Worker notify inbox). Legacy `WEB3FORMS_DEFAULT_NOTIFY_EMAIL` is a fallback name only — Web3Forms itself is not used for go-live. |
| **`data/census/boundaries/`** | Census geo shapefiles (the geo database). A fresh clone does **not** include them. |
| **`data/census/map/`** | Built place/county map layers. Copying avoids a long rebuild. |
| **`photo-prompt-app/`** | Prompt writer, object-list examples, and the mirrored copy of this checklist. |
| **`public/images/`** | Photos synced for the template preview. Candidate originals also live under `research/<id>/site-images/`. |

If `.env` sets `ASSEMBLED_SITES_DIR` to a folder **outside** Rover (often `C:\Repos\rover-sites`), leave that folder where it is and keep the same path in the new `.env`. If assembled sites lived **inside** the old Rover folder, copy that directory too.

---

## Copy when present (strongly recommended)

| From the old Rover folder | Why |
| --- | --- |
| **`.cache/`** | Cached API lookups. Skipping it can repeat paid calls. |
| **`ops/sounds/`** | Local launch celebration audio, if you added any. |
| **`src/config/site-config.backup-*.json`** | Site-config Accept backups, if those files exist. |

---

## Do not copy

| Leave behind | Why |
| --- | --- |
| `node_modules/` | Reinstall with `npm install` in the new folder. |
| `dist/` | Build output. Assemble and preview create it again. |
| `.astro/` | Generated types. |
| Old `docs/` / `ops/` / `src/` **code** | The new version’s code is authoritative. Only copy the local data rows above. |

---

## Niche structure + master images (explicit)

These are **not** separate from `research/` — they are why the whole `research/` tree must move. Together they make same-niche sites share service names, process/materials titles, and correctly placed photos:

| Location | What |
| --- | --- |
| `research/_photo-groups/index.json` | Library index of all groups |
| `research/_photo-groups/master-{niche-slug}/` | Niche **master** (e.g. `master-smart-home-automation-installation`) — slots keyed by `matchKey` / titles; Accept places them on the next city |
| `research/_photo-groups/{named-group}/` | Named city/niche saves (e.g. Gilbert) |
| `research/_niche-service-lists.json` | Saved **niche service defaults** (Build / Save / Load niche default) |
| `research/_niche-photo-blocks.json` | Shared process/materials **title** catalogs per niche (Write site) |

After upgrade, open Website → Content → **Load photo group** on a Smart Home candidate and confirm the **master** and named groups still appear. Also confirm **Load niche default** still has that niche’s services. If either is missing, you only copied part of `research/` — re-run the full folder copy.

---

## After copy (every upgrade)

From the **new** Rover folder:

```powershell
npm install
npm run build-research-map
```

Run `build-research-map` if you skipped `data/census/map/` but did copy `data/census/boundaries/`. If both census folders were copied, you can still run it to refresh; it is safe.

```powershell
npm run rover
```

Then verify:

1. Gear → **Account setup** — required keys saved (Maps, Apify, Twilio, Cloudflare, GitHub owner, notify email). Gear → **API/Other** should show those rows green. Saving in Account setup does not need a restart.
2. **Lead notify email** — `LEAD_NOTIFY_EMAIL` in `.env` (legacy `WEB3FORMS_DEFAULT_NOTIFY_EMAIL` still works as a fallback name only).
3. **Forms inbox** — if `research/forms-inbox.json` was missing, open **Phone/Form → Set up inbox** once (Cloudflare token needs **D1 Edit**). This replaces Web3Forms. Already-live sites pick up `formsIngestUrl` on the next ship.
4. **Photo groups** — Load photo group still lists every niche **master** and named groups (including Smart Home Automation).
5. **Geo** — Map / Service area cities paint (census map loaded).

Operator manuals after a major version bump: [OPERATOR-ONE-TIME-SETUP.md](OPERATOR-ONE-TIME-SETUP.md) · [OPERATOR-SITE-RUNBOOK.md](OPERATOR-SITE-RUNBOOK.md) · flowcharts [OPERATOR-FLOWS.md](OPERATOR-FLOWS.md).

If you change those manuals after upgrade, update the flowcharts too — checklist in [OPERATOR-FLOWS.md](OPERATOR-FLOWS.md).

---

## Agent / Cursor rule

When the user asks to start a new Rover version, upgrade, or “copy everything to the new folder,” follow this document and prefer `scripts/rover-upgrade-copy.ps1`. Do not skip `research/` (niche masters), census geo folders, or `.env`.

When operator setup/runbook instructions change, keep [OPERATOR-FLOWS.md](OPERATOR-FLOWS.md) and `docs/flows/` in sync (see that file’s maintenance checklist).
