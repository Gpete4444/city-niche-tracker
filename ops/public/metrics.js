/**
 * Display helpers for ops metrics. Bands mirror scripts/lib/scoring-rubric.json.
 * Polarity is explicit: higher-is-better for opportunity scores; Rank is inverted for you.
 */

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FALLBACK_RUBRIC = {
  demandBands: {
    low: { maxExclusive: 60, label: 'Low', howToTreat: 'Only if soft SERP and high ticket.' },
    mid: { minInclusive: 60, maxExclusive: 180, label: 'Mid', howToTreat: 'Default look-closer band.' },
    high: { minInclusive: 180, maxExclusive: 400, label: 'High', howToTreat: 'Strong demand if SERP not locked.' },
    very_high: { minInclusive: 400, label: 'Very high', howToTreat: 'Excellent demand — score competition harder.' },
  },
  volumeMetric: {
    suburbOverlapFactor: 0.25,
  },
  authorityMetric: {
    domainRankBands: {
      low: { maxExclusive: 20, label: 'Low authority (easier)' },
      mid: { minInclusive: 20, maxExclusive: 40, label: 'Mid authority' },
      high: { minInclusive: 40, label: 'High authority (harder)' },
    },
  },
  displaceability: {
    bands: {
      low: { maxExclusive: 4, label: 'Hard to displace' },
      mid: { minInclusive: 4, maxExclusive: 7, label: 'Mixed displaceability' },
      high: { minInclusive: 7, label: 'Likely displaceable' },
    },
  },
  proposedScoreWeights: {
    demand: 0.25,
    competition: 0.25,
    jobValue: 0.2,
    mapPackGap: 0.15,
    displaceability: 0.15,
  },
};

let rubric = FALLBACK_RUBRIC;

export function setRubric(data) {
  if (data) rubric = { ...FALLBACK_RUBRIC, ...data };
}

export function getRubric() {
  return rubric;
}

function inRange(value, rule) {
  if (rule.minInclusive != null && value < rule.minInclusive) return false;
  if (rule.maxExclusive != null && value >= rule.maxExclusive) return false;
  return true;
}

function formatBandRange(rule) {
  if (rule.minInclusive != null && rule.maxExclusive != null) {
    return `${rule.minInclusive}–${rule.maxExclusive - 1}`;
  }
  if (rule.maxExclusive != null) return `<${rule.maxExclusive}`;
  if (rule.minInclusive != null) return `${rule.minInclusive}+`;
  return '';
}

export function classifyClusterVolume(volume) {
  const v = Number(volume);
  if (volume == null || Number.isNaN(v)) {
    return { id: null, label: '—', range: '', howToTreat: '', tone: 'neutral' };
  }
  const bands = rubric.demandBands || FALLBACK_RUBRIC.demandBands;
  for (const [id, band] of Object.entries(bands)) {
    if (inRange(v, band)) {
      const tone = id === 'low' ? 'bad' : id === 'mid' ? 'mixed' : 'good';
      return {
        id,
        label: band.label,
        range: formatBandRange(band),
        howToTreat: band.howToTreat || '',
        tone,
        volume: v,
      };
    }
  }
  return { id: 'low', label: 'Low', range: '<60', howToTreat: '', tone: 'bad', volume: v };
}

export function clusterVolumeLegend() {
  const bands = rubric.demandBands || FALLBACK_RUBRIC.demandBands;
  return Object.entries(bands)
    .map(([id, b]) => `${b.label} (${formatBandRange(b)}/mo)${b.howToTreat ? `: ${b.howToTreat}` : ''}`)
    .join('\n');
}

/** Opportunity scores 1–10: higher = better. */
export function opportunityTone(score) {
  if (score == null || Number.isNaN(Number(score))) return 'neutral';
  const n = Number(score);
  if (n >= 7) return 'good';
  if (n >= 4) return 'mixed';
  return 'bad';
}

