/**
 * Pull unique free stock images into research/{id}/site-images/ with clear filenames.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  getCandidateDetail,
  pathsFor,
  saveMeta,
} from './candidates.mjs';
import {
  ensureYamlFrontmatter,
  loadAcceptedSiteConfig,
  looksLikeStockScrapeAlt,
  slugifyContentName,
} from './content-markdown.mjs';
import {
  getContentOutlinePackage,
  getContentStructure,
  loadSectionRegistry,
} from './content-structure.mjs';
import {
  configuredImageProviders,
  imageProvidersStatus,
} from './image-providers/registry.mjs';

const ROOT = process.cwd();

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function slugify(text, max = 40) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max)
    .replace(/-$/g, '') || 'photo';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Structure has at least one photo slot enabled. */
export function structureHasPhotosEnabled(candidateId) {
  const structure = getContentStructure(candidateId);
  const photos = structure?.photos || {};
  return Object.values(photos).some((p) => p && p.enabled);
}

function loadHomepageMarkdown(candidateId) {
  const p = pathsFor(candidateId);
  for (const key of ['content', 'contentDraft']) {
    const doc = readJson(p[key]);
    const indexKey = doc?.files && Object.keys(doc.files).find((k) => /pages\/index\.md$/i.test(k));
    if (indexKey) return String(doc.files[indexKey] || '');
  }
  const live = path.join(ROOT, 'src', 'content', 'pages', 'index.md');
  if (existsSync(live)) return readFileSync(live, 'utf8');
  return '';
}

function countProcessStepsInMarkdown(md) {
  const m = String(md || '').match(/^process:\s*\n((?:(?:[ \t]+.*|-(?!-).*)\n)*)/m);
  if (!m) return 0;
  const items = m[1].match(/^[ \t]*-(?!-)[ \t]*/gm);
  return items ? items.length : 0;
}

/** Step titles from homepage `process:` frontmatter (`title:` on each item). */
function listProcessStepTitlesFromFrontmatter(md) {
  const m = String(md || '').match(/^process:\s*\n((?:(?:[ \t]+.*|-(?!-).*)\n)*)/m);
  if (!m) return [];
  const titles = [];
  const re = /^[ \t]+title:\s*(?:"([^"]*)"|'([^']*)'|(.+))\s*$/gm;
  let match;
  while ((match = re.exec(m[1]))) {
    const t = (match[1] || match[2] || match[3] || '').trim();
    if (t) titles.push(t);
  }
  return titles;
}

function processSectionBody(md) {
  const text = String(md || '').replace(/\r\n/g, '\n');
  const body = text.includes('\n---\n')
    ? text.slice(text.indexOf('\n---\n', 3) + 5)
    : text.replace(/^---[\s\S]*?---\n?/, '');
  const section = body.split(/^#{1,2}\s+/m).find((chunk) => {
    const heading = (chunk.trim().split('\n')[0] || '').trim();
    return /process works|how (our |the )?.+process|how we (work|do)/i.test(heading);
  });
  return section || '';
}

/** Title from a process step line (same shapes as parseProcessSteps). */
function parseProcessTitleFromLine(raw) {
  const cleaned = stripMaterialBold(
    String(raw || '')
      .replace(/^[-*•]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim(),
  );
  const em = cleaned.match(/^(.+?)\s+[—–-]\s+(.+)$/);
  if (em) return em[1].trim();
  const colon = cleaned.match(/^(.+?):\s+(.+)$/);
  if (colon && colon[1].split(/\s+/).length <= 8) return colon[1].trim();
  return '';
}

/** Process step titles from a service-page body `##`. */
function listProcessStepTitlesFromBody(md) {
  const section = processSectionBody(md);
  if (!section) return [];
  return section
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseProcessTitleFromLine)
    .filter(Boolean);
}

function stripMaterialBold(s) {
  return String(s || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\*\*|\*\*$/g, '')
    .trim();
}

function stockImageAlt(description, label, niche = '') {
  const nicheBit = stripMaterialBold(niche || '').trim();
  const labelBit = stripMaterialBold(label || 'Service').trim();
  const fallback = [nicheBit, labelBit, 'photo'].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  let alt = stripMaterialBold(description || '');
  alt = alt
    .replace(/\b(photo\s+by|photographer|unsplash|pexels|check my bio|follow me|ig:|instagram)\b[\s\S]*$/i, '')
    .replace(/\s*[—–|]\s*$/g, '')
    .replace(/-\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Prefer slot-shaped alt over provider captions (geo tells, first-person scrapes, truncations).
  if (
    !alt ||
    alt.length < 3 ||
    looksLikeStockScrapeAlt(alt) ||
    USELESS_ALT_RE.test(alt) ||
    OFF_NICHE_STOCK_RE.test(alt) ||
    LIFESTYLE_ALT_RE.test(alt)
  ) {
    alt = fallback;
  }
  return (alt || fallback || 'Service photo').slice(0, 120);
}

/** Title from a materials option bullet (same shapes as parseOptionRows). */
function parseMaterialTitleFromBullet(raw) {
  const b = String(raw || '')
    .replace(/^[-*•]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
  const cleaned = stripMaterialBold(b);
  const em = cleaned.match(/^(.+?)\s+[—–-]\s+(.+)$/);
  if (em) return em[1].trim();
  const colon = cleaned.match(/^(.+?):\s+(.+)$/);
  if (colon && colon[1].split(/\s+/).length <= 8) return colon[1].trim();
  const bold = b.match(/^\*\*(.+?)\*\*/);
  if (bold) return bold[1].trim();
  return cleaned;
}

function materialsSectionBody(md) {
  const text = String(md || '').replace(/\r\n/g, '\n');
  const body = text.includes('\n---\n')
    ? text.slice(text.indexOf('\n---\n', 3) + 5)
    : text.replace(/^---[\s\S]*?---\n?/, '');
  const section = body.split(/^#{1,2}\s+/m).find((chunk) =>
    /^(materials|methods)\b/i.test(chunk.trim()),
  );
  return section || '';
}

/** Material option titles from a page body (homepage or service). */
function listMaterialOptionTitles(md) {
  const section = materialsSectionBody(md);
  if (!section) return [];
  const bullets = section
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+/.test(l) || /^\d+[.)]\s+/.test(l));
  return bullets.map(parseMaterialTitleFromBullet).filter(Boolean);
}

function loadCandidateContentFiles(candidateId) {
  const p = pathsFor(candidateId);
  for (const key of ['content', 'contentDraft']) {
    const doc = readJson(p[key]);
    if (doc?.files && typeof doc.files === 'object') return doc.files;
  }
  const files = {};
  const svcDir = path.join(ROOT, 'src', 'content', 'services');
  if (existsSync(svcDir)) {
    for (const name of readdirSync(svcDir)) {
      if (!name.endsWith('.md')) continue;
      files[`src/content/services/${name}`] = readFileSync(path.join(svcDir, name), 'utf8');
    }
  }
  return files;
}

