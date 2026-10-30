/**
 * One shared homepage + per-service process and materials list per niche.
 * Write site authors a missing list once, then every city keeps those titles.
 * The sentence under each title is rewritten for that city.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { RESEARCH_DIR, pathsFor, titleCaseNiche } from './candidates.mjs';
import { isProcessHeading } from '../../src/lib/is-process-heading.mjs';
import { isMaterialsHeading } from '../../src/lib/is-materials-heading.mjs';
import { resolveStructurePageIds, syncLaunchGapsOnOps } from './preview-fidelity.mjs';

export const NICHE_PHOTO_BLOCK_COUNT = 6;

const STORE_FILE = path.join(RESEARCH_DIR, '_niche-photo-blocks.json');

const PHOTO_BLOCK_HOME_PROCESS = ['process', 'offerProcess'];

export function nichePhotoBlockKey(niche) {
  return titleCaseNiche(niche).toLowerCase();
}

function readStore(filePath = STORE_FILE) {
  if (!existsSync(filePath)) return { blocks: {} };
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!data || typeof data.blocks !== 'object' || !data.blocks) return { blocks: {} };
    return { blocks: data.blocks };
  } catch {
    return { blocks: {} };
  }
}

function writeStore(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function cleanText(value, max) {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normTitle(value) {
  return cleanText(value, 120).toLowerCase();
}

export function slugifyPhotoBlockName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function uniqueNames(raw) {
  const out = [];
  const seen = new Set();
  for (const item of raw || []) {
    const name = cleanText(item, 120);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function rowFrom(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = cleanText(raw.title || raw.name, 80);
  const detail = cleanText(raw.detail || raw.description || raw.sentence, 240);
  if (title.length < 2 || detail.length < 8) return null;
  return { title, detail };
}

/** Exactly 6 complete rows, or null. Extra rows are ignored. */
export function photoBlockRows(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const rows = [];
  for (const item of list) {
    const row = rowFrom(item);
    if (!row) continue;
    rows.push(row);
    if (rows.length >= NICHE_PHOTO_BLOCK_COUNT) break;
  }
  return rows.length === NICHE_PHOTO_BLOCK_COUNT ? rows : null;
}

export function photoBlockRowsComplete(raw) {
  return Array.isArray(raw) && raw.length === NICHE_PHOTO_BLOCK_COUNT && raw.every((row) => rowFrom(row));
}

function serviceBlockComplete(block) {
  return photoBlockRowsComplete(block?.process) && photoBlockRowsComplete(block?.materials);
}

function homepageComplete(home) {
  return photoBlockRowsComplete(home?.process) && photoBlockRowsComplete(home?.materials);
}

export function getNichePhotoBlocks(niche, filePath = STORE_FILE) {
  const key = nichePhotoBlockKey(niche);
  if (!key) return null;
  const record = readStore(filePath).blocks[key];
  if (!record || typeof record !== 'object') return null;
  return record;
}

function saveNichePhotoBlocks(record, filePath = STORE_FILE) {
  const key = nichePhotoBlockKey(record?.niche);
  if (!key) {
    throw Object.assign(new Error('Niche is required'), { status: 400 });
  }
  const store = readStore(filePath);
  store.blocks[key] = record;
  writeStore(filePath, store);
  return record;
}

function yamlQuote(value) {
  return JSON.stringify(cleanText(value, 240));
}

