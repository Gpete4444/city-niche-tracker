/**
 * Per-FILE opener/closer + location section mix so pages do not share one bookend.
 */

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function hash32(s) {
  let h = 2166136261;
  for (const ch of String(s || '')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(arr, n) {
  const list = arr || [];
  if (!list.length) return null;
  return list[n % list.length];
}

export function classifyContentPath(rel) {
  const p = String(rel || '');
  if (/(^|\/)pages\/index\.md$/i.test(p)) return 'home';
  if (/(^|\/)pages\/about\.md$/i.test(p)) return 'about';
  if (/(^|\/)pages\/contact\.md$/i.test(p)) return 'contact';
  if (/(^|\/)services\//i.test(p)) return 'service';
  if (/(^|\/)locations\//i.test(p)) return 'location';
  return 'other';
}

/**
 * @param {{
 *   candidateId?: string,
 *   filePaths?: string[],
 *   enabledSectionIds?: string[],
 * }} opts
 * @returns {Record<string, { opener: string, closer: string, kind: string }>}
 */
export function assignBookendPolicy(opts = {}) {
  const candidateId = String(opts.candidateId || '');
  const enabled = new Set((opts.enabledSectionIds || []).map(String));
  const policy = {};

  for (const rel of opts.filePaths || []) {
    const path = String(rel || '').trim();
    if (!path) continue;
    const kind = classifyContentPath(path);
    const h = hash32(`${candidateId}|${path}`);

    if (kind === 'about') {
      policy[path] = { opener: 'minimal', closer: 'skip', kind };
      continue;
    }

    if (kind === 'contact') {
      policy[path] = {
        opener: pick(['straight_service', 'minimal', 'question'], h),
        closer: 'skip',
        kind,
      };
      continue;
    }

    const openerPool =
      kind === 'location'
        ? ['local_cue', 'problem', 'straight_service', 'question', 'minimal']
        : kind === 'home'
          ? ['problem', 'question', 'local_cue', 'straight_service']
          : ['problem', 'question', 'straight_service', 'local_cue', 'minimal'];

    const hasCta =
      (kind === 'home' && enabled.has('cta')) ||
      (kind === 'service' && enabled.has('svcCta')) ||
      (kind === 'location' && enabled.has('locCta'));

    policy[path] = {
      opener: pick(openerPool, h),
      closer: hasCta ? 'skip' : pick(['trust_line', 'next_step_link', 'cta_nudge'], h >>> 8),
      kind,
    };
  }

  return policy;
}

export function formatBookendPolicyMarkdown(policy = {}) {
  const lines = [
    '- **Bookends:** honor opener/closer on that FILE only. Do not rewrite every page to a punchy problem + free-estimate close. When closer=`skip`, the registry CTA section is the only estimate ask — last body sentences can be a trust line, routing note, or nothing extra.',
  ];
  for (const [rel, row] of Object.entries(policy)) {
    if (!row) continue;
    lines.push(`  - \`${rel}\`: opener=${row.opener}; closer=${row.closer}`);
  }
  return lines.join('\n');
}

const LOC_SHAPES = ['faq_heavy', 'housing_essay', 'proof_plus_cta'];

/**
 * Rotate Why-choose / FAQ density so suburbs are not one cloned grid.
 * @param {{ suburbs?: string[], enabledSectionIds?: string[] }} opts
 */
export function assignLocationSectionPolicy(opts = {}) {
  const enabled = new Set((opts.enabledSectionIds || []).map(String));
  const policy = {};
  const suburbs = (opts.suburbs || []).map((n) => String(n || '').trim()).filter(Boolean);

  suburbs.forEach((name, i) => {
    const slug = slugify(name);
    if (!slug) return;
    const shape = LOC_SHAPES[i % LOC_SHAPES.length];
    const emit = [];
    if (enabled.has('locIntro')) emit.push('locIntro');
    if (enabled.has('locLocalNotes')) emit.push('locLocalNotes');
    if (shape === 'faq_heavy' && enabled.has('locFaqs')) emit.push('locFaqs');
    if (shape === 'proof_plus_cta' && enabled.has('locProof')) emit.push('locProof');
    if (shape === 'proof_plus_cta' && i % 2 === 0 && enabled.has('locFaqs')) emit.push('locFaqs');
    if (enabled.has('locCta')) emit.push('locCta');
    policy[slug] = { shape, emit, name };
  });

  return policy;
}

export function formatLocationSectionPolicyMarkdown(policy = {}, suburbs = []) {
  const lines = [
    '- **Location section mix:** do not put Why-choose + the same 4 FAQs on every suburb. Follow emit[] for that city. If FAQs or proof are omitted, expand locLocalNotes with sourced locationAngles so the page still differs and stays useful (~600+ words).',
  ];
  const names = suburbs.length ? suburbs : Object.values(policy).map((row) => row?.name).filter(Boolean);
  for (const name of names) {
    const slug = slugify(name);
    const row = policy[slug];
    if (!row) {
      lines.push(`  - ${name}: (no mix — keep distinct; do not clone another suburb)`);
      continue;
    }
    lines.push(`  - ${name} (${row.shape}): emit ${row.emit.join(', ') || 'intro + notes only'}`);
  }
  return lines.join('\n');
}
