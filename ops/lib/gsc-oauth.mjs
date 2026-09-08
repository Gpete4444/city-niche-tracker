/**
 * Google Search Console OAuth (Desktop / loopback) for Rover.
 * Tokens: research/gsc-oauth.json (gitignored via research/).
 *
 * Env:
 *   GOOGLE_GSC_CLIENT_ID
 *   GOOGLE_GSC_CLIENT_SECRET
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { RESEARCH_DIR } from './candidates.mjs';

export const GSC_AUTH_REVOKED = 'GSC_AUTH_REVOKED';

const TOKEN_FILE = path.join(RESEARCH_DIR, 'gsc-oauth.json');
const PENDING_FILE = path.join(RESEARCH_DIR, 'gsc-oauth-pending.json');
const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let tokenFileOverride = null;
let fetchImpl = globalThis.fetch.bind(globalThis);
let refreshInFlight = null;

function tokenFilePath() {
  return tokenFileOverride || TOKEN_FILE;
}

function gscFetchImpl(url, opts) {
  return fetchImpl(url, opts);
}

/**
 * Test hook — reset after each case. Do not use from production paths.
 */
export function _configureGscOauthForTests({ fetchImpl: nextFetch, tokenFile } = {}) {
  if (nextFetch !== undefined) {
    fetchImpl = nextFetch || globalThis.fetch.bind(globalThis);
  }
  if (tokenFile !== undefined) tokenFileOverride = tokenFile;
  refreshInFlight = null;
}

export function isGscRefreshRevoked(json, message = '') {
  const err = typeof json?.error === 'string' ? json.error : String(json?.error?.status || '');
  const desc = String(json?.error_description || json?.error?.message || message || '');
  return err === 'invalid_grant' || /expired or revoked/i.test(desc);
}

export function gscAuthRevokedError(message) {
  return Object.assign(
    new Error(message || 'GSC login expired — reconnect Google Search Console on Launched.'),
    { status: 401, code: GSC_AUTH_REVOKED },
  );
}

export function formatGscApiError(json, fallback = 'GSC API error') {
  const message =
    json?.error?.message || json?.error_description || (typeof json?.raw === 'string' ? json.raw : '') || fallback;
  const reason = json?.error?.errors?.[0]?.reason || json?.error?.status || null;
  if (reason && !String(message).includes(String(reason))) {
    return `${message} (${reason})`;
  }
  return String(message || fallback);
}

function ensureResearchDir() {
  mkdirSync(RESEARCH_DIR, { recursive: true });
}

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureResearchDir();
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function gscClientConfigured() {
  return Boolean(
    String(process.env.GOOGLE_GSC_CLIENT_ID || '').trim() &&
      String(process.env.GOOGLE_GSC_CLIENT_SECRET || '').trim(),
  );
}

export function gscRedirectUri(port = Number(process.env.OPS_PORT) || 8787) {
  return `http://127.0.0.1:${port}/api/gsc/oauth/callback`;
}

export function getGscAuthStatus() {
  const configured = gscClientConfigured();
  const tokens = readJson(tokenFilePath(), null);
  const connected = Boolean(tokens?.refresh_token || tokens?.access_token);
  return {
    configured,
    connected,
    email: tokens?.email || null,
    scope: tokens?.scope || null,
    updatedAt: tokens?.updatedAt || null,
    redirectUri: gscRedirectUri(),
    clientIdSet: Boolean(String(process.env.GOOGLE_GSC_CLIENT_ID || '').trim()),
  };
}

export function startGscOAuth({ port } = {}) {
  if (!gscClientConfigured()) {
    throw Object.assign(
      new Error(
        'Set GOOGLE_GSC_CLIENT_ID and GOOGLE_GSC_CLIENT_SECRET in .env (Desktop OAuth client).',
      ),
      { status: 400 },
    );
  }
  const state = crypto.randomBytes(24).toString('hex');
  const redirectUri = gscRedirectUri(port);
  writeJson(PENDING_FILE, { state, redirectUri, createdAt: new Date().toISOString() });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_GSC_CLIENT_ID.trim(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return {
    authUrl: `${AUTH_URL}?${params.toString()}`,
    redirectUri,
  };
}

async function exchangeCode(code, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_GSC_CLIENT_ID.trim(),
    client_secret: process.env.GOOGLE_GSC_CLIENT_SECRET.trim(),
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await gscFetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(
      new Error(json.error_description || json.error || `Token exchange failed (${res.status})`),
      { status: 400, details: json },
    );
  }
  return json;
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_GSC_CLIENT_ID.trim(),
    client_secret: process.env.GOOGLE_GSC_CLIENT_SECRET.trim(),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await gscFetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (isGscRefreshRevoked(json, json.error_description || json.error)) {
      disconnectGsc();
      throw gscAuthRevokedError(json.error_description || json.error);
    }
    throw Object.assign(
      new Error(json.error_description || json.error || `Token refresh failed (${res.status})`),
      { status: 401, details: json },
    );
  }
  return json;
}

