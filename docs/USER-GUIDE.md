# Rover User Guide

How to run the pipeline from finding a market to a live site. This is the operator manual: every screen and control you can see. Time estimates live in [USER-FLOW.md](USER-FLOW.md). API keys: [ENV-SETUP.md](ENV-SETUP.md).

## What Rover is {#what-rover-is}

Rover finds local home-service markets worth ranking for, then ships a lead-gen website for that niche × city. You rent the site (or its leads) to a local operator. Most markets stop early on purpose. Only rows you mark **pursue** become Website Candidates and get a full site.

## How to start {#start}

1. On this machine, open a terminal in the Rover folder.
2. Run `npm run rover` **once**. Leave that terminal open.
3. Open [http://127.0.0.1:8787](http://127.0.0.1:8787). Extra windows or tabs to that URL are extra views — do not start six terminals.
4. Keys go in the gear → **Account setup**. Saving there applies without a restart. Editing `.env` by hand still needs a restart.

First-time keys: open Account setup, or follow [ENV-SETUP.md](ENV-SETUP.md) until Settings → API/Other is green.

## Chrome {#chrome}

The top bar is always there.

### Version {#chrome-version}

**v2.8** (or current) sits next to the Rover wordmark. That is the product version, not a candidate.

### Stages {#chrome-stages}

Numbered pipeline: **1 Discovery** → **2 Research** → **3 Website** → **4 Launched**. Click a stage to switch screens. Arrows are decoration; they do not skip work.

### Map, Photo, Phone {#chrome-satellites}

Unnumbered helpers after Launched. They are not stages. You can skip Map and Photo. Phone is for calls after a ranking number exists.

### Jobs {#chrome-jobs}

Prepare preview, Push updates, Run launch, Write site, Accept, and Generate pack dim the workspace under the top bar on that candidate. Other work (Light SERP, Find addresses, GSC, Research) uses a bar on that step. **Concurrent Limit** in Settings is how many of each kind may run at once. Write site, Evaluations, Light SERP, Generate pack, and Heavy (Prepare / Launch) pop up if you try to start more than the box. **Assembled previews** is how many live preview doors may stay open. **OpenAI photos** and **OpenAI before/after** queue extras in the background (including other Rover tabs and other candidates). Generating photos does not lock the table or other tabs — you can switch candidates and start SERP / Write site / Prepare while images finish. Hard-refresh every open tab after a Rover update.

### API Cost {#chrome-api-cost}

Dollar icon. Spend by provider (DataForSEO, Claude, and others). Anthropic, OpenAI, and Google Maps show Rover-recorded spend and **PAYG** for balance. It does not start jobs.

### Settings {#chrome-settings}

Gear. **Host** is this Rover instance. **API/Other** expands the green ✓ / red ✕ key checklist. **Concurrent Limit** is how many Light SERP / Generate pack / Evaluations / Write site / OpenAI photos / OpenAI before/after / Heavy / assembled previews may run at once (hover a box for the hard max). New Rover setups default Light SERP, Generate pack, Heavy, and assembled previews to **5**. If this computer already saved older numbers, those stay until you change them. Rows are marked **D** Discovery, **R** Research, **W** Website in the same Space Grotesk as the top-nav stage names. **Theme** is Light 1–4 and Dark 5–8 (Blue is default light).

### Help {#chrome-help}

Opens this User guide in a searchable panel. The Dev guide stays in the repo, not in this panel.

## Naming {#naming}

| Term | Meaning |
| ---- | ------- |
| **Stage** | Top-bar pipeline: Discovery → Research → Website → Launched |
| **Evaluation** | Numbered checklist inside Research (SERP/Volume → Prospects) |
| **Track** | Numbered checklist inside Website (Site-Config → Content → Launch) |
| **Step** | A numbered item inside Discovery, an Evaluation, or a Track |
| **Screen** | A top-bar destination (includes Phone · Map · Photo) |
| **Panel** | A work area on a candidate’s detail side |

Easy mix-ups: **Light SERP** is an optional Discovery check, not Research Evaluation 1. **Site research** is a Content step, not “field research” in the UI. The Discovery map (cluster colors) is not the later **Zone map** button, which adds cities after Research.

## Discovery {#discovery}

The usual path is Cluster Cities. Single City is still there. Most rows will not become sites.

1. Choose **Cluster Cities**.
2. Enter the cluster niche.
3. Pick an existing zone, or start a new one.
4. New zone only: on the map, pick a cluster color, click cities or drag a circle, then **Generate pack**. An existing zone skips the map.
5. **Generate pack**.
6. Set a decision on each row.
7. **Process batch**.

**Light SERP** is optional. It is a cheap map-pack and page-count check. It is not the next step after Generate pack.

**pursue**, **maybe**, **review**, and **hold** become Research candidates. **pursue** is what **Open tabs** will open later. **pass** is remembered and will not be suggested again. **ignore** can come back.

Find hubs with Claude is optional. It does not start by itself on a new zone.

### New Discovery Pack {#discovery-new-pack}

Cluster Cities is one niche for one metro. Required niche text stays exact. Claude estimates monthly search volume. That estimate is for sorting the list, and when ad volumes are skipped it can stand in for Research Demand (labeled **est.**).

In **Anthropic API** mode, **Generate pack** sends the prompt and imports the rows. In **Copy & paste** mode, Generate writes the template and prompt, then use Send to Claude and Import.

### Send to Claude {#discovery-send-claude}

Copy & paste only. Copy the prompt, run it in Claude, wait for the filled CSV. Hidden in Anthropic API mode.

### Import Claude CSV {#discovery-import}

Copy & paste only. Paste or load the CSV. Rows appear in the batch table. Next: set a decision, then Process batch. Hidden in Anthropic API mode.

### Light SERP {#discovery-light-serp}

Optional. Cheap map-pack and page-count check so you can decide before paying for Research ad volumes. Not the same as Research → SERP / Volume.

### Decision {#discovery-decision}

Every row needs a decision before Process. The meanings sit next to **Process batch**.

- **pursue, maybe, review, hold** — become Research candidates. **pursue** is what Open tabs will open.
- **pass** — remembered; Generate pack will not suggest that pair again
- **ignore** — skipped; can show up again later

### Process batch {#discovery-process}

Keepers become Research candidates. On the usual path, search volumes are not started. Open Research and run the required steps: a search snapshot, then the written story. Search volumes are queued only when Research was set to **Run all** before Process.

### Advanced {#discovery-advanced}

Sidebar editor for pairs Generate pack should not suggest again. Launched candidates cannot be removed here. **Wipe to match Active Research** drops leftovers so Generate pack uses the shorter list.

## Research {#research}

Prove the market, then set **pursue** when you are ready to build. **pursue** is what **Open tabs** will open on Website.

The required path is a search snapshot, then the written story (**Run all required**, or **Copy prompt** in Copy & paste). Enrich, ad volumes, and Find renters are optional. They do not block Website.

The list shows a green **LIVE** badge after the checkbox for launched sites, then Evaluation (1–4) and Website Track (1 Site-Config · 2 Content · 3 Launch), and **Type** after API $ (Discovery / Research / Website / Launched).

**Delete permanently** wipes unlaunched Research or Website rows (Rover files + local assembled folder). Launched candidates cannot be deleted. Archive still hides a row without deleting files.

**Concurrent Limit** (Settings, gear) is how many Evaluations may run at once (default 6, maximum 100). SERP / Enrich / Prospects use it in Copy & paste and API. API **Run Narrative** and **Run all** use it too; paste Narrative is still Copy prompt for one candidate. If you select more rows than the Evaluations box, Rover explains the soft limit and does not start — raise **Evaluations** under Concurrent Limit or select fewer.

In **Anthropic API** mode, the All box has **Run all required** (default) and **Run all** (ad volumes, Enrich, the story, and renters). Copy & paste mode hides this box; **Copy prompt** gets a cheap search snapshot first.

### Overview {#research-overview}

Snapshot of scores and flags. Set **pursue** here when you are ready to build. That opens Website, and it is the decision Open tabs uses.

### SERP / Volume {#research-serp}

Evaluation 1. Paid **Ad volumes** are optional. A cheap search snapshot is enough for the story and for Website keyword hints. When ad volumes are skipped, Demand can show Claude’s Discovery estimate, labeled **est.** **Force new SERP** re-pulls the map pack and organic results. **Keywords** is a glance at ad volumes when you ran them.

### Enrich {#research-enrich}

Evaluation 2. How strong the competing pages look. Optional. Click **Run enrich**. It does not block the story or Website.

### Narrative {#research-narrative}

Evaluation 3. Required to build. Needs the search snapshot, not Enrich. In Copy & paste: **Copy prompt** → Claude → **Load** the reply. A valid reply is accepted automatically. In API mode, **Run Narrative** does the same. When ad volumes were skipped, the reply should include keyword phrases and not invented volumes.

### Prospects {#research-prospects}

Evaluation 4. Optional renter list. Click **Find renters** after the story is accepted. It does not require **pursue**, and it does not block Website.

## Website {#website}

Build the site for a **pursue** candidate. Before Colors on any site, click **Open tabs** on the Website list. Pick the zone and the cluster range for this session. Rover opens one tab per **pursue** city. Then work Colors through launch on those tabs.

Three tracks, in order: Site-Config → Content → Launch.

### Site-Config {#website-site-config}

1. **Colors & fonts** — pick a palette and a font, then Apply.
2. **Address** — Find commercial streets, enter one, use home, or Skip.
3. **Domain** — pick a city-first host, or type your own. Buy it before launch.
4. **Business details** — name, address, and contact details. In API mode, **Fill site-config** then **Apply changes**. In Copy & paste, copy the prompt.
5. **Paste the reply** — Copy & paste only. Load the reply and edit it here.
6. **Review services → Accept** — locks site-config.
7. **Service area** — click a city to add or remove coverage. Zone candidates have no radius ring: suggested location pages plus Also serving leftovers. Other zone cities stay Also serving only.
8. **Provision phone** — buy a local number, or Skip. Calls go to voicemail and text you. Do not buy numbers in Discovery or Research. Rover buys this city’s area code, including an overlay. If none of those codes are in stock, it buys the closest number in the state. See [Area code on a new number](#phone-area-code). If **Phone → Twilio** is still red in Settings, finish [First-time Twilio setup](#phone-twilio-setup) first.

**Find addresses:** Clean target (default 10) stops Places after that many clean streets. Pull size (default ~40 listings per source) is remembered in this browser. A street is rejected only for an **active OPERATIONAL** Maps listing on that street + ZIP. **Refresh / Fetch deeper** re-scrapes checked sources. Use **Find** when a source still has streets left; **Fetch deeper** when every checked source is exhausted.

### Content {#website-content}

1. **Structure** — usually Preset C. Home is this niche in this city. Service pages are offers you will do. Location pages are real nearby cities.
2. **Site research** — Copy → Claude → Load. Copy & paste only.
3. **Content brief** — Copy → Claude → Load & confirm.
4. **Outline** — Copy → Claude → Load & confirm.
5. **Full write** — one page group at a time. Longest Claude wait.
6. **Humanize** — Rover checks the writing. Send leftovers back if you want them gone.
7. **Final check** — Copy → Load the result.
8. **Image queries** — prompts for stock photos. Copy & paste, when photos are on.
9. **Load photo group** — optional. Skip uses fresh stock on Accept.
10. **Accept** — writes the pages, then photos, logo, and coverage map.

In **API** mode, steps 2–8 are **Structure**, then **Write site with Claude** (one job per candidate). You can start Write site on up to **six different** candidates at the same time. A second Write site on the same candidate is blocked until the first finishes. Each window still confirms cost. After Accept, open **3 · Launch**.

### Launch track {#website-launch}

1. **Logo & Map** — regenerate the logo or coverage map if Accept skipped them.
2. **Review images** — swap, upload, or generate photos. Save or load a photo group if you want.
3. **Prepare preview** — builds a local preview of every page. It does not publish. When it finishes, open every preview page, then Run launch.
4. **Launch** — first go-live. Buy the domain. At the registrar, point the nameservers at Cloudflare so the domain shows up in this account. Put your Gmail in the destination box. Leave **Auto ship** and **Connect domain and email** on. After launch, open Cloudflare’s confirmation email once, submit the live form, and confirm the email arrives.
5. **Indexing** — submit the live sitemap in Search Console, then mark done. Indexing is not ranking. A “Page with redirect” email is expected. See [Search Console emails](#website-indexing-emails).
6. **Push updates** — the site is already live: publish the latest copy. Run **Prepare preview** first if the pages changed.

The site then appears under **4 Launched**.

### Search Console emails {#website-indexing-emails}

Google sends “New reason preventing your pages from being indexed” once per site, the first time it sees that reason. A full inbox after launching many sites is the same email repeated.

**Page with redirect** is a URL Google tried that sends visitors to the real page. Rover does this on purpose:

- `http://` goes to `https://`
- `www` goes to the bare domain
- A path with no ending slash (`/about`) goes to the same path with a slash (`/about/`)

The pages that get indexed are `https://`, no `www`, with the trailing slash. The rows in the email are the other URLs. Leave them. Do not click **Validate fix**. Google keeps requesting those URLs, so the warning stays.

Also ignore **Not found (404)** when that URL is not a page on the site.

Open the report when the examples are the real pages (https, no www, trailing slash), or when Google reports a server error, noindex, or a robots.txt block.

## Launched {#launched}

Portfolio of live sites: rent status, renter, payment, infra links. The page is three bands: **Portfolio** (KPIs and charts), **Search mix** (pages by type and top queries), then **Sites**. **Cluster tree** / **Flat list** on the table picks the view: tree is Zone → Cluster → Site (same grouping as Phone/Form Combined); Flat list is the old sortable one-row-per-site table. Checkboxes drive the four charts at the top: none checked uses every site currently listed (filters still apply); checking rows limits the charts to those sites.

Each chart has its own Y-axis. Hover a day for the date and values. Missing data is left off that chart, not drawn as zero. A warning under the chart names the sites that still need **Sync GSC**, **Check ranks**, or **Check index** — click it to select them. Impressions and clicks (and the Sites with impressions toggle) are Search Console’s last 90 days — **Sync GSC** once backfills them; you do not need a daily pull. The last 2–3 days on those GSC charts are dotted because Google is still landing the numbers — not a drop in traffic. Page 1 and Indexed URLs only have points on days you ran **Check ranks** / **Check index**; those cannot be backfilled. **Pages by type** and **Top queries** under the charts add up the current checkbox set. Open a site for a two-axis Traffic chart and sortable query/page tables. **Indexing Mark done** stays checked after reload. **Push updates** from Website ships later content. Metrics need GSC connected — see Settings greens and [SITES-METRICS.md](SITES-METRICS.md).

## Phone {#phone}

Call log for ranking numbers: voicemail / answered / missed, recordings, AI summaries. Upload the ranking greeting and spoken fallback here. Provision in Site-Config, not here. Rent cutover keeps the same number and forwards to the renter.

### Area code on a new number {#phone-area-code}

Rover buys a number in the site city’s area codes. An overlay such as 385 for Salt Lake City or 447 for Springfield, Illinois counts as that city. If none of those codes are in stock, Rover buys the closest available number in the same state. It does not take the first number anywhere in the state. Type an area code to keep that code only. Rover will not switch to another one.

### First-time Twilio setup {#phone-twilio-setup}

Do this **Twilio Console + .env** setup **once per Twilio account**. After that, Phone Refresh keeps the Functions up to date. You do not paste the code again unless you create a new Twilio account.

Do these clicks in order. Do not skip **Deploy All**.

1. Open [Twilio Console](https://console.twilio.com/) and sign up or log in. Add money to the account (a trial can test; buying local tracking numbers needs funds).
2. On the Console home, copy **Account SID** (starts with `AC`). Click the eye next to **Auth Token** and copy it.
3. In the left menu open **Functions and Assets** (sometimes under Develop), then **Services**. Click **Create Service**. Unique name must be exactly `rover-voice`. Create it.
4. Add **five** Functions. For each one: **Add Function** (or Add + Function). Set **Path** exactly as listed under **Code to paste**. Set **Access** to **Public** (Protected or Private will not answer ranking calls). Select all default text in the editor, delete it, paste the matching block, then **Save**.
5. On that same service, open **Environment Variables** (or Variables). Add one variable: Key `TWILIO_FORWARD_TO`, Value your cell in E.164 (US example `+18015551234` — plus sign, country code, no spaces or dashes). Do not add other variables yet.
6. Click **Deploy All**. Wait until Twilio says it succeeded. If it fails, fix the error on screen, then Deploy All again.
7. On the service page, copy the domain (looks like `rover-voice-1234.twil.io`). Your webhook is that domain with `/inbound` on the end: `https://rover-voice-1234.twil.io/inbound`.
8. In Rover, open the gear → **Account setup**. Paste the Account SID, auth token, and forward-to number into those rows and Save. That applies without a restart.
9. The voice webhook URL is not on that page. In `.env`, set `TWILIO_VOICE_WEBHOOK_URL` to the `/inbound` URL from the step above, save, then restart Rover (`Ctrl+C`, then `npm run rover`).
10. In Rover, click the gear → **API/Other**. **Phone → Twilio** must be green. If it stays red, use **If something goes wrong** below.
11. Click **Phone** in the top bar. The Rover loading card is normal. Expand **Ranking greeting**, then **Save spoken fallback** once (even if you did not change the words).
12. After you **Provision** a ranking number on a Website candidate, call that number from another phone. Your cell must **not** ring. You should hear the spoken greeting. You get a text only if the caller leaves a message.

This Console paste is **once per Twilio account**. Later Rover versions update the Function code when you open Phone.

### Code to paste {#phone-twilio-code}

Paste one block per Function. Path must match exactly. Access = **Public**. If you can open the Rover folder, you may copy the same text from `ops/twilio-functions/` instead — it is the same files.

**Path `/inbound`** (file `ops/twilio-functions/inbound.js`):

```js
/**
 * Twilio Serverless Function: /inbound
 * Deploy to Twilio Functions; set service env:
 *   TWILIO_FORWARD_TO=+1…   (SMS notify + legacy ranking Dial match)
 *   TWILIO_VOICEMAIL_GREETING_URL=https://…/voicemail-greeting.mp3  (optional Play)
 *   TWILIO_VOICEMAIL_FALLBACK_URL=https://…/voicemail-fallback.txt  (optional; else /voicemail-fallback.txt)
 *   ROVER_WEBHOOK_URL=https://…  (optional public Rover base, no trailing slash)
 *   ROVER_PHONE_WEBHOOK_SECRET=… (shared with Rover .env)
 *
 * Rover sets voiceUrl to:
 *   ranking: https://YOUR.twil.io/inbound?site=BusinessName&siteId=site_…&mode=voicemail
 *   rented:  https://YOUR.twil.io/inbound?site=BusinessName&siteId=site_…&forward=+1…
 *
 * Spoken fallback is a public Asset (not a Function env value — those max out at 100 chars).
 */
const DEFAULT_FALLBACK =
  "You've reached {site}. Please leave your name, number, and a brief message after the tone.";

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function sameE164(a, b) {
  const da = digits(a);
  const db = digits(b);
  if (!da || !db) return false;
  return da === db || da.endsWith(db) || db.endsWith(da);
}

function isVoicemailMode(event, context, forwardTo) {
  const mode = String(event.mode || event.Mode || '').toLowerCase();
  if (mode === 'voicemail' || mode === 'ranking') return true;
  if (mode === 'dial') return false;
  const notify = String(context.TWILIO_FORWARD_TO || '').trim();
  if (forwardTo && notify && sameE164(forwardTo, notify)) return true;
  if (!forwardTo) return true;
  return false;
}

function attachRecord(twiml, domain, recordingPath) {
  twiml.record({
    playBeep: true,
    timeout: 5,
    maxLength: 120,
    action: `https://${domain}/voicemail-done`,
    method: 'POST',
    recordingStatusCallback: `https://${domain}${recordingPath}`,
    recordingStatusCallbackMethod: 'POST',
    recordingStatusCallbackEvent: 'completed',
  });
}

function sayFallbackAndRecord(twiml, site, text, domain, recordingPath, callback) {
  const raw = String(text || DEFAULT_FALLBACK).trim().slice(0, 500) || DEFAULT_FALLBACK;
  twiml.say(raw.replace(/\{site\}/gi, site));
  attachRecord(twiml, domain, recordingPath);
  return callback(null, twiml);
}

exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  const forwardTo = (event.forward || event.Forward || '').toString().trim();
  const site = (event.site || event.Site || 'your ranking site').toString().slice(0, 80);
  const siteId = (event.siteId || event.SiteId || '').toString().trim();
  const voicemail = isVoicemailMode(event, context, forwardTo);

  const domain = context.DOMAIN_NAME;
  const statusQs = new URLSearchParams();
  if (siteId) statusQs.set('siteId', siteId);
  if (site) statusQs.set('site', site);
  if (voicemail) statusQs.set('mode', 'voicemail');
  if (forwardTo) statusQs.set('forward', forwardTo);
  const statusPath = `/status?${statusQs.toString()}`;
  const recordingPath = `/recording?${statusQs.toString()}`;

  if (voicemail) {
    const greetingUrl = String(context.TWILIO_VOICEMAIL_GREETING_URL || '').trim();
    if (greetingUrl) {
      twiml.play(greetingUrl);
      attachRecord(twiml, domain, recordingPath);
      return callback(null, twiml);
    }
    const fallbackUrl = String(context.TWILIO_VOICEMAIL_FALLBACK_URL || '').trim()
      || `https://${domain}/voicemail-fallback.txt`;
    fetch(fallbackUrl)
      .then((res) => (res.ok ? res.text() : ''))
      .then((text) => sayFallbackAndRecord(twiml, site, text, domain, recordingPath, callback))
      .catch(() => sayFallbackAndRecord(twiml, site, DEFAULT_FALLBACK, domain, recordingPath, callback));
    return;
  }

  if (!forwardTo) {
    twiml.say('This line is not configured yet.');
    return callback(null, twiml);
  }

  const dialOpts = {
    record: 'record-from-answer',
    action: `https://${domain}${statusPath}`,
    method: 'POST',
    recordingStatusCallback: `https://${domain}${recordingPath}`,
    recordingStatusCallbackMethod: 'POST',
    recordingStatusCallbackEvent: 'completed',
  };

  const dial = twiml.dial(dialOpts);

  dial.number(
    {
      url: `https://${domain}/whisper?site=${encodeURIComponent(site)}`,
      statusCallback: `https://${domain}${statusPath}`,
      statusCallbackEvent: 'initiated ringing answered completed',
      statusCallbackMethod: 'POST',
    },
    forwardTo,
  );

  return callback(null, twiml);
};
```

**Path `/whisper`** (file `ops/twilio-functions/whisper.js`):

```js
/**
 * Twilio Serverless Function: /whisper
 * Plays only to the person answering (not the caller), then connects.
 */
exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  const site = (event.site || event.Site || 'your ranking site').toString().slice(0, 80);
  twiml.say(`Call from ${site}.`);
  return callback(null, twiml);
};
```

**Path `/voicemail-done`** (file `ops/twilio-functions/voicemail-done.js`):

```js
/**
 * Twilio Serverless Function: /voicemail-done
 * Record action — thank the caller after they leave a message.
 */
exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  twiml.say('Thank you. Goodbye.');
  twiml.hangup();
  return callback(null, twiml);
};
```

**Path `/recording`** (file `ops/twilio-functions/recording.js`):

```js
/**
 * Twilio Serverless Function: /recording
 * Relays recordingStatusCallback into Rover, then Rover enqueues OpenAI STT + summary.
 * Ranking voicemail: SMS TWILIO_FORWARD_TO from the ranking DID (skip empty recordings).
 *
 * Env: ROVER_WEBHOOK_URL, ROVER_PHONE_WEBHOOK_SECRET, TWILIO_FORWARD_TO
 */
const crypto = require('crypto');

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function sameE164(a, b) {
  const da = digits(a);
  const db = digits(b);
  if (!da || !db) return false;
  return da === db || da.endsWith(db) || db.endsWith(da);
}

function shouldSmsVoicemail(context, event) {
  const mode = String(event.mode || event.Mode || '').toLowerCase();
  if (mode === 'voicemail' || mode === 'ranking') return true;
  const forward = String(event.forward || event.Forward || '').trim();
  const notify = String(context.TWILIO_FORWARD_TO || '').trim();
  if (!forward) return true;
  if (notify && sameE164(forward, notify)) return true;
  return false;
}

