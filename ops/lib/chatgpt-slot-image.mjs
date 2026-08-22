/**
 * Per-slot ChatGPT image prompts (browser generate → Upload).
 * Mirrors before/after ChatGPT flow; no image API cost.
 */
import { getCandidateDetail } from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { listImageSlots } from './fill-site-images.mjs';
import { normalizeBaViewpoint, roomHint } from './chatgpt-before-after.mjs';

function loadConfig(candidateId) {
  const detail = getCandidateDetail(candidateId);
  return (
    loadAcceptedSiteConfig(candidateId)?.config ||
    detail.siteConfig ||
    detail.siteConfigDraft ||
    {}
  );
}

function stripMdBold(s) {
  return String(s || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .trim();
}

function slotRoleLine(slot) {
  const kind = String(slot.kind || '').toLowerCase();
  const sectionId = String(slot.sectionId || '');
  if (slot.materialTitle) {
    return `Slot role: materials / product detail — show ${stripMdBold(slot.materialTitle)}.`;
  }
  if (slot.processTitle) {
    return `Slot role: process step — illustrate “${stripMdBold(slot.processTitle)}” mid-work or result (still illustrative, not a named real job).`;
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
 * @returns {{ prompt: string, slotKey: string, label: string, chatgptUrl: string, niche: string, queryHint: string|null, viewpoint: string }}
 */
export function buildSlotImagePrompt(candidateId, slotKey, { viewpoint: viewpointRaw } = {}) {
  const key = String(slotKey || '').trim();
  if (!key) {
    throw Object.assign(new Error('slotKey required'), { status: 400 });
  }
  const slots = listImageSlots(candidateId);
  const slot = slots.find((s) => s.key === key);
  if (!slot) {
    throw Object.assign(new Error(`Unknown image slot: ${key}`), { status: 404 });
  }

  const viewpoint = normalizeBaViewpoint(viewpointRaw);
  const config = loadConfig(candidateId);
  const detail = getCandidateDetail(candidateId);
  const niche = String(config.niche || detail.config?.niche || 'home service').trim();
  const city = String(config.primaryCity || '').trim();
  const state = String(config.state || '').trim();
  const place = city ? (state ? `${city}, ${state}` : city) : '';
  const serviceName = String(slot.serviceName || '').trim();
  const label = stripMdBold(slot.label || slot.key);
  const queryHint = stripMdBold(slot.queryHint || label);
  const focus = serviceName || niche;
  const servicesForRoom = serviceName
    ? [serviceName]
    : Array.isArray(config.services)
      ? config.services.slice(0, 3)
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

  const prompt = [
    `Create a single photorealistic stock-style photo for a local ${niche} business website.`,
    place ? `Location vibe: ${place} (ordinary U.S. residential/commercial setting — no landmarks or readable street signs).` : '',
    `Service focus: ${focus}.`,
    cameraLine,
    slotRoleLine(slot),
    `Primary subject: ${subject || niche}.`,
    'This is ILLUSTRATIVE service imagery for the website — not a photo of a real completed job, not a fake before/after, and not proof of work.',
    'Photoreal documentary look, natural light, horizontal landscape framing (~16:10).',
    'No people with identifiable faces (hands-only or no people preferred), no text, no logos, no watermarks, no UI, no phone screens.',
    'Avoid CGI / illustration look, stock-cliché smiling crews, and off-niche lifestyle scenes.',
    'Generate one image only; I will download it and upload it to the site.',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    prompt,
    slotKey: slot.key,
    label,
    niche,
    queryHint: queryHint || null,
    viewpoint,
    chatgptUrl: 'https://chatgpt.com/',
  };
}
