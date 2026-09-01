/**
 * Deterministic human-speech lint for content draft markdown.
 * Advisory only — Content Editor LLM still rewrites.
 */

const AI_STOCK_PHRASES = [
  /\bdelve\b/i,
  /\btapestry\b/i,
  /\belevate your\b/i,
  /\blandscape of\b/i,
  /\bwhen it comes to\b/i,
  /\bin today'?s world\b/i,
  /\bit is important to note\b/i,
  /\bin the realm of\b/i,
  /\bnavigating the\b/i,
  /\bunlock the potential\b/i,
  /\bseamless(ly)?\b/i,
  /\bcomprehensive suite\b/i,
  /\bleverage\b/i,
  /\brobust\b/i,
  /\bcutting-edge\b/i,
];

const STIFF_LEAD_RE =
  /^(typical stages for|these .+ ballparks|when it comes to|in today'?s world|looking for .+ in .+ projects)/i;

/**
 * @param {Record<string, string>} files - relative path → markdown body
 * @param {{ primaryCity?: string, niche?: string, businessName?: string }} [site]
 * @returns {{ ok: boolean, findings: Array<{ file: string, section: string, rule: string, excerpt: string, suggestion: string }> }}
 */
export function lintContentSpeech(files, site = {}) {
  const findings = [];
  const city = String(site.primaryCity || '').trim();
  const niche = String(site.niche || '').trim();
  const businessName = String(site.businessName || '').trim();
  const cityRe = city
    ? new RegExp(
        `\\b(?:for|in|across)\\s+${escapeRegExp(city)}(?:['']s)?(?:\\s+/\\s+[\\w\\s]+)?(?:\\s+${escapeRegExp(niche)})?\\b`,
        'i',
      )
    : null;

  for (const [file, raw] of Object.entries(files || {})) {
    if (!raw || typeof raw !== 'string') continue;
    const body = stripFrontmatter(raw);
    if (!body.trim()) continue;

    const sections = splitByHeadings(body);
    for (const sec of sections) {
      const paras = sec.body
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);
      const lead = paras[0] || '';
      const leadPlain = lead.replace(/^[-*•]\s+/, '').replace(/\*\*/g, '');

      for (const re of AI_STOCK_PHRASES) {
        if (re.test(sec.body)) {
          const m = sec.body.match(re);
          findings.push({
            file,
            section: sec.heading || '(lead)',
            rule: 'ai_stock_phrase',
            excerpt: clip(m?.[0] || re.source, 80),
            suggestion: 'Replace AI stock phrasing with plain contractor speech.',
          });
          break;
        }
      }

      if (leadPlain && STIFF_LEAD_RE.test(leadPlain)) {
        findings.push({
          file,
          section: sec.heading || '(lead)',
          rule: 'stiff_section_lead',
          excerpt: clip(leadPlain, 120),
          suggestion:
            'Use a natural human opener (e.g. how a typical project unfolds) — avoid template leads.',
        });
      }

      if (
        cityRe &&
        leadPlain &&
        isEducationalHeading(sec.heading) &&
        isCityStuffedProseLead(leadPlain, city, cityRe)
      ) {
        findings.push({
          file,
          section: sec.heading || '(lead)',
          rule: 'city_stuffed_lead',
          excerpt: clip(leadPlain, 120),
          suggestion:
            'Drop city stuffing from mid-page leads; keep city in H1/H2 and areas.',
        });
      }

      for (const p of paras) {
        if (p.startsWith('#') || p.startsWith('-') || p.startsWith('*')) continue;
        const words = p.split(/\s+/).filter(Boolean).length;
        if (words > 80) {
          findings.push({
            file,
            section: sec.heading || '(body)',
            rule: 'long_paragraph',
            excerpt: clip(p, 100),
            suggestion: 'Prefer 1–3 short sentences per paragraph.',
          });
          break;
        }
      }

      if (city && isEducationalHeading(sec.heading)) {
        const matches = countCityMentions(sec.body, city, businessName);
        if (matches >= 5) {
          findings.push({
            file,
            section: sec.heading || '(body)',
            rule: 'city_density',
            excerpt: `“${city}” appears ${matches} times in this section`,
            suggestion: 'Reduce city name repetition; one light local cue is enough.',
          });
        }
      }

      const proseForEmDash = stripStructuredLabelDashLines(sec.body);
      if (/[—\u2014]/.test(proseForEmDash)) {
        const m = proseForEmDash.match(/[^.\n]{0,40}[—\u2014][^.\n]{0,40}/);
        findings.push({
          file,
          section: sec.heading || '(body)',
          rule: 'em_dash',
          excerpt: clip(m?.[0] || '—', 100),
          suggestion:
            'Replace prose em dashes (—) with commas or periods (en-dash OK in numeric ranges). Keep required **Label** — process/cost/timeline/materials bullets.',
        });
      }
    }
  }

  // Dedupe similar findings
  const seen = new Set();
  const unique = [];
  for (const f of findings) {
    const key = `${f.file}|${f.section}|${f.rule}|${f.excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(f);
  }

  return { ok: unique.length === 0, findings: unique };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripFrontmatter(src) {
  const t = String(src || '').replace(/^\uFEFF/, '');
  if (!t.startsWith('---')) return t;
  const end = t.indexOf('\n---', 3);
  if (end < 0) return t;
  return t.slice(end + 4).replace(/^\r?\n/, '');
}

function splitByHeadings(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const chunks = [];
  let heading = '';
  let buf = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (heading || text) chunks.push({ heading, body: text });
    heading = '';
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(/^#{1,2}\s+(.+)$/);
    if (m) {
      flush();
      heading = m[1].trim();
      continue;
    }
    buf.push(line);
  }
  flush();
  return chunks.length ? chunks : [{ heading: '', body: String(body || '').trim() }];
}

function isEducationalHeading(heading) {
  const t = String(heading || '').toLowerCase();
  if (!t) return false;
  return /cost|how long|timeline|materials|permit|code|diy|when to call|hiring a pro/.test(t);
}

function countCityMentions(text, city, businessName) {
  let hay = String(text || '');
  if (businessName) {
    hay = hay.replace(new RegExp(escapeRegExp(businessName), 'gi'), '');
  }
  return (hay.match(new RegExp(`\\b${escapeRegExp(city)}\\b`, 'gi')) || []).length;
}

/** True stuffing: city in the first ~12 words of a prose lead — not a materials climate cue. */
function isCityStuffedProseLead(leadPlain, city, cityRe) {
  const lead = String(leadPlain || '').trim();
  if (!lead || !city || !cityRe) return false;
  if (isStructuredLabelDashLine(lead) || /^\s*[-*+]\s+/.test(lead)) return false;
  const climate = new RegExp(
    `\\b${escapeRegExp(city)}['']s\\s+(?:rain|damp|weather|climate|housing|moisture)\\b`,
    'i',
  );
  if (climate.test(lead) && !cityRe.test(lead.replace(climate, ' '))) return false;
  const first12 = lead.split(/\s+/).slice(0, 12).join(' ');
  return cityRe.test(first12);
}

/**
 * Drop Rover-required structured bullets that use Label — desc (process, cost, timeline, materials).
 * Remaining text is checked for prose em dashes only.
 */
function stripStructuredLabelDashLines(body) {
  return String(body || '')
    .split('\n')
    .filter((line) => !isStructuredLabelDashLine(line))
    .join('\n');
}

/** `- **Title** — desc` or `**Tier** — $low–$high — …` (em or en dash after bold label). */
function isStructuredLabelDashLine(line) {
  const t = String(line || '');
  // Optional list marker, bold label (may include a markdown link), then em/en dash
  return /^\s*(?:[-*+]\s+)?\*\*.+?\*\*\s+[—–\u2013\u2014]\s+/.test(t);
}

function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}
