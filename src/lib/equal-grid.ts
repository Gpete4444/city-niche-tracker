/**
 * Fit a list of equal box/card items into a grid with no empty last-row cells.
 * Trims leftovers when needed; picks a column count that divides evenly.
 */

export interface EqualGridResult<T> {
  items: T[];
  cols: number;
  trimmed: number;
  /** Tailwind classes: 1-col on phone; target cols from sm/lg up */
  className: string;
}

const COL_CLASS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
};

function gridClassName(cols: number): string {
  return COL_CLASS[cols] || COL_CLASS[1];
}

/**
 * 1–2 commercial cards share the residential column track so they stay the
 * same width as the cards above. Returns null for any other count (caller
 * keeps fitEqualGrid). No residential row, or a single stretched residential
 * card, uses the standard 4-column services track.
 */
export function fewCommercialGridClass(
  commercialCount: number,
  residential: { count: number; className: string },
): string | null {
  const n = Math.max(0, Math.floor(Number(commercialCount) || 0));
  if (n < 1 || n > 2) return null;
  const residentialCount = Math.max(0, Math.floor(Number(residential?.count) || 0));
  const residentialClass = String(residential?.className || '').trim();
  if (residentialCount >= 2 && residentialClass) return residentialClass;
  return gridClassName(4);
}

/**
 * Keep a complete 3-wide materials row (cap 6). Do not use fitEqualGrid here —
 * 4 items would become 2×2 instead of dropping to 3.
 * 4→3, 5→3, 7→6, 8→6; 1–2 stay.
 */
export function keepCompleteMaterialsRows(n: number): number {
  const count = Math.max(0, Math.floor(Number(n) || 0));
  if (count < 3) return count;
  return Math.min(6, Math.floor(count / 3) * 3);
}

/**
 * Prefer the largest keep ≤ items.length with cols in 2..maxCols dividing keep.
 * Single item → 1 column. Never returns a ragged last row for the chosen cols.
 */
export function fitEqualGrid<T>(
  items: T[],
  { maxCols = 4 }: { maxCols?: number } = {},
): EqualGridResult<T> {
  const list = Array.isArray(items) ? items : [];
  const n = list.length;
  if (n === 0) {
    return { items: [], cols: 1, trimmed: 0, className: gridClassName(1) };
  }
  if (n === 1) {
    return { items: list.slice(0, 1), cols: 1, trimmed: 0, className: gridClassName(1) };
  }

  const max = Math.max(1, Math.min(4, Math.floor(maxCols) || 4));

  for (let keep = n; keep >= 1; keep -= 1) {
    if (keep === 1) {
      return {
        items: list.slice(0, 1),
        cols: 1,
        trimmed: n - 1,
        className: gridClassName(1),
      };
    }
    const minCols = 2;
    for (let cols = Math.min(max, keep); cols >= minCols; cols -= 1) {
      if (keep % cols === 0) {
        return {
          items: list.slice(0, keep),
          cols,
          trimmed: n - keep,
          className: gridClassName(cols),
        };
      }
    }
  }

  return { items: list.slice(0, 1), cols: 1, trimmed: n - 1, className: gridClassName(1) };
}
