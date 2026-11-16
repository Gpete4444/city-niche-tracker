/** A line that is only a bold label, such as `**Optional:**`. */
function labelOnlyLine(line) {
  const match = line.trim().match(/^\*\*(.+?)\*\*\s*:?\s*$/);
  if (!match) return null;
  const label = match[1].replace(/:\s*$/, '').trim();
  if (!label || label.length > 40) return null;
  return label;
}

/**
 * Keep label-only lines with the bullets that follow them.
 * "Typically included: …" stays in the intro because it has body text.
 */
export function parseLabeledBulletGroups(body) {
  const introLines = [];
  const groups = [];
  let current = null;
  let seenBullet = false;

  for (const raw of String(body || '').replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const label = labelOnlyLine(trimmed);
    if (label) {
      current = { label, bullets: [] };
      groups.push(current);
      continue;
    }
    if (/^[-*•]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      const item = trimmed.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '');
      if (!current) {
        current = { label: '', bullets: [] };
        groups.push(current);
      }
      current.bullets.push(item);
      seenBullet = true;
      continue;
    }
    if (!seenBullet && !groups.length) introLines.push(raw);
  }

  return {
    intro: introLines.join('\n').trim(),
    groups: groups.filter((group) => group.bullets.length > 0),
  };
}
