/** Keyword → simple stroke icons for Why choose us (inline SVG path data). */

export type WhyIconId = 'shield' | 'clock' | 'home' | 'star' | 'wrench' | 'check';

/** Ordered pool for unique assignment (round-robin unused). */
export const WHY_ICON_POOL: WhyIconId[] = [
  'shield',
  'clock',
  'home',
  'star',
  'wrench',
  'check',
];

export function whyIconForTitle(title: string): WhyIconId {
  const t = String(title || '').toLowerCase();
  if (/licen|insur|bonded|trust|protect|warrant|certif/.test(t)) return 'shield';
  if (/time|fast|schedul|prompt|quick|on.?time|timeline|deadline|turnaround|punctual/.test(t))
    return 'clock';
  if (/local|neighbor|community|area|city|near|hometown|regional/.test(t)) return 'home';
  if (/quality|craft|detail|finish|premium|workmanship|durable|solid/.test(t)) return 'star';
  if (/experience|pro|crew|team|expert|skill|trained|veteran/.test(t)) return 'wrench';
  if (/value|price|afford|budget|fair|honest|transparent|cost/.test(t)) return 'check';
  if (/communicat|responsive|update|call.?back|listen|clear|reach/.test(t)) return 'clock';
  return 'check';
}

/** Assign distinct icons per card; keyword pick first, then next unused from pool. */
export function assignUniqueWhyIcons(titles: string[]): WhyIconId[] {
  const used = new Set<WhyIconId>();
  return titles.map((title) => {
    let pick = whyIconForTitle(title);
    if (used.has(pick)) {
      const next = WHY_ICON_POOL.find((id) => !used.has(id));
      if (next) pick = next;
    }
    used.add(pick);
    return pick;
  });
}

/** Path `d` attributes for 24x24 viewBox lucide-like icons. */
export const WHY_ICON_PATHS: Record<WhyIconId, string> = {
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  clock: 'M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5z',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2z',
  wrench:
    'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  check: 'M20 6 9 17l-5-5',
};
