/**
 * Niche-agnostic service educational-band rotation.
 * Homepage keeps the encyclopedia; service FILEs get a subset so URLs are not clones.
 */
import { COST_BAND_RE } from '../../src/lib/is-cost-heading.mjs';

export const CORE_SERVICE_BANDS = [
  'svcHero',
  'svcIntro',
  'svcWhatsIncluded',
  'svcProcess',
  'svcMaterials',
  'svcFaqs',
  'svcCta',
];

export const ALL_FILE_OPTIONAL_BANDS = ['svcBeforeAfter'];

export const ROTATE_SERVICE_BANDS = [
  'svcCost',
  'svcCodes',
  'svcDiyVsPro',
  'svcTimeline',
  'svcWhenToCall',
];

export const COVERAGE_TO_SERVICE_BAND = {
  cost: 'svcCost',
  diyVsPro: 'svcDiyVsPro',
  codes: 'svcCodes',
};

const BAND_INTENT = {
  svcCost: new RegExp(`${COST_BAND_RE.source}|\\b(?:estimate|quote|afford)\\b`, 'i'),
  svcCodes: /\b(permit|code|codes|licensed|structural|water|sewer|electrical|roof|asbestos|fire-?rated|foundation)\b/i,
  svcDiyVsPro: /\b(diy|do[- ]it[- ]yourself|patch|repair|tune[- ]up|clean|small|spackle|touch[- ]up)\b/i,
  svcTimeline: /\b(how long|timeline|duration|same day|replacement|removal|install|whole|emergency)\b/i,
  svcMaterials: /\b(texture|material|finish|system|primer|compound|liner|board|coating)\b/i,
  svcWhenToCall: /\b(when to call|warning|sign|emergency|leak|smell|collapse)\b/i,
};

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function volumeOf(row) {
  const n = Number(row?.volume ?? row?.searchVolume ?? row?.search_volume);
  return Number.isFinite(n) ? n : 0;
}

function distinctiveTokens(name, allNames) {
  const counts = new Map();
  for (const n of allNames || []) {
    for (const t of slugify(n).split('-').filter((x) => x.length > 3)) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  const threshold = Math.max(2, Math.ceil((allNames?.length || 1) * 0.4));
  return slugify(name)
    .split('-')
    .filter((t) => t.length > 3 && (counts.get(t) || 0) < threshold);
}

function seedHay(serviceName, keywordTargets, faqSeeds, volumeHints, allNames) {
  const name = String(serviceName || '');
  const tokens = distinctiveTokens(name, allNames);
  const matchKw = (keyword) => {
    const k = String(keyword || '').toLowerCase();
    if (!k) return false;
    if (k.includes(name.toLowerCase())) return true;
    return tokens.some((t) => k.includes(t));
  };
  const kws = (keywordTargets || [])
    .filter((t) => matchKw(t.keyword || t))
    .map((t) => t.keyword || t);
  const vols = (volumeHints || []).filter((t) => matchKw(t.keyword));
  const faqs = (faqSeeds || []).filter((q) => matchKw(q));
  return {
    hay: [name, ...kws, ...faqs].join(' '),
    volume: vols.reduce((sum, row) => sum + volumeOf(row), 0),
  };
}

function scoreBand(hay, volume, bandId) {
  const re = BAND_INTENT[bandId];
  let score = volume / 1000;
  if (re?.test(hay)) score += 10;
  return score;
}

function pickTop(scored, n, exclude = new Set()) {
  return scored
    .filter((row) => !exclude.has(row.slug))
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, Math.max(0, n))
    .map((row) => row.slug);
}

/**
 * @param {{
 *   services?: string[],
 *   enabledSectionIds?: string[],
 *   keywordTargets?: Array<{ keyword?: string }>,
 *   faqSeeds?: string[],
 *   volumeHints?: Array<{ keyword?: string, volume?: number }>,
 * }} opts
 * @returns {Record<string, string[]>}
 */
export function assignServiceBands(opts = {}) {
  const enabled = new Set((opts.enabledSectionIds || []).map(String));
  const names = (opts.services || []).map((n) => String(n || '').trim()).filter(Boolean);
  const assignments = {};

  const core = CORE_SERVICE_BANDS.filter((id) => !enabled.size || enabled.has(id));
  const always = ALL_FILE_OPTIONAL_BANDS.filter((id) => enabled.has(id));
  const rotate = ROTATE_SERVICE_BANDS.filter((id) => enabled.has(id));

  if (!names.length) return assignments;

  const rows = names.map((name) => {
    const slug = slugify(name);
    const seeds = seedHay(name, opts.keywordTargets, opts.faqSeeds, opts.volumeHints, names);
    return { name, slug, ...seeds };
  });

  const rotateSets = new Map(rows.map((r) => [r.slug, new Set()]));

  const give = (slug, bandId) => {
    if (!slug || !bandId) return;
    rotateSets.get(slug)?.add(bandId);
  };

  if (rows.length === 1) {
    for (const band of rotate) give(rows[0].slug, band);
  } else {
    const coverCount = Math.min(2, rows.length);
    for (const bandId of Object.values(COVERAGE_TO_SERVICE_BAND)) {
      if (!rotate.includes(bandId)) continue;
      const scored = rows.map((r) => ({
        slug: r.slug,
        score: scoreBand(r.hay, r.volume, bandId),
      }));
      for (const slug of pickTop(scored, coverCount)) give(slug, bandId);
    }

    const extras = rotate.filter((id) => !Object.values(COVERAGE_TO_SERVICE_BAND).includes(id));
    const maxRotate = rows.length <= 2 ? rotate.length : 3;
    for (const bandId of extras) {
      const scored = rows
        .map((r) => ({
          slug: r.slug,
          score: scoreBand(r.hay, r.volume, bandId),
          count: rotateSets.get(r.slug)?.size || 0,
        }))
        .filter((r) => r.count < maxRotate)
        .sort((a, b) => a.count - b.count || b.score - a.score || a.slug.localeCompare(b.slug));
      if (scored[0]) give(scored[0].slug, bandId);
    }

    for (const r of rows) {
      if ((rotateSets.get(r.slug)?.size || 0) > 0) continue;
      const leftover = extras.find((id) => ![...rotateSets.values()].some((set) => set.has(id))) || extras[0];
      if (leftover) give(r.slug, leftover);
    }
  }

  for (const r of rows) {
    const extra = [...(rotateSets.get(r.slug) || [])];
    const ordered = [...core, ...always, ...ROTATE_SERVICE_BANDS.filter((id) => extra.includes(id))];
    assignments[r.slug] = ordered.filter((id, i, arr) => arr.indexOf(id) === i);
  }

  return assignments;
}

export function coverageMinimum(serviceCount) {
  const n = Number(serviceCount) || 0;
  if (n < 1) return 0;
  return Math.min(2, n);
}

export function formatServiceBandRulesMarkdown(assignments = {}, services = []) {
  const lines = ['- **Service pages:** emit ## only for the bands listed on that FILE (unmarked svcIntro never gets an H2). Do not copy cost / DIY / permits / timeline / materials / when-to-call onto a FILE that did not receive that band.'];
  for (const name of services) {
    const slug = slugify(name);
    const bands = assignments[slug];
    if (!bands?.length) continue;
    const emit = bands.filter((id) => id !== 'svcHero' && id !== 'svcIntro');
    lines.push(`  - ${name} (\`src/content/services/${slug}.md\`): ${emit.join(', ') || 'intro + CTA only'}`);
  }
  return lines.join('\n');
}
