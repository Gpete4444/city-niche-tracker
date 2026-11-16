/**
 * Bare phone numbers in closings become tel links.
 * [Business Name](/contact) goes back to plain text.
 * [Contact](/contact), [contact form](/contact), and [Business Name](/about) stay.
 */

function localDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return '';
}

function telHref(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return `tel:+${digits}`;
}

function displayPhone(local) {
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

export function isBusinessContactLink(label, href, businessName) {
  const name = String(businessName || '').trim();
  const text = String(label || '').trim();
  const target = String(href || '').trim().replace(/\/+$/, '') || '/';
  if (!name || !text) return false;
  if (target !== '/contact') return false;
  return text.toLowerCase() === name.toLowerCase();
}

function unwrapBusinessContactLinks(src, businessName) {
  const name = String(businessName || '').trim();
  const text = String(src ?? '');
  if (!name || !text) return text;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`\\[(${escaped})\\]\\(\\s*/contact/?\\s*\\)`, 'gi'), '$1');
}

function linkifyBarePhones(src, phone) {
  const local = localDigits(phone);
  const href = telHref(phone);
  const text = String(src ?? '');
  if (!local || !href || !text) return text;
  const display = displayPhone(local);
  return text.replace(/(\[[^\]]+\]\([^)]+\))|((?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4})/g, (full, link, found) => {
    if (link) return link;
    const digits = String(found || '').replace(/\D/g, '');
    const loc = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (loc !== local) return found;
    return `[${display}](${href})`;
  });
}

export function linkifyProsePhones(src, { businessName = '', phone = '' } = {}) {
  return linkifyBarePhones(unwrapBusinessContactLinks(src, businessName), phone);
}

function textOf(node) {
  if (!node) return '';
  if (node.type === 'text') return String(node.value || '');
  if (!Array.isArray(node.children)) return '';
  return node.children.map(textOf).join('');
}

function splitPhoneText(value, phone) {
  const local = localDigits(phone);
  const href = telHref(phone);
  const source = String(value || '');
  if (!local || !href) return [{ type: 'text', value: source }];
  const re = /(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/g;
  const parts = [];
  let last = 0;
  let match;
  while ((match = re.exec(source))) {
    const digits = match[0].replace(/\D/g, '');
    const loc = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (loc !== local) continue;
    if (match.index > last) parts.push({ type: 'text', value: source.slice(last, match.index) });
    parts.push({
      type: 'link',
      url: href,
      children: [{ type: 'text', value: displayPhone(local) }],
    });
    last = match.index + match[0].length;
  }
  if (!parts.length) return [{ type: 'text', value: source }];
  if (last < source.length) parts.push({ type: 'text', value: source.slice(last) });
  return parts;
}

export function linkifyPhoneParagraph(node, { businessName = '', phone = '' } = {}) {
  if (!node || node.type !== 'paragraph' || !Array.isArray(node.children)) return;
  const next = [];
  let changed = false;
  for (const child of node.children) {
    if (child?.type === 'link' && isBusinessContactLink(textOf(child), child.url, businessName)) {
      next.push({ type: 'text', value: textOf(child) });
      changed = true;
      continue;
    }
    if (child?.type === 'text') {
      const parts = splitPhoneText(child.value, phone);
      const same = parts.length === 1 && parts[0].type === 'text' && parts[0].value === child.value;
      if (!same) {
        next.push(...parts);
        changed = true;
        continue;
      }
    }
    next.push(child);
  }
  if (!changed) return;
  return { type: 'paragraph', children: next };
}

export function createLinkifyPhonePlugin({ businessName = '', phone = '' } = {}) {
  return {
    name: 'linkify-prose-phone',
    paragraph(node) {
      return linkifyPhoneParagraph(node, { businessName, phone });
    },
  };
}
