# Twilio Functions (Rover voice + phone intelligence)

Rover binds `127.0.0.1` only. Voice answering still runs on Twilio Functions. **Call history in the Phone tab does not depend on a laptop tunnel** — Rover pulls Calls + Recordings from the Twilio REST API on Phone load/refresh (`POST /api/phone/sync`). See [`docs/PHONE-TRACKING.md`](../../docs/PHONE-TRACKING.md).

Optional: `/status` and `/recording` can relay into Rover while a public URL is up (near-real-time). Skip that if you only care about durable backfill.

## Deploy once (required for voicemail / dialing)

1. Twilio Console → Functions → Create Service (e.g. `rover-voice`)
2. Add Functions from this folder:
   - `/inbound` → `inbound.js` (**required**)
   - `/whisper` → `whisper.js` (**required** for rented Dial)
   - `/voicemail-done` → `voicemail-done.js` (**required** for ranking voicemail)
   - `/status` → `status.js` (optional live relay)
   - `/recording` → `recording.js` (SMS notify + optional live relay)
3. **Environment Variables** on the service:
   - `TWILIO_FORWARD_TO` = your E.164 cell — **SMS** when a ranking voicemail is left (also matches legacy ranking Dial URLs so they take voicemail)
   - Optional: `TWILIO_VOICEMAIL_GREETING_URL` — set by Rover after you upload a greeting
   - Spoken fallback is a public Asset at `/voicemail-fallback.txt` (not an env value — 100-char cap). `/inbound` fetches it from `DOMAIN_NAME`.
   - Optional live relay: `ROVER_WEBHOOK_URL` = public base that reaches Rover — **no trailing slash**
   - Optional live relay: `ROVER_PHONE_WEBHOOK_SECRET` = same as Rover `.env`
4. **Deploy All**
5. In Rover `.env`:

```
TWILIO_VOICE_WEBHOOK_URL=https://rover-voice-xxxx.twil.io/inbound
# Optional if Rover cannot match the Functions service from the webhook URL:
# TWILIO_SERVERLESS_SERVICE_SID=ZS…
# Optional — only for live webhook relay:
# ROVER_PHONE_WEBHOOK_SECRET=<same as Function env>
# ROVER_PUBLIC_WEBHOOK_BASE=https://your-tunnel.example
```

Without `ROVER_WEBHOOK_URL`, ranking calls still take a voicemail, Twilio still records, and `/recording` still texts `TWILIO_FORWARD_TO`. Open **Phone** in Rover to sync history from Twilio.

After the first Console deploy, Phone Refresh publishes Function source from this folder when the files change (so ranking `/inbound` cannot stay on an old Dial-your-cell build). Greeting Save also includes those Function versions in the same build.

US carriers may filter SMS from local DIDs (A2P/10DLC). Voicemail still records if a text is dropped. Trial accounts may only SMS verified numbers.

## Call flow

```
Inbound → /inbound (?site=&siteId=&mode=voicemail | &forward=)
  Ranking: Play greeting or spoken fallback → Record → /voicemail-done
         → recordingStatusCallback /recording → SMS TWILIO_FORWARD_TO
  Rented:  dials renter (whisper to callee)
       → Twilio stores Call + Recording
       → Rover Phone tab: POST /api/phone/sync (REST backfill) → local log → optional summary

Optional while Rover reachable via tunnel:
       → Dial action / statusCallback → /status → Rover POST /api/phone/webhooks/status
       → recordingStatusCallback → /recording → Rover POST /api/phone/webhooks/recording
```

## Query params on voiceUrl

Rover provision / forward cutover sets:

| Param | Purpose |
|-------|---------|
| `site` | Business name (spoken fallback `{site}` / whisper) |
| `siteId` | Portfolio id for call log |
| `mode` | `voicemail` while ranking |
| `forward` | E.164 dial target (renter only) |

If `mode=voicemail`, or `forward` equals Function env `TWILIO_FORWARD_TO`, `/inbound` takes a voicemail and does **not** Dial your cell.
