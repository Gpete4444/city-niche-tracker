/**
 * Template schema/config changes must force a full assemble (not content-only refresh).
 * Run: node scripts/test-assemble-template-watch.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

const src = readFileSync(path.resolve('ops/lib/assemble-site.mjs'), 'utf8');
const watch = src.match(/TEMPLATE_LAYOUT_WATCH\s*=\s*\[([\s\S]*?)\]/);
assert(watch, 'TEMPLATE_LAYOUT_WATCH is defined');
assert(/['"]src\/config['"]/.test(watch[1]), 'watch list includes src/config');
assert(/['"]astro\.config\.mjs['"]/.test(watch[1]), 'watch list includes astro.config.mjs');
assert(/['"]src\/cf-assets-worker\.js['"]/.test(watch[1]), 'watch list includes the assets worker');
assert(/['"]src\/components['"]/.test(watch[1]), 'watch list still includes src/components');

console.log('test-assemble-template-watch: ok');