function postToRover(context, path, payload) {
  const base = String(context.ROVER_WEBHOOK_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const secret = String(context.ROVER_PHONE_WEBHOOK_SECRET || '').trim();
  if (!base || !secret) {
    return Promise.resolve({ skipped: true, reason: 'ROVER_WEBHOOK_URL or secret missing' });
  }
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-rover-phone-secret': secret,
      'x-rover-phone-signature': signature,
    },
    body,
  }).then(async (res) => {
    const text = await res.text();
    return { status: res.status, text: text.slice(0, 500) };
  });
}

function sendVoicemailSms(context, event) {
  if (!shouldSmsVoicemail(context, event)) {
    return Promise.resolve({ skipped: true, reason: 'not voicemail' });
  }
  const duration = Number(event.RecordingDuration || event.recordingDuration || 0) || 0;
  if (duration < 1) {
    return Promise.resolve({ skipped: true, reason: 'empty recording' });
  }
  const to = String(context.TWILIO_FORWARD_TO || '').trim();
  if (!to) {
    return Promise.resolve({ skipped: true, reason: 'TWILIO_FORWARD_TO missing' });
  }
  const fromDid = String(event.To || event.Called || '').trim();
  if (!fromDid) {
    return Promise.resolve({ skipped: true, reason: 'no ranking DID on To' });
  }
  const site = String(event.site || event.Site || 'a ranking site').slice(0, 80);
  const caller = String(event.From || event.from || 'unknown');
  const client = context.getTwilioClient();
  return client.messages
    .create({
      to,
      from: fromDid,
      body: `Rover voicemail for ${site}: ${caller} left a ${duration}s message. Open Phone in Rover to listen.`,
    })
    .then((msg) => ({ ok: true, sid: msg.sid }))
    .catch((err) => {
      console.error('voicemail SMS failed', err);
      return { ok: false, error: err?.message || String(err) };
    });
}

