# Site indexing strategies

Operator guide for getting Rover lead-gen sites **discovered, crawled, and indexed** after Launch. Forever doc — applies to every candidate, not one assembled tree.

**Indexing ≠ ranking.** This doc covers getting pages into Google’s index. On-page content quality and page-1 readiness: [SEO-RATING.md](SEO-RATING.md). Launch mechanics: [LAUNCH.md](LAUNCH.md).

---

## How long does Google take?

There is **no guaranteed timeline**. Request indexing is a nudge, not a promise.

| Case | Typical timeline | Notes |
| --- | --- | --- |
| Fast | Hours to 1–2 days | Domain already crawled often, strong backlinks, or GSC URL Inspection → Request indexing on key URLs |
| Typical new domain (homepage) | **3–14 days** | New domain, normal discovery via sitemap + links |
| Typical new domain (long-tail pages) | **2–6 weeks** | Service/location pages ride sitemap + internal links |
| Steady crawl rate on new domain | Often **8–16 weeks** | Zero-authority domains stay conservative until crawl demand rises |
| Slow / never | Months, or not at all | No sitemap/links, thin/dupe content, `noindex` / robots blocks, soft 404s |

**Fastest case (hours to 1–2 days):** Google already crawls the domain frequently (existing site, strong backlink profile), or you manually submit key URLs via Search Console URL Inspection and request indexing.

**Typical case (1–4 weeks for first useful set):** New domain, little authority, relying on sitemap + normal crawl discovery.

**Slow case (months, or never):** No sitemap submitted, no internal/external links, thin or duplicate content, or technical blocks (`robots.txt`, `noindex`, broken canonicals).

---

## What speeds it up

1. **Google Search Console — Domain property** — Verify with DNS TXT (covers `www` + apex). Prefer Domain over a single URL-prefix property.
2. **Submit `sitemap.xml` once** — `https://{domain}/sitemap.xml` under Indexing → Sitemaps. Do **not** re-submit daily.
3. **Accurate `lastmod`** — Bump only when content actually changed. Fake sitewide bumps get ignored.
4. **Request indexing on money pages day one** — Homepage + top **2–3** service pages via URL Inspection. Soft daily quota is roughly **10–12 URLs** per property; don’t burn it on every suburb page.
5. **At least one external discovery link** — GBP website field, citation/directory, or social profile pointing at the live domain.
6. **Flat internal linking** — Every important URL reachable within a few clicks from the homepage (What we do → service pages → related services).
7. **Crawlable HTML** — Rover Astro sites are server-rendered; main copy is in the initial HTML (better than JS-only SPAs for Googlebot).
8. **Optional parallel (not a Google substitute)** — Bing Webmaster Tools + IndexNow helps Bing / some AI-search discovery. Still do GSC for Google.

---

## What slows or blocks it

- **`robots.txt` or accidental `noindex`** — Staging settings leaking to production.
- **No unique content** — Duplicate/boilerplate pages get deprioritized; thin location clones struggle.
- **Orphan pages** — URLs only in the sitemap, never linked from the site.
- **JavaScript-only content** — Harder when meaningful copy isn’t in the initial HTML (less of an issue for Rover builds).
- **Brand-new domains with zero backlinks** — Often sit in “Discovered / Crawled — currently not indexed” until quality and crawl demand improve (soft “sandbox” behavior; Google doesn’t use that name officially).
- **Spammy resubmits** — Repeated Request indexing on the same URL, or daily sitemap re-submits, do not help. Google deprecated the old sitemap ping endpoint.
- **Google Indexing API misuse** — Officially for `JobPosting` / `BroadcastEvent` (livestream). Not a general lead-gen shortcut for service pages.

---

## GSC Page indexing emails (“new reasons preventing indexing”)

Google emails when a **new reason type first appears** on a property — not on a weekday or a day-of-month calendar. Page indexing data lags **~2–3 days**. Verifying many Domain properties on one Google account makes the same notification type land in one inbox around the same time after Google’s first crawl snapshot.

