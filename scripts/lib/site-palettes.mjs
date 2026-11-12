/**
 * Named brand palettes for site-config (primary / accent / ink).
 * Shared by Rover dashboard and Astro sites.
 *
 * `group` is the primary (main) color, used to section the Colors & fonts menu.
 * Order: Blue, Teal, Green, Red, Brown, Purple, Gray.
 */

export const SITE_PALETTES = [
  {
    id: 'slate-gold',
    label: 'Slate & Gold',
    group: 'Blue',
    tip: 'Navy primary with gold accent (default)',
    brand: {
      primary: '#1C2B3A',
      accent: '#E8A317',
      ink: '#0F1720',
    },
  },
  {
    id: 'ink-sky',
    label: 'Ink & Sky',
    group: 'Blue',
    tip: 'Steel blue with bright sky accent',
    brand: {
      primary: '#234E6D',
      accent: '#3BA3D9',
      ink: '#0B1220',
    },
  },
  {
    id: 'midnight-teal',
    label: 'Midnight & Teal',
    group: 'Blue',
    tip: 'Deep navy with teal accent',
    brand: {
      primary: '#0E2433',
      accent: '#2A9D8F',
      ink: '#07141C',
    },
  },
  {
    id: 'denim-rust',
    label: 'Denim & Rust',
    group: 'Blue',
    tip: 'Workwear blue with rust accent',
    brand: {
      primary: '#2B4C6F',
      accent: '#C65D2E',
      ink: '#101820',
    },
  },
  {
    id: 'navy-coral',
    label: 'Navy & Coral',
    group: 'Blue',
    tip: 'Deep navy with coral accent',
    brand: {
      primary: '#10243F',
      accent: '#E07A5F',
      ink: '#070E18',
    },
  },
  {
    id: 'harbor-sand',
    label: 'Harbor & Sand',
    group: 'Blue',
    tip: 'Harbor blue with warm sand accent',
    brand: {
      primary: '#1A3A4A',
      accent: '#E4C99A',
      accentOnLight: '#6B5436',
      ink: '#0B161C',
    },
  },
  {
    id: 'lagoon-sand',
    label: 'Lagoon & Sand',
    group: 'Teal',
    tip: 'Deep lagoon with sand accent',
    brand: {
      primary: '#0E3A3A',
      accent: '#E6CFA3',
      accentOnLight: '#6A5634',
      ink: '#071616',
    },
  },
  {
    id: 'tide-cream',
    label: 'Tide & Cream',
    group: 'Teal',
    tip: 'Tide teal with cream accent',
    brand: {
      primary: '#14524E',
      accent: '#F3E6D0',
      accentOnLight: '#2E5E58',
      ink: '#071816',
    },
  },
  {
    id: 'forest-copper',
    label: 'Forest & Copper',
    group: 'Green',
    tip: 'Deep green with copper accent',
    brand: {
      primary: '#1A3C34',
      accent: '#C47A3A',
      ink: '#10201C',
    },
  },
  {
    id: 'pine-gold',
    label: 'Pine & Gold',
    group: 'Green',
    tip: 'Pine green with gold accent',
    brand: {
      primary: '#143028',
      accent: '#D4A017',
      ink: '#0A1612',
    },
  },
  {
    id: 'olive-ivory',
    label: 'Olive & Ivory',
    group: 'Green',
    tip: 'Olive with ivory accent',
    brand: {
      primary: '#32381C',
      accent: '#F3E6C8',
      accentOnLight: '#4E5428',
      ink: '#14160C',
    },
  },
  {
    id: 'brick-sand',
    label: 'Brick & Sand',
    group: 'Red',
    tip: 'Deep brick with muted sand accent',
    brand: {
      primary: '#6B2E2B',
      accent: '#C4A574',
      accentOnLight: '#6E4E32',
      ink: '#1A1210',
    },
  },
  {
    id: 'wine-stone',
    label: 'Wine & Stone',
    group: 'Red',
    tip: 'Burgundy with warm stone accent',
    brand: {
      primary: '#5C2430',
      accent: '#D4C4A8',
      accentOnLight: '#6A5344',
      ink: '#1A1012',
    },
  },
  {
    id: 'crimson-gold',
    label: 'Crimson & Gold',
    group: 'Red',
    tip: 'Crimson with gold accent',
    brand: {
      primary: '#4A1520',
      accent: '#E0B43A',
      ink: '#16080C',
    },
  },
  {
    id: 'cherry-cream',
    label: 'Cherry & Cream',
    group: 'Red',
    tip: 'Cherry red with cream accent',
    brand: {
      primary: '#6E2430',
      accent: '#F3E6D4',
      accentOnLight: '#7A4048',
      ink: '#1A0C10',
    },
  },
  {
    id: 'espresso-brass',
    label: 'Espresso & Brass',
    group: 'Brown',
    tip: 'Brown-black with brass accent',
    brand: {
      primary: '#3B2A1A',
      accent: '#C9A227',
      ink: '#1A120C',
    },
  },
  {
    id: 'walnut-sage',
    label: 'Walnut & Sage',
    group: 'Brown',
    tip: 'Walnut brown with sage accent',
    brand: {
      primary: '#3C2A1C',
      accent: '#B7D39A',
      accentOnLight: '#3E5A32',
      ink: '#140E0A',
    },
  },
  {
    id: 'saddle-cream',
    label: 'Saddle & Cream',
    group: 'Brown',
    tip: 'Saddle brown with cream accent',
    brand: {
      primary: '#4A3424',
      accent: '#F2E4CC',
      accentOnLight: '#6E4B32',
      ink: '#1A120C',
    },
  },
  {
    id: 'plum-gold',
    label: 'Plum & Gold',
    group: 'Purple',
    tip: 'Plum with gold accent',
    brand: {
      primary: '#3C2044',
      accent: '#E0B84C',
      ink: '#140814',
    },
  },
  {
    id: 'indigo-copper',
    label: 'Indigo & Copper',
    group: 'Purple',
    tip: 'Indigo with copper accent',
    brand: {
      primary: '#241848',
      accent: '#C47A3A',
      ink: '#0E0A18',
    },
  },
  {
    id: 'charcoal-lime',
    label: 'Charcoal & Lime',
    group: 'Gray',
    tip: 'Charcoal with chartreuse accent',
    brand: {
      primary: '#2A2E32',
      accent: '#B8D43D',
      ink: '#111314',
    },
  },
  {
    id: 'graphite-ember',
    label: 'Graphite & Ember',
    group: 'Gray',
    tip: 'Graphite with safety orange accent',
    brand: {
      primary: '#2B2F33',
      accent: '#E4572E',
      ink: '#121416',
    },
  },
  {
    id: 'iron-ice',
    label: 'Iron & Ice',
    group: 'Gray',
    tip: 'Iron gray with ice accent',
    brand: {
      primary: '#343A40',
      accent: '#9FD4EA',
      accentOnLight: '#2F5F72',
      ink: '#121416',
    },
  },
];

export const DEFAULT_PALETTE_ID = 'slate-gold';

export function getPalette(id) {
  const key = String(id || '').trim();
  return SITE_PALETTES.find((p) => p.id === key) || SITE_PALETTES[0];
}

export function applyPaletteToBrand(brand = {}, paletteId) {
  const palette = getPalette(paletteId || brand.paletteId);
  const next = {
    ...palette.brand,
    paletteId: palette.id,
  };
  // palette.brand.accentOnLight (pale themes) is copied with the spread.
  // Button fill stays `accent`.
  if (brand.fontTheme) next.fontTheme = brand.fontTheme;
  return next;
}

export function listPalettes() {
  return SITE_PALETTES.map((p) => ({
    id: p.id,
    label: p.label,
    group: p.group,
    tip: p.tip,
    brand: { ...p.brand },
  }));
}
