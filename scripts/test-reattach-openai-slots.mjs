import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeImageListByIndex,
  openaiSlotFilenamePrefix,
  planPageNamedReattach,
  planUnlinkedOpenaiReattach,
  withFileLock,
} from '../ops/lib/fill-site-images.mjs';

function assertEqual(got, want, label) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) {
    console.error(`${label}: got ${a}, want ${b}`);
    process.exit(1);
  }
}

if (process.env.LOCK_CHILD === '1') {
  withFileLock(process.env.LOCK_PATH, () => {
    const data = JSON.parse(readFileSync(process.env.DATA_PATH, 'utf8'));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    data.keys.push(process.env.LOCK_KEY);
    writeFileSync(process.env.DATA_PATH, JSON.stringify(data));
  });
  process.exit(0);
}

const longA = 'svcProcess-commercial-property-turf-maintenance-1';
const longB = 'svcProcess-commercial-property-turf-maintenance-2';
assertEqual(
  openaiSlotFilenamePrefix(longA),
  openaiSlotFilenamePrefix(longB),
  'long service steps share the old 48-character prefix',
);
assertEqual(openaiSlotFilenamePrefix('hero-1'), 'hero-1', 'short key is its own prefix');

const shared = openaiSlotFilenamePrefix(longA);
const plan = planUnlinkedOpenaiReattach({
  slots: [
    { key: 'hero-1', index: 1, sectionId: 'hero', label: 'Hero' },
    { key: 'intro-1', index: 1, sectionId: 'intro', label: 'Intro' },
    { key: longA, index: 1, sectionId: 'svcProcess' },
    { key: longB, index: 2, sectionId: 'svcProcess' },
    { key: 'cost-1', index: 1, sectionId: 'cost' },
  ],
  files: [
    { name: 'hero-1-openai-old.jpg', mtimeMs: 10 },
    { name: 'hero-1-openai-new.jpg', mtimeMs: 50 },
    { name: 'intro-1-openai-keep.jpg', mtimeMs: 20 },
    { name: `${shared}-openai-a.jpg`, mtimeMs: 90 },
    { name: `${shared}-openai-b.jpg`, mtimeMs: 80 },
  ],
  liveByKey: { 'intro-1': 'intro-1-openai-keep.jpg' },
});
assertEqual(plan.kept, 1, 'filled card stays');
assertEqual(plan.restored.map((row) => row.filename), ['hero-1-openai-new.jpg'], 'newest unique file');
assertEqual(plan.restored[0].tray, ['hero-1-openai-old.jpg'], 'older file goes to the tray');
assertEqual(plan.skippedShared, 2, 'shared prefix attaches nothing');
assertEqual(plan.skippedNoFile, 1, 'card with no file stays empty');

const merged = mergeImageListByIndex(
  [
    { src: '/images/a.jpg', alt: 'a' },
    { src: '/images/b.jpg', alt: 'b' },
    { src: '/images/c.jpg', alt: 'c' },
    { src: '/images/d.jpg', alt: 'd' },
  ],
  [
    { index: 1, filename: 'new-a.jpg', alt: 'A' },
    { index: 4, filename: 'new-d.jpg', alt: 'D' },
  ],
);
assertEqual(
  merged.map((row) => row.src),
  ['/images/new-a.jpg', '/images/b.jpg', '/images/c.jpg', '/images/new-d.jpg'],
  'step 4 does not slide onto step 2',
);

const named = planPageNamedReattach({
  slots: [
    { key: 'svcMaterials-landscape-1', index: 1, sectionId: 'svcMaterials', serviceSlug: 'landscape' },
    { key: 'svcMaterials-landscape-2', index: 2, sectionId: 'svcMaterials', serviceSlug: 'landscape' },
    { key: 'svcProcess-landscape-1', index: 1, sectionId: 'svcProcess', serviceSlug: 'landscape' },
    { key: 'hero-1', index: 1, sectionId: 'hero' },
  ],
  liveByKey: {},
  diskNames: ['mat-1.jpg', 'proc-openai-1.jpg'],
  pageLists: {
    'landscape|materialsImages': ['mat-1.jpg', ''],
    'landscape|processImages': ['proc-openai-1.jpg'],
  },
});
assertEqual(
  named.restored.map((row) => `${row.key}:${row.filename}:${row.source}`),
  ['svcMaterials-landscape-1:mat-1.jpg:', 'svcProcess-landscape-1:proc-openai-1.jpg:openai'],
  'page row attaches the named file',
);
assertEqual(named.skipped, 2, 'blank row and non-service card stay empty');

const dir = mkdtempSync(path.join(tmpdir(), 'rover-manifest-lock-'));
const lockPath = path.join(dir, 'manifest.lock');
const dataPath = path.join(dir, 'data.json');
writeFileSync(dataPath, JSON.stringify({ keys: [] }));
const script = fileURLToPath(import.meta.url);
const children = ['a', 'b'].map(
  (key) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], {
        env: {
          ...process.env,
          LOCK_CHILD: '1',
          LOCK_PATH: lockPath,
          DATA_PATH: dataPath,
          LOCK_KEY: key,
        },
        stdio: 'inherit',
      });
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`lock child ${key} exited ${code}`));
      });
    }),
);
await Promise.all(children);
const saved = JSON.parse(readFileSync(dataPath, 'utf8'));
saved.keys.sort();
assertEqual(saved.keys, ['a', 'b'], 'both locked updates remain');
rmSync(dir, { recursive: true, force: true });

console.log('test-reattach-openai-slots: ok');
