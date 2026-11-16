/**
 * [Business Name](/) is a self-link the writer invents. The homepage intro
 * prints that source as text. Turn the label back into the plain name.
 * [Home](/), [back home](/), [Contact](/contact), and service links stay.
 */

export function isBusinessHomepageSelfLink(label, href, businessName) {
  const name = String(businessName || '').trim();
  const text = String(label || '').trim();
  const target = String(href || '').trim();
  if (!name || !text || target !== '/') return false;
  return text.toLowerCase() === name.toLowerCase();
}

export function unwrapBusinessSelfLinks(src, businessName) {
  const name = String(businessName || '').trim();
  const text = String(src ?? '');
  if (!name || !text) return text;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`\\[(${escaped})\\]\\(\\s*/\\s*\\)`, 'gi'), (_m, label) => label);
}

/**
 * Sätteri mdast plugin for About, Contact, and location pages.
 * A link to `/` whose label is the business name becomes plain text.
 */
export function createUnwrapBusinessSelfLinkPlugin(businessName) {
  const name = String(businessName || '').trim();
  return {
    name: 'unwrap-business-self-link',
    link(node, context) {
      if (!name) return;
      const label = context.textContent(node);
      if (!isBusinessHomepageSelfLink(label, node.url, name)) return;
      return { type: 'text', value: label };
    },
  };
}
