/**
 * ChatGPT browser before/after prompts + import into gallery slots.
 */
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  renameSync,
} from 'node:fs';
import path from 'node:path';
import { pathsFor, getCandidateDetail, saveMeta } from './candidates.mjs';
import { loadAcceptedSiteConfig } from './content-markdown.mjs';
import { syncSiteImagesToPublic } from './fill-site-images.mjs';

const ROOT = process.cwd();

const MONTHS = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function loadConfig(candidateId) {
  const detail = getCandidateDetail(candidateId);
  return (
    loadAcceptedSiteConfig(candidateId)?.config ||
    detail.siteConfig ||
    detail.siteConfigDraft ||
    {}
  );
}

function roomHint(niche, services) {
  const hay = `${niche || ''} ${(services || []).join(' ')}`.toLowerCase();
  if (/bath|shower|tub/.test(hay)) return 'bathroom';
  if (/kitchen|cabin|counter/.test(hay)) return 'kitchen';
  if (/roof/.test(hay)) return 'home exterior roof';
  if (/hvac|air/.test(hay)) return 'utility / mechanical space';
  return 'residential interior room';
}

/**
 * Build paste-ready ChatGPT image prompts for a candidate.
 */
export function buildBeforeAfterPrompts(candidateId) {
  const config = loadConfig(candidateId);
  const niche = String(config.niche || 'home service').trim();
  const city = String(config.primaryCity || 'the local area').trim();
  const state = String(config.state || '').trim();
  const place = state ? `${city}, ${state}` : city;
  const services = Array.isArray(config.services) ? config.services.slice(0, 3) : [];
  const room = roomHint(niche, services);
  const serviceLine = services.length
    ? `Focus on ${services.slice(0, 2).join(' and ')}.`
    : `Focus on typical ${niche.toLowerCase()} work.`;

  const before = [
    `Create a single photorealistic BEFORE photo for a local ${niche} business website.`,
    `Setting: a dated, worn ${room} in a real home in ${place}.`,
    serviceLine,
    'Show clear need for professional work (wear, outdated finishes, clutter of materials OK).',
    'Straight-on documentary photo, natural window light, no people, no faces, no text, no logos, no watermarks, no UI.',
    'Aspect ratio 4:3. Realistic residential architecture — not a showroom, not CGI-looking.',
  ].join(' ');

  const after = [
    `Create a single photorealistic AFTER photo that matches the same camera angle and room layout as a before shot of a ${room} remodel.`,
    `Setting: the same ${room} in ${place} after professional ${niche.toLowerCase()} work — clean, finished, inviting.`,
    serviceLine,
    'Same viewpoint and framing as a typical before photo of this room; only finishes and condition should change.',
    'Photoreal, natural light, no people, no faces, no text, no logos, no watermarks.',
    'Aspect ratio 4:3. Looks like a real completed job photo for a contractor website.',
  ].join(' ');

  const pair = [
    'I need a matched BEFORE and AFTER pair for a contractor website (two separate images).',
    `Niche: ${niche}. Location vibe: ${place}. Room: ${room}.`,
    serviceLine,
    '1) BEFORE: dated/worn room needing work.',
    '2) AFTER: same camera angle and layout after a professional remodel.',
    'Photoreal, 4:3, no people, no text/logos/watermarks. Generate the BEFORE first, then the AFTER matching that angle.',
  ].join(' ');

  return {
    niche,
    city,
    state,
    room,
    before,
    after,
    pair,
    chatgptUrl: 'https://chatgpt.com/',
  };
}

/** Parse ChatGPT download names like "ChatGPT Image Aug 11, 2026, 08_03_22 PM.png". */
export function scoreOriginalFileTime(name, lastModified = 0) {
  const raw = String(name || '');
  const m = raw.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4}),?\s+(\d{1,2})[_:](\d{2})[_:](\d{2})\s*(AM|PM)\b/i,
  );
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    let hour = Number(m[4]);
    const min = Number(m[5]);
    const sec = Number(m[6]);
    const ap = m[7].toUpperCase();
    if (ap === 'PM' && hour < 12) hour += 12;
    if (ap === 'AM' && hour === 12) hour = 0;
    const t = Date.UTC(Number(m[3]), month, Number(m[2]), hour, min, sec);
    if (!Number.isNaN(t)) return t;
  }
  const n = Number(lastModified);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function nextPairIndex(siteImagesDir) {
  let max = 0;
  if (!existsSync(siteImagesDir)) return 1;
  for (const name of readdirSync(siteImagesDir)) {
    const m = name.match(/^gallery-ba-(\d+)-(before|after)\./i);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return max + 1;
}

function decodeDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) {
    throw Object.assign(new Error('Expected data URL (data:image/...;base64,...)'), {
      status: 400,
    });
  }
  const mime = m[1].toLowerCase();
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  return { buffer: Buffer.from(m[2], 'base64'), ext, mime };
}

