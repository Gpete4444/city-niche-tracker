/**
 * Import past Web3Forms emails from paulthiriot@gmail.com into the local
 * form submission log. Does not write the Cloudflare inbox.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RESEARCH_DIR } from './candidates.mjs';
import { getGmailFormsAccessToken, getGmailFormsAuthStatus } from './gmail-forms-oauth.mjs';
import { normalizeLeadDomain, upsertFormSubmissions } from './form-submissions.mjs';
import { listLaunchedSites } from './sites.mjs';

const PROGRESS_FILE = path.join(RESEARCH_DIR, 'gmail-forms-import.json');
/** Stay under Gmail's per-minute query-cost cap. messages.get costs 5 units. */
const GET_GAP_MS = 1300;

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const QUERY = 'in:anywhere (from:web3forms.com OR subject:Lead:)';
const EXPECTED_INBOX = 'paulthiriot@gmail.com';

const LABEL_MAP = [
  ['what do you need?', 'service'],
  ['email address', 'email'],
  ['phone number', 'phone'],
  ['your name', 'name'],
  ['message', 'message'],
  ['details', 'message'],
  ['comments', 'message'],
  ['comment', 'message'],
  ['service', 'service'],
  ['phone', 'phone'],
  ['email', 'email'],
  ['name', 'name'],
];

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\\u0026/g, '&');
}

