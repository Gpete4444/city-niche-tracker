# Twilio Functions (Rover voice + phone intelligence)

Rover binds `127.0.0.1` only. Voice answering still runs on Twilio Functions. **Call history in the Phone tab does not depend on a laptop tunnel** — Rover pulls Calls + Recordings from the Twilio REST API on Phone load/refresh (`POST /api/phone/sync`). See [`docs/PHONE-TRACKING.md`](../../docs/PHONE-TRACKING.md).

Optional: `/status` and `/recording` can relay into Rover while a public URL is up (near-real-time). Skip that if you only care about durable backfill.

## Deploy once (required for dialing)

1. Twilio Console → Functions → Create Service (e.g. `rover-voice`)
2. Add Functions from this folder:
   - `/inbound` → `inbound.js` (**required**)
   - `/whisper` → `whisper.js` (**required**)
   - `/status` → `status.js` (optional live relay)
   - `/recording` → `recording.js` (optional live relay)
3. **Environment Variables** on the service:
   - `TWILIO_FORWARD_TO` = your ranking E.164 cell (e.g. `+18015551234`)
   - Optional live relay: `ROVER_WEBHOOK_URL` = public base that reaches Rover — **no trailing slash**
   - Optional live relay: `ROVER_PHONE_WEBHOOK_SECRET` = same as Rover `.env`
4. **Deploy All**
5. In Rover `.env`:

```
TWILIO_VOICE_WEBHOOK_URL=https://rover-voice-xxxx.twil.io/inbound
# Optional — only for live webhook relay:
# ROVER_PHONE_WEBHOOK_SECRET=<same as Function env>
# ROVER_PUBLIC_WEBHOOK_BASE=https://your-tunnel.example
```

Without `ROVER_WEBHOOK_URL`, calls still forward and Twilio still records. Open **Phone** in Rover to sync history from Twilio.

## Call flow

```
Inbound → /inbound (?site=&siteId=&forward=)
       → dials forward (whisper to callee)
       → Twilio stores Call + Recording
       → Rover Phone tab: POST /api/phone/sync (REST backfill) → local log → optional Claude summary

Optional while Rover reachable via tunnel:
       → Dial action / statusCallback → /status → Rover POST /api/phone/webhooks/status
       → recordingStatusCallback → /recording → Rover POST /api/phone/webhooks/recording
```

## Query params on voiceUrl

Rover provision / forward cutover sets:

| Param | Purpose |
|-------|---------|
| `site` | Whisper business name |
| `siteId` | Portfolio id for call log |
| `forward` | E.164 dial target (renter or ranking default) |

If `forward` is omitted, `/inbound` uses Function env `TWILIO_FORWARD_TO`.
