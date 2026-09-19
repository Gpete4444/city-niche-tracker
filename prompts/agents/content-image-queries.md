# Agent: Content Image queries

One prompt for every stock photo slot plus before/after generate prompts. Stock queries are for Unsplash / Pexels / Pixabay. Before/after prompts are full image-generation text (no people) for GPT Image / ChatGPT.

## Prompt

```text
You write TWO things for a home-service website: (A) STOCK SEARCH QUERIES for Unsplash/Pexels/Pixabay, (B) BEFORE/AFTER IMAGE-GENERATION PROMPTS for AI photos.

NICHE
{{NICHE}}

SERVICES (residential vs commercial lists)
{{SERVICES_JSON}}

PHOTO SLOTS — stock search only (use these keys exactly in slots)
{{SLOTS_JSON}}

BEFORE/AFTER SLOTS — full generate prompts (use these keys exactly in beforeAfter)
{{BA_SLOTS_JSON}}

GOOD PROFILE EXAMPLES (style only — do not copy their trades)
{{PROFILE_EXAMPLES_JSON}}

STOCK QUERY RULES (slots)
1. Every slot.query is a short visual phrase (4–10 words) that MUST include a distinctive trade word from the niche (e.g. drywall, gutter, tile) — never generic English alone (repair, sand, water, texture, cut, prime, mud).
2. Use each slot’s description (photo brief) plus label / material / processStep / service — the description says what the photo must show. Do not ignore it.
3. Service heroes: show THAT service being done or the finished trade result (Texture Matching → knockdown texture on interior drywall wall — never bottles, couches, phones, cars).
4. Process steps: rewrite poison verbs (sand → sanding joint compound on drywall; cut and prep → cut out damaged drywall; mud → joint compound on drywall seam).
5. Materials: product/tool close-up for this trade, prefixed with the trade word (drywall mesh tape, hopper gun spraying drywall texture) — never beauty primer, industrial chain, or empty macros.
6. Hero/intro: finished or in-progress work of THIS niche. If the slot’s setting is "commercial" (or the service is in commercialServices / named commercial-*), stage it in an office, retail, warehouse, or other commercial building — never a home living room. Residential slots stay in a home. Never street signs, beaches, oceans, mallorca, family movie night.
7. profile.tokens: distinctive trade words only (no repair, water, damage, matching, sand, texture as standalone tokens).
8. profile.requireNicheHit must be true.
9. profile.boost / kindHints: stock-searchable visual phrases that include a distinctive token.

BEFORE/AFTER PROMPT RULES (beforeAfter)
10. Do NOT reuse stock queries as before/after prompts. Use the slot description when present. Each before/after value is a full paragraph prompt for a documentary contractor photo (not CGI, not a real-estate listing). No people, no faces, no hands, no crew, no customers, no silhouettes.
11. Each BA key is a DIFFERENT building, room, layout, and defect. Never the same basement, window, or water heater twice. Home gallery (home:1) is the niche hero job. Each svc:* key is ONLY that service’s job (repair a hole ≠ skim a patch ≠ match wall texture ≠ water stain ≠ popcorn). Each BA slot has setting "commercial" or "residential". Commercial jobs (commercial-* names, commercialServices, or setting:"commercial") MUST be staged in a commercial building — office, retail, warehouse, storefront, lobby, or corridor. Never a living room, bedroom, dining room, or ordinary house for those keys.
12. inside.before = generate a BEFORE photo from scratch. inside.after = EDIT-THIS-PHOTO instructions (same crop, camera height, lens, white balance, furniture, floor; change only the service result). Same for outside.before / outside.after. Outside is a real exterior of THAT job, not a generic curb shot. After is an in-place edit of the Before JPEG, not a second interior.
13. No egress-window or window-well examples unless that service is actually egress / basement windows.
14. Distinctive trade words in every prompt. 4:3. No text/logos/watermarks.
15. Camera: phone or job-site still, available indoor light. BAN: golden hour, cinematic bokeh, blown-out windows, catalog/showroom staging, gibberish text on books or screens, centered “hero damage” product shots.
16. Defect anatomy must match THAT service. A drywall hole is thin paper-faced gypsum with an irregular tear, visible wood studs, and a real cavity — not a circular cartoon crater, not thick masonry/clay, not a neat rubble pile. An unfinished patch is tape and mud, not a hole. Mismatched texture is a smooth rectangle in knockdown/orange peel. Water damage is a brown stain and sag, not a crater.
17. After: same frame; finished believable repair of the same surface (compound/sand/paint match). BAN: white blob where the defect was, a new wall, a remodel, relighting, or a new camera angle.

Return JSON ONLY (no markdown fence unless the whole reply is one json fence):
{
  "profile": {
    "boost": ["phrase", "phrase"],
    "tokens": ["word", "word"],
    "requireNicheHit": true,
    "kindHints": {
      "hero": "…",
      "intro": "…",
      "process": "…",
      "materials": "…",
      "other": "…"
    }
  },
  "slots": {
    "SLOT_KEY": { "query": "visual search phrase" }
  },
  "beforeAfter": {
    "BA_KEY": {
      "room": "distinct room name (commercial building room when setting is commercial)",
      "inside": { "before": "full generate prompt", "after": "Edit this BEFORE photo…" },
      "outside": { "before": "full generate prompt", "after": "Edit this BEFORE photo…" }
    }
  }
}

Include a slots entry for EVERY photo slot key listed above. Include a beforeAfter entry for EVERY before/after key listed above (inside and outside, before and after). If PHOTO SLOTS is an empty array, omit slots or use {}. If BEFORE/AFTER SLOTS is an empty array, omit beforeAfter or use {}.
```