/** Competitor Rank 0–100: higher = harder for you. */
export function domainRankTone(rank) {
  if (rank == null || Number.isNaN(Number(rank))) return 'neutral';
  const n = Number(rank);
  if (n >= 40) return 'bad';
  if (n >= 20) return 'mixed';
  return 'good';
}

/** Thinness 1–10: higher = thinner = easier. */
export function thinnessTone(score) {
  if (score == null || Number.isNaN(Number(score))) return 'neutral';
  const n = Number(score);
  if (n >= 7) return 'good';
  if (n >= 4) return 'mixed';
  return 'bad';
}

export function domainRankBand(rank) {
  if (rank == null) return null;
  const bands = rubric.authorityMetric?.domainRankBands || FALLBACK_RUBRIC.authorityMetric.domainRankBands;
  const n = Number(rank);
  for (const [id, band] of Object.entries(bands)) {
    if (inRange(n, band)) return { id, ...band, range: formatBandRange(band) };
  }
  return null;
}

export function displaceabilityBand(score) {
  if (score == null) return null;
  const bands = rubric.displaceability?.bands || FALLBACK_RUBRIC.displaceability.bands;
  const n = Number(score);
  for (const [id, band] of Object.entries(bands)) {
    if (inRange(n, band)) return { id, ...band, range: formatBandRange(band) };
  }
  return null;
}

/** Large ops tooltip attrs — use data-tip only (no native title; avoids double tips). */
export function tipAttr(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';
  const t = esc(raw);
  return `data-tip="${t}" aria-label="${t}"`;
}

/**
 * Render a scored value with /max, tone, and tooltip.
 */
export function metricHtml({
  value,
  max = 10,
  polarity = 'higher-better',
  label = '',
  extraTip = '',
  tone: toneOverride = null,
  suffix = '',
}) {
  if (value == null || value === '' || Number.isNaN(Number(value))) {
    return `<span class="metric metric-neutral">—</span>`;
  }
  const n = Number(value);
  const display = Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  let tone = toneOverride;
  if (!tone) {
    if (polarity === 'higher-harder') tone = domainRankTone(n);
    else if (polarity === 'higher-thinner') tone = thinnessTone(n);
    else tone = opportunityTone(n);
  }
  const polarityText =
    polarity === 'higher-harder'
      ? 'Higher = stronger competitor = harder for you.'
      : polarity === 'higher-thinner'
        ? 'Higher = thinner page = easier to displace.'
        : 'Higher = better opportunity for you.';
  const tip = [label, `${display}/${max}`, polarityText, extraTip].filter(Boolean).join('\n');
  return `<span class="metric metric-${tone}" ${tipAttr(tip)}><strong>${esc(display)}</strong><span class="metric-max">/${esc(max)}</span>${suffix ? `<span class="metric-suffix">${suffix}</span>` : ''}</span>`;
}

/** Raw cluster sum — display only (demand bands apply to demandVolumeSum). */
export function clusterVolumeHtml(volume) {
  const v = Number(volume);
  if (volume == null || Number.isNaN(v)) return `<span class="metric metric-neutral">—</span>`;
  const tip = [
    'Cluster search volume (sum of city geos) / month — display only.',
    `Current: ${v}/mo`,
    '',
    'Demand bands and the Demand score use demandVolumeSum (primary + α × suburb volumes), not this raw cluster sum.',
    'Higher cluster sum can still mean more measured geos — it is not double-count–corrected.',
  ].join('\n');
  return `<span class="metric metric-neutral" ${tipAttr(tip)}><strong>${esc(v)}</strong><span class="metric-suffix"> /mo</span></span>`;
}