export function htmlToText(html) {
  return decodeEntities(String(html || ''))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h\d|li|table)>/gi, '\n')
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ': ')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeBase64Url(data) {
  const pad = String(data || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = pad + '='.repeat((4 - (pad.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function collectParts(part, out) {
  if (!part) return;
  if (part.body?.data && (part.mimeType === 'text/plain' || part.mimeType === 'text/html')) {
    out.push({ mime: part.mimeType, text: decodeBase64Url(part.body.data) });
  }
  for (const child of part.parts || []) collectParts(child, out);
}

export function messageTextFromGmail(message) {
  const parts = [];
  collectParts(message?.payload, parts);
  const plain = parts.find((part) => part.mime === 'text/plain');
  const html = parts.find((part) => part.mime === 'text/html');
  if (plain?.text?.trim()) return plain.text;
  if (html?.text) return htmlToText(html.text);
  if (message?.payload?.body?.data) return decodeBase64Url(message.payload.body.data);
  return '';
}

export function headerValue(message, name) {
  const headers = message?.payload?.headers || [];
  const hit = headers.find((header) => String(header.name || '').toLowerCase() === name.toLowerCase());
  return String(hit?.value || '').trim();
}

function normalizeName(value) {
  return decodeEntities(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function fieldForLabel(raw) {
  const key = String(raw || '')
    .trim()
    .replace(/^[*_]+|[*_]+$/g, '')
    .replace(/:$/, '')
    .trim()
    .toLowerCase();
  const mapped = LABEL_MAP.find(([label]) => label === key);
  return mapped ? mapped[1] : '';
}

function labelAt(line) {
  const match = String(line || '').match(/^\s*([^:]{2,40})\s*:\s*(.*)$/);
  if (!match) return null;
  const field = fieldForLabel(match[1]);
  if (!field) return null;
  return { field, value: match[2].trim() };
}

/**
 * Pull lead fields out of a Web3Forms email body.
 * Accepts "Name: Jane" lines and a label on its own line with the value below.
 * @param {string} text
 */
export function parseWeb3FormsBody(text) {
  const lines = htmlToText(text).split('\n');
  const fields = { name: '', phone: '', email: '', service: '', message: '' };
  let current = '';
  const chunks = { name: [], phone: [], email: [], service: [], message: [] };
  for (const line of lines) {
    const bare = fieldForLabel(line);
    const labeled = labelAt(line);
    if (labeled) {
      current = labeled.field;
      if (labeled.value) chunks[current].push(labeled.value);
      continue;
    }
    if (bare && line.trim().length <= 40) {
      current = bare;
      continue;
    }
    if (!current) continue;
    const trimmed = line.trim();
    if (!trimmed || /^--\s*$/.test(trimmed) || /this (email|message) was sent|web3forms/i.test(trimmed)) {
      if (/this (email|message) was sent|web3forms/i.test(trimmed)) current = '';
      continue;
    }
    chunks[current].push(trimmed);
  }
  for (const key of Object.keys(fields)) {
    fields[key] = chunks[key].join(key === 'message' ? '\n' : ' ').trim();
  }
  return fields;
}

/**
 * @param {{ domain?: string, businessName?: string }[]} sites
 * @param {{ subject?: string, text?: string }} mail
 */
export function matchLeadSite(sites, mail) {
  const haystack = `${mail.subject || ''}\n${mail.text || ''}`;
  const lower = haystack.toLowerCase();
  let domainHit = null;
  for (const site of sites || []) {
    const domain = normalizeLeadDomain(site.domain);
    if (!domain || !domain.includes('.')) continue;
    if (lower.includes(domain) && (!domainHit || domain.length > domainHit.domain.length)) {
      domainHit = { ...site, domain };
    }
  }
  if (domainHit) return domainHit;

  const named = normalizeName(haystack);
  let nameHit = null;
  for (const site of sites || []) {
    const business = normalizeName(site.businessName);
    if (business.length < 4) continue;
    if (named.includes(business) && (!nameHit || business.length > normalizeName(nameHit.businessName).length)) {
      nameHit = site;
    }
  }
  return nameHit;
}

export function pageUrlFromText(text, domain) {
  const host = normalizeLeadDomain(domain);
  if (!host) return '';
  const matches = String(text || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
  for (const raw of matches) {
    const url = raw.replace(/[),.;]+$/, '');
    if (url.toLowerCase().includes(host)) return url;
  }
  return '';
}

/**
 * @param {{ id: string, subject?: string, text?: string, internalDate?: string }} mail
 * @param {{ domain?: string, businessName?: string }[]} sites
 */
export function leadFromMail(mail, sites) {
  const text = String(mail.text || '');
  const site = matchLeadSite(sites, { subject: mail.subject, text });
  if (!site) return null;
  const fields = parseWeb3FormsBody(text);
  if (!fields.name && !fields.phone && !fields.email && !fields.message) return null;
  const submittedMs = Number(mail.internalDate);
  const submittedAt = Number.isFinite(submittedMs) && submittedMs > 0
    ? new Date(submittedMs).toISOString()
    : new Date().toISOString();
  return {
    id: `gmail_${mail.id}`,
    domain: normalizeLeadDomain(site.domain),
    submittedAt,
    pageUrl: pageUrlFromText(text, site.domain),
    ...fields,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadProgress() {
  if (!existsSync(PROGRESS_FILE)) return { ids: {} };
  try {
    const parsed = JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'));
    return parsed && typeof parsed.ids === 'object' && parsed.ids ? parsed : { ids: {} };
  } catch {
    return { ids: {} };
  }
}

function saveProgress(progress) {
  writeFileSync(PROGRESS_FILE, `${JSON.stringify(progress)}\n`, 'utf8');
}

function quotaWaitMs(res) {
  const header = Number(res.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  return 65_000;
}

async function gmailGet(token, pathAndQuery) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await fetch(`${GMAIL_API}${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    const message = json?.error?.message || '';
    if (res.ok) return json;
    if (res.status === 429 || /quota exceeded/i.test(message)) {
      await sleep(quotaWaitMs(res));
      continue;
    }
    const err = new Error(message || `Gmail API failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const err = new Error('Gmail is still over its per-minute limit. Wait a minute and import again.');
  err.status = 429;
  throw err;
}

export async function importPastLeadsFromGmail() {
  const status = getGmailFormsAuthStatus();
  if (status.email && status.email.toLowerCase() !== EXPECTED_INBOX) {
    throw Object.assign(
      new Error(`Connected Gmail is ${status.email}. Sign in as ${EXPECTED_INBOX}.`),
      { status: 400 },
    );
  }
  const token = await getGmailFormsAccessToken();
  const sites = listLaunchedSites();
  const progress = loadProgress();
  let scanned = 0;
  let skipped = 0;
  let matched = 0;
  let added = 0;
  let pageToken = '';
  for (let page = 0; page < 80; page += 1) {
    const query = new URLSearchParams({ q: QUERY, maxResults: '50' });
    if (pageToken) query.set('pageToken', pageToken);
    const listed = await gmailGet(token, `/messages?${query.toString()}`);
    const ids = listed.messages || [];
    if (!ids.length) break;
    for (const item of ids) {
      if (progress.ids[item.id]) {
        if (progress.ids[item.id] === 'lead') matched += 1;
        else skipped += 1;
        continue;
      }
      scanned += 1;
      if (scanned === 1 || scanned % 10 === 0) {
        console.log(`gmail import fetched ${scanned}, matched ${matched}, skipped ${skipped}`);
      }
      await sleep(GET_GAP_MS);
      const message = await gmailGet(token, `/messages/${encodeURIComponent(item.id)}?format=full`);
      const lead = leadFromMail(
        {
          id: message.id,
          subject: headerValue(message, 'subject'),
          text: messageTextFromGmail(message),
          internalDate: message.internalDate,
        },
        sites,
      );
      if (!lead) {
        skipped += 1;
        progress.ids[item.id] = 'skip';
        saveProgress(progress);
        continue;
      }
      const saved = upsertFormSubmissions([lead]);
      added += saved.added;
      matched += 1;
      progress.ids[item.id] = 'lead';
      saveProgress(progress);
    }
    pageToken = listed.nextPageToken || '';
    if (!pageToken) break;
  }
  return {
    ok: true,
    scanned,
    matched,
    skipped,
    added,
    inbox: status.email || EXPECTED_INBOX,
  };
}
