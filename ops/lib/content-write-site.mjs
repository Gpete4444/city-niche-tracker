/**
 * Anthropic API Write site job: field research → brief → outline → batched write →
 * polish → image queries. Same artifacts as Copy/Load. Resume skips durable phases.
 */
import { getCandidateDetail, loadMeta, saveMeta } from './candidates.mjs';
import { claudeMessages } from './claude.mjs';
import {
  buildBatchedFullWritePrompt,
  buildFieldResearchPrompt,
  buildFinalCheckPrompt,
  buildImageQueriesPrompt,
  buildSoftBriefPrompt,
  getContentFieldResearch,
  getWriteBatchStatus,
  injectEightPassContext,
  pasteAndConfirmSoftBrief,
  saveContentFieldResearch,
  saveImagesPlan,
  stampFinalCheck,
  syncWriteBatchesFromDraft,
} from './content-eight-pass.mjs';
import {
  buildEditorPrompt,
  getContentBrief,
  getContentSpeechLint,
  pasteAgentContentDraft,
} from './content-agents.mjs';
import {
  buildStructurePrompt,
  composeContentOutline,
  confirmContentOutline,
  getContentOutlinePackage,
  getContentStructure,
  pasteContentOutlinePackage,
  buildContinueWritePrompt,
} from './content-structure.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { structureHasPhotosEnabled } from './fill-site-images.mjs';
import { updateLightJobProgress } from './rover-light-jobs.mjs';

const COST_KEY = (candidateId) => ({
  candidateId,
  label: 'writeSite',
  accumulate: true,
});

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw Object.assign(new Error('Stopped'), { status: 499, cancelled: true });
  }
}

function leftoversFromLint(speechLint, seoLint) {
  const speechN = speechLint?.findings?.length || 0;
  const criticalSeoN = (seoLint?.findings || []).filter((f) => f.severity === 'critical').length;
  return { speechN, criticalSeoN, speechLint, seoLint };
}

export function writeSiteInnerDone(candidateId) {
  const d = getCandidateDetail(candidateId);
  const field = d.contentFieldResearch || getContentFieldResearch(candidateId);
  const brief = d.contentBrief || getContentBrief(candidateId);
  const outline = d.contentOutlinePackage || getContentOutlinePackage(candidateId);
  const draft = d.contentDraft || d.content;
  const batches = getWriteBatchStatus(candidateId, d);
  const speechN = draft?._ops?.speechLint?.findings?.length || 0;
  const speechChecked = Boolean(draft?._ops?.lastSpeechCheckAt);
  const finalOk = Boolean(draft?._ops?.lastFinalCheckAt || d.content?._ops?.lastFinalCheckAt);
  const photosOn = structureHasPhotosEnabled(candidateId);
  const queriesLoaded = Boolean(
    d.imagesPlan?.loadedAt || draft?._ops?.lastImagesPlanAt || d.content?._ops?.lastImagesPlanAt,
  );
  return {
    field: Boolean(field?.status === 'loaded'),
    brief: brief?.status === 'confirmed',
    outline: outline?.status === 'confirmed' && Boolean(outline?.sections?.length),
    write: Boolean(batches.allComplete),
    editor: Boolean(speechChecked && speechN === 0),
    finalCheck: Boolean(finalOk),
    imageQueries: !photosOn || queriesLoaded,
    photosOn,
    all:
      Boolean(field?.status === 'loaded') &&
      brief?.status === 'confirmed' &&
      outline?.status === 'confirmed' &&
      Boolean(batches.allComplete) &&
      Boolean(speechChecked && speechN === 0) &&
      Boolean(finalOk) &&
      (!photosOn || queriesLoaded),
  };
}

export function assertWriteSiteReady(candidateId) {
  if (!loadAcceptedSiteConfig(candidateId)?.config) {
    throw Object.assign(new Error('Accept Site config first'), { status: 400 });
  }
  const structure = getContentStructure(candidateId);
  const outline = getContentOutlinePackage(candidateId);
  if (!structure?.sections?.length && !outline?.sections?.length) {
    throw Object.assign(
      new Error('Finish Structure (Continue) before Write site with Claude'),
      { status: 400 },
    );
  }
}

function costKey(candidateId) {
  return COST_KEY(candidateId);
}

async function callClaude(candidateId, { user, system, cacheSystem, maxTokens, temperature, signal }) {
  throwIfAborted(signal);
  return claudeMessages({
    user,
    system,
    cacheSystem: Boolean(cacheSystem && system),
    maxTokens,
    temperature,
    signal,
    costKey: costKey(candidateId),
  });
}

