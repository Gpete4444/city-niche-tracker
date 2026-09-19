/**
 * Assemble git add must not use the default 1MB spawnSync buffer (Windows ENOBUFS).
 * Run: node scripts/test-assemble-git-enobufs.mjs
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
assert(/maxBuffer:\s*64\s*\*\s*1024\s*\*\s*1024/.test(src), 'runGit sets maxBuffer 64MB');
assert(/windowsHide:\s*true/.test(src), 'runGit hides the Windows console');
assert(/runGit\(\['add', '-A'\]/.test(src), 'initGitRepo uses git add -A');
assert(!/runGit\(\['add', '-A', '-q'\]/.test(src), 'git add does not use -q (older Git)');
assert(/ignoreStdout:\s*true/.test(src), 'git add ignores stdout');

console.log('test-assemble-git-enobufs: ok');
