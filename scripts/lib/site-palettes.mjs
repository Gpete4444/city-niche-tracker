/**
 * Named brand palettes for site-config (primary / accent / ink).
 * Shared by Rover dashboard and Astro sites.
 */

export const SITE_PALETTES = [
  {
    id: 'slate-gold',
    label: 'Slate & Gold',
    tip: 'Navy primary with gold accent (default)',
    brand: {
      primary: '#1C2B3A',
      accent: '#E8A317',
      ink: '#0F1720',
    },
  },
  {
    id: 'forest-copper',
    label: 'Forest & Copper',
    tip: 'Deep green with copper accent',
    brand: {
      primary: '#1A3C34',
      accent: '#C47A3A',
      ink: '#10201C',
    },
  },
  {
    id: 'ink-sky',
    label: 'Ink & Sky',
    tip: 'Steel blue with bright sky accent',
    brand: {
      primary: '#234E6D',
      accent: '#3BA3D9',
      ink: '#0B1220',
    },
  },
  {
    id: 'brick-sand',
    label: 'Brick & Sand',
    tip: 'Deep brick with muted sand accent',
    brand: {
      primary: '#6B2E2B',
      accent: '#C4A574',
      ink: '#1A1210',
    },
  },
  {
    id: 'charcoal-lime',
    label: 'Charcoal & Lime',
    tip: 'Charcoal with chartreuse accent',
    brand: {
      primary: '#2A2E32',
      accent: '#B8D43D',
      ink: '#111314',
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
  return {
    ...palette.brand,
    paletteId: palette.id,
  };
}

export function listPalettes() {
  return SITE_PALETTES.map((p) => ({
    id: p.id,
    label: p.label,
    tip: p.tip,
    brand: { ...p.brand },
  }));
}
