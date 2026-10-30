/**
 * One residential + commercial name list per niche.
 * Run: node scripts/test-niche-service-lists.mjs
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  backfillStoredServiceNameTitleCase,
  buildNicheServiceList,
  getNicheServiceList,
  normalizeServiceNameList,
  saveNicheServiceList,
  visibleServiceNames,
} from '../ops/lib/niche-service-lists.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

const dir = mkdtempSync(path.join(tmpdir(), 'niche-svc-'));
const file = path.join(dir, 'lists.json');

assertEqual(
  normalizeServiceNameList([
    'Texture matching (knockdown, orange peel, popcorn)',
    'Drywall patching and hole repair',
    'Water damage drywall replacement',
    'Commercial drywall patching',
    'Nail Pop and Seam Crack Repair',
    'hvac tune up',
    'McKay plumbing',
  ]).join(' | '),
  [
    'Texture Matching (Knockdown, Orange Peel, Popcorn)',
    'Drywall Patching And Hole Repair',
    'Water Damage Drywall Replacement',
    'Commercial Drywall Patching',
    'Nail Pop And Seam Crack Repair',
    'HVAC Tune Up',
    'McKay Plumbing',
  ].join(' | '),
  'service names title-case on normalize',
);

try {
  const names = Array.from({ length: 13 }, (_, i) => `Service ${i + 1}`);
  names.splice(2, 0, 'service 1');
  const saved = saveNicheServiceList(
    {
      niche: 'artificial turf',
      services: names,
      commercialServices: ['Sports Fields', 'sports fields', ''],
    },
    file,
  );
  assertEqual(saved.niche, 'Artificial Turf', 'stored niche label');
  assertEqual(saved.services.length, 12, 'cap 12');
  assertEqual(saved.services[0], 'Service 1', 'first name kept');
  assert(!saved.services.some((n) => n === 'service 1'), 'case-insensitive dedupe');
  assertEqual(saved.commercialServices.length, 1, 'commercial dedupe');
  assertEqual(saved.commercialServices[0], 'Sports Fields', 'commercial first spelling');

  const loaded = getNicheServiceList('Artificial Turf', file);
  assertEqual(loaded.services.length, 12, 'lookup by title case');
  assertEqual(getNicheServiceList('ARTIFICIAL TURF', file).niche, 'Artificial Turf', 'lookup ignores case');
  assertEqual(getNicheServiceList('Concrete Lifting', file), null, 'other niche stays empty');

  let threw = false;
  try {
    saveNicheServiceList({ niche: 'Artificial Turf', services: [], commercialServices: ['Only commercial'] }, file);
  } catch (error) {
    threw = error.status === 400;
  }
  assert(threw, 'empty residential rejected');
  assertEqual(getNicheServiceList('Artificial Turf', file).services.length, 12, 'rejected save leaves the list');

  const emptyCommercial = saveNicheServiceList(
    { niche: 'Concrete Lifting', services: ['Slab'], commercialServices: [] },
    file,
  );
  assertEqual(emptyCommercial.commercialServices.length, 0, 'commercial may be empty');
  assertEqual(getNicheServiceList('Artificial Turf', file).services[0], 'Service 1', 'other niche unchanged');

  const fillers = Array.from({ length: 9 }, (_, i) => `Filler ${i + 1}`);
  const built = buildNicheServiceList('artificial turf', [
    {
      niche: 'Artificial Turf',
      services: ['Shared Top', ...fillers, 'Bottom Once', 'Extra', 'Dropped Thirteenth'],
      commercialServices: ['Sports Field'],
    },
    {
      niche: 'artificial turf',
      services: ['Shared Top', 'Playground'],
      commercialServices: ['HOA', 'Sports Field'],
    },
    { niche: 'Concrete Lifting', services: ['Slab'], commercialServices: [] },
  ]);
  assertEqual(built.cityCount, 2, 'other niche ignored');
  assertEqual(built.niche, 'Artificial Turf', 'built niche label');
  assertEqual(built.services[0], 'Shared Top', 'position 1 on both cities ranks first');
  assert(built.services.includes('Bottom Once'), 'one-city bottom name stays in the cap');
  assert(built.services.indexOf('Shared Top') < built.services.indexOf('Bottom Once'), 'top beats a one-city bottom name');
  assert(!built.services.includes('Dropped Thirteenth'), 'each city list caps at 12');
  assert(built.services.includes('Extra'), 'name past the old 12 stays in rank order');
  assertEqual(built.services.length, 13, 'master keeps the overflow name');
  const windowed = visibleServiceNames(built.services, [], 12);
  assertEqual(windowed.length, 12, 'dialog shows 12');
  assert(!windowed.includes('Extra'), '13th name waits outside the window');
  const bumped = visibleServiceNames(built.services, ['Shared Top'], 12);
  assertEqual(bumped.length, 12, 'remove keeps a 12-name window');
  assertEqual(bumped[0], 'Filler 1', 'next ranked name moves up');
  assert(!bumped.includes('Shared Top'), 'removed name leaves the window');
  assert(bumped.includes('Extra'), 'former 13th name fills the last slot');
  assertEqual(built.commercialServices[0], 'Sports Field', 'commercial seen first on more cities ranks first');
  assert(!built.services.includes('Slab'), 'other niche names stay out');
  assertEqual(built.siteCount, 2, 'site lists counted');
  assertEqual(built.researchCount, 0, 'no research ballots');

  const fromResearch = buildNicheServiceList('artificial turf', [
    { niche: 'Artificial Turf', suggestedServices: ['Pet turf', 'Commercial turf'] },
    { niche: 'Artificial Turf', suggestedServices: 'Only Research, Commercial turf' },
  ]);
  assertEqual(fromResearch.cityCount, 2, 'cities with only research count');
  assertEqual(fromResearch.siteCount, 0, 'no site lists in research-only build');
  assertEqual(fromResearch.researchCount, 2, 'both cities are research suggestions');
  assert(fromResearch.services.includes('Pet Turf'), 'residential suggestion stays residential');
  assert(fromResearch.services.includes('Only Research'), 'comma-separated research city counts');
  assert(!fromResearch.services.includes('Commercial Turf'), 'commercial suggestion leaves residential');
  assertEqual(fromResearch.commercialServices[0], 'Commercial Turf', 'commercial suggestion lands on commercial');

  const researchWins = buildNicheServiceList('artificial turf', [
    { niche: 'Artificial Turf', suggestedServices: ['Research Shared'] },
    { niche: 'Artificial Turf', suggestedServices: ['Research Shared'] },
    { niche: 'Artificial Turf', services: ['Site Once'] },
  ]);
  assertEqual(researchWins.services[0], 'Research Shared', 'research name on two cities outranks one site-config name');
  assertEqual(researchWins.cityCount, 3, 'research-only cities count toward cityCount');
  assertEqual(researchWins.siteCount, 1, 'one site list');
  assertEqual(researchWins.researchCount, 2, 'two research suggestions');

  const once = buildNicheServiceList('artificial turf', [
    { niche: 'Artificial Turf', services: ['Winner'] },
    { niche: 'Artificial Turf', services: ['Winner'] },
    { niche: 'Artificial Turf', services: ['Dup'], suggestedServices: ['Dup', 'Extra Research'] },
  ]);
  assertEqual(once.services[0], 'Winner', 'same name on site-config and research scores once');
  assert(once.services.includes('Extra Research'), 'other research names still vote');
  assertEqual(once.researchCount, 1, 'duplicate-only names do not hide a real research ballot');

  const researchDir = path.join(dir, 'research');
  mkdirSync(researchDir);
  const draftPath = path.join(researchDir, 'demo-site-config.draft.json');
  const acceptedPath = path.join(researchDir, 'demo-site-config.json');
  const workingPath = path.join(dir, 'site-config.json');
  const stored = {
    services: ['Water damage drywall replacement', 'HVAC leak repair'],
    commercialServices: ['Commercial drywall patching'],
  };
  writeFileSync(draftPath, `${JSON.stringify(stored, null, 2)}\n`);
  writeFileSync(acceptedPath, `${JSON.stringify({ ...stored, services: ['McKay plumbing'] }, null, 2)}\n`);
  writeFileSync(workingPath, `${JSON.stringify({ services: ['Nail Pop and Seam Crack Repair'] }, null, 2)}\n`);
  writeFileSync(
    path.join(researchDir, '_niche-service-lists.json'),
    `${JSON.stringify({ lists: { 'drywall repair': { niche: 'Drywall Repair', services: ['Drywall patching and hole repair'], commercialServices: [] } } }, null, 2)}\n`,
  );
  const rewritten = backfillStoredServiceNameTitleCase({ researchDir, workingConfigPath: workingPath });
  assertEqual(rewritten.files, 4, 'backfill rewrites draft, accepted, working, and niche default');
  const draft = JSON.parse(readFileSync(draftPath, 'utf8'));
  assertEqual(draft.services[0], 'Water Damage Drywall Replacement', 'draft service title case');
  assertEqual(draft.services[1], 'HVAC Leak Repair', 'draft acronym stays upper');
  assertEqual(draft.commercialServices[0], 'Commercial Drywall Patching', 'draft commercial title case');
  const accepted = JSON.parse(readFileSync(acceptedPath, 'utf8'));
  assertEqual(accepted.services[0], 'McKay Plumbing', 'interior capital stays on backfill');
  const again = backfillStoredServiceNameTitleCase({ researchDir, workingConfigPath: workingPath });
  assertEqual(again.files, 0, 'backfill is a no-op once names are title case');

  console.log('test-niche-service-lists: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
