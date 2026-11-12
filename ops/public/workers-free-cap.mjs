/**
 * Cloudflare refused a new Worker because the account is at the Workers Free
 * script cap (100). Distinct from the static-asset file cap.
 */

export const WORKERS_FREE_CAP_CODE = 'workers-free-cap';

export const WORKERS_FREE_CAP_NOTE =
  'Cloudflare Workers Free plan is full (100 Workers). Upgrade to Workers Paid, then click Run launch.';

export function isWorkersFreeCapMessage(text) {
  const raw = String(text || '');
  if (/workers free limit of\s+100\b/i.test(raw)) return true;
  if (/reached the workers free limit/i.test(raw)) return true;
  return /\b10037\b/.test(raw) && /workers free/i.test(raw);
}

/** Launch result or a ship result. */
export function isWorkersFreeCapResult(result) {
  if (!result || result.ok === true) return false;
  const ships = [result.ship, result].filter((row) => row && typeof row === 'object');
  for (const ship of ships) {
    if (ship.steps?.deploy?.code === WORKERS_FREE_CAP_CODE) return true;
  }
  const chunks = [];
  for (const ship of ships) {
    if (ship.steps?.deploy?.error) chunks.push(ship.steps.deploy.error);
    if (Array.isArray(ship.human)) chunks.push(...ship.human);
  }
  return isWorkersFreeCapMessage(chunks.join('\n'));
}
