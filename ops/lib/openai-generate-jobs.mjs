/**
 * Enqueue OpenAI photo / before-after generate as light jobs (202).
 * Server-side caps: openaiPhotos / openaiBeforeAfter across all candidates and tabs.
 */
import { openaiImageKeySet } from './image-providers/openai-image.mjs';
import { cpuPoolIsStubbed, runCpuTask } from './rover-cpu-pool.mjs';
import {
  enqueueLightJob,
  findActiveOpenaiJob,
} from './rover-light-jobs.mjs';

export function photoGroupJobCandidateId(groupId) {
  return `photo-group:${String(groupId || '').trim()}`;
}

function openaiUnconfiguredError() {
  return Object.assign(
    new Error('Set OPENAI_API_KEY in .env (same key as Phone), then restart Rover.'),
    { status: 400, code: 'openai-unconfigured' },
  );
}

function requireOpenaiKey() {
  if (cpuPoolIsStubbed()) return;
  if (!openaiImageKeySet()) throw openaiUnconfiguredError();
}

function conflictError(existing, message) {
  return Object.assign(new Error(message), {
    status: 409,
    code: 'OPENAI_SLOT_RUNNING',
    jobId: existing.id,
    candidateId: existing.candidateId,
    slotKey: existing.slotKey || null,
    matchKey: existing.matchKey || null,
  });
}

function parseBaItem(raw, extra = {}) {
  if (raw && typeof raw === 'object') {
    const matchKey = String(raw.matchKey || raw.id || '').trim();
    const serviceSlug = String(raw.serviceSlug || extra.serviceSlug || '').trim();
    const pairIndex = Number(raw.pairIndex || extra.pairIndex || 1) || 1;
    return {
      matchKey: matchKey || (serviceSlug ? `ba:svc:${serviceSlug}` : `ba:${pairIndex}`),
      serviceSlug,
      pairIndex,
      viewpoint: raw.viewpoint || extra.viewpoint,
      occupancy: raw.occupancy || extra.occupancy,
      before: raw.before,
      after: raw.after,
    };
  }
  const id = String(raw || '').trim();
  const body = id.replace(/^ba:/, '');
  if (body.startsWith('svc:')) {
    const serviceSlug = body.slice(4);
    return {
      matchKey: id.startsWith('ba:') ? id : `ba:${body}`,
      serviceSlug,
      pairIndex: 1,
      viewpoint: extra.viewpoint,
      occupancy: extra.occupancy,
      before: extra.before,
      after: extra.after,
    };
  }
  const parts = body.split(':');
  const pairIndex = Number(parts[parts.length - 1]) || 1;
  return {
    matchKey: id.startsWith('ba:') ? id : `ba:${body}`,
    serviceSlug: '',
    pairIndex,
    viewpoint: extra.viewpoint,
    occupancy: extra.occupancy,
    before: extra.before,
    after: extra.after,
  };
}

function enqueueOrReuse({
  candidateId,
  phase,
  label,
  slotKey,
  matchKey,
  kind,
  run,
  onConflict,
}) {
  const existing = findActiveOpenaiJob({ candidateId, phase, slotKey, matchKey });
  if (existing) {
    if (onConflict === 'throw') {
      throw conflictError(existing, `${label} is already running`);
    }
    return {
      jobId: existing.id,
      slotKey: existing.slotKey || slotKey || null,
      matchKey: existing.matchKey || matchKey || null,
      kind: existing.kind || kind,
      reused: true,
      status: existing.status,
    };
  }
  const { jobId } = enqueueLightJob({
    candidateId,
    phase,
    label,
    slotKey,
    matchKey,
    kind,
    progressTotal: 1,
    run,
  });
  return { jobId, slotKey: slotKey || null, matchKey: matchKey || null, kind, reused: false };
}

/**
 * @param {string} candidateId
 * @param {{
 *   slotKeys?: string[],
 *   baKeys?: unknown[],
 *   baItems?: unknown[],
 *   viewpoint?: string,
 *   occupancy?: string,
 *   prompt?: string,
 *   prompts?: Record<string, { viewpoint?: string, occupancy?: string, prompt?: string, before?: string, after?: string }>,
 *   onConflict?: 'reuse' | 'throw',
 * }} body
 */
