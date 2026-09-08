/** Ensure coverage-map SVG areas link to location pages; helpers for inline embed. */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cwd } from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  coverageMapAreaHref,
  slugifyAreaName,
  type CoverageMapLocationPage,
} from './coverage-map-href';

export { coverageMapAreaHref, slugifyAreaName };
export type { CoverageMapLocationPage };

export type CoverageMapLocationInput =
  | string
  | CoverageMapLocationPage
  | Array<string | CoverageMapLocationPage>;

function normalizeLocationPages(
  locationPages: CoverageMapLocationInput = [],
): Array<string | CoverageMapLocationPage> {
  if (typeof locationPages === 'string') {
    const city = locationPages.trim();
    if (!city) return [];
    return [{ id: slugifyAreaName(city), city }];
  }
  return Array.isArray(locationPages) ? locationPages : [];
}

function rewriteExistingMapHrefs(
  svg: string,
  locationPages: Array<string | CoverageMapLocationPage>,
): string {
  return String(svg || '').replace(
    /href="(\/locations\/[^"]+|https?:\/\/[^/]+\/locations\/[^"]+)"/gi,
    (_m, href: string) => {
      const pathOnly = String(href).replace(/^https?:\/\/[^/]+/i, '');
      const slug = pathOnly
        .replace(/^\/locations\//i, '')
        .replace(/\/$/, '')
        .split(/[?#]/)[0];
      return `href="${coverageMapAreaHref(slug, locationPages)}"`;
    },
  );
}

/**
 * Wrap each `.cov-area` group in `<a href="...">`.
 * Real SEO location pages → `/locations/{id}/`; coverage-only towns → `/contact/`.
 */
export function ensureCoverageMapAreaLinks(
  svg: string,
  locationPages: CoverageMapLocationInput = [],
): string {
  const pages = normalizeLocationPages(locationPages);
  let text = rewriteExistingMapHrefs(svg, pages);
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
      const href = coverageMapAreaHref(cityRaw, pages);
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

/** Strip XML prolog + SVG <title>/<desc> so inline embeds cannot bleed into document title / SEO. */
export function svgForInlineEmbed(svg: string): string {
  return String(svg || '')
    .replace(/^\uFEFF/, '')
    .replace(/^<\?xml[^>]*>\s*/i, '')
    .replace(/<!DOCTYPE[^>]*>\s*/i, '')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<desc\b[^>]*>[\s\S]*?<\/desc>/gi, '')
    .trim();
}

/** Resolve project public/ file without relying on shimmed process.cwd(). */
function publicFileCandidates(src: string): string[] {
  const rel = String(src || '')
    .replace(/^\//, '')
    .replace(/^public\//, '');
  if (!rel) return [];
  const parts = rel.split('/').filter(Boolean);
  const out: string[] = [];
  try {
    out.push(path.join(cwd(), 'public', ...parts));
  } catch {
    /* prerender may shim process without cwd */
  }
  // src/lib → repo root (works when this module is not relocated)
  try {
    const fromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    out.push(path.join(fromModule, 'public', ...parts));
  } catch {
    /* ignore */
  }
  return [...new Set(out)];
}

/** Read coverage SVG from public/ and prepare linked inline HTML. */
export function loadInlineCoverageMapHtml(
  src: string | undefined,
  locationPages: CoverageMapLocationInput = [],
): string {
  if (!src) return '';
  for (const abs of publicFileCandidates(src)) {
    if (!existsSync(abs)) continue;
    const raw = readFileSync(abs, 'utf8');
    return svgForInlineEmbed(ensureCoverageMapAreaLinks(raw, locationPages)).replace(
      /<svg\b([^>]*)>/i,
      '<svg$1 class="h-auto w-full overflow-hidden rounded-xl bg-white shadow-2xl">',
    );
  }
  return '';
}