function serviceNameFromMarkdown(md, rel) {
  const m = String(md || '').match(/^serviceName:\s*["']?([^"'\n]+?)["']?\s*$/m);
  if (m) return m[1].trim();
  return path
    .basename(rel, '.md')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function serviceSlugFromRel(rel) {
  return path
    .basename(rel, '.md')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

/**
 * Build fill slots from structure photos + outline images (+ service page heroes).
 */
export function listImageSlots(candidateId) {
  const structure = getContentStructure(candidateId);
  const outline = getContentOutlinePackage(candidateId);
  const registry = loadSectionRegistry();
  const sectionById = new Map((registry.sections || []).map((s) => [s.id, s]));
  const detail = getCandidateDetail(candidateId);
  const config =
    loadAcceptedSiteConfig(candidateId)?.config || detail.siteConfig || detail.siteConfigDraft || {};
  const niche = String(config.niche || detail.config?.niche || 'home service').trim();
  const city = String(config.primaryCity || '').trim();
  const services = Array.isArray(config.services) ? config.services : [];
  const commercialServices = Array.isArray(config.commercialServices) ? config.commercialServices : [];
  /** Named svcHero targets: residential + commercial (deduped). */
  const svcHeroServiceNames = [];
  const seenSvcHero = new Set();
  for (const name of [...services, ...commercialServices]) {
    const n = String(name || '').trim();
    if (!n) continue;
    const key = n.toLowerCase();
    if (seenSvcHero.has(key)) continue;
    seenSvcHero.add(key);
    svcHeroServiceNames.push(n);
  }
  const homepageMd = loadHomepageMarkdown(candidateId);
  const processStepCount = countProcessStepsInMarkdown(homepageMd);
  const homeProcessTitles = listProcessStepTitlesFromFrontmatter(homepageMd);
  const homeMaterialTitles = listMaterialOptionTitles(homepageMd);

  const slots = [];
  const photos = structure?.photos || {};

  for (const [sectionId, photo] of Object.entries(photos)) {
    if (!photo?.enabled) continue;
    // Stock before/after pulls removed — ChatGPT import owns gallery-ba-* pairs
    if (sectionId === 'beforeAfter' || sectionId === 'svcBeforeAfter') continue;
    // Per-service materials / process slots are expanded below from each service page body
    if (sectionId === 'svcMaterials' || sectionId === 'svcProcess') continue;
    const def = sectionById.get(sectionId);
    const max = def?.maxImages || 6;
    let count = Math.min(Math.max(Number(photo.count) || 1, 1), max);
    let materialTitles = [];
    let processTitles = [];
    // Match photo slots to content boxes
    if (sectionId === 'process' || sectionId === 'offerProcess') {
      processTitles = homeProcessTitles.slice(0, max);
      if (processTitles.length) count = processTitles.length;
      else if (processStepCount > 0) count = Math.min(Math.max(processStepCount, 1), max);
    }
    if (sectionId === 'materials' && homeMaterialTitles.length > 0) {
      materialTitles = homeMaterialTitles.slice(0, max);
      count = materialTitles.length;
    }
    const outlineSec = (outline?.sections || []).find((s) => s.id === sectionId);
    for (let n = 1; n <= count; n += 1) {
      const outlineImg = outlineSec?.images?.[n - 1];
      const materialTitle = stripMaterialBold(materialTitles[n - 1] || '');
      const processTitle = stripMaterialBold(processTitles[n - 1] || '');
      slots.push({
        key: `${sectionId}-${n}`,
        sectionId,
        index: n,
        label: processTitle || materialTitle || def?.label || sectionId,
        kind: def?.kind || 'other',
        pages: def?.pages || ['home'],
        materialTitle: materialTitle || null,
        processTitle: processTitle || null,
        queryHint: buildQuery({
          niche,
          city,
          sectionId,
          label: def?.label,
          kind: def?.kind,
          services,
          index: n,
          materialTitle,
          processTitle,
        }),
        preferredPath: outlineImg?.path || null,
      });
    }
  }

  if (photos.svcMaterials?.enabled && (structure?.pages || []).includes('services')) {
    const def = sectionById.get('svcMaterials');
    const max = def?.maxImages || 6;
    const contentFiles = loadCandidateContentFiles(candidateId);
    const serviceRels = Object.keys(contentFiles)
      .filter((k) => /content\/services\/[^/]+\.md$/i.test(k))
      .sort();
    for (const rel of serviceRels) {
      const md = contentFiles[rel];
      const titles = listMaterialOptionTitles(md).slice(0, max);
      if (!titles.length) continue;
      const serviceName = serviceNameFromMarkdown(md, rel);
      const serviceSlug = serviceSlugFromRel(rel);
      titles.forEach((materialTitleRaw, i) => {
        const n = i + 1;
        const materialTitle = stripMaterialBold(materialTitleRaw);
        slots.push({
          key: `svcMaterials-${serviceSlug}-${n}`,
          sectionId: 'svcMaterials',
          index: n,
          label: materialTitle || def?.label || 'Materials',
          kind: def?.kind || 'materials',
          pages: ['services'],
          serviceName,
          serviceSlug,
          materialTitle,
          queryHint: buildQuery({
            niche,
            city,
            sectionId: 'svcMaterials',
            label: materialTitle,
            kind: 'materials',
            services,
            index: n,
            serviceName,
            materialTitle,
          }),
          preferredPath: null,
        });
      });
    }
  }

  if (photos.svcProcess?.enabled && (structure?.pages || []).includes('services')) {
    const def = sectionById.get('svcProcess');
    const max = def?.maxImages || 8;
    const contentFiles = loadCandidateContentFiles(candidateId);
    const serviceRels = Object.keys(contentFiles)
      .filter((k) => /content\/services\/[^/]+\.md$/i.test(k))
      .sort();
    for (const rel of serviceRels) {
      const md = contentFiles[rel];
      const titles = listProcessStepTitlesFromBody(md).slice(0, max);
      if (!titles.length) continue;
      const serviceName = serviceNameFromMarkdown(md, rel);
      const serviceSlug = serviceSlugFromRel(rel);
      titles.forEach((processTitleRaw, i) => {
        const n = i + 1;
        const processTitle = stripMaterialBold(processTitleRaw);
        slots.push({
          key: `svcProcess-${serviceSlug}-${n}`,
          sectionId: 'svcProcess',
          index: n,
          label: processTitle || def?.label || 'Process',
          kind: def?.kind || 'process',
          pages: ['services'],
          serviceName,
          serviceSlug,
          processTitle,
          queryHint: buildQuery({
            niche,
            city,
            sectionId: 'svcProcess',
            label: processTitle,
            kind: 'process',
            services,
            index: n,
            serviceName,
            processTitle,
          }),
          preferredPath: null,
        });
      });
    }
  }

  // One unique photo per service for cards/heroes when svcHero or services photos enabled
  const wantPerService =
    (structure?.pages || []).includes('services') &&
    svcHeroServiceNames.length > 0 &&
    Boolean(photos.svcHero?.enabled || photos.services?.enabled);

  if (wantPerService) {
    // Drop generic Structure "services" + stub svcHero slots; one named slot per service
    const without = slots.filter(
      (s) => s.sectionId !== 'svcHero' && s.sectionId !== 'services',
    );
    const max = Math.min(svcHeroServiceNames.length, 24);
    for (let i = 0; i < max; i += 1) {
      const name = svcHeroServiceNames[i];
      without.push({
        key: `svcHero-${i + 1}`,
        sectionId: 'svcHero',
        index: i + 1,
        label: name,
        kind: 'hero',
        pages: ['services'],
        serviceName: name,
        queryHint: buildQuery({
          niche,
          city,
          sectionId: 'svcHero',
          label: name,
          kind: 'hero',
          services: svcHeroServiceNames,
          index: i + 1,
          serviceName: name,
        }),
        preferredPath: null,
      });
    }
    return without;
  }

  return slots;
}

/**
 * Trade synonyms + kind hints for Pull. Seeded from ops/data/niche-image-profiles.json
 * Unknown niches are synthesized from niche + services and auto-appended on Pull.
 */
function nicheProfilesPath() {
  return path.join(ROOT, 'ops', 'data', 'niche-image-profiles.json');
}

function loadNicheImageProfiles() {
  const doc = readJson(nicheProfilesPath());
  const rows = Array.isArray(doc?.profiles) ? doc.profiles : [];
  const out = [];
  for (const row of rows) {
    const matchSrc = String(row?.match || '').trim();
    if (!matchSrc) continue;
    let match;
    try {
      match = new RegExp(matchSrc, 'i');
    } catch {
      continue;
    }
    out.push({
      id: row.id || matchSrc.slice(0, 24),
      match,
      matchSrc,
      boost: Array.isArray(row.boost) ? row.boost : [],
      tokens: Array.isArray(row.tokens) ? row.tokens : [],
      requireNicheHit: Boolean(row.requireNicheHit),
      kindHints: row.kindHints && typeof row.kindHints === 'object' ? row.kindHints : {},
      synthetic: false,
    });
  }
  return out;
}

let nicheImageProfiles = loadNicheImageProfiles();

function reloadNicheImageProfiles() {
  nicheImageProfiles = loadNicheImageProfiles();
}

/** Minimum relevance score to prefer a stock photo (one solid token hit). Soft-fill may go below. */
const SCORE_FLOOR = 2;

/**
 * Map a relevance score to RYG grade + tooltip for Rover image slots.
 * @returns {{ matchGrade: 'poor'|'ok'|'good', matchTip: string }}
 */
function matchGradeFromScore(score, { query = '', missing = false } = {}) {
  if (missing) {
    return { matchGrade: 'poor', matchTip: 'No photo in this slot' };
  }
  const q = String(query || '')
    .trim()
    .replace(/\s+/g, ' ');
  const qShort = q.length > 80 ? `${q.slice(0, 78)}…` : q;
  const qBit = qShort ? ` for “${qShort}”` : '';
  if (score == null || score === '' || Number.isNaN(Number(score))) {
    return {
      matchGrade: 'ok',
      matchTip: 'Could not auto-score; review visually',
    };
  }
  const s = Number(score);
  if (s < SCORE_FLOOR) {
    return { matchGrade: 'poor', matchTip: `Poor match${qBit} (score ${s})` };
  }
  if (s >= 4) {
    return { matchGrade: 'good', matchTip: `Good match${qBit} (score ${s})` };
  }
  return { matchGrade: 'ok', matchTip: `OK match${qBit} (score ${s})` };
}

/** Score an operator upload from filename/alt/slot labels (same rules as stock). */
function scoreUploadedSlot(slot, { filename, alt, niche, services }) {
  const defaultAlt = `${slot.label || slot.sectionId} photo`;
  const altText = String(alt || '').trim();
  const customAlt = altText && altText.toLowerCase() !== defaultAlt.toLowerCase() ? altText : '';
  const stem = path
    .basename(String(filename || ''), path.extname(String(filename || '')))
    .replace(/-upload$/i, '')
    .replace(new RegExp(`^${String(slot.sectionId || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-${slot.index}-?`, 'i'), '');
  const fromFile = stem
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
  const fileTokens = fromFile.split(/\s+/).filter((w) => w.length > 2);
  // Opaque default upload names + default alt → don't false-red owner photos
  if (!fileTokens.length && !customAlt) {
    return {
      score: null,
      query: null,
      ...matchGradeFromScore(null, {}),
      matchTip: 'Upload — could not auto-score; review visually',
    };
  }
  const description = [fromFile, customAlt || altText, slot.label, slot.processTitle, slot.materialTitle, slot.serviceName]
    .filter(Boolean)
    .join(' ');
  const tokens = relevanceTokens({
    niche,
    services,
    serviceName: slot.serviceName,
    sectionId: slot.sectionId,
    kind: slot.kind,
    label: slot.label,
    materialTitle: slot.materialTitle,
    processTitle: slot.processTitle,
  });
  const profile = resolveNicheProfile(niche, services, slot.serviceName);
  const rankOpts = buildRankOpts(slot, niche, profile);
  const score = scorePhoto({ description, tags: [] }, tokens, rankOpts);
  const queryHint = stripMaterialBold(slot.queryHint || slot.label || '');
  const graded = matchGradeFromScore(score, { query: queryHint });
  return { score, query: queryHint || null, ...graded };
}

/** Niche-name fragments too weak to count as a niche hit alone (e.g. power lines). */
const WEAK_NICHE_HIT_RE = /^(line|lines|replacement|service|services|home|local|free|estimate)$/i;

/** Titles/descriptions that are almost never right for home-service stock. */
const OFF_NICHE_STOCK_RE =
  /\b(lobster|seafood|bed(?:room)?|mattress|nightstand|camera\s*body|dslr|mirrorless|cinema\s*camera|\bred\s*camera\b|tripod|video\s*camera|photo\s*camera|security\s*camera|wall[- ]mounted\s*camera|surveillance\s*camera|tire|tyre|router\s*bit|circuit\s*board|fashion\s*model|fashion|makeup|walking\s*tour|taking\s*a\s*walk|coworking|latte|sushi|wedding\s*cake|yoga\s*mat|sewing|garment|tailor|fabric\s*workshop|locomotive|passenger\s*train|\bperon\b|train\s*station|medical|doctor|hospital|scrubs|antigen|vaccine|covid|tampon|sanitary|garbage\s*truck|waste\s*truck|rubbish\s*truck|trash\s*can|garbage\s*can|dumpster|sports?\s*field|field\s*striping|line\s*painter|darkroom|film\s*photography|photo\s*film|runway|couture|parking\s*permit|parking\s*lot|boom\s*gate|people\s*posing|posing\s*models|seagull|wildlife|perches|wall\s*art|mural|lobby\s*art|braided|flex\s*pipe|flex\s*hose|garden\s*hose|supply\s*line|pex\s*fitting|drain\s*tile|plowing|beach\s*bulldozer|bulldozer\s+on\s+a\s+beach)\b/i;

/** Sewer-camera slots: prefer inspection gear metadata. */
const CAMERA_GEAR_RE =
  /\b(push\s*rod|crawler|sewer\s*camera|drain\s*camera|pipe\s*inspection|pipe\s*cam|cctv\s*drain|inspection\s*camera|drain\s*inspection|pipe\s*scope)\b/i;

const CAMERA_REJECT_RE =
  /\b(flex\s*pipe|braided|hex\s*nut|garden\s*hose|wall\s*art|mural|lobby|security\s*camera|surveillance|supply\s*line|studio)\b/i;

const PERMIT_REJECT_RE =
  /\b(road\s*closed|detour|traffic\s*light|street\s*cone|parking|boom\s*gate|caution\s*tape)\b/i;

/** Materials slots: beauty, industrial hardware, decay, empty bokeh. */
const MATERIALS_REJECT_RE =
  /\b(makeup|cosmetic|skincare|skin\s*care|lipstick|mascara|serum|foundation\s*makeup|face\s*primer|glow\s*primer|beauty|dapop|nail\s*polish|perfume|moisturizer|chain|rigging|hoist|galvanized\s*bracket|deck\s*beam|industrial\s*chain|anchor\s*chain|rusty|rusted|corroded|corrosion|peeling\s*paint|oxidized\s*metal|haircut|cutting\s*hair|salon|barber|cooking\s*dinner|family\s*cooking|dining\s*room|open\s*concept\s*kitchen|luxury\s*kitchen\s*interior|airplane|aircraft|fuselage|jet\s*engine|aviation)\b/i;

/** Product/process cues — bare "kitchen" alone is too weak (lifestyle rooms). */
const MATERIALS_TRADE_CUE_RE =
  /\b(cabinet|wood|wooden|lumber|paint|painted|varnish|enamel|primer|hinge|veneer|finish|coating|oak|plywood|drawer|door\s*hardware|brush|spray\s*gun|swatch|sample|stain|lacquer|filler|paint\s*can|soft[- ]?close|refinish|refacing)\b/i;

const MATERIALS_BOKEH_ONLY_RE =
  /\b(bokeh|blur(?:red)?|out[- ]of[- ]focus|abstract\s*macro)\b/i;

/** Full kitchen lifestyle without a product cue — hard reject. */
const MATERIALS_LIFESTYLE_KITCHEN_RE =
  /\b((?:modern|traditional|stylish|spacious|contemporary|beautiful|bright|elegant)\s+kitchen|kitchen\s+(?:island|interior|corner|featuring|with|design)|remodeled\s*kitchen|white\s*cabinets|dark\s*wood\s*cabinets|apartment\s*interior|modern\s*interior|wooden\s*kitchen|kitchen\s*cabinets?\s+and|spacious\s*bathroom|bathroom\s+featuring)\b/i;

const MATERIALS_PRODUCT_DETAIL_RE =
  /\b(paint\s*can|varnish|enamel|primer|hinge|veneer|filler|brush|spray\s*gun|swatch|sample|coating|stain|lacquer|soft[- ]?close|door\s*hardware|wood\s*grain|plywood\s*sheet)\b/i;

const LIFESTYLE_ALT_RE =
  /\b(taking a walk|one of those things|check my bio|follow me|walking tour|discover just)\b/i;

/**
 * Camera / permit slot scoring context from slot labels.
 * Hard camera gates only for inspection-camera contexts — not materials that
 * merely mention "camera" (e.g. root-cutting camera equipment).
 * @returns {{ cameraSlot: boolean, permitSlot: boolean, materialsSlot: boolean, scoreFloor: number }}
 */
function slotScoreContext(slot = {}) {
  const sectionId = String(slot.sectionId || '');
  const processTitle = String(slot.processTitle || '');
  const serviceName = String(slot.serviceName || '');
  const materialTitle = String(slot.materialTitle || '');
  const label = String(slot.label || '');
  const isMaterials = sectionId === 'materials' || sectionId === 'svcMaterials';
  const isSvcHero =
    sectionId === 'svcHero' || slot.kind === 'hero' || sectionId === 'hero';

  const inspectionCameraProduct =
    /\b(sewer\s*camera|push\s*camera|pipe\s*camera|inspection\s*camera|drain\s*camera)\b/i.test(
      materialTitle || label,
    ) && !/root[- ]?cut/i.test(materialTitle || label);

  const cameraSlot =
    /camera/i.test(processTitle) ||
    (isSvcHero && /camera/i.test(serviceName || label)) ||
    (isMaterials && inspectionCameraProduct);

  const permitSlot = /permit/i.test(processTitle) || (/permit/i.test(label) && !isMaterials);
  let scoreFloor = SCORE_FLOOR;
  if (cameraSlot || permitSlot) scoreFloor = Math.max(SCORE_FLOOR, 4);
  else if (isMaterials) scoreFloor = Math.max(SCORE_FLOOR, 3);
  return {
    cameraSlot,
    permitSlot,
    materialsSlot: isMaterials,
    scoreFloor,
  };
}

/** Product-title tokens for materials scoring (weighted above niche tokens). */
function materialTitleTokenList(materialTitle) {
  return stripMaterialBold(materialTitle || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !AMBIGUOUS_SLOT_TOKEN_RE.test(w));
}

function buildRankOpts(slot, niche, profile) {
  const slotCtx = slotScoreContext(slot);
  return {
    scoreFloor: slotCtx.scoreFloor,
    requireNicheHit: Boolean(profile?.requireNicheHit),
    nicheTokens: nicheCoreTokens(niche, profile),
    cameraSlot: slotCtx.cameraSlot,
    permitSlot: slotCtx.permitSlot,
    materialsSlot: Boolean(slotCtx.materialsSlot),
    materialTitleTokens: slotCtx.materialsSlot
      ? materialTitleTokenList(slot.materialTitle)
      : [],
  };
}

/** Provider alts too weak to keep. */
const USELESS_ALT_RE =
  /^(a|an|the|photo|image|img|untitled|dsc\d*|img_\d*|\d+)$/i;

/** Step/material words that poison Unsplash when searched or scored alone. */
const AMBIGUOUS_SLOT_TOKEN_RE =
  /^(cure|camera|liner|lining|diagnosis|diagnose|line|testing|test|insertion|insert|inspect|inspection)$/i;

/** Niche strings too vague for Unsplash alone — use profile boost instead. */
const VAGUE_NICHE_RE =
  /^(remodel(ing|s)?|renovation(s)?|home\s*service(s)?|contractor(s)?|construction|home\s*improvement)$/i;

const PROFILE_STOP_RE =
  /^(the|and|for|with|from|your|our|near|area|inc|llc|pros|co|company|a|an|of|to|in|on)$/i;

function nicheProfileId(niche) {
  return slugify(String(niche || '').trim(), 48) || 'niche';
}

/**
 * Build a Pull profile from niche + services when JSON has no match.
 * @returns {object|null}
 */
function synthesizeNicheProfile(niche, services = []) {
  const n = String(niche || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!n) return null;
  const svcList = (Array.isArray(services) ? services : [])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 8);
  const boost = [n, ...svcList.slice(0, 3)];
  const tokens = new Set();
  for (const phrase of [n, ...svcList]) {
    for (const w of phrase
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)) {
      if (PROFILE_STOP_RE.test(w) || WEAK_NICHE_HIT_RE.test(w)) continue;
      tokens.add(w);
    }
  }
  const matchSrc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  let match;
  try {
    match = new RegExp(matchSrc, 'i');
  } catch {
    match = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
  return {
    id: nicheProfileId(n),
    match,
    matchSrc,
    boost,
    tokens: [...tokens],
    requireNicheHit: false,
    kindHints: {
      hero: n,
      process: `${n} contractor jobsite`,
      materials: `${n} materials`,
      other: n,
    },
    synthetic: true,
  };
}

function resolveNicheProfile(niche, services = [], serviceName = '') {
  const hay = `${niche || ''} ${(services || []).join(' ')} ${serviceName || ''}`.trim();
  for (const entry of nicheImageProfiles) {
    if (entry.match.test(hay)) {
      return { ...entry, synthetic: false };
    }
  }
  return synthesizeNicheProfile(niche, services);
}

/**
 * Idempotent append of a synthetic profile. Never overwrites existing ids/matches.
 * @returns {{ saved: boolean, id?: string, reason?: string }}
 */
function persistSyntheticNicheProfile(profile) {
  if (!profile?.synthetic || !profile.id) {
    return { saved: false, reason: 'not_synthetic' };
  }
  const filePath = nicheProfilesPath();
  let doc = readJson(filePath);
  if (!doc || typeof doc !== 'object') {
    doc = {
      _comment:
        'Niche image Pull profiles. Auto-appended when Pull runs on an unmatched niche. Advanced users may edit by hand.',
      profiles: [],
    };
  }
  if (!Array.isArray(doc.profiles)) doc.profiles = [];

  const id = String(profile.id);
  const matchSrc = String(profile.matchSrc || '').trim();
  const exists = doc.profiles.some(
    (row) =>
      String(row?.id || '') === id ||
      (matchSrc && String(row?.match || '') === matchSrc),
  );
  if (exists) return { saved: false, id, reason: 'exists' };

  doc.profiles.push({
    id,
    match: matchSrc || id,
    boost: profile.boost || [],
    tokens: profile.tokens || [],
    requireNicheHit: Boolean(profile.requireNicheHit),
    kindHints: profile.kindHints || {},
    autoSeeded: true,
    seededAt: new Date().toISOString(),
  });

  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    reloadNicheImageProfiles();
    return { saved: true, id };
  } catch (e) {
    return { saved: false, id, reason: e?.message || 'write_failed' };
  }
}