exports.handler = function (context, event, callback) {
  const payload = {
    CallSid: event.CallSid,
    RecordingSid: event.RecordingSid,
    RecordingUrl: event.RecordingUrl,
    RecordingDuration: event.RecordingDuration,
    RecordingStatus: event.RecordingStatus,
    CallStatus: event.CallStatus,
    From: event.From,
    To: event.To,
    siteId: event.siteId || event.SiteId || '',
    site: event.site || event.Site || '',
    forward: event.forward || event.Forward || '',
    mode: event.mode || event.Mode || '',
  };

  Promise.all([
    postToRover(context, '/api/phone/webhooks/recording', payload),
    sendVoicemailSms(context, event),
  ])
    .then((result) => {
      callback(null, '');
      console.log('recording relay', result);
    })
    .catch((err) => {
      console.error('recording relay failed', err);
      callback(null, '');
    });
};
```

**Path `/status`** (file `ops/twilio-functions/status.js`):

```js
/**
 * Twilio Serverless Function: /status
 * Relays Dial / call status callbacks into Rover (HMAC + shared secret).
 *
 * Env: ROVER_WEBHOOK_URL, ROVER_PHONE_WEBHOOK_SECRET
 */
const crypto = require('crypto');

function postToRover(context, path, payload) {
  const base = String(context.ROVER_WEBHOOK_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const secret = String(context.ROVER_PHONE_WEBHOOK_SECRET || '').trim();
  if (!base || !secret) {
    return Promise.resolve({ skipped: true, reason: 'ROVER_WEBHOOK_URL or secret missing' });
  }
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-rover-phone-secret': secret,
      'x-rover-phone-signature': signature,
    },
    body,
  }).then(async (res) => {
    const text = await res.text();
    return { status: res.status, text: text.slice(0, 500) };
  });
}

