# Phone tracking (Twilio intelligence)

Rank-and-rent call tracking is **Twilio-only**: one static local DID per site while ranking and after rent. Same number; change who it dials. CallRail cutover is **cancelled**.

**Audience:** you in Rover only (Phone tab). No renter portal.

**Pipeline:** provision in **Website Builder** (after Site-Config Accept) or **Launched Sites**. Call review is the top-nav **Phone** tab. See [PIPELINE-STAGES.md](PIPELINE-STAGES.md).

**Not in Launch.** Prefer **Site-Config → Provision ranking number** after Accept; **Launched Sites** has Provision, **Update site phone number**, **Set forward to renter**, and **View calls →**.

Canonical Function source: [`ops/twilio-functions/`](../ops/twilio-functions/).

## What you get

| Need | How |
|------|-----|
| Forward to you (ranking) | `TWILIO_FORWARD_TO` + whisper |
| Forward to renter (rented) | Same DID; `forwardTo` = `renter.phone`; phase `rented` |
| Answered / missed + duration | **Twilio REST backfill** on Phone load/refresh (durable); optional webhook relay for live updates |
| Recordings | `record-from-answer`; backfill attaches recording SIDs; Phone tab audio proxy |
| AI summary | After recording known: Twilio transcription → OpenAI gpt-4o-mini (queued from sync or webhook) |

## Durable call history (no laptop tunnel required)

**Source of truth:** Twilio Call + Recording history for each portfolio DID.

When you open the **Phone** tab (or click Refresh), Rover runs `POST /api/phone/sync`:

1. Lists recent inbound calls to each site DID (default last 30 days)
2. Upserts into `research/phone-calls.jsonl`
3. Attaches recordings when present
4. Queues AI summaries for answered calls that have audio but no summary yet

If Rover was off when a call happened, the next Phone open still picks it up from Twilio. **Nothing is lost** in Twilio’s account history.

Optional Function relay (`ROVER_WEBHOOK_URL` + tunnel) can push events while Rover is reachable for near-real-time rows without waiting for Refresh — **not required** for correctness.

## Setup (once)

1. Twilio account funded; Rover `.env` (see `.env.example`):
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FORWARD_TO`, `TWILIO_VOICE_WEBHOOK_URL`
   - `OPENAI_API_KEY` (Phone summaries via gpt-4o-mini)
   - Optional live relay: `ROVER_PHONE_WEBHOOK_SECRET` + Function `ROVER_WEBHOOK_URL` (tunnel)
2. Deploy Functions: [`ops/twilio-functions/README.md`](../ops/twilio-functions/README.md) — at least `/inbound` + `/whisper` (status/recording relays optional)
3. Restart Rover (`npm run rover`)
4. Open **Phone** — sync runs automatically if Twilio creds are set

## Operator flow

1. Accept site-config → **Provision ranking number** (Website Builder or Launched Sites)
2. **Update site phone number** so live CTAs show the DID
3. Test: call the DID from another phone; whisper on your `TWILIO_FORWARD_TO`
4. When rented: save **renter phone** → **Set forward to renter** (same DID, phase `rented`)
5. Review calls on **Phone** tab (sync on load) or Sites → **View calls →**

## APIs

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/candidates/:id/phone/provision-twilio` | Buy DID + patch site-config |
| POST | `/api/sites/:id/phone/provision-twilio` | Same from portfolio row |
| POST | `/api/sites/:id/phone/forward-renter` | `{ confirm: true }` → dial renter |
| POST | `/api/sites/:id/phone/forward` | `{ confirm, forwardTo, phase? }` |
| POST | `/api/phone/sync` | `{ siteId?, sinceDays? }` — Twilio REST backfill |
| POST | `/api/phone/webhooks/status` | Optional live dial status (secret header) |
| POST | `/api/phone/webhooks/recording` | Optional live recording → enqueue summary |
| GET | `/api/phone/sites` | Sidebar sites + badges |
| GET | `/api/phone/calls?siteId=` | Call table + stats (no auto-sync) |
| GET | `/api/phone/calls/:id/recording` | Authenticated Twilio audio proxy |
| POST | `/api/phone/calls/:id/summarize` | Manual re-run STT + OpenAI summary |

## Data

- Portfolio `phoneTracking`: `phase` (`none` \| `ranking` \| `rented`), `provider`, `e164`, `twilioSid`, `voiceWebhookUrl`, `forwardTo`, timestamps
- Call log: `research/phone-calls.jsonl` (append/upsert by `callSid`)

## Locked defaults

| Decision | Choice |
|----------|--------|
| Vendor | Twilio only (no CallRail) |
| Ranking forward | Env `TWILIO_FORWARD_TO` |
| Rented forward | Portfolio `renter.phone` (same DID) |
| Missed-call recovery | Twilio REST sync on Phone load (not laptop-dependent) |
| Number type | Static local DID (not session DNI) |
| Whisper | “Call from {site}” to the callee |
| Summaries | Async in Rover via OpenAI (`OPENAI_API_KEY`, gpt-4o-mini) when recording is known |
| Launch | Unchanged — domain / email / Web3Forms |

## Stays human

Twilio signup/billing; setting `TWILIO_FORWARD_TO`; optional tunnel only if you want live webhook push; TCPA/recording notice if required; first **Run launch** on Website.
