/**
 * Local Rover profile. API keys stay in research/_rover/secrets.json.
 * This checkout keeps using research/ and .env until a value is saved here.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ACCOUNT_FIELDS, accountField, maskSecret } from './account-setup-catalog.mjs';
import { RESEARCH_DIR, ROOT } from './research-dir.mjs';
import { isSourceCheckout } from './source-checkout.mjs';

const ROVER_DIR = path.join(RESEARCH_DIR, '_rover');
const PROFILE_FILE = path.join(ROVER_DIR, 'profile.json');
const SECRETS_FILE = path.join(ROVER_DIR, 'secrets.json');
const DATA_ROOT_FILE = path.join(ROOT, 'rover-data-root.json');

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function profilePaths() {
  return { dir: ROVER_DIR, profile: PROFILE_FILE, secrets: SECRETS_FILE };
}

export function readProfile() {
  const data = readJson(PROFILE_FILE, {});
  const fields = data.fields && typeof data.fields === 'object' ? data.fields : {};
  return {
    fields,
    accountEmail: String(data.accountEmail || '').trim(),
    entitlement: data.entitlement && typeof data.entitlement === 'object' ? data.entitlement : null,
  };
}

export function readSecrets() {
  const data = readJson(SECRETS_FILE, {});
  return data && typeof data === 'object' ? data : {};
}

function storedValue(field, profile, secrets) {
  if (field.secret) {
    if (!Object.prototype.hasOwnProperty.call(secrets, field.id)) return undefined;
    return String(secrets[field.id] ?? '');
  }
  if (!Object.prototype.hasOwnProperty.call(profile.fields, field.id)) return undefined;
  return String(profile.fields[field.id] ?? '');
}

export function currentFieldValue(field) {
  const profile = readProfile();
  const secrets = readSecrets();
  const saved = storedValue(field, profile, secrets);
  if (saved !== undefined) return saved.trim();
  if (field.env === 'LEAD_NOTIFY_EMAIL') {
    return String(process.env.LEAD_NOTIFY_EMAIL || process.env.WEB3FORMS_DEFAULT_NOTIFY_EMAIL || '').trim();
  }
  return String(process.env[field.env] || '').trim();
}

export function applySavedProfile() {
  const profile = readProfile();
  const secrets = readSecrets();
  for (const field of ACCOUNT_FIELDS) {
    const saved = storedValue(field, profile, secrets);
    if (saved === undefined) continue;
    const value = saved.trim();
    if (value) process.env[field.env] = value;
    else delete process.env[field.env];
  }
  const token = String(secrets.accountToken || '').trim();
  if (token) process.env.ROVER_ACCOUNT_TOKEN = token;
}

function publicField(field, profile, secrets) {
  const saved = storedValue(field, profile, secrets);
  const value = saved !== undefined ? saved.trim() : currentFieldValue(field);
  if (field.secret) {
    const mask = maskSecret(value);
    return {
      id: field.id,
      group: field.group,
      label: field.label,
      secret: true,
      optional: Boolean(field.optional),
      kind: field.kind || 'secret',
      button: field.button,
      guide: field.guide,
      set: mask.set,
      last4: mask.last4,
      savedHere: saved !== undefined,
    };
  }
  return {
    id: field.id,
    group: field.group,
    label: field.label,
    secret: false,
    optional: Boolean(field.optional),
    kind: field.kind || 'text',
    button: field.button,
    guide: field.guide,
    set: Boolean(value),
    value,
    savedHere: saved !== undefined,
  };
}

export function accountSetupView() {
  const profile = readProfile();
  const secrets = readSecrets();
  return {
    ok: true,
    sourceCheckout: isSourceCheckout(),
    fields: ACCOUNT_FIELDS.map((field) => publicField(field, profile, secrets)),
    accountEmail: profile.accountEmail,
  };
}

export function saveAccountSetup(updates) {
  const incoming = updates && typeof updates === 'object' ? updates : {};
  const profile = readProfile();
  const secrets = readSecrets();
  let sitesChanged = false;
  for (const [id, raw] of Object.entries(incoming)) {
    if (id === 'accountToken') continue;
    const field = accountField(id);
    if (!field) continue;
    if (raw === undefined) continue;
    const value = raw == null ? '' : String(raw).trim();
    if (field.secret) secrets[field.id] = value;
    else profile.fields[field.id] = value;
    if (field.id === 'sitesFolder') sitesChanged = true;
  }
  writeJson(PROFILE_FILE, {
    fields: profile.fields,
    accountEmail: profile.accountEmail,
    entitlement: profile.entitlement,
  });
  writeJson(SECRETS_FILE, secrets);
  applySavedProfile();
  let restartRequired = false;
  if (sitesChanged && !isSourceCheckout()) {
    const sitesFolder = String(profile.fields.sitesFolder || '').trim();
    if (sitesFolder) {
      writeJson(DATA_ROOT_FILE, { sitesFolder });
      restartRequired = true;
    }
  }
  return { ...accountSetupView(), restartRequired };
}

export function saveAccountSession({ email, token, entitlement }) {
  const profile = readProfile();
  const secrets = readSecrets();
  profile.accountEmail = String(email || '').trim();
  if (entitlement) profile.entitlement = entitlement;
  if (token) secrets.accountToken = String(token);
  if (token === null) delete secrets.accountToken;
  writeJson(PROFILE_FILE, {
    fields: profile.fields,
    accountEmail: profile.accountEmail,
    entitlement: profile.entitlement,
  });
  writeJson(SECRETS_FILE, secrets);
  applySavedProfile();
  return readProfile();
}

export function ensureMachineId() {
  const profile = readProfile();
  let machineId = String(profile.fields.machineId || '').trim();
  if (machineId) return machineId;
  machineId = randomUUID();
  profile.fields.machineId = machineId;
  writeJson(PROFILE_FILE, {
    fields: profile.fields,
    accountEmail: profile.accountEmail,
    entitlement: profile.entitlement,
  });
  return machineId;
}

export function localAccountToken() {
  const secrets = readSecrets();
  return String(secrets.accountToken || '').trim();
}