exports.handler = function (context, event, callback) {
  const payload = {
    CallSid: event.CallSid || event.ParentCallSid,
    ParentCallSid: event.ParentCallSid,
    DialCallStatus: event.DialCallStatus,
    CallStatus: event.CallStatus,
    DialCallDuration: event.DialCallDuration,
    CallDuration: event.CallDuration,
    From: event.From,
    To: event.To,
    Called: event.Called,
    Timestamp: event.Timestamp,
    siteId: event.siteId || event.SiteId || '',
    forward: event.forward || event.Forward || '',
  };

  postToRover(context, '/api/phone/webhooks/status', payload)
    .then((result) => {
      // Dial action expects TwiML; empty response is fine after dial completes.
      const twiml = new Twilio.twiml.VoiceResponse();
      callback(null, twiml);
      console.log('status relay', result);
    })
    .catch((err) => {
      console.error('status relay failed', err);
      const twiml = new Twilio.twiml.VoiceResponse();
      callback(null, twiml);
    });
};
```

### .env paste {#phone-twilio-env}

Replace every placeholder. No quotes. No spaces around `=`.

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FORWARD_TO=+1XXXXXXXXXX
TWILIO_VOICE_WEBHOOK_URL=https://rover-voice-xxxx.twil.io/inbound
```

