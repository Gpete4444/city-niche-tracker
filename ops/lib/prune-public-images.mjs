/**
 * Assembled sites must not upload the shared template image cache.
 * Cloudflare Workers Free allows 20,000 static files per Worker version (error 10304).
 * Keep images referenced from src/ plus public/images/review-avatars/.
 */

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

/** Workers Free static asset cap. Paid raises this to 100,000. */
export const WORKERS_FREE_STATIC_FILE_LIMIT = 20_000;

const SRC_EXT_RE = /\.(?:md|json|astro|ts|js|mjs|css|svg|html)$/i;
const IMAGE_REF_RE = /images\/([^\s"'`<>)\\]+?\.(?:jpe?g|png|webp|avif|gif|svg|ico))/gi;
const SKIP_SRC_DIRS = new Set(['node_modules', 'dist', '.git', '.astro']);

/**
 * @param {number} fileCount
 */
export function distExceedsWorkersFreeLimit(fileCount) {
  return Number(fileCount) >= WORKERS_FREE_STATIC_FILE_LIMIT;
}

/**
 * @param {string} dir
 */
export function countFilesRecursive(dir) {
  let n = 0;
  if (!dir || !existsSync(dir)) return 0;
  const walk = (current) => {
    let names;
    try {
      names = readdirSync(current);
    } catch {
      return;
    }
    for (const name of names) {
      const abs = path.join(current, name);
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink() || st.isFile()) n += 1;
      else if (st.isDirectory()) walk(abs);
    }
  };
  walk(dir);
  return n;
}

/**
 * Image paths under public/ referenced from a tree (posix, relative to public/images/).
 * @param {string} siteRoot
 * @param {string} [relDir] directory under siteRoot to scan (default src/)
 * @returns {Set<string>}
 */
export function collectReferencedPublicImages(siteRoot, relDir = 'src') {
  const refs = new Set();
  const src = path.join(siteRoot, relDir);
  if (!existsSync(src)) return refs;
  const walk = (dir) => {
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (SKIP_SRC_DIRS.has(name)) continue;
      const abs = path.join(dir, name);
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!st.isFile() || !SRC_EXT_RE.test(name)) continue;
      let text;
      try {
        text = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      IMAGE_REF_RE.lastIndex = 0;
      for (const match of text.matchAll(IMAGE_REF_RE)) {
        let rel = String(match[1] || '').split('?')[0].split('#')[0].replace(/\\/g, '/');
        try {
          rel = decodeURIComponent(rel);
        } catch {
          /* keep the raw token */
        }
        if (!rel || rel.includes('..')) continue;
        refs.add(rel);
      }
    }
  };
  walk(src);
  return refs;
}

/**
 * @param {string} imagesDir
 * @returns {{ rel: string, abs: string, isLink: boolean }[]}
 */
function listPublicImageFiles(imagesDir) {
  const files = [];
  if (!existsSync(imagesDir)) return files;
  const walk = (dir, rel) => {
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const abs = path.join(dir, name);
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      const next = rel ? `${rel}/${name}` : name;
      if (st.isSymbolicLink()) {
        files.push({ rel: next, abs, isLink: true });
        continue;
      }
      if (st.isDirectory()) walk(abs, next);
      else if (st.isFile()) files.push({ rel: next, abs, isLink: false });
    }
  };
  walk(imagesDir, '');
  return files;
}

function isReviewAvatar(rel) {
  return rel === 'review-avatars' || rel.startsWith('review-avatars/');
}

/**
 * Copy a referenced image from the template cache when the assembled site is missing it.
 * @param {string} imagesDir
 * @param {string | null} templateImagesDir
 * @param {Set<string>} refs
 */
function backfillMissingRefs(imagesDir, templateImagesDir, refs) {
  const backfilled = [];
  if (!templateImagesDir || !existsSync(templateImagesDir)) return backfilled;
  for (const rel of refs) {
    const dest = path.join(imagesDir, ...rel.split('/'));
    if (existsSync(dest)) continue;
    const from = path.join(templateImagesDir, ...rel.split('/'));
    let st;
    try {
      st = statSync(from);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    try {
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(from, dest);
      backfilled.push(rel);
    } catch {
      /* locked or vanished seed */
    }
  }
  return backfilled;
}

function removeEmptyImageDirs(imagesDir) {
  const walk = (dir) => {
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const abs = path.join(dir, name);
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory() && !st.isSymbolicLink()) walk(abs);
    }
    if (dir === imagesDir) return;
    const rel = path.relative(imagesDir, dir).replace(/\\/g, '/');
    if (isReviewAvatar(rel)) return;
    let left;
    try {
      left = readdirSync(dir);
    } catch {
      return;
    }
    if (left.length === 0) {
      try {
        rmSync(dir, { recursive: false });
      } catch {
        /* locked */
      }
    }
  };
  if (existsSync(imagesDir)) walk(imagesDir);
}

/**
 * Drop public/images files the assembled site does not reference.
 * Review avatars stay (shared defaults). Missing refs are copied from the template cache when present.
 * A locked file is skipped instead of failing the prune.
 * @param {string} siteRoot
 * @param {{ templateImagesDir?: string }} [opts]
 */
export function pruneUnreferencedPublicImages(siteRoot, opts = {}) {
  const root = path.resolve(siteRoot);
  const imagesDir = path.join(root, 'public', 'images');
  const templateImagesDir = opts.templateImagesDir ? path.resolve(opts.templateImagesDir) : null;
  const refs = collectReferencedPublicImages(root);
  // Content and site-config name the files this site actually uses.
  // Shared components also mention fallbacks such as /images/coverage-map.svg;
  // those stay if already on disk, and are not copied in from another candidate's cache.
  const backfillRefs = collectReferencedPublicImages(root, path.join('src', 'content'));
  for (const rel of collectReferencedPublicImages(root, path.join('src', 'config'))) {
    backfillRefs.add(rel);
  }
  mkdirSync(imagesDir, { recursive: true });
  const backfilled = backfillMissingRefs(imagesDir, templateImagesDir, backfillRefs);
  const removed = [];
  const locked = [];
  for (const file of listPublicImageFiles(imagesDir)) {
    if (isReviewAvatar(file.rel) || refs.has(file.rel)) continue;
    try {
      rmSync(file.abs, { force: true });
      removed.push(file.rel);
    } catch {
      locked.push(file.rel);
    }
  }
  removeEmptyImageDirs(imagesDir);
  const kept = listPublicImageFiles(imagesDir).length;
  return {
    referenced: refs.size,
    backfilled,
    removed: removed.length,
    locked: locked.length,
    kept,
  };
}
