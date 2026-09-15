/**
 * node:http(s) JSON/text requests with Connection: close.
 * Avoids global fetch/undici, which races libuv async handles on Windows
 * (UV_HANDLE_CLOSING in src/win/async.c) when eval child processes exit.
 */

import http from 'node:http';
import https from 'node:https';

const DEFAULT_TIMEOUT_MS = 60_000;

function timeoutError(timeoutMs) {
  const err = new Error(`timeout after ${timeoutMs}ms`);
  err.name = 'TimeoutError';
  return err;
}

/**
 * @param {string} url
 * @param {{
 *   method?: string,
 *   headers?: Record<string, string>,
 *   body?: string | Buffer | null,
 *   timeoutMs?: number,
 *   maxRedirects?: number,
 * }} [opts]
 * @returns {Promise<{ status: number, ok: boolean, text: string, headers: import('node:http').IncomingHttpHeaders }>}
 */
export function requestText(url, {
  method = 'GET',
  headers = {},
  body = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRedirects = 5,
} = {}) {
  const payload = body == null || body === '' ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body));

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };

    const run = (target, verb, data, redirectsLeft) => {
      let parsed;
      try {
        parsed = new URL(target);
      } catch (err) {
        finish(err);
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        finish(new Error(`Unsupported protocol: ${parsed.protocol}`));
        return;
      }

      const lib = parsed.protocol === 'http:' ? http : https;
      const reqHeaders = {
        ...headers,
        Connection: 'close',
      };
      if (data) reqHeaders['Content-Length'] = String(data.length);

      const req = lib.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || undefined,
          path: `${parsed.pathname}${parsed.search}`,
          method: verb,
          headers: reqHeaders,
        },
        (res) => {
          const status = res.statusCode || 0;
          const location = res.headers.location;
          if (status >= 300 && status < 400 && location && redirectsLeft > 0) {
            res.resume();
            const nextUrl = new URL(location, target).href;
            const keepMethod = status === 307 || status === 308;
            run(nextUrl, keepMethod ? verb : 'GET', keepMethod ? data : null, redirectsLeft - 1);
            return;
          }
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('error', (err) => finish(err));
          res.on('end', () => {
            finish(null, {
              status,
              ok: status >= 200 && status < 300,
              text: Buffer.concat(chunks).toString('utf8'),
              headers: res.headers,
            });
          });
        },
      );

      req.on('error', (err) => finish(err));
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        finish(timeoutError(timeoutMs));
      });
      if (data) req.write(data);
      req.end();
    };

    run(String(url), method, payload, maxRedirects);
  });
}

/**
 * @param {string} url
 * @param {Parameters<typeof requestText>[1]} [opts]
 */
export async function requestJson(url, opts = {}) {
  const res = await requestText(url, opts);
  let json;
  try {
    json = JSON.parse(res.text || 'null');
  } catch {
    throw new Error(`Invalid JSON (HTTP ${res.status}): ${String(res.text || '').slice(0, 200)}`);
  }
  return { ...res, json };
}