function refreshAccessTokenOnce(refreshToken) {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken(refreshToken).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function fetchTokenEmail(accessToken) {
  try {
    const res = await gscFetchImpl('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.email || null;
  } catch {
    return null;
  }
}

export async function completeGscOAuth({ code, state }) {
  const pending = readJson(PENDING_FILE, null);
  if (!pending?.state || pending.state !== state) {
    throw Object.assign(new Error('Invalid or expired OAuth state — start Connect again.'), {
      status: 400,
    });
  }
  if (!code) {
    throw Object.assign(new Error('Missing OAuth code'), { status: 400 });
  }

  const tokenJson = await exchangeCode(code, pending.redirectUri);
  const prev = readJson(tokenFilePath(), null) || {};
  const refresh_token = tokenJson.refresh_token || prev.refresh_token;
  if (!refresh_token) {
    throw Object.assign(
      new Error(
        'No refresh_token returned. Revoke Rover access at https://myaccount.google.com/permissions and Connect again with prompt=consent.',
      ),
      { status: 400 },
    );
  }

  const email = await fetchTokenEmail(tokenJson.access_token);
  const stored = {
    access_token: tokenJson.access_token,
    refresh_token,
    expiry_date: Date.now() + (Number(tokenJson.expires_in) || 3600) * 1000,
    scope: tokenJson.scope || SCOPES.join(' '),
    token_type: tokenJson.token_type || 'Bearer',
    email,
    updatedAt: new Date().toISOString(),
  };
  writeJson(tokenFilePath(), stored);
  try {
    unlinkSync(PENDING_FILE);
  } catch {
    /* ignore */
  }
  return getGscAuthStatus();
}

export function disconnectGsc() {
  try {
    if (existsSync(tokenFilePath())) unlinkSync(tokenFilePath());
  } catch {
    /* ignore */
  }
  try {
    if (existsSync(PENDING_FILE)) unlinkSync(PENDING_FILE);
  } catch {
    /* ignore */
  }
  return getGscAuthStatus();
}

/**
 * Return a valid access token, refreshing if needed.
 */
export async function getGscAccessToken() {
  if (!gscClientConfigured()) {
    throw Object.assign(new Error('GSC OAuth client not configured in .env'), { status: 400 });
  }
  const tokens = readJson(tokenFilePath(), null);
  if (!tokens?.refresh_token && !tokens?.access_token) {
    throw Object.assign(new Error('GSC not connected — use Connect Google on Launched Sites'), {
      status: 401,
      code: GSC_AUTH_REVOKED,
    });
  }

  const skewMs = 60_000;
  if (tokens.access_token && tokens.expiry_date && Date.now() < tokens.expiry_date - skewMs) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) {
    disconnectGsc();
    throw gscAuthRevokedError('GSC access token expired and no refresh_token stored');
  }

  const refreshed = await refreshAccessTokenOnce(tokens.refresh_token);
  const current = readJson(tokenFilePath(), null) || tokens;
  const next = {
    ...current,
    access_token: refreshed.access_token,
    expiry_date: Date.now() + (Number(refreshed.expires_in) || 3600) * 1000,
    scope: refreshed.scope || current.scope,
    updatedAt: new Date().toISOString(),
  };
  if (refreshed.refresh_token) next.refresh_token = refreshed.refresh_token;
  writeJson(tokenFilePath(), next);
  return next.access_token;
}

export async function gscFetch(pathname, { method = 'GET', body = null } = {}) {
  const accessToken = await getGscAccessToken();
  const res = await gscFetchImpl(`https://www.googleapis.com/webmasters/v3${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = formatGscApiError(json, text || `GSC API ${res.status}`);
    if (res.status === 401 && isGscRefreshRevoked(json, msg)) {
      disconnectGsc();
      throw gscAuthRevokedError(msg);
    }
    throw Object.assign(new Error(msg), {
      status: res.status >= 400 ? res.status : 502,
      details: json,
    });
  }
  return json;
}
