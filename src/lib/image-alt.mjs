import { fixSmallWords } from './small-words.mjs';

const GENERIC_ALT_RE = /^(hero|intro|feature|project|image|photo)\s+photo$/i;
const SLOT_PHOTO_RE = /^(.+?)\s+photo$/i;

function sameName(a, b) {
  return fixSmallWords(a).toLowerCase() === fixSmallWords(b).toLowerCase();
}

function placeOf(ctx) {
  return [ctx.city, ctx.state].filter(Boolean).join(', ');
}

/**
 * Screen-reader text for a content image.
 * Generic "Hero photo" becomes a place description.
 * "{Service} photo" becomes "{service} in {city}, {state}".
 * A specific caption such as "Steel Push Piers photo" only loses a capitalized And/Of/The.
 */
export function publicImageAlt(raw, ctx = {}) {
  const alt = fixSmallWords(String(raw || '').trim());
  const business = String(ctx.businessName || '').trim();
  const niche = fixSmallWords(String(ctx.niche || '').trim()).toLowerCase();
  const service = fixSmallWords(String(ctx.serviceName || '').trim());
  const services = Array.isArray(ctx.services) ? ctx.services : [];
  const place = placeOf({
    city: String(ctx.city || '').trim(),
    state: String(ctx.state || '').trim(),
  });

  if (!alt || GENERIC_ALT_RE.test(alt)) {
    if (service && place) return `${service.toLowerCase()} in ${place}`;
    if (business && niche && place) return `${business} ${niche} in ${place}`;
    if (business && place) return `${business} in ${place}`;
    return alt || 'Project photo';
  }

  const slot = alt.match(SLOT_PHOTO_RE);
  if (slot && place) {
    const subject = slot[1].trim();
    const named = [service, ...services].filter(Boolean);
    if (named.some((name) => sameName(subject, name))) {
      return `${fixSmallWords(subject).toLowerCase()} in ${place}`;
    }
  }
  return alt;
}