`TWILIO_VOICE_WEBHOOK_URL` must be `https://` and must end with `/inbound`. Do not use Rover’s `http://127.0.0.1:8787` address.

### If something goes wrong {#phone-twilio-errors}

| What you see | What to do |
| --- | --- |
| Settings **Phone → Twilio** still red | Account SID, token, or forward-to is missing in Account setup, or `TWILIO_VOICE_WEBHOOK_URL` is missing from `.env` (that line needs a restart) |
| `TWILIO_FORWARD_TO must be E.164` | Use `+1` then 10 digits. Example: `+18015551234`. No spaces, dashes, or parentheses |
| `TWILIO_VOICE_WEBHOOK_URL must be a public https URL` | Use `https://your-service.twil.io/inbound`. Not `http`, and not `127.0.0.1` |
| `No Twilio Functions service found` | Create the service named exactly `rover-voice`, or SID/token are from a different Twilio account |
| `No Twilio Functions deployment yet` or `no Function versions` | Click **Deploy All** on the `rover-voice` service and wait until it succeeds |
| Greeting Save or Phone load says publish failed | Deploy All again. Each Function Access must be **Public** |
| Your cell still rings on a ranking number | Access is not Public, Deploy All was skipped, or Phone has not refreshed since deploy. Open **Phone** once, then call again |
| No SMS, but Phone shows a voicemail | Trial accounts can only text verified numbers; some carriers filter SMS from local numbers. The voicemail in Phone still counts as success |
| Cannot buy a number / geo or permission error | Fund the Twilio account. In Console, allow the United States under Voice geographic permissions |
| `less than or equal to 100` on spoken fallback | Do not put the greeting sentence in a Function env variable. Save spoken fallback from the Phone tab after Deploy All |

