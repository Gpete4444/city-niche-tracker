import { sanitizeMarkdownImageFrontmatter, healStagedMarkdown } from '../ops/lib/content-markdown.mjs';

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

const hooverEmptyThenNextKey = `---
title: Drywall Patching
beforeAfterImages:
processImages:
  - src: "https://example.com/images/process-1-foo.jpg"
    alt: "a"
---
Body
`;
const hooverSanitized = sanitizeMarkdownImageFrontmatter(hooverEmptyThenNextKey);
const hooverHealed = healStagedMarkdown(hooverEmptyThenNextKey).markdown;
const hooverChecks = {
  sanitizeDroppedEmpty: !/^beforeAfterImages:/m.test(hooverSanitized),
  sanitizeKeptProcess: /processImages:\n  - src: "https:\/\/example.com\/images\/process-1/.test(hooverSanitized),
  healDroppedEmpty: !/^beforeAfterImages:/m.test(hooverHealed),
  healKeptProcess: /processImages:\n  - src: "https:\/\/example.com\/images\/process-1/.test(hooverHealed),
};
console.log('---hoover---\n' + hooverSanitized);
console.log(hooverChecks);
if (!Object.values(hooverChecks).every(Boolean)) process.exit(1);

const processWithSeeMaterials = `---
title: "Slab Foundation Void-Fill Stabilization"
serviceName: "Slab Foundation Void-Fill Stabilization"
processImages:
  - src: "https://example.com/images/pg1-svcProcess-commercial-foundation-void-filling-2-openai-mu4vk74m.jpg"
    alt: "Void mapping photo"
  - src: "https://example.com/images/see-materials-1-openai-mu4vjias.jpg"
    alt: "Foam expansion"
  - src: "https://example.com/images/svcProcess-slab-foundation-void-fill-stabilizati-openai-mu6evcgg.jpg"
    alt: "Patch and seal photo"
---
## How Our Slab Foundation Void-Fill Stabilization Process Works

- **Void mapping** — Locate and measure the gap along the foundation.
`;
const processSanitized = sanitizeMarkdownImageFrontmatter(processWithSeeMaterials);
const processHealed = healStagedMarkdown(processSanitized).markdown;
const processChecks = {
  sanitizeKeptProcess: /^processImages:/m.test(processSanitized),
  sanitizeKeptSeeMaterials: /see-materials-1-openai-mu4vjias/.test(processSanitized),
  sanitizeNoMaterialsKey: !/^materialsImages:/m.test(processSanitized),
  healKeptProcess: /^processImages:/m.test(processHealed),
  healKeptSeeMaterials: /see-materials-1-openai-mu4vjias/.test(processHealed),
  healNoMaterialsKey: !/^materialsImages:/m.test(processHealed),
};
console.log('---process-see-materials---\n' + processHealed);
console.log(processChecks);
if (!Object.values(processChecks).every(Boolean)) process.exit(1);

console.log('PASS');
