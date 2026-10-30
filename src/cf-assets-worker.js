/**
 * Cloudflare Worker in front of static assets (`run_worker_first`):
 * - 301 http → https
 * - 301 www → apex
 * - 301 slashless HTML paths → trailing slash
 * - One redirect combines every change (http://www.example.com/about → https://example.com/about/)
 * - X-Robots-Tag: noindex on *.workers.dev
 */

/** Canonical URL to 301 to, or null when this request is already the indexable URL. */
export function canonicalRedirectTarget(requestUrl) {
  const url = new URL(requestUrl);
  let redirect = false;
  if (url.protocol === 'http:') {
    url.protocol = 'https:';
    redirect = true;
  }
  if (url.hostname.toLowerCase().startsWith('www.')) {
    url.hostname = url.hostname.slice(4);
    redirect = true;
  }
  const path = url.pathname;
  const looksLikeFile = /\.[a-z0-9]+$/i.test(path);
  if (path !== '/' && !path.endsWith('/') && !looksLikeFile) {
    url.pathname = `${path}/`;
    redirect = true;
  }
  return redirect ? url.toString() : null;
}

export default {
  async fetch(request, env) {
    const target = canonicalRedirectTarget(request.url);
    if (target) {
      return Response.redirect(target, 301);
    }
    const url = new URL(request.url);

    const response = await env.ASSETS.fetch(request);
    if (!url.hostname.endsWith('.workers.dev')) return response;
    const headers = new Headers(response.headers);
    headers.set('X-Robots-Tag', 'noindex');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
