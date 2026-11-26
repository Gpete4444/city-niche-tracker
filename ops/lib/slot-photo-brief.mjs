/**
 * Shared photo brief for Review cards and generate / Image-queries prompts.
 * Content-derived slotDescription wins; otherwise a kind default names the subject.
 */

function clean(s) {
  return String(s || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBaSlot(slot) {
  const id = String(slot?.sectionId || '');
  const kind = String(slot?.kind || '').toLowerCase();
  const key = String(slot?.key || '');
  return (
    id === 'beforeAfter' ||
    id === 'svcBeforeAfter' ||
    kind === 'gallery' ||
    /^ba:/i.test(key) ||
    /^home:\d+$/i.test(key) ||
    /^svc:/i.test(key)
  );
}

/**
 * Kind default when written content has no bullet/step/service blurb.
 * @param {object} slot
 * @param {{ niche?: string, city?: string, setting?: string }} [ctx]
 */
export function defaultSlotDescription(slot, ctx = {}) {
  const niche = clean(ctx.niche || 'home service') || 'home service';
  const city = clean(ctx.city || '');
  const service = clean(slot?.serviceName || '');
  const material = clean(slot?.materialTitle || '');
  const process = clean(slot?.processTitle || '');
  const id = String(slot?.sectionId || '');
  const kind = String(slot?.kind || '').toLowerCase();
  const place = city ? ` in ${city}` : '';

  if (isBaSlot(slot)) {
    const focus = service || niche;
    return `Matched before/after of ${focus}: incomplete element, then the finished repair. Same camera.`;
  }
  if (material) {
    return `Close-up of ${material} used in this ${niche} job.`;
  }
  if (process) {
    return `In-progress or just-finished work for this step: ${process}.`;
  }
  if (id === 'svcHero' || id === 'services' || kind === 'services') {
    const name = service || clean(slot?.label) || niche;
    return `Service card / hero for ${name} — that job being done or the finished result.`;
  }
  if (id === 'hero' || kind === 'hero') {
    return city ? `${niche} in ${city}.` : `${niche}.`;
  }
  if (id === 'intro' || kind === 'intro') {
    return city ? `A closer look at ${niche} in ${city}.` : `A closer look at ${niche}.`;
  }
  const label = clean(slot?.label || id || 'service') || 'service';
  return `${label} website photo for ${niche}${place}.`;
}

/**
 * @param {object} slot
 * @param {{ niche?: string, city?: string, setting?: string }} [ctx]
 * @returns {{ title: string, description: string }}
 */
export function slotPhotoBrief(slot, ctx = {}) {
  const description = clean(slot?.slotDescription) || defaultSlotDescription(slot, ctx);
  return {
    title: clean(slot?.label || slot?.key || ''),
    description,
  };
}

/** Attach a brief to every slot (keeps an existing content-derived description). */
export function withSlotDescriptions(slots, ctx = {}) {
  return (slots || []).map((slot) => {
    const existing = clean(slot?.slotDescription);
    return {
      ...slot,
      slotDescription: existing || defaultSlotDescription(slot, ctx),
    };
  });
}