/** Debiased demand volume used for scoring bands. */
export function demandVolumeHtml(volume, { alpha = null } = {}) {
  const band = classifyClusterVolume(volume);
  if (band.volume == null) return `<span class="metric metric-neutral">—</span>`;
  const factor =
    alpha != null && Number.isFinite(Number(alpha))
      ? Number(alpha)
      : rubric.volumeMetric?.suburbOverlapFactor ??
        FALLBACK_RUBRIC.volumeMetric?.suburbOverlapFactor ??
        0.25;
  const tip = [
    'Demand (scored) = primaryVolumeSum + α × max(0, cluster − primary)',
    `α (suburbOverlapFactor) = ${factor}`,
    `Current: ${band.volume}/mo → ${band.label} (${band.range})`,
    band.howToTreat,
    '',
    'Bands (apply to demandVolumeSum, not raw cluster sum):',
    clusterVolumeLegend(),
    '',
    'Higher = more scored demand.',
  ].join('\n');
  return `<span class="metric metric-${band.tone}" ${tipAttr(tip)}><strong>${esc(band.volume)}</strong><span class="metric-suffix"> /mo</span> <span class="metric-band">${esc(band.label)} (${esc(band.range)})</span></span>`;
}

export function strengthLabelHtml(label) {
  const tips = {
    thin_stub: 'Likely thin location/service stub — easier to displace with a dedicated niche homepage.',
    moderate: 'Mixed page strength — review word count and Rank.',
    strong_niche_page: 'Purpose-built niche content — harder to outrank.',
    fetch_failed: 'HTML fetch failed after retry — excluded from displaceability aggregates. Re-run Enrich.',
  };
  const tone =
    label === 'thin_stub'
      ? 'good'
      : label === 'strong_niche_page'
        ? 'bad'
        : label === 'moderate'
          ? 'mixed'
          : label === 'fetch_failed'
            ? 'bad'
            : 'neutral';
  const tip = tips[label] || label || '';
  return `<span class="metric metric-${tone}" ${tipAttr(tip)}>${esc(label || '—')}</span>`;
}

/** Yes/No metric chip (Site?, EMD?, Multi-loc?). */
export function yesNoHtml(value, { yesTip = '', noTip = '', naLabel = '—', naTip = '' } = {}) {
  if (value == null) {
    return `<span class="metric metric-neutral" ${tipAttr(naTip || 'Not available')}>${esc(naLabel)}</span>`;
  }
  if (value) {
    return `<span class="metric metric-mixed" ${tipAttr(yesTip || 'Yes')}>Yes</span>`;
  }
  return `<span class="metric metric-neutral" ${tipAttr(noTip || 'No')}>No</span>`;
}

/**
 * Plain-English thin-words + multi-location summary for Enrichment tab.
 */
export function thinWordsCalloutHtml({
  wordCountSummary = null,
  multiLocationPageCount = null,
  thinStubShare = null,
  pages = [],
} = {}) {
  let summary = wordCountSummary;
  if (!summary && pages?.length) {
    const counts = pages
      .filter((p) => p.kind !== 'map_pack' && !p.fetchFailed && p.signals?.wordCount != null)
      .map((p) => Number(p.signals.wordCount))
      .filter((n) => Number.isFinite(n) && n >= 0)
      .sort((a, b) => a - b);
    if (counts.length) {
      const median =
        counts.length % 2 === 1
          ? counts[(counts.length - 1) / 2]
          : Math.round((counts[counts.length / 2 - 1] + counts[counts.length / 2]) / 2);
      summary = {
        pageCount: counts.length,
        median,
        under400: counts.filter((n) => n < 400).length,
        under800: counts.filter((n) => n < 800).length,
      };
    }
  }
  let multiLoc = multiLocationPageCount;
  if (multiLoc == null && pages?.length) {
    multiLoc = pages.filter(
      (p) => p.kind !== 'map_pack' && !p.fetchFailed && p.signals?.looksMultiLocation,
    ).length;
  }
  if (!summary && (multiLoc == null || multiLoc === 0)) return '';
  const tip = [
    'Thin-words messaging (display only — not a proposedScore input).',
    'Word counts are approximate main-content HTML fetches from Stage 2 enrich.',
    '<400 often reads as stubby; <800 is still thin for a niche homepage target.',
    'Multi-location template signals (nationwide / many city links) bump thinness and usually mean harder national players.',
  ].join('\n');
  const parts = [];
  if (summary?.median != null) {
    parts.push(`Median <strong>${esc(String(summary.median))}</strong> words`);
  }
  if (summary?.pageCount != null && summary.under400 != null) {
    parts.push(
      `${esc(String(summary.under400))}/${esc(String(summary.pageCount))} under 400`,
    );
  }
  if (summary?.pageCount != null && summary.under800 != null) {
    parts.push(
      `${esc(String(summary.under800))}/${esc(String(summary.pageCount))} under 800`,
    );
  }
  if (thinStubShare != null && thinStubShare !== '') {
    parts.push(`thin_stub share ${esc(String(thinStubShare))}`);
  }
  if (multiLoc != null) {
    parts.push(`${esc(String(multiLoc))} multi-location template${Number(multiLoc) === 1 ? '' : 's'}`);
  }
  if (!parts.length) return '';
  return `<div class="callout" ${tipAttr(tip)}><strong>Thin words / multi-loc:</strong> ${parts.join(' · ')}</div>`;
}

