/**
 * "&" in the site list matches "and" on the service page.
 * Run: npx tsx scripts/test-service-name-ampersand.mjs
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pruneUnmatchedServices } from '../ops/lib/content-markdown.mjs';
import {
  commercialServiceCardsForSite,
  serviceCardsForSite,
  serviceNameKey,
} from '../src/lib/services-for-site.ts';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

assert(
  serviceNameKey('Clubhouse & Putting Green Turf') ===
    serviceNameKey('Clubhouse and Putting Green Turf'),
  '& and and share a name key',
);

const cards = commercialServiceCardsForSite(
  [
    {
      id: 'clubhouse-and-putting-green-turf',
      data: {
        serviceName: 'Clubhouse and Putting Green Turf',
        description: 'Clubhouse grounds.',
        cardImage: { src: '/images/svcHero-18-openai-mvmn2zdb.jpg', alt: 'Clubhouse' },
      },
    },
    {
      id: 'sports-field-and-facility-turf',
      data: {
        serviceName: 'Sports Field and Facility Turf',
        description: 'Sports fields.',
        cardImage: { src: '/images/svcHero-20-openai-mvmn1ng1.jpg', alt: 'Sports' },
      },
    },
  ],
  {
    services: [],
    commercialServices: ['Clubhouse & Putting Green Turf', 'Sports Field & Facility Turf'],
    primaryCity: 'El Mirage',
    niche: 'artificial turf',
    homepageServicesLimit: 8,
  },
  8,
);

assert(cards.length === 2, 'both commercial cards match');
assert(
  cards[0].image?.src === '/images/svcHero-18-openai-mvmn2zdb.jpg',
  'clubhouse card uses the page photo',
);
assert(
  cards[0].href === '/services/clubhouse-and-putting-green-turf/',
  'clubhouse card links to the service page',
);
assert(
  cards[1].image?.src === '/images/svcHero-20-openai-mvmn1ng1.jpg',
  'sports card uses the page photo',
);
assert(
  cards[1].href === '/services/sports-field-and-facility-turf/',
  'sports card links to the service page',
);

const desertCards = serviceCardsForSite(
  [
    {
      id: 'desert-climate-turf-conversion-dead-lawn-replacement',
      data: {
        serviceName: 'Desert Climate Turf Conversion',
        description: 'Replaces a dead lawn.',
        cardImage: { src: '/images/svcHero-8-openai-mvmn1prr.jpg', alt: 'Desert climate' },
      },
    },
    {
      id: 'putting-green-installation',
      data: {
        serviceName: 'Putting green installation',
        description: 'Backyard greens.',
        heroImage: { src: '/images/svcHero-2-openai-mvmn0esk.jpg', alt: 'Putting green' },
      },
    },
  ],
  {
    services: [
      'Putting green installation',
      'Desert climate turf conversion (dead-lawn replacement)',
    ],
    commercialServices: [],
    primaryCity: 'Glendale',
    niche: 'artificial turf',
    homepageServicesLimit: 8,
  },
  8,
);

assert(desertCards.length === 2, 'parenthetical name still produces a card');
assert(
  desertCards[1].title === 'Desert Climate Turf Conversion',
  'card title is the page name',
);
assert(
  desertCards[1].image?.src === '/images/svcHero-8-openai-mvmn1prr.jpg',
  'desert climate card uses the page photo',
);
assert(
  desertCards[1].href === '/services/desert-climate-turf-conversion-dead-lawn-replacement/',
  'desert climate card links to the service page',
);
assert(
  desertCards[0].image?.src === '/images/svcHero-2-openai-mvmn0esk.jpg',
  'putting green card still uses its page photo',
);

const namedWins = serviceCardsForSite(
  [
    {
      id: 'putting-green-installation',
      data: {
        serviceName: 'Not the putting green',
        cardImage: { src: '/images/wrong.jpg', alt: 'Wrong' },
      },
    },
    {
      id: 'other-putting',
      data: {
        serviceName: 'Putting green installation',
        cardImage: { src: '/images/right.jpg', alt: 'Right' },
      },
    },
  ],
  {
    services: ['Putting green installation'],
    commercialServices: [],
    primaryCity: 'Glendale',
    niche: 'artificial turf',
    homepageServicesLimit: 8,
  },
  8,
);
assert(namedWins[0].image?.src === '/images/right.jpg', 'serviceName wins over a file id');

const dir = mkdtempSync(path.join(tmpdir(), 'rover-svc-'));
try {
  writeFileSync(
    path.join(dir, 'clubhouse-and-putting-green-turf.md'),
    '---\nserviceName: "Clubhouse and Putting Green Turf"\n---\n',
  );
  writeFileSync(
    path.join(dir, 'not-a-service.md'),
    '---\nserviceName: "Not a service"\n---\n',
  );
  const pruned = pruneUnmatchedServices(['Clubhouse & Putting Green Turf'], dir);
  assert(
    existsSync(path.join(dir, 'clubhouse-and-putting-green-turf.md')),
    'prune keeps the page when & and and are the same slug',
  );
  assert(
    pruned.includes('src/content/services/not-a-service.md') &&
      !existsSync(path.join(dir, 'not-a-service.md')),
    'prune still drops a name that is not on the list',
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('test-service-name-ampersand: ok');
