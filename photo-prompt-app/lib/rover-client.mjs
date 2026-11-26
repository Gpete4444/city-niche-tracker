/**
 * Read slots from a running Rover and write photograph prompts back.
 * Does not generate images.
 */

export function roverBase(raw) {
  const base = String(raw || 'http://127.0.0.1:8787').replace(/\/$/, '');
  return base;
}

async function roverJson(base, urlPath, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${base}${urlPath}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new Error(
      `Rover is not answering at ${base}. Start it with npm run rover, then run this again. ${error.message}`,
    );
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Rover returned ${response.status} for ${urlPath}`);
  }
  return data;
}

export async function loadCandidate(base, candidateId) {
  const detail = await roverJson(
    base,
    `/api/candidates/${encodeURIComponent(candidateId)}?include=content`,
  );
  const slotsDoc = await roverJson(
    base,
    `/api/candidates/${encodeURIComponent(candidateId)}/images/slots`,
  );
  const ba = await roverJson(
    base,
    `/api/candidates/${encodeURIComponent(candidateId)}/images/before-after-status`,
  );
  const niche = String(
    detail?.siteConfig?.niche || detail?.siteConfigDraft?.niche || detail?.config?.niche || '',
  ).trim();
  return {
    id: detail?.id || candidateId,
    niche,
    structure: detail?.contentStructure || null,
    slots: Array.isArray(slotsDoc?.slots) ? slotsDoc.slots : [],
    ba,
  };
}

export async function saveSlotPrompt(base, candidateId, slotKey, { viewpoint, prompt }) {
  return roverJson(
    base,
    `/api/candidates/${encodeURIComponent(candidateId)}/images/slots/${encodeURIComponent(slotKey)}/openai-prompt`,
    {
      method: 'POST',
      body: { viewpoint, occupancy: 'none', prompt },
    },
  );
}

export async function saveBaPrompt(base, candidateId, { serviceSlug, pairIndex, viewpoint, before, after }) {
  return roverJson(
    base,
    `/api/candidates/${encodeURIComponent(candidateId)}/images/before-after/openai-prompt`,
    {
      method: 'POST',
      body: {
        serviceSlug: serviceSlug || '',
        pairIndex: pairIndex || 1,
        viewpoint,
        occupancy: 'none',
        before,
        after,
      },
    },
  );
}
