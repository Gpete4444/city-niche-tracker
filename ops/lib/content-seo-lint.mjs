/**
 * Advisory + critical SEO lint for content drafts (keyword/PAA/links).
 * Critical findings can block Accept unless ignoreSeoWarnings.
 */

const TITLE_MAX = 60;

/**
 * @param {Record<string, string>} files
 * @param {{
 *   primaryKeyword?: string,
 *   supportingKeywords?: string[],
 *   faqSeeds?: string[],
 *   faqsEnabled?: boolean,
 *   requiredLinksByFile?: Record<string, string[]>,
 *   businessName?: string,
 *   niche?: string,
 *   primaryCity?: string,
 * }} [opts]
 * @returns {{ ok: boolean, findings: Array<{ severity: 'critical'|'soft', file: string, rule: string, excerpt: string, suggestion: string }> }}
 */
export function lintContentSeo(files, opts = {}) {
  const findings = [];
  const homeRel =
    Object.keys(files || {}).find((p) => /(^|\/)pages\/index\.md$/i.test(p)) ||
    'src/content/pages/index.md';
  const homeBody = files?.[homeRel] || files?.['pages/index.md'] || '';
  const businessName = String(opts.businessName || '').trim();
  const niche = String(opts.niche || '').trim();
  const primaryCity = String(opts.primaryCity || '').trim();

  const primary = String(opts.primaryKeyword || '').trim();
  if (primary && homeBody) {
    const fm = parseSimpleFrontmatter(homeBody);
    const hay = normalizeKw(`${fm.title || ''} ${fm.h1 || ''}`);
    if (!hay.includes(normalizeKw(primary))) {
      findings.push({
        severity: 'critical',
        file: homeRel,
        rule: 'primary_kw_missing_title_h1',
        excerpt: `title/h1 missing primary “${primary}”`,
        suggestion: 'Put the primary keyword (or a close variant) in homepage title and h1.',
      });
    }
  }

  const faqOpts = {
    niche: opts.niche || opts.primaryKeyword || '',
    primaryKeyword: opts.primaryKeyword || '',
    services: opts.services || [],
  };
  const faqSeeds = Array.isArray(opts.faqSeeds) ? opts.faqSeeds.filter(Boolean) : [];
  if (homeBody) {
    const questions = extractFaqQuestions(homeBody);
    for (const q of questions) {
      const off = classifyOffNicheFaq(q, faqOpts);
      if (!off) continue;
      findings.push({
        severity: off.severity,
        file: homeRel,
        rule: 'faq_off_niche',
        excerpt: q.slice(0, 120),
        suggestion:
          off.reason === 'deny'
            ? 'Remove city trivia / pets / civic / unrelated appliances — FAQs must be about the niche or services.'
            : 'Rewrite or remove: FAQ should mention the niche/service or a trade cue (cost, permit, timeline, DIY, method).',
      });
    }
    if (opts.faqsEnabled && faqSeeds.length) {
      const covered = faqSeeds.filter((seed) =>
        questions.some((q) => faqOverlap(seed, q) >= 0.45),
      );
      const ratio = covered.length / faqSeeds.length;
      if (questions.length < 4) {
        findings.push({
          severity: 'critical',
          file: homeRel,
          rule: 'faq_too_few',
          excerpt: `Only ${questions.length} FAQ question(s) found`,
          suggestion: 'Add 6–10 FAQ Q&As aligned to faqSeeds / PAA.',
        });
      } else if (ratio < 0.4) {
        findings.push({
          severity: 'critical',
          file: homeRel,
          rule: 'faq_seed_coverage',
          excerpt: `Only ${covered.length}/${faqSeeds.length} faqSeeds covered`,
          suggestion: 'Rewrite FAQ questions to match SERP PAA / outline faqSeeds topics.',
        });
      }
    }
  }

  for (const kw of opts.supportingKeywords || []) {
    const k = String(kw || '').trim();
    if (!k || !homeBody) continue;
    const headings = extractHeadings(homeBody);
    const hit = headings.some((h) => headingCoversKeyword(h, k));
    if (!hit) {
      const missing = missingKeywordTokens(headings, k);
      const missingNote = missing.length
        ? ` Missing token(s) across H2s: ${missing.join(', ')}.`
        : '';
      findings.push({
        severity: 'soft',
        file: homeRel,
        rule: 'supporting_kw_missing_h2',
        excerpt: `Supporting keyword “${k}” not in an H2`,
        suggestion: `Map supporting keywords into H2 headings where natural (all meaningful words of the phrase must appear in order in one H2; they need not be adjacent).${missingNote}`,
      });
    }
  }

  const required = opts.requiredLinksByFile || {};
  for (const [file, targets] of Object.entries(required)) {
    const body = files?.[file];
    if (!body || !targets?.length) continue;
    const hrefs = extractMarkdownHrefs(body);
    for (const target of targets) {
      const t = String(target || '').trim();
      if (!t) continue;
      const ok = hrefs.some((h) => hrefMatches(h, t));
      if (!ok) {
        findings.push({
          severity: 'soft',
          file,
          rule: 'missing_internal_link',
          excerpt: `Missing link to ${t}`,
          suggestion: `Add a markdown link to ${t} (e.g. [Label](${t})).`,
        });
      }
    }
  }

  // Closing CTA cues on home / contact / service pages
  const ctaRe = /call (us|now)|get (a )?free estimate|request (a )?quote|free estimate|contact us today/i;
  for (const [rel, raw] of Object.entries(files || {})) {
    if (!/\.md$/i.test(rel)) continue;
    const isHome = /(^|\/)pages\/index\.md$/i.test(rel);
    const isContact = /(^|\/)pages\/contact\.md$/i.test(rel);
    const isService = /(^|\/)services\//i.test(rel);
    if (!isHome && !isContact && !isService) continue;
    const body = stripFrontmatter(raw);
    if (!body.trim()) continue;
    if (!ctaRe.test(body)) {
      findings.push({
        severity: 'soft',
        file: rel,
        rule: 'missing_closing_cta',
        excerpt: 'No clear call / free-estimate CTA phrasing',
        suggestion:
          'Add a natural closing CTA (call now / free estimate) matching the page type — not a mid-paragraph banner.',
      });
    }
  }

  // Placeholder NAP leaked into copy (soft — Launch still hard-flags at go-live)
  const napRe =
    /\+1X{6,}|\+1XXXXXXXXXX|XXXXXXXXXX|leads@example\.com|@example\.com\b/i;
  for (const [rel, raw] of Object.entries(files || {})) {
    if (!/\.md$/i.test(rel) || !raw) continue;
    if (!napRe.test(raw)) continue;
    const m = String(raw).match(napRe);
    findings.push({
      severity: 'soft',
      file: rel,
      rule: 'placeholder_nap',
      excerpt: String(m?.[0] || 'placeholder NAP').slice(0, 80),
      suggestion:
        'Set a real phone/email in Site-Config (or provision Twilio), then replace placeholders in copy — do not invent NAP in Claude.',
    });
  }

  // Title length (same fullTitle rules as BaseLayout)
  for (const [rel, raw] of Object.entries(files || {})) {
    if (!/\.md$/i.test(rel)) continue;
    const fm = parseSimpleFrontmatter(raw);
    if (!fm.title) continue;
    const full = resolvePageTitle(fm.title, businessName, TITLE_MAX);
    if (full.length > TITLE_MAX) {
      findings.push({
        severity: 'soft',
        file: rel,
        rule: 'title_too_long',
        excerpt: `fullTitle ${full.length} chars (>${TITLE_MAX}): “${full.slice(0, 70)}…”`,
        suggestion:
          'Shorten page title (keyword lead ≤~50 chars). Prefer including brand in title, or accept keyword-only title — layout skips `| brand` when it would exceed 60.',
      });
    }
  }

  // Brand subject: niche-as-company when businessName is niche + Pros (etc.)
  if (businessName && niche && brandIsNichePlus(businessName, niche)) {
    const nicheEsc = escapeRegExp(niche);
    const subjectRe = new RegExp(
      `\\b${nicheEsc}\\b(?!\\s+Pros)\\s+(provides|manages|files|handles|offers|serves|helps|will)\\b`,
      'i',
    );
    const aboutRel =
      Object.keys(files || {}).find((p) => /(^|\/)pages\/about\.md$/i.test(p)) ||
      'src/content/pages/about.md';
    const contactRel =
      Object.keys(files || {}).find((p) => /(^|\/)pages\/contact\.md$/i.test(p)) ||
      'src/content/pages/contact.md';
    for (const rel of [homeRel, aboutRel, contactRel]) {
      const body = files?.[rel];
      if (!body) continue;
      const fm = parseSimpleFrontmatter(body);
      const h1 = String(fm.h1 || '');
      if (/about|contact/i.test(rel)) {
        const expectAbout = normalizeKw(`About ${businessName}`);
        const expectContact = normalizeKw(`Contact ${businessName}`);
        const h1n = normalizeKw(h1);
        if (/about/i.test(rel) && h1 && h1n !== expectAbout && !h1n.includes(normalizeKw(businessName))) {
          findings.push({
            severity: 'soft',
            file: rel,
            rule: 'about_h1_missing_brand',
            excerpt: `About h1 should use full business name (“About ${businessName}”)`,
            suggestion: `Set h1 to About ${businessName}.`,
          });
        }
        if (
          /contact/i.test(rel) &&
          h1 &&
          h1n !== expectContact &&
          !h1n.includes(normalizeKw(businessName))
        ) {
          findings.push({
            severity: 'soft',
            file: rel,
            rule: 'contact_h1_missing_brand',
            excerpt: `Contact h1 should use full business name (“Contact ${businessName}”)`,
            suggestion: `Set h1 to Contact ${businessName}.`,
          });
        }
      }
      const prose = stripFrontmatter(body);
      if (subjectRe.test(prose)) {
        findings.push({
          severity: 'soft',
          file: rel,
          rule: 'niche_as_company_subject',
          excerpt: `Body uses niche “${niche}” as company subject — use “${businessName}” when the company acts`,
          suggestion: `Replace niche-as-subject with the full business name (${businessName}).`,
        });
      }
    }
  }

  // Primary location vs homepage cannibalization
  if (primaryCity && homeBody) {
    const slug = slugify(primaryCity);
    const locRel =
      Object.keys(files || {}).find((p) =>
        new RegExp(`(^|/)locations/${escapeRegExp(slug)}\\.md$`, 'i').test(p),
      ) || `src/content/locations/${slug}.md`;
    const locBody = files?.[locRel];
    if (locBody) {
      const homeFm = parseSimpleFrontmatter(homeBody);
      const locFm = parseSimpleFrontmatter(locBody);
      const homeKey = normalizeKw(`${homeFm.title || ''} ${homeFm.h1 || ''}`);
      const locKey = normalizeKw(`${locFm.title || ''} ${locFm.h1 || ''}`);
      const headExample = suggestPrimaryLocationHead(niche, primaryCity);
      if (homeKey && locKey && (homeKey === locKey || titleTooSimilar(homeKey, locKey))) {
        findings.push({
          severity: 'soft',
          file: locRel,
          rule: 'primary_location_cannibalizes_home',
          excerpt: 'Primary city location title/h1 too similar to homepage',
          suggestion: `Differentiate primary location title AND h1 (e.g. “${headExample}”, keep ≤~50 chars) — home owns the head “niche in city” term.`,
        });
      }
      const locHead = `${locFm.title || ''} ${locFm.h1 || ''}`;
      if (
        niche &&
        /\bservice areas?\b|\bneighborhoods?\b/i.test(locHead) &&
        !locationHeadHasNicheSignal(locHead, niche)
      ) {
        findings.push({
          severity: 'soft',
          file: locRel,
          rule: 'location_h1_missing_niche',
          excerpt: `Location title/h1 is geo-only (“${(locFm.h1 || locFm.title || '').slice(0, 80)}”)`,
          suggestion: `Include niche signal in location title/h1 (e.g. “${headExample}”).`,
        });
      }
    }
  }

  // Hollow What’s included (only Optional / Customer prep)
  for (const rel of Object.keys(files || {})) {
    if (!/services\/.+\.md$/i.test(rel)) continue;
    const raw = files[rel];
    if (!raw || !/what'?s included|what is included|\bscope\b/i.test(raw)) continue;
    const section = extractIncludedSection(raw);
    if (!section) continue;
    const bullets = section
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[-*•]\s+/.test(l) || /^\d+[.)]\s+/.test(l));
    if (!bullets.length) continue;
    const content = bullets.filter(
      (l) => !/^\s*[-*•]\s+(?:\*\*)?(?:Optional|Customer prep)(?:\*\*)?\s*[:—–-]/i.test(l),
    );
    if (content.length === 0) {
      findings.push({
        severity: 'critical',
        file: rel,
        rule: 'whats_included_hollow',
        excerpt: 'What’s included has only Optional / Customer prep — missing real scope bullets',
        suggestion:
          'Add at least 3 scope bullets (diagnosis, estimate, labor/materials/cleanup); Optional/prep may follow.',
      });
    }
  }

  lintLocationDepth(files, findings, {
    minWords: Number(opts.locationMinWords) > 0 ? Number(opts.locationMinWords) : 450,
    strict: opts.strictLocationDepth !== false,
  });
  lintMaterialsSpecificity(files, findings, {
    enabled: opts.materialsEnabled !== false,
  });

  const critical = findings.filter((f) => f.severity === 'critical');
  return { ok: critical.length === 0, findings };
}

