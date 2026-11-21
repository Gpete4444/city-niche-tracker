/**
 * Phase A: provision a Twilio local DID for ranking, wire voice webhook, patch site-config.phone.
 * Voice webhooks must be a public Twilio Function URL — Rover binds 127.0.0.1 only.
 */
import twilio from 'twilio';
import { cityAreaCodes } from './city-area-codes.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { featureCentroid, findPlaceFeatureLocal } from './geo-neighbors.mjs';
import { patchLaunchSiteConfig } from './launch-site.mjs';
import { areaCodeOf, chooseLocalNumber, closestAvailable } from './phone-area-choice.mjs';
import { equivalentPlaceNames } from './place-common-names.mjs';
import { listSites, setSitePhoneTracking } from './sites.mjs';

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

/** Prepaid remaining + all-time spend. Needs SID + token only (not forward / webhook). */
export async function fetchTwilioBalance() {
  const sid = env('TWILIO_ACCOUNT_SID');
  const token = env('TWILIO_AUTH_TOKEN');
  const fetchedAt = new Date().toISOString();
  if (!sid || !token) {
    return {
      ok: false,
      configured: false,
      balance: null,
      spentAllTime: null,
      currency: null,
      error: 'Twilio credentials missing',
      fetchedAt,
    };
  }
  const client = twilio(sid, token);
  const [balR, spendR] = await Promise.allSettled([
    client.balance.fetch(),
    client.usage.records.allTime.list({ category: 'totalprice', limit: 1 }),
  ]);
  const row = balR.status === 'fulfilled' ? balR.value : null;
  const n = Number(row?.balance);
  const spendRow = spendR.status === 'fulfilled' ? spendR.value?.[0] : null;
  const spent = Number(spendRow?.price);
  if (balR.status !== 'fulfilled') {
    return {
      ok: false,
      configured: true,
      balance: null,
      spentAllTime: Number.isFinite(spent) ? spent : null,
      currency: null,
      error: balR.reason?.message || String(balR.reason),
      fetchedAt,
    };
  }
  return {
    ok: true,
    configured: true,
    balance: Number.isFinite(n) ? n : null,
    spentAllTime: Number.isFinite(spent) ? spent : null,
    currency: row?.currency || 'USD',
    error: null,
    fetchedAt,
  };
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

function voiceUrlForSite(businessName, { siteId = '', forwardTo = '', mode = '' } = {}) {
  const base = env('TWILIO_VOICE_WEBHOOK_URL').replace(/\?.*$/, '').replace(/\/+$/, '');
  const params = new URLSearchParams();
  params.set('site', String(businessName || 'ranking site').slice(0, 80));
  if (siteId) params.set('siteId', String(siteId));
  const resolvedMode = String(mode || '').trim().toLowerCase();
  const forward = String(forwardTo || '').trim();
  if (resolvedMode === 'voicemail' || resolvedMode === 'ranking' || (!forward && resolvedMode !== 'dial')) {
    params.set('mode', 'voicemail');
  } else if (forward) {
    params.set('forward', forward);
  }
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

/** Best-effort release so a failed patch does not leave a paid orphan DID. */
export async function releaseTwilioNumber(sid) {
  const id = String(sid || '').trim();
  if (!id) return { ok: false, skipped: true };
  try {
    const client = twilioClient();
    await client.incomingPhoneNumbers(id).remove();
    return { ok: true, sid: id };
  } catch (error) {
    return { ok: false, sid: id, error: error?.message || String(error) };
  }
}

const SEARCH_RADII_MILES = [25, 50, 100, 250, 500];
const LIST_LIMIT = 20;

/**
 * Search US local numbers: the city's area codes first, then the closest number in the state.
 * A typed area code never falls through to a different code.
 */
async function listLocalNumbers(client, filters) {
  return client.availablePhoneNumbers('US').local.list({
    voiceEnabled: true,
    limit: LIST_LIMIT,
    ...filters,
  });
}

function dedupeNumbers(numbers) {
  const seen = new Set();
  const out = [];
  for (const number of numbers || []) {
    const id = number?.phoneNumber;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(number);
  }
  return out;
}

function localityQueries(city, state) {
  const out = [];
  const add = (value) => {
    const text = String(value || '').trim();
    if (!text || out.some((item) => item.toLowerCase() === text.toLowerCase())) return;
    out.push(text);
  };
  for (const name of equivalentPlaceNames(city, state)) add(name);
  for (const name of [...out]) {
    add(name.replace(/\bSt\.?\b/gi, 'Saint').replace(/\bMt\.?\b/gi, 'Mount').replace(/\bFt\.?\b/gi, 'Fort'));
    add(name.replace(/\bSaint\b/gi, 'St.').replace(/\bMount\b/gi, 'Mt.').replace(/\bFort\b/gi, 'Ft.'));
  }
  return out;
}

function cityCentroid(city, state) {
  try {
    const feature = findPlaceFeatureLocal(city, state);
    const centroid = feature ? featureCentroid(feature) : null;
    if (!centroid) return null;
    const [lng, lat] = centroid;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

function packChoice(choice, match) {
  const number = choice.number;
  const miles = choice.miles;
  return {
    phoneNumber: number.phoneNumber,
    locality: number.locality || '',
    region: number.region || '',
    latitude: number.latitude ?? null,
    longitude: number.longitude ?? null,
    areaCode: areaCodeOf(number),
    distanceMiles: Number.isFinite(miles) ? Math.round(miles * 10) / 10 : null,
    match,
  };
}

function noNumberError({ city, state, areaCode, reason }) {
  const place = [city, state].filter(Boolean).join(', ') || 'that city';
  const area = String(areaCode || '').replace(/\D/g, '').slice(0, 3);
  const message = area.length === 3
    ? `No Twilio numbers available in area code ${area} for ${place}`
    : reason || `No Twilio numbers available in ${place} area codes or within 500 miles in the state`;
  return Object.assign(new Error(message), { status: 404 });
}

async function gatherAreaCodes(client, npas, filters) {
  const batches = await Promise.all(
    npas.map((areaCode) => listLocalNumbers(client, { ...filters, areaCode })),
  );
  return dedupeNumbers(batches.flat());
}

/** SMS at this radius, then voice, across every area code, before the radius widens. */
async function pickAreaCodeInventory(client, npas, { region, centroid, constrainRegion }) {
  const near = centroid ? `${centroid.lat},${centroid.lng}` : '';
  const regionFilter = constrainRegion && region ? { inRegion: region } : {};
  const consider = async (filters) => {
    const sms = await gatherAreaCodes(client, npas, { ...filters, ...regionFilter, smsEnabled: true });
    const smsPick = closestAvailable(sms, centroid?.lat, centroid?.lng);
    if (smsPick) return smsPick;
    const voice = await gatherAreaCodes(client, npas, { ...filters, ...regionFilter });
    return closestAvailable(voice, centroid?.lat, centroid?.lng);
  };
  if (near) {
    for (const distance of SEARCH_RADII_MILES) {
      const hit = await consider({ nearLatLong: near, distance });
      if (hit) return hit;
    }
  }
  return consider({});
}

async function listCityInventory(client, names, region, { smsOnly = false } = {}) {
  const collected = [];
  for (const inLocality of names) {
    const filters = { inLocality, inRegion: region };
    if (smsOnly) filters.smsEnabled = true;
    collected.push(...(await listLocalNumbers(client, filters)));
  }
  return dedupeNumbers(collected);
}

function cityChoice(numbers, { npas, names, centroid }) {
  return chooseLocalNumber(numbers, {
    cityNpas: npas,
    cityNames: names,
    lat: centroid?.lat,
    lng: centroid?.lng,
  });
}

/** Closest in-state number. Never searches the state without a distance. */
async function pickNearestInState(client, region, centroid) {
  const near = `${centroid.lat},${centroid.lng}`;
  for (const distance of SEARCH_RADII_MILES) {
    const base = { inRegion: region, nearLatLong: near, distance };
    const sms = await listLocalNumbers(client, { ...base, smsEnabled: true });
    const smsPick = closestAvailable(sms, centroid.lat, centroid.lng);
    if (smsPick) return smsPick;
    const voice = await listLocalNumbers(client, base);
    const voicePick = closestAvailable(voice, centroid.lat, centroid.lng);
    if (voicePick) return voicePick;
  }
  return null;
}

export async function findAvailableLocalNumber({ city, state, areaCode } = {}) {
  const client = twilioClient();
  const typed = String(areaCode || '').replace(/\D/g, '').slice(0, 3);
  const locality = String(city || '').trim();
  const region = String(state || '').trim().toUpperCase();
  const centroid = locality && region ? cityCentroid(locality, region) : null;
  const names = locality ? localityQueries(locality, region) : [];
  const npas = typed.length === 3 || !locality || !region ? [] : cityAreaCodes(locality, region);

  if (typed.length === 3) {
    const hit = await pickAreaCodeInventory(client, [typed], {
      region,
      centroid,
      constrainRegion: false,
    });
    if (!hit) throw noNumberError({ city: locality, state: region, areaCode: typed });
    return packChoice(hit, 'area-code');
  }

  if (locality && region) {
    const smsNumbers = await listCityInventory(client, names, region, { smsOnly: true });
    let cityPick = cityChoice(smsNumbers, { npas, names, centroid });
    if (cityPick?.match !== 'city') {
      const voiceNumbers = await listCityInventory(client, names, region);
      cityPick = cityChoice(dedupeNumbers([...smsNumbers, ...voiceNumbers]), { npas, names, centroid });
    }
    if (cityPick?.match === 'city') return packChoice(cityPick, 'city');
  }

  if (npas.length) {
    const hit = await pickAreaCodeInventory(client, npas, {
      region,
      centroid,
      constrainRegion: true,
    });
    if (hit) return packChoice(hit, 'area-code');
  }

  if (region && centroid) {
    const hit = await pickNearestInState(client, region, centroid);
    if (hit) return packChoice(hit, 'nearest');
  }

  const place = [locality, region].filter(Boolean).join(', ') || 'that city';
  const reason = centroid
    ? ''
    : `No Twilio numbers available in ${place} area codes, and there is no map location for a closer search`;
  throw noNumberError({ city: locality, state: region, reason });
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

  const accepted = loadAcceptedSiteConfig(site.candidateId);
  if (!accepted?.config) {
    throw Object.assign(
      new Error('Accept site-config first before provisioning a Twilio number'),
      { status: 400, code: 'SITE_CONFIG_REQUIRED' },
    );
  }

  const existing = site.phoneTracking || {};
  if (existing.phase === 'orphan' && existing.twilioSid && !force) {
    throw Object.assign(
      new Error(
        `Orphan Twilio DID ${existing.e164 || ''} (SID ${existing.twilioSid}) is already recorded. Resolve it in Twilio Console or pass force:true only after releasing that SID.`,
      ),
      {
        status: 409,
        code: 'TWILIO_ORPHAN',
        twilioSid: existing.twilioSid,
        e164: existing.e164 || null,
      },
    );
  }
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
      {
        status: 409,
        twilioSid: existing.twilioSid,
        e164: existing.e164 || null,
      },
    );
  }

  const city = site.city || null;
  const state = site.state || null;
  const businessName = site.businessName || site.niche || site.candidateId;
  const available = await findAvailableLocalNumber({ city, state, areaCode });
  const phoneNumber = available.phoneNumber;
  const voiceUrl = voiceUrlForSite(businessName, {
    siteId: site.id || '',
    mode: 'voicemail',
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
    const released = await releaseTwilioNumber(purchased.sid);
    throw Object.assign(
      new Error(
        released.ok
          ? `Site-config patch failed after buy; released SID ${purchased.sid} (${e164}). Fix Accept/site-config then retry. (${error.message})`
          : `Twilio number ${e164} purchased (SID ${purchased.sid}) but site-config patch failed AND release failed (${released.error || 'unknown'}). Release that SID in Twilio Console before retrying. (${error.message})`,
      ),
      {
        status: error.status || 500,
        twilioSid: purchased.sid,
        e164,
        released: Boolean(released.ok),
        code: released.ok ? 'TWILIO_RELEASED_AFTER_PATCH_FAIL' : 'TWILIO_ORPHAN',
      },
    );
  }

  return {
    e164,
    phone: displayPhone,
    twilioSid: purchased.sid,
    voiceWebhookUrl: voiceUrl,
    forwardTo: '',
    phoneTracking: {
      phase: 'ranking',
      provider: 'twilio',
      e164,
      twilioSid: purchased.sid,
      voiceWebhookUrl: voiceUrl,
      forwardTo: '',
      provisionedAt: new Date().toISOString(),
      areaCode: available.areaCode || null,
      locality: available.locality || null,
      region: available.region || state,
      distanceMiles: available.distanceMiles ?? null,
      match: available.match || null,
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

function rankingUrlNeedsVoicemail(url) {
  const raw = String(url || '');
  if (!raw) return true;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return true;
  }
  const mode = String(parsed.searchParams.get('mode') || '').toLowerCase();
  const forward = String(parsed.searchParams.get('forward') || '').trim();
  if (mode === 'voicemail' && !forward) return false;
  return true;
}

/**
 * Rewrite ranking DIDs that still Dial TWILIO_FORWARD_TO (or lack mode=voicemail).
 * Safe to run on every Phone sync.
 */
export async function ensureRankingVoicemailUrls() {
  assertTwilioEnv();
  const client = twilioClient();
  const updated = [];
  const errors = [];
  for (const site of listSites()) {
    const pt = site.phoneTracking || {};
    if (pt.provider !== 'twilio' || !pt.twilioSid) continue;
    if (pt.phase !== 'ranking') continue;
    let liveUrl = '';
    try {
      const num = await client.incomingPhoneNumbers(pt.twilioSid).fetch();
      liveUrl = String(num.voiceUrl || '').trim();
    } catch (error) {
      errors.push({ siteId: site.id, error: error.message || String(error) });
      liveUrl = String(pt.voiceWebhookUrl || '').trim();
    }
    const needs =
      rankingUrlNeedsVoicemail(liveUrl) || rankingUrlNeedsVoicemail(pt.voiceWebhookUrl);
    if (!needs) {
      if (pt.forwardTo || (liveUrl && liveUrl !== pt.voiceWebhookUrl)) {
        try {
          setSitePhoneTracking(site.id, {
            ...pt,
            voiceWebhookUrl: liveUrl || pt.voiceWebhookUrl,
            forwardTo: '',
          });
        } catch (error) {
          errors.push({ siteId: site.id, error: error.message || String(error) });
        }
      }
      continue;
    }
    const businessName = site.businessName || site.niche || site.candidateId || 'ranking site';
    const voiceUrl = voiceUrlForSite(businessName, {
      siteId: site.id || '',
      mode: 'voicemail',
    });
    try {
      await client.incomingPhoneNumbers(pt.twilioSid).update({
        voiceUrl,
        voiceMethod: 'POST',
      });
      setSitePhoneTracking(site.id, {
        ...pt,
        voiceWebhookUrl: voiceUrl,
        forwardTo: '',
      });
      updated.push(site.id);
    } catch (error) {
      errors.push({ siteId: site.id, error: error.message || String(error) });
    }
  }
  return { ok: true, updated, errors };
}
