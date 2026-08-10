#!/usr/bin/env node
/**
 * Local-only Rover dashboard.
 * Bind: 127.0.0.1:8787 — do not expose publicly.
 *
 *   npm run rover
 *   npm run ops
 */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile, fetchUserBalance } from '../scripts/lib/dataforseo.mjs';
import { listPalettes } from '../scripts/lib/site-palettes.mjs';
import {
  acceptNarrative,
  acceptNarratives,
  buildCopyPrompt,
  createCandidate,
  decisionGroupCounts,
  ensureConfigFromResearch,
  getApprovedPackage,
  getCandidateDetail,
  listCandidates,
  rejectNarrative,
  rejectNarratives,
  setDecision,
  setDecisions,
  pathsFor,
  CANDIDATE_DECISIONS,
} from './lib/candidates.mjs';
import {
  attachGroupIds,
  createGroup,
  deleteGroup,
  listGroups,
  renameGroup,
  updateGroupMembers,
} from './lib/candidate-groups.mjs';
import {
  generateNarrativeDraft,
  generateProspectsOutreachDraft,
  pasteNarrativeDraft,
} from './lib/claude.mjs';
import {
  acceptSiteConfig,
  buildSiteConfigPrompt,
  getSiteConfigDraft,
  pasteSiteConfigDraft,
  setCandidateArchetype,
  applySiteConfigBrand,
  updateSiteConfigDraft,
  listArchetypes,
} from './lib/site-config.mjs';
import {
  acceptContent,
  buildContentPrompt,
  getContentDraft,
  pasteContentDraft,
} from './lib/content-markdown.mjs';
import {
  fillSiteImages,
  getImagesManifest,
  structureHasPhotosEnabled,
} from './lib/fill-site-images.mjs';
import {
  buildResearcherPrompt,
  buildOutlinePrompt,
  buildWriterPrompt,
  buildEditorPrompt,
  buildContentBriefDraft,
  getContentBrief,
  saveContentBrief,
  confirmContentBrief,
  buildOnesHotPrompt,
  pasteContentResearch,
  pasteContentOutline,
  pasteAgentContentDraft,
  importContentDraftFromDisk,
  seedDefaultOutline,
} from './lib/content-agents.mjs';
import {
  applyPreset,
  buildFullWritePrompt,
  buildStructurePrompt,
  composeContentOutline,
  confirmContentOutline,
  getContentOutlinePackage,
  getContentStructure,
  getDefaultStructureSelection,
  listStructureCatalog,
  pasteContentOutlinePackage,
  saveContentStructure,
} from './lib/content-structure.mjs';
import { buildBuildPackage, getBuildPackage } from './lib/build-package.mjs';
import { stageSiteContent, getStagingSummary } from './lib/site-staging.mjs';
import {
  isAssembleStale,
  launchFidelitySummary,
} from './lib/preview-fidelity.mjs';
import { ensureAstroPreview, ASTRO_PREVIEW_URL } from './lib/astro-preview.mjs';
import { ensureAssembledPreview, stopAssembledPreview } from './lib/assembled-preview.mjs';
import { assembleSite, getAssembleChecklist } from './lib/assemble-site.mjs';
import { getLaunchStatus, launchSite } from './lib/launch-site.mjs';
import {
  BILLING_CYCLES,
  createManualSite,
  deleteSite,
  getSite,
  listSites,
  PAYMENT_METHODS,
  SITE_STATUSES,
  updateSite,
  upsertSiteAfterLaunch,
  upsertSiteFromCandidate,
  upsertSitesFromCandidates,
} from './lib/sites.mjs';
import { cloudflareConfigured } from './lib/cloudflare-launch.mjs';
import { buildAssembledSite, getShipStatus, shipAssembledSite } from './lib/ship-site.mjs';
import { ghAuthStatus } from './lib/github-site.mjs';
import { getBatchCostPreview, getCostPreview } from './lib/cost-estimates.mjs';
import {
  getJob,
  listJobsForCandidate,
  runEnrich,
  runProspects,
  runResearch,
  runNarrativeJob,
} from './lib/run-script.mjs';
import {
  createDiscoveryPack,
  discoveryPresets,
  getBatch,
  getBatchGeminiPrompt,
  importDiscoveryCsv,
  listBatches,
  mergeGeminiPaste,
  processDiscoveryBatch,
  recommendBatch,
  updateBatchDecisions,
} from './lib/discovery.mjs';
import { previewSerpProbe, runDiscoverySerpProbe, startDiscoverySerpProbe, getSerpProbeJob, discoveryStepStatus } from './lib/discovery-serp-probe.mjs';
import { aggregateStageFlags, getBatchJob, startBatchJobs } from './lib/batch-jobs.mjs';
import { regenerateKnownCandidates } from './lib/known-candidates.mjs';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { getScoringRubric } from '../scripts/lib/scoring.mjs';

