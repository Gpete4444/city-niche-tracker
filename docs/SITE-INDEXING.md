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

## Rover day-one checklist

After **Run launch** (or **Push updates** when already live), open **Website → Indexing** (step 4):

1. **Confirm live crawl files**
   - Open `https://{domain}/sitemap.xml` — URLs and host match this site (pipeline emits sitemap via [`src/integrations/ensure-sitemap-xml.mjs`](../src/integrations/ensure-sitemap-xml.mjs)). Rover’s Indexing step has **Copy sitemap URL** / **Open sitemap**.
   - Open `https://{domain}/robots.txt` — allows crawlers; `Sitemap:` line points at **this** domain ([`src/pages/robots.txt.ts`](../src/pages/robots.txt.ts)).
2. **Google Search Console**
   - Add / verify **Domain** property (DNS TXT). Use **Open Search Console** in Indexing.
   - Indexing → Sitemaps → submit `https://{domain}/sitemap.xml`.
   - URL Inspection → **Request indexing** on homepage + top 2–3 service pages.
3. **External pointer** — Set GBP website (when you have it) and any planned citations to the live URL. In Rover **Website → Launch**, use **Citations** checklist + **Download NAP CSV** so directory forms match site-config.
4. **Stop thrashing** — Wait. Monitor Page indexing; don’t resubmit the whole site every day. Mark Indexing **done** in Rover when finished. Rover saves that check on candidate meta (`indexingDone`); it survives reload and re-select, and Push updates does not clear it.

**Citations and head-term speed:** On-page SEO (titles, FAQs, service/location graph) is necessary but not sufficient for competitive “niche + city” queries. GBP + consistent NAP citations are the usual off-page path — Rover does not invent backlinks at Assemble.

---

## Week 2–8 monitoring

| Signal | What to do |
| --- | --- |
| Homepage indexed; services trickling in | Normal — keep internal links strong; don’t spam requests |
| Many URLs **Discovered — currently not indexed** past ~21 days | Improve depth/uniqueness, internal links, earn a real backlink — **don’t** bulk Request indexing |
| **Crawled — currently not indexed** | Quality / usefulness signal; fix content or consolidate thin pages |
| Sitemap “Success” but Indexed count stuck near zero | Recheck `noindex`, canonicals, soft 404s, wrong host in sitemap |
| After **Push updates** (content/template change) | Rely on accurate `lastmod`; Request indexing only for edited money pages |

Meaningful rankings for competitive local terms often take **months** after first index — that’s ranking work (content, GBP, links), not more indexing buttons.

---

## After verify — traffic & ranks in Rover

Once the Domain property is verified under the Google account you connect to Rover:

1. Add `GOOGLE_GSC_CLIENT_ID` + `GOOGLE_GSC_CLIENT_SECRET` to `.env` (Desktop OAuth client; Search Console API enabled). Redirect URI: `http://127.0.0.1:8787/api/gsc/oauth/callback`.
2. Restart Rover → **Launched Sites → Connect GSC** → approve read-only Search Console access.
3. **Sync GSC** pulls trailing 28d clicks/impressions (+ daily series for charts).
4. **Check ranks** (or per-site **Check ranks now**) uses DataForSEO Standard-queue organic SERP for up to 5 keywords (primary auto = `{niche} {city}`). Needs existing `DATAFORSEO_*` credentials.

Tokens live in `research/gsc-oauth.json`; per-site series in `research/site-metrics/` (both under gitignored `research/`).

**Phase 2 (backlog):** auto-create GSC Domain property + Cloudflare DNS TXT verify at Launch/Indexing so operators don’t do step 2 manually at scale.

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
