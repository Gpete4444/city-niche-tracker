/**
 * Generate-time occupancy for image prompts.
 * Claude Image-queries stay empty; this rewrites occupancy at serve/generate.
 *
 * Stored value "people" means the crew (legacy). "customers" is the intended
 * users of the finished product. "workers" is the same crew prompt.
 * "none" is Problem: no people, and the job is not done.
 * "finished" is the completed result with no people.
 */

export function normalizeOccupancy(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'customers' || value === 'customer') return 'customers';
  if (value === 'finished' || value === 'finish') return 'finished';
  if (value === 'people' || value === 'workers' || value === 'worker') return 'workers';
  return 'none';
}

/** ChatGPT Problem — the unsolved condition, with no people. */
export const NO_PEOPLE_RULES =
  'No people, no faces, no hands, no crew, no customers, no silhouettes. Show the problem this service will fix: the damaged, unfinished, or incomplete condition before the work is done. Not a finished install and not a showroom. No text, no logos, no watermarks, no UI, no phone screens.';

/** Flux Problem — the unsolved condition, unoccupied. */
export const FLUX_UNOCCUPIED_SCENE =
  'The scene shows the problem this service fixes: damaged, unfinished, or incomplete, before the work is done. Unoccupied. Photoreal documentary still of the trade.';

/** ChatGPT Finished — the completed result, with no people. */
export const FINISHED_RULES =
  'No people, no faces, no hands, no crew, no customers, no silhouettes. The work is already complete: the finished product only, with the problem solved. No install crew, no tools in use, no job-site mess. No text, no logos, no watermarks, no UI, no phone screens.';

/** Flux Finished — the completed result, unoccupied. */
export const FLUX_FINISHED_SCENE =
  'The finished result is complete and the problem is solved. Unoccupied, no crew, and no tools in use. Photoreal documentary still of the trade.';

export const PEOPLE_RULES =
  'Show 1–2 trade workers actively doing the described job — natural documentary pose, not a smiling stock crew. Faces and hands may be visible. No customers, no lifestyle extras. No text, no logos, no watermarks, no UI, no phone screens.';

export const FLUX_OCCUPIED_SCENE =
  'One or two trade workers actively doing the described job in a photoreal documentary still. Natural pose, not a smiling stock crew.';

function occupancySubject(ctx = {}) {
  const serviceName = String(ctx.serviceName || '').trim();
  const niche = String(ctx.niche || '').trim();
  return {
    trade: serviceName || niche || 'result',
    nicheName: niche || serviceName || 'local service',
    setting: ctx.setting === 'commercial' ? 'commercial' : ctx.setting === 'residential' ? 'residential' : '',
  };
}

/** ChatGPT People line for this niche and service. */
export function customerRulesText(ctx = {}) {
  const { trade, nicheName, setting } = occupancySubject(ctx);
  const who =
    setting === 'commercial'
      ? 'staff and visitors using that finished commercial space'
      : 'the household using that finished home result';
  return `Show people using the finished ${trade} the way a customer of this ${nicheName} business would. The people are ${who}. Stay on this trade only. The work is already complete. No install crew, no tools in use, no job-site mess. Natural candid use, not a posed stock smile. No text, no logos, no watermarks, no UI, no phone screens.`;
}

/** Flux People line for this niche and service. Flux 2 has no negative prompts. */
export function fluxCustomerScene(ctx = {}) {
  const { trade, nicheName } = occupancySubject(ctx);
  return `The finished ${trade} is in use by the people this ${nicheName} work is for. The work is already complete. No install crew and no tools in use. Natural candid use, not a posed stock smile.`;
}

/** After-photo edit may add the people who use this trade, without changing the room or crop. */
export function afterCustomersAllow(ctx = {}) {
  const { trade } = occupancySubject(ctx);
  return `Finish the ${trade}, and add the people who use that finished result. Keep the same crop, camera, and room.`;
}

export const CUSTOMER_RULES = customerRulesText();
export const FLUX_CUSTOMER_SCENE = fluxCustomerScene();
export const AFTER_CUSTOMERS_ALLOW = afterCustomersAllow();

