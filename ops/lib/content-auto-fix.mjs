/**
 * Deterministic auto-fix for speech stock phrases, leaked editor prompts,
 * missing soft internal links, broken body images, and heading grammar. No LLM.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { buildRequiredLinksByFile, isFaqQuestionOffNiche } from './content-seo-lint.mjs';

const STOCK_REPLACEMENTS = [
  { re: /\bdelve(?:s|d|ing)?\s+into\b/gi, to: 'look into' },
  { re: /\bdelve(?:s|d|ing)?\b/gi, to: 'look into' },
  { re: /\btapestry\b/gi, to: 'mix' },
  { re: /\belevate your\b/gi, to: 'improve your' },
  { re: /\blandscape of\b/gi, to: 'world of' },
  { re: /\bwhen it comes to\b/gi, to: 'for' },
  { re: /\bin today'?s world\b/gi, to: 'today' },
  { re: /\bit is important to note that\b/gi, to: '' },
  { re: /\bit is important to note\b/gi, to: '' },
  { re: /\bin the realm of\b/gi, to: 'in' },
  { re: /\bnavigating the\b/gi, to: 'handling the' },
  { re: /\bunlock the potential\b/gi, to: 'get more from' },
  { re: /\bseamlessly\b/gi, to: 'smoothly' },
  { re: /\bseamless\b/gi, to: 'smooth' },
  { re: /\bcomprehensive suite\b/gi, to: 'full set' },
  { re: /\bleverage\b/gi, to: 'use' },
  { re: /\brobust\b/gi, to: 'solid' },
  { re: /\bcutting-edge\b/gi, to: 'modern' },
];

const PROMPT_LEAK_LINE =
  /return the same ###\s*file|fix speech lint findings|speech lint findings|seo lint findings|kill ai tells|read-aloud test for every|output only ###\s*file|you are the content editor|archetype:|draft file blocks:/i;

const BODY_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * @param {Record<string, string>} files
 * @param {{ config?: object, outline?: object, requiredLinksByFile?: Record<string, string[]>, imageDirs?: string[], rootDir?: string }} [opts]
 * @returns {{ files: Record<string, string>, changes: Array<{ file: string, rule: string, kind: 'speech'|'seo', detail: string }>, speechCount: number, seoCount: number }}
 */