function splitFrontmatter(markdown) {
  const m = String(markdown || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { ok: false, frontmatter: '', body: String(markdown || '') };
  return { ok: true, frontmatter: m[1], body: m[2] || '' };
}

function rebuildMarkdown(frontmatter, body) {
  const bodyOut = String(body || '').startsWith('\n') ? body : `\n${body || ''}`;
  const out = `---\n${String(frontmatter).trimEnd()}\n---${bodyOut}`;
  return out.endsWith('\n') ? out : `${out}\n`;
}

function existingHomeProcess(frontmatter) {
  try {
    const data = parseYaml(String(frontmatter || ''));
    const list = Array.isArray(data?.process) ? data.process : [];
    return list
      .map((item) => ({
        title: cleanText(item?.title, 80),
        detail: cleanText(item?.description || item?.detail, 240),
      }))
      .filter((row) => row.title);
  } catch {
    return [];
  }
}

function mergeRowDetails(existing, catalogRows) {
  const byTitle = new Map();
  for (const row of existing || []) {
    const key = normTitle(row.title);
    if (!key || !row.detail || byTitle.has(key)) continue;
    byTitle.set(key, row.detail);
  }
  return catalogRows.map((row) => ({
    title: row.title,
    detail: byTitle.get(normTitle(row.title)) || row.detail,
  }));
}

function formatProcessYaml(rows) {
  return [
    'process:',
    ...rows.flatMap((row) => [
      `  - title: ${yamlQuote(row.title)}`,
      `    description: ${yamlQuote(row.detail)}`,
    ]),
  ].join('\n');
}

function replaceFrontmatterProcess(frontmatter, rows) {
  const lines = String(frontmatter || '').split('\n');
  let start = lines.findIndex((line) => /^process:\s*(\[\])?\s*$/.test(line));
  const block = formatProcessYaml(rows).split('\n');
  if (start < 0) {
    const base = String(frontmatter || '').trimEnd();
    return `${base}${base ? '\n' : ''}${block.join('\n')}\n`;
  }
  let end = start + 1;
  while (end < lines.length) {
    if (lines[end].trim() === '') {
      let look = end + 1;
      while (look < lines.length && lines[look].trim() === '') look += 1;
      if (look < lines.length && /^\s/.test(lines[look])) {
        end = look;
        continue;
      }
      break;
    }
    if (/^\s/.test(lines[end])) {
      end += 1;
      continue;
    }
    break;
  }
  return [...lines.slice(0, start), ...block, ...lines.slice(end)].join('\n');
}

function headingText(line) {
  return String(line || '')
    .replace(/^#{1,2}\s+/, '')
    .trim();
}

function isBulletLine(line) {
  const t = String(line || '').trim();
  return /^[-*•]\s+/.test(t) || /^\d+[.)]\s+/.test(t);
}

function parseBulletTitle(line) {
  const cleaned = cleanText(
    String(line || '')
      .replace(/^[-*•]\s+/, '')
      .replace(/^\d+[.)]\s+/, ''),
    200,
  );
  const em = cleaned.match(/^(.+?)\s+[—–-]\s+(.+)$/);
  if (em) return { title: em[1].trim(), detail: em[2].trim() };
  const colon = cleaned.match(/^(.+?):\s+(.+)$/);
  if (colon && colon[1].split(/\s+/).length <= 8) {
    return { title: colon[1].trim(), detail: colon[2].trim() };
  }
  return { title: '', detail: '' };
}

function existingSectionRows(sectionLines) {
  return sectionLines.map(parseBulletTitle).filter((row) => row.title);
}

function formatProcessBullet(row) {
  return `- **${row.title}** — ${row.detail}`;
}

function formatMaterialsBullet(row) {
  return `- **${row.title}**: ${row.detail}`;
}

