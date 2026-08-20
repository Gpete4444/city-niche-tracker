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
import { listFontThemes } from '../scripts/lib/site-fonts.mjs';
import {
  acceptNarrative,
  acceptNarratives,
  buildCopyPrompt,
  buildOutreachCopyPrompt,
  createCandidate,
  decisionGroupCounts,
  ensureConfigFromResearch,
  getApprovedPackage,
  getCandidateDetail,
  listCandidates,
  rejectNarrative,
  rejectNarratives,
  saveMeta,
  setDecision,
  setDecisions,
  setArchived,
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
  acceptServiceArea,
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
  seedTargetSuburbLocationStubs,
} from './lib/content-markdown.mjs';
import {
  fillSiteImages,
  getImagesManifest,
  structureHasPhotosEnabled,
  listImageSlotStatus,
  repullImageSlot,
  uploadImageSlot,
  readSiteImageFile,
} from './lib/fill-site-images.mjs';
import { generateSiteLogo } from './lib/generate-site-logo.mjs';
import { generateCoverageMapForCandidate } from './lib/generate-coverage-map.mjs';
import {
  buildBeforeAfterPrompts,
  importBeforeAfterPair,
  listBeforeAfterStatus,
} from './lib/chatgpt-before-after.mjs';
import {
  buildResearcherPrompt,
  buildOutlinePrompt,
  buildWriterPrompt,
  buildEditorPrompt,
  getContentSpeechLint,
  getContentSeoLint,
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
  buildContinueWritePrompt,
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
import { ensureAssembledPreview, stopAssembledPreview, contentNewerThanDist } from './lib/assembled-preview.mjs';
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
  setSitePhoneTracking,
  listSitesWithPhone,
  upsertSiteAfterLaunch,
  upsertSiteFromCandidate,
  upsertSitesFromCandidates,
} from './lib/sites.mjs';
import {
  provisionRankingNumber,
  setForwardToRenter,
  updateForwardTarget,
} from './lib/phone-tracking-twilio.mjs';
import {
  assertPhoneWebhookSecret,
  enqueueSummarizePhoneCall,
  getPhoneCall,
  getRecordingStream,
  handleDialStatusWebhook,
  handleRecordingWebhook,
  listPhoneCalls,
  phoneCallStats,
  summarizePhoneCall,
  syncCallsFromTwilio,
} from './lib/phone-calls.mjs';
import { cloudflareConfigured } from './lib/cloudflare-launch.mjs';
import { buildAssembledSite, getShipStatus, getAssembledShipDiff, shipAssembledSite } from './lib/ship-site.mjs';
import { ghAuthStatus } from './lib/github-site.mjs';
import {
  applyVisualEditPatches,
  beginVisualEditSession,
  getVisualEditSnapshot,
  publishVisualEdit,
  refreshVisualEditPreview,
  restoreVisualEditUndo,
  uploadVisualEditImage,
} from './lib/visual-edit.mjs';
import { findPlaceFeature, getMapGeojson, getMapStatus } from './lib/research-map.mjs';
import { placesIntersectingRadius } from './lib/geo-neighbors.mjs';
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
  importDiscoveryCsv,
  listBatches,
  processDiscoveryBatch,
  recommendBatch,
  reopenDiscoveryRows,
  updateBatchDecisions,
} from './lib/discovery.mjs';
import { previewSerpProbe, runDiscoverySerpProbe, startDiscoverySerpProbe, getSerpProbeJob, discoveryStepStatus } from './lib/discovery-serp-probe.mjs';
import { suggestPlaces } from './lib/census.mjs';
import { aggregateStageFlags, getBatchJob, startBatchJobs } from './lib/batch-jobs.mjs';
import { regenerateKnownCandidates } from './lib/known-candidates.mjs';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { getScoringRubric } from '../scripts/lib/scoring.mjs';

loadEnvFile();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number(process.env.OPS_PORT) || 8787;

const app = express();
app.use(express.json({ limit: '16mb' }));
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
  if (error.speechLint) payload.speechLint = error.speechLint;
  if (error.seoLint) payload.seoLint = error.seoLint;
  res.status(status).json(payload);
}

