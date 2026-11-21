# Launched Sites metrics (GSC + keyword ranks)

Analytics on **Launched**: Search Console traffic, DataForSEO organic SERP ranks, and Indexed snapshots from Check index. Metrics are stored **per site**; the four charts add up the current checkbox set (or all listed sites if none are checked).

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
2. OAuth consent screen (External + your Gmail as test user) with scopes `webmasters` and `siteverification`. Enable the Site Verification API in the same project. Connect GSC again if the saved token is still read-only.
3. Create **Desktop** OAuth client (or Web app with the redirect below).
4. `.env`:

```env
GOOGLE_GSC_CLIENT_ID=
GOOGLE_GSC_CLIENT_SECRET=
```

5. Redirect URI Rover uses: `http://127.0.0.1:8787/api/gsc/oauth/callback`  
   If a Desktop client rejects it, switch to a **Web application** client and add that URI under Authorized redirect URIs.
6. Restart `npm run rover` → Launched Sites → **Connect GSC**.
7. Website → Indexing → **Submit to Search Console** verifies each live domain (DNS TXT) and submits its sitemap. See [SITE-INDEXING.md](SITE-INDEXING.md).

## Operator actions

Toolbar Sync GSC (and per-site Sync / Check) shows a **progress bar** with `N/M · domain` while work runs. Check index runs up to 4 sites at a time and shows `done/total` plus the domains in flight. Check ranks posts every selected keyword first and shows how many keywords are ready. Metrics buttons stay disabled until finished.

| Button | What it does |
| --- | --- |
| Connect GSC | OAuth; stores refresh token in `research/gsc-oauth.json` (shows waiting progress until Google returns) |
| Sync GSC | 28d clicks/impressions, top queries/pages, ~90d daily series, sitemap submitted count. Does **not** update Indexed. |
| Check index | URL Inspection of each live sitemap URL (includes `/privacy`). Multi-site runs 4 sites at a time; URLs inside a site stay sequential. First run ~5–30s of inspection work per site; later runs skip URLs indexed in the last 7 days. Each successful run appends one Indexed snapshot for that calendar day (later checks that day replace). |
| Check ranks | DataForSEO Standard organic SERP (depth 20), up to 5 keywords. Multi-site posts every keyword first and collects them in one queue wait. Cost is unchanged. |
| Per-site Sync / Check / keywords | Same, scoped to one row |

Primary keyword defaults to `{niche} {city}` from hydrated site-config; edit up to 5 on the detail panel.

**Pages** and **Words** on the table come from local markdown (`src/content/{pages,services,locations}` on the assembled tree, then staging, then accepted content). They refresh on Launched load — they do not wait for GSC.

**Indexed** is URL Inspection of sitemap URLs (`n/N`). Empty (`—`) until you run **Check index**. It is not the GSC Pages / Coverage report (Google has no API for those totals; `contents[].indexed` on the Sitemaps API is deprecated and always 0). The denominator includes `/privacy`, so it is usually **Pages + 1**. Hover the cell for last check time. Check index also writes `inspectHistory` — one snapshot per calendar day. Google has no indexed-over-time API, so the Indexed chart only moves when you run Check index on a later day.

**Charts** (impressions, clicks, sites on page 1, indexed URLs) use a contiguous calendar. Hover a day for the date and values. A new site with no impressions does not extend the axis or crash the line to zero. Each chart skips sites missing that series and names them in a warning (Sync GSC / Check ranks / Check index). Below the cards, **Pages by type** and **Top queries** roll up the current checkbox set (city names fold into `{city}`). The site detail Traffic chart uses two Y-axes (clicks left, impressions right); its query and page tables sort on the column header.

**Pull cadence.** Impressions, clicks, CTR, and sites with impressions come from **Sync GSC**, which already asks Search Console for the last 90 days by date. One pull backfills that history — weekly (or whenever you open Launched) is enough. Google lags 1–3 days on the right edge; those days are a dotted line (data still landing), not a traffic crash. **Primary on page 1** and **Indexed URLs** cannot be backfilled: each **Check ranks** / **Check index** is one point. Dots mark check days; a faint line is last known, not a daily measurement. Check ranks weekly (or when you care about a cluster). Check index when you ship or weekly. The Indexed toggle stays on **Sites with impressions** until there are two Check index days; a single seeded snapshot is not a trend.

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
| `research/site-metrics/{siteId}.json` | GSC rollups, daily series, top queries/pages, sitemap submitted, URL Inspection by URL, Indexed snapshots (`inspectHistory`), keyword history |

## Indexing submit

Website → Indexing → **Submit to Search Console** creates the Domain property, writes the Cloudflare DNS TXT record, and submits `sitemap.xml` once. Request indexing stays a manual step on that property’s URL Inspection page.
