/**
 * Phase A: provision a Twilio local DID for ranking, wire voice webhook, patch site-config.phone.
 * Voice webhooks must be a public Twilio Function URL — Rover binds 127.0.0.1 only.
 */
import twilio from 'twilio';
import { patchLaunchSiteConfig } from './launch-site.mjs';

function env(name) {
  return String(process.env[name] || '').trim();
}

export function assertTwilioEnv() {
  const missing = [];
  for (const key of [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FORWARD_TO',
    'TWILIO_VOICE_WEBHOOK_URL',
  ]) {
    if (!env(key)) missing.push(key);
  }
  if (missing.length) {
    throw Object.assign(
      new Error(`Missing Twilio env: ${missing.join(', ')}. See docs/PHONE-TRACKING.md`),
      { status: 400 },
    );
  }
  const forward = env('TWILIO_FORWARD_TO');
  if (!/^\+[1-9]\d{7,14}$/.test(forward)) {
    throw Object.assign(
      new Error('TWILIO_FORWARD_TO must be E.164 (e.g. +18015551234)'),
      { status: 400 },
    );
  }
  const webhook = env('TWILIO_VOICE_WEBHOOK_URL');
  if (!/^https:\/\//i.test(webhook)) {
    throw Object.assign(
      new Error('TWILIO_VOICE_WEBHOOK_URL must be a public https URL (Twilio Function)'),
      { status: 400 },
    );
  }
}

function twilioClient() {
  assertTwilioEnv();
  return twilio(env('TWILIO_ACCOUNT_SID'), env('TWILIO_AUTH_TOKEN'));
}

