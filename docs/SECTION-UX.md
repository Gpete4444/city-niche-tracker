# Section UX contracts (Home + Service)

Design + writer rules for Structure sections. Informed by contractor conversion research and Ippei Community training transcripts (`_video-review-ippei-audio/`).

## Global rules

- Mobile-first; primary CTA = call + estimate form.
- Full-bleed heroes; no cards or sticker badges on hero media.
- Avoid purple gradients, cream+terracotta cliché, glow, emoji.
- Alternating light surfaces; Areas + final CTA may use brand/ink.
- **socialProof** is treated as real site data (rating, licenses, stats, reviews). Seed defaults when empty so trust/reviews never look blank; AggregateRating emits when rating exists. Operator replaces values with owner data before launch — no demo banners or placeholder mode.
- Public service-area copy stays soft (“nearby communities” + suburb links). Do not put hard mile radii (“within 30 miles”) in visitor-facing sentences; `serviceRadiusMiles` may stay in config for ops/maps only.

### Type scale (not browser zoom)

- Root rem in `global.css`: **`html { font-size: 125%; }`** (~20px if the UA default is 16px). Matches original site type at Chrome 125% zoom, baked so you judge at **browser zoom 100%** only.
- Do **not** chase per-monitor zoom % or add a second mobile root zoom. Respect user zoom/accessibility.
- **H1** uses `.heading-display` (`clamp(1.75rem, 4.5vw, 3rem)`). **Section H2s** use `.heading-section` (`clamp(1.35rem, 3vw, 1.85rem)`). Body/labels stay stepped Tailwind (`text-sm` / `text-base`).
- Typical industry body is 16–18px; our body lands larger (~22px) on purpose for lead-gen readability. Captions stay smaller steps (`text-sm` / `text-xs`).
- **Half-screen / tablet:** hero copy + form stay **side-by-side only from `lg` (~1024px) up**. Below that they stack; compact LeadForm is **centered** (`mx-auto max-w-md`) so the card does not pin full-bleed left. Phone keeps the same stack + sticky call bar (`pb-24` on `body`). On phone, header/mid-page Call buttons are hidden — sticky bar is the call CTA; estimate buttons stay.
- **Equal card grids (`fitEqualGrid`):** always **1 column on phone**; target columns from `sm`/`lg` up (why 2×2 from sm; process/reviews denser only from tablet).

## Ippei copy rules (homepage first half)

1. Intro/hero body = **max ~2 concise paragraphs** — salesperson tone; humans skim.
2. **Central entity = the SERVICE** (install/replacement before repair when both matter). City is secondary — allow **one** natural primaryCity mention in intros; do not city-stuff every section lead.
3. Do **not** stuff streets/landmarks into the intro (hurts humans; confuses topical focus). Put geo flavor in `areas` / lower sections.
4. Unique entities = industry-specific materials, codes, equipment, techniques, **stats**.
5. Services blocks: one short entity-rich paragraph each.
6. Homepage title ≈ H1; high-ticket keywords left→right. Prefer a filled meta `description` (~140–160 chars: niche + city + offer terms + free estimates) — it doubles as the hero supporting line under H1; never multi-paragraph.
7. Homepage `tagline` (site-config) = the same shape: one SEO-sharp sentence, not a soft “surrounding communities” line.
8. AI draft workflow: add unique entities/stats → trim while keeping entities. Handcraft the intro.

## Human-speech pass (Content Editor + speech lint)

Content chain (eight-pass Soft path, all required): **Structure → Site research → Brief → Outline → batched Full write → Humanize (Passes 4–7) → Final check → Accept**.

- **Site research** — Claude JSON stand-in for Reddit/PAA/competitor angles (`*-content-field-research.json`). Optional operator notes enrich Brief only.
- **Content brief** — Pass 1 synthesis; must Load & confirm before Outline/Full write.
- **Outline** — Pass 2 strategic outline (shared guardrails + per-H2 angle / job-to-be-done).
- **Full write** — Pass 3 batched by Home / Services / Locations (tone variance); Continue merge for stubs.
- **Humanize / Editor** (`prompts/agents/content-editor.md`) — ordered Burstiness → Perplexity → Bookends → Conversion + findings. Optional **Copy bookends-only** is extra polish, not a skip.
- **Final check** — Pass 8; Accept blocked until `lastFinalCheckAt` is set.
- **Auto-fix** (`ops/lib/content-auto-fix.mjs`) runs on **Load FILE blocks** and **Speech check**: replaces AI stock phrases, strips leaked editor-prompt text, injects missing internal markdown links, and **drops off-niche homepage FAQs** (pets, civic trivia, unrelated appliances). No Anthropic call.
- **Speech lint** (`ops/lib/content-speech-lint.mjs`) flags remaining speech issues (including soft em-dash density). Speech check is required before Final check / Accept and **always shows a result modal**.
- **SEO lint** (`ops/lib/content-seo-lint.mjs`): primary keyword in title/h1, FAQ vs SERP PAA `faqSeeds`, **`faq_off_niche`**, internal links, soft **`missing_closing_cta`**. Critical SEO findings **block Accept** unless **Accept with SEO warnings** is checked.
- Outline is grounded from research: keyword volumes, `serp.peopleAlsoAskQuestions`, `serp.organicTitles`, plus confirmed brief + field research.
- Editor step includes **Paste + Load** for revised `### FILE:` blocks (no jump back to Full write).