function throwIfMissingJson(phase, { parsed, truncated, text }, { shapeOk = true, missing = null } = {}) {
  if (parsed?.ok && shapeOk) return;
  const msg = truncated
    ? `${phase}: Claude hit the output limit before finishing JSON. Retry Write site.`
    : missing || `${phase}: Claude did not return JSON`;
  throw Object.assign(new Error(msg), { status: 500, raw: text, truncated: Boolean(truncated) });
}

async function runResearch(candidateId, signal, tick) {
  const field = getContentFieldResearch(candidateId);
  if (field?.status !== 'loaded') {
    tick('Research — Site research');
    const { prompt } = await buildFieldResearchPrompt(candidateId);
    const { parsed, text, truncated } = await callClaude(candidateId, {
      user: prompt,
      maxTokens: 16384,
      temperature: 0.4,
      signal,
    });
    throwIfMissingJson('Site research', { parsed, truncated, text });
    saveContentFieldResearch(candidateId, parsed.value);
  }
  throwIfAborted(signal);
  const brief = getContentBrief(candidateId);
  if (brief?.status !== 'confirmed') {
    tick('Research — Content brief');
    const { prompt } = await buildSoftBriefPrompt(candidateId);
    const { parsed, text, truncated } = await callClaude(candidateId, {
      user: prompt,
      maxTokens: 32768,
      temperature: 0.3,
      signal,
    });
    throwIfMissingJson(
      'Brief',
      { parsed, truncated, text },
      {
        shapeOk: Array.isArray(parsed.value?.pages),
        missing: 'Brief: Claude did not return pages[] JSON',
      },
    );
    pasteAndConfirmSoftBrief(candidateId, parsed.value);
  }
}

async function runPlan(candidateId, signal, tick) {
  let outline = getContentOutlinePackage(candidateId);
  if (!outline?.sections?.length) {
    composeContentOutline(candidateId);
    outline = getContentOutlinePackage(candidateId);
  }
  if (outline?.status === 'confirmed') return;
  tick('Plan — Outline');
  const { prompt } = await buildStructurePrompt(candidateId);
  const { parsed, text, truncated } = await callClaude(candidateId, {
    user: prompt,
    maxTokens: 16384,
    temperature: 0.3,
    signal,
  });
  throwIfMissingJson(
    'Outline',
    { parsed, truncated, text },
    {
      shapeOk: Array.isArray(parsed.value?.sections),
      missing: 'Outline: Claude did not return sections[] JSON',
    },
  );
  pasteContentOutlinePackage(candidateId, parsed.value);
  await confirmContentOutline(candidateId);
}

function cacheSystemBlob(candidateId) {
  try {
    const { prefix } = injectEightPassContext(candidateId);
    const outline = getContentOutlinePackage(candidateId) || {};
    return `${prefix}\n\n## Confirmed outline\n${JSON.stringify(outline, null, 2)}`;
  } catch {
    return '';
  }
}

async function runWrite(candidateId, signal, tick) {
  const system = cacheSystemBlob(candidateId);
  const status = getWriteBatchStatus(candidateId);
  const batches = [];
  if (status.needHome && !status.complete.home) batches.push('home');
  if (status.needServices && !status.complete.services) batches.push('services');
  if (status.needLocations && !status.complete.locations) batches.push('locations');

  for (const batch of batches) {
    throwIfAborted(signal);
    tick(`Write — ${batch[0].toUpperCase()}${batch.slice(1)}`);
    const built = await buildBatchedFullWritePrompt(candidateId, batch);
    const { text } = await callClaude(candidateId, {
      user: built.prompt,
      system,
      cacheSystem: Boolean(system),
      maxTokens: 16384,
      temperature: 0.5,
      signal,
    });
    if (!String(text).includes('### FILE:')) {
      throw Object.assign(new Error(`Full write (${batch}): Claude did not return FILE blocks`), {
        status: 500,
      });
    }
    pasteAgentContentDraft(candidateId, text, { mode: 'full' });
    syncWriteBatchesFromDraft(candidateId);
  }

  let continues = 0;
  while (continues < 4) {
    throwIfAborted(signal);
    let cont;
    try {
      cont = await buildContinueWritePrompt(candidateId);
    } catch (error) {
      if (error?.status === 400 && /Nothing to continue/i.test(error.message || '')) break;
      throw error;
    }
    tick(`Write — continue (${continues + 1})`);
    const { text } = await callClaude(candidateId, {
      user: cont.prompt,
      system,
      cacheSystem: Boolean(system),
      maxTokens: 16384,
      temperature: 0.5,
      signal,
    });
    if (!String(text).includes('### FILE:')) {
      throw Object.assign(new Error('Continue write: Claude did not return FILE blocks'), {
        status: 500,
      });
    }
    pasteAgentContentDraft(candidateId, text, { mode: 'full' });
    syncWriteBatchesFromDraft(candidateId);
    continues += 1;
  }
  const after = getWriteBatchStatus(candidateId);
  if (!after.allComplete) {
    throw Object.assign(
      new Error('Write batches still incomplete after continue — retry Write site'),
      { status: 500 },
    );
  }
}

