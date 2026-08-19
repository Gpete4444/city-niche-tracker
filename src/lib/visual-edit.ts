/** Serialize a visual-editor binding for `data-edit` on the live page. */
export function ve(binding: Record<string, unknown>): string {
  return JSON.stringify(binding);
}
