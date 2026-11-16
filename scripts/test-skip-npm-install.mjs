/**
 * A copied node_modules with a matching lockfile hash still installs when the Astro shim is missing.
 * Run: node scripts/test-skip-npm-install.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashPackageDeps, writeDepsHashMarker } from '../ops/lib/assemble-site.mjs';
import { discardPartialNodeModules, removeTreeOrRename, shouldSkipNpmInstall } from '../ops/lib/ship-site.mjs';

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

const stuck = mkdtempSync(path.join(tmpdir(), 'skip-npm-enotempty-'));
const stuckModules = path.join(stuck, 'node_modules');
mkdirSync(path.join(stuckModules, 'pkg'), { recursive: true });
writeFileSync(path.join(stuckModules, 'pkg', 'index.js'), 'module.exports = {};\n');
let removes = 0;
removeTreeOrRename(stuckModules, {
  rm(target) {
    removes += 1;
    if (removes === 1) {
      const err = new Error(`ENOTEMPTY, Directory not empty: ${target}`);
      err.code = 'ENOTEMPTY';
      throw err;
    }
    rmSync(target, { recursive: true, force: true });
  },
});
assert.equal(removes, 2);
assert.equal(existsSync(stuckModules), false);

console.log('test-skip-npm-install: ok');
