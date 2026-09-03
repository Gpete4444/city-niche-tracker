/**
 * Shared GPT Image prompt for Mark / Mark + text logos.
 * Kept separate so candidate detail can expose defaults without a circular import.
 */

export function buildOpenaiLogoPrompt({ mode, businessName, niche, primary, accent }) {
  const colors = `Use brand colors ${primary} (primary) and ${accent} (accent).`;
  const base =
    `Flat 2D vector-style logo for a ${niche} company. ${colors} ` +
    `Centered square composition. Transparent background. Clean, simple, professional. ` +
    `Not photorealistic, not 3D, not a mockup, no drop shadows on a surface, no watermarks, no UI.`;
  if (mode === 'mark') {
    return `${base} Icon/mark only. No text, no letters, no wordmark. Suggest the trade visually for “${businessName}”.`;
  }
  return `${base} Simple icon plus the exact business name “${businessName}” in clean sans-serif lettering. No slogan, no extra words.`;
}

export function logoPromptDefaultsForConfig(config = {}) {
  const brand = config.brand || {};
  const args = {
    businessName: config.businessName || 'Business',
    niche: String(config.niche || 'home service').trim() || 'home service',
    primary: brand.primary || '#1C2B3A',
    accent: brand.accent || '#E8A317',
  };
  return {
    mark: buildOpenaiLogoPrompt({ ...args, mode: 'mark' }),
    markText: buildOpenaiLogoPrompt({ ...args, mode: 'markText' }),
  };
}