function patchGalleryOnMarkdown(md, entries) {
  if (!entries.length) {
    const galleryRe = /^gallery:\s*\n(?:(?:[ \t]+.*|-(?!-).*)\n)*/m;
    if (galleryRe.test(md)) return md.replace(galleryRe, '');
    return md;
  }
  const lines = entries.map(
    (e) =>
      `  - src: ${JSON.stringify(e.src)}\n    alt: ${JSON.stringify(e.alt)}`,
  );
  const block = `gallery:\n${lines.join('\n')}`;
  const galleryRe = /^gallery:\s*\n(?:(?:[ \t]+.*|-(?!-).*)\n)*/m;
  if (galleryRe.test(md)) return md.replace(galleryRe, `${block}\n`);
  return md.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (full, fm) => {
    if (/^gallery:/m.test(fm)) return full;
    return `---\n${fm.trimEnd()}\n${block}\n---`;
  });
}

function readExistingGallery(md) {
  const m = String(md || '').match(/^gallery:\s*\n((?:(?:[ \t]+.*|-(?!-).*)\n)*)/m);
  if (!m) return [];
  const entries = [];
  const chunks = m[1].split(/^[ \t]*-(?!-)[ \t]*/m).filter(Boolean);
  for (const chunk of chunks) {
    const src = chunk.match(/src:\s*["']?([^"'\n]+)["']?/);
    const alt = chunk.match(/alt:\s*["']([^"']*)["']/) || chunk.match(/alt:\s*(.+)/);
    if (src?.[1]) {
      entries.push({
        src: src[1].trim(),
        alt: (alt?.[1] || '').trim() || 'Project photo',
        filename: path.basename(src[1].trim()),
      });
    }
  }
  return entries;
}

function isGalleryBaEntry(e) {
  return /gallery-ba-\d+-(before|after)\./i.test(e.filename || e.src || '');
}

function isStockBeforeAfterFile(name) {
  return /^(beforeAfter|svcBeforeAfter)-/i.test(name);
}

/** Keep only gallery-ba-* entries; sort each pair before then after. */
function galleryBaOnlyEntries(entries) {
  const ba = (entries || []).filter(isGalleryBaEntry);
  const byPair = new Map();
  for (const e of ba) {
    const m = (e.filename || e.src || '').match(/gallery-ba-(\d+)-(before|after)\./i);
    if (!m) continue;
    const idx = Number(m[1]);
    const role = m[2].toLowerCase();
    if (!byPair.has(idx)) byPair.set(idx, {});
    byPair.get(idx)[role] = e;
  }
  const out = [];
  for (const idx of [...byPair.keys()].sort((a, b) => a - b)) {
    const pair = byPair.get(idx);
    if (pair.before) out.push(pair.before);
    if (pair.after) out.push(pair.after);
  }
  return out;
}

function deleteStockBeforeAfterFiles(dirs) {
  let deleted = 0;
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!isStockBeforeAfterFile(name)) continue;
      try {
        unlinkSync(path.join(dir, name));
        deleted += 1;
      } catch {
        // ignore
      }
    }
  }
  return deleted;
}

/**
 * If gallery-ba-N before/after alts encode ChatGPT times inverted vs role, swap file bytes.
 */
