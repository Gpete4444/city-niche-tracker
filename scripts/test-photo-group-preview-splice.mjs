/**
 * The Load photo group dialog counts slots after the niche photo-block splice.
 * Run: node scripts/test-photo-group-preview-splice.mjs
 */
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listImageSlots } from '../ops/lib/fill-site-images.mjs';
import {
  getNichePhotoBlocks,
  slugifyPhotoBlockName,
} from '../ops/lib/niche-photo-blocks.mjs';
import { pathsFor } from '../ops/lib/candidates.mjs';
import {
  contentFilesForPhotoGroupPreview,
  findNicheMaster,
  matchKeyForSlot,
  previewPhotoGroup,
} from '../ops/lib/photo-groups.mjs';

function assert(cond, label) {
  if (!cond) throw new Error(label);
}

function stepCount(slots, sectionId, slug) {
  return slots.filter((slot) => {
    if (slot.sectionId !== sectionId) return false;
    if (slug && slot.serviceSlug !== slug) return false;
    return true;
  }).length;
}

function matchKeyCount(slots) {
  return new Set(slots.map((slot) => matchKeyForSlot(slot)).filter(Boolean)).size;
}

const catalog = getNichePhotoBlocks('artificial turf');
assert(catalog?.version, 'artificial turf photo-block catalog is missing');
const serviceName = Object.keys(catalog.services || {})[0];
assert(serviceName, 'catalog has no services');
const slug = slugifyPhotoBlockName(serviceName);
const serviceRel = `src/content/services/${slug}.md`;

const homeSteps = Array.from({ length: 8 }, (_, i) => {
  const n = i + 1;
  return `  - title: Extra home ${n}\n    description: Home detail ${n} stays off the shared list.`;
}).join('\n');
const serviceSteps = Array.from({ length: 8 }, (_, i) => {
  const n = i + 1;
  return `- **Extra step ${n}** — Detail sentence for step ${n} that is not a shared title.`;
}).join('\n');

const homeMd = `---
title: Home
process:
${homeSteps}
---

Intro.
`;
const serviceMd = `---
serviceName: "${serviceName}"
---

Intro paragraph.

## Our process

${serviceSteps}
`;

const id = 'tmp-photo-preview-splice';
const p = pathsFor(id);
const written = [p.research, p.siteConfig, p.contentStructure, p.contentDraft];

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

try {
  writeJson(p.research, { id });
  writeJson(p.siteConfig, {
    niche: 'artificial turf',
    businessName: 'Preview splice turf',
    primaryCity: 'Testville',
    state: 'AZ',
    services: [serviceName],
    commercialServices: [],
  });
  writeJson(p.contentStructure, {
    sections: ['process', 'materials', 'svcProcess', 'svcMaterials', 'services'],
    pages: ['home', 'services'],
    photos: {
      process: { enabled: true, count: 8 },
      materials: { enabled: true, count: 6 },
      svcProcess: { enabled: true, count: 8 },
      svcMaterials: { enabled: true, count: 6 },
      svcHero: { enabled: true, count: 1 },
      services: { enabled: true, count: 1 },
    },
  });
  const draft = {
    files: {
      'src/content/pages/index.md': homeMd,
      [serviceRel]: serviceMd,
    },
  };
  writeJson(p.contentDraft, draft);
  const beforeBytes = readFileSync(p.contentDraft, 'utf8');
  const spliced = contentFilesForPhotoGroupPreview(id);
  assert(spliced, 'preview splice returns a copy when the draft has extra steps');
  assert(readFileSync(p.contentDraft, 'utf8') === beforeBytes, 'preview splice does not write the draft');
  assert(!spliced[serviceRel].includes('Extra step 8'), 'spliced service drops step 8');
  assert(!spliced['src/content/pages/index.md'].includes('Extra home 8'), 'spliced homepage drops step 8');

  const unsplicedSlots = listImageSlots(id, { contentFiles: draft.files });
  assert(stepCount(unsplicedSlots, 'process') === 8, `unspliced home process ${stepCount(unsplicedSlots, 'process')}`);
  assert(
    stepCount(unsplicedSlots, 'svcProcess', slug) === 8,
    `unspliced service process ${stepCount(unsplicedSlots, 'svcProcess', slug)}`,
  );

  const splicedSlots = listImageSlots(id, { contentFiles: spliced });
  assert(stepCount(splicedSlots, 'process') === 6, `spliced home process ${stepCount(splicedSlots, 'process')}`);
  assert(
    stepCount(splicedSlots, 'svcProcess', slug) === 6,
    `spliced service process ${stepCount(splicedSlots, 'svcProcess', slug)}`,
  );

  const master = findNicheMaster('artificial turf');
  assert(master?.id, 'artificial turf master photo group is missing');
  const preview = previewPhotoGroup(id, { groupIds: [master.id] });
  const splicedKeys = matchKeyCount(splicedSlots);
  const unsplicedKeys = matchKeyCount(unsplicedSlots);
  assert(unsplicedKeys !== splicedKeys, `splice should change the slot set (${unsplicedKeys} vs ${splicedKeys})`);
  assert(
    preview.applied + preview.targetEmpty === splicedKeys,
    `dialog counts spliced slots ${preview.applied}+${preview.targetEmpty}, expected ${splicedKeys} not disk ${unsplicedKeys}`,
  );

  writeJson(p.contentDraft, draft);
  assert(contentFilesForPhotoGroupPreview(id), 'draft on disk is still the unspliced copy');
  writeJson(p.contentDraft, { files: spliced });
  assert(contentFilesForPhotoGroupPreview(id) === null, 'aligned pages are not spliced again');
  console.log('photo group preview splice ok');
} catch (error) {
  console.error(error?.message || error);
  process.exitCode = 1;
} finally {
  for (const file of written) {
    try {
      unlinkSync(file);
    } catch {
      // already gone
    }
  }
  const dir = path.dirname(p.research);
  for (const name of readdirSync(dir)) {
    if (name.startsWith(`${id}`)) {
      try {
        unlinkSync(path.join(dir, name));
      } catch {
        // ignore
      }
    }
  }
}
