/**
 * Wrap cov-area groups with location or contact <a> links.
 * Usage: node scripts/patch-coverage-map-links.mjs [svgPath...]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

function slugifyAreaName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function sitePath(p) {
  const raw = String(p || '').trim() || '/';
  if (raw === '/') return '/';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

function coverageMapAreaHref(cityRaw, locationPages = []) {
  const slug = slugifyAreaName(cityRaw);
  if (!slug) return '/';
  for (const page of locationPages) {
    const id = String(page?.id || '').trim();
    const city = String(page?.city || '').trim();
    if (slugifyAreaName(id) === slug || slugifyAreaName(city) === slug) {
      return sitePath(`/locations/${id || slug}`);
    }
  }
  return sitePath('/contact');
}

function ensureCoverageMapAreaLinks(svg, locationPages = []) {
  let text = String(svg || '').replace(
    /href="(\/locations\/[^"]+|https?:\/\/[^/]+\/locations\/[^"]+)"/gi,
    (_m, href) => {
      const pathOnly = String(href).replace(/^https?:\/\/[^/]+/i, '');
      const slug = pathOnly
        .replace(/^\/locations\//i, '')
        .replace(/\/$/, '')
        .split(/[?#]/)[0];
      return `href="${coverageMapAreaHref(slug, locationPages)}"`;
    },
  );
  if (!text.includes('class="cov-area"')) return text;

  const marker = '<g class="cov-area">';
  let out = '';
  let i = 0;

  while (i < text.length) {
    const start = text.indexOf(marker, i);
    if (start < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, start);

    let depth = 0;
    let j = start;
    let end = -1;
    while (j < text.length) {
      const open = text.indexOf('<g', j);
      const close = text.indexOf('</g>', j);
      if (close < 0) break;
      if (open >= 0 && open < close) {
        depth += 1;
        j = open + 2;
      } else {
        depth -= 1;
        j = close + 4;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) {
      out += text.slice(start);
      break;
    }

    const block = text.slice(start, end);
    const alreadyLinked = /<a\b[^>]*href=/i.test(out.slice(Math.max(0, out.length - 120)));
    if (/^<a\b/i.test(block.trim()) || alreadyLinked) {
      out += block;
    } else {
      const cityRaw =
        block.match(/class="city">([^<]+)</)?.[1]?.replace(/&amp;/g, '&').replace(/&apos;/g, "'") ||
        '';
      const href = coverageMapAreaHref(cityRaw, locationPages);
      out += `<a href="${href}" target="_top">${block}</a>`;
    }
    i = end;
  }

  if (!/a\s*\{\s*text-decoration/i.test(out)) {
    out = out.replace(
      '</style>',
      `a { text-decoration: none; color: inherit; }
    a:hover .cov-area path { fill-opacity: 0.78; stroke-width: 3.2; }
    a:hover .cov-area .label-bg { fill-opacity: 1; }
</style>`,
    );
  }

  return out;
}

function locationPagesFromSiteConfig(root) {
  const cfgPath = path.join(root, 'src/config/site-config.json');
  if (!existsSync(cfgPath)) return [];
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const pages = [];
  if (cfg.primaryCity) {
    pages.push({ id: slugifyAreaName(cfg.primaryCity), city: cfg.primaryCity });
  }
  for (const s of cfg.targetSuburbs || []) {
    const city = String(s || '').trim();
    if (city) pages.push({ id: slugifyAreaName(city), city });
  }
  return pages;
}

const root = process.cwd();
const args = process.argv.slice(2);
const files = args.filter((a) => a.endsWith('.svg'));
const defaults = [path.join(root, 'public/images/coverage-map.svg')];
const targets = files.length ? files : defaults;
const locationPages = locationPagesFromSiteConfig(root);

for (const p of targets) {
  if (!existsSync(p)) {
    console.log('skip missing', p);
    continue;
  }
  const next = ensureCoverageMapAreaLinks(readFileSync(p, 'utf8'), locationPages);
  writeFileSync(p, next);
  const links = [...next.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  console.log('patched', p);
  console.log('  links:', links.join(', ') || '(none)');
}