function kindBucket(sectionId, kind) {
  if (sectionId === 'svcHero') return 'svcHero';
  if (sectionId === 'intro') return 'intro';
  if (kind === 'hero' || sectionId === 'hero') return 'hero';
  if (kind === 'process' || sectionId === 'process' || sectionId === 'offerProcess' || sectionId === 'svcProcess') {
    return 'process';
  }
  if (sectionId === 'materials' || sectionId === 'svcMaterials') return 'materials';
  if (kind === 'gallery' || sectionId === 'beforeAfter' || sectionId === 'svcBeforeAfter') return 'gallery';
  return 'other';
}

/** Primary search phrase: site-config niche (or boost if niche is too vague). */
function primaryNichePhrase(niche, profile) {
  const n = String(niche || '').trim().replace(/\s+/g, ' ');
  if (!n) return profile?.boost?.[0] || 'home renovation';
  if (VAGUE_NICHE_RE.test(n) && profile?.boost?.[0]) return profile.boost[0];
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length <= 1 && profile?.boost?.[0]) return profile.boost[0];
  return n;
}

/**
 * Rewrite ambiguous process/material titles so stock search stays on-niche.
 * Returns a phrase suitable to append after the niche primary (never search bare alone).
 */
function disambiguateSlotTitle(title, niche, profile) {
  const raw = stripMaterialBold(title || '').trim();
  if (!raw) return '';
  const hay = `${niche || ''} ${(profile?.boost || []).join(' ')} ${(profile?.tokens || []).join(' ')}`.toLowerCase();
  const sewerish = /sewer|trenchless|cipp|drain.?line|septic|pipe.?lin|plumb/i.test(hay);

  if (sewerish) {
    if (/^cure\b/i.test(raw) || (/\bcure\b/i.test(raw) && raw.split(/\s+/).length <= 3)) {
      return 'CIPP pipe liner UV cure';
    }
    if (/root[- ]?cut/i.test(raw)) {
      return 'sewer drain root cutting hydro jet';
    }
    // Only rewrite short/ambiguous camera titles — not multi-word materials like
    // "Root-cutting camera equipment" (handled above) or other named tools.
    if (
      /^(camera|cameras)$/i.test(raw) ||
      /^camera\s+(inspection|pass|setup|scope)$/i.test(raw) ||
      /^(final\s+)?camera\s+(inspection|verification|pass)$/i.test(raw) ||
      /\b(sewer|push|pipe|drain|inspection)\s+camera\b/i.test(raw)
    ) {
      return 'sewer pipe inspection camera push rod drain';
    }
    if (
      /^(permit|permits)$/i.test(raw) ||
      /^permit\s+(filing|approval|application)$/i.test(raw)
    ) {
      return 'building permit paperwork contractor desk';
    }
    if (
      /^(liner|lining)$/i.test(raw) ||
      /^(cipp\s+)?(pipe\s+)?liner$/i.test(raw) ||
      /^liner\s+(install|insertion|cure)$/i.test(raw)
    ) {
      return 'CIPP sewer pipe liner installation';
    }
    if (
      /^(diagnos(is|e|ing)?)$/i.test(raw) ||
      /^diagnosis\s+and\s+estimate$/i.test(raw)
    ) {
      return 'sewer pipe inspection diagnosis';
    }
    if (/^line\s*test(ing)?$/i.test(raw) || /^testing$/i.test(raw)) {
      return 'sewer pipe pressure test';
    }
    if (/^(insert|insertion)$/i.test(raw) || /^liner\s+insert/i.test(raw)) {
      return 'CIPP sewer liner insertion jobsite';
    }
    if (/root\s*barrier/i.test(raw)) return 'tree root barrier near sewer pipe';
    // Short clean steps only — not long product names containing "clean"
    if (
      /^(clean|cleaning|main\s*line\s*cleaning)$/i.test(raw) &&
      /sewer|main|line|drain/i.test(hay + raw)
    ) {
      return 'hydro jet sewer drain cleaning';
    }
  }

  // Kitchen / cabinet materials — avoid beauty primer, industrial chain, rust macros
  const kitchenish =
    /kitchen|cabinet|countertop|cabinetr|refinish|refac|woodwork|carpentry|painting|stain/i.test(
      hay,
    ) ||
    /\b(varnish|enamel|veneer|grain\s*filler|soft[- ]?close|alkyd|conversion\s*varnish)\b/i.test(raw);

  if (kitchenish) {
    if (/\b(soft[- ]?close|hinge)\b/i.test(raw)) {
      return 'soft close cabinet door hinge hardware';
    }
    if (/\b(veneer|refacing)\b/i.test(raw)) {
      return 'cabinet wood veneer sheet';
    }
    if (/\b(grain\s*filler)\b/i.test(raw)) {
      return 'wood grain filler oak cabinet';
    }
    if (/\b(conversion\s*varnish|catalyzed\b.*\bvarnish|\bvarnish)\b/i.test(raw)) {
      return 'cabinet wood varnish finish coating';
    }
    if (/\b(alkyd|enamel)\b/i.test(raw)) {
      return 'sprayed cabinet paint enamel finish';
    }
    if (/\bprimer\b/i.test(raw)) {
      return 'wood cabinet primer paint can';
    }
    if (/\bhardware\b/i.test(raw) && !/\b(hinge|knob|pull|drawer)\b/i.test(raw)) {
      return 'cabinet door hardware knob hinge';
    }
    if (/\b(stain|staining)\b/i.test(raw) && !/\b(wood\s*stain|cabinet)\b/i.test(raw)) {
      return 'wood cabinet stain finish';
    }
    if (/\b(degreas|cleaner|cleaning\s*solution)\b/i.test(raw)) {
      return 'cabinet degreaser wood prep cleaner';
    }
    if (/\b(filler|wood\s*filler|epoxy)\b/i.test(raw) && !/\bgrain\b/i.test(raw)) {
      return 'wood filler cabinet repair';
    }
    if (/\b(adhesive|glue|contact\s*cement)\b/i.test(raw)) {
      return 'wood veneer contact adhesive cabinet';
    }
  }

  // Short bare verbs/nouns always stay attached to niche by caller — return as-is.
  return raw;
}