[Page indexing report](https://support.google.com/webmasters/answer/7440203): **Not indexed is not always a bug.** Duplicate or alternate URLs should not be indexed.

| GSC reason | Expected on Rover sites? | What to do |
| --- | --- | --- |
| **Alternate page with proper canonical tag** | No for `www` after the worker 301. An old crawl can still list it until it ages out. | Do **not** Validate fix. Do not add a second page. |
| **Page with redirect** | Yes — one email per new property. `http://` → `https://`, slashless → trailing slash, `www` → apex | Healthy. Google will keep probing those URLs. Do **not** Validate fix. |
| **Not found (404)** | Only for URLs that are not on the site (old or guessed). Sitemap and on-site links must be 200. | Ignore. Do **not** Validate fix and do not invent a page for the URL. |
| **Crawled – currently not indexed** | Sometimes on new domains / thin location URLs | Wait; unique copy; citations. Only worry if **money pages** stay here for weeks. |
| **Discovered – currently not indexed** | New URLs Google has not crawled yet | Normal for long-tail; don’t bulk Request indexing. |
| **5xx, noindex, a robots.txt that Disallows the site, sitemap listing the wrong host** | No — fix immediately | Real blockers. |
| **LIVE TEST: Robots.txt unreachable** on a site that just launched | Common on day one. The file can still open in a normal browser. | Request indexing from the **GOOGLE INDEX** tab. Do not treat the DevTools 404 on `search.google.com` as this site. |

Launch turns on zone **Always Use HTTPS**, Full SSL, and HSTS when the API token has Zone Settings Edit (soft-skip otherwise). The Worker **301s `http://` → `https://`, `www` → apex, and slashless HTML paths → a trailing slash** in one hop, so those URLs never serve HTML. Launch still attaches **www** plus apex so the www hostname can redirect instead of failing DNS. Sites use **trailing slashes everywhere** (`https://{domain}/about/`, homepage `https://{domain}/`). Coverage-map cities without a real `/locations/{id}/` page link to `/contact/` — they must not invent location URLs. `*.workers.dev` sends `X-Robots-Tag: noindex`.

Real problems: 5xx, accidental `noindex`, robots blocks, sitemap URLs that are not the HTTPS canonical, or crawled-not-indexed on the **homepage / top services** for weeks.

---

## Rover day-one checklist

After **Run launch** (or **Push updates** when already live), open **Website → 5 · Indexing**:

1. **Confirm live crawl files**
   - Open `https://{domain}/sitemap.xml` — URLs and host match this site (pipeline emits sitemap via [`src/integrations/ensure-sitemap-xml.mjs`](../src/integrations/ensure-sitemap-xml.mjs)). Rover’s Indexing step has **Open sitemap**.
   - Open `https://{domain}/robots.txt` — allows crawlers; `Sitemap:` line points at **this** domain ([`src/pages/robots.txt.ts`](../src/pages/robots.txt.ts)).
2. **Google Search Console**
   - **1. Submit to Search Console** verifies the Domain property (Cloudflare DNS TXT) and submits `https://{domain}/sitemap.xml` once.
   - **2. Copy URL and open Search Console** copies the homepage and opens that property’s URL Inspection page. Stay on **GOOGLE INDEX**. Click **REQUEST INDEXING**. When the green **Indexing requested** box appears, click **Dismiss**. **URL is not on Google** stays until Google crawls it.
   - Click **Inspect any URL in "{domain}"**, paste a service URL, press Enter, click **REQUEST INDEXING**, then **Dismiss**. Repeat for the top 2–3 service pages only.
   - **LIVE TEST** can say **Failed: Robots.txt unreachable** on a new domain even when the file returns 200. That page has no Dismiss. The circular arrow next to **Tested on** only retests. If the request is rejected, open the domain in Cloudflare → **Security** → **Settings** → **Bot traffic** and leave **Bot fight mode** off.
   - **3. Mark done** saves the step. After that, the indexing buttons stay closed. Submit does not remain available for a later rebuild.
3. **External pointer** — Set GBP website (when you have it) and any planned citations to the live URL. In Rover **Website → Launch**, use **Citations** checklist + **Download NAP CSV** so directory forms match site-config.
4. **Stop thrashing** — Wait. Monitor Page indexing; don’t resubmit the whole site every day. Mark Indexing **done** in Rover when finished. Rover saves that check on candidate meta (`indexingDone`); it survives reload and re-select, and Push updates does not clear it.

**Citations and head-term speed:** On-page SEO (titles, FAQs, service/location graph) is necessary but not sufficient for competitive “niche + city” queries. GBP + consistent NAP citations are the usual off-page path — Rover does not invent backlinks at Assemble.

---

## Week 2–8 monitoring

| Signal | What to do |
| --- | --- |
| Homepage indexed; services trickling in | Normal — keep internal links strong; don’t spam requests |
| Many URLs **Discovered — currently not indexed** past ~21 days | Improve depth/uniqueness, internal links, earn a real backlink — **don’t** bulk Request indexing |
| **Crawled — currently not indexed** | Quality / usefulness signal; fix content or consolidate thin pages. Coverage-map towns without a location page must link to `/contact/`, not a fake `/locations/` URL. |
| **Page with redirect** on `http://`, slashless, or `www` | Expected — do not Validate fix |
| **Alternate page with proper canonical tag** or **Not found (404)** on a URL that is not in the sitemap | Old or guessed URL — do not Validate fix and do not add a page |
| Sitemap “Success” but Indexed count stuck near zero | Recheck `noindex`, canonicals, soft 404s, wrong host in sitemap |
| After **Push updates** (content/template change) | Rely on accurate `lastmod`; Request indexing only for edited money pages |

Meaningful rankings for competitive local terms often take **months** after first index — that’s ranking work (content, GBP, links), not more indexing buttons.

---

## After verify — traffic & ranks in Rover

Once the Domain property is verified under the Google account you connect to Rover:

1. Gear → **Account setup** → paste the Search Console client ID and secret and **Save** (or put `GOOGLE_GSC_CLIENT_ID` and `GOOGLE_GSC_CLIENT_SECRET` in `.env` and restart). Desktop OAuth client; Search Console API enabled. Redirect URI: `http://127.0.0.1:8787/api/gsc/oauth/callback`.
2. **Launched Sites → Connect GSC** → approve Search Console and Site Verification access. Finish login with the Gmail you added as a test user. If an older login was read-only, Connect GSC again.
3. **Sync GSC** pulls trailing 28-day totals for the cards and 90 days of daily points for the Launched charts.
4. **Check index** inspects each sitemap URL (Indexed column). First run is slower; later runs skip URLs indexed in the last 7 days.
5. **Check ranks** (or per-site **Check ranks**) uses DataForSEO Standard-queue organic SERP for up to 5 keywords (primary auto = `{niche} {city}`). Needs existing `DATAFORSEO_*` credentials.

Tokens live in `research/gsc-oauth.json`; per-site series in `research/site-metrics/` (both under gitignored `research/`).

**Indexing submit:** Website → Indexing → **Submit to Search Console** creates the Domain property, writes the Cloudflare DNS TXT record, and submits the sitemap once. Request indexing stays manual.

---

## Myths to skip

- Re-submitting the sitemap every day to “force” a crawl
- Request indexing on every service and location URL in one session
- Using the Google Indexing API for normal service / city pages
- Expecting rankings (or even full-site index) the week of first homepage index
- Assuming IndexNow / Bing covers Google

---

## Related

- Launched Sites GSC + ranks: [SITES-METRICS.md](SITES-METRICS.md)
- Content SEO letter grade: [SEO-RATING.md](SEO-RATING.md)
- Pipeline overview: [MASTER-FLOW.md](MASTER-FLOW.md)
- Launch / Push updates: [LAUNCH.md](LAUNCH.md)
- Assemble + deploy runbook: [ASSEMBLE-AND-LAUNCH.md](ASSEMBLE-AND-LAUNCH.md)