export function mapPackHtml(present, { slotCount, reviewsLabel, avgReviews, maxReviews, hasLsa, websiteCount } = {}) {
  if (present == null) return `<span class="metric metric-neutral">—</span>`;
  if (present) {
    const n = slotCount != null && !Number.isNaN(Number(slotCount)) ? Number(slotCount) : null;
    const reviews = reviewsLabel && String(reviewsLabel).trim() ? String(reviewsLabel).trim() : null;
    const sites =
      websiteCount != null && n != null && !Number.isNaN(Number(websiteCount))
        ? `${Number(websiteCount)}/${n} have websites`
        : null;
    const tip = [
      'Map Pack present — compete in blue links first. Map Pack usually needs a real GBP after rent.',
      n != null ? `Local results in pack: ${n} (Google often shows up to 3).` : '',
      sites
        ? `Map Pack websites: ${sites}. Slots without a URL are often GBP-only / phone-lead angles.`
        : '',
      reviews ? `Review counts by pack slot: ${reviews}.` : '',
      avgReviews != null ? `Avg reviews: ${avgReviews}${maxReviews != null ? ` (max ${maxReviews})` : ''}.` : '',
      hasLsa ? 'Local Services Ads also present — phone leads may sit below LSAs.' : '',
      'This is Yes/No occupancy — not a 1–10 “gap score”.',
    ]
      .filter(Boolean)
      .join('\n');
    let label = 'Yes';
    if (reviews) label = `Yes · ${reviews}`;
    else if (n != null) label = `Yes · ${n} locals`;
    if (sites) label += ` · ${sites}`;
    if (hasLsa) label += ' · LSA';
    return `<span class="metric metric-mixed" ${tipAttr(tip)}>${esc(label)}</span>`;
  }
  const tip = [
    'Map Pack absent — stronger early opportunity for a new site (+ later GBP).',
    hasLsa ? 'Local Services Ads present — organic still sits below LSAs.' : '',
  ]
    .filter(Boolean)
    .join('\n');
  const label = hasLsa ? 'No · gap · LSA' : 'No · gap open';
  return `<span class="metric metric-good" ${tipAttr(tip)}>${esc(label)}</span>`;
}

