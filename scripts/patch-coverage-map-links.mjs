/**
 * One-off / reusable: wrap cov-area groups with location <a> links.
 * Usage: node scripts/patch-coverage-map-links.mjs [svgPath...] [primaryCity]
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

function ensureCoverageMapAreaLinks(svg, primaryCity = '') {
  let text = String(svg || '');
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
      const slug = slugifyAreaName(cityRaw);
      const href = slug ? `/locations/${slug}` : '/';
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

const root = process.cwd();
const args = process.argv.slice(2);
const primary =
  args.find((a) => !a.endsWith('.svg')) ||
  JSON.parse(readFileSync(path.join(root, 'src/config/site-config.json'), 'utf8')).primaryCity ||
  '';
const files = args.filter((a) => a.endsWith('.svg'));
const defaults = [
  path.join(root, 'public/images/coverage-map.svg'),
  path.join(
    root,
    '../rank-and-rent-sites/spanish-fork-kitchen-bathroom-remodeling/public/images/coverage-map.svg',
  ),
];
const targets = files.length ? files : defaults;

for (const p of targets) {
  if (!existsSync(p)) {
    console.log('skip missing', p);
    continue;
  }
  const next = ensureCoverageMapAreaLinks(readFileSync(p, 'utf8'), primary);
  writeFileSync(p, next);
  const links = [...next.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  console.log('patched', p);
  console.log('  links:', links.join(', ') || '(none)');
}
