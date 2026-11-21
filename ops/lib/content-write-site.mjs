/**
 * Anthropic API Write site job: field research → brief → outline → batched write →
 * polish → image queries. Same artifacts as Copy/Load. Resume skips durable phases.
 */
import { getCandidateDetail, getCandidateShell, loadMeta, saveMeta } from './candidates.mjs';
import { claudeMessages } from './claude.mjs';
import { claudeJsonWithContinue } from './claude-json-continue.mjs';
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
  imagesPlanIsComplete,
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
  mergeOutlineSectionChunks,
  outlineRefineGroups,
  pasteContentOutlinePackage,
  buildContinueWritePrompt,
  refreshServiceBandAssignments,
} from './content-structure.mjs';
import {
  ensureContentDraftFromAccepted,
  liftSavedHomepageDraft,
  loadAcceptedSiteConfig,
  purgeUnusedServicePages,
} from './content-markdown.mjs';
import {
  applyStoredNichePhotoBlocks,
  ensureNichePhotoBlocksForCandidate,
} from './niche-photo-blocks.mjs';
import {
  cityContextPromptRules,
  compactCityContextForPrompt,
  getCachedCityContext,
} from './city-context.mjs';
import { listImageSlots, structureHasPhotosEnabled } from './fill-site-images.mjs';
import { listBaPromptSlots } from './chatgpt-before-after.mjs';
import {
  applyStoredNicheImagePrompts,
  baPromptComplete,
  incompleteBeforeAfterKeys,
  rememberNicheImagePrompts,
} from './niche-image-prompts.mjs';
import { updateLightJobProgress } from './rover-light-jobs.mjs';
import { listLaunchContentGaps, locationPagesNeedingWrite, resolveStructurePageIds } from './preview-fidelity.mjs';

const COST_KEY = (candidateId) => ({
  candidateId,
  label: 'writeSite',
  accumulate: true,
});

export const POLISH_EDITOR_ATTEMPTS = 3;
export const EXPAND_LOCATION_ATTEMPTS = 2;
export const EXPAND_SERVICE_ATTEMPTS = 2;
export const LOCATION_WRITE_CHUNK = 3;

/** Speech leftovers never 422 Write site after Polish (advisory). */
export function polishSpeechShouldBlockWrite(_opts = {}) {
  return false;
}

export function thinLocationSeoFindings(seoLint) {
  return (seoLint?.findings || []).filter(
    (f) => f.severity === 'critical' && String(f.rule || '') === 'location_body_thin',
  );
}

export function thinServiceSeoFindings(seoLint) {
  return (seoLint?.findings || []).filter(
    (f) => f.severity === 'critical' && String(f.rule || '') === 'service_body_thin',
  );
}

export function leftoversFromLint(speechLint, seoLint) {
  const speechN = speechLint?.findings?.length || 0;
  const criticalSeoN = (seoLint?.findings || []).filter((f) => f.severity === 'critical').length;
  const thinLocationN = thinLocationSeoFindings(seoLint).length;
  const thinServiceN = thinServiceSeoFindings(seoLint).length;
  return { speechN, criticalSeoN, thinLocationN, thinServiceN, speechLint, seoLint };
}

/** Editor runs while speech leftovers or any critical SEO remain (all attempts). */
export function polishNeedsEditor({ speechN = 0, criticalSeoN = 0 } = {}) {
  return Number(speechN) > 0 || Number(criticalSeoN) > 0;
}

/** Re-run Write site still polishes when Final check is stamped but critical SEO remains. */
export function polishShouldSkipBecauseFinalStamped({ lastFinalCheckAt, criticalSeoN = 0 } = {}) {
  return Boolean(lastFinalCheckAt) && Number(criticalSeoN) === 0;
}

export function polishThinLocationsShouldBlockWrite({ thinLocationN = 0 } = {}) {
  return Number(thinLocationN) > 0;
}

export function polishThinServicesShouldBlockWrite({ thinServiceN = 0 } = {}) {
  return Number(thinServiceN) > 0;
}

