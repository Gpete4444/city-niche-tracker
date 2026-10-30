/**
 * Saved spam phrases for form leads and phone calls.
 * Matching is case-insensitive and looks for the whole phrase.
 * Storage: research/spam-keywords.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RESEARCH_DIR } from './candidates.mjs';

const FILE = path.join(RESEARCH_DIR, 'spam-keywords.json');
const MAX_KEYWORDS = 100;
const MAX_LENGTH = 80;

export const DEFAULT_SPAM_KEYWORDS = [
  'seo',
  'website improvement',
  'xfinity',
  'angie',
  'angi',
  'usbusinessonline',
];

export function normalizeSpamKeywords(input) {
  const source = Array.isArray(input) ? input : [];
  const seen = new Set();
  const keywords = [];
  for (const raw of source) {
    const phrase = String(raw || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .slice(0, MAX_LENGTH);
    if (!phrase || seen.has(phrase)) continue;
    seen.add(phrase);
    keywords.push(phrase);
    if (keywords.length >= MAX_KEYWORDS) break;
  }
  return keywords;
}

function writeKeywords(keywords) {
  mkdirSync(RESEARCH_DIR, { recursive: true });
  writeFileSync(FILE, `${JSON.stringify({ keywords }, null, 2)}\n`, 'utf8');
}

export function loadSpamKeywords() {
  try {
    if (!existsSync(FILE)) {
      writeKeywords(DEFAULT_SPAM_KEYWORDS);
      return [...DEFAULT_SPAM_KEYWORDS];
    }
    const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
    const keywords = normalizeSpamKeywords(parsed?.keywords);
    return keywords.length ? keywords : [...DEFAULT_SPAM_KEYWORDS];
  } catch {
    return [...DEFAULT_SPAM_KEYWORDS];
  }
}

export function saveSpamKeywords(input) {
  if (!Array.isArray(input)) {
    const err = new Error('keywords must be a list');
    err.status = 400;
    throw err;
  }
  const keywords = normalizeSpamKeywords(input);
  writeKeywords(keywords);
  return keywords;
}

/** Whole phrase, not a piece of a longer word. "angi" does not match "changing". */
export function textMatchesSpam(text, keywords = loadSpamKeywords()) {
  const hay = ` ${String(text || '').toLowerCase()} `;
  return (keywords || []).some((phrase) => {
    const needle = String(phrase || '').trim().toLowerCase();
    if (!needle) return false;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ +/g, '\\s+');
    return new RegExp(`[^a-z0-9]${escaped}[^a-z0-9]`, 'i').test(hay);
  });
}

function savedSpamChoice(row) {
  if (row?.spamOverride === true || row?.spamOverride === false) return row.spamOverride;
  return null;
}

export function formIsSpam(form, keywords = loadSpamKeywords()) {
  const choice = savedSpamChoice(form);
  if (choice !== null) return choice;
  const hay = [form?.name, form?.email, form?.phone, form?.service, form?.message]
    .map((part) => String(part || ''))
    .join('\n');
  return textMatchesSpam(hay, keywords);
}

/** A call with no summary and no transcript is not spam, unless it was marked by hand. */
export function callIsSpam(call, keywords = loadSpamKeywords()) {
  const choice = savedSpamChoice(call);
  if (choice !== null) return choice;
  const summary = String(call?.summary || '').trim();
  const transcript = String(call?.transcript || '').trim();
  if (!summary && !transcript) return false;
  return textMatchesSpam(`${summary}\n${transcript}`, keywords);
}
