/**
 * Coverage map SVG from site-config coverage areas / suburbs (Nominatim boundaries).
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { pathsFor, getCandidateDetail, saveMeta } from './candidates.mjs';
import { syncSiteImagesToPublic } from './fill-site-images.mjs';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const escapeXml = (value) =>
  String(value).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c],
  );

/** Match content-markdown slugifyContentName (avoid circular import). */
function slugifyAreaName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function fetchBoundary(area, userAgent) {
  const name = String(area.name || '').trim();
  const state = String(area.state || '').trim();
  const aliases = [name];
  if (/^west valley$/i.test(name)) aliases.push('West Valley City');
  if (/^salt lake$/i.test(name)) aliases.push('Salt Lake City');
  if (/^white$/i.test(name)) aliases.push('White City');

  let lastErr = null;
  for (const qName of aliases) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({
      q: `${qName}, ${state}, USA`,
      format: 'geojson',
      polygon_geojson: '1',
      addressdetails: '1',
      limit: '1',
    });
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          'Accept-Language': 'en-US,en',
        },
      });
      if (!response.ok) {
        lastErr = new Error(`Boundary lookup failed for ${qName}: ${response.status}`);
        continue;
      }
      const data = await response.json();
      const feature = data.features?.[0];
      if (!feature?.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) {
        lastErr = new Error(`No municipal boundary found for ${qName}, ${state}`);
        continue;
      }
      return { ...area, name: qName === name ? name : qName, geometry: feature.geometry };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`No municipal boundary found for ${name}, ${state}`);
}

