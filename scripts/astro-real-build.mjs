/**
 * Run `astro build` with the real site directory as cwd.
 * Rover keeps assembled sites under C:\Repos\rover-sites, a junction to D:\rover-sites.
 * Building through the junction makes Astro drop the CSS bundle as orphaned,
 * so the preview is unstyled HTML. The real path emits /_astro/*.css.
 */
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = realpathSync(path.resolve(here, '..'));
const astro = path.join(root, 'node_modules', 'astro', 'bin', 'astro.mjs');

const child = spawn(process.execPath, [astro, 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  windowsHide: true,
});

child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