export function serpSoftnessHtml(id) {
  const tips = {
    soft: [
      'SERP softness: soft',
      '≤1 niche homepage and ≤5 unique organic domains.',
      'Few dedicated niche sites — favorable for a new site.',
      'Used by Overall score / openness signals (separate from decision bands).',
    ].join('\n'),
    mixed: [
      'SERP softness: mixed',
      'Between soft and hard — not sparse, not fully crowded.',
      'Weight displaceability and Organic openness more heavily.',
      'Used by Overall score / openness signals (separate from decision bands).',
    ].join('\n'),
    hard: [
      'SERP softness: hard',
      'Map Pack filled with strong locals and/or several dedicated niche sites (≥2 homes + pack, or ≥8 unique domains).',
      'Difficult blue-link SERP.',
      'Used by Overall score / openness signals (separate from decision bands).',
    ].join('\n'),
  };
  const tone = id === 'soft' ? 'good' : id === 'hard' ? 'bad' : id === 'mixed' ? 'mixed' : 'neutral';
  return `<span class="metric metric-${tone}" ${tipAttr(tips[id] || 'SERP softness category for decision rules.')}>${esc(id || '—')}</span>`;
}

export function thWithTip(label, tip) {
  return `<th ${tipAttr(tip)}><span class="th-tip">${esc(label)}</span></th>`;
}

export function legendHtml() {
  return `<div class="metric-legend" ${tipAttr('Color meaning for score badges')}>
    <span class="metric metric-good">Favorable</span>
    <span class="metric metric-mixed">Mixed</span>
    <span class="metric metric-bad">Unfavorable</span>
    <span class="muted legend-note">Hover any score for scale + polarity</span>
  </div>`;
}

export const SCORE_INPUT_TIPS = {
  demand: [
    '1–10 from demandVolumeSum = primary + α × suburb volumes (α default 0.25). Higher = better opportunity.',
    'Bands apply to demandVolumeSum, not raw clusterVolumeSum (cluster is display-only).',
    'Scale:',
    '<30 → 2',
    '30–59 → 4',
    '60–119 → 6',
    '120–179 → 7',
    '180–279 → 8',
    '280–399 → 9',
    '400+ → 10',
    'Not rough geo-phrase ranges.',
  ].join('\n'),
  competition: [
    'Organic openness (score field: competition).',
    'How easy the blue-link SERP looks for a new niche site.',
    'Higher = more open / better for you (not “more competitors”).',
    'Uses the type and blue-link position of classified organic results, organic-domain breadth, and homepage concentration in the first five blue links.',
    'Directories and relevant subpages are more open; dedicated and non-niche homepages reduce openness, especially near the top.',
    'Stage 2 preserves this score. Domain Rank is evaluated separately in Displaceability.',
    'The “SERP softness” chip (soft/mixed/hard) is a separate categorical Rover signal.',
  ].join('\n'),
  jobValue: '1–10 from estimated average job cost. Higher = better opportunity. Set by Claude/human.',
  mapPackGap:
    'Internal weighted input only: absent → 9, present → 3 (not pack size). Prefer the Map Pack Yes/No chip on Overview.',
  displaceability: [
    'Displaceability — how easy blue-link competitor pages look to beat with a new niche homepage.',
    'Higher = easier for you (not a ranking guarantee). Requires Stage 2 enrich.',
    'Per page: thinness from word count, stub URL, niche title/H1, Rank → thin_stub / moderate / strong_niche_page.',
    'Aggregate: start at median thinness; +1 if ≥60% thin stubs; −2 if ≥35% strong pages (−1 more if ≥3 strong); −1 if median Domain Rank ≥40; +1 if <20; clamp 1–10.',
    'Bands: <4 hard to displace · 4–6 mixed · ≥7 likely displaceable.',
  ].join('\n'),
};