### Entity matching {#entity-matching}

Rank & Rent sites should mirror what a future GBP will claim:

- **Home** = primary niche + city entity (head term in H1/title).
- **Services** = offer entities you actually deliver (no phantom menu).
- **Locations** = geo proof for real primary + suburb cities from site-config — not landmark page factories.
- Prefer supporting topics only when the Brief lists them; avoid weekly-blog sprawl.

Website → Launch (and Site-Config → Phone) offer an advisory **GBP category checklist** Claude paste — does not block Assemble.

### Stock image Pull (fail-soft)

- Pull / Re-pull **prefer** niche-relevant stock above the score floor; if nothing clears the floor, Rover still fills the slot with the **best unused** photo and grades it **Poor** (“Best available stock — review/replace”). Hard errors only when APIs return no unused photos or keys are missing.
- Niche hints live in [`ops/data/niche-image-profiles.json`](ops/data/niche-image-profiles.json). **Content → Image queries** (step 8, after Final check) is one Copy prompt listing every photo slot; Load saves per-slot queries plus a shared niche profile. Pull/Accept use those queries. Scoring still rejects off-niche stock. Advanced users may still hand-tune profile entries.
- **Photo groups:** Website → Review images can **Save photo group** (named, niche-scoped: stock, uploads, and ChatGPT before/after pairs; Save under Re-pull, Load under the dropdown — **{Niche} master** first). Load onto a later candidate in the same niche — only slots that exist on that site’s Structure are filled (role match, not a Structure copy); extra saved photos are unused; missing names stay empty. **Content → Load photo group** (optional step 9) can attach a **named** group so Accept copies those files, or **Skip** for a fresh stock Pull (Image queries required). If a niche master exists and you neither Load nor Skip, **Accept uses the master**. Logo and coverage map still generate per site on Accept; operator regenerate lives on Website → **Logo & Map**. **Prepare preview** upserts the candidate’s photos into the niche master. The Photo screen is an optional satellite for organizing groups; skipping it does not block the pipeline. Save named groups from Review images. Groups are local-only (`research/_photo-groups/`).

### Candidate recovery after FAQ / image forever fixes

1. Hard-refresh Rover.
2. Content → **Speech check** (auto-strips off-niche FAQs; Stage sanitize also places `Optional:` / `Customer prep:` under What’s included).
3. Website → **Pull photos** (confirm replace when all slots are full, or re-pull Camera hero + CIPP materials/process slots) so camera/permit gates apply.
4. **Prepare preview** → confirm FAQs + images → **Push**.

## E-E-A-T

- Proof lives in `socialProof` (trust strip + reviews) and About (`aboutStory`).
- Do not invent license ID numbers, founding years, or testimonials in Claude copy.
- When `socialProof` is empty, **Rover** seeds placeholders via `defaultPlaceholderSocialProof` / `buildGoogleStyleSocialProof` (site-config paste / content Load+Accept): exactly **3** Google-lookalike reviews (First + last initial, 2 bundled avatars + 1 initials circle, dates within ~1 week / ~2 weeks / ~1 month). Operator swaps with real GBP reviews before launch when available.
- Preset **C (Value SEO heavy)** is the ranking-focused default (includes reviews + educational sections).
- Editor must preserve socialProof while fixing speech/SEO issues.

## Social proof

Seed `socialProof` with rating, 2–3 stats, license line, and **exactly 3** Google-styled reviews (bundled avatars under `public/images/review-avatars/`). Operator replaces with owner credentials/reviews before launch. No dual placeholder/verified mode and no on-page demo notices.

## Home sections (canonical order)

