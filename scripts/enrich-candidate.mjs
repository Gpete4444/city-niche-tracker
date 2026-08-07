#!/usr/bin/env node
/**
 * Stage 2 enrichment: DataForSEO Rank + page heuristics + displaceability.
 *
 * Usage:
 *   npm run enrich-candidate -- --research research/louisville-trenchless.json
 *   npm run enrich-candidate -- --research research/louisville-trenchless.json --out research/louisville-trenchless.json
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from './lib/dataforseo.mjs';
import { enrichResearchReport } from './lib/enrich.mjs';

loadEnvFile();

function usage() {
  console.log(`Usage:
  npm run enrich-candidate -- --research research/louisville-trenchless.json
  npm run enrich-candidate -- --research research/out.json --out research/out-enriched.json

Reads Stage 1 research JSON; writes Rank, page thinness, displaceability, and rescored decision.
`);
}

function parseArgs(argv) {
  const args = { research: '', out: '', skipMapPack: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === '--research') {
      args.research = next;
      i += 1;
    } else if (flag === '--out') {
      args.out = next;
      i += 1;
    } else if (flag === '--skip-map-pack-pages') {
      args.skipMapPack = true;
    } else if (flag === '--help' || flag === '-h') {
      usage();
      process.exit(0);
    }
  }
  if (!args.research) {
    usage();
    process.exit(1);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const researchPath = path.resolve(args.research);
  const research = JSON.parse(readFileSync(researchPath, 'utf8'));
  const outPath = path.resolve(args.out || args.research);

  console.error(`Enriching ${researchPath}`);
  const { report, enrichCost } = await enrichResearchReport(research, {
    includeMapPackPages: !args.skipMapPack,
  });

  const json = `${JSON.stringify(report, null, 2)}\n`;
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, json, 'utf8');
  console.error(`Wrote ${outPath}`);
  console.error(
    `Displaceability: ${report.enrichment?.displaceability?.score ?? 'n/a'} (${report.enrichment?.displaceability?.band?.label ?? 'n/a'})`,
  );
  console.error(`Decision: ${report.decision?.decision} (${report.decision?.ruleId})`);
  console.error(`Stage 2 DataForSEO cost: $${enrichCost.toFixed(4)}`);
  process.stdout.write(json);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
