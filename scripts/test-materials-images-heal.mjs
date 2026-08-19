import { sanitizeMarkdownImageFrontmatter } from '../ops/lib/content-markdown.mjs';

const broken = `---
title: Test
materialsImages:
gallery:
  - src: "https://example.com/images/materials-1-foo.jpg"
    alt: "a"
  - src: "https://example.com/images/materials-2-bar.jpg"
    alt: "b"
  - src: "https://example.com/images/gallery-ba-1-before.png"
    alt: "c"
---
Body
`;
const fixed = sanitizeMarkdownImageFrontmatter(broken);
console.log('---fixed---\n' + fixed);
const checks = {
  materialsHasList: /materialsImages:\n  - src: "https:\/\/example.com\/images\/materials-1/.test(fixed),
  galleryHasBa: /gallery:\n  - src: "https:\/\/example.com\/images\/gallery-ba-1/.test(fixed),
  noEmptyNest: !/materialsImages:\ngallery:/.test(fixed),
  materials2kept: /materials-2-bar/.test(fixed),
};
console.log(checks);

const ok = `---
title: Test
materialsImages:
  - src: "https://example.com/images/materials-1-foo.jpg"
    alt: "a"
---
Body
`;
const okOut = sanitizeMarkdownImageFrontmatter(ok);
console.log('---ok---\n' + okOut);
console.log({
  validKept: /materialsImages:\n  - src:/.test(okOut) && !/^gallery:/m.test(okOut),
});

if (!Object.values(checks).every(Boolean)) process.exit(1);
if (!/materialsImages:\n  - src:/.test(okOut) || /^gallery:/m.test(okOut)) process.exit(1);
console.log('PASS');