export function chunkList(items, size) {
  const list = Array.isArray(items) ? items : [];
  const n = Math.max(1, Number(size) || 1);
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** Accept rewrites thin or missing pages in small Claude calls, then continues. */
export const ACCEPT_CONTINUE_ROUNDS = 4;
export const ACCEPT_CONTINUE_CHUNK = 2;

/** Extra tries when Claude returns no FILE blocks or no JSON. The first call is not counted. */
export const EMPTY_REPLY_RETRIES = 2;

export function isResumeableWriteError(error) {
  if (!error || error.cancelled || error.status === 499) return false;
  const msg = String(error.message || '');
  if (/^Stopped$/i.test(msg)) return false;
  if (/Accept Site config first|Finish Structure/i.test(msg)) return false;
  return /did not return (?:a )?FILE blocks?|did not return JSON|did not return pages\[\]|did not return sections\[\]|Retry Write site|connection dropped|fetch failed|Anthropic HTTP (?:429|500|502|503|504|520|529)\b/i.test(
    msg,
  );
}

/** Accept still missing or thin pages. Warnings, State, and a missing draft stay with the user. */
export function isAcceptGapError(error) {
  if (!error || error.cancelled || error.status === 499) return false;
  const msg = String(error.message || '');
  if (/Content warnings|Set State on Site-config|No content draft|before Accept|Image queries/i.test(msg)) {
    return false;
  }
  return /incomplete for launch/i.test(msg);
}

/**
 * Run a write-site pass. One resumeable failure continues once; Stop and setup errors do not.
 */
export async function continueWriteSiteOnce(run, { onContinue } = {}) {
  try {
    return await run();
  } catch (error) {
    if (!isResumeableWriteError(error)) throw error;
    if (typeof onContinue === 'function') onContinue();
    return await run();
  }
}

/**
 * Rewrite missing pages, publish, and if the draft is still thin, rewrite once more.
 * The second publish error is returned as-is.
 */
export async function acceptAfterGapRewrite({ rewrite, accept, onContinue } = {}) {
  await rewrite();
  try {
    return await accept();
  } catch (error) {
    if (!isAcceptGapError(error)) throw error;
    if (typeof onContinue === 'function') onContinue();
    await rewrite();
    return await accept();
  }
}

export function acceptContinueRewritePlan({
  hasKey,
  gapPaths,
  chunkSize = ACCEPT_CONTINUE_CHUNK,
} = {}) {
  const paths = (Array.isArray(gapPaths) ? gapPaths : []).map((p) => String(p || '').trim()).filter(Boolean);
  if (!hasKey) return { action: 'skip', reason: 'no-key', chunks: [] };
  if (!paths.length) return { action: 'skip', reason: 'clear', chunks: [] };
  return { action: 'rewrite', reason: null, chunks: chunkList(paths, chunkSize) };
}

export function launchContentGapPaths(candidateId) {
  const detail = getCandidateDetail(candidateId);
  const files = detail?.contentDraft?.files || detail?.content?.files || {};
  const config = loadAcceptedSiteConfig(candidateId)?.config || detail?.siteConfig || {};
  const pageIds = resolveStructurePageIds(candidateId, detail);
  const gaps = listLaunchContentGaps(files, config, pageIds);
  const paths = [...gaps.missing, ...gaps.stubs.filter((p) => !gaps.missing.includes(p))];
  return { ...gaps, paths };
}

function gapRewriteLabel(paths) {
  const n = paths.length;
  const services = n > 0 && paths.every((p) => String(p).includes('/services/'));
  const noun = services
    ? `thin service page${n === 1 ? '' : 's'}`
    : `thin page${n === 1 ? '' : 's'}`;
  return `Rewriting ${n} ${noun}`;
}

/**
 * When Accept would stop on missing or stub/thin pages, rewrite those files through Claude.
 * No key, or a draft that is already complete, does not call Claude.
 */
export async function rewriteLaunchContentGaps(candidateId, opts = {}) {
  const {
    signal,
    tick,
    hasKey = Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim()),
    loadGaps = () => launchContentGapPaths(candidateId),
    buildPrompt = (onlyFiles) => buildContinueWritePrompt(candidateId, { onlyFiles }),
    callClaudeFn = null,
    pasteFn = (text) => pasteAgentContentDraft(candidateId, text, { mode: 'full' }),
    syncFn = () => syncPhotoBlocks(candidateId, tick),
  } = opts;

  let current = (await loadGaps())?.paths || [];
  const plan = acceptContinueRewritePlan({ hasKey, gapPaths: current });
  if (plan.action === 'skip') {
    return { skipped: true, reason: plan.reason, remaining: current.length, rounds: 0 };
  }

  const call =
    callClaudeFn ||
    (async (built) => {
      const system = cacheSystemBlob(candidateId);
      return callClaude(candidateId, {
        user: built.prompt,
        system,
        cacheSystem: Boolean(system),
        maxTokens: 16384,
        temperature: 0.5,
        signal,
      });
    });

  let rounds = 0;
  while (rounds < ACCEPT_CONTINUE_ROUNDS && current.length) {
    rounds += 1;
    const chunks = chunkList(current, ACCEPT_CONTINUE_CHUNK);
    for (let i = 0; i < chunks.length; i += 1) {
      throwIfAborted(signal);
      const fresh = (await loadGaps())?.paths || [];
      const freshSet = new Set(fresh);
      const chunk = chunks[i].filter((rel) => freshSet.has(rel));
      if (!chunk.length) continue;
      const label = gapRewriteLabel(fresh);
      tick?.(chunks.length > 1 ? `${label} (${i + 1}/${chunks.length})` : label);
      const built = await buildPrompt(chunk);
      const { text } = await callUntilFileBlocks({
        signal,
        tick,
        failMessage: 'Continue write: Claude did not return FILE blocks',
        call: () => call(built),
      });
      await pasteFn(text);
      await syncFn();
    }
    current = (await loadGaps())?.paths || [];
  }
  return {
    skipped: false,
    reason: current.length ? 'remaining' : 'clear',
    remaining: current.length,
    rounds,
  };
}

/** Polish phase is done once speech was checked — leftover findings do not block. */
export function writeSitePolishDone({ speechChecked } = {}) {
  return Boolean(speechChecked);
}

/**
 * Write-site phase flags. Speech leftovers do not clear editor / all.
 * @param {{
 *   fieldLoaded?: boolean,
 *   briefConfirmed?: boolean,
 *   outlineConfirmed?: boolean,
 *   writeComplete?: boolean,
 *   speechChecked?: boolean,
 *   speechN?: number,
 *   finalOk?: boolean,
 *   photosOn?: boolean,
 *   queriesLoaded?: boolean,
 * }} flags
 */
