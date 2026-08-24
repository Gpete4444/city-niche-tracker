import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePrimarySerpScreen, V15_PACKAGE1_SCREEN_PARAMETERS } from '../ops/lib/v15-primary-serp-screen.mjs';

export const V15_PACKAGE1_SOURCE_BATCH = 'nc-sewer-line-replacement-trenchless-art-2026-08-21T23-07-18';
export const V15_PACKAGE1_EXPECTED_ROWS = 27;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseCsv(text) {
  const records = [];
  let record = [], cell = '', quoted = false;
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { record.push(cell); cell = ''; }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      record.push(cell); cell = '';
      if (record.some((value) => value !== '')) records.push(record);
      record = [];
    } else cell += character;
  }
  if (cell || record.length) { record.push(cell); records.push(record); }
  const [headers = [], ...rows] = records;
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function rowKey(row) {
  return [row.Niche, row.City, row.State].map((value) => String(value ?? '').trim().toLowerCase()).join('|');
}

function histogram(values) {
  return values.reduce((counts, value) => ({ ...counts, [value || '(blank)']: (counts[value || '(blank)'] ?? 0) + 1 }), {});
}

function renderMarkdown(report) {
  const lines = [
    '# Rover V1.5 Package 1 — $0 Primary-SERP Screen Replay', '',
    `- Source batch: ${report.sourceBatch}`, `- Total rows: ${report.totalRows}`,
    `- SCREEN_OUT: ${report.screenOutCount}`, `- SURVIVE: ${report.surviveCount}`,
    `- providerCalls: ${report.providerCalls}`, `- fixtureReusePercent: ${report.fixtureReusePercent}%`,
    `- minDistinctOrganicDomainsForB: ${report.parameters.minDistinctOrganicDomainsForB}`,
    `- minDistinctOrganicDomainsForC: ${report.parameters.minDistinctOrganicDomainsForC}`, '',
    '## Rule histogram', '', '```json', JSON.stringify(report.ruleHistogram, null, 2), '```', '',
    '## Original V1 recommendation histogram', '', '```json', JSON.stringify(report.originalV1RecommendationHistogram, null, 2), '```', '',
    '## Complete 27-row replay', '',
    '| City | State | Niche | V1 recommendation | Screen | Visible | Rule | Domains | Map | Paid | LSA | Homes | Subpages | Reason |',
    '| ---- | ----- | ----- | ----------------- | ------ | ------- | ---- | ------: | --- | ---- | --- | ----: | -------: | ------ |',
  ];
  for (const row of report.rows) lines.push(`| ${row.city} | ${row.state} | ${row.niche} | ${row.originalV1RecommendedDecision} | ${row.screenDecision} | ${row.visibleRecommendedDecision} | ${row.screenRule} | ${row.evidence.uniqueOrganicDomainCount} | ${row.evidence.mapPackPresent ? 'Yes' : 'No'} | ${row.evidence.paidPresent ? 'Yes' : 'No'} | ${row.evidence.lsaPresent ? 'Yes' : 'No'} | ${row.evidence.organicHomePageCount} | ${row.evidence.organicSubPageCount} | ${row.screenReason} |`);
  lines.push('', '## Original deprioritize rows that now SURVIVE', '', ...report.originalDeprioritizeNowSurvive.map((row) => `- ${row.city}, ${row.state} — ${row.niche}`), '',
    '## SCREEN_OUT sewer rows', '', ...report.screenOutSewerRows.map((row) => `- ${row.city}, ${row.state} — Rule ${row.screenRule}: ${row.screenReason}`), '');
  return `${lines.join('\n')}\n`;
}