async function runPolish(candidateId, signal, tick) {
  tick('Polish — Speech/SEO auto-fix');
  throwIfAborted(signal);
  let lint = getContentSpeechLint(candidateId);
  let left = leftoversFromLint(lint.speechLint, lint.seoLint);
  if (left.speechN > 0 || left.criticalSeoN > 0) {
    tick('Polish — editor');
    throwIfAborted(signal);
    const { prompt } = buildEditorPrompt(candidateId);
    const { text } = await callClaude(candidateId, {
      user: prompt,
      maxTokens: 16384,
      temperature: 0.4,
      signal,
    });
    if (String(text).includes('### FILE:')) {
      pasteAgentContentDraft(candidateId, text, { mode: 'full' });
    }
    lint = getContentSpeechLint(candidateId);
    left = leftoversFromLint(lint.speechLint, lint.seoLint);
  }
  if (left.speechN > 0) {
    const err = Object.assign(
      new Error(
        `Polish leftover speech findings (${left.speechN}). Retry this phase or switch to Copy & paste Humanize.`,
      ),
      { status: 422 },
    );
    err.speechLint = left.speechLint;
    err.seoLint = left.seoLint;
    throw err;
  }

  const draft = getCandidateDetail(candidateId).contentDraft;
  if (draft?._ops?.lastFinalCheckAt) return;

  if (left.criticalSeoN === 0) {
    stampFinalCheck(candidateId, { ok: true, summary: 'Rover lint clear (no Claude final-check)' });
    return;
  }

  tick('Polish — Final check');
  const { prompt } = await buildFinalCheckPrompt(candidateId);
  const { text, parsed } = await callClaude(candidateId, {
    user: prompt,
    maxTokens: 16384,
    temperature: 0.2,
    signal,
  });
  if (parsed.ok && parsed.value?.ok === true) {
    stampFinalCheck(candidateId, { ok: true, summary: parsed.value.summary || 'Claude ok' });
    return;
  }
  if (String(text).includes('### FILE:')) {
    pasteAgentContentDraft(candidateId, text, { mode: 'full' });
    stampFinalCheck(candidateId, { ok: true, summary: 'FILE fixes loaded' });
    syncWriteBatchesFromDraft(candidateId);
    return;
  }
  const err = Object.assign(new Error('Final check did not return {"ok":true} or FILE fixes'), {
    status: 422,
  });
  err.speechLint = left.speechLint;
  err.seoLint = left.seoLint;
  throw err;
}

async function runImageQueries(candidateId, signal, tick) {
  if (!structureHasPhotosEnabled(candidateId)) return;
  const d = getCandidateDetail(candidateId);
  if (d.imagesPlan?.loadedAt || d.contentDraft?._ops?.lastImagesPlanAt) return;
  tick('Image queries');
  const { prompt } = buildImageQueriesPrompt(candidateId);
  const { parsed, text, truncated } = await callClaude(candidateId, {
    user: prompt,
    maxTokens: 16384,
    temperature: 0.3,
    signal,
  });
  throwIfMissingJson('Image queries', { parsed, truncated, text });
  saveImagesPlan(candidateId, parsed.value);
}

/**
 * @param {string} candidateId
 * @param {{ jobId: string, signal?: AbortSignal }} ctx
 */
export async function runWriteSiteJob(candidateId, { jobId, signal } = {}) {
  assertWriteSiteReady(candidateId);
  saveMeta(candidateId, { lastCosts: { writeSite: 0 } });
  const photosOn = structureHasPhotosEnabled(candidateId);
  const total = photosOn ? 5 : 4;
  const tick = (detail, done) => {
    updateLightJobProgress(jobId, { detail, done, total });
  };

  tick('Starting…', 0);
  tick('Research', 1);
  await runResearch(candidateId, signal, (d) => tick(d, 1));
  tick('Plan', 2);
  await runPlan(candidateId, signal, (d) => tick(d, 2));
  tick('Write', 3);
  await runWrite(candidateId, signal, (d) => tick(d, 3));
  tick('Polish', 4);
  await runPolish(candidateId, signal, (d) => tick(d, 4));
  if (photosOn) {
    tick('Image queries', 5);
    await runImageQueries(candidateId, signal, (d) => tick(d, 5));
  }
  tick('Done', total);
  return {
    ok: true,
    candidate: getCandidateDetail(candidateId),
    spentUsd: loadMeta(candidateId)?.lastCosts?.writeSite ?? null,
  };
}
