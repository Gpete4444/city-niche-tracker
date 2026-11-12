/**
 * Per-slot ChatGPT image prompts (browser generate → Upload).
 * Copy prompt and OpenAI generate share this text (override if set).
 */
import { fluxSlotPromptForCandidate } from './flux-prompts.mjs';
import { applyOccupancyToPrompt, normalizeOccupancy } from './image-occupancy.mjs';
import {
  getSlotPromptOverride,
  loadCandidateOpenaiPrompts,
  pickPromptText,
  saveCandidateOpenaiPrompts,
  setSlotPromptOverride,
  clearSlotPromptOverride,
} from './openai-prompt-overrides.mjs';

/**
 * @returns {{
 *   prompt: string,
 *   original: string,
 *   slotKey: string,
 *   label: string,
 *   chatgptUrl: string,
 *   niche: string,
 *   queryHint: string|null,
 *   viewpoint: string,
 *   occupancy: string,
 *   setting: string,
 *   overridden: boolean,
 * }}
 */
export function buildSlotImagePrompt(
  candidateId,
  slotKey,
  { viewpoint: viewpointRaw, occupancy: occupancyRaw, prompt: bodyPrompt } = {},
) {
  const occupancy = normalizeOccupancy(occupancyRaw);
  const built = fluxSlotPromptForCandidate(candidateId, slotKey, {
    viewpoint: viewpointRaw,
    occupancy,
    forChatGpt: true,
  });
  const doc = loadCandidateOpenaiPrompts(candidateId);
  const override = getSlotPromptOverride(doc, slotKey, built.viewpoint);
  const fromBody = Boolean(String(bodyPrompt || '').trim());
  const picked = pickPromptText(built.prompt, override, bodyPrompt);
  const prompt = fromBody
    ? picked
    : applyOccupancyToPrompt(picked, occupancy, {
        niche: built.niche,
        serviceName: built.serviceName,
        setting: built.setting,
      });
  return {
    ...built,
    occupancy,
    original: built.prompt,
    prompt,
    overridden: prompt !== built.prompt,
  };
}

export function saveSlotOpenaiPrompt(candidateId, slotKey, { viewpoint, occupancy, prompt, restore } = {}) {
  const occ = normalizeOccupancy(occupancy);
  const built = fluxSlotPromptForCandidate(candidateId, slotKey, {
    viewpoint,
    occupancy: occ,
    forChatGpt: true,
  });
  let doc = loadCandidateOpenaiPrompts(candidateId);
  const text = String(prompt || '').trim();
  if (restore || text === built.prompt) {
    doc = clearSlotPromptOverride(doc, slotKey, built.viewpoint);
  } else if (text) {
    doc = setSlotPromptOverride(doc, slotKey, built.viewpoint, text);
  }
  saveCandidateOpenaiPrompts(candidateId, doc);
  return buildSlotImagePrompt(candidateId, slotKey, { viewpoint: built.viewpoint, occupancy: occ });
}
