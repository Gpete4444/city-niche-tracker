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
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { loadEnvFile, fetchUserBalance } from '../scripts/lib/dataforseo.mjs';
import { migrateDecisionsToScoreModel } from './lib/migrate-decisions-score.mjs';
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
  getCandidateShell,
  listCandidates,
  rejectNarrative,
  rejectNarratives,
  saveMeta,
  setDecision,
  setDecisions,
  setArchived,
  deleteCandidates,
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
  parseJsonLoose,
  requireAnthropicKey,
} from './lib/claude.mjs';
import {
  acceptSiteConfig,
  acceptServiceArea,
  buildSiteConfigPrompt,
  buildDomainPickPrompt,
  suggestDomainsWithClaude,
  generateSiteConfigWithClaude,
  getSiteConfigDraft,
  pasteSiteConfigDraft,
  setCandidateArchetype,
  applySiteConfigBrand,
  updateSiteConfigDraft,
  listArchetypes,
} from './lib/site-config.mjs';
import {
  getBusinessAddressPackage,
  searchBusinessAddresses,
  selectBusinessAddress,
  saveHomeBusinessAddress,
  saveManualBusinessAddress,
  skipBusinessAddress,
  fetchApifyPlanUsage,
  listRecoverableAddresses,
  retierShortlistLocalities,
  getAddressSourceReadiness,
} from './lib/address-screen.mjs';
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
  setImageSlotMatchGrade,
  repullImageSlot,
  uploadImageSlot,
  readSiteImageFile,
} from './lib/fill-site-images.mjs';
import {
  generateImageSlotOpenai,
  useImageSlotVariant,
  generateCandidateBaPairOpenai,
  useCandidateBaVariant,
} from './lib/openai-generate.mjs';
import { openaiImageStatus } from './lib/image-providers/openai-image.mjs';
import {
  applyPhotoGroups,
  attachPhotoGroup,
  findNicheMaster,
  skipPhotoGroup,
  getAttachedPhotoGroup,
  listAttachedGroupStills,
  listAttachedGroupBaPairs,
  listPhotoGroups,
  normalizePhotoGroupIds,
  previewPhotoGroup,
  savePhotoGroup,
  readPhotoGroupFile,
  useGroupFileOnSlot,
  useGroupBaPairOnSlot,
} from './lib/photo-groups.mjs';
import {
  listPhotoLibrary,
  getPhotoGroupView,
  listRolePhotos,
  swapPhotoGroupSlot,
  uploadPhotoGroupSlot,
  repullPhotoGroupSlot,
  chatgptPromptForGroupSlot,
  savePhotoGroupSlotOpenaiPrompt,
  importPhotoGroupBa,
  removePhotoGroupSlot,
  renamePhotoGroup,
  duplicatePhotoGroup,
  deletePhotoGroup,
  upsertNicheMaster,
  generatePhotoGroupSlotOpenai,
  useFileOnPhotoGroupSlot,
  usePhotoGroupSlotVariant,
  generatePhotoGroupBaPairOpenai,
  usePhotoGroupBaVariant,
  useBaPairOnPhotoGroupSlot,
  getPhotoGroupBaPrompts,
  savePhotoGroupBaOpenaiPrompt,
} from './lib/photo-library.mjs';
import { generateSiteLogo, useLogoVariant } from './lib/generate-site-logo.mjs';
import { generateCoverageMapForCandidate, getCoverageMapProgress, useCoverageMapVariant } from './lib/generate-coverage-map.mjs';
import {
  importBeforeAfterPair,
  listBeforeAfterStatus,
  resolveBaPromptsWithOverride,
  saveBaOpenaiPrompt,
  setBaPairMatchGrade,
} from './lib/chatgpt-before-after.mjs';
import { buildSlotImagePrompt, saveSlotOpenaiPrompt } from './lib/chatgpt-slot-image.mjs';
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
import {
  buildBatchedFullWritePrompt,
  buildFieldResearchPrompt,
  buildFinalCheckPrompt,
  buildImageQueriesPrompt,
  buildSoftBriefPrompt,
  getContentFieldResearch,
  getWriteBatchStatus,
  markWriteBatchComplete,
  pasteAndConfirmSoftBrief,
  saveContentFieldResearch,
  saveImagesPlan,
  stampFinalCheck,
  syncWriteBatchesFromDraft,
} from './lib/content-eight-pass.mjs';
import { assertWriteSiteReady, runWriteSiteJob } from './lib/content-write-site.mjs';
import { buildBuildPackage, getBuildPackage } from './lib/build-package.mjs';
import { stageSiteInWorker, getStagingSummary } from './lib/site-staging.mjs';
import {
  getLaunchContentGapsForCandidate,
  isAssembleStale,
  launchFidelitySummary,
} from './lib/preview-fidelity.mjs';
import { ensureAstroPreview, stopAstroPreview, ASTRO_PREVIEW_URL } from './lib/astro-preview.mjs';
import { ensureAssembledPreview, stopAssembledPreview, contentNewerThanDist } from './lib/assembled-preview.mjs';
import {
  enqueueHeavyJob,
  startHeavyJob,
  getHeavyJob,
  getActiveJobForCandidate,
  listJobsSnapshot,
  onJobsChange,
  updateJobDetail,
  updateJobProgress,
  setConcurrency,
} from './lib/rover-heavy-jobs.mjs';
import {
  startLightJob,
  waitForLightJob,
  getLightJob,
  listLightJobsSnapshot,
  onLightJobsChange,
  updateLightJobProgress,
  cancelLightJob,
  findActiveLightJob,
  discoveryPackJobCandidateId,
  assertWriteSiteStartAllowed,
  assertAcceptStartAllowed,
} from './lib/rover-light-jobs.mjs';
import { yieldEventLoop } from './lib/yield-event-loop.mjs';
import {
  getGeneratePackCostPreview,
  runGeneratePackJob,
} from './lib/discovery-generate-pack.mjs';
import { getUserGuidePayload } from './lib/help-markdown.mjs';
import { assembleSiteInWorker, getAssembleChecklist, planAssembleReplace, finalizePreviousAssembledSite } from './lib/assemble-site.mjs';
import { assertLaunchedEditAllowed } from './lib/launched-edit-guard.mjs';
import { restoreLaunchedFromGithub } from './lib/restore-launched-from-github.mjs';
import { getLaunchStatus, launchSite, listLaunchProgressSteps } from './lib/launch-site.mjs';
import {
  BILLING_CYCLES,
  createManualSite,
  deleteSite,
  getSite,
  getSiteByCandidateId,
  listLaunchedSites,
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
  attachMetricsToSites,
  loadSiteMetrics,
  portfolioRankSeries,
  portfolioTrafficSeries,
  setRankKeywords,
} from './lib/site-metrics.mjs';
import {
  completeGscOAuth,
  disconnectGsc,
  getGscAuthStatus,
  startGscOAuth,
} from './lib/gsc-oauth.mjs';
import { syncAllSitesGsc, syncSiteGsc } from './lib/gsc-sync.mjs';
import { checkAllSiteRanks, checkSiteRanks } from './lib/rank-track.mjs';
import {
  provisionRankingNumber,
  setForwardToRenter,
  updateForwardTarget,
} from './lib/phone-tracking-twilio.mjs';
import { getApiCostSnapshot } from './lib/api-cost.mjs';
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
import { getShipStatus, getAssembledShipDiff, shipAssembledSite, buildAssembledSiteAsync } from './lib/ship-site.mjs';
import { ghAuthStatus } from './lib/github-site.mjs';
import {
  applyVisualEditPatches,
  beginVisualEditSession,
  ensureVisualEditPreviewReady,
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
  backfillLightSerpFromBatch,
  updateBatchDecisions,
} from './lib/discovery.mjs';
import { previewSerpProbe, runDiscoverySerpProbe, startDiscoverySerpProbe, getSerpProbeJob, discoveryStepStatus } from './lib/discovery-serp-probe.mjs';
import { suggestPlaces } from './lib/census.mjs';
import { aggregateStageFlags, getBatchJob, startBatchJobs } from './lib/batch-jobs.mjs';
import { getEvalConcurrency, setEvalConcurrency } from './lib/eval-concurrency.mjs';
import { concurrencyPayload, setConcurrencySettings } from './lib/rover-concurrency.mjs';
import {
  regenerateKnownCandidates,
  listKnownForEditor,
  previewPruneKnownToActive,
  pruneKnownToActiveCandidates,
  removeKnownEntries,
} from './lib/known-candidates.mjs';
import {
  assertDeletableIds,
  assertEvalPrerequisite,
} from './lib/candidate-protection.mjs';
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
  if (error.contract) payload.contract = error.contract;
  if (error.job) payload.job = error.job;
  if (error.jobId) payload.jobId = error.jobId;
  if (error.candidateId) payload.candidateId = error.candidateId;
  if (error.running != null) payload.running = error.running;
  if (error.limit != null) payload.limit = error.limit;
  if (error.selected != null) payload.selected = error.selected;
  if (error.batchId) payload.batchId = error.batchId;
  if (error.speechLint) payload.speechLint = error.speechLint;
  if (error.seoLint) payload.seoLint = error.seoLint;
  if (error.twilioSid) payload.twilioSid = error.twilioSid;
  if (error.e164) payload.e164 = error.e164;
  if (error.provisioned) payload.provisioned = error.provisioned;
  if (error.existingId) payload.existingId = error.existingId;
  res.status(status).json(payload);
}