loadEnvFile();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number(process.env.OPS_PORT) || 8787;

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => {
  if (req.path === '/' || /\.(?:html?|js|mjs|css|map|json|svg|png|ico)$/i.test(req.path)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, maxAge: 0 }));

function sendError(res, error) {
  const status = error.status || 400;
  const payload = { error: error.message || String(error) };
  if (error.code) payload.code = error.code;
  if (error.details) payload.details = error.details;
  if (error.suburbCheck) payload.suburbCheck = error.suburbCheck;
  if (error.check) payload.check = error.check;
  res.status(status).json(payload);
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    host: HOST,
    port: PORT,
    hasDataForSeo: Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
    hasAnthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  });
});

app.get('/api/discovery/presets', (_req, res) => {
  try {
    res.json(discoveryPresets());
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/discovery/batches', (_req, res) => {
  try {
    res.json({ batches: listBatches() });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/discovery/batches/:id', (req, res) => {
  try {
    res.json(getBatch(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/discovery/pack', (req, res) => {
  try {
    const body = req.body || {};
    const niches = Array.isArray(body.niches)
      ? body.niches
      : String(body.niches || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
    const cities = Array.isArray(body.cities)
      ? body.cities
      : String(body.cities || '')
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean);
    const categories = Array.isArray(body.categories)
      ? body.categories
      : String(body.categories || '')
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean);
    const pack = createDiscoveryPack({
      state: body.state,
      niches,
      cities,
      categories,
      minPopulation: body.minPopulation,
      maxPopulation: body.maxPopulation,
      maxRows: body.maxRows,
      seasonality: body.seasonality,
      tiers: Array.isArray(body.tiers)
        ? body.tiers
        : String(body.tiers || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
      minTier: body.minTier,
      minJobCost: body.minJobCost,
      mapPackPreference: body.mapPackPreference,
    });
    res.json(pack);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/discovery/import', (req, res) => {
  try {
    const csv = req.body?.csv ?? req.body?.text ?? '';
    const batchId = req.body?.batchId || null;
    const role = req.body?.role === 'gemini' ? 'gemini' : 'claude';
    const result = importDiscoveryCsv(batchId, csv, { createIfMissing: true, role });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/discovery/batches/:id/gemini-merge', (req, res) => {
  try {
    const paste = req.body?.paste ?? req.body?.text ?? req.body?.csv ?? '';
    res.json(mergeGeminiPaste(req.params.id, paste));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/discovery/batches/:id/gemini-prompt', (req, res) => {
  try {
    res.json(getBatchGeminiPrompt(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/discovery/batches/:id/decisions', (req, res) => {
  try {
    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
    res.json(updateBatchDecisions(req.params.id, updates));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/discovery/batches/:id/recommend', (req, res) => {
  try {
    res.json(recommendBatch(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/discovery/batches/:id/serp-probe/preview', (req, res) => {
  try {
    const indices = req.query.indices
      ? String(req.query.indices)
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n))
      : null;
    res.json(previewSerpProbe(req.params.id, { indices }));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/discovery/batches/:id/steps', (req, res) => {
  try {
    const { batch, rows } = getBatch(req.params.id);
    res.json({ steps: discoveryStepStatus(batch, rows), batchId: batch.id });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/discovery/batches/:id/serp-probe', async (req, res) => {
  try {
    const body = req.body || {};
    // Async by default for progress UI; sync=true keeps old blocking behavior
    if (body.sync) {
      const result = await runDiscoverySerpProbe(req.params.id, {
        indices: Array.isArray(body.indices) ? body.indices : null,
        concurrency: Number(body.concurrency) || 1,
      });
      return res.json(result);
    }
    const job = startDiscoverySerpProbe(req.params.id, {
      indices: Array.isArray(body.indices) ? body.indices : null,
      concurrency: Number(body.concurrency) || 1,
    });
    res.status(202).json({
      jobId: job.id,
      batchId: job.batchId,
      status: job.status,
      total: job.total,
      done: job.done,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/discovery/serp-probe-jobs/:jobId', (req, res) => {
  const job = getSerpProbeJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Probe job not found' });
  res.json({
    id: job.id,
    batchId: job.batchId,
    status: job.status,
    total: job.total,
    done: job.done,
    ok: job.ok,
    errors: job.errors,
    mapPackYes: job.mapPackYes,
    mapPackNo: job.mapPackNo,
    flipsToYes: job.flipsToYes,
    flipsToNo: job.flipsToNo,
    costUsd: job.costUsd,
    currentLabel: job.currentLabel,
    error: job.error,
    finishedAt: job.finishedAt,
    probe: job.status === 'running' ? null : job.probe,
    batch: job.status === 'running' ? null : job.batch,
  });
});

app.post('/api/discovery/batches/:id/process', (req, res) => {
  try {
    const body = req.body || {};
    res.json(
      processDiscoveryBatch(req.params.id, {
        runStage1ForPursue: body.runStage1ForPursue !== false,
        decisions: Array.isArray(body.decisions) ? body.decisions : null,
        concurrency: Number(body.concurrency) || 1,
        adsMode: body.adsMode === 'standard' ? 'standard' : 'live',
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/jobs/batch', (req, res) => {
  try {
    const body = req.body || {};
    const act = body.act;
    const candidateIds = Array.isArray(body.candidateIds) ? body.candidateIds : [];
    res.json(
      startBatchJobs({
        act,
        candidateIds,
        concurrency: Number(body.concurrency) || 1,
        adsMode: body.adsMode === 'standard' ? 'standard' : 'live',
        forceSerp: Boolean(body.forceSerp),
        volumesOnly: Boolean(body.volumesOnly),
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/jobs/batches/:id', (req, res) => {
  const batch = getBatchJob(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch job not found' });
  res.json(batch);
});

app.get('/api/dfs-balance', async (_req, res) => {
  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
    return res.json({
      ok: false,
      balance: null,
      error: 'DataForSEO credentials missing',
      fetchedAt: new Date().toISOString(),
    });
  }
  try {
    const data = await fetchUserBalance();
    res.json({ ok: true, ...data, error: null });
  } catch (error) {
    res.json({
      ok: false,
      balance: null,
      error: error.message || String(error),
      fetchedAt: new Date().toISOString(),
    });
  }
});

app.get('/api/candidates/:id/cost-preview', (req, res) => {
  try {
    const act = String(req.query.act || '');
    res.json(getCostPreview(req.params.id, act));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/jobs/batch/cost-preview', (req, res) => {
  try {
    const body = req.body || {};
    const act = String(body.act || '');
    const candidateIds = Array.isArray(body.candidateIds) ? body.candidateIds : [];
    res.json(getBatchCostPreview(candidateIds, act));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/rubric', (_req, res) => {
  try {
    res.json(getScoringRubric());
  } catch (error) {
    // Fallback: read file directly if import shape differs
    try {
      const raw = JSON.parse(
        readFileSync(path.join(process.cwd(), 'scripts/lib/scoring-rubric.json'), 'utf8'),
      );
      res.json(raw);
    } catch (inner) {
      sendError(res, inner);
    }
  }
});

app.get('/api/candidates', (_req, res) => {
  try {
    const candidates = attachGroupIds(listCandidates());
    const groups = listGroups();
    res.json({
      candidates,
      groups,
      decisionCounts: decisionGroupCounts(candidates),
      decisions: CANDIDATE_DECISIONS,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidate-groups', (req, res) => {
  try {
    const group = createGroup(req.body?.name);
    res.status(201).json({ group, groups: listGroups() });
  } catch (error) {
    sendError(res, error);
  }
});

app.patch('/api/candidate-groups/:id', (req, res) => {
  try {
    const group = renameGroup(req.params.id, req.body?.name);
    res.json({ group, groups: listGroups() });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete('/api/candidate-groups/:id', (req, res) => {
  try {
    const group = deleteGroup(req.params.id);
    res.json({ group, groups: listGroups() });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidate-groups/:id/members', (req, res) => {
  try {
    const body = req.body || {};
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const group = updateGroupMembers(req.params.id, ids, body.op || 'add');
    res.json({ group, groups: listGroups() });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/stage-flags', (req, res) => {
  try {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    res.json(aggregateStageFlags(ids));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id', (req, res) => {
  try {
    res.json(getCandidateDetail(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates', (req, res) => {
  try {
    const created = createCandidate(req.body || {});
    const runNow = Boolean(req.body?.runResearch);
    let job = null;
    if (runNow) {
      ensureConfigFromResearch(created.id);
      job = runResearch(created.id, {
        adsMode: req.body?.adsMode === 'standard' ? 'standard' : 'live',
      });
    }
    try {
      regenerateKnownCandidates();
    } catch {
      /* ignore */
    }
    res.status(201).json({ ...created, job });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/decisions', (req, res) => {
  try {
    const body = req.body || {};
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const result = setDecisions(ids, body.decision, body.notes ?? null);
    try {
      regenerateKnownCandidates();
    } catch {
      /* ignore */
    }
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/research', (req, res) => {
  try {
    ensureConfigFromResearch(req.params.id);
    const p = pathsFor(req.params.id);
    if (!existsSync(p.config)) {
      throw Object.assign(new Error('No config — create candidate or add research/{id}.config.json'), {
        status: 400,
      });
    }
    const job = runResearch(req.params.id, {
      adsMode: req.body?.adsMode === 'standard' ? 'standard' : 'live',
      forceSerp: Boolean(req.body?.forceSerp),
      volumesOnly: Boolean(req.body?.volumesOnly),
    });
    res.json({ job });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/enrich', (req, res) => {
  try {
    const p = pathsFor(req.params.id);
    if (!existsSync(p.research)) {
      throw Object.assign(new Error('No research JSON — run Stage 1 first'), { status: 400 });
    }
    const job = runEnrich(req.params.id);
    res.json({ job });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/prospects', (req, res) => {
  try {
    const p = pathsFor(req.params.id);
    if (!existsSync(p.research)) {
      throw Object.assign(new Error('No research JSON — run Stage 1 first'), { status: 400 });
    }
    const job = runProspects(req.params.id);
    res.json({ job });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/jobs/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.get('/api/candidates/:id/jobs', (req, res) => {
  res.json({ jobs: listJobsForCandidate(req.params.id) });
});

app.post('/api/candidates/:id/narrative', async (req, res) => {
  try {
    const result = await generateNarrativeDraft(req.params.id);
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/narrative/paste', (req, res) => {
  try {
    const raw = req.body?.json ?? req.body?.text ?? req.body;
    const result = pasteNarrativeDraft(req.params.id, raw);
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/narrative/accept', (req, res) => {
  try {
    const result = acceptNarrative(req.params.id, {
      allowJobCostOverride: Boolean(req.body?.allowJobCostOverride),
    });
    res.json({
      narrative: result.narrative,
      approved: result.approved,
      candidate: getCandidateDetail(req.params.id),
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/narrative/accept', (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const result = acceptNarratives(ids, {
      allowJobCostOverride: Boolean(req.body?.allowJobCostOverride),
    });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/narrative/reject', (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    res.json(rejectNarratives(ids));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/narrative/reject', (req, res) => {
  try {
    rejectNarrative(req.params.id);
    res.json({ ok: true, candidate: getCandidateDetail(req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/approved', (req, res) => {
  try {
    const pack = getApprovedPackage(req.params.id);
    if (!pack) return res.status(404).json({ error: 'No approved package — Accept narrative first' });
    res.json({ package: pack });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/site-config/prompt', (req, res) => {
  try {
    const nap = {
      domain: req.query.domain,
      businessName: req.query.businessName,
      phone: req.query.phone,
      email: req.query.email,
      radiusMiles: req.query.radiusMiles,
      siteArchetype: req.query.siteArchetype,
      allowNonPursue: req.query.allowNonPursue === '1' || req.query.allowNonPursue === 'true',
    };
    res.json(buildSiteConfigPrompt(req.params.id, nap));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/site-config/draft', (req, res) => {
  try {
    const draft = getSiteConfigDraft(req.params.id);
    if (!draft) return res.status(404).json({ error: 'No site-config draft' });
    res.json({ draft });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/site-config/paste', (req, res) => {
  try {
    const body = req.body || {};
    const raw = body.json ?? body.text ?? body;
    const nap = {
      domain: body.domain,
      businessName: body.businessName,
      phone: body.phone,
      email: body.email,
      radiusMiles: body.radiusMiles,
      siteArchetype: body.siteArchetype,
      allowNonPursue: Boolean(body.allowNonPursue),
    };
    res.json(pasteSiteConfigDraft(req.params.id, raw, nap));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/site-config/draft', (req, res) => {
  try {
    const body = req.body || {};
    const nap = {
      domain: body.domain,
      businessName: body.businessName,
      phone: body.phone,
      email: body.email,
      radiusMiles: body.radiusMiles,
      siteArchetype: body.siteArchetype,
      allowNonPursue: Boolean(body.allowNonPursue),
    };
    const patch = body.patch && typeof body.patch === 'object' ? body.patch : body;
    res.json(updateSiteConfigDraft(req.params.id, patch, nap));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/site-config/accept', (req, res) => {
  try {
    const body = req.body || {};
    res.json(
      acceptSiteConfig(req.params.id, {
        allowNonPursue: Boolean(body.allowNonPursue),
        ignoreSuburbWarnings: Boolean(body.ignoreSuburbWarnings),
        allowPlaceholders: Boolean(body.allowPlaceholders),
      }),
    );
  } catch (error) {
    if (error.suburbCheck || error.placeholders) {
      return res.status(error.status || 400).json({
        error: error.message,
        suburbCheck: error.suburbCheck,
        placeholders: error.placeholders,
      });
    }
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/site-config/brand', (req, res) => {
  try {
    const body = req.body || {};
    const nap = {
      allowNonPursue: Boolean(body.allowNonPursue),
    };
    res.json(applySiteConfigBrand(req.params.id, body.paletteId || body.brand?.paletteId, nap));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/prompt', (req, res) => {
  try {
    res.json(buildContentPrompt(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/draft', (req, res) => {
  try {
    const draft = getContentDraft(req.params.id);
    if (!draft) return res.status(404).json({ error: 'No content draft' });
    res.json({ draft });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/paste', (req, res) => {
  try {
    const body = req.body || {};
    const raw = body.text ?? body.markdown ?? body.json ?? '';
    res.json(pasteContentDraft(req.params.id, typeof raw === 'string' ? raw : String(raw)));
  } catch (error) {
    if (error.check) {
      return res.status(error.status || 400).json({
        error: error.message,
        check: error.check,
      });
    }
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/accept', async (req, res) => {
  try {
    const body = req.body || {};
    const result = acceptContent(req.params.id, {
      ignoreWarnings: Boolean(body.ignoreWarnings),
    });
    let images = null;
    if (structureHasPhotosEnabled(req.params.id)) {
      try {
        images = await fillSiteImages(req.params.id, { replace: false });
      } catch (imageErr) {
        images = {
          ok: false,
          warning: imageErr.message || String(imageErr),
          human: [imageErr.message || String(imageErr)],
          providerStatus: imageErr.providerStatus || null,
        };
      }
    }
    res.json({
      ...result,
      images,
      candidate: getCandidateDetail(req.params.id),
    });
  } catch (error) {
    if (error.check) {
      return res.status(error.status || 400).json({
        error: error.message,
        check: error.check,
      });
    }
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/images', (req, res) => {
  try {
    res.json(getImagesManifest(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/pull', async (req, res) => {
  try {
    const replace = Boolean(req.body?.replace || req.query?.replace);
    const result = await fillSiteImages(req.params.id, { replace });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/archetypes', (_req, res) => {
  res.json({ archetypes: listArchetypes() });
});

app.get('/api/palettes', (_req, res) => {
  res.json({ palettes: listPalettes(), defaultId: 'slate-gold' });
});

app.post('/api/candidates/:id/archetype', (req, res) => {
  try {
    res.json(setCandidateArchetype(req.params.id, req.body?.siteArchetype));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/content/structure/catalog', (_req, res) => {
  try {
    res.json(listStructureCatalog());
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/structure', (req, res) => {
  try {
    const structure = getContentStructure(req.params.id) || {
      ...getDefaultStructureSelection(),
      status: 'empty',
    };
    res.json({
      structure,
      catalog: listStructureCatalog(),
      outline: getContentOutlinePackage(req.params.id),
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/structure', (req, res) => {
  try {
    const body = req.body || {};
    if (body.presetId && body.applyPreset) {
      const selection = applyPreset(body.presetId);
      return res.json(saveContentStructure(req.params.id, selection));
    }
    res.json(saveContentStructure(req.params.id, body));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/structure/compose', (req, res) => {
  try {
    res.json(composeContentOutline(req.params.id, req.body || null));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/structure/prompt', (req, res) => {
  try {
    res.json(buildStructurePrompt(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/structure/outline', (req, res) => {
  try {
    const raw = req.body?.json ?? req.body?.text ?? req.body;
    res.json(pasteContentOutlinePackage(req.params.id, raw));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/structure/confirm', (req, res) => {
  try {
    res.json(confirmContentOutline(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/structure/write-prompt', (req, res) => {
  try {
    res.json(buildFullWritePrompt(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/brief', (req, res) => {
  try {
    const brief = getContentBrief(req.params.id);
    if (!brief) return res.status(404).json({ error: 'No content brief' });
    res.json({ brief });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/brief', (req, res) => {
  try {
    const body = req.body || {};
    if (body.regenerate || body.generate) {
      return res.json(
        buildContentBriefDraft(req.params.id, {
          siteArchetype: body.siteArchetype || null,
        }),
      );
    }
    res.json(saveContentBrief(req.params.id, body));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/brief/confirm', (req, res) => {
  try {
    res.json(confirmContentBrief(req.params.id, req.body || {}));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/oneshot/prompt', (req, res) => {
  try {
    res.json(
      buildOnesHotPrompt(req.params.id, {
        siteArchetype: req.query.siteArchetype || null,
        mode: req.query.mode || 'homepage_first',
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/researcher/prompt', (req, res) => {
  try {
    res.json(
      buildResearcherPrompt(req.params.id, { siteArchetype: req.query.siteArchetype || null }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/researcher/paste', (req, res) => {
  try {
    res.json(pasteContentResearch(req.params.id, req.body?.json ?? req.body?.text ?? req.body));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/outline/prompt', (req, res) => {
  try {
    res.json(buildOutlinePrompt(req.params.id, { siteArchetype: req.query.siteArchetype || null }));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/outline/seed', (req, res) => {
  try {
    res.json(
      seedDefaultOutline(req.params.id, { siteArchetype: req.body?.siteArchetype || null }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/outline/paste', (req, res) => {
  try {
    res.json(pasteContentOutline(req.params.id, req.body?.json ?? req.body?.text ?? req.body));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/writer/prompt', (req, res) => {
  try {
    res.json(
      buildWriterPrompt(req.params.id, {
        siteArchetype: req.query.siteArchetype || null,
        mode: req.query.mode || 'homepage_first',
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/editor/prompt', (req, res) => {
  try {
    res.json(buildEditorPrompt(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/agent-paste', (req, res) => {
  try {
    const body = req.body || {};
    res.json(
      pasteAgentContentDraft(req.params.id, body.text ?? body.markdown ?? '', {
        mode: body.mode || 'homepage_first',
      }),
    );
  } catch (error) {
    if (error.check || error.contract) {
      return res.status(error.status || 400).json({
        error: error.message,
        check: error.check,
        contract: error.contract,
      });
    }
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/import-disk', (req, res) => {
  try {
    const body = req.body || {};
    res.json(
      importContentDraftFromDisk(req.params.id, {
        mode: body.mode || 'homepage_first',
      }),
    );
  } catch (error) {
    if (error.check || error.contract || error.missing) {
      return res.status(error.status || 400).json({
        error: error.message,
        check: error.check,
        contract: error.contract,
        missing: error.missing,
      });
    }
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/build-package', (req, res) => {
  try {
    res.json(
      buildBuildPackage(req.params.id, { siteArchetype: req.body?.siteArchetype || null }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/build-package', (req, res) => {
  try {
    const pack = getBuildPackage(req.params.id);
    if (!pack) return res.status(404).json({ error: 'No build package' });
    res.json({ package: pack });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/preview/ensure', async (_req, res) => {
  try {
    const preview = await ensureAstroPreview();
    res.json(preview);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/staging', async (req, res) => {
  try {
    const staged = stageSiteContent(req.params.id, {
      mode: req.body?.mode || 'full',
      refreshPackage: req.body?.refreshPackage !== false,
    });
    const openPreview = req.body?.openPreview !== false;
    let preview = {
      ok: false,
      url: ASTRO_PREVIEW_URL,
      started: false,
      skipped: !openPreview,
    };
    if (openPreview) {
      preview = await ensureAstroPreview();
    }
    res.json({
      ...staged,
      previewUrl: preview.url,
      preview,
    });
  } catch (error) {
    if (error.contract || error.check) {
      return res.status(error.status || 400).json({
        error: error.message,
        contract: error.contract,
        check: error.check,
      });
    }
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/staging', (req, res) => {
  try {
    const summary = getStagingSummary(req.params.id);
    if (!summary) return res.status(404).json({ error: 'No staging' });
    res.json({ staging: summary });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/launch-fidelity', (req, res) => {
  try {
    const detail = getCandidateDetail(req.params.id);
    const config = detail.siteConfig || {};
    const fidelity = launchFidelitySummary(req.params.id, detail, config);
    res.json({
      ...fidelity,
      assembleStale: isAssembleStale(detail.meta || {}),
      lastSiteStagingAt: detail.meta?.lastSiteStagingAt || null,
      lastAssembleAt: detail.meta?.lastAssembleAt || null,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/assemble/checklist', (req, res) => {
  try {
    res.json(getAssembleChecklist(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/assemble', async (req, res) => {
  try {
    const force = Boolean(req.body?.force);
    const skipGit = Boolean(req.body?.skipGit);
    const siteSlug = req.body?.siteSlug ? String(req.body.siteSlug) : undefined;
    const doBuild = req.body?.build !== false;
    const wantShip = req.body?.ship !== false;
    // Release :4322 lock before force-replacing the assembled folder (Windows EPERM).
    await stopAssembledPreview();
    const result = assembleSite(req.params.id, { force, skipGit, siteSlug });

    let build = null;
    if (doBuild && result.absoluteSiteRoot) {
      try {
        build = buildAssembledSite(result.absoluteSiteRoot);
      } catch (error) {
        build = { ok: false, error: error.message };
      }
    }

    let ship = null;
    const canShip = Boolean(ghAuthStatus()) && cloudflareConfigured();
    if (wantShip && canShip && build?.ok && result.absoluteSiteRoot) {
      try {
        ship = await shipAssembledSite(req.params.id, {
          skipBuild: Boolean(build?.ok),
        });
      } catch (error) {
        ship = {
          ok: false,
          error: error.message,
          ...(error.ship || {}),
        };
      }
    } else if (wantShip && !canShip) {
      ship = {
        skipped: true,
        reason: 'Set gh auth login + CLOUDFLARE_* (and GITHUB_OWNER) to auto-ship after assemble',
      };
    }

    res.json({
      ...result,
      build,
      ship,
      candidate: getCandidateDetail(req.params.id),
    });
  } catch (error) {
    if (error.checklist) {
      return res.status(error.status || 500).json({
        error: error.message,
        checklist: error.checklist,
        siteRoot: error.siteRoot || null,
      });
    }
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/assembled/preview', async (req, res) => {
  try {
    const detail = getCandidateDetail(req.params.id);
    const rel = detail.meta?.assembledSitePath;
    if (!rel) {
      return res.status(400).json({ error: 'Assemble the site first' });
    }
    const abs = path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);
    const rebuild = Boolean(req.body?.rebuild);
    const forceRebind = req.body?.forceRebind !== false; // default true — never leave :4322 on another site
    const preview = await ensureAssembledPreview(abs, { rebuild, forceRebind });
    res.json({
      ...preview,
      assembledSitePath: abs,
      kind: 'assembled',
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/launch', (req, res) => {
  try {
    res.json(getLaunchStatus(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/launch', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await launchSite(req.params.id, {
      domain: body.domain,
      phone: body.phone,
      email: body.email,
      businessName: body.businessName,
      web3FormsAccessKey: body.web3FormsAccessKey,
      turnstileSiteKey: body.turnstileSiteKey,
      destinationEmail: body.destinationEmail,
      runCloudflare: body.runCloudflare !== false,
      ship: body.ship !== false,
      skipGithub: Boolean(body.skipGithub),
      skipBuild: Boolean(body.skipBuild),
      skipDeploy: Boolean(body.skipDeploy),
      createTurnstile: Boolean(body.createTurnstile),
      attachDomain: body.attachDomain !== false,
      setupEmail: body.setupEmail !== false,
      markCloudflareProjectDone: Boolean(body.markCloudflareProjectDone),
    });
    const site = result.site || upsertSiteAfterLaunch(req.params.id);
    res.json({
      ...result,
      site,
      candidate: getCandidateDetail(req.params.id),
      cloudflareConfigured: cloudflareConfigured(),
    });
  } catch (error) {
    if (error.checklist) {
      return res.status(error.status || 500).json({
        error: error.message,
        checklist: error.checklist,
      });
    }
    sendError(res, error);
  }
});

app.get('/api/sites', (_req, res) => {
  try {
    res.json({
      sites: listSites(),
      statuses: SITE_STATUSES,
      paymentMethods: PAYMENT_METHODS,
      billingCycles: BILLING_CYCLES,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/sites', (req, res) => {
  try {
    const body = req.body || {};
    if (Array.isArray(body.candidateIds)) {
      const result = upsertSitesFromCandidates(body.candidateIds);
      return res.json(result);
    }
    const site = body.candidateId
      ? upsertSiteFromCandidate({ candidateId: body.candidateId, status: body.status })
      : createManualSite(body);
    res.json({ site });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/sites/:id', (req, res) => {
  try {
    res.json({ site: getSite(req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.patch('/api/sites/:id', (req, res) => {
  try {
    res.json({ site: updateSite(req.params.id, req.body || {}) });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete('/api/sites/:id', (req, res) => {
  try {
    res.json(deleteSite(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/ship', (req, res) => {
  try {
    res.json(getShipStatus(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/ship', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await shipAssembledSite(req.params.id, {
      skipGithub: Boolean(body.skipGithub),
      skipBuild: Boolean(body.skipBuild),
      skipDeploy: Boolean(body.skipDeploy),
      skipBuildsConnect: Boolean(body.skipBuildsConnect),
    });
    res.json(result);
  } catch (error) {
    if (error.ship) {
      return res.status(error.status || 500).json({
        error: error.message,
        ship: error.ship,
      });
    }
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/copy-prompt', (req, res) => {
  try {
    res.json({ prompt: buildCopyPrompt(req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/decision', (req, res) => {
  try {
    const meta = setDecision(req.params.id, req.body?.decision, req.body?.notes ?? null);
    res.json({ meta, candidate: getCandidateDetail(req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/prospects-outreach', async (req, res) => {
  try {
    const result = await generateProspectsOutreachDraft(req.params.id);
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Unmatched API routes — JSON (not Express HTML "Cannot POST …")
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: `Not found: ${req.method} ${req.path}`,
    });
  }
  res.status(404).send('Not found');
});

app.listen(PORT, HOST, () => {
  console.log(`Rover dashboard: http://${HOST}:${PORT}`);
  console.log('Local only — do not expose this port publicly.');
  console.log(
    `DataForSEO: ${process.env.DATAFORSEO_LOGIN ? 'configured' : 'missing'} · Anthropic: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'missing'}`,
  );
});
