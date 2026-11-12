/**
 * Shared Flux / ChatGPT image prompts. Occupancy (no people / people) is a generate-time option.
 */
import { getCandidateDetail } from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { listImageSlots } from './fill-site-images.mjs';
import { cameraViewpointLine, normalizeBaViewpoint, roomHint } from './chatgpt-before-after.mjs';
import { slotSettingKind } from './image-setting.mjs';
import {
  FLUX_UNOCCUPIED_SCENE,
  NO_PEOPLE_RULES,
  PEOPLE_RULES,
  afterCustomersAllow,
  applyOccupancyToPrompt,
  occupancyLine,
  normalizeOccupancy,
} from './image-occupancy.mjs';
import { defaultSlotDescription, slotPhotoBrief } from './slot-photo-brief.mjs';

export {
  FLUX_UNOCCUPIED_SCENE,
  NO_PEOPLE_RULES,
  PEOPLE_RULES,
  applyOccupancyToPrompt,
  occupancyLine,
  normalizeOccupancy,
};

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

export function slotRoleLine(slot, setting = 'residential', occupancy = 'none') {
  const kind = String(slot.kind || '').toLowerCase();
  const sectionId = String(slot.sectionId || '');
  const commercial = setting === 'commercial';
  const occ = normalizeOccupancy(occupancy);
  const customers = occ === 'customers';
  let role = `Slot role: ${stripMdBold(slot.label || sectionId || 'service')} website photo.`;
  if (slot.materialTitle) {
    role = `Slot role: materials / product detail — show ${stripMdBold(slot.materialTitle)}.`;
  } else if (slot.processTitle) {
    const step = stripMdBold(slot.processTitle);
    role = customers
      ? `Slot role: process step — the finished “${step}” result, already complete and in use (illustrative, not a named real job).`
      : `Slot role: process step — illustrate “${step}” as the work product or mid-work result (illustrative, not a named real job).`;
  } else if (sectionId === 'hero' || sectionId === 'intro') {
    const place = sectionId === 'hero' ? 'homepage hero' : 'intro';
    if (occ === 'none') {
      role = `Slot role: ${place} — wide photo of the problem this service fixes, still unfinished.`;
    } else if (occ === 'finished') {
      role = `Slot role: ${place} — wide photo of the finished result. The problem is solved and the result is complete, with no people.`;
    } else if (sectionId === 'intro') {
      role = commercial
        ? 'Slot role: intro section — clean supporting photo of the trade in a commercial building.'
        : 'Slot role: intro section — clean supporting photo of the trade in a residential setting.';
    } else {
      role = 'Slot role: hero / service card — strong wide establishing photo of the service subject.';
    }
  } else if (kind === 'hero' || sectionId === 'svcHero') {
    role = 'Slot role: hero / service card — strong wide establishing photo of the service subject.';
  } else if (kind === 'intro' || sectionId === 'intro') {
    role = commercial
      ? 'Slot role: intro section — clean supporting photo of the trade in a commercial building.'
      : 'Slot role: intro section — clean supporting photo of the trade in a residential setting.';
  } else if (kind === 'gallery' || /gallery/i.test(sectionId)) {
    role = 'Slot role: gallery — documentary-style trade photo suitable for a contractor site.';
  }
  const brief = slotPhotoBrief(slot, { setting }).description;
  if (brief) return `${role} What to show: ${stripMdBold(brief)}`;
  return role;
}

/**
 * @param {{
 *   niche?: string,
 *   city?: string,
 *   state?: string,
 *   viewpoint?: string,
 *   occupancy?: string,
 *   slot?: object,
 *   forChatGpt?: boolean,
 * }} ctx
 */
