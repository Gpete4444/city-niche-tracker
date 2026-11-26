/**
 * Write upgraded photograph prompts for one Rover candidate.
 *
 * Dry run (default) prints the prompts and writes photo-prompt-app/out/<id>.json.
 * --apply sends them to Rover. Rover generates the images later, from Review images.
 *
 *   node photo-prompt-app/write-prompts.mjs --candidate <id> --objects photo-prompt-app/objects.example.txt
 *   node photo-prompt-app/write-prompts.mjs --candidate <id> --objects objects.txt --apply
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCandidateAllowed, buildBaPrompts, buildSlotPrompt, parseObjectList } from './lib/prompts.mjs';
import { loadCandidate, roverBase, saveBaPrompt, saveSlotPrompt } from './lib/rover-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {
    apply: false,
    allowGilbert: false,
    base: 'http://127.0.0.1:8787',
    viewpoint: 'inside',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--allow-gilbert') out.allowGilbert = true;
    else if (arg === '--candidate') out.candidate = argv[++i];
    else if (arg === '--objects') out.objects = argv[++i];
    else if (arg === '--base') out.base = argv[++i];
    else if (arg === '--viewpoint') out.viewpoint = argv[++i];
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!out.candidate) throw new Error('Pass --candidate <id>');
  if (!out.objects) throw new Error('Pass --objects <file> with one recognizable object per line');
  if (out.viewpoint !== 'inside' && out.viewpoint !== 'outside') {
    throw new Error('--viewpoint must be inside or outside');
  }
  return out;
}

function homeBaEnabled(structure) {
  const sections = Array.isArray(structure?.sections) ? structure.sections : [];
  return sections.includes('beforeAfter') || Boolean(structure?.photos?.beforeAfter?.enabled);
}

export function planPrompts({ slots, ba, structure, objects, viewpoint }) {
  const stills = (slots || []).map((slot) => ({
    kind: 'slot',
    key: slot.key,
    sectionId: slot.sectionId,
    label: slot.label,
    viewpoint,
    prompt: buildSlotPrompt(slot, objects),
  }));
  const pairs = [];
  if (homeBaEnabled(structure)) {
    const home = Array.isArray(ba?.homePairs) && ba.homePairs.length ? ba.homePairs : [{ pairIndex: 1 }];
    for (const row of home) {
      const built = buildBaPrompts('homepage gallery', objects, row.pairIndex || 1);
      pairs.push({
        kind: 'ba',
        key: `home:${row.pairIndex || 1}`,
        serviceSlug: '',
        pairIndex: row.pairIndex || 1,
        label: 'Homepage gallery before/after',
        viewpoint,
        ...built,
      });
    }
  }
  if (ba?.svcBeforeAfterEnabled) {
    for (const row of ba.services || []) {
      const built = buildBaPrompts(row.serviceName || row.slug, objects, 1);
      pairs.push({
        kind: 'ba',
        key: `svc:${row.slug}`,
        serviceSlug: row.slug,
        pairIndex: 1,
        label: row.serviceName || row.slug,
        viewpoint,
        ...built,
      });
    }
  }
  return { stills, pairs };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertCandidateAllowed(args.candidate, { allowGilbert: args.allowGilbert });
  const objects = parseObjectList(readFileSync(args.objects, 'utf8'));
  const base = roverBase(args.base);
  const loaded = await loadCandidate(base, args.candidate);
  if (!loaded.structure) {
    throw new Error('This candidate has no Structure yet. Finish Structure in Rover, then run again.');
  }
  if (!loaded.slots.length) {
    throw new Error('Structure has no photo slots. Turn photos on, then run again.');
  }
  const plan = planPrompts({
    slots: loaded.slots,
    ba: loaded.ba,
    structure: loaded.structure,
    objects,
    viewpoint: args.viewpoint,
  });
  const preview = {
    candidateId: loaded.id,
    niche: loaded.niche,
    viewpoint: args.viewpoint,
    objects,
    stills: plan.stills,
    pairs: plan.pairs,
  };
  const outDir = path.join(here, 'out');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${loaded.id}.json`);
  writeFileSync(outFile, `${JSON.stringify(preview, null, 2)}\n`, 'utf8');

  console.log(`${loaded.niche || loaded.id}: ${plan.stills.length} photos, ${plan.pairs.length} before/after pairs`);
  console.log(`Preview: ${outFile}`);
  for (const row of plan.stills) {
    console.log(`\n[${row.key}] ${row.label || ''}\n${row.prompt}`);
  }
  for (const row of plan.pairs) {
    console.log(`\n[${row.key} before]\n${row.before}\n[${row.key} after]\n${row.after}`);
  }

  if (!args.apply) {
    console.log('\nDry run only. Add --apply to write these prompts into Rover. Rover does not generate images until you use Review images.');
    return;
  }

  for (const row of plan.stills) {
    await saveSlotPrompt(base, loaded.id, row.key, { viewpoint: args.viewpoint, prompt: row.prompt });
    console.log(`Saved ${row.key}`);
  }
  for (const row of plan.pairs) {
    await saveBaPrompt(base, loaded.id, {
      serviceSlug: row.serviceSlug,
      pairIndex: row.pairIndex,
      viewpoint: args.viewpoint,
      before: row.before,
      after: row.after,
    });
    console.log(`Saved ${row.key}`);
  }
  console.log('\nPrompts are in Rover. Generate the photos from Website → Review images. Then save a named photo group.');
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