function healInvertedGalleryBaPairs(siteImagesDir, entries) {
  const byPair = new Map();
  for (const e of entries) {
    const m = (e.filename || '').match(/^(gallery-ba-(\d+))-(before|after)\.(\w+)$/i);
    if (!m) continue;
    const idx = Number(m[2]);
    if (!byPair.has(idx)) byPair.set(idx, {});
    byPair.get(idx)[m[3].toLowerCase()] = e;
  }
  let swapped = 0;
  for (const [, pair] of byPair) {
    if (!pair.before || !pair.after) continue;
    const beforeScore = scoreOriginalFileTime(pair.before.alt, 0);
    const afterScore = scoreOriginalFileTime(pair.after.alt, 0);
    if (!beforeScore || !afterScore || beforeScore <= afterScore) continue;
    const beforePath = path.join(siteImagesDir, pair.before.filename);
    const afterPath = path.join(siteImagesDir, pair.after.filename);
    if (!existsSync(beforePath) || !existsSync(afterPath)) continue;
    const tmp = `${beforePath}.swap-tmp`;
    renameSync(beforePath, tmp);
    renameSync(afterPath, beforePath);
    renameSync(tmp, afterPath);
    const altBefore = pair.before.alt;
    pair.before.alt = pair.after.alt.replace(/^After\b/i, 'Before');
    pair.after.alt = altBefore.replace(/^Before\b/i, 'After');
    swapped += 1;
  }
  return swapped;
}

function writeGalleryBaOnly(md, baEntries) {
  return patchGalleryOnMarkdown(md, galleryBaOnlyEntries(baEntries));
}

/**
 * Import a before+after pair from base64 data URLs into site-images + gallery FM.
 * Accepts either ordered before/after fields OR files[] with name/lastModified/dataUrl
 * (earlier filename time → Before).
 */