export function composeWriteSiteInnerDone(flags = {}) {
  const editor = writeSitePolishDone({ speechChecked: flags.speechChecked });
  const field = Boolean(flags.fieldLoaded);
  const brief = Boolean(flags.briefConfirmed);
  const outline = Boolean(flags.outlineConfirmed);
  const write = Boolean(flags.writeComplete);
  const finalCheck = Boolean(flags.finalOk);
  const imageQueries = !flags.photosOn || Boolean(flags.queriesLoaded);
  return {
    field,
    brief,
    outline,
    write,
    editor,
    finalCheck,
    imageQueries,
    photosOn: Boolean(flags.photosOn),
    all: field && brief && outline && write && editor && finalCheck && imageQueries,
  };
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw Object.assign(new Error('Stopped'), { status: 499, cancelled: true });
  }
}

/** Ask again when a write reply has no ### FILE: blocks. Stop still stops. */
export async function callUntilFileBlocks({ call, signal, tick, failMessage } = {}) {
  let last = { text: '' };
  for (let attempt = 0; attempt <= EMPTY_REPLY_RETRIES; attempt += 1) {
    throwIfAborted(signal);
    if (attempt > 0) tick?.('Continuing…');
    last = await call();
    if (String(last?.text || '').includes('### FILE:')) return last;
  }
  throw Object.assign(new Error(failMessage || 'Claude did not return FILE blocks'), { status: 500 });
}

/** Ask again when research, brief, or outline JSON is missing. A cut-off reply is not asked again here. */
export async function callUntilJson({ call, signal, tick, phase, shapeOk = true, missing = null } = {}) {
  let last = { parsed: { ok: false }, truncated: false, text: '' };
  for (let attempt = 0; attempt <= EMPTY_REPLY_RETRIES; attempt += 1) {
    throwIfAborted(signal);
    if (attempt > 0) tick?.('Continuing…');
    last = await call();
    const shape = typeof shapeOk === 'function' ? Boolean(shapeOk(last)) : shapeOk !== false;
    if (last?.parsed?.ok && shape) return last;
    if (last?.truncated || attempt === EMPTY_REPLY_RETRIES) {
      throwIfMissingJson(phase, last, { shapeOk: shape, missing });
    }
  }
  return last;
}