function polygonsFromGeometry(geometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

/**
 * @param {object} config site-config JSON
 * @param {string} outputPath absolute path for SVG
 */
export async function generateCoverageMapSvg(config, outputPath) {
  const areas = config.coverageAreas?.length
    ? config.coverageAreas
    : [
        { name: config.primaryCity, state: config.state },
        ...(config.targetSuburbs || []).map((name) => ({
          name: typeof name === 'string' ? name : name?.name || name?.city,
          state: config.state,
        })),
      ].filter((a) => a?.name && a?.state);

  if (!areas.length) {
    throw Object.assign(new Error('No coverage areas / suburbs configured'), { status: 400 });
  }

  const userAgent = `${config.domain || 'rover.local'} coverage-map generator`;
  const boundaries = [];
  for (const area of areas) {
    boundaries.push(await fetchBoundary(area, userAgent));
    await sleep(1100);
  }

  const width = 1000;
  const height = 680;
  const padding = 58;
  const titleSpace = 74;
  const attributionSpace = 30;
  const points = boundaries.flatMap(({ geometry }) =>
    polygonsFromGeometry(geometry).flatMap((polygon) => polygon.flat()),
  );
  const averageLatitude = points.reduce((sum, [, latitude]) => sum + latitude, 0) / points.length;
  const longitudeScale = Math.cos((averageLatitude * Math.PI) / 180);
  const projected = points.map(([longitude, latitude]) => [longitude * longitudeScale, latitude]);
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const drawingWidth = width - padding * 2;
  const drawingHeight = height - titleSpace - attributionSpace - padding;
  const scale = Math.min(drawingWidth / (maxX - minX), drawingHeight / (maxY - minY));
  const usedWidth = (maxX - minX) * scale;
  const usedHeight = (maxY - minY) * scale;
  const offsetX = (width - usedWidth) / 2;
  const offsetY = titleSpace + (drawingHeight - usedHeight) / 2;

  function project([longitude, latitude]) {
    return [
      offsetX + (longitude * longitudeScale - minX) * scale,
      offsetY + (maxY - latitude) * scale,
    ];
  }

  function areaPath(geometry) {
    return polygonsFromGeometry(geometry)
      .flatMap((polygon) =>
        polygon.map(
          (ring) =>
            ring
              .map((point, index) => {
                const [x, y] = project(point);
                return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(' ') + ' Z',
        ),
      )
      .join(' ');
  }

  function areaCenter(geometry) {
    const areaPoints = polygonsFromGeometry(geometry).flatMap((polygon) => polygon[0]);
    const projectedPoints = areaPoints.map(project);
    const areaXs = projectedPoints.map(([x]) => x);
    const areaYs = projectedPoints.map(([, y]) => y);
    return [
      (Math.min(...areaXs) + Math.max(...areaXs)) / 2,
      (Math.min(...areaYs) + Math.max(...areaYs)) / 2,
    ];
  }

  const fills = ['#e8a317', '#f2b83c', '#dc8f08', '#f6c65f', '#d9a11e', '#edb83d'];
  const areaShapes = boundaries
    .map((area, index) => {
      const [labelX, labelY] = areaCenter(area.geometry);
      const name = escapeXml(area.name);
      const state = escapeXml(area.state);
      const slug = slugifyAreaName(area.name);
      const href = slug ? `/locations/${slug}` : '/';
      return `
      <a href="${escapeXml(href)}" target="_top" rel="noopener">
        <g class="cov-area">
          <path d="${areaPath(area.geometry)}" fill="${fills[index % fills.length]}" fill-opacity="0.52"
            stroke="#17293a" stroke-width="2.2" stroke-linejoin="round" fill-rule="evenodd"/>
          <g transform="translate(${labelX.toFixed(1)} ${labelY.toFixed(1)})">
            <rect class="label-bg" x="-78" y="-22" width="156" height="44" rx="8" fill="#ffffff" fill-opacity="0.92"/>
            <text text-anchor="middle" y="-1" class="city">${name}</text>
            <text text-anchor="middle" y="16" class="state">${state}</text>
          </g>
        </g>
      </a>`;
    })
    .join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"
  aria-label="${escapeXml(config.businessName || 'Service')} service coverage map">
  <style>
    a { text-decoration: none; }
    .city { font: 700 18px Arial, sans-serif; fill: #0f1720; }
    .state { font: 600 11px Arial, sans-serif; fill: #5a6570; }
    .heading { font: 700 24px Arial, sans-serif; fill: #0f1720; }
    .subheading { font: 400 12px Arial, sans-serif; fill: #5a6570; }
    .attribution { font: 400 10px Arial, sans-serif; fill: #65717d; }
    .cov-area { cursor: pointer; transition: opacity 0.15s ease; }
    .cov-area path { transition: fill-opacity 0.15s ease, stroke-width 0.15s ease; }
    .cov-area .label-bg { transition: fill-opacity 0.15s ease; }
    a:hover .cov-area path, .cov-area:hover path { fill-opacity: 0.78; stroke-width: 3.2; }
    a:hover .cov-area .label-bg, .cov-area:hover .label-bg { fill-opacity: 1; }
  </style>
  <rect width="100%" height="100%" rx="14" fill="#f7f9fb"/>
  <path d="M0 110 H1000 M0 220 H1000 M0 330 H1000 M0 440 H1000 M0 550 H1000
    M150 74 V650 M300 74 V650 M450 74 V650 M600 74 V650 M750 74 V650 M900 74 V650"
    stroke="#dce2e7" stroke-width="1"/>
  <text x="40" y="38" class="heading">Service coverage</text>
  <text x="40" y="58" class="subheading">Highlighted municipal boundaries · confirm availability by address</text>
  ${areaShapes}
  <g transform="translate(940 42)">
    <path d="M0 16 L8 -8 L16 16 L8 11 Z" fill="#17293a"/>
    <text x="8" y="29" text-anchor="middle" class="state">N</text>
  </g>
  <text x="40" y="662" class="attribution">Boundary data © OpenStreetMap contributors · ODbL</text>
</svg>`;

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, svg, 'utf8');
  return { areas: areas.length, outputPath, primaryCity: config.primaryCity || '' };
}

function setCoverageMapOnMarkdown(md, src, alt) {
  const block = `coverageMap:\n  src: ${JSON.stringify(src)}\n  alt: ${JSON.stringify(alt)}`;
  const re = /^coverageMap:\s*\n(?:[ \t]+.*\n)*/m;
  if (re.test(md)) return md.replace(re, `${block}\n`);
  return md.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (m, fm) => {
    if (/^coverageMap:/m.test(fm)) return m;
    return `---\n${fm.trimEnd()}\n${block}\n---`;
  });
}

/** Exported for Stage heal when SVG exists but homepage FM omitted coverageMap. */
export { setCoverageMapOnMarkdown };

function patchIndexCoverageMap(candidateId, src, alt) {
  const p = pathsFor(candidateId);
  let patched = 0;
  for (const key of ['content', 'contentDraft']) {
    const file = p[key];
    const doc = readJson(file);
    if (!doc?.files) continue;
    const indexKey = Object.keys(doc.files).find((k) => /pages\/index\.md$/i.test(k));
    if (!indexKey) continue;
    doc.files[indexKey] = setCoverageMapOnMarkdown(doc.files[indexKey], src, alt);
    writeJson(file, doc);
    patched += 1;
  }
  const liveIndex = path.join(ROOT, 'src', 'content', 'pages', 'index.md');
  if (existsSync(liveIndex)) {
    const body = readFileSync(liveIndex, 'utf8');
    writeFileSync(liveIndex, setCoverageMapOnMarkdown(body, src, alt), 'utf8');
    patched += 1;
  }
  return patched;
}

/**
 * Generate coverage map for a candidate into site-images + public + content FM.
 */
export async function generateCoverageMapForCandidate(candidateId) {
  const p = pathsFor(candidateId);
  const config =
    readJson(p.siteConfig) ||
    readJson(p.siteConfigDraft) ||
    readJson(path.join(ROOT, 'src', 'config', 'site-config.json'));
  if (!config) {
    throw Object.assign(new Error('No site-config for coverage map'), { status: 400 });
  }

  mkdirSync(p.siteImages, { recursive: true });
  const abs = path.join(p.siteImages, 'coverage-map.svg');
  const result = await generateCoverageMapSvg(config, abs);
  copyFileSync(abs, path.join(ROOT, 'public', 'images', 'coverage-map.svg'));
  syncSiteImagesToPublic(candidateId);

  const src = '/images/coverage-map.svg';
  const alt = `Coverage map for ${config.primaryCity || 'service'} area`;
  const patched = patchIndexCoverageMap(candidateId, src, alt);

  saveMeta(candidateId, { lastCoverageMapAt: new Date().toISOString() });
  return {
    ok: true,
    ...result,
    src,
    patched,
    path: path.relative(ROOT, abs).replace(/\\/g, '/'),
    candidate: getCandidateDetail(candidateId),
  };
}
