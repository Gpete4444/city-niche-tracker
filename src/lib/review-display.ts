/** Relative date for Google-style review cards ("12 days ago"). */
export function formatReviewRelativeDate(isoOrDate?: string | null, now = new Date()): string {
  if (!isoOrDate) return '';
  const raw = String(isoOrDate).trim();
  const d = new Date(raw.includes('T') ? raw : raw + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return raw;

  const ms = now.getTime() - d.getTime();
  const days = Math.max(0, Math.round(ms / 86400000));
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 7) return days + ' days ago';
  if (days < 14) return '1 week ago';
  if (days < 31) {
    const weeks = Math.round(days / 7);
    return weeks <= 1 ? '1 week ago' : weeks + ' weeks ago';
  }
  if (days < 60) return '1 month ago';
  const months = Math.round(days / 30);
  return months <= 1 ? '1 month ago' : months + ' months ago';
}

/** Initials for Google-style avatar fallback ("David C." → "DC"). */
export function reviewInitials(author: string): string {
  const parts = String(author || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = (parts[1] || '').replace(/\./g, '')[0] || '';
  return (first + last).toUpperCase() || first.toUpperCase() || '?';
}

/** Stable pastel for initials circle (Google-like). */
export function reviewAvatarColor(author: string): string {
  const palette = [
    '#7aa2e3',
    '#8b7cc9',
    '#6bbf8a',
    '#e3a35c',
    '#d46a7a',
    '#5dade2',
    '#58d68d',
    '#af7ac5',
  ];
  let h = 0;
  const s = String(author || '');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