export function importBeforeAfterPair(candidateId, body = {}) {
  const p = pathsFor(candidateId);
  const config = loadConfig(candidateId);
  const niche = String(config.niche || 'remodel').trim();
  const city = String(config.primaryCity || '').trim();

  mkdirSync(p.siteImages, { recursive: true });

  let beforeDecoded;
  let afterDecoded;
  let beforeOrigName = '';
  let afterOrigName = '';

  const files = Array.isArray(body.files) ? body.files.filter((f) => f?.dataUrl) : [];
  if (files.length >= 2) {
    const scored = files.slice(0, 2).map((f, i) => ({
      ...f,
      score: scoreOriginalFileTime(f.name, f.lastModified),
      i,
    }));
    scored.sort((a, b) => a.score - b.score || a.i - b.i);
    beforeDecoded = decodeDataUrl(scored[0].dataUrl);
    afterDecoded = decodeDataUrl(scored[1].dataUrl);
    beforeOrigName = String(scored[0].name || '');
    afterOrigName = String(scored[1].name || '');
  } else if (body.beforeDataUrl && body.afterDataUrl) {
    // Legacy: still sort if original names provided
    const a = {
      dataUrl: body.beforeDataUrl,
      name: body.beforeName || body.beforeAlt || '',
      lastModified: body.beforeLastModified || 0,
    };
    const b = {
      dataUrl: body.afterDataUrl,
      name: body.afterName || body.afterAlt || '',
      lastModified: body.afterLastModified || 0,
    };
    const scored = [a, b]
      .map((f, i) => ({ ...f, score: scoreOriginalFileTime(f.name, f.lastModified), i }))
      .sort((x, y) => x.score - y.score || x.i - y.i);
    beforeDecoded = decodeDataUrl(scored[0].dataUrl);
    afterDecoded = decodeDataUrl(scored[1].dataUrl);
    beforeOrigName = String(scored[0].name || '');
    afterOrigName = String(scored[1].name || '');
  } else {
    throw Object.assign(
      new Error('Provide files[2] with dataUrl (or beforeDataUrl + afterDataUrl)'),
      { status: 400 },
    );
  }

  const deletedStock = deleteStockBeforeAfterFiles([
    p.siteImages,
    path.join(ROOT, 'public', 'images'),
    existsSync(p.siteStaging) ? path.join(p.siteStaging, 'public', 'images') : null,
  ]);

  // Heal any already-on-disk inverted pairs before writing new ones
  const existingBa = [];
  if (existsSync(p.siteImages)) {
    for (const name of readdirSync(p.siteImages)) {
      if (/^gallery-ba-\d+-(before|after)\./i.test(name)) {
        existingBa.push({ filename: name, src: `/images/${name}`, alt: name });
      }
    }
  }
  // Prefer alts from content FM when healing
  for (const key of ['content', 'contentDraft']) {
    const file = p[key];
    if (!existsSync(file)) continue;
    try {
      const doc = JSON.parse(readFileSync(file, 'utf8'));
      const indexKey = Object.keys(doc.files || {}).find((k) => /pages\/index\.md$/i.test(k));
      if (!indexKey) continue;
      for (const e of readExistingGallery(doc.files[indexKey]).filter(isGalleryBaEntry)) {
        const hit = existingBa.find((x) => x.filename === e.filename);
        if (hit) hit.alt = e.alt;
      }
    } catch {
      // ignore
    }
  }
  healInvertedGalleryBaPairs(p.siteImages, existingBa);

  const pairIndex = nextPairIndex(p.siteImages);
  const beforeName = `gallery-ba-${pairIndex}-before.${beforeDecoded.ext}`;
  const afterName = `gallery-ba-${pairIndex}-after.${afterDecoded.ext}`;
  writeFileSync(path.join(p.siteImages, beforeName), beforeDecoded.buffer);
  writeFileSync(path.join(p.siteImages, afterName), afterDecoded.buffer);

  const beforeAlt =
    `Before — ${beforeOrigName || `${niche}${city ? ` in ${city}` : ''} (ChatGPT)`}`.slice(0, 160);
  const afterAlt =
    `After — ${afterOrigName || `${niche}${city ? ` in ${city}` : ''} (ChatGPT)`}`.slice(0, 160);

  const newEntries = [
    { filename: beforeName, src: `/images/${beforeName}`, alt: beforeAlt },
    { filename: afterName, src: `/images/${afterName}`, alt: afterAlt },
  ];

  // Collect all gallery-ba entries on disk after write
  const allBa = [];
  for (const name of readdirSync(p.siteImages)) {
    const m = name.match(/^gallery-ba-(\d+)-(before|after)\.(\w+)$/i);
    if (!m) continue;
    const role = m[2].toLowerCase();
    const preset = newEntries.find((e) => e.filename === name);
    allBa.push({
      filename: name,
      src: `/images/${name}`,
      alt:
        preset?.alt ||
        existingBa.find((e) => e.filename === name)?.alt ||
        `${role === 'before' ? 'Before' : 'After'} — ${niche}`,
    });
  }

  let patched = 0;
  for (const key of ['content', 'contentDraft']) {
    const file = p[key];
    if (!existsSync(file)) continue;
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    if (!doc?.files) continue;
    const indexKey = Object.keys(doc.files).find((k) => /pages\/index\.md$/i.test(k));
    if (!indexKey) continue;
    // Preserve alts from prior BA FM where possible
    const prior = readExistingGallery(doc.files[indexKey]).filter(isGalleryBaEntry);
    const merged = allBa.map((e) => {
      const old = prior.find((p0) => p0.filename === e.filename);
      const neu = newEntries.find((n) => n.filename === e.filename);
      return { ...e, alt: neu?.alt || old?.alt || e.alt };
    });
    doc.files[indexKey] = writeGalleryBaOnly(doc.files[indexKey], merged);
    writeJson(file, doc);
    patched += 1;
  }

  const liveIndex = path.join(ROOT, 'src', 'content', 'pages', 'index.md');
  if (existsSync(liveIndex)) {
    const md = readFileSync(liveIndex, 'utf8');
    const prior = readExistingGallery(md).filter(isGalleryBaEntry);
    const merged = allBa.map((e) => {
      const old = prior.find((p0) => p0.filename === e.filename);
      const neu = newEntries.find((n) => n.filename === e.filename);
      return { ...e, alt: neu?.alt || old?.alt || e.alt };
    });
    writeFileSync(liveIndex, writeGalleryBaOnly(md, merged), 'utf8');
    patched += 1;
  }

  // Sync + remove stock copies that sync might have left
  syncSiteImagesToPublic(candidateId);
  deleteStockBeforeAfterFiles([path.join(ROOT, 'public', 'images')]);

  saveMeta(candidateId, { lastBeforeAfterImportAt: new Date().toISOString() });

  return {
    ok: true,
    pairIndex,
    files: newEntries,
    orderedByTime: true,
    deletedStock,
    patched,
    candidate: getCandidateDetail(candidateId),
  };
}