| ID | Layout | Content |
|----|--------|---------|
| hero | Full-bleed; H1; short supporting line (tagline/description); form + phone | One SEO-sharp sentence under H1; soft “nearby communities” (no mile radius) |
| trust | Horizontal strip | Always filled from socialProof |
| intro | 2 paras (+ optional bullets) | Salesperson; one natural city mention OK; no landmark stuffing |
| services | Compact photo cards; ≤2 rows (6→3×2 or 8→4×2) | High-ticket first; full list via nav |
| whyChooseUs | 3–5 reasons mid-page; **`fitEqualGrid({ maxCols: 2 })` → 2×2 when 4 reasons** | Condensed; not a hero essay |
| process / offerProcess | Numbered step cards with photos (`process[].image` via Pull); **`fitEqualGrid` default max 4** (8 → 2×4 on lg) | Prefer 4/6/8 steps; short title + one short line (~8–14 words). **Mutual exclusion:** Services pages → `process` only; single-offer sites → `offerProcess`; never both. |
| cost | Wide ranges table (type / \$ range / included) + mini-CTA | 3–5 ballpark `$` bands; never a single fixed quote |
| materials | Process-style card grid (bordered/raised; 2-col tablet / 3-col desktop); optional full-bleed top photo; denser `text-sm` body; up to 6 thumbs | Industry materials + stats; never body `![]()` images |
| timeline | Vertical stage rail + duration chips | Realistic durations |
| codes | Checklist + disclaimer strip | Educational; verify locally |
| diyVsPro | Comparison table or two-column check lists | When DIY vs pro |
| whenToCall | Symptom bullets + CTA | Scenarios |
| areas | Brand band + suburb links | Primary home for geo entities; soft nearby language, not mile cutoffs |
| beforeAfter | Gallery + captions | ChatGPT homepage pairs (`gallery-ba-*`) |
| reviews | Google-style cards (avatar/initials, G, stars, verified, relative date, Read more) | From socialProof (seeded trio) |
| faqs | Left-aligned accordion | 6–10 PAA-style |
| cta | Ink band | Phone + estimate |

**Equal card grids:** Most equal box/card lists (services, process, reviews, related) use [`fitEqualGrid`](../src/lib/equal-grid.ts) with **default `maxCols: 4`** — no ragged last row; **1-col on phone**, then denser from `sm`/`lg` (8 items → 2×4 on large screens). **Why choose us** is an exception: `maxCols: 2` so four reasons stay **2×2 from `sm` up** (still stacked on phone).

## Service sections

Reuse the same typed layouts for cost/materials/timeline/codes/diy/whenToCall. `svcIntro` follows 2-paragraph service-entity rules. Service process/FAQs/cost live in **markdown body** (no FM copy arrays). `svcProcess` uses the same numbered step cards as homepage (`processImages[]` via Pull, one photo per step). Process H2s that match “Our {service} Process”, “Our … Approach”, or “How we …” classify as `process` (not a generic checkmark dump). `svcMaterials` uses the same Process-style card grid as homepage (`materialsImages[]` via Pull, up to 6 full-bleed top photos — bordered raised cards). `svcBeforeAfter` = homepage-style photo gallery from Website → ChatGPT import (`svc-ba-{slug}-*` / `beforeAfterImages`); show only when that service has a complete before+after pair — omit the section if either image is missing (no caption-only fallback). `svcCta` = short ink band above LeadForm.

## External LLM critique prompt

```text
You are a UX/UI + local SEO copy designer for city+niche lead-gen sites (Ippei-style).

Hard copy rules from training transcripts:
- Intro/hero body = max ~2 concise paragraphs; salesperson tone; humans skim
- Central entity = the SERVICE (repair+install etc.); city is secondary (one natural city mention OK)
- Hero under H1 / tagline / meta description = ONE sharp sentence (~140–160 chars), not an essay
- Do NOT stuff streets/landmarks into the intro
- Unique entities = industry-specific materials, codes, equipment, techniques, stats
- High-ticket keywords before low-ticket
- Homepage first half = short paragraphs, entity-rich; deeper local geo lower on page
- socialProof is real site data; AggregateRating when rating exists; no demo/placeholder banners
- Full-bleed hero; no hero cards/stickers; avoid purple/cream-terracotta clichés

For EACH section propose layout, content structure, mobile notes, Spanish Fork kitchen/bath example, and what to avoid.

HOME: hero, trust, intro, services, whyChooseUs, process, offerProcess, cost, materials, timeline, codes, diyVsPro, whenToCall, areas, beforeAfter, reviews, faqs, cta
SERVICE: svcHero, svcIntro, svcWhatsIncluded, svcProcess, svcCost, svcMaterials, svcTimeline, svcBeforeAfter, svcFaqs, svcDiyVsPro, svcWhenToCall, svcCodes, svcCta
```