export function buildFluxSlotPrompt(ctx = {}) {
  const slot = ctx.slot || {};
  const viewpoint = normalizeBaViewpoint(ctx.viewpoint);
  const occupancy = normalizeOccupancy(ctx.occupancy);
  const niche = String(ctx.niche || 'home service').trim();
  const city = String(ctx.city || '').trim();
  const state = String(ctx.state || '').trim();
  const place = city ? (state ? `${city}, ${state}` : city) : '';
  const serviceName = String(slot.serviceName || '').trim();
  const label = stripMdBold(slot.label || slot.key || '');
  const queryHint = stripMdBold(slot.queryHint || slot.query || label);
  const focus = serviceName || niche;
  const setting = ctx.setting === 'commercial' ? 'commercial' : 'residential';
  const commercial = setting === 'commercial';
  const servicesForRoom = serviceName
    ? [serviceName]
    : Array.isArray(ctx.services)
      ? ctx.services.slice(0, 3)
      : [];
  const room = roomHint(niche, servicesForRoom, viewpoint, setting);
  const cameraLine = cameraViewpointLine({ viewpoint, room, place, focus });
  const subjectBits = [
    queryHint,
    slot.materialTitle ? stripMdBold(slot.materialTitle) : '',
    slot.processTitle ? stripMdBold(slot.processTitle) : '',
    slot.slotDescription ? stripMdBold(slot.slotDescription) : '',
    serviceName,
  ].filter(Boolean);
  const subject = [...new Set(subjectBits)].slice(0, 4).join('; ');
  const placeLine = commercial
    ? `ordinary U.S. commercial building setting — no landmarks or readable street signs`
    : `ordinary U.S. residential setting — no landmarks or readable street signs`;
  const illustrativeLine = ctx.forChatGpt
    ? 'This is ILLUSTRATIVE service imagery for the website — not a photo of a real completed job, not a fake before/after, and not proof of work.'
    : commercial
      ? 'Illustrative website service photo of the trade subject in an ordinary commercial building.'
      : 'Illustrative website service photo of the trade subject in an ordinary residential setting.';
  const parts = [
    `Create a single photorealistic stock-style photo for a local ${niche} business website.`,
    place ? `Location vibe: ${place} (${placeLine}).` : '',
    `Service focus: ${focus}.`,
    cameraLine,
    slotRoleLine(slot, setting, occupancy),
    `Primary subject: ${subject || niche}.`,
    illustrativeLine,
    'Photoreal documentary look, natural light, horizontal landscape framing (~16:10).',
    occupancyLine(ctx.forChatGpt, occupancy, { niche, serviceName: focus, setting }),
    ctx.forChatGpt
      ? occupancy === 'customers'
        ? `Avoid CGI / illustration look and posed stock smiles. The people are using the finished ${focus}.`
        : 'Avoid CGI / illustration look, stock-cliché smiling crews, and off-niche lifestyle scenes.'
      : 'Photoreal materials and light; documentary still of the service feature.',
    ctx.forChatGpt ? 'Generate one image only; I will download it and upload it to the site.' : '',
  ];
  return parts.filter(Boolean).join(' ');
}

