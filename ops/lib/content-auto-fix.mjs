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