/**
 * @param {Record<string, string>} files
 * @param {Array} findings
 * @param {{ minWords?: number, strict?: boolean }} opts
 */
function lintLocationDepth(files, findings, opts = {}) {
  const minWords = opts.minWords || 450;
  const strict = opts.strict !== false;
  const locEntries = Object.entries(files || {}).filter(([rel]) => /locations\/.+\.md$/i.test(rel));
  if (locEntries.length < 1) return;

  const bodies = locEntries.map(([rel, raw]) => {
    const body = stripFrontmatter(raw);
    return { rel, body, words: countWords(body), tokens: tokenSet(body) };
  });

  for (const row of bodies) {
    if (row.words < minWords) {
      findings.push({
        severity: strict ? 'critical' : 'soft',
        file: row.rel,
        rule: 'location_body_thin',
        excerpt: `Location body ~${row.words} words (min ${minWords})`,
        suggestion:
          'Expand local notes with climate/housing/neighborhood cues unique to this city (use City context; do not invent). Target ~600+ words across loc* sections.',
      });
    }
  }

  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const a = bodies[i];
      const b = bodies[j];
      if (a.words < 80 || b.words < 80) continue;
      const sim = jaccard(a.tokens, b.tokens);
      if (sim >= 0.72) {
        findings.push({
          severity: strict ? 'critical' : 'soft',
          file: a.rel,
          rule: 'location_bodies_near_duplicate',
          excerpt: `Near-duplicate of ${b.rel} (similarity ~${Math.round(sim * 100)}%)`,
          suggestion:
            'Rewrite local notes/proof so each location FILE has distinct housing, climate, or neighborhood cues — do not swap only the city name.',
        });
      }
    }
  }
}

