/**
 * Path constants with no dependency on candidates.mjs.
 * candidates.mjs re-exports RESEARCH_DIR. Modules in the candidates ↔ site-config
 * cycle import that binding while candidates.mjs is still evaluating, so the
 * value has to live here or those modules hit a temporal dead zone on startup.
 */
import path from 'node:path';

export const ROOT = process.cwd();
export const RESEARCH_DIR = path.join(ROOT, 'research');
