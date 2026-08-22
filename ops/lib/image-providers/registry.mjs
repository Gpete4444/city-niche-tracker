/**
 * Ordered stock image providers (Unsplash, Pexels, Pixabay, …).
 */

import { createUnsplashProvider } from './unsplash.mjs';
import { createPexelsProvider } from './pexels.mjs';
import { createPixabayProvider } from './pixabay.mjs';

const FACTORIES = {
  unsplash: createUnsplashProvider,
  pexels: createPexelsProvider,
  pixabay: createPixabayProvider,
};

/**
 * @returns {{ id: string, label: string, configured: boolean, search: Function, download: Function }[]}
 */
export function listImageProviders() {
  const raw = String(process.env.IMAGE_SOURCES || 'unsplash,pexels,pixabay')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const order = raw.length ? raw : ['unsplash', 'pexels', 'pixabay'];
  const seen = new Set();
  const out = [];
  for (const id of order) {
    if (seen.has(id) || !FACTORIES[id]) continue;
    seen.add(id);
    out.push(FACTORIES[id]());
  }
  return out;
}

export function configuredImageProviders() {
  return listImageProviders().filter((p) => p.configured);
}

export function imageProvidersStatus() {
  return listImageProviders().map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.configured,
  }));
}