app.get('/api/health', (_req, res) => {
  const envSet = (...keys) => keys.every((k) => Boolean(String(process.env[k] || '').trim()));
  const checks = [
    { name: 'DataForSEO', ok: envSet('DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD') },
    { name: 'Anthropic', ok: envSet('ANTHROPIC_API_KEY') },
    { name: 'OpenAI', ok: envSet('OPENAI_API_KEY') },
    {
      name: 'Twilio',
      ok: envSet(
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_FORWARD_TO',
        'TWILIO_VOICE_WEBHOOK_URL',
      ),
    },
    { name: 'Cloudflare', ok: envSet('CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN') },
    { name: 'Web3Forms email', ok: envSet('WEB3FORMS_DEFAULT_NOTIFY_EMAIL') },
    { name: 'Unsplash', ok: envSet('UNSPLASH_ACCESS_KEY') },
    { name: 'Pexels', ok: envSet('PEXELS_API_KEY') },
    { name: 'GitHub owner', ok: envSet('GITHUB_OWNER') },
    { name: 'Template repo', ok: envSet('TEMPLATE_GITHUB_REPO') },
    { name: 'Assembled sites dir', ok: envSet('ASSEMBLED_SITES_DIR') },
  ];
  const missing = checks.filter((c) => !c.ok).map((c) => c.name);
  const total = checks.length;
  const okCount = total - missing.length;
  res.json({
    ok: true,
    host: HOST,
    port: PORT,
    connections: {
      total,
      ok: okCount,
      missing,
      items: checks.map((c) => ({ name: c.name, ok: c.ok })),
    },
  });
});

