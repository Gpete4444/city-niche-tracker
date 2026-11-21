/**
 * Pick a Twilio local number: the city's area codes first, then the closest other number.
 * Search order lives in phone-tracking-twilio.mjs. This ranks one candidate list.
 */
import { normalizePlaceName } from './census.mjs';
import { haversineMiles } from './geo-neighbors.mjs';

export function areaCodeOf(number) {
  const digits = String(number?.phoneNumber || number?.e164 || '').replace(/\D/g, '');
  if (digits.length >= 11 && digits.startsWith('1')) return digits.slice(1, 4);
  if (digits.length >= 10) return digits.slice(0, 3);
  return '';
}

function milesBetween(number, lat, lng) {
  const numberLat = Number(number?.latitude);
  const numberLng = Number(number?.longitude);
  if (![numberLat, numberLng, lat, lng].every((value) => Number.isFinite(value))) return null;
  return haversineMiles(lng, lat, numberLng, numberLat);
}

/** Closest number to the city. Numbers without coordinates lose to any number that has them. */
export function closestAvailable(numbers, lat, lng) {
  let best = null;
  let bestMiles = Infinity;
  for (const number of numbers || []) {
    const miles = milesBetween(number, lat, lng);
    const score = miles == null ? Infinity : miles;
    if (!best || score < bestMiles) {
      best = number;
      bestMiles = score;
    }
  }
  if (!best) return null;
  return { number: best, miles: Number.isFinite(bestMiles) ? bestMiles : null };
}

function localityNames(cityNames) {
  const names = new Set();
  for (const city of cityNames || []) {
    const key = normalizePlaceName(city);
    if (key) names.add(key);
  }
  return names;
}

/**
 * @param {object[]} numbers
 * @param {{ typedAreaCode?: string, cityNpas?: string[], cityNames?: string[], lat?: number, lng?: number }} [opts]
 * @returns {{ number: object, miles: number|null, match: 'city'|'area-code'|'nearest' } | null}
 */
export function chooseLocalNumber(numbers, opts = {}) {
  const list = Array.isArray(numbers) ? numbers : [];
  const lat = Number(opts.lat);
  const lng = Number(opts.lng);
  const typed = String(opts.typedAreaCode || '').replace(/\D/g, '').slice(0, 3);
  if (typed.length === 3) {
    const hit = closestAvailable(
      list.filter((number) => areaCodeOf(number) === typed),
      lat,
      lng,
    );
    return hit ? { ...hit, match: 'area-code' } : null;
  }

  const npas = new Set((opts.cityNpas || []).map((code) => String(code || '')).filter((code) => code.length === 3));
  const names = localityNames(opts.cityNames);
  if (names.size) {
    const cityHits = list.filter((number) => {
      const locality = normalizePlaceName(number?.locality || '');
      if (!locality || !names.has(locality)) return false;
      if (npas.size && !npas.has(areaCodeOf(number))) return false;
      return true;
    });
    const cityPick = closestAvailable(cityHits, lat, lng);
    if (cityPick) return { ...cityPick, match: 'city' };
  }

  if (npas.size) {
    const npaPick = closestAvailable(
      list.filter((number) => npas.has(areaCodeOf(number))),
      lat,
      lng,
    );
    if (npaPick) return { ...npaPick, match: 'area-code' };
  }

  const nearest = closestAvailable(list, lat, lng);
  return nearest ? { ...nearest, match: 'nearest' } : null;
}
