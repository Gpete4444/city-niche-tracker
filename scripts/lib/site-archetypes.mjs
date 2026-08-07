/**
 * Site archetypes (Website Type A/B) shared by ops, content writer, and Astro.
 */

export const SITE_ARCHETYPES = {
  multi_service: {
    id: 'multi_service',
    typeLabel: 'Type A',
    label: 'Multi-service local',
    blurb: 'Up to 12 related services (volume-ordered) with a services grid; optional commercial list',
    homepageSections: [
      'hero',
      'trust',
      'intro',
      'services',
      'process',
      'whyChooseUs',
      'areas',
      'faqs',
      'cta',
    ],
    requireServicePages: true,
    showServiceCards: true,
    showServicesNav: true,
    minServices: 2,
    maxServices: 12,
    minLocations: 4,
    maxLocations: 6,
  },
  single_service: {
    id: 'single_service',
    typeLabel: 'Type B',
    label: 'Single-offer specialty',
    blurb: 'One primary offer — deep process on homepage, no multi-service grid (egress windows, etc.)',
    homepageSections: [
      'hero',
      'trust',
      'intro',
      'offerProcess',
      'whyChooseUs',
      'areas',
      'faqs',
      'cta',
    ],
    requireServicePages: false,
    showServiceCards: false,
    showServicesNav: false,
    minServices: 1,
    maxServices: 1,
    minLocations: 4,
    maxLocations: 6,
  },
};

export const DEFAULT_ARCHETYPE = 'multi_service';

export function listArchetypes() {
  return Object.values(SITE_ARCHETYPES);
}

export function normalizeArchetype(raw) {
  const id = String(raw || '').trim();
  if (SITE_ARCHETYPES[id]) return id;
  return DEFAULT_ARCHETYPE;
}

export function getArchetype(raw) {
  return SITE_ARCHETYPES[normalizeArchetype(raw)];
}

export function homepageSectionsFor(raw) {
  return [...getArchetype(raw).homepageSections];
}

/**
 * Suggest archetype from site-config or approved package soft fields.
 */
export function suggestArchetype({ services, niche, suggestedServices } = {}) {
  const list = Array.isArray(services)
    ? services
    : Array.isArray(suggestedServices)
      ? suggestedServices
      : [];
  const count = list.filter((s) => String(s || '').trim()).length;
  const nicheLower = String(niche || '').toLowerCase();
  const singleHints = ['egress', 'only', 'specialty', 'specialist'];
  if (count <= 1) return 'single_service';
  if (singleHints.some((h) => nicheLower.includes(h)) && count <= 2) return 'single_service';
  return 'multi_service';
}

export function applyArchetypeDefaults(config = {}) {
  const siteArchetype = normalizeArchetype(config.siteArchetype);
  const def = getArchetype(siteArchetype);
  return {
    ...config,
    siteArchetype,
    homepageSections:
      Array.isArray(config.homepageSections) && config.homepageSections.length
        ? config.homepageSections
        : [...def.homepageSections],
  };
}
