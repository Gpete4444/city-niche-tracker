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

Toolbar Sync GSC / Check ranks (and per-site Sync / Check) show a **progress bar** with `N/M · domain` while work runs; metrics buttons stay disabled until finished.

| Button | What it does |
| --- | --- |
| Connect GSC | OAuth; stores refresh token in `research/gsc-oauth.json` (shows waiting progress until Google returns) |
| Sync GSC | 28d clicks/impressions + ~90d daily series per site |
| Check ranks | All eligible sites; ≤5 keywords; Standard queue |
| Per-site Sync / Check / keywords | Same, scoped to one row |

Primary keyword defaults to `{niche} {city}` from hydrated site-config; edit up to 5 on the detail panel.

## Storage

| Path | Contents |
| --- | --- |
| `research/gsc-oauth.json` | OAuth tokens (gitignored) |
| `research/site-metrics/{siteId}.json` | GSC rollups, daily series, keyword history |

## Phase 2 (backlog)

Auto-create GSC Domain property + Cloudflare DNS TXT verify at Launch/Indexing so verification is not manual at hundreds of domains.