app.get('/api/help/user-guide', (_req, res) => {
  try {
    res.json(getUserGuidePayload());
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/health', (_req, res) => {
  const envSet = (...keys) => keys.every((k) => Boolean(String(process.env[k] || '').trim()));
  const gsc = getGscAuthStatus();
  const checks = [
    // 1 · Discovery & research
    {
      name: 'DataForSEO',
      group: 'Discovery & research',
      ok: envSet('DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'),
    },
    // 2 · Copy & AI
    { name: 'Anthropic', group: 'Copy & AI', ok: envSet('ANTHROPIC_API_KEY') },
    { name: 'Anthropic Admin', group: 'Copy & AI', ok: envSet('ANTHROPIC_ADMIN_KEY'), optional: true },
    // 3 · Site-config · address
    { name: 'Google Maps', group: 'Site-config · address', ok: envSet('GOOGLE_MAPS_API_KEY') },
    { name: 'Apify token', group: 'Site-config · address', ok: envSet('APIFY_TOKEN') },
    {
      name: 'LoopNet actor',
      group: 'Site-config · address',
      ok: envSet('APIFY_LOOPNET_ACTOR_ID'),
    },
    {
      name: 'Crexi actor',
      group: 'Site-config · address',
      ok: envSet('APIFY_CREXI_ACTOR_ID'),
    },
    // 4 · Website · images
    { name: 'Unsplash', group: 'Website · images', ok: envSet('UNSPLASH_ACCESS_KEY') },
    { name: 'Pexels', group: 'Website · images', ok: envSet('PEXELS_API_KEY') },
    { name: 'Pixabay', group: 'Website · images', ok: envSet('PIXABAY_API_KEY') },
    {
      name: 'GPT Image (OpenAI)',
      group: 'Website · images',
      ok: envSet('OPENAI_API_KEY'),
    },
    // 5 · Assemble & launch
    { name: 'GitHub owner', group: 'Assemble & launch', ok: envSet('GITHUB_OWNER') },
    { name: 'Template repo', group: 'Assemble & launch', ok: envSet('TEMPLATE_GITHUB_REPO') },
    {
      name: 'Assembled sites dir',
      group: 'Assemble & launch',
      ok: envSet('ASSEMBLED_SITES_DIR'),
    },
    {
      name: 'Cloudflare',
      group: 'Assemble & launch',
      ok: envSet('CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'),
    },
    {
      name: 'Web3Forms email',
      group: 'Assemble & launch',
      ok: envSet('WEB3FORMS_DEFAULT_NOTIFY_EMAIL'),
    },
    // 6 · Phone
    {
      name: 'Twilio',
      group: 'Phone',
      ok: envSet(
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_FORWARD_TO',
        'TWILIO_VOICE_WEBHOOK_URL',
      ),
    },
    { name: 'OpenAI', group: 'Phone', ok: envSet('OPENAI_API_KEY') },
    // 7 · Launched Sites · metrics
    {
      name: 'Google Search Console',
      group: 'Launched Sites · metrics',
      ok: Boolean(gsc.configured && gsc.connected),
    },
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
      items: checks.map((c) => ({ name: c.name, ok: c.ok, group: c.group })),
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
    const radiusMiles = Number(req.query.radiusMiles ?? 15);
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
  const writeLine = (obj) => {
    if (res.writableEnded) return;
    res.write(`${JSON.stringify(obj)}\n`);
  };
  try {
    const body = req.body || {};
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders?.();

    writeLine({
      type: 'progress',
      label: 'Saving…',
      detail: 'Saving coverage + location pages…',
      current: 0,
      total: 0,
    });
    const result = acceptServiceArea(req.params.id, {
      radiusMiles: body.radiusMiles,
      selectedCities: body.selectedCities,
      claudeOrder: body.claudeOrder,
      locationPageCities: body.locationPageCities,
    });

    writeLine({
      type: 'progress',
      label: 'Saving…',
      detail: 'Seeding location page stubs…',
      current: 0,
      total: 0,
    });
    let locationStubs = null;
    try {
      locationStubs = seedTargetSuburbLocationStubs(result.config);
    } catch (e) {
      locationStubs = { error: e.message || String(e) };
    }

    const mapTotal = Array.isArray(result.coverageAreas) ? result.coverageAreas.length : 0;
    writeLine({
      type: 'progress',
      label: 'Coverage map',
      detail:
        mapTotal > 0
          ? `Building coverage map (0/${mapTotal})…`
          : 'Building coverage map…',
      current: 0,
      total: mapTotal,
    });

    let coverageMap = null;
    try {
      coverageMap = await generateCoverageMapForCandidate(req.params.id, {
        onProgress: (p) => {
          writeLine({
            type: 'progress',
            label: 'Coverage map',
            detail: p.detail || p.label || 'Building coverage map…',
            current: Number(p.current) || 0,
            total: Number(p.total) || mapTotal,
          });
        },
      });
    } catch (e) {
      coverageMap = { error: e.message || String(e) };
      writeLine({
        type: 'progress',
        label: 'Coverage map',
        detail: coverageMap.error || 'Coverage map failed (coverage still saved)',
        current: mapTotal,
        total: mapTotal,
      });
    }

    writeLine({
      type: 'done',
      ...result,
      locationStubs,
      coverageMap,
    });
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      sendError(res, error);
      return;
    }
    try {
      writeLine({
        type: 'error',
        error: error.message || String(error),
        code: error.code || null,
      });
    } catch {
      /* ignore */
    }
    res.end();
  }
});

app.get('/api/discovery/presets', (_req, res) => {
  try {
    res.json(discoveryPresets());
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/discovery/known', (_req, res) => {
  try {
    res.json({
      rows: listKnownForEditor(),
      prunePreview: previewPruneKnownToActive(),
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/discovery/known/prune-to-active', async (_req, res) => {
  try {
    res.json(await pruneKnownToActiveCandidates());
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/discovery/known/remove', async (req, res) => {
  try {
    const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
    if (!keys.length) {
      throw Object.assign(new Error('keys array required'), { status: 400 });
    }
    res.json(await removeKnownEntries(keys));
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

app.get('/api/discovery/batches/:id/cost-preview', (req, res) => {
  try {
    res.json(getGeneratePackCostPreview(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/discovery/batches/:id/generate-pack', (req, res) => {
  try {
    const batchId = req.params.id;
    requireAnthropicKey();
    getBatch(batchId);

    const key = discoveryPackJobCandidateId(batchId);
    const same = findActiveLightJob('generate-pack', key);
    if (same) {
      return res.status(409).json({
        error: 'Generate pack is already running for this batch',
        code: 'GENERATE_PACK_RUNNING',
        jobId: same.id,
        batchId,
      });
    }
    const other = findActiveLightJob('generate-pack');
    if (other) {
      return res.status(409).json({
        error: `Generate pack is already running for ${other.batchId || other.candidateId}`,
        code: 'GENERATE_PACK_BUSY',
        jobId: other.id,
        batchId: other.batchId || null,
        candidateId: other.candidateId,
      });
    }

    const { jobId } = startLightJob({
      batchId,
      phase: 'generate-pack',
      label: 'Generate pack',
      progressTotal: 2,
      run: async ({ jobId: jid, signal }) => runGeneratePackJob(batchId, { jobId: jid, signal }),
    });
    res.status(202).json({ jobId, accepted: true, batchId });
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
      });
      return res.json(result);
    }
    const job = startDiscoverySerpProbe(req.params.id, {
      indices: Array.isArray(body.indices) ? body.indices : null,
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

app.post('/api/discovery/batches/:id/backfill-light-serp', (req, res) => {
  try {
    res.json(backfillLightSerpFromBatch(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/jobs/batch', (req, res) => {
  try {
    const body = req.body || {};
    const act = body.act;
    const candidateIds = Array.isArray(body.candidateIds) ? body.candidateIds : [];
    const evalAll = act === 'evaluate-all' || act === 'evaluateAll';
    res.json(
      startBatchJobs({
        act: evalAll ? 'evaluate-all' : act,
        candidateIds,
        requireWithinLimit: true,
        adsMode: evalAll ? 'live' : body.adsMode === 'standard' ? 'standard' : 'live',
        forceSerp: evalAll ? false : Boolean(body.forceSerp),
        volumesOnly: evalAll ? false : Boolean(body.volumesOnly),
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/eval-concurrency', (_req, res) => {
  res.json({ value: getEvalConcurrency() });
});

app.post('/api/eval-concurrency', (req, res) => {
  try {
    const value = setEvalConcurrency(req.body?.value ?? req.body?.concurrency);
    res.json({ value });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/concurrency', (_req, res) => {
  res.json(concurrencyPayload());
});

app.post('/api/concurrency', (req, res) => {
  try {
    setConcurrencySettings(req.body || {});
    res.json(concurrencyPayload());
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

app.get('/api/api-cost', async (req, res) => {
  try {
    const fresh = String(req.query?.fresh || '') === '1' || req.query?.fresh === 'true';
    res.json(await getApiCostSnapshot({ fresh }));
  } catch (error) {
    sendError(res, error);
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
    const raw = req.query.include;
    const include = raw == null || raw === '' ? [] : raw;
    res.json(getCandidateDetail(req.params.id, { include }));
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

app.post('/api/candidates/delete', async (req, res) => {
  try {
    const body = req.body || {};
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) {
      throw Object.assign(new Error('ids required'), { status: 400 });
    }
    assertDeletableIds(ids);
    const result = await deleteCandidates(ids);
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
    assertEvalPrerequisite(req.params.id, 'enrich');
    const job = runEnrich(req.params.id);
    res.json({ job });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/prospects', (req, res) => {
  try {
    assertEvalPrerequisite(req.params.id, 'prospects');
    const job = runProspects(req.params.id);
    res.json({ job });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/heavy-jobs', (_req, res) => {
  res.json(listJobsSnapshot());
});

app.post('/api/heavy-jobs/concurrency', (req, res) => {
  try {
    const n = req.body?.concurrency ?? req.body?.k;
    setConcurrency(n);
    res.json(listJobsSnapshot());
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/heavy-jobs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  const send = (snap) => {
    try {
      res.write(`data: ${JSON.stringify(snap)}\n\n`);
    } catch {
      /* closed */
    }
  };
  send(listJobsSnapshot());
  const off = onJobsChange(send);
  const ping = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* closed */
    }
  }, 15000);
  req.on('close', () => {
    clearInterval(ping);
    off();
  });
});

app.get('/api/heavy-jobs/:jobId', (req, res) => {
  const job = getHeavyJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ job });
});

app.get('/api/light-jobs', (_req, res) => {
  res.json(listLightJobsSnapshot());
});

app.get('/api/light-jobs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  const send = (snap) => {
    try {
      res.write(`data: ${JSON.stringify(snap)}\n\n`);
    } catch {
      /* closed */
    }
  };
  send(listLightJobsSnapshot());
  const off = onLightJobsChange(send);
  const ping = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* closed */
    }
  }, 15000);
  req.on('close', () => {
    clearInterval(ping);
    off();
  });
});

app.get('/api/light-jobs/:jobId', (req, res) => {
  const job = getLightJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ job });
});

app.post('/api/light-jobs/:jobId/cancel', (req, res) => {
  try {
    const job = cancelLightJob(req.params.jobId);
    res.json({ ok: true, job });
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
    assertEvalPrerequisite(req.params.id, 'narrative');
    const result = await generateNarrativeDraft(req.params.id);
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/narrative/paste', (req, res) => {
  try {
    assertEvalPrerequisite(req.params.id, 'narrative');
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
      candidate: getCandidateShell(req.params.id),
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
    res.json({ ok: true, candidate: getCandidateShell(req.params.id) });
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
      addressStreet: req.query.addressStreet || req.query.street,
      addressCity: req.query.addressCity,
      addressState: req.query.addressState,
      addressZip: req.query.addressZip || req.query.zip,
      allowNonPursue: req.query.allowNonPursue === '1' || req.query.allowNonPursue === 'true',
    };
    res.json(buildSiteConfigPrompt(req.params.id, nap));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/site-config/domain-prompt', (req, res) => {
  try {
    const nap = {
      businessName: req.query.businessName,
      allowNonPursue: req.query.allowNonPursue === '1' || req.query.allowNonPursue === 'true',
    };
    res.json(buildDomainPickPrompt(req.params.id, nap));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/site-config/suggest-domains', async (req, res) => {
  try {
    const body = req.body || {};
    const nap = {
      businessName: body.businessName,
      allowNonPursue: body.allowNonPursue === true || body.allowNonPursue === '1',
    };
    res.json(await suggestDomainsWithClaude(req.params.id, nap));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/site-config/generate', async (req, res) => {
  try {
    const body = req.body || {};
    assertLaunchedEditAllowed(req.params.id, body);
    const nap = {
      domain: body.domain,
      businessName: body.businessName,
      phone: body.phone,
      email: body.email,
      radiusMiles: body.radiusMiles,
      siteArchetype: body.siteArchetype,
      paletteId: body.paletteId,
      fontTheme: body.fontTheme,
      addressStreet: body.addressStreet || body.street,
      addressCity: body.addressCity,
      addressState: body.addressState,
      addressZip: body.addressZip || body.zip,
      allowNonPursue: body.allowNonPursue === true || body.allowNonPursue === '1',
    };
    res.json(await generateSiteConfigWithClaude(req.params.id, nap));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/address', (req, res) => {
  try {
    res.json({
      package: getBusinessAddressPackage(req.params.id),
      candidate: getCandidateShell(req.params.id),
      recover: listRecoverableAddresses(req.params.id),
      sources: getAddressSourceReadiness(),
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/address/search', async (req, res) => {
  try {
    const body = req.body || {};
    res.json(
      await searchBusinessAddresses(req.params.id, {
        sources: body.sources,
        refresh: body.refresh,
        deepen: body.deepen,
        raisePullMax: body.raisePullMax,
        refreshLoopnet: Boolean(body.refreshLoopnet),
        cleanPerRun: body.cleanPerRun,
        listingsPerRun: body.listingsPerRun,
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/apify/usage', async (_req, res) => {
  try {
    res.json(await fetchApifyPlanUsage());
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/address/select', (req, res) => {
  try {
    const body = req.body || {};
    res.json(selectBusinessAddress(req.params.id, body.selection || body, { skipped: false }));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/address/home', (req, res) => {
  try {
    res.json(saveHomeBusinessAddress(req.params.id, req.body?.line || req.body?.address || ''));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/address/manual', (req, res) => {
  try {
    res.json(
      saveManualBusinessAddress(req.params.id, req.body?.line || req.body?.address || ''),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/address/recover', (req, res) => {
  try {
    res.json(listRecoverableAddresses(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/address/retier-locality', async (req, res) => {
  try {
    res.json(await retierShortlistLocalities(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/address/skip', (req, res) => {
  try {
    res.json(skipBusinessAddress(req.params.id));
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
    assertLaunchedEditAllowed(req.params.id, body);
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
    assertLaunchedEditAllowed(req.params.id, body);
    res.json(
      acceptSiteConfig(req.params.id, {
        allowNonPursue: Boolean(body.allowNonPursue),
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
    assertLaunchedEditAllowed(req.params.id, body);
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
  const acceptId = req.params.id;
  try {
    const body = req.body || {};
    assertLaunchedEditAllowed(acceptId, body);
    assertAcceptStartAllowed(acceptId);
    const ACCEPT_TOTAL = 4;
    const { jobId } = startLightJob({
      candidateId: acceptId,
      phase: 'accept',
      label: 'Accept',
      progressTotal: ACCEPT_TOTAL,
      run: async ({ jobId: jid }) => {
        const tick = (done, detail) =>
          updateLightJobProgress(jid, { detail, done, total: ACCEPT_TOTAL });

        tick(1, 'Writing files to src/content…');
        console.log(`[accept] ${acceptId} writing src/content…`);
        const result = await acceptContent(acceptId, {
          ignoreWarnings: Boolean(body.ignoreWarnings),
          ignoreSeoWarnings: Boolean(body.ignoreSeoWarnings),
        });
        await yieldEventLoop();
        let images = null;
        tick(2, 'Loading saved photos or pulling stock…');
        if (structureHasPhotosEnabled(acceptId)) {
          const attached = getAttachedPhotoGroup(acceptId);
          const skipDoc = getCandidateDetail(acceptId).photoGroupAttached;
          const applyGroup = async (groupIds, label) => {
            const ids = Array.isArray(groupIds) ? groupIds : [groupIds];
            console.log(`[accept] ${acceptId} applying photo group “${label}”…`);
            try {
              return applyPhotoGroups(acceptId, ids);
            } catch (imageErr) {
              return {
                ok: false,
                warning: imageErr.message || String(imageErr),
                human: [imageErr.message || String(imageErr)],
              };
            }
          };
          const pullStock = async () => {
            console.log(`[accept] ${acceptId} pulling stock photos…`);
            try {
              return await fillSiteImages(acceptId, {
                replace: false,
                onProgress: (p) =>
                  updateLightJobProgress(jid, {
                    done: 2,
                    total: ACCEPT_TOTAL,
                    detail: p.detail || 'Pulling stock…',
                  }),
              });
            } catch (imageErr) {
              return {
                ok: false,
                warning: imageErr.message || String(imageErr),
                human: [imageErr.message || String(imageErr)],
                providerStatus: imageErr.providerStatus || null,
              };
            }
          };
          if (attached?.groupIds?.length) {
            images = await applyGroup(
              attached.groupIds,
              (attached.names || attached.groups?.map((g) => g.name) || [attached.name || attached.groupId]).join(' → '),
            );
          } else if (skipDoc?.skipped) {
            images = await pullStock();
          } else {
            const detail = getCandidateDetail(acceptId);
            const niche = detail.photoGroupNiche || detail.siteConfig?.niche || '';
            const master = findNicheMaster(niche);
            if (master?.id) {
              images = await applyGroup(master.id, master.name || `${niche} master`);
            } else {
              images = await pullStock();
            }
          }
        } else {
          console.log(`[accept] ${acceptId} photos skipped (structure has none enabled)`);
        }
        await yieldEventLoop();
        let logo = null;
        tick(3, 'Generating logo…');
        console.log(`[accept] ${acceptId} generating logo…`);
        try {
          logo = await generateSiteLogo(acceptId, { mode: 'markText' });
        } catch (logoErr) {
          if (logoErr?.code === 'openai-unconfigured') {
            try {
              logo = await generateSiteLogo(acceptId, { mode: 'monogram' });
            } catch (monoErr) {
              logo = {
                ok: false,
                warning: monoErr.message || String(monoErr),
              };
            }
          } else {
            logo = {
              ok: false,
              warning: logoErr.message || String(logoErr),
            };
          }
        }
        await yieldEventLoop();
        let coverageMap = null;
        tick(4, 'Building coverage map…');
        console.log(`[accept] ${acceptId} building coverage map…`);
        try {
          coverageMap = await generateCoverageMapForCandidate(acceptId, {
            onProgress: (p) =>
              updateLightJobProgress(jid, {
                done: 4,
                total: ACCEPT_TOTAL,
                detail: p.detail || p.label || 'Building coverage map…',
              }),
          });
        } catch (mapErr) {
          coverageMap = {
            ok: false,
            skipped: /no coverage areas|suburbs/i.test(String(mapErr.message || '')),
            warning: mapErr.message || String(mapErr),
          };
        }
        console.log(`[accept] ${acceptId} done`);
        const assetNotes = [];
        if (logo?.ok !== false && logo?.path) assetNotes.push(`Logo: ${logo.path}`);
        else if (logo?.warning) assetNotes.push(`Logo skipped: ${logo.warning}`);
        if (coverageMap?.ok && coverageMap?.path) {
          const miss = Array.isArray(coverageMap.missingBoundaries)
            ? coverageMap.missingBoundaries
            : [];
          assetNotes.push(
            miss.length
              ? `Coverage map: ${coverageMap.path} (${coverageMap.areas || '?'} outlined; Also serving / no outline: ${miss.join(', ')})`
              : `Coverage map: ${coverageMap.path}`,
          );
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
        return {
          ...result,
          images,
          logo,
          coverageMap,
          candidate: getCandidateShell(acceptId),
        };
      },
    });
    const payload = await waitForLightJob(jobId);
    res.json({ ...payload, jobId });
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

app.get('/api/photo-groups', (req, res) => {
  try {
    res.json({ groups: listPhotoGroups({ niche: req.query?.niche || '' }) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/photo-groups', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const replaceExisting = Boolean(req.body?.replaceExisting);
    res.json(savePhotoGroup(req.params.id, name, { replaceExisting }));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/photo-groups/preview', (req, res) => {
  try {
    const groupIds = normalizePhotoGroupIds({
      ...(req.body || {}),
      groupId: req.body?.groupId || req.query?.groupId,
    });
    res.json(previewPhotoGroup(req.params.id, { groupIds }));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/photo-groups/load', async (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    const groupIds = normalizePhotoGroupIds(req.body || {});
    res.json(await applyPhotoGroups(req.params.id, groupIds));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/photo-groups/attach', (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    res.json(attachPhotoGroup(req.params.id, req.body || {}));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/photo-groups/skip', (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    res.json(skipPhotoGroup(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/photo-groups/stills', (req, res) => {
  try {
    res.json(listAttachedGroupStills(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/photo-groups/ba-pairs', (req, res) => {
  try {
    res.json(listAttachedGroupBaPairs(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

function sendLocalImageFile(res, abs, filename) {
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
}

app.get('/api/photo-library', (req, res) => {
  try {
    res.json(listPhotoLibrary({ niche: req.query?.niche || '' }));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/photo-library/roles', (req, res) => {
  try {
    res.json(
      listRolePhotos({
        niche: req.query?.niche || '',
        matchKey: req.query?.key || req.query?.matchKey || '',
        excludeGroupId: req.query?.exclude || req.query?.excludeGroupId || '',
        excludeFilename: req.query?.filename || req.query?.excludeFilename || '',
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/photo-groups/:id/file/:filename', (req, res) => {
  try {
    const { abs, filename } = readPhotoGroupFile(req.params.id, req.params.filename);
    sendLocalImageFile(res, abs, filename);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/photo-groups/:id', (req, res) => {
  try {
    res.json({ ...getPhotoGroupView(req.params.id), openai: openaiImageStatus() });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/photo-groups/:id/slots/swap', (req, res) => {
  try {
    res.json(swapPhotoGroupSlot(req.params.id, req.body || {}));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/photo-groups/:id/slots/upload', (req, res) => {
  try {
    res.json(uploadPhotoGroupSlot(req.params.id, req.body || {}));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/photo-groups/:id/slots/repull', async (req, res) => {
  try {
    res.json(await repullPhotoGroupSlot(req.params.id, req.body || {}));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/photo-groups/:id/slots/remove', (req, res) => {
  try {
    res.json(removePhotoGroupSlot(req.params.id, req.body || {}));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/photo-groups/:id/slots/:key/chatgpt-prompt', (req, res) => {
  try {
    res.json(
      chatgptPromptForGroupSlot(req.params.id, req.params.key, {
        viewpoint: req.query?.viewpoint || 'inside',
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/photo-groups/:id/slots/:key/openai-prompt', (req, res) => {
  try {
    res.json(
      savePhotoGroupSlotOpenaiPrompt(req.params.id, req.params.key, {
        viewpoint: req.body?.viewpoint || 'inside',
        prompt: req.body?.prompt,
        restore: Boolean(req.body?.restore),
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/photo-groups/:id/slots/generate-openai', async (req, res) => {
  try {
    res.json(
      await generatePhotoGroupSlotOpenai(req.params.id, {
        matchKey: req.body?.matchKey || req.body?.key,
        viewpoint: req.body?.viewpoint || 'inside',
        prompt: req.body?.prompt,
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/photo-groups/:id/slots/use-file', (req, res) => {
  try {
    res.json(
      useFileOnPhotoGroupSlot(req.params.id, {
        matchKey: req.body?.matchKey || req.body?.key,
        fromGroupId: req.body?.fromGroupId || req.body?.groupId,
        filename: req.body?.filename,
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/photo-groups/:id/slots/variants/use', (req, res) => {
  try {
    res.json(
      usePhotoGroupSlotVariant(req.params.id, {
        matchKey: req.body?.matchKey || req.body?.key,
        filename: req.body?.filename,
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/photo-groups/:id/before-after-prompts', (req, res) => {
  try {
    res.json(
      getPhotoGroupBaPrompts(req.params.id, {
        matchKey: req.query?.matchKey || req.query?.match || '',
        viewpoint: req.query?.viewpoint || 'inside',
        pairIndex: req.query?.pairIndex || 1,
        serviceSlug: req.query?.service || req.query?.serviceSlug || '',
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/photo-groups/:id/before-after/openai-prompt', (req, res) => {
  try {
    res.json(
      savePhotoGroupBaOpenaiPrompt(req.params.id, {
        matchKey: req.body?.matchKey || req.body?.match || '',
        viewpoint: req.body?.viewpoint || 'inside',
        pairIndex: req.body?.pairIndex || 1,
        serviceSlug: req.body?.service || req.body?.serviceSlug || '',
        before: req.body?.before,
        after: req.body?.after,
        restore: Boolean(req.body?.restore),
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/photo-groups/:id/before-after/generate-openai', async (req, res) => {
  try {
    res.json(
      await generatePhotoGroupBaPairOpenai(req.params.id, {
        matchKey: req.body?.matchKey,
        viewpoint: req.body?.viewpoint || 'inside',
        kind: req.body?.kind,
        pairIndex: req.body?.pairIndex,
        serviceSlug: req.body?.serviceSlug,
        serviceName: req.body?.serviceName,
        before: req.body?.before,
        after: req.body?.after,
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/photo-groups/:id/before-after/variants/use', (req, res) => {
  try {
    res.json(
      usePhotoGroupBaVariant(req.params.id, {
        matchKey: req.body?.matchKey,
        pairId: req.body?.pairId || req.body?.id,
        beforeFilename: req.body?.beforeFilename || '',
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/photo-groups/:id/before-after/use-pair', (req, res) => {
  try {
    res.json(
      useBaPairOnPhotoGroupSlot(req.params.id, {
        matchKey: req.body?.matchKey || req.body?.key,
        fromGroupId: req.body?.fromGroupId || req.body?.groupId,
        beforeFilename: req.body?.beforeFilename,
        afterFilename: req.body?.afterFilename,
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/photo-groups/:id/before-after/import', (req, res) => {
  try {
    res.json(importPhotoGroupBa(req.params.id, req.body || {}));
  } catch (error) {
    sendError(res, error);
  }
});

app.patch('/api/photo-groups/:id', (req, res) => {
  try {
    res.json(renamePhotoGroup(req.params.id, req.body?.name));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/photo-groups/:id/duplicate', (req, res) => {
  try {
    res.json(duplicatePhotoGroup(req.params.id, req.body?.name));
  } catch (error) {
    sendError(res, error);
  }
});

app.delete('/api/photo-groups/:id', (req, res) => {
  try {
    res.json(deletePhotoGroup(req.params.id));
  } catch (error) {
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
    res.json({ ...listImageSlotStatus(req.params.id), openai: openaiImageStatus() });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/images/file/:filename', (req, res) => {
  try {
    const { abs, filename } = readSiteImageFile(req.params.id, req.params.filename);
    sendLocalImageFile(res, abs, filename);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/pull', async (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    const replace = Boolean(req.body?.replace || req.query?.replace);
    const candidateId = req.params.id;
    const { jobId } = startLightJob({
      candidateId,
      phase: 'images-pull',
      label: replace ? 'Replace photos' : 'Pull photos',
      run: async ({ jobId: jid }) =>
        fillSiteImages(candidateId, {
          replace,
          onProgress: (p) =>
            updateLightJobProgress(jid, {
              detail: p.detail,
              done: p.done,
              total: p.total,
            }),
        }),
    });
    const result = await waitForLightJob(jobId);
    res.json({ ...result, jobId });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/slots/:slotKey/match-grade', (req, res) => {
  try {
    const result = setImageSlotMatchGrade(req.params.id, req.params.slotKey, req.body?.matchGrade);
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/slots/:slotKey/repull', async (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    const result = await repullImageSlot(req.params.id, req.params.slotKey);
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/slots/:slotKey/upload', (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    const result = uploadImageSlot(req.params.id, req.params.slotKey, req.body || {});
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/images/slots/:slotKey/chatgpt-prompt', (req, res) => {
  try {
    res.json(
      buildSlotImagePrompt(req.params.id, req.params.slotKey, {
        viewpoint: req.query?.viewpoint || 'inside',
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/slots/:slotKey/openai-prompt', (req, res) => {
  try {
    res.json(
      saveSlotOpenaiPrompt(req.params.id, req.params.slotKey, {
        viewpoint: req.body?.viewpoint || req.query?.viewpoint || 'inside',
        prompt: req.body?.prompt,
        restore: Boolean(req.body?.restore),
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/slots/:slotKey/generate-openai', async (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    const result = await generateImageSlotOpenai(req.params.id, req.params.slotKey, {
      viewpoint: req.body?.viewpoint || 'inside',
      prompt: req.body?.prompt,
    });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/slots/:slotKey/variants/use', (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    res.json(
      useImageSlotVariant(req.params.id, req.params.slotKey, {
        filename: req.body?.filename,
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/slots/:slotKey/use-group-file', (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    res.json(
      useGroupFileOnSlot(req.params.id, req.params.slotKey, {
        groupId: req.body?.groupId,
        filename: req.body?.filename,
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/logo/generate', async (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    const candidateId = req.params.id;
    const mode = req.body?.mode;
    const prompt = req.body?.prompt;
    const { jobId } = startLightJob({
      candidateId,
      phase: 'logo',
      label: 'Generate logo',
      progressTotal: 3,
      run: async ({ jobId: jid }) => {
        updateLightJobProgress(jid, { detail: 'Starting…', done: 1, total: 3 });
        updateLightJobProgress(jid, {
          detail: mode === 'monogram' ? 'Building SVG monogram…' : 'GPT Image 2…',
          done: 2,
          total: 3,
        });
        const result = await generateSiteLogo(candidateId, { mode, prompt });
        updateLightJobProgress(jid, {
          detail: result.path || result.logo?.src || 'Logo ready',
          done: 3,
          total: 3,
        });
        return result;
      },
    });
    const result = await waitForLightJob(jobId);
    res.json({ ...result, jobId });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/logo/variants/use', (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    res.json(useLogoVariant(req.params.id, req.body?.filename));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/coverage-map/generate', async (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    const candidateId = req.params.id;
    const { jobId } = startLightJob({
      candidateId,
      phase: 'coverage-map',
      label: 'Coverage map',
      run: async ({ jobId: jid }) =>
        generateCoverageMapForCandidate(candidateId, {
          labelPlacement: req.body?.labelPlacement,
          onProgress: (p) =>
            updateLightJobProgress(jid, {
              detail: p.detail || p.label || 'Generating coverage map…',
              done: p.current,
              total: p.total,
            }),
        }),
    });
    const result = await waitForLightJob(jobId);
    res.json({ ...result, jobId });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/coverage-map/variants/use', (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    res.json(useCoverageMapVariant(req.params.id, req.body?.filename));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/coverage-map/progress', (req, res) => {
  try {
    res.json(getCoverageMapProgress(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/images/before-after-prompts', (req, res) => {
  try {
    res.json(
      resolveBaPromptsWithOverride(req.params.id, {
        serviceSlug: req.query?.service || req.query?.serviceSlug || '',
        pairIndex: req.query?.pairIndex || 1,
        viewpoint: req.query?.viewpoint || 'inside',
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/before-after/openai-prompt', (req, res) => {
  try {
    res.json(
      saveBaOpenaiPrompt(req.params.id, {
        serviceSlug: req.body?.serviceSlug || req.body?.service || '',
        pairIndex: req.body?.pairIndex || 1,
        viewpoint: req.body?.viewpoint || 'inside',
        before: req.body?.before,
        after: req.body?.after,
        restore: Boolean(req.body?.restore),
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/images/before-after-status', (req, res) => {
  try {
    res.json({ ...listBeforeAfterStatus(req.params.id), openai: openaiImageStatus() });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/before-after-generate-openai', async (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    res.json(
      await generateCandidateBaPairOpenai(req.params.id, {
        viewpoint: req.body?.viewpoint || 'inside',
        serviceSlug: req.body?.serviceSlug || req.body?.service || '',
        pairIndex: req.body?.pairIndex || 1,
        before: req.body?.before,
        after: req.body?.after,
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/before-after/match-grade', (req, res) => {
  try {
    res.json(
      setBaPairMatchGrade(req.params.id, req.body?.matchKey || req.body?.key, req.body?.matchGrade),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/before-after/variants/use', (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    res.json(
      useCandidateBaVariant(req.params.id, {
        pairId: req.body?.pairId || req.body?.id,
        matchKey: req.body?.matchKey || '',
        serviceSlug: req.body?.serviceSlug || '',
        pairIndex: req.body?.pairIndex || 1,
        beforeFilename: req.body?.beforeFilename || '',
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/before-after/use-group-pair', (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    res.json(
      useGroupBaPairOnSlot(req.params.id, req.body?.matchKey || req.body?.key || '', {
        groupId: req.body?.groupId,
        beforeFilename: req.body?.beforeFilename,
        afterFilename: req.body?.afterFilename,
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/images/before-after-import', (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
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
    assertLaunchedEditAllowed(req.params.id, body);
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
    assertLaunchedEditAllowed(req.params.id, req.body || {});
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
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    const raw = req.body?.json ?? req.body?.text ?? req.body;
    res.json(pasteContentOutlinePackage(req.params.id, raw));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/structure/confirm', async (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    res.json(await confirmContentOutline(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/structure/write-prompt', async (req, res) => {
  try {
    const batch = String(req.query.batch || 'all').toLowerCase();
    const built =
      batch && batch !== 'all'
        ? await buildBatchedFullWritePrompt(req.params.id, batch)
        : await buildFullWritePrompt(req.params.id);
    res.json({
      prompt: built.prompt || '',
      batch: built.batch || batch || 'all',
      requiredFileCount: built.requiredFileCount ?? 0,
      batchFiles: built.batchFiles || [],
    });
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

app.get('/api/candidates/:id/content/field-research/prompt', async (req, res) => {
  try {
    res.json(
      await buildFieldResearchPrompt(req.params.id, {
        operatorNotes: req.query.notes || '',
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/field-research', (req, res) => {
  try {
    const fieldResearch = getContentFieldResearch(req.params.id);
    if (!fieldResearch) return res.status(404).json({ error: 'No field research' });
    res.json({ fieldResearch });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/field-research', (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    const raw = req.body?.json ?? req.body?.text ?? req.body;
    res.json(
      saveContentFieldResearch(req.params.id, raw, {
        operatorNotes: req.body?.operatorNotes || '',
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/soft-brief/prompt', async (req, res) => {
  try {
    res.json(
      await buildSoftBriefPrompt(req.params.id, {
        operatorNotes: req.query.notes || '',
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/soft-brief/confirm', (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    const raw = req.body?.json ?? req.body?.text ?? req.body;
    res.json(pasteAndConfirmSoftBrief(req.params.id, raw));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/final-check/prompt', async (req, res) => {
  try {
    res.json(await buildFinalCheckPrompt(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/final-check', (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    const raw = req.body?.json ?? req.body?.text ?? req.body?.paste ?? '';
    const text = typeof raw === 'string' ? raw.trim() : '';

    // Prefer OK JSON (fenced Claude paste OK via parseJsonLoose)
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.ok === true) {
      return res.json(
        stampFinalCheck(req.params.id, { ok: true, summary: raw.summary || '' }),
      );
    }
    if (text && (text.startsWith('{') || text.includes('"ok"'))) {
      const parsed = parseJsonLoose(text);
      if (parsed.ok && parsed.value && typeof parsed.value === 'object' && parsed.value.ok === true) {
        return res.json(
          stampFinalCheck(req.params.id, {
            ok: true,
            summary: parsed.value.summary || '',
          }),
        );
      }
    }

    if (text.includes('### FILE:')) {
      const pasted = pasteAgentContentDraft(req.params.id, text, { mode: 'full' });
      const stamped = stampFinalCheck(req.params.id, {
        ok: true,
        summary: 'FILE fixes loaded',
      });
      syncWriteBatchesFromDraft(req.params.id);
      return res.json({
        ...pasted,
        finalCheck: true,
        candidate: stamped.candidate || getCandidateShell(req.params.id),
      });
    }

    const err = new Error(
      'Final check needs {"ok":true} JSON or ### FILE: fix blocks — paste Claude’s result and Load again.',
    );
    err.status = 400;
    throw err;
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/images-prompt', (req, res) => {
  try {
    res.json(buildImageQueriesPrompt(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/images-plan', (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    const raw = req.body?.json ?? req.body?.text ?? req.body?.paste ?? req.body;
    res.json(saveImagesPlan(req.params.id, raw));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/write-batches/sync', (req, res) => {
  try {
    res.json(syncWriteBatchesFromDraft(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/content/write-batches', (req, res) => {
  try {
    res.json(getWriteBatchStatus(req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/write-batches/:batch', (req, res) => {
  try {
    res.json(markWriteBatchComplete(req.params.id, req.params.batch));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/content/write-site', (req, res) => {
  try {
    const candidateId = req.params.id;
    assertLaunchedEditAllowed(candidateId, req.body || {});
    requireAnthropicKey();
    assertWriteSiteReady(candidateId);

    assertWriteSiteStartAllowed(candidateId);

    const photosOn = Boolean(
      Object.values(getCandidateDetail(candidateId)?.contentStructure?.photos || {}).some(
        (p) => p && p.enabled,
      ),
    );
    const { jobId } = startLightJob({
      candidateId,
      phase: 'write-site',
      label: 'Write site',
      progressTotal: photosOn ? 5 : 4,
      run: async ({ jobId: jid, signal }) => runWriteSiteJob(candidateId, { jobId: jid, signal }),
    });
    res.status(202).json({ jobId, accepted: true });
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
    const staged = await stageSiteInWorker(req.params.id, {
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

app.get('/api/candidates/:id/launch-content-gaps', (req, res) => {
  try {
    res.json(getLaunchContentGapsForCandidate(req.params.id));
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
    const candidateId = req.params.id;

    const payload = await enqueueHeavyJob({
      candidateId,
      phase: 'assemble',
      label: 'Assemble',
      run: async ({ jobId }) => {
        const ASSEMBLE_TOTAL = 4;
        const tick = (done, detail) =>
          updateJobProgress(jobId, { detail, done, total: ASSEMBLE_TOTAL });

        const prior = getCandidateDetail(candidateId);
        const rel = prior.meta?.assembledSitePath;
        tick(1, 'Stopping prior preview…');
        if (rel) {
          const abs = path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);
          try {
            await stopAssembledPreview(abs, { forcePoolClear: false });
          } catch {
            /* ignore */
          }
        }

        const plan = planAssembleReplace(candidateId, {
          force,
          refresh,
          siteSlug,
        });
        tick(2, plan.sideBySide ? 'Assembling into new folder…' : 'Assembling…');
        const result = await assembleSiteInWorker(candidateId, {
          force,
          refresh,
          skipGit,
          siteSlug,
        });
        if (result.previousSiteRoot) {
          await finalizePreviousAssembledSite(result.previousSiteRoot);
        }

        let build = null;
        if (doBuild && result.absoluteSiteRoot) {
          const needsBuild =
            result.mode === 'full' ||
            contentNewerThanDist(result.absoluteSiteRoot, { ignoreAssembleMeta: true });
          if (!needsBuild) {
            tick(3, 'Build skipped');
            build = {
              ok: true,
              built: true,
              buildSkipped: true,
              npmInstallSkipped: true,
              ms: 0,
              siteRoot: result.absoluteSiteRoot,
            };
          } else {
            tick(3, 'Building…');
            try {
              build = await buildAssembledSiteAsync(result.absoluteSiteRoot);
            } catch (error) {
              build = { ok: false, error: error.message, buildSkipped: false };
            }
          }
        } else {
          tick(3, 'Build skipped');
        }

        let ship = null;
        const canShip = Boolean(ghAuthStatus()) && cloudflareConfigured();
        if (wantShip && canShip && build?.ok && result.absoluteSiteRoot) {
          tick(4, 'Shipping…');
          try {
            ship = await shipAssembledSite(candidateId, {
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
          tick(4, 'Ship skipped');
          ship = {
            skipped: true,
            reason: 'Set gh auth login + CLOUDFLARE_* (and GITHUB_OWNER) to auto-ship after assemble',
          };
        } else {
          tick(4, 'Ship skipped');
        }

        return {
          ...result,
          build,
          ship,
          candidate: getCandidateShell(candidateId),
        };
      },
    });

    res.json(payload);
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
    const candidateId = req.params.id;
    const detail = getCandidateDetail(candidateId);
    const rel = detail.meta?.assembledSitePath;
    if (!rel) {
      return res.status(400).json({ error: 'Assemble the site first' });
    }
    const abs = path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);
    const rebuild = Boolean(req.body?.rebuild);
    const forceRebind = req.body?.forceRebind !== false;

    const preview = await enqueueHeavyJob({
      candidateId,
      phase: 'preview',
      label: 'Preview',
      run: async ({ jobId }) => {
        const PREVIEW_TOTAL = 2;
        updateJobProgress(jobId, { detail: 'Starting preview…', done: 1, total: PREVIEW_TOTAL });
        const result = await ensureAssembledPreview(abs, { rebuild, forceRebind });
        updateJobProgress(jobId, { detail: 'Ready', done: 2, total: PREVIEW_TOTAL });
        return {
          ...result,
          assembledSitePath: abs,
          kind: 'assembled',
          candidateId,
        };
      },
    });

    res.json(preview);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/prepare-preview', async (req, res) => {
  try {
    const candidateId = req.params.id;
    const body = req.body || {};
    assertLaunchedEditAllowed(candidateId, body);
    const forcePrepare = Boolean(body.forcePrepare);
    if (!forcePrepare) {
      const gaps = getLaunchContentGapsForCandidate(candidateId);
      if (!gaps.ok) {
        return res.status(400).json({
          error: gaps.error || `${candidateId}: Content not launch-ready`,
          check: gaps,
        });
      }
    }

    const { jobId } = startHeavyJob({
      candidateId,
      phase: 'prepare',
      label: 'Prepare preview',
      run: async ({ jobId: jid }) => {
        const PREPARE_TOTAL = 5;
        const tick = (done, detail) =>
          updateJobProgress(jid, { detail, done, total: PREPARE_TOTAL });

        tick(1, 'Staging…');
        const staged = await stageSiteInWorker(candidateId, {
          mode: 'full',
          refreshPackage: true,
        });

        const plan = planAssembleReplace(candidateId, {
          force: false,
          refresh: true,
        });
        const prior = getCandidateDetail(candidateId);
        const rel = prior.meta?.assembledSitePath;
        tick(2, 'Stopping prior preview…');
        if (rel) {
          const absPrior = path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);
          try {
            await stopAssembledPreview(absPrior, { forcePoolClear: false });
          } catch {
            /* ignore */
          }
        }

        tick(3, plan.sideBySide ? 'Assembling into new folder…' : 'Assembling…');
        const result = await assembleSiteInWorker(candidateId, {
          force: false,
          refresh: true,
          skipGit: false,
        });
        if (result.previousSiteRoot) {
          await finalizePreviousAssembledSite(result.previousSiteRoot);
        }

        if (result.absoluteSiteRoot) {
          try {
            upsertNicheMaster(candidateId);
          } catch (masterErr) {
            console.warn(
              `[prepare] ${candidateId} niche master upsert skipped:`,
              masterErr.message || masterErr,
            );
          }
        }

        let build = null;
        if (result.absoluteSiteRoot) {
          const needsBuild =
            result.mode === 'full' ||
            contentNewerThanDist(result.absoluteSiteRoot, { ignoreAssembleMeta: true });
          if (!needsBuild) {
            tick(4, 'Build skipped');
            build = {
              ok: true,
              built: true,
              buildSkipped: true,
              npmInstallSkipped: true,
              ms: 0,
              siteRoot: result.absoluteSiteRoot,
            };
          } else {
            tick(4, 'Building…');
            try {
              build = await buildAssembledSiteAsync(result.absoluteSiteRoot);
            } catch (error) {
              build = { ok: false, error: error.message, buildSkipped: false };
            }
          }
        }

        let preview = null;
        if (result.absoluteSiteRoot && build?.ok !== false) {
          tick(5, 'Starting preview…');
          preview = await ensureAssembledPreview(result.absoluteSiteRoot, {
            rebuild: false,
            forceRebind: true,
          });
        } else if (result.absoluteSiteRoot) {
          preview = {
            ok: false,
            error: build?.error || 'Build failed — preview not started',
            assembledSitePath: result.absoluteSiteRoot,
          };
        }

        return {
          ...result,
          staged: {
            written: staged.written,
            serviceCount: staged.serviceCount,
            locationCount: staged.locationCount,
          },
          build,
          preview,
          ship: null,
          candidate: getCandidateShell(candidateId),
        };
      },
    });

    res.status(202).json({ jobId, accepted: true });
  } catch (error) {
    if (error.checklist || error.contract || error.check) {
      return res.status(error.status || 500).json({
        error: error.message,
        checklist: error.checklist || null,
        contract: error.contract || null,
        check: error.check || null,
        siteRoot: error.siteRoot || null,
      });
    }
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/revert-launched', async (req, res) => {
  try {
    const result = await restoreLaunchedFromGithub(req.params.id, {
      confirmRevert: Boolean(req.body?.confirmRevert),
    });
    res.json(result);
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
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    res.json(applyVisualEditPatches(req.params.id, req.body?.patches || []));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/visual-edit/image', (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    res.json(uploadVisualEditImage(req.params.id, req.body || {}));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/visual-edit/preview', async (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
    const result = req.body?.smart
      ? await ensureVisualEditPreviewReady(req.params.id)
      : await refreshVisualEditPreview(req.params.id, {
          rebuild: req.body?.rebuild !== false,
        });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/candidates/:id/visual-edit/publish', async (req, res) => {
  try {
    assertLaunchedEditAllowed(req.params.id, req.body || {});
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
    const candidateId = req.params.id;
    const planned = listLaunchProgressSteps({
      ship: body.ship !== false,
      skipGithub: Boolean(body.skipGithub),
      skipBuild: Boolean(body.skipBuild),
      skipDeploy: Boolean(body.skipDeploy),
      skipBuildsConnect: Boolean(body.skipBuildsConnect),
      runCloudflare: body.runCloudflare !== false,
    });
    const total = planned.length || 1;
    const { jobId } = startHeavyJob({
      candidateId,
      phase: 'launch',
      label: 'Launch',
      run: async ({ jobId: jid }) => {
        const out = await launchSite(candidateId, {
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
          allowIncompleteLaunch: body.allowIncompleteLaunch === true,
          onProgress: (p) => updateJobProgress(jid, p),
        });
        const site = out.site || upsertSiteAfterLaunch(candidateId);
        return {
          ...out,
          site,
          candidate: getCandidateShell(candidateId),
          cloudflareConfigured: cloudflareConfigured(),
        };
      },
    });
    updateJobProgress(jobId, { detail: 'Queued…', done: 0, total });
    res.status(202).json({ jobId, accepted: true });
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
    const sites = attachMetricsToSites(listLaunchedSites());
    res.json({
      sites,
      statuses: SITE_STATUSES,
      paymentMethods: PAYMENT_METHODS,
      billingCycles: BILLING_CYCLES,
      gsc: getGscAuthStatus(),
      portfolio: {
        traffic: portfolioTrafficSeries(sites),
        ranks: portfolioRankSeries(sites),
      },
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
    const site = createManualSite(body);
    res.json({ site: attachMetricsToSites([site])[0] });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/sites/:id', (req, res) => {
  try {
    const site = attachMetricsToSites([getSite(req.params.id)])[0];
    res.json({ site, metrics: loadSiteMetrics(req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/gsc/status', (_req, res) => {
  try {
    res.json(getGscAuthStatus());
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/gsc/oauth/start', (_req, res) => {
  try {
    const started = startGscOAuth({ port: PORT });
    res.json(started);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/gsc/oauth/callback', async (req, res) => {
  try {
    const { code, state, error, error_description: errorDescription } = req.query || {};
    if (error) {
      return res
        .status(400)
        .type('html')
        .send(
          `<!doctype html><meta charset="utf-8"><title>GSC connect failed</title>
           <p>Google returned: ${String(errorDescription || error)}</p>
           <p><a href="/">Back to Rover</a></p>`,
        );
    }
    await completeGscOAuth({ code: String(code || ''), state: String(state || '') });
    res
      .type('html')
      .send(
        `<!doctype html><meta charset="utf-8"><title>GSC connected</title>
         <p>Google Search Console connected. You can close this tab.</p>
         <script>
           try { if (window.opener) window.opener.postMessage({ type: 'rover-gsc-connected' }, '*'); } catch (e) {}
           setTimeout(function () { window.location.href = '/#launched-sites'; }, 800);
         </script>
         <p><a href="/#launched-sites">Open Launched Sites</a></p>`,
      );
  } catch (error) {
    res
      .status(error.status || 500)
      .type('html')
      .send(
        `<!doctype html><meta charset="utf-8"><title>GSC connect failed</title>
         <p>${String(error.message || error)}</p>
         <p><a href="/">Back to Rover</a></p>`,
      );
  }
});

app.post('/api/gsc/disconnect', (_req, res) => {
  try {
    res.json(disconnectGsc());
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/gsc/sync', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.siteId) {
      const result = await syncSiteGsc(String(body.siteId));
      return res.json(result);
    }
    const result = await syncAllSitesGsc({
      siteIds: Array.isArray(body.siteIds) ? body.siteIds : null,
    });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/sites/:id/rank-keywords', (req, res) => {
  try {
    const site = getSite(req.params.id);
    const metrics = setRankKeywords(req.params.id, req.body?.keywords, site);
    res.json({
      site: attachMetricsToSites([site])[0],
      metrics,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/sites/:id/rank-check', async (req, res) => {
  try {
    const result = await checkSiteRanks(req.params.id, {
      depth: Number(req.body?.depth) > 0 ? Number(req.body.depth) : 20,
    });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/ranks/sync', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await checkAllSiteRanks({
      siteIds: Array.isArray(body.siteIds) ? body.siteIds : null,
      depth: Number(body.depth) > 0 ? Number(body.depth) : 20,
    });
    res.json(result);
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
    let updated;
    try {
      updated = setSitePhoneTracking(site.id, provisioned.phoneTracking);
    } catch (trackError) {
      try {
        updated = setSitePhoneTracking(site.id, {
          ...provisioned.phoneTracking,
          phase: 'orphan',
          orphanReason: trackError.message || 'setSitePhoneTracking failed',
        });
      } catch {
        /* ignore */
      }
      throw Object.assign(
        new Error(
          `Number ${provisioned.e164} is live in Twilio (SID ${provisioned.twilioSid}) and site-config was updated, but portfolio tracking failed: ${trackError.message}. Do not buy again — fix tracking or record SID ${provisioned.twilioSid} manually.`,
        ),
        {
          status: 500,
          twilioSid: provisioned.twilioSid,
          e164: provisioned.e164,
          code: 'TWILIO_TRACKING_FAILED',
          provisioned,
        },
      );
    }
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
    res.json({ meta, candidate: getCandidateShell(req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * Website → Indexing: persist Mark done (survives reload / re-select). Never auto-cleared.
 */
app.post('/api/candidates/:id/indexing/done', (req, res) => {
  try {
    const meta = saveMeta(req.params.id, {
      indexingDone: true,
      lastIndexingAt: new Date().toISOString(),
    });
    res.json({ meta, candidate: getCandidateShell(req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/candidates/:id/portfolio-site', (req, res) => {
  try {
    const site = getSiteByCandidateId(req.params.id);
    res.json({ site: site ? attachMetricsToSites([site])[0] : null });
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
    let updated;
    try {
      updated = setSitePhoneTracking(site.id, provisioned.phoneTracking);
    } catch (trackError) {
      try {
        updated = setSitePhoneTracking(site.id, {
          ...provisioned.phoneTracking,
          phase: 'orphan',
          orphanReason: trackError.message || 'setSitePhoneTracking failed',
        });
      } catch {
        /* ignore */
      }
      throw Object.assign(
        new Error(
          `Number ${provisioned.e164} is live in Twilio (SID ${provisioned.twilioSid}) and site-config was updated, but portfolio tracking failed: ${trackError.message}. Do not buy again — fix tracking or record SID ${provisioned.twilioSid} manually.`,
        ),
        {
          status: 500,
          twilioSid: provisioned.twilioSid,
          e164: provisioned.e164,
          code: 'TWILIO_TRACKING_FAILED',
          provisioned,
        },
      );
    }
    saveMeta(req.params.id, { lastPhoneAt: new Date().toISOString() });
    res.json({
      site: updated,
      provisioned,
      candidate: getCandidateShell(req.params.id),
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
    const { webStream, contentType, contentLength } = await getRecordingStream(req.params.id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (!webStream) {
      const err = new Error('Empty recording stream');
      err.status = 502;
      throw err;
    }
    await pipeline(Readable.fromWeb(webStream), res);
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
    const candidateId = req.params.id;
    const result = await enqueueHeavyJob({
      candidateId,
      phase: 'ship',
      label: 'Push / ship',
      run: ({ jobId }) =>
        shipAssembledSite(candidateId, {
          skipGithub: Boolean(body.skipGithub),
          skipBuild: Boolean(body.skipBuild),
          skipDeploy: Boolean(body.skipDeploy),
          skipBuildsConnect: Boolean(body.skipBuildsConnect),
          onProgress: (p) => updateJobProgress(jobId, p),
        }),
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
    assertEvalPrerequisite(req.params.id, 'narrative');
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
    res.json({ meta, candidate: getCandidateShell(req.params.id) });
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

const server = app.listen(PORT, HOST, () => {
  console.log(`Rover dashboard: http://${HOST}:${PORT}`);
  console.log('Local only — do not expose this port publicly.');
  console.log(
    `DataForSEO: ${process.env.DATAFORSEO_LOGIN ? 'configured' : 'missing'} · Anthropic: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'missing'} · GSC OAuth: ${process.env.GOOGLE_GSC_CLIENT_ID && process.env.GOOGLE_GSC_CLIENT_SECRET ? 'configured' : 'missing'}`,
  );
  try {
    const r = migrateDecisionsToScoreModel();
    console.log(
      `Decision migrate (score model): candidates ${r.candidates}, batches ${r.discoveryBatches}, tracked ${r.tracked}`,
    );
  } catch (err) {
    console.warn('Decision migrate skipped:', err.message || err);
  }
});
server.requestTimeout = 30 * 60 * 1000;
server.headersTimeout = 31 * 60 * 1000;

let roverShuttingDown = false;
async function shutdownRover() {
  if (roverShuttingDown) return;
  roverShuttingDown = true;
  try {
    await stopAstroPreview();
  } catch {
    /* ignore */
  }
  try {
    await stopAssembledPreview();
  } catch {
    /* ignore */
  }
  await new Promise((resolve) => {
    server.close(() => resolve());
    setTimeout(resolve, 2500).unref?.();
  });
  process.exit(0);
}
process.on('SIGINT', () => {
  shutdownRover();
});
process.on('SIGTERM', () => {
  shutdownRover();
});
