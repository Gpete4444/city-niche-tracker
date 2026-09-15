# Launched Sites metrics (GSC + keyword ranks)

Phase 1 analytics on **Launched Sites**: Search Console traffic plus DataForSEO organic SERP ranks.

## Setup

Step-by-step keys (DataForSEO + GSC OAuth + Connect): [ENV-SETUP.md](ENV-SETUP.md) §1 and §7.

### DataForSEO (ranks)

Already used by research:

```env
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
```

Rank checks use **Standard queue** `serp/google/organic` (depth 20). Fund the SERP product.

### Google Search Console (traffic)

1. Google Cloud project → enable **Google Search Console API**.
2. OAuth consent screen (External + your Gmail as test user) with scope `webmasters.readonly`.
3. Create **Desktop** OAuth client (or Web app with the redirect below).
4. `.env`:

```env
GOOGLE_GSC_CLIENT_ID=
GOOGLE_GSC_CLIENT_SECRET=
```

5. Redirect URI Rover uses: `http://127.0.0.1:8787/api/gsc/oauth/callback`  
   If a Desktop client rejects it, switch to a **Web application** client and add that URI under Authorized redirect URIs.
6. Restart `npm run rover` → Launched Sites → **Connect GSC**.
7. Each live domain needs a verified **Domain** property under that Google account (DNS TXT). See [SITE-INDEXING.md](SITE-INDEXING.md).

## Operator actions

Toolbar Sync GSC / Check index / Check ranks (and per-site Sync / Check) show a **progress bar** with `N/M · domain` while work runs; metrics buttons stay disabled until finished.

| Button | What it does |
| --- | --- |
| Connect GSC | OAuth; stores refresh token in `research/gsc-oauth.json` (shows waiting progress until Google returns) |
| Sync GSC | 28d clicks/impressions, top queries/pages, ~90d daily series, sitemap submitted count. Does **not** update Indexed. |
| Check index | URL Inspection of each live sitemap URL (includes `/privacy`). First run ~5–30s per site; later runs skip URLs indexed in the last 7 days. |
| Check ranks | All eligible sites; ≤5 keywords; Standard queue |
| Per-site Sync / Check / keywords | Same, scoped to one row |

Primary keyword defaults to `{niche} {city}` from hydrated site-config; edit up to 5 on the detail panel.

**Pages** and **Words** on the table come from local markdown (`src/content/{pages,services,locations}` on the assembled tree, then staging, then accepted content). They refresh on Launched load — they do not wait for GSC.

**Indexed** is URL Inspection of sitemap URLs (`n/N`). Empty (`—`) until you run **Check index**. It is not the GSC Pages / Coverage report (Google has no API for those totals; `contents[].indexed` on the Sitemaps API is deprecated and always 0). The denominator includes `/privacy`, so it is usually **Pages + 1**. Hover the cell for last check time.

**GSC queries / pages** in the site detail are Search Analytics rows with impressions. A new domain with no search traffic will show an empty table even if pages exist. Tracked keywords + **Check ranks** still work before impressions.

## What GSC cannot return

| Need | Source |
| --- | --- |
| Pages report totals (13 indexed / 10 not indexed) and why-not-indexed reasons | GSC UI only |
| Per-URL index status | URL Inspection API — Rover **Check index** (sitemap URLs only; 2,000/day per property) |
| Pages on site / word count | Local markdown (above) |

## Storage

| Path | Contents |
| --- | --- |
| `research/gsc-oauth.json` | OAuth tokens (gitignored) |
| `research/site-metrics/{siteId}.json` | GSC rollups, daily series, top queries/pages, sitemap submitted, URL Inspection by URL, keyword history |

## Phase 2 (backlog)

Auto-create GSC Domain property + Cloudflare DNS TXT verify at Launch/Indexing so verification is not manual at hundreds of domains.
