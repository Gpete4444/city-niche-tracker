# Phone tracking (Twilio intelligence)

Rank-and-rent call tracking is **Twilio-only**: one static local DID per site while ranking and after rent. Same number; ranking takes a **voicemail**, rent cutover Dials the renter. CallRail cutover is **cancelled**.

**Audience:** you in Rover only (Phone tab). No renter portal.

**Pipeline:** provision in **Website Builder** (after Site-Config Accept) or **Launched Sites**. Call review is the top-nav **Phone** tab. See [PIPELINE-STAGES.md](PIPELINE-STAGES.md).

**Not in Launch.** Prefer **Site-Config → Provision ranking number** after Accept. That buys the DID and stores it on the portfolio row so **Phone** can show calls — it does **not** add the site to the **Launched** table. Only **Run launch** (which sets `lastLaunchAt`) lists the site under Launched. **Launched** has Provision, **Update site phone number**, **Set forward to renter**, and **View calls →**.

Canonical Function source: [`ops/twilio-functions/`](../ops/twilio-functions/).

## What you get

| Need | How |
|------|-----|
| Ranking inbound | Voicemail (Play uploaded greeting or spoken fallback). Does **not** ring your cell |
| SMS when a message is left | Ranking DID texts `TWILIO_FORWARD_TO` (skip empty hangups) |
| Greeting file + spoken fallback | Phone tab — one greeting for all ranking sites |
| Forward to renter (rented) | Same DID; `forwardTo` = `renter.phone`; phase `rented` |
| Answered / missed / voicemail + duration | **Twilio REST backfill** on Phone load/refresh (durable); optional webhook relay for live updates |
| Recordings | `<Record>` (ranking) or `record-from-answer` (rented); Phone tab audio proxy |
| AI summary | After recording known: OpenAI Whisper (STT) → gpt-4o-mini summary (queued from sync or webhook) |

## Durable call history (no laptop tunnel required)

**Source of truth:** Twilio Call + Recording history for each portfolio DID.

When you open the **Phone** tab (or click Refresh), Rover runs `POST /api/phone/sync`:

1. Publishes [`ops/twilio-functions/`](../ops/twilio-functions/) into the live Twilio build when those files changed (so ranking `/inbound` cannot stay on an old Dial-your-cell version)
2. Fetches each ranking DID’s live Voice URL from Twilio and rewrites it to `mode=voicemail` if it still Dials your cell
3. Lists recent inbound calls to each site DID (default last 30 days)
4. Upserts into `research/phone-calls.jsonl`
5. Attaches recordings when present
6. Queues AI summaries for voicemail/answered calls that have audio but no summary yet

If Rover was off when a call happened, the next Phone open still picks it up from Twilio. **Nothing is lost** in Twilio’s account history. Ranking voicemail SMS is sent by the Twilio Function (does not need Rover online).

Optional Function relay (`ROVER_WEBHOOK_URL` + tunnel) can push events while Rover is reachable for near-real-time rows without waiting for Refresh — **not required** for correctness.

## Setup (once)

Non-technical Twilio / OpenAI env walkthrough: [ENV-SETUP.md](ENV-SETUP.md) §6. First-time Console clicks and Function paste: [USER-GUIDE.md](USER-GUIDE.md) **Phone → First-time Twilio setup**.

