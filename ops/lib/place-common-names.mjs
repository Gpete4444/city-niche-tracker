/**
 * Census legal names that people do not search.
 * Boise, Idaho is the Census place "Boise City" (GEOID 1608830).
 * Boise City, Oklahoma stays Boise City.
 */

export const PLACE_COMMON_NAMES = Object.freeze([
  Object.freeze({
    geoid: '1608830',
    state: 'ID',
    censusName: 'Boise City',
    commonName: 'Boise',
  }),
]);

/** Strip a lowercase Census legal suffix ("Boise City city") without touching "Boise City". */
export function foldPlaceLabel(name) {
  return String(name || '')
    .replace(/\s+(city|town|village|borough)$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function commonNameForGeoid(geoid) {
  const id = String(geoid || '').trim();
  const hit = PLACE_COMMON_NAMES.find((row) => row.geoid === id);
  return hit ? hit.commonName : '';
}

/** Display name for a Census label in a state. Unknown pairs come back unchanged. */
export function commonPlaceName(name, state) {
  const abbr = String(state || '').trim().toUpperCase();
  const label = String(name || '').trim();
  if (!label || !abbr) return label;
  const folded = foldPlaceLabel(label);
  const hit = PLACE_COMMON_NAMES.find(
    (row) =>
      row.state === abbr &&
      (foldPlaceLabel(row.censusName) === folded || foldPlaceLabel(row.commonName) === folded),
  );
  return hit ? hit.commonName : label;
}

/** Census name and common name when this label is an aliased place; otherwise just the label. */
export function equivalentPlaceNames(name, state) {
  const abbr = String(state || '').trim().toUpperCase();
  const label = String(name || '').trim();
  const out = [];
  const add = (value) => {
    const text = String(value || '').trim();
    if (text && !out.includes(text)) out.push(text);
  };
  add(label);
  if (!abbr) return out;
  const folded = foldPlaceLabel(label);
  for (const row of PLACE_COMMON_NAMES) {
    if (row.state !== abbr) continue;
    if (foldPlaceLabel(row.censusName) !== folded && foldPlaceLabel(row.commonName) !== folded) {
      continue;
    }
    add(row.commonName);
    add(row.censusName);
  }
  return out;
}