/** svcHero / materials queries when the service name itself is an ambiguous keyword trap. */
function disambiguateServiceQuery(serviceName, niche, profile) {
  const name = stripMaterialBold(String(serviceName || '').trim());
  if (!name) return '';
  const hay = `${niche || ''} ${name} ${(profile?.boost || []).join(' ')}`.toLowerCase();
  const sewerish = /sewer|trenchless|cipp|drain.?line|septic|pipe.?lin|plumb/i.test(hay);
  if (sewerish && /camera/i.test(name)) {
    return 'sewer pipe inspection camera push rod drain';
  }
  if (sewerish && /clean/i.test(name)) {
    return 'hydro jet main sewer line cleaning';
  }
  return name;
}

function relevanceTokens({ niche, services, serviceName, sectionId, kind, label, materialTitle, processTitle }) {
  const profile = resolveNicheProfile(niche, services, serviceName);
  const tokens = new Set();
  const addToken = (t) => {
    const w = String(t || '')
      .toLowerCase()
      .trim();
    if (!w || w.length < 3) return;
    if (AMBIGUOUS_SLOT_TOKEN_RE.test(w)) return;
    tokens.add(w);
  };
  for (const t of String(niche || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2)) {
    addToken(t);
  }
  if (serviceName) {
    for (const t of String(serviceName)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)) {
      addToken(t);
    }
  }
  if (profile?.tokens) profile.tokens.forEach((t) => addToken(t));
  if (label && !/^hero|intro|process|gallery|materials|services/i.test(label)) {
    for (const t of stripMaterialBold(label)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)) {
      addToken(t);
    }
  }
  const material = stripMaterialBold(materialTitle || '');
  if (material) {
    for (const t of material
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)) {
      addToken(t);
    }
  }
  const process = stripMaterialBold(processTitle || '');
  if (process) {
    for (const t of process
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)) {
      addToken(t);
    }
  }
  const bucket = kindBucket(sectionId, kind);
  if (bucket === 'process' && !process) {
    ['contractor', 'installation', 'jobsite', 'install'].forEach((t) => addToken(t));
  }
  if (bucket === 'materials' && !material) ['materials', 'product'].forEach((t) => addToken(t));
  return [...tokens];
}

function nicheCoreTokens(niche, profile) {
  const core = new Set();
  for (const t of profile?.tokens || []) {
    const w = String(t || '')
      .toLowerCase()
      .trim();
    if (w.length > 2 && !WEAK_NICHE_HIT_RE.test(w)) core.add(w);
  }
  for (const t of String(niche || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2)) {
    if (WEAK_NICHE_HIT_RE.test(t)) continue;
    core.add(t);
  }
  return [...core];
}

