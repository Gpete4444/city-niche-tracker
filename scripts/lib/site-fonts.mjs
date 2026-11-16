/**
 * Named font themes for site-config (display + body).
 * Shared by Rover dashboard and Astro sites.
 * Keep in sync with src/config/fonts.ts
 */

export const SITE_FONT_THEMES = [
  {
    id: 'archivo-source',
    label: 'Default',
    tip: 'Condensed headlines and plain body text.',
    displayFamily: 'Archivo',
    bodyFamily: 'Source Sans 3',
    displayStack: '"Archivo", "Avenir Next Condensed", ui-sans-serif, system-ui, sans-serif',
    bodyStack: '"Source Sans 3", "Source Sans Pro", ui-sans-serif, system-ui, sans-serif',
    googleHref:
      'https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Source+Sans+3:wght@400;600;700&display=swap',
  },
  {
    id: 'playfair-dm',
    label: 'Fancy',
    tip: 'Elegant headlines and simple body text.',
    displayFamily: 'Playfair Display',
    bodyFamily: 'DM Sans',
    displayStack: '"Playfair Display", "Times New Roman", Georgia, serif',
    bodyStack: '"DM Sans", "Helvetica Neue", ui-sans-serif, system-ui, sans-serif',
    googleHref:
      'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Playfair+Display:ital,wght@0,600;0,700;1,600&display=swap',
  },
  {
    id: 'outfit-nunito',
    label: 'Friendly',
    tip: 'Friendly headlines and easy body text.',
    displayFamily: 'Outfit',
    bodyFamily: 'Nunito Sans',
    displayStack: '"Outfit", "Avenir Next", ui-sans-serif, system-ui, sans-serif',
    bodyStack: '"Nunito Sans", "Segoe UI", ui-sans-serif, system-ui, sans-serif',
    googleHref:
      'https://fonts.googleapis.com/css2?family=Nunito+Sans:ital,opsz,wght@0,6..12,400;0,6..12,600;0,6..12,700;1,6..12,400&family=Outfit:wght@600;700;800&display=swap',
  },
];

export const DEFAULT_FONT_THEME_ID = 'archivo-source';

export function getFontTheme(id) {
  const key = String(id || '').trim();
  return SITE_FONT_THEMES.find((t) => t.id === key) || SITE_FONT_THEMES[0];
}

export function applyFontThemeToBrand(brand = {}, fontThemeId) {
  const theme = getFontTheme(fontThemeId || brand.fontTheme);
  return {
    ...brand,
    fontTheme: theme.id,
  };
}

export function listFontThemes() {
  return SITE_FONT_THEMES.map((t) => ({
    id: t.id,
    label: t.label,
    tip: t.tip,
    displayFamily: t.displayFamily,
    bodyFamily: t.bodyFamily,
    displayStack: t.displayStack,
    bodyStack: t.bodyStack,
    googleHref: t.googleHref,
  }));
}
