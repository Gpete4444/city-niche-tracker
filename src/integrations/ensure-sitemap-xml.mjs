/**
 * Emit dist/sitemap.xml for crawlers that expect the conventional path.
 * @astrojs/sitemap writes sitemap-0.xml (and sitemap-index.xml when chunked).
 * Also copies Workers `_headers` so *.workers.dev stays noindex even if
 * the bundler skips underscored public files.
 */
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const WORKERS_DEV_HEADERS = `# Preview hostname must not be indexed. Apex / www custom domains stay indexable.
https://:placeholder.workers.dev/*
  X-Robots-Tag: noindex
`;

/** @returns {import('astro').AstroIntegration} */
export default function ensureSitemapXml() {
  return {
    name: 'ensure-sitemap-xml',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const dist = fileURLToPath(dir);
        const headersDest = path.join(dist, '_headers');
        writeFileSync(headersDest, WORKERS_DEV_HEADERS, 'utf8');
        logger.info('Wrote dist/_headers (workers.dev noindex)');

        const dest = path.join(dist, 'sitemap.xml');
        const indexPath = path.join(dist, 'sitemap-index.xml');
        const chunkPath = path.join(dist, 'sitemap-0.xml');
        if (existsSync(indexPath)) {
          copyFileSync(indexPath, dest);
          logger.info('Wrote sitemap.xml (copy of sitemap-index.xml)');
          return;
        }
        if (existsSync(chunkPath)) {
          copyFileSync(chunkPath, dest);
          logger.info('Wrote sitemap.xml (copy of sitemap-0.xml)');
          return;
        }
        // Minimal fallback so /sitemap.xml is never a hard 404 after a successful build
        writeFileSync(
          dest,
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n`,
        );
        logger.warn('No Astro sitemap chunks found — wrote empty sitemap.xml');
      },
    },
  };
}
