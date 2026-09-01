/**
 * Shared Flux / ChatGPT image prompts. No people in generated images.
 */
import { getCandidateDetail } from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { listImageSlots } from './fill-site-images.mjs';
import { normalizeBaViewpoint, roomHint } from './chatgpt-before-after.mjs';

/** ChatGPT Copy prompt — explicit negatives are fine for the operator. */
export const NO_PEOPLE_RULES =
  'No people, no faces, no hands, no crew, no customers, no silhouettes. Empty rooms, installs, tools, and materials only. No text, no logos, no watermarks, no UI, no phone screens.';

/** Flux API — positive empty-scene language (Flux 2 has no negative prompts; fal flags “no people/faces/hands”). */
export const FLUX_UNOCCUPIED_SCENE =
  'Unoccupied interior/exterior: empty room, tools, materials, and the service feature only. Photoreal documentary still of the trade.';

function occupancyLine(forChatGpt) {
  return forChatGpt ? NO_PEOPLE_RULES : FLUX_UNOCCUPIED_SCENE;
}

function stripMdBold(s) {
  return String(s || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .trim();
}

function loadCandidateConfig(candidateId) {
  const detail = getCandidateDetail(candidateId);
  return (
    loadAcceptedSiteConfig(candidateId)?.config ||
    detail.siteConfig ||
    detail.siteConfigDraft ||
    {}
  );
}

export function slotRoleLine(slot) {
  const kind = String(slot.kind || '').toLowerCase();
  const sectionId = String(slot.sectionId || '');
  if (slot.materialTitle) {
    return `Slot role: materials / product detail — show ${stripMdBold(slot.materialTitle)}.`;
  }
  if (slot.processTitle) {
    return `Slot role: process step — illustrate “${stripMdBold(slot.processTitle)}” as the work product or mid-work result (illustrative, not a named real job).`;
  }
  if (kind === 'hero' || sectionId === 'hero' || sectionId === 'svcHero') {
    return 'Slot role: hero / service card — strong wide establishing photo of the service subject.';
  }
  if (kind === 'intro' || sectionId === 'intro') {
    return 'Slot role: intro section — clean supporting photo of the trade in a residential setting.';
  }
  if (kind === 'gallery' || /gallery/i.test(sectionId)) {
    return 'Slot role: gallery — documentary-style trade photo suitable for a contractor site.';
  }
  return `Slot role: ${stripMdBold(slot.label || sectionId || 'service')} website photo.`;
}

/**
 * @param {{
 *   niche?: string,
 *   city?: string,
 *   state?: string,
 *   viewpoint?: string,
 *   slot?: object,
 *   forChatGpt?: boolean,
 * }} ctx
 */
export function buildFluxSlotPrompt(ctx = {}) {
  const slot = ctx.slot || {};
  const viewpoint = normalizeBaViewpoint(ctx.viewpoint);
  const niche = String(ctx.niche || 'home service').trim();
  const city = String(ctx.city || '').trim();
  const state = String(ctx.state || '').trim();
  const place = city ? (state ? `${city}, ${state}` : city) : '';
  const serviceName = String(slot.serviceName || '').trim();
  const label = stripMdBold(slot.label || slot.key || '');
  const queryHint = stripMdBold(slot.queryHint || slot.query || label);
  const focus = serviceName || niche;
  const servicesForRoom = serviceName
    ? [serviceName]
    : Array.isArray(ctx.services)
      ? ctx.services.slice(0, 3)
      : [];
  const room = roomHint(niche, servicesForRoom, viewpoint);
  const placeBit = place ? ` in ${place}` : '';
  const cameraLine =
    viewpoint === 'outside'
      ? `Camera viewpoint: OUTSIDE — photoreal exterior shot of the ${room}${placeBit}, looking at the ${focus} feature from outdoors.`
      : `Camera viewpoint: INSIDE — photoreal interior shot of the ${room}${placeBit}, looking at the ${focus} feature from indoors.`;
  const subjectBits = [
    queryHint,
    slot.materialTitle ? stripMdBold(slot.materialTitle) : '',
    slot.processTitle ? stripMdBold(slot.processTitle) : '',
    serviceName,
  ].filter(Boolean);
  const subject = [...new Set(subjectBits)].slice(0, 4).join('; ');
  const parts = [
    `Create a single photorealistic stock-style photo for a local ${niche} business website.`,
    place
      ? `Location vibe: ${place} (ordinary U.S. residential/commercial setting — no landmarks or readable street signs).`
      : '',
    `Service focus: ${focus}.`,
    cameraLine,
    slotRoleLine(slot),
    `Primary subject: ${subject || niche}.`,
    ctx.forChatGpt
      ? 'This is ILLUSTRATIVE service imagery for the website — not a photo of a real completed job, not a fake before/after, and not proof of work.'
      : 'Illustrative website service photo of the trade subject in an ordinary residential setting.',
    'Photoreal documentary look, natural light, horizontal landscape framing (~16:10).',
    occupancyLine(ctx.forChatGpt),
    ctx.forChatGpt
      ? 'Avoid CGI / illustration look, stock-cliché smiling crews, and off-niche lifestyle scenes.'
      : 'Photoreal materials and light; documentary still of the service feature.',
    ctx.forChatGpt ? 'Generate one image only; I will download it and upload it to the site.' : '',
  ];
  return parts.filter(Boolean).join(' ');
}

export function fluxSlotPromptForCandidate(candidateId, slotKey, { viewpoint, forChatGpt = false } = {}) {
  const key = String(slotKey || '').trim();
  if (!key) throw Object.assign(new Error('slotKey required'), { status: 400 });
  const slots = listImageSlots(candidateId);
  const slot = slots.find((s) => s.key === key);
  if (!slot) throw Object.assign(new Error(`Unknown image slot: ${key}`), { status: 404 });
  const config = loadCandidateConfig(candidateId);
  const detail = getCandidateDetail(candidateId);
  const vp = normalizeBaViewpoint(viewpoint);
  const niche = String(config.niche || detail.config?.niche || 'home service').trim();
  const prompt = buildFluxSlotPrompt({
    niche,
    city: config.primaryCity,
    state: config.state,
    services: config.services,
    viewpoint: vp,
    slot,
    forChatGpt,
  });
  return {
    prompt,
    slotKey: slot.key,
    label: stripMdBold(slot.label || slot.key),
    niche,
    queryHint: stripMdBold(slot.queryHint || slot.label || '') || null,
    viewpoint: vp,
    chatgptUrl: 'https://chatgpt.com/',
  };
}

export function fluxSlotPromptFromMeta({
  niche,
  city,
  state,
  services,
  slot,
  viewpoint,
  forChatGpt = false,
} = {}) {
  const vp = normalizeBaViewpoint(viewpoint);
  const prompt = buildFluxSlotPrompt({
    niche,
    city,
    state,
    services,
    viewpoint: vp,
    slot: slot || {},
    forChatGpt,
  });
  return {
    prompt,
    slotKey: slot?.key || null,
    label: stripMdBold(slot?.label || slot?.key || ''),
    niche: String(niche || 'home service').trim(),
    queryHint: stripMdBold(slot?.queryHint || slot?.query || slot?.label || '') || null,
    viewpoint: vp,
    chatgptUrl: 'https://chatgpt.com/',
  };
}

/** Last-resort BA prompts when a photo group has no candidate Image-queries plan. */
export function buildFluxBaPrompts({
  niche,
  city,
  state,
  serviceName,
  services,
  viewpoint,
  forChatGpt = false,
} = {}) {
  const vp = normalizeBaViewpoint(viewpoint);
  const n = String(niche || 'home service').trim();
  const c = String(city || 'the local area').trim();
  const st = String(state || '').trim();
  const place = st ? `${c}, ${st}` : c;
  const focusName = String(serviceName || n).trim();
  const svcList = serviceName
    ? [serviceName]
    : Array.isArray(services)
      ? services.slice(0, 3)
      : [];
  const room = roomHint(n, svcList, vp);
  const serviceLine = serviceName
    ? `Focus specifically on ${focusName} (not other services).`
    : svcList.length
      ? `Focus on ${svcList.slice(0, 2).join(' and ')}.`
      : `Focus on typical ${n.toLowerCase()} work.`;
  const cameraLine =
    vp === 'outside'
      ? `Camera viewpoint: OUTSIDE — photoreal exterior shot of the ${room} in ${place}, looking at the ${focusName} feature from outdoors.`
      : `Camera viewpoint: INSIDE — photoreal interior shot of the ${room} in ${place}, looking at the ${focusName} feature from indoors.`;
  const occupy = occupancyLine(forChatGpt);
  const sceneHint = /egress|window.?well|basement.?window/i.test(`${focusName} ${n}`)
    ? 'an undersized or unfinished basement window'
    : 'an unfinished or damaged service element — irregular, modest, and believable';
  const surgicalRules = forChatGpt
    ? [
        `SINGLE SUBJECT: only the ${focusName} change is the story.`,
        'Keep flooring, wall paint, ceiling, furniture, and unrelated finishes identical between before and after. Only the service element changes.',
        'The room looks tidy and ordinary. The story is the older or incomplete service element, not a full remodel.',
      ].join(' ')
    : [
        `The story is only the ${focusName} element.`,
        'Keep the same flooring, wall paint, ceiling, furniture, and layout. Only the service feature itself changes.',
        'The room is tidy and ordinary. The service element looks older or unfinished while the rest of the space stays the same.',
      ].join(' ');
  const before = [
    `Create a single documentary BEFORE photo for a local ${n} business website.`,
    cameraLine,
    serviceLine,
    `The ${focusName} element looks older or incomplete (${sceneHint}). The rest of the room is ordinary and lived-in, not a catalog set.`,
    surgicalRules,
    `Straight-on documentary photo, available indoor light, 4:3. No golden hour, no cinematic bokeh, no blown-out windows. ${occupy}`,
    'Realistic residential architecture — not CGI, not a showroom.',
    forChatGpt ? 'Generate one image only; I will download it.' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const afterBody = forChatGpt
    ? [
        cameraLine,
        serviceLine,
        `Update only the ${focusName} result. Keep walls, floor, ceiling, other trim, furniture, and lighting mood the same.`,
        surgicalRules,
        'The rest of the room stays as it was — only the service element is finished. Not a white blob, not a new wall, not a remodel.',
        `Photoreal, 4:3. ${occupy}`,
      ].join(' ')
    : [
        cameraLine,
        serviceLine,
        `Same camera angle, framing, lens, lighting, and room layout as a matching BEFORE of this ${room}. The ${focusName} work is finished.`,
        `The story is only the ${focusName} element. Keep flooring, wall paint, ceiling, furniture, and layout the same as the BEFORE. Only the service feature is finished.`,
        'The room is tidy and ordinary. Photoreal documentary still. Not a white blob, not a remodel.',
        `Straight-on documentary photo, available indoor light, 4:3. ${occupy}`,
        'Realistic residential architecture.',
      ].join(' ');
  const pair = [
    'I need a matched BEFORE and AFTER pair for a contractor website (two separate images).',
    `Niche: ${n}. Service focus: ${focusName}. Location vibe: ${place}. Setting: ${room}. Viewpoint: ${vp}.`,
    serviceLine,
    cameraLine,
    `1) BEFORE: the ${focusName} element looks older or incomplete; the room is lived-in and ordinary.`,
    `2) AFTER: same camera and room; only the ${focusName} work is finished.`,
    surgicalRules,
    `Photoreal, 4:3. ${occupy} Generate the BEFORE first, then the AFTER matching that angle.`,
  ].join(' ');
  return {
    before,
    after: afterBody,
    pair,
    viewpoint: vp,
    room,
    niche: n,
    serviceName: focusName,
  };
}
