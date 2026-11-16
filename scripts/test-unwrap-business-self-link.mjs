/**
 * [Business Name](/) becomes the plain name. Nav links stay.
 * Run: node scripts/test-unwrap-business-self-link.mjs
 */
import { normalizeContentFilesMap } from '../ops/lib/content-markdown.mjs';
import { simpleProseToHtml } from '../src/lib/content-body.ts';
import {
  createUnwrapBusinessSelfLinkPlugin,
  unwrapBusinessSelfLinks,
} from '../src/lib/unwrap-business-self-link.mjs';
import siteConfig from '../src/config/site-config.json' with { type: 'json' };

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

const name = 'West Haven Foundation Pros';
const sentence =
  "Settling, cracking, bowing walls. If your West Haven home is doing one of these, you're not imagining it. [West Haven Foundation Pros](/) fixes foundation problems for homes and small commercial buildings across Weber County.";

assertEqual(
  unwrapBusinessSelfLinks(sentence, name),
  sentence.replace('[West Haven Foundation Pros](/)', name),
  'west haven sentence is plain text',
);
assertEqual(
  unwrapBusinessSelfLinks(`[${name.toLowerCase()}](/) stays written as given`, name),
  `${name.toLowerCase()} stays written as given`,
  'match ignores case and keeps the written label',
);
assertEqual(
  unwrapBusinessSelfLinks('[Home](/) and [back home](/) and [Contact](/contact)', name),
  '[Home](/) and [back home](/) and [Contact](/contact)',
  'nav links stay',
);
assertEqual(
  unwrapBusinessSelfLinks('[See photo examples on our home page](/)', name),
  '[See photo examples on our home page](/)',
  'descriptive homepage link stays',
);

const html = simpleProseToHtml(
  `[${siteConfig.businessName}](/) fixes it. [Contact](/contact) or [Home](/).`,
);
assert(!html.includes('](/)'), 'intro html has no raw markdown');
assert(html.includes(siteConfig.businessName), 'intro html keeps the business name');
assert(!html.includes(`<a href="/">${siteConfig.businessName}</a>`), 'business name is not a link');
assert(html.includes('href="/contact/"'), 'contact link renders');
assert(html.includes('>Home</a>'), 'home link renders');

const plugin = createUnwrapBusinessSelfLinkPlugin(name);
const brand = plugin.link(
  { type: 'link', url: '/' },
  { textContent: () => name },
);
assertEqual(brand.type, 'text', 'markdown plugin unwraps the brand link');
assertEqual(brand.value, name, 'markdown plugin keeps the brand label');
assertEqual(
  plugin.link({ type: 'link', url: '/' }, { textContent: () => 'Home' }),
  undefined,
  'markdown plugin keeps Home',
);
assertEqual(
  plugin.link({ type: 'link', url: '/contact' }, { textContent: () => 'Contact' }),
  undefined,
  'markdown plugin keeps Contact',
);

const saved = normalizeContentFilesMap(
  {
    'src/content/pages/index.md': `---\ntitle: "T"\ndescription: "D"\nh1: "H"\n---\n[${name}](/) fixes it. [Home](/) [Contact](/contact)\n`,
  },
  { businessName: name, niche: 'Foundation Repair', primaryCity: 'West Haven', state: 'UT' },
);
const body = saved['src/content/pages/index.md'];
assert(body.includes(`${name} fixes it.`), 'save writes the plain name');
assert(!body.includes(`[${name}](/)`), 'save drops the brand link');
assert(body.includes('[Home](/)'), 'save keeps Home');
assert(body.includes('[Contact](/contact)'), 'save keeps Contact');

console.log('test-unwrap-business-self-link: ok');
