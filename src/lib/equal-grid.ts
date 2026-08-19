/**
 * Fit a list of equal box/card items into a grid with no empty last-row cells.
 * Trims leftovers when needed; picks a column count that divides evenly.
 */

export interface EqualGridResult<T> {
  items: T[];
  cols: number;
  trimmed: number;
  /** Tailwind classes: denser mobile (2-col) when cols ≥ 2; exact cols from sm/lg up */
  className: string;
}

const COL_CLASS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
};

function gridClassName(cols: number): string {
  return COL_CLASS[cols] || COL_CLASS[1];
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
