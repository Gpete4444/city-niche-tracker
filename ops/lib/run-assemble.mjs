#!/usr/bin/env node
/**
 * CLI: npm run assemble-site -- <candidateId> [--force]
 */
import { assembleSite, getAssembleChecklist } from './assemble-site.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const skipGit = args.includes('--skip-git');
const id = args.find((a) => !a.startsWith('--'));

if (!id) {
  console.error('Usage: npm run assemble-site -- <candidateId> [--force] [--skip-git]');
  process.exit(1);
}

try {
  const result = assembleSite(id, { force, skipGit });
  console.log(JSON.stringify({ ok: true, ...result, candidate: undefined }, null, 2));
  console.log('\nChecklist:');
  for (const step of result.checklist.steps) {
    console.log(`  ${step.done ? '✓' : '○'} ${step.label}`);
  }
} catch (err) {
  console.error(err.message);
  if (err.checklist) {
    for (const step of err.checklist.steps) {
      console.error(`  ${step.done ? '✓' : '○'} ${step.label}`);
    }
  }
  process.exit(1);
}