export function autoFixContentDraft(files, opts = {}) {
  const next = { ...(files || {}) };
  const changes = [];
  const config = opts.config || {};
  const outline = opts.outline || {};
  const required =
    opts.requiredLinksByFile || buildRequiredLinksByFile(next, config, outline);
  const imageDirs = Array.isArray(opts.imageDirs) ? opts.imageDirs.filter(Boolean) : [];
  const rootDir = opts.rootDir || process.cwd();

  for (const [rel, raw] of Object.entries(next)) {
    if (!raw || typeof raw !== 'string') continue;
    let body = raw;

    // Strip leaked editor prompt BEFORE stock replacements (avoids false hits on "Kill AI tells" lists)
    const leak = stripPromptLeakage(body);
    if (leak.changed) {
      body = leak.body;
      changes.push({
        file: rel,
        rule: 'prompt_leak',
        kind: 'speech',
        detail: `Removed leaked editor/prompt text (${leak.removed} block(s))`,
      });
    }

    const stock = applyStockReplacements(body);
    if (stock.changed) {
      body = stock.body;
      for (const detail of stock.details) {
        changes.push({ file: rel, rule: 'ai_stock_phrase', kind: 'speech', detail });
      }
    }

    const images = stripBannedBodyImages(body, { imageDirs, rootDir });
    if (images.changed) {
      body = images.body;
      changes.push({
        file: rel,
        rule: 'body_image',
        kind: 'seo',
        detail: images.detail,
      });
    }

    const grammar = polishServiceHeadingGrammar(body);
    if (grammar.changed) {
      body = grammar.body;
      for (const detail of grammar.details) {
        changes.push({ file: rel, rule: 'heading_grammar', kind: 'speech', detail });
      }
    }

    const processUnpack = unpackPackedProcessSections(body);
    if (processUnpack.changed) {
      body = processUnpack.body;
      changes.push({
        file: rel,
        rule: 'process_steps_packed',
        kind: 'speech',
        detail: `Unpacked ${processUnpack.count} packed process step(s) into list lines`,
      });
    }

    const longSplit = splitLongProseParagraphs(body);
    if (longSplit.changed) {
      body = longSplit.body;
      changes.push({
        file: rel,
        rule: 'long_paragraph',
        kind: 'speech',
        detail: `Split ${longSplit.count} long paragraph(s) into shorter blocks`,
      });
    }

    if (/(^|\/)services\/.+\.md$/i.test(rel)) {
      const introStrip = stripServiceIntroH2(body, outline);
      if (introStrip.changed) {
        body = introStrip.body;
        changes.push({
          file: rel,
          rule: 'svcintro_h2',
          kind: 'speech',
          detail: `Stripped intro H2 “${introStrip.heading}” (unmarked intro)`,
        });
      }
    }

    const permitSwap = swapReversedPermitColumns(body);
    if (permitSwap.changed) {
      body = permitSwap.body;
      changes.push({
        file: rel,
        rule: 'permit_columns',
        kind: 'speech',
        detail: 'Swapped permit columns so “Usually needs a permit” comes first',
      });
    }

    if (/(^|\/)pages\/index\.md$/i.test(rel)) {
      const faqStrip = stripOffNicheHomepageFaqs(body, {
        niche: config.niche,
        primaryKeyword: outline.keywords?.primary || outline.keywordTargets?.[0]?.keyword || config.niche,
        services: [
          ...(Array.isArray(config.services) ? config.services : []),
          ...(Array.isArray(config.commercialServices) ? config.commercialServices : []),
        ],
      });
      if (faqStrip.changed) {
        body = faqStrip.body;
        changes.push({
          file: rel,
          rule: 'faq_off_niche',
          kind: 'seo',
          detail: `Removed ${faqStrip.removed.length} off-niche FAQ(s): ${faqStrip.removed
            .slice(0, 3)
            .map((q) => q.slice(0, 48))
            .join('; ')}${faqStrip.removed.length > 3 ? '…' : ''}`,
        });
      }
    }

    next[rel] = body;
  }

  // Link injection after speech fixes so we operate on final bodies
  for (const [rel, targets] of Object.entries(required)) {
    if (!next[rel] || !targets?.length) continue;
    const injected = injectMissingLinks(next[rel], targets, config, rel);
    if (injected.changed) {
      next[rel] = injected.body;
      for (const detail of injected.details) {
        changes.push({
          file: rel,
          rule: 'missing_internal_link',
          kind: 'seo',
          detail,
        });
      }
    }
  }

  const speechCount = changes.filter((c) => c.kind === 'speech').length;
  const seoCount = changes.filter((c) => c.kind === 'seo').length;
  return { files: next, changes, speechCount, seoCount };
}

function imageSrcExists(src, { imageDirs, rootDir }) {
  const s = String(src || '')
    .trim()
    .replace(/\\/g, '/');
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  const rel = s.replace(/^\//, '').replace(/^public\//, '');
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length) return false;
  if (existsSync(path.join(rootDir, 'public', ...parts))) return true;
  const fileName = parts[parts.length - 1];
  for (const dir of imageDirs) {
    if (existsSync(path.join(dir, fileName))) return true;
    if (parts[0] === 'images' && existsSync(path.join(dir, ...parts.slice(1)))) return true;
  }
  return false;
}

/**
 * Body `![]()` is banned (frontmatter/Pull only). Strip all body images.
 */