export async function runPackage1Replay({
  fixtureDir = path.join(repoRoot, 'test', 'fixtures', 'v15-package1'),
  outputDir = null,
  parameters = V15_PACKAGE1_SCREEN_PARAMETERS,
  expectedRows = V15_PACKAGE1_EXPECTED_ROWS,
} = {}) {
  const candidatesPath = path.join(fixtureDir, 'candidates.csv');
  const cacheDir = path.join(fixtureDir, 'serp-cache');
  const [candidateText, cacheEntries] = await Promise.all([fs.readFile(candidatesPath, 'utf8'), fs.readdir(cacheDir, { withFileTypes: true })]);
  const candidates = parseCsv(candidateText);
  const jsonNames = cacheEntries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name).sort();
  if (candidates.length !== expectedRows || jsonNames.length !== expectedRows) {
    throw new Error(`Package-1 fixture set incomplete: expected ${expectedRows} candidates and SERPs; found ${candidates.length} and ${jsonNames.length}`);
  }
  const candidatesByKey = new Map(candidates.map((row) => [rowKey(row), row]));
  const seenKeys = new Set();
  const replayRows = [];
  for (const name of jsonNames) {
    const saved = JSON.parse(await fs.readFile(path.join(cacheDir, name), 'utf8'));
    if (!saved.classified || !Array.isArray(saved.classified.uniqueOrganicDomains)) throw new Error(`Missing saved classified evidence: ${name}`);
    const candidate = candidatesByKey.get(String(saved.rowKey ?? '').toLowerCase());
    if (!candidate) throw new Error(`No candidates.csv row for saved SERP ${name}: ${saved.rowKey}`);
    if (seenKeys.has(saved.rowKey)) throw new Error(`Duplicate saved SERP row key: ${saved.rowKey}`);
    seenKeys.add(saved.rowKey);
    const screen = evaluatePrimarySerpScreen({ classified: saved.classified, rawItems: saved.items ?? [] }, parameters);
    replayRows.push({
      rowIndex: saved.rowIndex,
      city: candidate.City,
      state: candidate.State,
      niche: candidate.Niche,
      originalV1RecommendedDecision: candidate.recommended_decision || '(blank)',
      screenDecision: screen.screenDecision,
      visibleRecommendedDecision: screen.visibleRecommendedDecision,
      screenRule: screen.screenRule,
      screenReason: screen.screenReason,
      evidence: { ...screen.evidence, originalV1Recommendation: candidate.recommended_decision || '(blank)' },
    });
  }
  if (seenKeys.size !== candidatesByKey.size) throw new Error(`Package-1 fixture key mismatch: replayed ${seenKeys.size} of ${candidatesByKey.size} candidates`);
  replayRows.sort((left, right) => left.rowIndex - right.rowIndex);
  const report = {
    title: 'Rover V1.5 Package 1 — $0 Primary-SERP Screen Replay',
    sourceBatch: V15_PACKAGE1_SOURCE_BATCH,
    replayType: 'v15_package1_primary_serp_screen',
    parameters: { ...parameters },
    providerCalls: 0,
    fixtureReusePercent: 100,
    totalRows: replayRows.length,
    screenOutCount: replayRows.filter((row) => row.screenDecision === 'SCREEN_OUT').length,
    surviveCount: replayRows.filter((row) => row.screenDecision === 'SURVIVE').length,
    ruleHistogram: { A: 0, B: 0, C: 0, NONE: 0, ...histogram(replayRows.map((row) => row.screenRule)) },
    originalV1RecommendationHistogram: histogram(replayRows.map((row) => row.originalV1RecommendedDecision)),
    originalDeprioritizeNowSurvive: replayRows.filter((row) => row.originalV1RecommendedDecision === 'deprioritize' && row.screenDecision === 'SURVIVE'),
    originalPassUnlessGbpNowSurvive: replayRows.filter((row) => row.originalV1RecommendedDecision === 'pass_unless_gbp_angle' && row.screenDecision === 'SURVIVE'),
    originalPursueNowSurvive: replayRows.filter((row) => row.originalV1RecommendedDecision === 'pursue' && row.screenDecision === 'SURVIVE'),
    screenOutSewerRows: replayRows.filter((row) => row.screenDecision === 'SCREEN_OUT' && /sewer line replacement/i.test(row.niche)),
    rows: replayRows,
  };
  if (outputDir) {
    await fs.mkdir(outputDir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`),
      fs.writeFile(path.join(outputDir, 'report.md'), renderMarkdown(report)),
      fs.writeFile(path.join(outputDir, 'rows.json'), `${JSON.stringify(replayRows, null, 2)}\n`),
    ]);
  }
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const outputArgIndex = process.argv.indexOf('--output-dir');

  const outputDir =
    outputArgIndex >= 0 &&
    String(process.argv[outputArgIndex + 1] || '').trim()
      ? path.resolve(process.argv[outputArgIndex + 1])
      : null;

  runPackage1Replay({ outputDir })
    .then((report) => {
      console.log(
        JSON.stringify(
          {
            outputDir,
            totalRows: report.totalRows,
            screenOutCount: report.screenOutCount,
            surviveCount: report.surviveCount,
            ruleHistogram: report.ruleHistogram,
            providerCalls: report.providerCalls,
            fixtureReusePercent: report.fixtureReusePercent,
          },
          null,
          2,
        ),
      );
    })
    .catch((error) => {
      console.error(error?.stack ?? error);
      process.exitCode = 1;
    });
}