/** Plain-English competition tip, preferably with this candidate’s live counts. */
export function competitionOpennessTip({
  uniqueDomainCount = null,
  homepageCount = null,
  score = null,
} = {}) {
  const lines = [
    'Organic openness — how easy the blue-link SERP looks for a new niche site.',
    'Higher = more open / better for you (not “more competitors”).',
    'The score weighs classified result type by blue-link position, then includes organic-domain breadth and homepage concentration in the first five blue links.',
  ];
  if (uniqueDomainCount != null) {
    const n = Number(uniqueDomainCount);
    lines.push(
      `This candidate has ${n} stored organic domain${n === 1 ? '' : 's'} contributing to the breadth signal.`,
    );
  }
  if (homepageCount != null) {
    lines.push(
      `${homepageCount} classified organic homepage${Number(homepageCount) === 1 ? '' : 's'}; homepage impact depends on blue-link position, with an explicit first-five concentration check.`,
    );
  }
  if (score != null) lines.push(`Shown score: ${score}/10.`);
  lines.push('Stage 2 preserves Openness; Domain Rank remains part of Displaceability. SERP softness is a separate categorical signal.');
  return lines.join('\n');
}

/**
 * Plain-English displaceability tip, preferably with Stage 2 enrichment aggregates.
 */
export function displaceabilityTip({
  score = null,
  bandLabel = null,
  pageCount = null,
  thinStubCount = null,
  strongNichePageCount = null,
  medianThinnessScore = null,
  medianDomainRank = null,
  hint = null,
  wordCountSummary = null,
  multiLocationPageCount = null,
} = {}) {
  const lines = [
    'Displaceability — how easy blue-link competitor pages look to beat with a new niche homepage.',
    'Higher = easier for you (not a promise you will rank in 4–6 months).',
    'Requires Stage 2 enrich (fetches pages + DataForSEO Rank).',
    '',
    'How each page is scored:',
    'Start at 5; nudge from word count, location-stub URL, niche in title/H1, multi-location signals, page/domain Rank.',
    'Word bands (informational): <400 very stubby · <800 still thin for a niche homepage · >2000 often stronger.',
    'Multi-location / nationwide template signals bump thinness (+1) — often national players, not local specialists.',
    'Thinness 1–10 (higher = thinner/easier) → thin_stub (≥7), moderate, or strong_niche_page (≤3).',
    '',
    'How the overall score is built:',
    '1. Start from median thinness across organic enrichment pages (Map Pack excluded).',
    '2. +1 if ≥60% of pages are thin stubs.',
    '3. −2 if ≥35% are strong niche pages; −1 more if ≥3 strong pages.',
    '4. −1 if median Domain Rank ≥40; +1 if median Rank <20.',
    '5. Clamp to 1–10.',
    'Bands: <4 hard to displace · 4–6 mixed · ≥7 likely displaceable.',
  ];

  if (pageCount == null && score == null) {
    lines.push('', 'This candidate: — until you run Stage 2 enrich.');
    return lines.join('\n');
  }

  const parts = [];
  if (pageCount != null) parts.push(`${pageCount} page${Number(pageCount) === 1 ? '' : 's'}`);
  if (thinStubCount != null) parts.push(`${thinStubCount} thin stub${Number(thinStubCount) === 1 ? '' : 's'}`);
  if (strongNichePageCount != null) {
    parts.push(`${strongNichePageCount} strong`);
  }
  if (medianThinnessScore != null) parts.push(`median thinness ${medianThinnessScore}`);
  if (medianDomainRank != null) parts.push(`median Domain Rank ${medianDomainRank}`);
  if (wordCountSummary?.median != null) {
    parts.push(
      `median ${wordCountSummary.median} words (${wordCountSummary.under800 ?? '?'}/${wordCountSummary.pageCount ?? '?'} under 800)`,
    );
  }
  if (multiLocationPageCount != null) {
    parts.push(`${multiLocationPageCount} multi-location`);
  }

  let summary = `This candidate: ${parts.join(' · ')}`;
  if (score != null) {
    summary += ` → ${score}/10`;
    if (bandLabel) summary += ` (${bandLabel})`;
    summary += '.';
  } else {
    summary += '.';
  }
  lines.push('', summary);
  if (hint) lines.push(hint);
  return lines.join('\n');
}

const DEFAULT_OVERALL_WEIGHTS = {
  demand: 0.25,
  competition: 0.25,
  jobValue: 0.2,
  mapPackGap: 0.15,
  displaceability: 0.15,
};

