#!/usr/bin/env node
/**
 * Offline Structural Openness rescore for existing Stage 1 research JSON.
 * Recomputes competition (Openness), proposedScore, and decision from stored SERP.
 * Does not call DataForSEO / Ads. Preserves volumes, Map Pack, enrich displaceability, jobValue.
 *
 * Usage:
 *   npm run rescore-openness
 *   npm run rescore-openness -- --dry-run
 *   npm run rescore-openness -- --id bellevue-egress-window-installation
 */

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listCandidates, pathsFor } from '../ops/lib/candidates.mjs';
import { enrichClassifiedSerp } from './lib/serp-signals.mjs';
import {
  attachPreservedJobFields,
  buildResearchScoring,
  resolvePreservedJobFields,
  stageOneSoftnessInputs,
} from './lib/scoring.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { dryRun: false, id: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--id' && argv[i + 1]) {
      out.id = String(argv[++i]).trim();
    }
  }
  return out;
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function rescoreCandidate(id, { dryRun = false } = {}) {
  const p = pathsFor(id);
  const research = readJson(p.research);
  if (!research) {
    return { id, status: 'skipped', reason: 'no research file' };
  }
  if (!research.serp || typeof research.serp !== 'object') {
    return { id, status: 'skipped', reason: 'no serp' };
  }

  const niche = research.niche || readJson(p.config)?.niche || null;
  const priorCompetition = research.scoring?.scoreInputs?.competition ?? null;
  const priorProposed = research.proposedScore ?? research.scoring?.proposedScore ?? null;

  let serp = research.serp;
  try {
    serp = enrichClassifiedSerp(serp, {
      niche,
      itemTypes: research.serpItemTypes || research.serp?.itemTypes || [],
      items: research.serpItems || research.serp?.items || [],
    });
  } catch (error) {
    return { id, status: 'failed', reason: `enrichClassifiedSerp: ${error.message}` };
  }

  const softness = stageOneSoftnessInputs(serp);
  const displaceability = research.enrichment?.displaceability || null;
  const clusterVolumeSum = research.volumes?.clusterVolumeSum ?? 0;
  const primaryVolumeSum = research.volumes?.primaryVolumeSum ?? null;

  let scoring;
  try {
    scoring = buildResearchScoring({
      clusterVolumeSum,
      primaryVolumeSum,
      suburbOverlapFactor:
        research.volumes?.suburbOverlapFactor ?? research.scoring?.suburbOverlapFactor ?? null,
      mapPackPresent: Boolean(serp.mapPackPresent),
      classifiedSerp: serp,
      softnessUniqueOrganicDomainCount: softness.uniqueOrganicDomainCount,
      softnessOrganicHomePageCount: softness.organicHomePageCount,
      displaceability,
    });
    if (research.volumes && typeof research.volumes === 'object') {
      const demandVolumeSum = scoring.demandBand?.demandVolumeSum;
      if (demandVolumeSum != null) {
        research.volumes.demandVolumeSum = demandVolumeSum;
        research.volumes.suburbOverlapFactor =
          scoring.suburbOverlapFactor ?? research.volumes.suburbOverlapFactor;
      }
    }
  } catch (error) {
    return { id, status: 'failed', reason: `buildResearchScoring: ${error.message}` };
  }

  const iso = new Date().toISOString();
  const note = `Openness rescored (rubric v${scoring.rubricVersion}) at ${iso}.`;
  scoring.scoreInputs.notes = [scoring.scoreInputs.notes, note].filter(Boolean).join(' ');

  const narrative = readJson(p.narrative);
  let next = {
    ...research,
    serp,
    scoring,
    scoreInputs: scoring.scoreInputs,
    proposedScore: scoring.proposedScore,
    decision: scoring.decision,
  };
  const jobFields = resolvePreservedJobFields({ priorResearch: research, narrative });
  next = attachPreservedJobFields(next, jobFields);

  if (dryRun) {
    return {
      id,
      status: 'dry-run',
      priorCompetition,
      competition: next.scoring?.scoreInputs?.competition ?? null,
      priorProposed,
      proposedScore: next.proposedScore ?? null,
      rubricVersion: next.scoring?.rubricVersion ?? null,
    };
  }

  writeFileSync(p.research, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return {
    id,
    status: 'updated',
    priorCompetition,
    competition: next.scoring?.scoreInputs?.competition ?? null,
    priorProposed,
    proposedScore: next.proposedScore ?? null,
    rubricVersion: next.scoring?.rubricVersion ?? null,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const all = listCandidates().map((c) => c.id);
  const ids = args.id ? all.filter((id) => id === args.id) : all;
  if (args.id && !ids.length) {
    console.error(`No candidate matching --id ${args.id}`);
    process.exit(1);
  }

  console.error(
    `Rescoring Openness for ${ids.length} candidate(s)${args.dryRun ? ' (dry-run)' : ''}…`,
  );

  const summary = { updated: 0, skipped: 0, failed: 0, dryRun: 0 };
  for (const id of ids) {
    const result = rescoreCandidate(id, { dryRun: args.dryRun });
    if (result.status === 'updated') summary.updated += 1;
    else if (result.status === 'dry-run') summary.dryRun += 1;
    else if (result.status === 'skipped') summary.skipped += 1;
    else summary.failed += 1;

    const comp =
      result.competition != null
        ? `competition ${result.priorCompetition ?? '—'} → ${result.competition}`
        : result.reason || '';
    console.error(`[${result.status}] ${id}${comp ? ` · ${comp}` : ''}`);
  }

  console.error(
    `Done. updated=${summary.updated} dry-run=${summary.dryRun} skipped=${summary.skipped} failed=${summary.failed}`,
  );
  if (summary.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
