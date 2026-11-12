/**
 * A copied node_modules with a matching lockfile hash still installs when the Astro shim is missing.
 * Run: node scripts/test-skip-npm-install.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashPackageDeps, writeDepsHashMarker } from '../ops/lib/assemble-site.mjs';
import { discardPartialNodeModules, shouldSkipNpmInstall } from '../ops/lib/ship-site.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'skip-npm-'));
writeFileSync(path.join(dir, 'package.json'), '{"name":"skip-npm"}\n');
assert.equal(shouldSkipNpmInstall(dir), false);

mkdirSync(path.join(dir, 'node_modules'));
writeDepsHashMarker(dir, hashPackageDeps(dir));
assert.equal(shouldSkipNpmInstall(dir), false);

const shimName = process.platform === 'win32' ? 'astro.cmd' : 'astro';
const shim = path.join(dir, 'node_modules', '.bin', shimName);
mkdirSync(path.dirname(shim), { recursive: true });
writeFileSync(shim, 'echo astro\n');
assert.equal(shouldSkipNpmInstall(dir), false);

const sentinel = path.join(dir, 'node_modules', 'shiki', 'dist', 'index.mjs');
mkdirSync(path.dirname(sentinel), { recursive: true });
writeFileSync(sentinel, 'export {}\n');
assert.equal(shouldSkipNpmInstall(dir), true);

const broken = mkdtempSync(path.join(tmpdir(), 'skip-npm-broken-'));
writeFileSync(path.join(broken, 'package.json'), '{"name":"broken"}\n');
mkdirSync(path.join(broken, 'node_modules', '.bin'), { recursive: true });
writeFileSync(path.join(broken, 'node_modules', '.bin', shimName), 'echo astro\n');
writeDepsHashMarker(broken, hashPackageDeps(broken));
assert.equal(discardPartialNodeModules(broken), true);
assert.equal(shouldSkipNpmInstall(broken), false);

console.log('test-skip-npm-install: ok');