/**
 * Soft: materials bullets that are only vague “professional grade” with no method/product tokens.
 */
function lintMaterialsSpecificity(files, findings, opts = {}) {
  if (opts.enabled === false) return;
  const METHOD_RE =
    /\b(primer|epoxy|urethane|alkyd|hvlp|cipp|liner|pvc|abs|cast iron|quartz|granite|polyurea|membrane|vapor|shellac|conversion varnish|soft-?close|stainless|copper|pex|camera|cctv|jetting|hydro)\b/i;
  const VAGUE_ONLY_RE = /professional[\s-]?grade|high[\s-]?quality|premium|industry[\s-]?standard/i;

  for (const [rel, raw] of Object.entries(files || {})) {
    if (!/(pages\/index\.md|services\/.+\.md)$/i.test(rel)) continue;
    const section = extractMaterialsSection(raw);
    if (!section) continue;
    const bullets = section
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[-*•]\s+/.test(l) || /^\d+[.)]\s+/.test(l));
    if (bullets.length < 2) continue;
    const vague = bullets.filter((l) => VAGUE_ONLY_RE.test(l) && !METHOD_RE.test(l));
    const concrete = bullets.filter((l) => METHOD_RE.test(l));
    if (vague.length >= 2 && concrete.length === 0) {
      findings.push({
        severity: 'soft',
        file: rel,
        rule: 'materials_lacks_concrete_methods',
        excerpt: 'Materials bullets lack named products/methods (only vague “professional grade” language)',
        suggestion:
          'Name concrete systems/products suited to local climate (e.g. primer type, finish system, liner material) — not “professional grade” alone.',
      });
    }
  }
}