function splitBodySections(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let current = { heading: null, lines: [] };
  for (const line of lines) {
    if (/^#{1,2}\s+/.test(line)) {
      sections.push(current);
      current = { heading: line, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections;
}

function joinBodySections(sections) {
  const out = [];
  for (const section of sections) {
    if (section.heading) out.push(section.heading);
    out.push(...section.lines);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function spliceBodySection(body, { matches, fallbackHeading, rows, formatBullet }) {
  const sections = splitBodySections(body);
  let found = -1;
  for (let i = 1; i < sections.length; i += 1) {
    if (matches(headingText(sections[i].heading))) {
      found = i;
      break;
    }
  }
  const merged = mergeRowDetails(
    found >= 0 ? existingSectionRows(sections[found].lines) : [],
    rows,
  );
  const bullets = merged.map(formatBullet);
  if (found < 0) {
    sections.push({ heading: fallbackHeading, lines: ['', ...bullets, ''] });
    return joinBodySections(sections);
  }
  const intro = [];
  for (const line of sections[found].lines) {
    if (isBulletLine(line)) break;
    intro.push(line);
  }
  while (intro.length && intro[intro.length - 1].trim() === '') intro.pop();
  sections[found].lines = [...intro, '', ...bullets, ''];
  return joinBodySections(sections);
}

function withBody(markdown, nextBody) {
  const split = splitFrontmatter(markdown);
  if (!split.ok) {
    const body = String(nextBody || '');
    return body.endsWith('\n') ? body : `${body}\n`;
  }
  return rebuildMarkdown(split.frontmatter, nextBody);
}

function spliceHomeProcess(markdown, rows) {
  const split = splitFrontmatter(markdown);
  if (!split.ok) return markdown;
  const merged = mergeRowDetails(existingHomeProcess(split.frontmatter), rows);
  const frontmatter = replaceFrontmatterProcess(split.frontmatter, merged);
  return rebuildMarkdown(frontmatter, split.body);
}

function serviceBlockForFile(catalog, rel) {
  const slug = String(rel || '')
    .split('/')
    .pop()
    .replace(/\.md$/i, '');
  for (const [name, block] of Object.entries(catalog?.services || {})) {
    if (slugifyPhotoBlockName(name) === slug) return block;
  }
  return null;
}

/**
 * Which photo-bearing sections this Structure still has turned on.
 * A missing structure splices nothing.
 */
export function photoBlockTargets(structure) {
  if (!structure || typeof structure !== 'object') {
    return { homeProcess: false, homeMaterials: false, svcProcess: false, svcMaterials: false };
  }
  const sections = new Set((structure.sections || []).map(String));
  const photos = structure.photos || {};
  const on = (id) => {
    if (!sections.has(id)) return false;
    const photo = photos[id];
    if (photo && photo.enabled === false) return false;
    return true;
  };
  return {
    homeProcess: PHOTO_BLOCK_HOME_PROCESS.some(on),
    homeMaterials: on('materials'),
    svcProcess: on('svcProcess'),
    svcMaterials: on('svcMaterials'),
  };
}

export function photoBlockSectionIds(structure) {
  const targets = photoBlockTargets(structure);
  const ids = [];
  if (targets.homeProcess) ids.push(...PHOTO_BLOCK_HOME_PROCESS);
  if (targets.homeMaterials) ids.push('materials');
  if (targets.svcProcess) ids.push('svcProcess');
  if (targets.svcMaterials) ids.push('svcMaterials');
  return ids;
}

export const PHOTO_BLOCK_SLOT_SECTIONS = new Set([
  'process',
  'offerProcess',
  'materials',
  'svcProcess',
  'svcMaterials',
]);

/**
 * Replace master process/materials slots only when this site was spliced
 * with the current catalog and the master was saved under a different version.
 */
export function shouldReplaceNicheMasterPhotoBlocks({
  masterVersion = 0,
  siteVersion = 0,
  catalogVersion = 0,
} = {}) {
  const catalog = Number(catalogVersion) || 0;
  const site = Number(siteVersion) || 0;
  const master = Number(masterVersion) || 0;
  if (!catalog || site !== catalog) return false;
  return master !== catalog;
}

/**
 * Splice catalog rows into homepage and service markdown.
 * An empty catalog, or a section Structure turned off, leaves those files alone.
 * @returns {{ files: Record<string, string>, changed: boolean, count: number }}
 */
export function applyPhotoBlocksToFiles(files, catalog, structure) {
  const source = files && typeof files === 'object' ? files : {};
  const out = { ...source };
  if (!catalog?.version) return { files: out, changed: false, count: 0 };
  const targets = photoBlockTargets(structure);
  if (!targets.homeProcess && !targets.homeMaterials && !targets.svcProcess && !targets.svcMaterials) {
    return { files: out, changed: false, count: 0 };
  }
  let count = 0;
  for (const [rel, markdown] of Object.entries(source)) {
    let next = String(markdown || '');
    if (/pages\/index\.md$/i.test(rel)) {
      if (targets.homeProcess && photoBlockRowsComplete(catalog.homepage?.process)) {
        next = spliceHomeProcess(next, catalog.homepage.process);
      }
      if (targets.homeMaterials && photoBlockRowsComplete(catalog.homepage?.materials)) {
        const split = splitFrontmatter(next);
        const body = spliceBodySection(split.body, {
          matches: isMaterialsHeading,
          fallbackHeading: '## Materials and methods we use',
          rows: catalog.homepage.materials,
          formatBullet: formatMaterialsBullet,
        });
        next = split.ok ? rebuildMarkdown(split.frontmatter, body) : withBody(next, body);
      }
    } else if (/content\/services\/[^/]+\.md$/i.test(rel)) {
      const block = serviceBlockForFile(catalog, rel);
      if (block && targets.svcProcess && photoBlockRowsComplete(block.process)) {
        const split = splitFrontmatter(next);
        const body = spliceBodySection(split.body, {
          matches: isProcessHeading,
          fallbackHeading: '## Our process',
          rows: block.process,
          formatBullet: formatProcessBullet,
        });
        next = split.ok ? rebuildMarkdown(split.frontmatter, body) : withBody(next, body);
      }
      if (block && targets.svcMaterials && photoBlockRowsComplete(block.materials)) {
        const split = splitFrontmatter(next);
        const body = spliceBodySection(split.body, {
          matches: isMaterialsHeading,
          fallbackHeading: '## Materials and methods we use',
          rows: block.materials,
          formatBullet: formatMaterialsBullet,
        });
        next = split.ok ? rebuildMarkdown(split.frontmatter, body) : withBody(next, body);
      }
    }
    if (next !== String(markdown || '')) {
      out[rel] = next;
      count += 1;
    }
  }
  return { files: out, changed: count > 0, count };
}

function sameSectionList(a, b) {
  const left = Array.isArray(a) ? a.map(String) : [];
  const right = Array.isArray(b) ? b.map(String) : [];
  return left.length === right.length && left.every((id, i) => id === right[i]);
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Splice the saved catalog into this candidate's draft and accepted content.
 * Does not clear write-batch stamps. No-op when the niche has no catalog
 * or Structure has those sections turned off.
 */
export async function applyStoredNichePhotoBlocks(candidateId) {
  const { loadAcceptedSiteConfig } = await import('./content-markdown.mjs');
  const config = loadAcceptedSiteConfig(candidateId)?.config;
  const catalog = getNichePhotoBlocks(config?.niche);
  if (!catalog?.version) return { count: 0, version: 0 };
  const p = pathsFor(candidateId);
  const structure = readJson(p.contentStructure);
  const sectionIds = photoBlockSectionIds(structure);
  if (!sectionIds.length) return { count: 0, version: catalog.version, skipped: true };
  const pageIds = resolveStructurePageIds(candidateId);
  let count = 0;
  for (const key of ['contentDraft', 'content']) {
    const doc = readJson(p[key]);
    if (!doc?.files || typeof doc.files !== 'object') continue;
    const applied = applyPhotoBlocksToFiles(doc.files, catalog, structure);
    const stampOk =
      Number(doc._ops?.photoBlockVersion) === Number(catalog.version) &&
      sameSectionList(doc._ops?.photoBlockSections, sectionIds);
    let files = doc.files;
    let ops = doc._ops || {};
    let dirty = false;
    if (applied.changed || !stampOk) {
      files = applied.files;
      ops = {
        ...ops,
        photoBlockVersion: catalog.version,
        photoBlockSections: sectionIds,
      };
      dirty = true;
    }
    const synced = syncLaunchGapsOnOps(ops, files, config, pageIds);
    if (synced.changed) {
      ops = synced.ops;
      dirty = true;
    }
    if (!dirty) continue;
    doc.files = files;
    doc._ops = ops;
    writeFileSync(p[key], `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    count += applied.count;
  }
  return { count, version: catalog.version, sectionIds };
}

/** Highest photo-block version stamped on accepted content or the draft. */
export function readStampedPhotoBlockVersion(candidateId) {
  const p = pathsFor(candidateId);
  let version = 0;
  for (const key of ['content', 'contentDraft']) {
    const doc = readJson(p[key]);
    const n = Number(doc?._ops?.photoBlockVersion) || 0;
    if (n > version) version = n;
  }
  return version;
}

export function readStampedPhotoBlockSections(candidateId) {
  const p = pathsFor(candidateId);
  for (const key of ['content', 'contentDraft']) {
    const doc = readJson(p[key]);
    const n = Number(doc?._ops?.photoBlockVersion) || 0;
    if (n && Array.isArray(doc?._ops?.photoBlockSections)) return doc._ops.photoBlockSections.map(String);
  }
  return [];
}

function authorPrompt({ niche, serviceNames, needHomepage }) {
  const names = serviceNames.map((name) => `- ${name}`).join('\n');
  return `Author shared photo-block copy for the niche "${niche}".
No city names. No business names. No street names.
Return one JSON object only. No markdown fence.

Shape:
{
  "homepage": {
    "process": [{"title": "short step", "detail": "One generic sentence."}],
    "materials": [{"title": "product name", "detail": "One generic sentence."}]
  },
  "services": {
    "Exact service name": {
      "process": [{"title": "short step", "detail": "One generic sentence."}],
      "materials": [{"title": "product name", "detail": "One generic sentence."}]
    }
  }
}

Rules:
- Every array has exactly ${NICHE_PHOTO_BLOCK_COUNT} items, in display order.
- Titles are concrete and 2–6 words. Details are one sentence, 8–30 words.
- Homepage process is the company-wide job sequence. Homepage materials are the shared products.
- Each service gets its own process sequence and its own products. Do not repeat the same six titles on every service.
- Service name keys must match the list below exactly.
${needHomepage ? '- Include homepage.' : '- Omit homepage. It is already saved.'}
${names ? `\nServices to author:\n${names}` : '\nNo service blocks in this reply.'}`;
}

function takeAuthored(value, { serviceNames, needHomepage }) {
  const homepage = {};
  if (needHomepage) {
    const home = value?.homepage || value?.home || {};
    const process = photoBlockRows(home.process);
    const materials = photoBlockRows(home.materials);
    if (process) homepage.process = process;
    if (materials) homepage.materials = materials;
  }
  const wanted = new Map(serviceNames.map((name) => [name.toLowerCase(), name]));
  const services = {};
  const rawServices = value?.services;
  const entries = Array.isArray(rawServices)
    ? rawServices.map((row) => [row?.name || row?.serviceName, row])
    : Object.entries(rawServices || {});
  for (const [rawName, block] of entries) {
    const canonical = wanted.get(cleanText(rawName, 120).toLowerCase());
    if (!canonical) continue;
    const process = photoBlockRows(block?.process);
    const materials = photoBlockRows(block?.materials);
    if (!process || !materials) continue;
    services[canonical] = { process, materials };
  }
  return { homepage, services };
}

/**
 * Create or gap-fill the niche catalog.
 * Existing service blocks are kept. Names no longer in `serviceNames` are dropped.
 * One Claude JSON call covers only the missing homepage or services.
 * Does nothing when `serviceNames` is empty, so an empty list does not wipe the file.
 */
export async function ensureNichePhotoBlocks({
  niche,
  serviceNames = [],
  callClaude,
  filePath = STORE_FILE,
  signal,
} = {}) {
  const label = titleCaseNiche(niche);
  if (!label) return null;
  const names = uniqueNames(serviceNames);
  if (!names.length) return null;

  let record = getNichePhotoBlocks(label, filePath) || {
    niche: label,
    version: 0,
    homepage: {},
    services: {},
  };
  record.niche = label;
  record.homepage = record.homepage || {};
  record.services = record.services || {};

  const keep = new Map(names.map((name) => [name.toLowerCase(), name]));
  let dropped = false;
  const services = {};
  for (const [rawName, block] of Object.entries(record.services)) {
    const canonical = keep.get(cleanText(rawName, 120).toLowerCase());
    if (!canonical) {
      dropped = true;
      continue;
    }
    if (serviceBlockComplete(block)) services[canonical] = block;
  }
  record.services = services;

  const missingServices = names.filter((name) => !serviceBlockComplete(record.services[name]));
  const needHomepage = !homepageComplete(record.homepage);
  if (!missingServices.length && !needHomepage) {
    if (dropped) {
      record.version = Number(record.version || 0) + 1;
      record.updatedAt = new Date().toISOString();
      saveNichePhotoBlocks(record, filePath);
    }
    return { record, authored: false };
  }
  if (typeof callClaude !== 'function') {
    throw Object.assign(
      new Error('Niche photo blocks are missing. Retry Write site so Rover can author them.'),
      { status: 500 },
    );
  }

  const { claudeJsonWithContinue } = await import('./claude-json-continue.mjs');
  const prompt = authorPrompt({ niche: label, serviceNames: missingServices, needHomepage });
  const result = await claudeJsonWithContinue({
    user: prompt,
    maxTokens: 16384,
    temperature: 0.3,
    signal,
    claudeMessagesFn: async (opts) => callClaude(opts),
  });
  if (!result?.parsed?.ok) {
    throw Object.assign(new Error('Photo block authoring did not return JSON. Retry Write site.'), {
      status: 500,
    });
  }
  const authored = takeAuthored(result.parsed.value, {
    serviceNames: missingServices,
    needHomepage,
  });
  let added = false;
  if (needHomepage && homepageComplete(authored.homepage)) {
    record.homepage = authored.homepage;
    added = true;
  }
  for (const [name, block] of Object.entries(authored.services)) {
    record.services[name] = block;
    added = true;
  }
  if (dropped || added) {
    record.version = Number(record.version || 0) + 1;
    record.updatedAt = new Date().toISOString();
    saveNichePhotoBlocks(record, filePath);
  }
  const stillServices = names.filter((name) => !serviceBlockComplete(record.services[name]));
  const stillHome = !homepageComplete(record.homepage);
  if (stillServices.length || stillHome) {
    const which = [
      stillHome ? 'homepage' : '',
      ...stillServices,
    ]
      .filter(Boolean)
      .join(', ');
    throw Object.assign(
      new Error(`Photo blocks are still missing for ${which}. Retry Write site.`),
      { status: 500 },
    );
  }
  return { record, authored: added };
}

export async function ensureNichePhotoBlocksForCandidate(candidateId, { callClaude, signal } = {}) {
  const { loadAcceptedSiteConfig } = await import('./content-markdown.mjs');
  const { getNicheServiceList } = await import('./niche-service-lists.mjs');
  const config = loadAcceptedSiteConfig(candidateId)?.config;
  if (!config?.niche) return null;
  const siteNames = uniqueNames([...(config.services || []), ...(config.commercialServices || [])]);
  const saved = getNicheServiceList(config.niche);
  const nicheNames = saved
    ? uniqueNames([...(saved.services || []), ...(saved.commercialServices || [])])
    : [];
  const serviceNames = uniqueNames([...nicheNames, ...siteNames]);
  if (!serviceNames.length) return null;
  return ensureNichePhotoBlocks({
    niche: config.niche,
    serviceNames,
    signal,
    callClaude: (opts) => callClaude({ ...opts, signal: opts.signal || signal }),
  });
}

export function formatNichePhotoBlockPrompt(catalog) {
  if (!catalog?.version) return '';
  const lines = [
    '## Niche photo blocks (same titles on every city)',
    'Emit these exact titles, in this order. Do not add, drop, or rename a step or a material.',
    'The catalog sentence names the product or method. Keep that product. Rewrite the sentence for this city with one local condition (housing, soil, climate, or housing age). Do not paste the catalog sentence.',
    'Do not repeat a Zone neighbor sentence when a neighbor digest is present.',
  ];
  if (photoBlockRowsComplete(catalog.homepage?.process)) {
    lines.push('', 'Homepage frontmatter `process:` — exactly these 6:');
    catalog.homepage.process.forEach((row, i) => {
      lines.push(`${i + 1}. **${row.title}** — ${row.detail}`);
    });
  }
  if (photoBlockRowsComplete(catalog.homepage?.materials)) {
    lines.push('', 'Homepage materials section — exactly these 6:');
    catalog.homepage.materials.forEach((row, i) => {
      lines.push(`${i + 1}. **${row.title}**: ${row.detail}`);
    });
  }
  for (const [name, block] of Object.entries(catalog.services || {})) {
    if (!serviceBlockComplete(block)) continue;
    lines.push('', `Service "${name}" (\`src/content/services/${slugifyPhotoBlockName(name)}.md\`):`);
    lines.push('Process:');
    block.process.forEach((row, i) => lines.push(`${i + 1}. **${row.title}** — ${row.detail}`));
    lines.push('Materials:');
    block.materials.forEach((row, i) => lines.push(`${i + 1}. **${row.title}**: ${row.detail}`));
  }
  if (lines.length <= 4) return '';
  return lines.join('\n');
}
