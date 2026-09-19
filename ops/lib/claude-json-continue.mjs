/**
 * Finish truncated Claude JSON by continuing the same conversation (concat + parse).
 */
import { claudeMessages, parseJsonLoose } from './claude.mjs';

export const JSON_CONTINUE_FOLLOWS = 2;

export const JSON_CONTINUE_USER =
  'Continue the JSON object from exactly where you stopped. Output only the remainder. Do not repeat earlier text. Do not wrap in markdown fences.';

export function concatClaudeJsonText(parts) {
  return (Array.isArray(parts) ? parts : []).map((p) => String(p || '')).join('');
}

function pickCallOpts(opts = {}) {
  const skip = new Set([
    'user',
    'messages',
    'follows',
    'claudeMessagesFn',
    'parseJsonLoose',
    'continueUser',
  ]);
  const out = {};
  for (const [key, value] of Object.entries(opts)) {
    if (!skip.has(key)) out[key] = value;
  }
  return out;
}

/**
 * First call, then up to `follows` continue turns while truncated and JSON is incomplete.
 * @param {{
 *   user: string,
 *   maxTokens?: number,
 *   follows?: number,
 *   claudeMessagesFn?: typeof claudeMessages,
 *   parseJsonLoose?: typeof parseJsonLoose,
 *   continueUser?: string,
 * }} opts
 */
export async function claudeJsonWithContinue(opts = {}) {
  const call = typeof opts.claudeMessagesFn === 'function' ? opts.claudeMessagesFn : claudeMessages;
  const parse = typeof opts.parseJsonLoose === 'function' ? opts.parseJsonLoose : parseJsonLoose;
  const follows = Number(opts.follows) > 0 ? Math.min(4, Number(opts.follows)) : JSON_CONTINUE_FOLLOWS;
  const user = String(opts.user || '');
  const continueUser = String(opts.continueUser || JSON_CONTINUE_USER);
  const shared = pickCallOpts(opts);

  const first = await call({ ...shared, user });
  let text = String(first?.text || '');
  let parsed = first?.parsed?.ok ? first.parsed : parse(text);
  let truncated = Boolean(first?.truncated);
  let last = first || {};
  let followsUsed = 0;

  while (truncated && !parsed?.ok && followsUsed < follows) {
    followsUsed += 1;
    const cont = await call({
      ...shared,
      user: continueUser,
      messages: [
        { role: 'user', content: user },
        { role: 'assistant', content: text },
        { role: 'user', content: continueUser },
      ],
    });
    text = concatClaudeJsonText([text, cont?.text]);
    parsed = parse(text);
    truncated = Boolean(cont?.truncated);
    last = cont || last;
  }

  return {
    ...last,
    text,
    parsed,
    truncated: Boolean(truncated && !parsed?.ok),
    followsUsed,
  };
}
