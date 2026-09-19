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
} from './content-structure.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import {
  cityContextPromptRules,
  compactCityContextForPrompt,
  getCachedCityContext,
} from './city-context.mjs';
import { listImageSlots, structureHasPhotosEnabled } from './fill-site-images.mjs';
import { listBaPromptSlots } from './chatgpt-before-after.mjs';
import { updateLightJobProgress } from './rover-light-jobs.mjs';

const COST_KEY = (candidateId) => ({
  candidateId,
  label: 'writeSite',
  accumulate: true,
});

export const POLISH_EDITOR_ATTEMPTS = 3;
export const EXPAND_LOCATION_ATTEMPTS = 2;
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

export function leftoversFromLint(speechLint, seoLint) {
  const speechN = speechLint?.findings?.length || 0;
  const criticalSeoN = (seoLint?.findings || []).filter((f) => f.severity === 'critical').length;
  const thinLocationN = thinLocationSeoFindings(seoLint).length;
  return { speechN, criticalSeoN, thinLocationN, speechLint, seoLint };
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

export function chunkList(items, size) {
  const list = Array.isArray(items) ? items : [];
  const n = Math.max(1, Number(size) || 1);
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
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
  const result = await refineOutlineFromClaude({
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
  });
  throwIfMissingJson(
    'Outline',
    result,
    {
      shapeOk: outlineJsonShapeOk(result.parsed),
      missing: 'Outline: Claude did not return sections[] JSON',
    },
  );
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

async function runWrite(candidateId, signal, tick) {
  const system = cacheSystemBlob(candidateId);
  const status = getWriteBatchStatus(candidateId);
  const batches = [];
  if (status.needHome && !status.complete.home) batches.push('home');
  if (status.needServices && !status.complete.services) batches.push('services');
  if (status.needLocations && !status.complete.locations) batches.push('locations');

  const writeOne = async (batch, built, label) => {
    tick(label);
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
    const pasted = pasteAgentContentDraft(candidateId, text, { mode: 'full' });
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
  throwIfAborted(signal);
  const { text } = await claudeMessages({
    user: prompt,
    maxTokens: 16384,
    temperature: 0.45,
    signal,
    costKey: costOverride || costKey(candidateId),
  });
  if (!String(text).includes('### FILE:')) {
    throw Object.assign(new Error('Expand locations: Claude did not return FILE blocks'), {
      status: 500,
    });
  }
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
    }
    lint = getContentSpeechLint(candidateId);
    left = leftoversFromLint(lint.speechLint, lint.seoLint);
  }
  if (left.speechN > 0 && polishSpeechShouldBlockWrite({ speechN: left.speechN })) {
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

  if (left.thinLocationN > 0) {
    left = await expandThinLocationsUntilClear(candidateId, { signal, tick });
  }
  if (polishThinLocationsShouldBlockWrite(left)) {
    throw throwThinLocations(left.seoLint);
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

const IMAGE_QUERY_BA_CHUNK = 2;

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

async function runImageQueries(candidateId, signal, tick) {
  if (!structureHasPhotosEnabled(candidateId)) return;
  if (imagesPlanIsComplete(candidateId)) return;
  tick('Image queries');

  const missingStock = missingImageQuerySlotKeys(candidateId);
  if (missingStock.length) {
    tick('Image queries — stock slots');
    const { prompt } = buildImageQueriesPrompt(candidateId, { slotKeys: missingStock, baKeys: [] });
    const { parsed, text, truncated } = await callClaude(candidateId, {
      user: prompt,
      maxTokens: 16384,
      temperature: 0.3,
      signal,
    });
    throwIfMissingJson('Image queries', { parsed, truncated, text });
    saveImagesPlan(candidateId, parsed.value, { merge: true });
  }

  let remainingBa = missingImageQueryBaKeys(candidateId);
  while (remainingBa.length) {
    const chunk = remainingBa.slice(0, IMAGE_QUERY_BA_CHUNK);
    tick(`Image queries — before/after ${chunk.join(', ')}`);
    const { prompt } = buildImageQueriesPrompt(candidateId, { slotKeys: [], baKeys: chunk });
    const { parsed, text, truncated } = await callClaude(candidateId, {
      user: prompt,
      maxTokens: 16384,
      temperature: 0.3,
      signal,
    });
    throwIfMissingJson('Image queries', { parsed, truncated, text });
    saveImagesPlan(candidateId, parsed.value, { merge: true });
    const next = missingImageQueryBaKeys(candidateId);
    if (chunk.every((key) => next.includes(key))) {
      throw Object.assign(new Error('Image queries: before/after chunk did not save. Retry Write site.'), {
        status: 500,
      });
    }
    remainingBa = next;
  }
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
    candidate: getCandidateShell(candidateId),
    spentUsd: loadMeta(candidateId)?.lastCosts?.writeSite ?? null,
  };
}