/**
 * Same blend as scripts/lib/scoring.mjs proposedScore — for old JSON / live UI.
 * Requires demand, competition, mapPackGap; jobValue + displaceability optional.
 */
export function computeProposedScore(inputs = {}) {
  const w = rubric.proposedScoreWeights || DEFAULT_OVERALL_WEIGHTS;
  const { demand, competition, jobValue = null, mapPackGap, displaceability = null } = inputs;
  if (demand == null || competition == null || mapPackGap == null) return null;

  const parts = [
    { key: 'demand', value: Number(demand), weight: w.demand },
    { key: 'competition', value: Number(competition), weight: w.competition },
    { key: 'mapPackGap', value: Number(mapPackGap), weight: w.mapPackGap },
  ];
  if (jobValue != null && jobValue !== '') {
    parts.push({ key: 'jobValue', value: Number(jobValue), weight: w.jobValue });
  }
  if (displaceability != null && displaceability !== '') {
    parts.push({
      key: 'displaceability',
      value: Number(displaceability),
      weight: w.displaceability,
    });
  }

  const weightSum = parts.reduce((sum, p) => sum + p.weight, 0);
  if (weightSum <= 0) return null;
  const value = parts.reduce((sum, p) => sum + p.value * p.weight, 0) / weightSum;
  return Math.round(value * 10) / 10;
}

export function overallScoreTip(inputs = {}, score = null) {
  const w = rubric.proposedScoreWeights || DEFAULT_OVERALL_WEIGHTS;
  const labels = {
    demand: 'Demand',
    competition: 'Organic openness',
    jobValue: 'Job value',
    mapPackGap: 'Map Pack gap (absent→9, present→3)',
    displaceability: 'Displaceability',
  };
  const order = ['demand', 'competition', 'jobValue', 'mapPackGap', 'displaceability'];
  const included = [];
  const missing = [];
  for (const key of order) {
    if (inputs[key] != null && inputs[key] !== '') {
      included.push(`${labels[key]}=${inputs[key]} (w=${w[key]})`);
    } else {
      missing.push(labels[key]);
    }
  }

  const provisional = inputs.jobValue == null || inputs.jobValue === '';
  const lines = [
    'Overall score — weighted blend of available opportunity inputs (1 decimal).',
    'Higher = better opportunity for you.',
    score != null ? `Shown: ${score}/10.` : '',
    provisional ? 'Provisional — job value not set yet (Claude/human).' : 'Includes job value.',
    inputs.displaceability == null || inputs.displaceability === ''
      ? 'Before Stage 2 enrich: displaceability omitted and weights renormalized.'
      : 'Includes displaceability from Stage 2.',
    '',
    included.length ? `Included: ${included.join('; ')}.` : 'No inputs yet.',
    missing.length ? `Missing (renormalized without): ${missing.join(', ')}.` : '',
    'Full weights when all present: demand 0.25 · openness 0.25 · jobValue 0.20 · mapPackGap 0.15 · displaceability 0.15.',
  ];
  return lines.filter(Boolean).join('\n');
}

export function overallScoreHtml(inputs = {}, storedScore = null, options = {}) {
  const compact = Boolean(options.compact);
  const score = computeProposedScore(inputs) ?? storedScore;
  const tip = overallScoreTip(inputs, score);
  const provisional = inputs.jobValue == null || inputs.jobValue === '';
  const badge = metricHtml({
    value: score,
    max: 10,
    polarity: 'higher-better',
    label: 'Overall score',
    extraTip: tip,
  });
  if (score == null) return badge;
  if (!provisional) return badge;
  if (compact) {
    return `<span class="score-cell">${badge}<abbr class="score-prov" ${tipAttr(tip)}>*</abbr></span>`;
  }
  return `${badge} <span class="metric metric-mixed" ${tipAttr(tip)}>provisional</span>`;
}
