/**
 * Verify omitMissing drops nested process[].image when file is missing,
 * keeps HTTP URLs, and keeps present public/ files.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeMarkdownImageFrontmatter } from '../ops/lib/content-markdown.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = path.join(ROOT, 'public', 'images', '_omit-test-tmp');
const presentName = '_omit-test-present.jpg';
const presentPath = path.join(ROOT, 'public', 'images', presentName);

mkdirSync(path.dirname(presentPath), { recursive: true });
writeFileSync(presentPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9])); // tiny jpeg-ish
mkdirSync(tmpDir, { recursive: true });
writeFileSync(path.join(tmpDir, 'only-in-extra.jpg'), Buffer.from([1, 2, 3]));

const missingNested = `---
title: Test
process:
  - title: Step one
    description: Do the thing
    image:
      src: "/images/does-not-exist-xyz.jpg"
      alt: "missing"
  - title: Step two
    description: Finish
    image:
      src: "https://example.com/images/remote.jpg"
      alt: "remote"
  - title: Step three
    description: Done
    image:
      src: "/images/${presentName}"
      alt: "present"
---
Body
`;

const out = sanitizeMarkdownImageFrontmatter(missingNested);
const checks = {
  missingDropped: !/does-not-exist-xyz/.test(out),
  httpKept: /https:\/\/example\.com\/images\/remote\.jpg/.test(out),
  presentKept: new RegExp(presentName.replace('.', '\\.')).test(out),
  stepOneHasNoImage:
    /title: Step one[\s\S]*?description: Do the thing/.test(out) &&
    !/title: Step one[\s\S]*?image:[\s\S]*?does-not-exist/.test(out),
};

const withExtra = `---
title: Extra
heroImage:
  src: "/images/only-in-extra.jpg"
  alt: "extra"
---
Body
`;
const outExtra = sanitizeMarkdownImageFrontmatter(withExtra, { extraRoots: [tmpDir] });
checks.extraRootKept = /only-in-extra\.jpg/.test(outExtra);

const outNoExtra = sanitizeMarkdownImageFrontmatter(withExtra);
checks.extraRootOmittedWithoutOpt = !/only-in-extra\.jpg/.test(outNoExtra);

console.log(checks);
console.log('---out---\n' + out);

try {
  rmSync(presentPath, { force: true });
  rmSync(tmpDir, { recursive: true, force: true });
} catch {
  // ignore cleanup
}

if (!Object.values(checks).every(Boolean)) {
  console.error('FAIL');
  process.exit(1);
}
console.log('PASS');
