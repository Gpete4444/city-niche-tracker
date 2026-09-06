/**
 * Per-slot ChatGPT image prompts (browser generate → Upload).
 * Copy prompt and OpenAI generate share this text (override if set).
 */
import { fluxSlotPromptForCandidate } from './flux-prompts.mjs';
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
 *   setting: string,
 *   overridden: boolean,
 * }}
 */
export function buildSlotImagePrompt(candidateId, slotKey, { viewpoint: viewpointRaw, prompt: bodyPrompt } = {}) {
  const built = fluxSlotPromptForCandidate(candidateId, slotKey, {
    viewpoint: viewpointRaw,
    forChatGpt: true,
  });
  const doc = loadCandidateOpenaiPrompts(candidateId);
  const override = getSlotPromptOverride(doc, slotKey, built.viewpoint);
  const prompt = pickPromptText(built.prompt, override, bodyPrompt);
  return {
    ...built,
    original: built.prompt,
    prompt,
    overridden: prompt !== built.prompt,
  };
}

export function saveSlotOpenaiPrompt(candidateId, slotKey, { viewpoint, prompt, restore } = {}) {
  const built = fluxSlotPromptForCandidate(candidateId, slotKey, {
    viewpoint,
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
  return buildSlotImagePrompt(candidateId, slotKey, { viewpoint: built.viewpoint });
}
