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
 * @param {{ primaryCity?: string, niche?: string }} [site]
 * @returns {{ ok: boolean, findings: Array<{ file: string, section: string, rule: string, excerpt: string, suggestion: string }> }}
 */
export function lintContentSpeech(files, site = {}) {
  const findings = [];
  const city = String(site.primaryCity || '').trim();
  const niche = String(site.niche || '').trim();
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

      if (cityRe && leadPlain && cityRe.test(leadPlain) && isEducationalHeading(sec.heading)) {
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
        const matches = sec.body.match(new RegExp(escapeRegExp(city), 'gi')) || [];
        if (matches.length >= 3) {
          findings.push({
            file,
            section: sec.heading || '(body)',
            rule: 'city_density',
            excerpt: `“${city}” appears ${matches.length} times in this section`,
            suggestion: 'Reduce city name repetition; one light local cue is enough.',
          });
        }
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

function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}