## Map {#map}

Geography assist for picking cities. Not required. Discovery can use it as a helper; Website Service area is the coverage map you confirm for the site.

## Photo {#photo}

Optional group organizer. Skipping it does **not** block Content, Accept, stock Pull, Image queries, or Launch.

- **Named groups** — snapshots from Website → Review images (or Duplicate here).
- **Niche master** (`{Niche} master`) — pinned. **Prepare preview** merges Review images into it. Later Accept in the same niche **uses the master** unless you Load a named group or Skip Content step 9.
- Load matches by **role** (service/slot), not a full Structure copy.

## Jobs {#jobs}

Long work shows on the page you started it from. Prepare / Push / Launch / Write site / Accept / Generate pack use a card under the top bar. Light SERP, listings, GSC, and Research use an in-page bar on that step. Concurrent Limit → Heavy still caps Prepare / Launch.

## Waiting vs doing {#waiting}

Most clicks are seconds. Wall-clock is Claude, DataForSEO, Prepare preview, and Launch. Typical waits: Discovery Claude pack ~8–12 min; Full write ~12–22 min; Prepare preview ~2–4 min; Launch ship ~3–5 min. Full table: [USER-FLOW.md](USER-FLOW.md). You can switch candidates or screens while a job runs — the card only appears if you are on that same candidate. Two Rover tabs can both **open** the same Website candidate to watch jobs. Only one tab can **save** (grades, photos, Site-Config, Visual Edit, Accept). The other tab shows a lock banner; use **Take over** only if you mean to steal editing.

## Still done by hand {#manual}

- Buy domain + point NS at Cloudflare
- Set the Email Routing destination (Gmail) so Rover can email leads
- Verify Email Routing in Gmail once
- One-time machine setup (`gh auth`, Cloudflare tokens)
- First-time Twilio Functions **Deploy All** (see [First-time Twilio setup](#phone-twilio-setup))

## Related docs {#related}

| Doc | When |
| --- | --- |
| [USER-FLOW.md](USER-FLOW.md) | Time estimates |
| [ENV-SETUP.md](ENV-SETUP.md) | API keys |
| [OPERATOR-CADENCE.md](OPERATOR-CADENCE.md) | 10 sites/day schedule |
| [PHONE-TRACKING.md](PHONE-TRACKING.md) | Ranking voicemail → renter forward |
| [SITE-INDEXING.md](SITE-INDEXING.md) | Google indexing after launch |
| [LAUNCH.md](LAUNCH.md) | Run launch / Push updates |
| [DEV-GUIDE.md](DEV-GUIDE.md) | Engineers (repo only) |
