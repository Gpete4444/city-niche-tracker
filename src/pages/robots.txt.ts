import type { APIRoute } from 'astro';
import { site } from '../config/site';

/** Domain-aware robots.txt — never ship a leftover Sitemap host from another candidate. */
export const GET: APIRoute = () => {
  const domain = String(site.domain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
  const sitemapLine = domain ? `Sitemap: https://${domain}/sitemap.xml\n` : '';
  const body = `User-agent: *\nAllow: /\n\n${sitemapLine}`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
