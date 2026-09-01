/**
 * Per-slot ChatGPT image prompts (browser generate → Upload).
 */
import { fluxSlotPromptForCandidate } from './flux-prompts.mjs';

/**
 * @returns {{ prompt: string, slotKey: string, label: string, chatgptUrl: string, niche: string, queryHint: string|null, viewpoint: string }}
 */
export function buildSlotImagePrompt(candidateId, slotKey, { viewpoint: viewpointRaw } = {}) {
  return fluxSlotPromptForCandidate(candidateId, slotKey, {
    viewpoint: viewpointRaw,
    forChatGpt: true,
  });
}
