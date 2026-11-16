/**
 * Niche title case on save.
 * Run: node scripts/test-niche-title-case.mjs
 */
import { existsSync } from 'node:fs';
import { titleCaseNiche, createCandidate, deleteCandidates, pathsFor } from '../ops/lib/candidates.mjs';
import { normalizeFilters, parseCsv } from '../ops/lib/discovery.mjs';

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

assertEqual(titleCaseNiche('artificial turf'), 'Artificial Turf', 'lowercase phrase');
assertEqual(titleCaseNiche('  artificial   turf '), 'Artificial Turf', 'collapsed space');
assertEqual(titleCaseNiche('in-ground pool'), 'In-Ground Pool', 'hyphen parts');
assertEqual(titleCaseNiche('hvac repair'), 'HVAC Repair', 'hvac acronym');
assertEqual(titleCaseNiche('ac repair'), 'AC Repair', 'ac acronym');
assertEqual(titleCaseNiche('HVAC Repair'), 'HVAC Repair', 'already-upper acronym');
assertEqual(
  titleCaseNiche('Trenchless Sewer Pipe Lining'),
  'Trenchless Sewer Pipe Lining',
  'already title case',
);
assertEqual(titleCaseNiche('McKay'), 'McKay', 'interior capital stays');
assertEqual(titleCaseNiche('USA'), 'USA', 'all-caps word stays');
assertEqual(titleCaseNiche('deck and patio'), 'Deck and Patio', 'small word stays lower');
assertEqual(titleCaseNiche('Artificial Turf'), 'Artificial Turf', 'idempotent');
assertEqual(
  titleCaseNiche('Texture matching (knockdown, orange peel, popcorn)'),
  'Texture Matching (Knockdown, Orange Peel, Popcorn)',
  'parenthesis words',
);
assertEqual(
  titleCaseNiche('Drywall patching and hole repair'),
  'Drywall Patching and Hole Repair',
  'and stays lower',
);
assertEqual(
  titleCaseNiche('Water damage drywall replacement'),
  'Water Damage Drywall Replacement',
  'sentence-case service',
);
assertEqual(
  titleCaseNiche('Commercial drywall patching'),
  'Commercial Drywall Patching',
  'commercial sentence case',
);
assertEqual(
  titleCaseNiche('Nail Pop and Seam Crack Repair'),
  'Nail Pop and Seam Crack Repair',
  'interior and stays lower',
);
assertEqual(
  titleCaseNiche('Piering And Underpinning'),
  'Piering and Underpinning',
  'stored And is lowered',
);
assertEqual(titleCaseNiche('McKay HVAC'), 'McKay HVAC', 'interior capital and acronym stay');

const filters = normalizeFilters({
  packType: 'cluster',
  shotgunNiche: 'artificial turf',
  requiredNiches: ['artificial turf', 'Artificial Turf'],
  niches: ['drywall repair'],
});
assertEqual(filters.shotgunNiche, 'Artificial Turf', 'shotgun niche');
assertEqual(filters.requiredNiches.length, 1, 'required niches deduped');
assertEqual(filters.requiredNiches[0], 'Artificial Turf', 'required niche');
assertEqual(filters.niches[0], 'Drywall Repair', 'suggested niche');

const rows = parseCsv('Niche,City,State\nartificial turf,el mirage,AZ\n');
assertEqual(rows[0].Niche, 'Artificial Turf', 'csv niche');
assertEqual(rows[0].City, 'el mirage', 'csv city unchanged');

const id = `__test-niche-title-${Date.now().toString(36)}`;
try {
  const created = createCandidate({
    niche: 'artificial turf',
    primary: 'Testville,TX',
    id,
    discoverySeed: { niche: 'artificial turf', city: 'Testville' },
  });
  assertEqual(created.config.niche, 'Artificial Turf', 'create config niche');
  assertEqual(created.meta.niche, 'Artificial Turf', 'create meta niche');
  const { readFileSync } = await import('node:fs');
  const seed = JSON.parse(readFileSync(pathsFor(id).discoverySeed, 'utf8'));
  assertEqual(seed.niche, 'Artificial Turf', 'create seed niche');
  assert(existsSync(pathsFor(id).config), 'config written');
} finally {
  if (existsSync(pathsFor(id).config) || existsSync(pathsFor(id).meta)) {
    await deleteCandidates([id]);
  }
}

console.log('test-niche-title-case: ok');