function stripBannedBodyImages(src, opts) {
  const { fm, body } = splitFrontmatter(src);
  BODY_IMAGE_RE.lastIndex = 0;
  if (!BODY_IMAGE_RE.test(body)) return { body: src, changed: false, detail: '' };
  BODY_IMAGE_RE.lastIndex = 0;
  let missing = 0;
  let total = 0;
  const nextBody = body
    .replace(BODY_IMAGE_RE, (_m, _alt, imgSrc) => {
      total += 1;
      if (!imageSrcExists(imgSrc, opts)) missing += 1;
      return '';
    })
    .replace(/\n{3,}/g, '\n\n');
  if (nextBody === body) return { body: src, changed: false, detail: '' };
  const detail =
    missing > 0
      ? `Removed ${total} body image(s) (${missing} missing on disk)`
      : `Removed ${total} body image markdown slot(s) (use Pull/frontmatter only)`;
  return {
    body: fm != null ? `---\n${fm}\n---\n${nextBody.replace(/^\n+/, '')}` : nextBody,
    changed: true,
    detail,
  };
}

/** Light singularize for heading polish (Remodels → Remodel). */
function lightSingularize(name) {
  let t = String(name || '').trim();
  if (!t) return t;
  t = t.replace(/\bRemodels\b/g, 'Remodel').replace(/\bremodels\b/g, 'remodel');
  t = t.replace(/\bServices\b/g, 'Service').replace(/\bservices\b/g, 'service');
  t = t.replace(/\bKitchens\b/g, 'Kitchen').replace(/\bkitchens\b/g, 'kitchen');
  t = t.replace(/\bBathrooms\b/g, 'Bathroom').replace(/\bbathrooms\b/g, 'bathroom');
  if (/\w{3,}s$/i.test(t) && !/(ss|us|is|oes|ches|shes)$/i.test(t)) {
    t = t.replace(/s$/i, '');
  }
  return t;
}

function polishServiceHeadingGrammar(src) {
  const { fm, body } = splitFrontmatter(src);
  const details = [];
  let next = body;

  next = next.replace(
    /^(#{1,3}\s+)What does (?!a\s)(.+?) cost( in .+)?\?\s*$/gim,
    (full, hashes, subj, loc) => {
      const polished = `${hashes}What does a ${lightSingularize(subj)} cost${loc || ''}?`;
      if (polished !== full) details.push('Heading grammar → “What does a …”');
      return polished;
    },
  );

  next = next.replace(
    /^(#{1,3}\s+)How long does (?!a\s)(.+?) take\?\s*$/gim,
    (full, hashes, subj) => {
      const polished = `${hashes}How long does a ${lightSingularize(subj)} take?`;
      if (polished !== full) details.push('Heading grammar → “How long does a …”');
      return polished;
    },
  );

  if (!details.length) return { body: src, changed: false, details };
  return {
    body: fm != null ? `---\n${fm}\n---\n${next.replace(/^\n+/, '')}` : next,
    changed: true,
    details,
  };
}

/** Title — description starts used by service process cards (and packed mega-paragraphs). */
const PROCESS_STEP_START_RE =
  /(?:^|[\n\r]| (?=[A-Z]))([A-Z][A-Za-z0-9/'&]*(?:\s+(?:and|&|\/|of|for|the|a|an|[A-Za-z0-9/'&]+)){0,7})\s+[—–-]\s+/g;

function countProcessStepStarts(text) {
  const t = String(text || '');
  PROCESS_STEP_START_RE.lastIndex = 0;
  return [...t.matchAll(PROCESS_STEP_START_RE)].length;
}

function looksLikeProcessHeading(heading) {
  return /process\s+works/i.test(String(heading || ''));
}

/**
 * Split a packed process paragraph into `- **Title** — description` list lines.
 * Preserves a leading intro when it appears before the first step title.
 */
