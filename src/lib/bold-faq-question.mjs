/**
 * A location FAQ is a question on its own line, then the answer.
 * Markdown joins that into one paragraph. Bold the question and break before the answer.
 * A question that continues on the same line stays as written.
 */
export function boldLeadingQuestionParagraph(node) {
  const children = node?.children;
  if (!Array.isArray(children) || children.length !== 1) return;
  const first = children[0];
  if (!first || first.type !== 'text') return;
  const value = String(first.value || '');
  const match = value.match(/^([^\n]*\?)\n+([\s\S]+)$/);
  if (!match) return;
  const question = match[1].trim();
  const rest = match[2].replace(/^\n+/, '');
  if (!question || !rest.trim()) return;
  return {
    type: 'paragraph',
    children: [
      { type: 'strong', children: [{ type: 'text', value: question }] },
      { type: 'break' },
      { type: 'text', value: rest },
    ],
  };
}

export function createBoldFaqQuestionPlugin() {
  return {
    name: 'bold-faq-question',
    paragraph(node) {
      return boldLeadingQuestionParagraph(node);
    },
  };
}
