import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const config = JSON.parse(
  await readFile(path.join(root, 'src/config/site-config.json'), 'utf8'),
);
const outputPath = path.join(root, 'public/images/coverage-map.svg');
const areas = config.coverageAreas ?? [
  { name: config.primaryCity, state: config.state },
  ...config.targetSuburbs.map((name) => ({ name, state: config.state })),
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const escapeXml = (value) =>
  String(value).replace(/[<>&'"]/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  })[character]);

async function fetchBoundary(area) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    q: `${area.name}, ${area.state}, USA`,
    format: 'geojson',
    polygon_geojson: '1',
    addressdetails: '1',
    limit: '1',
  });

  const response = await fetch(url, {
    headers: {
      'User-Agent': `${config.domain} coverage-map generator`,
      'Accept-Language': 'en-US,en',
    },
  });

  if (!response.ok) {
    throw new Error(`Boundary lookup failed for ${area.name}: ${response.status}`);
  }

  const data = await response.json();
  const feature = data.features?.[0];
  if (!feature?.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) {
    throw new Error(`No municipal boundary found for ${area.name}, ${area.state}`);
  }

  return { ...area, geometry: feature.geometry };
}

function polygonsFromGeometry(geometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

function allPoints(boundaries) {
  return boundaries.flatMap(({ geometry }) =>
    polygonsFromGeometry(geometry).flatMap((polygon) => polygon.flat()),
  );
}

const boundaries = [];
for (const area of areas) {
  boundaries.push(await fetchBoundary(area));
  await sleep(1100);
}

const width = 1000;
const height = 680;
const padding = 58;
const titleSpace = 74;
const attributionSpace = 30;
const points = allPoints(boundaries);
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
      polygon.map((ring) =>
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
    return `
      <path d="${areaPath(area.geometry)}" fill="${fills[index % fills.length]}" fill-opacity="0.52"
        stroke="#17293a" stroke-width="2.2" stroke-linejoin="round" fill-rule="evenodd"/>
      <g transform="translate(${labelX.toFixed(1)} ${labelY.toFixed(1)})">
        <rect x="-62" y="-18" width="124" height="36" rx="7" fill="#ffffff" fill-opacity="0.92"/>
        <text text-anchor="middle" y="-2" class="city">${name}</text>
        <text text-anchor="middle" y="12" class="state">${state}</text>
      </g>`;
  })
  .join('');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"
  aria-labelledby="title description">
  <title id="title">${escapeXml(config.businessName)} coverage areas</title>
  <desc id="description">Municipal boundaries highlighted for ${escapeXml(areas.map(({ name }) => name).join(', '))}.</desc>
  <style>
    .city { font: 700 13px Arial, sans-serif; fill: #0f1720; }
    .state { font: 600 10px Arial, sans-serif; fill: #5a6570; }
    .heading { font: 700 24px Arial, sans-serif; fill: #0f1720; }
    .subheading { font: 400 12px Arial, sans-serif; fill: #5a6570; }
    .attribution { font: 400 10px Arial, sans-serif; fill: #65717d; }
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

await writeFile(outputPath, svg, 'utf8');
console.log(`Generated ${path.relative(root, outputPath)} with ${boundaries.length} boundaries.`);
