#!/usr/bin/env node
/**
 * First invocation: print the Windows libuv assertion and exit 1.
 * Second invocation: write --out JSON and exit 0.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const marker = process.env.ROVER_UV_RETRY_MARKER;
const outIdx = process.argv.indexOf('--out');
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : '';

if (marker && !existsSync(marker)) {
  mkdirSync(path.dirname(marker), { recursive: true });
  writeFileSync(marker, 'crash\n', 'utf8');
  console.error(
    'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 76',
  );
  process.exit(1);
}

if (outPath) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), serp: { mapPackPresent: false } })}\n`,
    'utf8',
  );
}