app.get('/api/map/status', (_req, res) => {
  try {
    res.json(getMapStatus());
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/map/geojson', (req, res) => {
  try {
    const layer = String(req.query.layer || 'places');
    const minPop = req.query.minPop != null ? Number(req.query.minPop) : undefined;
    const maxPop = req.query.maxPop != null ? Number(req.query.maxPop) : undefined;
    const state = req.query.state ? String(req.query.state) : '';
    res.json(getMapGeojson({ layer, minPop, maxPop, state }));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/map/place', (req, res) => {
  try {
    const city = String(req.query.city || '').trim();
    const state = String(req.query.state || '').trim();
    const feature = findPlaceFeature(city, state);
    if (!feature) {
      return res.status(404).json({ error: `No place match for ${city}, ${state}` });
    }
    res.json({ feature });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/map/coverage-preview', (req, res) => {
  try {
    const city = String(req.query.city || '').trim();
    const state = String(req.query.state || '').trim();
    const radiusMiles = Number(req.query.radiusMiles ?? 40);
    const minPop = req.query.minPop != null ? Number(req.query.minPop) : 5000;
    const maxPopRaw = req.query.maxPop != null ? Number(req.query.maxPop) : null;
    if (!city || !state) {
      return res.status(400).json({ error: 'city and state required' });
    }
    const preview = placesIntersectingRadius(city, state, radiusMiles, {
      minPop: Number.isFinite(minPop) ? minPop : 5000,
      maxPop: Number.isFinite(maxPopRaw) ? maxPopRaw : null,
    });
    res.json({
      type: 'FeatureCollection',
      features: preview.features,
      primary: preview.primary,
      places: preview.places,
      radiusMiles: preview.radiusMiles,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/site-config/service-area', async (req, res) => {
  try {
    const body = req.body || {};
    const result = acceptServiceArea(req.params.id, {
      radiusMiles: body.radiusMiles,
      selectedCities: body.selectedCities,
      claudeOrder: body.claudeOrder,
      locationPageCities: body.locationPageCities,
    });
    let locationStubs = null;
    try {
      locationStubs = seedTargetSuburbLocationStubs(result.config);
    } catch (e) {
      locationStubs = { error: e.message || String(e) };
    }
    let coverageMap = null;
    try {
      coverageMap = await generateCoverageMapForCandidate(req.params.id);
    } catch (e) {
      coverageMap = { error: e.message || String(e) };
    }
    res.json({ ...result, locationStubs, coverageMap });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/discovery/presets', (_req, res) => {
  try {
    res.json(discoveryPresets());
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/discovery/places', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const state = String(req.query.state || '').trim();
    const limit = Number(req.query.limit) || 20;
    res.json(suggestPlaces({ q, state, limit }));
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
    const requiredNiches = Array.isArray(body.requiredNiches)
      ? body.requiredNiches
      : String(body.requiredNiches || '')
          .split(/[\n;]+/)
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
      requiredNiches,
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
    const result = importDiscoveryCsv(batchId, csv, { createIfMissing: true });
    res.json(result);
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

app.post('/api/discovery/batches/:id/reopen', (req, res) => {
  try {
    const indices = Array.isArray(req.body?.indices) ? req.body.indices : [];
    res.json(reopenDiscoveryRows(req.params.id, indices));
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
    const archivedCount = candidates.filter((c) => c.archived).length;
    res.json({
      candidates,
      groups,
      decisionCounts: decisionGroupCounts(candidates),
      decisions: CANDIDATE_DECISIONS,
      archivedCount,
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

app.post('/api/candidates/archive', (req, res) => {
  try {
    const body = req.body || {};
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const archived = body.archived !== false && body.archived !== 'false';
    const result = setArchived(ids, archived);
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
      paletteId: req.query.paletteId,
      fontTheme: req.query.fontTheme,
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
      fontTheme: body.fontTheme || body.brand?.fontTheme || '',
      paletteId: body.paletteId || body.brand?.paletteId || '',
    };
    res.json(
      applySiteConfigBrand(req.params.id, body.paletteId || body.brand?.paletteId || nap.paletteId, nap),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/font-themes', (_req, res) => {
  res.json({ themes: listFontThemes(), defaultId: 'archivo-source' });
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
    const result = await acceptContent(req.params.id, {
      ignoreWarnings: Boolean(body.ignoreWarnings),
      ignoreSeoWarnings: Boolean(body.ignoreSeoWarnings),
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
    let logo = null;
    try {
      logo = generateSiteLogo(req.params.id);
    } catch (logoErr) {
      logo = {
        ok: false,
        warning: logoErr.message || String(logoErr),
      };
    }
    let coverageMap = null;
    try {
      coverageMap = await generateCoverageMapForCandidate(req.params.id);
    } catch (mapErr) {
      coverageMap = {
        ok: false,
        skipped: /no coverage areas|suburbs/i.test(String(mapErr.message || '')),
        warning: mapErr.message || String(mapErr),
      };
    }
    const assetNotes = [];
    if (logo?.ok !== false && logo?.path) assetNotes.push(`Logo: ${logo.path}`);
    else if (logo?.warning) assetNotes.push(`Logo skipped: ${logo.warning}`);
    if (coverageMap?.ok && coverageMap?.path) {
      assetNotes.push(`Coverage map: ${coverageMap.path}`);
    } else if (coverageMap?.skipped) {
      assetNotes.push('Coverage map skipped (no Areas / suburbs yet)');
    } else if (coverageMap?.warning) {
      assetNotes.push(`Coverage map skipped: ${coverageMap.warning}`);
    }
    if (images && Array.isArray(images.human) && assetNotes.length) {
      images = { ...images, human: [...images.human, ...assetNotes] };
    } else if (!images && assetNotes.length) {
      images = { ok: true, human: assetNotes };
    }
    res.json({
      ...result,
      images,
      logo,
      coverageMap,
      candidate: getCandidateDetail(req.params.id),
    });
  } catch (error) {
    if (error.check || error.seoLint) {
      return res.status(error.status || 400).json({
        error: error.message,
        check: error.check,
        seoLint: error.seoLint,
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

app.get('/api/candidates/:id/images/slots', (req, res) => {
  try {
    res.json(listImageSlotStatus(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/images/file/:filename', (req, res) => {
  try {
    const { abs, filename } = readSiteImageFile(req.params.id, req.params.filename);
    const ext = path.extname(filename).toLowerCase();
    const type =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : ext === '.svg'
              ? 'image/svg+xml'
              : 'image/jpeg';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(abs);
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

app.post('/api/candidates/:id/images/slots/:slotKey/repull', async (req, res) => {
  try {
    const result = await repullImageSlot(req.params.id, req.params.slotKey);
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/slots/:slotKey/upload', (req, res) => {
  try {
    const result = uploadImageSlot(req.params.id, req.params.slotKey, req.body || {});
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/logo/generate', (req, res) => {
  try {
    res.json(generateSiteLogo(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/coverage-map/generate', async (req, res) => {
  try {
    const result = await generateCoverageMapForCandidate(req.params.id);
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/images/before-after-prompts', (req, res) => {
  try {
    res.json(
      buildBeforeAfterPrompts(req.params.id, {
        serviceSlug: req.query?.service || req.query?.serviceSlug || '',
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/images/before-after-status', (req, res) => {
  try {
    res.json(listBeforeAfterStatus(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/before-after-import', (req, res) => {
  try {
    res.json(importBeforeAfterPair(req.params.id, req.body || {}));
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

app.get('/api/candidates/:id/content/structure/prompt', async (req, res) => {
  try {
    res.json(await buildStructurePrompt(req.params.id));
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

app.post('/api/candidates/:id/content/structure/confirm', async (req, res) => {
  try {
    res.json(await confirmContentOutline(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/structure/write-prompt', async (req, res) => {
  try {
    res.json(await buildFullWritePrompt(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/structure/continue-prompt', async (req, res) => {
  try {
    res.json(await buildContinueWritePrompt(req.params.id));
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

app.get('/api/candidates/:id/content/speech-lint', (req, res) => {
  try {
    res.json(getContentSpeechLint(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/seo-lint', (req, res) => {
  try {
    res.json(getContentSeoLint(req.params.id));
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
        mode: body.mode || undefined,
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
    const refresh = Boolean(req.body?.refresh);
    const skipGit = Boolean(req.body?.skipGit);
    const siteSlug = req.body?.siteSlug ? String(req.body.siteSlug) : undefined;
    const doBuild = req.body?.build !== false;
    const wantShip = req.body?.ship !== false;
    // Release :4322 lock before replacing/refreshing the assembled folder (Windows EPERM).
    await stopAssembledPreview();
    const result = assembleSite(req.params.id, { force, refresh, skipGit, siteSlug });

    let build = null;
    if (doBuild && result.absoluteSiteRoot) {
      const needsBuild =
        result.mode === 'full' ||
        contentNewerThanDist(result.absoluteSiteRoot, { ignoreAssembleMeta: true });
      if (!needsBuild) {
        build = {
          ok: true,
          built: true,
          buildSkipped: true,
          npmInstallSkipped: true,
          ms: 0,
          siteRoot: result.absoluteSiteRoot,
        };
      } else {
        try {
          build = buildAssembledSite(result.absoluteSiteRoot);
        } catch (error) {
          build = { ok: false, error: error.message, buildSkipped: false };
        }
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

app.get('/api/candidates/:id/visual-edit', (req, res) => {
  try {
    if (req.query.begin !== '0') beginVisualEditSession(req.params.id);
    res.json(getVisualEditSnapshot(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/visual-edit', (req, res) => {
  try {
    res.json(applyVisualEditPatches(req.params.id, req.body?.patches || []));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/visual-edit/image', (req, res) => {
  try {
    res.json(uploadVisualEditImage(req.params.id, req.body || {}));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/visual-edit/preview', async (req, res) => {
  try {
    const result = await refreshVisualEditPreview(req.params.id, {
      rebuild: req.body?.rebuild !== false,
    });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/visual-edit/publish', async (req, res) => {
  try {
    const result = await publishVisualEdit(req.params.id, {
      ignoreSeoWarnings: Boolean(req.body?.ignoreSeoWarnings),
      ship: req.body?.ship !== false,
    });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/visual-edit/undo', (req, res) => {
  try {
    res.json(restoreVisualEditUndo(req.params.id));
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

/**
 * Phase A: buy Twilio local DID, attach voice webhook, patch site-config.phone.
 * Body: { confirm: true, areaCode?: "801", force?: false }
 */
app.post('/api/sites/:id/phone/provision-twilio', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.confirm !== true) {
      const err = new Error('Set confirm:true to buy a Twilio number (~$1.15/mo).');
      err.status = 400;
      throw err;
    }
    const site = getSite(req.params.id);
    const provisioned = await provisionRankingNumber({
      site,
      areaCode: body.areaCode,
      force: body.force === true,
    });
    const updated = setSitePhoneTracking(site.id, provisioned.phoneTracking);
    res.json({ site: updated, provisioned });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * Website Builder / Site-Config: mark phone step skipped (persist across reload).
 */
app.post('/api/candidates/:id/phone/skip', (req, res) => {
  try {
    const meta = saveMeta(req.params.id, {
      phoneSkippedAt: new Date().toISOString(),
    });
    res.json({ meta, candidate: getCandidateDetail(req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * Website Builder / Site-Config: upsert portfolio row, then Twilio provision (Option A).
 */
app.post('/api/candidates/:id/phone/provision-twilio', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.confirm !== true) {
      const err = new Error('Set confirm:true to buy a Twilio number (~$1.15/mo).');
      err.status = 400;
      throw err;
    }
    const site = upsertSiteFromCandidate({ candidateId: req.params.id });
    const provisioned = await provisionRankingNumber({
      site: getSite(site.id),
      areaCode: body.areaCode,
      force: body.force === true,
    });
    const updated = setSitePhoneTracking(site.id, provisioned.phoneTracking);
    res.json({
      site: updated,
      provisioned,
      candidate: getCandidateDetail(req.params.id),
    });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * Same DID: set forwardTo to renter.phone and phase → rented.
 * Body: { confirm: true }
 */
app.post('/api/sites/:id/phone/forward-renter', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.confirm !== true) {
      const err = new Error('Set confirm:true to forward this DID to the renter phone.');
      err.status = 400;
      throw err;
    }
    const site = getSite(req.params.id);
    const result = await setForwardToRenter(site);
    const updated = setSitePhoneTracking(site.id, result.phoneTracking);
    res.json({ site: updated, forward: result });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * Optional: set an arbitrary forward target (ranking or custom).
 * Body: { confirm: true, forwardTo: "+1…", phase?: "ranking"|"rented" }
 */
app.post('/api/sites/:id/phone/forward', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.confirm !== true) {
      const err = new Error('Set confirm:true to update the forward target.');
      err.status = 400;
      throw err;
    }
    const site = getSite(req.params.id);
    const result = await updateForwardTarget({
      site,
      forwardTo: body.forwardTo,
      phase: body.phase,
    });
    const updated = setSitePhoneTracking(site.id, result.phoneTracking);
    res.json({ site: updated, forward: result });
  } catch (error) {
    sendError(res, error);
  }
});

function readPhoneWebhookSecret(req) {
  return (
    req.get('x-rover-phone-secret') ||
    req.body?.secret ||
    req.query?.secret ||
    ''
  );
}

app.post('/api/phone/webhooks/status', (req, res) => {
  try {
    assertPhoneWebhookSecret(readPhoneWebhookSecret(req));
    const row = handleDialStatusWebhook(req.body || {});
    res.json({ ok: true, call: row });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/phone/webhooks/recording', (req, res) => {
  try {
    assertPhoneWebhookSecret(readPhoneWebhookSecret(req));
    const row = handleRecordingWebhook(req.body || {});
    if (row?.callSid && row.recordingSid) {
      enqueueSummarizePhoneCall(row.callSid);
    }
    res.json({ ok: true, call: row });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * Durable backfill from Twilio REST (Calls + Recordings).
 * Body: { siteId?, sinceDays? } — Phone tab runs this on load/refresh.
 */
app.post('/api/phone/sync', async (req, res) => {
  try {
    const body = req.body || {};
    const siteId = body.siteId ? String(body.siteId) : null;
    const sinceDays = body.sinceDays != null ? Number(body.sinceDays) : 30;
    const sync = await syncCallsFromTwilio({ siteId, sinceDays });
    res.json({
      ...sync,
      calls: listPhoneCalls({ siteId, limit: 200 }),
      stats: phoneCallStats({ siteId }),
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/phone/calls', (req, res) => {
  try {
    const siteId = req.query.siteId ? String(req.query.siteId) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 200;
    res.json({
      calls: listPhoneCalls({ siteId, limit }),
      stats: phoneCallStats({ siteId }),
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/phone/calls/:id', (req, res) => {
  try {
    const call = getPhoneCall(req.params.id);
    if (!call) {
      const err = new Error('Call not found');
      err.status = 404;
      throw err;
    }
    res.json({ call });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/phone/calls/:id/recording', async (req, res) => {
  try {
    const { buf, contentType } = await getRecordingStream(req.params.id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buf);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/phone/calls/:id/summarize', async (req, res) => {
  try {
    const call = await summarizePhoneCall(req.params.id);
    res.json({ call });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/phone/sites', (req, res) => {
  try {
    const sites = listSitesWithPhone().map((s) => {
      const stats = phoneCallStats({ siteId: s.id });
      return {
        id: s.id,
        businessName: s.businessName || s.niche || s.id,
        niche: s.niche,
        city: s.city,
        state: s.state,
        status: s.status,
        e164: s.phoneTracking?.e164 || '',
        phase: s.phoneTracking?.phase || 'none',
        forwardTo: s.phoneTracking?.forwardTo || '',
        stats,
      };
    });
    res.json({ sites, stats: phoneCallStats({}) });
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

app.get('/api/candidates/:id/ship-diff', (req, res) => {
  try {
    res.json(getAssembledShipDiff(req.params.id));
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

app.get('/api/candidates/:id/copy-outreach-prompt', (req, res) => {
  try {
    res.json({ prompt: buildOutreachCopyPrompt(req.params.id) });
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
