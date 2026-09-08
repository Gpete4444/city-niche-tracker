/**
 * Cloudflare Worker in front of static assets (`run_worker_first`):
 * - 301 http → https
 * - 301 slashless HTML paths → trailing slash
 * - X-Robots-Tag: noindex on *.workers.dev
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let redirect = false;
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      redirect = true;
    }
    const path = url.pathname;
    const looksLikeFile = /\.[a-z0-9]+$/i.test(path);
    if (path !== '/' && !path.endsWith('/') && !looksLikeFile) {
      url.pathname = `${path}/`;
      redirect = true;
    }
    if (redirect) {
      return Response.redirect(url.toString(), 301);
    }

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