function countWords(text) {
  return String(text || '')
    .replace(/[#>*_`[\]()|-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

function tokenSet(text) {
  const stop = new Set([
    'the',
    'and',
    'for',
    'with',
    'from',
    'your',
    'our',
    'near',
    'area',
    'this',
    'that',
    'are',
    'is',
    'in',
    'to',
    'of',
    'a',
    'an',
    'we',
    'you',
    'or',
    'as',
    'on',
    'at',
  ]);
  const set = new Set();
  for (const t of normalizeKw(text).split(' ')) {
    if (t.length > 2 && !stop.has(t)) set.add(t);
  }
  return set;
}

function jaccard(a, b) {
  if (!a?.size || !b?.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

function extractMaterialsSection(src) {
  const body = stripFrontmatter(src);
  const parts = body.split(/^##\s+/m);
  for (const chunk of parts) {
    const nl = chunk.indexOf('\n');
    const heading = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
    if (/^materials\b|materials and|methods we|\bmethods\b/i.test(heading)) {
      return nl < 0 ? '' : chunk.slice(nl + 1);
    }
  }
  return '';
}

export function normalizeKw(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NICHE_FILLER = new Set([
  'remodeling',
  'remodel',
  'services',
  'service',
  'installation',
  'install',
  'pros',
  'company',
  'contractors',
  'contractor',
]);

/**
 * Short niche phrase for location titles (drops filler like Remodeling/Services).
 * @param {string} niche
 */
export function compressNichePhrase(niche) {
  let s = String(niche || '').trim();
  if (!s) return '';
  s = s.replace(/\bBathroom\b/gi, 'Bath');
  const parts = s.split(/\s+/).filter(Boolean);
  const kept = [];
  for (const p of parts) {
    const n = normalizeKw(p);
    if (!n || NICHE_FILLER.has(n)) continue;
    if (p === '&' || n === 'and') {
      if (kept.length) kept.push('&');
      continue;
    }
    kept.push(p === 'Bath' || /^bath$/i.test(p) ? 'bath' : p);
  }
  let out = kept.join(' ').replace(/\s+&\s+/g, ' & ').trim();
  if (!out) {
    out = parts.slice(0, 3).join(' ').trim();
  }
  // Prefer lowercase for mid-title flow except we return display-ish short form
  return out.replace(/\bbath\b/gi, 'bath');
}

const HEAD_MAX = 50;

/**
 * Primary-location title/h1 example that fits title_too_long budget (≤50 lead)
 * and differentiates from homepage “niche in city”.
 * @param {string} niche
 * @param {string} primaryCity
 */
export function suggestPrimaryLocationHead(niche, primaryCity) {
  const city = String(primaryCity || '').trim() || 'City';
  const short = compressNichePhrase(niche) || 'local';
  const candidates = [
    `${city} ${short} neighborhoods`,
    `${short} neighborhoods in ${city}`,
    `${city} neighborhoods (${short})`,
  ];
  for (const c of candidates) {
    if (c.length <= HEAD_MAX) return c;
  }
  // Truncate shortest candidate on word boundary
  let best = candidates.sort((a, b) => a.length - b.length)[0];
  if (best.length <= HEAD_MAX) return best;
  const words = best.split(/\s+/);
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > HEAD_MAX) break;
    out = next;
  }
  return out || city.slice(0, HEAD_MAX);
}

/**
 * Niche present in location head: full niche, compressed phrase, or ≥2 distinctive tokens.
 * @param {string} locHead
 * @param {string} niche
 */
export function locationHeadHasNicheSignal(locHead, niche) {
  const h = normalizeKw(locHead);
  const n = String(niche || '').trim();
  if (!n) return true;
  if (!h) return false;
  if (h.includes(normalizeKw(n))) return true;
  const compressed = normalizeKw(compressNichePhrase(n));
  if (compressed && h.includes(compressed)) return true;
  const stop = new Set(['and', 'the', 'for', 'in', 'of', 'a', 'an', 'to', 'our', 'with']);
  const tokens = normalizeKw(n)
    .split(' ')
    .filter((t) => t.length > 2 && !stop.has(t) && !NICHE_FILLER.has(t));
  // Also accept "bath" as covering "bathroom"
  const hits = tokens.filter((t) => {
    if (h.includes(t)) return true;
    if (t === 'bathroom' && h.includes('bath')) return true;
    return false;
  });
  if (!tokens.length) return h.includes(normalizeKw(n));
  return hits.length >= Math.min(2, tokens.length);
}

/** Meaningful keyword tokens (length > 2) for order-preserving H2 coverage. */
export function keywordTokens(keyword) {
  return normalizeKw(keyword)
    .split(' ')
    .filter((t) => t.length > 2);
}

/**
 * True when an H2 covers a supporting keyword:
 * - contiguous normalized substring, OR
 * - every meaningful token appears in the H2 as an order-preserving subsequence
 *   (e.g. "sewer line replacement west jordan" matches
 *   "Sewer Line Replacement Cost in West Jordan").
 */
export function headingCoversKeyword(heading, keyword) {
  const h = normalizeKw(heading);
  const k = normalizeKw(keyword);
  if (!k) return true;
  if (!h) return false;
  if (h.includes(k)) return true;
  const tokens = keywordTokens(keyword);
  if (!tokens.length) return h.includes(k);
  let from = 0;
  for (const token of tokens) {
    const idx = h.indexOf(token, from);
    if (idx < 0) return false;
    from = idx + token.length;
  }
  return true;
}

/** Tokens from keyword that no single homepage H2 covers (for suggestions). */
function missingKeywordTokens(headings, keyword) {
  const tokens = keywordTokens(keyword);
  if (!tokens.length) return [];
  // Prefer tokens missing from the best partial match (fewest missing)
  let bestMissing = tokens;
  for (const heading of headings || []) {
    const h = normalizeKw(heading);
    const missing = [];
    let from = 0;
    for (const token of tokens) {
      const idx = h.indexOf(token, from);
      if (idx < 0) missing.push(token);
      else from = idx + token.length;
    }
    if (missing.length < bestMissing.length) bestMissing = missing;
    if (!bestMissing.length) break;
  }
  return bestMissing;
}

function normalizeBrandKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(pros|llc|inc|co|company|services|service)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleContainsBrand(title, businessName) {
  const t = String(title || '');
  const brand = String(businessName || '').trim();
  if (!brand) return false;
  if (t.includes(brand)) return true;
  const tn = normalizeBrandKey(t);
  const bn = normalizeBrandKey(brand);
  return Boolean(bn && tn.includes(bn));
}

/** Same rules as src/lib/page-title.ts resolvePageTitle. */
export function resolvePageTitle(title, businessName, maxLen = TITLE_MAX) {
  const t = String(title || '').trim();
  const brand = String(businessName || '').trim();
  if (!t) return brand;
  if (!brand || titleContainsBrand(t, brand)) return t;
  const withBrand = `${t} | ${brand}`;
  if (withBrand.length <= maxLen) return withBrand;
  return t;
}

function brandIsNichePlus(businessName, niche) {
  const b = normalizeKw(businessName);
  const n = normalizeKw(niche);
  if (!b || !n || b === n) return false;
  return b.includes(n);
}

function titleTooSimilar(a, b) {
  const ta = new Set(a.split(' ').filter((w) => w.length > 2));
  const tb = new Set(b.split(' ').filter((w) => w.length > 2));
  if (!ta.size || !tb.size) return false;
  let hit = 0;
  for (const w of ta) if (tb.has(w)) hit += 1;
  const overlap = hit / Math.min(ta.size, tb.size);
  return overlap >= 0.85;
}

function parseSimpleFrontmatter(src) {
  const t = String(src || '').replace(/^\uFEFF/, '');
  if (!t.startsWith('---')) return {};
  const end = t.indexOf('\n---', 3);
  if (end < 0) return {};
  const block = t.slice(3, end);
  const out = {};
  const title = block.match(/^title:\s*(.+)$/m);
  const h1 = block.match(/^h1:\s*(.+)$/m);
  if (title) out.title = unquote(title[1]);
  if (h1) out.h1 = unquote(h1[1]);
  return out;
}

function extractIncludedSection(src) {
  const body = String(src || '').replace(/^---[\s\S]*?---\n?/, '');
  const parts = body.split(/^##\s+/m);
  for (const chunk of parts) {
    const nl = chunk.indexOf('\n');
    const heading = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
    if (/what'?s included|what is included|\bscope\b/i.test(heading)) {
      return nl < 0 ? '' : chunk.slice(nl + 1);
    }
  }
  return '';
}

function unquote(s) {
  return String(s || '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

/** Civic / pet / appliance trivia that must never ship as niche FAQs. */
const FAQ_OFF_NICHE_DENY_RE =
  /\b(dogs?|cats?|pets?|mayor|council|city\s+council|famous for|water heater|appliance|school district|zip codes?|animal services)\b/i;

/** Trade / offer cues that keep a FAQ on-niche even with weak keyword overlap. */
const TRADE_FAQ_CUE_RE =
  /\b(cost|price|pricing|permit|timeline|how long|diy|camera|trenchless|cipp|repair|replace|replacement|insurance|warranty|lining|bursting|hydro|jetting|estimate|inspection|clean(?:ing)?|root|sewer|drain|pipe|plumb)\b/i;

/**
 * @param {string} question
 * @param {{ niche?: string, primaryKeyword?: string, services?: string[] }} [opts]
 * @returns {{ severity: 'critical'|'soft', reason: 'deny'|'no_overlap' }|null}
 */
export function classifyOffNicheFaq(question, opts = {}) {
  const q = String(question || '').trim();
  if (!q || q.length < 8) return null;
  if (FAQ_OFF_NICHE_DENY_RE.test(q)) return { severity: 'critical', reason: 'deny' };

  const hayParts = [
    opts.niche,
    opts.primaryKeyword,
    ...(Array.isArray(opts.services) ? opts.services : []),
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  const nicheTokens = new Set(
    normalizeKw(hayParts.join(' '))
      .split(' ')
      .filter((w) => w.length > 2 && !/^(the|and|for|with|from|your|our|near|area)$/.test(w)),
  );
  const qTokens = new Set(
    normalizeKw(q)
      .split(' ')
      .filter((w) => w.length > 2),
  );
  let overlap = 0;
  for (const t of nicheTokens) if (qTokens.has(t)) overlap += 1;

  if (overlap === 0 && !TRADE_FAQ_CUE_RE.test(q)) {
    return { severity: 'soft', reason: 'no_overlap' };
  }
  return null;
}

export function isFaqQuestionOffNiche(question, opts = {}) {
  return Boolean(classifyOffNicheFaq(question, opts));
}

function extractFaqQuestions(src) {
  const questions = [];
  const t = String(src || '');
  for (const m of t.matchAll(/^\s*-\s*question:\s*(.+)$/gim)) {
    questions.push(unquote(m[1]));
  }
  for (const m of t.matchAll(/^#{2,3}\s+(.+\?)\s*$/gm)) {
    questions.push(m[1].trim());
  }
  for (const line of t.split('\n')) {
    const s = line.trim();
    if (s.endsWith('?') && s.length > 12 && !s.startsWith('#') && !s.startsWith('-')) {
      questions.push(s);
    }
  }
  return [...new Set(questions)];
}

function extractHeadings(src) {
  const body = stripFrontmatter(src);
  return [...body.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1].trim());
}

function extractMarkdownHrefs(src) {
  const hrefs = [];
  for (const m of String(src || '').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    hrefs.push(m[1].trim());
  }
  return hrefs;
}

function hrefMatches(href, target) {
  const a = String(href || '').split(/[?#]/)[0].replace(/\/$/, '') || '/';
  const b = String(target || '').split(/[?#]/)[0].replace(/\/$/, '') || '/';
  return a === b || a.endsWith(b) || b.endsWith(a);
}

function faqOverlap(seed, question) {
  const a = new Set(normalizeKw(seed).split(' ').filter((w) => w.length > 2));
  const b = new Set(normalizeKw(question).split(' ').filter((w) => w.length > 2));
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit += 1;
  return hit / a.size;
}

function stripFrontmatter(src) {
  const t = String(src || '').replace(/^\uFEFF/, '');
  if (!t.startsWith('---')) return t;
  const end = t.indexOf('\n---', 3);
  if (end < 0) return t;
  return t.slice(end + 4).replace(/^\r?\n/, '');
}

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build required internal link map from outline pages + site config.
 */
export function buildRequiredLinksByFile(files, config, outline = {}) {
  const pageIds = new Set(outline.pageIds || outline.pages?.map((p) => p.id) || []);
  const out = {};
  const homeRel =
    Object.keys(files || {}).find((p) => /(^|\/)pages\/index\.md$/i.test(p)) ||
    'src/content/pages/index.md';
  if (files?.[homeRel] || files?.['pages/index.md']) {
    const key = files?.[homeRel] ? homeRel : 'pages/index.md';
    const need = ['/contact'];
    if (pageIds.has('about') || true) need.push('/about');
    const services = Array.isArray(config?.services) ? config.services : [];
    for (const svc of services.slice(0, 4)) {
      const name = typeof svc === 'string' ? svc : svc?.name;
      const slug = slugify(name);
      if (slug) need.push(`/services/${slug}`);
    }
    if (pageIds.has('locations')) {
      const primary = String(config?.primaryCity || '').trim();
      if (primary) {
        const pslug = slugify(primary);
        if (pslug) need.push(`/locations/${pslug}`);
      }
      for (const sub of (config?.targetSuburbs || []).slice(0, 4)) {
        const slug = slugify(typeof sub === 'string' ? sub : sub?.name || sub?.city);
        if (slug) need.push(`/locations/${slug}`);
      }
    }
    out[key] = [...new Set(need)];
  }

  for (const rel of Object.keys(files || {})) {
    if (!/services\/[^/]+\.md$/i.test(rel)) continue;
    out[rel] = ['/', '/contact'];
  }
  return out;
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
