# Turnstile — paused

Decision on 2026-11-11: do not roll Turnstile out. Cary Drywall Repair was the only live test, and that widget was removed. Leave every site on the honeypot, the domain allowlist, the keyword list, and 8 submits per IP per hour.

Do not create widgets, set `turnstileSiteKey`, or store a forms secret unless Paul asks to turn this on.

## What already works

The shared form and the forms worker can enforce Turnstile when a site is configured for it. Nothing is configured for it now.

- Managed mode. Most people pass with no puzzle. Suspicious visitors get a “Verify you are human” checkbox.
- The public site key lives in site-config as `turnstileSiteKey`. [src/components/LeadForm.astro](../src/components/LeadForm.astro) draws the widget only when that key is set. An empty key draws no box.
- An unchecked box uses the browser’s “Please fill out this field.” prompt, anchored on a required input over the checkbox. There is no red outline and no extra sentence.
- The secret is stored only in D1 `sites.turnstile_secret`. It never goes in site-config or git. Allowlist sync does not clear that column.
- [ops/forms-worker/src/index.js](../ops/forms-worker/src/index.js) calls siteverify only when that domain has a secret. A missing or invalid token is not stored and not emailed. A domain with no secret is unchanged.
- `www` is covered by the apex hostname. One hostname per site.
- `ensureManagedTurnstileWidget` in [ops/lib/cloudflare-launch.mjs](../ops/lib/cloudflare-launch.mjs) rotates the secret of an existing widget. Do not call it. A rotated secret breaks live checks until D1 is updated in the same run.
- Launch keeps `createTurnstile: false`. The Launch screen does not ask for a site key. Sending an empty `turnstileSiteKey` from Launch would wipe a saved key, because `patchLaunchSiteConfig` writes that field even when it is blank.
- The site-config editor still has the key field. That is where a future key would be stored. Leave it empty.

## Why it was not expanded

On 2026-11-11 the portfolio had 216 launched domains. The Cloudflare account had one widget, the Cary pilot.

Free Turnstile, from [Cloudflare’s plans](https://developers.cloudflare.com/turnstile/plans/):

| | Free | Enterprise |
| --- | --- | --- |
| Price | $0 | No published price. Sales quote only. |
| Widgets | 20 | Unlimited |
| Hostnames | 10 per widget (200 sites) | 200 per widget, plus an “any hostname” widget |
| Checks | Unlimited | Unlimited |

20 widgets × 10 hostnames = 200 sites. Sixteen current domains do not fit, and later launches need hostnames too. Pro ($20 per site) and Business ($200 per site) do not raise this cap.

Enterprise is a sales contract, not a small add-on. Turnstile Enterprise is also included with Bot Management for Enterprise. People who have posted quotes describe full-account contracts, often about $1,500–$5,000 a month, sometimes lower after negotiation, and sometimes $10,000 a month or more. Those quotes are priced from zone count and traffic. They are not a price Cloudflare will honor for this account.

## Later, only when Paul asks

Build a widget pool. Do not make one widget per site.

- Fill an existing managed widget up to 10 apex hostnames, then create another, stopping at 20 widgets.
- Never rotate a secret. The secret is returned only on create. Copy that same secret onto each domain that shares the widget, via `setSiteTurnstileSecret`, after allowlist sync has created the D1 row.
- Write the public site key into site-config before ship, so the built HTML includes the widget.
- When the pool is full, Launch still ships and leaves that site on the honeypot.
- The Launch paste box stays gone. Rover writes the key.
- To turn one domain back off: `clearSiteTurnstileSecret`, clear `turnstileSiteKey`, ship, then delete the hostname from the widget only after the live page no longer loads Turnstile. Deleting the widget first makes the old page block the submit.