/** Match token in provider metadata with word boundary (pipe matches pipes). */
function tokenInHay(hay, token) {
  const t = String(token || '')
    .toLowerCase()
    .trim();
  if (!t || !hay) return false;
  if (t.includes(' ')) return hay.includes(t);
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}s?\\b`, 'i').test(hay);
}

function scorePhoto(
  photo,
  tokens,
  {
    requireNicheHit = false,
    nicheTokens = [],
    cameraSlot = false,
    permitSlot = false,
    materialsSlot = false,
    materialTitleTokens = [],
  } = {},
) {
  const hay = `${photo?.description || ''} ${(photo?.tags || []).join(' ')}`.toLowerCase();
  if (!hay.trim()) return 0;
  if (OFF_NICHE_STOCK_RE.test(hay)) return -20;
  if (cameraSlot && CAMERA_REJECT_RE.test(hay)) return -20;
  if (permitSlot && PERMIT_REJECT_RE.test(hay)) return -20;
  if (materialsSlot && MATERIALS_REJECT_RE.test(hay)) return -20;
  if (
    materialsSlot &&
    MATERIALS_BOKEH_ONLY_RE.test(hay) &&
    !MATERIALS_TRADE_CUE_RE.test(hay)
  ) {
    return -20;
  }
  if (
    materialsSlot &&
    MATERIALS_LIFESTYLE_KITCHEN_RE.test(hay) &&
    !MATERIALS_PRODUCT_DETAIL_RE.test(hay)
  ) {
    return -20;
  }
  if (requireNicheHit && nicheTokens.length) {
    const hit = nicheTokens.some((t) => tokenInHay(hay, t));
    if (!hit) return 0;
  }
  let score = 0;
  for (const t of tokens || []) {
    if (!t) continue;
    if (tokenInHay(hay, t)) score += 2;
  }
  // Extra weight: product title hits beat niche lifestyle matches
  if (materialsSlot && materialTitleTokens.length) {
    for (const t of materialTitleTokens) {
      if (tokenInHay(hay, t)) score += 3;
    }
    if (
      /\b(close[- ]?up|macro|product|swatch|sample|paint\s*can|varnish|enamel|primer|coating|hardware|hinge|finish)\b/.test(
        hay,
      )
    ) {
      score += 2;
    }
    if (MATERIALS_LIFESTYLE_KITCHEN_RE.test(hay) && !/\b(paint|varnish|enamel|primer|hinge|veneer|filler|brush|spray|swatch|can)\b/.test(hay)) {
      score -= 6;
    }
    if (
      /\b(modern\s*kitchen\s*island|family\s*cooking|dining\s*room|open\s*concept\s*kitchen|luxury\s*kitchen)\b/.test(
        hay,
      ) &&
      !/\b(paint|varnish|enamel|primer|hardware|hinge|finish|coating|swatch|sample|close[- ]?up)\b/.test(hay)
    ) {
      score -= 4;
    }
    // Require a product/trade cue so lifestyle kitchen rooms don't win
    if (!MATERIALS_TRADE_CUE_RE.test(hay)) {
      score = Math.min(score, 1);
    }
  } else if (materialsSlot && !MATERIALS_TRADE_CUE_RE.test(hay)) {
    score = Math.min(score, 1);
  }
  if (materialsSlot && MATERIALS_LIFESTYLE_KITCHEN_RE.test(hay) && !/\b(paint|varnish|enamel|primer|hinge|veneer|filler|brush|spray|swatch|can)\b/.test(hay)) {
    score = Math.min(score, 2);
  }
  if (cameraSlot) {
    if (CAMERA_GEAR_RE.test(hay)) score += 4;
    else score = Math.min(score, 1);
  }
  if (permitSlot) {
    if (/\b(permit|paperwork|document|clipboard|contractor|building\s*department|desk)\b/i.test(hay)) {
      score += 3;
    } else {
      score = Math.min(score, 1);
    }
  }
  // Soft penalties for common off-niche stock tropes when we have niche tokens
  if (tokens?.length >= 3) {
    if (/\b(coffee|latte|laptop|coworking|office desk)\b/.test(hay)) score -= 3;
    if (/\b(fashion|portrait|model|makeup|posing|walking tour)\b/.test(hay)) score -= 5;
    // Texture/abstract often *is* the right materials photo — skip that penalty there
    if (!materialsSlot && /\b(abstract|texture|wallpaper pattern)\b/.test(hay)) score -= 2;
    if (/\b(sewing|train|medical|hospital|cinema|tripod|trash can|dumpster|parking|seagull|wildlife)\b/.test(hay)) {
      score -= 5;
    }
    if (/\b(security camera|surveillance|wall-mounted)\b/.test(hay)) score -= 6;
  }
  return score;
}

function pickBestResult(results, usedIds, tokens, opts = {}) {
  const floor = opts.scoreFloor ?? SCORE_FLOOR;
  const candidates = (results || []).filter((r) => r?.id && !usedIds.has(r.id));
  const clean = candidates.filter((r) => {
    const hay = `${r?.description || ''} ${(r?.tags || []).join(' ')}`;
    if (OFF_NICHE_STOCK_RE.test(hay)) return false;
    if (opts.materialsSlot && MATERIALS_REJECT_RE.test(hay)) return false;
    if (
      opts.materialsSlot &&
      MATERIALS_BOKEH_ONLY_RE.test(hay) &&
      !MATERIALS_TRADE_CUE_RE.test(hay)
    ) {
      return false;
    }
    if (
      opts.materialsSlot &&
      MATERIALS_LIFESTYLE_KITCHEN_RE.test(hay) &&
      !MATERIALS_PRODUCT_DETAIL_RE.test(hay)
    ) {
      return false;
    }
    return true;
  });
  // Prefer non-denied; if none and allowDenied, use any unused (fail-soft last resort)
  const pool = clean.length ? clean : opts.allowDenied ? candidates : [];
  if (!pool.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const r of pool) {
    const s = scorePhoto(r, tokens, opts);
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  if (!best) return null;
  return {
    pick: best,
    score: bestScore,
    lowScore: bestScore < floor,
    deniedPool: !clean.length && Boolean(opts.allowDenied),
  };
}

/**
 * Search providers: prefer above-floor clean picks; else keep best soft candidate.
 * @returns {Promise<{ chosen, download, providerUsed, relevanceScore, chosenQuery, softFill, errors }>}
 */
async function searchStockForSlot({
  providers,
  queries,
  usedIds,
  tokens,
  rankOpts,
  perPage = 20,
  pages = [1],
  priorPhotoId = null,
  sleepMs = 200,
}) {
  const errors = [];
  let chosen = null;
  let providerUsed = null;
  let download = null;
  let relevanceScore = null;
  let chosenQuery = '';
  let softFill = false;
  /** @type {{ pick: object, score: number, provider: object, query: string, pageLabel: string }|null} */
  let softCandidate = null;

  const considerSoft = (ranked, provider, query, pageLabel) => {
    if (!ranked?.pick) return;
    if (priorPhotoId && ranked.pick.id === priorPhotoId) return;
    if (!softCandidate || ranked.score > softCandidate.score) {
      softCandidate = { pick: ranked.pick, score: ranked.score, provider, query, pageLabel };
    }
  };

  searchLoop: for (const query of queries) {
    for (const page of pages) {
      for (const provider of providers) {
        const pageLabel = pages.length > 1 ? ` p${page}` : '';
        try {
          const results = await provider.search(query, { perPage, page });
          const ranked = pickBestResult(results, usedIds, tokens, rankOpts);
          if (!ranked?.pick) {
            const denied = pickBestResult(results, usedIds, tokens, {
              ...rankOpts,
              allowDenied: true,
            });
            if (!denied?.pick) {
              errors.push(`${provider.id}${pageLabel}: no unused results`);
            } else if (priorPhotoId && denied.pick.id === priorPhotoId) {
              errors.push(`${provider.id}${pageLabel}: same as current — skip`);
            } else {
              considerSoft(denied, provider, query, pageLabel);
              errors.push(`${provider.id}${pageLabel}: only off-niche metadata — soft candidate kept`);
            }
            await sleep(sleepMs);
            continue;
          }
          if (priorPhotoId && ranked.pick.id === priorPhotoId) {
            errors.push(`${provider.id}${pageLabel}: same as current — skip`);
            continue;
          }
          if (ranked.lowScore) {
            considerSoft(ranked, provider, query, pageLabel);
            errors.push(
              `${provider.id}${pageLabel}: best score ${ranked.score} below floor — soft candidate`,
            );
            await sleep(sleepMs);
            continue;
          }
          download = await provider.download(ranked.pick);
          chosen = ranked.pick;
          providerUsed = provider.id;
          relevanceScore = ranked.score;
          chosenQuery = pages.length > 1 ? `${query} (p${page})` : query;
          softFill = false;
          break searchLoop;
        } catch (e) {
          errors.push(`${provider.id}${pageLabel}: ${e.message || e}`);
        }
        await sleep(sleepMs);
      }
    }
  }

  if (!chosen && softCandidate) {
    try {
      download = await softCandidate.provider.download(softCandidate.pick);
      chosen = softCandidate.pick;
      providerUsed = softCandidate.provider.id;
      relevanceScore = softCandidate.score;
      chosenQuery =
        pages.length > 1
          ? `${softCandidate.query} (${softCandidate.pageLabel.trim() || 'soft'})`
          : softCandidate.query;
      softFill = true;
    } catch (e) {
      errors.push(`soft download: ${e.message || e}`);
    }
  }

  return { chosen, download, providerUsed, relevanceScore, chosenQuery, softFill, errors };
}

/**
 * Short, destination-aware Unsplash/Pexels query.
 * Hero ≈ niche alone (like Google Images); other slots add at most one modifier.
 */
function buildQuery({ niche, sectionId, label, kind, services, index, serviceName, materialTitle, processTitle }) {
  const profile = resolveNicheProfile(niche, services, serviceName);
  const base = primaryNichePhrase(niche, profile);
  const bucket = kindBucket(sectionId, kind);

  if (bucket === 'svcHero') {
    const name = disambiguateServiceQuery(serviceName || label || '', niche, profile);
    return name || base;
  }

  if (bucket === 'hero') {
    return base;
  }

  if (bucket === 'intro') {
    return `${base} interior`.replace(/\s+/g, ' ').trim();
  }

  if (bucket === 'process') {
    const title = disambiguateSlotTitle(processTitle || '', niche, profile);
    if (title) return `${base} ${title}`.replace(/\s+/g, ' ').trim();
    return (profile?.kindHints?.process || `${base} jobsite`).replace(/\s+/g, ' ').trim();
  }

  if (bucket === 'materials') {
    const title = disambiguateSlotTitle(materialTitle || '', niche, profile);
    // Trade-worded title (never bare "{title} close up" — that hits beauty/industrial stock)
    if (title) return title.replace(/\s+/g, ' ').trim();
    return (profile?.kindHints?.materials || `${base} product close up`).replace(/\s+/g, ' ').trim();
  }

  if (bucket === 'gallery') {
    return `${base} before after`.replace(/\s+/g, ' ').trim();
  }

  // services grid / about / other — niche alone
  return base;
}

function buildQueryVariants(slot, niche, services) {
  const profile = resolveNicheProfile(niche, services, slot.serviceName);
  const primary = primaryNichePhrase(niche, profile);
  const base = slot.queryHint || buildQuery({
    niche,
    sectionId: slot.sectionId,
    label: slot.label,
    kind: slot.kind,
    services,
    index: slot.index,
    serviceName: slot.serviceName,
    materialTitle: slot.materialTitle,
    processTitle: slot.processTitle,
  });
  const variants = [base];
  const bucket = kindBucket(slot.sectionId, slot.kind);

  if (bucket === 'svcHero') {
    const svcQ = disambiguateServiceQuery(slot.serviceName || slot.label || '', niche, profile);
    if (svcQ) variants.push(svcQ);
    if (primary) variants.push(primary);
    if (profile?.kindHints?.hero) variants.push(profile.kindHints.hero);
    return [...new Set(variants.filter(Boolean))];
  }

  if (primary && primary !== base) variants.push(primary);

  if (bucket === 'hero') {
    if (profile?.boost?.[0] && profile.boost[0] !== primary) variants.push(profile.boost[0]);
    if (profile?.kindHints?.hero) variants.push(profile.kindHints.hero);
  } else if (bucket === 'intro') {
    variants.push(`${primary} interior`);
    variants.push(primary);
  } else if (bucket === 'process') {
    if (slot.processTitle) {
      const pt = disambiguateSlotTitle(slot.processTitle, niche, profile);
      if (pt) variants.push(`${primary} ${pt}`.replace(/\s+/g, ' ').trim());
    }
    if (profile?.kindHints?.process) variants.push(profile.kindHints.process);
    variants.push(`${primary} jobsite`);
    variants.push(`${primary} install`);
  } else if (bucket === 'materials') {
    if (slot.materialTitle) {
      const mt = disambiguateSlotTitle(slot.materialTitle, niche, profile);
      if (mt) {
        // Prefer disambiguated trade phrases; avoid bare title / texture traps
        variants.length = 0;
        variants.push(mt);
        variants.push(`${primary} ${mt}`.replace(/\s+/g, ' ').trim());
        const kitchenNiche = /kitchen|cabinet|countertop|cabinetr|refinish|refac/i.test(
          `${primary} ${niche || ''}`,
        );
        if (kitchenNiche) {
          variants.push(`${mt} kitchen cabinet`.replace(/\s+/g, ' ').trim());
          variants.push(`${mt} close up product`.replace(/\s+/g, ' ').trim());
        }
      }
    }
    if (profile?.kindHints?.materials) variants.push(profile.kindHints.materials);
    variants.push(`${primary} product close up`);
    variants.push(`${primary} product`);
  }

  return [...new Set(variants.filter(Boolean))];
}

/** Safe photoId fragment for filenames (never keep provider prefixes / colons). */
function safeIdTail(photoId, max = 8) {
  return (
    String(photoId || '')
      .replace(/^[^:]+:/, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, max) || 'id'
  );
}

function loadManifest(candidateId) {
  const p = pathsFor(candidateId);
  return (
    readJson(p.imagesManifest) || {
      version: 1,
      candidateId: p.id,
      usedIds: [],
      files: [],
      slots: {},
      sources: {},
      pulledAt: null,
    }
  );
}

function copyDirFiles(fromDir, toDir) {
  if (!existsSync(fromDir)) return 0;
  mkdirSync(toDir, { recursive: true });
  let n = 0;
  for (const name of readdirSync(fromDir)) {
    if (name.startsWith('.')) continue;
    const from = path.join(fromDir, name);
    const to = path.join(toDir, name);
    try {
      copyFileSync(from, to);
      n += 1;
    } catch {
      // skip
    }
  }
  return n;
}

/** Copy durable site-images into template public/images and optional staging. */
export function syncSiteImagesToPublic(candidateId) {
  const p = pathsFor(candidateId);
  const copied = {
    template: copyDirFiles(p.siteImages, path.join(ROOT, 'public', 'images')),
    staging: 0,
  };
  if (existsSync(p.siteStaging)) {
    copied.staging = copyDirFiles(p.siteImages, path.join(p.siteStaging, 'public', 'images'));
  }
  return copied;
}

function altFromSrc(src) {
  const base = path.basename(String(src || ''), path.extname(src || ''));
  return base.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Project photo';
}

/**
 * Rewrite accepted/draft content files so image srcs point at pulled filenames.
 */
function applyImagesToContentFiles(candidateId, filledSlots) {
  const p = pathsFor(candidateId);
  const contentPath = existsSync(p.content) ? p.content : p.contentDraft;
  if (!contentPath || !existsSync(contentPath)) return { updated: 0 };

  const doc = readJson(contentPath);
  if (!doc?.files) return { updated: 0 };

  const bySection = {};
  for (const slot of filledSlots) {
    if (!slot.filename) continue;
    if (!bySection[slot.sectionId]) bySection[slot.sectionId] = [];
    bySection[slot.sectionId].push(slot);
  }

  let updated = 0;
  const files = { ...doc.files };

  const setImageObject = (md, key, src, alt) => {
    const block = `${key}:\n  src: ${JSON.stringify(src)}\n  alt: ${JSON.stringify(alt)}`;
    const reObj = new RegExp(`^${key}:\\s*\\n(?:[ \\t]+[^\\n]*\\n)*`, 'm');
    const reScalar = new RegExp(`^${key}:\\s*[^\\n]*$`, 'm');
    if (reObj.test(md)) return md.replace(reObj, `${block}\n`);
    if (reScalar.test(md)) return md.replace(reScalar, block);
    // Insert after h1 or at end of frontmatter
    return md.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (m, fm) => {
      if (new RegExp(`^${key}:`, 'm').test(fm)) return m;
      return `---\n${fm.trimEnd()}\n${block}\n---`;
    });
  };

  const setGallery = (md, slots) => {
    const lines = slots.map(
      (s) =>
        `  - src: ${JSON.stringify(`/images/${s.filename}`)}\n    alt: ${JSON.stringify(s.alt || altFromSrc(s.filename))}`,
    );
    const block = `gallery:\n${lines.join('\n')}`;
    // Match list items with `-(?!-)` so closing fence `---` is never consumed
    const galleryRe = /^gallery:\s*\n(?:(?:[ \t]+.*|-(?!-).*)\n)*/m;
    if (galleryRe.test(md)) {
      return md.replace(galleryRe, `${block}\n`);
    }
    return md.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (m, fm) => {
      if (/^gallery:/m.test(fm)) return m;
      return `---\n${fm.trimEnd()}\n${block}\n---`;
    });
  };

  /** Attach image objects onto process: list items by index. */
  const setProcessImages = (md, slots) => {
    if (!slots.length) return md;
    const sorted = [...slots].sort((a, b) => (a.index || 0) - (b.index || 0));
    const processRe = /^process:\s*\n((?:(?:[ \t]+.*|-(?!-).*)\n)*)/m;
    const m = md.match(processRe);
    if (!m) return md;
    const block = m[0];
    // Split into list items starting with "  - " or "- "
    const itemStarts = [...block.matchAll(/^[ \t]*-(?!-)[ \t]*/gm)];
    if (!itemStarts.length) return md;
    let next = block;
    // Rebuild items: for each item range, ensure image: under it
    const parts = [];
    for (let i = 0; i < itemStarts.length; i += 1) {
      const start = itemStarts[i].index;
      const end = i + 1 < itemStarts.length ? itemStarts[i + 1].index : block.length;
      let item = block.slice(start, end);
      const slot = sorted[i];
      if (slot?.filename) {
        const imgBlock = `    image:\n      src: ${JSON.stringify(`/images/${slot.filename}`)}\n      alt: ${JSON.stringify(slot.alt || altFromSrc(slot.filename))}\n`;
        if (/^[ \t]+image:/m.test(item)) {
          item = item.replace(/^[ \t]+image:\s*\n(?:[ \t]+.*\n)*/m, imgBlock);
        } else {
          item = item.replace(/\n?$/, `\n${imgBlock}`);
        }
      }
      parts.push(item.endsWith('\n') ? item : `${item}\n`);
    }
    const rebuilt = `process:\n${parts.join('')}`;
    return md.replace(processRe, rebuilt);
  };

  /**
   * Replace or append a top-level YAML list key inside frontmatter only.
   * Never scan the body — body lines like `Optional:` must not terminate the list.
   */
  const setFmImageList = (md, key, slots) => {
    if (!slots.length) return md;
    const lines = [...slots]
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map(
        (s) =>
          `  - src: ${JSON.stringify(`/images/${s.filename}`)}\n    alt: ${JSON.stringify(s.alt || altFromSrc(s.filename))}`,
      );
    const block = `${key}:\n${lines.join('\n')}`;
    const split = String(md || '').match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)?$/);
    if (!split) return md;
    let fm = split[1];
    const body = split[2] != null ? split[2] : '\n';
    const fmLines = fm.split(/\r?\n/);
    const start = fmLines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
    if (start >= 0) {
      let end = start + 1;
      while (end < fmLines.length) {
        if (/^[A-Za-z_][\w]*\s*:/.test(fmLines[end])) break;
        end += 1;
      }
      const blockLines = block.split(/\n/);
      fm = [...fmLines.slice(0, start), ...blockLines, ...fmLines.slice(end)].join('\n');
    } else {
      fm = `${fm.trimEnd()}\n${block}`;
    }
    const bodyOut = body.startsWith('\n') || body.startsWith('\r\n') ? body : `\n${body}`;
    return `---\n${fm.trimEnd()}\n---${bodyOut}`;
  };

  const setMaterialsImages = (md, slots) => setFmImageList(md, 'materialsImages', slots);

  const setProcessImagesList = (md, slots) => setFmImageList(md, 'processImages', slots);

  // Homepage index.md
  const indexKey = Object.keys(files).find((k) => /pages\/index\.md$/i.test(k));
  if (indexKey) {
    let md = files[indexKey];
    const hero = bySection.hero?.[0];
    if (hero) {
      md = setImageObject(md, 'heroImage', `/images/${hero.filename}`, hero.alt);
      updated += 1;
    }
    const intro = bySection.intro?.[0];
    if (intro) {
      md = setImageObject(md, 'featureImage', `/images/${intro.filename}`, intro.alt);
      updated += 1;
    }
    const gallerySlots = [...(bySection.gallery || [])].filter(
      (s) => s.sectionId !== 'beforeAfter' && s.sectionId !== 'svcBeforeAfter',
    );
    if (gallerySlots.length) {
      md = setGallery(md, gallerySlots);
      updated += 1;
    }
    const processSlots = bySection.process || bySection.offerProcess || [];
    if (processSlots.length) {
      const before = md;
      md = setProcessImages(md, processSlots);
      if (md !== before) updated += 1;
    }
    const materialsSlots = bySection.materials || [];
    if (materialsSlots.length) {
      const before = md;
      md = setMaterialsImages(md, materialsSlots);
      if (md !== before) updated += 1;
    }
    md = ensureYamlFrontmatter(md);
    files[indexKey] = md.endsWith('\n') ? md : `${md}\n`;
  }

  // Service pages — one unique image each (never fall back to photo #1)
  const svcHeroes = bySection.svcHero || [];
  const serviceFiles = Object.keys(files)
    .filter((k) => /content\/services\/[^/]+\.md$/i.test(k))
    .sort();

  const slugFromRel = (rel) =>
    path
      .basename(rel, '.md')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');

  /** Exact slug only — never includes() (commercial-* must not steal residential slots).
   * Must match content file basenames (`&` → `and` via slugifyContentName). */
  const slugifyServiceKey = (value) => slugifyContentName(value);

  const matchSlotForService = (rel) => {
    const slug = slugFromRel(rel);
    return (
      svcHeroes.find((s) => {
        const sn = slugifyServiceKey(s.serviceName || s.label || '');
        return sn && slug === sn;
      }) || null
    );
  };

  const removeImageKey = (md, key) => {
    let out = md.replace(new RegExp(`^${key}:\\s*\\n(?:[ \\t]+[^\\n]*\\n)*`, 'm'), '');
    out = out.replace(new RegExp(`^${key}:\\s*[^\\n]*\\n?`, 'm'), '');
    return out;
  };

  const svcMaterialsAll = bySection.svcMaterials || [];
  const svcProcessAll = bySection.svcProcess || [];
  const usedSvcFilenames = new Set();
  serviceFiles.forEach((rel) => {
    let slot = matchSlotForService(rel);
    // Enforce unique photo across service cards (bathroom ≠ cabinetry reuse)
    if (slot?.filename && usedSvcFilenames.has(slot.filename)) {
      slot = null;
    }
    let md = files[rel];
    const slug = slugFromRel(rel);
    if (!slot?.filename) {
      md = removeImageKey(md, 'heroImage');
      md = removeImageKey(md, 'cardImage');
    } else {
      usedSvcFilenames.add(slot.filename);
      md = setImageObject(md, 'heroImage', `/images/${slot.filename}`, slot.alt);
      md = setImageObject(md, 'cardImage', `/images/${slot.filename}`, slot.alt);
      updated += 1;
    }
    const matSlots = svcMaterialsAll
      .filter((s) => {
        const sn = slugifyServiceKey(s.serviceSlug || s.serviceName || s.label || '');
        return Boolean(sn) && slug === sn;
      })
      .sort((a, b) => (a.index || 0) - (b.index || 0));
    if (matSlots.length) {
      md = setMaterialsImages(md, matSlots);
      updated += 1;
    }
    const procSlots = svcProcessAll
      .filter((s) => {
        const sn = slugifyServiceKey(s.serviceSlug || s.serviceName || s.label || '');
        return Boolean(sn) && slug === sn;
      })
      .sort((a, b) => (a.index || 0) - (b.index || 0));
    if (procSlots.length) {
      md = setProcessImagesList(md, procSlots);
      updated += 1;
    }
    files[rel] = md.endsWith('\n') ? md : `${md}\n`;
  });

  writeJson(contentPath, { ...doc, files });

  // Mirror onto template src/content when accepted paths exist on disk
  for (const [rel, body] of Object.entries(files)) {
    if (!rel.startsWith('src/content/')) continue;
    const abs = path.join(ROOT, ...rel.split('/'));
    if (!existsSync(path.dirname(abs))) continue;
    try {
      writeFileSync(abs, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
    } catch {
      // non-fatal
    }
  }

  return { updated };
}

function writePullStatus(candidateId, status) {
  const p = pathsFor(candidateId);
  writeJson(p.imagesPullStatus, {
    ...status,
    updatedAt: new Date().toISOString(),
  });
}

function clearPullStatus(candidateId) {
  const p = pathsFor(candidateId);
  if (existsSync(p.imagesPullStatus)) {
    try {
      writeJson(p.imagesPullStatus, {
        status: 'idle',
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // ignore
    }
  }
}

/**
 * @param {string} candidateId
 * @param {{ replace?: boolean }} [opts]
 */
export async function fillSiteImages(candidateId, { replace = false } = {}) {
  const p = pathsFor(candidateId);
  const providers = configuredImageProviders();
  const providerStatus = imageProvidersStatus();

  if (!structureHasPhotosEnabled(candidateId)) {
    clearPullStatus(candidateId);
    return {
      ok: true,
      skipped: true,
      reason: 'No Structure photo slots enabled',
      providerStatus,
      filled: 0,
      total: 0,
      files: [],
      human: ['No photo slots enabled in Structure — skipped image pull.'],
    };
  }

  if (!providers.length) {
    const err = new Error(
      'Photos enabled but no image API keys configured. Set UNSPLASH_ACCESS_KEY and/or PEXELS_API_KEY in .env',
    );
    err.status = 400;
    err.providerStatus = providerStatus;
    throw err;
  }

  const slots = listImageSlots(candidateId);
  const manifest = loadManifest(candidateId);
  // Full replace: do not block on prior photoIds (they exhaust overlapping Unsplash pages).
  const usedIds = replace ? new Set() : new Set(manifest.usedIds || []);
  const usedFilenames = replace
    ? new Set()
    : new Set(
        Object.values(manifest.slots || {})
          .map((s) => s?.filename)
          .filter(Boolean),
      );
  if (!replace) {
    // Seed usedIds from existing slot photoIds so skipped keep-paths still block reuse
    for (const slotEntry of Object.values(manifest.slots || {})) {
      if (slotEntry?.photoId) usedIds.add(slotEntry.photoId);
    }
  }
  const human = [];
  const filledSlots = [];
  const sourceCounts = {};

  const detailForNiche = getCandidateDetail(candidateId);
  const configForNiche =
    loadAcceptedSiteConfig(candidateId)?.config ||
    detailForNiche.siteConfig ||
    detailForNiche.siteConfigDraft ||
    {};
  const nicheForProfile = String(
    configForNiche.niche || detailForNiche.config?.niche || '',
  ).trim();
  const servicesForProfile = [
    ...(Array.isArray(configForNiche.services) ? configForNiche.services : []),
    ...(Array.isArray(configForNiche.commercialServices)
      ? configForNiche.commercialServices
      : []),
  ];
  const baseNicheProfile = resolveNicheProfile(nicheForProfile, servicesForProfile);
  const shouldPersistNicheProfile = Boolean(baseNicheProfile?.synthetic && nicheForProfile);

  mkdirSync(p.siteImages, { recursive: true });
  writePullStatus(candidateId, {
    status: 'running',
    current: 0,
    total: slots.length,
    label: 'Starting image pull…',
    replace: Boolean(replace),
  });

  try {
  for (let si = 0; si < slots.length; si += 1) {
    const slot = slots[si];
    writePullStatus(candidateId, {
      status: 'running',
      current: si + 1,
      total: slots.length,
      label: `Pulling ${slot.key} (${si + 1}/${slots.length})…`,
      slotKey: slot.key,
      replace: Boolean(replace),
    });

    const existing = manifest.slots?.[slot.key];
    const existingFile = existing?.filename
      ? path.join(p.siteImages, existing.filename)
      : null;
    if (!replace && existingFile && existsSync(existingFile)) {
      if (existing.photoId) usedIds.add(existing.photoId);
      if (existing.filename) usedFilenames.add(existing.filename);
      filledSlots.push({
        ...slot,
        ...existing,
        skipped: true,
        serviceName: slot.serviceName || existing.serviceName || null,
        serviceSlug: slot.serviceSlug || existing.serviceSlug || null,
        materialTitle: slot.materialTitle || existing.materialTitle || null,
        processTitle: slot.processTitle || existing.processTitle || null,
        label: slot.label || existing.label || null,
      });
      continue;
    }

    const detail = getCandidateDetail(candidateId);
    const config =
      loadAcceptedSiteConfig(candidateId)?.config ||
      detail.siteConfig ||
      detail.siteConfigDraft ||
      {};
    const niche = String(config.niche || detail.config?.niche || 'home service').trim();
    const services = Array.isArray(config.services) ? config.services : [];
    const tokens = relevanceTokens({
      niche,
      services,
      serviceName: slot.serviceName,
      sectionId: slot.sectionId,
      kind: slot.kind,
      label: slot.label,
      materialTitle: slot.materialTitle,
      processTitle: slot.processTitle,
    });
    const profile = resolveNicheProfile(niche, services, slot.serviceName);
    const slotCtx = slotScoreContext(slot);
    const rankOpts = buildRankOpts(slot, niche, profile);
    const isProcessSlot =
      slot.sectionId === 'process' ||
      slot.sectionId === 'offerProcess' ||
      slot.sectionId === 'svcProcess' ||
      slot.kind === 'process';
    const perPage = isProcessSlot || slotCtx.cameraSlot ? 30 : 20;
    const queries = buildQueryVariants(slot, niche, services);
    const searched = await searchStockForSlot({
      providers,
      queries,
      usedIds,
      tokens,
      rankOpts,
      perPage,
      pages: [1],
      sleepMs: 200,
    });
    const errors = searched.errors;
    let chosen = searched.chosen;
    let providerUsed = searched.providerUsed;
    let download = searched.download;
    let relevanceScore = searched.relevanceScore;
    let chosenQuery = searched.chosenQuery || slot.queryHint;
    const softFill = searched.softFill;

    if (!chosen || !download?.buffer?.length) {
      human.push(
        `Slot ${slot.key}: failed (${errors.join('; ') || 'no unused stock photos'})`,
      );
      filledSlots.push({
        ...slot,
        error: errors.join('; ') || 'no unused stock photos',
      });
      continue;
    }

    const photoId = download.id || chosen.id;
    if (photoId && usedIds.has(photoId)) {
      human.push(`Slot ${slot.key}: skipped duplicate provider id ${photoId}`);
      filledSlots.push({ ...slot, error: `duplicate photoId ${photoId}` });
      continue;
    }

    const slug = slugify(
      slot.processTitle ||
        slot.materialTitle ||
        chosen.tags?.[0] ||
        chosen.description ||
        slot.serviceName ||
        slot.label ||
        slot.sectionId,
    );
    const nameBase =
      slot.sectionId === 'svcMaterials' && slot.serviceSlug
        ? `materials-${slot.serviceSlug}-${slot.index}`
        : slot.sectionId === 'materials'
          ? `materials-${slot.index}`
          : slot.sectionId === 'svcProcess' && slot.serviceSlug
            ? `process-${slot.serviceSlug}-${slot.index}`
            : slot.sectionId === 'process' || slot.sectionId === 'offerProcess'
              ? `process-${slot.index}`
              : `${slot.sectionId}-${slot.index}`;
    let filename = `${nameBase}-${slug}.jpg`;
    if (usedFilenames.has(filename)) {
      filename = `${slot.sectionId}-${slot.index}-${slug}-${safeIdTail(photoId || si)}.jpg`;
    }
    const abs = path.join(p.siteImages, filename);
    writeFileSync(abs, download.buffer);

    if (photoId) usedIds.add(photoId);
    usedFilenames.add(filename);
    sourceCounts[providerUsed] = (sourceCounts[providerUsed] || 0) + 1;

    const queryStored = stripMaterialBold(chosenQuery);
    const graded = softFill
      ? {
          matchGrade: 'poor',
          matchTip: 'Best available stock — review/replace',
        }
      : matchGradeFromScore(relevanceScore, { query: queryStored });
    const entry = {
      key: slot.key,
      sectionId: slot.sectionId,
      index: slot.index,
      filename,
      src: `/images/${filename}`,
      alt: stockImageAlt(chosen.description, slot.label, niche),
      provider: providerUsed,
      source: 'stock',
      photoId,
      photographer: download.photographer,
      pageUrl: download.pageUrl,
      query: queryStored,
      score: relevanceScore,
      matchGrade: graded.matchGrade,
      matchTip: graded.matchTip,
      softFill: softFill || undefined,
      attribution: download.attribution,
      serviceName: slot.serviceName || slot.label || null,
      serviceSlug: slot.serviceSlug || null,
      materialTitle: slot.materialTitle || null,
      processTitle: slot.processTitle || null,
      label: slot.label || null,
    };
    filledSlots.push(entry);
    await sleep(250);
  }

  const okFiles = filledSlots.filter((s) => s.filename);
  const nextManifest = {
    version: 1,
    candidateId: p.id,
    usedIds: [...usedIds],
    files: okFiles.map((s) => ({
      filename: s.filename,
      src: s.src,
      sectionId: s.sectionId,
      provider: s.provider,
      photoId: s.photoId,
      photographer: s.photographer,
      pageUrl: s.pageUrl,
      attribution: s.attribution,
      serviceName: s.serviceName || null,
    })),
    slots: Object.fromEntries(okFiles.map((s) => [s.key, s])),
    sources: sourceCounts,
    pulledAt: new Date().toISOString(),
    replace,
  };
  writeJson(p.imagesManifest, nextManifest);

  const synced = syncSiteImagesToPublic(candidateId);
  const contentUpdate = applyImagesToContentFiles(candidateId, okFiles);

  const filled = okFiles.filter((s) => !s.skipped).length;
  const skipped = okFiles.filter((s) => s.skipped).length;
  const failedSlotRows = filledSlots.filter((s) => s.error);
  const failed = failedSlotRows.length;
  const failedSlots = failedSlotRows.map((s) => ({
    key: s.key,
    error: s.error,
    label: s.label || null,
    sectionId: s.sectionId || null,
  }));

  human.unshift(
    `Images: ${filled} pulled, ${skipped} kept, ${failed} failed (${okFiles.length}/${slots.length} on disk).`,
  );
  if (Object.keys(sourceCounts).length) {
    human.push(
      `Sources: ${Object.entries(sourceCounts)
        .map(([k, v]) => `${k}×${v}`)
        .join(' · ')}`,
    );
  }

  let nicheProfileSaved = null;
  if (shouldPersistNicheProfile && okFiles.length > 0) {
    const persist = persistSyntheticNicheProfile(baseNicheProfile);
    if (persist.saved) {
      nicheProfileSaved = nicheForProfile;
      human.push(`Saved image profile for “${nicheForProfile}”.`);
    }
  }

  saveMeta(candidateId, {
    lastImagesPullAt: nextManifest.pulledAt,
    imagesCount: okFiles.length,
  });

  writePullStatus(candidateId, {
    status: 'done',
    current: slots.length,
    total: slots.length,
    label: human[0] || 'Done',
    filled,
    skipped,
    failed,
    nicheProfileSaved: nicheProfileSaved || undefined,
  });

  return {
    ok: failed === 0 || okFiles.length > 0,
    filled,
    skipped,
    failed,
    failedSlots,
    total: slots.length,
    files: nextManifest.files,
    sources: sourceCounts,
    synced,
    contentUpdate,
    providerStatus,
    manifest: nextManifest,
    human,
    nicheProfileSaved,
    candidate: getCandidateDetail(candidateId),
  };
  } catch (error) {
    writePullStatus(candidateId, {
      status: 'error',
      label: error?.message || 'Image pull failed',
      current: 0,
      total: slots.length,
    });
    throw error;
  }
}

export function getImagesManifest(candidateId) {
  const manifest = loadManifest(candidateId);
  const pull = readJson(pathsFor(candidateId).imagesPullStatus);
  return {
    ...manifest,
    pullStatus: pull,
    providerStatus: imageProvidersStatus(),
    photosEnabled: structureHasPhotosEnabled(candidateId),
    siteImagesPath: path.relative(ROOT, pathsFor(candidateId).siteImages).replace(/\\/g, '/'),
  };
}

function wiredFmForSlot(slot) {
  const id = slot.sectionId;
  if (id === 'hero') return 'homepage heroImage';
  if (id === 'intro') return 'homepage featureImage';
  if (id === 'process' || id === 'offerProcess') return `homepage process[${slot.index}].image`;
  if (id === 'materials') return 'homepage materialsImages';
  if (id === 'svcMaterials') return 'service materialsImages';
  if (id === 'svcProcess') return 'service processImages';
  if (id === 'svcHero' || id === 'services') return 'service heroImage/cardImage';
  if (id === 'gallery' || id === 'beforeAfter' || id === 'svcBeforeAfter') return 'homepage gallery';
  return null;
}

/** Structure slots + manifest status for Website operator grid. */
export function listImageSlotStatus(candidateId) {
  const slots = listImageSlots(candidateId);
  const manifest = loadManifest(candidateId);
  const p = pathsFor(candidateId);
  const matchTotals = { poor: 0, ok: 0, good: 0, missing: 0 };
  const mapped = slots.map((slot) => {
    const entry = manifest.slots?.[slot.key] || null;
    const filename = entry?.filename || null;
    const onDisk = Boolean(filename && existsSync(path.join(p.siteImages, filename)));
    let source = entry?.source || null;
    if (!source && entry?.provider) source = 'stock';
    if (!source && filename && /gallery-ba-/i.test(filename)) source = 'chatgpt';
    const query = stripMaterialBold(entry?.query || slot.queryHint || '');
    const graded =
      entry?.matchGrade && entry?.matchTip && onDisk
        ? { matchGrade: entry.matchGrade, matchTip: entry.matchTip }
        : matchGradeFromScore(onDisk ? entry?.score : null, {
            query,
            missing: !onDisk,
          });
    if (!onDisk) matchTotals.missing += 1;
    else if (graded.matchGrade === 'good') matchTotals.good += 1;
    else if (graded.matchGrade === 'ok') matchTotals.ok += 1;
    else matchTotals.poor += 1;
    return {
      key: slot.key,
      sectionId: slot.sectionId,
      index: slot.index,
      label: slot.label || slot.sectionId,
      kind: slot.kind,
      serviceName: slot.serviceName || null,
      queryHint: slot.queryHint ? stripMaterialBold(slot.queryHint) : slot.queryHint,
      query,
      score: entry?.score ?? null,
      matchGrade: graded.matchGrade,
      matchTip: graded.matchTip,
      filename: onDisk ? filename : null,
      src: onDisk ? `/images/${filename}` : null,
      previewUrl: onDisk
        ? `/api/candidates/${encodeURIComponent(p.id)}/images/file/${encodeURIComponent(filename)}`
        : null,
      provider: entry?.provider || null,
      source,
      photoId: entry?.photoId || null,
      wiredFm: wiredFmForSlot(slot),
      missing: !onDisk,
    };
  });
  return {
    photosEnabled: structureHasPhotosEnabled(candidateId),
    providerStatus: imageProvidersStatus(),
    siteImagesPath: path.relative(ROOT, p.siteImages).replace(/\\/g, '/'),
    matchTotals,
    slots: mapped,
  };
}

function saveSlotIntoManifest(candidateId, entry, { replaceFilename = null } = {}) {
  const p = pathsFor(candidateId);
  const manifest = loadManifest(candidateId);
  const slots = { ...(manifest.slots || {}) };
  if (replaceFilename && replaceFilename !== entry.filename) {
    // Drop old file from files list; leave on disk unless same path
  }
  slots[entry.key] = entry;
  const usedIds = new Set(manifest.usedIds || []);
  if (entry.photoId) usedIds.add(entry.photoId);
  const filesMap = new Map(
    (manifest.files || []).filter((f) => f?.filename).map((f) => [f.filename, f]),
  );
  // Remove prior slot filename from files if replaced
  const prior = manifest.slots?.[entry.key];
  if (prior?.filename && prior.filename !== entry.filename) {
    filesMap.delete(prior.filename);
  }
  filesMap.set(entry.filename, {
    filename: entry.filename,
    src: entry.src,
    sectionId: entry.sectionId,
    provider: entry.provider || null,
    photoId: entry.photoId || null,
    photographer: entry.photographer || null,
    pageUrl: entry.pageUrl || null,
    attribution: entry.attribution || null,
    serviceName: entry.serviceName || null,
    source: entry.source || null,
  });
  const next = {
    ...manifest,
    version: 1,
    candidateId: p.id,
    usedIds: [...usedIds],
    files: [...filesMap.values()],
    slots,
    pulledAt: new Date().toISOString(),
  };
  writeJson(p.imagesManifest, next);
  return next;
}

/**
 * Re-pull a single Structure photo slot (stock providers + scoring).
 */
export async function repullImageSlot(candidateId, slotKey) {
  const providers = configuredImageProviders();
  if (!providers.length) {
    const err = new Error(
      'No image API keys configured. Set UNSPLASH_ACCESS_KEY and/or PEXELS_API_KEY in .env',
    );
    err.status = 400;
    throw err;
  }
  const slots = listImageSlots(candidateId);
  const slot = slots.find((s) => s.key === slotKey);
  if (!slot) {
    const err = new Error(`Unknown image slot: ${slotKey}`);
    err.status = 404;
    throw err;
  }

  const p = pathsFor(candidateId);
  const manifest = loadManifest(candidateId);
  const usedIds = new Set(manifest.usedIds || []);
  // Force a different photo: keep this slot's current provider id excluded
  const prior = manifest.slots?.[slot.key];
  if (prior?.photoId) usedIds.add(prior.photoId);
  for (const slotEntry of Object.values(manifest.slots || {})) {
    if (slotEntry?.photoId) usedIds.add(slotEntry.photoId);
  }

  const detail = getCandidateDetail(candidateId);
  const config =
    loadAcceptedSiteConfig(candidateId)?.config ||
    detail.siteConfig ||
    detail.siteConfigDraft ||
    {};
  const niche = String(config.niche || detail.config?.niche || 'home service').trim();
  const services = Array.isArray(config.services) ? config.services : [];
  const tokens = relevanceTokens({
    niche,
    services,
    serviceName: slot.serviceName,
    sectionId: slot.sectionId,
    kind: slot.kind,
    label: slot.label,
    materialTitle: slot.materialTitle,
    processTitle: slot.processTitle,
  });
  const profile = resolveNicheProfile(niche, services, slot.serviceName);
  const rankOpts = buildRankOpts(slot, niche, profile);
  // Extra short variants so Re-pull doesn't lock onto the same first-page hit
  const queries = [
    ...buildQueryVariants(slot, niche, services),
    primaryNichePhrase(niche, profile),
  ].filter(Boolean);
  const uniqueQueries = [...new Set(queries)];
  const searched = await searchStockForSlot({
    providers,
    queries: uniqueQueries,
    usedIds,
    tokens,
    rankOpts,
    perPage: 30,
    pages: [1, 2],
    priorPhotoId: prior?.photoId || null,
    sleepMs: 150,
  });
  const errors = searched.errors;
  const chosen = searched.chosen;
  const providerUsed = searched.providerUsed;
  const download = searched.download;
  const relevanceScore = searched.relevanceScore;
  const chosenQuery = searched.chosenQuery || slot.queryHint;
  const softFill = searched.softFill;

  if (!chosen || !download?.buffer?.length) {
    const err = new Error(
      `Repull failed for ${slotKey}: ${errors.join('; ') || 'no unused stock photos'}`,
    );
    err.status = 400;
    err.details = errors;
    throw err;
  }

  if (prior?.photoId && (download.id || chosen.id) === prior.photoId) {
    const err = new Error(`Repull returned the same photo for ${slotKey} — try again or Upload`);
    err.status = 400;
    throw err;
  }

  const photoId = download.id || chosen.id;
  const slug = slugify(
    chosen.tags?.[0] || chosen.description || slot.serviceName || slot.label || slot.sectionId,
  );
  const idTail = safeIdTail(photoId || Date.now());
  // Always unique filename so browser thumbs / public sync show a real change
  let filename = `${slot.sectionId}-${slot.index}-${slug}-${idTail || Date.now()}.jpg`;
  const usedFilenames = new Set(
    Object.values(manifest.slots || {})
      .filter((s) => s?.key !== slot.key)
      .map((s) => s?.filename)
      .filter(Boolean),
  );
  if (usedFilenames.has(filename)) {
    filename = `${slot.sectionId}-${slot.index}-${slug}-${idTail}-${Date.now().toString(36).slice(-4)}.jpg`;
  }
  mkdirSync(p.siteImages, { recursive: true });
  writeFileSync(path.join(p.siteImages, filename), download.buffer);

  const queryStored = stripMaterialBold(chosenQuery);
  const graded = softFill
    ? {
        matchGrade: 'poor',
        matchTip: 'Best available stock — review/replace',
      }
    : matchGradeFromScore(relevanceScore, { query: queryStored });
  const entry = {
    key: slot.key,
    sectionId: slot.sectionId,
    index: slot.index,
    filename,
    src: `/images/${filename}`,
    alt: stockImageAlt(chosen.description, slot.label, niche),
    provider: providerUsed,
    source: 'stock',
    photoId,
    photographer: download.photographer,
    pageUrl: download.pageUrl,
    query: queryStored,
    score: relevanceScore,
    matchGrade: graded.matchGrade,
    matchTip: graded.matchTip,
    softFill: softFill || undefined,
    attribution: download.attribution,
    serviceName: slot.serviceName || slot.label || null,
    serviceSlug: slot.serviceSlug || null,
    materialTitle: slot.materialTitle || null,
    processTitle: slot.processTitle || null,
    label: slot.label || null,
  };

  const nextManifest = saveSlotIntoManifest(candidateId, entry);
  const synced = syncSiteImagesToPublic(candidateId);
  const contentUpdate = applyImagesToContentFiles(candidateId, [
    ...Object.values(nextManifest.slots || {}).filter((s) => s?.filename),
  ]);

  return {
    ok: true,
    slot: entry,
    synced,
    contentUpdate,
    manifest: nextManifest,
    human: [
      softFill
        ? `Re-pulled ${slot.key} via ${providerUsed} (best available, Poor — review/replace).`
        : `Re-pulled ${slot.key} via ${providerUsed} (score ${relevanceScore}).`,
    ],
    candidate: getCandidateDetail(candidateId),
  };
}

function decodeUploadDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) {
    throw Object.assign(new Error('Expected data URL (data:image/...;base64,...)'), { status: 400 });
  }
  const mime = m[1].toLowerCase();
  let ext = 'jpg';
  if (mime.includes('png')) ext = 'png';
  else if (mime.includes('webp')) ext = 'webp';
  else if (mime.includes('gif')) ext = 'gif';
  else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
  return { buffer: Buffer.from(m[2], 'base64'), ext, mime };
}

/**
 * Operator upload replace for one Structure photo slot (not BA gallery pairs).
 */
export function uploadImageSlot(candidateId, slotKey, body = {}) {
  const slots = listImageSlots(candidateId);
  const slot = slots.find((s) => s.key === slotKey);
  if (!slot) {
    const err = new Error(`Unknown image slot: ${slotKey}`);
    err.status = 404;
    throw err;
  }
  if (slot.sectionId === 'beforeAfter' || slot.sectionId === 'svcBeforeAfter') {
    const err = new Error('Use Before & after (ChatGPT) import for gallery pairs');
    err.status = 400;
    throw err;
  }

  const dataUrl = body.dataUrl || body.file?.dataUrl;
  if (!dataUrl) {
    const err = new Error('Provide dataUrl (data:image/...;base64,...)');
    err.status = 400;
    throw err;
  }
  const decoded = decodeUploadDataUrl(dataUrl);
  if (!decoded.buffer?.length) {
    const err = new Error('Empty image upload');
    err.status = 400;
    throw err;
  }

  const p = pathsFor(candidateId);
  mkdirSync(p.siteImages, { recursive: true });
  const filename = `${slot.sectionId}-${slot.index}-upload.${decoded.ext}`;
  writeFileSync(path.join(p.siteImages, filename), decoded.buffer);

  const alt =
    String(body.alt || '').trim() ||
    `${slot.label || slot.sectionId} photo`;
  const detail = getCandidateDetail(candidateId);
  const config =
    loadAcceptedSiteConfig(candidateId)?.config ||
    detail.siteConfig ||
    detail.siteConfigDraft ||
    {};
  const niche = String(config.niche || detail.config?.niche || 'home service').trim();
  const services = Array.isArray(config.services) ? config.services : [];
  const uploadScore = scoreUploadedSlot(slot, {
    filename,
    alt: alt.slice(0, 180),
    niche,
    services,
  });
  const entry = {
    key: slot.key,
    sectionId: slot.sectionId,
    index: slot.index,
    filename,
    src: `/images/${filename}`,
    alt: alt.slice(0, 180),
    provider: null,
    source: 'upload',
    photoId: `upload:${slot.key}:${Date.now()}`,
    photographer: null,
    pageUrl: null,
    query: uploadScore.query,
    score: uploadScore.score,
    matchGrade: uploadScore.matchGrade,
    matchTip: uploadScore.matchTip,
    attribution: 'Operator upload',
    serviceName: slot.serviceName || slot.label || null,
    serviceSlug: slot.serviceSlug || null,
    materialTitle: slot.materialTitle || null,
    processTitle: slot.processTitle || null,
    label: slot.label || null,
  };

  const nextManifest = saveSlotIntoManifest(candidateId, entry);
  const synced = syncSiteImagesToPublic(candidateId);
  const contentUpdate = applyImagesToContentFiles(candidateId, [
    ...Object.values(nextManifest.slots || {}).filter((s) => s?.filename),
  ]);

  return {
    ok: true,
    slot: entry,
    synced,
    contentUpdate,
    manifest: nextManifest,
    human: [`Uploaded ${filename} for ${slot.key}.`],
    candidate: getCandidateDetail(candidateId),
  };
}

/** Read a file from research/{id}/site-images for Website thumbs. */
export function readSiteImageFile(candidateId, filename) {
  const safe = path.basename(String(filename || ''));
  if (!safe || safe !== filename || safe.includes('..')) {
    const err = new Error('Invalid filename');
    err.status = 400;
    throw err;
  }
  const abs = path.join(pathsFor(candidateId).siteImages, safe);
  if (!existsSync(abs)) {
    const err = new Error('Image not found');
    err.status = 404;
    throw err;
  }
  return { abs, filename: safe };
}
