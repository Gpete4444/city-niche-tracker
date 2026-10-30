/**
 * Archetype-aware template contract for content bundles.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getArchetype, normalizeArchetype } from '../../scripts/lib/site-archetypes.mjs';
import { homepageDesignedSectionWarning } from './content-auto-fix.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTRACT_PATH = path.join(ROOT, 'scripts', 'lib', 'template-contract.json');

/** Primary city plus target suburbs, duplicates removed. */
export function configuredLocationCityCount(siteConfig = {}) {
  const cities = [];
  const add = (name) => {
    const city = String(name || '').trim();
    if (!city) return;
    if (cities.some((c) => c.toLowerCase() === city.toLowerCase())) return;
    cities.push(city);
  };
  add(siteConfig?.primaryCity);
  for (const suburb of siteConfig?.targetSuburbs || []) add(suburb);
  return cities.length;
}

/** True when the location files already match the site's city list (at least one). */
export function locationCountMatchesSite(locationFileCount, siteConfig) {
  const configured = configuredLocationCityCount(siteConfig);
  return configured >= 1 && Number(locationFileCount) === configured;
}

function slugifyContentName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function loadTemplateContract() {
  if (!existsSync(CONTRACT_PATH)) {
    throw new Error('Missing scripts/lib/template-contract.json');
  }
  return JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'));
}

function splitFrontmatter(markdown) {
  const m = String(markdown || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { ok: false, error: 'Missing YAML frontmatter' };
  return { ok: true, frontmatter: m[1], body: m[2] || '' };
}

function fmHasKey(fm, key) {
  return new RegExp(`^${key}\\s*:`, 'm').test(fm);
}

/**
 * @param {Record<string,string>} files
 * @param {object} siteConfig
 * @param {{ mode?: 'homepage_first'|'full', pageIds?: string[]|null }} opts
 */
export function runTemplateContract(files, siteConfig, { mode = 'full', pageIds = null } = {}) {
  const contract = loadTemplateContract();
  const archetypeId = normalizeArchetype(siteConfig?.siteArchetype);
  const arch = getArchetype(archetypeId);
  const archRules = contract.archetypes?.[archetypeId] || {};
  const errors = [];
  const warnings = [];
  const paths = Object.keys(files || {});
  const wantsServices = !Array.isArray(pageIds) || !pageIds.length || pageIds.includes('services');

  for (const req of contract.sharedRequiredPages || []) {
    if (!files[req]) errors.push(`Missing required file: ${req}`);
  }

  const indexPath = 'src/content/pages/index.md';
  if (files[indexPath]) {
    const split = splitFrontmatter(files[indexPath]);
    if (!split.ok) errors.push(`index.md: ${split.error}`);
    else {
      for (const key of contract.homepageFrontmatter || []) {
        if (!fmHasKey(split.frontmatter, key)) errors.push(`index.md: missing "${key}"`);
      }
      const missingRecommended = (contract.homepageRecommended || []).filter(
        (key) => !fmHasKey(split.frontmatter, key),
      );
      const missingDesigned = missingRecommended.filter((key) =>
        ['whyChooseUs', 'process', 'faqs'].includes(key),
      );
      if (missingDesigned.length) {
        warnings.push(homepageDesignedSectionWarning(missingDesigned));
      } else if (missingRecommended.includes('sectionHeading')) {
        warnings.push('Homepage intro heading is missing. Re-run Write site.');
      }
    }
  }

  const serviceFiles = paths.filter((p) => p.startsWith('src/content/services/'));
  const locationFiles = paths.filter((p) => p.startsWith('src/content/locations/'));
  const serviceNames = Array.isArray(siteConfig?.services) ? siteConfig.services : [];

  if (mode === 'full') {
    if (!wantsServices) {
      // Structure excluded Services — do not require or warn on service MD count
    } else if (archRules.requireServicePages || arch.requireServicePages) {
      if (serviceFiles.length < (archRules.minServices || arch.minServices || 1)) {
        errors.push(
          `${arch.typeLabel}: need service MD pages (got ${serviceFiles.length}, want ≥${archRules.minServices || arch.minServices})`,
        );
      }
      for (const name of serviceNames) {
        const slug = slugifyContentName(name);
        if (slug && !files[`src/content/services/${slug}.md`]) {
          warnings.push(`No exact services/${slug}.md for "${name}"`);
        }
      }
    } else if (serviceFiles.length > (archRules.maxServicePages ?? 1)) {
      warnings.push(
        `${arch.typeLabel}: expected ≤${archRules.maxServicePages ?? 1} service page(s); got ${serviceFiles.length}`,
      );
    }

    const minLoc = archRules.minLocations ?? arch.minLocations ?? 4;
    const maxLoc = archRules.maxLocations ?? arch.maxLocations ?? 6;
    if (
      !locationCountMatchesSite(locationFiles.length, siteConfig) &&
      (locationFiles.length < minLoc || locationFiles.length > maxLoc)
    ) {
      warnings.push(`Locations: got ${locationFiles.length}, prefer ${minLoc}–${maxLoc}`);
    }
  } else if (
    wantsServices &&
    serviceFiles.length &&
    arch.id === 'single_service' &&
    serviceFiles.length > 1
  ) {
    warnings.push('homepage_first Type B: more than one service file — trim before full build');
  }

  for (const [rel, markdown] of Object.entries(files || {})) {
    const split = splitFrontmatter(markdown);
    if (!split.ok) {
      errors.push(`${rel}: ${split.error}`);
      continue;
    }
    for (const key of ['title', 'description', 'h1']) {
      if (!fmHasKey(split.frontmatter, key)) errors.push(`${rel}: missing "${key}"`);
    }
    if (rel.includes('/services/') && !fmHasKey(split.frontmatter, 'serviceName')) {
      errors.push(`${rel}: missing serviceName`);
    }
    if (rel.includes('/locations/')) {
      if (!fmHasKey(split.frontmatter, 'city')) errors.push(`${rel}: missing city`);
      if (!fmHasKey(split.frontmatter, 'state')) errors.push(`${rel}: missing state`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    archetype: archetypeId,
    mode,
    contractVersion: contract.version,
    summary: {
      total: paths.length,
      pages: paths.filter((p) => p.startsWith('src/content/pages/')).length,
      services: serviceFiles.length,
      locations: locationFiles.length,
    },
  };
}