/** Pull niche, service, and setting out of a prompt that already names them. */
export function occupancyContextFromPrompt(text) {
  const src = String(text || '');
  const nicheLine = src.match(/\bNiche:\s*([^.]+)\./i);
  const serviceLine = src.match(/\bService focus:\s*([^.]+)\./i);
  const local = src.match(/\blocal\s+(.+?)\s+business\b/i);
  const focus = src.match(/Focus specifically on\s+([^(.\n]+)/i);
  let serviceName = String(serviceLine?.[1] || focus?.[1] || '').trim();
  serviceName = serviceName.replace(/\s*\(not other services\)\s*$/i, '').trim();
  const setting = /commercial building|commercial space|commercial interior|commercial architecture|\bSetting:\s*commercial\b/i.test(
    src,
  )
    ? 'commercial'
    : /residential setting|residential architecture|\bSetting:\s*residential\b/i.test(src)
      ? 'residential'
      : '';
  return {
    niche: String(nicheLine?.[1] || local?.[1] || '').trim(),
    serviceName,
    setting,
  };
}

function resolveOccupancyContext(text, ctx = {}) {
  const inferred = occupancyContextFromPrompt(text);
  const setting =
    ctx.setting === 'commercial' || ctx.setting === 'residential' ? ctx.setting : inferred.setting || '';
  return {
    niche: String(ctx.niche || inferred.niche || '').trim(),
    serviceName: String(ctx.serviceName || inferred.serviceName || '').trim(),
    setting,
  };
}

export function occupancyLine(forChatGpt, occupancy, ctx = {}) {
  const mode = normalizeOccupancy(occupancy);
  if (mode === 'workers') return forChatGpt ? PEOPLE_RULES : FLUX_OCCUPIED_SCENE;
  if (mode === 'customers') return forChatGpt ? customerRulesText(ctx) : fluxCustomerScene(ctx);
  if (mode === 'finished') return forChatGpt ? FINISHED_RULES : FLUX_FINISHED_SCENE;
  return forChatGpt ? NO_PEOPLE_RULES : FLUX_UNOCCUPIED_SCENE;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactClause(text) {
  return new RegExp(escapeRegExp(text), 'gi');
}

const OCCUPANCY_CLAUSE_PATTERNS = [
  exactClause(NO_PEOPLE_RULES),
  exactClause(FLUX_UNOCCUPIED_SCENE),
  exactClause(FINISHED_RULES),
  exactClause(FLUX_FINISHED_SCENE),
  exactClause(PEOPLE_RULES),
  exactClause(FLUX_OCCUPIED_SCENE),
  exactClause(CUSTOMER_RULES),
  exactClause(FLUX_CUSTOMER_SCENE),
  exactClause(AFTER_CUSTOMERS_ALLOW),
  /No people, no faces, no hands, no crew, no customers, no silhouettes\.\s*Empty rooms, installs, tools, and materials only\.\s*No text, no logos, no watermarks, no UI, no phone screens\./gi,
  /Show the problem this service will fix:[\s\S]*?No phone screens\./gi,
  /The work is already complete: the finished product only, with the problem solved\.[\s\S]*?No phone screens\./gi,
  /The scene shows the problem this service fixes:[^.]*\./gi,
  /The finished result is complete and the problem is solved\.[^.]*\./gi,
  /No people, no faces, no hands, no crew, no customers, no silhouettes\./gi,
  /No people, no faces, no hands, no crew, no customers\./gi,
  /No people, no faces, no hands, no crew\./gi,
  /(?:^|(?<=\.\s)|(?<=\n))No people\./gi,
  /Unoccupied interior\/exterior:[^.]*\./gi,
  /Show 1[-–]2 trade workers actively doing the described job[^.]*\./gi,
  /One or two trade workers actively doing the described job[^.]*\./gi,
  /The finished product is in use by the intended customers[\s\S]*?posed stock smile\./gi,
  /The finished .+? is in use by the people this .+? work is for\. The work is already complete\. No install crew and no tools in use\. Natural candid use, not a posed stock smile\./gi,
  /Show the intended customers using the finished product the way this service is meant to be used\.[\s\S]*?No phone screens\./gi,
  /Show people using the finished .+? the way a customer of this .+? business would\.[\s\S]*?No phone screens\./gi,
  /Finish the .+?, and (?:you may add the intended customers using that finished result|add the people who use that finished result)\. Keep the same crop, camera, and room\./gi,
  /a family or children playing on sports or play turf,?/gi,
  /golfers on a putting green,?/gi,
];

const AFTER_DEFECT_ONLY = [
  /Do not change anything except the service defect\./gi,
  /Only the service element changes\./gi,
  /Only the service feature itself changes\./gi,
  /Only the service feature is finished\./gi,
  /Only the service element is finished\./gi,
  /Update only the .+? result\./gi,
  /only the .+? work is finished\./gi,
];

function replaceAllPatterns(text, patterns, replacement) {
  let next = text;
  for (const re of patterns) {
    next = next.replace(re, replacement);
  }
  return next;
}

function withoutOccupancyClauses(text) {
  return replaceAllPatterns(text, OCCUPANCY_CLAUSE_PATTERNS, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+\./g, '.')
    .trim();
}

/**
 * Swap empty / workers / customers clauses. The chosen line replaces the others.
 * @param {string} text
 * @param {string} occupancy none | finished | workers | customers | people (legacy workers)
 * @param {{ niche?: string, serviceName?: string, setting?: string }} [ctx]
 */
const INTRO_ROLE_RE =
  /Slot role: intro section — clean supporting photo of the trade in a (?:residential setting|commercial building)\./gi;

/** Saved intro prompts keep the old role line. Problem and Finished replace it. */
function withHomepageIntroRole(text, occupancy) {
  const mode = normalizeOccupancy(occupancy);
  if (mode !== 'none' && mode !== 'finished') return text;
  const role =
    mode === 'finished'
      ? 'Slot role: intro — wide photo of the finished result. The problem is solved and the result is complete, with no people.'
      : 'Slot role: intro — wide photo of the problem this service fixes, still unfinished.';
  return text.replace(INTRO_ROLE_RE, role);
}

export function applyOccupancyToPrompt(text, occupancy, ctx = {}) {
  const src = String(text || '').trim();
  if (!src) return src;
  const subject = resolveOccupancyContext(src, ctx);
  const line = occupancyLine(true, occupancy, subject);
  let base = withHomepageIntroRole(withoutOccupancyClauses(src), occupancy);
  if (!base) return line;
  if (base.includes(line)) return base;
  return `${base} ${line}`;
}

const AFTER_PEOPLE_ALLOW_RE =
  /Finish the .+?, and (?:you may add the intended customers using that finished result|add the people who use that finished result)\. Keep the same crop, camera, and room\./gi;

function allowCustomersOnAfter(text, ctx = {}) {
  const allow = afterCustomersAllow(ctx);
  let next = replaceAllPatterns(text, AFTER_DEFECT_ONLY, allow);
  next = next.replace(AFTER_PEOPLE_ALLOW_RE, allow);
  if (!next.includes(allow)) next = `${next} ${allow}`;
  const one = escapeRegExp(allow);
  next = next.replace(new RegExp(`(?:${one}\\s*){2,}`, 'g'), `${allow} `);
  return next.replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Customers rewrite the after photo only. The before stays the unsolved problem.
 * Problem and Finished use the problem line on the before and the finished
 * result with no people on the after. Workers apply to both sides.
 * @param {{ niche?: string, serviceName?: string, setting?: string }} [ctx]
 */
export function applyBaOccupancyPrompts(before, after, occupancy, ctx = {}) {
  const subject = resolveOccupancyContext(`${before || ''}\n${after || ''}`, ctx);
  const mode = normalizeOccupancy(occupancy);
  if (mode === 'workers') {
    return {
      before: applyOccupancyToPrompt(before, 'workers', subject),
      after: applyOccupancyToPrompt(after, 'workers', subject),
    };
  }
  if (mode === 'customers') {
    return {
      before: applyOccupancyToPrompt(before, 'none', subject),
      after: allowCustomersOnAfter(applyOccupancyToPrompt(after, 'customers', subject), subject),
    };
  }
  return {
    before: applyOccupancyToPrompt(before, 'none', subject),
    after: applyOccupancyToPrompt(after, 'finished', subject),
  };
}