export function enqueueCandidateOpenaiJobs(candidateId, body = {}) {
  requireOpenaiKey();
  const cid = String(candidateId || '').trim();
  if (!cid) throw Object.assign(new Error('candidateId required'), { status: 400 });
  const onConflict = body.onConflict === 'throw' ? 'throw' : 'reuse';
  const viewpoint = body.viewpoint || 'inside';
  const occupancy = body.occupancy || 'none';
  const prompts = body.prompts && typeof body.prompts === 'object' ? body.prompts : {};
  const slotKeys = [...new Set((Array.isArray(body.slotKeys) ? body.slotKeys : []).map((k) => String(k || '').trim()).filter(Boolean))];
  const baRaw = Array.isArray(body.baItems) && body.baItems.length ? body.baItems : body.baKeys || [];
  const jobs = [];

  for (const slotKey of slotKeys) {
    const card = prompts[slotKey] || {};
    jobs.push(
      enqueueOrReuse({
        candidateId: cid,
        phase: 'openai-photo',
        label: `OpenAI ${slotKey}`,
        slotKey,
        matchKey: slotKey,
        kind: 'photo',
        onConflict,
        run: ({ signal, jobId }) =>
          runCpuTask(
            {
              kind: 'candidate-slot',
              candidateId: cid,
              slotKey,
              opts: {
                viewpoint: card.viewpoint || viewpoint,
                occupancy: card.occupancy || occupancy,
                prompt: card.prompt != null ? card.prompt : body.prompt,
              },
            },
            { signal, jobId },
          ),
      }),
    );
  }

  for (const raw of baRaw) {
    const item = parseBaItem(raw, {
      viewpoint,
      occupancy,
      before: body.before,
      after: body.after,
    });
    const card = prompts[item.matchKey] || prompts[String(raw)] || {};
    jobs.push(
      enqueueOrReuse({
        candidateId: cid,
        phase: 'openai-ba',
        label: `OpenAI pair ${item.matchKey}`,
        slotKey: item.matchKey,
        matchKey: item.matchKey,
        kind: 'pair',
        onConflict,
        run: ({ signal, jobId }) =>
          runCpuTask(
            {
              kind: 'candidate-ba',
              candidateId: cid,
              opts: {
                viewpoint: card.viewpoint || item.viewpoint || viewpoint,
                occupancy: card.occupancy || item.occupancy || occupancy,
                serviceSlug: item.serviceSlug,
                pairIndex: item.pairIndex,
                before: card.before != null ? card.before : item.before,
                after: card.after != null ? card.after : item.after,
              },
            },
            { signal, jobId },
          ),
      }),
    );
  }

  if (!jobs.length) {
    throw Object.assign(new Error('No OpenAI slots to generate'), { status: 400 });
  }
  return { accepted: true, jobs };
}

/**
 * @param {string} groupId
 * @param {{
 *   slotKeys?: string[],
 *   baKeys?: unknown[],
 *   baItems?: unknown[],
 *   matchKey?: string,
 *   viewpoint?: string,
 *   occupancy?: string,
 *   prompt?: string,
 *   prompts?: Record<string, object>,
 *   onConflict?: 'reuse' | 'throw',
 *   kind?: string,
 *   pairIndex?: number,
 *   serviceSlug?: string,
 *   serviceName?: string,
 *   before?: string,
 *   after?: string,
 * }} body
 */
export function enqueuePhotoGroupOpenaiJobs(groupId, body = {}) {
  requireOpenaiKey();
  const gid = String(groupId || '').trim();
  if (!gid) throw Object.assign(new Error('groupId required'), { status: 400 });
  const candidateId = photoGroupJobCandidateId(gid);
  const onConflict = body.onConflict === 'throw' ? 'throw' : 'reuse';
  const viewpoint = body.viewpoint || 'inside';
  const occupancy = body.occupancy || 'none';
  const prompts = body.prompts && typeof body.prompts === 'object' ? body.prompts : {};
  let slotKeys = [...new Set((Array.isArray(body.slotKeys) ? body.slotKeys : []).map((k) => String(k || '').trim()).filter(Boolean))];
  if (!slotKeys.length && body.matchKey && body.kind !== 'pair' && !String(body.matchKey).startsWith('ba:')) {
    slotKeys = [String(body.matchKey).trim()];
  }
  let baRaw = Array.isArray(body.baItems) && body.baItems.length ? body.baItems : body.baKeys || [];
  if (!baRaw.length && (body.kind === 'pair' || String(body.matchKey || '').startsWith('ba:'))) {
    baRaw = [
      {
        matchKey: body.matchKey,
        serviceSlug: body.serviceSlug,
        pairIndex: body.pairIndex,
        viewpoint,
        occupancy,
        before: body.before,
        after: body.after,
      },
    ];
  }
  const jobs = [];

  for (const matchKey of slotKeys) {
    const card = prompts[matchKey] || {};
    jobs.push(
      enqueueOrReuse({
        candidateId,
        phase: 'openai-photo',
        label: `OpenAI ${matchKey}`,
        slotKey: matchKey,
        matchKey,
        kind: 'photo',
        onConflict,
        run: ({ signal, jobId }) =>
          runCpuTask(
            {
              kind: 'photo-group-slot',
              groupId: gid,
              opts: {
                matchKey,
                viewpoint: card.viewpoint || viewpoint,
                occupancy: card.occupancy || occupancy,
                prompt: card.prompt != null ? card.prompt : body.prompt,
              },
            },
            { signal, jobId },
          ),
      }),
    );
  }

  for (const raw of baRaw) {
    const item = parseBaItem(raw, {
      viewpoint,
      occupancy,
      before: body.before,
      after: body.after,
      serviceSlug: body.serviceSlug,
      pairIndex: body.pairIndex,
    });
    const card = prompts[item.matchKey] || {};
    jobs.push(
      enqueueOrReuse({
        candidateId,
        phase: 'openai-ba',
        label: `OpenAI pair ${item.matchKey}`,
        slotKey: item.matchKey,
        matchKey: item.matchKey,
        kind: 'pair',
        onConflict,
        run: ({ signal, jobId }) =>
          runCpuTask(
            {
              kind: 'photo-group-ba',
              groupId: gid,
              opts: {
                matchKey: item.matchKey,
                viewpoint: card.viewpoint || item.viewpoint || viewpoint,
                occupancy: card.occupancy || item.occupancy || occupancy,
                kind: 'pair',
                pairIndex: item.pairIndex,
                serviceSlug: item.serviceSlug || body.serviceSlug,
                serviceName: body.serviceName,
                before: card.before != null ? card.before : item.before,
                after: card.after != null ? card.after : item.after,
              },
            },
            { signal, jobId },
          ),
      }),
    );
  }

  if (!jobs.length) {
    throw Object.assign(new Error('No OpenAI slots to generate'), { status: 400 });
  }
  return { accepted: true, jobs, groupId: gid };
}
