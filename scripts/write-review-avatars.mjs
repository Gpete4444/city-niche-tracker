import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public', 'images', 'review-avatars');
mkdirSync(dir, { recursive: true });

function svg({ bg, skin, shirt, hairPath }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img">
  <rect width="128" height="128" fill="${bg}"/>
  <ellipse cx="64" cy="112" rx="42" ry="28" fill="${shirt}"/>
  <circle cx="64" cy="58" r="32" fill="${skin}"/>
  ${hairPath}
  <ellipse cx="52" cy="56" rx="3.2" ry="4" fill="#2a2a2a" opacity="0.75"/>
  <ellipse cx="76" cy="56" rx="3.2" ry="4" fill="#2a2a2a" opacity="0.75"/>
  <path d="M54 70 Q64 76 74 70" fill="none" stroke="#c47a6a" stroke-width="2" stroke-linecap="round"/>
</svg>
`;
}

const males = [
  {
    bg: '#c5d4e8',
    skin: '#e8c4a8',
    shirt: '#2f5d8c',
    hairPath: '<path d="M34 50 Q64 18 94 50 L90 42 Q64 22 38 42 Z" fill="#3b2a1f"/>',
  },
  {
    bg: '#d9e8d0',
    skin: '#c68642',
    shirt: '#3d6b4f',
    hairPath: '<path d="M36 48 Q64 20 92 48 L88 40 Q64 24 40 40 Z" fill="#1a1a1a"/>',
  },
  {
    bg: '#e8dcc8',
    skin: '#f1c27d',
    shirt: '#6b4c3b',
    hairPath: '<path d="M35 52 Q64 22 93 52 L89 44 Q64 28 39 44 Z" fill="#6b4423"/>',
  },
  {
    bg: '#d4cce8',
    skin: '#8d5524',
    shirt: '#4a3f6b',
    hairPath: '<path d="M34 49 Q64 16 94 49 L91 40 Q64 22 37 40 Z" fill="#0d0d0d"/>',
  },
];

const females = [
  {
    bg: '#f0d0d8',
    skin: '#e8c4a8',
    shirt: '#a84d6a',
    hairPath:
      '<path d="M30 58 Q36 22 64 20 Q92 22 98 58 L94 70 Q90 40 64 36 Q38 40 34 70 Z" fill="#4a3020"/>',
  },
  {
    bg: '#d0e0f0',
    skin: '#f1c27d',
    shirt: '#3d6ea5',
    hairPath:
      '<path d="M30 56 Q38 20 64 18 Q90 20 98 56 L95 68 Q90 38 64 34 Q38 38 33 68 Z" fill="#c9a227"/>',
  },
  {
    bg: '#e0d8f0',
    skin: '#c68642',
    shirt: '#6b4a8c',
    hairPath:
      '<path d="M29 60 Q35 24 64 20 Q93 24 99 60 L96 74 Q90 42 64 38 Q38 42 32 74 Z" fill="#1f1f1f"/>',
  },
  {
    bg: '#d8ecd8',
    skin: '#8d5524',
    shirt: '#3f7a55',
    hairPath:
      '<path d="M31 58 Q37 22 64 19 Q91 22 97 58 L94 72 Q89 40 64 36 Q39 40 34 72 Z" fill="#2a1810"/>',
  },
];

males.forEach((c, i) => {
  writeFileSync(path.join(dir, `m0${i + 1}.svg`), svg(c));
});
females.forEach((c, i) => {
  writeFileSync(path.join(dir, `f0${i + 1}.svg`), svg(c));
});
console.log('wrote 8 avatars to', dir);
