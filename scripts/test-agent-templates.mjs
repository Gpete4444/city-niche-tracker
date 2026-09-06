import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPromptTemplate } from '../ops/lib/candidates.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = path.join(ROOT, 'prompts', 'agents');
const LF_ONLY = /```text\n([\s\S]*?)```/;

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

const files = readdirSync(AGENTS)
  .filter((name) => name.endsWith('.md'))
  .sort();
assert(files.includes('content-image-queries.md'), 'content-image-queries.md present');
assert(files.length >= 1, 'at least one agent template');

for (const name of files) {
  const raw = readFileSync(path.join(AGENTS, name), 'utf8');
  const lf = raw.replace(/\r\n/g, '\n');
  const crlf = lf.replace(/\n/g, '\r\n');
  const fromDisk = extractPromptTemplate(raw);
  const fromLf = extractPromptTemplate(lf);
  const fromCrlf = extractPromptTemplate(crlf);
  assert(fromDisk.length > 0, `${name}: empty text block`);
  assert(fromLf === fromCrlf.replace(/\r\n/g, '\n'), `${name}: LF vs CRLF extract mismatch`);
  assert(fromDisk.replace(/\r\n/g, '\n') === fromLf, `${name}: disk extract mismatch vs LF`);
  assert(LF_ONLY.test(lf), `${name}: LF-only regex should match LF`);
  assert(!LF_ONLY.test(crlf), `${name}: LF-only regex must not match CRLF`);
}

console.log(`test-agent-templates: ok (${files.length} files)`);
