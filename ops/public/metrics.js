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
      ? 'Higher means a stronger site, which is harder for you.'
      : polarity === 'higher-thinner'
        ? 'Higher means a thinner page, which is easier to beat.'
        : 'Higher is better for you.';
  const extra = String(extraTip || '').trim();
  const tip = extra || [label, polarityText].filter(Boolean).join(' ');
  return `<span class="metric metric-${tone}" ${tipAttr(tip)}><strong>${esc(display)}</strong><span class="metric-max">/${esc(max)}</span>${suffix ? `<span class="metric-suffix">${suffix}</span>` : ''}</span>`;
}

/** How Ads volumes should display so statewide/neighbor geos are not implied as the town. */
export function adsVolumeHonesty(vols) {
  if (!vols || typeof vols !== 'object') return { mode: 'none' };
  const skipped =
    Boolean(vols.volumesSkipped) || vols.adsLocationFallback?.kind === 'state';
  if (skipped) {
    const est = Number(vols.estimatedMonthlySearchVolume);
    if (Number.isFinite(est)) {
      return {
        mode: 'estimate',
        estimatedMonthlySearchVolume: est,
        raw: vols.estimatedMonthlySearchVolumeRaw ?? null,
        staleState: vols.adsLocationFallback?.kind === 'state',
      };
    }
    return {
      mode: 'skipped',
      staleState: vols.adsLocationFallback?.kind === 'state',
    };
  }
  if (vols.adsLocationFallback?.kind === 'neighbor') {
    return {
      mode: 'neighbor',
      from: vols.adsLocationFallback.from || vols.adsLocationFallback.locationName || null,
      requested: vols.adsLocationFallback.requested || null,
    };
  }
  return { mode: 'local' };
}

/** Raw cluster sum — display only (demand bands apply to demandVolumeSum). */
export function clusterVolumeHtml(volume) {
  const v = Number(volume);
  if (volume == null || Number.isNaN(v)) return `<span class="metric metric-neutral">—</span>`;
  const tip = 'Total monthly searches across these cities.';
  return `<span class="metric metric-neutral" ${tipAttr(tip)}><strong>${esc(v)}</strong><span class="metric-suffix"> /mo</span></span>`;
}

/** Debiased demand volume used for scoring bands. */
export function demandVolumeHtml(volume, { honesty = null } = {}) {
  if (honesty?.mode === 'estimate') {
    const estimate = Number(volume ?? honesty.estimatedMonthlySearchVolume);
    if (!Number.isFinite(estimate)) {
      return `<span class="metric metric-neutral">—</span>`;
    }
    const tip = 'A rough search guess, not live Google data.';
    return `<span class="metric metric-neutral" ${tipAttr(tip)}><strong>${esc(estimate)}</strong><span class="metric-suffix"> /mo est.</span></span>`;
  }
  if (honesty?.mode === 'skipped') {
    const tip = 'No local search volume for this city yet.';
    return `<span class="metric metric-neutral" ${tipAttr(tip)}>—</span>`;
  }
  const band = classifyClusterVolume(volume);
  if (band.volume == null) return `<span class="metric metric-neutral">—</span>`;
  const tip =
    honesty?.mode === 'neighbor' && honesty.from
      ? `Estimated monthly searches, using nearby ${honesty.from}.`
      : 'Estimated monthly searches. Higher means more demand.';
  return `<span class="metric metric-${band.tone}" ${tipAttr(tip)}><strong>${esc(band.volume)}</strong><span class="metric-suffix"> /mo</span> <span class="metric-band">${esc(band.label)} (${esc(band.range)})</span></span>`;
}

export function strengthLabelHtml(label) {
  const tips = {
    thin_stub: 'Thin page. Easier to beat.',
    moderate: 'Mixed page.',
    strong_niche_page: 'Strong page. Harder to beat.',
    fetch_failed: 'This page could not be read.',
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
  const tip = 'How short the competing pages are.';
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

export function mapPackHtml(present, { slotCount, reviewsLabel, hasLsa, websiteCount } = {}) {
  if (present == null) return `<span class="metric metric-neutral">—</span>`;
  if (present) {
    const n = slotCount != null && !Number.isNaN(Number(slotCount)) ? Number(slotCount) : null;
    const reviews = reviewsLabel && String(reviewsLabel).trim() ? String(reviewsLabel).trim() : null;
    const sites =
      websiteCount != null && n != null && !Number.isNaN(Number(websiteCount))
        ? `${Number(websiteCount)}/${n} have websites`
        : null;
    const tip = reviews
      ? 'A map pack is showing, with review counts listed.'
      : 'A map pack is showing.';
    let label = 'Yes';
    if (reviews) label = `Yes · ${reviews}`;
    else if (n != null) label = `Yes · ${n} locals`;
    if (sites) label += ` · ${sites}`;
    if (hasLsa) label += ' · LSA';
    return `<span class="metric metric-mixed" ${tipAttr(tip)}>${esc(label)}</span>`;
  }
  const tip = 'No map pack. That is easier for a new site.';
  const label = hasLsa ? 'No · gap · LSA' : 'No · gap open';
  return `<span class="metric metric-good" ${tipAttr(tip)}>${esc(label)}</span>`;
}

export function serpSoftnessHtml(id) {
  const tips = {
    soft: 'Few competing sites.',
    mixed: 'In between.',
    hard: 'A crowded results page.',
  };
  const tone = id === 'soft' ? 'good' : id === 'hard' ? 'bad' : id === 'mixed' ? 'mixed' : 'neutral';
  return `<span class="metric metric-${tone}" ${tipAttr(tips[id] || 'How crowded the search results are.')}>${esc(id || '—')}</span>`;
}

export function thWithTip(label, tip) {
  return `<th ${tipAttr(tip)}><span class="th-tip">${esc(label)}</span></th>`;
}

export function legendHtml() {
  return `<div class="metric-legend" ${tipAttr('Color meaning for score badges')}>
    <span class="metric metric-good">Favorable</span>
    <span class="metric metric-mixed">Mixed</span>
    <span class="metric metric-bad">Unfavorable</span>
    <span class="muted legend-note">Hover a score to see what it means.</span>
  </div>`;
}

export const SCORE_INPUT_TIPS = {
  demand: 'Search demand, 1–10. Higher means more searches.',
  competition: 'How open the search results look. Higher is better for you.',
  jobValue: 'Typical job size, 1–10. Higher is better.',
  mapPackGap: 'How much a missing map pack helps. Higher is better for you.',
  displaceability: 'How easy these pages look to beat. Higher is easier.',
};

/** Plain-English competition tip, preferably with this candidate’s live counts. */
export function competitionOpennessTip({ uniqueDomainCount = null } = {}) {
  const base = 'How open the search results look. Higher is better for you.';
  if (uniqueDomainCount == null || !Number.isFinite(Number(uniqueDomainCount))) return base;
  const n = Number(uniqueDomainCount);
  return `${base} ${n} competing site${n === 1 ? '' : 's'}.`;
}

/**
 * Plain-English displaceability tip, preferably with Stage 2 enrichment aggregates.
 */
export function displaceabilityTip({ pageCount = null, thinStubCount = null } = {}) {
  const base = 'How easy these pages look to beat. Higher is easier.';
  if (thinStubCount == null || pageCount == null) return base;
  return `${base} ${thinStubCount} of ${pageCount} pages are thin.`;
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

export function overallScoreTip(inputs = {}) {
  const provisional = inputs.jobValue == null || inputs.jobValue === '';
  if (provisional) return 'Job value is not set yet, so this score can change.';
  return 'Overall score. Higher is a better opportunity.';
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
