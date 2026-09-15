/**
 * Service-page line on Review / Photo library slot cards.
 * Process and materials slots share Step/material titles across services;
 * svcHero / What we do cards already use the service as the title.
 */
export function reviewSlotServiceSubtitle(slot) {
  const name = String(slot?.serviceName || '').trim();
  if (!name) return '';
  const title = String(slot?.label || '').trim();
  if (title.toLowerCase() === name.toLowerCase()) return '';
  return name;
}