function unpackProcessParagraph(para) {
  const raw = String(para || '').trim();
  if (!raw) return { text: para, changed: false, count: 0 };

  // Already a list block starting with -/* — normalize step lines only if packed on one bullet
  if (/^[-*•]\s/.test(raw)) {
    const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
    // Single list item that packs many Title — segments → unpack
    if (lines.length === 1 && countProcessStepStarts(lines[0]) >= 2) {
      const stripped = lines[0].replace(/^[-*•]\s+/, '').replace(/\*\*/g, '');
      const steps = extractPackedProcessSteps(stripped);
      if (steps?.length >= 2) {
        return {
          text: steps.map((s) => `- **${s.title}** — ${s.description}`).join('\n'),
          changed: true,
          count: steps.length,
        };
      }
    }
    // Multi-line list that is already one step per line — leave
    return { text: para, changed: false, count: 0 };
  }

  const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
  // One step per line (no list markers) → promote to list lines
  if (lines.length >= 2) {
    const asSteps = lines.map((line) => parseOneProcessStepLine(line)).filter(Boolean);
    if (asSteps.length >= 2 && asSteps.length === lines.length) {
      return {
        text: asSteps.map((s) => `- **${s.title}** — ${s.description}`).join('\n'),
        changed: true,
        count: asSteps.length,
      };
    }
  }

  if (countProcessStepStarts(raw) < 2) {
    return { text: para, changed: false, count: 0 };
  }

  const stripped = raw.replace(/\*\*/g, '');
  PROCESS_STEP_START_RE.lastIndex = 0;
  const first = PROCESS_STEP_START_RE.exec(stripped);
  if (!first) return { text: para, changed: false, count: 0 };

  const intro = stripped.slice(0, first.index).trim();
  const fromFirst = stripped.slice(first.index).trim();
  const steps = extractPackedProcessSteps(fromFirst);
  if (!steps || steps.length < 2) return { text: para, changed: false, count: 0 };

  const list = steps.map((s) => `- **${s.title}** — ${s.description}`).join('\n');
  return {
    text: intro ? `${intro}\n\n${list}` : list,
    changed: true,
    count: steps.length,
  };
}

function parseOneProcessStepLine(line) {
  const cleaned = String(line || '')
    .replace(/^[-*•]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\*\*/g, '')
    .trim();
  const em = cleaned.match(/^(.+?)\s+[—–-]\s+(.+)$/);
  if (em) return { title: em[1].trim(), description: em[2].trim() };
  const colon = cleaned.match(/^(.+?):\s+(.+)$/);
  if (colon && colon[1].split(/\s+/).length <= 8) {
    return { title: colon[1].trim(), description: colon[2].trim() };
  }
  return null;
}

function extractPackedProcessSteps(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return null;
  PROCESS_STEP_START_RE.lastIndex = 0;
  const matches = [...cleaned.matchAll(PROCESS_STEP_START_RE)];
  if (matches.length < 2) return null;

  const steps = [];
  for (let i = 0; i < matches.length; i++) {
    const title = String(matches[i][1] || '').trim();
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : cleaned.length;
    const description = cleaned.slice(start, end).trim().replace(/\s+/g, ' ');
    if (!title || !description) continue;
    // Skip bogus titles that are mid-sentence scraps
    if (title.split(/\s+/).length > 8) continue;
    steps.push({ title, description });
  }
  return steps.length >= 2 ? steps : null;
}

/**
 * Unpack jammed service-process steps into markdown list lines (speech + card parser).
 */
