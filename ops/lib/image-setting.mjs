/**
 * Residential vs commercial staging for image prompts.
 * Mixed sites: named commercial services are commercial; home hero/intro stay residential.
 */

const COMMERCIAL_RE = /commercial|office|retail|warehouse|storefront|strip.?center/i;

export function slugifyServiceName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function looksCommercialName(name, slug = '') {
  return COMMERCIAL_RE.test(`${name || ''} ${slug || ''}`);
}

function listNames(raw) {
  return (Array.isArray(raw) ? raw : []).map((n) => String(n || '').trim()).filter(Boolean);
}

export function siteSettingKind(config = {}) {
  const residential = listNames(config.services);
  const commercial = listNames(config.commercialServices);
  const resNotCommercial = residential.filter((n) => !looksCommercialName(n, slugifyServiceName(n)));
  if (
    !resNotCommercial.length &&
    (commercial.length || residential.some((n) => looksCommercialName(n, slugifyServiceName(n))))
  ) {
    return 'commercial';
  }
  return 'residential';
}

export function serviceSettingKind({ serviceName = '', serviceSlug = '', config = {} } = {}) {
  const name = String(serviceName || '').trim();
  const slug = String(serviceSlug || slugifyServiceName(name)).trim();
  const commercial = listNames(config.commercialServices);
  if (
    commercial.some(
      (c) => c.toLowerCase() === name.toLowerCase() || slugifyServiceName(c) === slug,
    )
  ) {
    return 'commercial';
  }
  if (looksCommercialName(name, slug)) return 'commercial';
  return 'residential';
}

export function slotSettingKind({ serviceName = '', serviceSlug = '', config = {} } = {}) {
  if (String(serviceName || '').trim() || String(serviceSlug || '').trim()) {
    return serviceSettingKind({ serviceName, serviceSlug, config });
  }
  return siteSettingKind(config);
}

/** Stale Image-queries BA copy that stages a home. Commercial slots should skip this. */
export function storedBaLooksResidential(text, room = '') {
  const hay = `${text || ''} ${room || ''}`.toLowerCase();
  if (/office|retail|warehouse|commercial building|storefront|lobby|corridor/.test(hay)) {
    return false;
  }
  return /living room|bedroom|dining room|residential interior|ordinary lived-in american house|home exterior|lived-in ordinary house|a distinct residential room/.test(
    hay,
  );
}
