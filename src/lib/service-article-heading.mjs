/**
 * "How long does a Piering and Underpinning take?" is a service title used as a noun.
 * A normal sentence such as "How long does a haircut take?" stays as written.
 */

const AWKWARD_ARTICLE_RE =
  /^(How long does|What does) a ([A-Z][^?\n]*?\s+[A-Z][^?\n]*?)( take\?| cost(\s+in\b[^?\n]*)?\?)$/;

const BARE_SERVICE_RE =
  /^(How long does|What does) (?!a\s)(.+?)( take\?| cost(\s+in\b[^?\n]*)?\?)$/;

export function polishServiceArticleHeading(raw) {
  const s = String(raw ?? '').trim();
  const awkward = s.match(AWKWARD_ARTICLE_RE);
  if (awkward) return `${awkward[1]} ${awkward[2].toLowerCase()}${awkward[3]}`;
  const bare = s.match(BARE_SERVICE_RE);
  if (!bare) return s;
  const subject = bare[2].trim();
  if (subject.split(/\s+/).length < 2) return s;
  return `${bare[1]} ${subject.toLowerCase()}${bare[3]}`;
}