export function fluxSlotPromptForCandidate(candidateId, slotKey, { viewpoint, occupancy, forChatGpt = false } = {}) {
  const key = String(slotKey || '').trim();
  if (!key) throw Object.assign(new Error('slotKey required'), { status: 400 });
  const slots = listImageSlots(candidateId);
  const slot = slots.find((s) => s.key === key);
  if (!slot) throw Object.assign(new Error(`Unknown image slot: ${key}`), { status: 404 });
  const config = loadCandidateConfig(candidateId);
  const detail = getCandidateDetail(candidateId);
  const vp = normalizeBaViewpoint(viewpoint);
  const occ = normalizeOccupancy(occupancy);
  const niche = String(config.niche || detail.config?.niche || 'home service').trim();
  const setting = slotSettingKind({
    serviceName: slot.serviceName,
    serviceSlug: slot.serviceSlug,
    config,
  });
  const prompt = buildFluxSlotPrompt({
    niche,
    city: config.primaryCity,
    state: config.state,
    services: config.services,
    viewpoint: vp,
    occupancy: occ,
    slot,
    setting,
    forChatGpt,
  });
  return {
    prompt,
    slotKey: slot.key,
    label: stripMdBold(slot.label || slot.key),
    niche,
    serviceName: String(slot.serviceName || '').trim(),
    queryHint: stripMdBold(slot.queryHint || slot.label || '') || null,
    viewpoint: vp,
    occupancy: occ,
    setting,
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
  occupancy,
  setting,
  config,
  forChatGpt = false,
} = {}) {
  const vp = normalizeBaViewpoint(viewpoint);
  const occ = normalizeOccupancy(occupancy);
  const slotObj = slot || {};
  const kind =
    setting === 'commercial' || setting === 'residential'
      ? setting
      : slotSettingKind({
          serviceName: slotObj.serviceName,
          serviceSlug: slotObj.serviceSlug,
          config: config || {},
        });
  const prompt = buildFluxSlotPrompt({
    niche,
    city,
    state,
    services,
    viewpoint: vp,
    occupancy: occ,
    slot: slotObj,
    setting: kind,
    forChatGpt,
  });
  return {
    prompt,
    slotKey: slotObj.key || null,
    label: stripMdBold(slotObj.label || slotObj.key || ''),
    niche: String(niche || 'home service').trim(),
    serviceName: String(slotObj.serviceName || '').trim(),
    queryHint: stripMdBold(slotObj.queryHint || slotObj.query || slotObj.label || '') || null,
    viewpoint: vp,
    occupancy: occ,
    setting: kind,
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
  occupancy,
  setting,
  config,
  forChatGpt = false,
} = {}) {
  const vp = normalizeBaViewpoint(viewpoint);
  const occ = normalizeOccupancy(occupancy);
  const n = String(niche || 'home service').trim();
  const c = String(city || 'the local area').trim();
  const st = String(state || '').trim();
  const place = st ? `${c}, ${st}` : c;
  const focusName = String(serviceName || n).trim();
  const kind =
    setting === 'commercial' || setting === 'residential'
      ? setting
      : slotSettingKind({
          serviceName: focusName,
          config: config || {},
        });
  const commercial = kind === 'commercial';
  const svcList = serviceName
    ? [serviceName]
    : Array.isArray(services)
      ? services.slice(0, 3)
      : [];
  const room = roomHint(n, svcList, vp, kind);
  const serviceLine = serviceName
    ? `Focus specifically on ${focusName} (not other services).`
    : svcList.length
      ? `Focus on ${svcList.slice(0, 2).join(' and ')}.`
      : `Focus on typical ${n.toLowerCase()} work.`;
  const baBrief = defaultSlotDescription(
    {
      sectionId: serviceName ? 'svcBeforeAfter' : 'beforeAfter',
      kind: 'gallery',
      serviceName: focusName,
    },
    { niche: n, setting: kind },
  );
  const baShowLine = baBrief ? `What to show: ${baBrief}` : '';
  const cameraLine = cameraViewpointLine({
    viewpoint: vp,
    room,
    place,
    focus: focusName,
  });
  const customers = occ === 'customers';
  const workers = occ === 'workers';
  const occCtx = { niche: n, serviceName: focusName, setting: kind };
  const peopleAllow = afterCustomersAllow(occCtx);
  const beforeOccupy = occupancyLine(forChatGpt, workers ? 'workers' : 'none', occCtx);
  const afterOccupy = occupancyLine(
    forChatGpt,
    customers ? 'customers' : workers ? 'workers' : 'finished',
    occCtx,
  );
  const sceneHint = /egress|window.?well|basement.?window/i.test(`${focusName} ${n}`)
    ? 'an undersized or unfinished basement window'
    : 'an unfinished or damaged service element — irregular, modest, and believable';
  const ordinarySpace = commercial
    ? 'The space looks tidy and ordinary for an office, retail, or commercial building. The story is the older or incomplete service element, not a full remodel.'
    : 'The room looks tidy and ordinary. The story is the older or incomplete service element, not a full remodel.';
  const surgicalRules = forChatGpt
    ? [
        `SINGLE SUBJECT: only the ${focusName} change is the story.`,
        'Keep flooring, wall paint, ceiling, furniture, and unrelated finishes identical between before and after. Only the service element changes.',
        ordinarySpace,
      ].join(' ')
    : [
        `The story is only the ${focusName} element.`,
        'Keep the same flooring, wall paint, ceiling, furniture, and layout. Only the service feature itself changes.',
        commercial
          ? 'The interior is tidy and ordinary. The service element looks older or unfinished while the rest of the commercial space stays the same.'
          : 'The room is tidy and ordinary. The service element looks older or unfinished while the rest of the space stays the same.',
      ].join(' ');
  const afterSurgicalRules = customers
    ? [
        `SINGLE SUBJECT: the finished ${focusName} result and the people using it.`,
        'Keep flooring, wall paint, ceiling, furniture, and unrelated finishes the same.',
        peopleAllow,
        ordinarySpace,
      ].join(' ')
    : surgicalRules;
  const architecture = commercial
    ? 'Realistic commercial architecture — not CGI, not a showroom.'
    : 'Realistic residential architecture — not CGI, not a showroom.';
  const livedIn = commercial
    ? `The ${focusName} element looks older or incomplete (${sceneHint}). The rest of the interior is an ordinary occupied commercial space, not a catalog set.`
    : `The ${focusName} element looks older or incomplete (${sceneHint}). The rest of the room is ordinary and lived-in, not a catalog set.`;
  const beforeLine = commercial
    ? `1) BEFORE: the ${focusName} element looks older or incomplete; the space is an ordinary office, retail, or commercial interior.`
    : `1) BEFORE: the ${focusName} element looks older or incomplete; the room is lived-in and ordinary.`;
  const before = [
    `Create a single documentary BEFORE photo for a local ${n} business website.`,
    cameraLine,
    serviceLine,
    baShowLine,
    livedIn,
    surgicalRules,
    `Straight-on documentary photo, available indoor light, 4:3. No golden hour, no cinematic bokeh, no blown-out windows. ${beforeOccupy}`,
    architecture,
    forChatGpt ? 'Generate one image only; I will download it.' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const afterFinishLine = customers
    ? peopleAllow
    : `Update only the ${focusName} result. Keep walls, floor, ceiling, other trim, furniture, and lighting mood the same.`;
  const afterStayLine = customers
    ? 'The rest of the room stays as it was. The finished result is in use. Not a white blob, not a new wall, not a remodel.'
    : 'The rest of the room stays as it was — only the service element is finished. Not a white blob, not a new wall, not a remodel.';
  const afterBody = forChatGpt
      ? [
        cameraLine,
        serviceLine,
        baShowLine,
        afterFinishLine,
        afterSurgicalRules,
        afterStayLine,
        `Photoreal, 4:3. ${afterOccupy}`,
      ].join(' ')
      : [
        cameraLine,
        serviceLine,
        baShowLine,
        `Same camera angle, framing, lens, lighting, and room layout as a matching BEFORE of this ${room}. The ${focusName} work is finished.`,
        customers
          ? `The story is the finished ${focusName} in use. Keep flooring, wall paint, ceiling, furniture, and layout the same as the BEFORE. ${peopleAllow}`
          : `The story is only the ${focusName} element. Keep flooring, wall paint, ceiling, furniture, and layout the same as the BEFORE. Only the service feature is finished.`,
        commercial
          ? 'The interior is tidy and ordinary. Photoreal documentary still. Not a white blob, not a remodel.'
          : 'The room is tidy and ordinary. Photoreal documentary still. Not a white blob, not a remodel.',
        `Straight-on documentary photo, available indoor light, 4:3. ${afterOccupy}`,
        architecture,
      ].join(' ');
  const pair = [
    'I need a matched BEFORE and AFTER pair for a contractor website (two separate images).',
    `Niche: ${n}. Service focus: ${focusName}. Location vibe: ${place}. Setting: ${room}. Viewpoint: ${vp}.`,
    serviceLine,
    baShowLine,
    cameraLine,
    beforeLine,
    customers
      ? `2) AFTER: same camera, crop, and room; the ${focusName} work is finished and the people who use that finished ${focusName} are in the photo.`
      : `2) AFTER: same camera and room; only the ${focusName} work is finished.`,
    customers ? afterSurgicalRules : surgicalRules,
    `Photoreal, 4:3. BEFORE: ${beforeOccupy} AFTER: ${afterOccupy} Generate the BEFORE first, then the AFTER matching that angle.`,
  ].join(' ');
  return {
    before,
    after: afterBody,
    pair,
    viewpoint: vp,
    occupancy: occ,
    room,
    niche: n,
    serviceName: focusName,
    setting: kind,
  };
}