/** Normalize to display phone for site-config CTAs. */
export function formatTrackingPhone(e164) {
  const digits = String(e164 || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return String(e164 || '').trim();
}

function voiceUrlForSite(businessName, { siteId = '', forwardTo = '' } = {}) {
  const base = env('TWILIO_VOICE_WEBHOOK_URL').replace(/\?.*$/, '').replace(/\/+$/, '');
  const params = new URLSearchParams();
  params.set('site', String(businessName || 'ranking site').slice(0, 80));
  if (siteId) params.set('siteId', String(siteId));
  const forward = String(forwardTo || env('TWILIO_FORWARD_TO') || '').trim();
  if (forward) params.set('forward', forward);
  return `${base}?${params.toString()}`;
}

function e164Digits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function normalizeForwardE164(phone) {
  const digits = e164Digits(phone);
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  const raw = String(phone || '').trim();
  if (/^\+[1-9]\d{7,14}$/.test(raw)) return raw;
  return '';
}

/**
 * Search available US local numbers by locality/state, optional areaCode override.
 */
export async function findAvailableLocalNumber({ city, state, areaCode } = {}) {
  const client = twilioClient();
  const area = String(areaCode || '').replace(/\D/g, '').slice(0, 3);

  if (area.length === 3) {
    const byArea = await client.availablePhoneNumbers('US').local.list({
      areaCode: area,
      voiceEnabled: true,
      limit: 5,
    });
    if (byArea.length) return byArea[0];
  }

  const locality = String(city || '').trim();
  const region = String(state || '').trim().toUpperCase();
  if (locality && region) {
    const byCity = await client.availablePhoneNumbers('US').local.list({
      inLocality: locality,
      inRegion: region,
      voiceEnabled: true,
      limit: 5,
    });
    if (byCity.length) return byCity[0];
  }

  if (region) {
    const byState = await client.availablePhoneNumbers('US').local.list({
      inRegion: region,
      voiceEnabled: true,
      limit: 5,
    });
    if (byState.length) return byState[0];
  }

  throw Object.assign(
    new Error(
      `No Twilio local numbers found for ${[locality, region].filter(Boolean).join(', ') || 'request'}${
        area ? ` (area ${area})` : ''
      }`,
    ),
    { status: 404 },
  );
}

/**
 * Buy number, attach voice webhook, patch site-config.phone.
 * @param {{ site: object, areaCode?: string, force?: boolean }} opts
 */
export async function provisionRankingNumber({ site, areaCode, force = false } = {}) {
  assertTwilioEnv();

  if (!site?.candidateId) {
    throw Object.assign(
      new Error('Site must be linked to a candidate (accepted site-config required)'),
      { status: 400 },
    );
  }

  const existing = site.phoneTracking || {};
  if (
    !force &&
    existing.provider === 'twilio' &&
    existing.twilioSid &&
    existing.phase === 'ranking'
  ) {
    throw Object.assign(
      new Error(
        `Twilio number already provisioned (${existing.e164 || existing.twilioSid}). Pass force:true to buy another.`,
      ),
      { status: 409 },
    );
  }

  const city = site.city || null;
  const state = site.state || null;
  const businessName = site.businessName || site.niche || site.candidateId;
  const forwardTo = env('TWILIO_FORWARD_TO');
  const available = await findAvailableLocalNumber({ city, state, areaCode });
  const phoneNumber = available.phoneNumber;
  const voiceUrl = voiceUrlForSite(businessName, {
    siteId: site.id || '',
    forwardTo,
  });

  const client = twilioClient();
  let purchased;
  try {
    purchased = await client.incomingPhoneNumbers.create({
      phoneNumber,
      friendlyName: `Rover ranking: ${String(businessName).slice(0, 40)}`,
      voiceUrl,
      voiceMethod: 'POST',
    });
  } catch (error) {
    const msg = error?.message || String(error);
    throw Object.assign(new Error(`Twilio buy failed: ${msg}`), {
      status: error?.status || 502,
    });
  }

  const e164 = purchased.phoneNumber || phoneNumber;
  const displayPhone = formatTrackingPhone(e164);

  try {
    patchLaunchSiteConfig(site.candidateId, { phone: displayPhone });
  } catch (error) {
    throw Object.assign(
      new Error(
        `Twilio number ${e164} purchased (SID ${purchased.sid}) but site-config patch failed: ${error.message}`,
      ),
      { status: error.status || 500, twilioSid: purchased.sid, e164 },
    );
  }

  return {
    e164,
    phone: displayPhone,
    twilioSid: purchased.sid,
    voiceWebhookUrl: voiceUrl,
    forwardTo,
    phoneTracking: {
      phase: 'ranking',
      provider: 'twilio',
      e164,
      twilioSid: purchased.sid,
      voiceWebhookUrl: voiceUrl,
      forwardTo,
      provisionedAt: new Date().toISOString(),
    },
  };
}

/**
 * Rewrite DID voiceUrl with a new forward target (same number). Used on rent cutover.
 * @param {{ site: object, forwardTo: string, phase?: 'ranking'|'rented' }} opts
 */
export async function updateForwardTarget({ site, forwardTo, phase } = {}) {
  assertTwilioEnv();
  const pt = site?.phoneTracking || {};
  if (pt.provider !== 'twilio' || !pt.twilioSid) {
    throw Object.assign(new Error('Site has no Twilio DID to update'), { status: 400 });
  }
  const e164Forward = normalizeForwardE164(forwardTo);
  if (!e164Forward) {
    throw Object.assign(
      new Error('forwardTo must be a valid US/E.164 phone (e.g. +18015551234)'),
      { status: 400 },
    );
  }
  const businessName = site.businessName || site.niche || site.candidateId || 'ranking site';
  const voiceUrl = voiceUrlForSite(businessName, {
    siteId: site.id || '',
    forwardTo: e164Forward,
  });
  const client = twilioClient();
  try {
    await client.incomingPhoneNumbers(pt.twilioSid).update({
      voiceUrl,
      voiceMethod: 'POST',
    });
  } catch (error) {
    throw Object.assign(new Error(`Twilio voiceUrl update failed: ${error?.message || error}`), {
      status: error?.status || 502,
    });
  }
  const nextPhase = phase || pt.phase || 'ranking';
  return {
    forwardTo: e164Forward,
    voiceWebhookUrl: voiceUrl,
    phoneTracking: {
      ...pt,
      phase: nextPhase,
      provider: 'twilio',
      e164: pt.e164,
      twilioSid: pt.twilioSid,
      voiceWebhookUrl: voiceUrl,
      forwardTo: e164Forward,
      provisionedAt: pt.provisionedAt || new Date().toISOString(),
      forwardedAt: new Date().toISOString(),
    },
  };
}

/**
 * Rent cutover: keep same DID, forward to renter.phone, phase → rented.
 */
export async function setForwardToRenter(site) {
  const renterPhone = site?.renter?.phone;
  const e164 = normalizeForwardE164(renterPhone);
  if (!e164) {
    throw Object.assign(
      new Error('Set renter phone (E.164 or 10-digit US) before forwarding'),
      { status: 400 },
    );
  }
  return updateForwardTarget({ site, forwardTo: e164, phase: 'rented' });
}
