/**
 * Photograph prompts for Rover slots.
 * Website captions are not copied into the prompt. Rover generates the image.
 */

export const GILBERT_CANDIDATE_ID = 'gilbert-smart-home-automation-installation';

const QUIET =
  'Unoccupied. Do not show faces, hands, workers, or customers. No brand logos, no readable words, no watermarks.';

const WORKER =
  'Show 1 of the trade workers doing this step in a work shirt. Hands may be visible. No customers. No brand logos, no readable words, no watermarks.';

const VISIT =
  'Show 1 of the trade workers plus the homeowner looking at the work together. No brand logos, no readable words, no watermarks.';

const SCREEN =
  'The screen is on and shows a simple diagram made of a few shapes. No sentences and no brand names.';

const PLACE =
  'Furnished residential home, not an empty new-build room. If a door is in frame it is a real hinged door. Ordinary US house. Photoreal, natural light, one horizontal photo.';

const WORKER_RE = /\b(install\w*|test\w*|pair\w*|program\w*)\b/i;
const VISIT_RE = /\b(site visit|walkthrough|homeowner|consult\w*|review the plan)\b/i;
const SCREEN_RE = /\b(touch\s*screens?|touchscreens?|tablets?|\btvs?\b|televisions?|displays?|control panels?|survey)\b/i;

export function parseObjectList(text) {
  const objects = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);
  if (!objects.length) {
    throw new Error('The object list is empty. Put one recognizable object on each line.');
  }
  return objects;
}

export function slotRole(slot) {
  const id = String(slot?.sectionId || '');
  if (id === 'hero' || id === 'svcHero' || id === 'services') return 'hero';
  if (id === 'intro') return 'intro';
  if (id === 'materials' || id === 'svcMaterials') return 'materials';
  if (id === 'process' || id === 'offerProcess' || id === 'svcProcess') return 'process';
  return 'other';
}

function titleOf(slot) {
  return String(slot?.materialTitle || slot?.processTitle || slot?.serviceName || slot?.label || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function haystack(slot) {
  return [slot?.materialTitle, slot?.processTitle, slot?.serviceName, slot?.label, slot?.sectionId]
    .filter(Boolean)
    .join(' ');
}

export function pickObject(objects, slot) {
  const hay = haystack(slot).toLowerCase();
  let best = null;
  for (const obj of objects) {
    const tokens = obj
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 3);
    const hits = tokens.filter((t) => hay.includes(t)).length;
    if (hits && (!best || hits > best.hits)) best = { obj, hits };
  }
  if (best) return best.obj;
  const role = slotRole(slot);
  if (role === 'hero' || role === 'intro' || role === 'other') {
    const n = Math.max(0, Number(slot?.index) || 1) - 1;
    return objects[n % objects.length];
  }
  return titleOf(slot);
}

export function needsWorker(slot) {
  return slotRole(slot) === 'process' && WORKER_RE.test(titleOf(slot));
}

export function needsVisit(slot) {
  return slotRole(slot) === 'process' && VISIT_RE.test(haystack(slot));
}

export function needsLitScreen(slot) {
  return SCREEN_RE.test(haystack(slot));
}

function tail(slot) {
  if (needsVisit(slot)) return VISIT;
  if (needsWorker(slot)) return WORKER;
  return QUIET;
}

function screenLine(slot) {
  return needsLitScreen(slot) ? SCREEN : '';
}

export function buildSlotPrompt(slot, objects) {
  const role = slotRole(slot);
  const object = pickObject(objects, slot);
  const name = titleOf(slot);
  let lead = '';
  if (role === 'hero') {
    lead = `Finished installed system in a lived-in home. The recognizable object is ${object}.`;
  } else if (role === 'intro') {
    lead = `A supporting view of a finished ${object} in a lived-in home.`;
  } else if (role === 'materials') {
    lead = `The installed ${name || object}, shown where it belongs in the home. One object, one place, close enough to recognize it.`;
  } else if (role === 'process') {
    lead = `The physical state of this step: ${name || object}. Show ${object} as the subject.`;
  } else {
    lead = `A clear photo of ${object} in a lived-in home.`;
  }
  return [lead, screenLine(slot), PLACE, tail(slot)].filter(Boolean).join(' ');
}

export function buildBaPrompts(label, objects, index = 1) {
  const object = pickObject(objects, { label, serviceName: label, index, sectionId: 'svcHero' });
  const name = String(label || object).trim();
  const before = [
    `Before installation. The same home corner with no ${object} installed yet. One place, furnished, nothing added.`,
    PLACE,
    QUIET,
  ].join(' ');
  const after = [
    `Edit this photo. Keep the same room, the same camera, and the same furniture. Change only the install: add the finished ${object} for ${name}.`,
    screenLine({ label: name, serviceName: name }),
    QUIET,
  ]
    .filter(Boolean)
    .join(' ');
  return { before, after, object };
}

export function assertCandidateAllowed(candidateId, { allowGilbert = false } = {}) {
  if (!allowGilbert && String(candidateId) === GILBERT_CANDIDATE_ID) {
    throw new Error(
      'Gilbert prompts are already saved. This app is for the next niche. Pass --allow-gilbert only if you mean to overwrite those prompts.',
    );
  }
}