1. Twilio account funded; Rover `.env` (see `.env.example`):
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FORWARD_TO`, `TWILIO_VOICE_WEBHOOK_URL`
   - `OPENAI_API_KEY` (Phone STT via Whisper + summaries via gpt-4o-mini)
   - Optional: `OPENAI_PHONE_TRANSCRIBE_MODEL` (default `whisper-1`), `OPENAI_PHONE_MODEL` (default `gpt-4o-mini`)
   - Optional: `TWILIO_SERVERLESS_SERVICE_SID` if greeting upload cannot match the Functions service from the webhook URL
   - Optional live relay: `ROVER_PHONE_WEBHOOK_SECRET` + Function `ROVER_WEBHOOK_URL` (tunnel)
2. Deploy Functions: [`ops/twilio-functions/README.md`](../ops/twilio-functions/README.md) — `/inbound`, `/whisper`, `/voicemail-done`, `/recording` (status relay optional)
3. Restart Rover (`npm run rover`)
4. Open **Phone** — sync migrates existing ranking numbers to voicemail; upload a greeting or edit the spoken fallback

US carriers may filter SMS from local DIDs (A2P/10DLC). Voicemail still records if a text is dropped. Trial accounts may only SMS verified numbers.

## Operator flow

1. Accept site-config → **Provision ranking number** (Website Builder or Launched Sites). Rover buys one of that city’s area codes, including an overlay. If those codes have no inventory, it buys the closest available number in the same state. Type an area code to keep that code only. Twilio Account SID, auth token, and forward-to are saved in gear → **Account setup**. The voice webhook stays in `.env`.
2. **Update site phone number** so live CTAs show the DID
3. On **Phone**: upload a greeting, or **Save spoken fallback** (after redeploying `/inbound`). Test: call the DID from another phone — hear greeting/spoken line, leave a message; you should get an SMS, not a ring
4. When rented: save **renter phone** → **Set forward to renter** (same DID, phase `rented`)
5. Review calls on **Phone** tab (sync on load) or Sites → **View calls →**

## APIs

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/candidates/:id/phone/provision-twilio` | Buy DID + patch site-config |
| POST | `/api/sites/:id/phone/provision-twilio` | Same from portfolio row |
| POST | `/api/sites/:id/phone/forward-renter` | `{ confirm: true }` → dial renter |
| POST | `/api/sites/:id/phone/forward` | `{ confirm, forwardTo, phase? }` |
| POST | `/api/phone/sync` | `{ siteId?, sinceDays? }` — Twilio REST backfill + ranking voicemail migrate |
| POST | `/api/phone/webhooks/status` | Optional live dial status (secret header) |
| POST | `/api/phone/webhooks/recording` | Optional live recording → enqueue summary |
| GET | `/api/phone/greeting` | Global ranking greeting + fallback text |
| POST | `/api/phone/greeting/audio` | Upload MP3/WAV (raw body) → Twilio Asset |
| DELETE | `/api/phone/greeting/audio` | Remove greeting; callers hear spoken fallback |
| PUT | `/api/phone/greeting/fallback` | `{ fallbackSay }` — public Asset `/voicemail-fallback.txt` (not Function env; env values max 100 chars) |
| GET | `/api/phone/sites` | Sidebar sites + badges |
| GET | `/api/phone/calls?siteId=` | Call table + stats (no auto-sync) |
| GET | `/api/phone/calls/:id/recording` | Authenticated Twilio audio proxy |
| POST | `/api/phone/calls/:id/summarize` | Manual re-run STT + OpenAI summary |

## Data

- Portfolio `phoneTracking`: `phase` (`none` \| `ranking` \| `rented`), `provider`, `e164`, `twilioSid`, `voiceWebhookUrl`, `forwardTo`, timestamps
- Call log: `research/phone-calls.jsonl` (append/upsert by `callSid`)
- Greeting: `research/voicemail-greeting/` (local audio + `voicemail-fallback.txt` + meta; live Play/Say URLs are Twilio Assets)

## Locked defaults

| Decision | Choice |
|----------|--------|
| Vendor | Twilio only (no CallRail) |
| Ranking inbound | Voicemail (`mode=voicemail`); SMS `TWILIO_FORWARD_TO` |
| Greeting | One file + spoken fallback for all ranking sites (Phone tab) |
| Rented forward | Portfolio `renter.phone` (same DID) |
| Missed-call recovery | Twilio REST sync on Phone load (not laptop-dependent) |
| Number type | Static local DID (not session DNI) |
| Whisper | “Call from {site}” to the **renter** on Dial |
| Summaries | Async in Rover: download Twilio MP3 → OpenAI Whisper transcript → gpt-4o-mini summary (`OPENAI_API_KEY`) |
| Launch | Unchanged — domain / email / Rover form delivery |

## Stays human

Twilio signup/billing; setting `TWILIO_FORWARD_TO` (SMS notify); first **Deploy All** of Twilio Functions; optional tunnel only if you want live webhook push; TCPA/recording notice if required; first **Run launch** on Website.