function unpackPackedProcessSections(src) {
  const { fm, body } = splitFrontmatter(src);
  if (!body.trim()) return { body: src, changed: false, count: 0 };

  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const chunks = [];
  let cur = { heading: '', headingLine: '', bodyLines: [] };

  const flush = () => {
    if (cur.headingLine || cur.bodyLines.length) chunks.push(cur);
    cur = { heading: '', headingLine: '', bodyLines: [] };
  };

  for (const line of lines) {
    const hm = line.match(/^(#{2,3})\s+(.+)$/);
    if (hm) {
      flush();
      cur = { heading: hm[2].trim(), headingLine: line, bodyLines: [] };
      continue;
    }
    cur.bodyLines.push(line);
  }
  flush();

  let changed = false;
  let count = 0;
  const parts = [];

  for (const chunk of chunks) {
    const sectionBody = chunk.bodyLines.join('\n');
    if (!chunk.headingLine) {
      if (sectionBody) parts.push(sectionBody);
      continue;
    }

    const isProcess =
      looksLikeProcessHeading(chunk.heading) || countProcessStepStarts(sectionBody) >= 3;

    if (!isProcess) {
      parts.push(chunk.headingLine);
      if (sectionBody.trim()) parts.push(sectionBody);
      continue;
    }

    const paras = sectionBody.split(/\n{2,}/);
    const nextParas = [];
    let sectionChanged = false;
    for (const para of paras) {
      if (!para.trim()) {
        nextParas.push(para);
        continue;
      }
      const unpacked = unpackProcessParagraph(para);
      if (unpacked.changed) {
        sectionChanged = true;
        count += unpacked.count;
        nextParas.push(unpacked.text);
      } else {
        nextParas.push(para);
      }
    }

    parts.push(chunk.headingLine);
    if (sectionChanged) {
      changed = true;
      const nextBody = nextParas.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
      if (nextBody) parts.push(nextBody);
    } else if (sectionBody.trim()) {
      parts.push(sectionBody);
    }
  }

  if (!changed) return { body: src, changed: false, count: 0 };

  const nextBody = `${parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
  return {
    body: fm != null ? `---\n${fm}\n---\n${nextBody.replace(/^\n+/, '')}` : nextBody,
    changed: true,
    count,
  };
}

function applyStockReplacements(src) {
  let body = src;
  const details = [];
  for (const { re, to } of STOCK_REPLACEMENTS) {
    re.lastIndex = 0;
    if (!re.test(body)) continue;
    re.lastIndex = 0;
    const before = body;
    body = body.replace(re, to);
    if (body !== before) {
      details.push(`Replaced stock phrasing → “${to || '(removed)'}”`);
    }
  }
  // Clean double spaces from empty replacements
  if (details.length) {
    body = body.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  }
  return { body, changed: details.length > 0, details };
}

function stripPromptLeakage(src) {
  const { fm, body } = splitFrontmatter(src);
  const paras = body.split(/\n{2,}/);
  const kept = [];
  let removed = 0;
  for (const para of paras) {
    const plain = para.trim();
    if (!plain) {
      kept.push(para);
      continue;
    }
    if (PROMPT_LEAK_LINE.test(plain) || looksLikeEditorInstructionDump(plain)) {
      removed += 1;
      continue;
    }
    // Drop individual leak lines inside a para
    const lines = para.split('\n');
    const cleanLines = lines.filter((line) => !PROMPT_LEAK_LINE.test(line.trim()));
    if (cleanLines.length < lines.length) {
      removed += 1;
      if (cleanLines.some((l) => l.trim())) kept.push(cleanLines.join('\n'));
      continue;
    }
    kept.push(para);
  }
  if (!removed) return { body: src, changed: false, removed: 0 };
  const nextBody = kept.join('\n\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');
  return {
    body: fm ? `---\n${fm}\n---\n\n${nextBody}` : nextBody,
    changed: true,
    removed,
  };
}

function looksLikeEditorInstructionDump(plain) {
  const t = plain.toLowerCase();
  if (t.includes('return the same ### file')) return true;
  if (t.includes('fix speech lint') && t.includes('city-stuffed')) return true;
  if (/^\d+\.\s+fix speech lint/i.test(plain)) return true;
  if (/^\d+\.\s+kill ai tells/i.test(plain)) return true;
  // Long dump that is mostly instruction meta
  const hits = [
    /speech lint/i,
    /seo lint/i,
    /### file/i,
    /kill ai tells/i,
    /read-aloud test/i,
  ].filter((re) => re.test(plain)).length;
  return hits >= 2 && plain.length > 120;
}

function injectMissingLinks(src, targets, config, rel) {
  const hrefs = extractMarkdownHrefs(src);
  const missing = targets.filter((t) => !hrefs.some((h) => hrefMatches(h, t)));
  if (!missing.length) return { body: src, changed: false, details: [] };

  const links = missing.map((t) => `[${labelForPath(t, config)}](${t})`);
  const block = `\n\n<!-- rover-autofix-links -->\n${links.map((l) => `- ${l}`).join('\n')}\n`;

  // Prefer inserting before a final CTA-ish heading; else append after body
  const { fm, body } = splitFrontmatter(src);
  let nextBody = body;
  const ctaRe = /\n##[^\n]*(estimate|contact|get a|ready to)\b[^\n]*\n/i;
  const m = nextBody.match(ctaRe);
  if (m && m.index != null) {
    nextBody = `${nextBody.slice(0, m.index)}${block}${nextBody.slice(m.index)}`;
  } else if (/services\//i.test(rel)) {
    nextBody = `${nextBody.trimEnd()}\n\nMore: ${links.join(' · ')}\n`;
  } else {
    nextBody = `${nextBody.trimEnd()}${block}`;
  }

  const details = missing.map((t) => `Added link ${t}`);
  return {
    body: fm != null ? `---\n${fm}\n---\n${nextBody.startsWith('\n') ? '' : '\n'}${nextBody}` : nextBody,
    changed: true,
    details,
  };
}

function labelForPath(target, config) {
  const t = String(target || '').replace(/\/$/, '') || '/';
  if (t === '/' || t === '') return 'Home';
  if (t === '/contact') return 'Contact';
  if (t === '/about') return 'About';
  const svc = t.match(/^\/services\/(.+)$/);
  if (svc) {
    const slug = svc[1];
    const services = Array.isArray(config.services) ? config.services : [];
    for (const s of services) {
      const name = typeof s === 'string' ? s : s?.name;
      if (slugify(name) === slug) return name;
    }
    return titleFromSlug(slug);
  }
  const loc = t.match(/^\/locations\/(.+)$/);
  if (loc) {
    const slug = loc[1];
    for (const sub of config.targetSuburbs || []) {
      const label = typeof sub === 'string' ? sub : sub?.name || sub?.city;
      if (slugify(label) === slug) return label;
    }
    return titleFromSlug(slug);
  }
  return t;
}

function titleFromSlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function isStructuredLabelDashLine(line) {
  return /^\s*(?:[-*+]\s+)?\*\*.+?\*\*\s+[—–\u2013\u2014]\s+/.test(String(line || ''));
}

function wordCount(s) {
  return String(s || '')
    .split(/\s+/)
    .filter(Boolean).length;
}

function breakLongSentence(s) {
  const t = String(s || '').trim();
  if (wordCount(t) <= 80) return [t];
  const mid = Math.floor(t.length / 2);
  const cuts = [];
  for (const re of [/;\s+/g, /,\s+(?:and|but|which|so)\s+/gi]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) cuts.push(m.index + (re.source.includes(';') ? m[0].length : m[0].length));
  }
  if (!cuts.length) return [t];
  const at = cuts.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
  let left = t.slice(0, at).trim().replace(/[,;]+$/, '');
  let right = t.slice(at).trim();
  if (!left || !right) return [t];
  if (!/[.!?]$/.test(left)) left = `${left}.`;
  right = right.charAt(0).toUpperCase() + right.slice(1);
  return [left, right];
}

function splitIntoSentences(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const parts = t.match(/[^.!?]+(?:[.!?]+["”')\]]*)?(?:\s+|$)|[^.!?]+$/g);
  const sentences = (parts || [t]).map((s) => s.trim()).filter(Boolean);
  return sentences.flatMap((s) => (wordCount(s) > 80 ? breakLongSentence(s) : [s]));
}

function chunkSentences(sentences, maxWords = 80, maxSentences = 3) {
  const out = [];
  let buf = [];
  let words = 0;
  const flush = () => {
    if (!buf.length) return;
    out.push(buf.join(' '));
    buf = [];
    words = 0;
  };
  for (const s of sentences) {
    const w = wordCount(s);
    if (buf.length && (buf.length >= maxSentences || words + w > maxWords)) flush();
    buf.push(s);
    words += w;
    if (w > maxWords) flush();
  }
  flush();
  return out;
}

function isSkippableProsePara(para) {
  const t = String(para || '').trim();
  if (!t) return true;
  if (/^#{1,6}\s/.test(t)) return true;
  if (/^[-*+>]\s/.test(t)) return true;
  if (t.split('\n').every((line) => isStructuredLabelDashLine(line) || !line.trim())) return true;
  return false;
}

/** Split prose paragraphs over 80 words into 1–3 sentence blocks (speech long_paragraph). */
function splitLongProseParagraphs(src) {
  const { fm, body } = splitFrontmatter(src);
  const paras = body.split(/\n{2,}/);
  let count = 0;
  const next = paras.map((para) => {
    if (isSkippableProsePara(para) || wordCount(para) <= 80) return para;
    const chunks = chunkSentences(splitIntoSentences(para));
    if (chunks.length < 2) return para;
    count += 1;
    return chunks.join('\n\n');
  });
  if (!count) return { body: src, changed: false, count: 0 };
  const nextBody = `${next.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
  return {
    body: fm != null ? `---\n${fm}\n---\n${nextBody.replace(/^\n+/, '')}` : nextBody,
    changed: true,
    count,
  };
}

function splitFrontmatter(src) {
  const t = String(src || '').replace(/^\uFEFF/, '');
  if (!t.startsWith('---')) return { fm: null, body: t };
  const end = t.indexOf('\n---', 3);
  if (end < 0) return { fm: null, body: t };
  return {
    fm: t.slice(3, end).replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
    body: t.slice(end + 4).replace(/^\r?\n/, ''),
  };
}

function joinFrontmatter(fm, body) {
  if (fm == null) return body;
  return `---\n${fm}\n---\n${String(body).replace(/^\n+/, '')}`;
}

function introHeadingFromOutline(outline) {
  const s = (outline?.sections || []).find((x) => x.id === 'svcIntro');
  return String(s?.heading || '').trim();
}

/** True when a service-page first ## is the unmarked intro, not a real section. */
function isServiceIntroH2(heading, outlineHeading) {
  const t = String(heading || '')
    .replace(/\*+/g, '')
    .trim();
  if (!t) return false;
  const n = t.toLowerCase();
  if (/\bintro\b/.test(n)) return true;
  if (/^professional\s+.+\s+in\s+.+/i.test(t)) return true;
  if (outlineHeading && n === outlineHeading.toLowerCase()) return true;
  return false;
}

/**
 * Strip the first ## on services/*.md when it matches the intro heading pattern.
 * Real sections (What’s included, process, cost, …) are left alone.
 */
function stripServiceIntroH2(src, outline) {
  const { fm, body } = splitFrontmatter(src);
  const first = /^##[ \t]+(.+?)[ \t]*\r?$/m.exec(body);
  if (!first) return { body: src, changed: false, heading: '' };
  const heading = first[1].trim();
  if (!isServiceIntroH2(heading, introHeadingFromOutline(outline))) {
    return { body: src, changed: false, heading };
  }
  const nextBody = (body.slice(0, first.index) + body.slice(first.index + first[0].length)).replace(
    /^\r?\n/,
    '',
  );
  return { body: joinFrontmatter(fm, nextBody), changed: true, heading };
}

const PERMIT_NEED_RE = /^###[ \t]+Usually needs a permit[ \t]*\r?$/im;
const PERMIT_NO_RE = /^###[ \t]+Usually no permit[ \t]*\r?$/im;

function extractH3Block(body, startIdx) {
  const from = body.slice(startIdx);
  const header = from.match(/^###[^\n]*(?:\r?\n|$)/);
  if (!header) return null;
  const after = from.slice(header[0].length);
  const next = after.search(/^#{2,3}[ \t]+/m);
  const endRel = next < 0 ? after.length : next;
  const end = startIdx + header[0].length + endRel;
  return { start: startIdx, end, text: body.slice(startIdx, end) };
}

/**
 * Swap ### Usually no permit / ### Usually needs a permit when no-permit comes first.
 * Correct order (needs-permit first) is left alone.
 */
function swapReversedPermitColumns(src) {
  const { fm, body } = splitFrontmatter(src);
  const needIdx = body.search(PERMIT_NEED_RE);
  const noIdx = body.search(PERMIT_NO_RE);
  if (needIdx < 0 || noIdx < 0 || noIdx > needIdx) {
    return { body: src, changed: false };
  }
  const noBlock = extractH3Block(body, noIdx);
  const needBlock = extractH3Block(body, needIdx);
  if (!noBlock || !needBlock || noBlock.end > needBlock.start) {
    return { body: src, changed: false };
  }
  const nextBody =
    body.slice(0, noBlock.start) +
    needBlock.text +
    body.slice(noBlock.end, needBlock.start) +
    noBlock.text +
    body.slice(needBlock.end);
  return { body: joinFrontmatter(fm, nextBody), changed: true };
}

/**
 * Drop homepage faqs[] entries that are city trivia / off-niche (deterministic).
 */
function stripOffNicheHomepageFaqs(src, opts = {}) {
  const { fm, body } = splitFrontmatter(src);
  if (fm == null || !/^faqs:/m.test(fm)) {
    return { body: src, changed: false, removed: [] };
  }
  const faqsMatch = fm.match(/^faqs:\s*\n((?:(?:[ \t]+.*|-(?!-).*)\n)*)/m);
  if (!faqsMatch) return { body: src, changed: false, removed: [] };

  const block = faqsMatch[1];
  const items = [];
  let cur = null;
  for (const line of block.split(/\n/)) {
    if (/^[ \t]*-(?!-)[ \t]+question\s*:/.test(line) || /^[ \t]*-[ \t]+question\s*:/.test(line)) {
      if (cur) items.push(cur);
      cur = [line];
    } else if (cur) {
      cur.push(line);
    }
  }
  if (cur) items.push(cur);
  if (!items.length) return { body: src, changed: false, removed: [] };

  const kept = [];
  const removed = [];
  for (const itemLines of items) {
    const qLine = itemLines.find((l) => /question\s*:/.test(l)) || '';
    const q = String(qLine)
      .replace(/^.*?question\s*:\s*/i, '')
      .trim()
      .replace(/^["']|["']$/g, '');
    if (isFaqQuestionOffNiche(q, opts)) {
      removed.push(q);
    } else {
      const text = itemLines.join('\n').replace(/\n+$/, '');
      if (text.trim()) kept.push(text.endsWith('\n') ? text : `${text}\n`);
    }
  }
  if (!removed.length) return { body: src, changed: false, removed: [] };

  const newFaqs =
    kept.length > 0 ? `faqs:\n${kept.map((k) => (k.endsWith('\n') ? k : `${k}\n`)).join('')}` : '';
  const nextFm = fm
    .replace(/^faqs:\s*\n(?:(?:[ \t]+.*|-(?!-).*)\n)*/m, newFaqs)
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
  return {
    body: `---\n${nextFm}\n---\n${body}`,
    changed: true,
    removed,
  };
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
