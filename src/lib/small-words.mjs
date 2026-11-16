/** Title-case small words stay lowercase unless they are the first word. */
const SMALL_WORDS = new Set(['and', 'or', 'of', 'the', 'a', 'for', 'to', 'in', 'with', 'on']);

export function fixSmallWords(raw) {
  const s = String(raw ?? '');
  if (!s) return s;
  let seenWord = false;
  return s.replace(/[A-Za-z]+/g, (word) => {
    if (!seenWord) {
      seenWord = true;
      return word;
    }
    if (!SMALL_WORDS.has(word.toLowerCase())) return word;
    return word.toLowerCase();
  });
}
