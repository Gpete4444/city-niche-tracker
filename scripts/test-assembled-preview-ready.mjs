/**
 * Assembled preview must become ready on the reserved port (HTTP), not a loose
 * Astro 7 stdout match. Run: node scripts/test-assembled-preview-ready.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseLocalAddressPort,
  parsePreviewHopPort,
} from '../ops/lib/assembled-preview.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

const preview = readFileSync(path.resolve('ops/lib/assembled-preview.mjs'), 'utf8');
const assemble = readFileSync(path.resolve('ops/lib/assemble-site.mjs'), 'utf8');
const astroConfig = readFileSync(path.resolve('astro.config.mjs'), 'utf8');

assert(/export function previewHttpReady/.test(preview), 'previewHttpReady is exported');
assert(/httpRequest/.test(preview) && /method:\s*'GET'/.test(preview), 'HTTP GET probe exists');
assert(
  !/\/localhost\|127\\\.0\\\.0\\\.1\|preview\|local\/i/.test(preview),
  'no loose preview+http stdout success regex',
);
assert(
  !/\/preview\/.*\/http\/i|\/http\/i.*\/preview\//.test(preview),
  'no /preview/ && /http/i ready shortcut',
);
assert(
  /ASTRO_PREVIEW_BACKGROUND:\s*ASTRO_PREVIEW_BACKGROUND_SENTINEL/.test(preview) ||
    /ASTRO_PREVIEW_BACKGROUND:\s*['"]rover['"]/.test(preview),
  'spawn sets ASTRO_PREVIEW_BACKGROUND',
);
assert(/ASTRO_PREVIEW_BACKGROUND_SENTINEL\s*=\s*['"]rover['"]/.test(preview), 'sentinel is rover');
assert(/preview\.json/.test(preview) && /unlinkSync/.test(preview), 'stop clears .astro/preview.json');
assert(/preview',\s*'stop'/.test(preview), 'stop runs astro preview stop');
assert(/process\.execPath/.test(preview), 'spawns node astro.mjs (not npx)');
assert(!/spawn\(\s*['"]npx['"]/.test(preview), 'does not spawn npx');
assert(!/shell:\s*true/.test(preview), 'preview spawn does not use shell: true');
assert(/waitUntilPortFree/.test(preview), 'waits until reserved port is free');
assert(/formatPreviewOutput/.test(preview), 'failures include Astro output');
assert(/export function portBindable/.test(preview), 'portBindable is exported');
assert(/exclusive:\s*true/.test(preview), 'bind probe uses exclusive: true');
assert(/reserveBindablePort/.test(preview), 'reserves a bindable pool slot');
assert(/previewServesThisSite/.test(preview), 'reuses orphan preview of this site');
assert(/trying another one/.test(preview), 'detects Vite hop phrase');
assert(/start\.hopped/.test(preview), 'retry-on-hop exists');
assert(/hopped from/.test(preview), 'hop path is not the 90s timeout');
assert(!preview.includes('`:${port}`'), 'netstat match is not a raw :${port} substring');
assert(/parseLocalAddressPort\(parts\[1\]\)/.test(preview), 'netstat uses exact local address port');
assert(/pid === self/.test(preview), 'killPidTree never kills Rover itself');

assert(parseLocalAddressPort('127.0.0.1:4322') === 4322, 'parse 127.0.0.1:4322');
assert(parseLocalAddressPort('[::1]:4322') === 4322, 'parse [::1]:4322');
assert(parseLocalAddressPort('0.0.0.0:43220') === 43220, 'do not treat 43220 as 4322');

const hopOut =
  'Port 4322 is in use, trying another one...\n astro v7.2.0 ready in 14 ms Local http://127.0.0.1:4323/';
assert(parsePreviewHopPort(hopOut, 4322) === 4323, 'hop parser reads 4323 from Local URL');
assert(parsePreviewHopPort('Local http://127.0.0.1:4322/', 4322) == null, 'same-port Local is not a hop');

const watch = assemble.match(/TEMPLATE_LAYOUT_WATCH\s*=\s*\[([\s\S]*?)\]/);
assert(watch, 'TEMPLATE_LAYOUT_WATCH is defined');
assert(/['"]astro\.config\.mjs['"]/.test(watch[1]), 'watch list includes astro.config.mjs');
assert(/rootSt\.isFile\(\)/.test(assemble), 'newestMtimeUnder handles files (astro.config.mjs)');

assert(/preview:\s*\{\s*strictPort:\s*true\s*\}/.test(astroConfig), 'astro.config preview.strictPort');
assert(/server:\s*\{\s*strictPort:\s*true\s*\}/.test(astroConfig), 'astro.config server.strictPort');

console.log('test-assembled-preview-ready: ok');