export function writeSiteInnerDone(candidateId) {
  const d = getCandidateDetail(candidateId);
  const field = d.contentFieldResearch || getContentFieldResearch(candidateId);
  const brief = d.contentBrief || getContentBrief(candidateId);
  const outline = d.contentOutlinePackage || getContentOutlinePackage(candidateId);
  const draft = d.contentDraft || d.content;
  const batches = getWriteBatchStatus(candidateId, d);
  const speechChecked = Boolean(draft?._ops?.lastSpeechCheckAt);
  const speechN = draft?._ops?.speechLint?.findings?.length || 0;
  const finalOk = Boolean(draft?._ops?.lastFinalCheckAt || d.content?._ops?.lastFinalCheckAt);
  const photosOn = structureHasPhotosEnabled(candidateId);
  const queriesLoaded = imagesPlanIsComplete(candidateId);
  return composeWriteSiteInnerDone({
    fieldLoaded: field?.status === 'loaded',
    briefConfirmed: brief?.status === 'confirmed',
    outlineConfirmed: outline?.status === 'confirmed' && Boolean(outline?.sections?.length),
    writeComplete: batches.allComplete,
    speechChecked,
    speechN,
    finalOk,
    photosOn,
    queriesLoaded,
  });
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

export const OUTLINE_REFINE_MAX_TOKENS = 32768;

async function callClaude(candidateId, { user, system, cacheSystem, maxTokens, temperature, signal, messages }) {
  throwIfAborted(signal);
  return claudeMessages({
    user,
    messages,
    system,
    cacheSystem: Boolean(cacheSystem && system),
    maxTokens,
    temperature,
    signal,
    costKey: costKey(candidateId),
  });
}

function outlineJsonShapeOk(parsed) {
  return Boolean(parsed?.ok && Array.isArray(parsed.value?.sections) && parsed.value.sections.length);
}

/**
 * Full outline refine with JSON-continue; if still incomplete, home / services / locations slices.
 */
export async function refineOutlineFromClaude({
  prompt,
  outline,
  maxTokens = OUTLINE_REFINE_MAX_TOKENS,
  callClaudeFn,
  buildSlicePrompt,
  signal,
  tick,
} = {}) {
  const call = typeof callClaudeFn === 'function' ? callClaudeFn : async () => ({});
  const full = await claudeJsonWithContinue({
    user: prompt,
    maxTokens,
    temperature: 0.3,
    signal,
    claudeMessagesFn: call,
  });
  if (outlineJsonShapeOk(full.parsed)) {
    return { ...full, mode: 'full' };
  }

  const groups = outlineRefineGroups(outline);
  if (!groups.length || typeof buildSlicePrompt !== 'function') {
    return { ...full, mode: 'full' };
  }

  const chunks = [];
  for (const group of groups) {
    throwIfAborted(signal);
    tick?.(`Plan — Outline (${group.label})`);
    const slicePrompt = await buildSlicePrompt(group.sectionIds);
    const part = await claudeJsonWithContinue({
      user: slicePrompt,
      maxTokens,
      temperature: 0.3,
      signal,
      claudeMessagesFn: call,
    });
    if (!outlineJsonShapeOk(part.parsed)) {
      return { ...part, mode: 'chunk', failedGroup: group.label };
    }
    chunks.push(part.parsed.value);
  }

  const merged = mergeOutlineSectionChunks(outline, chunks);
  return {
    parsed: { ok: true, value: merged },
    text: JSON.stringify(merged),
    truncated: false,
    mode: 'chunks',
  };
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
    const { parsed } = await callUntilJson({
      signal,
      tick,
      phase: 'Site research',
      call: () =>
        callClaude(candidateId, {
          user: prompt,
          maxTokens: 16384,
          temperature: 0.4,
          signal,
        }),
    });
    saveContentFieldResearch(candidateId, parsed.value);
  }
  throwIfAborted(signal);
  const brief = getContentBrief(candidateId);
  if (brief?.status !== 'confirmed') {
    tick('Research — Content brief');
    const { prompt } = await buildSoftBriefPrompt(candidateId);
    const { parsed } = await callUntilJson({
      signal,
      tick,
      phase: 'Brief',
      missing: 'Brief: Claude did not return pages[] JSON',
      shapeOk: (result) => Array.isArray(result?.parsed?.value?.pages),
      call: () =>
        callClaude(candidateId, {
          user: prompt,
          maxTokens: 32768,
          temperature: 0.3,
          signal,
        }),
    });
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
  const result = await callUntilJson({
    signal,
    tick,
    phase: 'Outline',
    missing: 'Outline: Claude did not return sections[] JSON',
    shapeOk: (value) => outlineJsonShapeOk(value?.parsed),
    call: () =>
      refineOutlineFromClaude({
        prompt,
        outline,
        maxTokens: OUTLINE_REFINE_MAX_TOKENS,
        callClaudeFn: (opts) => callClaude(candidateId, opts),
        buildSlicePrompt: async (sectionIds) => {
          const built = await buildStructurePrompt(candidateId, { sectionIds });
          return built.prompt;
        },
        signal,
        tick,
      }),
  });
  pasteContentOutlinePackage(candidateId, result.parsed.value);
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

async function syncPhotoBlocks(candidateId, tick) {
  const applied = await applyStoredNichePhotoBlocks(candidateId);
  if (applied?.count && tick) {
    tick(
      `Photo blocks — updated ${applied.count} page${applied.count === 1 ? '' : 's'}`,
    );
  }
  return applied;
}

async function runWrite(candidateId, signal, tick) {
  const purged = purgeUnusedServicePages(candidateId);
  if (purged.removed.length) {
    tick(
      `Removed ${purged.removed.length} service page${purged.removed.length === 1 ? '' : 's'} not on the service list`,
    );
  }
  refreshServiceBandAssignments(candidateId);
  const liftedHome = liftSavedHomepageDraft(candidateId);
  if (liftedHome.changed) tick(liftedHome.detail || 'Homepage — placed designed sections into template fields');
  const photoBlocks = await ensureNichePhotoBlocksForCandidate(candidateId, {
    signal,
    callClaude: (opts) => callClaude(candidateId, opts),
  });
  if (photoBlocks?.authored) tick('Photo blocks — saved shared steps for this niche');
  await syncPhotoBlocks(candidateId, tick);
  const system = cacheSystemBlob(candidateId);
  const status = getWriteBatchStatus(candidateId);
  const batches = [];
  if (status.needHome && !status.complete.home) batches.push('home');
  if (status.needServices && !status.complete.services) batches.push('services');
  if (status.needLocations && !status.complete.locations) batches.push('locations');

  const writeOne = async (batch, built, label) => {
    tick(label);
    const { text } = await callUntilFileBlocks({
      signal,
      tick,
      failMessage: `Full write (${batch}): Claude did not return FILE blocks`,
      call: () =>
        callClaude(candidateId, {
          user: built.prompt,
          system,
          cacheSystem: Boolean(system),
          maxTokens: 16384,
          temperature: 0.5,
          signal,
        }),
    });
    const pasted = pasteAgentContentDraft(candidateId, text, { mode: 'full' });
    await syncPhotoBlocks(candidateId, tick);
    syncWriteBatchesFromDraft(candidateId);
    if (pasted?.skippedYaml?.length) {
      tick(
        `${label} · skipped ${pasted.skippedYaml
          .map((rel) => String(rel).replace(/^src\/content\//, ''))
          .join(', ')}`,
      );
    }
  };

  for (const batch of batches) {
    throwIfAborted(signal);
    if (batch === 'locations') {
      const full = await buildBatchedFullWritePrompt(candidateId, 'locations');
      const chunks = chunkList(full.batchFiles || [], LOCATION_WRITE_CHUNK);
      if (chunks.length <= 1) {
        await writeOne('locations', full, 'Write — Locations');
      } else {
        for (let i = 0; i < chunks.length; i += 1) {
          throwIfAborted(signal);
          const part = await buildBatchedFullWritePrompt(candidateId, 'locations', {
            onlyFiles: chunks[i],
          });
          await writeOne('locations', part, `Write — Locations (${i + 1}/${chunks.length})`);
        }
      }
    } else {
      const built = await buildBatchedFullWritePrompt(candidateId, batch);
      await writeOne(batch, built, `Write — ${batch[0].toUpperCase()}${batch.slice(1)}`);
    }
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
    const { text } = await callUntilFileBlocks({
      signal,
      tick,
      failMessage: 'Continue write: Claude did not return FILE blocks',
      call: () =>
        callClaude(candidateId, {
          user: cont.prompt,
          system,
          cacheSystem: Boolean(system),
          maxTokens: 16384,
          temperature: 0.5,
          signal,
        }),
    });
    pasteAgentContentDraft(candidateId, text, { mode: 'full' });
    await syncPhotoBlocks(candidateId, tick);
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

  ensureContentDraftFromAccepted(candidateId);
  const locationDetail = getCandidateDetail(candidateId);
  const locationFiles =
    locationDetail.contentDraft?.files || locationDetail.content?.files || {};
  const needing = locationPagesNeedingWrite(locationDetail.siteConfig || {}, locationFiles);
  if (needing.length) {
    const paths = needing.map((page) => page.path);
    const chunks = chunkList(paths, LOCATION_WRITE_CHUNK);
    if (chunks.length <= 1) {
      const built = await buildBatchedFullWritePrompt(candidateId, 'locations', { onlyFiles: paths });
      await writeOne(
        'locations',
        built,
        `Write — ${needing.map((page) => page.name).join(', ')}`,
      );
    } else {
      for (let i = 0; i < chunks.length; i += 1) {
        throwIfAborted(signal);
        const part = await buildBatchedFullWritePrompt(candidateId, 'locations', {
          onlyFiles: chunks[i],
        });
        await writeOne('locations', part, `Write — Location pages (${i + 1}/${chunks.length})`);
      }
    }
  }
}

function throwThinLocations(seoLint, { retryLabel = 'Retry Write site or Expand location pages' } = {}) {
  const thin = thinLocationSeoFindings(seoLint);
  const names = thin.map((f) => f.file || f.excerpt || 'location page').join(', ');
  const err = Object.assign(
    new Error(`Location pages still under 450 words (${names}). ${retryLabel}.`),
    { status: 422 },
  );
  err.seoLint = seoLint;
  return err;
}

export function buildExpandThinLocationsPrompt(candidateId, findings = []) {
  const files = getCandidateDetail(candidateId)?.contentDraft?.files || {};
  const want = new Set(
    (findings || [])
      .map((f) => String(f.file || '').trim())
      .filter((rel) => /locations\/.+\.md$/i.test(rel)),
  );
  const selected = Object.entries(files).filter(([rel]) => want.has(rel));
  if (!selected.length) {
    throw Object.assign(new Error('No thin location pages to expand'), { status: 400 });
  }
  let prefix = '';
  try {
    prefix = `${injectEightPassContext(candidateId).prefix}\n\n`;
  } catch {
    prefix = '';
  }
  const city = compactCityContextForPrompt(getCachedCityContext(candidateId));
  const list = findings
    .filter((f) => want.has(String(f.file || '').trim()))
    .map((f) => `- ${f.file}: ${f.excerpt || 'thin'}`)
    .join('\n');
  const blocks = selected
    .map(([rel, body]) => `### FILE: ${rel}\n${String(body || '').trim()}\n`)
    .join('\n');
  const prompt = `${prefix}You are expanding thin location pages. Return ### FILE: blocks only for the paths listed.

Rules:
- Each FILE body must be at least 600 words of useful local copy (intro + local notes + proof + FAQs + CTA when those sections exist). Accept rejects under 450.
- Add climate, housing, and neighborhood cues from City context. Do not invent neighborhoods or soils.
- Each FILE must stay distinct from sibling location pages. Do not swap only the city name.
- Keep existing frontmatter keys. Do not cannibalize the homepage H1.
- Contractor speech. No invented awards or demographics.

${cityContextPromptRules()}

## Thin findings
${list}

## City context JSON
\`\`\`json
${JSON.stringify(city || { note: 'unavailable' }, null, 2)}
\`\`\`

## Current FILE bodies
${blocks}
`;
  return { prompt, files: selected.map(([rel]) => rel) };
}

async function runExpandThinLocationPass(candidateId, { signal, findings, tick, costOverride } = {}) {
  const { prompt, files } = buildExpandThinLocationsPrompt(candidateId, findings);
  tick?.(`Expand locations — ${files.length} file(s)`);
  const { text } = await callUntilFileBlocks({
    signal,
    tick,
    failMessage: 'Expand locations: Claude did not return FILE blocks',
    call: () =>
      claudeMessages({
        user: prompt,
        maxTokens: 16384,
        temperature: 0.45,
        signal,
        costKey: costOverride || costKey(candidateId),
      }),
  });
  pasteAgentContentDraft(candidateId, text, { mode: 'full' });
  return getContentSpeechLint(candidateId);
}

async function expandThinLocationsUntilClear(candidateId, { signal, tick, costOverride } = {}) {
  let lint = getContentSpeechLint(candidateId);
  let thin = thinLocationSeoFindings(lint.seoLint);
  for (let attempt = 1; attempt <= EXPAND_LOCATION_ATTEMPTS && thin.length; attempt += 1) {
    tick?.(`Polish — expand locations (${attempt}/${EXPAND_LOCATION_ATTEMPTS})`);
    lint = await runExpandThinLocationPass(candidateId, {
      signal,
      findings: thin,
      tick,
      costOverride,
    });
    thin = thinLocationSeoFindings(lint.seoLint);
  }
  return leftoversFromLint(lint.speechLint, lint.seoLint);
}

function throwThinServices(seoLint, { retryLabel = 'Retry Write site' } = {}) {
  const thin = thinServiceSeoFindings(seoLint);
  const names = thin.map((f) => f.file || 'service page').join(', ');
  const err = Object.assign(
    new Error(`Service pages still thin (${names}). ${retryLabel}.`),
    { status: 422 },
  );
  err.seoLint = seoLint;
  return err;
}

export function buildExpandThinServicesPrompt(candidateId, findings = []) {
  const files = getCandidateDetail(candidateId)?.contentDraft?.files || {};
  const want = [...new Set(
    (findings || [])
      .map((f) => String(f.file || '').trim())
      .filter((rel) => /services\/.+\.md$/i.test(rel)),
  )];
  const rel = want[0];
  const body = rel ? files[rel] : '';
  if (!rel || !body) {
    throw Object.assign(new Error('No thin service pages to expand'), { status: 400 });
  }
  let prefix = '';
  try {
    prefix = `${injectEightPassContext(candidateId).prefix}\n\n`;
  } catch {
    prefix = '';
  }
  const finding = (findings || []).find((f) => String(f.file || '').trim() === rel);
  const prompt = `${prefix}You are expanding one thin service page. Return a single ### FILE: block for the path below.

Rules:
- Prose outside the process section and the materials section must be at least 600 words. Accept rejects under 450 words of that prose.
- If the opening sentence stops mid-thought, replace it with a finished intro. Do not leave a fragment.
- Keep the existing process and materials sections unchanged (same headings and bullets). Those lists belong to the niche photo blocks.
- Keep existing frontmatter keys. Do not invent awards, prices, or neighborhoods.
- Contractor speech. This page must stay distinct from sibling service pages.

## Thin finding
- ${rel}: ${finding?.excerpt || 'thin'}

## Current FILE body
### FILE: ${rel}
${String(body).trim()}
`;
  return { prompt, files: [rel] };
}

async function runExpandThinServicePass(candidateId, { signal, finding, tick, costOverride } = {}) {
  await syncPhotoBlocks(candidateId, tick);
  const { prompt, files } = buildExpandThinServicesPrompt(candidateId, [finding]);
  const label = String(files[0] || '').replace(/^src\/content\//, '');
  tick?.(`Expand service — ${label}`);
  const { text } = await callUntilFileBlocks({
    signal,
    tick,
    failMessage: `Expand service (${label}): Claude did not return a FILE block`,
    call: () =>
      claudeMessages({
        user: prompt,
        maxTokens: 16384,
        temperature: 0.45,
        signal,
        costKey: costOverride || costKey(candidateId),
      }),
  });
  pasteAgentContentDraft(candidateId, text, { mode: 'full' });
  await syncPhotoBlocks(candidateId, tick);
  return getContentSpeechLint(candidateId);
}

export async function expandThinServicesUntilClear(candidateId, { signal, tick, costOverride } = {}) {
  let lint = getContentSpeechLint(candidateId);
  let thin = thinServiceSeoFindings(lint.seoLint);
  for (let attempt = 1; attempt <= EXPAND_SERVICE_ATTEMPTS && thin.length; attempt += 1) {
    tick?.(`Polish — expand services (${attempt}/${EXPAND_SERVICE_ATTEMPTS})`);
    const batch = thin.slice();
    for (const finding of batch) {
      throwIfAborted(signal);
      lint = await runExpandThinServicePass(candidateId, {
        signal,
        finding,
        tick,
        costOverride,
      });
    }
    thin = thinServiceSeoFindings(lint.seoLint);
  }
  return leftoversFromLint(lint.speechLint, lint.seoLint);
}

async function runPolish(candidateId, signal, tick) {
  tick('Polish — Speech/SEO auto-fix');
  throwIfAborted(signal);
  let lint = getContentSpeechLint(candidateId);
  let left = leftoversFromLint(lint.speechLint, lint.seoLint);
  const draft = getCandidateDetail(candidateId).contentDraft;
  if (
    polishShouldSkipBecauseFinalStamped({
      lastFinalCheckAt: draft?._ops?.lastFinalCheckAt,
      criticalSeoN: left.criticalSeoN,
    })
  ) {
    return;
  }

  for (let attempt = 1; attempt <= POLISH_EDITOR_ATTEMPTS; attempt += 1) {
    if (!polishNeedsEditor(left)) break;
    tick(`Polish — editor (${attempt}/${POLISH_EDITOR_ATTEMPTS})`);
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
      await syncPhotoBlocks(candidateId, tick);
    }
    lint = getContentSpeechLint(candidateId);
    left = leftoversFromLint(lint.speechLint, lint.seoLint);
  }
  if (left.speechN > 0 && polishSpeechShouldBlockWrite({ speechN: left.speechN })) {
    const err = Object.assign(
      new Error(
        `Polish leftover speech findings (${left.speechN}). Retry this phase.`,
      ),
      { status: 422 },
    );
    err.speechLint = left.speechLint;
    err.seoLint = left.seoLint;
    throw err;
  }

  if (left.thinLocationN > 0) {
    left = await expandThinLocationsUntilClear(candidateId, { signal, tick });
  }
  if (left.thinServiceN > 0) {
    left = await expandThinServicesUntilClear(candidateId, { signal, tick });
  }
  if (polishThinLocationsShouldBlockWrite(left)) {
    throw throwThinLocations(left.seoLint);
  }
  if (polishThinServicesShouldBlockWrite(left)) {
    throw throwThinServices(left.seoLint);
  }

  const stamped = getCandidateDetail(candidateId).contentDraft?._ops?.lastFinalCheckAt;
  if (polishShouldSkipBecauseFinalStamped({ lastFinalCheckAt: stamped, criticalSeoN: left.criticalSeoN })) {
    return;
  }

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
  } else if (String(text).includes('### FILE:')) {
    pasteAgentContentDraft(candidateId, text, { mode: 'full' });
    await syncPhotoBlocks(candidateId, tick);
    stampFinalCheck(candidateId, { ok: true, summary: 'FILE fixes loaded' });
    syncWriteBatchesFromDraft(candidateId);
  } else {
    const err = Object.assign(new Error('Final check did not return {"ok":true} or FILE fixes'), {
      status: 422,
    });
    err.speechLint = left.speechLint;
    err.seoLint = left.seoLint;
    throw err;
  }

  lint = getContentSpeechLint(candidateId);
  left = leftoversFromLint(lint.speechLint, lint.seoLint);
  if (polishThinLocationsShouldBlockWrite(left)) {
    throw throwThinLocations(left.seoLint);
  }
  if (polishThinServicesShouldBlockWrite(left)) {
    throw throwThinServices(left.seoLint);
  }
}

export async function runExpandThinLocationsJob(candidateId, { jobId, signal } = {}) {
  saveMeta(candidateId, { lastCosts: { expandLocations: 0 } });
  const total = 2;
  const tick = (detail, done) => {
    updateLightJobProgress(jobId, { detail, done, total });
  };
  tick('Checking location pages', 0);
  const costOverride = {
    candidateId,
    label: 'expandLocations',
    accumulate: true,
  };
  const left = await expandThinLocationsUntilClear(candidateId, {
    signal,
    tick,
    costOverride,
  });
  if (polishThinLocationsShouldBlockWrite(left)) {
    throw throwThinLocations(left.seoLint, { retryLabel: 'Retry Expand location pages' });
  }
  if (left.criticalSeoN === 0) {
    stampFinalCheck(candidateId, { ok: true, summary: 'Rover lint clear after location expand' });
  }
  tick('Done', total);
  return {
    ok: true,
    thinLocationN: 0,
    spentUsd: loadMeta(candidateId)?.lastCosts?.expandLocations ?? null,
  };
}

export const IMAGE_QUERY_SLOT_CHUNK = 16;
export const IMAGE_QUERY_BA_CHUNK = 2;
/** Extra tries after a group comes back as prose or an empty reply. */
export const IMAGE_QUERY_JSON_RETRIES = 2;
const IMAGE_QUERY_MAX_TOKENS = 16384;

/**
 * Ask Claude for one group of image-query keys. A cut-off reply is continued.
 * If it is still unfinished, the caller splits the group in half.
 */
export async function fetchImageQueryGroup({ prompt, signal, callClaudeFn }) {
  const call = typeof callClaudeFn === 'function' ? callClaudeFn : async () => ({});
  return claudeJsonWithContinue({
    user: prompt,
    maxTokens: IMAGE_QUERY_MAX_TOKENS,
    temperature: 0.3,
    signal,
    claudeMessagesFn: call,
  });
}

/**
 * Fill image-query keys in groups. Truncated groups are split in half.
 * A reply that is not JSON is asked again. A single key that is still cut off
 * raises the Write site output-limit error.
 */
export async function runImageQueryGroups({
  keys,
  chunkSize,
  signal,
  tick,
  kind = 'stock',
  buildPrompt,
  callClaudeFn,
  save,
  stillMissing,
} = {}) {
  let remaining = [...(Array.isArray(keys) ? keys : [])].filter(Boolean);
  let size = Math.max(1, Number(chunkSize) || 1);
  const preferred = size;
  let jsonRetries = 0;
  let retrying = false;
  while (remaining.length) {
    throwIfAborted(signal);
    const chunk = remaining.slice(0, Math.min(size, remaining.length));
    if (typeof tick === 'function') {
      tick(
        retrying
          ? 'Image queries — retry'
          : kind === 'beforeAfter'
            ? `Image queries — before/after ${chunk.join(', ')}`
            : 'Image queries — stock slots',
      );
    }
    retrying = false;
    const prompt = await buildPrompt(chunk);
    const { parsed, text, truncated } = await fetchImageQueryGroup({
      prompt,
      signal,
      callClaudeFn,
    });
    if (truncated || !parsed?.ok) {
      if (truncated && chunk.length > 1) {
        size = Math.max(1, Math.floor(chunk.length / 2));
        jsonRetries = 0;
        continue;
      }
      if (!truncated && jsonRetries < IMAGE_QUERY_JSON_RETRIES) {
        jsonRetries += 1;
        retrying = true;
        continue;
      }
      throwIfMissingJson('Image queries', { parsed, truncated, text });
    }
    let saved = false;
    try {
      save(parsed.value);
      saved = true;
    } catch (error) {
      const missing = incompleteBeforeAfterKeys(error);
      if (!missing) throw error;
      if (jsonRetries < IMAGE_QUERY_JSON_RETRIES) {
        jsonRetries += 1;
        retrying = true;
        continue;
      }
      const partial = completeBeforeAfterPayload(parsed?.value, chunk);
      if (partial) {
        try {
          save(partial);
        } catch {
          /* the finished key stays missing and is asked again after the split */
        }
      }
      if (chunk.length > 1) {
        size = Math.max(1, Math.floor(chunk.length / 2));
        jsonRetries = 0;
        remaining = (typeof stillMissing === 'function' ? stillMissing() : chunk)
          .map((key) => String(key))
          .filter(Boolean);
        continue;
      }
      throw error;
    }
    if (!saved) continue;
    jsonRetries = 0;
    const next = (typeof stillMissing === 'function' ? stillMissing() : [])
      .map((key) => String(key))
      .filter((key) => remaining.includes(key));
    if (chunk.every((key) => next.includes(key))) {
      if (chunk.length > 1) {
        size = Math.max(1, Math.floor(chunk.length / 2));
        continue;
      }
      throw Object.assign(
        new Error(
          kind === 'beforeAfter'
            ? 'Image queries: before/after chunk did not save. Retry Write site.'
            : 'Image queries: stock slot did not save. Retry Write site.',
        ),
        { status: 500 },
      );
    }
    size = preferred;
    remaining = next;
  }
}

function missingImageQuerySlotKeys(candidateId) {
  const plan = getCandidateDetail(candidateId).imagesPlan;
  const slots = plan?.slots && typeof plan.slots === 'object' ? plan.slots : {};
  return listImageSlots(candidateId)
    .filter((s) => !String(slots[s.key]?.query || '').trim())
    .map((s) => s.key);
}

function missingImageQueryBaKeys(candidateId) {
  const plan = getCandidateDetail(candidateId).imagesPlan;
  const ba = plan?.beforeAfter && typeof plan.beforeAfter === 'object' ? plan.beforeAfter : {};
  return listBaPromptSlots(candidateId)
    .filter((s) => {
      const e = ba[s.key];
      return !(
        String(e?.inside?.before || '').trim() &&
        String(e?.inside?.after || '').trim() &&
        String(e?.outside?.before || '').trim() &&
        String(e?.outside?.after || '').trim()
      );
    })
    .map((s) => s.key);
}

function completeBeforeAfterPayload(value, keys) {
  const raw = value?.beforeAfter && typeof value.beforeAfter === 'object' ? value.beforeAfter : {};
  const beforeAfter = {};
  for (const key of keys || []) {
    if (baPromptComplete(raw[key])) beforeAfter[key] = raw[key];
  }
  return Object.keys(beforeAfter).length ? { beforeAfter } : null;
}

function seedImageQueriesFromNiche(candidateId) {
  const fill = applyStoredNicheImagePrompts(candidateId);
  const payload = {};
  if (Object.keys(fill.slots || {}).length) payload.slots = fill.slots;
  if (Object.keys(fill.beforeAfter || {}).length) payload.beforeAfter = fill.beforeAfter;
  if (!payload.slots && !payload.beforeAfter) return;
  saveImagesPlan(candidateId, payload, { merge: true });
}

async function runImageQueries(candidateId, signal, tick) {
  if (!structureHasPhotosEnabled(candidateId)) return;
  await syncPhotoBlocks(candidateId, tick);
  seedImageQueriesFromNiche(candidateId);
  if (imagesPlanIsComplete(candidateId)) {
    rememberNicheImagePrompts(candidateId);
    return;
  }
  tick('Image queries');

  const missingStock = missingImageQuerySlotKeys(candidateId);
  await runImageQueryGroups({
    keys: missingStock,
    chunkSize: IMAGE_QUERY_SLOT_CHUNK,
    signal,
    tick,
    kind: 'stock',
    buildPrompt: (chunk) =>
      buildImageQueriesPrompt(candidateId, { slotKeys: chunk, baKeys: [] }).prompt,
    callClaudeFn: (opts) => callClaude(candidateId, opts),
    save: (value) => saveImagesPlan(candidateId, value, { merge: true }),
    stillMissing: () => missingImageQuerySlotKeys(candidateId),
  });

  await runImageQueryGroups({
    keys: missingImageQueryBaKeys(candidateId),
    chunkSize: IMAGE_QUERY_BA_CHUNK,
    signal,
    tick,
    kind: 'beforeAfter',
    buildPrompt: (chunk) =>
      buildImageQueriesPrompt(candidateId, { slotKeys: [], baKeys: chunk }).prompt,
    callClaudeFn: (opts) => callClaude(candidateId, opts),
    save: (value) => saveImagesPlan(candidateId, value, { merge: true }),
    stillMissing: () => missingImageQueryBaKeys(candidateId),
  });
  if (imagesPlanIsComplete(candidateId)) rememberNicheImagePrompts(candidateId);
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

  const runOnce = async () => {
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
  };
  await continueWriteSiteOnce(runOnce, { onContinue: () => tick('Continuing…') });
  return {
    ok: true,
    candidate: getCandidateShell(candidateId),
    spentUsd: loadMeta(candidateId)?.lastCosts?.writeSite ?? null,
  };
}
