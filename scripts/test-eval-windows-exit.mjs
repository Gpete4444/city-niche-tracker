/**
 * Contract tests for Windows eval child crash (UV_HANDLE_CLOSING) hardening.
 * Run: node scripts/test-eval-windows-exit.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestJson, requestText } from './lib/http-json.mjs';
import {
  getJob,
  lastJobErrorLine,
  isUvHandleClosingCrash,
  setEvalSpawnStaggerMsForTests,
  startJob,
} from '../ops/lib/run-script.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function src(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function catchBlock(fileSrc) {
  const m = fileSrc.match(/main\(\)\.catch\([\s\S]*?\n\}\);/);
  assert.ok(m, 'main().catch block present');
  return m[0];
}

const dfs = src('scripts/lib/dataforseo.mjs');
assert.match(dfs, /requestJson/, 'DataForSEO uses requestJson');
assert.doesNotMatch(dfs, /\bfetch\s*\(/, 'DataForSEO does not call fetch(');

const pages = src('scripts/lib/page-heuristics.mjs');
assert.match(pages, /requestText/, 'page-heuristics uses requestText');
assert.doesNotMatch(pages, /\bfetch\s*\(/, 'page-heuristics does not call fetch(');
assert.doesNotMatch(pages, /AbortController/, 'page-heuristics does not use AbortController');

const httpJson = src('scripts/lib/http-json.mjs');
assert.match(httpJson, /from 'node:https'/, 'http-json imports node:https');
assert.match(httpJson, /Connection:\s*['"]close['"]/, 'http-json sets Connection: close');

for (const rel of [
  'scripts/research-candidate.mjs',
  'scripts/enrich-candidate.mjs',
  'scripts/prospect-renters.mjs',
]) {
  const fileSrc = src(rel);
  const catchSrc = catchBlock(fileSrc);
  assert.match(catchSrc, /exitAfterNetwork/, `${rel} catch uses exitAfterNetwork`);
  assert.doesNotMatch(catchSrc, /process\.exit\s*\(\s*1\s*\)/, `${rel} catch does not process.exit(1)`);
  assert.match(fileSrc, /await exitAfterNetwork\(0\)/, `${rel} success path drains before exit`);
}

const researchSrc = src('scripts/research-candidate.mjs');
assert.match(
  researchSrc,
  /if \(args\.out\)[\s\S]*else \{\s*process\.stdout\.write\(json\)/,
  'research skips stdout JSON when --out is set',
);

const runScriptSrc = src('ops/lib/run-script.mjs');
assert.match(runScriptSrc, /stdio:\s*\['ignore',\s*'pipe',\s*'pipe'\]/, 'startJob ignores stdin');
assert.match(runScriptSrc, /WIN_SPAWN_STAGGER_MS/, 'Windows eval spawn stagger present');
assert.match(runScriptSrc, /_uvRetry/, 'UV_HANDLE_CLOSING retry present');

const splitAssertion =
  'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 76';
const reconstituted = lastJobErrorLine(
  {
    logs: [
      { stream: 'stderr', text: 'Assertion failed: !(handle->flags & UV_HANDLE_CLO' },
      { stream: 'stderr', text: 'SING), file src\\win\\async.c, line 76\n' },
    ],
    logText: '',
  },
  1,
);
assert.equal(reconstituted, splitAssertion, 'lastJobErrorLine joins stderr chunks');
assert.equal(isUvHandleClosingCrash(splitAssertion), true, 'detects UV_HANDLE_CLOSING');
assert.equal(isUvHandleClosingCrash('ordinary failure'), false, 'ignores other errors');

const server = http.createServer((req, res) => {
  assert.equal(req.headers.connection, 'close', 'client sent Connection: close');
  if (req.url === '/redirect') {
    res.statusCode = 302;
    res.setHeader('Location', '/ok.html');
    res.end();
    return;
  }
  if (req.url === '/ok.html') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<html><title>Hello</title><h1>Hi</h1></html>');
    return;
  }
  if (req.method === 'POST' && req.url === '/json') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status_code: 20000, echo: body }));
    });
    return;
  }
  res.statusCode = 404;
  res.end('nope');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;
try {
  const html = await requestText(`${base}/redirect`, { timeoutMs: 5000 });
  assert.equal(html.ok, true, 'follows redirect');
  assert.match(html.text, /<title>Hello<\/title>/, 'redirect body');

  const json = await requestJson(`${base}/json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hello: 'world' }),
    timeoutMs: 5000,
  });
  assert.equal(json.ok, true, 'json post ok');
  assert.equal(json.json.status_code, 20000, 'json parsed');
  assert.equal(json.json.echo.hello, 'world', 'json echo');
} finally {
  server.close();
}

setEvalSpawnStaggerMsForTests(0);
const tmp = mkdtempSync(path.join(os.tmpdir(), 'rover-uv-'));
const marker = path.join(tmp, 'marker.txt');
const outPath = path.join(tmp, 'out.json');
const prevMarker = process.env.ROVER_UV_RETRY_MARKER;
process.env.ROVER_UV_RETRY_MARKER = marker;
try {
  const job = startJob({
    candidateId: '__uv-crash-test__',
    label: 'research',
    script: 'scripts/test-uv-crash-once.mjs',
    args: ['--out', outPath],
  });
  const started = Date.now();
  while (getJob(job.id)?.status === 'running' && Date.now() - started < 15000) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const done = getJob(job.id);
  assert.equal(done.status, 'ok', `retry job ok (got ${done.status}: ${done.error})`);
  assert.match(done.logText, /Retrying after Windows libuv handle crash/, 'logged retry');
  assert.equal(existsSync(marker), true, 'first invocation crashed');
  assert.equal(JSON.parse(readFileSync(outPath, 'utf8')).serp.mapPackPresent, false, 'wrote --out on retry');
} finally {
  if (prevMarker == null) delete process.env.ROVER_UV_RETRY_MARKER;
  else process.env.ROVER_UV_RETRY_MARKER = prevMarker;
  rmSync(tmp, { recursive: true, force: true });
}

console.log('test-eval-windows-exit: ok');
