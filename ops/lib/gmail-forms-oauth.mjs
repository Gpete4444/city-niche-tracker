/**
 * Gmail readonly OAuth for importing past Web3Forms leads.
 * Separate token from Search Console: research/gmail-forms-oauth.json
 *
 * Reuses GOOGLE_GSC_CLIENT_ID / GOOGLE_GSC_CLIENT_SECRET.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { RESEARCH_DIR } from './candidates.mjs';

const TOKEN_FILE = path.join(RESEARCH_DIR, 'gmail-forms-oauth.json');
const PENDING_FILE = path.join(RESEARCH_DIR, 'gmail-forms-oauth-pending.json');
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const LOGIN_HINT = 'paulthiriot@gmail.com';

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

export function gmailFormsClientConfigured() {
  return Boolean(
    String(process.env.GOOGLE_GSC_CLIENT_ID || '').trim() &&
      String(process.env.GOOGLE_GSC_CLIENT_SECRET || '').trim(),
  );
}

export function gmailFormsRedirectUri(port = Number(process.env.OPS_PORT) || 8787) {
  return `http://127.0.0.1:${port}/api/forms/gmail/callback`;
}

export function getGmailFormsAuthStatus() {
  const tokens = readJson(TOKEN_FILE, null);
  return {
    configured: gmailFormsClientConfigured(),
    connected: Boolean(tokens?.refresh_token || tokens?.access_token),
    email: tokens?.email || null,
    scope: tokens?.scope || null,
    updatedAt: tokens?.updatedAt || null,
    redirectUri: gmailFormsRedirectUri(),
  };
}

export function startGmailFormsOAuth({ port } = {}) {
  if (!gmailFormsClientConfigured()) {
    throw Object.assign(
      new Error('Set GOOGLE_GSC_CLIENT_ID and GOOGLE_GSC_CLIENT_SECRET in .env before connecting Gmail.'),
      { status: 400 },
    );
  }
  const state = crypto.randomBytes(24).toString('hex');
  const redirectUri = gmailFormsRedirectUri(port);
  writeJson(PENDING_FILE, { state, redirectUri, createdAt: new Date().toISOString() });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_GSC_CLIENT_ID.trim(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    login_hint: LOGIN_HINT,
    state,
  });
  return { authUrl: `${AUTH_URL}?${params.toString()}`, redirectUri };
}

async function postToken(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error_description || json.error || `Token request failed (${res.status})`);
    err.status = res.status === 401 ? 401 : 400;
    throw err;
  }
  return json;
}

async function fetchTokenEmail(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.email || null;
  } catch {
    return null;
  }
}

export async function completeGmailFormsOAuth({ code, state }) {
  const pending = readJson(PENDING_FILE, null);
  if (!pending?.state || pending.state !== state) {
    throw Object.assign(new Error('Invalid or expired Gmail login. Start Import past leads again.'), {
      status: 400,
    });
  }
  if (!code) throw Object.assign(new Error('Missing OAuth code'), { status: 400 });
  const tokenJson = await postToken(
    new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_GSC_CLIENT_ID.trim(),
      client_secret: process.env.GOOGLE_GSC_CLIENT_SECRET.trim(),
      redirect_uri: pending.redirectUri,
      grant_type: 'authorization_code',
    }),
  );
  const prev = readJson(TOKEN_FILE, null) || {};
  const refresh_token = tokenJson.refresh_token || prev.refresh_token;
  if (!refresh_token) {
    throw Object.assign(
      new Error('Google did not return a refresh token. Remove Rover’s Gmail access and connect again.'),
      { status: 400 },
    );
  }
  const email = await fetchTokenEmail(tokenJson.access_token);
  writeJson(TOKEN_FILE, {
    access_token: tokenJson.access_token,
    refresh_token,
    expiry_date: Date.now() + (Number(tokenJson.expires_in) || 3600) * 1000,
    scope: tokenJson.scope || SCOPE,
    token_type: tokenJson.token_type || 'Bearer',
    email,
    updatedAt: new Date().toISOString(),
  });
  try {
    unlinkSync(PENDING_FILE);
  } catch {
    /* ignore */
  }
  return getGmailFormsAuthStatus();
}

export async function getGmailFormsAccessToken() {
  if (!gmailFormsClientConfigured()) {
    throw Object.assign(new Error('Gmail OAuth client is not configured in .env'), { status: 400 });
  }
  const tokens = readJson(TOKEN_FILE, null);
  if (!tokens?.refresh_token && !tokens?.access_token) {
    const err = new Error('Gmail is not connected. Use Import past leads on Phone/Form.');
    err.status = 401;
    err.needsGmail = true;
    throw err;
  }
  if (tokens.access_token && tokens.expiry_date && Date.now() < tokens.expiry_date - 60_000) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) {
    const err = new Error('Gmail login expired. Use Import past leads to connect again.');
    err.status = 401;
    err.needsGmail = true;
    throw err;
  }
  const json = await postToken(
    new URLSearchParams({
      client_id: process.env.GOOGLE_GSC_CLIENT_ID.trim(),
      client_secret: process.env.GOOGLE_GSC_CLIENT_SECRET.trim(),
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  );
  const next = {
    ...tokens,
    access_token: json.access_token,
    expiry_date: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    updatedAt: new Date().toISOString(),
  };
  writeJson(TOKEN_FILE, next);
  return next.access_token;
}
